import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { RevisionCollaborationSchema, WorkspaceResponseSchema } from '../src/collaboration/contracts.js';
import { CHANGE_SET_VERSION } from '../src/contracts/integration.js';
import { modelHash } from '../src/lib/generation-identity.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const as = (name: string) => ({ authorization: `Bearer ${name}` });
const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false',
  PROJECT_COMMIT_SECRET: secret });

describe('B44 S1: members, element-anchored comments, reviews and the change audit on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>;
  const users: Record<string, string> = {};
  beforeAll(async () => {
    db = await startTestDatabase();
    for (const name of ['owner', 'editor', 'reviewer', 'viewer', 'outsider']) users[name] = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, users), captureError: () => undefined });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.stop(); });

  const call = (user: string | null, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: user ? as(user) : {}, ...(payload === undefined ? {} : { payload: payload as Json }) });
  const ok = async (user: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, status = method === 'POST' ? 201 : 200) => {
    const r = await call(user, method, url, payload);
    expect(r.statusCode, `${method} ${url}: ${r.body.slice(0, 500)}`).toBe(status);
    return r.json() as Json;
  };
  const code = async (user: string | null, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) => {
    const r = await call(user, method, url, payload);
    return [r.statusCode, (r.json() as Json).error?.code ?? (r.json() as Json).code ?? null];
  };

  it('gives each role exactly its permissions, anchors comments to real elements, binds reviews to the model hash, and traces every change', async () => {
    const projectId = (await ok('owner', 'POST', '/api/projects', { title: 'B44' })).id as string;
    const base = (await ok('owner', 'POST', `/api/projects/${projectId}/revisions`, { model: authored() })).revision as Json;
    // A second revision through a B40 plan, so the audit has an operation, an approver and an element change.
    const changeSet = { changeSetVersion: CHANGE_SET_VERSION, baseRevisionId: base.id, changes: [{ operation: 'modify', elementType: 'space', elementId: 'foyer',
      properties: { finishes: { floor: 'carpet' } } }] };
    const plan = await ok('owner', 'POST', `/api/projects/${projectId}/integration/plans`, changeSet, 200);
    const run = await ok('owner', 'POST', `/api/projects/${projectId}/integration/plans/execute`, { changeSet, planHash: plan.planHash, consent: { acceptPlan: true, acceptLocks: true } });
    const rev2 = run.committedRevisionId as string, root = `/api/projects/${projectId}/collaboration`;

    for (const [name, role] of [['editor', 'editor'], ['reviewer', 'reviewer'], ['viewer', 'viewer']] as const)
      expect(await ok('owner', 'POST', `${root}/members`, { userId: users[name], role })).toMatchObject({ userId: users[name], role, addedBy: users.owner });
    expect(await code('owner', 'POST', `${root}/members`, { userId: users.owner, role: 'viewer' })).toEqual([422, 'MEMBER_INVALID']);
    expect(await code('owner', 'POST', `${root}/members`, { userId: '00000000-0000-4000-8000-00000000dead', role: 'viewer' })).toEqual([422, 'MEMBER_INVALID']);
    expect(await code('editor', 'POST', `${root}/members`, { userId: users.outsider, role: 'viewer' })).toEqual([403, 'COLLABORATION_FORBIDDEN']);

    const w = WorkspaceResponseSchema.parse(await ok('reviewer', 'GET', root));
    expect([w.role, w.permissions, w.members.length, w.revisions.map(r => r.revisionNumber)]).toEqual(['reviewer', ['READ', 'COMMENT', 'REVIEW'], 3, [2, 1]]);
    // Membership reaches only the collaboration routes: the owner-only project route stays closed to members.
    expect((await call('reviewer', 'GET', `/api/projects/${projectId}`)).statusCode).toBe(404);
    expect((await call('outsider', 'GET', root)).statusCode).toBe(404);
    expect((await call(null, 'GET', root)).statusCode).toBe(401);

    // The audit: who asked, what, who approved, the event trail and exactly the changed element.
    const view = RevisionCollaborationSchema.parse(await ok('viewer', 'GET', `${root}/revisions/${rev2}`));
    expect(view.audit).toMatchObject({ revisionNumber: 2, parentRevisionId: base.id, createdBy: users.owner,
      operation: { kind: 'INTERIOR_FINISH_MODIFY', requestedBy: users.owner, approvedBy: users.owner } });
    expect(view.audit.operation!.events.map(e => e.eventType)).toEqual(expect.arrayContaining(['PREFLIGHT', 'CANDIDATE_READY', 'COMMITTED']));
    expect(view.audit.changes!.changes).toEqual([{ collection: 'spaces', elementId: 'foyer', change: 'MODIFIED', fields: ['finishes'] }]);
    expect(view.revision.modelHash).toBe(modelHash(view.revision.model as never));

    // Comments: anchored to stable ids of this revision; viewers read only; one level of replies.
    const comment = await ok('editor', 'POST', `${root}/revisions/${rev2}/comments`, { kind: 'CHANGE_REQUEST', body: 'Carpet in the foyer will wear fast', elementIds: ['foyer'] });
    expect(comment).toMatchObject({ authorRole: 'editor', kind: 'CHANGE_REQUEST', elementIds: ['foyer'] });
    expect(await code('editor', 'POST', `${root}/revisions/${rev2}/comments`, { body: 'x', elementIds: ['no-such-element'] })).toEqual([422, 'COMMENT_ELEMENT_INVALID']);
    expect(await code('viewer', 'POST', `${root}/revisions/${rev2}/comments`, { body: 'x' })).toEqual([403, 'COLLABORATION_FORBIDDEN']);
    const reply = await ok('reviewer', 'POST', `${root}/revisions/${rev2}/comments`, { body: 'Agreed', parentId: comment.id });
    expect(await code('owner', 'POST', `${root}/revisions/${rev2}/comments`, { body: 'nested', parentId: reply.id })).toEqual([422, 'COMMENT_PARENT_INVALID']);

    // Reviews: only the owner or a reviewer, and only against the model actually seen.
    const hash = view.revision.modelHash;
    expect(await code('reviewer', 'POST', `${root}/revisions/${rev2}/reviews`, { decision: 'APPROVED', expectedModelHash: modelHash(base.model) }))
      .toEqual([409, 'REVIEW_MODEL_MISMATCH']);
    expect(await code('editor', 'POST', `${root}/revisions/${rev2}/reviews`, { decision: 'APPROVED', expectedModelHash: hash })).toEqual([403, 'COLLABORATION_FORBIDDEN']);
    await ok('reviewer', 'POST', `${root}/revisions/${rev2}/reviews`, { decision: 'CHANGES_REQUESTED', note: 'See the foyer comment', expectedModelHash: hash });
    await ok('reviewer', 'POST', `${root}/revisions/${rev2}/reviews`, { decision: 'APPROVED', expectedModelHash: hash });
    const after = RevisionCollaborationSchema.parse(await ok('owner', 'GET', `${root}/revisions/${rev2}`));
    expect([after.reviews.length, after.reviewState.approvals, after.reviewState.changesRequested, after.comments.length]).toEqual([2, 1, 0, 2]);
    expect(after.claims).toEqual({ professionalCertification: 'NOT_CLAIMED', regulatoryApproval: 'NOT_CLAIMED' });

    // The record is immutable, and removal ends access.
    await expect(db.pool.query('update public.project_revision_comments set body = $1 where id = $2', ['edited', comment.id])).rejects.toThrow();
    await expect(db.pool.query('delete from public.project_revision_reviews where revision_id = $1', [rev2])).rejects.toThrow();
    expect(await ok('owner', 'DELETE', `${root}/members/${users.reviewer}`)).toEqual({ userId: users.reviewer, removed: true });
    expect((await call('reviewer', 'GET', `${root}/revisions/${rev2}`)).statusCode).toBe(404);
    expect(await code('owner', 'DELETE', `${root}/members/${users.reviewer}`)).toEqual([404, 'MEMBER_NOT_FOUND']);
  });

  // SEC-004: each cap is a count followed by an insert; without serialization, concurrent writes all see room and all insert.
  it('holds the comment and member caps under concurrent writes', async () => {
    const projectId = (await ok('owner', 'POST', '/api/projects', { title: 'B44 caps' })).id as string;
    const revisionId = ((await ok('owner', 'POST', `/api/projects/${projectId}/revisions`, { model: authored() })).revision as Json).id as string;
    const root = `/api/projects/${projectId}/collaboration`;
    const stored = async (sql: string) => Number((await db.pool.query(sql, [projectId])).rows[0].count);
    const tally = (codes: unknown[][]) => codes.reduce<Record<string, number>>((all, [s, c]) => ({ ...all, [`${s} ${c}`]: (all[`${s} ${c}`] ?? 0) + 1 }), {});

    const comment = (i: number) => code('owner', 'POST', `${root}/revisions/${revisionId}/comments`, { body: `comment ${i}` });
    for (let i = 0; i < 195; i++) expect(await comment(i)).toEqual([201, null]);
    expect(tally(await Promise.all(Array.from({ length: 40 }, (_, i) => comment(1000 + i)))))
      .toEqual({ '201 null': 5, '409 COLLABORATION_LIMIT_REACHED': 35 });
    expect(await stored('select count(*) from public.project_revision_comments where project_id = $1')).toBe(200);

    const candidates = await Promise.all(Array.from({ length: 30 }, () => createTestUser(db.pool)));
    for (const userId of candidates.slice(0, 18)) await ok('owner', 'POST', `${root}/members`, { userId, role: 'viewer' });
    expect(tally(await Promise.all(candidates.slice(18).map(userId => code('owner', 'POST', `${root}/members`, { userId, role: 'viewer' })))))
      .toEqual({ '201 null': 2, '409 COLLABORATION_LIMIT_REACHED': 10 });
    expect(await stored('select count(*) from public.project_members where project_id = $1 and removed_at is null')).toBe(20);
  }, 120_000);
});
