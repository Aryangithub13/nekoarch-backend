// Independent validators. Deliberately imports nothing from model, routing, egress, vertical, clash, analysis or units: every check is recomputed here.
import { createHash } from 'node:crypto';
import { decimalRatio, pointLocation, ringContains, wallSpaceIds, type BuildingModelV2, type Point2Mm } from '@designflow/shared';
import { digest } from '../bim/core.js';
import type { EnvironmentalSnapshot } from '../environmental/contracts.js';
import type { StructuralSnapshot } from '../structural/contracts.js';
import { ASSUMPTIONS, CIRCULATION_CLASSIFICATIONS, CLAIMS, MODEL_VALIDATOR, NOT_EVALUATED, RESULT_VALIDATOR, ROUTING_WEIGHTS, SIDES, SUBMODELS, type Box, type Clash,
  type ModelValidation, type ResultValidation, type SystemsBinding, type SystemsInput, type SystemsModel, type SystemsResults } from './contracts.js';

type Diagnostic = ModelValidation['diagnostics'][number];
type P3 = { x: number; y: number; z: number };
type Net = SystemsModel['networks'][number];
const id = (projectId: string, role: string, key: string) => `sys-${createHash('sha256').update(JSON.stringify([projectId, role, key])).digest('hex').slice(0, 40)}`;
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const TOL = 1e-6;
const twice = (ring: readonly Point2Mm[]) => ring.map(p => ({ x: 2 * p.x, z: 2 * p.z }));
const bbox = (ring: readonly Point2Mm[]) => ({ minX: Math.min(...ring.map(p => p.x)), minZ: Math.min(...ring.map(p => p.z)), maxX: Math.max(...ring.map(p => p.x)), maxZ: Math.max(...ring.map(p => p.z)) });

// ------------------------------------------------------------------ own exact rational arithmetic
type Q = [bigint, bigint];
const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; };
const Qn = (n: bigint, d = 1n): Q => { if (d < 0n) { n = -n; d = -d; } const k = gcd(n, d); return [n / k, d / k]; };
const Qadd = (a: Q, b: Q) => Qn(a[0] * b[1] + b[0] * a[1], a[1] * b[1]), Qmul = (a: Q, b: Q) => Qn(a[0] * b[0], a[1] * b[1]), Qdiv = (a: Q, b: Q) => Qn(a[0] * b[1], a[1] * b[0]);
const Qnum = (v: number): Q => { const [n, d] = decimalRatio(v); return Qn(n, d); };
function Qstr([n, d]: Q): string {
  let r = d, k2 = 0, k5 = 0;
  while (r % 2n === 0n) { r /= 2n; k2++; }
  while (r % 5n === 0n) { r /= 5n; k5++; }
  if (r !== 1n) return `${n}/${d}`;
  const places = Math.max(k2, k5), s = n * 10n ** BigInt(places) / d, neg = s < 0n, digits = (neg ? -s : s).toString().padStart(places + 1, '0');
  return (neg ? '-' : '') + (places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits);
}

