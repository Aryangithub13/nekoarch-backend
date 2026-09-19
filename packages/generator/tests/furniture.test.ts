import { describe, expect, it } from 'vitest';
import { FurnKindSchema, type FurnItem, type Rect, type Room } from '@designflow/shared';
import { GenerationError } from '../src/errors.js';
import {
  doorwayClearances,
  FURNITURE_DIMENSIONS,
  furnitureFootprint,
  placeFurniture,
} from '../src/furniture.js';
import { containsRect, rectanglesOverlap, type DoorOpening } from '../src/geometry.js';

const room = (type: string, w = 4, d = 4, id = 0, x = 0, z = 0): Room => ({
  id, name: type, type, rect: { x, z, w, d },
});
const northDoor = (id = 0): DoorOpening => ({ roomIds: [id], x0: 1.55, z0: 0, x1: 2.45, z1: 0 });

function expectClear(items: FurnItem[], target: Room, doors: DoorOpening[]): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const footprint = furnitureFootprint(item);
    expect(containsRect(target.rect, footprint, 1e-8)).toBe(true);
    for (const clearance of doorwayClearances(target, doors)) {
      expect(rectanglesOverlap(footprint, clearance, 1e-8)).toBe(false);
    }
    for (const other of items.slice(i + 1)) {
      expect(rectanglesOverlap(footprint, furnitureFootprint(other), 1e-8)).toBe(false);
    }
  }
}

describe('furniture footprints', () => {
  it('defines a finite positive footprint for every canonical furniture kind', () => {
    expect(Object.keys(FURNITURE_DIMENSIONS).sort()).toEqual([...FurnKindSchema.options].sort());
    for (const kind of FurnKindSchema.options) {
      const size = FURNITURE_DIMENSIONS[kind];
      expect(Number.isFinite(size.w) && size.w > 0).toBe(true);
      expect(Number.isFinite(size.d) && size.d > 0).toBe(true);
    }
    expect(Object.isFrozen(FURNITURE_DIMENSIONS)).toBe(true);
    expect(Object.isFrozen(FURNITURE_DIMENSIONS.bed)).toBe(true);
  });

  it.each([0, Math.PI / 2, Math.PI, Math.PI * 1.5, -Math.PI / 2])('treats positions as centres at rotation %s', (rot) => {
    const item: FurnItem = { kind: 'bed', x: 3, z: 5, rot };
    const result = furnitureFootprint(item);
    const rotated = Math.abs(Math.round(rot / (Math.PI / 2)) % 2) === 1;
    expect(result.w).toBe(rotated ? 2 : 1.5);
    expect(result.d).toBe(rotated ? 1.5 : 2);
    expect(result.x + result.w / 2).toBe(3);
    expect(result.z + result.d / 2).toBe(5);
  });

  it.each([NaN, Infinity, Math.PI / 4])('rejects invalid orientation %s intentionally', (rot) => {
    expect(() => furnitureFootprint({ kind: 'bed', x: 0, z: 0, rot })).toThrow(GenerationError);
  });
});

describe('doorway furniture clearances', () => {
  it('sweeps each wall opening one metre inward, including reversed endpoints', () => {
    const target = room('living', 4, 5, 3, 10, 20);
    const doors: DoorOpening[] = [
      { roomIds: [3], x0: 11, z0: 20, x1: 12, z1: 20 },
      { roomIds: [3], x0: 12, z0: 25, x1: 11, z1: 25 },
      { roomIds: [3, 4], x0: 10, z0: 21, x1: 10, z1: 22 },
      { roomIds: [4, 3], x0: 14, z0: 22, x1: 14, z1: 21 },
      { roomIds: [4], x0: 10, z0: 23, x1: 10, z1: 24 },
    ];
    expect(doorwayClearances(target, doors)).toEqual([
      { x: 11, z: 20, w: 1, d: 1 },
      { x: 11, z: 24, w: 1, d: 1 },
      { x: 10, z: 21, w: 1, d: 1 },
      { x: 13, z: 21, w: 1, d: 1 },
    ]);
  });

  it('keeps a clearance inside unusually shallow rooms', () => {
    const target = room('circulation', 2, 0.8);
    const clearances = doorwayClearances(target, [{ roomIds: [0], x0: 0.2, z0: 0, x1: 1.2, z1: 0 }]);
    expect(clearances).toEqual([{ x: 0.2, z: 0, w: 1, d: 0.8 }]);
    expect(containsRect(target.rect, clearances[0]!)).toBe(true);
  });
});

