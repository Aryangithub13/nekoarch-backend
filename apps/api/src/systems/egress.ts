import { pointLocation, type Point2Mm } from '@designflow/shared';
import { NOT_EVALUATED, SUBMODELS, SYSTEMS_LIMITS, SystemsError, type SystemsModel, type SystemsResults } from './contracts.js';

type Via = { kind: 'OPENING' | 'STAIR'; id: string };
type Edge = { to: number; w: number; via: Via | null };
const scaled = (ring: readonly Point2Mm[], k: number) => ring.map(p => ({ x: k * p.x, z: k * p.z }));
const rectRing = (r: { minX: number; minZ: number; maxX: number; maxZ: number }) => [{ x: r.minX, z: r.minZ }, { x: r.maxX, z: r.minZ }, { x: r.maxX, z: r.maxZ }, { x: r.minX, z: r.maxZ }];
/** Flight ends in doubled coordinates: the midpoint of the bottom (start) and top (end) edges of a straight flight. */
export function stairEnds2(s: SystemsModel['stairs'][number]) {
  const f = s.flight, midX = f.minX + f.maxX, midZ = f.minZ + f.maxZ;
  const ends = { '+x': [{ x: 2 * f.minX, z: midZ }, { x: 2 * f.maxX, z: midZ }], '-x': [{ x: 2 * f.maxX, z: midZ }, { x: 2 * f.minX, z: midZ }],
    '+z': [{ x: midX, z: 2 * f.minZ }, { x: midX, z: 2 * f.maxZ }], '-z': [{ x: midX, z: 2 * f.maxZ }, { x: midX, z: 2 * f.minZ }] }[s.direction];
  return { bottom: ends[0]!, top: ends[1]! };
}

