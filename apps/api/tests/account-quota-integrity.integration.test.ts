import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { png } from '../../../test-support/reference-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';

const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret });
const GiB = 1_073_741_824;

// The B33 account quotas (0023) are owner-wide: 200 projects, 8 active jobs and 1 GiB of references per owner. Each is a count (or sum) followed by an
// insert. The RPCs lock at most the one project row they write to, so without an owner-wide lock two inserts for one owner both see room and both commit.
describe('B32/B33 job and account quotas: concurrent writes and job retries', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>;
  const users: Record<string, string> = {};
  beforeAll(async () => {
    db = await startTestDatabase();
    for (const name of ['projects', 'jobs', 'references', 'api', 'retry', 'retryOwner']) users[name] = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, users), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });

  /**
   * Transaction A inserts while the owner is one below the quota and stays open; B then inserts for the same owner. Only once B has either finished or is
   * waiting on a lock does A commit, so the interleaving is the same on every run. Returns B's outcome: 'inserted', or the SQLSTATE that refused it.
   */
  const race = async (insertA: (c: PoolClient) => Promise<unknown>, insertB: (c: PoolClient) => Promise<unknown>) => {
    const a = await db.pool.connect(), b = await db.pool.connect();
    try {
      await a.query('begin'); await b.query('begin');
      const bPid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid as number;
      await insertA(a);
      let settled = false;
      const second = insertB(b).then(() => 'inserted', (e: { code?: string }) => e.code ?? 'error').finally(() => { settled = true; });
      for (let waited = 0; !settled; waited += 10) {
        const wait = (await db.pool.query('select wait_event_type from pg_stat_activity where pid = $1', [bPid])).rows[0]?.wait_event_type;
        if (wait === 'Lock') break;
        if (waited > 10_000) throw new Error('B neither finished nor waited on a lock');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await a.query('commit');
      const outcome = await second;
      await b.query(outcome === 'inserted' ? 'commit' : 'rollback');
      return outcome;
    } finally { a.release(); b.release(); }
  };
  const count = async (sql: string, values: unknown[]) => Number((await db.pool.query(sql, values)).rows[0].n);
  const projectsOf = async (owner: string, n: number) => (await db.pool.query("insert into public.projects(owner_id,title) select $1, 'p ' || g from generate_series(1,$2::integer) g returning id",
    [owner, n])).rows.map(r => r.id as string);
  /** A job row in the given state. Queued jobs are not due for a day, so the in-process runner never starts them during the test. */
  const jobRow = async (projectId: string, owner: string, status: 'QUEUED' | 'FAILED') => (await db.pool.query(`insert into public.project_jobs(project_id,owner_id,kind,
    status,job_version,request_json,input_hash,progress_json,not_before,attempt,failure_json,finished_at) values ($1,$2,'SCENE_COMPILE',$3,'durable-job-v1',
    jsonb_build_object('kind','SCENE_COMPILE','revisionId',gen_random_uuid()),encode(extensions.gen_random_bytes(32),'hex'),'{"stage":"QUEUED","percent":0,"message":"q"}',
    clock_timestamp() + interval '1 day', case when $3 = 'FAILED' then 3 else 0 end,
    case when $3 = 'FAILED' then '{"code":"JOB_INTERRUPTED","message":"The job lost its worker before finishing","retryable":true,"attempt":3}'::jsonb end,
    case when $3 = 'FAILED' then clock_timestamp() end) returning id`, [projectId, owner, status])).rows[0].id as string;
  const retry = async (token: string, projectId: string, jobId: string) => {
    const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/jobs/${jobId}/retry`, headers: { authorization: `Bearer ${token}` }, payload: {} });
    return [res.statusCode, res.statusCode === 200 ? res.json().status : res.json().error.code];
  };
  const active = (column: 'project_id' | 'owner_id', id: string) =>
    count(`select count(*) as n from public.project_jobs where ${column} = $1 and status in ('QUEUED','RUNNING')`, [id]);

  it('projects: 200 per owner', async () => {
    const owner = users.projects!;
    await db.pool.query("insert into public.projects(owner_id,title) select $1, 'bulk ' || g from generate_series(1,199) g", [owner]);
    const create = (c: PoolClient) => c.query("insert into public.projects(owner_id,title) values ($1,'race')", [owner]);
    expect(await race(create, create)).toBe('P3304');
    expect(await count('select count(*) as n from public.projects where owner_id = $1', [owner])).toBe(200);
  });

  it('active jobs: 8 per owner, across the owner\'s projects', async () => {
    const owner = users.jobs!;
    const projects = (await db.pool.query("insert into public.projects(owner_id,title) select $1, 'jobs ' || g from generate_series(1,3) g returning id", [owner]))
      .rows.map(r => r.id as string);
    const job = (projectId: string) => (c: Pick<PoolClient, 'query'>) => c.query(`insert into public.project_jobs(project_id,owner_id,kind,status,job_version,request_json,
      input_hash,progress_json) values ($1,$2,'SCENE_COMPILE','QUEUED','durable-job-v1',jsonb_build_object('kind','SCENE_COMPILE','revisionId',gen_random_uuid()),
      encode(extensions.gen_random_bytes(32),'hex'),'{"stage":"QUEUED","percent":0,"message":"q"}')`, [projectId, owner]);
    for (let i = 0; i < 7; i++) await job(projects[i % 3]!)(db.pool);
    // Two different projects: each job RPC locks only its own project row, so that lock never serializes these two.
    expect(await race(job(projects[1]!), job(projects[2]!))).toBe('P3304');
    expect(await count("select count(*) as n from public.project_jobs where owner_id = $1 and status in ('QUEUED','RUNNING')", [owner])).toBe(8);
  });

  it('reference bytes: 1 GiB per owner, across the owner\'s projects', async () => {
    const owner = users.references!, headers = { authorization: 'Bearer references' };
    const projectIds: string[] = [];
    for (const title of ['refs a', 'refs b']) {
      const res = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { title } });
      expect(res.statusCode, res.body).toBe(201);
      projectIds.push(res.json().id as string);
    }
    const uploaded = await app.inject({ method: 'POST', url: `/api/projects/${projectIds[0]}/references?purpose=SITE_PHOTO`,
      headers: { ...headers, 'content-type': 'image/png' }, payload: png({ width: 16 }) });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    // Copies of the uploaded row (valid provenance) with a chosen size, in a chosen project.
    const copy = (projectId: string, bytes: number, n: number) => (c: Pick<PoolClient, 'query'>) => c.query(`insert into public.project_references(project_id,uploaded_by,
      status,purpose,media_type,original_sha256,original_bytes,stored_sha256,stored_bytes,storage_locator,inspector_version,provenance_json)
      select $2,uploaded_by,'ACTIVE',purpose,media_type,original_sha256,original_bytes,h,$3,storage_locator,inspector_version,
        jsonb_set(jsonb_set(provenance_json,'{stored,sha256}',to_jsonb(h)),'{stored,bytes}',to_jsonb($3::integer))
      from public.project_references, lateral (select md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text) as h, g from generate_series(1,$4::integer) g) x
      where id = $1`,
    [uploaded.json().id, projectId, bytes, n]);
    await copy(projectIds[0]!, 10_485_760, 102)(db.pool);
    const used = async () => count(`select coalesce(sum(r.stored_bytes),0) as n from public.project_references r join public.projects p on p.id = r.project_id
      where p.owner_id = $1 and r.status <> 'DELETED'`, [owner]);
    // Leave room for exactly one more 10-byte reference.
    await copy(projectIds[0]!, GiB - 15 - await used(), 1)(db.pool);
    expect(await race(copy(projectIds[0]!, 10, 1), copy(projectIds[1]!, 10, 1))).toBe('P3304');
    expect(await used()).toBe(GiB - 5);
  });

  it('projects through the API: concurrent creates never pass the quota', async () => {
    const owner = users.api!;
    await db.pool.query("insert into public.projects(owner_id,title) select $1, 'bulk ' || g from generate_series(1,195) g", [owner]);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      app.inject({ method: 'POST', url: '/api/projects', headers: { authorization: 'Bearer api' }, payload: { title: `concurrent ${i}` } })));
    const tally = results.reduce<Record<string, number>>((all, r) => {
      const key = r.statusCode === 201 ? '201' : `${r.statusCode} ${r.json().error.code}`;
      return { ...all, [key]: (all[key] ?? 0) + 1 };
    }, {});
    expect(tally).toEqual({ '201': 5, '429 ACCOUNT_QUOTA_EXCEEDED': 15 });
    expect(await count('select count(*) as n from public.projects where owner_id = $1', [owner])).toBe(200);
  }, 60_000);

  // A retry (FAILED -> QUEUED) is the only way back into an active state, and it is an UPDATE: the insert-only quota trigger never saw it, and job_write's
  // retry branch checks neither active-job limit.
  it('a retry never takes a project past 4 active jobs', async () => {
    const [projectId] = await projectsOf(users.retry!, 1);
    for (let i = 0; i < 4; i++) await jobRow(projectId!, users.retry!, 'QUEUED');
    const failed = await jobRow(projectId!, users.retry!, 'FAILED');
    expect(await retry('retry', projectId!, failed)).toEqual([429, 'JOB_LIMIT_EXCEEDED']);
    expect(await active('project_id', projectId!)).toBe(4);
  });

  it('a retry never takes an owner past 8 active jobs across projects', async () => {
    const owner = users.retryOwner!, projects = await projectsOf(owner, 3);
    for (const [i, n] of [3, 3, 2].entries()) for (let j = 0; j < n; j++) await jobRow(projects[i]!, owner, 'QUEUED');
    const failed = await jobRow(projects[2]!, owner, 'FAILED');
    // The project holds 2 active jobs, under its limit of 4; the owner holds 8.
    expect(await retry('retryOwner', projects[2]!, failed)).toEqual([429, 'ACCOUNT_QUOTA_EXCEEDED']);
    expect(await active('owner_id', owner)).toBe(8);
    // Below both limits a retry still works.
    await db.pool.query("update public.project_jobs set status='CANCELLED', finished_at=clock_timestamp() where project_id=$1 and status='QUEUED'", [projects[0]]);
    expect(await retry('retryOwner', projects[2]!, failed)).toEqual([200, 'QUEUED']);
  });
});
