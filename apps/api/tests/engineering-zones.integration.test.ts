import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { tower } from '../../../test-support/tower-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { modelHash } from '../src/lib/generation-identity.js';

const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret });
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
const z = (key: string, from: number, to: number) => ({ key, fromLevelId: `storey-${from}`, toLevelId: `storey-${to}` });

describe('Phase 35.1 limits, zone assessment and regeneration preflight over HTTP on stored revisions', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    db = await startTestDatabase();
    const ownerId = await createTestUser(db.pool), otherId = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.stop(); });

  async function project(title: string) {
    const res = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title } });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(201);
    return res.json().id as string;
  }
  const save = (id: string, model: unknown, baseRevisionId: string | null = null) =>
    app.inject({ method: 'POST', url: `/api/projects/${id}/revisions`, headers: owner, payload: { model, baseRevisionId } });
  const revisions = async (id: string) => (await app.inject({ url: `/api/projects/${id}/revisions`, headers: owner })).json().items as { id: string }[];
  const zonesUrl = (id: string, revisionId: string) => `/api/projects/${id}/revisions/${revisionId}/engineering-assessment/zones`;

  it('stores a 256-level model and refuses a 257-level one at the schema boundary with a typed 400, storing nothing', async () => {
    const id = await project('Level limit');
    const max = await save(id, tower({ storeys: 256 }));
    expect(max.statusCode, max.body.slice(0, 300)).toBe(201);
    const over = await save(id, tower({ storeys: 257 }), max.json().revision.id);
    expect(over.statusCode).toBe(400);
    expect(over.json().error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(over.json().error.fieldErrors ?? {})).toContain('model.levels');
    expect(await revisions(id)).toHaveLength(1);
    const assessed = await app.inject({ url: zonesUrl(id, max.json().revision.id), headers: owner });
    expect(assessed.statusCode, assessed.body.slice(0, 300)).toBe(200);
    expect(assessed.json().zones[0].storeyCount).toBe(256);
  }, 120_000);

  it('refuses generation beyond two floors with a typed 400 and stores nothing', async () => {
    const id = await project('Generation limit');
    const res = await app.inject({ method: 'POST', url: `/api/projects/${id}/revisions/generate`, headers: owner,
      payload: { requirements: { ...parametricInput(true), floors: 3 }, baseRevisionId: null } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(await revisions(id)).toHaveLength(0);
  });

  it('BIM-derived services refuse a stored tall model with their existing typed codes, as discovery and the assessment disclose', async () => {
    const id = await project('Tall refusals');
    const revision = (await save(id, tower({ storeys: 12 }))).json().revision;
    const bim = await app.inject({ url: `/api/projects/${id}/revisions/${revision.id}/bim`, headers: owner });
    expect([bim.statusCode, bim.json().error.code]).toEqual([422, 'BIM_UNSUPPORTED_MODEL']);
    const scene = await app.inject({ method: 'POST', url: `/api/projects/${id}/revisions/${revision.id}/scene/artifacts`, headers: { ...owner, 'idempotency-key': randomUUID() }, payload: {} });
    expect([scene.statusCode, scene.json().error.code]).toEqual([422, 'SCENE_UNSUPPORTED_MODEL']);
    const assessment = (await app.inject({ url: `/api/projects/${id}/revisions/${revision.id}/engineering-assessment`, headers: owner })).json();
    const systems = assessment.domains.find((d: { domain: string }) => d.domain === 'VERTICAL_TRANSPORT').relatedServices[0];
    expect(systems).toMatchObject({ serviceId: 'BUILDING_SYSTEMS_ANALYSIS', modelSupport: 'REFUSED', refusalCode: 'BIM_UNSUPPORTED_MODEL' });
    const capabilities = (await app.inject({ url: '/api/capabilities' })).json();
    expect(capabilities.modelLimits.find((l: { limitId: string }) => l.limitId === 'BIM_PROFILE_MAX_STOREYS').appliesTo).toEqual(expect.arrayContaining(['BIM', 'SCENE_3D', 'BUILDING_SYSTEMS_ANALYSIS']));
    expect(capabilities.unsupportedOperations.map((o: { operationId: string }) => o.operationId)).toContain('GENERATIVE_ZONE_REGENERATION');
  }, 120_000);

  it('assesses declared zones of a stored 163-storey concept, binds them to the revision and its hash, and changes nothing', async () => {
    const id = await project('Supertall zones');
    const model = tower({ storeys: 163, storeyHeightMm: 5120 });
    const revision = (await save(id, model)).json().revision;
    const body = { zones: [z('LOW', 0, 80), z('HIGH', 81, 162)] };
    const first = await app.inject({ method: 'POST', url: zonesUrl(id, revision.id), headers: owner, payload: body });
    expect(first.statusCode, first.body.slice(0, 300)).toBe(200);
    const r = first.json();
    expect(r).toMatchObject({ projectId: id, revisionId: revision.id, modelHash: modelHash(revision.model), status: 'PARTIAL', currency: { status: 'CURRENT' },
      sourceRevision: { revisionId: revision.id, revisionNumber: 1, parentRevisionId: null } });
    expect(r.zones.map((x: { key: string; storeyCount: number }) => [x.key, x.storeyCount])).toEqual([['LOW', 81], ['HIGH', 82]]);
    const whole = (await app.inject({ url: `/api/projects/${id}/revisions/${revision.id}/engineering-assessment`, headers: owner })).json();
    expect((BigInt(r.zones[0].grossFloorAreaMm2) + BigInt(r.zones[1].grossFloorAreaMm2)).toString()).toBe(whole.areas.grossFloorAreaMm2);
    const again = (await app.inject({ method: 'POST', url: zonesUrl(id, revision.id), headers: owner, payload: { zones: [...body.zones].reverse() } })).json();
    expect([again.inputHash, again.resultHash]).toEqual([r.inputHash, r.resultHash]);
    const preflight = await app.inject({ method: 'POST', url: `${zonesUrl(id, revision.id)}/regeneration-preflight`, headers: owner,
      payload: { ...body, target: { kind: 'ZONE', zoneKey: 'HIGH' } } });
    expect(preflight.statusCode, preflight.body.slice(0, 300)).toBe(200);
    expect(preflight.json()).toMatchObject({ status: 'UNSUPPORTED', refusal: { code: 'ZONE_GEOMETRY_REGENERATION_UNSUPPORTED' }, preservation: { status: 'PLANNED_NOT_ENFORCED' } });
    // Nothing was created or moved: still one revision, still current, and the stored model is byte-for-byte the same.
    expect(await revisions(id)).toHaveLength(1);
    const after = (await app.inject({ url: `/api/projects/${id}`, headers: owner })).json();
    expect(after.currentRevisionId).toBe(revision.id);
    expect(modelHash(after.currentRevision.model)).toBe(modelHash(revision.model));
  }, 180_000);

  it('keeps an older revision\'s result bound to that revision and marks it STALE once a newer revision exists', async () => {
    const id = await project('Ancestry');
    const first = (await save(id, tower({ storeys: 6 }))).json().revision;
    const before = (await app.inject({ url: zonesUrl(id, first.id), headers: owner })).json();
    expect(before.currency).toEqual({ status: 'CURRENT', artifactRevisionId: first.id, projectCurrentRevisionId: first.id });
    const second = (await save(id, tower({ storeys: 7 }), first.id)).json().revision;
    const stale = (await app.inject({ url: zonesUrl(id, first.id), headers: owner })).json();
    expect(stale.currency).toEqual({ status: 'STALE', artifactRevisionId: first.id, projectCurrentRevisionId: second.id });
    expect([stale.inputHash, stale.resultHash, stale.zones[0].storeyCount]).toEqual([before.inputHash, before.resultHash, 6]);
    const current = (await app.inject({ url: zonesUrl(id, second.id), headers: owner })).json();
    expect(current).toMatchObject({ currency: { status: 'CURRENT' }, sourceRevision: { revisionNumber: 2, parentRevisionId: first.id } });
    expect(current.zones[0].zoneId).not.toBe(before.zones[0].zoneId);
  }, 120_000);

  it('enforces ownership, authentication, validation and size limits, with typed preflight refusals', async () => {
    const id = await project('Security');
    const revision = (await save(id, tower({ storeys: 4 }))).json().revision, url = zonesUrl(id, revision.id), pre = `${url}/regeneration-preflight`;
    const target = { target: { kind: 'ZONE', zoneKey: 'ALL' } };
    for (const [method, path, body] of [['GET', url, null], ['POST', url, {}], ['POST', pre, target]] as const) {
      const payload = body === null ? {} : { payload: body };
      expect((await app.inject({ method, url: path, ...payload })).statusCode, `${method} ${path} anonymous`).toBe(401);
      expect((await app.inject({ method, url: path, headers: other, ...payload })).statusCode, `${method} ${path} other user`).toBe(404);
      expect((await app.inject({ method, url: path.replace(revision.id, randomUUID()), headers: owner, ...payload })).statusCode, `${method} unknown revision`).toBe(404);
    }
    expect((await app.inject({ url: `${url}?zones=1`, headers: owner })).statusCode).toBe(400);
    const duplicate = await app.inject({ method: 'POST', url, headers: owner, payload: { zones: [z('A', 0, 1), z('A', 2, 3)] } });
    expect([duplicate.statusCode, duplicate.json().error.code]).toEqual([400, 'VALIDATION_ERROR']);
    const huge = await app.inject({ method: 'POST', url, headers: { ...owner, 'content-type': 'application/json' }, payload: JSON.stringify({ zones: [{ key: 'A', fromLevelId: 'x'.repeat(40_000), toLevelId: 'y' }] }) });
    expect(huge.statusCode).toBe(400);
    const invalid = await app.inject({ method: 'POST', url, headers: owner, payload: { zones: [z('A', 0, 1)] } });
    expect([invalid.statusCode, invalid.json().status]).toEqual([200, 'INVALID_DECLARATION']);
    const refusals = await Promise.all([
      app.inject({ method: 'POST', url: pre, headers: owner, payload: { zones: [z('A', 0, 1)], target: { kind: 'ZONE', zoneKey: 'A' } } }),
      app.inject({ method: 'POST', url: pre, headers: owner, payload: { target: { kind: 'ZONE', zoneKey: 'MID' } } }),
      app.inject({ method: 'POST', url: pre, headers: owner, payload: { target: { kind: 'SECTION', fromLevelId: 'storey-3', toLevelId: 'storey-1' } } }),
    ]);
    expect(refusals.map(r => [r.statusCode, r.json().error.code])).toEqual([[422, 'ZONE_DECLARATION_INVALID'], [422, 'ZONE_TARGET_NOT_FOUND'], [422, 'SECTION_TARGET_INVALID']]);
    expect(refusals[0]!.json().error.fieldErrors.zones[0]).toMatch(/^INCOMPLETE_COVERAGE/);
    expect(await revisions(id)).toHaveLength(1);
  });
});
