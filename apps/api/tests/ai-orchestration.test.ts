import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AiPolicySchema, AiProviderError, AiProviderSchema, type AiFailureCode } from '../src/contracts/ai-orchestration.js';
import { AiOrchestrator } from '../src/ai/orchestration/orchestrator.js';
import { ConversationIntentSchema, ConversationMessageSchema } from '../src/contracts/conversations.js';
import { AI_CAPABILITIES, type AiAdapter, type AiRequest } from '../src/ai/orchestration/registry.js';
import { publicAddresses, validateRemoteEndpoint, validateCredential, parseCompletion } from '../src/ai/orchestration/transport.js';
import { configuredAdapters, orchestratedConversation } from '../src/ai/orchestration/conversation.js';
import { validateInferenceEndpoint } from '../src/ai/conversation-provider.js';
import { createConversationOrchestrator } from '../src/config/ai.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { initialConversation, planConversation } from '../src/ai/conversation-planner.js';

const capability='ARCHITECTURAL_INTENT_EXTRACTION' as const;
const fallback=ConversationIntentSchema.parse({bedrooms:3});
const req=(patch:Partial<AiRequest>={}):AiRequest=>({requestId:randomUUID(),capability,text:'three sleeping chambers',context:{intent:ConversationIntentSchema.parse({}),questions:[]},privacyClass:'LOCAL_ONLY',maxOutputTokens:512,timeoutMs:1000,structuredOutput:true,...patch});
const provider=(providerId='local',patch:Record<string,unknown>={})=>AiProviderSchema.parse({providerId,type:'LOCAL_OPENAI_COMPATIBLE',enabled:true,capabilities:[capability],models:[{modelId:'model',capabilities:[capability]}],...patch});
const adapter=(output:unknown={bedrooms:4}):AiAdapter=>({execute:vi.fn(async()=>({output,finishReason:'stop' as const}))});
const failure=(code:AiFailureCode):AiAdapter=>({execute:vi.fn(async()=>{throw new AiProviderError(code);})});
const make=(adapters:Record<string,AiAdapter>,patch:Record<string,unknown>={})=>new AiOrchestrator(AiPolicySchema.parse({providers:Object.keys(adapters).map(id=>provider(id)),backoffMs:0,...patch}),new Map(Object.entries(adapters)));

