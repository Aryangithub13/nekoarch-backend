import type { FastifyBaseLogger } from 'fastify';
import { costHash } from '@designflow/boq-cost';
import { ProjectDetailSchema, ProjectRevisionDetailSchema, RevisionCommitResponseSchema } from '../contracts/projects.js';
import { TakeoffDetailSchema } from '../contracts/takeoffs.js';
import { ConstructionDetailSchema } from '../contracts/construction.js';
import { CostDetailSchema } from '../contracts/costs.js';
import type { ManifestModule, ProjectManifest } from '../contracts/project-manifest.js';
import { INTEGRATION_EXECUTION_VERSION, INTEGRATION_PLAN_VERSION, IntegrationExecutionSchema, IntegrationPlanSchema, type ChangeSet, type IntegrationExecution,
  type IntegrationPlan, type IntegrationReason, type PlanStatus, type TaskKind } from '../contracts/integration.js';
import { ApiError } from '../lib/errors.js';
import { internalCommand } from '../lib/idempotency.js';
import type { IdempotencyContext, Repository } from '../lib/repository.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { OperationDetailSchema } from '../lib/revision-repository.js';
import { modelHash } from '../lib/generation-identity.js';
import { MODEL_LIMITS } from '../engineering/capability-limits.js';
import { applyInteriorFinishes } from '../revision/interior.js';
import type { PreflightRequest } from '../revision/contracts.js';
import { diffElements } from '../integration/element-diff.js';
import { dispositionStatus, planChanges, planStatus } from '../integration/plan.js';
import { approveOperation, closeOperation, createPreflight, executeOperation, planPreflight, REVISION_OPS } from './revision-service.js';
import { projectManifest } from './project-manifest-service.js';
import { createTakeoff, TAKEOFF_OPERATION } from './takeoff-service.js';
import { createConstruction, CONSTRUCTION_OPERATION } from './construction-service.js';
import { COST_OPERATION, createCost } from './cost-service.js';
import { createStructuralAnalysis, STRUCTURAL_ANALYSIS_OPERATION } from './structural-service.js';
import { verifyRevision } from './verification-service.js';
import { StructuralDetailSchema } from '../structural/contracts.js';

const MAX_FLOORS = MODEL_LIMITS.find(l => l.limitId === 'GENERATION_MAX_FLOORS')!.value;
const SAMPLE_RATE_BOOKS: readonly string[] = ['sample-inr-v1', 'sample-inr-v2'];
/** Manifest modules that are the revision itself (replaced by the new revision, never regenerated), as in the B39 specialist service. */
const REVISION_ITSELF: readonly string[] = ['BUILDING_MODEL', 'ACCEPTANCE_QA', 'APPEARANCE_VARIANT'];
const REGENERATED: Partial<Record<ManifestModule, TaskKind>> = { QUANTITY_TAKEOFF: 'QUANTITY_TAKEOFF', CONSTRUCTION_CALCULATION: 'CONSTRUCTION_CALCULATION', BOQ_COST: 'BOQ_COST',
  STRUCTURAL_ANALYSIS: 'STRUCTURAL_ANALYSIS', COMPLEX_VERIFICATION: 'COMPLEX_VERIFICATION' };
type PlannedTask = IntegrationPlan['tasks'][number];
const MODEL_TASKS: readonly PlannedTask[] = [
  { taskId: 'MODEL_PREFLIGHT', module: 'INTERIOR', branch: 'MODEL', dependsOn: [], writes: 'REVISION_OPERATION', checkpoint: true,
    description: 'Store the Phase 30 preflight (locks, impacts, candidate hash)' },
  { taskId: 'MODEL_CANDIDATE', module: 'INTERIOR', branch: 'MODEL', dependsOn: ['MODEL_PREFLIGHT'], writes: 'REVISION_OPERATION', checkpoint: true,
    description: 'Derive the finish-only candidate; SQL checks it against the base geometry (0029)' },
  { taskId: 'MODEL_COMMIT', module: 'INTERIOR', branch: 'MODEL', dependsOn: ['MODEL_CANDIDATE'], writes: 'REVISION', checkpoint: true,
    description: 'Commit the new accepted revision: QA re-run, SQL compare-and-swap on the base, candidate hash re-checked' }];
