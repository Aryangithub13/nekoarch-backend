import { availableParallelism } from 'node:os';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BoundedWorkerPool, ownWorker, type PoolFailure, type WorkerSpec } from '../lib/worker-pool.js';
import { SCENE_LIMITS, SceneError, SceneManifestSchema, SceneValidationSchema, type SceneManifest, type SceneValidation } from './contracts.js';

export type ScenePoolErrorCode = `SCENE_${PoolFailure}`;
export class ScenePoolError extends Error {
  constructor(readonly code: ScenePoolErrorCode, message: string) { super(message); this.name = 'ScenePoolError'; }
}
export const SCENE_POOL_DEFAULTS = Object.freeze({ size: Math.max(1, Math.min(2, availableParallelism() - 1)), queueLimit: 8,
  timeoutMs: SCENE_LIMITS.compileDeadlineMs, maxOldGenerationSizeMb: 512 });
const MESSAGES: Record<PoolFailure, string> = { QUEUE_FULL: 'Scene compile capacity is exhausted; retry later', WORKER_TIMEOUT: 'The scene compile exceeded its execution ceiling',
  WORKER_FAILED: 'The scene worker failed', UNAVAILABLE: 'The scene pool is shutting down' };
export interface SceneRun { manifest: SceneManifest; glb: Buffer; validation: SceneValidation; timingsMs: Record<string, number>; queueMs: number; workerMs: number }
export interface ScenePoolOptions { size?: number; queueLimit?: number; timeoutMs?: number; maxOldGenerationSizeMb?: number; worker?: WorkerSpec }

/** Scene compiles run off the request thread; a malformed, unvalidated or hash-inconsistent reply is a worker failure. */
export class ScenePool extends BoundedWorkerPool<Omit<SceneRun, 'queueMs' | 'workerMs'>> {
  constructor(options: ScenePoolOptions = {}) {
    const { worker, ...bounds } = options;
    super({ bounds: { ...SCENE_POOL_DEFAULTS, ...bounds }, worker: worker ?? ownWorker(import.meta.url, 'worker'),
      failure: kind => new ScenePoolError(`SCENE_${kind}`, MESSAGES[kind]),
      refusal: e => new SceneError(e.code as SceneError['code'], e.message, e.details),
      parse: reply => {
        const shape = z.object({ manifest: SceneManifestSchema, glb: z.instanceof(Uint8Array), validation: SceneValidationSchema, timingsMs: z.record(z.number()) }).safeParse(reply);
        if (!shape.success || shape.data.validation.status !== 'VALID') return null;
        const glb = Buffer.from(shape.data.glb);
        if (glb.length !== shape.data.manifest.binary.bytes || createHash('sha256').update(glb).digest('hex') !== shape.data.manifest.binary.sha256) return null;
        return { manifest: shape.data.manifest, glb, validation: shape.data.validation, timingsMs: shape.data.timingsMs };
      } });
  }
}
