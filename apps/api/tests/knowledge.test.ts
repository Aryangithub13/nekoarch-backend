import { describe, expect, it } from 'vitest';
import { BUNDLED, IDS, LABEL_TEST_PACK, boundSources, environmentalUpstream, g1, structuralUpstream, systemsUpstream, wetBim } from '../../../test-support/knowledge-fixtures.js';
import { digest } from '../src/bim/core.js';
import { CLAIMS, DISCIPLINES, FACT_CATALOG, KNOWLEDGE_ANALYSIS_VERSION, KNOWLEDGE_LIMITS, KnowledgeError, KnowledgeInputSchema, SnapshotSchema, TRUTHS, type Evaluation,
  type FactSet, type KnowledgePack, type Predicate, type Truth } from '../src/knowledge/contracts.js';
import { COORDINATION_PACK, DIMENSIONAL_PACK, authoring, bundledPack, catalogEntries, validatePack } from '../src/knowledge/packs.js';
import { checkUpstreamConsistency, extractFacts, knowledgeBinding } from '../src/knowledge/facts.js';
import { evaluate, nearKey, truthTables } from '../src/knowledge/evaluate.js';
import { floatBand, fromStored, parseExact, show, ulp } from '../src/knowledge/units.js';
import { algebra, validateKnowledgeModel, validateKnowledgeResults, validatorArithmetic as V } from '../src/knowledge/validate.js';

const { rule, meta, gte, lte, fact, ref, not } = authoring;
const G = g1();
const run = (packs: { pack: KnowledgePack }[] = G.packs, facts: FactSet = G.facts, disciplines: readonly string[] = DISCIPLINES, bound = G.bound) =>
  evaluate(packs, facts, KnowledgeInputSchema.parse({ version: 'specialized-knowledge-input-v1', packs: packs.map(p => ({ packId: p.pack.packId, version: p.pack.version })),
    scope: { disciplines } }), bound);
const E1 = run();
const statuses = (e: Evaluation, ruleId: string) => e.results.filter(r => r.ruleId === ruleId).map(r => r.status);
const result = (e: Evaluation, ruleId: string, subjectId?: string) => e.results.find(r => r.ruleId === ruleId && (subjectId === undefined || r.subject?.id === subjectId))!;
const selection = (packs: { pack: KnowledgePack; checksum: string }[]) => ({ packs: packs.map(p => ({ packId: p.pack.packId, version: p.pack.version, checksum: p.checksum })) });
function draftOf(x: ReturnType<typeof g1>, e: Evaluation, packs = x.packs) {
  const input = { version: x.input.version, packs: x.input.packs, sources: x.input.sources, scope: x.input.scope };
  return { binding: x.binding, inputHash: digest({ version: KNOWLEDGE_ANALYSIS_VERSION, binding: x.binding, input }), factsHash: digest(x.facts), input,
    packs: packs.map(p => ({ packId: p.pack.packId, version: p.pack.version, checksum: p.checksum, pack: p.pack, rulesTotal: p.pack.rules.length,
      rulesSelected: p.pack.rules.filter(r => x.input.scope.disciplines.includes(r.discipline)).length })), facts: x.facts, claims: CLAIMS as unknown, ...e };
}
const verify = (draft: ReturnType<typeof draftOf>, x = G) => validateKnowledgeResults(draft, { binding: x.binding,
  checksums: Object.fromEntries(x.packs.map(p => [`${p.pack.packId}@${p.pack.version}`, p.checksum])) });
const messageOf = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as Error).message; } return 'none'; };
const codeOf = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof KnowledgeError ? e.code : `other:${(e as Error).message}`; } return 'none'; };
/** A synthetic, validated test pack (never bundled). */
const testPack = (rules: Parameters<ReturnType<typeof rule>>[0][], packId = 'test-boundaries') => {
  const t = rule('test');
  const pack = validatePack({ ...meta(packId, 'Test pack', [...DISCIPLINES], 'test', 'Test only'), version: '0.0.1', rules: rules.map(t) });
  return { pack, checksum: digest(pack) };
};
/** Independent validation of an evaluation over synthetic (test-only) packs and possibly modified facts. */
function verifySynthetic(packs: { pack: KnowledgePack; checksum: string }[], facts: FactSet, e: Evaluation) {
  const binding = knowledgeBinding(G.bim.binding, G.up, packs, DISCIPLINES);
  const input = KnowledgeInputSchema.parse({ version: 'specialized-knowledge-input-v1', packs: packs.map(p => ({ packId: p.pack.packId, version: p.pack.version })),
    sources: G.input.sources, scope: { disciplines: DISCIPLINES } });
  const x = { ...G, binding, input, packs, facts };
  return validateKnowledgeResults(draftOf(x, e), { binding, checksums: Object.fromEntries(packs.map(p => [`${p.pack.packId}@${p.pack.version}`, p.checksum])) });
}
const draft = (ruleId: string, requirement: Predicate, scope: KnowledgePack['rules'][number]['scope'], extra: Partial<Parameters<ReturnType<typeof rule>>[0]> = {}) =>
  ({ ruleId, title: ruleId, discipline: 'ARCHITECTURE' as const, scope, requirement, meets: 'm', doesNotMeet: 'n', locator: 'T', interpretation: 'Test only.', ...extra });

