import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { durableCommand } from '../lib/idempotency.js';
import { PageQuerySchema, ProjectParamsSchema } from '../contracts/projects.js';
import { BriefCreateSchema, BriefVersionParamsSchema, EmptyQuerySchema, LibraryPatchSchema, LibraryQuerySchema, SettingsPatchSchema, BriefVersionSchema } from '../account/contracts.js';
import { BRIEF_ROUTE, BRIEF_VERSIONS_ROUTE, CONTEXT_ROUTE, LIBRARY_ROUTE, PROJECT_LIBRARY_ROUTE, SETTINGS_ROUTE, USAGE_ROUTE, accountUsage, briefVersion, createBrief,
  currentBrief, listBriefs, projectContext, readSettings, searchLibrary, updateLibrary, updateSettings } from '../services/account-service.js';

/** Phase 33: per-user settings and usage, the owner's project library, versioned briefs and the project context bundle. */
export function accountRoutes(app: FastifyInstance, backend: Backend, env: Env) {
  app.get(SETTINGS_ROUTE, async request => {
    const { repository } = await requestContext(request, backend, true);
    parseRequest(EmptyQuerySchema, request.query);
    return readSettings(repository);
  });
  app.patch(SETTINGS_ROUTE, { bodyLimit: 4096 }, async request => {
    const { userId, repository } = await requestContext(request, backend, true);
    return updateSettings(repository, userId!, parseRequest(SettingsPatchSchema, request.body), env.PROJECT_COMMIT_SECRET);
  });
  app.get(USAGE_ROUTE, async request => {
    const { repository } = await requestContext(request, backend, true);
    parseRequest(EmptyQuerySchema, request.query);
    return accountUsage(repository);
  });
  app.get(LIBRARY_ROUTE, async request => {
    const { repository } = await requestContext(request, backend, true);
    return searchLibrary(repository, parseRequest(LibraryQuerySchema, request.query));
  });
  app.patch(PROJECT_LIBRARY_ROUTE, { bodyLimit: 4096 }, async request => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params);
    return updateLibrary(repository, userId!, projectId, parseRequest(LibraryPatchSchema, request.body), env.PROJECT_COMMIT_SECRET);
  });
  app.get(BRIEF_ROUTE, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params);
    parseRequest(EmptyQuerySchema, request.query);
    return currentBrief(repository, projectId);
  });
  app.get(BRIEF_VERSIONS_ROUTE, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params);
    return listBriefs(repository, projectId, parseRequest(PageQuerySchema, request.query));
  });
  app.post(BRIEF_VERSIONS_ROUTE, { bodyLimit: 49_152 }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params), body = parseRequest(BriefCreateSchema, request.body);
    const version = BriefVersionSchema.parse(await durableCommand(request, repository, { projectId, ...body }, context =>
      createBrief(repository, userId!, projectId, body, env.PROJECT_COMMIT_SECRET, context)));
    return reply.code(201).send(version);
  });
  app.get(`${BRIEF_VERSIONS_ROUTE}/:version`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, version } = parseRequest(BriefVersionParamsSchema, request.params);
    parseRequest(EmptyQuerySchema, request.query);
    return briefVersion(repository, projectId, version);
  });
  app.get(CONTEXT_ROUTE, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params);
    parseRequest(EmptyQuerySchema, request.query);
    return projectContext(repository, projectId);
  });
}
