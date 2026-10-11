import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BoundedWorkerPool, ownWorker, type PoolFailure, type WorkerSpec } from '../lib/worker-pool.js';
import { SCENE_LIMITS } from '../scene3d/contracts.js';
import { AppearanceManifestSchema, RevisionValidationSchema, type AppearanceManifest, type RevisionValidation } from './contracts.js';

export class AppearancePoolError extends Error {
  constructor(readonly code: `REVISION_${PoolFailure}`, message: string) { super(message); this.name = 'AppearancePoolError'; }
}
/** A typed refusal from inside the worker (unsupported source, empty scope, failed validation). */
export class AppearanceRefusal extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, string>) { super(message); this.name = 'AppearanceRefusal'; }
}
export const APPEARANCE_POOL_DEFAULTS = Object.freeze({ size: 1, queueLimit: 4, timeoutMs: SCENE_LIMITS.compileDeadlineMs, maxOldGenerationSizeMb: 512 });
const MESSAGES: Record<PoolFailure, string> = { QUEUE_FULL: 'Appearance capacity is exhausted; retry later', WORKER_TIMEOUT: 'The appearance run exceeded its execution ceiling',
  WORKER_FAILED: 'The appearance worker failed', UNAVAILABLE: 'The appearance pool is shutting down' };
export interface AppearanceRun { manifest: AppearanceManifest; glb: Buffer; validation: RevisionValidation; timingsMs: Record<string, number>; queueMs: number; workerMs: number }

/** Candidates are produced off the request thread; malformed, unvalidated or hash-inconsistent output is a worker failure and is never stored. */
export class AppearancePool extends BoundedWorkerPool<Omit<AppearanceRun, 'queueMs' | 'workerMs'>> {
  constructor(options: Partial<Record<keyof typeof APPEARANCE_POOL_DEFAULTS, number>> & { worker?: WorkerSpec } = {}) {
    const { worker, ...bounds } = options;
    super({ bounds: { ...APPEARANCE_POOL_DEFAULTS, ...bounds }, worker: worker ?? ownWorker(import.meta.url, 'worker'),
      failure: kind => new AppearancePoolError(`REVISION_${kind}`, MESSAGES[kind]),
      refusal: e => new AppearanceRefusal(e.code, e.message, e.details),
      parse: reply => {
        const shape = z.object({ manifest: AppearanceManifestSchema, glb: z.instanceof(Uint8Array), validation: RevisionValidationSchema, timingsMs: z.record(z.number()) }).safeParse(reply);
        if (!shape.success || shape.data.validation.status !== 'VALID' || !shape.data.validation.geometryLock.identical) return null;
        const glb = Buffer.from(shape.data.glb);
        if (glb.length !== shape.data.manifest.binary.bytes || createHash('sha256').update(glb).digest('hex') !== shape.data.manifest.binary.sha256) return null;
        return { manifest: shape.data.manifest, glb, validation: shape.data.validation, timingsMs: shape.data.timingsMs };
      } });
  }
}
