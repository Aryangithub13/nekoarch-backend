import { bounded, digest } from '../bim/core.js';
import { BimError } from '../bim/contracts.js';
import { FACT_CATALOG, KNOWLEDGE_LIMITS, KnowledgeError, LABEL_FACT, PACK_FORMAT, PackSchema, UNIT_DIMENSIONS, itemUnit, type CatalogEntry, type Discipline, type FactRef,
  type FactType, type KnowledgePack, type Literal, type Operand, type Predicate, type Rule, type Unit } from './contracts.js';

// ---------------------------------------------------------------- authoring helpers (bundled packs only)
const ref = (factType: FactType, parameter: string | null = null): FactRef => ({ factType, parameter });
const fact = (factType: FactType, parameter: string | null = null): Operand => ({ fact: ref(factType, parameter) });
const lit = (decimal: string, unit: Unit): Literal => ({ decimal, unit });
const gte = (left: Operand, decimal: string, unit: Unit): Predicate => ({ op: 'GTE', left, right: lit(decimal, unit) });
const lte = (left: Operand, decimal: string, unit: Unit): Predicate => ({ op: 'LTE', left, right: lit(decimal, unit) });
const not = (of: Predicate): Predicate => ({ op: 'NOT', of });
/** Every fact reference in a predicate, in first-seen order. */
export function referencedFacts(p: Predicate | null): FactRef[] {
  const out: FactRef[] = [], stack: Predicate[] = p ? [p] : [];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.op === 'EXISTS' || n.op === 'EQUALS') out.push(n.fact);
    else if (n.op === 'GTE' || n.op === 'LTE') { if ('fact' in n.left) out.push(n.left.fact); else if ('ratio' in n.left) out.push(n.left.ratio.numerator, n.left.ratio.denominator); }
    else if (n.op === 'ALL' || n.op === 'ANY') stack.push(...[...n.of].reverse());
    else if (n.op === 'NOT') stack.push(n.of);
  }
  return out;
}
const refKey = (r: FactRef) => `${r.factType}|${r.parameter ?? ''}`;
function requiredFacts(...ps: (Predicate | null)[]): FactRef[] {
  const seen = new Map<string, FactRef>();
  for (const r of ps.flatMap(referencedFacts)) seen.set(refKey(r), r);
  return [...seen.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, r]) => r);
}
type Draft = { ruleId: string; title: string; discipline: Discipline; scope: Rule['scope']; applicability?: Predicate; requirement: Predicate; meets: string; doesNotMeet: string;
  locator: string; interpretation: string; severity?: Rule['severity']; reviewDiscipline?: Discipline; limitations?: string[] };
const rule = (refId: string) => (r: Draft): Rule => ({ ruleId: r.ruleId, version: '1', title: r.title, discipline: r.discipline, severity: r.severity ?? 'WARNING', advisory: true,
  reviewDiscipline: r.reviewDiscipline ?? null, scope: r.scope, applicability: r.applicability ?? null, requirement: r.requirement,
  requiredFacts: requiredFacts(r.applicability ?? null, r.requirement), semantics: { meets: r.meets, doesNotMeet: r.doesNotMeet },
  sourceReference: { refId, locator: r.locator, interpretation: r.interpretation }, limitations: r.limitations ?? [] });
const meta = (packId: string, title: string, disciplines: Discipline[], refId: string, refTitle: string) => ({ format: PACK_FORMAT as typeof PACK_FORMAT, packId, version: '1.0.0', title, disciplines,
  publisher: { name: 'NekoArch (project-authored)', kind: 'PROJECT_AUTHORED' as const }, jurisdiction: null, edition: 'demo-2026-10', effectiveDate: null,
  sourceType: 'SYNTHETIC_DEMONSTRATION' as const, license: { spdx: 'CC0-1.0', redistribution: 'PERMITTED' as const },
  sourceReferences: [{ refId, title: refTitle, uri: null, note: 'Project-authored values chosen to exercise the rule engine; not taken from any code, standard or regulation.' }],
  provenance: { authoredBy: 'NekoArch Phase 27', method: 'HAND_AUTHORED_SYNTHETIC' } });
