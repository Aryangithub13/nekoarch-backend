import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import type { BuildingModelV2 } from '@designflow/shared';
import { generateBlueprintV2, generateParametricBlueprint } from '@designflow/generator';
import { parametricInput } from '../test-support/parametric-fixtures.js';
import { solverInput } from '../test-support/solver-v2-fixtures.js';
import { wetTwoStorey } from '../test-support/systems-fixtures.js';
import { boundSources, environmentalUpstream, structuralUpstream, systemsUpstream, wetBim } from '../test-support/knowledge-fixtures.js';
import { digest } from '../apps/api/src/bim/core.js';
import { CLAIMS, DISCIPLINES, EVALUATOR, KnowledgeError, FACT_CATALOG, FACT_TYPES, KNOWLEDGE_ANALYSIS_VERSION, KnowledgeInputSchema, LIMITATIONS, SnapshotSchema, itemUnit,
  type FactType, type KnowledgePack, type Predicate, type Unit, type Upstream } from '../apps/api/src/knowledge/contracts.js';
import { authoring, bundledPack, validatePack } from '../apps/api/src/knowledge/packs.js';
import { extractFacts, knowledgeBinding } from '../apps/api/src/knowledge/facts.js';
import { evaluate } from '../apps/api/src/knowledge/evaluate.js';
import { detectConflicts } from '../apps/api/src/knowledge/conflicts.js';
import { validateKnowledgeModel, validateKnowledgeResults } from '../apps/api/src/knowledge/validate.js';

const { rule, meta, gte, lte, fact, not } = authoring;
const maximum = parametricInput(); maximum.site.boundary = [{ x: 0, z: 0 }, { x: 60000, z: 0 }, { x: 60000, z: 60000 }, { x: 0, z: 60000 }];
Object.assign(maximum.parametricArchitecture.floors[0]!, { widthMm: 55000, depthMm: 55000, westWingWidthMm: 27000, southWingDepthMm: 27000 }); maximum.rooms = [{ type: 'bedroom', count: 24 }];
const bundled = ['nekoarch-demo-coordination', 'nekoarch-demo-dimensional'].map(id => bundledPack(id, '1.0.0'));

/** Synthetic, valid rule packs over every referable supported decimal fact (benchmark only, never bundled). */
const numeric = FACT_TYPES.filter(t => FACT_CATALOG[t].supported && FACT_CATALOG[t].referable && FACT_CATALOG[t].value === 'DECIMAL');
function generated(packId: string, rules: number, shape: (i: number) => { t: FactType; p: Predicate }): { pack: KnowledgePack; checksum: string } {
  const r = rule('bench');
  const pack = validatePack({ ...meta(packId, 'Benchmark pack', [...DISCIPLINES], 'bench', 'Benchmark only'), version: '0.0.1', rules: Array.from({ length: rules }, (_, i) => {
    const { t, p } = shape(i);
    return r({ ruleId: `r-${String(i).padStart(4, '0')}`, title: `rule ${i}`, discipline: 'ARCHITECTURE', scope: { kind: FACT_CATALOG[t].subject, labels: null }, requirement: p,
      meets: 'm', doesNotMeet: 'n', locator: `B-${i}`, interpretation: 'Benchmark only.' });
  }) });
  return { pack, checksum: digest(pack) };
}
const unitOf = (t: FactType): Unit => FACT_CATALOG[t].unit ?? itemUnit('SPACE_FLOOR_AREA')!;
const mixed = (i: number) => {
  const t = numeric[i % numeric.length]!, f = fact(t, t === 'QUANTITY_TOTAL' ? 'SPACE_FLOOR_AREA' : null), u = unitOf(t), v = String(1 + (i % 997));
  const leaf = i % 2 ? gte(f, v, u) : lte(f, v, u);
  // Every eighth rule is deep (up to the predicateDepth bound of 8); the rest are shallow composites.
  let p: Predicate = i % 5 === 0 ? { op: 'ALL', of: [leaf, not(leaf)] } : i % 7 === 0 ? { op: 'ANY', of: [leaf, gte(f, '0', u)] } : leaf;
  if (i % 8 === 0) for (let d = 1; d < 6; d++) p = not(p); // ALL(leaf, NOT leaf) is depth 3, so this reaches exactly 8
  return { t, p };
};

