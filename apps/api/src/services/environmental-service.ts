import type { Repository, IdempotencyContext } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { EnvironmentalRepository } from '../lib/environmental-repository.js';
import { readBim } from './bim-service.js';
import { signProjectCommit } from './project-service.js';
import { CLAIMS, ENVIRONMENTAL_ANALYSIS_VERSION, ENVIRONMENTAL_LIMITS, EnvironmentalError, LIMITATIONS, SnapshotSchema, type EnvironmentalInput } from '../environmental/contracts.js';
import { buildEnvironmentalModel } from '../environmental/model.js';
import { environmentalInputHash, resolveAnalysisInput, runEnvironmentalAnalysis } from '../environmental/analysis.js';
import { validateEnvironmentalModel, validateEnvironmentalResults } from '../environmental/validate.js';

export const ENVIRONMENTAL_ROOT = '/api/projects/:projectId/revisions/:revisionId/environmental';
export const ENVIRONMENTAL_ANALYSIS_OPERATION = `${ENVIRONMENTAL_ROOT}/analyses`;

export function environmentalApiError(error: unknown): never {
  if (error instanceof EnvironmentalError) throw new ApiError(error.code === 'ENVIRONMENTAL_RESULT_STALE' ? 409 : 422, error.code, error.message);
  throw error;
}
const currency = (analysisRevisionId: string, projectCurrentRevisionId: string | null) =>
  ({ status: analysisRevisionId === projectCurrentRevisionId ? 'CURRENT' as const : 'STALE' as const, analysisRevisionId, projectCurrentRevisionId });

/** Accepted revision → BIM (Phase 23, unchanged) → explicit environmental input → model → independent validation → resolved, budgeted analysis input. */
async function prepare(repository: Repository, projectId: string, revisionId: string, input: EnvironmentalInput) {
  const { model: bim, revision } = await readBim(repository, projectId, revisionId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === 'BIM_UNSUPPORTED_MODEL') throw new ApiError(422, 'ENVIRONMENTAL_SOURCE_UNSUPPORTED', 'The revision is outside the bounded BIM source profile required for environmental analysis');
    throw error;
  });
  try {
    const model = buildEnvironmentalModel(bim, input), validation = validateEnvironmentalModel(model, bim.geometry, input, model.binding);
    if (validation.status === 'INVALID') throw new EnvironmentalError('ENVIRONMENTAL_MODEL_INVALID', 'Independent environmental validation rejected the model');
    return { model, validation, analysisInput: resolveAnalysisInput(model, input), acceptanceQaId: revision.qa.id };
  } catch (error) { environmentalApiError(error); }
}

/** What each capability can deliver with this input; never runs the calculation. */
function readiness(input: EnvironmentalInput, model: { envelope: { status: string } }) {
  const requested = input.solarInstants.length > 0;
  return { solar: !requested ? 'NOT_EVALUATED' : input.location ? 'READY' : 'INPUT_INCOMPLETE',
    exposure: !requested ? 'NOT_EVALUATED' : input.location && input.orientation ? (model.envelope.status === 'CLOSED' ? 'READY' : 'PARTIAL') : 'INPUT_INCOMPLETE',
    thermal: !input.thermalCases.length ? 'NOT_EVALUATED' : 'READY', daylightIndicator: 'READY' } as const;
}

export async function validateEnvironmental(repository: Repository, projectId: string, revisionId: string, input: EnvironmentalInput) {
  const { model, validation } = await prepare(repository, projectId, revisionId, input);
  return { binding: model.binding, readiness: 'ANALYSIS_READY' as const, capabilities: readiness(input, model), model, validation, claims: CLAIMS, limitations: LIMITATIONS };
}

