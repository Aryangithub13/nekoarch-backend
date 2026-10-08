import { costHash } from '@designflow/boq-cost';
import { ConstructionSpecificationSchema } from '@designflow/construction-calculations';
import { normalizeParametricRequirements, type NormalizedParametricRequirements } from '@designflow/generator';
import { modelHash } from '../lib/generation-identity.js';
import { CLAIMS, DEFERRED_METRIC_KINDS, ENGINEERING, OPTIMIZATION_CANDIDATE_VERSION, OPTIMIZATION_LIMITS, OPTIMIZATION_METRICS_VERSION, OPTIMIZATION_SOURCE_GENERATOR,
  OPTIMIZATION_STUDY_VERSION, OPTIMIZER_VERSION, OptimizationError, OptimizationInputSchema, metricKey, slotOf,
  type Candidate, type CandidateEvidence, type MetricRef, type OptimizationInput, type OptimizationKnowledgeAdapter, type OptimizationSource, type Study } from './contracts.js';
import { adoptionEdits, architectureFor, assignmentOf, candidateId, compareVectors, gridVectors, inDomain, neighbours, preflightSpace, vectorKey, vectorOf, type CandidateBinding, type Vector } from './domain.js';
import { auditCandidate, generateCandidate, generateWithEngine, measure, type Built, type CandidateContext, type CostEvidence, type Generate } from './candidate.js';
import { classify, cmp, normalizationBounds, parseDecimal, rankCandidates, scoreObjectives, toExact, ZERO, type Measured, type MetricValue, type Rational } from './rank.js';
import { validateOptimizationStudy } from './validate.js';

export interface StudyDeps { generate?: Generate; knowledge?: OptimizationKnowledgeAdapter | null; now?: () => number }
export interface StudyRun { study: Study; evidence: Map<string, CandidateEvidence>; diagnostics: { timingsMs: Record<string, number>; snapshotBytes: number } }

const invalid = (message: string, field = '') => new OptimizationError('OPTIMIZATION_INPUT_INVALID', message, field ? { field } : {});
const unsupported = (message: string, reason: string) => new OptimizationError('OPTIMIZATION_UNSUPPORTED', message, { reason });

function boundedJson(value: unknown): void {
  let nodes = 0;
  const seen = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > OPTIMIZATION_LIMITS.inputNodes || depth > OPTIMIZATION_LIMITS.inputDepth) throw new OptimizationError('OPTIMIZATION_RESOURCE_LIMIT', 'Optimization input size/depth budget exceeded', { limit: 'inputNodes' });
    // Hashed inputs carry only safe integers (decimals are strings), so JS costHash and SQL cost_hash agree byte-for-byte.
    if (typeof v === 'number' && !Number.isSafeInteger(v)) throw invalid('Numbers must be safe integers; send decimals as strings');
    if (!v || typeof v !== 'object') return;
    const proto = Object.getPrototypeOf(v);
    if (seen.has(v) || (!Array.isArray(v) && proto !== Object.prototype && proto !== null)) throw invalid('Expected plain acyclic data');
    seen.add(v);
    for (const d of Object.values(Object.getOwnPropertyDescriptors(v))) { if ('get' in d || 'set' in d) throw invalid('Accessors are unsupported'); visit(d.value, depth + 1); }
    seen.delete(v);
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value) ?? '') > OPTIMIZATION_LIMITS.inputBytes) throw new OptimizationError('OPTIMIZATION_RESOURCE_LIMIT', 'Optimization input too large', { limit: 'inputBytes' });
}

const allMetrics = (input: OptimizationInput): MetricRef[] => {
  const refs = [...input.objectives.map(o => o.metric), ...input.hardConstraints.flatMap(c => (c.kind === 'METRIC_BOUND' ? [c.metric] : []))];
  return [...new Map(refs.map(m => [metricKey(m), m])).values()].sort((a, b) => (metricKey(a) < metricKey(b) ? -1 : 1));
};

