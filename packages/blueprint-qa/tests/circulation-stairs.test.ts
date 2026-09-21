import { describe, expect, it } from 'vitest';
import { BuildingModelShapeSchema, type BuildingModelV2 } from '@designflow/shared';
import { auditBlueprint } from '../src/index.js';
import { authored, authoredOptions, generated, generatorOptions, rect } from './fixtures.js';

describe('independent circulation', () => {
  it('requires explicit entrance semantics for a generic V2 model', () => {
    const r = auditBlueprint(authored()); expect(r.status).toBe('PASS_WITH_WARNINGS'); expect(r.circulation.evaluated).toBe(false); expect(r.findings.map(f => f.code)).toEqual(['QA_ENTRANCE_NOT_SPECIFIED']);
  });
  it('fails required reachability when entrance semantics are unavailable', () => expect(auditBlueprint(authored(), { requireReachability: true }).status).toBe('FAIL'));
  it('accepts a caller-designated entry space', () => expect(auditBlueprint(authored(), { entrySpaceIds: ['foyer'], requireReachability: true }).status).toBe('PASS'));
  it('rejects a window designated as an entrance', () => expect(auditBlueprint(authored(), { entryOpeningIds: ['studio-window'] }).findings.map(f => f.code)).toContain('QA_ENTRY_OPENING_INVALID'));
  it('rejects a missing entry reference', () => expect(auditBlueprint(authored(), { entrySpaceIds: ['missing'] }).findings.map(f => f.code)).toContain('QA_ENTRY_REFERENCE'));
  it('rebuilds door topology when stored wall.spaceIds are absent', () => {
    const m = authored(); for (const w of m.walls) delete w.spaceIds;
    const r = auditBlueprint(m, authoredOptions); expect(r.status).toBe('PASS'); expect(r.circulation.edges).toEqual([{ from: 'foyer', to: 'studio', via: 'studio-door', kind: 'door' }]);
  });
  it('generic passage creates connectivity; service opening and window do not', () => {
    const m = authored(), original = m.openings[1]!;
    const common = { id: original.id, wallId: original.wallId, levelId: original.levelId, offsetMm: original.offsetMm, widthMm: original.widthMm, heightMm: original.heightMm, sillMm: original.sillMm, type: original.type };
    m.openings[1] = { ...common, kind: 'opening', purpose: 'passage' };
    expect(auditBlueprint(m, authoredOptions).status).toBe('PASS');
    m.openings[1] = { ...common, kind: 'opening', purpose: 'service' };
    expect(auditBlueprint(m, authoredOptions).circulation.unreachableSpaceIds).toEqual(['studio']);
    m.openings[1] = { ...common, kind: 'window' };
    expect(auditBlueprint(m, authoredOptions).circulation.unreachableSpaceIds).toEqual(['studio']);
  });
  it('raised threshold cannot fabricate a floor-level edge', () => {
    const m = authored(); m.openings[1]!.sillMm = 1; m.dimensions = [];
    const r = auditBlueprint(m, authoredOptions); expect(r.findings.map(f => f.code)).toContain('QA_RAISED_PASSAGE_NOT_CONNECTED'); expect(r.circulation.unreachableSpaceIds).toEqual(['studio']);
  });
  it('occupied-only mode does not silently treat unknown occupancy as empty', () => {
    const m = authored(); delete m.spaces[1]!.occupancy;
    const r = auditBlueprint(m, { ...authoredOptions, occupiedSpacesOnly: true }); expect(r.findings.map(f => f.code)).toContain('QA_OCCUPANCY_NOT_EVALUATED');
  });
});