describe('Phase 27 bundled packs, contracts and pack validation', () => {
  it('registers exactly two coherent, CC0, jurisdiction-free bundled packs whose checksums reproduce', () => {
    expect(catalogEntries().map(c => [c.packId, c.version, c.ruleCount, c.checksum])).toEqual([
      ['nekoarch-demo-coordination', '1.0.0', 15, digest(COORDINATION_PACK)], ['nekoarch-demo-dimensional', '1.0.0', 15, digest(DIMENSIONAL_PACK)]]);
    for (const p of [COORDINATION_PACK, DIMENSIONAL_PACK]) {
      expect(validatePack(p)).toEqual(p);
      expect(p).toMatchObject({ jurisdiction: null, license: { spdx: 'CC0-1.0' }, sourceType: 'SYNTHETIC_DEMONSTRATION' });
      expect(JSON.stringify(p)).not.toMatch(/"[^"]*":\s*-?\d/); // no JSON numbers anywhere (checksum parity, §14)
      expect(p.rules.some(r => r.scope.labels?.some(l => l !== l.trim() || /[A-Z]/.test(l) && r.scope.kind === 'SPACE'))).toBe(false); // no deliberate near-match labels
    }
    expect(catalogEntries().some(c => c.packId === LABEL_TEST_PACK.packId)).toBe(false);
    expect(codeOf(() => bundledPack('nekoarch-demo-dimensional', '9.9.9'))).toBe('KNOWLEDGE_PACK_UNKNOWN');
    expect(codeOf(() => bundledPack('test-label-matching', '0.0.1'))).toBe('KNOWLEDGE_PACK_UNKNOWN');
  });

  it('rejects malformed, non-canonical and malicious packs before evaluation', () => {
    const base = structuredClone(DIMENSIONAL_PACK) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const bad = (change: (p: Record<string, any>) => void) => { const p = structuredClone(base); change(p); return codeOf(() => validatePack(p)); }; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(bad(() => undefined)).toBe('none');
    expect(bad(p => { p.rules[0].requirement.right.decimal = 900; })).toBe('KNOWLEDGE_PACK_INVALID'); // JSON number threshold
    for (const d of ['900.0', '0900', '9e2', '+900', '-0', '1.', '.5', '1,5']) expect(bad(p => { p.rules[0].requirement.right.decimal = d; }), d).toBe('KNOWLEDGE_PACK_INVALID');
    expect(bad(p => { p.rules[0].requirement.right.unit = 'm2'; })).toBe('KNOWLEDGE_PACK_INVALID'); // dimension mismatch
    expect(bad(p => { p.rules[0].requirement.op = 'EVAL'; })).toBe('KNOWLEDGE_PACK_INVALID');
    expect(bad(p => { p.rules[0].requirement = { op: 'GTE', left: { expression: 'process.exit()' }, right: { decimal: '1', unit: 'mm' } }; })).toBe('KNOWLEDGE_PACK_INVALID');
    expect(bad(p => { p.rules[0].requirement.left.fact.factType = 'constructor'; })).toBe('KNOWLEDGE_PACK_INVALID');
    expect(bad(p => { p.rules[0] = JSON.parse(JSON.stringify(p.rules[0]).replace('{"ruleId"', '{"__proto__":{"polluted":true},"ruleId"')); })).toBe('KNOWLEDGE_PACK_INVALID');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(bad(p => { p.rules[0].requiredFacts = []; })).toBe('KNOWLEDGE_PACK_INVALID');
    expect(bad(p => { p.rules[0].scope.kind = 'STAIR'; })).toBe('KNOWLEDGE_PACK_INVALID'); // labels on an unlabelled kind / fact not defined for kind
    expect(bad(p => { p.rules[1].ruleId = p.rules[0].ruleId; })).toBe('KNOWLEDGE_PACK_INVALID');
    expect(bad(p => { p.rules[0].discipline = 'COST'; })).toBe('KNOWLEDGE_PACK_INVALID');
    expect(bad(p => { p.rules[0].title = 'x'.repeat(10_000); })).toBe('KNOWLEDGE_PACK_INVALID');
    expect(bad(p => { p.rules = Array.from({ length: 300 }, (_, i) => ({ ...p.rules[0], ruleId: `r-${i}` })); })).toBe('KNOWLEDGE_PACK_INVALID');
    let deep: Predicate = lte(fact('ARCH_OPENING_WIDTH'), '900', 'mm');
    for (let i = 0; i < 9; i++) deep = not(deep);
    expect(bad(p => { p.rules[0].requirement = deep; })).toBe('KNOWLEDGE_PACK_INVALID'); // depth 10 > 8
    let bomb: unknown = 0; for (let i = 0; i < 40; i++) bomb = [bomb];
    expect(bad(p => { p.rules[0].requirement = { op: 'ALL', of: [bomb, bomb] }; })).toBe('KNOWLEDGE_PACK_INVALID'); // preflight depth
    const wide = { op: 'ALL', of: Array.from({ length: 16 }, () => ({ op: 'ALL', of: Array.from({ length: 5 }, () => lte(fact('ARCH_OPENING_WIDTH'), '9', 'mm')) })) };
    expect(bad(p => { p.rules[0].requirement = wide; })).toBe('KNOWLEDGE_PACK_INVALID'); // 97 nodes > 64
    expect(bad(p => { p.rules[0].requirement = { op: 'EQUALS', fact: ref('ENV_ENVELOPE_STATUS'), value: 'OPEN' }; p.rules[0].requiredFacts = [ref('ENV_ENVELOPE_STATUS')];
      p.rules[0].scope = { kind: 'BUILDING', labels: null }; })).toBe('KNOWLEDGE_PACK_INVALID'); // outside the enum domain
    expect(bad(p => { p.rules[0].requirement = gte({ ratio: { numerator: ref('ENV_ZONE_FLOOR_AREA'), denominator: ref('ARCH_SPACE_AREA') } }, '1', '1');
      p.rules[0].requiredFacts = [ref('ARCH_SPACE_AREA'), ref('ENV_ZONE_FLOOR_AREA')]; p.rules[0].scope = { kind: 'SPACE', labels: null }; })).toBe('KNOWLEDGE_PACK_INVALID'); // RATIO over float
    expect(bad(p => { p.rules[0].requirement = { op: 'EXISTS', fact: ref('ARCH_OPENING_KIND') }; p.rules[0].requiredFacts = [ref('ARCH_OPENING_KIND')]; })).toBe('KNOWLEDGE_PACK_INVALID'); // label facts are not referable
  });

  it('parses strict input, rejects unknown fields and never infers packs or jurisdiction', () => {
    const ok = { version: 'specialized-knowledge-input-v1', packs: BUNDLED, scope: { disciplines: ['MEP', 'ARCHITECTURE'] } };
    expect(KnowledgeInputSchema.parse(ok)).toEqual({ ...ok, packs: [...BUNDLED].sort((a, b) => a.packId < b.packId ? -1 : 1), scope: { disciplines: ['ARCHITECTURE', 'MEP'] },
      sources: { structuralAnalysisId: null, environmentalAnalysisId: null, systemsAnalysisId: null } });
    for (const v of [{ ...ok, jurisdiction: 'IN' }, { ...ok, packs: [] }, { ...ok, packs: [...BUNDLED, BUNDLED[0]] }, { ...ok, scope: { disciplines: [] } },
      { ...ok, scope: { disciplines: ['ARCHITECTURE', 'ARCHITECTURE'] } }, { ...ok, sources: { latest: true } }, { ...ok, packs: [{ packId: 'x', version: '1' }] }])
      expect(KnowledgeInputSchema.safeParse(v).success, JSON.stringify(v).slice(0, 80)).toBe(false);
  });
});

