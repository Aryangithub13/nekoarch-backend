import { z } from 'zod';
import type { IdempotencyContext, Repository } from './repository.js';
import { ApiError, parseRequest } from './errors.js';
import { projectDatabaseError } from './project-repository.js';
import { OptimizationCursorSchema, OptimizationDetailSchema, OptimizationSummarySchema } from '../optimization/contracts.js';

export function optimizationDatabaseError(error: { code?: string }): never {
  const errors: Record<string, [number, string, string]> = {
    P2801: [404, 'OPTIMIZATION_STUDY_NOT_FOUND', 'Optimization study not found'],
    P2802: [422, 'REVISION_NOT_ACCEPTED', 'Revision has no accepted QA evidence'],
    P2803: [422, 'OPTIMIZATION_RESULT_INVALID', 'Optimization study provenance validation failed'],
  };
  const mapped = error.code ? errors[error.code] : undefined;
  if (mapped) throw new ApiError(...mapped);
  projectDatabaseError(error);
}
const current = z.string().uuid().nullable();
export class OptimizationRepository {
  constructor(private readonly repository: Repository) {}
  private rpc(name: 'optimization_read' | 'optimization_write', args: Record<string, unknown>) {
    if (!this.repository.optimizationRpc) throw new ApiError(503, 'OPTIMIZATION_UNAVAILABLE', 'Optimization persistence is unavailable');
    return this.repository.optimizationRpc(name, args);
  }
  async read(projectId: string, revisionId: string, studyId: string) {
    const { projectCurrentRevisionId, ...detail } = z.object({ projectCurrentRevisionId: current }).passthrough()
      .parse(await this.rpc('optimization_read', { p_action: 'get', p_project_id: projectId, p_revision_id: revisionId, p_study_id: studyId }));
    return { detail: OptimizationDetailSchema.parse(detail), projectCurrentRevisionId };
  }
  async list(projectId: string, revisionId: string, query: { limit: number; cursor?: string | undefined }) {
    let cursor: unknown = null;
    if (query.cursor) {
      try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); }
      catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor'); }
      cursor = parseRequest(OptimizationCursorSchema, cursor);
    }
    const raw = z.object({ items: z.array(OptimizationSummarySchema).max(100), nextCursor: OptimizationCursorSchema.nullable(), projectCurrentRevisionId: current }).strict().parse(
      await this.rpc('optimization_read', { p_action: 'list', p_project_id: projectId, p_revision_id: revisionId, p_limit: query.limit, p_cursor: cursor }));
    return { ...raw, nextCursor: raw.nextCursor ? Buffer.from(JSON.stringify(raw.nextCursor)).toString('base64url') : null };
  }
  async status(projectId: string, revisionId: string) {
    return z.object({ projectCurrentRevisionId: current, revisionNumber: z.number().int().positive(), studies: z.array(OptimizationSummarySchema).max(20),
      otherRevisionStudies: z.array(OptimizationSummarySchema.extend({ revisionNumber: z.number().int().positive() })).max(20) }).strict()
      .parse(await this.rpc('optimization_read', { p_action: 'status', p_project_id: projectId, p_revision_id: revisionId }));
  }
  async write(input: unknown, attestation: { envelope: string; signature: string }, context?: IdempotencyContext) {
    return OptimizationDetailSchema.parse(await this.rpc('optimization_write', { p_input: input, p_context: context ?? null, p_envelope: attestation.envelope, p_signature: attestation.signature }));
  }
}
