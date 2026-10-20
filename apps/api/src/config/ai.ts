import type { Env } from './env.js';
import { AiPolicySchema, type AiAttempt } from '../contracts/ai-orchestration.js';
import type { ConversationProvider } from '../ai/conversation-provider.js';
import { configuredAdapters, orchestratedConversation } from '../ai/orchestration/conversation.js';
import { createReplyComposer, type ReplyComposer } from '../ai/reply-composer.js';

export function createConversationOrchestrator(env:Env, override?:ConversationProvider, observe?:(event:AiAttempt&{requestId:string})=>void):ConversationProvider{
  if(override?.orchestrate)return override;
  const policy=AiPolicySchema.parse(env.AI_ROUTING_CONFIG);
  const credentials={...env.AI_PROVIDER_CREDENTIALS};
  // Preserve old environment names and local provider test injection.
  if(!policy.providers.length && (env.AI_CONVERSATION_MODE==='local' || override)){
    if(env.AI_CONVERSATION_API_KEY)credentials.AI_PROVIDER_LEGACY_API_KEY=env.AI_CONVERSATION_API_KEY;
    policy.providers=AiPolicySchema.parse({providers:[{providerId:'local-default',type:'LOCAL_OPENAI_COMPATIBLE',enabled:true,endpoint:env.AI_CONVERSATION_ENDPOINT??'http://127.0.0.1:9/v1/chat/completions',...(env.AI_CONVERSATION_API_KEY?{apiKeyEnv:'AI_PROVIDER_LEGACY_API_KEY'}:{}),capabilities:['ARCHITECTURAL_INTENT_EXTRACTION'],timeoutMs:Math.min(env.AI_INTERPRETER_TIMEOUT_MS,10000),models:[{modelId:override?.model??env.AI_CONVERSATION_MODEL,capabilities:['ARCHITECTURAL_INTENT_EXTRACTION'],maxOutputTokens:env.AI_INTERPRETER_MAX_OUTPUT_TOKENS}]}]}).providers;
  }
  // Disabled providers must not require endpoints, credentials or reachable services.
  if(env.AI_CONVERSATION_MODE==='disabled')policy.providers=[];
  return orchestratedConversation(policy,configuredAdapters(policy,credentials,override),observe);
}

/** Conversational replies use the same server-owned policy and credentials as intent extraction; null without a configured model. */
export function createConfiguredReplyComposer(env: Env): ReplyComposer | null {
  if (env.AI_CONVERSATION_MODE === 'disabled') return null;
  const policy = AiPolicySchema.parse(env.AI_ROUTING_CONFIG);
  if (!policy.providers.length) return null;
  return createReplyComposer(policy, env.AI_PROVIDER_CREDENTIALS);
}
