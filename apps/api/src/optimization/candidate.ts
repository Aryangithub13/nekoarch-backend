import { BlueprintError, generateParametricBlueprint, normalizeParametricRequirements, type NormalizedParametricRequirements } from '@designflow/generator';
import { ArchitecturalBuildingModelV2Schema, type BuildingModelV2, type ParametricArchitecture } from '@designflow/shared';
import { auditBlueprint, type BlueprintQaReport } from '@designflow/blueprint-qa';
import { calculateQuantityTakeoff, type QuantityTakeoffReport } from '@designflow/quantity-takeoff';
import { calculateConstruction } from '@designflow/construction-calculations';
import { calculateBoqCost, costHash, sampleRateBook, type BoqCostReport } from '@designflow/boq-cost';
import { modelHash } from '../lib/generation-identity.js';
import { projectQaOptions } from '../services/project-service.js';
import { parametricQaOptions } from '../services/parametric-qa.js';
import { OPTIMIZATION_LIMITS, OptimizationError, isBaseMetric, metricKey, type BaseMetricRef, type MetricRef, type OptimizationInput } from './contracts.js';
import { div, parseDecimal, type MetricValue, type Rejection } from './rank.js';

export type Generate = (requirements: NormalizedParametricRequirements, execution: { timeoutMs: number }) => { model: unknown };
export interface CandidateContext { requirements: NormalizedParametricRequirements; cost: OptimizationInput['cost']; metrics: MetricRef[]; generate: Generate;
  /** Diagnostics only; never part of the hashed study. */ timings: Record<'generation' | 'qa' | 'takeoff' | 'cost', number>; now: () => number }
