import { z } from 'zod';
import { INTERIOR_FINISHES, INTERIOR_SURFACES } from '@designflow/shared';
import { ChangeSetSchema } from '../contracts/integration.js';
import { PRESERVATION_SCOPES } from '../revision/contracts.js';

/**
 * B41 S1 (ROADMAP L318–335): one natural-language revision instruction, resolved deterministically against one stored revision. The output is
 * typed intent, targets grounded in stable element ids (or a clarification naming the candidates), the hard locks the wording implies, and, for
 * an executable interior edit, a B40 change-set draft. Nothing is executed or stored: approval and execution stay with the B40 plan routes.
 */
export const RESOLUTION_VERSION = 'instruction-resolution-v1';
export const INSTRUCTION_ROUTE = '/api/projects/:projectId/revisions/:revisionId/instructions/resolve';
export const INSTRUCTION_LIMITS = Object.freeze({ textChars: 1000, targets: 16, candidates: 12, clarifications: 8 });

/** ROADMAP L326: the seven action kinds a conversation must distinguish, plus an honest "not understood". */
export const INSTRUCTION_INTENTS = ['EDIT_EXISTING', 'REGENERATE_VISUAL_DERIVATIVE', 'DERIVE_ALTERNATIVE', 'RECOMPUTE_ENGINEERING', 'RESTORE_PRIOR',
  'COMPARE_REVISIONS', 'NEW_PROJECT', 'UNRECOGNIZED'] as const;
export type InstructionIntent = typeof INSTRUCTION_INTENTS[number];
export const RESOLUTION_STATUSES = ['RESOLVED', 'NEEDS_CLARIFICATION', 'UNSUPPORTED'] as const;
export type ResolutionStatus = typeof RESOLUTION_STATUSES[number];

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), elementId = z.string().min(1).max(200);
const Reason = z.object({ code: z.string().min(1).max(80), message: z.string().min(1).max(500) }).strict();
export type ResolutionReason = z.infer<typeof Reason>;

export const InstructionParamsSchema = z.object({ projectId: id, revisionId: id }).strict();
export const InstructionRequestSchema = z.object({ text: z.string().min(1).max(INSTRUCTION_LIMITS.textChars) }).strict();

export const TargetSchema = z.object({
  /** The words that named the target, as normalized. */
  phrase: z.string().max(200),
  elementType: z.enum(['space', 'level']),
  resolution: z.enum(['EXACT', 'AMBIGUOUS', 'NOT_FOUND']),
  elementIds: z.array(elementId).max(64),
  /** For AMBIGUOUS: the candidates to choose from (stable id and name). */
  candidates: z.array(z.object({ elementId, name: z.string().max(200) }).strict()).max(INSTRUCTION_LIMITS.candidates),
  /** How the target was grounded: name, classification, level, orientation (with its convention), ordinal, exclusion. */
  basis: z.array(z.string().max(200)).max(8),
}).strict();
export type ResolvedTarget = z.infer<typeof TargetSchema>;
export const FinishRequestSchema = z.object({ surface: z.enum(INTERIOR_SURFACES), finish: z.string().max(40), phrase: z.string().max(80) }).strict()
  .refine(f => (INTERIOR_FINISHES[f.surface] as readonly string[]).includes(f.finish), { message: 'Finish is not in the catalog for this surface' });
export const LockSchema = z.object({ scope: z.enum(PRESERVATION_SCOPES), levelId: elementId.nullable(), source: z.enum(['ONLY', 'KEEP', 'LEVEL']), phrase: z.string().max(80) }).strict();
export const RevisionRefSchema = z.object({ phrase: z.string().max(80), kind: z.enum(['PREVIOUS', 'ORIGINAL', 'NUMBER', 'THIS']),
  revisionNumber: z.number().int().positive().nullable(), revisionId: id.nullable() }).strict();
/** Where to go next: a typed pointer to the existing route that performs (or previews) the resolved action. Never already performed. */
export const HandoffSchema = z.object({ method: z.enum(['GET', 'POST']), route: z.string().max(200), purpose: z.string().max(300), body: z.record(z.unknown()).nullable() }).strict();

export const InstructionResolutionSchema = z.object({
  resolutionVersion: z.literal(RESOLUTION_VERSION), projectId: id, revisionId: id, revisionNumber: z.number().int().positive(), modelHash: hash,
  /** sha256 of the normalized instruction: the same text on the same revision always resolves identically. */
  textHash: hash,
  intent: z.enum(INSTRUCTION_INTENTS), status: z.enum(RESOLUTION_STATUSES),
  module: z.enum(['INTERIOR', 'EXTERIOR', 'BLUEPRINT', 'MATERIALS', 'BUDGET', 'STRUCTURAL', 'SCENE', 'NONE']),
  targets: z.array(TargetSchema).max(INSTRUCTION_LIMITS.targets),
  /** Targets named after "except", "apart from", "other than", "but not": removed from the targets above. */
  exclusions: z.array(TargetSchema).max(INSTRUCTION_LIMITS.targets),
  finishes: z.array(FinishRequestSchema).max(3),
  locks: z.array(LockSchema).max(16),
  /** A requested change that a stated lock forbids. Never resolved by overriding the lock: the user decides. */
  conflicts: z.array(Reason).max(8),
  revisionRefs: z.array(RevisionRefSchema).max(2),
  clarifications: z.array(z.string().max(300)).max(INSTRUCTION_LIMITS.clarifications),
  unsupported: z.array(Reason).max(8),
  /** For a resolved interior finish edit only: the B40 change set to preview at POST …/integration/plans. Never executed here. */
  changeSetDraft: ChangeSetSchema.nullable(),
  handoff: HandoffSchema.nullable(),
  executed: z.literal(false),
  interpretation: z.object({ mode: z.literal('DETERMINISTIC'), grammar: z.literal(RESOLUTION_VERSION), languageModel: z.literal('NONE') }).strict(),
  claims: z.object({ engineeringCorrectness: z.literal('NOT_CLAIMED'), professionalReview: z.literal('NOT_CLAIMED') }).strict(),
}).strict();
export type InstructionResolution = z.infer<typeof InstructionResolutionSchema>;