/** Independent egress graph (egress-l1-geodesic-v1); never reuses Blueprint QA circulation. Plan values are doubled so opening centres stay exact. */
export function buildEgressGraph(model: SystemsModel) {
  const nodes: { x: number; z: number; spaceId: string }[] = [], adj: Edge[][] = [], bySpace = new Map<string, number[]>(), at = new Map<string, number>();
  const blocked = new Set(model.exits.obstructedOpeningIds);
  const openings = model.openings.filter(o => o.traversable && !blocked.has(o.openingId));
  for (const s of model.spaces) {
    const ring2 = scaled(s.boundary, 2), ring4 = scaled(s.boundary, 4);
    // Stair flights (both levels) and floor voids are not walkable floor.
    const holes = [...model.stairs.filter(t => t.fromLevelId === s.levelId || t.toLevelId === s.levelId).map(t => rectRing(t.flight)),
      ...model.plates.filter(p => p.levelId === s.levelId).flatMap(p => p.voids)];
    const holes2 = holes.map(h => scaled(h, 2)), holes4 = holes.map(h => scaled(h, 4));
    const points = [...openings.filter(o => o.spaceIds.includes(s.spaceId)).map(o => o.center2),
      ...model.stairs.flatMap(t => [...(t.fromLevelId === s.levelId ? [stairEnds2(t).bottom] : []), ...(t.toLevelId === s.levelId ? [stairEnds2(t).top] : [])])];
    const xs = [...new Set([...ring2, ...holes2.flat(), ...points].map(p => p.x))].sort((a, b) => a - b);
    const zs = [...new Set([...ring2, ...holes2.flat(), ...points].map(p => p.z))].sort((a, b) => a - b);
    if (nodes.length + xs.length * zs.length > SYSTEMS_LIMITS.egressNodes) throw new SystemsError('BUILDING_SYSTEMS_RESOURCE_LIMIT', 'The egress graph exceeds its node budget');
    const free = (p: Point2Mm, ring: Point2Mm[], hs: Point2Mm[][]) => pointLocation(p, ring) >= 0 && hs.every(h => pointLocation(p, h) !== 1);
    const ids: number[] = [], grid = new Map<string, number>();
    for (const x of xs) for (const z of zs) if (free({ x, z }, ring2, holes2)) {
      const id = nodes.length; nodes.push({ x, z, spaceId: s.spaceId }); adj.push([]); ids.push(id); grid.set(`${x},${z}`, id); at.set(`${s.spaceId}:${x},${z}`, id);
    }
    const link = (a: number | undefined, b: number | undefined, mid: Point2Mm) => {
      if (a === undefined || b === undefined || !free(mid, ring4, holes4)) return;
      const w = Math.abs(nodes[a]!.x - nodes[b]!.x) + Math.abs(nodes[a]!.z - nodes[b]!.z);
      adj[a]!.push({ to: b, w, via: null }); adj[b]!.push({ to: a, w, via: null });
    };
    for (const z of zs) xs.forEach((x, i) => { if (i) link(grid.get(`${xs[i - 1]},${z}`), grid.get(`${x},${z}`), { x: xs[i - 1]! + x, z: 2 * z }); });
    for (const x of xs) zs.forEach((z, j) => { if (j) link(grid.get(`${x},${zs[j - 1]}`), grid.get(`${x},${z}`), { x: 2 * x, z: zs[j - 1]! + z }); });
    bySpace.set(s.spaceId, ids);
  }
  const connect = (a: number | undefined, b: number | undefined, w: number, via: Via) => { if (a !== undefined && b !== undefined) { adj[a]!.push({ to: b, w, via }); adj[b]!.push({ to: a, w, via }); } };
  for (const o of openings) if (o.spaceIds.length === 2)
    connect(at.get(`${o.spaceIds[0]}:${o.center2.x},${o.center2.z}`), at.get(`${o.spaceIds[1]}:${o.center2.x},${o.center2.z}`), 0, { kind: 'OPENING', id: o.openingId });
  const node2 = (levelId: string, p: Point2Mm) => model.spaces.filter(s => s.levelId === levelId).map(s => at.get(`${s.spaceId}:${p.x},${p.z}`)).find(v => v !== undefined);
  for (const t of model.stairs) { const e = stairEnds2(t); connect(node2(t.fromLevelId, e.bottom), node2(t.toLevelId, e.top), 2 * t.runMm, { kind: 'STAIR', id: t.stairId }); }
  const exits = model.exits.openingIds.map(id => {
    const o = model.openings.find(x => x.openingId === id)!;
    return { id, node: blocked.has(id) ? undefined : at.get(`${o.spaceIds[0]}:${o.center2.x},${o.center2.z}`) };
  });
  return { nodes, adj, bySpace, exits, openings };
}
type Graph = ReturnType<typeof buildEgressGraph>;

function dijkstra(g: Graph, sources: { node: number; label: string }[], allowed?: Set<number>) {
  const n = g.nodes.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const via: (Via | null)[] = new Array(n).fill(null), label: (string | null)[] = new Array(n).fill(null), heap: [number, number][] = [];
  const less = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (item: [number, number]) => { heap.push(item); for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (!less(heap[i]!, heap[p]!)) break; [heap[i], heap[p]] = [heap[p]!, heap[i]!]; i = p; } };
  const pop = () => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(heap[l]!, heap[m]!)) m = l; if (r < heap.length && less(heap[r]!, heap[m]!)) m = r;
        if (m === i) break; [heap[i], heap[m]] = [heap[m]!, heap[i]!]; i = m; }
    }
    return top;
  };
  for (const s of [...sources].sort((a, b) => a.label < b.label ? -1 : 1)) if (dist[s.node]! > 0) { dist[s.node] = 0; label[s.node] = s.label; push([0, s.node]); }
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist[v]!) continue;
    for (const e of g.adj[v]!) {
      if (allowed && !allowed.has(e.to)) continue;
      if (d + e.w < dist[e.to]!) { dist[e.to] = d + e.w; prev[e.to] = v; via[e.to] = e.via; label[e.to] = label[v]!; push([d + e.w, e.to]); }
    }
  }
  return { dist, prev, via, label };
}

