import { dimensionMeasurements, edges, onSegment, reconcileDimensions, segmentLengthMm, type BuildingDimension, type BuildingModelV2, type BuildingWall, type Point2Mm, type SpaceFinishes } from '@designflow/shared';
import { rectangle, reconcilePartition } from '../blueprint/geometry.js';
import { BlueprintError, type Box } from '../blueprint/types.js';
import { info, type QualityTier, type SpaceKind } from './catalog.js';
import { PROGRAM_VERSION, type NormalizedProgramRequirements } from './input.js';
import { clearOf, STAIR, type Cell, type Layout } from './solve.js';

const CLASSIFICATION: Partial<Record<SpaceKind | 'corridor' | 'stairwell', string>> = {
  corridor: 'circulation', stairwell: 'stairwell', foyer: 'circulation', master: 'bedroom', kids: 'bedroom', guest: 'bedroom', servant: 'bedroom',
  toilet: 'bathroom', restroomMen: 'bathroom', restroomWomen: 'bathroom', family: 'living', office: 'study', library: 'study', cabin: 'study',
};
export const classificationOf = (kind: Cell['kind']) => CLASSIFICATION[kind] ?? kind;

function finishesFor(kind: Cell['kind'], tier: QualityTier): SpaceFinishes | undefined {
  const premium = tier === 'premium' || tier === 'luxury';
  if (kind === 'corridor' || kind === 'stairwell' || kind === 'foyer') return { floor: premium ? 'stone-tile' : 'ceramic-tile', walls: 'paint-warm-neutral', ceiling: 'paint-white' };
  const k = info(kind);
  if (k.category === 'wet') return { floor: 'ceramic-tile', walls: 'ceramic-tile', ceiling: 'paint-white' };
  if (kind === 'kitchen' || kind === 'commercialKitchen' || kind === 'utility' || kind === 'pantry') return { floor: premium ? 'stone-tile' : 'ceramic-tile', walls: 'paint-white', ceiling: 'paint-white' };
  if (kind === 'garage' || kind === 'store' || kind === 'serverRoom') return { floor: 'polished-concrete', walls: 'exposed-plaster', ceiling: 'exposed-concrete' };
  if (k.category === 'private') return { floor: premium ? 'engineered-timber' : 'vinyl', walls: 'paint-warm-neutral', ceiling: 'paint-white' };
  if (kind === 'theatre' || kind === 'conference') return { floor: 'carpet', walls: 'timber-panel', ceiling: 'acoustic-tile' };
  return { floor: premium ? 'stone-tile' : 'ceramic-tile', walls: premium ? 'paint-warm-neutral' : 'paint-white', ceiling: 'paint-white' };
}

interface WorldCell extends Cell { world: Box; spaceId: string }

