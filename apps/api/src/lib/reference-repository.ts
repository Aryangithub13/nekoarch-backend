import { z } from 'zod';
import type { IdempotencyContext, Repository } from './repository.js';
import { ApiError, parseRequest } from './errors.js';
import { projectDatabaseError } from './project-repository.js';
import { REFERENCE_LIMITS, ReferenceCursorSchema, ReferenceDetailSchema, ReferenceSummarySchema } from '../references/contracts.js';

export function referenceDatabaseError(error: { code?: string }): never {
  const errors: Record<string, [number, string, string]> = {
    P3101: [404, 'REFERENCE_NOT_FOUND', 'Reference not found'],
    P3102: [404, 'REVISION_NOT_FOUND', 'Revision not found'],
    P3103: [422, 'REFERENCE_INTEGRITY_REJECTED', 'Reference bytes do not match their inspection'],
    P3104: [429, 'REFERENCE_LIMIT_EXCEEDED', 'The project reference limit is reached'],
    P3105: [500, 'REFERENCE_INTEGRITY_FAILURE', 'Reference integrity failure'],
    P3106: [409, 'REFERENCE_INVALID_TRANSITION', 'The reference cannot change to that state'],
    P3107: [404, 'REFERENCE_LINK_INVALID', 'The download link is invalid or expired'],
  };
  const mapped = error.code ? errors[error.code] : undefined;
  if (mapped) throw new ApiError(...mapped);
  projectDatabaseError(error);
}
const current = z.string().uuid().nullable();
const StoredDetailSchema = ReferenceDetailSchema.omit({ currency: true, deduplicated: true }).extend({ projectCurrentRevisionId: current, deduplicated: z.boolean().optional() }).strict();
const BytesSchema = ReferenceSummarySchema.extend({ bytesBase64: z.string().max(14_000_000), projectCurrentRevisionId: current.optional() }).strict();
export type Attestation = { envelope: string; signature: string };

/** Storage boundary for references: the Supabase and pg-backend adapters implement `referenceRpc` (bytes live in Postgres `bytea`). */
export class ReferenceRepository {
  constructor(private readonly repository: Repository) {}
  private rpc(name: 'reference_read' | 'reference_write' | 'reference_download', args: Record<string, unknown>) {
    if (!this.repository.referenceRpc) throw new ApiError(503, 'REFERENCES_UNAVAILABLE', 'Reference storage is unavailable');
    return this.repository.referenceRpc(name, args);
  }
  async detail(projectId: string, referenceId: string) {
    return StoredDetailSchema.parse(await this.rpc('reference_read', { p_action: 'get', p_project_id: projectId, p_reference_id: referenceId }));
  }
  async bytes(projectId: string, referenceId: string) {
    const { bytesBase64, projectCurrentRevisionId, ...summary } = BytesSchema.parse(await this.rpc('reference_read', { p_action: 'bytes', p_project_id: projectId, p_reference_id: referenceId }));
    return { summary, bytes: Buffer.from(bytesBase64, 'base64'), projectCurrentRevisionId: projectCurrentRevisionId ?? null };
  }
  async download(token: string) {
    const { bytesBase64, projectCurrentRevisionId: _current, ...summary } = BytesSchema.parse(await this.rpc('reference_download', { p_token: token }));
    return { summary, bytes: Buffer.from(bytesBase64, 'base64') };
  }
  async list(projectId: string, query: { limit: number; cursor?: string | undefined; status: string; purpose?: string | undefined; revisionId?: string | undefined }) {
    let cursor: unknown = null;
    if (query.cursor) {
      try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); }
      catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor'); }
      cursor = parseRequest(ReferenceCursorSchema, cursor);
    }
    const raw = z.object({ items: z.array(ReferenceSummarySchema).max(100), nextCursor: ReferenceCursorSchema.nullable(), projectCurrentRevisionId: current }).strict().parse(
      await this.rpc('reference_read', { p_action: 'list', p_project_id: projectId, p_limit: query.limit, p_cursor: cursor,
        p_filter: { status: query.status, purpose: query.purpose ?? null, revisionId: query.revisionId ?? null } }));
    return { ...raw, nextCursor: raw.nextCursor ? Buffer.from(JSON.stringify(raw.nextCursor)).toString('base64url') : null };
  }
  async usage(projectId: string) {
    return z.object({ references: z.number().int().min(0), storedBytes: z.number().int().min(0).max(REFERENCE_LIMITS.perProjectBytes + REFERENCE_LIMITS.maxBytes),
      attemptsLastHour: z.number().int().min(0) }).strict().parse(await this.rpc('reference_read', { p_action: 'usage', p_project_id: projectId }));
  }
  async write(action: 'upload' | 'update' | 'delete' | 'link', input: Record<string, unknown>, attestation: Attestation, context?: IdempotencyContext, bytes?: Buffer) {
    return StoredDetailSchema.parse(await this.rpc('reference_write', { p_action: action, p_input: input, p_bytes_base64: bytes ? bytes.toString('base64') : null,
      p_context: context ?? null, p_envelope: attestation.envelope, p_signature: attestation.signature }));
  }
  async recordRejection(input: Record<string, unknown>, attestation: Attestation) {
    return z.object({ recorded: z.literal(true) }).strict().parse(await this.rpc('reference_write', { p_action: 'reject', p_input: input, p_bytes_base64: null,
      p_context: null, p_envelope: attestation.envelope, p_signature: attestation.signature }));
  }
}
