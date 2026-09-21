import { describe, expect, it } from 'vitest';
import { BuildingModelShapeSchema, BuildingModelV2Schema, type BuildingModelV2 } from '@designflow/shared';
import { auditBlueprint, BlueprintQaReportSchema } from '../src/index.js';
import { authored, authoredOptions, freeze, generated, generatorOptions, rect } from './fixtures.js';

const codes = (model: unknown, options: unknown = authoredOptions) => auditBlueprint(model, options).findings.map(f => f.code);
describe('trust and report boundary', () => {
  it.each([null, [], {}, { schemaVersion: 1 }, 'bad', 42])('malformed document %j is a report, not a crash', value => {
    const r = auditBlueprint(value); expect(r.status).toBe('FAIL'); expect(r.inputStatus).toBe('SCHEMA_INVALID'); expect(r.findings[0]?.code).toBe('QA_SCHEMA_INVALID');
  });
  it('accepts a hand-authored complete architectural document', () => {
    const m = authored(); expect(BuildingModelV2Schema.safeParse(m).success).toBe(true);
    const r = auditBlueprint(m, authoredOptions); expect(r.status).toBe('PASS'); expect(r.findings).toEqual([]); expect(r.circulation.reachableSpaceIds).toEqual(['foyer', 'studio']);
    expect(r.measurements.grossFloorAreaMm2).toBe('48000000'); expect(r.coverage.every(s => s.outcome === 'EVALUATED')).toBe(true);
  });
  it('does not assume legacy planar data is architectural', () => {
    const m = authored(); m.completeness = 'legacy-planar'; m.provenance = { creationMode: 'legacy-adapter', adapterVersion: 'v1-to-v2/1', measurementVersion: 'mm-exact/1' };
    const r = auditBlueprint(m); expect(r.findings.some(f => f.code === 'QA_INCOMPLETE_DOCUMENT')).toBe(true); expect(r.coverage.find(c => c.stage === 'walls')?.outcome).toBe('NOT_EVALUATED');
  });
  it('rejects invalid options through the same deliberate report boundary', () => {
    expect(codes(authored(), { requireReachability: 'yes' })).toEqual(['QA_OPTIONS_INVALID']);
  });
  it('rejects cycles and accessors without invoking getters', () => {
    const cycle: { itself?: unknown } = {}; cycle.itself = cycle;
    expect(codes(cycle)).toContain('QA_SCHEMA_INVALID');
    let calls = 0; const input = Object.defineProperty({}, 'schemaVersion', { get() { calls++; throw new Error('unsafe'); }, enumerable: true });
    expect(codes(input)).toContain('QA_SCHEMA_INVALID'); expect(calls).toBe(0);
  });
  it('reports deterministic resource limits without claiming remaining checks ran', () => {
    const r = auditBlueprint(authored(), { ...authoredOptions, maxGeometryWork: 1 });
    expect(r.status).toBe('FAIL'); expect(r.findings.some(f => f.code === 'QA_RESOURCE_LIMIT')).toBe(true); expect(r.coverage.some(s => s.outcome === 'NOT_EVALUATED')).toBe(true);
  });
  it('bounds giant arrays before geometric refinements', () => expect(codes({ walls: Array(8193).fill(null) })).toContain('QA_RESOURCE_LIMIT'));
  it('stops ambiguous duplicate IDs before graph construction', () => {
    const m = authored(); m.walls[0]!.id = m.walls[1]!.id;
    const r = auditBlueprint(m, authoredOptions); expect(r.findings.map(f => f.code)).toEqual(['QA_DUPLICATE_ID']); expect(r.circulation.evaluated).toBe(false);
  });
});

