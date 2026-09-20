import { expect, it } from 'vitest';
import { BuildingModelV2Schema, CreatePlanRequestSchema, upgradePlanV1 } from '@designflow/shared';
import { generatePlan, parseRequirements, validateGenerationInput } from '../src/index.js';

it.each(Array.from({ length: 16 }, (_, i) => i))('adapts real legacy generator output without changing generation: seed %i', i => {
  const input = validateGenerationInput({ ...parseRequirements(`${1 + i % 8}BHK home with open kitchen`), bounds: { x: -99.999999 + i, z: 0.123456, w: 16.333333 + i % 4, d: 40.777779 } });
  const plan = generatePlan(input, { seed: `v2-adapter-${i}` });
  const before = JSON.stringify(plan);
  const first = upgradePlanV1(plan, 'building');
  expect(BuildingModelV2Schema.safeParse(first.model).success).toBe(true);
  expect(first.model.spaces).toHaveLength(plan.rooms.length);
  expect(first.model.walls).toHaveLength(plan.walls.length);
  expect(first.model.openings).toEqual([]);
  expect(first.model.site).toBeNull();
  expect(first).toEqual(upgradePlanV1(plan, 'building'));
  expect(JSON.stringify(plan)).toBe(before);
  expect(CreatePlanRequestSchema.parse({ plan }).plan).toEqual(plan);
  expect(JSON.stringify(generatePlan(input, { seed: `v2-adapter-${i}` }))).toBe(before);
});
