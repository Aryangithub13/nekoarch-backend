import { z } from 'zod';
import { AiFailureSchema } from './ai-orchestration.js';
import { ReferenceMediaTypeSchema, ReferencePurposeSchema } from '../references/contracts.js';
import { FacadeSchema, PresetIdSchema, PreflightRequestSchema } from '../revision/contracts.js';

/**
 * Phase 39: advisory interior and exterior design concepts with bounded generative alternatives. A concept is structured text and visual-preset
 * choices bound to one revision and to the brief and reference metadata it consumed. It is never geometry, a dimension, a quantity, a cost or
 * an engineering statement, it changes nothing, and every assurance claim is fixed to NOT_CLAIMED.
 */
export const DESIGN_CONCEPT_VERSION = 'design-concept-set-v1';
export const DESIGN_TEMPLATE_VERSION = 'design-concept-templates-v1';
export const DESIGN_GUARD_VERSION = 'design-concept-guard-v1';
export const DESIGN_LIMITS = Object.freeze({ text: 1000, alternatives: 3, spaces: 12, spaceNotes: 8, references: 8, variation: 99,
  providerSetsPerOwnerPerDay: 50, outputBytes: 16_384, maxOutputTokens: 4096, timeoutMs: 15_000 });
export const DESIGN_CLAIMS = Object.freeze({ dimensionalAccuracy: 'NOT_CLAIMED', engineeringValidity: 'NOT_CLAIMED', structuralSafety: 'NOT_CLAIMED',
  codeCompliance: 'NOT_CLAIMED', costAccuracy: 'NOT_CLAIMED', constructionReadiness: 'NOT_CLAIMED', professionalCertification: 'NOT_CLAIMED' } as const);
/** Brief fields a concept may consume; anything else in the brief is withheld (BRIEF_WITHHELD). */
export const BRIEF_FIELDS = ['summary', 'style.keywords', 'constraints', 'program.notes', 'site.orientationNote'] as const;
export const BRIEF_WITHHELD = Object.freeze([
  { field: 'site.address', reason: 'PERSONAL_DATA' },
  { field: 'site.plot', reason: 'DIMENSIONS_NOT_RESTATED' },
  { field: 'program.counts', reason: 'QUANTITIES_NOT_RESTATED' },
  { field: 'budget', reason: 'NO_COST_ADVICE' },
] as const);
export const BriefFieldSchema = z.enum(BRIEF_FIELDS);
export type BriefField = z.infer<typeof BriefFieldSchema>;

const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), timestamp = z.string();
const entityId = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
// Caller text is data only: NFKC, control and format characters removed, whitespace collapsed, bounded after normalization.
const userText = (max: number) => z.string().max(max * 4).transform(s => s.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1).max(max));
// Provider text: bounded, no markup and no control or format characters. It is refused, never repaired.
const conceptText = (max: number) => z.string().min(1).max(max).regex(/^[^<>\p{Cc}\p{Cf}]*$/u);
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/).transform(s => s.toLowerCase());

export const DesignScopeSchema = z.enum(['INTERIOR', 'EXTERIOR']);
export type DesignScope = z.infer<typeof DesignScopeSchema>;
export const GeneratorSchema = z.enum(['AUTO', 'PROVIDER', 'TEMPLATE']);
const sortedUnique = <T extends string>(a: T[]) => [...new Set(a)].sort();
export const DesignConceptRequestSchema = z.object({
  scope: DesignScopeSchema,
  text: userText(DESIGN_LIMITS.text).optional(),
  alternatives: z.number().int().min(1).max(DESIGN_LIMITS.alternatives).default(2),
  spaceIds: z.array(entityId).min(1).max(DESIGN_LIMITS.spaces).transform(sortedUnique).optional(),
  useBrief: z.boolean().default(true),
  referenceIds: z.array(uuid).max(DESIGN_LIMITS.references).transform(sortedUnique).default([]),
  generator: GeneratorSchema.default('AUTO'),
  variation: z.number().int().min(0).max(DESIGN_LIMITS.variation).default(0),
}).strict().superRefine((r, ctx) => { if (r.scope === 'EXTERIOR' && r.spaceIds) ctx.addIssue({ code: 'custom', path: ['spaceIds'], message: 'spaceIds apply to INTERIOR concepts only' }); });
export type DesignConceptRequest = z.infer<typeof DesignConceptRequestSchema>;
/** The normalized request as stored and hashed (defaults applied; text and spaceIds null when absent). */
export const NormalizedRequestSchema = z.object({ scope: DesignScopeSchema, text: z.string().max(DESIGN_LIMITS.text).nullable(),
  alternatives: z.number().int().min(1).max(DESIGN_LIMITS.alternatives), spaceIds: z.array(entityId).max(DESIGN_LIMITS.spaces).nullable(), useBrief: z.boolean(),
  referenceIds: z.array(uuid).max(DESIGN_LIMITS.references), generator: GeneratorSchema, variation: z.number().int().min(0).max(DESIGN_LIMITS.variation) }).strict();
