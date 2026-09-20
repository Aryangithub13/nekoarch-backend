import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { startTestDatabase, createTestUser, asPrincipal, seedTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { fixturePlan, fixtureEstimate } from '../../../test-support/fixtures.js';

const env = parseEnv({ NODE_ENV: 'test', SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'fixture', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false' });
describe('durable idempotency under real PostgreSQL RLS and concurrency', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>;
  let app: ReturnType<typeof buildApp>;
  let owner: string;
  let other: string;
  const post = (url: string, key: string, payload: object, token = 'owner') => app.inject({ method: 'POST', url,
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': key }, payload });
  beforeAll(async () => {
    db = await startTestDatabase();
    owner = await createTestUser(db.pool); other = await createTestUser(db.pool);
    app = buildApp({ env, backend: createPgBackend(db.pool, { owner, other }), captureError: () => undefined });
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });

  it.each([
    ['/api/plans', { plan: fixturePlan() }, 'plans', 201],
    ['/api/plans/generate', { prompt: '2BHK with open kitchen', seed: 'concurrent' }, 'plans', 201],
    ['/api/estimates', fixtureEstimate(), 'cost_estimates', 200],
  ] as const)('commits one operation and identical responses across concurrent %s requests', async (url, payload, table, status) => {
    const before = Number((await db.pool.query(`select count(*) from public.${table}`)).rows[0].count);
    const responses = await Promise.all(Array.from({ length: 8 }, () => post(url, `parallel-${table}-${status}-${url.replaceAll('/', '-')}`, payload)));
    for (const response of responses) expect(response.statusCode).toBe(status);
    for (const response of responses) expect(response.json()).toEqual(responses[0]!.json());
    expect(Number((await db.pool.query(`select count(*) from public.${table}`)).rows[0].count)).toBe(before + 1);
    if (table === 'plans') {
      const id = responses[0]!.json().plan.id;
      expect((await db.pool.query('select count(*) from public.generation_logs where plan_id=$1', [id])).rows[0].count).toBe('1');
      expect((await db.pool.query('select count(distinct share_token) from public.plans where id=$1', [id])).rows[0].count).toBe('1');
    }
  });

  it('replays after app restart and rejects different semantic input', async () => {
    const payload = { plan: fixturePlan() };
    const first = await post('/api/plans', 'restart', payload);
    expect(first.statusCode).toBe(201);
    await app.close();
    app = buildApp({ env, backend: createPgBackend(db.pool, { owner, other }), captureError: () => undefined });
    const replay = await post('/api/plans', 'restart', { plan: { ...payload.plan, seed: payload.plan.seed } });
    expect(replay.json()).toEqual(first.json());
    const conflict = await post('/api/plans', 'restart', { plan: { ...payload.plan, seed: 'changed' } });
    expect(conflict.statusCode).toBe(409); expect(conflict.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('isolates users and routes, including their share tokens and receipts', async () => {
    const payload = { plan: fixturePlan() };
    const first = await post('/api/plans', 'isolation', payload);
    const second = await post('/api/plans', 'isolation', payload, 'other');
    expect(second.statusCode).toBe(201);
    expect(second.json().plan.id).not.toBe(first.json().plan.id);
    expect(second.json().shareToken).not.toBe(first.json().shareToken);
    expect((await post('/api/estimates', 'isolation', fixtureEstimate())).statusCode).toBe(200);
    const hidden = await asPrincipal(db.pool, other, client => client.query('select response from public.idempotency_records where user_id=$1', [owner]));
    expect(hidden.rows).toEqual([]);
    await expect(asPrincipal(db.pool, null, client => client.query('select * from public.idempotency_records'))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, null, client => client.query("select public.commit_idempotent_creation('/api/plans','x','y','plan','{}','{}')"))).rejects.toMatchObject({ code: '42501' });
  });

  it('enforces receipt ownership and RLS inside the RPC, with no update privilege', async () => {
    await expect(asPrincipal(db.pool, other, client => client.query(`insert into public.idempotency_records(user_id,operation,key_hash,fingerprint,response)
      values($1,'/api/plans',$2,$3,'{}')`, [owner, 'a'.repeat(64), 'b'.repeat(64)]))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, owner, client => client.query("update public.idempotency_records set response='{}'"))).rejects.toMatchObject({ code: '42501' });
    expect((await asPrincipal(db.pool, other, client => client.query('delete from public.idempotency_records where user_id=$1', [owner]))).rowCount).toBe(0);
    const plan = fixturePlan();
    const repo = createPgBackend(db.pool, { owner }).repository('owner');
    await expect(repo.commitIdempotency!({ operation: '/api/plans', keyHash: 'c'.repeat(64), fingerprint: 'd'.repeat(64) }, {
      kind: 'plan', row: { user_id: other, prompt: plan.prompt, seed: plan.seed, variant: plan.variant, plan_data: plan,
        qa_orthogonal: plan.qa.orthogonal, bounds_width_m: plan.bounds.w, bounds_depth_m: plan.bounds.d,
        room_count: plan.rooms.length, share_token: 'e'.repeat(43) },
    }, { plan: { ...plan, id: owner }, shareToken: 'e'.repeat(43) })).rejects.toMatchObject({ statusCode: 403 });
    expect((await db.pool.query('select count(*) from idempotency_records where key_hash=$1', ['c'.repeat(64)])).rows[0].count).toBe('0');
  });

  it('resolves simultaneous different payloads as one success and one conflict', async () => {
    const responses = await Promise.all(['seed-a', 'seed-b'].map(seed => post('/api/plans/generate', 'racing-conflict', { prompt: '2BHK with open kitchen', seed })));
    expect(responses.map(res => res.statusCode).sort()).toEqual([201, 409]);
  });

  it('rolls back failed audit and receipt together and permits retry', async () => {
    const before = (await db.pool.query('select (select count(*) from plans) plans, (select count(*) from generation_logs) audits, (select count(*) from idempotency_records) receipts')).rows[0];
    await db.pool.query(`create function public.phase8_fail() returns trigger language plpgsql as $$ begin raise exception 'private failure'; end $$;
      create trigger phase8_fail before insert on public.generation_logs for each row execute function public.phase8_fail();`);
    try {
      expect((await post('/api/plans', 'retry-failure', { plan: fixturePlan() })).statusCode).toBe(500);
    } finally { await db.pool.query('drop trigger phase8_fail on public.generation_logs; drop function public.phase8_fail();'); }
    expect((await db.pool.query('select (select count(*) from plans) plans, (select count(*) from generation_logs) audits, (select count(*) from idempotency_records) receipts')).rows[0]).toEqual(before);
    const first = await post('/api/plans', 'retry-failure', { plan: fixturePlan() });
    expect(first.statusCode).toBe(201);
    expect((await post('/api/plans', 'retry-failure', { plan: fixturePlan() })).json()).toEqual(first.json());
  });

  it('allows a new creation after receipt expiry', async () => {
    const first = await post('/api/plans', 'expired', { plan: fixturePlan() });
    await db.pool.query("update public.idempotency_records set expires_at=now()-interval '1 second' where response->'plan'->>'id'=$1", [first.json().plan.id]);
    const second = await post('/api/plans', 'expired', { plan: fixturePlan() });
    expect(second.statusCode).toBe(201); expect(second.json().plan.id).not.toBe(first.json().plan.id);
  });

  it('replays estimates even after their referenced rates change', async () => {
    const first = await post('/api/estimates', 'historic', fixtureEstimate());
    expect(first.statusCode).toBe(200);
    await db.pool.query('update public.rate_table_entries set is_active=false');
    try { expect((await post('/api/estimates', 'historic', fixtureEstimate())).json()).toEqual(first.json()); }
    finally { await db.pool.query('update public.rate_table_entries set is_active=true'); }
  });

  it('upgrades Phase 7 schema with existing data and preserves seed replay', async () => {
    // Remove only Phase 8 objects in this isolated fixture, then replay the append-only migration.
    const count = (await db.pool.query('select count(*) from plans')).rows[0].count;
    await db.pool.query('drop function public.commit_idempotent_creation(text,text,text,text,jsonb,jsonb); drop table public.idempotency_records;');
    await db.pool.query(await readFile(new URL('../../../supabase/migrations/0005_idempotency.sql', import.meta.url), 'utf8'));
    await seedTestDatabase(db.pool);
    expect((await db.pool.query('select count(*) from plans')).rows[0].count).toBe(count);
    expect((await post('/api/plans', 'upgraded', { plan: fixturePlan() })).statusCode).toBe(201);
  });
});
