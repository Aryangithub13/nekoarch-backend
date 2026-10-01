import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorResponseSchema, PlanInputSchema, CreatePlanResponseSchema, GetPlanResponseSchema,
  PatchPlanResponseSchema, EstimateResponseSchema, RegionsResponseSchema } from '@designflow/shared';
import { buildApp } from '../src/app.js';
import { EnvSchema, parseEnv } from '../src/config/env.js';
import { ApiError } from '../src/lib/errors.js';
import { createLogger } from '../src/lib/logger.js';
import type { Backend, Repository } from '../src/lib/repository.js';
import { initializeSentry, reportError, sanitizeEvent } from '../src/lib/sentry.js';

const envInput = {
  NODE_ENV: 'test',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'fixture-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
};
const env = parseEnv(envInput);
const userId = '527e987b-5f98-43aa-91b7-328e7bfc5649';
const planId = '6d5a1e1d-1d82-4333-bb82-dac9a11b1ed0';
const requestId = '659de975-5330-4a42-b9bb-c2726a484180';
const plan = PlanInputSchema.parse({
  prompt: 'private-plan-prompt-secret', seed: 'fixture',
  rooms: [{ id: 0, name: 'Room', type: 'bedroom', rect: { x: 0, z: 0, w: 5, d: 5 } }],
  walls: [], furn: [], bounds: { x: 0, z: 0, w: 5, d: 5 },
  qa: { orthogonal: 1, walls: 0, pieces: 0 },
});

function fixtureBackend(overrides: Partial<Repository> = {}): Backend {
  const repository: Repository = {
    insertPlan: async row => ({ id: planId, plan_data: row.plan_data }),
    getPlan: async () => ({ id: planId, plan_data: plan }),
    patchPlan: async () => ({ id: planId, plan_data: plan }),
    getRateVersions: async () => [],
    getRateEntries: async () => [],
    insertEstimate: async () => undefined,
    ...overrides,
  };
  return {
    authenticate: async token => {
      if (token !== 'valid-fixture-session') throw new ApiError(401, 'UNAUTHORIZED', 'A valid Supabase session is required');
      return { id: userId };
    },
    repository: () => repository,
  };
}

const applications: ReturnType<typeof buildApp>[] = [];
function fixtureApp(options: { backend?: Backend; captureError?: typeof reportError } = {}) {
  const lines: string[] = [];
  const logger = createLogger(env, { write: chunk => { lines.push(chunk); } });
  const captureError = options.captureError ?? vi.fn<typeof reportError>();
  const app = buildApp({ env, logger, backend: options.backend ?? fixtureBackend(), captureError });
  applications.push(app);
  return { app, lines, captureError };
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map(app => app.close()));
});

describe('startup configuration', () => {
  it.each(['SUPABASE_URL', 'SUPABASE_ANON_KEY'])('requires %s with a readable failure', field => {
    const source: Record<string, unknown> = { ...envInput };
    delete source[field];
    expect(() => parseEnv(source)).toThrow(`Invalid environment configuration:\n${field}:`);
    expect(EnvSchema.safeParse({ ...envInput, [field]: '' }).success).toBe(false);
  });

  it('requires Sentry only in production, accepting blank optional local settings', () => {
    expect(() => parseEnv({ ...envInput, NODE_ENV: 'production' })).toThrow('SENTRY_DSN: Required in production');
    expect(parseEnv({ ...envInput, SENTRY_DSN: '', PORT: '', LOG_LEVEL: '', HOST: '' })).toMatchObject({
      NODE_ENV: 'test', PORT: 3001, LOG_LEVEL: 'info', HOST: '127.0.0.1',
    });
    expect(parseEnv({ ...envInput, NODE_ENV: 'production', SENTRY_DSN: 'https://public-key@example.invalid/1' }).NODE_ENV).toBe('production');
  });

  it('never echoes malformed credential values in startup errors', () => {
    expect(() => parseEnv({ ...envInput, SUPABASE_URL: 'secret-invalid-url-value' })).toThrow('SUPABASE_URL');
    try { parseEnv({ ...envInput, SUPABASE_URL: 'secret-invalid-url-value' }); }
    catch (error) { expect(String(error)).not.toContain('secret-invalid-url-value'); }
  });

  it.each([0, 65536, -1, 'not-a-port'])('rejects invalid port %s', PORT => {
    expect(EnvSchema.safeParse({ ...envInput, PORT }).success).toBe(false);
  });

  it('rejects non-HTTP Supabase URLs and non-exact CORS origins', () => {
    expect(EnvSchema.safeParse({ ...envInput, SUPABASE_URL: 'ftp://example.invalid' }).success).toBe(false);
    expect(EnvSchema.safeParse({ ...envInput, CORS_ORIGINS: 'https://example.invalid/path' }).success).toBe(false);
    expect(parseEnv({ ...envInput, CORS_ORIGINS: 'http://localhost:5173,https://designflow.example.invalid' }).CORS_ORIGINS).toContain(',');
  });
});

