import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { durableCommand } from '../lib/idempotency.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { saveProjectRevision } from '../services/project-service.js';
import { projectOverview } from '../services/overview-service.js';
import { dependencyGraph, DEPENDENCY_GRAPH_ROUTE } from '../services/dependency-graph-service.js';
import { projectManifest } from '../services/project-manifest-service.js';
import { PROJECT_MANIFEST_ROUTE } from '../contracts/project-manifest.js';
import { ProjectReadQuerySchema } from '../contracts/freshness.js';
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
    const query = parseRequest(ProjectReadQuerySchema, request.query);
    const result = ProjectDetailSchema.parse(await new ProjectRepository(repository).read(query.includeFreshness === 'true' ? 'get-freshness' : 'get', projectId));
    request.log.info({ projectId, currentRevisionId: result.currentRevisionId, identity: result.currentRevision?.identity }, 'project current revision read');
    return result;
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
    const result = ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision', projectId, revisionId));
    request.log.info({ projectId, revisionId, identity: result.identity }, 'project revision read');
    return result;
  });
  app.get('/api/projects/:projectId/revisions/:revisionId/overview', async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    parseRequest(z.object({}).strict(), request.query);
    return projectOverview(repository, projectId, revisionId);
  });
  app.get(DEPENDENCY_GRAPH_ROUTE, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    parseRequest(z.object({}).strict(), request.query);
    return dependencyGraph(repository, projectId, revisionId);
  });
  app.get(PROJECT_MANIFEST_ROUTE, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    parseRequest(z.object({}).strict(), request.query);
    return projectManifest(repository, projectId, revisionId);
  });
  for (const source of ['generated', 'supplied'] as const) {
    const url = `/api/projects/:projectId/revisions${source === 'generated' ? '/generate' : ''}`;
    app.post(url, { bodyLimit: source === 'generated' ? env.SMALL_BODY_LIMIT_BYTES : env.BODY_LIMIT_BYTES }, async (request, reply) => {
      const { userId, repository } = await requestContext(request, backend, true);
      const { projectId } = parseRequest(ProjectParamsSchema, request.params);
      const input = source === 'generated' ? parseRequest(GenerateRevisionRequestSchema, request.body) : parseRequest(SaveRevisionRequestSchema, request.body);
      const result = RevisionCommitResponseSchema.parse(await durableCommand(request, repository, { projectId, ...input }, context =>
        saveProjectRevision(new ProjectRepository(repository), userId!, projectId, source, input, env.PROJECT_COMMIT_SECRET, context, request.log)));
      request.log.info({ projectId, revisionId: result.revision.id, revisionNumber: result.revision.revisionNumber,
        qaStatus: result.revision.qa.status, sourceMode: source, identity: result.revision.identity,
        committedCurrentRevisionId: result.project.currentRevisionId }, 'project revision result');
      return reply.code(201).send(result);
    });
  }
}
