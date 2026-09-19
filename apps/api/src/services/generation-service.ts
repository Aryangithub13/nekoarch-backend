import { PlanInputSchema } from '@designflow/shared';
import { generatePlan, parseRequirements, GenerationError } from '@designflow/generator';
import type { GeneratePlanRequest } from '../contracts/generation.js';
import { ApiError } from '../lib/errors.js';
import type { Repository } from '../lib/repository.js';
import { createPlan } from './plan-service.js';

export async function generateAndSavePlan(repository: Repository, userId: string, request: GeneratePlanRequest) {
  let plan;
  try {
    const requirements = 'requirements' in request ? request.requirements : parseRequirements(request.prompt);
    plan = PlanInputSchema.parse(generatePlan(requirements, { seed: request.seed, variant: request.variant }));
  } catch (error) {
    if (error instanceof GenerationError) {
      switch (error.code) {
        case 'INVALID_INPUT':
          throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid generation requirements');
        case 'UNSUPPORTED_REQUIREMENT':
          throw new ApiError(422, 'UNSUPPORTED_REQUIREMENT', 'The request exceeds the supported generation capabilities');
        case 'IMPOSSIBLE_LAYOUT':
          throw new ApiError(422, 'IMPOSSIBLE_LAYOUT', 'The requested rooms and furniture do not fit a supported layout');
        case 'INVARIANT_FAILURE':
        case 'GENERATION_FAILED':
          throw new ApiError(500, 'GENERATION_FAILED', 'A valid plan could not be generated');
      }
    }
    // Unexpected exceptions and invalid canonical output use the existing safe
    // INTERNAL_ERROR handler and reporting path.
    throw error;
  }
  // Keep database failures outside the generator error mapping. The existing
  // insert includes the atomic audit trigger, owner and share-token guarantees.
  return createPlan(repository, userId, plan);
}