/** Accepted parametric revision only (D1); identity must match its stored model. */
export function resolveSource(source: OptimizationSource): NormalizedParametricRequirements {
  if (source.generatorVersion !== OPTIMIZATION_SOURCE_GENERATOR || !source.normalizedRequirements)
    throw unsupported('Only accepted parametric-architecture-v1 revisions can be optimized', 'SOURCE_GENERATOR_UNSUPPORTED');
  if (!['PASS', 'PASS_WITH_WARNINGS'].includes(source.qa.status) || source.qa.inputStatus !== 'SCHEMA_VALID' || source.qa.errors)
    throw new OptimizationError('REVISION_NOT_ACCEPTED', 'Revision has no accepted QA evidence');
  if (!source.identity || source.identity.modelHash !== modelHash(source.model))
    throw new OptimizationError('OPTIMIZATION_BASELINE_MISMATCH', 'Stored revision identity differs from its model');
  try { return normalizeParametricRequirements(structuredClone(source.normalizedRequirements)); }
  catch { throw new OptimizationError('OPTIMIZATION_BASELINE_MISMATCH', 'Stored requirements no longer normalize'); }
}

/** Schema + semantic validation against the source. Returns the canonical input (hashed as-is). */
export function validateOptimizationInput(raw: unknown, source: OptimizationSource, requirements = resolveSource(source)): OptimizationInput {
  boundedJson(raw);
  const parsed = OptimizationInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid optimization input', parsed.error.issues.slice(0, 8).map(i => i.path.join('.')).join(','));
  const input = parsed.data;
  if (Object.values(input.sources).some(v => v !== null)) throw unsupported('Upstream analyses are not consumed in V1', 'SOURCE_ANALYSIS_DEFERRED');
  const metrics = allMetrics(input);
  for (const m of metrics) if ((DEFERRED_METRIC_KINDS as readonly string[]).includes(m.kind)) throw unsupported(`${m.kind} metrics are not evaluated per candidate in V1`, `DEFERRED_METRIC:${m.kind}`);
  const unique = (values: string[], field: string) => { if (new Set(values).size !== values.length) throw invalid('Duplicate identifiers', field); };
  unique(input.variables.map(v => v.variableId), 'variables.variableId');
  unique(input.variables.map(v => String(slotOf(v.target.level, v.target.parameter))), 'variables.target');
  unique(input.objectives.map(o => o.objectiveId), 'objectives.objectiveId');
  unique(input.hardConstraints.map(c => c.constraintId), 'hardConstraints.constraintId');
  if (input.variables.some(v => v.target.level >= requirements.parametricArchitecture.floors.length)) throw invalid('Variable targets a level the source does not have', 'variables.target.level');
  const spaces = source.model.spaces;
  const checkBase = (m: MetricRef): void => {
    if (m.kind === 'RATIO') { checkBase(m.numerator); checkBase(m.denominator); return; }
    if (m.kind === 'CLASSIFICATION_FLOOR_AREA' && !spaces.some(s => s.classification === m.classification)) throw invalid('Unknown classification in the baseline model', 'metric.classification');
    if (m.kind === 'SPACE_FLOOR_AREA' && !spaces.some(s => s.id === m.spaceId)) throw invalid('Unknown space in the baseline model', 'metric.spaceId');
  };
  metrics.forEach(checkBase);
  const usesCost = metrics.some(m => metricKey(m).includes('PRICED_SCOPE_TOTAL'));
  if (usesCost !== (input.cost !== null)) throw invalid(usesCost ? 'PRICED_SCOPE_TOTAL requires a cost configuration' : 'Cost configuration is unused', 'cost');
  if (input.cost) {
    const spec = ConstructionSpecificationSchema.safeParse(input.cost.specification);
    if (!spec.success) throw invalid('Invalid construction specification', 'cost.specification');
    if (spec.data.assignments.some(a => a.selector.kind === 'entity')) throw unsupported('Entity selectors bind to one model and cannot be transferred to candidates', 'COST_SPECIFICATION_NOT_TRANSFERABLE');
  }
  for (const o of input.objectives) {
    const n = o.normalization, goal = o.goal.kind, field = `objectives.${o.objectiveId}`;
    if (input.mode === 'PARETO') { if (o.weight !== undefined || n) throw invalid('PARETO objectives take no weight or normalization', field); continue; }
    if (o.weight === undefined) throw invalid('WEIGHTED_SCORE requires an explicit weight per objective', `${field}.weight`);
    if (o.weight === 0) { if (n) throw invalid('REPORT_ONLY objectives take no normalization', `${field}.normalization`); continue; }
    if (!n) throw invalid('Weighted objectives require explicit normalization', `${field}.normalization`);
    const ok = n.method === 'TARGET_TOLERANCE' ? goal === 'TARGET' && cmp(parseDecimal(n.tolerance), ZERO) > 0
      : goal !== 'TARGET' && (n.method === 'CANDIDATE_RANGE' || cmp(parseDecimal(n.best), parseDecimal(n.worst)) === (goal === 'MINIMIZE' ? -1 : 1));
    if (!ok) throw invalid('Normalization is incompatible with the objective goal', `${field}.normalization`);
  }
  if (input.mode === 'WEIGHTED_SCORE' && !input.objectives.some(o => (o.weight ?? 0) > 0)) throw invalid('At least one objective needs a positive weight', 'objectives.weight');
  if (input.strategy.kind === 'DETERMINISTIC_LOCAL_SEARCH') {
    if (input.mode !== 'WEIGHTED_SCORE') throw invalid('Local search requires WEIGHTED_SCORE', 'strategy');
    if (input.objectives.some(o => o.normalization?.method === 'CANDIDATE_RANGE')) throw invalid('Local search cannot use CANDIDATE_RANGE normalization', 'strategy');
    if (!inDomain(input.variables, vectorOf(requirements.parametricArchitecture))) throw invalid('Local search starts at the baseline, which must lie in every domain', 'variables.domain');
  }
  const byId = <T>(key: (x: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  return { ...input,
    variables: [...input.variables].sort((a, b) => slotOf(a.target.level, a.target.parameter) - slotOf(b.target.level, b.target.parameter)),
    objectives: [...input.objectives].sort(byId(o => o.objectiveId)), hardConstraints: [...input.hardConstraints].sort(byId(c => c.constraintId)) };
}

interface Entry { vector: Vector; id: string; built: Built; primary: string | null; measured: Measured | null; cost: CostEvidence | null; takeoff: unknown }
const exact = (r: Rational | null) => (r ? toExact(r) : null);
const exactMetric = (m: MetricValue) => ({ ...m, value: exact(m.value) });

export function runOptimizationStudy(source: OptimizationSource, raw: unknown, deps: StudyDeps = {}): StudyRun {
  const now = deps.now ?? (() => performance.now()), started = now();
  if (deps.knowledge) throw unsupported('Knowledge integration is deferred until Phase 27 is released', 'PHASE27_INTEGRATION_DEFERRED');
  const requirements = resolveSource(source), input = validateOptimizationInput(raw, source, requirements), size = preflightSpace(input);
  const arch = requirements.parametricArchitecture, base = vectorOf(arch), baseKey = vectorKey(base);
  const binding: CandidateBinding = { projectId: source.projectId, sourceRevisionId: source.revisionId, sourceModelHash: source.identity!.modelHash, generatorVersion: OPTIMIZATION_SOURCE_GENERATOR, seed: requirements.seed };
  const ctx: CandidateContext = { requirements, cost: input.cost, metrics: allMetrics(input), generate: deps.generate ?? generateWithEngine,
    timings: { generation: 0, qa: 0, takeoff: 0, cost: 0 }, now };
  const entries = new Map<string, Entry>(), byModel = new Map<string, string>();
  let baselineSignature: string | null = null;

  const evaluate = (vector: Vector): Entry => {
    const key = vectorKey(vector), known = entries.get(key);
    if (known) return known;
    if (now() - started > OPTIMIZATION_LIMITS.deadlineMs) throw new OptimizationError('OPTIMIZATION_RESOURCE_LIMIT', 'Optimization study deadline exceeded', { limit: 'deadlineMs' });
    const generated = generateCandidate(ctx, architectureFor(arch, vector)), primary = generated.kind === 'GENERATED' ? byModel.get(generated.modelHash) : undefined;
    // Dedup before QA: an identical architecture (modelHash) is audited and measured once; the assignment becomes an alias.
    const built: Built = generated.kind === 'REJECTED' ? generated : primary ? { kind: 'ALIAS', model: generated.model, modelHash: generated.modelHash, qaReport: null } : auditCandidate(ctx, generated);
    const entry: Entry = { vector, id: candidateId(binding, vector), built, primary: primary ?? null, measured: null, cost: null, takeoff: null };
    if (built.kind === 'REJECTED') entry.measured = { metrics: {}, qa: built.qaReport ? { status: built.qaReport.status, warnings: built.qaReport.summary.warnings } : null, gate: built.rejection };
    else if (built.kind === 'BUILT') {
      byModel.set(built.modelHash, key);
      const m = measure(ctx, built.model, key === baseKey ? null : baselineSignature);
      Object.assign(entry, { measured: { metrics: m.metrics, qa: built.qa, gate: null }, cost: m.cost, takeoff: m.takeoff });
    }
    entries.set(key, entry);
    return entry;
  };
  const measuredOf = (e: Entry) => (e.primary ? entries.get(e.primary)!.measured! : e.measured!);

  const baseline = evaluate(base);
  if (baseline.built.kind !== 'BUILT' || baseline.built.modelHash !== binding.sourceModelHash)
    throw new OptimizationError('OPTIMIZATION_BASELINE_MISMATCH', 'Rebuilding the source parameters does not reproduce the accepted revision');
  if (input.cost) {
    if (!baseline.cost?.report) throw invalid('Cost configuration cannot be evaluated on the baseline', 'cost');
    baselineSignature = baseline.cost.scopeSignature;
  }

  let status: Study['status'] = 'COMPLETED';
  if (input.strategy.kind === 'GRID') for (const v of gridVectors(input.variables, base)) evaluate(v);
  else {
    // Deterministic coordinate descent: fixed normalization, best strictly-improving neighbour, canonical ties, no RNG.
    const bounds = normalizationBounds(input, []), max = input.strategy.maxEvaluations;
    const scoreOf = (e: Entry) => { const m = measuredOf(e); return classify(input, m).status === 'VALID' ? scoreObjectives(input, bounds, m, true).score : null; };
    let current = baseline;
    search: for (;;) {
      let best: Entry | null = null, bestScore: Rational | null = null;
      for (const v of neighbours(input.variables, current.vector)) {
        if (!entries.has(vectorKey(v)) && entries.size >= max) { status = 'BUDGET_EXHAUSTED'; break search; }
        const e = evaluate(v), s = scoreOf(e);
        if (s && (!bestScore || cmp(s, bestScore) > 0)) { best = e; bestScore = s; }
      }
      const currentScore = scoreOf(current);
      if (!best || !bestScore || (currentScore && cmp(bestScore, currentScore) <= 0)) break;
      current = best;
    }
  }
  const searchedAt = now();

  const primaries = [...entries.values()].filter(e => !e.primary).sort((a, b) => compareVectors(a.vector, b.vector));
  const ranked = rankCandidates(input, primaries.map(e => e.measured!)), ids = primaries.map(e => e.id);
  const candidates: Candidate[] = primaries.map((e, i) => {
    const r = ranked.rows[i]!, key = vectorKey(e.vector);
    return { candidateId: e.id, ordinal: i, isBaseline: key === baseKey, parameters: e.vector, assignment: assignmentOf(input.variables, e.vector),
      aliases: [...entries.values()].filter(a => a.primary === key).sort((a, b) => compareVectors(a.vector, b.vector)).map(a => ({ candidateId: a.id, parameters: a.vector })),
      modelHash: e.built.kind === 'BUILT' ? e.built.modelHash : null, status: r.status, rejection: r.rejection, qa: e.measured!.qa,
      cost: e.cost?.report ? { scopeSignature: e.cost.scopeSignature!, unpricedLines: e.cost.unpricedLines, completeTotalAvailable: e.cost.completeTotalAvailable } : null,
      metrics: Object.fromEntries(Object.entries(e.measured!.metrics).map(([k, m]) => [k, exactMetric(m)])), constraints: r.constraints,
      objectives: r.objectives.map(o => ({ ...o, value: exact(o.value), normalized: exact(o.normalized), contribution: exact(o.contribution) })),
      score: exact(r.score), rank: r.rank, paretoStatus: r.paretoStatus, dominatedBy: r.dominatedBy.map(j => ids[j]!),
      architectureMutation: 'NONE', adoption: { parametricEdits: adoptionEdits(base, e.vector), apply: 'ATOMIC' } };
  });
  const count = (s: Candidate['status']) => candidates.filter(c => c.status === s).length;
  if (!count('VALID')) status = 'NO_VALID_CANDIDATE';
  const baselineCost = baseline.cost?.report;
  const body: Omit<Study, 'resultHash'> = {
    version: OPTIMIZATION_STUDY_VERSION, binding: { ...binding, generatorVersion: OPTIMIZATION_SOURCE_GENERATOR, parameterHash: costHash(arch) },
    input, inputHash: costHash(input),
    engine: { optimizerVersion: OPTIMIZER_VERSION, metricsVersion: OPTIMIZATION_METRICS_VERSION, candidateIdVersion: OPTIMIZATION_CANDIDATE_VERSION },
    status, search: { candidateSpaceSize: size.toString(), evaluatedAssignments: entries.size, candidates: candidates.length, valid: count('VALID'), rejected: count('REJECTED'),
      partial: count('PARTIAL'), inputIncomplete: count('INPUT_INCOMPLETE'), deduplicated: entries.size - primaries.length },
    baseline: { candidateId: baseline.id, parameters: base },
    cost: input.cost && baselineCost ? { basis: 'PRICED_SCOPE_ONLY', rateBookId: input.cost.rateBookId, currency: baselineCost.currency, baselineScopeSignature: baselineSignature!,
      baselineExcludedScopes: [...baselineCost.excludedScopes].sort(), baselineCompleteTotalAvailable: baselineCost.finalTotals.completeTotalAvailable } : null,
    candidates,
    normalization: ranked.bounds.map(b => ({ objectiveId: b.objectiveId, method: b.method, best: exact(b.best), worst: exact(b.worst), target: exact(b.target), tolerance: exact(b.tolerance), degenerate: b.degenerate })),
    paretoFrontier: ranked.frontier.map(i => ids[i]!), recommendedCandidates: ranked.recommended.map(i => ids[i]!),
    engineering: { ...ENGINEERING }, limits: { ...OPTIMIZATION_LIMITS },
    claims: { searchResult: status === 'NO_VALID_CANDIDATE' ? 'NONE' : input.strategy.kind === 'GRID' ? 'BEST_IN_EVALUATED_SEARCH_SPACE' : 'BEST_FOUND', ...CLAIMS },
  };
  const study: Study = { ...body, resultHash: costHash(body) };
  const snapshotBytes = Buffer.byteLength(JSON.stringify(study)), scoredAt = now();
  if (snapshotBytes > OPTIMIZATION_LIMITS.snapshotBytes) throw new OptimizationError('OPTIMIZATION_RESOURCE_LIMIT', 'Optimization study exceeds the snapshot budget', { limit: 'snapshotBytes', value: String(snapshotBytes) });
  const owner = (e: Entry) => (e.primary ? entries.get(e.primary)! : e);
  const evidence = new Map<string, CandidateEvidence>([...entries.values()].map(e => [e.id, { model: e.built.model, qa: e.built.qaReport, takeoff: owner(e).takeoff, cost: owner(e).cost?.report ?? null }]));
  const verdict = validateOptimizationStudy(study, { source, evidence, generate: ctx.generate }), validatedAt = now();
  if (verdict.status !== 'VALID') throw new OptimizationError('OPTIMIZATION_VALIDATION_FAILED', 'Independent validation rejected the optimization study', { issue: verdict.issues[0] ?? '' });
  return { study, evidence, diagnostics: { snapshotBytes, timingsMs: { ...ctx.timings, scoring: scoredAt - searchedAt, validation: validatedAt - scoredAt, total: validatedAt - started } } };
}
