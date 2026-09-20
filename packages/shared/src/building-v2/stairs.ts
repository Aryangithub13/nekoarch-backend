import { z } from 'zod';
import { EntityIdSchema, SpecReferenceFields } from './common.js';
import { RingMmSchema } from './geometry.js';
import { LengthMmSchema, OffsetMmSchema } from './units.js';
/** A straight flight, ascending from fromLevelId to toLevelId. */
export const StairSchema = z.object({
  id: EntityIdSchema, fromLevelId: EntityIdSchema, toLevelId: EntityIdSchema,
  footprint: RingMmSchema, direction: z.enum(['+x', '-x', '+z', '-z']),
  widthMm: LengthMmSchema, riseMm: LengthMmSchema, runMm: LengthMmSchema,
  // Per-riser integer heights avoid fractional-mm uniform-rise fabrication.
  riserHeightsMm: z.array(LengthMmSchema).min(2).max(4096),
  treadDepthMm: LengthMmSchema,
  headroomMm: LengthMmSchema.optional(),
  landings: z.array(z.object({ id: EntityIdSchema, footprint: RingMmSchema, elevationOffsetMm: OffsetMmSchema }).strict()).max(2),
  ...SpecReferenceFields,
}).strict();
export type BuildingStair = z.infer<typeof StairSchema>;
