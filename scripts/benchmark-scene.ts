import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import validator from 'gltf-validator';
import { bindingFor, sceneModels, translated } from '../test-support/scene-fixtures.js';
import { compileScene } from '../apps/api/src/scene3d/compile.js';
import { validateScene } from '../apps/api/src/scene3d/validate.js';
import { SCENE_LIMITS } from '../apps/api/src/scene3d/contracts.js';
import { SCENE_POOL_DEFAULTS, ScenePool } from '../apps/api/src/scene3d/pool.js';

// Phase 29 benchmark: one process, observations not SLOs. Writes docs/phase29/evidence/benchmark.json.
const models = sceneModels(), fixtures = { ...models, 'far-from-origin-setback': translated(models.setback, 400_000, -250_000) };
const round = (n: number) => Math.round(n * 100) / 100, mb = (n: number) => round(n / 1048576);
const rows = [];
for (const [name, model] of Object.entries(fixtures)) {
  const binding = bindingFor(model);
  compileScene(model, binding); // warm
  const heap0 = process.memoryUsage().heapUsed, start = performance.now(), result = compileScene(model, binding), compileMs = performance.now() - start;
  const heapDelta = process.memoryUsage().heapUsed - heap0, vStart = performance.now(), validation = validateScene(model, binding, result.manifest, result.glb), validateMs = performance.now() - vStart;
  const kStart = performance.now(), khronos = await validator.validateBytes(new Uint8Array(result.glb), { maxIssues: 10 }), khronosMs = performance.now() - kStart;
  const repeats = Array.from({ length: 5 }, () => { const t = performance.now(), r = compileScene(model, binding); return { ms: performance.now() - t, same: Buffer.compare(r.glb, result.glb) === 0 }; });
  const tStart = performance.now(), b64 = result.glb.toString('base64'), back = Buffer.from(b64, 'base64'), sha = createHash('sha256').update(back).digest('hex'), transferMs = performance.now() - tStart;
  // Instancing potential: object meshes identical up to translation (would share one mesh).
  const json = JSON.parse(result.glb.subarray(20, 20 + result.glb.readUInt32LE(12)).toString()) as { meshes: { primitives: { attributes: { POSITION: number } }[] }[]; accessors: { count: number; min: number[] }[] };
  const binAt = 20 + result.glb.readUInt32LE(12) + 8, views = (json as unknown as { bufferViews: { byteOffset: number; byteLength: number }[] }).bufferViews;
  const shapes = new Set(json.meshes.map(m => m.primitives.map(p => {
    const a = json.accessors[p.attributes.POSITION]!, v = views[(a as unknown as { bufferView: number }).bufferView]!, f = new Float32Array(result.glb.buffer.slice(result.glb.byteOffset + binAt + v.byteOffset, result.glb.byteOffset + binAt + v.byteOffset + v.byteLength));
    return Array.from(f, (x, i) => Math.round((x - a.min[i % 3]!) * 2000)).join(',');
  }).join('|')));
  await mkdir('docs/phase29/evidence/fixtures', { recursive: true });
  await writeFile(`docs/phase29/evidence/fixtures/${name}.glb`, result.glb);
  await writeFile(`docs/phase29/evidence/fixtures/${name}.manifest.json`, JSON.stringify(result.manifest, null, 1) + '\n');
  const s = result.manifest.statistics, entities = model.levels.length + model.spaces.length + model.walls.length + model.openings.length + model.slabs.length + model.stairs.length;
  rows.push({ name, sourceEntities: entities, objects: s.objects, nodes: s.nodes, drawCalls: s.primitives, triangles: s.triangles, vertices: s.vertices, materials: s.materials,
    rawMeshBytes: s.vertices * 24 + s.triangles * 6, glbBytes: result.glb.length, manifestBytes: Buffer.byteLength(JSON.stringify(result.manifest)),
    compileMs: round(compileMs), stagesMs: Object.fromEntries(Object.entries(result.timingsMs).map(([k, v]) => [k, round(v)])), validateMs: round(validateMs), validatorChecks: validation.checks,
    validation: validation.status, khronos: { errors: khronos.issues.numErrors, warnings: khronos.issues.numWarnings, ms: round(khronosMs) },
    repeatedCompileMs: repeats.map(r => round(r.ms)), repeatedByteIdentical: repeats.every(r => r.same), heapDeltaMb: mb(heapDelta), rssMb: mb(process.memoryUsage().rss),
    base64RoundTripAndShaMs: round(transferMs), shaMatches: sha === result.manifest.binary.sha256,
    uniqueMeshShapes: shapes.size, instancingWouldShareMeshes: s.meshes - shapes.size, maxFloat32ErrorNm: result.manifest.precision.maxFloat32ErrorNm });
}

// Worker path: latency, queue wait, event-loop responsiveness, concurrency and saturation.
const pool = new ScenePool(), loop = monitorEventLoopDelay({ resolution: 10 });
const source = (name: keyof typeof models) => ({ model: models[name], binding: bindingFor(models[name]) });
const single = [];
for (const name of ['single', 'setback', 'maximum'] as const) {
  loop.reset(); loop.enable();
  const t = performance.now(), run = await pool.run(source(name), {});
  loop.disable();
  single.push({ name, latencyMs: round(performance.now() - t), queueMs: round(run.queueMs), workerMs: round(run.workerMs), loopMaxMs: round(loop.max / 1e6), loopP99Ms: round(loop.percentile(99) / 1e6) });
}
loop.reset(); loop.enable();
const cStart = performance.now(), concurrent = await Promise.all(Array.from({ length: SCENE_POOL_DEFAULTS.size * 2 }, () => pool.run(source('maximum'), {})));
loop.disable();
const concurrency = { jobs: concurrent.length, wallMs: round(performance.now() - cStart), throughputPerMin: round(concurrent.length / ((performance.now() - cStart) / 60000)),
  maxQueueMs: round(Math.max(...concurrent.map(r => r.queueMs))), loopMaxMs: round(loop.max / 1e6) };
const saturating = new ScenePool({ size: 1, queueLimit: 2 }), outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => saturating.run(source('setback'), {})));
const saturation = { submitted: 6, accepted: outcomes.filter(o => o.status === 'fulfilled').length,
  refused: outcomes.filter(o => o.status === 'rejected').map(o => (o as PromiseRejectedResult).reason.code) };
await Promise.all([pool.close(), saturating.close()]);

await mkdir('docs/phase29/evidence', { recursive: true });
const out = { generatedBy: 'scripts/benchmark-scene.ts', node: process.version, cpus: availableParallelism(), limits: SCENE_LIMITS, poolDefaults: SCENE_POOL_DEFAULTS,
  results: rows, worker: { single, concurrency, saturation } };
await writeFile('docs/phase29/evidence/benchmark.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 1));
