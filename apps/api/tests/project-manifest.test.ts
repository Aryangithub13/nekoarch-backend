import { describe, expect, it } from 'vitest';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { buildDependencyGraph, type GraphInput, type GraphRecord } from '../src/graph/dependency-graph.js';
import { buildProjectManifest, type ManifestInput } from '../src/graph/project-manifest.js';
import { FRESHNESS_STATES, GRAPH_STATE_MAPPING, MODULES, ProjectManifestSchema } from '../src/contracts/project-manifest.js';
import { NODE_STATES } from '../src/contracts/dependency-graph.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const PROJECT = uuid(1), REV = uuid(2), QA = uuid(3), NEWER = uuid(4), HASH = 'a'.repeat(64);
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
  graph: graph(records, current), designConcepts: { items: [], truncated: false }, activeJobs: [], lineage: null, integrityCheckedAt: at(99), ...extra });
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

  it('roadmap L260/L253: lineage, diff and per-discipline change impact are derived from the revision and the manifest freshness', () => {
    // A first revision: no parent, so no diff; lineage persistence not configured on this backend.
    const first = manifest();
    expect(first.lineage).toEqual({ parentRevisionId: null, operation: null, operationLineage: 'UNAVAILABLE' });
    expect(first.diff).toEqual({ basis: 'BIM_SEMANTIC_DIFF', againstRevisionId: null, href: null, availability: 'NO_PARENT' });
    expect(first.changeImpact.disciplines.every(d => !d.regenerate.length && !d.revalidate.length && !d.awaiting.length && !d.staleArtifacts && !d.blockedArtifacts)).toBe(true);
    // A revision produced by a Phase 30 operation from a parent: the operation is carried, and the diff points at the existing BIM diff route.
    const PARENT = uuid(5), OP = uuid(6);
    const child = manifest(chain(), REV, { revision: { ...revision(), parentRevisionId: PARENT } as ManifestInput['revision'],
      lineage: { operation: { id: OP, kind: 'APPEARANCE_MODIFY', baseRevisionId: PARENT }, modelEquivalentToBase: true } });
    expect(child.lineage).toEqual({ parentRevisionId: PARENT, operationLineage: 'AVAILABLE',
      operation: { operationId: OP, kind: 'APPEARANCE_MODIFY', baseRevisionId: PARENT, modelEquivalentToBase: true } });
    expect(child.diff).toEqual({ basis: 'BIM_SEMANTIC_DIFF', againstRevisionId: PARENT, href: `/api/projects/${PROJECT}/revisions/${REV}/bim/diff/${PARENT}`,
      availability: 'AVAILABLE' });
    expect(manifest(chain(), REV, { lineage: { operation: null, modelEquivalentToBase: null } }).lineage).toEqual({ parentRevisionId: null, operation: null,
      operationLineage: 'AVAILABLE' });
    // Superseded: every stored and derived output of the base is listed for regeneration, by discipline, against the new current revision.
    const stale = manifest(chain(), NEWER), impact = (m: typeof stale, d: string) => m.changeImpact.disciplines.find(x => x.discipline === d)!;
    expect(stale.changeImpact.targetRevisionId).toBe(NEWER);
    expect(impact(stale, 'QUANTITIES_AND_COST')).toEqual({ discipline: 'QUANTITIES_AND_COST', regenerate: ['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST'],
      revalidate: [], awaiting: [], staleArtifacts: 3, blockedArtifacts: 0 });
    expect(impact(stale, 'VISUALIZATION')).toMatchObject({ regenerate: ['SCENE_3D'], staleArtifacts: 1 });
    expect(impact(stale, 'DOCUMENTATION').regenerate).toEqual(['CONSTRUCTION_DOCUMENTS']);
    // A failed check asks for revalidation, never regeneration; an active job is awaited.
    const records = chain().map(r => r.family === 'QUANTITY_TAKEOFF' ? { ...r, checks: r.checks.map(c => c.check === 'MODEL_HASH' ? { ...c, result: 'FAILED' as const } : c) } : r);
    expect(impact(manifest(records), 'QUANTITIES_AND_COST')).toMatchObject({ regenerate: [], revalidate: ['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST'],
      blockedArtifacts: 3 });
    expect(impact(manifest(base(), REV, { activeJobs: [{ jobId: uuid(40), module: 'SCENE_3D' }] }), 'VISUALIZATION').awaiting).toEqual(['SCENE_3D']);
    // Nothing reads better than the module freshness it summarises.
    for (const m of [first, child, stale]) for (const d of m.changeImpact.disciplines)
      for (const name of [...d.regenerate, ...d.revalidate, ...d.awaiting]) expect(mod(m, name).freshness).not.toBeNull();
  });

  it('is deterministic: record order and read time do not change the manifest hash', () => {
    const a = manifest(), b = manifest([...chain()].reverse(), REV, { integrityCheckedAt: at(500) });
    expect(b.manifestHash).toBe(a.manifestHash);
    expect({ ...b, integrityCheckedAt: a.integrityCheckedAt }).toEqual(a);
    expect(manifest(chain(), NEWER).manifestHash).not.toBe(a.manifestHash);
  });
});
