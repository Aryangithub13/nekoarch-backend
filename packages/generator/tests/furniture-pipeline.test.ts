import { describe, expect, it } from 'vitest';
import { PlanSchema, type FurnItem, type FurnKind, type Plan, type Rect, type Room } from '@designflow/shared';
import { generatePlan, parseRequirements } from '../src/index.js';
import { FURNITURE_DIMENSIONS } from '../src/furniture.js';
import { deriveOpenings } from '../src/geometry.js';
import type { NormalizedGenerationInput } from '../src/input.js';

const EPSILON = 1e-6;
const primaryByType: Readonly<Record<string, FurnKind>> = {
  bedroom: 'bed', living: 'sofa', kitchen: 'counter', dining: 'table', study: 'desk',
};

// Independent arithmetic checks the actual public output, without delegating the
// assertions to the generator's invariant or furniture-placement implementation.
function footprint(item: FurnItem): Rect {
  const size = FURNITURE_DIMENSIONS[item.kind];
  const quarterTurns = item.rot / (Math.PI / 2);
  expect(quarterTurns).toBeCloseTo(Math.round(quarterTurns), 8);
  const swapped = Math.abs(Math.round(quarterTurns) % 2) === 1;
  const w = swapped ? size.d : size.w;
  const d = swapped ? size.w : size.d;
  return { x: item.x - w / 2, z: item.z - d / 2, w, d };
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x - EPSILON && inner.z >= outer.z - EPSILON
    && inner.x + inner.w <= outer.x + outer.w + EPSILON
    && inner.z + inner.d <= outer.z + outer.d + EPSILON;
}

function overlaps(a: Rect, b: Rect): boolean {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > EPSILON
    && Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z) > EPSILON;
}

function relative(primary: FurnItem, other: FurnItem): { lateral: number; forward: number } {
  const dx = other.x - primary.x;
  const dz = other.z - primary.z;
  return {
    lateral: dx * Math.cos(primary.rot) - dz * Math.sin(primary.rot),
    forward: dx * Math.sin(primary.rot) + dz * Math.cos(primary.rot),
  };
}

function checkFurniture(plan: Plan): void {
  expect(PlanSchema.safeParse(plan).success).toBe(true);
  const members = new Map<number, FurnItem[]>(plan.rooms.map((room) => [room.id, []]));
  const placed = plan.furn.map((item) => ({ item, rect: footprint(item) }));
  for (const { item, rect } of placed) {
    const owners = plan.rooms.filter((room) => contains(room.rect, rect));
    expect(owners).toHaveLength(1);
    const owner = owners[0]!;
    expect(owner.type).not.toBe('circulation');
    expect(owner.type).not.toBe('bathroom');
    members.get(owner.id)!.push(item);
    expect(rect.x - owner.rect.x).toBeGreaterThanOrEqual(0.05 - EPSILON);
    expect(rect.z - owner.rect.z).toBeGreaterThanOrEqual(0.05 - EPSILON);
    expect(owner.rect.x + owner.rect.w - rect.x - rect.w).toBeGreaterThanOrEqual(0.05 - EPSILON);
    expect(owner.rect.z + owner.rect.d - rect.z - rect.d).toBeGreaterThanOrEqual(0.05 - EPSILON);
    for (const wall of plan.walls) {
      if (Math.abs(wall.z1 - wall.z0) < EPSILON) {
        const throughInterior = wall.z0 > rect.z + EPSILON && wall.z0 < rect.z + rect.d - EPSILON;
        const alongInterior = Math.min(Math.max(wall.x0, wall.x1), rect.x + rect.w)
          - Math.max(Math.min(wall.x0, wall.x1), rect.x) > EPSILON;
        expect(throughInterior && alongInterior).toBe(false);
      } else {
        const throughInterior = wall.x0 > rect.x + EPSILON && wall.x0 < rect.x + rect.w - EPSILON;
        const alongInterior = Math.min(Math.max(wall.z0, wall.z1), rect.z + rect.d)
          - Math.max(Math.min(wall.z0, wall.z1), rect.z) > EPSILON;
        expect(throughInterior && alongInterior).toBe(false);
      }
    }
  }
  for (let i = 0; i < placed.length; i++) {
    for (const other of placed.slice(i + 1)) expect(overlaps(placed[i]!.rect, other.rect)).toBe(false);
  }
  for (const room of plan.rooms) checkRelations(room, members.get(room.id)!);

  for (const door of deriveOpenings(plan.rooms, plan.walls)) {
    for (const roomId of door.roomIds) {
      const room = plan.rooms.find((candidate) => candidate.id === roomId)!;
      const horizontal = Math.abs(door.z0 - door.z1) < EPSILON;
      const depth = horizontal ? Math.min(1, room.rect.d) : Math.min(1, room.rect.w);
      const clearance: Rect = horizontal
        ? {
            x: Math.min(door.x0, door.x1),
            z: Math.abs(door.z0 - room.rect.z) < EPSILON ? room.rect.z : room.rect.z + room.rect.d - depth,
            w: Math.abs(door.x1 - door.x0), d: depth,
          }
        : {
            x: Math.abs(door.x0 - room.rect.x) < EPSILON ? room.rect.x : room.rect.x + room.rect.w - depth,
            z: Math.min(door.z0, door.z1), w: depth, d: Math.abs(door.z1 - door.z0),
          };
      for (const item of members.get(roomId)!) expect(overlaps(footprint(item), clearance)).toBe(false);
    }
  }
}

