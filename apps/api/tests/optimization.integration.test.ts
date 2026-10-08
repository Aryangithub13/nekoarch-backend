import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { costHash } from '@designflow/boq-cost';
import { asPrincipal, createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { optimizationAcceptance } from '../../../test-support/optimization-acceptance.js';
import { optimizationInput, optimizationVariable } from '../../../test-support/optimization-fixtures.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { signProjectCommit } from '../src/services/project-service.js';
import { OPTIMIZATION_STUDY_OPERATION } from '../src/services/optimization-service.js';
import { OptimizationPool } from '../src/optimization/pool.js';

const env = (secret?: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', ...(secret ? { PROJECT_COMMIT_SECRET: secret } : {}) });
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Snap = Record<string, any>;
const probe = (mode: string) => ({ url: new URL('../../../test-support/optimization-workers/probe.mjs', import.meta.url), execArgv: [], workerData: { mode } });
const rehashResult = (s: Snap) => { const { resultHash: _r, ...body } = s; s.resultHash = costHash(body); };
/** What a capable forger does: recompute every candidate/alias/baseline identity from the (forged) binding and rewrite all references. */
const reidentify = (s: Snap) => {
  const ids = new Map<string, string>(), b = s.binding;
  const id = (parameters: unknown, old: string) => { const fresh = costHash({ version: 'optimization-candidate-v1', projectId: b.projectId, sourceRevisionId: b.sourceRevisionId,
    sourceModelHash: b.sourceModelHash, generatorVersion: b.generatorVersion, seed: b.seed, parameters }); ids.set(old, fresh); return fresh; };
  for (const c of s.candidates) { c.candidateId = id(c.parameters, c.candidateId); for (const a of c.aliases) a.candidateId = id(a.parameters, a.candidateId); }
  s.baseline.candidateId = ids.get(s.baseline.candidateId) ?? id(s.baseline.parameters, s.baseline.candidateId);
  const swap = (list: string[]) => list.map(x => ids.get(x) ?? x);
  s.recommendedCandidates = swap(s.recommendedCandidates); s.paretoFrontier = swap(s.paretoFrontier);
  for (const c of s.candidates) c.dominatedBy = swap(c.dominatedBy);
};

describe('Phase 28 optimization persistence on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, ownerId: string, otherId: string, secret: string;
  beforeAll(async () => {
    db = await startTestDatabase(); ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });
  optimizationAcceptance(() => ({ app, owner, other }));

  async function setup(title = 'Phase 28 database tests') {
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title } });
    const r = await app.inject({ method: 'POST', url: `/api/projects/${p.json().id}/revisions/generate`, headers: owner, payload: { requirements: parametricInput() } });
    expect(r.statusCode, r.body).toBe(201);
    const revision = r.json().revision, revisionUrl = `/api/projects/${p.json().id}/revisions/${revision.id}`;
    const created = await app.inject({ method: 'POST', url: `${revisionUrl}/optimization/studies`, headers: owner, payload: optimizationInput() });
    expect(created.statusCode, created.body.slice(0, 400)).toBe(201);
    const write = { projectId: p.json().id as string, projectRevisionId: revision.id as string, acceptanceQaId: revision.qa.id as string, snapshot: created.json().snapshot as Snap };
    return { projectId: p.json().id as string, revision, revisionUrl, created: created.json(), write };
  }
  type Write = Awaited<ReturnType<typeof setup>>['write'];
  /** A genuinely new identity (different weight) whose input and result hashes recompute, so later SQL checks are reached. */
  const variant = (write: Write, change: (s: Snap) => void = () => undefined, rehash = true): Write => {
    const copy = structuredClone(write), s = copy.snapshot;
    s.input.objectives[0].weight = 2;
    change(s);
    if (rehash) { s.inputHash = costHash(s.input); rehashResult(s); }
    return copy;
  };
  const rpc = (input: unknown, user = ownerId, signature?: { envelope: string; signature: string }, context: unknown = null) => asPrincipal(db.pool, user, c =>
    c.query('select public.optimization_write($1,$2,$3,$4) response', [JSON.stringify(input), context ? JSON.stringify(context) : null, signature?.envelope ?? null, signature?.signature ?? null]));
  const sign = (input: unknown, user = ownerId) => signProjectCommit(secret, user, OPTIMIZATION_STUDY_OPERATION, input);
  const signed = (input: unknown) => rpc(input, ownerId, sign(input));
  const rows = async (revisionId: string) => (await db.pool.query('select id from public.project_revision_optimization_studies where project_revision_id=$1', [revisionId])).rows.length;

  it('hashes inputs and results identically in TypeScript and SQL', async () => {
    const { write } = await setup();
    const s = write.snapshot, { resultHash, ...body } = s;
    const r = (await db.pool.query('select project_private.cost_hash($1::jsonb) i, project_private.cost_hash($2::jsonb) r', [JSON.stringify(s.input), JSON.stringify(body)])).rows[0];
    expect(r).toEqual({ i: s.inputHash, r: resultHash });
  });

  it('accepts a signed recomputing variant; denies direct writes, unsigned, forged or foreign RPCs and foreign/anonymous reads', async () => {
    const { write, created } = await setup();
    const fresh = variant(write);
    await expect(rpc(fresh)).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(fresh, ownerId, { ...sign(fresh), signature: 'a'.repeat(64) })).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(fresh, otherId, sign(fresh))).rejects.toMatchObject({ code: '42501' }); // envelope signed for another user
    await expect(rpc(fresh, otherId, sign(fresh, otherId))).rejects.toMatchObject({ code: 'P1201' }); // not the project owner
    await expect(asPrincipal(db.pool, ownerId, c => c.query('insert into public.project_revision_optimization_studies select * from public.project_revision_optimization_studies limit 1')))
      .rejects.toMatchObject({ code: '42501' });
    expect((await signed(fresh)).rows[0].response).toMatchObject({ inputHash: fresh.snapshot.inputHash, resultHash: fresh.snapshot.resultHash });
    expect((await asPrincipal(db.pool, otherId, c => c.query('select id from public.project_revision_optimization_studies where id=$1', [created.id]))).rowCount).toBe(0);
    expect((await asPrincipal(db.pool, ownerId, c => c.query('select id from public.project_revision_optimization_studies where id=$1', [created.id]))).rowCount).toBe(1);
    await expect(asPrincipal(db.pool, null, c => c.query('select id from public.project_revision_optimization_studies'))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, null, c => c.query('select public.optimization_read($1,$2,$3)', ['list', write.projectId, write.projectRevisionId]))).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects forged binding, input, result and candidate identities with P2803 and stores nothing', async () => {
    const { write, revision } = await setup(), before = await rows(revision.id);
    for (const forge of [
      (s: Snap) => { s.binding.sourceModelHash = 'f'.repeat(64); },
      (s: Snap) => { s.binding.seed = 'other-seed'; reidentify(s); }, // identities consistent with the forged seed: only the seed↔revision binding can refuse it
      (s: Snap) => { s.binding.parameterHash = 'e'.repeat(64); },
      (s: Snap) => { s.candidates[1].candidateId = 'd'.repeat(64); },
      (s: Snap) => { s.baseline.candidateId = 'c'.repeat(64); },
    ]) await expect(signed(variant(write, forge))).rejects.toMatchObject({ code: 'P2803' });
    const staleResult = variant(write, s => { s.candidates[0].score = { numerator: '1', denominator: '1' }; }, false);
    staleResult.snapshot.inputHash = costHash(staleResult.snapshot.input); // input recomputes; only the result hash is stale
    await expect(signed(staleResult)).rejects.toMatchObject({ code: 'P2803' });
    const staleInput = variant(write); staleInput.snapshot.input.objectives[0].weight = 3; rehashResult(staleInput.snapshot); // inputHash no longer recomputes
    await expect(signed(staleInput)).rejects.toMatchObject({ code: 'P2803' });
    await expect(signed({ ...variant(write), acceptanceQaId: '00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({ code: 'P2802' });
    expect(await rows(revision.id)).toBe(before);
  });

  it('refuses studies that claim more than the bounded result, even with recomputed hashes', async () => {
    const { write, revision } = await setup(), before = await rows(revision.id);
    await expect(signed(variant(write, s => { s.claims.globalOptimality = 'CLAIMED'; }))).rejects.toMatchObject({ code: '23514' });
    await expect(signed(variant(write, s => { s.candidates[0].architectureMutation = 'ADOPTED'; }))).rejects.toMatchObject({ code: '23514' });
    await expect(signed(variant(write, s => { s.engineering.structural = 'EVALUATED'; }))).rejects.toMatchObject({ code: '23514' });
    expect(await rows(revision.id)).toBe(before);
  });

  it('keeps rows immutable, converges concurrent identical writes and refuses a different result for an identical input', async () => {
    const { write, revision, created } = await setup();
    await expect(db.pool.query("update public.project_revision_optimization_studies set status='COMPLETED' where id=$1", [created.id])).rejects.toThrow();
    await expect(db.pool.query('delete from public.project_revision_optimization_studies where id=$1', [created.id])).rejects.toThrow();
    const fresh = variant(write), before = await rows(revision.id);
    const results = await Promise.all(Array.from({ length: 4 }, () => signed(fresh)));
    expect(new Set(results.map(r => r.rows[0].response.id)).size).toBe(1);
    expect(await rows(revision.id)).toBe(before + 1);
    const divergent = structuredClone(fresh);
    divergent.snapshot.candidates[0].score = { numerator: '7', denominator: '9' }; rehashResult(divergent.snapshot); // same inputHash, recomputing resultHash
    await expect(signed(divergent)).rejects.toMatchObject({ code: 'P2803' });
    expect(await rows(revision.id)).toBe(before + 1);
  });

  describe('worker pool failures over HTTP store nothing', () => {
    async function withPool(pool: OptimizationPool, fn: (url: string, http: ReturnType<typeof buildApp>) => Promise<void>) {
      const http = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined, optimizationPool: pool });
      await http.ready();
      const p = await http.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'pool failure' } });
      const r = await http.inject({ method: 'POST', url: `/api/projects/${p.json().id}/revisions/generate`, headers: owner, payload: { requirements: parametricInput() } });
      try { await fn(`/api/projects/${p.json().id}/revisions/${r.json().revision.id}/optimization/studies`, http); }
      finally { await http.close(); }
      expect(pool.stats().closed).toBe(true); // the app drains its pool on close
      expect(await rows(r.json().revision.id)).toBe(0);
    }
    const input = optimizationInput({ variables: [optimizationVariable('w0', 0, 'widthMm', 17000, 18000, 1000)] });
    it('crash → 503 OPTIMIZATION_WORKER_FAILED with Retry-After', () => withPool(new OptimizationPool({ size: 1, worker: probe('crash') }), async (url, http) => {
      const r = await http.inject({ method: 'POST', url, headers: owner, payload: input });
      expect(r.statusCode).toBe(503); expect(r.json().error.code).toBe('OPTIMIZATION_WORKER_FAILED'); expect(r.headers['retry-after']).toBe('30');
    }));
    it('timeout → 503 OPTIMIZATION_WORKER_TIMEOUT; overflow → 503 OPTIMIZATION_QUEUE_FULL', () => withPool(new OptimizationPool({ size: 1, queueLimit: 0, timeoutMs: 1500, worker: probe('hang') }), async (url, http) => {
      const hanging = http.inject({ method: 'POST', url, headers: owner, payload: input });
      await new Promise(resolve => setTimeout(resolve, 400));
      const full = await http.inject({ method: 'POST', url, headers: owner, payload: input });
      expect(full.statusCode).toBe(503); expect(full.json().error.code).toBe('OPTIMIZATION_QUEUE_FULL');
      const timedOut = await hanging;
      expect(timedOut.statusCode).toBe(503); expect(timedOut.json().error.code).toBe('OPTIMIZATION_WORKER_TIMEOUT');
    }));
    it('malformed worker output → 503 OPTIMIZATION_WORKER_FAILED', () => withPool(new OptimizationPool({ size: 1, worker: probe('garbage') }), async (url, http) => {
      const r = await http.inject({ method: 'POST', url, headers: owner, payload: input });
      expect(r.statusCode).toBe(503); expect(r.json().error.code).toBe('OPTIMIZATION_WORKER_FAILED');
    }));
    it('a closed pool refuses work → 503 OPTIMIZATION_UNAVAILABLE', async () => {
      const pool = new OptimizationPool({ size: 1, worker: probe('garbage') }); await pool.close();
      await withPool(pool, async (url, http) => {
        const r = await http.inject({ method: 'POST', url, headers: owner, payload: input });
        expect(r.statusCode).toBe(503); expect(r.json().error.code).toBe('OPTIMIZATION_UNAVAILABLE');
      });
    });
  });
});
