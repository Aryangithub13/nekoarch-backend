import type { Repository, IdempotencyContext } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { StructuralRepository } from '../lib/structural-repository.js';
import { readBim } from './bim-service.js';
import { signProjectCommit } from './project-service.js';
import { CLAIMS, LIMITATIONS, STRUCTURAL_ANALYSIS_VERSION, STRUCTURAL_LIMITS, SnapshotSchema, StructuralError, type StructuralInput } from '../structural/contracts.js';
import { buildStructuralModel } from '../structural/model.js';
import { validateStructuralModel, validateStructuralResults } from '../structural/validate.js';
import { runStructuralAnalysis, structuralInputHash } from '../structural/analysis.js';

export const STRUCTURAL_ROOT = '/api/projects/:projectId/revisions/:revisionId/structural';
export const STRUCTURAL_ANALYSIS_OPERATION = `${STRUCTURAL_ROOT}/analyses`;

export function structuralApiError(error: unknown): never {
  if (error instanceof StructuralError) throw new ApiError(error.code === 'STRUCTURAL_RESULT_STALE' ? 409 : 422, error.code, error.message);
  throw error;
}
const currency = (analysisRevisionId: string, projectCurrentRevisionId: string | null) =>
  ({ status: analysisRevisionId === projectCurrentRevisionId ? 'CURRENT' as const : 'STALE' as const, analysisRevisionId, projectCurrentRevisionId });

/** Accepted revision → BIM (Phase 23, unchanged) → explicit mapping → independent validation. */
async function prepare(repository: Repository, projectId: string, revisionId: string, input: StructuralInput) {
  const { model: bim, revision } = await readBim(repository, projectId, revisionId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === 'BIM_UNSUPPORTED_MODEL') throw new ApiError(422, 'STRUCTURAL_SOURCE_UNSUPPORTED', 'The revision is outside the bounded BIM source profile required for structural mapping');
    throw error;
  });
  try {
    const model = buildStructuralModel(bim, input), validation = validateStructuralModel(model, bim.geometry, input, model.binding);
    if (validation.status === 'INVALID') throw new StructuralError('STRUCTURAL_MODEL_INVALID', 'Independent structural validation rejected the model');
    return { model, validation, acceptanceQaId: revision.qa.id };
  } catch (error) { structuralApiError(error); }
}

export async function validateStructural(repository: Repository, projectId: string, revisionId: string, input: StructuralInput) {
  const { model, validation } = await prepare(repository, projectId, revisionId, input);
  return { binding: model.binding, readiness: 'ANALYSIS_READY' as const, model, validation, claims: CLAIMS, limitations: LIMITATIONS };
}

export async function createStructuralAnalysis(repository: Repository, userId: string, projectId: string, revisionId: string, input: StructuralInput,
  secret?: string, context?: IdempotencyContext, onTimings?: (timings: ReturnType<typeof runStructuralAnalysis>['timings']) => void) {
  if (!secret) throw new ApiError(503, 'STRUCTURAL_UNAVAILABLE', 'Structural persistence is not configured');
  const { model, validation, acceptanceQaId } = await prepare(repository, projectId, revisionId, input);
  try {
    // ponytail: synchronous solve on the request thread, bounded by STRUCTURAL_LIMITS.solverMs; move to a worker pool if limits grow.
    const run = runStructuralAnalysis(model);
    const draft = { version: STRUCTURAL_ANALYSIS_VERSION, binding: model.binding, inputHash: structuralInputHash(model.binding, input), analysisModelHash: run.analysisModelHash,
      input, model, solver: run.solver, results: run.results };
    const results = validateStructuralResults(draft, { binding: model.binding });
    if (results.status === 'INVALID') throw new StructuralError('STRUCTURAL_RESULT_INVALID', 'Independent result validation rejected the solver output');
    const snapshot = SnapshotSchema.parse({ ...draft, validation: { model: validation, results }, status: { analysis: 'ANALYZED', validation: 'VALIDATED' }, claims: CLAIMS, limitations: LIMITATIONS });
    if (Buffer.byteLength(JSON.stringify(snapshot)) > STRUCTURAL_LIMITS.outputBytes) throw new StructuralError('STRUCTURAL_RESOURCE_LIMIT', 'Structural result exceeds the output budget');
    const write = { projectId, projectRevisionId: revisionId, acceptanceQaId, snapshot };
    onTimings?.(run.timings);
    return await new StructuralRepository(repository).write(write, signProjectCommit(secret, userId, STRUCTURAL_ANALYSIS_OPERATION, write, context), context);
  } catch (error) { structuralApiError(error); }
}

export async function readStructuralAnalysis(repository: Repository, projectId: string, revisionId: string, analysisId: string, requireCurrent: boolean) {
  const { detail, projectCurrentRevisionId } = await new StructuralRepository(repository).read(projectId, revisionId, analysisId);
  // Defense in depth: the DB already scopes the row to this project/revision.
  if (detail.projectRevisionId !== revisionId || detail.snapshot.binding.revisionId !== revisionId || detail.snapshot.binding.projectId !== projectId)
    throw new ApiError(404, 'STRUCTURAL_ANALYSIS_NOT_FOUND', 'Structural analysis not found');
  const c = currency(detail.projectRevisionId, projectCurrentRevisionId);
  if (requireCurrent && c.status !== 'CURRENT') structuralApiError(new StructuralError('STRUCTURAL_RESULT_STALE', 'The structural analysis belongs to a superseded revision'));
  return { ...detail, currency: c };
}

export async function listStructuralAnalyses(repository: Repository, projectId: string, revisionId: string, query: { limit: number; cursor?: string | undefined }) {
  const { items, nextCursor, projectCurrentRevisionId } = await new StructuralRepository(repository).list(projectId, revisionId, query);
  return { items: items.map(i => ({ ...i, currency: currency(i.projectRevisionId, projectCurrentRevisionId) })), nextCursor };
}

/** Results are never reused across revisions: analyses of any other revision are STALE for this one. */
export async function structuralStatus(repository: Repository, projectId: string, revisionId: string) {
  const s = await new StructuralRepository(repository).status(projectId, revisionId);
  return { projectId, revisionId, revisionNumber: s.revisionNumber, projectCurrentRevisionId: s.projectCurrentRevisionId,
    revisionCurrency: revisionId === s.projectCurrentRevisionId ? 'CURRENT' as const : 'HISTORICAL' as const,
    structuralStatus: s.analyses.length ? 'ANALYZED' as const : 'NOT_ANALYZED' as const, requiresNewAnalysis: s.analyses.length === 0,
    analyses: s.analyses.map(a => ({ ...a, currency: currency(a.projectRevisionId, s.projectCurrentRevisionId) })),
    staleAnalyses: s.otherRevisionAnalyses.map(a => ({ ...a, currency: { status: 'STALE' as const, analysisRevisionId: a.projectRevisionId, projectCurrentRevisionId: s.projectCurrentRevisionId },
      staleReason: 'BOUND_TO_A_DIFFERENT_REVISION' as const })),
    claims: CLAIMS };
}
