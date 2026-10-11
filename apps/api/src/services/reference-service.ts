import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import type { IdempotencyContext, Repository } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { ReferenceRepository } from '../lib/reference-repository.js';
import { signProjectCommit } from './project-service.js';
import { InspectionPoolError, type InspectionPool } from '../references/pool.js';
import { REFERENCE_DOWNLOAD_VERSION, REFERENCE_LIMITS, REFERENCE_MEDIA_TYPES, ReferenceDetailSchema, type InspectionReport, type ReferenceSummary,
  type ReferenceUploadQuerySchema, type ReferenceUpdateSchema } from '../references/contracts.js';

export const REFERENCE_ROOT = '/api/projects/:projectId/references';
export const REFERENCE_ITEM = `${REFERENCE_ROOT}/:referenceId`;
export const REFERENCE_LINKS = `${REFERENCE_ITEM}/download-links`;
export const REFERENCE_DOWNLOAD_ROUTE = '/api/reference-downloads';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** `image/png; charset=binary` → `image/png`; parameters never change the inspected type. */
export const mediaTypeOf = (header: unknown) => String(header ?? '').split(';')[0]!.trim().toLowerCase();
type Stored = Awaited<ReturnType<ReferenceRepository['detail']>>;

export const currency = (boundRevisionId: string | null, projectCurrentRevisionId: string | null) => ({
  status: boundRevisionId === null ? 'PROJECT_SCOPED' as const : boundRevisionId === projectCurrentRevisionId ? 'CURRENT' as const : 'STALE' as const,
  boundRevisionId, projectCurrentRevisionId });
/** API shape of a stored detail: the project pointer becomes a currency verdict. Also applied to idempotent replays, which return the stored shape. */
export function presentReference(stored: unknown) {
  const { projectCurrentRevisionId, ...detail } = ReferenceDetailSchema.omit({ currency: true }).extend({ projectCurrentRevisionId: z.string().uuid().nullable() }).strict().parse(stored);
  return ReferenceDetailSchema.parse({ ...detail, currency: currency(detail.boundRevisionId, projectCurrentRevisionId) });
}

function requireSupported(mediaType: string) {
  if (!(REFERENCE_MEDIA_TYPES as readonly string[]).includes(mediaType))
    throw new ApiError(415, 'REFERENCE_TYPE_UNSUPPORTED', `Supported reference types: ${REFERENCE_MEDIA_TYPES.join(', ')}`);
}
async function inspect(pool: InspectionPool, bytes: Buffer, mediaType: string) {
  try { return await pool.inspect(bytes, mediaType); }
  catch (error) {
    // Capacity, timeout, crash or inconsistent worker output: nothing is stored.
    if (error instanceof InspectionPoolError) throw new ApiError(503, error.code, error.message);
    throw error;
  }
}
const rejection = (report: InspectionReport) => report.findings.filter(f => f.severity === 'REJECT');

/** Inspects only: never stores bytes, never records an event. */
export async function validateReference(pool: InspectionPool, bytes: Buffer, mediaType: string) {
  requireSupported(mediaType);
  return { report: (await inspect(pool, bytes, mediaType)).report, stored: false as const };
}

/** Returns the stored detail (route presents it). A rejected file is audited by hash and finding codes, then refused with 422. */
export async function uploadReference(repository: Repository, pool: InspectionPool, userId: string, projectId: string, query: z.infer<typeof ReferenceUploadQuerySchema>,
  mediaType: string, bytes: Buffer, secret?: string, context?: IdempotencyContext): Promise<Stored> {
  if (!secret) throw new ApiError(503, 'REFERENCES_UNAVAILABLE', 'Reference storage is not configured');
  requireSupported(mediaType);
  const { report, stored } = await inspect(pool, bytes, mediaType);
  const references = new ReferenceRepository(repository);
  if (report.verdict === 'REJECTED' || !stored || !report.stored || !report.detectedMediaType) {
    const findings = rejection(report);
    const input = { action: 'reject', projectId, report: { originalSha256: report.original.sha256, originalBytes: report.original.bytes, codes: findings.map(f => f.code) } };
    await references.recordRejection(input, signProjectCommit(secret, userId, REFERENCE_ROOT, input));
    throw new ApiError(422, 'REFERENCE_REJECTED', 'The file failed inspection and was not stored', Object.fromEntries(findings.map(f => [f.code, [f.detail]])));
  }
  const segments = report.metadata.removed.map(r => r.segment);
  const provenance = { sourceKind: 'USER_UPLOAD', uploadedBy: userId, original: report.original, stored: report.stored,
    transformations: [...(segments.some(s => s !== 'MPF secondary') ? ['METADATA_REMOVED'] : []), ...(segments.includes('MPF secondary') ? ['MPF_SECONDARY_IMAGES'] : [])],
    inspection: report };
  const input = { action: 'upload', projectId, purpose: query.purpose, displayName: query.displayName ?? null, note: query.note ?? null,
    revisionId: query.revisionId ?? null, mediaType: report.detectedMediaType, provenance };
  return references.write('upload', input, signProjectCommit(secret, userId, REFERENCE_ROOT, input, context), context, stored);
}

