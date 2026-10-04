import pino, { type DestinationStream } from 'pino';
import type { Env } from '../config/env.js';

const privateFields = new Set([
  'airoutingconfig', 'aiprovidercredentials', 'credentials', 'endpoint', 'context', 'aiconversationapikey', 'text', 'intent', 'messages', 'authorization', 'cookie', 'cookies', 'setcookie', 'sharetoken', 'prompt',
  'supabaseanonkey', 'supabaseservicerolekey', 'accesstoken', 'refreshtoken',
  'projectcommitsecret', 'model', 'modeljson', 'report', 'reportjson', 'envelope', 'signature',
  'body', 'plandata', 'plan', 'headers', 'config', 'env', 'idempotencykey', 'databaseurl', 'connectionstring', 'apikey', 'password', 'token', 'url', 'originalurl', 'requesturl',
]);

function sanitizeFields(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[OMITTED]';
  if (value instanceof Error) return { message: 'Request failed' };
  if (Array.isArray(value)) return value.map(item => sanitizeFields(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    (privateFields.has(key.replace(/[_-]/g, '').toLowerCase()) || /^AI_PROVIDER_.*_API_KEY$/i.test(key)) ? '[REDACTED]' : sanitizeFields(item, depth + 1),
  ]));
}

export function createLogger(env: Env, stream?: DestinationStream) {
  const options: pino.LoggerOptions = {
    level: env.LOG_LEVEL, base: { service: 'designflow-api', environment: env.NODE_ENV },
    redact: { paths: ['authorization', 'cookie', 'headers.authorization', 'headers.cookie', 'req.headers.authorization', 'req.headers.cookie',
      'share_token', 'shareToken', '*.share_token', '*.shareToken', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', '*.SUPABASE_ANON_KEY', '*.SUPABASE_SERVICE_ROLE_KEY', 'prompt', '*.prompt'], censor: '[REDACTED]' },
    // Defense in depth for nested structured context and varying header casing.
    // Request logging itself uses fixed messages and route templates only.
    formatters: { log: object => sanitizeFields(object) as Record<string, unknown> },
    serializers: {
      req: (req: { method: string }) => ({ method: req.method }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      err: () => ({ message: 'Request failed' }),
    },
  };
  return stream ? pino(options, stream) : pino(options);
}