describe('Phase 27 exact arithmetic, units and the float boundary policy (both implementations)', () => {
  it('parses, normalises and prints exact numbers identically in evaluator and validator code', () => {
    for (const [text, expected] of <[string, string][]>[['0.279', '0.279'], ['1e-7', '0.0000001'], ['25/6', '25/6'], ['-1', '-1'], ['6644.340000000001', '6644.340000000001'], ['10/4', '2.5'], ['1/3', '1/3']]) {
      expect(show(parseExact(text))).toBe(expected); expect(V.render(V.read(text))).toBe(expected);
    }
    expect(show(fromStored(0.1 + 0.2))).toBe('0.30000000000000004'); // stored decimal, never the binary value
    expect(V.render(V.inBase(V.read('1.75'), 'kW'))).toBe('1750'); expect(V.render(V.inBase(V.read('4.96'), '%'))).toBe('0.0496');
    expect(V.render(V.inBase(V.read('9'), 'm2'))).toBe('9000000'); expect(V.render(V.inBase(V.read('0.25'), 'm3/s'))).toBe('250');
  });

  it('computes binary64 spacing exactly and identically', () => {
    for (const [value, expected] of [['1', 2n ** 52n], ['6644.34', 2n ** 40n], ['0.5', 2n ** 53n], ['1.5', 2n ** 52n], ['2', 2n ** 51n]] as const) {
      expect(ulp(parseExact(value))).toEqual([1n, expected]); expect(V.spacing(V.read(value))).toEqual({ n: 1n, d: expected });
    }
    expect(ulp(parseExact('0'))).toEqual([1n, 2n ** 1074n]); expect(V.spacing(V.read('0'))).toEqual({ n: 1n, d: 2n ** 1074n });
    expect(ulp(parseExact('1e-310'))).toEqual([1n, 2n ** 1074n]); expect(V.spacing(V.read('1e-310'))).toEqual({ n: 1n, d: 2n ** 1074n }); // subnormal clamp
    expect(ulp(parseExact('4096'))).toEqual([1n, 2n ** 40n]); expect(ulp(parseExact('0.75'))).toEqual([1n, 2n ** 53n]);
  });

  it('applies the 16-ulp ambiguity band at exactly the specified width (§10.1 known answers)', () => {
    const inside = fromStored(1.0000000000000033), outside = fromStored(1.0000000000000038), one = parseExact('1');
    expect(floatBand(inside, '1', one).ambiguous).toBe(true); expect(floatBand(outside, '1', one).ambiguous).toBe(false);
    expect(floatBand(fromStored(6644.340000000001), 'W', parseExact('6644.34')).ambiguous).toBe(true);
    expect(floatBand(fromStored(600), 'mm', parseExact('550')).ambiguous).toBe(false);
    expect(floatBand(fromStored(600), 'mm', parseExact('600')).ambiguous).toBe(true); // equality with a float is ambiguous by design
  });
});

describe('Phase 27 status algebra (§8)', () => {
  const T = TRUTHS as readonly Truth[], tuples = (n: number): Truth[][] => n === 0 ? [[]] : tuples(n - 1).flatMap(t => T.map(x => [...t, x]));
  const evalAll = (xs: Truth[]) => xs.reduce((a, b) => truthTables.ALL[a][b]), evalAny = (xs: Truth[]) => xs.reduce((a, b) => truthTables.ANY[a][b]);
  it('evaluator tables and validator algebra agree on every combination', () => {
    for (const x of T) expect(truthTables.NOT[x]).toBe(algebra.not(x));
    for (const n of [2, 3, 4]) for (const xs of tuples(n)) { expect(evalAll(xs)).toBe(algebra.all(xs)); expect(evalAny(xs)).toBe(algebra.any(xs)); }
  });
  it('Amendment 1: ANY(c…) ≡ NOT(ALL(NOT c…)) exhaustively, in both implementations', () => {
    for (const n of [2, 3, 4]) for (const xs of tuples(n)) {
      expect(evalAny(xs)).toBe(truthTables.NOT[evalAll(xs.map(x => truthTables.NOT[x]))]);
      expect(algebra.any(xs)).toBe(algebra.not(algebra.all(xs.map(algebra.not))));
    }
  });
  it('is commutative, associative, has the identities and never turns an unknown into T inside ALL', () => {
    for (const t of tuples(3)) {
      const [a, b, c] = t as [Truth, Truth, Truth];
      expect(truthTables.ALL[a][b]).toBe(truthTables.ALL[b][a]); expect(truthTables.ANY[a][b]).toBe(truthTables.ANY[b][a]);
      expect(truthTables.ALL[truthTables.ALL[a][b]][c]).toBe(truthTables.ALL[a][truthTables.ALL[b][c]]);
      expect(truthTables.ANY[truthTables.ANY[a][b]][c]).toBe(truthTables.ANY[a][truthTables.ANY[b][c]]);
    }
    for (const x of T) { expect(truthTables.ALL.T[x]).toBe(x); expect(truthTables.ANY.F[x]).toBe(x); if (x !== 'T') expect(truthTables.ALL.T[x]).not.toBe('T'); }
    expect(truthTables.ALL.I.R).toBe('I'); expect(truthTables.ALL.E.I).toBe('E'); expect(truthTables.ANY.R.F).toBe('R');
  });
});

