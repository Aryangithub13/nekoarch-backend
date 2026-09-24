import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asPrincipal, createTestUser, seedTestDatabase, startTestDatabase } from '../../test-support/postgres.js';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
let owner: string;
let stranger: string;
let version: string;

const planData = {
  prompt: 'A compact home', seed: 'database-fixture', variant: 1,
  rooms: [{ id: 1, name: 'Living', type: 'living', rect: { x: 0, z: 0, w: 5, d: 4 } }],
  walls: [], furn: [], bounds: { x: 0, z: 0, w: 5, d: 4 },
  qa: { orthogonal: 1, walls: 0, pieces: 0 },
};

async function insertPlan(client: Pool | PoolClient, userId: string, data = planData) {
  const result = await client.query<{ id: string }>(`
    insert into public.plans (user_id, prompt, seed, variant, plan_data, qa_orthogonal,
      bounds_width_m, bounds_depth_m, room_count, share_token)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`, [
    userId, data.prompt, data.seed, data.variant, data, data.qa.orthogonal,
    data.bounds.w, data.bounds.d, data.rooms.length, randomBytes(32).toString('base64url'),
  ]);
  return result.rows[0]!.id;
}

async function insertEstimate(client: Pool | PoolClient, userId: string, planId: string | null = null) {
  const result = await client.query<{ id: string }>(`
    insert into public.cost_estimates (user_id, plan_id, location, building_type,
      built_up_area_sqft, floors, budget_provided, rate_table_version, tier_basic, tier_standard, tier_premium)
    values ($1, $2, 'India baseline (illustrative)', 'residential', 1000, 1, 3000000, $3,
      '{"tier":"basic"}', '{"tier":"standard"}', '{"tier":"premium"}') returning id`, [userId, planId, version]);
  return result.rows[0]!.id;
}

beforeAll(async () => { db = await startTestDatabase(); });
afterAll(async () => { await db?.stop(); });
beforeEach(async () => {
  await db.pool.query('truncate public.cost_estimates, public.generation_logs, public.plans, public.rate_table_entries, public.rate_table_versions, public.profiles, auth.users cascade');
  await seedTestDatabase(db.pool);
  owner = await createTestUser(db.pool);
  stranger = await createTestUser(db.pool);
  version = (await db.pool.query<{ id: string }>('select id from public.rate_table_versions')).rows[0]!.id;
});

