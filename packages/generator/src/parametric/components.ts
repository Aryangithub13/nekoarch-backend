import type { ParametricArchitecture, RingMm } from '@designflow/shared';
import { rectangle } from '../blueprint/geometry.js';
export interface ParametricWing {
  id: string; kind: 'building-wing'; buildingId: 'blueprint'; levelId: string;
  role: 'west' | 'south-extension'; boundary: RingMm; connectsTo: string;
  allowedTransformation: 'parameter-rebuild'; provenance: 'parametric-architecture-v1';
}
/** Disjoint architectural decomposition. These are not additional slabs or quantities. */
export function describeParametricWings(p: ParametricArchitecture): ParametricWing[] {
  return p.floors.flatMap(f => {
    const base = { kind: 'building-wing' as const, buildingId: 'blueprint' as const, levelId: `level-${f.level}`, allowedTransformation: 'parameter-rebuild' as const, provenance: 'parametric-architecture-v1' as const };
    const west = `wing-${f.level}-west`, south = `wing-${f.level}-south`;
    return [{ ...base, id: west, role: 'west' as const, connectsTo: south, boundary: rectangle({ ...p.origin, w: f.westWingWidthMm, d: f.depthMm }) },
      { ...base, id: south, role: 'south-extension' as const, connectsTo: west, boundary: rectangle({ x: p.origin.x + f.westWingWidthMm, z: p.origin.z, w: f.widthMm - f.westWingWidthMm, d: f.southWingDepthMm }) }];
  });
}
