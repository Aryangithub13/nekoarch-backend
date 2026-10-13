import { z } from 'zod';
import { AiCapabilitySchema, AiPolicySchema, AiPrivacySchema, type AiAttempt, type AiCapability, type AiPolicy, type AiModel, type AiProviderConfig, type AiUsage } from '../../contracts/ai-orchestration.js';

/** Operational capabilities; every other name is PLANNED. Phase 39 adds the two advisory design-concept tasks (structured text, never images or geometry). */
const OPERATIONAL: readonly AiCapability[] = ['ARCHITECTURAL_INTENT_EXTRACTION', 'INTERIOR_DESIGN_CONCEPT', 'EXTERIOR_DESIGN_CONCEPT'];
export const AI_CAPABILITIES = Object.freeze(AiCapabilitySchema.options.map(capability => Object.freeze({ capability, status: OPERATIONAL.includes(capability) ? 'AVAILABLE' as const : 'PLANNED' as const, advisory: true as const })));
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
/**
 * Phase 39: a capability-typed task. `instructions` are server-owned constants; `context` is bounded data, never instructions.
 * The adapter sends both; the orchestrator, not the caller, picks the provider and model.
 */
export interface AiTaskRequest {
  requestId: string;
  capability: AiCapability;
  text: string;
  context: Record<string, unknown>;
  instructions: string;
  privacyClass: AiPolicy['privacyClass'];
  maxOutputTokens: number;
  timeoutMs: number;
  structuredOutput: true;
}
export const AiTaskRequestSchema = z.object({ requestId: z.string().uuid(), capability: AiCapabilitySchema, text: z.string().max(4000),
  context: z.record(z.unknown()), instructions: z.string().min(1).max(8000), privacyClass: AiPrivacySchema, maxOutputTokens: z.number().int().min(128).max(4096),
  timeoutMs: z.number().int().min(1).max(15000), structuredOutput: z.literal(true) }).strict();
/** Validates one parsed provider output. It throws AiProviderError (schema violation or unsafe output); it never repairs. */
export interface AiTask<T> { outputBytes: number; parse(raw: unknown): T }
export type AiDispatchResult<T> = ({ ok: true; output: T; providerId: string; modelId: string; position: number; usage: AiUsage } | { ok: false }) &
  { requests: number; attempts: AiAttempt[] };
export type AiTaskResult<T> = AiDispatchResult<T> & { latencyMs: number };
export interface AiAdapterResponse { output: unknown; usage?: AiUsage; finishReason: 'stop' }
export interface AiAdapter {
  execute(request: AiRequest | AiTaskRequest, model: AiModel, signal: AbortSignal): Promise<AiAdapterResponse>;
}
export interface RegisteredProvider { config: AiProviderConfig; adapter: AiAdapter }
export interface ModelRoute { provider: RegisteredProvider; model: AiModel; position: number }
export function createRegistry(policy: AiPolicy, adapters: ReadonlyMap<string, AiAdapter>) {
  const parsed = AiPolicySchema.parse(policy);
  const providers: RegisteredProvider[] = parsed.providers.map(config => ({config, adapter: adapters.get(config.providerId) ?? { async execute() { throw new Error('Adapter unavailable'); } }}));
  return { policy: parsed, providers, models: providers.flatMap(provider => provider.config.models.map(model => ({provider, model}))) };
}
