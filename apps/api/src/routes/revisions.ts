import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { durableCommand } from '../lib/idempotency.js';
import { AppearanceResponseSchema, CandidateManifestResponseSchema, RevisionRepository, ValidationEvidenceSchema } from '../lib/revision-repository.js';
import { PageQuerySchema, ProjectParamsSchema, RevisionParamsSchema } from '../contracts/projects.js';
import { ApproveRequestSchema, EmptySchema, ExecuteRequestSchema, PreflightRequestSchema } from '../revision/contracts.js';
import { AppearancePool } from '../revision/pool.js';
import { REVISION_ROOT, approveOperation, closeOperation, compareOperation, createPreflight, executeOperation } from '../services/revision-service.js';
import { sendAsset } from './scene.js';

const OperationParams = ProjectParamsSchema.extend({ operationId: z.string().uuid() });

/** Phase 30 selective revision routes. Candidates are never served through the Phase 29 accepted-scene routes. */
export function revisionRoutes(app: FastifyInstance, backend: Backend, env: Env, provided?: AppearancePool) {
  let pool = provided ?? null;
  const workers = () => (pool ??= new AppearancePool());
  app.addHook('onClose', async () => { await pool?.close(); });
  const op = `${REVISION_ROOT}/:operationId`;

  app.post(REVISION_ROOT, { bodyLimit: 32_768 }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params), body = parseRequest(PreflightRequestSchema, request.body);
    const started = performance.now();
    const detail = await durableCommand(request, repository, { projectId, ...body }, context => createPreflight(repository, userId!, projectId, body, env.PROJECT_COMMIT_SECRET, context));
    request.log.info({ projectId, operationId: detail.id, status: detail.status, kind: detail.kind, durationMs: performance.now() - started }, 'revision preflight');
    return reply.code(201).send(detail);
  });
  app.get(REVISION_ROOT, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params);
    return new RevisionRepository(repository).list(projectId, parseRequest(PageQuerySchema, request.query));
  });
  app.get(op, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, operationId } = parseRequest(OperationParams, request.params);
    parseRequest(EmptySchema, request.query);
    return new RevisionRepository(repository).get(projectId, operationId);
  });
  app.post(`${op}/execute`, { bodyLimit: 4096 }, async request => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, operationId } = parseRequest(OperationParams, request.params), body = parseRequest(ExecuteRequestSchema, request.body);
    const started = performance.now();
    const detail = await durableCommand(request, repository, { projectId, operationId, ...body }, context =>
      executeOperation(repository, workers, userId!, projectId, operationId, body, env.PROJECT_COMMIT_SECRET, context));
    request.log.info({ projectId, operationId, status: detail.status, durationMs: performance.now() - started }, 'revision executed');
    return detail;
  });
  app.post(`${op}/approve`, { bodyLimit: 4096 }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, operationId } = parseRequest(OperationParams, request.params), body = parseRequest(ApproveRequestSchema, request.body);
    const result = await durableCommand(request, repository, { projectId, operationId, ...body }, context =>
      approveOperation(repository, userId!, projectId, operationId, body, env.PROJECT_COMMIT_SECRET, context));
    request.log.info({ projectId, operationId, committedRevisionId: result.operation.committedRevisionId }, 'revision approved and committed');
    return reply.code(201).send(result);
  });
  for (const action of ['reject', 'cancel'] as const) app.post(`${op}/${action}`, { bodyLimit: 1024 }, async request => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, operationId } = parseRequest(OperationParams, request.params);
    parseRequest(EmptySchema, request.body ?? {});
    return durableCommand(request, repository, { projectId, operationId, action }, context => closeOperation(repository, userId!, projectId, operationId, action, env.PROJECT_COMMIT_SECRET, context));
  });
  app.get(`${op}/comparison`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, operationId } = parseRequest(OperationParams, request.params);
    parseRequest(EmptySchema, request.query);
    return compareOperation(repository, projectId, operationId);
  });
  app.get(`${op}/validation`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, operationId } = parseRequest(OperationParams, request.params);
    parseRequest(EmptySchema, request.query);
    const revisions = new RevisionRepository(repository), detail = await revisions.get(projectId, operationId);
    return ValidationEvidenceSchema.parse({ operationId, status: detail.status, preflightHash: detail.preflightHash, candidateHash: detail.candidateHash, validation: detail.validation,
      failure: detail.failure, verifications: detail.preflight.verifications, locks: detail.preflight.locks, events: await revisions.events(projectId, operationId) });
  });
  app.get(`${op}/candidate/manifest`, async (request, reply) => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, operationId } = parseRequest(OperationParams, request.params);
    parseRequest(EmptySchema, request.query);
    const c = await new RevisionRepository(repository).candidate(projectId, operationId), state = c.operation.status === 'COMMITTED' ? 'COMMITTED' : 'UNACCEPTED';
    reply.header('Cache-Control', 'private, no-store').header('X-Candidate-Status', state).type('application/json; charset=utf-8');
    // The operation status changes over time, so this response is never answered with 304.
    return sendAsset(request, reply, c.artifact.binarySha256, JSON.stringify(CandidateManifestResponseSchema.parse({ acceptance: state === 'COMMITTED' ? 'COMMITTED' : 'CANDIDATE_PREVIEW_NOT_ACCEPTED',
      operation: c.operation, artifact: c.artifact, manifest: c.manifest })), false);
  });
  app.get(`${op}/candidate/glb`, async (request, reply) => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, operationId } = parseRequest(OperationParams, request.params);
    parseRequest(EmptySchema, request.query);
    const c = await new RevisionRepository(repository).candidateGlb(projectId, operationId);
    reply.header('Content-Type', 'model/gltf-binary').header('Cache-Control', 'private, no-store').header('X-Candidate-Status', c.operation.status === 'COMMITTED' ? 'COMMITTED' : 'UNACCEPTED')
      .header('Content-Disposition', `attachment; filename="candidate-${c.artifact.id}.glb"`).header('X-Content-Type-Options', 'nosniff');
    return sendAsset(request, reply, c.artifact.binarySha256, c.glb, true);
  });
  const appearance = '/api/projects/:projectId/revisions/:revisionId/appearance';
  app.get(appearance, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    parseRequest(EmptySchema, request.query);
    const r = new RevisionRepository(repository), [a, lineage] = await Promise.all([r.appearance(projectId, revisionId), r.lineage(projectId, revisionId)]);
    return AppearanceResponseSchema.parse({ ...a, status: a.appearance ? 'APPEARANCE_VARIANT' : 'DEFAULT_PLACEHOLDER', lineage });
  });
  app.get(`${appearance}/glb`, async (request, reply) => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    parseRequest(EmptySchema, request.query);
    const { artifact, glb } = await new RevisionRepository(repository).appearanceGlb(projectId, revisionId);
    reply.header('Content-Type', 'model/gltf-binary').header('Cache-Control', 'private, no-store').header('Content-Disposition', `attachment; filename="appearance-${artifact.id}.glb"`)
      .header('X-Content-Type-Options', 'nosniff');
    return sendAsset(request, reply, artifact.binarySha256, glb, true);
  });
}
