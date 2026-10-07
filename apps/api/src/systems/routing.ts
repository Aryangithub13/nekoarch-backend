import { pointLocation, type Point2Mm } from '@designflow/shared';
import { ROUTING_WEIGHTS, SYSTEMS, SYSTEMS_LIMITS, SystemsError, type Box, type Network, type NetworkResult, type Penetration, type ServiceSize, type SystemsModel,
  type Terminal } from './contracts.js';
import { systemsId } from './model.js';
import { add, div, exact, fromNumber, rational, toExact, ZERO, type Rational } from './units.js';

export type P3 = { x: number; y: number; z: number };
export interface Budget { states: number; deadline: number }
/** A hard volume: architecture (stair flight), structure (conservative envelope), proposed shaft, or an earlier network's service segment. */
export interface Solid { id: string; kind: 'STAIR' | 'STRUCTURE' | 'SHAFT' | 'SERVICE'; group: string; discipline: string; box: Box; clearance: number }
export type Branch = { terminalId: string; points: P3[]; joins: 'ROOT' | 'NETWORK' };
interface Outcome { status: NetworkResult['status']; failure: NetworkResult['failure']; branches: Branch[]; stacks: { point: Point2Mm; levelIds: string[] }[]; arrival: Rational | null }

/** Plan half-size uses the larger section dimension (conservative for risers and either run direction); both rounded up to whole mm. */
export function halfSizes(size: ServiceSize | null) {
  if (!size) return { plan: 0, vertical: 0 };
  return size.shape === 'ROUND' ? { plan: Math.ceil(size.diameterMm / 2), vertical: Math.ceil(size.diameterMm / 2) }
    : { plan: Math.ceil(Math.max(size.widthMm, size.heightMm) / 2), vertical: Math.ceil(size.heightMm / 2) };
}
export const sizeLabel = (size: ServiceSize | null) => !size ? null : size.shape === 'ROUND' ? `ROUND-${size.diameterMm}mm` : `${size.widthMm}x${size.heightMm}mm`;
export function boxOf(a: P3, b: P3, plan: number, vertical: number): Box {
  return { minX: Math.min(a.x, b.x) - plan, maxX: Math.max(a.x, b.x) + plan, minY: Math.min(a.y, b.y) - vertical, maxY: Math.max(a.y, b.y) + vertical,
    minZ: Math.min(a.z, b.z) - plan, maxZ: Math.max(a.z, b.z) + plan };
}
/** Electrical feeders and circuits share one containment group; every other network is its own group. */
export const groupOf = (n: Network) => n.discipline === 'ELECTRICAL' ? 'ELECTRICAL' : n.id;
export function architectureSolids(model: SystemsModel): Solid[] {
  const stairs = model.stairs.map(s => ({ id: s.stairId, kind: 'STAIR' as const, group: 'ARCHITECTURE', discipline: 'ARCHITECTURE', clearance: 0,
    box: { minX: s.flight.minX, maxX: s.flight.maxX, minZ: s.flight.minZ, maxZ: s.flight.maxZ, minY: s.bottomY, maxY: s.topY } }));
  const members = model.structure.members.filter(m => m.halfSizeMm !== null).map(m => {
    const h = m.halfSizeMm!, span = (a: number, b: number) => a === b ? [a - h, b + h] as const : [Math.min(a, b), Math.max(a, b)] as const;
    const [minX, maxX] = span(m.start.x, m.end.x), [minY, maxY] = span(m.start.y, m.end.y), [minZ, maxZ] = span(m.start.z, m.end.z);
    return { id: m.memberId, kind: 'STRUCTURE' as const, group: 'STRUCTURE', discipline: 'STRUCTURE', clearance: 0, box: { minX, maxX, minY, maxY, minZ, maxZ } };
  });
  return [...stairs, ...members];
}
/** The storey that physically contains elevation y (below the lowest floor: the lowest storey; above the roof: the highest). */
export function storeyAt(model: SystemsModel, y: number) {
  return model.levels.find(l => y >= l.elevationMm && y < l.topMm) ?? (y < model.levels[0]!.elevationMm ? model.levels[0]! : model.levels.at(-1)!);
}
const doubled = (ring: readonly Point2Mm[]) => ring.map(p => ({ x: 2 * p.x, z: 2 * p.z }));

// ------------------------------------------------------------------ orthogonal Hanan grid
interface GridLevel { levelId: string; y: number; band: { top: number; bottom: number } | null; lo: number; hi: number }
interface Grid { xs: number[]; zs: number[]; levels: GridLevel[]; node: Uint8Array[]; edgeX: Uint8Array[]; edgeZ: Uint8Array[]; crossX: Uint8Array[]; crossZ: Uint8Array[];
  up: Uint8Array[]; gravity: boolean }
