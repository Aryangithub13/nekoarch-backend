import { createHash, randomBytes } from 'node:crypto';
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

const PHASE30_FOREIGN_KEYS: string[] = [
  'project_revision_appearances: FOREIGN KEY (artifact_id) REFERENCES project_revision_candidate_artifacts(id)',
  'project_revision_appearances: FOREIGN KEY (operation_id) REFERENCES project_revision_operations(id)',
  'project_revision_appearances: FOREIGN KEY (project_id, revision_id) REFERENCES project_revisions(project_id, id)',
  'project_revision_candidate_artifacts: FOREIGN KEY (operation_id) REFERENCES project_revision_operations(id)',
  'project_revision_candidate_blobs: FOREIGN KEY (artifact_id) REFERENCES project_revision_candidate_artifacts(id) ON DELETE CASCADE',
  'project_revision_operation_events: FOREIGN KEY (operation_id) REFERENCES project_revision_operations(id)',
  'project_revision_operation_events: FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE',
  'project_revision_operations: FOREIGN KEY (committed_revision_id) REFERENCES project_revisions(id)',
  'project_revision_operations: FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE',
  'project_revision_operations: FOREIGN KEY (project_id, base_revision_id) REFERENCES project_revisions(project_id, id)',
  'project_revision_operations: FOREIGN KEY (project_id, restore_source_revision_id) REFERENCES project_revisions(project_id, id)',
];
/** Phases 31–33 (0021 references, 0022 durable jobs, 0023 account/library/briefs), transcribed from the migrations. user_settings has none. */
const PHASE31_33_FOREIGN_KEYS: string[] = [
  'project_briefs: FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE',
  'project_job_events: FOREIGN KEY (job_id) REFERENCES project_jobs(id) ON DELETE CASCADE',
  'project_job_events: FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE',
  'project_jobs: FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE',
  'project_library: FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE',
  'project_reference_blobs: FOREIGN KEY (reference_id) REFERENCES project_references(id)',
  'project_reference_events: FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE',
  'project_reference_events: FOREIGN KEY (reference_id) REFERENCES project_references(id)',
  'project_references: FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE',
  'project_references: FOREIGN KEY (project_id, bound_revision_id) REFERENCES project_revisions(project_id, id)',
];