describe('Phase 27 facts and provenance (project-facts-v1)', () => {
  it('extracts typed facts with exact values, precision classes and source pointers', () => {
    const f = (type: string, subject: string, parameter: string | null = null) => G.facts.items.find(x => x.factType === type && x.subject.id === subject && x.parameter === parameter)!;
    expect(G.facts.items.length).toBe(243); expect(G.facts.summary).toEqual({ present: 232, absent: 11, bySource: { ARCHITECTURE: 146, STRUCTURAL: 12, ENVIRONMENTAL: 20, SYSTEMS: 65 } });
    expect(f('ARCH_SPACE_AREA', 'space-bedroom-1')).toMatchObject({ value: { exact: '84532500', unit: 'mm2' }, precision: 'EXACT_DECIMAL_STRING',
      source: { artifactType: 'ARCHITECTURE_REVISION', pointer: expect.stringMatching(/^\/geometry\/spaces\/\d+\/boundary$/) }, derivation: { method: 'POLYGON_AREA' } });
    expect(f('ARCH_STAIR_HEADROOM', 'stair-0')).toMatchObject({ status: 'ABSENT', value: null });
    expect(f('ARCH_STAIR_MAX_RISER', 'stair-0').value).toEqual({ kind: 'DECIMAL', exact: '188', unit: 'mm' });
    expect(f('ENV_TRANSMISSION_TOTAL', 'design-winter')).toMatchObject({ value: { exact: '6644.340000000001', unit: 'W' }, precision: 'UPSTREAM_FLOAT',
      source: { artifactType: 'ENVIRONMENTAL_ANALYSIS', artifactId: IDS.environmental, inputHash: G.up.environmental!.inputHash } });
    expect(f('SYS_EGRESS_DISTANCE', 'space-bedroom-1')).toMatchObject({ value: { exact: '43900' }, precision: 'UPSTREAM_FLOAT' }); // precision from the schema, not the value
    expect(f('SYS_DUCT_MAX_VELOCITY', 'HVAC_SUPPLY:sa')).toMatchObject({ value: { exact: '25/6', unit: 'm/s' }, precision: 'EXACT_RATIONAL', derivation: { method: 'MAX' } });
    expect(f('SYS_DRAINAGE_SLOPE', 'SANITARY').value).toEqual({ kind: 'DECIMAL', exact: '0.025', unit: '1' });
    expect(f('SYS_ELECTRICAL_DEMAND_W', 'building').status).toBe('ABSENT');
    expect(f('QUANTITY_TOTAL', 'building', 'GEOMETRIC_GROSS_FLOOR_AREA')).toMatchObject({ value: { exact: '418300000', unit: 'mm2' }, source: { artifactType: 'BIM_QUANTITY_TAKEOFF' } });
    expect(f('STRUCT_SECTION_DEPTH', 'b1')).toMatchObject({ value: { exact: '600' }, precision: 'UPSTREAM_FLOAT' });
    expect(G.facts.items.every(x => FACT_CATALOG[x.factType].supported)).toBe(true);
    expect(digest(extractFacts(G.bim, G.up, G.binding))).toBe(digest(G.facts));
  });

  it('extracts nothing from an unbound source and rejects inconsistent transitive upstream bindings', () => {
    const arch = g1({ structural: false, environmental: false, systems: false });
    expect(arch.facts.summary.bySource).toEqual({ ARCHITECTURE: 146, STRUCTURAL: 0, ENVIRONMENTAL: 0, SYSTEMS: 0 });
    const bim = G.bim, S = structuralUpstream(bim), other = { ...S, analysisId: '66666666-6666-4666-8666-666666666666' };
    const up = { structural: S, environmental: null, systems: systemsUpstream(bim, { structural: other, environmental: null }) };
    const binding = knowledgeBinding(bim.binding, up, G.packs, DISCIPLINES);
    expect(codeOf(() => checkUpstreamConsistency(binding, up))).toBe('TRANSITIVE_UPSTREAM_BINDING_INCONSISTENT');
    expect(validateKnowledgeModel(extractFacts(bim, up, binding), bim, up, binding, { ...selection(G.packs), disciplines: [...DISCIPLINES] }).diagnostics
      .some(d => d.code === 'TRANSITIVE_UPSTREAM_BINDING_CONSISTENCY')).toBe(true);
    const consistent = { structural: S, environmental: environmentalUpstream(bim), systems: systemsUpstream(bim, { structural: S, environmental: null }) };
    expect(codeOf(() => checkUpstreamConsistency(knowledgeBinding(bim.binding, consistent, G.packs, DISCIPLINES), consistent))).toBe('none');
    const foreign = { ...G.up, structural: structuralUpstream(wetBim(undefined, '77777777-7777-4777-8777-777777777777')) };
    expect(codeOf(() => checkUpstreamConsistency(knowledgeBinding(bim.binding, foreign, G.packs, DISCIPLINES), foreign))).toBe('TRANSITIVE_UPSTREAM_BINDING_INCONSISTENT');
  });

  it('the model validator re-derives every fact and rejects forged values, precision and provenance', () => {
    const check = (facts: FactSet) => validateKnowledgeModel(facts, G.bim, G.up, G.binding, { ...selection(G.packs), disciplines: [...DISCIPLINES] });
    expect(check(G.facts)).toMatchObject({ status: 'VALID', diagnostics: [] });
    const forge = (change: (f: FactSet) => void) => { const c = structuredClone(G.facts); change(c); return check(c).status; };
    const at = (f: FactSet, t: string) => f.items.find(x => x.factType === t && x.status === 'PRESENT')!;
    expect(forge(f => { (at(f, 'SYS_EGRESS_DISTANCE').value as { exact: string }).exact = '43901'; })).toBe('INVALID');
    expect(forge(f => { at(f, 'SYS_EGRESS_DISTANCE').precision = 'EXACT_INTEGER'; })).toBe('INVALID');
    expect(forge(f => { at(f, 'ARCH_OPENING_WIDTH').source.pointer = '/geometry/openings'; })).toBe('INVALID');
    expect(forge(f => { f.items.pop(); })).toBe('INVALID');
    expect(check(G.facts).status).toBe('VALID');
    expect(validateKnowledgeModel(G.facts, G.bim, G.up, { ...G.binding, disciplines: ['ARCHITECTURE'] }, { ...selection(G.packs), disciplines: [...DISCIPLINES] }).status).toBe('INVALID');
  });
});

