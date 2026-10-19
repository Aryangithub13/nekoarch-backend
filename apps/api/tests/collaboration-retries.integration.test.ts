import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { modelHash } from '../src/lib/generation-identity.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false',
  PROJECT_COMMIT_SECRET: secret });

// Audit B INT-B-014 (a retried comment or review was stored twice, and counted against the cap) and INT-B-013 (a capped list gave no sign of truncation).
describe('B44 retries and truncation on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>;
  const users: Record<string, string> = {};
  beforeAll(async () => {
    db = await startTestDatabase();
    for (const name of ['owner', 'reviewer']) users[name] = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, users), captureError: () => undefined });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.stop(); });

  const call = (user: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, key?: string) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${user}`, ...(key ? { 'idempotency-key': key } : {}) }, ...(payload === undefined ? {} : { payload: payload as Json }) });
  const ok = async (user: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, status = method === 'POST' ? 201 : 200) => {
    const r = await call(user, method, url, payload);
    expect(r.statusCode, `${method} ${url}: ${r.body.slice(0, 300)}`).toBe(status);
    return r.json() as Json;
  };
  const count = async (table: string, projectId: string) => Number((await db.pool.query(`select count(*) from public.${table} where project_id = $1`, [projectId])).rows[0].count);
  const setup = async () => {
    const projectId = (await ok('owner', 'POST', '/api/projects', { title: 'B44 retries' })).id as string;
    const revision = (await ok('owner', 'POST', `/api/projects/${projectId}/revisions`, { model: authored() })).revision as Json;
    await ok('owner', 'POST', `/api/projects/${projectId}/collaboration/members`, { userId: users.reviewer, role: 'reviewer' });
    return { projectId, revision, root: `/api/projects/${projectId}/collaboration` };
  };

  it('stores a retried comment once and replays its response; a reused key with another body is a conflict', async () => {
    const { projectId, revision, root } = await setup();
    const url = `${root}/revisions/${revision.id}/comments`;
    const first = await call('reviewer', 'POST', url, { body: 'Check the stair' }, 'comment-retry-1');
    const retry = await call('reviewer', 'POST', url, { body: 'Check the stair' }, 'comment-retry-1');
    expect([first.statusCode, retry.statusCode]).toEqual([201, 201]);
    expect(retry.json()).toEqual(first.json());
    expect(await count('project_revision_comments', projectId)).toBe(1);
    const conflict = await call('reviewer', 'POST', url, { body: 'Something else' }, 'comment-retry-1');
    expect([conflict.statusCode, conflict.json().error.code]).toEqual([409, 'IDEMPOTENCY_CONFLICT']);
    // Without a key, two posts are two comments, as before.
    for (let i = 0; i < 2; i++) expect((await call('reviewer', 'POST', url, { body: 'No key' })).statusCode).toBe(201);
    expect(await count('project_revision_comments', projectId)).toBe(3);
  });

  it('stores one comment when concurrent retries share a key', async () => {
    const { projectId, revision, root } = await setup();
    const url = `${root}/revisions/${revision.id}/comments`;
    const responses = await Promise.all(Array.from({ length: 12 }, () => call('reviewer', 'POST', url, { body: 'Burst' }, 'comment-burst')));
    expect(responses.map(r => r.statusCode)).toEqual(Array(12).fill(201));
    expect(new Set(responses.map(r => r.json().id)).size).toBe(1);
    expect(await count('project_revision_comments', projectId)).toBe(1);
  });

  it('stores a retried review once', async () => {
    const { projectId, revision, root } = await setup();
    const url = `${root}/revisions/${revision.id}/reviews`, body = { decision: 'APPROVED', expectedModelHash: modelHash(revision.model) };
    const [first, retry] = [await call('reviewer', 'POST', url, body, 'review-retry'), await call('reviewer', 'POST', url, body, 'review-retry')];
    expect([first.statusCode, retry.statusCode, retry.json().id]).toEqual([201, 201, first.json().id]);
    expect(await count('project_revision_reviews', projectId)).toBe(1);
  });

  it('replays a retried member removal with its key; without one, a second removal is still 404', async () => {
    const { root } = await setup();
    const url = `${root}/members/${users.reviewer}`;
    const first = await call('owner', 'DELETE', url, undefined, 'remove-retry');
    const retry = await call('owner', 'DELETE', url, undefined, 'remove-retry');
    expect([first.statusCode, retry.statusCode, retry.json()]).toEqual([200, 200, { userId: users.reviewer, removed: true }]);
    const unkeyed = await call('owner', 'DELETE', url);
    expect([unkeyed.statusCode, unkeyed.json().error.code]).toEqual([404, 'MEMBER_NOT_FOUND']);
  });

  it('says when the workspace revision list is truncated', async () => {
    const { projectId, revision, root } = await setup();
    expect(await ok('owner', 'GET', root)).toMatchObject({ revisionsTruncated: false });
    let base = revision.id as string;
    for (let i = 0; i < 100; i++) base = ((await ok('owner', 'POST', `/api/projects/${projectId}/revisions`, { model: authored(), baseRevisionId: base })).revision as Json).id;
    const workspace = await ok('reviewer', 'GET', root);
    expect([workspace.revisions.length, workspace.revisionsTruncated, workspace.revisions[0].id]).toEqual([100, true, base]);
  }, 180_000);
});
