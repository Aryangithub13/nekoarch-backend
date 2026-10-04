import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ProjectTestContext } from './project-acceptance.js';
import { parametricInput } from './parametric-fixtures.js';
import { RevisionCommitResponseSchema } from '../apps/api/src/contracts/projects.js';
import { ConversationSchema } from '../apps/api/src/contracts/conversations.js';
import { workflowPayload } from './workflow-acceptance.js';

export function parametricAcceptance(context: () => ProjectTestContext) {
  it('Phase 22: signed L/setback revision, exact proposal approval, immutable ancestry, concurrency, owner isolation and quantities', async () => {
    const { app, owner, other } = context();
    const created = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Phase 22 acceptance' } });
    expect(created.statusCode, created.body).toBe(201);
    const projectId = created.json().id as string, url = `/api/projects/${projectId}`;
    const first = await app.inject({ method: 'POST', url: `${url}/revisions/generate`, headers: owner, payload: { requirements: parametricInput(true) } });
    expect(first.statusCode, first.body).toBe(201);
    const original = RevisionCommitResponseSchema.parse(first.json()).revision;
    expect(original.generatorVersion).toBe('parametric-architecture-v1');
    expect(original.qa.status).not.toBe('FAIL');
    const conversationId = randomUUID(), conversationUrl = `${url}/conversations/${conversationId}`;
    const conversation = await app.inject({ method: 'POST', url: `${url}/conversations`, headers: owner, payload: { conversationId, baseRevisionId: original.id } });
    expect(conversation.statusCode, conversation.body).toBe(200);
    expect(ConversationSchema.parse(conversation.json()).state.solver).toBe('PARAMETRIC');
    const message = await app.inject({ method: 'POST', url: `${conversationUrl}/messages`, headers: owner,
      payload: { messageId: randomUUID(), expectedVersion: 0, baseRevisionId: original.id, text: 'Increase the ground floor west wing width to 10000 mm.' } });
    expect(message.statusCode, message.body).toBe(200);
    const state = ConversationSchema.parse(message.json()).state;
    expect(state.questions).toEqual([]); expect(state.unsupported).toEqual([]); expect(state.status).toBe('AWAITING_APPROVAL');
    const p = state.proposal!;
    expect(p.changedFields).toEqual(['parametricArchitecture']); expect(p.requirements.rooms).toEqual(original.normalizedRequirements!.rooms);
    const beforeApproval = await app.inject({ url, headers: owner }); expect(beforeApproval.json().currentRevision.id).toBe(original.id);
    const approval = { proposalId: p.id, proposalVersion: p.version, requirementsHash: p.requirementsHash, baseRevisionId: p.baseRevisionId, approve: true };
    const responses = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: `${conversationUrl}/proposals/approve`, headers: owner, payload: approval })));
    const accepted = responses.find(r => r.statusCode === 200); expect(accepted, responses.map(r => r.body).join('\n')).toBeDefined();
    expect(responses.every(r => [200, 409].includes(r.statusCode))).toBe(true);
    const revision = RevisionCommitResponseSchema.parse(accepted!.json()).revision;
    expect(revision.parentRevisionId).toBe(original.id); expect(revision.identity!.modelHash).not.toBe(original.identity!.modelHash);
    const reread = await app.inject({ url: `${url}/revisions/${original.id}`, headers: owner }); expect(reread.json()).toEqual(original);
    expect((await app.inject({ url: `${url}/revisions/${original.id}`, headers: other })).statusCode).toBe(404);
    const stale = await app.inject({ method: 'POST', url: `${url}/revisions/generate`, headers: owner, payload: { baseRevisionId: original.id, requirements: parametricInput(true) } }); expect(stale.statusCode).toBe(409);
    const payload = { ...workflowPayload(), source: { kind: 'REVISION', sourceRevisionId: revision.id } };
    const workflow = await app.inject({ method: 'POST', url: `${url}/workflows`, headers: { ...owner, 'idempotency-key': randomUUID() }, payload });
    expect(workflow.statusCode, workflow.body).toBe(201);
    expect(workflow.json().status).toBe('COMPLETED');
  });
}
