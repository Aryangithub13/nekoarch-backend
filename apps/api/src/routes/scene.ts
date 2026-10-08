import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { ApiError, parseRequest } from '../lib/errors.js';
import { durableCommand } from '../lib/idempotency.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { PageQuerySchema, RevisionParamsSchema } from '../contracts/projects.js';
import { ScenePool } from '../scene3d/pool.js';
import { SCENE_ARTIFACT_OPERATION, SCENE_ROOT, createSceneArtifact, listSceneArtifacts, readSceneArtifact, readSceneBinary, sceneStatus, validateScene } from '../services/scene-service.js';

const ArtifactParams = RevisionParamsSchema.extend({ artifactId: z.string().uuid() });
const ReadQuery = z.object({ require: z.literal('current').optional() }).strict();
const gzipAsync = promisify(gzip);
const acceptsGzip = (header: unknown) => String(header ?? '').split(',').some(part => {
  const [name, ...params] = part.split(';').map(s => s.trim().toLowerCase()), q = params.find(p => p.startsWith('q='));
  return name === 'gzip' && (!q || Number(q.slice(2)) > 0);
});
/** Scene assets compress 10–12× (Phase 29 fixtures, docs/modernization). Each encoding has its own strong ETag; a 304 is only sent for immutable bytes and only after authorization. */
async function sendAsset(request: FastifyRequest, reply: FastifyReply, etag: string, body: Buffer | string, immutable: boolean) {
  const gz = acceptsGzip(request.headers['accept-encoding']), tag = gz ? `"${etag}-gzip"` : `"${etag}"`;
  reply.header('Vary', 'Accept-Encoding').header('ETag', tag);
  const match = String(request.headers['if-none-match'] ?? '').split(',').map(t => t.trim().replace(/^W\//, ''));
  if (immutable && (match.includes(`"${etag}"`) || match.includes(`"${etag}-gzip"`))) return reply.code(304).send();
  return gz ? reply.header('Content-Encoding', 'gzip').send(await gzipAsync(body)) : reply.send(body);
}

/** Compiles run in a bounded worker pool created on first use and drained on close; GET routes never compile. */
export function sceneRoutes(app: FastifyInstance, backend: Backend, env: Env, provided?: ScenePool) {
  let pool = provided ?? null;
  const workers = () => (pool ??= new ScenePool());
  app.addHook('onClose', async () => { await pool?.close(); });
  const bodyLimit = 1024;
  app.post(`${SCENE_ROOT}/validate`, { bodyLimit }, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return validateScene(repository, projectId, revisionId, request.body ?? {});
  });
  app.post(SCENE_ARTIFACT_OPERATION, { bodyLimit }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    const input = request.body ?? {}, started = performance.now();
    let run: { queueMs: number; workerMs: number } | null = null;
    try {
      // Recheck ownership even when durableCommand returns an existing receipt.
      await new ProjectRepository(repository).read('revision', projectId, revisionId);
      const detail = await durableCommand(request, repository, { projectId, revisionId, input }, context =>
        createSceneArtifact(repository, workers(), userId!, projectId, revisionId, input, env.PROJECT_COMMIT_SECRET, context, r => { run = { queueMs: r.queueMs, workerMs: r.workerMs }; }));
      request.log.info({ projectId, revisionId, artifactId: detail.id, objects: detail.objectCount, triangles: detail.triangleCount, bytes: detail.binaryBytes,
        ...(run ?? {}), durationMs: performance.now() - started }, 'scene artifact created');
      return reply.code(201).send(detail);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode < 500) request.log.info({ projectId, revisionId, code: error.code, durationMs: performance.now() - started }, 'scene artifact rejected');
      if (error instanceof ApiError && error.statusCode === 503) reply.header('Retry-After', '30');
      throw error;
    }
  });
  app.get(SCENE_ARTIFACT_OPERATION, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return listSceneArtifacts(repository, projectId, revisionId, parseRequest(PageQuerySchema, request.query));
  });
  app.get(`${SCENE_ARTIFACT_OPERATION}/:artifactId`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId, artifactId } = parseRequest(ArtifactParams, request.params);
    const { manifest: _manifest, ...summary } = await readSceneArtifact(repository, projectId, revisionId, artifactId, parseRequest(ReadQuery, request.query).require === 'current');
    return summary;
  });
  app.get(`${SCENE_ARTIFACT_OPERATION}/:artifactId/manifest`, async (request, reply) => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId, artifactId } = parseRequest(ArtifactParams, request.params);
    const detail = await readSceneArtifact(repository, projectId, revisionId, artifactId, parseRequest(ReadQuery, request.query).require === 'current');
    // `currency` changes when the project advances, so this response is never answered with 304.
    reply.header('Cache-Control', 'private, no-store').type('application/json; charset=utf-8');
    return sendAsset(request, reply, detail.sceneHash, JSON.stringify({ artifactId: detail.id, sceneHash: detail.sceneHash, currency: detail.currency, manifest: detail.manifest }), false);
  });
  app.get(`${SCENE_ARTIFACT_OPERATION}/:artifactId/glb`, async (request, reply) => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId, artifactId } = parseRequest(ArtifactParams, request.params);
    const { summary, glb } = await readSceneBinary(repository, projectId, revisionId, artifactId, parseRequest(ReadQuery, request.query).require === 'current');
    // Private, uncached, fixed filename (uuid only): no untrusted name reaches a header or a path.
    reply.header('Content-Type', 'model/gltf-binary').header('Cache-Control', 'private, no-store')
      .header('Content-Disposition', `attachment; filename="scene-${summary.id}.glb"`).header('X-Content-Type-Options', 'nosniff');
    return sendAsset(request, reply, summary.binarySha256, glb, true);
  });
  app.get(`${SCENE_ROOT}/status`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    parseRequest(z.object({}).strict(), request.query);
    return sceneStatus(repository, projectId, revisionId);
  });
}
