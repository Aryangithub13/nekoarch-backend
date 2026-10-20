import { z } from 'zod';
import { BUILDING_TYPES, QUALITY_TIERS, SPACE_KIND_NAMES } from '@designflow/generator';

/**
 * Design brief: what the client asked for, accumulated over the conversation. It is the source of the program
 * requirements; every value records whether the client stated it or the engine assumed it.
 */
export const STYLES = ['modern', 'contemporary', 'minimal', 'traditional', 'colonial', 'industrial', 'tropical', 'mediterranean'] as const;
export const BriefSpaceSchema = z.object({
  kind: z.enum(SPACE_KIND_NAMES), count: z.number().int().min(1).max(40), ensuite: z.boolean().default(false),
  /** Storey index; -1 means the top floor. */
  level: z.number().int().min(-1).max(9).optional(),
  areaM2: z.number().min(1).max(2000).optional(),
}).strict();
export type BriefSpace = z.infer<typeof BriefSpaceSchema>;
const site = z.object({ widthMm: z.number().int().min(3000).max(120000), depthMm: z.number().int().min(3000).max(120000) }).strict();
export const BriefSchema = z.object({
  buildingType: z.enum(BUILDING_TYPES).optional(),
  floors: z.number().int().min(1).max(10).optional(),
  site: site.optional(),
  spaces: z.array(BriefSpaceSchema).max(40).default([]),
  qualityTier: z.enum(QUALITY_TIERS).optional(),
  style: z.enum(STYLES).optional(),
  city: z.string().trim().min(1).max(60).optional(),
  budgetInr: z.number().int().positive().max(100_000_000_000).optional(),
  roofTerrace: z.boolean().optional(),
  balconies: z.boolean().optional(),
  /** Wishes the client expressed that the layout engine does not model (acknowledged, never silently dropped). */
  notes: z.array(z.string().max(120)).max(12).default([]),
  /** The client's own words for the latest full brief (display only). */
  text: z.string().max(600).optional(),
}).strict();
export type Brief = z.infer<typeof BriefSchema>;
/** One message's contribution. `mode: replace` starts a new brief; `modify` edits the current one. */
export const BriefPatchSchema = BriefSchema.extend({
  mode: z.enum(['replace', 'modify']).default('modify'),
  remove: z.array(z.enum(SPACE_KIND_NAMES)).max(20).default([]),
  /** Kinds whose counts are relative additions ("add a gym", "one more bedroom"). */
  add: z.array(z.enum(SPACE_KIND_NAMES)).max(20).default([]),
  /** Kinds to scale: >1 larger, <1 smaller. */
  resize: z.array(z.object({ kind: z.enum(SPACE_KIND_NAMES), factor: z.number().min(0.5).max(2) }).strict()).max(12).default([]),
  /** Nothing design-related was said (a greeting or a general question). */
  empty: z.boolean().default(false),
}).strict();
export type BriefPatch = z.infer<typeof BriefPatchSchema>;
