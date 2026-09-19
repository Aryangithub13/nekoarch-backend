import type { FastifyInstance } from 'fastify';
import { CreatePlanRequestSchema, CreatePlanResponseSchema, GetPlanResponseSchema, PatchPlanRequestSchema, PatchPlanResponseSchema, PlanParamsSchema } from '@designflow/shared';
import type { Backend } from '../lib/repository.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { createPlan, getPlan, patchPlan } from '../services/plan-service.js';
import { GeneratePlanRequestSchema } from '../contracts/generation.js';
import { generateAndSavePlan } from '../services/generation-service.js';

export function plansRoutes(app: FastifyInstance, backend: Backend) {
  app.post('/api/plans/generate', async (request, reply) => {
    const input = parseRequest(GeneratePlanRequestSchema, request.body);
    const { userId, repository } = await requestContext(request, backend, true);
    const result = await generateAndSavePlan(repository, userId!, input);
    return reply.code(201).send(CreatePlanResponseSchema.parse(result));
  });
  app.post('/api/plans', async (request, reply) => {
    const { plan } = parseRequest(CreatePlanRequestSchema, request.body);
    const { userId, repository } = await requestContext(request, backend, true);
    const result = await createPlan(repository, userId!, plan);
    return reply.code(201).send(CreatePlanResponseSchema.parse(result));
  });
  app.get('/api/plans/:id', async request => {
    const { id } = parseRequest(PlanParamsSchema, request.params);
    const { repository } = await requestContext(request, backend, false);
    return GetPlanResponseSchema.parse(await getPlan(repository, id));
  });
  app.patch('/api/plans/:id', async request => {
    const { id } = parseRequest(PlanParamsSchema, request.params);
    const { isPublic } = parseRequest(PatchPlanRequestSchema, request.body);
    const { repository } = await requestContext(request, backend, true);
    return PatchPlanResponseSchema.parse(await patchPlan(repository, id, isPublic));
  });
}
