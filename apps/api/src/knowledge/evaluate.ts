import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DISCIPLINES, FACT_CATALOG, FLOAT_BOUNDARY_ULPS, FLOAT_POLICY, KNOWLEDGE_LIMITS, KnowledgeError, LABEL_FACT, PRECISIONS, STATUSES, SUBJECT_SOURCE, type Evaluation,
  type Fact, type FactRef, type FactSet, type FactType, type KnowledgeInput, type KnowledgePack, type KnowledgeResult, type Precision, type Predicate, type Reason, type Rule, type Source,
  type Status, type Subject, type SubjectKind, type Trace, type Truth } from './contracts.js';
import { detectConflicts, ruleRef, type Selected } from './conflicts.js';
import { canonicalUnit, cmp, div, floatBand, isZero, parseExact, q, show, toCanonical, type Q } from './units.js';

// knowledge-rule-evaluator-v1 (design §6–§8, §10.1, §12). UNTRUSTED: the result validator recomputes everything independently.
// §8 normative tables, transcribed literally.
const NOT: Record<Truth, Truth> = { T: 'F', F: 'T', R: 'R', I: 'I', E: 'E' };
const ALL: Record<Truth, Record<Truth, Truth>> = {
  T: { T: 'T', F: 'F', R: 'R', I: 'I', E: 'E' }, F: { T: 'F', F: 'F', R: 'F', I: 'F', E: 'F' }, R: { T: 'R', F: 'F', R: 'R', I: 'I', E: 'E' },
  I: { T: 'I', F: 'F', R: 'I', I: 'I', E: 'E' }, E: { T: 'E', F: 'F', R: 'E', I: 'E', E: 'E' } };
const ANY: Record<Truth, Record<Truth, Truth>> = {
  T: { T: 'T', F: 'T', R: 'T', I: 'T', E: 'T' }, F: { T: 'T', F: 'F', R: 'R', I: 'I', E: 'E' }, R: { T: 'T', F: 'R', R: 'R', I: 'I', E: 'E' },
  I: { T: 'T', F: 'I', R: 'I', I: 'I', E: 'E' }, E: { T: 'T', F: 'E', R: 'E', I: 'E', E: 'E' } };
/** Exposed for the exhaustive truth-table and ANY ≡ NOT(ALL(NOT…)) tests. */
export const truthTables = { NOT, ALL, ANY };
const STATUS_OF: Record<Truth, Status> = { T: 'MEETS_RULE', F: 'DOES_NOT_MEET_RULE', R: 'REVIEW_REQUIRED', I: 'INPUT_INCOMPLETE', E: 'NOT_EVALUATED' };
/** §12 near-match key; used only for comparison, never to rewrite a label. */
export const nearKey = (s: string) => s.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const BUILDING: Subject = { kind: 'BUILDING', id: 'building', label: null };
const key = (t: FactType, p: string | null, s: Subject) => `${t}|${p ?? ''}|${s.kind}|${s.id}`;
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

type Ctx = { facts: Map<string, Fact>; subjects: Map<SubjectKind, Subject[]>; observed: Set<string>; counted: boolean;
  missing: { factType: FactType; parameter: string | null; subject: Subject }[] };
function lookup(ctx: Ctx, ref: FactRef, subject: Subject, recordMissing = true) {
  const s = FACT_CATALOG[ref.factType].subject === 'BUILDING' ? BUILDING : subject, f = ctx.facts.get(key(ref.factType, ref.parameter, s));
  if (f) ctx.observed.add(f.factId);
  const present = f && f.status === 'PRESENT' ? f : null;
  if (!present && recordMissing) ctx.missing.push({ factType: ref.factType, parameter: ref.parameter, subject: s });
  return { f, present };
}
const text = (f: Fact) => !f.value ? null : f.value.kind === 'DECIMAL' ? f.value.exact : String(f.value.value);
const observedOf = (f: Fact): Trace['observed'] => ({ value: text(f), unit: f.value?.kind === 'DECIMAL' ? f.value.unit : null, factId: f.factId, precision: f.precision });
const weakest = (ps: Precision[]): Precision | null => ps.length ? PRECISIONS[Math.min(...ps.map(p => PRECISIONS.indexOf(p)))]! : null;
function match(label: string | null, labels: string[] | null): 'IN' | 'NEAR' | 'OUT' {
  if (!labels) return 'IN';
  if (label === null) return 'OUT';
  if (labels.includes(label)) return 'IN';
  return labels.some(l => nearKey(l) === nearKey(label)) ? 'NEAR' : 'OUT';
}

