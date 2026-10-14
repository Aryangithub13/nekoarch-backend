import { describe, expect, it } from 'vitest';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { buildDependencyGraph, type GraphInput, type GraphRecord } from '../src/graph/dependency-graph.js';
import { buildProjectManifest, type ManifestInput } from '../src/graph/project-manifest.js';
import { FRESHNESS_STATES, GRAPH_STATE_MAPPING, MODULES, ProjectManifestSchema } from '../src/contracts/project-manifest.js';
import { NODE_STATES } from '../src/contracts/dependency-graph.js';
import { modelHash } from '../src/lib/generation-identity.js';
import { MANIFEST_DIFF_CHANGE_LIMIT } from '../src/contracts/project-manifest.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const PROJECT = uuid(1), REV = uuid(2), QA = uuid(3), NEWER = uuid(4), PARENT = uuid(5), HASH = modelHash(authored());
const at = (n: number) => new Date(Date.UTC(2026, 9, 13, 0, 0, n)).toISOString();
const ok = (...checks: GraphRecord['checks'][number]['check'][]) => checks.map(check => ({ check, result: 'VERIFIED' as const }));
const anchored = [{ family: 'REVISION' as const, id: REV, kind: 'BOUND_TO_REVISION' as const }, { family: 'ACCEPTANCE_QA' as const, id: QA, kind: 'ACCEPTED_BY' as const }];
const base = (): GraphRecord[] => [
  { family: 'REVISION', id: REV, revisionId: REV, createdAt: at(0), checks: ok('REVISION_IDENTITY'), dependsOn: [] },
  { family: 'ACCEPTANCE_QA', id: QA, revisionId: REV, createdAt: at(0), checks: ok('QA_ACCEPTANCE'), dependsOn: [{ family: 'REVISION', id: REV, kind: 'QA_OF' }] },
];
const artifact = (family: GraphRecord['family'], n: number, derived: { family: GraphRecord['family']; id: string }[] = []): GraphRecord => ({
  family, id: uuid(n), revisionId: REV, createdAt: at(n), checks: ok('REVISION_BINDING', 'QA_BINDING', 'MODEL_HASH'),
  dependsOn: [...anchored, ...derived.map(d => ({ ...d, kind: 'DERIVED_FROM' as const }))] });
const chain = () => [...base(), artifact('QUANTITY_TAKEOFF', 10), artifact('CONSTRUCTION_CALCULATION', 11, [{ family: 'QUANTITY_TAKEOFF', id: uuid(10) }]),
  artifact('BOQ_COST', 12, [{ family: 'CONSTRUCTION_CALCULATION', id: uuid(11) }, { family: 'QUANTITY_TAKEOFF', id: uuid(10) }]), artifact('SCENE_3D', 30)];
const graph = (records: GraphRecord[], current: string | null = REV) =>
  buildDependencyGraph({ projectId: PROJECT, revisionId: REV, modelHash: HASH, projectCurrentRevisionId: current, records } satisfies GraphInput);
const revision = () => ({ id: REV, projectId: PROJECT, revisionNumber: 1, parentRevisionId: null, schemaVersion: 2 as const, completeness: 'architectural' as const,
  sourceMode: 'supplied' as const, generatorVersion: null, createdAt: at(0), identity: null, model: authored(),
  qa: { id: QA, qaVersion: 'qa-test-v1' } }) as unknown as ManifestInput['revision'];
const concept = (n: number, patch: Record<string, unknown> = {}) => ({ id: uuid(n), projectRevisionId: REV, scope: 'EXTERIOR' as const, conceptSetVersion: 'design-concept-set-v1' as const,
  source: 'DETERMINISTIC_TEMPLATE' as const, providerId: null, modelId: null, alternativeCount: 1, modelHash: HASH, inputHash: 'b'.repeat(64), contentHash: 'c'.repeat(64),
  createdAt: at(n), ...patch });
const manifest = (records = chain(), current: string | null = REV, extra: Partial<ManifestInput> = {}) => buildProjectManifest({ projectId: PROJECT, revision: revision(),
  graph: graph(records, current), designConcepts: { items: [], truncated: false }, activeJobs: [], integrityCheckedAt: at(99),
  ancestry: { parent: null, parentReadable: true, operation: { operation: null, modelEquivalentToBase: null } }, ...extra });
