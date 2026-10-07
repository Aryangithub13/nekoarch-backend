import type { Repository, IdempotencyContext } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { SystemsRepository } from '../lib/systems-repository.js';
import { StructuralRepository } from '../lib/structural-repository.js';
import { EnvironmentalRepository } from '../lib/environmental-repository.js';
import { readBim } from './bim-service.js';
import { signProjectCommit } from './project-service.js';
import { STRUCTURAL_MODEL_VERSION } from '../structural/contracts.js';
import { ENVIRONMENTAL_MODEL_VERSION } from '../environmental/contracts.js';
import { CLAIMS, LIMITATIONS, SYSTEMS_ANALYSIS_VERSION, SYSTEMS_LIMITS, SYSTEMS_MODEL_VERSION, SnapshotSchema, SystemsError, type SystemsBinding, type SystemsInput,
  type SystemsModel } from '../systems/contracts.js';
import { buildSystemsModel } from '../systems/model.js';
import { resolveAnalysisInput, runSystemsAnalysis, systemsInputHash } from '../systems/analysis.js';
import { validateSystemsModel, validateSystemsResults } from '../systems/validate.js';

export const SYSTEMS_ROOT = '/api/projects/:projectId/revisions/:revisionId/systems';
export const SYSTEMS_ANALYSIS_OPERATION = `${SYSTEMS_ROOT}/analyses`;

export function systemsApiError(error: unknown): never {
  if (error instanceof SystemsError) throw new ApiError(error.code === 'SYSTEMS_RESULT_STALE' ? 409 : 422, error.code, error.message);
  throw error;
}
const currency = (analysisRevisionId: string, projectCurrentRevisionId: string | null) =>
  ({ status: analysisRevisionId === projectCurrentRevisionId ? 'CURRENT' as const : 'STALE' as const, analysisRevisionId, projectCurrentRevisionId });

/** Accepted revision → BIM (unchanged) → explicitly named upstream analyses of the same revision → model → independent validation → budgeted analysis input. */
async function prepare(repository: Repository, projectId: string, revisionId: string, input: SystemsInput) {
  const { model: bim, revision } = await readBim(repository, projectId, revisionId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === 'BIM_UNSUPPORTED_MODEL') throw new ApiError(422, 'BUILDING_SYSTEMS_SOURCE_UNSUPPORTED', 'The revision is outside the bounded BIM source profile');
    throw error;
  });
  // Never "latest": only the analyses named in the input, read through revision-scoped RPCs (another revision's analysis is 404).
  const s = input.sources.structuralAnalysisId ? (await new StructuralRepository(repository).read(projectId, revisionId, input.sources.structuralAnalysisId)).detail : null;
  const e = input.sources.environmentalAnalysisId ? (await new EnvironmentalRepository(repository).read(projectId, revisionId, input.sources.environmentalAnalysisId)).detail : null;
  const structural = s ? { analysisId: s.id, inputHash: s.inputHash, snapshot: s.snapshot } : null, environmental = e ? { analysisId: e.id, inputHash: e.inputHash, snapshot: e.snapshot } : null;
  const expected: SystemsBinding = { ...bim.binding, bimVersion: bim.version, systemsModelVersion: SYSTEMS_MODEL_VERSION,
    structural: s ? { analysisId: s.id, inputHash: s.inputHash, modelVersion: STRUCTURAL_MODEL_VERSION } : null,
    environmental: e ? { analysisId: e.id, inputHash: e.inputHash, modelVersion: ENVIRONMENTAL_MODEL_VERSION } : null };
  try {
    const model = buildSystemsModel(bim, input, { structural, environmental }), validation = validateSystemsModel(model, bim.geometry, input, expected, s?.snapshot ?? null);
    if (validation.status === 'INVALID') throw new SystemsError('BUILDING_SYSTEMS_MODEL_INVALID', 'Independent building-systems validation rejected the model');
    return { model, validation, expected, environmental, analysisInput: resolveAnalysisInput(model, input, environmental), acceptanceQaId: revision.qa.id };
  } catch (error) { systemsApiError(error); }
}

/** What each capability can deliver with this input; never calculates. */
function readiness(model: SystemsModel) {
  const of = (d: string, requested: boolean) => !requested ? 'NOT_EVALUATED' as const
    : model.networks.some(n => n.discipline === d) && model.networks.filter(n => n.discipline === d).every(n => n.status === 'READY') ? 'READY' as const : 'INPUT_INCOMPLETE' as const;
  return { plumbing: of('PLUMBING', model.requested.plumbing), electrical: of('ELECTRICAL', model.requested.electrical), hvac: of('HVAC', model.requested.hvac),
    lifeSafety: model.exits.status === 'NOT_REQUESTED' ? 'NOT_EVALUATED' as const : model.exits.status === 'DESIGNATED' ? 'READY' as const : 'INPUT_INCOMPLETE' as const,
    verticalTransport: model.requested.verticalTransport ? 'READY' as const : 'NOT_EVALUATED' as const,
    structuralClearance: model.structure.status === 'BOUND' ? 'READY' as const : 'NOT_EVALUATED' as const };
}

