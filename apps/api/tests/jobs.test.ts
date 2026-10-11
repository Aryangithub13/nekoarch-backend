import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../src/lib/errors.js';
import type { Repository } from '../src/lib/repository.js';
import { JobRunner, classifyFailure, type Executor } from '../src/jobs/runner.js';
import { JobRequestSchema, type JobKind } from '../src/jobs/contracts.js';

const SECRET = 'ab'.repeat(32), projectId = randomUUID(), revisionId = randomUUID();
const result = { resultKind: 'SCENE_ARTIFACT' as const, resultId: randomUUID(), href: `/api/projects/${projectId}/revisions/${revisionId}/scene/artifacts/x` };

/** A scripted stand-in for job_write: records every runner action, issues a lease on start and reports a cancel flag on progress/heartbeat. */
function fake(options: { startError?: ApiError; cancelled?: boolean; cancelOnProgress?: boolean; loseLeaseOn?: string; kind?: JobKind } = {}) {
  const actions: { action: string; input: Record<string, unknown> }[] = [], jobId = randomUUID(), leaseToken = randomUUID(), now = new Date().toISOString();
  let cancel = options.cancelled ?? false;
  const repository = { jobRpc: async (_name: string, args: Record<string, unknown>) => {
    const action = String(args.p_action), input = args.p_input as Record<string, unknown>;
    actions.push({ action, input });
    if (action === options.loseLeaseOn) throw new ApiError(409, 'JOB_LEASE_LOST', 'The job lease is no longer held');
    if (action === 'start') {
      if (options.startError) throw options.startError;
      return { id: jobId, projectId, ownerId: randomUUID(), kind: options.kind ?? 'SCENE_COMPILE', status: 'RUNNING', jobVersion: 'durable-job-v1', inputHash: 'c'.repeat(64),
        attempt: 1, maxAttempts: 3, userRetries: 0, notBefore: now, leaseExpiresAt: now, cancelRequested: cancel, progress: { stage: 'VALIDATING', percent: 10, message: 'v' },
        result: null, failure: null, lastFailure: null, createdAt: now, updatedAt: now, finishedAt: null, request: { kind: 'SCENE_COMPILE', revisionId }, leaseToken };
    }
    if (action === 'progress' && options.cancelOnProgress) cancel = true;
    return { cancelRequested: cancel, status: action === 'fail' ? 'FAILED' : 'RUNNING' };
  } } as unknown as Repository;
  return { repository, actions, jobId, leaseToken, names: () => actions.map(a => a.action === 'progress' ? `progress:${(a.input.progress as { stage: string }).stage}` : a.action) };
}
const runner = (executor: Executor, extra: Partial<ConstructorParameters<typeof JobRunner>[0]> = {}) =>
  new JobRunner({ secret: SECRET, heartbeatMs: 60_000, executors: { SCENE_COMPILE: executor, OPTIMIZATION_STUDY: executor, REVISION_EXECUTE: executor }, ...extra });
async function run(r: JobRunner, f: ReturnType<typeof fake>) { r.dispatch(f.repository, randomUUID(), projectId, f.jobId); await r.idle(); }

describe('Phase 32 failure classification', () => {
  it.each([
    ['SCENE_COMPILE', new ApiError(503, 'SCENE_QUEUE_FULL', 'Scene capacity is exhausted'), true],
    ['SCENE_COMPILE', new ApiError(503, 'SCENE_WORKER_TIMEOUT', 'timeout'), true],
    ['SCENE_COMPILE', new ApiError(500, 'DATABASE_ERROR', 'The database operation could not be completed'), true],
    ['REVISION_EXECUTE', new ApiError(503, 'REVISION_QUEUE_FULL', 'full'), true],
    ['REVISION_EXECUTE', new ApiError(503, 'REVISION_WORKER_TIMEOUT', 'timeout'), false], // the operation is already recorded FAILED
    ['REVISION_EXECUTE', new ApiError(503, 'REVISION_WORKER_FAILED', 'crash'), false],
    ['SCENE_COMPILE', new ApiError(503, 'SCENE_UNAVAILABLE', 'Scene persistence is not configured'), false],
    ['OPTIMIZATION_STUDY', new ApiError(400, 'OPTIMIZATION_INPUT_INVALID', 'bad'), false],
    ['SCENE_COMPILE', new ApiError(422, 'REVISION_NOT_ACCEPTED', 'not accepted'), false],
    ['SCENE_COMPILE', new ApiError(409, 'REVISION_CONFLICT', 'moved'), false],
  ] as const)('%s %s → retryable %s', (kind, error, retryable) => {
    expect(classifyFailure(kind, error)).toEqual({ code: error.code, message: error.message, retryable });
  });
  it('never exposes an untyped exception and never retries it', () => {
    expect(classifyFailure('SCENE_COMPILE', new Error('secret internals at /srv/x'))).toEqual({ code: 'JOB_EXECUTOR_FAILED', message: 'The job failed unexpectedly', retryable: false });
  });
  it('accepts only the documented, strict job requests', () => {
    const ok = [{ kind: 'SCENE_COMPILE', revisionId }, { kind: 'OPTIMIZATION_STUDY', revisionId, input: {} },
      { kind: 'REVISION_EXECUTE', operationId: revisionId, preflightHash: 'a'.repeat(64), consent: { acceptLocks: true, acceptQuote: true } }];
    const bad = [{ kind: 'RENDER', revisionId }, { kind: 'SCENE_COMPILE', revisionId, extra: 1 }, { kind: 'SCENE_COMPILE', revisionId: 'x' },
      { kind: 'REVISION_EXECUTE', operationId: revisionId, preflightHash: 'a'.repeat(64), consent: { acceptLocks: false, acceptQuote: true } }];
    expect([...ok.map(v => JobRequestSchema.safeParse(v).success), ...bad.map(v => JobRequestSchema.safeParse(v).success)]).toEqual([true, true, true, false, false, false, false]);
  });
});

