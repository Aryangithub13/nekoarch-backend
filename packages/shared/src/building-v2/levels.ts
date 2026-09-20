import { z } from 'zod';
import { EntityIdSchema, LabelSchema } from './common.js';
import { RingMmSchema } from './geometry.js';
import { CoordinateMmSchema, LengthMmSchema } from './units.js';
export const LevelSchema = z.object({
  id: EntityIdSchema, name: LabelSchema, index: z.number().int().min(-1000).max(1000),
  kind: z.enum(['storey', 'roof', 'datum']), elevationMm: CoordinateMmSchema,
  floorToFloorHeightMm: LengthMmSchema.nullable(),
  // Plan envelope, not duplicated physical slab geometry.
  boundary: RingMmSchema,
}).strict();
export type BuildingLevel = z.infer<typeof LevelSchema>;
