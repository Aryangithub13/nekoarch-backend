import { z } from 'zod';
import { CAUSE_CODES, DEPENDENCY_GRAPH_VERSION, NODE_STATES } from './dependency-graph.js';

/**
 * B37 completion slice: Unified Project Manifest v2 (roadmap §B Phase 37, L257–260). Derived on read from one revision read, the Phase 37 dependency
 * graph and the revision's advisory design-concept listing. Read-only, owner-only. A freshness state is provenance, never a statement of engineering
 * correctness: nothing here upgrades an engineering status, a blocker or a claim.
 */
export const PROJECT_MANIFEST_VERSION = 'project-manifest-v2';
export const PROJECT_MANIFEST_ROUTE = '/api/projects/:projectId/revisions/:revisionId/manifest';
/** Roadmap invalidation vocabulary (§B Phase 37, L251), verbatim. */
export const FRESHNESS_STATES = ['current', 'stale', 'pending', 'blocked', 'not_applicable', 'verified'] as const;
export type FreshnessState = typeof FRESHNESS_STATES[number];
/** How each `dependency-graph-v1` state maps to the roadmap vocabulary. UNVERIFIED fails closed: never current, never verified. */
export const GRAPH_STATE_MAPPING = Object.freeze({
  CURRENT: 'current', STALE_SOURCE_CHANGED: 'stale', STALE_UPSTREAM_STALE: 'stale', UNVERIFIED: 'blocked',
} as const satisfies Record<typeof NODE_STATES[number], FreshnessState>);
/** Which roadmap states this version assigns, and from what evidence. `not_applicable` and `verified` are reserved and never assigned in v2. */
export const FRESHNESS_ASSIGNMENT = Object.freeze([
  { state: 'current', assigned: true, basis: 'Every Phase 37 provenance check passed for the output and its chain, and its revision is the project current revision' },
  { state: 'stale', assigned: true, basis: 'Checks passed, but the source revision was superseded (SOURCE_REVISION_SUPERSEDED) or an input it derives from is stale (UPSTREAM_STALE)' },
  { state: 'pending', assigned: true, basis: 'No output exists for this revision yet, and a queued or running durable job will produce one (JOB_ACTIVE)' },
  { state: 'blocked', assigned: true, basis: 'An identity, link or hash could not be verified (Phase 37 UNVERIFIED), or there is no current revision; fail closed' },
  { state: 'not_applicable', assigned: false, basis: 'Reserved: this version has no evidence-backed rule for when a module does not apply to a revision' },
  { state: 'verified', assigned: false, basis: 'Reserved: no output carries independent validation evidence that this backend can check; provenance integrity is not verification' },
] as const satisfies readonly { state: FreshnessState; assigned: boolean; basis: string }[]);
export const MANIFEST_REASON_CODES = [...CAUSE_CODES, 'JOB_ACTIVE'] as const;
export const DISCIPLINES = ['ARCHITECTURE', 'QUANTITIES_AND_COST', 'ENGINEERING', 'DESIGN', 'VISUALIZATION', 'DOCUMENTATION'] as const;
export const MODULES = ['BUILDING_MODEL', 'ACCEPTANCE_QA', 'BIM', 'COMPLEX_VERIFICATION', 'QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST',
  'STRUCTURAL_ANALYSIS', 'ENVIRONMENTAL_ANALYSIS', 'BUILDING_SYSTEMS_ANALYSIS', 'SPECIALIZED_KNOWLEDGE', 'ENGINEERING_ASSESSMENT', 'DESIGN_OPTIMIZATION',
  'DESIGN_CONCEPTS', 'SCENE_3D', 'CONSTRUCTION_DOCUMENTS'] as const;
