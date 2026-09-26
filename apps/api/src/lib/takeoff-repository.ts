import { z } from 'zod';
import type { Repository, IdempotencyContext } from './repository.js';
import { ApiError, parseRequest } from './errors.js';
import { projectDatabaseError } from './project-repository.js';
import { TakeoffCursorSchema, TakeoffDetailSchema, TakeoffListSchema, TakeoffSummarySchema } from '../contracts/takeoffs.js';

export function takeoffDatabaseError(error: { code?: string }): never {
  const errors: Record<string, [number, string, string]> = {
    P1301: [404, 'TAKEOFF_NOT_FOUND', 'Takeoff not found'],
    P1302: [422, 'REVISION_NOT_ACCEPTED', 'Revision has no accepted QA evidence'],
    P1303: [500, 'TAKEOFF_FAILED', 'Takeoff provenance validation failed'],
  };
  const mapped = error.code ? errors[error.code] : undefined;
  if (mapped) throw new ApiError(...mapped);
  projectDatabaseError(error);
}
export class TakeoffRepository {
  constructor(private readonly repository: Repository) {}
  private rpc(name: 'takeoff_read' | 'takeoff_write', args: Record<string, unknown>) {
    if (!this.repository.takeoffRpc) throw new ApiError(503, 'TAKEOFF_UNAVAILABLE', 'Takeoff persistence is unavailable');
    return this.repository.takeoffRpc(name, args);
  }
  async read(projectId: string, revisionId: string, takeoffId: string) {
    return TakeoffDetailSchema.parse(await this.rpc('takeoff_read', { p_project_id: projectId, p_revision_id: revisionId, p_takeoff_id: takeoffId }));
  }
  async list(projectId: string, revisionId: string, query: { limit: number; cursor?: string | undefined }) {
    let cursor: unknown = null;
    if (query.cursor) {
      try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); }
      catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor'); }
      cursor = parseRequest(TakeoffCursorSchema, cursor);
    }
    const raw = z.object({ items: z.array(TakeoffSummarySchema).max(100), nextCursor: TakeoffCursorSchema.nullable() }).strict().parse(
      await this.rpc('takeoff_read', { p_project_id: projectId, p_revision_id: revisionId, p_limit: query.limit, p_cursor: cursor }));
    return TakeoffListSchema.parse({ items: raw.items, nextCursor: raw.nextCursor ? Buffer.from(JSON.stringify(raw.nextCursor)).toString('base64url') : null });
  }
  async write(input: unknown, attestation: { envelope: string; signature: string }, context?: IdempotencyContext) {
    return TakeoffDetailSchema.parse(await this.rpc('takeoff_write', { p_input: input, p_context: context ?? null,
      p_envelope: attestation.envelope, p_signature: attestation.signature }));
  }
}
