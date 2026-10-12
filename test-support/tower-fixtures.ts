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
