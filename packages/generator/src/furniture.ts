import type { FurnItem, FurnKind, Rect, Room } from '@designflow/shared';
import { GenerationError } from './errors.js';
import { containsRect, rectanglesOverlap, type DoorOpening } from './geometry.js';

const EPSILON = 1e-8;
const WALL_MARGIN = 0.05;
const COMPANION_GAP = 0.12;
const HALF_TURN = Math.PI;
const QUARTER_TURN = Math.PI / 2;

const dimensions = (w: number, d: number): Readonly<{ w: number; d: number }> =>
  Object.freeze({ w, d });

/**
 * Nominal object footprints in metres, including kinds reserved for future use.
 * These are deterministic MVP furnishing choices, not building-code standards.
 * Positions are centres; rot=0 faces +z and quarter turns face +x, -z, -x.
 * Keep this map as the single footprint source for placement and verification.
 */
export const FURNITURE_DIMENSIONS: Readonly<Record<FurnKind, Readonly<{ w: number; d: number }>>> =
  Object.freeze({
    bed: dimensions(1.5, 2),
    nightstand: dimensions(0.45, 0.45),
    sofa: dimensions(1.8, 0.85),
    table: dimensions(1.2, 0.8),
    desk: dimensions(1.2, 0.6),
    chair: dimensions(0.45, 0.45),
    tv: dimensions(1, 0.25),
    shelf: dimensions(1, 0.3),
    counter: dimensions(1.8, 0.6),
    island: dimensions(1.2, 0.75),
    rug: dimensions(1.8, 1.2),
    plant: dimensions(0.35, 0.35),
  });

/** Axis-aligned footprint for the cardinal rotations produced by the generator. */
export function furnitureFootprint(item: FurnItem): Rect {
  const quarterTurns = Math.round(item.rot / QUARTER_TURN);
  if (!Number.isFinite(item.rot) || Math.abs(item.rot - quarterTurns * QUARTER_TURN) > EPSILON) {
    throw new GenerationError('INVARIANT_FAILURE', 'Furniture must have an orthogonal orientation.');
  }
  const size = FURNITURE_DIMENSIONS[item.kind];
  const rotated = Math.abs(quarterTurns % 2) === 1;
  const w = rotated ? size.d : size.w;
  const d = rotated ? size.w : size.d;
  return { x: item.x - w / 2, z: item.z - d / 2, w, d };
}

/** Reserve a one-metre inward approach for each opening incident to this room. */
export function doorwayClearances(room: Room, openings: readonly DoorOpening[]): Rect[] {
  const { x, z, w, d } = room.rect;
  const clearances: Rect[] = [];
  for (const door of openings) {
    if (!door.roomIds.includes(room.id)) continue;
    const minX = Math.min(door.x0, door.x1);
    const minZ = Math.min(door.z0, door.z1);
    if (Math.abs(door.z0 - door.z1) < EPSILON) {
      const width = Math.abs(door.x1 - door.x0);
      if (Math.abs(minZ - z) < EPSILON) {
        clearances.push({ x: minX, z, w: width, d: Math.min(1, d) });
      } else if (Math.abs(minZ - (z + d)) < EPSILON) {
        clearances.push({ x: minX, z: z + d - Math.min(1, d), w: width, d: Math.min(1, d) });
      }
    } else if (Math.abs(door.x0 - door.x1) < EPSILON) {
      const depth = Math.abs(door.z1 - door.z0);
      if (Math.abs(minX - x) < EPSILON) {
        clearances.push({ x, z: minZ, w: Math.min(1, w), d: depth });
      } else if (Math.abs(minX - (x + w)) < EPSILON) {
        clearances.push({ x: x + w - Math.min(1, w), z: minZ, w: Math.min(1, w), d: depth });
      }
    }
  }
  return clearances;
}

function usableRect(room: Room): Rect {
  return {
    x: room.rect.x + WALL_MARGIN,
    z: room.rect.z + WALL_MARGIN,
    w: room.rect.w - WALL_MARGIN * 2,
    d: room.rect.d - WALL_MARGIN * 2,
  };
}

function fits(item: FurnItem, room: Room, occupied: readonly FurnItem[], clearances: readonly Rect[]): boolean {
  const footprint = furnitureFootprint(item);
  const usable = usableRect(room);
  return usable.w > 0 && usable.d > 0 && containsRect(usable, footprint, EPSILON)
    && clearances.every((clearance) => !rectanglesOverlap(footprint, clearance, EPSILON))
    && occupied.every((other) => !rectanglesOverlap(footprint, furnitureFootprint(other), EPSILON));
}

/** Five bounded positions per wall favour paired companions, then corner fits. */
function wallCandidates(kind: FurnKind, room: Room): FurnItem[] {
  const usable = usableRect(room);
  const size = FURNITURE_DIMENSIONS[kind];
  const candidates: FurnItem[] = [];
  for (const rot of [0, QUARTER_TURN, HALF_TURN, QUARTER_TURN * 3]) {
    const alongX = rot === 0 || rot === HALF_TURN;
    const low = (alongX ? usable.x : usable.z) + size.w / 2;
    const high = (alongX ? usable.x + usable.w : usable.z + usable.d) - size.w / 2;
    if (high < low - EPSILON) continue;
    for (const fraction of [0.5, 0, 1, 0.25, 0.75]) {
      const lateral = low + (high - low) * fraction;
      let x: number;
      let z: number;
      if (rot === 0) {
        x = lateral;
        z = usable.z + size.d / 2;
      } else if (rot === QUARTER_TURN) {
        x = usable.x + size.d / 2;
        z = lateral;
      } else if (rot === HALF_TURN) {
        x = lateral;
        z = usable.z + usable.d - size.d / 2;
      } else {
        x = usable.x + usable.w - size.d / 2;
        z = lateral;
      }
      if (!candidates.some((item) => Math.abs(item.x - x) < EPSILON
        && Math.abs(item.z - z) < EPSILON && item.rot === rot)) {
        candidates.push({ kind, x, z, rot });
      }
    }
  }
  return candidates;
}

