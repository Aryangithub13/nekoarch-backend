import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleCostingPolicy } from '@designflow/boq-cost';
import { asPrincipal, createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { specification } from '../../../packages/construction-calculations/tests/fixtures.js';
import { authored, generated } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { ProjectManifestSchema } from '../src/contracts/project-manifest.js';
import { SpecialistResultSchema, SPECIALIST_VERSION } from '../src/contracts/specialists.js';
import { CHANGE_SET_VERSION, ChangeSetSchema, IntegrationExecutionSchema, IntegrationPlanSchema, type TaskKind } from '../src/contracts/integration.js';
import { ApiError } from '../src/lib/errors.js';
import { modelHash } from '../src/lib/generation-identity.js';
import { executeIntegrationPlan } from '../src/services/integration-service.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const owner = { authorization: 'Bearer owner' }, intruder = { authorization: 'Bearer intruder' };
const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false',
  PROJECT_COMMIT_SECRET: secret });
const consent = { acceptPlan: true, acceptLocks: true };
const FOYER = { operation: 'modify', elementType: 'space', elementId: 'foyer', properties: { finishes: { floor: 'ceramic-tile', walls: 'paint-warm-neutral' } } };
const MATERIALS = () => ({ specification: specification() });
const BUDGET = { rateBookId: 'sample-inr-v1', costingPolicy: sampleCostingPolicy() };
const COLLECTIONS = ['levels', 'spaces', 'walls', 'openings', 'stairs', 'slabs', 'columns', 'dimensions', 'specifications'] as const;

