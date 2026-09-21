import { z } from 'zod';
import { LengthMmSchema, SiteSchema } from '@designflow/shared';
import { RoomTypeSchema } from '../input.js';
import { BlueprintError } from './types.js';

export const BLUEPRINT_VERSION = 'precision-blueprint-v1';
export const BLUEPRINT_LIMITS = Object.freeze({ maxRooms: 24, maxFloors: 2, maxCandidates: 128, maxIterations: 20000, maxDimensionMm: 60000 });
const length = LengthMmSchema.max(60000);
const thickness = length.max(1000).refine(n => n % 2 === 0, 'Even thickness keeps wall faces on the integer grid');
const selector = z.object({ type: RoomTypeSchema, ordinal: z.number().int().min(1).max(24).default(1) }).strict();
export const BlueprintRequirementsSchema = z.object({
  site: SiteSchema.omit({ id: true, name: true, setbacks: true }).extend({
    setbacks: z.array(z.object({ boundaryEdgeStart: z.number().int().min(0).max(255), minimumMm: length.or(z.literal(0)) }).strict()).max(4).default([]),
  }).strict(),
  floors: z.union([z.literal(1), z.literal(2)]).default(1),
  rooms: z.array(z.object({
    type: RoomTypeSchema, count: z.number().int().min(1).max(24), level: z.union([z.literal(0), z.literal(1)]).optional(),
    minWidthMm: length.default(1800), minDepthMm: length.default(1800),
    minAreaMm2: z.number().int().positive().max(3_600_000_000).optional(),
    preferredWidthMm: length.optional(), preferredDepthMm: length.optional(),
    positionPreference: z.enum(['front', 'rear']).optional(),
  }).strict()).min(1).max(24),
  relationships: z.array(z.object({ from: selector, to: selector,
    strength: z.enum(['hard', 'soft']), kind: z.enum(['adjacent', 'connected', 'passage']).default('adjacent'),
  }).strict()).max(48).default([]),
  circulationWidthMm: length.default(1200),
  floorToFloorHeightMm: length.min(2400).max(6000).default(3000),
  exteriorWallThicknessMm: thickness.default(200), interiorWallThicknessMm: thickness.default(100),
  slabThicknessMm: length.min(50).max(500).default(150),
  door: z.object({ widthMm: length.default(900), heightMm: length.default(2100), jambMm: length.max(500).default(100) }).strict().default({}),
  windows: z.object({ enabled: z.boolean().default(true), widthMm: length.default(1200), heightMm: length.default(1200), sillMm: length.or(z.literal(0)).default(900) }).strict().default({}),
  stair: z.object({ widthMm: length.default(1000), riserCount: z.number().int().min(2).max(40).default(16), treadDepthMm: length.min(100).max(600).default(280), landingDepthMm: length.default(1200) }).strict().optional(),
  seed: z.string().min(1).max(128).default('blueprint-default'),
  solver: z.object({ maxCandidates: z.number().int().min(1).max(128).default(32), maxIterations: z.number().int().min(1).max(20000).default(20000) }).strict().default({}),
}).strict().superRefine((r, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const groups = new Set<string>();
  if (r.rooms.reduce((n, room) => n + room.count, 0) > 24) issue(['rooms'], 'At most 24 requested rooms');
  r.rooms.forEach((room, i) => {
    const key = `${room.type}:${room.level ?? 'auto'}`;
    if (groups.has(key)) issue(['rooms', i], 'Duplicate type/level group');
    groups.add(key);
    if (room.level !== undefined && room.level >= r.floors) issue(['rooms', i, 'level'], 'Level is not requested');
  });
  const pairs = new Set<string>();
  r.relationships.forEach((edge, i) => {
    const keys = [edge.from, edge.to].map(s => `${s.type}:${s.ordinal}`).sort();
    if (keys[0] === keys[1] || pairs.has(keys.join('|'))) issue(['relationships', i], 'Duplicate or self relationship');
    pairs.add(keys.join('|'));
    for (const s of [edge.from, edge.to]) if (r.rooms.filter(room => room.type === s.type).reduce((n, room) => n + room.count, 0) < s.ordinal) issue(['relationships', i], 'Selector must resolve to a requested room');
  });
  const setbacks = new Set<number>();
  for (const s of r.site.setbacks) {
    if (s.boundaryEdgeStart >= r.site.boundary.length || setbacks.has(s.boundaryEdgeStart)) issue(['site', 'setbacks'], 'Setback edge must exist and be unique');
    setbacks.add(s.boundaryEdgeStart);
  }
  if (r.floors === 1 && r.stair) issue(['stair'], 'Stair configuration requires two floors');
  const wallHeight = r.floorToFloorHeightMm - r.slabThicknessMm;
  if (r.door.heightMm > wallHeight) issue(['door'], 'Door exceeds clear storey height');
  if (r.windows.enabled && r.windows.sillMm + r.windows.heightMm > wallHeight) issue(['windows'], 'Window exceeds clear storey height');
});
export type BlueprintRequirements = z.input<typeof BlueprintRequirementsSchema>;
export type NormalizedBlueprintRequirements = z.output<typeof BlueprintRequirementsSchema>;
export function normalizeBlueprintRequirements(value: unknown): NormalizedBlueprintRequirements {
  let parsed;
  try { parsed = BlueprintRequirementsSchema.safeParse(value); } catch {
    throw new BlueprintError('INVALID_REQUIREMENTS', 'Requirements must be plain supported data');
  }
  if (!parsed.success) throw new BlueprintError('INVALID_REQUIREMENTS', 'Invalid blueprint requirements', {
    fields: parsed.error.issues.slice(0, 24).map(i => i.path.join('.')),
  });
  const r = parsed.data;
  // Explicit ordering, independent of caller object insertion order or group order.
  r.rooms.sort((a, b) => RoomTypeSchema.options.indexOf(a.type) - RoomTypeSchema.options.indexOf(b.type) || (a.level ?? 2) - (b.level ?? 2));
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  for (const relation of r.relationships) if (compare(selectorKey(relation.from), selectorKey(relation.to)) > 0) [relation.from, relation.to] = [relation.to, relation.from];
  r.relationships.sort((a, b) => compare(selectorKey(a.from), selectorKey(b.from)) || compare(selectorKey(a.to), selectorKey(b.to)));
  r.site.setbacks.sort((a, b) => a.boundaryEdgeStart - b.boundaryEdgeStart);
  if (r.floors === 2 && !r.stair) r.stair = { widthMm: 1000, riserCount: 16, treadDepthMm: 280, landingDepthMm: 1200 };
  return r;
}
export function selectorKey(s: { type: string; ordinal: number }): string { return `${s.type}-${s.ordinal}`; }
