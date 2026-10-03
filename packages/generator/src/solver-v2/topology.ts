import { selectorKey } from '../blueprint/input.js';
import { BlueprintError, type RoomIntent } from '../blueprint/types.js';
import { seededRandom, shuffled } from '../random.js';
import { BLUEPRINT_V2_VERSION, SOLVER_V2_LIMITS, type NormalizedBlueprintV2Requirements } from './input.js';
import { work, type V2Budget } from './site.js';
export const zone = (type: string): 'public' | 'private' | 'service' => ['living', 'dining'].includes(type) ? 'public' : ['kitchen', 'bathroom'].includes(type) ? 'service' : 'private';
export interface ProgramGraph { rooms: RoomIntent[]; groups: RoomIntent[][]; hardEdges: string[][]; softEdges: string[][] }
export function programGraph(r: NormalizedBlueprintV2Requirements): ProgramGraph {
  const counts: Record<string, number> = {}, rooms: RoomIntent[] = [];
  for (const requirement of r.rooms) for (let i = 0; i < requirement.count; i++) {
    counts[requirement.type] = (counts[requirement.type] ?? 0) + 1;
    rooms.push({ key: `${requirement.type}-${counts[requirement.type]}`, requirement, level: requirement.level ?? -1 });
  }
  const groups = rooms.map(room => [room]);
  const hardEdges = r.relationships.filter(e => e.strength === 'hard').map(e => [selectorKey(e.from), selectorKey(e.to)]);
  for (const [a, b] of hardEdges) {
    const one = groups.find(g => g.some(room => room.key === a))!, other = groups.find(g => g.some(room => room.key === b))!;
    if (one !== other) { one.push(...other); groups.splice(groups.indexOf(other), 1); }
  }
  for (const group of groups) if (new Set(group.filter(room => room.level >= 0).map(room => room.level)).size > 1) throw new BlueprintError('HARD_RELATIONSHIP_UNSATISFIABLE', 'A mandatory same-level relationship joins rooms fixed to different floors');
  return { rooms, groups, hardEdges, softEdges: r.relationships.filter(e => e.strength === 'soft').map(e => [selectorKey(e.from), selectorKey(e.to)]) };
}
/** Components keep mandatory same-floor relations together; zone and relationship
 * orderings are explicit topology choices before any dimensions are allocated. */
export function* topologySchedule(r: NormalizedBlueprintV2Requirements, graph: ProgramGraph, budget: V2Budget) {
  const random = seededRandom(`${BLUEPRINT_V2_VERSION}:${r.seed}`);
  for (let round = 0; round < SOLVER_V2_LIMITS.floorAssignments; round++) {
    work(budget, r, graph.rooms.length);
    const rank = (room: RoomIntent) => ({ public: 0, service: 1, private: 2 })[zone(room.requirement.type)];
    const groups = round < 2 ? [...graph.groups].sort((a, b) => Math.min(...a.map(rank)) - Math.min(...b.map(rank)) || (a[0]!.key < b[0]!.key ? -1 : 1)) : shuffled(graph.groups, random);
    const loads = [0, 0], assigned: RoomIntent[][] = [];
    for (const group of groups.filter(g => g.some(room => room.level >= 0))) {
      const level = group.find(room => room.level >= 0)!.level;
      loads[level]! += group.reduce((sum, room) => sum + Math.max(room.requirement.minAreaMm2 ?? 0, room.requirement.minWidthMm * room.requirement.minDepthMm), 0);
    }
    for (const group of groups) {
      const fixed = group.find(room => room.level >= 0)?.level;
      const level = fixed ?? (r.floors === 1 ? 0 : round === 1 ? (loads[0]! < loads[1]! ? 0 : 1) : (loads[1]! < loads[0]! ? 1 : 0));
      if (fixed === undefined) loads[level]! += group.reduce((sum, room) => sum + Math.max(room.requirement.minAreaMm2 ?? 0, room.requirement.minWidthMm * room.requirement.minDepthMm), 0);
      const ordered = round < 2 ? [...group].sort((a, b) => rank(a) - rank(b) || (a.key < b.key ? -1 : 1)) : shuffled(group, random);
      assigned.push(ordered.map(room => ({ ...room, level })));
    }
    // Soft pairs are considered as a second deterministic ordering, never a hard gate.
    if (round % 2 === 1) for (const [a, b] of graph.softEdges) {
      const first = assigned.findIndex(g => g.some(room => room.key === a)), second = assigned.findIndex(g => g.some(room => room.key === b));
      if (first >= 0 && second > first + 1 && assigned[first]![0]!.level === assigned[second]![0]!.level) assigned.splice(first + 1, 0, assigned.splice(second, 1)[0]!);
    }
    const ordered = assigned.flat(), cuts = [0];
    for (const group of assigned) cuts.push(cuts.at(-1)! + group.length);
    const splits = r.floors === 2 ? [-1] : cuts.sort((a, b) => Math.abs(a - ordered.length / 2) - Math.abs(b - ordered.length / 2) || a - b);
    const axes: ('x' | 'z')[] = r.layoutV2.accessSide ? [r.layoutV2.accessSide.endsWith('z') ? 'z' : 'x'] : ['z', 'x'];
    // Interleave axes before less balanced cuts so narrow plots get both orientations.
    for (const split of splits) for (const axis of axes) yield { ordered, split, axis, round, leftSharePermille: [500, 250, 750][round % 3]!, stairPosition: (['center', 'front', 'rear'] as const)[round % 3]! };
  }
}
