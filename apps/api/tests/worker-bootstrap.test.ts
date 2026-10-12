import { describe, expect, it } from 'vitest';
import { BoundedWorkerPool, ownWorker, type PoolFailure } from '../src/lib/worker-pool.js';

// Any '.ts' URL in the fixture directory; ownWorker resolves the worker name relative to it, as the real pools do with import.meta.url.
const fixtureModule = new URL('../../../test-support/source-workers/pool.ts', import.meta.url).href;
class PoolFailed extends Error { constructor(readonly kind: PoolFailure) { super(kind); } }

describe('source-mode worker bootstrap (Node 22.22.0 regression)', () => {
  it('starts compiled workers directly from their .js file, unchanged', () => {
    const spec = ownWorker('file:///srv/app/apps/api/dist/optimization/pool.js', 'worker');
    expect(spec).toEqual({ url: new URL('file:///srv/app/apps/api/dist/optimization/worker.js'), execArgv: [] });
  });

  it('starts source workers through a bootstrap that registers tsx inside the worker, not through execArgv', () => {
    const spec = ownWorker('file:///repo/apps/api/src/optimization/pool.ts', 'worker');
    expect(spec.url.href).toBe(new URL('../src/lib/tsx-worker.mjs', import.meta.url).href);
    expect(spec.execArgv).toEqual([]);
    expect(spec.workerData).toEqual({ entry: 'file:///repo/apps/api/src/optimization/worker.ts' });
  });

  it('runs a real source-mode worker whose imports use .js specifiers for .ts files and TypeScript-only syntax', async () => {
    // Before the fix, Node 22.22.0 started this worker without tsx: ERR_MODULE_NOT_FOUND on './resolution-dep.js' → WORKER_FAILED.
    const pool = new BoundedWorkerPool<{ marker: string; echo: unknown }>({
      bounds: { size: 1, queueLimit: 1, timeoutMs: 15_000, maxOldGenerationSizeMb: 128 },
      worker: ownWorker(fixtureModule, 'resolution-worker'),
      failure: kind => new PoolFailed(kind),
      refusal: e => new Error(e.code),
      parse: reply => (typeof reply.marker === 'string' ? { marker: reply.marker, echo: reply.echo } : null),
    });
    try {
      const result = await pool.run(null, { probe: 1 });
      expect(result).toMatchObject({ marker: 'marker:7', echo: { probe: 1 } });
    } finally {
      await pool.close();
    }
  });
});
