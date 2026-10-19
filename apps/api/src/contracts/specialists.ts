import { z } from 'zod';
import { CostingPolicySchema, CostOptionsSchema, CurrencySchema, RegionSchema } from '@designflow/boq-cost';
import { ConstructionOptionsSchema, ConstructionSpecificationSchema } from '@designflow/construction-calculations';
import { TakeoffOptionsSchema } from '@designflow/quantity-takeoff';
import { ChangeImpactSchema, FRESHNESS_STATES, MODULES } from './project-manifest.js';
import { GenerateRevisionRequestSchema } from './projects.js';
import { ReferenceMediaTypeSchema, ReferencePurposeSchema } from '../references/contracts.js';
import { ExteriorWallsTargetSchema, FinishSchema, ImpactSchema, InteriorAssignmentsSchema, InteriorPlanSchema, LockSchema, PreflightStatusSchema } from '../revision/contracts.js';
import { CLAIMS as STRUCTURAL_CLAIMS, MODEL_ASSUMPTIONS } from '../structural/contracts.js';

/**
 * B39 slices S1 and S2: the shared specialist request envelope (ROADMAP L288; contract semantics after §E L509–585), scoped in
 * `docs/phase39/b39-specialist-scope.md`. One envelope over the existing engines, the Phase 30 lifecycle and their stored artifacts: nothing here is a new
 * store (D-8b: results are computed on read), and every status is derived from what the engine, the Phase 30 planner or the B37 manifest reports.
 * S1 runs Blueprint, Materials and Budget; S2 runs Exterior (cladding through Phase 30) and Structural; S3 runs Interior (finish data on V2 spaces through
 * the Phase 30 INTERIOR_FINISH_MODIFY operation, owner decision D-12 and migration 0029).
 */
export const SPECIALIST_VERSION = 'specialist-request-v1';
export const SPECIALIST_ROUTE = '/api/projects/:projectId/specialists/:module/requests';
export const SPECIALIST_MODULES = ['INTERIOR', 'EXTERIOR', 'BLUEPRINT', 'STRUCTURAL', 'MATERIALS', 'BUDGET'] as const;
export type SpecialistModule = typeof SPECIALIST_MODULES[number];
/** Modules each slice executes. */
export const S1_MODULES = ['BLUEPRINT', 'MATERIALS', 'BUDGET'] as const satisfies readonly SpecialistModule[];
export const S2_MODULES = ['EXTERIOR', 'STRUCTURAL'] as const satisfies readonly SpecialistModule[];
export const S3_MODULES = ['INTERIOR'] as const satisfies readonly SpecialistModule[];
export const SUPPORTED_MODULES = [...S1_MODULES, ...S2_MODULES, ...S3_MODULES] as const;
export type SupportedModule = typeof SUPPORTED_MODULES[number];
/** §E L515–517, verbatim. */
export const SPECIALIST_OPERATIONS = ['modify', 'regenerate', 'generate_alternative', 'recompute', 'compare', 'restore'] as const;
/** §E L519–525, verbatim. */
export const COMPONENT_SCOPES = ['building.geometry', 'building.floor_plans', 'building.structure', 'exterior.facade', 'exterior.materials', 'exterior.render',
  'interior.layout', 'interior.materials', 'interior.render', 'bim', 'engineering.structural', 'engineering.environmental', 'engineering.mep', 'quantities',
  'cost', 'documents', 'scene3d', 'walkthrough'] as const;
export type ComponentScope = typeof COMPONENT_SCOPES[number];
/**
 * Typed outcomes (ROADMAP L293 plus the Phase 30 lifecycle names). S1 and S2 assign COMPLETED, UNSUPPORTED, BLOCKED_BY_LOCK, STALE_DEPENDENCY,
 * REQUIRES_REVIEW, PARTIAL and FAILED; Exterior also AWAITING_CONSENT and NEEDS_CLARIFICATION, straight from the Phase 30 preflight. CANDIDATE_READY and
 * DEGRADED_PROVIDER are reserved: the candidate is completed through the existing Phase 30 routes, and no S1/S2 module calls a provider.
 */
export const SPECIALIST_STATUSES = ['COMPLETED', 'CANDIDATE_READY', 'AWAITING_CONSENT', 'NEEDS_CLARIFICATION', 'UNSUPPORTED', 'REQUIRES_REVIEW',
  'DEGRADED_PROVIDER', 'STALE_DEPENDENCY', 'PARTIAL', 'BLOCKED_BY_LOCK', 'FAILED'] as const;
