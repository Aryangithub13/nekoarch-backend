/**
 * Hard ceiling on the per-artifact reads one request keeps in flight (Phase 37 read cap, first written in `0bf1c89` on `phase37/read-cap`).
 * Without it one dependency-graph read could start roughly 150 owner-scoped reads at once.
 */
export const READ_CONCURRENCY = 8;

/**
 * Runs `reads` with at most `width` in flight, never more than READ_CONCURRENCY, and returns their results in input order. `beforeEach` runs
 * before every read starts (the graph's time budget). The first failure is the result, exactly as with Promise.all; after it no further read
 * starts, and reads already in flight finish unobserved. One pool per fan-out: callers flatten their reads instead of nesting pools.
 */
export async function pooled<T>(reads: readonly (() => Promise<T>)[], width: number = READ_CONCURRENCY, beforeEach: () => void = () => undefined): Promise<T[]> {
  const results = new Array<T>(reads.length);
  let next = 0, failed = false;
  const lane = async () => {
    while (!failed && next < reads.length) {
      const i = next++;
      try { beforeEach(); results[i] = await reads[i]!(); }
      catch (error) { failed = true; throw error; }
    }
  };
  const lanes = Math.min(reads.length, READ_CONCURRENCY, Number.isFinite(width) ? Math.max(1, Math.floor(width)) : READ_CONCURRENCY);
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}
