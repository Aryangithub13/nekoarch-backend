import { describe, expect, it } from 'vitest';
import type { BuildingModelV2 } from '@designflow/shared';
import { generateParametricBlueprint } from '@designflow/generator';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { Budget, contains, coverage, floorDistance, isSimple, isqrt, locate, pointSegmentDistance2, unionArea2 } from '../src/verification/geometry.js';
import { ratio, verifyModel } from '../src/verification/verify.js';
import { scopedDiff } from '../src/verification/diff.js';

const ids = { projectId: '00000000-0000-4000-8000-000000000001', revisionId: '00000000-0000-4000-8000-000000000002', modelHash: 'a'.repeat(64) };
const rect = (x0: number, z0: number, x1: number, z1: number) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const verify = (m: BuildingModelV2, limits: { maxCoverageRatio?: number; maxFar?: number } | null = null) => verifyModel(m, ids, limits);
const checks = (m: BuildingModelV2, id: string, limits: { maxCoverageRatio?: number; maxFar?: number } | null = null) => verify(m, limits).checks.filter(c => c.checkId === id);
/** authored() is an 8 m × 6 m single storey on an identical site; this gives it a larger, non-rectangular site with an inclined edge. */
function onTrapezoidSite(setbacks: { edge: number; minimumMm: number }[]): BuildingModelV2 {
  const m = authored();
  m.site = { ...m.site!, boundary: [{ x: -2000, z: -2000 }, { x: 10000, z: -2000 }, { x: 14000, z: 8000 }, { x: -2000, z: 8000 }],
    setbacks: setbacks.map((s, i) => ({ id: `setback-${i}`, boundaryEdgeStart: s.edge, minimumMm: s.minimumMm })) };
  return m;
}

describe('Phase 34 exact geometry', () => {
  it('locates points, detects non-simple rings and concave non-containment exactly', () => {
    const l = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4 }, { x: 4, z: 4 }, { x: 4, z: 10 }, { x: 0, z: 10 }];
    expect([locate({ x: 2, z: 2 }, l), locate({ x: 4, z: 7 }, l), locate({ x: 7, z: 7 }, l)]).toEqual([1, 0, -1]);
    expect(isSimple(l)).toBe(true);
    expect(isSimple([{ x: 0, z: 0 }, { x: 4, z: 4 }, { x: 4, z: 0 }, { x: 0, z: 4 }])).toBe(false); // bow-tie
    expect(isSimple([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 3 }])).toBe(false); // retraced edge
    expect(contains(l, [{ x: 1, z: 1 }, { x: 3, z: 1 }, { x: 3, z: 9 }])).toBe(true);
    expect(contains(l, [{ x: 2, z: 9 }, { x: 9, z: 2 }, { x: 2, z: 2 }])).toBe(false); // every vertex inside, an edge crosses the notch
  });
  it('computes exact distances and floors them without rounding drift', () => {
    const d = pointSegmentDistance2({ x: 8000, z: 0 }, { x: 10000, z: -2000 }, { x: 14000, z: 8000 });
    expect(d).toEqual({ n: 28_000_000n * 28_000_000n, d: 116_000_000n });
    expect(floorDistance(d)).toBe(2599n); // 2599.74… mm
    expect([isqrt(0n), isqrt(15n), isqrt(16n), isqrt(10n ** 30n)]).toEqual([0n, 3n, 4n, 10n ** 15n]);
  });
  it('computes rectilinear union and uncovered areas exactly, within a budget', () => {
    const a = { outer: rect(0, 0, 4, 4), voids: [] }, b = { outer: rect(2, 0, 6, 4), voids: [] }, holed = { outer: rect(0, 0, 6, 6), voids: [rect(2, 2, 4, 4)] };
    expect(unionArea2([a, b], new Budget(1e6))).toBe(48n); // 6 × 4, doubled
    expect(unionArea2([holed], new Budget(1e6))).toBe(64n); // 36 − 4, doubled
    expect(coverage([{ outer: rect(0, 0, 6, 4), voids: [] }], [a], new Budget(1e6))).toEqual({ targetArea2: 48n, uncovered2: 16n });
    expect(coverage([a], [b], new Budget(1))).toBeNull();
  });
  it('reduces ratios and rounds half up at four decimals', () => {
    expect([ratio(2n, 6n), ratio(4n, 6n), ratio(1n, 8n), ratio(1n, 32n), ratio(6n, 3n)].map(r => `${r.numerator}/${r.denominator}=${r.decimal}`))
      .toEqual(['1/3=0.3333', '2/3=0.6667', '1/8=0.1250', '1/32=0.0313', '2/1=2.0000']);
  });
});

