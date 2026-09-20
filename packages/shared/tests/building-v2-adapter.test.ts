import { describe, expect, it } from 'vitest';
import {
  ArchitecturalBuildingModelV2Schema, BuildingModelV2Schema, CreatePlanRequestSchema, PlanSchema,
  deserializeBuildingModel, parseArchitecturalDocument, serializeBuildingModel, upgradePlanV1, wallMeasurements, grossFloorAreaMm2,
} from '../src/index.js';
import { fixturePlan } from '../../../test-support/fixtures.js';

describe('explicit V1 compatibility boundary', () => {
  it('keeps original V1 contracts and unversioned JSON distinct', () => {
    const plan = fixturePlan();
    expect(parseArchitecturalDocument(plan)).toEqual({ kind: 'legacy-plan', plan });
    expect(CreatePlanRequestSchema.parse({ plan }).plan).toEqual(plan);
    const { model } = upgradePlanV1(plan, 'building');
    expect(parseArchitecturalDocument(model)).toEqual({ kind: 'building-model', model });
    expect(PlanSchema.safeParse(model).success).toBe(false);
    expect(CreatePlanRequestSchema.safeParse({ plan: model }).success).toBe(false);
  });
  it.each([0, 1, 3, '2', null])('never reinterprets explicit unknown version %s as V1', version => {
    expect(() => parseArchitecturalDocument({ ...fixturePlan(), schemaVersion: version })).toThrow();
  });
  it('converts known planar geometry, names and source metadata without fabrication', () => {
    const plan = { ...fixturePlan(), id: 'b7e8dfe9-080c-4c47-83dd-e0c23de7a283' };
    const { model, diagnostics } = upgradePlanV1(plan, 'building');
    expect(model.spaces[0]).toMatchObject({ id: 'legacy:room:1', name: 'Living room', classification: 'living', boundary: [{ x: 0, z: 0 }, { x: 6000, z: 0 }, { x: 6000, z: 5000 }, { x: 0, z: 5000 }], boundaryBasis: 'unspecified' });
    expect(model.walls[0]).toMatchObject({ pathReference: 'unspecified', thicknessMm: null, heightMm: null, baseOffsetMm: null });
    expect(model.site).toBeNull();
    expect(model.openings).toEqual([]); expect(model.slabs).toEqual([]); expect(model.stairs).toEqual([]); expect(model.specifications).toEqual([]);
    expect(model.levels[0]).toMatchObject({ kind: 'datum', elevationMm: 0, floorToFloorHeightMm: null });
    expect(model.provenance).toMatchObject({ sourcePlanId: plan.id, seed: plan.seed, sourceVariant: 1 });
    expect(JSON.stringify(model)).not.toContain(plan.prompt);
    expect(diagnostics).toEqual([{ code: 'CONSTRUCTION_UNKNOWN', count: 1 }, { code: 'FURNITURE_NOT_MAPPED', count: 1 }]);
    expect(ArchitecturalBuildingModelV2Schema.safeParse(model).success).toBe(false);
    expect(wallMeasurements(model, model.walls[0]!.id)).toEqual({ lengthMm: 6000, grossFaceAreaMm2: null, netFaceAreaMm2: null, netPrismVolumeMm3: null });
    expect(() => grossFloorAreaMm2(model)).toThrow('unknown');
  });
  it('does not invent windows from undefined V1 interval semantics', () => {
    const plan = fixturePlan(); plan.walls[0]!.window = { w0: 0.2, w1: 0.8 };
    const { model, diagnostics } = upgradePlanV1(plan, 'building');
    expect(model.openings).toEqual([]);
    expect(diagnostics).toContainEqual({ code: 'WINDOW_SEMANTICS_UNKNOWN', count: 1 });
  });
  it('reports boundary quantization and preserves shared endpoints', () => {
    const plan = fixturePlan();
    plan.rooms = [
      { id: 1, name: 'A', type: 'living', rect: { x: 0, z: 0, w: 3.333333, d: 5 } },
      { id: 2, name: 'B', type: 'bedroom', rect: { x: 3.333333, z: 0, w: 2.666667, d: 5 } },
    ];
    const { model, diagnostics } = upgradePlanV1(plan, 'building');
    expect(model.spaces[0]!.boundary[1]!.x).toBe(3333);
    expect(model.spaces[1]!.boundary[0]!.x).toBe(3333);
    expect(model.spaces[1]!.boundary[1]!.x).toBe(6000);
    expect(diagnostics.some(d => d.code === 'MILLIMETRE_QUANTIZATION')).toBe(true);
  });
  it('adds decimal endpoints exactly before rounding negative half-mm coordinates', () => {
    const plan = fixturePlan(); plan.bounds = { x: -0.0004, z: 0, w: 0.0009, d: 5 };
    plan.rooms[0]!.rect = plan.bounds; plan.walls = [];
    const { model } = upgradePlanV1(plan, 'building');
    expect(model.spaces[0]!.boundary[1]!.x).toBe(1);
  });
  it('rejects precision collapse instead of repairing or inventing geometry', () => {
    const plan = fixturePlan(); plan.walls = [{ x0: 1, x1: 1.0001, z0: 1, z1: 1 }];
    expect(() => upgradePlanV1(plan, 'building')).toThrow();
  });
  it('rejects invalid V1 geometry and duplicate IDs', () => {
    const plan = fixturePlan(); plan.rooms.push({ ...plan.rooms[0]! });
    expect(() => upgradePlanV1(plan, 'building')).toThrow();
  });
  it('returns isolated deterministic data and never mutates V1', () => {
    const plan = fixturePlan(); const before = structuredClone(plan);
    const first = upgradePlanV1(plan, 'building');
    const second = upgradePlanV1(plan, 'building');
    expect(first).toEqual(second);
    expect(deserializeBuildingModel(serializeBuildingModel(first.model))).toEqual(first.model);
    first.model.spaces[0]!.name = 'changed';
    expect(second.model.spaces[0]!.name).toBe('Living room');
    expect(plan).toEqual(before);
  });
  it('does not assign persistent wall IDs from array positions', () => {
    const plan = fixturePlan(); plan.walls.push({ x0: 0, z0: 5, x1: 6, z1: 5 });
    const first = upgradePlanV1(plan, 'building').model.walls;
    plan.walls.reverse();
    const second = upgradePlanV1(plan, 'building').model.walls;
    expect(second.map(w => w.id).sort()).toEqual(first.map(w => w.id).sort());
  });
  it('reports omitted oversized seed metadata instead of copying prompts', () => {
    const plan = fixturePlan(); plan.seed = 's'.repeat(501);
    const result = upgradePlanV1(plan, 'building');
    expect(result.model.provenance.seed).toBeUndefined();
    expect(result.diagnostics).toContainEqual({ code: 'SEED_NOT_COPIED', count: 1 });
  });
  it('requires an explicit adapter origin for planar documents', () => {
    const { model } = upgradePlanV1(fixturePlan(), 'building');
    model.provenance.creationMode = 'authored';
    expect(BuildingModelV2Schema.safeParse(model).success).toBe(false);
  });
});
