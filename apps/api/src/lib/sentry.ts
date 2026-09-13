import * as Sentry from '@sentry/node';
import type { Env } from '../config/env.js';

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
  if (typeof code === 'string' && ['INTERNAL_ERROR', 'DATABASE_ERROR', 'RATE_DATA_INVALID', 'RATE_DATA_UNAVAILABLE', 'RATE_GRID_INCOMPLETE'].includes(code)) {
    safe.tags!['code'] = code;
  }
  return safe;
}
export function initializeSentry(env: Env): void {
  if (!env.SENTRY_DSN) return;
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, sendDefaultPii: false,
    defaultIntegrations: false, beforeSend: sanitizeEvent });
}
export function reportError(_error: unknown, requestId: string, code: string): void {
  Sentry.captureException(new Error('DesignFlow backend request failure'), { tags: { requestId, code } });
}
export const flushSentry = () => Sentry.flush(5_000);