describe('B40 S1: change-set plans and checkpointed selective regeneration on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, backend: ReturnType<typeof createPgBackend>, ownerId: string, secret: string;
  beforeAll(async () => {
    db = await startTestDatabase();
    ownerId = await createTestUser(db.pool);
    const intruderId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    backend = createPgBackend(db.pool, { owner: ownerId, intruder: intruderId });
    app = buildApp({ env: env(secret), backend, captureError: () => undefined });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.stop(); });

  const call = (url: string, payload?: unknown, headers: Record<string, string> = owner) =>
    app.inject({ method: payload === undefined ? 'GET' : 'POST', url, headers, ...(payload === undefined ? {} : { payload: payload as Json }) });
  const ok = async (url: string, payload?: unknown, status = payload === undefined ? 200 : 201, headers: Record<string, string> = owner) => {
    const r = await call(url, payload, headers);
    expect(r.statusCode, `${url}: ${r.body.slice(0, 600)}`).toBe(status);
    return r.json() as Json;
  };
  const project = async (model: unknown = authored()) => {
    const projectId = (await ok('/api/projects', { title: 'B40' })).id as string;
    const base = (await ok(`/api/projects/${projectId}/revisions`, { model })).revision as Json;
    return { projectId, base, plans: `/api/projects/${projectId}/integration/plans` };
  };
  const changeSet = (baseRevisionId: string, changes: unknown[], preserve: unknown[] = [], regenerate: Json = {}) =>
    ({ changeSetVersion: CHANGE_SET_VERSION, baseRevisionId, changes, preserve, regenerate });
  const preview = async (plans: string, body: Json) => IntegrationPlanSchema.parse(await ok(plans, body, 200));
  const execute = async (plans: string, body: Json, planHash: string, status: number, headers: Record<string, string> = owner) =>
    IntegrationExecutionSchema.parse(await ok(`${plans}/execute`, { changeSet: body, planHash, consent }, status, headers));
  const state = async (projectId: string) => {
    const p = await ok(`/api/projects/${projectId}`), history = await ok(`/api/projects/${projectId}/revisions?limit=100`);
    const ops = (await ok(`/api/projects/${projectId}/revision-operations`)).items as Json[];
    return { current: p.currentRevision?.id as string, revisions: (history.items as Json[]).length, operations: ops.map(o => o.status as string) };
  };
  const manifest = async (projectId: string, revisionId: string) => ProjectManifestSchema.parse(await ok(`/api/projects/${projectId}/revisions/${revisionId}/manifest`));
  const freshness = (m: Awaited<ReturnType<typeof manifest>>, module: string, artifactId: string) =>
    m.modules.find(x => x.module === module)!.artifacts!.find(a => a.artifactId === artifactId)!.freshness.state;
  const materialsOnBase = async (projectId: string, baseId: string) => SpecialistResultSchema.parse(await ok(`/api/projects/${projectId}/specialists/MATERIALS/requests`,
    { envelopeVersion: SPECIALIST_VERSION, baseRevisionId: baseId, operation: 'recompute', targetScopes: ['quantities'], outputConfig: { specification: specification() } }));
  const service = (projectId: string, body: Json, planHash: string, beforeTask: (t: TaskKind) => Promise<void>, idempotencyKey?: string) =>
    executeIntegrationPlan(backend.repository('owner'), ownerId, projectId, { changeSet: ChangeSetSchema.parse(body), planHash }, { secret, beforeTask, idempotencyKey });
  const failAt = (task: TaskKind) => async (t: TaskKind) => { if (t === task) throw new ApiError(503, 'INJECTED_FAULT', `Injected failure before ${t}`); };

  it('test 1 + 7: a single-room revision commits only that room, preserves every other element id, regenerates only the requested outputs, and marks the rest stale', async () => {
    const p = await project(), mat = await materialsOnBase(p.projectId, p.base.id);
    const [takeoff, construction] = mat.artifacts;
    const body = changeSet(p.base.id, [FOYER], [{ scope: 'STRUCTURE' }, { scope: 'ROOMS' }, { scope: 'EXTERIOR_APPEARANCE' }], { materials: MATERIALS() });

    // Preview: read only, the exact change, the DAG and the output impact.
    const plan = await preview(p.plans, body);
    expect(plan).toMatchObject({ status: 'READY_FOR_APPROVAL', baseRevisionId: p.base.id, baseModelHash: modelHash(p.base.model), projectCurrentRevisionId: p.base.id,
      approvalRequired: true, invalidation: { granularity: 'WHOLE_MODEL' }, quote: { execution: 'LOCAL_DETERMINISTIC', externalCostUsd: 0 },
      modelChange: { operationKind: 'INTERIOR_FINISH_MODIFY', preflightStatus: 'AWAITING_CONSENT' } });
    expect(plan.changes.map(c => [c.disposition, c.module, c.levelId])).toEqual([['SUPPORTED', 'INTERIOR', 'ground']]);
    expect(plan.diff!.changes).toEqual([{ collection: 'spaces', elementId: 'foyer', change: 'MODIFIED', fields: ['finishes'] }]);
    expect(plan.diff!.candidateModelHash).toBe(plan.modelChange!.candidateModelHash);
    expect(plan.tasks.map(t => [t.taskId, t.dependsOn])).toEqual([['MODEL_PREFLIGHT', []], ['MODEL_CANDIDATE', ['MODEL_PREFLIGHT']], ['MODEL_COMMIT', ['MODEL_CANDIDATE']],
      ['QUANTITY_TAKEOFF', ['MODEL_COMMIT']], ['CONSTRUCTION_CALCULATION', ['QUANTITY_TAKEOFF']]]);
    expect(plan.outputs.map(o => [o.module, o.action, o.baseArtifactIds])).toEqual([['QUANTITY_TAKEOFF', 'REGENERATE', [takeoff!.artifactId]],
      ['CONSTRUCTION_CALCULATION', 'REGENERATE', [construction!.artifactId]]]);
    expect(await state(p.projectId)).toEqual({ current: p.base.id, revisions: 1, operations: [] });
    // Deterministic: the same request previews the same plan hash.
    expect((await preview(p.plans, body)).planHash).toBe(plan.planHash);
    // A consent for a different plan (here: the regeneration configuration changed) is refused before anything runs.
    const changed = await call(`${p.plans}/execute`, { changeSet: { ...body, regenerate: {} }, planHash: plan.planHash, consent });
    expect([changed.statusCode, changed.json().error.code]).toEqual([409, 'INTEGRATION_PLAN_CHANGED']);

    // Execute: every checkpoint completes; the commit is the planned candidate.
    const run = await execute(p.plans, body, plan.planHash, 201);
    expect(run.status).toBe('COMPLETED');
    expect(run.tasks.map(t => [t.taskId, t.status])).toEqual([['MODEL_PREFLIGHT', 'COMPLETED'], ['MODEL_CANDIDATE', 'COMPLETED'], ['MODEL_COMMIT', 'COMPLETED'],
      ['QUANTITY_TAKEOFF', 'COMPLETED'], ['CONSTRUCTION_CALCULATION', 'COMPLETED']]);
    expect(run.checks.map(c => [c.check, c.result])).toEqual([['PREFLIGHT_MATCHES_PLAN', 'PASSED'], ['CANDIDATE_MATCHES_PLAN', 'PASSED'],
      ['COMMITTED_DIFF_MATCHES_PLAN', 'PASSED'], ['UNTARGETED_ELEMENTS_PRESERVED', 'PASSED']]);
    expect(run.diff).toEqual(plan.diff);
    const child = (await ok(`/api/projects/${p.projectId}/revisions/${run.committedRevisionId}`)) as Json;
    expect([child.parentRevisionId, modelHash(child.model)]).toEqual([p.base.id, plan.modelChange!.candidateModelHash]);
    // Preservation, independently of the service: every element other than the foyer has the same id, order and content; the foyer differs only in finishes.
    for (const c of COLLECTIONS) {
      const keep = (list: Json[]) => list.map(e => c === 'spaces' && e.id === 'foyer' ? { ...e, finishes: undefined } : e);
      expect(JSON.parse(JSON.stringify(keep(child.model[c])))).toEqual(JSON.parse(JSON.stringify(keep(p.base.model[c]))));
    }
    expect(child.model.spaces.find((s: Json) => s.id === 'foyer').finishes).toEqual(FOYER.properties.finishes);
    expect(child.model.spaces.find((s: Json) => s.id === 'studio').finishes).toBeUndefined();
    expect(await state(p.projectId)).toEqual({ current: child.id, revisions: 2, operations: ['COMMITTED'] });

    // Dependency invalidation: the base's outputs are stale against the new revision; the regenerated ones are current on it.
    const newTakeoff = run.tasks.find(t => t.taskId === 'QUANTITY_TAKEOFF')!.artifactId!, newConstruction = run.tasks.find(t => t.taskId === 'CONSTRUCTION_CALCULATION')!.artifactId!;
    const [oldM, newM] = [await manifest(p.projectId, p.base.id), await manifest(p.projectId, child.id)];
    expect([freshness(oldM, 'QUANTITY_TAKEOFF', takeoff!.artifactId), freshness(oldM, 'CONSTRUCTION_CALCULATION', construction!.artifactId)]).toEqual(['stale', 'stale']);
    expect([freshness(newM, 'QUANTITY_TAKEOFF', newTakeoff), freshness(newM, 'CONSTRUCTION_CALCULATION', newConstruction)]).toEqual(['current', 'current']);
    expect(run.outputs.map(o => [o.module, o.revisionId === child.id ? 'new' : 'base', o.freshness]).sort()).toEqual([
      ['CONSTRUCTION_CALCULATION', 'base', 'stale'], ['CONSTRUCTION_CALCULATION', 'new', 'current'], ['QUANTITY_TAKEOFF', 'base', 'stale'], ['QUANTITY_TAKEOFF', 'new', 'current']]);
    // Not requested, not run: no cost estimate exists for the new revision, and nothing reports one as current.
    expect(newM.modules.find(m => m.module === 'BOQ_COST')).toMatchObject({ artifactCount: 0, availability: 'NOT_GENERATED' });
    // Cross-specialist (B39): a budget on the stale base quantities is refused, never priced; on the regenerated ones it runs.
    const budget = (baseRevisionId: string, takeoffId: string, constructionCalculationId: string, status: number) => ok(`/api/projects/${p.projectId}/specialists/BUDGET/requests`,
      { envelopeVersion: SPECIALIST_VERSION, baseRevisionId, operation: 'recompute', targetScopes: ['cost'], outputConfig: { takeoffId, constructionCalculationId, ...BUDGET } }, status);
    const refused = SpecialistResultSchema.parse(await budget(p.base.id, takeoff!.artifactId, construction!.artifactId, 200));
    expect([refused.status, refused.reasons[0]!.code, refused.written]).toEqual(['STALE_DEPENDENCY', 'BASE_REVISION_SUPERSEDED', false]);
    expect(SpecialistResultSchema.parse(await budget(child.id, newTakeoff, newConstruction, 201)).written).toBe(true);
    // A repeated execution of the same plan cannot apply twice: the base is no longer current.
    const again = await execute(p.plans, body, plan.planHash, 200);
    expect([again.status, again.committedRevisionId, again.reasons[0]!.code]).toEqual(['REFUSED', null, 'BASE_REVISION_SUPERSEDED']);
    expect((await state(p.projectId)).revisions).toBe(2);
  });

  it('test 2: a change that conflicts with a preservation lock is refused with no model mutation and nothing stored', async () => {
    const p = await project();
    for (const preserve of [[{ scope: 'INTERIOR' }], [{ scope: 'LEVEL', levelId: 'ground' }]]) {
      const body = changeSet(p.base.id, [FOYER], preserve), plan = await preview(p.plans, body);
      expect([plan.status, plan.changes[0]!.reasons[0]!.code, plan.modelChange, plan.diff, plan.tasks]).toEqual(['BLOCKED_BY_LOCK', 'LOCK_CONFLICT', null, null, []]);
      const run = await execute(p.plans, body, plan.planHash, 200);
      expect([run.status, run.committedRevisionId, run.operationId, run.tasks]).toEqual(['REFUSED', null, null, []]);
    }
    // A mixed set is refused as a whole: the supported part is never applied on its own.
    const mixed = await preview(p.plans, changeSet(p.base.id, [FOYER, { operation: 'modify', elementType: 'wall', elementId: p.base.model.walls[0].id, properties: { thicknessMm: 1 } }]));
    expect([mixed.status, mixed.changes.map(c => c.disposition), mixed.tasks]).toEqual(['UNSUPPORTED', ['SUPPORTED', 'UNSUPPORTED'], []]);
    expect(await state(p.projectId)).toEqual({ current: p.base.id, revisions: 1, operations: [] });
    expect(modelHash(((await ok(`/api/projects/${p.projectId}/revisions/${p.base.id}`)) as Json).model)).toBe(modelHash(p.base.model));
  });

  it('test 3: a model change without requested regeneration marks every stored output stale and regenerates nothing', async () => {
    const p = await project(), mat = await materialsOnBase(p.projectId, p.base.id);
    const body = changeSet(p.base.id, [FOYER]), plan = await preview(p.plans, body);
    expect(plan.outputs.map(o => [o.module, o.action, o.taskId])).toEqual([['QUANTITY_TAKEOFF', 'MARK_STALE', null], ['CONSTRUCTION_CALCULATION', 'MARK_STALE', null]]);
    expect(plan.tasks.map(t => t.taskId)).toEqual(['MODEL_PREFLIGHT', 'MODEL_CANDIDATE', 'MODEL_COMMIT']);
    // Before execution the base outputs are current.
    expect(freshness(await manifest(p.projectId, p.base.id), 'QUANTITY_TAKEOFF', mat.artifacts[0]!.artifactId)).toBe('current');
    const run = await execute(p.plans, body, plan.planHash, 201);
    expect(run.status).toBe('COMPLETED');
    expect(run.outputs.map(o => [o.module, o.revisionId === p.base.id, o.freshness])).toEqual([['QUANTITY_TAKEOFF', true, 'stale'], ['CONSTRUCTION_CALCULATION', true, 'stale']]);
    const newM = await manifest(p.projectId, run.committedRevisionId!);
    for (const m of ['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST']) expect(newM.modules.find(x => x.module === m)!.artifactCount, m).toBe(0);
  });

  it('test 4a: a failure before the commit leaves no revision, cancels the operation, and keeps the base and its outputs current', async () => {
    const p = await project(), mat = await materialsOnBase(p.projectId, p.base.id);
    const body = changeSet(p.base.id, [FOYER], [], { materials: MATERIALS() }), plan = await preview(p.plans, body);
    for (const task of ['MODEL_CANDIDATE', 'MODEL_COMMIT'] as const) {
      const run = await service(p.projectId, body, plan.planHash, failAt(task));
      expect([run.status, run.committedRevisionId, run.diff]).toEqual(['FAILED', null, null]);
      expect(run.tasks.find(t => t.taskId === task)).toMatchObject({ status: 'FAILED', error: { code: 'INJECTED_FAULT' } });
      expect(run.tasks.filter(t => t.status === 'SKIPPED').map(t => t.taskId)).toEqual(plan.tasks.map(t => t.taskId).slice(plan.tasks.findIndex(t => t.taskId === task) + 1));
    }
    expect(await state(p.projectId)).toEqual({ current: p.base.id, revisions: 1, operations: ['CANCELLED', 'CANCELLED'] });
    expect(freshness(await manifest(p.projectId, p.base.id), 'QUANTITY_TAKEOFF', mat.artifacts[0]!.artifactId)).toBe('current');
    // The previous revision stays usable: the same plan still executes.
    expect((await execute(p.plans, body, plan.planHash, 201)).status).toBe('COMPLETED');
  });

  it('test 4b: a downstream failure keeps the committed revision, skips its dependants, and a keyed retry resumes after the last checkpoint', async () => {
    const p = await project();
    const body = changeSet(p.base.id, [FOYER], [], { materials: MATERIALS(), budget: BUDGET }), plan = await preview(p.plans, body);
    const first = await service(p.projectId, body, plan.planHash, failAt('CONSTRUCTION_CALCULATION'), 'b40-retry');
    expect(first.status).toBe('PARTIAL');
    expect(first.tasks.map(t => [t.taskId, t.status])).toEqual([['MODEL_PREFLIGHT', 'COMPLETED'], ['MODEL_CANDIDATE', 'COMPLETED'], ['MODEL_COMMIT', 'COMPLETED'],
      ['QUANTITY_TAKEOFF', 'COMPLETED'], ['CONSTRUCTION_CALCULATION', 'FAILED'], ['BOQ_COST', 'SKIPPED']]);
    expect(first.reasons[0]!.code).toBe('DOWNSTREAM_TASK_FAILED');
    expect(await state(p.projectId)).toEqual({ current: first.committedRevisionId, revisions: 2, operations: ['COMMITTED'] });
    // Retry with the same key: completed checkpoints replay (nothing is committed twice), the failed task and its dependant run.
    const retry = await execute(p.plans, body, plan.planHash, 201, { ...owner, 'idempotency-key': 'b40-retry' });
    expect(retry.status).toBe('COMPLETED');
    expect(retry.committedRevisionId).toBe(first.committedRevisionId);
    expect(retry.tasks.map(t => [t.taskId, t.status])).toEqual([['MODEL_PREFLIGHT', 'REPLAYED'], ['MODEL_CANDIDATE', 'REPLAYED'], ['MODEL_COMMIT', 'REPLAYED'],
      ['QUANTITY_TAKEOFF', 'REPLAYED'], ['CONSTRUCTION_CALCULATION', 'COMPLETED'], ['BOQ_COST', 'COMPLETED']]);
    expect(retry.tasks.find(t => t.taskId === 'QUANTITY_TAKEOFF')!.artifactId).toBe(first.tasks.find(t => t.taskId === 'QUANTITY_TAKEOFF')!.artifactId);
    expect(retry.outputs.filter(o => o.revisionId === retry.committedRevisionId).map(o => [o.module, o.freshness])).toEqual([['QUANTITY_TAKEOFF', 'current'],
      ['CONSTRUCTION_CALCULATION', 'current'], ['BOQ_COST', 'current']]);
    expect(await state(p.projectId)).toEqual({ current: first.committedRevisionId, revisions: 2, operations: ['COMMITTED'] });
  });

  it('test 5: a stale base is refused before anything is written, and a concurrent commit during execution is never overwritten', async () => {
    const p = await project(), body = changeSet(p.base.id, [FOYER]), plan = await preview(p.plans, body);
    // Concurrent: another revision commits between the candidate and the commit; SQL compare-and-swap refuses ours.
    let newer = '';
    const run = await service(p.projectId, body, plan.planHash, async t => {
      if (t === 'MODEL_COMMIT') newer = ((await ok(`/api/projects/${p.projectId}/revisions`, { model: { ...authored(), name: 'Concurrent edit' }, baseRevisionId: p.base.id })).revision as Json).id;
    });
    expect([run.status, run.committedRevisionId]).toEqual(['FAILED', null]);
    // Refused by the Phase 30 SQL compare-and-swap on the base, not by the test hook.
    expect(run.tasks.find(t => t.taskId === 'MODEL_COMMIT')).toMatchObject({ status: 'FAILED', error: { code: 'REVISION_BASE_STALE' } });
    const after = await state(p.projectId);
    expect([after.current, after.revisions]).toEqual([newer, 2]);
    expect(((await ok(`/api/projects/${p.projectId}/revisions/${newer}`)) as Json).model.name).toBe('Concurrent edit');
    // Stale base: the plan says so, and execution writes nothing.
    const stale = await preview(p.plans, body);
    expect([stale.status, stale.projectCurrentRevisionId, stale.reasons.map(r => r.code)]).toEqual(['STALE_BASE', newer, ['BASE_REVISION_SUPERSEDED']]);
    const refused = await execute(p.plans, body, stale.planHash, 200);
    expect([refused.status, refused.committedRevisionId, refused.reasons[0]!.code]).toEqual(['REFUSED', null, 'BASE_REVISION_SUPERSEDED']);
    expect((await state(p.projectId)).current).toBe(newer);
    expect((await state(p.projectId)).revisions).toBe(2);
  });

  it('test 6: a storey addition is refused with the applicable limit and the required checks; the revision is unchanged', async () => {
    const add = { operation: 'add', elementType: 'level', elementId: 'level-new', properties: { kind: 'storey' } };
    const two = await project(generated(2)), mat = await materialsOnBase(two.projectId, two.base.id);
    const plan = await preview(two.plans, changeSet(two.base.id, [add], [], { materials: MATERIALS() }));
    expect([plan.status, plan.changes[0]!.reasons[0]!.code, plan.changes[0]!.limit]).toEqual(['UNSUPPORTED', 'GEOMETRY_LIMIT_EXCEEDED',
      { limitId: 'GENERATION_MAX_FLOORS', value: 2, requested: 3 }]);
    expect(plan.changes[0]!.requiredChecks.length).toBeGreaterThan(0);
    expect([plan.modelChange, plan.diff, plan.tasks]).toEqual([null, null, []]);
    // What it would supersede is listed; nothing is presented as regenerated.
    expect(plan.outputs.map(o => [o.module, o.action])).toEqual([['QUANTITY_TAKEOFF', 'MARK_STALE'], ['CONSTRUCTION_CALCULATION', 'MARK_STALE']]);
    const run = await execute(two.plans, changeSet(two.base.id, [add], [], { materials: MATERIALS() }), plan.planHash, 200);
    expect([run.status, run.committedRevisionId, run.tasks]).toEqual(['REFUSED', null, []]);
    expect(await state(two.projectId)).toEqual({ current: two.base.id, revisions: 1, operations: [] });
    expect(freshness(await manifest(two.projectId, two.base.id), 'QUANTITY_TAKEOFF', mat.artifacts[0]!.artifactId)).toBe('current');
    // Within the limit (one storey) it is still not executed selectively: a typed scope expansion with the same checks.
    const one = await project(), within = await preview(one.plans, changeSet(one.base.id, [add]));
    expect([within.status, within.changes[0]!.reasons[0]!.code, within.changes[0]!.limit?.requested]).toEqual(['UNSUPPORTED', 'SELECTIVE_STOREY_ADDITION_NOT_SUPPORTED', 2]);
  });

  it('owner-only: another user gets 404 and anonymous requests 401; invalid configuration is a typed result', async () => {
    const p = await project(), body = changeSet(p.base.id, [FOYER]), plan = await preview(p.plans, body);
    expect((await call(p.plans, body, intruder)).statusCode).toBe(404);
    expect((await call(`${p.plans}/execute`, { changeSet: body, planHash: plan.planHash, consent }, intruder)).statusCode).toBe(404);
    expect((await call(p.plans, body, {})).statusCode).toBe(401);
    expect((await call(`${p.plans}/execute`, { changeSet: body, planHash: plan.planHash, consent: { acceptPlan: false, acceptLocks: true } })).statusCode).toBe(400);
    const noMaterials = await preview(p.plans, changeSet(p.base.id, [FOYER], [], { budget: BUDGET }));
    expect([noMaterials.status, noMaterials.reasons[0]!.code]).toEqual(['INVALID', 'BUDGET_REQUIRES_MATERIALS']);
    const book = await preview(p.plans, changeSet(p.base.id, [FOYER], [], { materials: MATERIALS(), budget: { ...BUDGET, rateBookId: 'mumbai-2026' } }));
    expect([book.status, book.reasons[0]!.code]).toEqual(['UNSUPPORTED', 'RATE_BOOK_UNAVAILABLE']);
    // Nothing was stored by any of these.
    expect(await asPrincipal(db.pool, ownerId, c => c.query('select count(*)::int as n from public.project_revision_operations where project_id = $1', [p.projectId])
      .then(r => r.rows[0].n))).toBe(0);
  });
});
