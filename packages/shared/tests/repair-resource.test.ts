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
it('bounds collision work and finding growth for large column collections', async () => {
  const { validateBuildingInvariants } = await import('../src/building-v2/invariants.js');
  const { authored, rect } = await import('../../blueprint-qa/tests/fixtures.js');
  const model = authored();
  model.columns = Array.from({ length: 1024 }, (_, i) => ({ id: `c${i}`, levelId: 'ground', baseOffsetMm: 0, heightMm: 1000, crossSection: { outer: rect(100+(i%32)*100,100+Math.floor(i/32)*100,50,50), voids: [] } }));
  let issues = 0; const ctx = { addIssue() { issues++; }, path: [] };
  let start = performance.now(); validateBuildingInvariants(model, ctx);
  expect(issues).toBe(0); expect(performance.now()-start).toBeLessThan(2000);
  for (const col of model.columns) col.crossSection.outer = rect(100,100,50,50);
  start = performance.now(); validateBuildingInvariants(model, ctx);
  expect(issues).toBe(1023); expect(performance.now()-start).toBeLessThan(2000);
});
