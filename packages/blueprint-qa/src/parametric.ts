import { onSegment, signedArea2, type RingMm } from '@designflow/shared';
import type { Context } from './context.js';
import { area2, bounds, coversSegment, doubled, edgeList, wallSolid2 } from './geometry.js';

/** Independent reconstruction: no generator imports, candidate boxes, scores or reported areas. */
export function parametricAudit(c: Context): void {
  const m = c.model, p = m.parametricArchitecture;
  if (!p && !c.options.parametric && m.provenance.generatorVersion !== 'parametric-architecture-v1') return;
  const fail = (code: string, ids: string[], message: string) => c.add(`QA_PARAMETRIC_${code}`, 'policy', ids, message);
  if (!p) { fail('PARAMETERS', [m.id], 'Versioned parametric geometry requires its parameter submodel.'); return; }
  if (c.options.parametric && JSON.stringify(p) !== JSON.stringify(c.options.parametric.architecture)) fail('PARAMETERS', [m.id], 'Model parameters differ from the normalized requested parameters.');
  if (m.columns.length || m.levels.some(l => l.kind !== 'storey') || m.slabs.some(s => !['floor', 'flat-roof'].includes(s.kind))) fail('UNSUPPORTED_COMPONENT', [m.id], 'Columns, datum floors and ceiling plates are outside this parametric family.');
  if (!c.report.circulation.evaluated || c.report.circulation.unreachableSpaceIds.length) fail('REACHABILITY', [m.id], 'Every modeled space must be reachable through valid entrance, door and stair geometry.');
  if (m.levels.length !== p.floors.length || m.levels.length > 2 || m.spaces.length > 28 || m.walls.length > 200 || m.slabs.length > 32) { fail('LIMITS', [m.id], 'Parametric component/floor limits exceeded.'); return; }
  const ext = m.walls.filter(w => w.classification === 'exterior'), interior = m.walls.filter(w => w.classification === 'interior');
  const e = c.options.parametric?.exteriorWallThicknessMm ?? ext[0]?.thicknessMm, t = c.options.parametric?.interiorWallThicknessMm ?? interior[0]?.thicknessMm;
  if (!e || !t || e % 2 || t % 2 || ext.some(w => w.thicknessMm !== e) || interior.some(w => w.thicknessMm !== t)) { fail('WALL_THICKNESS', [m.id], 'Uniform positive even wall thicknesses are required.'); return; }
  const equal = (a: RingMm, b: RingMm) => area2(a) === area2(b) && c.contains(a, b) && c.contains(b, a);
  const makeL = (i: number, inset: number): RingMm => {
    const f = p.floors[i]!, x = p.origin.x, z = p.origin.z;
    return [{ x: x + inset, z: z + inset }, { x: x + f.widthMm - inset, z: z + inset }, { x: x + f.widthMm - inset, z: z + f.southWingDepthMm - inset },
      { x: x + f.westWingWidthMm - inset, z: z + f.southWingDepthMm - inset }, { x: x + f.westWingWidthMm - inset, z: z + f.depthMm - inset }, { x: x + inset, z: z + f.depthMm - inset }];
  };
  for (let i = 0; i < p.floors.length; i++) {
    const level = m.levels.find(l => l.index === i), expected = makeL(i, 0), center = makeL(i, e / 2);
    if (!level || level.id !== `level-${i}` || !equal(level.boundary, expected)) { fail('FOOTPRINT', [level?.id ?? m.id], 'Floor boundary must equal its requested connected L footprint.'); continue; }
    if (i && !c.contains(makeL(i - 1, 0), level.boundary)) fail('UNSUPPORTED_OVERHANG', [level.id], 'Upper floor leaves its supporting lower footprint.');
    const spaces = m.spaces.filter(s => s.levelId === level.id), walls = m.walls.filter(w => w.levelId === level.id);
    if (spaces.reduce((sum, s) => sum + area2(s.boundary), 0n) !== area2(center) || spaces.some(s => !c.contains(center, s.boundary))) fail('SPACE_COVERAGE', [level.id], 'Nonoverlapping spaces must cover the complete inset L, including both wings.');
    for (const s of spaces) {
      for (const [a, b] of edgeList(s.boundary)) {
        c.spend(walls.length);
        if (!coversSegment(a, b, walls.map(w => [w.path.start, w.path.end]))) fail('WALL_GAP', [s.id], 'Every space boundary needs complete wall coverage with hosted openings.');
      }
    }
    for (const w of walls) {
      const onEnvelope = coversSegment(w.path.start, w.path.end, edgeList(center)), solid = wallSolid2(w);
      if ((w.classification === 'exterior') !== onEnvelope || (c.wallSpaces.get(w.id)?.length ?? 0) !== (onEnvelope ? 1 : 2)) fail('WALL_TOPOLOGY', [w.id], 'Wall classification must match the concave envelope and independently reconstructed adjacency.');
      if (!solid || !c.contains(doubled(level.boundary), solid)) fail('WALL_SUPPORT', [w.id], 'Physical wall prism leaves its own floor footprint.');
    }
    const floors = m.slabs.filter(s => s.levelId === level.id && s.kind === 'floor'), plate = floors[0];
    if (floors.length !== 1 || !plate || plate.topOffsetMm !== 0 || !equal(plate.footprint.outer, level.boundary)) fail('SLAB_COVERAGE', [level.id], 'Exactly one floor slab must cover the actual L envelope.');
    if (plate) {
      const stairs = m.stairs.filter(s => s.toLevelId === level.id);
      if (plate.footprint.voids.length !== stairs.length || stairs.some(s => !plate.footprint.voids.some(v => equal(v, s.footprint)))) fail('SLAB_VOID', [plate.id], 'Only exact destination stair-flight voids are supported.');
      for (const space of spaces.filter(s => s.classification !== 'stairwell')) if (plate.footprint.voids.some(v => c.overlap(v, space.boundary))) fail('OCCUPIED_VOID', [space.id, plate.id], 'Occupied/circulation space intersects a floor void.');
    }
    const roofs = m.slabs.filter(s => s.levelId === level.id && s.kind === 'flat-roof'), upper = i + 1 < p.floors.length ? makeL(i + 1, 0) : null;
    if (roofs.reduce((n, s) => n + area2(s.footprint.outer), 0n) !== area2(expected) - (upper ? area2(upper) : 0n)
      || roofs.some(s => s.topOffsetMm !== level.floorToFloorHeightMm || s.footprint.voids.length || (upper && c.overlap(upper, s.footprint.outer)))) fail('ROOF_COVERAGE', [level.id], 'Roof plates must exactly cover exposed lower coverage or the top floor, without voids or duplicate upper support.');
    const corridors = spaces.filter(s => s.classification === 'circulation'), corridor = corridors[0];
    if (corridors.length !== 1 || !corridor) { fail('CORRIDOR', [level.id], 'A single connected L circulation space is required.'); continue; }
    const cb = bounds(corridor.boundary), crossZ = [...new Set(corridor.boundary.map(v => v.z))].sort((a, b) => a - b);
    const width = c.options.parametric?.circulationWidthMm ?? (crossZ[1]! - cb.minZ - (e + t) / 2);
    const x0 = p.origin.x + e / 2, z0 = p.origin.z + e / 2, xW = p.origin.x + p.floors[i]!.widthMm - e / 2, zD = p.origin.z + p.floors[i]!.depthMm - e / 2;
    const core = spaces.find(s => s.classification === 'stairwell'), xS = core ? bounds(core.boundary).maxX : x0;
    const xC = xS + width + (core ? t : (e + t) / 2), zH = z0 + width + (e + t) / 2;
    const corridorExpected = [{ x: x0, z: z0 }, { x: xW, z: z0 }, { x: xW, z: zH }, { x: xC, z: zH }, { x: xC, z: zD }, { x: xS, z: zD }, ...(core ? [{ x: xS, z: zH }, { x: x0, z: zH }] : [])];
    if (width < 600 || !equal(corridor.boundary, corridorExpected)) fail('CORRIDOR', [corridor.id], 'Corridor arms and elbow must preserve the clear requested width.');
  }
  for (const opening of m.openings) {
    const wall = c.walls.get(opening.wallId);
    if (!wall) continue;
    const length = Math.abs(wall.path.end.x - wall.path.start.x) + Math.abs(wall.path.end.z - wall.path.start.z);
    const margin = (end: 'start' | 'end') => Math.max(0, ...m.walls.filter(w => w.levelId === wall.levelId &&
      (w.path.start.x === w.path.end.x) !== (wall.path.start.x === wall.path.end.x) && onSegment(wall.path[end], w.path.start, w.path.end)).map(w => (w.thicknessMm ?? 0) / 2)) + (c.options.parametric?.doorJambMm ?? 0);
    if (opening.offsetMm < margin('start') || opening.offsetMm + opening.widthMm > length - margin('end')) fail('OPENING_CLEARANCE', [opening.id], 'Opening violates perpendicular wall or declared jamb clearance.');
    if (opening.kind === 'window' && wall.classification !== 'exterior') fail('WINDOW_FRONTAGE', [opening.id], 'Windows require an actual exterior facade.');
  }
  for (const ring of [...m.levels.map(l => l.boundary), ...m.spaces.map(s => s.boundary), ...m.slabs.flatMap(s => [s.footprint.outer, ...s.footprint.voids])]) {
    if (ring.length > 8 || signedArea2(ring) <= 0n || edgeList(ring).some(([a, b]) => a.x !== b.x && a.z !== b.z)) fail('BOUNDARY', [m.id], 'Parametric rings require positive winding, bounded orthogonal simple boundaries.');
  }
  if (m.stairs.length !== p.floors.length - 1 || (m.stairs[0] && (m.stairs[0].fromLevelId !== 'level-0' || m.stairs[0].toLevelId !== 'level-1'))) fail('STAIR_COUNT', [m.id], 'The two-floor family requires one aligned inter-floor stair.');
  if (c.options.requiredClearSpaces.length) {
    const actual = m.spaces.filter(s => !['circulation', 'stairwell'].includes(s.classification));
    if (actual.length !== c.options.requiredClearSpaces.length || actual.some(s => !c.options.requiredClearSpaces.some(r => r.id === s.id))) fail('ROOM_PROGRAM', [m.id], 'Occupied room identities/count must equal the requested program.');
  }
}
