import { z } from 'zod';
import { DOMAINS } from '../engineering/contracts.js';
import { PRESERVATION_SCOPES } from '../revision/contracts.js';

/**
 * B42 S1 (ROADMAP L338–352): a declared design ambition is classified, constraint by constraint, against what the engines actually represent and
 * enforce (MODEL_LIMITS, the generator schemas, the specialist room limit), never against invented engineering thresholds. Bounded alternatives are
 * proposed for consent with what each gives up; a staged ladder states which stages are reachable and what each still lacks. Nothing is generated,
 * stored or applied: an alternative is a typed pointer to the existing route, and hard locks block any alternative that would break them.
 */
export const FEASIBILITY_VERSION = 'feasibility-assessment-v1';
export const FEASIBILITY_ROUTE = '/api/projects/:projectId/feasibility/assessments';

/** Design features no engine represents (the model uses straight-edged polygon rings on horizontal storeys). Concept or inspiration only. */
export const CONCEPT_FEATURES = ['CURVED_OR_ORGANIC_FORM', 'TWISTING_OR_ROTATING_FORM', 'FLOATING_OR_LEVITATING_VOLUME', 'UNDERWATER_OR_SUBMERGED',
  'INVERTED_OR_GRAVITY_DEFYING', 'FULL_GLASS_ENVELOPE', 'TRANSPARENT_FLOORS', 'SCULPTURAL_FACADE'] as const;
export const CLASSIFICATIONS = ['WITHIN_ENGINE_SCOPE', 'EXCEEDS_ENGINE_LIMIT', 'CONCEPT_ONLY', 'REQUIRES_PROFESSIONAL_REVIEW'] as const;
export const LADDER_STAGES = ['CONCEPT', 'BOUNDED_GEOMETRY', 'ENGINEERING_EVIDENCE', 'PROFESSIONAL_REVIEW'] as const;

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const FeasibilityParamsSchema = z.object({ projectId: id }).strict();
/** Structured values override the same quantity read from the text. Lengths are integer millimetres, as everywhere in the model. */
export const DeclaredAmbitionSchema = z.object({
  storeys: z.number().int().min(1).max(1000).optional(), rooms: z.number().int().min(1).max(1000).optional(),
  heightMm: z.number().int().min(1).max(2_000_000).optional(), maxSpanMm: z.number().int().min(1).max(1_000_000).optional(),
  cantileverMm: z.number().int().min(1).max(1_000_000).optional(), features: z.array(z.enum(CONCEPT_FEATURES)).max(CONCEPT_FEATURES.length).optional(),
}).strict();
export const FeasibilityRequestSchema = z.object({
  text: z.string().max(1000).default(''),
  declared: DeclaredAmbitionSchema.default({}),
  /** Optional: the accepted revision the ambition would revise, and the hard locks on it. An alternative that would break a lock is blocked. */
  baseRevisionId: id.nullable().default(null),
  preserve: z.array(z.enum(PRESERVATION_SCOPES)).max(PRESERVATION_SCOPES.length).default([]),
}).strict().refine(r => r.text.trim().length > 0 || Object.keys(r.declared).length > 0, { message: 'Describe the ambition in text or declare at least one value' });
export type FeasibilityRequest = z.infer<typeof FeasibilityRequestSchema>;

const Limit = z.object({ limitId: z.string().max(80), value: z.number().int(), requested: z.number().int() }).strict();
export const ConstraintSchema = z.object({
  constraintId: z.enum(['STOREYS', 'ROOMS', 'HEIGHT', 'SPAN', 'CANTILEVER', ...CONCEPT_FEATURES]),
  source: z.enum(['TEXT', 'DECLARED']), phrase: z.string().max(120).nullable(), value: z.number().int().nullable(), unit: z.enum(['storeys', 'rooms', 'mm']).nullable(),
  classification: z.enum(CLASSIFICATIONS),
  /** The enforced limit that refuses it (EXCEEDS_ENGINE_LIMIT), or null. */
  limit: Limit.nullable(),
  /** Engineering domains its feasibility depends on that no validated solver in this backend covers. */
  unverifiedDomains: z.array(z.enum(DOMAINS)).max(DOMAINS.length),
  reason: z.string().max(400),
}).strict();
export type Constraint = z.infer<typeof ConstraintSchema>;
export const AlternativeSchema = z.object({
  alternativeId: z.enum(['AS_REQUESTED', 'BOUNDED_GENERATION', 'SUPPLIED_MODEL_ASSESSMENT', 'CONCEPT_ONLY']),
  status: z.enum(['PROPOSED_FOR_CONSENT', 'BLOCKED_BY_LOCK']), title: z.string().max(120),
  reachesStage: z.enum(LADDER_STAGES),
  keeps: z.array(z.string().max(160)).max(16), givesUp: z.array(z.string().max(200)).max(16),
  /** Hard locks this alternative would break (BLOCKED_BY_LOCK); a lock is never voided to make an alternative possible. */
  lockConflicts: z.array(z.enum(PRESERVATION_SCOPES)).max(PRESERVATION_SCOPES.length),
  handoff: z.object({ method: z.literal('POST'), route: z.string().max(200), purpose: z.string().max(300) }).strict(),
  requiresConsent: z.literal(true), applied: z.literal(false),
}).strict();
export const LadderStageSchema = z.object({ stage: z.enum(LADDER_STAGES), status: z.enum(['AVAILABLE', 'PARTIAL', 'BLOCKED', 'NOT_PERFORMED']),
  artifacts: z.array(z.string().max(200)).max(8), gaps: z.array(z.string().max(300)).max(16), acceptance: z.string().max(300) }).strict();
export const FeasibilityAssessmentSchema = z.object({
  assessmentVersion: z.literal(FEASIBILITY_VERSION), projectId: id, baseRevisionId: id.nullable(), inputHash: hash,
  status: z.enum(['WITHIN_ENGINE_SCOPE', 'ALTERNATIVES_PROPOSED']),
  constraints: z.array(ConstraintSchema).max(16), alternatives: z.array(AlternativeSchema).max(4), ladder: z.array(LadderStageSchema).length(LADDER_STAGES.length),
  /** Conceptual inspiration and architectural feasibility are separate records: concept-only items never appear as feasible geometry. */
  separation: z.object({ conceptOnly: z.array(z.string().max(80)).max(16), feasibilityAssessed: z.array(z.string().max(80)).max(16) }).strict(),
  interpretation: z.object({ mode: z.literal('DETERMINISTIC'), languageModel: z.literal('NONE') }).strict(),
  claims: z.object({ buildability: z.literal('NOT_CLAIMED'), engineeringFeasibility: z.literal('NOT_CLAIMED'), codeCompliance: z.literal('NOT_CLAIMED'),
    professionalReview: z.literal('NOT_PERFORMED') }).strict(),
}).strict();
export type FeasibilityAssessment = z.infer<typeof FeasibilityAssessmentSchema>;
