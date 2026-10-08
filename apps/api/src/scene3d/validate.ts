import { createHash } from 'node:crypto';
import { BuildingModelShapeSchema, type BuildingModelV2, type Point2Mm } from '@designflow/shared';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { costHash } from '@designflow/boq-cost';
import { modelHash } from '../lib/generation-identity.js';
import { projectBim } from '../bim/project.js';
import { SCENE_COMPILER_VERSION, SCENE_LIMITS, SCENE_MANIFEST_VERSION, SCENE_VALIDATOR_VERSION, SceneBindingSchema, SceneManifestSchema, VALIDATOR_TOLERANCE_NM,
  type SceneBinding, type SceneManifest, type SceneValidation } from './contracts.js';

/**
 * Independent scene validator. It never imports the compiler, mesh builder or GLB writer: it parses the GLB with its own reader,
 * measures the decoded geometry (exact integer half-millimetres after a grid check) and compares it with expectations derived
 * from the source model by separate arithmetic (bounding boxes, divergence-theorem volumes, face areas, axis-ray aperture probes).
 */
type V3 = [number, number, number];
interface Prim { positions: number[]; normals: Float32Array; indices: Uint32Array; material: number }
interface GNode { name?: string; mesh?: number; children?: number[]; translation?: number[]; extras?: Record<string, unknown>; rotation?: unknown; scale?: unknown; matrix?: unknown }
interface Accessor { bufferView: number; componentType: number; count: number; type: string; byteOffset?: number; min?: number[]; max?: number[] }
interface GPrimitive { attributes: { POSITION: number; NORMAL: number }; indices: number; material: number; mode?: number }
interface GltfJson { asset?: { version?: string }; extensionsUsed?: unknown; extensionsRequired?: unknown; buffers?: { byteLength: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[]; accessors?: Accessor[]; scene?: number; scenes?: { nodes?: number[] }[];
  nodes?: GNode[]; meshes?: { primitives: GPrimitive[] }[]; materials?: { extras?: { provenance?: string } }[] }
const FLOAT = 5126, USHORT = 5123, UINT = 5125, JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;
class Invalid extends Error {}

function readGlb(glb: Buffer) {
  const need = (ok: boolean, message: string) => { if (!ok) throw new Invalid(message); };
  need(glb.length >= 28 && glb.readUInt32LE(0) === 0x46546c67 && glb.readUInt32LE(4) === 2 && glb.readUInt32LE(8) === glb.length, 'GLB header invalid');
  const jsonLength = glb.readUInt32LE(12);
  need(glb.readUInt32LE(16) === JSON_CHUNK && jsonLength % 4 === 0 && jsonLength <= 4 * 1024 * 1024 && 20 + jsonLength + 8 <= glb.length, 'GLB JSON chunk invalid');
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as GltfJson;
  const binAt = 20 + jsonLength, binLength = glb.readUInt32LE(binAt);
  need(glb.readUInt32LE(binAt + 4) === BIN_CHUNK && binLength % 4 === 0 && binAt + 8 + binLength === glb.length, 'GLB BIN chunk invalid');
  const bin = glb.subarray(binAt + 8, binAt + 8 + binLength);
  const bufferLength = json.buffers?.length === 1 ? json.buffers[0]!.byteLength : -1;
  need(json.asset?.version === '2.0' && !json.extensionsUsed && !json.extensionsRequired && bufferLength >= 0 && bufferLength <= binLength, 'glTF asset/buffer invalid');
  const views = json.bufferViews ?? [];
  need(views.every(v => v.buffer === 0 && (v.byteOffset ?? 0) % 4 === 0 && (v.byteOffset ?? 0) + v.byteLength <= bufferLength), 'bufferView out of range');
  const accessor = (index: number, kind: 'VEC3' | 'SCALAR') => {
    const a = json.accessors?.[index], v = a ? views[a.bufferView] : undefined;
    if (!a || !v || a.type !== kind || !Number.isInteger(a.count) || a.count <= 0 || a.byteOffset) throw new Invalid(`accessor ${index} invalid`);
    const size = kind === 'VEC3' ? 12 : a.componentType === UINT ? 4 : 2;
    need(kind === 'VEC3' ? a.componentType === FLOAT : [USHORT, UINT].includes(a.componentType), `accessor ${index} component type invalid`);
    need(a.count * size <= v.byteLength, `accessor ${index} exceeds its view`);
    const bytes = Buffer.from(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + a.count * size));
    const out = kind === 'VEC3' ? new Float32Array(bytes.buffer, bytes.byteOffset, a.count * 3) : a.componentType === UINT ? new Uint32Array(bytes.buffer, bytes.byteOffset, a.count) : new Uint16Array(bytes.buffer, bytes.byteOffset, a.count);
    return { a, out };
  };
  return { json, accessor };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossI = (a: V3, b: V3): [bigint, bigint, bigint] => [BigInt(a[1]) * BigInt(b[2]) - BigInt(a[2]) * BigInt(b[1]), BigInt(a[2]) * BigInt(b[0]) - BigInt(a[0]) * BigInt(b[2]), BigInt(a[0]) * BigInt(b[1]) - BigInt(a[1]) * BigInt(b[0])];
const twiceArea = (ring: Point2Mm[]) => { let s = 0n; ring.forEach((p, i) => { const q = ring[(i + 1) % ring.length]!; s += BigInt(p.x) * BigInt(q.z) - BigInt(q.x) * BigInt(p.z); }); return s < 0n ? -s : s; };
/** Strictly-inside sample next to the lexicographically smallest vertex of an orthogonal ring (a convex corner), in half-mm. */
const cornerSample = (ring: Point2Mm[]) => { const v = [...ring].sort((a, b) => a.x - b.x || a.z - b.z)[0]!; return { x: v.x * 2 + 1, z: v.z * 2 + 1 }; };
function inside(p: { x: number; z: number }, ring: Point2Mm[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

export function validateScene(raw: unknown, bindingInput: SceneBinding, manifestInput: unknown, glb: Buffer): SceneValidation {
  const failures: string[] = [];
  let checks = 0;
  const check = (ok: boolean, message: string) => { checks++; if (!ok && failures.length < 50) failures.push(message); return ok; };
  try {
    const manifestParse = SceneManifestSchema.safeParse(manifestInput);
    if (!check(manifestParse.success, 'manifest schema invalid')) throw new Invalid('manifest');
    const manifest: SceneManifest = manifestParse.data!, binding = SceneBindingSchema.parse(bindingInput);
    const m = BuildingModelShapeSchema.parse(raw) as BuildingModelV2;

    // Identity, binding and hashes.
    check(createHash('sha256').update(glb).digest('hex') === manifest.binary.sha256 && glb.length === manifest.binary.bytes, 'binary SHA-256/length differs from manifest');
    check(costHash({ compilerVersion: SCENE_COMPILER_VERSION, manifestVersion: SCENE_MANIFEST_VERSION, source: manifest.source }) === manifest.inputHash, 'inputHash does not recompute');
    check(JSON.stringify(manifest.source) === JSON.stringify(binding), 'manifest source differs from the revision binding');
    check(modelHash(m) === binding.modelHash, 'modelHash does not match the source model');
    check((m.parametricArchitecture ? costHash(m.parametricArchitecture) : null) === binding.parameterHash, 'parameterHash does not match the source model');

    // GLB structure and node graph.
    const { json, accessor } = readGlb(glb);
    const nodes = json.nodes ?? [];
    check(json.scene === 0 && json.scenes?.[0]?.nodes?.length === 1 && json.scenes[0].nodes[0] === 0 && nodes.length > 0, 'scene root invalid');
    const root = nodes[0]!, o = manifest.frame.originMm;
    check(JSON.stringify(root.translation) === JSON.stringify([o.x / 1000, o.y / 1000, o.z / 1000]) && !root.rotation && !root.scale && !root.matrix, 'root transform must be exactly the manifest origin translation');
    const seen = new Set<number>(), objectNodes: { node: GNode; depth: number }[] = [];
    const walk = (index: number, depth: number) => {
      if (!check(Number.isInteger(index) && index >= 0 && index < nodes.length && !seen.has(index) && depth <= 6, `node graph invalid at ${index}`)) return;
      seen.add(index);
      const n = nodes[index]!;
      if (index !== 0) check(!n.translation && !n.rotation && !n.scale && !n.matrix, `non-root node ${n.name} carries a transform`);
      if (n.mesh !== undefined) objectNodes.push({ node: n, depth });
      for (const c of n.children ?? []) walk(c, depth + 1);
    };
    walk(0, 0);
    check(seen.size === nodes.length && nodes.length === manifest.statistics.nodes, 'unreachable or uncounted nodes');
    check(objectNodes.length === manifest.objects.length && new Set(objectNodes.map(x => x.node.mesh)).size === objectNodes.length && (json.meshes?.length ?? 0) === objectNodes.length,
      'each object needs exactly one node and mesh');

    // Decode every object; vertices must return to the 0.5 mm grid.
    check(manifest.precision.validatorToleranceNm === VALIDATOR_TOLERANCE_NM && manifest.precision.maxFloat32ErrorNm <= VALIDATOR_TOLERANCE_NM, 'precision contract invalid');
    const tolHalf = VALIDATOR_TOLERANCE_NM / 500_000;
    const decoded = new Map<string, Prim[]>();
    let triangles = 0, vertices = 0, offGrid = 0;
    const gmin: V3 = [Infinity, Infinity, Infinity], gmax: V3 = [-Infinity, -Infinity, -Infinity];
    for (const { node } of objectNodes) {
      const prims: Prim[] = [];
      for (const p of json.meshes?.[node.mesh!]?.primitives ?? []) {
        check((p.mode ?? 4) === 4 && Object.keys(p.attributes).sort().join() === 'NORMAL,POSITION', `${node.name}: primitive must be indexed triangles with POSITION/NORMAL`);
        const pos = accessor(p.attributes.POSITION, 'VEC3'), nrm = accessor(p.attributes.NORMAL, 'VEC3'), idx = accessor(p.indices, 'SCALAR');
        check(pos.a.count === nrm.a.count && idx.a.count % 3 === 0, `${node.name}: attribute counts inconsistent`);
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], positions: number[] = [];
        for (let i = 0; i < pos.out.length; i++) {
          const f = pos.out[i]!, k = i % 3;
          if (!check(Number.isFinite(f), `${node.name}: non-finite position`)) throw new Invalid('non-finite');
          min[k] = Math.min(min[k]!, f); max[k] = Math.max(max[k]!, f);
          const half = (f * 1000 + (k === 0 ? o.x : k === 1 ? o.y : o.z)) * 2, rounded = Math.round(half);
          if (Math.abs(half - rounded) > tolHalf) offGrid++;
          positions.push(rounded); gmin[k] = Math.min(gmin[k]!, rounded); gmax[k] = Math.max(gmax[k]!, rounded);
        }
        check(JSON.stringify(pos.a.min) === JSON.stringify(min) && JSON.stringify(pos.a.max) === JSON.stringify(max), `${node.name}: accessor min/max differ from data`);
        const indices = Uint32Array.from(idx.out);
        check(indices.every(i => i < pos.a.count), `${node.name}: index out of range`);
        prims.push({ positions, normals: nrm.out as Float32Array, indices, material: p.material });
        triangles += indices.length / 3; vertices += pos.a.count;
      }
      decoded.set(node.name ?? '', prims);
    }
    check(offGrid === 0, `${offGrid} vertex components are off the 0.5 mm grid (scale or precision error)`);
    check(triangles === manifest.statistics.triangles && vertices === manifest.statistics.vertices, 'statistics differ from the GLB');
    check(triangles <= SCENE_LIMITS.triangles && vertices <= SCENE_LIMITS.vertices && manifest.objects.length <= SCENE_LIMITS.objects, 'resource limits exceeded');
    const outward = (v: number, up: boolean) => up ? Math.ceil(v / 2) : Math.floor(v / 2);
    check(JSON.stringify(manifest.bounds) === JSON.stringify({ min: { x: outward(gmin[0], false), y: outward(gmin[1], false), z: outward(gmin[2], false) },
      max: { x: outward(gmax[0], true), y: outward(gmax[1], true), z: outward(gmax[2], true) } }), 'manifest bounds differ from the GLB');

    // Per-triangle integrity: non-degenerate, stored normal agrees with geometric normal (winding), closed solids.
    const measure = (prims: Prim[], name: string, closed: boolean) => {
      let six = 0n; const areaVec = [0n, 0n, 0n], faceArea = new Map<string, bigint>();
      const box = { min: [Infinity, Infinity, Infinity] as V3, max: [-Infinity, -Infinity, -Infinity] as V3 };
      for (const p of prims) {
        const v = (i: number): V3 => [p.positions[i * 3]!, p.positions[i * 3 + 1]!, p.positions[i * 3 + 2]!];
        for (let t = 0; t < p.indices.length; t += 3) {
          const a = v(p.indices[t]!), b = v(p.indices[t + 1]!), c = v(p.indices[t + 2]!), n = crossI(sub(b, a), sub(c, a));
          if (!check(n.some(x => x !== 0n), `${name}: degenerate triangle`)) continue;
          // Axis-aligned contract: every stored vertex normal of the triangle is exactly the unit axis vector of its winding.
          const unit = n.map(x => x > 0n ? 1 : x < 0n ? -1 : 0);
          check(n.filter(x => x !== 0n).length === 1 && [0, 1, 2].every(k => [0, 1, 2].every(c => p.normals[p.indices[t + k]! * 3 + c] === unit[c])), `${name}: winding or normal reversed`);
          areaVec[0] = areaVec[0]! + n[0]; areaVec[1] = areaVec[1]! + n[1]; areaVec[2] = areaVec[2]! + n[2];
          const axis = n[0] !== 0n ? 0 : n[1] !== 0n ? 1 : 2, sign = n[axis]! > 0n ? '+' : '-', key = `${sign}${axis}`;
          faceArea.set(key, (faceArea.get(key) ?? 0n) + (n[axis]! < 0n ? -n[axis]! : n[axis]!));
          const cr = crossI(b, c); six += BigInt(a[0]) * cr[0] + BigInt(a[1]) * cr[1] + BigInt(a[2]) * cr[2];
          for (const q of [a, b, c]) for (let k = 0; k < 3; k++) { box.min[k] = Math.min(box.min[k]!, q[k]!); box.max[k] = Math.max(box.max[k]!, q[k]!); }
        }
      }
      if (closed) check(areaVec.every(x => x === 0n) && six > 0n, `${name}: solid is not closed or is inside out`);
      return { six, faceArea, box };
    };
    const sameBox = (box: { min: V3; max: V3 }, min: V3, max: V3) => box.min.every((x, k) => x === min[k]) && box.max.every((x, k) => x === max[k]);
    /** Does any triangle of `prims` facing along `axis` contain the axis-aligned ray through (other two coordinates)? */
    const rayHits = (prims: Prim[], axis: 0 | 1 | 2, point: V3) => {
      const [u, w] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1];
      for (const p of prims) for (let t = 0; t < p.indices.length; t += 3) {
        const q = [0, 1, 2].map(k => p.indices[t + k]! * 3).map(i => [p.positions[i]!, p.positions[i + 1]!, p.positions[i + 2]!] as V3);
        if (q[0]![axis] !== q[1]![axis] || q[1]![axis] !== q[2]![axis]) continue;
        const s = (a: V3, b: V3) => (b[u]! - a[u]!) * (point[w]! - a[w]!) - (b[w]! - a[w]!) * (point[u]! - a[u]!);
        const d0 = s(q[0]!, q[1]!), d1 = s(q[1]!, q[2]!), d2 = s(q[2]!, q[0]!);
        if ((d0 >= 0 && d1 >= 0 && d2 >= 0) || (d0 <= 0 && d1 <= 0 && d2 <= 0)) return true;
      }
      return false;
    };

    // Coverage and object mapping, derived independently from the source.
    const objects = new Map(manifest.objects.map(x => [x.sceneObjectId, x]));
    const covered = new Map(manifest.coverage.map(c => [`${c.entityType}:${c.entityId}`, c]));
    check(objects.size === manifest.objects.length && covered.size === manifest.coverage.length, 'duplicate objects or coverage entries');
    for (const { node } of objectNodes) {
      const x = objects.get(node.name ?? ''), e = node.extras ?? {};
      if (!check(!!x, `GLB node ${node.name} has no manifest object`)) continue;
      check(e.sceneObjectId === x!.sceneObjectId && e.sourceEntityId === x!.sourceEntityId && e.sourceEntityType === x!.sourceEntityType && e.bimElementId === x!.bimElementId
        && e.layer === x!.layer && e.levelId === x!.levelId && e.geometryRole === x!.geometryRole && e.fidelity === x!.fidelity && e.sourceRevisionId === binding.revisionId
        && e.modelHash === binding.modelHash && e.sceneCompilerVersion === SCENE_COMPILER_VERSION, `${node.name}: node semantics differ from manifest`);
    }
    let bimIds = new Map<string, string>();
    try { bimIds = new Map(projectBim(raw, { ...binding, generationId: null, requirementsHash: null }).elements.map(b => [`${b.source.collection}:${b.source.id}`, b.id])); }
    catch { check(false, 'BIM projection rejects the source or binding'); }
    const level = new Map(m.levels.map(l => [l.id, l]));
    const ROLE: Record<string, [string, string, string]> = { wall: ['wall', 'walls', 'FULL_GEOMETRY'], 'door-leaf': ['opening', 'openings', 'VISUAL_PLACEHOLDER'],
      'window-pane': ['opening', 'openings', 'VISUAL_PLACEHOLDER'], slab: ['slab', 'slabs', 'FULL_GEOMETRY'], 'stair-flight': ['stair', 'stairs', 'FULL_GEOMETRY'],
      landing: ['landing', 'landings', 'FULL_GEOMETRY'], 'room-volume': ['space', 'spaces', 'SEMANTIC_ONLY'], 'wall-junction': ['junction', '', 'VISUAL_PLACEHOLDER'] };
    for (const x of manifest.objects) {
      const [type, collection, fidelity] = ROLE[x.geometryRole]!;
      check(x.sourceEntityType === type && x.fidelity === fidelity && x.sceneObjectId === `${x.geometryRole}:${x.sourceEntityId}` && x.appearance === 'VISUAL_PLACEHOLDER',
        `${x.sceneObjectId}: role/fidelity/provenance inconsistent`);
      check(x.bimElementId === (collection ? bimIds.get(`${collection}:${x.sourceEntityId}`) ?? null : null), `${x.sceneObjectId}: bimElementId differs from the BIM projection`);
    }
    const expectEntity = (type: SceneManifest['coverage'][number]['entityType'], id: string, roles: string[]) => {
      const c = covered.get(`${type}:${id}`);
      if (!check(!!c, `${type} ${id} missing from coverage`)) return;
      check(c!.sceneObjectIds.every(s => objects.has(s)) && roles.every(r => c!.sceneObjectIds.includes(`${r}:${id}`)), `${type} ${id}: coverage objects missing`);
    };
    for (const l of m.levels) expectEntity('level', l.id, []);
    for (const s of m.spaces) expectEntity('space', s.id, ['room-volume']);
    for (const s of m.slabs) { expectEntity('slab', s.id, ['slab']); s.footprint.voids.forEach((_, i) => expectEntity('void', `${s.id}:void:${i}`, [])); }
    for (const s of m.stairs) { expectEntity('stair', s.id, ['stair-flight']); for (const l of s.landings) expectEntity('landing', l.id, ['landing']); }
    for (const o of m.openings) expectEntity('opening', o.id, o.kind === 'door' ? ['door-leaf'] : o.kind === 'window' ? ['window-pane'] : []);
    for (const w of m.walls) expectEntity('wall', w.id, w.thicknessMm !== null && w.heightMm !== null && w.baseOffsetMm !== null ? ['wall'] : []);
    check(manifest.coverage.length === m.levels.length + m.spaces.length + m.slabs.length + m.slabs.reduce((n, s) => n + s.footprint.voids.length, 0)
      + m.stairs.length + m.stairs.reduce((n, s) => n + s.landings.length, 0) + m.openings.length + m.walls.length + m.dimensions.length + (m.site ? 1 : 0), 'coverage has unexpected entries');

    // Apertures from the source (half-mm), used by walls, placeholders and junction fills.
    type Ap = { id: string; wallId: string; levelId: string; axis: 0 | 2; a: [number, number]; y: [number, number]; d: [number, number] };
    const aps: Ap[] = [];
    for (const w of m.walls) {
      if (w.thicknessMm === null || w.heightMm === null || w.baseOffsetMm === null) continue;
      const axis = w.path.start.z === w.path.end.z ? 0 : 2, s = (axis === 0 ? w.path.start.x : w.path.start.z) * 2, e = (axis === 0 ? w.path.end.x : w.path.end.z) * 2;
      const dir = Math.sign(e - s), c = (axis === 0 ? w.path.start.z : w.path.start.x) * 2, base = (level.get(w.levelId)!.elevationMm + w.baseOffsetMm) * 2;
      for (const op of m.openings.filter(x => x.wallId === w.id)) {
        const p = s + dir * op.offsetMm * 2, q = p + dir * op.widthMm * 2;
        aps.push({ id: op.id, wallId: w.id, levelId: w.levelId, axis, a: [Math.min(p, q), Math.max(p, q)], y: [base + op.sillMm * 2, base + (op.sillMm + op.heightMm) * 2], d: [c - w.thicknessMm, c + w.thicknessMm] });
      }
    }
    const P = (axis: 0 | 2, along: number, y: number, across: number): V3 => axis === 0 ? [along, y, across] : [across, y, along];

    for (const w of m.walls) {
      const prims = decoded.get(`wall:${w.id}`);
      if (!prims || w.thicknessMm === null || w.heightMm === null || w.baseOffsetMm === null) continue;
      const axis = w.path.start.z === w.path.end.z ? 0 : 2, across = axis === 0 ? 2 : 0;
      const s = (axis === 0 ? w.path.start.x : w.path.start.z) * 2, e = (axis === 0 ? w.path.end.x : w.path.end.z) * 2, c = (axis === 0 ? w.path.start.z : w.path.start.x) * 2;
      const base = (level.get(w.levelId)!.elevationMm + w.baseOffsetMm) * 2, top = base + w.heightMm * 2, t = w.thicknessMm, mine = aps.filter(a => a.wallId === w.id);
      const r = measure(prims, `wall ${w.id}`, true), L = BigInt(Math.abs(e - s)), H = BigInt(top - base);
      const face = L * H - mine.reduce((n, a) => n + BigInt(a.a[1] - a.a[0]) * BigInt(a.y[1] - a.y[0]), 0n);
      const min: V3 = [0, base, 0], max: V3 = [0, top, 0];
      min[axis] = Math.min(s, e); max[axis] = Math.max(s, e); min[across] = c - t; max[across] = c + t;
      check(sameBox(r.box, min, max), `wall ${w.id}: position, thickness or height differs from source`);
      check(r.six === 6n * BigInt(2 * t) * face, `wall ${w.id}: volume differs (opening or thickness error)`);
      check(r.faceArea.get(`+${across}`) === 2n * face && r.faceArea.get(`-${across}`) === 2n * face, `wall ${w.id}: face area differs from wall minus apertures`);
      const solidAt = (a: number, y: number) => a > Math.min(s, e) && a < Math.max(s, e) && y > base && y < top && !mine.some(h => a >= h.a[0] && a <= h.a[1] && y >= h.y[0] && y <= h.y[1]);
      for (const h of mine) {
        const ac = Math.floor((h.a[0] + h.a[1]) / 2), yc = Math.floor((h.y[0] + h.y[1]) / 2);
        for (const [a, y] of [[ac, yc], [h.a[0] + 2, yc], [h.a[1] - 2, yc], [ac, h.y[0] + 2], [ac, h.y[1] - 2]] as const)
          check(!rayHits(prims, across as 0 | 2, P(axis, a, y, c)), `opening ${h.id}: aperture is filled at (${a / 2}, ${y / 2})`);
        for (const [a, y] of [[h.a[0] - 2, yc], [h.a[1] + 2, yc], [ac, h.y[1] + 2], [ac, h.y[0] - 2]] as const)
          if (solidAt(a, y)) check(rayHits(prims, across as 0 | 2, P(axis, a, y, c)), `opening ${h.id}: wall missing next to the aperture at (${a / 2}, ${y / 2}); width, offset, sill or height differ`);
      }
    }
    for (const h of aps) {
      const op = m.openings.find(x => x.id === h.id)!, role = op.kind === 'door' ? 'door-leaf' : op.kind === 'window' ? 'window-pane' : null;
      if (!role) continue;
      const prims = decoded.get(`${role}:${h.id}`);
      if (!check(!!prims, `opening ${h.id}: placeholder missing`)) continue;
      const r = measure(prims!, `${role} ${h.id}`, true), across = h.axis === 0 ? 2 : 0;
      check(r.box.min[h.axis] === h.a[0] && r.box.max[h.axis] === h.a[1] && r.box.min[1] === h.y[0] && r.box.max[1] === h.y[1]
        && r.box.min[across]! >= h.d[0] && r.box.max[across]! <= h.d[1], `${role} ${h.id}: placeholder does not match its aperture`);
    }
    for (const x of manifest.objects.filter(o => o.geometryRole === 'wall-junction')) {
      const [levelId, xz] = x.sourceEntityId.split('@') as [string, string], [jx, jz] = xz.split(',').map(Number) as [number, number];
      const ending = m.walls.filter(w => w.levelId === levelId && w.thicknessMm !== null && w.heightMm !== null && w.baseOffsetMm !== null
        && [w.path.start, w.path.end].some(p => p.x === jx && p.z === jz));
      const xr = ending.filter(w => w.path.start.z === w.path.end.z), zr = ending.filter(w => w.path.start.x === w.path.end.x);
      const bases = new Set(ending.map(w => `${w.baseOffsetMm}/${w.heightMm}`));
      if (!check(xr.length > 0 && zr.length > 0 && bases.size === 1, `${x.sceneObjectId}: no corner of non-collinear walls with equal height here`)) continue;
      const hx = Math.max(...zr.map(w => w.thicknessMm!)), hz = Math.max(...xr.map(w => w.thicknessMm!)), b = (level.get(levelId)!.elevationMm + ending[0]!.baseOffsetMm!) * 2;
      const r = measure(decoded.get(x.sceneObjectId) ?? [], x.sceneObjectId, true);
      const min: V3 = [jx * 2 - hx, b, jz * 2 - hz], max: V3 = [jx * 2 + hx, b + ending[0]!.heightMm! * 2, jz * 2 + hz];
      check(sameBox(r.box, min, max), `${x.sceneObjectId}: junction fill is not the corner box`);
      check(!aps.some(h => h.levelId === levelId && h.y[0] < max[1] && min[1] < h.y[1] && (h.axis === 0 ? h.a[0] < max[0] && min[0] < h.a[1] && h.d[0] < max[2] && min[2] < h.d[1]
        : h.a[0] < max[2] && min[2] < h.a[1] && h.d[0] < max[0] && min[0] < h.d[1])), `${x.sceneObjectId}: junction fill intrudes into an aperture`);
    }
    for (const s of m.slabs) {
      const prims = decoded.get(`slab:${s.id}`);
      if (!prims) continue;
      const top = (level.get(s.levelId)!.elevationMm + s.topOffsetMm) * 2, r = measure(prims, `slab ${s.id}`, true);
      const xs = s.footprint.outer.map(p => p.x * 2), zs = s.footprint.outer.map(p => p.z * 2);
      check(sameBox(r.box, [Math.min(...xs), top - s.thicknessMm * 2, Math.min(...zs)], [Math.max(...xs), top, Math.max(...zs)]), `slab ${s.id}: footprint or elevation differs from source`);
      const area2 = twiceArea(s.footprint.outer) - s.footprint.voids.reduce((n, v) => n + twiceArea(v), 0n);
      check(r.six === 6n * BigInt(s.thicknessMm * 2) * area2 * 2n, `slab ${s.id}: volume differs (void filled or footprint altered)`);
      const solid = cornerSample(s.footprint.outer);
      check(rayHits(prims, 1, [solid.x, 0, solid.z]), `slab ${s.id}: solid area missing`);
      s.footprint.voids.forEach((v, i) => { const p = cornerSample(v); check(!rayHits(prims, 1, [p.x, 0, p.z]), `slab ${s.id}: void ${i} is filled`); });
    }
    for (const s of m.stairs) {
      const prims = decoded.get(`stair-flight:${s.id}`);
      if (!check(!!prims && prims.length === 2, `stair ${s.id}: flight must have a solid and a final-riser primitive`)) continue;
      const base = level.get(s.fromLevelId)!.elevationMm * 2, n = s.riserHeightsMm.length, cum: number[] = [];
      s.riserHeightsMm.forEach((r, k) => cum.push((k ? cum[k - 1]! : 0) + r * 2));
      const runAxis = s.direction.endsWith('x') ? 0 : 2, widthAxis = runAxis === 0 ? 2 : 0, positive = s.direction.startsWith('+');
      const xs = s.footprint.map(p => p.x * 2), zs = s.footprint.map(p => p.z * 2), lo: V3 = [Math.min(...xs), base, Math.min(...zs)], hi: V3 = [Math.max(...xs), base + cum[n - 2]!, Math.max(...zs)];
      const r = measure([prims![0]!], `stair ${s.id}`, true);
      check(sameBox(r.box, lo, hi), `stair ${s.id}: flight extent differs from footprint and risers`);
      check(r.six === 6n * BigInt(hi[widthAxis]! - lo[widthAxis]!) * BigInt(s.treadDepthMm * 2) * cum.slice(0, n - 1).reduce((a, h) => a + BigInt(h), 0n), `stair ${s.id}: tread/riser profile differs from source`);
      const riser = measure([prims![1]!], `stair ${s.id} final riser`, false), end = positive ? hi[runAxis]! : lo[runAxis]!;
      const rmin: V3 = [...lo], rmax: V3 = [...hi]; rmin[runAxis] = end; rmax[runAxis] = end; rmin[1] = base + cum[n - 2]!; rmax[1] = base + cum[n - 1]!;
      check(prims![1]!.indices.length === 6 && sameBox(riser.box, rmin, rmax) && riser.faceArea.get(`${positive ? '-' : '+'}${runAxis}`) !== undefined, `stair ${s.id}: final riser differs from source`);
      for (const l of s.landings) {
        const lp = decoded.get(`landing:${l.id}`);
        if (!lp) continue;
        const lr = measure(lp, `landing ${l.id}`, false), y = (level.get(s.fromLevelId)!.elevationMm + l.elevationOffsetMm) * 2;
        check(lr.box.min[1] === y && lr.box.max[1] === y && lr.faceArea.get('+1') === twiceArea(l.footprint) * 4n && lr.faceArea.size === 1, `landing ${l.id}: surface differs from source`);
      }
    }

    // Rooms, navigation, cameras.
    const qa = auditBlueprint(m).circulation;
    for (const room of manifest.rooms) {
      const s = m.spaces.find(x => x.id === room.spaceId);
      if (!check(!!s, `room ${room.spaceId} is not a source space`)) continue;
      const lv = level.get(s!.levelId)!, obj = objects.get(room.sceneObjectId);
      check(obj?.geometryRole === 'room-volume' && obj.sourceEntityId === s!.id && room.levelId === s!.levelId && room.floorElevationMm === lv.elevationMm
        && JSON.stringify(room.boundary) === JSON.stringify(s!.boundary.map(p => ({ x: p.x, z: p.z }))), `room ${room.spaceId}: room-to-scene mapping corrupt`);
      check(inside(room.interiorPoint, s!.boundary) && room.interiorPoint.y === lv.elevationMm, `room ${room.spaceId}: interior point not inside the room`);
      check(BigInt(room.areaMm2.split('.')[0]!) * 2n + (room.areaMm2.endsWith('.5') ? 1n : 0n) === twiceArea(s!.boundary), `room ${room.spaceId}: area differs`);
      const prims = decoded.get(room.sceneObjectId);
      if (prims) {
        const r = measure(prims, `room ${room.spaceId}`, true);
        check(r.six === 6n * BigInt(room.heightMm * 2) * twiceArea(s!.boundary) * 2n && r.box.min[1] === lv.elevationMm * 2, `room ${room.spaceId}: helper volume differs`);
      }
    }
    check(manifest.rooms.length === m.spaces.length, 'rooms missing');
    const expected = new Set<string>();
    for (const e of qa.edges) {
      if (e.kind === 'stair') for (const [a, b] of [[`room:${e.from}`, `stair-bottom:${e.via}`], [`stair-bottom:${e.via}`, `stair-top:${e.via}`], [`stair-top:${e.via}`, `room:${e.to}`]]) expected.add(`${a}>${b}>${e.via}>stair`);
      else { expected.add(`room:${e.from}>opening:${e.via}>${e.via}>${e.kind}`); expected.add(`opening:${e.via}>room:${e.to}>${e.via}>${e.kind}`); }
    }
    const navIds = new Set(manifest.navigation.nodes.map(n => n.id));
    check(manifest.navigation.edges.length === expected.size && manifest.navigation.edges.every(e => expected.has(`${e.from}>${e.to}>${e.via}>${e.kind}`) && navIds.has(e.from) && navIds.has(e.to)),
      'navigation edges differ from the Blueprint QA circulation graph');
    const b = manifest.bounds, within = (p: { x: number; y: number; z: number }) => p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;
    const levelIds = new Set(m.levels.map(l => l.id));
    for (const cam of manifest.cameras) {
      check(within(cam.target) && cam.visibleLevelIds.every(id => levelIds.has(id)) && JSON.stringify(cam.position) !== JSON.stringify(cam.target), `camera ${cam.id}: target or levels invalid`);
      if (cam.kind === 'room') {
        const room = manifest.rooms.find(r => r.spaceId === cam.focusSourceEntityId);
        check(!!room && inside(cam.target, m.spaces.find(s => s.id === room.spaceId)!.boundary) && cam.target.y >= room.floorElevationMm && cam.target.y <= room.floorElevationMm + room.heightMm,
          `camera ${cam.id}: target is not inside its room`);
      }
      if (cam.kind === 'floor') check(levelIds.has(cam.focusSourceEntityId ?? ''), `camera ${cam.id}: focus is not a level`);
    }
    check(['overview', 'three-quarter', 'top-down', 'exterior-orbit', 'interior-roof-hidden'].every(id => manifest.cameras.some(c => c.id === id))
      && m.levels.every(l => manifest.cameras.some(c => c.id === `floor:${l.id}`)) && m.spaces.every(s => manifest.cameras.some(c => c.id === `room:${s.id}`)), 'camera presets missing');
    check((json.materials ?? []).every(x => x.extras?.provenance === 'VISUAL_PLACEHOLDER') && (json.materials ?? []).length === manifest.materials.length, 'material provenance invalid');
  } catch (error) {
    if (error instanceof Invalid || error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError') || error instanceof RangeError) check(false, `structure: ${error.message.slice(0, 200)}`);
    else throw error;
  }
  return { validatorVersion: SCENE_VALIDATOR_VERSION, status: failures.length ? 'INVALID' : 'VALID', checks, failures };
}
