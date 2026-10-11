/**
 * Independent exact geometry for Phase 34. Deliberately not shared with the generator, blueprint QA or BIM, so a defect there cannot
 * hide itself here. Coordinates are integer millimetres; every predicate uses bigint arithmetic; distances are exact rationals.
 */
export type P = { x: number; z: number };
export type Shape = { outer: readonly P[]; voids: readonly (readonly P[])[] };
/** A squared distance n/d (d > 0). */
export type Rational = { n: bigint; d: bigint };

const B = BigInt;
const edgeList = (ring: readonly P[]) => ring.map((p, i) => [p, ring[(i + 1) % ring.length]!] as const);
export const cross = (a: P, b: P, c: P) => B(b.x - a.x) * B(c.z - a.z) - B(b.z - a.z) * B(c.x - a.x);
const dot = (a: P, b: P, c: P) => B(b.x - a.x) * B(c.x - a.x) + B(b.z - a.z) * B(c.z - a.z);
/** Twice the signed area (shoelace), exact. */
export const area2 = (ring: readonly P[]) => edgeList(ring).reduce((s, [a, b]) => s + B(a.x) * B(b.z) - B(b.x) * B(a.z), 0n);
export const absB = (n: bigint) => (n < 0n ? -n : n);
/** Area of a doubled-area integer as an exact decimal string (mm²). */
export const areaString = (doubled: bigint) => `${absB(doubled) / 2n}${absB(doubled) % 2n ? '.5' : ''}`;
export const isRectilinear = (ring: readonly P[]) => edgeList(ring).every(([a, b]) => a.x === b.x || a.z === b.z);

export function onSegment(p: P, a: P, b: P) {
  return cross(a, b, p) === 0n && Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.z, b.z) <= p.z && p.z <= Math.max(a.z, b.z);
}
const sign = (n: bigint) => (n > 0n ? 1 : n < 0n ? -1 : 0);
/** Proper crossing: the segments intersect at a single point interior to both. */
export const properlyCross = (a: P, b: P, c: P, d: P) =>
  sign(cross(a, b, c)) * sign(cross(a, b, d)) < 0 && sign(cross(c, d, a)) * sign(cross(c, d, b)) < 0;
export const segmentsIntersect = (a: P, b: P, c: P, d: P) =>
  properlyCross(a, b, c, d) || onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);

/** 1 inside, 0 on the boundary, -1 outside (exact crossing number). */
export function locate(p: P, ring: readonly P[]): 1 | 0 | -1 {
  let inside = false;
  for (const [a, b] of edgeList(ring)) {
    if (onSegment(p, a, b)) return 0;
    if ((a.z > p.z) !== (b.z > p.z)) {
      // p.x < a.x + (p.z - a.z)(b.x - a.x)/(b.z - a.z), cross-multiplied with the sign of (b.z - a.z).
      const lhs = (B(p.x) - B(a.x)) * (B(b.z) - B(a.z)), rhs = (B(p.z) - B(a.z)) * (B(b.x) - B(a.x));
      if (b.z > a.z ? lhs < rhs : lhs > rhs) inside = !inside;
    }
  }
  return inside ? 1 : -1;
}
/** p → shared → q doubles back on itself (the two edges overlap along a line). */
const retraces = (p: P, shared: P, q: P) => cross(p, shared, q) === 0n && (onSegment(q, p, shared) || onSegment(p, shared, q));
export function isSimple(ring: readonly P[]) {
  if (ring.length < 3 || area2(ring) === 0n || new Set(ring.map(p => `${p.x},${p.z}`)).size !== ring.length) return false;
  const e = edgeList(ring), last = e.length - 1;
  for (let i = 0; i < e.length; i++) for (let j = i + 1; j < e.length; j++) {
    if (j === i + 1) { if (retraces(e[i]![0], e[i]![1], e[j]![1])) return false; }
    else if (i === 0 && j === last) { if (retraces(e[j]![0], e[i]![0], e[i]![1])) return false; }
    else if (segmentsIntersect(e[i]![0], e[i]![1], e[j]![0], e[j]![1])) return false;
  }
  return true;
}
const doubled = (ring: readonly P[]) => ring.map(p => ({ x: p.x * 2, z: p.z * 2 }));
/** Closed containment: every point of `inner` is inside or on `outer`. */
export function contains(outer: readonly P[], inner: readonly P[]) {
  if (inner.some(p => locate(p, outer) < 0)) return false;
  for (const [a, b] of edgeList(inner)) for (const [c, d] of edgeList(outer)) if (properlyCross(a, b, c, d)) return false;
  // Edge midpoints (on the doubled grid) catch an edge that leaves a concave outer ring between two boundary contacts.
  const o2 = doubled(outer);
  if (edgeList(inner).some(([a, b]) => locate({ x: a.x + b.x, z: a.z + b.z }, o2) < 0)) return false;
  return !outer.some(p => locate(p, inner) > 0);
}

