import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asPrincipal, createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { optimizationInput } from '../../../test-support/optimization-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { signProjectCommit } from '../src/services/project-service.js';
import { ScenePool } from '../src/scene3d/pool.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
const env = (secret: string, extra: Record<string, string> = {}) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test',
  LOG_LEVEL: 'info', RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret, ...extra });
const TERMINAL = ['SUCCEEDED', 'FAILED', 'CANCELLED'];
const call = (target: ReturnType<typeof buildApp>, method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = owner) =>
  target.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as Json }) });
const consentFor = (quote: Json) => ({ quote, consent: { quoteHash: quote.quoteHash, acceptQuote: true, acceptLocalExecution: true } });

describe('Phase 36 compute gateway (first slice) on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, ownerId: string, otherId: string, secret: string;
  const logs: Json[] = [];
  beforeAll(async () => {
    db = await startTestDatabase(); ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    const sink = new Writable({ write(chunk, _e, done) { for (const line of String(chunk).split('\n').filter(Boolean)) logs.push(JSON.parse(line)); done(); } });
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined, logger: createLogger(env(secret), sink) });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.stop(); });

  async function project(target = app) {
    const p = await call(target, 'POST', '/api/projects', { title: 'Phase 36 gateway' });
    const r = await call(target, 'POST', `/api/projects/${p.json().id}/revisions/generate`, { requirements: parametricInput(true) });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(201);
    const projectId = p.json().id as string;
    return { projectId, revisionId: r.json().revision.id as string, quotes: `/api/projects/${projectId}/compute/quotes`, jobs: `/api/projects/${projectId}/compute/jobs` };
  }
  async function settle(url: string, target = app, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const view = (await call(target, 'GET', url)).json() as Json;
      if (TERMINAL.includes(view.job?.status) || Date.now() > deadline) return view;
      await new Promise(r => setTimeout(r, 100));
    }
  }
  const counts = async (projectId: string) => (await db.pool.query(`select (select count(*)::int from project_jobs where project_id=$1) jobs,
    (select count(*)::int from project_compute_dispatches where project_id=$1) dispatches, (select count(*)::int from project_revision_scene_artifacts a
    join project_revisions r on r.id=a.project_revision_id where r.project_id=$1) scenes`, [projectId])).rows[0] as { jobs: number; dispatches: number; scenes: number };

  it('quotes without side effects, runs only after explicit consent, records auditable metadata and is polled to a validated artifact', async () => {
    const { projectId, revisionId, quotes, jobs } = await project();
    const quoted = await call(app, 'POST', quotes, { request: { kind: 'SCENE_COMPILE', revisionId } });
    expect(quoted.statusCode, quoted.body).toBe(200);
    const quote = quoted.json();
    expect(quote).toMatchObject({ quoteVersion: 'compute-quote-v1', kind: 'SCENE_COMPILE', placement: 'LOCAL', provider: { providerId: 'local-pool' }, dataTransfer: 'NONE',
      cost: { costClass: 'FREE', ceilingMinor: 0 }, source: { revisionId }, algorithm: { engine: 'scene-compiler', version: 'scene-compiler-v1' },
      authorization: 'NOT_AUTHORIZED_UNTIL_CONSENT', runtime: { reproducibility: 'NOT_CLAIMED' },
      claims: { engineeringValidity: 'NOT_CLAIMED', solverValidation: 'NOT_CLAIMED', professionalReview: 'NOT_CLAIMED', environmentReproducibility: 'NOT_CLAIMED' } });
    expect(quote.execution).toMatchObject({ maxAttempts: 3, maxActivePerProject: 4, requestBytes: 65_536 });
    expect(quote.execution.maxWallMs).toBeGreaterThan(0);
    // A quote is not authorization: nothing exists yet.
    expect(await counts(projectId)).toEqual({ jobs: 0, dispatches: 0, scenes: 0 });

    const accepted = await call(app, 'POST', jobs, consentFor(quote));
    expect(accepted.statusCode, accepted.body).toBe(202);
    const { job, dispatch, replayed } = accepted.json();
    expect(replayed).toBe(false);
    expect(accepted.headers.location).toBe(`${jobs}/${job.id}`);
    expect(dispatch).toMatchObject({ quoteHash: quote.quoteHash, jobId: job.id, ownerId, kind: 'SCENE_COMPILE', placement: 'LOCAL', providerId: 'local-pool',
      inputHash: quote.inputHash, sourceRevisionId: revisionId, modelHash: quote.source.modelHash, costCeilingMinor: 0, dataTransfer: 'NONE' });
    expect(dispatch.quote).not.toHaveProperty('request');
    const done = await settle(`${jobs}/${job.id}`);
    expect(done).toMatchObject({ job: { status: 'SUCCEEDED', result: { resultKind: 'SCENE_ARTIFACT' } }, resultCheck: { status: 'ACCEPTED_BY_SERVICE_VALIDATOR' },
      claims: { engineeringValidity: 'NOT_CLAIMED' }, dispatches: [expect.objectContaining({ quoteHash: quote.quoteHash })] });
    expect(done.resultCheck.detail).toMatch(/not an engineering validation/);
    expect(await counts(projectId)).toEqual({ jobs: 1, dispatches: 1, scenes: 1 });
    // The job is an ordinary B32 job: visible and cancellable through the B32 routes.
    expect((await call(app, 'GET', `/api/projects/${projectId}/jobs/${job.id}`)).json().status).toBe('SUCCEEDED');
  }, 120_000);

  it('requires consent that names the exact server-issued quote; tampered, foreign or mismatched quotes create nothing', async () => {
    const { projectId, revisionId, quotes, jobs } = await project();
    const quote = (await call(app, 'POST', quotes, { request: { kind: 'SCENE_COMPILE', revisionId } })).json();
    const refused = async (payload: unknown, status: number, code: string) => {
      const r = await call(app, 'POST', jobs, payload);
      expect([r.statusCode, r.json().error.code], JSON.stringify(payload).slice(0, 120)).toEqual([status, code]);
    };
    await refused({ quote }, 400, 'VALIDATION_ERROR');
    await refused({ quote, consent: { quoteHash: quote.quoteHash, acceptQuote: false, acceptLocalExecution: true } }, 400, 'VALIDATION_ERROR');
    await refused({ quote, consent: { quoteHash: 'a'.repeat(64), acceptQuote: true, acceptLocalExecution: true } }, 409, 'COMPUTE_CONSENT_MISMATCH');
    await refused(consentFor({ ...quote, execution: { ...quote.execution, maxWallMs: 1 } }), 409, 'COMPUTE_QUOTE_INVALID');
    await refused(consentFor({ ...quote, expiresAt: '2099-01-01T00:00:00.000Z' }), 409, 'COMPUTE_QUOTE_INVALID');
    const otherRevision = (await call(app, 'POST', `/api/projects/${projectId}/revisions/generate`, { requirements: parametricInput(true), baseRevisionId: revisionId })).json().revision.id;
    await refused(consentFor({ ...quote, request: { kind: 'SCENE_COMPILE', revisionId: otherRevision } }), 409, 'COMPUTE_QUOTE_INVALID');
    // Another owner's consent to this quote is refused (404 on the project before anything else).
    expect((await call(app, 'POST', jobs, consentFor(quote), other)).statusCode).toBe(404);
    // A quote for one project cannot be consented on another.
    const second = await project();
    expect((await call(app, 'POST', second.jobs, consentFor(quote))).json().error.code).toBe('COMPUTE_QUOTE_INVALID');
    expect(await counts(projectId)).toEqual({ jobs: 0, dispatches: 0, scenes: 0 });
  }, 120_000);

  it('keeps remote execution disabled and refuses ineligible kinds and invalid work before consent (fail closed)', async () => {
    const { projectId, revisionId, quotes } = await project();
    const remote = await call(app, 'POST', quotes, { request: { kind: 'SCENE_COMPILE', revisionId }, placement: 'REMOTE' });
    expect([remote.statusCode, remote.json().error.code]).toEqual([422, 'COMPUTE_PLACEMENT_DISABLED']);
    const revision = await call(app, 'POST', quotes, { request: { kind: 'REVISION_EXECUTE', operationId: randomUUID(), preflightHash: 'a'.repeat(64), consent: { acceptLocks: true, acceptQuote: true } } });
    expect([revision.statusCode, revision.json().error.code]).toEqual([422, 'COMPUTE_KIND_UNSUPPORTED']);
    const invalid = await call(app, 'POST', quotes, { request: { kind: 'OPTIMIZATION_STUDY', revisionId, input: { nonsense: true } } });
    expect(invalid.statusCode).toBe(400);
    expect((await call(app, 'POST', quotes, { request: { kind: 'SCENE_COMPILE', revisionId: randomUUID() } })).statusCode).toBe(404);
    expect(await counts(projectId)).toEqual({ jobs: 0, dispatches: 0, scenes: 0 });
    // Discovery reports the gateway and the disabled remote provider; no endpoint, credential or price is exposed.
    const capabilities = (await call(app, 'GET', '/api/capabilities', undefined, {})).json();
    expect(capabilities.services.find((s: Json) => s.serviceId === 'COMPUTE_GATEWAY')).toMatchObject({ status: 'AVAILABLE', route: '/api/projects/:projectId/compute' });
    expect(capabilities.computeProviders.map((p: Json) => `${p.providerId}:${p.status}`)).toEqual(['local-pool:AVAILABLE', 'remote-http-worker:DISABLED']);
    expect(JSON.stringify(capabilities.computeProviders)).not.toMatch(/https?:|key|secret|token/i);
    // A configuration that tries to enable remote execution does not start.
    expect(() => env(secret, { COMPUTE_POLICY: JSON.stringify({ remoteExecution: 'ENABLED' }) })).toThrow(/Invalid compute policy/);
  }, 120_000);

  it('is idempotent: repeating a consent returns the same job and never runs the work twice; a new quote is needed for new work', async () => {
    const { projectId, revisionId, quotes, jobs } = await project();
    const quote = (await call(app, 'POST', quotes, { request: { kind: 'OPTIMIZATION_STUDY', revisionId, input: optimizationInput() } })).json();
    const first = await call(app, 'POST', jobs, consentFor(quote));
    expect(first.statusCode, first.body).toBe(202);
    const concurrent = await Promise.all([1, 2, 3].map(() => call(app, 'POST', jobs, consentFor(quote))));
    for (const r of concurrent) expect([r.statusCode, r.json().replayed, r.json().job.id]).toEqual([200, true, first.json().job.id]);
    const done = await settle(`${jobs}/${first.json().job.id}`);
    expect(done.job).toMatchObject({ status: 'SUCCEEDED', result: { resultKind: 'OPTIMIZATION_STUDY' } });
    const replay = await call(app, 'POST', jobs, consentFor(quote));
    expect([replay.statusCode, replay.json().replayed, replay.json().job.id, replay.json().job.status]).toEqual([200, true, first.json().job.id, 'SUCCEEDED']);
    expect((await counts(projectId)).jobs).toBe(1);
    expect((await db.pool.query('select count(*)::int n from project_revision_optimization_studies s join project_revisions r on r.id=s.project_revision_id where r.project_id=$1', [projectId])).rows[0].n).toBe(1);
  }, 120_000);

  it('enforces owner-wide consent and concurrency limits atomically; nothing is created past a limit', async () => {
    const limited = buildApp({ env: env(secret, { LOG_LEVEL: 'silent', COMPUTE_POLICY: JSON.stringify({ maxConsentedPerOwnerPerDay: 2, maxActivePerOwner: 1 }) }),
      backend: createPgBackend(db.pool, { owner: otherId }), captureError: () => undefined, scenePool: new ScenePool({ worker: { url: new URL('../../../test-support/scene-workers/probe.mjs', import.meta.url), execArgv: [], workerData: { mode: 'hang' } }, timeoutMs: 20_000 }) });
    await limited.ready();
    try {
      const a = await project(limited), b = await project(limited);
      const quote = async (p: Json) => (await call(limited, 'POST', p.quotes, { request: { kind: 'SCENE_COMPILE', revisionId: p.revisionId } })).json();
      const qa = await quote(a), qb = await quote(b);
      expect((await call(limited, 'POST', a.jobs, consentFor(qa))).statusCode).toBe(202);
      // The first job hangs in its worker, so it stays active: a second consented job (another project) exceeds maxActivePerOwner = 1.
      const blocked = await call(limited, 'POST', b.jobs, consentFor(qb));
      expect([blocked.statusCode, blocked.json().error.code]).toEqual([429, 'COMPUTE_LIMIT_EXCEEDED']);
      expect(await counts(b.projectId)).toEqual({ jobs: 0, dispatches: 0, scenes: 0 });
      // Cancelling through the B32 route frees the slot; the daily consent cap (2) then stops the third consent.
      const jobId = (await db.pool.query('select job_id from project_compute_dispatches where project_id=$1', [a.projectId])).rows[0].job_id;
      expect((await call(limited, 'POST', `/api/projects/${a.projectId}/jobs/${jobId}/cancel`, {})).statusCode).toBe(200);
      await db.pool.query("update project_jobs set status='CANCELLED', lease_token=null, lease_expires_at=null, finished_at=clock_timestamp() where id=$1 and status='RUNNING'", [jobId]);
      expect((await call(limited, 'POST', b.jobs, consentFor(qb))).statusCode).toBe(202);
      await db.pool.query("update project_jobs set status='CANCELLED', cancel_requested=true, lease_token=null, lease_expires_at=null, finished_at=clock_timestamp() where project_id=$1 and status in ('QUEUED','RUNNING')", [b.projectId]);
      const third = await call(limited, 'POST', a.jobs, consentFor(await quote(a)));
      expect([third.statusCode, third.json().error.code]).toEqual([429, 'COMPUTE_LIMIT_EXCEEDED']);
      expect((await db.pool.query('select count(*)::int n from project_compute_dispatches where owner_id=$1', [otherId])).rows[0].n).toBe(2);
    } finally { await limited.close(); }
  }, 120_000);

  it('never stores a result the engine validator rejects: malformed worker output and typed refusals end in a failed job with no artifact', async () => {
    for (const [mode, code, retryable] of [['refuse', 'SCENE_RESOURCE_LIMIT', false], ['garbage', 'SCENE_WORKER_FAILED', true]] as const) {
      const probe = buildApp({ env: env(secret, { LOG_LEVEL: 'silent' }), backend: createPgBackend(db.pool, { owner: ownerId }), captureError: () => undefined,
        scenePool: new ScenePool({ worker: { url: new URL('../../../test-support/scene-workers/probe.mjs', import.meta.url), execArgv: [], workerData: { mode } } }) });
      await probe.ready();
      try {
        const p = await project(probe);
        const quote = (await call(probe, 'POST', p.quotes, { request: { kind: 'SCENE_COMPILE', revisionId: p.revisionId } })).json();
        const started = await call(probe, 'POST', p.jobs, consentFor(quote));
        expect(started.statusCode, started.body).toBe(202);
        const done = await settle(`${p.jobs}/${started.json().job.id}`, probe, 60_000);
        expect(done.job, mode).toMatchObject({ status: 'FAILED', result: null, failure: { code, retryable } });
        expect(done.resultCheck.status).toBe('NO_RESULT');
        // A transient worker failure is retried within the job's bounded attempts, never beyond them.
        expect(done.job.attempt).toBe(retryable ? 3 : 1);
        expect(await counts(p.projectId)).toEqual({ jobs: 1, dispatches: 1, scenes: 0 });
      } finally { await probe.close(); }
    }
  }, 120_000);

  it('leaves Phase 35 engineering blockers unchanged after a successful gateway job', async () => {
    const { projectId, revisionId, quotes, jobs } = await project();
    const before = (await call(app, 'POST', `/api/projects/${projectId}/revisions/${revisionId}/engineering-assessment`, { scope: ['WIND_LOADS', 'SEISMIC_LOADS', 'MEMBER_DESIGN'] })).json();
    const quote = (await call(app, 'POST', quotes, { request: { kind: 'SCENE_COMPILE', revisionId } })).json();
    const job = (await call(app, 'POST', jobs, consentFor(quote))).json().job;
    expect((await settle(`${jobs}/${job.id}`)).job.status).toBe('SUCCEEDED');
    const after = (await call(app, 'POST', `/api/projects/${projectId}/revisions/${revisionId}/engineering-assessment`, { scope: ['WIND_LOADS', 'SEISMIC_LOADS', 'MEMBER_DESIGN'] })).json();
    expect(after.domains.map((d: Json) => [d.domain, d.status])).toEqual(before.domains.map((d: Json) => [d.domain, d.status]));
    expect(after.domains.every((d: Json) => d.status !== 'EVALUATED')).toBe(true);
    expect(after.domains.flatMap((d: Json) => d.blockers.map((b: Json) => b.kind))).toEqual(expect.arrayContaining(['NO_VALIDATED_SOLVER']));
  }, 120_000);

  it('isolates owners, records immutable consent evidence, refuses forged SQL, and logs without request payloads or secrets', async () => {
    const { projectId, revisionId, quotes, jobs } = await project();
    for (const [method, url, payload] of [['POST', quotes, { request: { kind: 'SCENE_COMPILE', revisionId } }], ['GET', `${jobs}/${randomUUID()}`, undefined]] as const) {
      expect((await call(app, method, url, payload, other)).statusCode, `${method} ${url}`).toBe(404);
      expect((await call(app, method, url, payload, {})).statusCode, `anonymous ${method} ${url}`).toBe(401);
    }
    const quote = (await call(app, 'POST', quotes, { request: { kind: 'SCENE_COMPILE', revisionId } })).json();
    const job = (await call(app, 'POST', jobs, consentFor(quote))).json().job;
    await settle(`${jobs}/${job.id}`);
    expect((await call(app, 'GET', `${jobs}/${job.id}`, undefined, other)).statusCode).toBe(404);
    // A plain B32 job has no consent record, so the gateway does not present it as a gateway job.
    const plain = (await call(app, 'POST', `/api/projects/${projectId}/jobs`, { kind: 'OPTIMIZATION_STUDY', revisionId, input: optimizationInput() })).json();
    expect((await call(app, 'GET', `${jobs}/${plain.id}`)).json().error.code).toBe('COMPUTE_JOB_NOT_FOUND');
    // Consent records are immutable and only their owner can read them.
    await expect(db.pool.query("update project_compute_dispatches set cost_ceiling_minor=0 where job_id=$1", [job.id])).rejects.toBeDefined();
    await expect(db.pool.query('delete from project_compute_dispatches where job_id=$1', [job.id])).rejects.toBeDefined();
    const visible = (user: string) => asPrincipal(db.pool, user, c => c.query('select count(*)::int n from project_compute_dispatches where job_id=$1', [job.id])).then(r => r.rows[0].n);
    expect([await visible(ownerId), await visible(otherId)]).toEqual([1, 0]);
    // compute_write refuses a forged signature and a nested job call that differs from the consented work.
    const input = { projectId, quoteHash: 'b'.repeat(64), kind: 'SCENE_COMPILE', request: { kind: 'SCENE_COMPILE', revisionId }, inputHash: quote.inputHash, placement: 'LOCAL',
      providerId: 'local-pool', sourceRevisionId: revisionId, modelHash: quote.source.modelHash, costClass: 'FREE', costCeilingMinor: 0, currency: 'INR', dataTransfer: 'NONE',
      quote: {}, limits: { maxConsentedPerOwnerPerDay: 50, maxActivePerOwner: 8 } };
    const signed = signProjectCommit(secret, ownerId, '/api/projects/:projectId/compute/jobs', input);
    const jobInput = { action: 'submit', projectId, kind: 'OPTIMIZATION_STUDY', request: { kind: 'OPTIMIZATION_STUDY', revisionId, input: {} }, inputHash: 'c'.repeat(64) };
    const jobSigned = signProjectCommit(secret, ownerId, '/api/projects/:projectId/jobs', jobInput);
    const sql = (envelope: string, signature: string) => asPrincipal(db.pool, ownerId, c => c.query('select public.compute_write($1,$2,$3,$4,$5)',
      ['submit', JSON.stringify(input), JSON.stringify({ p_action: 'submit', p_input: jobInput, p_envelope: jobSigned.envelope, p_signature: jobSigned.signature }), envelope, signature]));
    await expect(sql(signed.envelope, 'f'.repeat(64))).rejects.toMatchObject({ code: '42501' });
    await expect(sql(signed.envelope, signed.signature)).rejects.toMatchObject({ code: '42501' });
    expect((await db.pool.query('select count(*)::int n from project_compute_dispatches where quote_hash=$1', ['b'.repeat(64)])).rows[0].n).toBe(0);
    const gatewayLogs = logs.filter(l => ['compute quote issued', 'compute dispatch consented', 'compute job polled'].includes(l.msg));
    expect(gatewayLogs.some(l => l.msg === 'compute dispatch consented' && l.jobId === job.id && l.providerId === 'local-pool' && l.quoteHash === quote.quoteHash)).toBe(true);
    const text = JSON.stringify(gatewayLogs);
    expect(text).not.toContain(secret);
    expect(text).not.toContain('"request"');
  }, 120_000);
});

