import { z } from 'zod';
import { SiteSchema } from '@designflow/shared';
import { BlueprintError } from '../blueprint/types.js';
import { BUILDING_TYPES, QUALITY_TIERS, SPACE_KIND_NAMES } from './catalog.js';

export const PROGRAM_VERSION = 'program-architecture-v1';
export const PROGRAM_LIMITS = Object.freeze({ maxFloors: 10, maxRooms: 60, maxDimensionMm: 120000 });
const length = z.number().int().positive().max(PROGRAM_LIMITS.maxDimensionMm);
const even = (max: number) => z.number().int().min(100).max(max).refine(n => n % 2 === 0, 'Even thickness keeps wall faces on the integer grid');
export const ProgramSpaceSchema = z.object({
  kind: z.enum(SPACE_KIND_NAMES), count: z.number().int().min(1).max(40),
  /** Explicit storey (0 = ground). Omitted means the engine zones it. */
  level: z.number().int().min(0).max(PROGRAM_LIMITS.maxFloors - 1).optional(),
  /** Target area per room in m²; omitted means the catalog target scaled by the quality tier. */
  areaM2: z.number().min(1).max(2000).optional(),
  /** Attached (en-suite) bathroom for each room of this group. */
  ensuite: z.boolean().default(false),
  name: z.string().trim().min(1).max(60).optional(),
}).strict();
export const ProgramSchema = z.object({
  buildingType: z.enum(BUILDING_TYPES).default('house'),
  qualityTier: z.enum(QUALITY_TIERS).default('standard'),
  style: z.enum(['modern', 'contemporary', 'minimal', 'traditional', 'colonial', 'industrial', 'tropical', 'mediterranean']).default('modern'),
  city: z.string().trim().min(1).max(80).optional(),
  budgetInr: z.number().int().positive().max(100_000_000_000).optional(),
  spaces: z.array(ProgramSpaceSchema).min(1).max(40),
  roofTerrace: z.boolean().default(false),
  balconies: z.boolean().default(false),
  /** The brief text that produced this program (display provenance only; never interpreted by the engine). */
  brief: z.string().max(600).optional(),
}).strict();
export const ProgramRequirementsSchema = z.object({
  program: ProgramSchema,
  site: SiteSchema.omit({ id: true, name: true, setbacks: true, accessSide: true, primaryEntryOpeningId: true, parkingZones: true, buildableBoundary: true, referenceOrigin: true }).extend({
    setbacks: z.array(z.object({ boundaryEdgeStart: z.number().int().min(0).max(3), minimumMm: length.or(z.literal(0)) }).strict()).max(4).default([]),
    northMilliDegrees: z.number().int().min(0).max(359_999).nullable().default(null),
  }).strict(),
  floors: z.number().int().min(1).max(PROGRAM_LIMITS.maxFloors),
  floorToFloorHeightMm: z.number().int().min(2700).max(6000).default(3000),
  slabThicknessMm: z.number().int().min(100).max(300).default(150),
  exteriorWallThicknessMm: even(400).default(230),
  interiorWallThicknessMm: even(300).default(120),
  seed: z.string().min(1).max(128).default('program-default'),
}).strict().superRefine((r, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  if (r.program.spaces.reduce((n, s) => n + s.count * (s.ensuite ? 2 : 1), 0) > PROGRAM_LIMITS.maxRooms) issue(['program', 'spaces'], `At most ${PROGRAM_LIMITS.maxRooms} rooms including en-suites`);
  r.program.spaces.forEach((s, i) => { if (s.level !== undefined && s.level >= r.floors) issue(['program', 'spaces', i, 'level'], 'Level is not requested'); });
  const b = r.site.boundary;
  if (b.length !== 4 || b.some((p, i) => { const q = b[(i + 1) % 4]!; return p.x !== q.x && p.z !== q.z; })) issue(['site', 'boundary'], 'The program engine supports axis-aligned rectangular plots');
});
export type ProgramRequirements = z.input<typeof ProgramRequirementsSchema>;
export type NormalizedProgramRequirements = z.output<typeof ProgramRequirementsSchema>;
export function normalizeProgramRequirements(value: unknown): NormalizedProgramRequirements {
  let parsed;
  try { parsed = ProgramRequirementsSchema.safeParse(value); } catch { throw new BlueprintError('INVALID_REQUIREMENTS', 'Requirements must be plain supported data'); }
  if (!parsed.success) throw new BlueprintError('INVALID_REQUIREMENTS', 'Invalid program requirements', { fields: parsed.error.issues.slice(0, 24).map(i => `${i.path.join('.')}: ${i.message}`) });
  const r = parsed.data;
  // Canonical order keeps hashes independent of the order a brief listed its rooms in.
  r.program.spaces.sort((a, b) => SPACE_KIND_NAMES.indexOf(a.kind) - SPACE_KIND_NAMES.indexOf(b.kind) || (a.level ?? -1) - (b.level ?? -1) || Number(a.ensuite) - Number(b.ensuite));
  r.site.setbacks.sort((a, b) => a.boundaryEdgeStart - b.boundaryEdgeStart);
  return r;
}
