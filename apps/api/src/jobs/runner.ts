import type { FastifyBaseLogger } from 'fastify';
import type { Repository } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { JobRepository } from '../lib/job-repository.js';
import { signProjectCommit } from '../services/project-service.js';
import { JOB_LIMITS, STAGE_PERCENT, type JobKind, type JobRequest, type JobResult } from './contracts.js';

/** Thrown at a stage boundary when the owner asked to cancel; nothing after that boundary is persisted. */
export class JobCancelled extends Error {
  constructor() { super('Job cancelled'); this.name = 'JobCancelled'; }
}
export interface ExecutionContext {
  repository: Repository; userId: string; projectId: string; request: JobRequest;
  /** Call between computation and persistence: records PERSISTING, or throws JobCancelled if a cancel was observed. Synchronous by design (pool `onRun` hooks). */
  computed(): void;
}
export type Executor = (context: ExecutionContext) => Promise<JobResult>;
export type JobFailure = { code: string; message: string; retryable: boolean };

// A worker timeout or crash during revision execution is recorded on the operation as FAILED (Phase 30), so a retry cannot succeed.
const PERMANENT_SERVER_ERRORS: Readonly<Record<JobKind, readonly string[]>> = Object.freeze({
  SCENE_COMPILE: [], OPTIMIZATION_STUDY: [], REVISION_EXECUTE: ['REVISION_WORKER_TIMEOUT', 'REVISION_WORKER_FAILED'] });

/**
 * Transient: a typed server error (capacity, timeout, crash, database availability) unless the operation records it as final.
 * Permanent: every 4xx (invalid input, unsupported model, not accepted, conflict), missing configuration, and untyped exceptions
 * (an unexpected exception is a defect: retrying it would only repeat it, and its message is never exposed).
 */
export function classifyFailure(kind: JobKind, error: unknown): JobFailure {
  if (error instanceof ApiError) {
    const unconfigured = error.statusCode === 503 && /not configured/i.test(error.message);
    return { code: error.code.slice(0, 64), message: error.message.slice(0, 300),
      retryable: error.statusCode >= 500 && !unconfigured && !PERMANENT_SERVER_ERRORS[kind].includes(error.code) };
  }
  return { code: 'JOB_EXECUTOR_FAILED', message: 'The job failed unexpectedly', retryable: false };
}

interface Active { cancel: boolean; release: () => Promise<void>; done: Promise<void> }

/**
 * Runs durable jobs in this process with the credentials of the request that dispatched them. State lives in SQL: `start`
 * is a compare-and-set that issues a lease token, and every later write presents it, so a stale worker is fenced off.
 */
export class JobRunner {
  private readonly active = new Map<string, Active>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private closing = false;
  constructor(private readonly options: { secret?: string | undefined; executors: Record<JobKind, Executor>; log?: FastifyBaseLogger;
    heartbeatMs?: number; shutdownGraceMs?: number }) {}

  isActive(jobId: string) { return this.active.has(jobId); }
  /** Local fast path for a cancel; other processes observe it through the next heartbeat or progress write. */
  requestCancel(jobId: string) { const job = this.active.get(jobId); if (job) job.cancel = true; }
  /** Settles when every job dispatched so far has finished (tests and shutdown). */
  async idle() { while (this.active.size) await Promise.allSettled([...this.active.values()].map(a => a.done)); }

  dispatch(repository: Repository, userId: string, projectId: string, jobId: string) {
    if (this.closing || !this.options.secret || this.active.has(jobId)) return;
    const entry: Active = { cancel: false, release: async () => undefined, done: Promise.resolve() };
    this.active.set(jobId, entry);
    entry.done = this.run(entry, repository, userId, projectId, jobId)
      .catch(error => this.options.log?.warn({ jobId, code: error instanceof ApiError ? error.code : 'JOB_RUNNER_ERROR' }, 'job runner stopped'))
      .finally(() => this.active.delete(jobId));
  }

