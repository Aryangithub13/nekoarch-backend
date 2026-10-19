import { z } from 'zod';
import { CostingPolicySchema, CostOptionsSchema } from '@designflow/boq-cost';
import { ConstructionOptionsSchema, ConstructionSpecificationSchema } from '@designflow/construction-calculations';
import { TakeoffOptionsSchema } from '@designflow/quantity-takeoff';
import { FRESHNESS_STATES, MODULES } from './project-manifest.js';
import { StructuralInputSchema } from '../structural/contracts.js';
import { DeclaredLimitsSchema } from '../verification/contracts.js';
import { LockSchema, PRESERVATION_SCOPES, PreflightStatusSchema } from '../revision/contracts.js';

/**
 * B40 slice S1 (ROADMAP L300–315): a typed change set over stable model element ids, planned against one accepted base revision into a bounded task
 * DAG of existing engines, and executed only on explicit approval of the exact plan. The canonical model stays the single source of truth: the only
 * model write is the Phase 30 operation (SQL compare-and-swap and finish-only lock, 0020/0029); downstream outputs are recomputed by the existing
 * engine services on the committed revision. Nothing here is a new store.
 */
export const CHANGE_SET_VERSION = 'change-set-v1';
export const INTEGRATION_PLAN_VERSION = 'integration-plan-v1';
export const INTEGRATION_EXECUTION_VERSION = 'integration-execution-v1';
export const ELEMENT_DIFF_VERSION = 'element-diff-v1';
export const INTEGRATION_ROUTES = { plan: '/api/projects/:projectId/integration/plans', execute: '/api/projects/:projectId/integration/plans/execute' } as const;
export const INTEGRATION_LIMITS = Object.freeze({ changes: 24, preserve: 16, propertyKeys: 8, diffChanges: 256 });

/** Element collections of Building Model V2 that carry stable ids and can be named by a change. */
export const ELEMENT_TYPES = ['level', 'space', 'wall', 'opening', 'stair', 'slab', 'column'] as const;
export type ElementType = typeof ELEMENT_TYPES[number];
export const ELEMENT_COLLECTIONS = { level: 'levels', space: 'spaces', wall: 'walls', opening: 'openings', stair: 'stairs', slab: 'slabs', column: 'columns' } as const satisfies Record<ElementType, string>;
/** Every id-bearing collection the element diff compares (stable identity per collection). */
export const DIFF_COLLECTIONS = ['levels', 'spaces', 'walls', 'openings', 'stairs', 'slabs', 'columns', 'dimensions', 'specifications'] as const;
export const CHANGE_OPERATIONS = ['add', 'modify', 'remove', 'replace'] as const;

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), elementId = z.string().min(1).max(200);
const ReasonSchema = z.object({ code: z.string().min(1).max(80), message: z.string().min(1).max(500) }).strict();
export type IntegrationReason = z.infer<typeof ReasonSchema>;

/**
 * One requested change. `properties` is validated by the planner once the operation and element type are known to be supported, so an unsupported or
 * malformed change is a typed per-change result rather than a request error: arbitrary text is never executed as a geometry mutation.
 */
export const ChangeSchema = z.object({ operation: z.enum(CHANGE_OPERATIONS), elementType: z.enum(ELEMENT_TYPES), elementId: elementId.nullable().default(null),
  properties: z.record(z.unknown()).refine(p => Object.keys(p).length <= INTEGRATION_LIMITS.propertyKeys, { message: 'Too many properties' }).default({}) }).strict();
export type Change = z.infer<typeof ChangeSchema>;
/** Downstream outputs to recompute on the committed revision (selective regeneration): only these run; every other output is reported stale. */
export const RegenerateSchema = z.object({
  materials: z.object({ specification: ConstructionSpecificationSchema, takeoffOptions: TakeoffOptionsSchema.default({}),
    constructionOptions: ConstructionOptionsSchema.default({}) }).strict().optional(),
  budget: z.object({ rateBookId: z.string().min(1).max(200), costingPolicy: CostingPolicySchema, options: CostOptionsSchema.default({}) }).strict().optional(),
  /** B40 S2: an independent branch. The B24 linear-static analysis of the caller's frame definition on the committed revision (stored, REQUIRES_REVIEW). */
  structural: StructuralInputSchema.optional(),
  /** B40 S2: an independent branch. The B34 complex verification of the committed revision (derived on read: its status and input hash are checkpointed). */
  verification: z.object({ declaredLimits: DeclaredLimitsSchema.nullable().default(null) }).strict().optional(),
}).strict();
/** B40 S2 cost safeguard: the caller's ceiling on the number of tasks a plan may run. A larger plan is OVER_BUDGET and can never execute. */
export const PlanLimitsSchema = z.object({ maxTasks: z.number().int().min(1).max(16).optional() }).strict();
export const ChangeSetSchema = z.object({
  changeSetVersion: z.literal(CHANGE_SET_VERSION),
  /** The expected source revision: the plan is computed against it, and execution requires it to still be the project's current revision. */
  baseRevisionId: id,
  changes: z.array(ChangeSchema).min(1).max(INTEGRATION_LIMITS.changes),
  /** Hard model locks (ROADMAP A2) in the Phase 30 vocabulary; a change that touches a locked scope is a conflict, never an implicit override. */
  preserve: z.array(z.object({ scope: z.enum(PRESERVATION_SCOPES), levelId: elementId.nullable().default(null) }).strict()).max(INTEGRATION_LIMITS.preserve).default([]),
  regenerate: RegenerateSchema.default({}),
  limits: PlanLimitsSchema.default({}),
}).strict();
export type ChangeSet = z.infer<typeof ChangeSetSchema>;
export const PlanParamsSchema = z.object({ projectId: id }).strict();
export const ExecuteRequestSchema = z.object({ changeSet: ChangeSetSchema, planHash: hash,
  consent: z.object({ acceptPlan: z.literal(true), acceptLocks: z.literal(true) }).strict() }).strict();

