import { createHash } from 'node:crypto';
import { pointLocation, wallSpaceIds, type BuildingModelV2, type Point2Mm } from '@designflow/shared';
import type { BimModel } from '../bim/contracts.js';
import type { StructuralSnapshot } from '../structural/contracts.js';
import type { EnvironmentalSnapshot } from '../environmental/contracts.js';
import { ENVIRONMENTAL_MODEL_VERSION } from '../environmental/contracts.js';
import { STRUCTURAL_MODEL_VERSION } from '../structural/contracts.js';
import { ASSUMPTIONS, CIRCULATION_CLASSIFICATIONS, CLAIMS, SYSTEMS_LIMITS, SYSTEMS_MODEL_VERSION, SystemsError, SystemsModelSchema, type Network, type Rect, type SystemKind,
  type SystemsBinding, type SystemsInput, type SystemsModel, type Terminal } from './contracts.js';

export interface Upstream {
  structural: { analysisId: string; inputHash: string; snapshot: StructuralSnapshot } | null;
  environmental: { analysisId: string; inputHash: string; snapshot: EnvironmentalSnapshot } | null;
}
/** Deterministic semantic id: same project, role and key → same id. */
export function systemsId(projectId: string, role: string, key: string) {
  return `sys-${createHash('sha256').update(JSON.stringify([projectId, role, key])).digest('hex').slice(0, 40)}`;
}
export const boundsOf = (ring: readonly Point2Mm[]): Rect => ({ minX: Math.min(...ring.map(p => p.x)), minZ: Math.min(...ring.map(p => p.z)),
  maxX: Math.max(...ring.map(p => p.x)), maxZ: Math.max(...ring.map(p => p.z)) });
const byId = <T>(id: (t: T) => string) => (a: T, b: T) => id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0;
const invalid = (message: string): never => { throw new SystemsError('BUILDING_SYSTEMS_MODEL_INVALID', message); };
type Located = { key: string; spaceId: string; point: Point2Mm | null; elevationMm: number };
type Routing = { mode: 'PLANNED' } | { mode: 'FIXED'; routes: { terminal: string; points: { x: number; y: number; z: number }[] }[] };

