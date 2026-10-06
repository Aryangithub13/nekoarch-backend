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
import { BimError } from '../bim/contracts.js';
import { bounded } from '../bim/core.js';
import { STRUCTURAL_LIMITS, StructuralInputSchema, StructuralReadQuerySchema } from '../structural/contracts.js';
import { STRUCTURAL_ANALYSIS_OPERATION, STRUCTURAL_ROOT, createStructuralAnalysis, listStructuralAnalyses, readStructuralAnalysis, structuralStatus,
  validateStructural } from '../services/structural-service.js';

/** Iterative preflight (size, depth, node count, finite numbers) before schema parsing. */
function structuralInput(body: unknown) {
  try { bounded(body ?? null, STRUCTURAL_LIMITS.inputBytes); }
  catch (error) {
    if (error instanceof BimError && error.code === 'BIM_RESOURCE_LIMIT') throw new ApiError(422, 'STRUCTURAL_RESOURCE_LIMIT', 'Structural input exceeds the resource budget');
    if (error instanceof BimError) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed');
    throw error;
  }
  return parseRequest(StructuralInputSchema, body ?? {});
}

export function structuralRoutes(app: FastifyInstance, backend: Backend, env: Env) {
  const bodyLimit = STRUCTURAL_LIMITS.inputBytes;
  app.post(`${STRUCTURAL_ROOT}/validate`, { bodyLimit }, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return validateStructural(repository, projectId, revisionId, structuralInput(request.body));
  });
  app.post(STRUCTURAL_ANALYSIS_OPERATION, { bodyLimit }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    const input = structuralInput(request.body), started = performance.now();
    let solverMs: number | null = null;
    try {
      // Recheck ownership even when durableCommand returns an existing receipt.
      await new ProjectRepository(repository).read('revision', projectId, revisionId);
      const detail = await durableCommand(request, repository, { projectId, revisionId, input }, context =>
        createStructuralAnalysis(repository, userId!, projectId, revisionId, input, env.PROJECT_COMMIT_SECRET, context, timings => { solverMs = timings.solverMs; }));
      request.log.info({ projectId, revisionId, analysisId: detail.id, solverName: detail.solver.name, solverVersion: detail.solver.version, status: detail.status,
        solverMs, durationMs: performance.now() - started, ...detail.counts }, 'structural analysis created');
      return reply.code(201).send(detail);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode < 500) request.log.info({ projectId, revisionId, code: error.code, durationMs: performance.now() - started }, 'structural analysis rejected');
      throw error;
    }
  });
  app.get(STRUCTURAL_ANALYSIS_OPERATION, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return listStructuralAnalyses(repository, projectId, revisionId, parseRequest(PageQuerySchema, request.query));
  });
  app.get(`${STRUCTURAL_ANALYSIS_OPERATION}/:analysisId`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId, analysisId } = parseRequest(RevisionParamsSchema.extend({ analysisId: z.string().uuid() }), request.params);
    const query = parseRequest(StructuralReadQuerySchema, request.query);
    return readStructuralAnalysis(repository, projectId, revisionId, analysisId, query.require === 'current');
  });
  app.get(`${STRUCTURAL_ROOT}/status`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    parseRequest(z.object({}).strict(), request.query);
    return structuralStatus(repository, projectId, revisionId);
  });
}
