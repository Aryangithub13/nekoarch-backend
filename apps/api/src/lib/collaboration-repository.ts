import { z } from 'zod';
import type { IdempotencyContext, Repository } from './repository.js';
import { ApiError } from './errors.js';
import { projectDatabaseError } from './project-repository.js';
import { CommentSchema, MemberSchema, ReviewSchema, StoredRevisionViewSchema, WorkspaceSchema } from '../collaboration/contracts.js';

export function collaborationDatabaseError(error: { code?: string }): never {
  const errors: Record<string, [number, string, string]> = {
    P4401: [403, 'COLLABORATION_FORBIDDEN', 'Your project role does not allow this action'],
    P4402: [422, 'MEMBER_INVALID', 'The member must be an existing user other than the project owner'],
    P4403: [404, 'MEMBER_NOT_FOUND', 'Member not found'],
    P4404: [422, 'COMMENT_ELEMENT_INVALID', 'A referenced element does not exist in this revision'],
    P4405: [409, 'COLLABORATION_LIMIT_REACHED', 'A collaboration limit was reached'],
    P4406: [422, 'COMMENT_PARENT_INVALID', 'Replies attach to a top-level comment of the same revision'],
  };
  const mapped = error.code ? errors[error.code] : undefined;
  if (mapped) throw new ApiError(...mapped);
  projectDatabaseError(error);
}
export type Attestation = { envelope: string; signature: string };

/** Storage boundary for B44: the Supabase and pg-backend adapters implement `collaborationRpc`. */
export class CollaborationRepository {
  constructor(private readonly repository: Repository) {}
  private rpc(name: 'collaboration_read' | 'collaboration_write', args: Record<string, unknown>) {
    if (!this.repository.collaborationRpc) throw new ApiError(503, 'COLLABORATION_UNAVAILABLE', 'Collaboration services are unavailable');
    return this.repository.collaborationRpc(name, args);
  }
  async workspace(projectId: string) { return WorkspaceSchema.parse(await this.rpc('collaboration_read', { p_action: 'workspace', p_project_id: projectId })); }
  async revision(projectId: string, revisionId: string) {
    return StoredRevisionViewSchema.parse(await this.rpc('collaboration_read', { p_action: 'revision', p_project_id: projectId, p_revision_id: revisionId }));
  }
  /** `context` is an Idempotency-Key receipt (0033): member removal, comments and reviews store their response under it. */
  private write<T extends z.ZodTypeAny>(schema: T, action: string, input: Record<string, unknown>, a: Attestation, context?: IdempotencyContext): Promise<z.infer<T>> {
    return this.rpc('collaboration_write', { p_action: action, p_input: input, p_envelope: a.envelope, p_signature: a.signature, p_context: context ?? null })
      .then(r => schema.parse(r));
  }
  upsertMember(input: Record<string, unknown>, a: Attestation) { return this.write(MemberSchema, 'member_upsert', input, a); }
  removeMember(input: Record<string, unknown>, a: Attestation, context?: IdempotencyContext) {
    return this.write(z.object({ userId: z.string().uuid(), removed: z.literal(true) }).strict(), 'member_remove', input, a, context);
  }
  comment(input: Record<string, unknown>, a: Attestation, context?: IdempotencyContext) { return this.write(CommentSchema, 'comment', input, a, context); }
  review(input: Record<string, unknown>, a: Attestation, context?: IdempotencyContext) { return this.write(ReviewSchema, 'review', input, a, context); }
}
