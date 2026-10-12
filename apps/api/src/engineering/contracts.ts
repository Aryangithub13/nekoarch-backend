import { z } from 'zod';
import { CurrencySchema } from '@designflow/boq-cost';

// Normative specification: docs/phase35/phase35-design.md. Literals change only with semantics.
export const ASSESSMENT_VERSION = 'engineering-assessment-v1';
export const SOURCE_REGISTRY_VERSION = 'engineering-source-registry-v1';
export const FORMULAS = Object.freeze({ height: 'model-height-v2', areaVolume: 'gross-area-volume-v1', baseWidth: 'convex-hull-min-width-v1', cost: 'conceptual-cost-v1' });
export const ASSESSMENT_LIMITS = Object.freeze({ bodyBytes: 65_536, evidence: 16, costComponents: 64, costAdjustments: 16, excludedScopes: 16 });
export const NOT_CLAIMED_ENGINEERING = Object.freeze({ structuralSafety: 'NOT_CLAIMED', codeCompliance: 'NOT_CLAIMED', statutoryApproval: 'NOT_CLAIMED',
  professionalCertification: 'NOT_CLAIMED', constructionReadiness: 'NOT_CLAIMED' } as const);
export const NOT_CLAIMED_COST = Object.freeze({ tender: 'NOT_CLAIMED', contractorQuotation: 'NOT_CLAIMED', billOfQuantities: 'NOT_CLAIMED', finalBudget: 'NOT_CLAIMED',
  officialRateVerification: 'NOT_CLAIMED' } as const);

/** The seven assurance levels a result can belong to (design §2). A domain states the level its question needs, not a level it reached. */
export const ASSURANCE_LEVELS = ['CONCEPT_FEASIBILITY', 'GEOMETRIC_VERIFICATION', 'PRELIMINARY_CALCULATION', 'PRELIMINARY_COST_ESTIMATE', 'CODE_APPLICABILITY',
  'VALIDATED_STRUCTURAL_ANALYSIS', 'PROFESSIONAL_DESIGN_AND_APPROVAL'] as const;
export const DOMAINS = ['HEIGHT_AND_STOREYS', 'AREAS_AND_VOLUME', 'SITE_AND_GEOMETRY', 'BASE_SLENDERNESS', 'PRELIMINARY_COST', 'GRAVITY_LOADS', 'WIND_LOADS',
  'SEISMIC_LOADS', 'GEOTECHNICAL_AND_FOUNDATIONS', 'LATERAL_DRIFT_AND_STABILITY', 'DYNAMIC_RESPONSE', 'MEMBER_DESIGN', 'PROGRESSIVE_COLLAPSE', 'FIRE_AND_LIFE_SAFETY',
  'VERTICAL_TRANSPORT', 'CODE_COMPLIANCE', 'CERTIFICATION_AND_APPROVAL'] as const;
export type Domain = typeof DOMAINS[number];
export const DomainSchema = z.enum(DOMAINS);
export const DOMAIN_STATUSES = ['EVALUATED', 'PARTIALLY_EVALUATED', 'REQUIRES_INPUTS', 'REQUIRES_SOURCE_VERIFICATION', 'REQUIRES_SOLVER', 'REQUIRES_PROFESSIONAL_REVIEW',
  'UNSUPPORTED'] as const;
export const BLOCKER_KINDS = ['MISSING_INPUT', 'INPUT_CONFLICT', 'SOURCE_NOT_VERIFIED', 'NO_VALIDATED_SOLVER', 'NOT_IMPLEMENTED', 'PROFESSIONAL_REVIEW'] as const;
export const EVIDENCE_KINDS = ['GEOTECHNICAL_INVESTIGATION', 'WIND_TUNNEL_STUDY', 'SITE_SPECIFIC_SEISMIC_HAZARD', 'STRUCTURAL_DESIGN_BASIS', 'FIRE_STRATEGY', 'TOPOGRAPHIC_SURVEY'] as const;
export const OCCUPANCIES = ['RESIDENTIAL', 'OFFICE', 'HOTEL', 'RETAIL', 'MIXED_USE', 'INSTITUTIONAL', 'INDUSTRIAL', 'OTHER'] as const;
export const STRUCTURAL_MATERIALS = ['REINFORCED_CONCRETE', 'STRUCTURAL_STEEL', 'COMPOSITE', 'TIMBER', 'MASONRY', 'OTHER'] as const;

