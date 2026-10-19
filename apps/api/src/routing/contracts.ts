import { z } from 'zod';
import { AiCapabilitySchema, AiPrivacySchema } from '../contracts/ai-orchestration.js';

/**
 * B43 S1 (ROADMAP L355–372): a vendor-neutral registry of the roadmap's capability ids, each tied to what actually implements it in this backend
 * (a deterministic local service, a configured provider capability, or nothing), and an inspectable routing dry run: for a target scope, the bounded
 * set of capabilities that would be invoked and why every other one would not. No provider is called and no secret, endpoint or key is ever returned.
 */
export const ROUTING_VERSION = 'capability-routing-v1';
export const ROUTING_CAPABILITIES_ROUTE = '/api/routing/capabilities';
export const ROUTING_DECISIONS_ROUTE = '/api/projects/:projectId/routing/decisions';

/** ROADMAP L364 capability ids, plus the two deterministic engines every plan depends on. */
export const CAPABILITY_IDS = ['llm.intent', 'image.reference', 'image.exterior', 'interior.design', 'geometry.3d', 'cad.ifc', 'structural.solve', 'environmental.simulate',
  'cost.rate_source', 'report.compose', 'quantity.takeoff', 'geometry.verify'] as const;
export type CapabilityId = typeof CAPABILITY_IDS[number];
export const CAPABILITY_STATUSES = ['AVAILABLE', 'PARTIAL', 'ADVISORY', 'UNSUPPORTED'] as const;

const ProviderSchema = z.object({ providerId: z.string().max(64), placement: z.enum(['LOCAL', 'REMOTE']), enabled: z.boolean(), costClasses: z.array(z.enum(['FREE', 'METERED'])).max(2),
  /** Policy eligibility for the default privacy class (static: live health and request size are decided per request by the orchestrator). */
  eligible: z.boolean(), ineligibleReason: z.string().max(80).nullable() }).strict();
export const CapabilityEntrySchema = z.object({
  capabilityId: z.enum(CAPABILITY_IDS), status: z.enum(CAPABILITY_STATUSES), title: z.string().max(120),
  implementation: z.object({ kind: z.enum(['LOCAL_DETERMINISTIC', 'CONFIGURED_PROVIDER', 'LOCAL_WITH_OPTIONAL_PROVIDER', 'NONE']), serviceId: z.string().max(64).nullable(),
    route: z.string().max(200).nullable(), aiCapability: AiCapabilitySchema.nullable() }).strict(),
  providers: z.array(ProviderSchema).max(8),
  /** What data leaves the server when this capability runs. */
  dataEgress: z.enum(['NONE', 'TASK_TEXT_TO_CONFIGURED_PROVIDER']),
  region: z.enum(['SERVER_LOCAL', 'PROVIDER_REGION_NOT_DECLARED']),
  costBasis: z.enum(['LOCAL_NO_EXTERNAL_COST', 'METERED_PROVIDER_IF_ALLOWED', 'NOT_AVAILABLE']),
  /** How an output is checked before it is accepted (independent of the producer). */
  outputCheck: z.string().max(300), fallback: z.string().max(200).nullable(), limitations: z.string().max(300),
  userSuppliedCredentials: z.literal('UNSUPPORTED'),
}).strict();
export type CapabilityEntry = z.infer<typeof CapabilityEntrySchema>;
export const CapabilityRegistrySchema = z.object({ routingVersion: z.literal(ROUTING_VERSION), defaultPrivacyClass: AiPrivacySchema, allowMetered: z.boolean(),
  capabilities: z.array(CapabilityEntrySchema).length(CAPABILITY_IDS.length),
  credentials: z.object({ userSupplied: z.literal('UNSUPPORTED'), reason: z.string().max(300) }).strict() }).strict();

/** Target scopes a request can name; each maps to the minimal capabilities it needs. */
export const TARGET_SCOPES = ['FACADE_APPEARANCE', 'INTERIOR_FINISHES', 'FLOOR_PLAN', 'STRUCTURE', 'QUANTITIES', 'COST', 'ENVIRONMENT', 'SCENE_3D', 'IFC_EXPORT',
  'EVIDENCE_REPORT', 'INTENT_TEXT', 'EXTERIOR_RENDER', 'INTERIOR_RENDER', 'REFERENCE_IMAGE'] as const;
export const RoutingParamsSchema = z.object({ projectId: z.string().uuid() }).strict();
export const RoutingRequestSchema = z.object({
  targetScopes: z.array(z.enum(TARGET_SCOPES)).min(1).max(TARGET_SCOPES.length).transform(s => [...new Set(s)]),
  /** May only narrow the server policy (never widen it): REMOTE_ALLOWED under a LOCAL_ONLY policy stays LOCAL_ONLY. */
  privacyClass: AiPrivacySchema.default('LOCAL_ONLY'),
  allowMetered: z.boolean().default(false),
}).strict();
export type RoutingRequest = z.infer<typeof RoutingRequestSchema>;
export const RoutingDecisionSchema = z.object({
  routingVersion: z.literal(ROUTING_VERSION), projectId: z.string().uuid(), decisionHash: z.string().regex(/^[a-f0-9]{64}$/),
  targetScopes: z.array(z.enum(TARGET_SCOPES)), effectivePrivacyClass: AiPrivacySchema, effectiveAllowMetered: z.boolean(),
  invoke: z.array(z.object({ capabilityId: z.enum(CAPABILITY_IDS), forScopes: z.array(z.enum(TARGET_SCOPES)).max(TARGET_SCOPES.length),
    execution: z.enum(['LOCAL_DETERMINISTIC', 'PROVIDER_THEN_DETERMINISTIC_FALLBACK', 'PROVIDER_ONLY']), providerIds: z.array(z.string().max(64)).max(8),
    route: z.string().max(200).nullable(), reason: z.string().max(300) }).strict()).max(CAPABILITY_IDS.length),
  notInvoked: z.array(z.object({ capabilityId: z.enum(CAPABILITY_IDS), reason: z.enum(['NOT_TARGETED', 'UNSUPPORTED', 'NO_ELIGIBLE_PROVIDER']), detail: z.string().max(300) }).strict())
    .max(CAPABILITY_IDS.length),
  /** Targets that cannot be served; never silently replaced by another capability. */
  refused: z.array(z.object({ scope: z.enum(TARGET_SCOPES), code: z.string().max(80), detail: z.string().max(300) }).strict()).max(TARGET_SCOPES.length),
  /** Outputs a change to these targets would make stale (B37); flagged for the plan, never recomputed by routing. */
  staleIfChanged: z.array(z.string().max(80)).max(24),
  /** Zero only when no metered provider is eligible; otherwise unknown (null) until token counts exist. Never a guessed price. */
  quote: z.object({ externalCostUsd: z.union([z.literal(0), z.null()]), meteredProvidersEligible: z.number().int().min(0), basis: z.string().max(300) }).strict(),
  executed: z.literal(false),
}).strict();
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;
