import { pointLocation } from '@designflow/shared';
import { Context } from './context.js';
import { area2, bounds, edgeList, isRectangle, openingEnds, rectangle } from './geometry.js';

/** Independent reconstruction: never imports generator placement or scoring. */
export function siteAllocationsAudit(c: Context): void {
  const site = c.model.site;
  if (!site) return;
  const zones = site.parkingZones ?? [], siteBounds = bounds(site.boundary);
  for (const [i, p] of zones.entries()) {
    const b = bounds(p.boundary), zAccess = p.accessSide.endsWith('z'), low = p.accessSide.startsWith('min');
    const width = zAccess ? b.maxX - b.minX : b.maxZ - b.minZ, depth = zAccess ? b.maxZ - b.minZ : b.maxX - b.minX;
    if (!isRectangle(p.boundary) || width !== p.widthMm || depth !== p.depthMm || area2(p.boundary) !== 2n * BigInt(p.widthMm) * BigInt(p.depthMm)) c.add('QA_PARKING_DIMENSIONS', 'site', [p.id], 'Parking boundary must match its declared access-oriented rectangular dimensions.', { widthMm: p.widthMm, depthMm: p.depthMm }, { widthMm: width, depthMm: depth });
    if (!c.contains(site.buildableBoundary ?? site.boundary, p.boundary)) c.add('QA_PARKING_OUTSIDE_SITE', 'site', [p.id], 'Parking allocation leaves the permitted site region.');
    for (const level of c.model.levels) if (c.overlap(p.boundary, level.boundary)) c.add('QA_PARKING_BUILDING_OVERLAP', 'site', [p.id, level.id], 'Parking overlaps a building envelope.');
    for (const other of zones.slice(0, i)) if (c.overlap(p.boundary, other.boundary)) c.add('QA_PARKING_BAY_OVERLAP', 'site', [p.id, other.id], 'Parking allocations overlap.');
    const coordinate = zAccess ? (low ? b.minZ : b.maxZ) : (low ? b.minX : b.maxX);
    const siteCoordinate = zAccess ? (low ? siteBounds.minZ : siteBounds.maxZ) : (low ? siteBounds.minX : siteBounds.maxX);
    const frontage = zAccess ? [{ x: b.minX, z: coordinate }, { x: b.maxX, z: coordinate }] : [{ x: coordinate, z: b.minZ }, { x: coordinate, z: b.maxZ }];
    if (site.accessSide !== p.accessSide || coordinate !== siteCoordinate || frontage.some(point => pointLocation(point, site.boundary) !== 0)) c.add('QA_PARKING_ACCESS', 'site', [p.id], 'Parking needs direct frontage on the explicit outer site access side.');
    for (const s of site.setbacks) {
      const edge = edgeList(site.boundary)[s.boundaryEdgeStart];
      if (!edge || !isRectangle(site.boundary)) continue;
      const [a, end] = edge;
      const measured = a.x === end.x ? (a.x === siteBounds.minX ? b.minX - a.x : a.x - b.maxX) : (a.z === siteBounds.minZ ? b.minZ - a.z : a.z - b.maxZ);
      if (measured < s.minimumMm) c.add('QA_PARKING_SETBACK', 'site', [p.id, s.id], 'Parking leaves the declared allowed setback region.', s.minimumMm, measured);
    }
  }
  if (zones.length) c.add('QA_PARKING_SCOPE_NOT_EVALUATED', 'coverage', zones.map(p => p.id), 'Conceptual parking allocation only; pavement, turning paths, gradients, fire access, accessibility and parking-code compliance are NOT_EVALUATED.', null, null, {}, 'INFO');
  if (!site.primaryEntryOpeningId) return;
  const entry = c.openings.get(site.primaryEntryOpeningId), wall = entry && c.walls.get(entry.wallId);
  const ground = [...c.model.levels].sort((a, b) => a.elevationMm - b.elevationMm)[0];
  if (!entry || !wall || entry.kind !== 'door' || entry.sillMm !== 0 || wall.classification !== 'exterior' || wall.levelId !== ground?.id) {
    c.add('QA_PRIMARY_ENTRY_INVALID', 'site', [site.primaryEntryOpeningId], 'Primary entry must reference a ground-storey exterior door.'); return;
  }
  if (!site.accessSide || !ground) return;
  const endpoints = openingEnds(wall, entry.offsetMm, entry.widthMm), footprint = bounds(ground.boundary), zAccess = site.accessSide.endsWith('z'), low = site.accessSide.startsWith('min');
  if (!endpoints) { c.add('QA_PRIMARY_ENTRY_ACCESS', 'site', [entry.id], 'Explicit axis access needs an orthogonal entry host.'); return; }
  const [a, b] = endpoints, wallAt = zAccess ? a.z : a.x, e = wall.thicknessMm === null ? 0 : wall.thicknessMm / 2;
  const nearFace = wallAt + (low ? -e : e), expected = zAccess ? (low ? footprint.minZ : footprint.maxZ) : (low ? footprint.minX : footprint.maxX);
  if ((zAccess ? a.z !== b.z : a.x !== b.x) || nearFace !== expected) c.add('QA_PRIMARY_ENTRY_ACCESS', 'site', [entry.id], 'Primary entry must face the explicit access side of the building envelope.');
  const edge = zAccess ? (low ? siteBounds.minZ : siteBounds.maxZ) : (low ? siteBounds.minX : siteBounds.maxX);
  if (edge === wallAt) return;
  const route = zAccess ? rectangle(Math.min(a.x, b.x), Math.min(edge, wallAt), Math.max(a.x, b.x), Math.max(edge, wallAt)) : rectangle(Math.min(edge, wallAt), Math.min(a.z, b.z), Math.max(edge, wallAt), Math.max(a.z, b.z));
  if (!c.contains(site.boundary, route) || zones.some(p => c.overlap(route, p.boundary))) c.add('QA_PRIMARY_ENTRY_APPROACH', 'site', [entry.id], 'The direct entry approach crosses excluded site or parking geometry.');
}
