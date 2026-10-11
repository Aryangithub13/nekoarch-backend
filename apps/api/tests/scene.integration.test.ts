import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { costHash } from '@designflow/boq-cost';
import { asPrincipal, createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { sceneAcceptance } from '../../../test-support/scene-acceptance.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { signProjectCommit } from '../src/services/project-service.js';
import { SCENE_ARTIFACT_OPERATION } from '../src/services/scene-service.js';
import { ScenePool } from '../src/scene3d/pool.js';
import { compileScene } from '../src/scene3d/compile.js';
import { validateScene } from '../src/scene3d/validate.js';
import { modelHash } from '../src/lib/generation-identity.js';
import type { SceneManifest } from '../src/scene3d/contracts.js';

const env = (secret?: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', ...(secret ? { PROJECT_COMMIT_SECRET: secret } : {}) });
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
const probe = (mode: string) => ({ url: new URL('../../../test-support/scene-workers/probe.mjs', import.meta.url), execArgv: [], workerData: { mode } });

describe('Phase 29 scene persistence on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, ownerId: string, otherId: string, secret: string;
  beforeAll(async () => {
    db = await startTestDatabase(); ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });
  sceneAcceptance(() => ({ app, owner, other }));

  async function setup(title = 'Phase 29 database tests') {
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title } });
    const r = await app.inject({ method: 'POST', url: `/api/projects/${p.json().id}/revisions/generate`, headers: owner, payload: { requirements: parametricInput(true) } });
    expect(r.statusCode, r.body).toBe(201);
    const revision = r.json().revision, base = `/api/projects/${p.json().id}/revisions/${revision.id}/scene`;
    const created = await app.inject({ method: 'POST', url: `${base}/artifacts`, headers: owner, payload: {} });
    expect(created.statusCode, created.body.slice(0, 400)).toBe(201);
    const glb = Buffer.from((await app.inject({ url: `${base}/artifacts/${created.json().id}/glb`, headers: owner })).rawPayload);
    const manifest = created.json().manifest as SceneManifest, { binary: _b, ...semantic } = manifest;
    const write = { projectId: p.json().id as string, projectRevisionId: revision.id as string, acceptanceQaId: revision.qa.id as string,
      sceneHash: costHash(semantic), manifest, validation: (await db.pool.query('select validation_json v from public.project_revision_scene_artifacts where id=$1', [created.json().id])).rows[0].v };
    return { projectId: p.json().id as string, revision, base, created: created.json(), glb, write };
  }
  type Write = Awaited<ReturnType<typeof setup>>['write'];
  const rpc = (input: unknown, glb: Buffer, user = ownerId, signature?: { envelope: string; signature: string }) => asPrincipal(db.pool, user, c =>
    c.query('select public.scene_write($1,$2,$3,$4,$5) response', [JSON.stringify(input), glb.toString('base64'), null, signature?.envelope ?? null, signature?.signature ?? null]));
  const sign = (input: unknown, user = ownerId) => signProjectCommit(secret, user, SCENE_ARTIFACT_OPERATION, input);
  const signed = (input: unknown, glb: Buffer) => rpc(input, glb, ownerId, sign(input));
  const rows = async (revisionId: string) => (await db.pool.query('select id from public.project_revision_scene_artifacts where project_revision_id=$1', [revisionId])).rows.length;
  /** A forger who also recomputes every hash the payload carries, so the SQL-side recomputation from the stored revision is what must reject it. */
  const reseal = (write: Write, change: (m: SceneManifest) => void, glb?: Buffer): Write => {
    const copy = structuredClone(write);
    change(copy.manifest);
    if (glb) copy.manifest.binary = { ...copy.manifest.binary, sha256: createHash('sha256').update(glb).digest('hex'), bytes: glb.length };
    copy.manifest.inputHash = costHash({ compilerVersion: copy.manifest.compilerVersion, manifestVersion: copy.manifest.version, source: copy.manifest.source });
    const { binary: _b, ...semantic } = copy.manifest; copy.sceneHash = costHash(semantic);
    return copy;
  };

  it('hashes the manifest identically in TypeScript and SQL', async () => {
    const { write } = await setup();
    const { binary: _b, ...semantic } = write.manifest;
    const r = (await db.pool.query(`select project_private.cost_hash($1::jsonb) s, project_private.cost_hash(jsonb_build_object('compilerVersion',$2::text,'manifestVersion',$3::text,'source',$4::jsonb)) i`,
      [JSON.stringify(semantic), write.manifest.compilerVersion, write.manifest.version, JSON.stringify(write.manifest.source)])).rows[0];
    expect(r).toEqual({ s: write.sceneHash, i: write.manifest.inputHash });
  });

  it('replays a signed genuine write onto the same artifact; denies unsigned, forged-signature and foreign writes', async () => {
    const { write, glb, created, revision } = await setup();
    expect((await signed(write, glb)).rows[0].response).toMatchObject({ id: created.id, status: 'READY' });
    await expect(rpc(write, glb)).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(write, glb, ownerId, { ...sign(write), signature: 'a'.repeat(64) })).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(write, glb, otherId, sign(write, otherId))).rejects.toMatchObject({ code: 'P1201' });
    expect(await rows(revision.id)).toBe(1);
  });

  it('rejects forged model hash, forged artifact hash, tampered bytes, missing coverage and unvalidated scenes in SQL', async () => {
    const { write, glb, revision } = await setup();
    const tampered = Buffer.from(glb); tampered.writeUInt8(tampered.readUInt8(tampered.length - 33) ^ 1, tampered.length - 33);
    await expect(signed(write, tampered)).rejects.toMatchObject({ code: 'P2903' }); // bytes no longer hash to the signed manifest
    await expect(signed(reseal(write, m => { m.source.modelHash = 'e'.repeat(64); }), glb)).rejects.toMatchObject({ code: 'P2903' });
    await expect(signed(reseal(write, m => { m.binary.sha256 = 'd'.repeat(64); }), glb)).rejects.toMatchObject({ code: 'P2903' });
    await expect(signed({ ...write, sceneHash: 'c'.repeat(64) }, glb)).rejects.toMatchObject({ code: 'P2903' });
    await expect(signed({ ...write, validation: { ...write.validation, status: 'INVALID' } }, glb)).rejects.toMatchObject({ code: 'P2903' });
    const notGlb = Buffer.from('not a binary gltf container, but correctly hashed into the manifest');
    await expect(signed(reseal(write, () => undefined, notGlb), notGlb)).rejects.toMatchObject({ code: 'P2903' });
    // A different scene for the identical input is nondeterminism, never a second artifact.
    const other = Buffer.from(glb); other.writeUInt8(other.readUInt8(other.length - 33) ^ 1, other.length - 33);
    await expect(signed(reseal(write, m => { m.limitations = [...m.limitations, 'forged']; }, other), other)).rejects.toMatchObject({ code: 'P2903' });
    expect(await rows(revision.id)).toBe(1);
  });

  it('rejects missing coverage on a revision with no artifact yet, then accepts the genuine scene (positive control)', async () => {
    const { projectId, revision } = await setup('Phase 29 coverage');
    const b = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner,
      payload: { requirements: { ...parametricInput(true), seed: 'phase29-coverage' }, baseRevisionId: revision.id } });
    expect(b.statusCode, b.body.slice(0, 300)).toBe(201);
    const next = b.json().revision, model = next.model;
    const binding = { projectId, revisionId: next.id as string, modelHash: modelHash(model), generatorVersion: next.generatorVersion ?? null,
      parameterHash: model.parametricArchitecture ? costHash(model.parametricArchitecture) : null };
    const { manifest, glb } = compileScene(model, binding), validation = validateScene(model, binding, manifest, glb), { binary: _b, ...semantic } = manifest;
    const write = { projectId, projectRevisionId: next.id as string, acceptanceQaId: next.qa.id as string, sceneHash: costHash(semantic), manifest, validation };
    const wall = manifest.coverage.find(c => c.entityType === 'wall')!;
    await expect(signed(reseal(write, m => { m.coverage = m.coverage.filter(c => c !== m.coverage.find(x => x.entityType === 'wall' && x.entityId === wall.entityId)); }), glb))
      .rejects.toMatchObject({ code: 'P2903' });
    expect(await rows(next.id)).toBe(0);
    expect((await signed(write, glb)).rows[0].response).toMatchObject({ status: 'READY', projectRevisionId: next.id });
    expect(await rows(next.id)).toBe(1);
  });

  it('keeps artifacts and bytes immutable, READY-only and unreachable except through the owner-scoped RPC', async () => {
    const { created, revision, projectId } = await setup();
    await expect(asPrincipal(db.pool, ownerId, c => c.query('select glb from public.project_revision_scene_blobs'))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, ownerId, c => c.query("update public.project_revision_scene_artifacts set status='READY'"))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, ownerId, c => c.query('delete from public.project_revision_scene_artifacts'))).rejects.toMatchObject({ code: '42501' });
    expect((await asPrincipal(db.pool, ownerId, c => c.query('select id from public.project_revision_scene_artifacts where id=$1', [created.id]))).rows).toHaveLength(1);
    expect((await asPrincipal(db.pool, otherId, c => c.query('select id from public.project_revision_scene_artifacts where id=$1', [created.id]))).rows).toHaveLength(0);
    await expect(asPrincipal(db.pool, otherId, c => c.query("select public.scene_read('glb',$1,$2,$3)", [projectId, revision.id, created.id]))).rejects.toMatchObject({ code: 'P1201' });
    await expect(db.pool.query('update public.project_revision_scene_blobs set glb = glb where artifact_id=$1', [created.id])).rejects.toThrow();
    await expect(db.pool.query('delete from public.project_revision_scene_artifacts where id=$1', [created.id])).rejects.toThrow();
    await expect(db.pool.query("update public.project_revision_scene_artifacts set status='PENDING' where id=$1", [created.id])).rejects.toThrow();
  });

  it('stores nothing when the worker crashes, times out, returns unvalidated output or the queue is full', async () => {
    const { revision, base } = await setup('Phase 29 worker failures');
    for (const [mode, code, options] of [['crash', 'SCENE_WORKER_FAILED', {}], ['garbage', 'SCENE_WORKER_FAILED', {}], ['hang', 'SCENE_WORKER_TIMEOUT', { timeoutMs: 300 }]] as const) {
      const failing = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined,
        scenePool: new ScenePool({ size: 1, ...options, worker: probe(mode) }) });
      await failing.ready();
      const next = await failing.inject({ method: 'POST', url: `/api/projects/${(await failing.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: mode } })).json().id}/revisions/generate`,
        headers: owner, payload: { requirements: parametricInput() } });
      const url = `/api/projects/${next.json().revision.projectId}/revisions/${next.json().revision.id}/scene/artifacts`;
      const res = await failing.inject({ method: 'POST', url, headers: owner, payload: {} });
      expect([res.statusCode, res.json().error.code, res.headers['retry-after']], mode).toEqual([503, code, '30']);
      expect(await rows(next.json().revision.id), mode).toBe(0);
      await failing.close();
    }
    const full = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined,
      scenePool: new ScenePool({ size: 1, queueLimit: 0, timeoutMs: 2000, worker: probe('hang') }) });
    await full.ready();
    const busy = full.inject({ method: 'POST', url: `${base}/artifacts`, headers: owner, payload: {} });
    await new Promise(resolve => setTimeout(resolve, 150));
    const refused = await full.inject({ method: 'POST', url: `${base}/artifacts`, headers: { ...owner, 'idempotency-key': crypto.randomUUID() }, payload: {} });
    expect([refused.statusCode, refused.json().error.code]).toEqual([503, 'SCENE_QUEUE_FULL']);
    expect((await busy).statusCode).toBe(503);
    expect(await rows(revision.id)).toBe(1);
    await full.close();
  });
});
