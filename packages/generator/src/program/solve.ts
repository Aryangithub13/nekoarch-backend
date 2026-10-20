import { BlueprintError, type Box } from '../blueprint/types.js';
import { info, isResidential, TIER_AREA_FACTOR, type SpaceKind } from './catalog.js';
import type { NormalizedProgramRequirements } from './input.js';

/** One requested room (a group with count n becomes n units). */
export interface Unit {
  key: string; kind: SpaceKind; name: string; level: number; explicitLevel: boolean; areaMm2: number; ensuite: boolean; auto: boolean;
}
export type Role = 'room' | 'sub' | 'circulation' | 'stair' | 'filler';
/** A rectangular space in the local frame (x = across the spine, z = along it, entrance end at z = 0). */
export interface Cell {
  key: string; kind: SpaceKind | 'corridor' | 'stairwell'; name: string; level: number; box: Box; role: Role;
  /** Space this cell's door opens into (key), or null for spaces reached otherwise (corridor, stairwell). */
  access: string | null; unit?: Unit;
  /** For rooms entered from the stair hall: the landing their door opens onto. */
  landing?: 'front' | 'rear';
}
export interface Layout {
  index: number; transposed: boolean; outer: Box; center: Box; floors: number; cells: Cell[];
  core: Box | null; corridorWidthMm: number; score: number; warnings: string[]; assumptions: string[];
}
const SNAP = 50;
const snap = (n: number) => Math.round(n / SNAP) * SNAP;
const m2 = (n: number) => Math.round(n * 1_000_000);
export const STAIR = Object.freeze({ widthMm: 1000, riserCount: 16, treadDepthMm: 280, landingMinMm: 1100, coreWidthMm: 2200 });
export const coreLengthMm = () => snap((STAIR.riserCount - 1) * STAIR.treadDepthMm + 2 * STAIR.landingMinMm + 260);
const ENSUITE_AREA = m2(4.2), DRESSING_MIN = 1500, BATH_STRIP = 1800, BATH_LEN = 2700;

export function expandUnits(r: NormalizedProgramRequirements): Unit[] {
  const tier = TIER_AREA_FACTOR[r.program.qualityTier];
  const totals = new Map<SpaceKind, number>(), seen = new Map<SpaceKind, number>();
  for (const s of r.program.spaces) totals.set(s.kind, (totals.get(s.kind) ?? 0) + s.count);
  const units: Unit[] = [];
  for (const s of r.program.spaces) for (let i = 0; i < s.count; i++) {
    const n = (seen.get(s.kind) ?? 0) + 1; seen.set(s.kind, n);
    const base = s.name ?? info(s.kind).label;
    units.push({ key: `${s.kind}-${n}`, kind: s.kind, name: totals.get(s.kind)! > 1 ? `${base} ${n}` : base, level: s.level ?? 0, explicitLevel: s.level !== undefined,
      areaMm2: m2(s.areaM2 ?? info(s.kind).areaM2 * tier), ensuite: s.ensuite && info(s.kind).category === 'private', auto: false });
  }
  return units;
}
export const unitArea = (u: Unit) => u.areaMm2 + (u.ensuite ? ENSUITE_AREA : 0);

