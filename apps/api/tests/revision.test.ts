import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BuildingModelV2 } from '@designflow/shared';
import { costHash } from '@designflow/boq-cost';
import { bindingFor, sceneModels } from '../../../test-support/scene-fixtures.js';
import { compileScene } from '../src/scene3d/compile.js';
import { validateScene } from '../src/scene3d/validate.js';
import { interpretRevision } from '../src/revision/interpret.js';
import { buildIntent, planRevision, type PlanContext } from '../src/revision/plan.js';
import { applyAppearance, readGlb, wallFacade } from '../src/revision/appearance.js';
import { verifyAppearance } from '../src/revision/verify.js';
import { runAppearanceJob } from '../src/revision/job.js';
import { APPEARANCE_VERSION, FACADES, type Appearance } from '../src/revision/contracts.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const models = sceneModels();
const all = (presetId: Appearance['assignments'][number]['finish']['presetId'] = 'glass-inspired-blue-grey'): Appearance =>
  ({ version: APPEARANCE_VERSION, assignments: [{ target: { kind: 'EXTERIOR_WALLS', facades: [...FACADES], levelIds: null }, finish: { presetId } }] });
function base(model: BuildingModelV2) { const r = compileScene(model, bindingFor(model)); return { manifest: r.manifest, glb: r.glb, validation: validateScene(model, bindingFor(model), r.manifest, r.glb) }; }
function repack(glb: Buffer, edit: (json: Json, bin: Buffer) => void) {
  const { json, bin } = readGlb(glb), j = structuredClone(json) as Json, b = Buffer.from(bin);
  edit(j, b);
  const text = Buffer.from(JSON.stringify(j)), chunk = Buffer.alloc((text.length + 3) & ~3, 0x20); text.copy(chunk);
  const out = Buffer.alloc(28 + chunk.length + b.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8); out.writeUInt32LE(chunk.length, 12); out.writeUInt32LE(0x4e4f534a, 16); chunk.copy(out, 20);
  out.writeUInt32LE(b.length, 20 + chunk.length); out.writeUInt32LE(0x004e4942, 24 + chunk.length); b.copy(out, 28 + chunk.length);
  return out;
}

describe('Phase 30 revision intent (deterministic grammar)', () => {
  const L = [{ id: 'level:0', index: 0 }, { id: 'level:1', index: 1 }];
  it.each([
    ['Redesign the exterior of my building using a contemporary glass-inspired façade. Keep the exact floor plans, internal rooms, stairs, structure, building dimensions, and existing interior unchanged.',
      'APPEARANCE_MODIFY', ['EXTERIOR_APPEARANCE'], ['FLOOR_PLANS', 'ROOMS', 'STAIRS', 'STRUCTURE', 'INTERIOR', 'BUILDING_DIMENSIONS'], 0],
    ['Make the exterior walls darker.', 'APPEARANCE_MODIFY', ['EXTERIOR_APPEARANCE'], [], 0],
    ['Use a warmer finish in the living room.', null, ['INTERIOR_APPEARANCE'], [], 0],
    ['Add more windows but don\'t change any openings.', null, ['OPENING_GEOMETRY'], ['OPENINGS'], 0],
    ['Make the living room bigger without changing any walls.', null, ['ROOM_GEOMETRY'], ['WALLS'], 0],
    ['Change the tower structure but preserve all structural members.', null, ['STRUCTURE'], ['STRUCTURE'], 0],
    ['Give it a glass facade', null, ['PHYSICAL_GLAZING'], [], 1],
    ['Generate an alternative façade color scheme.', null, ['EXTERIOR_APPEARANCE'], [], 1],
    ['Restore revision 1', 'RESTORE', ['RESTORE'], [], 0],
    ['Keep everything on the first floor', null, [], [], 2],
    ['hello', null, [], [], 1],
  ] as const)('%s', (text, operation, changes, keep, ambiguities) => {
    const i = interpretRevision(text, L);
    expect([i.operation, i.requestedChanges.map(c => c.changeClass), i.preservation.map(p => p.scope), i.ambiguities.length]).toEqual([operation, changes, keep, ambiguities]);
  });
  it('maps façades and finishes only from recognised words and never invents a storey', () => {
    expect(interpretRevision('Use a warm render on the north and east facades', L).appearance).toEqual({ target: { kind: 'EXTERIOR_WALLS', facades: ['NORTH', 'EAST'], levelIds: null }, finish: { presetId: 'warm-render' } });
    expect(interpretRevision('Use a light stone exterior finish but do not modify the ground floor', L).preservation).toEqual([{ scope: 'LEVEL', levelId: 'level:0', phrase: expect.any(String) }]);
    expect(interpretRevision('Paint the exterior dark, keep level 7 unchanged', L).ambiguities.length).toBe(1);
  });
});

