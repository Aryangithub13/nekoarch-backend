import type { BuildingModelV2 } from '@designflow/shared';
import { Rational } from '@designflow/construction-calculations';
import { absB, areaString, cross, floorDistance, isqrt, type P, type Rational as Squared } from '../verification/geometry.js';
import type { VerificationReport } from '../verification/contracts.js';

type Level = BuildingModelV2['levels'][number];
type Plate = VerificationReport['bases']['levels'][number];
const B = BigInt;
/** Inverse of areaString: an exact mm² string back to the doubled-area integer. */
export const doubled = (area: string) => B(area.split('.')[0]!) * 2n + (area.endsWith('.5') ? 1n : 0n);

type HeightBasis = 'DECLARED_FLOOR_TO_FLOOR' | 'NEXT_STOREY_ELEVATION' | 'ROOF_LEVEL_ELEVATION' | 'NOT_DETERMINED';

/**
 * Storey heights from the model's own levels (formula model-height-v2, B35.1). Building Model V2 defines `floorToFloorHeightMm` as the distance
 * to the next represented level of any kind (schema invariant and QA_LEVEL_HEIGHT_MISMATCH), so a datum or roof level between two storeys does
 * not end the lower storey. A storey's height is measured to the next storey floor; the uppermost storey's to the lowest roof level above it.
 * A declared floor-to-floor height is the basis only where it reaches exactly that level (the value is then identical) or, for the uppermost
 * storey, where no level is represented above it at all. It never overrides contradictory geometry. Otherwise the height is NOT_DETERMINED.
 * model-height-v1 used a declared height unconditionally, understating storeys that have an intermediate datum or roof level above them.
 * Height is measured from the lowest storey floor: the model carries no ground or road level, so a statutory height is never derived.
 */
export function storeyHeights(model: BuildingModelV2, plates: readonly Plate[]) {
  const storeys = model.levels.filter(l => l.kind === 'storey').sort((a, b) => a.elevationMm - b.elevationMm);
  const plateOf = new Map(plates.map(p => [p.levelId, p]));
  const roofAbove = (level: Level) => model.levels.filter(l => l.kind === 'roof' && l.elevationMm > level.elevationMm).sort((a, b) => a.elevationMm - b.elevationMm)[0];
  // The level a declared floor-to-floor height refers to: the next one by index (index and elevation order agree in a valid model).
  const nextRepresented = (level: Level) => model.levels.filter(l => l.index > level.index).sort((a, b) => a.index - b.index)[0];
  const rows = storeys.map((level, i) => {
    const next = storeys[i + 1], reached = next ?? roofAbove(level), declared = level.floorToFloorHeightMm, following = nextRepresented(level);
    const declaredReaches = (target: Level) => declared !== null && following?.id === target.id && level.elevationMm + declared === target.elevationMm;
    const [storeyHeightMm, storeyHeightBasis]: [number | null, HeightBasis] = reached
      ? [reached.elevationMm - level.elevationMm, declaredReaches(reached) ? 'DECLARED_FLOOR_TO_FLOOR' : next ? 'NEXT_STOREY_ELEVATION' : 'ROOF_LEVEL_ELEVATION']
      : declared !== null && !following ? [declared, 'DECLARED_FLOOR_TO_FLOOR'] : [null, 'NOT_DETERMINED'];
    // B34 always reports a plate for every storey; a missing one would be a contract break, not a zero area.
    const plate = plateOf.get(level.id);
    if (!plate) throw new Error(`No verified plate for storey ${level.id}`);
    return { levelId: level.id, index: level.index, elevationMm: level.elevationMm, storeyHeightMm, storeyHeightBasis, grossPlateAreaMm2: plate.grossPlateAreaMm2, plateMethod: plate.method };
  });
  const top = rows.at(-1), lowest = rows[0];
  const topOfUppermostStoreyMm = top && top.storeyHeightMm !== null ? top.elevationMm + top.storeyHeightMm : null;
  const known = rows.map(r => r.storeyHeightMm).filter((h): h is number => h !== null);
  return { basis: 'MODEL_LEVELS_ABOVE_LOWEST_STOREY_FLOOR' as const, storeyCount: rows.length, lowestStoreyElevationMm: lowest?.elevationMm ?? null, topOfUppermostStoreyMm,
    heightMm: lowest && topOfUppermostStoreyMm !== null ? topOfUppermostStoreyMm - lowest.elevationMm : null,
    storeyHeights: { minMm: known.length ? Math.min(...known) : null, maxMm: known.length ? Math.max(...known) : null, distinctMm: [...new Set(known)].sort((a, b) => a - b) },
    storeys: rows, statutoryHeight: 'NOT_EVALUATED' as const };
}
export type Height = ReturnType<typeof storeyHeights>;

