import { costHash } from '@designflow/boq-cost';
import type { BuildingModelV2 } from '@designflow/shared';
import { scopedDiff } from '../verification/diff.js';
import { modelHash } from '../lib/generation-identity.js';
import type { z } from 'zod';
import type { ProjectRevisionDetailSchema } from '../contracts/projects.js';
import type { DesignConceptSummarySchema } from '../contracts/design-concepts.js';
import { NODE_STATES, type DependencyGraph, type GraphFamily, type NodeState } from '../contracts/dependency-graph.js';
import { CANDIDATE_STATUSES, DISCIPLINES, FRESHNESS_ASSIGNMENT, GRAPH_STATE_MAPPING, MANIFEST_DIFF_CHANGE_LIMIT, MODULES, NOT_INCLUDED, PROJECT_MANIFEST_VERSION,
  ProjectManifestSchema, type ChangeImpact, type FreshnessState, type Lineage, type ManifestDiff, type ManifestModule, type ManifestModuleEntry, type ManifestQuery,
  type ProjectManifest } from '../contracts/project-manifest.js';
import { SERVICES } from '../services/overview-service.js';
import { SCHEDULE_IDS } from '../documents/schedules.js';

/** The revision fields the manifest reads; a full revision detail satisfies it. */
type Revision = Pick<z.infer<typeof ProjectRevisionDetailSchema>, 'id' | 'revisionNumber' | 'parentRevisionId' | 'createdAt' | 'completeness' | 'sourceMode'
  | 'generatorVersion' | 'identity' | 'model'> & { qa: { id: string; qaVersion: string } };
type Concept = z.infer<typeof DesignConceptSummarySchema>;
type Freshness = NonNullable<ManifestModuleEntry['freshness']>;
type Reason = Freshness['reasons'][number];
type Artifact = NonNullable<ManifestModuleEntry['artifacts']>[number];
/** `regenerable: false`: part of the revision itself (its model, acceptance QA, committed appearance). When superseded it is replaced, never regenerated. */
type Def = { module: ManifestModule; discipline: typeof DISCIPLINES[number]; source: ManifestModuleEntry['source']; editability: ManifestModuleEntry['editability'];
  family?: GraphFamily; serviceId?: string; route?: string; regenerable?: false };