/** Element-level comparison by stable id. `fields` names the top-level element properties that differ. Bounded; counts always cover every change. */
export const ElementDiffSchema = z.object({ diffVersion: z.literal(ELEMENT_DIFF_VERSION), baseModelHash: hash, candidateModelHash: hash, modelIdentical: z.boolean(),
  elementsIdentical: z.boolean(), documentFields: z.array(z.string().max(80)).max(32),
  collections: z.array(z.object({ collection: z.enum(DIFF_COLLECTIONS), base: z.number().int().min(0), candidate: z.number().int().min(0), added: z.number().int().min(0),
    removed: z.number().int().min(0), modified: z.number().int().min(0), preserved: z.number().int().min(0), reordered: z.boolean() }).strict()),
  changes: z.array(z.object({ collection: z.enum(DIFF_COLLECTIONS), elementId, change: z.enum(['ADDED', 'REMOVED', 'MODIFIED']), fields: z.array(z.string().max(80)).max(32) }).strict())
    .max(INTEGRATION_LIMITS.diffChanges),
  changesTruncated: z.boolean() }).strict();
export type ElementDiff = z.infer<typeof ElementDiffSchema>;

export const CHANGE_DISPOSITIONS = ['SUPPORTED', 'INVALID', 'NEEDS_CLARIFICATION', 'UNSUPPORTED', 'BLOCKED_BY_LOCK'] as const;
export type ChangeDisposition = typeof CHANGE_DISPOSITIONS[number];
/** Plan statuses, most restrictive first; the plan reports the first that applies. STALE_BASE is decided by the project's current revision. */
export const PLAN_STATUSES = ['INVALID', 'BLOCKED_BY_LOCK', 'UNSUPPORTED', 'NEEDS_CLARIFICATION', 'OVER_BUDGET', 'STALE_BASE', 'READY_FOR_APPROVAL'] as const;
export type PlanStatus = typeof PLAN_STATUSES[number];
export const LimitSchema = z.object({ limitId: z.string().max(80), value: z.number().int(), requested: z.number().int() }).strict();
export const TASK_KINDS = ['MODEL_PREFLIGHT', 'MODEL_CANDIDATE', 'MODEL_COMMIT', 'QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST',
  // B40 S2: independent analysis branches on the committed revision.
  'STRUCTURAL_ANALYSIS', 'COMPLEX_VERIFICATION'] as const;
export type TaskKind = typeof TASK_KINDS[number];
/**
 * B40 S2: a branch is a chain of tasks that depend only on the model commit and on each other. A failure skips its own dependants only; the
 * other branches still run (ROADMAP L313, "recover independent failed branches").
 */
export const TASK_BRANCHES = ['MODEL', 'MATERIALS_BUDGET', 'STRUCTURAL', 'VERIFICATION'] as const;
export const PlannedChangeSchema = z.object({ index: z.number().int().min(0), operation: z.enum(CHANGE_OPERATIONS), elementType: z.enum(ELEMENT_TYPES), elementId: elementId.nullable(),
  levelId: elementId.nullable(), disposition: z.enum(CHANGE_DISPOSITIONS), module: z.literal('INTERIOR').nullable(), reasons: z.array(ReasonSchema).max(8),
  limit: LimitSchema.nullable(), requiredChecks: z.array(z.string().max(120)).max(12) }).strict();
export const PlannedOutputSchema = z.object({ module: z.enum(MODULES), baseArtifactIds: z.array(id).max(20),
  action: z.enum(['REGENERATE', 'MARK_STALE', 'NOT_AFFECTED']), taskId: z.enum(TASK_KINDS).nullable(), reason: z.string().max(300) }).strict();
export const PlannedTaskSchema = z.object({ taskId: z.enum(TASK_KINDS), module: z.enum(['INTERIOR', 'MATERIALS', 'BUDGET', 'STRUCTURAL', 'BLUEPRINT']),
  branch: z.enum(TASK_BRANCHES), dependsOn: z.array(z.enum(TASK_KINDS)).max(4),
  writes: z.enum(['REVISION_OPERATION', 'REVISION', 'ARTIFACT', 'NONE']), checkpoint: z.literal(true), description: z.string().max(300) }).strict();
