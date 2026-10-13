import { z } from 'zod';
import type { Repository } from './repository.js';
import { ApiError, parseRequest } from './errors.js';
import { projectDatabaseError } from './project-repository.js';
import { EvidenceCursorSchema, EvidencePackageSchema, EvidenceSummarySchema } from '../contracts/evidence.js';

export function evidenceDatabaseError(error: { code?: string }): never {
  const errors: Record<string, [number, string, string]> = {
    P3801: [404, 'EVIDENCE_PACKAGE_NOT_FOUND', 'Evidence package not found'],
    P3802: [422, 'REVISION_NOT_ACCEPTED', 'Revision has no accepted QA evidence'],
    P3803: [422, 'EVIDENCE_PACKAGE_INVALID', 'Evidence package provenance validation failed'],
    P3804: [409, 'EVIDENCE_SOURCE_STALE', 'The revision was superseded while the package was assembled; nothing was stored'],
  };
  const mapped = error.code ? errors[error.code] : undefined;
  if (mapped) throw new ApiError(...mapped);
  projectDatabaseError(error);
}

const current = z.string().uuid().nullable();
/** Storage boundary for evidence packages (migration 0027). */
export class EvidenceRepository {
  constructor(private readonly repository: Repository) {}
  private rpc(name: 'evidence_read' | 'evidence_write', args: Record<string, unknown>) {
    if (!this.repository.evidenceRpc) throw new ApiError(503, 'EVIDENCE_UNAVAILABLE', 'Evidence persistence is unavailable');
    return this.repository.evidenceRpc(name, args);
  }
  async write(input: unknown, attestation: { envelope: string; signature: string }) {
    return this.detail(await this.rpc('evidence_write', { p_input: input, p_envelope: attestation.envelope, p_signature: attestation.signature }));
  }
  async read(projectId: string, revisionId: string, packageId: string) {
    return this.detail(await this.rpc('evidence_read', { p_action: 'get', p_project_id: projectId, p_revision_id: revisionId, p_package_id: packageId }));
  }
  async list(projectId: string, revisionId: string, query: { limit: number; cursor?: string | undefined }) {
    let cursor: unknown = null;
    if (query.cursor) {
      try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); }
      catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor'); }
      cursor = parseRequest(EvidenceCursorSchema, cursor);
    }
    const raw = z.object({ items: z.array(EvidenceSummarySchema).max(100), nextCursor: EvidenceCursorSchema.nullable(), projectCurrentRevisionId: current }).strict().parse(
      await this.rpc('evidence_read', { p_action: 'list', p_project_id: projectId, p_revision_id: revisionId, p_limit: query.limit, p_cursor: cursor }));
    return { ...raw, nextCursor: raw.nextCursor ? Buffer.from(JSON.stringify(raw.nextCursor)).toString('base64url') : null };
  }
  private detail(raw: unknown) {
    const { projectCurrentRevisionId, package: pkg, ...summary } = z.object({ projectCurrentRevisionId: current, package: z.unknown() }).passthrough().parse(raw);
    return { summary: EvidenceSummarySchema.parse(summary), package: EvidencePackageSchema.parse(pkg), projectCurrentRevisionId };
  }
}
