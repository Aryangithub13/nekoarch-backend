import { costHash } from '@designflow/boq-cost';
import type { z } from 'zod';
import type { IdempotencyContext, Repository } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { AccountRepository } from '../lib/account-repository.js';
import { signProjectCommit } from './project-service.js';
import { ACCOUNT_LIMITS, CONTEXT_VERSION, ContextBundleSchema, DEFAULT_SETTINGS, NOT_CLAIMED_CONTEXT, SettingsDocumentSchema, UserSettingsSchema,
  type BriefCreateSchema, type LibraryPatchSchema, type LibraryQuerySchema, type SettingsPatchSchema } from '../account/contracts.js';

export const SETTINGS_ROUTE = '/api/me/settings';
export const USAGE_ROUTE = '/api/me/usage';
export const LIBRARY_ROUTE = '/api/library/projects';
export const PROJECT_LIBRARY_ROUTE = '/api/projects/:projectId/library';
export const BRIEF_ROUTE = '/api/projects/:projectId/brief';
export const BRIEF_VERSIONS_ROUTE = `${BRIEF_ROUTE}/versions`;
export const CONTEXT_ROUTE = '/api/projects/:projectId/context';

const need = (secret?: string): string => { if (!secret) throw new ApiError(503, 'ACCOUNT_UNAVAILABLE', 'Account persistence is not configured'); return secret; };

export async function readSettings(repository: Repository) {
  const stored = await new AccountRepository(repository).settings();
  return SettingsDocumentSchema.parse({ version: stored.version, settings: stored.settings ?? DEFAULT_SETTINGS, updatedAt: stored.updatedAt, isDefault: stored.settings === null });
}
/** Optimistic concurrency: the patch is applied to the version the client saw; SQL re-checks the version under a per-user lock. */
export async function updateSettings(repository: Repository, userId: string, patch: z.infer<typeof SettingsPatchSchema>, secret?: string) {
  const key = need(secret), current = await readSettings(repository);
  if (patch.expectedVersion !== current.version) throw new ApiError(409, 'VERSION_CONFLICT', 'The document was changed elsewhere; reload and retry');
  const settings = UserSettingsSchema.parse({ ...current.settings, ...patch.settings });
  const input = { action: 'settings', expectedVersion: patch.expectedVersion, settings };
  const stored = await new AccountRepository(repository).writeSettings(input, signProjectCommit(key, userId, SETTINGS_ROUTE, input));
  return SettingsDocumentSchema.parse({ version: stored.version, settings: stored.settings, updatedAt: stored.updatedAt, isDefault: false });
}
export async function accountUsage(repository: Repository) {
  return { ...await new AccountRepository(repository).usage(), limits: { ...ACCOUNT_LIMITS } };
}

export function searchLibrary(repository: Repository, query: z.infer<typeof LibraryQuerySchema>) {
  return new AccountRepository(repository).search({ q: query.q ?? null, status: query.status, visibility: query.visibility ?? null,
    starred: query.starred ?? null, tag: query.tag ?? null, sort: query.sort, limit: query.limit, cursor: query.cursor });
}
export function updateLibrary(repository: Repository, userId: string, projectId: string, patch: z.infer<typeof LibraryPatchSchema>, secret?: string) {
  const input = { action: 'update', projectId, ...patch };
  return new AccountRepository(repository).writeLibrary(input, signProjectCommit(need(secret), userId, PROJECT_LIBRARY_ROUTE, input));
}

export function currentBrief(repository: Repository, projectId: string) { return new AccountRepository(repository).currentBrief(projectId); }
export function briefVersion(repository: Repository, projectId: string, version: number) { return new AccountRepository(repository).briefVersion(projectId, version); }
export function listBriefs(repository: Repository, projectId: string, query: { limit: number; cursor?: string | undefined }) {
  return new AccountRepository(repository).briefList(projectId, query);
}
export function createBrief(repository: Repository, userId: string, projectId: string, body: z.infer<typeof BriefCreateSchema>, secret?: string, context?: IdempotencyContext) {
  const input = { action: 'create', projectId, expectedVersion: body.expectedVersion, brief: body.brief };
  return new AccountRepository(repository).writeBrief(input, signProjectCommit(need(secret), userId, BRIEF_VERSIONS_ROUTE, input, context), context);
}

/**
 * The bundle is read in one SQL statement (one snapshot). `contextHash` covers everything except the generation time, so an unchanged
 * project yields the same hash and later consumers can cite the exact context they used.
 */
export async function projectContext(repository: Repository, projectId: string) {
  const raw = await new AccountRepository(repository).context(projectId);
  const settings = (raw.settings as { version: number; settings: unknown } | null) ?? { version: 0, settings: DEFAULT_SETTINGS };
  const content = { contextVersion: CONTEXT_VERSION, projectId, project: raw.project, settings, brief: raw.brief ?? null, references: raw.references,
    currentRevision: raw.currentRevision ?? null, activeJobs: raw.activeJobs, claims: { ...NOT_CLAIMED_CONTEXT } };
  return ContextBundleSchema.parse({ ...content, contextHash: costHash(content), generatedAt: new Date().toISOString() });
}
