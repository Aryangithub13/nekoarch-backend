import { createHash } from 'node:crypto';
import { pointLocation, ringContains, ringsOverlap, signedArea2, type BuildingModelV2 } from '@designflow/shared';
import type { BimModel } from '../bim/contracts.js';
import { semanticId } from '../bim/core.js';
import { ASSUMPTIONS, CLAIMS, ENVIRONMENTAL_LIMITS, ENVIRONMENTAL_MODEL_VERSION, EnvironmentalError, EnvironmentalModelSchema, NORTH_CONVENTION,
  type EnvironmentalErrorCode, type EnvironmentalInput, type EnvironmentalModel, type EnvironmentalSurface, type SurfaceType } from './contracts.js';
import { assertTimeZone, compass } from './solar.js';
import { mm2ToM2 } from './units.js';

type P = { x: number; z: number };
type Ring = P[];
const fail = (code: EnvironmentalErrorCode, message: string): never => { throw new EnvironmentalError(code, message); };
export const environmentalId = (projectId: string, ...parts: (string | number | null)[]) =>
  `env-${createHash('sha256').update(JSON.stringify([projectId, ENVIRONMENTAL_MODEL_VERSION, ...parts])).digest('hex').slice(0, 40)}`;
const areaMm2 = (ring: Ring) => Number(signedArea2(ring) < 0n ? -signedArea2(ring) : signedArea2(ring)) / 2;
const byId = <T extends { id: string }>(items: T[]) => items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const scaled = (ring: Ring, k: number) => ring.map(p => ({ x: p.x * k, z: p.z * k }));
const DEG = 180 / Math.PI;

/** Input checks that need no geometry: location, orientation, construction references, uniqueness. */
function checkInput(input: EnvironmentalInput) {
  if (input.location) {
    const { latitude, longitude, timezone } = input.location;
    if (!(latitude.value >= -90 && latitude.value <= 90) || !(longitude.value >= -180 && longitude.value <= 180)) fail('ENVIRONMENTAL_LOCATION_INVALID', 'Latitude must lie in [−90, 90] and longitude in [−180, 180] degrees');
    assertTimeZone(timezone);
  }
  const unique = (keys: string[], label: string) => { if (new Set(keys).size !== keys.length) fail('ENVIRONMENTAL_MODEL_INVALID', `Duplicate ${label} key`); };
  unique(input.constructions.map(c => c.key), 'construction'); unique(input.thermalCases.map(c => c.key), 'thermal case'); unique(input.solarInstants.map(i => i.key), 'solar instant');
  unique(input.overrides.map(o => `${o.source.collection}:${o.source.id}`), 'override source');
  const known = new Set(input.constructions.map(c => c.key));
  for (const k of [...Object.values(input.assignments), ...input.overrides.map(o => o.construction)]) if (k !== undefined && !known.has(k)) fail('ENVIRONMENTAL_PROPERTY_MISSING', 'An assignment references an unknown construction');
}

/**
 * Architecture (Phase 23 BIM geometry) + explicit environmental input → environmental-model-v1.
 * Exposure of each wall is decided geometrically (sampled both sides), never from names; properties come only from the input.
 */
