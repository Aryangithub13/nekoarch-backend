import type { BuildingModelV2, BuildingWall } from '@designflow/shared';
import { generateBlueprint, type BlueprintRequirements } from '@designflow/generator';
export const rect = (x: number, z: number, width: number, depth: number) => [{ x, z }, { x: x + width, z }, { x: x + width, z: z + depth }, { x, z: z + depth }];
export const requirements = (floors: 1 | 2 = 1, seed = 'qa'): BlueprintRequirements => ({
  site: { boundary: rect(0, 0, 10000, 12000), northMilliDegrees: 0 }, floors,
  rooms: [{ type: 'bedroom', count: 2 }, { type: 'bathroom', count: 1 }, { type: 'living', count: 1 }, { type: 'kitchen', count: 1 }], seed,
});
export const generated = (floors: 1 | 2 = 1) => generateBlueprint(requirements(floors)).model;
export const generatorOptions = { entrySpaceIds: ['space-corridor-0'], requireReachability: true };

/** Authored by hand: no generator helpers, IDs, classifications or metadata conventions. */
export function authored(): BuildingModelV2 {
  const wall = (id: string, start: [number, number], end: [number, number], spaceIds: string[], classification: BuildingWall['classification'] = 'exterior'): BuildingWall => ({
    id, levelId: 'ground', path: { start: { x: start[0], z: start[1] }, end: { x: end[0], z: end[1] } },
    pathReference: 'centerline', thicknessMm: 200, heightMm: 2800, baseOffsetMm: 0, classification, spaceIds,
  });
  return {
    schemaVersion: 2, id: 'authored-house', name: 'Authored independent fixture', completeness: 'architectural', units: 'mm', coordinateSystem: 'x-right-y-up-z-depth',
    site: { id: 'plot', name: 'Plot', boundary: rect(0, 0, 8000, 6000), northMilliDegrees: null, setbacks: [] },
    levels: [{ id: 'ground', name: 'Ground', index: 0, kind: 'storey', elevationMm: 0, floorToFloorHeightMm: 3000, boundary: rect(0, 0, 8000, 6000) }],
    spaces: [
      { id: 'foyer', name: 'Foyer', classification: 'entry', levelId: 'ground', boundaryBasis: 'wall-centerline', boundary: rect(100, 100, 3900, 5800), occupancy: 1 },
      { id: 'studio', name: 'Studio', classification: 'studio', levelId: 'ground', boundaryBasis: 'wall-centerline', boundary: rect(4000, 100, 3900, 5800), occupancy: 2 },
    ],
    walls: [
      wall('south-a', [100, 100], [4000, 100], ['foyer']), wall('south-b', [4000, 100], [7900, 100], ['studio']),
      wall('north-a', [100, 5900], [4000, 5900], ['foyer']), wall('north-b', [4000, 5900], [7900, 5900], ['studio']),
      wall('west', [100, 100], [100, 5900], ['foyer']), wall('east', [7900, 100], [7900, 5900], ['studio']),
      wall('partition', [4000, 100], [4000, 5900], ['foyer', 'studio'], 'partition'),
    ],
    openings: [
      { id: 'entry-door', kind: 'door', wallId: 'south-a', levelId: 'ground', offsetMm: 1000, widthMm: 900, heightMm: 2100, sillMm: 0, type: 'entrance', operation: { kind: 'sliding', slideToward: 'end' } },
      { id: 'studio-door', kind: 'door', wallId: 'partition', levelId: 'ground', offsetMm: 1800, widthMm: 900, heightMm: 2100, sillMm: 0, type: 'internal', operation: { kind: 'hinged', hinge: 'end', swingSide: 'right', angleMilliDegrees: 90000 } },
      { id: 'studio-window', kind: 'window', wallId: 'east', levelId: 'ground', offsetMm: 1000, widthMm: 1200, heightMm: 1200, sillMm: 900, type: 'external' },
    ],
    stairs: [], columns: [], slabs: [{ id: 'floor', levelId: 'ground', kind: 'floor', footprint: { outer: rect(0, 0, 8000, 6000), voids: [] }, topOffsetMm: 0, thicknessMm: 150 }],
    dimensions: [
      { id: 'chain', levelId: 'ground', purpose: 'chain', axis: 'x', anchors: [0, 4000, 8000].map(x => ({ kind: 'point', point: { x, y: 0, z: 0 } })), constraint: { mode: 'controlling', overallMm: 8000, segmentsMm: [4000, 4000] } },
      { id: 'room-width', levelId: 'ground', purpose: 'room', axis: 'x', anchors: [0, 1].map(vertexIndex => ({ kind: 'space-vertex', spaceId: 'studio', vertexIndex })), constraint: { mode: 'controlling', overallMm: 3900, segmentsMm: [3900] } },
      { id: 'wall-length', levelId: 'ground', purpose: 'wall', axis: 'z', anchors: [{ kind: 'wall-end', wallId: 'partition', end: 'start' }, { kind: 'wall-end', wallId: 'partition', end: 'end' }], constraint: { mode: 'derived' } },
      { id: 'door-offset', levelId: 'ground', purpose: 'opening-offset', axis: 'z', anchors: [{ kind: 'wall-end', wallId: 'partition', end: 'start' }, { kind: 'opening-edge', openingId: 'studio-door', edge: 'start' }, { kind: 'opening-edge', openingId: 'studio-door', edge: 'end' }], constraint: { mode: 'controlling', overallMm: 2700, segmentsMm: [1800, 900] } },
    ], specifications: [], provenance: { creationMode: 'authored', measurementVersion: 'mm-exact/1' },
  };
}
export const authoredOptions = { entryOpeningIds: ['entry-door'], requireReachability: true };
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const nested of Object.values(value)) freeze(nested); }
  return value;
}
