import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import type { Backend, Repository } from '../src/lib/repository.js';
import { createShutdown } from '../src/lib/lifecycle.js';
import { createSupabaseBackend } from '../src/lib/supabase.js';
import { safeError } from '../src/lib/safe-error.js';
import { sanitizeEvent } from '../src/lib/sentry.js';
import { fixturePlan } from '../../../test-support/fixtures.js';

const envInput = { NODE_ENV: 'test', SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'fixture', LOG_LEVEL: 'silent' };
const userId = '527e987b-5f98-43aa-91b7-328e7bfc5649';
const repository: Repository = {
  insertPlan: async row => ({ id: userId, plan_data: row.plan_data }),
  getPlan: async () => ({ id: userId, plan_data: fixturePlan() }),
  patchPlan: async () => null, getRateVersions: async () => [], getRateEntries: async () => [], insertEstimate: async () => undefined,
};
const backend: Backend = { authenticate: async token => ({ id: token }), repository: () => repository, ready: async () => undefined };
const apps: ReturnType<typeof buildApp>[] = [];
function appWith(settings: Record<string, string> = {}, source: Backend = backend) {
  const app = buildApp({ env: parseEnv({ ...envInput, ...settings }), backend: source, captureError: () => undefined });
  apps.push(app); return app;
}
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('health and lifecycle', () => {
  it('reports missing production signing capability through readiness without disabling reads or liveness', async () => {
    const settings = { NODE_ENV: 'production', SENTRY_DSN: 'https://public@example.test/1' };
    const app = appWith(settings);
    expect((await app.inject('/health/live')).statusCode).toBe(200);
    expect((await app.inject('/health/ready')).statusCode).toBe(503);
    expect((await app.inject(`/api/plans/${userId}`)).statusCode).toBe(200);
    expect((await appWith({ ...settings, PROJECT_COMMIT_SECRET: 'a'.repeat(64) }).inject('/health/ready')).statusCode).toBe(200);
  });
  it('keeps liveness independent and readiness recovers from database failure', async () => {
    const ready = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('private-db-secret')).mockResolvedValueOnce(undefined);
    const app = appWith({}, { ...backend, ready });
    expect((await app.inject('/health/live')).json()).toEqual({ status: 'ok' }); expect(ready).not.toHaveBeenCalled();
    expect((await app.inject('/health/ready')).statusCode).toBe(200);
    const failed = await app.inject('/health/ready'); expect(failed.statusCode).toBe(503); expect(failed.json()).toEqual({ status: 'unavailable' });
    expect((await app.inject('/health/live')).statusCode).toBe(200);
    expect((await app.inject('/health/ready')).statusCode).toBe(200);
  });
  it('fails readiness closed when an adapter has no probe', async () => {
    const { ready: _ready, ...source } = backend;
    expect((await appWith({}, source).inject('/health/ready')).statusCode).toBe(503);
  });
  it('awaits in-flight requests before closing owned resources', async () => {
    let release!: () => void;
    let entered!: () => void;
    const active = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const close = vi.fn(async () => undefined);
    const app = appWith({}, { ...backend, close, repository: () => ({ ...repository, getPlan: async () => {
      entered(); await wait; return { id: userId, plan_data: fixturePlan() };
    } }) });
    const response = app.inject(`/api/plans/${userId}`); await active;
    const closing = app.close(); expect(close).not.toHaveBeenCalled();
    release(); expect((await response).statusCode).toBe(200); await closing; expect(close).toHaveBeenCalledOnce();
  });
  it('deduplicates shutdown and flushes after awaited close', async () => {
    const order: string[] = [];
    const shutdown = createShutdown(async () => { order.push('close'); }, async () => { order.push('flush'); return true; }, () => { order.push('failed'); });
    const first = shutdown(); expect(shutdown()).toBe(first); await first;
    expect(order).toEqual(['close', 'flush']);
  });
  it('reports cleanup and flush failures without unhandled rejection', async () => {
    const failed = vi.fn(); const flush = vi.fn(async () => false);
    await createShutdown(async () => { throw new Error('private'); }, flush, failed)();
    expect(flush).toHaveBeenCalledOnce(); expect(failed).toHaveBeenCalledTimes(2);
  });
});