/** Gross volume (formula gross-area-volume-v1): Σ gross plate area × storey height, as a doubled mm³ integer; null if any storey height is unknown. */
export function grossVolume2(height: Height): bigint | null {
  if (!height.storeys.length || height.storeys.some(s => s.storeyHeightMm === null)) return null;
  return height.storeys.reduce((sum, s) => sum + doubled(s.grossPlateAreaMm2) * B(s.storeyHeightMm!), 0n);
}
export const toM2 = (area2: bigint) => new Rational(area2, 2_000_000n);
export const toM3 = (volume2: bigint) => new Rational(volume2, 2_000_000_000n);

/** Andrew's monotone chain on integer points; collinear points are dropped. Returns the hull counter-clockwise. */
export function convexHull(points: readonly P[]): P[] {
  const pts = [...new Map(points.map(p => [`${p.x},${p.z}`, p])).values()].sort((a, b) => a.x - b.x || a.z - b.z);
  if (pts.length < 3) return pts;
  const half = (list: P[]) => list.reduce<P[]>((h, p) => { while (h.length >= 2 && cross(h.at(-2)!, h.at(-1)!, p) <= 0n) h.pop(); h.push(p); return h; }, []);
  const lower = half(pts), upper = half([...pts].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Minimum caliper width of a convex polygon (formula convex-hull-min-width-v1), as an exact squared rational. The minimum width of a convex
 * polygon is attained with one side flush to a hull edge, so it is min over edges of the farthest vertex distance from that edge's line.
 */
export function minimumWidth2(hull: readonly P[]): Squared | null {
  if (hull.length < 3) return null;
  let best: Squared | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!, b = hull[(i + 1) % hull.length]!, len2 = B(b.x - a.x) ** 2n + B(b.z - a.z) ** 2n;
    const far = hull.reduce((m, p) => { const c = absB(cross(a, b, p)); return c > m ? c : m; }, 0n);
    const candidate = { n: far * far, d: len2 };
    if (!best || candidate.n * best.d < best.n * candidate.d) best = candidate;
  }
  return best;
}

/** H / W with W = √(n/d), floored at four decimals: ⌊√(H²·d·10⁸ / n)⌋ / 10⁴ (floor of a floor-divided radicand is exact). */
export function heightToWidth(heightMm: number, width2: Squared) {
  if (width2.n === 0n) return null;
  const s = isqrt(B(heightMm) * B(heightMm) * width2.d * 100_000_000n / width2.n);
  return { decimal: `${s / 10_000n}.${(s % 10_000n).toString().padStart(4, '0')}`, rounding: 'FLOOR_4' as const };
}

export function baseGeometry(model: BuildingModelV2, heightMm: number | null) {
  const lowest = model.levels.filter(l => l.kind === 'storey').sort((a, b) => a.elevationMm - b.elevationMm)[0];
  const hull = lowest ? convexHull(lowest.boundary) : [], width2 = minimumWidth2(hull);
  return { levelId: lowest?.id ?? null, hullVertices: hull.length, minimumWidthMm: width2 ? Number(floorDistance(width2)) : null,
    heightToMinimumWidth: width2 && heightMm !== null ? heightToWidth(heightMm, width2) : null,
    formula: 'Minimum caliper width of the convex hull of the lowest storey envelope (floored mm); ratio = model height / that width, floored at 4 decimals. A geometric indicator only: no limit is applied' };
}
export { areaString };
