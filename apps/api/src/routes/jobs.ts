import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { durableCommand } from '../lib/idempotency.js';
import { ProjectParamsSchema } from '../contracts/projects.js';
import { EmptyBodySchema, JobEventsQuerySchema, JobListQuerySchema, JobParamsSchema, JobRequestSchema } from '../jobs/contracts.js';
import type { JobRunner } from '../jobs/runner.js';
import { JOB_ITEM, JOB_ROOT, cancelJob, jobEvents, listJobs, presentJob, readJob, retryJob, submitJob } from '../services/job-service.js';

/** Submission returns at once; the work runs in the shared runner. Reads recover interrupted jobs (design §6). */
export function jobRoutes(app: FastifyInstance, backend: Backend, env: Env, runner: JobRunner) {
  app.post(JOB_ROOT, { bodyLimit: 65_536 }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params), body = parseRequest(JobRequestSchema, request.body);
    const detail = presentJob(await durableCommand(request, repository, { projectId, request: body }, context =>
      submitJob(repository, runner, userId!, projectId, body, env.PROJECT_COMMIT_SECRET, context)));
    request.log.info({ projectId, jobId: detail.id, kind: detail.kind, status: detail.status, deduplicated: detail.deduplicated ?? false }, 'job submitted');
    return reply.code(detail.deduplicated ? 200 : 202).header('Location', `/api/projects/${projectId}/jobs/${detail.id}`).header('Retry-After', '1').send(detail);
  });
  app.get(JOB_ROOT, async request => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params);
    return listJobs(repository, runner, userId!, projectId, parseRequest(JobListQuerySchema, request.query), env.PROJECT_COMMIT_SECRET);
  });
  app.get(JOB_ITEM, async request => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, jobId } = parseRequest(JobParamsSchema, request.params);
    parseRequest(EmptyBodySchema, request.query);
    return readJob(repository, runner, userId!, projectId, jobId, env.PROJECT_COMMIT_SECRET);
  });
  app.get(`${JOB_ITEM}/events`, async request => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, jobId } = parseRequest(JobParamsSchema, request.params), { after, limit } = parseRequest(JobEventsQuerySchema, request.query);
    return jobEvents(repository, runner, userId!, projectId, jobId, after, limit, env.PROJECT_COMMIT_SECRET);
  });
  app.post(`${JOB_ITEM}/cancel`, { bodyLimit: 1024 }, async request => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, jobId } = parseRequest(JobParamsSchema, request.params);
    parseRequest(EmptyBodySchema, request.body ?? {});
    return cancelJob(repository, runner, userId!, projectId, jobId, env.PROJECT_COMMIT_SECRET);
  });
  app.post(`${JOB_ITEM}/retry`, { bodyLimit: 1024 }, async request => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, jobId } = parseRequest(JobParamsSchema, request.params);
    parseRequest(EmptyBodySchema, request.body ?? {});
    return retryJob(repository, runner, userId!, projectId, jobId, env.PROJECT_COMMIT_SECRET);
  });
}