const REVISION_ROUTE = '/api/projects/:projectId/revisions/:revisionId';
/** One row per module, in output order. Stored modules read their state from the Phase 37 graph family of the same name. */
const DEFS: readonly Def[] = Object.freeze([
  { module: 'BUILDING_MODEL', discipline: 'ARCHITECTURE', source: 'REVISION', editability: 'NEW_REVISION_ONLY', family: 'REVISION', serviceId: 'BUILDING_MODEL',
    regenerable: false },
  { module: 'ACCEPTANCE_QA', discipline: 'ARCHITECTURE', source: 'STORED_ARTIFACT', editability: 'DERIVED_READ_ONLY', family: 'ACCEPTANCE_QA', route: REVISION_ROUTE,
    regenerable: false },
  { module: 'BIM', discipline: 'ARCHITECTURE', source: 'DERIVED_ON_READ', editability: 'DERIVED_READ_ONLY', serviceId: 'BIM' },
  { module: 'COMPLEX_VERIFICATION', discipline: 'ARCHITECTURE', source: 'DERIVED_ON_READ', editability: 'DERIVED_READ_ONLY', serviceId: 'COMPLEX_VERIFICATION' },
  { module: 'QUANTITY_TAKEOFF', discipline: 'QUANTITIES_AND_COST', source: 'STORED_ARTIFACT', editability: 'DERIVED_READ_ONLY', family: 'QUANTITY_TAKEOFF', serviceId: 'QUANTITY_TAKEOFF' },
  { module: 'CONSTRUCTION_CALCULATION', discipline: 'QUANTITIES_AND_COST', source: 'STORED_ARTIFACT', editability: 'DERIVED_READ_ONLY', family: 'CONSTRUCTION_CALCULATION',
    serviceId: 'CONSTRUCTION_CALCULATION', route: `${REVISION_ROUTE}/takeoffs` },
  { module: 'BOQ_COST', discipline: 'QUANTITIES_AND_COST', source: 'STORED_ARTIFACT', editability: 'DERIVED_READ_ONLY', family: 'BOQ_COST', serviceId: 'BOQ_COST' },
  { module: 'STRUCTURAL_ANALYSIS', discipline: 'ENGINEERING', source: 'STORED_ARTIFACT', editability: 'DERIVED_READ_ONLY', family: 'STRUCTURAL_ANALYSIS', serviceId: 'STRUCTURAL_ANALYSIS' },
  { module: 'ENVIRONMENTAL_ANALYSIS', discipline: 'ENGINEERING', source: 'STORED_ARTIFACT', editability: 'DERIVED_READ_ONLY', family: 'ENVIRONMENTAL_ANALYSIS', serviceId: 'ENVIRONMENTAL_ANALYSIS' },
  { module: 'BUILDING_SYSTEMS_ANALYSIS', discipline: 'ENGINEERING', source: 'STORED_ARTIFACT', editability: 'DERIVED_READ_ONLY', family: 'BUILDING_SYSTEMS_ANALYSIS',
    serviceId: 'BUILDING_SYSTEMS_ANALYSIS' },
  { module: 'SPECIALIZED_KNOWLEDGE', discipline: 'ENGINEERING', source: 'STORED_ARTIFACT', editability: 'DERIVED_READ_ONLY', family: 'SPECIALIZED_KNOWLEDGE', serviceId: 'SPECIALIZED_KNOWLEDGE' },
  { module: 'ENGINEERING_ASSESSMENT', discipline: 'ENGINEERING', source: 'DERIVED_ON_READ', editability: 'DERIVED_READ_ONLY', serviceId: 'ENGINEERING_ASSESSMENT' },
  { module: 'DESIGN_OPTIMIZATION', discipline: 'DESIGN', source: 'STORED_ARTIFACT', editability: 'DERIVED_READ_ONLY', family: 'DESIGN_OPTIMIZATION', serviceId: 'DESIGN_OPTIMIZATION' },
  { module: 'DESIGN_CONCEPTS', discipline: 'DESIGN', source: 'ADVISORY_ARTIFACT', editability: 'ADVISORY_READ_ONLY', serviceId: 'DESIGN_CONCEPTS' },
  { module: 'SCENE_3D', discipline: 'VISUALIZATION', source: 'STORED_ARTIFACT', editability: 'DERIVED_READ_ONLY', family: 'SCENE_3D', serviceId: 'SCENE_3D' },
  // The visible 3D object of a revision committed by a Phase 30 appearance operation (ROADMAP L262). Committed with the revision; changed only by a new one.
  { module: 'APPEARANCE_VARIANT', discipline: 'VISUALIZATION', source: 'STORED_ARTIFACT', editability: 'NEW_REVISION_ONLY', serviceId: 'SELECTIVE_REVISION',
    route: `${REVISION_ROUTE}/appearance`, regenerable: false },
  { module: 'CONSTRUCTION_DOCUMENTS', discipline: 'DOCUMENTATION', source: 'DERIVED_ON_READ', editability: 'DERIVED_READ_ONLY', serviceId: 'CONSTRUCTION_DOCUMENTS' },
] as const satisfies readonly Def[]);
if (DEFS.map(d => d.module).join() !== MODULES.join()) throw new Error('Manifest module table and contract disagree');

/**
 * Roadmap L259: the existing paged, filterable or partial views of a module's resource for this revision. Modules not listed have no such view yet.
 * `each` expands one route into one view per storey (plan sheets exist for storey levels only) or per schedule.
 */
const page = (path: string, paging: ManifestModuleEntry['views'][number]['paging'] = 'CURSOR', filters: string[] = [], each?: 'STOREY' | 'SCHEDULE') =>
  ({ route: `${REVISION_ROUTE}/${path}`, paging, filters, each });
const VIEWS: Partial<Record<ManifestModule, readonly ReturnType<typeof page>[]>> = Object.freeze({
  BIM: [page('bim/elements', 'AFTER_ID', ['kind']), page('bim/relationships', 'AFTER_ID', ['kind'])],
  QUANTITY_TAKEOFF: [page('takeoffs')], BOQ_COST: [page('cost-estimates')],
  STRUCTURAL_ANALYSIS: [page('structural/analyses')], ENVIRONMENTAL_ANALYSIS: [page('environmental/analyses')],
  BUILDING_SYSTEMS_ANALYSIS: [page('systems/analyses')], SPECIALIZED_KNOWLEDGE: [page('knowledge/analyses')],
  DESIGN_OPTIMIZATION: [page('optimization/studies')], DESIGN_CONCEPTS: [page('design-concepts')], SCENE_3D: [page('scene/artifacts')],
  CONSTRUCTION_DOCUMENTS: [page('documents/schedules', 'NONE'), page('documents/schedules/:schedule/csv', 'NONE', [], 'SCHEDULE'),
    page('documents/plan-sheets/:levelId', 'NONE', [], 'STOREY')],
});
export const MANIFEST_VIEW_ROUTES = Object.freeze(Object.values(VIEWS).flatMap(v => v.map(x => x.route)));
type ViewDef = ReturnType<typeof page>;