describe('Phase 30 façade orientation and appearance targets', () => {
  it('labels bounding-box façades by the site north convention and rotates with north', () => {
    const m = models.single, ext = m.walls.filter(w => w.classification === 'exterior');
    const xs = ext.flatMap(w => [w.path.start.x, w.path.end.x]), zs = ext.flatMap(w => [w.path.start.z, w.path.end.z]);
    const edge = (w: typeof ext[number]) => w.path.start.z === w.path.end.z ? (w.path.start.z === Math.min(...zs) ? 'NORTH' : w.path.start.z === Math.max(...zs) ? 'SOUTH' : null)
      : (w.path.start.x === Math.min(...xs) ? 'WEST' : w.path.start.x === Math.max(...xs) ? 'EAST' : null);
    const onEdge = ext.filter(w => edge(w));
    expect(onEdge.length).toBeGreaterThan(3);
    for (const w of onEdge) expect(wallFacade(m, w), w.id).toBe(edge(w));
    const rotated = { ...m, site: { ...m.site!, northMilliDegrees: 90_000 } }, turn: Record<string, string> = { NORTH: 'WEST', EAST: 'NORTH', SOUTH: 'EAST', WEST: 'SOUTH' };
    for (const w of onEdge) expect(wallFacade(rotated, w)).toBe(turn[edge(w)!]);
    expect(wallFacade({ ...m, site: { ...m.site!, northMilliDegrees: 45_000 } }, onEdge[0]!)).toBeNull();
    expect(wallFacade({ ...m, site: null }, onEdge[0]!)).toBeNull();
  });
  it.each(Object.keys(models))('%s: applies a finish to exactly the exterior shell targets, validated independently with an exact-byte geometry lock', name => {
    const m = models[name as keyof typeof models], b = base(m), app = all();
    const c = applyAppearance(m, b.manifest, b.glb, app), v = verifyAppearance(m, b, c, app);
    expect(v).toMatchObject({ status: 'VALID', failures: [], geometryLock: { identical: true }, baseSceneValidation: { status: 'VALID' } });
    expect(new Set(c.manifest.targets.map(t => t.sceneObjectId))).toEqual(new Set(b.manifest.objects.filter(o => o.layer === 'EXTERIOR_SHELL').map(o => o.sceneObjectId)));
    expect(v.changedObjects + v.preservedObjects).toBe(b.manifest.objects.length);
    expect(sha(c.glb)).not.toBe(sha(b.glb));
    expect(Buffer.compare(readGlb(c.glb).bin, readGlb(b.glb).bin)).toBe(0);
    // Deterministic identity: the same base and appearance produce the same bytes.
    expect(sha(applyAppearance(m, b.manifest, b.glb, app).glb)).toBe(sha(c.glb));
  });
  it('cumulative assignments: later wins, façade-specific targets stay on their façade', () => {
    const m = models.setback, b = base(m);
    const app: Appearance = { version: APPEARANCE_VERSION, assignments: [all().assignments[0]!, { target: { kind: 'EXTERIOR_WALLS', facades: ['SOUTH'], levelIds: null }, finish: { presetId: 'warm-render' } }] };
    const c = applyAppearance(m, b.manifest, b.glb, app);
    expect(verifyAppearance(m, b, c, app).status).toBe('VALID');
    expect(c.manifest.targets.filter(t => t.sourceEntityType === 'wall' && t.assignment === 1).every(t => t.facade === 'SOUTH')).toBe(true);
    expect(c.manifest.targets.filter(t => t.sourceEntityType === 'wall' && t.facade === 'SOUTH').every(t => t.assignment === 1)).toBe(true);
    expect(c.manifest.materials.map(x => x.assignment)).toEqual([0, 1]);
  });
});

