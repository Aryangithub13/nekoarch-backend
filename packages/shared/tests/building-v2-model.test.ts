import { describe, expect, it } from 'vitest';
import single from './fixtures/building-v2/single-room.json' with { type: 'json' };
import small from './fixtures/building-v2/small-residence.json' with { type: 'json' };
import multi from './fixtures/building-v2/multi-room.json' with { type: 'json' };
import two from './fixtures/building-v2/two-level.json' with { type: 'json' };
import explicit from './fixtures/building-v2/explicit-openings.json' with { type: 'json' };
import invalidHost from './fixtures/building-v2/invalid-dangling-host.json' with { type: 'json' };
import invalidRoom from './fixtures/building-v2/invalid-crossed-room.json' with { type: 'json' };
import {
  BuildingModelV2Schema, ArchitecturalBuildingModelV2Schema, serializeBuildingModel, deserializeBuildingModel,
  wallMeasurements, openingAreaMm2, grossFloorAreaMm2, dimensionMeasurements, openingSpaceIds, wallSpaceIds,
  type BuildingModelV2,
} from '../src/index.js';
const fixture = () => BuildingModelV2Schema.parse(two);
const openingFixture = () => BuildingModelV2Schema.parse(explicit);

describe('golden architectural models', () => {
  it.each([['single-room', single], ['small-residence', small], ['multi-room', multi], ['two-level', two], ['explicit-openings', explicit]])('validates and round-trips %s', (_name, raw) => {
    const model = ArchitecturalBuildingModelV2Schema.parse(raw);
    const serialized = serializeBuildingModel(model);
    expect(deserializeBuildingModel(serialized)).toEqual(model);
    expect(serializeBuildingModel(deserializeBuildingModel(serialized))).toBe(serialized);
  });
  it.each([invalidHost, invalidRoom])('rejects authored invalid fixture %#', raw => expect(BuildingModelV2Schema.safeParse(raw).success).toBe(false));
  it('provides ground/first/roof elevations, connecting flight, ceiling and column', () => {
    const model = fixture();
    expect(model.levels.map(l => l.elevationMm)).toEqual([0, 3000, 6000]);
    expect(model.stairs[0]!.riserHeightsMm).toHaveLength(15);
    expect(model.stairs[0]!.runMm).toBe(4200);
    expect(model.slabs.map(s => s.kind)).toEqual(['floor', 'floor', 'flat-roof', 'ceiling']);
    expect(model.columns[0]!.heightMm).toBe(3000);
  });
  it('derives connectivity once from wall geometry', () => {
    const model = openingFixture();
    expect(wallSpaceIds(model, model.walls.find(w => w.id === 'wall-east-0')!)).toEqual(['space-1', 'space-2']);
    expect(openingSpaceIds(model, 'passage')).toEqual(['space-1', 'space-2']);
    expect(openingSpaceIds(model, 'entry')).toEqual(['space-1']);
  });
  it('measures areas, wall surfaces and simple prisms independently', () => {
    const model = openingFixture();
    expect(grossFloorAreaMm2(model)).toBe('42000000');
    expect(openingAreaMm2(model, 'entry')).toBe('1890000');
    expect(wallMeasurements(model, 'wall-south-0')).toEqual({ lengthMm: 4000, grossFaceAreaMm2: '11200000', netFaceAreaMm2: '9310000', netPrismVolumeMm3: '1862000000' });
    expect(grossFloorAreaMm2(fixture())).toBe('122720000'); // 64 m² + (64 - 5.28) m²
    expect(() => wallMeasurements(model, 'missing')).toThrow();
    expect(() => openingAreaMm2(model, 'missing')).toThrow();
  });
  it('measures controlling chains and vertical dimensions from anchors', () => {
    const m = BuildingModelV2Schema.parse(multi);
    expect(dimensionMeasurements(m, m.dimensions[0]!)).toEqual({ overallMm: 9000, segmentsMm: [3000, 2500, 3500] });
    const t = fixture();
    expect(dimensionMeasurements(t, t.dimensions[1]!)).toEqual({ overallMm: 6000, segmentsMm: [3000, 3000] });
  });
  it('derives wall base elevations from level plus offset', () => {
    const m = fixture();
    m.dimensions.push({ id: 'wall-length', purpose: 'wall', axis: 'x', levelId: 'first', anchors: [{ kind: 'wall-end', wallId: 'first-wall-south-0', end: 'start' }, { kind: 'wall-end', wallId: 'first-wall-south-0', end: 'end' }], constraint: { mode: 'derived' } });
    expect(BuildingModelV2Schema.safeParse(m).success).toBe(true);
    expect(dimensionMeasurements(m, m.dimensions.at(-1)!)).toEqual({ overallMm: 4000, segmentsMm: [4000] });
  });
  it('supports negative basement elevations and translated global geometry', () => {
    const m = fixture();
    m.levels.forEach(l => { l.elevationMm -= 3000; });
    expect(BuildingModelV2Schema.safeParse(m).success).toBe(true);
  });
});

