import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { BlueprintError, generateParametricBlueprint, normalizeParametricRequirements, type ParametricRequirements } from '@designflow/generator';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { calculateQuantityTakeoff } from '@designflow/quantity-takeoff';
import { calculateConstruction, type ConstructionSpecificationInput } from '@designflow/construction-calculations';
import { calculateBoqCost, costHash, sampleCostingPolicy, sampleRateBook } from '@designflow/boq-cost';
import type { BuildingModelV2 } from '@designflow/shared';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { specification } from '../../../packages/construction-calculations/tests/fixtures.js';
import { modelHash } from '../src/lib/generation-identity.js';
import { projectQaOptions } from '../src/services/project-service.js';
import { parametricQaOptions } from '../src/services/parametric-qa.js';
import { CLAIMS, OPTIMIZATION_CANDIDATE_VERSION, OPTIMIZATION_LIMITS, OptimizationError, type OptimizationSource, type Study, type Variable } from '../src/optimization/contracts.js';
import { architectureFor, candidateSpaceSize, vectorOf } from '../src/optimization/domain.js';
import { measure, generateWithEngine, type CandidateContext, type Generate } from '../src/optimization/candidate.js';
import { runOptimizationStudy, type StudyDeps, type StudyRun } from '../src/optimization/study.js';
import { validateOptimizationStudy } from '../src/optimization/validate.js';

// ---------- fixtures ----------
function makeSource(requirements: ParametricRequirements = parametricInput(), generate: Generate = generateWithEngine): OptimizationSource {
  const r = normalizeParametricRequirements(requirements), model = generate(r, { timeoutMs: 10000 }).model as BuildingModelV2;
  const qa = auditBlueprint(model, { ...projectQaOptions(model), ...parametricQaOptions(r) });
  return { projectId: 'project-1', revisionId: 'revision-1', generatorVersion: 'parametric-architecture-v1', normalizedRequirements: r, model,
    identity: { modelHash: modelHash(model) }, qa: { status: qa.status, inputStatus: qa.inputStatus, errors: qa.summary.errors } };
}
const ONE = makeSource(), TWO = makeSource(parametricInput(true));
const PARAMS = ['widthMm', 'depthMm', 'westWingWidthMm', 'southWingDepthMm'] as const;
type P = typeof PARAMS[number];
const range = (minimumMm: number, maximumMm: number, stepMm: number) => ({ kind: 'RANGE' as const, minimumMm, maximumMm, stepMm });
const values = (...valuesMm: number[]) => ({ kind: 'VALUES' as const, valuesMm });
const variable = (variableId: string, level: 0 | 1, parameter: P, domain: Variable['domain']) =>
  ({ variableId, target: { kind: 'PARAMETRIC_FLOOR_DIMENSION' as const, level, parameter }, unit: 'mm' as const, domain, allowedMutation: 'SET_PARAMETRIC_DIMENSION' as const });
const width = (domain: Variable['domain'] = range(16000, 20000, 1000)) => variable('w0', 0, 'widthMm', domain);
const GFA = { kind: 'GROSS_FLOOR_AREA' }, WALL = { kind: 'WALL_CENTERLINE_LENGTH' }, COST = { kind: 'PRICED_SCOPE_TOTAL' };
const MIN = { kind: 'MINIMIZE' }, MAX = { kind: 'MAXIMIZE' };
const objective = (objectiveId: string, metric: object, goal: object, extra: object = { weight: 1, normalization: { method: 'CANDIDATE_RANGE' } }) => ({ objectiveId, metric, goal, ...extra });
const input = (o: Record<string, unknown> = {}) => ({ version: 'optimization-input-v1', mode: 'WEIGHTED_SCORE', strategy: { kind: 'GRID' }, variables: [width()], objectives: [objective('gfa', GFA, MIN)], ...o });
const run = (i: unknown, source = ONE, deps: StudyDeps = {}) => runOptimizationStudy(source, i, deps);
const costCfg = (spec: unknown = specification()) => ({ rateBookId: 'sample-inr-v1', specification: spec, policy: sampleCostingPolicy() });
const unpricedSpec = () => {
  const s: ConstructionSpecificationInput = specification();
  s.assemblies.push({ id: 'window', kind: 'component', wastagePercent: '0', materialCode: 'WINDOW_UNIT' });
  s.assignments.push({ id: 'windows', basis: 'WINDOW_COUNT', assemblyId: 'window', layerId: 'component', selector: { kind: 'default' } });
  return s;
};
const at = (s: Study, w: number) => s.candidates.find(c => c.parameters[0] === w)!;
function expectError(fn: () => unknown, code: string, details?: Record<string, string>) {
  let caught: unknown;
  try { fn(); } catch (error) { caught = error; }
  expect(caught, `expected ${code}`).toBeInstanceOf(OptimizationError);
  expect((caught as OptimizationError).code).toBe(code);
  if (details) expect((caught as OptimizationError).details).toMatchObject(details);
}
const tamper = (s: Study, mutate: (s: Study) => void) => { const t = structuredClone(s); mutate(t); const { resultHash: _r, ...body } = t; t.resultHash = costHash(body); return t; };
const counting = (inner: Generate = generateWithEngine) => { const calls = { n: 0 }; const generate: Generate = (r, e) => { calls.n++; return inner(r, e); }; return { calls, generate }; };
const when = (width0: number, change: (m: BuildingModelV2) => void): Generate => (r, e) => {
  const out = generateWithEngine(r, e);
  if (r.parametricArchitecture.floors[0]!.widthMm === width0) change(out.model as BuildingModelV2);
  return out;
};
const throwsAt = (width0: number, code: 'SEARCH_LIMIT_EXHAUSTED' | 'SOLVER_TIMEOUT' | 'SOLVER_CANCELLED'): Generate => (r, e) => {
  if (r.parametricArchitecture.floors[0]!.widthMm === width0) throw new BlueprintError(code, 'injected');
  return generateWithEngine(r, e);
};

