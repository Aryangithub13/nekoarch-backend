import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { durableCommand } from '../lib/idempotency.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { saveProjectRevision } from '../services/project-service.js';
import { CreateProjectRequestSchema, UpdateProjectRequestSchema, SaveRevisionRequestSchema, GenerateRevisionRequestSchema,
  ProjectDetailSchema, ProjectRevisionDetailSchema, PublicProjectSchema, ProjectParamsSchema, RevisionParamsSchema,
  PageQuerySchema, RevisionCommitResponseSchema } from '../contracts/projects.js';

export function projectsRoutes(app: FastifyInstance, backend: Backend, env: Env) {
  app.post('/api/projects', { bodyLimit: env.SMALL_BODY_LIMIT_BYTES }, async (request, reply) => {
    const { repository } = await requestContext(request, backend, true);
    const input = parseRequest(CreateProjectRequestSchema, request.body);
    const result = await durableCommand(request, repository, input, context => new ProjectRepository(repository).write('create', input, context));
    return reply.code(201).send(ProjectDetailSchema.parse(result));
  });
  app.get('/api/projects', async request => {
    const { repository } = await requestContext(request, backend, true);
    return new ProjectRepository(repository).list('list', parseRequest(PageQuerySchema, request.query));
  });
  app.get('/api/projects/:projectId/public', async request => {
    const { repository } = await requestContext(request, backend, false);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params);
    return PublicProjectSchema.parse(await new ProjectRepository(repository).read('public', projectId));
  });
  app.get('/api/projects/:projectId', async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params);
    return ProjectDetailSchema.parse(await new ProjectRepository(repository).read('get', projectId));
  });
  app.patch('/api/projects/:projectId', { bodyLimit: env.SMALL_BODY_LIMIT_BYTES }, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params);
    const input = parseRequest(UpdateProjectRequestSchema, request.body);
    return ProjectDetailSchema.parse(await new ProjectRepository(repository).write('update', { projectId, ...input }));
  });
  app.get('/api/projects/:projectId/revisions', async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params);
    return new ProjectRepository(repository).list('history', parseRequest(PageQuerySchema, request.query), projectId);
  });
  app.get('/api/projects/:projectId/revisions/:revisionId', async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision', projectId, revisionId));
  });
  for (const source of ['generated', 'supplied'] as const) {
    const url = `/api/projects/:projectId/revisions${source === 'generated' ? '/generate' : ''}`;
    app.post(url, { bodyLimit: source === 'generated' ? env.SMALL_BODY_LIMIT_BYTES : env.BODY_LIMIT_BYTES }, async (request, reply) => {
      const { userId, repository } = await requestContext(request, backend, true);
      const { projectId } = parseRequest(ProjectParamsSchema, request.params);
      const input = source === 'generated' ? parseRequest(GenerateRevisionRequestSchema, request.body) : parseRequest(SaveRevisionRequestSchema, request.body);
      const result = RevisionCommitResponseSchema.parse(await durableCommand(request, repository, { projectId, ...input }, context =>
        saveProjectRevision(new ProjectRepository(repository), userId!, projectId, source, input, env.PROJECT_COMMIT_SECRET, context)));
      request.log.info({ projectId, revisionId: result.revision.id, revisionNumber: result.revision.revisionNumber,
        qaStatus: result.revision.qa.status, sourceMode: source }, 'project revision accepted');
      return reply.code(201).send(result);
    });
  }
}