// ---------------------------------------------------------------- request (user-declared; nothing here is verified by the backend)
const text = (max: number) => z.string().transform(s => s.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').trim()).pipe(z.string().min(1).max(max));
const code = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'Expected a calendar date');
const country = z.string().regex(/^[A-Z]{2}$/);
/** Exact decimal: at most 12 integer and 6 fractional digits (the boq-cost parameter grammar). */
export const decimalParameter = z.string().max(20).regex(/^(0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/);
const lengthMm = z.number().int().positive().max(100_000_000);

export const JurisdictionSchema = z.object({ country, subdivision: text(100).optional(), locality: text(100).optional() }).strict();
export const EvidenceInputSchema = z.object({ kind: z.enum(EVIDENCE_KINDS), referenceId: z.string().uuid().optional(), citation: text(300).optional() }).strict()
  .refine(e => e.referenceId !== undefined || e.citation !== undefined, 'Evidence needs a project referenceId or a citation');

export const COST_SCOPES = ['SUBSTRUCTURE', 'SUPERSTRUCTURE', 'ENVELOPE', 'INTERIOR_FINISHES', 'MEP_SERVICES', 'VERTICAL_TRANSPORT', 'FIRE_PROTECTION', 'EXTERNAL_WORKS',
  'PRELIMINARIES_AND_GENERAL'] as const;
export const CostScopeSchema = z.enum(COST_SCOPES);
export const COST_BASES = { GROSS_FLOOR_AREA_M2: 'm2', GROSS_VOLUME_M3: 'm3', PLOT_AREA_M2: 'm2', STOREY_COUNT: 'storey', LUMP_SUM: 'item' } as const;
export type CostBasis = keyof typeof COST_BASES;
export const RATE_SOURCE_KINDS = ['OFFICIAL_SCHEDULE', 'CONTRACTOR_QUOTATION', 'USER_SUPPLIED', 'MARKET_BENCHMARK', 'THIRD_PARTY_CALCULATOR', 'SYNTHETIC'] as const;
export const RateSourceSchema = z.object({ kind: z.enum(RATE_SOURCE_KINDS), title: text(200), issuer: text(200).optional(), reference: text(300).optional(),
  jurisdiction: country.nullable().default(null), effectiveDate: isoDate.optional(), retrievedOn: isoDate.optional() }).strict();
export type RateSource = z.infer<typeof RateSourceSchema>;
const inclusion = z.enum(['INCLUDED', 'EXCLUDED', 'UNKNOWN']);
export const CostComponentSchema = z.object({ code, label: text(200), scope: z.union([CostScopeSchema, z.literal('WHOLE_BUILDING')]), basis: z.enum(Object.keys(COST_BASES) as [CostBasis, ...CostBasis[]]),
  rate: decimalParameter, includes: z.object({ gst: inclusion, overheadAndProfit: inclusion }).strict(), source: RateSourceSchema }).strict();
export const ADJUSTMENT_CATEGORIES = ['GST', 'OVERHEAD', 'PROFIT', 'ESCALATION', 'LOCATION_INDEX', 'CONTINGENCY', 'OTHER'] as const;
export const CostAdjustmentSchema = z.object({ code, label: text(200), category: z.enum(ADJUSTMENT_CATEGORIES), order: z.number().int().min(0).max(1000),
  kind: z.enum(['PERCENT', 'FIXED']), direction: z.enum(['ADD', 'DEDUCT']), basis: z.enum(['BASE', 'RUNNING']), value: decimalParameter, source: RateSourceSchema }).strict()
  .refine(a => a.kind !== 'PERCENT' || Number(a.value) <= 100, 'Maximum percentage is 100');
export const CostInputSchema = z.object({ currency: CurrencySchema, priceBasisDate: isoDate.optional(),
  components: z.array(CostComponentSchema).min(1).max(ASSESSMENT_LIMITS.costComponents),
  adjustments: z.array(CostAdjustmentSchema).max(ASSESSMENT_LIMITS.costAdjustments).default([]),
  excludedScopes: z.array(z.object({ scope: CostScopeSchema, reason: text(300) }).strict()).max(ASSESSMENT_LIMITS.excludedScopes).default([]),
}).strict().superRefine((c, ctx) => {
  const unique = (values: unknown[], message: string) => { if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', message }); };
  unique(c.components.map(x => x.code), 'Duplicate component code');
  unique(c.adjustments.map(x => x.code), 'Duplicate adjustment code');
  unique(c.adjustments.map(x => x.order), 'Duplicate adjustment order');
  unique(c.excludedScopes.map(x => x.scope), 'Duplicate excluded scope');
  if (c.excludedScopes.some(e => c.components.some(x => x.scope === e.scope))) ctx.addIssue({ code: 'custom', message: 'A scope cannot be both priced and excluded' });
});
export type CostInput = z.infer<typeof CostInputSchema>;

export const AssessmentRequestSchema = z.object({
  scope: z.array(DomainSchema).min(1).max(DOMAINS.length).transform(d => [...new Set(d)]).optional(),
  declared: z.object({ heightMm: lengthMm.optional(), heightToleranceMm: z.number().int().min(0).max(1_000_000).default(0), storeys: z.number().int().min(1).max(1000).optional() })
    .strict().optional(),
  jurisdiction: JurisdictionSchema.optional(),
  occupancy: z.object({ primary: z.enum(OCCUPANCIES) }).strict().optional(),
  structuralSystem: z.object({ primaryMaterial: z.enum(STRUCTURAL_MATERIALS), description: text(300).optional() }).strict().optional(),
  evidence: z.array(EvidenceInputSchema).max(ASSESSMENT_LIMITS.evidence).default([]),
  cost: CostInputSchema.optional(),
}).strict();
export type AssessmentRequest = z.infer<typeof AssessmentRequestSchema>;

// ---------------------------------------------------------------- report
const hash = z.string().regex(/^[a-f0-9]{64}$/), uuid = z.string().uuid(), entityId = z.string().min(1).max(200);
const area = z.string().regex(/^\d+(\.5)?$/), integerString = z.string().regex(/^\d+$/), money = z.string().regex(/^-?(0|[1-9]\d*)\.\d{2}$/);
const exact = z.object({ numerator: z.string().regex(/^-?\d+$/), denominator: z.string().regex(/^[1-9]\d*$/) }).strict();
export const SourceReferenceSchema = z.object({ sourceId: z.string().max(60), designation: z.string().max(120), title: z.string().max(300), issuer: z.string().max(200),
  jurisdiction: country, edition: z.null(), effectiveDate: z.null(), amendmentStatus: z.literal('UNKNOWN'), url: z.null(), retrievedOn: z.null(),
  verificationStatus: z.literal('NOT_VERIFIED'), permittedUse: z.literal('IDENTIFICATION_ONLY'), note: z.string().max(300) }).strict();
export type SourceReference = z.infer<typeof SourceReferenceSchema>;
export const BlockerSchema = z.object({ kind: z.enum(BLOCKER_KINDS), code: z.string().max(60), detail: z.string().max(400), inputPath: z.string().max(100).nullable(),
  sourceIds: z.array(z.string().max(60)).max(8) }).strict();
export type Blocker = z.infer<typeof BlockerSchema>;
/** Phase 35.1: `modelSupport` says whether that service can process the assessed model at all (REFUSED: its typed refusal code); NOT_CHECKED makes no claim. */
export const RelatedServiceSchema = z.object({ serviceId: z.string().max(60), route: z.string().max(200), artifactsForRevision: z.number().int().min(0).nullable(),
  note: z.string().max(300), modelSupport: z.enum(['SUPPORTED', 'REFUSED', 'NOT_CHECKED']), refusalCode: z.string().max(60).nullable() }).strict();
export const DomainResultSchema = z.object({ domain: DomainSchema, assuranceLevel: z.enum(ASSURANCE_LEVELS), status: z.enum(DOMAIN_STATUSES),
  blockers: z.array(BlockerSchema).max(16), relatedServices: z.array(RelatedServiceSchema).max(4) }).strict();
export type DomainResult = z.infer<typeof DomainResultSchema>;
export const FINDING_IDS = ['STOREY_COUNT', 'BUILDING_HEIGHT', 'STOREY_HEIGHT_DECLARED', 'DECLARED_HEIGHT', 'DECLARED_STOREYS', 'BRIEF_FLOORS', 'GEOMETRY_VERIFICATION',
  'GROSS_VOLUME', 'AREA_BASIS', 'BASE_MINIMUM_WIDTH', 'HEIGHT_TO_BASE_WIDTH'] as const;
export const FindingSchema = z.object({ findingId: z.enum(FINDING_IDS), domain: DomainSchema, status: z.enum(['PASS', 'FAIL', 'WARNING', 'NOT_EVALUATED', 'INFO']),
  entityIds: z.array(entityId).max(16), measured: z.string().max(80).nullable(), required: z.string().max(80).nullable(), detail: z.string().max(400) }).strict();
export type Finding = z.infer<typeof FindingSchema>;
const decimal4 = z.object({ decimal: z.string().regex(/^\d+\.\d{4}$/), rounding: z.enum(['HALF_UP_4', 'FLOOR_4']) }).strict();
export const StoreySchema = z.object({ levelId: entityId, index: z.number().int(), elevationMm: z.number().int(), storeyHeightMm: z.number().int().positive().nullable(),
  storeyHeightBasis: z.enum(['DECLARED_FLOOR_TO_FLOOR', 'NEXT_STOREY_ELEVATION', 'ROOF_LEVEL_ELEVATION', 'NOT_DETERMINED']), grossPlateAreaMm2: area,
  plateMethod: z.enum(['RECTILINEAR_SLAB_UNION', 'LEVEL_BOUNDARY_FALLBACK', 'LEVEL_BOUNDARY_NO_FLOOR_SLABS']) }).strict();
export const HeightSchema = z.object({ basis: z.literal('MODEL_LEVELS_ABOVE_LOWEST_STOREY_FLOOR'), storeyCount: z.number().int().min(0),
  lowestStoreyElevationMm: z.number().int().nullable(), topOfUppermostStoreyMm: z.number().int().nullable(), heightMm: z.number().int().positive().nullable(),
  storeyHeights: z.object({ minMm: z.number().int().nullable(), maxMm: z.number().int().nullable(), distinctMm: z.array(z.number().int()).max(256) }).strict(),
  storeys: z.array(StoreySchema).max(256), statutoryHeight: z.literal('NOT_EVALUATED') }).strict();
export const AreasSchema = z.object({ grossFloorAreaMm2: area, grossFloorAreaM2: z.string(), plotAreaMm2: area.nullable(), netSpaceAreaMm2: area,
  far: decimal4.extend({ numerator: integerString, denominator: integerString }).nullable(), coverageRatio: decimal4.extend({ numerator: integerString, denominator: integerString }).nullable(),
  grossVolumeMm3: z.string().regex(/^\d+(\.5)?$/).nullable(), grossVolumeM3: z.string().nullable(), formulas: z.record(z.string().max(300)) }).strict();
export const BaseGeometrySchema = z.object({ levelId: entityId.nullable(), hullVertices: z.number().int().min(0), minimumWidthMm: z.number().int().min(0).nullable(),
  heightToMinimumWidth: decimal4.nullable(), formula: z.string().max(300) }).strict();
export const EvidenceSchema = z.object({ kind: z.enum(EVIDENCE_KINDS), referenceId: uuid.nullable(), citation: z.string().nullable(),
  reference: z.object({ purpose: z.string(), mediaType: z.string(), storedSha256: hash, boundRevisionId: uuid.nullable() }).strict().nullable(),
  verification: z.literal('USER_DECLARED'), contentInterpreted: z.literal(false) }).strict();

const RateSourceOutSchema = z.object({ kind: z.enum(RATE_SOURCE_KINDS), title: z.string(), issuer: z.string().nullable(), reference: z.string().nullable(),
  jurisdiction: country.nullable(), effectiveDate: z.string().nullable(), retrievedOn: z.string().nullable(),
  evidenceClass: z.enum(['USER_ASSERTED_OFFICIAL_SCHEDULE', 'CONTRACTOR_QUOTATION', 'USER_SUPPLIED', 'NON_AUTHORITATIVE_BENCHMARK', 'SYNTHETIC']),
  verification: z.literal('NOT_VERIFIED_BY_BACKEND') }).strict();
export const CostLineSchema = z.object({ code, label: z.string(), scope: z.union([CostScopeSchema, z.literal('WHOLE_BUILDING')]), basis: z.string(), unit: z.string(),
  quantity: z.string().nullable(), quantityExact: exact.nullable(), rate: decimalParameter, amount: money.nullable(), amountExact: exact.nullable(),
  status: z.enum(['PRICED', 'REJECTED']), reason: z.string().max(60).nullable(), includes: CostComponentSchema.shape.includes, source: RateSourceOutSchema }).strict();
export const CostReportSchema = z.object({ costVersion: z.literal(FORMULAS.cost), estimateClass: z.literal('CONCEPTUAL_PARAMETRIC'), currency: CurrencySchema,
  priceBasisDate: z.string().nullable(), status: z.enum(['COMPLETE', 'PARTIAL', 'BLOCKED']), blockedReasons: z.array(z.string().max(60)).max(16),
  lines: z.array(CostLineSchema).max(ASSESSMENT_LIMITS.costComponents), baseSubtotal: money.nullable(),
  adjustments: z.array(z.object({ code, label: z.string(), category: z.enum(ADJUSTMENT_CATEGORIES), kind: z.enum(['PERCENT', 'FIXED']), direction: z.enum(['ADD', 'DEDUCT']),
    basis: z.enum(['BASE', 'RUNNING']), value: decimalParameter, basisAmount: money, amount: money, amountExact: exact, source: RateSourceOutSchema }).strict()).max(ASSESSMENT_LIMITS.costAdjustments),
  pricedTotal: money.nullable(), completeTotal: money.nullable(),
  taxBasis: z.enum(['INCLUSIVE_OF_GST', 'EXCLUSIVE_OF_GST', 'GST_ADDED_BY_ADJUSTMENT', 'MIXED_OR_UNKNOWN']),
  scopes: z.array(z.object({ scope: CostScopeSchema, status: z.enum(['PRICED', 'UNPRICED', 'EXCLUDED_BY_USER']), lineCodes: z.array(code), reason: z.string().nullable() }).strict()),
  evidenceClasses: z.array(z.string()),
  // Bound: ≤ 5 per component (jurisdiction, date, evidence class, area basis, rejection), ≤ 2 per adjustment (jurisdiction, date), ≤ 13 estimate-level.
  warnings: z.array(z.object({ code: z.string().max(60), ref: z.string().max(70).nullable() }).strict())
    .max(ASSESSMENT_LIMITS.costComponents * 5 + ASSESSMENT_LIMITS.costAdjustments * 2 + 16),
  assumptions: z.array(z.string().max(300)), claims: z.object(Object.fromEntries(Object.keys(NOT_CLAIMED_COST).map(k => [k, z.literal('NOT_CLAIMED')])) as
    Record<keyof typeof NOT_CLAIMED_COST, z.ZodLiteral<'NOT_CLAIMED'>>).strict() }).strict();
export type CostReport = z.infer<typeof CostReportSchema>;

export const AssessmentReportSchema = z.object({
  assessmentVersion: z.literal(ASSESSMENT_VERSION), projectId: uuid, revisionId: uuid, modelHash: hash, inputHash: hash, resultHash: hash, generatedAt: z.string(),
  engine: z.object({ assessmentVersion: z.literal(ASSESSMENT_VERSION), verifierVersion: z.string(), sourceRegistryVersion: z.literal(SOURCE_REGISTRY_VERSION),
    formulas: z.object({ height: z.literal(FORMULAS.height), areaVolume: z.literal(FORMULAS.areaVolume), baseWidth: z.literal(FORMULAS.baseWidth), cost: z.literal(FORMULAS.cost) }).strict() }).strict(),
  context: z.object({ briefVersion: z.number().int().min(0), briefHash: hash.nullable(), briefFloors: z.number().int().nullable(), jurisdiction: JurisdictionSchema.nullable(),
    occupancy: z.enum(OCCUPANCIES).nullable(), structuralSystem: z.object({ primaryMaterial: z.enum(STRUCTURAL_MATERIALS), description: z.string().nullable() }).strict().nullable(),
    provenance: z.literal('USER_DECLARED_NOT_VERIFIED') }).strict(),
  consistency: z.enum(['CONSISTENT', 'PARTIAL', 'INCONSISTENT']),
  height: HeightSchema, areas: AreasSchema, baseGeometry: BaseGeometrySchema,
  verification: z.object({ verifierVersion: z.string(), status: z.string(), inputHash: hash, summary: z.record(z.number().int()), route: z.string() }).strict(),
  findings: z.array(FindingSchema).max(64), domains: z.array(DomainResultSchema).max(DOMAINS.length),
  summary: z.object(Object.fromEntries(DOMAIN_STATUSES.map(s => [s, z.number().int().min(0)])) as Record<typeof DOMAIN_STATUSES[number], z.ZodNumber>).strict(),
  requirements: z.array(z.object({ inputPath: z.string().max(100), detail: z.string().max(400), neededFor: z.array(DomainSchema) }).strict()).max(64),
  sources: z.array(SourceReferenceSchema).max(16), evidence: z.array(EvidenceSchema).max(ASSESSMENT_LIMITS.evidence), cost: CostReportSchema.nullable(),
  limitations: z.array(z.string().max(400)).max(16),
  claims: z.object(Object.fromEntries(Object.keys(NOT_CLAIMED_ENGINEERING).map(k => [k, z.literal('NOT_CLAIMED')])) as
    Record<keyof typeof NOT_CLAIMED_ENGINEERING, z.ZodLiteral<'NOT_CLAIMED'>>).strict(),
}).strict();
export type AssessmentReport = z.infer<typeof AssessmentReportSchema>;