describe('deterministic relational furniture placement', () => {
  it.each([
    ['bedroom', 'bed'], ['living', 'sofa'], ['kitchen', 'counter'],
    ['dining', 'table'], ['study', 'desk'],
  ])('places required furniture in %s without collisions or obstructing doors', (type, primary) => {
    const target = room(type!);
    const doors = [northDoor()];
    const items = placeFurniture([target], doors);
    expect(items.some((item) => item.kind === primary)).toBe(true);
    expectClear(items, target, doors);
    expect(placeFurniture([target], doors)).toEqual(items);
  });

  it('anchors a bed at a wall with nightstands on both sides of its head', () => {
    const items = placeFurniture([room('bedroom')], [northDoor()]);
    const bed = items.find((item) => item.kind === 'bed')!;
    const nightstands = items.filter((item) => item.kind === 'nightstand');
    expect(nightstands).toHaveLength(2);
    const cos = Math.round(Math.cos(bed.rot));
    const sin = Math.round(Math.sin(bed.rot));
    const lateral = nightstands.map((item) => (item.x - bed.x) * cos - (item.z - bed.z) * sin).sort((a, b) => a - b);
    expect(lateral[0]).toBeCloseTo(-lateral[1]!);
    expect(lateral[0]).toBeLessThan(0);
    const footprint = furnitureFootprint(bed);
    expect([footprint.x, footprint.z, 4 - footprint.x - footprint.w, 4 - footprint.z - footprint.d]
      .some((distance) => Math.abs(distance - 0.05) < 1e-8)).toBe(true);
  });

  it('aligns a television opposite the sofa with facing orientations', () => {
    const items = placeFurniture([room('living')], [northDoor()]);
    const sofa = items.find((item) => item.kind === 'sofa')!;
    const tv = items.find((item) => item.kind === 'tv')!;
    expect(Math.abs(tv.rot - sofa.rot)).toBeCloseTo(Math.PI);
    if (sofa.rot === 0 || sofa.rot === Math.PI) {
      expect(tv.x).toBeCloseTo(sofa.x);
      expect(Math.abs(tv.z - sofa.z)).toBeGreaterThan(2);
    } else {
      expect(tv.z).toBeCloseTo(sofa.z);
      expect(Math.abs(tv.x - sofa.x)).toBeGreaterThan(2);
    }
  });

  it('places a centred dining table with four separated chairs when space permits', () => {
    const items = placeFurniture([room('dining', 5, 5)], []);
    expect(items.filter((item) => item.kind === 'chair')).toHaveLength(4);
    expect(items.find((item) => item.kind === 'table')).toEqual({ kind: 'table', x: 2.5, z: 2.5, rot: 0 });
    expectClear(items, room('dining', 5, 5), []);
  });

  it('places a study chair facing its desk', () => {
    const items = placeFurniture([room('study')], []);
    const desk = items.find((item) => item.kind === 'desk')!;
    const chair = items.find((item) => item.kind === 'chair')!;
    expect(Math.abs(chair.rot - desk.rot)).toBeCloseTo(Math.PI);
    expect(chair.x).toBe(desk.x);
    expect(chair.z).toBeGreaterThan(desk.z);
  });

  it('omits companions when only the required primary fits', () => {
    const target = room('bedroom', 1.6, 2.1);
    const items = placeFurniture([target], []);
    expect(items.map((item) => item.kind)).toEqual(['bed']);
    expectClear(items, target, []);
  });

  it('rotates a bed when the only feasible room orientation requires it', () => {
    const target = room('bedroom', 2.1, 1.6);
    const items = placeFurniture([target], []);
    expect(items[0]!.rot).toBe(Math.PI / 2);
    expectClear(items, target, []);
  });

  it('fails intentionally when a required primary cannot fit', () => {
    expect(() => placeFurniture([room('bedroom', 1.59, 2.09)], []))
      .toThrow(expect.objectContaining({ code: 'IMPOSSIBLE_LAYOUT' }));
  });

  it('fails intentionally when doorway clearance consumes the only usable furniture space', () => {
    const target = room('bedroom', 1.6, 2.1);
    expect(() => placeFurniture([target], [{ roomIds: [0], x0: 0.35, z0: 0, x1: 1.25, z1: 0 }]))
      .toThrow(expect.objectContaining({ code: 'IMPOSSIBLE_LAYOUT' }));
  });

  it('does not invent bathroom fixtures or obstruct circulation with furniture', () => {
    expect(placeFurniture([room('bathroom'), room('circulation', 4, 4, 1, 4)], [])).toEqual([]);
  });

  it('leaves unfamiliar canonical room types unfurnished, including inherited property names', () => {
    for (const type of ['garage', '__proto__', 'constructor', 'toString']) {
      expect(placeFurniture([room(type)], [])).toEqual([]);
    }
  });

  it('preserves unique room association through containment at shifted coordinates', () => {
    const rooms = [room('bedroom', 4, 4, 5, -12, 20), room('living', 4, 4, 8, -8, 20)];
    const originals = structuredClone(rooms);
    const items = placeFurniture(rooms, []);
    for (const item of items) {
      const footprint: Rect = furnitureFootprint(item);
      expect(rooms.filter((target) => containsRect(target.rect, footprint, 1e-8))).toHaveLength(1);
      expect(item).not.toHaveProperty('roomId');
    }
    expect(rooms).toEqual(originals);
  });

  it.each(['bedroom', 'living', 'kitchen', 'dining', 'study'])('handles minimum generator room sizes for %s', (type) => {
    for (const [w, d] of [[3.2, 3.2], [3, 2.4], [3.2, 5], [12, 3.2]]) {
      const target = room(type, w, d);
      const doors: DoorOpening[] = [{ roomIds: [0], x0: 0.1, z0: 0, x1: 1, z1: 0 }];
      const items = placeFurniture([target], doors);
      expect(items.length).toBeGreaterThan(0);
      expectClear(items, target, doors);
    }
  });
});
