import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { frameInput } from '../../../test-support/structural-fixtures.js';
import { specification } from '../../../packages/construction-calculations/tests/fixtures.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { CHANGE_SET_VERSION, ChangeSetSchema, IntegrationExecutionSchema, IntegrationPlanSchema, type TaskKind } from '../src/contracts/integration.js';
import { ApiError } from '../src/lib/errors.js';
import { executeIntegrationPlan } from '../src/services/integration-service.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const owner = { authorization: 'Bearer owner' };
const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false',
  PROJECT_COMMIT_SECRET: secret });
const consent = { acceptPlan: true, acceptLocks: true };
const FOYER = { operation: 'modify', elementType: 'space', elementId: 'foyer', properties: { finishes: { floor: 'stone-tile' } } };

describe('B40 S2: independent analysis branches and task budgets on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, backend: ReturnType<typeof createPgBackend>, ownerId: string, secret: string;
  beforeAll(async () => {
    db = await startTestDatabase();
    ownerId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    backend = createPgBackend(db.pool, { owner: ownerId });
    app = buildApp({ env: env(secret), backend, captureError: () => undefined });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.stop(); });

  const ok = async (url: string, payload?: unknown, status = payload === undefined ? 200 : 201, headers: Record<string, string> = owner) => {
    const r = await app.inject({ method: payload === undefined ? 'GET' : 'POST', url, headers, ...(payload === undefined ? {} : { payload: payload as Json }) });
    expect(r.statusCode, `${url}: ${r.body.slice(0, 600)}`).toBe(status);
    return r.json() as Json;
  };
  const project = async () => {
    const projectId = (await ok('/api/projects', { title: 'B40 S2' })).id as string;
    const base = (await ok(`/api/projects/${projectId}/revisions`, { model: authored() })).revision as Json;
    return { projectId, base, plans: `/api/projects/${projectId}/integration/plans` };
  };
  const changeSet = (baseRevisionId: string, regenerate: Json, limits: Json = {}) =>
    ({ changeSetVersion: CHANGE_SET_VERSION, baseRevisionId, changes: [FOYER], preserve: [{ scope: 'STRUCTURE' }], regenerate, limits });
  const all = () => ({ materials: { specification: specification() }, structural: frameInput(authored()), verification: {} });
  const statuses = (e: { tasks: { taskId: string; status: string }[] }) => e.tasks.map(t => [t.taskId, t.status]);

  it('plans the materials chain and the structural and verification branches, each depending only on the commit', async () => {
    const p = await project(), plan = IntegrationPlanSchema.parse(await ok(p.plans, changeSet(p.base.id, all()), 200));
    expect(plan.status).toBe('READY_FOR_APPROVAL');
    expect(plan.tasks.map(t => [t.taskId, t.branch, t.dependsOn.join()])).toEqual([['MODEL_PREFLIGHT', 'MODEL', ''], ['MODEL_CANDIDATE', 'MODEL', 'MODEL_PREFLIGHT'],
      ['MODEL_COMMIT', 'MODEL', 'MODEL_CANDIDATE'], ['QUANTITY_TAKEOFF', 'MATERIALS_BUDGET', 'MODEL_COMMIT'], ['CONSTRUCTION_CALCULATION', 'MATERIALS_BUDGET', 'QUANTITY_TAKEOFF'],
      ['STRUCTURAL_ANALYSIS', 'STRUCTURAL', 'MODEL_COMMIT'], ['COMPLEX_VERIFICATION', 'VERIFICATION', 'MODEL_COMMIT']]);
    expect(plan.quote).toMatchObject({ taskCount: 7, maxTasks: null, externalCostUsd: 0 });
    expect(plan.outputs.filter(o => o.action === 'REGENERATE').map(o => o.module).sort())
      .toEqual(['COMPLEX_VERIFICATION', 'CONSTRUCTION_CALCULATION', 'QUANTITY_TAKEOFF', 'STRUCTURAL_ANALYSIS']);
  });

  it('a failed branch skips only its own dependants; the independent branches complete on the committed revision', async () => {
    const p = await project(), body = changeSet(p.base.id, all()), plan = IntegrationPlanSchema.parse(await ok(p.plans, body, 200));
    const failAt = (task: TaskKind) => async (t: TaskKind) => { if (t === task) throw new ApiError(503, 'INJECTED_FAULT', `Injected failure before ${t}`); };
    const run = await executeIntegrationPlan(backend.repository('owner'), ownerId, p.projectId, { changeSet: ChangeSetSchema.parse(body), planHash: plan.planHash },
      { secret, beforeTask: failAt('QUANTITY_TAKEOFF'), idempotencyKey: 'b40-s2-branches' });
    expect(run.status).toBe('PARTIAL');
    expect(statuses(run)).toEqual([['MODEL_PREFLIGHT', 'COMPLETED'], ['MODEL_CANDIDATE', 'COMPLETED'], ['MODEL_COMMIT', 'COMPLETED'], ['QUANTITY_TAKEOFF', 'FAILED'],
      ['CONSTRUCTION_CALCULATION', 'SKIPPED'], ['STRUCTURAL_ANALYSIS', 'COMPLETED'], ['COMPLEX_VERIFICATION', 'COMPLETED']]);
    const structural = run.tasks.find(t => t.taskId === 'STRUCTURAL_ANALYSIS')!, verification = run.tasks.find(t => t.taskId === 'COMPLEX_VERIFICATION')!;
    expect(structural).toMatchObject({ revisionId: run.committedRevisionId, artifactId: expect.any(String) });
    expect(verification.report).toMatchObject({ status: 'VERIFIED', inputHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    // The verification checkpoint is the same report the B34 route derives for the committed revision.
    const direct = await ok(`/api/projects/${p.projectId}/revisions/${run.committedRevisionId}/verification`);
    expect(direct.inputHash).toBe(verification.report!.inputHash);
    expect(run.outputs.find(o => o.module === 'STRUCTURAL_ANALYSIS' && o.revisionId === run.committedRevisionId)?.freshness).toBe('current');

    // A keyed retry replays every completed checkpoint (one structural analysis, one commit) and runs the failed branch only.
    const retry = IntegrationExecutionSchema.parse(await ok(`${p.plans}/execute`, { changeSet: body, planHash: plan.planHash, consent }, 201,
      { ...owner, 'idempotency-key': 'b40-s2-branches' }));
    expect(retry.status).toBe('COMPLETED');
    expect(statuses(retry)).toEqual([['MODEL_PREFLIGHT', 'REPLAYED'], ['MODEL_CANDIDATE', 'REPLAYED'], ['MODEL_COMMIT', 'REPLAYED'], ['QUANTITY_TAKEOFF', 'COMPLETED'],
      ['CONSTRUCTION_CALCULATION', 'COMPLETED'], ['STRUCTURAL_ANALYSIS', 'REPLAYED'], ['COMPLEX_VERIFICATION', 'COMPLETED']]);
    expect(retry.tasks.find(t => t.taskId === 'STRUCTURAL_ANALYSIS')!.artifactId).toBe(structural.artifactId);
    const analyses = await ok(`/api/projects/${p.projectId}/revisions/${run.committedRevisionId}/structural/analyses`);
    expect(analyses.items).toHaveLength(1);
  });

  it('refuses a plan larger than the caller\'s task ceiling, at preview and at execution, writing nothing', async () => {
    const p = await project(), body = changeSet(p.base.id, all(), { maxTasks: 5 });
    const plan = IntegrationPlanSchema.parse(await ok(p.plans, body, 200));
    expect(plan.status).toBe('OVER_BUDGET');
    expect(plan.reasons.map(r => r.code)).toContain('TASK_BUDGET_EXCEEDED');
    expect(plan.quote).toMatchObject({ taskCount: 7, maxTasks: 5 });
    const run = IntegrationExecutionSchema.parse(await ok(`${p.plans}/execute`, { changeSet: body, planHash: plan.planHash, consent }, 200));
    expect([run.status, run.committedRevisionId, run.reasons[0]!.code]).toEqual(['REFUSED', null, 'PLAN_OVER_BUDGET']);
    expect((await ok(`/api/projects/${p.projectId}`)).currentRevision.id).toBe(p.base.id);
    // Within the ceiling the same change set is executable.
    const fits = IntegrationPlanSchema.parse(await ok(p.plans, changeSet(p.base.id, { verification: {} }, { maxTasks: 4 }), 200));
    expect([fits.status, fits.quote.taskCount]).toEqual(['READY_FOR_APPROVAL', 4]);
  });
});
