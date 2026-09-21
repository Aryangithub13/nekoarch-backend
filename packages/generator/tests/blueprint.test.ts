import { describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { ArchitecturalBuildingModelV2Schema, BuildingModelV2Schema, dimensionMeasurements, grossFloorAreaMm2, polygonAreaMm2, ringContains, ringsOverlap, segmentLengthMm, wallSpaceIds } from '@designflow/shared';
import { analyzeCirculation, BlueprintError, BLUEPRINT_VERSION, generateBlueprint, normalizeBlueprintRequirements, type BlueprintRequirements } from '../src/blueprint/index.js';
import { buildConstraints, bounds, reconcilePartition, rectangle } from '../src/blueprint/geometry.js';
import { allocateCandidate, scoreCandidate } from '../src/blueprint/layout.js';
import { landingDoorFits } from '../src/blueprint/entities.js';
import fixtures from './fixtures/blueprint/cases.json' with { type: 'json' };

const input = (width = 10000, depth = 12000, bedrooms = 2, floors: 1 | 2 = 1): BlueprintRequirements => ({
  site: { boundary: rectangle({ x: 0, z: 0, w: width, d: depth }), northMilliDegrees: 0 }, floors,
  rooms: [{ type: 'bedroom', count: bedrooms }, { type: 'bathroom', count: 1 }, { type: 'living', count: 1 }, { type: 'kitchen', count: 1 }], seed: 'test',
});
function code(value: unknown): string {
  try { generateBlueprint(value); } catch (e) { expect(e).toBeInstanceOf(BlueprintError); return (e as BlueprintError).code; }
  throw new Error('Expected controlled failure');
}
const pair = (strength: 'hard' | 'soft', kind: 'adjacent' | 'connected' | 'passage' = 'adjacent') => ({ from: { type: 'kitchen' as const }, to: { type: 'living' as const }, strength, kind });
function audit(value: BlueprintRequirements) {
  const result = generateBlueprint(value), { model, metadata } = result;
  expect(BuildingModelV2Schema.safeParse(model).success).toBe(true);
  expect(ArchitecturalBuildingModelV2Schema.safeParse(model).success).toBe(true);
  expect(metadata.circulation.unreachableSpaceIds).toEqual([]);
  expect(metadata.circulation.reachableSpaceIds.length).toBe(model.spaces.length);
  expect(model.spaces.filter(s => !['circulation', 'stairwell'].includes(s.classification))).toHaveLength(value.rooms.reduce((n, r) => n + r.count, 0));
  const ids = [model.id, model.site!.id, ...model.levels, ...model.spaces, ...model.walls, ...model.openings, ...model.stairs, ...model.slabs, ...model.dimensions].map(x => typeof x === 'string' ? x : x.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const space of model.spaces) {
    expect(ringContains(model.levels.find(l => l.id === space.levelId)!.boundary, space.boundary)).toBe(true);
    for (const other of model.spaces) if (space.id !== other.id && space.levelId === other.levelId) expect(ringsOverlap(space.boundary, other.boundary)).toBe(false);
  }
  for (const wall of model.walls) {
    expect(wall.spaceIds).toEqual(wallSpaceIds(model, wall));
    expect(wall.thicknessMm).toBeGreaterThan(0); expect(wall.heightMm).toBeGreaterThan(0);
    expect(wall.baseOffsetMm).toBe(0);
  }
  for (const opening of model.openings) {
    const wall = model.walls.find(w => w.id === opening.wallId)!;
    expect(opening.levelId).toBe(wall.levelId);
    expect(opening.offsetMm + opening.widthMm).toBeLessThanOrEqual(segmentLengthMm(wall.path));
    expect(opening.sillMm + opening.heightMm).toBeLessThanOrEqual(wall.heightMm!);
  }
  for (const dimension of model.dimensions) {
    expect(dimension.constraint.mode).toBe('controlling');
    const actual = dimensionMeasurements(model, dimension);
    expect(actual.segmentsMm.reduce((a, b) => a + b, 0)).toBe(actual.overallMm);
    if (dimension.constraint.mode === 'controlling') expect(actual).toEqual({ overallMm: dimension.constraint.overallMm, segmentsMm: dimension.constraint.segmentsMm });
  }
  const u = metadata.utilization;
  expect(u.roomClearAreaMm2 + u.circulationClearAreaMm2 + u.stairCoreClearAreaMm2 + u.wallsAndResidualAreaMm2).toBe(u.totalEnvelopeAreaMm2);
  expect(u.wallsAndResidualAreaMm2).toBeGreaterThan(0);
  function numbers(v: unknown): void { if (typeof v === 'number') expect(Number.isSafeInteger(v)).toBe(true); else if (v && typeof v === 'object') for (const x of Object.values(v)) numbers(x); }
  numbers(model); numbers(metadata);
  return result;
}

describe('blueprint golden fixtures', () => {
  for (const fixture of fixtures) it(fixture.name, () => {
    const r = { ...input(fixture.width, fixture.depth, fixture.bedrooms, fixture.floors as 1 | 2), seed: fixture.seed, solver: { maxCandidates: 128 } };
    if (fixture.failure) { expect(code(r)).toBe(fixture.failure); return; }
    const { model, metadata } = audit(r);
    expect(model.levels).toHaveLength(fixture.floors);
    expect(metadata.roomDimensions).toHaveLength(fixture.rooms);
    expect(model.dimensions.filter(d => d.purpose === 'overall' && d.levelId === 'level-0').slice(0, 2).map(d => dimensionMeasurements(model, d).overallMm)).toEqual([fixture.width, fixture.depth]);
    expect(model.openings.filter(o => o.kind === 'door')).toHaveLength(fixture.rooms + 1 + (fixture.floors === 2 ? 2 : 0));
    expect(model.walls).toHaveLength(fixture.floors === 1 ? 3 * fixture.rooms + 4 : 3 * fixture.rooms + 14);
    expect(model.stairs).toHaveLength(fixture.floors - 1);
    expect(model.slabs).toHaveLength(fixture.floors + 1);
    expect(generateBlueprint(r)).toEqual({ model, metadata });
  });
});

describe('requirements and normalized intent', () => {
  const invalid: [string, (r: BlueprintRequirements) => unknown][] = [
    ['fractional dimension', r => ({ ...r, circulationWidthMm: 1200.1 })],
    ['nonfinite', r => ({ ...r, floorToFloorHeightMm: Infinity })],
    ['odd wall thickness', r => ({ ...r, exteriorWallThicknessMm: 201 })],
    ['unknown field', r => ({ ...r, arbitraryIds: ['mine'] })],
    ['room entity id', r => ({ ...r, rooms: [{ type: 'bedroom', count: 1, id: 'mine' }] })],
    ['duplicate group', r => ({ ...r, rooms: [...r.rooms, r.rooms[0]] })],
    ['unknown classification', r => ({ ...r, rooms: [{ type: 'garage', count: 1 }] })],
    ['zero rooms', r => ({ ...r, rooms: [] })],
    ['too many rooms', r => ({ ...r, rooms: [{ type: 'bedroom', count: 25 }] })],
    ['too many floors', r => ({ ...r, floors: 3 })],
    ['missing level', r => ({ ...r, rooms: [{ type: 'bedroom', count: 1, level: 1 }] })],
    ['door height', r => ({ ...r, door: { heightMm: 4000 } })],
    ['window height', r => ({ ...r, windows: { sillMm: 2700 } })],
    ['single floor stair', r => ({ ...r, stair: {} })],
    ['self adjacency', r => ({ ...r, relationships: [{ ...pair('hard'), from: { type: 'living' } }] })],
    ['missing room selector', r => ({ ...r, relationships: [{ ...pair('hard'), from: { type: 'study' } }] })],
    ['missing ordinal', r => ({ ...r, relationships: [{ ...pair('hard'), from: { type: 'bedroom', ordinal: 8 } }] })],
    ['conflicting relationship', r => ({ ...r, relationships: [pair('hard'), pair('soft')] })],
    ['duplicate setback edge', r => ({ ...r, site: { ...r.site, setbacks: [{ boundaryEdgeStart: 0, minimumMm: 10 }, { boundaryEdgeStart: 0, minimumMm: 20 }] } })],
    ['missing setback edge', r => ({ ...r, site: { ...r.site, setbacks: [{ boundaryEdgeStart: 5, minimumMm: 10 }] } })],
    ['crossed polygon', r => ({ ...r, site: { ...r.site, boundary: [{ x: 0, z: 0 }, { x: 5000, z: 5000 }, { x: 0, z: 5000 }, { x: 5000, z: 0 }] } })],
    ['zero candidate budget', r => ({ ...r, solver: { maxCandidates: 0 } })],
    ['excess iteration budget', r => ({ ...r, solver: { maxIterations: 20001 } })],
    ['null requirements', () => null],
  ];
  it.each(invalid)('rejects %s', (_, mutate) => expect(code(mutate(input()))).toBe('INVALID_REQUIREMENTS'));
  it('catches throwing getters safely', () => expect(code({ get rooms() { throw new Error('private debug data'); } })).toBe('INVALID_REQUIREMENTS'));
  it('normalizes group and relationship order', () => {
    const a = input(); a.relationships = [pair('soft')];
    const b = structuredClone(a); b.rooms.reverse(); b.relationships = [{ ...pair('soft'), from: { type: 'living' }, to: { type: 'kitchen' } }];
    expect(normalizeBlueprintRequirements(a)).toEqual(normalizeBlueprintRequirements(b));
    expect(generateBlueprint(a)).toEqual(generateBlueprint(b));
  });
  it('does not mutate deeply frozen caller data', () => {
    const r = input(10000, 12000, 3, 2), before = structuredClone(r);
    function freeze(v: unknown): void { if (v && typeof v === 'object') { Object.freeze(v); Object.values(v).forEach(freeze); } }
    freeze(r); generateBlueprint(r); expect(r).toEqual(before);
  });
  it('fresh output does not share mutable state with later calls', () => {
    const r = input(), expected = generateBlueprint(r); const first = generateBlueprint(r); first.model.walls[0]!.heightMm = 1; first.metadata.warnings.push('changed');
    expect(generateBlueprint(r)).toEqual(expected);
  });
});

describe('site, walls and clear dimensions', () => {
  it('rejects valid nonrectangular polygons explicitly', () => {
    const r = input(); r.site.boundary = [{ x: 0, z: 0 }, { x: 9000, z: 0 }, { x: 3000, z: 9000 }];
    expect(code(r)).toBe('UNSUPPORTED_GEOMETRY');
  });
  it('rejects rotated rectangles', () => {
    const r = input(); r.site.boundary = [{ x: 0, z: 5000 }, { x: 5000, z: 0 }, { x: 10000, z: 5000 }, { x: 5000, z: 10000 }]; expect(code(r)).toBe('UNSUPPORTED_GEOMETRY');
  });
  it('rejects oversized rectangular sites', () => expect(code(input(60001, 12000))).toBe('UNSUPPORTED_GEOMETRY'));
  it('rejects buildable boundary outside site', () => {
    const r = input(); r.site.buildableBoundary = rectangle({ x: -1, z: 0, w: 5000, d: 6000 }); expect(code(r)).toBe('INVALID_REQUIREMENTS');
  });
  it('intersects supplied buildable boundary with supplied edge setbacks', () => {
    const r = input(16000, 18000); r.site.buildableBoundary = rectangle({ x: 500, z: 500, w: 15000, d: 17000 });
    r.site.setbacks = [{ boundaryEdgeStart: 0, minimumMm: 1200 }, { boundaryEdgeStart: 3, minimumMm: 1000 }];
    const { model } = audit(r); expect(bounds(model.levels[0]!.boundary)).toEqual({ x: 1000, z: 1200, w: 14500, d: 16300 });
  });
  it('handles reversed polygon winding and negative origin', () => {
    const r = input(); r.site.boundary = rectangle({ x: -12000, z: -13000, w: 10000, d: 12000 }).reverse(); r.site.setbacks = [{ boundaryEdgeStart: 0, minimumMm: 500 }]; audit(r);
  });
  it('does not add regulatory setbacks and preserves north', () => {
    const r = input(); r.site.northMilliDegrees = 12345; const { model } = audit(r);
    expect(model.site!.setbacks).toEqual([]); expect(model.site!.northMilliDegrees).toBe(12345); expect(model.levels[0]!.boundary).toEqual(r.site.boundary);
  });
  it('respects configurable physical wall thickness and clear room minimums', () => {
    const r = input(); r.exteriorWallThicknessMm = 300; r.interiorWallThicknessMm = 160;
    r.rooms = [{ type: 'bedroom', count: 2, minWidthMm: 2800, minDepthMm: 3000, minAreaMm2: 12000000 }];
    const { model, metadata } = audit(r);
    for (const w of model.walls) expect(w.thicknessMm).toBe(w.classification === 'exterior' ? 300 : 160);
    for (const d of metadata.roomDimensions) { expect(d.clearWidthMm).toBeGreaterThanOrEqual(2800); expect(d.clearDepthMm).toBeGreaterThanOrEqual(3000); expect(d.clearAreaMm2).toBeGreaterThanOrEqual(12000000); }
  });
  it('represents shared partitions once', () => {
    const { model } = audit(input()); const keys = model.walls.map(w => `${w.levelId}:${JSON.stringify(w.path)}`); expect(new Set(keys).size).toBe(keys.length);
    expect(model.walls.some(w => w.spaceIds!.length === 2)).toBe(true);
  });
  it.each([0, 1, 2, 3])('applies setback to edge %i exactly', edge => {
    const r = input(); r.site.setbacks = [{ boundaryEdgeStart: edge, minimumMm: 500 }];
    const c = buildConstraints(normalizeBlueprintRequirements(r));
    expect(c.outer).toEqual([{ x: 0, z: 500, w: 10000, d: 11500 }, { x: 0, z: 0, w: 9500, d: 12000 }, { x: 0, z: 0, w: 10000, d: 11500 }, { x: 500, z: 0, w: 9500, d: 12000 }][edge]);
  });
});

describe('openings and circulation', () => {
  it('places one entrance and a corridor door for every requested room', () => {
    const { model, metadata } = audit(input());
    expect(model.openings.filter(o => o.kind === 'door')).toHaveLength(6);
    expect(metadata.circulation.edges).toHaveLength(5);
  });
  it('detects entrance removal', () => {
    const { model } = generateBlueprint(input()); model.openings = model.openings.filter(o => !model.walls.some(w => w.id === o.wallId && w.classification === 'exterior' && o.kind === 'door'));
    expect(analyzeCirculation(model).unreachableSpaceIds).toHaveLength(model.spaces.length);
  });
  it('detects a missing room door without relying on visual adjacency', () => {
    const { model } = generateBlueprint(input()); model.openings = model.openings.filter(o => !model.walls.some(w => w.id === o.wallId && w.spaceIds?.includes('space-bedroom-1')));
    expect(analyzeCirculation(model).unreachableSpaceIds).toContain('space-bedroom-1');
  });
  it('generates first-class exterior windows with complete vertical geometry', () => {
    const { model } = audit(input()); const windows = model.openings.filter(o => o.kind === 'window'); expect(windows).toHaveLength(5);
    for (const w of windows) { expect(w.sillMm).toBe(900); expect(model.walls.find(h => h.id === w.wallId)!.classification).toBe('exterior'); }
  });
  it('disables windows independently', () => { const r = input(); r.windows = { enabled: false }; expect(audit(r).model.openings.some(o => o.kind === 'window')).toBe(false); });
  it('reports omitted default windows', () => { const r = input(); r.windows = { widthMm: 50000 }; expect(audit(r).metadata.warnings.some(w => w.startsWith('Default window omitted'))).toBe(true); });
  it.each(['adjacent', 'connected', 'passage'] as const)('satisfies a hard %s relationship', kind => {
    const r = input(); r.relationships = [pair('hard', kind)]; r.solver = { maxCandidates: 128 };
    const { model } = audit(r); const wall = model.walls.find(w => w.spaceIds?.includes('space-kitchen-1') && w.spaceIds.includes('space-living-1')); expect(wall).toBeDefined();
    if (kind !== 'adjacent') expect(model.openings.some(o => o.wallId === wall!.id && o.kind === (kind === 'connected' ? 'door' : 'opening'))).toBe(true);
  });
  it('reports a soft cross-level relationship without making it mandatory', () => {
    const r = input(10000, 12000, 2, 2); r.rooms = [{ type: 'kitchen', count: 1, level: 0 }, { type: 'living', count: 1, level: 1 }]; r.relationships = [pair('soft')];
    const { metadata } = audit(r); expect(metadata.softPreferenceScore).toBe(1000); expect(metadata.warnings).toContain('Unmet adjacent preference: kitchen-1/living-1');
  });
  it('fails hard cross-level adjacency', () => {
    const r = input(10000, 12000, 2, 2); r.rooms = [{ type: 'kitchen', count: 1, level: 0 }, { type: 'living', count: 1, level: 1 }]; r.relationships = [pair('hard')];
    expect(code(r)).toBe('UNSATISFIED_HARD_CONSTRAINT');
  });
});

describe('multi-floor, stairs, slabs and dimensions', () => {
  it('reconciles odd floor rise and exact tread run', () => {
    const r = input(10000, 12000, 3, 2); r.floorToFloorHeightMm = 3001;
    const { model } = audit(r), stair = model.stairs[0]!;
    expect(stair.riserHeightsMm).toEqual([...Array<number>(9).fill(188), ...Array<number>(7).fill(187)]);
    expect(stair.riserHeightsMm.reduce((a, b) => a + b, 0)).toBe(3001);
    expect(stair.runMm).toBe(4200); expect(model.levels[1]!.elevationMm - model.levels[0]!.elevationMm).toBe(stair.riseMm);
  });
  it('contains correct lower and upper landing access', () => {
    const { model } = audit(input(10000, 12000, 3, 2)), stair = model.stairs[0]!;
    for (const [level, offset] of [['level-0', 0], ['level-1', 3000]] as const) {
      const door = model.openings.find(o => o.kind === 'door' && o.levelId === level && model.walls.some(w => w.id === o.wallId && w.spaceIds?.some(id => id.startsWith('space-stairwell'))))!;
      expect(landingDoorFits(model, door, stair.landings.find(l => l.elevationOffsetMm === offset)!)).toBe(true);
    }
  });
  it('deducts the flight void from the upper floor plate exactly', () => {
    const { model } = audit(input(10000, 12000, 3, 2));
    expect(model.slabs.find(s => s.id === 'slab-1')!.footprint.voids).toEqual([model.stairs[0]!.footprint]);
    expect(grossFloorAreaMm2(model)).toBe(String(2 * 10000 * 12000 - 1000 * 4200));
    for (const s of model.slabs) expect(s.thicknessMm).toBe(150);
  });
  it('detects disconnected floor groups when a stair is removed', () => {
    const { model } = generateBlueprint(input(10000, 12000, 3, 2)); model.stairs = [];
    expect(analyzeCirculation(model).unreachableSpaceIds).toContain('space-corridor-1');
  });
  it('rejects missing upper landing door in the circulation analysis', () => {
    const { model } = generateBlueprint(input(10000, 12000, 3, 2)); model.openings = model.openings.filter(o => !(o.levelId === 'level-1' && model.walls.some(w => w.id === o.wallId && w.spaceIds?.includes('space-stairwell-1'))));
    expect(() => analyzeCirculation(model)).toThrow(BlueprintError);
  });
  it('allocates level-specific rooms without cloning a floor', () => {
    const r = input(10000, 16000, 3, 2); r.rooms = [{ type: 'bedroom', count: 3, level: 1 }, { type: 'kitchen', count: 1, level: 0 }, { type: 'living', count: 1, level: 0 }];
    const { model } = audit(r);
    expect(model.spaces.filter(s => s.classification === 'bedroom').every(s => s.levelId === 'level-1')).toBe(true);
    expect(model.spaces.filter(s => s.classification === 'kitchen').every(s => s.levelId === 'level-0')).toBe(true);
  });
  it('supports an explicitly empty upper floor without silently moving rooms', () => {
    const r = input(10000, 16000, 3, 2); r.rooms = [{ type: 'living', count: 1, level: 0 }]; const { model } = audit(r);
    expect(model.spaces.filter(s => s.levelId === 'level-1').map(s => s.classification).sort()).toEqual(['circulation', 'stairwell']);
  });
  it('room dimension anchors match boundary extents exactly', () => {
    const { model } = audit(input(10001, 12003));
    for (const s of model.spaces) {
      const b = bounds(s.boundary), dims = model.dimensions.filter(d => d.purpose === 'room' && d.anchors.some(a => a.kind === 'space-vertex' && a.spaceId === s.id));
      expect(dims.map(d => dimensionMeasurements(model, d).overallMm)).toEqual([b.w, b.d]);
    }
  });
  it('round-trips architectural JSON without changing geometry or provenance', () => {
    const result = generateBlueprint(input()); expect(ArchitecturalBuildingModelV2Schema.parse(JSON.parse(JSON.stringify(result.model)))).toEqual(result.model);
    expect(result.model.provenance.generatorVersion).toBe(BLUEPRINT_VERSION); expect(result.model.completeness).toBe('architectural');
  });
});

describe('precision, scoring and bounded search', () => {
  it.each([[9000, [3000, 1200, 4800], [3000, 1200, 4800]], [9001, [3000, 1200, 4800], [3001, 1200, 4800]], [10, [1, 1, 1], [4, 3, 3]]] as const)('reconciles chain %i exactly', (overall, mins, expected) => expect(reconcilePartition(overall, mins)).toEqual(expected));
  it('rejects a chain whose minimums exceed control', () => expect(() => reconcilePartition(9000, [3000, 1200, 4801])).toThrow(BlueprintError));
  it.each([NaN, Infinity, 9.5, 0])('rejects noncanonical chain value %s', n => expect(() => reconcilePartition(n, [1])).toThrow(BlueprintError));
  it('scores dimensions explicitly and repeats without accumulation', () => {
    const r = normalizeBlueprintRequirements({ ...input(), rooms: [{ type: 'bedroom', count: 1, preferredWidthMm: 1, preferredDepthMm: 1 }] }), c = buildConstraints(r);
    const candidate = allocateCandidate(r, c, c.rooms, 'z', 0, 0, { candidates: 0, iterations: 0 });
    const s = candidate.spaces.find(s => s.role === 'room')!;
    const score = Math.ceil((s.clear.w - 1) / 100) + Math.ceil((s.clear.d - 1) / 100);
    expect(candidate.score).toBe(score); scoreCandidate(r, c, candidate); expect(candidate.score).toBe(score);
    expect(candidate.warnings).toHaveLength(2);
  });
  it('gives exactly 100 points to an unmet front/rear preference', () => {
    const r = normalizeBlueprintRequirements({ ...input(), rooms: [{ type: 'bedroom', count: 1, positionPreference: 'front' }] }), c = buildConstraints(r);
    const candidate = allocateCandidate(r, c, c.rooms, 'z', 0, 0, { candidates: 0, iterations: 0 }); expect(candidate.score).toBe(100);
  });
  it('returns the best evaluated score, with a stable tie break', () => {
    const r = input(); r.rooms[0]!.preferredWidthMm = 4000;
    const small = generateBlueprint({ ...r, solver: { maxCandidates: 1 } }), bigger = generateBlueprint({ ...r, solver: { maxCandidates: 32 } });
    expect(bigger.metadata.softPreferenceScore).toBeLessThanOrEqual(small.metadata.softPreferenceScore); expect(small.metadata.selectedCandidate).toBe(0);
    expect(small.metadata.searchComplete).toBe(false);
  });
  it('returns a typed failure at the iteration budget', () => { const r = input(); r.solver = { maxIterations: 1 }; expect(code(r)).toBe('SEARCH_LIMIT_EXHAUSTED'); });
  it('limits failed candidate attempts and includes safe diagnostics', () => {
    const r = input(2500, 2500); r.solver = { maxCandidates: 1 };
    try { generateBlueprint(r); throw new Error('Expected failure'); } catch (e) { expect(e).toBeInstanceOf(BlueprintError); const error = e as BlueprintError; expect(error.code).toBe('SEARCH_LIMIT_EXHAUSTED'); expect(error.diagnostics.candidateAttempts).toBe(1); expect(JSON.stringify(error.diagnostics).length).toBeLessThan(500); }
  });
  it('reports exhausted finite candidate family without claiming global impossibility', () => { const r = input(2500, 2500, 1); r.solver = { maxCandidates: 128 }; expect(code(r)).toBe('IMPOSSIBLE_LAYOUT'); });
  it('seed influences exploration while preserving reproducibility', () => {
    const a = generateBlueprint({ ...input(), seed: 'variation-a' }), b = generateBlueprint({ ...input(), seed: 'variation-b' }); expect(a.model.spaces).not.toEqual(b.model.spaces);
    expect(generateBlueprint({ ...input(), seed: 'variation-a' })).toEqual(a);
  });
});

describe('bounded adversarial and property corpus', () => {
  it.each([[2500, 60000], [60000, 2500], [3000, 3000]])('fails safely for an inadequate %i by %i plot', (w, d) => {
    const r = input(w, d, 4); r.solver = { maxCandidates: 128 }; expect(['IMPOSSIBLE_LAYOUT', 'SEARCH_LIMIT_EXHAUSTED']).toContain(code(r));
  });
  it('supports a minimum default single-room footprint', () => { const r = input(3500, 2200); r.rooms = [{ type: 'bedroom', count: 1 }]; expect(audit(r).metadata.roomDimensions[0]).toMatchObject({ clearWidthMm: 1800, clearDepthMm: 1800 }); });
  it('supports 24 rooms within the maximum envelope', () => { const r = input(60000, 60000); r.rooms = [{ type: 'bedroom', count: 24 }]; r.solver = { maxCandidates: 2 }; expect(audit(r).metadata.roomDimensions).toHaveLength(24); });
  it('fails impossible minimum room sizes without dropping rooms', () => { const r = input(); r.rooms = [{ type: 'bedroom', count: 1, minWidthMm: 20000, minDepthMm: 20000 }]; expect(code(r)).toBe('IMPOSSIBLE_LAYOUT'); });
  it('fails an impossible straight stair footprint', () => { const r = input(5000, 5000, 1, 2); r.stair = { riserCount: 40, treadDepthMm: 600 }; expect(code(r)).toBe('STAIR_PLACEMENT_FAILED'); });
  it('fails contradictory same-bank adjacency demands', () => {
    const r = input(); r.rooms = [{ type: 'bedroom', count: 1 }, { type: 'kitchen', count: 1 }, { type: 'living', count: 1 }];
    r.relationships = [pair('hard'), { from: { type: 'bedroom' }, to: { type: 'kitchen' }, strength: 'hard' }, { from: { type: 'bedroom' }, to: { type: 'living' }, strength: 'hard' }]; r.solver = { maxCandidates: 128 };
    expect(code(r)).toBe('UNSATISFIED_HARD_CONSTRAINT');
  });
  it('fails setbacks that consume the entire buildable region', () => { const r = input(); r.site.setbacks = [{ boundaryEdgeStart: 0, minimumMm: 12000 }]; expect(code(r)).toBe('IMPOSSIBLE_LAYOUT'); });
  for (let seed = 0; seed < 32; seed++) it(`fixed seed property ${seed}`, () => {
    const r = input(9000 + seed * 7, 14000 + seed * 11, seed % 4 + 1, seed % 2 ? 2 : 1); r.seed = `corpus-${seed}`; r.solver = { maxCandidates: 8 }; r.windows = { enabled: seed % 3 !== 0 };
    r.exteriorWallThicknessMm = 180 + (seed % 4) * 20; r.interiorWallThicknessMm = 80 + (seed % 3) * 20;
    const result = audit(r); expect(generateBlueprint(r)).toEqual(result);
  });
  it('isolates concurrent mixed calls', async () => {
    const values = Array.from({ length: 6 }, (_, i) => ({ ...input(10000 + i, 14000 + i, 1 + i % 3, i % 2 ? 2 : 1), seed: `concurrent-${i}`, solver: { maxCandidates: 4 } }));
    const expected = values.map(generateBlueprint);
    const actual = await Promise.all(values.map(async r => generateBlueprint(r))); expect(actual).toEqual(expected);
  });
  it('isolates actual parallel worker generations', async () => {
    const moduleUrl = new URL('../src/index.ts', import.meta.url).href;
    const values = [input(10000, 12000, 1, 1), input(11000, 14000, 3, 2)].map((r, i) => ({ ...r, seed: `worker-${i}`, solver: { maxCandidates: 4 } }));
    const actual = await Promise.all(values.map(value => new Promise<unknown>((resolve, reject) => {
      const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads'); import('tsx/esm/api').then(({tsImport})=>tsImport(workerData.moduleUrl,workerData.moduleUrl)).then(m=>parentPort.postMessage(m.generateBlueprint(workerData.value))).catch(e=>{throw e;});`, { eval: true, workerData: { moduleUrl, value } });
      worker.once('message', resolve); worker.once('error', reject); worker.once('exit', code => { if (code !== 0) reject(new Error(`Worker exit ${code}`)); });
    })));
    expect(actual).toEqual(values.map(generateBlueprint));
  });
  it('has a generous maximum-size solve guard and measures attempts', () => {
    const r = input(60000, 60000, 1, 2); r.rooms = [{ type: 'bedroom', count: 24 }]; r.solver = { maxCandidates: 8 };
    const start = performance.now(), result = generateBlueprint(r), duration = performance.now() - start;
    expect(duration).toBeLessThan(15000); expect(result.metadata.candidateAttempts).toBe(8); expect(result.metadata.iterations).toBeLessThanOrEqual(20000);
    expect(polygonAreaMm2(result.model.levels[0]!.boundary)).toBe('3600000000');
  });
});

describe('Phase 10 continuation review regressions', () => {
  it('enforces the total room limit across otherwise valid groups', () => {
    const r = input(60000, 60000);
    r.rooms = [{ type: 'bedroom', count: 13 }, { type: 'study', count: 12 }];
    expect(code(r)).toBe('INVALID_REQUIREMENTS');
  });
  it('rejects a nonrectangular buildable boundary without approximating it', () => {
    const r = input();
    r.site.buildableBoundary = [{ x: 1000, z: 1000 }, { x: 9000, z: 1000 }, { x: 4000, z: 10000 }];
    expect(code(r)).toBe('UNSUPPORTED_GEOMETRY');
  });
  it('rejects disjoint setback and supplied buildable regions', () => {
    const r = input();
    r.site.buildableBoundary = rectangle({ x: 500, z: 500, w: 5000, d: 4000 });
    r.site.setbacks = [{ boundaryEdgeStart: 0, minimumMm: 6000 }];
    expect(code(r)).toBe('IMPOSSIBLE_LAYOUT');
  });
  it('preserves explicit and automatic same-type groups and stable selector ordinals', () => {
    const r = input(12000, 16000, 1, 2);
    r.rooms = [
      { type: 'bedroom', count: 1, level: 1, minWidthMm: 3000 },
      { type: 'bedroom', count: 1, level: 0, minDepthMm: 2500 },
      { type: 'bedroom', count: 2 },
    ];
    const result = audit(r);
    for (const [ordinal, level] of [[1, 0], [2, 1], [3, 0], [4, 1]]) {
      expect(result.model.spaces.find(s => s.id === `space-bedroom-${ordinal}`)?.levelId).toBe(`level-${level}`);
    }
    expect(generateBlueprint({ ...r, rooms: [...r.rooms].reverse() })).toEqual(result);
  });
  it('reaches upper rooms through an explicitly unoccupied ground floor', () => {
    const r = input(12000, 16000, 1, 2);
    r.rooms = [{ type: 'bedroom', count: 1, level: 1 }];
    const { model, metadata } = audit(r);
    expect(model.spaces.filter(s => s.levelId === 'level-0').map(s => s.classification).sort()).toEqual(['circulation', 'stairwell']);
    expect(metadata.circulation.reachableSpaceIds).toContain('space-bedroom-1');
  });
  it('reconciles rotated stair access, dimensions and slab voids', () => {
    const r = input(16000, 5000, 1, 2);
    r.rooms = [{ type: 'bedroom', count: 1, level: 1 }];
    const { model } = audit(r), stair = model.stairs[0]!;
    expect(stair.direction).toBe('+x');
    expect(bounds(stair.footprint)).toMatchObject({ w: 4200, d: 1000 });
    for (const landing of stair.landings) {
      const levelId = landing.elevationOffsetMm === 0 ? 'level-0' : 'level-1';
      const slab = model.slabs.find(s => s.kind === 'floor' && s.levelId === levelId)!;
      expect(ringContains(slab.footprint.outer, landing.footprint)).toBe(true);
      expect(slab.footprint.voids.some(voidRing => ringsOverlap(voidRing, landing.footprint))).toBe(false);
      expect(model.openings.some(o => o.kind === 'door' && o.levelId === levelId
        && model.walls.some(w => w.id === o.wallId && w.spaceIds?.includes(`space-stairwell-${levelId.slice(-1)}`))
        && landingDoorFits(model, o, landing))).toBe(true);
    }
  });
  it('honors custom odd stair dimensions without fractional risers or lost run', () => {
    const r = input(12000, 16000, 2, 2);
    r.floorToFloorHeightMm = 3101;
    r.stair = { widthMm: 1251, riserCount: 19, treadDepthMm: 251, landingDepthMm: 1401 };
    const { model } = audit(r), stair = model.stairs[0]!;
    expect(stair.widthMm).toBe(1251);
    expect(stair.runMm).toBe(4518);
    expect(stair.riserHeightsMm).toEqual([...Array<number>(4).fill(164), ...Array<number>(15).fill(163)]);
    expect(stair.landings.map(l => bounds(l.footprint).d)).toEqual([1401, 1401]);
  });
  it('enforces the exact clear-area boundary without tolerance or requirement loss', () => {
    const r = input(3500, 2200);
    r.rooms = [{ type: 'bedroom', count: 1, minAreaMm2: 3240000 }];
    expect(audit(r).metadata.roomDimensions[0]?.clearAreaMm2).toBe(3240000);
    r.rooms[0]!.minAreaMm2 = 3240001;
    expect(code(r)).toBe('IMPOSSIBLE_LAYOUT');
  });
  it.each([-100000000, 99984000])('retains exact geometry at coordinate origin %i', origin => {
    const r = input(12000, 16000, 2, 2);
    r.site.boundary = rectangle({ x: origin, z: origin, w: 12000, d: 16000 });
    const { model, metadata } = audit(r);
    expect(bounds(model.levels[0]!.boundary)).toEqual({ x: origin, z: origin, w: 12000, d: 16000 });
    expect(metadata.utilization.footprintAreaMm2).toBe(192000000);
  });
});
