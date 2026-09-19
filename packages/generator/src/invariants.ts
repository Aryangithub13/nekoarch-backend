import { PlanSchema, type Plan, type Rect, type Room, type WallSeg } from '@designflow/shared';
import { GenerationError } from './errors.js';
import { doorwayClearances, furnitureFootprint } from './furniture.js';
import {
  containsRect,
  deriveOpenings,
  nearlyEqual,
  rectanglesOverlap,
  type DoorOpening,
} from './geometry.js';
import type { NormalizedGenerationInput } from './input.js';

const EPSILON = 1e-7;
const MIN_DOOR_WIDTH = 0.9;
const MAX_DOOR_WIDTH = 1.4;

interface Line {
  horizontal: boolean;
  fixed: number;
  start: number;
  end: number;
}

function ensure(condition: boolean, message: string): asserts condition {
  if (!condition) throw new GenerationError('INVARIANT_FAILURE', message);
}

function line(segment: WallSeg): Line {
  const horizontal = nearlyEqual(segment.z0, segment.z1);
  return {
    horizontal,
    fixed: horizontal ? segment.z0 : segment.x0,
    start: Math.min(horizontal ? segment.x0 : segment.z0, horizontal ? segment.x1 : segment.z1),
    end: Math.max(horizontal ? segment.x0 : segment.z0, horizontal ? segment.x1 : segment.z1),
  };
}

function edges(rect: Rect): WallSeg[] {
  const right = rect.x + rect.w;
  const bottom = rect.z + rect.d;
  return [
    { x0: rect.x, z0: rect.z, x1: right, z1: rect.z },
    { x0: right, z0: rect.z, x1: right, z1: bottom },
    { x0: rect.x, z0: bottom, x1: right, z1: bottom },
    { x0: rect.x, z0: rect.z, x1: rect.x, z1: bottom },
  ];
}

function collinear(a: Line, b: Line): boolean {
  return a.horizontal === b.horizontal && nearlyEqual(a.fixed, b.fixed);
}

function lineOverlap(a: Line, b: Line): boolean {
  return collinear(a, b) && Math.min(a.end, b.end) - Math.max(a.start, b.start) > EPSILON;
}

function onEdge(segment: Line, rect: Rect): boolean {
  return edges(rect).some((edge) => {
    const candidate = line(edge);
    return collinear(segment, candidate)
      && segment.start >= candidate.start - EPSILON
      && segment.end <= candidate.end + EPSILON;
  });
}