describe('structured logging privacy', () => {
  it('validates every successful route response and correlates its log with its response request ID', async () => {
    const versionId = 'a7c7b702-78ee-4f62-afce-289a4f46bb6d';
    const { app, lines } = fixtureApp({ backend: fixtureBackend({
      getRateVersions: async () => [{ id: versionId, version_label: 'transport-fixture', effective_date: '2020-01-01', created_at: '2020-01-01T00:00:00.000Z' }],
      getRateEntries: async () => (['basic', 'standard', 'premium'] as const).map(tier => ({
        id: versionId, version_id: versionId, region: 'Transport fixture', building_type: 'residential', tier,
        rate_per_sqft_min: '1000', rate_per_sqft_max: '1500', category_breakdown: { Structure: 1 }, is_active: true,
      })),
    }) });
    const requests = [
      { method: 'POST' as const, url: '/api/plans', payload: { plan }, schema: CreatePlanResponseSchema, status: 201, route: '/api/plans' },
      { method: 'GET' as const, url: `/api/plans/${planId}`, schema: GetPlanResponseSchema, status: 200, route: '/api/plans/:id' },
      { method: 'PATCH' as const, url: `/api/plans/${planId}`, payload: { isPublic: true }, schema: PatchPlanResponseSchema, status: 200, route: '/api/plans/:id' },
      { method: 'POST' as const, url: '/api/estimates', payload: { location: 'Transport fixture', buildingType: 'residential', builtUpAreaSqft: 1000 }, schema: EstimateResponseSchema, status: 200, route: '/api/estimates' },
      { method: 'GET' as const, url: '/api/regions', schema: RegionsResponseSchema, status: 200, route: '/api/regions' },
    ];
    const requestIds = new Set<string>();
    for (const { schema, status, route, ...request } of requests) {
      const response = await app.inject({ ...request, headers: { authorization: 'Bearer valid-fixture-session' } });
      expect(response.statusCode).toBe(status);
      schema.parse(response.json());
      const id = String(response.headers['x-request-id']);
      expect(id).toMatch(/^[a-f0-9-]{36}$/); requestIds.add(id);
      expect(lines.map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ reqId: id, method: request.method, route, statusCode: status }));
    }
    expect(requestIds.size).toBe(5);
  });

  it('redacts secrets and prompts at every nesting level and removes URL queries', () => {
    const lines: string[] = [];
    const logger = createLogger(env, { write: chunk => { lines.push(chunk); } });
    const secrets = ['auth-private', 'cookie-private', 'share-private', 'anon-private', 'service-private', 'prompt-private', 'query-private', 'refresh-private'];
    logger.info({
      authorization: secrets[0],
      headers: { Authorization: secrets[0], Cookie: secrets[1], 'Set-Cookie': secrets[1] },
      share_token: secrets[2],
      config: { SUPABASE_ANON_KEY: secrets[3], SUPABASE_SERVICE_ROLE_KEY: secrets[4] },
      body: { plan: { prompt: secrets[5], shareToken: secrets[2] } },
      url: `/api/plans/${planId}?share_token=${secrets[6]}`,
      context: [{ nested: { refresh_token: secrets[7] } }],
      route: '/api/plans/:id',
      count: 1,
    }, 'safe structured message');
    logger.error({ err: new Error('exception-private-stack-secret') }, 'safe failure message');
    const log = lines.join('');
    for (const secret of secrets) expect(log).not.toContain(secret);
    expect(log).not.toContain('exception-private-stack-secret');
    expect(log).toContain('[REDACTED]');
    expect(log).toContain('/api/plans/:id');
    expect(log).toContain('safe structured message');
  });

  it('records successful and failed requests with server-owned request IDs and no raw request data', async () => {
    const { app, lines } = fixtureApp();
    const success = await app.inject({
      method: 'POST', url: '/api/plans?share_token=query-private-secret',
      headers: { authorization: 'Bearer valid-fixture-session', cookie: 'cookie-private-secret', 'x-request-id': 'client-injected-secret' },
      payload: { plan },
    });
    expect(success.statusCode).toBe(201);
    const failure = await app.inject({ method: 'GET', url: '/missing-route-private-secret?token=query-private-secret' });
    expect(failure.statusCode).toBe(404);
    const id = success.headers['x-request-id'];
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    expect(failure.headers['x-request-id']).not.toBe(id);
    expect(success.headers['cache-control']).toBe('no-store');
    const serialized = lines.join('');
    const created = JSON.parse(success.body) as { shareToken: string };
    for (const secret of ['valid-fixture-session', 'cookie-private-secret', 'query-private-secret', 'client-injected-secret', plan.prompt, created.shareToken, 'missing-route-private-secret']) {
      expect(serialized).not.toContain(secret);
    }
    const records = lines.map(line => JSON.parse(line) as { reqId?: string; statusCode?: number; route?: string });
    expect(records).toContainEqual(expect.objectContaining({ reqId: id, statusCode: 201, route: '/api/plans' }));
    expect(records).toContainEqual(expect.objectContaining({ statusCode: 404, route: '<unmatched>' }));
  });
});

