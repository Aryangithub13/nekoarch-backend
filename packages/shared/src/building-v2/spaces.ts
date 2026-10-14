import { z } from 'zod';
import { EntityIdSchema, LabelSchema, SpecReferenceFields } from './common.js';
import { RingMmSchema } from './geometry.js';
/**
 * B39 Interior (owner decision D-12, 2026-10-14): the finish chosen for each surface of a space, from a fixed catalog. Design intent only: a code names
 * a finish family, never a product, supplier, rate, thickness or performance (fire, acoustic, slip, thermal). Optional and additive: a model without
 * finishes is unchanged, and its canonical hash with it.
 */
export const INTERIOR_FINISHES = Object.freeze({
  floor: ['polished-concrete', 'ceramic-tile', 'stone-tile', 'engineered-timber', 'vinyl', 'carpet'],
  walls: ['paint-white', 'paint-warm-neutral', 'paint-cool-grey', 'ceramic-tile', 'timber-panel', 'exposed-plaster'],
  ceiling: ['paint-white', 'acoustic-tile', 'exposed-concrete', 'timber-slat'],
} as const);
export const INTERIOR_SURFACES = ['floor', 'walls', 'ceiling'] as const;
export const SpaceFinishesSchema = z.object({
  floor: z.enum(INTERIOR_FINISHES.floor).optional(), walls: z.enum(INTERIOR_FINISHES.walls).optional(), ceiling: z.enum(INTERIOR_FINISHES.ceiling).optional(),
}).strict().refine(f => INTERIOR_SURFACES.some(s => f[s] !== undefined), { message: 'At least one surface finish is required' });
export type SpaceFinishes = z.infer<typeof SpaceFinishesSchema>;
export const SpaceSchema = z.object({
  id: EntityIdSchema, name: LabelSchema, classification: LabelSchema,
  levelId: EntityIdSchema, boundary: RingMmSchema,
  boundaryBasis: z.enum(['wall-centerline', 'unspecified']),
  occupancy: z.number().int().nonnegative().max(1_000_000).optional(),
  use: LabelSchema.optional(), ...SpecReferenceFields,
  finishes: SpaceFinishesSchema.optional(),
}).strict();
export type BuildingSpace = z.infer<typeof SpaceSchema>;
