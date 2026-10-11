import { GLB_GENERATOR, LAYERS, MATERIALS, SCENE_COMPILER_VERSION, type SceneManifest } from './contracts.js';
import type { CompiledObject } from './compile.js';

const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963, FLOAT = 5126, UNSIGNED_SHORT = 5123, UNSIGNED_INT = 5125;
const pad4 = (n: number) => (n + 3) & ~3;

/**
 * Deterministic glTF 2.0 GLB: root (translation = origin, metres) → level → layer → object nodes; one mesh per object.
 * Positions are float32 metres relative to the origin; key order and array order are fixed by construction.
 */
export function writeGlb(manifest: Omit<SceneManifest, 'binary'>, objects: CompiledObject[]): Buffer {
  const o = manifest.frame.originMm, chunks: Buffer[] = [];
  let offset = 0;
  const bufferViews: object[] = [], accessors: object[] = [], meshes: object[] = [], nodes: object[] = [];
  const view = (bytes: Buffer, target: number) => {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    const padded = Buffer.alloc(pad4(bytes.length)); bytes.copy(padded); chunks.push(padded); offset += padded.length;
    return bufferViews.length - 1;
  };
  const used = MATERIALS.filter(m => manifest.materials.some(x => x.id === m.id)), materialIndex = new Map<string, number>(used.map((m, i) => [m.id, i]));
  for (const object of objects) {
    const primitives = object.primitives.map(p => {
      const count = p.positions.length / 3, pos = new Float32Array(p.positions.length), nrm = new Float32Array(p.normals);
      for (let i = 0; i < p.positions.length; i++) pos[i] = (p.positions[i]! / 2 - (i % 3 === 0 ? o.x : i % 3 === 1 ? o.y : o.z)) / 1000;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.length; i++) { min[i % 3] = Math.min(min[i % 3]!, pos[i]!); max[i % 3] = Math.max(max[i % 3]!, pos[i]!); }
      const wide = count > 65535, idx = wide ? new Uint32Array(p.indices) : new Uint16Array(p.indices);
      accessors.push({ bufferView: view(Buffer.from(pos.buffer), ARRAY_BUFFER), componentType: FLOAT, count, type: 'VEC3', min, max });
      const position = accessors.length - 1;
      accessors.push({ bufferView: view(Buffer.from(nrm.buffer), ARRAY_BUFFER), componentType: FLOAT, count, type: 'VEC3' });
      const normal = accessors.length - 1;
      accessors.push({ bufferView: view(Buffer.from(idx.buffer), ELEMENT_ARRAY_BUFFER), componentType: wide ? UNSIGNED_INT : UNSIGNED_SHORT, count: p.indices.length, type: 'SCALAR' });
      return { attributes: { POSITION: position, NORMAL: normal }, indices: accessors.length - 1, material: materialIndex.get(p.material)!, mode: 4 };
    });
    meshes.push({ name: object.meta.sceneObjectId, primitives });
  }
  // Node graph.
  nodes.push({ name: 'scene-root', translation: [o.x / 1000, o.y / 1000, o.z / 1000], children: [] as number[],
    extras: { compilerVersion: SCENE_COMPILER_VERSION, sourceRevisionId: manifest.source.revisionId, modelHash: manifest.source.modelHash, units: 'm', manifestUnits: 'mm' } });
  const rootChildren = (nodes[0] as { children: number[] }).children;
  for (const level of manifest.levels) {
    const levelNode = nodes.push({ name: level.nodeName, children: [] as number[], extras: { levelId: level.levelId, bimElementId: level.bimElementId, elevationMm: level.elevationMm } }) - 1;
    rootChildren.push(levelNode);
    for (const layer of LAYERS) {
      const members = objects.map((x, i) => [x, i] as const).filter(([x]) => x.meta.levelId === level.levelId && x.meta.layer === layer);
      if (!members.length) continue;
      const layerNode = nodes.push({ name: `layer:${level.levelId}:${layer}`, children: [] as number[], extras: { layer, levelId: level.levelId } }) - 1;
      (nodes[levelNode] as { children: number[] }).children.push(layerNode);
      for (const [x, mesh] of members) {
        const m = x.meta;
        const node = nodes.push({ name: m.sceneObjectId, mesh, extras: { sceneObjectId: m.sceneObjectId, sourceRevisionId: manifest.source.revisionId, sourceEntityType: m.sourceEntityType,
          sourceEntityId: m.sourceEntityId, bimElementId: m.bimElementId, modelHash: manifest.source.modelHash, sceneCompilerVersion: SCENE_COMPILER_VERSION,
          geometryRole: m.geometryRole, layer: m.layer, levelId: m.levelId, fidelity: m.fidelity } }) - 1;
        (nodes[layerNode] as { children: number[] }).children.push(node);
      }
    }
  }
  const json = {
    asset: { version: '2.0', generator: GLB_GENERATOR, extras: { compilerVersion: SCENE_COMPILER_VERSION, manifestVersion: manifest.version } },
    scene: 0, scenes: [{ name: 'architecture', nodes: [0] }], nodes,
    materials: used.map(m => ({ name: m.id, pbrMetallicRoughness: { baseColorFactor: m.rgba.map(c => c / 1000), metallicFactor: 0, roughnessFactor: m.roughness / 1000 },
      alphaMode: m.alphaMode, doubleSided: false, extras: { provenance: 'VISUAL_PLACEHOLDER' } })),
    meshes, accessors, bufferViews, buffers: [{ byteLength: offset }],
  };
  const text = Buffer.from(JSON.stringify(json), 'utf8'), jsonChunk = Buffer.alloc(pad4(text.length), 0x20); text.copy(jsonChunk);
  const bin = Buffer.concat(chunks), total = 12 + 8 + jsonChunk.length + 8 + bin.length, out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonChunk.length, 12); out.writeUInt32LE(0x4e4f534a, 16); jsonChunk.copy(out, 20);
  const binAt = 20 + jsonChunk.length;
  out.writeUInt32LE(bin.length, binAt); out.writeUInt32LE(0x004e4942, binAt + 4); bin.copy(out, binAt + 8);
  return out;
}
