import { describe, expect, it } from 'vitest';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { buildDependencyGraph, type GraphInput, type GraphRecord } from '../src/graph/dependency-graph.js';
import { readFileSync } from 'node:fs';
import { costHash } from '@designflow/boq-cost';
import { buildProjectManifest, manifestView, MANIFEST_VIEW_ROUTES, type AppearanceEvidence, type ManifestInput } from '../src/graph/project-manifest.js';
import { DISCIPLINES, FRESHNESS_STATES, GRAPH_STATE_MAPPING, ManifestQuerySchema, MODULES, NOT_INCLUDED, ProjectManifestSchema } from '../src/contracts/project-manifest.js';
import { SCHEDULE_IDS } from '../src/documents/schedules.js';
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
  graph: graph(records, current), designConcepts: { items: [], truncated: false }, activeJobs: [], operations: null, failedJobs: null, appearance: null, integrityCheckedAt: at(99),
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
      const states = [...variant.modules.flatMap(x => [x.freshness?.state, ...x.artifacts!.map(a => a.freshness.state)]), ...variant.disciplines.map(d => d.freshness)];
      expect(states).not.toContain('verified');
      expect(states).not.toContain('not_applicable');
    }
  });

  it('applies the graph checks that fit advisory design concepts to their stored columns', () => {
    const m = manifest(chain(), REV, { designConcepts: { items: [concept(60), concept(61, { modelHash: 'd'.repeat(64) })], truncated: true } });
    const d = mod(m, 'DESIGN_CONCEPTS');
    expect(d).toMatchObject({ availability: 'AVAILABLE', completeness: 'TRUNCATED', source: 'ADVISORY_ARTIFACT', editability: 'ADVISORY_READ_ONLY' });
    expect(d.artifacts!.map(a => [a.artifactId, a.freshness.state, a.freshness.reasons[0]?.code ?? null])).toEqual([[uuid(60), 'current', null], [uuid(61), 'blocked', 'MODEL_HASH_MISMATCH']]);
    expect(d.freshness!.state).toBe('blocked');
    expect(mod(manifest(chain(), NEWER, { designConcepts: { items: [concept(60)], truncated: false } }), 'DESIGN_CONCEPTS').freshness!.state).toBe('stale');
    expect(mod(manifest(chain(), REV, { designConcepts: null }), 'DESIGN_CONCEPTS')).toMatchObject({ availability: 'UNAVAILABLE', missingReason: 'PERSISTENCE_UNAVAILABLE' });
  });

  it('roadmap L258: candidates on this revision are listed as not accepted and never feed a module, freshness, impact or diff', () => {
    const op = (n: number, status: string, baseRevisionId = REV) => ({ id: uuid(n), baseRevisionId, kind: 'APPEARANCE_MODIFY' as const, status,
      candidateHash: status === 'CANDIDATE_READY' ? 'e'.repeat(64) : null, createdAt: at(n), expiresAt: at(n + 86_400) });
    // Newest first, as the Phase 30 listing returns them; another revision's candidate and finished operations are not candidates of this one.
    const items = [op(75, 'REJECTED'), op(74, 'EXPIRED'), op(73, 'COMMITTED'), op(72, 'CANDIDATE_READY', NEWER), op(71, 'AWAITING_CONSENT'), op(70, 'CANDIDATE_READY')];
    const without = manifest(), withOps = manifest(chain(), REV, { operations: { items, truncated: false } });
    const ops = `/api/projects/${PROJECT}/revision-operations`;
    expect(withOps.candidates).toEqual({ modulesResolve: 'ACCEPTED_REVISION_ONLY', availability: 'AVAILABLE', completeness: 'COMPLETE', items: [
      { operationId: uuid(70), kind: 'APPEARANCE_MODIFY', status: 'CANDIDATE_READY', candidateHash: 'e'.repeat(64), createdAt: at(70), expiresAt: at(86_470),
        acceptance: 'NOT_ACCEPTED', href: `${ops}/${uuid(70)}`, comparisonHref: `${ops}/${uuid(70)}/comparison` },
      { operationId: uuid(71), kind: 'APPEARANCE_MODIFY', status: 'AWAITING_CONSENT', candidateHash: null, createdAt: at(71), expiresAt: at(86_471),
        acceptance: 'NOT_ACCEPTED', href: `${ops}/${uuid(71)}`, comparisonHref: `${ops}/${uuid(71)}/comparison` }] });
    // Every module still resolves the accepted revision: everything but the candidate list is identical with or without candidates.
    for (const key of ['identity', 'modules', 'disciplines', 'changeImpact', 'freshnessImpact', 'verification', 'lineage', 'diff'] as const)
      expect(withOps[key], key).toEqual(without[key]);
    expect(withOps.manifestHash).not.toBe(without.manifestHash);
    expect(without.candidates).toEqual({ modulesResolve: 'ACCEPTED_REVISION_ONLY', availability: 'UNAVAILABLE', completeness: 'COMPLETE', items: [] });
    expect(manifest(chain(), REV, { operations: { items: [], truncated: true } }).candidates).toMatchObject({ availability: 'AVAILABLE', completeness: 'TRUNCATED' });
  });

  it('roadmap L259: modules index their existing paged views, and a partial view is cut from the full manifest without recomputing it', () => {
    const m = manifest(chain(), NEWER), R = `/api/projects/${PROJECT}/revisions/${REV}`;
    expect(mod(m, 'BIM').views).toEqual([{ href: `${R}/bim/elements`, paging: 'AFTER_ID', filters: ['kind'] }, { href: `${R}/bim/relationships`, paging: 'AFTER_ID', filters: ['kind'] }]);
    expect(mod(m, 'QUANTITY_TAKEOFF').views).toEqual([{ href: `${R}/takeoffs`, paging: 'CURSOR', filters: [] }]);
    expect(mod(m, 'BUILDING_MODEL').views).toEqual([]);
    // Every indexed view is a real GET route of the catalog.
    const catalog = (JSON.parse(readFileSync(new URL('../../../docs/modernization/api-routes.json', import.meta.url), 'utf8')) as { method: string; url: string }[])
      .filter(r => r.method === 'GET').map(r => r.url);
    expect(MANIFEST_VIEW_ROUTES.length).toBe(14);
    for (const route of MANIFEST_VIEW_ROUTES) expect(catalog, route).toContain(route);
    expect(m.modules.every(x => x.artifactCount === x.artifacts!.length)).toBe(true);
    expect(m.view).toEqual({ scope: 'FULL', discipline: null, artifacts: 'INCLUDED' });

    const query = (q: Record<string, string>) => ManifestQuerySchema.parse(q);
    expect(manifestView(m, query({}))).toBe(m);
    const cost = manifestView(m, query({ discipline: 'QUANTITIES_AND_COST' }));
    expect(ProjectManifestSchema.parse(cost)).toEqual(cost);
    expect(cost.view).toEqual({ scope: 'PARTIAL', discipline: 'QUANTITIES_AND_COST', artifacts: 'INCLUDED' });
    expect(cost.modules.map(x => x.module)).toEqual(['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST']);
    expect(cost.modules).toEqual(m.modules.filter(x => x.discipline === 'QUANTITIES_AND_COST'));
    expect([cost.disciplines, cost.freshnessImpact.disciplines].map(list => list.map(d => d.discipline))).toEqual([['QUANTITIES_AND_COST'], ['QUANTITIES_AND_COST']]);
    expect(cost.freshnessImpact.disciplines).toEqual(m.freshnessImpact.disciplines.filter(d => d.discipline === 'QUANTITIES_AND_COST'));
    // A root revision has no change impact entries; with a parent there is one per discipline, and the view keeps the selected one.
    expect([m.changeImpact.status, cost.changeImpact]).toEqual(['NO_PARENT', m.changeImpact]);
    const changed = withParent(authored()), cut = manifestView(changed, query({ discipline: 'ENGINEERING' }));
    expect(changed.changeImpact.disciplines.length).toBe(DISCIPLINES.length);
    expect(cut.changeImpact).toEqual({ ...changed.changeImpact, disciplines: changed.changeImpact.disciplines.filter(d => d.discipline === 'ENGINEERING') });
    // The view keeps the full manifest's hash, identity, lineage, diff, candidates and verification counts.
    for (const key of ['manifestHash', 'identity', 'lineage', 'diff', 'candidates', 'verification'] as const) expect(cost[key], key).toEqual(m[key]);
    expect([cost.changeImpact.status, cost.freshnessImpact.targetRevisionId]).toEqual([m.changeImpact.status, m.freshnessImpact.targetRevisionId]);
    const slim = manifestView(m, query({ artifacts: 'omit' }));
    expect(slim.view).toEqual({ scope: 'PARTIAL', discipline: null, artifacts: 'OMITTED' });
    expect(slim.modules.map(x => [x.module, x.artifacts, x.artifactCount, x.freshness])).toEqual(m.modules.map(x => [x.module, null, x.artifactCount, x.freshness]));
    expect([slim.changeImpact, slim.freshnessImpact]).toEqual([m.changeImpact, m.freshnessImpact]);
    for (const discipline of DISCIPLINES) expect(manifestView(m, query({ discipline, artifacts: 'omit' })).modules.every(x => x.discipline === discipline)).toBe(true);
    for (const bad of [{ discipline: 'COST' }, { artifacts: 'none' }, { expand: '1' }]) expect(ManifestQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
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
  designConcepts: { items: [], truncated: false }, activeJobs: [], operations: null, failedJobs: null, appearance: null, integrityCheckedAt: at(99),
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
      designConcepts: null, activeJobs: null, operations: null, failedJobs: null, appearance: null, integrityCheckedAt: at(99), ancestry: { parent: null, parentReadable: true, operation: { operation: null, modelEquivalentToBase: null } } });
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
      superseded: [], revalidate: [], awaiting: [], staleArtifacts: 3, blockedArtifacts: 0 });
    expect(impact(stale, 'VISUALIZATION')).toMatchObject({ regenerate: ['SCENE_3D'], staleArtifacts: 1 });
    expect(impact(stale, 'DOCUMENTATION').regenerate).toEqual(['CONSTRUCTION_DOCUMENTS']);
  });
  it('asks to revalidate a failed check, never to regenerate it, and to await an active job; it never reads better than module freshness', () => {
    const records = chain().map(r => r.family === 'QUANTITY_TAKEOFF' ? { ...r, checks: r.checks.map(c => c.check === 'MODEL_HASH' ? { ...c, result: 'FAILED' as const } : c) } : r);
    expect(impact(manifest(records), 'QUANTITIES_AND_COST')).toMatchObject({ regenerate: [], revalidate: ['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST'],
      blockedArtifacts: 3 });
    expect(impact(manifest(base(), REV, { activeJobs: [{ jobId: uuid(40), module: 'SCENE_3D' }] }), 'VISUALIZATION').awaiting).toEqual(['SCENE_3D']);
    for (const m of [manifest(), manifest(chain(), NEWER), manifest(records)]) for (const d of m.freshnessImpact.disciplines)
      for (const name of [...d.regenerate, ...d.superseded, ...d.revalidate, ...d.awaiting]) expect(mod(m, name).freshness).not.toBeNull();
  });
  it('D1: a superseded revision\'s own model, acceptance QA and committed appearance are superseded, never listed for regeneration', () => {
    const stale = manifest(chain(), NEWER, { appearance: appearanceOf() });
    expect(impact(stale, 'ARCHITECTURE')).toMatchObject({ regenerate: ['BIM', 'COMPLEX_VERIFICATION'], superseded: ['BUILDING_MODEL', 'ACCEPTANCE_QA'] });
    expect(impact(stale, 'VISUALIZATION')).toMatchObject({ regenerate: ['SCENE_3D'], superseded: ['APPEARANCE_VARIANT'] });
    const regenerate = stale.freshnessImpact.disciplines.flatMap(d => d.regenerate);
    for (const name of ['BUILDING_MODEL', 'ACCEPTANCE_QA', 'APPEARANCE_VARIANT']) expect(regenerate).not.toContain(name);
    // Every stale module is accounted for exactly once.
    const stalled = stale.modules.filter(x => x.freshness?.state === 'stale').map(x => x.module).sort();
    expect(stale.freshnessImpact.disciplines.flatMap(d => [...d.regenerate, ...d.superseded]).sort()).toEqual(stalled);
    expect(manifest().freshnessImpact.disciplines.every(d => !d.superseded.length)).toBe(true);
  });
});