describe('HTTP abuse and browser protections', () => {
  it('enforces independent authenticated read quotas with Retry-After', async () => {
    const app = appWith({ RATE_LIMIT_READ: '1' });
    const read = (token: string) => app.inject({ url: `/api/plans/${userId}`, headers: { authorization: `Bearer ${token}` } });
    expect((await read('first')).statusCode).toBe(200);
    const excess = await read('first'); expect(excess.statusCode).toBe(429); expect(excess.json().error.code).toBe('RATE_LIMITED');
    expect(Number(excess.headers['retry-after'])).toBeGreaterThan(0);
    expect((await read('second')).statusCode).toBe(200);
  });
  it('uses stricter generation quotas and a separate write quota', async () => {
    const app = appWith({ RATE_LIMIT_GENERATE: '1', RATE_LIMIT_WRITE: '2' });
    const headers = { authorization: `Bearer ${userId}` };
    const generate = () => app.inject({ method: 'POST', url: '/api/plans/generate', headers, payload: { prompt: '2BHK with open kitchen' } });
    expect((await generate()).statusCode).toBe(201); expect((await generate()).statusCode).toBe(429);
    expect((await app.inject({ method: 'POST', url: '/api/plans', headers, payload: { plan: fixturePlan() } })).statusCode).toBe(201);
  });
  it('can disable limits explicitly', async () => {
    const app = appWith({ RATE_LIMIT_ENABLED: 'false', RATE_LIMIT_READ: '1', RATE_LIMIT_IP: '1' });
    for (let i = 0; i < 4; i++) expect((await app.inject(`/api/plans/${userId}`)).statusCode).toBe(200);
  });
  it('ignores spoofed forwarded addresses by default and keeps liveness available', async () => {
    const app = appWith({ RATE_LIMIT_IP: '1' });
    expect((await app.inject({ url: '/missing', headers: { 'x-forwarded-for': '192.0.2.1' } })).statusCode).toBe(404);
    // Registered routes and unknown paths both consume the perimeter quota.
    expect((await app.inject({ url: `/api/plans/${userId}`, headers: { 'x-forwarded-for': '192.0.2.2' } })).statusCode).toBe(429);
    expect((await app.inject('/health/live')).statusCode).toBe(200);
  });
  it('uses forwarded addresses only through configured proxy peers', async () => {
    const app = appWith({ TRUST_PROXY: '127.0.0.1/32', RATE_LIMIT_IP: '1' });
    for (const ip of ['192.0.2.1', '192.0.2.2']) expect((await app.inject({ url: `/api/plans/${userId}`, headers: { 'x-forwarded-for': ip } })).statusCode).toBe(200);
  });
  it('allows configured CORS origins and idempotency headers, excludes others', async () => {
    const app = appWith({ CORS_ORIGINS: 'https://client.example' });
    const preflight = (origin: string) => app.inject({ method: 'OPTIONS', url: '/api/plans', headers: { origin,
      'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,idempotency-key' } });
    const allowed = await preflight('https://client.example'); expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://client.example');
    expect(allowed.headers['access-control-allow-headers']).toContain('Idempotency-Key');
    expect((await preflight('https://untrusted.example')).headers['access-control-allow-origin']).toBeUndefined();
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
  });
  it('sets API security headers without local HSTS', async () => {
    const response = await appWith().inject('/health/live');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });
  it.each(['/api/plans/generate', '/api/estimates'])('bounds small JSON on %s with a safe envelope', async url => {
    const response = await appWith({ SMALL_BODY_LIMIT_BYTES: '64' }).inject({ method: 'POST', url, payload: { private: 'x'.repeat(100) } });
    expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe('INVALID_REQUEST'); expect(response.body).not.toContain('xxxx');
  });
  it.each(['', 'space key', 'x'.repeat(129), 'invalid/key'])('rejects malformed idempotency key %s', async key => {
    const response = await appWith().inject({ method: 'POST', url: '/api/plans', headers: { authorization: `Bearer ${userId}`, 'idempotency-key': key }, payload: { plan: fixturePlan() } });
    expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe('INVALID_IDEMPOTENCY_KEY');
  });
});

