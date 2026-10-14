import { createHmac, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { Env } from '../config/env.js';
import { ApiError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest { consumeQuota: ((userId?: string) => Promise<void>) | null }
}

export async function installLimits(app: FastifyInstance, env: Env) {
  app.decorateRequest('consumeQuota', null);
  if (!env.RATE_LIMIT_ENABLED) return;
  await app.register(rateLimit, { global: false, timeWindow: env.RATE_LIMIT_WINDOW_MS, cache: 10_000 });
  const salt = randomBytes(32);
  const digest = (value: string) => createHmac('sha256', salt).update(value).digest('hex');
  const identities = new WeakMap<FastifyRequest, string>();
  const group = (request: FastifyRequest) => request.method === 'POST' && ['/api/projects/:projectId/conversations/:conversationId/messages', '/api/projects/:projectId/conversations/:conversationId/proposals/approve', '/api/projects/:projectId/requirements/interpret', '/api/plans/generate', '/api/projects/:projectId/workflows', '/api/projects/:projectId/revisions/generate', '/api/projects/:projectId/revisions', '/api/projects/:projectId/revisions/:revisionId/structural/analyses', '/api/projects/:projectId/revisions/:revisionId/structural/validate', '/api/projects/:projectId/revisions/:revisionId/environmental/analyses', '/api/projects/:projectId/revisions/:revisionId/environmental/validate', '/api/projects/:projectId/revisions/:revisionId/systems/analyses', '/api/projects/:projectId/revisions/:revisionId/systems/validate', '/api/projects/:projectId/revisions/:revisionId/optimization/studies', '/api/projects/:projectId/revisions/:revisionId/optimization/validate', '/api/projects/:projectId/revisions/:revisionId/scene/artifacts', '/api/projects/:projectId/revisions/:revisionId/scene/validate', '/api/projects/:projectId/revision-operations', '/api/projects/:projectId/revision-operations/:operationId/execute', '/api/projects/:projectId/references', '/api/projects/:projectId/references/validate', '/api/projects/:projectId/jobs', '/api/projects/:projectId/jobs/:jobId/retry', '/api/projects/:projectId/compute/jobs',
    // Phase 35: whole-model computation per request (regeneration with QA, its recomputation, and per-zone QA, verification, takeoff and BIM).
    '/api/projects/:projectId/revisions/:revisionId/engineering-assessment/zones/regeneration', '/api/projects/:projectId/revisions/:revisionId/engineering-assessment/zones/regeneration/verification',
    '/api/projects/:projectId/revisions/:revisionId/engineering-assessment/zones/partitions',
    // Phase 36: a turn may plan, assess or regenerate on read, and a decision executes the coordinated operation.
    '/api/projects/:projectId/conversations/:conversationId/turns', '/api/projects/:projectId/conversations/:conversationId/actions/:actionId/decisions',
    '/api/projects/:projectId/conversations/:conversationId/rebase',
    // Phase 38: an evidence package builds the Phase 37 graph, the Phase 35 assessment and every construction document of the revision.
    '/api/projects/:projectId/revisions/:revisionId/evidence-packages',
    // Phase 39: a design-concept request may call a configured AI provider.
    '/api/projects/:projectId/revisions/:revisionId/design-concepts',
    // B39 S1: a specialist request may generate a revision (Blueprint) or run the takeoff, construction and cost engines.
    '/api/projects/:projectId/specialists/:module/requests'].includes(request.routeOptions.url ?? '') ? 'generate'
    : ['POST', 'PATCH', 'DELETE'].includes(request.method) ? 'write' : 'read';
  const perimeter = app.createRateLimit({ max: env.RATE_LIMIT_IP, keyGenerator: req => digest(`ip:${req.ip}`) });
  const operation = app.createRateLimit({
    max: req => ({ generate: env.RATE_LIMIT_GENERATE, write: env.RATE_LIMIT_WRITE, read: env.RATE_LIMIT_READ })[group(req)],
    keyGenerator: req => digest(`${group(req)}:${identities.get(req) ?? `ip:${req.ip}`}`),
  });
  async function check(limiter: typeof perimeter, req: FastifyRequest, reply: FastifyReply) {
    const result = await limiter(req);
    if (!result.isAllowed && result.isExceeded) {
      reply.header('Retry-After', Math.max(1, result.ttlInSeconds));
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests; retry later');
    }
  }
  app.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.url === '/health/live') return;
    await check(perimeter, request, reply);
    request.consumeQuota = async userId => {
      if (userId) identities.set(request, `user:${userId}`);
      await check(operation, request, reply);
    };
  });
}
