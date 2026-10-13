import { z } from 'zod';
import { RegenerationRequestSchema } from '../engineering/regeneration-contracts.js';
import { NaturalLanguageDesignRequestSchema } from './requirement-interpretation.js';
import { ConversationSchema } from './conversations.js';
import { ActionSchema, FactSchema, TURN_LIMITS, TurnSchema } from './conversation-memory.js';

export const CONTEXT_DOCUMENT_VERSION = 'conversation-context-v1';
const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const ids = z.array(id).max(TURN_LIMITS.references).transform(a => [...new Set(a)]);
/** Structured, user-authored operation input. It is never produced from model output. */
export const TurnOperationSchema = z.object({ kind: z.literal('ZONE_REGENERATION'), request: RegenerationRequestSchema }).strict();

export const TurnRequestSchema = z.object({
  /** Client-generated; a retry with the same id and body replays the stored reply, a different body is refused. */
  turnId: id, expectedVersion: z.number().int().min(0).max(99), baseRevisionId: id.nullable(),
  text: NaturalLanguageDesignRequestSchema.shape.text.pipe(z.string().max(TURN_LIMITS.text)),
  references: z.object({ supersede: ids.default([]), release: ids.default([]) }).strict().optional(),
  operation: TurnOperationSchema.optional(),
}).strict();
export type TurnRequest = z.infer<typeof TurnRequestSchema>;
export const TurnResponseSchema = z.object({ conversation: ConversationSchema, turn: TurnSchema.nullable(), action: ActionSchema.nullable() }).strict();

export const ActionParamsSchema = z.object({ projectId: id, conversationId: id, actionId: id }).strict();
export const ActionDecisionSchema = z.object({
  decisionId: id, expectedVersion: z.number().int().min(0).max(99), actionHash: hash,
  decision: z.enum(['CONFIRM', 'APPROVE_CANDIDATE', 'CANCEL']), candidateHash: hash.optional(), operation: TurnOperationSchema.optional(),
}).strict();
export type ActionDecision = z.infer<typeof ActionDecisionSchema>;
export const ActionDecisionResponseSchema = z.object({ conversation: ConversationSchema, action: ActionSchema }).strict();

export const RebaseRequestSchema = z.object({ expectedVersion: z.number().int().min(0).max(99) }).strict();
export const RebaseResponseSchema = z.object({ conversation: ConversationSchema, rebased: z.boolean(), fromRevisionId: id.nullable(), toRevisionId: id.nullable(),
  reconciled: z.array(z.object({ actionId: id, status: z.string().max(40) }).strict()).max(TURN_LIMITS.actions) }).strict();

/**
 * The bounded project context a turn is answered from. Facts carry their basis; `contextHash` covers everything but `generatedAt`, so a turn can
 * cite exactly the context it used. Never more than TURN_LIMITS.contextBytes when serialized.
 */
export const ConversationContextSchema = z.object({
  contextVersion: z.literal(CONTEXT_DOCUMENT_VERSION), projectId: id, conversationId: id, conversationVersion: z.number().int().min(0),
  baseRevisionId: id.nullable(), currentRevisionId: id.nullable(), currency: z.enum(['CURRENT', 'STALE', 'NO_REVISION']),
  facts: z.array(FactSchema).max(TURN_LIMITS.facts),
  history: z.array(z.object({ revisionId: id, revisionNumber: z.number().int().positive(), parentRevisionId: id.nullable(), sourceMode: z.string().max(20),
    qaStatus: z.string().max(30), createdAt: z.string() }).strict()).max(TURN_LIMITS.history),
  memory: z.array(z.object({ id, ordinal: z.number().int(), kind: z.string().max(30), status: z.string().max(20), statement: z.string().max(TURN_LIMITS.statement) }).strict())
    .max(TURN_LIMITS.memory),
  pendingActions: z.array(z.object({ id, kind: z.string().max(30), status: z.string().max(30) }).strict()).max(TURN_LIMITS.actions),
  capabilities: z.array(z.object({ capabilityId: z.string().max(64), status: z.enum(['AVAILABLE', 'REQUIRES_STRUCTURED_INPUT', 'PLANNED', 'UNSUPPORTED']),
    detail: z.string().max(300) }).strict()).max(16),
  sources: z.object({ projectContextVersion: z.string().max(40), projectContextHash: hash, briefVersion: z.number().int().min(0) }).strict(),
  bytes: z.number().int().min(0).max(TURN_LIMITS.contextBytes), truncated: z.boolean(), contextHash: hash, generatedAt: z.string(),
}).strict();
export type ConversationContext = z.infer<typeof ConversationContextSchema>;
