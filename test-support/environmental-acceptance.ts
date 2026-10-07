import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ProjectTestContext } from './project-acceptance.js';
import { parametricInput } from './parametric-fixtures.js';
import { TEST_LOCATION, environmentalInput, syntheticWeather } from './environmental-fixtures.js';

/** Phase 25 HTTP acceptance, shared by embedded PostgreSQL and the local Supabase stack. */
export function environmentalAcceptance(context: () => ProjectTestContext) {
  describe('Phase 25 environmental acceptance', () => {
    let fixture: Awaited<ReturnType<typeof setup>>;
    async function setup() {
      const { app, owner, other } = context();
      const project = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Phase 25 environmental acceptance' } });
      expect(project.statusCode, project.body).toBe(201);
      const projectId = project.json().id;
      const a = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements: parametricInput(true) } });
      expect(a.statusCode, a.body).toBe(201);
      const revisionA = a.json().revision, baseA = `/api/projects/${projectId}/revisions/${revisionA.id}/environmental`;
      return { app, owner, other, projectId, revisionA, baseA };
    }
    beforeAll(async () => { fixture = await setup(); });

    it('analyses revision A; an environmental-input change is a new row; a west-wing edit makes A stale for revision B', async () => {
      const { app, owner, projectId, revisionA, baseA } = fixture;
      const status0 = await app.inject({ url: `${baseA}/status`, headers: owner });
      expect(status0.statusCode, status0.body).toBe(200);
      expect(status0.json()).toMatchObject({ environmentalStatus: 'NOT_ANALYZED', requiresNewAnalysis: true, revisionCurrency: 'CURRENT', analyses: [], staleAnalyses: [] });
      const input = environmentalInput();
      const validated = await app.inject({ method: 'POST', url: `${baseA}/validate`, headers: owner, payload: input });
      expect(validated.statusCode, validated.body.slice(0, 400)).toBe(200);
      expect(validated.json()).toMatchObject({ readiness: 'ANALYSIS_READY', capabilities: { solar: 'READY', exposure: 'READY', thermal: 'READY' }, validation: { status: 'VALID' },
        claims: { energyEfficiency: 'NOT_CLAIMED', codeCompliance: 'NOT_CLAIMED', certification: 'NOT_CLAIMED' } });
      expect(validated.json().binding).toMatchObject({ projectId, revisionId: revisionA.id, modelHash: revisionA.identity.modelHash, bimVersion: 'bim-semantic-v1', environmentalModelVersion: 'environmental-model-v1' });
      expect((await app.inject({ url: `${baseA}/analyses`, headers: owner })).json().items).toEqual([]);

      const created = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: owner, payload: input });
      expect(created.statusCode, created.body.slice(0, 500)).toBe(201);
      const a = created.json();
      expect(a).toMatchObject({ projectRevisionId: revisionA.id, status: 'VALIDATED', environmentalModelVersion: 'environmental-model-v1', analysisVersion: 'environmental-analysis-v1',
        calculator: { name: 'nekoarch-reference-environmental', version: '1.0.0', adapterVersion: 'environmental-adapter-v1' }, modelHash: revisionA.identity.modelHash });
      expect(a.counts).toMatchObject({ solarInstants: 3, thermalCases: 1 });
      expect(a.snapshot).toMatchObject({ status: { analysis: 'ANALYZED', validation: 'VALIDATED' }, validation: { model: { status: 'VALID' }, results: { status: 'VALID' } },
        results: { thermal: { status: 'ANALYZED' }, solar: { status: 'ANALYZED' }, exposure: { status: 'ANALYZED' }, daylightIndicator: { isDaylightMetric: false } } });
      expect((await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: owner, payload: input })).json().id).toBe(a.id);
      // A changed environmental input is a different analysis; the first stays readable history of the same revision.
      const warmer = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: owner, payload: environmentalInput({ outsideC: 5 }) });
      expect(warmer.statusCode).toBe(201); expect(warmer.json().id).not.toBe(a.id); expect(warmer.json().inputHash).not.toBe(a.inputHash);
      expect((await app.inject({ url: `${baseA}/analyses/${a.id}`, headers: owner })).json().snapshot).toEqual(a.snapshot);

      const edited = parametricInput(true); edited.parametricArchitecture.floors[0]!.westWingWidthMm = 10000;
      const b = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements: edited, baseRevisionId: revisionA.id } });
      expect(b.statusCode, b.body).toBe(201);
      const revisionB = b.json().revision, baseB = `/api/projects/${projectId}/revisions/${revisionB.id}/environmental`;
      const historical = await app.inject({ url: `${baseA}/analyses/${a.id}`, headers: owner });
      expect(historical.json().currency).toEqual({ status: 'STALE', analysisRevisionId: revisionA.id, projectCurrentRevisionId: revisionB.id });
      const stale = await app.inject({ url: `${baseA}/analyses/${a.id}?require=current`, headers: owner });
      expect(stale.statusCode).toBe(409); expect(stale.json().error.code).toBe('ENVIRONMENTAL_RESULT_STALE');
      expect((await app.inject({ url: `${baseB}/analyses/${a.id}`, headers: owner })).statusCode).toBe(404);
      const statusB = (await app.inject({ url: `${baseB}/status`, headers: owner })).json();
      expect(statusB).toMatchObject({ environmentalStatus: 'NOT_ANALYZED', requiresNewAnalysis: true, revisionCurrency: 'CURRENT', analyses: [] });
      expect(statusB.staleAnalyses.map((s: { id: string }) => s.id).sort()).toEqual([a.id, warmer.json().id].sort());
      expect(statusB.staleAnalyses[0]).toMatchObject({ currency: { status: 'STALE' }, staleReason: 'BOUND_TO_A_DIFFERENT_REVISION' });
      const createdB = await app.inject({ method: 'POST', url: `${baseB}/analyses`, headers: owner, payload: input });
      expect(createdB.statusCode, createdB.body.slice(0, 300)).toBe(201);
      expect(createdB.json().id).not.toBe(a.id); expect(createdB.json().snapshot.binding.revisionId).toBe(revisionB.id); expect(createdB.json().inputHash).not.toBe(a.inputHash);
      expect((await app.inject({ url: `${baseA}/status`, headers: owner })).json()).toMatchObject({ revisionCurrency: 'HISTORICAL', environmentalStatus: 'ANALYZED' });
    });

    it('enforces ownership and revision association, reports typed errors and never computes on reads', async () => {
      const { app, owner, other, projectId, revisionA, baseA } = fixture;
      const input = environmentalInput({ outsideC: -3 });
      const id = (await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: owner, payload: input })).json().id;
      for (const [method, suffix, payload] of [['GET', '/status', undefined], ['GET', '/analyses', undefined], ['GET', `/analyses/${id}`, undefined],
        ['POST', '/validate', input], ['POST', '/analyses', input]] as const) {
        const denied = await app.inject({ method, url: baseA + suffix, headers: other, ...(payload ? { payload } : {}) });
        expect(denied.statusCode, `${method} ${suffix}`).toBe(404); expect(denied.body).not.toContain(revisionA.id);
        expect((await app.inject({ method, url: baseA + suffix, ...(payload ? { payload } : {}) })).statusCode).toBe(401);
      }
      const second = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Phase 25 unrelated project' } });
      const foreign = `/api/projects/${second.json().id}/revisions/${revisionA.id}/environmental`;
      expect((await app.inject({ url: `${foreign}/analyses/${id}`, headers: owner })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: `${foreign}/analyses`, headers: owner, payload: input })).statusCode).toBe(404);
      expect((await app.inject({ url: `${baseA}/analyses/${randomUUID()}`, headers: owner })).json().error.code).toBe('ENVIRONMENTAL_ANALYSIS_NOT_FOUND');
      expect((await app.inject({ url: `/api/projects/${projectId}/revisions/${randomUUID()}/environmental/status`, headers: owner })).statusCode).toBe(404);
      const typed: [string, Record<string, unknown>, string][] = [
        ['latitude out of range', { ...input, location: { ...TEST_LOCATION, latitude: { value: 95, unit: 'deg' } } }, 'ENVIRONMENTAL_LOCATION_INVALID'],
        ['unknown time zone', { ...input, location: { ...TEST_LOCATION, timezone: 'Nowhere/Here' } }, 'ENVIRONMENTAL_LOCATION_INVALID'],
        ['unknown construction', { ...input, assignments: { ROOF: 'nope' } }, 'ENVIRONMENTAL_PROPERTY_MISSING'],
        ['weather checksum', { ...input, weather: { ...syntheticWeather(Date.parse('2026-01-01T00:00:00Z'), 3, () => ({ dryBulb: 5, dni: 0 })), sha256: '0'.repeat(64) } }, 'ENVIRONMENTAL_WEATHER_INVALID'],
      ];
      for (const [name, payload, code] of typed) for (const suffix of ['/validate', '/analyses']) {
        const r = await app.inject({ method: 'POST', url: baseA + suffix, headers: owner, payload });
        expect(r.statusCode, `${name} ${suffix}`).toBe(422); expect(r.json().error).toMatchObject({ code, requestId: r.headers['x-request-id'] });
      }
      const kelvin = await app.inject({ method: 'POST', url: `${baseA}/validate`, headers: owner, payload: { ...input, thermalCases: [{ ...input.thermalCases[0], inside: { value: 294.15, unit: 'K' } }] } });
      expect(kelvin.statusCode).toBe(400);
      let deep: unknown = 0; for (let i = 0; i < 64; i++) deep = [deep];
      const nested = await app.inject({ method: 'POST', url: `${baseA}/validate`, headers: owner, payload: { ...input, extra: deep } });
      expect(nested.statusCode).toBe(422); expect(nested.json().error.code).toBe('ENVIRONMENTAL_RESOURCE_LIMIT');
      expect((await app.inject({ method: 'POST', url: `${baseA}/validate`, headers: owner, payload: { ...input, padding: 'x'.repeat(2_200_000) } })).statusCode).toBe(400);
      expect((await app.inject({ url: `${baseA}/analyses/${id}?require=yes`, headers: owner })).statusCode).toBe(400);
      expect((await app.inject({ url: `${baseA}/status?debug=1`, headers: owner })).statusCode).toBe(400);
      const before = (await app.inject({ url: `${baseA}/analyses?limit=100`, headers: owner })).json().items.length;
      await app.inject({ url: `${baseA}/status`, headers: owner }); await app.inject({ url: `${baseA}/analyses/${id}`, headers: owner });
      expect((await app.inject({ url: `${baseA}/analyses?limit=100`, headers: owner })).json().items.length).toBe(before);
    });

    it('replays idempotent analysis commands and rejects key reuse with a different input', async () => {
      const { app, owner, baseA } = fixture;
      const key = randomUUID(), input = environmentalInput({ outsideC: -7 });
      const first = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: { ...owner, 'idempotency-key': key }, payload: input });
      expect(first.statusCode, first.body.slice(0, 300)).toBe(201);
      const replay = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: { ...owner, 'idempotency-key': key }, payload: input });
      expect(replay.statusCode).toBe(201); expect(replay.json()).toEqual(first.json());
      const conflict = await app.inject({ method: 'POST', url: `${baseA}/analyses`, headers: { ...owner, 'idempotency-key': key }, payload: environmentalInput({ outsideC: -8 }) });
      expect(conflict.statusCode).toBe(409); expect(conflict.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    });
  });
}
