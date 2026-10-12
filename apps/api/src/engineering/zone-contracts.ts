import { z } from 'zod';
import { FORMULAS } from './contracts.js';

// Normative specification: docs/phase35-1/phase35-1-design.md. Literals change only with semantics.
export const ZONE_ASSESSMENT_VERSION = 'zone-assessment-v1';
export const ZONE_PREFLIGHT_VERSION = 'zone-regeneration-preflight-v1';
/** Prefix of the zone identity digest: sha256(ZONE_IDENTITY_VERSION + '\n' + ordered storey level ids joined by '\n'). */
export const ZONE_IDENTITY_VERSION = 'zone-identity-v1';
export const ZONE_LIMITS = Object.freeze({ bodyBytes: 32_768, zones: 64, listedElementIds: 16 });
export const FACADES = ['NORTH', 'EAST', 'SOUTH', 'WEST'] as const;

const hash = z.string().regex(/^[a-f0-9]{64}$/), uuid = z.string().uuid(), entityId = z.string().min(1).max(200);
const area = z.string().regex(/^\d+(\.5)?$/);
export const ZoneKeySchema = z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/, 'Zone keys are 1-40 characters: A-Z, 0-9, "_" or "-"');

// ---------------------------------------------------------------- requests
export const ZoneDeclarationSchema = z.object({ key: ZoneKeySchema, fromLevelId: entityId, toLevelId: entityId }).strict();
export type ZoneDeclaration = z.infer<typeof ZoneDeclarationSchema>;
const declarations = z.array(ZoneDeclarationSchema).min(1).max(ZONE_LIMITS.zones).superRefine((zones, ctx) => {
  if (new Set(zones.map(z => z.key)).size !== zones.length) ctx.addIssue({ code: 'custom', message: 'Duplicate zone key' });
});
/** Omitted `zones` means the documented default: one zone, key ALL, from the lowest to the highest storey. */
export const ZoneAssessmentRequestSchema = z.object({ zones: declarations.optional() }).strict();
export type ZoneAssessmentRequest = z.infer<typeof ZoneAssessmentRequestSchema>;

export const PreflightTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ZONE'), zoneKey: ZoneKeySchema }).strict(),
  z.object({ kind: z.literal('EXTERIOR_SKIN'), zoneKey: ZoneKeySchema, facades: z.array(z.enum(FACADES)).min(1).max(4).transform(f => FACADES.filter(x => f.includes(x))).optional() }).strict(),
  z.object({ kind: z.literal('SECTION'), fromLevelId: entityId, toLevelId: entityId }).strict(),
]);
export const ZonePreflightRequestSchema = z.object({ zones: declarations.optional(), target: PreflightTargetSchema }).strict();
export type ZonePreflightRequest = z.infer<typeof ZonePreflightRequestSchema>;

// ---------------------------------------------------------------- shared report parts
export const DECLARATION_ISSUES = ['NO_STOREYS', 'UNKNOWN_LEVEL', 'NOT_A_STOREY', 'REVERSED_RANGE', 'OVERLAP', 'GAP', 'INCOMPLETE_COVERAGE'] as const;
export const DeclarationIssueSchema = z.object({ code: z.enum(DECLARATION_ISSUES), zoneKeys: z.array(ZoneKeySchema).max(2), levelIds: z.array(entityId).max(ZONE_LIMITS.listedElementIds),
  detail: z.string().max(300) }).strict();
export const DeclarationSchema = z.object({ source: z.enum(['DECLARED', 'DEFAULT_SINGLE_ZONE']), status: z.enum(['VALID', 'INVALID']),
  issues: z.array(DeclarationIssueSchema).max(ZONE_LIMITS.zones * 3 + 2) }).strict();
export const ZoneBlockerSchema = z.object({ code: z.string().max(60), detail: z.string().max(300) }).strict();
/** Existing freshness convention (scene artifacts): a derived result is CURRENT only while its source revision is the project's current revision. */
export const CurrencySchema = z.object({ status: z.enum(['CURRENT', 'STALE']), artifactRevisionId: uuid, projectCurrentRevisionId: uuid.nullable() }).strict();
export const SourceRevisionSchema = z.object({ revisionId: uuid, revisionNumber: z.number().int().positive(), parentRevisionId: uuid.nullable(), modelHash: hash }).strict();
const counts = z.object({ spaces: z.number().int().min(0), walls: z.number().int().min(0), exteriorWalls: z.number().int().min(0), openings: z.number().int().min(0),
  slabs: z.number().int().min(0), columns: z.number().int().min(0), stairsWithin: z.number().int().min(0) }).strict();