describe('migration replay and relational integrity on real PostgreSQL', () => {
  it('replays all migrations into exactly eleven public tables with RLS enabled', async () => {
    const result = await db.pool.query<{ relname: string; relrowsecurity: boolean }>(`
      select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by relname`);
    expect(result.rows.map(row => row.relname)).toEqual(['cost_estimates', 'generation_logs', 'idempotency_records', 'plans', 'profiles', 'project_audit_events', 'project_revision_qa_runs', 'project_revisions', 'projects', 'rate_table_entries', 'rate_table_versions']);
    expect(result.rows.every(row => row.relrowsecurity)).toBe(true);
  });

  it('defines every foreign key and deliberate deletion behavior', async () => {
    const result = await db.pool.query<{ definition: string }>(`
      select pg_get_constraintdef(oid) as definition from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace`);
    expect(result.rows).toHaveLength(16);
    expect(result.rows.map(row => row.definition)).toEqual(expect.arrayContaining([
      'FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE',
      'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
      'FOREIGN KEY (rate_table_version) REFERENCES rate_table_versions(id) ON DELETE RESTRICT',
      'FOREIGN KEY (version_id) REFERENCES rate_table_versions(id) ON DELETE CASCADE',
    ]));
  });

  it('creates profiles automatically for anonymous users and removes ownership when deleted', async () => {
    expect((await db.pool.query('select id from public.profiles where id = $1', [owner])).rowCount).toBe(1);
    const id = await asPrincipal(db.pool, owner, client => insertPlan(client, owner));
    await db.pool.query('delete from auth.users where id = $1', [owner]);
    expect((await db.pool.query('select user_id from public.plans where id = $1', [id])).rows[0].user_id).toBeNull();
    expect((await asPrincipal(db.pool, stranger, client => client.query('select id from public.plans where id = $1', [id]))).rowCount).toBe(0);
  });

  it('rejects nonpositive dimensions, invalid variants, missing plan data, and mismatched metadata', async () => {
    for (const data of [
      { ...planData, bounds: { ...planData.bounds, w: 0 } },
      { ...planData, bounds: { ...planData.bounds, d: -1 } },
      { ...planData, variant: 0 }, { ...planData, rooms: [] },
    ]) {
      await expect(asPrincipal(db.pool, owner, client => insertPlan(client, owner, data))).rejects.toMatchObject({ code: '23514' });
    }
    const id = await insertPlan(db.pool, owner);
    await expect(db.pool.query("update public.plans set plan_data = '{}' where id = $1", [id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query('update public.plans set room_count = 99 where id = $1', [id])).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces unique share tokens and rejects nonfinite rates', async () => {
    const id = await insertPlan(db.pool, owner);
    const second = await insertPlan(db.pool, owner);
    const token = (await db.pool.query('select share_token from public.plans where id = $1', [id])).rows[0].share_token;
    await expect(db.pool.query('update public.plans set share_token = $1 where id = $2', [token, second])).rejects.toMatchObject({ code: '23505' });
    await expect(db.pool.query("update public.rate_table_entries set rate_per_sqft_max = 'NaN'::numeric")).rejects.toMatchObject({ code: '23514' });
  });
});

describe('database authorization independent of API handlers', () => {
  it('lets the owner insert, read, update sharing, and delete a plan', async () => {
    const id = await asPrincipal(db.pool, owner, client => insertPlan(client, owner));
    const result = await asPrincipal(db.pool, owner, client => client.query('update public.plans set is_public = true where id = $1 returning id, is_public', [id]));
    expect(result.rows).toEqual([{ id, is_public: true }]);
    expect((await asPrincipal(db.pool, owner, client => client.query('delete from public.plans where id = $1 returning id', [id]))).rowCount).toBe(1);
  });

  it('prevents cross-user private reads, updates, deletes, and ownership forgery', async () => {
    const id = await asPrincipal(db.pool, owner, client => insertPlan(client, owner));
    for (const sql of ['select id from public.plans where id = $1', 'update public.plans set is_public = true where id = $1 returning id', 'delete from public.plans where id = $1 returning id']) {
      expect((await asPrincipal(db.pool, stranger, client => client.query(sql, [id]))).rowCount).toBe(0);
    }
    await expect(asPrincipal(db.pool, stranger, client => insertPlan(client, owner))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, null, client => insertPlan(client, owner))).rejects.toMatchObject({ code: '42501' });
  });

  it('permits public reads but hides share tokens from owner, stranger and unauthenticated readers', async () => {
    const id = await asPrincipal(db.pool, owner, client => insertPlan(client, owner));
    await asPrincipal(db.pool, owner, client => client.query('update public.plans set is_public = true where id = $1', [id]));
    for (const principal of [owner, stranger, null]) {
      expect((await asPrincipal(db.pool, principal, client => client.query('select id, plan_data from public.plans where id = $1', [id]))).rowCount).toBe(1);
      await expect(asPrincipal(db.pool, principal, client => client.query('select share_token from public.plans where id = $1', [id]))).rejects.toMatchObject({ code: '42501' });
      await expect(asPrincipal(db.pool, principal, client => client.query('select * from public.plans where id = $1', [id]))).rejects.toMatchObject({ code: '42501' });
    }
    expect((await asPrincipal(db.pool, stranger, client => client.query('update public.plans set is_public = false where id = $1 returning id', [id]))).rowCount).toBe(0);
  });

  it('prevents direct edits to ownership, geometry and persistence metadata', async () => {
    const id = await asPrincipal(db.pool, owner, client => insertPlan(client, owner));
    for (const mutation of ["user_id = null", "share_token = repeat('a', 43)", "prompt = 'changed'", 'created_at = now()', "plan_data = '{}'::jsonb"]) {
      await expect(asPrincipal(db.pool, owner, client => client.query(`update public.plans set ${mutation} where id = $1`, [id]))).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('restricts profiles to their owner and editable display name', async () => {
    const result = await asPrincipal(db.pool, owner, client => client.query('select id from public.profiles'));
    expect(result.rows).toEqual([{ id: owner }]);
    await asPrincipal(db.pool, owner, client => client.query("update public.profiles set display_name = 'Owner' where id = $1", [owner]));
    expect((await asPrincipal(db.pool, stranger, client => client.query("update public.profiles set display_name = 'Intruder' where id = $1 returning id", [owner]))).rowCount).toBe(0);
    await expect(asPrincipal(db.pool, owner, client => client.query('update public.profiles set created_at = now()'))).rejects.toMatchObject({ code: '42501' });
  });

  it('keeps estimates private when the linked plan is public', async () => {
    const id = await asPrincipal(db.pool, owner, client => insertPlan(client, owner));
    await asPrincipal(db.pool, owner, client => client.query('update public.plans set is_public = true where id = $1', [id]));
    const estimateId = await asPrincipal(db.pool, owner, client => insertEstimate(client, owner, id));
    expect((await asPrincipal(db.pool, owner, client => client.query('select id from public.cost_estimates'))).rows).toEqual([{ id: estimateId }]);
    expect((await asPrincipal(db.pool, stranger, client => client.query('select id from public.cost_estimates'))).rowCount).toBe(0);
    await expect(asPrincipal(db.pool, null, client => client.query('select id from public.cost_estimates'))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, stranger, client => insertEstimate(client, owner, id))).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects linking estimates to inaccessible plans while allowing a readable public plan', async () => {
    const id = await asPrincipal(db.pool, owner, client => insertPlan(client, owner));
    await expect(asPrincipal(db.pool, stranger, client => insertEstimate(client, stranger, id))).rejects.toMatchObject({ code: '42501' });
    await asPrincipal(db.pool, owner, client => client.query('update public.plans set is_public = true where id = $1', [id]));
    expect(await asPrincipal(db.pool, stranger, client => insertEstimate(client, stranger, id))).toBeTypeOf('string');
  });

  it('writes one atomic audit row without exposing logs to clients', async () => {
    const id = await asPrincipal(db.pool, owner, client => insertPlan(client, owner));
    const logs = (await db.pool.query('select event_type, detail from public.generation_logs where plan_id = $1', [id])).rows;
    expect(logs).toEqual([{ event_type: 'generated', detail: { variant: 1, roomCount: 1 } }]);
    await expect(asPrincipal(db.pool, owner, client => client.query('select * from public.generation_logs'))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, owner, client => client.query("insert into public.generation_logs (plan_id, event_type) values ($1, 'generated')", [id]))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, owner, async client => {
      await insertPlan(client, owner);
      throw new Error('force rollback');
    })).rejects.toThrow('force rollback');
    expect((await db.pool.query('select count(*)::int as count from public.generation_logs')).rows[0].count).toBe(1);
  });
});

describe('versioned rates, seed completeness and historical provenance', () => {
  it('has one dated version, rerunnable seed and all nine positive, normalized entries', async () => {
    await seedTestDatabase(db.pool);
    const versions = (await db.pool.query("select version_label, effective_date::text from public.rate_table_versions")).rows;
    expect(versions).toEqual([{ version_label: '2026-09-01-illustrative-baseline', effective_date: '2026-09-01' }]);
    const entries = (await db.pool.query('select building_type, tier, rate_per_sqft_min, rate_per_sqft_max, category_breakdown from public.rate_table_entries')).rows;
    expect(entries).toHaveLength(9);
    for (const type of ['residential', 'commercial', 'institutional']) expect(entries.filter(row => row.building_type === type).map(row => row.tier).sort()).toEqual(['basic', 'premium', 'standard']);
    for (const row of entries) {
      expect(Number(row.rate_per_sqft_min)).toBeGreaterThan(0);
      expect(Number(row.rate_per_sqft_max)).toBeGreaterThan(Number(row.rate_per_sqft_min));
      expect(Object.values(row.category_breakdown).reduce<number>((sum, value) => sum + Number(value), 0)).toBeCloseTo(1, 10);
    }
  });

  it('allows publicly reading effective active rates and prevents client mutation', async () => {
    for (const principal of [owner, null]) {
      expect((await asPrincipal(db.pool, principal, client => client.query('select * from public.rate_table_entries'))).rowCount).toBe(9);
      await expect(asPrincipal(db.pool, principal, client => client.query('update public.rate_table_entries set rate_per_sqft_min = 1'))).rejects.toMatchObject({ code: '42501' });
      await expect(asPrincipal(db.pool, principal, client => client.query("insert into public.rate_table_versions (version_label,effective_date) values ('hacked',current_date)"))).rejects.toMatchObject({ code: '42501' });
    }
    await db.pool.query("insert into public.rate_table_versions (version_label,effective_date) values ('future',current_date + 1)");
    expect((await asPrincipal(db.pool, null, client => client.query('select * from public.rate_table_versions'))).rowCount).toBe(1);
    await db.pool.query("update public.rate_table_entries set is_active = false where tier = 'basic'");
    expect((await asPrincipal(db.pool, null, client => client.query('select * from public.rate_table_entries'))).rowCount).toBe(6);
  });

  it('rejects duplicate versions/grid entries and invalid weight/rate constraints', async () => {
    await expect(db.pool.query("insert into public.rate_table_versions(version_label,effective_date) values ('2026-09-01-illustrative-baseline',current_date)")).rejects.toMatchObject({ code: '23505' });
    await expect(db.pool.query(`insert into public.rate_table_entries(version_id,region,building_type,tier,rate_per_sqft_min,rate_per_sqft_max,category_breakdown)
      select version_id,region,building_type,tier,rate_per_sqft_min,rate_per_sqft_max,category_breakdown from public.rate_table_entries limit 1`)).rejects.toMatchObject({ code: '23505' });
    for (const mutation of ["category_breakdown = '[]'", "category_breakdown = '{\"x\":0.5}'", "category_breakdown = '{\"x\":1,\"y\":0}'", 'rate_per_sqft_min = 0', 'rate_per_sqft_max = 1', "tier = 'luxury'", "building_type = 'garage'"]) {
      await expect(db.pool.query(`update public.rate_table_entries set ${mutation}`)).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('preserves referenced versions and their financial rates after newer publication', async () => {
    await asPrincipal(db.pool, owner, client => insertEstimate(client, owner));
    await expect(db.pool.query('delete from public.rate_table_versions where id = $1', [version])).rejects.toThrow();
    await expect(db.pool.query('update public.rate_table_entries set rate_per_sqft_min = rate_per_sqft_min + 1')).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query('delete from public.rate_table_entries')).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query("update public.rate_table_versions set version_label = 'rewritten' where id = $1", [version])).rejects.toMatchObject({ code: '23514' });
    await db.pool.query("update public.rate_table_entries set is_active = false where tier = 'basic'");
    await seedTestDatabase(db.pool);
    await db.pool.query("insert into public.rate_table_versions(version_label,effective_date) values ('newer', current_date)");
    expect((await db.pool.query('select rate_table_version from public.cost_estimates')).rows[0].rate_table_version).toBe(version);
    expect((await db.pool.query('select count(*)::int as count from public.rate_table_entries')).rows[0].count).toBe(9);
  });
});
