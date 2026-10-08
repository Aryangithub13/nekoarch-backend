import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import validator from 'gltf-validator';
import { NodeIO } from '@gltf-transform/core';
import { auditBlueprint } from '@designflow/blueprint-qa';
import type { BuildingModelV2 } from '@designflow/shared';
import { PROJECT_ID, bindingFor, compiled, crossCompiled, editPositions, repack, sceneModels, translated } from '../../../test-support/scene-fixtures.js';
import { compileScene, interiorPoint } from '../src/scene3d/compile.js';
import { validateScene } from '../src/scene3d/validate.js';
import { runSceneJob } from '../src/scene3d/job.js';
import { projectBim } from '../src/bim/project.js';
import { LAYERS, SCENE_LIMITS, SceneError, SceneManifestSchema, VALIDATOR_TOLERANCE_NM, float32ErrorBoundNm, type SceneManifest } from '../src/scene3d/contracts.js';

type Compiled = ReturnType<typeof compiled>;
const models = sceneModels();
const scenes = {} as Record<keyof typeof models, Compiled>;
const refusal = (fn: () => unknown) => { try { fn(); } catch (error) { return error as SceneError; } throw new Error('expected refusal'); };
const object = (s: Compiled, id: string) => s.manifest.objects.find(o => o.sceneObjectId === id)!;
const valid = (model: BuildingModelV2, x: { manifest: SceneManifest; glb: Buffer }, binding = bindingFor(model)) => validateScene(model, binding, x.manifest, x.glb);
const glbJson = (glb: Buffer) => JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
const shuffled = (m: BuildingModelV2): BuildingModelV2 => {
  const rev = <T>(a: T[]) => [...a].reverse();
  return { ...m, levels: rev(m.levels), spaces: rev(m.spaces), walls: rev(m.walls), openings: rev(m.openings), slabs: rev(m.slabs), stairs: rev(m.stairs), specifications: rev(m.specifications) };
};

beforeAll(() => { for (const k of Object.keys(models) as (keyof typeof models)[]) scenes[k] = compiled(models[k]); });