type PlanRect = { minX: number; maxX: number; minZ: number; maxZ: number };
const inside = (r: PlanRect, x: number, z: number) => r.minX < x && x < r.maxX && r.minZ < z && z < r.maxZ;

function buildGrid(model: SystemsModel, net: Network, anchors: P3[], solids: Solid[]): Grid {
  const { plan: sp, vertical: sv } = halfSizes(net.size), c = net.clearanceMm ?? 0, gravity = net.system === 'SANITARY', group = groupOf(net);
  const levels: GridLevel[] = net.levels.map(l => {
    const top = l.band ? l.band.top : l.y!, bottom = l.band ? l.band.bottom : l.y!;
    return { levelId: l.levelId, y: top, band: l.band, lo: bottom - sv - c, hi: top + sv + c };
  });
  const storeys = levels.map(l => doubled(storeyAt(model, (l.lo + l.hi) / 2).boundary));
  // Hard volumes are inflated by this service's half-size plus the larger explicit clearance (configuration space), rounded outward to whole mm.
  const hard = (lo: number, hi: number): PlanRect[] => solids.filter(s => s.group !== group && s.box.minY < hi && s.box.maxY > lo).map(s => {
    const pad = sp + Math.max(c, s.clearance);
    return { minX: Math.floor(s.box.minX - pad), maxX: Math.ceil(s.box.maxX + pad), minZ: Math.floor(s.box.minZ - pad), maxZ: Math.ceil(s.box.maxZ + pad) };
  });
  // Wall bands are soft: crossing one is a penetration (penalised, reported); running along inside one is forbidden.
  const bands = (lo: number, hi: number) => model.walls.filter(w => w.bottomY < hi && w.topY > lo).map(w => {
    const r = Math.ceil(w.thicknessMm / 2) + sp + c, alongX = w.start.z === w.end.z;
    return { alongX, at: alongX ? w.start.z : w.start.x, from: alongX ? Math.min(w.start.x, w.end.x) : Math.min(w.start.z, w.end.z),
      to: alongX ? Math.max(w.start.x, w.end.x) : Math.max(w.start.z, w.end.z),
      rect: { minX: Math.min(w.start.x, w.end.x) - r, maxX: Math.max(w.start.x, w.end.x) + r, minZ: Math.min(w.start.z, w.end.z) - r, maxZ: Math.max(w.start.z, w.end.z) + r } };
  });
  const perLevel = levels.map(l => ({ hard: hard(l.lo, l.hi), bands: bands(l.lo, l.hi) }));
  const risers = levels.slice(0, -1).map((l, t) => {
    const u = levels[t + 1]!, yLow = Math.min(l.y, u.y), yHigh = Math.max(l.y, u.y);
    return { hard: hard(Math.min(l.lo, u.lo), Math.max(l.hi, u.hi)), bands: bands(Math.min(l.lo, u.lo), Math.max(l.hi, u.hi)), plates: model.plates.filter(p => p.bottomY < yHigh && p.topY > yLow) };
  });
  const X = new Set<number>(), Z = new Set<number>();
  for (const ring of storeys) for (const p of ring) { X.add(p.x / 2); Z.add(p.z / 2); }
  for (const g of [...perLevel, ...risers]) {
    for (const r of g.hard) { X.add(r.minX); X.add(r.maxX); Z.add(r.minZ); Z.add(r.maxZ); }
    for (const b of g.bands) { X.add(b.rect.minX); X.add(b.rect.maxX); Z.add(b.rect.minZ); Z.add(b.rect.maxZ); }
  }
  for (const a of anchors) { X.add(a.x); Z.add(a.z); }
  const xs = [...X].sort((a, b) => a - b), zs = [...Z].sort((a, b) => a - b), nx = xs.length, nz = zs.length, n = nx * nz;
  if (n * levels.length > SYSTEMS_LIMITS.gridNodesPerNetwork) throw new SystemsError('BUILDING_SYSTEMS_RESOURCE_LIMIT', `Routing grid for ${net.key} exceeds the node budget`);
  const node: Uint8Array[] = [], edgeX: Uint8Array[] = [], edgeZ: Uint8Array[] = [], crossX: Uint8Array[] = [], crossZ: Uint8Array[] = [], up: Uint8Array[] = [];
  levels.forEach((_, t) => {
    const { hard: rects, bands: walls } = perLevel[t]!, ring = storeys[t]!, valid = new Uint8Array(n), ex = new Uint8Array(n), ez = new Uint8Array(n), cx = new Uint8Array(n), cz = new Uint8Array(n);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++)
      valid[i * nz + j] = pointLocation({ x: 2 * xs[i]!, z: 2 * zs[j]! }, ring) >= 0 && !rects.some(r => inside(r, xs[i]!, zs[j]!)) ? 1 : 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const k = i * nz + j;
      if (i + 1 < nx && valid[k] && valid[k + nz]) {
        const mx = (xs[i]! + xs[i + 1]!) / 2, z = zs[j]!;
        if (pointLocation({ x: xs[i]! + xs[i + 1]!, z: 2 * z }, ring) >= 0 && !rects.some(r => inside(r, mx, z)) && !walls.some(w => w.alongX && inside(w.rect, mx, z))) {
          ex[k] = 1;
          cx[k] = Math.min(255, walls.filter(w => !w.alongX && xs[i]! < w.at && w.at <= xs[i + 1]! && w.from <= z && z <= w.to).length);
        }
      }
      if (j + 1 < nz && valid[k] && valid[k + 1]) {
        const mz = (zs[j]! + zs[j + 1]!) / 2, x = xs[i]!;
        if (pointLocation({ x: 2 * x, z: zs[j]! + zs[j + 1]! }, ring) >= 0 && !rects.some(r => inside(r, x, mz)) && !walls.some(w => !w.alongX && inside(w.rect, x, mz))) {
          ez[k] = 1;
          cz[k] = Math.min(255, walls.filter(w => w.alongX && zs[j]! < w.at && w.at <= zs[j + 1]! && w.from <= x && x <= w.to).length);
        }
      }
    }
    node.push(valid); edgeX.push(ex); edgeZ.push(ez); crossX.push(cx); crossZ.push(cz);
  });
  risers.forEach((r, t) => {
    const u = new Uint8Array(n);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const k = i * nz + j, x = xs[i]!, z = zs[j]!;
      if (!node[t]![k] || !node[t + 1]![k] || r.hard.some(h => inside(h, x, z)) || r.bands.some(b => inside(b.rect, x, z))) continue;
      // A riser crosses floor plates only through solid slab: never through a stair void or outside a plate it would have to cross.
      if (r.plates.every(p => pointLocation({ x, z }, p.outer) === 1 && p.voids.every(v => pointLocation({ x, z }, v) === -1))) u[k] = 1;
    }
    up.push(u);
  });
  return { xs, zs, levels, node, edgeX, edgeZ, crossX, crossZ, up, gravity };
}

