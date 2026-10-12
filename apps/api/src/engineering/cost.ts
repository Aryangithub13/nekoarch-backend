import { Rational } from '@designflow/construction-calculations';
import { moneyString } from '@designflow/boq-cost';
import { COST_BASES, COST_SCOPES, CostReportSchema, FORMULAS, NOT_CLAIMED_COST, type CostBasis, type CostInput, type CostReport, type RateSource } from './contracts.js';

const R = Rational.from;
export type CostQuantities = { gfaM2: Rational; volumeM3: Rational | null; plotM2: Rational | null; storeys: number; areaFallback: boolean };
type Line = CostReport['lines'][number];
type Warning = CostReport['warnings'][number];

const EVIDENCE_CLASS = { OFFICIAL_SCHEDULE: 'USER_ASSERTED_OFFICIAL_SCHEDULE', CONTRACTOR_QUOTATION: 'CONTRACTOR_QUOTATION', USER_SUPPLIED: 'USER_SUPPLIED',
  MARKET_BENCHMARK: 'NON_AUTHORITATIVE_BENCHMARK', THIRD_PARTY_CALCULATOR: 'NON_AUTHORITATIVE_BENCHMARK', SYNTHETIC: 'SYNTHETIC' } as const;
/** Echo of the caller's source; the backend has inspected none of these documents, so none is marked verified. */
const sourceOut = (s: RateSource) => ({ kind: s.kind, title: s.title, issuer: s.issuer ?? null, reference: s.reference ?? null, jurisdiction: s.jurisdiction,
  effectiveDate: s.effectiveDate ?? null, retrievedOn: s.retrievedOn ?? null, evidenceClass: EVIDENCE_CLASS[s.kind], verification: 'NOT_VERIFIED_BY_BACKEND' as const });

/** Single-category adjustments: a second one of these would apply the same addition twice. */
const SINGLE = new Set(['GST', 'OVERHEAD', 'PROFIT', 'ESCALATION', 'LOCATION_INDEX', 'CONTINGENCY']);
export const ASSUMPTIONS = [
  'Conceptual parametric estimate: quantity basis × caller-supplied rate. It is not a tender, a contractor quotation, a bill of quantities or a final budget.',
  'Quantities come from the verified model: gross floor area and plot area from the Phase 34 verifier, gross volume as Σ plate area × storey height.',
  'Money rounds half-up to two minor digits per line and per adjustment; subtotals sum the rounded amounts.',
  'Rates, taxes and adjustments are caller supplied. No official rate, index, GST factor or location factor is built in or inferred.',
  'A complete total is withheld unless every elemental scope is priced or explicitly excluded, no line is rejected, a jurisdiction is declared, every priced rate and adjustment states its jurisdiction and an effective or retrieval date, and the GST and overhead/profit treatment is known.',
];

