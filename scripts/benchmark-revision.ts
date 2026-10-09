import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { bindingFor, sceneModels } from '../test-support/scene-fixtures.js';
import { createTestUser, startTestDatabase } from '../test-support/postgres.js';
import { createPgBackend } from '../test-support/pg-backend.js';
import { parametricInput } from '../test-support/parametric-fixtures.js';
import { compileScene } from '../apps/api/src/scene3d/compile.js';
import { validateScene } from '../apps/api/src/scene3d/validate.js';
import { interpretRevision } from '../apps/api/src/revision/interpret.js';
import { buildIntent, planRevision } from '../apps/api/src/revision/plan.js';
import { applyAppearance } from '../apps/api/src/revision/appearance.js';
import { verifyAppearance } from '../apps/api/src/revision/verify.js';
import { AppearancePool } from '../apps/api/src/revision/pool.js';
import { APPEARANCE_VERSION, FACADES, type Appearance } from '../apps/api/src/revision/contracts.js';
import { buildApp } from '../apps/api/src/app.js';
import { parseEnv } from '../apps/api/src/config/env.js';

// Phase 30 benchmark: one process, observations not SLOs. Writes docs/phase30/evidence/benchmark.json.
const round = (n: number) => Math.round(n * 100) / 100;
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { n: s.length, medianMs: round(s[Math.floor(s.length / 2)]!), p90Ms: round(s[Math.floor(s.length * 0.9)]!), maxMs: round(s.at(-1)!) }; };
const time = (n: number, f: () => unknown) => stats(Array.from({ length: n }, () => { const t = performance.now(); f(); return performance.now() - t; }));
const CORE = 'Redesign the exterior of my building using a contemporary glass-inspired façade. Keep the exact floor plans, internal rooms, stairs, structure, building dimensions, and existing interior unchanged.';
const app: Appearance = { version: APPEARANCE_VERSION, assignments: [{ target: { kind: 'EXTERIOR_WALLS', facades: [...FACADES], levelIds: null }, finish: { presetId: 'glass-inspired-blue-grey' } }] };
const models = sceneModels();

const intent = time(500, () => interpretRevision(CORE, models.setback.levels));
const planner = Object.fromEntries(Object.entries(models).map(([name, model]) => {
  const rev = { id: '22222222-2222-4222-8222-222222222222', revisionNumber: 1, parentRevisionId: null, model, generatorVersion: null };
  const ctx = { projectId: '11111111-1111-4111-8111-111111111111', base: rev, baseAppearance: null, baseOutputs: [], source: null };
  return [name, time(50, () => planRevision(ctx, buildIntent({ text: CORE }, rev, [])))];
}));
const appearance = Object.entries(models).map(([name, model]) => {
  const b = compileScene(model, bindingFor(model)), base = { manifest: b.manifest, glb: b.glb, validation: validateScene(model, bindingFor(model), b.manifest, b.glb) };
  const c = applyAppearance(model, b.manifest, b.glb, app);
  return { name, objects: b.manifest.statistics.objects, targets: c.manifest.targets.length,
    applyMs: time(20, () => applyAppearance(model, b.manifest, b.glb, app)), validateMs: time(20, () => verifyAppearance(model, base, c, app)),
    baseGlbBytes: b.glb.length, candidateGlbBytes: c.glb.length, candidateGlbGzipBytes: gzipSync(c.glb).length, candidateManifestBytes: Buffer.byteLength(JSON.stringify(c.manifest)) };
});
const pool = new AppearancePool(), source = { model: models.setback, binding: bindingFor(models.setback) };
await pool.run(source, app); // warm
const poolRuns: { latencyMs: number; queueMs: number; workerMs: number }[] = [];
for (let i = 0; i < 5; i++) { const t = performance.now(), r = await pool.run(source, app); poolRuns.push({ latencyMs: round(performance.now() - t), queueMs: round(r.queueMs), workerMs: round(r.workerMs) }); }
const concurrent = await Promise.allSettled(Array.from({ length: 6 }, () => pool.run(source, app)));
await pool.close();

// Live backend on embedded PostgreSQL (real RLS roles, signed RPCs, real worker pool).
const db = await startTestDatabase(), owner = await createTestUser(db.pool), secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
const api = buildApp({ env: parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'x', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret }),
  backend: createPgBackend(db.pool, { o: owner }), captureError: () => undefined });
const h = { authorization: 'Bearer o' }, live: Record<string, number[]> = { preflight: [], execute: [], readOperation: [], candidateGlb: [], comparison: [], approve: [] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timed = async (k: string, f: () => Promise<{ statusCode: number; headers: Record<string, unknown>; json(): any }>, status: number) => { const t = performance.now(), r = await f(); live[k]!.push(performance.now() - t); if (r.statusCode !== status) throw new Error(`${k}: ${r.statusCode}`); return String(r.headers['content-type']).startsWith('application/json') ? r.json() : null; };
for (let i = 0; i < 5; i++) {
  const p = (await api.inject({ method: 'POST', url: '/api/projects', headers: h, payload: { title: `bench ${i}` } })).json().id;
  const a = (await api.inject({ method: 'POST', url: `/api/projects/${p}/revisions/generate`, headers: h, payload: { requirements: parametricInput(true) } })).json().revision.id;
  const ops = `/api/projects/${p}/revision-operations`;
  const pre = await timed('preflight', () => api.inject({ method: 'POST', url: ops, headers: h, payload: { baseRevisionId: a, request: { text: CORE } } }), 201);
  const cand = await timed('execute', () => api.inject({ method: 'POST', url: `${ops}/${pre.id}/execute`, headers: h, payload: { preflightHash: pre.preflightHash, consent: { acceptLocks: true, acceptQuote: true } } }), 200);
  await timed('readOperation', () => api.inject({ url: `${ops}/${pre.id}`, headers: h }), 200);
  await timed('candidateGlb', () => api.inject({ url: `${ops}/${pre.id}/candidate/glb`, headers: h }), 200);
  await timed('comparison', () => api.inject({ url: `${ops}/${pre.id}/comparison`, headers: h }), 200);
  await timed('approve', () => api.inject({ method: 'POST', url: `${ops}/${pre.id}/approve`, headers: h, payload: { preflightHash: pre.preflightHash, candidateHash: cand.candidateHash } }), 201);
}
const anon: number[] = [];
for (let i = 0; i < 20; i++) { const t = performance.now(); await api.inject({ url: '/api/projects/11111111-1111-4111-8111-111111111111/revision-operations' }); anon.push(performance.now() - t); }
await api.close(); await db.stop();

const out = { benchmark: 'phase30-selective-revision-v1', node: process.version, generatedBy: 'scripts/benchmark-revision.ts', intentParse: intent, planner, appearance,
  pool: { runs: poolRuns, concurrentSubmitted: 6, concurrentAccepted: concurrent.filter(o => o.status === 'fulfilled').length,
    concurrentRefused: concurrent.filter(o => o.status === 'rejected').map(o => (o as PromiseRejectedResult).reason?.code) },
  liveBackend: Object.fromEntries(Object.entries(live).map(([k, v]) => [k, stats(v)])), anonymousRejection: stats(anon), rssMb: round(process.memoryUsage().rss / 1048576) };
await mkdir('docs/phase30/evidence', { recursive: true });
await writeFile('docs/phase30/evidence/benchmark.json', JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ intent: out.intentParse, planner: out.planner.setback, live: out.liveBackend, pool: out.pool }, null, 1));