/** Exact integer Dijkstra over (node, incoming direction); ties break on (cost, state index), so output never depends on insertion order. */
function search(g: Grid, source: number, targets: Uint8Array, budget: Budget): number[] | null {
  const nx = g.xs.length, nz = g.zs.length, n = nx * nz, states = n * g.levels.length * 6;
  const dist = new Float64Array(states).fill(Infinity), prev = new Int32Array(states).fill(-1);
  const heapCost: number[] = [], heapState: number[] = [];
  const less = (a: number, b: number) => heapCost[a]! < heapCost[b]! || (heapCost[a] === heapCost[b] && heapState[a]! < heapState[b]!);
  const swap = (a: number, b: number) => { [heapCost[a], heapCost[b]] = [heapCost[b]!, heapCost[a]!]; [heapState[a], heapState[b]] = [heapState[b]!, heapState[a]!]; };
  const push = (cost: number, state: number) => {
    heapCost.push(cost); heapState.push(state);
    for (let i = heapCost.length - 1; i > 0;) { const p = (i - 1) >> 1; if (!less(i, p)) break; swap(i, p); i = p; }
  };
  const pop = () => {
    const cost = heapCost[0]!, state = heapState[0]!, lastCost = heapCost.pop()!, lastState = heapState.pop()!;
    if (heapCost.length) {
      heapCost[0] = lastCost; heapState[0] = lastState;
      for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heapCost.length && less(l, m)) m = l; if (r < heapCost.length && less(r, m)) m = r; if (m === i) break; swap(i, m); i = m; }
    }
    return [cost, state] as const;
  };
  dist[source * 6] = 0; push(0, source * 6);
  const opposite = [0, 2, 1, 4, 3, -1];
  while (heapCost.length) {
    const [cost, state] = pop();
    if (cost > dist[state]!) continue;
    if (--budget.states < 0) throw new SystemsError('BUILDING_SYSTEMS_RESOURCE_LIMIT', 'Routing exceeded the search budget');
    if ((budget.states & 4095) === 0 && performance.now() > budget.deadline) throw new SystemsError('SYSTEM_ANALYSIS_TIMEOUT', 'Routing exceeded the calculation deadline');
    const nodeIndex = Math.floor(state / 6), dir = state % 6;
    if (targets[nodeIndex]) {
      const path: number[] = [];
      for (let s = state; s !== -1; s = prev[s]!) path.push(Math.floor(s / 6));
      return path.reverse();
    }
    const t = Math.floor(nodeIndex / n), k = nodeIndex % n, i = Math.floor(k / nz), j = k % nz;
    const relax = (to: number, newDir: number, length: number, crossings: number, vertical: boolean) => {
      if (dir && opposite[dir] === newDir) return;
      const next = cost + length + (dir && dir !== newDir ? ROUTING_WEIGHTS.bend : 0) + crossings * ROUTING_WEIGHTS.wallCrossing + (vertical ? ROUTING_WEIGHTS.levelTransition : 0);
      const s = to * 6 + newDir;
      if (next < dist[s]!) { dist[s] = next; prev[s] = state; push(next, s); }
    };
    if (i + 1 < nx && g.edgeX[t]![k]) relax(nodeIndex + nz, 1, g.xs[i + 1]! - g.xs[i]!, g.crossX[t]![k]!, false);
    if (i > 0 && g.edgeX[t]![k - nz]) relax(nodeIndex - nz, 2, g.xs[i]! - g.xs[i - 1]!, g.crossX[t]![k - nz]!, false);
    if (j + 1 < nz && g.edgeZ[t]![k]) relax(nodeIndex + 1, 3, g.zs[j + 1]! - g.zs[j]!, g.crossZ[t]![k]!, false);
    if (j > 0 && g.edgeZ[t]![k - 1]) relax(nodeIndex - 1, 4, g.zs[j]! - g.zs[j - 1]!, g.crossZ[t]![k - 1]!, false);
    // Gravity drainage only ever descends a level in flow direction (fixture → outlet).
    if (!g.gravity && t + 1 < g.levels.length && g.up[t]![k]) relax(nodeIndex + n, 5, Math.abs(g.levels[t + 1]!.y - g.levels[t]!.y), 0, true);
    if (t > 0 && g.up[t - 1]![k]) relax(nodeIndex - n, 5, Math.abs(g.levels[t]!.y - g.levels[t - 1]!.y), 0, true);
  }
  return null;
}

