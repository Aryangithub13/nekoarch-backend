import { z } from 'zod';
import { EntityIdSchema, LabelSchema, SpecReferenceFields } from './common.js';
import { RingMmSchema } from './geometry.js';
export const SpaceSchema = z.object({
  id: EntityIdSchema, name: LabelSchema, classification: LabelSchema,
  levelId: EntityIdSchema, boundary: RingMmSchema,
  boundaryBasis: z.enum(['wall-centerline', 'unspecified']),
  occupancy: z.number().int().nonnegative().max(1_000_000).optional(),
  use: LabelSchema.optional(), ...SpecReferenceFields,
}).strict();
export type BuildingSpace = z.infer<typeof SpaceSchema>;
