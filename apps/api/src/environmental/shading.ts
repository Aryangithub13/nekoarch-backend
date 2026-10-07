import { SHADING, ENVIRONMENTAL_LIMITS, type EnvironmentalModel, type EnvironmentalSurface } from './contracts.js';

type V = [number, number, number];
type P = { x: number; z: number };
type Occluder = { sourceKey: string } & ({ kind: 'wall'; a: P; b: P; y0: number; y1: number } | { kind: 'plate'; outer: P[]; voids: P[][]; y: number });
const sourceKey = (s: EnvironmentalSurface) => `${s.source.collection}:${s.source.id}`;

/** Occluders: storey-height exterior-wall rectangles (closing the slab-edge band) and roof polygons, all in the building frame (mm). */
export function occludersOf(model: EnvironmentalModel): Occluder[] {
  return model.surfaces.flatMap((s): Occluder[] => s.type === 'EXTERIOR_WALL' && s.geometry.kind === 'VERTICAL_RECTANGLE'
    ? [{ kind: 'wall', sourceKey: sourceKey(s), a: s.geometry.start, b: s.geometry.end, y0: s.geometry.bottomMm, y1: s.geometry.storeyTopMm }]
    : s.type === 'ROOF' && s.geometry.kind === 'HORIZONTAL_POLYGON' ? [{ kind: 'plate', sourceKey: sourceKey(s), outer: s.geometry.outer, voids: s.geometry.voids, y: s.geometry.elevationMm }] : []);
}

const n = (extentMm: number) => Math.min(ENVIRONMENTAL_LIMITS.samplesPerAxis, Math.max(1, Math.ceil(extentMm / SHADING.cellMm)));
/** Float point-in-polygon, boundary inclusive (crossing number plus an explicit on-edge test). */
function inPolygon(x: number, z: number, ring: P[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!, b = ring[i]!, cross = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
    if (Math.abs(cross) <= 1e-9 * Math.hypot(b.x - a.x, b.z - a.z) && x >= Math.min(a.x, b.x) - 1e-9 && x <= Math.max(a.x, b.x) + 1e-9 && z >= Math.min(a.z, b.z) - 1e-9 && z <= Math.max(a.z, b.z) + 1e-9) return true;
    if ((a.z > z) !== (b.z > z) && x < a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z)) inside = !inside;
  }
  return inside;
}
const onPlate = (x: number, z: number, o: { outer: P[]; voids: P[][] }) => inPolygon(x, z, o.outer) && !o.voids.some(v => inPolygon(x, z, v) && !onBoundary(x, z, v));
function onBoundary(x: number, z: number, ring: P[]) {
  return ring.some((a, i) => { const b = ring[(i + 1) % ring.length]!; return Math.abs((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x)) <= 1e-9 * Math.hypot(b.x - a.x, b.z - a.z)
    && x >= Math.min(a.x, b.x) - 1e-9 && x <= Math.max(a.x, b.x) + 1e-9 && z >= Math.min(a.z, b.z) - 1e-9 && z <= Math.max(a.z, b.z) + 1e-9; });
}

/** Sample points (cell centres) on a surface, in mm. Vertical: ⌈L/500⌉ × ⌈H/500⌉ capped at 8 × 8; polygons: grid over the bounding box, centres inside. */
export function samplePoints(s: EnvironmentalSurface): V[] {
  const g = s.geometry;
  if (g.kind === 'VERTICAL_RECTANGLE') {
    const L = Math.hypot(g.end.x - g.start.x, g.end.z - g.start.z), H = g.topMm - g.bottomMm, nu = n(L), nv = n(H), out: V[] = [];
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const u = (i + 0.5) / nu, v = (j + 0.5) / nv;
      out.push([g.start.x + (g.end.x - g.start.x) * u, g.bottomMm + H * v, g.start.z + (g.end.z - g.start.z) * u]); }
    return out;
  }
  const xs = g.outer.map(p => p.x), zs = g.outer.map(p => p.z), x0 = Math.min(...xs), z0 = Math.min(...zs), W = Math.max(...xs) - x0, D = Math.max(...zs) - z0;
  for (const scale of [1, 2, 4]) {
    const nu = n(W) * scale, nv = n(D) * scale, out: V[] = [];
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const x = x0 + W * (i + 0.5) / nu, z = z0 + D * (j + 0.5) / nv; if (onPlate(x, z, g)) out.push([x, g.elevationMm, z]); }
    if (out.length) return out;
  }
  return [];
}

/** Whether the ray hits the occluder beyond the minimum distance. Bounds are inclusive (edge contact shades); parallel rays never hit. */
function hit(o: V, d: V, occ: Occluder): boolean {
  if (occ.kind === 'wall') {
    const ex = occ.b.x - occ.a.x, ez = occ.b.z - occ.a.z, det = ex * d[2] - d[0] * ez;
    if (Math.abs(det) <= 1e-12 * Math.hypot(ex, ez)) return false;
    const rx = occ.a.x - o[0], rz = occ.a.z - o[2], t = (ex * rz - ez * rx) / det, u = (d[0] * rz - d[2] * rx) / det, y = o[1] + t * d[1];
    return t > SHADING.minHitMm && u >= -1e-9 && u <= 1 + 1e-9 && y >= occ.y0 - 1e-9 && y <= occ.y1 + 1e-9;
  }
  if (Math.abs(d[1]) <= 1e-12) return false;
  const t = (occ.y - o[1]) / d[1];
  return t > SHADING.minHitMm && onPlate(o[0] + t * d[0], o[2] + t * d[2], occ);
}

/** Count of samples on `surface` with an unobstructed straight path toward the sun (unit vector `sun`). */
export function sunlitSamples(surface: EnvironmentalSurface, points: V[], sun: V, occluders: Occluder[], hostKey: string | null, deadline: number) {
  const own = sourceKey(surface), off = SHADING.originOffsetMm + (surface.geometry.kind === 'VERTICAL_RECTANGLE' ? surface.geometry.faceOffsetMm : 0), nrm = surface.normal, others = occluders.filter(o => o.sourceKey !== own && o.sourceKey !== hostKey);
  let lit = 0;
  for (const p of points) {
    if (performance.now() > deadline) return null;
    const o: V = [p[0] + nrm[0] * off, p[1] + nrm[1] * off, p[2] + nrm[2] * off];
    if (!others.some(occ => hit(o, sun, occ))) lit++;
  }
  return lit;
}
