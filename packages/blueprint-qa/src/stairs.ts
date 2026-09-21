import { segmentInRing, type BuildingSpace, type BuildingStair } from '@designflow/shared';
import { Context } from './context.js';
import { area2, axisOf, bounds, doubled, isRectangle, openingEnds, rectangle, wallSolid2 } from './geometry.js';
import { traversable } from './openings.js';
import { siteContainment } from './core.js';

export function stairCores(c: Context, s: BuildingStair): [BuildingSpace[], BuildingSpace[]] {
  const at = (levelId: string) => c.model.spaces.filter(room => room.levelId === levelId && c.contains(room.boundary, s.footprint));
  return [at(s.fromLevelId), at(s.toLevelId)];
}

/** Full opening interval projects into the landing, with a contained unblocked approach strip. */
function landingAccess(c: Context, stair: BuildingStair, core: BuildingSpace, offset: number): boolean {
  const landing = stair.landings.find(l => l.elevationOffsetMm === offset);
  if (!landing || !c.contains(core.boundary, landing.footprint)) return false;
  if (core.classification !== 'stairwell') return true; // An open stair within the same modeled room needs no invented door.
  const lb = bounds(landing.footprint);
  if (!isRectangle(landing.footprint)) return false;
  return c.model.openings.some(o => {
    if (!traversable(o) || c.invalidOpenings.has(o.id) || o.sillMm !== 0 || o.levelId !== core.levelId) return false;
    const ids = c.openingSpaces.get(o.id) ?? [], w = c.walls.get(o.wallId);
    if (!ids.includes(core.id) || ids.length !== 2 || !w || w.baseOffsetMm !== 0) return false;
    const ends = openingEnds(w, o.offsetMm, o.widthMm);
    if (!ends) return false;
    const ob = bounds(ends), axis = axisOf(w);
    if (axis === 'x' ? ob.minX < lb.minX || ob.maxX > lb.maxX : ob.minZ < lb.minZ || ob.maxZ > lb.maxZ) return false;
    const strip = axis === 'x'
      ? rectangle(ob.minX, Math.min(ob.minZ, lb.minZ), ob.maxX, Math.max(ob.maxZ, lb.maxZ))
      : rectangle(Math.min(ob.minX, lb.minX), ob.minZ, Math.max(ob.maxX, lb.maxX), ob.maxZ);
    if (!c.contains(core.boundary, strip)) return false;
    return !c.model.walls.some(other => {
      if (other.id === w.id || other.levelId !== core.levelId) return false;
      const solid = wallSolid2(other);
      return solid !== null && c.overlap(solid, doubled(strip));
    });
  });
}