const synthetic = 'Synthetic demonstration threshold; not a regulation or recommendation.';
/** Test-only authoring surface; never reaches the catalog. */
export const authoring = { ref, fact, lit, gte, lte, not, rule, meta };

// ---------------------------------------------------------------- bundled packs (design §21). A11 is retired (Amendment 3); ids are never reused.
const a = rule('demo-a');
export const DIMENSIONAL_PACK: KnowledgePack = { ...meta('nekoarch-demo-dimensional', 'NekoArch demonstration pack A: dimensional and egress thresholds (synthetic, not a regulation)',
  ['ARCHITECTURE', 'LIFE_SAFETY', 'VERTICAL_TRANSPORT'], 'demo-a', 'NekoArch synthetic demonstration thresholds, set A'), rules: [
  a({ ruleId: 'a01-door-width-min', title: 'Door opening width minimum', discipline: 'ARCHITECTURE', scope: { kind: 'OPENING', labels: ['door'] },
    requirement: gte(fact('ARCH_OPENING_WIDTH'), '900', 'mm'), meets: 'Door opening width is at least the stated minimum.', doesNotMeet: 'Door opening width is below the stated minimum.',
    locator: 'DEMO-A-01', interpretation: synthetic, limitations: ['DOOR_CLEAR_WIDTH_NOT_MODELLED'] }),
  a({ ruleId: 'a02-stair-width-min', title: 'Stair width minimum', discipline: 'ARCHITECTURE', scope: { kind: 'STAIR', labels: null },
    requirement: gte(fact('ARCH_STAIR_WIDTH'), '1001', 'mm'), meets: 'Stair width is at least the stated minimum.', doesNotMeet: 'Stair width is below the stated minimum.',
    locator: 'DEMO-A-02', interpretation: synthetic }),
  a({ ruleId: 'a03-riser-max', title: 'Maximum riser height', discipline: 'ARCHITECTURE', scope: { kind: 'STAIR', labels: null },
    requirement: lte(fact('ARCH_STAIR_MAX_RISER'), '187', 'mm'), meets: 'Every riser is at most the stated maximum.', doesNotMeet: 'At least one riser exceeds the stated maximum.',
    locator: 'DEMO-A-03', interpretation: synthetic }),
  a({ ruleId: 'a04-tread-min', title: 'Tread depth minimum', discipline: 'ARCHITECTURE', scope: { kind: 'STAIR', labels: null },
    requirement: gte(fact('ARCH_STAIR_TREAD_DEPTH'), '0.279', 'm'), meets: 'Tread depth is at least the stated minimum.', doesNotMeet: 'Tread depth is below the stated minimum.',
    locator: 'DEMO-A-04', interpretation: synthetic }),
  a({ ruleId: 'a05-headroom-min', title: 'Stair headroom minimum', discipline: 'ARCHITECTURE', scope: { kind: 'STAIR', labels: null },
    requirement: gte(fact('ARCH_STAIR_HEADROOM'), '2000', 'mm'), meets: 'Modelled stair headroom is at least the stated minimum.', doesNotMeet: 'Modelled stair headroom is below the stated minimum.',
    locator: 'DEMO-A-05', interpretation: synthetic }),
  a({ ruleId: 'a06-bedroom-area-min', title: 'Bedroom area minimum', discipline: 'ARCHITECTURE', scope: { kind: 'SPACE', labels: ['bedroom'] },
    requirement: gte(fact('ARCH_SPACE_AREA'), '9', 'm2'), meets: 'Centreline bedroom area is at least the stated minimum.', doesNotMeet: 'Centreline bedroom area is below the stated minimum.',
    locator: 'DEMO-A-06', interpretation: synthetic, limitations: ['CENTRELINE_AREA_NOT_NET_FLOOR_AREA'] }),
  a({ ruleId: 'a07-garage-area-min', title: 'Garage area minimum', discipline: 'ARCHITECTURE', scope: { kind: 'SPACE', labels: ['garage'] },
    requirement: gte(fact('ARCH_SPACE_AREA'), '15', 'm2'), meets: 'Centreline garage area is at least the stated minimum.', doesNotMeet: 'Centreline garage area is below the stated minimum.',
    locator: 'DEMO-A-07', interpretation: synthetic, limitations: ['CENTRELINE_AREA_NOT_NET_FLOOR_AREA'] }),
  a({ ruleId: 'a08-window-sill-min', title: 'Window sill height minimum', discipline: 'ARCHITECTURE', scope: { kind: 'OPENING', labels: ['window'] },
    requirement: gte(fact('ARCH_OPENING_SILL'), '900', 'mm'), meets: 'Window sill height is at least the stated minimum.', doesNotMeet: 'Window sill height is below the stated minimum.',
    locator: 'DEMO-A-08', interpretation: synthetic }),
  a({ ruleId: 'a09-egress-distance-max', title: 'Geometric egress distance maximum', discipline: 'LIFE_SAFETY', scope: { kind: 'SPACE', labels: null },
    requirement: lte(fact('SYS_EGRESS_DISTANCE'), '40', 'm'), meets: 'Geometric egress distance is at most the stated maximum.', doesNotMeet: 'Geometric egress distance exceeds the stated maximum.',
    locator: 'DEMO-A-09', interpretation: synthetic, reviewDiscipline: 'LIFE_SAFETY', limitations: ['GEOMETRIC_EGRESS_ONLY', 'NOT_A_TRAVEL_DISTANCE_LIMIT'] }),
  a({ ruleId: 'a10-lift-over-two-storeys', title: 'Lift proposal above two storeys', discipline: 'VERTICAL_TRANSPORT', scope: { kind: 'BUILDING', labels: null },
    applicability: not(lte(fact('ARCH_STOREY_COUNT'), '2', 'count')), requirement: gte({ count: { kind: 'ELEVATOR', labels: null } }, '1', 'count'),
    meets: 'At least one lift proposal exists.', doesNotMeet: 'No lift proposal exists.', locator: 'DEMO-A-10', interpretation: synthetic }),
  a({ ruleId: 'a12-lift-door-min', title: 'Lift door width minimum', discipline: 'VERTICAL_TRANSPORT', scope: { kind: 'ELEVATOR', labels: null },
    requirement: gte(fact('SYS_ELEVATOR_DOOR_WIDTH'), '800', 'mm'), meets: 'Proposed lift door width is at least the stated minimum.', doesNotMeet: 'Proposed lift door width is below the stated minimum.',
    locator: 'DEMO-A-12', interpretation: synthetic, limitations: ['SPATIAL_PROPOSAL_ONLY'] }),
  a({ ruleId: 'a13-dead-end-max', title: 'Geometric dead-end length maximum', discipline: 'LIFE_SAFETY', scope: { kind: 'SPACE', labels: null },
    applicability: { op: 'EXISTS', fact: ref('SYS_DEAD_END_LENGTH') }, requirement: lte(fact('SYS_DEAD_END_LENGTH'), '20', 'm'),
    meets: 'Geometric dead-end length is at most the stated maximum.', doesNotMeet: 'Geometric dead-end length exceeds the stated maximum.',
    locator: 'DEMO-A-13', interpretation: synthetic, reviewDiscipline: 'LIFE_SAFETY', limitations: ['GEOMETRIC_EGRESS_ONLY'] }),
  a({ ruleId: 'a14-stair-all', title: 'Stair tread, riser and headroom together', discipline: 'ARCHITECTURE', scope: { kind: 'STAIR', labels: null },
    requirement: { op: 'ALL', of: [gte(fact('ARCH_STAIR_TREAD_DEPTH'), '250', 'mm'), lte(fact('ARCH_STAIR_MAX_RISER'), '190', 'mm'), gte(fact('ARCH_STAIR_HEADROOM'), '2000', 'mm')] },
    meets: 'Tread, riser and headroom all meet their stated bounds.', doesNotMeet: 'At least one of tread, riser or headroom is outside its stated bound.',
    locator: 'DEMO-A-14', interpretation: synthetic }),
  a({ ruleId: 'a15-stair-any', title: 'Stair headroom or width', discipline: 'ARCHITECTURE', scope: { kind: 'STAIR', labels: null },
    requirement: { op: 'ANY', of: [gte(fact('ARCH_STAIR_HEADROOM'), '2000', 'mm'), gte(fact('ARCH_STAIR_WIDTH'), '900', 'mm')] },
    meets: 'Headroom or width meets its stated minimum.', doesNotMeet: 'Neither headroom nor width meets its stated minimum.', locator: 'DEMO-A-15', interpretation: synthetic }),
  a({ ruleId: 'a16-headroom-below-2500', title: 'Stair headroom below a stated cap', discipline: 'ARCHITECTURE', scope: { kind: 'STAIR', labels: null },
    requirement: not(gte(fact('ARCH_STAIR_HEADROOM'), '2500', 'mm')), meets: 'Modelled headroom is below the stated cap.', doesNotMeet: 'Modelled headroom is at or above the stated cap.',
    locator: 'DEMO-A-16', interpretation: synthetic }),
] };

