import type { BuildingModelV2, BuildingWall } from '@designflow/shared';

const rect = (x: number, z: number, width: number, depth: number) => [{ x, z }, { x: x + width, z }, { x: x + width, z: z + depth }, { x, z: z + depth }];
export type TowerOptions = { storeys: number; storeyHeightMm?: number; widthMm?: number; depthMm?: number; topFloorToFloor?: boolean };

/**
 * An authored rectangular tower: one office per storey inside four exterior walls, a floor slab per storey and a straight stair between consecutive
 * storeys, with a slab void above each flight. Test geometry only; it carries no engineering data and is not a design.
 */
export function tower({ storeys, storeyHeightMm = 4000, widthMm = 40_000, depthMm = 30_000, topFloorToFloor = true }: TowerOptions): BuildingModelV2 {
  const risers = storeyHeightMm / 160, tread = 280, run = (risers - 1) * tread, stairWidth = 1200;
  if (!Number.isInteger(risers)) throw new Error('Storey height must be a multiple of 160 mm in this fixture');
  const stairFootprint = rect(2400, 1000, run, stairWidth);
  const landings = (i: number) => [{ id: `stair-${i}-bottom`, footprint: rect(1200, 1000, 1200, stairWidth), elevationOffsetMm: 0 },
    { id: `stair-${i}-top`, footprint: rect(2400 + run, 1000, 1200, stairWidth), elevationOffsetMm: storeyHeightMm }];
  const id = (i: number) => `storey-${i}`;
  const levels = Array.from({ length: storeys }, (_, i) => ({ id: id(i), name: `Storey ${i}`, index: i, kind: 'storey' as const, elevationMm: i * storeyHeightMm,
    floorToFloorHeightMm: i < storeys - 1 || topFloorToFloor ? storeyHeightMm : null, boundary: rect(0, 0, widthMm, depthMm) }));
  const walls: BuildingWall[] = levels.flatMap(level => {
    const w = (side: string, start: [number, number], end: [number, number]): BuildingWall => ({ id: `${level.id}-${side}`, levelId: level.id,
      path: { start: { x: start[0], z: start[1] }, end: { x: end[0], z: end[1] } }, pathReference: 'centerline', thicknessMm: 200, heightMm: storeyHeightMm - 200,
      baseOffsetMm: 0, classification: 'exterior', spaceIds: [`${level.id}-office`] });
    return [w('south', [100, 100], [widthMm - 100, 100]), w('east', [widthMm - 100, 100], [widthMm - 100, depthMm - 100]),
      w('north', [widthMm - 100, depthMm - 100], [100, depthMm - 100]), w('west', [100, depthMm - 100], [100, 100])];
  });
  return {
    schemaVersion: 2, id: `tower-${storeys}`, name: `Authored ${storeys}-storey tower fixture`, completeness: 'architectural', units: 'mm', coordinateSystem: 'x-right-y-up-z-depth',
    site: { id: 'plot', name: 'Plot', boundary: rect(-10_000, -10_000, widthMm + 20_000, depthMm + 20_000), northMilliDegrees: null, setbacks: [] },
    levels,
    spaces: levels.map(level => ({ id: `${level.id}-office`, name: `Office ${level.index}`, classification: 'office', levelId: level.id, boundaryBasis: 'wall-centerline' as const,
      boundary: rect(100, 100, widthMm - 200, depthMm - 200), occupancy: 10 })),
    walls,
    openings: [{ id: 'entry-door', kind: 'door', wallId: `${id(0)}-south`, levelId: id(0), offsetMm: 5000, widthMm: 1000, heightMm: 2100, sillMm: 0, type: 'entrance',
      operation: { kind: 'hinged', hinge: 'start', swingSide: 'left', angleMilliDegrees: 90000 } }],
    stairs: levels.slice(0, -1).map((level, i) => ({ id: `stair-${i}`, fromLevelId: level.id, toLevelId: id(i + 1), footprint: stairFootprint, direction: '+x' as const,
      widthMm: stairWidth, riseMm: storeyHeightMm, runMm: run, riserHeightsMm: Array<number>(risers).fill(160), treadDepthMm: tread, landings: landings(i) })),
    columns: [],
    slabs: levels.map((level, i) => ({ id: `${level.id}-floor`, levelId: level.id, kind: 'floor' as const,
      footprint: { outer: rect(0, 0, widthMm, depthMm), voids: i === 0 ? [] : [stairFootprint] }, topOffsetMm: 0, thicknessMm: 200 })),
    dimensions: [], specifications: [], provenance: { creationMode: 'authored', measurementVersion: 'mm-exact/1' },
  } as BuildingModelV2;
}

export type IntermediateLevel = { storey: number; offsetMm: number; kind?: 'datum' | 'roof'; declare: boolean };

/**
 * Inserts a datum or roof level `offsetMm` above `storey-<storey>`, re-indexing the levels above it, and lowers that storey's walls to fit below
 * it (the same geometry either way). With `declare`, the storey's floor-to-floor height is the distance to the inserted level, as the schema
 * requires (it reaches the next represented level of any kind); without it, the storey declares none. Test geometry only.
 */
