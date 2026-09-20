import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatePlan, parseRequirements } from '@designflow/generator';
import { ApiErrorResponseSchema, CreatePlanResponseSchema, EstimateResponseSchema, GetPlanResponseSchema } from '@designflow/shared';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { startTestDatabase, asPrincipal } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { fixtureEstimate } from '../../../test-support/fixtures.js';

const prompt = '2BHK with open kitchen';
const requirements = parseRequirements(prompt);
const env = parseEnv({ NODE_ENV: 'test', RATE_LIMIT_ENABLED: 'false', SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'test', LOG_LEVEL: 'silent' });

describe('Phase 7 generation with PostgreSQL ownership, audit and downstream operations', () => {
  let database: Awaited<ReturnType<typeof startTestDatabase>>;
  let app: ReturnType<typeof buildApp>;
  const owner = randomUUID(); const other = randomUUID();
  const ownerHeaders = { authorization: 'Bearer owner' }; const otherHeaders = { authorization: 'Bearer other' };
  beforeAll(async () => {
    database = await startTestDatabase();
    await database.pool.query('insert into auth.users(id) values ($1),($2)', [owner, other]);
    app = buildApp({ env, backend: createPgBackend(database.pool, { owner, other }) });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await database?.stop(); });
  const post = (payload: object, headers = ownerHeaders) => app.inject({ method: 'POST', url: '/api/plans/generate', headers, payload });
  const counts = async () => (await database.pool.query('select (select count(*)::int from plans) plans, (select count(*)::int from generation_logs) logs')).rows[0];

  it.each([{ requirements }, { prompt }])('generates, commits one owner audit, retrieves, shares, estimates and revokes: %j', async payload => {
    const response = await post({ ...payload, seed: 'phase7-e2e' });
    expect(response.statusCode).toBe(201);
    const created = CreatePlanResponseSchema.parse(response.json());
    const id = created.plan.id;
    const { id: _id, ...canonical } = created.plan;
    expect(canonical).toEqual(generatePlan(requirements, { seed: 'phase7-e2e' }));
    const stored = (await database.pool.query('select user_id,is_public,share_token,plan_data from plans where id=$1', [id])).rows[0];
    expect(stored).toEqual({ user_id: owner, is_public: false, share_token: created.shareToken, plan_data: canonical });
    expect((await database.pool.query('select event_type,detail from generation_logs where plan_id=$1', [id])).rows).toEqual([
      { event_type: 'generated', detail: { variant: 1, roomCount: created.plan.rooms.length } },
    ]);
    const fetched = await app.inject({ method: 'GET', url: `/api/plans/${id}`, headers: ownerHeaders });
    expect(fetched.statusCode).toBe(200); expect(GetPlanResponseSchema.parse(fetched.json()).plan).toEqual(created.plan);
    expect(fetched.body).not.toContain(created.shareToken);
    for (const headers of [otherHeaders, {}]) {
      expect((await app.inject({ method: 'GET', url: `/api/plans/${id}`, headers })).statusCode).toBe(404);
    }
    expect((await app.inject({ method: 'PATCH', url: `/api/plans/${id}`, headers: otherHeaders, payload: { isPublic: true } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/estimates', headers: otherHeaders, payload: { ...fixtureEstimate(), planId: id } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/api/plans/${id}`, headers: ownerHeaders, payload: { isPublic: true } })).statusCode).toBe(200);
    const shared = await app.inject({ method: 'GET', url: `/api/plans/${id}` });
    expect(shared.statusCode).toBe(200); expect(shared.json().plan).toEqual(created.plan);
    expect(shared.body).not.toContain(created.shareToken); expect(shared.body).not.toContain(owner);
    const estimated = await app.inject({ method: 'POST', url: '/api/estimates', headers: ownerHeaders, payload: { ...fixtureEstimate(), planId: id } });
    expect(estimated.statusCode).toBe(200);
    const estimate = EstimateResponseSchema.parse(estimated.json());
    const record = (await database.pool.query('select id,plan_id,user_id,rate_table_version,tier_basic from cost_estimates where plan_id=$1', [id])).rows[0];
    expect(record).toMatchObject({ plan_id: id, user_id: owner, tier_basic: estimate.tiers[0] });
    expect((await database.pool.query('select version_label from rate_table_versions where id=$1', [record.rate_table_version])).rowCount).toBe(1);
    expect((await asPrincipal(database.pool, other, client => client.query('select id from cost_estimates where plan_id=$1', [id]))).rowCount).toBe(0);
    expect((await app.inject({ method: 'PATCH', url: `/api/plans/${id}`, headers: ownerHeaders, payload: { isPublic: false } })).statusCode).toBe(200);
    for (const headers of [otherHeaders, {}]) {
      expect((await app.inject({ method: 'GET', url: `/api/plans/${id}?share_token=${created.shareToken}`, headers })).statusCode).toBe(404);
    }
  });

  it('preserves geometry across same-seed requests with independent persistence identities', async () => {
    const responses = await Promise.all([post({ requirements, seed: 'repeat', variant: 2 }), post({ requirements, seed: 'repeat', variant: 2 })]);
    expect(responses.map(response => response.statusCode)).toEqual([201, 201]);
    const [a, b] = responses.map(response => CreatePlanResponseSchema.parse(response.json()));
    expect(a!.plan).toEqual({ ...b!.plan, id: a!.plan.id });
    expect(a!.plan.id).not.toBe(b!.plan.id); expect(a!.shareToken).not.toBe(b!.shareToken);
  });

  it('isolates concurrent seeds, inputs, owners and committed audits', async () => {
    const cases = Array.from({ length: 8 }, (_, index) => ({ prompt: index % 2 ? '1BHK' : prompt, seed: `concurrent-${index}`, variant: index + 1 }));
    const responses = await Promise.all(cases.map((payload, index) => post(payload, index % 2 ? otherHeaders : ownerHeaders)));
    for (const [index, response] of responses.entries()) {
      expect(response.statusCode).toBe(201);
      const result = CreatePlanResponseSchema.parse(response.json()); const input = cases[index]!;
      expect(result.plan).toEqual({ ...generatePlan(parseRequirements(input.prompt), inputOptions(input)), id: result.plan.id });
      const record = (await database.pool.query('select user_id from plans where id=$1', [result.plan.id])).rows[0];
      expect(record.user_id).toBe(index % 2 ? other : owner);
      expect((await database.pool.query('select id from generation_logs where plan_id=$1', [result.plan.id])).rowCount).toBe(1);
    }
  });

  it.each([
    [{ prompt: 'two storey house' }, 'UNSUPPORTED_REQUIREMENT'],
    [{ requirements: { prompt: 'small bedroom', bounds: { x: 0, z: 0, w: 3, d: 3 }, rooms: [{ type: 'bedroom', count: 8 }] } }, 'IMPOSSIBLE_LAYOUT'],
  ])('leaves no plan or audit after actual generator rejection: %j', async (payload, code) => {
    const before = await counts();
    const response = await post(payload as object);
    expect(response.statusCode).toBe(422);
    expect(ApiErrorResponseSchema.parse(response.json()).error).toMatchObject({ code, requestId: response.headers['x-request-id'] });
    expect(await counts()).toEqual(before);
  });

  it.each(['plans', 'generation_logs'])('rolls back both records on %s insert failure', async table => {
    const before = await counts();
    await database.pool.query(`create function public.phase7_fail_fixture() returns trigger language plpgsql as $$
      begin raise exception 'private-phase7-database-detail'; end; $$;
      create trigger phase7_fail_fixture before insert on public.${table} for each row execute function public.phase7_fail_fixture();`);
    try {
      const response = await post({ prompt });
      expect(response.statusCode).toBe(500);
      expect(ApiErrorResponseSchema.parse(response.json()).error.code).toBe('DATABASE_ERROR');
      expect(response.body).not.toContain('private-phase7-database-detail'); expect(response.body).not.toContain('shareToken');
      expect(await counts()).toEqual(before);
    } finally {
      await database.pool.query(`drop trigger phase7_fail_fixture on public.${table}; drop function public.phase7_fail_fixture();`);
    }
  });

  it('keeps linked estimate history unchanged when a new rate version is published', async () => {
    const generated = await post({ prompt }); expect(generated.statusCode).toBe(201);
    const planId = CreatePlanResponseSchema.parse(generated.json()).plan.id;
    const request = { method: 'POST' as const, url: '/api/estimates', headers: ownerHeaders, payload: { ...fixtureEstimate(), planId } };
    expect((await app.inject(request)).statusCode).toBe(200);
    const historic = (await database.pool.query('select * from cost_estimates where plan_id=$1', [planId])).rows[0];
    const version = (await database.pool.query("insert into rate_table_versions(version_label,effective_date) values ('phase7-provenance',current_date) returning id")).rows[0].id;
    await database.pool.query(`insert into rate_table_entries(version_id,region,building_type,tier,rate_per_sqft_min,rate_per_sqft_max,category_breakdown)
      select $1,region,building_type,tier,rate_per_sqft_min * 1.1,rate_per_sqft_max * 1.1,category_breakdown from rate_table_entries where version_id=$2`, [version, historic.rate_table_version]);
    const current = await app.inject(request); expect(current.statusCode).toBe(200);
    expect(current.json().tiers[0].rangeMin).toBeGreaterThan(historic.tier_basic.rangeMin);
    expect((await database.pool.query('select * from cost_estimates where id=$1', [historic.id])).rows[0]).toEqual(historic);
    expect((await database.pool.query('select rate_table_version from cost_estimates where plan_id=$1 order by created_at desc limit 1', [planId])).rows[0].rate_table_version).toBe(version);
  });
});

function inputOptions(input: { seed: string; variant: number }) { return { seed: input.seed, variant: input.variant }; }
