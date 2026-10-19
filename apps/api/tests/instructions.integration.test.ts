import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { generated } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { InstructionResolutionSchema } from '../src/instructions/contracts.js';
import { IntegrationExecutionSchema, IntegrationPlanSchema } from '../src/contracts/integration.js';
import { diffElements } from '../src/integration/element-diff.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const owner = { authorization: 'Bearer owner' }, intruder = { authorization: 'Bearer intruder' };
const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false',
  PROJECT_COMMIT_SECRET: secret });

describe('B41 S1: grounded instruction resolution over HTTP, composed with B40 plans', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    db = await startTestDatabase();
    const ownerId = await createTestUser(db.pool), intruderId = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, intruder: intruderId }), captureError: () => undefined });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.stop(); });

  const ok = async (url: string, payload?: unknown, status = payload === undefined ? 200 : 201, headers: Record<string, string> = owner) => {
    const r = await app.inject({ method: payload === undefined ? 'GET' : 'POST', url, headers, ...(payload === undefined ? {} : { payload: payload as Json }) });
    expect(r.statusCode, `${url}: ${r.body.slice(0, 600)}`).toBe(status);
    return r.json() as Json;
  };
  const resolve = async (projectId: string, revisionId: string, text: string) =>
    InstructionResolutionSchema.parse(await ok(`/api/projects/${projectId}/revisions/${revisionId}/instructions/resolve`, { text }, 200));
  /** One conversational turn: resolve, preview the resulting plan, approve exactly that plan. */
  const turn = async (projectId: string, revisionId: string, text: string) => {
    const r = await resolve(projectId, revisionId, text);
    expect(r.status, JSON.stringify(r.clarifications)).toBe('RESOLVED');
    const plan = IntegrationPlanSchema.parse(await ok(r.handoff!.route, r.handoff!.body, 200));
    expect(plan.status).toBe('READY_FOR_APPROVAL');
    const run = IntegrationExecutionSchema.parse(await ok(`${r.handoff!.route}/execute`, { changeSet: r.changeSetDraft, planHash: plan.planHash,
      consent: { acceptPlan: true, acceptLocks: true } }));
    expect(run.status).toBe('COMPLETED');
    return { resolution: r, run };
  };

  it('refines only the selected room across two turns, never resetting the project or touching unrelated data, then undoes the last turn', async () => {
    const projectId = (await ok('/api/projects', { title: 'B41' })).id as string;
    const base = (await ok(`/api/projects/${projectId}/revisions`, { model: generated() })).revision as Json;

    const first = await turn(projectId, base.id, 'Change only the kitchen floor to stone tile');
    expect(first.resolution.targets[0]).toMatchObject({ resolution: 'EXACT', elementIds: ['space-kitchen-1'] });
    const r2 = (await ok(`/api/projects/${projectId}/revisions/${first.run.committedRevisionId}`)) as Json;
    const second = await turn(projectId, r2.id, 'Now paint the kitchen walls warm neutral, keep everything else');
    const r3 = (await ok(`/api/projects/${projectId}/revisions/${second.run.committedRevisionId}`)) as Json;

    // Across both turns exactly one element changed, and only its finishes; the first turn's floor finish survived the second.
    const d = diffElements(base.model, r3.model);
    expect(d.changes).toEqual([{ collection: 'spaces', elementId: 'space-kitchen-1', change: 'MODIFIED', fields: ['finishes'] }]);
    expect(r3.model.spaces.find((s: Json) => s.id === 'space-kitchen-1').finishes).toEqual({ floor: 'stone-tile', walls: 'paint-warm-neutral' });
    expect([r3.revisionNumber, (await ok(`/api/projects/${projectId}`)).currentRevision.id]).toEqual([3, r3.id]);

    // "Undo" on the newest revision grounds to its parent and hands off a RESTORE preflight (a new descendant, never a rewrite).
    const undo = await resolve(projectId, r3.id, 'Undo that');
    expect(undo).toMatchObject({ intent: 'RESTORE_PRIOR', status: 'RESOLVED', revisionRefs: [{ kind: 'PREVIOUS', revisionNumber: 2, revisionId: r2.id }] });
    const preflight = await ok(undo.handoff!.route, undo.handoff!.body);
    expect(preflight.status).toBe('AWAITING_CONSENT');
    expect((await ok(`/api/projects/${projectId}`)).currentRevision.id).toBe(r3.id); // nothing applied by resolving or preflighting
  });

  it('asks instead of choosing, is deterministic, and is owner-only', async () => {
    const projectId = (await ok('/api/projects', { title: 'B41 owner' })).id as string;
    const base = (await ok(`/api/projects/${projectId}/revisions`, { model: generated() })).revision as Json;
    const url = `/api/projects/${projectId}/revisions/${base.id}/instructions/resolve`;
    const a = await resolve(projectId, base.id, 'Make the bedroom floor carpet');
    expect([a.status, a.targets[0]!.candidates.length, a.changeSetDraft]).toEqual(['NEEDS_CLARIFICATION', 2, null]);
    expect(await resolve(projectId, base.id, 'Make the bedroom floor carpet')).toEqual(a);
    expect((await app.inject({ method: 'POST', url, headers: intruder, payload: { text: 'undo' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url, payload: { text: 'undo' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url, headers: owner, payload: { text: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url, headers: owner, payload: { text: 'x', extra: 1 } })).statusCode).toBe(400);
    expect((await ok(`/api/projects/${projectId}/revisions?limit=10`)).items).toHaveLength(1);
  });
});
