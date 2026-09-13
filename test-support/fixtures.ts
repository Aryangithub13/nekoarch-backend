import { PlanInputSchema, type EstimateInputs } from '@designflow/shared';
export const fixturePlan = () => PlanInputSchema.parse({
  prompt: 'A compact one bedroom home', seed: 'fixture-1', variant: 1,
  rooms: [{ id: 1, name: 'Living room', type: 'living', rect: { x: 0, z: 0, w: 6, d: 5 } }],
  walls: [{ x0: 0, z0: 0, x1: 6, z1: 0 }], furn: [{ kind: 'sofa', x: 2, z: 1, rot: 0 }],
  bounds: { x: 0, z: 0, w: 6, d: 5 }, qa: { orthogonal: 1, walls: 1, pieces: 1 },
});
export const fixtureEstimate = (): EstimateInputs => ({ location: 'India baseline (illustrative)', buildingType: 'residential', builtUpAreaSqft: 1250.35, floors: 2, budget: 3_000_000 });
