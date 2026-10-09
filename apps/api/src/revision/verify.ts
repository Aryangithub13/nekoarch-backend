import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { BuildingModelV2 } from '@designflow/shared';
import { costHash } from '@designflow/boq-cost';
import type { SceneManifest, SceneValidation } from '../scene3d/contracts.js';
import { APPEARANCE_VALIDATOR_VERSION, AppearanceManifestSchema, AppearanceSchema, PRESETS, RevisionValidationSchema, type Appearance, type RevisionValidation } from './contracts.js';

/**
 * Independent appearance validator. It never imports the appearance pass: it re-derives targets from the model with its own
 * ray-cast orientation test, parses both GLBs itself, and proves that geometry bytes are identical and only target materials changed.
 */
type G = { asset?: unknown; scene?: unknown; scenes?: unknown; nodes?: unknown; accessors?: unknown; bufferViews?: unknown; buffers?: unknown;
  materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; metallicFactor?: number; roughnessFactor?: number }; alphaMode?: string; extras?: { provenance?: string } }[];
  meshes?: { name?: string; primitives?: { material?: number }[] }[] };

function parse(glb: Buffer): { json: G; bin: Buffer } | null {
  if (glb.length < 28 || glb.readUInt32LE(0) !== 0x46546c67 || glb.readUInt32LE(4) !== 2 || glb.readUInt32LE(8) !== glb.length) return null;
  const jl = glb.readUInt32LE(12);
  if (glb.readUInt32LE(16) !== 0x4e4f534a || 28 + jl > glb.length) return null;
  const at = 20 + jl;
  if (glb.readUInt32LE(at + 4) !== 0x004e4942 || at + 8 + glb.readUInt32LE(at) !== glb.length) return null;
  try { return { json: JSON.parse(glb.subarray(20, at).toString('utf8')) as G, bin: glb.subarray(at + 8) }; } catch { return null; }
}
/** Even-odd ray cast on doubled integer coordinates (strictly inside; boundary counts as outside). */
function strictlyInside(px: number, pz: number, ring: { x: number; z: number }[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.z === b.z && a.z === pz && px >= Math.min(a.x, b.x) && px <= Math.max(a.x, b.x)) || (a.x === b.x && a.x === px && pz >= Math.min(a.z, b.z) && pz <= Math.max(a.z, b.z))) return false;
    if ((a.z > pz) !== (b.z > pz) && px < a.x + (pz - a.z) * (b.x - a.x) / (b.z - a.z)) inside = !inside;
  }
  return inside;
}
const COMPASS = ['NORTH', 'EAST', 'SOUTH', 'WEST'] as const;
function facing(model: BuildingModelV2, w: BuildingModelV2['walls'][number]) {
  const north = model.site?.northMilliDegrees;
  if (north == null || north % 90_000 || w.thicknessMm == null) return null;
  const rings = model.spaces.filter(s => s.levelId === w.levelId).map(s => s.boundary.map(p => ({ x: 2 * p.x, z: 2 * p.z })));
  const alongX = w.path.start.z === w.path.end.z, m = alongX ? w.path.start.x + w.path.end.x : w.path.start.z + w.path.end.z, c = 2 * (alongX ? w.path.start.z : w.path.start.x), d = w.thicknessMm + 2;
  const probe = (s: number) => rings.some(r => alongX ? strictlyInside(m, c + s * d, r) : strictlyInside(c + s * d, m, r));
  const pos = probe(1), neg = probe(-1);
  if (pos === neg) return null;
  // Outward direction as a model-frame compass index (0 = -z), then rotate by site north.
  const outward = alongX ? (pos ? 0 : 2) : (pos ? 3 : 1);
  return COMPASS[(outward - north / 90_000 + 8) % 4]!;
}
function expectedTargets(model: BuildingModelV2, scene: SceneManifest, appearance: Appearance) {
  const wallTarget = new Map<string, number>();
  appearance.assignments.forEach((a, k) => {
    for (const w of model.walls) {
      if (w.classification !== 'exterior' || w.thicknessMm == null || w.heightMm == null || w.baseOffsetMm == null) continue;
      if (a.target.levelIds && !a.target.levelIds.includes(w.levelId)) continue;
      if (a.target.facades.length < 4) { const f = facing(model, w); if (!f || !a.target.facades.includes(f)) continue; }
      wallTarget.set(w.id, k);
    }
  });
  const expected = new Map<string, number>();
  for (const o of scene.objects) {
    if (o.layer !== 'EXTERIOR_SHELL') continue;
    if (o.sourceEntityType === 'wall' && wallTarget.has(o.sourceEntityId)) expected.set(o.sceneObjectId, wallTarget.get(o.sourceEntityId)!);
    if (o.sourceEntityType === 'junction') {
      const at = o.sourceEntityId.lastIndexOf('@'), level = o.sourceEntityId.slice(0, at), [x, z] = o.sourceEntityId.slice(at + 1).split(',').map(Number);
      let best = -1;
      for (const [wid, k] of wallTarget) { const w = model.walls.find(v => v.id === wid)!; if (w.levelId === level && ((w.path.start.x === x && w.path.start.z === z) || (w.path.end.x === x && w.path.end.z === z))) best = Math.max(best, k); }
      if (best >= 0) expected.set(o.sceneObjectId, best);
    }
  }
  return expected;
}

