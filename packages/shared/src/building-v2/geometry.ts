import { z } from 'zod';
import { CoordinateMmSchema } from './units.js';

export const Point2MmSchema = z.object({ x: CoordinateMmSchema, z: CoordinateMmSchema }).strict();
export const Point3MmSchema = Point2MmSchema.extend({ y: CoordinateMmSchema });
export type Point2Mm = z.infer<typeof Point2MmSchema>;
export type Point3Mm = z.infer<typeof Point3MmSchema>;
export type RingMm = Point2Mm[];
const same = (a: Point2Mm, b: Point2Mm) => a.x === b.x && a.z === b.z;
export const cross = (a: Point2Mm, b: Point2Mm, c: Point2Mm): bigint =>
  BigInt(b.x - a.x) * BigInt(c.z - a.z) - BigInt(b.z - a.z) * BigInt(c.x - a.x);
export function onSegment(p: Point2Mm, a: Point2Mm, b: Point2Mm): boolean {
  return cross(a, b, p) === 0n && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)
    && p.z >= Math.min(a.z, b.z) && p.z <= Math.max(a.z, b.z);
}
export function edges(ring: readonly Point2Mm[]): [Point2Mm, Point2Mm][] {
  return ring.map((p, i) => [p, ring[(i + 1) % ring.length]!]);
}
const opposite = (a: bigint, b: bigint) => (a < 0n && b > 0n) || (a > 0n && b < 0n);
export function segmentsCross(a: Point2Mm, b: Point2Mm, c: Point2Mm, d: Point2Mm): boolean {
  return opposite(cross(a, b, c), cross(a, b, d)) && opposite(cross(c, d, a), cross(c, d, b));
}
export function segmentsTouch(a: Point2Mm, b: Point2Mm, c: Point2Mm, d: Point2Mm): boolean {
  return segmentsCross(a, b, c, d) || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b);
}
export function signedArea2(ring: readonly Point2Mm[]): bigint {
  return edges(ring).reduce((sum, [a, b]) => sum + BigInt(a.x) * BigInt(b.z) - BigInt(b.x) * BigInt(a.z), 0n);
}
export const abs = (n: bigint): bigint => n < 0n ? -n : n;

export function isSimpleRing(ring: readonly Point2Mm[]): boolean {
  if (ring.length < 3 || signedArea2(ring) === 0n) return false;
  if (new Set(ring.map(p => `${p.x},${p.z}`)).size !== ring.length) return false;
  const spans = edges(ring);
  for (let i = 0; i < spans.length; i++) {
    const [a, b] = spans[i]!;
    const c = spans[(i + 1) % spans.length]![1];
    // A redundant forward collinear point is valid; retraced edges are not.
    if (cross(a, b, c) === 0n && (onSegment(c, a, b) || onSegment(a, b, c))) return false;
    for (let j = i + 1; j < spans.length; j++) {
      if (j === i + 1 || (i === 0 && j === spans.length - 1)) continue;
      const [c, d] = spans[j]!;
      if (segmentsTouch(a, b, c, d)) return false;
    }
  }
  return true;
}

/** -1 outside, 0 boundary, 1 inside. Integer predicates, no epsilon. */
export function pointLocation(point: Point2Mm, ring: readonly Point2Mm[]): -1 | 0 | 1 {
  let inside = false;
  for (const [a, b] of edges(ring)) {
    if (onSegment(point, a, b)) return 0;
    if ((a.z > point.z) !== (b.z > point.z)) {
      const side = cross(a, b, point);
      if ((b.z > a.z && side > 0n) || (b.z < a.z && side < 0n)) inside = !inside;
    }
  }
  return inside ? 1 : -1;
}

