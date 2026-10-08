import { z } from 'zod';
import type { IdempotencyContext, Repository } from './repository.js';
import { ApiError, parseRequest } from './errors.js';
import { projectDatabaseError } from './project-repository.js';
import { KnowledgeCursorSchema, KnowledgeDetailSchema, KnowledgeSummarySchema } from '../knowledge/contracts.js';

export function knowledgeDatabaseError(error: { code?: string }): never {
  const errors: Record<string, [number, string, string]> = {
    P2701: [404, 'KNOWLEDGE_ANALYSIS_NOT_FOUND', 'Knowledge analysis not found'],
    P2702: [422, 'REVISION_NOT_ACCEPTED', 'Revision has no accepted QA evidence'],
    P2703: [422, 'KNOWLEDGE_RESULT_INVALID', 'Knowledge snapshot provenance validation failed'],
  };
  const mapped = error.code ? errors[error.code] : undefined;
  if (mapped) throw new ApiError(...mapped);
  projectDatabaseError(error);
}
const current = z.string().uuid().nullable();
export class KnowledgeRepository {
  constructor(private readonly repository: Repository) {}
  private rpc(name: 'knowledge_read' | 'knowledge_write', args: Record<string, unknown>) {
    if (!this.repository.knowledgeRpc) throw new ApiError(503, 'KNOWLEDGE_UNAVAILABLE', 'Knowledge persistence is unavailable');
    return this.repository.knowledgeRpc(name, args);
  }
  async read(projectId: string, revisionId: string, analysisId: string) {
    const { projectCurrentRevisionId, ...detail } = z.object({ projectCurrentRevisionId: current }).passthrough()
      .parse(await this.rpc('knowledge_read', { p_action: 'get', p_project_id: projectId, p_revision_id: revisionId, p_analysis_id: analysisId }));
    return { detail: KnowledgeDetailSchema.parse(detail), projectCurrentRevisionId };
  }
  async list(projectId: string, revisionId: string, query: { limit: number; cursor?: string | undefined }) {
    let cursor: unknown = null;
    if (query.cursor) {
      try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); }
      catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor'); }
      cursor = parseRequest(KnowledgeCursorSchema, cursor);
    }
    const raw = z.object({ items: z.array(KnowledgeSummarySchema).max(100), nextCursor: KnowledgeCursorSchema.nullable(), projectCurrentRevisionId: current }).strict().parse(
      await this.rpc('knowledge_read', { p_action: 'list', p_project_id: projectId, p_revision_id: revisionId, p_limit: query.limit, p_cursor: cursor }));
    return { ...raw, nextCursor: raw.nextCursor ? Buffer.from(JSON.stringify(raw.nextCursor)).toString('base64url') : null };
  }
  async status(projectId: string, revisionId: string) {
    return z.object({ projectCurrentRevisionId: current, revisionNumber: z.number().int().positive(), analyses: z.array(KnowledgeSummarySchema).max(20),
      otherRevisionAnalyses: z.array(KnowledgeSummarySchema.extend({ revisionNumber: z.number().int().positive() })).max(20) }).strict()
      .parse(await this.rpc('knowledge_read', { p_action: 'status', p_project_id: projectId, p_revision_id: revisionId }));
  }
  async write(input: unknown, attestation: { envelope: string; signature: string }, context?: IdempotencyContext) {
    return KnowledgeDetailSchema.parse(await this.rpc('knowledge_write', { p_input: input, p_context: context ?? null, p_envelope: attestation.envelope, p_signature: attestation.signature }));
  }
}
