import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { generateBlueprint, generateBlueprintV2, generateParametricBlueprint, modifyParametricRequirements } from '@designflow/generator';
import { parametricInput } from '../test-support/parametric-fixtures.js';
import { solverInput } from '../test-support/solver-v2-fixtures.js';
import { frameInput } from '../test-support/structural-fixtures.js';
import { authored } from '../packages/blueprint-qa/tests/fixtures.js';
import { modelHash } from '../apps/api/src/lib/generation-identity.js';
import { digest } from '../apps/api/src/bim/core.js';
import { projectBim } from '../apps/api/src/bim/project.js';
import { AnalysisModelSchema, StructuralInputSchema } from '../apps/api/src/structural/contracts.js';
import { buildStructuralModel } from '../apps/api/src/structural/model.js';
import { runStructuralAnalysis, structuralInputHash } from '../apps/api/src/structural/analysis.js';
import { REFERENCE_FRAME_SOLVER } from '../apps/api/src/structural/frame-solver.js';
import { validateStructuralModel, validateStructuralResults } from '../apps/api/src/structural/validate.js';

const maximum = parametricInput(); maximum.site.boundary = [{ x: 0, z: 0 }, { x: 60000, z: 0 }, { x: 60000, z: 60000 }, { x: 0, z: 60000 }];
Object.assign(maximum.parametricArchitecture.floors[0]!, { widthMm: 55000, depthMm: 55000, westWingWidthMm: 27000, southWingDepthMm: 27000 }); maximum.rooms = [{ type: 'bedroom', count: 24 }];
const { layoutV2: _layout, ...v1 } = solverInput();
const fixtures = [['v1', () => generateBlueprint(v1).model], ['v2', () => generateBlueprintV2(solverInput()).model], ['L', () => generateParametricBlueprint(parametricInput()).model],
  ['setback', () => generateParametricBlueprint(parametricInput(true)).model], ['maximum-24', () => generateParametricBlueprint(maximum).model],
  ['west-wing-edit', () => generateParametricBlueprint(modifyParametricRequirements(parametricInput(true), { level: 0, parameter: 'westWingWidthMm', valueMm: 10000 })).model],
  ['authored', () => authored()]] as const;
const rows: Record<string, unknown>[] = [];
for (const [name, make] of fixtures) {
  const m = make(), binding = { projectId: '11111111-1111-4111-8111-111111111111', revisionId: '22222222-2222-4222-8222-222222222222', modelHash: modelHash(m),
    generatorVersion: m.provenance.generatorVersion ?? null, generationId: null, requirementsHash: null, parameterHash: m.parametricArchitecture ? digest(m.parametricArchitecture) : null };
  const bim = projectBim(m, binding), input = StructuralInputSchema.parse(frameInput(m));
  let t = performance.now();
  const model = buildStructuralModel(bim, input); const projectionMs = performance.now() - t; t = performance.now();
  const modelValidation = validateStructuralModel(model, bim.geometry, input, model.binding); const validationMs = performance.now() - t;
  const run = runStructuralAnalysis(model);
  const snapshot = { binding: model.binding, input, inputHash: structuralInputHash(model.binding, input), model, results: run.results, solver: run.solver };
  t = performance.now(); const resultValidation = validateStructuralResults(snapshot, { binding: model.binding }); const resultValidationMs = performance.now() - t;
  t = performance.now(); const bytes = Buffer.byteLength(JSON.stringify({ ...snapshot, validation: { model: modelValidation, results: resultValidation } })); const serializationMs = performance.now() - t;
  if (modelValidation.status !== 'VALID' || resultValidation.status !== 'VALID') throw new Error(`${name} failed validation`);
  rows.push({ name, sample: 1, nodes: model.nodes.length, members: model.members.length, segments: model.segments.length, supports: model.supports.length,
    loads: model.loadCases.reduce((n, c) => n + c.loads.length, 0), loadCases: model.loadCases.length, combinations: model.combinations.length,
    projectionMs, validationMs, ...run.timings, resultValidationMs, serializationMs, resultBytes: bytes,
    maxForceResidualKn: Math.max(...resultValidation.equilibrium.map(e => e.forceResidual.value)), rssBytes: process.memoryUsage().rss });
}
// Synthetic 3D grid near the analysis limits (solver-neutral model; no architectural source).
const id = (s: string) => `str-${createHash('sha256').update(s).digest('hex').slice(0, 40)}`, n = 10, storeys = 4, span = 6000, h = 3000;
const nodes: { id: string; x: number; y: number; z: number }[] = [], members: Record<string, string | number>[] = [], loads: { memberId: string; w: [number, number, number] }[] = [];
for (let k = 0; k <= storeys; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) nodes.push({ id: id(`n${i},${j},${k}`), x: i * span, y: k * h, z: j * span });
const section = { E: 30000, G: 12500, A: 90000, Iy: 6.75e8, Iz: 6.75e8, J: 1.14e9 };
for (let k = 1; k <= storeys; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
  members.push({ id: id(`c${i},${j},${k}`), nodeI: id(`n${i},${j},${k - 1}`), nodeJ: id(`n${i},${j},${k}`), ...section });
  if (i + 1 < n) { members.push({ id: id(`bx${i},${j},${k}`), nodeI: id(`n${i},${j},${k}`), nodeJ: id(`n${i + 1},${j},${k}`), ...section }); loads.push({ memberId: id(`bx${i},${j},${k}`), w: [0, -20, 0] as [number, number, number] }); }
  if (j + 1 < n) { members.push({ id: id(`bz${i},${j},${k}`), nodeI: id(`n${i},${j},${k}`), nodeJ: id(`n${i},${j + 1},${k}`), ...section }); loads.push({ memberId: id(`bz${i},${j},${k}`), w: [0, -20, 0] as [number, number, number] }); }
}
const grid = AnalysisModelSchema.parse({ version: 'structural-analysis-model-v1', analysisType: 'LINEAR_STATIC', formulation: 'EULER_BERNOULLI_3D_FRAME', joints: 'RIGID',
  units: { length: 'mm', force: 'N', moment: 'N*mm', stress: 'MPa', rotation: 'rad', lineLoad: 'N/mm' }, localAxes: 'REFERENCE_VECTOR_V1', nodes, members,
  restraints: nodes.filter(x => x.y === 0).map(x => ({ nodeId: x.id, dofs: [true, true, true, true, true, true] })),
  loadCases: Array.from({ length: 8 }, (_, c) => ({ id: id(`case${c}`), nodalLoads: [], memberLoads: loads.map(l => ({ ...l, w: [c % 2 ? 1 : 0, l.w[1], 0] as [number, number, number] })) })) });
const started = performance.now(); REFERENCE_FRAME_SOLVER.analyze(grid, { deadline: performance.now() + 60_000 });
rows.push({ name: 'synthetic-grid-10x10x4', sample: 1, nodes: nodes.length, segments: members.length, loadCases: 8, solverOnlyMs: performance.now() - started, rssBytes: process.memoryUsage().rss });
await mkdir('docs/phase24/evidence', { recursive: true });
await writeFile('docs/phase24/evidence/benchmark.json', JSON.stringify({ runtime: process.version, platform: process.platform, note: 'Single-process, single-sample observations; not production SLOs.',
  processPeakRssBytes: process.resourceUsage().maxRSS * 1024, measurements: rows }, null, 2) + '\n');
console.log(rows);