const BRANCH_TASKS: Readonly<Record<Exclude<TaskKind, 'MODEL_PREFLIGHT' | 'MODEL_CANDIDATE' | 'MODEL_COMMIT'>, PlannedTask>> = {
  QUANTITY_TAKEOFF: { taskId: 'QUANTITY_TAKEOFF', module: 'MATERIALS', branch: 'MATERIALS_BUDGET', dependsOn: ['MODEL_COMMIT'], writes: 'ARTIFACT', checkpoint: true,
    description: 'Quantity takeoff on the committed revision' },
  CONSTRUCTION_CALCULATION: { taskId: 'CONSTRUCTION_CALCULATION', module: 'MATERIALS', branch: 'MATERIALS_BUDGET', dependsOn: ['QUANTITY_TAKEOFF'], writes: 'ARTIFACT',
    checkpoint: true, description: 'Construction calculation on the new takeoff' },
  BOQ_COST: { taskId: 'BOQ_COST', module: 'BUDGET', branch: 'MATERIALS_BUDGET', dependsOn: ['CONSTRUCTION_CALCULATION'], writes: 'ARTIFACT', checkpoint: true,
    description: 'Cost estimate on the new construction calculation (synthetic sample rates)' },
  STRUCTURAL_ANALYSIS: { taskId: 'STRUCTURAL_ANALYSIS', module: 'STRUCTURAL', branch: 'STRUCTURAL', dependsOn: ['MODEL_COMMIT'], writes: 'ARTIFACT', checkpoint: true,
    description: 'B24 linear-static analysis of the supplied frame on the committed revision (REQUIRES_REVIEW; never a design check)' },
  COMPLEX_VERIFICATION: { taskId: 'COMPLEX_VERIFICATION', module: 'BLUEPRINT', branch: 'VERIFICATION', dependsOn: ['MODEL_COMMIT'], writes: 'NONE', checkpoint: true,
    description: 'B34 independent verification of the committed revision (derived on read; status and input hash checkpointed)' },
};
/** Every task that transitively depends on `id` (failure isolation: only these are skipped when `id` fails). */
export function dependantsOf(tasks: readonly Pick<PlannedTask, 'taskId' | 'dependsOn'>[], id: TaskKind): Set<TaskKind> {
  const out = new Set<TaskKind>();
  for (let grew = true; grew;) {
    grew = false;
    for (const t of tasks) if (!out.has(t.taskId) && t.dependsOn.some(d => d === id || out.has(d))) { out.add(t.taskId); grew = true; }
  }
  return out;
}
const CLAIMS = Object.freeze({ engineeringCorrectness: 'NOT_CLAIMED', solverValidation: 'NOT_CLAIMED', professionalReview: 'NOT_CLAIMED' } as const);
type Revision = ReturnType<typeof ProjectRevisionDetailSchema.parse>;
export type IntegrationDeps = { secret?: string | undefined; log?: FastifyBaseLogger | undefined; idempotencyKey?: string | undefined;
  /** Called before each task runs (test seam for checkpoint and failure isolation; never reachable from HTTP). */
  beforeTask?: ((task: TaskKind) => Promise<void>) | undefined };
type Built = { plan: IntegrationPlan; base: Revision; preflightBody: PreflightRequest | null };

/**
 * B40 S1 preview: the plan for a change set against its expected base revision. Read only: the Phase 30 planner and the B37 manifest are read, nothing
 * is stored. A plan that is not READY_FOR_APPROVAL can never execute.
 */
export async function previewIntegrationPlan(repository: Repository, projectId: string, changeSet: ChangeSet): Promise<IntegrationPlan> {
  return (await buildPlan(repository, projectId, changeSet)).plan;
}

