import { z } from 'zod';
import { CostingPolicySchema, CostOptionsSchema, CurrencySchema, RegionSchema } from '@designflow/boq-cost';
import { ConstructionOptionsSchema, ConstructionSpecificationSchema } from '@designflow/construction-calculations';
import { TakeoffOptionsSchema } from '@designflow/quantity-takeoff';
import { ChangeImpactSchema, FRESHNESS_STATES, MODULES } from './project-manifest.js';
import { GenerateRevisionRequestSchema } from './projects.js';

/**
 * B39 slice S1: the shared specialist request envelope (ROADMAP L288; contract semantics after §E L509–585), scoped in
 * `docs/phase39/b39-specialist-scope.md`. One envelope over the existing engines and their stored artifacts: nothing here is a new store, and every
 * status is derived from what the engine or the B37 manifest reports. S1 runs Blueprint, Materials and Budget; every other module is a typed refusal.
 */
export const SPECIALIST_VERSION = 'specialist-request-v1';
export const SPECIALIST_ROUTE = '/api/projects/:projectId/specialists/:module/requests';
export const SPECIALIST_MODULES = ['INTERIOR', 'EXTERIOR', 'BLUEPRINT', 'STRUCTURAL', 'MATERIALS', 'BUDGET'] as const;
export type SpecialistModule = typeof SPECIALIST_MODULES[number];
/** Modules this slice executes. The others answer UNSUPPORTED (scenario 46, L779) until their slice lands. */
export const S1_MODULES = ['BLUEPRINT', 'MATERIALS', 'BUDGET'] as const satisfies readonly SpecialistModule[];
/** §E L515–517, verbatim. */
export const SPECIALIST_OPERATIONS = ['modify', 'regenerate', 'generate_alternative', 'recompute', 'compare', 'restore'] as const;
/** §E L519–525, verbatim. */
export const COMPONENT_SCOPES = ['building.geometry', 'building.floor_plans', 'building.structure', 'exterior.facade', 'exterior.materials', 'exterior.render',
  'interior.layout', 'interior.materials', 'interior.render', 'bim', 'engineering.structural', 'engineering.environmental', 'engineering.mep', 'quantities',
  'cost', 'documents', 'scene3d', 'walkthrough'] as const;
export type ComponentScope = typeof COMPONENT_SCOPES[number];
/**
 * Typed outcomes (ROADMAP L293 plus the Phase 30 lifecycle names). S1 assigns COMPLETED, UNSUPPORTED, BLOCKED_BY_LOCK, STALE_DEPENDENCY, REQUIRES_REVIEW,
 * PARTIAL and FAILED. CANDIDATE_READY, AWAITING_CONSENT, NEEDS_CLARIFICATION and DEGRADED_PROVIDER are reserved for the model-changing and AI-assisted
 * modules of later slices and are never assigned here.
 */
export const SPECIALIST_STATUSES = ['COMPLETED', 'CANDIDATE_READY', 'AWAITING_CONSENT', 'NEEDS_CLARIFICATION', 'UNSUPPORTED', 'REQUIRES_REVIEW',
  'DEGRADED_PROVIDER', 'STALE_DEPENDENCY', 'PARTIAL', 'BLOCKED_BY_LOCK', 'FAILED'] as const;
export type SpecialistStatus = typeof SPECIALIST_STATUSES[number];
/**
 * Requested-room limit of every blueprint requirements version (rooms are per-type counts; the total may not exceed it). The API reaches the generator only
 * through its allowlisted boundary, so this mirrors BLUEPRINT_LIMITS.maxRooms and GENERATION_LIMITS.maxRooms and is pinned to both by a test.
 */
export const MAX_REQUESTED_ROOMS = 24;
/** The reported status is the most restrictive that applies; every reason is still listed. */
export const STATUS_PRECEDENCE: readonly SpecialistStatus[] = ['UNSUPPORTED', 'BLOCKED_BY_LOCK', 'STALE_DEPENDENCY', 'FAILED', 'REQUIRES_REVIEW', 'PARTIAL',
  'DEGRADED_PROVIDER', 'COMPLETED'];
/** What each S1 module may target; the scopes it rewrites (a preservation lock on any of them is refused before anything runs). */
export const MODULE_SCOPES = Object.freeze({
  BLUEPRINT: { operations: ['regenerate'], targets: ['building.floor_plans', 'building.geometry'], rewrites: COMPONENT_SCOPES },
  MATERIALS: { operations: ['recompute'], targets: ['quantities'], rewrites: ['quantities'] },
  BUDGET: { operations: ['recompute'], targets: ['cost'], rewrites: ['cost'] },
} as const satisfies Record<typeof S1_MODULES[number], { operations: readonly string[]; targets: readonly ComponentScope[]; rewrites: readonly ComponentScope[] }>);

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), text = z.string().min(1).max(200), scope = z.enum(COMPONENT_SCOPES);
export const SpecialistParamsSchema = z.object({ projectId: id, module: z.enum(SPECIALIST_MODULES) }).strict();
/** The envelope. `outputConfig` is checked against the module's own schema only once the module and operation are known to be supported. */
export const SpecialistRequestSchema = z.object({
  envelopeVersion: z.literal(SPECIALIST_VERSION), baseRevisionId: id, operation: z.enum(SPECIALIST_OPERATIONS),
  instruction: z.string().min(1).max(2000).optional(),
  targetScopes: z.array(scope).min(1).max(COMPONENT_SCOPES.length), preserveScopes: z.array(scope).max(COMPONENT_SCOPES.length).default([]),
  outputConfig: z.record(z.unknown()).default({}),
}).strict().superRefine((r, ctx) => {
  for (const [name, list] of [['targetScopes', r.targetScopes], ['preserveScopes', r.preserveScopes]] as const)
    if (new Set(list).size !== list.length) ctx.addIssue({ code: 'custom', path: [name], message: 'Duplicate scope' });
});
export type SpecialistRequest = z.infer<typeof SpecialistRequestSchema>;
/** The generation route's own requirements schema (the API reaches the generator only through its allowlisted boundary). */
export const BlueprintConfigSchema = z.object({ requirements: GenerateRevisionRequestSchema.shape.requirements }).strict();
/** `substitutions` is accepted only so that it can be refused by type: no substitution provenance exists (scope §4). */
export const MaterialsConfigSchema = z.object({ specification: ConstructionSpecificationSchema, takeoffOptions: TakeoffOptionsSchema.default({}),
  constructionOptions: ConstructionOptionsSchema.default({}), substitutions: z.array(z.object({ from: text, to: text }).strict()).min(1).max(16).optional() }).strict();
