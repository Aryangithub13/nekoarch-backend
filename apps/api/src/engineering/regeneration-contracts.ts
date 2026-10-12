import { z } from 'zod';
import { ArchitecturalBuildingModelV2Schema } from '@designflow/shared';
import { DIFF_COLLECTIONS } from '../verification/contracts.js';
import { CurrencySchema, DeclarationSchema, FACADES, PreflightTargetSchema, SourceRevisionSchema, ZONE_LIMITS, ZoneBlockerSchema, ZoneDeclarationsSchema,
  ZoneKeySchema } from './zone-contracts.js';

// Normative specification: docs/phase35-1/regeneration-and-partitions.md. Literals change only with semantics.
export const REGENERATION_VERSION = 'zone-regeneration-v1';
export const REGENERATION_VERIFICATION_VERSION = 'zone-regeneration-verification-v1';
/** Operation algorithms; a change to what an operation produces for the same input changes its literal. */
export const OPERATION_VERSIONS = Object.freeze({ TYPICAL_FLOOR: 'typical-floor-v1', FENESTRATION: 'fenestration-v1' } as const);
export const REGENERATION_LIMITS = Object.freeze({ bodyBytes: 32_768, listed: 16, qaFindings: 20 });

const hash = z.string().regex(/^[a-f0-9]{64}$/), uuid = z.string().uuid(), entityId = z.string().min(1).max(200);
const mm = (min: number, max: number) => z.number().int().min(min).max(max);

// ---------------------------------------------------------------- requests
/** Window layout rule for FENESTRATION. Integer millimetres; the layout is deterministic for (model, rule). */
export const WindowRuleSchema = z.object({
  widthMm: mm(300, 10_000), heightMm: mm(300, 10_000), sillMm: mm(0, 10_000),
  /** Minimum clear distance between two windows, and between a window and a kept door or opening on the same wall. */
  gapMm: mm(100, 100_000),
  /** Minimum clear distance from a wall end, and from the face of any wall meeting or crossing this one. */
  edgeClearanceMm: mm(0, 100_000),
  type: z.string().trim().min(1).max(200).default('window'),
}).strict();
export type WindowRule = z.infer<typeof WindowRuleSchema>;
export const RegenerationOperationSchema = z.discriminatedUnion('kind', [
  /** Replace every target storey's layout (spaces, walls, openings, storey dimensions) with a copy of one template storey's layout. */
  z.object({ kind: z.literal('TYPICAL_FLOOR'), templateLevelId: entityId }).strict(),
  /** Replace the windows of the target zone's exterior walls on the requested façades with a regenerated layout. */
  z.object({ kind: z.literal('FENESTRATION'), window: WindowRuleSchema }).strict(),
]);
export type RegenerationOperation = z.infer<typeof RegenerationOperationSchema>;
export const RegenerationRequestSchema = z.object({ zones: ZoneDeclarationsSchema.optional(), target: PreflightTargetSchema, operation: RegenerationOperationSchema }).strict()
  .superRefine((r, ctx) => {
    const skin = r.target.kind === 'EXTERIOR_SKIN';
    if (skin !== (r.operation.kind === 'FENESTRATION'))
      ctx.addIssue({ code: 'custom', path: ['operation', 'kind'], message: 'FENESTRATION applies to an EXTERIOR_SKIN target; TYPICAL_FLOOR applies to a ZONE or SECTION target' });
  });
export type RegenerationRequest = z.infer<typeof RegenerationRequestSchema>;

// ---------------------------------------------------------------- report parts
export const NOT_CLAIMED_REGENERATION = Object.freeze({ revisionCreated: 'NOT_CLAIMED', engineeringValidity: 'NOT_CLAIMED', codeCompliance: 'NOT_CLAIMED',
  designSuitability: 'NOT_CLAIMED' } as const);
const notClaimed = <T extends Record<string, string>>(o: T) => z.object(Object.fromEntries(Object.keys(o).map(k => [k, z.literal('NOT_CLAIMED')])) as
  Record<keyof T, z.ZodLiteral<'NOT_CLAIMED'>>).strict();
const counts = z.object({ spaces: z.number().int().min(0), walls: z.number().int().min(0), openings: z.number().int().min(0), dimensions: z.number().int().min(0) }).strict();
const qaSummary = z.object({ status: z.enum(['PASS', 'PASS_WITH_WARNINGS', 'FAIL']), errors: z.number().int().min(0), warnings: z.number().int().min(0),
  findings: z.array(z.object({ code: z.string().max(100), severity: z.enum(['ERROR', 'WARNING', 'INFO']), entityIds: z.array(z.string().max(200)).max(5) }).strict())
    .max(REGENERATION_LIMITS.qaFindings) }).strict();
export type QaSummary = z.infer<typeof qaSummary>;
/** `document` is any top-level field other than the entity collections, the site and provenance (provenance is outside model identity). */
const entityChange = z.object({ collection: z.enum([...DIFF_COLLECTIONS, 'site', 'document']), entityId: entityId, change: z.enum(['ADDED', 'REMOVED', 'CHANGED']) }).strict();
/** Entity-level comparison of the candidate (or a committed revision) with its base: every entity outside the allowed scope must be identical. */
export const PreservationCheckSchema = z.object({
  status: z.enum(['IDENTICAL', 'WITHIN_SCOPE', 'OUT_OF_SCOPE_CHANGES']),
  basis: z.literal('ENTITY_CANONICAL_HASH'),
  added: z.number().int().min(0), removed: z.number().int().min(0), changed: z.number().int().min(0), outOfScope: z.number().int().min(0),
  violations: z.array(entityChange).max(REGENERATION_LIMITS.listed),
}).strict();
export type PreservationCheck = z.infer<typeof PreservationCheckSchema>;
const preservedItem = z.object({ item: z.string().max(60), count: z.number().int().min(0), detail: z.string().max(300) }).strict();

