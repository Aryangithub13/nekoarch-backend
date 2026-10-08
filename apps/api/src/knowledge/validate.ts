import { createHash } from 'node:crypto';
import { costHash } from '@designflow/boq-cost';
import { TAKEOFF_ENGINE_VERSION } from '@designflow/quantity-takeoff';
import { BIM_VERSION, type BimModel } from '../bim/contracts.js';
import { STRUCTURAL_MODEL_VERSION } from '../structural/contracts.js';
import { ENVIRONMENTAL_MODEL_VERSION } from '../environmental/contracts.js';
import { SYSTEMS_MODEL_VERSION } from '../systems/contracts.js';
import { CLAIMS, ENGINE, FACTS_VERSION, KNOWLEDGE_MODEL_VERSION, FACT_CATALOG, FLOAT_BOUNDARY_ULPS, FLOAT_POLICY, KNOWLEDGE_ANALYSIS_VERSION, LABEL_FACT, MODEL_VALIDATOR, PRECISIONS, RESULT_VALIDATOR,
  STATUSES, SUBJECT_SOURCE, itemUnit, type Conflict, type Evaluation, type Fact, type FactRef, type FactSet, type FactType, type KnowledgeBinding, type KnowledgePack,
  type KnowledgeResult, type ModelValidation, type Predicate, type Reason, type ResultValidation, type Rule, type Source, type Status, type Subject, type SubjectKind,
  type Trace, type Truth, type Unit, type Upstream } from './contracts.js';

/*
 * Independent validator (design §16). It must NOT import facts.ts, evaluate.ts, conflicts.ts or units.ts (release gate G-indep).
 * Every authoritative decision is recomputed here with separate arithmetic, unit, ULP, truth-table, label and conflict code,
 * then compared field by field with the untrusted evaluator output.
 */

// ---------------------------------------------------------------- exact numbers (own implementation)
type N = { n: bigint; d: bigint };
function norm(n: bigint, d: bigint): N {
  if (d === 0n) throw new RangeError('division by zero');
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n, b = d;
  while (b !== 0n) { const t = a % b; a = b; b = t; }
  return a === 0n ? { n: 0n, d: 1n } : { n: n / a, d: d / a };
}
const times = (x: N, y: N) => norm(x.n * y.n, x.d * y.d);
const over = (x: N, y: N) => norm(x.n * y.d, x.d * y.n);
const minus = (x: N, y: N) => norm(x.n * y.d - y.n * x.d, x.d * y.d);
const sign = (x: N, y: N) => { const v = x.n * y.d - y.n * x.d; return v === 0n ? 0 : v > 0n ? 1 : -1; };
const magnitude = (x: N): N => ({ n: x.n < 0n ? -x.n : x.n, d: x.d });
function read(text: string): N {
  const slash = text.indexOf('/');
  if (slash > 0) return norm(BigInt(text.slice(0, slash)), BigInt(text.slice(slash + 1)));
  const [mantissa, exp = '0'] = text.toLowerCase().split('e');
  const negative = mantissa!.startsWith('-'), body = negative ? mantissa!.slice(1) : mantissa!;
  const [whole, frac = ''] = body.split('.');
  if (!/^\d+$/.test(whole!) || !/^\d*$/.test(frac) || !/^[+-]?\d+$/.test(exp)) throw new RangeError(`not a number: ${text}`);
  const scale = BigInt(exp) - BigInt(frac.length), digits = BigInt(whole! + frac) * (negative ? -1n : 1n);
  return scale >= 0n ? norm(digits * 10n ** scale, 1n) : norm(digits, 10n ** -scale);
}
function render(x: N): string {
  let rest = x.d;
  for (const p of [2n, 5n]) while (rest % p === 0n) rest /= p;
  if (rest !== 1n) return `${x.n}/${x.d}`;
  let places = 0, pow = 1n;
  while (pow % x.d !== 0n) { places++; pow *= 10n; }
  const scaled = x.n * (pow / x.d), neg = scaled < 0n, digits = (neg ? -scaled : scaled).toString();
  if (!places) return (neg ? '-' : '') + digits;
  const padded = digits.padStart(places + 1, '0');
  return `${neg ? '-' : ''}${padded.slice(0, padded.length - places)}.${padded.slice(padded.length - places)}`;
}
const bits = (v: bigint) => v === 0n ? 0 : v.toString(2).length;
/** binary64 spacing at x: exponent from bit lengths, then one correction step (§10.1). */
function spacing(x: N): N {
  const m = magnitude(x);
  if (m.n === 0n) return norm(1n, 2n ** 1074n);
  let e = bits(m.n) - bits(m.d);
  const below = e >= 0 ? m.n < m.d * 2n ** BigInt(e) : m.n * 2n ** BigInt(-e) < m.d;
  if (below) e -= 1;
  const k = Math.max(e, -1022) - 52;
  return k >= 0 ? norm(2n ** BigInt(k), 1n) : norm(1n, 2n ** BigInt(-k));
}
const SCALE: Record<Unit, string> = { mm: '1', m: '1000', mm2: '1', m2: '1000000', mm3: '1', m3: '1000000000', W: '1', kW: '1000', VA: '1', kVA: '1000',
  'L/s': '1', 'm3/s': '1000', 'm/s': '1', '1': '1', '%': '1/100', count: '1', MONEY: '1' };
const BASE: Record<Unit, Unit> = { mm: 'mm', m: 'mm', mm2: 'mm2', m2: 'mm2', mm3: 'mm3', m3: 'mm3', W: 'W', kW: 'W', VA: 'VA', kVA: 'VA', 'L/s': 'L/s', 'm3/s': 'L/s',
  'm/s': 'm/s', '1': '1', '%': '1', count: 'count', MONEY: 'MONEY' };
const inBase = (x: N, u: Unit) => times(x, read(SCALE[u]));

