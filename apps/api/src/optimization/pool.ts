import { availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { OPTIMIZATION_LIMITS, OptimizationError, StudySchema, type OptimizationSource, type Study } from './contracts.js';
import type { WorkerJob, WorkerReply } from './worker.js';

export type PoolErrorCode = 'OPTIMIZATION_QUEUE_FULL' | 'OPTIMIZATION_WORKER_TIMEOUT' | 'OPTIMIZATION_WORKER_FAILED' | 'OPTIMIZATION_UNAVAILABLE';
export class OptimizationPoolError extends Error {
  constructor(readonly code: PoolErrorCode, message: string) { super(message); this.name = 'OptimizationPoolError'; }
}
export interface PoolOptions {
  size?: number; queueLimit?: number; timeoutMs?: number; maxOldGenerationSizeMb?: number;
  /** Tests only: an alternative worker script (crash/hang probes). */
  worker?: { url: URL; execArgv: string[]; workerData?: unknown };
}
// Conservative, bootstrap-friendly sizing: leave a core for the Fastify event loop; never more than two concurrent studies.
export const POOL_DEFAULTS = Object.freeze({ size: Math.max(1, Math.min(2, availableParallelism() - 1)), queueLimit: 4,
  timeoutMs: OPTIMIZATION_LIMITS.deadlineMs + 15_000, maxOldGenerationSizeMb: 512 });
const ownWorker = () => {
  const ts = import.meta.url.endsWith('.ts'); // source (tests, tsx) vs compiled dist
  return { url: new URL(ts ? './worker.ts' : './worker.js', import.meta.url), execArgv: ts ? ['--import', 'tsx'] : [] };
};

export interface PoolResult { study: Study; timingsMs: Record<string, number>; queueMs: number; workerMs: number }
interface Job { id: number; message: WorkerJob; queuedAt: number; resolve: (value: PoolResult) => void; reject: (error: Error) => void }
interface Slot { worker: Worker; job: Job | null; startedAt: number; timer: NodeJS.Timeout | null }

/** Fixed-size worker pool with a bounded queue. A failed, crashed or timed-out worker never yields a study. */
export class OptimizationPool {
  private readonly options: Required<Omit<PoolOptions, 'worker'>> & { worker: { url: URL; execArgv: string[]; workerData?: unknown } };
  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];
  private readonly pending = new Set<Promise<PoolResult>>();
  private nextId = 1;
  private closed = false;
  constructor(options: PoolOptions = {}) {
    this.options = { ...POOL_DEFAULTS, ...options, worker: options.worker ?? ownWorker() };
    const { size, queueLimit, timeoutMs } = this.options;
    if (!Number.isInteger(size) || size < 1 || size > 8 || !Number.isInteger(queueLimit) || queueLimit < 0 || !(timeoutMs > 0)) throw new RangeError('Invalid optimization pool bounds');
  }
  stats() { return { size: this.options.size, workers: this.slots.length, busy: this.slots.filter(s => s.job).length, queued: this.queue.length, closed: this.closed }; }

  run(source: OptimizationSource, input: unknown): Promise<PoolResult> {
    if (this.closed) return Promise.reject(new OptimizationPoolError('OPTIMIZATION_UNAVAILABLE', 'The optimization pool is shutting down'));
    const capacity = this.slots.some(s => !s.job) || this.slots.length < this.options.size;
    if (!capacity && this.queue.length >= this.options.queueLimit) return Promise.reject(new OptimizationPoolError('OPTIMIZATION_QUEUE_FULL', 'Optimization capacity is exhausted; retry later'));
    const promise = new Promise<PoolResult>((resolve, reject) => {
      const id = this.nextId++;
      this.queue.push({ id, message: { id, source, input }, queuedAt: performance.now(), resolve, reject });
    });
    this.pending.add(promise);
    void promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise));
    this.dispatch();
    return promise;
  }

  /** Graceful: queued studies are refused, running studies finish (bounded by the timeout), then workers exit. */
  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.queue.splice(0)) job.reject(new OptimizationPoolError('OPTIMIZATION_UNAVAILABLE', 'The optimization pool is shutting down'));
    await Promise.allSettled([...this.pending]);
    await Promise.all(this.slots.splice(0).map(s => s.worker.terminate()));
  }

  private spawn(): Slot {
    const { url, execArgv, workerData } = this.options.worker;
    const worker = new Worker(url, { execArgv, workerData, resourceLimits: { maxOldGenerationSizeMb: this.options.maxOldGenerationSizeMb } });
    const slot: Slot = { worker, job: null, startedAt: 0, timer: null };
    worker.on('message', (reply: WorkerReply) => this.settle(slot, reply));
    worker.on('error', () => this.fail(slot, new OptimizationPoolError('OPTIMIZATION_WORKER_FAILED', 'The optimization worker failed')));
    worker.on('exit', () => this.fail(slot, new OptimizationPoolError('OPTIMIZATION_WORKER_FAILED', 'The optimization worker exited')));
    worker.unref();
    this.slots.push(slot);
    return slot;
  }

  private dispatch(): void {
    while (this.queue.length) {
      const slot = this.slots.find(s => !s.job) ?? (this.slots.length < this.options.size ? this.spawn() : null);
      if (!slot) return;
      const job = this.queue.shift()!;
      slot.job = job; slot.startedAt = performance.now();
      slot.timer = setTimeout(() => this.fail(slot, new OptimizationPoolError('OPTIMIZATION_WORKER_TIMEOUT', 'The optimization study exceeded its execution ceiling')),
        this.options.timeoutMs);
      slot.worker.ref();
      slot.worker.postMessage(job.message);
    }
  }

  private release(slot: Slot): Job | null {
    const job = slot.job;
    if (slot.timer) clearTimeout(slot.timer);
    slot.job = null; slot.timer = null; slot.worker.unref();
    return job;
  }

  private settle(slot: Slot, reply: WorkerReply): void {
    if (!slot.job || slot.job.id !== reply.id) return;
    const workerMs = performance.now() - slot.startedAt, job = this.release(slot)!, queueMs = slot.startedAt - job.queuedAt;
    if (!reply.ok) job.reject(new OptimizationError(reply.error.code as OptimizationError['code'], reply.error.message, reply.error.details));
    else {
      const parsed = StudySchema.safeParse(reply.study);
      if (parsed.success) job.resolve({ study: parsed.data, timingsMs: reply.timingsMs, queueMs, workerMs });
      else job.reject(new OptimizationPoolError('OPTIMIZATION_WORKER_FAILED', 'The optimization worker returned a malformed study'));
    }
    this.dispatch();
  }

  /** Discards a broken, crashed or timed-out worker (terminating any computation); its job fails with no partial result. */
  private fail(slot: Slot, error: OptimizationPoolError): void {
    const index = this.slots.indexOf(slot);
    if (index < 0) return;
    this.slots.splice(index, 1);
    this.release(slot)?.reject(error);
    void slot.worker.terminate();
    if (!this.closed) this.dispatch();
  }
}