async function buildPlan(repository: Repository, projectId: string, changeSet: ChangeSet): Promise<Built> {
  const projects = new ProjectRepository(repository);
  // Ownership and identity first: another user's project or a foreign revision is a 404.
  const base = ProjectRevisionDetailSchema.parse(await projects.read('revision', projectId, changeSet.baseRevisionId));
  const current = ProjectDetailSchema.parse(await projects.read('get', projectId)).currentRevision?.id ?? null;
  const { changes, assignments } = planChanges(base.model, changeSet, MAX_FLOORS);
  const statuses: PlanStatus[] = changes.map(c => dispositionStatus(c.disposition)), reasons: IntegrationReason[] = [];
  const { materials, budget, structural, verification } = changeSet.regenerate;
  if (budget && !materials) { statuses.push('INVALID'); reasons.push({ code: 'BUDGET_REQUIRES_MATERIALS', message: 'A budget is priced on the takeoff and construction '
    + 'calculation this plan recomputes; request regenerate.materials as well' }); }
  if (budget && !SAMPLE_RATE_BOOKS.includes(budget.rateBookId)) { statuses.push('UNSUPPORTED'); reasons.push({ code: 'RATE_BOOK_UNAVAILABLE',
    message: `Rate book '${budget.rateBookId.slice(0, 80)}' does not exist; only the synthetic sample rate books (${SAMPLE_RATE_BOOKS.join(', ')}) are available` }); }

  // Every supported change composes into one Phase 30 operation, planned read-only by the Phase 30 planner itself (its locks, impacts and blockers).
  const executable = changes.length > 0 && changes.every(c => c.disposition === 'SUPPORTED');
  let modelChange: IntegrationPlan['modelChange'] = null, diff: IntegrationPlan['diff'] = null, preflightBody: PreflightRequest | null = null;
  if (executable) {
    preflightBody = { baseRevisionId: base.id, request: { operation: { kind: 'INTERIOR_FINISH_MODIFY', assignments, preserve: changeSet.preserve } } };
    const preflight = await planPreflight(repository, projectId, base.id, preflightBody.request);
    modelChange = { operationKind: 'INTERIOR_FINISH_MODIFY', preflightStatus: preflight.status, preflightHash: costHash(preflight),
      candidateModelHash: preflight.interior?.candidateModelHash ?? null, geometryModelHash: preflight.interior?.geometryModelHash ?? null,
      locks: preflight.locks, verifications: preflight.verifications };
    if (preflight.status !== 'AWAITING_CONSENT') {
      statuses.push(preflight.status);
      reasons.push(...preflight.blockers.map(b => ({ code: b.code, message: b.message })), ...preflight.questions.map(q => ({ code: 'CLARIFICATION_NEEDED', message: q })));
    } else diff = diffElements(base.model, applyInteriorFinishes(base.model, assignments));
  }
  if (current !== base.id) { statuses.push('STALE_BASE'); reasons.push({ code: current === null ? 'NO_CURRENT_REVISION' : 'BASE_REVISION_SUPERSEDED',
    message: 'The expected base revision is not the project\'s current revision; plan against the current one' }); }

  // Outputs: every stored, model-bound output of the base is superseded when the model changes (B37, whole model); only the requested ones are recomputed.
  const manifest = await projectManifest(repository, projectId, base.id);
  const modelChanges = diff ? !diff.modelIdentical : changes.some(c => c.disposition !== 'INVALID');
  const requested: TaskKind[] = [...(materials ? ['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION'] as const : []), ...(materials && budget ? ['BOQ_COST' as const] : []),
    ...(structural ? ['STRUCTURAL_ANALYSIS' as const] : []), ...(verification ? ['COMPLEX_VERIFICATION' as const] : [])];
  const regenerate = new Set<TaskKind>(executable ? requested : []);
  const tasks: IntegrationPlan['tasks'] = !executable ? [] : [...MODEL_TASKS,
    ...(Object.keys(BRANCH_TASKS) as (keyof typeof BRANCH_TASKS)[]).filter(t => regenerate.has(t)).map(t => BRANCH_TASKS[t])];
  // Cost safeguard: a plan larger than the caller's task ceiling never executes (no partial subset is chosen on the caller's behalf).
  const { maxTasks } = changeSet.limits;
  if (maxTasks !== undefined && tasks.length > maxTasks) { statuses.push('OVER_BUDGET'); reasons.push({ code: 'TASK_BUDGET_EXCEEDED',
    message: `The plan runs ${tasks.length} tasks; the requested ceiling is ${maxTasks}. Request fewer outputs or raise limits.maxTasks` }); }
  const status = planStatus(statuses);
  const stored = manifest.modules.filter(m => m.source === 'STORED_ARTIFACT' && !REVISION_ITSELF.includes(m.module) && (m.artifacts?.length ?? 0) > 0);
  const outputs: IntegrationPlan['outputs'] = [...new Set([...stored.map(m => m.module), ...(Object.keys(REGENERATED) as ManifestModule[]).filter(m => regenerate.has(REGENERATED[m]!))])]
    .map(module => {
      const ids = (stored.find(m => m.module === module)?.artifacts ?? []).slice(0, 20).map(a => a.artifactId), task = REGENERATED[module] ?? null;
      if (!modelChanges) return { module, baseArtifactIds: ids, action: 'NOT_AFFECTED' as const, taskId: null, reason: 'No model change is planned' };
      if (task && regenerate.has(task)) return { module, baseArtifactIds: ids, action: 'REGENERATE' as const, taskId: task,
        reason: module === 'COMPLEX_VERIFICATION' ? 'Requested: derived on read for the committed revision; its status and input hash are checkpointed, nothing is stored'
          : 'Requested: recomputed by its existing engine on the committed revision; the base\'s result stays stored and is marked stale' };
      return { module, baseArtifactIds: ids, action: 'MARK_STALE' as const, taskId: null, reason: executable
        ? 'Bound to the base model hash, which the change alters (B37 whole-model invalidation). Not requested: it stays stale until recomputed'
        : 'Would be superseded by this change (B37 whole-model invalidation). The plan is not executable, so nothing changes now' };
    });
  const body = { planVersion: INTEGRATION_PLAN_VERSION, projectId, baseRevisionId: base.id, baseRevisionNumber: base.revisionNumber, baseModelHash: modelHash(base.model),
    changes, modelChange, diff, outputs, tasks,
    invalidation: { granularity: 'WHOLE_MODEL' as const, basis: 'B37 dependency graph: an output is bound to its revision\'s canonical model hash; any model change '
      + 'supersedes every model-bound output. Element-level input scopes are not implemented. Outputs derived on read (BIM, engineering assessment) follow the model' },
    approvalRequired: true as const, quote: { execution: executable ? 'LOCAL_DETERMINISTIC' as const : 'NONE' as const, externalProviders: [], externalCostUsd: 0 as const,
      taskCount: tasks.length, maxTasks: maxTasks ?? null },
    claims: { ...CLAIMS } };
  const plan = IntegrationPlanSchema.parse({ ...body, projectCurrentRevisionId: current, status, reasons: reasons.slice(0, 16),
    // The hash binds the whole change set too (locks and regeneration configuration), so nothing can change between approval and execution.
    planHash: costHash({ ...body, changeSet }) });
  return { plan, base, preflightBody };
}

