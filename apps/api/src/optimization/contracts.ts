import { z } from 'zod';
import type { BuildingModelV2 } from '@designflow/shared';

/** Phase 28 V1 contracts: schemas, versions, limits, claims. No calculation code lives here. */
export const OPTIMIZATION_INPUT_VERSION = 'optimization-input-v1';
export const OPTIMIZATION_STUDY_VERSION = 'optimization-study-v1';
export const OPTIMIZATION_CANDIDATE_VERSION = 'optimization-candidate-v1';
export const OPTIMIZER_VERSION = 'optimization-engine-v1';
export const OPTIMIZATION_METRICS_VERSION = 'optimization-metrics-v1';
export const OPTIMIZATION_SOURCE_GENERATOR = 'parametric-architecture-v1';

/** Benchmarked (docs/phase28/evidence/benchmark.json): 128 candidates = 4.8–6.0 s typical, 20.05 s for the 24-room
 * maximum fixture; largest snapshot 237 KB. The deadline is a runaway guard, not a latency policy
 * (PHASE28_EXECUTION_MODEL_INTEGRATION_DECISION_PENDING). */
export const OPTIMIZATION_LIMITS = Object.freeze({
  inputBytes: 262_144, inputDepth: 16, inputNodes: 8_000, variables: 8, valuesPerVariable: 64,
  maxGridCandidates: 128, maxEvaluatedCandidates: 128, objectives: 8, hardConstraints: 16,
  paretoComparisons: 131_072, snapshotBytes: 1_048_576, deadlineMs: 45_000, generatorTimeoutMs: 10_000,
});

export const CLAIMS = Object.freeze({
  globalOptimality: 'NOT_CLAIMED', architecturalCompliance: 'NOT_CLAIMED', structuralCompliance: 'NOT_CLAIMED',
  buildingCodeCompliance: 'NOT_CLAIMED', fireCodeCompliance: 'NOT_CLAIMED', lifeSafetyCertification: 'NOT_CLAIMED',
  energyCertification: 'NOT_CLAIMED', costCertainty: 'NOT_CLAIMED', professionalCertification: 'NOT_CLAIMED',
  constructionReadiness: 'NOT_CLAIMED', designApproval: 'NOT_CLAIMED',
} as const);
export const ENGINEERING = Object.freeze({ structural: 'NOT_EVALUATED', environmental: 'NOT_EVALUATED', systems: 'NOT_EVALUATED',
  knowledge: 'NOT_EVALUATED', reason: 'UPSTREAM_INPUTS_NOT_TRANSFERABLE_TO_CANDIDATES', phase27: 'PHASE27_INTEGRATION_DEFERRED' } as const);

export type OptimizationErrorCode = 'OPTIMIZATION_INPUT_INVALID' | 'OPTIMIZATION_UNSUPPORTED' | 'OPTIMIZATION_RESOURCE_LIMIT'
  | 'OPTIMIZATION_BASELINE_MISMATCH' | 'REVISION_NOT_ACCEPTED' | 'OPTIMIZATION_VALIDATION_FAILED';
export class OptimizationError extends Error {
  constructor(readonly code: OptimizationErrorCode, message: string, readonly details: Record<string, string> = {}) { super(message); this.name = 'OptimizationError'; }
}

/** The ParametricEditSchema surface: 8 slots = level × parameter. */
export const PARAMETERS = ['widthMm', 'depthMm', 'westWingWidthMm', 'southWingDepthMm'] as const;
export type Parameter = typeof PARAMETERS[number];
export const SLOT_COUNT = 8;
export const slotOf = (level: number, parameter: Parameter) => level * 4 + PARAMETERS.indexOf(parameter);

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const entityId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
export const DecimalSchema = z.string().max(40).regex(/^-?(0|[1-9][0-9]{0,29})(\.[0-9]{1,9})?$/);
const dimension = z.number().int().min(1000).max(60000);
const level = z.union([z.literal(0), z.literal(1)]);

export const VariableSchema = z.object({
  variableId: id,
  target: z.object({ kind: z.literal('PARAMETRIC_FLOOR_DIMENSION'), level, parameter: z.enum(PARAMETERS) }).strict(),
  unit: z.literal('mm'),
  domain: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('RANGE'), minimumMm: dimension, maximumMm: dimension, stepMm: z.number().int().min(1).max(59000) }).strict(),
    z.object({ kind: z.literal('VALUES'), valuesMm: z.array(dimension).min(1).max(OPTIMIZATION_LIMITS.valuesPerVariable) }).strict(),
  ]),
  allowedMutation: z.literal('SET_PARAMETRIC_DIMENSION'),
}).strict().superRefine((v, ctx) => {
  const d = v.domain;
  if (d.kind === 'VALUES') { if (d.valuesMm.some((x, i) => i > 0 && x <= d.valuesMm[i - 1]!)) ctx.addIssue({ code: 'custom', path: ['domain'], message: 'VALUES must be strictly increasing' }); return; }
  if (d.maximumMm < d.minimumMm || (d.maximumMm - d.minimumMm) % d.stepMm !== 0) ctx.addIssue({ code: 'custom', path: ['domain'], message: 'RANGE requires minimum ≤ maximum and an exact step division' });
  else if ((d.maximumMm - d.minimumMm) / d.stepMm + 1 > OPTIMIZATION_LIMITS.valuesPerVariable) ctx.addIssue({ code: 'custom', path: ['domain'], message: 'Too many values for one variable' });
});
export type Variable = z.infer<typeof VariableSchema>;

