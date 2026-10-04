import { CapabilitySchema } from '../workflows/registry.js';
import { GenerationIdentitySchema } from './freshness.js';
import { QaSummarySchema } from './projects.js';
import { WorkflowPlanSchema, WorkflowRequestSchema } from './workflows.js';
import { z } from 'zod';
import { SelectedBlueprintRequirementsSchema, BlueprintV2RequirementsSchema } from '@designflow/generator';
import { IntentCandidateSchema, NaturalLanguageDesignRequestSchema } from './requirement-interpretation.js';

export const CONVERSATION_LIMITS = Object.freeze({ turns: 100, messages: 20, perProject: 20, perUser: 100, text: 4000, contextBytes: 12000, outputBytes: 16384, stateBytes: 131072, actions: 4 });
const id = z.string().uuid();
const roomType = z.enum(['bedroom','bathroom','living','kitchen','dining','study']);
const selector = z.object({ type: roomType, ordinal: z.number().int().min(1).max(24).default(1) }).strict();

export const ConversationIntentSchema = IntentCandidateSchema.extend({
  roomChange: z.object({ type: roomType, allOfType: z.boolean().default(false),
    level: z.union([z.literal(0),z.literal(1)]).optional(), targetLevel: z.union([z.literal(0),z.literal(1)]).optional(),
    minWidthMm: z.number().int().min(1).max(60000).optional(), minDepthMm: z.number().int().min(1).max(60000).optional(),
  }).strict().optional(),
  relationship: z.object({ from: selector, to: selector, kind: z.enum(['adjacent','connected','passage']), strength: z.enum(['hard','soft']) }).strict().optional(),
  privacy: z.boolean().optional(), daylight: z.boolean().optional(), ventilation: z.boolean().optional(),
  circulationWidthMm: z.number().int().min(600).max(60000).optional(),
  accessSide: z.enum(['min-x', 'max-x', 'min-z', 'max-z']).optional(),
  northMilliDegrees: z.number().int().min(0).max(359999).optional(),
}).strict();
export type ConversationIntent = z.infer<typeof ConversationIntentSchema>;
export const CreateConversationSchema = z.object({ conversationId: id, baseRevisionId: id.nullable(), layoutV2: z.object({}).strict().optional() }).strict();
export const ConversationParamsSchema = z.object({ projectId: id, conversationId: id }).strict();
// Explicit native updates are user-only. Provider output cannot supply this object.
const native = BlueprintV2RequirementsSchema.innerType().shape;
export const NativeConversationUpdateSchema = z.object({
  rooms: native.rooms.optional(), relationships: native.relationships.optional(),
  site: native.site.optional(), stair: native.stair.optional(), layoutV2: native.layoutV2.optional(),
}).strict();
export const ConversationMessageSchema = z.object({
  messageId: id, expectedVersion: z.number().int().min(0).max(99), baseRevisionId: id.nullable(),
  text: NaturalLanguageDesignRequestSchema.shape.text,
  answers: NaturalLanguageDesignRequestSchema.shape.clarification.unwrap().shape.answers.optional(),
  nativeUpdate: NativeConversationUpdateSchema.optional(),
  restoreRevisionId: id.optional(),
  removeUnsupported: z.array(z.string().min(1).max(100)).max(12).optional(),
}).strict();
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export const ProposalApprovalSchema = z.object({ proposalId: id, proposalVersion: z.number().int().min(1).max(100),
  baseRevisionId: id.nullable(), requirementsHash: z.string().regex(/^[a-f0-9]{64}$/), approve: z.literal(true) }).strict();
export const ProposalSchema = z.object({ id, version: z.number().int().positive(), baseRevisionId: id.nullable(),
  requirements: SelectedBlueprintRequirementsSchema, requirementsHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.string().datetime(), changedFields: z.array(z.string().max(100)).max(32) }).strict();
export const ConversationStateSchema = z.object({ schemaVersion: z.literal(1), version: z.number().int().min(0).max(100),
  baseRevisionId: id.nullable(), solver: z.enum(['V1', 'V2']),
  status: z.enum(['DRAFT','NEEDS_CLARIFICATION','AWAITING_APPROVAL','SUBMITTED','REJECTED','FAILED']),
  baseRequirements: SelectedBlueprintRequirementsSchema.nullable().default(null),
  intent: ConversationIntentSchema, pendingIntent: ConversationIntentSchema.default({}), requirements: SelectedBlueprintRequirementsSchema.nullable(),
  pendingBedroomMove: z.boolean().default(false),
  questions: z.array(z.string().max(300)).max(24), unsupported: z.array(z.string().max(100)).max(24),
  explanations: z.array(z.string().max(400)).max(40),
  fieldSources: z.record(z.enum(['USER_EXPLICIT','USER_INFERRED','PRODUCT_DEFAULT','PERSISTED'])),
  summary: z.string().max(1000), proposal: ProposalSchema.nullable(),
  messages: z.array(z.object({ id, text: z.string().max(4000), createdAt: z.string().datetime() }).strict()).max(20),
  provider: z.object({ kind: z.string().max(64), model: z.string().max(100), failure: z.string().max(100).nullable() }).strict(),
}).strict();
export type ConversationState = z.infer<typeof ConversationStateSchema>;
export const ConversationSchema = z.object({ id, projectId: id, state: ConversationStateSchema }).strict();
export const ConversationListSchema = z.object({ items: z.array(ConversationSchema).max(20), nextCursor: id.nullable() }).strict();
export const ConversationPageSchema = z.object({ limit: z.coerce.number().int().min(1).max(20).default(20), cursor: id.optional() }).strict();
export const ConversationToolSchema = z.object({ actions: z.array(z.union([z.object({ name: z.enum(['READ_CURRENT_REVISION','CHECK_CAPABILITIES','COMPARE_REQUIREMENTS','EXPLAIN_QA_RESULT']), input: z.object({}).strict() }).strict(), z.object({ name: z.literal('PLAN_EXISTING_WORKFLOW'), input: WorkflowRequestSchema }).strict()])).min(1).max(4) }).strict();

export const ConversationToolResponseSchema = z.object({ schemaVersion: z.literal(1), projectId: id, conversationId: id,
  results: z.array(z.discriminatedUnion('name', [
    z.object({ name: z.literal('READ_CURRENT_REVISION'), revisionId: id.nullable(), identity: GenerationIdentitySchema.nullable() }).strict(),
    z.object({ name: z.literal('CHECK_CAPABILITIES'), capabilities: z.array(CapabilitySchema).max(32) }).strict(),
    z.object({ name: z.literal('COMPARE_REQUIREMENTS'), proposal: ProposalSchema.nullable() }).strict(),
    z.object({ name: z.literal('EXPLAIN_QA_RESULT'), qa: QaSummarySchema.nullable(), explanation: z.string().max(300) }).strict(),
    z.object({ name: z.literal('PLAN_EXISTING_WORKFLOW'), plan: WorkflowPlanSchema }).strict(),
  ])).min(1).max(4),
}).strict();
