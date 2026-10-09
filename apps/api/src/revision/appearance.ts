import { createHash } from 'node:crypto';
import { pointLocation, type BuildingModelV2 } from '@designflow/shared';
import { costHash } from '@designflow/boq-cost';
import type { SceneManifest } from '../scene3d/contracts.js';
import { APPEARANCE_COMPILER_VERSION, APPEARANCE_MANIFEST_VERSION, AppearanceManifestSchema, CLAIMS, FACADES, RevisionError, finishFactors,
  type Appearance, type AppearanceManifest, type Facade, type TargetElement } from './contracts.js';

type Wall = BuildingModelV2['walls'][number];

/** Facing of an exterior wall: the side whose probe (thickness/2 + 1 mm off the centreline) lies outside every space of its level.
 * Compass labels need a known site north that is a multiple of 90° (NORTH_FROM_MINUS_Z_CLOCKWISE_TO_PLUS_X); otherwise null. */
export function wallFacade(model: BuildingModelV2, wall: Wall): Facade | null {
  const north = model.site?.northMilliDegrees;
  if (north === null || north === undefined || north % 90_000 !== 0 || wall.thicknessMm === null) return null;
  const horizontal = wall.path.start.z === wall.path.end.z, rings = model.spaces.filter(s => s.levelId === wall.levelId).map(s => s.boundary.map(p => ({ x: p.x * 2, z: p.z * 2 })));
  const mid = horizontal ? wall.path.start.x + wall.path.end.x : wall.path.start.z + wall.path.end.z, line = (horizontal ? wall.path.start.z : wall.path.start.x) * 2, off = wall.thicknessMm + 2;
  const inside = (sign: 1 | -1) => { const p = horizontal ? { x: mid, z: line + sign * off } : { x: line + sign * off, z: mid }; return rings.some(r => pointLocation(p, r) === 1); };
  const plus = inside(1), minus = inside(-1);
  if (plus === minus) return null;
  // Model bearing (t = 0): -z north, +x east, +z south, -x west; true bearing = model bearing − north.
  const modelBearing = horizontal ? (plus ? 0 : 180) : (plus ? 270 : 90);
  return FACADES[((modelBearing - north / 1000) % 360 + 360) % 360 / 90]!;
}

/** Canonical exterior walls an appearance assignment selects; walls without a modeled construction are not in the scene and are reported as excluded. */
export function selectWalls(model: BuildingModelV2, target: Appearance['assignments'][number]['target']) {
  const all = target.facades.length === FACADES.length, selected: { wall: Wall; facade: Facade | null }[] = [], excluded: { elementId: string; reason: string }[] = [];
  for (const wall of [...model.walls].sort((a, b) => a.id < b.id ? -1 : 1)) {
    if (wall.classification !== 'exterior') continue;
    if (target.levelIds && !target.levelIds.includes(wall.levelId)) continue;
    if (wall.thicknessMm === null || wall.heightMm === null || wall.baseOffsetMm === null) { excluded.push({ elementId: wall.id, reason: 'WALL_CONSTRUCTION_UNSPECIFIED_NOT_IN_SCENE' }); continue; }
    const facade = wallFacade(model, wall);
    if (!all && (facade === null || !target.facades.includes(facade))) { if (facade === null) excluded.push({ elementId: wall.id, reason: 'FACADE_ORIENTATION_UNKNOWN' }); continue; }
    selected.push({ wall, facade });
  }
  return { selected, excluded };
}

/** Scene targets for a whole appearance: later assignments win; a corner fill follows the highest assignment of a targeted wall ending at it. */
export function appearanceTargets(model: BuildingModelV2, scene: SceneManifest, appearance: Appearance): TargetElement[] {
  const byWall = new Map<string, { assignment: number; facade: Facade | null }>();
  appearance.assignments.forEach((a, k) => { for (const { wall, facade } of selectWalls(model, a.target).selected) byWall.set(wall.id, { assignment: k, facade }); });
  const walls = new Map(model.walls.map(w => [w.id, w])), targets: TargetElement[] = [];
  for (const o of scene.objects) {
    if (o.layer !== 'EXTERIOR_SHELL') continue;
    if (o.sourceEntityType === 'wall') {
      const t = byWall.get(o.sourceEntityId);
      if (t) targets.push({ sceneObjectId: o.sceneObjectId, sourceEntityType: 'wall', sourceEntityId: o.sourceEntityId, bimElementId: o.bimElementId, levelId: o.levelId, facade: t.facade, assignment: t.assignment });
    } else if (o.sourceEntityType === 'junction') {
      const [levelId, xz] = o.sourceEntityId.split('@') as [string, string], [x, z] = xz.split(',').map(Number) as [number, number];
      const ks = [...byWall].filter(([wid]) => { const w = walls.get(wid)!; return w.levelId === levelId && [w.path.start, w.path.end].some(p => p.x === x && p.z === z); }).map(([, t]) => t.assignment);
      if (ks.length) targets.push({ sceneObjectId: o.sceneObjectId, sourceEntityType: 'junction', sourceEntityId: o.sourceEntityId, bimElementId: null, levelId: o.levelId, facade: null, assignment: Math.max(...ks) });
    }
  }
  return targets;
}

