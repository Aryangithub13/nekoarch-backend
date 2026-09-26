import type { BuildingModelV2 } from '@designflow/shared';
import { authored, rect, requirements } from '../../blueprint-qa/tests/fixtures.js';
import { generateBlueprint } from '@designflow/generator';
export { rect, requirements };
export function singleRoom(): BuildingModelV2 {
  const m = authored();
  m.id = 'manual-room'; m.dimensions = []; m.site!.boundary = rect(0, 0, 6000, 6000);
  m.levels[0]!.boundary = rect(0, 0, 6000, 6000); m.levels[0]!.floorToFloorHeightMm = 3200;
  m.spaces = [{ ...m.spaces[0]!, id: 'room', boundary: rect(100, 100, 4000, 3000) }];
  const ring = m.spaces[0]!.boundary;
  m.walls = ring.map((start, i) => ({ ...m.walls[0]!, id: `wall-${i}`, path: { start, end: ring[(i+1)%4]! }, heightMm: 3000, spaceIds: ['room'] }));
  m.openings = [{ ...m.openings[0]!, wallId: 'wall-0', offsetMm: 500 }];
  m.slabs = [{ ...m.slabs[0]!, footprint: { outer: rect(100, 100, 4000, 3000), voids: [] }, thicknessMm: 150 }];
  return m;
}
export function diagonal() {
  const m = singleRoom(); m.spaces = []; m.openings = []; m.walls = [{ ...m.walls[0]!, spaceIds: [], path: { start: { x: 100, z: 100 }, end: { x: 1101, z: 1100 } } }];
  delete m.walls[0]!.spaceIds;
  m.slabs[0]!.footprint.outer = [{ x: 100, z: 100 }, { x: 1101, z: 100 }, { x: 100, z: 1101 }];
  return m;
}
export function residence(floors: 1 | 2 = 1, bedrooms = 2, seed = 'takeoff-golden') {
  const r = requirements(floors, seed); r.rooms[0]!.count = bedrooms;
  return generateBlueprint(r).model;
}
