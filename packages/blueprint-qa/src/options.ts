import { z } from 'zod';
import { EntityIdSchema, LengthMmSchema, ParametricArchitectureSchema } from '@designflow/shared';
import { SeveritySchema } from './report.js';
const common = { id: EntityIdSchema, version: z.string().min(1).max(100), severity: SeveritySchema };
const selection = { classifications: z.array(z.string().min(1).max(200)).max(256).optional() };
export const ArchitecturalRuleSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, ...selection, kind: z.literal('minimum-space-area'), minimumMm2: z.number().int().positive().safe() }).strict(),
  z.object({ ...common, ...selection, kind: z.literal('minimum-space-span'), axis: z.enum(['x', 'z']), minimumMm: LengthMmSchema }).strict(),
  z.object({ ...common, kind: z.literal('minimum-door-width'), minimumMm: LengthMmSchema }).strict(),
  z.object({ ...common, kind: z.literal('maximum-riser-height'), maximumMm: LengthMmSchema }).strict(),
  z.object({ ...common, kind: z.literal('minimum-tread-depth'), minimumMm: LengthMmSchema }).strict(),
  z.object({ ...common, ...selection, kind: z.literal('required-window') }).strict(),
  z.object({ ...common, kind: z.literal('exterior-windows') }).strict(),
  z.object({ ...common, ...selection, kind: z.literal('reachable-spaces') }).strict(),
  z.object({ ...common, ...selection, kind: z.literal('column-free-spaces') }).strict(),
]);
export const ArchitecturalRulePackSchema = z.object({
  id: EntityIdSchema, version: z.string().min(1).max(100),
  description: z.string().max(1000), rules: z.array(ArchitecturalRuleSchema).max(256),
  entrySpaceIds: z.array(EntityIdSchema).max(4096).optional(), entryOpeningIds: z.array(EntityIdSchema).max(8192).optional(),
}).strict().superRefine((p, ctx) => {
  if (new Set(p.rules.map(r => r.id)).size !== p.rules.length) ctx.addIssue({ code: 'custom', path: ['rules'], message: 'Rule IDs must be unique within a pack' });
});
export type ArchitecturalRulePack = z.infer<typeof ArchitecturalRulePackSchema>;
export type ArchitecturalRule = z.infer<typeof ArchitecturalRuleSchema>;
export const BlueprintQaOptionsSchema = z.object({
  parametric: z.object({ architecture: ParametricArchitectureSchema, circulationWidthMm: LengthMmSchema, exteriorWallThicknessMm: LengthMmSchema, interiorWallThicknessMm: LengthMmSchema, doorJambMm: z.number().int().min(0).max(500) }).strict().optional(),
  rulePacks: z.array(ArchitecturalRulePackSchema).max(32).default([]),
  entrySpaceIds: z.array(EntityIdSchema).max(4096).default([]),
  entryOpeningIds: z.array(EntityIdSchema).max(8192).default([]),
  requireReachability: z.boolean().default(false),
  requiredRelationships: z.array(z.object({ from: EntityIdSchema, to: EntityIdSchema, kind: z.enum(['adjacent', 'connected', 'passage']) }).strict()).max(48).default([]),
  requiredClearSpaces: z.array(z.object({ id: EntityIdSchema, levelId: EntityIdSchema.optional(), minimumWidthMm: LengthMmSchema, minimumDepthMm: LengthMmSchema, minimumAreaMm2: z.number().int().positive().safe().optional() }).strict()).max(24).default([]),
  requiredSeparations: z.array(z.object({ from: EntityIdSchema, to: EntityIdSchema, minimumClearDistanceMm: z.number().int().min(0).max(60000) }).strict()).max(48).default([]),
  forbiddenTransitSpaceIds: z.array(EntityIdSchema).max(24).default([]),
  occupiedSpacesOnly: z.boolean().default(false),
  maxGeometryWork: z.number().int().min(1).max(100_000_000).default(20_000_000),
}).strict().superRefine((o, ctx) => {
  if (new Set(o.rulePacks.map(p => p.id)).size !== o.rulePacks.length) ctx.addIssue({ code: 'custom', path: ['rulePacks'], message: 'Rule pack IDs must be unique in an audit' });
});
export type BlueprintQaOptions = z.input<typeof BlueprintQaOptionsSchema>;
export type ParsedOptions = z.output<typeof BlueprintQaOptionsSchema>;
/** Product defaults, expressly opt-in; no law or ergonomic certification. */
export const PRODUCT_DEFAULTS_RULE_PACK: ArchitecturalRulePack = {
  id: 'designflow-product-defaults', version: '1', description: 'Demonstration using Phase 10 door and tread defaults, not regulation.',
  rules: [
    { id: 'door-width', version: '1', severity: 'WARNING', kind: 'minimum-door-width', minimumMm: 900 },
    { id: 'tread-depth', version: '1', severity: 'WARNING', kind: 'minimum-tread-depth', minimumMm: 280 },
  ],
};
