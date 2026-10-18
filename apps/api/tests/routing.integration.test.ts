import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { CapabilityRegistrySchema, RoutingDecisionSchema } from '../src/routing/contracts.js';

const owner = { authorization: 'Bearer owner' }, intruder = { authorization: 'Bearer intruder' };

describe('B43 S1: capability registry and routing decisions over HTTP', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    db = await startTestDatabase();
    const ownerId = await createTestUser(db.pool), intruderId = await createTestUser(db.pool);
    const env = parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false' });
    app = buildApp({ env, backend: createPgBackend(db.pool, { owner: ownerId, intruder: intruderId }), captureError: () => undefined });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.stop(); });

  it('serves the registry to signed-in users and the routing dry run to the project owner only', async () => {
    expect((await app.inject({ url: '/api/routing/capabilities' })).statusCode).toBe(401);
    const registry = CapabilityRegistrySchema.parse((await app.inject({ url: '/api/routing/capabilities', headers: intruder })).json());
    expect(registry.capabilities.every(c => c.providers.length === 0)).toBe(true); // no provider is configured in this environment
    const projectId = (await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'B43' } })).json().id as string;
    const url = `/api/projects/${projectId}/routing/decisions`, payload = { targetScopes: ['FACADE_APPEARANCE', 'INTERIOR_RENDER'] };
    const r = await app.inject({ method: 'POST', url, headers: owner, payload });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    const d = RoutingDecisionSchema.parse(r.json());
    expect([d.invoke.map(i => i.capabilityId), d.refused.map(x => x.scope)]).toEqual([['geometry.3d'], ['INTERIOR_RENDER']]);
    expect((await app.inject({ method: 'POST', url, headers: intruder, payload })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url, headers: owner, payload: { targetScopes: [] } })).statusCode).toBe(400);
  });
});
