import { z } from 'zod';
import { EntityIdSchema } from './common.js';
import { Point3MmSchema } from './geometry.js';
import { LengthMmSchema } from './units.js';
export const DimensionAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('point'), point: Point3MmSchema }).strict(),
  z.object({ kind: z.literal('wall-end'), wallId: EntityIdSchema, end: z.enum(['start', 'end']) }).strict(),
  z.object({ kind: z.literal('space-vertex'), spaceId: EntityIdSchema, vertexIndex: z.number().int().nonnegative().max(255) }).strict(),
  z.object({ kind: z.literal('opening-edge'), openingId: EntityIdSchema, edge: z.enum(['start', 'end']) }).strict(),
  z.object({ kind: z.literal('level'), levelId: EntityIdSchema }).strict(),
]);
export const DimensionSchema = z.object({
  id: EntityIdSchema, levelId: EntityIdSchema.optional(),
  purpose: z.enum(['overall', 'chain', 'room', 'opening-offset', 'wall', 'elevation']),
  axis: z.enum(['x', 'y', 'z']), anchors: z.array(DimensionAnchorSchema).min(2).max(256),
  constraint: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('derived') }).strict(),
    z.object({ mode: z.literal('controlling'), overallMm: LengthMmSchema, segmentsMm: z.array(LengthMmSchema).min(1).max(255) }).strict(),
  ]),
}).strict();
export type BuildingDimension = z.infer<typeof DimensionSchema>;
