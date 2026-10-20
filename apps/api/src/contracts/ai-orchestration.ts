import { z } from 'zod';

export const AiCapabilitySchema = z.enum(['ARCHITECTURAL_INTENT_EXTRACTION', 'LANGUAGE_INTERPRETATION', 'REQUIREMENT_CLARIFICATION', 'EXPLANATION', 'REQUIREMENT_COMPARISON', 'IMAGE_CONCEPT_GENERATION', 'INTERIOR_VISUALIZATION', 'EXTERIOR_VISUALIZATION', 'MODEL_3D_GENERATION', 'DOCUMENT_ANALYSIS', 'ENGINEERING_ASSISTANCE',
  // Phase 39: advisory, structured design concepts (text and visual-preset choices only; never geometry, dimensions, costs or engineering).
  'INTERIOR_DESIGN_CONCEPT', 'EXTERIOR_DESIGN_CONCEPT']);
export type AiCapability = z.infer<typeof AiCapabilitySchema>;
export const AiFailureSchema = z.enum(['PROVIDER_DISABLED', 'PROVIDER_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'CAPABILITY_UNSUPPORTED', 'PROVIDER_TIMEOUT', 'PROVIDER_RATE_LIMITED', 'PROVIDER_AUTH_FAILED', 'PROVIDER_RESPONSE_INVALID', 'PROVIDER_RESPONSE_TOO_LARGE', 'PROVIDER_SCHEMA_VIOLATION', 'PROVIDER_POLICY_REJECTED', 'ALL_PROVIDERS_FAILED', 'REQUEST_CANCELLED',
  // Phase 39: the output parsed but a deterministic guard refused it (claims, dimensions, unknown entities). Never retried on the same route.
  'PROVIDER_OUTPUT_UNSAFE']);
