import { pointLocation, ringContains, type Point2Mm } from '@designflow/shared';
import { NOT_EVALUATED, SIDES, SUBMODELS, SYSTEMS_LIMITS, SystemsError, type Box, type Clash, type Rect, type SystemsInput, type SystemsModel } from './contracts.js';
import { systemsId } from './model.js';
import type { Solid } from './routing.js';

type Side = typeof SIDES[number];
type Request = NonNullable<SystemsInput['verticalTransport']>['elevators'][number];
type Blocking = { type: Clash['type']; entity: string; disciplineB: string; box: Box };
const ringOf = (r: Rect) => [{ x: r.minX, z: r.minZ }, { x: r.maxX, z: r.minZ }, { x: r.maxX, z: r.maxZ }, { x: r.minX, z: r.maxZ }];
const overlap = (a: Box, b: Box): Box | null => {
  const box = { minX: Math.max(a.minX, b.minX), maxX: Math.min(a.maxX, b.maxX), minY: Math.max(a.minY, b.minY), maxY: Math.min(a.maxY, b.maxY),
    minZ: Math.max(a.minZ, b.minZ), maxZ: Math.min(a.maxZ, b.maxZ) };
  return box.maxX > box.minX && box.maxY > box.minY && box.maxZ > box.minZ ? box : null;
};
const better = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!; return false; };
/** Exact area of an orthogonal polygon clipped to a rectangle (Sutherland–Hodgman; every intersection lands on an integer coordinate). */
export function clippedArea(ring: readonly Point2Mm[], r: Rect): number {
  let poly = [...ring];
  const planes: [(p: Point2Mm) => boolean, (a: Point2Mm, b: Point2Mm) => Point2Mm][] = [
    [p => p.x >= r.minX, (a, b) => ({ x: r.minX, z: a.z + (b.z - a.z) * (r.minX - a.x) / (b.x - a.x) })],
    [p => p.x <= r.maxX, (a, b) => ({ x: r.maxX, z: a.z + (b.z - a.z) * (r.maxX - a.x) / (b.x - a.x) })],
    [p => p.z >= r.minZ, (a, b) => ({ x: a.x + (b.x - a.x) * (r.minZ - a.z) / (b.z - a.z), z: r.minZ })],
    [p => p.z <= r.maxZ, (a, b) => ({ x: a.x + (b.x - a.x) * (r.maxZ - a.z) / (b.z - a.z), z: r.maxZ })]];
  for (const [keep, cut] of planes) {
    const out: Point2Mm[] = [];
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length]!;
      if (keep(p)) { out.push(p); if (!keep(q)) out.push(cut(p, q)); } else if (keep(q)) out.push(cut(p, q));
    });
    poly = out; if (!poly.length) return 0;
  }
  const twice = poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]!; return s + BigInt(p.x) * BigInt(q.z) - BigInt(q.x) * BigInt(p.z); }, 0n);
  return Number((twice < 0n ? -twice : twice) / 2n);
}
/** Door centre on the chosen face and a probe 0.5 mm outside it, both doubled. */
export function doorProbe2(r: Rect, side: Side) {
  const mx = r.minX + r.maxX, mz = r.minZ + r.maxZ;
  return { '+x': { point: { x: 2 * r.maxX, z: mz }, probe: { x: 2 * r.maxX + 1, z: mz } }, '-x': { point: { x: 2 * r.minX, z: mz }, probe: { x: 2 * r.minX - 1, z: mz } },
    '+z': { point: { x: mx, z: 2 * r.maxZ }, probe: { x: mx, z: 2 * r.maxZ + 1 } }, '-z': { point: { x: mx, z: 2 * r.minZ }, probe: { x: mx, z: 2 * r.minZ - 1 } } }[side];
}

