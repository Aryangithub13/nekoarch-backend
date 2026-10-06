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
  const group = (request: FastifyRequest) => request.method === 'POST' && ['/api/projects/:projectId/conversations/:conversationId/messages', '/api/projects/:projectId/conversations/:conversationId/proposals/approve', '/api/projects/:projectId/requirements/interpret', '/api/plans/generate', '/api/projects/:projectId/workflows', '/api/projects/:projectId/revisions/generate', '/api/projects/:projectId/revisions', '/api/projects/:projectId/revisions/:revisionId/structural/analyses', '/api/projects/:projectId/revisions/:revisionId/structural/validate'].includes(request.routeOptions.url ?? '') ? 'generate'
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
