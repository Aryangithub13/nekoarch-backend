import type { Room, Rect } from '@designflow/shared';
import { GenerationError } from './errors.js';
import type { NormalizedGenerationInput } from './input.js';
import { roundCoordinate as rounded, segmentLength, sharedBoundary, type DoorOpening } from './geometry.js';
import { seededRandom, shuffled } from './random.js';

/** Operational sizing defaults for the MVP, not building-code compliance. */
export const LAYOUT_LIMITS = Object.freeze({ corridorWidth: 1.2, roomSpan: 3.2, doorwayWidth: 0.9, maximumAttempts: 12 });
type RoomIdentity = Omit<Room, 'rect'>;
export type Layout = { rooms: Room[]; openings: DoorOpening[] };
type Mode = 'two-banks' | 'one-bank' | 'linear';

function impossible(message: string): never { throw new GenerationError('IMPOSSIBLE_LAYOUT', message); }

function identities(input: NormalizedGenerationInput): RoomIdentity[] {
  const labels: Record<string, string> = { bedroom: 'Bedroom', bathroom: 'Bathroom', living: 'Living room', kitchen: 'Kitchen', dining: 'Dining room', study: 'Study' };
  return input.rooms.flatMap(group => Array.from({ length: group.count }, (_, i) => ({
    id: 0, type: group.type, name: `${labels[group.type]}${group.count > 1 ? ` ${i + 1}` : ''}`,
  }))).map((room, i) => ({ ...room, id: i + 1 }));
}

/** A required type adjacency means at least one directly connected pair.
 * Connected requirements form contiguous chains; cycles/branches need a solver
 * beyond this bounded strip-layout family and fail explicitly.
 */
function roomChains(input: NormalizedGenerationInput, rooms: RoomIdentity[], random: () => number): RoomIdentity[][] {
  const neighbors = new Map(rooms.map(room => [room.id, new Set<number>()]));
  for (const preference of input.adjacency ?? []) {
    const from = rooms.find(room => room.type === preference.from);
    const to = rooms.find(room => room.type === preference.to);
    if (!from || !to || from.id === to.id) impossible('An adjacency must connect two requested room types');
    neighbors.get(from.id)!.add(to.id); neighbors.get(to.id)!.add(from.id);
  }
  if ([...neighbors.values()].some(links => links.size > 2)) impossible('Branching adjacency requirements are not supported by the strip-layout generator');
  const visited = new Set<number>();
  const chains: RoomIdentity[][] = [];
  const ordered = [...rooms].sort((a, b) => neighbors.get(a.id)!.size - neighbors.get(b.id)!.size || a.id - b.id);
  for (const first of ordered) {
    if (visited.has(first.id)) continue;
    if (neighbors.get(first.id)!.size === 2) impossible('Cyclic adjacency requirements are not supported by the strip-layout generator');
    const chain: RoomIdentity[] = [];
    let id: number | undefined = first.id;
    while (id !== undefined) {
      if (visited.has(id)) impossible('Adjacency requirements contain a cycle');
      visited.add(id); chain.push(rooms.find(room => room.id === id)!);
      id = [...neighbors.get(id)!].find(next => !visited.has(next));
    }
    chains.push(random() < 0.5 ? chain.reverse() : chain);
  }
  return shuffled(chains, random);
}

function doorway(edge: DoorOpening, roomIds: number[], far: boolean, width: number = LAYOUT_LIMITS.doorwayWidth): DoorOpening {
  if (segmentLength(edge) < width + 0.3 - 1e-7) impossible('A room boundary cannot accommodate the required opening');
  const vertical = edge.x0 === edge.x1;
  const low = vertical ? edge.z0 : edge.x0; const high = vertical ? edge.z1 : edge.x1;
  const start = rounded(far ? high - 0.15 - width : low + 0.15);
  return vertical ? { ...edge, roomIds, z0: start, z1: rounded(start + width) }
    : { ...edge, roomIds, x0: start, x1: rounded(start + width) };
}

