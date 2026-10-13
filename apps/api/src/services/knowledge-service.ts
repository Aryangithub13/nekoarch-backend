import { performance } from 'node:perf_hooks';
import type { Repository, IdempotencyContext } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { KnowledgeRepository } from '../lib/knowledge-repository.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { StructuralRepository } from '../lib/structural-repository.js';
import { EnvironmentalRepository } from '../lib/environmental-repository.js';
import { SystemsRepository } from '../lib/systems-repository.js';
import { readBim } from './bim-service.js';
import { signProjectCommit } from './project-service.js';
import { digest } from '../bim/core.js';
import { CLAIMS, EVALUATOR, KNOWLEDGE_ANALYSIS_VERSION, KNOWLEDGE_LIMITS, KNOWLEDGE_INPUT_VERSION, KnowledgeError, LIMITATIONS, SnapshotSchema, type KnowledgeInput,
  type Source, type Upstream } from '../knowledge/contracts.js';
import { bundledPack, catalogEntries } from '../knowledge/packs.js';
import { checkUpstreamConsistency, extractFacts, knowledgeBinding } from '../knowledge/facts.js';
import { evaluate, staticOutcome } from '../knowledge/evaluate.js';
import { detectConflicts } from '../knowledge/conflicts.js';
import { validateKnowledgeModel, validateKnowledgeResults } from '../knowledge/validate.js';

/** The knowledge inputHash: the binding plus the stored input (packs, sources, scope). Also recomputed by the Phase 37 dependency graph. */
export const knowledgeInputHash = (binding: unknown, stored: unknown) => digest({ version: KNOWLEDGE_ANALYSIS_VERSION, binding, input: stored });
export const KNOWLEDGE_ROOT = '/api/projects/:projectId/revisions/:revisionId/knowledge';
export const KNOWLEDGE_ANALYSIS_OPERATION = `${KNOWLEDGE_ROOT}/analyses`;

export function knowledgeApiError(error: unknown): never {
  if (error instanceof KnowledgeError) throw new ApiError(error.code === 'KNOWLEDGE_RESULT_STALE' ? 409 : 422, error.code, error.message);
  throw error;
}
const currency = (analysisRevisionId: string, projectCurrentRevisionId: string | null) =>
  ({ status: analysisRevisionId === projectCurrentRevisionId ? 'CURRENT' as const : 'STALE' as const, analysisRevisionId, projectCurrentRevisionId });
const selectedRules = (packs: ReturnType<typeof bundledPack>[], input: KnowledgeInput) =>
  packs.flatMap(({ pack }) => pack.rules.filter(r => input.scope.disciplines.includes(r.discipline)).map(rule => ({ packId: pack.packId, rule })));

/** Accepted revision → BIM → explicitly named same-revision analyses (never "latest") → bundled packs → binding → facts → independent model validation. */
async function prepare(repository: Repository, projectId: string, revisionId: string, input: KnowledgeInput) {
  const { model: bim, revision } = await readBim(repository, projectId, revisionId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === 'BIM_UNSUPPORTED_MODEL') throw new ApiError(422, 'KNOWLEDGE_SOURCE_UNSUPPORTED', 'The revision is outside the bounded BIM source profile');
    throw error;
  });
  // Revision-scoped RPC reads: an analysis of another revision or project is 404.
  const { structuralAnalysisId: s, environmentalAnalysisId: e, systemsAnalysisId: y } = input.sources;
  const sd = s ? (await new StructuralRepository(repository).read(projectId, revisionId, s)).detail : null;
  const ed = e ? (await new EnvironmentalRepository(repository).read(projectId, revisionId, e)).detail : null;
  const yd = y ? (await new SystemsRepository(repository).read(projectId, revisionId, y)).detail : null;
  const up: Upstream = { structural: sd ? { analysisId: sd.id, inputHash: sd.inputHash, snapshot: sd.snapshot } : null,
    environmental: ed ? { analysisId: ed.id, inputHash: ed.inputHash, snapshot: ed.snapshot } : null, systems: yd ? { analysisId: yd.id, inputHash: yd.inputHash, snapshot: yd.snapshot } : null };
  try {
    const packs = input.packs.map(p => bundledPack(p.packId, p.version));
    const binding = knowledgeBinding(bim.binding, up, packs, input.scope.disciplines);
    checkUpstreamConsistency(binding, up);
    const facts = extractFacts(bim, up, binding);
    const model = validateKnowledgeModel(facts, bim, up, binding,
      { packs: packs.map(p => ({ packId: p.pack.packId, version: p.pack.version, checksum: p.checksum })), disciplines: input.scope.disciplines });
    if (model.status === 'INVALID') throw new KnowledgeError('KNOWLEDGE_MODEL_INVALID', 'Independent fact validation rejected the knowledge model');
    const bound = new Set<Source>(['ARCHITECTURE', ...(sd ? ['STRUCTURAL' as const] : []), ...(ed ? ['ENVIRONMENTAL' as const] : []), ...(yd ? ['SYSTEMS' as const] : [])]);
    if (selectedRules(packs, input).length > KNOWLEDGE_LIMITS.rulesSelected) throw new KnowledgeError('KNOWLEDGE_RESOURCE_LIMIT', 'Selected rule budget exceeded');
    return { packs, binding, facts, model, bound, acceptanceQaId: revision.qa.id };
  } catch (error) { knowledgeApiError(error); }
}