describe('Phase 34 verification report', () => {
  it('verifies the authored model with separate, exact bases', () => {
    const r = verify(authored());
    expect(r).toMatchObject({ status: 'VERIFIED', verifierVersion: 'complex-verification-v1', declaredLimits: null,
      bases: { plotAreaMm2: '48000000', groundCoverage: { areaMm2: '48000000', method: 'RECTILINEAR_SLAB_UNION' }, grossFloorAreaMm2: '48000000',
        netSpaceAreaMm2: '45240000', coverageRatio: { decimal: '1.0000' }, far: { decimal: '1.0000' } },
      claims: { statutoryCompliance: 'NOT_CLAIMED', structuralAdequacy: 'NOT_CLAIMED' } });
    expect(verify(authored()).inputHash).toBe(r.inputHash); // deterministic
    expect(verify(authored(), { maxFar: 2 }).inputHash).not.toBe(r.inputHash);
  });
  it('evaluates setbacks on a non-rectangular site exactly at the boundary (QA reports these NOT_EVALUATED)', () => {
    const results = checks(onTrapezoidSite([{ edge: 0, minimumMm: 2000 }, { edge: 0, minimumMm: 2001 }, { edge: 1, minimumMm: 2599 }, { edge: 1, minimumMm: 2600 }]), 'SETBACK_DISTANCE');
    expect(results.map(c => [c.status, c.measured, c.required])).toEqual([['PASS', '2000 mm', '2000 mm'], ['FAIL', '2000 mm', '2001 mm'],
      ['PASS', '2599 mm', '2599 mm'], ['FAIL', '2599 mm', '2600 mm']]);
    expect(checks(onTrapezoidSite([{ edge: 9, minimumMm: 1 }]), 'SETBACK_DISTANCE')[0]).toMatchObject({ status: 'FAIL', detail: expect.stringContaining('does not exist') });
  });
  it('checks openings on a diagonal host exactly (a 3-4-5 wall of 5000 mm)', () => {
    const host = (offsetMm: number) => {
      const m = authored(), east = m.walls.find(w => w.id === 'east')!;
      east.path = { start: { x: 8000, z: 0 }, end: { x: 11000, z: 4000 } };
      m.openings = m.openings.map(o => o.id === 'studio-window' ? { ...o, offsetMm } : o);
      return checks(m, 'OPENING_WITHIN_HOST').find(c => c.entityIds[0] === 'studio-window')!.status;
    };
    expect([host(3800), host(3801)]).toEqual(['PASS', 'FAIL']);
  });
  it('measures unsupported space area exactly and refuses to guess non-rectilinear unions', () => {
    const half = authored();
    half.slabs[0]!.footprint = { outer: rect(0, 0, 4000, 6000), voids: [] };
    const support = checks(half, 'SPACE_ON_PLATES');
    expect(support.map(c => [c.entityIds[0], c.status, c.measured])).toEqual([['foyer', 'PASS', '0 mm² unsupported'], ['studio', 'FAIL', '22620000 mm² unsupported']]);
    expect(verify(half).status).toBe('FAILED');
    const slanted = authored();
    slanted.slabs[0]!.footprint = { outer: [{ x: 0, z: 0 }, { x: 8000, z: 0 }, { x: 8000, z: 6000 }, { x: 0, z: 5000 }], voids: [] };
    const report = verify(slanted);
    expect(report.status).toBe('PARTIAL');
    expect(report.bases.groundCoverage.method).toBe('LEVEL_BOUNDARY_FALLBACK');
    expect(report.checks.filter(c => c.checkId === 'SPACE_ON_PLATES').every(c => c.status === 'NOT_EVALUATED')).toBe(true);
  });
  it('reports an upper-storey overhang as a warning with its exact area', () => {
    const m = authored();
    m.site = { ...m.site!, boundary: rect(0, 0, 10000, 6000) };
    m.levels.push({ ...m.levels[0]!, id: 'upper', name: 'Upper', index: 1, elevationMm: 3000, boundary: rect(0, 0, 9000, 6000) });
    const r = verify(m);
    expect(r.checks.find(c => c.checkId === 'UPPER_PLATE_SUPPORT')).toMatchObject({ status: 'WARNING', measured: '6000000 mm² overhang', entityIds: ['upper', 'ground'] });
    expect(r.status).toBe('VERIFIED_WITH_WARNINGS');
    expect(r.bases.levels.map(l => [l.levelId, l.grossPlateAreaMm2, l.method])).toEqual([['ground', '48000000', 'RECTILINEAR_SLAB_UNION'],
      ['upper', '54000000', 'LEVEL_BOUNDARY_NO_FLOOR_SLABS']]);
  });
  it('compares declared (never statutory) limits as exact fractions', () => {
    const m = authored();
    m.site = { ...m.site!, boundary: rect(0, 0, 10000, 8000) }; // coverage 48/80 = 0.6 exactly
    expect(checks(m, 'DECLARED_LIMIT', { maxCoverageRatio: 0.6, maxFar: 0.5999 }).map(c => [c.status, c.measured, c.required]))
      .toEqual([['PASS', '0.6000', '0.6000'], ['FAIL', '0.6000', '0.5999']]);
    const noSite = authored(); noSite.site = null;
    expect(checks(noSite, 'DECLARED_LIMIT', { maxFar: 1 })[0]!.status).toBe('NOT_EVALUATED');
    expect(verify(noSite).bases.coverageRatio).toBeNull();
  });
  it('verifies a generated two-storey L-shaped model, counting stairs as support for the stairwell over the slab void', () => {
    const r = verify(generateParametricBlueprint(parametricInput(true)).model);
    expect(r.status).toBe('VERIFIED');
    expect(r.bases.levels.map(l => l.grossPlateAreaMm2)).toEqual(['234000000', '184300000']); // the upper plate excludes the 4.2 m² stair void
  });
});

