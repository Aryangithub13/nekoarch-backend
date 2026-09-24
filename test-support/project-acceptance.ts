import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { generateBlueprint } from '@designflow/generator';
import { ArchitecturalBuildingModelV2Schema } from '@designflow/shared';
import { auditBlueprint, BlueprintQaReportSchema } from '@designflow/blueprint-qa';
import type { buildApp } from '../apps/api/src/app.js';
import { ProjectDetailSchema, ProjectRevisionDetailSchema, RevisionCommitResponseSchema, ProjectListSchema, RevisionListSchema, PublicProjectSchema } from '../apps/api/src/contracts/projects.js';
import { projectQaOptions } from '../apps/api/src/services/project-service.js';
import { authored, requirements } from '../packages/blueprint-qa/tests/fixtures.js';

export type ProjectTestContext = { app: ReturnType<typeof buildApp>; owner: { authorization: string }; other: { authorization: string } };
export function projectAcceptance(context: () => ProjectTestContext) {
  const create = async (title = 'Native project', key?: string, other = false) => {
    const c = context();
    const response = await c.app.inject({ method: 'POST', url: '/api/projects', headers: { ...(other ? c.other : c.owner), ...(key ? { 'idempotency-key': key } : {}) }, payload: { title } });
    expect(response.statusCode, response.body).toBe(201);
    return ProjectDetailSchema.parse(response.json());
  };
  const generate = async (id: string, baseRevisionId: string | null = null, key?: string) => {
    const c = context();
    return c.app.inject({ method: 'POST', url: `/api/projects/${id}/revisions/generate`, headers: { ...c.owner, ...(key ? { 'idempotency-key': key } : {}) }, payload: { requirements: requirements(), baseRevisionId } });
  };
  const save = async (id: string, model: unknown, baseRevisionId: string | null = null) => context().app.inject({ method: 'POST', url: `/api/projects/${id}/revisions`, headers: context().owner, payload: { model, baseRevisionId } });
  const patch = async (id: string, payload: object) => context().app.inject({ method: 'PATCH', url: `/api/projects/${id}`, headers: context().owner, payload });
  const get = async (url: string) => context().app.inject({ method: 'GET', url, headers: context().owner });

  it('creates empty identity, gets it, updates only metadata and validates ownership', async () => {
    const p = await create();
    expect(p.currentRevision).toBeNull(); expect(p.visibility).toBe('PRIVATE'); expect(p.status).toBe('ACTIVE');
    expect(ProjectDetailSchema.parse((await get(`/api/projects/${p.id}`)).json())).toEqual(p);
    const updated = await patch(p.id, { title: 'Renamed', status: 'ARCHIVED' });
    expect(updated.statusCode).toBe(200); expect(updated.json()).toMatchObject({ title: 'Renamed', status: 'ARCHIVED' });
    expect(updated.json().archivedAt).not.toBeNull();
    expect((await patch(p.id, { currentRevisionId: randomUUID() })).statusCode).toBe(400);
    expect((await patch(p.id, { ownerId: randomUUID() })).statusCode).toBe(400);
    expect((await patch(p.id, {})).statusCode).toBe(400);
    const c = context();
    expect((await c.app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'No auth' } })).statusCode).toBe(401);
    expect((await c.app.inject({ method: 'POST', url: '/api/projects', headers: c.owner, payload: { title: 'Bad', ownerId: randomUUID() } })).statusCode).toBe(400);
  });

  it('round-trips generated geometry and complete QA, appends R2 and leaves R1 immutable', async () => {
    const p = await create(); const generated = await generate(p.id);
    expect(generated.statusCode, generated.body).toBe(201);
    const r1 = RevisionCommitResponseSchema.parse(generated.json()).revision;
    const model = generateBlueprint(requirements()).model;
    expect(ArchitecturalBuildingModelV2Schema.parse(r1.model)).toEqual(model);
    const report = auditBlueprint(model, projectQaOptions(model));
    expect(BlueprintQaReportSchema.parse(r1.qaRuns[0]!.report)).toEqual(report);
    expect(r1.revisionNumber).toBe(1); expect(r1.parentRevisionId).toBeNull();
    const saved = await save(p.id, model, r1.id); expect(saved.statusCode, saved.body).toBe(201);
    const r2 = RevisionCommitResponseSchema.parse(saved.json()).revision;
    expect(r2.revisionNumber).toBe(2); expect(r2.parentRevisionId).toBe(r1.id); expect(r2.generatorVersion).toBeNull();
    const historical = ProjectRevisionDetailSchema.parse((await get(`/api/projects/${p.id}/revisions/${r1.id}`)).json());
    expect(historical).toEqual(r1);
    expect((await get(`/api/projects/${p.id}`)).json().currentRevision).toEqual(r2);
    const history = RevisionListSchema.parse((await get(`/api/projects/${p.id}/revisions`)).json());
    expect(history.items.map(r => r.revisionNumber)).toEqual([2, 1]);
    expect(history.items.every(item => !('model' in item) && !('qaRuns' in item))).toBe(true);
  });

  it('rejects stale and missing bases without creating R3', async () => {
    const p = await create(); const r1 = (await generate(p.id)).json().revision;
    const r2 = (await generate(p.id, r1.id)).json().revision;
    for (const base of [null, r1.id]) {
      const stale = await generate(p.id, base); expect(stale.statusCode).toBe(409); expect(stale.json().error.code).toBe('REVISION_CONFLICT');
    }
    expect((await get(`/api/projects/${p.id}/revisions`)).json().items).toHaveLength(2);
    expect((await get(`/api/projects/${p.id}`)).json().currentRevisionId).toBe(r2.id);
  });

  it('serializes simultaneous saves from both empty and populated bases', async () => {
    const p = await create();
    for (const base of [null, 'current']) {
      const id = base === null ? null : (await get(`/api/projects/${p.id}`)).json().currentRevisionId;
      const results = await Promise.all([generate(p.id, id), generate(p.id, id)]);
      expect(results.map(r => r.statusCode).sort()).toEqual([201, 409]);
    }
    expect((await get(`/api/projects/${p.id}/revisions`)).json().items.map((r: { revisionNumber: number }) => r.revisionNumber)).toEqual([2, 1]);
  });

  it('rejects malformed and legacy V2 and refuses client QA metadata', async () => {
    const p = await create(); const model = authored();
    for (const invalid of [{}, { ...model, completeness: 'legacy-planar' }, { ...model, schemaVersion: 1 }]) expect((await save(p.id, invalid)).statusCode).toBe(400);
    const c = context();
    for (const extra of [{ revisionNumber: 8 }, { qa: { status: 'PASS' } }, { createdAt: new Date().toISOString() }]) {
      expect((await c.app.inject({ method: 'POST', url: `/api/projects/${p.id}/revisions`, headers: c.owner, payload: { model, ...extra } })).statusCode).toBe(400);
    }
    expect((await get(`/api/projects/${p.id}`)).json().currentRevisionId).toBeNull();
  });

  it('persists PASS and PASS_WITH_WARNINGS without changing full reports', async () => {
    const p = await create(); const model = authored();
    const pass = await save(p.id, model); expect(pass.statusCode, pass.body).toBe(201);
    expect(pass.json().revision.qa.status).toBe('PASS');
    model.openings[0]!.widthMm = 800;
    const warning = await save(p.id, model, pass.json().revision.id); expect(warning.statusCode, warning.body).toBe(201);
    expect(warning.json().revision.qa.status).toBe('PASS_WITH_WARNINGS');
    expect(warning.json().revision.qaRuns[0].report).toEqual(auditBlueprint(model, projectQaOptions(model)));
  });

  it('rejects schema-valid QA failures with bounded evidence and no accepted state', async () => {
    const p = await create(); const model = authored();
    model.openings = model.openings.filter(o => o.id !== 'studio-door');
    model.dimensions = model.dimensions.filter(d => d.id !== 'door-offset');
    ArchitecturalBuildingModelV2Schema.parse(model);
    const response = await save(p.id, model); expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error.code).toBe('BLUEPRINT_QA_FAILED');
    expect(response.json().error.fieldErrors.qaStatus).toEqual(['FAIL']);
    expect(response.json().error.fieldErrors.findings.length).toBeLessThanOrEqual(20);
    expect((await get(`/api/projects/${p.id}`)).json().currentRevisionId).toBeNull();
    expect((await get(`/api/projects/${p.id}/revisions`)).json().items).toEqual([]);
  });

  it('preserves an existing current revision after QA rejection and accepts two-storey generated geometry', async () => {
    const p = await create(); const c = context();
    const generated = await c.app.inject({ method: 'POST', url: `/api/projects/${p.id}/revisions/generate`, headers: c.owner, payload: { requirements: requirements(2) } });
    expect(generated.statusCode, generated.body).toBe(201);
    const before = (await get(`/api/projects/${p.id}`)).json();
    expect(before.currentRevision.model).toEqual(generateBlueprint(requirements(2)).model);
    const rejected = authored(); rejected.openings = rejected.openings.filter(o => o.id !== 'studio-door');
    rejected.dimensions = rejected.dimensions.filter(d => d.id !== 'door-offset');
    expect((await save(p.id, rejected, before.currentRevisionId)).statusCode).toBe(422);
    expect((await get(`/api/projects/${p.id}`)).json()).toEqual(before);
    expect((await get(`/api/projects/${p.id}/revisions`)).json().items).toHaveLength(1);
  });

  it('returns typed generator failures without persisting a revision', async () => {
    const p = await create(); const c = context();
    const input = requirements(); input.site.boundary = [{ x: 0, z: 0 }, { x: 1000, z: 0 }, { x: 1000, z: 1000 }, { x: 0, z: 1000 }];
    const response = await c.app.inject({ method: 'POST', url: `/api/projects/${p.id}/revisions/generate`, headers: c.owner, payload: { requirements: input } });
    expect(response.statusCode, response.body).toBe(422);
    expect((await get(`/api/projects/${p.id}/revisions`)).json().items).toEqual([]);
  });

  it('isolates private owner data and exposes only public current architecture', async () => {
    const p = await create(); const r1 = (await generate(p.id)).json().revision;
    const r2 = (await generate(p.id, r1.id)).json().revision;
    const c = context();
    const publicRead = (headers: Record<string, string>) => c.app.inject({ method: 'GET', url: `/api/projects/${p.id}/public`, headers });
    for (const headers of [c.other, {}]) expect((await publicRead(headers)).statusCode).toBe(404);
    expect((await patch(p.id, { visibility: 'PUBLIC' })).statusCode).toBe(200);
    for (const headers of [c.other, {}]) {
      const response = await publicRead(headers); expect(response.statusCode).toBe(200);
      const visible = PublicProjectSchema.parse(response.json()); expect(visible.currentRevision?.id).toBe(r2.id);
      expect(response.body).not.toContain(r1.id); expect(response.body).not.toContain('owner'); expect(response.body).not.toContain('qaRuns');
    }
    for (const suffix of ['', '/revisions', `/revisions/${r1.id}`, `/revisions/${r2.id}`]) {
      expect((await c.app.inject({ method: 'GET', url: `/api/projects/${p.id}${suffix}`, headers: c.other })).statusCode).toBe(404);
    }
    expect((await c.app.inject({ method: 'PATCH', url: `/api/projects/${p.id}`, headers: c.other, payload: { title: 'Stolen' } })).statusCode).toBe(404);
    expect((await c.app.inject({ method: 'POST', url: `/api/projects/${p.id}/revisions/generate`, headers: c.other, payload: { requirements: requirements() } })).statusCode).toBe(404);
    await patch(p.id, { visibility: 'PRIVATE' }); expect((await publicRead({})).statusCode).toBe(404);
  });

  it('archives without losing history, forbids writes and allows explicit unarchive', async () => {
    const p = await create(); const r1 = (await generate(p.id)).json().revision;
    await patch(p.id, { status: 'ARCHIVED', visibility: 'PUBLIC' });
    const response = await generate(p.id, r1.id); expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe('PROJECT_ARCHIVED');
    expect((await get(`/api/projects/${p.id}/revisions`)).json().items).toHaveLength(1);
    expect((await context().app.inject(`/api/projects/${p.id}/public`)).statusCode).toBe(404);
    await patch(p.id, { status: 'ACTIVE' }); expect((await generate(p.id, r1.id)).statusCode).toBe(201);
  });

  it('durably deduplicates project creation, detects payload conflict and isolates users', async () => {
    const key = randomUUID(); const projects = await Promise.all(Array.from({ length: 4 }, () => create('Deduplicated', key)));
    expect(projects.every(p => p.id === projects[0]!.id)).toBe(true);
    const c = context();
    const conflict = await c.app.inject({ method: 'POST', url: '/api/projects', headers: { ...c.owner, 'idempotency-key': key }, payload: { title: 'Changed' } });
    expect(conflict.statusCode).toBe(409); expect(conflict.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await create('Deduplicated', key, true)).id).not.toBe(projects[0]!.id);
  });

  it('deduplicates generated revisions and replays after the current pointer advances or archives', async () => {
    const p = await create(); const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 4 }, () => generate(p.id, null, key)));
    for (const result of results) { expect(result.statusCode, result.body).toBe(201); expect(result.json()).toEqual(results[0]!.json()); }
    const r1 = results[0]!.json().revision;
    expect((await generate(p.id, r1.id)).statusCode).toBe(201);
    await patch(p.id, { status: 'ARCHIVED' });
    expect((await generate(p.id, null, key)).json()).toEqual(results[0]!.json());
    const conflict = await generate(p.id, r1.id, key); expect(conflict.statusCode).toBe(409); expect(conflict.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    const otherProject = await create();
    expect((await generate(otherProject.id, null, key)).json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await get(`/api/projects/${p.id}/revisions`)).json().items).toHaveLength(2);
  });

  it('isolates the same revision idempotency key across authenticated users', async () => {
    const p = await create(); const otherProject = await create('Other user project', undefined, true); const key = randomUUID();
    const first = await generate(p.id, null, key); expect(first.statusCode).toBe(201);
    const c = context();
    const second = await c.app.inject({ method: 'POST', url: `/api/projects/${otherProject.id}/revisions/generate`,
      headers: { ...c.other, 'idempotency-key': key }, payload: { requirements: requirements() } });
    expect(second.statusCode, second.body).toBe(201); expect(second.json().revision.id).not.toBe(first.json().revision.id);
  });

  it('deduplicates supplied revisions and validates idempotency keys', async () => {
    const p = await create(); const c = context(); const key = randomUUID();
    const post = (k: string) => c.app.inject({ method: 'POST', url: `/api/projects/${p.id}/revisions`, headers: { ...c.owner, 'idempotency-key': k }, payload: { model: authored() } });
    const responses = await Promise.all([post(key), post(key), post(key)]);
    for (const r of responses) { expect(r.statusCode, r.body).toBe(201); expect(r.json()).toEqual(responses[0]!.json()); }
    expect((await post('bad key')).statusCode).toBe(400);
  });

  it('paginates projects and revisions deterministically without model bodies', async () => {
    const p = await create(); await create('Another'); const r1 = (await generate(p.id)).json().revision;
    await generate(p.id, r1.id);
    let cursor: string | null = null; const ids: string[] = [];
    do {
      const response = await get(`/api/projects?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      const page = ProjectListSchema.parse(response.json());
      expect(response.body).not.toContain('model'); expect(response.body).not.toContain('report');
      ids.push(...page.items.map(p => p.id)); cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(ids).size).toBe(ids.length); expect(ids).toContain(p.id);
    const first = RevisionListSchema.parse((await get(`/api/projects/${p.id}/revisions?limit=1`)).json());
    const second = RevisionListSchema.parse((await get(`/api/projects/${p.id}/revisions?limit=1&cursor=${first.nextCursor}`)).json());
    expect([...first.items, ...second.items].map(r => r.revisionNumber)).toEqual([2, 1]); expect(second.nextCursor).toBeNull();
    for (const query of ['limit=0', 'limit=101', 'cursor=bad', 'cursor=bnVsbA', 'unknown=1']) expect((await get(`/api/projects?${query}`)).statusCode).toBe(400);
  });
}
