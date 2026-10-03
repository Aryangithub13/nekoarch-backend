import { z } from 'zod';
import { edges, ringContains, signedArea2, SiteAccessSideSchema, type RingMm } from '@designflow/shared';
import { BlueprintRequirementsSchema, normalizeBlueprintRequirements, selectorKey } from '../blueprint/input.js';
import { bounds } from '../blueprint/geometry.js';
import { BlueprintError } from '../blueprint/types.js';

export const BLUEPRINT_V2_VERSION = 'precision-blueprint-v2';
export const SCORE_V2_VERSION = 'precision-layout-score-v2';
export const SOLVER_V2_LIMITS = Object.freeze({ vertices: 32, cells: 256, envelopes: 16, floorAssignments: 8, objectives: 7 });
const weight = z.number().int().min(0).max(10);
const roomSelector = z.object({ type: z.enum(['bedroom', 'bathroom', 'living', 'kitchen', 'dining', 'study']), ordinal: z.number().int().min(1).max(24).default(1) }).strict();
const layout = z.object({
  version: z.literal(2).default(2), accessSide: SiteAccessSideSchema.optional(),
  forbidPrivateThroughAccess: z.boolean().default(false),
  separations: z.array(z.object({ from: roomSelector, to: roomSelector, strength: z.enum(['hard', 'soft']), minimumClearDistanceMm: z.number().int().min(0).max(60000), weight: weight.default(1) }).strict()).max(48).default([]),
  parking: z.object({ count: z.number().int().min(0).max(2).default(0), widthMm: z.number().int().min(2000).max(4000).default(2500), depthMm: z.number().int().min(4000).max(7000).default(5000) }).strict().default({}),
  objectives: z.object({ privacy: weight.default(1), serviceClustering: weight.default(1), daylightPotential: weight.default(1), ventilationPotential: weight.default(1), circulation: weight.default(1), roomShape: weight.default(1), siteUtilization: weight.default(1) }).strict().default({}),
  cardinalPreferences: z.array(z.object({ room: z.object({ type: z.enum(['bedroom', 'bathroom', 'living', 'kitchen', 'dining', 'study']), ordinal: z.number().int().min(1).max(24).default(1) }).strict(), direction: z.enum(['north', 'east', 'south', 'west']), weight: weight.default(1) }).strict()).max(24).default([]),
}).strict().default({});
export const BlueprintV2RequirementsSchema = BlueprintRequirementsSchema.innerType().extend({ layoutV2: layout }).strict().superRefine((r, ctx) => {
  const { layoutV2: _layout, ...base } = r;
  const check = BlueprintRequirementsSchema.safeParse(base);
  if (!check.success) for (const i of check.error.issues) ctx.addIssue(i);
  if ((r.layoutV2.parking.count || r.rooms.some(room => room.positionPreference)) && !r.layoutV2.accessSide) ctx.addIssue({ code: 'custom', path: ['layoutV2', 'accessSide'], message: 'Parking and front/rear preferences require an explicit access side' });
  if (r.layoutV2.cardinalPreferences.length && (r.site.northMilliDegrees === null || r.site.northMilliDegrees % 90000 !== 0)) ctx.addIssue({ code: 'custom', path: ['site', 'northMilliDegrees'], message: 'Cardinal preferences currently require an explicit quarter-turn north orientation' });
  const pairs = new Set<string>();
  for (const relation of r.layoutV2.separations) {
    const keys = [selectorKey(relation.from), selectorKey(relation.to)].sort();
    if (keys[0] === keys[1] || pairs.has(keys.join('/'))) ctx.addIssue({ code: 'custom', path: ['layoutV2', 'separations'], message: 'Separation pairs must be unique and distinct' });
    pairs.add(keys.join('/'));
    for (const s of [relation.from, relation.to]) if (r.rooms.filter(room => room.type === s.type).reduce((n, room) => n + room.count, 0) < s.ordinal) ctx.addIssue({ code: 'custom', path: ['layoutV2', 'separations'], message: 'Separation selectors must resolve' });
  }
  const seen = new Set<string>();
  for (const preference of r.layoutV2.cardinalPreferences) {
    const key = selectorKey(preference.room);
    if (seen.has(key) || r.rooms.filter(room => room.type === preference.room.type).reduce((n, room) => n + room.count, 0) < preference.room.ordinal) ctx.addIssue({ code: 'custom', path: ['layoutV2', 'cardinalPreferences'], message: 'Cardinal selectors must resolve and be unique' });
    seen.add(key);
  }
});
export type BlueprintV2Requirements = z.input<typeof BlueprintV2RequirementsSchema>;
export type NormalizedBlueprintV2Requirements = z.output<typeof BlueprintV2RequirementsSchema>;
export function canonicalRing(ring: RingMm): RingMm {
  const ordered = signedArea2(ring) < 0n ? [...ring].reverse() : [...ring];
  let first = 0;
  ordered.forEach((p, i) => { if (p.x < ordered[first]!.x || (p.x === ordered[first]!.x && p.z < ordered[first]!.z)) first = i; });
  return [...ordered.slice(first), ...ordered.slice(0, first)];
}
export function normalizeBlueprintV2Requirements(value: unknown): NormalizedBlueprintV2Requirements {
  // Reject oversized rings before any quadratic polygon refinement.
  if (value && typeof value === 'object' && 'site' in value && value.site && typeof value.site === 'object') {
    for (const key of ['boundary', 'buildableBoundary'] as const) {
      const ring = (value.site as Record<string, unknown>)[key];
      if (Array.isArray(ring) && ring.length > SOLVER_V2_LIMITS.vertices) throw new BlueprintError('SITE_TOO_COMPLEX', 'V2 supports at most 32 vertices per site ring');
    }
  }
  const parsed = BlueprintV2RequirementsSchema.safeParse(value);
  if (!parsed.success) throw new BlueprintError('INVALID_REQUIREMENTS', 'Invalid V2 requirements', { fields: parsed.error.issues.slice(0, 24).map(i => i.path.join('.')) });
  const { layoutV2, ...base } = parsed.data;
  const r = { ...normalizeBlueprintRequirements(base), layoutV2 };
  for (const ring of [r.site.boundary, ...(r.site.buildableBoundary ? [r.site.buildableBoundary] : [])]) {
    if (edges(ring).some(([a, b]) => a.x !== b.x && a.z !== b.z)) throw new BlueprintError('UNSUPPORTED_SITE_GEOMETRY', 'Only simple orthogonal site rings are supported');
    const b = bounds(ring);
    if (b.w > 60000 || b.d > 60000) throw new BlueprintError('UNSUPPORTED_SITE_GEOMETRY', 'Site span exceeds 60000 mm');
  }
  if (r.site.buildableBoundary && !ringContains(r.site.boundary, r.site.buildableBoundary)) throw new BlueprintError('INVALID_REQUIREMENTS', 'Buildable polygon leaves site');
  if (r.site.boundary.length !== 4 && r.site.setbacks.length) throw new BlueprintError('UNSUPPORTED_SITE_GEOMETRY', 'Nonrectangular setbacks require an explicit inset buildable polygon and no edge setback declarations');
  const original = r.site.boundary, canonical = canonicalRing(original);
  for (const setback of r.site.setbacks) {
    const a = original[setback.boundaryEdgeStart]!, b = original[(setback.boundaryEdgeStart + 1) % original.length]!;
    setback.boundaryEdgeStart = edges(canonical).findIndex(([p, q]) => (p.x === a.x && p.z === a.z && q.x === b.x && q.z === b.z) || (p.x === b.x && p.z === b.z && q.x === a.x && q.z === a.z));
  }
  r.site.boundary = canonical;
  if (r.site.buildableBoundary) r.site.buildableBoundary = canonicalRing(r.site.buildableBoundary);
  r.site.setbacks.sort((a, b) => a.boundaryEdgeStart - b.boundaryEdgeStart);
  r.layoutV2.cardinalPreferences.sort((a, b) => selectorKey(a.room) < selectorKey(b.room) ? -1 : 1);
  for (const e of r.layoutV2.separations) if (selectorKey(e.from) > selectorKey(e.to)) [e.from, e.to] = [e.to, e.from];
  r.layoutV2.separations.sort((a, b) => `${selectorKey(a.from)}/${selectorKey(a.to)}` < `${selectorKey(b.from)}/${selectorKey(b.to)}` ? -1 : 1);
  return r;
}
