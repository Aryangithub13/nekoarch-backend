import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { specification } from '../../../packages/construction-calculations/tests/fixtures.js';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { modelHash } from '../src/lib/generation-identity.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const as = (name: string) => ({ authorization: `Bearer ${name}` });

/**
 * B46 S1: one end-to-end scenario across the pipeline, through HTTP only, on PostgreSQL with every migration applied:
 * project → generation → feasibility → routing → instruction → plan → selective execution → verification → review → 3D delivery → undo/restore,
 * with tenant isolation checked at the end. Stage timings are recorded for the release evidence (they are local measurements, not targets).
 */
describe('B46 S1: end-to-end text-to-revision pipeline on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>;
  const users: Record<string, string> = {}, timings: Record<string, number> = {};
  beforeAll(async () => {
    db = await startTestDatabase();
    for (const name of ['owner', 'reviewer', 'outsider']) users[name] = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    const env = parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false',
      PROJECT_COMMIT_SECRET: secret });
    app = buildApp({ env, backend: createPgBackend(db.pool, users), captureError: () => undefined });
    await app.ready();
  }, 120_000);
  afterAll(async () => {
    // Written first: database teardown can fail on Windows (EBUSY) after every assertion has passed.
    if (process.env.B46_TIMINGS_FILE) (await import('node:fs')).writeFileSync(process.env.B46_TIMINGS_FILE, JSON.stringify(timings, null, 2));
    await app?.close(); await db?.stop();
  });

  const send = async (user: string, method: 'GET' | 'POST', url: string, payload?: unknown, status = method === 'POST' ? 201 : 200) => {
    const r = await app.inject({ method, url, headers: as(user), ...(payload === undefined ? {} : { payload: payload as Json }) });
    expect(r.statusCode, `${method} ${url}: ${r.body.slice(0, 600)}`).toBe(status);
    return r.json() as Json;
  };
  const stage = async <T>(name: string, run: () => Promise<T>) => { const t = performance.now(); const v = await run(); timings[name] = Math.round(performance.now() - t); return v; };

  it('runs the pipeline without resetting the project, rewriting history or leaking across tenants', async () => {
    const projectId = await stage('project', async () => (await send('owner', 'POST', '/api/projects', { title: 'B46 end to end' })).id as string);
    const P = `/api/projects/${projectId}`;
    const r1 = await stage('generation', async () => (await send('owner', 'POST', `${P}/revisions/generate`, { requirements: parametricInput(true) })).revision as Json);

    // An ambitious brief is assessed honestly; the generated two-storey scope is within the engines.
    const feasibility = await stage('feasibility', () => send('owner', 'POST', `${P}/feasibility/assessments`, { text: 'A 2 storey L-shaped house with 4 rooms' }, 200));
    expect(feasibility.status).toBe('WITHIN_ENGINE_SCOPE');
    const routing = await stage('routing', () => send('owner', 'POST', `${P}/routing/decisions`, { targetScopes: ['INTERIOR_FINISHES'] }, 200));
    expect(routing.invoke.map((i: Json) => i.capabilityId)).toEqual(['interior.design']);

    // Natural language → grounded change set → plan → approved execution with selective regeneration and an independent verification branch.
    const resolution = await stage('instruction', () => send('owner', 'POST', `${P}/revisions/${r1.id}/instructions/resolve`,
      { text: 'Change only the kitchen floor to stone tile and keep everything else' }, 200));
    expect(resolution.status, JSON.stringify(resolution.clarifications)).toBe('RESOLVED');
    const changeSet = { ...resolution.changeSetDraft, regenerate: { materials: { specification: specification() }, verification: {} } };
    const plan = await stage('plan', () => send('owner', 'POST', `${P}/integration/plans`, changeSet, 200));
    expect(plan.status).toBe('READY_FOR_APPROVAL');
    const run = await stage('execution', () => send('owner', 'POST', `${P}/integration/plans/execute`, { changeSet, planHash: plan.planHash,
      consent: { acceptPlan: true, acceptLocks: true } }));
    expect([run.status, run.tasks.every((t: Json) => t.status === 'COMPLETED')]).toEqual(['COMPLETED', true]);
    expect(run.checks.every((c: Json) => c.result === 'PASSED')).toBe(true);
    const r2 = run.committedRevisionId as string;
    expect(run.tasks.find((t: Json) => t.taskId === 'COMPLEX_VERIFICATION').report.status).toBe('VERIFIED');

    // Review: a reviewer traces exactly what changed and approves the model they saw.
    const C = `${P}/collaboration`;
    await send('owner', 'POST', `${C}/members`, { userId: users.reviewer, role: 'reviewer' });
    const view = await stage('review', async () => {
      const v = await send('reviewer', 'GET', `${C}/revisions/${r2}`);
      const kitchen = v.audit.changes.changes.map((c: Json) => c.elementId);
      await send('reviewer', 'POST', `${C}/revisions/${r2}/comments`, { body: 'Stone tile approved for the kitchen', elementIds: kitchen });
      await send('reviewer', 'POST', `${C}/revisions/${r2}/reviews`, { decision: 'APPROVED', expectedModelHash: v.revision.modelHash });
      return v;
    });
    expect(view.audit.changes.changes).toHaveLength(1);
    expect(view.audit.changes.changes[0]).toMatchObject({ collection: 'spaces', change: 'MODIFIED', fields: ['finishes'] });

    // 3D delivery of the committed revision: measured, anchored to the same element ids.
    const delivery = await stage('scene', async () => {
      await send('owner', 'POST', `${P}/revisions/${r2}/scene/artifacts`, {});
      return send('owner', 'GET', `${P}/revisions/${r2}/scene/delivery`);
    });
    expect(delivery.chunks).toHaveLength(2);
    expect(delivery.pickAnchors.some((a: Json) => a.sourceEntityId === view.audit.changes.changes[0].elementId)).toBe(true);

    // Undo: a RESTORE that creates a new descendant with the original model; history is kept.
    const restored = await stage('restore', async () => {
      const undo = await send('owner', 'POST', `${P}/revisions/${r2}/instructions/resolve`, { text: 'Undo that' }, 200);
      const op = await send('owner', 'POST', undo.handoff.route, undo.handoff.body);
      const candidate = await send('owner', 'POST', `${P}/revision-operations/${op.id}/execute`, { preflightHash: op.preflightHash,
        consent: { acceptLocks: true, acceptQuote: true } }, 200);
      return send('owner', 'POST', `${P}/revision-operations/${op.id}/approve`, { preflightHash: op.preflightHash, candidateHash: candidate.candidateHash }, 201);
    });
    const r3 = restored.commit.revision as Json;
    expect([r3.revisionNumber, r3.parentRevisionId, modelHash(r3.model)]).toEqual([3, r2, modelHash(r1.model)]);
    const history = await send('owner', 'GET', `${P}/revisions?limit=10`);
    expect(history.items.map((x: Json) => x.revisionNumber)).toEqual([3, 2, 1]);

    // Tenant isolation across every slice.
    for (const url of [P, `${P}/revisions/${r2}/scene/delivery`, `${C}/revisions/${r2}`, `${P}/revisions/${r2}/verification`])
      expect((await app.inject({ url, headers: as('outsider') })).statusCode, url).toBe(404);
    expect((await app.inject({ method: 'POST', url: `${P}/revisions/${r2}/instructions/resolve`, headers: as('outsider'), payload: { text: 'undo' } })).statusCode).toBe(404);
  });
});
