import { z } from 'zod';

export const VERIFIER_VERSION = 'complex-verification-v1';
export const DIFF_VERSION = 'scoped-diff-v1';
export const VERIFICATION_LIMITS = Object.freeze({ cellOperations: 2_000_000, scopeIds: 512 });
export const NOT_CLAIMED_VERIFICATION = Object.freeze({ statutoryCompliance: 'NOT_CLAIMED', structuralAdequacy: 'NOT_CLAIMED', surveyAccuracy: 'NOT_CLAIMED',
  constructionReadiness: 'NOT_CLAIMED' } as const);

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), entityId = z.string().min(1).max(200);
// Areas are exact: integer mm² or a .5 from the doubled-area integer.
const area = z.string().regex(/^\d+(\.5)?$/);
const decimalRatio = z.string().regex(/^\d+\.\d{4}$/);
export const RatioSchema = z.object({ numerator: z.string().regex(/^\d+$/), denominator: z.string().regex(/^[1-9]\d*$/), decimal: decimalRatio,
  rounding: z.literal('HALF_UP_4') }).strict();
export const AreaMethodSchema = z.enum(['RECTILINEAR_SLAB_UNION', 'LEVEL_BOUNDARY_FALLBACK', 'LEVEL_BOUNDARY_NO_FLOOR_SLABS']);
export const BasesSchema = z.object({
  plotAreaMm2: area.nullable(), buildableAreaMm2: area.nullable(),
  groundCoverage: z.object({ levelId: entityId, areaMm2: area, method: AreaMethodSchema }).strict(),
  levels: z.array(z.object({ levelId: entityId, grossPlateAreaMm2: area, method: AreaMethodSchema }).strict()).max(256),
  grossFloorAreaMm2: area, netSpaceAreaMm2: area,
  coverageRatio: RatioSchema.nullable(), far: RatioSchema.nullable(),
  formulas: z.record(z.string().max(300)),
}).strict();
export const CheckIdSchema = z.enum(['SITE_POLYGON', 'BUILDABLE_WITHIN_SITE', 'LEVEL_WITHIN_PERMITTED', 'SETBACK_DISTANCE', 'SPACE_ON_PLATES', 'UPPER_PLATE_SUPPORT',
  'OPENING_WITHIN_HOST', 'DECLARED_LIMIT']);
export const CheckStatusSchema = z.enum(['PASS', 'FAIL', 'WARNING', 'NOT_EVALUATED', 'NOT_APPLICABLE']);
/**
 * Roadmap Phase 34 evidence objects: each check carries a severity and the assumptions it rests on. The severity is derived from the check's own status
 * only (no engineering judgement): a FAIL blocks verification, a WARNING needs review, NOT_EVALUATED is unverified.
 */
export const CHECK_SEVERITIES = ['BLOCKING', 'REVIEW', 'UNVERIFIED', 'NONE'] as const;
export const SEVERITY_BY_STATUS = Object.freeze({ FAIL: 'BLOCKING', WARNING: 'REVIEW', NOT_EVALUATED: 'UNVERIFIED', PASS: 'NONE', NOT_APPLICABLE: 'NONE' } as const);
const RECTILINEAR = 'Exact only for rectilinear geometry; anything else is reported NOT_EVALUATED.';
const STORED = 'Uses the stored integer-millimetre geometry as given; survey accuracy is not claimed.';
/** The documented assumptions of each check (phase34-design.md §4, phase34-report.md §E). */
export const CHECK_ASSUMPTIONS = Object.freeze({
  SITE_POLYGON: [STORED],
  BUILDABLE_WITHIN_SITE: [STORED],
  LEVEL_WITHIN_PERMITTED: [STORED, 'Each level boundary is checked against the buildable boundary when declared, otherwise the site.'],
  SETBACK_DISTANCE: ['Measured to storey envelopes (level boundaries), not to projections, eaves or balconies, which the model does not carry.'],
  SPACE_ON_PLATES: [RECTILINEAR, 'Stair footprints serving the level count as support for a stairwell over a slab void.'],
  UPPER_PLATE_SUPPORT: [RECTILINEAR, 'Reports the overhang area only; structural adequacy is not claimed.'],
  OPENING_WITHIN_HOST: ['Checks offset plus width along the host path; sill and height against the wall height are enforced by the model schema.'],
  DECLARED_LIMIT: ['The limit is caller-declared; no jurisdiction rule table is applied, so this is not a statutory determination.'],
} as const satisfies Record<z.infer<typeof CheckIdSchema>, readonly string[]>);
export const CheckSchema = z.object({ checkId: CheckIdSchema, status: CheckStatusSchema, severity: z.enum(CHECK_SEVERITIES), entityIds: z.array(entityId).max(16),
  measured: z.string().max(60).nullable(), required: z.string().max(60).nullable(), detail: z.string().max(300), assumptions: z.array(z.string().max(200)).max(4) }).strict();
