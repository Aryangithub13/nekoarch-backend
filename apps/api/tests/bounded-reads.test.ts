import { describe, expect, it } from 'vitest';
import { pooled, READ_CONCURRENCY } from '../src/lib/bounded-reads.js';

/** Reads that resolve after `delay(i)` ms, recording how many are in flight. */
function probe(count: number, delay: (i: number) => number = () => 1) {
  const state = { inFlight: 0, peak: 0, started: [] as number[], finished: [] as number[] };
  const reads = Array.from({ length: count }, (_, i) => async () => {
    state.started.push(i); state.inFlight++; state.peak = Math.max(state.peak, state.inFlight);
    try { await new Promise(r => setTimeout(r, delay(i))); return `r${i}`; }
    finally { state.inFlight--; state.finished.push(i); }
  });
  return { reads, state };
}

describe('Phase 37 bounded reads (pooled)', () => {
  it('keeps at most eight reads in flight, and uses all eight (not serialized)', async () => {
    const { reads, state } = probe(50);
    expect(await pooled(reads)).toEqual(Array.from({ length: 50 }, (_, i) => `r${i}`));
    expect(READ_CONCURRENCY).toBe(8);
    expect(state.peak).toBe(8);
  });
  it('never exceeds eight even when asked for more, and honours a lower width', async () => {
    for (const [width, peak] of [[100, 8], [Number.POSITIVE_INFINITY, 8], [Number.NaN, 8], [3, 3], [1, 1], [0, 1], [-5, 1]] as const) {
      const { reads, state } = probe(30);
      await pooled(reads, width);
      expect(state.peak, String(width)).toBe(peak);
    }
  });
  it('runs every read exactly once and returns results in input order when they complete out of order', async () => {
    const { reads, state } = probe(40, i => (i * 7) % 5);
    const results = await pooled(reads);
    expect(results).toEqual(Array.from({ length: 40 }, (_, i) => `r${i}`));
    expect([...state.started].sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(state.started).toHaveLength(40);
    expect(state.finished).not.toEqual([...state.finished].sort((a, b) => a - b)); // completion order really differed
  });
  it('handles an empty input and a large one', async () => {
    let calls = 0;
    expect(await pooled([], 8, () => calls++)).toEqual([]);
    expect(calls).toBe(0);
    const { reads, state } = probe(1000, () => 0);
    const results = await pooled(reads);
    expect(results).toHaveLength(1000);
    expect(results[999]).toBe('r999');
    expect(state.peak).toBeLessThanOrEqual(8);
  });
  it('rejects with the failing read’s own error, as Promise.all would, and starts no read after it', async () => {
    const error = Object.assign(new Error('not found'), { statusCode: 404 });
    let started = 0;
    const reads = Array.from({ length: 50 }, (_, i) => async () => {
      started++;
      await new Promise(r => setTimeout(r, 1));
      if (i === 3) throw error;
      return i;
    });
    await expect(pooled(reads)).rejects.toBe(error);
    await new Promise(r => setTimeout(r, 20));
    // Reads 0–7 start at once; at most the lanes then running pick one more each before the failure is seen.
    expect(started).toBeGreaterThanOrEqual(4);
    expect(started).toBeLessThan(50);
    expect(started).toBeLessThanOrEqual(16);
  });
  it('runs the budget check before each read starts, and a failing check stops the pool', async () => {
    let checks = 0, started = 0;
    const reads = Array.from({ length: 20 }, () => async () => { started++; return 1; });
    const budget = () => { if (++checks > 5) throw Object.assign(new Error('time'), { code: 'DEPENDENCY_GRAPH_LIMIT_EXCEEDED' }); };
    await expect(pooled(reads, 1, budget)).rejects.toMatchObject({ code: 'DEPENDENCY_GRAPH_LIMIT_EXCEEDED' });
    expect([checks, started]).toEqual([6, 5]);
  });
});