const invalidChanges: [string, (m: BuildingModelV2) => void][] = [
  ['duplicate IDs across collections', m => { m.walls[0]!.id = m.spaces[0]!.id; }],
  ['duplicate landing IDs', m => { m.stairs[0]!.landings[0]!.id = m.id; }],
  ['dangling space level', m => { m.spaces[0]!.levelId = 'missing'; }],
  ['dangling wall level', m => { m.walls[0]!.levelId = 'missing'; }],
  ['dangling slab level', m => { m.slabs[0]!.levelId = 'missing'; }],
  ['dangling column level', m => { m.columns[0]!.levelId = 'missing'; }],
  ['dangling specification', m => { m.walls[0]!.specificationId = 'missing'; }],
  ['duplicate level index', m => { m.levels[1]!.index = 0; }],
  ['duplicate elevation', m => { m.levels[1]!.elevationMm = 0; }],
  ['inverted elevation order', m => { m.levels[1]!.elevationMm = -3000; }],
  ['floor-to-floor mismatch', m => { m.levels[0]!.floorToFloorHeightMm = 3100; }],
  ['space outside level', m => { m.spaces[0]!.boundary[0]!.x = -1; }],
  ['overlapping spaces', m => { m.spaces[1]!.boundary = m.spaces[0]!.boundary; }],
  ['unspecified architectural space', m => { m.spaces[0]!.boundaryBasis = 'unspecified'; }],
  ['zero-length wall', m => { m.walls[0]!.path.end = m.walls[0]!.path.start; }],
  ['zero wall thickness', m => { m.walls[0]!.thicknessMm = 0; }],
  ['missing physical wall height', m => { m.walls[0]!.heightMm = null; }],
  ['missing wall path convention', m => { m.walls[0]!.pathReference = 'unspecified'; }],
  ['wall outside level', m => { m.walls[0]!.path.start.x = -1; }],
  ['wall beyond next storey', m => { m.walls[0]!.heightMm = 3001; }],
  ['overlapping walls', m => { m.walls.push({ ...m.walls[0]!, id: 'duplicate-wall' }); }],
  ['wrong space topology', m => { m.walls[0]!.spaceIds = ['space-2']; }],
  ['duplicate topology', m => { m.walls[0]!.spaceIds = ['space-1', 'space-1']; }],
  ['cross-level topology', m => { m.walls[0]!.spaceIds = ['first-space-1']; }],
  ['stair same levels', m => { m.stairs[0]!.toLevelId = 'ground'; }],
  ['stair missing source', m => { m.stairs[0]!.fromLevelId = 'absent'; }],
  ['stair missing destination', m => { m.stairs[0]!.toLevelId = 'absent'; }],
  ['stair rise mismatch', m => { m.stairs[0]!.riseMm++; }],
  ['stair riser mismatch', m => { m.stairs[0]!.riserHeightsMm[0] = 199; }],
  ['stair run mismatch', m => { m.stairs[0]!.runMm++; }],
  ['stair width mismatch', m => { m.stairs[0]!.widthMm++; }],
  ['stair direction mismatch', m => { m.stairs[0]!.direction = '+x'; }],
  ['landing wrong elevation', m => { m.stairs[0]!.landings[0]!.elevationOffsetMm = 10; }],
  ['landing wrong end', m => { m.stairs[0]!.landings[0]!.elevationOffsetMm = 3000; }],
  ['slab outside level', m => { m.slabs[0]!.footprint.outer[0]!.x = -1; }],
  ['overlapping floor plates', m => { m.slabs.push({ ...m.slabs[0]!, id: 'duplicate-plate' }); }],
  ['column outside level', m => { m.columns[0]!.crossSection.outer[0]!.x = -1; }],
  ['column too tall', m => { m.columns[0]!.heightMm = 3001; }],
  ['dimension sum mismatch', m => { m.dimensions[0]!.constraint = { mode: 'controlling', overallMm: 8000, segmentsMm: [4000, 4001] }; }],
  ['dimension contradicts geometry', m => { m.dimensions[0]!.constraint = { mode: 'controlling', overallMm: 8000, segmentsMm: [3000, 5000] }; }],
  ['dimension unresolved wall', m => { m.dimensions[0]!.anchors[0] = { kind: 'wall-end', wallId: 'absent', end: 'start' }; }],
  ['dimension unresolved level', m => { m.dimensions[1]!.anchors[0] = { kind: 'level', levelId: 'absent' }; }],
  ['dimension nonmonotonic', m => { m.dimensions[0]!.anchors.reverse(); m.dimensions[0]!.anchors[1] = { kind: 'point', point: { x: 9000, y: 0, z: 0 } }; }],
  ['horizontal level dimension', m => { m.dimensions[1]!.axis = 'x'; }],
  ['invalid setback edge', m => { m.site!.setbacks[0]!.boundaryEdgeStart = 4; }],
  ['buildable region outside site', m => { m.site!.buildableBoundary![0]!.x = -2000; }],
  ['site excludes building', m => { m.site!.buildableBoundary = m.spaces[0]!.boundary; }],
];
describe('cross-entity and geometric invariants', () => {
  it.each(invalidChanges)('rejects %s', (_label, mutate) => {
    const m = fixture(); mutate(m);
    expect(BuildingModelV2Schema.safeParse(m).success).toBe(false);
  });
  it.each([NaN, Infinity, -Infinity, 0.1, 1e20])('invalid nested number %s returns issues rather than throwing', value => {
    const m = fixture(); m.spaces[0]!.boundary[0]!.x = value;
    expect(BuildingModelV2Schema.safeParse(m).success).toBe(false);
  });
  it.each([{ schemaVersion: 3 }, { units: 'ft' }, { coordinateSystem: 'xy-plan' }, { price: 100 }])('rejects mixed units, future versions or unrecognized fields %#', fields => expect(BuildingModelV2Schema.safeParse({ ...single, ...fields }).success).toBe(false));
});