export async function createEnvironmentalAnalysis(repository: Repository, userId: string, projectId: string, revisionId: string, input: EnvironmentalInput,
  secret?: string, context?: IdempotencyContext, onTimings?: (executionMs: number) => void) {
  if (!secret) throw new ApiError(503, 'ENVIRONMENTAL_UNAVAILABLE', 'Environmental persistence is not configured');
  const { model, validation, analysisInput, acceptanceQaId } = await prepare(repository, projectId, revisionId, input);
  try {
    // ponytail: synchronous calculation on the request thread, bounded by the preflighted ray budget and calculationMs; move to a worker if limits grow.
    const run = runEnvironmentalAnalysis(analysisInput);
    const draft = { version: ENVIRONMENTAL_ANALYSIS_VERSION, binding: model.binding, inputHash: environmentalInputHash(model.binding, input), analysisInputHash: run.analysisInputHash,
      input, model, calculator: run.calculator, results: run.results };
    const results = validateEnvironmentalResults(draft, { binding: model.binding });
    if (results.status === 'INVALID') throw new EnvironmentalError('ENVIRONMENTAL_RESULT_INVALID', 'Independent result validation rejected the calculator output');
    const snapshot = SnapshotSchema.parse({ ...draft, validation: { model: validation, results }, status: { analysis: 'ANALYZED', validation: 'VALIDATED' }, claims: CLAIMS, limitations: LIMITATIONS });
    if (Buffer.byteLength(JSON.stringify(snapshot)) > ENVIRONMENTAL_LIMITS.outputBytes) throw new EnvironmentalError('ENVIRONMENTAL_RESOURCE_LIMIT', 'Environmental result exceeds the output budget');
    const write = { projectId, projectRevisionId: revisionId, acceptanceQaId, snapshot };
    onTimings?.(run.calculator.executionMs);
    return await new EnvironmentalRepository(repository).write(write, signProjectCommit(secret, userId, ENVIRONMENTAL_ANALYSIS_OPERATION, write, context), context);
  } catch (error) { environmentalApiError(error); }
}

export async function readEnvironmentalAnalysis(repository: Repository, projectId: string, revisionId: string, analysisId: string, requireCurrent: boolean) {
  const { detail, projectCurrentRevisionId } = await new EnvironmentalRepository(repository).read(projectId, revisionId, analysisId);
  // Defense in depth: the DB already scopes the row to this project/revision.
  if (detail.projectRevisionId !== revisionId || detail.snapshot.binding.revisionId !== revisionId || detail.snapshot.binding.projectId !== projectId)
    throw new ApiError(404, 'ENVIRONMENTAL_ANALYSIS_NOT_FOUND', 'Environmental analysis not found');
  const c = currency(detail.projectRevisionId, projectCurrentRevisionId);
  if (requireCurrent && c.status !== 'CURRENT') environmentalApiError(new EnvironmentalError('ENVIRONMENTAL_RESULT_STALE', 'The environmental analysis belongs to a superseded revision'));
  return { ...detail, currency: c };
}

export async function listEnvironmentalAnalyses(repository: Repository, projectId: string, revisionId: string, query: { limit: number; cursor?: string | undefined }) {
  const { items, nextCursor, projectCurrentRevisionId } = await new EnvironmentalRepository(repository).list(projectId, revisionId, query);
  return { items: items.map(i => ({ ...i, currency: currency(i.projectRevisionId, projectCurrentRevisionId) })), nextCursor };
}

/** Results are never reused across revisions: analyses of any other revision are STALE for this one. */
export async function environmentalStatus(repository: Repository, projectId: string, revisionId: string) {
  const s = await new EnvironmentalRepository(repository).status(projectId, revisionId);
  return { projectId, revisionId, revisionNumber: s.revisionNumber, projectCurrentRevisionId: s.projectCurrentRevisionId,
    revisionCurrency: revisionId === s.projectCurrentRevisionId ? 'CURRENT' as const : 'HISTORICAL' as const,
    environmentalStatus: s.analyses.length ? 'ANALYZED' as const : 'NOT_ANALYZED' as const, requiresNewAnalysis: s.analyses.length === 0,
    analyses: s.analyses.map(a => ({ ...a, currency: currency(a.projectRevisionId, s.projectCurrentRevisionId) })),
    staleAnalyses: s.otherRevisionAnalyses.map(a => ({ ...a, currency: { status: 'STALE' as const, analysisRevisionId: a.projectRevisionId, projectCurrentRevisionId: s.projectCurrentRevisionId },
      staleReason: 'BOUND_TO_A_DIFFERENT_REVISION' as const })),
    claims: CLAIMS };
}