const same = (a: P3, b: P3) => a.x === b.x && a.y === b.y && a.z === b.z;
/** Drop repeated points and interior points on a straight run, keeping any point another branch joins at. */
function compress(points: P3[], keep: (p: P3) => boolean) {
  const unique = points.filter((p, i) => i === 0 || !same(p, points[i - 1]!));
  return unique.filter((p, i) => {
    if (i === 0 || i === unique.length - 1 || keep(p)) return true;
    const a = unique[i - 1]!, b = unique[i + 1]!, d1 = [p.x - a.x, p.y - a.y, p.z - a.z], d2 = [b.x - p.x, b.y - p.y, b.z - p.z];
    const parallel = d1[1]! * d2[2]! === d1[2]! * d2[1]! && d1[0]! * d2[2]! === d1[2]! * d2[0]! && d1[0]! * d2[1]! === d1[1]! * d2[0]!;
    return !(parallel && d1[0]! * d2[0]! + d1[1]! * d2[1]! + d1[2]! * d2[2]! > 0);
  });
}

function planned(model: SystemsModel, net: Network, terminals: Map<string, Terminal>, solids: Solid[], budget: Budget): Outcome {
  const root = terminals.get(net.rootId!)!, members = net.terminalIds.map(id => terminals.get(id)!).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const anchor = (t: Terminal): P3 => ({ x: t.point!.x, y: t.y, z: t.point!.z });
  const g = buildGrid(model, net, [root, ...members].map(anchor), solids), nx = g.xs.length, nz = g.zs.length, n = nx * nz;
  const levelIndex = new Map(g.levels.map((l, t) => [l.levelId, t]));
  const nodeOf = (t: Terminal) => {
    const level = levelIndex.get(t.levelId)!, k = g.xs.indexOf(t.point!.x) * nz + g.zs.indexOf(t.point!.z);
    return g.node[level]![k] ? level * n + k : -1;
  };
  const fail = (status: 'ROUTE_NOT_FOUND' | 'ROUTE_INVALID', code: 'SYSTEM_ROUTE_NOT_FOUND' | 'SYSTEM_ROUTE_INVALID', message: string): Outcome =>
    ({ status, failure: { code, message }, branches: [], stacks: [], arrival: null });
  const rootNode = nodeOf(root);
  if (rootNode < 0) return fail('ROUTE_INVALID', 'SYSTEM_ROUTE_INVALID', `The ${root.key} connection lies inside an obstacle or outside the building at the routing elevation`);
  const targets = new Uint8Array(n * g.levels.length); targets[rootNode] = 1;
  const paths: { terminal: Terminal; nodes: number[] }[] = [];
  for (const t of members) {
    const source = nodeOf(t);
    if (source < 0) return fail('ROUTE_INVALID', 'SYSTEM_ROUTE_INVALID', `Terminal ${t.key} lies inside an obstacle or outside the building at the routing elevation`);
    const nodes = search(g, source, targets, budget);
    if (!nodes) return fail('ROUTE_NOT_FOUND', 'SYSTEM_ROUTE_NOT_FOUND', `No obstacle-free ${g.gravity ? 'descending ' : ''}route connects ${t.key} to the ${net.key} network`);
    for (const v of nodes) targets[v] = 1;
    paths.push({ terminal: t, nodes });
  }
  const at = (v: number) => { const t = Math.floor(v / n), k = v % n; return { t, x: g.xs[Math.floor(k / nz)]!, z: g.zs[k % nz]! }; };
  const joins = paths.slice(1).map(p => at(p.nodes.at(-1)!));
  const stacks = new Map<string, { point: Point2Mm; levels: Set<number> }>();
  for (const p of paths) p.nodes.forEach((v, i) => {
    const w = p.nodes[i + 1]; if (w === undefined || Math.floor(v / n) === Math.floor(w / n)) return;
    const a = at(v), b = at(w), key = `${a.x},${a.z}`, s = stacks.get(key) ?? { point: { x: a.x, z: a.z }, levels: new Set<number>() };
    s.levels.add(a.t); s.levels.add(b.t); stacks.set(key, s);
  });
  const stackList = [...stacks.values()].sort((a, b) => a.point.x - b.point.x || a.point.z - b.point.z)
    .map(s => ({ point: s.point, levelIds: [...s.levels].sort((a, b) => a - b).map(t => g.levels[t]!.levelId) }));

  if (!g.gravity) {
    const keep = (q: P3) => joins.some(a => a.x === q.x && a.z === q.z && g.levels[a.t]!.y === q.y);
    const branches = paths.map((p, b) => {
      const points: P3[] = [anchor(p.terminal), ...p.nodes.map(v => { const a = at(v); return { x: a.x, y: g.levels[a.t]!.y, z: a.z }; })];
      if (b === 0) points.push(anchor(root));
      return { terminalId: p.terminal.id, points: compress(points, keep), joins: b === 0 ? 'ROOT' as const : 'NETWORK' as const };
    });
    return { status: 'ROUTED', failure: null, branches, stacks: stackList, arrival: null };
  }

  // Gravity: centreline elevations in exact scaled units (mm × run), computed leaf → outlet over the routed tree.
  const { rise, run } = net.slope!, R = BigInt(run), S = BigInt(rise);
  const top = (t: number) => BigInt(g.levels[t]!.band!.top) * R, bottom = (t: number) => BigInt(g.levels[t]!.band!.bottom) * R;
  const min = (values: bigint[]) => values.reduce((a, b) => a < b ? a : b);
  const next = new Map<number, number>(), incoming = new Map<number, number[]>(), start = new Map<number, bigint>();
  for (const p of paths) {
    const first = p.nodes[0]!;
    start.set(first, min([...(start.has(first) ? [start.get(first)!] : []), BigInt(p.terminal.y) * R, top(at(first).t)]));
    p.nodes.forEach((v, i) => { const w = p.nodes[i + 1]; if (w !== undefined && !next.has(v)) { next.set(v, w); incoming.set(w, [...(incoming.get(w) ?? []), v]); } });
  }
  const e = new Map<number, bigint>();
  const arrival = (u: number, v: number) => {
    const a = at(u), b = at(v);
    if (a.t !== b.t) return min([e.get(u)!, top(b.t)]);
    return e.get(u)! - BigInt(Math.abs(a.x - b.x) + Math.abs(a.z - b.z)) * S;
  };
  const pending = new Map([...new Set([...start.keys(), ...next.keys(), ...next.values()])].map(v => [v, (incoming.get(v) ?? []).length]));
  const queue = [...pending].filter(([, d]) => d === 0).map(([v]) => v).sort((a, b) => a - b);
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i]!;
    e.set(v, min([...(start.has(v) ? [start.get(v)!] : []), ...(incoming.get(v) ?? []).map(u => arrival(u, v))]));
    if (e.get(v)! < bottom(at(v).t)) return fail('ROUTE_INVALID', 'SYSTEM_ROUTE_INVALID', `Gravity drainage leaves the ${g.levels[at(v).t]!.levelId} drainage band at the required slope; it is never pressurised`);
    const w = next.get(v); if (w !== undefined) { pending.set(w, pending.get(w)! - 1); if (pending.get(w) === 0) queue.push(w); }
  }
  if (e.get(rootNode)! < BigInt(root.y) * R) return fail('ROUTE_INVALID', 'SYSTEM_ROUTE_INVALID', 'The outlet is higher than the arriving drainage; uphill or pressurised drainage is not produced');
  const y = (scaled: bigint) => Number(scaled) / run;
  const keep = (q: P3) => joins.some(a => a.x === q.x && a.z === q.z);
  const branches = paths.map((p, b) => {
    const points: P3[] = [anchor(p.terminal)];
    p.nodes.forEach((v, i) => {
      const a = at(v), arrive = i === 0 ? start.get(v)! : arrival(p.nodes[i - 1]!, v);
      points.push({ x: a.x, y: y(arrive), z: a.z });
      if (e.get(v)! < arrive) points.push({ x: a.x, y: y(e.get(v)!), z: a.z });
    });
    if (b === 0) points.push(anchor(root));
    return { terminalId: p.terminal.id, points: compress(points, keep), joins: b === 0 ? 'ROOT' as const : 'NETWORK' as const };
  });
  return { status: 'ROUTED', failure: null, branches, stacks: stackList, arrival: rational(e.get(rootNode)!, R) };
}

