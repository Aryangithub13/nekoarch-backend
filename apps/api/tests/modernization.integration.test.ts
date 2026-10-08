import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import type { SceneManifest } from '../src/scene3d/contracts.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const COLLECTION: Record<string, string> = { wall: 'walls', opening: 'openings', slab: 'slabs', stair: 'stairs', landing: 'landings', space: 'spaces' };

/** Independent GLB reader: per scene object, its absolute model-frame geometry on the 0.5 mm grid plus its index list. Origins may differ between revisions; this does not. */
function geometry(glb: Buffer, manifest: SceneManifest) {
  const jsonLength = glb.readUInt32LE(12), json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')), bin = 20 + jsonLength + 8, o = manifest.frame.originMm;
  const out = new Map<string, string>();
  for (const node of json.nodes as Json[]) {
    if (node.mesh === undefined) continue;
    const parts: string[] = [];
    for (const p of json.meshes[node.mesh].primitives as Json[]) {
      const a = json.accessors[p.attributes.POSITION], v = json.bufferViews[a.bufferView], coords: number[] = [];
      for (let i = 0; i < a.count * 3; i++) coords.push(Math.round((glb.readFloatLE(bin + v.byteOffset + i * 4) * 1000 + [o.x, o.y, o.z][i % 3]!) * 2));
      const ia = json.accessors[p.indices], iv = json.bufferViews[ia.bufferView], wide = ia.componentType === 5125, idx: number[] = [];
      for (let i = 0; i < ia.count; i++) idx.push(wide ? glb.readUInt32LE(bin + iv.byteOffset + i * 4) : glb.readUInt16LE(bin + iv.byteOffset + i * 2));
      parts.push(`${p.material}|${coords.join(',')}|${idx.join(',')}`);
    }
    out.set(node.extras.sceneObjectId, sha(Buffer.from(parts.join('#'))));
  }
  return out;
}

