import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDatabase, asPrincipal, createTestUser } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { projectAcceptance } from '../../../test-support/project-acceptance.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { signProjectCommit, projectQaOptions } from '../src/services/project-service.js';

describe('native V2 projects on actual PostgreSQL transactions and RLS', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>;
  let app: ReturnType<typeof buildApp>;
  let ownerId: string; let otherId: string; let secret: string;
  const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
  beforeAll(async () => {
    db = await startTestDatabase(); ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test',
      LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret }), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });
  projectAcceptance(() => ({ app, owner, other }));

  async function create() {
    const response = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'DB test' } });
    expect(response.statusCode, response.body).toBe(201); return response.json().id as string;
  }
  async function commitInput(projectId: string) {
    const model = authored();
    return { projectId, model, report: auditBlueprint(model, projectQaOptions(model)), sourceMode: 'supplied', generatorVersion: null, baseRevisionId: null };
  }
  async function rpc(user: string, input: unknown, signature?: ReturnType<typeof signProjectCommit>, context: unknown = null) {
    return asPrincipal(db.pool, user, client => client.query('select public.project_write($1,$2,$3,$4,$5) response',
      ['revision', JSON.stringify(input), context ? JSON.stringify(context) : null, signature?.envelope ?? null, signature?.signature ?? null]));
  }
  it('blocks direct table mutation, forged RPC QA, foreign projects and private reads', async () => {
    const id = await create(); const input = await commitInput(id);
    await expect(rpc(ownerId, input)).rejects.toMatchObject({ code: '42501' });
    const signature = signProjectCommit(secret, ownerId, '/api/projects/:projectId/revisions', input);
    await expect(rpc(otherId, input, signature)).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(ownerId, { ...input, projectId: randomUUID() }, signature)).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(ownerId, input, { ...signature, signature: '0'.repeat(64) })).rejects.toMatchObject({ code: '42501' });
    await rpc(ownerId, input, signature);
    for (const table of ['projects', 'project_revisions', 'project_revision_qa_runs']) {
      const otherRows = await asPrincipal(db.pool, otherId, c => c.query(`select * from public.${table}`));
      // The shared acceptance suite creates an other-owned project; only this project's data must be hidden.
      expect(JSON.stringify(otherRows.rows)).not.toContain(id);
      await expect(asPrincipal(db.pool, ownerId, c => c.query(`delete from public.${table}`))).rejects.toMatchObject({ code: '42501' });
    }
    for (const sql of ["update public.projects set current_revision_id = null", "update public.project_revisions set model_json = '{}'", "update public.project_revision_qa_runs set status = 'FAIL'", 'select * from public.project_audit_events', 'select * from project_private.commit_key']) {
      await expect(asPrincipal(db.pool, ownerId, c => c.query(sql))).rejects.toMatchObject({ code: '42501' });
    }
    await expect(asPrincipal(db.pool, ownerId, c => c.query(`insert into public.idempotency_records(user_id,operation,key_hash,fingerprint,response) values($1,'/api/projects',$2,$2,'{}')`, [ownerId, 'a'.repeat(64)]))).rejects.toMatchObject({ code: '42501' });
  });

  it('rolls back revision, QA, pointer, audit and receipt on failures at each transactional stage', async () => {
    const id = await create();
    for (const [table, timing] of [['project_revision_qa_runs', 'before insert'], ['projects', 'before update'], ['project_audit_events', 'before insert'], ['idempotency_records', 'before insert']]) {
      await db.pool.query(`create function project_private.test_failure() returns trigger language plpgsql as $$ begin raise exception 'injected database failure'; end $$;
        create trigger test_failure ${timing} on public.${table} for each row execute function project_private.test_failure()`);
      try {
        const response = await app.inject({ method: 'POST', url: `/api/projects/${id}/revisions`, headers: { ...owner, 'idempotency-key': randomUUID() }, payload: { model: authored() } });
        expect(response.statusCode).toBe(500); expect(response.body).not.toContain('injected');
      } finally { await db.pool.query(`drop trigger test_failure on public.${table}; drop function project_private.test_failure()`); }
      const state = (await db.pool.query(`select current_revision_id,revision_count,
        (select count(*) from public.project_revisions where project_id=$1)::int revisions,
        (select count(*) from public.project_audit_events where project_id=$1)::int events,
        (select count(*) from public.idempotency_records where response->'project'->>'id'=$1::text)::int receipts
        from public.projects where id=$1`, [id])).rows[0];
      expect(state).toEqual({ current_revision_id: null, revision_count: 0, revisions: 0, events: 1, receipts: 0 });
      expect((await db.pool.query('select q.id from public.project_revision_qa_runs q left join public.project_revisions r on r.id=q.revision_id where r.id is null')).rows).toEqual([]);
    }
  });

  it('rejects FAIL at the database gate and enforces immutable history even for privileged updates', async () => {
    const id = await create(); const input = await commitInput(id);
    const bad = { ...input, report: { ...input.report, status: 'FAIL' } };
    await expect(rpc(ownerId, bad, signProjectCommit(secret, ownerId, '/api/projects/:projectId/revisions', bad))).rejects.toMatchObject({ code: 'P1204' });
    expect((await db.pool.query('select id from public.project_revisions where project_id=$1', [id])).rows).toEqual([]);
    const result = await rpc(ownerId, input, signProjectCommit(secret, ownerId, '/api/projects/:projectId/revisions', input));
    const revision = result.rows[0].response.revision;
    await expect(db.pool.query("update public.project_revisions set model_json='{}' where id=$1", [revision.id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query("update public.project_revision_qa_runs set status='FAIL' where revision_id=$1", [revision.id])).rejects.toMatchObject({ code: '23514' });
  });

  it('replays inside the locked RPC before stale/archive checks and rejects changed fingerprints', async () => {
    const id = await create(); const input = await commitInput(id);
    const context = { operation: '/api/projects/:projectId/revisions', keyHash: 'b'.repeat(64), fingerprint: 'c'.repeat(64) };
    const signature = signProjectCommit(secret, ownerId, context.operation, input, context);
    const result = await rpc(ownerId, input, signature, context);
    await app.inject({ method: 'PATCH', url: `/api/projects/${id}`, headers: owner, payload: { status: 'ARCHIVED' } });
    expect((await rpc(ownerId, input, signature, context)).rows).toEqual(result.rows);
    const changed = { ...context, fingerprint: 'd'.repeat(64) };
    await expect(rpc(ownerId, input, signProjectCommit(secret, ownerId, context.operation, input, changed), changed)).rejects.toMatchObject({ code: 'P8001' });
  });

  it('enforces same-project parent/current FKs, QA anchors and safe account deletion', async () => {
    const id = await create(); const input = await commitInput(id);
    const result = await rpc(ownerId, input, signProjectCommit(secret, ownerId, '/api/projects/:projectId/revisions', input));
    const revision = result.rows[0].response.revision;
    const otherProject = await create();
    await expect(db.pool.query('update public.projects set current_revision_id=$1,revision_count=1 where id=$2', [revision.id, otherProject])).rejects.toThrow();
    const doomed = await createTestUser(db.pool);
    await asPrincipal(db.pool, doomed, c => c.query(`select public.project_write('create','{"title":"Account deletion"}')`));
    await db.pool.query('delete from auth.users where id=$1', [doomed]);
    expect((await db.pool.query("select owner_id from public.projects where title='Account deletion'")).rows).toEqual([{ owner_id: null }]);
  });

  it('appends a versioned re-audit without rewriting acceptance evidence or model', async () => {
    const id = await create(); const input = await commitInput(id);
    const result = await rpc(ownerId, input, signProjectCommit(secret, ownerId, '/api/projects/:projectId/revisions', input));
    const revision = result.rows[0].response.revision;
    const newer = { ...input.report, qaVersion: 'blueprint-qa-future', status: 'FAIL' };
    await db.pool.query(`insert into public.project_revision_qa_runs(revision_id,qa_version,model_schema_version,rule_packs,status,report_json)
      values($1,$2,2,$3,'FAIL',$4)`, [revision.id, newer.qaVersion, JSON.stringify(newer.rulePacks), JSON.stringify(newer)]);
    const stored = (await db.pool.query('select model_json,acceptance_qa_id from public.project_revisions where id=$1', [revision.id])).rows[0];
    expect(stored).toEqual({ model_json: input.model, acceptance_qa_id: revision.qa.id });
    expect((await asPrincipal(db.pool, ownerId, c => c.query('select id from public.project_revision_qa_runs where revision_id=$1', [revision.id]))).rows).toHaveLength(2);
  });

  it('retains body limits and fails closed when signing is unconfigured', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'x'.repeat(70_000) } });
    expect(response.statusCode).toBe(400);
    const id = await create();
    const large = await app.inject({ method: 'POST', url: `/api/projects/${id}/revisions`, headers: owner, payload: { model: { name: 'x'.repeat(1_048_576) } } });
    expect(large.statusCode).toBe(400);
    const unconfigured = buildApp({ env: parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false' }), backend: createPgBackend(db.pool, { owner: ownerId }) });
    try {
      expect((await unconfigured.inject({ method: 'POST', url: `/api/projects/${id}/revisions`, headers: owner, payload: { model: authored() } })).statusCode).toBe(503);
    } finally { await unconfigured.close(); }
  });
});