const b = rule('demo-b');
export const COORDINATION_PACK: KnowledgePack = { ...meta('nekoarch-demo-coordination', 'NekoArch demonstration pack B: coordination, environmental and quantity thresholds (synthetic, not a regulation)',
  ['ARCHITECTURE', 'COST', 'ENVIRONMENTAL', 'MEP', 'QUANTITY', 'STRUCTURAL'], 'demo-b', 'NekoArch synthetic demonstration thresholds, set B'), rules: [
  b({ ruleId: 'b01-window-sill-max', title: 'Window sill height maximum', discipline: 'ARCHITECTURE', scope: { kind: 'OPENING', labels: ['window'] },
    requirement: lte(fact('ARCH_OPENING_SILL'), '850', 'mm'), meets: 'Window sill height is at most the stated maximum.', doesNotMeet: 'Window sill height exceeds the stated maximum.',
    locator: 'DEMO-B-01', interpretation: synthetic }),
  b({ ruleId: 'b02-wfr-indicator-min', title: 'Window-to-floor ratio indicator minimum', discipline: 'ENVIRONMENTAL', scope: { kind: 'SPACE', labels: ['living'] },
    requirement: gte(fact('ENV_WINDOW_TO_FLOOR_RATIO'), '0.05', '1'), meets: 'The Phase 25 window-to-floor ratio indicator is at least the stated minimum.',
    doesNotMeet: 'The Phase 25 window-to-floor ratio indicator is below the stated minimum.', locator: 'DEMO-B-02', interpretation: synthetic, limitations: ['NOT_A_DAYLIGHT_METRIC'] }),
  b({ ruleId: 'b03-wfr-exact-min', title: 'Exact window-to-floor area ratio minimum', discipline: 'ENVIRONMENTAL', scope: { kind: 'SPACE', labels: ['living'] },
    requirement: gte({ ratio: { numerator: ref('ARCH_SPACE_WINDOW_AREA'), denominator: ref('ARCH_SPACE_AREA') } }, '0.0496', '1'),
    meets: 'Exact modelled window area over centreline area is at least the stated minimum.', doesNotMeet: 'Exact modelled window area over centreline area is below the stated minimum.',
    locator: 'DEMO-B-03', interpretation: synthetic, limitations: ['NOT_A_DAYLIGHT_METRIC'] }),
  b({ ruleId: 'b04-transmission-max', title: 'Envelope transmission total maximum', discipline: 'ENVIRONMENTAL', scope: { kind: 'THERMAL_CASE', labels: null },
    requirement: lte(fact('ENV_TRANSMISSION_TOTAL'), '6.64434', 'kW'), meets: 'Steady-state envelope transmission is at most the stated maximum.',
    doesNotMeet: 'Steady-state envelope transmission exceeds the stated maximum.', locator: 'DEMO-B-04', interpretation: synthetic, limitations: ['NOT_A_DESIGN_HEAT_LOAD'] }),
  b({ ruleId: 'b05-duct-velocity-max', title: 'Duct air velocity maximum', discipline: 'MEP', scope: { kind: 'MEP_NETWORK', labels: ['HVAC_RETURN', 'HVAC_SUPPLY'] },
    requirement: lte(fact('SYS_DUCT_MAX_VELOCITY'), '4.1666', 'm/s'), meets: 'Maximum duct segment velocity is at most the stated maximum.',
    doesNotMeet: 'Maximum duct segment velocity exceeds the stated maximum.', locator: 'DEMO-B-05', interpretation: synthetic }),
  b({ ruleId: 'b06-demand-max', title: 'Electrical demand maximum', discipline: 'MEP', scope: { kind: 'BUILDING', labels: null },
    requirement: lte(fact('SYS_ELECTRICAL_DEMAND_W'), '5', 'kW'), meets: 'Explicit electrical demand is at most the stated maximum.', doesNotMeet: 'Explicit electrical demand exceeds the stated maximum.',
    locator: 'DEMO-B-06', interpretation: synthetic }),
  b({ ruleId: 'b07-connected-max', title: 'Connected electrical load maximum', discipline: 'MEP', scope: { kind: 'BUILDING', labels: null },
    requirement: lte(fact('SYS_ELECTRICAL_CONNECTED_W'), '1.75', 'kW'), meets: 'Connected real-power load is at most the stated maximum.',
    doesNotMeet: 'Connected real-power load exceeds the stated maximum.', locator: 'DEMO-B-07', interpretation: synthetic }),
  b({ ruleId: 'b08-drainage-slope-min', title: 'Drainage slope minimum', discipline: 'MEP', scope: { kind: 'MEP_NETWORK', labels: ['SANITARY'] },
    requirement: gte(fact('SYS_DRAINAGE_SLOPE'), '0.025', '1'), meets: 'Drainage slope is at least the stated minimum.', doesNotMeet: 'Drainage slope is below the stated minimum.',
    locator: 'DEMO-B-08', interpretation: synthetic }),
  b({ ruleId: 'b09-cost-cap', title: 'Construction cost cap', discipline: 'COST', scope: { kind: 'BUILDING', labels: null },
    requirement: lte(fact('COST_TOTAL'), '1000000', 'MONEY'), meets: 'Cost is at most the stated cap.', doesNotMeet: 'Cost exceeds the stated cap.',
    locator: 'DEMO-B-09', interpretation: synthetic, limitations: ['COST_FACTS_NOT_PROVIDED_IN_V1'] }),
  b({ ruleId: 'b10-beam-depth-min', title: 'Beam section depth minimum', discipline: 'STRUCTURAL', scope: { kind: 'STRUCTURAL_MEMBER', labels: ['BEAM'] },
    requirement: gte(fact('STRUCT_SECTION_DEPTH'), '550', 'mm'), meets: 'Beam section depth is at least the stated minimum.', doesNotMeet: 'Beam section depth is below the stated minimum.',
    locator: 'DEMO-B-10', interpretation: synthetic, reviewDiscipline: 'STRUCTURAL', limitations: ['NO_CAPACITY_CHECK'] }),
  b({ ruleId: 'b11-utilisation-max', title: 'Member utilisation maximum', discipline: 'STRUCTURAL', scope: { kind: 'STRUCTURAL_MEMBER', labels: null },
    requirement: lte(fact('STRUCT_UTILISATION'), '1', '1'), meets: 'Utilisation is at most one.', doesNotMeet: 'Utilisation exceeds one.',
    locator: 'DEMO-B-11', interpretation: synthetic, limitations: ['NO_CAPACITY_CHECK'] }),
  b({ ruleId: 'b12-penetration-review', title: 'Service penetration fire-stopping review', discipline: 'MEP', scope: { kind: 'BUILDING', labels: null },
    applicability: gte(fact('SYS_PENETRATION_COUNT'), '1', 'count'), requirement: { op: 'MANUAL_REVIEW', reason: 'Fire-stopping of service penetrations requires professional review.' },
    meets: 'Not used: manual review only.', doesNotMeet: 'Not used: manual review only.', locator: 'DEMO-B-12', interpretation: synthetic, reviewDiscipline: 'LIFE_SAFETY' }),
  b({ ruleId: 'b13-envelope-closed', title: 'Closed thermal envelope', discipline: 'ENVIRONMENTAL', scope: { kind: 'BUILDING', labels: null },
    requirement: { op: 'EQUALS', fact: ref('ENV_ENVELOPE_STATUS'), value: 'CLOSED' }, meets: 'The Phase 25 envelope is closed.', doesNotMeet: 'The Phase 25 envelope is incomplete.',
    locator: 'DEMO-B-13', interpretation: synthetic }),
  b({ ruleId: 'b14-gfa-max', title: 'Geometric gross floor area maximum', discipline: 'QUANTITY', scope: { kind: 'BUILDING', labels: null },
    requirement: lte(fact('QUANTITY_TOTAL', 'GEOMETRIC_GROSS_FLOOR_AREA'), '418.3', 'm2'), meets: 'Geometric gross floor area is at most the stated maximum.',
    doesNotMeet: 'Geometric gross floor area exceeds the stated maximum.', locator: 'DEMO-B-14', interpretation: synthetic, limitations: ['GEOMETRIC_NOT_LEGAL_GFA'] }),
  b({ ruleId: 'b15-bathroom-count-min', title: 'Bathroom count minimum', discipline: 'ARCHITECTURE', scope: { kind: 'BUILDING', labels: null },
    requirement: gte({ count: { kind: 'SPACE', labels: ['bathroom'] } }, '2', 'count'), meets: 'At least the stated number of bathrooms is modelled.',
    doesNotMeet: 'Fewer than the stated number of bathrooms is modelled.', locator: 'DEMO-B-15', interpretation: synthetic }),
] };