export function verifyAppearance(model: BuildingModelV2, base: { manifest: SceneManifest; glb: Buffer; validation: SceneValidation }, candidate: { manifest: unknown; glb: Buffer }, appearanceInput: unknown): RevisionValidation {
  const failures: string[] = []; let checks = 0;
  const check = (ok: boolean, message: string) => { checks++; if (!ok && failures.length < 50) failures.push(message); return ok; };
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const b = parse(base.glb), c = parse(candidate.glb), baseBin = b ? sha(b.bin) : sha(Buffer.alloc(0));
  const result = (changed = 0, preserved = 0) => RevisionValidationSchema.parse({ validatorVersion: APPEARANCE_VALIDATOR_VERSION, status: failures.length ? 'INVALID' : 'VALID', checks, failures,
    baseSceneValidation: { status: base.validation.status, checks: base.validation.checks }, geometryLock: { granularity: 'EXACT_BYTES', baseBinSha256: baseBin, candidateBinSha256: c ? sha(c.bin) : null,
      identical: !!(b && c && Buffer.compare(b.bin, c.bin) === 0) }, changedObjects: changed, preservedObjects: preserved });
  check(base.validation.status === 'VALID', 'base scene is not independently valid (Phase 29 validator)');
  const ap = AppearanceSchema.safeParse(appearanceInput), man = AppearanceManifestSchema.safeParse(candidate.manifest);
  if (!check(!!b && !!c, 'GLB container invalid') || !check(ap.success, 'appearance invalid') || !check(man.success, 'candidate manifest schema invalid')) return result();
  const m = man.data!, appearance = ap.data!, bj = b!.json, cj = c!.json;
  // Bindings, hashes and the unchanged base scene.
  check(isDeepStrictEqual(m.scene, base.manifest), 'embedded base scene manifest differs from the validated base');
  check(isDeepStrictEqual(m.source, base.manifest.source), 'candidate source binding differs from the base revision binding');
  check(m.baseScene.glbSha256 === sha(base.glb) && m.baseScene.glbSha256 === base.manifest.binary.sha256 && m.baseScene.inputHash === base.manifest.inputHash, 'base scene reference mismatch');
  check(m.baseScene.binChunkSha256 === baseBin, 'base BIN chunk hash mismatch');
  check(isDeepStrictEqual(m.appearance, appearance) && m.appearanceHash === costHash(appearance), 'appearance or appearance hash mismatch');
  check(m.binary.sha256 === sha(candidate.glb) && m.binary.bytes === candidate.glb.length, 'candidate binary hash mismatch');
  // Exact-byte geometry lock and identical non-material structure.
  check(Buffer.compare(b!.bin, c!.bin) === 0, 'geometry BIN chunk changed');
  for (const key of ['asset', 'scene', 'scenes', 'nodes', 'accessors', 'bufferViews', 'buffers'] as const) check(isDeepStrictEqual(bj[key], cj[key]), `glTF ${key} changed`);
  const strip = (g: G) => (g.meshes ?? []).map(x => ({ name: x.name, primitives: (x.primitives ?? []).map(({ material: _m, ...rest }) => rest) }));
  check(isDeepStrictEqual(strip(bj), strip(cj)), 'mesh structure changed');
  // Materials: base prefix untouched; appended variants exactly as the appearance defines.
  const bm = bj.materials ?? [], cm = cj.materials ?? [];
  check(isDeepStrictEqual(cm.slice(0, bm.length), bm), 'base materials changed');
  const appended = cm.slice(bm.length);
  check(appended.length === m.materials.length, 'variant material count mismatch');
  appended.forEach((x, i) => {
    const decl = m.materials[i], f = decl ? appearance.assignments[decl.assignment]?.finish : undefined, p = f ? PRESETS[f.presetId] : undefined;
    const rgb = f?.rgbThousandths ?? p?.rgb, rough = f?.roughnessThousandths ?? p?.roughness, metal = f?.metallicThousandths ?? p?.metallic;
    check(!!decl && !!f && x.extras?.provenance === 'APPEARANCE_VARIANT' && x.alphaMode === 'OPAQUE' && isDeepStrictEqual(x.pbrMetallicRoughness?.baseColorFactor, [...rgb!, 1000].map(v => v / 1000))
      && x.pbrMetallicRoughness?.roughnessFactor === rough! / 1000 && x.pbrMetallicRoughness?.metallicFactor === metal! / 1000
      && isDeepStrictEqual(decl.rgbaThousandths, [...rgb!, 1000]) && decl.roughnessThousandths === rough && decl.metallicThousandths === metal, `variant material ${i} does not match its finish`);
  });
  // Changed objects = independently derived targets, each on its assignment's material.
  const expected = expectedTargets(model, base.manifest, appearance), byName = new Map((cj.meshes ?? []).map((x, i) => [x.name, i]));
  check(expected.size > 0, 'appearance selects no object');
  check(isDeepStrictEqual(m.targets.map(t => [t.sceneObjectId, t.assignment]).sort(), [...expected].sort()), 'declared targets differ from the independently derived targets');
  const objects = new Map(base.manifest.objects.map(o => [o.sceneObjectId, o]));
  check(m.targets.every(t => { const o = objects.get(t.sceneObjectId);
    return !!o && o.sourceEntityType === t.sourceEntityType && o.sourceEntityId === t.sourceEntityId && o.bimElementId === t.bimElementId && o.levelId === t.levelId; }),
  'declared target identities (source, BIM, level) differ from the base scene objects');
  let changed = 0, preserved = 0;
  (bj.meshes ?? []).forEach((mesh, i) => {
    const after = cj.meshes?.[i], k = expected.get(mesh.name!), moved = (mesh.primitives ?? []).some((p, j) => p.material !== after?.primitives?.[j]?.material);
    if (k === undefined) { preserved++; check(!moved, `protected object ${mesh.name} material changed`); return; }
    changed++;
    const want = bm.length + m.materials.findIndex(x => x.assignment === k);
    check(byName.get(mesh.name) === i && (after?.primitives ?? []).every(p => p.material === want) && want >= bm.length, `target ${mesh.name} not on its variant material`);
  });
  return result(changed, preserved);
}
