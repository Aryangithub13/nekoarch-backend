import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { ApiErrorResponseSchema, type TierEstimate } from '@designflow/shared';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { ApiError } from '../src/lib/errors.js';
import { createLogger } from '../src/lib/logger.js';
import type { EstimateInsert, PlanInsert, RateEntry, RateVersion, Repository } from '../src/lib/repository.js';
import { createSupabaseBackend, SupabaseRepository } from '../src/lib/supabase.js';
import { fixturePlan } from '../../../test-support/fixtures.js';

// These tests execute the production Supabase SDK adapter through its HTTP
// transport. PostgreSQL/RLS behavior is covered separately by real database tests.
const env = parseEnv({
  NODE_ENV: 'test',
  SUPABASE_URL: 'https://adapter-test.supabase.invalid',
  SUPABASE_ANON_KEY: 'synthetic-public-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-server-secret-never-transmitted',
});
const ownerId = '31ac29ba-085f-414d-a27b-2ec05aa049bc';
const planId = '0edaa7ef-1af3-4a6d-bc86-f7d28942f850';
const versionId = '64b697f9-c7dd-4bc7-b74e-2b23f8d60128';
const token = 'synthetic-owner-jwt';
const otherToken = 'synthetic-other-jwt';
const upstreamSecret = 'synthetic-private-db-message-prompt-share-token';
const planRecord = { id: planId, plan_data: fixturePlan() };
const rateVersion: RateVersion = {
  id: versionId, version_label: 'adapter-fixture', effective_date: '2026-09-01', created_at: '2026-09-01T00:00:00.000Z',
};
const rateEntry: RateEntry = {
  id: '03c63b0c-ae63-42fc-9cb6-072a770725ab', version_id: versionId,
  region: 'Adapter fixture region', building_type: 'residential', tier: 'basic',
  rate_per_sqft_min: '1000.25', rate_per_sqft_max: '1200.75',
  category_breakdown: { structure: 0.6, finishes: 0.4 }, is_active: true,
};

function planInsert(): PlanInsert {
  const plan = fixturePlan();
  return {
    user_id: ownerId, prompt: plan.prompt, seed: plan.seed, variant: plan.variant, plan_data: plan,
    qa_orthogonal: plan.qa.orthogonal, bounds_width_m: plan.bounds.w, bounds_depth_m: plan.bounds.d,
    room_count: plan.rooms.length, share_token: 's'.repeat(43),
  };
}

function estimateInsert(): EstimateInsert {
  const tier = (name: TierEstimate['tier']): TierEstimate => ({
    tier: name, rangeMin: 100, rangeMax: 200, breakdown: [{ category: 'fixture', min: 100, max: 200 }],
    materials: {}, timelineMonths: [5, 8],
  });
  return {
    plan_id: planId, user_id: ownerId, location: 'Adapter fixture region', building_type: 'residential',
    built_up_area_sqft: 100, floors: 1, budget_provided: 1000, rate_table_version: versionId,
    tier_basic: tier('basic'), tier_standard: tier('standard'), tier_premium: tier('premium'), soil_note: 'Fixture disclaimer',
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function stubTransport(respond: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return respond(request);
  });
  vi.stubGlobal('fetch', fetch);
  return { requests, fetch };
}

function requestAt(requests: Request[], index: number): Request {
  const request = requests[index];
  if (!request) throw new Error(`Expected upstream request ${index}`);
  return request;
}

function assertCaller(request: Request, callerToken = token) {
  expect(request.headers.get('authorization')).toBe(`Bearer ${callerToken}`);
  expect(request.headers.get('apikey')).toBe(env.SUPABASE_ANON_KEY);
  expect(request.url).not.toContain('synthetic-server-secret-never-transmitted');
  expect(JSON.stringify([...request.headers])).not.toContain('synthetic-server-secret-never-transmitted');
  expect(request.signal).toBeInstanceOf(AbortSignal);
  expect(request.signal.aborted).toBe(false);
}

const applications: ReturnType<typeof buildApp>[] = [];
function productionApp() {
  const logs: string[] = [];
  const logger = createLogger(env, { write: chunk => { logs.push(chunk); } });
  const captureError = vi.fn();
  // No replacement Backend: both authentication and data access use production code.
  const app = buildApp({ env, logger, captureError });
  applications.push(app);
  return { app, logs, captureError };
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map(app => app.close()));
  vi.unstubAllGlobals();
});

