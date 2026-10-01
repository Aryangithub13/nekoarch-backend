import { requirementInterpretationRoutes } from './routes/requirement-interpretation.js';
import type { InterpreterOptions } from './ai/architectural-interpreter.js';
import { workflowsRoutes } from './routes/workflows.js';
import { costsRoutes } from './routes/costs.js';
import { constructionRoutes } from './routes/construction.js';
import { takeoffsRoutes } from './routes/takeoffs.js';
import { projectsRoutes } from './routes/projects.js';
import helmet from '@fastify/helmet';
import { installLimits } from './lib/http-protection.js';
import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyBaseLogger } from 'fastify';
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

export function buildApp(options: { env: Env; backend?: Backend; logger?: Logger; captureError?: typeof reportError; interpreter?: InterpreterOptions }) {
  const backend = options.backend ?? createSupabaseBackend(options.env);
  const capture = options.captureError ?? reportError;
  const loggerInstance: FastifyBaseLogger = options.logger ?? createLogger(options.env);
  const app = Fastify({ loggerInstance,
    genReqId: () => randomUUID(), requestIdHeader: false, logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: options.env.BODY_LIMIT_BYTES, requestTimeout: options.env.REQUEST_TIMEOUT_MS,
    connectionTimeout: options.env.CONNECTION_TIMEOUT_MS, keepAliveTimeout: options.env.KEEP_ALIVE_TIMEOUT_MS,
    trustProxy: options.env.TRUST_PROXY ? options.env.TRUST_PROXY.split(',').map(value => value.trim()) : false,
    exposeHeadRoutes: false });
  app.register(cors, { origin: options.env.CORS_ORIGINS.split(',').map(value => value.trim()).filter(Boolean),
    methods: ['GET', 'POST', 'PATCH'], allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'], exposedHeaders: ['x-request-id'] });
  app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false,
    strictTransportSecurity: options.env.NODE_ENV === 'production' && options.env.HSTS_ENABLED ? { maxAge: 31_536_000 } : false,
    referrerPolicy: { policy: 'no-referrer' } });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id).header('Cache-Control', 'no-store');
    request.log.info({ route: request.routeOptions.url ?? '<unmatched>', method: request.method }, 'request started');
  });
  app.addHook('onRoute', route => {
    if (route.url === '/api/plans/generate' || route.url === '/api/estimates') route.bodyLimit = options.env.SMALL_BODY_LIMIT_BYTES;
  });
  let draining = false;
  app.addHook('preClose', async () => { draining = true; });
  app.addHook('onClose', async () => { await backend.close?.(); });
  app.addHook('onResponse', async (request, reply) => {
    // Route templates are safe; raw URL/query/body/header values never enter logs.
    request.log.info({ route: request.routeOptions.url ?? '<unmatched>', method: request.method,
      statusCode: reply.statusCode, durationMs: reply.elapsedTime }, 'request completed');
  });
  app.setErrorHandler((error, request, reply) => {
    let safe: ApiError;
    if (error instanceof ApiError) safe = error;
    else if (typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      const status = error.statusCode;
      safe = new ApiError(status === 413 || status === 415 ? 400 : status, 'INVALID_REQUEST', 'The request is malformed or unsupported');
    } else safe = new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    if (safe.statusCode >= 500) {
      request.log.error({ code: safe.code }, 'request failed');
      try { capture(error, request.id, safe.code, { route: request.routeOptions.url ?? '<unmatched>', method: request.method }); } catch { request.log.warn('Error reporting unavailable'); }
    }
    const body = ApiErrorResponseSchema.parse({ error: { code: safe.code, message: safe.message, requestId: request.id,
      ...(safe.fieldErrors ? { fieldErrors: safe.fieldErrors } : {}) } });
    reply.code(safe.statusCode).send(body);
  });
  app.register(async scope => {
    await installLimits(scope, options.env);
    scope.setNotFoundHandler(() => { throw new ApiError(404, 'NOT_FOUND', 'Resource not found'); });
    scope.get('/health/live', async () => ({ status: 'ok' }));
    scope.get('/health/ready', async (_request, reply) => {
      try {
        if (draining || !backend.ready) throw new Error('Unavailable');
        await backend.ready();
        return { status: 'ok' };
      } catch { return reply.code(503).send({ status: 'unavailable' }); }
    });
    plansRoutes(scope, backend);
    projectsRoutes(scope, backend, options.env);
    requirementInterpretationRoutes(scope, backend, options.env, options.interpreter);
    takeoffsRoutes(scope, backend, options.env);
    constructionRoutes(scope, backend, options.env);
    costsRoutes(scope, backend, options.env);
    workflowsRoutes(scope, backend, options.env);
    estimatesRoutes(scope, backend);
    regionsRoutes(scope, backend);
  });
  return app;
}