describe('Phase 30 independent appearance validator: each defect is caught by its own check', () => {
  // The two-storey setback fixture has walls, doors, rooms and a stair, so every defect class has a real target.
  const m = models.setback, b = base(m), app = all(), good = applyAppearance(m, b.manifest, b.glb, app);
  const json = readGlb(good.glb).json as Json, meshIndex = (name: string) => json.meshes.findIndex((x: Json) => x.name === name);
  const positionOffset = (meshName: string) => { const p = json.meshes[meshIndex(meshName)].primitives[0], a = json.accessors[p.attributes.POSITION]; return json.bufferViews[a.bufferView].byteOffset as number; };
  const rehash = (glb: Buffer, manifest: Json = good.manifest) => ({ glb, manifest: { ...manifest, binary: { ...manifest.binary, sha256: sha(glb), bytes: glb.length } } });
  const fail = (candidate: { glb: Buffer; manifest: unknown }, appearance: unknown = app) => verifyAppearance(m, b, candidate, appearance).failures.join(' | ');
  const name = (prefix: string) => b.manifest.objects.find(o => o.sceneObjectId.startsWith(prefix))!.sceneObjectId;
  const moveBytes = (meshName: string) => rehash(repack(good.glb, (_j, bin) => { const at = positionOffset(meshName); bin.writeFloatLE(bin.readFloatLE(at) + 0.25, at); }));
  const onSlab = (glb: Buffer) => repack(glb, j => { j.meshes[meshIndex(name('slab:'))].primitives[0].material = j.materials.length - 1; });
  it.each([
    ['protected wall moved', () => moveBytes(name('wall:')), 'geometry BIN chunk changed'],
    ['room boundary modified', () => moveBytes(name('room-volume:')), 'geometry BIN chunk changed'],
    ['door opening widened (door leaf geometry)', () => moveBytes(name('door-leaf:')), 'geometry BIN chunk changed'],
    ['stair height changed', () => moveBytes(name('stair-flight:')), 'geometry BIN chunk changed'],
    ['manifest room boundary edited', () => rehash(good.glb, { ...good.manifest, scene: { ...good.manifest.scene, rooms: good.manifest.scene.rooms.map((r, i) => i ? r : { ...r, boundary: r.boundary.map(p => ({ ...p, x: p.x + 1 })) }) } }), 'embedded base scene manifest differs'],
    ['BIM element id swapped on a target', () => { const walls = good.manifest.targets.filter(t => t.bimElementId); const [x, y] = walls as [typeof walls[0], typeof walls[0]];
      return rehash(good.glb, { ...good.manifest, targets: good.manifest.targets.map(t => t === x ? { ...t, bimElementId: y.bimElementId } : t) }); }, 'declared target identities'],
    ['material override applied to a protected object', () => rehash(onSlab(good.glb)), 'protected object'],
    ['target left on its placeholder material', () => rehash(repack(good.glb, j => { j.meshes[meshIndex(good.manifest.targets[0]!.sceneObjectId)].primitives[0].material = 0; })), 'not on its variant material'],
    ['variant colour differs from the finish', () => rehash(repack(good.glb, j => { j.materials[j.materials.length - 1].pbrMetallicRoughness.baseColorFactor[0] = 0.9; })), 'does not match its finish'],
    ['incorrect candidate binding (other revision)', () => rehash(good.glb, { ...good.manifest, source: { ...good.manifest.source, revisionId: '33333333-3333-4333-8333-333333333333' } }), 'source binding'],
    ['node transform changed', () => rehash(repack(good.glb, j => { j.nodes[0].translation = [1, 0, 0]; })), 'glTF nodes changed'],
    ['tampered candidate bytes', () => ({ glb: good.glb, manifest: { ...good.manifest, binary: { ...good.manifest.binary, sha256: 'f'.repeat(64) } } }), 'candidate binary hash mismatch'],
  ] as const)('%s', (_label, make, message) => {
    expect(fail(make() as { glb: Buffer; manifest: unknown })).toContain(message);
  });
  it('appearance swapped after compile is detected', () => { expect(fail(good, all('warm-render'))).toContain('appearance or appearance hash mismatch'); });
  it('the unmodified candidate is VALID (positive control) and the base must itself be independently valid', () => {
    expect(fail(good)).toBe('');
    expect(verifyAppearance(m, { ...b, validation: { ...b.validation, status: 'INVALID' } }, good, app).failures[0]).toMatch(/base scene is not independently valid/);
  });
  it('the worker job refuses an apply pass that touches a protected object (the validator cannot be bypassed in-process)', () => {
    const rogue: typeof applyAppearance = (...args) => { const c = applyAppearance(...args), glb = onSlab(c.glb); return { glb, manifest: { ...c.manifest, binary: { ...c.manifest.binary, sha256: sha(glb), bytes: glb.length } } }; };
    expect(() => runAppearanceJob({ model: m, binding: bindingFor(m) }, app, rogue)).toThrow(/Independent appearance validation rejected/);
  });
});

