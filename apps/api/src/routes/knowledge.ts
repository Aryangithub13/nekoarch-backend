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
import { KNOWLEDGE_LIMITS, KnowledgeInputSchema, KnowledgeReadQuerySchema } from '../knowledge/contracts.js';
import { KNOWLEDGE_ANALYSIS_OPERATION, KNOWLEDGE_ROOT, createKnowledgeAnalysis, knowledgePacks, knowledgeStatus, listKnowledgeAnalyses, readKnowledgeAnalysis,
  validateKnowledge } from '../services/knowledge-service.js';

/** Iterative preflight (size, depth, node count, plain JSON) before schema parsing. */
function knowledgeInput(body: unknown) {
  try { bounded(body ?? null, KNOWLEDGE_LIMITS.inputBytes); }
  catch (error) {
    if (error instanceof BimError && error.code === 'BIM_RESOURCE_LIMIT') throw new ApiError(422, 'KNOWLEDGE_RESOURCE_LIMIT', 'Knowledge input exceeds the resource budget');
    if (error instanceof BimError) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed');
    throw error;
  }
  return parseRequest(KnowledgeInputSchema, body ?? {});
}

export function knowledgeRoutes(app: FastifyInstance, backend: Backend, env: Env) {
  const bodyLimit = KNOWLEDGE_LIMITS.inputBytes;
  app.get(`${KNOWLEDGE_ROOT}/packs`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    parseRequest(z.object({}).strict(), request.query);
    return knowledgePacks(repository, projectId, revisionId);
  });
  app.post(`${KNOWLEDGE_ROOT}/validate`, { bodyLimit }, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return validateKnowledge(repository, projectId, revisionId, knowledgeInput(request.body));
  });
  app.post(KNOWLEDGE_ANALYSIS_OPERATION, { bodyLimit }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    const input = knowledgeInput(request.body), started = performance.now();
    let timings: { evaluatorMs: number; validatorMs: number } | null = null;
    try {
      // Recheck ownership even when durableCommand returns an existing receipt.
      await new ProjectRepository(repository).read('revision', projectId, revisionId);
      const detail = await durableCommand(request, repository, { projectId, revisionId, input }, context =>
        createKnowledgeAnalysis(repository, userId!, projectId, revisionId, input, env.PROJECT_COMMIT_SECRET, context, t => { timings = t; }));
      request.log.info({ projectId, revisionId, analysisId: detail.id, evaluator: detail.evaluator.name, evaluatorVersion: detail.evaluator.version, status: detail.status,
        ...(timings ?? {}), durationMs: performance.now() - started, ...detail.counts }, 'knowledge analysis created');
      return reply.code(201).send(detail);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode < 500) request.log.info({ projectId, revisionId, code: error.code, durationMs: performance.now() - started }, 'knowledge analysis rejected');
      throw error;
    }
  });
  app.get(KNOWLEDGE_ANALYSIS_OPERATION, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return listKnowledgeAnalyses(repository, projectId, revisionId, parseRequest(PageQuerySchema, request.query));
  });
  app.get(`${KNOWLEDGE_ANALYSIS_OPERATION}/:analysisId`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId, analysisId } = parseRequest(RevisionParamsSchema.extend({ analysisId: z.string().uuid() }), request.params);
    const query = parseRequest(KnowledgeReadQuerySchema, request.query);
    return readKnowledgeAnalysis(repository, projectId, revisionId, analysisId, query.require === 'current');
  });
  app.get(`${KNOWLEDGE_ROOT}/status`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    parseRequest(z.object({}).strict(), request.query);
    return knowledgeStatus(repository, projectId, revisionId);
  });
}