/** `rateBookId` is free text so that a request for a rate basis that does not exist is a typed refusal, not a validation error. */
export const BudgetConfigSchema = z.object({ takeoffId: id, constructionCalculationId: id, rateBookId: text, costingPolicy: CostingPolicySchema,
  options: CostOptionsSchema.default({}), region: RegionSchema.optional() }).strict();

/** §E L557–565: a stored artifact the request produced or read, with its freshness from the B37 manifest (never computed here). */
export const ArtifactReferenceSchema = z.object({ artifactId: id, logicalComponentId: z.enum(MODULES), sourceRevisionId: id, contentHash: hash,
  inputHash: hash, producerVersion: z.string().min(1).max(100), providerId: z.null(), freshness: z.enum(FRESHNESS_STATES).nullable() }).strict();
const ReasonSchema = z.object({ code: z.string().min(1).max(80), message: z.string().min(1).max(500) }).strict();
const BlueprintDetails = z.object({ kind: z.literal('BLUEPRINT'), generatorVersion: z.string().nullable(), qaStatus: z.string().max(40),
  /** null only when independent verification could not be run after the revision was stored (reason VERIFICATION_UNAVAILABLE). */
  verificationStatus: z.enum(['VERIFIED', 'VERIFIED_WITH_WARNINGS', 'PARTIAL', 'FAILED']).nullable(), renderJobs: z.literal(0) }).strict();
const MaterialsDetails = z.object({ kind: z.literal('MATERIALS'), takeoffStatus: z.enum(['EVALUATED', 'PARTIAL']),
  constructionStatus: z.enum(['EVALUATED', 'PARTIAL', 'NOT_EVALUATED']), recipePack: z.object({ id: text, version: text }).strict(),
  materials: z.array(z.object({ materialCode: text, unit: text, final: z.string().max(80) }).strict()).max(32) }).strict();
const BudgetDetails = z.object({ kind: z.literal('BUDGET'), rateBookId: text, rateBookVersion: text, rateBookSynthetic: z.boolean(), currency: CurrencySchema,
  region: RegionSchema, coverage: z.enum(['FULLY_PRICED', 'PARTIALLY_PRICED', 'NOT_PRICED']), unpricedLineIds: z.array(text).max(10_000),
  /** Never a complete total when anything is unpriced: `completeTotal` is null then, and `pricedTotal` covers priced lines only. */
  pricedTotal: z.string().max(80), completeTotal: z.string().max(80).nullable() }).strict();
const NoDetails = z.object({ kind: z.literal('NONE') }).strict();
export const SpecialistResultSchema = z.object({
  envelopeVersion: z.literal(SPECIALIST_VERSION), module: z.enum(SPECIALIST_MODULES), operation: z.enum(SPECIALIST_OPERATIONS),
  projectId: id, baseRevisionId: id, resultRevisionId: id.nullable(),
  status: z.enum(SPECIALIST_STATUSES), reasons: z.array(ReasonSchema).max(16),
  targetScopes: z.array(scope), preserveScopes: z.array(scope),
  /** true when this request stored something (a revision or an artifact); false for every refusal. */
  written: z.boolean(), replayed: z.boolean(),
  /** Phase 30 operation and durable jobs: none in S1 (no module here changes a model through Phase 30 or runs as a job). */
  operationId: z.null(), jobIds: z.array(id).max(0),
  artifacts: z.array(ArtifactReferenceSchema).max(8),
  details: z.discriminatedUnion('kind', [BlueprintDetails, MaterialsDetails, BudgetDetails, NoDetails]),
  /** Blueprint only: the B37 change since the parent revision, as the manifest reports it. */
  changeImpact: ChangeImpactSchema.nullable(),
  quote: z.object({ execution: z.enum(['LOCAL_DETERMINISTIC', 'NONE']), externalProviders: z.array(z.string()).max(0), externalCostUsd: z.literal(0),
    dataTransfer: z.literal('NONE') }).strict(),
  provenance: z.object({ engine: z.string().max(100).nullable(), engineVersion: z.string().max(100).nullable(), providerId: z.null(), inputHash: hash.nullable() }).strict(),
  manifestHref: z.string().startsWith('/api/projects/'),
  claims: z.object({ engineeringCorrectness: z.literal('NOT_CLAIMED'), solverValidation: z.literal('NOT_CLAIMED'), professionalReview: z.literal('NOT_CLAIMED') }).strict(),
}).strict();
export type SpecialistResult = z.infer<typeof SpecialistResultSchema>;
