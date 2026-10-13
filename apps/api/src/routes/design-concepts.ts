import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { RevisionParamsSchema } from '../contracts/projects.js';
import { DesignConceptDetailSchema, DesignConceptListSchema, DesignConceptPageQuerySchema, DesignConceptParamsSchema, DesignConceptReadQuerySchema,
  DesignConceptRequestSchema } from '../contracts/design-concepts.js';
import type { AiAdapter } from '../ai/orchestration/registry.js';
import { createTaskOrchestrator } from '../ai/orchestration/tasks.js';
import { DESIGN_ROOT, DesignConceptService, conceptDetail, listDesignConcepts, readDesignConcept } from '../services/design-concept-service.js';

/**
 * Phase 39: advisory interior and exterior design concepts with bounded alternatives. Creation is in the generate rate-limit group (it may call
 * a configured provider). Provider selection, credentials and transport stay behind the task orchestrator; `adapters` is a server-side test seam.
 */
export function designConceptRoutes(app: FastifyInstance, backend: Backend, env: Env, adapters?: ReadonlyMap<string, AiAdapter>) {
  const orchestrator = createTaskOrchestrator({ policy: env.AI_ROUTING_CONFIG, credentials: env.AI_PROVIDER_CREDENTIALS, disabled: env.AI_CONVERSATION_MODE === 'disabled',
    ...(adapters ? { adapters } : {}), observe: event => app.log.info(event, 'AI provider attempt') });
  const service = new DesignConceptService(orchestrator, orchestrator.registry.policy, env.PROJECT_COMMIT_SECRET);
  app.post(DESIGN_ROOT, { bodyLimit: env.SMALL_BODY_LIMIT_BYTES }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    const body = parseRequest(DesignConceptRequestSchema, request.body ?? {});
    // A client disconnect does not abort a provider call already in flight: the bounded result is stored, so a retry replays it instead of paying twice.
    const detail = DesignConceptDetailSchema.parse(conceptDetail(await service.create(repository, userId!, projectId, revisionId, body)));
    return reply.code(detail.replayed ? 200 : 201).send(detail);
  });
  app.get(DESIGN_ROOT, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return DesignConceptListSchema.parse(await listDesignConcepts(repository, projectId, revisionId, parseRequest(DesignConceptPageQuerySchema, request.query)));
  });
  app.get(`${DESIGN_ROOT}/:conceptSetId`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId, conceptSetId } = parseRequest(DesignConceptParamsSchema, request.params);
    const query = parseRequest(DesignConceptReadQuerySchema, request.query);
    return DesignConceptDetailSchema.parse(await readDesignConcept(repository, projectId, revisionId, conceptSetId, query.require === 'current'));
  });
}
