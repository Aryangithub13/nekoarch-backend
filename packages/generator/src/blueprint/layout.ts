import { seededRandom, shuffled } from '../random.js';
import { BLUEPRINT_VERSION, selectorKey, type NormalizedBlueprintRequirements } from './input.js';
import { reconcilePartition, rectangle, sharedEdge, transpose } from './geometry.js';
import { BlueprintError, type Box, type Candidate, type Constraints, type RoomIntent, type SolvedSpace } from './types.js';

export interface SearchBudget { candidates: number; iterations: number }
export function spend(budget: SearchBudget, r: NormalizedBlueprintRequirements): void {
  if (budget.iterations >= r.solver.maxIterations) throw new BlueprintError('SEARCH_LIMIT_EXHAUSTED', 'Deterministic iteration budget exhausted');
  budget.iterations++;
}
export function* candidateSchedule(r: NormalizedBlueprintRequirements, c: Constraints) {
  const random = seededRandom(`${BLUEPRINT_VERSION}:${r.seed}`);
  for (let round = 0; round < 8; round++) {
    const ordered = shuffled(c.rooms, random);
    for (const axis of ['z', 'x'] as const) {
      const splits = r.floors === 2 ? [-1] : Array.from({ length: c.rooms.length + 1 }, (_, i) => i);
      // Try balanced banks first, then every single-bank and unbalanced partition.
      splits.sort((a, b) => Math.abs(a - c.rooms.length / 2) - Math.abs(b - c.rooms.length / 2) || a - b);
      for (const split of splits) yield { ordered, axis, split };
    }
  }
}
export function allocateCandidate(r: NormalizedBlueprintRequirements, c: Constraints, ordered: RoomIntent[], axis: 'x' | 'z', split: number, index: number, budget: SearchBudget): Candidate {
  const envelope = axis === 'z' ? c.center : transpose(c.center);
  const e = r.exteriorWallThicknessMm, p = r.interiorWallThicknessMm;
  const spaces: SolvedSpace[] = [];
  const crossMin = (room: RoomIntent) => axis === 'z' ? room.requirement.minWidthMm : room.requirement.minDepthMm;
  const longMin = (room: RoomIntent) => axis === 'z' ? room.requirement.minDepthMm : room.requirement.minWidthMm;
  function add(key: string, level: number, role: SolvedSpace['role'], classification: string, box: Box, left: number, right: number, front: number, rear: number) {
    const clear = { x: box.x + left / 2, z: box.z + front / 2, w: box.w - (left + right) / 2, d: box.d - (front + rear) / 2 };
    const actual = axis === 'z' ? box : transpose(box), clearActual = axis === 'z' ? clear : transpose(clear);
    spaces.push({ key, role, box: actual, clear: clearActual, entity: { id: `space-${key}`, name: key, classification, levelId: `level-${level}`, boundary: rectangle(actual), boundaryBasis: 'wall-centerline' } });
  }
  for (let level = 0; level < r.floors; level++) {
    const requested = ordered.filter(room => room.level === level);
    const left = r.floors === 2 ? [] : requested.slice(0, split), right = r.floors === 2 ? requested : requested.slice(split);
    const hasLeft = left.length > 0 || r.floors === 2, hasRight = right.length > 0;
    // Empty explicit floors still receive circulation and the stair core.
    const corridorWidth = r.circulationWidthMm + ((hasLeft ? p : e) + (hasRight ? p : e)) / 2;
    const leftMin = r.floors === 2 ? r.stair!.widthMm + (e + p) / 2 : left.length ? Math.max(...left.map(crossMin)) + (e + p) / 2 : 0;
    const rightMin = right.length ? Math.max(...right.map(crossMin)) + (e + p) / 2 : 0;
    const spare = envelope.w - corridorWidth - leftMin - rightMin;
    if (spare < 0) throw new BlueprintError(r.floors === 2 ? 'STAIR_PLACEMENT_FAILED' : 'IMPOSSIBLE_LAYOUT', 'Insufficient width for clear room, corridor and wall dimensions');
    const leftWidth = leftMin + (r.floors === 1 && hasLeft ? (hasRight ? Math.floor(spare / 2) : spare) : 0);
    const rightWidth = hasRight ? envelope.w - corridorWidth - leftWidth : 0;
    const corridorActualWidth = hasRight || (hasLeft && r.floors === 1) ? corridorWidth : envelope.w - leftWidth;
    add(`corridor-${level}`, level, 'circulation', 'circulation', { x: envelope.x + leftWidth, z: envelope.z, w: corridorActualWidth, d: envelope.d }, hasLeft ? p : e, hasRight ? p : e, e, e);
    const allocateBank = (bank: RoomIntent[], x: number, width: number, isLeft: boolean) => {
      if (!bank.length) return;
      const clearWidth = width - (e + p) / 2;
      const minimums = bank.map((room, i) => {
        spend(budget, r);
        const front = i === 0 ? e : p, rear = i === bank.length - 1 ? e : p;
        const areaDepth = Math.ceil((room.requirement.minAreaMm2 ?? 1) / clearWidth);
        // Jamb reserve also keeps a room door clear of perpendicular wall solids.
        return Math.max(longMin(room), areaDepth, r.door.widthMm + 2 * r.door.jambMm) + (front + rear) / 2;
      });
      const depths = reconcilePartition(envelope.d, minimums);
      let z = envelope.z;
      bank.forEach((room, i) => {
        const depth = depths[i]!;
        add(room.key, level, 'room', room.requirement.type, { x, z, w: width, d: depth }, isLeft ? e : p, isLeft ? p : e, i === 0 ? e : p, i === bank.length - 1 ? e : p);
        z += depth;
      });
      if (z !== envelope.z + envelope.d) throw new BlueprintError('DIMENSION_RECONCILIATION_FAILED', 'Bank endpoint differs from envelope');
    };
    allocateBank(left, envelope.x, leftWidth, true);
    allocateBank(right, envelope.x + leftWidth + corridorActualWidth, rightWidth, false);
    if (r.floors === 2) {
      const stair = r.stair!, run = (stair.riserCount - 1) * stair.treadDepthMm;
      if (envelope.d - e < run + 2 * Math.max(stair.landingDepthMm, r.door.widthMm + 2 * r.door.jambMm)) throw new BlueprintError('STAIR_PLACEMENT_FAILED', 'Straight stair and both accessible landings cannot fit');
      add(`stairwell-${level}`, level, 'stair', 'stairwell', { x: envelope.x, z: envelope.z, w: leftWidth, d: envelope.d }, e, p, e, e);
    }
  }
  const candidate: Candidate = { index, axis, spaces, score: 0, warnings: [] };
  scoreCandidate(r, c, candidate);
  return candidate;
}
export function scoreCandidate(r: NormalizedBlueprintRequirements, c: Constraints, candidate: Candidate): void {
  let score = 0; const warnings: string[] = [];
  for (const relation of r.relationships) {
    const a = candidate.spaces.find(s => s.key === selectorKey(relation.from))!, b = candidate.spaces.find(s => s.key === selectorKey(relation.to))!;
    const length = a.entity.levelId === b.entity.levelId ? sharedEdge(a.box, b.box) : 0;
    const required = relation.kind === 'adjacent' ? 1 : r.door.widthMm + 2 * r.door.jambMm + (r.exteriorWallThicknessMm + r.interiorWallThicknessMm) / 2;
    if (length < required) {
      if (relation.strength === 'hard') throw new BlueprintError('UNSATISFIED_HARD_CONSTRAINT', 'Required same-level room relationship is unavailable');
      score += 1000; warnings.push(`Unmet ${relation.kind} preference: ${a.key}/${b.key}`);
    }
  }
  for (const room of c.rooms) {
    const s = candidate.spaces.find(s => s.key === room.key)!, req = room.requirement;
    for (const [preferred, actual, label] of [[req.preferredWidthMm, s.clear.w, 'width'], [req.preferredDepthMm, s.clear.d, 'depth']] as const) {
      if (preferred !== undefined && preferred !== actual) { score += Math.ceil(Math.abs(preferred - actual) / 100); warnings.push(`Unmet preferred ${label}: ${room.key}`); }
    }
    // Front/rear refers to the world z axis, regardless of corridor orientation or north.
    const rearHalf = 2 * s.clear.z + s.clear.d >= 2 * c.outer.z + c.outer.d;
    if (req.positionPreference && rearHalf !== (req.positionPreference === 'rear')) { score += 100; warnings.push(`Unmet ${req.positionPreference} preference: ${room.key}`); }
  }
  candidate.score = score; candidate.warnings = warnings;
}
