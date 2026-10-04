import { z } from 'zod';
import { ParametricArchitectureSchema, ringContains, type RingMm, type ParametricArchitecture } from '@designflow/shared';
import { BlueprintRequirementsSchema } from '../blueprint/input.js';
import { normalizeBlueprintV2Requirements } from '../solver-v2/input.js';
import { bounds } from '../blueprint/geometry.js';
import { BlueprintError } from '../blueprint/types.js';

export const PARAMETRIC_VERSION = 'parametric-architecture-v1';
export const ParametricRequirementsSchema = BlueprintRequirementsSchema.innerType().extend({ parametricArchitecture: ParametricArchitectureSchema }).strict().superRefine((r, ctx) => {
  const { parametricArchitecture: p, ...base } = r;
  const check = BlueprintRequirementsSchema.safeParse(base);
  if (!check.success) for (const issue of check.error.issues) ctx.addIssue(issue);
  if (p.floors.length !== r.floors) ctx.addIssue({ code: 'custom', path: ['parametricArchitecture', 'floors'], message: 'One footprint per requested floor is required' });
});
export type ParametricRequirements = z.input<typeof ParametricRequirementsSchema>;
export type NormalizedParametricRequirements = z.output<typeof ParametricRequirementsSchema>;
export function footprint(p: ParametricArchitecture, level: number, inset = 0): RingMm {
  const f = p.floors[level]!, x = p.origin.x, z = p.origin.z;
  return [{ x: x + inset, z: z + inset }, { x: x + f.widthMm - inset, z: z + inset },
    { x: x + f.widthMm - inset, z: z + f.southWingDepthMm - inset }, { x: x + f.westWingWidthMm - inset, z: z + f.southWingDepthMm - inset },
    { x: x + f.westWingWidthMm - inset, z: z + f.depthMm - inset }, { x: x + inset, z: z + f.depthMm - inset }];
}
export function normalizeParametricRequirements(value: unknown): NormalizedParametricRequirements {
  let nodes = 0;
  const ancestors = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 5000 || depth > 12) throw new BlueprintError('SEARCH_LIMIT_EXHAUSTED', 'Parametric input size/depth budget exceeded');
    if (!v || typeof v !== 'object') return;
    if (ancestors.has(v) || (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)) throw new BlueprintError('INVALID_REQUIREMENTS', 'Expected plain acyclic data');
    if (Array.isArray(v) && v.length > 128) throw new BlueprintError('SEARCH_LIMIT_EXHAUSTED', 'Parametric input collection limit exceeded');
    ancestors.add(v);
    for (const d of Object.values(Object.getOwnPropertyDescriptors(v))) {
      if ('get' in d || 'set' in d) throw new BlueprintError('INVALID_REQUIREMENTS', 'Accessors are unsupported');
      visit(d.value, depth + 1);
    }
    ancestors.delete(v);
  };
  visit(value, 0);
  if (value && typeof value === 'object' && 'parametricArchitecture' in value) {
    const p = value.parametricArchitecture;
    if (p && typeof p === 'object' && 'shape' in p && p.shape !== 'L') throw new BlueprintError('UNSUPPORTED_PARAMETRIC_CAPABILITY', 'Only connected L footprints are supported; U, courtyard and projections are unavailable');
    if ('site' in value && value.site && typeof value.site === 'object') for (const key of ['boundary', 'buildableBoundary']) {
      const ring = (value.site as Record<string, unknown>)[key];
      if (Array.isArray(ring) && ring.length > 32) throw new BlueprintError('SITE_TOO_COMPLEX', 'Parametric sites support at most 32 vertices');
    }
  }
  const result = ParametricRequirementsSchema.safeParse(value);
  if (!result.success) throw new BlueprintError('INVALID_REQUIREMENTS', 'Invalid parametric requirements', { fields: result.error.issues.slice(0, 24).map(i => i.path.join('.')) });
  const { parametricArchitecture: p, ...base } = result.data;
  const { layoutV2: _layout, ...r } = normalizeBlueprintV2Requirements({ ...base, layoutV2: {} });
  if (r.interiorWallThicknessMm > r.exteriorWallThicknessMm || r.circulationWidthMm < 600) throw new BlueprintError('UNSUPPORTED_PARAMETRIC_CAPABILITY', 'Interior walls cannot exceed exterior thickness and clear circulation must be at least 600 mm');
  for (let i = 0; i < r.floors; i++) {
    const boundary = footprint(p, i), siteBox = bounds(r.site.boundary);
    for (const setback of r.site.setbacks) {
      const a = r.site.boundary[setback.boundaryEdgeStart]!, b = r.site.boundary[(setback.boundaryEdgeStart + 1) % r.site.boundary.length]!;
      const distance = Math.min(...boundary.map(point => a.x === b.x ? (a.x === siteBox.x ? point.x - a.x : a.x - point.x) : (a.z === siteBox.z ? point.z - a.z : a.z - point.z)));
      if (distance < setback.minimumMm) throw new BlueprintError('PROGRAM_DOES_NOT_FIT', 'Requested footprint violates a site setback', { level: i, boundaryEdgeStart: setback.boundaryEdgeStart });
    }
    if (!ringContains(r.site.buildableBoundary ?? r.site.boundary, boundary)) throw new BlueprintError('PROGRAM_DOES_NOT_FIT', 'Floor footprint leaves the buildable site', { level: i });
    if (i && !ringContains(footprint(p, i - 1), boundary)) throw new BlueprintError('UNSUPPORTED_PARAMETRIC_CAPABILITY', 'Upper floors must be fully contained by the lower footprint; cantilevers are unsupported');
  }
  return { ...r, parametricArchitecture: p };
}
export const ParametricEditSchema = z.object({ level: z.union([z.literal(0), z.literal(1)]),
  parameter: z.enum(['widthMm', 'depthMm', 'westWingWidthMm', 'southWingDepthMm']), valueMm: z.number().int().min(1000).max(60000),
}).strict();
/** Immutable replacement followed by full normalization; generation performs full propagation. */
export function modifyParametricRequirements(input: unknown, edit: z.input<typeof ParametricEditSchema>) {
  const r = normalizeParametricRequirements(input), change = ParametricEditSchema.parse(edit), f = r.parametricArchitecture.floors[change.level];
  if (!f) throw new BlueprintError('INVALID_REQUIREMENTS', 'The target floor does not exist');
  f[change.parameter] = change.valueMm;
  return normalizeParametricRequirements(r);
}
