import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { startTestDatabase, createTestUser } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { interpretationAcceptance } from '../../../test-support/interpretation-acceptance.js';
import { buildApp } from '../src/app.js';
import { parseEnv, type Env } from '../src/config/env.js';
import { fallbackProvider } from '../src/ai/fallback-parser.js';

describe('Phase 18 on real PostgreSQL and owner RLS', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, env: Env, ownerId: string, otherId: string;
  const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
  beforeAll(async () => {
    db = await startTestDatabase(); ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    env = parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret });
    app = buildApp({ env, backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });
  interpretationAcceptance(() => ({ app, owner, other }), process.env.PHASE18_EXAMPLE_PATH);

  it('times out one provider call without partial persistence and logs only safe metadata', async () => {
    const logs: string[] = [];
    const provider = { ...fallbackProvider, path: 'provider' as const, kind: 'fake', interpret: vi.fn(() => new Promise(() => {})) };
    const testApp = buildApp({ env, backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), logger: pino({ level: 'info' }, { write: (s: string) => { logs.push(s); } }), interpreter: { provider, timeoutMs: 5 } });
    try {
      const id = (await testApp.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Provider failure' } })).json().id;
      const before = (await db.pool.query('select (select count(*) from project_revisions) revisions, (select count(*) from project_audit_events) audits, (select count(*) from idempotency_records) receipts')).rows[0];
      const r = await testApp.inject({ method: 'POST', url: `/api/projects/${id}/requirements/interpret`, headers: owner, payload: { text: 'private-brief-marker 30x50 ft 3BHK' } });
      expect(r.statusCode).toBe(200); expect(r.json().error.code).toBe('AI_PROVIDER_TIMEOUT'); expect(r.json().status).toBe('FAILED');
      expect(provider.interpret).toHaveBeenCalledTimes(1);
      expect((await db.pool.query('select (select count(*) from project_revisions) revisions, (select count(*) from project_audit_events) audits, (select count(*) from idempotency_records) receipts')).rows[0]).toEqual(before);
      const joined = logs.join(''); expect(joined).not.toContain('private-brief-marker'); expect(joined).not.toContain('Bearer owner'); expect(joined).toContain('interpretationId'); expect(joined).toContain('clarificationCount');
    } finally { await testApp.close(); }
  });
  it('denies cross-user projects before invoking a provider and applies the expensive-operation quota', async () => {
    const provider = { ...fallbackProvider, interpret: vi.fn(fallbackProvider.interpret) };
    const limited = buildApp({ env: { ...env, RATE_LIMIT_ENABLED: true, RATE_LIMIT_GENERATE: 1 }, backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), interpreter: { provider } });
    try {
      const id = (await limited.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Bounded' } })).json().id;
      const url = `/api/projects/${id}/requirements/interpret`, payload = { text: '30x50 ft 3BHK' };
      expect((await limited.inject({ method: 'POST', url, headers: other, payload })).statusCode).toBe(404); expect(provider.interpret).not.toHaveBeenCalled();
      expect((await limited.inject({ method: 'POST', url, headers: owner, payload })).statusCode).toBe(200);
      expect((await limited.inject({ method: 'POST', url, headers: owner, payload })).statusCode).toBe(429); expect(provider.interpret).toHaveBeenCalledTimes(1);
    } finally { await limited.close(); }
  });
  it('does not persist interpretation receipts or replay a different stateless brief under the same key', async () => {
    const id = (await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Stateless' } })).json().id;
    const before = (await db.pool.query('select count(*) from idempotency_records')).rows[0];
    const results = [];
    for (const text of ['30x50 ft 2BHK', '30x50 ft 3BHK']) results.push((await app.inject({ method: 'POST', url: `/api/projects/${id}/requirements/interpret`, headers: { ...owner, 'idempotency-key': 'stateless-key' }, payload: { text } })).json());
    expect(results[0].candidate.bedrooms).toBe(2); expect(results[1].candidate.bedrooms).toBe(3); expect(results[0].interpretationId).not.toBe(results[1].interpretationId);
    expect((await db.pool.query('select count(*) from idempotency_records')).rows[0]).toEqual(before);
  });
  it('keeps health and direct native generation working when interpretation is explicitly disabled', async () => {
    const disabled = buildApp({ env: { ...env, AI_INTERPRETER_MODE: 'disabled' }, backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }) });
    try {
      const id = (await disabled.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Direct generation' } })).json().id;
      expect((await disabled.inject({ url: '/health/ready' })).statusCode).toBe(200);
      const result = await disabled.inject({ method: 'POST', url: `/api/projects/${id}/requirements/interpret`, headers: owner, payload: { text: '30x50 ft 3BHK' } });
      expect(result.json()).toMatchObject({ status: 'FAILED', error: { code: 'AI_CONFIGURATION_UNAVAILABLE' }, structuredRequirements: null });
      const response = await disabled.inject({ method: 'POST', url: `/api/projects/${id}/revisions/generate`, headers: owner, payload: {
        requirements: { site: { boundary: [{ x: 0, z: 0 }, { x: 9144, z: 0 }, { x: 9144, z: 15240 }, { x: 0, z: 15240 }], northMilliDegrees: null },
          rooms: [{ type: 'bedroom', count: 3 }, { type: 'bathroom', count: 1 }, { type: 'living', count: 1 }, { type: 'kitchen', count: 1 }] },
      } });
      expect(response.statusCode, response.body).toBe(201); expect(response.json().revision.qa.status).toBe('PASS');
    } finally { await disabled.close(); }
  });
});
