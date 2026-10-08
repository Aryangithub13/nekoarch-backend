import { OPTIMIZATION_LIMITS, OptimizationError, metricKey, type Constraint, type Exact, type Objective, type OptimizationInput } from './contracts.js';

/** Exact rational arithmetic (bigint, reduced, d > 0). No floats anywhere in ranking. */
export interface Rational { n: bigint; d: bigint }
const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a; };
export function rat(n: bigint, d = 1n): Rational {
  if (d === 0n) throw new RangeError('zero denominator');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}
export function parseDecimal(s: string): Rational {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new RangeError(`not a decimal: ${s}`);
  const frac = m[3] ?? '';
  return rat(BigInt(`${m[1]}${m[2]}${frac}`), 10n ** BigInt(frac.length));
}
export const add = (a: Rational, b: Rational) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rational, b: Rational) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rational, b: Rational) => rat(a.n * b.n, a.d * b.d);
export const div = (a: Rational, b: Rational) => rat(a.n * b.d, a.d * b.n);
export const cmp = (a: Rational, b: Rational) => { const x = a.n * b.d - b.n * a.d; return x < 0n ? -1 : x > 0n ? 1 : 0; };
export const abs = (a: Rational) => (a.n < 0n ? rat(-a.n, a.d) : a);
export const ZERO = rat(0n), ONE = rat(1n);
export const toExact = (a: Rational): Exact => ({ numerator: a.n.toString(), denominator: a.d.toString() });

