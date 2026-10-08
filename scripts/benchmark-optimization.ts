import { mkdir, writeFile } from 'node:fs/promises';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { normalizeParametricRequirements, type ParametricRequirements } from '@designflow/generator';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { sampleCostingPolicy } from '@designflow/boq-cost';
import type { BuildingModelV2 } from '@designflow/shared';
import { parametricInput } from '../test-support/parametric-fixtures.js';
import { specification } from '../packages/construction-calculations/tests/fixtures.js';
import { modelHash } from '../apps/api/src/lib/generation-identity.js';
import { projectQaOptions } from '../apps/api/src/services/project-service.js';
import { parametricQaOptions } from '../apps/api/src/services/parametric-qa.js';
import { OPTIMIZATION_LIMITS, OptimizationError, type OptimizationSource } from '../apps/api/src/optimization/contracts.js';
import { generateWithEngine, type Generate } from '../apps/api/src/optimization/candidate.js';
import { vectorOf } from '../apps/api/src/optimization/domain.js';
import { resolveSource, runOptimizationStudy, validateOptimizationInput } from '../apps/api/src/optimization/study.js';
import { OptimizationPool, OptimizationPoolError, POOL_DEFAULTS } from '../apps/api/src/optimization/pool.js';

/** Phase 28 parallel-core benchmark. Studies are synchronous: total ms == main-thread blocking time. */
function source(requirements: ParametricRequirements): OptimizationSource {
  const r = normalizeParametricRequirements(requirements), model = generateWithEngine(r, { timeoutMs: 10000 }).model as BuildingModelV2;
  const qa = auditBlueprint(model, { ...projectQaOptions(model), ...parametricQaOptions(r) });
  return { projectId: 'bench', revisionId: 'bench', generatorVersion: 'parametric-architecture-v1', normalizedRequirements: r, model,
    identity: { modelHash: modelHash(model) }, qa: { status: qa.status, inputStatus: qa.inputStatus, errors: qa.summary.errors } };
}
type P = 'widthMm' | 'depthMm' | 'westWingWidthMm' | 'southWingDepthMm';
const PARAMS: P[] = ['widthMm', 'depthMm', 'westWingWidthMm', 'southWingDepthMm'];
const variable = (variableId: string, level: 0 | 1, parameter: P, minimumMm: number, maximumMm: number, stepMm: number) =>
  ({ variableId, target: { kind: 'PARAMETRIC_FLOOR_DIMENSION', level, parameter }, unit: 'mm', domain: { kind: 'RANGE', minimumMm, maximumMm, stepMm }, allowedMutation: 'SET_PARAMETRIC_DIMENSION' });
const range = { weight: 1, normalization: { method: 'CANDIDATE_RANGE' } };
const gfaMin = { objectiveId: 'gfa', metric: { kind: 'GROSS_FLOOR_AREA' }, goal: { kind: 'MINIMIZE' }, ...range };
const living = { objectiveId: 'living', metric: { kind: 'CLASSIFICATION_FLOOR_AREA', classification: 'living' }, goal: { kind: 'MAXIMIZE' } };
const study = (o: Record<string, unknown>) => ({ version: 'optimization-input-v1', mode: 'WEIGHTED_SCORE', strategy: { kind: 'GRID' }, objectives: [gfaMin], ...o });
const grid128 = [variable('w0', 0, 'widthMm', 13500, 21000, 500), variable('s0', 0, 'southWingDepthMm', 6000, 13000, 1000)]; // 16 × 8 = 128

const one = source(parametricInput()), two = source(parametricInput(true));
const maximumReq = parametricInput();
maximumReq.site.boundary = [{ x: 0, z: 0 }, { x: 60000, z: 0 }, { x: 60000, z: 60000 }, { x: 0, z: 60000 }];
Object.assign(maximumReq.parametricArchitecture.floors[0]!, { widthMm: 55000, depthMm: 55000, westWingWidthMm: 27000, southWingDepthMm: 27000 });
maximumReq.rooms = [{ type: 'bedroom', count: 24 }];
const setbackReq = parametricInput(); setbackReq.site.setbacks = [{ boundaryEdgeStart: 1, minimumMm: 2000 }];
const collapse: Generate = (r, e) => generateWithEngine({ ...r, parametricArchitecture: { ...r.parametricArchitecture, floors: r.parametricArchitecture.floors.map(f => ({ ...f, widthMm: 18000 })) } }, e);
const twoBase = vectorOf(normalizeParametricRequirements(parametricInput(true)).parametricArchitecture);

