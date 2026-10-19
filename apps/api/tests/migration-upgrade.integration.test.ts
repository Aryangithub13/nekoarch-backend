import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { COLLABORATION_ROUTES } from '../src/collaboration/contracts.js';
import { EXPECTED_SCHEMA_VERSION } from '../src/lib/deployment-state.js';
import { modelHash } from '../src/lib/generation-identity.js';
import { signProjectCommit } from '../src/services/project-service.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');
const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret });
const FIRST_NEW = 31;

// Audit B T5 / P2-5: every other suite applies all migrations to an empty database. A shared database already holds rows written under 0030,
// so 0031-0033 are applied here, one transaction each as `supabase db push` does, on top of B44 rows written by the 0030 four-argument
// collaboration_write and an idempotency receipt for every operation the 0030 constraint allows. 0033 re-creates that constraint, which
// validates every existing row.
describe(`upgrading a populated 00${FIRST_NEW - 1} database to ${EXPECTED_SCHEMA_VERSION}`, () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, secret: string, projectId: string, revision: Json, before: Json;
  const users: Record<string, string> = {};
  const apps: ReturnType<typeof buildApp>[] = [];
  const snapshot = async () => {
    const rows = async (sql: string) => (await db.pool.query(sql)).rows.map(r => r.row);
    return {
      projects: await rows('select to_jsonb(t) as row from public.projects t order by id'),
      revisions: await rows('select to_jsonb(t) as row from public.project_revisions t order by id'),
      members: await rows('select to_jsonb(t) as row from public.project_members t order by project_id, user_id'),
      comments: await rows('select to_jsonb(t) as row from public.project_revision_comments t order by id'),
      reviews: await rows('select to_jsonb(t) as row from public.project_revision_reviews t order by id'),
      receipts: await rows('select to_jsonb(t) as row from public.idempotency_records t order by user_id, operation, key_hash'),
    };
  };
  const legacyWrite = async (route: string, action: string, input: Json) => {
    const c = await db.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)",
        [JSON.stringify({ sub: users.owner, role: 'authenticated' }), users.owner]);
      const { envelope, signature } = signProjectCommit(secret, users.owner!, route, input);
      const result = (await c.query('select public.collaboration_write($1, $2, $3, $4) as r', [action, JSON.stringify(input), envelope, signature])).rows[0].r;
      await c.query('commit');
      return result as Json;
    } catch (error) { await c.query('rollback'); throw error; } finally { c.release(); }
  };

  beforeAll(async () => {
    db = await startTestDatabase({ migrations: name => Number(name.slice(0, 4)) < FIRST_NEW });
    for (const name of ['owner', 'reviewer']) users[name] = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    expect((await db.pool.query("select to_regprocedure('public.schema_version()') as f")).rows[0].f).toBeNull();

    // Projects and revisions through the API, which needs nothing newer than 0030 for them.
    const app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, users), captureError: () => undefined });
    apps.push(app);
    await app.ready();
    const auth = { authorization: 'Bearer owner' };
    projectId = (await app.inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { title: 'upgrade' } })).json().id;
    revision = (await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions`, headers: auth, payload: { model: authored() } })).json().revision;
    expect(revision?.id).toBeTypeOf('string');

    // B44 rows as the 0030 function wrote them.
    await legacyWrite(COLLABORATION_ROUTES.members, 'member_upsert', { projectId, userId: users.reviewer, role: 'reviewer' });
    const top = await legacyWrite(COLLABORATION_ROUTES.comments, 'comment',
      { projectId, revisionId: revision.id, kind: 'COMMENT', body: 'before the upgrade', elementIds: [], parentId: null });
    await legacyWrite(COLLABORATION_ROUTES.comments, 'comment',
      { projectId, revisionId: revision.id, kind: 'COMMENT', body: 'a reply', elementIds: [], parentId: top.id });
    await legacyWrite(COLLABORATION_ROUTES.reviews, 'review',
      { projectId, revisionId: revision.id, decision: 'APPROVED', note: 'ok', modelHash: modelHash(revision.model) });

    // A live receipt for every operation the 0030 constraint allows.
    const definition = (await db.pool.query("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'idempotency_records_operation_check'")).rows[0].d as string;
    const operations = [...definition.matchAll(/'([^']+)'::text/g)].map(m => m[1]!);
    expect(operations.length).toBeGreaterThan(20);
    await db.pool.query(`insert into public.idempotency_records(user_id, operation, key_hash, fingerprint, response)
      select $1, op, encode(sha256(convert_to(op, 'UTF8')), 'hex'), repeat('b', 64), jsonb_build_object('operation', op) from unnest($2::text[]) op`,
    [users.owner, operations]);
    await app.close();
    apps.pop();

    before = await snapshot();
    const pending = (await readdir(migrationsDir)).filter(name => name.endsWith('.sql') && Number(name.slice(0, 4)) >= FIRST_NEW).sort();
    expect(pending.map(name => Number(name.slice(0, 4)))).toEqual(Array.from({ length: EXPECTED_SCHEMA_VERSION - FIRST_NEW + 1 }, (_, i) => FIRST_NEW + i));
    for (const name of pending) await db.pool.query(`begin;\n${await readFile(path.join(migrationsDir, name), 'utf8')}\ncommit;`);
  }, 180_000);
  afterAll(async () => { for (const app of apps) await app.close(); await db?.stop(); });

  it('keeps every existing row unchanged and reports the new schema version', async () => {
    expect(before.members).toHaveLength(1);
    expect(before.comments).toHaveLength(2);
    expect(before.reviews).toHaveLength(1);
    expect(await snapshot()).toEqual(before);
    expect((await db.pool.query('select public.schema_version() as v')).rows[0].v).toBe(EXPECTED_SCHEMA_VERSION);
  });

  it('leaves exactly one collaboration_write, executable by authenticated only', async () => {
    const overloads = (await db.pool.query(`select p.oid::regprocedure::text as sig,
        has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon
      from pg_proc p where p.proname = 'collaboration_write' and p.pronamespace = 'public'::regnamespace`)).rows;
    expect(overloads).toEqual([{ sig: 'collaboration_write(text,jsonb,text,text,jsonb)', auth: true, anon: false }]);
  });

  it('serves the pre-upgrade rows and the 0033 retry behaviour through the API', async () => {
    const app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, users), captureError: () => undefined });
    apps.push(app);
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
    const call = (user: string, method: 'GET' | 'POST', url: string, payload?: Json, key?: string) =>
      app.inject({ method, url, headers: { authorization: `Bearer ${user}`, ...(key ? { 'idempotency-key': key } : {}) }, ...(payload ? { payload } : {}) });
    const root = `/api/projects/${projectId}/collaboration`;

    const workspace = await call('owner', 'GET', root);
    expect(workspace.statusCode, workspace.body).toBe(200);
    expect(workspace.json().members.map((m: Json) => m.userId)).toContain(users.reviewer);
    const detail = (await call('reviewer', 'GET', `${root}/revisions/${revision.id}`)).json();
    expect(detail.comments.map((c: Json) => c.body).sort()).toEqual(['a reply', 'before the upgrade']);
    expect(detail.reviews).toHaveLength(1);

    const url = `${root}/revisions/${revision.id}/comments`, body = { kind: 'COMMENT', body: 'after the upgrade', elementIds: [] };
    const first = await call('reviewer', 'POST', url, body, 'upgrade-retry-1');
    const retry = await call('reviewer', 'POST', url, body, 'upgrade-retry-1');
    expect(first.statusCode, first.body).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json().id).toBe(first.json().id);
    expect(Number((await db.pool.query('select count(*) as n from public.project_revision_comments where revision_id = $1', [revision.id])).rows[0].n)).toBe(3);
  });
});
