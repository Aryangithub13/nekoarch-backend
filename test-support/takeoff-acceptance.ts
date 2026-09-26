import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { calculateQuantityTakeoff } from '@designflow/quantity-takeoff';
import { TakeoffDetailSchema, TakeoffListSchema } from '../apps/api/src/contracts/takeoffs.js';
import { requirements } from '../packages/blueprint-qa/tests/fixtures.js';
import type { ProjectTestContext } from './project-acceptance.js';
export function takeoffAcceptance(context: () => ProjectTestContext) {
  async function setup(other = false) {
    const c = context(), headers = other ? c.other : c.owner;
    const p = await c.app.inject({ method: 'POST', url: '/api/projects', headers, payload: { title: 'Quantity acceptance' } });
    expect(p.statusCode, p.body).toBe(201);
    const projectId: string = p.json().id;
    const saved = await c.app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers, payload: { requirements: requirements(2, 'takeoff-golden') } });
    expect(saved.statusCode, saved.body).toBe(201);
    return { projectId, revision: saved.json().revision, headers, url: `/api/projects/${projectId}/revisions/${saved.json().revision.id}/takeoffs` };
  }
  it('persists exact takeoff, reads it, preserves revision and acceptance QA without re-auditing', async () => {
    const c = context(), f = await setup();
    const response = await c.app.inject({ method: 'POST', url: f.url, headers: f.headers, payload: {} });
    expect(response.statusCode, response.body).toBe(201); const dto = TakeoffDetailSchema.parse(response.json());
    expect(dto.report).toEqual(calculateQuantityTakeoff(f.revision.model)); expect(dto.acceptanceQaId).toBe(f.revision.qa.id);
    expect(dto.projectRevisionId).toBe(f.revision.id);
    const detail = await c.app.inject({ method: 'GET', url: `${f.url}/${dto.id}`, headers: f.headers }); expect(detail.json()).toEqual(dto);
    expect((await c.app.inject({ method: 'GET', url: f.url.replace('/takeoffs',''), headers: f.headers })).json()).toEqual(f.revision);
    const publicResult = await c.app.inject({ method: 'PATCH', url: `/api/projects/${f.projectId}`, headers: f.headers, payload: { visibility: 'PUBLIC' } }); expect(publicResult.statusCode).toBe(200);
    for (const headers of [c.other, {}]) {
      for (const url of [f.url, `${f.url}/${dto.id}`]) expect((await c.app.inject({ method: 'GET', url, headers })).statusCode).toBe(headers === c.other ? 404 : 401);
      expect((await c.app.inject({ method: 'POST', url: f.url, headers, payload: {} })).statusCode).toBe(headers === c.other ? 404 : 401);
    }
    const publicProject = await c.app.inject({ method: 'GET', url: `/api/projects/${f.projectId}/public` });
    expect(publicProject.statusCode).toBe(200); expect(publicProject.body).not.toContain(dto.id);
    expect((await c.app.inject({ method: 'GET', url: `${f.url}/${randomUUID()}`, headers: f.headers })).json().error.code).toBe('TAKEOFF_NOT_FOUND');
  });
  it('converges concurrent creates with same, different and absent keys on one artifact', async () => {
    const c = context(), f = await setup(), key = randomUUID();
    const responses = await Promise.all([key,key,randomUUID(),undefined].map(k => c.app.inject({ method: 'POST', url: f.url,
      headers: { ...f.headers, ...(k ? { 'idempotency-key': k } : {}) }, payload: {} })));
    for (const response of responses) { expect(response.statusCode, response.body).toBe(201); expect(response.json()).toEqual(responses[0]!.json()); }
    const repeat = await c.app.inject({ method: 'POST', url: f.url, headers: { ...f.headers, 'idempotency-key': key }, payload: { options: { displayDecimalPlaces: 6 } } }); expect(repeat.json()).toEqual(responses[0]!.json());
    const conflict = await c.app.inject({ method: 'POST', url: f.url, headers: { ...f.headers, 'idempotency-key': key }, payload: { options: { displayDecimalPlaces: 3 } } });
    expect(conflict.statusCode).toBe(409); expect(conflict.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    const list = TakeoffListSchema.parse((await c.app.inject({ method: 'GET', url: f.url, headers: f.headers })).json()); expect(list.items).toHaveLength(1); expect(list.items[0]).not.toHaveProperty('report');
    const second = await setup(true);
    const isolated = await c.app.inject({ method: 'POST', url: second.url, headers: { ...second.headers, 'idempotency-key': key }, payload: {} });
    expect(isolated.statusCode, isolated.body).toBe(201); expect(isolated.json().id).not.toBe(responses[0]!.json().id);
  });
  it('keeps options and revisions distinct, paginates summaries and replays after architecture advances', async () => {
    const c = context(), f = await setup(), key = randomUUID();
    const first = await c.app.inject({ method: 'POST', url: f.url, headers: { ...f.headers, 'idempotency-key': key }, payload: {} }); expect(first.statusCode, first.body).toBe(201);
    const alternate = await c.app.inject({ method: 'POST', url: f.url, headers: f.headers, payload: { options: { displayDecimalPlaces: 3 } } }); expect(alternate.statusCode, alternate.body).toBe(201); expect(alternate.json().id).not.toBe(first.json().id);
    expect(alternate.json().inputFingerprint).not.toBe(first.json().inputFingerprint);
    const page = TakeoffListSchema.parse((await c.app.inject({ method: 'GET', url: `${f.url}?limit=1`, headers: f.headers })).json()); expect(page.items).toHaveLength(1); expect(page.nextCursor).not.toBeNull();
    const next = TakeoffListSchema.parse((await c.app.inject({ method: 'GET', url: `${f.url}?limit=1&cursor=${page.nextCursor}`, headers: f.headers })).json()); expect(next.nextCursor).toBeNull(); expect(next.items[0]!.id).not.toBe(page.items[0]!.id);
    const saved = await c.app.inject({ method: 'POST', url: `/api/projects/${f.projectId}/revisions`, headers: f.headers, payload: { model: f.revision.model, baseRevisionId: f.revision.id } }); expect(saved.statusCode, saved.body).toBe(201);
    const newUrl = `/api/projects/${f.projectId}/revisions/${saved.json().revision.id}/takeoffs`;
    const newer = await c.app.inject({ method: 'POST', url: newUrl, headers: f.headers, payload: {} }); expect(newer.statusCode, newer.body).toBe(201); expect(newer.json().id).not.toBe(first.json().id);
    expect(newer.json().report).toEqual(first.json().report);
    expect((await c.app.inject({ method: 'POST', url: newUrl, headers: { ...f.headers, 'idempotency-key': key }, payload: {} })).statusCode).toBe(409);
    await c.app.inject({ method: 'PATCH', url: `/api/projects/${f.projectId}`, headers: f.headers, payload: { status: 'ARCHIVED' } });
    expect((await c.app.inject({ method: 'POST', url: f.url, headers: { ...f.headers, 'idempotency-key': key }, payload: {} })).json()).toEqual(first.json());
  });
  it('rejects forged request metadata, invalid options, bad pagination and missing resources', async () => {
    const c = context(), f = await setup();
    for (const payload of [{ report: {} }, { acceptanceQaId: randomUUID() }, { options: { displayDecimalPlaces: 10 } }, { options: { material: 'brick' } }]) {
      expect((await c.app.inject({ method: 'POST', url: f.url, headers: f.headers, payload })).statusCode).toBe(400);
    }
    expect((await c.app.inject({ method: 'GET', url: `${f.url}?cursor=bad`, headers: f.headers })).statusCode).toBe(400);
    expect((await c.app.inject({ method: 'POST', url: f.url, headers: { ...f.headers, 'idempotency-key': 'bad key' }, payload: {} })).statusCode).toBe(400);
    expect((await c.app.inject({ method: 'POST', url: f.url.replace(f.revision.id,randomUUID()), headers: f.headers, payload: {} })).json().error.code).toBe('REVISION_NOT_FOUND');
    expect((await c.app.inject({ method: 'POST', url: f.url.replace(f.projectId,randomUUID()), headers: f.headers, payload: {} })).json().error.code).toBe('PROJECT_NOT_FOUND');
  });
}