function subsegments(a: Point2Mm, b: Point2Mm, boundary: readonly Point2Mm[]): [Point2Mm, Point2Mm][] {
  const points = [a, b, ...boundary.filter(p => onSegment(p, a, b))];
  points.sort((p, q) => a.x !== b.x ? p.x - q.x : p.z - q.z);
  return points.slice(1).map((p, i) => [points[i]!, p]);
}
function midpointLocation(a: Point2Mm, b: Point2Mm, ring: readonly Point2Mm[]): -1 | 0 | 1 {
  return pointLocation({ x: a.x + b.x, z: a.z + b.z }, ring.map(p => ({ x: p.x * 2, z: p.z * 2 })));
}
export function segmentInRing(a: Point2Mm, b: Point2Mm, ring: readonly Point2Mm[]): boolean {
  if (pointLocation(a, ring) < 0 || pointLocation(b, ring) < 0) return false;
  if (edges(ring).some(([c, d]) => segmentsCross(a, b, c, d))) return false;
  return subsegments(a, b, ring).every(([c, d]) => midpointLocation(c, d, ring) >= 0);
}
export function ringContains(outer: readonly Point2Mm[], inner: readonly Point2Mm[]): boolean {
  return edges(inner).every(([a, b]) => segmentInRing(a, b, outer));
}
export function ringsTouch(a: readonly Point2Mm[], b: readonly Point2Mm[]): boolean {
  return edges(a).some(([p, q]) => edges(b).some(([r, s]) => segmentsTouch(p, q, r, s)));
}
/** Positive-area overlap; a shared boundary alone is allowed. */
export function ringsOverlap(a: readonly Point2Mm[], b: readonly Point2Mm[]): boolean {
  if (edges(a).some(([p, q]) => edges(b).some(([r, s]) => segmentsCross(p, q, r, s)))) return true;
  for (const [one, other] of [[a, b], [b, a]] as const) {
    if (one.some(p => pointLocation(p, other) === 1)) return true;
    if (edges(one).some(([p, q]) => subsegments(p, q, other).some(([r, s]) => !same(r, s) && midpointLocation(r, s, other) === 1))) return true;
  }
  // Coincident edges with interior on the same side include identical polygons.
  const orientationA = signedArea2(a) > 0n ? 1n : -1n;
  const orientationB = signedArea2(b) > 0n ? 1n : -1n;
  return edges(a).some(([p, q]) => edges(b).some(([r, s]) => {
    if (cross(p, q, r) !== 0n || cross(p, q, s) !== 0n) return false;
    const axis = p.x !== q.x ? 'x' : 'z';
    const overlaps = Math.min(Math.max(p[axis], q[axis]), Math.max(r[axis], s[axis])) > Math.max(Math.min(p[axis], q[axis]), Math.min(r[axis], s[axis]));
    const direction = BigInt(q[axis] - p[axis]) * BigInt(s[axis] - r[axis]);
    return overlaps && direction * orientationA * orientationB > 0n;
  }));
}

export const RingMmSchema = z.array(Point2MmSchema).min(3).max(256).superRefine((ring, ctx) => {
  // Collection limits must short-circuit costly refinements even on dirty parses.
  if (ring.length < 3 || ring.length > 256) return;
  // Zod can invoke refinements after a dirty numeric parse: do not feed floats to BigInt.
  if (!ring.every(p => Point2MmSchema.safeParse(p).success)) return;
  if (!isSimpleRing(ring)) ctx.addIssue({ code: 'custom', message: 'Expected a simple nonzero polygon, without closing duplicate or retraced edges' });
});
export const FootprintMmSchema = z.object({ outer: RingMmSchema, voids: z.array(RingMmSchema).max(64) }).strict().superRefine((shape, ctx) => {
  if (shape.voids.length > 64) return;
  if (![shape.outer, ...shape.voids].every(r => RingMmSchema.safeParse(r).success)) return;
  shape.voids.forEach((hole, i) => {
    if (!ringContains(shape.outer, hole) || ringsTouch(shape.outer, hole)) ctx.addIssue({ code: 'custom', path: ['voids', i], message: 'Void must be strictly inside footprint' });
    for (let j = 0; j < i; j++) if (ringsOverlap(hole, shape.voids[j]!) || ringsTouch(hole, shape.voids[j]!)) ctx.addIssue({ code: 'custom', path: ['voids', i], message: 'Voids may not touch, overlap or nest' });
  });
});
export type FootprintMm = z.infer<typeof FootprintMmSchema>;
export const SegmentMmSchema = z.object({ start: Point2MmSchema, end: Point2MmSchema }).strict().refine(s => !same(s.start, s.end), 'Segment must have nonzero length');
export type SegmentMm = z.infer<typeof SegmentMmSchema>;
export const lengthSquared = (segment: SegmentMm): bigint => BigInt(segment.end.x - segment.start.x) ** 2n + BigInt(segment.end.z - segment.start.z) ** 2n;

export function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new RangeError('Negative squared length');
  if (value < 2n) return value;
  let x = value; let next = (x + 1n) / 2n;
  while (next < x) { x = next; next = (x + value / x) / 2n; }
  return x;
}
export function segmentLengthMm(segment: SegmentMm): number {
  SegmentMmSchema.parse(segment);
  const square = lengthSquared(segment); const floor = integerSqrt(square);
  return Number(4n * square >= (2n * floor + 1n) ** 2n ? floor + 1n : floor);
}
