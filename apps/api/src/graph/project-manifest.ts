import { costHash } from '@designflow/boq-cost';
import type { BuildingModelV2 } from '@designflow/shared';
import { scopedDiff } from '../verification/diff.js';
import { modelHash } from '../lib/generation-identity.js';
import type { z } from 'zod';
import type { ProjectRevisionDetailSchema } from '../contracts/projects.js';
import type { DesignConceptSummarySchema } from '../contracts/design-concepts.js';
import { NODE_STATES, type DependencyGraph, type GraphFamily, type NodeState } from '../contracts/dependency-graph.js';
import { DISCIPLINES, FRESHNESS_ASSIGNMENT, GRAPH_STATE_MAPPING, MANIFEST_DIFF_CHANGE_LIMIT, MODULES, NOT_INCLUDED, PROJECT_MANIFEST_VERSION, ProjectManifestSchema,
  type ChangeImpact, type FreshnessState, type Lineage, type ManifestDiff, type ManifestModule, type ManifestModuleEntry, type ProjectManifest } from '../contracts/project-manifest.js';
import { SERVICES } from '../services/overview-service.js';

/** The revision fields the manifest reads; a full revision detail satisfies it. */
type Revision = Pick<z.infer<typeof ProjectRevisionDetailSchema>, 'id' | 'revisionNumber' | 'parentRevisionId' | 'createdAt' | 'completeness' | 'sourceMode'
  | 'generatorVersion' | 'identity' | 'model'> & { qa: { id: string; qaVersion: string } };
type Concept = z.infer<typeof DesignConceptSummarySchema>;
type Freshness = NonNullable<ManifestModuleEntry['freshness']>;
type Reason = Freshness['reasons'][number];
type Def = { module: ManifestModule; discipline: typeof DISCIPLINES[number]; source: ManifestModuleEntry['source']; editability: ManifestModuleEntry['editability'];
  family?: GraphFamily; serviceId?: string; route?: string };

const REVISION_ROUTE = '/api/projects/:projectId/revisions/:revisionId';
/** One row per module, in output order. Stored modules read their state from the Phase 37 graph family of the same name. */
const DEFS: readonly Def[] = Object.freeze([
  { module: 'BUILDING_MODEL', discipline: 'ARCHITECTURE', source: 'REVISION', editability: 'NEW_REVISION_ONLY', family: 'REVISION', serviceId: 'BUILDING_MODEL' },
  { module: 'ACCEPTANCE_QA', discipline: 'ARCHITECTURE', source: 'STORED_ARTIFACT', editability: 'DERIVED_READ_ONLY', family: 'ACCEPTANCE_QA', route: REVISION_ROUTE },
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
  { module: 'CONSTRUCTION_DOCUMENTS', discipline: 'DOCUMENTATION', source: 'DERIVED_ON_READ', editability: 'DERIVED_READ_ONLY', serviceId: 'CONSTRUCTION_DOCUMENTS' },
] as const satisfies readonly Def[]);
if (DEFS.map(d => d.module).join() !== MODULES.join()) throw new Error('Manifest module table and contract disagree');

/** Durable-job kinds that produce a stored artifact of a manifest module (Phase 32 `SCENE_COMPILE`, `OPTIMIZATION_STUDY`). */
export const JOB_MODULES = Object.freeze({ SCENE_COMPILE: 'SCENE_3D', OPTIMIZATION_STUDY: 'DESIGN_OPTIMIZATION' } as const);
export type ActiveJob = { jobId: string; module: typeof JOB_MODULES[keyof typeof JOB_MODULES] };

/** The parent revision fields lineage and diff read. */
export type ParentRevision = Pick<z.infer<typeof ProjectRevisionDetailSchema>, 'id' | 'revisionNumber' | 'createdAt' | 'identity' | 'model'>;
/** Phase 30 lineage read (`revision_operation_read` 'lineage'): the operation that committed this revision, if any. */
export type OperationLineage = { operation: { id: string; kind: 'APPEARANCE_MODIFY' | 'RESTORE' | null; baseRevisionId: string; restoreSourceRevisionId: string | null;
  committedRevisionId: string | null } | null };

