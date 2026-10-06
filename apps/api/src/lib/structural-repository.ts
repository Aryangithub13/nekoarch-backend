import { z } from 'zod';
import type { IdempotencyContext, Repository } from './repository.js';
import { ApiError, parseRequest } from './errors.js';
import { projectDatabaseError } from './project-repository.js';
import { StructuralCursorSchema, StructuralDetailSchema, StructuralSummarySchema } from '../structural/contracts.js';

export function structuralDatabaseError(error: { code?: string }): never {
  const errors: Record<string, [number, string, string]> = {
    P2401: [404, 'STRUCTURAL_ANALYSIS_NOT_FOUND', 'Structural analysis not found'],
    P2402: [422, 'REVISION_NOT_ACCEPTED', 'Revision has no accepted QA evidence'],
    P2403: [422, 'STRUCTURAL_RESULT_INVALID', 'Structural snapshot provenance validation failed'],
  };
  const mapped = error.code ? errors[error.code] : undefined;
  if (mapped) throw new ApiError(...mapped);
  projectDatabaseError(error);
}
const current = z.string().uuid().nullable();
export class StructuralRepository {
  constructor(private readonly repository: Repository) {}
  private rpc(name: 'structural_read' | 'structural_write', args: Record<string, unknown>) {
    if (!this.repository.structuralRpc) throw new ApiError(503, 'STRUCTURAL_UNAVAILABLE', 'Structural persistence is unavailable');
    return this.repository.structuralRpc(name, args);
  }
  async read(projectId: string, revisionId: string, analysisId: string) {
    const { projectCurrentRevisionId, ...detail } = z.object({ projectCurrentRevisionId: current }).passthrough()
      .parse(await this.rpc('structural_read', { p_action: 'get', p_project_id: projectId, p_revision_id: revisionId, p_analysis_id: analysisId }));
    return { detail: StructuralDetailSchema.parse(detail), projectCurrentRevisionId };
  }
  async list(projectId: string, revisionId: string, query: { limit: number; cursor?: string | undefined }) {
    let cursor: unknown = null;
    if (query.cursor) {
      try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); }
      catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor'); }
      cursor = parseRequest(StructuralCursorSchema, cursor);
    }
    const raw = z.object({ items: z.array(StructuralSummarySchema).max(100), nextCursor: StructuralCursorSchema.nullable(), projectCurrentRevisionId: current }).strict().parse(
      await this.rpc('structural_read', { p_action: 'list', p_project_id: projectId, p_revision_id: revisionId, p_limit: query.limit, p_cursor: cursor }));
    return { ...raw, nextCursor: raw.nextCursor ? Buffer.from(JSON.stringify(raw.nextCursor)).toString('base64url') : null };
  }
  async status(projectId: string, revisionId: string) {
    return z.object({ projectCurrentRevisionId: current, revisionNumber: z.number().int().positive(), analyses: z.array(StructuralSummarySchema).max(20),
      otherRevisionAnalyses: z.array(StructuralSummarySchema.extend({ revisionNumber: z.number().int().positive() })).max(20) }).strict()
      .parse(await this.rpc('structural_read', { p_action: 'status', p_project_id: projectId, p_revision_id: revisionId }));
  }
  async write(input: unknown, attestation: { envelope: string; signature: string }, context?: IdempotencyContext) {
    return StructuralDetailSchema.parse(await this.rpc('structural_write', { p_input: input, p_context: context ?? null, p_envelope: attestation.envelope, p_signature: attestation.signature }));
  }
}
