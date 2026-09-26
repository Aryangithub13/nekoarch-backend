import { describe, expect, it } from 'vitest';
import { calculateQuantityTakeoff, QuantityTakeoffReportSchema, QuantitySchema, TakeoffError, type ItemCode, type QuantityTakeoffReport } from '../src/index.js';
import { quantity, doubled } from '../src/precision.js';
import { ArchitecturalBuildingModelV2Schema, polygonAreaMm2, wallMeasurements, grossFloorAreaMm2 } from '@designflow/shared';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { generateBlueprint } from '@designflow/generator';
import { singleRoom, diagonal, residence, rect, requirements } from './fixtures.js';
import { freeze } from '../../blueprint-qa/tests/fixtures.js';
const item = (r: QuantityTakeoffReport, code: ItemCode, id: string) => r.items.find(i => i.itemCode === code && i.sourceEntityIds[0] === id)!;
const total = (r: QuantityTakeoffReport, code: ItemCode) => r.summary.totals.find(i => i.itemCode === code)!.quantity.value;
function reconcile(r: QuantityTakeoffReport) {
  for (const t of r.summary.totals) {
    const members = r.items.filter(i => i.itemCode === t.itemCode);
    expect(members.reduce((n, i) => n + doubled(i.quantity.value), 0n)).toBe(doubled(t.quantity.value));
    expect(t.itemCount).toBe(members.length);
    for (const dimension of ['level', 'specification', 'classification'] as const) {
      const groups = r.sections.filter(s => s.dimension === dimension).flatMap(s => s.totals).filter(i => i.itemCode === t.itemCode);
      expect(groups.reduce((n, i) => n + doubled(i.quantity.value), 0n)).toBe(doubled(t.quantity.value));
    }
  }
}
describe('deterministic geometric takeoff', () => {
  it('proves manually checkable wall, opening, single face, space and slab arithmetic', () => {
    const r = calculateQuantityTakeoff(singleRoom());
    const expected = { WALL_CENTERLINE_LENGTH: '4000', WALL_SEGMENT_GROSS_VOLUME: '2400000000', WALL_OPENING_VOLUME: '378000000',
      WALL_SEGMENT_NET_VOLUME: '2022000000', WALL_SINGLE_FACE_GROSS_AREA: '12000000', WALL_SINGLE_FACE_OPENING_AREA: '1890000', WALL_SINGLE_FACE_NET_AREA: '10110000' };
    for (const [code, value] of Object.entries(expected)) expect(item(r, code as ItemCode, 'wall-0').quantity.value).toBe(value);
    expect(total(r, 'WALL_CENTERLINE_LENGTH')).toBe('14000');
    expect(total(r, 'WALL_SEGMENT_GROSS_VOLUME')).toBe('8400000000');
    expect(total(r, 'WALL_SEGMENT_NET_VOLUME')).toBe('8022000000');
    expect(total(r, 'SPACE_FLOOR_AREA')).toBe('12000000');
    expect(total(r, 'FLOOR_FINISH_BASE_AREA')).toBe('12000000');
    expect(total(r, 'SPACE_PERIMETER')).toBe('14000');
    expect(total(r, 'FLOOR_PLATE_VOLUME')).toBe('1800000000');
    expect(total(r, 'DOOR_COUNT')).toBe('1'); expect(total(r, 'DOOR_AREA')).toBe('1890000'); reconcile(r);
  });
  it('deducts distinct doors/windows/passages exactly once and preserves schedules', () => {
    const m = singleRoom();
    m.openings.push({ id: 'window', kind: 'window', wallId: 'wall-0', levelId: 'ground', offsetMm: 2000, widthMm: 1200, heightMm: 1200, sillMm: 900, type: 'casement' },
      { id: 'passage', kind: 'opening', wallId: 'wall-2', levelId: 'ground', offsetMm: 200, widthMm: 1000, heightMm: 2200, sillMm: 0, type: 'passage', purpose: 'passage' });
    const r = calculateQuantityTakeoff(m);
    expect(total(r, 'WALL_SINGLE_FACE_OPENING_AREA')).toBe('5530000'); expect(total(r, 'WALL_OPENING_VOLUME')).toBe('1106000000');
    expect(['DOOR_COUNT', 'WINDOW_COUNT', 'OPENING_COUNT'].map(c => total(r, c as ItemCode))).toEqual(['1', '1', '1']);
    expect(r.schedules.entries).toHaveLength(3); expect(r.schedules.groups).toHaveLength(3);
    const withoutReferences = structuredClone(m); withoutReferences.walls.forEach(w => { delete w.spaceIds; });
    expect(calculateQuantityTakeoff(withoutReferences)).toEqual(r);
    m.openings.push(m.openings[0]!); expect(() => calculateQuantityTakeoff(m)).toThrow(TakeoffError);
  });
  it('keeps voids, floor/ceiling/roof physical plates and architectural columns distinct', () => {
    const m = singleRoom(); m.slabs[0]!.footprint.voids = [rect(1000, 1000, 500, 500)];
    m.slabs.push({ ...m.slabs[0]!, id: 'roof', kind: 'flat-roof', topOffsetMm: 3200, thicknessMm: 200 },
      { ...m.slabs[0]!, id: 'ceiling', kind: 'ceiling', topOffsetMm: 2950, thicknessMm: 20 });
    m.columns = [{ id: 'column', levelId: 'ground', crossSection: { outer: rect(200, 200, 300, 400), voids: [] }, heightMm: 3000, baseOffsetMm: 0 }];
    const r = calculateQuantityTakeoff(m);
    expect(total(r, 'FLOOR_PLATE_GROSS_AREA')).toBe('12000000'); expect(total(r, 'FLOOR_PLATE_VOID_AREA')).toBe('250000');
    expect(total(r, 'FLOOR_PLATE_NET_AREA')).toBe('11750000'); expect(total(r, 'FLOOR_PLATE_VOLUME')).toBe('1762500000');
    expect(total(r, 'ROOF_VOLUME')).toBe('2350000000'); expect(total(r, 'CEILING_PLATE_VOLUME')).toBe('235000000');
    expect(total(r, 'COLUMN_CROSS_SECTION_AREA')).toBe('120000'); expect(total(r, 'COLUMN_HEIGHT')).toBe('3000'); expect(total(r, 'COLUMN_GEOMETRIC_VOLUME')).toBe('360000000');
    expect(total(r, 'COLUMN_COUNT')).toBe('1'); reconcile(r);
  });
  it('groups mixed specifications and wall thicknesses without inventing materials', () => {
    const m = singleRoom(); m.specifications = [{ id: 'spec-a', name: 'A' }, { id: 'spec-b', name: 'B' }];
    m.walls[0]!.specificationId = 'spec-a'; m.walls[1]!.specificationId = 'spec-b'; m.walls[1]!.thicknessMm = 101;
    const r = calculateQuantityTakeoff(m);
    expect(r.sections.find(s => s.dimension === 'specification' && s.key === 'spec-a')!.totals.find(t => t.itemCode === 'WALL_SEGMENT_NET_VOLUME')!.quantity.value).toBe('2022000000');
    expect(r.sections.find(s => s.dimension === 'thickness' && s.key === '101')!.totals.find(t => t.itemCode === 'WALL_SEGMENT_GROSS_VOLUME')!.quantity.value).toBe('909000000');
    expect(item(r, 'WALL_SEGMENT_NET_VOLUME', 'wall-2').specificationId).toBeNull(); reconcile(r);
  });
  it('retains exact half-mm²/mm³ and reports rounded diagonal lengths as PARTIAL', () => {
    const r = calculateQuantityTakeoff(diagonal());
    expect(total(r, 'FLOOR_PLATE_NET_AREA')).toBe('501000.5'); expect(total(r, 'FLOOR_PLATE_VOLUME')).toBe('75150075');
    expect(item(r, 'WALL_CENTERLINE_LENGTH', 'wall-0')).toMatchObject({ status: 'PARTIAL', quantity: { value: '1415' } });
    expect(r.coverage.find(c => c.category === 'wall_union_solid')!.status).toBe('PARTIAL');
    expect(r.coverage.find(c => c.category === 'pitched_roofs')!.status).toBe('NOT_EVALUATED');
    const m = diagonal(); m.slabs[0]!.thicknessMm = 151;
    expect(total(calculateQuantityTakeoff(m), 'FLOOR_PLATE_VOLUME')).toBe('75651075.5');
    expect(quantity(1n, 'mm2', 9).display.value).toBe('0.000000500');
    expect(quantity(1001n, 'mm', 3).display.value).toBe('0.501');
    expect(quantity(2000000000000000001n, 'mm3', 9).value).toBe('1000000000000000000.5');
    expect(() => QuantitySchema.parse({ ...quantity(2n, 'each', 6), dimension: 'AREA' })).toThrow();
  });
  it('responds to each independent source mutation by its exact geometric delta', () => {
    const base = singleRoom(), r = calculateQuantityTakeoff(base);
    const check = (change: (m: ReturnType<typeof singleRoom>) => void, code: ItemCode, delta: bigint) => {
      const m = structuredClone(base); change(m); ArchitecturalBuildingModelV2Schema.parse(m);
      expect(doubled(total(calculateQuantityTakeoff(m), code)) - doubled(total(r, code))).toBe(delta * 2n);
    };
    check(m => { m.walls[0]!.heightMm! += 1; }, 'WALL_SEGMENT_NET_VOLUME', 800000n);
    check(m => { m.openings[0]!.widthMm += 1; }, 'WALL_SEGMENT_NET_VOLUME', -420000n);
    check(m => { m.openings = []; }, 'WALL_SEGMENT_NET_VOLUME', 378000000n);
    check(m => { m.openings.push({ id: 'added-window', kind: 'window', wallId: 'wall-1', levelId: 'ground', offsetMm: 100, widthMm: 1000, heightMm: 1000, sillMm: 1000, type: 'fixed' }); }, 'WALL_SEGMENT_NET_VOLUME', -200000000n);
    check(m => { m.slabs[0]!.thicknessMm += 1; }, 'FLOOR_PLATE_VOLUME', 12000000n);
    check(m => { m.slabs[0]!.footprint.voids.push(rect(1000, 1000, 500, 500)); }, 'FLOOR_PLATE_NET_AREA', -250000n);
    check(m => { m.spaces[0]!.boundary = rect(101, 101, 3998, 2998); m.walls.forEach(w => { delete w.spaceIds; }); }, 'SPACE_FLOOR_AREA', -13996n);
  });
  it('rejects malformed, incomplete, overlapping, unsupported and resource-exhausting inputs', () => {
    expect(() => calculateQuantityTakeoff({ ...singleRoom(), completeness: 'legacy-planar' })).toThrow(expect.objectContaining({ code: 'INCOMPLETE_MODEL' }));
    for (const bad of [null, {}, { ...singleRoom(), schemaVersion: 3 }, { ...singleRoom(), walls: Array(5001).fill({}) }]) expect(() => calculateQuantityTakeoff(bad)).toThrow(TakeoffError);
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic; expect(() => calculateQuantityTakeoff(cyclic)).toThrow(TakeoffError);
    expect(() => calculateQuantityTakeoff(singleRoom(), { displayDecimalPlaces: 10 })).toThrow(TakeoffError);
    const bad = singleRoom(); bad.openings[0]!.widthMm = 5000; expect(() => calculateQuantityTakeoff(bad)).toThrow(TakeoffError);
    bad.openings[0]!.widthMm = 900; bad.slabs[0]!.kind = 'pitched' as 'floor'; expect(() => calculateQuantityTakeoff(bad)).toThrow(TakeoffError);
    expect(() => calculateQuantityTakeoff({ padding: 'x'.repeat(2_100_000) })).toThrow(expect.objectContaining({ code: 'RESOURCE_LIMIT_EXCEEDED' }));
  });
  it('has deterministic frozen-input, concurrent and JSON-roundtrip results independent of entity order', async () => {
    const m = freeze(residence(2)); const before = JSON.stringify(m); const r = calculateQuantityTakeoff(m);
    expect(await Promise.all(Array.from({ length: 4 }, async () => calculateQuantityTakeoff(m)))).toEqual([r,r,r,r]);
    expect(JSON.stringify(m)).toBe(before); expect(QuantityTakeoffReportSchema.parse(JSON.parse(JSON.stringify(r)))).toEqual(r);
    const reversed = structuredClone(m); for (const key of ['walls','openings','spaces','slabs','columns','stairs','levels'] as const) reversed[key].reverse();
    expect(calculateQuantityTakeoff(reversed)).toEqual(r);
  });
  it('reconciles a fixed-seed generated corpus and independently checks Phase 9/11 geometry', () => {
    for (let seed = 0; seed < 16; seed++) {
      const m = residence(seed % 2 ? 2 : 1, seed % 3 ? 2 : 1, `takeoff-corpus-${seed}`); const r = calculateQuantityTakeoff(m);
      expect(calculateQuantityTakeoff(m)).toEqual(r); reconcile(r);
      expect(QuantityTakeoffReportSchema.parse(JSON.parse(JSON.stringify(r)))).toEqual(r);
      expect(r.items.every(i => doubled(i.quantity.value) >= 0n)).toBe(true);
      expect(total(r, 'DOOR_COUNT')).toBe(String(m.openings.filter(o => o.kind === 'door').length));
      expect(total(r, 'WINDOW_COUNT')).toBe(String(m.openings.filter(o => o.kind === 'window').length));
      expect(total(r, 'GEOMETRIC_GROSS_FLOOR_AREA')).toBe(grossFloorAreaMm2(m));
      const qa = auditBlueprint(m);
      for (const space of m.spaces) expect(item(r, 'SPACE_FLOOR_AREA', space.id).quantity.value).toBe(polygonAreaMm2(space.boundary));
      for (const wall of m.walls) {
        const measured = wallMeasurements(m, wall.id);
        expect(item(r, 'WALL_CENTERLINE_LENGTH', wall.id).quantity.value).toBe(String(measured.lengthMm));
        expect(item(r, 'WALL_SEGMENT_NET_VOLUME', wall.id).quantity.value).toBe(measured.netPrismVolumeMm3);
        expect(doubled(item(r, 'WALL_OPENING_VOLUME', wall.id).quantity.value)).toBeLessThanOrEqual(doubled(item(r, 'WALL_SEGMENT_GROSS_VOLUME', wall.id).quantity.value));
      }
      for (const space of qa.measurements.spaces) expect(item(r, 'SPACE_FLOOR_AREA', space.entityId).quantity.value).toBe(space.areaMm2);
      for (const plate of qa.measurements.slabs) expect(r.items.find(i => i.sourceEntityIds[0] === plate.entityId && i.itemCode.endsWith('_NET_AREA'))!.quantity.value).toBe(plate.netAreaMm2);
    }
  }, 60000);
  it.each([
    [1, 1, '75300', '33772500000', '2286000000', '31486500000', '5', '4'],
    [1, 2, '79550', '34983750000', '2763000000', '32220750000', '6', '5'],
    [2, 2, '155650', '68984250000', '3141000000', '65843250000', '8', '5'],
  ] as const)('locks explicit golden quantities for %i floors and %i bedrooms', (floors, bedrooms, length, gross, openings, net, doors, windows) => {
    const r = calculateQuantityTakeoff(residence(floors, bedrooms));
    expect(['WALL_CENTERLINE_LENGTH','WALL_SEGMENT_GROSS_VOLUME','WALL_OPENING_VOLUME','WALL_SEGMENT_NET_VOLUME','DOOR_COUNT','WINDOW_COUNT'].map(c => total(r,c as ItemCode))).toEqual([length,gross,openings,net,doors,windows]);
    if (floors === 2) {
      expect(total(r, 'FLOOR_PLATE_NET_AREA')).toBe('235800000'); expect(total(r, 'FLOOR_PLATE_VOLUME')).toBe('35370000000');
      expect(total(r, 'FLOOR_PLATE_VOID_AREA')).toBe('4200000'); expect(total(r, 'ROOF_NET_AREA')).toBe('120000000');
      expect(total(r, 'STAIR_FLIGHT_COUNT')).toBe('1'); expect(total(r, 'STAIR_RISER_COUNT')).toBe('16');
      expect(total(r, 'STAIR_TREAD_COUNT')).toBe('15'); expect(total(r, 'STAIR_RISE')).toBe('3000');
      expect(total(r, 'STAIR_RUN')).toBe('4200'); expect(total(r, 'STAIR_WIDTH')).toBe('1000');
      expect(total(r, 'STAIR_FOOTPRINT_AREA')).toBe('4200000'); expect(total(r, 'STAIR_LANDING_AREA')).toBe('2400000');
    }
  });
  it('handles the supported 24-room two-storey generator limit without a timing assertion', () => {
    const req = requirements(2, 'maximum-takeoff'); req.site.boundary = rect(0,0,60000,60000); req.rooms = [{ type: 'bedroom', count: 24 }];
    const m = generateBlueprint(req).model, r = calculateQuantityTakeoff(m); reconcile(r);
    expect(m.spaces.filter(s => s.classification === 'bedroom')).toHaveLength(24);
    expect(r.items.length).toBeLessThan(40000);
  });
});
