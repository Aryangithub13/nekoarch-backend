import { z } from 'zod';
import { PlanSchema } from '@designflow/shared';
import { GenerationInputSchema, GenerationOptionsSchema } from '@designflow/generator';

// Compose the portable generator's public schemas here, keeping shared contracts
// independent of the generator and avoiding a second requirements model.
export const GeneratePlanRequestSchema = z.union([
  z.object({ requirements: GenerationInputSchema, ...GenerationOptionsSchema.shape }).strict(),
  z.object({
    prompt: PlanSchema.shape.prompt.refine(value => value.trim().length > 0, {
      message: 'Prompt must contain non-whitespace text',
    }),
    ...GenerationOptionsSchema.shape,
  }).strict(),
]);
export type GeneratePlanRequest = z.infer<typeof GeneratePlanRequestSchema>;
