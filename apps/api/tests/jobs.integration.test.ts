import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { costHash } from '@designflow/boq-cost';
import { asPrincipal, createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { optimizationInput } from '../../../test-support/optimization-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { signProjectCommit } from '../src/services/project-service.js';
import { JOB_ROOT } from '../src/services/job-service.js';
import { ScenePool } from '../src/scene3d/pool.js';

// Same convention as the Phase 30 suite: untyped JSON bodies in assertions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret });
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
const CORE = 'Redesign the exterior of my building using a contemporary glass-inspired façade. Keep the exact floor plans, internal rooms, stairs, structure, building dimensions, and existing interior unchanged.';
const TERMINAL = ['SUCCEEDED', 'FAILED', 'CANCELLED'];

describe('Phase 32 durable jobs on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, ownerId: string, otherId: string, secret: string;
  beforeAll(async () => {
    db = await startTestDatabase(); ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });

  async function project(requirements = parametricInput(true), target = app) {
    const p = await target.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Phase 32 jobs' } });
    const r = await target.inject({ method: 'POST', url: `/api/projects/${p.json().id}/revisions/generate`, headers: owner, payload: { requirements } });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(201);
    return { projectId: p.json().id as string, revisionId: r.json().revision.id as string, jobs: `/api/projects/${p.json().id}/jobs` };
  }
  const submit = (jobs: string, payload: Json, target = app, headers: Record<string, string> = owner) => target.inject({ method: 'POST', url: jobs, headers, payload });
  async function settle(url: string, target = app, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = (await target.inject({ url, headers: owner })).json() as Json;
      if (TERMINAL.includes(job.status) || Date.now() > deadline) return job;
      await new Promise(r => setTimeout(r, 100));
    }
  }
  /** Direct signed SQL as the owner, bypassing the API (and so its dispatch): the runner's view of job_write. */
  const sql = (action: string, input: Json, user = ownerId) => {
    const op = action === 'submit' ? JOB_ROOT : action === 'recover' ? 'job-recover' : ['cancel', 'retry'].includes(action) ? `${JOB_ROOT}/:jobId/${action}` : 'job-runner';
    const body = { action, ...input }, signed = signProjectCommit(secret, user, op, body);
    return asPrincipal(db.pool, user, c => c.query('select public.job_write($1,$2,$3,$4,$5) response', [action, JSON.stringify(body), null, signed.envelope, signed.signature]))
      .then(r => r.rows[0].response as Json);
  };
  const queued = (projectId: string, request: Json) => sql('submit', { projectId, kind: request.kind, request, inputHash: costHash(request) });
  const events = async (url: string, after = 0) => (await app.inject({ url: `${url}/events?after=${after}`, headers: owner })).json() as Json;

  it('SCENE_COMPILE: 202 at once, then progress events, and the same artifact the synchronous route produces', async () => {
    const { projectId, revisionId, jobs } = await project();
    const res = await submit(jobs, { kind: 'SCENE_COMPILE', revisionId });
    expect(res.statusCode, res.body).toBe(202);
    expect([res.headers.location, res.headers['retry-after'], res.json().deduplicated]).toEqual([`${jobs}/${res.json().id}`, '1', false]);
    const job = await settle(`${jobs}/${res.json().id}`);
    expect(job).toMatchObject({ status: 'SUCCEEDED', attempt: 1, progress: { stage: 'DONE', percent: 100 }, result: { resultKind: 'SCENE_ARTIFACT' }, failure: null });
    expect(job).not.toHaveProperty('leaseToken');
    const log = await events(`${jobs}/${job.id}`);
    expect(log.events.map((e: Json) => e.eventType === 'PROGRESS' ? `PROGRESS:${e.detail.stage}` : e.eventType))
      .toEqual(['SUBMITTED', 'STARTED', 'PROGRESS:COMPUTING', 'PROGRESS:PERSISTING', 'SUCCEEDED']);
    expect(log.events.map((e: Json) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect((await events(`${jobs}/${job.id}`, 3)).events.map((e: Json) => e.seq)).toEqual([4, 5]);
    expect((await app.inject({ url: job.result.href, headers: owner })).statusCode).toBe(200);
    const sync = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/${revisionId}/scene/artifacts`, headers: owner, payload: {} });
    expect(sync.json().id).toBe(job.result.resultId); // identical input converges on one immutable artifact
  });

  it('OPTIMIZATION_STUDY and REVISION_EXECUTE run the unchanged Phase 28/30 operations', async () => {
    const opt = await project(parametricInput());
    const study = await settle(`${opt.jobs}/${(await submit(opt.jobs, { kind: 'OPTIMIZATION_STUDY', revisionId: opt.revisionId, input: optimizationInput() })).json().id}`);
    expect(study, JSON.stringify(study.failure)).toMatchObject({ status: 'SUCCEEDED', result: { resultKind: 'OPTIMIZATION_STUDY' } });
    expect((await app.inject({ url: study.result.href, headers: owner })).statusCode).toBe(200);

    const rev = await project();
    const pre = await app.inject({ method: 'POST', url: `/api/projects/${rev.projectId}/revision-operations`, headers: owner,
      payload: { baseRevisionId: rev.revisionId, request: { text: CORE } } });
    expect(pre.json().status, pre.body.slice(0, 300)).toBe('AWAITING_CONSENT');
    const exec = await settle(`${rev.jobs}/${(await submit(rev.jobs, { kind: 'REVISION_EXECUTE', operationId: pre.json().id, preflightHash: pre.json().preflightHash,
      consent: { acceptLocks: true, acceptQuote: true } })).json().id}`);
    expect(exec, JSON.stringify(exec.failure)).toMatchObject({ status: 'SUCCEEDED', result: { resultKind: 'REVISION_OPERATION', resultId: pre.json().id } });
    expect((await app.inject({ url: exec.result.href, headers: owner })).json().status).toBe('CANDIDATE_READY');
  });

  it('a permanent failure fails at once with the operation\'s typed error and cannot be retried', async () => {
    const { revisionId, jobs } = await project(parametricInput());
    const job = await settle(`${jobs}/${(await submit(jobs, { kind: 'OPTIMIZATION_STUDY', revisionId, input: { version: 'nope' } })).json().id}`);
    expect(job).toMatchObject({ status: 'FAILED', attempt: 1, failure: { retryable: false, attempt: 1 } });
    expect(job.failure.code).toMatch(/^OPTIMIZATION_/);
    const retry = await app.inject({ method: 'POST', url: `${jobs}/${job.id}/retry`, headers: owner, payload: {} });
    expect([retry.statusCode, retry.json().error.code]).toEqual([409, 'JOB_NOT_RETRYABLE']);
    // A target that does not exist is refused at submission, not after queueing.
    expect((await submit(jobs, { kind: 'SCENE_COMPILE', revisionId: randomUUID() })).statusCode).toBe(404);
  });

  it('retries a transient failure with backoff, then fails retryably once attempts are exhausted', async () => {
    const crashing = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined,
      scenePool: new ScenePool({ worker: { url: new URL('../../../test-support/scene-workers/probe.mjs', import.meta.url), execArgv: [], workerData: { mode: 'crash' } } }) });
    await crashing.ready();
    try {
      const { revisionId, jobs } = await project(parametricInput(true), crashing);
      const id = (await submit(jobs, { kind: 'SCENE_COMPILE', revisionId }, crashing)).json().id;
      const job = await settle(`${jobs}/${id}`, crashing, 40_000);
      expect(job).toMatchObject({ status: 'FAILED', attempt: 3, failure: { code: 'SCENE_WORKER_FAILED', retryable: true, attempt: 3 } });
      const log = (await crashing.inject({ url: `${jobs}/${id}/events`, headers: owner })).json().events.map((e: Json) => e.eventType);
      expect(log.filter((t: string) => t === 'STARTED')).toHaveLength(3);
      expect(log.filter((t: string) => t === 'REQUEUED')).toHaveLength(2);
      const requeues = (await crashing.inject({ url: `${jobs}/${id}/events`, headers: owner })).json().events.filter((e: Json) => e.eventType === 'REQUEUED');
      expect(requeues.map((e: Json) => e.detail.backoffSeconds)).toEqual([2, 8]);
    } finally { await crashing.close(); }
  }, 60_000);

  it('recovers a job whose process died (expired lease) on the next read, and fences off the stale worker', async () => {
    const { projectId, revisionId, jobs } = await project();
    const job = await queued(projectId, { kind: 'SCENE_COMPILE', revisionId });
    const lease = await sql('start', { projectId, jobId: job.id });
    expect([lease.status, lease.attempt]).toEqual(['RUNNING', 1]);
    await db.pool.query("update public.project_jobs set lease_expires_at = clock_timestamp() - interval '1 second' where id=$1", [job.id]);
    const done = await settle(`${jobs}/${job.id}`);
    expect(done).toMatchObject({ status: 'SUCCEEDED', attempt: 2, lastFailure: { code: 'JOB_INTERRUPTED', attempt: 1 } });
    const log = (await events(`${jobs}/${job.id}`)).events.map((e: Json) => e.eventType);
    expect(log.slice(0, 5)).toEqual(['SUBMITTED', 'STARTED', 'LEASE_EXPIRED', 'REQUEUED', 'STARTED']);
    // The dead worker's lease token no longer writes anything.
    await expect(sql('heartbeat', { projectId, jobId: job.id, leaseToken: lease.leaseToken })).rejects.toMatchObject({ code: 'P3203' });
    await expect(sql('complete', { projectId, jobId: job.id, leaseToken: lease.leaseToken, result: { resultId: randomUUID() } })).rejects.toMatchObject({ code: 'P3203' });
  });

  it('fails an interrupted job whose attempts are exhausted, and lets the owner retry it', async () => {
    const { projectId, revisionId, jobs } = await project();
    const job = await queued(projectId, { kind: 'SCENE_COMPILE', revisionId });
    await sql('start', { projectId, jobId: job.id });
    await db.pool.query("update public.project_jobs set attempt=3, lease_expires_at = clock_timestamp() - interval '1 second' where id=$1", [job.id]);
    const failed = (await app.inject({ url: `${jobs}/${job.id}`, headers: owner })).json();
    expect(failed).toMatchObject({ status: 'FAILED', failure: { code: 'JOB_INTERRUPTED', retryable: true } });
    const retried = await app.inject({ method: 'POST', url: `${jobs}/${job.id}/retry`, headers: owner, payload: {} });
    expect(retried.json()).toMatchObject({ status: 'QUEUED', attempt: 0, userRetries: 1, failure: null, lastFailure: { code: 'JOB_INTERRUPTED' } });
    expect(await settle(`${jobs}/${job.id}`)).toMatchObject({ status: 'SUCCEEDED', userRetries: 1 });
  });

  it('suppresses duplicates, cancels queued jobs and enforces the active-job limit', async () => {
    const { projectId, revisionId, jobs } = await project();
    const request = { kind: 'SCENE_COMPILE', revisionId: randomUUID() };
    const first = await queued(projectId, request), second = await queued(projectId, request);
    expect([second.id, first.deduplicated, second.deduplicated]).toEqual([first.id, false, true]);
    const cancelled = await app.inject({ method: 'POST', url: `${jobs}/${first.id}/cancel`, headers: owner, payload: {} });
    expect(cancelled.json()).toMatchObject({ status: 'CANCELLED', cancelRequested: true });
    const again = await app.inject({ method: 'POST', url: `${jobs}/${first.id}/cancel`, headers: owner, payload: {} });
    expect([again.statusCode, again.json().error.code]).toEqual([409, 'JOB_INVALID_TRANSITION']);
    for (let i = 0; i < 4; i++) await queued(projectId, { kind: 'SCENE_COMPILE', revisionId: randomUUID() });
    const limited = await submit(jobs, { kind: 'SCENE_COMPILE', revisionId });
    expect([limited.statusCode, limited.json().error.code]).toEqual([429, 'JOB_LIMIT_EXCEEDED']);
  });

  it('hides jobs from other users (404) and anonymous callers (401); the database guards the lifecycle', async () => {
    const { projectId, revisionId, jobs } = await project();
    const job = await settle(`${jobs}/${(await submit(jobs, { kind: 'SCENE_COMPILE', revisionId })).json().id}`);
    for (const res of await Promise.all([app.inject({ url: jobs, headers: other }), app.inject({ url: `${jobs}/${job.id}`, headers: other }),
      app.inject({ url: `${jobs}/${job.id}/events`, headers: other }), app.inject({ method: 'POST', url: `${jobs}/${job.id}/cancel`, headers: other, payload: {} }),
      app.inject({ method: 'POST', url: `${jobs}/${job.id}/retry`, headers: other, payload: {} }), submit(jobs, { kind: 'SCENE_COMPILE', revisionId }, app, other)]))
      expect(res.statusCode, res.body).toBe(404);
    expect((await app.inject({ url: `${jobs}/${job.id}` })).statusCode).toBe(401);
    expect((await asPrincipal(db.pool, otherId, c => c.query('select id from public.project_jobs where project_id=$1', [projectId]))).rows).toHaveLength(0);
    await expect(db.pool.query("update public.project_jobs set request_json = request_json || '{\"x\":1}' where id=$1", [job.id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query("update public.project_jobs set status='QUEUED', result_json=null, finished_at=null where id=$1", [job.id])).rejects.toMatchObject({ code: 'P3202' });
    await expect(db.pool.query('delete from public.project_jobs where id=$1', [job.id])).rejects.toMatchObject({ code: '23514' });
    await expect(sql('submit', { projectId, kind: 'SCENE_COMPILE', request: { kind: 'SCENE_COMPILE', revisionId }, inputHash: 'f'.repeat(64) }, otherId)).rejects.toMatchObject({ code: 'P1201' });
  });
});
