import { availableParallelism } from 'node:os';
import { OPTIMIZATION_LIMITS, OptimizationError, StudySchema, type OptimizationSource, type Study } from './contracts.js';
import { BoundedWorkerPool, ownWorker, type PoolFailure, type WorkerSpec } from '../lib/worker-pool.js';

export type PoolErrorCode = 'OPTIMIZATION_QUEUE_FULL' | 'OPTIMIZATION_WORKER_TIMEOUT' | 'OPTIMIZATION_WORKER_FAILED' | 'OPTIMIZATION_UNAVAILABLE';
export class OptimizationPoolError extends Error {
  constructor(readonly code: PoolErrorCode, message: string) { super(message); this.name = 'OptimizationPoolError'; }
}
export interface PoolOptions {
  size?: number; queueLimit?: number; timeoutMs?: number; maxOldGenerationSizeMb?: number;
  /** Tests only: an alternative worker script (crash/hang probes). */
  worker?: WorkerSpec;
}
// Conservative, bootstrap-friendly sizing: leave a core for the Fastify event loop; never more than two concurrent studies.
export const POOL_DEFAULTS = Object.freeze({ size: Math.max(1, Math.min(2, availableParallelism() - 1)), queueLimit: 4,
  timeoutMs: OPTIMIZATION_LIMITS.deadlineMs + 15_000, maxOldGenerationSizeMb: 512 });
const MESSAGES: Record<PoolFailure, string> = { QUEUE_FULL: 'Optimization capacity is exhausted; retry later', WORKER_TIMEOUT: 'The optimization study exceeded its execution ceiling',
  WORKER_FAILED: 'The optimization worker failed', UNAVAILABLE: 'The optimization pool is shutting down' };

export interface PoolResult { study: Study; timingsMs: Record<string, number>; queueMs: number; workerMs: number }

/** The Phase 28 study pool: the generic bounded pool configured for optimization studies (unchanged codes and limits). */
export class OptimizationPool extends BoundedWorkerPool<Omit<PoolResult, 'queueMs' | 'workerMs'>> {
  constructor(options: PoolOptions = {}) {
    const { worker, ...bounds } = options;
    super({ bounds: { ...POOL_DEFAULTS, ...bounds }, worker: worker ?? ownWorker(import.meta.url, 'worker'),
      failure: kind => new OptimizationPoolError(`OPTIMIZATION_${kind}` as PoolErrorCode, MESSAGES[kind]),
      refusal: e => new OptimizationError(e.code as OptimizationError['code'], e.message, e.details),
      parse: reply => { const study = StudySchema.safeParse(reply.study); return study.success ? { study: study.data, timingsMs: reply.timingsMs as Record<string, number> } : null; } });
  }
  override run(source: OptimizationSource, input: unknown): Promise<PoolResult> { return super.run(source, input); }
}