// ------------------------------------------------------------------ model validator
export function validateSystemsModel(model: SystemsModel, geometry: BuildingModelV2, input: SystemsInput, expected: SystemsBinding, structural: StructuralSnapshot | null): ModelValidation {
  const diagnostics: Diagnostic[] = [];
  const fail = (code: string, message: string, targetId: string | null = null) => { if (diagnostics.length < 200) diagnostics.push({ code, targetId, message, severity: 'ERROR' }); };
  const same = (code: string, a: unknown, b: unknown, message: string) => { if (digest(a) !== digest(b)) fail(code, message); };
  same('BINDING', model.binding, expected, 'Model binding differs from the source revision and upstream artifacts');
  if (model.version !== 'building-systems-model-v1' || model.coordinateSystem !== 'x-right-y-up-z-depth') fail('VERSION', 'Unexpected model version or frame');
  const levels = [...geometry.levels].sort((a, b) => a.index - b.index).map(l => ({ levelId: l.id, index: l.index, elevationMm: l.elevationMm, topMm: l.elevationMm + (l.floorToFloorHeightMm ?? NaN), boundary: l.boundary }));
  same('LEVELS', model.levels, levels, 'Level inventory differs from the architecture');
  const level = new Map(levels.map(l => [l.levelId, l]));
  same('SPACES', model.spaces, [...geometry.spaces].sort((a, b) => cmp(a.id, b.id)).map(s => ({ spaceId: s.id, levelId: s.levelId, classification: s.classification,
    circulation: (CIRCULATION_CLASSIFICATIONS as readonly string[]).includes(s.classification.toLowerCase()), boundary: s.boundary })), 'Space inventory differs from the architecture');
  same('WALLS', model.walls, [...geometry.walls].sort((a, b) => cmp(a.id, b.id)).map(w => ({ wallId: w.id, levelId: w.levelId, start: w.path.start, end: w.path.end, thicknessMm: w.thicknessMm,
    bottomY: level.get(w.levelId)!.elevationMm + w.baseOffsetMm!, topY: level.get(w.levelId)!.elevationMm + w.baseOffsetMm! + w.heightMm!, exterior: wallSpaceIds(geometry, w).length === 1 })),
    'Wall inventory differs from the architecture');
  same('OPENINGS', model.openings, [...geometry.openings].sort((a, b) => cmp(a.id, b.id)).map(o => {
    const w = geometry.walls.find(x => x.id === o.wallId)!, horizontal = w.path.start.z === w.path.end.z;
    const sign = horizontal ? Math.sign(w.path.end.x - w.path.start.x) : Math.sign(w.path.end.z - w.path.start.z);
    const s2 = 2 * (horizontal ? w.path.start.x : w.path.start.z) + sign * 2 * o.offsetMm, e2 = s2 + sign * 2 * o.widthMm, across2 = 2 * (horizontal ? w.path.start.z : w.path.start.x);
    const spaces = wallSpaceIds(geometry, w), t = w.thicknessMm!;
    return { openingId: o.id, wallId: o.wallId, levelId: o.levelId, kind: o.kind, widthMm: o.widthMm,
      traversable: (o.kind === 'door' || (o.kind === 'opening' && o.purpose === 'passage')) && o.sillMm === 0 && w.baseOffsetMm === 0, exterior: spaces.length === 1, spaceIds: spaces,
      center2: horizontal ? { x: (s2 + e2) / 2, z: across2 } : { x: across2, z: (s2 + e2) / 2 },
      footprint2: horizontal ? { minX: Math.min(s2, e2), maxX: Math.max(s2, e2), minZ: across2 - t, maxZ: across2 + t } : { minX: across2 - t, maxX: across2 + t, minZ: Math.min(s2, e2), maxZ: Math.max(s2, e2) } };
  }), 'Opening inventory differs from the architecture');
  same('PLATES', model.plates, geometry.slabs.filter(s => s.kind === 'floor').sort((a, b) => cmp(a.id, b.id)).map(s => ({ slabId: s.id, levelId: s.levelId, outer: s.footprint.outer,
    voids: s.footprint.voids, topY: level.get(s.levelId)!.elevationMm + s.topOffsetMm, bottomY: level.get(s.levelId)!.elevationMm + s.topOffsetMm - s.thicknessMm })), 'Floor plate inventory differs');
  same('STAIRS', model.stairs, [...geometry.stairs].sort((a, b) => cmp(a.id, b.id)).map(s => ({ stairId: s.id, fromLevelId: s.fromLevelId, toLevelId: s.toLevelId, flight: bbox(s.footprint),
    landings: s.landings.map(l => bbox(l.footprint)), direction: s.direction, widthMm: s.widthMm, runMm: s.runMm, riseMm: s.riseMm,
    bottomY: level.get(s.fromLevelId)!.elevationMm, topY: level.get(s.toLevelId)!.elevationMm })), 'Stair inventory differs');
  const members = structural ? [...structural.model.members].sort((a, b) => cmp(a.id, b.id)).map(x => {
    const node = (n: string) => structural.model.nodes.find(q => q.id === n)!.coordinates, d = structural.model.sections.find(s => s.id === x.sectionId)!.dimensions;
    const a = node(x.startNodeId), b = node(x.endNodeId);
    return { memberId: x.id, kind: x.kind, start: { x: a.x, y: a.y, z: a.z }, end: { x: b.x, y: b.y, z: b.z }, halfSizeMm: d ? Math.max(d.width.value, d.depth.value) / 2 : null,
      envelope: d ? 'CONSERVATIVE_SQUARE_ENVELOPE' : 'NOT_EVALUATED_NO_SECTION_DIMENSIONS' };
  }) : [];
  same('STRUCTURE', model.structure, { status: structural ? 'BOUND' : 'NOT_SUPPLIED', members }, 'Structural envelopes differ from the bound structural snapshot');

  // Terminals and networks re-derived from the explicit input.
  const space = new Map(geometry.spaces.map(s => [s.id, s])), projectId = expected.projectId;
  type T = SystemsModel['terminals'][number];
  const terms: T[] = [];
  const term = (d: string, role: T['role'], key: string, spaceId: string, point: Point2Mm | null, elevationMm: number, footprint: T['footprint'] = null): T | null => {
    const s = space.get(spaceId);
    if (!s) { fail('TERMINAL', `Terminal ${key} names an unknown space`); return null; }
    if (point && pointLocation(point, s.boundary) < 0) fail('TERMINAL', `Terminal ${key} lies outside its space`);
    const t: T = { id: id(projectId, 'terminal', `${d}:${key}`), key, role, spaceId, levelId: s.levelId, point, y: level.get(s.levelId)!.elevationMm + elevationMm, footprint };
    terms.push(t); return t;
  };
  const nets: Omit<Net, 'missing'>[] = [];
  type Routing = { mode: 'PLANNED' } | { mode: 'FIXED'; routes: { terminal: string; points: P3[] }[] };
  const net = (key: string, discipline: Net['discipline'], system: Net['system'], root: T | null, all: (T | null)[], size: Net['size'], clearance: { value: number } | null,
    spec: { elevations?: { levelId: string; elevationMm: number }[]; bands?: { levelId: string; topMm: number; bottomMm: number }[]; slope?: { rise: number; run: number } | null }, routing: Routing, blocked = false) => {
    const members = all.filter((t): t is T => t !== null), every = [...(root ? [root] : []), ...members], idx = every.map(t => level.get(t.levelId)!.index);
    const span = levels.filter(l => l.index >= Math.min(...idx) && l.index <= Math.max(...idx)), gravity = !!spec.bands;
    const routes = routing.mode === 'FIXED' ? routing.routes.map(r => ({ terminalId: members.find(t => t.key === r.terminal)?.id ?? '', points: r.points })).sort((a, b) => cmp(a.terminalId, b.terminalId)) : [];
    const lv = span.map(l => {
      const e = spec.elevations?.find(x => x.levelId === l.levelId), b = spec.bands?.find(x => x.levelId === l.levelId);
      return { levelId: l.levelId, y: gravity ? null : e ? l.elevationMm + e.elevationMm : null, band: gravity && b ? { top: l.elevationMm + b.topMm, bottom: l.elevationMm + b.bottomMm } : null };
    });
    const ready = !blocked && !!root && every.every(t => t.point) && lv.every(l => gravity ? l.band : l.y !== null) && (!gravity || !!spec.slope)
      && (routing.mode === 'PLANNED' || members.every(t => routes.some(r => r.terminalId === t.id)));
    nets.push({ id: id(projectId, 'network', key), key, discipline, system, rootId: root?.id ?? null, terminalIds: members.map(t => t.id).sort(), size, clearanceMm: clearance?.value ?? null,
      levels: lv, slope: gravity && spec.slope ? { rise: spec.slope.rise, run: spec.slope.run } : null, mode: routing.mode, fixedRoutes: routes, status: ready ? 'READY' : 'INPUT_INCOMPLETE' });
  };
  if (input.plumbing) {
    const p = input.plumbing, c = p.fixtures.flatMap(f => f.connections.map(x => ({ s: x.service, t: term('plumbing', 'FIXTURE', `${f.key}.${x.service}`, f.spaceId, x.point, x.elevationMm) })));
    const anchor = (a: typeof p.coldWaterSource, role: T['role']) => a ? term('plumbing', role, a.key, a.spaceId, a.point, a.elevationMm) : null;
    const cold = anchor(p.coldWaterSource, 'WATER_SOURCE'), hot = anchor(p.hotWaterSource, 'WATER_SOURCE'), out = anchor(p.sanitaryOutlet, 'SANITARY_OUTLET');
    const of = (s: string) => c.filter(x => x.s === s).map(x => x.t);
    if (of('SANITARY').length) net('SANITARY', 'PLUMBING', 'SANITARY', out, of('SANITARY'), p.sanitary.size, p.clearance, { bands: p.sanitary.bands, slope: p.minimumSlope }, { mode: 'PLANNED' });
    if (of('COLD_WATER').length) net('COLD_WATER', 'PLUMBING', 'COLD_WATER', cold, of('COLD_WATER'), p.coldWater.size, p.clearance, { elevations: p.coldWater.elevations }, p.coldWater.routing);
    if (of('HOT_WATER').length) net('HOT_WATER', 'PLUMBING', 'HOT_WATER', hot, of('HOT_WATER'), p.hotWater.size, p.clearance, { elevations: p.hotWater.elevations }, p.hotWater.routing);
  }
  if (input.electrical) {
    const e = input.electrical, supply = e.supply && term('electrical', 'SUPPLY', e.supply.key, e.supply.spaceId, e.supply.point, e.supply.elevationMm);
    const panels = new Map(e.panels.map(p => [p.key, term('electrical', 'PANEL', p.key, p.spaceId, p.point, p.elevationMm, p.footprint)]));
    const loadTerms = new Map(e.loads.map(l => [l.key, term('electrical', 'LOAD', l.key, l.spaceId, l.point, l.elevationMm)]));
    const incomplete = !e.supply || e.supply.systemVoltage === null || e.supply.phaseSystem === null || e.supply.frequencyHz === null;
    net('ELECTRICAL_FEEDER', 'ELECTRICAL', 'ELECTRICAL_FEEDER', supply ?? null, [...panels.values()], e.feeder.size, e.clearance, { elevations: e.feeder.elevations }, e.feeder.routing, incomplete);
    const r = e.circuitRouting.routing;
    for (const c of e.circuits) net(`ELECTRICAL_CIRCUIT:${c.key}`, 'ELECTRICAL', 'ELECTRICAL_CIRCUIT', panels.get(c.panel) ?? null, c.loads.map(l => loadTerms.get(l) ?? null), e.circuitRouting.size,
      e.clearance, { elevations: e.circuitRouting.elevations }, r.mode === 'FIXED' ? { mode: 'FIXED', routes: r.routes.filter(x => c.loads.includes(x.terminal)) } : r);
  }
  if (input.hvac) {
    const h = input.hvac, units = new Map(h.equipment.map(x => [x.key, term('hvac', 'EQUIPMENT', x.key, x.spaceId, x.point, x.elevationMm, x.footprint)]));
    for (const s of h.systems) {
      const unit = units.get(s.equipment), root = unit ? term('hvac', 'EQUIPMENT', `${s.key}.connection`, unit.spaceId, s.connection.point, s.connection.elevationMm) : null;
      net(`HVAC_${s.kind}:${s.key}`, 'HVAC', `HVAC_${s.kind}`, root, s.terminals.map(t => term('hvac', 'AIR_TERMINAL', t.key, t.spaceId, t.point, t.elevationMm)), s.ductSection, h.clearance,
        { elevations: s.elevations }, s.routing);
    }
  }
  same('TERMINALS', model.terminals, terms.sort((a, b) => cmp(a.id, b.id)), 'Terminals differ from the explicit input');
  same('NETWORKS', model.networks.map(({ missing: _m, ...n }) => n), nets.sort((a, b) => cmp(a.key, b.key)), 'Networks differ from the explicit input');
  for (const n of model.networks) if ((n.status === 'READY') !== (n.missing.length === 0)) fail('NETWORKS', `${n.key}: status and missing inputs disagree`);
  const ls = input.lifeSafety;
  const exits = !ls?.exits ? [] : ls.exits.mode === 'EXPLICIT' ? [...new Set(ls.exits.openingIds)].sort() : geometry.site?.primaryEntryOpeningId ? [geometry.site.primaryEntryOpeningId] : [];
  if (digest(model.exits.openingIds) !== digest(exits) || model.exits.status !== (!ls ? 'NOT_REQUESTED' : exits.length ? 'DESIGNATED' : 'INPUT_INCOMPLETE')) fail('EXITS', 'Exit designation differs from the input');
  for (const e of model.exits.openingIds) {
    const o = geometry.openings.find(x => x.id === e), w = o && geometry.walls.find(x => x.id === o.wallId);
    if (!o || !w || !((o.kind === 'door' || (o.kind === 'opening' && o.purpose === 'passage')) && o.sillMm === 0 && w.baseOffsetMm === 0 && wallSpaceIds(geometry, w).length === 1))
      fail('EXITS', `Exit ${e} is not a floor-level exterior door or passage`, e);
  }
  if (digest(model.exits.obstructedOpeningIds) !== digest(ls ? [...new Set(ls.obstructedOpeningIds)].sort() : [])) fail('EXITS', 'Obstructed openings differ from the input');
  same('REQUESTED', model.requested, { plumbing: !!input.plumbing, electrical: !!input.electrical, hvac: !!input.hvac, lifeSafety: !!input.lifeSafety, verticalTransport: !!input.verticalTransport },
    'Requested disciplines differ');
  same('CLAIMS', { claims: model.claims, assumptions: model.assumptions }, { claims: CLAIMS, assumptions: ASSUMPTIONS }, 'Claims or assumptions were altered');
  return { validator: MODEL_VALIDATOR, status: diagnostics.length ? 'INVALID' : 'VALID', diagnostics };
}

