import { z } from 'zod';
import { PlanSchema, type Rect } from '../types.js';
import { EntityIdSchema } from './common.js';
import { BuildingModelV2Schema, type BuildingModelV2 } from './building-model.js';
import { CoordinateMmSchema, decimalRatio, roundRatio } from './units.js';
import type { RingMm } from './geometry.js';

export interface UpgradeDiagnostic {
  code: 'MILLIMETRE_QUANTIZATION' | 'CONSTRUCTION_UNKNOWN' | 'WINDOW_SEMANTICS_UNKNOWN' | 'FURNITURE_NOT_MAPPED' | 'SEED_NOT_COPIED';
  count: number;
}
/** Deterministic planar import. The caller supplies a durable namespace for unsaved V1 plans. */
export function upgradePlanV1(raw: unknown, buildingId: string): { model: BuildingModelV2; diagnostics: UpgradeDiagnostic[] } {
  const plan = PlanSchema.parse(raw);
  EntityIdSchema.parse(buildingId);
  let quantized = 0;
  function mm(...metres: number[]): number {
    const [n, d] = metres.map(decimalRatio).reduce(([a, ad], [b, bd]) => [a * bd + b * ad, ad * bd] as const, [0n, 1n] as readonly [bigint, bigint]);
    if ((n * 1000n) % d !== 0n) quantized++;
    return CoordinateMmSchema.parse(Number(roundRatio(n * 1000n, d)));
  }
  function rectangle(rect: Rect): RingMm {
    const x = mm(rect.x); const z = mm(rect.z);
    const right = mm(rect.x, rect.w); const far = mm(rect.z, rect.d);
    return [{ x, z }, { x: right, z }, { x: right, z: far }, { x, z: far }];
  }
  const levelId = 'legacy:level';
  const model = BuildingModelV2Schema.parse({
    schemaVersion: 2, id: buildingId, name: 'Imported legacy plan', completeness: 'legacy-planar', units: 'mm', coordinateSystem: 'x-right-y-up-z-depth',
    site: null,
    levels: [{ id: levelId, name: 'Legacy plan datum', index: 0, kind: 'datum', elevationMm: 0, floorToFloorHeightMm: null, boundary: rectangle(plan.bounds) }],
    spaces: plan.rooms.map(room => ({ id: `legacy:room:${room.id}`, name: room.name, classification: room.type, levelId, boundary: rectangle(room.rect), boundaryBasis: 'unspecified' })),
    walls: plan.walls.map(wall => {
      const start = { x: mm(wall.x0), z: mm(wall.z0) }; const end = { x: mm(wall.x1), z: mm(wall.z1) };
      // Geometry-keyed, direction-sensitive identity: no array-position IDs.
      return { id: `legacy:wall:${start.x}:${start.z}:${end.x}:${end.z}`, levelId, path: { start, end }, pathReference: 'unspecified', thicknessMm: null, heightMm: null, baseOffsetMm: null, classification: 'unspecified' };
    }),
    openings: [], stairs: [], slabs: [], columns: [], dimensions: [], specifications: [],
    provenance: { creationMode: 'legacy-adapter', adapterVersion: 'v1-to-v2/1', measurementVersion: 'mm-exact/1', sourceVariant: plan.variant,
      ...(plan.id ? { sourcePlanId: plan.id } : {}), ...(plan.seed.length <= 500 ? { seed: plan.seed } : {}) },
  });
  const diagnostics: UpgradeDiagnostic[] = [{ code: 'CONSTRUCTION_UNKNOWN', count: 1 }];
  if (quantized) diagnostics.push({ code: 'MILLIMETRE_QUANTIZATION', count: quantized });
  const windows = plan.walls.filter(wall => wall.window !== undefined).length;
  if (windows) diagnostics.push({ code: 'WINDOW_SEMANTICS_UNKNOWN', count: windows });
  if (plan.furn.length) diagnostics.push({ code: 'FURNITURE_NOT_MAPPED', count: plan.furn.length });
  if (plan.seed.length > 500) diagnostics.push({ code: 'SEED_NOT_COPIED', count: 1 });
  return { model, diagnostics };
}

/** Never silently interpret unversioned legacy JSON as V2, or accept future versions. */
export function parseArchitecturalDocument(raw: unknown) {
  if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw) {
    return { kind: 'building-model' as const, model: BuildingModelV2Schema.parse(raw) };
  }
  return { kind: 'legacy-plan' as const, plan: PlanSchema.parse(raw) };
}
export function serializeBuildingModel(model: unknown): string {
  return JSON.stringify(BuildingModelV2Schema.parse(model));
}
export function deserializeBuildingModel(json: string): BuildingModelV2 {
  return BuildingModelV2Schema.parse(JSON.parse(z.string().parse(json)));
}