  private async run(entry: Active, repository: Repository, userId: string, projectId: string, jobId: string) {
    const secret = this.options.secret!, jobs = new JobRepository(repository);
    const sign = (input: Record<string, unknown>) => signProjectCommit(secret, userId, 'job-runner', input);
    let lease;
    try { const input = { action: 'start', projectId, jobId }; lease = await jobs.lease(input, sign(input)); }
    catch (error) {
      // Not startable here (already running elsewhere, finished, cancelled or backing off): nothing to do.
      if (error instanceof ApiError && error.statusCode === 409) return;
      throw error;
    }
    entry.cancel ||= lease.cancelRequested;
    let lost = false, chain: Promise<unknown> = Promise.resolve();
    // Runner writes are serialized so progress events keep their order; a lost lease (P3203) stops every later write.
    const write = (action: 'progress' | 'heartbeat' | 'complete' | 'fail' | 'cancelled' | 'release', extra: Record<string, unknown> = {}) => {
      chain = chain.then(async () => {
        if (lost) return;
        const input = { action, projectId, jobId, leaseToken: lease.leaseToken, ...extra };
        try {
          const reply = await jobs.write(action, input, sign(input)) as { cancelRequested?: boolean; status?: string; notBefore?: string };
          if (reply?.cancelRequested) entry.cancel = true;
          if (action === 'fail' && reply?.status === 'QUEUED' && reply.notBefore) this.retryLater(repository, userId, projectId, jobId, Date.parse(reply.notBefore));
        } catch (error) {
          if (error instanceof ApiError && error.code === 'JOB_LEASE_LOST') lost = true;
          else throw error;
        }
      });
      return chain;
    };
    const stage = (name: 'COMPUTING' | 'PERSISTING', message: string) => void write('progress', { progress: { stage: name, percent: STAGE_PERCENT[name], message } }).catch(() => undefined);
    const heartbeat = setInterval(() => void write('heartbeat').catch(() => undefined), this.options.heartbeatMs ?? JOB_LIMITS.heartbeatMs);
    entry.release = async () => { await write('release').catch(() => undefined); };
    try {
      if (entry.cancel) throw new JobCancelled();
      stage('COMPUTING', 'Running the operation');
      const result = await this.options.executors[lease.kind]({ repository, userId, projectId, request: lease.request,
        computed: () => { if (entry.cancel) throw new JobCancelled(); stage('PERSISTING', 'Storing the verified result'); } });
      clearInterval(heartbeat);
      await write('complete', { result });
    } catch (error) {
      clearInterval(heartbeat);
      // A failure caused by shutdown (pools closing) is not the job's fault: hand the attempt back instead of failing it.
      if (this.closing && !(error instanceof JobCancelled)) await write('release');
      else if (error instanceof JobCancelled) await write('cancelled');
      else await write('fail', { failure: classifyFailure(lease.kind, error) });
    } finally {
      clearInterval(heartbeat);
      await chain.catch(() => undefined);
    }
  }

  /** Automatic retry after the SQL-chosen backoff, with the same credentials; a poll would also recover it. */
  private retryLater(repository: Repository, userId: string, projectId: string, jobId: string, at: number) {
    if (this.closing) return;
    const timer = setTimeout(() => { this.timers.delete(timer); this.dispatch(repository, userId, projectId, jobId); }, Math.max(0, at - Date.now()) + 50);
    timer.unref();
    this.timers.add(timer);
  }

  /** Stop taking work, give running jobs a short grace period, then hand unfinished ones back to the queue. */
  async close() {
    this.closing = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    const grace = new Promise<void>(resolve => { const t = setTimeout(resolve, this.options.shutdownGraceMs ?? JOB_LIMITS.shutdownGraceMs); t.unref(); });
    await Promise.race([Promise.allSettled([...this.active.values()].map(a => a.done)), grace]);
    await Promise.allSettled([...this.active.values()].map(a => a.release()));
  }
}
