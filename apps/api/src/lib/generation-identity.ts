import { costHash } from '@designflow/boq-cost';
import { blueprintVersionForRequirements, normalizeBlueprintForVersion, PARAMETRIC_VERSION, BLUEPRINT_V2_VERSION, BLUEPRINT_VERSION } from '@designflow/generator';
import type { BuildingModelV2 } from '@designflow/shared';

export const GENERATION_IDENTITY_VERSION = 'generation-freshness-v1';

/** Seed is execution selection, separate from architectural input identity. */
export function requirementsHash(input: unknown, generatorVersion: string = blueprintVersionForRequirements(input)): string {
  const { seed: _seed, ...requirements } = normalizeBlueprintForVersion(input, generatorVersion === PARAMETRIC_VERSION ? PARAMETRIC_VERSION : generatorVersion === BLUEPRINT_V2_VERSION ? BLUEPRINT_V2_VERSION : BLUEPRINT_VERSION);
  return costHash({ identityVersion: GENERATION_IDENTITY_VERSION, generatorVersion, requirements });
}

/** Entity collections are unordered; polygon vertices and dimension chains are not.
 * Keep authoritative IDs/labels/specifications. Exclude execution provenance. */
export function canonicalBuilding(model: BuildingModelV2) {
  const { provenance: _provenance, ...building } = model;
  const byId = <T extends { id: string }>(entities: T[]) => [...entities].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { ...building,
    levels: byId(model.levels), spaces: byId(model.spaces),
    walls: byId(model.walls.map(wall => (wall.spaceIds ? { ...wall, spaceIds: [...wall.spaceIds].sort() } : wall))),
    openings: byId(model.openings), stairs: byId(model.stairs), slabs: byId(model.slabs),
    columns: byId(model.columns), dimensions: byId(model.dimensions), specifications: byId(model.specifications),
  };
}

export function modelHash(model: BuildingModelV2): string {
  return costHash({ identityVersion: GENERATION_IDENTITY_VERSION, model: canonicalBuilding(model) });
}