export function onSegment3(p: P3, a: P3, b: P3) {
  const between = (v: number, s: number, t: number) => v >= Math.min(s, t) && v <= Math.max(s, t);
  const collinear = (p.x - a.x) * (b.z - a.z) === (b.x - a.x) * (p.z - a.z) && (p.y - a.y) * (b.x - a.x) === (b.y - a.y) * (p.x - a.x)
    && (p.y - a.y) * (b.z - a.z) === (b.y - a.y) * (p.z - a.z);
  return collinear && between(p.x, a.x, b.x) && between(p.y, a.y, b.y) && between(p.z, a.z, b.z);
}

/** User-fixed polylines are checked for shape and connectivity, never rerouted. */
function fixed(net: Network, terminals: Map<string, Terminal>): Outcome {
  const root = terminals.get(net.rootId!)!, rootPoint = { x: root.point!.x, y: root.y, z: root.point!.z };
  const fail = (message: string): Outcome => ({ status: 'ROUTE_INVALID', failure: { code: 'SYSTEM_ROUTE_INVALID', message }, branches: [], stacks: [], arrival: null });
  const branches: Branch[] = [];
  for (const r of net.fixedRoutes) {
    const t = terminals.get(r.terminalId)!, pts = r.points;
    if (!same(pts[0]!, { x: t.point!.x, y: t.y, z: t.point!.z })) return fail(`Fixed route for ${t.key} does not start at its terminal`);
    if (pts.some((p, i) => i > 0 && [p.x !== pts[i - 1]!.x, p.y !== pts[i - 1]!.y, p.z !== pts[i - 1]!.z].filter(Boolean).length !== 1))
      return fail(`Fixed route for ${t.key} has a zero-length or non-orthogonal segment`);
    const end = pts.at(-1)!, onEarlier = branches.some(b => b.points.some((p, i) => i > 0 && onSegment3(end, b.points[i - 1]!, p)));
    if (!same(end, rootPoint) && !onEarlier) return fail(`Fixed route for ${t.key} is disconnected from the ${net.key} network`);
    branches.push({ terminalId: t.id, points: pts, joins: same(end, rootPoint) ? 'ROOT' : 'NETWORK' });
  }
  if (!branches.some(b => b.joins === 'ROOT')) return fail(`No fixed route of ${net.key} reaches its root`);
  return { status: 'ROUTED', failure: null, branches, stacks: [], arrival: null };
}