export const RegenerationTargetSchema = z.object({ kind: z.enum(['ZONE', 'EXTERIOR_SKIN', 'SECTION']), zoneKey: ZoneKeySchema.nullable(), zoneId: hash,
  levelIds: z.array(entityId).max(256), facades: z.array(z.enum(FACADES)).max(4).nullable() }).strict();
const levelChange = z.object({ levelId: entityId, removed: counts, added: counts }).strict();

export const RegenerationReportSchema = z.object({
  regenerationVersion: z.literal(REGENERATION_VERSION), projectId: uuid, revisionId: uuid, modelHash: hash, inputHash: hash, resultHash: hash, generatedAt: z.string(),
  sourceRevision: SourceRevisionSchema, currency: CurrencySchema,
  /** CANDIDATE_READY: a QA-accepted candidate that changes only the allowed scope. NO_CHANGE: the candidate equals the base. REFUSED: see refusals. */
  status: z.enum(['CANDIDATE_READY', 'NO_CHANGE', 'REFUSED']),
  refusals: z.array(ZoneBlockerSchema).max(REGENERATION_LIMITS.listed),
  declaration: DeclarationSchema,
  target: RegenerationTargetSchema,
  operation: z.object({ kind: z.enum(['TYPICAL_FLOOR', 'FENESTRATION']), operationVersion: z.enum([OPERATION_VERSIONS.TYPICAL_FLOOR, OPERATION_VERSIONS.FENESTRATION]),
    templateLevelId: entityId.nullable(), window: WindowRuleSchema.nullable() }).strict(),
  /** Exactly what the operation rewrote, per level; null when it was refused before producing a candidate. */
  changes: z.object({ regeneratedLevelIds: z.array(entityId).max(256), levels: z.array(levelChange).max(256), wallsRegenerated: z.number().int().min(0),
    skipped: z.array(z.object({ entityId, reason: z.string().max(60) }).strict()).max(REGENERATION_LIMITS.listed), skippedCount: z.number().int().min(0) }).strict().nullable(),
  /** What the operation must leave untouched, and the proof that it did: allowed scope, entity-level comparison and zone identity. */
  preservation: z.object({
    allowedChange: z.string().max(400),
    check: PreservationCheckSchema,
    preservedInTarget: z.array(preservedItem).max(16),
    preservedZones: z.array(z.object({ zoneKey: ZoneKeySchema.nullable(), zoneId: hash, levelIds: z.array(entityId).max(256), identical: z.boolean() }).strict()).max(ZONE_LIMITS.zones + 1),
  }).strict().nullable(),
  /** The QA a supplied revision is accepted with (the same function the save route runs). A FAIL refuses the candidate. */
  qa: qaSummary.nullable(),
  candidate: z.object({ modelHash: hash, model: ArchitecturalBuildingModelV2Schema }).strict().nullable(),
  /** How to commit the candidate: the existing supplied-revision route, with this revision as base. Nothing is committed by this request. */
  commit: z.object({ method: z.literal('POST'), route: z.string().max(200), baseRevisionId: uuid, expectedModelHash: hash, detail: z.string().max(400) }).strict().nullable(),
  verificationRoute: z.string().max(200),
  dependencies: z.array(z.object({ artifact: z.string().max(60), impact: z.literal('NOT_APPLICABLE_TO_CANDIDATE'), detail: z.string().max(300) }).strict()).max(16),
  limitations: z.array(z.string().max(400)).max(10), claims: notClaimed(NOT_CLAIMED_REGENERATION),
}).strict();
export type RegenerationReport = z.infer<typeof RegenerationReportSchema>;

/** Verification of a committed revision against the regeneration it claims to be: recomputed from its parent, compared by canonical model hash. */
export const RegenerationVerificationReportSchema = z.object({
  verificationVersion: z.literal(REGENERATION_VERIFICATION_VERSION), projectId: uuid, revisionId: uuid, modelHash: hash, inputHash: hash, resultHash: hash, generatedAt: z.string(),
  status: z.enum(['VERIFIED', 'MISMATCH', 'NOT_REPRODUCIBLE', 'NO_PARENT']),
  detail: z.string().max(400),
  parentRevisionId: uuid.nullable(), parentModelHash: hash.nullable(),
  operation: RegenerationReportSchema.shape.operation,
  target: RegenerationTargetSchema.nullable(),
  /** Status of the regeneration recomputed from the parent; its refusals when it is not reproducible. */
  recomputed: z.object({ status: z.enum(['CANDIDATE_READY', 'NO_CHANGE', 'REFUSED']), modelHash: hash.nullable(), refusals: z.array(ZoneBlockerSchema).max(REGENERATION_LIMITS.listed) }).strict().nullable(),
  /** The committed revision compared with its parent under the operation's allowed scope (independent of the hash comparison). */
  preservation: PreservationCheckSchema.nullable(),
  /** The committed revision compared with the recomputed candidate (empty scope): any difference is listed. */
  deviation: PreservationCheckSchema.nullable(),
  claims: notClaimed(NOT_CLAIMED_REGENERATION),
}).strict();
export type RegenerationVerificationReport = z.infer<typeof RegenerationVerificationReportSchema>;
