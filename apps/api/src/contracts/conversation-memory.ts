import { z } from 'zod';
import { PRESERVATION_SCOPES, PresetIdSchema, StructuredOperationSchema } from '../revision/contracts.js';
import { ASSURANCE_LEVELS, DOMAINS, DOMAIN_STATUSES, EVIDENCE_CLASSES } from '../engineering/contracts.js';

// Phase 36 (conversational AI): persisted inside architectural_conversations.state (0012), so every part is bounded. Normative description:
// docs/phase36-conversational-ai/phase36-design.md. Literals change only with semantics.
export const TURN_VERSION = 'conversation-turn-v1';
export const CHANGE_INTENT_VERSION = 'conversation-change-intent-v1';
export const TURN_LIMITS = Object.freeze({ text: 2000, memory: 48, turns: 10, actions: 8, facts: 24, statement: 300, questions: 8, conflicts: 8, disclosures: 12,
  references: 8, contextBytes: 12_000, history: 5, bodyBytes: 40_960, entities: 16 });

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), timestamp = z.string().datetime();
const bounded = (max: number) => z.string().max(max);
export const ScopeSchema = z.enum(PRESERVATION_SCOPES);
export type Scope = z.infer<typeof ScopeSchema>;
/** What an operation may change: a preservation scope, on the listed storeys or (null) anywhere in the building. */
export const AffectSchema = z.object({ scope: ScopeSchema, levelIds: z.array(bounded(200)).max(256).nullable() }).strict();
export type Affect = z.infer<typeof AffectSchema>;
export const OPERATION_KINDS = ['REQUIREMENTS_CHANGE', 'EXTERIOR_APPEARANCE', 'RESTORE', 'ZONE_REGENERATION'] as const;
export const OperationKindSchema = z.enum(OPERATION_KINDS);

/**
 * Decision memory. The kind says what an entry is, the source who established it, and the status whether it still applies:
 * - REQUIREMENT: a requirement the user stated (USER_EXPLICIT); it applies only once a proposal built from it is approved.
 * - PRESERVATION: an explicit "keep X" constraint (USER_EXPLICIT); enforced against every later operation until released.
 * - PROPOSAL: a change prepared for confirmation; never a decision on its own.
 * - SUGGESTION: an option the backend listed (SYSTEM_SUGGESTION); never a requirement or decision unless the user selects and confirms it.
 * - ACCEPTED_DECISION: recorded only after an explicit confirmation persisted a revision (USER_CONFIRMED, with that revision id).
 * Derived facts are recomputed from project records on every turn and are not stored here.
 */
export const MemoryEntrySchema = z.object({
  id, ordinal: z.number().int().min(1).max(10_000),
  kind: z.enum(['REQUIREMENT', 'PRESERVATION', 'PROPOSAL', 'SUGGESTION', 'ACCEPTED_DECISION']),
  status: z.enum(['ACTIVE', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'RELEASED']),
  source: z.enum(['USER_EXPLICIT', 'USER_CONFIRMED', 'SYSTEM_SUGGESTION']),
  statement: bounded(TURN_LIMITS.statement),
  preservation: z.object({ scope: ScopeSchema, levelId: bounded(200).nullable() }).strict().nullable(),
  option: z.object({ group: id, index: z.number().int().min(1).max(8), presetId: PresetIdSchema }).strict().nullable(),
  change: z.object({ operation: OperationKindSchema, affects: z.array(AffectSchema).max(16), actionId: id.nullable() }).strict().nullable(),
  turnId: id, revisionId: id.nullable(), resultRevisionId: id.nullable(), recordedAt: timestamp, updatedAt: timestamp,
}).strict();
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

