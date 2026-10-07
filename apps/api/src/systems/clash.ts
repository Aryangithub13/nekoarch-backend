import { pointLocation } from '@designflow/shared';
import { SUBMODELS, SYSTEMS_LIMITS, SystemsError, type Box, type Clash, type Network, type NetworkResult, type Penetration, type SystemsModel,
  type SystemsResults } from './contracts.js';
import { systemsId } from './model.js';
import { boxOf, groupOf, halfSizes, storeyAt, type P3, type Solid } from './routing.js';

const intersect = (a: Box, b: Box, pad = 0): Box | null => {
  const box = { minX: Math.max(a.minX - pad, b.minX), maxX: Math.min(a.maxX + pad, b.maxX), minY: Math.max(a.minY - pad, b.minY), maxY: Math.min(a.maxY + pad, b.maxY),
    minZ: Math.max(a.minZ - pad, b.minZ), maxZ: Math.min(a.maxZ + pad, b.maxZ) };
  return box.maxX > box.minX && box.maxY > box.minY && box.maxZ > box.minZ ? box : null;
};
const doubledRing = (ring: readonly { x: number; z: number }[]) => ring.map(p => ({ x: 2 * p.x, z: 2 * p.z }));
export function serviceClashType(a: string, b: string): Clash['type'] {
  const pair = [a, b].sort().join('+');
  return pair === 'ELECTRICAL+PLUMBING' ? 'PLUMBING_ELECTRICAL_CLEARANCE' : pair === 'HVAC+PLUMBING' ? 'DUCT_PIPE_CLEARANCE' : pair === 'ELECTRICAL+HVAC' ? 'DUCT_ELECTRICAL_CLEARANCE' : 'SERVICE_CLEARANCE';
}
type ServiceSegment = { net: Network; entity: string; a: P3; b: P3; box: Box; clearance: number };
function serviceSegments(model: SystemsModel, results: NetworkResult[]): ServiceSegment[] {
  const nets = new Map(model.networks.map(n => [n.id, n]));
  return results.flatMap(r => {
    const net = nets.get(r.networkId)!, { plan, vertical } = halfSizes(net.size);
    return r.branches.flatMap((b, i) => b.points.slice(1).map((p, k) => ({ net, entity: `networks/${net.key}/branch-${i}/segment-${k}`, a: b.points[k]!, b: p,
      box: boxOf(b.points[k]!, p, plan, vertical), clearance: net.clearanceMm ?? 0 })));
  });
}

