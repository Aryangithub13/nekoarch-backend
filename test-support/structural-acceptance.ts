import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ProjectTestContext } from './project-acceptance.js';
import { parametricInput } from './parametric-fixtures.js';
import { frameInput } from './structural-fixtures.js';

/** Phase 24 HTTP acceptance, shared by embedded PostgreSQL and the local Supabase stack. */
export function structuralAcceptance(context: () => ProjectTestContext) {
  describe('Phase 24 structural acceptance', () => {
    let fixture: Awaited<ReturnType<typeof setup>>;
    async function setup() {
      const { app, owner, other } = context();
      const project = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Phase 24 structural acceptance' } });
      expect(project.statusCode, project.body).toBe(201);
      const projectId = project.json().id;
      const a = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements: parametricInput(true) } });
      expect(a.statusCode, a.body).toBe(201);
      const revisionA = a.json().revision, baseA = `/api/projects/${projectId}/revisions/${revisionA.id}/structural`;
      return { app, owner, other, projectId, revisionA, baseA };
    }
    beforeAll(async () => { fixture = await setup(); });

    it('analyses revision A, then a real west-wing edit makes A stale for revision B without rewriting it', async () => {
      const { app, owner, projectId, revisionA, baseA } = fixture;
      const statusBefore = await app.inject({ url: `${baseA}/status`, headers: owner });
      expect(statusBefore.statusCode, statusBefore.body).toBe(200);
      expect(statusBefore.json()).toMatchObject({ structuralStatus: 'NOT_ANALYZED', requiresNewAnalysis: true, revisionCurrency: 'CURRENT', analyses: [], staleAnalyses: [] });
      const inputA = frameInput(revisionA.model);
      const validated = await app.inject({ method: 'POST', url: `${baseA}/validate`, headers: owner, payload: inputA });
      expect(validated.statusCode, validated.body).toBe(200);
      expect(validated.json()).toMatchObject({ readiness: 'ANALYSIS_READY', validation: { status: 'VALID' }, claims: { designVerification: 'NOT_EVALUATED', certification: 'NOT_CLAIMED' } });
      expect(validated.json().binding).toMatchObject({ projectId, revisionId: revisionA.id, modelHash: revisionA.identity.modelHash, bimVersion: 'bim-semantic-v1', structuralModelVersion: 'structural-model-v1' });
      // Validation never persists and never runs the solver.
      expect((await app.inject({ url: `${baseA}/analyses`, headers: owner })).json().items).toEqual([]);

      const created = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: owner, payload: inputA });
      expect(created.statusCode, created.body.slice(0, 500)).toBe(201);
      const analysisA = created.json();
      expect(analysisA).toMatchObject({ projectRevisionId: revisionA.id, status: 'VALIDATED', structuralModelVersion: 'structural-model-v1', analysisVersion: 'structural-analysis-v1',
        solver: { name: 'nekoarch-reference-frame-3d', version: '1.0.0', adapterVersion: 'structural-adapter-v1' }, modelHash: revisionA.identity.modelHash });
      expect(analysisA.snapshot).toMatchObject({ status: { analysis: 'ANALYZED', validation: 'VALIDATED' }, validation: { model: { status: 'VALID' }, results: { status: 'VALID' } },
        binding: { revisionId: revisionA.id, generationId: revisionA.identity.generationId, requirementsHash: revisionA.identity.requirementsHash } });
      expect(analysisA.snapshot.results.units).toEqual({ displacement: 'mm', rotation: 'rad', force: 'kN', moment: 'kN*m', position: 'fraction-of-segment-length' });
      expect(analysisA).not.toHaveProperty('currency');
      // Identical input converges on the same immutable artifact.
      const again = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: owner, payload: inputA });
      expect(again.statusCode, again.body.slice(0, 300)).toBe(201); expect(again.json().id).toBe(analysisA.id);
      const readA = await app.inject({ url: `${baseA}/analyses/${analysisA.id}`, headers: owner });
      expect(readA.statusCode).toBe(200); expect(readA.json().currency).toEqual({ status: 'CURRENT', analysisRevisionId: revisionA.id, projectCurrentRevisionId: revisionA.id });
      expect(readA.json().snapshot).toEqual(analysisA.snapshot);
      expect((await app.inject({ url: `${baseA}/analyses/${analysisA.id}?require=current`, headers: owner })).statusCode).toBe(200);

      const edited = parametricInput(true); edited.parametricArchitecture.floors[0]!.westWingWidthMm = 10000;
      const b = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements: edited, baseRevisionId: revisionA.id } });
      expect(b.statusCode, b.body).toBe(201);
      const revisionB = b.json().revision, baseB = `/api/projects/${projectId}/revisions/${revisionB.id}/structural`;
      expect(revisionB.identity.modelHash).not.toBe(revisionA.identity.modelHash);

      const historical = await app.inject({ url: `${baseA}/analyses/${analysisA.id}`, headers: owner });
      expect(historical.statusCode).toBe(200); expect(historical.json().snapshot).toEqual(analysisA.snapshot);
      expect(historical.json().currency).toEqual({ status: 'STALE', analysisRevisionId: revisionA.id, projectCurrentRevisionId: revisionB.id });
      const stale = await app.inject({ url: `${baseA}/analyses/${analysisA.id}?require=current`, headers: owner });
      expect(stale.statusCode).toBe(409); expect(stale.json().error.code).toBe('STRUCTURAL_RESULT_STALE');
      expect((await app.inject({ url: `${baseB}/analyses/${analysisA.id}`, headers: owner })).statusCode).toBe(404);
      const statusB = (await app.inject({ url: `${baseB}/status`, headers: owner })).json();
      expect(statusB).toMatchObject({ structuralStatus: 'NOT_ANALYZED', requiresNewAnalysis: true, revisionCurrency: 'CURRENT', analyses: [] });
      expect(statusB.staleAnalyses.map((s: { id: string }) => s.id)).toEqual([analysisA.id]);
      expect(statusB.staleAnalyses[0]).toMatchObject({ currency: { status: 'STALE' }, staleReason: 'BOUND_TO_A_DIFFERENT_REVISION', revisionNumber: revisionA.revisionNumber });

      // The old mapping no longer describes revision B; a new model and analysis are required.
      const createdB = await app.inject({ method: 'POST', url: `${baseB}/analyses`, headers: owner, payload: frameInput(revisionB.model) });
      expect(createdB.statusCode, createdB.body.slice(0, 300)).toBe(201);
      expect(createdB.json().id).not.toBe(analysisA.id); expect(createdB.json().snapshot.binding.revisionId).toBe(revisionB.id);
      expect((await app.inject({ url: `${baseB}/status`, headers: owner })).json()).toMatchObject({ structuralStatus: 'ANALYZED', requiresNewAnalysis: false });
      const statusA = (await app.inject({ url: `${baseA}/status`, headers: owner })).json();
      expect(statusA).toMatchObject({ revisionCurrency: 'HISTORICAL', structuralStatus: 'ANALYZED' });
      expect(statusA.analyses[0].currency.status).toBe('STALE'); expect(statusA.staleAnalyses.map((s: { id: string }) => s.id)).toEqual([createdB.json().id]);
      const list = await app.inject({ url: `${baseA}/analyses?limit=1`, headers: owner });
      expect(list.json().items.map((i: { id: string }) => i.id)).toEqual([analysisA.id]); expect(list.json().nextCursor).toBeNull();
    });

    it('enforces ownership, revision association and redacted structural error envelopes', async () => {
      const { app, owner, other, projectId, revisionA, baseA } = fixture;
      const input = frameInput(revisionA.model);
      const id = (await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: owner, payload: input })).json().id;
      for (const [method, suffix, payload] of [['GET', '/status', undefined], ['GET', '/analyses', undefined], ['GET', `/analyses/${id}`, undefined],
        ['POST', '/validate', input], ['POST', '/analyses', input]] as const) {
        const denied = await app.inject({ method, url: baseA + suffix, headers: other, ...(payload ? { payload } : {}) });
        expect(denied.statusCode, `${method} ${suffix}`).toBe(404); expect(denied.body).not.toContain(revisionA.id);
        expect((await app.inject({ method, url: baseA + suffix, ...(payload ? { payload } : {}) })).statusCode).toBe(401);
      }
      const second = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Phase 24 unrelated project' } });
      const foreign = `/api/projects/${second.json().id}/revisions/${revisionA.id}/structural`;
      expect((await app.inject({ url: `${foreign}/analyses/${id}`, headers: owner })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: `${foreign}/analyses`, headers: owner, payload: input })).statusCode).toBe(404);
      expect((await app.inject({ url: `${baseA}/analyses/${randomUUID()}`, headers: owner })).json().error.code).toBe('STRUCTURAL_ANALYSIS_NOT_FOUND');
      expect((await app.inject({ url: `/api/projects/${projectId}/revisions/${randomUUID()}/structural/status`, headers: owner })).statusCode).toBe(404);

      const area = frameInput(revisionA.model);
      area.loadCases[0]!.loads.push({ key: 'slab', application: 'AREA', target: { panel: 'slab-0' }, direction: 'GLOBAL_Y', magnitude: { value: -2, unit: 'kPa' } });
      const unsupported = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: owner, payload: area });
      expect(unsupported.statusCode).toBe(422); expect(unsupported.json().error).toMatchObject({ code: 'STRUCTURAL_SOURCE_UNSUPPORTED', requestId: unsupported.headers['x-request-id'] });
      const noDensity = frameInput(revisionA.model); noDensity.materials[0]!.density = null;
      expect((await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: owner, payload: noDensity })).json().error.code).toBe('STRUCTURAL_MATERIAL_MISSING');
      const nonfinite = await app.inject({ method: 'POST', url: `${baseA}/validate`, headers: { ...owner, 'content-type': 'application/json' },
        payload: JSON.stringify(input).replace('"value":30000', '"value":1e400') });
      expect(nonfinite.statusCode).toBe(400);
      let deep: unknown = 0; for (let i = 0; i < 64; i++) deep = [deep];
      const nested = await app.inject({ method: 'POST', url: `${baseA}/validate`, headers: owner, payload: { ...input, extra: deep } });
      expect(nested.statusCode).toBe(422); expect(nested.json().error.code).toBe('STRUCTURAL_RESOURCE_LIMIT');
      const oversized = await app.inject({ method: 'POST', url: `${baseA}/validate`, headers: owner, payload: { ...input, padding: 'x'.repeat(600_000) } });
      expect(oversized.statusCode).toBe(400);
      expect((await app.inject({ url: `${baseA}/analyses/${id}?require=yes`, headers: owner })).statusCode).toBe(400);
      expect((await app.inject({ url: `${baseA}/status?debug=1`, headers: owner })).statusCode).toBe(400);
      // Normal reads never trigger analysis.
      const before = (await app.inject({ url: `${baseA}/analyses?limit=100`, headers: owner })).json().items.length;
      await app.inject({ url: `${baseA}/status`, headers: owner }); await app.inject({ url: `${baseA}/analyses/${id}`, headers: owner });
      expect((await app.inject({ url: `${baseA}/analyses?limit=100`, headers: owner })).json().items.length).toBe(before);
    });

    it('replays idempotent analysis commands and rejects key reuse with a different input', async () => {
      const { app, owner, revisionA, baseA } = fixture;
      const key = randomUUID(), input = frameInput(revisionA.model, { lineLoadKnPerM: -7 });
      const first = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: { ...owner, 'idempotency-key': key }, payload: input });
      expect(first.statusCode, first.body.slice(0, 300)).toBe(201);
      const replay = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: { ...owner, 'idempotency-key': key }, payload: input });
      expect(replay.statusCode).toBe(201); expect(replay.json()).toEqual(first.json());
      const conflict = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: { ...owner, 'idempotency-key': key }, payload: frameInput(revisionA.model, { lineLoadKnPerM: -8 }) });
      expect(conflict.statusCode).toBe(409); expect(conflict.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    });
  });
}