describe('Phase 29 scene compiler — geometry fidelity', () => {
  it('compiles every supported fixture to a scene the independent validator accepts', () => {
    for (const k of Object.keys(models) as (keyof typeof models)[]) expect(valid(models[k], scenes[k]), k).toMatchObject({ status: 'VALID', failures: [] });
  });

  it('places every wall at its centerline, thickness, height and base offset (one-storey, L, two-storey)', () => {
    for (const k of ['single', 'L', 'setback'] as const) for (const w of models[k].walls) {
      const b = object(scenes[k], `wall:${w.id}`).bounds, el = models[k].levels.find(l => l.id === w.levelId)!.elevationMm, half = w.thicknessMm! / 2;
      const along = w.path.start.z === w.path.end.z;
      expect(b.min.y).toBe(el + w.baseOffsetMm!); expect(b.max.y).toBe(el + w.baseOffsetMm! + w.heightMm!);
      if (along) { expect([b.min.x, b.max.x]).toEqual([Math.min(w.path.start.x, w.path.end.x), Math.max(w.path.start.x, w.path.end.x)]); expect([b.min.z, b.max.z]).toEqual([w.path.start.z - half, w.path.start.z + half]); }
      else { expect([b.min.z, b.max.z]).toEqual([Math.min(w.path.start.z, w.path.end.z), Math.max(w.path.start.z, w.path.end.z)]); expect([b.min.x, b.max.x]).toEqual([w.path.start.x - half, w.path.start.x + half]); }
      expect(object(scenes[k], `wall:${w.id}`).layer).toBe(w.classification === 'exterior' ? 'EXTERIOR_SHELL' : 'INTERIOR_WALLS');
    }
  });

  it('cuts real door and window apertures: a wrong width or sill is rejected at the exact opening', () => {
    const { setback } = models, door = setback.openings.find(o => o.kind === 'door')!, window = setback.openings.find(o => o.kind === 'window')!;
    const wider = structuredClone(setback); wider.openings.find(o => o.id === door.id)!.widthMm -= 100;
    const failures = valid(setback, crossCompiled(setback, wider), bindingFor(setback)).failures;
    expect(failures.some(f => f.includes(`opening ${door.id}: aperture is filled`))).toBe(true);
    expect(failures.some(f => f.includes(`wall ${door.wallId}: volume differs`))).toBe(true);
    const raised = structuredClone(setback); raised.openings.find(o => o.id === window.id)!.sillMm += 50;
    const sill = valid(setback, crossCompiled(setback, raised), bindingFor(setback)).failures;
    expect(sill.some(f => f.includes(`opening ${window.id}`))).toBe(true);
    expect(sill.some(f => f.includes(`window-pane ${window.id}: placeholder does not match`))).toBe(true);
  });

  it('detects altered wall thickness and shifted floor elevation in the binary', () => {
    const { setback } = models, s = scenes.setback, wall = setback.walls.find(w => w.thicknessMm === 200 && w.path.start.z === w.path.end.z)!;
    const thick = editPositions(s.manifest, s.glb, `wall:${wall.id}`, p => { p.z += p.z > wall.path.start.z ? 20 : -20; });
    expect(valid(setback, thick).failures).toContain(`wall ${wall.id}: position, thickness or height differs from source`);
    const floor = setback.slabs.find(x => x.kind === 'floor' && x.levelId === 'level-1')!;
    const shifted = editPositions(s.manifest, s.glb, `slab:${floor.id}`, p => { p.y += 50; });
    expect(valid(setback, shifted).failures.some(f => f.startsWith(`slab ${floor.id}: footprint or elevation`))).toBe(true);
  });

  it('keeps slab voids open, stair flights exact and lower exposed roofs as their own plates', () => {
    const { setback } = models, s = scenes.setback;
    const voided = setback.slabs.find(x => x.footprint.voids.length)!, flight = setback.stairs[0]!;
    expect(s.manifest.coverage.find(c => c.entityType === 'void')).toMatchObject({ status: 'FULL_GEOMETRY', reason: 'PRESERVED_AS_HOLE_IN_SLAB' });
    // The void covers the flight footprint, and the flight rises exactly by the risers up to the final riser onto the upper floor.
    const v = voided.footprint.voids[0]!, f = object(s, `stair-flight:${flight.id}`).bounds;
    expect([Math.min(...v.map(p => p.x)), Math.max(...v.map(p => p.x))]).toEqual([f.min.x, f.max.x]);
    // Object bounds span the stepped solid plus the final-riser primitive, i.e. the full rise.
    expect(f.max.y - f.min.y).toBe(flight.riserHeightsMm.reduce((a, b) => a + b, 0));
    expect(object(s, `stair-flight:${flight.id}`).primitives).toBe(2);
    for (const l of flight.landings) expect(object(s, `landing:${l.id}`).bounds.min.y).toBe(l.elevationOffsetMm);
    const roofs = s.manifest.objects.filter(o => o.layer === 'ROOFS');
    expect(roofs).toHaveLength(setback.slabs.filter(x => x.kind === 'flat-roof').length);
    expect(roofs.filter(o => o.levelId === 'level-0').every(o => o.bounds.max.y === 3000)).toBe(true);
    // Filling the void in the binary is caught.
    const vmin = Math.min(...v.map(q => q.x)), vmax = Math.max(...v.map(q => q.x));
    const g = editPositions(s.manifest, s.glb, `slab:${voided.id}`, p => { if (p.x === vmax) p.x = vmin; });
    expect(valid(setback, g).failures).toContain(`slab ${voided.id}: void 0 is filled`);
  });

  it('reports every source entity in coverage and never silently omits one', () => {
    const { setback } = models, c = scenes.setback.manifest.coverage;
    expect(c.filter(x => x.entityType === 'wall')).toHaveLength(setback.walls.length);
    expect(c.filter(x => x.entityType === 'opening')).toHaveLength(setback.openings.length);
    expect(c.filter(x => x.entityType === 'space').every(x => x.status === 'SEMANTIC_ONLY')).toBe(true);
    const dropped: SceneManifest = { ...scenes.setback.manifest, coverage: c.filter(x => x.entityType !== 'stair') };
    expect(validateScene(setback, bindingFor(setback), dropped, scenes.setback.glb).failures).toContain(`stair ${setback.stairs[0]!.id} missing from coverage`);
  });

  it('fills butt-end corner notches only with recorded visual placeholders that never intrude into apertures', () => {
    const fills = scenes.single.manifest.objects.filter(o => o.geometryRole === 'wall-junction');
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every(o => o.fidelity === 'VISUAL_PLACEHOLDER' && o.bimElementId === null && o.note?.includes('not a quantity'))).toBe(true);
  });

  it('round-trips far-from-origin buildings on the 0.5 mm grid (float32 precision budget)', () => {
    const far = translated(models.setback, 400_000, -250_000), s = compiled(far);
    expect(valid(far, s).status).toBe('VALID');
    expect(s.manifest.frame.originMm.x).toBeGreaterThan(400_000);
    expect(s.manifest.precision.maxFloat32ErrorNm).toBeLessThanOrEqual(s.manifest.precision.validatorToleranceNm);
    // The extent limit itself keeps the worst-case float32 error inside the validator tolerance, far below the 0.25 mm half-grid.
    expect(float32ErrorBoundNm(SCENE_LIMITS.extentMm)).toBeLessThanOrEqual(VALIDATOR_TOLERANCE_NM);
    expect(VALIDATOR_TOLERANCE_NM).toBeLessThan(250_000);
    // Junction ids embed plan coordinates, so only their sort order may change; geometry per object is identical.
    const ids = (list: SceneManifest['objects'], move = false) => list.map(o => `${move ? o.sceneObjectId.replace(/@(\d+),(-?\d+)$/, (_, x, z) => `@${+x + 400_000},${+z - 250_000}`) : o.sceneObjectId}/${o.triangles}`).sort();
    expect(ids(s.manifest.objects)).toEqual(ids(scenes.setback.manifest.objects, true));
  });

  it('computes room interior points strictly inside concave rooms', () => {
    const L = [{ x: 0, z: 0 }, { x: 6000, z: 0 }, { x: 6000, z: 2000 }, { x: 2000, z: 2000 }, { x: 2000, z: 6000 }, { x: 0, z: 6000 }];
    const p = interiorPoint(L);
    expect(p.x > 0 && p.z > 0 && (p.x < 2000 || p.z < 2000)).toBe(true);
  });
});

