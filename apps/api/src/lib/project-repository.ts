import { z } from 'zod';
import type { Repository, IdempotencyContext } from './repository.js';
import { ApiError, databaseError, parseRequest } from './errors.js';
import { ProjectCursorSchema, RevisionCursorSchema, ProjectListSchema, RevisionListSchema } from '../contracts/projects.js';

export interface ProjectTransport {
  projectRpc(name: 'project_read' | 'project_write', args: Record<string, unknown>): Promise<unknown>;
}
export function projectDatabaseError(error: { code?: string }): never {
  const errors: Record<string, [number, string, string]> = {
    P8001: [409, 'IDEMPOTENCY_CONFLICT', 'The idempotency key was used for a different request'],
    P1201: [404, 'PROJECT_NOT_FOUND', 'Project not found'],
    P1202: [409, 'REVISION_CONFLICT', 'The project current revision has changed; reload before saving'],
    P1203: [409, 'PROJECT_ARCHIVED', 'Unarchive the project before creating a revision'],
    P1204: [422, 'BLUEPRINT_QA_FAILED', 'Independent blueprint QA rejected the revision'],
    P1205: [404, 'REVISION_NOT_FOUND', 'Revision not found'],
    // Phase 33 account quotas are enforced by triggers on projects, references and jobs, so every creation path can raise them.
    P3304: [429, 'ACCOUNT_QUOTA_EXCEEDED', 'The account quota is reached'],
  };
  const mapped = error.code ? errors[error.code] : undefined;
  if (mapped) throw new ApiError(...mapped);
  databaseError(error);
}
export class ProjectRepository {
  constructor(private readonly repository: Repository) {}
  private rpc(name: 'project_read' | 'project_write', args: Record<string, unknown>) {
    if (!this.repository.projectRpc) throw new ApiError(503, 'PROJECTS_UNAVAILABLE', 'Project persistence is unavailable');
    return this.repository.projectRpc(name, args);
  }
  read(action: 'get' | 'get-freshness' | 'revision' | 'public', projectId: string, revisionId?: string) {
    return this.rpc('project_read', { p_action: action, p_project_id: projectId, p_revision_id: revisionId ?? null });
  }
  async list(action: 'list' | 'history', query: { limit: number; cursor?: string | undefined }, projectId?: string) {
    const cursorSchema = action === 'list' ? ProjectCursorSchema : RevisionCursorSchema;
    let cursor: unknown = null;
    if (query.cursor) {
      try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); }
      catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor'); }
      cursor = parseRequest(cursorSchema, cursor);
    }
    const raw = z.object({ items: z.array(z.unknown()), nextCursor: cursorSchema.nullable() }).strict().parse(
      await this.rpc('project_read', { p_action: action, p_project_id: projectId ?? null, p_limit: query.limit, p_cursor: cursor }));
    const page = { items: raw.items, nextCursor: raw.nextCursor ? Buffer.from(JSON.stringify(raw.nextCursor)).toString('base64url') : null };
    return action === 'list' ? ProjectListSchema.parse(page) : RevisionListSchema.parse(page);
  }
  write(action: 'create' | 'update' | 'revision', input: unknown, context?: IdempotencyContext, attestation?: { envelope: string; signature: string }) {
    return this.rpc('project_write', { p_action: action, p_input: input, p_context: context ?? null,
      p_envelope: attestation?.envelope ?? null, p_signature: attestation?.signature ?? null });
  }
}