describe('Phase 21 deterministic routing, failure policy and privacy',()=>{
  it('selects local; records actual identity, unknown usage and successful health',async()=>{
    const a=adapter(),o=make({local:a});const r=await o.interpret(req(),fallback);
    expect(r.intent.bedrooms).toBe(4);expect(r.provenance).toMatchObject({providerId:'local',modelId:'model',fallbackPosition:0,status:'SUCCESS',usage:{totalTokens:null,estimatedCostUsd:null}});expect(o.status()[0]).toMatchObject({state:'AVAILABLE',active:0});
  });
  it('orders providers and models reproducibly independent of insertion order',()=>{
    const a=adapter(),policy={providers:[provider('z',{priority:5}),provider('b',{priority:1}),provider('a',{priority:1,models:[{modelId:'z',priority:2,capabilities:[capability]},{modelId:'a',priority:1,capabilities:[capability]}]})]};
    expect(make({z:a,b:a,a:a},policy).routes(req()).map(r=>[r.route.provider.config.providerId,r.route.model.modelId])).toEqual([['a','a'],['a','z'],['b','model'],['z','model']]);
  });
  it('falls back to a secondary allowed remote provider and accounts configured cost',async()=>{
    const a=failure('PROVIDER_UNAVAILABLE'),b=adapter();b.execute=vi.fn(async()=>({output:{bedrooms:4},finishReason:'stop' as const,usage:{inputTokens:100,outputTokens:20,totalTokens:120,estimatedCostUsd:999}}));
    const o=make({a,b},{retries:0,privacyClass:'REMOTE_ALLOWED',allowMetered:true,providers:[provider('a'),provider('b',{type:'REMOTE_OPENAI_COMPATIBLE',models:[{modelId:'remote',capabilities:[capability],privacyClass:'REMOTE_ALLOWED',costClass:'METERED',inputUsdPerMillion:1,outputUsdPerMillion:2}]})]});
    const r=await o.interpret(req({privacyClass:'REMOTE_ALLOWED'}),fallback);expect(r.provenance).toMatchObject({providerId:'b',fallbackPosition:1,routingReason:'SECONDARY',usage:{estimatedCostUsd:0.00014}});expect(r.provenance.attempts).toHaveLength(2);
  });
  it.each(['LOCAL_ONLY','REMOTE_ALLOWED'] as const)('never contacts remote when system or request is LOCAL_ONLY (%s)',async privacyClass=>{
    const a=adapter(),o=make({a},{privacyClass,providers:[provider('a',{type:'REMOTE_OPENAI_COMPATIBLE',models:[{modelId:'remote',capabilities:[capability],privacyClass:'REMOTE_ALLOWED'}]})]});
    const r=await o.interpret(req({privacyClass:privacyClass==='LOCAL_ONLY'?'REMOTE_ALLOWED':'LOCAL_ONLY'}),fallback);expect(a.execute).not.toHaveBeenCalled();expect(r.provenance.attempts[0]?.failure).toBe('PROVIDER_POLICY_REJECTED');expect(r.intent).toEqual(fallback);
  });
  it.each([
    ['disabled',{enabled:false},'PROVIDER_DISABLED'],
    ['model disabled',{models:[{modelId:'x',enabled:false,capabilities:[capability]}]},'MODEL_UNAVAILABLE'],
    ['capability',{capabilities:['EXPLANATION']},'CAPABILITY_UNSUPPORTED'],
    ['model capability',{models:[{modelId:'x',capabilities:['EXPLANATION']}]},'CAPABILITY_UNSUPPORTED'],
    ['structured output',{models:[{modelId:'x',structuredOutput:false,capabilities:[capability]}]},'PROVIDER_POLICY_REJECTED'],
    ['cost',{models:[{modelId:'x',costClass:'METERED',capabilities:[capability]}]},'PROVIDER_POLICY_REJECTED'],
    ['context',{models:[{modelId:'x',contextBytes:256,capabilities:[capability]}]},'PROVIDER_POLICY_REJECTED'],
  ])('skips %s before calling any adapter',async(_name,patch,code)=>{
    const a=adapter(),o=make({a},{providers:[provider('a',patch as Record<string,unknown>)]});const r=await o.interpret(req({text:'x'.repeat(300)}),fallback);expect(a.execute).not.toHaveBeenCalled();expect(r.provenance.attempts[0]?.failure).toBe(code);
  });
  it('keeps future capabilities explicitly unavailable',async()=>{
    // Phase 39 makes the two design-concept tasks operational; they are typed tasks (run), never routed through intent interpretation.
    expect(AI_CAPABILITIES.filter(c=>c.status==='AVAILABLE').map(c=>c.capability)).toEqual([capability,'INTERIOR_DESIGN_CONCEPT','EXTERIOR_DESIGN_CONCEPT']);const a=adapter();await expect(make({a}).interpret(req({capability:'ENGINEERING_ASSISTANCE'}),fallback)).rejects.toMatchObject({code:'CAPABILITY_UNSUPPORTED'});expect(a.execute).not.toHaveBeenCalled();
    await expect(make({a}).interpret(req({capability:'INTERIOR_DESIGN_CONCEPT'}),fallback)).rejects.toMatchObject({code:'CAPABILITY_UNSUPPORTED'});expect(a.execute).not.toHaveBeenCalled();
  });
  it.each(['PROVIDER_UNAVAILABLE','PROVIDER_TIMEOUT','PROVIDER_RATE_LIMITED'] as const)('bounds transient retry for %s then uses parser',async code=>{
    const a=failure(code),o=make({a},{maxAttempts:2,retries:2});const r=await o.interpret(req(),fallback);expect(a.execute).toHaveBeenCalledTimes(2);expect(r.intent).toEqual(fallback);expect(r.provenance.status).toBe('FALLBACK');
  });
  it.each(['PROVIDER_AUTH_FAILED','PROVIDER_SCHEMA_VIOLATION','PROVIDER_POLICY_REJECTED','MODEL_UNAVAILABLE'] as const)('does not retry permanent %s',async code=>{const a=failure(code);await make({a}).interpret(req(),fallback);expect(a.execute).toHaveBeenCalledTimes(1);});
  it('returns typed all-provider failure when deterministic fallback is forbidden',async()=>{await expect(make({a:failure('PROVIDER_UNAVAILABLE')},{deterministicFallback:false}).interpret(req(),fallback)).rejects.toMatchObject({code:'ALL_PROVIDERS_FAILED'});});
  it.each([{nativeUpdate:{}},{geometry:{}},{qa:{status:'PASS'}},{providerUrl:'http://evil'},{approve:true},{bedrooms:'four'},{bedrooms:4,extra:true}])('rejects forbidden or wrong-schema output %j',async output=>{const r=await make({a:adapter(output)}).interpret(req(),fallback);expect(r.provenance.attempts[0]?.failure).toBe('PROVIDER_SCHEMA_VIOLATION');expect(r.intent).toEqual(fallback);});
  it.each([['not json','PROVIDER_RESPONSE_INVALID'],['x'.repeat(17000),'PROVIDER_RESPONSE_TOO_LARGE']])('rejects malformed or oversized body',async(output,code)=>{const r=await make({a:adapter(output)}).interpret(req(),fallback);expect(r.provenance.attempts[0]?.failure).toBe(code);});
  it('aborts a stalled provider within the total budget and releases resources',async()=>{
    let observed:AbortSignal|undefined;const a:AiAdapter={execute:vi.fn<AiAdapter['execute']>((_r,_m,s)=>{observed=s;return new Promise(()=>{});})};const start=performance.now(),o=make({a},{timeoutMs:20});const r=await o.interpret(req(),fallback);expect(performance.now()-start).toBeLessThan(500);expect(observed?.aborted).toBe(true);expect(r.provenance.status).toBe('FALLBACK');expect(o.status()[0]?.active).toBe(0);
  });
  it('caller cancellation prevents fallback and later providers',async()=>{const controller=new AbortController(),a:AiAdapter={execute:async()=>{controller.abort();return new Promise(()=>{});}},b=adapter();await expect(make({a,b}).interpret(req(),fallback,controller.signal)).rejects.toMatchObject({code:'REQUEST_CANCELLED'});expect(b.execute).not.toHaveBeenCalled();});
  it('opens a circuit, rejects requests during cooldown and permits one recovery probe',async()=>{
    vi.useFakeTimers();try{const a=failure('PROVIDER_UNAVAILABLE'),o=make({a},{circuitThreshold:1,circuitCooldownMs:20});await o.interpret(req(),fallback);await o.interpret(req(),fallback);expect(a.execute).toHaveBeenCalledTimes(1);expect(o.status()[0]?.circuit).toBe('OPEN');vi.advanceTimersByTime(21);a.execute=vi.fn(async()=>({output:{bedrooms:2},finishReason:'stop' as const}));expect((await o.interpret(req(),fallback)).intent.bedrooms).toBe(2);expect(o.status()[0]?.circuit).toBe('CLOSED');}finally{vi.useRealTimers();}
  });
  it('enforces concurrency without queues and a per-minute request quota',async()=>{
    let release!:(v:{output:unknown;finishReason:'stop'})=>void;const a:AiAdapter={execute:vi.fn<AiAdapter['execute']>(()=>new Promise(resolve=>{release=resolve;}))};const o=make({a},{providers:[provider('a',{maxConcurrent:1,requestsPerMinute:1})]});const first=o.interpret(req(),fallback);const second=await o.interpret(req(),fallback);expect(second.provenance.status).toBe('FALLBACK');expect(a.execute).toHaveBeenCalledTimes(1);release({output:{bedrooms:4},finishReason:'stop'});await first;await o.interpret(req(),fallback);expect(a.execute).toHaveBeenCalledTimes(1);
  });
  it('isolates adapter mutation and observer exceptions from caller intent',async()=>{const r=req();const a:AiAdapter={execute:async request=>{(request.context.intent as Record<string,unknown>).bedrooms=99;return {output:{bedrooms:4},finishReason:'stop'};}};const o=new AiOrchestrator(AiPolicySchema.parse({providers:[provider('a')]}),new Map([['a',a]]),()=>{throw new Error('observer');});await o.interpret(r,fallback);expect(r.context.intent).not.toHaveProperty('bedrooms');});
});

