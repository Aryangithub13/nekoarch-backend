import { z } from 'zod';
import { EntityIdSchema, SpecReferenceFields } from './common.js';
import { FootprintMmSchema } from './geometry.js';
import { CoordinateMmSchema, LengthMmSchema } from './units.js';
export const SlabSchema = z.object({
  id: EntityIdSchema, levelId: EntityIdSchema,
  kind: z.enum(['floor', 'flat-roof', 'ceiling']), footprint: FootprintMmSchema,
  // Top face relative to level; thickness extends downward.
  topOffsetMm: CoordinateMmSchema, thicknessMm: LengthMmSchema, ...SpecReferenceFields,
}).strict();
export type BuildingSlab = z.infer<typeof SlabSchema>;
export const ColumnSchema = z.object({
  id: EntityIdSchema, levelId: EntityIdSchema,
  crossSection: FootprintMmSchema, baseOffsetMm: CoordinateMmSchema, heightMm: LengthMmSchema,
  ...SpecReferenceFields,
}).strict();
