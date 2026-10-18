import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { FeasibilityAssessmentSchema } from '../src/feasibility/contracts.js';

const owner = { authorization: 'Bearer owner' }, intruder = { authorization: 'Bearer intruder' };
const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false',
  PROJECT_COMMIT_SECRET: secret });

describe('B42 S1: feasibility assessments over HTTP', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    db = await startTestDatabase();
    const ownerId = await createTestUser(db.pool), intruderId = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, intruder: intruderId }), captureError: () => undefined });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.stop(); });

  it('assesses an ambition for the owner only, binds a base revision of the same project, and stores nothing', async () => {
    const projectId = (await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'B42' } })).json().id as string;
    const other = (await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'B42 other' } })).json().id as string;
    const revision = (await app.inject({ method: 'POST', url: `/api/projects/${other}/revisions`, headers: owner, payload: { model: authored() } })).json().revision.id as string;
    const url = `/api/projects/${projectId}/feasibility/assessments`;
    const r = await app.inject({ method: 'POST', url, headers: owner, payload: { text: 'A floating 40 storey glass tower' } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    const a = FeasibilityAssessmentSchema.parse(r.json());
    expect([a.status, a.separation.conceptOnly.sort()]).toEqual(['ALTERNATIVES_PROPOSED', ['FLOATING_OR_LEVITATING_VOLUME', 'FULL_GLASS_ENVELOPE']]);
    expect(a.alternatives.every(x => x.applied === false && x.requiresConsent)).toBe(true);
    expect((await app.inject({ method: 'POST', url, headers: intruder, payload: { text: 'a house' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url, payload: { text: 'a house' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url, headers: owner, payload: {} })).statusCode).toBe(400);
    // A revision of another project is not a base for this one.
    expect((await app.inject({ method: 'POST', url, headers: owner, payload: { text: 'a house', baseRevisionId: revision } })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/projects/${projectId}/revisions`, headers: owner })).json().items).toEqual([]);
  });
});