export type AiFailureCode = z.infer<typeof AiFailureSchema>;
export const AiPrivacySchema = z.enum(['LOCAL_ONLY', 'REMOTE_ALLOWED', 'PUBLIC_NON_SENSITIVE']);
/** PROJECT_BRIEF: no design exists yet, so every stated requirement is extracted. MODIFICATION: only requested changes to an existing design. */
export const IntentModeSchema = z.enum(['PROJECT_BRIEF', 'MODIFICATION']);
export type IntentMode = z.infer<typeof IntentModeSchema>;
export const AiRequestSchema = z.object({
  requestId: z.string().uuid(), capability: AiCapabilitySchema,
  text: z.string().min(1).max(4000), context: z.object({intent:z.unknown(),questions:z.array(z.string().max(300)).max(24),mode:IntentModeSchema.optional()}).strict(),
  privacyClass: AiPrivacySchema, maxOutputTokens: z.number().int().min(128).max(4096), timeoutMs: z.number().int().min(1).max(15000), structuredOutput: z.literal(true),
}).strict();
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const modelName = z.string().regex(/^[A-Za-z0-9._:/-]{1,100}$/);
export const AiUsageSchema = z.object({ inputTokens: z.number().int().min(0).max(10000000).nullable(), outputTokens: z.number().int().min(0).max(10000000).nullable(), totalTokens: z.number().int().min(0).max(20000000).nullable(), estimatedCostUsd: z.number().finite().nonnegative().nullable() }).strict();
export const AiAttemptSchema = z.object({ providerId: identifier, modelId: modelName, capability: AiCapabilitySchema, routingReason: z.enum(['PREFERRED', 'SECONDARY', 'DETERMINISTIC']), fallbackPosition: z.number().int().min(0).max(16), attempt: z.number().int().min(0).max(6), latencyMs: z.number().finite().nonnegative(), status: z.enum(['SUCCESS', 'FAILED', 'SKIPPED']), failure: AiFailureSchema.nullable(), usage: AiUsageSchema.nullable() }).strict();
export const AiProvenanceSchema = z.object({ requestId: z.string().uuid(), capability: AiCapabilitySchema, privacyClass: AiPrivacySchema, providerId: identifier, modelId: modelName, routingReason: z.enum(['PREFERRED', 'SECONDARY', 'DETERMINISTIC']), fallbackPosition: z.number().int().min(0).max(16), latencyMs: z.number().finite().nonnegative(), status: z.enum(['SUCCESS', 'FALLBACK']), intentSource: z.enum(['PROVIDER', 'DETERMINISTIC']), requests: z.number().int().min(0).max(6), attempts: z.array(AiAttemptSchema).max(22), usage: AiUsageSchema.nullable() }).strict();
export type AiProvenance = z.infer<typeof AiProvenanceSchema>;
export type AiAttempt = z.infer<typeof AiAttemptSchema>;
export type AiUsage = z.infer<typeof AiUsageSchema>;
export const AiModelSchema = z.object({ modelId: modelName, enabled: z.boolean().default(true), capabilities: z.array(AiCapabilitySchema).min(1).max(13), contextBytes: z.number().int().min(256).max(12000).default(12000), maxOutputTokens: z.number().int().min(128).max(4096).default(2048), reasoningEffort: z.enum(['none', 'low', 'medium', 'high']).optional(), structuredOutput: z.boolean().default(true), supportsTools: z.literal(false).default(false), privacyClass: AiPrivacySchema.default('LOCAL_ONLY'), costClass: z.enum(['FREE', 'METERED']).default('FREE'), priority: z.number().int().min(0).max(100).default(50), inputUsdPerMillion: z.number().finite().nonnegative().max(10000).optional(), outputUsdPerMillion: z.number().finite().nonnegative().max(10000).optional() }).strict();
export type AiModel = z.infer<typeof AiModelSchema>;
export const AiProviderSchema = z.object({ providerId: identifier, type: z.enum(['LOCAL_OPENAI_COMPATIBLE', 'REMOTE_OPENAI_COMPATIBLE']), enabled: z.boolean().default(false), endpoint: z.string().max(512).optional(), apiKeyEnv: z.string().regex(/^AI_PROVIDER_[A-Z0-9_]+_API_KEY$/).optional(), capabilities: z.array(AiCapabilitySchema).min(1).max(13), priority: z.number().int().min(0).max(100).default(50), timeoutMs: z.number().int().min(1).max(10000).default(5000), maxConcurrent: z.number().int().min(1).max(32).default(2), requestsPerMinute: z.number().int().min(1).max(1000).default(60), models: z.array(AiModelSchema).min(1).max(8) }).strict();
export type AiProviderConfig = z.infer<typeof AiProviderSchema>;
export const AiPolicySchema = z.object({ privacyClass: AiPrivacySchema.default('LOCAL_ONLY'), allowMetered: z.boolean().default(false), deterministicFallback: z.boolean().default(true), timeoutMs: z.number().int().min(1).max(15000).default(10000), maxAttempts: z.number().int().min(1).max(6).default(3), retries: z.number().int().min(0).max(2).default(1), backoffMs: z.number().int().min(0).max(500).default(50), circuitThreshold: z.number().int().min(1).max(10).default(3), circuitCooldownMs: z.number().int().min(1).max(60000).default(10000), allowedRemoteHosts: z.array(z.string().regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/).max(253)).max(8).default([]), providers: z.array(AiProviderSchema).max(8).default([]) }).strict().superRefine((policy, ctx) => {
  const ids = new Set<string>(); let modelCount = 0;
  for (const p of policy.providers) {
    if (ids.has(p.providerId)) ctx.addIssue({code:'custom',message:'Duplicate provider identity'});
    ids.add(p.providerId); const models = new Set<string>();
    for (const m of p.models) { modelCount++; if (models.has(m.modelId)) ctx.addIssue({code:'custom',message:'Duplicate model identity'}); models.add(m.modelId); }
  }
  if (modelCount > 16) ctx.addIssue({code:'custom',message:'At most sixteen configured models'});
});
export type AiPolicy = z.infer<typeof AiPolicySchema>;
export class AiProviderError extends Error {
  constructor(readonly code: AiFailureCode) { super(code); this.name = 'AiProviderError'; }
}
