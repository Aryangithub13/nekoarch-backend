import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import validator from 'gltf-validator';
import type { ProjectTestContext } from './project-acceptance.js';
import { parametricInput } from './parametric-fixtures.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Result = Record<string, any>;

/** Phase 29 HTTP acceptance, shared by embedded PostgreSQL and the local Supabase stack. Compiles run in the real worker pool. */
export function sceneAcceptance(context: () => ProjectTestContext) {
  describe('Phase 29 scene acceptance', () => {
    let fixture: Awaited<ReturnType<typeof setup>>;
    async function setup() {
      const { app, owner, other } = context();
      const project = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Phase 29 scene acceptance' } });
      expect(project.statusCode, project.body).toBe(201);
      const projectId = project.json().id as string;
      const a = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements: parametricInput(true) } });
      expect(a.statusCode, a.body).toBe(201);
      const revision = a.json().revision as Result, base = `/api/projects/${projectId}/revisions/${revision.id}/scene`;
      return { app, owner, other, projectId, revision, base };
    }
    beforeAll(async () => { fixture = await setup(); });

    it('refuses anonymous, foreign and malformed requests without compiling', async () => {
      const { app, owner, other, base } = fixture;
      expect((await app.inject({ method: 'POST', url: `${base}/artifacts`, payload: {} })).statusCode).toBe(401);
      expect((await app.inject({ url: `${base}/artifacts/${randomUUID()}/glb` })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: `${base}/artifacts`, headers: other, payload: {} })).statusCode).toBe(404);
      const bad = await app.inject({ method: 'POST', url: `${base}/artifacts`, headers: owner, payload: { lod: 3 } });
      expect([bad.statusCode, bad.json().error.code]).toEqual([400, 'SCENE_INPUT_INVALID']);
      expect((await app.inject({ url: `${base}/artifacts/${randomUUID()}`, headers: owner })).statusCode).toBe(404);
      expect((await app.inject({ url: `${base}/artifacts/not-a-uuid/glb`, headers: owner })).statusCode).toBe(400);
      expect((await app.inject({ url: `${base}/artifacts`, headers: owner })).json().items).toEqual([]);
    });

    it('validates without compiling, then compiles, validates and persists an immutable READY artifact', async () => {
      const { app, owner, base, revision, projectId } = fixture;
      const v = await app.inject({ method: 'POST', url: `${base}/validate`, headers: owner, payload: {} });
      expect(v.statusCode, v.body).toBe(200);
      expect(v.json()).toMatchObject({ readiness: 'READY', compilerVersion: 'scene-compiler-v1', binding: { projectId, revisionId: revision.id } });
      expect((await app.inject({ url: `${base}/status`, headers: owner })).json()).toMatchObject({ sceneStatus: 'NOT_COMPILED', artifacts: [] });
      const created = await app.inject({ method: 'POST', url: `${base}/artifacts`, headers: owner, payload: {} });
      expect(created.statusCode, created.body.slice(0, 500)).toBe(201);
      const a = created.json() as Result;
      expect(a).toMatchObject({ projectRevisionId: revision.id, status: 'READY', storageLocator: 'postgres-bytea', compilerVersion: 'scene-compiler-v1', validatorVersion: 'scene-validator-v1',
        manifest: { source: { projectId, revisionId: revision.id }, statistics: { objects: a.objectCount, triangles: a.triangleCount } } });
      const glb = await app.inject({ url: `${base}/artifacts/${a.id}/glb`, headers: owner });
      expect(glb.statusCode).toBe(200);
      expect(glb.headers).toMatchObject({ 'content-type': 'model/gltf-binary', 'cache-control': 'private, no-store', etag: `"${a.binarySha256}"`,
        'content-disposition': `attachment; filename="scene-${a.id}.glb"`, 'x-content-type-options': 'nosniff' });
      expect(createHash('sha256').update(glb.rawPayload).digest('hex')).toBe(a.binarySha256);
      const report = await validator.validateBytes(new Uint8Array(glb.rawPayload), { maxIssues: 10 });
      expect([report.issues.numErrors, report.issues.numWarnings]).toEqual([0, 0]);
      const manifest = await app.inject({ url: `${base}/artifacts/${a.id}/manifest`, headers: owner });
      expect([manifest.statusCode, manifest.headers['cache-control']]).toEqual([200, 'private, no-store']);
      expect(manifest.json()).toMatchObject({ artifactId: a.id, sceneHash: a.sceneHash, currency: { status: 'CURRENT' }, manifest: a.manifest });
      expect((await app.inject({ url: `${base}/artifacts/${a.id}`, headers: owner })).json()).toMatchObject({ id: a.id, currency: { status: 'CURRENT' } });
      expect((await app.inject({ url: `${base}/status`, headers: owner })).json()).toMatchObject({ sceneStatus: 'COMPILED', artifacts: [{ id: a.id }] });
    });

    it('is idempotent, converges identical compiles and never compiles on GET', async () => {
      const { app, owner, base } = fixture, key = { ...owner, 'idempotency-key': randomUUID() };
      const first = await app.inject({ method: 'POST', url: `${base}/artifacts`, headers: key, payload: {} });
      const replay = await app.inject({ method: 'POST', url: `${base}/artifacts`, headers: key, payload: {} });
      expect([first.statusCode, replay.statusCode]).toEqual([201, 201]);
      expect(replay.json().id).toBe(first.json().id);
      const conflict = await app.inject({ method: 'POST', url: `${base}/artifacts`, headers: key, payload: { other: true } });
      expect([409, 400]).toContain(conflict.statusCode);
      const again = await app.inject({ method: 'POST', url: `${base}/artifacts`, headers: owner, payload: {} });
      expect(again.json()).toMatchObject({ id: first.json().id, sceneHash: first.json().sceneHash, binarySha256: first.json().binarySha256 });
      for (let i = 0; i < 3; i++) await app.inject({ url: `${base}/artifacts/${first.json().id}/glb`, headers: owner });
      expect((await app.inject({ url: `${base}/artifacts`, headers: owner })).json().items).toHaveLength(1);
    });

    it('never serves another owner\'s scene, manifest or bytes', async () => {
      const { app, owner, other, base } = fixture, id = (await app.inject({ url: `${base}/artifacts`, headers: owner })).json().items[0].id;
      for (const suffix of ['', '/manifest', '/glb']) expect((await app.inject({ url: `${base}/artifacts/${id}${suffix}`, headers: other })).statusCode).toBe(404);
      expect((await app.inject({ url: `${base}/status`, headers: other })).statusCode).toBe(404);
    });

    it('keeps artifacts immutable and marks them STALE once the project moves to a new revision', async () => {
      const { app, owner, base, projectId, revision } = fixture, id = (await app.inject({ url: `${base}/artifacts`, headers: owner })).json().items[0].id;
      const b = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements: { ...parametricInput(true), seed: 'phase29-next' }, baseRevisionId: revision.id } });
      expect(b.statusCode, b.body.slice(0, 300)).toBe(201);
      expect((await app.inject({ url: `${base}/artifacts/${id}?require=current`, headers: owner })).json().error.code).toBe('SCENE_ARTIFACT_STALE');
      expect((await app.inject({ url: `${base}/artifacts/${id}/glb?require=current`, headers: owner })).statusCode).toBe(409);
      expect((await app.inject({ url: `${base}/artifacts/${id}`, headers: owner })).json()).toMatchObject({ currency: { status: 'STALE', artifactRevisionId: revision.id } });
      const nextBase = `/api/projects/${projectId}/revisions/${b.json().revision.id}/scene`;
      expect((await app.inject({ url: `${nextBase}/status`, headers: owner })).json()).toMatchObject({ sceneStatus: 'NOT_COMPILED', revisionCurrency: 'CURRENT',
        staleArtifacts: [{ id, staleReason: 'BOUND_TO_A_DIFFERENT_REVISION' }] });
    });
  });
}
