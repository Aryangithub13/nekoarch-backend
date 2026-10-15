import type { BuildingModelV2 } from '@designflow/shared';
import { modelHash } from '../lib/generation-identity.js';
import { INTERIOR_VALIDATOR_VERSION, type InteriorPlan } from './contracts.js';

/**
 * B39 Interior (owner decision D-12, migration 0029). An interior finish change edits one thing: the `finishes` of named V2 spaces. These helpers are
 * the TypeScript side of the finish-only lock that 0029 enforces in SQL (project_private.strip_space_finishes): the same canonical hash, with and
 * without every space's finishes.
 */
export function stripSpaceFinishes(model: BuildingModelV2): BuildingModelV2 {
  return { ...model, spaces: model.spaces.map(({ finishes: _finishes, ...space }) => space) };
}
export const geometryModelHash = (model: BuildingModelV2) => modelHash(stripSpaceFinishes(model));

/** Each assigned surface replaces that surface's finish; surfaces not named keep theirs. Spaces not named are untouched. */
export function applyInteriorFinishes(model: BuildingModelV2, assignments: InteriorPlan['assignments']): BuildingModelV2 {
  const by = new Map(assignments.map(a => [a.spaceId, a.finishes]));
  return { ...model, spaces: model.spaces.map(s => by.has(s.id) ? { ...s, finishes: { ...s.finishes, ...by.get(s.id) } } : s) };
}

/** The candidate evidence for an interior operation. SQL builds the identical object from stored rows and compares its cost_hash (0029). */
export const interiorValidation = (baseModelHash: string, plan: InteriorPlan) => ({ status: 'VALID', validatorVersion: INTERIOR_VALIDATOR_VERSION, checks: 3,
  baseModelHash, candidateModelHash: plan.candidateModelHash, geometryModelHash: plan.geometryModelHash, finishOnly: true });
