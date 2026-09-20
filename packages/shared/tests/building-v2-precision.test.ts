import { describe, expect, it } from 'vitest';
import {
  CoordinateMmSchema, LengthMmSchema, MAX_MM, Point2MmSchema, RingMmSchema, FootprintMmSchema,
  toMillimetres, fromMillimetres, feetAndInchesToMillimetres, reconcileDimensions,
  polygonAreaMm2, polygonPerimeterMm, footprintAreaMm2, segmentLengthMm,
  ringContains, ringsOverlap, segmentInRing, type RingMm,
} from '../src/index.js';
const rectangle = (x: number, z: number, w: number, d: number): RingMm => [{ x, z }, { x: x + w, z }, { x: x + w, z: z + d }, { x, z: z + d }];

describe('canonical mm precision', () => {
  it.each([
    ['1', 'm', 1000], ['1', 'cm', 10], ['1', 'ft', 305], ['1', 'in', 25], ['5', 'ft', 1524],
    ['0.5', 'mm', 1], ['-0.5', 'mm', -1], ['-0.4999', 'mm', 0], ['1.5245', 'm', 1525],
    ['-1.5245', 'm', -1525], ['1e-3', 'm', 1], ['9000', 'mm', 9000],
  ] as const)('converts %s %s deterministically', (input, unit, expected) => expect(toMillimetres(input, unit)).toBe(expected));
  it('retains exact foot ratio before rounding at the boundary', () => {
    expect(toMillimetres('304.8', 'mm')).toBe(305);
    expect(fromMillimetres(1524, 'ft', 3)).toBe('5.000');
    expect(toMillimetres('5', 'ft')).toBe(1524); // not 5 * round(304.8)
  });
  it('combines feet/inches before rounding', () => {
    expect(feetAndInchesToMillimetres(10, 6)).toBe(3200);
    expect(feetAndInchesToMillimetres(-10, -6)).toBe(-3200);
    expect(feetAndInchesToMillimetres(1, 1)).toBe(330);
  });
  it.each(['NaN', 'Infinity', '1/3', '1,000', '1e101', '', ' ', '0x10', '1'.repeat(129)])('rejects invalid decimal %s', input => expect(() => toMillimetres(input, 'm')).toThrow());
  it.each([NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, 0.1, MAX_MM + 1, -MAX_MM - 1])('rejects invalid coordinate %s without throwing from safeParse', value => {
    expect(CoordinateMmSchema.safeParse(value).success).toBe(false);
    expect(Point2MmSchema.safeParse({ x: value, z: 0 }).success).toBe(false);
  });
  it.each([0, -1, 0.1, Infinity, NaN])('rejects nonphysical length %s', n => expect(LengthMmSchema.safeParse(n).success).toBe(false));
  it.each([['mm', '1525.000'], ['cm', '152.500'], ['m', '1.525'], ['ft', '5.003'], ['in', '60.039']] as const)('formats %s at a display boundary', (unit, expected) => expect(fromMillimetres(1525, unit)).toBe(expected));
  it('formats negative ties and rejects invalid display precision/unit/range', () => {
    expect(fromMillimetres(-1500, 'm', 0)).toBe('-2');
    expect(fromMillimetres(0, 'm', 2)).toBe('0.00');
    expect(() => fromMillimetres(10, 'm', -1)).toThrow();
    expect(() => fromMillimetres(10, 'm', 13)).toThrow();
    expect(() => toMillimetres('100001', 'm')).toThrow();
  });
  it('reconciles 3000 + 2500 + 3500 = 9000 exactly', () => {
    expect(reconcileDimensions(9000, [3000, 2500, 3500])).toBe(true);
    expect(reconcileDimensions(9000, [3000, 2500, 3501])).toBe(false);
    expect(reconcileDimensions(9000, [])).toBe(false);
  });
});

