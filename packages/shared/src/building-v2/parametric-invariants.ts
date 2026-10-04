import type { z } from 'zod';
import type { BuildingModelV2 } from './model-shape.js';
import { ringContains, ringsOverlap, signedArea2, type RingMm } from './geometry.js';

/** Storage/takeoff boundary checks; independent QA reconstructs additional room/wall evidence. */
export function validateParametricInvariants(m: BuildingModelV2, ctx: z.RefinementCtx): void {
  const p = m.parametricArchitecture;
  if (!p) {
    if (m.provenance.generatorVersion === 'parametric-architecture-v1') ctx.addIssue({ code: 'custom', path: ['parametricArchitecture'], message: 'Parametric provenance requires its parameter submodel' });
    return;
  }
  const issue = (message: string) => ctx.addIssue({ code: 'custom', path: ['parametricArchitecture'], message });
  const equal = (a: RingMm, b: RingMm) => signedArea2(a) === signedArea2(b) && ringContains(a, b) && ringContains(b, a);
  if (m.levels.length !== p.floors.length || m.stairs.length !== p.floors.length - 1) issue('Parametric floor/stair counts must match parameters');
  for (const f of p.floors) {
    const x = p.origin.x, z = p.origin.z, level = m.levels.find(l => l.index === f.level);
    const ring = [{ x, z }, { x: x + f.widthMm, z }, { x: x + f.widthMm, z: z + f.southWingDepthMm }, { x: x + f.westWingWidthMm, z: z + f.southWingDepthMm }, { x: x + f.westWingWidthMm, z: z + f.depthMm }, { x, z: z + f.depthMm }];
    if (!level || level.id !== `level-${f.level}` || !equal(level.boundary, ring)) { issue('Parametric floor must equal its connected L boundary'); continue; }
    const lower = m.levels.find(l => l.index === f.level - 1);
    if (lower && !ringContains(lower.boundary, level.boundary)) issue('Unsupported upper floor overhang');
    const floors = m.slabs.filter(s => s.levelId === level.id && s.kind === 'floor'), slab = floors[0], stairs = m.stairs.filter(s => s.toLevelId === level.id);
    if (floors.length !== 1 || !slab || !equal(slab.footprint.outer, ring) || slab.topOffsetMm !== 0) issue('Parametric floor requires an exact covering slab');
    if (slab && (slab.footprint.voids.length !== stairs.length || stairs.some(s => !slab.footprint.voids.some(v => equal(v, s.footprint))))) issue('Only exact stair-flight floor voids are supported');
    if (slab && m.spaces.some(s => s.levelId === level.id && s.classification !== 'stairwell' && slab.footprint.voids.some(v => ringsOverlap(v, s.boundary)))) issue('Occupied spaces must not intersect slab voids');
  }
}