describe('explicit door/window/generic opening hosting', () => {
  it.each([
    ['missing host', (m: BuildingModelV2) => { m.openings[0]!.wallId = 'missing'; }],
    ['wrong level', (m: BuildingModelV2) => { m.openings[0]!.levelId = 'absent'; }],
    ['negative offset', (m: BuildingModelV2) => { m.openings[0]!.offsetMm = -1; }],
    ['door beyond wall', (m: BuildingModelV2) => { m.openings[0]!.offsetMm = 3500; }],
    ['window above wall', (m: BuildingModelV2) => { m.openings[1]!.sillMm = 2000; }],
    ['overlap across kinds', (m: BuildingModelV2) => { m.openings[1]!.wallId = m.openings[0]!.wallId; }],
  ] as const)('rejects %s', (_name, mutate) => { const m = openingFixture(); mutate(m); expect(BuildingModelV2Schema.safeParse(m).success).toBe(false); });
  it('allows edge-touching and vertically separated openings', () => {
    const m = openingFixture();
    m.openings[1]!.wallId = m.openings[0]!.wallId;
    m.openings[1]!.offsetMm = 1400;
    expect(BuildingModelV2Schema.safeParse(m).success).toBe(true);
    m.openings[1]!.offsetMm = 500; m.openings[1]!.sillMm = 2100; m.openings[1]!.heightMm = 500;
    expect(BuildingModelV2Schema.safeParse(m).success).toBe(true);
  });
  it('accepts an opening exactly matching host extent', () => {
    const m = openingFixture(); m.openings[0]!.offsetMm = 0; m.openings[0]!.widthMm = 4000;
    expect(BuildingModelV2Schema.safeParse(m).success).toBe(true);
  });
  it('does not use rounded diagonal length to admit an oversized opening', () => {
    const m = openingFixture(); m.walls[0]!.path.end = { x: 2, z: 2 }; delete m.walls[0]!.spaceIds;
    m.openings[0]!.offsetMm = 0; m.openings[0]!.widthMm = 3;
    expect(BuildingModelV2Schema.safeParse(m).success).toBe(false); // √8 < 3
    m.openings[0]!.widthMm = 2;
    expect(BuildingModelV2Schema.safeParse(m).success).toBe(true);
  });
});

describe('dimensions attached to architectural entities', () => {
  it('derives room and opening offsets from their authoritative geometry', () => {
    const m = openingFixture();
    m.dimensions.push({ id: 'room-width', levelId: 'ground', purpose: 'room', axis: 'x', anchors: [{ kind: 'space-vertex', spaceId: 'space-1', vertexIndex: 0 }, { kind: 'space-vertex', spaceId: 'space-1', vertexIndex: 1 }], constraint: { mode: 'derived' } });
    m.dimensions.push({ id: 'door-offsets', levelId: 'ground', purpose: 'opening-offset', axis: 'x', anchors: [{ kind: 'wall-end', wallId: 'wall-south-0', end: 'start' }, { kind: 'opening-edge', openingId: 'entry', edge: 'start' }, { kind: 'opening-edge', openingId: 'entry', edge: 'end' }, { kind: 'wall-end', wallId: 'wall-south-0', end: 'end' }], constraint: { mode: 'controlling', overallMm: 4000, segmentsMm: [500, 900, 2600] } });
    expect(BuildingModelV2Schema.safeParse(m).success).toBe(true);
    expect(dimensionMeasurements(m, m.dimensions[1]!)).toEqual({ overallMm: 4000, segmentsMm: [4000] });
    expect(dimensionMeasurements(m, m.dimensions[2]!)).toEqual({ overallMm: 4000, segmentsMm: [500, 900, 2600] });
    m.openings[0]!.offsetMm++;
    expect(BuildingModelV2Schema.safeParse(m).success).toBe(false);
  });
  it.each([
    { kind: 'space-vertex', spaceId: 'missing', vertexIndex: 0 },
    { kind: 'space-vertex', spaceId: 'space-1', vertexIndex: 4 },
    { kind: 'opening-edge', openingId: 'missing', edge: 'start' },
  ] as const)('rejects dangling entity anchor %#', anchor => {
    const m = openingFixture(); m.dimensions[0]!.anchors[0] = anchor;
    expect(BuildingModelV2Schema.safeParse(m).success).toBe(false);
  });
});