/** Storey zoning: social and service rooms on the ground, bedrooms above, the rest balanced by area. Explicit levels never move. */
export function assignLevels(units: Unit[], floors: number, residential: boolean): string[] {
  const notes: string[] = [];
  if (floors === 1) { for (const u of units) u.level = 0; return notes; }
  const loads = Array.from({ length: floors }, () => 0);
  for (const u of units.filter(u => u.explicitLevel)) loads[u.level]! += unitArea(u);
  const auto = units.filter(u => !u.explicitLevel);
  const ground = auto.filter(u => info(u.kind).storey === 'ground'), upper = auto.filter(u => info(u.kind).storey === 'upper'), any = auto.filter(u => info(u.kind).storey === 'any');
  for (const u of ground) { u.level = 0; loads[0]! += unitArea(u); }
  const place = (u: Unit, from: number) => {
    let best = from;
    for (let l = from; l < floors; l++) if (loads[l]! < loads[best]!) best = l;
    u.level = best; loads[best]! += unitArea(u);
  };
  // Largest first gives a balanced, deterministic distribution across upper storeys.
  for (const u of [...upper].sort((a, b) => unitArea(b) - unitArea(a) || (a.key < b.key ? -1 : 1))) place(u, 1);
  // Common bathrooms: one on the ground floor where there is none, the rest follow the bedrooms.
  const baths = any.filter(u => u.kind === 'bathroom'), others = any.filter(u => u.kind !== 'bathroom');
  for (const u of [...others].sort((a, b) => unitArea(b) - unitArea(a) || (a.key < b.key ? -1 : 1))) place(u, residential ? 0 : 0);
  baths.forEach((u, i) => {
    if (i === 0 && !units.some(o => o.level === 0 && info(o.kind).category === 'wet' && o !== u)) { u.level = 0; loads[0]! += unitArea(u); return; }
    const needy = Array.from({ length: floors }, (_, l) => l).filter(l => l > 0 && units.some(o => o.level === l && info(o.kind).category === 'private' && !o.ensuite) && !units.some(o => o !== u && o.level === l && o.kind === 'bathroom'));
    if (needy.length) { u.level = needy[0]!; loads[u.level]! += unitArea(u); } else place(u, 0);
  });
  // A ground floor much lighter than the floors above takes bedrooms down (guest use); an empty storey takes from the fullest.
  for (let guard = 0; guard < units.length; guard++) {
    const max = Math.max(...loads.slice(1));
    if (loads[0]! >= 0.7 * max) break;
    const fullest = loads.indexOf(max);
    const candidate = units.filter(u => !u.explicitLevel && u.level === fullest && info(u.kind).category === 'private').sort((a, b) => unitArea(a) - unitArea(b))[0];
    if (!candidate || loads[0]! + unitArea(candidate) > max - unitArea(candidate) + unitArea(candidate) * 0.5) break;
    loads[fullest]! -= unitArea(candidate); candidate.level = 0; loads[0]! += unitArea(candidate);
    notes.push(`${candidate.name} placed on the ground floor to balance the storeys.`);
  }
  for (let l = 0; l < floors; l++) if (!units.some(u => u.level === l)) {
    const kind: SpaceKind = residential ? 'family' : 'workspace';
    units.push({ key: `${kind}-auto-${l}`, kind, name: `${info(kind).label} (floor ${l + 1})`, level: l, explicitLevel: false, areaMm2: m2(info(kind).areaM2), ensuite: false, auto: true });
    notes.push(`Floor ${l + 1} had no requested rooms; a ${info(kind).label.toLowerCase()} was added so the storey is usable.`);
  }
  return notes;
}

/** Rejection counts from the last search, for diagnostics. */
export const rejections = new Map<string, number>();
const reject = (reason: string): null => { rejections.set(reason, (rejections.get(reason) ?? 0) + 1); return null; };
interface Params { front: number; rear: number; corridorX: number; corridorW: number; coreLeft: boolean; coreZ: number; strategy: 0 | 1 }
interface FloorPlan { cells: Cell[]; penalty: number; warnings: string[] }

/** Clear (wall-face) size of a centerline box inside the center box: exterior edges lose half the exterior wall, others half an interior wall. */
export function clearOf(b: Box, center: { w: number; d: number }, e: number, t: number): Box {
  const h = (onEdge: boolean) => (onEdge ? e : t) / 2;
  const x0 = h(b.x === 0), x1 = h(b.x + b.w === center.w), z0 = h(b.z === 0), z1 = h(b.z + b.d === center.d);
  return { x: b.x + x0, z: b.z + z0, w: b.w - x0 - x1, d: b.d - z0 - z1 };
}
const fits = (clear: Box, kind: SpaceKind) => {
  const k = info(kind), small = Math.min(clear.w, clear.d), large = Math.max(clear.w, clear.d);
  return small >= Math.min(k.minWidthMm, k.minDepthMm) && large >= Math.max(k.minWidthMm, k.minDepthMm);
};

/** Distributes `total` over items with minimums and weights; null when the minimums do not fit. */
function partition(total: number, mins: number[], weights: number[]): number[] | null {
  if (!mins.length) return [];
  const minSum = mins.reduce((a, b) => a + b, 0);
  if (minSum > total) return null;
  // Water-filling: each item gets max(min, share of what is left), iterated until stable.
  const fixed = new Set<number>(), sizes = mins.slice();
  for (let iter = 0; iter < mins.length + 1; iter++) {
    const free = mins.map((_, i) => i).filter(i => !fixed.has(i));
    const left = total - [...fixed].reduce((a, i) => a + mins[i]!, 0);
    const wsum = free.reduce((a, i) => a + weights[i]!, 0) || 1;
    let changed = false;
    for (const i of free) {
      const share = left * weights[i]! / wsum;
      if (share < mins[i]!) { fixed.add(i); changed = true; }
      sizes[i] = Math.max(mins[i]!, share);
    }
    if (!changed) break;
  }
  const snapped = sizes.map(s => Math.max(snap(s), 0));
  for (let i = 0; i < snapped.length; i++) if (snapped[i]! < mins[i]!) snapped[i] = Math.ceil(mins[i]! / SNAP) * SNAP;
  const diff = total - snapped.reduce((a, b) => a + b, 0);
  // The largest item absorbs the rounding so the chain closes exactly.
  const largest = snapped.indexOf(Math.max(...snapped));
  snapped[largest]! += diff;
  if (snapped.some((s, i) => s < mins[i]! - SNAP)) return null;
  return snapped;
}

