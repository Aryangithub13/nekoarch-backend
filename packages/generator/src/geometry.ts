import type { Rect, Room, WallSeg } from '@designflow/shared';

/** Metres; arithmetic is rounded to micrometres at generated boundaries. */
export const EPSILON = 1e-7;
export const roundCoordinate = (value: number): number => Math.round(value * 1e6) / 1e6;
export const nearlyEqual = (a: number, b: number, tolerance = EPSILON): boolean => Math.abs(a - b) <= tolerance;
export const containsRect = (outer: Rect, inner: Rect, tolerance = EPSILON): boolean =>
  inner.x >= outer.x - tolerance && inner.z >= outer.z - tolerance
  && inner.x + inner.w <= outer.x + outer.w + tolerance && inner.z + inner.d <= outer.z + outer.d + tolerance;
export const rectanglesOverlap = (a: Rect, b: Rect, tolerance = EPSILON): boolean =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > tolerance
  && Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z) > tolerance;

/** Internal relationships only; canonical Plan represents openings by wall gaps. */
export type DoorOpening = WallSeg & { roomIds: number[] };

export function sharedBoundary(a: Rect, b: Rect): DoorOpening | null {
  const z0 = Math.max(a.z, b.z); const z1 = Math.min(a.z + a.d, b.z + b.d);
  if (z1 - z0 > EPSILON && (nearlyEqual(a.x + a.w, b.x) || nearlyEqual(b.x + b.w, a.x))) {
    const x = nearlyEqual(a.x + a.w, b.x) ? b.x : a.x;
    return { x0: x, x1: x, z0, z1, roomIds: [] };
  }
  const x0 = Math.max(a.x, b.x); const x1 = Math.min(a.x + a.w, b.x + b.w);
  if (x1 - x0 > EPSILON && (nearlyEqual(a.z + a.d, b.z) || nearlyEqual(b.z + b.d, a.z))) {
    const z = nearlyEqual(a.z + a.d, b.z) ? b.z : a.z;
    return { x0, x1, z0: z, z1: z, roomIds: [] };
  }
  return null;
}

/** Split edges at every T-junction, retaining exactly the rooms beside each span. */
export function roomBoundaries(rooms: readonly Room[]): DoorOpening[] {
  const lines = new Map<string, { vertical: boolean; position: number; spans: { start: number; end: number; id: number }[] }>();
  function edge(vertical: boolean, position: number, start: number, end: number, id: number) {
    const key = `${vertical ? 'v' : 'h'}:${roundCoordinate(position)}`;
    let line = lines.get(key);
    if (!line) { line = { vertical, position: roundCoordinate(position), spans: [] }; lines.set(key, line); }
    line.spans.push({ start: roundCoordinate(start), end: roundCoordinate(end), id });
  }
  for (const { id, rect: r } of rooms) {
    edge(true, r.x, r.z, r.z + r.d, id); edge(true, r.x + r.w, r.z, r.z + r.d, id);
    edge(false, r.z, r.x, r.x + r.w, id); edge(false, r.z + r.d, r.x, r.x + r.w, id);
  }
  const boundaries: DoorOpening[] = [];
  for (const [, line] of [...lines].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const points = [...new Set(line.spans.flatMap(span => [span.start, span.end]))].sort((a, b) => a - b);
    for (let i = 1; i < points.length; i++) {
      const start = points[i - 1]!; const end = points[i]!;
      if (end - start <= EPSILON) continue;
      const roomIds = [...new Set(line.spans.filter(span => span.start <= start + EPSILON && span.end >= end - EPSILON).map(span => span.id))].sort((a, b) => a - b);
      if (roomIds.length === 0) continue;
      boundaries.push(line.vertical
        ? { x0: line.position, x1: line.position, z0: start, z1: end, roomIds }
        : { x0: start, x1: end, z0: line.position, z1: line.position, roomIds });
    }
  }
  return boundaries;
}

export function segmentLength(segment: WallSeg): number { return Math.hypot(segment.x1 - segment.x0, segment.z1 - segment.z0); }

/** Collinear occupied intervals, clipped to the supplied boundary. */
export function coveredIntervals(boundary: WallSeg, segments: readonly WallSeg[]): [number, number][] {
  const vertical = nearlyEqual(boundary.x0, boundary.x1);
  const start = vertical ? Math.min(boundary.z0, boundary.z1) : Math.min(boundary.x0, boundary.x1);
  const end = vertical ? Math.max(boundary.z0, boundary.z1) : Math.max(boundary.x0, boundary.x1);
  const intervals: [number, number][] = [];
  for (const segment of segments) {
    const collinear = vertical
      ? nearlyEqual(segment.x0, boundary.x0) && nearlyEqual(segment.x1, boundary.x0)
      : nearlyEqual(segment.z0, boundary.z0) && nearlyEqual(segment.z1, boundary.z0);
    if (!collinear) continue;
    const low = Math.max(start, vertical ? Math.min(segment.z0, segment.z1) : Math.min(segment.x0, segment.x1));
    const high = Math.min(end, vertical ? Math.max(segment.z0, segment.z1) : Math.max(segment.x0, segment.x1));
    if (high - low > EPSILON) intervals.push([low, high]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval[0] <= last[1] + EPSILON) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}

function uncovered(boundary: DoorOpening, occupied: readonly WallSeg[]): DoorOpening[] {
  const vertical = nearlyEqual(boundary.x0, boundary.x1);
  let cursor = vertical ? boundary.z0 : boundary.x0;
  const end = vertical ? boundary.z1 : boundary.x1;
  const gaps: DoorOpening[] = [];
  const push = (low: number, high: number) => {
    if (high - low <= EPSILON) return;
    gaps.push(vertical ? { ...boundary, z0: low, z1: high } : { ...boundary, x0: low, x1: high });
  };
  for (const [low, high] of coveredIntervals(boundary, occupied)) { push(cursor, low); cursor = high; }
  push(cursor, end);
  return gaps;
}

export function deriveOpenings(rooms: readonly Room[], walls: readonly WallSeg[]): DoorOpening[] {
  return roomBoundaries(rooms).flatMap(boundary => uncovered(boundary, walls));
}

export function wallsWithOpenings(rooms: readonly Room[], openings: readonly DoorOpening[]): WallSeg[] {
  return roomBoundaries(rooms).flatMap(boundary => uncovered(boundary, openings))
    .map(({ x0, z0, x1, z1 }) => ({ x0, z0, x1, z1 }));
}