/** Recognised but not evaluable in V1 (D5): returned as typed UNSUPPORTED, never ignored. */
export const DEFERRED_METRIC_KINDS = ['STRUCTURAL', 'ENVIRONMENTAL', 'SYSTEMS', 'KNOWLEDGE', 'DAYLIGHT'] as const;
const baseMetric = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('GROSS_FLOOR_AREA') }).strict(),
  z.object({ kind: z.literal('FOOTPRINT_AREA') }).strict(),
  z.object({ kind: z.literal('WALL_CENTERLINE_LENGTH') }).strict(),
  z.object({ kind: z.literal('WALL_NET_VOLUME') }).strict(),
  z.object({ kind: z.literal('CLASSIFICATION_FLOOR_AREA'), classification: entityId }).strict(),
  z.object({ kind: z.literal('SPACE_FLOOR_AREA'), spaceId: entityId }).strict(),
  z.object({ kind: z.literal('PRICED_SCOPE_TOTAL') }).strict(),
]);
export const MetricRefSchema = z.union([baseMetric,
  z.object({ kind: z.literal('RATIO'), numerator: baseMetric, denominator: baseMetric }).strict(),
  z.object({ kind: z.enum(DEFERRED_METRIC_KINDS) }).passthrough()]);
export type MetricRef = z.infer<typeof MetricRefSchema>;
export type BaseMetricRef = z.infer<typeof baseMetric>;
export const isBaseMetric = (m: MetricRef): m is BaseMetricRef => m.kind !== 'RATIO' && !(DEFERRED_METRIC_KINDS as readonly string[]).includes(m.kind);
export function metricKey(m: MetricRef): string {
  if (m.kind === 'RATIO') return `RATIO(${metricKey(m.numerator)}/${metricKey(m.denominator)})`;
  if (m.kind === 'CLASSIFICATION_FLOOR_AREA') return `${m.kind}:${m.classification}`;
  if (m.kind === 'SPACE_FLOOR_AREA') return `${m.kind}:${m.spaceId}`;
  return m.kind;
}

export const NormalizationSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('EXPLICIT_BOUNDS'), best: DecimalSchema, worst: DecimalSchema }).strict(),
  z.object({ method: z.literal('CANDIDATE_RANGE') }).strict(),
  z.object({ method: z.literal('TARGET_TOLERANCE'), tolerance: DecimalSchema }).strict(),
]);
export const ObjectiveSchema = z.object({
  objectiveId: id, metric: MetricRefSchema,
  goal: z.discriminatedUnion('kind', [z.object({ kind: z.literal('MINIMIZE') }).strict(), z.object({ kind: z.literal('MAXIMIZE') }).strict(),
    z.object({ kind: z.literal('TARGET'), target: DecimalSchema }).strict()]),
  weight: z.number().int().min(0).max(1000).optional(),
  normalization: NormalizationSchema.optional(),
}).strict();
export type Objective = z.infer<typeof ObjectiveSchema>;
export const ConstraintSchema = z.discriminatedUnion('kind', [
  z.object({ constraintId: id, kind: z.literal('METRIC_BOUND'), metric: MetricRefSchema, operator: z.enum(['LE', 'GE']), value: DecimalSchema }).strict(),
  z.object({ constraintId: id, kind: z.literal('QA_NO_WARNINGS') }).strict(),
]);
export type Constraint = z.infer<typeof ConstraintSchema>;