/** Durable-job kinds that produce a stored artifact of a manifest module (Phase 32 `SCENE_COMPILE`, `OPTIMIZATION_STUDY`). */
export const JOB_MODULES = Object.freeze({ SCENE_COMPILE: 'SCENE_3D', OPTIMIZATION_STUDY: 'DESIGN_OPTIMIZATION' } as const);
export type ActiveJob = { jobId: string; module: typeof JOB_MODULES[keyof typeof JOB_MODULES] };
/** Phase 30 committed appearance of this revision (`revision_operation_read` 'appearance'); `appearance` is null when the revision has none. */
export type AppearanceEvidence = { revisionId: string; appearance: unknown; appearanceHash: string | null; modelHash: string | null; operationId: string | null;
  artifact: { id: string; operationId: string; modelHash: string; appearanceHash: string; createdAt: string } | null };

/** The parent revision fields lineage and diff read. */
export type ParentRevision = Pick<z.infer<typeof ProjectRevisionDetailSchema>, 'id' | 'revisionNumber' | 'createdAt' | 'identity' | 'model'>;
/** Phase 30 lineage read (`revision_operation_read` 'lineage'): the operation that committed this revision, if any. */
export type OperationLineage = { operation: { id: string; kind: 'APPEARANCE_MODIFY' | 'RESTORE' | null; baseRevisionId: string; restoreSourceRevisionId: string | null;
  committedRevisionId: string | null } | null; modelEquivalentToBase: boolean | null };

export type ManifestInput = {
  projectId: string; revision: Revision; graph: DependencyGraph;
  /** `parent` is null for a root revision or when the parent could not be read (`parentReadable: false`). `operation` is null when this backend has no operations. */
  ancestry: { parent: ParentRevision | null; parentReadable: boolean; operation: OperationLineage | null };
  /** null when design-concept persistence is not configured on this backend. */
  designConcepts: { items: Concept[]; truncated: boolean } | null;
  /** null when durable-job persistence is not configured; otherwise the active jobs bound to this revision. */
  activeJobs: ActiveJob[] | null;
  /** null when durable-job persistence is not configured; otherwise the failed jobs bound to this revision among the newest examined (one bounded page). */
  failedJobs: { items: ActiveJob[]; truncated: boolean; window: number } | null;
  /** null when revision-operation persistence is not configured. */
  appearance: AppearanceEvidence | null;
  /** null when revision-operation persistence is not configured; otherwise the newest Phase 30 operations of the project (one bounded page). */
  operations: { items: Operation[]; truncated: boolean } | null;
  integrityCheckedAt: string;
};
type Operation = { id: string; baseRevisionId: string; kind: 'APPEARANCE_MODIFY' | 'RESTORE' | null; status: string; candidateHash: string | null; createdAt: string;
  expiresAt: string };

// blocked outranks stale outranks pending outranks current: an aggregate never reads better than its worst member.
const RANK: Record<FreshnessState, number> = { current: 0, pending: 1, stale: 2, blocked: 3, not_applicable: -1, verified: -1 };
const worst = (states: FreshnessState[]) => states.reduce<FreshnessState | null>((w, s) => w === null || RANK[s] > RANK[w] ? s : w, null);

