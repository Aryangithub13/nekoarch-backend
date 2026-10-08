import type { Repository, IdempotencyContext } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { OptimizationRepository } from '../lib/optimization-repository.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { ProjectRevisionDetailSchema } from '../contracts/projects.js';
import { signProjectCommit } from './project-service.js';
import { CLAIMS, ENGINEERING, OPTIMIZATION_LIMITS, OptimizationError, type OptimizationSource } from '../optimization/contracts.js';
import { preflightSpace } from '../optimization/domain.js';
import { resolveSource, validateOptimizationInput } from '../optimization/study.js';
import { OptimizationPoolError, type OptimizationPool, type PoolResult } from '../optimization/pool.js';

export const OPTIMIZATION_ROOT = '/api/projects/:projectId/revisions/:revisionId/optimization';
export const OPTIMIZATION_STUDY_OPERATION = `${OPTIMIZATION_ROOT}/studies`;

const STATUS: Record<OptimizationError['code'], number> = { OPTIMIZATION_INPUT_INVALID: 400, OPTIMIZATION_UNSUPPORTED: 422, OPTIMIZATION_RESOURCE_LIMIT: 422,
  OPTIMIZATION_BASELINE_MISMATCH: 422, REVISION_NOT_ACCEPTED: 422, OPTIMIZATION_VALIDATION_FAILED: 422 };
export function optimizationApiError(error: unknown): never {
  if (error instanceof OptimizationError) throw new ApiError(STATUS[error.code], error.code, error.message,
    Object.keys(error.details).length ? Object.fromEntries(Object.entries(error.details).map(([k, v]) => [k, [v]])) : undefined);
  // Capacity, timeout and worker failure: the study did not run to completion and nothing is stored.
  if (error instanceof OptimizationPoolError) throw new ApiError(503, error.code, error.message);
  throw error;
}
const currency = (studyRevisionId: string, projectCurrentRevisionId: string | null) =>
  ({ status: studyRevisionId === projectCurrentRevisionId ? 'CURRENT' as const : 'STALE' as const, studyRevisionId, projectCurrentRevisionId });

/** The accepted revision as an optimization source; eligibility (D1) is decided by the core, not here. */
async function readSource(repository: Repository, projectId: string, revisionId: string): Promise<{ source: OptimizationSource; acceptanceQaId: string }> {
  const revision = ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision', projectId, revisionId));
  if (revision.projectId !== projectId || revision.id !== revisionId) throw new ApiError(404, 'REVISION_NOT_FOUND', 'Revision not found');
  const qa = revision.qaRuns.find(run => run.id === revision.qa.id);
  const accepted = qa && ['PASS', 'PASS_WITH_WARNINGS'].includes(qa.status);
  return { acceptanceQaId: revision.qa.id, source: { projectId, revisionId, generatorVersion: revision.generatorVersion, normalizedRequirements: revision.normalizedRequirements ?? null,
    model: revision.model, identity: revision.identity ? { modelHash: revision.identity.modelHash } : null,
    qa: { status: accepted ? qa.report.status : 'FAIL', inputStatus: qa?.report.inputStatus ?? 'NOT_EVALUATED', errors: qa?.report.summary.errors ?? 1 } } };
}
/** Cheap main-thread refusals (eligibility, schema, semantics, BigInt search space) so invalid work never occupies the pool. */
function precheck(source: OptimizationSource, input: unknown) {
  try { const normalized = validateOptimizationInput(input, source, resolveSource(source)); return { normalized, size: preflightSpace(normalized) }; }
  catch (error) { optimizationApiError(error); }
}

/** Never generates candidates and never persists. */
export async function validateOptimization(repository: Repository, projectId: string, revisionId: string, input: unknown) {
  const { source } = await readSource(repository, projectId, revisionId), { normalized, size } = precheck(source, input);
  return { readiness: 'READY' as const, candidateSpaceSize: size.toString(), strategy: normalized.strategy, mode: normalized.mode, variables: normalized.variables.length,
    objectives: normalized.objectives.length, limits: OPTIMIZATION_LIMITS, engineering: ENGINEERING, claims: CLAIMS };
}

export async function createOptimizationStudy(repository: Repository, pool: OptimizationPool, userId: string, projectId: string, revisionId: string, input: unknown,
  secret?: string, context?: IdempotencyContext, onRun?: (run: Omit<PoolResult, 'study'>) => void) {
  if (!secret) throw new ApiError(503, 'OPTIMIZATION_UNAVAILABLE', 'Optimization persistence is not configured');
  const { source, acceptanceQaId } = await readSource(repository, projectId, revisionId);
  precheck(source, input);
  let result: PoolResult;
  try { result = await pool.run(source, input); } catch (error) { optimizationApiError(error); }
  const { study, ...run } = result;
  onRun?.(run);
  const write = { projectId, projectRevisionId: revisionId, acceptanceQaId, snapshot: study };
  return new OptimizationRepository(repository).write(write, signProjectCommit(secret, userId, OPTIMIZATION_STUDY_OPERATION, write, context), context);
}

export async function readOptimizationStudy(repository: Repository, projectId: string, revisionId: string, studyId: string, requireCurrent: boolean) {
  const { detail, projectCurrentRevisionId } = await new OptimizationRepository(repository).read(projectId, revisionId, studyId);
  // Defense in depth: the DB already scopes the row to this project/revision.
  if (detail.projectRevisionId !== revisionId || detail.snapshot.binding.sourceRevisionId !== revisionId || detail.snapshot.binding.projectId !== projectId)
    throw new ApiError(404, 'OPTIMIZATION_STUDY_NOT_FOUND', 'Optimization study not found');
  const c = currency(detail.projectRevisionId, projectCurrentRevisionId);
  if (requireCurrent && c.status !== 'CURRENT') throw new ApiError(409, 'OPTIMIZATION_RESULT_STALE', 'The optimization study belongs to a superseded revision');
  return { ...detail, currency: c };
}

export async function listOptimizationStudies(repository: Repository, projectId: string, revisionId: string, query: { limit: number; cursor?: string | undefined }) {
  const { items, nextCursor, projectCurrentRevisionId } = await new OptimizationRepository(repository).list(projectId, revisionId, query);
  return { items: items.map(i => ({ ...i, currency: currency(i.projectRevisionId, projectCurrentRevisionId) })), nextCursor };
}

/** Studies are never reused across revisions: studies of any other revision are STALE for this one. */
export async function optimizationStatus(repository: Repository, projectId: string, revisionId: string) {
  const s = await new OptimizationRepository(repository).status(projectId, revisionId);
  return { projectId, revisionId, revisionNumber: s.revisionNumber, projectCurrentRevisionId: s.projectCurrentRevisionId,
    revisionCurrency: revisionId === s.projectCurrentRevisionId ? 'CURRENT' as const : 'HISTORICAL' as const,
    optimizationStatus: s.studies.length ? 'STUDIED' as const : 'NOT_STUDIED' as const,
    studies: s.studies.map(a => ({ ...a, currency: currency(a.projectRevisionId, s.projectCurrentRevisionId) })),
    staleStudies: s.otherRevisionStudies.map(a => ({ ...a, currency: { status: 'STALE' as const, studyRevisionId: a.projectRevisionId, projectCurrentRevisionId: s.projectCurrentRevisionId },
      staleReason: 'BOUND_TO_A_DIFFERENT_REVISION' as const })),
    engineering: ENGINEERING, claims: CLAIMS };
}