const nullableUuid = z.string().uuid().nullable();
export const OptimizationInputSchema = z.object({
  version: z.literal(OPTIMIZATION_INPUT_VERSION),
  variables: z.array(VariableSchema).min(1).max(OPTIMIZATION_LIMITS.variables),
  hardConstraints: z.array(ConstraintSchema).max(OPTIMIZATION_LIMITS.hardConstraints).default([]),
  objectives: z.array(ObjectiveSchema).min(1).max(OPTIMIZATION_LIMITS.objectives),
  strategy: z.discriminatedUnion('kind', [z.object({ kind: z.literal('GRID') }).strict(),
    z.object({ kind: z.literal('DETERMINISTIC_LOCAL_SEARCH'), maxEvaluations: z.number().int().min(1).max(OPTIMIZATION_LIMITS.maxEvaluatedCandidates) }).strict()]),
  mode: z.enum(['WEIGHTED_SCORE', 'PARETO']),
  cost: z.object({ rateBookId: z.enum(['sample-inr-v1', 'sample-inr-v2']), specification: z.unknown(), policy: z.unknown() }).strict().nullable().default(null),
  sources: z.object({ structuralAnalysisId: nullableUuid, environmentalAnalysisId: nullableUuid, systemsAnalysisId: nullableUuid, knowledgeAnalysisId: nullableUuid }).strict()
    .default({ structuralAnalysisId: null, environmentalAnalysisId: null, systemsAnalysisId: null, knowledgeAnalysisId: null }),
}).strict();
export type OptimizationInput = z.infer<typeof OptimizationInputSchema>;

/** Accepted revision, as read by the (deferred) service layer. Never mutated. */
export interface OptimizationSource {
  projectId: string; revisionId: string; generatorVersion: string | null; normalizedRequirements: unknown;
  model: BuildingModelV2; identity: { modelHash: string } | null;
  qa: { status: string; inputStatus: string; errors: number };
}
/** Phase 27 seam (PHASE27_INTEGRATION_DEFERRED). V1 always runs with null. */
export interface OptimizationKnowledgeAdapter {
  readonly version: string;
  evaluateCandidate(candidate: { model: BuildingModelV2; modelHash: string; binding: { projectId: string; sourceRevisionId: string; candidateId: string } },
    request: { packIds: string[]; ruleIds?: string[] }): { status: 'EVALUATED' | 'NOT_EVALUATED'; rules: { ruleId: string; result: string }[]; conflicts: number };
}

export const ExactSchema = z.object({ numerator: z.string().max(200).regex(/^-?(0|[1-9][0-9]*)$/), denominator: z.string().max(200).regex(/^[1-9][0-9]*$/) }).strict();
export type Exact = z.infer<typeof ExactSchema>;
export const MetricStatusSchema = z.enum(['EVALUATED', 'NOT_EVALUATED', 'INPUT_INCOMPLETE', 'UNSUPPORTED']);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const parameters = z.array(dimension.nullable()).length(SLOT_COUNT);
const edit = z.object({ level, parameter: z.enum(PARAMETERS), valueMm: dimension }).strict();

export const CandidateSchema = z.object({
  candidateId: hash, ordinal: z.number().int().nonnegative(), isBaseline: z.boolean(), parameters,
  assignment: z.record(z.number().int()), aliases: z.array(z.object({ candidateId: hash, parameters }).strict()),
  modelHash: hash.nullable(), status: z.enum(['VALID', 'REJECTED', 'PARTIAL', 'INPUT_INCOMPLETE']),
  rejection: z.object({ stage: z.enum(['NORMALIZATION', 'GENERATION', 'MODEL', 'QA', 'CONSTRAINT']), code: z.string().max(100), details: z.array(z.string().max(200)).max(10) }).strict().nullable(),
  qa: z.object({ status: z.enum(['PASS', 'PASS_WITH_WARNINGS', 'FAIL']), warnings: z.number().int().nonnegative() }).strict().nullable(),
  cost: z.object({ scopeSignature: hash, unpricedLines: z.number().int().nonnegative(), completeTotalAvailable: z.boolean() }).strict().nullable(),
  metrics: z.record(z.object({ status: MetricStatusSchema, stage: z.enum(['A', 'B']), unit: z.string().max(8), value: ExactSchema.nullable(), reason: z.string().max(100).nullable() }).strict()),
  constraints: z.array(z.object({ constraintId: id, result: z.enum(['PASS', 'FAIL', 'NOT_EVALUATED']), reason: z.string().max(100).nullable() }).strict()),
  objectives: z.array(z.object({ objectiveId: id, status: MetricStatusSchema, value: ExactSchema.nullable(), normalized: ExactSchema.nullable(),
    clamped: z.boolean(), weight: z.number().int().nullable(), contribution: ExactSchema.nullable() }).strict()),
  score: ExactSchema.nullable(), rank: z.number().int().positive().nullable(),
  paretoStatus: z.enum(['NON_DOMINATED', 'DOMINATED', 'NOT_ELIGIBLE', 'NOT_COMPUTED']), dominatedBy: z.array(hash).max(5),
  architectureMutation: z.literal('NONE'), adoption: z.object({ parametricEdits: z.array(edit).max(SLOT_COUNT), apply: z.literal('ATOMIC') }).strict(),
}).strict();
export type Candidate = z.infer<typeof CandidateSchema>;