// ------------------------------------------------------------------ result validator
const half = (s: Net['size']) => !s ? { p: 0, v: 0 } : s.shape === 'ROUND' ? { p: Math.ceil(s.diameterMm / 2), v: Math.ceil(s.diameterMm / 2) }
  : { p: Math.ceil(Math.max(s.widthMm, s.heightMm) / 2), v: Math.ceil(s.heightMm / 2) };
const segBox = (a: P3, b: P3, p: number, v: number): Box => ({ minX: Math.min(a.x, b.x) - p, maxX: Math.max(a.x, b.x) + p, minY: Math.min(a.y, b.y) - v, maxY: Math.max(a.y, b.y) + v,
  minZ: Math.min(a.z, b.z) - p, maxZ: Math.max(a.z, b.z) + p });
const meet = (a: Box, b: Box, pad = 0): Box | null => {
  const r = { minX: Math.max(a.minX - pad, b.minX), maxX: Math.min(a.maxX + pad, b.maxX), minY: Math.max(a.minY - pad, b.minY), maxY: Math.min(a.maxY + pad, b.maxY),
    minZ: Math.max(a.minZ - pad, b.minZ), maxZ: Math.min(a.maxZ + pad, b.maxZ) };
  return r.maxX > r.minX && r.maxY > r.minY && r.maxZ > r.minZ ? r : null;
};
const storey = (m: SystemsModel, y: number) => m.levels.find(l => y >= l.elevationMm && y < l.topMm) ?? (y < m.levels[0]!.elevationMm ? m.levels[0]! : m.levels.at(-1)!);
const onSeg = (p: P3, a: P3, b: P3) => {
  const inRange = (v: number, s: number, t: number) => v >= Math.min(s, t) - TOL && v <= Math.max(s, t) + TOL;
  if (!inRange(p.x, a.x, b.x) || !inRange(p.y, a.y, b.y) || !inRange(p.z, a.z, b.z)) return false;
  if (a.x === b.x && a.z === b.z) return p.x === a.x && p.z === a.z;
  if ((a.x === b.x && p.x !== a.x) || (a.z === b.z && p.z !== a.z)) return false;
  const t = a.x !== b.x ? (p.x - a.x) / (b.x - a.x) : (p.z - a.z) / (b.z - a.z);
  return Math.abs(a.y + t * (b.y - a.y) - p.y) <= TOL;
};

/** Own egress graph (doubled plan coordinates) and a plain O(V²) Dijkstra, a different implementation from the calculator's heap search. */
function egress(m: SystemsModel) {
  const nodes: { x: number; z: number; s: string }[] = [], adj: { to: number; w: number; via: string | null }[][] = [], key = new Map<string, number>();
  const blocked = new Set(m.exits.obstructedOpeningIds), doors = m.openings.filter(o => o.traversable && !blocked.has(o.openingId));
  const ends = (t: SystemsModel['stairs'][number]) => {
    const f = t.flight, cx = f.minX + f.maxX, cz = f.minZ + f.maxZ;
    return { lo: { '+x': { x: 2 * f.minX, z: cz }, '-x': { x: 2 * f.maxX, z: cz }, '+z': { x: cx, z: 2 * f.minZ }, '-z': { x: cx, z: 2 * f.maxZ } }[t.direction],
      hi: { '+x': { x: 2 * f.maxX, z: cz }, '-x': { x: 2 * f.minX, z: cz }, '+z': { x: cx, z: 2 * f.maxZ }, '-z': { x: cx, z: 2 * f.minZ } }[t.direction] };
  };
  for (const s of m.spaces) {
    const holes = [...m.stairs.filter(t => t.fromLevelId === s.levelId || t.toLevelId === s.levelId).map(t => [{ x: t.flight.minX, z: t.flight.minZ }, { x: t.flight.maxX, z: t.flight.minZ },
      { x: t.flight.maxX, z: t.flight.maxZ }, { x: t.flight.minX, z: t.flight.maxZ }]), ...m.plates.filter(p => p.levelId === s.levelId).flatMap(p => p.voids)];
    const pts = [...twice(s.boundary), ...holes.flatMap(twice), ...doors.filter(o => o.spaceIds.includes(s.spaceId)).map(o => o.center2),
      ...m.stairs.flatMap(t => [...(t.fromLevelId === s.levelId ? [ends(t).lo] : []), ...(t.toLevelId === s.levelId ? [ends(t).hi] : [])])];
    const xs = [...new Set(pts.map(p => p.x))].sort((a, b) => a - b), zs = [...new Set(pts.map(p => p.z))].sort((a, b) => a - b);
    const ok = (x: number, z: number, k: number) => pointLocation({ x, z }, s.boundary.map(p => ({ x: k * p.x, z: k * p.z }))) >= 0
      && holes.every(h => pointLocation({ x, z }, h.map(p => ({ x: k * p.x, z: k * p.z }))) !== 1);
    for (const x of xs) for (const z of zs) if (ok(x, z, 2)) { key.set(`${s.spaceId}|${x}|${z}`, nodes.length); nodes.push({ x, z, s: s.spaceId }); adj.push([]); }
    const join = (a: number | undefined, b: number | undefined, mx: number, mz: number) => {
      if (a === undefined || b === undefined || !ok(mx, mz, 4)) return;
      const w = Math.abs(nodes[a]!.x - nodes[b]!.x) + Math.abs(nodes[a]!.z - nodes[b]!.z); adj[a]!.push({ to: b, w, via: null }); adj[b]!.push({ to: a, w, via: null });
    };
    for (let i = 1; i < xs.length; i++) for (const z of zs) join(key.get(`${s.spaceId}|${xs[i - 1]}|${z}`), key.get(`${s.spaceId}|${xs[i]}|${z}`), xs[i - 1]! + xs[i]!, 2 * z);
    for (let j = 1; j < zs.length; j++) for (const x of xs) join(key.get(`${s.spaceId}|${x}|${zs[j - 1]}`), key.get(`${s.spaceId}|${x}|${zs[j]}`), 2 * x, zs[j - 1]! + zs[j]!);
  }
  const link = (a: number | undefined, b: number | undefined, w: number, via: string) => { if (a !== undefined && b !== undefined) { adj[a]!.push({ to: b, w, via }); adj[b]!.push({ to: a, w, via }); } };
  for (const o of doors) if (o.spaceIds.length === 2) link(key.get(`${o.spaceIds[0]}|${o.center2.x}|${o.center2.z}`), key.get(`${o.spaceIds[1]}|${o.center2.x}|${o.center2.z}`), 0, `OPENING:${o.openingId}`);
  const find = (levelId: string, p: Point2Mm) => m.spaces.filter(s => s.levelId === levelId).map(s => key.get(`${s.spaceId}|${p.x}|${p.z}`)).find(v => v !== undefined);
  for (const t of m.stairs) link(find(t.fromLevelId, ends(t).lo), find(t.toLevelId, ends(t).hi), 2 * t.runMm, `STAIR:${t.stairId}`);
  const exitNode = (e: string) => { const o = m.openings.find(x => x.openingId === e)!; return blocked.has(e) ? undefined : key.get(`${o.spaceIds[0]}|${o.center2.x}|${o.center2.z}`); };
  const run = (from: number[], allowed?: Set<number>) => {
    const dist: number[] = new Array(nodes.length).fill(Infinity), done: boolean[] = new Array(nodes.length).fill(false);
    for (const s of from) dist[s] = 0;
    for (;;) {
      let v = -1;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i]! < Infinity && (v < 0 || dist[i]! < dist[v]!)) v = i;
      if (v < 0) return dist;
      done[v] = true;
      for (const e of adj[v]!) if ((!allowed || allowed.has(e.to)) && dist[v]! + e.w < dist[e.to]!) dist[e.to] = dist[v]! + e.w;
    }
  };
  return { nodes, adj, key, run, exitNode, ends };
}

