import { createHash } from 'node:crypto';
import { polygonAreaMm2 } from '@designflow/shared';
import { TAKEOFF_ENGINE_VERSION } from '@designflow/quantity-takeoff';
import { BIM_VERSION, type BimModel } from '../bim/contracts.js';
import { STRUCTURAL_MODEL_VERSION } from '../structural/contracts.js';
import { ENVIRONMENTAL_MODEL_VERSION } from '../environmental/contracts.js';
import { SYSTEMS_MODEL_VERSION } from '../systems/contracts.js';
import { ENGINE, FACTS_VERSION, FACT_CATALOG, KNOWLEDGE_LIMITS, KNOWLEDGE_MODEL_VERSION, KnowledgeError, itemUnit, type Fact, type FactSet, type FactType, type KnowledgeBinding, type Subject, type Upstream,
  type Unit } from './contracts.js';
import { fromStored, parseExact, q, show, cmp, type Q } from './units.js';

export type { Upstream };
// project-facts-v1 extraction (evaluator side). The model validator re-derives every fact independently (design §16).
const violation = (field: string): never => {
  throw new KnowledgeError('TRANSITIVE_UPSTREAM_BINDING_INCONSISTENT', `TRANSITIVE_UPSTREAM_BINDING_CONSISTENCY violated: ${field}`);
};
/** §14.1: every bound snapshot belongs to this project, revision and architecture, and nested references agree with explicit bindings. */
export function checkUpstreamConsistency(binding: KnowledgeBinding, up: Upstream): void {
  const sources = [['structural', up.structural, STRUCTURAL_MODEL_VERSION, 'structuralModelVersion'], ['environmental', up.environmental, ENVIRONMENTAL_MODEL_VERSION, 'environmentalModelVersion'],
    ['systems', up.systems, SYSTEMS_MODEL_VERSION, 'systemsModelVersion']] as const;
  for (const [name, source, version, versionKey] of sources) {
    const bound = binding[name];
    if (!source) { if (bound) violation(`${name}.missing`); continue; }
    const b = source.snapshot.binding as Record<string, unknown>;
    if (b.projectId !== binding.projectId) violation(`${name}.projectId`);
    if (b.revisionId !== binding.revisionId) violation(`${name}.revisionId`);
    if (b.modelHash !== binding.modelHash) violation(`${name}.modelHash`);
    if (b[versionKey] !== version) violation(`${name}.modelVersion`);
    if (source.snapshot.inputHash !== source.inputHash) violation(`${name}.inputHash`);
    if (!bound || bound.analysisId !== source.analysisId || bound.inputHash !== source.inputHash || bound.modelVersion !== version) violation(`${name}.binding`);
  }
  if (up.systems) for (const nested of ['structural', 'environmental'] as const) {
    const ref = up.systems.snapshot.binding[nested], explicit = binding[nested];
    if (ref && explicit && (ref.analysisId !== explicit.analysisId || ref.inputHash !== explicit.inputHash || ref.modelVersion !== explicit.modelVersion))
      violation(`systems.binding.${nested}`);
  }
}

type Source = Fact['source'];
type Value = Fact['value'];
const factId = (t: FactType, parameter: string | null, s: Subject) =>
  `fact-${createHash('sha256').update(JSON.stringify([t, parameter, s.kind, s.id])).digest('hex').slice(0, 40)}`;
const dec = (r: Q, unit: Unit): Value => ({ kind: 'DECIMAL', exact: show(r), unit });
const int = (n: number) => q(BigInt(n));

