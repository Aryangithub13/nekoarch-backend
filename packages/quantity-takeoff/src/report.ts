import { z } from 'zod';

export const TAKEOFF_ENGINE_VERSION = 'quantity-takeoff-v1';
export const MEASUREMENT_POLICY_VERSION = 'segment-prism-mm/1';
export const LIMITS = { inputBytes: 2_097_152, entities: 5000, vertices: 100000, pairs: 2_000_000,
  items: 40000, warnings: 6000, sections: 2000, reportBytes: 8_388_608 } as const;
export const TakeoffOptionsSchema = z.object({ displayDecimalPlaces: z.number().int().min(0).max(9).default(6) }).strict();
export type TakeoffOptions = z.input<typeof TakeoffOptionsSchema>;
const id = z.string().min(1).max(200);
const decimal = z.string().max(80).regex(/^(0|[1-9][0-9]*)(?:\.5)?$/);
const display = z.string().max(100).regex(/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/);
const status = z.enum(['EVALUATED', 'PARTIAL', 'NOT_EVALUATED']);
export const quantityUnits = { mm: 'LENGTH', mm2: 'AREA', mm3: 'VOLUME', each: 'COUNT' } as const;
export type Unit = keyof typeof quantityUnits;
export const QuantitySchema = z.object({ value: decimal, unit: z.enum(['mm','mm2','mm3','each']),
  dimension: z.enum(['LENGTH','AREA','VOLUME','COUNT']), display: z.object({ value: display, unit: z.enum(['m','m2','m3','each']) }).strict(),
}).strict().superRefine((q, ctx) => {
  const expected = q.unit === 'each' ? 'each' : q.unit.replace('mm','m');
  if (q.dimension !== quantityUnits[q.unit] || q.display.unit !== expected || (q.unit === 'each' && q.value.includes('.'))) {
    ctx.addIssue({ code: 'custom', message: 'Quantity dimension/unit mismatch' });
  }
});
export const ITEM_UNITS = {
  WALL_CENTERLINE_LENGTH: 'mm', WALL_SEGMENT_GROSS_VOLUME: 'mm3', WALL_OPENING_VOLUME: 'mm3', WALL_SEGMENT_NET_VOLUME: 'mm3',
  WALL_SINGLE_FACE_GROSS_AREA: 'mm2', WALL_SINGLE_FACE_OPENING_AREA: 'mm2', WALL_SINGLE_FACE_NET_AREA: 'mm2',
  SPACE_FLOOR_AREA: 'mm2', FLOOR_FINISH_BASE_AREA: 'mm2', SPACE_PERIMETER: 'mm',
  FLOOR_PLATE_GROSS_AREA: 'mm2', FLOOR_PLATE_VOID_AREA: 'mm2', FLOOR_PLATE_NET_AREA: 'mm2', FLOOR_PLATE_VOLUME: 'mm3',
  ROOF_GROSS_AREA: 'mm2', ROOF_VOID_AREA: 'mm2', ROOF_NET_AREA: 'mm2', ROOF_VOLUME: 'mm3',
  CEILING_PLATE_GROSS_AREA: 'mm2', CEILING_PLATE_VOID_AREA: 'mm2', CEILING_PLATE_NET_AREA: 'mm2', CEILING_PLATE_VOLUME: 'mm3',
  DOOR_COUNT: 'each', DOOR_AREA: 'mm2', WINDOW_COUNT: 'each', WINDOW_AREA: 'mm2', OPENING_COUNT: 'each', OPENING_AREA: 'mm2',
  STAIR_FLIGHT_COUNT: 'each', STAIR_RISER_COUNT: 'each', STAIR_TREAD_COUNT: 'each', STAIR_RISE: 'mm', STAIR_RUN: 'mm', STAIR_WIDTH: 'mm', STAIR_FOOTPRINT_AREA: 'mm2', STAIR_LANDING_AREA: 'mm2',
  COLUMN_COUNT: 'each', COLUMN_CROSS_SECTION_AREA: 'mm2', COLUMN_HEIGHT: 'mm', COLUMN_GEOMETRIC_VOLUME: 'mm3',
  SITE_AREA: 'mm2', BUILDABLE_AREA: 'mm2', LEVEL_ENVELOPE_AREA: 'mm2', GEOMETRIC_GROSS_FLOOR_AREA: 'mm2',
} as const satisfies Record<string, Unit>;
export type ItemCode = keyof typeof ITEM_UNITS;
const code = z.enum(Object.keys(ITEM_UNITS) as [ItemCode, ...ItemCode[]]);
const evidenceValue = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()]);
export const QuantityItemSchema = z.object({
  id: z.string().max(300), itemCode: code, category: z.enum(['WALL','SPACE','PLATE','OPENING','STAIR','COLUMN','SITE','LEVEL']),
  quantity: QuantitySchema, sourceEntityIds: z.array(id).min(1).max(2), levelId: id.nullable(), specificationId: id.nullable(),
  classification: z.string().max(200).nullable(), thicknessMm: z.number().int().positive().nullable(),
  evidence: z.record(evidenceValue).refine(v => Object.keys(v).length <= 24),
  assumptions: z.array(z.string().max(100)).max(10), status,
}).strict().superRefine((item, ctx) => {
  if (ITEM_UNITS[item.itemCode] !== item.quantity.unit) ctx.addIssue({ code: 'custom', message: 'Item code/unit mismatch' });
});
export type QuantityItem = z.infer<typeof QuantityItemSchema>;
export const TotalSchema = z.object({ itemCode: code, quantity: QuantitySchema, itemCount: z.number().int().nonnegative(), status }).strict();
export const SectionSchema = z.object({ dimension: z.enum(['project','level','specification','classification','thickness']), key: z.string().max(200).nullable(), totals: z.array(TotalSchema).max(64) }).strict();
export const ScheduleEntrySchema = z.object({ id, kind: z.enum(['door','window','opening']), levelId: id, wallId: id,
  widthMm: z.number().int().positive(), heightMm: z.number().int().positive(), sillMm: z.number().int().nonnegative(),
  type: z.string().max(200), operation: z.string().max(200).nullable(), specificationId: id.nullable(), area: QuantitySchema,
}).strict();
export const QuantityTakeoffReportSchema = z.object({
  engineVersion: z.literal(TAKEOFF_ENGINE_VERSION), modelSchemaVersion: z.literal(2), measurementPolicyVersion: z.literal(MEASUREMENT_POLICY_VERSION),
  options: TakeoffOptionsSchema, summary: z.object({ itemCount: z.number().int().nonnegative(), warningCount: z.number().int().nonnegative(), totals: z.array(TotalSchema).max(64) }).strict(),
  sections: z.array(SectionSchema).max(LIMITS.sections), items: z.array(QuantityItemSchema).max(LIMITS.items),
  schedules: z.object({ entries: z.array(ScheduleEntrySchema).max(LIMITS.entities), groups: z.array(z.object({
    kind: z.enum(['door','window','opening']), widthMm: z.number().int().positive(), heightMm: z.number().int().positive(),
    type: z.string().max(200), operation: z.string().max(200).nullable(), specificationId: id.nullable(), count: z.number().int().positive(), area: QuantitySchema,
  }).strict()).max(LIMITS.entities) }).strict(),
  warnings: z.array(z.object({ code: z.string().max(100), sourceEntityIds: z.array(id).max(2) }).strict()).max(LIMITS.warnings),
  coverage: z.array(z.object({ category: z.string().max(100), status, reason: z.string().max(200), entityCount: z.number().int().nonnegative() }).strict()).max(32),
  assumptions: z.array(z.object({ code: z.string().max(100), description: z.string().max(500) }).strict()).max(24),
}).strict();
export type QuantityTakeoffReport = z.infer<typeof QuantityTakeoffReportSchema>;
export class TakeoffError extends Error {
  constructor(readonly code: 'INVALID_BUILDING_MODEL' | 'INCOMPLETE_MODEL' | 'INVALID_TAKEOFF_OPTIONS' | 'TAKEOFF_INVARIANT_FAILED' | 'RESOURCE_LIMIT_EXCEEDED', message: string) {
    super(message); this.name = 'TakeoffError';
  }
}
