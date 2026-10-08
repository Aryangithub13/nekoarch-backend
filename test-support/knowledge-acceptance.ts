import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ProjectTestContext } from './project-acceptance.js';
import { environmentalInput } from './environmental-fixtures.js';
import { systemsInput, wetFrameInput, wetRequirements } from './systems-fixtures.js';
import { CLAIMS, DISCIPLINES } from '../apps/api/src/knowledge/contracts.js';

const PACKS = [{ packId: 'nekoarch-demo-dimensional', version: '1.0.0' }, { packId: 'nekoarch-demo-coordination', version: '1.0.0' }];
const G1_BY_STATUS = { CONFLICTING_RULES: 10, DOES_NOT_MEET_RULE: 8, INPUT_INCOMPLETE: 4, MEETS_RULE: 26, NOT_APPLICABLE: 10, NOT_EVALUATED: 0, REVIEW_REQUIRED: 2, UNSUPPORTED: 2 };
type Sources = { structuralAnalysisId: string | null; environmentalAnalysisId: string | null; systemsAnalysisId: string | null };
export const knowledgeInput = (sources: Partial<Sources>, disciplines: readonly string[] = DISCIPLINES, packs = PACKS) => ({ version: 'specialized-knowledge-input-v1', packs,
  sources: { structuralAnalysisId: null, environmentalAnalysisId: null, systemsAnalysisId: null, ...sources }, scope: { disciplines } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Result = Record<string, any>;
const of = (snapshot: Result, ruleId: string) => (snapshot.results as Result[]).filter(r => r.ruleId === ruleId);

/** Phase 27 HTTP acceptance (golden scenarios G1–G8), shared by embedded PostgreSQL and the local Supabase stack. */
export function knowledgeAcceptance(context: () => ProjectTestContext) {
  describe('Phase 27 specialized-knowledge acceptance', () => {
    let fixture: Awaited<ReturnType<typeof setup>>;
    async function setup() {
      const { app, owner, other } = context();
      const project = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Phase 27 knowledge acceptance' } });
      expect(project.statusCode, project.body).toBe(201);
      const projectId = project.json().id as string;
      const a = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements: wetRequirements() } });
      expect(a.statusCode, a.body).toBe(201);
      const revisionA = a.json().revision, revisionUrl = `/api/projects/${projectId}/revisions/${revisionA.id}`, base = `${revisionUrl}/knowledge`;
      const post = async (path: string, payload: object) => {
        const r = await app.inject({ method: 'POST', url: `${revisionUrl}/${path}/analyses`, headers: owner, payload });
        expect(r.statusCode, r.body.slice(0, 400)).toBe(201);
        return r.json() as Result;
      };
      const S = await post('structural', wetFrameInput()), E = await post('environmental', environmentalInput()), Y = await post('systems', systemsInput());
      const sources = { structuralAnalysisId: S.id as string, environmentalAnalysisId: E.id as string, systemsAnalysisId: Y.id as string };
      return { app, owner, other, projectId, revisionA, revisionUrl, base, post, S, E, Y, sources };
    }
    beforeAll(async () => { fixture = await setup(); });

    it('G1: catalog, validation and the golden evaluation over real Phase 23–26 artifacts; replay converges', async () => {
      const { app, owner, base, sources, revisionA, S, E, Y } = fixture;
      const catalog = (await app.inject({ url: `${base}/packs`, headers: owner })).json();
      expect(catalog.packs.map((p: Result) => [p.packId, p.version, p.ruleCount, p.license.spdx, p.jurisdiction, p.sourceType])).toEqual([
        ['nekoarch-demo-coordination', '1.0.0', 15, 'CC0-1.0', null, 'SYNTHETIC_DEMONSTRATION'], ['nekoarch-demo-dimensional', '1.0.0', 15, 'CC0-1.0', null, 'SYNTHETIC_DEMONSTRATION']]);
      expect(JSON.stringify(catalog)).not.toContain('requirement');
      const input = knowledgeInput(sources);
      const validated = await app.inject({ method: 'POST', url: `${base}/validate`, headers: owner, payload: input });
      expect(validated.statusCode, validated.body.slice(0, 400)).toBe(200);
      expect(validated.json()).toMatchObject({ readiness: 'EVALUATION_READY', validation: { status: 'VALID' }, conflicts: 1, claims: CLAIMS });
      expect(validated.json().rules.filter((r: Result) => r.predicted === 'UNSUPPORTED').map((r: Result) => r.ruleId)).toEqual(['b09-cost-cap', 'b11-utilisation-max']);
      expect((await app.inject({ url: `${base}/analyses`, headers: owner })).json().items).toEqual([]);

      const created = await app.inject({ method: 'POST', url: `${base}/analyses`, headers: owner, payload: input });
      expect(created.statusCode, created.body.slice(0, 600)).toBe(201);
      const a = created.json(), snap = a.snapshot;
      expect(a).toMatchObject({ projectRevisionId: revisionA.id, status: 'VALIDATED', structuralAnalysisId: S.id, environmentalAnalysisId: E.id, systemsAnalysisId: Y.id,
        evaluator: { name: 'nekoarch-knowledge-evaluator', version: '1.0.0' }, modelHash: revisionA.identity.modelHash, counts: { results: 62, conflicts: 1, meets: 26, doesNotMeet: 8 } });
      expect(snap.binding).toMatchObject({ revisionId: revisionA.id, structural: { analysisId: S.id, inputHash: S.inputHash }, environmental: { analysisId: E.id },
        systems: { analysisId: Y.id, modelVersion: 'building-systems-model-v1' } });
      expect(snap.summary).toEqual({ rulesSelected: 30, results: 62, byStatus: G1_BY_STATUS, conflicts: 1, rulesConflictNotEvaluated: 7 });
      expect(snap.validation).toMatchObject({ model: { status: 'VALID' }, results: { status: 'VALID', recomputed: { results: 62, conflicts: 1 } } });
      expect(snap.claims).toEqual(CLAIMS);
      // Meaningful evaluations from real facts (approved acceptance item 10).
      const decided = (snap.results as Result[]).filter(r => ['MEETS_RULE', 'DOES_NOT_MEET_RULE'].includes(r.status));
      expect(decided.length).toBeGreaterThanOrEqual(25);
      expect(new Set(decided.map(r => r.discipline))).toEqual(new Set(['ARCHITECTURE', 'LIFE_SAFETY', 'VERTICAL_TRANSPORT', 'ENVIRONMENTAL', 'MEP', 'STRUCTURAL', 'QUANTITY']));
      // Phase 25 sums surface heat flows in semantic-id order, and those ids depend on the projectId: the stored total is 6644.34, 6644.339999999998,
      // 6644.340000000002, … depending on the project. That is pure binary64 noise; the §10.1 policy returns REVIEW_REQUIRED for every one.
      const b04 = of(snap, 'b04-transmission-max')[0]!;
      expect(b04).toMatchObject({ status: 'REVIEW_REQUIRED', reason: 'FLOAT_BOUNDARY_AMBIGUITY', precision: 'UPSTREAM_FLOAT',
        trace: { observed: { unit: 'W' }, threshold: { normalized: '6644.34' }, basis: { ulps: '16' } } });
      // Whatever the summation order, the stored value differs from the threshold only by representation noise inside the band.
      expect(Math.abs(Number(b04.trace.observed.value) - 6644.34)).toBeLessThan(1e-9);
      expect(Number(b04.trace.basis.diff)).toBeLessThanOrEqual(Number(b04.trace.basis.band));
      expect(b04.trace.basis.band).toBe('0.000000000014551915228366851806640625');
      expect(of(snap, 'b03-wfr-exact-min')[0]).toMatchObject({ status: 'MEETS_RULE', trace: { comparison: '32/645 >= 0.0496' } });
      expect(of(snap, 'a08-window-sill-min').every(r => r.status === 'CONFLICTING_RULES' && r.isolatedStatus === 'MEETS_RULE')).toBe(true);
      expect(snap.conflicts[0]).toMatchObject({ rules: ['nekoarch-demo-coordination/b01-window-sill-max', 'nekoarch-demo-dimensional/a08-window-sill-min'], factType: 'ARCH_OPENING_SILL' });
      const egress = of(snap, 'a09-egress-distance-max')[0]!;
      expect(egress.evidence[0]).toMatchObject({ artifactType: 'SYSTEMS_ANALYSIS', artifactId: Y.id });
      // G4: identical input converges on the same immutable analysis.
      const replay = await app.inject({ method: 'POST', url: `${base}/analyses`, headers: owner, payload: input });
      expect(replay.statusCode).toBe(201); expect(replay.json().id).toBe(a.id); expect(replay.json().snapshot).toEqual(snap);
      expect((await app.inject({ url: `${base}/analyses/${a.id}?require=current`, headers: owner })).json()).toMatchObject({ id: a.id, currency: { status: 'CURRENT' } });
      expect((await app.inject({ url: `${base}/status`, headers: owner })).json()).toMatchObject({ knowledgeStatus: 'EVALUATED', revisionCurrency: 'CURRENT', claims: CLAIMS });
    });

    it('G2/G3: an unbound source is NOT_EVALUATED (never a pass) and the discipline scope selects rules', async () => {
      const { app, owner, base, sources } = fixture;
      const g2 = await app.inject({ method: 'POST', url: `${base}/analyses`, headers: owner, payload: knowledgeInput({ ...sources, environmentalAnalysisId: null }) });
      expect(g2.statusCode, g2.body.slice(0, 400)).toBe(201);
      const s2 = g2.json().snapshot;
      for (const id of ['b02-wfr-indicator-min', 'b04-transmission-max', 'b13-envelope-closed']) expect(of(s2, id)).toMatchObject([{ status: 'NOT_EVALUATED', reason: 'SOURCE_NOT_BOUND', subject: null }]);
      expect(of(s2, 'b03-wfr-exact-min')[0]!.status).toBe('MEETS_RULE');
      expect(s2.missingInputs[0]).toMatchObject({ kind: 'SOURCE', source: 'ENVIRONMENTAL' });
      expect(s2.binding.environmental).toBeNull();
      const g3 = await app.inject({ method: 'POST', url: `${base}/analyses`, headers: owner, payload: knowledgeInput(sources, ['ARCHITECTURE']) });
      expect(g3.statusCode).toBe(201);
      const s3 = g3.json().snapshot;
      expect(new Set((s3.results as Result[]).map(r => r.ruleId))).toEqual(new Set(['a01-door-width-min', 'a02-stair-width-min', 'a03-riser-max', 'a04-tread-min', 'a05-headroom-min',
        'a06-bedroom-area-min', 'a07-garage-area-min', 'a08-window-sill-min', 'a14-stair-all', 'a15-stair-any', 'a16-headroom-below-2500', 'b01-window-sill-max', 'b15-bathroom-count-min']));
      expect(s3.conflicts).toHaveLength(1);
      expect(g3.json().inputHash).not.toBe(g2.json().inputHash);
    });

    it('G6–G8: never "latest", other revisions/projects are 404, inconsistent nested upstream and unknown packs are 422', async () => {
      const { app, owner, base, revisionUrl, sources, post } = fixture;
      const other = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Phase 27 foreign upstream' } });
      const rev = await app.inject({ method: 'POST', url: `/api/projects/${other.json().id}/revisions/generate`, headers: owner, payload: { requirements: wetRequirements() } });
      const foreign = await app.inject({ method: 'POST', url: `/api/projects/${other.json().id}/revisions/${rev.json().revision.id}/systems/analyses`, headers: owner, payload: systemsInput() });
      expect(foreign.statusCode).toBe(201);
      for (const s of [{ systemsAnalysisId: foreign.json().id }, { systemsAnalysisId: randomUUID() }, { structuralAnalysisId: randomUUID() }, { environmentalAnalysisId: randomUUID() }]) {
        const r = await app.inject({ method: 'POST', url: `${base}/analyses`, headers: owner, payload: knowledgeInput({ ...sources, ...s }) });
        expect(r.statusCode, JSON.stringify(s)).toBe(404);
      }
      // G7: a systems analysis built on structural S′ cannot be combined with an explicitly bound structural S.
      const frame = wetFrameInput(), beam = frame.sections[1]!;
      if (beam.shape === 'RECTANGLE') beam.depth = { value: 650, unit: 'mm' };
      const S2 = await post('structural', frame);
      const Y2 = await post('systems', systemsInput({ structuralAnalysisId: S2.id }));
      for (const suffix of ['/validate', '/analyses']) {
        const r = await app.inject({ method: 'POST', url: base + suffix, headers: owner, payload: knowledgeInput({ ...sources, systemsAnalysisId: Y2.id }) });
        expect(r.statusCode, suffix).toBe(422);
        expect(r.json().error).toMatchObject({ code: 'TRANSITIVE_UPSTREAM_BINDING_INCONSISTENT', requestId: r.headers['x-request-id'] });
      }
      const consistent = await app.inject({ method: 'POST', url: `${base}/analyses`, headers: owner, payload: knowledgeInput({ ...sources, structuralAnalysisId: S2.id, systemsAnalysisId: Y2.id }) });
      expect(consistent.statusCode, consistent.body.slice(0, 300)).toBe(201);
      expect(of(consistent.json().snapshot, 'b10-beam-depth-min')[0]!.trace.observed.value).toBe('650');
      const unknown = await app.inject({ method: 'POST', url: `${base}/analyses`, headers: owner,
        payload: knowledgeInput(sources, DISCIPLINES, [{ packId: 'nekoarch-demo-dimensional', version: '9.9.9' }]) });
      expect(unknown.statusCode).toBe(422); expect(unknown.json().error.code).toBe('KNOWLEDGE_PACK_UNKNOWN');
      expect(revisionUrl).toContain('/revisions/');
    });

    it('enforces ownership, typed errors and resource limits, and never computes on reads', async () => {
      const { app, owner, other, base, sources, revisionA } = fixture;
      const input = knowledgeInput(sources, ['ARCHITECTURE', 'MEP']);
      const id = (await app.inject({ method: 'POST', url: `${base}/analyses`, headers: owner, payload: input })).json().id;
      for (const [method, suffix, payload] of [['GET', '/packs', undefined], ['GET', '/status', undefined], ['GET', '/analyses', undefined], ['GET', `/analyses/${id}`, undefined],
        ['POST', '/validate', input], ['POST', '/analyses', input]] as const) {
        const denied = await app.inject({ method, url: base + suffix, headers: other, ...(payload ? { payload } : {}) });
        expect(denied.statusCode, `${method} ${suffix}`).toBe(404); expect(denied.body).not.toContain(revisionA.id);
        expect((await app.inject({ method, url: base + suffix, ...(payload ? { payload } : {}) })).statusCode).toBe(401);
      }
      expect((await app.inject({ url: `${base}/analyses/${randomUUID()}`, headers: owner })).json().error.code).toBe('KNOWLEDGE_ANALYSIS_NOT_FOUND');
      expect((await app.inject({ method: 'POST', url: `${base}/validate`, headers: owner, payload: { ...input, jurisdiction: 'auto' } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: `${base}/validate`, headers: owner, payload: { ...input, version: 'specialized-knowledge-input-v2' } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: `${base}/validate`, headers: owner, payload: { ...input, packs: [] } })).statusCode).toBe(400);
      let deep: unknown = 0; for (let i = 0; i < 40; i++) deep = [deep];
      const nested = await app.inject({ method: 'POST', url: `${base}/validate`, headers: owner, payload: { ...input, extra: deep } });
      expect(nested.statusCode).toBe(422); expect(nested.json().error.code).toBe('KNOWLEDGE_RESOURCE_LIMIT');
      expect((await app.inject({ method: 'POST', url: `${base}/validate`, headers: owner, payload: { ...input, padding: 'x'.repeat(20_000) } })).statusCode).toBe(400);
      expect((await app.inject({ url: `${base}/analyses/${id}?require=yes`, headers: owner })).statusCode).toBe(400);
      expect((await app.inject({ url: `${base}/status?debug=1`, headers: owner })).statusCode).toBe(400);
      const before = (await app.inject({ url: `${base}/analyses?limit=100`, headers: owner })).json().items.length;
      await app.inject({ url: `${base}/status`, headers: owner }); await app.inject({ url: `${base}/analyses/${id}`, headers: owner }); await app.inject({ url: `${base}/packs`, headers: owner });
      expect((await app.inject({ url: `${base}/analyses?limit=100`, headers: owner })).json().items.length).toBe(before);
    });

    it('replays idempotent commands, rejects key reuse with another input, and makes analyses STALE (never reused) after the revision advances', async () => {
      const { app, owner, base, sources, projectId, revisionA } = fixture;
      const key = randomUUID(), input = knowledgeInput(sources, ['ARCHITECTURE', 'QUANTITY']);
      const first = await app.inject({ method: 'POST', url: `${base}/analyses`, headers: { ...owner, 'idempotency-key': key }, payload: input });
      expect(first.statusCode, first.body.slice(0, 300)).toBe(201);
      const replay = await app.inject({ method: 'POST', url: `${base}/analyses`, headers: { ...owner, 'idempotency-key': key }, payload: input });
      expect(replay.statusCode).toBe(201); expect(replay.json()).toEqual(first.json());
      const conflict = await app.inject({ method: 'POST', url: `${base}/analyses`, headers: { ...owner, 'idempotency-key': key }, payload: knowledgeInput(sources, ['QUANTITY']) });
      expect(conflict.statusCode).toBe(409); expect(conflict.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
      // G5: advancing the project makes every revision-A analysis STALE; it is never re-applied to revision B.
      const edited = wetRequirements(); edited.parametricArchitecture.floors[0]!.westWingWidthMm = 10000;
      const b = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements: edited, baseRevisionId: revisionA.id } });
      expect(b.statusCode, b.body).toBe(201);
      const baseB = `/api/projects/${projectId}/revisions/${b.json().revision.id}/knowledge`, id = first.json().id;
      expect((await app.inject({ url: `${base}/analyses/${id}`, headers: owner })).json().currency).toEqual({ status: 'STALE', analysisRevisionId: revisionA.id,
        projectCurrentRevisionId: b.json().revision.id });
      const stale = await app.inject({ url: `${base}/analyses/${id}?require=current`, headers: owner });
      expect(stale.statusCode).toBe(409); expect(stale.json().error.code).toBe('KNOWLEDGE_RESULT_STALE');
      expect((await app.inject({ url: `${baseB}/analyses/${id}`, headers: owner })).statusCode).toBe(404);
      const statusB = (await app.inject({ url: `${baseB}/status`, headers: owner })).json();
      expect(statusB).toMatchObject({ knowledgeStatus: 'NOT_EVALUATED', requiresNewAnalysis: true, revisionCurrency: 'CURRENT', analyses: [] });
      expect(statusB.staleAnalyses.map((s: Result) => s.id)).toContain(id);
      // Revision-A upstream analyses cannot be bound through revision B.
      expect((await app.inject({ method: 'POST', url: `${baseB}/analyses`, headers: owner, payload: knowledgeInput(sources) })).statusCode).toBe(404);
    });
  });
}
