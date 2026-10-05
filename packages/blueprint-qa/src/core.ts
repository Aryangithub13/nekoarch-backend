import { MAX_MM, segmentInRing, type BuildingWall, type RingMm } from '@designflow/shared';
import { Context } from './context.js';
import { area2, areaString, axisOf, bounds, coversSegment, doubled, edgeList, endpointTouches, isRectangle, pathEntersInterior, positiveCollinearOverlap, wallLength, wallSolid2 } from './geometry.js';

export function documentAudit(c: Context): void {
  const m = c.model, ids = new Set<string>(), specs = new Set(m.specifications.map(s => s.id));
  const register = (id: string) => { if (ids.has(id)) c.add('QA_DUPLICATE_ID', 'document', [id], 'Entity ID is not document-unique.', 'unique ID', id); ids.add(id); };
  register(m.id);
  if (m.site) { register(m.site.id); for (const s of m.site.setbacks) register(s.id); for (const p of m.site.parkingZones ?? []) register(p.id); }
  for (const group of [m.levels, m.spaces, m.walls, m.openings, m.stairs, m.slabs, m.columns, m.dimensions, m.specifications]) for (const e of group) {
    register(e.id);
    if ('levelId' in e && e.levelId && !c.levels.has(e.levelId)) c.add('QA_LEVEL_REFERENCE', 'document', [e.id], 'Level reference does not resolve.', 'existing level', e.levelId);
    if ('specificationId' in e && e.specificationId && !specs.has(e.specificationId)) c.add('QA_SPECIFICATION_REFERENCE', 'document', [e.id], 'Specification reference does not resolve.', 'existing specification', e.specificationId);
  }
  for (const s of m.stairs) for (const l of s.landings) register(l.id);
  if (m.provenance.creationMode === 'legacy-adapter' && !m.provenance.adapterVersion) c.add('QA_PROVENANCE_INCOMPLETE', 'document', [m.id], 'Legacy provenance requires its adapter version.');
  if (m.completeness !== 'architectural') {
    c.add('QA_INCOMPLETE_DOCUMENT', 'document', [m.id], 'Architectural QA requires an architectural document; legacy planar input has unknown construction geometry.', 'architectural', m.completeness);
  }
}

export function levelsSiteAudit(c: Context): void {
  const m = c.model, site = m.site;
  if (site) {
    c.report.measurements.siteAreaMm2 = areaString(area2(site.boundary));
    c.report.measurements.buildableAreaMm2 = areaString(area2(site.buildableBoundary ?? site.boundary));
    if (site.buildableBoundary && !c.contains(site.boundary, site.buildableBoundary)) c.add('QA_BUILDABLE_OUTSIDE_SITE', 'site', [site.id], 'Declared buildable region leaves the site polygon.');
    for (const setback of site.setbacks) if (setback.boundaryEdgeStart >= site.boundary.length) c.add('QA_SETBACK_REFERENCE', 'site', [site.id, setback.id], 'Setback edge does not exist.', site.boundary.length - 1, setback.boundaryEdgeStart);
    if (site.setbacks.length && !isRectangle(site.boundary)) {
      c.add('QA_SETBACK_NOT_EVALUATED', 'coverage', [site.id], 'Setback edge distances are supported only for axis-aligned rectangular sites.', 'rectangular site', 'nonrectangular site', {}, 'WARNING');
      c.partial('levels-site', 'Nonrectangular setback interpretation not evaluated');
    }
  } else {
    c.add('QA_SITE_NOT_EVALUATED', 'coverage', [], 'Site containment cannot be evaluated without a supplied site.', 'site polygon', null, {}, 'WARNING');
    c.partial('levels-site', 'Site absent');
  }
  const ordered = [...m.levels].sort((a, b) => a.index - b.index || (a.id < b.id ? -1 : 1));
  const indices = new Set<number>(), elevations = new Set<number>();
  for (let i = 0; i < ordered.length; i++) {
    const l = ordered[i]!, next = ordered[i + 1];
    c.report.measurements.levels.push({ entityId: l.id, elevationMm: l.elevationMm, envelopeAreaMm2: areaString(area2(l.boundary)) });
    if (indices.has(l.index) || elevations.has(l.elevationMm)) c.add('QA_DUPLICATE_LEVEL', 'levels', [l.id], 'Level index and elevation must each be unique.', 'unique index/elevation', { index: l.index, elevationMm: l.elevationMm });
    indices.add(l.index); elevations.add(l.elevationMm);
    if (next && next.elevationMm <= l.elevationMm) c.add('QA_LEVEL_ORDER', 'levels', [l.id, next.id], 'Increasing level indices must have increasing elevations.', `> ${l.elevationMm}`, next.elevationMm);
    if (next && l.floorToFloorHeightMm !== null && next.elevationMm - l.elevationMm !== l.floorToFloorHeightMm) c.add('QA_LEVEL_HEIGHT_MISMATCH', 'levels', [l.id, next.id], 'Floor-to-floor height differs from the next represented elevation.', l.floorToFloorHeightMm, next.elevationMm - l.elevationMm, { deltaMm: next.elevationMm - l.elevationMm - l.floorToFloorHeightMm });
    if (l.floorToFloorHeightMm !== null && l.elevationMm + l.floorToFloorHeightMm > MAX_MM) c.add('QA_VERTICAL_RANGE', 'levels', [l.id], 'Next floor exceeds the V2 coordinate envelope.', MAX_MM, l.elevationMm + l.floorToFloorHeightMm);
    siteContainment(c, l.id, l.boundary);
  }
}