describe('Phase 32 job runner', () => {
  it('runs start → COMPUTING → PERSISTING → complete, every write fenced with the lease token', async () => {
    const f = fake();
    await run(runner(async ({ computed }) => { computed(); return result; }), f);
    expect(f.names()).toEqual(['start', 'progress:COMPUTING', 'progress:PERSISTING', 'complete']);
    expect(f.actions.slice(1).every(a => a.input.leaseToken === f.leaseToken)).toBe(true);
    expect(f.actions.at(-1)!.input.result).toEqual(result);
  });
  it('honours a cancel at the compute → persist boundary: nothing is persisted', async () => {
    const f = fake({ cancelOnProgress: true });
    let persisted = 0;
    await run(runner(async ({ computed }) => { await new Promise(r => setTimeout(r, 20)); computed(); persisted++; return result; }), f);
    expect([f.names().at(-1), persisted]).toEqual(['cancelled', 0]);
  });
  it('a job cancelled before it starts never reaches its executor', async () => {
    const f = fake({ cancelled: true });
    let called = false;
    await run(runner(async () => { called = true; return result; }), f);
    expect([called, f.names()]).toEqual([false, ['start', 'cancelled']]);
  });
  it('records typed failures with their retry class', async () => {
    const transient = fake(), permanent = fake(), unexpected = fake();
    await run(runner(async () => { throw new ApiError(503, 'SCENE_QUEUE_FULL', 'full'); }), transient);
    await run(runner(async () => { throw new ApiError(422, 'SCENE_UNSUPPORTED_MODEL', 'unsupported'); }), permanent);
    await run(runner(async () => { throw new Error('boom'); }), unexpected);
    expect([transient, permanent, unexpected].map(f => f.actions.at(-1)!.input.failure)).toEqual([
      { code: 'SCENE_QUEUE_FULL', message: 'full', retryable: true }, { code: 'SCENE_UNSUPPORTED_MODEL', message: 'unsupported', retryable: false },
      { code: 'JOB_EXECUTOR_FAILED', message: 'The job failed unexpectedly', retryable: false }]);
  });
  it('stops writing once the lease is lost (fenced by another process)', async () => {
    const f = fake({ loseLeaseOn: 'progress' });
    await run(runner(async ({ computed }) => { computed(); return result; }), f);
    expect(f.names()).toEqual(['start', 'progress:COMPUTING']);
  });
  it('does nothing when the job is not startable here', async () => {
    const f = fake({ startError: new ApiError(409, 'JOB_INVALID_TRANSITION', 'not startable') });
    let called = false;
    await run(runner(async () => { called = true; return result; }), f);
    expect([called, f.names()]).toEqual([false, ['start']]);
  });
  it('dispatches a job at most once per process and not at all without the commit secret', async () => {
    const f = fake();
    let calls = 0;
    const r = runner(async () => { calls++; await new Promise(res => setTimeout(res, 20)); return result; });
    r.dispatch(f.repository, randomUUID(), projectId, f.jobId); r.dispatch(f.repository, randomUUID(), projectId, f.jobId);
    await r.idle();
    const unconfigured = runner(async () => { calls++; return result; }, { secret: undefined }), g = fake();
    unconfigured.dispatch(g.repository, randomUUID(), projectId, g.jobId);
    await unconfigured.idle();
    expect([calls, g.actions.length]).toEqual([1, 0]);
  });
  it('heartbeats while an executor runs', async () => {
    const f = fake();
    await run(runner(async () => { await new Promise(r => setTimeout(r, 120)); return result; }, { heartbeatMs: 25 }), f);
    expect(f.names().filter(n => n === 'heartbeat').length).toBeGreaterThanOrEqual(2);
  });
  it('on shutdown, hands a still-running job back to the queue instead of failing it', async () => {
    const f = fake();
    let finish: () => void = () => undefined;
    const r = runner(async () => { await new Promise<void>(res => { finish = res; }); throw new ApiError(503, 'SCENE_UNAVAILABLE', 'The scene pool is shutting down'); }, { shutdownGraceMs: 30 });
    r.dispatch(f.repository, randomUUID(), projectId, f.jobId);
    await new Promise(res => setTimeout(res, 10));
    await r.close();
    finish();
    await r.idle();
    expect(f.names()).toContain('release');
    expect(f.names()).not.toContain('fail');
    r.dispatch(f.repository, randomUUID(), projectId, randomUUID()); // closed: refuses new work
    expect(r.isActive(f.jobId)).toBe(false);
  });
});