/** BIM (Phase 23) + optional structural/environmental snapshots + explicit systems input → systems semantic model. Never modifies the architecture. */
export function buildSystemsModel(bim: BimModel, input: SystemsInput, upstream: Upstream = { structural: null, environmental: null }): SystemsModel {
  const g: BuildingModelV2 = bim.geometry, projectId = bim.binding.projectId;
  for (const [name, u] of [['structural', upstream.structural], ['environmental', upstream.environmental]] as const)
    if (u && (u.snapshot.binding.revisionId !== bim.binding.revisionId || u.snapshot.binding.modelHash !== bim.binding.modelHash || u.snapshot.inputHash !== u.inputHash))
      invalid(`The ${name} analysis is bound to a different architecture`);
  const binding: SystemsBinding = { ...bim.binding, bimVersion: bim.version, systemsModelVersion: SYSTEMS_MODEL_VERSION,
    structural: upstream.structural ? { analysisId: upstream.structural.analysisId, inputHash: upstream.structural.inputHash, modelVersion: STRUCTURAL_MODEL_VERSION } : null,
    environmental: upstream.environmental ? { analysisId: upstream.environmental.analysisId, inputHash: upstream.environmental.inputHash, modelVersion: ENVIRONMENTAL_MODEL_VERSION } : null };
  if (g.levels.some(l => l.floorToFloorHeightMm === null)) throw new SystemsError('BUILDING_SYSTEMS_SOURCE_UNSUPPORTED', 'Every storey needs a floor-to-floor height');
  const levels = [...g.levels].sort((a, b) => a.index - b.index).map(l => ({ levelId: l.id, index: l.index, elevationMm: l.elevationMm, topMm: l.elevationMm + l.floorToFloorHeightMm!, boundary: l.boundary }));
  const level = new Map(levels.map(l => [l.levelId, l]));
  const spaces = [...g.spaces].sort(byId(s => s.id)).map(s => ({ spaceId: s.id, levelId: s.levelId, classification: s.classification,
    circulation: (CIRCULATION_CLASSIFICATIONS as readonly string[]).includes(s.classification.toLowerCase()), boundary: s.boundary }));
  const space = new Map(spaces.map(s => [s.spaceId, s]));
  const adjacency = new Map(g.walls.map(w => [w.id, wallSpaceIds(g, w)]));
  const walls = [...g.walls].sort(byId(w => w.id)).map(w => ({ wallId: w.id, levelId: w.levelId, start: w.path.start, end: w.path.end, thicknessMm: w.thicknessMm!,
    bottomY: level.get(w.levelId)!.elevationMm + w.baseOffsetMm!, topY: level.get(w.levelId)!.elevationMm + w.baseOffsetMm! + w.heightMm!, exterior: adjacency.get(w.id)!.length === 1 }));
  const openings = [...g.openings].sort(byId(o => o.id)).map(o => {
    const w = g.walls.find(x => x.id === o.wallId)!, ux = Math.sign(w.path.end.x - w.path.start.x), uz = Math.sign(w.path.end.z - w.path.start.z), t = w.thicknessMm!;
    // Doubled coordinates: an odd opening width keeps an exact integer centre.
    const a = { x: 2 * w.path.start.x + ux * 2 * o.offsetMm, z: 2 * w.path.start.z + uz * 2 * o.offsetMm }, b = { x: a.x + ux * 2 * o.widthMm, z: a.z + uz * 2 * o.widthMm };
    return { openingId: o.id, wallId: o.wallId, levelId: o.levelId, kind: o.kind, widthMm: o.widthMm,
      traversable: (o.kind === 'door' || (o.kind === 'opening' && o.purpose === 'passage')) && o.sillMm === 0 && w.baseOffsetMm === 0,
      exterior: adjacency.get(w.id)!.length === 1, spaceIds: adjacency.get(w.id)!, center2: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 },
      footprint2: ux !== 0 ? { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: 2 * w.path.start.z - t, maxZ: 2 * w.path.start.z + t }
        : { minX: 2 * w.path.start.x - t, maxX: 2 * w.path.start.x + t, minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) } };
  });
  const plates = g.slabs.filter(s => s.kind === 'floor').sort(byId(s => s.id)).map(s => {
    const top = level.get(s.levelId)!.elevationMm + s.topOffsetMm;
    return { slabId: s.id, levelId: s.levelId, outer: s.footprint.outer, voids: s.footprint.voids, topY: top, bottomY: top - s.thicknessMm };
  });
  const stairs = [...g.stairs].sort(byId(s => s.id)).map(s => ({ stairId: s.id, fromLevelId: s.fromLevelId, toLevelId: s.toLevelId, flight: boundsOf(s.footprint),
    landings: s.landings.map(l => boundsOf(l.footprint)), direction: s.direction, widthMm: s.widthMm, runMm: s.runMm, riseMm: s.riseMm,
    bottomY: level.get(s.fromLevelId)!.elevationMm, topY: level.get(s.toLevelId)!.elevationMm }));

  const structure = upstream.structural ? (() => {
    const m = upstream.structural.snapshot.model, nodes = new Map(m.nodes.map(n => [n.id, n.coordinates])), sections = new Map(m.sections.map(s => [s.id, s]));
    return { status: 'BOUND' as const, members: [...m.members].sort(byId(x => x.id)).map(member => {
      const a = nodes.get(member.startNodeId)!, b = nodes.get(member.endNodeId)!, d = sections.get(member.sectionId)!.dimensions;
      return { memberId: member.id, kind: member.kind, start: { x: a.x, y: a.y, z: a.z }, end: { x: b.x, y: b.y, z: b.z }, halfSizeMm: d ? Math.max(d.width.value, d.depth.value) / 2 : null,
        envelope: d ? 'CONSERVATIVE_SQUARE_ENVELOPE' as const : 'NOT_EVALUATED_NO_SECTION_DIMENSIONS' as const };
    }) };
  })() : { status: 'NOT_SUPPLIED' as const, members: [] };

  // ------------------------------------------------------------ terminals: explicit locations only, never fabricated
  const terminals: Terminal[] = [], seen = new Set<string>();
  function terminal(discipline: string, role: Terminal['role'], t: Located & { footprint?: Rect | null }) {
    const s = space.get(t.spaceId) ?? invalid(`${discipline} ${t.key}: space ${t.spaceId} does not exist`);
    if (seen.has(`${discipline}:${t.key}`)) invalid(`${discipline} key ${t.key} is used twice`);
    if (t.point && pointLocation(t.point, s.boundary) < 0) invalid(`${discipline} ${t.key} lies outside its space ${t.spaceId}`);
    const out: Terminal = { id: systemsId(projectId, 'terminal', `${discipline}:${t.key}`), key: t.key, role, spaceId: s.spaceId, levelId: s.levelId, point: t.point,
      y: level.get(s.levelId)!.elevationMm + t.elevationMm, footprint: t.footprint ?? null };
    terminals.push(out); seen.add(`${discipline}:${t.key}`); return out;
  }
  const networks: Network[] = [];
  function network(key: string, discipline: Network['discipline'], system: SystemKind, root: Terminal | null, members: Terminal[], options: { size: Network['size'];
    clearance: { value: number } | null; elevations?: { levelId: string; elevationMm: number }[]; bands?: { levelId: string; topMm: number; bottomMm: number }[];
    slope?: { rise: number; run: number } | null; routing?: Routing; missing?: string[] }) {
    const missing = [...(options.missing ?? [])];
    if (!root) missing.push('root location');
    for (const t of [...(root ? [root] : []), ...members]) if (!t.point) missing.push(`location of ${t.key}`);
    const involved = [...(root ? [root] : []), ...members].map(t => level.get(t.levelId)!.index);
    const span = levels.filter(l => l.index >= Math.min(...involved) && l.index <= Math.max(...involved));
    const given = new Map<string, number>(), bands = new Map<string, { top: number; bottom: number }>();
    for (const e of options.elevations ?? []) {
      if (!level.has(e.levelId) || given.has(e.levelId)) invalid(`${key}: unknown or repeated routing level ${e.levelId}`);
      given.set(e.levelId, level.get(e.levelId)!.elevationMm + e.elevationMm);
    }
    for (const b of options.bands ?? []) {
      if (!level.has(b.levelId) || bands.has(b.levelId)) invalid(`${key}: unknown or repeated drainage band ${b.levelId}`);
      bands.set(b.levelId, { top: level.get(b.levelId)!.elevationMm + b.topMm, bottom: level.get(b.levelId)!.elevationMm + b.bottomMm });
    }
    const gravity = system === 'SANITARY';
    for (const l of span) if (gravity ? !bands.has(l.levelId) : !given.has(l.levelId)) missing.push(`${gravity ? 'drainage band' : 'routing elevation'} on ${l.levelId}`);
    if (gravity && !options.slope) missing.push('minimum slope');
    const routing = options.routing ?? { mode: 'PLANNED' as const };
    const fixedRoutes = routing.mode === 'FIXED' ? routing.routes.map(r => ({
      terminalId: (members.find(t => t.key === r.terminal) ?? invalid(`${key}: fixed route for unknown terminal ${r.terminal}`)).id, points: r.points })) : [];
    if (new Set(fixedRoutes.map(r => r.terminalId)).size !== fixedRoutes.length) invalid(`${key}: two fixed routes for one terminal`);
    if (routing.mode === 'FIXED') for (const t of members) if (!fixedRoutes.some(r => r.terminalId === t.id)) missing.push(`fixed route for ${t.key}`);
    networks.push({ id: systemsId(projectId, 'network', key), key, discipline, system, rootId: root?.id ?? null, terminalIds: members.map(t => t.id).sort(),
      size: options.size, clearanceMm: options.clearance?.value ?? null,
      levels: span.map(l => ({ levelId: l.levelId, y: gravity ? null : given.get(l.levelId) ?? null, band: gravity ? bands.get(l.levelId) ?? null : null })),
      slope: gravity && options.slope ? { rise: options.slope.rise, run: options.slope.run } : null, mode: routing.mode,
      fixedRoutes: fixedRoutes.sort(byId(r => r.terminalId)), status: missing.length ? 'INPUT_INCOMPLETE' : 'READY', missing: [...new Set(missing)].sort().slice(0, 64) });
  }

  if (input.plumbing) {
    const p = input.plumbing;
    const connections = p.fixtures.flatMap(f => f.connections.map(c => ({ service: c.service,
      t: terminal('plumbing', 'FIXTURE', { key: `${f.key}.${c.service}`, spaceId: f.spaceId, point: c.point, elevationMm: c.elevationMm }) })));
    const cold = p.coldWaterSource && terminal('plumbing', 'WATER_SOURCE', p.coldWaterSource), hot = p.hotWaterSource && terminal('plumbing', 'WATER_SOURCE', p.hotWaterSource);
    const outlet = p.sanitaryOutlet && terminal('plumbing', 'SANITARY_OUTLET', p.sanitaryOutlet);
    const serving = (s: string) => connections.filter(x => x.service === s).map(x => x.t);
    if (serving('SANITARY').length) network('SANITARY', 'PLUMBING', 'SANITARY', outlet, serving('SANITARY'), { size: p.sanitary.size, clearance: p.clearance, bands: p.sanitary.bands, slope: p.minimumSlope });
    if (serving('COLD_WATER').length) network('COLD_WATER', 'PLUMBING', 'COLD_WATER', cold, serving('COLD_WATER'),
      { size: p.coldWater.size, clearance: p.clearance, elevations: p.coldWater.elevations, routing: p.coldWater.routing });
    if (serving('HOT_WATER').length) network('HOT_WATER', 'PLUMBING', 'HOT_WATER', hot, serving('HOT_WATER'),
      { size: p.hotWater.size, clearance: p.clearance, elevations: p.hotWater.elevations, routing: p.hotWater.routing });
  }
  if (input.electrical) {
    const e = input.electrical, supply = e.supply && terminal('electrical', 'SUPPLY', e.supply);
    const panels = new Map(e.panels.map(p => [p.key, terminal('electrical', 'PANEL', p)])), loads = new Map(e.loads.map(l => [l.key, terminal('electrical', 'LOAD', l)]));
    if (new Set(e.circuits.map(c => c.key)).size !== e.circuits.length) invalid('Circuit keys must be unique');
    const assigned = new Set<string>();
    for (const c of e.circuits) {
      if (!panels.has(c.panel)) invalid(`Circuit ${c.key} names unknown panel ${c.panel}`);
      for (const l of c.loads) { if (!loads.has(l)) invalid(`Circuit ${c.key} names unknown load ${l}`); if (assigned.has(l)) invalid(`Load ${l} is on two circuits`); assigned.add(l); }
    }
    for (const l of e.loads) if (!assigned.has(l.key)) invalid(`Load ${l.key} is on no circuit`);
    // Voltage, phase system and frequency are never assumed from locale or convention.
    const supplyMissing = !e.supply ? ['electrical supply'] : ([['systemVoltage', e.supply.systemVoltage], ['phaseSystem', e.supply.phaseSystem], ['frequencyHz', e.supply.frequencyHz]] as const)
      .filter(([, v]) => v === null).map(([k]) => `supply ${k}`);
    network('ELECTRICAL_FEEDER', 'ELECTRICAL', 'ELECTRICAL_FEEDER', supply, [...panels.values()],
      { size: e.feeder.size, clearance: e.clearance, elevations: e.feeder.elevations, routing: e.feeder.routing, missing: supplyMissing });
    const routing = e.circuitRouting.routing;
    for (const c of [...e.circuits].sort(byId(x => x.key))) network(`ELECTRICAL_CIRCUIT:${c.key}`, 'ELECTRICAL', 'ELECTRICAL_CIRCUIT', panels.get(c.panel)!, c.loads.map(l => loads.get(l)!),
      { size: e.circuitRouting.size, clearance: e.clearance, elevations: e.circuitRouting.elevations,
        routing: routing.mode === 'FIXED' ? { mode: 'FIXED', routes: routing.routes.filter(r => c.loads.includes(r.terminal)) } : routing });
  }
  if (input.hvac) {
    const h = input.hvac, equipment = new Map(h.equipment.map(x => [x.key, terminal('hvac', 'EQUIPMENT', x)]));
    // Equipment terminals record location and footprint; each system routes from its own explicit connection on that equipment.
    if (new Set(h.systems.map(s => s.key)).size !== h.systems.length) invalid('HVAC system keys must be unique');
    for (const s of [...h.systems].sort(byId(x => x.key))) {
      const unit = equipment.get(s.equipment) ?? invalid(`HVAC system ${s.key} names unknown equipment ${s.equipment}`);
      const root = terminal('hvac', 'EQUIPMENT', { key: `${s.key}.connection`, spaceId: unit.spaceId, point: s.connection.point, elevationMm: s.connection.elevationMm });
      network(`HVAC_${s.kind}:${s.key}`, 'HVAC', `HVAC_${s.kind}`, root, s.terminals.map(t => terminal('hvac', 'AIR_TERMINAL', t)),
        { size: s.ductSection, clearance: h.clearance, elevations: s.elevations, routing: s.routing });
    }
  }
  if (terminals.length > SYSTEMS_LIMITS.terminals) throw new SystemsError('BUILDING_SYSTEMS_RESOURCE_LIMIT', 'Too many terminals');

  // ------------------------------------------------------------ exits: explicit designation only, never every exterior door, never a window
  const openingById = new Map(openings.map(o => [o.openingId, o]));
  const ls = input.lifeSafety, obstructed = [...new Set(ls?.obstructedOpeningIds ?? [])].sort();
  for (const id of obstructed) if (!openingById.has(id)) invalid(`Obstructed opening ${id} does not exist`);
  const exits = (() => {
    if (!ls) return { status: 'NOT_REQUESTED' as const, mode: null, openingIds: [], obstructedOpeningIds: [], missing: [] };
    if (!ls.exits) return { status: 'INPUT_INCOMPLETE' as const, mode: null, openingIds: [], obstructedOpeningIds: obstructed, missing: ['exit designation'] };
    const ids = ls.exits.mode === 'EXPLICIT' ? [...new Set(ls.exits.openingIds)].sort() : g.site?.primaryEntryOpeningId ? [g.site.primaryEntryOpeningId] : [];
    if (!ids.length) return { status: 'INPUT_INCOMPLETE' as const, mode: ls.exits.mode, openingIds: [], obstructedOpeningIds: obstructed, missing: ['the site names no primary entry opening'] };
    for (const id of ids) {
      const o = openingById.get(id) ?? invalid(`Exit opening ${id} does not exist`);
      if (!o.traversable || !o.exterior) invalid(`Exit ${id} is not a floor-level exterior door or passage`);
    }
    return { status: 'DESIGNATED' as const, mode: ls.exits.mode, openingIds: ids, obstructedOpeningIds: obstructed, missing: [] };
  })();
  const elevators = input.verticalTransport?.elevators ?? [];
  if (new Set(elevators.map(e => e.key)).size !== elevators.length) invalid('Elevator keys must be unique');
  for (const e of elevators) {
    if (new Set(e.servedLevelIds).size !== e.servedLevelIds.length || e.servedLevelIds.some(id => !level.has(id))) invalid(`Elevator ${e.key}: unknown or repeated served level`);
    const idx = e.servedLevelIds.map(id => level.get(id)!.index).sort((a, b) => a - b);
    if (levels.filter(l => l.index >= idx[0]! && l.index <= idx.at(-1)!).length !== idx.length) invalid(`Elevator ${e.key}: served levels must be contiguous`);
  }

  return SystemsModelSchema.parse({ version: SYSTEMS_MODEL_VERSION, coordinateSystem: 'x-right-y-up-z-depth', units: { length: 'mm', elevation: 'mm-absolute' }, binding,
    levels, spaces, walls, openings, plates, stairs, structure, terminals: terminals.sort(byId(t => t.id)), networks: networks.sort(byId(n => n.key)), exits,
    requested: { plumbing: !!input.plumbing, electrical: !!input.electrical, hvac: !!input.hvac, lifeSafety: !!input.lifeSafety, verticalTransport: !!input.verticalTransport },
    assumptions: [...ASSUMPTIONS], claims: { ...CLAIMS } });
}