// ---------------------------------------------------------------- pack validation (§5)
const factUnit = (r: FactRef): Unit | null => { const e = FACT_CATALOG[r.factType]; return 'parameter' in e && e.parameter ? itemUnit(r.parameter ?? '') : e.unit; };
function issues(pack: KnowledgePack): string[] {
  const out: string[] = [], refs = new Set(pack.sourceReferences.map(s => s.refId));
  if (new Set(pack.rules.map(r => r.ruleId)).size !== pack.rules.length) out.push('Rule IDs must be unique');
  if (refs.size !== pack.sourceReferences.length) out.push('Source reference IDs must be unique');
  for (const r of pack.rules) {
    const at = (m: string) => out.push(`${r.ruleId}: ${m}`);
    if (!pack.disciplines.includes(r.discipline)) at('discipline is not declared by the pack');
    if (!refs.has(r.sourceReference.refId)) at('unknown source reference');
    if (r.scope.labels && !LABEL_FACT[r.scope.kind]) at(`${r.scope.kind} subjects have no label to select by`);
    // Iterative shape check before any recursive evaluation.
    let nodes = 0;
    const stack: [Predicate, number][] = [[r.requirement, 1], ...(r.applicability ? [[r.applicability, 1] as [Predicate, number]] : [])];
    while (stack.length) {
      const [n, depth] = stack.pop()!;
      if (++nodes > KNOWLEDGE_LIMITS.nodesPerRule) { at('too many predicate nodes'); break; }
      if (depth > KNOWLEDGE_LIMITS.predicateDepth) { at('predicate too deep'); break; }
      if (n.op === 'ALL' || n.op === 'ANY') for (const c of n.of) stack.push([c, depth + 1]);
      else if (n.op === 'NOT') stack.push([n.of, depth + 1]);
      else if (n.op === 'EQUALS') {
        const e = FACT_CATALOG[n.fact.factType];
        if (e.value === 'BOOLEAN' ? typeof n.value !== 'boolean' : e.value !== 'ENUM' || typeof n.value !== 'string' || ('domain' in e && e.domain && !e.domain.includes(n.value)))
          at(`EQUALS value is not in the domain of ${n.fact.factType}`);
      } else if (n.op === 'GTE' || n.op === 'LTE') {
        const dim = UNIT_DIMENSIONS[n.right.unit];
        if ('fact' in n.left) {
          const u = factUnit(n.left.fact);
          if (FACT_CATALOG[n.left.fact.factType].value !== 'DECIMAL' || !u || UNIT_DIMENSIONS[u] !== dim) at(`${n.right.unit} is not comparable with ${n.left.fact.factType}`);
        } else if ('count' in n.left) {
          if (n.right.unit !== 'count') at('COUNT compares with count');
          if (n.left.count.labels && !LABEL_FACT[n.left.count.kind]) at(`${n.left.count.kind} subjects have no label to count by`);
        } else {
          const { numerator, denominator } = n.left.ratio, un = factUnit(numerator), ud = factUnit(denominator);
          if (dim !== 'ratio' || !un || !ud || UNIT_DIMENSIONS[un] !== UNIT_DIMENSIONS[ud]) at('RATIO needs two facts of one dimension and a ratio threshold');
          if ([numerator, denominator].some(f => FACT_CATALOG[f.factType].precision === 'UPSTREAM_FLOAT')) at('RATIO over UPSTREAM_FLOAT facts is deferred (§10.1)');
        }
      }
    }
    for (const f of referencedFacts(r.requirement).concat(referencedFacts(r.applicability))) {
      const e = FACT_CATALOG[f.factType];
      if (!e.referable) at(`${f.factType} is not referable`);
      if (e.subject !== r.scope.kind && e.subject !== 'BUILDING') at(`${f.factType} is not defined for ${r.scope.kind}`);
      if ('parameter' in e && e.parameter ? itemUnit(f.parameter ?? '') === null : f.parameter !== null) at(`invalid parameter for ${f.factType}`);
    }
    const declared = r.requiredFacts.map(refKey), actual = requiredFacts(r.applicability, r.requirement).map(refKey);
    if (new Set(declared).size !== declared.length || declared.length !== actual.length || !actual.every(k => declared.includes(k))) at('requiredFacts must equal the referenced facts');
  }
  return out;
}
/** Preflight (bytes, nodes, depth) → strict schema → no defaults applied → semantic checks. Throws KNOWLEDGE_PACK_INVALID. */
export function validatePack(raw: unknown): KnowledgePack {
  try { bounded(raw, KNOWLEDGE_LIMITS.packBytes); }
  catch (error) { if (error instanceof BimError) throw new KnowledgeError('KNOWLEDGE_PACK_INVALID', `Pack preflight failed: ${error.message}`); throw error; }
  const parsed = PackSchema.safeParse(raw);
  if (!parsed.success) throw new KnowledgeError('KNOWLEDGE_PACK_INVALID', `Pack schema: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`);
  if (digest(parsed.data) !== digest(raw)) throw new KnowledgeError('KNOWLEDGE_PACK_INVALID', 'Pack must be written in canonical form');
  const found = issues(parsed.data);
  if (found.length) throw new KnowledgeError('KNOWLEDGE_PACK_INVALID', found.slice(0, 5).join('; '));
  return parsed.data;
}

