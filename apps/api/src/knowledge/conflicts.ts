import { createHash } from 'node:crypto';
import { digest } from '../bim/core.js';
import { FACT_CATALOG, KNOWLEDGE_LIMITS, KnowledgeError, type Conflict, type FactType, type Predicate, type Rule } from './contracts.js';
import { cmp, parseExact, show, toCanonical, type Q } from './units.js';

// knowledge-conflict-detector-v1 (design §13): static, over rule definitions, bounded to scalar normal form.
export type Analysis = 'EVALUATED' | 'CONFLICT' | 'NOT_EVALUATED';
export type Selected = { packId: string; rule: Rule };
type Bound = { v: Q; closed: boolean } | null;
type Constraint = { key: string; factType: FactType; parameter: string | null } & ({ kind: 'NUM'; lower: Bound; upper: Bound } | { kind: 'CAT'; allowed: string[] | null; excluded: string[] });

export const ruleRef = (s: Selected) => `${s.packId}/${s.rule.ruleId}`;
const factKey = (t: FactType, p: string | null) => `F|${t}|${p ?? ''}`;
/** Constraint keys of a requirement: fact references and COUNT descriptors. */
function keys(p: Predicate): string[] {
  const out = new Set<string>(), stack = [p];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.op === 'EXISTS' || n.op === 'EQUALS') out.add(factKey(n.fact.factType, n.fact.parameter));
    else if (n.op === 'GTE' || n.op === 'LTE') {
      if ('fact' in n.left) out.add(factKey(n.left.fact.factType, n.left.fact.parameter));
      else if ('count' in n.left) out.add(`C|${n.left.count.kind}|${JSON.stringify(n.left.count.labels ? [...n.left.count.labels].sort() : null)}`);
      else { out.add(factKey(n.left.ratio.numerator.factType, n.left.ratio.numerator.parameter)); out.add(factKey(n.left.ratio.denominator.factType, n.left.ratio.denominator.parameter)); }
    } else if (n.op === 'ALL' || n.op === 'ANY') stack.push(...n.of);
    else if (n.op === 'NOT') stack.push(n.of);
  }
  return [...out].sort();
}
const keySubject = (k: string) => k.startsWith('C|') ? 'BUILDING' : FACT_CATALOG[k.split('|')[1] as FactType].subject;
const lower = (a: Bound, b: Bound): Bound => !a ? b : !b ? a : cmp(a.v, b.v) > 0 ? a : cmp(a.v, b.v) < 0 ? b : { v: a.v, closed: a.closed && b.closed };
const upper = (a: Bound, b: Bound): Bound => !a ? b : !b ? a : cmp(a.v, b.v) < 0 ? a : cmp(a.v, b.v) > 0 ? b : { v: a.v, closed: a.closed && b.closed };
/** Scalar normal form of one requirement, or null when the detector cannot reason about it. */
function normal(p: Predicate): Constraint | null {
  const negated = p.op === 'NOT' ? p.of : null;
  if ((p.op === 'GTE' || p.op === 'LTE' || (negated && (negated.op === 'GTE' || negated.op === 'LTE'))) ) {
    const c = (negated ?? p) as Extract<Predicate, { op: 'GTE' | 'LTE' }>;
    if (!('fact' in c.left)) return null;
    const t = toCanonical(parseExact(c.right.decimal), c.right.unit), base = { key: factKey(c.left.fact.factType, c.left.fact.parameter), factType: c.left.fact.factType,
      parameter: c.left.fact.parameter, kind: 'NUM' as const };
    // GTE: [t, ∞); LTE: (−∞, t]; NOT(GTE): (−∞, t); NOT(LTE): (t, ∞).
    if (c.op === 'GTE') return negated ? { ...base, lower: null, upper: { v: t, closed: false } } : { ...base, lower: { v: t, closed: true }, upper: null };
    return negated ? { ...base, lower: { v: t, closed: false }, upper: null } : { ...base, lower: null, upper: { v: t, closed: true } };
  }
  if (p.op === 'EQUALS' || negated?.op === 'EQUALS') {
    const e = (negated ?? p) as Extract<Predicate, { op: 'EQUALS' }>, base = { key: factKey(e.fact.factType, e.fact.parameter), factType: e.fact.factType, parameter: e.fact.parameter, kind: 'CAT' as const };
    return negated ? { ...base, allowed: null, excluded: [String(e.value)] } : { ...base, allowed: [String(e.value)], excluded: [] };
  }
  if (p.op === 'ALL') {
    const parts = p.of.map(normal);
    if (parts.some(x => !x) || new Set(parts.map(x => `${x!.key}|${x!.kind}`)).size !== 1) return null;
    return parts.reduce((acc, x) => intersect(acc!, x!)) ?? null;
  }
  return null;
}
function intersect(a: Constraint, b: Constraint): Constraint {
  if (a.kind === 'NUM' && b.kind === 'NUM') return { ...a, lower: lower(a.lower, b.lower), upper: upper(a.upper, b.upper) };
  if (a.kind === 'CAT' && b.kind === 'CAT') {
    const allowed = a.allowed && b.allowed ? a.allowed.filter(v => b.allowed!.includes(v)) : a.allowed ?? b.allowed;
    return { ...a, allowed, excluded: [...new Set([...a.excluded, ...b.excluded])].sort() };
  }
  return a;
}
function empty(c: Constraint): boolean {
  if (c.kind === 'NUM') {
    if (!c.lower || !c.upper) return false;
    const o = cmp(c.lower.v, c.upper.v);
    return o > 0 || (o === 0 && !(c.lower.closed && c.upper.closed));
  }
  return c.allowed !== null && c.allowed.every(v => c.excluded.includes(v));
}
const show3 = (b: Bound) => b ? { value: show(b.v), closed: b.closed } : null;