export type ManifestInput = {
  projectId: string; revision: Revision; graph: DependencyGraph;
  /** `parent` is null for a root revision or when the parent could not be read (`parentReadable: false`). `operation` is null when this backend has no operations. */
  ancestry: { parent: ParentRevision | null; parentReadable: boolean; operation: OperationLineage | null };
  /** null when design-concept persistence is not configured on this backend. */
  designConcepts: { items: Concept[]; truncated: boolean } | null;
  /** null when durable-job persistence is not configured; otherwise the active jobs bound to this revision. */
  activeJobs: ActiveJob[] | null;
  integrityCheckedAt: string;
};

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
    operation: operation === null ? { status: 'UNAVAILABLE', operationId: null, kind: null, baseRevisionId: null, restoreSourceRevisionId: null }
      : op ? { status: 'RECORDED', operationId: op.id, kind: op.kind, baseRevisionId: op.baseRevisionId, restoreSourceRevisionId: op.restoreSourceRevisionId }
      : { status: 'NONE', operationId: null, kind: null, baseRevisionId: null, restoreSourceRevisionId: null },
    reasons, parentHash };
}

/** Entity-level comparison with the parent through the Phase 34 `scopedDiff` (canonical hash per entity), only when the lineage is LINKED. */
export function buildDiff(projectId: string, revision: Revision, hash: string, parent: ParentRevision | null, lineage: Lineage & { parentHash: string | null }): ManifestDiff {
  const empty = { diffVersion: null, baseRevisionId: null, baseModelHash: null, modelHash: hash, modelHashChanged: null, entitiesIdentical: null, counts: null,
    collections: [], changes: [], changesTruncated: false };
  if (lineage.status === 'ROOT') return { ...empty, status: 'NO_PARENT', unavailableReason: null };
  if (lineage.status !== 'LINKED' || !parent) return { ...empty, status: 'UNAVAILABLE',
    unavailableReason: lineage.status === 'UNAVAILABLE' ? 'PARENT_UNREADABLE' : 'LINEAGE_INCONSISTENT' };
  const report = scopedDiff(parent.model as BuildingModelV2, revision.model as BuildingModelV2, { projectId,
    baseRevisionId: parent.id, otherRevisionId: revision.id, baseModelHash: lineage.parentHash!, otherModelHash: hash }, { levelIds: [], entityIds: [], allowSiteChange: true });
  const collections = [...new Set(report.changes.map(c => c.collection))].map(collection => {
    const of = report.changes.filter(c => c.collection === collection);
    return { collection, added: of.filter(c => c.change === 'ADDED').length, removed: of.filter(c => c.change === 'REMOVED').length,
      changed: of.filter(c => c.change === 'CHANGED').length };
  });
  return { status: 'COMPUTED', diffVersion: report.diffVersion, baseRevisionId: parent.id, baseModelHash: lineage.parentHash, modelHash: hash,
    modelHashChanged: lineage.parentHash !== hash, entitiesIdentical: report.changes.length === 0,
    counts: { added: report.counts.added, removed: report.counts.removed, changed: report.counts.changed }, collections,
    changes: report.changes.slice(0, MANIFEST_DIFF_CHANGE_LIMIT).map(({ collection, entityId, change, levelIds }) => ({ collection, entityId, change, levelIds })),
    changesTruncated: report.changes.length > MANIFEST_DIFF_CHANGE_LIMIT, unavailableReason: null };
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
  const conceptFreshness = (c: Concept): Freshness => {
    if (c.projectRevisionId !== revision.id) return { ...anchorFreshness, state: 'blocked', reasons: [{ code: 'REVISION_BINDING_MISMATCH', nodeId: null }] };
    if (c.modelHash !== hash) return { ...anchorFreshness, state: 'blocked', reasons: [{ code: 'MODEL_HASH_MISMATCH', nodeId: null }] };
    if (anchorFreshness.state === 'blocked') return { ...anchorFreshness, reasons: [{ code: 'UPSTREAM_UNVERIFIED', nodeId: anchorWorst.nodeId }, ...anchorFreshness.reasons] };
    return anchorFreshness.state === 'stale' ? { ...anchorFreshness, reasons: [{ code: 'SOURCE_REVISION_SUPERSEDED', nodeId: revisionKey }] } : anchorFreshness;
  };

  const modules = DEFS.map((d): ManifestModuleEntry => {
    const service = d.serviceId ? SERVICES.find(s => s.serviceId === d.serviceId)! : null;
    const base = { module: d.module, discipline: d.discipline, version: service?.version ?? revision.qa.qaVersion, href: href(d.route ?? service!.route),
      source: d.source, editability: d.editability, completeness: 'COMPLETE' as const, missingReason: null, activeJobIds: [] as string[], artifacts: [] as ManifestModuleEntry['artifacts'] };
    if (d.source === 'DERIVED_ON_READ') return { ...base, availability: 'DERIVED_ON_READ', freshness: anchorFreshness };
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
    if (artifacts.length) {
      const family = graph.families.find(f => f.family === d.family)!;
      const representative = nodes.find(n => n.state === family.state)!;
      return { ...base, availability: 'AVAILABLE', activeJobIds, artifacts, freshness: fromNode(family.state as NodeState, representative.causes) };
    }
    // Nothing stored yet: pending only on evidence of an active job for this revision; otherwise there is nothing to judge.
    return { ...base, availability: 'NOT_GENERATED', missingReason: 'NOT_GENERATED_FOR_REVISION', activeJobIds,
      freshness: activeJobIds.length ? { state: 'pending', reasons: activeJobIds.map(() => ({ code: 'JOB_ACTIVE' as const, nodeId: null })),
        sourceRevisionId: revision.id, targetRevisionId: target } : null };
  });

  const ancestry = buildLineage(revision, input.ancestry), { parentHash: _parentHash, ...lineage } = ancestry;
  const diff = buildDiff(projectId, revision, hash, input.ancestry.parent, ancestry);
  const disciplines = DISCIPLINES.map(discipline => {
    const members = modules.filter(m => m.discipline === discipline);
    return { discipline, freshness: worst(members.flatMap(m => m.freshness ? [m.freshness.state] : [])), modules: members.map(m => m.module) };
  });
  const site = revision.model.site;
  const body = {
    manifestVersion: PROJECT_MANIFEST_VERSION,
    identity: { projectId, revisionId: revision.id, revisionNumber: revision.revisionNumber, parentRevisionId: revision.parentRevisionId,
      projectCurrentRevisionId: current, revisionCurrency: current === null ? 'NO_CURRENT_REVISION' as const : current === revision.id ? 'CURRENT' as const : 'HISTORICAL' as const,
      modelHash: hash, acceptanceQaId: revision.qa.id, createdAt: revision.createdAt },
    lineage, diff, changeImpact: buildChangeImpact(diff),
    canonicalModel: { schemaVersion: revision.model.schemaVersion, completeness: revision.completeness, units: revision.model.units, coordinateSystem: revision.model.coordinateSystem,
      site: { present: site !== null, northMilliDegrees: site?.northMilliDegrees ?? null, referenceDatum: site?.referenceOrigin?.datum ?? null },
      counts: { levels: revision.model.levels.length, spaces: revision.model.spaces.length, walls: revision.model.walls.length, openings: revision.model.openings.length } },
    configuration: { sourceMode: revision.sourceMode, generatorVersion: revision.generatorVersion, generationIdentity: revision.identity ?? null },
    modules, disciplines,
    freshnessVocabulary: { states: FRESHNESS_ASSIGNMENT.map(s => ({ ...s })), graphStateMapping: { ...GRAPH_STATE_MAPPING } },
    verification: { scope: 'PROVENANCE_INTEGRITY' as const, graphVersion: graph.graphVersion, graphHash: graph.graphHash,
      nodeStates: Object.fromEntries(NODE_STATES.map(s => [s, graph.nodes.filter(n => n.state === s).length])) },
    accessPolicy: { visibility: 'OWNER_ONLY' as const, enforcement: 'OWNER_SCOPED_READS_AND_ROW_LEVEL_SECURITY' as const },
    notIncluded: NOT_INCLUDED.map(n => ({ ...n })),
    claims: { engineeringCorrectness: 'NOT_CLAIMED' as const, solverValidation: 'NOT_CLAIMED' as const, professionalReview: 'NOT_CLAIMED' as const },
  };
  return ProjectManifestSchema.parse({ ...body, integrityCheckedAt: input.integrityCheckedAt, manifestHash: costHash(body) });
}