// ---------------------------------------------------------------- canonical comparison helpers
const canon = (v: unknown): string => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).filter(k => (v as Record<string, unknown>)[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`
  : JSON.stringify(v);
type Diagnostic = { code: string; path: string; message: string };
function diff(out: Diagnostic[], code: string, path: string, expected: unknown, actual: unknown) {
  if (canon(expected) === canon(actual)) return;
  if (Array.isArray(expected) && Array.isArray(actual) && expected.length === actual.length) {
    for (let i = 0; i < expected.length && out.length < 200; i++) diff(out, code, `${path}/${i}`, expected[i], actual[i]);
    return;
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object' && !Array.isArray(expected) && !Array.isArray(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const k of keys) if (out.length < 200) diff(out, code, `${path}/${k}`, (expected as Record<string, unknown>)[k], (actual as Record<string, unknown>)[k]);
    return;
  }
  if (out.length < 200) out.push({ code, path: path.slice(0, 300), message: `expected ${canon(expected).slice(0, 120)} got ${canon(actual).slice(0, 120)}`.slice(0, 300) });
}
const sha40 = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 40);
const byText = (a: string, b: string) => (a > b ? 1 : 0) - (a < b ? 1 : 0);

// ---------------------------------------------------------------- independent fact derivation
function deriveFacts(bim: BimModel, up: Upstream, binding: KnowledgeBinding): FactSet {
  const list: Fact[] = [], rev = binding.revisionId;
  const src = (artifactType: Fact['source']['artifactType'], artifactId: string, engineVersion: string, inputHash: string | null) =>
    (pointer: string): Fact['source'] => ({ artifactType, artifactId, revisionId: rev, modelHash: binding.modelHash, engineVersion, inputHash, pointer });
  const add = (factType: FactType, subject: Subject, value: Fact['value'], source: Fact['source'], method: Fact['derivation']['method'] = 'DIRECT', inputs: string[] = [],
    parameter: string | null = null) => list.push({ factId: `fact-${sha40([factType, parameter, subject.kind, subject.id])}`, factType, parameter, subject,
    status: value === null ? 'ABSENT' : 'PRESENT', value, precision: FACT_CATALOG[factType].precision!, source, derivation: { method, inputs } });
  const num = (x: N, unit: Unit): Fact['value'] => ({ kind: 'DECIMAL', exact: render(x), unit });
  const whole = (v: number, unit: Unit) => num(norm(BigInt(v), 1n), unit);
  const stored = (v: number, unit: Unit) => num(read(String(v)), unit);
  const A = src('ARCHITECTURE_REVISION', rev, BIM_VERSION, null), QT = src('BIM_QUANTITY_TAKEOFF', rev, TAKEOFF_ENGINE_VERSION, null), g = bim.geometry;
  const B: Subject = { kind: 'BUILDING', id: 'building', label: null };

  const storeyIdx: number[] = [];
  g.levels.forEach((l, i) => { if (l.kind === 'storey') storeyIdx.push(i); });
  add('ARCH_STOREY_COUNT', B, whole(storeyIdx.length, 'count'), A('/geometry/levels'), 'COUNT');
  let top: number | null = null, bottom: number | null = null, missingHeight = storeyIdx.length === 0;
  for (const i of storeyIdx) {
    const l = g.levels[i]!;
    if (l.floorToFloorHeightMm === null) { missingHeight = true; continue; }
    top = top === null ? l.elevationMm + l.floorToFloorHeightMm : Math.max(top, l.elevationMm + l.floorToFloorHeightMm);
    bottom = bottom === null ? l.elevationMm : Math.min(bottom, l.elevationMm);
  }
  add('ARCH_BUILDING_HEIGHT', B, missingHeight ? null : whole(top! - bottom!, 'mm'), A('/geometry/levels'), 'DIFFERENCE',
    storeyIdx.flatMap(i => [`/geometry/levels/${i}/elevationMm`, `/geometry/levels/${i}/floorToFloorHeightMm`]));
  g.levels.forEach((l, i) => {
    const s: Subject = { kind: 'LEVEL', id: l.id, label: null };
    add('ARCH_LEVEL_ELEVATION', s, whole(l.elevationMm, 'mm'), A(`/geometry/levels/${i}/elevationMm`));
    add('ARCH_FLOOR_TO_FLOOR_HEIGHT', s, l.floorToFloorHeightMm === null ? null : whole(l.floorToFloorHeightMm, 'mm'), A(`/geometry/levels/${i}/floorToFloorHeightMm`));
  });
  const spaces = new Map<string, Subject>();
  g.spaces.forEach((sp, i) => {
    const s: Subject = { kind: 'SPACE', id: sp.id, label: sp.classification }, ring = sp.boundary;
    spaces.set(sp.id, s);
    let twice = 0n;
    for (let k = 0; k < ring.length; k++) { const p = ring[k]!, q = ring[(k + 1) % ring.length]!; twice += BigInt(p.x) * BigInt(q.z) - BigInt(q.x) * BigInt(p.z); }
    add('ARCH_SPACE_CLASSIFICATION', s, { kind: 'LABEL', value: sp.classification }, A(`/geometry/spaces/${i}/classification`));
    add('ARCH_SPACE_AREA', s, num(norm(twice < 0n ? -twice : twice, 2n), 'mm2'), A(`/geometry/spaces/${i}/boundary`), 'POLYGON_AREA', [`/geometry/spaces/${i}/boundary`]);
    const levelWallsKnown = !g.walls.some(w => w.levelId === sp.levelId && !w.spaceIds);
    const hosted: number[] = [];
    let area = 0n;
    g.openings.forEach((o, k) => {
      if (o.kind !== 'window') return;
      const host = g.walls.find(w => w.id === o.wallId);
      if (host?.spaceIds?.includes(sp.id)) { hosted.push(k); area += BigInt(o.widthMm) * BigInt(o.heightMm); }
    });
    add('ARCH_SPACE_WINDOW_AREA', s, levelWallsKnown ? num(norm(area, 1n), 'mm2') : null, A(`/geometry/spaces/${i}`), 'SUM', hosted.map(k => `/geometry/openings/${k}`));
    add('ARCH_SPACE_OCCUPANCY', s, typeof sp.occupancy === 'number' ? whole(sp.occupancy, 'count') : null, A(`/geometry/spaces/${i}/occupancy`));
  });
  g.openings.forEach((o, i) => {
    const s: Subject = { kind: 'OPENING', id: o.id, label: o.kind }, at = `/geometry/openings/${i}`;
    add('ARCH_OPENING_KIND', s, { kind: 'LABEL', value: o.kind }, A(`${at}/kind`));
    add('ARCH_OPENING_WIDTH', s, whole(o.widthMm, 'mm'), A(`${at}/widthMm`));
    add('ARCH_OPENING_HEIGHT', s, whole(o.heightMm, 'mm'), A(`${at}/heightMm`));
    add('ARCH_OPENING_SILL', s, whole(o.sillMm, 'mm'), A(`${at}/sillMm`));
    add('ARCH_OPENING_IS_SITE_ENTRY', s, { kind: 'BOOLEAN', value: g.site !== null && g.site.primaryEntryOpeningId === o.id },
      A(g.site === null ? '/geometry/site' : '/geometry/site/primaryEntryOpeningId'), 'EQUALITY', [`${at}/id`]);
  });
  g.stairs.forEach((st, i) => {
    const s: Subject = { kind: 'STAIR', id: st.id, label: null }, at = `/geometry/stairs/${i}`;
    add('ARCH_STAIR_WIDTH', s, whole(st.widthMm, 'mm'), A(`${at}/widthMm`));
    add('ARCH_STAIR_TREAD_DEPTH', s, whole(st.treadDepthMm, 'mm'), A(`${at}/treadDepthMm`));
    add('ARCH_STAIR_MAX_RISER', s, whole(st.riserHeightsMm.reduce((m, r) => r > m ? r : m, 0), 'mm'), A(`${at}/riserHeightsMm`), 'MAX', [`${at}/riserHeightsMm`]);
    add('ARCH_STAIR_RISER_COUNT', s, whole(st.riserHeightsMm.length, 'count'), A(`${at}/riserHeightsMm`), 'COUNT', [`${at}/riserHeightsMm`]);
    add('ARCH_STAIR_HEADROOM', s, typeof st.headroomMm === 'number' ? whole(st.headroomMm, 'mm') : null, A(`${at}/headroomMm`));
  });
  bim.quantities.summary.totals.forEach((t, k) => add('QUANTITY_TOTAL', B, t.status === 'EVALUATED' ? num(read(t.quantity.value), itemUnit(t.itemCode)!) : null,
    QT(`/quantities/summary/totals/${k}/quantity/value`), 'DIRECT', [], t.itemCode));
  const spaceOf = (id: string) => { const s = spaces.get(id); if (!s) throw new RangeError(`unknown space ${id}`); return s; };

  if (up.structural) {
    const sn = up.structural.snapshot, S = src('STRUCTURAL_ANALYSIS', up.structural.analysisId, sn.version, up.structural.inputHash);
    sn.model.members.forEach((m, i) => {
      const s: Subject = { kind: 'STRUCTURAL_MEMBER', id: m.requestKey, label: m.kind };
      let k = -1; sn.model.sections.forEach((x, j) => { if (k < 0 && x.id === m.sectionId) k = j; });
      const dims = k >= 0 ? sn.model.sections[k]!.dimensions : null;
      add('STRUCT_MEMBER_KIND', s, { kind: 'LABEL', value: m.kind }, S(`/model/members/${i}/kind`));
      add('STRUCT_SECTION_WIDTH', s, dims ? stored(dims.width.value, 'mm') : null, S(dims ? `/model/sections/${k}/dimensions/width/value` : `/model/sections/${k}/dimensions`));
      add('STRUCT_SECTION_DEPTH', s, dims ? stored(dims.depth.value, 'mm') : null, S(dims ? `/model/sections/${k}/dimensions/depth/value` : `/model/sections/${k}/dimensions`));
      add('STRUCT_MEMBER_LENGTH', s, stored(m.quantities.length.value, 'mm'), S(`/model/members/${i}/quantities/length/value`));
    });
  }
  if (up.environmental) {
    const sn = up.environmental.snapshot, E = src('ENVIRONMENTAL_ANALYSIS', up.environmental.analysisId, sn.version, up.environmental.inputHash);
    add('ENV_ENVELOPE_STATUS', B, { kind: 'ENUM', value: sn.model.envelope.status }, E('/model/envelope/status'));
    const zoneSpace = new Map(sn.model.zones.map(z => [z.id, z.source.id]));
    sn.model.zones.forEach((z, i) => add('ENV_ZONE_FLOOR_AREA', spaceOf(z.source.id), stored(z.floorArea.value, 'm2'), E(`/model/zones/${i}/floorArea/value`)));
    sn.results.daylightIndicator.zones.forEach((z, i) => add('ENV_WINDOW_TO_FLOOR_RATIO', spaceOf(zoneSpace.get(z.zoneId) ?? z.zoneId), stored(z.ratio.value, '1'),
      E(`/results/daylightIndicator/zones/${i}/ratio/value`)));
    sn.results.thermal.cases.forEach((c, i) => add('ENV_TRANSMISSION_TOTAL', { kind: 'THERMAL_CASE', id: c.key, label: null },
      c.status === 'ANALYZED' ? stored(c.total.value, 'W') : null, E(`/results/thermal/cases/${i}/total/value`)));
  }
  if (up.systems) {
    const sn = up.systems.snapshot, r = sn.results, Y = src('SYSTEMS_ANALYSIS', up.systems.analysisId, sn.version, up.systems.inputHash);
    r.lifeSafety.spaces.forEach((e, i) => {
      const s = spaceOf(e.spaceId), at = `/results/lifeSafety/spaces/${i}`;
      add('SYS_EGRESS_DISTANCE', s, e.distance ? stored(e.distance.value, 'mm') : null, Y(e.distance ? `${at}/distance/value` : `${at}/distance`));
      add('SYS_EGRESS_REACHABLE', s, { kind: 'BOOLEAN', value: e.reachable }, Y(`${at}/reachable`));
      add('SYS_DISTINCT_EXITS_REACHABLE', s, whole(e.distinctExitsReachable, 'count'), Y(`${at}/distinctExitsReachable`));
    });
    const order: string[] = [], groups: Record<string, number[]> = {};
    r.lifeSafety.deadEnds.forEach((e, i) => { if (!groups[e.spaceId]) { groups[e.spaceId] = []; order.push(e.spaceId); } groups[e.spaceId]!.push(i); });
    for (const id of order) {
      const idx = groups[id]!;
      let best = read(String(r.lifeSafety.deadEnds[idx[0]!]!.length.value));
      for (const i of idx.slice(1)) { const v = read(String(r.lifeSafety.deadEnds[i]!.length.value)); if (sign(v, best) > 0) best = v; }
      const ptrs = idx.map(i => `/results/lifeSafety/deadEnds/${i}/length/value`);
      add('SYS_DEAD_END_LENGTH', spaceOf(id), num(best, 'mm'), Y(idx.length === 1 ? ptrs[0]! : '/results/lifeSafety/deadEnds'), idx.length === 1 ? 'DIRECT' : 'MAX', idx.length === 1 ? [] : ptrs);
    }
    add('SYS_EGRESS_AVAILABLE', B, typeof r.lifeSafety.egressAvailable === 'boolean' ? { kind: 'BOOLEAN', value: r.lifeSafety.egressAvailable } : null, Y('/results/lifeSafety/egressAvailable'));
    add('SYS_PENETRATION_COUNT', B, whole(r.coordination.penetrations.length, 'count'), Y('/results/coordination/penetrations'), 'COUNT', ['/results/coordination/penetrations']);
    add('SYS_BLOCKING_CLASH_COUNT', B, whole(r.coordination.blocking, 'count'), Y('/results/coordination/blocking'));
    const tot = r.electrical.total;
    add('SYS_ELECTRICAL_CONNECTED_W', B, tot === null ? null : num(read(tot.connected.W.exact), 'W'), Y(tot === null ? '/results/electrical/total' : '/results/electrical/total/connected/W/exact'));
    const dem = tot !== null && tot.demand.status === 'EVALUATED' && tot.demand.W !== null ? tot.demand.W : null;
    add('SYS_ELECTRICAL_DEMAND_W', B, dem === null ? null : num(read(dem.exact), 'W'),
      Y(dem !== null ? '/results/electrical/total/demand/W/exact' : tot !== null ? '/results/electrical/total/demand' : '/results/electrical/total'));
    r.networks.forEach((n, k) => {
      let mi = -1; sn.model.networks.forEach((x, j) => { if (x.id === n.networkId) mi = j; });
      if (mi < 0) throw new RangeError(`unknown network ${n.networkId}`);
      const net = sn.model.networks[mi]!, s: Subject = { kind: 'MEP_NETWORK', id: net.key, label: net.system }, at = `/results/networks/${k}`;
      add('SYS_NETWORK_SYSTEM', s, { kind: 'LABEL', value: net.system }, Y(`/model/networks/${mi}/system`));
      add('SYS_NETWORK_STATUS', s, { kind: 'ENUM', value: n.status }, Y(`${at}/status`));
      add('SYS_NETWORK_LENGTH', s, stored(n.length.value, 'mm'), Y(`${at}/length/value`));
      if (n.drainage !== null) add('SYS_DRAINAGE_SLOPE', s, num(norm(BigInt(n.drainage.slope.rise), BigInt(n.drainage.slope.run)), '1'), Y(`${at}/drainage/slope`), 'QUOTIENT',
        [`${at}/drainage/slope/rise`, `${at}/drainage/slope/run`]);
      if (n.airflow !== null) {
        const segs = n.airflow.segments, complete = segs.length > 0 && !segs.some(x => x.velocity === null);
        let best: N | null = null;
        if (complete) for (const x of segs) { const v = read(x.velocity!.exact); if (best === null || sign(v, best) > 0) best = v; }
        add('SYS_DUCT_MAX_VELOCITY', s, best === null ? null : num(best, 'm/s'), Y(`${at}/airflow/segments`), complete ? 'MAX' : 'DIRECT', complete ? [`${at}/airflow/segments`] : []);
      }
    });
    r.verticalTransport.elevators.forEach((e, k) => {
      const s: Subject = { kind: 'ELEVATOR', id: e.key, label: null }, at = `/results/verticalTransport/elevators/${k}`;
      add('SYS_ELEVATOR_STATUS', s, { kind: 'ENUM', value: e.status }, Y(`${at}/status`));
      add('SYS_ELEVATOR_VERTICAL_ACCESS', s, { kind: 'ENUM', value: e.verticalAccess }, Y(`${at}/verticalAccess`));
      add('SYS_ELEVATOR_DOOR_WIDTH', s, whole(e.door.widthMm, 'mm'), Y(`${at}/door/widthMm`));
      const sh = e.shaft;
      add('SYS_ELEVATOR_SHAFT_WIDTH', s, sh ? whole(sh.maxX - sh.minX, 'mm') : null, Y(`${at}/shaft`), sh ? 'BOUNDS_EXTENT' : 'DIRECT', sh ? [`${at}/shaft/minX`, `${at}/shaft/maxX`] : []);
      add('SYS_ELEVATOR_SHAFT_DEPTH', s, sh ? whole(sh.maxZ - sh.minZ, 'mm') : null, Y(`${at}/shaft`), sh ? 'BOUNDS_EXTENT' : 'DIRECT', sh ? [`${at}/shaft/minZ`, `${at}/shaft/maxZ`] : []);
    });
  }
  list.sort((x, y) => byText(x.factId, y.factId));
  const tally = { ARCHITECTURE: 0, STRUCTURAL: 0, ENVIRONMENTAL: 0, SYSTEMS: 0 };
  let present = 0;
  for (const f of list) { tally[FACT_CATALOG[f.factType].source] += 1; if (f.status === 'PRESENT') present += 1; }
  return { version: FACTS_VERSION, items: list, summary: { present, absent: list.length - present, bySource: tally } };
}

/** §14.1 recomputed: same project/revision/architecture, identities agree, nested references agree. */
function upstreamDiagnostics(binding: KnowledgeBinding, up: Upstream): Diagnostic[] {
  const out: Diagnostic[] = [];
  const check = (name: 'structural' | 'environmental' | 'systems', versionKey: string) => {
    const x = up[name], b = binding[name];
    if (!x || !b) { if (!!x !== !!b) out.push({ code: 'TRANSITIVE_UPSTREAM_BINDING_CONSISTENCY', path: `/binding/${name}`, message: 'bound source and supplied snapshot disagree' }); return; }
    const sb = x.snapshot.binding as Record<string, unknown>;
    const fields: [string, unknown, unknown][] = [['projectId', sb.projectId, binding.projectId], ['revisionId', sb.revisionId, binding.revisionId], ['modelHash', sb.modelHash, binding.modelHash],
      ['modelVersion', sb[versionKey], b.modelVersion], ['inputHash', x.snapshot.inputHash, b.inputHash], ['analysisId', x.analysisId, b.analysisId], ['rowInputHash', x.inputHash, b.inputHash]];
    for (const [f, got, want] of fields) if (got !== want) out.push({ code: 'TRANSITIVE_UPSTREAM_BINDING_CONSISTENCY', path: `/binding/${name}/${f}`, message: `${name}.${f} mismatch` });
  };
  check('structural', 'structuralModelVersion'); check('environmental', 'environmentalModelVersion'); check('systems', 'systemsModelVersion');
  if (up.systems) for (const nested of ['structural', 'environmental'] as const) {
    const n = up.systems.snapshot.binding[nested], b = binding[nested];
    if (n && b && canon(n) !== canon({ analysisId: b.analysisId, inputHash: b.inputHash, modelVersion: b.modelVersion }))
      out.push({ code: 'TRANSITIVE_UPSTREAM_BINDING_CONSISTENCY', path: `/binding/systems/${nested}`, message: `systems references a different ${nested} analysis` });
  }
  return out;
}

/** The binding rebuilt from its sources (design §14), never copied from the evaluator side. */
function expectedBinding(bim: BimModel, up: Upstream, selection: { packs: { packId: string; version: string; checksum: string }[]; disciplines: string[] }): KnowledgeBinding {
  const id = <V extends string>(x: { analysisId: string; inputHash: string } | null, modelVersion: V) => x === null ? null : { analysisId: x.analysisId, inputHash: x.inputHash, modelVersion };
  return { projectId: bim.binding.projectId, revisionId: bim.binding.revisionId, modelHash: bim.binding.modelHash, generatorVersion: bim.binding.generatorVersion,
    generationId: bim.binding.generationId, requirementsHash: bim.binding.requirementsHash, parameterHash: bim.binding.parameterHash, bimVersion: BIM_VERSION,
    knowledgeModelVersion: KNOWLEDGE_MODEL_VERSION, structural: id(up.structural, STRUCTURAL_MODEL_VERSION), environmental: id(up.environmental, ENVIRONMENTAL_MODEL_VERSION),
    systems: id(up.systems, SYSTEMS_MODEL_VERSION), engine: { knowledgeEngine: ENGINE.knowledgeEngine, factExtractor: ENGINE.factExtractor, ruleEvaluator: ENGINE.ruleEvaluator,
      conflictDetector: ENGINE.conflictDetector, units: ENGINE.units, floatPolicy: ENGINE.floatPolicy },
    packs: selection.packs.map(p => ({ packId: p.packId, version: p.version, checksum: p.checksum })).sort((a, b) => byText(a.packId, b.packId)),
    disciplines: [...selection.disciplines].sort(byText) as KnowledgeBinding['disciplines'] };
}
export function validateKnowledgeModel(facts: FactSet, bim: BimModel, up: Upstream, binding: KnowledgeBinding,
  selection: { packs: { packId: string; version: string; checksum: string }[]; disciplines: string[] }): ModelValidation {
  const out: Diagnostic[] = [], expected = expectedBinding(bim, up, selection);
  diff(out, 'BINDING', '/binding', expected, binding);
  out.push(...upstreamDiagnostics(expected, up));
  try {
    const derived = deriveFacts(bim, up, expected);
    if (derived.items.length !== facts.items.length) out.push({ code: 'FACTS', path: '/facts/items', message: `expected ${derived.items.length} facts, got ${facts.items.length}` });
    diff(out, 'FACTS', '/facts', derived, facts);
  } catch (error) { out.push({ code: 'FACTS', path: '/facts', message: (error as Error).message.slice(0, 300) }); }
  return { validator: MODEL_VALIDATOR, status: out.length ? 'INVALID' : 'VALID', diagnostics: out.slice(0, 200) };
}

// ---------------------------------------------------------------- independent rule evaluation
const RANK: Record<Truth, number> = { T: 0, F: 0, R: 1, I: 2, E: 3 };
const strongest = (xs: Truth[]) => xs.reduce((a, b) => RANK[b] > RANK[a] ? b : a);
/** Strong Kleene over {T,F} with unknown precedence E > I > R (§8), computed rather than tabulated. */
export const algebra = {
  all: (xs: Truth[]): Truth => xs.includes('F') ? 'F' : xs.every(x => x === 'T') ? 'T' : strongest(xs.filter(x => x !== 'T')),
  any: (xs: Truth[]): Truth => xs.includes('T') ? 'T' : xs.every(x => x === 'F') ? 'F' : strongest(xs.filter(x => x !== 'F')),
  not: (x: Truth): Truth => x === 'T' ? 'F' : x === 'F' ? 'T' : x,
};
const fold = (x: string) => x.normalize('NFKC').split(/\s+/u).filter(Boolean).join(' ').toLowerCase();
const RESULT: Record<Truth, Status> = { T: 'MEETS_RULE', F: 'DOES_NOT_MEET_RULE', R: 'REVIEW_REQUIRED', I: 'INPUT_INCOMPLETE', E: 'NOT_EVALUATED' };
const PRECISION_RANK = Object.fromEntries(PRECISIONS.map((p, i) => [p, i])) as Record<string, number>;

type Env = { index: Map<string, Fact>; kinds: Map<SubjectKind, Subject[]>; seen: Set<string>; integer: boolean; gaps: Map<string, { factType: FactType; parameter: string | null; subject: Subject }> };
const factIndex = (t: FactType, p: string | null, s: Subject) => [t, p ?? '', s.kind, s.id].join('|');
function selector(label: string | null, wanted: string[] | null): 'IN' | 'NEAR' | 'OUT' {
  if (wanted === null) return 'IN';
  if (label === null) return 'OUT';
  for (const w of wanted) if (w === label) return 'IN';
  for (const w of wanted) if (fold(w) === fold(label)) return 'NEAR';
  return 'OUT';
}
function find(env: Env, r: FactRef, subject: Subject, gap: boolean) {
  const owner: Subject = FACT_CATALOG[r.factType].subject === 'BUILDING' ? { kind: 'BUILDING', id: 'building', label: null } : subject;
  const f = env.index.get(factIndex(r.factType, r.parameter, owner));
  if (f) env.seen.add(f.factId);
  if (gap && (!f || f.status !== 'PRESENT')) env.gaps.set(factIndex(r.factType, r.parameter, owner), { factType: r.factType, parameter: r.parameter, subject: owner });
  return f && f.status === 'PRESENT' ? { f, ok: f } : { f, ok: null };
}
const observedOf = (f: Fact) => ({ value: f.value === null ? null : f.value.kind === 'DECIMAL' ? f.value.exact : String(f.value.value),
  unit: f.value !== null && f.value.kind === 'DECIMAL' ? f.value.unit : null, factId: f.factId, precision: f.precision });
function judge(p: Predicate, subject: Subject, env: Env): Trace {
  const t = (status: Truth, reason: Reason | null, extra: Partial<Trace> = {}): Trace =>
    ({ op: p.op, status, reason, observed: null, threshold: null, comparison: null, basis: null, children: [], ...extra });
  if (p.op === 'MANUAL_REVIEW') return t('R', 'MANUAL_REVIEW');
  if (p.op === 'NOT') { const c = judge(p.of, subject, env); return t(algebra.not(c.status), null, { children: [c] }); }
  if (p.op === 'ALL' || p.op === 'ANY') { const cs = p.of.map(c => judge(c, subject, env)); return t(algebra[p.op === 'ALL' ? 'all' : 'any'](cs.map(c => c.status)), null, { children: cs }); }
  if (p.op === 'EXISTS') { const { f, ok } = find(env, p.fact, subject, false); return t(ok ? 'T' : 'F', null, { observed: f ? observedOf(f) : null }); }
  if (p.op === 'EQUALS') {
    const { f, ok } = find(env, p.fact, subject, true), want = String(p.value), threshold = { literal: want, unit: null, normalized: want, canonicalUnit: null };
    if (!ok || ok.value === null || ok.value.kind === 'DECIMAL') return t('I', 'MISSING_FACT', { observed: f ? observedOf(f) : null, threshold });
    return t(ok.value.value === p.value ? 'T' : 'F', null, { observed: observedOf(ok), threshold, comparison: `${String(ok.value.value)} == ${want}` });
  }
  const c = p as Extract<Predicate, { op: 'GTE' | 'LTE' }>;
  const limit = inBase(read(c.right.decimal), c.right.unit), rel = c.op === 'GTE' ? '>=' : '<=';
  const threshold = { literal: c.right.decimal, unit: c.right.unit, normalized: render(limit), canonicalUnit: BASE[c.right.unit] };
  const verdict = (v: N): Truth => { const s = sign(v, limit); return (c.op === 'GTE' ? s >= 0 : s <= 0) ? 'T' : 'F'; };
  const text = (v: N) => `${render(v)} ${rel} ${render(limit)}`;
  if ('count' in c.left) {
    let n = 0, near = false;
    for (const s of env.kinds.get(c.left.count.kind) ?? []) { const m = selector(s.label, c.left.count.labels); n += m === 'IN' ? 1 : 0; near ||= m === 'NEAR'; }
    env.integer = true;
    const v = norm(BigInt(n), 1n);
    return t(near ? 'R' : verdict(v), near ? 'LABEL_NEAR_MATCH' : null, { observed: { value: render(v), unit: 'count', factId: null, precision: 'EXACT_INTEGER' }, threshold, comparison: text(v) });
  }
  if ('ratio' in c.left) {
    const a = find(env, c.left.ratio.numerator, subject, true).ok, b = find(env, c.left.ratio.denominator, subject, true).ok;
    if (!a || !b || a.value?.kind !== 'DECIMAL' || b.value?.kind !== 'DECIMAL') return t('I', 'MISSING_FACT', { threshold });
    const den = inBase(read(b.value.exact), b.value.unit);
    if (den.n === 0n) return t('E', 'RATIO_ZERO_DENOMINATOR', { threshold });
    const v = over(inBase(read(a.value.exact), a.value.unit), den);
    const precision = PRECISION_RANK[a.precision]! <= PRECISION_RANK[b.precision]! ? a.precision : b.precision;
    return t(verdict(v), null, { observed: { value: render(v), unit: '1', factId: null, precision }, threshold, comparison: text(v) });
  }
  const { f, ok } = find(env, c.left.fact, subject, true);
  if (!ok || ok.value?.kind !== 'DECIMAL') return t('I', 'MISSING_FACT', { observed: f ? observedOf(f) : null, threshold });
  const raw = read(ok.value.exact), v = inBase(raw, ok.value.unit);
  if (ok.precision !== 'UPSTREAM_FLOAT') return t(verdict(v), null, { observed: observedOf(ok), threshold, comparison: text(v) });
  const scale = read(SCALE[ok.value.unit]), ulp = times(spacing(raw), scale), band = times(norm(BigInt(FLOAT_BOUNDARY_ULPS), 1n), ulp), gap = magnitude(minus(v, limit));
  const basis = { policy: FLOAT_POLICY as typeof FLOAT_POLICY, ulps: String(FLOAT_BOUNDARY_ULPS), ulp: render(ulp), band: render(band), diff: render(gap) };
  const ambiguous = sign(gap, band) <= 0;
  return t(ambiguous ? 'R' : verdict(v), ambiguous ? 'FLOAT_BOUNDARY_AMBIGUITY' : null, { observed: observedOf(ok), threshold, comparison: text(v), basis });
}
function firstReason(trace: Trace | null, status: Truth): Reason | null {
  if (!trace) return null;
  if (trace.status === status && trace.reason) return trace.reason;
  for (const c of trace.children) { const r = firstReason(c, status); if (r) return r; }
  return null;
}
function counted(p: Predicate | null, acc: SubjectKind[] = []): SubjectKind[] {
  if (!p) return acc;
  if ((p.op === 'GTE' || p.op === 'LTE') && 'count' in p.left) acc.push(p.left.count.kind);
  if (p.op === 'ALL' || p.op === 'ANY') p.of.forEach(c => counted(c, acc));
  if (p.op === 'NOT') counted(p.of, acc);
  return acc;
}

// ---------------------------------------------------------------- independent conflict recomputation
type Interval = { lo: N | null; loIn: boolean; hi: N | null; hiIn: boolean };
type Shape = { key: string; factType: FactType; parameter: string | null; interval?: Interval; only?: string[] | null; not?: string[] };
function shape(p: Predicate): Shape | null {
  const inner = p.op === 'NOT' ? p.of : p, negate = p.op === 'NOT';
  if (inner.op === 'GTE' || inner.op === 'LTE') {
    const c = inner as Extract<Predicate, { op: 'GTE' | 'LTE' }>;
    if (!('fact' in c.left)) return null;
    const v = inBase(read(c.right.decimal), c.right.unit), head = { key: `F|${c.left.fact.factType}|${c.left.fact.parameter ?? ''}`, factType: c.left.fact.factType,
      parameter: c.left.fact.parameter };
    const atLeast = (c.op === 'GTE') !== negate; // GTE or NOT(LTE) bound from below
    const inclusive = !negate;
    return { ...head, interval: atLeast ? { lo: v, loIn: inclusive, hi: null, hiIn: false } : { lo: null, loIn: false, hi: v, hiIn: inclusive } };
  }
  if (inner.op === 'EQUALS') {
    const e = inner as Extract<Predicate, { op: 'EQUALS' }>;
    const head = { key: `F|${e.fact.factType}|${e.fact.parameter ?? ''}`, factType: e.fact.factType, parameter: e.fact.parameter };
    return negate ? { ...head, only: null, not: [String(e.value)] } : { ...head, only: [String(e.value)], not: [] };
  }
  if (p.op === 'ALL') {
    let acc: Shape | null = null;
    for (const c of p.of) {
      const s = shape(c);
      if (!s || (acc && (acc.key !== s.key || !!acc.interval !== !!s.interval))) return null;
      acc = acc ? meet(acc, s) : s;
    }
    return acc;
  }
  return null;
}
function meet(a: Shape, b: Shape): Shape {
  if (a.interval && b.interval) {
    const x = a.interval, y = b.interval;
    const lo = !x.lo ? { v: y.lo, i: y.loIn } : !y.lo ? { v: x.lo, i: x.loIn } : sign(x.lo, y.lo) !== 0 ? (sign(x.lo, y.lo) > 0 ? { v: x.lo, i: x.loIn } : { v: y.lo, i: y.loIn }) : { v: x.lo, i: x.loIn && y.loIn };
    const hi = !x.hi ? { v: y.hi, i: y.hiIn } : !y.hi ? { v: x.hi, i: x.hiIn } : sign(x.hi, y.hi) !== 0 ? (sign(x.hi, y.hi) < 0 ? { v: x.hi, i: x.hiIn } : { v: y.hi, i: y.hiIn }) : { v: x.hi, i: x.hiIn && y.hiIn };
    return { ...a, interval: { lo: lo.v, loIn: lo.v ? lo.i : false, hi: hi.v, hiIn: hi.v ? hi.i : false } };
  }
  const only = a.only && b.only ? a.only.filter(v => b.only!.includes(v)) : a.only ?? b.only ?? null;
  return { ...a, only, not: [...new Set([...(a.not ?? []), ...(b.not ?? [])])].sort(byText) };
}
function impossible(s: Shape): boolean {
  if (s.interval) {
    const { lo, hi, loIn, hiIn } = s.interval;
    if (!lo || !hi) return false;
    const c = sign(lo, hi);
    return c > 0 || (c === 0 && (!loIn || !hiIn));
  }
  return s.only !== null && s.only !== undefined && s.only.every(v => (s.not ?? []).includes(v));
}
function keysOf(p: Predicate): string[] {
  const out: string[] = [];
  const walk = (n: Predicate) => {
    if (n.op === 'EXISTS' || n.op === 'EQUALS') out.push(`F|${n.fact.factType}|${n.fact.parameter ?? ''}`);
    else if (n.op === 'GTE' || n.op === 'LTE') {
      if ('fact' in n.left) out.push(`F|${n.left.fact.factType}|${n.left.fact.parameter ?? ''}`);
      else if ('ratio' in n.left) for (const r of [n.left.ratio.numerator, n.left.ratio.denominator]) out.push(`F|${r.factType}|${r.parameter ?? ''}`);
      else out.push(`C|${n.left.count.kind}|${JSON.stringify(n.left.count.labels === null ? null : [...n.left.count.labels].sort())}`);
    } else if (n.op === 'ALL' || n.op === 'ANY') n.of.forEach(walk);
    else if (n.op === 'NOT') walk(n.of);
  };
  walk(p);
  return [...new Set(out)].sort(byText);
}
function conflictsOf(rules: { ref: string; rule: Rule }[]) {
  const shapes = rules.map(r => ({ ...r, keys: keysOf(r.rule.requirement), shape: shape(r.rule.requirement), app: r.rule.applicability === null ? null : costHash(r.rule.applicability) }));
  const state = new Map(shapes.map(s => [s.ref, 'EVALUATED' as 'EVALUATED' | 'CONFLICT' | 'NOT_EVALUATED'])), ids = new Map(shapes.map(s => [s.ref, [] as string[]]));
  const found: Conflict[] = [];
  for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) {
    const a = shapes[i]!, b = shapes[j]!, shared = a.keys.filter(k => b.keys.includes(k));
    if (!shared.length) continue;
    const whole = shared.some(k => k.startsWith('C|') || FACT_CATALOG[k.split('|')[1] as FactType].subject === 'BUILDING');
    const la = a.rule.scope.labels, lb = b.rule.scope.labels;
    if (!whole && la !== null && lb !== null && la.every(l => !lb.includes(l))) continue;
    const decidable = !(whole && (a.rule.scope.kind !== 'BUILDING' || b.rule.scope.kind !== 'BUILDING')) && a.shape !== null && b.shape !== null && a.app === b.app;
    if (!decidable) {
      for (const r of [a, b]) if (state.get(r.ref) === 'EVALUATED') state.set(r.ref, 'NOT_EVALUATED');
      continue;
    }
    if (!impossible(meet(a.shape!, b.shape!))) continue;
    const pair = [a, b].sort((x, y) => byText(x.ref, y.ref));
    const id = `cnf-${sha40([pair[0]!.ref, pair[1]!.ref, a.shape!.key])}`;
    const bound = (v: N | null, inc: boolean) => v === null ? null : { value: render(v), closed: inc };
    found.push({ conflictId: id, rules: [pair[0]!.ref, pair[1]!.ref], factType: a.shape!.factType, parameter: a.shape!.parameter,
      scope: { kind: a.rule.scope.kind, labels: la !== null && lb !== null ? la.filter(l => lb.includes(l)).sort(byText) : la !== null ? [...la].sort(byText) : lb !== null ? [...lb].sort(byText) : null },
      constraints: pair.map(x => x.shape!.interval
        ? { rule: x.ref, lower: bound(x.shape!.interval.lo, x.shape!.interval.loIn), upper: bound(x.shape!.interval.hi, x.shape!.interval.hiIn), allowed: null, excluded: [] }
        : { rule: x.ref, lower: null, upper: null, allowed: x.shape!.only ? [...x.shape!.only].sort(byText) : null, excluded: [...(x.shape!.not ?? [])].sort(byText) }),
      reason: 'EMPTY_INTERSECTION' });
    for (const x of [a, b]) { state.set(x.ref, 'CONFLICT'); ids.get(x.ref)!.push(id); }
  }
  for (const v of ids.values()) v.sort(byText);
  return { found: found.sort((x, y) => byText(x.conflictId, y.conflictId)), state, ids };
}

function recompute(packs: KnowledgePack[], set: FactSet, disciplines: string[], bound: Set<Source>): Evaluation {
  const rules = packs.slice().sort((x, y) => byText(x.packId, y.packId)).flatMap(p => p.rules.filter(r => disciplines.includes(r.discipline))
    .map(rule => ({ ref: `${p.packId}/${rule.ruleId}`, packId: p.packId, version: p.version, rule }))).sort((x, y) => byText(x.ref, y.ref));
  const index = new Map(set.items.map(f => [factIndex(f.factType, f.parameter, f.subject), f])), byFact = new Map(set.items.map(f => [f.factId, f]));
  const kinds = new Map<SubjectKind, Subject[]>();
  for (const f of set.items) { const list = kinds.get(f.subject.kind) ?? []; if (!list.some(s => s.id === f.subject.id)) list.push(f.subject); kinds.set(f.subject.kind, list); }
  for (const list of kinds.values()) list.sort((x, y) => byText(x.id, y.id));
  const { found, state, ids } = conflictsOf(rules);
  const out: KnowledgeResult[] = [], sourceGaps = new Map<Source, string[]>(), factGaps = new Map<string, { factType: FactType; parameter: string | null; subject: Subject; ruleIds: string[] }>();
  const missingTypes = new Map<FactType, string[]>();
  for (const { ref, packId, version, rule } of rules) {
    const emit = (subject: Subject | null, status: Status, reason: Reason | null, o: { app?: KnowledgeResult['applicability']; trace?: Trace | null; seen?: Set<string>; integer?: boolean;
      near?: KnowledgeResult['nearMatch'] } = {}) => {
      const seen = [...(o.seen ?? new Set<string>())].sort(byText);
      const ranks = seen.map(id => PRECISION_RANK[byFact.get(id)!.precision]!).concat(o.integer ? [PRECISION_RANK.EXACT_INTEGER!] : []);
      const isolated = status, conflicted = state.get(ref) === 'CONFLICT' && ['MEETS_RULE', 'DOES_NOT_MEET_RULE', 'INPUT_INCOMPLETE', 'REVIEW_REQUIRED'].includes(status);
      const final: Status = conflicted ? 'CONFLICTING_RULES' : status;
      const review = final === 'REVIEW_REQUIRED' || final === 'CONFLICTING_RULES' || (rule.reviewDiscipline !== null && ['MEETS_RULE', 'DOES_NOT_MEET_RULE'].includes(final));
      const trace = o.trace ?? null, decisive = trace !== null && trace.comparison !== null && ['T', 'F'].includes(trace.status);
      out.push({ resultId: `kr-${sha40([packId, rule.ruleId, subject ? subject.kind : null, subject ? subject.id : null])}`, packId, packVersion: version, ruleId: rule.ruleId,
        ruleVersion: rule.version, discipline: rule.discipline, severity: rule.severity, subject, applicability: o.app ?? { status: 'NOT_REACHED', trace: null }, status: final,
        isolatedStatus: isolated, reason, precision: ranks.length ? PRECISIONS[Math.min(...ranks)]! : null, observedFacts: seen,
        evidence: seen.map(id => { const f = byFact.get(id)!; return { factId: id, pointer: f.source.pointer, artifactType: f.source.artifactType, artifactId: f.source.artifactId }; }),
        trace, explanation: { summary: decisive ? `${trace!.comparison} is ${trace!.status === 'T' ? 'true' : 'false'}; ${final}.` : reason ? `${final} (${reason}).` : `${final}.`,
          semantics: final === 'MEETS_RULE' ? rule.semantics.meets : final === 'DOES_NOT_MEET_RULE' ? rule.semantics.doesNotMeet : null },
        nearMatch: o.near ?? null, conflictIds: ids.get(ref)!, conflictAnalysis: state.get(ref)!, reviewRequired: review,
        reviewDisciplines: review && rule.reviewDiscipline !== null ? [rule.reviewDiscipline] : [],
        sourceReference: { packId, refId: rule.sourceReference.refId, locator: rule.sourceReference.locator, interpretation: rule.sourceReference.interpretation } });
    };
    const lacking = rule.requiredFacts.map(r => r.factType).filter(t => !FACT_CATALOG[t].supported);
    if (lacking.length) { for (const t of lacking) missingTypes.set(t, [...(missingTypes.get(t) ?? []), ref]); emit(null, 'UNSUPPORTED', 'UNSUPPORTED_FACT'); continue; }
    const needs = [SUBJECT_SOURCE[rule.scope.kind], ...rule.requiredFacts.map(r => FACT_CATALOG[r.factType].source), ...[...counted(rule.applicability), ...counted(rule.requirement)].map(k => SUBJECT_SOURCE[k])];
    const unbound = [...new Set(needs)].filter(s => !bound.has(s)).sort(byText);
    if (unbound.length) { for (const s of unbound) sourceGaps.set(s, [...(sourceGaps.get(s) ?? []), ref]); emit(null, 'NOT_EVALUATED', 'SOURCE_NOT_BOUND'); continue; }
    let any = false;
    for (const s of kinds.get(rule.scope.kind) ?? []) {
      const m = selector(s.label, rule.scope.labels);
      if (m === 'OUT') continue;
      any = true;
      if (m === 'NEAR') {
        const lf = index.get(factIndex(LABEL_FACT[s.kind]!, null, s))!;
        emit(s, 'REVIEW_REQUIRED', 'LABEL_NEAR_MATCH', { seen: new Set([lf.factId]), near: { observed: s.label!, expected: rule.scope.labels!.filter(l => fold(l) === fold(s.label!)).sort(byText),
          sourceEntity: { kind: s.kind, id: s.id }, reason: 'LABEL_NEAR_MATCH', evidence: [lf.factId] } });
        continue;
      }
      const env: Env = { index, kinds, seen: new Set(), integer: false, gaps: new Map() };
      const app = rule.applicability === null ? null : judge(rule.applicability, s, env);
      const appStatus: KnowledgeResult['applicability'] = app === null ? { status: 'NOT_DECLARED', trace: null }
        : { status: app.status === 'T' ? 'APPLICABLE' : app.status === 'F' ? 'NOT_APPLICABLE' : 'UNDETERMINED', trace: app };
      let status: Status, reason: Reason | null = null, trace: Trace | null = null;
      if (app !== null && app.status !== 'T') { status = app.status === 'F' ? 'NOT_APPLICABLE' : RESULT[app.status]; reason = app.status === 'F' ? 'APPLICABILITY_FALSE' : firstReason(app, app.status); }
      else { trace = judge(rule.requirement, s, env); status = RESULT[trace.status]; reason = ['T', 'F'].includes(trace.status) ? null : firstReason(trace, trace.status); }
      for (const [k, g] of env.gaps) { const e = factGaps.get(k) ?? { ...g, ruleIds: [] }; if (!e.ruleIds.includes(ref)) e.ruleIds.push(ref); factGaps.set(k, e); }
      emit(s, status, reason, { app: appStatus, trace, seen: env.seen, integer: env.integer });
    }
    if (!any) emit(null, 'NOT_APPLICABLE', 'EMPTY_SCOPE');
  }
  const subjectKey = (r: KnowledgeResult) => r.subject ? `1|${r.subject.kind}|${r.subject.id}` : '0';
  out.sort((x, y) => byText(x.packId, y.packId) || byText(x.ruleId, y.ruleId) || byText(subjectKey(x), subjectKey(y)));
  const blank = () => Object.fromEntries(STATUSES.map(s => [s, 0])) as Record<Status, number>;
  const total = blank(), perDiscipline: Record<string, Record<Status, number>> = {};
  for (const d of disciplines) perDiscipline[d] = blank();
  for (const r of out) { total[r.status] += 1; perDiscipline[r.discipline]![r.status] += 1; }
  return { results: out, conflicts: found,
    missingInputs: [...[...sourceGaps.keys()].sort(byText).map(source => ({ kind: 'SOURCE' as const, source, factType: null, parameter: null, subject: null, ruleIds: [...sourceGaps.get(source)!].sort(byText) })),
      ...[...factGaps.keys()].sort(byText).map(k => { const g = factGaps.get(k)!; return { kind: 'FACT' as const, source: null, factType: g.factType, parameter: g.parameter, subject: g.subject,
        ruleIds: [...g.ruleIds].sort(byText) }; })],
    unsupported: [...missingTypes.keys()].sort(byText).map(factType => ({ factType, ruleIds: [...new Set(missingTypes.get(factType)!)].sort(byText), reason: 'NOT_PROVIDED_IN_V1' as const })),
    disciplineSummary: perDiscipline, summary: { rulesSelected: rules.length, results: out.length, byStatus: total, conflicts: found.length,
      rulesConflictNotEvaluated: [...state.values()].filter(v => v === 'NOT_EVALUATED').length } };
}

export type Draft = { binding: KnowledgeBinding; inputHash: string; factsHash: string; input: { version: string; packs: { packId: string; version: string }[];
  sources: Record<string, string | null>; scope: { disciplines: string[] } }; packs: { packId: string; version: string; checksum: string; pack: KnowledgePack; rulesTotal: number;
  rulesSelected: number }[]; facts: FactSet; claims?: unknown } & Evaluation;
/** Independent recomputation of the untrusted evaluation and every identity it depends on. */
export function validateKnowledgeResults(draft: Draft, expected: { binding: KnowledgeBinding; checksums: Record<string, string> }): ResultValidation {
  const out: Diagnostic[] = [];
  let recomputed = { facts: draft.facts.items.length, results: 0, conflicts: 0 };
  diff(out, 'BINDING', '/binding', expected.binding, draft.binding);
  if (draft.inputHash !== costHash({ version: KNOWLEDGE_ANALYSIS_VERSION, binding: expected.binding, input: draft.input })) out.push({ code: 'INPUT_HASH', path: '/inputHash', message: 'input hash does not recompute' });
  if (draft.factsHash !== costHash(draft.facts)) out.push({ code: 'FACTS_HASH', path: '/factsHash', message: 'facts hash does not recompute' });
  if (draft.claims !== undefined) diff(out, 'CLAIMS', '/claims', CLAIMS, draft.claims);
  const wanted = draft.input.packs.map(p => `${p.packId}@${p.version}`), got = draft.packs.map(p => `${p.packId}@${p.version}`);
  if (canon(wanted) !== canon(got)) out.push({ code: 'PACKS', path: '/packs', message: 'packs do not match the selection' });
  draft.packs.forEach((p, i) => {
    const sum = costHash(p.pack), want = expected.checksums[`${p.packId}@${p.version}`], bound = expected.binding.packs.find(b => b.packId === p.packId);
    if (sum !== p.checksum || sum !== want || bound?.checksum !== sum || bound.version !== p.version || p.pack.packId !== p.packId || p.pack.version !== p.version)
      out.push({ code: 'PACK_CHECKSUM', path: `/packs/${i}/checksum`, message: `${p.packId}@${p.version} checksum does not recompute` });
    if (p.rulesTotal !== p.pack.rules.length || p.rulesSelected !== p.pack.rules.filter(r => draft.input.scope.disciplines.includes(r.discipline)).length)
      out.push({ code: 'PACKS', path: `/packs/${i}`, message: 'rule counts do not recompute' });
  });
  try {
    const bound = new Set<Source>(['ARCHITECTURE']);
    if (expected.binding.structural) bound.add('STRUCTURAL');
    if (expected.binding.environmental) bound.add('ENVIRONMENTAL');
    if (expected.binding.systems) bound.add('SYSTEMS');
    const mine = recompute(draft.packs.map(p => p.pack), draft.facts, draft.input.scope.disciplines, bound);
    recomputed = { facts: draft.facts.items.length, results: mine.results.length, conflicts: mine.conflicts.length };
    if (mine.results.length !== draft.results.length) out.push({ code: 'RESULTS', path: '/results', message: `expected ${mine.results.length} results, got ${draft.results.length}` });
    for (const k of ['results', 'conflicts', 'missingInputs', 'unsupported', 'disciplineSummary', 'summary'] as const) diff(out, k.toUpperCase(), `/${k}`, mine[k], draft[k]);
  } catch (error) { out.push({ code: 'RESULTS', path: '/results', message: (error as Error).message.slice(0, 300) }); }
  return { validator: RESULT_VALIDATOR, status: out.length ? 'INVALID' : 'VALID', diagnostics: out.slice(0, 200), recomputed };
}
/** The validator's own arithmetic, exposed only for its known-answer tests. */
export const validatorArithmetic = { read, render, spacing, inBase, fold };