describe('Phase 28 domains, enumeration and preflight', () => {
  it('one variable: RANGE includes the exact endpoint, canonical order', () => {
    const { study } = run(input({ variables: [width(range(16000, 20000, 2000))] }));
    expect(study.candidates.map(c => c.parameters[0])).toEqual([16000, 18000, 20000]);
    expect(study.search).toMatchObject({ candidateSpaceSize: '3', evaluatedAssignments: 3, candidates: 3, valid: 3 });
    expect(study.candidates.map(c => c.ordinal)).toEqual([0, 1, 2]);
  });
  it('VALUES domains and multiple variables enumerate the product in slot order', () => {
    const { study } = run(input({ variables: [variable('d0', 0, 'depthMm', values(17000, 18000)), width(values(17000, 19000))] }));
    expect(study.candidates.map(c => [c.parameters[0], c.parameters[1]])).toEqual([[17000, 17000], [17000, 18000], [18000, 18000], [19000, 17000], [19000, 18000]]);
    expect(study.input.variables.map(v => v.variableId)).toEqual(['w0', 'd0']);
  });
  it('baseline outside the GRID domain is still evaluated and identified', () => {
    const { study } = run(input({ variables: [width(values(17000, 19000))] }));
    expect(study.candidates.map(c => [c.parameters[0], c.isBaseline])).toEqual([[17000, false], [18000, true], [19000, false]]);
    expect(study.search.candidateSpaceSize).toBe('2');
  });
  it('all eight variables on a two-storey revision', () => {
    const base = vectorOf(normalizeParametricRequirements(parametricInput(true)).parametricArchitecture);
    const vars = base.map((v, i) => variable(`v${i}`, (i < 4 ? 0 : 1) as 0 | 1, PARAMS[i % 4]!, i % 4 === 0 ? values(v!, v! + 500) : values(v!)));
    const { study } = run(input({ variables: vars }), TWO);
    expect(study.input.variables).toHaveLength(8);
    expect(study.search.candidateSpaceSize).toBe('4');
    expect(study.candidates.map(c => [c.parameters[0], c.parameters[4]])).toEqual([[18000, 16000], [18000, 16500], [18500, 16000], [18500, 16500]]);
    expect(study.candidates.every(c => c.status === 'VALID')).toBe(true);
  });
  it('computes exact BigInt space sizes', () => {
    const big = Array.from({ length: 8 }, (_, i) => ({ ...variable(`v${i}`, (i < 4 ? 0 : 1) as 0 | 1, PARAMS[i % 4]!, range(1000, 64000, 1000)) })) as Variable[];
    expect(candidateSpaceSize(big)).toBe(64n ** 8n);
    expect(candidateSpaceSize([width(values(1000, 2000, 3000))] as Variable[])).toBe(3n);
  });
  it('refuses search-space overflow before generating anything', () => {
    const { calls, generate } = counting();
    expectError(() => run(input({ variables: [width(range(9500, 21000, 500)), variable('d0', 0, 'depthMm', range(15000, 20500, 500))] }), ONE, { generate }),
      'OPTIMIZATION_RESOURCE_LIMIT', { limit: 'candidateSpaceSize', value: '288', max: '128' });
    expect(calls.n).toBe(0);
  });
  it('rejects invalid ranges, duplicate slots, missing levels and malformed numbers', () => {
    expectError(() => run(input({ variables: [width(range(16000, 20000, 3000))] })), 'OPTIMIZATION_INPUT_INVALID');
    expectError(() => run(input({ variables: [width(), { ...width(), variableId: 'w1' }] })), 'OPTIMIZATION_INPUT_INVALID', { field: 'variables.target' });
    expectError(() => run(input({ variables: [variable('w1', 1, 'widthMm', values(10000))] })), 'OPTIMIZATION_INPUT_INVALID', { field: 'variables.target.level' });
    expectError(() => run(input({ variables: [width(values(16000, NaN))] })), 'OPTIMIZATION_INPUT_INVALID');
    let deep: unknown = 1; for (let i = 0; i < 40; i++) deep = { a: deep };
    expectError(() => run(input({ extra: deep })), 'OPTIMIZATION_RESOURCE_LIMIT');
  });
});

describe('Phase 28 source eligibility and baseline protection', () => {
  it('baseline rebuild reproduces the accepted modelHash', () => {
    const { study } = run(input());
    const baseline = study.candidates.find(c => c.isBaseline)!;
    expect(baseline.modelHash).toBe(ONE.identity!.modelHash);
    expect(study.baseline.candidateId).toBe(baseline.candidateId);
  });
  it('refuses mismatched baselines, unsupported generators and unaccepted revisions', () => {
    expectError(() => run(input(), { ...ONE, identity: { modelHash: '0'.repeat(64) } }), 'OPTIMIZATION_BASELINE_MISMATCH');
    expectError(() => run(input(), ONE, { generate: (r, e) => { const out = generateWithEngine(r, e); (out.model as BuildingModelV2).name = 'drifted'; return out; } }), 'OPTIMIZATION_BASELINE_MISMATCH');
    expectError(() => run(input(), { ...ONE, generatorVersion: 'precision-blueprint-v2' }), 'OPTIMIZATION_UNSUPPORTED', { reason: 'SOURCE_GENERATOR_UNSUPPORTED' });
    expectError(() => run(input(), { ...ONE, normalizedRequirements: null }), 'OPTIMIZATION_UNSUPPORTED');
    expectError(() => run(input(), { ...ONE, qa: { status: 'FAIL', inputStatus: 'SCHEMA_VALID', errors: 1 } }), 'REVISION_NOT_ACCEPTED');
  });
  it('never mutates the source revision', () => {
    const before = structuredClone(ONE);
    run(input({ variables: [width(), variable('s0', 0, 'southWingDepthMm', values(7000, 8000))] }));
    expect(ONE).toEqual(before);
  });
});