describe('Phase 21 security and configuration',()=>{
  it.each(['http://localhost/v1/chat/completions','http://127.0.0.1.evil/v1/chat/completions','http://user:secret@127.0.0.1/v1/chat/completions','http://127.0.0.1/v1/chat/completions?key=x','http://127.0.0.1/v1/chat/completions#x','file:///v1/chat/completions','http://169.254.169.254/v1/chat/completions'])('rejects unsafe local endpoint %s',url=>expect(()=>validateInferenceEndpoint(url)).toThrow());
  it.each(['http://api.example.com/v1/chat/completions','https://api.example.com:8443/v1/chat/completions','https://user:secret@api.example.com/v1/chat/completions','https://api.example.com/v1/chat/completions?key=x','https://api.example.com/v1/chat/completions#x','https://evil.com/v1/chat/completions','https://127.0.0.1/v1/chat/completions','https://api.example.com/other','https://api.example.com./v1/chat/completions'])('rejects remote bypass %s',url=>expect(()=>validateRemoteEndpoint(url,['api.example.com'])).toThrow());
  it.each(['127.0.0.1','10.0.0.1','169.254.169.254','100.100.100.200','192.168.1.1','172.16.1.1','0.0.0.0','::ffff:127.0.0.1','::1','198.18.0.1','224.0.0.1'])('rejects private/reserved/rebinding DNS answer %s',ip=>expect(()=>publicAddresses(['8.8.8.8',ip])).toThrow());
  it('accepts only allowlisted remote hosts and globally routable IPv4 answers',()=>{expect(validateRemoteEndpoint('https://api.example.com/v1/chat/completions',['api.example.com']).hostname).toBe('api.example.com');expect(publicAddresses(['8.8.8.8'])).toEqual(['8.8.8.8']);});
  it.each(['secret\r\nX-Injection: true','secret\u0000','', 'x'.repeat(513)])('rejects malformed credentials',key=>expect(()=>validateCredential(key)).toThrow());
  it.each(['endpoint','provider','model','modelPolicy','privacyClass','context','apiKey'])('rejects client control over %s',field=>expect(ConversationMessageSchema.safeParse({messageId:randomUUID(),expectedVersion:0,baseRevisionId:null,text:'brief',[field]:'unsafe'}).success).toBe(false));
  it.each(['length','tool_calls','content_filter',null])('rejects incomplete/unsafe completion finish reason %s',reason=>expect(()=>parseCompletion(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:reason}]}))).toThrow());
  it('rejects tool calls, function calls and negative token usage',()=>{for(const message of [{content:'{}',tool_calls:[]},{content:'{}',function_call:{} }])expect(()=>parseCompletion(JSON.stringify({choices:[{message,finish_reason:'stop'}]}))).toThrow();expect(()=>parseCompletion(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'stop'}],usage:{prompt_tokens:-1}}))).toThrow();});
  it('fails invalid server configuration without reflecting secrets, and tolerates disabled providers',()=>{
    const base={SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_ANON_KEY:'fixture'};expect(()=>parseEnv({...base,AI_ROUTING_CONFIG:'{"secret":"private-value"}'})).toThrow('Invalid AI routing configuration');
    const env=parseEnv({...base,AI_ROUTING_CONFIG:JSON.stringify({providers:[provider('disabled',{enabled:false,endpoint:'invalid',apiKeyEnv:'AI_PROVIDER_DISABLED_API_KEY'})]})});expect(()=>createConversationOrchestrator(env)).not.toThrow();
    const p=AiPolicySchema.parse({providers:[provider('a',{endpoint:'http://evil/v1/chat/completions'})]});expect(()=>configuredAdapters(p,{})).toThrow();
  });
  it('redacts provider credentials, configuration and private context',()=>{
    let log='';const logger=createLogger(parseEnv({SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_ANON_KEY:'fixture'}),{write:chunk=>{log+=String(chunk);}});logger.info({AI_PROVIDER_CUSTOM_API_KEY:'private-key',AI_ROUTING_CONFIG:'private-config',context:{intent:'private-intent'},authorization:'private-jwt',providerId:'safe'},'route');expect(log).not.toMatch(/private-(key|config|intent|jwt)/);expect(log).toContain('safe');
  });
  it('preserves deterministic relative moves and native replacement with advisory models',async()=>{
    const p=orchestratedConversation(AiPolicySchema.parse({providers:[provider('a')]}),new Map([['a',adapter({upperFloorBedrooms:1})]]));
    const msg=(text:string)=>({messageId:randomUUID(),expectedVersion:0,baseRevisionId:null,text});
    let s=await planConversation(initialConversation(null,null,false),msg('30 by 50 feet 3BHK two floors'),{provider:p});s=await planConversation(s,msg('Move one bedroom upstairs'),{provider:p});s=await planConversation(s,msg('seed kept'),{provider:p});expect(s.pendingBedroomMove).toBe(true);expect(s.proposal).toBeNull();s=await planConversation(s,msg('Put two bedrooms upstairs'),{provider:p});expect(s.proposal).not.toBeNull();expect((s.requirements as Exclude<typeof s.requirements, { program: unknown }>)?.rooms.find(r=>r.type==='bedroom'&&r.level===1)?.count).toBe(2);
  });
});

