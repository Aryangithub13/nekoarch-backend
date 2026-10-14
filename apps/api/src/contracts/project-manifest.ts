import { z } from 'zod';
import { CAUSE_CODES, DEPENDENCY_GRAPH_VERSION, NODE_STATES } from './dependency-graph.js';
import { DIFF_COLLECTIONS, DIFF_VERSION } from '../verification/contracts.js';

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

/**
 * Change metadata (ROADMAP B37 L253, L260: `diff`, `lineage`, per-discipline change impact). Every revision has exactly one parent, the project's
 * previous current revision (`0006`: revision_number = parent's + 1, same project), so the comparison is always against that parent.
 */
export const LINEAGE_STATUSES = ['ROOT', 'LINKED', 'INCONSISTENT', 'UNAVAILABLE'] as const;
export const LINEAGE_REASONS = ['PARENT_UNREADABLE', 'PARENT_NUMBER_MISMATCH', 'PARENT_IDENTITY_INCONSISTENT', 'ROOT_PARENT_MISMATCH', 'OPERATION_BASE_MISMATCH',
  'OPERATION_TARGET_MISMATCH'] as const;
export const COMPARISON_STATUSES = ['COMPUTED', 'NO_PARENT', 'UNAVAILABLE'] as const;
export const DIFF_UNAVAILABLE_REASONS = ['PARENT_UNREADABLE', 'LINEAGE_INCONSISTENT'] as const;
/** At most this many entity changes are listed; counts always cover every change. */
export const MANIFEST_DIFF_CHANGE_LIMIT = 200;
/**
 * Impact is model binding only: every derived output is bound to the whole revision model (Phase 37 MODEL_HASH and fingerprint checks), so a changed
 * model hash means outputs derived from the parent cannot be reused here. It is not a statement of physical or engineering effect.
 */
export const IMPACT_REASONS = ['MODEL_ENTITIES_CHANGED', 'MODEL_CHANGED_OUTSIDE_DIFF_COLLECTIONS', 'BOUND_TO_CHANGED_MODEL', 'MODEL_UNCHANGED'] as const;

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), nodeId = z.string().min(1).max(200);
const diffCollection = z.enum([...DIFF_COLLECTIONS, 'site']);
export const LineageSchema = z.object({
  status: z.enum(LINEAGE_STATUSES), revisionNumber: z.number().int().positive(), parentRevisionId: id.nullable(),
  parent: z.object({ revisionId: id, revisionNumber: z.number().int().positive(), modelHash: hash, createdAt: z.string() }).strict().nullable(),
  modelEquivalentToParent: z.boolean().nullable(),
  /** Phase 30 operation that committed this revision: NONE (an ordinary save or generation), RECORDED, or UNAVAILABLE on a backend without operations. */
  operation: z.object({ status: z.enum(['NONE', 'RECORDED', 'UNAVAILABLE']), operationId: id.nullable(), kind: z.enum(['APPEARANCE_MODIFY', 'RESTORE']).nullable(),
    baseRevisionId: id.nullable(), restoreSourceRevisionId: id.nullable(),
    /** As reported by the Phase 30 lineage read (its own comparison of this revision's model with the operation's base); null when not recorded. */
    modelEquivalentToBase: z.boolean().nullable() }).strict(),
  reasons: z.array(z.enum(LINEAGE_REASONS)),
}).strict();
export const DiffSchema = z.object({
  status: z.enum(COMPARISON_STATUSES), diffVersion: z.literal(DIFF_VERSION).nullable(), baseRevisionId: id.nullable(), baseModelHash: hash.nullable(), modelHash: hash,
  modelHashChanged: z.boolean().nullable(), entitiesIdentical: z.boolean().nullable(),
  counts: z.object({ added: z.number().int().min(0), removed: z.number().int().min(0), changed: z.number().int().min(0) }).strict().nullable(),
  collections: z.array(z.object({ collection: diffCollection, added: z.number().int().min(0), removed: z.number().int().min(0), changed: z.number().int().min(0) }).strict()),
  changes: z.array(z.object({ collection: diffCollection, entityId: z.string().min(1).max(200), change: z.enum(['ADDED', 'REMOVED', 'CHANGED']),
    levelIds: z.array(z.string()).max(2) }).strict()).max(MANIFEST_DIFF_CHANGE_LIMIT),
  changesTruncated: z.boolean(), unavailableReason: z.enum(DIFF_UNAVAILABLE_REASONS).nullable(),
  /** The existing BIM semantic diff of this revision against its parent (`…/bim/diff/:parentRevisionId`); null without a parent. BIM profile limits apply there. */
  bimDiffHref: z.string().startsWith('/api/projects/').nullable(),
}).strict();
export const ChangeImpactSchema = z.object({
  status: z.enum(COMPARISON_STATUSES), basis: z.literal('MODEL_BINDING'), baseRevisionId: id.nullable(),
  disciplines: z.array(z.object({ discipline: z.enum(DISCIPLINES), impact: z.enum(['AFFECTED', 'NOT_AFFECTED']), reason: z.enum(IMPACT_REASONS),
    modules: z.array(z.enum(MODULES)), changedCollections: z.array(diffCollection) }).strict()),
}).strict();
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
/**
 * What the manifest's own freshness asks of each discipline, against the project's current revision (ROADMAP L262): modules to regenerate (stale),
 * revalidate (blocked) or await (pending), with artifact counts. Read only from module freshness, so it never reads better than that freshness.
 */
export const FreshnessImpactSchema = z.object({ targetRevisionId: id.nullable(),
  disciplines: z.array(z.object({ discipline: z.enum(DISCIPLINES), regenerate: z.array(z.enum(MODULES)), revalidate: z.array(z.enum(MODULES)),
    awaiting: z.array(z.enum(MODULES)), staleArtifacts: z.number().int().min(0), blockedArtifacts: z.number().int().min(0) }).strict()) }).strict();
export const ProjectManifestSchema = z.object({
  manifestVersion: z.literal(PROJECT_MANIFEST_VERSION),
  identity: z.object({ projectId: id, revisionId: id, revisionNumber: z.number().int().positive(), parentRevisionId: id.nullable(),
    projectCurrentRevisionId: id.nullable(), revisionCurrency: z.enum(['CURRENT', 'HISTORICAL', 'NO_CURRENT_REVISION']), modelHash: hash,
    acceptanceQaId: id, createdAt: z.string() }).strict(),
  canonicalModel: z.object({ schemaVersion: z.literal(2), completeness: z.literal('architectural'), units: z.literal('mm'),
    coordinateSystem: z.literal('x-right-y-up-z-depth'),
    site: z.object({ present: z.boolean(), northMilliDegrees: z.number().int().nullable(), referenceDatum: z.string().nullable() }).strict(),
    counts: z.object({ levels: z.number().int(), spaces: z.number().int(), walls: z.number().int(), openings: z.number().int() }).strict() }).strict(),
  lineage: LineageSchema, diff: DiffSchema, changeImpact: ChangeImpactSchema, freshnessImpact: FreshnessImpactSchema,
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
export type Lineage = z.infer<typeof LineageSchema>;
export type ManifestDiff = z.infer<typeof DiffSchema>;
export type ChangeImpact = z.infer<typeof ChangeImpactSchema>;
export type FreshnessImpact = z.infer<typeof FreshnessImpactSchema>;