describe('Phases 1–29 modernization acceptance on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    db = await startTestDatabase();
    const ownerId = await createTestUser(db.pool), otherId = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false',
      PROJECT_COMMIT_SECRET: secret }), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });

  const rev = (projectId: string, revisionId: string) => `/api/projects/${projectId}/revisions/${revisionId}`;
  const ok = async (method: 'GET' | 'POST', url: string, payload?: unknown, status = method === 'POST' ? 201 : 200) => {
    const r = await app.inject({ method, url, headers: owner, ...(payload === undefined ? {} : { payload: payload as Json }) });
    expect(r.statusCode, `${method} ${url}: ${r.body.slice(0, 400)}`).toBe(status);
    return r;
  };
  const scene = async (projectId: string, revisionId: string) => {
    const created = (await ok('POST', `${rev(projectId, revisionId)}/scene/artifacts`, {})).json() as Json;
    const glb = Buffer.from((await ok('GET', `${rev(projectId, revisionId)}/scene/artifacts/${created.id}/glb`)).rawPayload);
    return { id: created.id as string, manifest: created.manifest as SceneManifest, glb };
  };
  const bimElements = async (projectId: string, revisionId: string) => {
    const all: Json[] = []; let after: string | null = null;
    do { const page = (await ok('GET', `${rev(projectId, revisionId)}/bim/elements?limit=100${after ? `&after=${after}` : ''}`)).json() as Json;
      expect(page.binding).toMatchObject({ projectId, revisionId }); all.push(...page.items); after = page.nextAfter; } while (after);
    return new Map(all.map(e => [e.id as string, e]));
  };

  let projectId: string, a: Json, sceneA: Awaited<ReturnType<typeof scene>>, takeoffId: string;
  it('Test 8: the overview references only this revision, reports missing outputs as NOT_GENERATED and unsupported media explicitly, and is owner-only', async () => {
    projectId = (await ok('POST', '/api/projects', { title: 'Modernization acceptance' })).json().id;
    a = (await ok('POST', `/api/projects/${projectId}/revisions/generate`, { requirements: parametricInput(true) })).json().revision;
    const url = `${rev(projectId, a.id)}/overview`;
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: other })).statusCode).toBe(404);
    expect((await app.inject({ url: `${url}?expand=1`, headers: owner })).statusCode).toBe(400);
    const empty = (await ok('GET', url)).json() as Json, out = (o: Json, name: string) => o.outputs.find((x: Json) => x.output === name);
    expect(empty).toMatchObject({ overviewVersion: 'project-overview-v1', projectId, revisionId: a.id, revisionNumber: 1, revisionCurrency: 'CURRENT', projectCurrentRevisionId: a.id,
      revision: { modelHash: a.identity.modelHash, identityConsistent: true, qa: { id: a.qa.id, status: a.qa.status } }, claims: { engineeringReview: 'NOT_CLAIMED' } });
    expect(out(empty, 'BUILDING_MODEL')).toMatchObject({ status: 'AVAILABLE', artifacts: [{ id: a.id }], href: rev(projectId, a.id) });
    expect(out(empty, 'BIM')).toMatchObject({ status: 'DERIVED_ON_READ', artifacts: [] });
    for (const name of ['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST', 'STRUCTURAL_ANALYSIS', 'ENVIRONMENTAL_ANALYSIS', 'BUILDING_SYSTEMS_ANALYSIS', 'SPECIALIZED_KNOWLEDGE', 'DESIGN_OPTIMIZATION', 'SCENE_3D'])
      expect(out(empty, name), name).toMatchObject({ status: 'NOT_GENERATED', artifacts: [], otherRevisionArtifacts: 0, truncated: false });
    expect(empty.unsupported.map((u: Json) => u.output)).toEqual(expect.arrayContaining(['EXTERIOR_RENDER', 'INTERIOR_RENDER', 'PANORAMA_360', 'RENDERED_WALKTHROUGH_VIDEO', 'INTERIOR_DESIGN', 'EXTERIOR_DESIGN']));

    takeoffId = (await ok('POST', `${rev(projectId, a.id)}/takeoffs`, {})).json().id;
    sceneA = await scene(projectId, a.id);
    const full = (await ok('GET', url)).json() as Json;
    expect(out(full, 'QUANTITY_TAKEOFF')).toMatchObject({ status: 'AVAILABLE', artifacts: [{ id: takeoffId }] });
    expect(out(full, 'SCENE_3D')).toMatchObject({ status: 'AVAILABLE', artifacts: [{ id: sceneA.id }], otherRevisionArtifacts: 0 });
    // Every advertised reference resolves to an artifact of this revision.
    expect((await ok('GET', out(full, 'QUANTITY_TAKEOFF').href)).json().items.map((i: Json) => [i.id, i.projectRevisionId])).toEqual([[takeoffId, a.id]]);
    expect((await ok('GET', `${out(full, 'SCENE_3D').href}/status`)).json()).toMatchObject({ revisionId: a.id, artifacts: [{ id: sceneA.id, projectRevisionId: a.id }] });
    expect((await ok('GET', out(full, 'BIM').href)).json().model.binding).toMatchObject({ projectId, revisionId: a.id });
  });

  it('Tests 1/4: every scene object is bound to this revision and resolves to the BIM element of the same source entity', async () => {
    const elements = await bimElements(projectId, a.id);
    expect(sceneA.manifest.source).toMatchObject({ projectId, revisionId: a.id, modelHash: a.identity.modelHash });
    let linked = 0;
    for (const object of sceneA.manifest.objects) {
      if (object.sourceEntityType === 'junction') { expect(object.bimElementId).toBeNull(); continue; }
      const element = elements.get(object.bimElementId!);
      expect(element, object.sceneObjectId).toBeDefined();
      expect([element!.source.collection, element!.source.id], object.sceneObjectId).toEqual([COLLECTION[object.sourceEntityType], object.sourceEntityId]);
      linked++;
    }
    expect([linked, linked > 30]).toEqual([sceneA.manifest.objects.filter(o => o.sourceEntityType !== 'junction').length, true]);
    for (const level of sceneA.manifest.levels) expect(elements.get(level.bimElementId!)?.source).toMatchObject({ collection: 'levels', id: level.levelId });
  });

  let b: Json, sceneB: Awaited<ReturnType<typeof scene>>;
  it('Tests 2/9/10: a ground-floor wing edit changes scene geometry only where BIM reports a geometry change; the accepted revision and its artifacts are untouched and stale bases are refused', async () => {
    const edited = parametricInput(true); edited.parametricArchitecture.floors[0]!.westWingWidthMm = 10000;
    b = (await ok('POST', `/api/projects/${projectId}/revisions/generate`, { requirements: edited, baseRevisionId: a.id })).json().revision;
    expect(b).toMatchObject({ parentRevisionId: a.id, revisionNumber: 2 });
    sceneB = await scene(projectId, b.id);
    const diff = (await ok('GET', `${rev(projectId, a.id)}/bim/diff/${b.id}`)).json() as Json;
    const changes = new Map<string, string[]>(diff.changes.map((c: Json) => [c.id, c.changes]));
    const geoA = geometry(sceneA.glb, sceneA.manifest), geoB = geometry(sceneB.glb, sceneB.manifest), objectsB = new Map(sceneB.manifest.objects.map(o => [o.sceneObjectId, o]));
    let preserved = 0, changed = 0;
    for (const o of sceneA.manifest.objects) {
      const inB = objectsB.get(o.sceneObjectId);
      if (!inB || !o.bimElementId || inB.bimElementId !== o.bimElementId) continue;
      const bim = changes.get(o.bimElementId)!;
      if (bim.length === 1 && bim[0] === 'UNCHANGED') { expect(geoB.get(o.sceneObjectId), o.sceneObjectId).toBe(geoA.get(o.sceneObjectId)); preserved++; }
      else if (geoB.get(o.sceneObjectId) !== geoA.get(o.sceneObjectId)) { expect(bim, o.sceneObjectId).toEqual(expect.arrayContaining(['MODIFIED_GEOMETRY'])); changed++; }
    }
    expect([preserved > 20, changed > 0]).toEqual([true, true]);

    // Revision A is historical, its artifact unchanged and still listed; B sees A's scene only as a stale artifact.
    const overviewA = (await ok('GET', `${rev(projectId, a.id)}/overview`)).json() as Json, overviewB = (await ok('GET', `${rev(projectId, b.id)}/overview`)).json() as Json;
    expect([overviewA.revisionCurrency, overviewB.revisionCurrency, overviewB.parentRevisionId]).toEqual(['HISTORICAL', 'CURRENT', a.id]);
    expect(overviewA.outputs.find((o: Json) => o.output === 'SCENE_3D')).toMatchObject({ artifacts: [{ id: sceneA.id }], otherRevisionArtifacts: 1 });
    expect(overviewB.outputs.find((o: Json) => o.output === 'SCENE_3D')).toMatchObject({ artifacts: [{ id: sceneB.id }], otherRevisionArtifacts: 1 });
    expect(overviewB.outputs.find((o: Json) => o.output === 'QUANTITY_TAKEOFF')).toMatchObject({ status: 'NOT_GENERATED' });
    expect(sha(Buffer.from((await ok('GET', `${rev(projectId, a.id)}/scene/artifacts/${sceneA.id}/glb`)).rawPayload))).toBe(sceneA.manifest.binary.sha256);
    const stale = await app.inject({ url: `${rev(projectId, a.id)}/scene/artifacts/${sceneA.id}/glb?require=current`, headers: owner });
    expect([stale.statusCode, stale.json().error.code]).toEqual([409, 'SCENE_ARTIFACT_STALE']);

    // A write against the superseded base is refused and nothing moves.
    const conflict = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements: parametricInput(true), baseRevisionId: a.id } });
    expect([conflict.statusCode, conflict.json().error.code]).toEqual([409, 'REVISION_CONFLICT']);
    expect((await ok('GET', `/api/projects/${projectId}`)).json()).toMatchObject({ currentRevisionId: b.id, currentRevisionNumber: 2 });
    expect((await db.pool.query('select count(*)::int n from public.project_revision_scene_artifacts where project_revision_id = any($1)', [[a.id, b.id]])).rows[0].n).toBe(2);
  });

  it('Test 2: a property-only edit (space renamed) preserves every scene object geometry and BIM reports no geometry change', async () => {
    const model = structuredClone(b.model); model.spaces[0].name = `${model.spaces[0].name} (renamed)`;
    const c = (await ok('POST', `/api/projects/${projectId}/revisions`, { model, baseRevisionId: b.id })).json().revision as Json;
    const sceneC = await scene(projectId, c.id), geoB = geometry(sceneB.glb, sceneB.manifest), geoC = geometry(sceneC.glb, sceneC.manifest);
    expect([...geoC.keys()].sort()).toEqual([...geoB.keys()].sort());
    for (const [id, g] of geoB) expect(geoC.get(id), id).toBe(g);
    const diff = (await ok('GET', `${rev(projectId, b.id)}/bim/diff/${c.id}`)).json() as Json;
    expect(diff.changes.some((x: Json) => x.changes.includes('MODIFIED_GEOMETRY') || x.changes.includes('ADDED') || x.changes.includes('REMOVED'))).toBe(false);
    expect(diff.changes.some((x: Json) => x.changes.includes('MODIFIED_PROPERTY'))).toBe(true);
    expect(sceneC.manifest.source.modelHash).not.toBe(sceneB.manifest.source.modelHash);
  });

  it('R04: the assistant capability tool reports the available scene engine and unsupported media instead of only the Phase 16 planned workflow step', async () => {
    const fresh = (await ok('POST', '/api/projects', { title: 'Modernization assistant tools' })).json().id, conversationId = randomUUID(), url = `/api/projects/${fresh}/conversations`;
    expect((await app.inject({ method: 'POST', url, headers: owner, payload: { conversationId, baseRevisionId: null } })).statusCode).toBe(200);
    const [result] = (await ok('POST', `${url}/${conversationId}/tools`, { actions: [{ name: 'CHECK_CAPABILITIES', input: {} }] }, 200)).json().results;
    expect(result.capabilities.find((c: Json) => c.capabilityId === 'SCENE_3D').implementationStatus).toBe('PLANNED');
    expect(result.services.find((s: Json) => s.serviceId === 'SCENE_3D')).toEqual({ serviceId: 'SCENE_3D', version: 'scene-compiler-v1', status: 'AVAILABLE', workflowCapability: null });
    expect(result.media.filter((m: Json) => m.status === 'AVAILABLE').map((m: Json) => m.media)).toEqual(['INTERACTIVE_3D_MODEL']);
  });

  it('R07-B: scene assets are gzip-encoded on request, revalidate immutable bytes with 304 only after authorization, and never 304 the manifest', async () => {
    const base = `${rev(projectId, b.id)}/scene/artifacts/${sceneB.id}`, digest = sceneB.manifest.binary.sha256;
    const gz = await app.inject({ url: `${base}/glb`, headers: { ...owner, 'accept-encoding': 'br, gzip;q=0.8' } });
    expect(gz.headers).toMatchObject({ 'content-encoding': 'gzip', etag: `"${digest}-gzip"`, vary: expect.stringContaining('Accept-Encoding'), 'content-type': 'model/gltf-binary' });
    expect(sha(gunzipSync(gz.rawPayload))).toBe(digest);
    expect(gz.rawPayload.length * 5).toBeLessThan(sceneB.glb.length);
    const refused = await app.inject({ url: `${base}/glb`, headers: { ...owner, 'accept-encoding': 'gzip;q=0' } });
    expect([refused.headers['content-encoding'], refused.headers.etag, sha(Buffer.from(refused.rawPayload))]).toEqual([undefined, `"${digest}"`, digest]);
    for (const tag of [`"${digest}"`, `W/"${digest}-gzip"`, `"other", "${digest}"`]) {
      const r = await app.inject({ url: `${base}/glb`, headers: { ...owner, 'if-none-match': tag } });
      expect([r.statusCode, r.rawPayload.length], tag).toEqual([304, 0]);
    }
    expect((await app.inject({ url: `${base}/glb`, headers: { ...other, 'if-none-match': `"${digest}"` } })).statusCode).toBe(404);
    expect((await app.inject({ url: `${base}/glb`, headers: { 'if-none-match': `"${digest}"` } })).statusCode).toBe(401);
    const plain = await ok('GET', `${base}/manifest`), zipped = await app.inject({ url: `${base}/manifest`, headers: { ...owner, 'accept-encoding': 'gzip', 'if-none-match': String(plain.headers.etag) } });
    expect([zipped.statusCode, zipped.headers['content-encoding']]).toEqual([200, 'gzip']);
    expect(JSON.parse(gunzipSync(zipped.rawPayload).toString('utf8'))).toEqual(plain.json());
    expect(plain.json()).toMatchObject({ artifactId: sceneB.id, currency: { status: 'STALE' }, manifest: { source: { revisionId: b.id } } });
    expect([plain.headers['content-type'], plain.headers.etag, zipped.headers.etag]).toEqual(['application/json; charset=utf-8', `"${plain.json().sceneHash}"`, `"${plain.json().sceneHash}-gzip"`]);
  });
});
