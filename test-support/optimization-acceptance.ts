import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ProjectTestContext } from './project-acceptance.js';
import { parametricInput } from './parametric-fixtures.js';
import { solverInput } from './solver-v2-fixtures.js';
import { optimizationInput, optimizationVariable } from './optimization-fixtures.js';
import { CLAIMS } from '../apps/api/src/optimization/contracts.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Result = Record<string, any>;

/** Phase 28 HTTP acceptance, shared by embedded PostgreSQL and the local Supabase stack. Studies run in the real worker pool. */
export function optimizationAcceptance(context: () => ProjectTestContext) {
  describe('Phase 28 optimization acceptance', () => {
    let fixture: Awaited<ReturnType<typeof setup>>;
    async function setup() {
      const { app, owner, other } = context();
      const project = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Phase 28 optimization acceptance' } });
      expect(project.statusCode, project.body).toBe(201);
      const projectId = project.json().id as string;
      const a = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements: parametricInput() } });
      expect(a.statusCode, a.body).toBe(201);
      const revisionA = a.json().revision as Result, revisionUrl = `/api/projects/${projectId}/revisions/${revisionA.id}`, base = `${revisionUrl}/optimization`;
      return { app, owner, other, projectId, revisionA, revisionUrl, base };
    }
    beforeAll(async () => { fixture = await setup(); });
    const create = async (payload: object, headers: Record<string, string> = fixture.owner) => fixture.app.inject({ method: 'POST', url: `${fixture.base}/studies`, headers, payload });

    it('validates without computing or persisting, then runs and persists an advisory study', async () => {
      const { app, owner, base, revisionA, projectId } = fixture;
      expect((await app.inject({ url: `${base}/status`, headers: owner })).json()).toMatchObject({ optimizationStatus: 'NOT_STUDIED', studies: [] });
      const v = await app.inject({ method: 'POST', url: `${base}/validate`, headers: owner, payload: optimizationInput() });
      expect(v.statusCode, v.body).toBe(200);
      expect(v.json()).toMatchObject({ readiness: 'READY', candidateSpaceSize: '5', strategy: { kind: 'GRID' }, claims: CLAIMS });
      expect((await app.inject({ url: `${base}/studies`, headers: owner })).json().items).toEqual([]);
      const before = (await app.inject({ url: `/api/projects/${projectId}`, headers: owner })).json();
      const created = await create(optimizationInput());
      expect(created.statusCode, created.body.slice(0, 400)).toBe(201);
      const study = created.json() as Result;
      expect(study).toMatchObject({ projectRevisionId: revisionA.id, status: 'COMPLETED', strategy: 'GRID', mode: 'WEIGHTED_SCORE', candidateCount: 5, validCount: 5,
        searchResult: 'BEST_IN_EVALUATED_SEARCH_SPACE', modelHash: revisionA.identity.modelHash });
      expect(study.snapshot.claims).toEqual({ searchResult: 'BEST_IN_EVALUATED_SEARCH_SPACE', ...CLAIMS });
      expect(study.snapshot.candidates.every((c: Result) => c.architectureMutation === 'NONE')).toBe(true);
      expect(study.recommendedCandidates).toEqual([study.snapshot.candidates[0].candidateId]); // MINIMIZE GFA → narrowest width
      // Adoption safety: the current revision pointer and revision itself are unchanged.
      const after = (await app.inject({ url: `/api/projects/${projectId}`, headers: owner })).json();
      expect(after.currentRevision).toEqual(before.currentRevision);
      const read = await app.inject({ url: `${base}/studies/${study.id}?require=current`, headers: owner });
      expect(read.statusCode).toBe(200);
      expect(read.json()).toMatchObject({ id: study.id, resultHash: study.resultHash, currency: { status: 'CURRENT' } });
      expect((await app.inject({ url: `${base}/status`, headers: owner })).json()).toMatchObject({ optimizationStatus: 'STUDIED', revisionCurrency: 'CURRENT' });
    });

    it('replays idempotent submissions and rejects key reuse with another input', async () => {
      const key = randomUUID(), headers = { ...fixture.owner, 'idempotency-key': key };
      const input = optimizationInput({ variables: [optimizationVariable('w0', 0, 'widthMm', 16000, 18000, 2000)] });
      const first = await create(input, headers), replay = await create(input, headers);
      expect(first.statusCode, first.body.slice(0, 300)).toBe(201); expect(replay.statusCode).toBe(201);
      expect(replay.json().id).toBe(first.json().id);
      const conflict = await create(optimizationInput(), headers);
      expect(conflict.statusCode).toBe(409); expect(conflict.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('paginates studies stably', async () => {
      const { app, owner, base } = fixture;
      for (const w of [17000, 19000]) expect((await create(optimizationInput({ variables: [optimizationVariable('w0', 0, 'widthMm', w, w + 1000, 1000)] }))).statusCode).toBe(201);
      const page1 = (await app.inject({ url: `${base}/studies?limit=2`, headers: owner })).json();
      expect(page1.items).toHaveLength(2); expect(page1.nextCursor).toEqual(expect.any(String));
      const page2 = (await app.inject({ url: `${base}/studies?limit=2&cursor=${page1.nextCursor}`, headers: owner })).json();
      const all = (await app.inject({ url: `${base}/studies?limit=100`, headers: owner })).json().items.map((i: Result) => i.id);
      expect([...page1.items, ...page2.items].map((i: Result) => i.id)).toEqual(all.slice(0, page1.items.length + page2.items.length));
      expect(new Set(all).size).toBe(all.length);
      expect((await app.inject({ url: `${base}/studies?cursor=not-a-cursor`, headers: owner })).statusCode).toBe(400);
    });

    it('enforces authentication, ownership and revision scoping', async () => {
      const { app, owner, other, base, projectId } = fixture;
      for (const [method, url] of [['POST', `${base}/studies`], ['GET', `${base}/studies`], ['GET', `${base}/status`], ['POST', `${base}/validate`]] as const)
        expect((await app.inject({ method, url, ...(method === 'POST' ? { payload: optimizationInput() } : {}) })).statusCode).toBe(401);
      expect((await create(optimizationInput(), other)).statusCode).toBe(404);
      expect((await app.inject({ url: `${base}/studies`, headers: other })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/${randomUUID()}/optimization/studies`, headers: owner, payload: optimizationInput() })).statusCode).toBe(404);
      expect((await app.inject({ url: `${base}/studies/${randomUUID()}`, headers: owner })).statusCode).toBe(404);
    });

    it('returns typed refusals and stores nothing for refused studies', async () => {
      const { app, owner, base } = fixture;
      const count = async () => (await app.inject({ url: `${base}/studies?limit=100`, headers: owner })).json().items.length, before = await count();
      const malformed = await create({ ...optimizationInput(), version: 'optimization-input-v0' });
      expect(malformed.statusCode).toBe(400); expect(malformed.json().error.code).toBe('OPTIMIZATION_INPUT_INVALID');
      const float = await create(optimizationInput({ objectives: [{ objectiveId: 'gfa', metric: { kind: 'GROSS_FLOOR_AREA' }, goal: { kind: 'MINIMIZE' }, weight: 1.5,
        normalization: { method: 'CANDIDATE_RANGE' } }] }));
      expect(float.statusCode).toBe(400); expect(float.json().error.message).toMatch(/safe integers/);
      const space = await create(optimizationInput({ variables: [optimizationVariable('w0', 0, 'widthMm', 1000, 60000, 1000), optimizationVariable('d0', 0, 'depthMm', 1000, 60000, 1000)] }));
      expect(space.statusCode).toBe(422); expect(space.json().error.code).toBe('OPTIMIZATION_RESOURCE_LIMIT');
      expect(space.json().error.fieldErrors).toMatchObject({ limit: ['candidateSpaceSize'], value: ['3600'] });
      const deferred = await create(optimizationInput({ objectives: [{ objectiveId: 's', metric: { kind: 'STRUCTURAL' }, goal: { kind: 'MINIMIZE' }, weight: 1, normalization: { method: 'CANDIDATE_RANGE' } }] }));
      expect(deferred.statusCode).toBe(422); expect(deferred.json().error.code).toBe('OPTIMIZATION_UNSUPPORTED');
      expect(await count()).toBe(before);
    });

    it('adoption goes only through the existing revision path and reproduces the candidate model; studies then become STALE', async () => {
      const { app, owner, projectId, revisionA, base } = fixture;
      const study = (await create(optimizationInput({ variables: [optimizationVariable('w0', 0, 'widthMm', 17000, 19000, 1000)] }))).json() as Result;
      const pick = study.snapshot.candidates.find((c: Result) => c.adoption.parametricEdits.length) as Result;
      const requirements = structuredClone(revisionA.normalizedRequirements) as Result;
      for (const e of pick.adoption.parametricEdits) requirements.parametricArchitecture.floors[e.level][e.parameter] = e.valueMm;
      const adopted = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements, baseRevisionId: revisionA.id } });
      expect(adopted.statusCode, adopted.body.slice(0, 300)).toBe(201);
      const revisionB = adopted.json().revision as Result;
      expect(revisionB.identity.modelHash).toBe(pick.modelHash);
      expect((await app.inject({ url: `${base}/studies/${study.id}`, headers: owner })).json().currency).toEqual({ status: 'STALE', studyRevisionId: revisionA.id,
        projectCurrentRevisionId: revisionB.id });
      const stale = await app.inject({ url: `${base}/studies/${study.id}?require=current`, headers: owner });
      expect(stale.statusCode).toBe(409); expect(stale.json().error.code).toBe('OPTIMIZATION_RESULT_STALE');
      const status = (await app.inject({ url: `/api/projects/${projectId}/revisions/${revisionB.id}/optimization/status`, headers: owner })).json();
      expect(status).toMatchObject({ optimizationStatus: 'NOT_STUDIED', revisionCurrency: 'CURRENT' });
      expect(status.staleStudies.map((s: Result) => s.staleReason)).toContain('BOUND_TO_A_DIFFERENT_REVISION');
      // A non-parametric (Solver V2) revision is not an optimization source (D1).
      const v2 = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements: solverInput(), baseRevisionId: revisionB.id } });
      expect(v2.statusCode, v2.body.slice(0, 300)).toBe(201);
      const unsupported = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/${v2.json().revision.id}/optimization/studies`, headers: owner, payload: optimizationInput() });
      expect(unsupported.statusCode).toBe(422); expect(unsupported.json().error).toMatchObject({ code: 'OPTIMIZATION_UNSUPPORTED', fieldErrors: { reason: ['SOURCE_GENERATOR_UNSUPPORTED'] } });
    });
  });
}
