import { z } from 'zod';
import type { IdempotencyContext, Repository } from './repository.js';
import { ApiError, parseRequest } from './errors.js';
import { projectDatabaseError } from './project-repository.js';
import { BriefCurrentSchema, BriefListSchema, BriefVersionSchema, LibraryCursorSchema, LibraryEntrySchema, LibraryItemSchema, UserSettingsSchema } from '../account/contracts.js';

export function accountDatabaseError(error: { code?: string }): never {
  const errors: Record<string, [number, string, string]> = {
    P3301: [409, 'VERSION_CONFLICT', 'The document was changed elsewhere; reload and retry'],
    P3302: [422, 'BRIEF_REFERENCE_INVALID', 'A linked reference is not a live reference of this project'],
    P3303: [404, 'BRIEF_VERSION_NOT_FOUND', 'Brief version not found'],
  };
  const mapped = error.code ? errors[error.code] : undefined;
  if (mapped) throw new ApiError(...mapped);
  projectDatabaseError(error);
}
type Rpc = 'account_read' | 'account_write' | 'library_search' | 'library_write' | 'brief_read' | 'brief_write' | 'context_read';
export type Attestation = { envelope: string; signature: string };
const StoredSettingsSchema = z.object({ version: z.number().int().min(0), settings: UserSettingsSchema.nullable(), updatedAt: z.string().nullable() }).strict();
const decodeCursor = <T extends z.ZodTypeAny>(schema: T, cursor?: string): z.infer<T> | null => {
  if (!cursor) return null;
  let value: unknown;
  try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor'); }
  return parseRequest(schema, value);
};
const encodeCursor = (cursor: unknown) => cursor ? Buffer.from(JSON.stringify(cursor)).toString('base64url') : null;

/** Storage boundary for Phase 33: the Supabase and pg-backend adapters implement `accountRpc`. */
export class AccountRepository {
  constructor(private readonly repository: Repository) {}
  private rpc(name: Rpc, args: Record<string, unknown>) {
    if (!this.repository.accountRpc) throw new ApiError(503, 'ACCOUNT_UNAVAILABLE', 'Account services are unavailable');
    return this.repository.accountRpc(name, args);
  }
  async settings() { return StoredSettingsSchema.parse(await this.rpc('account_read', { p_action: 'settings' })); }
  async writeSettings(input: Record<string, unknown>, attestation: Attestation) {
    return StoredSettingsSchema.parse(await this.rpc('account_write', { p_action: 'settings', p_input: input, p_envelope: attestation.envelope, p_signature: attestation.signature }));
  }
  async usage() {
    return z.object({ projects: z.object({ active: z.number(), archived: z.number() }).strict(), revisions: z.number(),
      references: z.object({ count: z.number(), storedBytes: z.number() }).strict(), jobs: z.object({ active: z.number(), submittedLast24h: z.number() }).strict() }).strict()
      .parse(await this.rpc('account_read', { p_action: 'usage' }));
  }
  async search(query: Record<string, unknown> & { sort: string; cursor?: string | undefined }) {
    const cursor = decodeCursor(LibraryCursorSchema, query.cursor);
    if (cursor && cursor.sort !== query.sort) throw new ApiError(400, 'VALIDATION_ERROR', 'The cursor belongs to a different sort order');
    const raw = z.object({ items: z.array(LibraryItemSchema).max(50), nextCursor: LibraryCursorSchema.nullable() }).strict()
      .parse(await this.rpc('library_search', { p_query: { ...query, cursor } }));
    return { items: raw.items, nextCursor: encodeCursor(raw.nextCursor) };
  }
  async writeLibrary(input: Record<string, unknown>, attestation: Attestation) {
    return LibraryEntrySchema.parse(await this.rpc('library_write', { p_action: 'update', p_input: input, p_envelope: attestation.envelope, p_signature: attestation.signature }));
  }
  async currentBrief(projectId: string) { return BriefCurrentSchema.parse(await this.rpc('brief_read', { p_action: 'current', p_project_id: projectId })); }
  async briefVersion(projectId: string, version: number) {
    return BriefVersionSchema.parse(await this.rpc('brief_read', { p_action: 'version', p_project_id: projectId, p_version: version }));
  }
  async briefList(projectId: string, query: { limit: number; cursor?: string | undefined }) {
    const cursor = decodeCursor(z.object({ version: z.number().int().positive() }).strict(), query.cursor);
    const raw = z.object({ projectId: z.string().uuid(), items: BriefListSchema.shape.items, nextCursor: z.object({ version: z.number().int().positive() }).strict().nullable() }).strict()
      .parse(await this.rpc('brief_read', { p_action: 'list', p_project_id: projectId, p_limit: query.limit, p_cursor: cursor }));
    return { ...raw, nextCursor: encodeCursor(raw.nextCursor) };
  }
  async writeBrief(input: Record<string, unknown>, attestation: Attestation, context?: IdempotencyContext) {
    return BriefVersionSchema.parse(await this.rpc('brief_write', { p_action: 'create', p_input: input, p_context: context ?? null,
      p_envelope: attestation.envelope, p_signature: attestation.signature }));
  }
  async context(projectId: string) { return z.record(z.unknown()).parse(await this.rpc('context_read', { p_project_id: projectId })); }
}