function predicate(p: Predicate, subject: Subject, ctx: Ctx): Trace {
  const node = (status: Truth, reason: Reason | null, rest: Partial<Trace> = {}): Trace =>
    ({ op: p.op, status, reason, observed: null, threshold: null, comparison: null, basis: null, children: [], ...rest });
  switch (p.op) {
    case 'EXISTS': {
      const { f, present } = lookup(ctx, p.fact, subject, false); // absence is this operator's answer, not a missing input
      return node(present ? 'T' : 'F', null, { observed: f ? observedOf(f) : null });
    }
    case 'EQUALS': {
      const { f, present } = lookup(ctx, p.fact, subject), lit = String(p.value);
      const threshold = { literal: lit, unit: null, normalized: lit, canonicalUnit: null };
      if (!present || !present.value || present.value.kind === 'DECIMAL') return node('I', 'MISSING_FACT', { observed: f ? observedOf(f) : null, threshold });
      const observed = present.value.value;
      return node(observed === p.value ? 'T' : 'F', null, { observed: observedOf(present), threshold, comparison: `${String(observed)} == ${lit}` });
    }
    case 'GTE': case 'LTE': {
      const t = toCanonical(parseExact(p.right.decimal), p.right.unit), sym = p.op === 'GTE' ? '>=' : '<=';
      const threshold = { literal: p.right.decimal, unit: p.right.unit, normalized: show(t), canonicalUnit: canonicalUnit(p.right.unit) };
      const holds = (v: Q) => p.op === 'GTE' ? cmp(v, t) >= 0 : cmp(v, t) <= 0, compare = (v: Q) => `${show(v)} ${sym} ${show(t)}`;
      if ('fact' in p.left) {
        const { f, present } = lookup(ctx, p.left.fact, subject);
        if (!present || present.value?.kind !== 'DECIMAL') return node('I', 'MISSING_FACT', { observed: f ? observedOf(f) : null, threshold });
        const raw = parseExact(present.value.exact), v = toCanonical(raw, present.value.unit);
        if (present.precision !== 'UPSTREAM_FLOAT') return node(holds(v) ? 'T' : 'F', null, { observed: observedOf(present), threshold, comparison: compare(v) });
        // §10.1: never decide a boundary on binary64 representation noise alone.
        const b = floatBand(raw, present.value.unit, t);
        const basis = { policy: FLOAT_POLICY as typeof FLOAT_POLICY, ulps: String(FLOAT_BOUNDARY_ULPS), ulp: show(b.ulp), band: show(b.band), diff: show(b.diff) };
        return node(b.ambiguous ? 'R' : holds(v) ? 'T' : 'F', b.ambiguous ? 'FLOAT_BOUNDARY_AMBIGUITY' : null, { observed: observedOf(present), threshold, comparison: compare(v), basis });
      }
      if ('count' in p.left) {
        let n = 0, near = false;
        for (const s of ctx.subjects.get(p.left.count.kind) ?? []) { const m = match(s.label, p.left.count.labels); if (m === 'IN') n++; else if (m === 'NEAR') near = true; }
        ctx.counted = true;
        const v = q(BigInt(n)), observed = { value: show(v), unit: 'count' as const, factId: null, precision: 'EXACT_INTEGER' as const };
        return node(near ? 'R' : holds(v) ? 'T' : 'F', near ? 'LABEL_NEAR_MATCH' : null, { observed, threshold, comparison: compare(v) });
      }
      const a = lookup(ctx, p.left.ratio.numerator, subject), b = lookup(ctx, p.left.ratio.denominator, subject);
      if (!a.present || !b.present || a.present.value?.kind !== 'DECIMAL' || b.present.value?.kind !== 'DECIMAL') return node('I', 'MISSING_FACT', { threshold });
      const n = toCanonical(parseExact(a.present.value.exact), a.present.value.unit), d = toCanonical(parseExact(b.present.value.exact), b.present.value.unit);
      if (isZero(d)) return node('E', 'RATIO_ZERO_DENOMINATOR', { threshold });
      const v = div(n, d), observed = { value: show(v), unit: '1' as const, factId: null, precision: weakest([a.present.precision, b.present.precision]) };
      return node(holds(v) ? 'T' : 'F', null, { observed, threshold, comparison: compare(v) });
    }
    case 'ALL': case 'ANY': {
      const children = p.of.map(c => predicate(c, subject, ctx)), table = p.op === 'ALL' ? ALL : ANY;
      return node(children.map(c => c.status).reduce((x, y) => table[x][y]), null, { children });
    }
    case 'NOT': { const child = predicate(p.of, subject, ctx); return node(NOT[child.status], null, { children: [child] }); }
    case 'MANUAL_REVIEW': return node('R', 'MANUAL_REVIEW');
  }
}
/** The first pre-order node carrying the deciding unknown status and a reason. */
function reasonOf(t: Trace | null, status: Truth): Reason | null {
  const stack = t ? [t] : [];
  while (stack.length) { const n = stack.shift()!; if (n.status === status && n.reason) return n.reason; stack.unshift(...n.children); }
  return null;
}
function countKinds(p: Predicate | null): SubjectKind[] {
  const out: SubjectKind[] = [], stack = p ? [p] : [];
  while (stack.length) {
    const n = stack.pop()!;
    if ((n.op === 'GTE' || n.op === 'LTE') && 'count' in n.left) out.push(n.left.count.kind);
    else if (n.op === 'ALL' || n.op === 'ANY') stack.push(...n.of);
    else if (n.op === 'NOT') stack.push(n.of);
  }
  return out;
}
/** §7 steps 1–2: outcomes decided by the rule definition and the bound sources alone (also used by POST /validate). */
export function staticOutcome(rule: Rule, bound: ReadonlySet<Source>): { status: 'UNSUPPORTED'; unsupported: FactType[] } | { status: 'NOT_EVALUATED'; missing: Source[] } | null {
  const unsupported = rule.requiredFacts.filter(r => !FACT_CATALOG[r.factType].supported).map(r => r.factType);
  if (unsupported.length) return { status: 'UNSUPPORTED', unsupported };
  const needed = new Set<Source>([SUBJECT_SOURCE[rule.scope.kind], ...rule.requiredFacts.map(r => FACT_CATALOG[r.factType].source),
    ...countKinds(rule.applicability).concat(countKinds(rule.requirement)).map(k => SUBJECT_SOURCE[k])]);
  const missing = [...needed].filter(s => !bound.has(s)).sort(order);
  return missing.length ? { status: 'NOT_EVALUATED', missing } : null;
}
const OVERRIDABLE = new Set<Status>(['MEETS_RULE', 'DOES_NOT_MEET_RULE', 'INPUT_INCOMPLETE', 'REVIEW_REQUIRED']);
/** Template wording only; the trace is authoritative (design §15). */
export function summaryOf(status: Status, reason: Reason | null, trace: Trace | null) {
  if (trace && trace.comparison && (trace.status === 'T' || trace.status === 'F')) return `${trace.comparison} is ${trace.status === 'T' ? 'true' : 'false'}; ${status}.`;
  return `${status}${reason ? ` (${reason})` : ''}.`;
}

