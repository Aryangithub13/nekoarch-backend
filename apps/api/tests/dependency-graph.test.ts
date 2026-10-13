import { describe, expect, it } from 'vitest';
import { costHash } from '@designflow/boq-cost';
import { buildDependencyGraph, GRAPH_LIMITS, type GraphInput, type GraphRecord } from '../src/graph/dependency-graph.js';
import { analysisRecord, constructionRecord, costRecord, revisionRecords, takeoffRecord } from '../src/services/dependency-graph-service.js';
import { takeoffFingerprint } from '../src/services/takeoff-service.js';
import { constructionFingerprint } from '../src/services/construction-service.js';
import { costInputFingerprint } from '../src/services/cost-service.js';
import { DependencyGraphSchema, GRAPH_FAMILIES } from '../src/contracts/dependency-graph.js';
import { ApiError } from '../src/lib/errors.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const PROJECT = uuid(1), REV = uuid(2), QA = uuid(3), NEWER = uuid(4), HASH = 'a'.repeat(64);
const at = (n: number) => new Date(Date.UTC(2026, 9, 13, 0, 0, n)).toISOString();
const ok = (...checks: GraphRecord['checks'][number]['check'][]) => checks.map(check => ({ check, result: 'VERIFIED' as const }));
const anchored = [{ family: 'REVISION' as const, id: REV, kind: 'BOUND_TO_REVISION' as const }, { family: 'ACCEPTANCE_QA' as const, id: QA, kind: 'ACCEPTED_BY' as const }];
const base = (): GraphRecord[] => [
  { family: 'REVISION', id: REV, revisionId: REV, createdAt: at(0), checks: ok('REVISION_IDENTITY'), dependsOn: [] },
  { family: 'ACCEPTANCE_QA', id: QA, revisionId: REV, createdAt: at(0), checks: ok('QA_ACCEPTANCE'), dependsOn: [{ family: 'REVISION', id: REV, kind: 'QA_OF' }] },
];
const artifact = (family: GraphRecord['family'], n: number, derived: { family: GraphRecord['family']; id: string }[] = [], extra: Partial<GraphRecord> = {}): GraphRecord => ({
  family, id: uuid(n), revisionId: REV, createdAt: at(n), checks: ok('REVISION_BINDING', 'QA_BINDING', 'MODEL_HASH'),
  dependsOn: [...anchored, ...derived.map(d => ({ ...d, kind: 'DERIVED_FROM' as const }))], ...extra });
const input = (records: GraphRecord[], current: string | null = REV): GraphInput => ({ projectId: PROJECT, revisionId: REV, modelHash: HASH, projectCurrentRevisionId: current, records });
const node = (g: ReturnType<typeof buildDependencyGraph>, family: string, id: string) => g.nodes.find(n => n.nodeId === `${family}:${id}`)!;
const fail = (records: GraphRecord[], family: GraphRecord['family'], n: number, check: GraphRecord['checks'][number]['check']) =>
  records.map(r => r.family === family && r.id === uuid(n) ? { ...r, checks: r.checks.map(c => c.check === check ? { ...c, result: 'FAILED' as const } : c) } : r);
function refusal(f: () => unknown) {
  try { f(); } catch (error) { if (error instanceof ApiError) return [error.statusCode, error.code, error.fieldErrors?.limit?.[0] ?? null]; throw error; }
  throw new Error('expected a refusal');
}

