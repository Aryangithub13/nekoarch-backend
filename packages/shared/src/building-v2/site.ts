import { z } from 'zod';
import { EntityIdSchema, LabelSchema } from './common.js';
import { Point3MmSchema, RingMmSchema } from './geometry.js';
import { LengthMmSchema, OffsetMmSchema } from './units.js';
export const SiteAccessSideSchema = z.enum(['min-z', 'max-z', 'min-x', 'max-x']);
export const ParkingZoneSchema = z.object({
  id: EntityIdSchema, kind: z.literal('passenger-car-bay'), boundary: RingMmSchema,
  widthMm: LengthMmSchema, depthMm: LengthMmSchema, accessSide: SiteAccessSideSchema,
  evaluation: z.literal('conceptual-site-allocation'),
}).strict();
export const SiteSchema = z.object({
  id: EntityIdSchema, name: LabelSchema, boundary: RingMmSchema,
  buildableBoundary: RingMmSchema.optional(),
  northMilliDegrees: z.number().int().min(0).max(359_999).nullable(),
  accessSide: SiteAccessSideSchema.optional(),
  primaryEntryOpeningId: EntityIdSchema.optional(),
  parkingZones: z.array(ParkingZoneSchema).max(2).optional(),
  // Coordinates already share the building frame. Placement locates its origin
  // in an optional external survey frame; no second local entity geometry.
  referenceOrigin: z.object({ datum: LabelSchema, buildingOrigin: Point3MmSchema }).strict().optional(),
  setbacks: z.array(z.object({ id: EntityIdSchema, boundaryEdgeStart: z.number().int().nonnegative(), minimumMm: OffsetMmSchema }).strict()).max(256),
}).strict();