export type ElementCounts = z.infer<typeof counts>;
const facadeCounts = z.object({ NORTH: z.number().int().min(0), EAST: z.number().int().min(0), SOUTH: z.number().int().min(0), WEST: z.number().int().min(0),
  UNRESOLVED: z.number().int().min(0) }).strict();

export const ZoneResultSchema = z.object({
  key: ZoneKeySchema, zoneId: hash, fromLevelId: entityId, toLevelId: entityId, levelIds: z.array(entityId).max(256), storeyCount: z.number().int().positive(),
  bottomElevationMm: z.number().int(), topMm: z.number().int().nullable(), heightMm: z.number().int().positive().nullable(),
  grossFloorAreaMm2: area, grossVolumeMm3: area.nullable(), elements: counts,
  exteriorSkin: z.object({ basis: z.literal('WALL_CLASSIFICATION'), exteriorWalls: z.number().int().min(0), unclassifiedWalls: z.number().int().min(0),
    byFacade: facadeCounts.nullable(), facadeBasis: z.enum(['SITE_NORTH_ORTHOGONAL', 'NOT_RESOLVED']) }).strict(),
  blockers: z.array(ZoneBlockerSchema).max(8),
}).strict();
export type ZoneResult = z.infer<typeof ZoneResultSchema>;

export const INTERFACE_CHECKS = ['INTERFACE_ELEVATION', 'STAIR_CONNECTION', 'STAIR_SLAB_VOID', 'STAIR_FOOTPRINT_CONTINUITY', 'ENVELOPE_CONTINUITY', 'SHAFT_CONTINUITY'] as const;
export const InterfaceCheckSchema = z.object({ check: z.enum(INTERFACE_CHECKS), status: z.enum(['PASS', 'FAIL', 'WARNING', 'INFO', 'NOT_EVALUATED']),
  entityIds: z.array(entityId).max(ZONE_LIMITS.listedElementIds), measured: z.string().max(80).nullable(), required: z.string().max(80).nullable(),
  blocker: ZoneBlockerSchema.nullable(), detail: z.string().max(400) }).strict();
export type InterfaceCheck = z.infer<typeof InterfaceCheckSchema>;
export const InterfaceSchema = z.object({ lowerZoneKey: ZoneKeySchema, upperZoneKey: ZoneKeySchema, lowerLevelId: entityId, upperLevelId: entityId,
  checks: z.array(InterfaceCheckSchema).length(INTERFACE_CHECKS.length) }).strict();

export const NOT_CLAIMED_ZONES = Object.freeze({ structuralAdequacy: 'NOT_CLAIMED', windOrSeismicPerformance: 'NOT_CLAIMED', fireAndLifeSafety: 'NOT_CLAIMED',
  verticalTransportAdequacy: 'NOT_CLAIMED', codeCompliance: 'NOT_CLAIMED' } as const);
const notClaimed = <T extends Record<string, string>>(o: T) => z.object(Object.fromEntries(Object.keys(o).map(k => [k, z.literal('NOT_CLAIMED')])) as
  Record<keyof T, z.ZodLiteral<'NOT_CLAIMED'>>).strict();

export const ZoneAssessmentReportSchema = z.object({
  zoneAssessmentVersion: z.literal(ZONE_ASSESSMENT_VERSION), projectId: uuid, revisionId: uuid, modelHash: hash, inputHash: hash, resultHash: hash, generatedAt: z.string(),
  engine: z.object({ zoneAssessmentVersion: z.literal(ZONE_ASSESSMENT_VERSION), zoneIdentity: z.literal(ZONE_IDENTITY_VERSION), verifierVersion: z.string(),
    formulas: z.object({ height: z.literal(FORMULAS.height), areaVolume: z.literal(FORMULAS.areaVolume) }).strict() }).strict(),
  sourceRevision: SourceRevisionSchema, currency: CurrencySchema,
  status: z.enum(['CONSISTENT', 'PARTIAL', 'INCONSISTENT', 'INVALID_DECLARATION']),
  declaration: DeclarationSchema, zones: z.array(ZoneResultSchema).max(ZONE_LIMITS.zones), interfaces: z.array(InterfaceSchema).max(ZONE_LIMITS.zones - 1),
  summary: z.object({ PASS: z.number().int().min(0), FAIL: z.number().int().min(0), WARNING: z.number().int().min(0), INFO: z.number().int().min(0),
    NOT_EVALUATED: z.number().int().min(0) }).strict(),
  limitations: z.array(z.string().max(400)).max(8), claims: notClaimed(NOT_CLAIMED_ZONES),
}).strict();
export type ZoneAssessmentReport = z.infer<typeof ZoneAssessmentReportSchema>;