export function buildModel(r: NormalizedProgramRequirements, layout: Layout, withColumns = false): { model: BuildingModelV2; warnings: string[]; entranceSpaceId: string } {
  const e = r.exteriorWallThicknessMm, t = r.interiorWallThicknessMm, H = r.floorToFloorHeightMm, wallH = H - r.slabThicknessMm;
  const C = layout.center, warnings: string[] = [];
  const toWorld = (b: Box): Box => layout.transposed ? { x: C.x + b.z, z: C.z + b.x, w: b.d, d: b.w } : { x: C.x + b.x, z: C.z + b.z, w: b.w, d: b.d };
  const cells: WorldCell[] = layout.cells.map(c => ({ ...c, world: toWorld(c.box), spaceId: `space-${c.key}` }));
  const byKey = new Map(cells.map(c => [c.key, c]));
  const levelId = (l: number) => `level-${l}`;
  const outerRing = rectangle(layout.outer);
  const model: BuildingModelV2 = {
    schemaVersion: 2, id: 'blueprint', name: r.program.brief ? r.program.brief.slice(0, 120) : `${r.program.buildingType} design`, completeness: 'architectural', units: 'mm', coordinateSystem: 'x-right-y-up-z-depth',
    site: { id: 'site', name: 'Site', boundary: r.site.boundary, buildableBoundary: outerRing, northMilliDegrees: r.site.northMilliDegrees,
      setbacks: r.site.setbacks.map((s, i) => ({ ...s, id: `setback-${i}` })) },
    levels: Array.from({ length: r.floors }, (_, index) => ({ id: levelId(index), name: index === 0 ? 'Ground floor' : `Floor ${index}`, index, kind: 'storey' as const, elevationMm: index * H, floorToFloorHeightMm: H, boundary: outerRing })),
    spaces: cells.map(c => {
      const finishes = finishesFor(c.kind, r.program.qualityTier);
      return { id: c.spaceId, name: c.name, classification: classificationOf(c.kind), levelId: levelId(c.level), boundary: rectangle(c.world), boundaryBasis: 'wall-centerline' as const,
        use: c.kind === 'corridor' ? 'circulation' : c.kind === 'stairwell' ? 'stair core' : info(c.kind).label, ...(finishes ? { finishes } : {}) };
    }),
    walls: [], openings: [], stairs: [], slabs: [], columns: [], dimensions: [], specifications: [],
    provenance: { creationMode: 'generated', generatorVersion: PROGRAM_VERSION, seed: r.seed, measurementVersion: 'mm-exact/1' },
  };

  // Walls: every distinct boundary interval between spaces (or a space and the outside) becomes one centerline wall.
  for (let level = 0; level < r.floors; level++) {
    const groups = new Map<string, { axis: 'x' | 'z'; fixed: number; spans: { start: number; end: number; spaceId: string }[] }>();
    for (const c of cells.filter(c => c.level === level)) for (const [a, b] of edges(rectangle(c.world))) {
      const axis = a.x === b.x ? 'z' : 'x', fixed = axis === 'x' ? a.z : a.x, key = `${axis}:${fixed}`;
      if (!groups.has(key)) groups.set(key, { axis, fixed, spans: [] });
      groups.get(key)!.spans.push({ start: Math.min(a[axis], b[axis]), end: Math.max(a[axis], b[axis]), spaceId: c.spaceId });
    }
    for (const g of [...groups.values()].sort((a, b) => (a.axis < b.axis ? -1 : a.axis > b.axis ? 1 : 0) || a.fixed - b.fixed)) {
      const cuts = [...new Set(g.spans.flatMap(s => [s.start, s.end]))].sort((a, b) => a - b);
      for (let i = 1; i < cuts.length; i++) {
        const start = cuts[i - 1]!, end = cuts[i]!;
        const spaceIds = g.spans.filter(s => s.start <= start && s.end >= end).map(s => s.spaceId).sort();
        if (!spaceIds.length) continue;
        const point = (v: number): Point2Mm => g.axis === 'x' ? { x: v, z: g.fixed } : { x: g.fixed, z: v };
        const exterior = g.axis === 'x' ? g.fixed === C.z || g.fixed === C.z + C.d : g.fixed === C.x || g.fixed === C.x + C.w;
        model.walls.push({ id: `wall-${level}-${model.walls.length}`, levelId: levelId(level), path: { start: point(start), end: point(end) }, pathReference: 'centerline',
          thicknessMm: exterior ? e : t, heightMm: wallH, baseOffsetMm: 0, classification: exterior ? 'exterior' : 'interior', spaceIds });
      }
    }
  }
  const jamb = 50;
  const marginAt = (wall: BuildingWall, end: 'start' | 'end') => {
    const vertical = wall.path.start.x === wall.path.end.x;
    const perpendicular = model.walls.filter(o => o.levelId === wall.levelId && (o.path.start.x === o.path.end.x) !== vertical && onSegment(wall.path[end], o.path.start, o.path.end));
    return Math.max(0, ...perpendicular.map(w => w.thicknessMm! / 2)) + jamb;
  };
  const axisOf = (w: BuildingWall) => w.path.start.x === w.path.end.x ? 'z' : 'x';
  const free = (wall: BuildingWall, offset: number, width: number, sill: number, height: number) => !model.openings.some(o => o.wallId === wall.id && o.offsetMm < offset + width + 100 && o.offsetMm + o.widthMm + 100 > offset && o.sillMm < sill + height && o.sillMm + o.heightMm > sill);
  /** Places a door/opening on the wall: centred, or around a world coordinate along the wall. */
  const insert = (wall: BuildingWall, kind: 'door' | 'garage', width: number, coordinate?: number, hinge: 'start' | 'end' = 'start'): boolean => {
    const length = segmentLengthMm(wall.path), axis = axisOf(wall), lo = marginAt(wall, 'start'), hi = length - width - marginAt(wall, 'end');
    if (hi < lo) return false;
    const wanted = coordinate === undefined ? Math.floor((length - width) / 2) : coordinate - Math.min(wall.path.start[axis], wall.path.end[axis]) - Math.floor(width / 2);
    const offsetMm = Math.max(lo, Math.min(hi, wanted));
    const height = kind === 'garage' ? Math.min(2400, wallH - 150) : 2100;
    if (!free(wall, offsetMm, width, 0, height)) return false;
    const id = `opening-${model.openings.length}`, common = { id, wallId: wall.id, levelId: wall.levelId, offsetMm, widthMm: width, heightMm: height, sillMm: 0 };
    model.openings.push(kind === 'garage' ? { ...common, kind: 'door', type: 'garage-door', operation: { kind: 'unspecified' } } : { ...common, kind: 'door', type: 'internal-or-entrance', operation: { kind: 'hinged', hinge, swingSide: 'left', angleMilliDegrees: 90000 } });
    return true;
  };
  const shared = (a: string, b: string) => model.walls.filter(w => w.spaceIds?.includes(a) && w.spaceIds.includes(b)).sort((x, y) => segmentLengthMm(y.path) - segmentLengthMm(x.path) || (x.id < y.id ? -1 : 1));
  const exteriorOf = (spaceId: string) => model.walls.filter(w => w.classification === 'exterior' && w.spaceIds?.length === 1 && w.spaceIds[0] === spaceId);

  // Stairs: alternating straight flights in a two-lane core (a dog-leg arrangement), one flight per storey.
  const landingAt: Partial<Record<'front' | 'rear', number>> = {};
  if (layout.core && r.floors > 1) {
    const sample = cells.find(c => c.kind === 'stairwell' && c.level === 0)!;
    const local = clearOf(sample.box, { w: layout.transposed ? C.d : C.w, d: layout.transposed ? C.w : C.d }, e, t);
    const run = (STAIR.riserCount - 1) * STAIR.treadDepthMm, frontLanding = Math.floor((local.d - run) / 2), rearLanding = local.d - run - frontLanding;
    if (frontLanding < STAIR.landingMinMm) throw new BlueprintError('STAIR_PLACEMENT_FAILED', 'Stair core is too short for landings');
    // Lanes hug the corridor side of the core so the landing doors open straight onto them.
    const corridorOnRight = sample.box.x + sample.box.w === (layout.cells.find(c => c.kind === 'corridor' && c.level === 0)?.box.x ?? -1);
    const laneX0 = corridorOnRight ? local.x + local.w - 2 * STAIR.widthMm : local.x;
    const laneA = corridorOnRight ? laneX0 + STAIR.widthMm : laneX0, laneB = corridorOnRight ? laneX0 : laneX0 + STAIR.widthMm;
    const front: Box = { x: laneX0, z: local.z, w: 2 * STAIR.widthMm, d: frontLanding };
    const rear: Box = { x: laneX0, z: local.z + frontLanding + run, w: 2 * STAIR.widthMm, d: rearLanding };
    const flightA: Box = { x: laneA, z: local.z + frontLanding, w: STAIR.widthMm, d: run }, flightB: Box = { ...flightA, x: laneB };
    const dir = (positive: boolean) => (layout.transposed ? (positive ? '+x' : '-x') : (positive ? '+z' : '-z')) as '+x' | '-x' | '+z' | '-z';
    for (let k = 0; k < r.floors - 1; k++) {
      const even = k % 2 === 0, flight = even ? flightA : flightB;
      model.stairs.push({ id: `stair-${k}`, fromLevelId: levelId(k), toLevelId: levelId(k + 1), footprint: rectangle(toWorld(flight)), direction: dir(even), widthMm: STAIR.widthMm,
        riseMm: H, runMm: run, treadDepthMm: STAIR.treadDepthMm, riserHeightsMm: reconcilePartition(H, Array.from({ length: STAIR.riserCount }, () => 1)),
        landings: [{ id: `stair-${k}-landing-bottom`, footprint: rectangle(toWorld(even ? front : rear)), elevationOffsetMm: 0 }, { id: `stair-${k}-landing-top`, footprint: rectangle(toWorld(even ? rear : front)), elevationOffsetMm: H }] });
    }
    for (const [name, box] of [['front', front], ['rear', rear]] as const) { const w = toWorld(box); landingAt[name] = layout.transposed ? w.x + Math.floor(w.w / 2) : w.z + Math.floor(w.d / 2); }
    for (let level = 0; level < r.floors; level++) {
      const hall = cells.find(c => c.kind === 'stairwell' && c.level === level)!, corridor = cells.find(c => c.kind === 'corridor' && c.level === level)!;
      const landing = toWorld(level % 2 === 0 ? front : rear);
      const along = layout.transposed ? landing.x + Math.floor(landing.w / 2) : landing.z + Math.floor(landing.d / 2);
      if (!shared(hall.spaceId, corridor.spaceId).some(w => insert(w, 'door', 900, along))) throw new BlueprintError('STAIR_PLACEMENT_FAILED', 'Landing access door cannot fit');
    }
  }
  // Room doors: into the corridor, the hub room, the parent room (en-suites) or the stair hall.
  for (const c of cells.filter(c => c.access)) {
    const target = byKey.get(c.access!);
    if (!target) throw new BlueprintError('BLUEPRINT_INVARIANT_FAILED', 'Door target missing');
    const width = c.kind === 'corridor' || c.kind === 'stairwell' ? 900 : info(c.kind).doorWidthMm;
    // Doors near the corridor end closest to the entrance read better than centred doors on long walls.
    const hosts = shared(c.spaceId, target.spaceId);
    const at = c.landing ? landingAt[c.landing] : undefined;
    if (!hosts.some(w => insert(w, 'door', width, at))) throw new BlueprintError('IMPOSSIBLE_LAYOUT', `${c.name} has no wall long enough for its door`);
  }
  // Related rooms that share a wall get an open passage (open-plan living/dining/kitchen, café counter) or a connecting door.
  const RELATED: [Cell['kind'], Cell['kind'], 'passage' | 'door', number][] = [
    ['kitchen', 'dining', 'passage', 1200], ['living', 'dining', 'passage', 1500], ['family', 'dining', 'passage', 1500], ['counter', 'seating', 'passage', 1500],
    ['counter', 'commercialKitchen', 'passage', 1200], ['seating', 'commercialKitchen', 'door', 1000], ['garage', 'living', 'door', 900], ['garage', 'foyer', 'door', 900],
    ['pantry', 'kitchen', 'passage', 1000], ['utility', 'kitchen', 'door', 900], ['reception', 'workspace', 'passage', 1500], ['foyer', 'living', 'passage', 1500],
  ];
  for (const [a, b, kind, width] of RELATED) for (const x of cells.filter(c => c.kind === a)) for (const y of cells.filter(c => c.kind === b && c.level === x.level)) {
    const walls = shared(x.spaceId, y.spaceId);
    if (!walls.length || model.openings.some(o => walls.some(w => w.id === o.wallId) && o.kind !== 'window')) continue;
    for (const w of walls) {
      const length = segmentLengthMm(w.path), lo = marginAt(w, 'start'), hi = length - marginAt(w, 'end');
      const wide = Math.min(width, hi - lo);
      if (wide < 800) continue;
      const offset = lo + Math.floor((hi - lo - wide) / 2);
      if (!free(w, offset, wide, 0, 2100)) continue;
      const common = { id: `opening-${model.openings.length}`, wallId: w.id, levelId: w.levelId, offsetMm: offset, widthMm: wide, heightMm: 2100, sillMm: 0 };
      model.openings.push(kind === 'passage' ? { ...common, kind: 'opening', purpose: 'passage', type: 'open-passage' } : { ...common, kind: 'door', type: 'connecting-door', operation: { kind: 'hinged', hinge: 'start', swingSide: 'left', angleMilliDegrees: 90000 } });
      break;
    }
  }
  // Main entrance: on the ground floor, through the entry room's street-side wall (world min z), else its longest exterior wall.
  const groundCells = cells.filter(c => c.level === 0);
  const entryCell = groundCells.find(c => c.role === 'room' && c.kind !== 'corridor' && c.kind !== 'stairwell' && info(c.kind).entry && exteriorOf(c.spaceId).length)
    ?? groundCells.find(c => c.kind === 'corridor' && exteriorOf(c.spaceId).length);
  if (!entryCell) throw new BlueprintError('IMPOSSIBLE_LAYOUT', 'No ground-floor space can host the entrance');
  const streetSide = (w: BuildingWall) => Math.max(w.path.start.z, w.path.end.z) === C.z && w.path.start.z === w.path.end.z;
  const entryWalls = exteriorOf(entryCell.spaceId).sort((a, b) => Number(streetSide(b)) - Number(streetSide(a)) || segmentLengthMm(b.path) - segmentLengthMm(a.path));
  if (!entryWalls.some(w => insert(w, 'door', 1050))) throw new BlueprintError('IMPOSSIBLE_LAYOUT', 'Entrance door cannot fit');
  const entranceSpaceId = entryCell.spaceId;
  // Vehicle doors on garages that face outside.
  for (const g of cells.filter(c => c.kind === 'garage')) {
    const walls = exteriorOf(g.spaceId).sort((a, b) => Number(streetSide(b)) - Number(streetSide(a)) || segmentLengthMm(b.path) - segmentLengthMm(a.path));
    if (!walls.some(w => insert(w, 'garage', Math.min(2700, segmentLengthMm(w.path) - 2 * marginAt(w, 'start'))))) warnings.push(`${g.name}: no exterior wall wide enough for a vehicle door`);
  }

  // Floor plates (with the flight void from the storey below) and the roof.
  for (let level = 0; level < r.floors; level++) model.slabs.push({ id: `slab-${level}`, levelId: levelId(level), kind: 'floor', footprint: { outer: outerRing, voids: level > 0 && model.stairs[level - 1] ? [model.stairs[level - 1]!.footprint] : [] }, topOffsetMm: 0, thicknessMm: r.slabThicknessMm });
  model.slabs.push({ id: 'roof', levelId: levelId(r.floors - 1), kind: 'flat-roof', footprint: { outer: outerRing, voids: [] }, topOffsetMm: H, thicknessMm: r.slabThicknessMm });

  // Windows: habitable rooms get one per 3 m of their longest exterior wall (max 2) plus one on a second facade; wet rooms a ventilator.
  for (const c of cells) {
    const walls = exteriorOf(c.spaceId).sort((a, b) => segmentLengthMm(b.path) - segmentLengthMm(a.path) || (a.id < b.id ? -1 : 1));
    if (!walls.length) continue;
    const k = c.kind === 'corridor' || c.kind === 'stairwell' ? { windowWidthMm: 1200, windowHeightMm: 1200, windowSillMm: 900, habitable: false, category: 'circulation' as const } : info(c.kind);
    const width = k.windowWidthMm, height = Math.min(k.windowHeightMm, wallH - k.windowSillMm - 150), sill = k.windowSillMm;
    if (c.kind === 'garage' || height < 300) continue;
    const plan: { wall: BuildingWall; count: number }[] = [];
    const facades = new Set<string>();
    for (const w of walls) {
      const facade = `${axisOf(w)}:${axisOf(w) === 'x' ? w.path.start.z : w.path.start.x}`;
      if (facades.has(facade)) continue;
      facades.add(facade);
      const count = k.habitable ? Math.max(1, Math.min(2, Math.floor(segmentLengthMm(w.path) / 3000))) : 1;
      plan.push({ wall: w, count });
      if (plan.length >= (k.habitable ? 2 : 1)) break;
    }
    for (const { wall, count } of plan) {
      const length = segmentLengthMm(wall.path), lo = marginAt(wall, 'start') + 150, hi = length - marginAt(wall, 'end') - 150;
      for (let i = 0; i < count; i++) {
        const offset = Math.floor(lo + (hi - lo) * (i + 1) / (count + 1) - width / 2);
        if (offset < lo || offset + width > hi || !free(wall, offset, width, sill, height)) continue;
        model.openings.push({ id: `opening-${model.openings.length}`, kind: 'window', wallId: wall.id, levelId: wall.levelId, offsetMm: offset, widthMm: width, heightMm: height, sillMm: sill, type: k.category === 'wet' ? 'ventilator' : 'casement-window' });
      }
    }
    if (k.habitable && !model.openings.some(o => o.kind === 'window' && walls.some(w => w.id === o.wallId))) warnings.push(`${c.name}: exterior wall too short for a window`);
  }

  // RCC frame columns are sized by the engineering estimate; they are drawn into the model only on request because the
  // downstream 3D/BIM profile does not carry column solids.
  const O = layout.outer;
  if (withColumns) {
  // RCC frame: columns at exterior corners and at junctions on exterior and corridor lines, kept clear of stair flights.
  const colSize = r.floors <= 2 ? 230 : r.floors <= 4 ? 300 : 380;
  // Flights and landings must stay unobstructed.
  const flights = model.stairs.flatMap(s => [s.footprint, ...s.landings.map(l => l.footprint)]);
  const junctions = new Map<string, Point2Mm>();
  for (const w of model.walls.filter(w => w.levelId === 'level-0' && (w.classification === 'exterior' || w.spaceIds?.some(id => id.startsWith('space-corridor-'))))) for (const p of [w.path.start, w.path.end]) junctions.set(`${p.x}:${p.z}`, p);
  const points = [...junctions.values()].sort((a, b) => a.x - b.x || a.z - b.z);
  const kept: Point2Mm[] = [];
  for (const p of points) {
    const corner = (p.x === C.x || p.x === C.x + C.w) && (p.z === C.z || p.z === C.z + C.d);
    if (!corner && kept.some(q => (q.x === p.x && Math.abs(q.z - p.z) < 2500) || (q.z === p.z && Math.abs(q.x - p.x) < 2500))) continue;
    kept.push(p);
  }
  const half = colSize / 2;
  const inset = (v: number, lo: number, hi: number) => Math.max(lo + half, Math.min(hi - half, v));
  kept.forEach((p, i) => {
    const cx = inset(p.x, O.x, O.x + O.w), cz = inset(p.z, O.z, O.z + O.d);
    const box = { x: cx - half, z: cz - half, w: colSize, d: colSize };
    const touches = flights.some(f => { const xs = f.map(q => q.x), zs = f.map(q => q.z); return box.x < Math.max(...xs) && box.x + box.w > Math.min(...xs) && box.z < Math.max(...zs) && box.z + box.d > Math.min(...zs); });
    if (touches) return;
    for (let level = 0; level < r.floors; level++) model.columns.push({ id: `column-${level}-${i}`, levelId: levelId(level), crossSection: { outer: rectangle(box), voids: [] }, baseOffsetMm: 0, heightMm: wallH });
  });

  }
  // Dimensions: overall and chain per storey, every room, every wall and opening offset, and the storey elevations.
  const add = (d: Omit<BuildingDimension, 'id' | 'constraint'>) => {
    const dimension: BuildingDimension = { ...d, id: `dimension-${model.dimensions.length}`, constraint: { mode: 'derived' } };
    const actual = dimensionMeasurements(model, dimension);
    if (!reconcileDimensions(actual.overallMm, actual.segmentsMm)) throw new BlueprintError('DIMENSION_RECONCILIATION_FAILED', 'Dimension differs from geometry');
    dimension.constraint = { mode: 'controlling', ...actual };
    model.dimensions.push(dimension);
  };
  for (const level of model.levels) for (const axis of ['x', 'z'] as const) {
    const start = axis === 'x' ? O.x : O.z, size = axis === 'x' ? O.w : O.d;
    const point = (v: number): BuildingDimension['anchors'][number] => ({ kind: 'point', point: { x: O.x, z: O.z, y: level.elevationMm, [axis]: v } });
    add({ levelId: level.id, purpose: 'overall', axis, anchors: [point(start), point(start + size)] });
    const cuts = [...new Set([start, start + size, ...cells.filter(c => levelId(c.level) === level.id).flatMap(c => axis === 'x' ? [c.world.x, c.world.x + c.world.w] : [c.world.z, c.world.z + c.world.d])])].sort((a, b) => a - b);
    add({ levelId: level.id, purpose: 'chain', axis, anchors: cuts.map(point) });
  }
  for (const s of model.spaces) for (const [axis, indices] of [['x', [0, 1]], ['z', [1, 2]]] as const) add({ levelId: s.levelId, purpose: 'room', axis, anchors: indices.map(vertexIndex => ({ kind: 'space-vertex', spaceId: s.id, vertexIndex })) });
  for (const wall of model.walls) {
    const axis = axisOf(wall);
    add({ levelId: wall.levelId, purpose: 'wall', axis, anchors: [{ kind: 'wall-end', wallId: wall.id, end: 'start' }, { kind: 'wall-end', wallId: wall.id, end: 'end' }] });
    for (const o of model.openings.filter(o => o.wallId === wall.id).sort((a, b) => a.offsetMm - b.offsetMm)) add({ levelId: wall.levelId, purpose: 'opening-offset', axis,
      anchors: [{ kind: 'wall-end', wallId: wall.id, end: 'start' }, { kind: 'opening-edge', openingId: o.id, edge: 'start' }, { kind: 'opening-edge', openingId: o.id, edge: 'end' }, { kind: 'wall-end', wallId: wall.id, end: 'end' }] });
  }
  if (model.levels.length > 1) add({ purpose: 'elevation', axis: 'y', anchors: model.levels.map(l => ({ kind: 'level', levelId: l.id })) });
  return { model, warnings, entranceSpaceId };
}
