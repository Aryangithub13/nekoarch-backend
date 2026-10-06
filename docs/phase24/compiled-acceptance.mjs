import assert from 'node:assert/strict';
import console from 'node:console';
import { performance } from 'node:perf_hooks';
import { generateParametricBlueprint } from '@designflow/generator';
import { modelHash } from './apps/api/dist/lib/generation-identity.js';
import { digest } from './apps/api/dist/bim/core.js';
import { projectBim } from './apps/api/dist/bim/project.js';
import { StructuralInputSchema, AnalysisModelSchema } from './apps/api/dist/structural/contracts.js';
import { buildStructuralModel } from './apps/api/dist/structural/model.js';
import { runStructuralAnalysis, structuralInputHash, validateRawOutput } from './apps/api/dist/structural/analysis.js';
import { REFERENCE_FRAME_SOLVER } from './apps/api/dist/structural/frame-solver.js';
import { validateStructuralModel, validateStructuralResults } from './apps/api/dist/structural/validate.js';

// Compiled production modules only: no test-support, network or database.
const input = { site: { boundary: [{ x: 0, z: 0 }, { x: 22000, z: 0 }, { x: 22000, z: 22000 }, { x: 0, z: 22000 }], northMilliDegrees: 0 }, floors: 2,
  rooms: [{ type: 'bedroom', count: 2, level: 1 }, { type: 'living', count: 1, level: 0 }, { type: 'kitchen', count: 1, level: 0 }], seed: 'phase24-production',
  parametricArchitecture: { version: 1, shape: 'L', origin: { x: 1000, z: 1000 }, floors: [{ level: 0, widthMm: 18000, depthMm: 18000, westWingWidthMm: 9000, southWingDepthMm: 8000 },
    { level: 1, widthMm: 16000, depthMm: 16000, westWingWidthMm: 8500, southWingDepthMm: 7000 }] } };
const { model } = generateParametricBlueprint(input);
const binding = { projectId: '11111111-1111-4111-8111-111111111111', revisionId: '22222222-2222-4222-8222-222222222222', modelHash: modelHash(model),
  parameterHash: digest(model.parametricArchitecture), generatorVersion: model.provenance.generatorVersion, generationId: null, requirementsHash: null };
const bim = projectBim(model, binding);
const columns = new Map();
for (const wall of [...model.walls].sort((a, b) => a.id < b.id ? -1 : 1)) for (const end of ['start', 'end']) {
  const p = wall.path[end], key = `c-${wall.levelId}-${p.x}-${p.z}`;
  if (!columns.has(key)) columns.set(key, { key, rule: 'COLUMN_AT_WALL_END', wallId: wall.id, end, material: 'm', section: 'col' });
}
const beams = model.walls.map(w => ({ key: `b-${w.id}`, rule: 'BEAM_ALONG_WALL', wallId: w.id, material: 'm', section: 'beam' }));
const request = StructuralInputSchema.parse({ version: 'structural-input-v1',
  materials: [{ key: 'm', category: 'CONCRETE', name: 'Acceptance test values', elasticModulus: { value: 30000, unit: 'MPa' }, poissonRatio: { value: 0.2, unit: '1' }, density: { value: 2400, unit: 'kg/m3' } }],
  sections: [{ key: 'col', shape: 'RECTANGLE', width: { value: 300, unit: 'mm' }, depth: { value: 300, unit: 'mm' } }, { key: 'beam', shape: 'RECTANGLE', width: { value: 230, unit: 'mm' }, depth: { value: 450, unit: 'mm' } }],
  members: [...columns.values(), ...beams], autoSupports: { rule: 'BASE_OF_COLUMNS_AT_LOWEST_ELEVATION', type: 'FIXED' },
  loadCases: [{ key: 'DEAD', category: 'DEAD', selfWeight: true, loads: beams.map(b => ({ key: `d-${b.key}`, application: 'MEMBER_DISTRIBUTED', target: { member: b.key }, direction: 'GLOBAL_Y', magnitude: { value: -10, unit: 'kN/m' } })) }],
  combinations: [{ key: 'c', profile: 'PROJECT_DEFINED', terms: [{ loadCase: 'DEAD', factor: 1.2 }] }] });
const structural = buildStructuralModel(bim, request);
assert.equal(validateStructuralModel(structural, bim.geometry, request, structural.binding).status, 'VALID');
const run = runStructuralAnalysis(structural);
const results = validateStructuralResults({ binding: structural.binding, input: request, inputHash: structuralInputHash(structural.binding, request), model: structural, results: run.results, solver: run.solver }, { binding: structural.binding });
assert.equal(results.status, 'VALID');
// Independent closed form: cantilever tip deflection PL³/3EI.
const L = 3000, P = -20000, E = 200000, I = 8e7;
const am = AnalysisModelSchema.parse({ version: 'structural-analysis-model-v1', analysisType: 'LINEAR_STATIC', formulation: 'EULER_BERNOULLI_3D_FRAME', joints: 'RIGID',
  units: { length: 'mm', force: 'N', moment: 'N*mm', stress: 'MPa', rotation: 'rad', lineLoad: 'N/mm' }, localAxes: 'REFERENCE_VECTOR_V1',
  nodes: [{ id: 'F', x: 0, y: 0, z: 0 }, { id: 'T', x: L, y: 0, z: 0 }], members: [{ id: 'c', nodeI: 'F', nodeJ: 'T', E, G: E / 2.6, A: 5000, Iy: 2e7, Iz: I, J: 1e6 }],
  restraints: [{ nodeId: 'F', dofs: [true, true, true, true, true, true] }], loadCases: [{ id: 'p', nodalLoads: [{ nodeId: 'T', force: [0, P, 0] }], memberLoads: [] }] });
const raw = validateRawOutput(REFERENCE_FRAME_SOLVER.analyze(am, { deadline: performance.now() + 10000 }), am, REFERENCE_FRAME_SOLVER);
const tip = raw.cases[0].displacements[1][1], expected = P * L ** 3 / (3 * E * I);
assert.ok(Math.abs(tip - expected) / Math.abs(expected) < 1e-9);
console.log(JSON.stringify({ compiledStructural: 'PASS', nodes: structural.nodes.length, members: structural.members.length, segments: structural.segments.length,
  resultSets: run.results.sets.length, claims: structural.claims, cantileverTipMm: tip, expectedMm: expected }));
