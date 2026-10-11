import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BoundedWorkerPool, ownWorker, type PoolFailure, type WorkerSpec } from '../lib/worker-pool.js';
import { InspectionReportSchema, type InspectionReport } from './contracts.js';

export class InspectionPoolError extends Error {
  constructor(readonly code: `REFERENCE_${PoolFailure}` | 'REFERENCE_WORKER_FAILED', message: string) { super(message); this.name = 'InspectionPoolError'; }
}
export const INSPECTION_POOL_DEFAULTS = Object.freeze({ size: 2, queueLimit: 8, timeoutMs: 5_000, maxOldGenerationSizeMb: 256 });
const MESSAGES: Record<PoolFailure, string> = { QUEUE_FULL: 'Inspection capacity is exhausted; retry later', WORKER_TIMEOUT: 'The inspection exceeded its execution ceiling',
  WORKER_FAILED: 'The inspection worker failed', UNAVAILABLE: 'The inspection pool is shutting down' };
export interface Inspection { report: InspectionReport; stored: Buffer | null }

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Untrusted bytes are parsed off the request thread in a memory- and time-capped worker; inconsistent output is a worker failure and is never stored. */
export class InspectionPool extends BoundedWorkerPool<Inspection> {
  constructor(options: Partial<Record<keyof typeof INSPECTION_POOL_DEFAULTS, number>> & { worker?: WorkerSpec } = {}) {
    const { worker, ...bounds } = options;
    super({ bounds: { ...INSPECTION_POOL_DEFAULTS, ...bounds }, worker: worker ?? ownWorker(import.meta.url, 'worker'),
      failure: kind => new InspectionPoolError(`REFERENCE_${kind}`, MESSAGES[kind]),
      refusal: () => new InspectionPoolError('REFERENCE_WORKER_FAILED', MESSAGES.WORKER_FAILED),
      parse: reply => {
        const shape = z.object({ report: InspectionReportSchema, stored: z.instanceof(Uint8Array).nullable() }).safeParse(reply);
        if (!shape.success) return null;
        const { report } = shape.data, stored = shape.data.stored ? Buffer.from(shape.data.stored) : null;
        if ((report.verdict === 'ACCEPTED') !== (stored !== null)) return null;
        if (stored && (stored.length !== report.stored?.bytes || sha(stored) !== report.stored.sha256)) return null;
        return { report, stored };
      } });
  }
  /** The original digest is recomputed here, so a worker cannot describe bytes other than the ones it was given. */
  async inspect(bytes: Buffer, declaredMediaType: string) {
    const result = await this.run(new Uint8Array(bytes), { declaredMediaType });
    if (result.report.original.sha256 !== sha(bytes) || result.report.original.bytes !== bytes.length)
      throw new InspectionPoolError('REFERENCE_WORKER_FAILED', MESSAGES.WORKER_FAILED);
    return result;
  }
}