describe('Phase 27 golden G1 (design §22) and independent result validation', () => {
  it('reproduces the hand-computed table exactly', () => {
    expect(E1.summary).toEqual({ rulesSelected: 30, results: 62, conflicts: 1, rulesConflictNotEvaluated: 7,
      byStatus: { CONFLICTING_RULES: 10, DOES_NOT_MEET_RULE: 8, INPUT_INCOMPLETE: 4, MEETS_RULE: 26, NOT_APPLICABLE: 10, NOT_EVALUATED: 0, REVIEW_REQUIRED: 2, UNSUPPORTED: 2 } });
    const golden: [string, string[]][] = [['a01-door-width-min', Array(8).fill('MEETS_RULE')], ['a02-stair-width-min', ['DOES_NOT_MEET_RULE']], ['a03-riser-max', ['DOES_NOT_MEET_RULE']],
      ['a04-tread-min', ['MEETS_RULE']], ['a05-headroom-min', ['INPUT_INCOMPLETE']], ['a06-bedroom-area-min', ['MEETS_RULE']], ['a07-garage-area-min', ['NOT_APPLICABLE']],
      ['a08-window-sill-min', Array(5).fill('CONFLICTING_RULES')], ['a10-lift-over-two-storeys', ['NOT_APPLICABLE']], ['a12-lift-door-min', ['MEETS_RULE']],
      ['a14-stair-all', ['INPUT_INCOMPLETE']], ['a15-stair-any', ['MEETS_RULE']], ['a16-headroom-below-2500', ['INPUT_INCOMPLETE']],
      ['b01-window-sill-max', Array(5).fill('CONFLICTING_RULES')], ['b02-wfr-indicator-min', ['DOES_NOT_MEET_RULE']], ['b03-wfr-exact-min', ['MEETS_RULE']],
      ['b04-transmission-max', ['REVIEW_REQUIRED']], ['b05-duct-velocity-max', ['DOES_NOT_MEET_RULE', 'DOES_NOT_MEET_RULE']], ['b06-demand-max', ['INPUT_INCOMPLETE']],
      ['b07-connected-max', ['MEETS_RULE']], ['b08-drainage-slope-min', ['MEETS_RULE']], ['b09-cost-cap', ['UNSUPPORTED']], ['b10-beam-depth-min', ['MEETS_RULE']],
      ['b11-utilisation-max', ['UNSUPPORTED']], ['b12-penetration-review', ['REVIEW_REQUIRED']], ['b13-envelope-closed', ['MEETS_RULE']], ['b14-gfa-max', ['MEETS_RULE']],
      ['b15-bathroom-count-min', ['MEETS_RULE']]];
    for (const [id, expected] of golden) expect(statuses(E1, id), id).toEqual(expected);
    const egress = Object.fromEntries(E1.results.filter(r => r.ruleId === 'a09-egress-distance-max').map(r => [r.subject!.id, r.status]));
    expect(egress).toEqual({ 'space-bathroom-1': 'MEETS_RULE', 'space-bathroom-2': 'DOES_NOT_MEET_RULE', 'space-bedroom-1': 'DOES_NOT_MEET_RULE', 'space-corridor-0': 'MEETS_RULE',
      'space-corridor-1': 'MEETS_RULE', 'space-kitchen-1': 'MEETS_RULE', 'space-living-1': 'MEETS_RULE', 'space-stairwell-0': 'MEETS_RULE', 'space-stairwell-1': 'MEETS_RULE' });
    expect(statuses(E1, 'a13-dead-end-max').sort()).toEqual([...Array(1).fill('DOES_NOT_MEET_RULE'), ...Array(8).fill('NOT_APPLICABLE')]);
    expect(result(E1, 'a13-dead-end-max', 'space-corridor-1').trace!.comparison).toBe('22050 <= 20000');
  });

  it('records exact explanations, evidence, precision and review metadata', () => {
    expect(result(E1, 'a01-door-width-min').explanation.summary).toBe('900 >= 900 is true; MEETS_RULE.');
    expect(result(E1, 'a02-stair-width-min').trace).toMatchObject({ comparison: '1000 >= 1001', threshold: { literal: '1001', normalized: '1001' } });
    expect(result(E1, 'a04-tread-min').trace).toMatchObject({ comparison: '280 >= 279', threshold: { literal: '0.279', unit: 'm', canonicalUnit: 'mm' } });
    expect(result(E1, 'b07-connected-max').trace!.comparison).toBe('1750 <= 1750');
    expect(result(E1, 'b08-drainage-slope-min').trace!.comparison).toBe('0.025 >= 0.025');
    expect(result(E1, 'b05-duct-velocity-max', 'HVAC_SUPPLY:sa').trace!.comparison).toBe('25/6 <= 4.1666');
    expect(result(E1, 'b03-wfr-exact-min')).toMatchObject({ precision: 'EXACT_DECIMAL_STRING', trace: { comparison: '32/645 >= 0.0496' } });
    expect(result(E1, 'b04-transmission-max')).toMatchObject({ status: 'REVIEW_REQUIRED', reason: 'FLOAT_BOUNDARY_AMBIGUITY', precision: 'UPSTREAM_FLOAT', reviewRequired: true,
      trace: { observed: { value: '6644.340000000001' }, basis: { policy: 'knowledge-float-boundary-v1', ulps: '16', diff: '0.000000000001',
        ulp: '0.0000000000009094947017729282379150390625', band: '0.000000000014551915228366851806640625' } } });
    expect(result(E1, 'b10-beam-depth-min')).toMatchObject({ status: 'MEETS_RULE', reviewRequired: true, reviewDisciplines: ['STRUCTURAL'], trace: { basis: { diff: '50' } } });
    expect(result(E1, 'b12-penetration-review')).toMatchObject({ reason: 'MANUAL_REVIEW', reviewDisciplines: ['LIFE_SAFETY'], applicability: { status: 'APPLICABLE' } });
    expect(result(E1, 'a08-window-sill-min')).toMatchObject({ isolatedStatus: 'MEETS_RULE', conflictAnalysis: 'CONFLICT', reviewRequired: true });
    const a09 = result(E1, 'a09-egress-distance-max', 'space-bedroom-1');
    expect(a09.evidence).toEqual([{ factId: a09.observedFacts[0], pointer: expect.stringMatching(/^\/results\/lifeSafety\/spaces\/\d+\/distance\/value$/), artifactType: 'SYSTEMS_ANALYSIS',
      artifactId: IDS.systems }]);
    expect(E1.conflicts).toEqual([{ conflictId: expect.stringMatching(/^cnf-/), rules: ['nekoarch-demo-coordination/b01-window-sill-max', 'nekoarch-demo-dimensional/a08-window-sill-min'],
      factType: 'ARCH_OPENING_SILL', parameter: null, scope: { kind: 'OPENING', labels: ['window'] }, reason: 'EMPTY_INTERSECTION', constraints: [
        { rule: 'nekoarch-demo-coordination/b01-window-sill-max', lower: null, upper: { value: '850', closed: true }, allowed: null, excluded: [] },
        { rule: 'nekoarch-demo-dimensional/a08-window-sill-min', lower: { value: '900', closed: true }, upper: null, allowed: null, excluded: [] }] }]);
    expect(new Set(E1.results.filter(r => r.conflictAnalysis === 'NOT_EVALUATED').map(r => r.ruleId))).toEqual(new Set(['a02-stair-width-min', 'a03-riser-max', 'a04-tread-min',
      'a05-headroom-min', 'a14-stair-all', 'a15-stair-any', 'a16-headroom-below-2500']));
    expect(E1.missingInputs.map(m => [m.kind, m.factType, m.subject?.id])).toEqual([['FACT', 'ARCH_STAIR_HEADROOM', 'stair-0'], ['FACT', 'SYS_ELECTRICAL_DEMAND_W', 'building']]);
    expect(E1.unsupported.map(u => u.factType)).toEqual(['COST_TOTAL', 'STRUCT_UTILISATION']);
  });

  it('is deterministic: byte-identical reruns and pack order does not matter', () => {
    expect(digest(run())).toBe(digest(E1));
    expect(digest(run([...G.packs].reverse()))).toBe(digest(E1));
    expect(digest(run(G.packs, structuredClone(G.facts)))).toBe(digest(E1));
  });

  it('the independent result validator accepts the evaluator output and rejects every forgery', () => {
    expect(verify(draftOf(G, E1))).toMatchObject({ status: 'VALID', diagnostics: [], recomputed: { results: 62, conflicts: 1 } });
    const forged = (change: (d: ReturnType<typeof draftOf>) => void) => { const d = structuredClone(draftOf(G, E1)); change(d); return verify(d).status; };
    expect(forged(d => { d.results[0]!.status = 'DOES_NOT_MEET_RULE'; })).toBe('INVALID');
    expect(forged(d => { d.results.pop(); })).toBe('INVALID');
    expect(forged(d => { d.results.find(r => r.evidence.length)!.evidence = []; })).toBe('INVALID');
    expect(forged(d => { d.conflicts = []; })).toBe('INVALID');
    expect(forged(d => { d.results.reverse(); })).toBe('INVALID');
    expect(forged(d => { d.results.find(r => r.ruleId === 'b04-transmission-max')!.status = 'DOES_NOT_MEET_RULE'; })).toBe('INVALID');
    expect(forged(d => { d.results.find(r => r.ruleId === 'b09-cost-cap')!.status = 'MEETS_RULE'; })).toBe('INVALID');
    expect(forged(d => { d.results.find(r => r.ruleId === 'b03-wfr-exact-min')!.trace!.comparison = '0.0496124 >= 0.0496'; })).toBe('INVALID');
    expect(forged(d => { d.packs[0]!.pack.rules[0]!.title = 'Forged'; })).toBe('INVALID');
    expect(forged(d => { d.inputHash = 'f'.repeat(64); })).toBe('INVALID');
    expect(forged(d => { d.claims = { ...CLAIMS, buildingCodeCompliance: 'CLAIMED' }; })).toBe('INVALID');
    expect(forged(d => { d.summary.byStatus.MEETS_RULE += 1; })).toBe('INVALID');
    expect(forged(d => { d.missingInputs = []; })).toBe('INVALID');
  });

  it('G2/G3: unbound sources are NOT_EVALUATED, scope selects rules, and both validate', () => {
    const g2 = g1({ environmental: false }), e2 = run(g2.packs, g2.facts, DISCIPLINES, g2.bound);
    for (const id of ['b02-wfr-indicator-min', 'b04-transmission-max', 'b13-envelope-closed']) expect(statuses(e2, id)).toEqual(['NOT_EVALUATED']);
    expect(statuses(e2, 'b03-wfr-exact-min')).toEqual(['MEETS_RULE']);
    expect(e2.missingInputs[0]).toMatchObject({ kind: 'SOURCE', source: 'ENVIRONMENTAL' });
    expect(verify(draftOf(g2, e2), g2).status).toBe('VALID');
    const g3 = g1({ disciplines: ['ARCHITECTURE'] }), e3 = run(g3.packs, g3.facts, ['ARCHITECTURE'], g3.bound);
    expect(e3.summary.rulesSelected).toBe(13); expect(e3.conflicts).toHaveLength(1); expect(verify(draftOf(g3, e3), g3).status).toBe('VALID');
    const none = g1({ structural: false, environmental: false, systems: false }), e4 = run(none.packs, none.facts, DISCIPLINES, none.bound);
    expect(e4.results.filter(r => r.status === 'NOT_EVALUATED').map(r => r.ruleId)).toContain('a12-lift-door-min');
    expect(statuses(e4, 'a10-lift-over-two-storeys')).toEqual(['NOT_EVALUATED']); // COUNT(ELEVATOR) needs systems: never "0 lifts"
    expect(verify(draftOf(none, e4), none).status).toBe('VALID');
  });
});