export function buildEnvironmentalModel(bim: BimModel, input: EnvironmentalInput): EnvironmentalModel {
  checkInput(input);
  const g: BuildingModelV2 = bim.geometry, pid = bim.binding.projectId, id = (...parts: (string | number | null)[]) => environmentalId(pid, ...parts);
  const levels = new Map(g.levels.map(l => [l.id, l]));
  const storeyOf = (levelId: string) => { const l = levels.get(levelId)!; if (l.floorToFloorHeightMm === null) fail('ENVIRONMENTAL_SOURCE_UNSUPPORTED', 'Every used level needs a floor-to-floor height'); return l; };

  // Zones: one per space, identified by space id.
  const zones = g.spaces.map(s => {
    const l = storeyOf(s.levelId);
    if (s.boundaryBasis !== 'wall-centerline') fail('ENVIRONMENTAL_SOURCE_UNSUPPORTED', 'Spaces need wall-centerline boundaries');
    const floor = mm2ToM2(areaMm2(s.boundary));
    return { id: id('zone', s.id), source: { collection: 'spaces' as const, id: s.id, bimElementId: semanticId(pid, 'space', s.id) }, levelId: s.levelId,
      floorArea: { value: floor, unit: 'm2' as const }, height: { value: l.floorToFloorHeightMm!, unit: 'mm' as const, basis: 'LEVEL_FLOOR_TO_FLOOR' as const },
      volume: { value: floor * l.floorToFloorHeightMm! / 1000, unit: 'm3' as const } };
  });
  if (zones.length > ENVIRONMENTAL_LIMITS.zones) fail('ENVIRONMENTAL_RESOURCE_LIMIT', 'Too many zones');
  const zoneOf = new Map(g.spaces.map(s => [s.id, id('zone', s.id)]));

  // Which spaces lie on each side of a wall, 0.25 mm off the centerline at ¼, ½ and ¾ of its length (coordinates ×4 stay integral).
  const spaceRings = g.spaces.map(s => ({ id: s.id, levelId: s.levelId, ring: scaled(s.boundary, 4) }));
  const inside = (levelId: string, p: P) => spaceRings.filter(s => s.levelId === levelId && pointLocation(p, s.ring) === 1).map(s => s.id);
  const surfaces: EnvironmentalSurface[] = [];
  const override = new Map(input.overrides.map(o => [`${o.source.collection}:${o.source.id}`, o.construction]));
  const constructionFor = (type: SurfaceType, collection: string, sourceId: string): EnvironmentalSurface['construction'] => {
    const k = override.get(`${collection}:${sourceId}`) ?? input.assignments[type], c = input.constructions.find(x => x.key === k);
    return c ? { status: 'SPECIFIED', key: c.key, uValue: { value: c.uValue.value, unit: 'W/(m2*K)' }, provenance: c.provenance } : { status: 'NOT_SPECIFIED', key: null, uValue: null, provenance: null };
  };
  const frame = input.orientation ? compass(input.orientation.northMilliDegrees) : null;
  const orient = (n: [number, number, number]) => ({ tilt: { value: Math.acos(Math.max(-1, Math.min(1, n[1]))) * DEG, unit: 'deg' as const },
    azimuth: frame && n[1] === 0 ? { value: ((Math.atan2(n[0] * frame.east[0] + n[2] * frame.east[2], n[0] * frame.north[0] + n[2] * frame.north[2]) * DEG) % 360 + 360) % 360, unit: 'deg' as const } : null });
  const used = new Set<string>();

  for (const w of g.walls) {
    const a = w.path.start, b = w.path.end, l = storeyOf(w.levelId);
    if (a.x !== b.x && a.z !== b.z) fail('ENVIRONMENTAL_SOURCE_UNSUPPORTED', 'Only axis-aligned walls are supported');
    const len = Math.abs(b.x - a.x) + Math.abs(b.z - a.z), n: P = { x: -Math.sign(b.z - a.z), z: Math.sign(b.x - a.x) }; // left normal, unit
    const sides = [1, 2, 3].map(k => { const p = { x: a.x * 4 + (b.x - a.x) * k, z: a.z * 4 + (b.z - a.z) * k };
      return { left: inside(w.levelId, { x: p.x + n.x, z: p.z + n.z }), right: inside(w.levelId, { x: p.x - n.x, z: p.z - n.z }) }; });
    const exteriorLeft = sides.every(s => s.left.length === 0 && s.right.length > 0), exteriorRight = sides.every(s => s.right.length === 0 && s.left.length > 0);
    const interior = sides.every(s => s.left.length > 0 && s.right.length > 0);
    if (!exteriorLeft && !exteriorRight && !interior) fail('ENVIRONMENTAL_SOURCE_UNSUPPORTED', 'A wall is partly exposed or bounds no space; its envelope role is ambiguous');
    const exterior = !interior;
    if ((exterior && ['interior', 'partition'].includes(w.classification)) || (interior && w.classification === 'exterior'))
      fail('ENVIRONMENTAL_SOURCE_UNSUPPORTED', 'A wall classification contradicts its geometric exposure');
    if (!exterior) continue;
    if (w.heightMm === null || w.baseOffsetMm === null || w.thicknessMm === null || w.pathReference !== 'centerline') fail('ENVIRONMENTAL_SOURCE_UNSUPPORTED', 'Envelope walls need centerline, thickness, height and base offset');
    const out = exteriorLeft ? n : { x: -n.x, z: -n.z }, normal: [number, number, number] = [out.x, 0, out.z];
    const bottom = l.elevationMm + w.baseOffsetMm!, top = bottom + w.heightMm!, storeyTop = l.elevationMm + l.floorToFloorHeightMm!;
    const wallZones = [...new Set(sides.flatMap(s => exteriorLeft ? s.right : s.left))].sort().map(s => zoneOf.get(s)!);
    if (wallZones.length !== 1) fail('ENVIRONMENTAL_SOURCE_UNSUPPORTED', 'An exterior wall bounds several spaces; split it per space');
    const wallId = id('surface', 'EXTERIOR_WALL', 'walls', w.id), hosted = g.openings.filter(o => o.wallId === w.id);
    const openingArea = hosted.reduce((sum, o) => sum + o.widthMm * o.heightMm, 0);
    if (len * w.heightMm! - openingArea <= 0) fail('ENVIRONMENTAL_MODEL_INVALID', 'Openings leave no opaque wall area');
    const classification = { architectural: w.classification, status: w.classification === 'unspecified' ? 'ASSUMED' as const : 'CONSISTENT' as const };
    surfaces.push({ id: wallId, type: 'EXTERIOR_WALL', boundary: 'OUTDOOR', source: { collection: 'walls', id: w.id, bimElementId: semanticId(pid, 'wall', w.id) }, hostSurfaceId: null,
      levelId: w.levelId, zoneIds: wallZones, geometry: { kind: 'VERTICAL_RECTANGLE', start: { ...a }, end: { ...b }, bottomMm: bottom, topMm: top, storeyTopMm: storeyTop, faceOffsetMm: w.thicknessMm! / 2 },
      grossArea: { value: mm2ToM2(len * w.heightMm!), unit: 'm2' }, netArea: { value: mm2ToM2(len * w.heightMm! - openingArea), unit: 'm2' }, normal, ...orient(normal),
      classification, construction: constructionFor('EXTERIOR_WALL', 'walls', w.id) });
    used.add(`walls:${w.id}`);
    for (const o of hosted) {
      const type: SurfaceType = o.kind === 'window' ? 'WINDOW' : o.kind === 'door' ? 'DOOR' : 'OPENING', ux = Math.sign(b.x - a.x), uz = Math.sign(b.z - a.z);
      const start = { x: a.x + ux * o.offsetMm, z: a.z + uz * o.offsetMm }, end = { x: start.x + ux * o.widthMm, z: start.z + uz * o.widthMm };
      // The opening's zone is the space behind its centre, 0.25 mm inside (coordinates ×4).
      const c = { x: (start.x + end.x) * 2 - out.x, z: (start.z + end.z) * 2 - out.z }, behind = inside(w.levelId, c);
      if (behind.length !== 1) fail('ENVIRONMENTAL_SOURCE_UNSUPPORTED', 'An envelope opening does not open onto exactly one space');
      surfaces.push({ id: id('surface', type, 'openings', o.id), type, boundary: 'OUTDOOR', source: { collection: 'openings', id: o.id, bimElementId: semanticId(pid, o.kind === 'opening' ? 'opening' : o.kind, o.id) },
        hostSurfaceId: wallId, levelId: w.levelId, zoneIds: [zoneOf.get(behind[0]!)!],
        geometry: { kind: 'VERTICAL_RECTANGLE', start, end, bottomMm: bottom + o.sillMm, topMm: bottom + o.sillMm + o.heightMm, storeyTopMm: storeyTop, faceOffsetMm: w.thicknessMm! / 2 },
        grossArea: { value: mm2ToM2(o.widthMm * o.heightMm), unit: 'm2' }, netArea: { value: mm2ToM2(o.widthMm * o.heightMm), unit: 'm2' }, normal, ...orient(normal),
        classification, construction: constructionFor(type, 'openings', o.id) });
      used.add(`openings:${o.id}`);
    }
  }

  // Plates: flat roofs face the sky; the lowest level's floor plates sit on the ground (ASSUMED); upper floors must be covered by a lower floor plate.
  const floors = g.slabs.filter(s => s.kind === 'floor'), lowest = Math.min(...floors.map(s => levels.get(s.levelId)!.elevationMm));
  for (const s of g.slabs) {
    if (s.kind === 'ceiling') continue;
    const l = storeyOf(s.levelId), roof = s.kind === 'flat-roof';
    if (!roof && l.elevationMm !== lowest) {
      const below = floors.filter(f => levels.get(f.levelId)!.elevationMm < l.elevationMm);
      if (!below.some(f => ringContains(f.footprint.outer, s.footprint.outer))) fail('ENVIRONMENTAL_SOURCE_UNSUPPORTED', 'An upper floor plate is exposed below; exposed floors are not supported');
      continue;
    }
    const type: SurfaceType = roof ? 'ROOF' : 'GROUND_FLOOR', normal: [number, number, number] = roof ? [0, 1, 0] : [0, -1, 0];
    const area = areaMm2(s.footprint.outer) - s.footprint.voids.reduce((sum, v) => sum + areaMm2(v), 0);
    surfaces.push({ id: id('surface', type, 'slabs', s.id), type, boundary: roof ? 'OUTDOOR' : 'GROUND', source: { collection: 'slabs', id: s.id, bimElementId: semanticId(pid, roof ? 'roof' : 'slab', s.id) },
      hostSurfaceId: null, levelId: s.levelId, zoneIds: g.spaces.filter(x => x.levelId === s.levelId && ringsOverlap(x.boundary, s.footprint.outer)).map(x => zoneOf.get(x.id)!).sort(),
      geometry: { kind: 'HORIZONTAL_POLYGON', outer: s.footprint.outer.map(p => ({ ...p })), voids: s.footprint.voids.map(v => v.map(p => ({ ...p }))), elevationMm: l.elevationMm + s.topOffsetMm },
      grossArea: { value: mm2ToM2(area), unit: 'm2' }, netArea: { value: mm2ToM2(area), unit: 'm2' }, normal, ...orient(normal),
      classification: { architectural: s.kind, status: roof ? 'CONSISTENT' : 'ASSUMED' }, construction: constructionFor(type, 'slabs', s.id) });
    used.add(`slabs:${s.id}`);
  }
  if (surfaces.length > ENVIRONMENTAL_LIMITS.surfaces) fail('ENVIRONMENTAL_RESOURCE_LIMIT', 'Too many envelope surfaces');
  for (const o of input.overrides) if (!used.has(`${o.source.collection}:${o.source.id}`)) fail('ENVIRONMENTAL_MODEL_INVALID', 'An override targets an element that is not an envelope surface');

  // Envelope closure: a zone needs a roof plate on its level, or a floor plate on a level above, overlapping it.
  const uncovered = g.spaces.filter(x => !g.slabs.some(s => ((s.kind === 'flat-roof' && s.levelId === x.levelId)
    || (s.kind === 'floor' && levels.get(s.levelId)!.elevationMm > levels.get(x.levelId)!.elevationMm)) && ringsOverlap(x.boundary, s.footprint.outer))).map(x => zoneOf.get(x.id)!).sort();
  return EnvironmentalModelSchema.parse({ version: ENVIRONMENTAL_MODEL_VERSION, coordinateSystem: 'x-right-y-up-z-depth', units: { length: 'mm', area: 'm2', volume: 'm3', angle: 'deg' },
    binding: { ...bim.binding, bimVersion: bim.version, environmentalModelVersion: ENVIRONMENTAL_MODEL_VERSION }, location: input.location,
    orientation: input.orientation && frame ? { northMilliDegrees: input.orientation.northMilliDegrees, convention: NORTH_CONVENTION, north: frame.north, east: frame.east, up: [0, 1, 0],
      siteNorthMilliDegrees: g.site?.northMilliDegrees ?? null } : null,
    zones: byId(zones), surfaces: byId(surfaces), envelope: { status: uncovered.length ? 'INCOMPLETE' : 'CLOSED', uncoveredZoneIds: uncovered }, assumptions: [...ASSUMPTIONS], claims: CLAIMS });
}