function assess(model: SystemsModel, rect: Rect, served: string[], bottomY: number, topY: number, structure: Solid[]) {
  const levels = model.levels.filter(l => served.includes(l.levelId)), shaft: Box = { ...rect, minY: bottomY, maxY: topY };
  const inside = levels.every(l => ringContains(l.boundary, ringOf(rect)));
  const blocking: Blocking[] = [];
  for (const s of model.stairs) if (served.includes(s.fromLevelId) || served.includes(s.toLevelId)) [s.flight, ...s.landings].forEach((r, i) => {
    const b = overlap(shaft, { ...r, minY: s.bottomY, maxY: s.topY + 1 });
    if (b) blocking.push({ type: 'VERTICAL_TRANSPORT_CLASH', entity: `stairs/${s.stairId}${i ? `/landing-${i}` : ''}`, disciplineB: 'ARCHITECTURE', box: b });
  });
  for (const p of model.plates.filter(p => served.includes(p.levelId))) p.voids.forEach((v, i) => {
    const r = { minX: Math.min(...v.map(q => q.x)), maxX: Math.max(...v.map(q => q.x)), minZ: Math.min(...v.map(q => q.z)), maxZ: Math.max(...v.map(q => q.z)) };
    const b = overlap(shaft, { ...r, minY: p.bottomY, maxY: p.topY });
    if (b) blocking.push({ type: 'VERTICAL_TRANSPORT_CLASH', entity: `slabs/${p.slabId}/void-${i}`, disciplineB: 'ARCHITECTURE', box: b });
  });
  for (const m of structure) { const b = overlap(shaft, m.box); if (b) blocking.push({ type: 'VERTICAL_TRANSPORT_CLASH', entity: `structure/${m.id}`, disciplineB: 'STRUCTURE', box: b }); }
  // A shaft over a floor-level door opening obstructs that door.
  for (const o of model.openings.filter(o => o.traversable && served.includes(o.levelId))) {
    const level = model.levels.find(l => l.levelId === o.levelId)!;
    const b = overlap({ minX: 2 * rect.minX, maxX: 2 * rect.maxX, minZ: 2 * rect.minZ, maxZ: 2 * rect.maxZ, minY: bottomY, maxY: topY }, { ...o.footprint2, minY: level.elevationMm, maxY: level.topMm });
    if (b) blocking.push({ type: 'EGRESS_OBSTRUCTION', entity: `openings/${o.openingId}`, disciplineB: 'ARCHITECTURE', box: { ...b, minX: b.minX / 2, maxX: b.maxX / 2, minZ: b.minZ / 2, maxZ: b.maxZ / 2 } });
  }
  const crossed = model.walls.filter(w => served.includes(w.levelId) && (w.start.z === w.end.z
    ? rect.minZ < w.start.z && w.start.z < rect.maxZ && Math.min(Math.max(w.start.x, w.end.x), rect.maxX) > Math.max(Math.min(w.start.x, w.end.x), rect.minX)
    : rect.minX < w.start.x && w.start.x < rect.maxX && Math.min(Math.max(w.start.z, w.end.z), rect.maxZ) > Math.max(Math.min(w.start.z, w.end.z), rect.minZ))).map(w => w.wallId);
  const overlapped = model.spaces.filter(s => served.includes(s.levelId)).map(s => ({ spaceId: s.spaceId, circulation: s.circulation, area: clippedArea(s.boundary, rect) })).filter(s => s.area > 0);
  return { inside, blocking, crossed, overlapped };
}
function door(model: SystemsModel, rect: Rect, side: Side, served: string[], reachable: Set<string> | null) {
  const { point, probe } = doorProbe2(rect, side);
  const spaces = served.map(levelId => model.spaces.find(s => s.levelId === levelId && pointLocation(probe, s.boundary.map(p => ({ x: 2 * p.x, z: 2 * p.z }))) === 1)?.spaceId ?? null);
  const access = reachable === null ? 'NOT_EVALUATED' as const
    : spaces.every(s => s !== null && reachable.has(s)) ? 'VERTICAL_ACCESS_PATH_AVAILABLE' as const : 'VERTICAL_ACCESS_PATH_NOT_AVAILABLE' as const;
  const circulation = spaces.every(s => s !== null && model.spaces.find(x => x.spaceId === s)!.circulation);
  return { point, spaces, access, rank: (access === 'VERTICAL_ACCESS_PATH_NOT_AVAILABLE' || spaces.includes(null) ? 2 : 0) + (circulation ? 0 : 1) };
}