describe('production configuration and safe diagnostics', () => {
  it('strips unused service-role credentials and denies browser origins by default in production', () => {
    const env = parseEnv({ ...envInput, NODE_ENV: 'production', SENTRY_DSN: 'https://key@example.invalid/1', SUPABASE_SERVICE_ROLE_KEY: 'private' });
    expect(env).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY'); expect(env.CORS_ORIGINS).toBe(''); expect(env.TRUST_PROXY).toBe('');
  });
  it.each([{ TRUST_PROXY: 'true' }, { TRUST_PROXY: '0.0.0.0/99' }, { RATE_LIMIT_ENABLED: '0' }, { REQUEST_TIMEOUT_MS: '0' }, { CORS_ORIGINS: '*' }])('rejects unsafe or malformed configuration %j', settings => {
    expect(() => parseEnv({ ...envInput, ...settings })).toThrow('Invalid environment configuration');
  });
  it('preserves exception type and application source locations, stripping messages and raw paths', () => {
    const error = new TypeError('bearer-private');
    error.stack = 'TypeError: bearer-private\n at secretFunction (/private/apps/api/src/lib/supabase.ts:27:5)\n at private (https://private.invalid/jwt:1:1)';
    const diagnostic = safeError(error);
    expect(diagnostic).toEqual({ type: 'TypeError', frames: [{ filename: 'apps/api/src/lib/supabase.ts', lineno: 27, colno: 5 }] });
    const event = sanitizeEvent({ type: undefined, exception: { values: [{ type: diagnostic.type, value: error.message, stacktrace: { frames: diagnostic.frames } }] },
      tags: { method: 'POST', route: '/api/plans/generate', code: 'GENERATION_FAILED' }, release: 'backend-v1-phase8' });
    expect(event.exception?.values?.[0]?.stacktrace?.frames).toHaveLength(1);
    expect(event.tags).toMatchObject({ route: '/api/plans/generate', method: 'POST', code: 'GENERATION_FAILED' });
    expect(JSON.stringify(event)).not.toContain('bearer-private'); expect(JSON.stringify(event)).not.toContain('/private/');
  });
  it('probes the database through the anon client with an abort signal', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal); expect(init?.redirect).toBe('error');
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetch);
    await createSupabaseBackend(parseEnv(envInput)).ready!(); expect(fetch).toHaveBeenCalledOnce();
  });
  it('maps Auth network failures to a safe dependency 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('private-network-credential'); }));
    await expect(createSupabaseBackend(parseEnv(envInput)).authenticate('private-token')).rejects.toMatchObject({
      statusCode: 503, code: 'AUTH_UNAVAILABLE', message: 'Authentication is temporarily unavailable',
    });
  });
  it('bounds readiness transport and composes its cancellation with the upstream deadline', async () => {
    const controllers = new Map<number, AbortController>();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const controller = new AbortController(); controllers.set(ms, controller); return controller.signal;
    });
    let started!: () => void;
    const active = new Promise<void>(resolve => { started = resolve; });
    vi.stubGlobal('fetch', vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('private-timeout', 'TimeoutError')), { once: true });
      started();
    })));
    const probe = createSupabaseBackend(parseEnv(envInput)).ready!();
    const failure = expect(probe).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
    await active;
    expect([...controllers.keys()].sort((a, b) => a - b)).toEqual([2000, 10000]);
    controllers.get(2000)!.abort(); await failure;
  });
  it('never echoes invalid enum configuration values', () => {
    try { parseEnv({ ...envInput, LOG_LEVEL: 'private-secret' }); throw new Error('Expected failure'); }
    catch (error) { expect(String(error)).toContain('LOG_LEVEL'); expect(String(error)).not.toContain('private-secret'); }
  });

});

describe('repair: telemetry coverage and workflow compute quotas', () => {
  it('retains every registered route template but never raw identifiers or query strings', async () => {
    const app = appWith(), routes = new Set<string>();
    app.addHook('onRoute', route => { if (route.url !== '*') routes.add(route.url); });
    await app.ready();
    for (const route of routes) expect(sanitizeEvent({ type: undefined, tags: { route } }).tags?.route, route).toBe(route);
    for (const route of ['/api/projects/private-user-id', '/api/projects/:projectId?token=secret', '/api/private-secret']) expect(sanitizeEvent({ type: undefined, tags: { route } }).tags?.route).toBeUndefined();
  });
  it.each(['shared','generator','blueprint-qa','quantity-takeoff','construction-calculations','boq-cost'])('retains safe %s stack coordinates through both redaction stages', pkg => {
    const error = new Error('private'); error.stack = `Error: private\n    at secret (/workspace/packages/${pkg}/src/calculate.ts:12:3)`;
    const parsed = safeError(error);
    const result = sanitizeEvent({ type: undefined, exception: { values: [{ type: parsed.type, value: 'private', stacktrace: { frames: parsed.frames } }] } });
    expect(result.exception?.values?.[0]?.stacktrace?.frames).toEqual([{ filename: `packages/${pkg}/src/calculate.ts`, lineno: 12, colno: 3 }]);
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('charges workflow execution to generate quota but keeps workflow and revision reads separate', async () => {
    const app = appWith({ RATE_LIMIT_GENERATE: '1', RATE_LIMIT_READ: '20', RATE_LIMIT_WRITE: '20' });
    const headers = { authorization: `Bearer ${userId}` }, url = `/api/projects/${userId}/workflows`;
    // Invalid body still consumes authenticated quota before any compute/storage.
    expect((await app.inject({ method: 'POST', url, headers, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url, headers, payload: {} })).statusCode).toBe(429);
    expect((await app.inject({ method: 'GET', url, headers })).statusCode).not.toBe(429);
    expect((await app.inject({ method: 'GET', url: `/api/projects/${userId}/revisions`, headers })).statusCode).not.toBe(429);
  });
});