export async function validateSystems(repository: Repository, projectId: string, revisionId: string, input: SystemsInput) {
  const { model, validation } = await prepare(repository, projectId, revisionId, input);
  return { binding: model.binding, readiness: 'ANALYSIS_READY' as const, capabilities: readiness(model), model, validation, claims: CLAIMS, limitations: LIMITATIONS };
}

export async function createSystemsAnalysis(repository: Repository, userId: string, projectId: string, revisionId: string, input: SystemsInput,
  secret?: string, context?: IdempotencyContext, onTimings?: (executionMs: number) => void) {
  if (!secret) throw new ApiError(503, 'SYSTEMS_UNAVAILABLE', 'Building-systems persistence is not configured');
  const { model, validation, expected, environmental, analysisInput, acceptanceQaId } = await prepare(repository, projectId, revisionId, input);
  try {
    // ponytail: synchronous calculation on the request thread, bounded by the preflighted search budget and calculationMs; move to a worker if limits grow.
    const run = runSystemsAnalysis(analysisInput);
    const draft = { version: SYSTEMS_ANALYSIS_VERSION, binding: model.binding, inputHash: systemsInputHash(model.binding, input), analysisInputHash: run.analysisInputHash,
      input, model, calculator: run.calculator, results: run.results };
    const results = validateSystemsResults(draft, { binding: expected, environmental });
    if (results.status === 'INVALID') throw new SystemsError('SYSTEM_RESULT_INVALID', 'Independent result validation rejected the calculator output');
    const snapshot = SnapshotSchema.parse({ ...draft, validation: { model: validation, results }, status: { analysis: 'ANALYZED', validation: 'VALIDATED' }, claims: CLAIMS, limitations: LIMITATIONS });
    if (Buffer.byteLength(JSON.stringify(snapshot)) > SYSTEMS_LIMITS.outputBytes) throw new SystemsError('BUILDING_SYSTEMS_RESOURCE_LIMIT', 'Building-systems result exceeds the output budget');
    const write = { projectId, projectRevisionId: revisionId, acceptanceQaId, snapshot };
    onTimings?.(run.calculator.executionMs);
    return await new SystemsRepository(repository).write(write, signProjectCommit(secret, userId, SYSTEMS_ANALYSIS_OPERATION, write, context), context);
  } catch (error) { systemsApiError(error); }
}

export async function readSystemsAnalysis(repository: Repository, projectId: string, revisionId: string, analysisId: string, requireCurrent: boolean) {
  const { detail, projectCurrentRevisionId } = await new SystemsRepository(repository).read(projectId, revisionId, analysisId);
  // Defense in depth: the DB already scopes the row to this project/revision.
  if (detail.projectRevisionId !== revisionId || detail.snapshot.binding.revisionId !== revisionId || detail.snapshot.binding.projectId !== projectId)
    throw new ApiError(404, 'SYSTEMS_ANALYSIS_NOT_FOUND', 'Building-systems analysis not found');
  const c = currency(detail.projectRevisionId, projectCurrentRevisionId);
  if (requireCurrent && c.status !== 'CURRENT') systemsApiError(new SystemsError('SYSTEMS_RESULT_STALE', 'The building-systems analysis belongs to a superseded revision'));
  return { ...detail, currency: c };
}

export async function listSystemsAnalyses(repository: Repository, projectId: string, revisionId: string, query: { limit: number; cursor?: string | undefined }) {
  const { items, nextCursor, projectCurrentRevisionId } = await new SystemsRepository(repository).list(projectId, revisionId, query);
  return { items: items.map(i => ({ ...i, currency: currency(i.projectRevisionId, projectCurrentRevisionId) })), nextCursor };
}

/** Results are never reused across revisions: analyses of any other revision are STALE for this one, and MEP routes are never re-applied. */
export async function systemsStatus(repository: Repository, projectId: string, revisionId: string) {
  const s = await new SystemsRepository(repository).status(projectId, revisionId);
  return { projectId, revisionId, revisionNumber: s.revisionNumber, projectCurrentRevisionId: s.projectCurrentRevisionId,
    revisionCurrency: revisionId === s.projectCurrentRevisionId ? 'CURRENT' as const : 'HISTORICAL' as const,
    systemsStatus: s.analyses.length ? 'ANALYZED' as const : 'NOT_ANALYZED' as const, requiresNewAnalysis: s.analyses.length === 0,
    analyses: s.analyses.map(a => ({ ...a, currency: currency(a.projectRevisionId, s.projectCurrentRevisionId) })),
    staleAnalyses: s.otherRevisionAnalyses.map(a => ({ ...a, currency: { status: 'STALE' as const, analysisRevisionId: a.projectRevisionId, projectCurrentRevisionId: s.projectCurrentRevisionId },
      staleReason: 'BOUND_TO_A_DIFFERENT_REVISION' as const })),
    claims: CLAIMS };
}