describe('Phase 36 migration 0025 on a populated 0024 database', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>;
  afterAll(async () => { await db?.stop(); });
  it('applies additively: existing jobs and their rows are unchanged, and the gateway works afterwards', async () => {
    db = await startTestDatabase({ migrations: name => name < '0025' });
    const ownerId = await createTestUser(db.pool), secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret as string;
    const app = buildApp({ env: env(secret, { LOG_LEVEL: 'silent' }), backend: createPgBackend(db.pool, { owner: ownerId }), captureError: () => undefined });
    await app.ready();
    try {
      const p = await call(app, 'POST', '/api/projects', { title: 'Upgrade' });
      const projectId = p.json().id, revisionId = (await call(app, 'POST', `/api/projects/${projectId}/revisions/generate`, { requirements: parametricInput(true) })).json().revision.id;
      const job = (await call(app, 'POST', `/api/projects/${projectId}/jobs`, { kind: 'SCENE_COMPILE', revisionId })).json();
      await app.close().catch(() => undefined);
      const before = (await db.pool.query('select md5(string_agg(t::text, \'|\' order by t.id)) d from project_jobs t')).rows[0].d;
      await db.pool.query(`begin;\n${await readFile(new URL('../../../supabase/migrations/0025_compute_gateway.sql', import.meta.url), 'utf8')}\ncommit;`);
      expect((await db.pool.query('select md5(string_agg(t::text, \'|\' order by t.id)) d from project_jobs t')).rows[0].d).toBe(before);
      expect((await db.pool.query('select count(*)::int n from project_jobs where id=$1', [job.id])).rows[0].n).toBe(1);
      const after = buildApp({ env: env(secret, { LOG_LEVEL: 'silent' }), backend: createPgBackend(db.pool, { owner: ownerId }), captureError: () => undefined });
      await after.ready();
      try {
        const quote = (await call(after, 'POST', `/api/projects/${projectId}/compute/quotes`, { request: { kind: 'OPTIMIZATION_STUDY', revisionId, input: optimizationInput() } })).json();
        const r = await call(after, 'POST', `/api/projects/${projectId}/compute/jobs`, consentFor(quote));
        expect(r.statusCode, r.body).toBe(202);
      } finally { await after.close(); }
    } finally { await app.close().catch(() => undefined); }
  }, 180_000);
});