/** Every supplied permitted boundary applies to physical supported geometry too. */
export function siteContainment(c: Context, id: string, ring: RingMm, scale = 1): void {
  const site = c.model.site;
  if (!site) return;
  const permitted = site.buildableBoundary ?? site.boundary;
  if (!c.contains(scale === 2 ? doubled(permitted) : permitted, ring)) c.add('QA_OUTSIDE_BUILDABLE_BOUNDARY', 'site', [id, site.id], 'Geometry extends beyond the supplied site/buildable polygon.', 'contained geometry', 'outside', { coordinateScale: scale });
  if (!isRectangle(site.boundary)) return;
  const b = bounds(site.boundary);
  for (const s of site.setbacks) {
    const a = site.boundary[s.boundaryEdgeStart], end = site.boundary[(s.boundaryEdgeStart + 1) % site.boundary.length];
    if (!a || !end) continue;
    const distances = ring.map(p => a.x === end.x ? (a.x === b.minX ? p.x - scale * a.x : scale * a.x - p.x) : (a.z === b.minZ ? p.z - scale * a.z : scale * a.z - p.z));
    const measured = Math.min(...distances);
    if (measured < scale * s.minimumMm) c.add('QA_DECLARED_SETBACK_VIOLATION', 'site', [id, s.id], 'Geometry violates a caller-declared edge setback.', s.minimumMm, measured / scale, { unit: 'mm', boundaryEdgeStart: s.boundaryEdgeStart });
  }
}

export function spacesAudit(c: Context): void {
  for (const s of c.model.spaces) {
    const b = bounds(s.boundary), l = c.levels.get(s.levelId);
    c.report.measurements.spaces.push({ entityId: s.id, areaMm2: areaString(area2(s.boundary)), xSpanMm: b.maxX - b.minX, zSpanMm: b.maxZ - b.minZ });
    if (s.boundaryBasis !== 'wall-centerline') c.add('QA_SPACE_BOUNDARY_BASIS', 'spaces', [s.id], 'Architectural space requires a known boundary convention.', 'wall-centerline', s.boundaryBasis);
    if (l && !c.contains(l.boundary, s.boundary)) c.add('QA_SPACE_OUTSIDE_LEVEL', 'spaces', [s.id, l.id], 'Space boundary leaves its level envelope.');
  }
  for (let i = 0; i < c.model.spaces.length; i++) for (let j = 0; j < i; j++) {
    c.spend(); const a = c.model.spaces[i]!, b = c.model.spaces[j]!;
    if (a.levelId === b.levelId && c.overlap(a.boundary, b.boundary)) c.add('QA_ROOM_OVERLAP', 'spaces', [a.id, b.id], 'Same-level space interiors overlap; shared boundaries alone are allowed.', 'disjoint interiors', 'positive area overlap');
  }
}

