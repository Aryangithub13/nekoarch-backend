import { edges, pointLocation, ringContains, ringsOverlap, type BuildingModelV2, type RingMm } from '@designflow/shared';
import { bounds, rectangle } from '../blueprint/geometry.js';
import { BlueprintError, type Box } from '../blueprint/types.js';
import { SOLVER_V2_LIMITS, type NormalizedBlueprintV2Requirements } from './input.js';
export interface V2Budget { candidates: number; iterations: number; operations: number; checkExecution?: () => void }
export function work(budget: V2Budget, r: NormalizedBlueprintV2Requirements, count = 1): void {
  budget.checkExecution?.();
  if (budget.operations + count > r.solver.maxIterations) throw new BlueprintError('SEARCH_LIMIT_EXHAUSTED', 'Deterministic operation budget exhausted', { operations: budget.operations, maxIterations: r.solver.maxIterations });
  budget.operations += count;
}
export type ParkingZone = NonNullable<NonNullable<BuildingModelV2['site']>['parkingZones']>[number];
export interface SiteProposal { outer: Box; parking: ParkingZone[]; cells: number }
export function permittedSetbackBox(r: NormalizedBlueprintV2Requirements): Box {
  const b = bounds(r.site.boundary), result = { ...b };
  for (const s of r.site.setbacks) {
    const a = r.site.boundary[s.boundaryEdgeStart]!, end = r.site.boundary[(s.boundaryEdgeStart + 1) % r.site.boundary.length]!;
    if (a.x === end.x) { if (a.x === b.x) { result.x += s.minimumMm; result.w -= s.minimumMm; } else result.w -= s.minimumMm; }
    else { if (a.z === b.z) { result.z += s.minimumMm; result.d -= s.minimumMm; } else result.d -= s.minimumMm; }
  }
  return result;
}
function parkingOptions(r: NormalizedBlueprintV2Requirements, permitted: RingMm): ParkingZone[][] {
  const { parking, accessSide } = r.layoutV2;
  if (!parking.count) return [[]];
  const b = bounds(r.site.boundary), alongZ = accessSide!.endsWith('z'), min = accessSide!.startsWith('min');
  const coordinate = alongZ ? (min ? b.z : b.z + b.d) : (min ? b.x : b.x + b.w);
  const axis = alongZ ? 'x' : 'z';
  const fronts = edges(r.site.boundary).filter(([a, end]) => (alongZ ? a.z === coordinate && end.z === coordinate : a.x === coordinate && end.x === coordinate))
    .map(([a, end]) => [Math.min(a[axis], end[axis]), Math.max(a[axis], end[axis])] as const).sort((a, b) => a[0] - b[0]);
  const options: ParkingZone[][] = [];
  for (const [low, high] of fronts) for (const offset of [low, high - parking.widthMm * parking.count]) {
    if (offset < low || offset + parking.widthMm * parking.count > high) continue;
    const zones = Array.from({ length: parking.count }, (_, i): ParkingZone => {
      const across = offset + i * parking.widthMm, depthStart = min ? coordinate : coordinate - parking.depthMm;
      const box = alongZ ? { x: across, z: depthStart, w: parking.widthMm, d: parking.depthMm } : { x: depthStart, z: across, w: parking.depthMm, d: parking.widthMm };
      return { id: `parking-${i + 1}`, kind: 'passenger-car-bay', boundary: rectangle(box), widthMm: parking.widthMm, depthMm: parking.depthMm, accessSide: accessSide!, evaluation: 'conceptual-site-allocation' };
    });
    if (zones.every(zone => ringContains(permitted, zone.boundary) && ringContains(rectangle(permittedSetbackBox(r)), zone.boundary))) options.push(zones);
  }
  if (!options.length) throw new BlueprintError('PARKING_UNSATISFIABLE', 'Requested bay frontage/dimensions cannot fit the explicit permitted access edge');
  return options;
}
/** Coordinate-cell occupancy; maximal rectangles are built from consecutive full rows.
 * No floating grid, bounding-box filling or exponential polygon boolean search. */
export function decomposeSite(r: NormalizedBlueprintV2Requirements, budget: V2Budget): SiteProposal[] {
  const permitted = r.site.buildableBoundary ?? r.site.boundary, inset = permittedSetbackBox(r);
  if (inset.w <= 0 || inset.d <= 0) throw new BlueprintError('PROGRAM_DOES_NOT_FIT', 'Declared setbacks leave no usable region');
  const options = parkingOptions(r, permitted), proposals: SiteProposal[] = [];
  for (const parking of options) {
    const points = [...permitted, ...rectangle(inset), ...parking.flatMap(p => p.boundary)];
    const xs = [...new Set(points.map(p => p.x))].sort((a, b) => a - b), zs = [...new Set(points.map(p => p.z))].sort((a, b) => a - b);
    const cells = (xs.length - 1) * (zs.length - 1);
    if (cells > SOLVER_V2_LIMITS.cells) throw new BlueprintError('SITE_TOO_COMPLEX', 'Orthogonal decomposition exceeds 256 cells');
    const doubled = permitted.map(p => ({ x: 2 * p.x, z: 2 * p.z }));
    const rows = zs.slice(1).map((z, row) => xs.slice(1).map((x, col) => {
      work(budget, r);
      const cell = { x: xs[col]!, z: zs[row]!, w: x - xs[col]!, d: z - zs[row]! };
      return cell.x >= inset.x && cell.z >= inset.z && x <= inset.x + inset.w && z <= inset.z + inset.d
        && pointLocation({ x: xs[col]! + x, z: zs[row]! + z }, doubled) === 1
        && !parking.some(p => ringsOverlap(rectangle(cell), p.boundary));
    }));
    const rectangles: Box[] = [];
    for (let left = 0; left < xs.length - 1; left++) {
      const full = rows.map(() => true);
      for (let right = left + 1; right < xs.length; right++) {
        for (let row = 0; row < rows.length; row++) { work(budget, r); full[row] = full[row]! && rows[row]![right - 1]!; }
        let start = -1;
        for (let row = 0; row <= rows.length; row++) {
          if (full[row] && start < 0) start = row;
          if (!full[row] && start >= 0) {
            const box = { x: xs[left]!, z: zs[start]!, w: xs[right]! - xs[left]!, d: zs[row]! - zs[start]! };
            if (box.w >= 2400 && box.d >= 2400) rectangles.push(box);
            start = -1;
          }
        }
      }
    }
    const maximal = rectangles.filter(a => !rectangles.some(b => b !== a && b.x <= a.x && b.z <= a.z && b.x + b.w >= a.x + a.w && b.z + b.d >= a.z + a.d));
    for (const outer of maximal) {
      work(budget, r, permitted.length);
      if (!ringContains(permitted, rectangle(outer))) throw new BlueprintError('BLUEPRINT_INVARIANT_FAILED', 'Cell decomposition containment failed');
      proposals.push({ outer, parking, cells });
    }
  }
  return proposals.sort((a, b) => b.outer.w * b.outer.d - a.outer.w * a.outer.d || a.outer.x - b.outer.x || a.outer.z - b.outer.z || a.outer.w - b.outer.w || (JSON.stringify(a.parking) < JSON.stringify(b.parking) ? -1 : JSON.stringify(a.parking) > JSON.stringify(b.parking) ? 1 : 0)).slice(0, SOLVER_V2_LIMITS.envelopes);
}