export async function knowledgePacks(repository: Repository, projectId: string, revisionId: string) {
  await new ProjectRepository(repository).read('revision', projectId, revisionId);
  try { return { packs: catalogEntries(), claims: CLAIMS }; } catch (error) { knowledgeApiError(error); }
}

/** Binding, selection, static predictions and budgets; never evaluates a predicate and never persists. */
export async function validateKnowledge(repository: Repository, projectId: string, revisionId: string, input: KnowledgeInput) {
  const p = await prepare(repository, projectId, revisionId, input);
  try {
    const selected = selectedRules(p.packs, input), conflicts = detectConflicts(selected).conflicts.length;
    return { binding: p.binding, readiness: 'EVALUATION_READY' as const,
      packs: p.packs.map(({ pack, checksum }) => ({ packId: pack.packId, version: pack.version, checksum, rulesTotal: pack.rules.length,
        rulesSelected: pack.rules.filter(r => input.scope.disciplines.includes(r.discipline)).length })),
      rules: selected.map(({ packId, rule }) => ({ packId, ruleId: rule.ruleId, discipline: rule.discipline, predicted: staticOutcome(rule, p.bound)?.status ?? 'EVALUABLE' as const })),
      facts: p.facts.summary, conflicts, validation: p.model, claims: CLAIMS, limitations: LIMITATIONS };
  } catch (error) { knowledgeApiError(error); }
}

