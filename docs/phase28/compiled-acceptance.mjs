import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { normalizeParametricRequirements } from '@designflow/generator';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { modelHash } from './apps/api/dist/lib/generation-identity.js';
import { projectQaOptions } from './apps/api/dist/services/project-service.js';
import { parametricQaOptions } from './apps/api/dist/services/parametric-qa.js';
import { generateWithEngine } from './apps/api/dist/optimization/candidate.js';
import { CLAIMS, OptimizationError } from './apps/api/dist/optimization/contracts.js';
import { runOptimizationStudy } from './apps/api/dist/optimization/study.js';
import { OptimizationPool } from './apps/api/dist/optimization/pool.js';

// Phase 28 compiled acceptance (container, --network none): compiled production modules only, including the compiled
// worker (dist/optimization/worker.js) — no tsx, test-support, network, database or AI. Expected values are hand-known.
const requirements = { site: { boundary: [{ x: 0, z: 0 }, { x: 22000, z: 0 }, { x: 22000, z: 22000 }, { x: 0, z: 22000 }], northMilliDegrees: 0 }, floors: 1,
  rooms: [{ type: 'bedroom', count: 2 }, { type: 'living', count: 1 }, { type: 'kitchen', count: 1 }], seed: 'phase22',
  parametricArchitecture: { version: 1, shape: 'L', origin: { x: 1000, z: 1000 }, floors: [{ level: 0, widthMm: 18000, depthMm: 18000, westWingWidthMm: 9000, southWingDepthMm: 8000 }] } };
const r = normalizeParametricRequirements(requirements), model = generateWithEngine(r, { timeoutMs: 10000 }).model;
const qa = auditBlueprint(model, { ...projectQaOptions(model), ...parametricQaOptions(r) });
const source = { projectId: 'compiled', revisionId: 'compiled', generatorVersion: 'parametric-architecture-v1', normalizedRequirements: r, model,
  identity: { modelHash: modelHash(model) }, qa: { status: qa.status, inputStatus: qa.inputStatus, errors: qa.summary.errors } };
const variable = (minimumMm, maximumMm) => ({ variableId: 'w0', target: { kind: 'PARAMETRIC_FLOOR_DIMENSION', level: 0, parameter: 'widthMm' }, unit: 'mm',
  domain: { kind: 'RANGE', minimumMm, maximumMm, stepMm: 1000 }, allowedMutation: 'SET_PARAMETRIC_DIMENSION' });
const input = { version: 'optimization-input-v1', mode: 'WEIGHTED_SCORE', strategy: { kind: 'GRID' }, variables: [variable(16000, 20000)],
  objectives: [{ objectiveId: 'gfa', metric: { kind: 'GROSS_FLOOR_AREA' }, goal: { kind: 'MINIMIZE' }, weight: 1, normalization: { method: 'CANDIDATE_RANGE' } }] };

const direct = runOptimizationStudy(source, input).study;
const pool = new OptimizationPool({ size: 1 });
try {
  const viaWorker = await pool.run(source, input);
  assert.equal(JSON.stringify(viaWorker.study), JSON.stringify(direct), 'compiled worker must reproduce the in-process study byte-for-byte');
  assert.deepEqual(direct.candidates.map(c => c.parameters[0]), [16000, 17000, 18000, 19000, 20000]);
  for (const c of direct.candidates) assert.deepEqual(c.metrics.GROSS_FLOOR_AREA.value, { numerator: String(c.parameters[0] * 8000 + 9000 * 10000), denominator: '1' });
  assert.deepEqual(direct.candidates.map(c => c.rank), [1, 2, 3, 4, 5]);
  assert.ok(direct.candidates.every(c => c.status === 'VALID' && c.architectureMutation === 'NONE'));
  assert.equal(direct.candidates.find(c => c.isBaseline).modelHash, modelHash(model));
  assert.deepEqual(direct.claims, { searchResult: 'BEST_IN_EVALUATED_SEARCH_SPACE', ...CLAIMS });
  await assert.rejects(pool.run(source, { ...input, variables: [variable(1000, 60000), { ...variable(1000, 60000), variableId: 'd0', target: { kind: 'PARAMETRIC_FLOOR_DIMENSION', level: 0, parameter: 'depthMm' } }] }),
    e => e instanceof OptimizationError && e.code === 'OPTIMIZATION_RESOURCE_LIMIT' && e.details.value === '3600');
  console.log(JSON.stringify({ compiledOptimization: 'PASS', candidates: direct.candidates.length, resultHash: direct.resultHash, worker: 'dist/optimization/worker.js',
    workerMs: Math.round(viaWorker.workerMs), claims: 'all 11 NOT_CLAIMED', runtime: process.version }));
} finally { await pool.close(); }