const mod = (m: ReturnType<typeof buildProjectManifest>, name: string) => m.modules.find(x => x.module === name)!;

describe('B37 Unified Project Manifest v2 (pure builder)', () => {
  it('M1: carries identity, canonical frame, configuration, every module, per-discipline freshness, verification scope and access policy', () => {
    const m = manifest();
    expect(ProjectManifestSchema.parse(m)).toEqual(m);
    expect(m.identity).toMatchObject({ projectId: PROJECT, revisionId: REV, revisionCurrency: 'CURRENT', modelHash: HASH, acceptanceQaId: QA });
    expect(m.canonicalModel).toMatchObject({ schemaVersion: 2, units: 'mm', coordinateSystem: 'x-right-y-up-z-depth' });
    expect(m.modules.map(x => x.module)).toEqual([...MODULES]);
    expect(m.disciplines.map(d => [d.discipline, d.freshness])).toEqual([['ARCHITECTURE', 'current'], ['QUANTITIES_AND_COST', 'current'], ['ENGINEERING', 'current'],
      ['DESIGN', null], ['VISUALIZATION', 'current'], ['DOCUMENTATION', 'current']]);
    expect(mod(m, 'BUILDING_MODEL')).toMatchObject({ editability: 'NEW_REVISION_ONLY', availability: 'AVAILABLE', href: `/api/projects/${PROJECT}/revisions/${REV}` });
    expect(mod(m, 'STRUCTURAL_ANALYSIS')).toMatchObject({ availability: 'NOT_GENERATED', freshness: null, missingReason: 'NOT_GENERATED_FOR_REVISION' });
    expect(mod(m, 'BIM')).toMatchObject({ availability: 'DERIVED_ON_READ', source: 'DERIVED_ON_READ', freshness: { state: 'current', reasons: [] } });
    expect(m.verification).toMatchObject({ scope: 'PROVENANCE_INTEGRITY', nodeStates: { CURRENT: 6, STALE_SOURCE_CHANGED: 0, STALE_UPSTREAM_STALE: 0, UNVERIFIED: 0 } });
    expect(m.accessPolicy.visibility).toBe('OWNER_ONLY');
    expect(m.claims).toEqual({ engineeringCorrectness: 'NOT_CLAIMED', solverValidation: 'NOT_CLAIMED', professionalReview: 'NOT_CLAIMED' });
  });

  it('M2: maps every graph state to the roadmap vocabulary; UNVERIFIED is blocked, never current or verified', () => {
    expect(Object.keys(GRAPH_STATE_MAPPING).sort()).toEqual([...NODE_STATES].sort());
    expect(GRAPH_STATE_MAPPING).toEqual({ CURRENT: 'current', STALE_SOURCE_CHANGED: 'stale', STALE_UPSTREAM_STALE: 'stale', UNVERIFIED: 'blocked' });
    for (const s of Object.values(GRAPH_STATE_MAPPING)) expect(FRESHNESS_STATES).toContain(s);
    // A superseded revision: direct artifacts SOURCE_REVISION_SUPERSEDED, derived ones UPSTREAM_STALE; both are stale with reasons and revision identity.
    const stale = manifest(chain(), NEWER);
    expect(stale.identity.revisionCurrency).toBe('HISTORICAL');
    expect(mod(stale, 'QUANTITY_TAKEOFF').freshness).toEqual({ state: 'stale', reasons: [{ code: 'SOURCE_REVISION_SUPERSEDED', nodeId: `REVISION:${REV}` }],
      sourceRevisionId: REV, targetRevisionId: NEWER });
    expect(mod(stale, 'BOQ_COST').freshness!.reasons[0]!.code).toBe('UPSTREAM_STALE');
    expect(mod(stale, 'CONSTRUCTION_DOCUMENTS').freshness!.state).toBe('stale');
    // A failed provenance check fails closed.
    const records = chain().map(r => r.family === 'QUANTITY_TAKEOFF' ? { ...r, checks: r.checks.map(c => c.check === 'MODEL_HASH' ? { ...c, result: 'FAILED' as const } : c) } : r);
    const blocked = manifest(records);
    expect(mod(blocked, 'QUANTITY_TAKEOFF').freshness).toMatchObject({ state: 'blocked', reasons: [{ code: 'MODEL_HASH_MISMATCH' }] });
    expect(mod(blocked, 'BOQ_COST').freshness!.state).toBe('blocked');
    expect(blocked.disciplines.find(d => d.discipline === 'QUANTITIES_AND_COST')!.freshness).toBe('blocked');
    // No current revision at all: every output is blocked.
    expect(manifest(chain(), null).modules.flatMap(x => x.freshness ? [x.freshness.state] : [])).toEqual(expect.arrayContaining(['blocked']));
    expect(manifest(chain(), null).modules.every(x => !x.freshness || x.freshness.state === 'blocked')).toBe(true);
  });

  it('M2: pending only on evidence of an active job for a module with nothing stored; verified and not_applicable are never assigned', () => {
    const m = manifest(base(), REV, { activeJobs: [{ jobId: uuid(50), module: 'DESIGN_OPTIMIZATION' }, { jobId: uuid(51), module: 'SCENE_3D' }] });
    expect(mod(m, 'DESIGN_OPTIMIZATION')).toMatchObject({ availability: 'NOT_GENERATED', activeJobIds: [uuid(50)],
      freshness: { state: 'pending', reasons: [{ code: 'JOB_ACTIVE', nodeId: null }] } });
    expect(mod(m, 'SCENE_3D').freshness!.state).toBe('pending');
    // An existing artifact keeps its own state; the job is listed, not used to downgrade it.
    const withScene = manifest(chain(), REV, { activeJobs: [{ jobId: uuid(51), module: 'SCENE_3D' }] });
    expect(mod(withScene, 'SCENE_3D')).toMatchObject({ activeJobIds: [uuid(51)], freshness: { state: 'current' } });
    expect(m.freshnessVocabulary.states.filter(s => !s.assigned).map(s => s.state)).toEqual(['not_applicable', 'verified']);
    for (const variant of [m, withScene, manifest(chain(), NEWER), manifest(chain(), null)]) {
      const states = [...variant.modules.flatMap(x => [x.freshness?.state, ...x.artifacts.map(a => a.freshness.state)]), ...variant.disciplines.map(d => d.freshness)];
      expect(states).not.toContain('verified');
      expect(states).not.toContain('not_applicable');
    }
  });

  it('applies the graph checks that fit advisory design concepts to their stored columns', () => {
    const m = manifest(chain(), REV, { designConcepts: { items: [concept(60), concept(61, { modelHash: 'd'.repeat(64) })], truncated: true } });
    const d = mod(m, 'DESIGN_CONCEPTS');
    expect(d).toMatchObject({ availability: 'AVAILABLE', completeness: 'TRUNCATED', source: 'ADVISORY_ARTIFACT', editability: 'ADVISORY_READ_ONLY' });
    expect(d.artifacts.map(a => [a.artifactId, a.freshness.state, a.freshness.reasons[0]?.code ?? null])).toEqual([[uuid(60), 'current', null], [uuid(61), 'blocked', 'MODEL_HASH_MISMATCH']]);
    expect(d.freshness!.state).toBe('blocked');
    expect(mod(manifest(chain(), NEWER, { designConcepts: { items: [concept(60)], truncated: false } }), 'DESIGN_CONCEPTS').freshness!.state).toBe('stale');
    expect(mod(manifest(chain(), REV, { designConcepts: null }), 'DESIGN_CONCEPTS')).toMatchObject({ availability: 'UNAVAILABLE', missingReason: 'PERSISTENCE_UNAVAILABLE' });
  });

  it('is deterministic: record order and read time do not change the manifest hash', () => {
    const a = manifest(), b = manifest([...chain()].reverse(), REV, { integrityCheckedAt: at(500) });
    expect(b.manifestHash).toBe(a.manifestHash);
    expect({ ...b, integrityCheckedAt: a.integrityCheckedAt }).toEqual(a);
    expect(manifest(chain(), NEWER).manifestHash).not.toBe(a.manifestHash);
  });
});