/**
 * B40 S1 execution: re-derives the plan, requires the exact approved plan hash, then runs its task DAG in order with a checkpoint per task. The model is
 * written only by the Phase 30 commit (SQL compare-and-swap on the base, finish-only lock): a failure before it leaves no revision (the operation is
 * cancelled) and the base stays current; a downstream failure leaves the committed revision valid, skips its dependants and reports their outputs as not
 * regenerated. With an Idempotency-Key every task replays its stored receipt, so a retry resumes after the last completed checkpoint.
 */
export async function executeIntegrationPlan(repository: Repository, userId: string, projectId: string,
  body: { changeSet: ChangeSet; planHash: string }, deps: IntegrationDeps): Promise<IntegrationExecution> {
  const { plan, base, preflightBody } = await buildPlan(repository, projectId, body.changeSet);
  if (plan.planHash !== body.planHash) throw new ApiError(409, 'INTEGRATION_PLAN_CHANGED', 'The plan differs from the one approved; preview it again');
  const tasks: IntegrationExecution['tasks'] = plan.tasks.map(t => ({ taskId: t.taskId, status: 'NOT_RUN', revisionId: null, artifactId: null, error: null, report: null }));
  const checks: IntegrationExecution['checks'] = (['PREFLIGHT_MATCHES_PLAN', 'CANDIDATE_MATCHES_PLAN', 'COMMITTED_DIFF_MATCHES_PLAN', 'UNTARGETED_ELEMENTS_PRESERVED'] as const)
    .map(check => ({ check, result: 'NOT_RUN' }));
  const result = (status: IntegrationExecution['status'], reasons: IntegrationReason[], fields: Partial<IntegrationExecution> = {}) => IntegrationExecutionSchema.parse({
    executionVersion: INTEGRATION_EXECUTION_VERSION, projectId, baseRevisionId: base.id, planHash: plan.planHash, status, reasons: reasons.slice(0, 16), plan,
    operationId: null, committedRevisionId: null, tasks, checks, diff: null, outputs: [], claims: { ...CLAIMS }, ...fields });
  // STALE_BASE is allowed through only so that a keyed retry can replay; the first task re-checks currency whenever it actually runs.
  if (!preflightBody || !plan.modelChange || !['READY_FOR_APPROVAL', 'STALE_BASE'].includes(plan.status))
    return result('REFUSED', [{ code: `PLAN_${plan.status}`, message: `The plan is ${plan.status}; nothing was run` }, ...plan.reasons]);
  const pass = (check: IntegrationExecution['checks'][number]['check'], ok: boolean) => { checks.find(c => c.check === check)!.result = ok ? 'PASSED' : 'FAILED'; return ok; };
  const task = (id: TaskKind) => tasks.find(t => t.taskId === id)!;
  const step = async <T>(id: TaskKind, operation: string, input: unknown, run: (context?: IdempotencyContext) => Promise<T>) => {
    await deps.beforeTask?.(id);
    const r = deps.idempotencyKey ? await internalCommand(repository, operation, `integration:${deps.idempotencyKey}:${id}`, { planHash: plan.planHash, task: id, input }, run)
      : { result: await run(), replayed: false };
    task(id).status = r.replayed ? 'REPLAYED' : 'COMPLETED';
    return r.result;
  };
  const fail = (id: TaskKind, error: unknown) => {
    if (!(error instanceof ApiError)) deps.log?.error({ projectId, task: id, err: error }, 'integration task failed unexpectedly');
    task(id).status = 'FAILED';
    task(id).error = error instanceof ApiError ? { code: error.code.slice(0, 80), message: error.message.slice(0, 500) } : { code: 'TASK_FAILED', message: 'The task failed unexpectedly' };
    // B40 S2: only the failed task's own dependants are skipped; independent branches keep running.
    const dependants = dependantsOf(plan.tasks, id);
    for (const t of tasks) if (dependants.has(t.taskId)) t.status = 'SKIPPED';
  };
  const preflightHash = plan.modelChange.preflightHash, noPool = () => { throw new ApiError(503, 'REVISION_WORKER_UNAVAILABLE', 'Not used by an interior operation'); };

  // 1–3. The model change, through the Phase 30 lifecycle. Nothing is authoritative until MODEL_COMMIT succeeds.
  let operationId: string | null = null, committed: Revision | null = null, current: TaskKind = 'MODEL_PREFLIGHT';
  try {
    const op = OperationDetailSchema.parse(await step('MODEL_PREFLIGHT', REVISION_OPS.preflight, { projectId, ...preflightBody }, async ctx => {
      const project = ProjectDetailSchema.parse(await new ProjectRepository(repository).read('get', projectId));
      if (project.currentRevision?.id !== base.id) throw new ApiError(409, 'BASE_REVISION_SUPERSEDED', 'The base revision is no longer the project\'s current revision; nothing was written');
      return createPreflight(repository, userId, projectId, preflightBody, deps.secret, ctx);
    }));
    operationId = op.id;
    if (!pass('PREFLIGHT_MATCHES_PLAN', op.preflightHash === preflightHash && op.preflight.interior?.candidateModelHash === plan.modelChange.candidateModelHash))
      throw new ApiError(409, 'INTEGRATION_PLAN_DRIFT', 'The stored preflight differs from the approved plan');
    current = 'MODEL_CANDIDATE';
    const candidate = OperationDetailSchema.parse(await step('MODEL_CANDIDATE', REVISION_OPS.execute, { projectId, operationId: op.id, preflightHash }, ctx =>
      executeOperation(repository, noPool, userId, projectId, op.id, { preflightHash }, deps.secret, ctx)));
    if (!pass('CANDIDATE_MATCHES_PLAN', candidate.status === 'CANDIDATE_READY' && !!candidate.candidateHash
      && (candidate.validation as { candidateModelHash?: unknown } | null)?.candidateModelHash === plan.modelChange.candidateModelHash))
      throw new ApiError(409, 'INTEGRATION_PLAN_DRIFT', 'The candidate differs from the approved plan');
    current = 'MODEL_COMMIT';
    const approved = await step('MODEL_COMMIT', REVISION_OPS.approve, { projectId, operationId: op.id, preflightHash, candidateHash: candidate.candidateHash }, ctx =>
      approveOperation(repository, userId, projectId, op.id, { preflightHash, candidateHash: candidate.candidateHash! }, deps.secret, ctx));
    committed = ProjectRevisionDetailSchema.parse(RevisionCommitResponseSchema.parse((approved as { commit: unknown }).commit).revision);
    task('MODEL_COMMIT').revisionId = committed.id;
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) throw error;
    fail(current, error);
    // Release the uncommitted Phase 30 operation so it neither lingers as a candidate nor counts against the active-operation limit.
    if (operationId) await closeOperation(repository, userId, projectId, operationId, 'cancel', deps.secret)
      .catch((e: unknown) => deps.log?.warn({ projectId, operationId, err: e }, 'integration operation cancel failed'));
    const code = error instanceof ApiError ? error.code : 'TASK_FAILED';
    return result(code === 'BASE_REVISION_SUPERSEDED' && current === 'MODEL_PREFLIGHT' ? 'REFUSED' : 'FAILED', [{ code: code.slice(0, 80),
      message: `${current} failed; no revision was committed and the base revision is unchanged` }], { operationId });
  }

  // Consistency: what was committed is exactly the planned change, and every element the plan does not target kept its id and content.
  const diff = diffElements(base.model, committed.model);
  pass('COMMITTED_DIFF_MATCHES_PLAN', costHash(diff) === costHash(plan.diff));
  const targeted = new Set(plan.changes.map(c => `spaces:${c.elementId}`));
  pass('UNTARGETED_ELEMENTS_PRESERVED', diff.changes.every(c => c.change === 'MODIFIED' && targeted.has(`${c.collection}:${c.elementId}`) && c.fields.join() === 'finishes')
    && diff.documentFields.length === 0 && !diff.changesTruncated);

  // 4–8. Selective regeneration on the committed revision: only the requested outputs, as independent branches (B40 S2). Within a branch tasks run in
  // dependency order and a failure skips that branch's dependants; the other branches still run. Branch order is fixed, so execution is deterministic.
  const { materials, budget, structural, verification } = body.changeSet.regenerate;
  const reasons: IntegrationReason[] = [];
  const branch = async (run: (at: (id: TaskKind) => void) => Promise<void>) => {
    let at: TaskKind | null = null;
    try { await run(id => { at = id; }); }
    catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) throw error;
      fail(at!, error);
      reasons.push({ code: 'DOWNSTREAM_TASK_FAILED', message: `${at} failed after the revision was committed. The committed revision is valid and current; `
        + 'the outputs of the failed task and its dependants are not regenerated; independent branches still ran (retry with the same Idempotency-Key to resume)' });
    }
  };
  if (materials) await branch(async at => {
    at('QUANTITY_TAKEOFF');
    const t = TakeoffDetailSchema.parse(await step('QUANTITY_TAKEOFF', TAKEOFF_OPERATION, { projectId, revisionId: committed!.id, options: materials.takeoffOptions }, ctx =>
      createTakeoff(repository, userId, projectId, committed!.id, materials.takeoffOptions, deps.secret, ctx)));
    Object.assign(task('QUANTITY_TAKEOFF'), { revisionId: committed!.id, artifactId: t.id });
    at('CONSTRUCTION_CALCULATION');
    const k = ConstructionDetailSchema.parse(await step('CONSTRUCTION_CALCULATION', CONSTRUCTION_OPERATION, { projectId, revisionId: committed!.id, takeoffId: t.id,
      specification: materials.specification, options: materials.constructionOptions }, ctx =>
      createConstruction(repository, userId, projectId, committed!.id, t.id, materials.specification, materials.constructionOptions, deps.secret, ctx)));
    Object.assign(task('CONSTRUCTION_CALCULATION'), { revisionId: committed!.id, artifactId: k.id });
    if (!budget) return;
    at('BOQ_COST');
    const c = CostDetailSchema.parse(await step('BOQ_COST', COST_OPERATION, { projectId, revisionId: committed!.id, takeoffId: t.id, calculationId: k.id,
      rateBookId: budget.rateBookId, costingPolicy: budget.costingPolicy, options: budget.options }, ctx =>
      createCost(repository, userId, projectId, committed!.id, t.id, k.id, budget.rateBookId, budget.costingPolicy, budget.options, deps.secret, ctx)));
    Object.assign(task('BOQ_COST'), { revisionId: committed!.id, artifactId: c.id });
  });
  if (structural) await branch(async at => {
    at('STRUCTURAL_ANALYSIS');
    const s = StructuralDetailSchema.parse(await step('STRUCTURAL_ANALYSIS', STRUCTURAL_ANALYSIS_OPERATION, { projectId, revisionId: committed!.id, input: structural }, ctx =>
      createStructuralAnalysis(repository, userId, projectId, committed!.id, structural, deps.secret, ctx)));
    Object.assign(task('STRUCTURAL_ANALYSIS'), { revisionId: committed!.id, artifactId: s.id });
  });
  if (verification) await branch(async at => {
    at('COMPLEX_VERIFICATION');
    await deps.beforeTask?.('COMPLEX_VERIFICATION');
    // Derived on read and deterministic for (model, declared limits): a retry recomputes the same report, so no receipt is stored.
    const report = await verifyRevision(repository, projectId, committed!.id, verification.declaredLimits);
    Object.assign(task('COMPLEX_VERIFICATION'), { status: 'COMPLETED', revisionId: committed!.id, report: { status: report.status, inputHash: report.inputHash } });
    if (report.status !== 'VERIFIED') reasons.push({ code: 'VERIFICATION_NOT_CLEAN', message: `The B34 verification of the committed revision is ${report.status}; `
      + 'read its checks before relying on the revision (nothing was changed because of it)' });
  });

  // Freshness is read back from the B37 manifest, never computed here. If it cannot be read, nothing is reported as current.
  const outputs: IntegrationExecution['outputs'] = [];
  for (const revisionId of [base.id, committed.id]) {
    let m: ProjectManifest | null = null;
    try { m = await projectManifest(repository, projectId, revisionId); }
    catch (error) { deps.log?.warn({ projectId, revisionId, err: error }, 'integration manifest read-back failed'); reasons.push({ code: 'MANIFEST_UNAVAILABLE',
      message: 'The project manifest could not be read after the write; output freshness is unverified' }); }
    if (m) for (const mod of m.modules) if (mod.source === 'STORED_ARTIFACT' && !REVISION_ITSELF.includes(mod.module))
      for (const a of mod.artifacts ?? []) outputs.push({ module: mod.module, revisionId, artifactId: a.artifactId, freshness: a.freshness.state });
  }
  const failedCheck = checks.some(c => c.result === 'FAILED');
  if (failedCheck) reasons.push({ code: 'CONSISTENCY_CHECK_FAILED', message: 'The committed revision differs from the approved plan; review it, or restore the base through a RESTORE operation' });
  const regenerated = tasks.filter(t => t.artifactId).map(t => t.artifactId!);
  const behind = outputs.filter(o => regenerated.includes(o.artifactId) && o.freshness !== 'current');
  if (behind.length) reasons.push({ code: 'OUTPUT_NOT_CURRENT', message: `${behind.map(o => `${o.module} ${o.artifactId} is ${o.freshness ?? 'unverified'}`).join('; ').slice(0, 400)}` });
  const partial = tasks.some(t => t.status === 'FAILED' || t.status === 'SKIPPED') || behind.length > 0 || reasons.some(r => r.code === 'MANIFEST_UNAVAILABLE');
  return result(failedCheck ? 'FAILED' : partial ? 'PARTIAL' : 'COMPLETED', reasons, { operationId, committedRevisionId: committed.id, diff, outputs: outputs.slice(0, 64) });
}

