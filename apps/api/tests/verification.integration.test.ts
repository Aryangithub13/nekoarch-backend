import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { modelHash } from '../src/lib/generation-identity.js';

const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret });
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };

describe('Phase 34 verification over HTTP on stored revisions', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    db = await startTestDatabase();
    const ownerId = await createTestUser(db.pool), otherId = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });

  async function project(title: string) {
    const id = (await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title } })).json().id as string;
    const generate = (requirements: unknown, baseRevisionId: string | null) => app.inject({ method: 'POST', url: `/api/projects/${id}/revisions/generate`, headers: owner,
      payload: { requirements, baseRevisionId } });
    const a = (await generate(parametricInput(true), null)).json().revision;
    const b = (await generate(parametricInput(), a.id)).json().revision;
    return { id, a, b, root: (revisionId: string) => `/api/projects/${id}/revisions/${revisionId}/verification` };
  }

  it('verifies a stored revision, bound to its model hash, deterministically', async () => {
    const { a, root } = await project('Verify');
    const first = await app.inject({ url: root(a.id), headers: owner });
    expect(first.statusCode, first.body.slice(0, 300)).toBe(200);
    expect(first.json()).toMatchObject({ status: 'VERIFIED', revisionId: a.id, modelHash: modelHash(a.model), bases: { coverageRatio: { decimal: expect.stringMatching(/^0\.\d{4}$/) } } });
    expect((await app.inject({ url: root(a.id), headers: owner })).json().inputHash).toBe(first.json().inputHash);
    const limited = await app.inject({ method: 'POST', url: root(a.id), headers: owner, payload: { declaredLimits: { maxCoverageRatio: 0.1, maxFar: 5 } } });
    expect(limited.json().checks.filter((c: { checkId: string }) => c.checkId === 'DECLARED_LIMIT').map((c: { status: string }) => c.status)).toEqual(['FAIL', 'PASS']);
    expect(limited.json().status).toBe('FAILED');
    expect((await app.inject({ method: 'POST', url: root(a.id), headers: owner, payload: { declaredLimits: { maxFar: 0.12345 } } })).statusCode).toBe(400);
  });

  it('diffs two stored revisions against a declared scope', async () => {
    const { a, b, root } = await project('Diff');
    const diff = (scope: unknown, base = a.id, otherId = b.id) => app.inject({ method: 'POST', url: `${root(base)}/diff`, headers: owner, payload: { otherRevisionId: otherId, scope } });
    const all = (await diff({ levelIds: ['level-0', 'level-1'], allowSiteChange: true })).json();
    expect(all.status).toBe('WITHIN_SCOPE'); // a two-storey to one-storey change touches only those two levels and the site
    expect(all.counts.removed).toBeGreaterThan(0);
    const narrow = (await diff({ levelIds: ['level-0'] })).json();
    expect(narrow.status).toBe('OUT_OF_SCOPE_CHANGES');
    expect(narrow.violations.some((v: { levelIds: string[] }) => v.levelIds.includes('level-1'))).toBe(true);
    expect((await diff({}, a.id, a.id)).json().status).toBe('IDENTICAL');
  });

  it('is owner-only and refuses revisions of another project', async () => {
    const one = await project('Owner A'), two = await project('Owner B');
    expect((await app.inject({ url: one.root(one.a.id), headers: other })).statusCode).toBe(404);
    expect((await app.inject({ url: one.root(one.a.id) })).statusCode).toBe(401);
    const foreign = await app.inject({ method: 'POST', url: `${one.root(one.a.id)}/diff`, headers: owner, payload: { otherRevisionId: two.a.id, scope: {} } });
    expect(foreign.statusCode).toBe(404);
  });
});