it('retains deterministic fallback when context exceeds a provider budget',async()=>{
  const a=adapter(),o=make({a});const r=await o.interpret(req({text:'x'.repeat(4000),context:{intent:ConversationIntentSchema.parse({}),questions:Array.from({length:24},()=> '房'.repeat(300))}}),fallback);
  expect(r.intent).toEqual(fallback);expect(a.execute).not.toHaveBeenCalled();expect(r.provenance.attempts[0]?.failure).toBe('PROVIDER_POLICY_REJECTED');
});
it('rejects malformed internal request contracts before adapters run',async()=>{
  const a=adapter();await expect(make({a}).interpret({...req(),endpoint:'http://evil'} as AiRequest,fallback)).rejects.toMatchObject({code:'PROVIDER_POLICY_REJECTED'});expect(a.execute).not.toHaveBeenCalled();
});
it('PUBLIC_NON_SENSITIVE system policy cannot route private remote-allowed context',async()=>{
  const a=adapter(),o=make({a},{privacyClass:'PUBLIC_NON_SENSITIVE',providers:[provider('a',{type:'REMOTE_OPENAI_COMPATIBLE',models:[{modelId:'remote',capabilities:[capability],privacyClass:'REMOTE_ALLOWED'}]})]});await o.interpret(req({privacyClass:'REMOTE_ALLOWED'}),fallback);expect(a.execute).not.toHaveBeenCalled();
});
it('permits exactly one half-open circuit probe while other requests fall back',async()=>{
  const a=failure('PROVIDER_UNAVAILABLE'),o=make({a},{circuitThreshold:1,circuitCooldownMs:1});await o.interpret(req(),fallback);await new Promise(resolve=>setTimeout(resolve,5));
  let release!:(value:{output:unknown;finishReason:'stop'})=>void;a.execute=vi.fn<AiAdapter['execute']>(()=>new Promise(resolve=>{release=resolve;}));
  const probe=o.interpret(req(),fallback);expect(o.status()[0]?.circuit).toBe('HALF_OPEN');const other=await o.interpret(req(),fallback);expect(other.provenance.status).toBe('FALLBACK');expect(a.execute).toHaveBeenCalledTimes(1);release({output:{bedrooms:4},finishReason:'stop'});await probe;expect(o.status()[0]?.circuit).toBe('CLOSED');
});
