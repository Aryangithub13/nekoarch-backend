import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
// @ts-expect-error untyped operator script (plain .mjs)
import { checkTarget, runWorkflow } from '../../../scripts/staging-workflow-b37.mjs';

const ok = { STAGING_CONFIRM: 'disposable-staging', STAGING_API_URL: 'https://staging.example.test', STAGING_OWNER_TOKEN: 'a', STAGING_OTHER_TOKEN: 'b' };

describe('D-10 staging workflow W-B37 (prepared; rehearsed here against a local app, never against staging)', () => {
  it('refuses any target that is not an explicitly confirmed HTTPS origin', () => {
    expect(checkTarget(ok)).toBe('https://staging.example.test');
    expect(checkTarget({ ...ok, STAGING_API_URL: 'http://127.0.0.1:3001' })).toBe('http://127.0.0.1:3001');
    for (const [patch, message] of [
      [{ STAGING_CONFIRM: undefined }, /STAGING_CONFIRM/], [{ STAGING_CONFIRM: 'yes' }, /STAGING_CONFIRM/],
      [{ STAGING_API_URL: 'http://staging.example.test' }, /HTTPS/], [{ STAGING_API_URL: 'https://u:p@staging.example.test' }, /bare origin/],
      [{ STAGING_API_URL: 'https://staging.example.test/api' }, /bare origin/], [{ STAGING_OTHER_TOKEN: 'a' }, /different/], [{ STAGING_OWNER_TOKEN: '' }, /STAGING_OWNER_TOKEN/],
    ] as const) expect(() => checkTarget({ ...ok, ...patch }), JSON.stringify(patch)).toThrow(message);
  });

  describe('local rehearsal on PostgreSQL', () => {
    let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, baseUrl: string;
    beforeAll(async () => {
      db = await startTestDatabase();
      const owner = await createTestUser(db.pool), other = await createTestUser(db.pool);
      const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
      app = buildApp({ env: parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
        RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret }), backend: createPgBackend(db.pool, { owner, other }), captureError: () => undefined });
      baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
    }, 120_000);
    afterAll(async () => { await app?.close(); await db?.stop(); });

    it('runs every step and check, records redacted evidence, and archives (never deletes) its project', async () => {
      const evidence = await runWorkflow({ baseUrl, ownerToken: 'owner', otherToken: 'other' });
      expect(evidence.failedAt, JSON.stringify(evidence.steps.at(-1))).toBeNull();
      expect(evidence.ok).toBe(true);
      expect(evidence.checks.every((c: { pass: boolean }) => c.pass)).toBe(true);
      expect(evidence.checks.length).toBeGreaterThanOrEqual(15);
      expect(evidence.latencyMs).toMatchObject({ reads: 20 });
      expect(evidence.steps.at(-1)).toMatchObject({ step: 'archive the test project', method: 'PATCH', status: 200 });
      const text = JSON.stringify(evidence);
      for (const leak of [baseUrl, '127.0.0.1', 'Bearer', 'owner"', 'secret']) expect(text, leak).not.toContain(leak);
      const project = (await db.pool.query('select status from public.projects where id = $1', [evidence.ids.projectId])).rows[0];
      expect(project.status).toBe('ARCHIVED');
    }, 300_000);

    it('stops at the first unexpected response and reports where', async () => {
      const evidence = await runWorkflow({ baseUrl, ownerToken: 'nobody', otherToken: 'other' });
      // Health and discovery are public; the unknown user's first write is refused, and nothing after it runs.
      expect([evidence.ok, evidence.failedAt]).toEqual([false, 'create project']);
      expect(evidence.steps.map((s: { step: string; status: number }) => [s.step, s.status])).toEqual([['health ready', 200], ['capabilities', 200], ['create project', 401]]);
    }, 60_000);
  });
});
