import { createHash } from 'node:crypto';
import { costHash } from '@designflow/boq-cost';
import { generateBlueprintV2, generateParametricBlueprint } from '@designflow/generator';
import type { BuildingModelV2 } from '@designflow/shared';
import { parametricInput } from './parametric-fixtures.js';
import { solverInput } from './solver-v2-fixtures.js';
import { modelHash } from '../apps/api/src/lib/generation-identity.js';
import { compileScene } from '../apps/api/src/scene3d/compile.js';
import type { SceneBinding, SceneManifest } from '../apps/api/src/scene3d/contracts.js';

export const PROJECT_ID = '11111111-1111-4111-8111-111111111111', REVISION_ID = '22222222-2222-4222-8222-222222222222';

/** The released Phase 23 fixture family: one-storey solver plan, L, two-storey setback with stair and void, maximum 24 rooms. */
export function sceneModels(): Record<'single' | 'L' | 'setback' | 'maximum', BuildingModelV2> {
  const maximum = parametricInput();
  maximum.site.boundary = [{ x: 0, z: 0 }, { x: 60000, z: 0 }, { x: 60000, z: 60000 }, { x: 0, z: 60000 }];
  Object.assign(maximum.parametricArchitecture.floors[0]!, { widthMm: 55000, depthMm: 55000, westWingWidthMm: 27000, southWingDepthMm: 27000 });
  maximum.rooms = [{ type: 'bedroom', count: 24 }];
  return { single: generateBlueprintV2(solverInput()).model, L: generateParametricBlueprint(parametricInput()).model,
    setback: generateParametricBlueprint(parametricInput(true)).model, maximum: generateParametricBlueprint(maximum).model };
}
export const bindingFor = (model: BuildingModelV2, revisionId = REVISION_ID): SceneBinding => ({ projectId: PROJECT_ID, revisionId, modelHash: modelHash(model),
  generatorVersion: model.provenance.generatorVersion ?? null, parameterHash: model.parametricArchitecture ? costHash(model.parametricArchitecture) : null });
export const compiled = (model: BuildingModelV2) => compileScene(model, bindingFor(model));

/** What a buggy compiler would emit: the scene of `defect`, claiming to be the scene of `source` (binding and hashes rewritten consistently). */
export function crossCompiled(source: BuildingModelV2, defect: BuildingModelV2) {
  const { manifest, glb } = compiled(defect), binding = bindingFor(source);
  const forged: SceneManifest = { ...manifest, source: binding, inputHash: costHash({ compilerVersion: manifest.compilerVersion, manifestVersion: manifest.version, source: binding }) };
  const packed = repack(forged, glb, json => { for (const node of json.nodes) if (node.extras?.modelHash) node.extras.modelHash = binding.modelHash; });
  return { binding, ...packed };
}

/** Edit one object's decoded positions (model millimetres) in place, keeping accessor min/max consistent, then re-pack and re-hash. */
export function editPositions(manifest: SceneManifest, glb: Buffer, sceneObjectId: string, edit: (p: { x: number; y: number; z: number }) => void) {
  const o = manifest.frame.originMm;
  return repack(manifest, glb, (json, bin) => {
    const node = json.nodes.find((n: { name?: string }) => n.name === sceneObjectId);
    for (const prim of json.meshes[node.mesh].primitives) {
      const accessor = json.accessors[prim.attributes.POSITION], view = json.bufferViews[accessor.bufferView], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < accessor.count; i++) {
        const at = view.byteOffset + i * 12, grid = (v: number) => Math.round(v * 2) / 2;
        const p = { x: grid(bin.readFloatLE(at) * 1000 + o.x), y: grid(bin.readFloatLE(at + 4) * 1000 + o.y), z: grid(bin.readFloatLE(at + 8) * 1000 + o.z) };
        edit(p);
        [(p.x - o.x) / 1000, (p.y - o.y) / 1000, (p.z - o.z) / 1000].forEach((v, k) => { bin.writeFloatLE(v, at + k * 4); const f = bin.readFloatLE(at + k * 4); min[k] = Math.min(min[k]!, f); max[k] = Math.max(max[k]!, f); });
      }
      accessor.min = min; accessor.max = max;
    }
  });
}

/** Re-pack a GLB after editing its JSON and/or BIN chunk, and re-hash it into the manifest (a forger who also updates checksums). */
export function repack(manifest: SceneManifest, glb: Buffer, edit: (json: Record<string, any>, bin: Buffer) => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const jsonLength = glb.readUInt32LE(12), json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')), bin = Buffer.from(glb.subarray(20 + jsonLength + 8));
  edit(json, bin);
  const text = Buffer.from(JSON.stringify(json)), jsonChunk = Buffer.alloc((text.length + 3) & ~3, 0x20); text.copy(jsonChunk);
  const total = 12 + 8 + jsonChunk.length + 8 + bin.length, out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8); out.writeUInt32LE(jsonChunk.length, 12); out.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(out, 20); out.writeUInt32LE(bin.length, 20 + jsonChunk.length); out.writeUInt32LE(0x004e4942, 24 + jsonChunk.length); bin.copy(out, 28 + jsonChunk.length);
  return { manifest: { ...manifest, binary: { ...manifest.binary, sha256: createHash('sha256').update(out).digest('hex'), bytes: out.length } }, glb: out };
}

/** Translate every plan point (objects with numeric x and z) by (dx, dz): a far-from-origin building with identical architecture. */
export function translated<T>(value: T, dx: number, dz: number): T {
  if (Array.isArray(value)) return value.map(v => translated(v, dx, dz)) as T;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, translated(v, dx, dz)]);
    const o = Object.fromEntries(entries) as Record<string, unknown>;
    if (typeof o.x === 'number' && typeof o.z === 'number') { o.x += dx; o.z += dz; }
    return o as T;
  }
  return value;
}