export type ManifestModule = typeof MODULES[number];
export const AVAILABILITY = ['AVAILABLE', 'NOT_GENERATED', 'DERIVED_ON_READ', 'UNAVAILABLE'] as const;
export const EDITABILITY = ['NEW_REVISION_ONLY', 'DERIVED_READ_ONLY', 'ADVISORY_READ_ONLY'] as const;
export const SOURCE_KINDS = ['REVISION', 'STORED_ARTIFACT', 'DERIVED_ON_READ', 'ADVISORY_ARTIFACT'] as const;
export const MISSING_REASONS = ['NOT_GENERATED_FOR_REVISION', 'PERSISTENCE_UNAVAILABLE'] as const;
/** Revision-bound outputs this version does not represent, each with a reason. */
export const NOT_INCLUDED = Object.freeze([
  ...['EVIDENCE_PACKAGES', 'ZONE_ASSESSMENT', 'ZONE_PARTITIONS', 'APPEARANCE_VARIANT'].map(item => ({ item, reason: 'NOT_IN_THIS_VERSION' as const })),
  ...['REFERENCE_LIBRARY', 'PROJECT_CONTEXT', 'CONVERSATIONS', 'WORKFLOW_RUNS', 'COMPUTE_DISPATCHES'].map(item => ({ item, reason: 'NOT_A_REVISION_OUTPUT' as const })),
]);

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), nodeId = z.string().min(1).max(200);
const freshness = z.enum(FRESHNESS_STATES);
const ReasonSchema = z.object({ code: z.enum(MANIFEST_REASON_CODES), nodeId: nodeId.nullable() }).strict();
const FreshnessSchema = z.object({ state: freshness, reasons: z.array(ReasonSchema), sourceRevisionId: id, targetRevisionId: id.nullable() }).strict();
export const ManifestArtifactSchema = z.object({ artifactId: id, nodeId: nodeId.nullable(), revisionId: id, createdAt: z.string(),
  graphState: z.enum(NODE_STATES).nullable(), freshness: FreshnessSchema }).strict();
export const ManifestModuleSchema = z.object({
  module: z.enum(MODULES), discipline: z.enum(DISCIPLINES), version: z.string().max(100), href: z.string().startsWith('/api/projects/'),
  source: z.enum(SOURCE_KINDS), editability: z.enum(EDITABILITY), availability: z.enum(AVAILABILITY),
  completeness: z.enum(['COMPLETE', 'TRUNCATED']), freshness: FreshnessSchema.nullable(), missingReason: z.enum(MISSING_REASONS).nullable(),
  activeJobIds: z.array(id), artifacts: z.array(ManifestArtifactSchema),
}).strict();
export const ProjectManifestSchema = z.object({
  manifestVersion: z.literal(PROJECT_MANIFEST_VERSION),
  identity: z.object({ projectId: id, revisionId: id, revisionNumber: z.number().int().positive(), parentRevisionId: id.nullable(),
    projectCurrentRevisionId: id.nullable(), revisionCurrency: z.enum(['CURRENT', 'HISTORICAL', 'NO_CURRENT_REVISION']), modelHash: hash,
    acceptanceQaId: id, createdAt: z.string() }).strict(),
  canonicalModel: z.object({ schemaVersion: z.literal(2), completeness: z.literal('architectural'), units: z.literal('mm'),
    coordinateSystem: z.literal('x-right-y-up-z-depth'),
    site: z.object({ present: z.boolean(), northMilliDegrees: z.number().int().nullable(), referenceDatum: z.string().nullable() }).strict(),
    counts: z.object({ levels: z.number().int(), spaces: z.number().int(), walls: z.number().int(), openings: z.number().int() }).strict() }).strict(),
  configuration: z.object({ sourceMode: z.enum(['generated', 'supplied']), generatorVersion: z.string().nullable(), generationIdentity: z.unknown().nullable() }).strict(),
  modules: z.array(ManifestModuleSchema),
  disciplines: z.array(z.object({ discipline: z.enum(DISCIPLINES), freshness: freshness.nullable(), modules: z.array(z.enum(MODULES)) }).strict()),
  freshnessVocabulary: z.object({ states: z.array(z.object({ state: freshness, assigned: z.boolean(), basis: z.string() }).strict()),
    graphStateMapping: z.record(z.enum(NODE_STATES), freshness) }).strict(),
  verification: z.object({ scope: z.literal('PROVENANCE_INTEGRITY'), graphVersion: z.literal(DEPENDENCY_GRAPH_VERSION), graphHash: hash,
    nodeStates: z.record(z.enum(NODE_STATES), z.number().int().min(0)) }).strict(),
  accessPolicy: z.object({ visibility: z.literal('OWNER_ONLY'), enforcement: z.literal('OWNER_SCOPED_READS_AND_ROW_LEVEL_SECURITY') }).strict(),
  notIncluded: z.array(z.object({ item: z.string(), reason: z.enum(['NOT_IN_THIS_VERSION', 'NOT_A_REVISION_OUTPUT']) }).strict()),
  claims: z.object({ engineeringCorrectness: z.literal('NOT_CLAIMED'), solverValidation: z.literal('NOT_CLAIMED'), professionalReview: z.literal('NOT_CLAIMED') }).strict(),
  /** Read time of the integrity recomputation (roadmap `last_verified`). Not covered by manifestHash, so the hash is deterministic per stored state. */
  integrityCheckedAt: z.string().datetime(),
  manifestHash: hash,
}).strict();
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;
export type ManifestModuleEntry = z.infer<typeof ManifestModuleSchema>;