/** Ancestry checks the stored schema guarantees (`0006`); a violation is reported, never repaired. */
export function buildLineage(revision: Revision, ancestry: ManifestInput['ancestry']): Lineage & { parentHash: string | null } {
  const { parent, parentReadable, operation } = ancestry, reasons: Lineage['reasons'] = [];
  const parentHash = parent ? modelHash(parent.model) : null;
  if (revision.parentRevisionId === null) { if (revision.revisionNumber !== 1) reasons.push('ROOT_PARENT_MISMATCH'); }
  else if (!parentReadable || !parent) reasons.push('PARENT_UNREADABLE');
  else {
    if (parent.id !== revision.parentRevisionId || parent.revisionNumber !== revision.revisionNumber - 1) reasons.push('PARENT_NUMBER_MISMATCH');
    if (parent.identity && parent.identity.modelHash !== parentHash) reasons.push('PARENT_IDENTITY_INCONSISTENT');
  }
  const op = operation?.operation ?? null;
  if (op) {
    if (op.baseRevisionId !== revision.parentRevisionId) reasons.push('OPERATION_BASE_MISMATCH');
    if (op.committedRevisionId !== revision.id) reasons.push('OPERATION_TARGET_MISMATCH');
  }
  const status = reasons.includes('PARENT_UNREADABLE') ? 'UNAVAILABLE' as const : reasons.length ? 'INCONSISTENT' as const
    : revision.parentRevisionId === null ? 'ROOT' as const : 'LINKED' as const;
  const linked = status === 'LINKED' || (status === 'INCONSISTENT' && !!parent);
  return { status, revisionNumber: revision.revisionNumber, parentRevisionId: revision.parentRevisionId,
    parent: parent && linked ? { revisionId: parent.id, revisionNumber: parent.revisionNumber, modelHash: parentHash!, createdAt: parent.createdAt } : null,
    modelEquivalentToParent: status === 'LINKED' ? parentHash === modelHash(revision.model) : null,
    operation: operation === null ? { status: 'UNAVAILABLE', operationId: null, kind: null, baseRevisionId: null, restoreSourceRevisionId: null, modelEquivalentToBase: null }
      : op ? { status: 'RECORDED', operationId: op.id, kind: op.kind, baseRevisionId: op.baseRevisionId, restoreSourceRevisionId: op.restoreSourceRevisionId,
        modelEquivalentToBase: operation.modelEquivalentToBase }
      : { status: 'NONE', operationId: null, kind: null, baseRevisionId: null, restoreSourceRevisionId: null, modelEquivalentToBase: null },
    reasons, parentHash };
}

/** Entity-level comparison with the parent through the Phase 34 `scopedDiff` (canonical hash per entity), only when the lineage is LINKED. */
export function buildDiff(projectId: string, revision: Revision, hash: string, parent: ParentRevision | null, lineage: Lineage & { parentHash: string | null }): ManifestDiff {
  // The BIM diff route compares its path revision (before) with its parameter (after); parent first, so it reads in the same direction as this diff.
  const bimDiffHref = revision.parentRevisionId ? `/api/projects/${projectId}/revisions/${revision.parentRevisionId}/bim/diff/${revision.id}` : null;
  const empty = { diffVersion: null, baseRevisionId: null, baseModelHash: null, modelHash: hash, modelHashChanged: null, entitiesIdentical: null, counts: null,
    collections: [], changes: [], changesTruncated: false, bimDiffHref };
  if (lineage.status === 'ROOT') return { ...empty, status: 'NO_PARENT', unavailableReason: null };
  if (lineage.status !== 'LINKED' || !parent) return { ...empty, status: 'UNAVAILABLE',
    unavailableReason: lineage.status === 'UNAVAILABLE' ? 'PARENT_UNREADABLE' : 'LINEAGE_INCONSISTENT' };
  const report = scopedDiff(parent.model as BuildingModelV2, revision.model as BuildingModelV2, { projectId,
    baseRevisionId: parent.id, otherRevisionId: revision.id, baseModelHash: lineage.parentHash!, otherModelHash: hash }, { levelIds: [], entityIds: [], allowSiteChange: true });
  // Entity changes only: a document-level edit is already reported by modelHashChanged and MODEL_CHANGED_OUTSIDE_DIFF_COLLECTIONS.
  const changes = report.changes.filter((c): c is typeof c & { collection: Exclude<typeof c.collection, 'document'> } => c.collection !== 'document');
  const collections = [...new Set(changes.map(c => c.collection))].map(collection => {
    const of = changes.filter(c => c.collection === collection);
    return { collection, added: of.filter(c => c.change === 'ADDED').length, removed: of.filter(c => c.change === 'REMOVED').length,
      changed: of.filter(c => c.change === 'CHANGED').length };
  });
  return { status: 'COMPUTED', diffVersion: report.diffVersion, baseRevisionId: parent.id, baseModelHash: lineage.parentHash, modelHash: hash,
    modelHashChanged: lineage.parentHash !== hash, entitiesIdentical: changes.length === 0,
    counts: { added: changes.filter(c => c.change === 'ADDED').length, removed: changes.filter(c => c.change === 'REMOVED').length,
      changed: changes.filter(c => c.change === 'CHANGED').length }, collections,
    changes: changes.slice(0, MANIFEST_DIFF_CHANGE_LIMIT).map(({ collection, entityId, change, levelIds }) => ({ collection, entityId, change, levelIds })),
    changesTruncated: changes.length > MANIFEST_DIFF_CHANGE_LIMIT, unavailableReason: null, bimDiffHref };
}

