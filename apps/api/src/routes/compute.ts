import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { ProjectParamsSchema } from '../contracts/projects.js';
import { EmptyBodySchema } from '../jobs/contracts.js';
import type { JobRunner } from '../jobs/runner.js';
import { COMPUTE_JOB, COMPUTE_JOBS, COMPUTE_LIMITS, COMPUTE_QUOTES, ComputeJobParamsSchema, QuoteRequestSchema, SubmitRequestSchema } from '../compute/contracts.js';
import { createQuote, readComputeJob, submitConsent } from '../compute/gateway.js';

/** Phase 36 gateway. Status is by polling `GET …/compute/jobs/:jobId`; cancellation uses the B32 route `POST …/jobs/:jobId/cancel`. */
export function computeRoutes(app: FastifyInstance, backend: Backend, env: Env, runner: JobRunner) {
  app.post(COMPUTE_QUOTES, { bodyLimit: COMPUTE_LIMITS.quoteBodyBytes }, async request => {
    const started = performance.now();
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params), body = parseRequest(QuoteRequestSchema, request.body);
    const quote = await createQuote(repository, userId!, projectId, body, env.COMPUTE_POLICY, env.PROJECT_COMMIT_SECRET);
    request.log.info({ projectId, kind: quote.kind, placement: quote.placement, providerId: quote.provider.providerId, quoteHash: quote.quoteHash,
      sourceRevisionId: quote.source.revisionId, durationMs: performance.now() - started }, 'compute quote issued');
    return quote;
  });
  app.post(COMPUTE_JOBS, { bodyLimit: COMPUTE_LIMITS.submitBodyBytes }, async (request, reply) => {
    const started = performance.now();
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params), body = parseRequest(SubmitRequestSchema, request.body);
    const result = await submitConsent(repository, runner, userId!, projectId, body, env.COMPUTE_POLICY, env.PROJECT_COMMIT_SECRET);
    request.log.info({ projectId, jobId: result.job.id, kind: result.dispatch.kind, placement: result.dispatch.placement, providerId: result.dispatch.providerId,
      quoteHash: result.dispatch.quoteHash, status: result.job.status, replayed: result.replayed, deduplicated: result.job.deduplicated ?? false,
      durationMs: performance.now() - started }, 'compute dispatch consented');
    return reply.code(result.replayed ? 200 : 202).header('Location', `/api/projects/${projectId}/compute/jobs/${result.job.id}`).header('Retry-After', '1').send(result);
  });
  app.get(COMPUTE_JOB, async request => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, jobId } = parseRequest(ComputeJobParamsSchema, request.params);
    parseRequest(EmptyBodySchema, request.query);
    const view = await readComputeJob(repository, runner, userId!, projectId, jobId, env.PROJECT_COMMIT_SECRET);
    request.log.info({ projectId, jobId, status: view.job.status, resultCheck: view.resultCheck.status, attempt: view.job.attempt }, 'compute job polled');
    return view;
  });
}