export type Check = z.infer<typeof CheckSchema>;
export const DeclaredLimitsSchema = z.object({
  maxCoverageRatio: z.number().gt(0).max(1).multipleOf(0.0001).optional(),
  maxFar: z.number().gt(0).max(100).multipleOf(0.0001).optional(),
}).strict();
export const VerificationRequestSchema = z.object({ declaredLimits: DeclaredLimitsSchema.optional() }).strict();
export const VerificationReportSchema = z.object({
  verifierVersion: z.literal(VERIFIER_VERSION), projectId: id, revisionId: id, modelHash: hash, inputHash: hash,
  status: z.enum(['VERIFIED', 'VERIFIED_WITH_WARNINGS', 'PARTIAL', 'FAILED']),
  bases: BasesSchema, checks: z.array(CheckSchema).max(20_000),
  summary: z.object({ pass: z.number().int(), fail: z.number().int(), warning: z.number().int(), notEvaluated: z.number().int(), notApplicable: z.number().int() }).strict(),
  declaredLimits: DeclaredLimitsSchema.nullable(),
  budget: z.object({ operations: z.number().int().min(0), limit: z.number().int(), exhausted: z.boolean() }).strict(),
  claims: z.object({ statutoryCompliance: z.literal('NOT_CLAIMED'), structuralAdequacy: z.literal('NOT_CLAIMED'), surveyAccuracy: z.literal('NOT_CLAIMED'),
    constructionReadiness: z.literal('NOT_CLAIMED') }).strict(),
}).strict();
export type VerificationReport = z.infer<typeof VerificationReportSchema>;

export const DIFF_COLLECTIONS = ['levels', 'spaces', 'walls', 'openings', 'slabs', 'columns', 'stairs', 'dimensions', 'specifications'] as const;
export const DiffScopeSchema = z.object({ levelIds: z.array(entityId).max(VERIFICATION_LIMITS.scopeIds).default([]),
  entityIds: z.array(entityId).max(VERIFICATION_LIMITS.scopeIds).default([]), allowSiteChange: z.boolean().default(false) }).strict();
export const DiffRequestSchema = z.object({ otherRevisionId: id, scope: DiffScopeSchema }).strict();
/** `document` is a model-wide document-level edit (name, completeness…); `levelIds` lists every level the entity was or is on (a moved stair has up to four). */
export const DiffChangeSchema = z.object({ collection: z.enum([...DIFF_COLLECTIONS, 'site', 'document']), entityId, change: z.enum(['ADDED', 'REMOVED', 'CHANGED']),
  levelIds: z.array(entityId).max(4), inScope: z.boolean() }).strict();
export const DiffReportSchema = z.object({
  diffVersion: z.literal(DIFF_VERSION), projectId: id, baseRevisionId: id, otherRevisionId: id, baseModelHash: hash, otherModelHash: hash,
  status: z.enum(['IDENTICAL', 'WITHIN_SCOPE', 'OUT_OF_SCOPE_CHANGES']), scope: DiffScopeSchema,
  changes: z.array(DiffChangeSchema).max(50_000), violations: z.array(DiffChangeSchema).max(50_000),
  counts: z.object({ added: z.number().int(), removed: z.number().int(), changed: z.number().int(), outOfScope: z.number().int() }).strict(),
}).strict();
export type DiffReport = z.infer<typeof DiffReportSchema>;