export type SpecialistStatus = typeof SPECIALIST_STATUSES[number];
/**
 * Requested-room limit of every blueprint requirements version (rooms are per-type counts; the total may not exceed it). The API reaches the generator only
 * through its allowlisted boundary, so this mirrors BLUEPRINT_LIMITS.maxRooms and GENERATION_LIMITS.maxRooms and is pinned to both by a test.
 */
export const MAX_REQUESTED_ROOMS = 24;
/**
 * The reported status is the most restrictive that applies; every reason is still listed. A request still waiting on the user (clarification, consent)
 * ranks below every failure and review state, and above COMPLETED.
 */
export const STATUS_PRECEDENCE: readonly SpecialistStatus[] = ['UNSUPPORTED', 'BLOCKED_BY_LOCK', 'STALE_DEPENDENCY', 'FAILED', 'NEEDS_CLARIFICATION',
  'REQUIRES_REVIEW', 'PARTIAL', 'DEGRADED_PROVIDER', 'AWAITING_CONSENT', 'CANDIDATE_READY', 'COMPLETED'];
/** What each module may target; the scopes it rewrites (a preservation lock on any of them is refused before anything runs). */
export const MODULE_SCOPES = Object.freeze({
  BLUEPRINT: { operations: ['regenerate'], targets: ['building.floor_plans', 'building.geometry'], rewrites: COMPONENT_SCOPES },
  MATERIALS: { operations: ['recompute'], targets: ['quantities'], rewrites: ['quantities'] },
  BUDGET: { operations: ['recompute'], targets: ['cost'], rewrites: ['cost'] },
  // A Phase 30 appearance edit changes the visible finish only: model, geometry and every other scope are held by its byte-exact geometry lock.
  EXTERIOR: { operations: ['modify'], targets: ['exterior.facade', 'exterior.materials'], rewrites: ['exterior.facade', 'exterior.materials', 'exterior.render', 'scene3d'] },
  STRUCTURAL: { operations: ['recompute'], targets: ['engineering.structural'], rewrites: ['engineering.structural'] },
  // Finish data on spaces only; layout and geometry are held by the finish-only lock (0029).
  INTERIOR: { operations: ['modify'], targets: ['interior.materials'], rewrites: ['interior.materials', 'interior.render'] },
} as const satisfies Record<SupportedModule, { operations: readonly string[]; targets: readonly ComponentScope[]; rewrites: readonly ComponentScope[] }>);
/** Exterior targets that would change geometry (massing, glazing area): refused as ENVELOPE_GEOMETRY_REGENERATION with the impacted outputs listed. */
export const EXTERIOR_GEOMETRY_SCOPES = ['building.geometry', 'building.structure', 'building.floor_plans'] as const satisfies readonly ComponentScope[];
/** Envelope scopes with a Phase 30 preservation counterpart. The others are held by the appearance edit's model-equivalence and geometry locks. */
export const PRESERVATION_MAP = Object.freeze({ 'building.geometry': 'BUILDING_GEOMETRY', 'building.floor_plans': 'FLOOR_PLANS', 'building.structure': 'STRUCTURE',
  'interior.layout': 'ROOMS', 'interior.materials': 'INTERIOR' } as const satisfies Partial<Record<ComponentScope, string>>);