export type NormalizedRequest = z.infer<typeof NormalizedRequestSchema>;

const PaletteSchema = z.array(z.object({ role: z.enum(['BASE', 'SECONDARY', 'ACCENT', 'NEUTRAL']), hex, name: conceptText(40) }).strict()).min(2).max(6);
const BasisSchema = z.object({ briefFields: z.array(BriefFieldSchema).max(BRIEF_FIELDS.length), referenceIds: z.array(uuid).max(DESIGN_LIMITS.references) }).strict();
const common = { title: conceptText(80), summary: conceptText(300), styleKeywords: z.array(conceptText(30)).max(6), palette: PaletteSchema, basis: BasisSchema };
/** What a provider may return: closed schemas, no numeric field anywhere, ids only from what it was given (checked by the guard). */
export const InteriorOutputSchema = z.object({ ...common, finishes: z.object({ floor: conceptText(120), walls: conceptText(120), ceiling: conceptText(120) }).strict(),
  lighting: conceptText(240), spaces: z.array(z.object({ spaceId: entityId, note: conceptText(160) }).strict()).max(DESIGN_LIMITS.spaceNotes) }).strict();
export const ExteriorOutputSchema = z.object({ ...common, facadePresetId: PresetIdSchema, facades: z.array(FacadeSchema).min(1).max(4),
  facadeRationale: conceptText(240), landscapeNote: conceptText(240) }).strict();
export const InteriorProviderOutputSchema = z.object({ alternatives: z.array(InteriorOutputSchema).min(1).max(DESIGN_LIMITS.alternatives) }).strict();
export const ExteriorProviderOutputSchema = z.object({ alternatives: z.array(ExteriorOutputSchema).min(1).max(DESIGN_LIMITS.alternatives) }).strict();
export type InteriorOutput = z.infer<typeof InteriorOutputSchema>;
export type ExteriorOutput = z.infer<typeof ExteriorOutputSchema>;

const alternativeId = z.enum(['alt-1', 'alt-2', 'alt-3']);
export const InteriorAlternativeSchema = InteriorOutputSchema.omit({ spaces: true }).extend({ alternativeId, scope: z.literal('INTERIOR'),
  spaces: z.array(z.object({ spaceId: entityId, spaceName: z.string().max(80), levelId: entityId, note: conceptText(160) }).strict()).max(DESIGN_LIMITS.spaceNotes) }).strict();
export const ExteriorAlternativeSchema = ExteriorOutputSchema.omit({ facadePresetId: true, facades: true, facadeRationale: true }).extend({ alternativeId, scope: z.literal('EXTERIOR'),
  facadeFinish: z.object({ presetId: PresetIdSchema, presetLabel: z.string().max(100), facades: z.array(FacadeSchema).min(1).max(4), rationale: conceptText(240),
    appearanceOnly: z.literal(true) }).strict(),
  // Built by the backend, validated by Phase 30's own schema, and never executed here.
  proposedOperation: z.object({ status: z.literal('NOT_EXECUTED'), submitTo: z.literal('/api/projects/:projectId/revision-operations'),
    request: PreflightRequestSchema, note: z.string().max(300) }).strict() }).strict();
export const DesignAlternativeSchema = z.discriminatedUnion('scope', [InteriorAlternativeSchema, ExteriorAlternativeSchema]);
export type DesignAlternative = z.infer<typeof DesignAlternativeSchema>;

const usage = z.object({ inputTokens: z.number().int().min(0).nullable(), outputTokens: z.number().int().min(0).nullable(), totalTokens: z.number().int().min(0).nullable(),
  estimatedCostMicroUsd: z.number().int().min(0).nullable() }).strict();
export const DesignAttemptSchema = z.object({ providerId: z.string().max(64), modelId: z.string().max(100), attempt: z.number().int().min(0).max(6),
  routingReason: z.enum(['PREFERRED', 'SECONDARY']), fallbackPosition: z.number().int().min(0).max(16), latencyMs: z.number().int().min(0),
  status: z.enum(['SUCCESS', 'FAILED', 'SKIPPED']), failure: AiFailureSchema.nullable(), usage: usage.nullable() }).strict();
export const DesignProvenanceSchema = z.object({
  generator: GeneratorSchema, status: z.enum(['SUCCESS', 'FALLBACK', 'TEMPLATE']), capability: z.enum(['INTERIOR_DESIGN_CONCEPT', 'EXTERIOR_DESIGN_CONCEPT']),
  requestId: uuid.nullable(), providerId: z.string().max(64).nullable(), modelId: z.string().max(100).nullable(),
  routingReason: z.enum(['PREFERRED', 'SECONDARY']).nullable(), fallbackPosition: z.number().int().min(0).max(16).nullable(),
  fallbackReason: z.enum(['NO_ELIGIBLE_PROVIDER', 'ALL_PROVIDERS_FAILED', 'PROVIDER_QUOTA_EXHAUSTED']).nullable(),
  failures: z.array(AiFailureSchema).max(16), requests: z.number().int().min(0).max(6), attempts: z.array(DesignAttemptSchema).max(22), usage: usage.nullable(),
  templateVersion: z.literal(DESIGN_TEMPLATE_VERSION).nullable(), guardVersion: z.literal(DESIGN_GUARD_VERSION),
}).strict();