function coveredByBoundaries(segment: Line, boundaries: readonly Line[]): boolean {
  const spans = boundaries
    .filter((boundary) => collinear(segment, boundary))
    .map((boundary) => ({ start: Math.max(segment.start, boundary.start), end: Math.min(segment.end, boundary.end) }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);
  let covered = segment.start;
  for (const span of spans) {
    if (span.start > covered + EPSILON) return false;
    covered = Math.max(covered, span.end);
  }
  return covered >= segment.end - EPSILON;
}

function pointInBounds(x: number, z: number, bounds: Rect): boolean {
  return x >= bounds.x - EPSILON && x <= bounds.x + bounds.w + EPSILON
    && z >= bounds.z - EPSILON && z <= bounds.z + bounds.d + EPSILON;
}

function checkRooms(plan: Plan): void {
  const ids = new Set<number>();
  let area = 0;
  for (const room of plan.rooms) {
    ensure(!ids.has(room.id), `Room ID ${room.id} is duplicated.`);
    ids.add(room.id);
    ensure(containsRect(plan.bounds, room.rect), `Room ${room.id} lies outside the footprint.`);
    area += room.rect.w * room.rect.d;
  }
  for (let i = 0; i < plan.rooms.length; i++) {
    for (let j = i + 1; j < plan.rooms.length; j++) {
      const a = plan.rooms[i]!;
      const b = plan.rooms[j]!;
      ensure(!rectanglesOverlap(a.rect, b.rect), `Rooms ${a.id} and ${b.id} overlap.`);
    }
  }
  const boundsArea = plan.bounds.w * plan.bounds.d;
  ensure(Number.isFinite(area) && Number.isFinite(boundsArea), 'Footprint area must be finite.');
  ensure(nearlyEqual(area, boundsArea), 'Rooms and circulation must cover the entire footprint.');
}

function checkWalls(plan: Plan): void {
  const boundaries = plan.rooms.flatMap((room) => edges(room.rect).map(line));
  const lines: Line[] = [];
  for (const wall of plan.walls) {
    const horizontal = nearlyEqual(wall.z0, wall.z1);
    const vertical = nearlyEqual(wall.x0, wall.x1);
    ensure(horizontal !== vertical, 'Walls must be nonzero, orthogonal segments.');
    ensure(pointInBounds(wall.x0, wall.z0, plan.bounds) && pointInBounds(wall.x1, wall.z1, plan.bounds),
      'Wall endpoints must remain within the footprint.');
    const segment = line(wall);
    ensure(coveredByBoundaries(segment, boundaries), 'Every wall must lie on actual room boundaries.');
    ensure(!lines.some((previous) => lineOverlap(segment, previous)), 'Wall segments must not overlap or be duplicated.');
    lines.push(segment);
  }
}

function checkOpenings(plan: Plan): DoorOpening[] {
  const openings = deriveOpenings(plan.rooms, plan.walls);
  const rooms = new Map(plan.rooms.map((room) => [room.id, room]));
  const graph = new Map(plan.rooms.map((room) => [room.id, new Set<number>()]));
  const entries = new Set<number>();
  const openingLines: Line[] = [];
  for (const opening of openings) {
    const segment = line(opening);
    const width = segment.end - segment.start;
    ensure(width >= MIN_DOOR_WIDTH - EPSILON && width <= MAX_DOOR_WIDTH + EPSILON,
      'Every uncovered boundary gap must be a doorway between 0.9 and 1.4 metres wide.');
    ensure(opening.roomIds.length === 1 || opening.roomIds.length === 2, 'Doorways must resolve to one or two rooms.');
    ensure(new Set(opening.roomIds).size === opening.roomIds.length, 'Doorway room references must be distinct.');
    for (const roomId of opening.roomIds) {
      const room = rooms.get(roomId);
      ensure(room !== undefined && onEdge(segment, room.rect), 'Doorway references must resolve to adjoining room edges.');
    }
    ensure(!openingLines.some((previous) => lineOverlap(segment, previous)), 'Doorway gaps must not overlap or be duplicated.');
    ensure(!plan.walls.some((wall) => lineOverlap(segment, line(wall))), 'Doorways cannot be blocked by walls.');
    openingLines.push(segment);
    const first = opening.roomIds[0]!;
    if (opening.roomIds.length === 1) {
      ensure(onEdge(segment, plan.bounds), 'An exterior doorway must lie on the footprint boundary.');
      entries.add(first);
    } else {
      const second = opening.roomIds[1]!;
      graph.get(first)!.add(second);
      graph.get(second)!.add(first);
    }
  }
  ensure(entries.size > 0, 'The plan must have an exterior entrance.');
  // One connected interior is required; separate exterior entrances cannot hide
  // disconnected groups of rooms.
  const queue = [entries.values().next().value!];
  const visited = new Set(queue);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const next of graph.get(queue[cursor]!)!) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  ensure(visited.size === plan.rooms.length, 'Every room must connect to the entrance through actual doorways.');
  return openings;
}

