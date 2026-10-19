import { z } from 'zod';
import { ElementDiffSchema } from '../contracts/integration.js';

/**
 * B44 S1 (ROADMAP L375–391): per-project roles, comments anchored to stable element ids of one revision, review decisions bound to the revision's
 * model hash, and a change audit (who, which operation, approved by whom, which elements changed). Membership is owner-managed and reaches only these
 * routes: every existing owner-only route and table stays owner-only (widening it is an owner decision, see the slice record).
 */
export const COLLABORATION_VERSION = 'collaboration-v1';
export const COLLABORATION_ROOT = '/api/projects/:projectId/collaboration';
export const COLLABORATION_ROUTES = {
  workspace: COLLABORATION_ROOT, members: `${COLLABORATION_ROOT}/members`, member: `${COLLABORATION_ROOT}/members/:userId`,
  revision: `${COLLABORATION_ROOT}/revisions/:revisionId`, comments: `${COLLABORATION_ROOT}/revisions/:revisionId/comments`,
  reviews: `${COLLABORATION_ROOT}/revisions/:revisionId/reviews`,
} as const;
export const ROLES = ['owner', 'editor', 'reviewer', 'viewer'] as const;
/** What each role may do through these routes (the SQL functions enforce the same table). */
export const ROLE_PERMISSIONS = Object.freeze({
  owner: ['READ', 'COMMENT', 'REVIEW', 'MANAGE_MEMBERS'], editor: ['READ', 'COMMENT'], reviewer: ['READ', 'COMMENT', 'REVIEW'], viewer: ['READ'],
} as const);

// Timestamps come from timestamptz columns as RFC 3339 with an offset (+00:00 on a UTC database), like every other database-sourced timestamp (INT-B-018).
const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), ts = z.string().datetime({ offset: true }), elementId = z.string().min(1).max(200);
export const ProjectParamsSchema = z.object({ projectId: id }).strict();
export const MemberParamsSchema = z.object({ projectId: id, userId: id }).strict();
export const RevisionParamsSchema = z.object({ projectId: id, revisionId: id }).strict();
export const MemberRequestSchema = z.object({ userId: id, role: z.enum(['editor', 'reviewer', 'viewer']) }).strict();
export const CommentRequestSchema = z.object({ kind: z.enum(['COMMENT', 'CHANGE_REQUEST']).default('COMMENT'), body: z.string().trim().min(1).max(2000),
  elementIds: z.array(elementId).max(16).transform(e => [...new Set(e)]).default([]), parentId: id.nullable().default(null) }).strict();
/** `expectedModelHash` is the model the reviewer looked at: a review of anything else is refused (409), never recorded against the wrong model. */
export const ReviewRequestSchema = z.object({ decision: z.enum(['APPROVED', 'CHANGES_REQUESTED']), note: z.string().max(2000).default(''), expectedModelHash: hash }).strict();

export const MemberSchema = z.object({ userId: id, role: z.enum(['editor', 'reviewer', 'viewer']), addedBy: id, createdAt: ts, updatedAt: ts }).strict();
export const CommentSchema = z.object({ id, authorId: id, authorRole: z.enum(['owner', 'editor', 'reviewer']), kind: z.enum(['COMMENT', 'CHANGE_REQUEST']),
  body: z.string().max(2000), elementIds: z.array(elementId).max(16), parentId: id.nullable(), createdAt: ts }).strict();
export const ReviewSchema = z.object({ id, reviewerId: id, reviewerRole: z.enum(['owner', 'reviewer']), decision: z.enum(['APPROVED', 'CHANGES_REQUESTED']),
  note: z.string().max(2000), modelHash: hash, createdAt: ts }).strict();
const RevisionSummary = z.object({ id, revisionNumber: z.number().int().positive(), parentRevisionId: id.nullable(), sourceMode: z.enum(['generated', 'supplied']),
  createdBy: id, createdAt: ts }).strict();
export const WorkspaceSchema = z.object({ project: z.object({ id, title: z.string().max(200), status: z.enum(['ACTIVE', 'ARCHIVED']), currentRevisionId: id.nullable() }).strict(),
  role: z.enum(ROLES), members: z.array(MemberSchema).max(20), revisions: z.array(RevisionSummary).max(100),
  /** The newest 100 revisions are listed; true when the project has more (0033). */
  revisionsTruncated: z.boolean() }).strict();
export const WorkspaceResponseSchema = WorkspaceSchema.extend({ collaborationVersion: z.literal(COLLABORATION_VERSION),
  permissions: z.array(z.enum(['READ', 'COMMENT', 'REVIEW', 'MANAGE_MEMBERS'])).max(4) }).strict();

/** As read by collaboration_read('revision'): the stored revision, its parent model, the committing operation and the discussion. */
export const StoredRevisionViewSchema = z.object({ role: z.enum(ROLES),
  revision: RevisionSummary.extend({ generatorVersion: z.string().max(100).nullable(), model: z.record(z.unknown()) }).strict(),
  parentModel: z.record(z.unknown()).nullable(),
  operation: z.object({ operationId: id, kind: z.string().max(40).nullable(), createdBy: id, approvedBy: id.nullable(), request: z.record(z.unknown()), createdAt: ts,
    events: z.array(z.object({ eventType: z.string().max(40), actor: id.nullable(), createdAt: ts }).strict()).max(32) }).strict().nullable(),
  comments: z.array(CommentSchema).max(200), reviews: z.array(ReviewSchema).max(100) }).strict();

export const AuditSchema = z.object({
  revisionId: id, revisionNumber: z.number().int().positive(), parentRevisionId: id.nullable(), modelHash: hash, sourceMode: z.enum(['generated', 'supplied']),
  createdBy: id, createdAt: ts,
  /** The Phase 30 operation that committed this revision, if any: who asked, what was asked, who approved, and its event trail. */
  operation: z.object({ operationId: id, kind: z.string().max(40).nullable(), requestedBy: id, approvedBy: id.nullable(), instruction: z.string().max(2000).nullable(),
    events: z.array(z.object({ eventType: z.string().max(40), actor: id.nullable(), createdAt: ts }).strict()).max(32) }).strict().nullable(),
  /** Parent → this revision by stable element id (null for the first revision). */
  changes: ElementDiffSchema.nullable(),
  invalidation: z.literal('WHOLE_MODEL'),
}).strict();
export const RevisionCollaborationSchema = z.object({ collaborationVersion: z.literal(COLLABORATION_VERSION), projectId: id, role: z.enum(ROLES),
  revision: RevisionSummary.extend({ generatorVersion: z.string().max(100).nullable(), modelHash: hash, model: z.record(z.unknown()) }).strict(),
  comments: z.array(CommentSchema).max(200), reviews: z.array(ReviewSchema).max(100),
  /** Latest decision per reviewer, newest first. Recorded opinions of named users, never a certification. */
  reviewState: z.object({ approvals: z.number().int().min(0), changesRequested: z.number().int().min(0), latest: z.array(ReviewSchema).max(21) }).strict(),
  audit: AuditSchema,
  claims: z.object({ professionalCertification: z.literal('NOT_CLAIMED'), regulatoryApproval: z.literal('NOT_CLAIMED') }).strict(),
}).strict();
export type RevisionCollaboration = z.infer<typeof RevisionCollaborationSchema>;