/** Splits earlier branches at the points later branches join, so every junction is a vertex (needed for per-segment airflow). */
function splitAtJoins(branches: Branch[]) {
  const out = branches.map(b => ({ ...b, points: [...b.points] })), joiners = out.map(() => ({ branch: -1, vertex: -1 }));
  out.forEach((b, i) => {
    if (i === 0 || b.joins === 'ROOT') return;
    const end = b.points.at(-1)!;
    for (let c = 0; c < i; c++) {
      const pts = out[c]!.points, v = pts.findIndex(p => same(p, end));
      if (v >= 0) { joiners[i] = { branch: c, vertex: v }; return; }
      const s = pts.findIndex((p, k) => k > 0 && onSegment3(end, pts[k - 1]!, p));
      if (s > 0) { pts.splice(s, 0, end); joiners.forEach(j => { if (j.branch === c && j.vertex >= s) j.vertex++; }); joiners[i] = { branch: c, vertex: s }; return; }
    }
  });
  return { branches: out, joiners };
}

export function measure(model: SystemsModel, branches: Branch[]) {
  let horizontal = 0, vertical = 0, bends = 0, levelTransitions = 0;
  const axis = (u: P3, v: P3) => u.x !== v.x ? `x${Math.sign(v.x - u.x)}` : u.z !== v.z ? `z${Math.sign(v.z - u.z)}` : 'y';
  for (const b of branches) b.points.forEach((p, i) => {
    const a = b.points[i - 1]; if (!a) return;
    if (a.x === p.x && a.z === p.z) { vertical += Math.abs(p.y - a.y); levelTransitions += model.levels.filter(l => Math.min(a.y, p.y) < l.elevationMm && l.elevationMm <= Math.max(a.y, p.y)).length; }
    else horizontal += Math.abs(p.x - a.x) + Math.abs(p.z - a.z);
    const o = b.points[i - 2];
    if (o && axis(o, a) !== axis(a, p)) bends++;
  });
  return { horizontal, vertical, length: horizontal + vertical, bends, levelTransitions };
}