describe('Phase 27 primitives at their boundaries (synthetic test-only packs)', () => {
  const door = (ruleId: string, requirement: Predicate) => draft(ruleId, requirement, { kind: 'OPENING', labels: ['door'] });
  const building = (ruleId: string, requirement: Predicate) => draft(ruleId, requirement, { kind: 'BUILDING', labels: null });
  const rules = [
    door('gte-equal', gte(fact('ARCH_OPENING_WIDTH'), '900', 'mm')), door('gte-one-under', gte(fact('ARCH_OPENING_WIDTH'), '901', 'mm')),
    door('lte-equal', lte(fact('ARCH_OPENING_WIDTH'), '900', 'mm')), door('lte-one-over', lte(fact('ARCH_OPENING_WIDTH'), '899', 'mm')),
    door('gt-strict', not(lte(fact('ARCH_OPENING_WIDTH'), '899', 'mm'))), door('lt-strict', not(gte(fact('ARCH_OPENING_WIDTH'), '900', 'mm'))),
    door('between', { op: 'ALL', of: [gte(fact('ARCH_OPENING_WIDTH'), '0.9', 'm'), lte(fact('ARCH_OPENING_WIDTH'), '900', 'mm')] }),
    draft('exists-absent', { op: 'EXISTS', fact: ref('ARCH_STAIR_HEADROOM') }, { kind: 'STAIR', labels: null }),
    draft('not-exists', not({ op: 'EXISTS', fact: ref('ARCH_STAIR_HEADROOM') }), { kind: 'STAIR', labels: null }),
    building('equals-enum', { op: 'EQUALS', fact: ref('ENV_ENVELOPE_STATUS'), value: 'INCOMPLETE' }),
    building('not-equal', not({ op: 'EQUALS', fact: ref('ENV_ENVELOPE_STATUS'), value: 'INCOMPLETE' })),
    building('equals-boolean', { op: 'EQUALS', fact: ref('SYS_EGRESS_AVAILABLE'), value: true }),
    building('count-above', gte({ count: { kind: 'SPACE', labels: ['bathroom'] } }, '3', 'count')),
    building('count-max', lte({ count: { kind: 'SPACE', labels: ['bathroom', 'kitchen'] } }, '3', 'count')),
    draft('negative-literal', gte(fact('ARCH_LEVEL_ELEVATION'), '-1', 'mm'), { kind: 'LEVEL', labels: null }),
    draft('ratio-zero', gte({ ratio: { numerator: ref('ARCH_SPACE_AREA'), denominator: ref('ARCH_SPACE_WINDOW_AREA') } }, '1', '1'), { kind: 'SPACE', labels: ['circulation'] }),
    draft('ratio-percent', gte({ ratio: { numerator: ref('ARCH_SPACE_WINDOW_AREA'), denominator: ref('ARCH_SPACE_AREA') } }, '4.961', '%'), { kind: 'SPACE', labels: ['living'] }),
    draft('ratio-percent-over', gte({ ratio: { numerator: ref('ARCH_SPACE_WINDOW_AREA'), denominator: ref('ARCH_SPACE_AREA') } }, '4.9613', '%'), { kind: 'SPACE', labels: ['living'] }),
    draft('conditional', { op: 'ANY', of: [not({ op: 'EXISTS', fact: ref('ARCH_STAIR_HEADROOM') }), gte(fact('ARCH_STAIR_HEADROOM'), '2000', 'mm')] }, { kind: 'STAIR', labels: null }),
    draft('float-equal', gte(fact('SYS_EGRESS_DISTANCE'), '24250', 'mm'), { kind: 'SPACE', labels: ['bathroom'] }),
  ];
  // Each boundary rule alone: together, ≥ 900 and ≤ 899 on one fact and scope are (correctly) a conflict.
  const alone = new Map(rules.map(r => [r.ruleId, testPack([r], `test-${r.ruleId}`)]));
  const single = (id: string) => run([alone.get(id)!]);
  it('evaluates every primitive at equality, one unit under and one unit over, and validates independently', () => {
    const one = (id: string) => [...new Set(statuses(single(id), id))];
    expect(one('gte-equal')).toEqual(['MEETS_RULE']); expect(one('gte-one-under')).toEqual(['DOES_NOT_MEET_RULE']);
    expect(one('lte-equal')).toEqual(['MEETS_RULE']); expect(one('lte-one-over')).toEqual(['DOES_NOT_MEET_RULE']);
    expect(one('gt-strict')).toEqual(['MEETS_RULE']); expect(one('lt-strict')).toEqual(['DOES_NOT_MEET_RULE']); expect(one('between')).toEqual(['MEETS_RULE']);
    expect(one('exists-absent')).toEqual(['DOES_NOT_MEET_RULE']); expect(one('not-exists')).toEqual(['MEETS_RULE']);
    expect(one('equals-enum')).toEqual(['DOES_NOT_MEET_RULE']); expect(one('not-equal')).toEqual(['MEETS_RULE']); expect(one('equals-boolean')).toEqual(['MEETS_RULE']);
    expect(one('count-above')).toEqual(['DOES_NOT_MEET_RULE']); expect(one('count-max')).toEqual(['MEETS_RULE']); // 2 bathrooms + 1 kitchen = 3
    expect(one('negative-literal')).toEqual(['MEETS_RULE']);
    expect(result(single('ratio-zero'), 'ratio-zero')).toMatchObject({ status: 'NOT_EVALUATED', reason: 'RATIO_ZERO_DENOMINATOR' });
    expect(one('ratio-percent')).toEqual(['MEETS_RULE']); expect(one('ratio-percent-over')).toEqual(['DOES_NOT_MEET_RULE']);
    expect(one('conditional')).toEqual(['MEETS_RULE']);
    expect(result(single('float-equal'), 'float-equal', 'space-bathroom-1')).toMatchObject({ status: 'REVIEW_REQUIRED', reason: 'FLOAT_BOUNDARY_AMBIGUITY' });
    expect(result(single('float-equal'), 'float-equal', 'space-bathroom-2').status).toBe('MEETS_RULE'); // 42400 ≥ 24250, far outside the band
    for (const [id, p] of alone) expect(verifySynthetic([p], G.facts, single(id)).status, id).toBe('VALID');
    const together = testPack(rules), all = run([together]);
    expect(all.conflicts.map(c => c.rules.map(r => r.split('/')[1]))).toContainEqual(['gte-equal', 'lte-one-over']);
    expect(verifySynthetic([together], G.facts, all).status).toBe('VALID');
  });

  it('applies §10.1 to stored values 14.9 and 17.1 ulp from the threshold in both implementations', () => {
    const facts = structuredClone(G.facts), wfr = facts.items.find(x => x.factType === 'ENV_WINDOW_TO_FLOOR_RATIO' && x.subject.id === 'space-living-1')!;
    const p = testPack([draft('wfr-one', gte(fact('ENV_WINDOW_TO_FLOOR_RATIO'), '1', '1'), { kind: 'SPACE', labels: ['living'] })], 'test-float-band');
    for (const [stored, expected] of [[1.0000000000000033, 'REVIEW_REQUIRED'], [1.0000000000000038, 'MEETS_RULE'], [0.9999999999999984, 'REVIEW_REQUIRED'], [0.9999999999999978, 'DOES_NOT_MEET_RULE']] as const) {
      (wfr.value as { exact: string }).exact = show(fromStored(stored));
      const r = run([p], facts);
      expect(r.results[0]!.status, String(stored)).toBe(expected);
      expect(verifySynthetic([p], facts, r).status).toBe('VALID');
    }
  });

  it('Amendment 3: exact labels evaluate, near-matches need review, different labels are out of scope; the source label is untouched', () => {
    const before = JSON.stringify(G.bim.geometry.spaces), lp = { pack: validatePack(LABEL_TEST_PACK), checksum: digest(LABEL_TEST_PACK) }, e3 = run([lp]);
    expect(result(e3, 't1-kitchen-exact')).toMatchObject({ status: 'MEETS_RULE', subject: { id: 'space-kitchen-1', label: 'kitchen' } });
    expect(result(e3, 't2-kitchen-near')).toMatchObject({ status: 'REVIEW_REQUIRED', reason: 'LABEL_NEAR_MATCH',
      nearMatch: { observed: 'kitchen', expected: [' Kitchen '], sourceEntity: { kind: 'SPACE', id: 'space-kitchen-1' }, reason: 'LABEL_NEAR_MATCH' } });
    expect(result(e3, 't2-kitchen-near').nearMatch!.evidence).toEqual(result(e3, 't2-kitchen-near').observedFacts);
    expect(result(e3, 't3-pantry-different')).toMatchObject({ status: 'NOT_APPLICABLE', reason: 'EMPTY_SCOPE', subject: null });
    expect(JSON.stringify(G.bim.geometry.spaces)).toBe(before);
    expect(nearKey(' Kitchen ')).toBe('kitchen'); expect(V.fold('ｋｉｔｃｈｅｎ ')).toBe('kitchen');
    expect(verifySynthetic([lp], G.facts, e3).status).toBe('VALID');
  });
});