function buildLayout(input: NormalizedGenerationInput, seed: string, horizontal: boolean, mode: Mode, far: boolean): Layout {
  const random = seededRandom(`${seed}:${horizontal}:${mode}`);
  const nodes = identities(input);
  const chains = roomChains(input, nodes, random);
  const cross = horizontal ? input.bounds.d : input.bounds.w;
  const run = horizontal ? input.bounds.w : input.bounds.d;
  const toWorld = (rect: Rect): Rect => horizontal
    ? { x: rounded(input.bounds.x + rect.z), z: rounded(input.bounds.z + rect.x), w: rect.d, d: rect.w }
    : { x: rounded(input.bounds.x + rect.x), z: rounded(input.bounds.z + rect.z), w: rect.w, d: rect.d };
  const rooms: Room[] = [];
  const corridor = LAYOUT_LIMITS.corridorWidth;
  function bank(members: RoomIdentity[], x: number, width: number) {
    if (members.length === 0 || width < LAYOUT_LIMITS.roomSpan - 1e-7 || run / members.length < LAYOUT_LIMITS.roomSpan - 1e-7) {
      impossible('The footprint is too small for the requested room configuration');
    }
    members.forEach((room, i) => {
      const start = rounded(run * i / members.length); const end = rounded(run * (i + 1) / members.length);
      rooms.push({ ...room, rect: toWorld({ x, z: start, w: width, d: rounded(end - start) }) });
    });
  }
  let entryRoom: Room;
  let hall: Room | undefined;
  if (nodes.length === 1) {
    entryRoom = { ...nodes[0]!, rect: { ...input.bounds } }; rooms.push(entryRoom);
  } else if (mode === 'linear') {
    // Narrow footprints have no separate hall: a connected room chain uses the
    // entire width. Through-room circulation is reported as an MVP limitation.
    const members = chains.flat();
    if (cross < 3 || run / members.length < LAYOUT_LIMITS.roomSpan - 1e-7) impossible('The narrow footprint cannot accommodate all requested rooms');
    members.forEach((room, i) => {
      const start = rounded(run * i / members.length); const end = rounded(run * (i + 1) / members.length);
      rooms.push({ ...room, rect: toWorld({ x: 0, z: start, w: cross, d: rounded(end - start) }) });
    });
    entryRoom = rooms[0]!;
  } else {
    let hallX = 0;
    if (mode === 'two-banks') {
      const left: RoomIdentity[] = []; const right: RoomIdentity[] = [];
      // A late adjacency chain must not unbalance an otherwise fitting layout.
      // At most 24 room counts are reachable: bounded subset-sum preserves whole
      // chains and finds the most even split without exponential enumeration.
      const reachable = new Map<number, number[]>([[0, []]]);
      chains.forEach((chain, index) => {
        for (const [count, indices] of [...reachable]) {
          const next = count + chain.length;
          if (!reachable.has(next)) reachable.set(next, [...indices, index]);
        }
      });
      let target = Math.floor(nodes.length / 2);
      while (target > 0 && !reachable.has(target)) target--;
      const selected = new Set(reachable.get(target)!);
      chains.forEach((chain, index) => (selected.has(index) ? left : right).push(...chain));
      const width = rounded((cross - corridor) / 2);
      bank(left, 0, width); bank(right, rounded(width + corridor), rounded(cross - width - corridor));
      hallX = width;
    } else {
      bank(chains.flat(), corridor, rounded(cross - corridor));
    }
    hall = { id: nodes.length + 1, name: 'Circulation', type: 'circulation', rect: toWorld({ x: hallX, z: 0, w: corridor, d: run }) };
    rooms.push(hall); entryRoom = hall;
  }

  const entryEdge: DoorOpening = horizontal
    ? { x0: input.bounds.x, x1: input.bounds.x, z0: entryRoom.rect.z, z1: rounded(entryRoom.rect.z + entryRoom.rect.d), roomIds: [entryRoom.id] }
    : { x0: entryRoom.rect.x, x1: rounded(entryRoom.rect.x + entryRoom.rect.w), z0: input.bounds.z, z1: input.bounds.z, roomIds: [entryRoom.id] };
  const openings = [doorway(entryEdge, [entryRoom.id], far)];
  const connected = new Set<string>();
  function connect(a: Room, b: Room, width: number = LAYOUT_LIMITS.doorwayWidth) {
    const key = [a.id, b.id].sort((x, y) => x - y).join(':');
    if (connected.has(key)) return;
    const boundary = sharedBoundary(a.rect, b.rect);
    if (!boundary) impossible('The required adjacent rooms do not share an edge in this layout');
    openings.push(doorway(boundary, [a.id, b.id].sort((x, y) => x - y), far, width)); connected.add(key);
  }
  if (hall) for (const room of rooms) { if (room.id !== hall.id) connect(room, hall); }
  else for (let i = 1; i < rooms.length; i++) connect(rooms[i - 1]!, rooms[i]!);
  for (const adjacency of input.adjacency ?? []) {
    const from = rooms.find(room => room.type === adjacency.from)!;
    const to = rooms.find(room => room.type === adjacency.to)!;
    connect(from, to, 1.2);
  }
  return { rooms: rooms.sort((a, b) => a.id - b.id), openings };
}

/** Exactly twelve bounded candidates; no recursive search or unbounded retries. */
export function* layoutCandidates(input: NormalizedGenerationInput, seed: string): Generator<Layout> {
  const preferredHorizontal = input.bounds.w > input.bounds.d;
  for (const horizontal of [preferredHorizontal, !preferredHorizontal]) {
    for (const mode of ['two-banks', 'one-bank', 'linear'] as const) {
      for (const far of [false, true]) {
        try { yield buildLayout(input, seed, horizontal, mode, far); }
        catch (error) {
          if (!(error instanceof GenerationError) || error.code !== 'IMPOSSIBLE_LAYOUT') throw error;
        }
      }
    }
  }
}
