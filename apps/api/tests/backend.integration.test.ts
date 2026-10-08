import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { ApiErrorResponseSchema, CreatePlanResponseSchema, GetPlanResponseSchema, PatchPlanResponseSchema, EstimateResponseSchema, RegionsResponseSchema } from '@designflow/shared';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { DISCLAIMER, SOIL_DISCLAIMER } from '../src/content/disclaimers.js';
import { startTestDatabase, asPrincipal } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { fixturePlan, fixtureEstimate } from '../../../test-support/fixtures.js';

describe('five API endpoints against real PostgreSQL constraints and RLS', () => {
  let database: Awaited<ReturnType<typeof startTestDatabase>>;
  let app: ReturnType<typeof buildApp>;
  const owner = randomUUID(); const other = randomUUID();
  const ownerHeaders = { authorization: 'Bearer owner-test-session' };
  const otherHeaders = { authorization: 'Bearer other-test-session' };
  let savedId: string;
  let savedToken: string;
  beforeAll(async () => {
    database = await startTestDatabase();
    await database.pool.query('insert into auth.users(id) values ($1),($2)', [owner,other]);
    const env = parseEnv({ NODE_ENV: 'test', RATE_LIMIT_ENABLED: 'false', SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'test-server-only', LOG_LEVEL: 'silent' });
    app = buildApp({ env, backend: createPgBackend(database.pool, { 'owner-test-session': owner, 'other-test-session': other }) });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await database?.stop(); });

  it('creates private plan, ignores submitted persistence metadata and atomically logs generation', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/plans', headers: ownerHeaders, payload: { plan: { ...fixturePlan(), id: randomUUID(), user_id: other, shareToken: 'attacker', isPublic: true } } });
    expect(response.statusCode).toBe(201);
    const body = CreatePlanResponseSchema.parse(response.json());
    savedId = body.plan.id; savedToken = body.shareToken;
    expect(savedToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const record = (await database.pool.query('select * from plans where id=$1', [savedId])).rows[0];
    expect(record.user_id).toBe(owner); expect(record.is_public).toBe(false); expect(record.share_token).toBe(savedToken);
    expect(record.plan_data).toEqual(fixturePlan());
    expect(record.prompt).toBe(record.plan_data.prompt); expect(Number(record.bounds_width_m)).toBe(record.plan_data.bounds.w);
    expect(record.room_count).toBe(record.plan_data.rooms.length);
    const audit = await database.pool.query('select event_type from generation_logs where plan_id=$1', [savedId]);
    expect(audit.rows).toEqual([{ event_type: 'generated' }]);
  });
  it('owner retrieves a plan without receiving token; private/missing resources have identical failures', async () => {
    const own = await app.inject({ method: 'GET', url: `/api/plans/${savedId}`, headers: ownerHeaders });
    expect(own.statusCode).toBe(200); GetPlanResponseSchema.parse(own.json()); expect(own.body).not.toContain(savedToken);
    for (const headers of [otherHeaders, {}]) {
      const privateResponse = await app.inject({ method: 'GET', url: `/api/plans/${savedId}`, headers });
      const missingResponse = await app.inject({ method: 'GET', url: `/api/plans/${randomUUID()}`, headers });
      expect(privateResponse.statusCode).toBe(404); expect(missingResponse.statusCode).toBe(404);
      expect(privateResponse.json().error.message).toBe(missingResponse.json().error.message);
      ApiErrorResponseSchema.parse(privateResponse.json());
    }
  });
  it('only owner toggles sharing, and revoking sharing removes public access', async () => {
    const denied = await app.inject({ method: 'PATCH', url: `/api/plans/${savedId}`, headers: otherHeaders, payload: { isPublic: true } });
    expect(denied.statusCode).toBe(404);
    const shared = await app.inject({ method: 'PATCH', url: `/api/plans/${savedId}`, headers: ownerHeaders, payload: { isPublic: true } });
    expect(shared.statusCode).toBe(200); PatchPlanResponseSchema.parse(shared.json());
    for (const headers of [otherHeaders, {}]) expect((await app.inject({ method: 'GET', url: `/api/plans/${savedId}`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/plans/${savedId}`, headers: otherHeaders, payload: { isPublic: false } })).statusCode).toBe(404);
    await app.inject({ method: 'PATCH', url: `/api/plans/${savedId}`, headers: ownerHeaders, payload: { isPublic: false } });
    expect((await app.inject({ method: 'GET', url: `/api/plans/${savedId}` })).statusCode).toBe(404);
    // Token possession grants no read or write privileges for a private plan.
    expect((await app.inject({ method: 'GET', url: `/api/plans/${savedId}?share_token=${savedToken}` })).statusCode).toBe(404);
  });
  it('returns typed 400 for malformed plans, UUIDs, PATCH fields and estimate inputs', async () => {
    const requests = [
      { method: 'POST' as const, url: '/api/plans', payload: { plan: { ...fixturePlan(), bounds: { x: 0, z: 0, w: -1, d: 2 } } } },
      { method: 'GET' as const, url: '/api/plans/not-a-uuid' },
      { method: 'PATCH' as const, url: `/api/plans/${savedId}`, payload: {} },
      { method: 'PATCH' as const, url: `/api/plans/${savedId}`, payload: { isPublic: true, user_id: other } },
      { method: 'POST' as const, url: '/api/estimates', payload: { ...fixtureEstimate(), builtUpAreaSqft: 0 } },
      { method: 'POST' as const, url: '/api/estimates', payload: { ...fixtureEstimate(), buildingType: 'unknown' } },
      { method: 'POST' as const, url: '/api/plans', payload: { plan: { ...fixturePlan(), variant: 2_147_483_648 } } },
      { method: 'POST' as const, url: '/api/estimates', payload: { ...fixtureEstimate(), floors: 2_147_483_648 } },
    ];
    for (const request of requests) {
      const response = await app.inject({ ...request, headers: ownerHeaders });
      expect(response.statusCode).toBe(400); const body = ApiErrorResponseSchema.parse(response.json());
      expect(body.error.fieldErrors).toBeDefined(); expect(response.headers['x-request-id']).toBe(body.error.requestId);
    }
  });
  it('requires valid sessions for writes', async () => {
    for (const headers of [{}, { authorization: 'Bearer invalid' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/plans', headers, payload: { plan: fixturePlan() } })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/api/estimates', headers, payload: fixtureEstimate() })).statusCode).toBe(401);
      expect((await app.inject({ method: 'PATCH', url: `/api/plans/${savedId}`, headers, payload: { isPublic: true } })).statusCode).toBe(401);
    }
  });
  it('serves active seeded regions and dated version', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/regions' });
    expect(response.statusCode).toBe(200); const result = RegionsResponseSchema.parse(response.json());
    expect(result.lastUpdated).toBe('2026-09-01'); expect(result.regions[0]?.buildingTypes).toHaveLength(3); expect(result.regions[0]?.isBaseline).toBe(true);
  });
  it('computes and persists three reconciling tier ranges with exact disclaimers and version provenance', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/estimates', headers: ownerHeaders, payload: { ...fixtureEstimate(), planId: savedId } });
    expect(response.statusCode).toBe(200); const result = EstimateResponseSchema.parse(response.json());
    expect(result.disclaimer).toBe(DISCLAIMER); expect(result.soilDisclaimer).toBe(SOIL_DISCLAIMER);
    for (const tier of result.tiers) {
      expect(tier.rangeMin).toBeLessThan(tier.rangeMax);
      expect(tier.breakdown.reduce((sum, row) => sum.plus(row.min), new Decimal(0)).toNumber()).toBe(tier.rangeMin);
      expect(tier.breakdown.reduce((sum, row) => sum.plus(row.max), new Decimal(0)).toNumber()).toBe(tier.rangeMax);
    }
    const record = (await database.pool.query('select * from cost_estimates where plan_id=$1', [savedId])).rows[0];
    expect(record.user_id).toBe(owner); expect(Number(record.budget_provided)).toBe(fixtureEstimate().budget);
    expect(record.tier_basic).toEqual(result.tiers[0]);
    expect((await database.pool.query('select version_label from rate_table_versions where id=$1', [record.rate_table_version])).rowCount).toBe(1);
    expect((await asPrincipal(database.pool, other, client => client.query('select id from cost_estimates'))).rowCount).toBe(0);
  });
  it('uses labelled fallback, rejects unreadable plans, allows public links without exposing owner estimates', async () => {
    const fallback = await app.inject({ method: 'POST', url: '/api/estimates', headers: otherHeaders, payload: { ...fixtureEstimate(), location: 'Unlisted town' } });
    expect(fallback.statusCode).toBe(200); expect(fallback.json().region).toMatchObject({ isBaseline: true, isFallback: true });
    expect((await app.inject({ method: 'POST', url: '/api/estimates', headers: otherHeaders, payload: { ...fixtureEstimate(), planId: savedId } })).statusCode).toBe(404);
    await app.inject({ method: 'PATCH', url: `/api/plans/${savedId}`, headers: ownerHeaders, payload: { isPublic: true } });
    const publicEstimate = await app.inject({ method: 'POST', url: '/api/estimates', headers: otherHeaders, payload: { ...fixtureEstimate(), planId: savedId } });
    expect(publicEstimate.statusCode).toBe(200);
    const visible = await asPrincipal(database.pool, other, client => client.query('select user_id from cost_estimates where plan_id=$1', [savedId]));
    expect(visible.rows).toEqual([{ user_id: other }]);
  });
  it('fails safely for an incomplete current grid and retains historical estimates', async () => {
    const countBefore = (await database.pool.query('select count(*) from cost_estimates')).rows[0].count;
    await database.pool.query("update rate_table_entries set is_active=false where tier='premium' and building_type='residential'");
    try {
      const response = await app.inject({ method: 'POST', url: '/api/estimates', headers: ownerHeaders, payload: fixtureEstimate() });
      expect(response.statusCode).toBe(503); expect(response.json().error.code).toBe('RATE_GRID_INCOMPLETE');
      expect((await app.inject({ method: 'GET', url: '/api/regions' })).statusCode).toBe(503);
      expect((await database.pool.query('select count(*) from cost_estimates')).rows[0].count).toBe(countBefore);
    } finally { await database.pool.query('update rate_table_entries set is_active=true'); }
  });
  it('validates stored plan geometry before returning it', async () => {
    await database.pool.query("update plans set plan_data=jsonb_set(plan_data,'{rooms,0,rect,w}','-3') where id=$1", [savedId]);
    try {
      const response = await app.inject({ method: 'GET', url: `/api/plans/${savedId}`, headers: ownerHeaders });
      expect(response.statusCode).toBe(500); expect(response.json().error.code).toBe('INTERNAL_ERROR');
      expect(response.body).not.toContain('Zod'); expect(response.body).not.toContain('stack');
    } finally { await database.pool.query('update plans set plan_data=$2 where id=$1', [savedId, fixturePlan()]); }
  });

  it('persists every seeded building-type grid without altering estimates to match a budget', async () => {
    for (const buildingType of ['residential', 'commercial', 'institutional'] as const) {
      const inputs = { ...fixtureEstimate(), buildingType, budget: 1 };
      const lowBudget = await app.inject({ method: 'POST', url: '/api/estimates', headers: ownerHeaders, payload: inputs });
      const highBudget = await app.inject({ method: 'POST', url: '/api/estimates', headers: ownerHeaders, payload: { ...inputs, budget: 99_000_000 } });
      expect(lowBudget.statusCode).toBe(200); expect(highBudget.statusCode).toBe(200);
      expect(EstimateResponseSchema.parse(lowBudget.json()).tiers).toEqual(EstimateResponseSchema.parse(highBudget.json()).tiers);
    }
  });

  it('rolls back the plan if its generated audit cannot be saved and sanitizes database failures', async () => {
    const before = (await database.pool.query('select count(*)::int as count from plans')).rows[0].count;
    const logsBefore = (await database.pool.query('select count(*)::int as count from generation_logs')).rows[0].count;
    await database.pool.query(`create function public.fail_audit_fixture() returns trigger language plpgsql as $$
      begin raise exception 'audit-fixture-private-secret'; end; $$;
      create trigger fail_audit_fixture before insert on public.generation_logs for each row execute function public.fail_audit_fixture();`);
    try {
      const response = await app.inject({ method: 'POST', url: '/api/plans', headers: ownerHeaders, payload: { plan: fixturePlan() } });
      expect(response.statusCode).toBe(500);
      expect(ApiErrorResponseSchema.parse(response.json()).error.code).toBe('DATABASE_ERROR');
      expect(response.body).not.toContain('audit-fixture-private-secret');
      expect(response.body).not.toContain('shareToken');
      expect((await database.pool.query('select count(*)::int as count from plans')).rows[0].count).toBe(before);
      expect((await database.pool.query('select count(*)::int as count from generation_logs')).rows[0].count).toBe(logsBefore);
    } finally {
      await database.pool.query('drop trigger fail_audit_fixture on public.generation_logs; drop function public.fail_audit_fixture();');
    }
  });

  it('keeps generated plans durable across API reconstruction and issues independent share tokens', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/plans', headers: ownerHeaders, payload: { plan: fixturePlan() } });
    expect(response.statusCode).toBe(201);
    const second = CreatePlanResponseSchema.parse(response.json());
    expect(second.plan.id).not.toBe(savedId); expect(second.shareToken).not.toBe(savedToken);
    const freshApp = buildApp({ env: parseEnv({ NODE_ENV: 'test', RATE_LIMIT_ENABLED: 'false', SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'test-server-only', LOG_LEVEL: 'silent' }),
      backend: createPgBackend(database.pool, { 'owner-test-session': owner }) });
    try {
      const fetched = await freshApp.inject({ method: 'GET', url: `/api/plans/${second.plan.id}`, headers: ownerHeaders });
      expect(fetched.statusCode).toBe(200);
      expect(GetPlanResponseSchema.parse(fetched.json()).plan).toEqual(second.plan);
    } finally { await freshApp.close(); }
  });

  it('uses a newly published version while preserving historical ranges and version references', async () => {
    const old = await app.inject({ method: 'POST', url: '/api/estimates', headers: ownerHeaders, payload: { ...fixtureEstimate(), planId: savedId } });
    expect(old.statusCode).toBe(200);
    const historic = (await database.pool.query('select id,rate_table_version,tier_basic,tier_standard,tier_premium from cost_estimates where plan_id=$1 and user_id=$2 order by created_at desc limit 1', [savedId, owner])).rows[0];
    // Explicit date: newer than the 2026-09-01 seed and effective on every clock. Postgres current_date is DB-local
    // while rate selection uses the UTC date, so current_date was "future" between 00:00 and 05:30 IST.
    const version = (await database.pool.query("insert into rate_table_versions(version_label,effective_date) values ('phase5-new-version',date '2026-09-02') returning id")).rows[0].id;
    await database.pool.query(`insert into rate_table_entries(version_id,region,building_type,tier,rate_per_sqft_min,rate_per_sqft_max,category_breakdown)
      select $1,region,building_type,tier,rate_per_sqft_min * 1.1,rate_per_sqft_max * 1.1,category_breakdown from rate_table_entries where version_id=$2`, [version, historic.rate_table_version]);
    const current = await app.inject({ method: 'POST', url: '/api/estimates', headers: ownerHeaders, payload: fixtureEstimate() });
    expect(current.statusCode).toBe(200);
    expect(EstimateResponseSchema.parse(current.json()).tiers[0].rangeMin).toBeGreaterThan(historic.tier_basic.rangeMin);
    expect((await database.pool.query('select id,rate_table_version,tier_basic,tier_standard,tier_premium from cost_estimates where id=$1', [historic.id])).rows[0]).toEqual(historic);
    expect((await database.pool.query('select rate_table_version from cost_estimates order by created_at desc limit 1')).rows[0].rate_table_version).toBe(version);
  });
});
