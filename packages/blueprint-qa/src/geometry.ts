import { cross, onSegment, pointLocation, segmentsCross, type BuildingWall, type Point2Mm, type RingMm } from '@designflow/shared';

export const abs = (n: bigint): bigint => n < 0n ? -n : n;
export function area2(r: readonly Point2Mm[]): bigint {
  let total = 0n;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, b = r[(i + 1) % r.length]!;
    total += BigInt(a.x) * BigInt(b.z) - BigInt(a.z) * BigInt(b.x);
  }
  return abs(total);
}
export const areaString = (n: bigint): string => `${n / 2n}${n % 2n ? '.5' : ''}`;
export const bounds = (r: readonly Point2Mm[]) => ({
  minX: Math.min(...r.map(p => p.x)), maxX: Math.max(...r.map(p => p.x)),
  minZ: Math.min(...r.map(p => p.z)), maxZ: Math.max(...r.map(p => p.z)),
});
export type Bounds = ReturnType<typeof bounds>;
export function boxesOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}
export const rectangle = (minX: number, minZ: number, maxX: number, maxZ: number): RingMm => [
  { x: minX, z: minZ }, { x: maxX, z: minZ }, { x: maxX, z: maxZ }, { x: minX, z: maxZ },
];
export const doubled = (r: readonly Point2Mm[]): RingMm => r.map(p => ({ x: p.x * 2, z: p.z * 2 }));
export function isRectangle(r: readonly Point2Mm[]): boolean {
  const b = bounds(r);
  return area2(r) === 2n * BigInt(b.maxX - b.minX) * BigInt(b.maxZ - b.minZ)
    && r.every((p, i) => p.x === r[(i + 1) % r.length]!.x || p.z === r[(i + 1) % r.length]!.z);
}
export const axisOf = (w: BuildingWall): 'x' | 'z' | null => w.path.start.x === w.path.end.x ? 'z' : w.path.start.z === w.path.end.z ? 'x' : null;
export const wallSquare = (w: BuildingWall): bigint => BigInt(w.path.end.x - w.path.start.x) ** 2n + BigInt(w.path.end.z - w.path.start.z) ** 2n;
/** Binary integer root and exact nearest-mm rounding, independent of measurement APIs. */
export function wallLength(w: BuildingWall): { lengthMm: number; exact: boolean } {
  const square = wallSquare(w);
  let low = 0n, high = 300_000_001n;
  while (high - low > 1n) { const mid = (low + high) / 2n; if (mid * mid <= square) low = mid; else high = mid; }
  return { lengthMm: Number(4n * square >= (2n * low + 1n) ** 2n ? low + 1n : low), exact: low * low === square };
}
/** Doubled coordinates retain half-mm faces for odd wall thicknesses exactly. */
export function wallSolid2(w: BuildingWall): RingMm | null {
  const axis = axisOf(w);
  if (!axis || w.thicknessMm === null || w.pathReference !== 'centerline') return null;
  const b = bounds([w.path.start, w.path.end]), t = w.thicknessMm;
  return axis === 'x' ? rectangle(2 * b.minX, 2 * b.minZ - t, 2 * b.maxX, 2 * b.maxZ + t)
    : rectangle(2 * b.minX - t, 2 * b.minZ, 2 * b.maxX + t, 2 * b.maxZ);
}
export function edgeList(r: readonly Point2Mm[]): [Point2Mm, Point2Mm][] { return r.map((p, i) => [p, r[(i + 1) % r.length]!]); }
/** Union of collinear intervals, independent of stored wall.spaceIds. */
export function coversSegment(a: Point2Mm, b: Point2Mm, segments: [Point2Mm, Point2Mm][]): boolean {
  const axis = a.x === b.x ? 'z' : 'x';
  const low = Math.min(a[axis], b[axis]), high = Math.max(a[axis], b[axis]);
  const intervals = segments.filter(([p, q]) => cross(a, b, p) === 0n && cross(a, b, q) === 0n)
    .map(([p, q]) => [Math.max(low, Math.min(p[axis], q[axis])), Math.min(high, Math.max(p[axis], q[axis]))] as const)
    .filter(([start, end]) => end > start).sort((p, q) => p[0] - q[0]);
  let cursor = low;
  for (const [start, end] of intervals) { if (start > cursor) return false; cursor = Math.max(cursor, end); }
  return cursor >= high;
}
export function openingEnds(w: BuildingWall, offset: number, width: number): [Point2Mm, Point2Mm] | null {
  if (!axisOf(w)) return null;
  const point = (d: number) => ({ x: w.path.start.x + Math.sign(w.path.end.x - w.path.start.x) * d, z: w.path.start.z + Math.sign(w.path.end.z - w.path.start.z) * d });
  return [point(offset), point(offset + width)];
}
export function positiveCollinearOverlap(a: Point2Mm, b: Point2Mm, c: Point2Mm, d: Point2Mm): boolean {
  if (cross(a, b, c) !== 0n || cross(a, b, d) !== 0n) return false;
  const axis = a.x === b.x ? 'z' : 'x';
  return Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) > Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
}
export function endpointTouches(a: BuildingWall, b: BuildingWall): boolean {
  return [a.path.start, a.path.end].some(p => onSegment(p, b.path.start, b.path.end))
    || [b.path.start, b.path.end].some(p => onSegment(p, a.path.start, a.path.end));
}
/** Detect a centerline passing through positive-length polygon interior, allowing boundary-only contact. */
export function pathEntersInterior(a: Point2Mm, b: Point2Mm, ring: RingMm): boolean {
  if (pointLocation(a, ring) > 0 || pointLocation(b, ring) > 0 || edgeList(ring).some(([p, q]) => segmentsCross(a, b, p, q))) return true;
  const axis = a.x === b.x ? 'z' : 'x';
  const cuts = [a, b, ...ring.filter(p => onSegment(p, a, b))].sort((p, q) => p[axis] - q[axis]);
  const ring2 = doubled(ring);
  return cuts.slice(1).some((p, i) => {
    const q = cuts[i]!;
    return (p.x !== q.x || p.z !== q.z) && pointLocation({ x: p.x + q.x, z: p.z + q.z }, ring2) > 0;
  });
}