function checkRequirements(plan: Plan, input: NormalizedGenerationInput, openings: readonly DoorOpening[]): void {
  ensure(plan.prompt === input.prompt, 'The generated prompt must match the normalized input.');
  for (const key of ['x', 'z', 'w', 'd'] as const) {
    ensure(nearlyEqual(plan.bounds[key], input.bounds[key]), 'The generated footprint must match the normalized input.');
  }
  const expected = new Map(input.rooms.map((room) => [room.type, room.count]));
  const actual = new Map<string, number>();
  for (const room of plan.rooms) {
    if (room.type !== 'circulation') actual.set(room.type, (actual.get(room.type) ?? 0) + 1);
  }
  ensure(actual.size === expected.size, 'The generated room types must match the request.');
  for (const [type, count] of expected) {
    ensure(actual.get(type) === count, `The requested number of ${type} rooms must be present.`);
  }
  const rooms = new Map(plan.rooms.map((room) => [room.id, room]));
  for (const adjacency of input.adjacency ?? []) {
    ensure(openings.some((opening) => {
      if (opening.roomIds.length !== 2) return false;
      const first = rooms.get(opening.roomIds[0]!)!.type;
      const second = rooms.get(opening.roomIds[1]!)!.type;
      return (first === adjacency.from && second === adjacency.to)
        || (first === adjacency.to && second === adjacency.from);
    }), `The requested ${adjacency.from}/${adjacency.to} adjacency must have a direct doorway.`);
  }
}

function checkFurniture(plan: Plan, openings: readonly DoorOpening[]): void {
  const placed: Rect[] = [];
  for (const item of plan.furn) {
    ensure([0, Math.PI / 2, Math.PI, 3 * Math.PI / 2].some((rotation) => nearlyEqual(item.rot, rotation)),
      'Furniture orientation must be a canonical quarter turn.');
    const footprint = furnitureFootprint(item);
    const owners = plan.rooms.filter((room) => containsRect(room.rect, footprint));
    ensure(owners.length === 1 && owners[0]!.type !== 'circulation',
      'Furniture must belong wholly to exactly one non-circulation room.');
    const owner: Room = owners[0]!;
    ensure(!placed.some((previous) => rectanglesOverlap(previous, footprint)), 'Furniture footprints must not overlap.');
    ensure(!doorwayClearances(owner, openings).some((clearance) => rectanglesOverlap(clearance, footprint)),
      'Furniture must leave doorway clearances unobstructed.');
    placed.push(footprint);
  }
}

function validatedPlan(value: unknown): Plan {
  let parsed: ReturnType<typeof PlanSchema.safeParse>;
  let hasVariant = false;
  try {
    parsed = PlanSchema.safeParse(value);
    hasVariant = typeof value === 'object' && value !== null && 'variant' in value;
  } catch {
    // A public unknown input can contain getters or proxies which throw during
    // schema traversal. Neither their raw exception nor its message is public.
    throw new GenerationError('INVARIANT_FAILURE', 'Unable to validate generated output against the canonical Plan schema.');
  }
  ensure(parsed.success, 'Generated output does not match the canonical Plan schema.');
  // Unlike parsing input, assertion cannot materialize the schema's default on
  // the caller's object. A complete generated Plan must include its variant.
  ensure(hasVariant, 'Generated output must explicitly include its variant.');
  return parsed.data;
}

/** Validate canonical shape and the geometry that its intentionally small schema cannot express. */
export function assertPlanInvariants(value: unknown, input?: NormalizedGenerationInput): asserts value is Plan {
  const plan = validatedPlan(value);
  ensure(Number.isFinite(plan.bounds.x + plan.bounds.w) && Number.isFinite(plan.bounds.z + plan.bounds.d),
    'Footprint corner coordinates must be finite.');
  checkRooms(plan);
  checkWalls(plan);
  const openings = checkOpenings(plan);
  if (input) checkRequirements(plan, input, openings);
  checkFurniture(plan, openings);
  ensure(plan.qa.orthogonal === 1, 'Generated geometry must have a fully orthogonal QA result.');
  ensure(plan.qa.walls === plan.walls.length, 'The QA wall count must match the generated walls.');
  ensure(plan.qa.pieces === plan.furn.length, 'The QA furniture count must match the generated furniture.');
}
