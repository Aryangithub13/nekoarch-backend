import { reconcileDimensions, ringContains, type RingMm } from '@designflow/shared';
import { BlueprintError, type Box, type Constraints, type RoomIntent } from './types.js';
import type { NormalizedBlueprintRequirements } from './input.js';

export const rectangle = (b: Box): RingMm => [{ x: b.x, z: b.z }, { x: b.x + b.w, z: b.z }, { x: b.x + b.w, z: b.z + b.d }, { x: b.x, z: b.z + b.d }];
export function bounds(ring: RingMm): Box {
  const x = Math.min(...ring.map(p => p.x)), z = Math.min(...ring.map(p => p.z));
  return { x, z, w: Math.max(...ring.map(p => p.x)) - x, d: Math.max(...ring.map(p => p.z)) - z };
}
function rectangular(ring: RingMm): Box {
  const b = bounds(ring);
  if (ring.length !== 4 || ring.some((p, i) => { const q = ring[(i + 1) % 4]!; return p.x !== q.x && p.z !== q.z; })) throw new BlueprintError('UNSUPPORTED_GEOMETRY', 'Only axis-aligned rectangular sites/buildable regions are supported');
  if (b.w > 60000 || b.d > 60000) throw new BlueprintError('UNSUPPORTED_GEOMETRY', 'Site dimensions exceed the 60000 mm solver envelope');
  return b;
}
export function buildConstraints(r: NormalizedBlueprintRequirements): Constraints {
  const site = rectangular(r.site.boundary);
  let permitted = { ...site };
  for (const setback of r.site.setbacks) {
    const a = r.site.boundary[setback.boundaryEdgeStart]!, b = r.site.boundary[(setback.boundaryEdgeStart + 1) % 4]!;
    const n = setback.minimumMm;
    if (a.x === b.x) { if (a.x === site.x) { permitted.x += n; permitted.w -= n; } else permitted.w -= n; }
    else { if (a.z === site.z) { permitted.z += n; permitted.d -= n; } else permitted.d -= n; }
  }
  if (r.site.buildableBoundary) {
    const supplied = rectangular(r.site.buildableBoundary);
    if (!ringContains(r.site.boundary, r.site.buildableBoundary)) throw new BlueprintError('INVALID_REQUIREMENTS', 'Buildable region lies outside site');
    const right = Math.min(permitted.x + permitted.w, supplied.x + supplied.w), rear = Math.min(permitted.z + permitted.d, supplied.z + supplied.d);
    permitted = { x: Math.max(permitted.x, supplied.x), z: Math.max(permitted.z, supplied.z), w: 0, d: 0 };
    permitted.w = right - permitted.x; permitted.d = rear - permitted.z;
  }
  const e = r.exteriorWallThicknessMm;
  if (permitted.w <= 2 * e || permitted.d <= 2 * e) throw new BlueprintError('IMPOSSIBLE_LAYOUT', 'Setbacks and exterior walls leave no usable footprint');
  const rooms: RoomIntent[] = [], counts: Record<string, number> = {}, loads = [0, 0];
  // Explicit assignments reserve capacity first; automatic rooms balance counts deterministically.
  for (const room of r.rooms) if (room.level !== undefined) loads[room.level]! += room.count;
  for (const requirement of r.rooms) for (let i = 0; i < requirement.count; i++) {
    counts[requirement.type] = (counts[requirement.type] ?? 0) + 1;
    const level = requirement.level ?? (r.floors === 2 && loads[1]! < loads[0]! ? 1 : 0);
    if (requirement.level === undefined) loads[level]!++;
    rooms.push({ key: `${requirement.type}-${counts[requirement.type]}`, level, requirement });
  }
  return { outer: permitted, center: { x: permitted.x + e / 2, z: permitted.z + e / 2, w: permitted.w - e, d: permitted.d - e }, rooms, siteBoundary: rectangle(site), buildableBoundary: rectangle(permitted) };
}
/** Allocate every integer remainder explicitly, earliest segment first. */
export function reconcilePartition(overall: number, minimums: readonly number[]): number[] {
  if (!Number.isSafeInteger(overall) || overall <= 0 || !minimums.length || minimums.some(n => !Number.isSafeInteger(n) || n <= 0)) throw new BlueprintError('DIMENSION_RECONCILIATION_FAILED', 'Invalid partition chain');
  const remaining = overall - minimums.reduce((a, b) => a + b, 0);
  if (remaining < 0) throw new BlueprintError('IMPOSSIBLE_LAYOUT', 'Partition minimums exceed controlling dimension');
  const each = Math.floor(remaining / minimums.length), remainder = remaining % minimums.length;
  const segments = minimums.map((n, i) => n + each + (i < remainder ? 1 : 0));
  if (!reconcileDimensions(overall, segments)) throw new BlueprintError('DIMENSION_RECONCILIATION_FAILED', 'Partition chain failed exact reconciliation');
  return segments;
}
export const transpose = (b: Box): Box => ({ x: b.z, z: b.x, w: b.d, d: b.w });
export function sharedEdge(a: Box, b: Box): number {
  if (a.x + a.w === b.x || b.x + b.w === a.x) return Math.max(0, Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z));
  if (a.z + a.d === b.z || b.z + b.d === a.z) return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  return 0;
}
