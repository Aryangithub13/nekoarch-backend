import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
// @ts-expect-error untyped operator script (plain .mjs)
import { checkTarget, runWorkflow } from '../../../scripts/staging-workflow-b39.mjs';

const ok = { STAGING_CONFIRM: 'disposable-staging', STAGING_API_URL: 'https://staging.example.test', STAGING_OWNER_TOKEN: 'a', STAGING_OTHER_TOKEN: 'b' };

describe('D-10 staging workflow W-B39 (prepared; rehearsed here against a local app, never against staging)', () => {
  it('uses the B37 target check: only an explicitly confirmed HTTPS origin with two different users', () => {
    expect(checkTarget(ok)).toBe('https://staging.example.test');
    for (const patch of [{ STAGING_CONFIRM: 'yes' }, { STAGING_API_URL: 'http://staging.example.test' }, { STAGING_OTHER_TOKEN: 'a' }])
      expect(() => checkTarget({ ...ok, ...patch }), JSON.stringify(patch)).toThrow();
  });

  describe('local rehearsal on PostgreSQL (every migration, including 0029)', () => {
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

    it('runs all six specialists end to end, records redacted evidence, and archives (never deletes) its project', async () => {
      const evidence = await runWorkflow({ baseUrl, ownerToken: 'owner', otherToken: 'other' });
      expect(evidence.failedAt, JSON.stringify(evidence.steps.at(-1))).toBeNull();
      expect(evidence.ok).toBe(true);
      expect(evidence.checks.every((c: { pass: boolean }) => c.pass)).toBe(true);
      expect(evidence.checks.length).toBeGreaterThanOrEqual(18);
      // One supported request per module (gate L297), each recorded with its typed status.
      const modules = new Set(Object.values(evidence.specialists as Record<string, { module: string; written: boolean }>).filter(s => s.written).map(s => s.module));
      expect([...modules].sort()).toEqual(['BLUEPRINT', 'BUDGET', 'EXTERIOR', 'INTERIOR', 'MATERIALS', 'STRUCTURAL']);
      expect(evidence.steps.at(-1)).toMatchObject({ step: 'archive the test project', method: 'PATCH', status: 200 });
      const text = JSON.stringify(evidence);
      for (const leak of [baseUrl, '127.0.0.1', 'Bearer', 'owner"', 'secret']) expect(text, leak).not.toContain(leak);
      const project = (await db.pool.query('select status from public.projects where id = $1', [evidence.ids.projectId])).rows[0];
      expect(project.status).toBe('ARCHIVED');
      // Revisions A → B (Interior) → C (Exterior) → D (Blueprint), each the parent of the next, all kept.
      const revs = (await db.pool.query('select id, parent_revision_id from public.project_revisions where project_id = $1 order by revision_number', [evidence.ids.projectId])).rows;
      expect(revs.map(r => r.id)).toEqual([evidence.ids.revisionA, evidence.ids.revisionB, evidence.ids.revisionC, evidence.ids.revisionD]);
      expect(revs.slice(1).map(r => r.parent_revision_id)).toEqual(revs.slice(0, -1).map(r => r.id));
    }, 300_000);

    it('stops at the first unexpected response and reports where', async () => {
      const evidence = await runWorkflow({ baseUrl, ownerToken: 'nobody', otherToken: 'other' });
      expect([evidence.ok, evidence.failedAt]).toEqual([false, 'create project']);
      expect(evidence.steps.map((s: { step: string; status: number }) => [s.step, s.status])).toEqual([['health ready', 200], ['capabilities', 200], ['create project', 401]]);
    }, 60_000);
  });
});