describe('HTTP error boundaries', () => {
  it('reports deliberate exceptions while returning a sanitized typed 500', async () => {
    const original = new Error('database-secret JWT-secret stack-private prompt-private share-token-private');
    const captureError = vi.fn<typeof reportError>();
    const { app, lines } = fixtureApp({ backend: fixtureBackend({ getPlan: async () => { throw original; } }), captureError });
    const response = await app.inject({ method: 'GET', url: `/api/plans/${planId}?token=query-private` });
    expect(response.statusCode).toBe(500);
    const body = ApiErrorResponseSchema.parse(JSON.parse(response.body));
    expect(body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: response.headers['x-request-id'] });
    expect(captureError).toHaveBeenCalledWith(original, body.error.requestId, 'INTERNAL_ERROR', { route: '/api/plans/:id', method: 'GET' });
    const output = response.body + lines.join('');
    for (const secret of ['database-secret', 'JWT-secret', 'stack-private', 'prompt-private', 'share-token-private', 'query-private']) {
      expect(output).not.toContain(secret);
    }
  });

  it('keeps the error response usable when error reporting itself throws', async () => {
    const { app, lines } = fixtureApp({
      backend: fixtureBackend({ getPlan: async () => { throw new Error('original-private'); } }),
      captureError: () => { throw new Error('sentry-private'); },
    });
    const response = await app.inject({ method: 'GET', url: `/api/plans/${planId}` });
    expect(response.statusCode).toBe(500);
    expect(ApiErrorResponseSchema.parse(JSON.parse(response.body)).error.code).toBe('INTERNAL_ERROR');
    expect(lines.join('')).toContain('Error reporting unavailable');
    expect(lines.join('') + response.body).not.toContain('sentry-private');
  });

  it.each([
    { name: 'malformed JSON', payload: '{"plan":"payload-private"', contentType: 'application/json' },
    { name: 'empty JSON', payload: '', contentType: 'application/json' },
    { name: 'unsupported content type', payload: 'payload-private', contentType: 'application/xml' },
    { name: 'oversize JSON', payload: JSON.stringify({ plan: 'payload-private'.repeat(100_000) }), contentType: 'application/json' },
  ])('returns typed 400 for $name', async ({ payload, contentType }) => {
    const { app, lines } = fixtureApp();
    const response = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'content-type': contentType }, payload });
    expect(response.statusCode).toBe(400);
    expect(ApiErrorResponseSchema.parse(JSON.parse(response.body)).error.requestId).toBe(response.headers['x-request-id']);
    expect(response.body + lines.join('')).not.toContain('payload-private');
  });

  it('returns safe validation paths without echoing arbitrary enum values or unknown keys', async () => {
    const { app } = fixtureApp();
    const response = await app.inject({ method: 'POST', url: '/api/estimates', payload: {
      location: 'place', buildingType: 'malicious-enum-private', builtUpAreaSqft: 1,
      'malicious-key-private': 1,
    } });
    expect(response.statusCode).toBe(400);
    const body = ApiErrorResponseSchema.parse(JSON.parse(response.body));
    expect(body.error.fieldErrors?.['buildingType']).toEqual(['Unsupported value']);
    expect(response.body).not.toContain('malicious-enum-private');
    expect(response.body).not.toContain('malicious-key-private');
  });

  it.each([undefined, 'Basic malformed-secret', 'Bearer', 'Bearer two token-secret', 'Bearer invalid-session-secret'])('rejects missing or invalid credentials %s', async authorization => {
    const { app, lines } = fixtureApp();
    const response = await app.inject({ method: 'POST', url: '/api/plans', payload: { plan },
      ...(authorization ? { headers: { authorization } } : {}),
    });
    expect(response.statusCode).toBe(401);
    expect(ApiErrorResponseSchema.parse(JSON.parse(response.body)).error.code).toBe('UNAUTHORIZED');
    if (authorization) expect(response.body + lines.join('')).not.toContain(authorization);
  });

  it('does not silently downgrade an invalid session to a public request', async () => {
    const backend = fixtureBackend();
    const repository = vi.spyOn(backend, 'repository');
    const { app } = fixtureApp({ backend });
    const response = await app.inject({ method: 'GET', url: `/api/plans/${planId}`, headers: { authorization: 'Bearer invalid-session-secret' } });
    expect(response.statusCode).toBe(401);
    expect(repository).not.toHaveBeenCalled();
  });

  it('can construct and serve injected requests without opening a listening port', async () => {
    const { app } = fixtureApp();
    expect(app.server.listening).toBe(false);
    await app.inject({ method: 'GET', url: `/api/plans/${planId}` });
    expect(app.server.listening).toBe(false);
  });
});