describe('straight stair arithmetic, access, plates and vertical graph', () => {
  it('valid two-level plan has one independently reconstructed stair edge', () => {
    const r = auditBlueprint(generated(2), generatorOptions); expect(r.status).toBe('PASS'); expect(r.circulation.unreachableSpaceIds).toEqual([]); expect(r.circulation.edges.filter(e => e.kind === 'stair')).toHaveLength(1);
    expect(r.measurements.stairs[0]).toMatchObject({ levelRiseMm: 3000, riserSumMm: 3000, calculatedRunMm: 4200, footprintRunMm: 4200, treadCount: 15 });
  });
  const mutations: [string, string, (m: BuildingModelV2) => void][] = [
    ['riser sum -1 mm', 'QA_STAIR_RISE_MISMATCH', m => { m.stairs[0]!.riserHeightsMm[0]!--; }],
    ['riser sum +1 mm', 'QA_STAIR_RISE_MISMATCH', m => { m.stairs[0]!.riserHeightsMm[0]!++; }],
    ['run +1 mm', 'QA_STAIR_RUN_MISMATCH', m => { m.stairs[0]!.runMm++; }],
    ['footprint width', 'QA_STAIR_FOOTPRINT_MISMATCH', m => { m.stairs[0]!.widthMm++; }],
    ['wrong destination', 'QA_STAIR_LEVEL_PAIR', m => { m.stairs[0]!.toLevelId = m.stairs[0]!.fromLevelId; }],
    ['missing destination', 'QA_STAIR_LEVEL_PAIR', m => { m.stairs[0]!.toLevelId = 'missing'; }],
    ['wrong level elevation', 'QA_LEVEL_HEIGHT_MISMATCH', m => { m.levels[1]!.elevationMm++; }],
    ['duplicate level elevation', 'QA_DUPLICATE_LEVEL', m => { m.levels[1]!.elevationMm = m.levels[0]!.elevationMm; }],
    ['descending indexed levels', 'QA_LEVEL_ORDER', m => { m.levels[1]!.elevationMm = -3000; }],
    ['deleted upper void', 'QA_STAIR_VOID_MISSING', m => { m.slabs.find(s => s.levelId === 'level-1' && s.kind === 'floor')!.footprint.voids = []; }],
    ['mismatched upper void', 'QA_STAIR_VOID_MISSING', m => { const slab = m.slabs.find(s => s.levelId === 'level-1' && s.kind === 'floor')!; slab.footprint.voids[0] = slab.footprint.voids[0]!.map(p => ({ ...p, x: p.x + 1 })); }],
    ['wrong slab elevation', 'QA_STAIR_VOID_MISSING', m => { m.slabs.find(s => s.levelId === 'level-1' && s.kind === 'floor')!.topOffsetMm = 1; }],
    ['reversed stair direction', 'QA_STAIR_LANDING_GEOMETRY', m => { m.stairs[0]!.direction = m.stairs[0]!.direction === '+z' ? '-z' : '-x'; }],
    ['wrong landing elevation', 'QA_STAIR_LANDING_ELEVATION', m => { m.stairs[0]!.landings[0]!.elevationOffsetMm = 1; }],
    ['absent landing', 'QA_STAIR_LANDING_INACCESSIBLE', m => { m.stairs[0]!.landings.pop(); }],
    ['removed landing door', 'QA_STAIR_LANDING_INACCESSIBLE', m => { const wall = m.walls.find(w => w.levelId === 'level-1' && w.spaceIds?.includes('space-stairwell-1') && w.spaceIds.length === 2)!; m.openings = m.openings.filter(o => o.wallId !== wall.id); m.dimensions = []; }],
    ['isolate upper floor', 'QA_DISCONNECTED_LEVEL', m => { m.stairs = []; }],
    ['column blocks stair', 'QA_STAIR_COLUMN_COLLISION', m => { const p = m.stairs[0]!.footprint[0]!; m.columns.push({ id: 'obstruction', levelId: 'level-0', crossSection: { outer: rect(p.x + 1, p.z + 1, 100, 100), voids: [] }, heightMm: 3000, baseOffsetMm: 0 }); }],
  ];
  it.each(mutations)('%s -> %s', (_, code, mutate) => {
    const m = generated(2); mutate(m); expect(BuildingModelShapeSchema.safeParse(m).success).toBe(true);
    const r = auditBlueprint(m, generatorOptions); expect(r.findings.map(f => f.code)).toContain(code); expect(r.status).toBe('FAIL');
    expect(r.findings.length).toBeLessThan(50);
  });
  it('exact stair discrepancy is explained in machine-readable evidence', () => {
    const m = generated(2); m.stairs[0]!.riserHeightsMm[0]!--;
    expect(auditBlueprint(m, generatorOptions).findings.find(f => f.code === 'QA_STAIR_RISE_MISMATCH')).toMatchObject({ expected: 3000, actual: { riserSumMm: 2999 }, evidence: { deltaMm: -1 } });
  });
});
