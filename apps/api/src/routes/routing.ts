import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { ProjectDetailSchema } from '../contracts/projects.js';
import { ROUTING_CAPABILITIES_ROUTE, ROUTING_DECISIONS_ROUTE, RoutingParamsSchema, RoutingRequestSchema } from '../routing/contracts.js';
import { capabilityRegistry, routingDecision } from '../routing/registry.js';

/**
 * B43 S1: the capability registry (authenticated; provider ids and eligibility only, never endpoints or credential names) and the routing dry run for
 * a project (owner-only). Neither calls a provider nor stores anything.
 */
export function routingRoutes(app: FastifyInstance, backend: Backend, env: Env) {
  app.get(ROUTING_CAPABILITIES_ROUTE, async request => {
    await requestContext(request, backend, true);
    parseRequest(z.object({}).strict(), request.query);
    return capabilityRegistry(env.AI_ROUTING_CONFIG);
  });
  app.post(ROUTING_DECISIONS_ROUTE, { bodyLimit: 4096 }, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(RoutingParamsSchema, request.params);
    const body = parseRequest(RoutingRequestSchema, request.body ?? {});
    ProjectDetailSchema.parse(await new ProjectRepository(repository).read('get', projectId));
    return routingDecision(env.AI_ROUTING_CONFIG, projectId, body);
  });
}