/** Interior targets that are space planning, not finishes (scenario 33): refused as SCOPE_EXPANSION_REQUIRED, pointing to a Blueprint regeneration. */
export const INTERIOR_PLANNING_SCOPES = ['interior.layout', 'building.floor_plans', 'building.geometry', 'building.structure'] as const satisfies readonly ComponentScope[];
/** Linear static frame analysis is the only solver (B24). Any other analysis is a validated-solver request and is unsupported (UNSUPPORTED_OPERATIONS). */
export const STRUCTURAL_ANALYSIS_TYPES = ['LINEAR_STATIC', 'NONLINEAR_STATIC', 'MODAL', 'DYNAMIC', 'SEISMIC', 'WIND', 'MEMBER_DESIGN', 'FOUNDATION'] as const;
/** Phase 31 references a request may cite (as PR #16): metadata only, never content. */
export const MAX_REFERENCES = 8;

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), text = z.string().min(1).max(200), scope = z.enum(COMPONENT_SCOPES);
/** A non-negative decimal amount, as the cost engine writes money (at most 2 decimals, at most 15 integer digits). */
const amount = z.string().regex(/^(0|[1-9]\d{0,14})(\.\d{1,2})?$/);
export const SpecialistParamsSchema = z.object({ projectId: id, module: z.enum(SPECIALIST_MODULES) }).strict();
/** The envelope. `outputConfig` is checked against the module's own schema only once the module and operation are known to be supported. */
export const SpecialistRequestSchema = z.object({
  envelopeVersion: z.literal(SPECIALIST_VERSION), baseRevisionId: id, operation: z.enum(SPECIALIST_OPERATIONS),
  instruction: z.string().min(1).max(2000).optional(),
  targetScopes: z.array(scope).min(1).max(COMPONENT_SCOPES.length), preserveScopes: z.array(scope).max(COMPONENT_SCOPES.length).default([]),
  /** Phase 31 references (ROADMAP L288 "references"): must be active references of the project; recorded as metadata, never sent anywhere. */
  referenceIds: z.array(id).max(MAX_REFERENCES).default([]),
  /**
   * Execution-cost ceiling (ROADMAP L288 "quote/budget"; §E `budget_exceeded`). It bounds what running the request may cost, not the construction cost a
   * Budget estimate computes. Every S1/S2 module runs locally at zero external cost, so the quote never exceeds a ceiling today.
   */
  budget: z.object({ ceiling: amount, currency: CurrencySchema }).strict().optional(),
  outputConfig: z.record(z.unknown()).default({}),
}).strict().superRefine((r, ctx) => {
  for (const [name, list] of [['targetScopes', r.targetScopes], ['preserveScopes', r.preserveScopes], ['referenceIds', r.referenceIds]] as const)
    if (new Set(list).size !== list.length) ctx.addIssue({ code: 'custom', path: [name], message: `Duplicate ${name === 'referenceIds' ? 'reference' : 'scope'}` });
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
/**
 * Exterior: a structured cladding/finish change (the Phase 30 composer shape), or none, in which case the envelope `instruction` is planned as Phase 30
 * natural language. Either way the operation that is stored is structured, with the envelope's preservation locks added.
 */
export const ExteriorConfigSchema = z.object({ appearance: z.object({ target: ExteriorWallsTargetSchema, finish: FinishSchema }).strict().optional() }).strict();
/**
 * Interior: finishes for named spaces (the Phase 30 INTERIOR_FINISH_MODIFY shape). `furnishings` is accepted only so that it can be refused by type: no
 * furnishing data exists on the model.
 */
export const InteriorConfigSchema = z.object({ finishes: InteriorAssignmentsSchema, furnishings: z.array(z.unknown()).min(1).max(16).optional() }).strict();
/**
 * Structural: the analysis asked for, plus the B24 structural input, unchanged. Only LINEAR_STATIC runs; the input is validated against the structural
 * route's own schema only once the analysis is known to be supported, so a validated-solver request is a typed refusal, not a validation error.
 */
export const StructuralConfigSchema = z.object({ analysisType: z.enum(STRUCTURAL_ANALYSIS_TYPES).default('LINEAR_STATIC'), input: z.unknown() }).strict();

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
const ExteriorDetails = z.object({ kind: z.literal('EXTERIOR'), preflightStatus: PreflightStatusSchema, operationKind: z.literal('APPEARANCE_MODIFY'),
  preflightHash: hash, appearanceHash: hash.nullable(), targetObjects: z.number().int().nonnegative(), excludedObjects: z.number().int().nonnegative(),
  /** The existing Phase 30 routes that complete the lifecycle: consent and execute, compare, then approve or reject. */
  next: z.object({ operationHref: z.string(), executeHref: z.string(), comparisonHref: z.string(), approveHref: z.string(), rejectHref: z.string() }).strict(),
  claims: z.object({ physicalGlazing: z.literal('NOT_CLAIMED'), materialPerformance: z.literal('NOT_CLAIMED'), thermal: z.literal('NOT_CLAIMED'),
    photorealism: z.literal('NOT_CLAIMED') }).strict() }).strict();
const InteriorDetails = z.object({ kind: z.literal('INTERIOR'), preflightStatus: PreflightStatusSchema, operationKind: z.literal('INTERIOR_FINISH_MODIFY'),
  preflightHash: hash, candidateModelHash: hash, geometryModelHash: hash, spaces: InteriorPlanSchema.shape.spaces,
  /** The existing Phase 30 routes that complete the lifecycle: consent and execute, compare, then approve or reject. */
  next: z.object({ operationHref: z.string(), executeHref: z.string(), comparisonHref: z.string(), approveHref: z.string(), rejectHref: z.string() }).strict(),
  claims: z.object({ productSpecification: z.literal('NOT_CLAIMED'), fireRating: z.literal('NOT_CLAIMED'), acousticPerformance: z.literal('NOT_CLAIMED'),
    slipResistance: z.literal('NOT_CLAIMED') }).strict() }).strict();
const StructuralDetails = z.object({ kind: z.literal('STRUCTURAL'), analysisType: z.literal('LINEAR_STATIC'), solver: z.object({ name: text, version: text }).strict(),
  analysisStatus: z.literal('ANALYZED'), validationStatus: z.literal('VALIDATED'),
  counts: z.object({ nodes: z.number().int().nonnegative(), members: z.number().int().nonnegative(), segments: z.number().int().nonnegative(),
    loadCases: z.number().int().nonnegative(), combinations: z.number().int().nonnegative() }).strict(),
  assumptions: z.array(z.enum(MODEL_ASSUMPTIONS)).max(16), limitations: z.array(z.string().max(300)).max(16),
  /** The structural engine's own claims, unchanged: design verification is never evaluated and nothing is certified. */
  engineClaims: z.object({ designVerification: z.literal(STRUCTURAL_CLAIMS.designVerification), codeCompliance: z.literal('NOT_CLAIMED'),
    certification: z.literal('NOT_CLAIMED'), constructionSuitability: z.literal('NOT_CLAIMED') }).strict() }).strict();
const NoDetails = z.object({ kind: z.literal('NONE') }).strict();
const ReferenceUseSchema = z.object({ referenceId: id, purpose: ReferencePurposeSchema, mediaType: ReferenceMediaTypeSchema, storedSha256: hash,
  /** No S1/S2 engine reads reference content: references are validated and recorded only. */
  use: z.literal('RECORDED_NOT_CONSUMED') }).strict();
export const SpecialistResultSchema = z.object({
  envelopeVersion: z.literal(SPECIALIST_VERSION), module: z.enum(SPECIALIST_MODULES), operation: z.enum(SPECIALIST_OPERATIONS),
  projectId: id, baseRevisionId: id,
  // INT-B-021: these descriptions are published in openapi.json, so a client does not read FAILED as "nothing changed".
  resultRevisionId: id.nullable().describe('The revision this request committed, which is now the project\'s current revision; non-null even when status is FAILED '
    + '(a Blueprint revision that failed independent verification after it was committed). Refresh the current revision whenever it is non-null.'),
  status: z.enum(SPECIALIST_STATUSES).describe('The outcome of the checks; it does not say whether anything was stored: read written and resultRevisionId for that'),
  reasons: z.array(ReasonSchema).max(16),
  targetScopes: z.array(scope), preserveScopes: z.array(scope),
  /** true when this request stored something (a revision or an artifact); false for every refusal. */
  written: z.boolean().describe('true when this request stored something (a revision or an artifact), whatever its status; false for every refusal'),
  replayed: z.boolean(),
  /** The Phase 30 operation an Exterior or Interior request stored (completed through the existing routes); null for every other module. No module runs as a job. */
  operationId: id.nullable(), jobIds: z.array(id).max(0),
  artifacts: z.array(ArtifactReferenceSchema).max(8),
  /** Phase 30 locks and impacts of an Exterior preflight, or the outputs a refused geometry change would invalidate; empty otherwise. */
  locks: z.array(LockSchema).max(32), impacts: z.array(ImpactSchema).max(24),
  references: z.array(ReferenceUseSchema).max(MAX_REFERENCES),
  /** The execution-cost ceiling, when one was given, against the quote. */
  budget: z.object({ ceiling: amount, currency: CurrencySchema, quotedExternalCost: z.literal('0'), withinCeiling: z.literal(true) }).strict().nullable(),
  details: z.discriminatedUnion('kind', [BlueprintDetails, MaterialsDetails, BudgetDetails, ExteriorDetails, StructuralDetails, InteriorDetails, NoDetails]),
  /** Blueprint only: the B37 change since the parent revision, as the manifest reports it. */
  changeImpact: ChangeImpactSchema.nullable(),
  quote: z.object({ execution: z.enum(['LOCAL_DETERMINISTIC', 'NONE']), externalProviders: z.array(z.string()).max(0), externalCostUsd: z.literal(0),
    dataTransfer: z.literal('NONE') }).strict(),
  provenance: z.object({ engine: z.string().max(100).nullable(), engineVersion: z.string().max(100).nullable(), providerId: z.null(), inputHash: hash.nullable() }).strict(),
  manifestHref: z.string().startsWith('/api/projects/'),
  claims: z.object({ engineeringCorrectness: z.literal('NOT_CLAIMED'), solverValidation: z.literal('NOT_CLAIMED'), professionalReview: z.literal('NOT_CLAIMED') }).strict(),
}).strict();
export type SpecialistResult = z.infer<typeof SpecialistResultSchema>;
