import { z } from 'zod';
import { EntityIdSchema, LabelSchema } from './common.js';
import { Point3MmSchema, RingMmSchema } from './geometry.js';
import { OffsetMmSchema } from './units.js';
export const SiteSchema = z.object({
  id: EntityIdSchema, name: LabelSchema, boundary: RingMmSchema,
  buildableBoundary: RingMmSchema.optional(),
  northMilliDegrees: z.number().int().min(0).max(359_999).nullable(),
  // Coordinates already share the building frame. Placement locates its origin
  // in an optional external survey frame; no second local entity geometry.
  referenceOrigin: z.object({ datum: LabelSchema, buildingOrigin: Point3MmSchema }).strict().optional(),
  setbacks: z.array(z.object({ id: EntityIdSchema, boundaryEdgeStart: z.number().int().nonnegative(), minimumMm: OffsetMmSchema }).strict()).max(256),
}).strict();