export function evaluate(packs: { pack: KnowledgePack }[], facts: FactSet, input: KnowledgeInput, bound: ReadonlySet<Source>,
  budgetMs: number = KNOWLEDGE_LIMITS.calculationMs): Evaluation {
  const started = performance.now(), scope = new Set(input.scope.disciplines);
  const selected: Selected[] = packs.flatMap(({ pack }) => pack.rules.filter(r => scope.has(r.discipline)).map(rule => ({ packId: pack.packId, rule })))
    .sort((a, b) => order(ruleRef(a), ruleRef(b)));
  const versions = new Map(packs.map(({ pack }) => [pack.packId, pack.version]));
  if (selected.length > KNOWLEDGE_LIMITS.rulesSelected) throw new KnowledgeError('KNOWLEDGE_RESOURCE_LIMIT', 'Selected rule budget exceeded');
  const factMap = new Map(facts.items.map(f => [key(f.factType, f.parameter, f.subject), f])), byId = new Map(facts.items.map(f => [f.factId, f])), byKind = new Map<SubjectKind, Map<string, Subject>>();
  for (const f of facts.items) {
    const m = byKind.get(f.subject.kind) ?? new Map<string, Subject>();
    m.set(f.subject.id, f.subject); byKind.set(f.subject.kind, m);
  }
  const subjects = new Map([...byKind].map(([k, m]) => [k, [...m.values()].sort((a, b) => order(a.id, b.id))]));
  if (selected.reduce((n, s) => n + Math.max(1, subjects.get(s.rule.scope.kind)?.length ?? 0), 0) > KNOWLEDGE_LIMITS.subjectResults)
    throw new KnowledgeError('KNOWLEDGE_RESOURCE_LIMIT', 'Rule result budget exceeded');
  const { conflicts, analysis, conflictIds } = detectConflicts(selected);
  const results: KnowledgeResult[] = [], sourceGaps = new Map<Source, Set<string>>(), factGaps = new Map<string, { factType: FactType; parameter: string | null; subject: Subject; ruleIds: Set<string> }>();
  const unsupported = new Map<FactType, Set<string>>();

  for (const sel of selected) {
    if (performance.now() - started > budgetMs) throw new KnowledgeError('KNOWLEDGE_RESOURCE_LIMIT', 'Knowledge evaluation time budget exceeded');
    const { rule } = sel, ref = ruleRef(sel);
    const push = (subject: Subject | null, status: Status, reason: Reason | null, rest: { applicability?: KnowledgeResult['applicability']; trace?: Trace | null;
      observed?: Set<string>; counted?: boolean; nearMatch?: KnowledgeResult['nearMatch'] } = {}) => {
      const observedFacts = [...(rest.observed ?? [])].sort(order);
      const precisions = observedFacts.map(id => byId.get(id)!.precision).concat(rest.counted ? ['EXACT_INTEGER'] : []);
      results.push({ resultId: `kr-${createHash('sha256').update(JSON.stringify([sel.packId, rule.ruleId, subject?.kind ?? null, subject?.id ?? null])).digest('hex').slice(0, 40)}`,
        packId: sel.packId, packVersion: versions.get(sel.packId)!, ruleId: rule.ruleId, ruleVersion: rule.version, discipline: rule.discipline, severity: rule.severity, subject,
        applicability: rest.applicability ?? { status: 'NOT_REACHED', trace: null }, status, isolatedStatus: status, reason, precision: weakest(precisions),
        observedFacts, evidence: observedFacts.map(id => { const f = byId.get(id)!;
          return { factId: id, pointer: f.source.pointer, artifactType: f.source.artifactType, artifactId: f.source.artifactId }; }),
        trace: rest.trace ?? null, explanation: { summary: '', semantics: null }, nearMatch: rest.nearMatch ?? null, conflictIds: conflictIds.get(ref)!,
        conflictAnalysis: analysis.get(ref)!, reviewRequired: false, reviewDisciplines: [],
        sourceReference: { packId: sel.packId, refId: rule.sourceReference.refId, locator: rule.sourceReference.locator, interpretation: rule.sourceReference.interpretation } });
    };
    // 1. static support, 2. static sources
    const fixed = staticOutcome(rule, bound);
    if (fixed?.status === 'UNSUPPORTED') {
      for (const t of fixed.unsupported) unsupported.set(t, (unsupported.get(t) ?? new Set()).add(ref));
      push(null, 'UNSUPPORTED', 'UNSUPPORTED_FACT'); continue;
    }
    if (fixed?.status === 'NOT_EVALUATED') {
      for (const s of fixed.missing) sourceGaps.set(s, (sourceGaps.get(s) ?? new Set()).add(ref));
      push(null, 'NOT_EVALUATED', 'SOURCE_NOT_BOUND'); continue;
    }
    // 3. subjects
    const candidates = (subjects.get(rule.scope.kind) ?? []).map(s => ({ s, m: match(s.label, rule.scope.labels) })).filter(x => x.m !== 'OUT');
    if (!candidates.length) { push(null, 'NOT_APPLICABLE', 'EMPTY_SCOPE'); continue; }
    for (const { s, m } of candidates) {
      if (m === 'NEAR') {
        const labelFact = factMap.get(key(LABEL_FACT[s.kind]!, null, s))!;
        push(s, 'REVIEW_REQUIRED', 'LABEL_NEAR_MATCH', { observed: new Set([labelFact.factId]), nearMatch: { observed: s.label!, expected: rule.scope.labels!.filter(l =>
          nearKey(l) === nearKey(s.label!)).sort(order), sourceEntity: { kind: s.kind, id: s.id }, reason: 'LABEL_NEAR_MATCH', evidence: [labelFact.factId] } });
        continue;
      }
      const ctx: Ctx = { facts: factMap, subjects, observed: new Set(), counted: false, missing: [] };
      // 4. applicability, 5. requirement
      const app = rule.applicability ? predicate(rule.applicability, s, ctx) : null;
      const applicability: KnowledgeResult['applicability'] = !app ? { status: 'NOT_DECLARED', trace: null }
        : { status: app.status === 'T' ? 'APPLICABLE' : app.status === 'F' ? 'NOT_APPLICABLE' : 'UNDETERMINED', trace: app };
      let status: Status, reason: Reason | null, trace: Trace | null = null;
      if (app && app.status === 'F') { status = 'NOT_APPLICABLE'; reason = 'APPLICABILITY_FALSE'; }
      else if (app && app.status !== 'T') { status = STATUS_OF[app.status]; reason = reasonOf(app, app.status); }
      else { trace = predicate(rule.requirement, s, ctx); status = STATUS_OF[trace.status]; reason = trace.status === 'T' || trace.status === 'F' ? null : reasonOf(trace, trace.status); }
      for (const gap of ctx.missing) {
        const k = key(gap.factType, gap.parameter, gap.subject), entry = factGaps.get(k) ?? { ...gap, ruleIds: new Set<string>() };
        entry.ruleIds.add(ref); factGaps.set(k, entry);
      }
      push(s, status, reason, { applicability, trace, observed: ctx.observed, counted: ctx.counted });
    }
  }
  // 6. conflicts, 7. review flags and wording
  const rules = new Map(selected.map(s => [`${s.packId}/${s.rule.ruleId}`, s.rule]));
  for (const r of results) {
    const rule = rules.get(`${r.packId}/${r.ruleId}`)!;
    if (r.conflictAnalysis === 'CONFLICT' && OVERRIDABLE.has(r.isolatedStatus)) r.status = 'CONFLICTING_RULES';
    r.reviewRequired = r.status === 'REVIEW_REQUIRED' || r.status === 'CONFLICTING_RULES' || (rule.reviewDiscipline !== null && (r.status === 'MEETS_RULE' || r.status === 'DOES_NOT_MEET_RULE'));
    r.reviewDisciplines = r.reviewRequired && rule.reviewDiscipline ? [rule.reviewDiscipline] : [];
    r.explanation = { summary: summaryOf(r.status, r.reason, r.trace), semantics: r.status === 'MEETS_RULE' ? rule.semantics.meets : r.status === 'DOES_NOT_MEET_RULE' ? rule.semantics.doesNotMeet : null };
  }
  results.sort((a, b) => order(a.packId, b.packId) || order(a.ruleId, b.ruleId) || (a.subject ? b.subject ? order(a.subject.kind, b.subject.kind) || order(a.subject.id, b.subject.id) : 1 : b.subject ? -1 : 0));
  const zero = () => Object.fromEntries(STATUSES.map(s => [s, 0])) as Record<Status, number>;
  const byStatus = zero(), disciplineSummary: Partial<Record<(typeof DISCIPLINES)[number], Record<Status, number>>> = {};
  for (const d of input.scope.disciplines) disciplineSummary[d] = zero();
  for (const r of results) { byStatus[r.status]++; disciplineSummary[r.discipline]![r.status]++; }
  const missingInputs = [...[...sourceGaps].sort(([a], [b]) => order(a, b)).map(([source, ids]) => ({ kind: 'SOURCE' as const, source, factType: null, parameter: null, subject: null,
    ruleIds: [...ids].sort(order) })), ...[...factGaps].sort(([a], [b]) => order(a, b)).map(([, g]) => ({ kind: 'FACT' as const, source: null, factType: g.factType,
    parameter: g.parameter, subject: g.subject, ruleIds: [...g.ruleIds].sort(order) }))];
  return { results, conflicts, missingInputs,
    unsupported: [...unsupported].sort(([a], [b]) => order(a, b)).map(([factType, ids]) => ({ factType, ruleIds: [...ids].sort(order), reason: 'NOT_PROVIDED_IN_V1' as const })),
    disciplineSummary, summary: { rulesSelected: selected.length, results: results.length, byStatus, conflicts: conflicts.length,
      rulesConflictNotEvaluated: [...analysis.values()].filter(a => a === 'NOT_EVALUATED').length } };
}