describe('Phase 27 resource limits, claims and snapshot schema', () => {
  it('rejects rule, result and conflict-pair budgets with a typed resource-limit error, for the intended reason', () => {
    const many = (n: number, packId: string, requirement: Predicate = gte(fact('ARCH_OPENING_WIDTH'), '1', 'mm'), labels: string[] | null = ['door']) => testPack(Array.from({ length: n },
      (_, i) => draft(`r-${String(i).padStart(4, '0')}`, requirement, { kind: 'OPENING', labels })), packId);
    const review: Predicate = { op: 'MANUAL_REVIEW', reason: 'No constraint keys, so no conflict pairs.' };
    const rules = ['p-a', 'p-b', 'p-c'].map(id => many(171, id, review, null));
    expect(codeOf(() => run(rules))).toBe('KNOWLEDGE_RESOURCE_LIMIT'); expect(messageOf(() => run(rules))).toBe('Selected rule budget exceeded'); // 513 > 512
    expect(messageOf(() => run(rules.slice(0, 2)))).toBe('none'); // 342 rules × 13 openings = 4446 results
    const facts = structuredClone(G.facts), doorFact = facts.items.find(x => x.factType === 'ARCH_OPENING_WIDTH')!;
    for (let i = 0; i < 60; i++) facts.items.push({ ...structuredClone(doorFact), factId: `fact-${String(i).padStart(40, '0')}`, subject: { kind: 'OPENING', id: `synthetic-${i}`, label: 'door' } });
    expect(messageOf(() => run([many(83, 'p-w', review, null)], facts))).toBe('Rule result budget exceeded'); // 83 × 73 = 6059 > 6000
    expect(messageOf(() => run([many(82, 'p-w', review, null)], facts))).toBe('none'); // 82 × 73 = 5986
    const storeys = (packId: string) => testPack(Array.from({ length: 256 }, (_, i) => draft(`r-${String(i).padStart(4, '0')}`, gte(fact('ARCH_STOREY_COUNT'), '1', 'count'),
      { kind: 'BUILDING', labels: null })), packId);
    expect(messageOf(() => run([storeys('p-a'), storeys('p-b')]))).toBe('Conflict pair budget exceeded'); // C(512, 2) = 130 816 > 100 000 pairs on one fact, 512 results
    const contradictory = (packId: string, build: (i: number) => Predicate) => testPack(Array.from({ length: 40 }, (_, i) => draft(`r-${String(i).padStart(4, '0')}`, build(i),
      { kind: 'BUILDING', labels: null })), packId);
    const low = contradictory('p-lo', i => gte(fact('ARCH_STOREY_COUNT'), String(100 + i), 'count')), high = contradictory('p-hi', i => lte(fact('ARCH_STOREY_COUNT'), String(i + 1), 'count'));
    expect(messageOf(() => run([low, high]))).toBe('Conflict record budget exceeded'); // 40 × 40 = 1600 contradictions > 1000
    expect(run([low, contradictory('p-hi', i => lte(fact('ARCH_STOREY_COUNT'), String(i + 1), 'count'))].slice(0, 1)).conflicts).toHaveLength(0);
    expect(KNOWLEDGE_LIMITS).toMatchObject({ rulesSelected: 512, subjectResults: 6_000, conflictPairs: 100_000, conflicts: 1_000, outputBytes: 8_388_608 });
  });

  it('keeps every claim NOT_CLAIMED and the snapshot schema rejects any other value', () => {
    expect(Object.values(CLAIMS).every(v => v === 'NOT_CLAIMED')).toBe(true); expect(Object.keys(CLAIMS)).toHaveLength(13);
    const shape = SnapshotSchema.shape.claims;
    expect(shape.safeParse(CLAIMS).success).toBe(true);
    expect(shape.safeParse({ ...CLAIMS, legalCompliance: 'CLAIMED' }).success).toBe(false);
    expect(shape.safeParse({ ...CLAIMS, knowledgeRuleEvaluationComplete: true }).success).toBe(false);
    const { legalCompliance: _dropped, ...fewer } = CLAIMS;
    expect(shape.safeParse(fewer).success).toBe(false);
  });

  it('builds boundSources from explicit upstream only', () => {
    expect([...boundSources({ structural: null, environmental: null, systems: null })]).toEqual(['ARCHITECTURE']);
    expect([...G.bound].sort()).toEqual(['ARCHITECTURE', 'ENVIRONMENTAL', 'STRUCTURAL', 'SYSTEMS']);
  });
});