// A chain covering every edge kind: takeoff → construction → cost; structural/environmental → systems → knowledge; scene alone.
const chain = () => [...base(),
  artifact('QUANTITY_TAKEOFF', 10), artifact('CONSTRUCTION_CALCULATION', 11, [{ family: 'QUANTITY_TAKEOFF', id: uuid(10) }]),
  artifact('BOQ_COST', 12, [{ family: 'CONSTRUCTION_CALCULATION', id: uuid(11) }, { family: 'QUANTITY_TAKEOFF', id: uuid(10) }]),
  artifact('STRUCTURAL_ANALYSIS', 20), artifact('ENVIRONMENTAL_ANALYSIS', 21),
  artifact('BUILDING_SYSTEMS_ANALYSIS', 22, [{ family: 'STRUCTURAL_ANALYSIS', id: uuid(20) }, { family: 'ENVIRONMENTAL_ANALYSIS', id: uuid(21) }]),
  artifact('SPECIALIZED_KNOWLEDGE', 23, [{ family: 'STRUCTURAL_ANALYSIS', id: uuid(20) }, { family: 'BUILDING_SYSTEMS_ANALYSIS', id: uuid(22) }]),
  artifact('SCENE_3D', 30)];

describe('Phase 37 dependency graph builder', () => {
  it('reports every node CURRENT only when the whole chain is verified and bound to the current revision', () => {
    const g = buildDependencyGraph(input(chain()));
    expect(DependencyGraphSchema.parse(g)).toEqual(g);
    expect(g.nodes.every(n => n.state === 'CURRENT' && n.causes.length === 0)).toBe(true);
    expect(g.families.map(f => [f.family, f.state])).toEqual(GRAPH_FAMILIES.map(f => [f, f === 'DESIGN_OPTIMIZATION' ? 'NOT_GENERATED' : 'CURRENT']));
    expect(g.edges).toContainEqual({ from: `BOQ_COST:${uuid(12)}`, to: `CONSTRUCTION_CALCULATION:${uuid(11)}`, kind: 'DERIVED_FROM' });
    expect(g.edges).toContainEqual({ from: `ACCEPTANCE_QA:${QA}`, to: `REVISION:${REV}`, kind: 'QA_OF' });
    expect(g.edges.filter(e => e.kind === 'DERIVED_FROM')).toHaveLength(7);
    expect(node(g, 'BOQ_COST', uuid(12)).checks.map(c => c.check)).toContain('UPSTREAM_PRESENT');
  });

  it('AC4/AC5: a superseded revision makes direct artifacts STALE_SOURCE_CHANGED and derived ones STALE_UPSTREAM_STALE, with a cause chain to the revision', () => {
    const g = buildDependencyGraph(input(chain(), NEWER)), states = Object.fromEntries(g.nodes.map(n => [n.nodeId, n.state]));
    for (const [family, n] of [['QUANTITY_TAKEOFF', 10], ['STRUCTURAL_ANALYSIS', 20], ['ENVIRONMENTAL_ANALYSIS', 21], ['SCENE_3D', 30]] as const)
      expect(states[`${family}:${uuid(n)}`]).toBe('STALE_SOURCE_CHANGED');
    for (const [family, n] of [['CONSTRUCTION_CALCULATION', 11], ['BOQ_COST', 12], ['BUILDING_SYSTEMS_ANALYSIS', 22], ['SPECIALIZED_KNOWLEDGE', 23]] as const)
      expect(states[`${family}:${uuid(n)}`]).toBe('STALE_UPSTREAM_STALE');
    expect([states[`REVISION:${REV}`], states[`ACCEPTANCE_QA:${QA}`]]).toEqual(['STALE_SOURCE_CHANGED', 'STALE_SOURCE_CHANGED']);
    // The chain follows the first stale input in node order (takeoff before construction) down to the superseded revision.
    expect(node(g, 'BOQ_COST', uuid(12)).causes).toEqual([{ code: 'UPSTREAM_STALE', nodeId: `QUANTITY_TAKEOFF:${uuid(10)}` },
      { code: 'SOURCE_REVISION_SUPERSEDED', nodeId: `REVISION:${REV}` }]);
    expect(node(g, 'SPECIALIZED_KNOWLEDGE', uuid(23)).causes).toEqual([{ code: 'UPSTREAM_STALE', nodeId: `STRUCTURAL_ANALYSIS:${uuid(20)}` },
      { code: 'SOURCE_REVISION_SUPERSEDED', nodeId: `REVISION:${REV}` }]);
    // A systems analysis with no upstream references is stale only because its own source changed.
    const alone = buildDependencyGraph(input([...base(), artifact('BUILDING_SYSTEMS_ANALYSIS', 22)], NEWER));
    expect(node(alone, 'BUILDING_SYSTEMS_ANALYSIS', uuid(22))).toMatchObject({ state: 'STALE_SOURCE_CHANGED', causes: [{ code: 'SOURCE_REVISION_SUPERSEDED' }] });
    expect(g.inputIdentity.projectCurrentRevisionId).toBe(NEWER);
  });

  it('AC6: an inconsistent hash makes the node UNVERIFIED and every dependent UNVERIFIED, never CURRENT or merely stale', () => {
    const g = buildDependencyGraph(input(fail(chain(), 'STRUCTURAL_ANALYSIS', 20, 'MODEL_HASH')));
    expect(node(g, 'STRUCTURAL_ANALYSIS', uuid(20))).toMatchObject({ state: 'UNVERIFIED', causes: [{ code: 'MODEL_HASH_MISMATCH', nodeId: `STRUCTURAL_ANALYSIS:${uuid(20)}` }] });
    expect(node(g, 'BUILDING_SYSTEMS_ANALYSIS', uuid(22)).causes).toEqual([{ code: 'UPSTREAM_UNVERIFIED', nodeId: `STRUCTURAL_ANALYSIS:${uuid(20)}` },
      { code: 'MODEL_HASH_MISMATCH', nodeId: `STRUCTURAL_ANALYSIS:${uuid(20)}` }]);
    expect(node(g, 'SPECIALIZED_KNOWLEDGE', uuid(23)).state).toBe('UNVERIFIED');
    expect(node(g, 'ENVIRONMENTAL_ANALYSIS', uuid(21)).state).toBe('CURRENT');
    expect(g.families.find(f => f.family === 'STRUCTURAL_ANALYSIS')!.state).toBe('UNVERIFIED');
    // UNVERIFIED outranks staleness, even on a superseded revision.
    expect(node(buildDependencyGraph(input(fail(chain(), 'QUANTITY_TAKEOFF', 10, 'MODEL_HASH'), NEWER)), 'BOQ_COST', uuid(12)).state).toBe('UNVERIFIED');
    // A revision whose stored identity disagrees with its model fails every node.
    const broken = buildDependencyGraph(input(chain().map(r => r.family === 'REVISION' ? { ...r, checks: [{ check: 'REVISION_IDENTITY' as const, result: 'FAILED' as const }] } : r)));
    expect(broken.nodes.every(n => n.state === 'UNVERIFIED')).toBe(true);
    expect(node(broken, 'SCENE_3D', uuid(30)).causes.at(-1)).toEqual({ code: 'REVISION_IDENTITY_INCONSISTENT', nodeId: `REVISION:${REV}` });
  });

  it('AC7: a named dependency without a node is UPSTREAM_MISSING (fail closed), including a missing revision or QA anchor', () => {
    const records = chain().filter(r => r.family !== 'QUANTITY_TAKEOFF');
    const g = buildDependencyGraph(input(records));
    expect(node(g, 'CONSTRUCTION_CALCULATION', uuid(11))).toMatchObject({ state: 'UNVERIFIED', causes: [{ code: 'UPSTREAM_MISSING', nodeId: `QUANTITY_TAKEOFF:${uuid(10)}` }] });
    expect(node(g, 'BOQ_COST', uuid(12)).state).toBe('UNVERIFIED');
    expect(g.edges.some(e => e.to === `QUANTITY_TAKEOFF:${uuid(10)}`)).toBe(false);
    const noQa = buildDependencyGraph(input(chain().filter(r => r.family !== 'ACCEPTANCE_QA')));
    expect(node(noQa, 'SCENE_3D', uuid(30))).toMatchObject({ state: 'UNVERIFIED', causes: [{ code: 'UPSTREAM_MISSING', nodeId: `ACCEPTANCE_QA:${QA}` }] });
  });

  it('AC8/AC9: matching hashes alone are not enough; binding and QA failures are UNVERIFIED', () => {
    const g = buildDependencyGraph(input(fail(chain(), 'SCENE_3D', 30, 'QA_BINDING')));
    expect(node(g, 'SCENE_3D', uuid(30))).toMatchObject({ state: 'UNVERIFIED', causes: [{ code: 'QA_BINDING_MISMATCH' }] });
    expect(node(g, 'SCENE_3D', uuid(30)).checks).toContainEqual({ check: 'MODEL_HASH', result: 'VERIFIED' });
    const qa = buildDependencyGraph(input(chain().map(r => r.family === 'ACCEPTANCE_QA' ? { ...r, checks: [{ check: 'QA_ACCEPTANCE' as const, result: 'FAILED' as const }] } : r)));
    expect(node(qa, 'ACCEPTANCE_QA', QA)).toMatchObject({ state: 'UNVERIFIED', causes: [{ code: 'QA_NOT_ACCEPTED' }] });
    expect(qa.nodes.filter(n => n.family !== 'REVISION').every(n => n.state === 'UNVERIFIED')).toBe(true);
    expect(node(qa, 'REVISION', REV).state).toBe('CURRENT');
    // Without a known current revision, freshness cannot be established.
    expect(buildDependencyGraph(input(chain(), null)).nodes.every(n => n.state === 'UNVERIFIED' && n.causes.at(-1)!.code === 'NO_CURRENT_REVISION')).toBe(true);
  });

  it('AC10/AC11: cycles, node and depth limits are typed refusals in a fixed order, never a partial graph', () => {
    const cyclic = [...base(), artifact('BUILDING_SYSTEMS_ANALYSIS', 22, [{ family: 'SPECIALIZED_KNOWLEDGE', id: uuid(23) }]),
      artifact('SPECIALIZED_KNOWLEDGE', 23, [{ family: 'BUILDING_SYSTEMS_ANALYSIS', id: uuid(22) }])];
    expect(refusal(() => buildDependencyGraph(input(cyclic)))).toEqual([422, 'DEPENDENCY_GRAPH_CYCLE', null]);
    expect(refusal(() => buildDependencyGraph(input([...base(), artifact('SCENE_3D', 30, [{ family: 'SCENE_3D', id: uuid(30) }])])))).toEqual([422, 'DEPENDENCY_GRAPH_CYCLE', null]);
    expect(refusal(() => buildDependencyGraph(input(chain()), { ...GRAPH_LIMITS, maxNodes: chain().length - 1 }))).toEqual([422, 'DEPENDENCY_GRAPH_LIMIT_EXCEEDED', 'NODES']);
    // knowledge → systems → structural → QA → revision is 4 edges deep.
    expect(refusal(() => buildDependencyGraph(input(chain()), { ...GRAPH_LIMITS, maxDepth: 3 }))).toEqual([422, 'DEPENDENCY_GRAPH_LIMIT_EXCEEDED', 'DEPTH']);
    expect(buildDependencyGraph(input(chain()), { ...GRAPH_LIMITS, maxDepth: 4 }).complete).toBe(true);
    // Too many nodes is reported before a cycle in the same input.
    expect(refusal(() => buildDependencyGraph(input(cyclic), { ...GRAPH_LIMITS, maxNodes: 2 }))).toEqual([422, 'DEPENDENCY_GRAPH_LIMIT_EXCEEDED', 'NODES']);
    expect(refusal(() => buildDependencyGraph(input([...chain(), artifact('SCENE_3D', 30)])))).toEqual([409, 'DEPENDENCY_GRAPH_READ_INCONSISTENT', null]);
  });

  it('AC13: identical records in any order give a byte-identical graph and hash', () => {
    const a = buildDependencyGraph(input(chain(), NEWER)), records = chain();
    for (let i = 0; i < 5; i++) {
      const shuffled = [...records].sort((x, y) => ((x.id.charCodeAt(35) * (i + 7)) % 11) - ((y.id.charCodeAt(35) * (i + 7)) % 11)).reverse()
        .map(r => ({ ...r, dependsOn: [...r.dependsOn].reverse() }));
      expect(JSON.stringify(buildDependencyGraph(input(shuffled, NEWER)))).toBe(JSON.stringify(a));
    }
    const { graphHash, ...body } = a;
    expect(graphHash).toBe(costHash(body));
    expect(buildDependencyGraph(input(chain())).graphHash).not.toBe(graphHash);
  });

  it('AC15: carries provenance only — no assurance level, evidence class, domain status or solver result, and nothing is claimed', () => {
    const g = buildDependencyGraph(input(chain())), text = JSON.stringify(g);
    for (const word of ['assurance', 'evidenceClass', 'REQUIRES_SOLVER', 'NO_VALIDATED_SOLVER', 'NOT_VERIFIED', 'VALIDATED', 'EVALUATED', 'domainStatus', 'solver"'])
      expect(text, word).not.toContain(word);
    expect(g.claims).toEqual({ engineeringCorrectness: 'NOT_CLAIMED', solverValidation: 'NOT_CLAIMED', professionalReview: 'NOT_CLAIMED' });
    expect(g.notRepresented.map(n => n.item)).toEqual(expect.arrayContaining(['BIM', 'ENGINEERING_ASSESSMENT']));
  });
});