/** Consolidated clash pass over exact boxes (envelope-box-v1). Severity is engineering-neutral and never cites a regulation. */
export function coordinate(model: SystemsModel, results: NetworkResult[], solids: Solid[], elevatorClashes: Clash[], penetrations: Penetration[]): SystemsResults['coordination'] {
  const segments = serviceSegments(model, results), projectId = model.binding.projectId, clashes: Clash[] = [...elevatorClashes];
  if (segments.length * (segments.length + solids.length + model.walls.length + model.plates.length) > SYSTEMS_LIMITS.clashPairs)
    throw new SystemsError('BUILDING_SYSTEMS_RESOURCE_LIMIT', 'Too many clash pairs');
  const add = (type: Clash['type'], disciplineA: string, disciplineB: string, entityA: string, entityB: string, bounds: Box, severity: Clash['severity'], basis: Clash['basis']) =>
    clashes.push({ id: systemsId(projectId, 'clash', `${type}:${entityA}:${entityB}`), type, disciplineA, disciplineB, entityA, entityB, bounds, severity, basis,
      evidence: { overlapX: bounds.maxX - bounds.minX, overlapY: bounds.maxY - bounds.minY, overlapZ: bounds.maxZ - bounds.minZ }, resolution: 'UNRESOLVED' });
  const physicalOrClearance = (type: Clash['type'], dA: string, dB: string, eA: string, eB: string, a: Box, b: Box, clearance: number) => {
    const hit = intersect(a, b);
    if (hit) { add(type, dA, dB, eA, eB, hit, 'BLOCKING', 'PHYSICAL_INTERSECTION'); return; }
    const near = clearance > 0 ? intersect(a, b, clearance) : null;
    if (near) add(type, dA, dB, eA, eB, near, 'REVIEW_REQUIRED', 'WITHIN_EXPLICIT_CLEARANCE');
  };
  segments.forEach((s, i) => {
    for (const t of segments.slice(i + 1)) if (t.net.id !== s.net.id && groupOf(t.net) !== groupOf(s.net))
      physicalOrClearance(serviceClashType(s.net.discipline, t.net.discipline), s.net.discipline, t.net.discipline, s.entity, t.entity, s.box, t.box, Math.max(s.clearance, t.clearance));
    for (const o of solids) {
      if (o.kind === 'STRUCTURE') physicalOrClearance('MEP_STRUCTURE_CLASH', s.net.discipline, 'STRUCTURE', s.entity, `structure/${o.id}`, s.box, o.box, s.clearance);
      else {
        const hit = intersect(s.box, o.box);
        if (hit) add(o.kind === 'SHAFT' ? 'SHAFT_CONFLICT' : 'MEP_ARCHITECTURE_CLASH', s.net.discipline, o.discipline, s.entity, `${o.kind === 'SHAFT' ? 'elevators' : 'stairs'}/${o.id}`, hit, 'BLOCKING', 'PHYSICAL_INTERSECTION');
      }
    }
    if (s.a.x === s.b.x && s.a.z === s.b.z) return;
    const alongX = s.a.z === s.b.z, mid = { x: s.a.x + s.b.x, z: s.a.z + s.b.z }, { plan } = halfSizes(s.net.size), storey = storeyAt(model, (s.a.y + s.b.y) / 2);
    if (pointLocation(s.a, storey.boundary) < 0 || pointLocation(s.b, storey.boundary) < 0 || pointLocation(mid, doubledRing(storey.boundary)) < 0)
      add('MEP_ARCHITECTURE_CLASH', s.net.discipline, 'ARCHITECTURE', s.entity, `levels/${storey.levelId}/outside`, s.box, 'BLOCKING', 'PHYSICAL_INTERSECTION');
    for (const w of model.walls) {
      // Running along a wall inside its thickness (plus the service half-size) is a clash; crossing it is a penetration proposal instead.
      if ((w.start.z === w.end.z) !== alongX) continue;
      const at = alongX ? w.start.z : w.start.x, across = alongX ? s.a.z : s.a.x;
      const lo = Math.max(Math.min(alongX ? s.a.x : s.a.z, alongX ? s.b.x : s.b.z), Math.min(alongX ? w.start.x : w.start.z, alongX ? w.end.x : w.end.z));
      const hi = Math.min(Math.max(alongX ? s.a.x : s.a.z, alongX ? s.b.x : s.b.z), Math.max(alongX ? w.start.x : w.start.z, alongX ? w.end.x : w.end.z));
      if (Math.abs(across - at) < w.thicknessMm / 2 + plan && hi > lo && s.box.minY < w.topY && s.box.maxY > w.bottomY) {
        const half = w.thicknessMm / 2, plane = alongX ? { minX: lo, maxX: hi, minZ: at - half, maxZ: at + half } : { minX: at - half, maxX: at + half, minZ: lo, maxZ: hi };
        add('MEP_ARCHITECTURE_CLASH', s.net.discipline, 'ARCHITECTURE', s.entity, `walls/${w.wallId}`, { ...plane, minY: Math.max(s.box.minY, w.bottomY), maxY: Math.min(s.box.maxY, w.topY) },
          'BLOCKING', 'PHYSICAL_INTERSECTION');
      }
    }
    for (const p of model.plates) if (s.box.minY < p.topY && s.box.maxY > p.bottomY && pointLocation(mid, doubledRing(p.outer)) >= 0 && p.voids.every(v => pointLocation(mid, doubledRing(v)) !== 1))
      add('MEP_ARCHITECTURE_CLASH', s.net.discipline, 'ARCHITECTURE', s.entity, `slabs/${p.slabId}`, { ...s.box, minY: Math.max(s.box.minY, p.bottomY), maxY: Math.min(s.box.maxY, p.topY) },
        'REVIEW_REQUIRED', 'PHYSICAL_INTERSECTION');
  });
  // Equipment with an explicit footprint over a floor-level door or a stair: plan-only evidence, so review rather than blocking.
  for (const t of model.terminals.filter(t => t.footprint)) {
    const level = model.levels.find(l => l.levelId === t.levelId)!, f = { ...t.footprint!, minY: level.elevationMm, maxY: level.topMm };
    for (const o of model.openings.filter(o => o.traversable && o.levelId === t.levelId)) {
      const hit = intersect({ ...f, minX: 2 * f.minX, maxX: 2 * f.maxX, minZ: 2 * f.minZ, maxZ: 2 * f.maxZ }, { ...o.footprint2, minY: level.elevationMm, maxY: level.topMm });
      if (hit) add('EGRESS_OBSTRUCTION', 'EQUIPMENT', 'ARCHITECTURE', `terminals/${t.id}`, `openings/${o.openingId}`, { ...hit, minX: hit.minX / 2, maxX: hit.maxX / 2, minZ: hit.minZ / 2, maxZ: hit.maxZ / 2 },
        'REVIEW_REQUIRED', 'PHYSICAL_INTERSECTION');
    }
    for (const s of model.stairs.filter(s => s.fromLevelId === t.levelId || s.toLevelId === t.levelId)) [s.flight, ...s.landings].forEach((r, i) => {
      const hit = intersect(f, { ...r, minY: level.elevationMm, maxY: level.topMm });
      if (hit) add('EGRESS_OBSTRUCTION', 'EQUIPMENT', 'ARCHITECTURE', `terminals/${t.id}`, `stairs/${s.stairId}${i ? `/landing-${i}` : ''}`, hit, 'REVIEW_REQUIRED', 'PHYSICAL_INTERSECTION');
    });
  }
  const unique = [...new Map(clashes.map(c => [c.id, c])).values()].sort((a, b) => a.id < b.id ? -1 : 1);
  const clearance = (d: string) => model.networks.some(n => n.discipline === d) && model.networks.filter(n => n.discipline === d).every(n => n.clearanceMm !== null)
    ? 'EVALUATED' as const : 'CLEARANCE_NOT_EVALUATED' as const;
  const active = results.some(r => r.status === 'ROUTED') || model.requested.verticalTransport;
  return { status: active ? 'ANALYZED' : 'NOT_EVALUATED', version: SUBMODELS.coordination, geometry: SUBMODELS.clashGeometry,
    structuralClearance: model.structure.status === 'BOUND' ? 'EVALUATED' : 'NOT_EVALUATED',
    unevaluatedMemberIds: model.structure.members.filter(m => m.halfSizeMm === null).map(m => m.memberId),
    clearance: { PLUMBING: clearance('PLUMBING'), ELECTRICAL: clearance('ELECTRICAL'), HVAC: clearance('HVAC') },
    clashes: unique, penetrations, blocking: unique.filter(c => c.severity === 'BLOCKING').length };
}
