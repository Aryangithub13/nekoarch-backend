import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { generateBlueprint, generateBlueprintV2, normalizeBlueprintV2Requirements } from '@designflow/generator';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { modelHash, requirementsHash } from '../apps/api/src/lib/generation-identity.js';
import { projectQaOptions } from '../apps/api/src/services/project-service.js';
import type { ProjectTestContext } from './project-acceptance.js';
import { RevisionCommitResponseSchema } from '../apps/api/src/contracts/projects.js';
import { workflowPayload, workflowSetup } from './workflow-acceptance.js';
import { solverInput, lSite, uSite, rectangleSite, relationshipInput } from './solver-v2-fixtures.js';

/** Real HTTP handlers, real database transactions; shared by PostgreSQL and local Supabase. */
export function solverV2Acceptance(context: () => ProjectTestContext, evidenceDirectory?: string) {
  const record = async (name: string, value: unknown) => {
    if (evidenceDirectory) { await mkdir(evidenceDirectory, { recursive: true }); await writeFile(`${evidenceDirectory}/${name}.json`, JSON.stringify(value, null, 2) + '\n'); }
  };
  const create = async () => {
    const c = context(), response = await c.app.inject({ method: 'POST', url: '/api/projects', headers: c.owner, payload: { title: 'Phase 19 real acceptance' } });
    expect(response.statusCode, response.body).toBe(201); return response.json().id as string;
  };
  const generate = async (input: unknown, name: string) => {
    const c = context(), id = await create(), url = `/api/projects/${id}/revisions/generate`;
    const headers = { ...c.owner, 'idempotency-key': randomUUID() }, payload = { requirements: input };
    const response = await c.app.inject({ method: 'POST', url, headers, payload });
    expect(response.statusCode, response.body).toBe(201);
    const result = RevisionCommitResponseSchema.parse(response.json());
    expect(result.revision.qa.status).not.toBe('FAIL');
    expect(result.revision.identity?.requirementsHash).toBe(requirementsHash(input));
    expect(result.revision.identity?.modelHash).toBe(modelHash(result.revision.model));
    expect((await c.app.inject({ method: 'POST', url, headers, payload })).json()).toEqual(response.json());
    const reread = await c.app.inject({ url: `/api/projects/${id}/revisions/${result.revision.id}`, headers: c.owner });
    expect(reread.statusCode, reread.body).toBe(200); expect(reread.json()).toEqual(result.revision);
    await record(name, { request: payload, response: result }); return result;
  };
  it('A: retains default V1 HTTP geometry and identity', async () => {
    const { layoutV2: _v2, ...input } = solverInput();
    const result = await generate(input, 'A-v1');
    expect(result.revision.generatorVersion).toBe('precision-blueprint-v1');
    expect(result.revision.model).toEqual(generateBlueprint(input).model);
  });
  for (const [name, boundary] of [['B-L-site', lSite], ['B-U-site', uSite]] as const) it(`${name}: accepts V2 orthogonal sites through immutable revisions`, async () => {
    const result = await generate(solverInput({ site: { boundary: [...boundary], northMilliDegrees: 0 } }), name);
    expect(result.revision.generatorVersion).toBe('precision-blueprint-v2');
    expect(result.revision.normalizedRequirements).toHaveProperty('layoutV2.version', 2);
    expect(auditBlueprint(result.revision.model, projectQaOptions(result.revision.model)).status).not.toBe('FAIL');
  });
  it('C: independently verifies hard direct and passage connections in accepted revisions', async () => {
    const input = relationshipInput(), result = await generate(input, 'C-relationships');
    const requiredRelationships = normalizeBlueprintV2Requirements(input).relationships.map(e => ({ from: `space-${e.from.type}-${e.from.ordinal}`, to: `space-${e.to.type}-${e.to.ordinal}`, kind: e.kind }));
    expect(auditBlueprint(result.revision.model, { ...projectQaOptions(result.revision.model), requiredRelationships }).status).not.toBe('FAIL');
  });
  it('D: persists coordinated two-storey stairs and actual entrance reachability', async () => {
    const result = await generate(solverInput({ floors: 2 }), 'D-two-floor');
    expect(result.revision.model.stairs).toHaveLength(1);
    expect(result.revision.qaRuns[0]!.report.circulation.unreachableSpaceIds).toEqual([]);
  });
  it('E: records a measured privacy comparison over the same candidate schedule', async () => {
    const input = solverInput({ layoutV2: { accessSide: 'min-z', forbidPrivateThroughAccess: true, objectives: { privacy: 10, serviceClustering: 0, daylightPotential: 0, ventilationPotential: 0, circulation: 0, roomShape: 0, siteUtilization: 0 } } });
    const baseline = generateBlueprintV2({ ...input, layoutV2: { ...input.layoutV2, objectives: { ...input.layoutV2!.objectives, privacy: 0 } } });
    const optimized = generateBlueprintV2(input);
    expect(optimized.diagnostics.winner.components.privacy).toBeLessThanOrEqual(baseline.diagnostics.winner.components.privacy);
    const result = await generate(input, 'E-privacy');
    expect(result.revision.model).toEqual(optimized.model);
    await record('E-privacy-comparison', { baseline: baseline.diagnostics, optimized: optimized.diagnostics, strictImprovement: optimized.diagnostics.winner.components.privacy < baseline.diagnostics.winner.components.privacy });
  });
  it('F: preserves actual window and facade evidence without physical simulation claims', async () => {
    const input = solverInput({ layoutV2: { cardinalPreferences: [{ room: { type: 'living' }, direction: 'north' }] } });
    const result = await generate(input, 'F-exposure'), generated = generateBlueprintV2(input);
    expect(result.revision.model).toEqual(generated.model);
    expect(generated.diagnostics.winner.notEvaluated).toContain('AIRFLOW_SIMULATION');
    await record('F-exposure-evaluation', generated.diagnostics);
  });
  it('G: returns typed infeasibility with no revision write', async () => {
    const c = context(), id = await create();
    const payload = { requirements: solverInput({ site: { boundary: rectangleSite(2500, 2500), northMilliDegrees: null } }) };
    const response = await c.app.inject({ method: 'POST', url: `/api/projects/${id}/revisions/generate`, headers: c.owner, payload });
    expect(response.statusCode, response.body).toBe(422); expect(response.json().error.code).toBe('PROGRAM_DOES_NOT_FIT');
    expect((await c.app.inject({ url: `/api/projects/${id}`, headers: c.owner })).json().currentRevisionId).toBeNull();
    await record('G-infeasible', { request: payload, statusCode: response.statusCode, response: response.json() });
  });
  it('H: generates, audits, persists and costs V2 with honest parking coverage and matching workflow versions', async () => {
    const c = context(), f = await workflowSetup(c), payload = workflowPayload();
    payload.source.requirements = solverInput({ layoutV2: { accessSide: 'min-z', parking: { count: 1 } } });
    const response = await c.app.inject({ method: 'POST', url: f.url, headers: c.owner, payload });
    expect(response.statusCode, response.body).toBe(201); const run = response.json();
    expect(run.status, JSON.stringify(run.errors)).toBe('COMPLETED');
    expect(run.plan.steps[0].version).toBe('precision-blueprint-v2');
    expect(run.outputs[0].version).toBe('precision-blueprint-v2');
    const base = `/api/projects/${f.projectId}/revisions/${run.sourceRevisionId}`;
    const takeoff = (await c.app.inject({ url: `${base}/takeoffs/${run.outputs[3].artifactId}`, headers: c.owner })).json();
    expect(takeoff.report.coverage).toContainEqual(expect.objectContaining({ category: 'parking_construction', status: 'NOT_EVALUATED' }));
    const cost = (await c.app.inject({ url: `${base}/cost-estimates/${run.outputs[5].artifactId}`, headers: c.owner })).json();
    expect(cost.report.finalTotals.completeTotalAvailable).toBe(false);
    await record('H-complete-building', { request: payload, run, takeoff, cost });
  });
  it('protects ownership, strict input, changed-command identity, freshness and interpreter boundaries for V2', async () => {
    const c = context(), id = await create(), url = `/api/projects/${id}/revisions/generate`;
    const input = solverInput(), payload = { requirements: input }, headers = { ...c.owner, 'idempotency-key': randomUUID() };
    expect((await c.app.inject({ method: 'POST', url, headers: c.other, payload })).statusCode).toBe(404);
    expect((await c.app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    expect((await c.app.inject({ method: 'POST', url, headers: c.owner, payload: { ...payload, qa: 'PASS' } })).statusCode).toBe(400);
    const first = await c.app.inject({ method: 'POST', url, headers, payload }); expect(first.statusCode, first.body).toBe(201);
    const changed = { requirements: { ...input, seed: 'new-execution' }, baseRevisionId: first.json().revision.id };
    expect((await c.app.inject({ method: 'POST', url, headers, payload: changed })).statusCode).toBe(409);
    const second = await c.app.inject({ method: 'POST', url, headers: c.owner, payload: changed }); expect(second.statusCode, second.body).toBe(201);
    expect(second.json().revision.identity.requirementsHash).toBe(first.json().revision.identity.requirementsHash);
    expect(second.json().revision.identity.generationId).not.toBe(first.json().revision.identity.generationId);
    expect((await c.app.inject({ method: 'POST', url, headers, payload })).json()).toEqual(first.json());
    expect((await c.app.inject({ method: 'POST', url, headers: c.owner, payload: changed })).statusCode).toBe(409);
    const interpretation = await c.app.inject({ method: 'POST', url: `/api/projects/${id}/requirements/interpret`, headers: c.owner, payload: { text: 'keep bedrooms and make kitchen larger', baseRevisionId: second.json().revision.id } });
    expect(interpretation.statusCode, interpretation.body).toBe(422); expect(interpretation.json().error.code).toBe('V2_INTERPRETATION_UNSUPPORTED');
  });
}