describe('Sentry transport privacy', () => {
  it('drops raw events, credentials, user data, breadcrumbs and untrusted tags', () => {
    const sanitized = sanitizeEvent({
      type: undefined,
      event_id: '12345678901234567890123456789012',
      timestamp: 1_700_000_000,
      environment: 'test',
      message: 'prompt-private',
      exception: { values: [{ type: 'Error', value: 'exception-private' }] },
      request: { url: 'https://example.invalid/?token=query-private', headers: { Authorization: 'jwt-private' } },
      user: { email: 'email-private@example.invalid' },
      breadcrumbs: [{ message: 'breadcrumb-private' }],
      extra: { shareToken: 'share-private' },
      tags: { requestId, code: 'INTERNAL_ERROR', arbitrary: 'tag-private' },
    });
    expect(sanitized.tags).toEqual({ requestId, code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(sanitized)).not.toContain('private');
    expect(sanitized.request).toBeUndefined();
    expect(sanitized.exception?.values).toEqual([{ type: 'Error', value: 'DesignFlow backend request failure', stacktrace: { frames: [] } }]);
    expect(sanitizeEvent({ type: undefined, tags: { requestId: 'request-private', code: 'code-private' } }).tags).toEqual({});
  });

  it('sends a deliberately captured failure through the SDK transport without raw error context', async () => {
    const envelopes: unknown[] = [];
    Sentry.init({
      dsn: 'https://0123456789abcdef0123456789abcdef01@example.invalid/1',
      environment: 'test',
      defaultIntegrations: false,
      sendDefaultPii: false,
      beforeSend: sanitizeEvent,
      transport: () => ({
        send: async envelope => { envelopes.push(envelope); return { statusCode: 200 }; },
        flush: async () => true,
      }),
    });
    try {
      reportError(new Error('deliberate-private-secret-with-prompt-and-jwt'), requestId, 'DATABASE_ERROR');
      expect(await Sentry.flush(2_000)).toBe(true);
      expect(envelopes).toHaveLength(1);
      const captured = JSON.stringify(envelopes);
      expect(captured).toContain('DesignFlow backend request failure');
      expect(captured).toContain(requestId);
      expect(captured).toContain('DATABASE_ERROR');
      expect(captured).not.toContain('deliberate-private-secret');
    } finally {
      await Sentry.close(2_000);
      Sentry.getCurrentScope().setClient(undefined);
    }
  });

  it('skips SDK initialization when no local DSN is configured', () => {
    expect(env.SENTRY_DSN).toBeUndefined();
    initializeSentry(env);
    expect(Sentry.getClient()).toBeUndefined();
  });
});

it('allows only the public generator integration boundary and keeps Three.js out of API imports', () => {
  const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '../src');
  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? sourceFiles(join(directory, entry.name)) : entry.name.endsWith('.ts') ? [join(directory, entry.name)] : [],
    );
  }
  const files = sourceFiles(sourceRoot);
  expect(files.length).toBeGreaterThan(10);
  for (const file of files) {
    const imports = [...readFileSync(file, 'utf8').matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)];
    for (const match of imports) {
      if (match[1] === '@designflow/generator') {
        expect(['contracts/requirement-interpretation.ts', 'ai/architectural-interpreter.ts', 'contracts/generation.ts', 'services/generation-service.ts', 'contracts/projects.ts', 'services/project-service.ts', 'contracts/workflows.ts', 'workflows/registry.ts', 'lib/generation-identity.ts'].map(path => join(sourceRoot, path))).toContain(file);
      } else {
        expect(match[1], file).not.toMatch(/(?:generator|generation\/|^three(?:\/|$))/);
      }
    }
  }
});