/** Node-disjoint routes from one space to distinct exits (unit capacity per intermediate space): routes sharing a corridor or stair are not independent. */
function disjointRoutes(model: SystemsModel, g: Graph, from: string) {
  const spaces = model.spaces.map(s => s.spaceId), index = new Map(spaces.map((s, i) => [s, i])), exits = g.exits.filter(e => e.node !== undefined);
  // in(i) = 2i, out(i) = 2i+1, exit k = 2n+k, sink = 2n+exits
  const n = spaces.length, size = 2 * n + exits.length + 1, sink = size - 1, cap = new Map<string, number>(), adj: number[][] = Array.from({ length: size }, () => []);
  const edge = (a: number, b: number, c: number) => {
    if (!cap.has(`${a}>${b}`) && !cap.has(`${b}>${a}`)) { adj[a]!.push(b); adj[b]!.push(a); }
    cap.set(`${a}>${b}`, (cap.get(`${a}>${b}`) ?? 0) + c); if (!cap.has(`${b}>${a}`)) cap.set(`${b}>${a}`, 0);
  };
  spaces.forEach((s, i) => edge(2 * i, 2 * i + 1, s === from ? n + exits.length : 1));
  const pairs = new Set<string>();
  for (const o of g.openings) if (o.spaceIds.length === 2) pairs.add(o.spaceIds.join('|'));
  for (const t of model.stairs) {
    const e = stairEnds2(t);
    const a = model.spaces.find(s => s.levelId === t.fromLevelId && pointLocation(e.bottom, scaled(s.boundary, 2)) >= 0);
    const b = model.spaces.find(s => s.levelId === t.toLevelId && pointLocation(e.top, scaled(s.boundary, 2)) >= 0);
    if (a && b) pairs.add([a.spaceId, b.spaceId].join('|'));
  }
  for (const p of [...pairs].sort()) { const [a, b] = p.split('|').map(s => index.get(s)!) as [number, number]; edge(2 * a + 1, 2 * b, 1); edge(2 * b + 1, 2 * a, 1); }
  exits.forEach((e, k) => { edge(2 * index.get(g.nodes[e.node!]!.spaceId)! + 1, 2 * n + k, 1); edge(2 * n + k, sink, 1); });
  let flow = 0;
  for (;;) {
    const parent = new Int32Array(size).fill(-1), start = 2 * index.get(from)!, queue = [start]; parent[start] = start;
    for (let i = 0; i < queue.length && parent[sink] === -1; i++) for (const v of [...adj[queue[i]!]!].sort((a, b) => a - b))
      if (parent[v] === -1 && cap.get(`${queue[i]}>${v}`)! > 0) { parent[v] = queue[i]!; queue.push(v); }
    if (parent[sink] === -1) return flow;
    for (let v = sink; v !== start; v = parent[v]!) { const u = parent[v]!; cap.set(`${u}>${v}`, cap.get(`${u}>${v}`)! - 1); cap.set(`${v}>${u}`, cap.get(`${v}>${u}`)! + 1); }
    flow++;
  }
}