/** A structured, validated change intent. Built deterministically; a model never supplies any field of it. */
export const ChangeIntentSchema = z.object({
  intentVersion: z.literal(CHANGE_INTENT_VERSION), projectId: id, baseRevisionId: id.nullable(),
  operation: z.enum([...OPERATION_KINDS, 'UNSUPPORTED']),
  capability: z.object({ capabilityId: bounded(64), status: z.enum(['AVAILABLE', 'REQUIRES_STRUCTURED_INPUT', 'UNSUPPORTED']), service: bounded(100).nullable(),
    route: bounded(200).nullable() }).strict(),
  affects: z.array(AffectSchema).max(16), desiredChange: bounded(300),
  protected: z.array(z.object({ memoryId: id, scope: ScopeSchema, levelId: bounded(200).nullable() }).strict()).max(TURN_LIMITS.memory),
  requiredInputs: z.array(bounded(200)).max(8), ambiguities: z.array(bounded(300)).max(8), validation: z.array(bounded(200)).max(8),
  confirmationRequired: z.literal(true), expectedOutput: bounded(300), verification: z.array(bounded(200)).max(8),
}).strict();
export type ChangeIntent = z.infer<typeof ChangeIntentSchema>;

export const ACTION_STATUSES = ['PENDING_CONFIRMATION', 'CANDIDATE_READY', 'COMMITTED', 'FAILED', 'CANCELLED', 'SUPERSEDED', 'STALE'] as const;
export const ACTION_FINAL = ['COMMITTED', 'FAILED', 'CANCELLED', 'SUPERSEDED', 'STALE'] as const;
/**
 * A coordinated operation awaiting (or past) explicit confirmation. Its status is changed only by the backend after reading the result of the
 * existing service it routes to, never by model output. `actionHash` binds a confirmation to exactly what was shown.
 */
export const ActionSchema = z.object({
  id, kind: OperationKindSchema, status: z.enum(ACTION_STATUSES), turnId: id, baseRevisionId: id.nullable(), actionHash: hash,
  createdAt: timestamp, updatedAt: timestamp, protected: z.array(id).max(TURN_LIMITS.memory), affects: z.array(AffectSchema).max(16),
  /** Accepted decisions the user explicitly superseded for this action; they are marked superseded only if the action commits. */
  supersedes: z.array(id).max(TURN_LIMITS.references),
  /** Phase 30 operation (EXTERIOR_APPEARANCE, RESTORE): the structured request persisted on confirmation and the preflight it must reproduce. */
  revisionOperation: z.object({ request: StructuredOperationSchema, preflightHash: hash, preflightStatus: bounded(40), locks: z.number().int().min(0),
    operationId: id.nullable(), candidateHash: hash.nullable() }).strict().nullable(),
  /** Phase 35 zone regeneration: the candidate is recomputed on confirmation and must have exactly this model hash. */
  regeneration: z.object({ requestHash: hash, inputHash: hash, expectedModelHash: hash, regeneratedLevelIds: z.array(bounded(200)).max(256),
    wallsRegenerated: z.number().int().min(0), preservation: z.enum(['IDENTICAL', 'WITHIN_SCOPE']), qaStatus: bounded(40).nullable(),
    changes: z.object({ added: z.number().int().min(0), removed: z.number().int().min(0), changed: z.number().int().min(0) }).strict() }).strict().nullable(),
  /** Phase 20 requirement proposal: confirmed through the existing proposal approval route. */
  proposal: z.object({ proposalId: id, proposalVersion: z.number().int().min(1).max(100), requirementsHash: hash, changedFields: z.array(bounded(100)).max(32) }).strict().nullable(),
  result: z.object({ revisionId: id, revisionNumber: z.number().int().positive(), verification: z.enum(['VERIFIED', 'MISMATCH', 'NOT_REPRODUCIBLE', 'COMMITTED_BY_SERVICE']),
    detail: bounded(300) }).strict().nullable(),
  failure: z.object({ code: bounded(100), message: bounded(300) }).strict().nullable(),
  /** What the client posts to move the action on; null once final. */
  confirmation: z.object({ method: z.literal('POST'), route: bounded(300), body: z.record(z.unknown()),
    /** Fields the client adds to `body`: its own idempotency id, the conversation's current version, and any structured input it must resend. */
    requires: z.array(z.enum(['decisionId', 'expectedVersion', 'operation'])).max(3) }).strict().nullable(),
}).strict();
export type Action = z.infer<typeof ActionSchema>;

