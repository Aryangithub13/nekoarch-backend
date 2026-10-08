import { costHash, BoqCostReportSchema } from '@designflow/boq-cost';
import { BlueprintQaReportSchema } from '@designflow/blueprint-qa';
import { normalizeParametricRequirements } from '@designflow/generator';
import { QuantityTakeoffReportSchema, type QuantityTakeoffReport } from '@designflow/quantity-takeoff';
import { ArchitecturalBuildingModelV2Schema } from '@designflow/shared';
import { modelHash } from '../lib/generation-identity.js';
import { OPTIMIZATION_CANDIDATE_VERSION, OPTIMIZATION_LIMITS, StudySchema, metricKey,
  type BaseMetricRef, type Candidate, type CandidateEvidence, type Exact, type MetricRef, type OptimizationInput, type OptimizationSource, type Study } from './contracts.js';

/**
 * Independent study validator. It deliberately re-implements its arithmetic, enumeration, metric
 * extraction, scoring, Pareto and local-search replay; it must not import domain/candidate/rank/study.
 * It verifies every recorded number it can reach from in-memory evidence. Generator/model-stage
 * rejection codes are trusted as recorded (rejected candidates are never ranked).
 */
type Q = [bigint, bigint];
const g = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
const q = (n: bigint, d = 1n): Q => { if (d < 0n) { n = -n; d = -d; } const k = g(n, d) || 1n; return [n / k, d / k]; };
const dec = (s: string): Q => { const [i, f = ''] = s.replace('-', '').split('.'); return q((s.startsWith('-') ? -1n : 1n) * BigInt(i! + f), 10n ** BigInt(f.length)); };
const qAdd = (a: Q, b: Q) => q(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const qSub = (a: Q, b: Q) => q(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const qMul = (a: Q, b: Q) => q(a[0] * b[0], a[1] * b[1]);
const qDiv = (a: Q, b: Q) => q(a[0] * b[1], a[1] * b[0]);
const qCmp = (a: Q, b: Q) => { const x = a[0] * b[1] - b[0] * a[1]; return x < 0n ? -1 : x > 0n ? 1 : 0; };
const qAbs = (a: Q): Q => [a[0] < 0n ? -a[0] : a[0], a[1]];
const ex = (a: Q | null): Exact | null => (a ? { numerator: a[0].toString(), denominator: a[1].toString() } : null);
const same = (a: unknown, b: unknown) => costHash({ v: a }) === costHash({ v: b });

const PARAMS = ['widthMm', 'depthMm', 'westWingWidthMm', 'southWingDepthMm'] as const;
type Vec = (number | null)[];
const order = (a: Vec, b: Vec) => { for (let i = 0; i < 8; i++) { const x = a[i] ?? null, y = b[i] ?? null; if (x !== y) return x === null ? -1 : y === null ? 1 : x - y; } return 0; };
const vkey = (v: Vec) => JSON.stringify(v);
const slotOf = (level: number, p: string) => level * 4 + PARAMS.indexOf(p as typeof PARAMS[number]);
interface Arch { floors: ({ level: number } & Record<typeof PARAMS[number], number>)[] }
const vec = (arch: Arch): Vec => { const v: Vec = Array(8).fill(null); for (const f of arch.floors) PARAMS.forEach(p => { v[slotOf(f.level, p)] = f[p]; }); return v; };
const values = (v: OptimizationInput['variables'][number]): number[] => {
  const d = v.domain;
  return d.kind === 'VALUES' ? d.valuesMm : Array.from({ length: (d.maximumMm - d.minimumMm) / d.stepMm + 1 }, (_, i) => d.minimumMm + i * d.stepMm);
};

interface MetricOut { status: string; stage: 'A' | 'B'; unit: string; value: Q | null; reason: string | null }
function itemMetric(t: QuantityTakeoffReport | null, m: Exclude<BaseMetricRef, { kind: 'PRICED_SCOPE_TOTAL' }>): MetricOut {
  const unit = m.kind === 'WALL_CENTERLINE_LENGTH' ? 'mm' : m.kind === 'WALL_NET_VOLUME' ? 'mm3' : 'mm2';
  if (!t) return { status: 'NOT_EVALUATED', stage: 'A', unit, value: null, reason: 'TAKEOFF_FAILED' };
  const pick = (code: string, keep: (i: QuantityTakeoffReport['items'][number]) => boolean) => t.items.filter(i => i.itemCode === code && keep(i));
  const items = m.kind === 'GROSS_FLOOR_AREA' ? pick('GEOMETRIC_GROSS_FLOOR_AREA', () => true)
    : m.kind === 'FOOTPRINT_AREA' ? pick('LEVEL_ENVELOPE_AREA', i => i.levelId === 'level-0')
    : m.kind === 'WALL_CENTERLINE_LENGTH' ? pick('WALL_CENTERLINE_LENGTH', () => true)
    : m.kind === 'WALL_NET_VOLUME' ? pick('WALL_SEGMENT_NET_VOLUME', () => true)
    : m.kind === 'CLASSIFICATION_FLOOR_AREA' ? pick('SPACE_FLOOR_AREA', i => i.classification === m.classification)
    : pick('SPACE_FLOOR_AREA', i => i.sourceEntityIds[0] === m.spaceId);
  if (!items.length || (m.kind === 'SPACE_FLOOR_AREA' && items.length !== 1)) return { status: 'NOT_EVALUATED', stage: 'A', unit, value: null, reason: 'METRIC_SOURCE_MISSING' };
  const bad = items.find(i => i.status !== 'EVALUATED');
  if (bad) return { status: 'INPUT_INCOMPLETE', stage: 'A', unit, value: null, reason: `TAKEOFF_${m.kind === 'SPACE_FLOOR_AREA' ? bad.status : 'PARTIAL'}` };
  return { status: 'EVALUATED', stage: 'A', unit, value: items.reduce<Q>((s, i) => qAdd(s, dec(i.quantity.value)), [0n, 1n]), reason: null };
}
function signature(c: ReturnType<typeof BoqCostReportSchema.parse>) {
  const codes = (priced: boolean) => [...new Set(c.boqLines.filter(l => (l.status === 'PRICED') === priced).map(l => l.lineCode))].sort();
  return costHash({ currency: c.currency, coverage: c.coverage, upstreamStatus: c.source.upstreamStatus, excludedScopes: [...c.excludedScopes].sort(), pricedLineCodes: codes(true), unpricedLineCodes: codes(false) });
}

export function validateOptimizationStudy(raw: unknown, ctx: { source: OptimizationSource; evidence: Map<string, CandidateEvidence> }): { status: 'VALID' | 'INVALID'; issues: string[] } {
  const issues: string[] = [], fail = (m: string) => { issues.push(m); };
  const parsed = StudySchema.safeParse(raw);
  if (!parsed.success) return { status: 'INVALID', issues: ['SCHEMA:' + parsed.error.issues.slice(0, 3).map(i => i.path.join('.')).join(',')] };
  const s: Study = parsed.data, input = s.input, { source, evidence } = ctx;
  const { resultHash, ...body } = s;
  if (costHash(body) !== resultHash) fail('RESULT_HASH');
  if (costHash(input) !== s.inputHash) fail('INPUT_HASH');
  if (!same(s.limits, OPTIMIZATION_LIMITS)) fail('LIMITS');

  // Binding and baseline.
  const req = normalizeParametricRequirements(structuredClone(source.normalizedRequirements)), arch = req.parametricArchitecture, base = vec(arch);
  const sourceHash = modelHash(source.model);
  if (s.binding.projectId !== source.projectId || s.binding.sourceRevisionId !== source.revisionId || s.binding.sourceModelHash !== sourceHash
    || source.identity?.modelHash !== sourceHash || s.binding.seed !== req.seed || s.binding.parameterHash !== costHash(arch)) fail('BINDING');
  const idOf = (v: Vec) => costHash({ version: OPTIMIZATION_CANDIDATE_VERSION, projectId: s.binding.projectId, sourceRevisionId: s.binding.sourceRevisionId,
    sourceModelHash: s.binding.sourceModelHash, generatorVersion: s.binding.generatorVersion, seed: s.binding.seed, parameters: v });
  if (!same(s.baseline.parameters, base) || s.baseline.candidateId !== idOf(base)) fail('BASELINE');

  // Enumeration, identity, assignments, adoption.
  const varSlots = input.variables.map(v => slotOf(v.target.level, v.target.parameter));
  const size = input.variables.reduce((n, v) => n * BigInt(values(v).length), 1n);
  if (s.search.candidateSpaceSize !== size.toString()) fail('SPACE_SIZE');
  if (input.strategy.kind === 'GRID' && size > BigInt(OPTIMIZATION_LIMITS.maxGridCandidates)) fail('SPACE_LIMIT');
  const all = new Map<string, Candidate>();
  s.candidates.forEach((c, i) => {
    if (c.ordinal !== i || (i && order(s.candidates[i - 1]!.parameters, c.parameters) >= 0)) fail(`ORDER:${i}`);
    if (c.isBaseline !== same(c.parameters, base)) fail(`IS_BASELINE:${i}`);
    for (const v of [c.parameters, ...c.aliases.map(a => a.parameters)]) {
      if (all.has(vkey(v))) fail(`DUPLICATE:${i}`);
      all.set(vkey(v), c);
      if (base.some((b, k) => !varSlots.includes(k) && v[k] !== b)) fail(`FIXED_SLOT:${i}`);
      if (!same(v, base) && input.variables.some((x, k) => !values(x).includes(v[varSlots[k]!]!))) fail(`DOMAIN:${i}`);
    }
    if (c.candidateId !== idOf(c.parameters) || c.aliases.some(a => a.candidateId !== idOf(a.parameters))) fail(`CANDIDATE_ID:${i}`);
    if (!same(c.assignment, Object.fromEntries(input.variables.map((x, k) => [x.variableId, c.parameters[varSlots[k]!]])))) fail(`ASSIGNMENT:${i}`);
    const applied = [...base];
    for (const e of c.adoption.parametricEdits) applied[slotOf(e.level, e.parameter)] = e.valueMm;
    const changed = base.flatMap((b, k) => (c.parameters[k] !== b ? [k] : []));
    if (!same(applied, c.parameters) || !same(c.adoption.parametricEdits.map(e => slotOf(e.level, e.parameter)), changed)) fail(`ADOPTION:${i}`);
  });
  if (s.search.evaluatedAssignments !== all.size || s.search.candidates !== s.candidates.length
    || s.search.deduplicated !== all.size - s.candidates.length) fail('SEARCH_COUNTS');
  if (!all.has(vkey(base))) fail('BASELINE_MISSING');
  if (input.strategy.kind === 'GRID') {
    const grid = new Set<string>([vkey(base)]);
    const walk = (k: number, v: Vec): void => { if (k === input.variables.length) { grid.add(vkey(v)); return; } for (const x of values(input.variables[k]!)) { const w = [...v]; w[varSlots[k]!] = x; walk(k + 1, w); } };
    walk(0, base);
    if (all.size !== grid.size || [...grid].some(k => !all.has(k))) fail('GRID_COVERAGE');
  } else if (all.size > input.strategy.maxEvaluations) fail('LOCAL_BUDGET');

  // Per-candidate evidence: identity, gates, metrics.
  const refs = [...new Map([...input.objectives.map(o => o.metric), ...input.hardConstraints.flatMap(c => (c.kind === 'METRIC_BOUND' ? [c.metric] : []))].map(x => [metricKey(x), x])).values()];
  let baselineSig: string | null = null;
  if (input.cost) {
    const c = BoqCostReportSchema.safeParse(evidence.get(s.baseline.candidateId)?.cost);
    if (!c.success || !s.cost) fail('BASELINE_COST');
    else { baselineSig = signature(c.data); if (s.cost.baselineScopeSignature !== baselineSig || s.cost.currency !== c.data.currency
      || !same(s.cost.baselineExcludedScopes, [...c.data.excludedScopes].sort()) || s.cost.baselineCompleteTotalAvailable !== c.data.finalTotals.completeTotalAvailable) fail('COST_SUMMARY'); }
  } else if (s.cost) fail('COST_SUMMARY');
  const own = new Map<string, Record<string, MetricOut>>();
  for (const c of s.candidates) {
    const ev = evidence.get(c.candidateId), tag = c.candidateId.slice(0, 12), stage = c.rejection?.stage;
    if (stage && stage !== 'CONSTRAINT') {
      if (c.status !== 'REJECTED' || c.modelHash !== null || Object.keys(c.metrics).length || c.constraints.length || c.score || c.rank !== null) fail(`GATE_SHAPE:${tag}`);
      if (stage === 'NORMALIZATION') {
        const a = structuredClone(arch); a.floors.forEach(f => PARAMS.forEach(p => { f[p] = c.parameters[slotOf(f.level, p)]!; }));
        let threw = false; try { normalizeParametricRequirements({ ...structuredClone(req), parametricArchitecture: a }); } catch { threw = true; }
        if (!threw) fail(`NORMALIZATION_GATE:${tag}`);
      }
      if (stage === 'QA') {
        const r = BlueprintQaReportSchema.safeParse(ev?.qa);
        if (!r.success || (r.data.status !== 'FAIL' && r.data.inputStatus === 'SCHEMA_VALID' && !r.data.summary.errors)) fail(`QA_GATE:${tag}`);
      }
      own.set(c.candidateId, {});
      continue;
    }
    const model = ArchitecturalBuildingModelV2Schema.safeParse(ev?.model), qa = BlueprintQaReportSchema.safeParse(ev?.qa);
    if (!model.success || !qa.success || modelHash(model.data) !== c.modelHash || !model.data.parametricArchitecture || !same(vec(model.data.parametricArchitecture), c.parameters)) { fail(`MODEL:${tag}`); own.set(c.candidateId, {}); continue; }
    if (qa.data.status === 'FAIL' || qa.data.inputStatus !== 'SCHEMA_VALID' || qa.data.summary.errors || c.qa?.status !== qa.data.status || c.qa.warnings !== qa.data.summary.warnings) fail(`QA:${tag}`);
    for (const a of c.aliases) { const m = ArchitecturalBuildingModelV2Schema.safeParse(evidence.get(a.candidateId)?.model); if (!m.success || modelHash(m.data) !== c.modelHash) fail(`ALIAS:${tag}`); }
    const t = ev?.takeoff ? QuantityTakeoffReportSchema.parse(ev.takeoff) : null;
    const cost = ev?.cost ? BoqCostReportSchema.parse(ev.cost) : null;
    if (input.cost && cost && (c.cost?.scopeSignature !== signature(cost) || c.cost.unpricedLines !== cost.unpricedLineIds.length || c.cost.completeTotalAvailable !== cost.finalTotals.completeTotalAvailable)) fail(`COST:${tag}`);
    const metric = (m: BaseMetricRef): MetricOut => {
      if (m.kind !== 'PRICED_SCOPE_TOTAL') return itemMetric(t, m);
      const unit = cost?.currency ?? 'INR';
      if (!cost) { const r = c.metrics[metricKey(m)]?.reason ?? ''; return { status: 'NOT_EVALUATED', stage: 'B', unit, value: null, reason: r.startsWith('COST_FAILED:') || r === 'TAKEOFF_FAILED' ? r : 'COST_EVIDENCE_MISSING' }; }
      if (cost.unpricedLineIds.length) return { status: 'INPUT_INCOMPLETE', stage: 'B', unit, value: null, reason: 'COST_UNPRICED_LINES' };
      if (!c.isBaseline && signature(cost) !== baselineSig) return { status: 'INPUT_INCOMPLETE', stage: 'B', unit, value: null, reason: 'COST_SCOPE_NOT_COMPARABLE' };
      return { status: 'EVALUATED', stage: 'B', unit, value: dec(cost.finalTotals.pricedGrandTotal), reason: null };
    };
    const out: Record<string, MetricOut> = {};
    for (const m of refs as MetricRef[]) {
      if (m.kind === 'RATIO') {
        const a = metric(m.numerator), b = metric(m.denominator), st = a.stage === 'B' || b.stage === 'B' ? 'B' as const : 'A' as const;
        out[metricKey(m)] = a.status !== 'EVALUATED' || b.status !== 'EVALUATED' ? { status: a.status !== 'EVALUATED' ? a.status : b.status, stage: st, unit: '1', value: null, reason: 'RATIO_COMPONENT_UNAVAILABLE' }
          : b.value![0] === 0n ? { status: 'NOT_EVALUATED', stage: st, unit: '1', value: null, reason: 'RATIO_DENOMINATOR_ZERO' }
          : { status: 'EVALUATED', stage: st, unit: '1', value: qDiv(a.value!, b.value!), reason: null };
      } else out[metricKey(m)] = metric(m as BaseMetricRef);
    }
    if (!same(c.metrics, Object.fromEntries(Object.entries(out).map(([k, m]) => [k, { ...m, value: ex(m.value) }])))) fail(`METRICS:${tag}`);
    own.set(c.candidateId, out);
  }

  // Constraints → status → objectives → normalization → score → rank / Pareto → recommendation.
  const weighted = input.mode === 'WEIGHTED_SCORE';
  const objVal = (o: OptimizationInput['objectives'][number], m: Record<string, MetricOut>) => {
    const x = m[metricKey(o.metric)];
    if (!x || x.status !== 'EVALUATED') return { status: x && x.status !== 'EVALUATED' ? x.status : 'NOT_EVALUATED', value: null as Q | null };
    return { status: 'EVALUATED', value: o.goal.kind === 'TARGET' ? qAbs(qSub(x.value!, dec(o.goal.target))) : x.value };
  };
  const statusOf = new Map<string, string>();
  for (const c of s.candidates) {
    const m = own.get(c.candidateId) ?? {}, tag = c.candidateId.slice(0, 12);
    let st: string;
    if (c.rejection && c.rejection.stage !== 'CONSTRAINT') st = 'REJECTED';
    else {
      const cons = input.hardConstraints.map(k => {
        if (k.kind === 'QA_NO_WARNINGS') return { constraintId: k.constraintId, result: c.qa?.warnings === 0 ? 'PASS' : 'FAIL', reason: null };
        const x = m[metricKey(k.metric)];
        if (!x || x.status !== 'EVALUATED') return { constraintId: k.constraintId, result: 'NOT_EVALUATED', reason: x?.reason ?? 'METRIC_UNAVAILABLE' };
        const r = qCmp(x.value!, dec(k.value)); return { constraintId: k.constraintId, result: (k.operator === 'LE' ? r <= 0 : r >= 0) ? 'PASS' : 'FAIL', reason: null };
      });
      if (!same(c.constraints, cons)) fail(`CONSTRAINTS:${tag}`);
      const failed = cons.filter(k => k.result === 'FAIL').map(k => k.constraintId);
      st = failed.length ? 'REJECTED' : cons.some(k => k.result === 'NOT_EVALUATED') ? 'INPUT_INCOMPLETE'
        : input.objectives.some(o => (!weighted || (o.weight ?? 0) > 0) && objVal(o, m).status !== 'EVALUATED') ? 'PARTIAL' : 'VALID';
      if (!same(c.rejection, failed.length ? { stage: 'CONSTRAINT', code: 'CONSTRAINT_FAILED', details: failed.slice(0, 10) } : null)) fail(`REJECTION:${tag}`);
    }
    if (c.status !== st) fail(`STATUS:${tag}`);
    statusOf.set(c.candidateId, st);
  }
  const valid = s.candidates.filter(c => statusOf.get(c.candidateId) === 'VALID');
  const totalWeight = input.objectives.reduce((n, o) => n + (o.weight ?? 0), 0);
  const bounds = weighted ? input.objectives.filter(o => (o.weight ?? 0) > 0).map(o => {
    const n = o.normalization!, target = o.goal.kind === 'TARGET' ? dec(o.goal.target) : null;
    if (n.method === 'EXPLICIT_BOUNDS') return { objectiveId: o.objectiveId, method: n.method, best: dec(n.best), worst: dec(n.worst), target, tolerance: null, degenerate: false };
    if (n.method === 'TARGET_TOLERANCE') return { objectiveId: o.objectiveId, method: n.method, best: null, worst: null, target, tolerance: dec(n.tolerance), degenerate: false };
    const xs = valid.map(c => objVal(o, own.get(c.candidateId)!).value!);
    if (!xs.length) return { objectiveId: o.objectiveId, method: n.method, best: null, worst: null, target, tolerance: null, degenerate: false };
    const lo = xs.reduce((a, b) => (qCmp(a, b) <= 0 ? a : b)), hi = xs.reduce((a, b) => (qCmp(a, b) >= 0 ? a : b)), max = o.goal.kind === 'MAXIMIZE';
    return { objectiveId: o.objectiveId, method: n.method, best: max ? hi : lo, worst: max ? lo : hi, target, tolerance: null, degenerate: qCmp(lo, hi) === 0 };
  }) : [];
  if (!same(s.normalization, bounds.map(b => ({ ...b, best: ex(b.best), worst: ex(b.worst), target: ex(b.target), tolerance: ex(b.tolerance) })))) fail('NORMALIZATION');
  const scoreOf = new Map<string, Q | null>();
  for (const c of s.candidates) {
    const ok = statusOf.get(c.candidateId) === 'VALID', m = own.get(c.candidateId) ?? {};
    let score: Q | null = weighted && ok ? [0n, 1n] : null;
    const objs = input.objectives.map(o => {
      const { status, value } = objVal(o, m), weight = weighted ? o.weight ?? 0 : null, b = bounds.find(x => x.objectiveId === o.objectiveId);
      if (!ok || !b || !value || !weight) return { objectiveId: o.objectiveId, status, value: ex(value), normalized: null, clamped: false, weight, contribution: null };
      let n: Q = b.method === 'TARGET_TOLERANCE' ? qSub([1n, 1n], qDiv(value, b.tolerance!)) : b.degenerate ? [1n, 1n] : qDiv(qSub(b.worst!, value), qSub(b.worst!, b.best!));
      let clamped = false;
      if (qCmp(n, [0n, 1n]) < 0) { n = [0n, 1n]; clamped = true; } else if (qCmp(n, [1n, 1n]) > 0) { n = [1n, 1n]; clamped = true; }
      const contribution = qDiv(qMul([BigInt(weight), 1n], n), [BigInt(totalWeight), 1n]); score = qAdd(score!, contribution);
      return { objectiveId: o.objectiveId, status, value: ex(value), normalized: ex(n), clamped, weight, contribution: ex(contribution) };
    });
    if (!same(c.objectives, objs) || !same(c.score, ex(score))) fail(`SCORE:${c.candidateId.slice(0, 12)}`);
    scoreOf.set(c.candidateId, score);
  }
  let recommended: string[] = [];
  const frontier: string[] = [];
  if (weighted) {
    const ranked = [...valid].sort((a, b) => qCmp(scoreOf.get(b.candidateId)!, scoreOf.get(a.candidateId)!) || a.ordinal - b.ordinal);
    for (const c of s.candidates) if (c.rank !== (ranked.indexOf(c) + 1 || null) || c.paretoStatus !== 'NOT_COMPUTED' || c.dominatedBy.length) fail(`RANK:${c.candidateId.slice(0, 12)}`);
    if (ranked.length) recommended = ranked.filter(c => qCmp(scoreOf.get(c.candidateId)!, scoreOf.get(ranked[0]!.candidateId)!) === 0).sort((a, b) => a.ordinal - b.ordinal).map(c => c.candidateId);
  } else {
    const vecOf = (c: Candidate) => input.objectives.map(o => { const v = objVal(o, own.get(c.candidateId)!).value!; return o.goal.kind === 'MAXIMIZE' ? q(-v[0], v[1]) : v; });
    const dom = (a: Q[], b: Q[]) => a.every((x, k) => qCmp(x, b[k]!) <= 0) && a.some((x, k) => qCmp(x, b[k]!) < 0);
    for (const c of s.candidates) {
      const by = statusOf.get(c.candidateId) === 'VALID' ? valid.filter(d => d !== c && dom(vecOf(d), vecOf(c))).map(d => d.candidateId) : null;
      const expected = by === null ? 'NOT_ELIGIBLE' : by.length ? 'DOMINATED' : 'NON_DOMINATED';
      if (c.paretoStatus !== expected || !same(c.dominatedBy, (by ?? []).slice(0, 5)) || c.rank !== null) fail(`PARETO:${c.candidateId.slice(0, 12)}`);
      if (expected === 'NON_DOMINATED') frontier.push(c.candidateId);
    }
    recommended = frontier;
  }
  if (!same(s.paretoFrontier, frontier)) fail('FRONTIER');
  if (!same(s.recommendedCandidates, recommended)) fail('RECOMMENDED');
  const count = (st: string) => [...statusOf.values()].filter(x => x === st).length;
  if (s.search.valid !== count('VALID') || s.search.rejected !== count('REJECTED') || s.search.partial !== count('PARTIAL') || s.search.inputIncomplete !== count('INPUT_INCOMPLETE')) fail('STATUS_COUNTS');

  // Study status: GRID is complete by coverage; local search is replayed from the verified scores.
  let expectedStatus: Study['status'] = 'COMPLETED';
  if (input.strategy.kind === 'DETERMINISTIC_LOCAL_SEARCH') {
    const seen = new Set([vkey(base)]), max = input.strategy.maxEvaluations, sc = (v: Vec) => scoreOf.get(all.get(vkey(v))?.candidateId ?? '') ?? null;
    let current = base;
    replay: for (;;) {
      const nb: Vec[] = [];
      input.variables.forEach((x, k) => { const xs = values(x), i = xs.indexOf(current[varSlots[k]!]!); for (const j of [i - 1, i + 1]) if (j >= 0 && j < xs.length) { const v = [...current]; v[varSlots[k]!] = xs[j]!; nb.push(v); } });
      nb.sort(order);
      let best: Vec | null = null, bestScore: Q | null = null;
      for (const v of nb) {
        if (!seen.has(vkey(v))) { if (seen.size >= max) { expectedStatus = 'BUDGET_EXHAUSTED'; break replay; } if (!all.has(vkey(v))) { fail('LOCAL_REPLAY_MISSING'); break replay; } seen.add(vkey(v)); }
        const x = sc(v); if (x && (!bestScore || qCmp(x, bestScore) > 0)) { best = v; bestScore = x; }
      }
      const cur = sc(current);
      if (!best || !bestScore || (cur && qCmp(bestScore, cur) <= 0)) break;
      current = best;
    }
    if (seen.size !== all.size) fail('LOCAL_REPLAY_SET');
  }
  if (!valid.length) expectedStatus = 'NO_VALID_CANDIDATE';
  if (s.status !== expectedStatus) fail('STUDY_STATUS');
  const claim = expectedStatus === 'NO_VALID_CANDIDATE' ? 'NONE' : input.strategy.kind === 'GRID' ? 'BEST_IN_EVALUATED_SEARCH_SPACE' : 'BEST_FOUND';
  if (s.claims.searchResult !== claim) fail('CLAIMS');
  if (s.candidates.some(c => c.architectureMutation !== 'NONE')) fail('ARCHITECTURE_MUTATION');
  return { status: issues.length ? 'INVALID' : 'VALID', issues };
}
