import { randomUUID } from 'node:crypto';
import { AiPolicySchema, AiProviderError, type AiPolicy, type AiFailureCode, type AiAttempt } from '../../contracts/ai-orchestration.js';
import { CONVERSATION_LIMITS, type ConversationIntent } from '../../contracts/conversations.js';
import { createLocalInferenceProvider, INTENT_SYSTEM_PROMPT, type ConversationProvider } from '../conversation-provider.js';
import { InterpreterProviderError } from '../interpreter-provider.js';
import { AiOrchestrator } from './orchestrator.js';
import type { AiAdapter } from './registry.js';
import { parseCompletion, remoteCompletion, validateRemoteEndpoint, validateCredential } from './transport.js';

const codes:Record<string,AiFailureCode>={AI_PROVIDER_TIMEOUT:'PROVIDER_TIMEOUT',AI_PROVIDER_RATE_LIMITED:'PROVIDER_RATE_LIMITED',AI_PROVIDER_AUTHENTICATION_FAILED:'PROVIDER_AUTH_FAILED',AI_PROVIDER_INVALID_RESPONSE:'PROVIDER_RESPONSE_INVALID',AI_CONFIGURATION_UNAVAILABLE:'PROVIDER_DISABLED'};
export function localAdapter(provider:ConversationProvider):AiAdapter {
  return {async execute(request,_model,signal){
    try {
      const context=request.context as {intent:ConversationIntent;questions:string[]};
      if(provider.interpretWithUsage){const result=await provider.interpretWithUsage(request.text,context,signal);return {output:result.intent,usage:result.usage,finishReason:'stop'};}
      return {output:await provider.interpret(request.text,context,signal),finishReason:'stop'};
    }catch(error){if(error instanceof InterpreterProviderError)throw new AiProviderError(codes[error.code]??'PROVIDER_UNAVAILABLE');throw error;}
  }};
}
export function configuredAdapters(policy:AiPolicy,credentials:Readonly<Record<string,string>>,override?:ConversationProvider):Map<string,AiAdapter>{
  const adapters=new Map<string,AiAdapter>();
  for(const p of policy.providers){
    if(!p.enabled)continue;
    if(!p.endpoint)throw new AiProviderError('PROVIDER_POLICY_REJECTED');
    const key=p.apiKeyEnv?credentials[p.apiKeyEnv]:undefined;
    if(p.apiKeyEnv && !key)throw new AiProviderError('PROVIDER_AUTH_FAILED');
    validateCredential(key);
    if(p.type==='LOCAL_OPENAI_COMPATIBLE'){
      // Validate even before the first request; per-call output budget is then clamped.
      for(const m of p.models)createLocalInferenceProvider({endpoint:p.endpoint,model:m.modelId,timeoutMs:p.timeoutMs,maxTokens:m.maxOutputTokens,...(key?{apiKey:key}:{})});
      adapters.set(p.providerId,{execute:(r,m,s)=>localAdapter(override??createLocalInferenceProvider({endpoint:p.endpoint!,model:m.modelId,timeoutMs:p.timeoutMs,maxTokens:Math.min(r.maxOutputTokens,m.maxOutputTokens),...(key?{apiKey:key}:{})})).execute(r,m,s)});
    }else{
      const url=validateRemoteEndpoint(p.endpoint,policy.allowedRemoteHosts);
      adapters.set(p.providerId,{async execute(r,m,s){
        const body=JSON.stringify({model:m.modelId,stream:false,temperature:0,max_tokens:Math.min(r.maxOutputTokens,m.maxOutputTokens),response_format:{type:'json_object'},messages:[{role:'system',content:INTENT_SYSTEM_PROMPT},{role:'user',content:JSON.stringify({text:r.text,context:r.context})}]});
        return parseCompletion(await remoteCompletion(url,body,key,s));
      }});
    }
  }
  return adapters;
}
export function orchestratedConversation(policy:AiPolicy,adapters:ReadonlyMap<string,AiAdapter>,observe?:(event:AiAttempt&{requestId:string})=>void):ConversationProvider & {orchestrator:AiOrchestrator}{
  const parsed=AiPolicySchema.parse(policy), orchestrator=new AiOrchestrator(parsed,adapters,observe);
  return {kind:'orchestrated',model:'server-policy',orchestrator,capabilities:{structuredOutput:true,supportsTools:false,maxContextBytes:CONVERSATION_LIMITS.contextBytes},
    async interpret(){throw new AiProviderError('PROVIDER_POLICY_REJECTED');},
    async orchestrate(text,context,deterministic,signal){return orchestrator.interpret({requestId:randomUUID(),capability:'ARCHITECTURAL_INTENT_EXTRACTION',text,context,privacyClass:parsed.privacyClass,maxOutputTokens:2048,timeoutMs:parsed.timeoutMs,structuredOutput:true},deterministic,signal);},
  };
}
