import { BuildingModelShapeSchema } from './model-shape.js';
import { validateBuildingInvariants } from './invariants.js';
export type { BuildingModelV2 } from './model-shape.js';
export const BuildingModelV2Schema = BuildingModelShapeSchema.superRefine((model, ctx) => {
  // Refinements can receive dirty child values. Invariants require valid primitives.
  if (BuildingModelShapeSchema.safeParse(model).success) validateBuildingInvariants(model, ctx);
});
export const ArchitecturalBuildingModelV2Schema = BuildingModelV2Schema.refine(model => model.completeness === 'architectural', {
  path: ['completeness'], message: 'A complete architectural document is required',
});