/** Every wall crossed within its height and every floor plate crossed by a vertical run is an explicit, review-required penetration proposal. */
export function penetrationsOf(model: SystemsModel, net: Network, branches: Branch[]): Penetration[] {
  const { plan: sp, vertical: sv } = halfSizes(net.size), found = new Map<string, Penetration>();
  const add = (collection: 'walls' | 'slabs', id: string, location: P3) => {
    const key = `${collection}:${id}:${location.x}:${location.y}:${location.z}`;
    if (!found.has(key)) found.set(key, { id: systemsId(model.binding.projectId, 'penetration', `${net.key}:${key}`), networkId: net.id, host: { collection, id }, location,
      sizeMm: { width: 2 * sp, height: 2 * sv, clearance: net.clearanceMm }, review: 'REVIEW_REQUIRED' });
  };
  for (const b of branches) b.points.forEach((p, i) => {
    const a = b.points[i - 1]; if (!a) return;
    if (a.x === p.x && a.z === p.z) {
      for (const plate of model.plates) if (Math.min(a.y, p.y) < plate.topY && Math.max(a.y, p.y) > plate.bottomY
        && pointLocation({ x: p.x, z: p.z }, plate.outer) >= 0 && plate.voids.every(v => pointLocation({ x: p.x, z: p.z }, v) !== 1)) add('slabs', plate.slabId, { x: p.x, y: plate.topY, z: p.z });
      return;
    }
    const alongX = a.z === p.z, s0 = alongX ? a.x : a.z, s1 = alongX ? p.x : p.z, lo = Math.min(s0, s1), hi = Math.max(s0, s1), across = alongX ? a.z : a.x;
    for (const w of model.walls) {
      const wallAlongZ = w.start.x === w.end.x;
      if (alongX !== wallAlongZ) continue;
      const at = wallAlongZ ? w.start.x : w.start.z, from = wallAlongZ ? Math.min(w.start.z, w.end.z) : Math.min(w.start.x, w.end.x), to = wallAlongZ ? Math.max(w.start.z, w.end.z) : Math.max(w.start.x, w.end.x);
      if (!(lo < at && at <= hi) || across < from || across > to) continue;
      const yAt = a.y + (p.y - a.y) * (at - s0) / (s1 - s0);
      if (Math.min(a.y, p.y) - sv < w.topY && Math.max(a.y, p.y) + sv > w.bottomY) add('walls', w.wallId, alongX ? { x: at, y: yAt, z: across } : { x: across, y: yAt, z: at });
    }
  });
  return [...found.values()].sort((a, b) => a.id < b.id ? -1 : 1);
}