describe('Phase 28 hard gates', () => {
  it('maps normalization and generation rejections; rejected candidates carry no metrics or rank', () => {
    const { study } = run(input({ variables: [width(values(9000, 9500, 18000, 21500))] }));
    expect(at(study, 9000).rejection).toEqual({ stage: 'NORMALIZATION', code: 'PARAMETERS_INVALID', details: ['INVALID_REQUIREMENTS'] });
    expect(at(study, 21500).rejection).toEqual({ stage: 'NORMALIZATION', code: 'SITE_CONTAINMENT', details: ['PROGRAM_DOES_NOT_FIT'] });
    expect(at(study, 9500).rejection?.stage).toBe('GENERATION');
    for (const w of [9000, 9500, 21500]) expect(at(study, w)).toMatchObject({ status: 'REJECTED', modelHash: null, metrics: {}, score: null, rank: null });
    expect(at(study, 18000).rank).toBe(1);
  });
  it('maps setback violations', () => {
    const r = parametricInput(); r.site.setbacks = [{ boundaryEdgeStart: 1, minimumMm: 2000 }];
    const { study } = run(input({ variables: [width(values(18000, 20000))] }), makeSource(r));
    expect(at(study, 20000).rejection).toEqual({ stage: 'NORMALIZATION', code: 'SETBACK_VIOLATION', details: ['PROGRAM_DOES_NOT_FIT'] });
  });
  it('rejects schema-invalid and QA-failing models', () => {
    const vars = [width(values(18000, 20000))];
    expect(at(run(input({ variables: vars }), ONE, { generate: when(20000, m => { m.slabs = []; }) }).study, 20000).rejection).toMatchObject({ stage: 'MODEL', code: 'MODEL_INVARIANT_FAILED' });
    const noDoor = when(20000, m => { const w = new Set(m.walls.filter(x => x.spaceIds?.includes('space-bedroom-1')).map(x => x.id)); m.openings = m.openings.filter(o => !(o.kind === 'door' && w.has(o.wallId))); });
    const rejected = at(run(input({ variables: vars }), ONE, { generate: noDoor }).study, 20000);
    expect(rejected.rejection).toMatchObject({ stage: 'QA', code: 'QA_FAILED' });
    expect(rejected.rejection!.details).toContain('QA_PARAMETRIC_REACHABILITY');
  });
  it('accepts QA warnings unless QA_NO_WARNINGS is required', () => {
    const raised: Generate = (r, e) => {
      const out = generateWithEngine(r, e), m = out.model as BuildingModelV2, d = m.openings.find(o => o.kind === 'door')!;
      m.openings.push({ ...d, id: `${d.id}-raised`, offsetMm: d.offsetMm + d.widthMm + 1000, sillMm: 300 });
      return out;
    };
    const source = makeSource(parametricInput(), raised);
    expect(source.qa.status).toBe('PASS_WITH_WARNINGS');
    const vars = [width(values(17000, 18000))];
    expect(run(input({ variables: vars }), source, { generate: raised }).study.candidates.map(c => [c.status, c.qa?.status])).toEqual([['VALID', 'PASS_WITH_WARNINGS'], ['VALID', 'PASS_WITH_WARNINGS']]);
    const strict = run(input({ variables: vars, hardConstraints: [{ constraintId: 'no-warn', kind: 'QA_NO_WARNINGS' }] }), source, { generate: raised }).study;
    expect(strict.candidates.map(c => c.rejection)).toEqual([0, 1].map(() => ({ stage: 'CONSTRAINT', code: 'CONSTRAINT_FAILED', details: ['no-warn'] })));
    expect(strict.status).toBe('NO_VALID_CANDIDATE');
    expect(strict.claims.searchResult).toBe('NONE');
  });
  it('SEARCH_LIMIT_EXHAUSTED rejects a candidate; wall-clock timeouts abort the whole study', () => {
    const vars = [width(values(18000, 20000))];
    expect(at(run(input({ variables: vars }), ONE, { generate: throwsAt(20000, 'SEARCH_LIMIT_EXHAUSTED') }).study, 20000).rejection)
      .toEqual({ stage: 'GENERATION', code: 'GENERATOR_SEARCH_LIMIT', details: ['SEARCH_LIMIT_EXHAUSTED'] });
    for (const code of ['SOLVER_TIMEOUT', 'SOLVER_CANCELLED'] as const)
      expectError(() => run(input({ variables: vars }), ONE, { generate: throwsAt(20000, code) }), 'OPTIMIZATION_RESOURCE_LIMIT', { cause: code });
  });
  it('enforces the study deadline without returning a partial study', () => {
    let t = 0;
    expectError(() => run(input(), ONE, { now: () => (t += 7000) }), 'OPTIMIZATION_RESOURCE_LIMIT', { limit: 'deadlineMs' });
  });
});