/** A committed Phase 30 appearance of REV, consistent unless patched. */
const appearanceOf = (patch: Partial<AppearanceEvidence> = {}, artifactPatch: Record<string, unknown> = {}): AppearanceEvidence => {
  const appearance = { version: 'appearance-v1', assignments: [{ presetId: 'glass-inspired' }] }, appearanceHash = costHash(appearance);
  return { revisionId: REV, appearance, appearanceHash, modelHash: HASH, operationId: uuid(90),
    artifact: { id: uuid(91), operationId: uuid(90), modelHash: HASH, appearanceHash, createdAt: at(91), ...artifactPatch }, ...patch } as AppearanceEvidence;
};

describe('B37 closure: visible 3D linkage, failed generation and document views', () => {
  it('D2: a committed Phase 30 appearance is the revision\'s linked visible 3D object, with its binding and hashes re-checked', () => {
    const m = manifest(chain(), REV, { appearance: appearanceOf() }), a = mod(m, 'APPEARANCE_VARIANT');
    expect(a).toMatchObject({ discipline: 'VISUALIZATION', source: 'STORED_ARTIFACT', editability: 'NEW_REVISION_ONLY', availability: 'AVAILABLE',
      href: `/api/projects/${PROJECT}/revisions/${REV}/appearance`, artifactCount: 1, freshness: { state: 'current', reasons: [] } });
    expect(a.artifacts).toEqual([{ artifactId: uuid(91), nodeId: null, revisionId: REV, createdAt: at(91), graphState: null, freshness: a.freshness }]);
    expect(NOT_INCLUDED.map(n => n.item)).not.toContain('APPEARANCE_VARIANT');
    expect(m.disciplines.find(d => d.discipline === 'VISUALIZATION')!.modules).toEqual(['SCENE_3D', 'APPEARANCE_VARIANT']);
    // No appearance, or no operation persistence: said so, never shown as linked.
    expect(mod(manifest(chain(), REV, { appearance: { ...appearanceOf(), appearance: null, appearanceHash: null, modelHash: null, operationId: null, artifact: null } }),
      'APPEARANCE_VARIANT')).toMatchObject({ availability: 'NOT_GENERATED', freshness: null, missingReason: 'NOT_GENERATED_FOR_REVISION', artifacts: [] });
    expect(mod(manifest(), 'APPEARANCE_VARIANT')).toMatchObject({ availability: 'UNAVAILABLE', freshness: null, missingReason: 'PERSISTENCE_UNAVAILABLE' });
    // Every integrity failure fails closed with its own reason, and the discipline reads blocked.
    const tampered: [AppearanceEvidence, string][] = [
      [appearanceOf({ revisionId: NEWER }), 'REVISION_BINDING_MISMATCH'],
      [appearanceOf({ modelHash: 'd'.repeat(64) }), 'MODEL_HASH_MISMATCH'],
      [appearanceOf({ appearanceHash: 'e'.repeat(64) }, { appearanceHash: 'e'.repeat(64) }), 'INPUT_HASH_MISMATCH'],
      [appearanceOf({}, { modelHash: 'f'.repeat(64) }), 'LINK_INCONSISTENT'],
      [appearanceOf({}, { appearanceHash: 'f'.repeat(64) }), 'LINK_INCONSISTENT'],
      [appearanceOf({}, { operationId: uuid(99) }), 'LINK_INCONSISTENT'],
      [appearanceOf({ artifact: null }), 'LINK_INCONSISTENT'],
    ];
    for (const [evidence, code] of tampered) {
      const t = manifest(chain(), REV, { appearance: evidence });
      expect(mod(t, 'APPEARANCE_VARIANT').freshness, code).toMatchObject({ state: 'blocked', reasons: [{ code, nodeId: null }] });
      expect(t.disciplines.find(d => d.discipline === 'VISUALIZATION')!.freshness, code).toBe('blocked');
      expect(t.freshnessImpact.disciplines.find(d => d.discipline === 'VISUALIZATION')!.revalidate, code).toEqual(['APPEARANCE_VARIANT']);
    }
    // Superseded: stale like every output of the revision, and replaced rather than regenerated (D1).
    expect(mod(manifest(chain(), NEWER, { appearance: appearanceOf() }), 'APPEARANCE_VARIANT').freshness).toMatchObject({ state: 'stale',
      reasons: [{ code: 'SOURCE_REVISION_SUPERSEDED' }], targetRevisionId: NEWER });
  });

  it('scenario 17: a failed durable job for a module with nothing stored is reported as GENERATION_FAILED; missing is never passing', () => {
    const failed = (items: { jobId: string; module: 'SCENE_3D' | 'DESIGN_OPTIMIZATION' }[], truncated = false) => ({ items, truncated, window: 8 });
    const m = manifest(base(), REV, { failedJobs: failed([{ jobId: uuid(81), module: 'SCENE_3D' }, { jobId: uuid(80), module: 'SCENE_3D' }]) });
    expect(mod(m, 'SCENE_3D')).toMatchObject({ availability: 'NOT_GENERATED', freshness: null, missingReason: 'GENERATION_FAILED', failedJobIds: [uuid(80), uuid(81)],
      activeJobIds: [] });
    expect(mod(m, 'DESIGN_OPTIMIZATION')).toMatchObject({ missingReason: 'NOT_GENERATED_FOR_REVISION', failedJobIds: [] });
    expect(m.failedGenerations).toEqual({ availability: 'AVAILABLE', completeness: 'COMPLETE', window: 8 });
    // A failure never reads as a freshness state: nothing exists to judge, so the discipline stays without one.
    expect(m.disciplines.find(d => d.discipline === 'VISUALIZATION')!.freshness).toBeNull();
    // An active retry takes precedence (pending); a stored artifact makes old failures history, not a missing output.
    const retrying = manifest(base(), REV, { activeJobs: [{ jobId: uuid(82), module: 'SCENE_3D' }], failedJobs: failed([{ jobId: uuid(80), module: 'SCENE_3D' }]) });
    expect(mod(retrying, 'SCENE_3D')).toMatchObject({ missingReason: 'NOT_GENERATED_FOR_REVISION', activeJobIds: [uuid(82)], failedJobIds: [uuid(80)],
      freshness: { state: 'pending' } });
    expect(mod(manifest(chain(), REV, { failedJobs: failed([{ jobId: uuid(80), module: 'SCENE_3D' }]) }), 'SCENE_3D'))
      .toMatchObject({ availability: 'AVAILABLE', missingReason: null, failedJobIds: [] });
    // How far the evidence reaches is stated, never implied.
    expect(manifest(base(), REV, { failedJobs: failed([], true) }).failedGenerations).toEqual({ availability: 'AVAILABLE', completeness: 'TRUNCATED', window: 8 });
    expect(manifest().failedGenerations).toEqual({ availability: 'UNAVAILABLE', completeness: 'COMPLETE', window: 0 });
  });

  it('roadmap L259: construction documents index the schedules, one CSV per schedule and one plan sheet per storey, as unpaged partial views', () => {
    const m = manifest(), R = `/api/projects/${PROJECT}/revisions/${REV}`, storeys = authored().levels.filter(l => l.kind === 'storey');
    expect(storeys.length).toBeGreaterThan(0);
    expect(mod(m, 'CONSTRUCTION_DOCUMENTS').views).toEqual([{ href: `${R}/documents/schedules`, paging: 'NONE', filters: [] },
      ...SCHEDULE_IDS.map(s => ({ href: `${R}/documents/schedules/${s}/csv`, paging: 'NONE', filters: [] })),
      ...storeys.map(l => ({ href: `${R}/documents/plan-sheets/${encodeURIComponent(l.id)}`, paging: 'NONE', filters: [] }))]);
    // Only storeys get plan sheets: roof and datum levels are never indexed.
    const model = authored(), extra = (['roof', 'datum'] as const).map(kind => ({ ...model.levels[0]!, id: `level-${kind}`, kind }));
    const withOthers = manifest(chain(), REV, { revision: { ...revision(), model: { ...model, levels: [...model.levels, ...extra] } } as unknown as ManifestInput['revision'] });
    const hrefs = mod(withOthers, 'CONSTRUCTION_DOCUMENTS').views.map(v => v.href);
    for (const level of extra) expect(hrefs).not.toContain(`${R}/documents/plan-sheets/${level.id}`);
    expect(hrefs.filter(h => h.includes('/plan-sheets/')).length).toBe(storeys.length);
  });
});