describe('sabotage: independently detected primary findings', () => {
  const mutations: [string, string, (m: BuildingModelV2) => void][] = [
    ['controlling total +1', 'QA_DIMENSION_MISMATCH', m => { const c = m.dimensions[0]!.constraint; if (c.mode === 'controlling') c.overallMm++; }],
    ['controlling total -1', 'QA_DIMENSION_MISMATCH', m => { const c = m.dimensions[0]!.constraint; if (c.mode === 'controlling') c.overallMm--; }],
    ['missing segment', 'QA_DIMENSION_CHAIN_RECONCILIATION', m => { const c = m.dimensions[0]!.constraint; if (c.mode === 'controlling') c.segmentsMm.pop(); }],
    ['duplicated segment', 'QA_DIMENSION_CHAIN_RECONCILIATION', m => { const c = m.dimensions[0]!.constraint; if (c.mode === 'controlling') c.segmentsMm.push(4000); }],
    ['reversed chain', 'QA_DIMENSION_CHAIN_ORDER', m => { m.dimensions[0]!.anchors.reverse(); [m.dimensions[0]!.anchors[0], m.dimensions[0]!.anchors[1]] = [m.dimensions[0]!.anchors[1]!, m.dimensions[0]!.anchors[0]!]; }],
    ['missing anchor', 'QA_DIMENSION_ANCHOR_UNRESOLVED', m => { m.dimensions[1]!.anchors[0] = { kind: 'space-vertex', spaceId: 'missing', vertexIndex: 0 }; }],
    ['invalid vertex anchor', 'QA_DIMENSION_ANCHOR_UNRESOLVED', m => { m.dimensions[1]!.anchors[0] = { kind: 'space-vertex', spaceId: 'studio', vertexIndex: 99 }; }],
    ['overlapping room', 'QA_ROOM_OVERLAP', m => { m.spaces[1]!.boundary[0]!.x -= 100; m.spaces[1]!.boundary[3]!.x -= 100; }],
    ['duplicate boundary', 'QA_ROOM_OVERLAP', m => { m.spaces[1]!.boundary = structuredClone(m.spaces[0]!.boundary); }],
    ['outside room', 'QA_SPACE_OUTSIDE_LEVEL', m => { m.spaces[1]!.boundary = rect(7000, 100, 3900, 5800); }],
    ['duplicate wall', 'QA_DUPLICATE_WALL', m => { m.walls.push({ ...structuredClone(m.walls[0]!), id: 'duplicate' }); }],
    ['conflicting wall interval', 'QA_WALL_INTERVAL_OVERLAP', m => { m.walls.push({ ...structuredClone(m.walls[0]!), id: 'conflict', thicknessMm: 300 }); }],
    ['outside physical wall', 'QA_OUTSIDE_BUILDABLE_BOUNDARY', m => { m.walls.find(w => w.id === 'west')!.thicknessMm = 202; }],
    ['wrong wall relationship', 'QA_WALL_SPACE_RELATIONSHIP', m => { m.walls.find(w => w.id === 'partition')!.spaceIds = ['foyer']; }],
    ['wrong exterior classification', 'QA_WALL_CLASSIFICATION', m => { m.walls.find(w => w.id === 'partition')!.classification = 'exterior'; }],
    ['missing wall level', 'QA_LEVEL_REFERENCE', m => { m.walls[0]!.levelId = 'missing'; }],
    ['door past host', 'QA_OPENING_OUTSIDE_HOST', m => { m.openings[1]!.offsetMm = 5700; }],
    ['overlapping doors', 'QA_OPENING_OVERLAP', m => { m.openings.push({ ...structuredClone(m.openings[1]!), id: 'overlapping-door' }); }],
    ['window above wall', 'QA_OPENING_ABOVE_HOST', m => { m.openings[2]!.sillMm = 2700; }],
    ['door/window collision', 'QA_OPENING_OVERLAP', m => { m.openings[2]!.wallId = 'partition'; m.openings[2]!.offsetMm = 1800; }],
    ['host missing', 'QA_OPENING_HOST_MISSING', m => { m.openings[1]!.wallId = 'missing'; }],
    ['wrong opening level', 'QA_OPENING_LEVEL_MISMATCH', m => { m.openings[1]!.levelId = 'missing'; }],
    ['wall below opening', 'QA_OPENING_ABOVE_HOST', m => { m.walls.find(w => w.id === 'partition')!.heightMm = 2000; }],
    ['disconnect studio', 'QA_UNREACHABLE_SPACE', m => { m.openings = m.openings.filter(o => o.id !== 'studio-door'); m.dimensions = m.dimensions.filter(d => d.id !== 'door-offset'); }],
    ['wall above level', 'QA_WALL_ABOVE_STOREY', m => { m.walls[0]!.heightMm = 4000; }],
    ['slab outside', 'QA_SLAB_OUTSIDE_LEVEL', m => { m.slabs[0]!.footprint.outer = rect(-1, 0, 8001, 6000); }],
    ['duplicate slab', 'QA_SLAB_OVERLAP', m => { m.slabs.push({ ...structuredClone(m.slabs[0]!), id: 'overlapping-slab' }); }],
    ['column outside', 'QA_COLUMN_OUTSIDE_LEVEL', m => { m.columns.push({ id: 'column', levelId: 'ground', crossSection: { outer: rect(7999, 1000, 200, 200), voids: [] }, baseOffsetMm: 0, heightMm: 2000 }); }],
    ['declared setback', 'QA_DECLARED_SETBACK_VIOLATION', m => { m.site!.setbacks = [{ id: 'setback', boundaryEdgeStart: 0, minimumMm: 1 }]; }],
    ['fragment', 'QA_DISCONNECTED_WALL_FRAGMENT', m => { m.walls.push({ id: 'fragment', levelId: 'ground', path: { start: { x: 2000, z: 2000 }, end: { x: 2000, z: 3000 } }, pathReference: 'centerline', thicknessMm: 100, heightMm: 2800, baseOffsetMm: 0, classification: 'partition' }); }],
    ['gap', 'QA_WALL_BOUNDARY_GAP', m => { m.walls[0]!.path.start.x += 1; }],
  ];
  it.each(mutations)('%s -> %s', (_, code, mutate) => {
    const m = authored(); mutate(m); expect(BuildingModelShapeSchema.safeParse(m).success).toBe(true);
    const r = auditBlueprint(m, authoredOptions); expect(r.inputStatus).toBe('SCHEMA_VALID'); expect(r.findings.map(f => f.code)).toContain(code);
    expect(r.findings.length).toBeLessThan(30);
  });
  it('exact 1 mm mismatch carries measured delta with no unrelated findings', () => {
    const m = authored(), d = m.dimensions[0]!;
    d.constraint = { mode: 'controlling', overallMm: 8001, segmentsMm: [4000, 4001] };
    const r = auditBlueprint(m, authoredOptions);
    expect(r.findings).toHaveLength(1); expect(r.findings[0]).toMatchObject({ code: 'QA_DIMENSION_MISMATCH', expected: { overallMm: 8001 }, actual: { overallMm: 8000 }, evidence: { deltaMm: -1 } });
  });
});