describe('Phase 29 scene compiler — semantics, navigation, cameras', () => {
  it('builds root → level → layer → object nodes with traceable source and BIM identities', () => {
    const { setback } = models, json = glbJson(scenes.setback.glb), root = json.nodes[0];
    expect(root.children.map((i: number) => json.nodes[i].name)).toEqual(['level:level-0', 'level:level-1']);
    const bim = new Map(projectBim(setback, { ...bindingFor(setback), generationId: null, requirementsHash: null }).elements.map(e => [`${e.source.collection}:${e.source.id}`, e.id]));
    for (const w of setback.walls) expect(object(scenes.setback, `wall:${w.id}`).bimElementId).toBe(bim.get(`walls:${w.id}`));
    const node = json.nodes.find((n: { name: string }) => n.name === `wall:${setback.walls[0]!.id}`);
    expect(node.extras).toMatchObject({ sourceEntityType: 'wall', sourceEntityId: setback.walls[0]!.id, sourceRevisionId: bindingFor(setback).revisionId, modelHash: bindingFor(setback).modelHash });
    expect(scenes.setback.manifest.levels.map(l => [l.levelId, l.elevationMm, l.bimElementId !== null])).toEqual([['level-0', 0, true], ['level-1', 3000, true]]);
    expect(scenes.setback.manifest.layers.map(l => l.id)).toEqual([...LAYERS]);
    expect(scenes.setback.manifest.layers.filter(l => !l.visibleByDefault).map(l => l.id)).toEqual(['ROOM_VOLUMES', 'SEMANTIC_HELPERS']);
  });

  it('rejects dropped source ids, corrupted room mapping and broken camera targets', () => {
    const { setback } = models, s = scenes.setback;
    const noId = repack(s.manifest, s.glb, json => { delete json.nodes.find((n: { mesh?: number }) => n.mesh !== undefined).extras.sourceEntityId; });
    expect(valid(setback, noId).failures.some(f => f.endsWith('node semantics differ from manifest'))).toBe(true);
    const rooms = structuredClone(s.manifest); [rooms.rooms[0]!.sceneObjectId, rooms.rooms[1]!.sceneObjectId] = [rooms.rooms[1]!.sceneObjectId, rooms.rooms[0]!.sceneObjectId];
    expect(validateScene(setback, bindingFor(setback), rooms, s.glb).failures.some(f => f.includes('room-to-scene mapping corrupt'))).toBe(true);
    const cams = structuredClone(s.manifest), room = cams.cameras.find(c => c.kind === 'room')!; room.target.x = cams.bounds.max.x + 5000;
    expect(validateScene(setback, bindingFor(setback), cams, s.glb).failures.some(f => f.startsWith(`camera ${room.id}`))).toBe(true);
  });

  it('derives navigation only from validated Blueprint QA circulation edges and claims no egress or accessibility', () => {
    const { setback } = models, nav = scenes.setback.manifest.navigation, qa = auditBlueprint(setback).circulation.edges;
    expect(nav.edges).toHaveLength(qa.reduce((n, e) => n + (e.kind === 'stair' ? 3 : 2), 0));
    expect(nav.edges.filter(e => e.kind === 'stair')).toHaveLength(3);
    expect(nav.claims).toEqual({ egress: 'NOT_CLAIMED', accessibility: 'NOT_CLAIMED', collisionFreePath: 'NOT_CLAIMED' });
    const forged = structuredClone(scenes.setback.manifest); forged.navigation.edges.push({ ...forged.navigation.edges[0]!, via: 'invented-door' });
    expect(validateScene(setback, bindingFor(setback), forged, scenes.setback.glb).failures).toContain('navigation edges differ from the Blueprint QA circulation graph');
  });

  it('exposes overview, three-quarter, top-down, orbit, roof-hidden, per-floor and per-room cameras', () => {
    const { setback } = models, ids = scenes.setback.manifest.cameras.map(c => c.id);
    expect(ids.slice(0, 5)).toEqual(['overview', 'three-quarter', 'top-down', 'exterior-orbit', 'interior-roof-hidden']);
    for (const l of setback.levels) expect(ids).toContain(`floor:${l.id}`);
    for (const s of setback.spaces) expect(ids).toContain(`room:${s.id}`);
    expect(scenes.setback.manifest.cameras.find(c => c.id === 'interior-roof-hidden')!.hiddenLayers).toContain('ROOFS');
  });

  it('labels every appearance a visual placeholder and every engineering overlay NOT_EVALUATED', () => {
    const m = scenes.setback.manifest;
    expect(m.materials.every(x => x.provenance === 'VISUAL_PLACEHOLDER')).toBe(true);
    expect(m.objects.filter(o => o.geometryRole === 'door-leaf' || o.geometryRole === 'window-pane').every(o => o.fidelity === 'VISUAL_PLACEHOLDER')).toBe(true);
    expect(m.overlays.map(o => [o.kind, o.status])).toEqual([['structural', 'NOT_EVALUATED'], ['environmental', 'NOT_EVALUATED'], ['systems', 'NOT_EVALUATED'], ['knowledge', 'NOT_EVALUATED']]);
    expect(Object.values(m.claims).every(v => v === 'NOT_CLAIMED')).toBe(true);
    const relabelled = structuredClone(m); relabelled.objects.find(o => o.geometryRole === 'door-leaf')!.fidelity = 'FULL_GEOMETRY';
    expect(validateScene(models.setback, bindingFor(models.setback), relabelled, scenes.setback.glb).status).toBe('INVALID');
  });
});