/** Minimum centerline length along the stack direction for a unit placed in a strip of the given width. */
function minAlong(u: Unit, width: number, e: number, t: number, clearAcross = width - t): number | null {
  const k = info(u.kind), clearW = clearAcross;
  const small = Math.min(k.minWidthMm, k.minDepthMm), large = Math.max(k.minWidthMm, k.minDepthMm);
  let roomWidth = clearW;
  if (u.ensuite && width >= 4500) roomWidth = clearW - BATH_STRIP;
  if (roomWidth < small) return null;
  // Ends may meet the exterior wall: allow a full exterior thickness so the clear length always holds.
  const need = (roomWidth >= large ? small : large) + e;
  const extra = u.ensuite && width < 4500 ? BATH_STRIP : 0;
  return Math.max(need + extra, u.ensuite && width >= 4500 ? BATH_LEN + e : 0);
}

const ROW_HUB_FRONT: SpaceKind[] = ['living', 'reception', 'seating', 'retail', 'pharmacy', 'foyer', 'family', 'office', 'master', 'bedroom', 'workspace', 'hall', 'classroom'];
const ROW_HUB_REAR: SpaceKind[] = ['dining', 'kitchen', 'commercialKitchen', 'family', 'master', 'workspace', 'conference', 'hall', 'bedroom', 'guest', 'studio', 'classroom'];

/** Picks the units of one end row: a hub that takes the corridor door, plus up to two annex rooms reached through it. */
function pickRow(units: Unit[], end: 'front' | 'rear', floorLevel: number, residential: boolean): { hub: Unit; annexes: Unit[] } | null {
  const order = end === 'front' ? ROW_HUB_FRONT : ROW_HUB_REAR;
  const candidates = units.filter(u => order.includes(u.kind) && (info(u.kind).zone === end || (end === 'rear' && floorLevel > 0 && ['master', 'family', 'bedroom', 'guest'].includes(u.kind)) || (end === 'front' && floorLevel > 0 && ['family', 'bedroom', 'master'].includes(u.kind))));
  candidates.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || unitArea(b) - unitArea(a) || (a.key < b.key ? -1 : 1));
  const hub = candidates[0];
  if (!hub) return null;
  const openPlan = end === 'front' && (hub.kind === 'living' || hub.kind === 'family');
  const annexOk = (u: Unit) => u !== hub && info(u.kind).annex && !u.ensuite && (info(u.kind).zone === end || (openPlan && ['dining', 'kitchen', 'puja', 'store', 'pantry'].includes(u.kind)));
  let annexes = units.filter(annexOk);
  // A dining hub pulls its kitchen next to it; an entry hub pulls the garage; never pair private rooms as annexes.
  annexes.sort((a, b) => Number(b.kind === 'kitchen' || b.kind === 'garage') - Number(a.kind === 'kitchen' || a.kind === 'garage') || unitArea(b) - unitArea(a));
  annexes = annexes.slice(0, hub.ensuite ? 0 : 2);
  void residential;
  return { hub, annexes };
}

