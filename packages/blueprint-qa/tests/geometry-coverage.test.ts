import { describe, expect, it } from 'vitest';
import { BuildingModelShapeSchema, type BuildingModelV2 } from '@designflow/shared';
import { auditBlueprint, PRODUCT_DEFAULTS_RULE_PACK } from '../src/index.js';
import { authored, authoredOptions, rect } from './fixtures.js';

describe('general V2 geometry and honest coverage', () => {
  it('legal shared space boundaries and ordinary T junctions produce no collisions', () => {
    const r = auditBlueprint(authored(), authoredOptions); expect(r.findings).toEqual([]);
  });
  it('redundant collinear vertices do not break independently rebuilt adjacency', () => {
    const m = authored(); m.spaces[0]!.boundary.splice(2, 0, { x: 4000, z: 3000 });
    expect(auditBlueprint(m, authoredOptions).status).toBe('PASS');
  });
  it('clockwise polygons measure the same exact areas', () => {
    const m = authored(); m.dimensions = []; const initial = auditBlueprint(m, authoredOptions);
    for (const s of m.spaces) s.boundary.reverse(); m.site!.boundary.reverse(); m.levels[0]!.boundary.reverse(); m.slabs[0]!.footprint.outer.reverse();
    expect(auditBlueprint(m, authoredOptions)).toEqual(initial);
  });
  it('reversed host paths resolve opening offsets with the correct sign', () => {
    const m = authored(), w = m.walls.find(w => w.id === 'partition')!;
    [w.path.start, w.path.end] = [w.path.end, w.path.start];
    m.dimensions.find(d => d.id === 'door-offset')!.constraint = { mode: 'controlling', overallMm: 2700, segmentsMm: [1800, 900] };
    expect(auditBlueprint(m, authoredOptions).status).toBe('PASS');
  });
  it('odd-mm wall faces retain half-mm precision at a permitted boundary', () => {
    const m = authored(); m.walls.find(w => w.id === 'west')!.thicknessMm = 201;
    const r = auditBlueprint(m, authoredOptions); expect(r.findings.map(f => f.code)).toContain('QA_OUTSIDE_BUILDABLE_BOUNDARY');
    m.walls.find(w => w.id === 'west')!.thicknessMm = 199;
    expect(auditBlueprint(m, authoredOptions).findings.map(f => f.code)).not.toContain('QA_OUTSIDE_BUILDABLE_BOUNDARY');
  });
  it('touching opening rectangles are legal, while positive-area overlap is not', () => {
    const m = authored(), first = m.openings[1]!; m.openings.push({ ...structuredClone(first), id: 'adjacent-door', offsetMm: first.offsetMm + first.widthMm });
    expect(auditBlueprint(m, authoredOptions).findings.map(f => f.code)).not.toContain('QA_OPENING_OVERLAP');
    m.openings.at(-1)!.offsetMm--;
    expect(auditBlueprint(m, authoredOptions).findings.map(f => f.code)).toContain('QA_OPENING_OVERLAP');
  });
  it('vertically separated openings may share a horizontal interval', () => {
    const m = authored(); m.openings.push({ id: 'transom', kind: 'window', wallId: 'partition', levelId: 'ground', offsetMm: 1800, widthMm: 900, heightMm: 500, sillMm: 2200, type: 'transom' });
    expect(auditBlueprint(m, authoredOptions).status).toBe('PASS');
  });
  it('diagonal walls retain exact host-fit checks while solid coverage is explicitly partial', () => {
    const m = authored(); m.spaces = []; m.walls = [{ ...m.walls[0]!, id: 'diagonal', path: { start: { x: 100, z: 100 }, end: { x: 3100, z: 4100 } }, spaceIds: undefined } as unknown as BuildingModelV2['walls'][number]];
    delete m.walls[0]!.spaceIds; m.openings = []; m.dimensions = [];
    const r = auditBlueprint(m); expect(r.measurements.walls[0]?.lengthMm).toBe(5000); expect(r.measurements.walls[0]?.lengthBasis).toBe('exact'); expect(r.coverage.find(s => s.stage === 'walls')?.outcome).toBe('PARTIAL');
    m.openings.push({ id: 'diagonal-window', kind: 'window', wallId: 'diagonal', levelId: 'ground', offsetMm: 4501, widthMm: 500, heightMm: 1000, sillMm: 900, type: 'window' });
    expect(auditBlueprint(m).findings.map(f => f.code)).toContain('QA_OPENING_OUTSIDE_HOST');
  });
  it('irrational diagonal wall length explicitly reports nearest-mm measurement', () => {
    const m = authored(); m.spaces = []; m.openings = []; m.dimensions = []; const w = m.walls[0]!;
    m.walls = [{ ...w, path: { start: { x: 100, z: 100 }, end: { x: 3100, z: 3100 } } }]; delete m.walls[0]!.spaceIds;
    expect(auditBlueprint(m).measurements.walls[0]).toMatchObject({ lengthMm: 4243, lengthBasis: 'rounded-nearest-mm' });
  });
  it('measures half-mm² polygon area without losing integer precision', () => {
    const m = authored(); m.spaces = [{ ...m.spaces[0]!, boundary: [{ x: 100, z: 100 }, { x: 103, z: 100 }, { x: 100, z: 101 }] }]; m.walls = []; m.openings = []; m.dimensions = [];
    expect(auditBlueprint(m, { entrySpaceIds: ['foyer'] }).measurements.spaces[0]?.areaMm2).toBe('1.5');
  });
  it('site absence and nonrectangular setbacks are explicitly not evaluated', () => {
    const m = authored(); m.site = null;
    expect(auditBlueprint(m, authoredOptions).findings.map(f => f.code)).toContain('QA_SITE_NOT_EVALUATED');
    const n = authored(); n.site!.boundary = [{ x: -100, z: -100 }, { x: 9000, z: -100 }, { x: 9000, z: 7000 }, { x: -100, z: 8000 }]; n.site!.setbacks = [{ id: 'setback', boundaryEdgeStart: 0, minimumMm: 50 }];
    expect(auditBlueprint(n, authoredOptions).findings.map(f => f.code)).toContain('QA_SETBACK_NOT_EVALUATED');
  });
  it('single-plate floor containment reports a definite geometric contradiction', () => {
    const m = authored(); m.slabs[0]!.footprint.outer = rect(0, 0, 2000, 6000);
    expect(auditBlueprint(m, authoredOptions).findings.map(f => f.code)).toContain('QA_SPACE_OUTSIDE_FLOOR');
  });
  it('no supplied floor is unknown support, not a passing floor check', () => {
    const m = authored(); m.slabs = [];
    const r = auditBlueprint(m, authoredOptions); expect(r.measurements.grossFloorAreaMm2).toBeNull(); expect(r.findings.map(f => f.code)).toContain('QA_SPACE_PLATE_NOT_EVALUATED');
  });
  it('wall crossing room interiors is detected even with both endpoints outside that room', () => {
    const m = authored(); const wall = { ...m.walls[0]!, id: 'through-rooms', path: { start: { x: 0, z: 3000 }, end: { x: 8000, z: 3000 } } }; delete wall.spaceIds; m.walls.push(wall);
    const r = auditBlueprint(m, authoredOptions); expect(r.findings.filter(f => f.code === 'QA_WALL_INTRUDES_SPACE')).toHaveLength(2);
  });
  it('level anchor on a horizontal axis is an explicit semantic error', () => {
    const m = authored(); m.dimensions[0]!.anchors[0] = { kind: 'level', levelId: 'ground' };
    expect(auditBlueprint(m, authoredOptions).findings.map(f => f.code)).toContain('QA_DIMENSION_AXIS');
  });
  it('policy evaluation is NOT_EVALUATED after a work limit', () => {
    const r = auditBlueprint(authored(), { ...authoredOptions, maxGeometryWork: 1, rulePacks: [PRODUCT_DEFAULTS_RULE_PACK] });
    expect(r.ruleResults).toHaveLength(2); expect(r.ruleResults.every(x => x.outcome === 'NOT_EVALUATED')).toBe(true);
  });
  it('bounds a dense adversarial duplicate-wall report and declares truncation', () => {
    const m = authored(); m.walls = Array.from({ length: 150 }, (_, i) => ({ ...structuredClone(m.walls[0]!), id: `duplicate-${i}` })); m.openings = []; m.dimensions = [];
    expect(BuildingModelShapeSchema.safeParse(m).success).toBe(true);
    const r = auditBlueprint(m); expect(r.findings.map(f => f.code)).toContain('QA_RESOURCE_LIMIT'); expect(r.findings.length).toBeLessThanOrEqual(10001); expect(r.coverage.find(s => s.stage === 'walls')?.outcome).toBe('PARTIAL');
  });
});
