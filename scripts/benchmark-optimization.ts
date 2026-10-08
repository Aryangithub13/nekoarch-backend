import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
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
import { runOptimizationStudy } from '../apps/api/src/optimization/study.js';

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
await mkdir('docs/phase28/evidence', { recursive: true });
await writeFile('docs/phase28/evidence/benchmark.json', `${JSON.stringify({ generatedBy: 'scripts/benchmark-optimization.ts', node: process.version, limits: OPTIMIZATION_LIMITS, results }, null, 2)}\n`);
