import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import type { Backend, Repository } from '../src/lib/repository.js';
import { createLogger } from '../src/lib/logger.js';

// Audit B (BACKEND_INTEGRATION_AUDIT.md) browser-facing contract repairs: INT-B-009, INT-B-010, INT-B-016, INT-B-028 and INT-B-031.
const envInput = { NODE_ENV: 'test', SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'fixture', LOG_LEVEL: 'silent' };
const production = { NODE_ENV: 'production', SENTRY_DSN: 'https://public@example.test/1', PROJECT_COMMIT_SECRET: 'a'.repeat(64) };
const repository = {} as Repository;
const backend: Backend = { authenticate: async token => ({ id: token }), repository: () => repository, ready: async () => undefined };
const origin = 'http://localhost:5173';
const apps: ReturnType<typeof buildApp>[] = [];
function appWith(settings: Record<string, string> = {}) {
  const app = buildApp({ env: parseEnv({ ...envInput, ...settings }), backend, captureError: () => undefined });
  apps.push(app); return app;
}
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const exposed = (headers: Record<string, unknown>) => String(headers['access-control-expose-headers'] ?? '').split(',').map(h => h.trim().toLowerCase());

describe('INT-B-009: browser code can read the backoff and download headers', () => {
  it('exposes Retry-After on a 429 and Content-Disposition on every CORS response', async () => {
    const app = appWith({ RATE_LIMIT_IP: '1' });
    const first = await app.inject({ method: 'GET', url: '/api/capabilities', headers: { origin } });
    expect(first.statusCode).toBe(200);
    expect(exposed(first.headers)).toEqual(expect.arrayContaining(['x-request-id', 'etag', 'retry-after', 'content-disposition']));
    const limited = await app.inject({ method: 'GET', url: '/api/capabilities', headers: { origin } });
    expect([limited.statusCode, limited.json().error.code]).toEqual([429, 'RATE_LIMITED']);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.headers['access-control-allow-origin']).toBe(origin);
    expect(exposed(limited.headers)).toContain('retry-after');
  });
});

describe('INT-B-010: oversized and unsupported bodies have their own codes', () => {
  it('reports the route limit for an oversized body, keeping the uniform 400 status', async () => {
    const app = appWith();
    const oversized = await app.inject({ method: 'POST', url: '/api/estimates', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ pad: 'x'.repeat(70_000) }) });
    expect([oversized.statusCode, oversized.json().error.code]).toEqual([400, 'PAYLOAD_TOO_LARGE']);
    expect(oversized.json().error.message).toContain('65536');
  });
  it('reports an unsupported content type separately from malformed JSON', async () => {
    const app = appWith();
    const media = await app.inject({ method: 'POST', url: '/api/estimates', headers: { 'content-type': 'application/xml' }, payload: '<x/>' });
    expect([media.statusCode, media.json().error.code]).toEqual([400, 'UNSUPPORTED_MEDIA_TYPE']);
    const malformed = await app.inject({ method: 'POST', url: '/api/estimates', headers: { 'content-type': 'application/json' }, payload: '{' });
    expect([malformed.statusCode, malformed.json().error.code]).toEqual([400, 'INVALID_REQUEST']);
  });
});

describe('INT-B-016: production must name its browser origins', () => {
  it('refuses to start in production without CORS_ORIGINS, without echoing values', () => {
    expect(() => parseEnv({ ...envInput, ...production })).toThrow(/CORS_ORIGINS: Required in production/);
    expect(() => parseEnv({ ...envInput, ...production, CORS_ORIGINS: '' })).toThrow(/CORS_ORIGINS/);
  });
  it('accepts explicit origins, or an explicit `none` that allows no browser origin', async () => {
    expect(parseEnv({ ...envInput, ...production, CORS_ORIGINS: 'https://app.example' }).CORS_ORIGINS).toBe('https://app.example');
    const app = appWith({ ...production, CORS_ORIGINS: 'none' });
    const preflight = await app.inject({ method: 'OPTIONS', url: '/api/projects', headers: { origin, 'access-control-request-method': 'GET' } });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(() => parseEnv({ ...envInput, CORS_ORIGINS: 'none,https://app.example' })).toThrow(/CORS_ORIGINS/);
  });
});

describe('INT-B-028: health checks answer HEAD', () => {
  it('serves HEAD on liveness and readiness without a body', async () => {
    const app = appWith();
    for (const url of ['/health/live', '/health/ready']) {
      const head = await app.inject({ method: 'HEAD', url });
      expect([url, head.statusCode, head.body]).toEqual([url, 200, '']);
    }
  });
});

describe('INT-B-031: a proxy in front of an API without TRUST_PROXY is reported', () => {
  const logged = (settings: Record<string, string>) => {
    const lines: string[] = [];
    const env = parseEnv({ ...envInput, LOG_LEVEL: 'info', ...settings });
    const app = buildApp({ env, backend, captureError: () => undefined, logger: createLogger(env, { write: chunk => { lines.push(chunk); } }) });
    apps.push(app);
    return { app, warnings: () => lines.filter(line => line.includes('FORWARDED_FOR_IGNORED')).length };
  };
  it('warns once when X-Forwarded-For arrives and TRUST_PROXY is empty, and never echoes the forwarded address', async () => {
    const { app, warnings } = logged({});
    for (const ip of ['203.0.113.7', '198.51.100.9']) await app.inject({ url: '/health/live', headers: { 'x-forwarded-for': ip } });
    expect(warnings()).toBe(1);
  });
  it('stays quiet when the proxy is trusted', async () => {
    const { app, warnings } = logged({ TRUST_PROXY: '127.0.0.1' });
    await app.inject({ url: '/health/live', headers: { 'x-forwarded-for': '203.0.113.7' } });
    expect(warnings()).toBe(0);
  });
});