describe('production Supabase session and request composition', () => {
  it('verifies the presented session with Supabase Auth using the public API key', async () => {
    const { requests } = stubTransport(() => jsonResponse({ id: ownerId, is_anonymous: true, email: 'private@example.invalid' }));
    const backend = createSupabaseBackend(env);
    expect(await backend.authenticate(token)).toEqual({ id: ownerId });
    expect(requests).toHaveLength(1);
    const request = requestAt(requests, 0);
    expect(new URL(request.url).pathname).toBe('/auth/v1/user');
    expect(request.method).toBe('GET');
    assertCaller(request);
  });

  it('rejects invalid sessions without echoing authentication service diagnostics', async () => {
    stubTransport(() => jsonResponse({ msg: upstreamSecret, error_code: 'bad_jwt' }, 401));
    await expect(createSupabaseBackend(env).authenticate(token)).rejects.toMatchObject({
      statusCode: 401, code: 'UNAUTHORIZED', message: 'A valid Supabase session is required',
    });
  });

  it('uses the public anon role for reads without a supplied session', async () => {
    const { requests } = stubTransport(() => jsonResponse([planRecord]));
    const repository = createSupabaseBackend(env).repository();
    expect(repository).toBeInstanceOf(SupabaseRepository);
    expect(await repository.getPlan(planId)).toEqual(planRecord);
    assertCaller(requestAt(requests, 0), env.SUPABASE_ANON_KEY);
  });

  it('keeps concurrent caller JWTs isolated across repository instances', async () => {
    const { requests } = stubTransport(() => jsonResponse([planRecord]));
    const backend = createSupabaseBackend(env);
    const ownerRepository = backend.repository(token);
    const otherRepository = backend.repository(otherToken);
    const otherPlanId = '1de1d0d5-1a42-4f2e-b498-8c4895986f64';
    await Promise.all([
      ownerRepository.getPlan(planId),
      otherRepository.getPlan(otherPlanId),
      ownerRepository.getPlan(planId),
    ]);
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      // Client initialization can reorder concurrent requests. Associate each
      // principal with its actual target rather than assuming transport order.
      const targetId = new URL(request.url).searchParams.get('id');
      assertCaller(request, targetId === `eq.${otherPlanId}` ? otherToken : token);
    }
    expect(requests.filter(request => new URL(request.url).searchParams.get('id') === `eq.${otherPlanId}`)).toHaveLength(1);
  });

  it('creates a plan with an explicit safe return projection under its caller JWT', async () => {
    const { requests } = stubTransport(() => jsonResponse(planRecord, 201));
    const row = planInsert();
    expect(await createSupabaseBackend(env).repository(token).insertPlan(row)).toEqual(planRecord);
    const request = requestAt(requests, 0);
    const url = new URL(request.url);
    expect(request.method).toBe('POST');
    expect(url.pathname).toBe('/rest/v1/plans');
    expect(url.searchParams.get('select')).toBe('id,plan_data');
    expect(request.headers.get('prefer')).toContain('return=representation');
    expect(await request.clone().json()).toEqual(row);
    expect(await request.clone().text()).not.toContain('synthetic-server-secret-never-transmitted');
    assertCaller(request);
  });

  it('reads only plan ID and plan data, excluding ownership and share-token columns', async () => {
    const { requests } = stubTransport(() => jsonResponse([{ ...planRecord, share_token: upstreamSecret, user_id: ownerId }]));
    const record = await createSupabaseBackend(env).repository(token).getPlan(planId);
    expect(record).toEqual(planRecord);
    expect(JSON.stringify(record)).not.toContain(upstreamSecret);
    const request = requestAt(requests, 0);
    const url = new URL(request.url);
    expect(request.method).toBe('GET');
    expect(url.searchParams.get('select')).toBe('id,plan_data');
    expect(url.searchParams.get('id')).toBe(`eq.${planId}`);
    assertCaller(request);
  });

  it('PATCH sends only is_public and requests safe columns using the caller JWT', async () => {
    const { requests } = stubTransport(() => jsonResponse(planRecord));
    expect(await createSupabaseBackend(env).repository(token).patchPlan(planId, false)).toEqual(planRecord);
    const request = requestAt(requests, 0);
    const url = new URL(request.url);
    expect(request.method).toBe('PATCH');
    expect(url.pathname).toBe('/rest/v1/plans');
    expect(url.searchParams.get('id')).toBe(`eq.${planId}`);
    expect(url.searchParams.get('select')).toBe('id,plan_data');
    expect(await request.clone().json()).toEqual({ is_public: false });
    assertCaller(request);
  });

  it('requests version provenance sorted by effective and publication dates', async () => {
    const { requests } = stubTransport(() => jsonResponse([rateVersion]));
    expect(await createSupabaseBackend(env).repository(token).getRateVersions()).toEqual([rateVersion]);
    const request = requestAt(requests, 0);
    const url = new URL(request.url);
    expect(url.pathname).toBe('/rest/v1/rate_table_versions');
    expect(url.searchParams.get('select')).toBe('id,version_label,effective_date,created_at');
    expect(url.searchParams.get('order')).toBe('effective_date.desc,created_at.desc');
    assertCaller(request);
  });

  it('limits rate entries to the selected version and active rows', async () => {
    const { requests } = stubTransport(() => jsonResponse([rateEntry]));
    expect(await createSupabaseBackend(env).repository(token).getRateEntries(versionId)).toEqual([rateEntry]);
    const request = requestAt(requests, 0);
    const url = new URL(request.url);
    expect(url.pathname).toBe('/rest/v1/rate_table_entries');
    expect(url.searchParams.get('version_id')).toBe(`eq.${versionId}`);
    expect(url.searchParams.get('is_active')).toBe('eq.true');
    expect(url.searchParams.get('select')).toBe('id,version_id,region,building_type,tier,rate_per_sqft_min,rate_per_sqft_max,category_breakdown,is_active');
    assertCaller(request);
  });

  it('persists an estimate without requesting data back or using service-role credentials', async () => {
    const { requests } = stubTransport(() => new Response(null, { status: 201 }));
    const row = estimateInsert();
    await expect(createSupabaseBackend(env).repository(token).insertEstimate(row)).resolves.toBeUndefined();
    const request = requestAt(requests, 0);
    const url = new URL(request.url);
    expect(request.method).toBe('POST');
    expect(url.pathname).toBe('/rest/v1/cost_estimates');
    expect(url.searchParams.has('select')).toBe(false);
    expect(request.headers.get('prefer') ?? '').not.toContain('return=representation');
    expect(await request.clone().json()).toEqual(row);
    expect(await request.clone().text()).not.toContain('synthetic-server-secret-never-transmitted');
    assertCaller(request);
  });

  it.each(['getPlan', 'patchPlan'] as const)('maps an RLS-hidden or absent %s result to null', async method => {
    stubTransport(() => jsonResponse([]));
    const repository = createSupabaseBackend(env).repository(token);
    const result = method === 'getPlan' ? await repository.getPlan(planId) : await repository.patchPlan(planId, true);
    expect(result).toBeNull();
  });
});