export async function createKnowledgeAnalysis(repository: Repository, userId: string, projectId: string, revisionId: string, input: KnowledgeInput,
  secret?: string, context?: IdempotencyContext, onTimings?: (timings: { evaluatorMs: number; validatorMs: number }) => void) {
  if (!secret) throw new ApiError(503, 'KNOWLEDGE_UNAVAILABLE', 'Knowledge persistence is not configured');
  const p = await prepare(repository, projectId, revisionId, input);
  try {
    // ponytail: synchronous evaluation on the request thread, bounded by the preflighted rule/result/pair budgets and calculationMs; move to a worker if limits grow.
    const started = performance.now(), evaluation = evaluate(p.packs, p.facts, input, p.bound), evaluatorMs = performance.now() - started;
    const stored = { version: KNOWLEDGE_INPUT_VERSION, packs: input.packs, sources: input.sources, scope: input.scope };
    const packs = p.packs.map(({ pack, checksum }) => ({ packId: pack.packId, version: pack.version, checksum, pack, rulesTotal: pack.rules.length,
      rulesSelected: pack.rules.filter(r => input.scope.disciplines.includes(r.discipline)).length }));
    const draft = { binding: p.binding, inputHash: knowledgeInputHash(p.binding, stored), factsHash: digest(p.facts), input: stored, packs,
      facts: p.facts, ...evaluation };
    const validated = performance.now();
    const results = validateKnowledgeResults({ ...draft, claims: CLAIMS }, { binding: p.binding,
      checksums: Object.fromEntries(p.packs.map(x => [`${x.pack.packId}@${x.pack.version}`, x.checksum])) });
    const validatorMs = performance.now() - validated;
    if (results.status === 'INVALID') throw new KnowledgeError('KNOWLEDGE_RESULT_INVALID', 'Independent result validation rejected the evaluator output');
    const snapshot = SnapshotSchema.parse({ version: KNOWLEDGE_ANALYSIS_VERSION, ...draft, evaluator: EVALUATOR, validation: { model: p.model, results },
      status: { analysis: 'EVALUATED', validation: 'VALIDATED' }, claims: CLAIMS, limitations: LIMITATIONS });
    if (Buffer.byteLength(JSON.stringify(snapshot)) > KNOWLEDGE_LIMITS.outputBytes) throw new KnowledgeError('KNOWLEDGE_RESOURCE_LIMIT', 'Knowledge result exceeds the output budget');
    const write = { projectId, projectRevisionId: revisionId, acceptanceQaId: p.acceptanceQaId, snapshot };
    onTimings?.({ evaluatorMs, validatorMs });
    return await new KnowledgeRepository(repository).write(write, signProjectCommit(secret, userId, KNOWLEDGE_ANALYSIS_OPERATION, write, context), context);
  } catch (error) { knowledgeApiError(error); }
}

export async function readKnowledgeAnalysis(repository: Repository, projectId: string, revisionId: string, analysisId: string, requireCurrent: boolean) {
  const { detail, projectCurrentRevisionId } = await new KnowledgeRepository(repository).read(projectId, revisionId, analysisId);
  // Defense in depth: the DB already scopes the row to this project/revision.
  if (detail.projectRevisionId !== revisionId || detail.snapshot.binding.revisionId !== revisionId || detail.snapshot.binding.projectId !== projectId)
    throw new ApiError(404, 'KNOWLEDGE_ANALYSIS_NOT_FOUND', 'Knowledge analysis not found');
  const c = currency(detail.projectRevisionId, projectCurrentRevisionId);
  if (requireCurrent && c.status !== 'CURRENT') knowledgeApiError(new KnowledgeError('KNOWLEDGE_RESULT_STALE', 'The knowledge analysis belongs to a superseded revision'));
  return { ...detail, currency: c };
}

export async function listKnowledgeAnalyses(repository: Repository, projectId: string, revisionId: string, query: { limit: number; cursor?: string | undefined }) {
  const { items, nextCursor, projectCurrentRevisionId } = await new KnowledgeRepository(repository).list(projectId, revisionId, query);
  return { items: items.map(i => ({ ...i, currency: currency(i.projectRevisionId, projectCurrentRevisionId) })), nextCursor };
}

/** Results are never reused across revisions: analyses of any other revision are STALE for this one. */
export async function knowledgeStatus(repository: Repository, projectId: string, revisionId: string) {
  const s = await new KnowledgeRepository(repository).status(projectId, revisionId);
  return { projectId, revisionId, revisionNumber: s.revisionNumber, projectCurrentRevisionId: s.projectCurrentRevisionId,
    revisionCurrency: revisionId === s.projectCurrentRevisionId ? 'CURRENT' as const : 'HISTORICAL' as const,
    knowledgeStatus: s.analyses.length ? 'EVALUATED' as const : 'NOT_EVALUATED' as const, requiresNewAnalysis: s.analyses.length === 0,
    analyses: s.analyses.map(a => ({ ...a, currency: currency(a.projectRevisionId, s.projectCurrentRevisionId) })),
    staleAnalyses: s.otherRevisionAnalyses.map(a => ({ ...a, currency: { status: 'STALE' as const, analysisRevisionId: a.projectRevisionId, projectCurrentRevisionId: s.projectCurrentRevisionId },
      staleReason: 'BOUND_TO_A_DIFFERENT_REVISION' as const })),
    claims: CLAIMS };
}
