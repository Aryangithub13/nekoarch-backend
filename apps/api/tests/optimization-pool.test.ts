import { afterEach, describe, expect, it } from 'vitest';
import { optimizationInput, optimizationSource, optimizationVariable } from '../../../test-support/optimization-fixtures.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { OptimizationError } from '../src/optimization/contracts.js';
import { runOptimizationStudy } from '../src/optimization/study.js';
import { OptimizationPool, OptimizationPoolError, POOL_DEFAULTS } from '../src/optimization/pool.js';

const probe = { url: new URL('../../../test-support/optimization-workers/probe.mjs', import.meta.url), execArgv: [] };
const pools: OptimizationPool[] = [];
const pool = (options: ConstructorParameters<typeof OptimizationPool>[0] = {}) => { const p = new OptimizationPool(options); pools.push(p); return p; };
afterEach(async () => { await Promise.all(pools.splice(0).map(p => p.close())); });
async function rejection(promise: Promise<unknown>) { try { await promise; } catch (error) { return error as Error & { code?: string }; } throw new Error('expected rejection'); }
const SOURCE = optimizationSource();

describe('Phase 28 optimization worker pool', () => {
  it('defaults are bounded and conservative', () => {
    expect(POOL_DEFAULTS.size).toBeGreaterThanOrEqual(1);
    expect(POOL_DEFAULTS.size).toBeLessThanOrEqual(2);
    expect(POOL_DEFAULTS.queueLimit).toBe(4);
    expect(POOL_DEFAULTS.timeoutMs).toBe(60_000);
    expect(() => new OptimizationPool({ size: 0 })).toThrow(RangeError);
    expect(() => new OptimizationPool({ size: 9 })).toThrow(RangeError);
  });

  it('a worker produces the byte-identical study the in-process core produces, on every worker', async () => {
    const direct = runOptimizationStudy(SOURCE, optimizationInput()).study, p = pool({ size: 2 });
    const [a, b] = await Promise.all([p.run(SOURCE, optimizationInput()), p.run(SOURCE, optimizationInput())]);
    expect(JSON.stringify(a.study)).toBe(JSON.stringify(direct));
    expect(JSON.stringify(b.study)).toBe(JSON.stringify(direct));
    expect(p.stats()).toMatchObject({ workers: 2, busy: 0, queued: 0 });
    expect(a.workerMs).toBeGreaterThan(0);
    expect(JSON.stringify(a.study)).not.toContain('timings');
  });

  it('passes typed refusals through without a study', async () => {
    const error = await rejection(pool({ size: 1 }).run(SOURCE, optimizationInput({ variables: [optimizationVariable('w0', 0, 'widthMm', 1000, 60000, 1000), optimizationVariable('d0', 0, 'depthMm', 1000, 60000, 1000)] })));
    expect(error).toBeInstanceOf(OptimizationError);
    expect(error.code).toBe('OPTIMIZATION_RESOURCE_LIMIT');
  });

  it('bounds the queue: overflow is refused immediately, never started', async () => {
    const p = pool({ size: 1, queueLimit: 1, worker: probe });
    const running = p.run(SOURCE, { probe: 'sleep', ms: 300 }), queued = p.run(SOURCE, { probe: 'sleep', ms: 1 });
    const overflow = await rejection(p.run(SOURCE, { probe: 'sleep', ms: 1 }));
    expect(overflow).toBeInstanceOf(OptimizationPoolError);
    expect(overflow.code).toBe('OPTIMIZATION_QUEUE_FULL');
    expect(p.stats()).toMatchObject({ busy: 1, queued: 1 });
    await Promise.allSettled([running, queued]);
  });

  it('a timed-out study fails, its worker is terminated and replaced', async () => {
    const p = pool({ size: 1, timeoutMs: 200, worker: probe });
    const timedOut = await rejection(p.run(SOURCE, { probe: 'hang' }));
    expect(timedOut.code).toBe('OPTIMIZATION_WORKER_TIMEOUT');
    expect(p.stats()).toMatchObject({ workers: 0, busy: 0 });
    const next = await rejection(p.run(SOURCE, { probe: 'echo' })); // a fresh worker answers
    expect(next).toBeInstanceOf(OptimizationError);
    expect((next as OptimizationError).details).toEqual({ echo: 'echo' });
  });

  it('a crashed or throwing worker fails the study with no partial result', async () => {
    const p = pool({ size: 1, worker: probe });
    for (const probeMode of ['crash', 'throw']) {
      const error = await rejection(p.run(SOURCE, { probe: probeMode }));
      expect(error).toBeInstanceOf(OptimizationPoolError);
      expect(error.code).toBe('OPTIMIZATION_WORKER_FAILED');
    }
    expect(p.stats().workers).toBe(0);
  });

  it('rejects a malformed (forged) study from a worker', async () => {
    const error = await rejection(pool({ size: 1, worker: probe }).run(SOURCE, { probe: 'garbage' }));
    expect(error.code).toBe('OPTIMIZATION_WORKER_FAILED');
  });

  it('graceful shutdown: queued work is refused, running work finishes, new work is refused', async () => {
    const p = new OptimizationPool({ size: 1, queueLimit: 2, worker: probe });
    const running = p.run(SOURCE, { probe: 'sleep', ms: 200 }), queued = p.run(SOURCE, { probe: 'sleep', ms: 1 });
    await p.close();
    expect((await rejection(running)).code).toBe('OPTIMIZATION_RESOURCE_LIMIT'); // completed normally (probe reply), not cut off
    expect((await rejection(queued)).code).toBe('OPTIMIZATION_UNAVAILABLE');
    expect((await rejection(p.run(SOURCE, {}))).code).toBe('OPTIMIZATION_UNAVAILABLE');
    expect(p.stats()).toMatchObject({ workers: 0, queued: 0, closed: true });
  });

  it('keeps the main event loop responsive while a heavy study runs', async () => {
    const two = optimizationSource(parametricInput(true));
    const input = optimizationInput({ variables: [optimizationVariable('w1', 1, 'widthMm', 13000, 17000, 500), optimizationVariable('s1', 1, 'southWingDepthMm', 6000, 8000, 500)] });
    const p = pool({ size: 1 });
    let last = performance.now(), worstLagMs = 0;
    const timer = setInterval(() => { const now = performance.now(); worstLagMs = Math.max(worstLagMs, now - last - 10); last = now; }, 10);
    const result = await p.run(two, input);
    clearInterval(timer);
    expect(result.study.search.evaluatedAssignments).toBe(45);
    expect(result.workerMs).toBeGreaterThan(500);
    expect(worstLagMs).toBeLessThan(100);
  }, 60_000);
});
