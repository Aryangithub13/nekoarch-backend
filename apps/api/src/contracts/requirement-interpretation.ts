import { z } from 'zod';
import { BlueprintRequirementsSchema } from '@designflow/generator';

export const INTERPRETER_VERSION = 'architectural-interpreter-v1';
export const INTERPRETATION_LIMITS = Object.freeze({ text: 4000, bodyBytes: 24_576, responseBytes: 16_384, answers: 8 });
export const UnitSchema = z.enum(['mm', 'cm', 'm', 'ft', 'in']);
const decimal = z.string().max(24).regex(/^[+-]?\d{1,8}(?:\.\d{1,6})?$/);
const dimensions = z.object({ width: decimal, depth: decimal, unit: UnitSchema.optional(), depthUnit: UnitSchema.optional() }).strict();
const count = z.number().int().min(0).max(99);
export const IntentFieldSchema = z.enum(['site', 'floors', 'bedrooms', 'groundFloorBedrooms', 'upperFloorBedrooms', 'bathrooms', 'living', 'kitchen', 'dining', 'study', 'parking', 'seed', 'kitchenMinWidthMm', 'kitchenMinDepthMm']);
export const UnsupportedFeatureSchema = z.enum(['parking', 'daylight', 'ventilation', 'spiral_staircase', 'curved_roof', 'irregular_site', 'orientation', 'engineering_compliance', 'unrecognized_language', 'unsupported_constraint']);
export const IntentCandidateSchema = z.object({
  site: dimensions.optional(), floors: count.optional(), bedrooms: count.optional(),
  groundFloorBedrooms: count.optional(), upperFloorBedrooms: count.optional(), bathrooms: count.optional(),
  living: count.optional(), dining: count.optional(), study: count.optional(),
  kitchen: z.enum(['open', 'closed', 'unspecified']).optional(),
  kitchenConnection: z.enum(['living', 'dining']).optional(),
  relationshipKind: z.enum(['adjacent', 'connected']).optional(),
  relationshipStrength: z.enum(['hard', 'soft']).optional(),
  parking: count.optional(), seed: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  noStairs: z.boolean().optional(), preserveBedrooms: z.boolean().optional(), kitchenLarger: z.boolean().optional(),
  kitchenMinWidthMm: z.number().int().min(1).max(60000).optional(),
  kitchenMinDepthMm: z.number().int().min(1).max(60000).optional(),
  inferredFields: z.array(IntentFieldSchema).max(16).default([]),
  contradictions: z.array(z.enum(['site', 'bedrooms', 'groundFloorBedrooms', 'upperFloorBedrooms', 'bathrooms', 'living', 'dining', 'study', 'floors', 'kitchen', 'parking', 'room_counts'])).max(12).default([]),
  unsupported: z.array(UnsupportedFeatureSchema).max(12).default([]),
}).strict();
export type IntentCandidate = z.infer<typeof IntentCandidateSchema>;
const answer = z.discriminatedUnion('field', [
  z.object({ field: z.literal('site.dimensions'), value: dimensions.extend({ unit: UnitSchema }) }).strict(),
  z.object({ field: z.literal('site.unit'), value: UnitSchema }).strict(),
  z.object({ field: z.literal('floors'), value: z.union([z.literal(1), z.literal(2)]) }).strict(),
  z.object({ field: z.literal('bedrooms'), value: count.min(1).max(24) }).strict(),
  z.object({ field: z.literal('kitchen.minimumDimensions'), value: z.object({ widthMm: z.number().int().min(1).max(60000), depthMm: z.number().int().min(1).max(60000) }).strict() }).strict(),
]);
const supportedText = (text: string) => [...text].every(character => {
  const code = character.charCodeAt(0);
  return (code >= 32 && code !== 127) || code === 9 || code === 10 || code === 13;
});
export const NaturalLanguageDesignRequestSchema = z.object({
  text: z.string().max(INTERPRETATION_LIMITS.text).transform(s => s.normalize('NFKC').trim()).pipe(z.string().min(1).max(INTERPRETATION_LIMITS.text).refine(supportedText, 'Unsupported control characters')),
  locale: z.enum(['en', 'en-IN', 'hi', 'hi-IN', 'hi-Latn']).optional(),
  unitsHint: z.union([z.literal('AUTO'), UnitSchema]).default('AUTO'),
  baseRevisionId: z.string().uuid().nullable().default(null),
  clarification: z.object({ previousInterpretationId: z.string().uuid(), answers: z.array(answer).min(1).max(INTERPRETATION_LIMITS.answers)
    .refine(a => new Set(a.map(v => v.field)).size === a.length, 'Duplicate clarification answers') }).strict().optional(),
}).strict();
export type NaturalLanguageDesignRequest = z.infer<typeof NaturalLanguageDesignRequestSchema>;
export const ProviderFailureCodeSchema = z.enum(['AI_PROVIDER_UNAVAILABLE', 'AI_PROVIDER_TIMEOUT', 'AI_PROVIDER_RATE_LIMITED', 'AI_PROVIDER_AUTHENTICATION_FAILED', 'AI_PROVIDER_INVALID_RESPONSE', 'AI_PROVIDER_REFUSED', 'AI_PROVIDER_NETWORK_ERROR', 'AI_CONFIGURATION_UNAVAILABLE']);
export type ProviderFailureCode = z.infer<typeof ProviderFailureCodeSchema>;
const provenanceEntry = z.object({ field: z.string().max(100), source: z.enum(['USER_EXPLICIT', 'USER_INFERRED', 'PRODUCT_DEFAULT', 'UNRESOLVED']), reason: z.string().max(240) }).strict();
export const InterpretationResultSchema = z.object({
  interpretationId: z.string().uuid(), interpreterVersion: z.literal(INTERPRETER_VERSION),
  provider: z.string().regex(/^[a-z0-9-]{1,64}$/), providerModel: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
  inputLanguage: z.enum(['en', 'hi-Latn', 'und']), status: z.enum(['READY', 'NEEDS_CLARIFICATION', 'UNSUPPORTED', 'FAILED']),
  baseRevisionId: z.string().uuid().nullable(), candidate: IntentCandidateSchema.nullable(),
  structuredRequirements: BlueprintRequirementsSchema.nullable(),
  assumptions: z.array(provenanceEntry).max(64),
  unresolvedQuestions: z.array(z.object({ questionId: z.string().max(100), field: z.string().max(100), question: z.string().max(240), required: z.literal(true), acceptedAnswerTypes: z.array(z.enum(['DIMENSIONS', 'UNIT', 'INTEGER', 'REVISED_BRIEF', 'BASE_REVISION'])).min(1).max(2) }).strict()).max(24),
  warnings: z.array(z.string().max(240)).max(24),
  unsupportedRequirements: z.array(z.object({ code: z.literal('UNSUPPORTED_REQUIREMENT'), feature: UnsupportedFeatureSchema,
    priority: z.enum(['HARD_CONSTRAINT', 'SOFT_PREFERENCE']), disposition: z.enum(['BLOCKING', 'DEFERRED']), appliedToGeometry: z.literal(false) }).strict()).max(12),
  error: z.object({ code: ProviderFailureCodeSchema, message: z.string().max(240) }).strict().nullable(),
  provenance: z.object({ schemaVersion: z.literal(INTERPRETER_VERSION), normalizationVersion: z.literal(INTERPRETER_VERSION), createdAt: z.string().datetime(), fields: z.array(provenanceEntry).max(96),
    previousInterpretationId: z.string().uuid().nullable(), validation: z.enum(['PASSED', 'CLARIFICATION', 'UNSUPPORTED', 'FAILED']), path: z.enum(['fallback', 'provider']) }).strict(),
}).strict().superRefine((r, ctx) => {
  if ((r.status === 'READY') !== (r.structuredRequirements !== null)) ctx.addIssue({ code: 'custom', path: ['structuredRequirements'], message: 'Only READY may carry generation input' });
  if (r.status === 'READY' && (r.unresolvedQuestions.length || r.error || r.unsupportedRequirements.some(u => u.disposition === 'BLOCKING'))) ctx.addIssue({ code: 'custom', message: 'READY requires resolved validated intent' });
});
export type InterpretationResult = z.infer<typeof InterpretationResultSchema>;
