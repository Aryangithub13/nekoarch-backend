import { describe, expect, it } from 'vitest';
import type { Room } from '@designflow/shared';
import { coveredIntervals, deriveOpenings, roomBoundaries, sharedBoundary, wallsWithOpenings } from '../src/geometry.js';

const rooms: Room[] = [
  { id: 1, type: 'living', name: 'Living', rect: { x: 0, z: 0, w: 4, d: 8 } },
  { id: 2, type: 'bedroom', name: 'Bedroom', rect: { x: 4, z: 0, w: 4, d: 4 } },
  { id: 3, type: 'kitchen', name: 'Kitchen', rect: { x: 4, z: 4, w: 4, d: 4 } },
];

describe('wall and gap geometry', () => {
  it('splits a T-junction into shared spans with the correct room associations', () => {
    const shared = roomBoundaries(rooms).filter(edge => edge.x0 === 4 && edge.x1 === 4);
    expect(shared).toEqual([
      { x0: 4, x1: 4, z0: 0, z1: 4, roomIds: [1, 2] },
      { x0: 4, x1: 4, z0: 4, z1: 8, roomIds: [1, 3] },
    ]);
  });
  it('round-trips explicit internal and external openings through canonical wall segments', () => {
    const openings = [
      { x0: 0.15, x1: 1.05, z0: 0, z1: 0, roomIds: [1] },
      { x0: 4, x1: 4, z0: 0.15, z1: 1.05, roomIds: [1, 2] },
      { x0: 4, x1: 4, z0: 4.15, z1: 5.05, roomIds: [1, 3] },
    ];
    expect(deriveOpenings(rooms, wallsWithOpenings(rooms, openings))).toEqual(openings);
    expect(deriveOpenings(rooms, wallsWithOpenings(rooms, []))).toEqual([]);
  });
  it('merges overlapping/reversed occupied intervals before calculating uncovered gaps', () => {
    expect(coveredIntervals({ x0: 0, x1: 8, z0: 0, z1: 0 }, [
      { x0: 4, x1: 0, z0: 0, z1: 0 }, { x0: 3, x1: 6, z0: 0, z1: 0 },
      { x0: 7, x1: 9, z0: 0, z1: 0 }, { x0: 6, x1: 7, z0: 1, z1: 1 },
    ])).toEqual([[0, 6], [7, 8]]);
  });
  it('distinguishes a shared edge from point-only contact or disjoint rectangles', () => {
    expect(sharedBoundary({ x: 0, z: 0, w: 4, d: 4 }, { x: 4, z: 4, w: 4, d: 4 })).toBeNull();
    expect(sharedBoundary({ x: 0, z: 0, w: 4, d: 4 }, { x: 5, z: 0, w: 4, d: 4 })).toBeNull();
    expect(sharedBoundary(rooms[0]!.rect, rooms[1]!.rect)).toMatchObject({ x0: 4, x1: 4, z0: 0, z1: 4 });
  });
});