export function extractFacts(bim: BimModel, up: Upstream, binding: KnowledgeBinding): FactSet {
  const items: Fact[] = [];
  const emit = (factType: FactType, subject: Subject, value: Value, source: Source, pointer: string, method: Fact['derivation']['method'] = 'DIRECT', inputs: string[] = [],
    parameter: string | null = null) => {
    if (items.length >= KNOWLEDGE_LIMITS.facts) throw new KnowledgeError('KNOWLEDGE_RESOURCE_LIMIT', 'Project fact budget exceeded');
    items.push({ factId: factId(factType, parameter, subject), factType, parameter, subject, status: value ? 'PRESENT' : 'ABSENT', value,
      precision: FACT_CATALOG[factType].precision!, source: { ...source, pointer }, derivation: { method, inputs } });
  };
  const base = { revisionId: binding.revisionId, modelHash: binding.modelHash };
  const arch: Source = { artifactType: 'ARCHITECTURE_REVISION', artifactId: binding.revisionId, ...base, engineVersion: BIM_VERSION, inputHash: null, pointer: '' };
  const takeoff: Source = { ...arch, artifactType: 'BIM_QUANTITY_TAKEOFF', engineVersion: TAKEOFF_ENGINE_VERSION };
  const g = bim.geometry, building: Subject = { kind: 'BUILDING', id: 'building', label: null };

  // ---------------------------------------------------------------- architecture (BIM projection of the accepted revision)
  const storeys = g.levels.map((l, i) => ({ l, i })).filter(({ l }) => l.kind === 'storey');
  emit('ARCH_STOREY_COUNT', building, dec(int(storeys.length), 'count'), arch, '/geometry/levels', 'COUNT');
  const heightInputs = storeys.flatMap(({ i }) => [`/geometry/levels/${i}/elevationMm`, `/geometry/levels/${i}/floorToFloorHeightMm`]);
  const height = storeys.length && storeys.every(({ l }) => l.floorToFloorHeightMm !== null)
    ? Math.max(...storeys.map(({ l }) => l.elevationMm + l.floorToFloorHeightMm!)) - Math.min(...storeys.map(({ l }) => l.elevationMm)) : null;
  emit('ARCH_BUILDING_HEIGHT', building, height === null ? null : dec(int(height), 'mm'), arch, '/geometry/levels', 'DIFFERENCE', heightInputs);
  g.levels.forEach((l, i) => {
    const s: Subject = { kind: 'LEVEL', id: l.id, label: null };
    emit('ARCH_LEVEL_ELEVATION', s, dec(int(l.elevationMm), 'mm'), arch, `/geometry/levels/${i}/elevationMm`);
    emit('ARCH_FLOOR_TO_FLOOR_HEIGHT', s, l.floorToFloorHeightMm === null ? null : dec(int(l.floorToFloorHeightMm), 'mm'), arch, `/geometry/levels/${i}/floorToFloorHeightMm`);
  });
  const spaceSubject = new Map<string, Subject>();
  g.spaces.forEach((sp, i) => {
    const s: Subject = { kind: 'SPACE', id: sp.id, label: sp.classification };
    spaceSubject.set(sp.id, s);
    emit('ARCH_SPACE_CLASSIFICATION', s, { kind: 'LABEL', value: sp.classification }, arch, `/geometry/spaces/${i}/classification`);
    emit('ARCH_SPACE_AREA', s, dec(parseExact(polygonAreaMm2(sp.boundary)), 'mm2'), arch, `/geometry/spaces/${i}/boundary`, 'POLYGON_AREA', [`/geometry/spaces/${i}/boundary`]);
    // Adjacency only from explicit wall spaceIds; any wall on the level without them makes the sum unknown.
    const known = g.walls.filter(w => w.levelId === sp.levelId).every(w => w.spaceIds !== undefined);
    const windows = g.openings.map((o, k) => ({ o, k })).filter(({ o }) => o.kind === 'window' && (g.walls.find(w => w.id === o.wallId)?.spaceIds ?? []).includes(sp.id));
    emit('ARCH_SPACE_WINDOW_AREA', s, known ? dec(q(windows.reduce((sum, { o }) => sum + BigInt(o.widthMm) * BigInt(o.heightMm), 0n)), 'mm2') : null,
      arch, `/geometry/spaces/${i}`, 'SUM', windows.map(({ k }) => `/geometry/openings/${k}`));
    emit('ARCH_SPACE_OCCUPANCY', s, sp.occupancy === undefined ? null : dec(int(sp.occupancy), 'count'), arch, `/geometry/spaces/${i}/occupancy`);
  });
  g.openings.forEach((o, i) => {
    const s: Subject = { kind: 'OPENING', id: o.id, label: o.kind };
    emit('ARCH_OPENING_KIND', s, { kind: 'LABEL', value: o.kind }, arch, `/geometry/openings/${i}/kind`);
    emit('ARCH_OPENING_WIDTH', s, dec(int(o.widthMm), 'mm'), arch, `/geometry/openings/${i}/widthMm`);
    emit('ARCH_OPENING_HEIGHT', s, dec(int(o.heightMm), 'mm'), arch, `/geometry/openings/${i}/heightMm`);
    emit('ARCH_OPENING_SILL', s, dec(int(o.sillMm), 'mm'), arch, `/geometry/openings/${i}/sillMm`);
    emit('ARCH_OPENING_IS_SITE_ENTRY', s, { kind: 'BOOLEAN', value: g.site?.primaryEntryOpeningId === o.id }, arch,
      g.site ? '/geometry/site/primaryEntryOpeningId' : '/geometry/site', 'EQUALITY', [`/geometry/openings/${i}/id`]);
  });
  g.stairs.forEach((st, i) => {
    const s: Subject = { kind: 'STAIR', id: st.id, label: null }, at = `/geometry/stairs/${i}`;
    emit('ARCH_STAIR_WIDTH', s, dec(int(st.widthMm), 'mm'), arch, `${at}/widthMm`);
    emit('ARCH_STAIR_TREAD_DEPTH', s, dec(int(st.treadDepthMm), 'mm'), arch, `${at}/treadDepthMm`);
    emit('ARCH_STAIR_MAX_RISER', s, dec(int(Math.max(...st.riserHeightsMm)), 'mm'), arch, `${at}/riserHeightsMm`, 'MAX', [`${at}/riserHeightsMm`]);
    emit('ARCH_STAIR_RISER_COUNT', s, dec(int(st.riserHeightsMm.length), 'count'), arch, `${at}/riserHeightsMm`, 'COUNT', [`${at}/riserHeightsMm`]);
    emit('ARCH_STAIR_HEADROOM', s, st.headroomMm === undefined ? null : dec(int(st.headroomMm), 'mm'), arch, `${at}/headroomMm`);
  });
  bim.quantities.summary.totals.forEach((t, k) => {
    const unit = itemUnit(t.itemCode)!;
    emit('QUANTITY_TOTAL', building, t.status === 'EVALUATED' ? dec(parseExact(t.quantity.value), unit) : null, takeoff, `/quantities/summary/totals/${k}/quantity/value`,
      'DIRECT', [], t.itemCode);
  });

  // ---------------------------------------------------------------- Phase 24 structural (explicitly bound only)
  if (up.structural) {
    const sn = up.structural.snapshot, src: Source = { artifactType: 'STRUCTURAL_ANALYSIS', artifactId: up.structural.analysisId, ...base, engineVersion: sn.version,
      inputHash: up.structural.inputHash, pointer: '' };
    sn.model.members.forEach((m, i) => {
      const s: Subject = { kind: 'STRUCTURAL_MEMBER', id: m.requestKey, label: m.kind }, k = sn.model.sections.findIndex(x => x.id === m.sectionId);
      const dims = sn.model.sections[k]?.dimensions ?? null;
      emit('STRUCT_MEMBER_KIND', s, { kind: 'LABEL', value: m.kind }, src, `/model/members/${i}/kind`);
      emit('STRUCT_SECTION_WIDTH', s, dims ? dec(fromStored(dims.width.value), 'mm') : null, src, dims ? `/model/sections/${k}/dimensions/width/value` : `/model/sections/${k}/dimensions`);
      emit('STRUCT_SECTION_DEPTH', s, dims ? dec(fromStored(dims.depth.value), 'mm') : null, src, dims ? `/model/sections/${k}/dimensions/depth/value` : `/model/sections/${k}/dimensions`);
      emit('STRUCT_MEMBER_LENGTH', s, dec(fromStored(m.quantities.length.value), 'mm'), src, `/model/members/${i}/quantities/length/value`);
    });
  }

  // ---------------------------------------------------------------- Phase 25 environmental (explicitly bound only)
  const space = (id: string) => spaceSubject.get(id) ?? (() => { throw new KnowledgeError('KNOWLEDGE_MODEL_INVALID', `Upstream space ${id} is not in the revision`); })();
  if (up.environmental) {
    const sn = up.environmental.snapshot, src: Source = { artifactType: 'ENVIRONMENTAL_ANALYSIS', artifactId: up.environmental.analysisId, ...base, engineVersion: sn.version,
      inputHash: up.environmental.inputHash, pointer: '' };
    emit('ENV_ENVELOPE_STATUS', building, { kind: 'ENUM', value: sn.model.envelope.status }, src, '/model/envelope/status');
    sn.model.zones.forEach((z, i) => emit('ENV_ZONE_FLOOR_AREA', space(z.source.id), dec(fromStored(z.floorArea.value), 'm2'), src, `/model/zones/${i}/floorArea/value`));
    sn.results.daylightIndicator.zones.forEach((z, i) => {
      const zone = sn.model.zones.find(x => x.id === z.zoneId);
      if (!zone) throw new KnowledgeError('KNOWLEDGE_MODEL_INVALID', `Daylight indicator zone ${z.zoneId} is not in the environmental model`);
      emit('ENV_WINDOW_TO_FLOOR_RATIO', space(zone.source.id), dec(fromStored(z.ratio.value), '1'), src, `/results/daylightIndicator/zones/${i}/ratio/value`);
    });
    sn.results.thermal.cases.forEach((c, i) => emit('ENV_TRANSMISSION_TOTAL', { kind: 'THERMAL_CASE', id: c.key, label: null },
      c.status === 'ANALYZED' ? dec(fromStored(c.total.value), 'W') : null, src, `/results/thermal/cases/${i}/total/value`));
  }

  // ---------------------------------------------------------------- Phase 26 systems (explicitly bound only)
  if (up.systems) {
    const sn = up.systems.snapshot, r = sn.results, src: Source = { artifactType: 'SYSTEMS_ANALYSIS', artifactId: up.systems.analysisId, ...base, engineVersion: sn.version,
      inputHash: up.systems.inputHash, pointer: '' };
    r.lifeSafety.spaces.forEach((e, i) => {
      const s = space(e.spaceId), at = `/results/lifeSafety/spaces/${i}`;
      emit('SYS_EGRESS_DISTANCE', s, e.distance === null ? null : dec(fromStored(e.distance.value), 'mm'), src, e.distance === null ? `${at}/distance` : `${at}/distance/value`);
      emit('SYS_EGRESS_REACHABLE', s, { kind: 'BOOLEAN', value: e.reachable }, src, `${at}/reachable`);
      emit('SYS_DISTINCT_EXITS_REACHABLE', s, dec(int(e.distinctExitsReachable), 'count'), src, `${at}/distinctExitsReachable`);
    });
    const deadEnds = new Map<string, number[]>();
    r.lifeSafety.deadEnds.forEach((e, i) => deadEnds.set(e.spaceId, [...(deadEnds.get(e.spaceId) ?? []), i]));
    for (const [spaceId, idx] of deadEnds) {
      const values = idx.map(i => fromStored(r.lifeSafety.deadEnds[i]!.length.value)), max = values.reduce((m, v) => cmp(v, m) > 0 ? v : m);
      const pointers = idx.map(i => `/results/lifeSafety/deadEnds/${i}/length/value`);
      if (idx.length === 1) emit('SYS_DEAD_END_LENGTH', space(spaceId), dec(max, 'mm'), src, pointers[0]!);
      else emit('SYS_DEAD_END_LENGTH', space(spaceId), dec(max, 'mm'), src, '/results/lifeSafety/deadEnds', 'MAX', pointers);
    }
    emit('SYS_EGRESS_AVAILABLE', building, r.lifeSafety.egressAvailable === null ? null : { kind: 'BOOLEAN', value: r.lifeSafety.egressAvailable }, src, '/results/lifeSafety/egressAvailable');
    emit('SYS_PENETRATION_COUNT', building, dec(int(r.coordination.penetrations.length), 'count'), src, '/results/coordination/penetrations', 'COUNT', ['/results/coordination/penetrations']);
    emit('SYS_BLOCKING_CLASH_COUNT', building, dec(int(r.coordination.blocking), 'count'), src, '/results/coordination/blocking');
    const total = r.electrical.total;
    emit('SYS_ELECTRICAL_CONNECTED_W', building, total ? dec(parseExact(total.connected.W.exact), 'W') : null, src,
      total ? '/results/electrical/total/connected/W/exact' : '/results/electrical/total');
    const demand = total && total.demand.status === 'EVALUATED' && total.demand.W ? total.demand.W : null;
    emit('SYS_ELECTRICAL_DEMAND_W', building, demand ? dec(parseExact(demand.exact), 'W') : null, src,
      demand ? '/results/electrical/total/demand/W/exact' : total ? '/results/electrical/total/demand' : '/results/electrical/total');
    r.networks.forEach((n, k) => {
      const net = sn.model.networks.find(x => x.id === n.networkId);
      if (!net) throw new KnowledgeError('KNOWLEDGE_MODEL_INVALID', `Network ${n.networkId} is not in the systems model`);
      const s: Subject = { kind: 'MEP_NETWORK', id: net.key, label: net.system }, at = `/results/networks/${k}`;
      emit('SYS_NETWORK_SYSTEM', s, { kind: 'LABEL', value: net.system }, src, `/model/networks/${sn.model.networks.indexOf(net)}/system`);
      emit('SYS_NETWORK_STATUS', s, { kind: 'ENUM', value: n.status }, src, `${at}/status`);
      emit('SYS_NETWORK_LENGTH', s, dec(fromStored(n.length.value), 'mm'), src, `${at}/length/value`);
      if (n.drainage) emit('SYS_DRAINAGE_SLOPE', s, dec(q(BigInt(n.drainage.slope.rise), BigInt(n.drainage.slope.run)), '1'), src, `${at}/drainage/slope`, 'QUOTIENT',
        [`${at}/drainage/slope/rise`, `${at}/drainage/slope/run`]);
      if (n.airflow) {
        const v = n.airflow.segments.map(x => x.velocity), known = v.length > 0 && v.every(x => x !== null);
        emit('SYS_DUCT_MAX_VELOCITY', s, known ? dec(v.map(x => parseExact(x!.exact)).reduce((m, x) => cmp(x, m) > 0 ? x : m), 'm/s') : null, src,
          `${at}/airflow/segments`, known ? 'MAX' : 'DIRECT', known ? [`${at}/airflow/segments`] : []);
      }
    });
    r.verticalTransport.elevators.forEach((e, k) => {
      const s: Subject = { kind: 'ELEVATOR', id: e.key, label: null }, at = `/results/verticalTransport/elevators/${k}`;
      emit('SYS_ELEVATOR_STATUS', s, { kind: 'ENUM', value: e.status }, src, `${at}/status`);
      emit('SYS_ELEVATOR_VERTICAL_ACCESS', s, { kind: 'ENUM', value: e.verticalAccess }, src, `${at}/verticalAccess`);
      emit('SYS_ELEVATOR_DOOR_WIDTH', s, dec(int(e.door.widthMm), 'mm'), src, `${at}/door/widthMm`);
      emit('SYS_ELEVATOR_SHAFT_WIDTH', s, e.shaft ? dec(int(e.shaft.maxX - e.shaft.minX), 'mm') : null, src, `${at}/shaft`, e.shaft ? 'BOUNDS_EXTENT' : 'DIRECT',
        e.shaft ? [`${at}/shaft/minX`, `${at}/shaft/maxX`] : []);
      emit('SYS_ELEVATOR_SHAFT_DEPTH', s, e.shaft ? dec(int(e.shaft.maxZ - e.shaft.minZ), 'mm') : null, src, `${at}/shaft`, e.shaft ? 'BOUNDS_EXTENT' : 'DIRECT',
        e.shaft ? [`${at}/shaft/minZ`, `${at}/shaft/maxZ`] : []);
    });
  }

  items.sort((a, b) => a.factId < b.factId ? -1 : a.factId > b.factId ? 1 : 0);
  if (items.some((f, i) => i > 0 && items[i - 1]!.factId === f.factId)) throw new KnowledgeError('KNOWLEDGE_MODEL_INVALID', 'Duplicate project fact identity');
  const bySource = { ARCHITECTURE: 0, STRUCTURAL: 0, ENVIRONMENTAL: 0, SYSTEMS: 0 };
  for (const f of items) bySource[FACT_CATALOG[f.factType].source]++;
  return { version: FACTS_VERSION, items, summary: { present: items.filter(f => f.status === 'PRESENT').length, absent: items.filter(f => f.status === 'ABSENT').length, bySource } };
}

/** The knowledge binding (design §14): architecture + explicit upstream identities + engine literals + pack identities + disciplines. */
export function knowledgeBinding(architecture: BimModel['binding'], up: Upstream, packs: { pack: { packId: string; version: string }; checksum: string }[],
  disciplines: readonly KnowledgeBinding['disciplines'][number][]): KnowledgeBinding {
  const ref = <V extends string>(x: { analysisId: string; inputHash: string } | null, modelVersion: V) => x ? { analysisId: x.analysisId, inputHash: x.inputHash, modelVersion } : null;
  return { ...architecture, bimVersion: BIM_VERSION, knowledgeModelVersion: KNOWLEDGE_MODEL_VERSION, structural: ref(up.structural, STRUCTURAL_MODEL_VERSION),
    environmental: ref(up.environmental, ENVIRONMENTAL_MODEL_VERSION), systems: ref(up.systems, SYSTEMS_MODEL_VERSION), engine: { ...ENGINE },
    packs: packs.map(p => ({ packId: p.pack.packId, version: p.pack.version, checksum: p.checksum })).sort((a, b) => a.packId < b.packId ? -1 : 1),
    disciplines: [...disciplines].sort() };
}
