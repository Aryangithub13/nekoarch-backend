import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import cors from '@fastify/cors';
import type { Logger } from 'pino';
import { ApiErrorResponseSchema } from '@designflow/shared';
import type { Env } from './config/env.js';
import type { Backend } from './lib/repository.js';
import { createSupabaseBackend } from './lib/supabase.js';
import { createLogger } from './lib/logger.js';
import { ApiError } from './lib/errors.js';
import { reportError } from './lib/sentry.js';
import { plansRoutes } from './routes/plans.js';
import { estimatesRoutes } from './routes/estimates.js';
import { regionsRoutes } from './routes/regions.js';

export function buildApp(options: { env: Env; backend?: Backend; logger?: Logger; captureError?: typeof reportError }) {
  const backend = options.backend ?? createSupabaseBackend(options.env);
  const capture = options.captureError ?? reportError;
  const loggerInstance: FastifyBaseLogger = options.logger ?? createLogger(options.env);
  const app = Fastify({ loggerInstance,
    genReqId: () => randomUUID(), requestIdHeader: false, disableRequestLogging: true,
    bodyLimit: 1_048_576, requestTimeout: 30_000, connectionTimeout: 10_000, exposeHeadRoutes: false });
  app.register(cors, { origin: options.env.CORS_ORIGINS.split(',').map(value => value.trim()).filter(Boolean),
    methods: ['GET', 'POST', 'PATCH'], allowedHeaders: ['Authorization', 'Content-Type'], exposedHeaders: ['x-request-id'] });
  app.addHook('onRequest', async (request, reply) => { reply.header('x-request-id', request.id).header('Cache-Control', 'no-store'); });
  app.addHook('onResponse', async (request, reply) => {
    // Route templates are safe; raw URL/query/body/header values never enter logs.
    request.log.info({ route: request.routeOptions.url ?? '<unmatched>', method: request.method,
      statusCode: reply.statusCode, durationMs: reply.elapsedTime }, 'request completed');
  });
  app.setNotFoundHandler(() => { throw new ApiError(404, 'NOT_FOUND', 'Resource not found'); });
  app.setErrorHandler((error, request, reply) => {
    let safe: ApiError;
    if (error instanceof ApiError) safe = error;
    else if (typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      const status = error.statusCode;
      safe = new ApiError(status === 413 || status === 415 ? 400 : status, 'INVALID_REQUEST', 'The request is malformed or unsupported');
    } else safe = new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    if (safe.statusCode >= 500) {
      request.log.error({ code: safe.code }, 'request failed');
      try { capture(error, request.id, safe.code); } catch { request.log.warn('Error reporting unavailable'); }
    }
    const body = ApiErrorResponseSchema.parse({ error: { code: safe.code, message: safe.message, requestId: request.id,
      ...(safe.fieldErrors ? { fieldErrors: safe.fieldErrors } : {}) } });
    reply.code(safe.statusCode).send(body);
  });
  plansRoutes(app, backend);
  estimatesRoutes(app, backend);
  regionsRoutes(app, backend);
  return app;
}