export function detectConflicts(selected: Selected[]): { conflicts: Conflict[]; analysis: Map<string, Analysis>; conflictIds: Map<string, string[]> } {
  const info = selected.map(s => ({ s, ref: ruleRef(s), keys: keys(s.rule.requirement), nf: normal(s.rule.requirement),
    app: s.rule.applicability ? digest(s.rule.applicability) : null }));
  const byKey = new Map<string, number[]>();
  info.forEach((x, i) => x.keys.forEach(k => byKey.set(k, [...(byKey.get(k) ?? []), i])));
  let bound = 0;
  for (const group of byKey.values()) bound += group.length * (group.length - 1) / 2;
  if (bound > KNOWLEDGE_LIMITS.conflictPairs) throw new KnowledgeError('KNOWLEDGE_RESOURCE_LIMIT', 'Conflict pair budget exceeded');
  const pairs = new Set<string>();
  for (const group of byKey.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) pairs.add(`${group[i]}|${group[j]}`);
  const analysis = new Map(info.map(x => [x.ref, 'EVALUATED' as Analysis])), conflictIds = new Map(info.map(x => [x.ref, [] as string[]]));
  const conflicts: Conflict[] = [];
  const mark = (ref: string, a: Analysis) => { if (a === 'CONFLICT' || analysis.get(ref) === 'EVALUATED') analysis.set(ref, a); };
  for (const pair of [...pairs].sort()) {
    const [x, y] = pair.split('|').map(i => info[Number(i)]!) as [typeof info[number], typeof info[number]];
    const shared = x.keys.filter(k => y.keys.includes(k)), buildingKey = shared.some(k => keySubject(k) === 'BUILDING');
    const lx = x.s.rule.scope.labels, ly = y.s.rule.scope.labels;
    if (!buildingKey && lx && ly && !lx.some(l => ly.includes(l))) continue; // NO_OVERLAP
    if ((buildingKey && !(x.s.rule.scope.kind === 'BUILDING' && y.s.rule.scope.kind === 'BUILDING')) || !x.nf || !y.nf || x.app !== y.app) {
      mark(x.ref, 'NOT_EVALUATED'); mark(y.ref, 'NOT_EVALUATED'); continue;
    }
    if (!empty(intersect(x.nf, y.nf))) continue; // NO_CONFLICT
    if (conflicts.length >= KNOWLEDGE_LIMITS.conflicts) throw new KnowledgeError('KNOWLEDGE_RESOURCE_LIMIT', 'Conflict record budget exceeded');
    const [first, second] = [x, y].sort((a, b) => a.ref < b.ref ? -1 : 1) as [typeof x, typeof y];
    const conflictId = `cnf-${createHash('sha256').update(JSON.stringify([first.ref, second.ref, x.nf.key])).digest('hex').slice(0, 40)}`;
    const labels = lx && ly ? lx.filter(l => ly.includes(l)).sort() : lx ?? ly ? [...(lx ?? ly)!].sort() : null;
    conflicts.push({ conflictId, rules: [first.ref, second.ref], factType: x.nf.factType, parameter: x.nf.parameter, scope: { kind: x.s.rule.scope.kind, labels },
      constraints: [first, second].map(r => r.nf!.kind === 'NUM' ? { rule: r.ref, lower: show3(r.nf!.lower), upper: show3(r.nf!.upper), allowed: null, excluded: [] }
        : { rule: r.ref, lower: null, upper: null, allowed: r.nf!.allowed ? [...r.nf!.allowed].sort() : null, excluded: [...r.nf!.excluded].sort() }),
      reason: 'EMPTY_INTERSECTION' });
    for (const r of [x, y]) { mark(r.ref, 'CONFLICT'); conflictIds.get(r.ref)!.push(conflictId); }
  }
  for (const ids of conflictIds.values()) ids.sort();
  return { conflicts: conflicts.sort((a, b) => a.conflictId < b.conflictId ? -1 : 1), analysis, conflictIds };
}