describe('Phase 29 GLB export — interoperability, identity, determinism', () => {
  it('passes the Khronos glTF validator with no errors or warnings', async () => {
    for (const k of Object.keys(models) as (keyof typeof models)[]) {
      const report = await validator.validateBytes(new Uint8Array(scenes[k].glb), { maxIssues: 20 });
      expect([k, report.issues.numErrors, report.issues.numWarnings], JSON.stringify(report.issues.messages)).toEqual([k, 0, 0]);
    }
  });

  it('parses with an independent glTF implementation into the manifest scene in metres', async () => {
    const doc = await new NodeIO().readBinary(new Uint8Array(scenes.setback.glb)), root = doc.getRoot();
    expect(root.listMeshes()).toHaveLength(scenes.setback.manifest.statistics.meshes);
    expect(root.listNodes()).toHaveLength(scenes.setback.manifest.statistics.nodes);
    const origin = scenes.setback.manifest.frame.originMm, top = root.listNodes()[0]!;
    expect(top.getTranslation()).toEqual([origin.x / 1000, origin.y / 1000, origin.z / 1000]);
    const wall = models.setback.walls[0]!, node = root.listNodes().find(n => n.getName() === `wall:${wall.id}`)!;
    const pos = node.getMesh()!.listPrimitives()[0]!.getAttribute('POSITION')!;
    const ys = Array.from({ length: pos.getCount() }, (_, i) => pos.getElement(i, [0, 0, 0])[1]!);
    expect(Math.max(...ys)).toBeCloseTo(2.85, 6);
  });

  it('is byte-identical across repeated compiles and source array order', () => {
    const again = compiled(models.setback), reordered = compileScene(shuffled(models.setback), bindingFor(models.setback));
    expect(Buffer.compare(again.glb, scenes.setback.glb)).toBe(0);
    expect(Buffer.compare(reordered.glb, scenes.setback.glb)).toBe(0);
    expect(JSON.stringify(reordered.manifest)).toBe(JSON.stringify(scenes.setback.manifest));
    expect(reordered.sceneHash).toBe(again.sceneHash);
  });

  it('binds manifest, binary and source: forged hashes, scale and model identity are rejected', () => {
    const { setback } = models, s = scenes.setback;
    const flipped = Buffer.from(s.glb); flipped.writeUInt8(flipped.readUInt8(flipped.length - 64) ^ 0x10, flipped.length - 64);
    expect(validateScene(setback, bindingFor(setback), s.manifest, flipped).failures).toContain('binary SHA-256/length differs from manifest');
    const forgedHash = { ...s.manifest, source: { ...s.manifest.source, modelHash: 'f'.repeat(64) } };
    expect(validateScene(setback, { ...bindingFor(setback), modelHash: 'f'.repeat(64) }, forgedHash, s.glb).failures).toContain('modelHash does not match the source model');
    const scaled = repack(s.manifest, s.glb, json => { json.nodes[0].scale = [1.001, 1.001, 1.001]; });
    expect(valid(setback, scaled).status).toBe('INVALID');
    const metres = editPositions(s.manifest, s.glb, `wall:${setback.walls[0]!.id}`, p => { p.x *= 1.0005; });
    expect(valid(setback, metres).status).toBe('INVALID');
    expect(s.manifest.binary.sha256).toBe(createHash('sha256').update(s.glb).digest('hex'));
    expect(SceneManifestSchema.parse(s.manifest).source.projectId).toBe(PROJECT_ID);
  });

  it('rejects reversed winding, corrupted indices and malformed containers without throwing', () => {
    const { setback } = models, s = scenes.setback;
    const reversed = repack(s.manifest, s.glb, (json, bin) => {
      const a = json.accessors[json.meshes[0].primitives[0].indices], v = json.bufferViews[a.bufferView];
      for (let i = 0; i < a.count; i += 3) { const at = v.byteOffset + (i + 1) * 2, x = bin.readUInt16LE(at); bin.writeUInt16LE(bin.readUInt16LE(at + 2), at); bin.writeUInt16LE(x, at + 2); }
    });
    expect(valid(setback, reversed).failures.some(f => f.includes('winding or normal reversed') || f.includes('inside out'))).toBe(true);
    const badIndex = repack(s.manifest, s.glb, (json, bin) => { const a = json.accessors[json.meshes[1].primitives[0].indices]; bin.writeUInt16LE(60000, json.bufferViews[a.bufferView].byteOffset); });
    expect(valid(setback, badIndex).failures.some(f => f.endsWith('index out of range'))).toBe(true);
    const cycle = repack(s.manifest, s.glb, json => { json.nodes[1].children.push(0); });
    expect(valid(setback, cycle).failures.some(f => f.startsWith('node graph invalid'))).toBe(true);
    const truncated = Buffer.from(s.glb.subarray(0, 100));
    expect(validateScene(setback, bindingFor(setback), s.manifest, truncated).status).toBe('INVALID');
    const garbage = Buffer.from('glTF but not really a binary container at all');
    expect(validateScene(setback, bindingFor(setback), { ...s.manifest, binary: { ...s.manifest.binary, bytes: garbage.length, sha256: createHash('sha256').update(garbage).digest('hex') } }, garbage).status).toBe('INVALID');
  });
});

