import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { ApiError, parseRequest } from '../lib/errors.js';
import { durableCommand } from '../lib/idempotency.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { PageQuerySchema, RevisionParamsSchema } from '../contracts/projects.js';
import { OPTIMIZATION_LIMITS, OptimizationReadQuerySchema } from '../optimization/contracts.js';
import { OptimizationPool } from '../optimization/pool.js';
import { OPTIMIZATION_ROOT, OPTIMIZATION_STUDY_OPERATION, createOptimizationStudy, listOptimizationStudies, optimizationStatus, readOptimizationStudy,
  validateOptimization } from '../services/optimization-service.js';

/** Studies run in a bounded worker pool, created on first use and drained when the app closes; GET routes never compute. */
export function optimizationRoutes(app: FastifyInstance, backend: Backend, env: Env, provided?: OptimizationPool) {
  let pool = provided ?? null;
  const workers = () => (pool ??= new OptimizationPool());
  app.addHook('onClose', async () => { await pool?.close(); });
  const bodyLimit = OPTIMIZATION_LIMITS.inputBytes;
  app.post(`${OPTIMIZATION_ROOT}/validate`, { bodyLimit }, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return validateOptimization(repository, projectId, revisionId, request.body ?? {});
  });
  app.post(OPTIMIZATION_STUDY_OPERATION, { bodyLimit }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    const input = request.body ?? {}, started = performance.now();
    let run: { queueMs: number; workerMs: number } | null = null;
    try {
      // Recheck ownership even when durableCommand returns an existing receipt.
      await new ProjectRepository(repository).read('revision', projectId, revisionId);
      const detail = await durableCommand(request, repository, { projectId, revisionId, input }, context =>
        createOptimizationStudy(repository, workers(), userId!, projectId, revisionId, input, env.PROJECT_COMMIT_SECRET, context, r => { run = { queueMs: r.queueMs, workerMs: r.workerMs }; }));
      request.log.info({ projectId, revisionId, studyId: detail.id, status: detail.status, strategy: detail.strategy, mode: detail.mode, candidates: detail.candidateCount,
        valid: detail.validCount, ...(run ?? {}), durationMs: performance.now() - started }, 'optimization study created');
      return reply.code(201).send(detail);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode < 500) request.log.info({ projectId, revisionId, code: error.code, durationMs: performance.now() - started }, 'optimization study rejected');
      if (error instanceof ApiError && error.statusCode === 503) reply.header('Retry-After', '30');
      throw error;
    }
  });
  app.get(OPTIMIZATION_STUDY_OPERATION, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return listOptimizationStudies(repository, projectId, revisionId, parseRequest(PageQuerySchema, request.query));
  });
  app.get(`${OPTIMIZATION_STUDY_OPERATION}/:studyId`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId, studyId } = parseRequest(RevisionParamsSchema.extend({ studyId: z.string().uuid() }), request.params);
    const query = parseRequest(OptimizationReadQuerySchema, request.query);
    return readOptimizationStudy(repository, projectId, revisionId, studyId, query.require === 'current');
  });
  app.get(`${OPTIMIZATION_ROOT}/status`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    parseRequest(z.object({}).strict(), request.query);
    return optimizationStatus(repository, projectId, revisionId);
  });
}