type Case = { name: string; model: () => BuildingModelV2; sources: { s?: boolean; e?: boolean; y?: boolean }; packs: () => { pack: KnowledgePack; checksum: string }[] };
const wet = () => wetTwoStorey();
const cases: Case[] = [
  { name: 'small 1-storey (v2), architecture only', model: () => generateBlueprintV2(solverInput()).model, sources: {}, packs: () => bundled },
  { name: 'L-shaped, architecture only', model: () => generateParametricBlueprint(parametricInput()).model, sources: {}, packs: () => bundled },
  { name: 'two-storey setback, architecture only', model: () => generateParametricBlueprint(parametricInput(true)).model, sources: {}, packs: () => bundled },
  { name: 'maximum 24-room, architecture only', model: () => generateParametricBlueprint(maximum).model, sources: {}, packs: () => bundled },
  { name: 'wet two-storey + structural', model: wet, sources: { s: true }, packs: () => bundled },
  { name: 'wet two-storey + environmental', model: wet, sources: { e: true }, packs: () => bundled },
  { name: 'wet two-storey + systems', model: wet, sources: { y: true }, packs: () => bundled },
  { name: 'G1 multi-discipline (S+E+Y), both packs', model: wet, sources: { s: true, e: true, y: true }, packs: () => bundled },
  { name: 'eight packs (2 bundled + 6 synthetic x 64 rules)', model: wet, sources: { s: true, e: true, y: true },
    packs: () => [...bundled, ...['b-1', 'b-2', 'b-3', 'b-4', 'b-5', 'b-6'].map((id, k) => generated(`bench-${id}`, 64, i => mixed(i + 64 * k)))] },
  { name: 'high rule count (4 x 256 = 1024 rules)', model: wet, sources: { s: true, e: true, y: true },
    packs: () => ['h-1', 'h-2', 'h-3', 'h-4'].map((id, k) => generated(`bench-${id}`, 256, i => mixed(i + 256 * k))) },
  { name: 'high rule count on maximum 24-room (1024 rules)', model: () => generateParametricBlueprint(maximum).model, sources: {},
    packs: () => ['m-1', 'm-2', 'm-3', 'm-4'].map((id, k) => generated(`bench-${id}`, 256, i => { const spread: FactType[] = ['ARCH_SPACE_AREA', 'ARCH_OPENING_WIDTH', 'ARCH_OPENING_HEIGHT', 'ARCH_OPENING_SILL', 'ARCH_LEVEL_ELEVATION', 'ARCH_FLOOR_TO_FLOOR_HEIGHT',
        'ARCH_SPACE_WINDOW_AREA', 'ARCH_STAIR_WIDTH', 'ARCH_STAIR_TREAD_DEPTH', 'ARCH_STAIR_MAX_RISER', 'ARCH_STAIR_RISER_COUNT', 'ARCH_BUILDING_HEIGHT'];
      const t = spread[(i + 256 * k) % spread.length]!;
      return { t, p: gte(fact(t), String(i + 1), unitOf(t)) }; })) },
  { name: 'conflicting packs (2 x 128 contradictory rules on one fact)', model: wet, sources: {},
    packs: () => [generated('bench-conflict-a', 128, i => ({ t: 'ARCH_OPENING_SILL', p: gte(fact('ARCH_OPENING_SILL'), String(1000 + i), 'mm') })),
      generated('bench-conflict-b', 128, i => ({ t: 'ARCH_OPENING_SILL', p: lte(fact('ARCH_OPENING_SILL'), String(500 + i), 'mm') }))] },
];