// ---------------------------------------------------------------- bundled registry
/** Checksums are literal constants: digest(pack) must reproduce them at registration (design §14). */
const BUNDLED: readonly { pack: KnowledgePack; checksum: string }[] = [
  { pack: COORDINATION_PACK, checksum: 'b79bb8532683625eda9c14be6d82f25c7d6499a1302cbe1aa569d4764b0dcbe8' },
  { pack: DIMENSIONAL_PACK, checksum: '92af4b7f14f79c5bfa7963cb06460096e21e4449c17d1bd1feac0d9e6f22d249' },
];
let verified: Map<string, { pack: KnowledgePack; checksum: string }> | null = null;
function registry() {
  if (verified) return verified;
  const out = new Map<string, { pack: KnowledgePack; checksum: string }>();
  for (const entry of BUNDLED) {
    const pack = validatePack(entry.pack);
    if (digest(pack) !== entry.checksum) throw new KnowledgeError('KNOWLEDGE_PACK_INVALID', `Bundled pack ${pack.packId}@${pack.version} does not match its recorded checksum`);
    out.set(`${pack.packId}@${pack.version}`, { pack, checksum: entry.checksum });
  }
  return (verified = out);
}
export function bundledPack(packId: string, version: string) {
  const found = registry().get(`${packId}@${version}`);
  if (!found) throw new KnowledgeError('KNOWLEDGE_PACK_UNKNOWN', `Knowledge pack ${packId}@${version} is not bundled`);
  return found;
}
export const catalogEntries = (): CatalogEntry[] => [...registry().values()].map(({ pack: p, checksum }) => ({ packId: p.packId, version: p.version, title: p.title,
  disciplines: p.disciplines, publisher: p.publisher, jurisdiction: p.jurisdiction, edition: p.edition, effectiveDate: p.effectiveDate, sourceType: p.sourceType, license: p.license,
  checksum, ruleCount: p.rules.length })).sort((x, y) => x.packId < y.packId ? -1 : x.packId > y.packId ? 1 : x.version < y.version ? -1 : 1);