const ClaimsSchema = z.object({ engineeringCorrectness: z.literal('NOT_CLAIMED'), solverValidation: z.literal('NOT_CLAIMED'), professionalReview: z.literal('NOT_CLAIMED') }).strict();
export const IntegrationPlanSchema = z.object({
  planVersion: z.literal(INTEGRATION_PLAN_VERSION), projectId: id, baseRevisionId: id, baseRevisionNumber: z.number().int().positive(), baseModelHash: hash,
  projectCurrentRevisionId: id.nullable(), status: z.enum(PLAN_STATUSES), reasons: z.array(ReasonSchema).max(16),
  changes: z.array(PlannedChangeSchema).max(INTEGRATION_LIMITS.changes),
  /** The Phase 30 operation the supported changes compose into (read-only preflight; stored only at execution). */
  modelChange: z.object({ operationKind: z.literal('INTERIOR_FINISH_MODIFY'), preflightStatus: PreflightStatusSchema, preflightHash: hash, candidateModelHash: hash.nullable(),
    geometryModelHash: hash.nullable(), locks: z.array(LockSchema).max(32), verifications: z.array(z.string().max(200)).max(24) }).strict().nullable(),
  /** Base → planned candidate, by stable element id; null when no candidate can be planned. */
  diff: ElementDiffSchema.nullable(),
  outputs: z.array(PlannedOutputSchema).max(24),
  tasks: z.array(PlannedTaskSchema).max(TASK_KINDS.length),
  /** Invalidation follows the B37 graph: a changed canonical model hash makes every model-bound output of the base stale (whole model, not per element). */
  invalidation: z.object({ granularity: z.literal('WHOLE_MODEL'), basis: z.string().max(300) }).strict(),
  approvalRequired: z.literal(true),
  quote: z.object({ execution: z.enum(['LOCAL_DETERMINISTIC', 'NONE']), externalProviders: z.array(z.string()).max(0), externalCostUsd: z.literal(0),
    /** B40 S2: tasks the plan would run and the caller's ceiling (null when none was set). */
    taskCount: z.number().int().min(0), maxTasks: z.number().int().min(1).nullable() }).strict(),
  claims: ClaimsSchema,
  /** Hash of the plan without its currency fields (status, reasons, projectCurrentRevisionId): execution must present it unchanged. */
  planHash: hash,
}).strict();
export type IntegrationPlan = z.infer<typeof IntegrationPlanSchema>;

export const EXECUTION_STATUSES = ['COMPLETED', 'PARTIAL', 'FAILED', 'REFUSED'] as const;
export const TASK_STATUSES = ['COMPLETED', 'REPLAYED', 'FAILED', 'SKIPPED', 'NOT_RUN'] as const;
export const IntegrationExecutionSchema = z.object({
  executionVersion: z.literal(INTEGRATION_EXECUTION_VERSION), projectId: id, baseRevisionId: id, planHash: hash, status: z.enum(EXECUTION_STATUSES),
  reasons: z.array(ReasonSchema).max(16),
  /** The plan as re-derived at execution (for a refusal, why nothing ran). */
  plan: IntegrationPlanSchema,
  operationId: id.nullable(), committedRevisionId: id.nullable(),
  tasks: z.array(z.object({ taskId: z.enum(TASK_KINDS), status: z.enum(TASK_STATUSES), revisionId: id.nullable(), artifactId: id.nullable(),
    error: ReasonSchema.nullable(),
    /** B40 S2: a derived-on-read task's checkpoint (COMPLEX_VERIFICATION: its report status and input hash); null otherwise. */
    report: z.object({ status: z.string().max(40), inputHash: hash }).strict().nullable().default(null) }).strict()).max(TASK_KINDS.length),
  /** Consistency checks on what was actually committed. */
  checks: z.array(z.object({ check: z.enum(['PREFLIGHT_MATCHES_PLAN', 'CANDIDATE_MATCHES_PLAN', 'COMMITTED_DIFF_MATCHES_PLAN', 'UNTARGETED_ELEMENTS_PRESERVED']),
    result: z.enum(['PASSED', 'FAILED', 'NOT_RUN']) }).strict()).max(8),
  /** Base → committed model, by stable element id; null when nothing was committed. */
  diff: ElementDiffSchema.nullable(),
  /** Freshness read back from the B37 manifest (never computed here): the base's stored outputs and the committed revision's. */
  outputs: z.array(z.object({ module: z.enum(MODULES), revisionId: id, artifactId: id, freshness: z.enum(FRESHNESS_STATES).nullable() }).strict()).max(64),
  claims: ClaimsSchema,
}).strict();
export type IntegrationExecution = z.infer<typeof IntegrationExecutionSchema>;