export function validateSystemsResults(draft: { binding: SystemsBinding; inputHash: string; input: SystemsInput; model: SystemsModel; results: SystemsResults },
  context: { binding: SystemsBinding; environmental: { analysisId: string; snapshot: EnvironmentalSnapshot } | null }): ResultValidation {
  const diagnostics: Diagnostic[] = [];
  const fail = (code: string, message: string, targetId: string | null = null) => { if (diagnostics.length < 200) diagnostics.push({ code, targetId, message, severity: 'ERROR' }); };
  const { model: m, results: r, input } = draft;
  if (digest(draft.binding) !== digest(context.binding) || digest(m.binding) !== digest(context.binding)) fail('BINDING', 'Result is not bound to the requested revision and upstream artifacts');
  if (digest([r.plumbing.notEvaluated, r.electrical.notEvaluated, r.hvac.notEvaluated, r.lifeSafety.notEvaluated, r.verticalTransport.notEvaluated])
    !== digest([NOT_EVALUATED.plumbing, NOT_EVALUATED.electrical, NOT_EVALUATED.hvac, NOT_EVALUATED.lifeSafety, NOT_EVALUATED.verticalTransport]) || r.quantities.costing !== 'NOT_EVALUATED')
    fail('CLAIMS', 'A deliberately unevaluated capability is reported as evaluated');
  const terminal = new Map(m.terminals.map(t => [t.id, t])), projectId = m.binding.projectId, network = new Map(m.networks.map(n => [n.id, n]));
  let segmentsChecked = 0;
  const segments: { net: Net; entity: string; a: P3; b: P3; box: Box }[] = [];
  const penetrations: SystemsResults['coordination']['penetrations'] = [];

  // ---------------------------------------------------------------- networks: continuity, lengths, slope, penetrations, airflow
  if (r.networks.length !== m.networks.length) fail('NETWORKS', 'Network inventory differs');
  m.networks.forEach((n, ni) => {
    const res = r.networks[ni];
    if (!res || res.networkId !== n.id) { fail('NETWORKS', `Missing result for ${n.key}`, n.id); return; }
    if ((n.status === 'READY') === (res.status === 'INPUT_INCOMPLETE')) fail('STATUS', `${n.key}: status contradicts its input completeness`, n.id);
    if (res.status !== 'ROUTED') { if (res.branches.length || res.length.value || res.failure === null) fail('STATUS', `${n.key}: an unrouted network reports geometry or no failure`, n.id); return; }
    const root = terminal.get(n.rootId!)!, rootP = { x: root.point!.x, y: root.y, z: root.point!.z }, gravity = n.system === 'SANITARY', { p, v } = half(n.size);
    if (digest(res.branches.map(b => b.terminalId).sort()) !== digest(n.terminalIds)) fail('ROUTE', `${n.key}: branches do not serve exactly its terminals`, n.id);
    let horizontal = 0, vertical = 0, bends = 0, transitions = 0;
    const dir = (u: P3, w: P3) => u.x !== w.x ? `x${Math.sign(w.x - u.x)}` : u.z !== w.z ? `z${Math.sign(w.z - u.z)}` : 'y';
    res.branches.forEach((b, bi) => {
      const t = terminal.get(b.terminalId), pts = b.points;
      if (!t || pts[0]!.x !== t.point!.x || pts[0]!.z !== t.point!.z || Math.abs(pts[0]!.y - t.y) > TOL) fail('ROUTE', `${n.key}: a branch does not start at its terminal`, b.terminalId);
      const end = pts.at(-1)!, atRoot = end.x === rootP.x && end.z === rootP.z && Math.abs(end.y - rootP.y) <= TOL;
      const joined = res.branches.slice(0, bi).some(e => e.points.some((q, k) => k > 0 && onSeg(end, e.points[k - 1]!, q)));
      if (bi === 0 ? !atRoot : !atRoot && !joined) fail('ROUTE', `${n.key}: a branch is disconnected from its network`, b.terminalId);
      if ((b.joins === 'ROOT') !== atRoot) fail('ROUTE', `${n.key}: branch join label is wrong`, b.terminalId);
      pts.forEach((q, k) => {
        const a = pts[k - 1]; if (!a) return;
        segmentsChecked++;
        const dx = q.x !== a.x, dz = q.z !== a.z, dy = Math.abs(q.y - a.y) > TOL;
        if ((dx && dz) || (!dx && !dz && !dy) || (!gravity && (dx || dz) && dy)) fail('ROUTE', `${n.key}: a segment is zero-length or not orthogonal`, b.terminalId);
        if (dx || dz) {
          horizontal += Math.abs(q.x - a.x) + Math.abs(q.z - a.z);
          if (n.mode === 'PLANNED' && !gravity && !n.levels.some(l => l.y === q.y)) fail('ROUTE', `${n.key}: a horizontal run is not at a declared routing elevation`, b.terminalId);
        } else { vertical += Math.abs(q.y - a.y); transitions += m.levels.filter(l => Math.min(a.y, q.y) < l.elevationMm && l.elevationMm <= Math.max(a.y, q.y)).length; }
        const o = pts[k - 2];
        if (o && dir(o, a) !== dir(a, q)) bends++;
        if (gravity) {
          // Flow runs terminal → outlet: never uphill; horizontal runs fall at least the declared slope and stay inside a drainage band.
          if (q.y > a.y + TOL) fail('SLOPE', `${n.key}: an uphill drainage segment`, b.terminalId);
          if ((dx || dz) && (a.y - q.y) + TOL < (Math.abs(q.x - a.x) + Math.abs(q.z - a.z)) * n.slope!.rise / n.slope!.run) fail('SLOPE', `${n.key}: a run is flatter than the declared slope`, b.terminalId);
          if ((dx || dz) && ![a, q].every(e => n.levels.some(l => l.band && e.y <= l.band.top + TOL && e.y >= l.band.bottom - TOL))) fail('SLOPE', `${n.key}: a run leaves every drainage band`, b.terminalId);
        }
        segments.push({ net: n, entity: `networks/${n.key}/branch-${bi}/segment-${k - 1}`, a, b: q, box: segBox(a, q, p, v) });
        const add = (collection: 'walls' | 'slabs', hostId: string, location: P3) => penetrations.push({ id: id(projectId, 'penetration', `${n.key}:${collection}:${hostId}:${location.x}:${location.y}:${location.z}`),
          networkId: n.id, host: { collection, id: hostId }, location, sizeMm: { width: 2 * p, height: 2 * v, clearance: n.clearanceMm }, review: 'REVIEW_REQUIRED' });
        if (!dx && !dz) {
          for (const pl of m.plates) if (Math.min(a.y, q.y) < pl.topY && Math.max(a.y, q.y) > pl.bottomY && pointLocation({ x: q.x, z: q.z }, pl.outer) >= 0
            && pl.voids.every(h => pointLocation({ x: q.x, z: q.z }, h) !== 1)) add('slabs', pl.slabId, { x: q.x, y: pl.topY, z: q.z });
        } else for (const w of m.walls) {
          if ((w.start.x === w.end.x) !== dx) continue;
          const c = dx ? w.start.x : w.start.z, s0 = dx ? a.x : a.z, s1 = dx ? q.x : q.z, across = dx ? a.z : a.x;
          const wl = dx ? Math.min(w.start.z, w.end.z) : Math.min(w.start.x, w.end.x), wh = dx ? Math.max(w.start.z, w.end.z) : Math.max(w.start.x, w.end.x);
          if (!(Math.min(s0, s1) < c && c <= Math.max(s0, s1)) || across < wl || across > wh || !(Math.min(a.y, q.y) - v < w.topY && Math.max(a.y, q.y) + v > w.bottomY)) continue;
          const y = a.y + (q.y - a.y) * (c - s0) / (s1 - s0);
          add('walls', w.wallId, dx ? { x: c, y, z: across } : { x: across, y, z: c });
        }
      });
    });
    if (horizontal !== res.horizontalLength.value || Math.abs(vertical - res.verticalLength.value) > TOL || Math.abs(horizontal + vertical - res.length.value) > TOL || bends !== res.bends
      || transitions !== res.levelTransitions) fail('LENGTH', `${n.key}: length, bend or transition totals do not recompute`, n.id);
    if (gravity) {
      const d = res.drainage, first = res.branches[0]!.points, arrival = first.length > 1 ? first[first.length - 2]! : first[0]!;
      if (!d || d.outletElevation.value !== root.y || Math.abs(d.arrivalElevation.value - arrival.y) > TOL || arrival.y + TOL < root.y || digest(d.slope) !== digest(n.slope))
        fail('SLOPE', `${n.key}: the outlet arrival does not recompute or lies below the outlet`, n.id);
      for (const s of d?.stacks ?? []) if (!res.branches.some(b => b.points.some((q, k) => k > 0 && q.x === s.point.x && q.z === s.point.z && b.points[k - 1]!.x === q.x && b.points[k - 1]!.z === q.z)))
        fail('SLOPE', `${n.key}: a reported stack has no vertical run`, n.id);
    } else if (res.drainage) fail('ROUTE', `${n.key}: drainage data on a pressure network`, n.id);
    if (n.discipline === 'HVAC') {
      const sys = input.hvac!.systems.find(s => `HVAC_${s.kind}:${s.key}` === n.key)!;
      const flow = new Map(sys.terminals.map(t => [id(projectId, 'terminal', `hvac:${t.key}`), t.airflow ? t.airflow.unit === 'm3/s' ? Qnum(t.airflow.value) : Qdiv(Qnum(t.airflow.value), Qn(1000n)) : null]));
      const own = res.branches.map(b => flow.get(b.terminalId) ?? null), into = res.branches.map(() => [] as { at: number; from: number }[]);
      res.branches.forEach((b, i) => {
        if (!i || b.joins !== 'NETWORK') return;
        const e = b.points.at(-1)!;
        for (let c = 0; c < i; c++) { const k = res.branches[c]!.points.findIndex(q => q.x === e.x && q.z === e.z && Math.abs(q.y - e.y) <= TOL); if (k >= 0) { into[c]!.push({ at: k, from: i }); break; } }
      });
      const total = (i: number): Q | null => into[i]!.reduce<Q | null>((s, j) => { const t = total(j.from); return s === null || t === null ? null : Qadd(s, t); }, own[i] ?? null);
      const s = n.size, expected = res.branches.flatMap((b, i) => b.points.slice(1).map((_, k) => {
        const f = into[i]!.filter(j => j.at <= k).reduce<Q | null>((acc, j) => { const t = total(j.from); return acc === null || t === null ? null : Qadd(acc, t); }, own[i] ?? null);
        const vel = f === null || !s ? null : s.shape === 'RECTANGULAR' ? Qstr(Qdiv(f, Qn(BigInt(s.widthMm * s.heightMm), 1_000_000n))) : Number(f[0]) / Number(f[1]) / (Math.PI * s.diameterMm ** 2 / 4e6);
        return { flow: f === null ? null : Qstr(f), vel };
      }));
      const got = res.airflow?.segments ?? [];
      if (got.length !== expected.length || expected.some((e, k) => e.flow !== (got[k]!.flow?.exact ?? null) || (typeof e.vel === 'string' ? e.vel !== got[k]!.velocity?.exact
        : e.vel === null ? got[k]!.velocity !== null : Math.abs(e.vel - (got[k]!.velocity?.value ?? NaN)) > 1e-9 * Math.max(1, Math.abs(e.vel))))) fail('AIRFLOW', `${n.key}: segment airflow or velocity does not recompute`, n.id);
      const sum = own.reduce<Q | null>((acc, f) => acc === null || f === null ? null : Qadd(acc, f), Qn(0n));
      if ((sum === null ? null : Qstr(sum)) !== (res.airflow?.total?.exact ?? null)) fail('AIRFLOW', `${n.key}: total airflow does not recompute`, n.id);
    } else if (res.airflow) fail('AIRFLOW', `${n.key}: airflow on a non-HVAC network`, n.id);
  });
  const pens = [...new Map(penetrations.map(x => [x.id, x])).values()].sort((a, b) => cmp(a.id, b.id));
  if (digest(pens) !== digest(r.coordination.penetrations)) fail('PENETRATION', 'Penetration proposals do not recompute');

  // ---------------------------------------------------------------- egress
  const ls = r.lifeSafety;
  let reachable: Set<string> | null = null, egressSpaces = 0;
  if (m.exits.status === 'DESIGNATED') {
    const e = egress(m), sources = m.exits.openingIds.map(e.exitNode).filter((x): x is number => x !== undefined), dist = e.run(sources);
    reachable = new Set();
    if (ls.status !== 'ANALYZED' || digest(ls.exits) !== digest(m.exits.openingIds) || ls.spaces.length !== m.spaces.length) fail('EGRESS', 'Life-safety status, exits or inventory are wrong');
    const inSpace = (levelId: string, pt: Point2Mm) => m.spaces.find(x => x.levelId === levelId && pointLocation(pt, twice(x.boundary)) >= 0)?.spaceId;
    for (const s of m.spaces) {
      egressSpaces++;
      const ids = e.nodes.map((nd, i) => nd.s === s.spaceId ? i : -1).filter(i => i >= 0), ok = ids.length > 0 && ids.every(i => Number.isFinite(dist[i]!));
      const rep = ls.spaces.find(x => x.spaceId === s.spaceId);
      if (ok) reachable.add(s.spaceId);
      if (!rep || rep.reachable !== ok) { fail('EGRESS', `Reachability of ${s.spaceId} does not recompute`, s.spaceId); continue; }
      if (!ok) continue;
      const far = Math.max(...ids.map(i => dist[i]!)), remote = rep.mostRemotePoint2 ? e.key.get(`${s.spaceId}|${rep.mostRemotePoint2.x}|${rep.mostRemotePoint2.z}`) : undefined;
      if (rep.distance?.value !== far / 2 || remote === undefined || dist[remote] !== far) fail('EGRESS', `Egress distance of ${s.spaceId} does not recompute`, s.spaceId);
      // The reported route must be a connected chain of openings and stairs from this space to its named exit.
      let here = s.spaceId, chain = true;
      rep.via.forEach((step, k) => {
        if (step.kind === 'OPENING') {
          const o = m.openings.find(x => x.openingId === step.id);
          if (!o || !o.spaceIds.includes(here)) { chain = false; return; }
          if (k === rep.via.length - 1) { if (step.id !== rep.exitOpeningId || !m.exits.openingIds.includes(step.id)) chain = false; return; }
          here = o.spaceIds.find(x => x !== here) ?? here;
        } else {
          const t = m.stairs.find(x => x.stairId === step.id);
          if (!t) { chain = false; return; }
          const lo = inSpace(t.fromLevelId, e.ends(t).lo), hi = inSpace(t.toLevelId, e.ends(t).hi);
          if (here === lo) here = hi ?? ''; else if (here === hi) here = lo ?? ''; else chain = false;
        }
      });
      if (!chain || !rep.via.length || rep.levelTransitions !== rep.via.filter(x => x.kind === 'STAIR').length) fail('EGRESS', `Egress route of ${s.spaceId} is not a connected chain to its exit`, s.spaceId);
      const perExit = m.exits.openingIds.filter(x => { const nd = e.exitNode(x); if (nd === undefined) return false; const d = e.run([nd]); return ids.every(i => Number.isFinite(d[i]!)); }).length;
      if (rep.distinctExitsReachable !== perExit || rep.disjointExitRoutes > perExit || rep.disjointExitRoutes < 1 || (perExit === 1 && rep.disjointExitRoutes !== 1))
        fail('EGRESS', `Exit counts of ${s.spaceId} do not recompute`, s.spaceId);
    }
    if (digest(ls.unreachableSpaceIds) !== digest(m.spaces.map(s => s.spaceId).filter(s => !reachable!.has(s))) || ls.egressAvailable !== (reachable.size === m.spaces.length))
      fail('EGRESS', 'Unreachable spaces do not recompute');
    const exitSpaces = new Set(m.exits.openingIds.map(x => m.openings.find(o => o.openingId === x)!.spaceIds[0]));
    const deadEnds = m.spaces.filter(s => s.circulation && !exitSpaces.has(s.spaceId)).flatMap(s => {
      const mine = e.nodes.map((nd, i) => nd.s === s.spaceId ? i : -1).filter(i => i >= 0), links = new Map<string, number>();
      for (const i of mine) for (const x of e.adj[i]!) if (x.via && e.nodes[x.to]!.s !== s.spaceId && m.spaces.find(q => q.spaceId === e.nodes[x.to]!.s)!.circulation && !links.has(x.via)) links.set(x.via, i);
      if (links.size !== 1) return [];
      const [[via, at]] = [...links] as [[string, number]], d = e.run([at], new Set(mine));
      return [{ spaceId: s.spaceId, length: Math.max(...mine.map(i => d[i]!).filter(Number.isFinite)) / 2, via }];
    });
    if (digest(deadEnds) !== digest(ls.deadEnds.map(d => ({ spaceId: d.spaceId, length: d.length.value, via: `${d.connection.kind}:${d.connection.id}` })))) fail('EGRESS', 'Dead-end lengths do not recompute');
    if (ls.nodes !== e.nodes.length) fail('EGRESS', 'Egress node count does not recompute');
  } else if (ls.status !== (m.exits.status === 'NOT_REQUESTED' ? 'NOT_EVALUATED' : 'INPUT_INCOMPLETE') || ls.spaces.length) fail('EGRESS', 'Life-safety status contradicts the exit designation');

  // ---------------------------------------------------------------- vertical transport and the full clash set (own box geometry)
  const clashes: Clash[] = [];
  const clash = (type: Clash['type'], dA: string, dB: string, eA: string, eB: string, bounds: Box, severity: Clash['severity'], basis: Clash['basis'], key = `${type}:${eA}:${eB}`) =>
    clashes.push({ id: id(projectId, 'clash', key), type, disciplineA: dA, disciplineB: dB, entityA: eA, entityB: eB, bounds, severity, basis,
      evidence: { overlapX: bounds.maxX - bounds.minX, overlapY: bounds.maxY - bounds.minY, overlapZ: bounds.maxZ - bounds.minZ }, resolution: 'UNRESOLVED' });
  const structure = m.structure.members.filter(x => x.halfSizeMm !== null).map(x => {
    const h = x.halfSizeMm!, range = (a: number, b: number) => a === b ? [a - h, a + h] : [Math.min(a, b), Math.max(a, b)];
    const [minX, maxX] = range(x.start.x, x.end.x), [minY, maxY] = range(x.start.y, x.end.y), [minZ, maxZ] = range(x.start.z, x.end.z);
    return { id: x.memberId, box: { minX: minX!, maxX: maxX!, minY: minY!, maxY: maxY!, minZ: minZ!, maxZ: maxZ! } };
  });
  const shafts: { key: string; box: Box }[] = [];
  const vt = r.verticalTransport, requested = [...(input.verticalTransport?.elevators ?? [])].sort((a, b) => cmp(a.key, b.key));
  if ((vt.status === 'NOT_EVALUATED') !== !input.verticalTransport || vt.elevators.length !== requested.length) fail('VERTICAL', 'Vertical-transport inventory or status is wrong');
  vt.elevators.forEach((ev, k) => {
    const q = requested[k];
    if (!q || q.key !== ev.key || ev.architectureMutation !== 'NONE') { fail('VERTICAL', 'Elevator inventory differs', ev.key); return; }
    const served = m.levels.filter(l => q.servedLevelIds.includes(l.levelId));
    if (digest(ev.servedLevelIds) !== digest(served.map(l => l.levelId)) || ev.bottomY !== served[0]!.elevationMm || ev.topY !== served.at(-1)!.topMm) fail('VERTICAL', 'Served levels do not recompute', ev.key);
    if (!ev.shaft) { if (ev.status !== 'REJECTED' || q.placement.mode === 'FIXED') fail('VERTICAL', 'An elevator without a shaft must be a rejected planner search', ev.key); return; }
    const s = ev.shaft;
    if (s.maxX - s.minX !== q.shaft.widthMm || s.maxZ - s.minZ !== q.shaft.depthMm || (q.placement.mode === 'FIXED' && (s.minX !== q.placement.origin.x || s.minZ !== q.placement.origin.z || ev.door.side !== q.door.side)))
      fail('VERTICAL', 'The shaft is not the requested size or was relocated', ev.key);
    const box: Box = { ...s, minY: ev.bottomY, maxY: ev.topY }, blocking: string[] = [];
    const block = (type: Clash['type'], entity: string, dB: string, b: Box) => {
      clash(type, 'VERTICAL_TRANSPORT', dB, `elevators/${ev.key}`, entity, b, 'BLOCKING', 'PHYSICAL_INTERSECTION', `elevator:${ev.key}:${entity}`); blocking.push(clashes.at(-1)!.id);
    };
    for (const t of m.stairs) if (q.servedLevelIds.includes(t.fromLevelId) || q.servedLevelIds.includes(t.toLevelId)) [t.flight, ...t.landings].forEach((rc, i) => {
      const b = meet(box, { ...rc, minY: t.bottomY, maxY: t.topY + 1 }); if (b) block('VERTICAL_TRANSPORT_CLASH', `stairs/${t.stairId}${i ? `/landing-${i}` : ''}`, 'ARCHITECTURE', b);
    });
    for (const pl of m.plates.filter(x => q.servedLevelIds.includes(x.levelId))) pl.voids.forEach((h, i) => {
      const b = meet(box, { ...bbox(h), minY: pl.bottomY, maxY: pl.topY }); if (b) block('VERTICAL_TRANSPORT_CLASH', `slabs/${pl.slabId}/void-${i}`, 'ARCHITECTURE', b);
    });
    for (const st of structure) { const b = meet(box, st.box); if (b) block('VERTICAL_TRANSPORT_CLASH', `structure/${st.id}`, 'STRUCTURE', b); }
    for (const o of m.openings.filter(x => x.traversable && q.servedLevelIds.includes(x.levelId))) {
      const lv = m.levels.find(l => l.levelId === o.levelId)!;
      const b = meet({ minX: 2 * s.minX, maxX: 2 * s.maxX, minZ: 2 * s.minZ, maxZ: 2 * s.maxZ, minY: ev.bottomY, maxY: ev.topY }, { ...o.footprint2, minY: lv.elevationMm, maxY: lv.topMm });
      if (b) block('EGRESS_OBSTRUCTION', `openings/${o.openingId}`, 'ARCHITECTURE', { ...b, minX: b.minX / 2, maxX: b.maxX / 2, minZ: b.minZ / 2, maxZ: b.maxZ / 2 });
    }
    const inside = served.every(l => ringContains(l.boundary, [{ x: s.minX, z: s.minZ }, { x: s.maxX, z: s.minZ }, { x: s.maxX, z: s.maxZ }, { x: s.minX, z: s.maxZ }]));
    const fits = (ev.door.side.endsWith('x') ? q.shaft.depthMm : q.shaft.widthMm) >= q.door.widthMm;
    if ((ev.status === 'PROPOSED') !== (inside && fits && blocking.length === 0) || digest(ev.blockingClashIds) !== digest([...blocking].sort())) fail('VERTICAL', 'Elevator status or blocking clashes do not recompute', ev.key);
    if (ev.status === 'PROPOSED') shafts.push({ key: ev.key, box });
    // Overlapped area by vertical strips between consecutive x-coordinates: a different method from polygon clipping.
    const area = (ring: readonly Point2Mm[]) => {
      const xs = [...new Set([...ring.map(pt => pt.x), s.minX, s.maxX])].filter(x => x >= s.minX && x <= s.maxX).sort((a, b) => a - b);
      let total = 0;
      for (let i = 1; i < xs.length; i++) {
        const mx2 = xs[i - 1]! + xs[i]!;
        const zs = ring.flatMap((pt, j) => { const nx = ring[(j + 1) % ring.length]!; return pt.z === nx.z && Math.min(2 * pt.x, 2 * nx.x) < mx2 && mx2 < Math.max(2 * pt.x, 2 * nx.x) ? [pt.z] : []; }).sort((a, b) => a - b);
        for (let j = 0; j + 1 < zs.length; j += 2) total += (xs[i]! - xs[i - 1]!) * Math.max(0, Math.min(zs[j + 1]!, s.maxZ) - Math.max(zs[j]!, s.minZ));
      }
      return total;
    };
    const overlapped = m.spaces.filter(x => q.servedLevelIds.includes(x.levelId)).map(x => ({ spaceId: x.spaceId, area: { value: area(x.boundary), unit: 'mm2' } })).filter(x => x.area.value > 0);
    if (digest(overlapped) !== digest(ev.overlappedSpaces)) fail('VERTICAL', 'Overlapped space areas do not recompute', ev.key);
    const crossed = m.walls.filter(w => q.servedLevelIds.includes(w.levelId) && (w.start.z === w.end.z
      ? s.minZ < w.start.z && w.start.z < s.maxZ && Math.min(Math.max(w.start.x, w.end.x), s.maxX) > Math.max(Math.min(w.start.x, w.end.x), s.minX)
      : s.minX < w.start.x && w.start.x < s.maxX && Math.min(Math.max(w.start.z, w.end.z), s.maxZ) > Math.max(Math.min(w.start.z, w.end.z), s.minZ))).map(w => w.wallId);
    if (digest(crossed) !== digest(ev.crossedWallIds)) fail('VERTICAL', 'Crossed walls do not recompute', ev.key);
    const mx = s.minX + s.maxX, mz = s.minZ + s.maxZ, side = ev.door.side;
    const probe = side === '+x' ? { x: 2 * s.maxX + 1, z: mz } : side === '-x' ? { x: 2 * s.minX - 1, z: mz } : side === '+z' ? { x: mx, z: 2 * s.maxZ + 1 } : { x: mx, z: 2 * s.minZ - 1 };
    const doorSpaces = ev.servedLevelIds.map(l => m.spaces.find(x => x.levelId === l && pointLocation(probe, twice(x.boundary)) === 1)?.spaceId ?? null);
    const access = reachable === null ? 'NOT_EVALUATED' : doorSpaces.every(x => x !== null && reachable!.has(x)) ? 'VERTICAL_ACCESS_PATH_AVAILABLE' : 'VERTICAL_ACCESS_PATH_NOT_AVAILABLE';
    if (digest(doorSpaces) !== digest(ev.door.spaceIds) || access !== ev.verticalAccess || !SIDES.includes(side)) fail('VERTICAL', 'Door space or vertical access does not recompute', ev.key);
    if (ev.structuralCheck !== (m.structure.status === 'BOUND' ? 'EVALUATED' : 'NOT_EVALUATED')) fail('VERTICAL', 'Structural check status is wrong', ev.key);
  });

  const group = (n: Net) => n.discipline === 'ELECTRICAL' ? 'ELECTRICAL' : n.id;
  const typeOf = (a: string, b: string): Clash['type'] => { const k = [a, b].sort().join('+');
    return k === 'ELECTRICAL+PLUMBING' ? 'PLUMBING_ELECTRICAL_CLEARANCE' : k === 'HVAC+PLUMBING' ? 'DUCT_PIPE_CLEARANCE' : k === 'ELECTRICAL+HVAC' ? 'DUCT_ELECTRICAL_CLEARANCE' : 'SERVICE_CLEARANCE'; };
  const pc = (type: Clash['type'], dA: string, dB: string, eA: string, eB: string, a: Box, b: Box, c: number) => {
    const hit = meet(a, b); if (hit) { clash(type, dA, dB, eA, eB, hit, 'BLOCKING', 'PHYSICAL_INTERSECTION'); return; }
    const near = c > 0 ? meet(a, b, c) : null; if (near) clash(type, dA, dB, eA, eB, near, 'REVIEW_REQUIRED', 'WITHIN_EXPLICIT_CLEARANCE');
  };
  segments.forEach((s, i) => {
    for (const t of segments.slice(i + 1)) if (t.net.id !== s.net.id && group(t.net) !== group(s.net))
      pc(typeOf(s.net.discipline, t.net.discipline), s.net.discipline, t.net.discipline, s.entity, t.entity, s.box, t.box, Math.max(s.net.clearanceMm ?? 0, t.net.clearanceMm ?? 0));
    for (const st of m.stairs) { const hit = meet(s.box, { ...st.flight, minY: st.bottomY, maxY: st.topY }); if (hit) clash('MEP_ARCHITECTURE_CLASH', s.net.discipline, 'ARCHITECTURE', s.entity, `stairs/${st.stairId}`, hit, 'BLOCKING', 'PHYSICAL_INTERSECTION'); }
    for (const st of structure) pc('MEP_STRUCTURE_CLASH', s.net.discipline, 'STRUCTURE', s.entity, `structure/${st.id}`, s.box, st.box, s.net.clearanceMm ?? 0);
    for (const sh of shafts) { const hit = meet(s.box, sh.box); if (hit) clash('SHAFT_CONFLICT', s.net.discipline, 'VERTICAL_TRANSPORT', s.entity, `elevators/${id(projectId, 'elevator', sh.key)}`, hit, 'BLOCKING', 'PHYSICAL_INTERSECTION'); }
    if (s.a.x === s.b.x && s.a.z === s.b.z) return;
    const alongX = s.a.z === s.b.z, mid2 = { x: s.a.x + s.b.x, z: s.a.z + s.b.z }, lv = storey(m, (s.a.y + s.b.y) / 2), { p } = half(s.net.size);
    if (pointLocation(s.a, lv.boundary) < 0 || pointLocation(s.b, lv.boundary) < 0 || pointLocation(mid2, twice(lv.boundary)) < 0)
      clash('MEP_ARCHITECTURE_CLASH', s.net.discipline, 'ARCHITECTURE', s.entity, `levels/${lv.levelId}/outside`, s.box, 'BLOCKING', 'PHYSICAL_INTERSECTION');
    for (const w of m.walls) {
      if ((w.start.z === w.end.z) !== alongX) continue;
      const c = alongX ? w.start.z : w.start.x, across = alongX ? s.a.z : s.a.x, t2 = w.thicknessMm / 2;
      const lo = Math.max(Math.min(alongX ? s.a.x : s.a.z, alongX ? s.b.x : s.b.z), Math.min(alongX ? w.start.x : w.start.z, alongX ? w.end.x : w.end.z));
      const hi = Math.min(Math.max(alongX ? s.a.x : s.a.z, alongX ? s.b.x : s.b.z), Math.max(alongX ? w.start.x : w.start.z, alongX ? w.end.x : w.end.z));
      if (Math.abs(across - c) < t2 + p && hi > lo && s.box.minY < w.topY && s.box.maxY > w.bottomY)
        clash('MEP_ARCHITECTURE_CLASH', s.net.discipline, 'ARCHITECTURE', s.entity, `walls/${w.wallId}`, { ...(alongX ? { minX: lo, maxX: hi, minZ: c - t2, maxZ: c + t2 } : { minX: c - t2, maxX: c + t2, minZ: lo, maxZ: hi }),
          minY: Math.max(s.box.minY, w.bottomY), maxY: Math.min(s.box.maxY, w.topY) }, 'BLOCKING', 'PHYSICAL_INTERSECTION');
    }
    for (const pl of m.plates) if (s.box.minY < pl.topY && s.box.maxY > pl.bottomY && pointLocation(mid2, twice(pl.outer)) >= 0 && pl.voids.every(h => pointLocation(mid2, twice(h)) !== 1))
      clash('MEP_ARCHITECTURE_CLASH', s.net.discipline, 'ARCHITECTURE', s.entity, `slabs/${pl.slabId}`, { ...s.box, minY: Math.max(s.box.minY, pl.bottomY), maxY: Math.min(s.box.maxY, pl.topY) },
        'REVIEW_REQUIRED', 'PHYSICAL_INTERSECTION');
  });
  for (const t of m.terminals.filter(x => x.footprint)) {
    const lv = m.levels.find(l => l.levelId === t.levelId)!, f = t.footprint!;
    for (const o of m.openings.filter(x => x.traversable && x.levelId === t.levelId)) {
      const hit = meet({ minX: 2 * f.minX, maxX: 2 * f.maxX, minZ: 2 * f.minZ, maxZ: 2 * f.maxZ, minY: lv.elevationMm, maxY: lv.topMm }, { ...o.footprint2, minY: lv.elevationMm, maxY: lv.topMm });
      if (hit) clash('EGRESS_OBSTRUCTION', 'EQUIPMENT', 'ARCHITECTURE', `terminals/${t.id}`, `openings/${o.openingId}`, { ...hit, minX: hit.minX / 2, maxX: hit.maxX / 2, minZ: hit.minZ / 2, maxZ: hit.maxZ / 2 },
        'REVIEW_REQUIRED', 'PHYSICAL_INTERSECTION');
    }
    for (const st of m.stairs.filter(x => x.fromLevelId === t.levelId || x.toLevelId === t.levelId)) [st.flight, ...st.landings].forEach((rc, i) => {
      const hit = meet({ ...f, minY: lv.elevationMm, maxY: lv.topMm }, { ...rc, minY: lv.elevationMm, maxY: lv.topMm });
      if (hit) clash('EGRESS_OBSTRUCTION', 'EQUIPMENT', 'ARCHITECTURE', `terminals/${t.id}`, `stairs/${st.stairId}${i ? `/landing-${i}` : ''}`, hit, 'REVIEW_REQUIRED', 'PHYSICAL_INTERSECTION');
    });
  }
  const expectedClashes = [...new Map(clashes.map(c => [c.id, c])).values()].sort((a, b) => cmp(a.id, b.id)), co = r.coordination;
  if (digest(expectedClashes) !== digest(co.clashes) || co.blocking !== expectedClashes.filter(c => c.severity === 'BLOCKING').length) fail('CLASH', 'The clash set does not recompute');
  if (co.structuralClearance !== (m.structure.status === 'BOUND' ? 'EVALUATED' : 'NOT_EVALUATED') || digest(co.unevaluatedMemberIds) !== digest(m.structure.members.filter(x => x.halfSizeMm === null).map(x => x.memberId)))
    fail('CLASH', 'Structural clearance status is wrong');
  for (const d of ['PLUMBING', 'ELECTRICAL', 'HVAC'] as const) {
    const nets = m.networks.filter(n => n.discipline === d);
    if (co.clearance[d] !== (nets.length && nets.every(n => n.clearanceMm !== null) ? 'EVALUATED' : 'CLEARANCE_NOT_EVALUATED')) fail('CLASH', `${d} clearance status is wrong`);
  }

  // ---------------------------------------------------------------- electrical arithmetic (own exact sums)
  const e = input.electrical, el = r.electrical;
  if (e) {
    const sum = (keys: string[]) => {
      const group2 = keys.map(k => e.loads.find(l => l.key === k)!);
      let W = Qn(0n), VA = Qn(0n), dW = Qn(0n), dVA = Qn(0n);
      for (const l of group2) {
        const val = Qnum(l.power.value);
        if (l.power.unit === 'W') W = Qadd(W, val); else VA = Qadd(VA, val);
        if (l.demandFactor) { const d = Qmul(val, Qnum(l.demandFactor.value)); if (l.power.unit === 'W') dW = Qadd(dW, d); else dVA = Qadd(dVA, d); }
      }
      const nW = group2.filter(l => l.power.unit === 'W').length, nVA = group2.length - nW;
      return { W: Qstr(W), VA: Qstr(VA), combined: nVA === 0 ? Qstr(W) : nW === 0 ? Qstr(VA) : null, demand: group2.every(l => l.demandFactor) ? [Qstr(dW), Qstr(dVA)] : null };
    };
    type Sum = { connected: { W: { exact: string }; VA: { exact: string }; combined: { exact: string } | null }; demand: { status: string; W: { exact: string } | null; VA: { exact: string } | null } };
    const seen = (x: Sum) => ({ W: x.connected.W.exact, VA: x.connected.VA.exact, combined: x.connected.combined?.exact ?? null, demand: x.demand.status === 'EVALUATED' ? [x.demand.W!.exact, x.demand.VA!.exact] : null });
    const circuits = [...e.circuits].sort((a, b) => cmp(a.key, b.key)), panels = [...e.panels].sort((a, b) => cmp(a.key, b.key));
    if (el.circuits.length !== circuits.length || circuits.some((c, k) => el.circuits[k]!.key !== c.key || digest(seen(el.circuits[k]!)) !== digest(sum(c.loads))))
      fail('ELECTRICAL', 'Circuit load totals do not recompute');
    if (el.panels.length !== panels.length || panels.some((p, k) => el.panels[k]!.key !== p.key || digest(seen(el.panels[k]!)) !== digest(sum(e.circuits.filter(c => c.panel === p.key).flatMap(c => c.loads)))))
      fail('ELECTRICAL', 'Panel load totals do not recompute');
    if (!el.total || digest(seen(el.total)) !== digest(sum(e.loads.map(l => l.key)))) fail('ELECTRICAL', 'Connected load total does not recompute');
    const missing = !e.supply ? ['electrical supply'] : (['systemVoltage', 'phaseSystem', 'frequencyHz'] as const).filter(k => e.supply![k] === null).map(k => `supply ${k}`);
    if (digest(el.supply) !== digest({ status: missing.length ? 'INPUT_INCOMPLETE' : 'SPECIFIED', missing }) || (missing.length > 0 && el.status !== 'INPUT_INCOMPLETE'))
      fail('ELECTRICAL', 'Electrical supply status hides missing voltage, phase or frequency');
  } else if (el.status !== 'NOT_EVALUATED' || el.total || el.circuits.length) fail('ELECTRICAL', 'Electrical results without electrical input');

  // ---------------------------------------------------------------- discipline statuses, Phase 25 handoff, quantities, input hash
  const statusOf = (requestedDiscipline: boolean, d: string) => {
    const nets = r.networks.filter(x => network.get(x.networkId)!.discipline === d);
    if (!requestedDiscipline) return 'NOT_EVALUATED';
    if (!nets.length) return 'INPUT_INCOMPLETE';
    if (nets.every(x => x.status === 'ROUTED')) return 'ANALYZED';
    return nets.every(x => x.status === 'INPUT_INCOMPLETE') ? 'INPUT_INCOMPLETE' : 'PARTIAL';
  };
  if (r.plumbing.status !== statusOf(m.requested.plumbing, 'PLUMBING') || r.hvac.status !== statusOf(m.requested.hvac, 'HVAC')
    || (e && el.supply.status === 'SPECIFIED' && el.status !== statusOf(true, 'ELECTRICAL'))) fail('STATUS', 'A discipline status does not follow from its networks');
  const env = context.environmental;
  const handoff = env ? { analysisId: env.analysisId, inputHash: env.snapshot.inputHash, role: 'ENVELOPE_TRANSMISSION_COMPONENT', isDesignLoad: false,
    cases: env.snapshot.results.thermal.cases.map(c => ({ key: c.key, envelopeTransmission: c.total, status: c.status })) } : null;
  if (digest(r.hvac.referenceInputs.environmental) !== digest(handoff)) fail('HANDOFF', 'The Phase 25 reference input is altered or presented as a design load');
  const routedLengths = r.networks.filter(x => x.status === 'ROUTED').map(x => ({ networkId: x.networkId, length: x.length.value }));
  if (digest(r.quantities.networks.map(x => ({ networkId: x.networkId, length: x.length.value }))) !== digest(routedLengths) || r.quantities.fixtures !== (input.plumbing?.fixtures.length ?? 0)
    || r.quantities.loads !== (input.electrical?.loads.length ?? 0) || r.quantities.panels !== (input.electrical?.panels.length ?? 0)
    || r.quantities.elevatorProposals !== vt.elevators.filter(x => x.status === 'PROPOSED').length) fail('QUANTITY', 'Systems quantities do not recompute');
  const routedIds = new Set(r.networks.filter(x => x.status === 'ROUTED' && network.get(x.networkId)!.discipline === 'PLUMBING').flatMap(x => network.get(x.networkId)!.terminalIds));
  const connected = (input.plumbing?.fixtures ?? []).filter(f => f.connections.every(c => routedIds.has(id(projectId, 'terminal', `plumbing:${f.key}.${c.service}`)))).length;
  if (r.plumbing.fixturesConnected !== connected) fail('QUANTITY', 'Connected fixture count does not recompute');
  const metadata = { name: 'nekoarch-reference-systems', version: '1.0.0', adapterVersion: 'building-systems-adapter-v1',
    settings: { router: SUBMODELS.router, weights: ROUTING_WEIGHTS.version, egress: SUBMODELS.egress, clashGeometry: SUBMODELS.clashGeometry } };
  if (draft.inputHash !== digest({ systemsModelVersion: 'building-systems-model-v1', analysisVersion: 'building-systems-analysis-v1', binding: context.binding, input, calculator: metadata, weights: ROUTING_WEIGHTS }))
    fail('HASH', 'Input hash does not recompute');
  return { validator: RESULT_VALIDATOR, status: diagnostics.length ? 'INVALID' : 'VALID', diagnostics,
    recomputed: { networks: m.networks.length, segments: segmentsChecked, clashes: expectedClashes.length, egressSpaces } };
}
