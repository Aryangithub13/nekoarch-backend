import { describe, expect, it } from 'vitest';
import { ArchitecturalBuildingModelV2Schema, type BuildingModelV2 } from '@designflow/shared';
import { auditBlueprint } from '../src/index.js';
import { authored, generated, generatorOptions, rect } from './fixtures.js';

function columnPair(x = 500, base = 0, level = 'ground'): BuildingModelV2 {
  const m = authored();
  m.columns = [
    { id: 'a', levelId: 'ground', baseOffsetMm: 0, heightMm: 1000, crossSection: { outer: rect(500, 500, 500, 500), voids: [] } },
    { id: 'b', levelId: level, baseOffsetMm: base, heightMm: 1000, crossSection: { outer: rect(x, 500, 500, 500), voids: [] } },
  ];
  return m;
}
const codes = (m: BuildingModelV2) => auditBlueprint(m).findings.map(f => f.code);

describe('repair: physical solid intersections', () => {
  it.each([500, 750])('rejects column penetration at x=%s in both authorities', x => {
    const m = columnPair(x);
    expect(ArchitecturalBuildingModelV2Schema.safeParse(m).success).toBe(false);
    expect(codes(m)).toContain('QA_COLUMN_OVERLAP');
  });
  it.each([[1000, 0], [1100, 0], [500, 1000], [500, 1500]])('allows column contact/separation x=%s base=%s', (x, base) => {
    const m = columnPair(x, base);
    expect(ArchitecturalBuildingModelV2Schema.safeParse(m).success).toBe(true);
    expect(codes(m)).not.toContain('QA_COLUMN_OVERLAP');
  });
  it('uses absolute elevations across floor IDs', () => {
    const m = columnPair(500, -2500, 'upper');
    m.levels.push({ ...m.levels[0]!, id: 'upper', index: 1, elevationMm: 3000 });
    expect(ArchitecturalBuildingModelV2Schema.safeParse(m).success).toBe(false);
    expect(codes(m)).toContain('QA_COLUMN_OVERLAP');
    m.columns[1]!.baseOffsetMm = 0;
    expect(ArchitecturalBuildingModelV2Schema.safeParse(m).success).toBe(true);
    expect(codes(m)).not.toContain('QA_COLUMN_OVERLAP');
  });
  it('allows an independent column entirely within a hollow column', () => {
    const m = columnPair();
    m.columns[0]!.crossSection = { outer: rect(300, 300, 1000, 1000), voids: [rect(400, 400, 800, 800)] };
    expect(ArchitecturalBuildingModelV2Schema.safeParse(m).success).toBe(true);
    expect(codes(m)).not.toContain('QA_COLUMN_OVERLAP');
  });
  it.each(['flat-roof', 'ceiling', 'floor'] as const)('checks %s against another plate in 3D', kind => {
    const m = authored();
    m.slabs.push({ ...structuredClone(m.slabs[0]!), id: 'b', kind, topOffsetMm: 50 });
    expect(ArchitecturalBuildingModelV2Schema.safeParse(m).success).toBe(false);
    expect(codes(m)).toContain('QA_SLAB_OVERLAP');
    m.slabs[1]!.topOffsetMm = 150;
    expect(ArchitecturalBuildingModelV2Schema.safeParse(m).success).toBe(true);
    expect(codes(m)).not.toContain('QA_SLAB_OVERLAP');
    m.slabs[1]!.topOffsetMm = 200;
    expect(ArchitecturalBuildingModelV2Schema.safeParse(m).success).toBe(true);
    expect(codes(m)).not.toContain('QA_SLAB_OVERLAP');
  });
  it('allows a plate contained in another plate void', () => {
    const m = authored(); m.spaces = []; m.walls = []; m.openings = []; m.dimensions = [];
    m.slabs[0]!.footprint.voids = [rect(1000, 1000, 2000, 2000)];
    m.slabs.push({ ...structuredClone(m.slabs[0]!), id: 'infill', footprint: { outer: rect(1000, 1000, 2000, 2000), voids: [] } });
    expect(ArchitecturalBuildingModelV2Schema.safeParse(m).success).toBe(true);
    expect(codes(m)).not.toContain('QA_SLAB_OVERLAP');
  });
});

describe('repair: floor support includes holes', () => {
  it.each([4500, 3900])('rejects a void under/across occupied space x=%s', x => {
    const m = authored(); m.slabs[0]!.footprint.voids = [rect(x, 1000, 1000, 1000)];
    expect(codes(m)).toContain('QA_SPACE_FLOOR_VOID');
  });
  it('allows a void outside or exactly touching space edges', () => {
    const m = authored(); m.slabs[0]!.footprint.voids = [rect(10, 1000, 90, 1000)];
    expect(codes(m)).not.toContain('QA_SPACE_FLOOR_VOID');
    m.slabs[0]!.footprint.voids = [rect(10, 1000, 89, 1000)];
    expect(codes(m)).not.toContain('QA_SPACE_FLOOR_VOID');
  });
  it('allows the explicitly represented stair flight void and circulation', () => {
    expect(auditBlueprint(generated(2), generatorOptions).status).toBe('PASS');
  });
  it('rejects additional unsupported holes even in a stairwell', () => {
    const m = generated(2), space = m.spaces.find(s => s.classification === 'stairwell' && s.levelId === 'level-1')!;
    const landing = m.stairs[0]!.landings.find(l => l.elevationOffsetMm > 0)!;
    const x = Math.min(...landing.footprint.map(p => p.x)) + 50, z = Math.min(...landing.footprint.map(p => p.z)) + 50;
    m.slabs.find(s => s.kind === 'floor' && s.levelId === space.levelId)!.footprint.voids.push(rect(x, z, 50, 50));
    expect(codes(m)).toContain('QA_SPACE_FLOOR_VOID');
  });
});