describe('exact integer-grid polygons and lengths', () => {
  it('measures independent rectangle and concave polygon examples', () => {
    expect(polygonAreaMm2(rectangle(-2000, -3000, 4000, 3000))).toBe('12000000');
    expect(polygonPerimeterMm(rectangle(0, 0, 4000, 3000))).toBe(14000);
    const l = [{ x: 0, z: 0 }, { x: 4000, z: 0 }, { x: 4000, z: 1000 }, { x: 1000, z: 1000 }, { x: 1000, z: 3000 }, { x: 0, z: 3000 }];
    expect(polygonAreaMm2(l)).toBe('6000000');
    expect(polygonAreaMm2([...l].reverse())).toBe('6000000');
    expect(polygonPerimeterMm(l)).toBe(14000);
  });
  it('retains half-mm² and values beyond safe floating-point products', () => {
    expect(polygonAreaMm2([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }])).toBe('0.5');
    expect(polygonAreaMm2(rectangle(-MAX_MM, -MAX_MM, MAX_MM * 2, MAX_MM * 2))).toBe('40000000000000000');
  });
  it.each([[3000, 4000, 5000], [1, 1, 1], [2, 2, 3], [4, 4, 6], [0, 3000, 3000]])('rounds diagonal (%s,%s) to %s mm', (x, z, expected) => expect(segmentLengthMm({ start: { x: 0, z: 0 }, end: { x, z } })).toBe(expected));
  it('deducts voids exactly', () => expect(footprintAreaMm2({ outer: rectangle(0, 0, 10000, 10000), voids: [rectangle(1000, 1000, 2000, 3000)] })).toBe('94000000'));
  it.each([
    [], [{ x: 0, z: 0 }, { x: 1, z: 0 }], rectangle(0, 0, 0, 10),
    [{ x: 0, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }, { x: 4, z: 0 }],
    [...rectangle(0, 0, 10, 10), { x: 0, z: 0 }],
    [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 3 }, { x: 0, z: 3 }],
    [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 2, z: 0 }, { x: 0, z: 4 }],
    [{ x: 0, z: 0 }, { x: 4.5, z: 0 }, { x: 0, z: 4 }],
  ].map(ring => [ring] as const))('rejects malformed ring %#', ring => expect(RingMmSchema.safeParse(ring).success).toBe(false));
  it.each([
    [rectangle(0, 1, 2, 2)], [rectangle(-1, 1, 2, 2)],
    [rectangle(1, 1, 4, 4), rectangle(2, 2, 1, 1)],
    [rectangle(1, 1, 2, 2), rectangle(3, 1, 2, 2)],
  ].map(voids => [voids] as const))('rejects touching, external, overlapping and nested voids %#', voids => expect(FootprintMmSchema.safeParse({ outer: rectangle(0, 0, 10, 10), voids }).success).toBe(false));
  it('permits simple collinear vertices and reversed winding', () => {
    const ring = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
    expect(RingMmSchema.safeParse(ring).success).toBe(true);
    expect(RingMmSchema.safeParse(ring.reverse()).success).toBe(true);
  });
  it('checks full edges across concave notches, not only vertices', () => {
    const notch = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 6, z: 10 }, { x: 6, z: 4 }, { x: 4, z: 4 }, { x: 4, z: 10 }, { x: 0, z: 10 }];
    expect(ringContains(notch, rectangle(1, 1, 8, 8))).toBe(false);
    expect(segmentInRing({ x: 2, z: 8 }, { x: 8, z: 8 }, notch)).toBe(false);
    expect(segmentInRing({ x: 4, z: 8 }, { x: 6, z: 8 }, notch)).toBe(false);
    expect(ringContains(notch, rectangle(0, 0, 10, 4))).toBe(true);
  });
  it('distinguishes overlap, identical rings and touching room boundaries', () => {
    const box = rectangle(0, 0, 10, 10);
    expect(ringsOverlap(box, rectangle(10, 0, 10, 10))).toBe(false);
    expect(ringsOverlap(box, rectangle(5, 0, 10, 10))).toBe(true);
    expect(ringsOverlap(box, [...box].reverse())).toBe(true);
    expect(ringsOverlap(box, rectangle(1, 1, 2, 2))).toBe(true);
    expect(ringsOverlap(box, [{ x: 5, z: 0 }, { x: 10, z: 5 }, { x: 5, z: 10 }, { x: 0, z: 5 }])).toBe(true);
  });
});
