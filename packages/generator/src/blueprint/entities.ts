import { edges, onSegment, segmentLengthMm, type BuildingModelV2, type BuildingWall, type HostedOpening, type Point2Mm } from '@designflow/shared';
import { selectorKey, BLUEPRINT_VERSION, type NormalizedBlueprintRequirements } from './input.js';
import { bounds, rectangle, reconcilePartition, transpose } from './geometry.js';
import { BlueprintError, type Candidate, type Constraints } from './types.js';

export function constructWalls(r: NormalizedBlueprintRequirements, c: Constraints, candidate: Candidate, parametric = false): BuildingWall[] {
  const walls: BuildingWall[] = [];
  for (let level = 0; level < r.floors; level++) {
    const levelId = `level-${level}`;
    const groups = new Map<string, { axis: 'x' | 'z'; fixed: number; spans: { start: number; end: number; spaceId: string }[] }>();
    for (const s of candidate.spaces.filter(s => s.entity.levelId === levelId)) for (const [a, b] of edges(s.entity.boundary)) {
      const axis = a.x === b.x ? 'z' : 'x', fixed = axis === 'x' ? a.z : a.x, key = `${axis}:${fixed}`;
      if (!groups.has(key)) groups.set(key, { axis, fixed, spans: [] });
      groups.get(key)!.spans.push({ start: Math.min(a[axis], b[axis]), end: Math.max(a[axis], b[axis]), spaceId: s.entity.id });
    }
    for (const group of [...groups.values()].sort((a, b) => (a.axis < b.axis ? -1 : a.axis > b.axis ? 1 : 0) || a.fixed - b.fixed)) {
      const cuts = [...new Set(group.spans.flatMap(s => [s.start, s.end]))].sort((a, b) => a - b);
      for (let i = 1; i < cuts.length; i++) {
        const start = cuts[i - 1]!, end = cuts[i]!;
        const spaceIds = group.spans.filter(s => s.start <= start && s.end >= end).map(s => s.spaceId).sort();
        if (!spaceIds.length) continue;
        const point = (value: number): Point2Mm => group.axis === 'x' ? { x: value, z: group.fixed } : { x: group.fixed, z: value };
        const exterior = parametric ? spaceIds.length === 1 : group.axis === 'x' ? group.fixed === c.center.z || group.fixed === c.center.z + c.center.d : group.fixed === c.center.x || group.fixed === c.center.x + c.center.w;
        walls.push({ id: `wall-${level}-${walls.length}`, levelId, path: { start: point(start), end: point(end) }, pathReference: 'centerline',
          thicknessMm: exterior ? r.exteriorWallThicknessMm : r.interiorWallThicknessMm, heightMm: r.floorToFloorHeightMm - r.slabThicknessMm, baseOffsetMm: 0,
          classification: exterior ? 'exterior' : 'interior', spaceIds });
      }
    }
  }
  return walls;
}
export interface ConstructionPolicy { floorBoundaries?: import('@designflow/shared').RingMm[]; generatorVersion?: string; entranceEnd?: 'min' | 'max'; centeredStair?: boolean; stairPosition?: 'front' | 'center' | 'rear'; rankWindows?: boolean }
export function constructModel(r: NormalizedBlueprintRequirements, c: Constraints, candidate: Candidate, policy: ConstructionPolicy = {}): BuildingModelV2 {
  const model: BuildingModelV2 = {
    schemaVersion: 2, id: 'blueprint', name: 'Precision residential blueprint', completeness: 'architectural', units: 'mm', coordinateSystem: 'x-right-y-up-z-depth',
    site: { ...r.site, id: 'site', name: 'Site', boundary: r.site.boundary, buildableBoundary: c.buildableBoundary,
      setbacks: r.site.setbacks.map((s, i) => ({ ...s, id: `setback-${i}` })) },
    levels: Array.from({ length: r.floors }, (_, index) => ({ id: `level-${index}`, name: `Floor ${index + 1}`, index, kind: 'storey', elevationMm: index * r.floorToFloorHeightMm, floorToFloorHeightMm: r.floorToFloorHeightMm, boundary: policy.floorBoundaries?.[index] ?? rectangle(c.outer) })),
    spaces: candidate.spaces.map(s => s.entity), walls: constructWalls(r, c, candidate, !!policy.floorBoundaries), openings: [], stairs: [], slabs: [], columns: [], dimensions: [], specifications: [],
    provenance: { creationMode: 'generated', generatorVersion: policy.generatorVersion ?? BLUEPRINT_VERSION, seed: r.seed, measurementVersion: 'mm-exact/1' },
  };
  function marginAt(wall: BuildingWall, end: 'start' | 'end'): number {
    const vertical = wall.path.start.x === wall.path.end.x;
    const perpendicular = model.walls.filter(other => other.levelId === wall.levelId
      && (other.path.start.x === other.path.end.x) !== vertical
      && onSegment(wall.path[end], other.path.start, other.path.end));
    return Math.max(0, ...perpendicular.map(w => w.thicknessMm! / 2)) + r.door.jambMm;
  }
  function insert(wall: BuildingWall, kind: 'door' | 'opening', coordinate?: number): boolean {
    const length = segmentLengthMm(wall.path);
    const axis = wall.path.start.x === wall.path.end.x ? 'z' : 'x';
    const offsetMm = coordinate === undefined
      ? Math.max(marginAt(wall, 'start'), Math.min(Math.floor((length - r.door.widthMm) / 2), length - r.door.widthMm - marginAt(wall, 'end')))
      : coordinate - wall.path.start[axis] - Math.floor(r.door.widthMm / 2);
    if (offsetMm < marginAt(wall, 'start') || offsetMm + r.door.widthMm > length - marginAt(wall, 'end')) return false;
    if (model.openings.some(o => o.wallId === wall.id && o.offsetMm < offsetMm + r.door.widthMm && o.offsetMm + o.widthMm > offsetMm)) return false;
    const common = { id: `opening-${model.openings.length}`, wallId: wall.id, levelId: wall.levelId, offsetMm, widthMm: r.door.widthMm, heightMm: r.door.heightMm, sillMm: 0, type: kind === 'door' ? 'internal-or-entrance' : 'room-passage' };
    model.openings.push(kind === 'door' ? { ...common, kind, operation: { kind: 'hinged', hinge: 'start', swingSide: 'left', angleMilliDegrees: 90000 } } : { ...common, kind, purpose: 'passage' });
    return true;
  }
  function between(a: string, b: string): BuildingWall | undefined { return model.walls.find(w => w.spaceIds?.includes(a) && w.spaceIds.includes(b) && (!policy.floorBoundaries || !a.startsWith('space-stairwell-') || w.path.start.x === w.path.end.x)); }
  for (const room of candidate.spaces.filter(s => s.role === 'room')) {
    const corridor = `space-corridor-${room.entity.levelId.slice('level-'.length)}`;
    const host = between(room.entity.id, corridor);
    if (!host || !insert(host, 'door')) throw new BlueprintError('IMPOSSIBLE_LAYOUT', 'A required room door cannot fit with jamb clearance');
  }
  const corridor0 = candidate.spaces.find(s => s.key === 'corridor-0')!;
  const local = candidate.axis === 'z' ? corridor0.box : transpose(corridor0.box);
  const entryAlong = local.z + (policy.entranceEnd === 'max' ? local.d : 0);
  const entrancePoint = candidate.axis === 'z' ? { x: local.x + Math.floor(local.w / 2), z: entryAlong } : { x: entryAlong, z: local.x + Math.floor(local.w / 2) };
  const entranceHost = model.walls.find(w => w.levelId === 'level-0' && w.classification === 'exterior' && w.spaceIds?.includes(corridor0.entity.id) && onSegment(entrancePoint, w.path.start, w.path.end));
  if (!entranceHost || !insert(entranceHost, 'door')) throw new BlueprintError('IMPOSSIBLE_LAYOUT', 'Entrance cannot fit the circulation frontage');
  for (const edge of r.relationships.filter(e => e.kind !== 'adjacent')) {
    const a = `space-${selectorKey(edge.from)}`, b = `space-${selectorKey(edge.to)}`, host = between(a, b);
    const installed = host && insert(host, edge.kind === 'passage' ? 'opening' : 'door');
    if (!installed && edge.strength === 'hard') throw new BlueprintError('UNSATISFIED_HARD_CONSTRAINT', 'Required direct connection cannot fit');
    if (!installed && edge.strength === 'soft' && !candidate.warnings.some(w => w.includes(`${selectorKey(edge.from)}/${selectorKey(edge.to)}`))) {
      candidate.score += 1000; candidate.warnings.push(`Unmet ${edge.kind} preference: ${selectorKey(edge.from)}/${selectorKey(edge.to)}`);
    }
  }
  if (r.floors === 2) {
    const config = r.stair!, core = candidate.spaces.find(s => s.key === 'stairwell-0')!;
    const clear = candidate.axis === 'z' ? core.clear : transpose(core.clear);
    const landingDepth = Math.max(config.landingDepthMm, r.door.widthMm + 2 * r.door.jambMm);
    const run = (config.riserCount - 1) * config.treadDepthMm;
    const stairStart = clear.z + (policy.stairPosition === 'rear' ? clear.d - run - 2 * landingDepth : policy.stairPosition === 'center' || (!policy.stairPosition && policy.centeredStair) ? Math.floor((clear.d - run - 2 * landingDepth) / 2) : 0);
    const flight = { x: clear.x, z: stairStart + landingDepth, w: config.widthMm, d: run };
    const bottom = { ...flight, z: stairStart, d: landingDepth }, top = { ...flight, z: flight.z + run, d: landingDepth };
    const world = (box: typeof flight) => rectangle(candidate.axis === 'z' ? box : transpose(box));
    model.stairs.push({ id: 'stair-0', fromLevelId: 'level-0', toLevelId: 'level-1', footprint: world(flight), direction: candidate.axis === 'z' ? '+z' : '+x', widthMm: config.widthMm,
      riseMm: r.floorToFloorHeightMm, runMm: run, treadDepthMm: config.treadDepthMm,
      riserHeightsMm: reconcilePartition(r.floorToFloorHeightMm, Array.from({ length: config.riserCount }, () => 1)),
      landings: [{ id: 'landing-bottom', footprint: world(bottom), elevationOffsetMm: 0 }, { id: 'landing-top', footprint: world(top), elevationOffsetMm: r.floorToFloorHeightMm }] });
    for (const [level, landing] of [[0, bottom], [1, top]] as const) {
      const host = between(`space-stairwell-${level}`, `space-corridor-${level}`);
      if (!host || !insert(host, 'door', landing.z + Math.floor(landing.d / 2))) throw new BlueprintError('STAIR_PLACEMENT_FAILED', 'Landing access door cannot fit');
    }
  }
  for (let level = 0; level < r.floors; level++) model.slabs.push({ id: `slab-${level}`, levelId: `level-${level}`, kind: 'floor', footprint: { outer: policy.floorBoundaries?.[level] ?? rectangle(c.outer), voids: level === 1 ? [model.stairs[0]!.footprint] : [] }, topOffsetMm: 0, thicknessMm: r.slabThicknessMm });
  model.slabs.push({ id: 'roof', levelId: `level-${r.floors - 1}`, kind: 'flat-roof', footprint: { outer: policy.floorBoundaries?.[r.floors - 1] ?? rectangle(c.outer), voids: [] }, topOffsetMm: r.floorToFloorHeightMm, thicknessMm: r.slabThicknessMm });
  if (r.windows.enabled) for (const room of candidate.spaces.filter(s => s.role === 'room')) {
    const hosts = model.walls.filter(w => w.classification === 'exterior' && w.spaceIds?.includes(room.entity.id) && Math.floor((segmentLengthMm(w.path) - r.windows.widthMm) / 2) >= Math.max(marginAt(w, 'start'), marginAt(w, 'end')) && !model.openings.some(o => o.wallId === w.id));
    if (policy.rankWindows) hosts.sort((a, b) => segmentLengthMm(b.path) - segmentLengthMm(a.path) || (a.id < b.id ? -1 : 1));
    const host = hosts[0];
    if (!host) { candidate.warnings.push(`Default window omitted: ${room.key} has no exterior segment with sufficient clearance`); continue; }
    model.openings.push({ id: `opening-${model.openings.length}`, kind: 'window', wallId: host.id, levelId: host.levelId, offsetMm: Math.floor((segmentLengthMm(host.path) - r.windows.widthMm) / 2),
      widthMm: r.windows.widthMm, heightMm: r.windows.heightMm, sillMm: r.windows.sillMm, type: 'default-exterior-window' });
  }
  return model;
}

export function landingDoorFits(model: BuildingModelV2, opening: HostedOpening, landing: { footprint: import('@designflow/shared').RingMm }): boolean {
  const wall = model.walls.find(w => w.id === opening.wallId)!;
  const axis = wall.path.start.x === wall.path.end.x ? 'z' : 'x', b = bounds(landing.footprint);
  const low = axis === 'z' ? b.z : b.x, size = axis === 'z' ? b.d : b.w;
  const start = wall.path.start[axis] + opening.offsetMm;
  return start >= low && start + opening.widthMm <= low + size;
}