/** Lays out one storey for the given parameters, or returns null when the program cannot be placed. */
function planFloor(level: number, floors: number, units: Unit[], p: Params, V: number, U: number, core: Box | null, e: number, t: number, residential: boolean, frontRow: boolean, rearRow: boolean): FloorPlan | null {
  const cells: Cell[] = [], warnings: string[] = [];
  let penalty = 0;
  const center = { w: V, d: U };
  const corridorKey = `corridor-${level}`;
  const pool = [...units];
  const take = (u: Unit) => { const i = pool.indexOf(u); if (i >= 0) pool.splice(i, 1); };
  const front = frontRow ? pickRow(pool, 'front', level, residential) : null;
  if (front) { take(front.hub); front.annexes.forEach(take); }
  const rear = rearRow ? pickRow(pool, 'rear', level, residential) : null;
  if (rear) { take(rear.hub); rear.annexes.forEach(take); }
  const zFront = front ? p.front : 0, zRear = rear ? U - p.rear : U;
  if (zRear - zFront < 1200) return reject('corridor-too-short');
  if (core && (core.z < zFront || core.z + core.d > zRear)) return reject('core-outside-middle');
  const cx0 = p.corridorX, cx1 = p.corridorX + p.corridorW;

  // Unit cell splitting: the main room keeps the access side; an en-suite takes the far strip or the far end.
  const placeUnit = (u: Unit, box: Box, access: string, accessSide: 'minX' | 'maxX' | 'minZ' | 'maxZ'): boolean => {
    const k = info(u.kind);
    if (!u.ensuite) {
      cells.push({ key: u.key, kind: u.kind, name: u.name, level, box, role: 'room', access, unit: u });
      return fits(clearOf(box, center, e, t), u.kind);
    }
    const across = accessSide === 'minX' || accessSide === 'maxX'; // access edge is vertical: the depth away from access runs along x
    const depthAway = across ? box.w : box.d, along = across ? box.d : box.w;
    const bathKey = `${u.key}-bath`, bathName = `${u.name} bath`;
    let room: Box, bath: Box, dress: Box | null = null;
    if (depthAway >= Math.max(k.minWidthMm, k.minDepthMm) * 0 + Math.min(k.minWidthMm, k.minDepthMm) + BATH_STRIP + t && depthAway >= 4500) {
      // Far strip: bath (and a dressing when the strip is long), both opening into the room.
      const roomDepth = depthAway - BATH_STRIP;
      const bathLen = along - BATH_LEN >= DRESSING_MIN + t ? BATH_LEN : along;
      if (across) {
        const roomX = accessSide === 'minX' ? box.x : box.x + BATH_STRIP, stripX = accessSide === 'minX' ? box.x + roomDepth : box.x;
        room = { x: roomX, z: box.z, w: roomDepth, d: box.d };
        bath = { x: stripX, z: box.z, w: BATH_STRIP, d: bathLen };
        if (bathLen < along) dress = { x: stripX, z: box.z + bathLen, w: BATH_STRIP, d: along - bathLen };
      } else {
        const roomZ = accessSide === 'minZ' ? box.z : box.z + BATH_STRIP, stripZ = accessSide === 'minZ' ? box.z + roomDepth : box.z;
        room = { x: box.x, z: roomZ, w: box.w, d: roomDepth };
        bath = { x: box.x, z: stripZ, w: bathLen, d: BATH_STRIP };
        if (bathLen < along) dress = { x: box.x + bathLen, z: stripZ, w: along - bathLen, d: BATH_STRIP };
      }
    } else {
      // Narrow cell: bath at the far end along the access edge; it opens into the room, not the corridor.
      if (along < BATH_STRIP + Math.min(k.minWidthMm, k.minDepthMm) + t) return false;
      const roomLen = along - BATH_STRIP;
      if (across) { room = { x: box.x, z: box.z, w: box.w, d: roomLen }; bath = { x: box.x, z: box.z + roomLen, w: box.w, d: BATH_STRIP }; }
      else { room = { x: box.x, z: box.z, w: roomLen, d: box.d }; bath = { x: box.x + roomLen, z: box.z, w: BATH_STRIP, d: box.d }; }
    }
    cells.push({ key: u.key, kind: u.kind, name: u.name, level, box: room, role: 'room', access, unit: u });
    cells.push({ key: bathKey, kind: 'bathroom', name: bathName, level, box: bath, role: 'sub', access: u.key });
    if (dress) cells.push({ key: `${u.key}-dress`, kind: 'dressing', name: `${u.name} dressing`, level, box: dress, role: 'sub', access: u.key });
    return fits(clearOf(room, center, e, t), u.kind) && fits(clearOf(bath, center, e, t), 'bathroom') && (!dress || fits(clearOf(dress, center, e, t), 'dressing'));
  };

  // End rows: [annex | hub | annex] across the full width; the hub must span the corridor end so it can take the corridor door.
  const placeRow = (row: { hub: Unit; annexes: Unit[] }, z: number, d: number, end: 'front' | 'rear'): boolean => {
    const left = row.annexes.slice(0, 1), right = row.annexes.slice(1, 2);
    const minW = (u: Unit) => { const k = info(u.kind), small = Math.min(k.minWidthMm, k.minDepthMm), large = Math.max(k.minWidthMm, k.minDepthMm); return (d - t >= large ? small : large) + t; };
    const want = (u: Unit) => Math.max(minW(u), unitArea(u) / d);
    const margin = 0;
    const leftW = left.length ? Math.min(snap(want(left[0]!)), cx0 - margin) : 0;
    const rightW = right.length ? Math.min(snap(want(right[0]!)), V - cx1 - margin) : 0;
    if ((left.length && leftW < minW(left[0]!)) || (right.length && rightW < minW(right[0]!))) return false;
    const hubBox = { x: leftW, z, w: V - leftW - rightW, d };
    if (hubBox.x > cx0 || hubBox.x + hubBox.w < cx1) return false;
    const accessSide = end === 'front' ? 'maxZ' : 'minZ';
    if (!placeUnit(row.hub, hubBox, corridorKey, accessSide)) return false;
    if (left.length) cells.push({ key: left[0]!.key, kind: left[0]!.kind, name: left[0]!.name, level, box: { x: 0, z, w: leftW, d }, role: 'room', access: row.hub.key, unit: left[0]! });
    if (right.length) cells.push({ key: right[0]!.key, kind: right[0]!.kind, name: right[0]!.name, level, box: { x: V - rightW, z, w: rightW, d }, role: 'room', access: row.hub.key, unit: right[0]! });
    for (const u of [...left, ...right]) { const c = cells.find(c => c.key === u.key)!; if (!fits(clearOf(c.box, center, e, t), u.kind)) return false; }
    // A hub much larger or smaller than intended is a soft cost, never a failure.
    penalty += Math.abs(hubBox.w * d - unitArea(row.hub)) / Math.max(unitArea(row.hub), 1) * 0.8;
    return true;
  };
  if (front && !placeRow(front, 0, zFront, 'front')) return reject('front-row');
  if (rear && !placeRow(rear, zRear, U - zRear, 'rear')) return reject('rear-row');

  // Corridor spine.
  cells.push({ key: corridorKey, kind: 'corridor', name: level === 0 ? 'Entrance passage' : 'Passage', level, box: { x: cx0, z: zFront, w: p.corridorW, d: zRear - zFront }, role: 'circulation', access: null });

  // Banks: ordered segments along z on each side of the corridor; the stair core interrupts its bank.
  type Segment = { x: number; w: number; z: number; d: number; side: 'left' | 'right' };
  const segments: Segment[] = [];
  const banks: { side: 'left' | 'right'; x: number; w: number }[] = [];
  if (cx0 > 0) banks.push({ side: 'left', x: 0, w: cx0 });
  if (cx1 < V) banks.push({ side: 'right', x: cx1, w: V - cx1 });
  for (const b of banks) {
    if (core && (b.side === 'left') === p.coreLeft) {
      if (core.z - zFront > 0) segments.push({ ...b, z: zFront, d: core.z - zFront });
      if (zRear - (core.z + core.d) > 0) segments.push({ ...b, z: core.z + core.d, d: zRear - core.z - core.d });
    } else segments.push({ ...b, z: zFront, d: zRear - zFront });
  }
  // Stair core hugs the corridor. The strip beside it (exterior side) holds one or two rooms entered from a walkable landing:
  // on the ground and top floors both core ends are walkable (one lane is free), on intermediate floors only the active landing.
  const coreCells: { box: Box; landing: 'front' | 'rear' }[] = [];
  if (core) {
    const bank = banks.find(b => (b.side === 'left') === p.coreLeft);
    if (!bank) return reject('core-bank-missing');
    const coreBox = { x: p.coreLeft ? core.x : cx1, z: core.z, w: core.w, d: core.d };
    cells.push({ key: `stairwell-${level}`, kind: 'stairwell', name: 'Stair hall', level, box: coreBox, role: 'stair', access: null });
    const strip = p.coreLeft ? { x: 0, z: core.z, w: core.x, d: core.d } : { x: cx1 + core.w, z: core.z, w: V - cx1 - core.w, d: core.d };
    if (strip.w > 0) {
      const active: 'front' | 'rear' = level % 2 === 0 ? 'front' : 'rear';
      if (level === 0 || level === floors - 1) {
        const half = snap(strip.d / 2);
        coreCells.push({ box: { ...strip, d: half }, landing: 'front' }, { box: { ...strip, z: strip.z + half, d: strip.d - half }, landing: 'rear' });
      } else coreCells.push({ box: strip, landing: active });
    }
  }
  const zoneRank = { front: 0, middle: 1, rear: 2 } as const;
  // Small program rooms go beside the stair first (stores, puja, toilets, studies), smallest rooms into the smallest cells.
  const coreKinds: SpaceKind[] = ['store', 'utility', 'puja', 'toilet', 'pantry', 'serverRoom', 'bathroom', 'dressing', 'study', 'office', 'cabin', 'kids', 'guest', 'bedroom', 'gym', 'library'];
  for (const cc of coreCells) {
    const clear = clearOf(cc.box, center, e, t);
    const fitting = pool.filter(u => !u.ensuite && coreKinds.includes(u.kind) && fits(clear, u.kind) && unitArea(u) <= cc.box.w * cc.box.d * 1.6)
      .sort((a, b) => coreKinds.indexOf(a.kind) - coreKinds.indexOf(b.kind) || unitArea(a) - unitArea(b));
    const u = fitting[0];
    const key = u ? u.key : `store-core-${level}-${cc.landing}`;
    if (u) take(u);
    cells.push({ key, kind: u ? u.kind : 'store', name: u ? u.name : residential ? 'Store' : 'Services', level, box: cc.box, role: u ? 'room' : 'filler', access: `stairwell-${level}`, landing: cc.landing, ...(u ? { unit: u } : {}) });
    if (!u) penalty += cc.box.w * cc.box.d / 1_000_000 * 0.12;
  }
  const across = (s: Segment) => s.w - (s.x === 0 || s.x + s.w === V ? e / 2 : t / 2) - t / 2;
  const minFor = (u: Unit, s: Segment) => minAlong(u, s.w, e, t, across(s));
  const wantFor = (u: Unit, s: Segment) => Math.max(minFor(u, s) ?? 1e9, snap(unitArea(u) / s.w));
  const assignment = new Map<Segment, Unit[]>(segments.map(s => [s, []]));
  const used = (s: Segment, f: (u: Unit) => number) => assignment.get(s)!.reduce((n, u) => n + f(u), 0);
  const capacity = (s: Segment) => s.d - used(s, u => minFor(u, s) ?? 1e9);
  const wantLeft = (s: Segment) => s.d - used(s, u => wantFor(u, s));
  // Largest first, each into the segment with the most room left; strategy 1 keeps wet rooms together away from the core.
  const bySize = [...pool].sort((a, b) => unitArea(b) - unitArea(a) || (a.key < b.key ? -1 : 1));
  for (const u of bySize) {
    const wet = info(u.kind).category === 'wet';
    const options = segments.filter(s => minFor(u, s) !== null && capacity(s) >= minFor(u, s)!);
    if (!options.length) return reject('bank-capacity');
    options.sort((a, b) => {
      if (p.strategy === 1 && wet) { const pref = (s: Segment) => Number(s.side !== (p.coreLeft ? 'left' : 'right')); if (pref(a) !== pref(b)) return pref(b) - pref(a); }
      return wantLeft(b) / b.d - wantLeft(a) / a.d || a.z - b.z;
    });
    assignment.get(options[0]!)!.push(u);
  }
  for (const list of assignment.values()) list.sort((a, b) => zoneRank[info(a.kind).zone] - zoneRank[info(b.kind).zone] || info(a.kind).category.localeCompare(info(b.kind).category) || (a.key < b.key ? -1 : 1));
  const fillerFor = (d: number): { kind: SpaceKind; name: string } => d < 3000 ? { kind: 'store', name: residential ? 'Store' : 'Services' }
    : residential ? { kind: 'family', name: level === 0 ? 'Sitting / family area' : 'Family lounge' } : { kind: 'workspace', name: 'Flexible space' };
  for (const s of segments) {
    const list = assignment.get(s)!;
    if (!list.length) {
      // An empty bank segment is still floor area: small ones become stores, larger ones a lounge or open work area.
      const f = fillerFor(s.d);
      cells.push({ key: `filler-${level}-${s.side}-${s.z}`, kind: f.kind, name: f.name, level, box: { x: s.x, z: s.z, w: s.w, d: s.d }, role: 'filler', access: corridorKey });
      penalty += s.d * s.w / 1_000_000 * 0.15;
      continue;
    }
    const mins = list.map(u => minFor(u, s)!), wants = list.map(u => wantFor(u, s));
    const wantSum = wants.reduce((a, b) => a + b, 0);
    // Rooms grow at most about 35% past their target; real surplus becomes its own lounge/store instead of a stretched room.
    const surplus = s.d - Math.round(wantSum * 1.35);
    const fillerLen = surplus >= 2400 ? snap(s.d - wantSum * 1.15) : 0;
    const lengths = partition(s.d - fillerLen, mins, wants);
    if (!lengths) return reject('bank-partition');
    // The filler sits at the end of the segment nearest the rear on the ground floor (yard side), else at its far end.
    let z = s.z;
    for (let i = 0; i < list.length; i++) {
      const u = list[i]!, box = { x: s.x, z, w: s.w, d: lengths[i]! };
      z += lengths[i]!;
      if (!placeUnit(u, box, corridorKey, s.side === 'left' ? 'maxX' : 'minX')) return reject('bank-unit-fit');
      const actual = box.w * box.d, target = unitArea(u);
      penalty += Math.min(3, Math.abs(actual - target) / target) * (actual > target ? 1.2 : 1);
    }
    if (fillerLen) {
      const f = fillerFor(fillerLen);
      cells.push({ key: `filler-${level}-${s.side}-${z}`, kind: f.kind, name: f.name, level, box: { x: s.x, z, w: s.w, d: fillerLen }, role: 'filler', access: corridorKey });
      penalty += fillerLen * s.w / 1_000_000 * 0.1;
    }
  }
  // Soft costs: proportions, daylight for habitable rooms, zoning and corridor share.
  for (const c of cells.filter(c => c.role === 'room')) {
    const cl = clearOf(c.box, center, e, t), ratio = Math.max(cl.w, cl.d) / Math.max(1, Math.min(cl.w, cl.d));
    penalty += Math.max(0, ratio - 1.7) * 1.5;
    const exterior = c.box.x === 0 || c.box.z === 0 || c.box.x + c.box.w === V || c.box.z + c.box.d === U;
    if (c.kind !== 'corridor' && c.kind !== 'stairwell' && info(c.kind).habitable && !exterior) { penalty += 2.5; warnings.push(`${c.name} has no exterior wall for a window`); }
    if (c.kind !== 'corridor' && c.kind !== 'stairwell') {
      const zone = info(c.kind).zone, mid = (c.box.z + c.box.d / 2) / U;
      if (zone === 'front' && mid > 0.5 && level === 0) penalty += 0.6;
      if (zone === 'rear' && mid < 0.4 && level === 0) penalty += 0.4;
    }
  }
  penalty += p.corridorW * (zRear - zFront) / (V * U) * 4;
  return { cells, penalty, warnings };
}