describe('primitive schema geometry and operation failures', () => {
  const corruptions: [string, (m: BuildingModelV2) => void][] = [
    ['zero-length wall', m => { m.walls[0]!.path.end = { ...m.walls[0]!.path.start }; }],
    ['zero wall thickness', m => { m.walls[0]!.thicknessMm = 0; }],
    ['negative sill', m => { m.openings[2]!.sillMm = -1; }],
    ['crossed polygon', m => { m.spaces[0]!.boundary = [{ x: 100, z: 100 }, { x: 4000, z: 5900 }, { x: 100, z: 5900 }, { x: 4000, z: 100 }]; }],
    ['zero-area polygon', m => { m.spaces[0]!.boundary = [{ x: 1, z: 1 }, { x: 2, z: 2 }, { x: 3, z: 3 }]; }],
    ['void outside slab', m => { m.slabs[0]!.footprint.voids = [rect(-1, 100, 100, 100)]; }],
    ['overlapping voids', m => { m.slabs[0]!.footprint.voids = [rect(100, 100, 100, 100), rect(150, 150, 100, 100)]; }],
    ['invalid swing', m => { const o = m.openings[1]!; if (o.kind === 'door') o.operation = { kind: 'hinged', hinge: 'start', swingSide: 'left', angleMilliDegrees: 180001 }; }],
  ];
  it.each(corruptions)('%s is a schema defect', (_, mutate) => {
    const m = authored(); mutate(m); const r = auditBlueprint(m, authoredOptions);
    expect(r.inputStatus).toBe('SCHEMA_INVALID'); expect(r.findings.every(f => f.code === 'QA_SCHEMA_INVALID')).toBe(true); expect(r.measurements.spaces).toEqual([]);
  });
});

describe('determinism, immutability and serializable reports', () => {
  it('accepts deeply frozen input and options, repeats identically, and round-trips', () => {
    const m = freeze(authored()), options = freeze(authoredOptions), before = JSON.stringify(m);
    const a = auditBlueprint(m, options), b = auditBlueprint(m, options);
    expect(a).toEqual(b); expect(JSON.stringify(m)).toBe(before); expect(BlueprintQaReportSchema.parse(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });
  it('sorts distinct findings stably, independent of entity array order', () => {
    const m = authored(); m.openings[2]!.sillMm = 2700; m.walls[0]!.heightMm = 3001;
    const first = auditBlueprint(m, authoredOptions); m.openings.reverse(); m.walls.reverse(); m.spaces.reverse(); m.dimensions.reverse();
    expect(auditBlueprint(m, authoredOptions)).toEqual(first);
  });
  it('does not share state between concurrent callers', async () => {
    const m = freeze(generated(2)); const all = await Promise.all(Array.from({ length: 8 }, async () => auditBlueprint(m, generatorOptions)));
    for (const r of all) expect(r).toEqual(all[0]); all[0]!.findings.push({ code: 'QA_TEST', severity: 'INFO', category: 'document', entityIds: [], message: 'test', actual: null, expected: null, evidence: {} });
    expect(all[1]!.findings).toHaveLength(0);
  });
  it('runtime report schema rejects a fabricated PASS with errors', () => {
    const r = auditBlueprint(null); r.status = 'PASS'; expect(BlueprintQaReportSchema.safeParse(r).success).toBe(false);
  });
});
