import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { tower, withTwoRooms } from '../../../test-support/tower-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { modelHash } from '../src/lib/generation-identity.js';

const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret });
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
const z = (key: string, from: number, to: number) => ({ key, fromLevelId: `storey-${from}`, toLevelId: `storey-${to}` });
const ZONES = [z('LOW', 0, 1), z('MID', 2, 5), z('HIGH', 6, 7)];
const TYPICAL = { zones: ZONES, target: { kind: 'ZONE', zoneKey: 'MID' }, operation: { kind: 'TYPICAL_FLOOR', templateLevelId: 'storey-2' } };
const template = () => withTwoRooms(tower({ storeys: 8 }), 2);

describe('Phase 35 zone regeneration, its verification and partitioned processing over HTTP on stored revisions', () => {
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
  const post = (url: string, payload: unknown, headers: Record<string, string> = owner) => app.inject({ method: 'POST', url, headers, payload: payload as never });

  it('regenerates a zone as a candidate (storing nothing), commits it through the supplied-revision route, and verifies the committed revision', async () => {
    const id = await project('Typical floor');
    const base = (await save(id, template())).json().revision;
    const res = await post(`${zonesUrl(id, base.id)}/regeneration`, TYPICAL);
    expect(res.statusCode, res.body.slice(0, 400)).toBe(200);
    const r = res.json();
    expect(r).toMatchObject({ status: 'CANDIDATE_READY', projectId: id, revisionId: base.id, modelHash: modelHash(base.model), currency: { status: 'CURRENT' },
      preservation: { check: { status: 'WITHIN_SCOPE', outOfScope: 0 } }, commit: { route: `/api/projects/${id}/revisions`, baseRevisionId: base.id } });
    expect(r.verificationRoute).toBe(`/api/projects/${id}/revisions/:revisionId/engineering-assessment/zones/regeneration/verification`);
    expect(await revisions(id)).toHaveLength(1);

    const committed = await save(id, r.candidate.model, base.id);
    expect(committed.statusCode, committed.body.slice(0, 400)).toBe(201);
    const child = committed.json().revision;
    expect([modelHash(child.model), child.qa.status, child.parentRevisionId, child.sourceMode]).toEqual([r.commit.expectedModelHash, r.qa.status, base.id, 'supplied']);

    const verified = await post(r.verificationRoute.replace(':revisionId', child.id), TYPICAL);
    expect(verified.statusCode, verified.body.slice(0, 400)).toBe(200);
    expect(verified.json()).toMatchObject({ status: 'VERIFIED', revisionId: child.id, parentRevisionId: base.id, parentModelHash: modelHash(base.model),
      preservation: { status: 'WITHIN_SCOPE' }, deviation: { status: 'IDENTICAL' } });
    const noParent = await post(r.verificationRoute.replace(':revisionId', base.id), TYPICAL);
    expect([noParent.statusCode, noParent.json().status]).toEqual([200, 'NO_PARENT']);
    // The base is no longer current: the same candidate can no longer be committed against it.
    const stale = await save(id, r.candidate.model, base.id);
    expect([stale.statusCode, stale.json().error.code]).toEqual([409, 'REVISION_CONFLICT']);
    const again = (await post(`${zonesUrl(id, base.id)}/regeneration`, TYPICAL)).json();
    expect([again.currency.status, again.resultHash]).toEqual(['STALE', r.resultHash]);
    expect(await revisions(id)).toHaveLength(2);
  }, 180_000);

  it('reports MISMATCH, with every deviation, for a committed revision that is not exactly the regeneration of its parent', async () => {
    const id = await project('Tampered commit');
    const base = (await save(id, template())).json().revision;
    const candidate = (await post(`${zonesUrl(id, base.id)}/regeneration`, TYPICAL)).json().candidate.model;
    candidate.walls.find((w: { id: string }) => w.id === 'storey-0-west').thicknessMm = 250;
    const child = (await save(id, candidate, base.id)).json().revision;
    const v = (await post(`${zonesUrl(id, child.id)}/regeneration/verification`, TYPICAL)).json();
    expect(v).toMatchObject({ status: 'MISMATCH', preservation: { status: 'OUT_OF_SCOPE_CHANGES', violations: [{ collection: 'walls', entityId: 'storey-0-west', change: 'CHANGED' }] },
      deviation: { changed: 1, violations: [{ collection: 'walls', entityId: 'storey-0-west' }] } });
  }, 180_000);

  it('regenerates windows on a stored tower\'s façades and partitions a stored model into reconciled zone models, storing nothing', async () => {
    const id = await project('Skin and partitions');
    const model = tower({ storeys: 8 });
    const base = (await save(id, model)).json().revision;
    const skin = await post(`${zonesUrl(id, base.id)}/regeneration`, { zones: ZONES, target: { kind: 'EXTERIOR_SKIN', zoneKey: 'HIGH' },
      operation: { kind: 'FENESTRATION', window: { widthMm: 1500, heightMm: 1800, sillMm: 900, gapMm: 900, edgeClearanceMm: 600 } } });
    expect(skin.statusCode, skin.body.slice(0, 300)).toBe(200);
    expect(skin.json()).toMatchObject({ status: 'CANDIDATE_READY', changes: { wallsRegenerated: 8 }, preservation: { check: { status: 'WITHIN_SCOPE', added: 112 } } });
    const parts = await post(`${zonesUrl(id, base.id)}/partitions`, { zones: [0, 2, 4, 6].map(i => z(`Z${i}`, i, i + 1)), includeModels: true });
    expect(parts.statusCode, parts.body.slice(0, 300)).toBe(200);
    const p = parts.json();
    expect(p).toMatchObject({ status: 'RECONCILED', modelHash: modelHash(base.model), reconciliation: { coverage: { status: 'COMPLETE' }, grossFloorArea: { equal: true } } });
    expect(p.partitions.map((x: { key: string; bim: { eligibility: string } }) => [x.key, x.bim.eligibility])).toEqual([['Z0', 'ELIGIBLE'], ['Z2', 'REFUSED'], ['Z4', 'REFUSED'], ['Z6', 'REFUSED']]);
    expect(p.partitions.every((x: { model: unknown }) => x.model !== null)).toBe(true);
    expect(await revisions(id)).toHaveLength(1);
    const capabilities = (await app.inject({ url: '/api/capabilities' })).json();
    expect(capabilities.services.filter((s: { serviceId: string }) => ['ZONE_REGENERATION', 'ZONE_PARTITIONS'].includes(s.serviceId)).map((s: { route: string }) => s.route))
      .toEqual(['/api/projects/:projectId/revisions/:revisionId/engineering-assessment/zones/regeneration', '/api/projects/:projectId/revisions/:revisionId/engineering-assessment/zones/partitions']);
  }, 180_000);

  it('enforces ownership, authentication, validation and size limits, with typed refusals, on every new route', async () => {
    const id = await project('Security');
    const revision = (await save(id, template())).json().revision, url = zonesUrl(id, revision.id);
    const routes = [[`${url}/regeneration`, TYPICAL], [`${url}/regeneration/verification`, TYPICAL], [`${url}/partitions`, {}]] as const;
    for (const [path, body] of routes) {
      expect((await post(path, body, {})).statusCode, `${path} anonymous`).toBe(401);
      expect((await post(path, body, other)).statusCode, `${path} other user`).toBe(404);
      expect((await post(path.replace(revision.id, randomUUID()), body)).statusCode, `${path} unknown revision`).toBe(404);
      const huge = await app.inject({ method: 'POST', url: path, headers: { ...owner, 'content-type': 'application/json' }, payload: JSON.stringify({ zones: [{ key: 'A', fromLevelId: 'x'.repeat(40_000), toLevelId: 'y' }] }) });
      expect(huge.statusCode, `${path} oversized`).toBe(400);
    }
    const mismatched = await post(`${url}/regeneration`, { ...TYPICAL, operation: { kind: 'FENESTRATION', window: { widthMm: 1500, heightMm: 1800, sillMm: 900, gapMm: 900, edgeClearanceMm: 600 } } });
    expect([mismatched.statusCode, mismatched.json().error.code]).toEqual([400, 'VALIDATION_ERROR']);
    const refusals = await Promise.all([
      post(`${url}/regeneration`, { ...TYPICAL, zones: [z('A', 0, 1)], target: { kind: 'ZONE', zoneKey: 'A' } }),
      post(`${url}/regeneration`, { ...TYPICAL, operation: { kind: 'TYPICAL_FLOOR', templateLevelId: 'nowhere' } }),
      post(`${url}/regeneration/verification`, { ...TYPICAL, target: { kind: 'ZONE', zoneKey: 'TOP' } }),
      post(`${url}/partitions`, { zones: [z('A', 0, 1)] }),
    ]);
    // The verification route resolves the request against the parent; this revision has none, so it answers NO_PARENT before reading any zone.
    expect(refusals.map(r => [r.statusCode, r.statusCode === 200 ? r.json().status : r.json().error.code])).toEqual([[422, 'ZONE_DECLARATION_INVALID'],
      [422, 'REGENERATION_TEMPLATE_INVALID'], [200, 'NO_PARENT'], [422, 'ZONE_DECLARATION_INVALID']]);
    expect(await revisions(id)).toHaveLength(1);
  }, 180_000);
});