type Model = ReturnType<typeof authored>;
/** Revision 2 of the fixture, with a parent (revision 1) whose model is `parentModel`. */
const child = (patch: Record<string, unknown> = {}) => ({ ...(revision() as object), revisionNumber: 2, parentRevisionId: PARENT, ...patch }) as unknown as ManifestInput['revision'];
const parentOf = (model: Model, patch: Record<string, unknown> = {}) => ({ id: PARENT, revisionNumber: 1, createdAt: at(-1), identity: null, model, ...patch }) as never;
const withParent = (parentModel: Model | null, opts: { readable?: boolean; parentPatch?: Record<string, unknown>; childPatch?: Record<string, unknown>;
  operation?: ManifestInput['ancestry']['operation'] } = {}) => buildProjectManifest({ projectId: PROJECT, revision: child(opts.childPatch), graph: graph(chain()),
  designConcepts: { items: [], truncated: false }, activeJobs: [], integrityCheckedAt: at(99),
  ancestry: { parent: parentModel ? parentOf(parentModel, opts.parentPatch) : null, parentReadable: opts.readable ?? true,
    operation: opts.operation === undefined ? { operation: null, modelEquivalentToBase: null } : opts.operation } });

describe('B37 change metadata: lineage, diff and per-discipline impact', () => {
  it('a root revision has ROOT lineage and no comparison (NO_PARENT), distinct from an empty diff', () => {
    const m = manifest();
    expect(m.lineage).toEqual({ status: 'ROOT', revisionNumber: 1, parentRevisionId: null, parent: null, modelEquivalentToParent: null,
      operation: { status: 'NONE', operationId: null, kind: null, baseRevisionId: null, restoreSourceRevisionId: null, modelEquivalentToBase: null },
      reasons: [] });
    expect(m.diff).toMatchObject({ status: 'NO_PARENT', counts: null, entitiesIdentical: null, modelHashChanged: null, changes: [], unavailableReason: null });
    expect(m.changeImpact).toEqual({ status: 'NO_PARENT', basis: 'MODEL_BINDING', baseRevisionId: null, disciplines: [] });
  });

  it('an unchanged revision: LINKED, model-equivalent, a computed empty diff and no discipline affected', () => {
    const m = withParent(authored());
    expect(m.lineage).toMatchObject({ status: 'LINKED', parentRevisionId: PARENT, parent: { revisionId: PARENT, revisionNumber: 1, modelHash: HASH },
      modelEquivalentToParent: true, reasons: [] });
    expect(m.diff).toMatchObject({ status: 'COMPUTED', diffVersion: 'scoped-diff-v1', baseRevisionId: PARENT, baseModelHash: HASH, modelHash: HASH,
      modelHashChanged: false, entitiesIdentical: true, counts: { added: 0, removed: 0, changed: 0 }, collections: [], changes: [], changesTruncated: false });
    expect(m.changeImpact.status).toBe('COMPUTED');
    expect(m.changeImpact.disciplines.every(d => d.impact === 'NOT_AFFECTED' && d.reason === 'MODEL_UNCHANGED' && d.changedCollections.length === 0)).toBe(true);
    // Backward compatibility: the v2 identity still carries parentRevisionId, and it agrees with the lineage.
    expect(m.identity.parentRevisionId).toBe(m.lineage.parentRevisionId);
  });

  it('an entity change affects architecture by entity and every other discipline by model binding', () => {
    const parent = authored(), wall = parent.walls[0]!;
    const changedParent = { ...parent, walls: [{ ...wall, heightMm: (wall.heightMm ?? 3000) + 100 }, ...parent.walls.slice(1)] } as Model;
    const m = withParent(changedParent);
    expect(m.diff).toMatchObject({ status: 'COMPUTED', modelHashChanged: true, entitiesIdentical: false, counts: { added: 0, removed: 0, changed: 1 },
      collections: [{ collection: 'walls', added: 0, removed: 0, changed: 1 }], changes: [{ collection: 'walls', entityId: wall.id, change: 'CHANGED' }] });
    const impact = Object.fromEntries(m.changeImpact.disciplines.map(d => [d.discipline, [d.impact, d.reason, d.changedCollections]]));
    expect(impact).toEqual({ ARCHITECTURE: ['AFFECTED', 'MODEL_ENTITIES_CHANGED', ['walls']], QUANTITIES_AND_COST: ['AFFECTED', 'BOUND_TO_CHANGED_MODEL', []],
      ENGINEERING: ['AFFECTED', 'BOUND_TO_CHANGED_MODEL', []], DESIGN: ['AFFECTED', 'BOUND_TO_CHANGED_MODEL', []], VISUALIZATION: ['AFFECTED', 'BOUND_TO_CHANGED_MODEL', []],
      DOCUMENTATION: ['AFFECTED', 'BOUND_TO_CHANGED_MODEL', []] });
    expect(m.changeImpact.disciplines.find(d => d.discipline === 'QUANTITIES_AND_COST')!.modules).toEqual(['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST']);
  });

  it('a change outside the compared collections is reported as such, not as an entity change', () => {
    const m = withParent({ ...authored(), name: 'Renamed' } as Model);
    expect(m.diff).toMatchObject({ modelHashChanged: true, entitiesIdentical: true, collections: [] });
    expect(m.changeImpact.disciplines[0]).toMatchObject({ discipline: 'ARCHITECTURE', impact: 'AFFECTED', reason: 'MODEL_CHANGED_OUTSIDE_DIFF_COLLECTIONS' });
  });

  it('caps the listed changes but keeps the counts complete', () => {
    const parent = authored(), extra = Array.from({ length: MANIFEST_DIFF_CHANGE_LIMIT + 50 }, (_, i) => ({ id: `spec-extra-${i}`, name: `Spec ${i}`, material: 'concrete' }));
    const m = withParent({ ...parent, specifications: [...(parent.specifications ?? []), ...extra] } as Model);
    expect(m.diff.counts!.removed).toBe(MANIFEST_DIFF_CHANGE_LIMIT + 50);
    expect([m.diff.changes.length, m.diff.changesTruncated]).toEqual([MANIFEST_DIFF_CHANGE_LIMIT, true]);
  });

  it('absent metadata is UNAVAILABLE, never an empty or unchanged result', () => {
    const unreadable = withParent(null, { readable: false });
    expect(unreadable.lineage).toMatchObject({ status: 'UNAVAILABLE', parent: null, modelEquivalentToParent: null, reasons: ['PARENT_UNREADABLE'] });
    expect(unreadable.diff).toMatchObject({ status: 'UNAVAILABLE', unavailableReason: 'PARENT_UNREADABLE', counts: null, entitiesIdentical: null });
    expect(unreadable.changeImpact).toMatchObject({ status: 'UNAVAILABLE', disciplines: [] });
    expect(withParent(authored(), { operation: null }).lineage.operation).toMatchObject({ status: 'UNAVAILABLE', operationId: null });
  });

  it('invalid ancestry is INCONSISTENT with a reason, and nothing is compared against it', () => {
    const cases: [Parameters<typeof withParent>[1], string][] = [
      [{ parentPatch: { revisionNumber: 5 } }, 'PARENT_NUMBER_MISMATCH'],
      [{ parentPatch: { identity: { modelHash: 'f'.repeat(64) } } }, 'PARENT_IDENTITY_INCONSISTENT'],
      [{ operation: { operation: { id: uuid(70), kind: 'RESTORE', baseRevisionId: uuid(71), restoreSourceRevisionId: uuid(72), committedRevisionId: REV }, modelEquivalentToBase: null } }, 'OPERATION_BASE_MISMATCH'],
      [{ operation: { operation: { id: uuid(70), kind: 'RESTORE', baseRevisionId: PARENT, restoreSourceRevisionId: uuid(72), committedRevisionId: uuid(73) }, modelEquivalentToBase: null } }, 'OPERATION_TARGET_MISMATCH'],
    ];
    for (const [opts, reason] of cases) {
      const m = withParent(authored(), opts);
      expect([m.lineage.status, m.lineage.reasons, m.lineage.modelEquivalentToParent], reason).toEqual(['INCONSISTENT', [reason], null]);
      expect([m.diff.status, m.diff.unavailableReason, m.changeImpact.status], reason).toEqual(['UNAVAILABLE', 'LINEAGE_INCONSISTENT', 'UNAVAILABLE']);
    }
    const badRoot = buildProjectManifest({ projectId: PROJECT, revision: { ...(revision() as object), revisionNumber: 3 } as never, graph: graph(chain()),
      designConcepts: null, activeJobs: null, integrityCheckedAt: at(99), ancestry: { parent: null, parentReadable: true, operation: { operation: null, modelEquivalentToBase: null } } });
    expect(badRoot.lineage).toMatchObject({ status: 'INCONSISTENT', reasons: ['ROOT_PARENT_MISMATCH'] });
  });

  it('records the Phase 30 operation that committed a revision', () => {
    const op = { id: uuid(70), kind: 'RESTORE' as const, baseRevisionId: PARENT, restoreSourceRevisionId: uuid(72), committedRevisionId: REV };
    expect(withParent(authored(), { operation: { operation: op, modelEquivalentToBase: false } }).lineage).toMatchObject({ status: 'LINKED',
      operation: { status: 'RECORDED', operationId: op.id, kind: 'RESTORE', baseRevisionId: PARENT, restoreSourceRevisionId: op.restoreSourceRevisionId,
        modelEquivalentToBase: false } });
  });

  it('diff carries the existing BIM semantic diff route for the parent pair, and null without a parent', () => {
    expect(manifest().diff.bimDiffHref).toBeNull();
    expect(withParent(authored()).diff.bimDiffHref).toBe(`/api/projects/${PROJECT}/revisions/${REV}/bim/diff/${PARENT}`);
    // The route is offered even when the comparison here is unavailable: the BIM diff reads both revisions itself.
    expect(withParent(null, { readable: false }).diff).toMatchObject({ status: 'UNAVAILABLE', bimDiffHref: `/api/projects/${PROJECT}/revisions/${REV}/bim/diff/${PARENT}` });
  });
});

