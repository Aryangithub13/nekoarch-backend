import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { generateParametricBlueprint } from '@designflow/generator';
import { costHash } from '@designflow/boq-cost';
import { modelHash } from './apps/api/dist/lib/generation-identity.js';
import { compileScene } from './apps/api/dist/scene3d/compile.js';
import { validateScene } from './apps/api/dist/scene3d/validate.js';
import { ScenePool } from './apps/api/dist/scene3d/pool.js';

// Phase 29 compiled acceptance (container, --network none): compiled production modules only, including the compiled scene worker
// (dist/scene3d/worker.js) — no tsx, test-support, network, database or GPU. Expected values are hand-known from the L requirements.
const requirements = { site: { boundary: [{ x: 0, z: 0 }, { x: 22000, z: 0 }, { x: 22000, z: 22000 }, { x: 0, z: 22000 }], northMilliDegrees: 0 }, floors: 1,
  rooms: [{ type: 'bedroom', count: 2 }, { type: 'living', count: 1 }, { type: 'kitchen', count: 1 }], seed: 'phase22',
  parametricArchitecture: { version: 1, shape: 'L', origin: { x: 1000, z: 1000 }, floors: [{ level: 0, widthMm: 18000, depthMm: 18000, westWingWidthMm: 9000, southWingDepthMm: 8000 }] } };
const model = generateParametricBlueprint(requirements).model;
const binding = { projectId: '11111111-1111-4111-8111-111111111111', revisionId: '22222222-2222-4222-8222-222222222222', modelHash: modelHash(model),
  generatorVersion: model.provenance.generatorVersion ?? null, parameterHash: costHash(model.parametricArchitecture) };
const direct = compileScene(model, binding, {});
const pool = new ScenePool({ size: 1 });
try {
  const viaWorker = await pool.run({ model, binding }, {});
  assert.equal(Buffer.compare(viaWorker.glb, direct.glb), 0, 'compiled worker must reproduce the in-process GLB byte-for-byte');
  assert.equal(JSON.stringify(viaWorker.manifest), JSON.stringify(direct.manifest));
  assert.equal(viaWorker.validation.status, 'VALID');
  assert.equal(validateScene(model, binding, direct.manifest, direct.glb).status, 'VALID');
  assert.equal(direct.glb.readUInt32LE(0), 0x46546c67, 'GLB magic');
  assert.equal(createHash('sha256').update(direct.glb).digest('hex'), direct.manifest.binary.sha256);
  // Hand-known L geometry: floor plate spans the 18 m x 18 m bounding box at y ∈ [-150, 0]; walls rise 2850 mm from level 0.
  const floor = direct.manifest.objects.find(o => o.layer === 'FLOORS');
  assert.deepEqual(floor.bounds, { min: { x: 1000, y: -150, z: 1000 }, max: { x: 19000, y: 0, z: 19000 } });
  assert.ok(direct.manifest.objects.filter(o => o.geometryRole === 'wall').every(o => o.bounds.min.y === 0 && o.bounds.max.y === 2850));
  assert.equal(direct.manifest.levels.length, 1);
  assert.ok(Object.values(direct.manifest.claims).every(v => v === 'NOT_CLAIMED'));
  console.log(JSON.stringify({ compiledScene: 'PASS', objects: direct.manifest.statistics.objects, triangles: direct.manifest.statistics.triangles, glbSha256: direct.manifest.binary.sha256,
    worker: 'dist/scene3d/worker.js', workerMs: Math.round(viaWorker.workerMs), validation: viaWorker.validation.status, runtime: process.version }));
} finally { await pool.close(); }
