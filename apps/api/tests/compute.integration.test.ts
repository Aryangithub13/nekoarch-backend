import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { asPrincipal, createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { optimizationInput } from '../../../test-support/optimization-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { signProjectCommit } from '../src/services/project-service.js';
import { signedJobSubmission } from '../src/services/job-service.js';
import { quoteSignature } from '../src/compute/gateway.js';
import { computeDatabaseError } from '../src/lib/compute-repository.js';
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

  /** Re-signs a changed quote with the server key: what the server would have issued, so only the defensive checks after the signature can refuse it. */
  const reissued = (quote: Json, change: Json) => {
    const { quoteHash: _hash, ...content } = { ...quote, ...change };
    return { ...content, quoteHash: quoteSignature(secret, ownerId, content as Parameters<typeof quoteSignature>[2]) };
  };
  /** The signed compute_write call the gateway makes, issued directly (no runner dispatch afterwards), with optional changes to the consent input. */
  const sqlConsent = (quote: Json, change: Json = {}) => {
    const { request: _request, ...stored } = quote;
    const input = { projectId: quote.projectId, quoteHash: quote.quoteHash, kind: quote.kind, request: quote.request, inputHash: quote.inputHash, placement: 'LOCAL',
      providerId: 'local-pool', sourceRevisionId: quote.source.revisionId, modelHash: quote.source.modelHash, costClass: 'FREE', costCeilingMinor: 0, currency: 'INR',
      dataTransfer: 'NONE', quote: stored, limits: { maxConsentedPerOwnerPerDay: 50, maxActivePerOwner: 8 }, ...change };
    const job = signedJobSubmission(ownerId, input.projectId, input.request, secret), signed = signProjectCommit(secret, ownerId, '/api/projects/:projectId/compute/jobs', input);
    return asPrincipal(db.pool, ownerId, c => c.query('select public.compute_write($1,$2,$3,$4,$5) r', ['submit', JSON.stringify(input),
      JSON.stringify({ p_action: 'submit', p_input: job.input, p_envelope: job.attestation.envelope, p_signature: job.attestation.signature }), signed.envelope, signed.signature]))
      .then(r => r.rows[0].r as Json);
  };
  const mapped = (error: unknown) => { try { computeDatabaseError(error as { code?: string }); } catch (e) { return [(e as Json).statusCode, (e as Json).code]; } };

  it('refuses expired and stale quotes, including a replay after expiry, and creates no job or consent record', async () => {
    const { projectId, revisionId, quotes, jobs } = await project();
    const quote = (await call(app, 'POST', quotes, { request: { kind: 'SCENE_COMPILE', revisionId } })).json();
    const refused = async (payload: unknown, code: string) => {
      const r = await call(app, 'POST', jobs, payload);
      expect([r.statusCode, r.json().error.code]).toEqual([409, code]);
    };
    // Issued by this server two hours ago with the default 900 s TTL.
    const issued = Date.now() - 7_200_000;
    await refused(consentFor(reissued(quote, { issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + 900_000).toISOString() })), 'COMPUTE_QUOTE_EXPIRED');
    // Signed by this server but naming a model hash the revision does not have (revisions are immutable, so only a defect could produce this).
    await refused(consentFor(reissued(quote, { source: { ...quote.source, modelHash: 'e'.repeat(64) } })), 'COMPUTE_QUOTE_STALE');
    expect(await counts(projectId)).toEqual({ jobs: 0, dispatches: 0, scenes: 0 });
    // A consent repeated after its quote expired is refused before the database: it neither replays nor starts new work.
    const first = await call(app, 'POST', jobs, consentFor(quote));
    expect(first.statusCode, first.body).toBe(202);
    await settle(`${jobs}/${first.json().job.id}`);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.parse(quote.expiresAt) + 1000);
      await refused(consentFor(quote), 'COMPUTE_QUOTE_EXPIRED');
    } finally { vi.useRealTimers(); }
    expect(await counts(projectId)).toEqual({ jobs: 1, dispatches: 1, scenes: 1 });
  }, 120_000);

  it('runs concurrent first consents exactly once and rejects reuse of a quote hash for other work at the database boundary', async () => {
    const { projectId, revisionId, quotes, jobs } = await project();
    const quote = (await call(app, 'POST', quotes, { request: { kind: 'SCENE_COMPILE', revisionId } })).json();
    const racing = await Promise.all([1, 2, 3, 4].map(() => call(app, 'POST', jobs, consentFor(quote))));
    expect(racing.map(r => r.statusCode).sort()).toEqual([200, 200, 200, 202]);
    expect(new Set(racing.map(r => r.json().job.id)).size).toBe(1);
    expect(racing.filter(r => r.json().replayed).length).toBe(3);
    const jobId = racing.find(r => r.statusCode === 202)!.json().job.id;
    await settle(`${jobs}/${jobId}`);
    expect(await counts(projectId)).toEqual({ jobs: 1, dispatches: 1, scenes: 1 });
    // The same quote hash for different input, or on another of the owner's projects: P3602 → 409 COMPUTE_QUOTE_CONFLICT, nothing written.
    const other = await project();
    for (const change of [{ inputHash: 'f'.repeat(64) }, { projectId: other.projectId }]) {
      const error = await sqlConsent(quote, change).then(() => null, e => e);
      expect(error?.code, JSON.stringify(change)).toBe('P3602');
      expect(mapped(error)).toEqual([409, 'COMPUTE_QUOTE_CONFLICT']);
    }
    // The identical signed call is a replay of the recorded consent, not new work.
    expect(await sqlConsent(quote)).toMatchObject({ replayed: true, job: { id: jobId }, dispatch: { quoteHash: quote.quoteHash } });
    expect(await counts(projectId)).toEqual({ jobs: 1, dispatches: 1, scenes: 1 });
    expect(await counts(other.projectId)).toEqual({ jobs: 0, dispatches: 0, scenes: 0 });
  }, 120_000);

  it('commits the job and its consent record together: a failure after the nested submission rolls both back', async () => {
    const { projectId, revisionId, quotes } = await project();
    const quote = (await call(app, 'POST', quotes, { request: { kind: 'SCENE_COMPILE', revisionId } })).json();
    // The nested B32 job_write succeeds, then the consent insert violates its size check (23514): the job insert is rolled back with it.
    const oversized = { ...quote, padding: 'x'.repeat(20_000) };
    const { request: _request, ...stored } = oversized;
    await expect(sqlConsent(quote, { quote: stored })).rejects.toMatchObject({ code: '23514' });
    expect(await counts(projectId)).toEqual({ jobs: 0, dispatches: 0, scenes: 0 });
    expect((await db.pool.query("select count(*)::int n from project_job_events e join project_jobs j on j.id=e.job_id where j.project_id=$1", [projectId])).rows[0].n).toBe(0);
  }, 120_000);

  it('recovers a consented job whose dispatch was lost: polling starts it, once', async () => {
    const { projectId, revisionId, quotes, jobs } = await project();
    const quote = (await call(app, 'POST', quotes, { request: { kind: 'SCENE_COMPILE', revisionId } })).json();
    // The transaction committed but the process never dispatched (e.g. it stopped right after the commit).
    const committed = await sqlConsent(quote);
    expect(committed).toMatchObject({ replayed: false, job: { status: 'QUEUED' } });
    expect((await db.pool.query('select status from project_jobs where id=$1', [committed.job.id])).rows[0].status).toBe('QUEUED');
    const done = await settle(`${jobs}/${committed.job.id}`);
    expect(done).toMatchObject({ job: { status: 'SUCCEEDED', attempt: 1 }, resultCheck: { status: 'ACCEPTED_BY_SERVICE_VALIDATOR' } });
    // A repeated HTTP consent for the recovered job replays it.
    const replay = await call(app, 'POST', jobs, consentFor(quote));
    expect([replay.statusCode, replay.json().job.id]).toEqual([200, committed.job.id]);
    expect(await counts(projectId)).toEqual({ jobs: 1, dispatches: 1, scenes: 1 });
  }, 120_000);

  it('keeps B32 limits and deduplication in force under the gateway: owner-wide gateway limits add to them, never replace them', async () => {
    const hanging = buildApp({ env: env(secret, { LOG_LEVEL: 'silent', COMPUTE_POLICY: JSON.stringify({ maxActivePerOwner: 8 }) }), backend: createPgBackend(db.pool, { owner: ownerId }),
      captureError: () => undefined, scenePool: new ScenePool({ worker: { url: new URL('../../../test-support/scene-workers/probe.mjs', import.meta.url), execArgv: [], workerData: { mode: 'hang' } }, timeoutMs: 20_000 }) });
    await hanging.ready();
    const a = await project(hanging), b = await project(hanging);
    try {
      // Two quotes for identical work: while the first job is active, the second consent is deduplicated by B32 onto the same job.
      const q1 = (await call(hanging, 'POST', a.quotes, { request: { kind: 'SCENE_COMPILE', revisionId: a.revisionId } })).json();
      await new Promise(r => setTimeout(r, 5));
      const q2 = (await call(hanging, 'POST', a.quotes, { request: { kind: 'SCENE_COMPILE', revisionId: a.revisionId } })).json();
      expect(q2.quoteHash).not.toBe(q1.quoteHash);
      const r1 = await call(hanging, 'POST', a.jobs, consentFor(q1)), r2 = await call(hanging, 'POST', a.jobs, consentFor(q2));
      expect([r1.statusCode, r2.statusCode, r2.json().replayed, r2.json().job.deduplicated]).toEqual([202, 202, false, true]);
      expect(r2.json().job.id).toBe(r1.json().job.id);
      expect(await counts(a.projectId)).toEqual({ jobs: 1, dispatches: 2, scenes: 0 });
      // B32's per-project active limit (4) still applies inside the gateway transaction; the refused consent leaves no record.
      await db.pool.query(`insert into project_jobs(project_id,owner_id,kind,status,job_version,request_json,input_hash,progress_json)
        select $1,$2,'SCENE_COMPILE','QUEUED','durable-job-v1',jsonb_build_object('kind','SCENE_COMPILE','revisionId',$3::text),encode(sha256(convert_to(g::text,'UTF8')),'hex'),
        project_private.job_progress('QUEUED',0,'Queued') from generate_series(1,4) g`, [b.projectId, ownerId, b.revisionId]);
      const qb = (await call(hanging, 'POST', b.quotes, { request: { kind: 'SCENE_COMPILE', revisionId: b.revisionId } })).json();
      const limited = await call(hanging, 'POST', b.jobs, consentFor(qb));
      expect([limited.statusCode, limited.json().error.code]).toEqual([429, 'JOB_LIMIT_EXCEEDED']);
      expect(await counts(b.projectId)).toEqual({ jobs: 4, dispatches: 0, scenes: 0 });
    } finally {
      await db.pool.query("update project_jobs set status='CANCELLED', cancel_requested=true, lease_token=null, lease_expires_at=null, finished_at=clock_timestamp() where project_id = any($1) and status in ('QUEUED','RUNNING')",
        [[a.projectId, b.projectId]]);
      await hanging.close();
    }
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