const ReferenceInputSchema = z.object({ referenceId: uuid, purpose: ReferencePurposeSchema, displayName: z.string().max(120).nullable(), mediaType: ReferenceMediaTypeSchema,
  storedSha256: hash, contentUsed: z.literal('METADATA_ONLY') }).strict();
export const InputIdentitySchema = z.object({ version: z.literal(DESIGN_CONCEPT_VERSION), revisionId: uuid, modelHash: hash, request: NormalizedRequestSchema,
  briefHash: hash.nullable(), references: z.array(z.object({ referenceId: uuid, storedSha256: hash }).strict()).max(DESIGN_LIMITS.references) }).strict();
export const DesignConceptSetSchema = z.object({
  conceptSetVersion: z.literal(DESIGN_CONCEPT_VERSION), scope: DesignScopeSchema,
  binding: z.object({ projectId: uuid, revisionId: uuid, revisionNumber: z.number().int().positive(), modelHash: hash, acceptanceQaId: uuid,
    qaStatus: z.enum(['PASS', 'PASS_WITH_WARNINGS']) }).strict(),
  request: NormalizedRequestSchema,
  inputs: z.object({
    context: z.object({ contextVersion: z.string().max(40), contextHash: hash }).strict(),
    brief: z.object({ version: z.number().int().positive(), briefHash: hash, provenance: z.literal('USER_STATED_NOT_VERIFIED'), fieldsUsed: z.array(BriefFieldSchema).max(BRIEF_FIELDS.length),
      fieldsWithheld: z.array(z.object({ field: z.string().max(40), reason: z.string().max(40) }).strict()).max(8) }).strict().nullable(),
    references: z.array(ReferenceInputSchema).max(DESIGN_LIMITS.references),
    spaces: z.array(z.object({ spaceId: entityId, name: z.string().max(80), classification: z.string().max(80), levelId: entityId }).strict()).max(DESIGN_LIMITS.spaces),
    identity: InputIdentitySchema,
  }).strict(),
  source: z.enum(['PROVIDER', 'DETERMINISTIC_TEMPLATE']),
  alternatives: z.array(DesignAlternativeSchema).min(1).max(DESIGN_LIMITS.alternatives),
  provenance: DesignProvenanceSchema,
  assurance: z.object({ status: z.literal('ADVISORY_UNVERIFIED'), note: z.string().max(400) }).strict(),
  claims: z.object(Object.fromEntries(Object.keys(DESIGN_CLAIMS).map(k => [k, z.literal('NOT_CLAIMED')])) as Record<keyof typeof DESIGN_CLAIMS, z.ZodLiteral<'NOT_CLAIMED'>>).strict(),
  limitations: z.array(z.string().max(300)).max(12),
  inputHash: hash, contentHash: hash,
}).strict();
export type DesignConceptSet = z.infer<typeof DesignConceptSetSchema>;

export const DesignConceptSummarySchema = z.object({ id: uuid, projectRevisionId: uuid, scope: DesignScopeSchema, conceptSetVersion: z.literal(DESIGN_CONCEPT_VERSION),
  source: z.enum(['PROVIDER', 'DETERMINISTIC_TEMPLATE']), providerId: z.string().max(64).nullable(), modelId: z.string().max(100).nullable(),
  alternativeCount: z.number().int().min(1).max(DESIGN_LIMITS.alternatives), modelHash: hash, inputHash: hash, contentHash: hash, createdAt: timestamp }).strict();
const CurrencySchema = z.object({ status: z.enum(['CURRENT', 'HISTORICAL']), conceptRevisionId: uuid, projectCurrentRevisionId: uuid.nullable() }).strict();
export const DesignConceptDetailSchema = DesignConceptSummarySchema.extend({ conceptSet: DesignConceptSetSchema, currency: CurrencySchema, replayed: z.boolean() }).strict();
export const DesignConceptListSchema = z.object({ items: z.array(DesignConceptSummarySchema.extend({ currency: CurrencySchema }).strict()).max(100),
  nextCursor: z.string().nullable() }).strict();
export const DesignConceptCursorSchema = z.object({ createdAt: timestamp, id: uuid }).strict();
export const DesignConceptPageQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().min(1).max(512).optional() }).strict();
export const DesignConceptReadQuerySchema = z.object({ require: z.literal('current').optional() }).strict();
export const DesignConceptParamsSchema = z.object({ projectId: uuid, revisionId: uuid, conceptSetId: uuid }).strict();