export function readGlb(glb: Buffer) {
  if (glb.length < 28 || glb.readUInt32LE(0) !== 0x46546c67 || glb.readUInt32LE(4) !== 2 || glb.readUInt32LE(8) !== glb.length) throw new RevisionError('REVISION_VALIDATION_FAILED', 'Base GLB container invalid');
  const jsonLength = glb.readUInt32LE(12), binAt = 20 + jsonLength;
  return { json: JSON.parse(glb.subarray(20, binAt).toString('utf8')) as Record<string, unknown>, bin: glb.subarray(binAt + 8, binAt + 8 + glb.readUInt32LE(binAt)) };
}
function writeGlb(json: unknown, bin: Buffer) {
  const text = Buffer.from(JSON.stringify(json), 'utf8'), jsonChunk = Buffer.alloc((text.length + 3) & ~3, 0x20); text.copy(jsonChunk);
  const total = 28 + jsonChunk.length + bin.length, out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonChunk.length, 12); out.writeUInt32LE(0x4e4f534a, 16); jsonChunk.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + jsonChunk.length); out.writeUInt32LE(0x004e4942, 24 + jsonChunk.length); bin.copy(out, 28 + jsonChunk.length);
  return out;
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Material-only pass over a validated Phase 29 GLB: appends variant materials and re-points target primitives. The BIN chunk (all geometry) is copied verbatim. */
export function applyAppearance(model: BuildingModelV2, scene: SceneManifest, baseGlb: Buffer, appearance: Appearance): { manifest: AppearanceManifest; glb: Buffer } {
  const targets = appearanceTargets(model, scene, appearance);
  if (!targets.length) throw new RevisionError('REVISION_SCOPE_INVALID', 'The appearance selects no scene object');
  const { json, bin } = readGlb(baseGlb), gltf = structuredClone(json) as { materials: object[]; meshes: { name: string; primitives: { material: number }[] }[] };
  const used = [...new Set(targets.map(t => t.assignment))].sort((a, b) => a - b), base = gltf.materials.length;
  const materials = used.map(k => ({ id: `appearance-${k}`, assignment: k, ...finishFactors(appearance.assignments[k]!.finish), alphaMode: 'OPAQUE' as const, provenance: 'APPEARANCE_VARIANT' as const }));
  for (const m of materials) gltf.materials.push({ name: m.id, pbrMetallicRoughness: { baseColorFactor: m.rgbaThousandths.map(c => c / 1000), metallicFactor: m.metallicThousandths / 1000,
    roughnessFactor: m.roughnessThousandths / 1000 }, alphaMode: 'OPAQUE', doubleSided: false, extras: { provenance: 'APPEARANCE_VARIANT', presetId: appearance.assignments[m.assignment]!.finish.presetId } });
  const meshes = new Map(gltf.meshes.map(m => [m.name, m]));
  for (const t of targets) for (const p of meshes.get(t.sceneObjectId)!.primitives) p.material = base + used.indexOf(t.assignment);
  const glb = writeGlb(gltf, Buffer.from(bin));
  const manifest = AppearanceManifestSchema.parse({ version: APPEARANCE_MANIFEST_VERSION, compilerVersion: APPEARANCE_COMPILER_VERSION, source: scene.source, appearance, appearanceHash: costHash(appearance),
    baseScene: { manifestVersion: scene.version, compilerVersion: scene.compilerVersion, inputHash: scene.inputHash, glbSha256: scene.binary.sha256, glbBytes: scene.binary.bytes, binChunkSha256: sha(Buffer.from(bin)) },
    materials, targets, scene, claims: { ...CLAIMS }, binary: { format: 'glb', mimeType: 'model/gltf-binary', sha256: sha(glb), bytes: glb.length } });
  return { manifest, glb };
}