export const FACT_BASES = ['PROJECT_RECORD', 'DERIVED', 'USER_STATED', 'MEMORY', 'SUGGESTION', 'MISSING'] as const;
export const FactSchema = z.object({ key: bounded(64), statement: bounded(TURN_LIMITS.statement), basis: z.enum(FACT_BASES), sourceRef: bounded(160).nullable() }).strict();
export type Fact = z.infer<typeof FactSchema>;
export const ConflictSchema = z.object({ memoryId: id, kind: z.enum(['PRESERVATION', 'ACCEPTED_DECISION', 'PENDING_ACTION']), scope: ScopeSchema.nullable(),
  detail: bounded(300) }).strict();
export const EngineeringSummarySchema = z.object({ assessmentVersion: bounded(60), revisionId: id, modelHash: hash, resultHash: hash,
  domains: z.array(z.object({ domain: z.enum(DOMAINS), assuranceLevel: z.enum(ASSURANCE_LEVELS), status: z.enum(DOMAIN_STATUSES), evidenceClass: z.enum(EVIDENCE_CLASSES).nullable(),
    blockers: z.array(bounded(60)).max(8) }).strict()).max(DOMAINS.length),
  claims: z.record(z.literal('NOT_CLAIMED')), limitations: z.array(bounded(400)).max(6) }).strict();
export const ComparisonSchema = z.object({ subject: z.enum(['REVISIONS', 'PENDING_ACTION']), baseRevisionId: id.nullable(), otherRevisionId: id.nullable(),
  baseModelHash: hash.nullable(), otherModelHash: hash.nullable(), status: bounded(40), added: z.number().int().min(0), removed: z.number().int().min(0),
  changed: z.number().int().min(0), entities: z.array(z.object({ collection: bounded(20), entityId: bounded(200), change: z.enum(['ADDED', 'REMOVED', 'CHANGED']) }).strict())
    .max(TURN_LIMITS.entities) }).strict();

export const TURN_CLASSIFICATIONS = ['PROJECT_QUESTION', 'DECISION_QUERY', 'OPTIONS', 'ENGINEERING_QUESTION', 'COMPARISON', 'CONSTRAINT', 'OPTION_SELECTION',
  'CHANGE_REQUEST', 'UNRECOGNIZED'] as const;
export const TURN_STATUSES = ['ANSWERED', 'RECORDED', 'CLARIFICATION_REQUIRED', 'PENDING_CONFIRMATION', 'CONFLICT', 'UNSUPPORTED', 'FAILED'] as const;
/** The assistant's reply to one user message (role `assistant`; the user message is in state.messages under the same id). */
export const TurnSchema = z.object({
  turnVersion: z.literal(TURN_VERSION), role: z.literal('assistant'), inReplyTo: id, createdAt: timestamp,
  baseRevisionId: id.nullable(), contextHash: hash,
  classification: z.enum(TURN_CLASSIFICATIONS), status: z.enum(TURN_STATUSES), summary: bounded(600),
  facts: z.array(FactSchema).max(TURN_LIMITS.facts), questions: z.array(bounded(300)).max(TURN_LIMITS.questions),
  conflicts: z.array(ConflictSchema).max(TURN_LIMITS.conflicts), intent: ChangeIntentSchema.nullable(), actionId: id.nullable(),
  engineering: EngineeringSummarySchema.nullable(), comparison: ComparisonSchema.nullable(),
  disclosures: z.array(bounded(400)).max(TURN_LIMITS.disclosures),
  memory: z.object({ added: z.array(id).max(16), updated: z.array(id).max(TURN_LIMITS.memory) }).strict(),
  /** How language was interpreted. Only ARCHITECTURAL_INTENT_EXTRACTION (Phase 21) may use a model, and its output is schema-validated. */
  interpretation: z.object({ mode: z.enum(['DETERMINISTIC', 'PHASE20_PLANNER']), provider: bounded(64), model: bounded(100), failure: bounded(100).nullable() }).strict(),
}).strict();
export type Turn = z.infer<typeof TurnSchema>;
