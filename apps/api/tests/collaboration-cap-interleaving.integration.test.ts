import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { COLLABORATION_ROUTES } from '../src/collaboration/contracts.js';
import { signProjectCommit } from '../src/services/project-service.js';

const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret });

// SEC-004 / TEST-004: each B44 cap is a count followed by an insert inside collaboration_write. The concurrent-request test in
// collaboration.integration.test.ts catches a missing lock only probabilistically (about 1 run in 2 for reviews). Here the interleaving is fixed:
// transaction A writes at cap - 1 and stays open; B writes; A commits only once B has finished or waits on a lock. With the per-project advisory
// lock B waits and is refused; without it B always sees room and inserts, on every run.
describe('B44 caps under a fixed two-transaction interleaving (signed collaboration_write)', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, secret: string;
  const users: Record<string, string> = {};
  beforeAll(async () => {
    db = await startTestDatabase();
    for (const name of ['owner', 'm1', 'm2']) users[name] = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, users), captureError: () => undefined });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.stop(); });

  const setup = async () => {
    const auth = { authorization: 'Bearer owner' };
    const projectId = (await app.inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { title: 'caps' } })).json().id as string;
    const revision = (await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions`, headers: auth, payload: { model: authored() } })).json().revision;
    return { projectId, revisionId: revision.id as string };
  };
  /** One signed collaboration_write as the owner, inside an open transaction under the authenticated role. */
  const write = (route: string, action: string, input: Record<string, unknown>) => async (c: PoolClient) => {
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)",
      [JSON.stringify({ sub: users.owner, role: 'authenticated' }), users.owner]);
    const { envelope, signature } = signProjectCommit(secret, users.owner!, route, input);
    await c.query('select public.collaboration_write($1, $2, $3, $4, null)', [action, JSON.stringify(input), envelope, signature]);
  };
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
  const count = async (sql: string, id: string) => Number((await db.pool.query(sql, [id])).rows[0].n);

  it('comments: 200 per revision', async () => {
    const { projectId, revisionId } = await setup();
    await db.pool.query(`insert into public.project_revision_comments(project_id, revision_id, author_id, author_role, kind, body)
      select $1, $2, $3, 'owner', 'COMMENT', 'bulk ' || g from generate_series(1, 199) g`, [projectId, revisionId, users.owner]);
    const comment = (body: string) => write(COLLABORATION_ROUTES.comments, 'comment', { projectId, revisionId, kind: 'COMMENT', body, elementIds: [], parentId: null });
    expect(await race(comment('a'), comment('b'))).toBe('P4405');
    expect(await count('select count(*) as n from public.project_revision_comments where revision_id = $1', revisionId)).toBe(200);
  });

  it('members: 20 active per project', async () => {
    const { projectId } = await setup();
    await db.pool.query(`insert into public.project_members(project_id, user_id, role, added_by)
      select $1, gen_random_uuid(), 'viewer', $2 from generate_series(1, 19)`, [projectId, users.owner]);
    const member = (userId: string) => write(COLLABORATION_ROUTES.members, 'member_upsert', { projectId, userId, role: 'viewer' });
    expect(await race(member(users.m1!), member(users.m2!))).toBe('P4405');
    expect(await count('select count(*) as n from public.project_members where project_id = $1 and removed_at is null', projectId)).toBe(20);
  });

  it('reviews: 100 per revision', async () => {
    const { projectId, revisionId } = await setup();
    const modelHash = 'a'.repeat(64);
    await db.pool.query(`insert into public.project_revision_reviews(project_id, revision_id, reviewer_id, reviewer_role, decision, model_hash)
      select $1, $2, $3, 'owner', 'APPROVED', $4 from generate_series(1, 99)`, [projectId, revisionId, users.owner, modelHash]);
    const review = () => write(COLLABORATION_ROUTES.reviews, 'review', { projectId, revisionId, decision: 'APPROVED', note: '', modelHash });
    expect(await race(review(), review())).toBe('P4405');
    expect(await count('select count(*) as n from public.project_revision_reviews where revision_id = $1', revisionId)).toBe(100);
  });
});
