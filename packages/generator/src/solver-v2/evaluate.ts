import { segmentLengthMm, type BuildingModelV2 } from '@designflow/shared';
import { selectorKey } from '../blueprint/input.js';
import { sharedEdge } from '../blueprint/geometry.js';
import { BlueprintError, type Candidate, type Constraints, type SolvedSpace } from '../blueprint/types.js';
import { SCORE_V2_VERSION, type NormalizedBlueprintV2Requirements } from './input.js';
import { zone } from './topology.js';
import { analyzeCirculation } from '../blueprint/validation.js';
export const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const ratio = (a: number, b: number) => Number(BigInt(a) * 1000n / BigInt(Math.max(1, b)));
const centerDistance2 = (a: SolvedSpace, b: SolvedSpace) => Math.abs(2 * a.clear.x + a.clear.w - 2 * b.clear.x - b.clear.w) + Math.abs(2 * a.clear.z + a.clear.d - 2 * b.clear.z - b.clear.d);
export function cardinalForSide(side: 'min-x' | 'max-x' | 'min-z' | 'max-z', northMilliDegrees: number): 'north' | 'east' | 'south' | 'west' {
  // North=0 points to world -z; positive angle rotates clockwise toward +x.
  const world = { 'min-z': 0, 'max-x': 1, 'max-z': 2, 'min-x': 3 }[side];
  return (['north', 'east', 'south', 'west'] as const)[(world - northMilliDegrees / 90000 + 4) % 4]!;
}
export function evaluateCandidate(r: NormalizedBlueprintV2Requirements, c: Constraints, candidate: Candidate, model: BuildingModelV2) {
  const rooms = candidate.spaces.filter(s => s.role === 'room'), span2 = 2 * (c.outer.w + c.outer.d);
  const graph = analyzeCirculation(model);
  const privateIds = new Set(rooms.filter(s => zone(s.entity.classification) === 'private').map(s => s.entity.id));
  // For each destination, private rooms may be destinations but never transit nodes.
  const privateThroughAccessIds = rooms.filter(target => {
    const reached = new Set([graph.entranceSpaceId]), queue = [...reached];
    for (let i = 0; i < queue.length; i++) {
      if (privateIds.has(queue[i]!) && queue[i] !== target.entity.id) continue;
      for (const edge of graph.edges) {
        const next = edge.from === queue[i] ? edge.to : edge.to === queue[i] ? edge.from : undefined;
        if (next && !reached.has(next)) { reached.add(next); queue.push(next); }
      }
    }
    return !reached.has(target.entity.id);
  }).map(s => s.entity.id);
  const relationships = r.relationships.map(edge => {
    const a = candidate.spaces.find(s => s.key === selectorKey(edge.from))!, b = candidate.spaces.find(s => s.key === selectorKey(edge.to))!;
    const contactMm = a.entity.levelId === b.entity.levelId ? sharedEdge(a.box, b.box) : 0;
    const openings = model.openings.filter(o => model.walls.some(w => w.id === o.wallId && w.spaceIds?.includes(a.entity.id) && w.spaceIds.includes(b.entity.id)) && o.sillMm === 0 && (edge.kind === 'passage' ? o.kind === 'opening' && o.purpose === 'passage' : o.kind === 'door' || o.kind === 'opening' && o.purpose === 'passage'));
    return { from: a.entity.id, to: b.entity.id, kind: edge.kind, strength: edge.strength, contactMm, openingIds: openings.map(o => o.id), satisfied: edge.kind === 'adjacent' ? contactMm >= 1 : openings.length > 0 };
  });
  const separations = r.layoutV2.separations.map(edge => {
    const a = rooms.find(s => s.key === selectorKey(edge.from))!, b = rooms.find(s => s.key === selectorKey(edge.to))!;
    const differentLevels = a.entity.levelId !== b.entity.levelId;
    const clearDistanceMm = Math.max(0, a.clear.x - b.clear.x - b.clear.w, b.clear.x - a.clear.x - a.clear.w)
      + Math.max(0, a.clear.z - b.clear.z - b.clear.d, b.clear.z - a.clear.z - a.clear.d);
    return { from: a.entity.id, to: b.entity.id, strength: edge.strength, weight: edge.weight, minimumClearDistanceMm: edge.minimumClearDistanceMm,
      differentLevels, clearDistanceMm: differentLevels ? null : clearDistanceMm, satisfied: differentLevels || clearDistanceMm >= edge.minimumClearDistanceMm };
  });
  if (relationships.some(e => e.strength === 'hard' && !e.satisfied) || separations.some(e => e.strength === 'hard' && !e.satisfied) || (r.layoutV2.forbidPrivateThroughAccess && privateThroughAccessIds.length > 0)) {
    throw new BlueprintError('UNSATISFIED_HARD_CONSTRAINT', 'Required final-model relationship, separation or privacy is unsatisfied', {
      relationships: relationships.filter(e => e.strength === 'hard' && !e.satisfied).map(e => `${e.kind}:${e.from}/${e.to}`),
      separations: separations.filter(e => e.strength === 'hard' && !e.satisfied).map(e => `${e.from}/${e.to}`),
      privateThroughAccessIds,
    });
  }
  const exposure = rooms.map(room => {
    const hosts = model.walls.filter(w => w.classification === 'exterior' && w.spaceIds?.includes(room.entity.id));
    const lengths: Record<string, number> = {};
    for (const wall of hosts) {
      const side = wall.path.start.x === wall.path.end.x ? (wall.path.start.x === c.center.x ? 'min-x' : 'max-x') : (wall.path.start.z === c.center.z ? 'min-z' : 'max-z');
      lengths[side] = (lengths[side] ?? 0) + segmentLengthMm(wall.path);
    }
    const exteriorLengthMm = Object.values(lengths).reduce((sum, n) => sum + n, 0);
    return { spaceId: room.entity.id, key: room.key, habitable: ['bedroom', 'living', 'study', 'dining'].includes(room.entity.classification), exteriorLengthMm,
      exteriorSides: Object.keys(lengths).sort(), daylightPotential: ratio(exteriorLengthMm, 2 * (room.box.w + room.box.d)), ventilationPotential: Math.max(0, Object.keys(lengths).length - 1) * 1000,
      windowOpeningIds: model.openings.filter(o => o.kind === 'window' && hosts.some(w => w.id === o.wallId)).map(o => o.id) };
  });
  const accessSide = r.layoutV2.accessSide;
  const entry = model.openings.find(o => o.id === model.site?.primaryEntryOpeningId);
  const entryWall = model.walls.find(w => w.id === entry?.wallId);
  const entryPoint = entryWall && entry ? {
    x: entryWall.path.start.x + (entryWall.path.start.x === entryWall.path.end.x ? 0 : entry.offsetMm + Math.floor(entry.widthMm / 2)),
    z: entryWall.path.start.z + (entryWall.path.start.z === entryWall.path.end.z ? 0 : entry.offsetMm + Math.floor(entry.widthMm / 2)),
  } : { x: c.outer.x, z: c.outer.z };
  const privacyEvidence = rooms.filter(s => zone(s.entity.classification) === 'private').map(s => ({ spaceId: s.entity.id,
    entryDistance2Mm: Math.abs(2 * s.clear.x + s.clear.w - 2 * entryPoint.x) + Math.abs(2 * s.clear.z + s.clear.d - 2 * entryPoint.z), level: Number(s.entity.levelId.slice(6)) }));
  const privacy = privacyEvidence.reduce((sum, s) => sum + ratio(s.entryDistance2Mm, span2) + s.level * 250, 0);
  const wet = rooms.filter(s => zone(s.entity.classification) === 'service');
  const servicePairs = wet.flatMap((a, i) => wet.slice(i + 1).filter(b => a.entity.levelId === b.entity.levelId).map(b => ({ from: a.entity.id, to: b.entity.id, centerDistance2Mm: centerDistance2(a, b) })));
  const verticalService = wet.filter(s => s.entity.levelId === 'level-1').map(upper => {
    const lower = wet.filter(s => s.entity.levelId === 'level-0').sort((a, b) => centerDistance2(a, upper) - centerDistance2(b, upper) || compareText(a.key, b.key))[0];
    if (!lower) return { upper: upper.entity.id, lower: null, overlapMm2: 0, overlapPermille: 0, centerDistance2Mm: span2 };
    const a = upper.clear, b = lower.clear, overlapMm2 = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z));
    return { upper: upper.entity.id, lower: lower.entity.id, overlapMm2, overlapPermille: ratio(overlapMm2, Math.min(a.w * a.d, b.w * b.d)), centerDistance2Mm: centerDistance2(upper, lower) };
  });
  const serviceClustering = servicePairs.reduce((sum, p) => sum + ratio(p.centerDistance2Mm, span2), 0) + verticalService.reduce((sum, p) => sum + ratio(p.centerDistance2Mm, span2) + 1000 - p.overlapPermille, 0);
  const preferredDimensions = rooms.reduce((sum, s) => {
    const req = c.rooms.find(room => room.key === s.key)!.requirement;
    return sum + (req.preferredWidthMm === undefined ? 0 : Math.ceil(Math.abs(req.preferredWidthMm - s.clear.w) / 100)) + (req.preferredDepthMm === undefined ? 0 : Math.ceil(Math.abs(req.preferredDepthMm - s.clear.d) / 100));
  }, 0);
  let positionMisses = 0;
  for (const room of c.rooms) if (room.requirement.positionPreference && accessSide) {
    const s = rooms.find(s => s.key === room.key)!, axis = accessSide.endsWith('z') ? 'z' : 'x', size = axis === 'z' ? 'd' : 'w';
    const highHalf = 2 * s.clear[axis] + s.clear[size] >= 2 * c.outer[axis] + c.outer[size];
    const rear = accessSide.startsWith('min') ? highHalf : !highHalf;
    if (rear !== (room.requirement.positionPreference === 'rear')) positionMisses++;
  }
  const orientation = r.layoutV2.cardinalPreferences.map(p => {
    const e = exposure.find(e => e.key === selectorKey(p.room))!;
    return { spaceId: e.spaceId, requested: p.direction, weight: p.weight, satisfied: e.exteriorSides.some(side => cardinalForSide(side as Parameters<typeof cardinalForSide>[0], r.site.northMilliDegrees!) === p.direction) };
  });
  const circulationAreaMm2 = candidate.spaces.filter(s => s.role === 'circulation').reduce((sum, s) => sum + s.clear.w * s.clear.d, 0);
  const components = {
    relationships: relationships.filter(e => e.strength === 'soft' && !e.satisfied).length * 100000,
    separation: separations.reduce((sum, e) => sum + (e.satisfied ? 0 : e.weight * 10000), 0),
    preferredDimensions: preferredDimensions * 100,
    position: positionMisses * 10000,
    orientation: orientation.reduce((sum, p) => sum + (p.satisfied ? 0 : p.weight * 10000), 0),
    circulation: ratio(circulationAreaMm2, c.outer.w * c.outer.d * r.floors),
    privacy: -privacy,
    serviceClustering,
    DAYLIGHT_POTENTIAL: -exposure.filter(e => e.habitable).reduce((sum, e) => sum + e.daylightPotential, 0),
    VENTILATION_POTENTIAL: -exposure.filter(e => e.habitable).reduce((sum, e) => sum + e.ventilationPotential, 0),
    roomShape: rooms.reduce((sum, s) => sum + Math.min(10000, Math.max(0, ratio(Math.max(s.clear.w, s.clear.d), Math.min(s.clear.w, s.clear.d)) - 1500)), 0),
    siteUtilization: -ratio(c.outer.w * c.outer.d, Number(importArea(r.site.buildableBoundary ?? r.site.boundary))),
  };
  const w = r.layoutV2.objectives;
  const total = components.separation + components.relationships + components.preferredDimensions + components.position + components.orientation + components.circulation * w.circulation + components.privacy * w.privacy + components.serviceClustering * w.serviceClustering + components.DAYLIGHT_POTENTIAL * w.daylightPotential + components.VENTILATION_POTENTIAL * w.ventilationPotential + components.roomShape * w.roomShape + components.siteUtilization * w.siteUtilization;
  return { scoreVersion: SCORE_V2_VERSION, total, hardValidity: true, components, relationships, separations, exposure, privacyEvidence, servicePairs, verticalService, orientation,
    circulation: { clearAreaMm2: circulationAreaMm2, privateThroughAccessCount: privateThroughAccessIds.length, privateThroughAccessIds, roomCount: rooms.length }, parking: { status: r.layoutV2.parking.count ? 'MODELED' : 'NOT_REQUESTED', bayIds: model.site?.parkingZones?.map(p => p.id) ?? [] },
    notEvaluated: ['DAYLIGHT_SIMULATION', 'AIRFLOW_SIMULATION', 'CLIMATE', 'SOLAR_POSITION', 'WIND_DIRECTION', 'PARKING_TURNING_PATH', 'PARKING_GRADIENT', 'PARKING_CODE', 'ACCESSIBILITY', 'PLUMBING_DESIGN', 'BUILDING_CODE'] };
}
function importArea(ring: { x: number; z: number }[]): bigint {
  const area2 = ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]!; return sum + BigInt(p.x) * BigInt(q.z) - BigInt(q.x) * BigInt(p.z); }, 0n);
  return (area2 < 0n ? -area2 : area2) / 2n;
}
export type CandidateEvaluation = ReturnType<typeof evaluateCandidate>;