/** Per-discipline impact by model binding only (IMPACT_REASONS); computed only from a COMPUTED diff, never guessed. */
export function buildChangeImpact(diff: ManifestDiff): ChangeImpact {
  if (diff.status !== 'COMPUTED') return { status: diff.status, basis: 'MODEL_BINDING', baseRevisionId: null, disciplines: [] };
  const changed = diff.modelHashChanged === true, collections = diff.collections.map(c => c.collection);
  return { status: 'COMPUTED', basis: 'MODEL_BINDING', baseRevisionId: diff.baseRevisionId, disciplines: DISCIPLINES.map(discipline => {
    const modules = DEFS.filter(d => d.discipline === discipline).map(d => d.module);
    if (!changed) return { discipline, impact: 'NOT_AFFECTED' as const, reason: 'MODEL_UNCHANGED' as const, modules, changedCollections: [] };
    if (discipline === 'ARCHITECTURE') return { discipline, impact: 'AFFECTED' as const, modules, changedCollections: collections,
      reason: collections.length ? 'MODEL_ENTITIES_CHANGED' as const : 'MODEL_CHANGED_OUTSIDE_DIFF_COLLECTIONS' as const };
    return { discipline, impact: 'AFFECTED' as const, reason: 'BOUND_TO_CHANGED_MODEL' as const, modules, changedCollections: [] };
  }) };
}

/**
 * Pure and deterministic. Every state is taken from the Phase 37 graph or from a check repeated here on stored columns; nothing is inferred.
 * `verified` and `not_applicable` are never assigned (FRESHNESS_ASSIGNMENT).
 */