describe('Phase 29 scene compiler — bounded refusals', () => {
  it('refuses unsupported models, mismatched bindings and non-empty inputs with typed codes', () => {
    const { setback } = models;
    const column = structuredClone(setback);
    column.columns.push({ id: 'column-x', levelId: 'level-0', crossSection: { outer: [{ x: 5000, z: 5000 }, { x: 5300, z: 5000 }, { x: 5300, z: 5300 }, { x: 5000, z: 5300 }], voids: [] }, baseOffsetMm: 0, heightMm: 2850 });
    expect(refusal(() => compiled(column)).code).toBe('SCENE_UNSUPPORTED_MODEL');
    expect(refusal(() => compileScene(setback, { ...bindingFor(setback), modelHash: 'a'.repeat(64) })).code).toBe('SCENE_SOURCE_MISMATCH');
    expect(refusal(() => compileScene(setback, bindingFor(setback), { lod: 2 })).code).toBe('SCENE_INPUT_INVALID');
    expect(refusal(() => compileScene({ schemaVersion: 2 }, bindingFor(setback))).code).toBe('SCENE_INVALID_SOURCE');
  });

  it('enforces object, triangle, vertex, byte, extent and navigation budgets', () => {
    const { setback } = models, b = bindingFor(setback), limits = { ...SCENE_LIMITS };
    for (const [key, value] of [['objects', 10], ['triangles', 500], ['vertices', 1000], ['glbBytes', 10_000], ['manifestBytes', 10_000], ['extentMm', 1000], ['navigationNodes', 2]] as const)
      expect(refusal(() => compileScene(setback, b, {}, { ...limits, [key]: value })).code, key).toBe('SCENE_RESOURCE_LIMIT');
    expect(refusal(() => compileScene(setback, b, {}, { ...limits, triangles: 10 })).message).toContain('before tessellation');
  });

  it('keeps the validator independent of the compiler, mesh builder and GLB writer', () => {
    const imports = readFileSync(new URL('../src/scene3d/validate.ts', import.meta.url), 'utf8').match(/from '[^']+'/g) ?? [];
    expect(imports.filter(i => /\.\/(compile|mesh|gltf|job|pool|worker)\.js'/.test(i))).toEqual([]);
  });

  it('never returns a scene the independent validator rejects', () => {
    const { setback } = models;
    const broken: typeof compileScene = (...args) => { const r = compileScene(...args); return { ...r, glb: Buffer.from(r.glb.subarray(0, r.glb.length - 4)) }; };
    const error = refusal(() => runSceneJob({ model: setback, binding: bindingFor(setback) }, {}, broken));
    expect(error.code).toBe('SCENE_VALIDATION_FAILED');
    expect(runSceneJob({ model: setback, binding: bindingFor(setback) }, {}).validation.status).toBe('VALID');
  });
});