describe('Phase 28 metrics, constraints and cost', () => {
  it('exact takeoff metrics and ratios', () => {
    const ratio = { kind: 'RATIO', numerator: { kind: 'CLASSIFICATION_FLOOR_AREA', classification: 'circulation' }, denominator: GFA };
    const { study } = run(input({ objectives: [objective('gfa', GFA, MIN), objective('circ', ratio, MIN, { weight: 0 }), objective('bed', { kind: 'SPACE_FLOOR_AREA', spaceId: 'space-bedroom-1' }, MAX, { weight: 0 })] }));
    for (const c of study.candidates) {
      const w = c.parameters[0]!, gfa = c.metrics.GROSS_FLOOR_AREA!, circ = c.metrics['CLASSIFICATION_FLOOR_AREA:circulation'];
      expect(gfa).toEqual({ status: 'EVALUATED', stage: 'A', unit: 'mm2', value: { numerator: String(w * 8000 + 9000 * 10000), denominator: '1' }, reason: null });
      expect(circ).toBeUndefined(); // only the ratio was requested
      const r = c.metrics['RATIO(CLASSIFICATION_FLOOR_AREA:circulation/GROSS_FLOOR_AREA)']!;
      expect(r).toMatchObject({ status: 'EVALUATED', unit: '1' });
      expect(BigInt(r.value!.numerator)).toBeLessThan(BigInt(r.value!.denominator));
      expect(c.metrics['SPACE_FLOOR_AREA:space-bedroom-1']!.status).toBe('EVALUATED');
    }
  });
  it('metric bounds pass and fail exactly at the boundary', () => {
    const { study } = run(input({ hardConstraints: [{ constraintId: 'max-gfa', kind: 'METRIC_BOUND', metric: GFA, operator: 'LE', value: '234000000' }] }));
    expect(study.candidates.map(c => c.status)).toEqual(['VALID', 'VALID', 'VALID', 'REJECTED', 'REJECTED']);
    expect(at(study, 18000).constraints).toEqual([{ constraintId: 'max-gfa', result: 'PASS', reason: null }]);
    expect(at(study, 19000).rejection).toEqual({ stage: 'CONSTRAINT', code: 'CONSTRAINT_FAILED', details: ['max-gfa'] });
  });
  it('refuses deferred, unknown and unconfigured metrics and sources', () => {
    expectError(() => run(input({ objectives: [objective('s', { kind: 'STRUCTURAL', member: 'beam-1' }, MIN)] })), 'OPTIMIZATION_UNSUPPORTED', { reason: 'DEFERRED_METRIC:STRUCTURAL' });
    expectError(() => run(input({ hardConstraints: [{ constraintId: 'k', kind: 'METRIC_BOUND', metric: { kind: 'KNOWLEDGE' }, operator: 'LE', value: '1' }] })), 'OPTIMIZATION_UNSUPPORTED', { reason: 'DEFERRED_METRIC:KNOWLEDGE' });
    expectError(() => run(input({ objectives: [objective('x', { kind: 'DAYLIGHT_FACTOR' }, MIN)] })), 'OPTIMIZATION_INPUT_INVALID');
    expectError(() => run(input({ objectives: [objective('c', { kind: 'CLASSIFICATION_FLOOR_AREA', classification: 'garage' }, MIN)] })), 'OPTIMIZATION_INPUT_INVALID', { field: 'metric.classification' });
    expectError(() => run(input({ objectives: [objective('c', COST, MIN)] })), 'OPTIMIZATION_INPUT_INVALID', { field: 'cost' });
    expectError(() => run(input({ cost: costCfg() })), 'OPTIMIZATION_INPUT_INVALID', { field: 'cost' });
    expectError(() => run(input({ sources: { structuralAnalysisId: '00000000-0000-4000-8000-000000000000', environmentalAnalysisId: null, systemsAnalysisId: null, knowledgeAnalysisId: null } })),
      'OPTIMIZATION_UNSUPPORTED', { reason: 'SOURCE_ANALYSIS_DEFERRED' });
    expectError(() => run(input(), ONE, { knowledge: { version: 'x', evaluateCandidate: () => ({ status: 'NOT_EVALUATED', rules: [], conflicts: 0 }) } }),
      'OPTIMIZATION_UNSUPPORTED', { reason: 'PHASE27_INTEGRATION_DEFERRED' });
  });
  it('cost objective uses the unchanged money engine on a comparable priced scope', () => {
    const { study } = run(input({ variables: [width(values(17000, 18000, 19000))], cost: costCfg(), objectives: [objective('cost', COST, MIN)] }));
    const direct = calculateBoqCost(calculateConstruction(calculateQuantityTakeoff(ONE.model), specification()), sampleRateBook(), sampleCostingPolicy());
    const baseline = at(study, 18000).metrics.PRICED_SCOPE_TOTAL!;
    expect(baseline).toMatchObject({ status: 'EVALUATED', stage: 'B', unit: 'INR' });
    expect(BigInt(baseline.value!.numerator) * 100n).toBe(BigInt(baseline.value!.denominator) * BigInt(direct.finalTotals.pricedGrandTotal.replace('.', '')));
    expect(study.cost).toMatchObject({ basis: 'PRICED_SCOPE_ONLY', baselineCompleteTotalAvailable: false });
    expect(study.candidates.every(c => c.metrics.PRICED_SCOPE_TOTAL!.status === 'EVALUATED' && c.cost!.scopeSignature === study.cost!.baselineScopeSignature)).toBe(true);
    expect(study.candidates.map(c => c.rank)).toEqual([1, 2, 3]);
  });
  it('unpriced lines are INPUT_INCOMPLETE, never zero', () => {
    const vars = [width(values(17000, 18000))];
    const objectiveStudy = run(input({ variables: vars, cost: costCfg(unpricedSpec()), objectives: [objective('gfa', GFA, MIN), objective('cost', COST, MIN)] })).study;
    for (const c of objectiveStudy.candidates) {
      expect(c.metrics.PRICED_SCOPE_TOTAL).toMatchObject({ status: 'INPUT_INCOMPLETE', value: null, reason: 'COST_UNPRICED_LINES' });
      expect(c).toMatchObject({ status: 'PARTIAL', score: null, rank: null });
    }
    const constraintStudy = run(input({ variables: vars, cost: costCfg(unpricedSpec()), hardConstraints: [{ constraintId: 'budget', kind: 'METRIC_BOUND', metric: COST, operator: 'LE', value: '999999999' }] })).study;
    expect(constraintStudy.candidates.map(c => [c.status, c.constraints[0]!.result])).toEqual([['INPUT_INCOMPLETE', 'NOT_EVALUATED'], ['INPUT_INCOMPLETE', 'NOT_EVALUATED']]);
    expect(constraintStudy.status).toBe('NO_VALID_CANDIDATE');
  });
  it('a priced scope different from the baseline is not comparable', () => {
    const ctx: CandidateContext = { requirements: normalizeParametricRequirements(parametricInput()), cost: costCfg() as CandidateContext['cost'], metrics: [{ kind: 'PRICED_SCOPE_TOTAL' }],
      generate: generateWithEngine, timings: { generation: 0, qa: 0, takeoff: 0, cost: 0 }, now: () => 0 };
    const own = measure(ctx, ONE.model, null);
    expect(own.metrics.PRICED_SCOPE_TOTAL!.status).toBe('EVALUATED');
    expect(measure(ctx, ONE.model, own.cost!.scopeSignature).metrics.PRICED_SCOPE_TOTAL!.status).toBe('EVALUATED');
    expect(measure(ctx, ONE.model, 'f'.repeat(64)).metrics.PRICED_SCOPE_TOTAL).toMatchObject({ status: 'INPUT_INCOMPLETE', value: null, reason: 'COST_SCOPE_NOT_COMPARABLE' });
  });
  it('entity-selector cost specifications are not transferable', () => {
    const s: ConstructionSpecificationInput = specification(); s.assignments[0] = { ...s.assignments[0]!, selector: { kind: 'entity', value: 'slab-level-0' } };
    expectError(() => run(input({ cost: costCfg(s), objectives: [objective('cost', COST, MIN)] })), 'OPTIMIZATION_UNSUPPORTED', { reason: 'COST_SPECIFICATION_NOT_TRANSFERABLE' });
  });
});