const cases: { name: string; source: OptimizationSource; input: unknown; generate?: Generate }[] = [
  { name: '1-variable', source: one, input: study({ variables: [variable('w0', 0, 'widthMm', 16000, 20000, 1000)] }) },
  { name: '2-variables', source: one, input: study({ variables: [variable('w0', 0, 'widthMm', 16000, 20000, 1000), variable('s0', 0, 'southWingDepthMm', 6500, 8000, 500)] }) },
  { name: '4-variables', source: one, input: study({ variables: [variable('w0', 0, 'widthMm', 17000, 19000, 1000), variable('d0', 0, 'depthMm', 17000, 19000, 1000),
    variable('ww0', 0, 'westWingWidthMm', 8500, 9500, 500), variable('s0', 0, 'southWingDepthMm', 7500, 8500, 500)] }) },
  { name: '8-variable-local-search', source: two, input: study({ strategy: { kind: 'DETERMINISTIC_LOCAL_SEARCH', maxEvaluations: OPTIMIZATION_LIMITS.maxEvaluatedCandidates },
    variables: twoBase.map((v, i) => variable(`v${i}`, (i < 4 ? 0 : 1) as 0 | 1, PARAMS[i % 4]!, v! - 2000, v! + 2000, 500)),
    objectives: [{ ...gfaMin, normalization: { method: 'EXPLICIT_BOUNDS', best: '300000000', worst: '500000000' } }] }) },
  { name: 'maximum-24-rooms', source: source(maximumReq), input: study({ variables: [variable('w0', 0, 'widthMm', 53000, 57000, 1000), variable('d0', 0, 'depthMm', 54000, 56000, 1000)] }) },
  { name: 'L-two-storey', source: two, input: study({ variables: [variable('w1', 1, 'widthMm', 13000, 17000, 500), variable('s1', 1, 'southWingDepthMm', 6000, 8000, 500)] }) },
  { name: 'setback-site', source: source(setbackReq), input: study({ variables: [variable('w0', 0, 'widthMm', 14000, 21000, 500)] }) },
  { name: 'heavy-deduplication', source: one, generate: collapse, input: study({ variables: [variable('w0', 0, 'widthMm', 10000, 21000, 500)] }) },
  { name: 'pareto-128', source: one, input: study({ mode: 'PARETO', variables: grid128, objectives: [{ ...gfaMin, weight: undefined, normalization: undefined }, living] }) },
  { name: 'weighted-128', source: one, input: study({ variables: grid128, objectives: [gfaMin, { ...living, weight: 2, normalization: { method: 'CANDIDATE_RANGE' } },
    { objectiveId: 'walls', metric: { kind: 'WALL_CENTERLINE_LENGTH' }, goal: { kind: 'MINIMIZE' }, ...range }] }) },
  { name: 'costed-128', source: one, input: study({ variables: grid128, cost: { rateBookId: 'sample-inr-v1', specification: specification(), policy: sampleCostingPolicy() },
    objectives: [{ objectiveId: 'cost', metric: { kind: 'PRICED_SCOPE_TOTAL' }, goal: { kind: 'MINIMIZE' }, ...range }, gfaMin] }) },
  { name: 'candidate-space-refusal', source: one, input: study({ variables: [variable('w0', 0, 'widthMm', 1000, 60000, 1000), variable('d0', 0, 'depthMm', 1000, 60000, 1000)] }) },
];

