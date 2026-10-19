import { AiProviderError, AiRequestSchema, AiProvenanceSchema, AiUsageSchema, type AiAttempt, type AiFailureCode, type AiPolicy, type AiProvenance } from '../../contracts/ai-orchestration.js';
import { ConversationIntentSchema, CONVERSATION_LIMITS, type ConversationIntent } from '../../contracts/conversations.js';
import { AI_CAPABILITIES, AiTaskRequestSchema, createRegistry, type AiAdapter, type AiRequest, type AiDispatchResult, type AiTask, type AiTaskRequest, type AiTaskResult, type ModelRoute } from './registry.js';

type Health = { failures: number; openUntil: number; active: number; halfOpen: boolean; windowStart: number; requests: number; state: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'DISABLED' | 'UNKNOWN' };
const transient = new Set<AiFailureCode>(['PROVIDER_UNAVAILABLE','PROVIDER_TIMEOUT','PROVIDER_RATE_LIMITED']);
const zeroUsage = {inputTokens:null,outputTokens:null,totalTokens:null,estimatedCostUsd:null};
const INTENT_TASK: AiTask<ConversationIntent> = {outputBytes:CONVERSATION_LIMITS.outputBytes,parse(raw){const parsed=ConversationIntentSchema.safeParse(raw);if(!parsed.success)throw new AiProviderError('PROVIDER_SCHEMA_VIOLATION');return parsed.data;}};
/** Process-local, bounded state. No prompts, credentials or owner data retained. */
export class AiOrchestrator {
  readonly registry: ReturnType<typeof createRegistry>;
  private readonly health = new Map<string, Health>();
  constructor(policy: AiPolicy, adapters: ReadonlyMap<string, AiAdapter>, private readonly observe?: (event: AiAttempt & {requestId:string}) => void) {
    this.registry = createRegistry(policy, adapters);
    for (const p of this.registry.providers) this.health.set(p.config.providerId, {failures:0,openUntil:0,active:0,halfOpen:false,windowStart:0,requests:0,state:p.config.enabled?'UNKNOWN':'DISABLED'});
  }
  status() { return this.registry.providers.map(p => { const h=this.health.get(p.config.providerId)!; return {providerId:p.config.providerId,state:h.state,circuit:h.openUntil ? (h.halfOpen?'HALF_OPEN':'OPEN'):'CLOSED',active:h.active,requestsInWindow:h.requests}; }); }
  /** Selection is entirely server-owned; callers cannot provide endpoint/model/vendor payloads. */
  routes(request: AiRequest | AiTaskRequest): {route:ModelRoute; failure:AiFailureCode|null}[] {
    const bytes=Buffer.byteLength(JSON.stringify({text:request.text,context:request.context}));
    return this.registry.models.slice().sort((a,b)=>a.provider.config.priority-b.provider.config.priority || a.model.priority-b.model.priority || a.provider.config.providerId.localeCompare(b.provider.config.providerId,'en') || a.model.modelId.localeCompare(b.model.modelId,'en')).map(({provider,model},position)=>{
      const p=provider.config, h=this.health.get(p.providerId)!;
      let failure:AiFailureCode|null=null;
      if (!p.enabled) failure='PROVIDER_DISABLED';
      else if (!model.enabled) failure='MODEL_UNAVAILABLE';
      else if (!p.capabilities.includes(request.capability) || !model.capabilities.includes(request.capability)) failure='CAPABILITY_UNSUPPORTED';
      else if (p.type==='REMOTE_OPENAI_COMPATIBLE' && (this.registry.policy.privacyClass==='LOCAL_ONLY' || request.privacyClass==='LOCAL_ONLY' || model.privacyClass==='LOCAL_ONLY' || (this.registry.policy.privacyClass==='PUBLIC_NON_SENSITIVE' && request.privacyClass!=='PUBLIC_NON_SENSITIVE') || (model.privacyClass==='PUBLIC_NON_SENSITIVE' && request.privacyClass!=='PUBLIC_NON_SENSITIVE'))) failure='PROVIDER_POLICY_REJECTED';
      else if (model.costClass==='METERED' && !this.registry.policy.allowMetered || !model.structuredOutput || bytes>model.contextBytes) failure='PROVIDER_POLICY_REJECTED';
      else if (h.openUntil>Date.now() || h.halfOpen) failure='PROVIDER_UNAVAILABLE';
      return {route:{provider,model,position},failure};
    });
  }
  async interpret(request: AiRequest, deterministic: ConversationIntent, callerSignal?: AbortSignal): Promise<{intent:ConversationIntent;provenance:AiProvenance}> {
    const start=performance.now(), policy=this.registry.policy;
    const validated=AiRequestSchema.safeParse(request);if(!validated.success)throw new AiProviderError('PROVIDER_POLICY_REJECTED');
    if (callerSignal?.aborted) throw new AiProviderError('REQUEST_CANCELLED');
    // Only intent extraction has this schema and deterministic parser; every other capability is a typed task (run).
    if (request.capability!=='ARCHITECTURAL_INTENT_EXTRACTION' || AI_CAPABILITIES.find(c=>c.capability===request.capability)?.status!=='AVAILABLE') throw new AiProviderError('CAPABILITY_UNSUPPORTED');
    // Validation copies context so malicious in-process adapters cannot mutate authoritative state.
    const safeContext={intent:ConversationIntentSchema.parse(request.context.intent),questions:request.context.questions.slice(),...(request.context.mode?{mode:request.context.mode}:{})};
    if(request.text.length>CONVERSATION_LIMITS.text || safeContext.questions.length>24 || safeContext.questions.some(q=>q.length>300)) throw new AiProviderError('PROVIDER_POLICY_REJECTED');
    const run=await this.dispatch({...request,context:safeContext},INTENT_TASK,callerSignal);
    const finish=(intent:ConversationIntent,providerId:string,modelId:string,position:number,usage:AiProvenance['usage'],fallback:boolean)=>({intent,provenance:AiProvenanceSchema.parse({requestId:request.requestId,capability:request.capability,privacyClass:request.privacyClass,providerId,modelId,routingReason:fallback?'DETERMINISTIC':position?'SECONDARY':'PREFERRED',fallbackPosition:position,latencyMs:performance.now()-start,status:fallback?'FALLBACK':'SUCCESS',intentSource:fallback?'DETERMINISTIC':'PROVIDER',requests:run.requests,attempts:run.attempts,usage})});
    if(run.ok)return finish(run.output,run.providerId,run.modelId,run.position,run.usage,false);
    if(callerSignal?.aborted)throw new AiProviderError('REQUEST_CANCELLED');
    if(!policy.deterministicFallback)throw new AiProviderError('ALL_PROVIDERS_FAILED');
    return finish(ConversationIntentSchema.parse(deterministic),'deterministic','bounded-conversation-v1',this.registry.models.length,null,true);
  }
  /**
   * Phase 39: one capability-typed task (server-owned instructions, bounded data, its own validator) over the same routes and failure policy.
   * There is no fallback here: an unsuccessful routing returns `ok: false` with every attempt, and the caller decides, explicitly, what follows.
   */
  async run<T>(request: AiTaskRequest, task: AiTask<T>, callerSignal?: AbortSignal): Promise<AiTaskResult<T>> {
    const start=performance.now();
    if(!AiTaskRequestSchema.safeParse(request).success)throw new AiProviderError('PROVIDER_POLICY_REJECTED');
    if (callerSignal?.aborted) throw new AiProviderError('REQUEST_CANCELLED');
    if (request.capability==='ARCHITECTURAL_INTENT_EXTRACTION' || AI_CAPABILITIES.find(c=>c.capability===request.capability)?.status!=='AVAILABLE') throw new AiProviderError('CAPABILITY_UNSUPPORTED');
    if (Buffer.byteLength(JSON.stringify({text:request.text,context:request.context}))>CONVERSATION_LIMITS.contextBytes) throw new AiProviderError('PROVIDER_POLICY_REJECTED');
    const run=await this.dispatch({...request,context:structuredClone(request.context)},task,callerSignal);
    if(!run.ok && callerSignal?.aborted)throw new AiProviderError('REQUEST_CANCELLED');
    return {...run,latencyMs:Math.round(performance.now()-start)};
  }
  /** The routing loop shared by every capability: ordered routes, per-attempt deadlines inside one total deadline, bounded transient retries, circuits. */
  private async dispatch<T>(request: AiRequest | AiTaskRequest, task: AiTask<T>, callerSignal?: AbortSignal): Promise<AiDispatchResult<T>> {
    const policy=this.registry.policy;
    const timeout=AbortSignal.timeout(Math.max(1,Math.min(policy.timeoutMs,request.timeoutMs)));
    const signal=AbortSignal.any([timeout,...(callerSignal?[callerSignal]:[])]);
    const attempts:AiAttempt[]=[]; let calls=0;
    const record=(event:AiAttempt)=>{attempts.push(event);try{this.observe?.({...event,requestId:request.requestId});}catch{/* Operational observers cannot change results. */}};
    for (const {route,failure} of this.routes(request)) {
      const {provider,model,position}=route, p=provider.config, h=this.health.get(p.providerId)!;
      const base={providerId:p.providerId,modelId:model.modelId,capability:request.capability,routingReason:position?'SECONDARY' as const:'PREFERRED' as const,fallbackPosition:position};
      if(failure) {record({...base,attempt:0,latencyMs:0,status:'SKIPPED',failure,usage:null});continue;}
      for(let retry=0;retry<=policy.retries && calls<policy.maxAttempts && !signal.aborted;retry++) {
        const now=Date.now();
        if(now-h.windowStart>=60000){h.windowStart=now;h.requests=0;}
        const blocked=h.active>=p.maxConcurrent || h.requests>=p.requestsPerMinute ? 'PROVIDER_RATE_LIMITED' : h.openUntil>now || h.halfOpen ? 'PROVIDER_UNAVAILABLE' : null;
        if(blocked){record({...base,attempt:0,latencyMs:0,status:'SKIPPED',failure:blocked,usage:null});break;}
        const probe=h.openUntil>0; if(probe)h.halfOpen=true;
        h.active++;h.requests++;calls++;
        const began=performance.now();
        const attemptSignal=AbortSignal.any([signal,AbortSignal.timeout(Math.min(p.timeoutMs,request.timeoutMs))]);
        let failureCode:AiFailureCode|null=null;
        try {
          const response=await bounded(provider.adapter.execute({...request,context:structuredClone(request.context),timeoutMs:Math.min(p.timeoutMs,request.timeoutMs)} as AiRequest | AiTaskRequest,model,attemptSignal),attemptSignal);
          if(attemptSignal.aborted)throw new AiProviderError('PROVIDER_TIMEOUT');
          if(response.finishReason!=='stop')throw new AiProviderError('PROVIDER_RESPONSE_INVALID');
          let json:string;
          try{json=typeof response.output==='string'?response.output:JSON.stringify(response.output);}catch{throw new AiProviderError('PROVIDER_RESPONSE_INVALID');}
          if(!json)throw new AiProviderError('PROVIDER_RESPONSE_INVALID');
          if(Buffer.byteLength(json)>task.outputBytes)throw new AiProviderError('PROVIDER_RESPONSE_TOO_LARGE');
          let raw:unknown;try{raw=JSON.parse(json);}catch{throw new AiProviderError('PROVIDER_RESPONSE_INVALID');}
          const output=task.parse(raw);
          const usage=AiUsageSchema.safeParse(response.usage??zeroUsage);
          if(!usage.success)throw new AiProviderError('PROVIDER_RESPONSE_INVALID');
          const acceptedUsage={...usage.data,estimatedCostUsd:null as number|null};
          if(acceptedUsage.inputTokens!==null && acceptedUsage.outputTokens!==null && model.inputUsdPerMillion!==undefined && model.outputUsdPerMillion!==undefined) acceptedUsage.estimatedCostUsd=(acceptedUsage.inputTokens*model.inputUsdPerMillion+acceptedUsage.outputTokens*model.outputUsdPerMillion)/1000000;
          h.failures=0;h.openUntil=0;h.state='AVAILABLE';
          record({...base,attempt:calls,latencyMs:performance.now()-began,status:'SUCCESS',failure:null,usage:acceptedUsage});
          return {ok:true,output,providerId:p.providerId,modelId:model.modelId,position,usage:acceptedUsage,requests:calls,attempts};
        }catch(error){
          failureCode=callerSignal?.aborted?'REQUEST_CANCELLED':attemptSignal.aborted?'PROVIDER_TIMEOUT':error instanceof AiProviderError?error.code:'PROVIDER_UNAVAILABLE';
          if(failureCode!=='REQUEST_CANCELLED'){h.failures++;h.state='DEGRADED';if(probe || h.failures>=policy.circuitThreshold || failureCode==='PROVIDER_AUTH_FAILED'){h.openUntil=Date.now()+policy.circuitCooldownMs;h.state='UNAVAILABLE';}}
          record({...base,attempt:calls,latencyMs:performance.now()-began,status:'FAILED',failure:failureCode,usage:null});
        }finally{h.active--;h.halfOpen=false;}
        if(callerSignal?.aborted)throw new AiProviderError('REQUEST_CANCELLED');
        if(!failureCode || !transient.has(failureCode) || h.openUntil || retry===policy.retries)break;
        if(policy.backoffMs)await delay(policy.backoffMs*2**retry,signal);
      }
      if(calls>=policy.maxAttempts || signal.aborted)break;
    }
    return {ok:false,requests:calls,attempts};
  }
}
/** Settles even an uncooperative adapter; supported transports also abort their I/O. */
async function bounded<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  let abort:()=>void=()=>undefined;
  const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(new AiProviderError('PROVIDER_TIMEOUT'));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
  try{return await Promise.race([promise,cancelled]);}finally{signal.removeEventListener('abort',abort);}
}

async function delay(ms:number,signal:AbortSignal){
  if(signal.aborted)return;
  await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});});
}
