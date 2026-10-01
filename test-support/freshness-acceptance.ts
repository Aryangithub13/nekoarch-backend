import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { generateBlueprint, normalizeBlueprintRequirements, type BlueprintRequirements } from '@designflow/generator';
import { requirements, rect } from '../packages/blueprint-qa/tests/fixtures.js';
import { workflowPayload } from './workflow-acceptance.js';
import type { ProjectTestContext } from './project-acceptance.js';
import { ProjectDetailSchema, RevisionCommitResponseSchema } from '../apps/api/src/contracts/projects.js';
import { WorkflowRunSchema } from '../apps/api/src/contracts/workflows.js';
import { canonicalBuilding, modelHash, requirementsHash } from '../apps/api/src/lib/generation-identity.js';

export function freshnessRequirements(bedrooms = 3, width = 9144, depth = 15240, seed = 'S1'): BlueprintRequirements {
  const r = requirements(1, seed); r.rooms[0]!.count = bedrooms;
  r.site.boundary = rect(0, 0, width, depth); return r;
}

/** Identical HTTP assertions run over disposable PostgreSQL and live Auth/PostgREST/RLS. */
export function freshnessAcceptance(context: () => ProjectTestContext, evidenceFile?: string) {
  const get = async (projectId: string) => {
    const c = context(), response = await c.app.inject({ url: `/api/projects/${projectId}?includeFreshness=true`, headers: c.owner });
    expect(response.statusCode, response.body).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
    return ProjectDetailSchema.parse(response.json());
  };
  const create = async () => {
    const c = context(), response = await c.app.inject({ method: 'POST', url: '/api/projects', headers: c.owner, payload: { title: 'Phase 17 disposable acceptance' } });
    expect(response.statusCode, response.body).toBe(201); return response.json().id as string;
  };
  const post = (projectId: string, r: BlueprintRequirements, baseRevisionId: string | null, key: string = randomUUID()) => {
    const c = context(); return c.app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`,
      headers: { ...c.owner, 'idempotency-key': key }, payload: { requirements: r, baseRevisionId } });
  };
  const accepted = async (projectId: string, r: BlueprintRequirements, baseRevisionId: string | null, key?: string) => {
    const response = await post(projectId, r, baseRevisionId, key); expect(response.statusCode, response.body).toBe(201);
    const result = RevisionCommitResponseSchema.parse(response.json()), revision = result.revision;
    expect(revision.identity?.requirementsHash).toBe(requirementsHash(r));
    expect(revision.identity?.modelHash).toBe(modelHash(revision.model));
    expect(revision.normalizedRequirements).toEqual(normalizeBlueprintRequirements(r));
    expect(revision.parentRevisionId).toBe(baseRevisionId); expect(result.project.currentRevisionId).toBe(revision.id);
    expect(revision.model.spaces.filter(s => s.classification === 'bedroom')).toHaveLength(r.rooms[0]!.count);
    expect(revision.model).toEqual(generateBlueprint(r).model);
    expect(revision.qa.status).not.toBe('FAIL'); return result;
  };

  it('A/B/C/A/D changes real rooms/site/current identity and preserves deterministic return to A', async () => {
    const projectId = await create(), sequence = [freshnessRequirements(), freshnessRequirements(4), freshnessRequirements(4, 12192, 18288), freshnessRequirements(), freshnessRequirements(3, 12192, 18288, 'S2')];
    const evidence = []; let base: string | null = null;
    expect((await get(projectId)).currentArtifacts?.takeoff.status).toBe('NO_CURRENT_REVISION');
    for (const [index, r] of sequence.entries()) {
      const result = await accepted(projectId, r, base), current = await get(projectId);
      expect(current.currentRevision).toEqual(result.revision); expect(current.currentRevisionId).toBe(result.revision.id);
      for (const artifact of Object.values(current.currentArtifacts!)) expect(artifact).toEqual({ status: 'NOT_GENERATED_FOR_CURRENT_REVISION', sourceRevisionId: result.revision.id });
      evidence.push({ label: ['A','B','C','A','D'][index], projectId, baseRevisionId: base, revisionId: result.revision.id,
        currentRevisionId: current.currentRevisionId, revisionNumber: result.revision.revisionNumber,
        generatorVersion: result.revision.generatorVersion, qaRunId: result.revision.qa.id, qaStatus: result.revision.qa.status,
        ...result.revision.identity!, bedrooms: r.rooms[0]!.count, siteBoundary: result.revision.model.site!.boundary,
        normalizedRequirements: result.revision.normalizedRequirements, currentArtifacts: current.currentArtifacts });
      base = result.revision.id;
    }
    expect(evidence[0]!.requirementsHash).not.toBe(evidence[1]!.requirementsHash);
    expect(evidence[0]!.modelHash).not.toBe(evidence[1]!.modelHash);
    expect(evidence[1]!.requirementsHash).not.toBe(evidence[2]!.requirementsHash);
    expect(evidence[1]!.modelHash).not.toBe(evidence[2]!.modelHash);
    expect(evidence[1]!.siteBoundary).not.toEqual(evidence[2]!.siteBoundary);
    expect(evidence[0]!.requirementsHash).toBe(evidence[3]!.requirementsHash); expect(evidence[0]!.modelHash).toBe(evidence[3]!.modelHash);
    expect(new Set(evidence.map(e => e.generationId)).size).toBe(5); expect(new Set(evidence.map(e => e.revisionId)).size).toBe(5);
    if (evidenceFile) await writeFile(evidenceFile, JSON.stringify({ source: 'Real HTTP acceptance on disposable PostgreSQL', baseline: '7a335acae6e2fe098d43172cb18a5366ce58ec5c', sequence: evidence, frontend: 'External; current identity verified via owner GET, no UI exists in this repository' }, null, 2) + '\n');
  });

  it('replays the exact durable attempt but rejects changed requirements, seed, base and solver options', async () => {
    const projectId = await create(), key = randomUUID(), r = freshnessRequirements();
    const a = await accepted(projectId, r, null, key);
    for (const [changed, base] of [[freshnessRequirements(4), null], [{ ...r, seed: 'S2' }, null], [r, a.revision.id], [{ ...r, solver: { maxCandidates: 1 } }, null]] as const) {
      const response = await post(projectId, changed, base, key);
      expect(response.statusCode, response.body).toBe(409); expect(response.json().error.code).toBe('IDEMPOTENCY_CONFLICT'); expect(response.json()).not.toHaveProperty('revision');
    }
    const b = await accepted(projectId, freshnessRequirements(4), a.revision.id);
    expect((await post(projectId, r, null, key)).json()).toEqual(a);
    // Confirmed stale-observation trap: a durable receipt's pointer is a commit snapshot.
    expect(a.project.currentRevisionId).not.toBe((await get(projectId)).currentRevisionId);
    expect((await get(projectId)).currentRevisionId).toBe(b.revision.id);
    const reordered = normalizeBlueprintRequirements(r); reordered.rooms.reverse();
    expect((await post(projectId, reordered, null, key)).json()).toEqual(a);
  });

  it('explicit alternative seed retains requirements identity and honestly reports canonical model equality', async () => {
    const projectId = await create(), a = await accepted(projectId, freshnessRequirements(), null);
    const b = await accepted(projectId, freshnessRequirements(3, 9144, 15240, 'S2'), a.revision.id);
    expect(b.revision.identity!.requirementsHash).toBe(a.revision.identity!.requirementsHash);
    expect(b.revision.identity!.seed).not.toBe(a.revision.identity!.seed);
    expect(b.revision.identity!.generationId).not.toBe(a.revision.identity!.generationId);
    expect(b.revision.identity!.modelHash === a.revision.identity!.modelHash).toBe(JSON.stringify(canonicalBuilding(a.revision.model)) === JSON.stringify(canonicalBuilding(b.revision.model)));
  });

  it('workflow changed-input sequences execute and same-key changed request conflicts without stale reuse', async () => {
    const c = context(), projectId = await create(), url = `/api/projects/${projectId}/workflows`;
    let baseRevisionId: string | null = null;
    const runs = [];
    for (const bedrooms of [3, 4, 3]) {
      const key = randomUUID(), headers = { ...c.owner, 'idempotency-key': key };
      const payload = { mode: 'BLUEPRINT_ONLY', source: { kind: 'GENERATE', requirements: freshnessRequirements(bedrooms), baseRevisionId } };
      const response = await c.app.inject({ method: 'POST', url, headers, payload }); expect(response.statusCode, response.body).toBe(201);
      const run = WorkflowRunSchema.parse(response.json()); expect(run.status, JSON.stringify(run.errors)).toBe('COMPLETED');
      expect(run.outputs.every((o: { status: string }) => o.status === 'CREATED')).toBe(true);
      const current = await get(projectId); expect(current.currentRevisionId).toBe(run.sourceRevisionId);
      expect(current.currentRevision!.identity!.requirementsHash).toBe(requirementsHash(payload.source.requirements));
      expect(current.currentRevision!.model.spaces.filter(s => s.classification === 'bedroom')).toHaveLength(bedrooms);
      for (const changed of [
        { ...payload, source: { ...payload.source, requirements: freshnessRequirements(bedrooms + 1) } },
        { ...payload, source: { ...payload.source, requirements: { ...payload.source.requirements, seed: 'S2' } } },
        { ...payload, source: { ...payload.source, baseRevisionId: run.sourceRevisionId } },
        { ...payload, optionalOutputs: ['SCENE_3D'] },
        { ...payload, takeoff: { options: { displayDecimalPlaces: 3 } } },
        { mode: 'THREE_D_ONLY', source: { kind: 'REVISION', sourceRevisionId: run.sourceRevisionId } },
      ]) {
        const rejected = await c.app.inject({ method: 'POST', url, headers, payload: changed });
        expect(rejected.statusCode, rejected.body).toBe(409);
        expect(rejected.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
      }
      expect((await c.app.inject({ method: 'POST', url, headers, payload })).json()).toEqual(run);
      runs.push({ run, payload, headers }); baseRevisionId = run.sourceRevisionId;
    }
    const first = runs[0]!;
    expect((await c.app.inject({ method: 'POST', url, headers: first.headers, payload: first.payload })).json()).toEqual(first.run);
    expect((await get(projectId)).currentRevisionId).toBe(runs[2]!.run.sourceRevisionId);
  });

  it('keeps R1 takeoff/construction/cost historical and returns explicit R2 absence', async () => {
    const c = context(), projectId = await create();
    const response = await c.app.inject({ method: 'POST', url: `/api/projects/${projectId}/workflows`, headers: c.owner, payload: workflowPayload() });
    expect(response.statusCode, response.body).toBe(201); const run = response.json(); expect(run.status).toBe('COMPLETED');
    const before = await get(projectId);
    for (const artifact of Object.values(before.currentArtifacts!)) expect(artifact.status).toBe('AVAILABLE');
    const [takeoff, construction, cost] = run.outputs.slice(3);
    const oldPaths = [`takeoffs/${takeoff.artifactId}`, `takeoffs/${takeoff.artifactId}/construction-calculations/${construction.artifactId}`, `cost-estimates/${cost.artifactId}`];
    const readOld = () => Promise.all(oldPaths.map(suffix => c.app.inject({ url: `/api/projects/${projectId}/revisions/${run.sourceRevisionId}/${suffix}`, headers: c.owner })));
    const old = await readOld(); old.forEach(r => expect(r.statusCode, r.body).toBe(200));
    const b = await accepted(projectId, freshnessRequirements(4), run.sourceRevisionId);
    const current = await get(projectId); expect(current.currentRevisionId).toBe(b.revision.id);
    for (const artifact of Object.values(current.currentArtifacts!)) expect(artifact).toEqual({ status: 'NOT_GENERATED_FOR_CURRENT_REVISION', sourceRevisionId: b.revision.id });
    expect((await readOld()).map(r => r.json())).toEqual(old.map(r => r.json()));
    for (const suffix of oldPaths) expect((await c.app.inject({ url: `/api/projects/${projectId}/revisions/${b.revision.id}/${suffix}`, headers: c.owner })).statusCode).toBe(404);
  });

  it('serializes competing generations and rejects a stale base without moving current', async () => {
    const projectId = await create(), a = await accepted(projectId, freshnessRequirements(), null);
    const results = await Promise.all([post(projectId, freshnessRequirements(4), a.revision.id), post(projectId, freshnessRequirements(3, 12192, 18288), a.revision.id)]);
    expect(results.map(r => r.statusCode).sort()).toEqual([201, 409]);
    const winner = RevisionCommitResponseSchema.parse(results.find(r => r.statusCode === 201)!.json());
    expect(results.find(r => r.statusCode === 409)!.json().error.code).toBe('REVISION_CONFLICT');
    const stale = await post(projectId, freshnessRequirements(), a.revision.id);
    expect(stale.statusCode).toBe(409); expect((await get(projectId)).currentRevisionId).toBe(winner.revision.id);
  });

  it('distinguishes an older delivered response from a newer accepted current revision', async () => {
    const projectId = await create();
    // Hold delivery of A after commit while B starts and completes. No frontend is present.
    let deliver!: () => void; const delivery = new Promise<void>(resolve => { deliver = resolve; });
    const a = await accepted(projectId, freshnessRequirements(), null);
    const delayedA = delivery.then(() => a);
    const b = await accepted(projectId, freshnessRequirements(4), a.revision.id);
    const displayedCandidate = b.revision;
    deliver(); const late = await delayedA;
    expect(late.revision.revisionNumber).toBeLessThan(displayedCandidate.revisionNumber);
    expect(late.revision.id).not.toBe(displayedCandidate.id);
    expect(late.revision.identity!.modelHash).not.toBe(displayedCandidate.identity!.modelHash);
    expect((await get(projectId)).currentRevision!.identity).toEqual(displayedCandidate.identity);
  });

  it('rejects forged identity fields and hides owner freshness/requirements from other users and public projections', async () => {
    const c = context(), projectId = await create();
    for (const extra of [{ modelHash: '0'.repeat(64) }, { requirementsHash: '0'.repeat(64) }, { generationId: randomUUID() }, { identity: {} }]) {
      const response = await c.app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: c.owner, payload: { requirements: freshnessRequirements(), ...extra } });
      expect(response.statusCode).toBe(400);
    }
    const a = await accepted(projectId, freshnessRequirements(), null);
    for (const suffix of ['?includeFreshness=true', `/revisions/${a.revision.id}`]) expect((await c.app.inject({ url: `/api/projects/${projectId}${suffix}`, headers: c.other })).statusCode).toBe(404);
    await c.app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, headers: c.owner, payload: { visibility: 'PUBLIC' } });
    const publicView = await c.app.inject({ url: `/api/projects/${projectId}/public` });
    expect(publicView.statusCode).toBe(200); expect(publicView.headers['cache-control']).toBe('no-store');
    expect(publicView.body).not.toContain('requirementsHash'); expect(publicView.body).not.toContain('generationId'); expect(publicView.body).not.toContain('normalizedRequirements');
  });
}
