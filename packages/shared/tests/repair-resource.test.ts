import { expect, it } from 'vitest';
import { RingMmSchema } from '../src/building-v2/geometry.js';
it('rejects an over-limit simple ring before quadratic topology work', () => {
  const n = 1024, ring = [];
  for (let i=0;i<n;i++) ring.push({x:i,z:0});
  for (let i=0;i<n;i++) ring.push({x:n,z:i});
  for (let i=0;i<n;i++) ring.push({x:n-i,z:n});
  for (let i=0;i<n;i++) ring.push({x:0,z:n-i});
  const start = performance.now();
  expect(RingMmSchema.safeParse(ring).success).toBe(false);
  expect(performance.now()-start).toBeLessThan(2000);
});