export interface Footprint { outer: Box; center: Box; transposed: boolean; assumptions: string[] }
/** Rectangular buildable region after declared setbacks, trimmed to the program so rooms are not stretched across a large plot. */
export function footprint(r: NormalizedProgramRequirements, units: Unit[], slack = 1): Footprint {
  const b = r.site.boundary, xs = b.map(p => p.x), zs = b.map(p => p.z);
  const site = { x: Math.min(...xs), z: Math.min(...zs), w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) };
  const permitted = { ...site };
  for (const s of r.site.setbacks) {
    const a = b[s.boundaryEdgeStart]!, c = b[(s.boundaryEdgeStart + 1) % 4]!;
    if (a.x === c.x) { if (a.x === site.x) { permitted.x += s.minimumMm; permitted.w -= s.minimumMm; } else permitted.w -= s.minimumMm; }
    else { if (a.z === site.z) { permitted.z += s.minimumMm; permitted.d -= s.minimumMm; } else permitted.d -= s.minimumMm; }
  }
  const e = r.exteriorWallThicknessMm;
  if (permitted.w < 4000 || permitted.d < 4000) throw new BlueprintError('PROGRAM_DOES_NOT_FIT', 'Setbacks leave less than 4 m of buildable width or depth', { buildableWidthMm: permitted.w, buildableDepthMm: permitted.d });
  const assumptions: string[] = [];
  // Area each storey needs: rooms plus about a fifth for walls and the corridor, plus the stair core when there are upper floors.
  const coreArea = r.floors > 1 ? STAIR.coreWidthMm * coreLengthMm() : 0;
  const perFloor = Array.from({ length: r.floors }, (_, l) => units.filter(u => u.level === l).reduce((n, u) => n + unitArea(u), 0) * 1.32 + coreArea);
  const need = Math.max(...perFloor);
  const transposed = permitted.w > permitted.d * 1.6;
  const across = transposed ? permitted.d : permitted.w, alongMax = transposed ? permitted.w : permitted.d;
  const minAlongMm = Math.max(r.floors > 1 ? coreLengthMm() + 2400 : 6000, 6000);
  let along = Math.min(alongMax, Math.max(minAlongMm, Math.ceil(need * slack / across / 100) * 100));
  if (along > alongMax) along = alongMax;
  if (need > across * alongMax * 1.04) assumptions.push(`The requested rooms need about ${Math.round(need / 1e6)} m² per floor but the buildable area is ${Math.round(across * alongMax / 1e6)} m²; rooms are reduced toward their minimum sizes.`);
  let offset = 0;
  if (along < alongMax) {
    // Leftover depth: up to 4.5 m stays in front for parking and a garden; the rest becomes a rear yard.
    offset = Math.min(4500, Math.round((alongMax - along) * 0.6 / 100) * 100);
    assumptions.push(`Building depth trimmed to ${(along / 1000).toFixed(1)} m to suit the program; ${(offset / 1000).toFixed(1)} m front yard and ${((alongMax - along - offset) / 1000).toFixed(1)} m rear yard remain open.`);
  }
  const outer = transposed ? { x: permitted.x + offset, z: permitted.z, w: along, d: permitted.d } : { x: permitted.x, z: permitted.z + offset, w: permitted.w, d: along };
  const center = { x: outer.x + e / 2, z: outer.z + e / 2, w: outer.w - e, d: outer.d - e };
  return { outer, center, transposed, assumptions };
}

