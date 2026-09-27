import { z } from 'zod';
import type { Repository, IdempotencyContext } from './repository.js';
import { ApiError, parseRequest } from './errors.js';
import { takeoffDatabaseError } from './takeoff-repository.js';
import { ConstructionCursorSchema, ConstructionDetailSchema, ConstructionListSchema, ConstructionSummarySchema } from '../contracts/construction.js';

export function constructionDatabaseError(error: { code?: string }): never {
  const errors: Record<string, [number, string, string]> = {
    P1401: [404, 'CONSTRUCTION_NOT_FOUND', 'Construction not found'],
    P1402: [422, 'TAKEOFF_NOT_ACCEPTED', 'Revision has no accepted QA evidence'],
    P1403: [500, 'CONSTRUCTION_FAILED', 'Construction provenance validation failed'],
  };
  const mapped = error.code ? errors[error.code] : undefined;
  if (mapped) throw new ApiError(...mapped);
  takeoffDatabaseError(error);
}
export class ConstructionRepository {
  constructor(private readonly repository: Repository) {}
  private rpc(name: 'construction_read' | 'construction_write', args: Record<string, unknown>) {
    if (!this.repository.constructionRpc) throw new ApiError(503, 'CONSTRUCTION_UNAVAILABLE', 'Construction persistence is unavailable');
    return this.repository.constructionRpc(name, args);
  }
  async read(projectId: string, revisionId: string, takeoffId: string, calculationId: string) {
    return ConstructionDetailSchema.parse(await this.rpc('construction_read', { p_project_id: projectId, p_revision_id: revisionId, p_takeoff_id: takeoffId, p_calculation_id: calculationId }));
  }
  async list(projectId: string, revisionId: string, takeoffId: string, query: { limit: number; cursor?: string | undefined }) {
    let cursor: unknown = null;
    if (query.cursor) {
      try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); }
      catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor'); }
      cursor = parseRequest(ConstructionCursorSchema, cursor);
    }
    const raw = z.object({ items: z.array(ConstructionSummarySchema).max(100), nextCursor: ConstructionCursorSchema.nullable() }).strict().parse(
      await this.rpc('construction_read', { p_project_id: projectId, p_revision_id: revisionId, p_takeoff_id: takeoffId, p_limit: query.limit, p_cursor: cursor }));
    return ConstructionListSchema.parse({ items: raw.items, nextCursor: raw.nextCursor ? Buffer.from(JSON.stringify(raw.nextCursor)).toString('base64url') : null });
  }
  async write(input: unknown, attestation: { envelope: string; signature: string }, context?: IdempotencyContext) {
    return ConstructionDetailSchema.parse(await this.rpc('construction_write', { p_input: input, p_context: context ?? null,
      p_envelope: attestation.envelope, p_signature: attestation.signature }));
  }
}