export function buildProjectManifest(input: ManifestInput): ProjectManifest {
  const { projectId, revision, graph } = input;
  const current = graph.inputIdentity.projectCurrentRevisionId, target = current;
  const href = (route: string) => route.replace(':projectId', projectId).replace(':revisionId', revision.id);
  const nodeById = new Map(graph.nodes.map(n => [n.nodeId, n]));
  const fromNode = (state: NodeState, causes: { code: Reason['code']; nodeId: string }[]): Freshness =>
    ({ state: GRAPH_STATE_MAPPING[state], reasons: causes.map(c => ({ code: c.code, nodeId: c.nodeId })), sourceRevisionId: revision.id, targetRevisionId: target });
  const familyNodes = (family: GraphFamily) => graph.families.find(f => f.family === family)!.nodeIds.map(id => nodeById.get(id)!);
  // Derived-on-read outputs are recomputed from the revision and its acceptance QA on every read, so they are exactly as fresh as those two nodes.
  const anchors = [...familyNodes('REVISION'), ...familyNodes('ACCEPTANCE_QA')];
  const anchorWorst = anchors.reduce((w, n) => NODE_STATES.indexOf(n.state) > NODE_STATES.indexOf(w.state) ? n : w);
  const anchorFreshness = fromNode(anchorWorst.state, anchorWorst.causes);

  // Phase 39 concept sets are not graph nodes; repeat the graph's checks that apply to them on their stored columns.
  const revisionKey = `REVISION:${revision.id}`, hash = graph.inputIdentity.modelHash;
  // A failed check fails closed (blocked) and is reported, never repaired; otherwise the output is exactly as fresh as its revision.
  const revisionBound = (failure: Reason['code'] | null): Freshness => {
    if (failure) return { ...anchorFreshness, state: 'blocked', reasons: [{ code: failure, nodeId: null }] };
    if (anchorFreshness.state === 'blocked') return { ...anchorFreshness, reasons: [{ code: 'UPSTREAM_UNVERIFIED', nodeId: anchorWorst.nodeId }, ...anchorFreshness.reasons] };
    return anchorFreshness.state === 'stale' ? { ...anchorFreshness, reasons: [{ code: 'SOURCE_REVISION_SUPERSEDED', nodeId: revisionKey }] } : anchorFreshness;
  };
  const conceptFreshness = (c: Concept): Freshness =>
    revisionBound(c.projectRevisionId !== revision.id ? 'REVISION_BINDING_MISMATCH' : c.modelHash !== hash ? 'MODEL_HASH_MISMATCH' : null);
  // Phase 30 appearances are not graph nodes either. Their stored binding, the model hash against the recomputed revision hash, the appearance hash
  // recomputed from the stored appearance, and the compiled artifact's link to both are all re-checked here. A RESTORE commits the source revision's
  // appearance under its own operation and reuses the source's artifact (0020 approve), so the artifact's operation may differ only when this revision's
  // recorded lineage shows that RESTORE committed it.
  const committedBy = input.ancestry.operation?.operation ?? null;
  const restoredBy = (operationId: string | null) => committedBy !== null && committedBy.kind === 'RESTORE' && committedBy.id === operationId
    && committedBy.committedRevisionId === revision.id;
  const appearanceFreshness = (a: AppearanceEvidence): Freshness => revisionBound(a.revisionId !== revision.id ? 'REVISION_BINDING_MISMATCH'
    : a.modelHash !== hash ? 'MODEL_HASH_MISMATCH' : a.appearanceHash !== costHash(a.appearance) ? 'INPUT_HASH_MISMATCH'
    : !a.artifact || a.artifact.modelHash !== a.modelHash || a.artifact.appearanceHash !== a.appearanceHash
      || (a.artifact.operationId !== a.operationId && !restoredBy(a.operationId)) ? 'LINK_INCONSISTENT'
    : null);

  const view = (v: ViewDef) => (v.each === 'STOREY' ? revision.model.levels.filter(l => l.kind === 'storey').map(l => v.route.replace(':levelId', encodeURIComponent(l.id)))
    : v.each === 'SCHEDULE' ? SCHEDULE_IDS.map(s => v.route.replace(':schedule', s)) : [v.route])
    .map(route => ({ href: href(route), paging: v.paging, filters: [...v.filters] }));
  const modules = DEFS.map((d): Omit<ManifestModuleEntry, 'artifactCount' | 'artifacts'> & { artifacts: Artifact[] } => {
    const service = d.serviceId ? SERVICES.find(s => s.serviceId === d.serviceId)! : null;
    const base = { module: d.module, discipline: d.discipline, version: service?.version ?? revision.qa.qaVersion, href: href(d.route ?? service!.route),
      source: d.source, editability: d.editability, completeness: 'COMPLETE' as const, missingReason: null, activeJobIds: [] as string[], failedJobIds: [] as string[],
      artifacts: [] as Artifact[], views: (VIEWS[d.module] ?? []).flatMap(view) };
    if (d.source === 'DERIVED_ON_READ') return { ...base, availability: 'DERIVED_ON_READ', freshness: anchorFreshness };
    if (d.module === 'APPEARANCE_VARIANT') {
      const a = input.appearance;
      if (!a) return { ...base, availability: 'UNAVAILABLE', freshness: null, missingReason: 'PERSISTENCE_UNAVAILABLE' };
      if (a.appearance === null) return { ...base, availability: 'NOT_GENERATED', freshness: null, missingReason: 'NOT_GENERATED_FOR_REVISION' };
      const freshness = appearanceFreshness(a);
      return { ...base, availability: 'AVAILABLE', freshness, artifacts: a.artifact
        ? [{ artifactId: a.artifact.id, nodeId: null, revisionId: a.revisionId, createdAt: a.artifact.createdAt, graphState: null, freshness }] : [] };
    }
    if (d.module === 'DESIGN_CONCEPTS') {
      if (!input.designConcepts) return { ...base, availability: 'UNAVAILABLE', freshness: null, missingReason: 'PERSISTENCE_UNAVAILABLE' };
      const ordered = [...input.designConcepts.items].sort((x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
      const artifacts = ordered.map(c => ({ artifactId: c.id, nodeId: null, revisionId: c.projectRevisionId, createdAt: c.createdAt, graphState: null,
        freshness: conceptFreshness(c) }));
      const state = worst(artifacts.map(a => a.freshness.state));
      return { ...base, completeness: input.designConcepts.truncated ? 'TRUNCATED' : 'COMPLETE', artifacts,
        availability: artifacts.length ? 'AVAILABLE' : 'NOT_GENERATED', missingReason: artifacts.length ? null : 'NOT_GENERATED_FOR_REVISION',
        freshness: state ? artifacts.find(a => a.freshness.state === state)!.freshness : null };
    }
    const nodes = familyNodes(d.family!);
    const artifacts = nodes.map(n => ({ artifactId: n.artifactId, nodeId: n.nodeId, revisionId: n.revisionId, createdAt: n.createdAt, graphState: n.state,
      freshness: fromNode(n.state, n.causes) }));
    const activeJobIds = (input.activeJobs ?? []).filter(j => j.module === d.module).map(j => j.jobId).sort();
    const failedJobIds = (input.failedJobs?.items ?? []).filter(j => j.module === d.module && !activeJobIds.includes(j.jobId)).map(j => j.jobId).sort();
    if (artifacts.length) {
      const family = graph.families.find(f => f.family === d.family)!;
      const representative = nodes.find(n => n.state === family.state)!;
      return { ...base, availability: 'AVAILABLE', activeJobIds, artifacts, freshness: fromNode(family.state as NodeState, representative.causes) };
    }
    // Nothing stored yet: pending only on evidence of an active job for this revision; otherwise there is nothing to judge. A failure is reported, never
    // hidden: GENERATION_FAILED when a job for this revision failed and none is active (scenario 17).
    return { ...base, availability: 'NOT_GENERATED', activeJobIds, failedJobIds,
      missingReason: failedJobIds.length && !activeJobIds.length ? 'GENERATION_FAILED' : 'NOT_GENERATED_FOR_REVISION',
      freshness: activeJobIds.length ? { state: 'pending', reasons: activeJobIds.map(() => ({ code: 'JOB_ACTIVE' as const, nodeId: null })),
        sourceRevisionId: revision.id, targetRevisionId: target } : null };
  });

  const ancestry = buildLineage(revision, input.ancestry), { parentHash: _parentHash, ...lineage } = ancestry;
  const diff = buildDiff(projectId, revision, hash, input.ancestry.parent, ancestry);
  const disciplines = DISCIPLINES.map(discipline => {
    const members = modules.filter(m => m.discipline === discipline);
    return { discipline, freshness: worst(members.flatMap(m => m.freshness ? [m.freshness.state] : [])), modules: members.map(m => m.module) };
  });
  // Freshness impact (from the parallel M10 design), read straight from the module freshness above: nothing new is inferred. A stale source model and its
  // acceptance QA are superseded by the target revision; they are never regenerated (a new model is a new revision), so they are not listed to regenerate.
  const freshnessImpact = { targetRevisionId: target, disciplines: DISCIPLINES.map(discipline => {
    const members = modules.filter(m => m.discipline === discipline), withState = (s: FreshnessState) => members.filter(m => m.freshness?.state === s).map(m => m.module);
    const count = (s: FreshnessState) => members.reduce((n, m) => n + m.artifacts.filter(x => x.freshness.state === s).length, 0);
    const stale = withState('stale'), replaced = (m: ManifestModule) => DEFS.find(d => d.module === m)!.regenerable === false;
    return { discipline, regenerate: stale.filter(m => !replaced(m)), superseded: stale.filter(replaced), revalidate: withState('blocked'), awaiting: withState('pending'),
      staleArtifacts: count('stale'), blockedArtifacts: count('blocked') };
  }) };
  // Candidates on this revision (roadmap L258), oldest first like the artifacts. Listed only: no module, freshness, impact or diff above reads them.
  const candidates = { modulesResolve: 'ACCEPTED_REVISION_ONLY' as const, availability: input.operations ? 'AVAILABLE' as const : 'UNAVAILABLE' as const,
    completeness: input.operations?.truncated ? 'TRUNCATED' as const : 'COMPLETE' as const,
    items: (input.operations?.items ?? []).filter(o => o.baseRevisionId === revision.id && (CANDIDATE_STATUSES as readonly string[]).includes(o.status))
      .sort((x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
      .map(o => { const at = `/api/projects/${projectId}/revision-operations/${o.id}`;
        return { operationId: o.id, kind: o.kind, status: o.status as typeof CANDIDATE_STATUSES[number], candidateHash: o.candidateHash, createdAt: o.createdAt,
          expiresAt: o.expiresAt, acceptance: 'NOT_ACCEPTED' as const, href: at, comparisonHref: `${at}/comparison` }; }) };
  const site = revision.model.site;
  const body = {
    manifestVersion: PROJECT_MANIFEST_VERSION,
    identity: { projectId, revisionId: revision.id, revisionNumber: revision.revisionNumber, parentRevisionId: revision.parentRevisionId,
      projectCurrentRevisionId: current, revisionCurrency: current === null ? 'NO_CURRENT_REVISION' as const : current === revision.id ? 'CURRENT' as const : 'HISTORICAL' as const,
      modelHash: hash, acceptanceQaId: revision.qa.id, createdAt: revision.createdAt },
    lineage, diff, changeImpact: buildChangeImpact(diff), freshnessImpact, candidates,
    failedGenerations: { availability: input.failedJobs ? 'AVAILABLE' as const : 'UNAVAILABLE' as const,
      completeness: input.failedJobs?.truncated ? 'TRUNCATED' as const : 'COMPLETE' as const, window: input.failedJobs?.window ?? 0 },
    canonicalModel: { schemaVersion: revision.model.schemaVersion, completeness: revision.completeness, units: revision.model.units, coordinateSystem: revision.model.coordinateSystem,
      site: { present: site !== null, northMilliDegrees: site?.northMilliDegrees ?? null, referenceDatum: site?.referenceOrigin?.datum ?? null },
      counts: { levels: revision.model.levels.length, spaces: revision.model.spaces.length, walls: revision.model.walls.length, openings: revision.model.openings.length } },
    configuration: { sourceMode: revision.sourceMode, generatorVersion: revision.generatorVersion, generationIdentity: revision.identity ?? null },
    modules: modules.map(m => ({ ...m, artifactCount: m.artifacts.length })), disciplines,
    freshnessVocabulary: { states: FRESHNESS_ASSIGNMENT.map(s => ({ ...s })), graphStateMapping: { ...GRAPH_STATE_MAPPING } },
    verification: { scope: 'PROVENANCE_INTEGRITY' as const, graphVersion: graph.graphVersion, graphHash: graph.graphHash,
      nodeStates: Object.fromEntries(NODE_STATES.map(s => [s, graph.nodes.filter(n => n.state === s).length])) },
    accessPolicy: { visibility: 'OWNER_ONLY' as const, enforcement: 'OWNER_SCOPED_READS_AND_ROW_LEVEL_SECURITY' as const },
    notIncluded: NOT_INCLUDED.map(n => ({ ...n })),
    claims: { engineeringCorrectness: 'NOT_CLAIMED' as const, solverValidation: 'NOT_CLAIMED' as const, professionalReview: 'NOT_CLAIMED' as const },
  };
  return ProjectManifestSchema.parse({ ...body, integrityCheckedAt: input.integrityCheckedAt, manifestHash: costHash(body),
    view: { scope: 'FULL', discipline: null, artifacts: 'INCLUDED' } });
}

/**
 * Roadmap L259 partial-data view: one discipline's modules, discipline freshness and impact entries, and/or the modules without their artifact lists. Cut
 * from the full manifest, so it keeps that manifest's hash, identity, lineage, diff, candidates and verification counts; nothing is recomputed for the view.
 */
export function manifestView(manifest: ProjectManifest, query: ManifestQuery): ProjectManifest {
  const { discipline = null, artifacts } = query, keep = (d: { discipline: string }) => discipline === null || d.discipline === discipline;
  if (discipline === null && artifacts === 'include') return manifest;
  return ProjectManifestSchema.parse({ ...manifest,
    modules: manifest.modules.filter(keep).map(m => artifacts === 'omit' ? { ...m, artifacts: null } : m),
    disciplines: manifest.disciplines.filter(keep),
    changeImpact: { ...manifest.changeImpact, disciplines: manifest.changeImpact.disciplines.filter(keep) },
    freshnessImpact: { ...manifest.freshnessImpact, disciplines: manifest.freshnessImpact.disciplines.filter(keep) },
    view: { scope: 'PARTIAL', discipline, artifacts: artifacts === 'omit' ? 'OMITTED' : 'INCLUDED' } });
}
