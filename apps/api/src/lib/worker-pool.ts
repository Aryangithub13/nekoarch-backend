import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';

/** Worker protocol: one job per message; a reply is either a result payload or a typed refusal (never internals). */
export interface WorkerJob { id: number; source: unknown; input: unknown }
export type WorkerReply = ({ id: number; ok: true } & Record<string, unknown>)
  | { id: number; ok: false; error: { code: string; message: string; details: Record<string, string> } };
export interface WorkerSpec { url: URL; execArgv: string[]; workerData?: unknown }
export interface PoolBounds { size: number; queueLimit: number; timeoutMs: number; maxOldGenerationSizeMb: number }
export type PoolFailure = 'QUEUE_FULL' | 'WORKER_TIMEOUT' | 'WORKER_FAILED' | 'UNAVAILABLE';
export interface PoolConfig<R> {
  bounds: PoolBounds; worker: WorkerSpec;
  /** Typed pool failure (capacity, timeout, crash, malformed output, shutdown). */
  failure(kind: PoolFailure): Error;
  /** A typed refusal raised inside the worker (input or domain error). */
  refusal(error: { code: string; message: string; details: Record<string, string> }): Error;
  /** Re-validates worker output; null means malformed, which is a worker failure. */
  parse(reply: Record<string, unknown>): R | null;
}
export type Timed<R> = R & { queueMs: number; workerMs: number };
interface Job<R> { id: number; message: WorkerJob; queuedAt: number; resolve: (value: Timed<R>) => void; reject: (error: Error) => void }
interface Slot<R> { worker: Worker; job: Job<R> | null; startedAt: number; timer: NodeJS.Timeout | null }

export const ownWorker = (moduleUrl: string, name: string): WorkerSpec => {
  const ts = moduleUrl.endsWith('.ts'); // source (tests, tsx) vs compiled dist
  return { url: new URL(`./${name}.${ts ? 'ts' : 'js'}`, moduleUrl), execArgv: ts ? ['--import', 'tsx'] : [] };
};

/** Fixed-size worker pool with a bounded queue. A failed, crashed or timed-out worker never yields a result. */
export class BoundedWorkerPool<R> {
  private readonly slots: Slot<R>[] = [];
  private readonly queue: Job<R>[] = [];
  private readonly pending = new Set<Promise<Timed<R>>>();
  private nextId = 1;
  private closed = false;
  constructor(private readonly config: PoolConfig<R>) {
    const { size, queueLimit, timeoutMs } = config.bounds;
    if (!Number.isInteger(size) || size < 1 || size > 8 || !Number.isInteger(queueLimit) || queueLimit < 0 || !(timeoutMs > 0)) throw new RangeError('Invalid worker pool bounds');
  }
  stats() { return { size: this.config.bounds.size, workers: this.slots.length, busy: this.slots.filter(s => s.job).length, queued: this.queue.length, closed: this.closed }; }

  run(source: unknown, input: unknown): Promise<Timed<R>> {
    if (this.closed) return Promise.reject(this.config.failure('UNAVAILABLE'));
    const capacity = this.slots.some(s => !s.job) || this.slots.length < this.config.bounds.size;
    if (!capacity && this.queue.length >= this.config.bounds.queueLimit) return Promise.reject(this.config.failure('QUEUE_FULL'));
    const promise = new Promise<Timed<R>>((resolve, reject) => {
      const id = this.nextId++;
      this.queue.push({ id, message: { id, source, input }, queuedAt: performance.now(), resolve, reject });
    });
    this.pending.add(promise);
    void promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise));
    this.dispatch();
    return promise;
  }

  /** Graceful: queued jobs are refused, running jobs finish (bounded by the timeout), then workers exit. */
  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.queue.splice(0)) job.reject(this.config.failure('UNAVAILABLE'));
    await Promise.allSettled([...this.pending]);
    await Promise.all(this.slots.splice(0).map(s => s.worker.terminate()));
  }

  private spawn(): Slot<R> {
    const { url, execArgv, workerData } = this.config.worker;
    const worker = new Worker(url, { execArgv, workerData, resourceLimits: { maxOldGenerationSizeMb: this.config.bounds.maxOldGenerationSizeMb } });
    const slot: Slot<R> = { worker, job: null, startedAt: 0, timer: null };
    worker.on('message', (reply: WorkerReply) => this.settle(slot, reply));
    worker.on('error', () => this.fail(slot, this.config.failure('WORKER_FAILED')));
    worker.on('exit', () => this.fail(slot, this.config.failure('WORKER_FAILED')));
    worker.unref();
    this.slots.push(slot);
    return slot;
  }

  private dispatch(): void {
    while (this.queue.length) {
      const slot = this.slots.find(s => !s.job) ?? (this.slots.length < this.config.bounds.size ? this.spawn() : null);
      if (!slot) return;
      const job = this.queue.shift()!;
      slot.job = job; slot.startedAt = performance.now();
      slot.timer = setTimeout(() => this.fail(slot, this.config.failure('WORKER_TIMEOUT')), this.config.bounds.timeoutMs);
      slot.worker.ref();
      slot.worker.postMessage(job.message);
    }
  }

  private release(slot: Slot<R>): Job<R> | null {
    const job = slot.job;
    if (slot.timer) clearTimeout(slot.timer);
    slot.job = null; slot.timer = null; slot.worker.unref();
    return job;
  }

  private settle(slot: Slot<R>, reply: WorkerReply): void {
    if (!slot.job || slot.job.id !== reply.id) return;
    const workerMs = performance.now() - slot.startedAt, job = this.release(slot)!, queueMs = slot.startedAt - job.queuedAt;
    if (!reply.ok) job.reject(this.config.refusal(reply.error));
    else {
      const parsed = this.config.parse(reply);
      if (parsed !== null) job.resolve({ ...parsed, queueMs, workerMs });
      else job.reject(this.config.failure('WORKER_FAILED'));
    }
    this.dispatch();
  }

  /** Discards a broken, crashed or timed-out worker (terminating any computation); its job fails with no partial result. */
  private fail(slot: Slot<R>, error: Error): void {
    const index = this.slots.indexOf(slot);
    if (index < 0) return;
    this.slots.splice(index, 1);
    this.release(slot)?.reject(error);
    void slot.worker.terminate();
    if (!this.closed) this.dispatch();
  }
}