function timed<T>(ctx: CandidateContext, stage: keyof CandidateContext['timings'], fn: () => T): T {
  const start = ctx.now();
  try { return fn(); } finally { ctx.timings[stage] += ctx.now() - start; }
}
export type Rejected = { kind: 'REJECTED'; rejection: Rejection; model: BuildingModelV2 | null; qaReport: BlueprintQaReport | null };
export type Generated = { kind: 'GENERATED'; model: BuildingModelV2; modelHash: string; requirements: NormalizedParametricRequirements };
export type Built = Rejected
  | { kind: 'BUILT'; model: BuildingModelV2; modelHash: string; qaReport: BlueprintQaReport; qa: { status: 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL'; warnings: number } }
  | { kind: 'ALIAS'; model: BuildingModelV2; modelHash: string; qaReport: null };
export interface CostEvidence { report: BoqCostReport | null; scopeSignature: string | null; unpricedLines: number; completeTotalAvailable: boolean; error: string | null }

const NORMALIZATION_CODE: Record<string, string> = { UNSUPPORTED_PARAMETRIC_CAPABILITY: 'UNSUPPORTED_GEOMETRY', PROGRAM_DOES_NOT_FIT: 'SITE_CONTAINMENT' };
const coded = (error: unknown) => error instanceof Error && 'code' in error;

/** Edit (atomic) → normalize → generate → schema → modelHash. Never persists. Dedup happens before QA. */
export function generateCandidate(ctx: CandidateContext, architecture: ParametricArchitecture): Rejected | Generated {
  let requirements: NormalizedParametricRequirements;
  try { requirements = normalizeParametricRequirements({ ...structuredClone(ctx.requirements), parametricArchitecture: architecture }); }
  catch (error) {
    if (!(error instanceof BlueprintError)) throw error;
    const code = error.code === 'PROGRAM_DOES_NOT_FIT' && 'boundaryEdgeStart' in error.diagnostics ? 'SETBACK_VIOLATION' : NORMALIZATION_CODE[error.code] ?? 'PARAMETERS_INVALID';
    return { kind: 'REJECTED', rejection: { stage: 'NORMALIZATION', code, details: [error.code] }, model: null, qaReport: null };
  }
  let raw: unknown;
  try { raw = timed(ctx, 'generation', () => ctx.generate(requirements, { timeoutMs: OPTIMIZATION_LIMITS.generatorTimeoutMs }).model); }
  catch (error) {
    if (!(error instanceof BlueprintError)) throw error;
    // Wall-clock outcomes are machine dependent: abort the study, never reject a candidate.
    if (error.code === 'SOLVER_TIMEOUT' || error.code === 'SOLVER_CANCELLED') throw new OptimizationError('OPTIMIZATION_RESOURCE_LIMIT', 'Candidate generation exceeded its deadline', { limit: 'generatorTimeoutMs', cause: error.code });
    return { kind: 'REJECTED', rejection: { stage: 'GENERATION', code: error.code === 'SEARCH_LIMIT_EXHAUSTED' ? 'GENERATOR_SEARCH_LIMIT' : error.code, details: [error.code] }, model: null, qaReport: null };
  }
  const parsed = ArchitecturalBuildingModelV2Schema.safeParse(raw);
  if (!parsed.success) return { kind: 'REJECTED', rejection: { stage: 'MODEL', code: 'MODEL_INVARIANT_FAILED',
    details: parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`.slice(0, 200)) }, model: null, qaReport: null };
  return { kind: 'GENERATED', model: parsed.data, modelHash: modelHash(parsed.data), requirements };
}
/** Independent QA with the same options and acceptance rule as the revision accept path. */
export function auditCandidate(ctx: CandidateContext, { model, modelHash: hash, requirements }: Generated): Built {
  const qaReport = timed(ctx, 'qa', () => auditBlueprint(model, { ...projectQaOptions(model), ...parametricQaOptions(requirements) }));
  if (qaReport.status === 'FAIL' || qaReport.inputStatus !== 'SCHEMA_VALID' || qaReport.summary.errors)
    return { kind: 'REJECTED', rejection: { stage: 'QA', code: 'QA_FAILED', details: [...new Set(qaReport.findings.filter(f => f.severity === 'ERROR').map(f => f.code))].slice(0, 10) }, model, qaReport };
  return { kind: 'BUILT', model, modelHash: hash, qaReport, qa: { status: qaReport.status, warnings: qaReport.summary.warnings } };
}

export const generateWithEngine: Generate = (requirements, execution) => generateParametricBlueprint(requirements, execution);

const UNITS: Record<string, string> = { GROSS_FLOOR_AREA: 'mm2', FOOTPRINT_AREA: 'mm2', WALL_CENTERLINE_LENGTH: 'mm', WALL_NET_VOLUME: 'mm3', CLASSIFICATION_FLOOR_AREA: 'mm2', SPACE_FLOOR_AREA: 'mm2' };
const missing = (unit: string, reason: string, status: MetricValue['status'] = 'NOT_EVALUATED'): MetricValue => ({ status, stage: 'A', unit, value: null, reason });
type TakeoffMetric = Exclude<BaseMetricRef, { kind: 'PRICED_SCOPE_TOTAL' }>;
/** Stage A metrics from takeoff summary/section totals (the validator re-derives them from items). */
function takeoffMetric(t: QuantityTakeoffReport | null, m: TakeoffMetric): MetricValue {
  const unit = UNITS[m.kind]!;
  if (!t) return missing(unit, 'TAKEOFF_FAILED');
  const section = (dimension: string, key: string, code: string) => t.sections.find(s => s.dimension === dimension && s.key === key)?.totals.find(x => x.itemCode === code);
  const summary = (code: string) => t.summary.totals.find(x => x.itemCode === code);
  let total: { quantity: { value: string }; status: string } | undefined;
  if (m.kind === 'GROSS_FLOOR_AREA') total = summary('GEOMETRIC_GROSS_FLOOR_AREA');
  else if (m.kind === 'FOOTPRINT_AREA') total = section('level', 'level-0', 'LEVEL_ENVELOPE_AREA');
  else if (m.kind === 'WALL_CENTERLINE_LENGTH') total = summary('WALL_CENTERLINE_LENGTH');
  else if (m.kind === 'WALL_NET_VOLUME') total = summary('WALL_SEGMENT_NET_VOLUME');
  else if (m.kind === 'CLASSIFICATION_FLOOR_AREA') total = section('classification', m.classification, 'SPACE_FLOOR_AREA');
  else {
    const items = t.items.filter(i => i.itemCode === 'SPACE_FLOOR_AREA' && i.sourceEntityIds[0] === m.spaceId);
    total = items.length === 1 ? items[0] : undefined;
  }
  if (!total) return missing(unit, 'METRIC_SOURCE_MISSING');
  if (total.status !== 'EVALUATED') return missing(unit, `TAKEOFF_${total.status}`, 'INPUT_INCOMPLETE');
  return { status: 'EVALUATED', stage: 'A', unit, value: parseDecimal(total.quantity.value), reason: null };
}

/** Stage B: construction + cost with the unchanged money engine. */
export function costCandidate(ctx: CandidateContext, takeoff: QuantityTakeoffReport | null): CostEvidence | null {
  if (!ctx.cost) return null;
  if (!takeoff) return { report: null, scopeSignature: null, unpricedLines: 0, completeTotalAvailable: false, error: 'TAKEOFF_FAILED' };
  try {
    const book = sampleRateBook(ctx.cost.rateBookId === 'sample-inr-v1' ? '1' : '2');
    const report = calculateBoqCost(calculateConstruction(takeoff, ctx.cost.specification), book, ctx.cost.policy);
    const codes = (priced: boolean) => [...new Set(report.boqLines.filter(l => (l.status === 'PRICED') === priced).map(l => l.lineCode))].sort();
    const scopeSignature = costHash({ currency: report.currency, coverage: report.coverage, upstreamStatus: report.source.upstreamStatus,
      excludedScopes: [...report.excludedScopes].sort(), pricedLineCodes: codes(true), unpricedLineCodes: codes(false) });
    return { report, scopeSignature, unpricedLines: report.unpricedLineIds.length, completeTotalAvailable: report.finalTotals.completeTotalAvailable, error: null };
  } catch (error) {
    if (!coded(error)) throw error;
    return { report: null, scopeSignature: null, unpricedLines: 0, completeTotalAvailable: false, error: `COST_FAILED:${String((error as { code: unknown }).code)}` };
  }
}
/** Never "missing = 0": unpriced lines or a different priced scope than the baseline → INPUT_INCOMPLETE. */
function costMetric(cost: CostEvidence | null, baselineSignature: string | null): MetricValue {
  const unit = cost?.report?.currency ?? 'INR', incomplete = (reason: string): MetricValue => ({ status: 'INPUT_INCOMPLETE', stage: 'B', unit, value: null, reason });
  if (!cost || !cost.report) return { status: 'NOT_EVALUATED', stage: 'B', unit, value: null, reason: cost?.error ?? 'COST_NOT_CONFIGURED' };
  if (cost.unpricedLines) return incomplete('COST_UNPRICED_LINES');
  if (baselineSignature !== null && cost.scopeSignature !== baselineSignature) return incomplete('COST_SCOPE_NOT_COMPARABLE');
  return { status: 'EVALUATED', stage: 'B', unit, value: parseDecimal(cost.report.finalTotals.pricedGrandTotal), reason: null };
}

/** baselineSignature = null only when measuring the baseline itself. */
export function measure(ctx: CandidateContext, model: BuildingModelV2, baselineSignature: string | null) {
  let takeoff: QuantityTakeoffReport | null = null;
  try { takeoff = timed(ctx, 'takeoff', () => calculateQuantityTakeoff(model)); } catch (error) { if (!coded(error)) throw error; }
  const cost = timed(ctx, 'cost', () => costCandidate(ctx, takeoff)), metrics: Record<string, MetricValue> = {};
  const base = (m: BaseMetricRef) => (m.kind === 'PRICED_SCOPE_TOTAL' ? costMetric(cost, baselineSignature) : takeoffMetric(takeoff, m));
  for (const m of ctx.metrics) {
    if (m.kind === 'RATIO') {
      const a = base(m.numerator), b = base(m.denominator), stage = a.stage === 'B' || b.stage === 'B' ? 'B' as const : 'A' as const;
      if (a.status !== 'EVALUATED' || b.status !== 'EVALUATED') metrics[metricKey(m)] = { status: a.status !== 'EVALUATED' ? a.status : b.status, stage, unit: '1', value: null, reason: 'RATIO_COMPONENT_UNAVAILABLE' };
      else if (b.value!.n === 0n) metrics[metricKey(m)] = { status: 'NOT_EVALUATED', stage, unit: '1', value: null, reason: 'RATIO_DENOMINATOR_ZERO' };
      else metrics[metricKey(m)] = { status: 'EVALUATED', stage, unit: '1', value: div(a.value!, b.value!), reason: null };
    } else if (isBaseMetric(m)) metrics[metricKey(m)] = base(m);
    else throw new OptimizationError('OPTIMIZATION_UNSUPPORTED', 'Deferred metric reached measurement'); // input validation refuses these first
  }
  return { metrics, takeoff, cost };
}
