import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ProjectTestContext } from './project-acceptance.js';
import { environmentalInput } from './environmental-fixtures.js';
import { systemsInput, wetFrameInput, wetRequirements } from './systems-fixtures.js';

/** Phase 26 HTTP acceptance, shared by embedded PostgreSQL and the local Supabase stack. */
export function systemsAcceptance(context: () => ProjectTestContext) {
  describe('Phase 26 building-systems acceptance', () => {
    let fixture: Awaited<ReturnType<typeof setup>>;
    async function setup() {
      const { app, owner, other } = context();
      const project = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Phase 26 building-systems acceptance' } });
      expect(project.statusCode, project.body).toBe(201);
      const projectId = project.json().id;
      const a = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements: wetRequirements() } });
      expect(a.statusCode, a.body).toBe(201);
      const revisionA = a.json().revision, revisionUrl = `/api/projects/${projectId}/revisions/${revisionA.id}`, baseA = `${revisionUrl}/systems`;
      return { app, owner, other, projectId, revisionA, revisionUrl, baseA };
    }
    beforeAll(async () => { fixture = await setup(); });

    it('analyses revision A, converges and replays, keeps changed inputs distinct, and makes A stale (never reused) for revision B', async () => {
      const { app, owner, projectId, revisionA, baseA } = fixture;
      expect((await app.inject({ url: `${baseA}/status`, headers: owner })).json()).toMatchObject({ systemsStatus: 'NOT_ANALYZED', requiresNewAnalysis: true, revisionCurrency: 'CURRENT', analyses: [] });
      const input = systemsInput();
      const validated = await app.inject({ method: 'POST', url: `${baseA}/validate`, headers: owner, payload: input });
      expect(validated.statusCode, validated.body.slice(0, 400)).toBe(200);
      expect(validated.json()).toMatchObject({ readiness: 'ANALYSIS_READY', validation: { status: 'VALID' },
        capabilities: { plumbing: 'READY', electrical: 'READY', hvac: 'READY', lifeSafety: 'READY', verticalTransport: 'READY', structuralClearance: 'NOT_EVALUATED' },
        claims: { mepDesignComplete: 'NOT_CLAIMED', fireCodeCompliance: 'NOT_CLAIMED', elevatorCertification: 'NOT_CLAIMED' } });
      expect(validated.json().binding).toMatchObject({ projectId, revisionId: revisionA.id, modelHash: revisionA.identity.modelHash, bimVersion: 'bim-semantic-v1',
        systemsModelVersion: 'building-systems-model-v1', structural: null, environmental: null });
      expect((await app.inject({ url: `${baseA}/analyses`, headers: owner })).json().items).toEqual([]);

      const created = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: owner, payload: input });
      expect(created.statusCode, created.body.slice(0, 500)).toBe(201);
      const a = created.json();
      expect(a).toMatchObject({ projectRevisionId: revisionA.id, status: 'VALIDATED', systemsModelVersion: 'building-systems-model-v1', analysisVersion: 'building-systems-analysis-v1',
        calculator: { name: 'nekoarch-reference-systems', version: '1.0.0', adapterVersion: 'building-systems-adapter-v1' }, modelHash: revisionA.identity.modelHash,
        structuralAnalysisId: null, environmentalAnalysisId: null, counts: { networks: 8, elevators: 1 } });
      expect(a.snapshot).toMatchObject({ status: { analysis: 'ANALYZED', validation: 'VALIDATED' }, validation: { model: { status: 'VALID' }, results: { status: 'VALID' } },
        results: { plumbing: { status: 'ANALYZED', fixturesConnected: 6 }, electrical: { status: 'ANALYZED' }, hvac: { status: 'ANALYZED' }, lifeSafety: { status: 'ANALYZED', egressAvailable: true },
          verticalTransport: { status: 'ANALYZED' }, coordination: { structuralClearance: 'NOT_EVALUATED' }, quantities: { costing: 'NOT_EVALUATED' } } });
      expect(Object.values(a.snapshot.claims).every(v => v === 'NOT_CLAIMED')).toBe(true);
      expect((await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: owner, payload: input })).json().id).toBe(a.id);
      // A changed systems input (electrical loads) is a new immutable analysis; the first remains readable history of the same revision.
      const changed = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: owner, payload: systemsInput({ loadWatts: [1200, 500, 250] }) });
      expect(changed.statusCode).toBe(201); expect(changed.json().id).not.toBe(a.id); expect(changed.json().inputHash).not.toBe(a.inputHash);
      expect((await app.inject({ url: `${baseA}/analyses/${a.id}`, headers: owner })).json().snapshot).toEqual(a.snapshot);

      const edited = wetRequirements(); edited.parametricArchitecture.floors[0]!.westWingWidthMm = 10000;
      const b = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements: edited, baseRevisionId: revisionA.id } });
      expect(b.statusCode, b.body).toBe(201);
      const revisionB = b.json().revision, baseB = `/api/projects/${projectId}/revisions/${revisionB.id}/systems`;
      expect((await app.inject({ url: `${baseA}/analyses/${a.id}`, headers: owner })).json().currency).toEqual({ status: 'STALE', analysisRevisionId: revisionA.id, projectCurrentRevisionId: revisionB.id });
      const stale = await app.inject({ url: `${baseA}/analyses/${a.id}?require=current`, headers: owner });
      expect(stale.statusCode).toBe(409); expect(stale.json().error.code).toBe('SYSTEMS_RESULT_STALE');
      expect((await app.inject({ url: `${baseB}/analyses/${a.id}`, headers: owner })).statusCode).toBe(404);
      const statusB = (await app.inject({ url: `${baseB}/status`, headers: owner })).json();
      expect(statusB).toMatchObject({ systemsStatus: 'NOT_ANALYZED', requiresNewAnalysis: true, revisionCurrency: 'CURRENT', analyses: [] });
      expect(statusB.staleAnalyses.map((s: { id: string }) => s.id).sort()).toEqual([a.id, changed.json().id].sort());
      expect(statusB.staleAnalyses[0]).toMatchObject({ currency: { status: 'STALE' }, staleReason: 'BOUND_TO_A_DIFFERENT_REVISION' });
      const lifeOnly = { version: 'building-systems-input-v1', lifeSafety: { exits: { mode: 'SITE_PRIMARY_ENTRY' } } };
      const createdB = await app.inject({ method: 'POST', url: `${baseB}/analyses`, headers: owner, payload: lifeOnly });
      expect(createdB.statusCode, createdB.body.slice(0, 300)).toBe(201);
      expect(createdB.json().snapshot.binding.revisionId).toBe(revisionB.id); expect(createdB.json().id).not.toBe(a.id);
      expect((await app.inject({ url: `${baseA}/status`, headers: owner })).json()).toMatchObject({ revisionCurrency: 'HISTORICAL', systemsStatus: 'ANALYZED' });
    });

    it('binds explicit structural and environmental analyses of the same revision and refuses another revision\'s artifacts', async () => {
      const { app, owner, revisionUrl, baseA } = fixture;
      const structural = await app.inject({ method: 'POST', url: `${revisionUrl}/structural/analyses`, headers: owner, payload: wetFrameInput() });
      expect(structural.statusCode, structural.body.slice(0, 300)).toBe(201);
      const environmental = await app.inject({ method: 'POST', url: `${revisionUrl}/environmental/analyses`, headers: owner, payload: environmentalInput() });
      expect(environmental.statusCode, environmental.body.slice(0, 300)).toBe(201);
      const input = systemsInput({ structuralAnalysisId: structural.json().id, environmentalAnalysisId: environmental.json().id });
      expect((await app.inject({ method: 'POST', url: `${baseA}/validate`, headers: owner, payload: input })).json().capabilities.structuralClearance).toBe('READY');
      const created = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: owner, payload: input });
      expect(created.statusCode, created.body.slice(0, 500)).toBe(201);
      const s = created.json();
      expect(s).toMatchObject({ structuralAnalysisId: structural.json().id, environmentalAnalysisId: environmental.json().id });
      expect(s.snapshot.binding.structural).toEqual({ analysisId: structural.json().id, inputHash: structural.json().inputHash, modelVersion: 'structural-model-v1' });
      expect(s.snapshot.results.coordination.structuralClearance).toBe('EVALUATED');
      expect(s.snapshot.results.hvac.referenceInputs.environmental).toMatchObject({ analysisId: environmental.json().id, role: 'ENVELOPE_TRANSMISSION_COMPONENT', isDesignLoad: false });
      // Upstream identity is explicit: another project's or an unknown analysis is not found through this revision.
      const other = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Phase 26 foreign upstream' } });
      const rev = await app.inject({ method: 'POST', url: `/api/projects/${other.json().id}/revisions/generate`, headers: owner, payload: { requirements: wetRequirements() } });
      const foreign = await app.inject({ method: 'POST', url: `/api/projects/${other.json().id}/revisions/${rev.json().revision.id}/structural/analyses`, headers: owner, payload: wetFrameInput() });
      expect(foreign.statusCode).toBe(201);
      for (const sources of [{ structuralAnalysisId: foreign.json().id }, { structuralAnalysisId: randomUUID() }, { environmentalAnalysisId: randomUUID() }]) {
        const r = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: owner, payload: { ...input, sources: { structuralAnalysisId: null, environmentalAnalysisId: null, ...sources } } });
        expect(r.statusCode, JSON.stringify(sources)).toBe(404);
      }
    });

    it('enforces ownership and revision association, reports typed errors and never computes on reads', async () => {
      const { app, owner, other, revisionA, baseA } = fixture;
      const input = systemsInput({ loadWatts: [800, 500, 250] });
      const id = (await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: owner, payload: input })).json().id;
      for (const [method, suffix, payload] of [['GET', '/status', undefined], ['GET', '/analyses', undefined], ['GET', `/analyses/${id}`, undefined],
        ['POST', '/validate', input], ['POST', '/analyses', input]] as const) {
        const denied = await app.inject({ method, url: baseA + suffix, headers: other, ...(payload ? { payload } : {}) });
        expect(denied.statusCode, `${method} ${suffix}`).toBe(404); expect(denied.body).not.toContain(revisionA.id);
        expect((await app.inject({ method, url: baseA + suffix, ...(payload ? { payload } : {}) })).statusCode).toBe(401);
      }
      const second = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Phase 26 unrelated project' } });
      const foreign = `/api/projects/${second.json().id}/revisions/${revisionA.id}/systems`;
      expect((await app.inject({ url: `${foreign}/analyses/${id}`, headers: owner })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: `${foreign}/analyses`, headers: owner, payload: input })).statusCode).toBe(404);
      expect((await app.inject({ url: `${baseA}/analyses/${randomUUID()}`, headers: owner })).json().error.code).toBe('SYSTEMS_ANALYSIS_NOT_FOUND');
      const window = systemsInput(); window.lifeSafety = { exits: { mode: 'EXPLICIT', openingIds: ['window-wall-level-0-3550-18900-9900-18900-2575-1200'] }, obstructedOpeningIds: [] };
      const outside = systemsInput(); outside.electrical!.loads[0]!.point = { x: 100, z: 100 };
      for (const [name, payload] of [['window as exit', window], ['terminal outside its space', outside]] as const) for (const suffix of ['/validate', '/analyses']) {
        const r = await app.inject({ method: 'POST', url: baseA + suffix, headers: owner, payload });
        expect(r.statusCode, `${name} ${suffix}`).toBe(422); expect(r.json().error).toMatchObject({ code: 'BUILDING_SYSTEMS_MODEL_INVALID', requestId: r.headers['x-request-id'] });
      }
      expect((await app.inject({ method: 'POST', url: `${baseA}/validate`, headers: owner, payload: { ...input, electrical: { ...input.electrical, voltage: 230 } } })).statusCode).toBe(400);
      let deep: unknown = 0; for (let i = 0; i < 64; i++) deep = [deep];
      const nested = await app.inject({ method: 'POST', url: `${baseA}/validate`, headers: owner, payload: { ...input, extra: deep } });
      expect(nested.statusCode).toBe(422); expect(nested.json().error.code).toBe('BUILDING_SYSTEMS_RESOURCE_LIMIT');
      expect((await app.inject({ method: 'POST', url: `${baseA}/validate`, headers: owner, payload: { ...input, padding: 'x'.repeat(1_100_000) } })).statusCode).toBe(400);
      expect((await app.inject({ url: `${baseA}/analyses/${id}?require=yes`, headers: owner })).statusCode).toBe(400);
      expect((await app.inject({ url: `${baseA}/status?debug=1`, headers: owner })).statusCode).toBe(400);
      const before = (await app.inject({ url: `${baseA}/analyses?limit=100`, headers: owner })).json().items.length;
      await app.inject({ url: `${baseA}/status`, headers: owner }); await app.inject({ url: `${baseA}/analyses/${id}`, headers: owner });
      expect((await app.inject({ url: `${baseA}/analyses?limit=100`, headers: owner })).json().items.length).toBe(before);
    });

    it('replays idempotent analysis commands and rejects key reuse with a different input', async () => {
      const { app, owner, baseA } = fixture;
      const key = randomUUID(), input = systemsInput({ loadWatts: [700, 500, 250] });
      const first = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: { ...owner, 'idempotency-key': key }, payload: input });
      expect(first.statusCode, first.body.slice(0, 300)).toBe(201);
      const replay = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: { ...owner, 'idempotency-key': key }, payload: input });
      expect(replay.statusCode).toBe(201); expect(replay.json()).toEqual(first.json());
      const conflict = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: { ...owner, 'idempotency-key': key }, payload: systemsInput({ loadWatts: [701, 500, 250] }) });
      expect(conflict.statusCode).toBe(409); expect(conflict.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    });
  });
}
