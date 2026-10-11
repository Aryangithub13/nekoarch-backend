import { safeError } from './safe-error.js';
import * as Sentry from '@sentry/node';
import type { Env } from '../config/env.js';

// Only literal route templates survive; never request paths or parameter values.
const project = '/api/projects/:projectId';
const revision = `${project}/revisions/:revisionId`;
const takeoff = `${revision}/takeoffs`;
const construction = `${takeoff}/:takeoffId/construction-calculations`;
const conversation = `${project}/conversations/:conversationId`;
const safeRoutes = new Set([
  '<unmatched>', '/health/live', '/health/ready', '/api/capabilities', '/api/regions', '/api/estimates',
  '/api/plans', '/api/plans/generate', '/api/plans/:id', '/api/projects', project, `${project}/public`,
  `${project}/requirements/interpret`, `${project}/revisions`, `${project}/revisions/generate`, revision, `${revision}/overview`,
  `${project}/workflows`, `${project}/workflows/plan`, `${project}/workflows/:workflowRunId`,
  `${project}/conversations`, conversation, `${conversation}/messages`, `${conversation}/proposals/approve`, `${conversation}/tools`,
  takeoff, `${takeoff}/:takeoffId`, construction, `${construction}/:calculationId`,
  `${construction}/:calculationId/cost-estimates`, `${revision}/cost-estimates`, `${revision}/cost-estimates/:costEstimateId`,
  ...['', '/validation', '/elements', '/elements/:elementId', '/relationships', '/diff/:otherRevisionId', '/export.json', '/export.ifc'].map(suffix => `${revision}/bim${suffix}`),
  ...['/validate', '/analyses', '/analyses/:analysisId', '/status'].flatMap(suffix => [`${revision}/structural${suffix}`, `${revision}/environmental${suffix}`, `${revision}/systems${suffix}`]),
  ...['/packs', '/validate', '/analyses', '/analyses/:analysisId', '/status'].map(suffix => `${revision}/knowledge${suffix}`),
  ...['/validate', '/studies', '/studies/:studyId', '/status'].map(suffix => `${revision}/optimization${suffix}`),
  ...['/validate', '/artifacts', '/artifacts/:artifactId', '/artifacts/:artifactId/manifest', '/artifacts/:artifactId/glb', '/status'].map(suffix => `${revision}/scene${suffix}`),
  `${revision}/appearance`, `${revision}/appearance/glb`, `${project}/revision-operations`,
  ...['', '/execute', '/approve', '/reject', '/cancel', '/comparison', '/validation', '/candidate/manifest', '/candidate/glb'].map(suffix => `${project}/revision-operations/:operationId${suffix}`),
  ...['', '/validate', '/usage', '/:referenceId', '/:referenceId/content', '/:referenceId/download-links'].map(suffix => `${project}/references${suffix}`),
  '/api/reference-downloads',
]);

// Drop all automatic request/user/breadcrumb attachments. Only controlled context is sent.
export function sanitizeEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const safe: Sentry.ErrorEvent = {
    type: undefined,
    platform: 'node',
    message: 'DesignFlow backend request failure',
    tags: {},
  };
  if (event.event_id && /^[a-f0-9]{32}$/i.test(event.event_id)) safe.event_id = event.event_id;
  if (event.timestamp !== undefined && Number.isFinite(event.timestamp)) safe.timestamp = event.timestamp;
  if (event.environment && ['development', 'test', 'production'].includes(event.environment)) safe.environment = event.environment;
  if (event.level !== undefined) safe.level = event.level;
  const requestId = event.tags?.['requestId'];
  if (typeof requestId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)) {
    safe.tags!['requestId'] = requestId;
  }
  const code = event.tags?.['code'];
  if (typeof code === 'string' && ['INTERNAL_ERROR', 'DATABASE_ERROR', 'RATE_DATA_INVALID', 'RATE_DATA_UNAVAILABLE', 'RATE_GRID_INCOMPLETE', 'GENERATION_FAILED', 'IDEMPOTENCY_UNAVAILABLE', 'AUTH_UNAVAILABLE'].includes(code)) {
    safe.tags!['code'] = code;
  }
  const method = event.tags?.['method'];
  if (typeof method === 'string' && ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(method)) safe.tags!['method'] = method;
  const route = event.tags?.['route'];
  if (typeof route === 'string' && safeRoutes.has(route)) safe.tags!['route'] = route;
  if (event.release && /^[A-Za-z0-9._-]{1,100}$/.test(event.release)) safe.release = event.release;
  safe.exception = { values: (event.exception?.values ?? []).slice(0, 1).map(exception => ({
    type: ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'ApiError', 'ZodError'].includes(exception.type ?? '') ? exception.type! : 'Error',
    value: 'DesignFlow backend request failure',
    stacktrace: { frames: (exception.stacktrace?.frames ?? []).filter(frame =>
      typeof frame.filename === 'string' && /^(apps\/api|packages\/(shared|generator|blueprint-qa|quantity-takeoff|construction-calculations|boq-cost))\/(src|dist)\/[A-Za-z0-9_./-]+\.[cm]?[jt]s$/.test(frame.filename)
    ).map(frame => ({ filename: frame.filename!, ...(Number.isInteger(frame.lineno) ? { lineno: frame.lineno! } : {}),
      ...(Number.isInteger(frame.colno) ? { colno: frame.colno! } : {}) })) },
  })) };
  return safe;
}
export function initializeSentry(env: Env): void {
  if (!env.SENTRY_DSN) return;
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, ...(env.RELEASE ? { release: env.RELEASE } : {}), sendDefaultPii: false,
    defaultIntegrations: false, beforeSend: sanitizeEvent });
}
export function reportError(error: unknown, requestId: string, code: string, context?: { route: string; method: string }): void {
  const safe = safeError(error);
  Sentry.captureEvent({ message: 'DesignFlow backend request failure', level: 'error',
    exception: { values: [{ type: safe.type, value: 'DesignFlow backend request failure', stacktrace: { frames: safe.frames.reverse() } }] },
    tags: { requestId, code, ...context } });
}
export const flushSentry = () => Sentry.flush(5_000);