describe('production Supabase database failure boundaries', () => {
  it.each([
    { databaseCode: '23505', statusCode: 409, code: 'CONFLICT' },
    { databaseCode: '42501', statusCode: 403, code: 'FORBIDDEN' },
    { databaseCode: '23514', statusCode: 500, code: 'DATABASE_ERROR' },
    { databaseCode: 'XX000', statusCode: 500, code: 'DATABASE_ERROR' },
  ])('sanitizes upstream $databaseCode errors into $code', async ({ databaseCode, statusCode, code }) => {
    stubTransport(() => jsonResponse({ code: databaseCode, message: upstreamSecret, details: token, hint: 'synthetic-server-secret-never-transmitted' }, 400));
    const failure = await createSupabaseBackend(env).repository(token).insertPlan(planInsert()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ statusCode, code });
    const serialized = JSON.stringify(failure) + String(failure);
    for (const secret of [upstreamSecret, token, 'synthetic-server-secret-never-transmitted']) expect(serialized).not.toContain(secret);
  });

  const operations = [
    { name: 'insertPlan', run: (repository: Repository) => repository.insertPlan(planInsert()) },
    { name: 'getPlan', run: (repository: Repository) => repository.getPlan(planId) },
    { name: 'patchPlan', run: (repository: Repository) => repository.patchPlan(planId, true) },
    { name: 'getRateVersions', run: (repository: Repository) => repository.getRateVersions() },
    { name: 'getRateEntries', run: (repository: Repository) => repository.getRateEntries(versionId) },
    { name: 'insertEstimate', run: (repository: Repository) => repository.insertEstimate(estimateInsert()) },
  ];

  it.each(operations)('$name handles database failure instead of returning partial success', async ({ run }) => {
    stubTransport(() => jsonResponse({ code: '42501', message: upstreamSecret }, 403));
    await expect(run(createSupabaseBackend(env).repository(token))).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('sanitizes SDK-wrapped network errors on a failed write', async () => {
    const { requests } = stubTransport(() => { throw new Error(upstreamSecret, { cause: new Error(token) }); });
    const failure = await createSupabaseBackend(env).repository(token).insertEstimate(estimateInsert()).catch((error: unknown) => error);
    expect(failure).toMatchObject({ statusCode: 500, code: 'DATABASE_ERROR' });
    expect(String(failure)).not.toContain(upstreamSecret);
    expect(JSON.stringify(failure)).not.toContain(token);
    expect(requests).toHaveLength(1);
  });

  it.each(['getPlan', 'patchPlan'] as const)('rejects multiple %s rows rather than selecting an arbitrary plan', async method => {
    stubTransport(() => jsonResponse([planRecord, planRecord]));
    const repository = createSupabaseBackend(env).repository(token);
    const result = method === 'getPlan' ? repository.getPlan(planId) : repository.patchPlan(planId, false);
    await expect(result).rejects.toMatchObject({ statusCode: 500, code: 'DATABASE_ERROR' });
  });
});

describe('production Supabase returned-data validation', () => {
  it.each(['insertPlan', 'getPlan', 'patchPlan'] as const)('rejects a malformed durable ID returned by %s', async method => {
    stubTransport(() => jsonResponse({ id: 'invalid-db-id', plan_data: fixturePlan() }));
    const repository = createSupabaseBackend(env).repository(token);
    const result = method === 'insertPlan' ? repository.insertPlan(planInsert())
      : method === 'getPlan' ? repository.getPlan(planId) : repository.patchPlan(planId, true);
    await expect(result).rejects.toBeInstanceOf(ZodError);
  });

  it('rejects a missing version provenance field', async () => {
    stubTransport(() => jsonResponse([{ ...rateVersion, created_at: undefined }]));
    await expect(createSupabaseBackend(env).repository(token).getRateVersions()).rejects.toBeInstanceOf(ZodError);
  });

  it.each([
    { building_type: 'unknown' },
    { tier: 'luxury' },
    { rate_per_sqft_min: undefined },
    { category_breakdown: [1] },
  ])('rejects malformed returned rate entries: %j', async override => {
    stubTransport(() => jsonResponse([{ ...rateEntry, ...override }]));
    await expect(createSupabaseBackend(env).repository(token).getRateEntries(versionId)).rejects.toBeInstanceOf(ZodError);
  });

  it('rejects an invalid authenticated user ID instead of trusting the returned identity', async () => {
    stubTransport(() => jsonResponse({ id: 'invalid-user-id', is_anonymous: true }));
    await expect(createSupabaseBackend(env).authenticate(token)).rejects.toBeInstanceOf(ZodError);
  });

  it('validates nested database plan data at the production HTTP boundary and suppresses its details', async () => {
    stubTransport(() => jsonResponse([{ id: planId, plan_data: { ...fixturePlan(), prompt: upstreamSecret, bounds: { x: 0, z: 0, w: -2, d: 5 } } }]));
    const { app, logs, captureError } = productionApp();
    const response = await app.inject({ method: 'GET', url: `/api/plans/${planId}` });
    expect(response.statusCode).toBe(500);
    const body = ApiErrorResponseSchema.parse(response.json());
    expect(body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: response.headers['x-request-id'] });
    expect(captureError).toHaveBeenCalledOnce();
    for (const secret of [upstreamSecret, 'ZodError', 'stack', 'synthetic-server-secret-never-transmitted']) expect(response.body + logs.join('')).not.toContain(secret);
  });

  it('sanitizes a production database write failure in HTTP responses and logs', async () => {
    const { requests } = stubTransport(request => new URL(request.url).pathname === '/auth/v1/user'
      ? jsonResponse({ id: ownerId, is_anonymous: true })
      : jsonResponse({ code: 'XX000', message: upstreamSecret, details: token, hint: 'synthetic-server-secret-never-transmitted' }, 400));
    const { app, logs } = productionApp();
    const response = await app.inject({ method: 'POST', url: '/api/plans', headers: { authorization: `Bearer ${token}` }, payload: { plan: fixturePlan() } });
    expect(response.statusCode).toBe(500);
    const body = ApiErrorResponseSchema.parse(response.json());
    expect(body.error).toEqual({ code: 'DATABASE_ERROR', message: 'The database operation could not be completed', requestId: response.headers['x-request-id'] });
    expect(requests).toHaveLength(2);
    for (const request of requests) assertCaller(request);
    for (const secret of [upstreamSecret, token, 'synthetic-server-secret-never-transmitted']) expect(response.body + logs.join('')).not.toContain(secret);
  });
});
