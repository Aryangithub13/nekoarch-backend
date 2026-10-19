import type { BuildingModelV2 } from '@designflow/shared';
import type { z } from 'zod';
import type { IdempotencyContext, Repository } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { modelHash } from '../lib/generation-identity.js';
import { CollaborationRepository } from '../lib/collaboration-repository.js';
import { diffElements } from '../integration/element-diff.js';
import { COLLABORATION_ROUTES, COLLABORATION_VERSION, ROLE_PERMISSIONS, RevisionCollaborationSchema, WorkspaceResponseSchema, type CommentRequestSchema,
  type MemberRequestSchema, type RevisionCollaboration, type ReviewRequestSchema } from '../collaboration/contracts.js';
import { signProjectCommit } from './project-service.js';

const need = (secret?: string) => {
  if (!secret) throw new ApiError(503, 'COLLABORATION_UNAVAILABLE', 'Collaboration writes are not configured');
  return secret;
};

export async function readWorkspace(repository: Repository, projectId: string) {
  const w = await new CollaborationRepository(repository).workspace(projectId);
  return WorkspaceResponseSchema.parse({ ...w, collaborationVersion: COLLABORATION_VERSION, permissions: [...ROLE_PERMISSIONS[w.role]] });
}

export async function upsertMember(repository: Repository, userId: string, projectId: string, body: z.infer<typeof MemberRequestSchema>, secret?: string) {
  const input = { projectId, userId: body.userId, role: body.role };
  return new CollaborationRepository(repository).upsertMember(input, signProjectCommit(need(secret), userId, COLLABORATION_ROUTES.members, input));
}
export async function removeMember(repository: Repository, userId: string, projectId: string, memberId: string, secret?: string, context?: IdempotencyContext) {
  const input = { projectId, userId: memberId };
  return new CollaborationRepository(repository).removeMember(input, signProjectCommit(need(secret), userId, COLLABORATION_ROUTES.member, input, context), context);
}

/**
 * One revision as its collaborators see it: the stored model and its hash, the discussion, each reviewer's latest decision, and the change audit
 * (requester, instruction, approver, events, and the element diff from the parent). Read only; the diff is the B40 element diff by stable id.
 */
export async function readRevisionCollaboration(repository: Repository, projectId: string, revisionId: string): Promise<RevisionCollaboration> {
  const v = await new CollaborationRepository(repository).revision(projectId, revisionId);
  const model = v.revision.model as unknown as BuildingModelV2, hash = modelHash(model);
  const latest = new Map<string, (typeof v.reviews)[number]>();
  for (const r of v.reviews) latest.set(r.reviewerId, r); // stored oldest first: the last one per reviewer wins
  const current = [...latest.values()].filter(r => r.modelHash === hash).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const request = v.operation?.request as { text?: unknown; operation?: { kind?: unknown } } | undefined;
  const instruction = typeof request?.text === 'string' ? request.text : typeof request?.operation?.kind === 'string' ? `Structured ${request.operation.kind} operation` : null;
  return RevisionCollaborationSchema.parse({ collaborationVersion: COLLABORATION_VERSION, projectId, role: v.role,
    revision: { ...v.revision, modelHash: hash }, comments: v.comments, reviews: v.reviews,
    reviewState: { approvals: current.filter(r => r.decision === 'APPROVED').length, changesRequested: current.filter(r => r.decision === 'CHANGES_REQUESTED').length,
      latest: current.slice(0, 21) },
    audit: { revisionId: v.revision.id, revisionNumber: v.revision.revisionNumber, parentRevisionId: v.revision.parentRevisionId, modelHash: hash, sourceMode: v.revision.sourceMode,
      createdBy: v.revision.createdBy, createdAt: v.revision.createdAt,
      operation: v.operation && { operationId: v.operation.operationId, kind: v.operation.kind, requestedBy: v.operation.createdBy, approvedBy: v.operation.approvedBy,
        instruction: instruction?.slice(0, 2000) ?? null, events: v.operation.events },
      changes: v.parentModel ? diffElements(v.parentModel as unknown as BuildingModelV2, model) : null, invalidation: 'WHOLE_MODEL' },
    claims: { professionalCertification: 'NOT_CLAIMED', regulatoryApproval: 'NOT_CLAIMED' } });
}

export async function addComment(repository: Repository, userId: string, projectId: string, revisionId: string, body: z.infer<typeof CommentRequestSchema>, secret?: string,
  context?: IdempotencyContext) {
  const input = { projectId, revisionId, kind: body.kind, body: body.body, elementIds: body.elementIds, parentId: body.parentId };
  return new CollaborationRepository(repository).comment(input, signProjectCommit(need(secret), userId, COLLABORATION_ROUTES.comments, input, context), context);
}

/** The review is recorded against the model hash the server computes from the stored revision, and only if it is the model the reviewer saw. */
export async function addReview(repository: Repository, userId: string, projectId: string, revisionId: string, body: z.infer<typeof ReviewRequestSchema>, secret?: string,
  context?: IdempotencyContext) {
  const key = need(secret), collaboration = new CollaborationRepository(repository);
  const v = await collaboration.revision(projectId, revisionId), hash = modelHash(v.revision.model as unknown as BuildingModelV2);
  if (hash !== body.expectedModelHash) throw new ApiError(409, 'REVIEW_MODEL_MISMATCH', 'The revision\'s model differs from the one reviewed; reload it before recording a review');
  const input = { projectId, revisionId, decision: body.decision, note: body.note, modelHash: hash };
  return collaboration.review(input, signProjectCommit(key, userId, COLLABORATION_ROUTES.reviews, input, context), context);
}
