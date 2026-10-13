import { z } from 'zod';

/** Phase 37: read-only provenance graph of one revision's stored artifacts. Provenance only, never a statement of engineering correctness. */
export const DEPENDENCY_GRAPH_VERSION = 'dependency-graph-v1';
export const GRAPH_FAMILIES = ['REVISION', 'ACCEPTANCE_QA', 'QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST', 'STRUCTURAL_ANALYSIS',
  'ENVIRONMENTAL_ANALYSIS', 'BUILDING_SYSTEMS_ANALYSIS', 'SPECIALIZED_KNOWLEDGE', 'DESIGN_OPTIMIZATION', 'SCENE_3D'] as const;
/** UNVERIFIED closes the fail-closed gap: a node whose identity, links or hashes cannot be verified is never CURRENT or merely stale. */
export const NODE_STATES = ['CURRENT', 'STALE_SOURCE_CHANGED', 'STALE_UPSTREAM_STALE', 'UNVERIFIED'] as const;
export const FAMILY_STATES = [...NODE_STATES, 'NOT_GENERATED'] as const;
export const EDGE_KINDS = ['QA_OF', 'BOUND_TO_REVISION', 'ACCEPTED_BY', 'DERIVED_FROM'] as const;
/** Checks in evaluation order, each with the cause code it reports on failure. */
export const CHECK_FAILURES = {
  REVISION_IDENTITY: 'REVISION_IDENTITY_INCONSISTENT', QA_ACCEPTANCE: 'QA_NOT_ACCEPTED', REVISION_BINDING: 'REVISION_BINDING_MISMATCH',
  QA_BINDING: 'QA_BINDING_MISMATCH', UPSTREAM_PRESENT: 'UPSTREAM_MISSING', LINK_CONSISTENCY: 'LINK_INCONSISTENT', MODEL_HASH: 'MODEL_HASH_MISMATCH',
  INPUT_FINGERPRINT: 'FINGERPRINT_MISMATCH', INPUT_HASH: 'INPUT_HASH_MISMATCH', REPORT_HASH: 'REPORT_HASH_MISMATCH',
} as const;
export const CHECKS = ['REVISION_IDENTITY', 'QA_ACCEPTANCE', 'REVISION_BINDING', 'QA_BINDING', 'UPSTREAM_PRESENT', 'LINK_CONSISTENCY', 'MODEL_HASH',
  'INPUT_FINGERPRINT', 'INPUT_HASH', 'REPORT_HASH'] as const satisfies readonly (keyof typeof CHECK_FAILURES)[];
export const CAUSE_CODES = ['REVISION_IDENTITY_INCONSISTENT', 'QA_NOT_ACCEPTED', 'REVISION_BINDING_MISMATCH', 'QA_BINDING_MISMATCH', 'UPSTREAM_MISSING',
  'LINK_INCONSISTENT', 'MODEL_HASH_MISMATCH', 'FINGERPRINT_MISMATCH', 'INPUT_HASH_MISMATCH', 'REPORT_HASH_MISMATCH', 'NO_CURRENT_REVISION', 'UPSTREAM_UNVERIFIED', 'UPSTREAM_STALE',
  'SOURCE_REVISION_SUPERSEDED'] as const satisfies readonly string[];
export const GRAPH_LIMIT_KINDS = ['NODES', 'FAMILY_PAGE', 'DEPTH', 'TIME'] as const;

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), nodeId = z.string().min(1).max(200);
export const GraphCauseSchema = z.object({ code: z.enum(CAUSE_CODES), nodeId }).strict();
export const GraphNodeSchema = z.object({
  nodeId, family: z.enum(GRAPH_FAMILIES), artifactId: id, revisionId: id, createdAt: z.string(), state: z.enum(NODE_STATES),
  checks: z.array(z.object({ check: z.enum(CHECKS), result: z.enum(['VERIFIED', 'FAILED']) }).strict()),
  causes: z.array(GraphCauseSchema),
}).strict();
export const DependencyGraphSchema = z.object({
  graphVersion: z.literal(DEPENDENCY_GRAPH_VERSION), complete: z.literal(true),
  inputIdentity: z.object({ projectId: id, revisionId: id, modelHash: hash, projectCurrentRevisionId: id.nullable() }).strict(),
  families: z.array(z.object({ family: z.enum(GRAPH_FAMILIES), state: z.enum(FAMILY_STATES), nodeIds: z.array(nodeId) }).strict()),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(z.object({ from: nodeId, to: nodeId, kind: z.enum(EDGE_KINDS) }).strict()),
  limits: z.object({ maxNodes: z.number().int(), maxDepth: z.number().int(), familyPage: z.number().int(), timeBudgetMs: z.number().int() }).strict(),
  notRepresented: z.array(z.object({ item: z.string(), reason: z.enum(['DERIVED_ON_READ', 'NOT_A_MODEL_DERIVED_ARTIFACT']) }).strict()),
  claims: z.object({ engineeringCorrectness: z.literal('NOT_CLAIMED'), solverValidation: z.literal('NOT_CLAIMED'), professionalReview: z.literal('NOT_CLAIMED') }).strict(),
  graphHash: hash,
}).strict();
export type GraphFamily = typeof GRAPH_FAMILIES[number];
export type NodeState = typeof NODE_STATES[number];
export type GraphCheck = keyof typeof CHECK_FAILURES;
export type GraphCause = z.infer<typeof GraphCauseSchema>;
export type DependencyGraph = z.infer<typeof DependencyGraphSchema>;
