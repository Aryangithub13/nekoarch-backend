import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { CompatibilitySchema, DeliveryManifestSchema } from '../src/delivery/contracts.js';
import { SCENE_LIMITS } from '../src/scene3d/contracts.js';

const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };

describe('B45 S1: scene delivery manifest and the compatibility package on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    db = await startTestDatabase();
    const ownerId = await createTestUser(db.pool), otherId = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    const env = parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false',
      PROJECT_COMMIT_SECRET: secret });
    app = buildApp({ env, backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.stop(); });

  it('delivers measured per-level chunks, stable pick anchors and budgets with a strong ETag, and follows revision currency', async () => {
    const projectId = (await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'B45' } })).json().id as string;
    const generate = (baseRevisionId: string | null, twoFloors: boolean) => app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner,
      payload: { requirements: parametricInput(twoFloors), baseRevisionId } });
    const revision = (await generate(null, true)).json().revision;
    const url = `/api/projects/${projectId}/revisions/${revision.id}/scene/delivery`;
    const before = await app.inject({ url, headers: owner });
    expect([before.statusCode, before.json().error.code]).toEqual([409, 'SCENE_NOT_COMPILED']);

    const compiled = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/${revision.id}/scene/artifacts`, headers: owner, payload: {} });
    expect(compiled.statusCode, compiled.body.slice(0, 300)).toBe(201);
    const manifest = compiled.json().manifest;
    const r = await app.inject({ url, headers: owner });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    const d = DeliveryManifestSchema.parse(r.json());
    expect([d.revisionCurrency, d.artifact.artifactId, d.artifact.glb.sha256, d.artifact.glb.bytes]).toEqual(['CURRENT', compiled.json().id, manifest.binary.sha256, manifest.binary.bytes]);
    // Chunks partition the scene exactly: one per level, and their measured counts sum to the artifact's statistics.
    expect(d.chunks.map(c => c.levelId)).toEqual(manifest.levels.map((l: { levelId: string }) => l.levelId));
    expect(d.chunks.reduce((s, c) => s + c.objects, 0)).toBe(manifest.statistics.objects);
    expect(d.chunks.reduce((s, c) => s + c.triangles, 0)).toBe(manifest.statistics.triangles);
    expect(d.pickAnchors).toHaveLength(manifest.objects.length);
    expect(d.pickAnchors.every(a => manifest.levels.some((l: { levelId: string }) => l.levelId === a.levelId))).toBe(true);
    expect(d.budgets.find(b => b.budgetId === 'TRIANGLES')).toEqual({ budgetId: 'TRIANGLES', limit: SCENE_LIMITS.triangles, measured: manifest.statistics.triangles,
      usedThousandths: Math.floor(manifest.statistics.triangles * 1000 / SCENE_LIMITS.triangles) });
    expect(d.media.filter(m => m.status === 'UNSUPPORTED').map(m => m.capability)).toEqual(['rendered_image', 'panorama_360', 'video']);
    expect(d.clientPerformance.status).toBe('NOT_MEASURED');

    expect(r.headers.etag).toBe(d.cache.etag);
    expect((await app.inject({ url, headers: { ...owner, 'if-none-match': d.cache.etag } })).statusCode).toBe(304);
    expect((await app.inject({ url, headers: other })).statusCode).toBe(404);

    // A new revision makes this one historical: the ETag changes, so a cached copy is revalidated, never served as current.
    expect((await generate(revision.id, false)).statusCode).toBe(201);
    const later = DeliveryManifestSchema.parse((await app.inject({ url, headers: owner })).json());
    expect([later.revisionCurrency, later.cache.etag === d.cache.etag]).toEqual(['HISTORICAL', false]);
    expect((await app.inject({ url, headers: { ...owner, 'if-none-match': d.cache.etag } })).statusCode).toBe(200);
  });

  it('publishes a route-catalog hash that matches the committed catalog, for contract drift detection', async () => {
    expect((await app.inject({ url: '/api/compatibility' })).statusCode).toBe(401);
    const c = CompatibilitySchema.parse((await app.inject({ url: '/api/compatibility', headers: other })).json());
    const catalog = JSON.parse(readFileSync(new URL('../../../docs/modernization/api-routes.json', import.meta.url), 'utf8'));
    // Same rule as routeCatalog (routes/delivery.ts): HEAD, served only beside a GET (the health checks), is not a separate contract entry.
    const routes = ((catalog.routes ?? catalog) as { method: string; url?: string; path?: string }[]).filter(x => x.method !== 'HEAD').map(x => `${x.method} ${x.url ?? x.path}`).sort();
    expect(c.routeCatalog).toEqual({ routes: routes.length, sha256: createHash('sha256').update(routes.join('\n')).digest('hex') });
    expect(c.services.map(s => s.serviceId)).toContain('SCENE_DELIVERY');
    expect([c.mockSubstitution, c.supportedClients.mobile]).toEqual(['FORBIDDEN_AS_LIVE_EVIDENCE', 'OUT_OF_SCOPE']);
  });
});