export type MetricStatus = 'EVALUATED' | 'NOT_EVALUATED' | 'INPUT_INCOMPLETE' | 'UNSUPPORTED';
export interface MetricValue { status: MetricStatus; stage: 'A' | 'B'; unit: string; value: Rational | null; reason: string | null }
export interface Rejection { stage: 'NORMALIZATION' | 'GENERATION' | 'MODEL' | 'QA' | 'CONSTRAINT'; code: string; details: string[] }
export interface Measured { metrics: Record<string, MetricValue>; qa: { status: 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL'; warnings: number } | null; gate: Rejection | null }
type Status = 'VALID' | 'REJECTED' | 'PARTIAL' | 'INPUT_INCOMPLETE';
export interface Bounds { objectiveId: string; method: 'EXPLICIT_BOUNDS' | 'CANDIDATE_RANGE' | 'TARGET_TOLERANCE'; best: Rational | null; worst: Rational | null; target: Rational | null; tolerance: Rational | null; degenerate: boolean }
export interface ObjectiveResult { objectiveId: string; status: MetricStatus; value: Rational | null; normalized: Rational | null; clamped: boolean; weight: number | null; contribution: Rational | null }
export interface Ranked {
  status: Status; rejection: Rejection | null; constraints: { constraintId: string; result: 'PASS' | 'FAIL' | 'NOT_EVALUATED'; reason: string | null }[];
  objectives: ObjectiveResult[]; score: Rational | null; rank: number | null;
  paretoStatus: 'NON_DOMINATED' | 'DOMINATED' | 'NOT_ELIGIBLE' | 'NOT_COMPUTED'; dominatedBy: number[];
}

export function evaluateConstraint(c: Constraint, m: Measured) {
  if (c.kind === 'QA_NO_WARNINGS') return { constraintId: c.constraintId, result: m.qa?.warnings === 0 ? 'PASS' as const : 'FAIL' as const, reason: null };
  const metric = m.metrics[metricKey(c.metric)];
  if (!metric || metric.status !== 'EVALUATED' || !metric.value) return { constraintId: c.constraintId, result: 'NOT_EVALUATED' as const, reason: metric?.reason ?? 'METRIC_UNAVAILABLE' };
  const order = cmp(metric.value, parseDecimal(c.value));
  return { constraintId: c.constraintId, result: (c.operator === 'LE' ? order <= 0 : order >= 0) ? 'PASS' as const : 'FAIL' as const, reason: null };
}
/** Objective value: the metric itself, or |v − target| for TARGET goals. */
export function objectiveValue(o: Objective, m: Measured): { status: MetricStatus; value: Rational | null } {
  const metric = m.metrics[metricKey(o.metric)];
  if (!metric || metric.status !== 'EVALUATED' || !metric.value) return { status: metric?.status === 'EVALUATED' || !metric ? 'NOT_EVALUATED' : metric.status, value: null };
  return { status: 'EVALUATED', value: o.goal.kind === 'TARGET' ? abs(sub(metric.value, parseDecimal(o.goal.target))) : metric.value };
}
const scored = (input: OptimizationInput, o: Objective) => input.mode === 'PARETO' || (o.weight ?? 0) > 0;

/** Gate → constraints → objective availability. Independent of other candidates. */
export function classify(input: OptimizationInput, m: Measured): Pick<Ranked, 'status' | 'rejection' | 'constraints'> {
  if (m.gate) return { status: 'REJECTED', rejection: m.gate, constraints: [] };
  const constraints = input.hardConstraints.map(c => evaluateConstraint(c, m));
  const failed = constraints.filter(c => c.result === 'FAIL').map(c => c.constraintId);
  if (failed.length) return { status: 'REJECTED', rejection: { stage: 'CONSTRAINT', code: 'CONSTRAINT_FAILED', details: failed.slice(0, 10) }, constraints };
  if (constraints.some(c => c.result === 'NOT_EVALUATED')) return { status: 'INPUT_INCOMPLETE', rejection: null, constraints };
  const partial = input.objectives.some(o => scored(input, o) && objectiveValue(o, m).status !== 'EVALUATED');
  return { status: partial ? 'PARTIAL' : 'VALID', rejection: null, constraints };
}

/** Bounds per weighted objective; CANDIDATE_RANGE uses the VALID set only. */
export function normalizationBounds(input: OptimizationInput, valid: Measured[]): Bounds[] {
  if (input.mode === 'PARETO') return [];
  return input.objectives.filter(o => (o.weight ?? 0) > 0).map(o => {
    const n = o.normalization!, target = o.goal.kind === 'TARGET' ? parseDecimal(o.goal.target) : null;
    if (n.method === 'EXPLICIT_BOUNDS') return { objectiveId: o.objectiveId, method: n.method, best: parseDecimal(n.best), worst: parseDecimal(n.worst), target, tolerance: null, degenerate: false };
    if (n.method === 'TARGET_TOLERANCE') return { objectiveId: o.objectiveId, method: n.method, best: null, worst: null, target, tolerance: parseDecimal(n.tolerance), degenerate: false };
    const values = valid.map(m => objectiveValue(o, m).value!).sort(cmp);
    if (!values.length) return { objectiveId: o.objectiveId, method: n.method, best: null, worst: null, target, tolerance: null, degenerate: false };
    const [lo, hi] = [values[0]!, values.at(-1)!], max = o.goal.kind === 'MAXIMIZE';
    return { objectiveId: o.objectiveId, method: n.method, best: max ? hi : lo, worst: max ? lo : hi, target, tolerance: null, degenerate: cmp(lo, hi) === 0 };
  });
}
/** n ∈ [0, 1], 1 = best. */
export function normalize(b: Bounds, v: Rational): { n: Rational; clamped: boolean } {
  let n: Rational;
  if (b.method === 'TARGET_TOLERANCE') n = sub(ONE, div(v, b.tolerance!));        // v is already |x − target|
  else if (b.degenerate) n = ONE;
  else n = div(sub(b.worst!, v), sub(b.worst!, b.best!));
  if (cmp(n, ZERO) < 0) return { n: ZERO, clamped: true };
  if (cmp(n, ONE) > 0) return { n: ONE, clamped: true };
  return { n, clamped: false };
}
export function scoreObjectives(input: OptimizationInput, bounds: Bounds[], m: Measured, eligible: boolean): { objectives: ObjectiveResult[]; score: Rational | null } {
  const total = input.objectives.reduce((n, o) => n + (o.weight ?? 0), 0);
  let score: Rational | null = input.mode === 'WEIGHTED_SCORE' && eligible ? ZERO : null;
  const objectives = input.objectives.map(o => {
    const { status, value } = objectiveValue(o, m), weight = input.mode === 'WEIGHTED_SCORE' ? o.weight ?? 0 : null;
    const b = bounds.find(x => x.objectiveId === o.objectiveId);
    if (!eligible || !b || !value || !weight) return { objectiveId: o.objectiveId, status, value, normalized: null, clamped: false, weight, contribution: null };
    const { n, clamped } = normalize(b, value), contribution = div(mul(rat(BigInt(weight)), n), rat(BigInt(total)));
    score = add(score!, contribution);
    return { objectiveId: o.objectiveId, status, value, normalized: n, clamped, weight, contribution };
  });
  return { objectives, score };
}

/** Oriented for minimisation: MINIMIZE v, MAXIMIZE −v, TARGET |v − t| (already in value). */
const oriented = (o: Objective, v: Rational) => (o.goal.kind === 'MAXIMIZE' ? rat(-v.n, v.d) : v);
export function paretoStatuses(input: OptimizationInput, vectors: (Rational[] | null)[]) {
  const eligible = vectors.flatMap((v, i) => (v ? [i] : []));
  if (eligible.length * Math.max(eligible.length - 1, 0) * input.objectives.length > OPTIMIZATION_LIMITS.paretoComparisons)
    throw new OptimizationError('OPTIMIZATION_RESOURCE_LIMIT', 'Pareto comparison budget exceeded', { limit: 'paretoComparisons' });
  const dominates = (a: Rational[], b: Rational[]) => a.every((x, k) => cmp(x, b[k]!) <= 0) && a.some((x, k) => cmp(x, b[k]!) < 0);
  return vectors.map((v, i) => {
    if (!v) return { paretoStatus: 'NOT_ELIGIBLE' as const, dominatedBy: [] };
    const by = eligible.filter(j => j !== i && dominates(vectors[j]!, v));
    return { paretoStatus: by.length ? 'DOMINATED' as const : 'NON_DOMINATED' as const, dominatedBy: by.slice(0, 5) };
  });
}

/** Ranks candidates already in canonical order. Indices in `dominatedBy` / `recommended` refer to that order. */
export function rankCandidates(input: OptimizationInput, measured: Measured[]) {
  const classes = measured.map(m => classify(input, m));
  const valid = measured.filter((_, i) => classes[i]!.status === 'VALID');
  const bounds = normalizationBounds(input, valid);
  const scoredRows = measured.map((m, i) => scoreObjectives(input, bounds, m, classes[i]!.status === 'VALID'));
  const pareto = input.mode === 'PARETO'
    ? paretoStatuses(input, measured.map((_, i) => classes[i]!.status === 'VALID' ? input.objectives.map((o, k) => oriented(o, scoredRows[i]!.objectives[k]!.value!)) : null))
    : measured.map(() => ({ paretoStatus: 'NOT_COMPUTED' as const, dominatedBy: [] as number[] }));
  const ranks: (number | null)[] = measured.map(() => null);
  let recommended: number[] = [];
  if (input.mode === 'WEIGHTED_SCORE') {
    const order = measured.map((_, i) => i).filter(i => classes[i]!.status === 'VALID').sort((a, b) => cmp(scoredRows[b]!.score!, scoredRows[a]!.score!) || a - b);
    order.forEach((i, r) => { ranks[i] = r + 1; });
    if (order.length) recommended = order.filter(i => cmp(scoredRows[i]!.score!, scoredRows[order[0]!]!.score!) === 0).sort((a, b) => a - b);
  } else recommended = pareto.flatMap((p, i) => (p.paretoStatus === 'NON_DOMINATED' ? [i] : []));
  const rows: Ranked[] = measured.map((_, i) => ({ ...classes[i]!, ...scoredRows[i]!, rank: ranks[i]!, ...pareto[i]! }));
  return { rows, bounds, recommended, frontier: input.mode === 'PARETO' ? recommended : [] };
}