const ORDER = SYSTEMS as readonly string[];
/** Routes every network in a fixed priority order; each treats earlier networks' segments as hard volumes. */
export function routeNetworks(model: SystemsModel, airflow: Map<string, Rational | null>, shafts: Solid[], budget: Budget) {
  const terminals = new Map(model.terminals.map(t => [t.id, t])), solids = [...architectureSolids(model), ...shafts];
  // Every network's terminal and root drops are reserved up front, so no network runs through another's connection point.
  for (const net of model.networks.filter(n => n.status === 'READY')) {
    const { plan: sp, vertical: sv } = halfSizes(net.size);
    for (const t of [net.rootId!, ...net.terminalIds].map(id => terminals.get(id)!)) {
      const level = net.levels.find(l => l.levelId === t.levelId)!, y = level.band ? Math.min(t.y, level.band.top) : level.y!;
      solids.push({ id: net.id, kind: 'SERVICE', group: groupOf(net), discipline: net.discipline, clearance: net.clearanceMm ?? 0,
        box: boxOf({ x: t.point!.x, y: t.y, z: t.point!.z }, { x: t.point!.x, y, z: t.point!.z }, sp, sv) });
    }
  }
  const order =[...model.networks].sort((a, b) => ORDER.indexOf(a.system) - ORDER.indexOf(b.system) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const results = new Map<string, NetworkResult>(), penetrations: Penetration[] = [];
  for (const net of order) {
    const base = { networkId: net.id, length: { value: 0, unit: 'mm' as const }, horizontalLength: { value: 0, unit: 'mm' as const }, verticalLength: { value: 0, unit: 'mm' as const },
      bends: 0, levelTransitions: 0, branches: [], drainage: null, airflow: null };
    if (net.status !== 'READY') {
      results.set(net.id, { ...base, status: net.status === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'INPUT_INCOMPLETE',
        failure: { code: 'BUILDING_SYSTEMS_INPUT_INCOMPLETE', message: `Missing: ${net.missing.join(', ')}`.slice(0, 300) } });
      continue;
    }
    const outcome = net.mode === 'FIXED' ? fixed(net, terminals) : planned(model, net, terminals, solids, budget);
    if (outcome.status !== 'ROUTED') { results.set(net.id, { ...base, status: outcome.status, failure: outcome.failure }); continue; }
    const { branches, joiners } = splitAtJoins(outcome.branches), m = measure(model, branches), { plan: sp, vertical: sv } = halfSizes(net.size);
    for (const b of branches) b.points.forEach((p, i) => { const a = b.points[i - 1];
      if (a) solids.push({ id: net.id, kind: 'SERVICE', group: groupOf(net), discipline: net.discipline, box: boxOf(a, p, sp, sv), clearance: net.clearanceMm ?? 0 }); });
    penetrations.push(...penetrationsOf(model, net, branches));
    results.set(net.id, { ...base, status: 'ROUTED', failure: null, branches,
      length: { value: m.length, unit: 'mm' }, horizontalLength: { value: m.horizontal, unit: 'mm' }, verticalLength: { value: m.vertical, unit: 'mm' },
      bends: m.bends, levelTransitions: m.levelTransitions,
      drainage: net.system === 'SANITARY' ? { slope: net.slope!, outletElevation: { value: terminals.get(net.rootId!)!.y, unit: 'mm' }, arrivalElevation: exact(outcome.arrival!, 'mm'),
        stacks: outcome.stacks } : null,
      airflow: net.discipline === 'HVAC' ? airflowOf(net, branches, joiners, airflow) : null });
  }
  return { results: model.networks.map(n => results.get(n.id)!), penetrations: penetrations.sort((a, b) => a.id < b.id ? -1 : 1) };
}

/** Segment airflow = the sum of the explicit airflows of every terminal downstream of it; v = Q/A only with an explicit section. */
function airflowOf(net: Network, branches: Branch[], joiners: { branch: number; vertex: number }[], airflow: Map<string, Rational | null>) {
  const own = branches.map(b => airflow.get(b.terminalId) ?? null), total: (Rational | null)[] = [...own];
  for (let i = branches.length - 1; i > 0; i--) {
    const j = joiners[i]!;
    if (j.branch >= 0) total[j.branch] = total[j.branch] === null || total[i] === null ? null : add(total[j.branch]!, total[i]!);
  }
  const size = net.size, area = size?.shape === 'RECTANGULAR' ? rational(BigInt(size.widthMm * size.heightMm), 1_000_000n) : null;
  const segments = branches.flatMap((b, i) => b.points.slice(1).map((p, k) => {
    let flow: Rational | null = own[i]!;
    joiners.forEach((j, d) => { if (j.branch === i && j.vertex <= k && flow !== null) flow = total[d] === null ? null : add(flow, total[d]!); });
    const velocity = flow === null || !size ? null : area ? exact(div(flow, area), 'm/s')
      : { value: (Number(flow[0]) / Number(flow[1])) / (Math.PI * (size as { diameterMm: number }).diameterMm ** 2 / 4_000_000),
        exact: `${toExact(flow)}/(pi*${(size as { diameterMm: number }).diameterMm}^2/4000000)`, unit: 'm/s' as const };
    return { from: b.points[k]!, to: p, flow: flow === null ? null : exact(flow, 'm3/s'), velocity };
  }));
  const sum = own.reduce<Rational | null>((s, f) => s === null || f === null ? null : add(s, f), ZERO);
  return { total: sum === null ? null : exact(sum, 'm3/s'), segments };
}
/** Explicit airflow in m³/s, exactly: L/s ÷ 1000. */
export const cubicMetresPerSecond = (value: number, unit: 'L/s' | 'm3/s') => unit === 'm3/s' ? fromNumber(value) : div(fromNumber(value), rational(1000n));
