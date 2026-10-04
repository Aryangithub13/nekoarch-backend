import { z } from 'zod';
import { Point2MmSchema } from './geometry.js';

const dimension = z.number().int().min(1000).max(60000);
export const ParametricFloorSchema = z.object({
  level: z.union([z.literal(0), z.literal(1)]), widthMm: dimension, depthMm: dimension,
  westWingWidthMm: dimension, southWingDepthMm: dimension,
}).strict();
/** A bounded parameter submodel, not arbitrary polygon or structural certification. */
export const ParametricArchitectureSchema = z.object({
  version: z.literal(1), shape: z.literal('L'), origin: Point2MmSchema,
  floors: z.array(ParametricFloorSchema).min(1).max(2),
}).strict().superRefine((p, ctx) => {
  p.floors.forEach((f, i) => {
    if (f.level !== i || f.westWingWidthMm >= f.widthMm || f.southWingDepthMm >= f.depthMm)
      ctx.addIssue({ code: 'custom', path: ['floors', i], message: 'Ordered contiguous floors and two nondegenerate L arms are required' });
    if (!Point2MmSchema.safeParse({ x: p.origin.x + f.widthMm, z: p.origin.z + f.depthMm }).success)
      ctx.addIssue({ code: 'custom', path: ['floors', i], message: 'Footprint exceeds coordinate range' });
  });
});
export type ParametricArchitecture = z.infer<typeof ParametricArchitectureSchema>;
