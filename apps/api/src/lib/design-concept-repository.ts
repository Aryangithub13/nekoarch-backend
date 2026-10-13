import { z } from 'zod';
import type { Repository } from './repository.js';
import { ApiError, parseRequest } from './errors.js';
import { projectDatabaseError } from './project-repository.js';
import { DesignConceptCursorSchema, DesignConceptSetSchema, DesignConceptSummarySchema } from '../contracts/design-concepts.js';

export function designConceptDatabaseError(error: { code?: string }): never {
  const errors: Record<string, [number, string, string]> = {
    P3901: [404, 'DESIGN_CONCEPT_NOT_FOUND', 'Design concept set not found'],
    P3902: [422, 'REVISION_NOT_ACCEPTED', 'Revision has no accepted QA evidence'],
    P3903: [422, 'DESIGN_CONCEPT_INVALID', 'Design concept provenance validation failed'],
    P3904: [429, 'DESIGN_CONCEPT_QUOTA_EXCEEDED', 'The daily quota of provider-generated design concepts is exhausted; template concepts remain available'],
  };
  const mapped = error.code ? errors[error.code] : undefined;
  if (mapped) throw new ApiError(...mapped);
  projectDatabaseError(error);
}

const current = z.string().uuid().nullable();
const Detail = z.object({ projectCurrentRevisionId: current, conceptSet: z.unknown(), replayed: z.boolean() }).passthrough();
/** Storage boundary for design-concept sets (migration 0028). */
export class DesignConceptRepository {
  constructor(private readonly repository: Repository) {}
  private rpc(name: 'design_concept_read' | 'design_concept_write', args: Record<string, unknown>) {
    if (!this.repository.designConceptRpc) throw new ApiError(503, 'DESIGN_CONCEPTS_UNAVAILABLE', 'Design concept persistence is unavailable');
    return this.repository.designConceptRpc(name, args);
  }
  async write(input: unknown, attestation: { envelope: string; signature: string }) {
    return this.detail(await this.rpc('design_concept_write', { p_input: input, p_envelope: attestation.envelope, p_signature: attestation.signature }));
  }
  async read(projectId: string, revisionId: string, conceptSetId: string) {
    return this.detail(await this.rpc('design_concept_read', { p_action: 'get', p_project_id: projectId, p_revision_id: revisionId, p_concept_id: conceptSetId }));
  }
  /** The stored set for an identical input, if any, and the owner's provider-sourced sets in the last 24 hours (the quota pre-check). */
  async lookup(projectId: string, revisionId: string, inputHash: string) {
    const raw = z.object({ match: z.unknown().nullable(), providerSetsLast24h: z.number().int().min(0), projectCurrentRevisionId: current }).strict()
      .parse(await this.rpc('design_concept_read', { p_action: 'lookup', p_project_id: projectId, p_revision_id: revisionId, p_input_hash: inputHash }));
    return { match: raw.match === null ? null : this.detail(raw.match), providerSetsLast24h: raw.providerSetsLast24h };
  }
  async list(projectId: string, revisionId: string, query: { limit: number; cursor?: string | undefined }) {
    let cursor: unknown = null;
    if (query.cursor) {
      try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); }
      catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor'); }
      cursor = parseRequest(DesignConceptCursorSchema, cursor);
    }
    const raw = z.object({ items: z.array(DesignConceptSummarySchema).max(100), nextCursor: DesignConceptCursorSchema.nullable(), projectCurrentRevisionId: current }).strict().parse(
      await this.rpc('design_concept_read', { p_action: 'list', p_project_id: projectId, p_revision_id: revisionId, p_limit: query.limit, p_cursor: cursor }));
    return { ...raw, nextCursor: raw.nextCursor ? Buffer.from(JSON.stringify(raw.nextCursor)).toString('base64url') : null };
  }
  private detail(raw: unknown) {
    const { projectCurrentRevisionId, conceptSet, replayed, ...summary } = Detail.parse(raw);
    return { summary: DesignConceptSummarySchema.parse(summary), conceptSet: DesignConceptSetSchema.parse(conceptSet), projectCurrentRevisionId, replayed };
  }
}