export const StudySchema = z.object({
  version: z.literal(OPTIMIZATION_STUDY_VERSION),
  binding: z.object({ projectId: z.string().min(1).max(100), sourceRevisionId: z.string().min(1).max(100), sourceModelHash: hash,
    generatorVersion: z.literal(OPTIMIZATION_SOURCE_GENERATOR), seed: z.string().min(1).max(128), parameterHash: hash }).strict(),
  input: OptimizationInputSchema, inputHash: hash,
  engine: z.object({ optimizerVersion: z.literal(OPTIMIZER_VERSION), metricsVersion: z.literal(OPTIMIZATION_METRICS_VERSION), candidateIdVersion: z.literal(OPTIMIZATION_CANDIDATE_VERSION) }).strict(),
  status: z.enum(['COMPLETED', 'NO_VALID_CANDIDATE', 'BUDGET_EXHAUSTED']),
  search: z.object({ candidateSpaceSize: z.string().regex(/^[0-9]+$/), evaluatedAssignments: z.number().int().nonnegative(), candidates: z.number().int().nonnegative(),
    valid: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(), partial: z.number().int().nonnegative(),
    inputIncomplete: z.number().int().nonnegative(), deduplicated: z.number().int().nonnegative() }).strict(),
  baseline: z.object({ candidateId: hash, parameters }).strict(),
  cost: z.object({ basis: z.literal('PRICED_SCOPE_ONLY'), rateBookId: z.string(), currency: z.string().max(8), baselineScopeSignature: hash,
    baselineExcludedScopes: z.array(z.string().max(200)).max(16), baselineCompleteTotalAvailable: z.boolean() }).strict().nullable(),
  candidates: z.array(CandidateSchema),
  normalization: z.array(z.object({ objectiveId: id, method: z.enum(['EXPLICIT_BOUNDS', 'CANDIDATE_RANGE', 'TARGET_TOLERANCE']),
    best: ExactSchema.nullable(), worst: ExactSchema.nullable(), target: ExactSchema.nullable(), tolerance: ExactSchema.nullable(), degenerate: z.boolean() }).strict()),
  paretoFrontier: z.array(hash), recommendedCandidates: z.array(hash),
  engineering: z.object({ structural: z.literal('NOT_EVALUATED'), environmental: z.literal('NOT_EVALUATED'), systems: z.literal('NOT_EVALUATED'),
    knowledge: z.literal('NOT_EVALUATED'), reason: z.literal(ENGINEERING.reason), phase27: z.literal(ENGINEERING.phase27) }).strict(),
  limits: z.object(Object.fromEntries(Object.keys(OPTIMIZATION_LIMITS).map(k => [k, z.number().int()])) as Record<keyof typeof OPTIMIZATION_LIMITS, z.ZodNumber>).strict(),
  claims: z.object({ searchResult: z.enum(['BEST_IN_EVALUATED_SEARCH_SPACE', 'BEST_FOUND', 'NONE']),
    ...Object.fromEntries(Object.keys(CLAIMS).map(k => [k, z.literal('NOT_CLAIMED')])) as Record<keyof typeof CLAIMS, z.ZodLiteral<'NOT_CLAIMED'>> }).strict(),
  resultHash: hash,
}).strict();
export type Study = z.infer<typeof StudySchema>;

/** In-memory evidence for the independent validator; never persisted. */
export interface CandidateEvidence { model: BuildingModelV2 | null; qa: unknown; takeoff: unknown; cost: unknown }

/** Persisted study rows (migration 0018) as returned by optimization_read / optimization_write. */
const uuid = z.string().uuid();
export const OptimizationSummarySchema = z.object({ id: uuid, projectRevisionId: uuid, acceptanceQaId: uuid, studyVersion: z.literal(OPTIMIZATION_STUDY_VERSION),
  optimizerVersion: z.literal(OPTIMIZER_VERSION), modelHash: hash, inputHash: hash, resultHash: hash, strategy: z.enum(['GRID', 'DETERMINISTIC_LOCAL_SEARCH']),
  mode: z.enum(['WEIGHTED_SCORE', 'PARETO']), status: z.enum(['COMPLETED', 'NO_VALID_CANDIDATE', 'BUDGET_EXHAUSTED']), candidateCount: z.number().int().min(1).max(128),
  validCount: z.number().int().nonnegative(), searchResult: z.enum(['BEST_IN_EVALUATED_SEARCH_SPACE', 'BEST_FOUND', 'NONE']), recommendedCandidates: z.array(hash).max(128),
  createdAt: z.string().datetime({ offset: true }) }).strict();
export const OptimizationDetailSchema = OptimizationSummarySchema.extend({ snapshot: StudySchema });
export const OptimizationCursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: uuid }).strict();
export const OptimizationReadQuerySchema = z.object({ require: z.literal('current').optional() }).strict();