describe('migration replay and relational integrity on real PostgreSQL', () => {
  it('replays all migrations into exactly thirty-six public tables with RLS enabled', async () => {
    const result = await db.pool.query<{ relname: string; relrowsecurity: boolean }>(`
      select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by relname`);
    expect(result.rows.map(row => row.relname)).toEqual(['architectural_conversations', 'cost_estimates', 'generation_logs', 'idempotency_records', 'plans', 'profiles', 'project_audit_events', 'project_briefs', 'project_job_events', 'project_jobs', 'project_library', 'project_reference_blobs', 'project_reference_events', 'project_references', 'project_revision_appearances', 'project_revision_building_systems_analyses', 'project_revision_candidate_artifacts', 'project_revision_candidate_blobs', 'project_revision_construction_calculations', 'project_revision_cost_estimates', 'project_revision_environmental_analyses', 'project_revision_operation_events', 'project_revision_operations', 'project_revision_optimization_studies', 'project_revision_qa_runs', 'project_revision_scene_artifacts', 'project_revision_scene_blobs', 'project_revision_specialized_knowledge_analyses', 'project_revision_structural_analyses', 'project_revision_takeoffs', 'project_revisions', 'project_workflow_runs', 'projects', 'rate_table_entries', 'rate_table_versions', 'user_settings']);
    expect(result.rows.every(row => row.relrowsecurity)).toBe(true);
  });

  it('defines every foreign key and deliberate deletion behavior', async () => {
    const result = await db.pool.query<{ definition: string }>(`
      select pg_get_constraintdef(oid) as definition from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace`);
    // 34 through 0016, plus exactly the five 0017 knowledge-table, two 0018 optimization-table, three 0019 scene-table, eleven 0020 revision-operation and
    // ten 0021–0023 reference/job/account references pinned below.
    expect(result.rows).toHaveLength(65);
    const phase31to33 = await db.pool.query<{ table: string; definition: string }>(`
      select conrelid::regclass::text as table, pg_get_constraintdef(oid) as definition from pg_constraint
      where contype = 'f' and conrelid in ('public.project_references'::regclass, 'public.project_reference_blobs'::regclass, 'public.project_reference_events'::regclass,
        'public.project_jobs'::regclass, 'public.project_job_events'::regclass, 'public.user_settings'::regclass, 'public.project_library'::regclass,
        'public.project_briefs'::regclass)`);
    // Sorted here, not in SQL, so the comparison does not depend on the database collation.
    expect(phase31to33.rows.map(row => `${row.table}: ${row.definition}`).sort()).toEqual(PHASE31_33_FOREIGN_KEYS);
    const revision = await db.pool.query<{ table: string; definition: string }>(`
      select conrelid::regclass::text as table, pg_get_constraintdef(oid) as definition from pg_constraint
      where contype = 'f' and conrelid in ('public.project_revision_operations'::regclass, 'public.project_revision_candidate_artifacts'::regclass, 'public.project_revision_candidate_blobs'::regclass,
        'public.project_revision_appearances'::regclass, 'public.project_revision_operation_events'::regclass) order by 1, 2`);
    expect(revision.rows.map(row => `${row.table}: ${row.definition}`)).toEqual(PHASE30_FOREIGN_KEYS);
    const scene = await db.pool.query<{ definition: string }>(`
      select pg_get_constraintdef(oid) as definition from pg_constraint
      where contype = 'f' and conrelid in ('public.project_revision_scene_artifacts'::regclass, 'public.project_revision_scene_blobs'::regclass) order by 1`);
    expect(scene.rows.map(row => row.definition)).toEqual([
      'FOREIGN KEY (artifact_id) REFERENCES project_revision_scene_artifacts(id)',
      'FOREIGN KEY (project_revision_id) REFERENCES project_revisions(id)',
      'FOREIGN KEY (project_revision_id, acceptance_qa_id) REFERENCES project_revision_qa_runs(revision_id, id)',
    ]);
    const optimization = await db.pool.query<{ definition: string }>(`
      select pg_get_constraintdef(oid) as definition from pg_constraint
      where contype = 'f' and conrelid = 'public.project_revision_optimization_studies'::regclass order by 1`);
    expect(optimization.rows.map(row => row.definition)).toEqual([
      'FOREIGN KEY (project_revision_id) REFERENCES project_revisions(id)',
      'FOREIGN KEY (project_revision_id, acceptance_qa_id) REFERENCES project_revision_qa_runs(revision_id, id)',
    ]);
    const knowledge = await db.pool.query<{ definition: string }>(`
      select pg_get_constraintdef(oid) as definition from pg_constraint
      where contype = 'f' and conrelid = 'public.project_revision_specialized_knowledge_analyses'::regclass order by 1`);
    expect(knowledge.rows.map(row => row.definition)).toEqual([
      'FOREIGN KEY (environmental_analysis_id) REFERENCES project_revision_environmental_analyses(id)',
      'FOREIGN KEY (project_revision_id) REFERENCES project_revisions(id)',
      'FOREIGN KEY (project_revision_id, acceptance_qa_id) REFERENCES project_revision_qa_runs(revision_id, id)',
      'FOREIGN KEY (structural_analysis_id) REFERENCES project_revision_structural_analyses(id)',
      'FOREIGN KEY (systems_analysis_id) REFERENCES project_revision_building_systems_analyses(id)',
    ]);
    expect(result.rows.map(row => row.definition)).toEqual(expect.arrayContaining([
      'FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE',
      'FOREIGN KEY (project_revision_id, takeoff_id, acceptance_qa_id, construction_calculation_id) REFERENCES project_revision_construction_calculations(project_revision_id, takeoff_id, acceptance_qa_id, id)',
      'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
      'FOREIGN KEY (rate_table_version) REFERENCES rate_table_versions(id) ON DELETE RESTRICT',
      'FOREIGN KEY (version_id) REFERENCES rate_table_versions(id) ON DELETE CASCADE',
      'FOREIGN KEY (project_revision_id) REFERENCES project_revisions(id)',
      'FOREIGN KEY (project_revision_id, takeoff_id) REFERENCES project_revision_takeoffs(project_revision_id, id)',
      'FOREIGN KEY (project_revision_id, acceptance_qa_id) REFERENCES project_revision_qa_runs(revision_id, id)',
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

// Characterization of observed behaviour, not an approved deletion or erasure policy (that decision is open; see docs/phase35-1/phase35-1-report.md).
// The design documents disagree: docs/phase12-design.md §2 and docs/PHASE12.md say project deletion is not exposed and account deletion leaves
// inaccessible history, while the Phase 31 and 32 designs describe these children as cascading with the project. What the schema does today:
// the children declare `on delete cascade`, but their guards refuse row deletion, so a project holding such history cannot be hard-deleted even by
// a privileged role. These tests record that, so any future change to it is deliberate and visible; they do not endorse it.
describe('retained project history and guarded deletion (B35.1 characterization of current behaviour)', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const newProject = async (title: string, ownerId = owner) =>
    (await db.pool.query<{ id: string }>('insert into public.projects(owner_id,title) values ($1,$2) returning id', [ownerId, title])).rows[0]!.id;
  const insertReference = async (projectId: string) => {
    const h = sha(projectId);
    const provenance = { sourceKind: 'USER_UPLOAD', uploadedBy: owner, original: { sha256: h, bytes: 10 }, stored: { sha256: h, bytes: 10 },
      inspection: { inspectorVersion: 'reference-inspector-v1', verdict: 'ACCEPTED', detectedMediaType: 'image/png', declaredMediaType: 'image/png',
        malwareScan: { status: 'NOT_PERFORMED', reason: 'NO_SCANNER_CONFIGURED' },
        claims: { malwareFree: 'NOT_CLAIMED', contentAccuracy: 'NOT_CLAIMED', drawingScale: 'NOT_CLAIMED', siteConditions: 'NOT_CLAIMED', ownershipOrLicence: 'NOT_CLAIMED' } } };
    return (await db.pool.query<{ id: string }>(`insert into public.project_references(project_id,uploaded_by,status,purpose,media_type,original_sha256,original_bytes,
      stored_sha256,stored_bytes,storage_locator,inspector_version,provenance_json) values ($1,$2,'ACTIVE','OTHER','image/png',$3,10,$3,10,'postgres-bytea','reference-inspector-v1',$4)
      returning id`, [projectId, owner, h, provenance])).rows[0]!.id;
  };
  const remove = (projectId: string) => db.pool.query('delete from public.projects where id = $1', [projectId]);

  it('deletes a project that holds no retained history', async () => {
    const id = await newProject('empty');
    await remove(id);
    expect((await db.pool.query('select 1 from public.projects where id = $1', [id])).rowCount).toBe(0);
  });

  it('refuses to cascade-delete a project holding a reference, a tombstoned reference, a durable job or a brief', async () => {
    const withReference = await newProject('reference');
    await insertReference(withReference);
    await expect(remove(withReference)).rejects.toMatchObject({ code: '23514', message: 'References are retained as tombstones' });
    const withTombstone = await newProject('tombstone');
    await db.pool.query(`update public.project_references set status = 'DELETED' where id = $1`, [await insertReference(withTombstone)]);
    await expect(remove(withTombstone)).rejects.toMatchObject({ code: '23514', message: 'References are retained as tombstones' });
    const withJob = await newProject('job');
    await db.pool.query(`insert into public.project_jobs(project_id,owner_id,kind,status,job_version,request_json,input_hash,progress_json)
      values ($1,$2,'SCENE_COMPILE','QUEUED','durable-job-v1','{"kind":"SCENE_COMPILE"}',$3,'{"percent":0}')`, [withJob, owner, sha('job')]);
    await expect(remove(withJob)).rejects.toMatchObject({ code: '23514', message: 'Jobs are retained' });
    const withBrief = await newProject('brief');
    await db.pool.query(`insert into public.project_briefs(project_id,version,brief_json,brief_hash,created_by) values ($1,1,'{}',$2,$3)`, [withBrief, sha('brief'), owner]);
    await expect(remove(withBrief)).rejects.toMatchObject({ code: '23514', message: 'Architectural history is immutable' });
    expect((await db.pool.query('select count(*)::int as count from public.projects where id = any($1)', [[withReference, withTombstone, withJob, withBrief]])).rows[0].count).toBe(4);
  });

  it('keeps a deleted account\'s project and its retained history, with ownership removed', async () => {
    const id = await newProject('orphaned');
    await insertReference(id);
    await db.pool.query('delete from auth.users where id = $1', [owner]);
    const row = (await db.pool.query('select owner_id from public.projects where id = $1', [id])).rows[0];
    expect(row).toEqual({ owner_id: null });
    expect((await db.pool.query('select count(*)::int as count from public.project_references where project_id = $1', [id])).rows[0].count).toBe(1);
  });
});