describe('B37 freshness impact (what the manifest freshness asks of each discipline)', () => {
  const impact = (m: ReturnType<typeof manifest>, d: string) => m.freshnessImpact.disciplines.find(x => x.discipline === d)!;
  it('is empty for a current revision, and lists every stale output by discipline once the revision is superseded', () => {
    const first = manifest();
    expect(first.freshnessImpact.disciplines.every(d => !d.regenerate.length && !d.revalidate.length && !d.awaiting.length && !d.staleArtifacts && !d.blockedArtifacts)).toBe(true);
    const stale = manifest(chain(), NEWER);
    expect(stale.freshnessImpact.targetRevisionId).toBe(NEWER);
    expect(impact(stale, 'QUANTITIES_AND_COST')).toEqual({ discipline: 'QUANTITIES_AND_COST', regenerate: ['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST'],
      revalidate: [], awaiting: [], staleArtifacts: 3, blockedArtifacts: 0 });
    expect(impact(stale, 'VISUALIZATION')).toMatchObject({ regenerate: ['SCENE_3D'], staleArtifacts: 1 });
    expect(impact(stale, 'DOCUMENTATION').regenerate).toEqual(['CONSTRUCTION_DOCUMENTS']);
  });
  it('asks to revalidate a failed check, never to regenerate it, and to await an active job; it never reads better than module freshness', () => {
    const records = chain().map(r => r.family === 'QUANTITY_TAKEOFF' ? { ...r, checks: r.checks.map(c => c.check === 'MODEL_HASH' ? { ...c, result: 'FAILED' as const } : c) } : r);
    expect(impact(manifest(records), 'QUANTITIES_AND_COST')).toMatchObject({ regenerate: [], revalidate: ['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST'],
      blockedArtifacts: 3 });
    expect(impact(manifest(base(), REV, { activeJobs: [{ jobId: uuid(40), module: 'SCENE_3D' }] }), 'VISUALIZATION').awaiting).toEqual(['SCENE_3D']);
    for (const m of [manifest(), manifest(chain(), NEWER), manifest(records)]) for (const d of m.freshnessImpact.disciplines)
      for (const name of [...d.regenerate, ...d.revalidate, ...d.awaiting]) expect(mod(m, name).freshness).not.toBeNull();
  });
});
