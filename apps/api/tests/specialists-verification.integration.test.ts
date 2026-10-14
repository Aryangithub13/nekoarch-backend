import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { SpecialistResultSchema, SPECIALIST_VERSION } from '../src/contracts/specialists.js';

// The independent B34 verifier cannot be made to fail on a model that passes acceptance QA, so its verdict is replaced here, and only here.
const verdict = vi.hoisted(() => ({ status: 'FAILED' as string | null }));
vi.mock('../src/services/verification-service.js', async original => {
  const actual = await original<typeof import('../src/services/verification-service.js')>();
  return { ...actual, verifyRevision: async (...args: Parameters<typeof actual.verifyRevision>) => {
    const real = await actual.verifyRevision(...args);
    if (verdict.status === null) throw new Error('verifier unavailable');
    return { ...real, status: verdict.status as typeof real.status };
  } };
});

const owner = { authorization: 'Bearer owner' };

describe('B39 Blueprint: a failed independent verification after the commit (owner decision, 2026-10-14)', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    db = await startTestDatabase();
    const ownerId = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false',
      PROJECT_COMMIT_SECRET: secret }), backend: createPgBackend(db.pool, { owner: ownerId }), captureError: () => undefined });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.stop(); });

  const regenerate = async (title: string) => {
    const projectId = (await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title } })).json().id as string;
    const generated = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements: parametricInput(true) } });
    const r = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/specialists/BLUEPRINT/requests`, headers: owner, payload: { envelopeVersion: SPECIALIST_VERSION,
      baseRevisionId: generated.json().revision.id, operation: 'regenerate', targetScopes: ['building.floor_plans'], outputConfig: { requirements: parametricInput(false) } } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(201);
    return { projectId, result: SpecialistResultSchema.parse(r.json()) };
  };

  it('is FAILED, not a review note, and says the revision was committed and is current, with how to undo it', async () => {
    verdict.status = 'FAILED';
    const { projectId, result } = await regenerate('B39 verification failed');
    if (result.details.kind !== 'BLUEPRINT') throw new Error('unreachable');
    expect([result.status, result.written, result.details.verificationStatus]).toEqual(['FAILED', true, 'FAILED']);
    const reason = result.reasons.find(x => x.code === 'VERIFICATION_FAILED')!;
    expect(reason.message).toMatch(/Revision 2 was committed and is now the project's current revision/);
    expect(reason.message).toMatch(/RESTORE/);
    const project = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}`, headers: owner })).json();
    expect(project.currentRevision.id).toBe(result.resultRevisionId);
  }, 300_000);

  it('PARTIAL stays PARTIAL; a verifier that cannot run is REQUIRES_REVIEW (VERIFICATION_UNAVAILABLE)', async () => {
    verdict.status = 'PARTIAL';
    expect((await regenerate('B39 verification partial')).result.status).toBe('PARTIAL');
    verdict.status = null;
    const { result } = await regenerate('B39 verification unavailable');
    expect([result.status, result.reasons.map(x => x.code)]).toEqual(['REQUIRES_REVIEW', ['VERIFICATION_UNAVAILABLE']]);
  }, 300_000);
});