describe('Phase 30 validator independence', () => {
  it('the validator is independent: it imports neither the appearance pass, the job, nor the Phase 29 compiler or GLB writer', () => {
    const imports = [...readFileSync(new URL('../src/revision/verify.ts', import.meta.url), 'utf8').matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
    expect(imports.filter(i => /appearance|job|scene3d\/(compile|gltf|mesh)/.test(i!))).toEqual([]);
  });
});

describe('Phase 30 planner (no compile, deterministic)', () => {
  const m = models.setback, rev = { id: '22222222-2222-4222-8222-222222222222', revisionNumber: 1, parentRevisionId: null, model: m, generatorVersion: null };
  const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({ projectId: '11111111-1111-4111-8111-111111111111', base: rev, baseAppearance: null, baseOutputs: [], source: null, ...over });
  const plan = (text: string, c = ctx()) => planRevision(c, buildIntent({ text }, c.base, [{ id: rev.id, revisionNumber: 1 }]));
  it('produces an approvable appearance preflight with system locks, source-equivalent impacts and a zero external quote', () => {
    const takeoff = '44444444-4444-4444-8444-444444444444';
    const p = plan('Make the exterior walls darker.', ctx({ baseOutputs: [{ output: 'QUANTITY_TAKEOFF', artifacts: [{ id: takeoff }] }] }));
    expect(p).toMatchObject({ status: 'AWAITING_CONSENT', kind: 'APPEARANCE_MODIFY', quote: { externalCostUsd: 0, dataTransfer: 'NONE', execution: 'LOCAL_DETERMINISTIC' } });
    expect(p.impacts.find(i => i.artifact === 'QUANTITY_TAKEOFF')).toMatchObject({ action: 'REUSE_SOURCE_EQUIVALENT', baseArtifactIds: [takeoff] });
    expect(p.appearanceHash).toBe(costHash(p.appearance));
    expect(JSON.stringify(p)).not.toMatch(/\d\.\d/); // integers only: the SQL hash recomputation is exact
  });
  it.each([
    ['Make larger windows while keeping the openings unchanged.', 'BLOCKED_BY_LOCK', 'LOCK_CONFLICT'],
    ['Widen the doors.', 'UNSUPPORTED', 'GEOMETRY_MODIFICATION_NOT_SUPPORTED'],
    ['Paint the exterior dark but keep the exterior appearance the same.', 'BLOCKED_BY_LOCK', 'LOCK_CONFLICT'],
    ['Use a warmer finish in the bedroom.', 'UNSUPPORTED', 'INTERIOR_FINISH_NOT_SUPPORTED'],
  ] as const)('%s → %s', (text, status, code) => {
    const p = plan(text);
    expect([p.status, p.blockers[0]?.code, p.targets.length]).toEqual([status, code, 0]);
  });
  it('excludes locked storeys, refuses façade-specific edits without a known north, and refuses visual no-ops', () => {
    const two = models.setback, r2 = { ...rev, model: two }, c2 = ctx({ base: r2 });
    const ground = [...two.levels].sort((a, b) => a.index - b.index)[0]!.id;
    const locked = planRevision(c2, buildIntent({ text: 'Make the exterior walls darker but do not modify the ground floor.' }, r2, []));
    expect([locked.status, locked.excluded.some(e => e.elementId === ground), locked.targets.every(t => t.levelId !== ground)]).toEqual(['AWAITING_CONSENT', true, true]);
    const noNorth = { ...rev, model: { ...m, site: null } };
    expect(planRevision(ctx({ base: noNorth }), buildIntent({ text: 'Use a warm render on the south facade.' }, noNorth, [])).status).toBe('NEEDS_CLARIFICATION');
    const p = plan('Make the exterior walls darker.');
    expect(plan('Make the exterior walls darker.', ctx({ baseAppearance: p.appearance })).questions.join()).toMatch(/already have this finish/);
  });
});

describe('Phase 30 compatibility (Scenario 14)', () => {
  it.each(['single', 'L', 'setback', 'maximum'])('%s: the Phase 29 compiler output is byte-identical to the frozen Phase 29 release evidence', name => {
    const frozen = readFileSync(new URL(`../../../docs/phase29/evidence/fixtures/${name}.glb`, import.meta.url));
    expect(sha(compileScene(models[name as keyof typeof models], bindingFor(models[name as keyof typeof models])).glb)).toBe(sha(frozen));
  });
});