/** Elevators are proposals only: the accepted architecture is never modified, and a FIXED placement is never relocated. */
export function planElevators(model: SystemsModel, input: SystemsInput['verticalTransport'], reachable: Set<string> | null, structure: Solid[]) {
  const base = { version: SUBMODELS.verticalTransport, notEvaluated: [...NOT_EVALUATED.verticalTransport] };
  if (!input) return { result: { ...base, status: 'NOT_EVALUATED' as const, reason: 'Vertical transport was not requested', elevators: [] }, shafts: [] as Solid[], clashes: [] as Clash[] };
  const shafts: Solid[] = [], clashes: Clash[] = [], projectId = model.binding.projectId;
  const elevators = [...input.elevators].sort((a, b) => a.key < b.key ? -1 : 1).map((e: Request) => {
    const served = model.levels.filter(l => e.servedLevelIds.includes(l.levelId)).map(l => l.levelId);
    const levels = model.levels.filter(l => served.includes(l.levelId)), bottomY = levels[0]!.elevationMm, topY = levels.at(-1)!.topMm;
    const fits = (side: Side) => (side.endsWith('x') ? e.shaft.depthMm : e.shaft.widthMm) >= e.door.widthMm;
    let chosen: { rect: Rect; side: Side } | null = null, evaluated = 0;
    if (e.placement.mode === 'FIXED') {
      const o = e.placement.origin;
      chosen = { rect: { minX: o.x, minZ: o.z, maxX: o.x + e.shaft.widthMm, maxZ: o.z + e.shaft.depthMm }, side: e.door.side }; evaluated = 1;
    } else {
      // Candidate origins align shaft faces with architectural coordinates: boundaries, space vertices and wall faces.
      const xs = new Set<number>(), zs = new Set<number>();
      for (const p of [...levels.flatMap(l => l.boundary), ...model.spaces.filter(s => served.includes(s.levelId)).flatMap(s => s.boundary)]) { xs.add(p.x); zs.add(p.z); }
      for (const w of model.walls.filter(w => served.includes(w.levelId))) {
        const h = Math.ceil(w.thicknessMm / 2);
        if (w.start.x === w.end.x) { xs.add(w.start.x - h); xs.add(w.start.x + h); } else { zs.add(w.start.z - h); zs.add(w.start.z + h); }
      }
      const ox = [...new Set([...xs].flatMap(v => [v, v - e.shaft.widthMm]))].sort((a, b) => a - b), oz = [...new Set([...zs].flatMap(v => [v, v - e.shaft.depthMm]))].sort((a, b) => a - b);
      if (ox.length * oz.length * SIDES.length > SYSTEMS_LIMITS.elevatorCandidates) throw new SystemsError('BUILDING_SYSTEMS_RESOURCE_LIMIT', `Elevator ${e.key}: too many placement candidates`);
      const bounds = levels.map(l => ({ minX: Math.min(...l.boundary.map(p => p.x)), maxX: Math.max(...l.boundary.map(p => p.x)), minZ: Math.min(...l.boundary.map(p => p.z)), maxZ: Math.max(...l.boundary.map(p => p.z)) }));
      let best: { score: number[]; rect: Rect; side: Side } | null = null;
      for (const x of ox) for (const z of oz) {
        const rect = { minX: x, minZ: z, maxX: x + e.shaft.widthMm, maxZ: z + e.shaft.depthMm };
        if (bounds.some(b => rect.minX < b.minX || rect.maxX > b.maxX || rect.minZ < b.minZ || rect.maxZ > b.maxZ)) continue;
        evaluated += SIDES.length;
        const a = assess(model, rect, served, bottomY, topY, structure);
        if (!a.inside || a.blocking.length) continue;
        const area = a.overlapped.filter(s => !s.circulation).reduce((n, s) => n + s.area, 0);
        for (let si = 0; si < SIDES.length; si++) {
          const side = SIDES[si]!;
          if (!fits(side)) continue;
          const score = [door(model, rect, side, served, reachable).rank, area, a.crossed.length, x, z, si];
          if (!best || better(score, best.score)) best = { score, rect, side };
        }
      }
      chosen = best ? { rect: best.rect, side: best.side } : null;
    }
    const engineering = (value: unknown) => value === null ? { status: 'NOT_SPECIFIED' as const, value: null } : { status: 'USER_PROVIDED' as const, value };
    const common = { key: e.key, placement: e.placement.mode, servedLevelIds: served, bottomY, topY, architectureMutation: 'NONE' as const, candidatesEvaluated: evaluated,
      structuralCheck: model.structure.status === 'BOUND' ? 'EVALUATED' as const : 'NOT_EVALUATED' as const,
      engineering: { cabin: engineering(e.cabin), pitDepth: engineering(e.pitDepthMm), overhead: engineering(e.overheadMm), ratedLoad: engineering(e.ratedLoad), ratedSpeed: engineering(e.ratedSpeed) } };
    if (!chosen) return { ...common, status: 'REJECTED' as const, reason: 'No valid placement exists among the bounded candidates', shaft: null,
      door: { side: e.door.side, widthMm: e.door.widthMm, point2: null, spaceIds: [] }, verticalAccess: 'NOT_EVALUATED' as const, overlappedSpaces: [], crossedWallIds: [], blockingClashIds: [] };
    const a = assess(model, chosen.rect, served, bottomY, topY, structure), d = door(model, chosen.rect, chosen.side, served, reachable);
    const ids = a.blocking.map(b => {
      const clash: Clash = { id: systemsId(projectId, 'clash', `elevator:${e.key}:${b.entity}`), type: b.type, disciplineA: 'VERTICAL_TRANSPORT', disciplineB: b.disciplineB,
        entityA: `elevators/${e.key}`, entityB: b.entity, bounds: b.box, severity: 'BLOCKING', basis: 'PHYSICAL_INTERSECTION',
        evidence: { overlapX: b.box.maxX - b.box.minX, overlapY: b.box.maxY - b.box.minY, overlapZ: b.box.maxZ - b.box.minZ }, resolution: 'UNRESOLVED' };
      clashes.push(clash); return clash.id;
    });
    const reason = !a.inside ? 'The shaft is not inside every served level' : !fits(chosen.side) ? 'The door is wider than its shaft face' : ids.length ? 'The shaft has blocking clashes' : null;
    if (reason === null) shafts.push({ id: systemsId(projectId, 'elevator', e.key), kind: 'SHAFT', group: 'VERTICAL_TRANSPORT', discipline: 'VERTICAL_TRANSPORT', clearance: 0,
      box: { ...chosen.rect, minY: bottomY, maxY: topY } });
    return { ...common, status: reason === null ? 'PROPOSED' as const : 'REJECTED' as const, reason, shaft: chosen.rect,
      door: { side: chosen.side, widthMm: e.door.widthMm, point2: d.point, spaceIds: d.spaces }, verticalAccess: d.access,
      overlappedSpaces: a.overlapped.map(s => ({ spaceId: s.spaceId, area: { value: s.area, unit: 'mm2' as const } })), crossedWallIds: a.crossed, blockingClashIds: ids.sort() };
  });
  const status = elevators.every(e => e.status === 'PROPOSED') ? 'ANALYZED' as const : 'PARTIAL' as const;
  return { result: { ...base, status, reason: status === 'PARTIAL' ? 'At least one elevator proposal was rejected' : null, elevators }, shafts, clashes };
}
