import { z } from 'zod';
import { EntityIdSchema, LabelSchema, SpecReferenceFields } from './common.js';
import { LengthMmSchema, OffsetMmSchema } from './units.js';
const hosted = {
  id: EntityIdSchema, wallId: EntityIdSchema, levelId: EntityIdSchema,
  offsetMm: OffsetMmSchema, widthMm: LengthMmSchema, heightMm: LengthMmSchema,
  sillMm: OffsetMmSchema, type: LabelSchema, ...SpecReferenceFields,
};
export const DoorSchema = z.object({
  ...hosted, kind: z.literal('door'),
  operation: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('hinged'), hinge: z.enum(['start', 'end']), swingSide: z.enum(['left', 'right']), angleMilliDegrees: z.number().int().positive().max(180_000) }).strict(),
    z.object({ kind: z.literal('sliding'), slideToward: z.enum(['start', 'end']) }).strict(),
    z.object({ kind: z.literal('unspecified') }).strict(),
  ]),
}).strict();
export const WindowSchema = z.object({ ...hosted, kind: z.literal('window') }).strict();
export const GenericOpeningSchema = z.object({ ...hosted, kind: z.literal('opening'), purpose: z.enum(['passage', 'service', 'other']) }).strict();
export const HostedOpeningSchema = z.discriminatedUnion('kind', [DoorSchema, WindowSchema, GenericOpeningSchema]);
export type HostedOpening = z.infer<typeof HostedOpeningSchema>;