export async function readReference(repository: Repository, projectId: string, referenceId: string) {
  return presentReference(await new ReferenceRepository(repository).detail(projectId, referenceId));
}
export async function listReferences(repository: Repository, projectId: string, query: { limit: number; cursor?: string | undefined; status: string; purpose?: string | undefined; revisionId?: string | undefined }) {
  const { items, nextCursor, projectCurrentRevisionId } = await new ReferenceRepository(repository).list(projectId, query);
  return { items: items.map(i => ({ ...i, currency: currency(i.boundRevisionId, projectCurrentRevisionId) })), nextCursor };
}
export async function referenceUsage(repository: Repository, projectId: string) {
  const usage = await new ReferenceRepository(repository).usage(projectId);
  return { projectId, ...usage, limits: { references: REFERENCE_LIMITS.perProjectReferences, storedBytes: REFERENCE_LIMITS.perProjectBytes,
    attemptsPerHour: REFERENCE_LIMITS.attemptsPerHour, maxFileBytes: REFERENCE_LIMITS.maxBytes }, supportedMediaTypes: [...REFERENCE_MEDIA_TYPES], malwareScan: 'NOT_PERFORMED' as const };
}

function requireSecret(secret?: string): string {
  if (!secret) throw new ApiError(503, 'REFERENCES_UNAVAILABLE', 'Reference storage is not configured');
  return secret;
}
export async function updateReference(repository: Repository, userId: string, projectId: string, referenceId: string, changes: z.infer<typeof ReferenceUpdateSchema>, secret?: string) {
  const input = { action: 'update', projectId, referenceId, changes };
  return presentReference(await new ReferenceRepository(repository).write('update', input, signProjectCommit(requireSecret(secret), userId, REFERENCE_ITEM, input)));
}
/** Returns the stored detail (route presents it, also for idempotent replays). */
export async function deleteReference(repository: Repository, userId: string, projectId: string, referenceId: string, secret?: string, context?: IdempotencyContext) {
  const input = { action: 'delete', projectId, referenceId };
  return new ReferenceRepository(repository).write('delete', input, signProjectCommit(requireSecret(secret), userId, REFERENCE_ITEM, input, context), context);
}

/**
 * Token = base64url(payload) "." hex HMAC-SHA256 under the commit key. SQL (reference_download) verifies it with the same key,
 * so an anonymous download never needs a service-role key, and rotating the key revokes every link.
 */
export function downloadToken(secret: string, payload: { r: string; p: string; u: string; s: string; e: number }) {
  const body = Buffer.from(JSON.stringify({ v: REFERENCE_DOWNLOAD_VERSION, ...payload })).toString('base64url');
  return `${body}.${createHmac('sha256', Buffer.from(secret, 'hex')).update(body).digest('hex')}`;
}
export async function issueDownloadLink(repository: Repository, userId: string, projectId: string, referenceId: string, expiresInSeconds: number, secret?: string) {
  const key = requireSecret(secret), expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds, input = { action: 'link', projectId, referenceId, expiresAt };
  const detail = await new ReferenceRepository(repository).write('link', input, signProjectCommit(key, userId, REFERENCE_LINKS, input));
  const token = downloadToken(key, { r: detail.id, p: projectId, u: userId, s: detail.storedSha256, e: expiresAt });
  return { url: `${REFERENCE_DOWNLOAD_ROUTE}?token=${token}`, expiresAt: new Date(expiresAt * 1000).toISOString(), referenceId: detail.id, storedSha256: detail.storedSha256 };
}

/** Bytes are re-hashed before they are served; a mismatch is an integrity failure, never a download. */
function verified(summary: ReferenceSummary, bytes: Buffer) {
  if (bytes.length !== summary.storedBytes || sha(bytes) !== summary.storedSha256) throw new ApiError(500, 'REFERENCE_INTEGRITY_FAILURE', 'Reference integrity failure');
  return { summary, bytes };
}
export async function readReferenceContent(repository: Repository, projectId: string, referenceId: string) {
  const { summary, bytes } = await new ReferenceRepository(repository).bytes(projectId, referenceId);
  if (summary.projectId !== projectId || summary.id !== referenceId) throw new ApiError(404, 'REFERENCE_NOT_FOUND', 'Reference not found');
  return verified(summary, bytes);
}
export async function downloadReference(repository: Repository, token: string) {
  const { summary, bytes } = await new ReferenceRepository(repository).download(token);
  return verified(summary, bytes);
}
