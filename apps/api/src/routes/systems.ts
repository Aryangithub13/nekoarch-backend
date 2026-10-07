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
import { SYSTEMS_LIMITS, SystemsInputSchema, SystemsReadQuerySchema } from '../systems/contracts.js';
import { SYSTEMS_ANALYSIS_OPERATION, SYSTEMS_ROOT, createSystemsAnalysis, listSystemsAnalyses, readSystemsAnalysis, systemsStatus,
  validateSystems } from '../services/systems-service.js';

/** Iterative preflight (size, depth, node count, finite numbers) before schema parsing. */
function systemsInput(body: unknown) {
  try { bounded(body ?? null, SYSTEMS_LIMITS.inputBytes); }
  catch (error) {
    if (error instanceof BimError && error.code === 'BIM_RESOURCE_LIMIT') throw new ApiError(422, 'BUILDING_SYSTEMS_RESOURCE_LIMIT', 'Building-systems input exceeds the resource budget');
    if (error instanceof BimError) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed');
    throw error;
  }
  return parseRequest(SystemsInputSchema, body ?? {});
}

export function systemsRoutes(app: FastifyInstance, backend: Backend, env: Env) {
  const bodyLimit = SYSTEMS_LIMITS.inputBytes;
  app.post(`${SYSTEMS_ROOT}/validate`, { bodyLimit }, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return validateSystems(repository, projectId, revisionId, systemsInput(request.body));
  });
  app.post(SYSTEMS_ANALYSIS_OPERATION, { bodyLimit }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    const input = systemsInput(request.body), started = performance.now();
    let executionMs: number | null = null;
    try {
      // Recheck ownership even when durableCommand returns an existing receipt.
      await new ProjectRepository(repository).read('revision', projectId, revisionId);
      const detail = await durableCommand(request, repository, { projectId, revisionId, input }, context =>
        createSystemsAnalysis(repository, userId!, projectId, revisionId, input, env.PROJECT_COMMIT_SECRET, context, ms => { executionMs = ms; }));
      request.log.info({ projectId, revisionId, analysisId: detail.id, calculator: detail.calculator.name, calculatorVersion: detail.calculator.version, status: detail.status,
        executionMs, durationMs: performance.now() - started, ...detail.counts }, 'building-systems analysis created');
      return reply.code(201).send(detail);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode < 500) request.log.info({ projectId, revisionId, code: error.code, durationMs: performance.now() - started }, 'building-systems analysis rejected');
      throw error;
    }
  });
  app.get(SYSTEMS_ANALYSIS_OPERATION, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return listSystemsAnalyses(repository, projectId, revisionId, parseRequest(PageQuerySchema, request.query));
  });
  app.get(`${SYSTEMS_ANALYSIS_OPERATION}/:analysisId`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId, analysisId } = parseRequest(RevisionParamsSchema.extend({ analysisId: z.string().uuid() }), request.params);
    const query = parseRequest(SystemsReadQuerySchema, request.query);
    return readSystemsAnalysis(repository, projectId, revisionId, analysisId, query.require === 'current');
  });
  app.get(`${SYSTEMS_ROOT}/status`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    parseRequest(z.object({}).strict(), request.query);
    return systemsStatus(repository, projectId, revisionId);
  });
}