/** Candidate search over corridor position, end-row depths and stair core placement; returns layouts best first. */
export function solveLayouts(r: NormalizedProgramRequirements, units: Unit[], fp: Footprint): Layout[] {
  const residential = isResidential(r.program.buildingType);
  const e = r.exteriorWallThicknessMm, t = r.interiorWallThicknessMm;
  const V = fp.transposed ? fp.center.d : fp.center.w, U = fp.transposed ? fp.center.w : fp.center.d;
  const corridorW = residential ? 1200 : 1500;
  const layouts: Layout[] = [];
  rejections.clear();
  const coreL = coreLengthMm();
  const fronts = [0, 3300, 3600, 4200, 4800, 5400, 6000].filter(n => n === 0 || n < U * 0.5);
  const rears = [0, 3000, 3300, 3900, 4500, 5100].filter(n => n === 0 || n < U * 0.45);
  const corridorXs = new Set<number>();
  for (const f of [0.5, 0.42, 0.58, 0.35, 0.65]) corridorXs.add(snap((V - corridorW) * f));
  // Asymmetric spines: one bank sized for a room width (or just the stair core), the other takes the rest.
  for (const w of [2200, 2400, 2700, 3000, 3300, 3600, 3900, 4200, 4500, 4800]) { corridorXs.add(w); corridorXs.add(V - corridorW - w); }
  if (V - corridorW < 2 * 2700) { corridorXs.add(0); corridorXs.add(V - corridorW); }
  let index = 0;
  for (const front of fronts) for (const rear of rears) for (const corridorX of corridorXs) for (const coreLeft of r.floors > 1 ? [true, false] : [true]) for (const strategy of [0, 1] as const) {
    if (corridorX < 0 || corridorX + corridorW > V) continue;
    if (corridorX > 0 && corridorX < 2200) continue;
    if (corridorX + corridorW < V && V - corridorX - corridorW < 2200) continue;
    const zones = [front > 0 ? front : 0, rear > 0 ? U - rear : U];
    const coreZs = r.floors > 1 ? [snap(zones[0]! + (zones[1]! - zones[0]! - coreL) / 2), zones[0]!, zones[1]! - coreL].filter((z, i, a) => z >= zones[0]! && z + coreL <= zones[1]! && a.indexOf(z) === i) : [0];
    for (const coreZ of coreZs) {
      const p: Params = { front, rear, corridorX, corridorW, coreLeft, coreZ, strategy };
      let core: Box | null = null;
      if (r.floors > 1) {
        const bankW = coreLeft ? corridorX : V - corridorX - corridorW;
        if (bankW < STAIR.coreWidthMm) continue;
        const w = bankW - STAIR.coreWidthMm >= 1500 ? STAIR.coreWidthMm : bankW;
        let z0 = coreZ, z1 = coreZ + coreL;
        if (z0 - zones[0]! > 0 && z0 - zones[0]! < 1500) z0 = zones[0]!;
        if (zones[1]! - z1 > 0 && zones[1]! - z1 < 1500) z1 = zones[1]!;
        core = { x: coreLeft ? corridorX - w : 0, z: z0, w, d: z1 - z0 };
      }
      const all: Cell[] = [], warnings: string[] = [];
      let score = 0, ok = true;
      for (let level = 0; level < r.floors && ok; level++) {
        const floorUnits = units.filter(u => u.level === level);
        const plan = planFloor(level, r.floors, floorUnits, p, V, U, core, e, t, residential, front > 0, rear > 0);
        if (!plan) { ok = false; break; }
        all.push(...plan.cells); warnings.push(...plan.warnings); score += plan.penalty;
      }
      index++;
      if (!ok) continue;
      layouts.push({ index, transposed: fp.transposed, outer: fp.outer, center: fp.center, floors: r.floors, cells: all, core, corridorWidthMm: corridorW, score, warnings: [...new Set(warnings)], assumptions: [] });
    }
  }
  return layouts.sort((a, b) => a.score - b.score || a.index - b.index);
}