function checkRelations(room: Room, items: FurnItem[]): void {
  const kind = primaryByType[room.type];
  if (kind === undefined) {
    expect(items).toEqual([]);
    return;
  }
  const primaries = items.filter((item) => item.kind === kind);
  expect(primaries).toHaveLength(1);
  const primary = primaries[0]!;
  if (kind !== 'table') {
    const rect = footprint(primary);
    const margins = [rect.x - room.rect.x, rect.z - room.rect.z,
      room.rect.x + room.rect.w - rect.x - rect.w, room.rect.z + room.rect.d - rect.z - rect.d];
    expect(margins.some((distance) => Math.abs(distance - 0.05) < EPSILON)).toBe(true);
  }
  if (kind === 'bed') {
    const stands = items.filter((item) => item.kind === 'nightstand');
    expect(stands.length).toBeLessThanOrEqual(2);
    for (const stand of stands) {
      expect(stand.rot).toBe(primary.rot);
      expect(relative(primary, stand).forward)
        .toBeCloseTo((FURNITURE_DIMENSIONS.nightstand.d - FURNITURE_DIMENSIONS.bed.d) / 2, 6);
    }
    if (stands.length === 2) {
      expect(relative(primary, stands[0]!).lateral * relative(primary, stands[1]!).lateral).toBeLessThan(0);
    }
  }
  if (kind === 'sofa') {
    for (const tv of items.filter((item) => item.kind === 'tv')) {
      expect(relative(primary, tv).lateral).toBeCloseTo(0, 6);
      expect(relative(primary, tv).forward).toBeGreaterThan(0);
      expect(Math.abs(primary.rot - tv.rot)).toBeCloseTo(Math.PI, 6);
    }
  }
  if (kind === 'desk') {
    for (const chair of items.filter((item) => item.kind === 'chair')) {
      expect(relative(primary, chair).lateral).toBeCloseTo(0, 6);
      expect(relative(primary, chair).forward).toBeGreaterThan(0);
      expect(Math.abs(primary.rot - chair.rot)).toBeCloseTo(Math.PI, 6);
    }
  }
}

const allTypes = ['bedroom', 'bathroom', 'living', 'kitchen', 'dining', 'study'] as const;
const fixtures: { name: string; bounds: Rect; rooms: NormalizedGenerationInput['rooms'] }[] = [
  { name: 'minimum bedroom', bounds: { x: 0, z: 0, w: 3, d: 3 }, rooms: [{ type: 'bedroom', count: 1 }] },
  { name: 'narrow vertical through-room chain', bounds: { x: 0, z: 0, w: 3, d: 60 },
    rooms: allTypes.map((type) => ({ type, count: 1 })) },
  { name: 'narrow horizontal through-room chain', bounds: { x: -1000, z: 1000, w: 60, d: 3 },
    rooms: allTypes.map((type) => ({ type, count: 1 })) },
  { name: 'minimum balanced banks', bounds: { x: 0, z: 0, w: 7.6, d: 9.6 },
    rooms: allTypes.map((type) => ({ type, count: 1 })) },
  { name: 'transposed balanced banks', bounds: { x: 0, z: 0, w: 9.6, d: 7.6 },
    rooms: allTypes.map((type) => ({ type, count: 1 })) },
  { name: 'decimal dimensions and origin', bounds: { x: 983.987654, z: -1000, w: 12.345678, d: 17.987654 },
    rooms: allTypes.map((type) => ({ type, count: 1 })) },
  { name: 'maximum footprint and room count', bounds: { x: -1000, z: 1000, w: 60, d: 60 },
    rooms: allTypes.map((type) => ({ type, count: 4 })) },
];

describe('furniture through the public generation pipeline', () => {
  it.each(fixtures)('preserves furnishing and geometry invariants across seeds: $name', ({ bounds, rooms }) => {
    const input = { prompt: 'Pipeline furniture audit', bounds, rooms };
    const original = structuredClone(input);
    for (let seed = 0; seed < 12; seed++) {
      const options = { seed: `furniture-audit-${seed}`, variant: seed + 1 };
      const plan = generatePlan(input, options);
      checkFurniture(plan);
      expect(generatePlan(input, options)).toEqual(plan);
    }
    expect(input).toEqual(original);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('furnishes normalized %s BHK prompts with required open-kitchen adjacency', (bedrooms) => {
    const input = parseRequirements(`${bedrooms} BHK with open kitchen`);
    for (let seed = 0; seed < 15; seed++) {
      const plan = generatePlan(input, { seed: `audit-${seed}` });
      expect(plan.rooms.filter((room) => room.type === 'bedroom')).toHaveLength(bedrooms);
      checkFurniture(plan);
    }
  });
});