function adjacentSpaces(c: Context, w: BuildingWall): string[] {
  return c.model.spaces.filter(s => {
    c.spend(s.boundary.length);
    return s.levelId === w.levelId && coversSegment(w.path.start, w.path.end, edgeList(s.boundary));
  }).map(s => s.id).sort();
}
export function wallsAudit(c: Context): void {
  const walls = c.model.walls;
  for (const w of walls) {
    const l = c.levels.get(w.levelId), length = wallLength(w), solid = wallSolid2(w);
    const base = l && w.baseOffsetMm !== null ? l.elevationMm + w.baseOffsetMm : null;
    const top = base !== null && w.heightMm !== null ? base + w.heightMm : null;
    c.report.measurements.walls.push({ entityId: w.id, lengthMm: length.lengthMm, lengthBasis: length.exact ? 'exact' : 'rounded-nearest-mm', grossFaceAreaMm2: w.heightMm === null ? null : (BigInt(length.lengthMm) * BigInt(w.heightMm)).toString(), baseMm: base, topMm: top });
    if (w.pathReference !== 'centerline' || w.thicknessMm === null || w.heightMm === null || w.baseOffsetMm === null) c.add('QA_WALL_INCOMPLETE', 'walls', [w.id], 'Wall requires centerline, thickness, base and height.');
    if (l && !segmentInRing(w.path.start, w.path.end, l.boundary)) c.add('QA_WALL_OUTSIDE_LEVEL', 'walls', [w.id, l.id], 'Wall centerline leaves its level envelope.');
    if (top !== null && (top > MAX_MM || top < -MAX_MM)) c.add('QA_VERTICAL_RANGE', 'walls', [w.id], 'Wall top exceeds the V2 coordinate envelope.', MAX_MM, top);
    if (l && w.baseOffsetMm !== null && w.heightMm !== null && l.floorToFloorHeightMm !== null && w.baseOffsetMm + w.heightMm > l.floorToFloorHeightMm) c.add('QA_WALL_ABOVE_STOREY', 'walls', [w.id, l.id], 'Wall top exceeds the declared storey height.', l.floorToFloorHeightMm, w.baseOffsetMm + w.heightMm);
    if (solid) siteContainment(c, w.id, solid, 2);
    else {
      c.add('QA_WALL_SOLID_NOT_EVALUATED', 'coverage', [w.id], 'Physical wall containment and collision need an orthogonal complete centerline wall.', 'orthogonal complete wall', null, {}, 'WARNING');
      c.partial('walls', `Physical footprint unavailable: ${w.id}`);
    }
    const adjacent = adjacentSpaces(c, w); c.wallSpaces.set(w.id, adjacent);
    if (adjacent.length > 2) c.add('QA_WALL_TOPOLOGY', 'walls', [w.id, ...adjacent], 'Wall bounds more than two spaces.', 2, adjacent.length);
    if (w.spaceIds && (new Set(w.spaceIds).size !== w.spaceIds.length || [...w.spaceIds].sort().join('|') !== adjacent.join('|'))) c.add('QA_WALL_SPACE_RELATIONSHIP', 'walls', [w.id], 'Stored space references disagree with independently measured boundary adjacency.', adjacent, w.spaceIds);
    if (w.classification === 'exterior' && adjacent.length >= 2) c.add('QA_WALL_CLASSIFICATION', 'walls', [w.id], 'An exterior wall divides two modeled spaces.', 'at most one adjacent space', adjacent);
    for (const s of c.model.spaces.filter(s => s.levelId === w.levelId)) {
      // Centerline strictly through a space is contradictory; expected half-thickness at its boundary is not.
      c.spend(s.boundary.length * s.boundary.length);
      if (!adjacent.includes(s.id) && pathEntersInterior(w.path.start, w.path.end, s.boundary)) c.add('QA_WALL_INTRUDES_SPACE', 'collisions', [w.id, s.id], 'A wall centerline crosses the interior of a modeled space rather than following its boundary.');
    }
  }
  const touched = new Set<string>();
  for (let i = 0; i < walls.length; i++) for (let j = 0; j < i; j++) {
    c.spend(); const a = walls[i]!, b = walls[j]!;
    if (a.levelId !== b.levelId) continue;
    if (endpointTouches(a, b)) { touched.add(a.id); touched.add(b.id); }
    if (positiveCollinearOverlap(a.path.start, a.path.end, b.path.start, b.path.end)) {
      const identical = ((a.path.start.x === b.path.start.x && a.path.start.z === b.path.start.z && a.path.end.x === b.path.end.x && a.path.end.z === b.path.end.z)
        || (a.path.start.x === b.path.end.x && a.path.start.z === b.path.end.z && a.path.end.x === b.path.start.x && a.path.end.z === b.path.start.z))
        && a.thicknessMm === b.thicknessMm && a.heightMm === b.heightMm && a.baseOffsetMm === b.baseOffsetMm;
      c.add(identical ? 'QA_DUPLICATE_WALL' : 'QA_WALL_INTERVAL_OVERLAP', 'walls', [a.id, b.id], identical ? 'Coincident wall duplicates the same physical interval.' : 'Collinear wall intervals overlap with conflicting extents or properties.');
    } else if (axisOf(a) && axisOf(a) === axisOf(b)) {
      const sa = wallSolid2(a), sb = wallSolid2(b);
      if (sa && sb && c.overlap(sa, sb) && verticalWallsOverlap(a, b)) c.add('QA_PARALLEL_WALL_COLLISION', 'collisions', [a.id, b.id], 'Distinct parallel wall solids overlap.');
    }
  }
  for (const w of walls) if (!touched.has(w.id)) c.add('QA_DISCONNECTED_WALL_FRAGMENT', 'walls', [w.id], 'Wall has no centerline junction with another same-level wall; freestanding intent is not represented.', 'junction or explicit freestanding intent', 'isolated path', {}, 'WARNING');
  // Only assert a gap where some wall already represents the space edge. Completely open boundaries are not silently assumed enclosed.
  for (const s of c.model.spaces) for (const [a, b] of edgeList(s.boundary)) {
    const represented = walls.filter(w => w.levelId === s.levelId && positiveCollinearOverlap(a, b, w.path.start, w.path.end));
    c.spend(walls.length);
    if (represented.length && !coversSegment(a, b, represented.map(w => [w.path.start, w.path.end]))) c.add('QA_WALL_BOUNDARY_GAP', 'walls', [s.id], 'A partially walled space boundary contains an uncovered interval; intentional open boundary semantics are unavailable.', 'continuous represented edge', { start: a, end: b }, {}, 'WARNING');
  }
}
const verticalWallsOverlap = (a: BuildingWall, b: BuildingWall): boolean => a.baseOffsetMm !== null && b.baseOffsetMm !== null && a.heightMm !== null && b.heightMm !== null
  && Math.min(a.baseOffsetMm + a.heightMm, b.baseOffsetMm + b.heightMm) > Math.max(a.baseOffsetMm, b.baseOffsetMm);

