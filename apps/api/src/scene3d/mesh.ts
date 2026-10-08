import type { MaterialId } from './contracts.js';

/** Coordinates are integer half-millimetres (model mm × 2) in the model frame; normals are axis unit vectors. */
export type Range = readonly [number, number];
export type Axis = 0 | 1 | 2;
export interface Primitive { material: MaterialId; positions: number[]; normals: number[]; indices: number[] }
export const primitive = (material: MaterialId): Primitive => ({ material, positions: [], normals: [], indices: [] });

// (u, v) follow the axis cyclically so e_u × e_v = e_axis (right-handed).
const NEXT: Record<Axis, [Axis, Axis]> = { 0: [1, 2], 1: [2, 0], 2: [0, 1] };

/** One axis-aligned rectangle, counter-clockwise seen from the side its outward normal (sign · e_axis) points to. */
export function rect(p: Primitive, axis: Axis, sign: 1 | -1, at: number, ranges: Partial<Record<Axis, Range>>): void {
  const [u, v] = NEXT[axis], [u0, u1] = ranges[u]!, [v0, v1] = ranges[v]!;
  const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] as const;
  const base = p.positions.length / 3;
  for (const [a, b] of sign > 0 ? corners : [...corners].reverse()) {
    const q = [0, 0, 0], n = [0, 0, 0];
    q[axis] = at; q[u] = a; q[v] = b; n[axis] = sign;
    p.positions.push(q[0]!, q[1]!, q[2]!); p.normals.push(n[0]!, n[1]!, n[2]!);
  }
  p.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * Closed solid from a 2D cell grid in plane (a, b), extruded along `depth` over `span`.
 * Caps cover solid cells; side faces lie exactly on solid/empty cell boundaries, so apertures and voids are real holes.
 */
export function extrudeGrid(p: Primitive, a: Axis, b: Axis, depth: Axis, span: Range, breaksA: number[], breaksB: number[], solid: (i: number, j: number) => boolean): void {
  const nA = breaksA.length - 1, nB = breaksB.length - 1;
  const cell = (i: number, j: number) => i >= 0 && j >= 0 && i < nA && j < nB && solid(i, j);
  for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) if (cell(i, j)) {
    const ranges = { [a]: [breaksA[i]!, breaksA[i + 1]!], [b]: [breaksB[j]!, breaksB[j + 1]!] } as Partial<Record<Axis, Range>>;
    rect(p, depth, 1, span[1], ranges); rect(p, depth, -1, span[0], ranges);
  }
  for (let i = 0; i <= nA; i++) for (let j = 0; j < nB; j++) {
    const before = cell(i - 1, j), after = cell(i, j);
    if (before !== after) rect(p, a, before ? 1 : -1, breaksA[i]!, { [b]: [breaksB[j]!, breaksB[j + 1]!], [depth]: span } as Partial<Record<Axis, Range>>);
  }
  for (let j = 0; j <= nB; j++) for (let i = 0; i < nA; i++) {
    const before = cell(i, j - 1), after = cell(i, j);
    if (before !== after) rect(p, b, before ? 1 : -1, breaksB[j]!, { [a]: [breaksA[i]!, breaksA[i + 1]!], [depth]: span } as Partial<Record<Axis, Range>>);
  }
}

/** Upward/downward-facing surface over the solid cells only (walking surfaces with no modeled thickness). */
export function capGrid(p: Primitive, a: Axis, b: Axis, normal: Axis, sign: 1 | -1, at: number, breaksA: number[], breaksB: number[], solid: (i: number, j: number) => boolean): void {
  for (let i = 0; i < breaksA.length - 1; i++) for (let j = 0; j < breaksB.length - 1; j++) if (solid(i, j))
    rect(p, normal, sign, at, { [a]: [breaksA[i]!, breaksA[i + 1]!], [b]: [breaksB[j]!, breaksB[j + 1]!] } as Partial<Record<Axis, Range>>);
}

export const box = (p: Primitive, x: Range, y: Range, z: Range) => extrudeGrid(p, 0, 1, 2, z, [...x], [...y], () => true);
export const breaks = (values: number[]) => [...new Set(values)].sort((m, n) => m - n);
/** Cells-before-tessellation bound: each cell yields at most 2 caps + 4 sides = 12 triangles. */
export const gridTriangleBound = (breaksA: number, breaksB: number) => Math.max(0, breaksA - 1) * Math.max(0, breaksB - 1) * 12;