export function egressAnalysis(model: SystemsModel): { result: SystemsResults['lifeSafety']; reachable: Set<string> | null; graph: Graph | null } {
  const base = { version: SUBMODELS.lifeSafety, convention: SUBMODELS.egress, notEvaluated: [...NOT_EVALUATED.lifeSafety] };
  const empty = { exits: [], spaces: [], unreachableSpaceIds: [], egressAvailable: null, longest: null, deadEnds: [], widths: { openings: [], stairs: [] }, nodes: 0 };
  if (model.exits.status !== 'DESIGNATED') return { reachable: null, graph: null, result: { ...base, ...empty,
    status: model.exits.status === 'NOT_REQUESTED' ? 'NOT_EVALUATED' : 'INPUT_INCOMPLETE',
    reason: model.exits.status === 'NOT_REQUESTED' ? 'Life-safety geometry was not requested' : `Missing: ${model.exits.missing.join(', ')}` } };
  const g = buildEgressGraph(model), live = g.exits.filter(e => e.node !== undefined), run = dijkstra(g, live.map(e => ({ node: e.node!, label: e.id })));
  const perExit = live.map(e => ({ id: e.id, dist: dijkstra(g, [{ node: e.node!, label: e.id }]).dist }));
  const spaces = model.spaces.map(s => {
    const ids = g.bySpace.get(s.spaceId)!, reachable = ids.length > 0 && ids.every(v => Number.isFinite(run.dist[v]!));
    if (!reachable) return { spaceId: s.spaceId, levelId: s.levelId, reachable: false, mostRemotePoint2: null, distance: null, exitOpeningId: null, via: [], levelTransitions: 0,
      disjointExitRoutes: 0, distinctExitsReachable: 0 };
    const remote = [...ids].sort((a, b) => run.dist[b]! - run.dist[a]! || g.nodes[a]!.x - g.nodes[b]!.x || g.nodes[a]!.z - g.nodes[b]!.z)[0]!;
    const via: Via[] = [];
    for (let v = remote; run.prev[v] !== -1; v = run.prev[v]!) if (run.via[v] && !(via.at(-1)?.kind === run.via[v]!.kind && via.at(-1)?.id === run.via[v]!.id)) via.push(run.via[v]!);
    via.push({ kind: 'OPENING', id: run.label[remote]! });
    return { spaceId: s.spaceId, levelId: s.levelId, reachable: true, mostRemotePoint2: { x: g.nodes[remote]!.x, z: g.nodes[remote]!.z },
      distance: { value: run.dist[remote]! / 2, unit: 'mm' as const }, exitOpeningId: run.label[remote]!, via, levelTransitions: via.filter(v => v.kind === 'STAIR').length,
      disjointExitRoutes: disjointRoutes(model, g, s.spaceId), distinctExitsReachable: perExit.filter(e => ids.every(v => Number.isFinite(e.dist[v]!))).length };
  });
  const exitSpaces = new Set(model.exits.openingIds.map(id => model.openings.find(o => o.openingId === id)!.spaceIds[0]));
  const circulation = new Set(model.spaces.filter(s => s.circulation).map(s => s.spaceId));
  // GEOMETRIC_DEAD_END_LENGTH: a circulation space with exactly one connection to other circulation and no exit; the farthest point from that connection.
  const deadEnds = model.spaces.filter(s => s.circulation && !exitSpaces.has(s.spaceId)).flatMap(s => {
    const links = new Map<string, { via: Via; node: number }>();
    for (const v of g.bySpace.get(s.spaceId)!) for (const e of g.adj[v]!)
      if (e.via && g.nodes[e.to]!.spaceId !== s.spaceId && circulation.has(g.nodes[e.to]!.spaceId) && !links.has(`${e.via.kind}:${e.via.id}`)) links.set(`${e.via.kind}:${e.via.id}`, { via: e.via, node: v });
    if (links.size !== 1) return [];
    const [link] = [...links.values()], inside = dijkstra(g, [{ node: link!.node, label: 'connection' }], new Set(g.bySpace.get(s.spaceId)!));
    const far = Math.max(...g.bySpace.get(s.spaceId)!.map(v => inside.dist[v]!).filter(Number.isFinite));
    return [{ spaceId: s.spaceId, metric: 'GEOMETRIC_DEAD_END_LENGTH' as const, length: { value: far / 2, unit: 'mm' as const }, connection: link!.via }];
  });
  const unreachable = spaces.filter(s => !s.reachable).map(s => s.spaceId);
  const longest = spaces.filter(s => s.distance).sort((a, b) => b.distance!.value - a.distance!.value || (a.spaceId < b.spaceId ? -1 : 1))[0];
  return { graph: g, reachable: new Set(spaces.filter(s => s.reachable).map(s => s.spaceId)), result: { ...base, status: 'ANALYZED', reason: null, exits: model.exits.openingIds, spaces,
    unreachableSpaceIds: unreachable, egressAvailable: unreachable.length === 0, longest: longest ? { spaceId: longest.spaceId, distance: longest.distance! } : null, deadEnds,
    widths: { openings: g.openings.map(o => ({ openingId: o.openingId, width: { value: o.widthMm, unit: 'mm' as const } })),
      stairs: model.stairs.map(t => ({ stairId: t.stairId, width: { value: t.widthMm, unit: 'mm' as const } })) }, nodes: g.nodes.length } };
}
