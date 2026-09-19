import { PlanSchema, type Plan } from '@designflow/shared';
import { GenerationError } from './errors.js';
import { validateGenerationInput, validateGenerationOptions } from './input.js';
import { layoutCandidates } from './layout.js';
import { placeFurniture } from './furniture.js';
import { wallsWithOpenings } from './geometry.js';
import { assertPlanInvariants } from './invariants.js';
import { hashSeed } from './random.js';

/** Pure synchronous generation. No persistence IDs, clocks, network or global RNG. */
export function generatePlan(rawInput: unknown, rawOptions: unknown = {}): Plan {
  const input = validateGenerationInput(rawInput);
  const options = validateGenerationOptions(rawOptions);
  const seed = options.seed ?? `df6-${hashSeed(JSON.stringify(input)).toString(16).padStart(8, '0')}`;
  try {
    for (const layout of layoutCandidates(input, `${seed}:${options.variant}`)) {
      try {
        const walls = wallsWithOpenings(layout.rooms, layout.openings);
        const furn = placeFurniture(layout.rooms, layout.openings);
        const plan = PlanSchema.parse({ prompt: input.prompt, seed, variant: options.variant, rooms: layout.rooms,
          walls, furn, bounds: input.bounds, qa: { orthogonal: 1, walls: walls.length, pieces: furn.length } });
        assertPlanInvariants(plan, input);
        return plan;
      } catch (error) {
        if (!(error instanceof GenerationError) || error.code !== 'IMPOSSIBLE_LAYOUT') throw error;
      }
    }
    throw new GenerationError('IMPOSSIBLE_LAYOUT', 'The requested rooms, adjacency and furniture do not fit a supported layout within this footprint');
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    throw new GenerationError('GENERATION_FAILED', 'The generator could not produce a valid plan');
  }
}
