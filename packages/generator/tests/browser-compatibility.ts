import { generatePlan, parseRequirements, assertPlanInvariants } from '../src/index.js';
import { CreatePlanRequestSchema } from '@designflow/shared';

// Compile-only proof: public interface requires no Node, HTTP or renderer types.
export function browserGenerationExample() {
  const input = parseRequirements('2BHK modern flat with open kitchen');
  const plan = generatePlan(input, { seed: 'browser-example', variant: 1 });
  assertPlanInvariants(plan, input);
  return CreatePlanRequestSchema.parse({ plan });
}