export function conceptualCost(input: CostInput, q: CostQuantities, jurisdiction: string | null): CostReport {
  const warnings: Warning[] = [], warn = (code: string, ref: string | null = null) => { warnings.push({ code, ref }); };
  const quantityOf = (basis: CostBasis): Rational | null => basis === 'GROSS_FLOOR_AREA_M2' ? q.gfaM2 : basis === 'GROSS_VOLUME_M3' ? q.volumeM3
    : basis === 'PLOT_AREA_M2' ? q.plotM2 : basis === 'STOREY_COUNT' ? R(String(q.storeys)) : R('1');
  if (!jurisdiction) warn('JURISDICTION_NOT_DECLARED');

  const lines: Line[] = input.components.map(c => {
    const quantity = quantityOf(c.basis), s = c.source;
    const reason = !quantity || quantity.n === 0n ? 'QUANTITY_NOT_AVAILABLE'
      : jurisdiction && s.jurisdiction && s.jurisdiction !== jurisdiction ? 'RATE_JURISDICTION_MISMATCH'
      : s.kind === 'OFFICIAL_SCHEDULE' && (!s.issuer || !s.reference || !s.effectiveDate) ? 'OFFICIAL_SOURCE_METADATA_INCOMPLETE' : null;
    if (!s.jurisdiction) warn('RATE_JURISDICTION_UNKNOWN', c.code);
    if (!s.effectiveDate && !s.retrievedOn) warn('RATE_DATE_UNKNOWN', c.code);
    if (s.kind === 'SYNTHETIC') warn('SYNTHETIC_RATE', c.code);
    if (s.kind === 'MARKET_BENCHMARK' || s.kind === 'THIRD_PARTY_CALCULATOR') warn('NON_AUTHORITATIVE_RATE', c.code);
    if (q.areaFallback && (c.basis === 'GROSS_FLOOR_AREA_M2' || c.basis === 'GROSS_VOLUME_M3')) warn('AREA_BASIS_FALLBACK', c.code);
    if (reason) warn(reason, c.code);
    const amount = quantity && !reason ? quantity.mul(R(c.rate)) : null;
    return { code: c.code, label: c.label, scope: c.scope, basis: c.basis, unit: COST_BASES[c.basis], quantity: quantity ? quantity.decimal(6) : null,
      quantityExact: quantity ? quantity.exact() : null, rate: c.rate, amount: amount ? moneyString(amount) : null, amountExact: amount ? amount.exact() : null,
      status: reason ? 'REJECTED' : 'PRICED', reason, includes: c.includes, source: sourceOut(s) };
  });
  const priced = lines.filter(l => l.status === 'PRICED');
  const has = (category: string) => input.adjustments.some(a => a.category === category);

  const blockedReasons: string[] = [];
  if (!priced.length) blockedReasons.push('NOTHING_PRICED');
  if (input.components.some(c => c.scope === 'WHOLE_BUILDING') && input.components.some(c => c.scope !== 'WHOLE_BUILDING')) blockedReasons.push('SCOPE_OVERLAP_WHOLE_BUILDING');
  if (input.adjustments.some((a, i) => SINGLE.has(a.category) && input.adjustments.findIndex(b => b.category === a.category) !== i)) blockedReasons.push('DUPLICATE_ADJUSTMENT_CATEGORY');
  // GST or overhead/profit added on top of a rate that already contains it (or may) would be counted twice.
  if (has('GST') && priced.some(l => l.includes.gst !== 'EXCLUDED')) blockedReasons.push('GST_DOUBLE_COUNT_RISK');
  if ((has('OVERHEAD') || has('PROFIT')) && priced.some(l => l.includes.overheadAndProfit !== 'EXCLUDED')) blockedReasons.push('OVERHEAD_PROFIT_DOUBLE_COUNT_RISK');

  const base = priced.reduce((sum, l) => sum.add(R(l.amount!)), R('0'));
  let running = base;
  const adjustments: CostReport['adjustments'] = [];
  for (const a of [...input.adjustments].sort((x, y) => x.order - y.order)) {
    const basis = a.basis === 'BASE' ? base : running;
    const magnitude = a.kind === 'PERCENT' ? basis.mul(R(a.value)).div(R('100')) : R(a.value), amount = a.direction === 'DEDUCT' ? R('0').sub(magnitude) : magnitude;
    const rounded = moneyString(amount);
    running = running.add(R(rounded));
    if (!a.source.jurisdiction) warn('RATE_JURISDICTION_UNKNOWN', a.code);
    if (!a.source.effectiveDate && !a.source.retrievedOn) warn('RATE_DATE_UNKNOWN', a.code);
    adjustments.push({ code: a.code, label: a.label, category: a.category, kind: a.kind, direction: a.direction, basis: a.basis, value: a.value, basisAmount: moneyString(basis),
      amount: rounded, amountExact: amount.exact(), source: sourceOut(a.source) });
  }
  if (running.n < 0n) blockedReasons.push('NEGATIVE_TOTAL');
  if (!has('CONTINGENCY')) warn('CONTINGENCY_NOT_INCLUDED');

  const excluded = new Map(input.excludedScopes.map(e => [e.scope, e.reason]));
  const whole = priced.filter(l => l.scope === 'WHOLE_BUILDING').map(l => l.code);
  const scopes = COST_SCOPES.map(scope => {
    const codes = [...whole, ...priced.filter(l => l.scope === scope).map(l => l.code)];
    return excluded.has(scope) ? { scope, status: 'EXCLUDED_BY_USER' as const, lineCodes: [], reason: excluded.get(scope)! }
      : { scope, status: codes.length ? 'PRICED' as const : 'UNPRICED' as const, lineCodes: codes, reason: null };
  });
  for (const s of scopes) if (s.status === 'UNPRICED') warn('SCOPE_UNPRICED', s.scope);

  const gst = new Set(priced.map(l => l.includes.gst));
  const taxBasis = blockedReasons.includes('GST_DOUBLE_COUNT_RISK') || gst.size !== 1 || gst.has('UNKNOWN') ? 'MIXED_OR_UNKNOWN' as const
    : gst.has('INCLUDED') ? 'INCLUSIVE_OF_GST' as const : has('GST') ? 'GST_ADDED_BY_ADJUSTMENT' as const : 'EXCLUSIVE_OF_GST' as const;
  if (taxBasis === 'MIXED_OR_UNKNOWN') warn('GST_TREATMENT_MIXED_OR_UNKNOWN');
  const ohpKnown = priced.every(l => l.includes.overheadAndProfit !== 'UNKNOWN');
  if (!ohpKnown) warn('OVERHEAD_PROFIT_TREATMENT_UNKNOWN');

  // A rate or adjustment whose jurisdiction or date is unstated has unestablished applicability, so it cannot support a complete total.
  const sourced = [...priced, ...adjustments].every(x => x.source.jurisdiction !== null && (x.source.effectiveDate !== null || x.source.retrievedOn !== null));
  const blocked = blockedReasons.length > 0;
  const complete = !blocked && lines.every(l => l.status === 'PRICED') && scopes.every(s => s.status !== 'UNPRICED') && jurisdiction !== null && taxBasis !== 'MIXED_OR_UNKNOWN' && ohpKnown
    && sourced;
  const total = blocked ? null : moneyString(running);
  return CostReportSchema.parse({ costVersion: FORMULAS.cost, estimateClass: 'CONCEPTUAL_PARAMETRIC', currency: input.currency, priceBasisDate: input.priceBasisDate ?? null,
    status: blocked ? 'BLOCKED' : complete ? 'COMPLETE' : 'PARTIAL', blockedReasons, lines, baseSubtotal: blocked ? null : moneyString(base), adjustments: blocked ? [] : adjustments,
    pricedTotal: total, completeTotal: complete ? total : null, taxBasis, scopes,
    evidenceClasses: [...new Set([...lines, ...adjustments].map(x => x.source.evidenceClass))].sort(),
    warnings: warnings.sort((a, b) => `${a.code}:${a.ref ?? ''}` < `${b.code}:${b.ref ?? ''}` ? -1 : 1), assumptions: ASSUMPTIONS, claims: { ...NOT_CLAIMED_COST } });
}
