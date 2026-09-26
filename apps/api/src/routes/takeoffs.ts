import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { durableCommand } from '../lib/idempotency.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { TakeoffRepository } from '../lib/takeoff-repository.js';
import { createTakeoff, TAKEOFF_OPERATION } from '../services/takeoff-service.js';
import { PageQuerySchema, RevisionParamsSchema } from '../contracts/projects.js';
import { TakeoffDetailSchema, TakeoffParamsSchema, TakeoffRequestSchema } from '../contracts/takeoffs.js';

export function takeoffsRoutes(app: FastifyInstance, backend: Backend, env: Env) {
  app.post(TAKEOFF_OPERATION, { bodyLimit: env.SMALL_BODY_LIMIT_BYTES }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    const input = parseRequest(TakeoffRequestSchema, request.body ?? {});
    // Recheck ownership even when durableCommand returns an existing receipt.
    await new ProjectRepository(repository).read('revision', projectId, revisionId);
    const result = TakeoffDetailSchema.parse(await durableCommand(request, repository, { projectId, revisionId, ...input }, context =>
      createTakeoff(repository, userId!, projectId, revisionId, input.options, env.PROJECT_COMMIT_SECRET, context)));
    request.log.info({ projectId, revisionId, takeoffId: result.id, takeoffEngineVersion: result.engineVersion,
      itemCount: result.summary.itemCount, warningCount: result.summary.warningCount }, 'quantity takeoff created');
    return reply.code(201).send(result);
  });
  app.get(TAKEOFF_OPERATION, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return new TakeoffRepository(repository).list(projectId, revisionId, parseRequest(PageQuerySchema, request.query));
  });
  app.get(`${TAKEOFF_OPERATION}/:takeoffId`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId, takeoffId } = parseRequest(TakeoffParamsSchema, request.params);
    return new TakeoffRepository(repository).read(projectId, revisionId, takeoffId);
  });
}