export function slabsColumnsAudit(c: Context): void {
  let gross = 0n, invalidFloors = false;
  for (const slab of c.model.slabs) {
    const l = c.levels.get(slab.levelId);
    const net = area2(slab.footprint.outer) - slab.footprint.voids.reduce((sum, hole) => sum + area2(hole), 0n);
    if (slab.kind === 'floor') gross += net;
    if (!l) { if (slab.kind === 'floor') invalidFloors = true; continue; }
    const top = l.elevationMm + slab.topOffsetMm, bottom = top - slab.thicknessMm;
    c.report.measurements.slabs.push({ entityId: slab.id, netAreaMm2: areaString(net), topMm: top, bottomMm: bottom });
    if (!c.contains(l.boundary, slab.footprint.outer)) c.add('QA_SLAB_OUTSIDE_LEVEL', 'slabs', [slab.id, l.id], 'Plate footprint leaves its level envelope.');
    siteContainment(c, slab.id, slab.footprint.outer);
    if (Math.abs(top) > MAX_MM || Math.abs(bottom) > MAX_MM) c.add('QA_VERTICAL_RANGE', 'slabs', [slab.id], 'Plate top or bottom exceeds the V2 coordinate envelope.', MAX_MM, { topMm: top, bottomMm: bottom });
    // Shape validation already independently verifies positive, simple and contained/disjoint void polygons.
  }
  for (let i = 0; i < c.model.slabs.length; i++) for (let j = 0; j < i; j++) {
    c.spend(); const a = c.model.slabs[i]!, b = c.model.slabs[j]!;
    const al = c.levels.get(a.levelId), bl = c.levels.get(b.levelId);
    if (!al || !bl) continue;
    const at = al.elevationMm + a.topOffsetMm, bt = bl.elevationMm + b.topOffsetMm;
    if (at > bt - b.thicknessMm && bt > at - a.thicknessMm
      && c.overlap(a.footprint.outer, b.footprint.outer)
      && !a.footprint.voids.some(h => c.contains(h, b.footprint.outer))
      && !b.footprint.voids.some(h => c.contains(h, a.footprint.outer))) {
      c.add('QA_SLAB_OVERLAP', 'slabs', [a.id, b.id], 'Plate solids penetrate in both plan and elevation.');
      if (a.kind === 'floor' || b.kind === 'floor') invalidFloors = true;
    }
  }
  c.report.measurements.grossFloorAreaMm2 = c.model.slabs.some(s => s.kind === 'floor') && !invalidFloors ? areaString(gross) : null;
  for (const col of c.model.columns) {
    const l = c.levels.get(col.levelId);
    if (!l) continue;
    if (!c.contains(l.boundary, col.crossSection.outer)) c.add('QA_COLUMN_OUTSIDE_LEVEL', 'collisions', [col.id, l.id], 'Column cross-section leaves its level envelope.');
    siteContainment(c, col.id, col.crossSection.outer);
    const top = col.baseOffsetMm + col.heightMm;
    if (l.floorToFloorHeightMm !== null && top > l.floorToFloorHeightMm) c.add('QA_COLUMN_ABOVE_STOREY', 'collisions', [col.id], 'Column top exceeds declared storey height.', l.floorToFloorHeightMm, top);
    if (Math.abs(l.elevationMm + top) > MAX_MM || Math.abs(l.elevationMm + col.baseOffsetMm) > MAX_MM) c.add('QA_VERTICAL_RANGE', 'collisions', [col.id], 'Column top or base exceeds the V2 coordinate envelope.');
  }
  for (let i = 0; i < c.model.columns.length; i++) for (let j = 0; j < i; j++) {
    c.spend(); const a = c.model.columns[i]!, b = c.model.columns[j]!;
    const al = c.levels.get(a.levelId), bl = c.levels.get(b.levelId);
    if (!al || !bl) continue;
    const ab = al.elevationMm + a.baseOffsetMm, bb = bl.elevationMm + b.baseOffsetMm;
    if (ab + a.heightMm > bb && bb + b.heightMm > ab
      && c.overlap(a.crossSection.outer, b.crossSection.outer)
      && !a.crossSection.voids.some(h => c.contains(h, b.crossSection.outer))
      && !b.crossSection.voids.some(h => c.contains(h, a.crossSection.outer))) {
      c.add('QA_COLUMN_OVERLAP', 'collisions', [a.id, b.id], 'Column solids penetrate in both plan and elevation.');
    }
  }
  for (const space of c.model.spaces) {
    const floors = c.model.slabs.filter(s => s.kind === 'floor' && s.levelId === space.levelId);
    for (const floor of floors.filter(s => s.topOffsetMm === 0)) for (const hole of floor.footprint.voids) {
      if (!c.overlap(space.boundary, hole)) continue;
      // A represented flight can occupy its own opening. A stairwell label alone
      // cannot excuse an unrelated void or missing landing support.
      const flight = c.model.stairs.some(stair => stair.toLevelId === space.levelId
        && c.contains(space.boundary, stair.footprint) && c.contains(stair.footprint, hole));
      if (!flight) c.add('QA_SPACE_FLOOR_VOID', 'slabs', [space.id, floor.id], 'A floor void removes occupied space support outside a represented stair flight.');
    }
    if (floors.length === 1 && !c.contains(floors[0]!.footprint.outer, space.boundary)) {
      c.add('QA_SPACE_OUTSIDE_FLOOR', 'slabs', [space.id, floors[0]!.id], 'Space extends beyond the only supplied floor plate outer boundary.', 'containing floor plate', 'outside');
    } else if (floors.length > 1 && !floors.some(s => c.contains(s.footprint.outer, space.boundary))) {
      c.add('QA_SPACE_PLATE_NOT_EVALUATED', 'coverage', [space.id], 'Space is not contained in a single supplied floor plate. Multi-plate union support is not inferred.', 'one containing floor plate', floors.map(s => s.id), {}, 'WARNING');
      c.partial('slabs-columns', 'Multi-plate space support not proven');
    } else if (!floors.length) {
      c.add('QA_SPACE_PLATE_NOT_EVALUATED', 'coverage', [space.id], 'No floor plate is supplied for this space; physical floor support is unknown.', 'floor plate', null, {}, 'WARNING');
      c.partial('slabs-columns', 'Floor plate absent');
    }
  }
}