// ---- exact distances -----------------------------------------------------------------------------------------------
const lessR = (a: Rational, b: Rational) => a.n * b.d < b.n * a.d;
export function pointSegmentDistance2(p: P, a: P, b: P): Rational {
  const ab2 = dot(a, b, b);
  if (ab2 === 0n || dot(a, b, p) <= 0n) return { n: dot(a, p, p), d: 1n };
  if (dot(a, b, p) >= ab2) return { n: dot(b, p, p), d: 1n };
  const c = cross(a, b, p);
  return { n: c * c, d: ab2 };
}
export function segmentDistance2(a: P, b: P, c: P, d: P): Rational {
  if (segmentsIntersect(a, b, c, d)) return { n: 0n, d: 1n };
  return [pointSegmentDistance2(a, c, d), pointSegmentDistance2(b, c, d), pointSegmentDistance2(c, a, b), pointSegmentDistance2(d, a, b)]
    .reduce((m, r) => (lessR(r, m) ? r : m));
}
export const minRational = (values: Rational[]) => values.reduce((m, r) => (lessR(r, m) ? r : m));
/** Is the exact distance (sqrt of n/d) at least `mm`? Compared on squares, no rounding. */
export const atLeast = (r: Rational, mm: number) => r.n >= B(mm) * B(mm) * r.d;
export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = B(Math.floor(Math.sqrt(Number(n)))) + 1n;
  while (x * x > n) x = (x + n / x) / 2n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
}
/** floor(sqrt(n/d)) = floor(isqrt(n·d)/d). */
export const floorDistance = (r: Rational) => isqrt(r.n * r.d) / r.d;
export const segmentsOf = edgeList;

// ---- rectilinear unions by coordinate compression -------------------------------------------------------------------
export class Budget {
  operations = 0;
  constructor(readonly limit: number) {}
  get exhausted() { return this.operations > this.limit; }
  spend(n: number) { this.operations += n; return !this.exhausted; }
}
const insideShape = (p: P, s: Shape) => locate(p, s.outer) > 0 && s.voids.every(v => locate(p, v) < 0);
/**
 * Exact areas (doubled, so halves stay integral) of `target` cells covered and not covered by the union of `cover`. Every ring
 * must be rectilinear: then grid-cell centres never lie on an edge and each cell is wholly in or out. Returns null when the
 * budget would be exceeded (the caller reports NOT_EVALUATED).
 */
export function coverage(target: readonly Shape[], cover: readonly Shape[], budget: Budget): { targetArea2: bigint; uncovered2: bigint } | null {
  const rings = [...target, ...cover].flatMap(s => [s.outer, ...s.voids]);
  const xs = [...new Set(rings.flatMap(r => r.map(p => p.x)))].sort((a, b) => a - b), zs = [...new Set(rings.flatMap(r => r.map(p => p.z)))].sort((a, b) => a - b);
  const cells = Math.max(0, xs.length - 1) * Math.max(0, zs.length - 1);
  if (!budget.spend(cells * Math.max(1, target.length + cover.length))) return null;
  const t2 = target.map(s => ({ outer: doubled(s.outer), voids: s.voids.map(doubled) })), c2 = cover.map(s => ({ outer: doubled(s.outer), voids: s.voids.map(doubled) }));
  let targetArea2 = 0n, uncovered2 = 0n;
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
    const centre = { x: xs[i]! + xs[i + 1]!, z: zs[j]! + zs[j + 1]! }; // doubled coordinates
    if (!t2.some(s => insideShape(centre, s))) continue;
    const cell2 = 2n * B(xs[i + 1]! - xs[i]!) * B(zs[j + 1]! - zs[j]!);
    targetArea2 += cell2;
    if (!c2.some(s => insideShape(centre, s))) uncovered2 += cell2;
  }
  return { targetArea2, uncovered2 };
}
/** Exact doubled area of a union of rectilinear shapes (null when over budget). */
export function unionArea2(shapes: readonly Shape[], budget: Budget) {
  const r = coverage(shapes, [], budget);
  return r === null ? null : r.targetArea2;
}
export const shapeIsRectilinear = (s: Shape) => isRectilinear(s.outer) && s.voids.every(isRectilinear);
export function gcd(a: bigint, b: bigint): bigint { a = absB(a); b = absB(b); while (b) [a, b] = [b, a % b]; return a; }
