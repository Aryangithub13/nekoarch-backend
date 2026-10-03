import type { z } from 'zod';
import type { BuildingModelV2 } from './model-shape.js';
import { ringContains, ringsOverlap, signedArea2, abs, segmentInRing } from './geometry.js';

/** Optional site allocations do not invent pavement, structure or material scope. */
export function validateSiteAllocations(model: BuildingModelV2, ctx: z.RefinementCtx): void {
  const site = model.site;
  if (!site) return;
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path: ['site', ...path], message });
  const zones = site.parkingZones ?? [];
  zones.forEach((zone, i) => {
    const ring = zone.boundary, xs = ring.map(p => p.x), zs = ring.map(p => p.z);
    const x = Math.min(...xs), z = Math.min(...zs), w = Math.max(...xs) - x, d = Math.max(...zs) - z;
    const alongZ = zone.accessSide.endsWith('z');
    if (ring.length !== 4 || abs(signedArea2(ring)) !== 2n * BigInt(w) * BigInt(d)
      || (alongZ ? w !== zone.widthMm || d !== zone.depthMm : d !== zone.widthMm || w !== zone.depthMm)) issue(['parkingZones', i], 'Bay must be a rectangle with its declared access-oriented dimensions');
    if (!ringContains(site.buildableBoundary ?? site.boundary, ring)) issue(['parkingZones', i], 'Parking must stay in the permitted site region');
    if (model.levels.some(l => ringsOverlap(l.boundary, ring)) || zones.slice(0, i).some(p => ringsOverlap(p.boundary, ring))) issue(['parkingZones', i], 'Parking must not overlap building envelopes or other bays');
    if (site.accessSide !== zone.accessSide) issue(['parkingZones', i], 'Parking requires the same explicit site access side');
    const coordinate = zone.accessSide.startsWith('min') ? (alongZ ? z : x) : (alongZ ? z + d : x + w);
    const siteCoordinate = (zone.accessSide.startsWith('min') ? Math.min : Math.max)(...site.boundary.map(p => alongZ ? p.z : p.x));
    const a = alongZ ? { x, z: coordinate } : { x: coordinate, z }, b = alongZ ? { x: x + w, z: coordinate } : { x: coordinate, z: z + d };
    if (coordinate !== siteCoordinate || !segmentInRing(a, b, site.boundary)) issue(['parkingZones', i], 'Parking frontage must reach the declared outer access edge');
  });
  if (site.primaryEntryOpeningId) {
    const opening = model.openings.find(o => o.id === site.primaryEntryOpeningId);
    const wall = model.walls.find(w => w.id === opening?.wallId);
    const ground = [...model.levels].sort((a, b) => a.elevationMm - b.elevationMm)[0];
    if (!opening || opening.kind !== 'door' || opening.sillMm !== 0 || wall?.classification !== 'exterior' || wall.levelId !== ground?.id) issue(['primaryEntryOpeningId'], 'Primary entry must resolve to a ground-storey exterior door');
  }
}
