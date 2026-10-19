import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { ApiError, parseRequest } from '../lib/errors.js';
import { ChangeSetSchema, ExecuteRequestSchema, INTEGRATION_ROUTES, IntegrationExecutionSchema, IntegrationPlanSchema, PlanParamsSchema } from '../contracts/integration.js';
import { executeIntegrationPlan, previewIntegrationPlan } from '../services/integration-service.js';

/**
 * B40 S1: change-set plans and their checkpointed execution. Owner-only; both in the generate rate-limit group (a plan builds the B37 graph, an execution
 * commits a revision and runs engines). A preview stores nothing (200). An execution that wrote anything is 201; a refusal is a 200 that wrote nothing.
 */
export function integrationRoutes(app: FastifyInstance, backend: Backend, env: Env) {
  app.post(INTEGRATION_ROUTES.plan, { bodyLimit: env.SMALL_BODY_LIMIT_BYTES }, async (request, reply) => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(PlanParamsSchema, request.params);
    const body = parseRequest(ChangeSetSchema, request.body ?? {});
    return reply.send(IntegrationPlanSchema.parse(await previewIntegrationPlan(repository, projectId, body)));
  });
  app.post(INTEGRATION_ROUTES.execute, { bodyLimit: env.SMALL_BODY_LIMIT_BYTES }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(PlanParamsSchema, request.params);
    const body = parseRequest(ExecuteRequestSchema, request.body ?? {});
    const key = request.headers['idempotency-key'];
    if (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)))
      throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must contain 1–128 letters, digits, dots, underscores, colons or hyphens');
    const result = IntegrationExecutionSchema.parse(await executeIntegrationPlan(repository, userId!, projectId, body,
      { secret: env.PROJECT_COMMIT_SECRET, log: request.log, idempotencyKey: key }));
    const wrote = result.tasks.some(t => t.status === 'COMPLETED');
    request.log.info({ projectId, status: result.status, committedRevisionId: result.committedRevisionId, tasks: result.tasks.map(t => `${t.taskId}:${t.status}`) },
      'integration plan executed');
    return reply.code(wrote ? 201 : 200).send(result);
  });
}