const rows: Record<string, unknown>[] = [];
for (const c of cases) {
  const model = c.model(), bim = wetBim(model);
  const up: Upstream = { structural: c.sources.s ? structuralUpstream(bim) : null, environmental: c.sources.e ? environmentalUpstream(bim) : null,
    systems: c.sources.y ? systemsUpstream(bim) : null };
  const packs = c.packs(), input = KnowledgeInputSchema.parse({ version: 'specialized-knowledge-input-v1', packs: packs.map(p => ({ packId: p.pack.packId, version: p.pack.version })),
    sources: { structuralAnalysisId: up.structural?.analysisId ?? null, environmentalAnalysisId: up.environmental?.analysisId ?? null, systemsAnalysisId: up.systems?.analysisId ?? null },
    scope: { disciplines: DISCIPLINES } });
  const ordered = input.packs.map(ref => packs.find(p => p.pack.packId === ref.packId)!);
  (globalThis as { gc?: () => void }).gc?.();
  const heap = process.memoryUsage().heapUsed, t0 = performance.now();
  const binding = knowledgeBinding(bim.binding, up, ordered, input.scope.disciplines), facts = extractFacts(bim, up, binding), t1 = performance.now();
  let e: ReturnType<typeof evaluate>;
  try { e = evaluate(ordered, facts, input, boundSources(up)); }
  catch (error) {
    // Beyond the frozen limits: the typed rejection must happen before evaluation work (see benchmark-pre-freeze.json for the measured cost).
    if (!(error instanceof KnowledgeError) || error.code !== 'KNOWLEDGE_RESOURCE_LIMIT') throw error;
    rows.push({ name: c.name, facts: facts.items.length, rejected: `${error.code}: ${error.message}`, rejectMs: +(performance.now() - t1).toFixed(1) });
    continue;
  }
  const t2 = performance.now();
  const sel = { packs: ordered.map(p => ({ packId: p.pack.packId, version: p.pack.version, checksum: p.checksum })), disciplines: [...input.scope.disciplines] };
  const stored = { version: input.version, packs: input.packs, sources: input.sources, scope: input.scope };
  const snapPacks = ordered.map(p => ({ packId: p.pack.packId, version: p.pack.version, checksum: p.checksum, pack: p.pack, rulesTotal: p.pack.rules.length, rulesSelected: p.pack.rules.length }));
  const draft = { binding, inputHash: digest({ version: KNOWLEDGE_ANALYSIS_VERSION, binding, input: stored }), factsHash: digest(facts), input: stored, packs: snapPacks, facts, ...e };
  const t3 = performance.now();
  const model_ = validateKnowledgeModel(facts, bim, up, binding, sel);
  const results = validateKnowledgeResults({ ...draft, claims: CLAIMS }, { binding, checksums: Object.fromEntries(ordered.map(p => [`${p.pack.packId}@${p.pack.version}`, p.checksum])) });
  const t4 = performance.now();
  if (model_.status !== 'VALID' || results.status !== 'VALID') throw new Error(`${c.name}: validation ${model_.status}/${results.status} ${JSON.stringify(results.diagnostics.slice(0, 2))}`);
  const snapshot = SnapshotSchema.parse({ version: KNOWLEDGE_ANALYSIS_VERSION, ...draft, evaluator: EVALUATOR, validation: { model: model_, results },
    status: { analysis: 'EVALUATED', validation: 'VALIDATED' }, claims: CLAIMS, limitations: LIMITATIONS });
  const byRule = new Map<string, string[]>();
  for (const r of e.results) byRule.set(`${r.packId}/${r.ruleId}`, [...(byRule.get(`${r.packId}/${r.ruleId}`) ?? []), r.isolatedStatus]);
  const statuses = [...byRule.values()], fixed = new Set(['NOT_EVALUATED', 'UNSUPPORTED']);
  rows.push({ name: c.name, facts: facts.items.length, rulesSelected: e.summary.rulesSelected,
    rulesApplicable: statuses.filter(s => s.some(x => x !== 'NOT_APPLICABLE' && !fixed.has(x))).length,
    rulesEvaluated: statuses.filter(s => s.some(x => ['MEETS_RULE', 'DOES_NOT_MEET_RULE', 'REVIEW_REQUIRED', 'INPUT_INCOMPLETE'].includes(x))).length,
    rulesNotEvaluated: statuses.filter(s => s.every(x => fixed.has(x))).length, results: e.summary.results, conflicts: e.summary.conflicts,
    meets: e.summary.byStatus.MEETS_RULE, doesNotMeet: e.summary.byStatus.DOES_NOT_MEET_RULE,
    extractMs: +(t1 - t0).toFixed(1), evaluateMs: +(t2 - t1).toFixed(1), validateMs: +(t4 - t3).toFixed(1), snapshotBytes: Buffer.byteLength(JSON.stringify(snapshot)),
    heapDeltaMb: +((process.memoryUsage().heapUsed - heap) / 1048576).toFixed(1) });
}

// Limit probes: the cost of the bounds themselves.
const probes: Record<string, unknown> = {};
{
  const pairs = generated('probe-pairs', 256, i => ({ t: 'ARCH_OPENING_WIDTH', p: gte(fact('ARCH_OPENING_WIDTH'), String(i + 1), 'mm') }));
  const twice = [pairs, generated('probe-pairs-b', 191, i => ({ t: 'ARCH_OPENING_WIDTH', p: gte(fact('ARCH_OPENING_WIDTH'), String(i + 300), 'mm') }))];
  const sel = twice.flatMap(p => p.pack.rules.map(rule => ({ packId: p.pack.packId, rule })));
  const t = performance.now(), d = detectConflicts(sel);
  probes.conflictPairs = { rules: sel.length, pairs: sel.length * (sel.length - 1) / 2, conflicts: d.conflicts.length, ms: +(performance.now() - t).toFixed(1) };
}
const out = { generatedAt: 'deterministic-fixtures', node: process.version, rows, probes };
await mkdir('docs/phase27/evidence', { recursive: true });
await writeFile('docs/phase27/evidence/benchmark.json', `${JSON.stringify(out, null, 2)}\n`);
console.table(rows); console.log(probes);