const round = (n: number) => Math.round(n * 100) / 100;
runOptimizationStudy(one, cases[0]!.input); // warm-up (JIT, module init); not recorded
const results: Record<string, unknown>[] = [];
for (const c of cases) {
  const heap = process.memoryUsage().heapUsed, started = performance.now();
  let row: Record<string, unknown>;
  try {
    const { study: s, diagnostics: d } = runOptimizationStudy(c.source, JSON.parse(JSON.stringify(c.input)), c.generate ? { generate: c.generate } : {});
    const totalMs = performance.now() - started;
    row = { name: c.name, outcome: s.status, ...s.search, recommended: s.recommendedCandidates.length, frontier: s.paretoFrontier.length,
      timingsMs: Object.fromEntries(Object.entries(d.timingsMs).map(([k, v]) => [k, round(v)])), totalMs: round(totalMs),
      msPerEvaluatedAssignment: round(totalMs / s.search.evaluatedAssignments), snapshotBytes: d.snapshotBytes, heapDeltaBytes: process.memoryUsage().heapUsed - heap };
  } catch (error) {
    if (!(error instanceof OptimizationError)) throw error;
    row = { name: c.name, outcome: error.code, details: error.details, totalMs: round(performance.now() - started) };
  }
  results.push(row);
  console.log(`${c.name.padEnd(24)} ${String(row.outcome).padEnd(28)} ${String(row.totalMs).padStart(9)} ms` +
    ('evaluatedAssignments' in row ? `  eval ${row.evaluatedAssignments}  valid ${row.valid}  rej ${row.rejected}  dedup ${row.deduplicated}  ${row.msPerEvaluatedAssignment} ms/assignment  ${row.snapshotBytes} B` : ''));
}
// ---- Worker pool (production execution model, §30): the main thread only prechecks and awaits; studies run in workers. ----
const maximumSource = cases.find(c => c.name === 'maximum-24-rooms')!.source;
const max128 = study({ variables: [variable('w0', 0, 'widthMm', 51500, 59000, 500), variable('d0', 0, 'depthMm', 52000, 59000, 1000)] });
const byName = (name: string) => cases.find(c => c.name === name)!;
async function observed<T>(fn: () => Promise<T>) {
  const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
  const heap = process.memoryUsage(), started = performance.now();
  try { return { value: await fn(), totalMs: round(performance.now() - started), loopMaxMs: round(loop.max / 1e6), loopP99Ms: round(loop.percentile(99) / 1e6),
    rssDeltaMb: round((process.memoryUsage().rss - heap.rss) / 1048576), heapDeltaMb: round((process.memoryUsage().heapUsed - heap.heapUsed) / 1048576) }; }
  finally { loop.disable(); }
}
const pool: Record<string, unknown> = { defaults: POOL_DEFAULTS, cpus: (await import('node:os')).availableParallelism() };
const precheck = (source: typeof one, input: unknown) => { const t = performance.now(); validateOptimizationInput(JSON.parse(JSON.stringify(input)), source, resolveSource(source)); return round(performance.now() - t); };
pool.mainThreadPrecheckMs = { typical: precheck(one, byName('weighted-128').input), maximum24Rooms: precheck(maximumSource, max128) };
const runner = new OptimizationPool({ size: 2, queueLimit: 4 });
try {
  await runner.run(one, byName('1-variable').input); // spawn + warm one worker
  const single = async (name: string, source: typeof one, input: unknown) => {
    const o = await observed(() => runner.run(source, JSON.parse(JSON.stringify(input))));
    return { name, status: o.value.study.status, candidates: o.value.study.search.evaluatedAssignments, latencyMs: o.totalMs, queueMs: round(o.value.queueMs), workerMs: round(o.value.workerMs),
      loopMaxMs: o.loopMaxMs, loopP99Ms: o.loopP99Ms, snapshotBytes: Buffer.byteLength(JSON.stringify(o.value.study)), mainRssDeltaMb: o.rssDeltaMb };
  };
  pool.single = [await single('weighted-128', one, byName('weighted-128').input), await single('pareto-128', one, byName('pareto-128').input),
    await single('8-variable-local-search', two, byName('8-variable-local-search').input), await single('costed-128', one, byName('costed-128').input),
    await single('maximum-24-rooms-128', maximumSource, max128)];
  const refusal = await observed(() => runner.run(one, byName('candidate-space-refusal').input).catch((e: Error & { code?: string }) => e.code));
  pool.refusal = { code: refusal.value, latencyMs: refusal.totalMs };
  const concurrent = await observed(() => Promise.all([0, 1].map(() => runner.run(one, byName('weighted-128').input))));
  pool.concurrentAtCapacity = { studies: 2, wallMs: concurrent.totalMs, throughputStudiesPerMin: round(120000 / concurrent.totalMs), loopMaxMs: concurrent.loopMaxMs,
    queueMs: concurrent.value.map(r => round(r.queueMs)), workerMs: concurrent.value.map(r => round(r.workerMs)), mainRssDeltaMb: concurrent.rssDeltaMb };
  const saturation = await observed(async () => {
    const submitted = Array.from({ length: 8 }, () => { const t = performance.now();
      return runner.run(one, byName('2-variables').input).then(r => ({ ok: true, ms: performance.now() - t, queueMs: r.queueMs }), (e: OptimizationPoolError) => ({ ok: false, code: e.code, ms: performance.now() - t })); });
    return Promise.all(submitted);
  });
  pool.queueSaturation = { submitted: 8, accepted: saturation.value.filter(r => r.ok).length, refused: saturation.value.filter(r => !r.ok).map(r => (r as { code: string }).code),
    refusalLatencyMs: saturation.value.filter(r => !r.ok).map(r => round(r.ms)), maxQueueWaitMs: round(Math.max(...saturation.value.filter(r => r.ok).map(r => (r as { queueMs: number }).queueMs))),
    wallMs: saturation.totalMs, loopMaxMs: saturation.loopMaxMs };
} finally { await runner.close(); }
console.log(JSON.stringify(pool, null, 2));
await mkdir('docs/phase28/evidence', { recursive: true });
await writeFile('docs/phase28/evidence/benchmark.json', `${JSON.stringify({ generatedBy: 'scripts/benchmark-optimization.ts', node: process.version, limits: OPTIMIZATION_LIMITS, results, pool }, null, 2)}\n`);