describe('Phase 34 scoped diff', () => {
  const diff = (a: BuildingModelV2, b: BuildingModelV2, scope: { levelIds?: string[]; entityIds?: string[]; allowSiteChange?: boolean }) =>
    scopedDiff(a, b, { projectId: ids.projectId, baseRevisionId: ids.revisionId, otherRevisionId: ids.projectId, baseModelHash: 'a'.repeat(64), otherModelHash: 'b'.repeat(64) },
      { levelIds: scope.levelIds ?? [], entityIds: scope.entityIds ?? [], allowSiteChange: scope.allowSiteChange ?? false });
  it('reports identical revisions, in-scope and out-of-scope changes per entity', () => {
    expect(diff(authored(), authored(), {}).status).toBe('IDENTICAL');
    const changed = authored();
    changed.spaces[0]!.name = 'Entry';
    changed.walls.push({ ...changed.walls[0]!, id: 'new-wall' });
    expect(diff(authored(), changed, { levelIds: ['ground'] })).toMatchObject({ status: 'WITHIN_SCOPE', counts: { added: 1, changed: 1, removed: 0, outOfScope: 0 } });
    const out = diff(authored(), changed, { entityIds: ['foyer'] });
    expect(out.status).toBe('OUT_OF_SCOPE_CHANGES');
    expect(out.violations.map(v => [v.collection, v.entityId, v.change])).toEqual([['walls', 'new-wall', 'ADDED']]);
  });
  it('requires an explicit allowance for site changes', () => {
    const moved = authored();
    moved.site = { ...moved.site!, northMilliDegrees: 90_000 };
    expect(diff(authored(), moved, { levelIds: ['ground'] }).violations.map(v => v.collection)).toEqual(['site']);
    expect(diff(authored(), moved, { allowSiteChange: true }).status).toBe('WITHIN_SCOPE');
  });
});