describe('Phase 28 objectives, normalization and weighted scoring', () => {
  it('MINIMIZE and MAXIMIZE rank in opposite directions', () => {
    expect(run(input()).study.candidates.map(c => c.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(run(input({ objectives: [objective('gfa', GFA, MAX)] })).study.candidates.map(c => c.rank)).toEqual([5, 4, 3, 2, 1]);
  });
  it('TARGET uses |v − target| with TARGET_TOLERANCE, clamped at zero', () => {
    const { study } = run(input({ objectives: [objective('gfa', GFA, { kind: 'TARGET', target: '234000000' }, { weight: 1, normalization: { method: 'TARGET_TOLERANCE', tolerance: '12000000' } })] }));
    expect(at(study, 18000).objectives[0]).toMatchObject({ value: { numerator: '0', denominator: '1' }, normalized: { numerator: '1', denominator: '1' }, clamped: false });
    expect(at(study, 17000).objectives[0]).toMatchObject({ value: { numerator: '8000000', denominator: '1' }, normalized: { numerator: '1', denominator: '3' }, clamped: false });
    expect(at(study, 16000).objectives[0]).toMatchObject({ normalized: { numerator: '0', denominator: '1' }, clamped: true });
    expect(study.recommendedCandidates).toEqual([at(study, 18000).candidateId]);
  });
  it('EXPLICIT_BOUNDS clamps outside the declared range', () => {
    const { study } = run(input({ objectives: [objective('gfa', GFA, MIN, { weight: 1, normalization: { method: 'EXPLICIT_BOUNDS', best: '220000000', worst: '240000000' } })] }));
    expect(at(study, 16000).objectives[0]).toMatchObject({ normalized: { numerator: '1', denominator: '1' }, clamped: true });
    expect(at(study, 18000).objectives[0]).toMatchObject({ normalized: { numerator: '3', denominator: '10' }, clamped: false });
    expect(at(study, 20000).objectives[0]).toMatchObject({ normalized: { numerator: '0', denominator: '1' }, clamped: true });
    expect(study.normalization[0]).toMatchObject({ method: 'EXPLICIT_BOUNDS', best: { numerator: '220000000', denominator: '1' }, degenerate: false });
  });
  it('CANDIDATE_RANGE records bounds; degenerate ranges tie and break canonically', () => {
    expect(run(input()).study.normalization[0]).toMatchObject({ method: 'CANDIDATE_RANGE', best: { numerator: '218000000' }, worst: { numerator: '250000000' }, degenerate: false });
    const flat = run(input({ variables: [variable('w1', 1, 'widthMm', values(15000, 16000, 17000))], objectives: [objective('fp', { kind: 'FOOTPRINT_AREA' }, MIN)] }), TWO).study;
    expect(flat.normalization[0]!.degenerate).toBe(true);
    expect(flat.candidates.map(c => [c.score, c.rank])).toEqual([1, 2, 3].map(r => [{ numerator: '1', denominator: '1' }, r]));
    expect(flat.recommendedCandidates).toEqual(flat.candidates.map(c => c.candidateId));
  });
  it('weight 0 is REPORT_ONLY and leaves scores unchanged', () => {
    const plain = run(input()).study, report = run(input({ objectives: [objective('gfa', GFA, MIN), objective('wall', WALL, MIN, { weight: 0 })] })).study;
    expect(report.candidates.map(c => c.score)).toEqual(plain.candidates.map(c => c.score));
    for (const c of report.candidates) expect(c.objectives.find(o => o.objectiveId === 'wall')).toMatchObject({ status: 'EVALUATED', weight: 0, normalized: null, contribution: null });
    expect(report.normalization.map(n => n.objectiveId)).toEqual(['gfa']);
  });
  it('weighted contributions sum exactly to the score', () => {
    const { study } = run(input({ objectives: [objective('gfa', GFA, MIN, { weight: 3, normalization: { method: 'CANDIDATE_RANGE' } }), objective('wall', WALL, MAX)] }));
    for (const c of study.candidates) {
      const sum = c.objectives.reduce<[bigint, bigint]>((acc, o) => o.contribution ? [acc[0] * BigInt(o.contribution.denominator) + BigInt(o.contribution.numerator) * acc[1], acc[1] * BigInt(o.contribution.denominator)] : acc, [0n, 1n]);
      expect(sum[0] * BigInt(c.score!.denominator)).toBe(BigInt(c.score!.numerator) * sum[1]);
    }
  });
  it('rejects invalid weights and normalization pairings; PARETO takes no weights', () => {
    const target = { kind: 'TARGET', target: '1' };
    for (const objectives of [
      [objective('gfa', GFA, MIN, { weight: 0 })],
      [objective('gfa', GFA, MIN, { weight: -1, normalization: { method: 'CANDIDATE_RANGE' } })],
      [objective('gfa', GFA, MIN, { weight: 1.5, normalization: { method: 'CANDIDATE_RANGE' } })],
      [objective('gfa', GFA, MIN, { normalization: { method: 'CANDIDATE_RANGE' } })],
      [objective('gfa', GFA, MIN, { weight: 1 })],
      [objective('gfa', GFA, MIN, { weight: 0, normalization: { method: 'CANDIDATE_RANGE' } })],
      [objective('gfa', GFA, MIN, { weight: 1, normalization: { method: 'EXPLICIT_BOUNDS', best: '3', worst: '2' } })],
      [objective('gfa', GFA, MAX, { weight: 1, normalization: { method: 'EXPLICIT_BOUNDS', best: '2', worst: '3' } })],
      [objective('gfa', GFA, target, { weight: 1, normalization: { method: 'CANDIDATE_RANGE' } })],
      [objective('gfa', GFA, MIN, { weight: 1, normalization: { method: 'TARGET_TOLERANCE', tolerance: '1' } })],
      [objective('gfa', GFA, target, { weight: 1, normalization: { method: 'TARGET_TOLERANCE', tolerance: '0' } })],
    ]) expectError(() => run(input({ objectives })), 'OPTIMIZATION_INPUT_INVALID');
    expectError(() => run(input({ mode: 'PARETO' })), 'OPTIMIZATION_INPUT_INVALID');
  });
});

describe('Phase 28 Pareto', () => {
  const pareto = (objectives: object[], extra: object = {}) => input({ mode: 'PARETO', objectives, ...extra });
  it('dominance: the smallest footprint with the shortest walls dominates', () => {
    const { study } = run(pareto([objective('gfa', GFA, MIN, {}), objective('wall', WALL, MIN, {})]));
    const smallest = at(study, 16000);
    expect(study.paretoFrontier).toEqual([smallest.candidateId]);
    expect(study.recommendedCandidates).toEqual(study.paretoFrontier);
    for (const c of study.candidates.slice(1)) expect(c).toMatchObject({ paretoStatus: 'DOMINATED', rank: null, score: null });
    expect(at(study, 20000).dominatedBy[0]).toBe(smallest.candidateId);
  });
  it('incomparable candidates are all non-dominated', () => {
    const { study } = run(pareto([objective('small', GFA, MIN, {}), objective('large', GFA, MAX, {})]));
    expect(study.candidates.every(c => c.paretoStatus === 'NON_DOMINATED')).toBe(true);
    expect(study.paretoFrontier).toEqual(study.candidates.map(c => c.candidateId));
  });
  it('identical objective vectors are all non-dominated', () => {
    const { study } = run(pareto([objective('fp', { kind: 'FOOTPRINT_AREA' }, MIN, {})], { variables: [variable('w1', 1, 'widthMm', values(15000, 16000, 17000))] }), TWO);
    expect(study.candidates.map(c => c.paretoStatus)).toEqual(['NON_DOMINATED', 'NON_DOMINATED', 'NON_DOMINATED']);
  });
  it('rejected candidates are not eligible', () => {
    const { study } = run(pareto([objective('gfa', GFA, MIN, {})], { variables: [width(values(9000, 18000))] }));
    expect(at(study, 9000).paretoStatus).toBe('NOT_ELIGIBLE');
    expect(study.paretoFrontier).toEqual([at(study, 18000).candidateId]);
  });
});

describe('Phase 28 identity, deduplication, adoption and determinism', () => {
  it('deduplicates by modelHash before QA and records aliases', () => {
    const collapse: Generate = (r, e) => generateWithEngine({ ...r, parametricArchitecture: { ...r.parametricArchitecture, floors: r.parametricArchitecture.floors.map(f => ({ ...f, widthMm: 18000 })) } }, e);
    const { calls, generate } = counting(collapse);
    const { study } = run(input({ variables: [width(values(16000, 17000, 18000, 19000))] }), ONE, { generate });
    expect(calls.n).toBe(4);
    expect(study.candidates).toHaveLength(1);
    expect(study.candidates[0]!.isBaseline).toBe(true);
    expect(study.candidates[0]!.aliases.map(a => a.parameters[0])).toEqual([16000, 17000, 19000]);
    expect(study.search).toMatchObject({ evaluatedAssignments: 4, candidates: 1, deduplicated: 3 });
  });
  it('candidateId is deterministic and independent of objectives', () => {
    const a = run(input()).study, b = run(input({ objectives: [objective('wall', WALL, MAX)] })).study;
    expect(a.candidates.map(c => c.candidateId)).toEqual(b.candidates.map(c => c.candidateId));
    const c = a.candidates[0]!;
    expect(c.candidateId).toBe(costHash({ version: OPTIMIZATION_CANDIDATE_VERSION, projectId: 'project-1', sourceRevisionId: 'revision-1', sourceModelHash: ONE.identity!.modelHash,
      generatorVersion: 'parametric-architecture-v1', seed: 'phase22', parameters: c.parameters }));
    expect(a.inputHash).not.toBe(b.inputHash);
  });
  it('identical reruns are byte-identical; declaration order does not matter; timings are not hashed', () => {
    const i = input({ variables: [width(values(17000, 19000)), variable('s0', 0, 'southWingDepthMm', values(7000, 8000))], objectives: [objective('wall', WALL, MIN), objective('gfa', GFA, MIN)] });
    const first = run(i), second = run(structuredClone(i));
    expect(JSON.stringify(second.study)).toBe(JSON.stringify(first.study));
    const reordered = run({ ...i, variables: [...(i.variables as object[])].reverse(), objectives: [...(i.objectives as object[])].reverse() });
    expect(reordered.study.resultHash).toBe(first.study.resultHash);
    expect(first.diagnostics.timingsMs.total).toBeGreaterThan(0);
    expect(JSON.stringify(first.study)).not.toMatch(/timings|Ms":\d+\.\d/);
  });
  it('adoption edits reproduce candidate parameters and models', () => {
    const { study } = run(input({ variables: [width(values(17000, 18000)), variable('s0', 0, 'southWingDepthMm', values(7000, 9000))] }));
    const r = normalizeParametricRequirements(parametricInput());
    for (const c of study.candidates) {
      expect(c.architectureMutation).toBe('NONE');
      const arch = structuredClone(r.parametricArchitecture);
      for (const e of c.adoption.parametricEdits) arch.floors[e.level]![e.parameter] = e.valueMm;
      expect(vectorOf(arch)).toEqual(c.parameters);
      expect(vectorOf(architectureFor(r.parametricArchitecture, c.parameters))).toEqual(c.parameters);
      if (c.status === 'VALID') expect(modelHash(generateParametricBlueprint({ ...r, parametricArchitecture: arch }).model)).toBe(c.modelHash);
    }
    expect(study.candidates.find(c => c.isBaseline)!.adoption.parametricEdits).toEqual([]);
  });
  it('claims are fixed: GRID → BEST_IN_EVALUATED_SEARCH_SPACE, never a global optimum', () => {
    const { study } = run(input());
    expect(study.claims).toEqual({ searchResult: 'BEST_IN_EVALUATED_SEARCH_SPACE', ...CLAIMS });
    expect(Object.values(CLAIMS).every(v => v === 'NOT_CLAIMED')).toBe(true);
    expect(study.engineering).toMatchObject({ structural: 'NOT_EVALUATED', knowledge: 'NOT_EVALUATED', phase27: 'PHASE27_INTEGRATION_DEFERRED' });
    expect(study.limits).toEqual(OPTIMIZATION_LIMITS);
  });
});

describe('Phase 28 deterministic local search', () => {
  const local = (maxEvaluations: number, extra: object = {}) => input({ strategy: { kind: 'DETERMINISTIC_LOCAL_SEARCH', maxEvaluations }, variables: [width(range(16000, 21000, 1000))],
    objectives: [objective('gfa', GFA, MAX, { weight: 1, normalization: { method: 'EXPLICIT_BOUNDS', best: '258000000', worst: '218000000' } })], ...extra });
  it('climbs from the baseline to a local optimum, deterministically', () => {
    const a = run(local(32)), b = run(local(32));
    expect(JSON.stringify(a.study)).toBe(JSON.stringify(b.study));
    expect(a.study).toMatchObject({ status: 'COMPLETED', claims: { searchResult: 'BEST_FOUND' } });
    expect(a.study.candidates.map(c => c.parameters[0])).toEqual([17000, 18000, 19000, 20000, 21000]);
    expect(a.study.recommendedCandidates).toEqual([at(a.study, 21000).candidateId]);
  });
  it('8-variable local search on a two-storey revision stays within its budget', () => {
    const base = vectorOf(normalizeParametricRequirements(parametricInput(true)).parametricArchitecture);
    const vars = base.map((v, i) => variable(`v${i}`, (i < 4 ? 0 : 1) as 0 | 1, PARAMS[i % 4]!, range(v! - 1000, v! + 1000, 500)));
    const { study } = run(input({ strategy: { kind: 'DETERMINISTIC_LOCAL_SEARCH', maxEvaluations: 24 }, variables: vars,
      objectives: [objective('gfa', GFA, MIN, { weight: 1, normalization: { method: 'EXPLICIT_BOUNDS', best: '300000000', worst: '500000000' } })] }), TWO);
    expect(study.search.evaluatedAssignments).toBeLessThanOrEqual(24);
    expect(study.search.candidateSpaceSize).toBe(String(5 ** 8));
    expect(['COMPLETED', 'BUDGET_EXHAUSTED']).toContain(study.status);
  });
  it('budget exhaustion is deterministic and claims only BEST_FOUND', () => {
    const { study } = run(local(2));
    expect(study).toMatchObject({ status: 'BUDGET_EXHAUSTED', claims: { searchResult: 'BEST_FOUND' } });
    expect(study.search.evaluatedAssignments).toBe(2);
  });
  it('requires WEIGHTED_SCORE, fixed normalization and a baseline inside every domain', () => {
    expectError(() => run(local(8, { mode: 'PARETO', objectives: [objective('gfa', GFA, MAX, {})] })), 'OPTIMIZATION_INPUT_INVALID', { field: 'strategy' });
    expectError(() => run(local(8, { objectives: [objective('gfa', GFA, MAX)] })), 'OPTIMIZATION_INPUT_INVALID', { field: 'strategy' });
    expectError(() => run(local(8, { variables: [width(values(17000, 19000))] })), 'OPTIMIZATION_INPUT_INVALID', { field: 'variables.domain' });
  });
});

describe('Phase 28 independent validator', () => {
  // Lazy: a study rejected by the in-run validator must fail these tests, not abort collection of the whole file.
  let weighted: StudyRun, pareto: StudyRun;
  beforeAll(() => {
    weighted = run(input({ objectives: [objective('gfa', GFA, MIN), objective('wall', WALL, MAX)] }));
    pareto = run(input({ mode: 'PARETO', objectives: [objective('gfa', GFA, MIN, {}), objective('wall', WALL, MIN, {})] }));
  });
  const verdict = (s: unknown, r = weighted) => validateOptimizationStudy(s, { source: ONE, evidence: r.evidence });
  it('accepts untampered studies', () => {
    expect(verdict(weighted.study)).toEqual({ status: 'VALID', issues: [] });
    expect(verdict(pareto.study, pareto)).toEqual({ status: 'VALID', issues: [] });
  });
  const cases: [string, (s: Study) => void, string][] = [
    ['metric', s => { s.candidates[1]!.metrics.GROSS_FLOOR_AREA!.value = { numerator: '1', denominator: '1' }; }, 'METRICS:'],
    ['score', s => { s.candidates[1]!.score = { numerator: '1', denominator: '1' }; }, 'SCORE:'],
    ['rank', s => { const [a, b] = [s.candidates[0]!, s.candidates[1]!]; [a.rank, b.rank] = [b.rank, a.rank]; }, 'RANK:'],
    ['candidateId', s => { s.candidates[2]!.candidateId = 'a'.repeat(64); }, 'CANDIDATE_ID:'],
    ['search claim', s => { s.claims.searchResult = 'BEST_FOUND'; }, 'CLAIMS'],
    ['NOT_CLAIMED literal', s => { (s.claims as Record<string, string>).globalOptimality = 'CLAIMED'; }, 'SCHEMA:'],
    ['skipped candidate', s => { s.candidates.splice(2, 1); s.candidates.forEach((c, i) => { c.ordinal = i; }); }, 'GRID_COVERAGE'],
    ['status', s => { s.candidates[4]!.status = 'REJECTED'; }, 'STATUS:'],
    ['adoption', s => { s.candidates[0]!.adoption.parametricEdits = []; }, 'ADOPTION:'],
    ['normalization', s => { s.normalization[0]!.best = { numerator: '1', denominator: '1' }; }, 'NORMALIZATION'],
    ['recommendation', s => { s.recommendedCandidates = [s.candidates[4]!.candidateId]; }, 'RECOMMENDED'],
    ['input', s => { s.input.objectives[0]!.weight = 7; }, 'INPUT_HASH'],
    ['architecture mutation', s => { (s.candidates[0] as { architectureMutation: string }).architectureMutation = 'ADOPTED'; }, 'SCHEMA:'],
  ];
  for (const [name, mutate, issue] of cases) it(`rejects tampered ${name}`, () => {
    const result = verdict(tamper(weighted.study, mutate));
    expect(result.status).toBe('INVALID');
    expect(result.issues.some(i => i.startsWith(issue)), result.issues.join(',')).toBe(true);
  });
  it('rejects tampered Pareto frontier and dominance', () => {
    expect(verdict(tamper(pareto.study, s => { s.paretoFrontier = []; s.recommendedCandidates = []; }), pareto).issues).toEqual(expect.arrayContaining(['FRONTIER', 'RECOMMENDED']));
    expect(verdict(tamper(pareto.study, s => { s.candidates[3]!.paretoStatus = 'NON_DOMINATED'; s.candidates[3]!.dominatedBy = []; }), pareto).issues.some(i => i.startsWith('PARETO:'))).toBe(true);
  });
  it('rejects a resultHash that does not match the body', () => {
    expect(verdict({ ...weighted.study, resultHash: 'b'.repeat(64) }).issues).toContain('RESULT_HASH');
  });
  it('rejects substituted evidence', () => {
    const evidence = new Map(weighted.evidence);
    evidence.set(weighted.study.candidates[1]!.candidateId, evidence.get(weighted.study.candidates[2]!.candidateId)!);
    expect(validateOptimizationStudy(weighted.study, { source: ONE, evidence }).issues.some(i => i.startsWith('MODEL:'))).toBe(true);
  });
  it('re-derives every pre-QA rejection: forged normalization, generation and schema codes are rejected (§26 option A)', () => {
    const gated = run(input({ variables: [width(values(9000, 9500, 18000, 21500))] }));
    expect(validateOptimizationStudy(gated.study, { source: ONE, evidence: gated.evidence })).toEqual({ status: 'VALID', issues: [] });
    for (const [w, code] of [[9000, 'SETBACK_VIOLATION'], [9500, 'IMPOSSIBLE_LAYOUT'], [21500, 'PARAMETERS_INVALID']] as const) {
      const forged = tamper(gated.study, t => { t.candidates.find(c => c.parameters[0] === w)!.rejection!.code = code; });
      expect(validateOptimizationStudy(forged, { source: ONE, evidence: gated.evidence }).issues.some(i => i.startsWith('GATE_REDERIVED:'))).toBe(true);
    }
    const schema = when(20000, m => { m.slabs = []; }), modelGate = run(input({ variables: [width(values(18000, 20000))] }), ONE, { generate: schema });
    expect(validateOptimizationStudy(modelGate.study, { source: ONE, evidence: modelGate.evidence, generate: schema }).status).toBe('VALID');
    const forgedModel = tamper(modelGate.study, t => { t.candidates.find(c => c.parameters[0] === 20000)!.rejection!.details = ['slabs: forged']; });
    expect(validateOptimizationStudy(forgedModel, { source: ONE, evidence: modelGate.evidence, generate: schema }).issues.some(i => i.startsWith('GATE_REDERIVED:'))).toBe(true);
  });
  it('stays independent of the optimizer modules (static gate)', () => {
    const dir = new URL('../src/optimization/', import.meta.url), validator = readFileSync(new URL('validate.ts', dir), 'utf8');
    for (const forbidden of ['domain', 'candidate', 'rank', 'study']) expect(validator).not.toMatch(new RegExp(`from '\\./${forbidden}\\.js'`));
    for (const file of readdirSync(dir)) expect(readFileSync(new URL(file, dir), 'utf8')).not.toMatch(/\beval\s*\(|new Function\s*\(/);
  });
});