function relativeItem(primary: FurnItem, kind: FurnKind, lateral: number, forward: number, rot = primary.rot): FurnItem {
  const sin = Math.round(Math.sin(primary.rot));
  const cos = Math.round(Math.cos(primary.rot));
  return {
    kind,
    x: primary.x + lateral * cos + forward * sin,
    z: primary.z - lateral * sin + forward * cos,
    rot,
  };
}

function companions(primary: FurnItem, room: Room): FurnItem[] {
  const size = FURNITURE_DIMENSIONS[primary.kind];
  if (primary.kind === 'bed') {
    const nightstand = FURNITURE_DIMENSIONS.nightstand;
    const lateral = (size.w + nightstand.w) / 2 + COMPANION_GAP;
    const forward = (nightstand.d - size.d) / 2;
    return [-lateral, lateral].map((offset) => relativeItem(primary, 'nightstand', offset, forward));
  }
  if (primary.kind === 'sofa') {
    const usable = usableRect(room);
    const tvDepth = FURNITURE_DIMENSIONS.tv.d;
    const rot = (primary.rot + HALF_TURN) % (HALF_TURN * 2);
    if (primary.rot === 0) return [{ kind: 'tv', x: primary.x, z: usable.z + usable.d - tvDepth / 2, rot }];
    if (primary.rot === HALF_TURN) return [{ kind: 'tv', x: primary.x, z: usable.z + tvDepth / 2, rot }];
    if (primary.rot === QUARTER_TURN) return [{ kind: 'tv', x: usable.x + usable.w - tvDepth / 2, z: primary.z, rot }];
    return [{ kind: 'tv', x: usable.x + tvDepth / 2, z: primary.z, rot }];
  }
  if (primary.kind === 'desk') {
    return [relativeItem(primary, 'chair', 0, (size.d + FURNITURE_DIMENSIONS.chair.d) / 2 + COMPANION_GAP,
      (primary.rot + HALF_TURN) % (HALF_TURN * 2))];
  }
  if (primary.kind === 'table') {
    const chair = FURNITURE_DIMENSIONS.chair;
    return [
      relativeItem(primary, 'chair', 0, -(size.d + chair.d) / 2 - COMPANION_GAP, primary.rot),
      relativeItem(primary, 'chair', 0, (size.d + chair.d) / 2 + COMPANION_GAP,
        (primary.rot + HALF_TURN) % (HALF_TURN * 2)),
      relativeItem(primary, 'chair', -(size.w + chair.d) / 2 - COMPANION_GAP, 0,
        (primary.rot + QUARTER_TURN) % (HALF_TURN * 2)),
      relativeItem(primary, 'chair', (size.w + chair.d) / 2 + COMPANION_GAP, 0,
        (primary.rot + QUARTER_TURN * 3) % (HALF_TURN * 2)),
    ];
  }
  return [];
}

function tableCandidates(room: Room): FurnItem[] {
  const candidates: FurnItem[] = [];
  for (const rot of [0, QUARTER_TURN]) {
    for (const xFraction of [0.5, 0.35, 0.65]) {
      for (const zFraction of [0.5, 0.35, 0.65]) {
        candidates.push({
          kind: 'table',
          x: room.rect.x + room.rect.w * xFraction,
          z: room.rect.z + room.rect.d * zFraction,
          rot,
        });
      }
    }
  }
  return [...candidates, ...wallCandidates('table', room)];
}

const PRIMARY_PIECES: Readonly<Record<string, FurnKind>> = Object.freeze({
  bedroom: 'bed',
  living: 'sofa',
  kitchen: 'counter',
  dining: 'table',
  study: 'desk',
});

/**
 * A bounded deterministic wall/centre search; primary furniture is required for
 * supported furnished room types. Companions are added only when they fit.
 * Bathrooms have no invented fixtures, and circulation stays unfurnished.
 * The canonical FurnItem has no room id: unique room containment is its relation.
 */
export function placeFurniture(rooms: readonly Room[], openings: readonly DoorOpening[]): FurnItem[] {
  const furniture: FurnItem[] = [];
  for (const room of rooms) {
    const primaryKind = Object.hasOwn(PRIMARY_PIECES, room.type) ? PRIMARY_PIECES[room.type] : undefined;
    if (primaryKind === undefined) continue;
    const clearances = doorwayClearances(room, openings);
    const candidates = primaryKind === 'table' ? tableCandidates(room) : wallCandidates(primaryKind, room);
    let selected: FurnItem[] | undefined;
    for (const primary of candidates) {
      if (!fits(primary, room, [], clearances)) continue;
      const group = [primary];
      for (const companion of companions(primary, room)) {
        if (fits(companion, room, group, clearances)) group.push(companion);
      }
      if (selected === undefined || group.length > selected.length) selected = group;
    }
    if (selected === undefined) {
      throw new GenerationError('IMPOSSIBLE_LAYOUT', 'A required furniture item cannot fit within its room and doorway clearances.');
    }
    furniture.push(...selected);
  }
  return furniture;
}
