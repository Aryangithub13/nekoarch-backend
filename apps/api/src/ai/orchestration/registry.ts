import { AiCapabilitySchema, AiPolicySchema, type AiCapability, type AiPolicy, type AiModel, type AiProviderConfig, type AiUsage } from '../../contracts/ai-orchestration.js';

export const AI_CAPABILITIES = Object.freeze(AiCapabilitySchema.options.map(capability => Object.freeze({ capability, status: capability === 'ARCHITECTURAL_INTENT_EXTRACTION' ? 'AVAILABLE' as const : 'PLANNED' as const, advisory: true as const })));
export interface AiRequest {
  requestId: string;
  capability: AiCapability;
  text: string;
  context: { intent: unknown; questions: string[] };
  privacyClass: AiPolicy['privacyClass'];
  maxOutputTokens: number;
  timeoutMs: number;
  structuredOutput: true;
}
export interface AiAdapterResponse { output: unknown; usage?: AiUsage; finishReason: 'stop' }
export interface AiAdapter {
  execute(request: AiRequest, model: AiModel, signal: AbortSignal): Promise<AiAdapterResponse>;
}
export interface RegisteredProvider { config: AiProviderConfig; adapter: AiAdapter }
export interface ModelRoute { provider: RegisteredProvider; model: AiModel; position: number }
export function createRegistry(policy: AiPolicy, adapters: ReadonlyMap<string, AiAdapter>) {
  const parsed = AiPolicySchema.parse(policy);
  const providers: RegisteredProvider[] = parsed.providers.map(config => ({config, adapter: adapters.get(config.providerId) ?? { async execute() { throw new Error('Adapter unavailable'); } }}));
  return { policy: parsed, providers, models: providers.flatMap(provider => provider.config.models.map(model => ({provider, model}))) };
}
