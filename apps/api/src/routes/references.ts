import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Backend, Repository } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { ApiError, parseRequest } from '../lib/errors.js';
import { durableCommand } from '../lib/idempotency.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { ProjectParamsSchema } from '../contracts/projects.js';
import { InspectionPool } from '../references/pool.js';
import { DownloadLinkRequestSchema, DownloadTokenSchema, REFERENCE_EXTENSIONS, REFERENCE_LIMITS, ReferenceListQuerySchema, ReferenceParamsSchema,
  ReferenceUpdateSchema, ReferenceUploadQuerySchema, ReferenceValidateQuerySchema, type ReferenceSummary } from '../references/contracts.js';
import { REFERENCE_DOWNLOAD_ROUTE, REFERENCE_ITEM, REFERENCE_LINKS, REFERENCE_ROOT, deleteReference, downloadReference, issueDownloadLink, listReferences, mediaTypeOf,
  presentReference, readReference, readReferenceContent, referenceUsage, updateReference, uploadReference, validateReference } from '../services/reference-service.js';

const raw = (request: FastifyRequest) => Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
const empty = (request: FastifyRequest) => (request.body ?? {}) as unknown;

/** Private, uncached, fixed filename (uuid + type extension): no user-supplied name reaches a header or a path; a PDF cannot script its origin. */
function sendReference(request: FastifyRequest, reply: FastifyReply, summary: ReferenceSummary, bytes: Buffer) {
  const etag = `"${summary.storedSha256}"`;
  reply.header('Content-Type', summary.mediaType).header('Cache-Control', 'private, no-store').header('ETag', etag)
    .header('Content-Disposition', `attachment; filename="reference-${summary.id}.${REFERENCE_EXTENSIONS[summary.mediaType]}"`)
    .header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "sandbox; default-src 'none'");
  // Stored bytes are immutable, so a 304 is safe once the caller is authorized; every supported type is already compressed (no gzip).
  const match = String(request.headers['if-none-match'] ?? '').split(',').map(t => t.trim().replace(/^W\//, ''));
  return match.includes(etag) ? reply.code(304).send() : reply.send(bytes);
}

/** Inspection runs in a bounded worker pool created on first use and drained on close; reads never parse untrusted bytes. */
export function referenceRoutes(app: FastifyInstance, backend: Backend, env: Env, provided?: InspectionPool) {
  let pool = provided ?? null;
  const inspector = () => (pool ??= new InspectionPool());
  app.addHook('onClose', async () => { await pool?.close(); });
  const owned = (repository: Repository, projectId: string) => new ProjectRepository(repository).read('get', projectId);

  // Raw-body routes live in their own encapsulated scope, so no other route starts accepting binary bodies.
  app.register(async scope => {
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: REFERENCE_LIMITS.maxBytes }, (_request, body, done) => done(null, body));
    const bodyLimit = REFERENCE_LIMITS.maxBytes;
    scope.post(`${REFERENCE_ROOT}/validate`, { bodyLimit }, async request => {
      const { repository } = await requestContext(request, backend, true);
      const { projectId } = parseRequest(ProjectParamsSchema, request.params);
      parseRequest(ReferenceValidateQuerySchema, request.query);
      await owned(repository, projectId);
      return validateReference(inspector(), raw(request), mediaTypeOf(request.headers['content-type']));
    });
    scope.post(REFERENCE_ROOT, { bodyLimit }, async (request, reply) => {
      const { userId, repository } = await requestContext(request, backend, true);
      const { projectId } = parseRequest(ProjectParamsSchema, request.params);
      const query = parseRequest(ReferenceUploadQuerySchema, request.query), bytes = raw(request), mediaType = mediaTypeOf(request.headers['content-type']);
      const started = performance.now();
      try {
        // Ownership before any inspection work, and again for an idempotent replay.
        await owned(repository, projectId);
        const detail = presentReference(await durableCommand(request, repository, { projectId, query, mediaType, sha256: createHash('sha256').update(bytes).digest('hex') },
          context => uploadReference(repository, inspector(), userId!, projectId, query, mediaType, bytes, env.PROJECT_COMMIT_SECRET, context)));
        request.log.info({ projectId, referenceId: detail.id, mediaType: detail.mediaType, bytes: detail.storedBytes, deduplicated: detail.deduplicated ?? false,
          durationMs: performance.now() - started }, 'reference stored');
        return reply.code(detail.deduplicated ? 200 : 201).send(detail);
      } catch (error) {
        if (error instanceof ApiError && error.statusCode < 500) request.log.info({ projectId, code: error.code, durationMs: performance.now() - started }, 'reference refused');
        if (error instanceof ApiError && error.statusCode === 503) reply.header('Retry-After', '30');
        throw error;
      }
    });
  });

  app.get(REFERENCE_ROOT, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params);
    return listReferences(repository, projectId, parseRequest(ReferenceListQuerySchema, request.query));
  });
  app.get(`${REFERENCE_ROOT}/usage`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params);
    parseRequest(ReferenceValidateQuerySchema, request.query);
    return referenceUsage(repository, projectId);
  });
  app.get(REFERENCE_ITEM, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, referenceId } = parseRequest(ReferenceParamsSchema, request.params);
    parseRequest(ReferenceValidateQuerySchema, request.query);
    return readReference(repository, projectId, referenceId);
  });
  app.patch(REFERENCE_ITEM, { bodyLimit: 4096 }, async request => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, referenceId } = parseRequest(ReferenceParamsSchema, request.params);
    return updateReference(repository, userId!, projectId, referenceId, parseRequest(ReferenceUpdateSchema, request.body), env.PROJECT_COMMIT_SECRET);
  });
  app.delete(REFERENCE_ITEM, async request => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, referenceId } = parseRequest(ReferenceParamsSchema, request.params);
    await owned(repository, projectId);
    return presentReference(await durableCommand(request, repository, { projectId, referenceId }, context =>
      deleteReference(repository, userId!, projectId, referenceId, env.PROJECT_COMMIT_SECRET, context)));
  });
  app.get(`${REFERENCE_ITEM}/content`, async (request, reply) => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, referenceId } = parseRequest(ReferenceParamsSchema, request.params);
    parseRequest(ReferenceValidateQuerySchema, request.query);
    const { summary, bytes } = await readReferenceContent(repository, projectId, referenceId);
    return sendReference(request, reply, summary, bytes);
  });
  app.post(REFERENCE_LINKS, { bodyLimit: 1024 }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, referenceId } = parseRequest(ReferenceParamsSchema, request.params);
    const { expiresInSeconds } = parseRequest(DownloadLinkRequestSchema, empty(request));
    return reply.code(201).send(await issueDownloadLink(repository, userId!, projectId, referenceId, expiresInSeconds, env.PROJECT_COMMIT_SECRET));
  });
  // Anonymous: the token is the authorization. Every malformed, forged, expired or revoked token is the same 404.
  app.get(REFERENCE_DOWNLOAD_ROUTE, async (request, reply) => {
    const parsed = DownloadTokenSchema.safeParse(request.query);
    if (!parsed.success) throw new ApiError(404, 'REFERENCE_LINK_INVALID', 'The download link is invalid or expired');
    const { repository } = await requestContext(request, backend, false);
    const { summary, bytes } = await downloadReference(repository, parsed.data.token);
    return sendReference(request, reply, summary, bytes);
  });
}