// ---------------------------------------------------------------- regeneration preflight (planning only; never executes)
export const NOT_CLAIMED_PREFLIGHT = Object.freeze({ regenerationPerformed: 'NOT_CLAIMED', revisionCreated: 'NOT_CLAIMED', preservationEnforced: 'NOT_CLAIMED',
  engineeringValidity: 'NOT_CLAIMED' } as const);
/** What an exterior-skin change would have to leave untouched inside its target zone (F7). Counts are exact; ids are the first 16, sorted. */
export const INTERIOR_PRESERVATION_ITEMS = ['SPACES', 'INTERIOR_WALLS', 'UNCLASSIFIED_WALLS', 'INTERIOR_OPENINGS', 'SLABS', 'COLUMNS', 'STAIRS', 'LEVELS', 'DIMENSIONS',
  'EXTERIOR_WALLS_ON_OTHER_FACADES'] as const;
const preservedItem = z.object({ item: z.enum(INTERIOR_PRESERVATION_ITEMS), count: z.number().int().min(0), entityIds: z.array(entityId).max(ZONE_LIMITS.listedElementIds),
  detail: z.string().max(300) }).strict();
export const ZonePreflightReportSchema = z.object({
  preflightVersion: z.literal(ZONE_PREFLIGHT_VERSION), projectId: uuid, revisionId: uuid, modelHash: hash, inputHash: hash, resultHash: hash, generatedAt: z.string(),
  sourceRevision: SourceRevisionSchema, currency: CurrencySchema,
  status: z.literal('UNSUPPORTED'),
  refusal: z.object({ code: z.enum(['ZONE_GEOMETRY_REGENERATION_UNSUPPORTED', 'SECTION_GEOMETRY_REGENERATION_UNSUPPORTED', 'EXTERIOR_SKIN_GEOMETRY_REGENERATION_UNSUPPORTED']),
    detail: z.string().max(400) }).strict(),
  declaration: DeclarationSchema,
  target: z.object({ kind: z.enum(['ZONE', 'EXTERIOR_SKIN', 'SECTION']), zoneKey: ZoneKeySchema.nullable(), zoneId: hash, levelIds: z.array(entityId).max(256),
    facades: z.array(z.enum(FACADES)).max(4).nullable(), elements: counts, exteriorWallsInScope: z.number().int().min(0).nullable() }).strict(),
  preservation: z.object({
    status: z.literal('PLANNED_NOT_ENFORCED'),
    preservedZones: z.array(z.object({ zoneKey: ZoneKeySchema.nullable(), zoneId: hash, levelIds: z.array(entityId).max(256), elements: counts }).strict()).max(ZONE_LIMITS.zones + 1),
    crossBoundaryStairs: z.array(z.object({ stairId: entityId, fromLevelId: entityId, toLevelId: entityId }).strict()).max(ZONE_LIMITS.listedElementIds),
    crossBoundaryStairCount: z.number().int().min(0),
    represented: z.array(z.string().max(60)).max(16), notRepresented: z.array(z.object({ item: z.string().max(60), detail: z.string().max(300) }).strict()).max(16),
    /** EXTERIOR_SKIN targets only (null otherwise): the target zone's interior and every other part of it outside the requested skin. */
    targetInterior: z.object({ zoneKey: ZoneKeySchema, zoneId: hash, levelIds: z.array(entityId).max(256),
      items: z.array(preservedItem).max(INTERIOR_PRESERVATION_ITEMS.length) }).strict().nullable(),
  }).strict(),
  dependencies: z.array(z.object({ artifact: z.string().max(60), impact: z.literal('WOULD_REQUIRE_RECOMPUTATION'), detail: z.string().max(300) }).strict()).max(16),
  missingCapabilities: z.array(ZoneBlockerSchema).max(8),
  alternatives: z.array(z.object({ operation: z.string().max(60), eligibility: z.enum(['PRELIMINARY_ELIGIBLE', 'REFUSED']), route: z.string().max(200), detail: z.string().max(300) }).strict()).max(4),
  roadmapDestination: z.object({ phase: z.null(), status: z.literal('OWNER_DECISION_REQUIRED'), detail: z.string().max(400) }).strict(),
  claims: notClaimed(NOT_CLAIMED_PREFLIGHT),
}).strict();
export type ZonePreflightReport = z.infer<typeof ZonePreflightReportSchema>;