export function withIntermediateLevel(model: BuildingModelV2, { storey, offsetMm, kind = 'datum', declare }: IntermediateLevel): BuildingModelV2 {
  const m = structuredClone(model), below = m.levels.find(l => l.id === `storey-${storey}`)!;
  for (const l of m.levels) if (l.index > below.index) l.index += 1;
  m.levels.push({ id: `${kind}-above-${storey}`, name: `${kind} above storey ${storey}`, index: below.index + 1, kind, elevationMm: below.elevationMm + offsetMm,
    floorToFloorHeightMm: null, boundary: below.boundary });
  below.floorToFloorHeightMm = declare ? offsetMm : null;
  for (const w of m.walls) if (w.levelId === below.id && (w.baseOffsetMm ?? 0) + (w.heightMm ?? 0) > offsetMm) w.heightMm = offsetMm - (w.baseOffsetMm ?? 0);
  return m;
}

/**
 * Splits `storey-<storey>` of a tower into a west and an east office, divided by an interior wall at `splitXmm` with a door in it. The north and
 * south exterior walls are split at the partition, so every wall bounds exactly the rooms it touches (as the schema requires). The entrance door
 * of storey 0, if this is that storey, moves to the south-west wall at the same offset. Test geometry only.
 */
export function withTwoRooms(model: BuildingModelV2, storey: number, splitXmm = 20_000): BuildingModelV2 {
  const m = structuredClone(model), id = `storey-${storey}`, level = m.levels.find(l => l.id === id)!;
  const xs = level.boundary.map(p => p.x), zs = level.boundary.map(p => p.z), W = Math.max(...xs), D = Math.max(...zs);
  const height = m.walls.find(w => w.levelId === id)!.heightMm!, west = `${id}-west-office`, east = `${id}-east-office`;
  m.spaces = m.spaces.filter(s => s.levelId !== id);
  m.spaces.push({ id: west, name: 'West office', classification: 'office', levelId: id, boundaryBasis: 'wall-centerline', boundary: rect(100, 100, splitXmm - 100, D - 200), occupancy: 5 },
    { id: east, name: 'East office', classification: 'office', levelId: id, boundaryBasis: 'wall-centerline', boundary: rect(splitXmm, 100, W - 100 - splitXmm, D - 200), occupancy: 5 });
  const wall = (side: string, start: [number, number], end: [number, number], spaceIds: string[], classification: BuildingWall['classification'] = 'exterior', thicknessMm = 200): BuildingWall =>
    ({ id: `${id}-${side}`, levelId: id, path: { start: { x: start[0], z: start[1] }, end: { x: end[0], z: end[1] } }, pathReference: 'centerline', thicknessMm, heightMm: height,
      baseOffsetMm: 0, classification, spaceIds });
  m.walls = m.walls.filter(w => w.levelId !== id);
  m.walls.push(wall('south-west', [100, 100], [splitXmm, 100], [west]), wall('south-east', [splitXmm, 100], [W - 100, 100], [east]),
    wall('east', [W - 100, 100], [W - 100, D - 100], [east]), wall('north-east', [W - 100, D - 100], [splitXmm, D - 100], [east]),
    wall('north-west', [splitXmm, D - 100], [100, D - 100], [west]), wall('west', [100, D - 100], [100, 100], [west]),
    wall('partition', [splitXmm, 100], [splitXmm, D - 100], [east, west], 'interior', 100));
  for (const o of m.openings) if (o.wallId === `${id}-south`) o.wallId = `${id}-south-west`;
  m.openings.push({ id: `${id}-partition-door`, kind: 'door', wallId: `${id}-partition`, levelId: id, offsetMm: 13_000, widthMm: 1000, heightMm: 2100, sillMm: 0, type: 'internal',
    operation: { kind: 'hinged', hinge: 'start', swingSide: 'left', angleMilliDegrees: 90000 } });
  return m;
}

/** Adds `perWall` evenly spaced windows (1 200 × 1 500 mm, sill 900 mm) to every exterior wall without an opening. Test geometry only. */
export function withWindows(model: BuildingModelV2, perWall: number): BuildingModelV2 {
  const m = structuredClone(model), hosted = new Set(m.openings.map(o => o.wallId));
  for (const w of m.walls) {
    if (w.classification !== 'exterior' || hosted.has(w.id)) continue;
    const length = Math.abs(w.path.end.x - w.path.start.x) + Math.abs(w.path.end.z - w.path.start.z), step = Math.floor((length - 2000) / perWall);
    for (let k = 0; k < perWall; k++) m.openings.push({ id: `${w.id}-window-${k}`, kind: 'window', wallId: w.id, levelId: w.levelId, offsetMm: 1000 + k * step, widthMm: 1200,
      heightMm: 1500, sillMm: 900, type: 'window' });
  }
  return m;
}
