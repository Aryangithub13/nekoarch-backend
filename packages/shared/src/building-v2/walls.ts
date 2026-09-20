import { z } from 'zod';
import { EntityIdSchema, SpecReferenceFields } from './common.js';
import { SegmentMmSchema } from './geometry.js';
import { LengthMmSchema, OffsetMmSchema } from './units.js';
export const WallSchema = z.object({
  id: EntityIdSchema, levelId: EntityIdSchema, path: SegmentMmSchema,
  pathReference: z.enum(['centerline', 'unspecified']),
  thicknessMm: LengthMmSchema.nullable(), heightMm: LengthMmSchema.nullable(),
  baseOffsetMm: OffsetMmSchema.nullable(),
  classification: z.enum(['exterior', 'interior', 'partition', 'unspecified']),
  // Omitted means topology unknown, not exterior. List has at most two spaces.
  spaceIds: z.array(EntityIdSchema).min(1).max(2).optional(), ...SpecReferenceFields,
}).strict();
export type BuildingWall = z.infer<typeof WallSchema>;