export function stairsAudit(c: Context): void {
  for (const s of c.model.stairs) {
    const from = c.levels.get(s.fromLevelId), to = c.levels.get(s.toLevelId), box = bounds(s.footprint);
    const levelRise = from && to ? to.elevationMm - from.elevationMm : null;
    const riserSum = s.riserHeightsMm.reduce((a, b) => a + b, 0), run = (s.riserHeightsMm.length - 1) * s.treadDepthMm;
    const x = box.maxX - box.minX, z = box.maxZ - box.minZ;
    const footprintRun = s.direction.endsWith('x') ? x : z, footprintWidth = s.direction.endsWith('x') ? z : x;
    c.report.measurements.stairs.push({ entityId: s.id, levelRiseMm: levelRise, riserSumMm: riserSum, treadCount: s.riserHeightsMm.length - 1, calculatedRunMm: run, footprintRunMm: footprintRun, footprintWidthMm: footprintWidth });
    const fail = (code: string, message: string, expected: import('./report.js').JsonValue = null, actual: import('./report.js').JsonValue = null, evidence: Record<string, import('./report.js').JsonValue> = {}) => {
      c.invalidStairs.add(s.id); c.add(code, 'stairs', [s.id], message, expected, actual, evidence);
    };
    if (!from || !to || from.id === to.id || levelRise! <= 0) fail('QA_STAIR_LEVEL_PAIR', 'Straight stair must ascend between two existing distinct levels.', 'destination above source', levelRise);
    if (levelRise !== null && (s.riseMm !== levelRise || riserSum !== levelRise)) fail('QA_STAIR_RISE_MISMATCH', 'Stair declared rise and sum of risers must equal destination minus source elevation.', levelRise, { declaredRiseMm: s.riseMm, riserSumMm: riserSum }, { deltaMm: riserSum - levelRise });
    if (levelRise === null && riserSum !== s.riseMm) fail('QA_STAIR_RISE_MISMATCH', 'Riser heights do not sum to the declared rise.', s.riseMm, riserSum, { deltaMm: riserSum - s.riseMm });
    if (run !== s.runMm) fail('QA_STAIR_RUN_MISMATCH', 'Run must equal tread depth times riser count minus one.', run, s.runMm, { deltaMm: s.runMm - run });
    if (footprintRun !== s.runMm || footprintWidth !== s.widthMm || area2(s.footprint) !== 2n * BigInt(x) * BigInt(z)) fail('QA_STAIR_FOOTPRINT_MISMATCH', 'Straight flight footprint must be rectangular and match direction, run and width.', { runMm: s.runMm, widthMm: s.widthMm }, { runMm: footprintRun, widthMm: footprintWidth });
    if (from && to && (!c.contains(from.boundary, s.footprint) || !c.contains(to.boundary, s.footprint))) fail('QA_STAIR_OUTSIDE_LEVEL', 'Flight footprint must lie in both endpoint level envelopes.');
    siteContainment(c, s.id, s.footprint);
    const seenElevations = new Set<number>();
    for (const l of s.landings) {
      if (seenElevations.has(l.elevationOffsetMm) || (l.elevationOffsetMm !== 0 && l.elevationOffsetMm !== s.riseMm)) fail('QA_STAIR_LANDING_ELEVATION', 'Landings must have distinct source/destination offsets.', [0, s.riseMm], l.elevationOffsetMm, { landingId: l.id });
      seenElevations.add(l.elevationOffsetMm);
      const atTop = l.elevationOffsetMm === s.riseMm, level = atTop ? to : from;
      if (level && !c.contains(level.boundary, l.footprint)) fail('QA_STAIR_LANDING_OUTSIDE_LEVEL', 'Landing leaves its level envelope.', level.id, l.id);
      const axis = s.direction.endsWith('x') ? 'x' : 'z';
      const positiveEnd = s.direction.startsWith('+') === atTop;
      const coordinate = axis === 'x' ? (positiveEnd ? box.maxX : box.minX) : (positiveEnd ? box.maxZ : box.minZ);
      const a = axis === 'x' ? { x: coordinate, z: box.minZ } : { x: box.minX, z: coordinate };
      const b = axis === 'x' ? { x: coordinate, z: box.maxZ } : { x: box.maxX, z: coordinate };
      if (!segmentInRing(a, b, l.footprint) || c.overlap(l.footprint, s.footprint)) fail('QA_STAIR_LANDING_GEOMETRY', 'Landing must adjoin the correct flight end at full width without interior overlap.', { start: a, end: b }, l.footprint, { landingId: l.id });
      for (const slab of c.model.slabs.filter(p => p.kind === 'floor' && p.levelId === level?.id)) {
        if (slab.footprint.voids.some(v => c.overlap(v, l.footprint))) fail('QA_STAIR_LANDING_VOID_COLLISION', 'A floor void removes part of the represented landing support.', 'solid plate below landing', slab.id, { landingId: l.id });
      }
    }
    if (from && to && levelRise! > 0) {
      const targetFloors = c.model.slabs.filter(p => p.levelId === to.id && p.kind === 'floor');
      if (!targetFloors.some(p => p.topOffsetMm === 0 && p.footprint.voids.some(v => c.contains(v, s.footprint)))) fail('QA_STAIR_VOID_MISSING', 'Destination floor needs a void containing the entire flight at its endpoint elevation.', 'floor at destination elevation with containing flight void', targetFloors.map(p => ({ id: p.id, topOffsetMm: p.topOffsetMm, voidCount: p.footprint.voids.length })));
      for (const slab of c.model.slabs) {
        const level = c.levels.get(slab.levelId); if (!level) continue;
        const top = level.elevationMm + slab.topOffsetMm;
        if (top > from.elevationMm && top <= to.elevationMm && c.overlap(slab.footprint.outer, s.footprint) && !slab.footprint.voids.some(v => c.contains(v, s.footprint))) fail('QA_STAIR_SOLID_INTERFERENCE', 'An intermediate/destination plate blocks the conservative full-flight penetration envelope.', 'containing slab void', slab.id);
      }
      for (const w of c.model.walls) {
        const level = c.levels.get(w.levelId), solid = wallSolid2(w);
        if (level && solid && w.heightMm !== null && w.baseOffsetMm !== null && level.elevationMm + w.baseOffsetMm < to.elevationMm
          && level.elevationMm + w.baseOffsetMm + w.heightMm > from.elevationMm && c.overlap(solid, doubled(s.footprint))) fail('QA_STAIR_WALL_COLLISION', 'A wall solid intersects the reserved full-flight envelope.', 'unobstructed flight footprint', w.id);
      }
      for (const col of c.model.columns) {
        const level = c.levels.get(col.levelId);
        if (level && level.elevationMm + col.baseOffsetMm < to.elevationMm && level.elevationMm + col.baseOffsetMm + col.heightMm > from.elevationMm
          && c.overlap(col.crossSection.outer, s.footprint) && !col.crossSection.voids.some(v => c.contains(v, s.footprint))) fail('QA_STAIR_COLUMN_COLLISION', 'A column intersects the reserved flight envelope.', 'unobstructed flight footprint', col.id);
      }
    }
    const cores = stairCores(c, s);
    if (cores.some(rooms => rooms.length !== 1)) {
      c.add('QA_STAIR_ACCESS_NOT_EVALUATED', 'coverage', [s.id], 'A unique containing space at both stair ends is needed to reconstruct vertical circulation.', 'one containing space per endpoint', cores.map(rooms => rooms.map(r => r.id)), {}, 'WARNING');
      c.partial('stairs', `Endpoint spaces unresolved: ${s.id}`); c.invalidStairs.add(s.id);
    } else {
      for (const [core, offset] of [[cores[0][0]!, 0], [cores[1][0]!, s.riseMm]] as const) {
        if (!landingAccess(c, s, core, offset)) fail('QA_STAIR_LANDING_INACCESSIBLE', 'Stair landing lacks a contained, unblocked approach at the correct end.', 'accessible endpoint landing', { coreId: core.id, elevationOffsetMm: offset });
      }
      if (!c.invalidStairs.has(s.id)) c.report.circulation.edges.push({ from: cores[0][0]!.id, to: cores[1][0]!.id, via: s.id, kind: 'stair' });
    }
  }
}