describe('Phase 37 record verification recomputes hashes from stored inputs', () => {
  const model = { stand: 'in for the stored model' };
  const revision = { id: REV, createdAt: at(0), identity: { modelHash: HASH }, qa: { id: QA, createdAt: at(0) },
    qaRuns: [{ id: QA, status: 'PASS', report: { inputStatus: 'SCHEMA_VALID', status: 'PASS', summary: { errors: 0 } } }], model };
  const c = { revision, hash: HASH } as never;
  const takeoffBase = { id: uuid(10), projectRevisionId: REV, acceptanceQaId: QA, engineVersion: 'e1', measurementPolicyVersion: 'p1', options: { a: 1 }, createdAt: at(10), report: { quantities: [1, 2] } };
  const takeoff = { ...takeoffBase, inputFingerprint: takeoffFingerprint({ projectRevisionId: REV, model, engineVersion: 'e1', measurementPolicyVersion: 'p1', options: { a: 1 } }) };
  const cReport = { engineVersion: 'c1', recipePack: { id: 'r' }, specification: { s: 1 }, options: {} };
  const construction = { id: uuid(11), projectRevisionId: REV, takeoffId: takeoff.id, acceptanceQaId: QA, createdAt: at(11), report: cReport,
    inputFingerprint: constructionFingerprint(REV, takeoff, cReport as never) };
  const eReport = { engineVersion: 'b1', rateBookHash: 'r'.repeat(64), costingPolicyHash: 'p'.repeat(64), options: {}, lines: [3] };
  const cost = { id: uuid(12), projectRevisionId: REV, takeoffId: takeoff.id, constructionCalculationId: construction.id, acceptanceQaId: QA, createdAt: at(12), report: eReport,
    inputFingerprint: costInputFingerprint(REV, construction, eReport as never), constructionReportHash: costHash(cReport), reportHash: costHash(eReport) };
  const states = (records: GraphRecord[]) => Object.fromEntries(buildDependencyGraph(input([...revisionRecords(c), ...records])).nodes.map(n => [n.family, [n.state, n.causes[0]?.code ?? null]]));
  const verified = (t = takeoff, k = construction, e = cost) => [takeoffRecord(c, t as never), constructionRecord(c, k as never, new Map([[t.id, t as never]])),
    costRecord(c, e as never, new Map([[k.id, k as never]]))];

  it('accepts records whose fingerprints and report hashes recompute exactly', () => {
    expect(states(verified())).toMatchObject({ QUANTITY_TAKEOFF: ['CURRENT', null], CONSTRUCTION_CALCULATION: ['CURRENT', null], BOQ_COST: ['CURRENT', null] });
  });
  it('AC6: a changed option, report or hash is a typed mismatch that propagates', () => {
    expect(states(verified({ ...takeoff, options: { a: 2 } }))).toMatchObject({ QUANTITY_TAKEOFF: ['UNVERIFIED', 'FINGERPRINT_MISMATCH'],
      CONSTRUCTION_CALCULATION: ['UNVERIFIED', 'UPSTREAM_UNVERIFIED'], BOQ_COST: ['UNVERIFIED', 'UPSTREAM_UNVERIFIED'] });
    expect(states(verified(takeoff, { ...construction, report: { ...cReport, options: { x: 1 } } }))).toMatchObject({ CONSTRUCTION_CALCULATION: ['UNVERIFIED', 'FINGERPRINT_MISMATCH'] });
    expect(states(verified(takeoff, construction, { ...cost, reportHash: 'f'.repeat(64) }))).toMatchObject({ BOQ_COST: ['UNVERIFIED', 'REPORT_HASH_MISMATCH'] });
    expect(states(verified(takeoff, construction, { ...cost, constructionReportHash: 'f'.repeat(64) }))).toMatchObject({ BOQ_COST: ['UNVERIFIED', 'REPORT_HASH_MISMATCH'] });
    expect(states(verified(takeoff, construction, { ...cost, takeoffId: uuid(99) }))).toMatchObject({ BOQ_COST: ['UNVERIFIED', 'UPSTREAM_MISSING'] });
    const stranger = { ...takeoff, id: uuid(98) };
    expect(states([...verified(), takeoffRecord(c, stranger as never), costRecord(c, { ...cost, id: uuid(97), takeoffId: stranger.id } as never, new Map([[construction.id, construction as never]]))])
      .BOQ_COST).toEqual(['UNVERIFIED', 'LINK_INCONSISTENT']);
    expect(states([analysisRecord(c, 'SCENE_3D', { ...takeoff, modelHash: 'b'.repeat(64) })])).toMatchObject({ SCENE_3D: ['UNVERIFIED', 'MODEL_HASH_MISMATCH'] });
    expect(states([analysisRecord(c, 'SCENE_3D', { ...takeoff, modelHash: HASH, projectRevisionId: NEWER })])).toMatchObject({ SCENE_3D: ['UNVERIFIED', 'REVISION_BINDING_MISMATCH'] });
  });
  it('AC9: the acceptance QA must exist, pass, be schema-valid and error-free; a stored identity must match the model', () => {
    const verdict = (patch: object, identity: object | null = revision.identity) => {
      const r = { ...revision, identity, qaRuns: [{ ...revision.qaRuns[0]!, ...patch }] };
      return Object.fromEntries(buildDependencyGraph(input(revisionRecords({ revision: r, hash: HASH } as never))).nodes.map(n => [n.family, n.causes[0]?.code ?? n.state]));
    };
    expect(verdict({})).toEqual({ REVISION: 'CURRENT', ACCEPTANCE_QA: 'CURRENT' });
    expect(verdict({ status: 'FAIL' }).ACCEPTANCE_QA).toBe('QA_NOT_ACCEPTED');
    expect(verdict({ report: { ...revision.qaRuns[0]!.report, summary: { errors: 1 } } }).ACCEPTANCE_QA).toBe('QA_NOT_ACCEPTED');
    expect(verdict({ id: uuid(77) }).ACCEPTANCE_QA).toBe('QA_NOT_ACCEPTED');
    expect(verdict({}, { modelHash: 'c'.repeat(64) }).REVISION).toBe('REVISION_IDENTITY_INCONSISTENT');
    expect(verdict({}, null).REVISION).toBe('CURRENT');
  });
});
