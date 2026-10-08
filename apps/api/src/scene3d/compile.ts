import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { integerSqrt, openingSpaceIds, pointLocation, polygonAreaMm2, type BuildingModelV2, type Point2Mm } from '@designflow/shared';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { costHash } from '@designflow/boq-cost';
import { modelHash } from '../lib/generation-identity.js';
import { BimError } from '../bim/contracts.js';
import { sourceModel } from '../bim/core.js';
import { projectBim } from '../bim/project.js';
import { CLAIMS, HIDDEN_BY_DEFAULT, LAYERS, MATERIALS, OVERLAYS, SCENE_COMPILER_VERSION, SCENE_LIMITS, SCENE_MANIFEST_VERSION, SceneBindingSchema, SceneError, SceneManifestSchema,
  SceneInputSchema, VALIDATOR_TOLERANCE_NM, float32ErrorBoundNm, type Layer, type SceneBinding, type SceneManifest, type SceneObject } from './contracts.js';
import { box, breaks, capGrid, extrudeGrid, gridTriangleBound, primitive, rect, type Axis, type Primitive } from './mesh.js';
import { writeGlb } from './gltf.js';

/** A compiled object: manifest metadata plus its primitives (half-millimetre coordinates). */
export interface CompiledObject { meta: Omit<SceneObject, 'bounds' | 'primitives' | 'triangles' | 'vertices'>; primitives: Primitive[] }
type Coverage = SceneManifest['coverage'][number];
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const EYE_HEIGHT_MM = 1600, DOOR_LEAF_MM = 40, WINDOW_PANE_MM = 10;
export const LIMITATIONS = [
  'Supported input is the Phase 23 bounded orthogonal profile: at most two storeys, one straight stair, no columns.',
  'Wall solids are butt-ended prisms (model convention); corner notches are closed by VISUAL_PLACEHOLDER junction fills that are not quantities.',
  'Door leaves and window panes are generic VISUAL_PLACEHOLDER components; no product, glazing, thermal or fire property is asserted.',
  'Stair undersides are a mass fill to the source level because the soffit is not modeled; landings are walking surfaces without modeled thickness.',
  'Colours are VISUAL_PLACEHOLDER appearance only; specification labels are reported as given, never as performance.',
  'Navigation edges are Blueprint QA circulation facts; they are not egress, accessibility or collision-free path claims.',
  'Engineering overlays (structural, environmental, systems, knowledge) are NOT_EVALUATED in scene V1.',
  'The scene is not photorealistic rendering and does not assert construction readiness.',
];

function mapBimError(error: unknown): never {
  if (error instanceof BimError) {
    const code = error.code === 'BIM_UNSUPPORTED_MODEL' ? 'SCENE_UNSUPPORTED_MODEL' : error.code === 'BIM_RESOURCE_LIMIT' ? 'SCENE_RESOURCE_LIMIT'
      : error.code === 'BIM_SOURCE_MISMATCH' ? 'SCENE_SOURCE_MISMATCH' : 'SCENE_INVALID_SOURCE';
    throw new SceneError(code, error.message);
  }
  throw error;
}

/** Profile gate + binding: the scene accepts exactly what the released BIM projection accepts. */
export function sceneSource(raw: unknown, binding: SceneBinding) {
  const b = SceneBindingSchema.parse(binding);
  let model: BuildingModelV2, bim: ReturnType<typeof projectBim>;
  try {
    model = sourceModel(raw);
    if (modelHash(raw as BuildingModelV2) !== b.modelHash || (model.parametricArchitecture ? costHash(model.parametricArchitecture) : null) !== b.parameterHash)
      throw new SceneError('SCENE_SOURCE_MISMATCH', 'Source revision hash mismatch');
    bim = projectBim(raw, { ...b, generationId: null, requirementsHash: null });
  } catch (error) { if (error instanceof SceneError) throw error; mapBimError(error); }
  return { model, bim, binding: b };
}

export const sceneInputHash = (source: SceneBinding) => costHash({ compilerVersion: SCENE_COMPILER_VERSION, manifestVersion: SCENE_MANIFEST_VERSION, source });

/** Largest cell of a ring's orthogonal grid (ties: first in x then z order); its centre is strictly inside. */
export function interiorPoint(ring: Point2Mm[]): Point2Mm {
  const xs = breaks(ring.map(p => p.x)), zs = breaks(ring.map(p => p.z)), doubled = ring.map(p => ({ x: p.x * 2, z: p.z * 2 }));
  let best: { area: number; x: number; z: number } | null = null;
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    if (pointLocation({ x: xs[i]! + xs[i + 1]!, z: zs[j]! + zs[j + 1]! }, doubled) !== 1) continue;
    const area = (xs[i + 1]! - xs[i]!) * (zs[j + 1]! - zs[j]!);
    if (!best || area > best.area) best = { area, x: Math.floor((xs[i]! + xs[i + 1]!) / 2), z: Math.floor((zs[j]! + zs[j + 1]!) / 2) };
  }
  if (!best) throw new SceneError('SCENE_INVALID_SOURCE', 'Ring has no interior cell');
  return { x: best.x, z: best.z };
}

/** Grid over an orthogonal footprint in half-mm: cell inside the outer ring and outside every void. */
function footprintGrid(outer: Point2Mm[], voids: Point2Mm[][]) {
  const xs = breaks([outer, ...voids].flat().map(p => p.x * 2)), zs = breaks([outer, ...voids].flat().map(p => p.z * 2));
  const scale = (ring: Point2Mm[]) => ring.map(p => ({ x: p.x * 4, z: p.z * 4 })), o = scale(outer), vs = voids.map(scale);
  const inside = (i: number, j: number) => {
    const c = { x: xs[i]! + xs[i + 1]!, z: zs[j]! + zs[j + 1]! };
    return pointLocation(c, o) === 1 && vs.every(v => pointLocation(c, v) === -1);
  };
  return { xs, zs, inside };
}

export type SceneLimits = { -readonly [K in keyof typeof SCENE_LIMITS]: number };

export function compileScene(raw: unknown, binding: SceneBinding, input: unknown = {}, limits: SceneLimits = SCENE_LIMITS) {
  if (!SceneInputSchema.safeParse(input).success) throw new SceneError('SCENE_INPUT_INVALID', 'Scene compile input must be an empty object in V1');
  // Diagnostics only: timings never enter the manifest, the GLB or any hash.
  const started = performance.now();
  const { model: m, bim, binding: source } = sceneSource(raw, binding);
  const sourced = performance.now();
  const bimId = new Map(bim.elements.map(e => [`${e.source.collection}:${e.source.id}`, e.id]));
  const levels = [...m.levels].sort((a, b) => a.index - b.index), level = new Map(levels.map(l => [l.id, l]));
  const objects: CompiledObject[] = [], coverage: Coverage[] = [];
  const spec = (id?: string) => { const s = id ? m.specifications.find(x => x.id === id) : undefined;
    return s ? { id: s.id, name: s.name, material: s.material ?? null, status: 'ARCHITECTURAL_FACT' as const } : null; };
  const add = (meta: CompiledObject['meta'], primitives: Primitive[]) => { objects.push({ meta, primitives }); return meta.sceneObjectId; };

  // Pre-tessellation bound: refuse before allocating meshes.
  let bound = 0;
  for (const w of m.walls) {
    const ops = m.openings.filter(o => o.wallId === w.id);
    bound += gridTriangleBound(2 + 2 * ops.length, 2 + 2 * ops.length) + ops.length * 12;
  }
  for (const s of m.slabs) bound += gridTriangleBound(1 + [s.footprint.outer, ...s.footprint.voids].flat().length, 1 + [s.footprint.outer, ...s.footprint.voids].flat().length);
  for (const s of m.spaces) bound += gridTriangleBound(s.boundary.length + 1, s.boundary.length + 1);
  for (const s of m.stairs) bound += gridTriangleBound(s.riserHeightsMm.length + 1, s.riserHeightsMm.length + 1) + s.landings.length * 512;
  if (bound > limits.triangles * 4) throw new SceneError('SCENE_RESOURCE_LIMIT', 'Scene geometry budget exceeded before tessellation', { bound: String(bound) });

  // Walls with real apertures.
  type Aperture = { id: string; levelId: string; a: [number, number]; y: [number, number]; d: [number, number]; axis: Axis };
  const apertures: Aperture[] = [];
  const wallInfo = new Map<string, { axis: Axis; across: Axis; c: number; base: number; top: number; t: number }>();
  for (const w of [...m.walls].sort((p, q) => compare(p.id, q.id))) {
    const lv = level.get(w.levelId)!, ops = m.openings.filter(o => o.wallId === w.id).sort((p, q) => compare(p.id, q.id));
    if (w.thicknessMm === null || w.heightMm === null || w.baseOffsetMm === null) {
      coverage.push({ entityType: 'wall', entityId: w.id, status: 'SEMANTIC_ONLY', reason: 'WALL_CONSTRUCTION_UNSPECIFIED', sceneObjectIds: [] });
      for (const o of ops) coverage.push({ entityType: 'opening', entityId: o.id, status: 'NOT_EVALUATED', reason: 'HOST_WALL_CONSTRUCTION_UNSPECIFIED', sceneObjectIds: [] });
      continue;
    }
    const axis: Axis = w.path.start.z === w.path.end.z ? 0 : 2, across: Axis = axis === 0 ? 2 : 0;
    const key = (p: Point2Mm) => axis === 0 ? p.x : p.z, s = key(w.path.start) * 2, e = key(w.path.end) * 2, dir = e > s ? 1 : -1;
    const c = (axis === 0 ? w.path.start.z : w.path.start.x) * 2, t = w.thicknessMm, base = (lv.elevationMm + w.baseOffsetMm) * 2, top = base + w.heightMm * 2;
    wallInfo.set(w.id, { axis, across, c, base, top, t });
    const holes = ops.map(o => {
      const a0 = s + dir * o.offsetMm * 2, a1 = a0 + dir * o.widthMm * 2, y0 = base + o.sillMm * 2;
      const hole: Aperture = { id: o.id, levelId: w.levelId, a: [Math.min(a0, a1), Math.max(a0, a1)], y: [y0, y0 + o.heightMm * 2], d: [c - t, c + t], axis };
      apertures.push(hole);
      return hole;
    });
    const along = breaks([s, e, ...holes.flatMap(h => h.a)]), ys = breaks([base, top, ...holes.flatMap(h => h.y)]);
    const p = primitive(w.classification === 'exterior' ? 'exterior-wall' : 'interior-wall');
    extrudeGrid(p, axis, 1, across, [c - t, c + t], along, ys, (i, j) =>
      !holes.some(h => h.a[0] <= along[i]! && along[i + 1]! <= h.a[1] && h.y[0] <= ys[j]! && ys[j + 1]! <= h.y[1]));
    const layer: Layer = w.classification === 'exterior' ? 'EXTERIOR_SHELL' : 'INTERIOR_WALLS';
    const wallObject = add({ sceneObjectId: `wall:${w.id}`, sourceEntityType: 'wall', sourceEntityId: w.id, bimElementId: bimId.get(`walls:${w.id}`) ?? null, levelId: w.levelId,
      layer, geometryRole: 'wall', fidelity: 'FULL_GEOMETRY', material: p.material, specification: spec(w.specificationId), appearance: 'VISUAL_PLACEHOLDER', note: null }, [p]);
    coverage.push({ entityType: 'wall', entityId: w.id, status: 'FULL_GEOMETRY', reason: null, sceneObjectIds: [wallObject] });
    for (const [k, o] of ops.entries()) {
      const h = holes[k]!, ids = [wallObject];
      if (o.kind !== 'opening') {
        const half = Math.min(o.kind === 'door' ? DOOR_LEAF_MM : WINDOW_PANE_MM, t), q = primitive(o.kind === 'door' ? 'door-placeholder' : 'glass-placeholder');
        const ranges: Record<Axis, [number, number]> = { 0: [0, 0], 1: h.y, 2: [0, 0] };
        ranges[axis] = h.a; ranges[across] = [c - half, c + half];
        box(q, ranges[0], ranges[1], ranges[2]);
        ids.push(add({ sceneObjectId: `${o.kind === 'door' ? 'door-leaf' : 'window-pane'}:${o.id}`, sourceEntityType: 'opening', sourceEntityId: o.id,
          bimElementId: bimId.get(`openings:${o.id}`) ?? null, levelId: o.levelId, layer: o.kind === 'door' ? 'DOORS' : 'WINDOWS',
          geometryRole: o.kind === 'door' ? 'door-leaf' : 'window-pane', fidelity: 'VISUAL_PLACEHOLDER', material: q.material, specification: spec(o.specificationId),
          appearance: 'VISUAL_PLACEHOLDER', note: 'Generic component filling the exact aperture; no product, glazing, thermal or fire property.' }, [q]));
      }
      coverage.push({ entityType: 'opening', entityId: o.id, status: 'FULL_GEOMETRY', reason: 'APERTURE_CUT_IN_HOST_WALL', sceneObjectIds: ids });
    }
  }

  // Butt-end corner notches: visual fills where non-collinear walls end at one node.
  const ends = new Map<string, string[]>();
  for (const w of m.walls) if (wallInfo.has(w.id)) for (const p of [w.path.start, w.path.end]) {
    const k = `${w.levelId}|${p.x}|${p.z}`; ends.set(k, [...(ends.get(k) ?? []), w.id]);
  }
  for (const [k, ids] of [...ends].sort((p, q) => compare(p[0], q[0]))) {
    const infos = ids.map(id => ({ id, ...wallInfo.get(id)!, exterior: m.walls.find(w => w.id === id)!.classification === 'exterior' }));
    if (!infos.some(i => i.axis === 0) || !infos.some(i => i.axis === 2)) continue;
    const [levelId, xs, zs] = k.split('|') as [string, string, string], x = Number(xs) * 2, z = Number(zs) * 2;
    if (new Set(infos.map(i => `${i.base}/${i.top}`)).size !== 1) continue;
    const hx = Math.max(...infos.filter(i => i.axis === 2).map(i => i.t)), hz = Math.max(...infos.filter(i => i.axis === 0).map(i => i.t));
    const fx: [number, number] = [x - hx, x + hx], fz: [number, number] = [z - hz, z + hz], fy: [number, number] = [infos[0]!.base, infos[0]!.top];
    const intrudes = apertures.some(h => h.levelId === levelId && h.y[0] < fy[1] && fy[0] < h.y[1] && (h.axis === 0
      ? h.a[0] < fx[1] && fx[0] < h.a[1] && h.d[0] < fz[1] && fz[0] < h.d[1] : h.a[0] < fz[1] && fz[0] < h.a[1] && h.d[0] < fx[1] && fx[0] < h.d[1]));
    if (intrudes) continue;
    const p = primitive(infos.some(i => i.exterior) ? 'exterior-wall' : 'interior-wall');
    box(p, fx, fy, fz);
    add({ sceneObjectId: `wall-junction:${levelId}@${xs},${zs}`, sourceEntityType: 'junction', sourceEntityId: `${levelId}@${xs},${zs}`, bimElementId: null, levelId,
      layer: infos.some(i => i.exterior) ? 'EXTERIOR_SHELL' : 'INTERIOR_WALLS', geometryRole: 'wall-junction', fidelity: 'VISUAL_PLACEHOLDER', material: p.material,
      specification: null, appearance: 'VISUAL_PLACEHOLDER', note: `BUTT_END_CORNER_FILL for ${ids.length} walls; not a quantity.` }, [p]);
  }

  // Plates: exact footprints, voids stay open.
  for (const s of [...m.slabs].sort((p, q) => compare(p.id, q.id))) {
    const lv = level.get(s.levelId)!, top = (lv.elevationMm + s.topOffsetMm) * 2, g = footprintGrid(s.footprint.outer, s.footprint.voids);
    const p = primitive(s.kind === 'flat-roof' ? 'roof' : 'slab');
    extrudeGrid(p, 0, 2, 1, [top - s.thicknessMm * 2, top], g.xs, g.zs, g.inside);
    const id = add({ sceneObjectId: `slab:${s.id}`, sourceEntityType: 'slab', sourceEntityId: s.id, bimElementId: bimId.get(`slabs:${s.id}`) ?? null, levelId: s.levelId,
      layer: s.kind === 'flat-roof' ? 'ROOFS' : s.kind === 'ceiling' ? 'CEILINGS' : 'FLOORS', geometryRole: 'slab', fidelity: 'FULL_GEOMETRY', material: p.material,
      specification: spec(s.specificationId), appearance: 'VISUAL_PLACEHOLDER', note: null }, [p]);
    coverage.push({ entityType: 'slab', entityId: s.id, status: 'FULL_GEOMETRY', reason: null, sceneObjectIds: [id] });
    s.footprint.voids.forEach((_, i) => coverage.push({ entityType: 'void', entityId: `${s.id}:void:${i}`, status: 'FULL_GEOMETRY', reason: 'PRESERVED_AS_HOLE_IN_SLAB', sceneObjectIds: [id] }));
  }

  // Straight stairs: exact treads and risers; mass underside.
  const stairEnds = new Map<string, { bottom: { x: number; y: number; z: number }; top: { x: number; y: number; z: number } }>();
  for (const s of [...m.stairs].sort((p, q) => compare(p.id, q.id))) {
    const from = level.get(s.fromLevelId)!, to = level.get(s.toLevelId)!, base = from.elevationMm * 2;
    const xs = s.footprint.map(p => p.x * 2), zs = s.footprint.map(p => p.z * 2);
    const runAxis: Axis = s.direction.endsWith('x') ? 0 : 2, widthAxis: Axis = runAxis === 0 ? 2 : 0, positive = s.direction.startsWith('+');
    const runR: [number, number] = runAxis === 0 ? [Math.min(...xs), Math.max(...xs)] : [Math.min(...zs), Math.max(...zs)];
    const widthR: [number, number] = widthAxis === 0 ? [Math.min(...xs), Math.max(...xs)] : [Math.min(...zs), Math.max(...zs)];
    const n = s.riserHeightsMm.length, d = s.treadDepthMm * 2, cum: number[] = [];
    s.riserHeightsMm.reduce((acc, r) => { cum.push(acc + r * 2); return acc + r * 2; }, 0);
    const runBreaks = Array.from({ length: n }, (_, k) => positive ? runR[0] + k * d : runR[1] - (n - 1 - k) * d);
    const yBreaks = breaks([base, ...cum.slice(0, n - 1).map(h => base + h)]);
    const flight = primitive('stair');
    extrudeGrid(flight, runAxis, 1, widthAxis, widthR, runBreaks, yBreaks, (i, j) => yBreaks[j + 1]! <= base + cum[positive ? i : n - 2 - i]!);
    const riser = primitive('stair');
    rect(riser, runAxis, positive ? -1 : 1, positive ? runR[1] : runR[0], { 1: [base + cum[n - 2]!, base + cum[n - 1]!], [widthAxis]: widthR } as Partial<Record<Axis, [number, number]>>);
    const id = add({ sceneObjectId: `stair-flight:${s.id}`, sourceEntityType: 'stair', sourceEntityId: s.id, bimElementId: bimId.get(`stairs:${s.id}`) ?? null, levelId: s.fromLevelId,
      layer: 'STAIRS', geometryRole: 'stair-flight', fidelity: 'FULL_GEOMETRY', material: 'stair', specification: spec(s.specificationId), appearance: 'VISUAL_PLACEHOLDER',
      note: 'Treads and risers exact; underside is a mass fill to the source level (soffit not modeled); primitive 1 is the final riser.' }, [flight, riser]);
    coverage.push({ entityType: 'stair', entityId: s.id, status: 'FULL_GEOMETRY', reason: 'UNDERSIDE_MASS_FILL_VISUAL_PLACEHOLDER', sceneObjectIds: [id] });
    const mid = (widthR[0] + widthR[1]) / 4, at = (r: number, y: number) => runAxis === 0 ? { x: Math.floor(r / 2), y, z: Math.floor(mid) } : { x: Math.floor(mid), y, z: Math.floor(r / 2) };
    stairEnds.set(s.id, { bottom: at(positive ? runR[0] : runR[1], from.elevationMm), top: at(positive ? runR[1] : runR[0], to.elevationMm) });
    for (const l of [...s.landings].sort((p, q) => compare(p.id, q.id))) {
      const g = footprintGrid(l.footprint, []), q = primitive('landing');
      capGrid(q, 0, 2, 1, 1, (from.elevationMm + l.elevationOffsetMm) * 2, g.xs, g.zs, g.inside);
      const lid = add({ sceneObjectId: `landing:${l.id}`, sourceEntityType: 'landing', sourceEntityId: l.id, bimElementId: bimId.get(`landings:${l.id}`) ?? null,
        levelId: l.elevationOffsetMm === 0 ? s.fromLevelId : s.toLevelId, layer: 'STAIRS', geometryRole: 'landing', fidelity: 'FULL_GEOMETRY', material: 'landing',
        specification: null, appearance: 'VISUAL_PLACEHOLDER', note: 'Walking surface; landing thickness is not modeled.' }, [q]);
      coverage.push({ entityType: 'landing', entityId: l.id, status: 'FULL_GEOMETRY', reason: 'SURFACE_ONLY_THICKNESS_NOT_MODELED', sceneObjectIds: [lid] });
    }
  }

  // Rooms: hidden helper volumes, interior points, connectivity from Blueprint QA.
  const qa = auditBlueprint(m).circulation;
  const roomTop = (levelId: string) => {
    const tops = m.walls.filter(w => w.levelId === levelId && w.heightMm !== null && w.baseOffsetMm !== null).map(w => w.baseOffsetMm! + w.heightMm!);
    return tops.length ? Math.min(...tops) : level.get(levelId)!.floorToFloorHeightMm;
  };
  const openingsBySpace = new Map<string, string[]>();
  for (const o of [...m.openings].sort((p, q) => compare(p.id, q.id))) for (const sid of openingSpaceIds(m, o.id)) openingsBySpace.set(sid, [...(openingsBySpace.get(sid) ?? []), o.id]);
  const rooms: SceneManifest['rooms'] = [];
  for (const s of [...m.spaces].sort((p, q) => compare(p.id, q.id))) {
    const lv = level.get(s.levelId)!, height = roomTop(s.levelId), ip = interiorPoint(s.boundary), ids: string[] = [];
    if (height !== null) {
      const g = footprintGrid(s.boundary, []), p = primitive('room-volume');
      extrudeGrid(p, 0, 2, 1, [lv.elevationMm * 2, (lv.elevationMm + height) * 2], g.xs, g.zs, g.inside);
      ids.push(add({ sceneObjectId: `room-volume:${s.id}`, sourceEntityType: 'space', sourceEntityId: s.id, bimElementId: bimId.get(`spaces:${s.id}`) ?? null, levelId: s.levelId,
        layer: 'ROOM_VOLUMES', geometryRole: 'room-volume', fidelity: 'SEMANTIC_ONLY', material: 'room-volume', specification: spec(s.specificationId), appearance: 'VISUAL_PLACEHOLDER',
        note: 'Selection helper on wall centerlines; not a net or usable area claim.' }, [p]));
    }
    coverage.push({ entityType: 'space', entityId: s.id, status: 'SEMANTIC_ONLY', reason: height === null ? 'ROOM_HEIGHT_UNKNOWN' : 'SELECTION_HELPER_VOLUME', sceneObjectIds: ids });
    const connected = [...new Set(qa.edges.flatMap(e => e.from === s.id ? [e.to] : e.to === s.id ? [e.from] : []))].sort(compare);
    rooms.push({ spaceId: s.id, sceneObjectId: ids[0] ?? `room-volume:${s.id}`, bimElementId: bimId.get(`spaces:${s.id}`) ?? null, levelId: s.levelId, name: s.name,
      classification: s.classification, boundary: s.boundary.map(p => ({ x: p.x, z: p.z })), floorElevationMm: lv.elevationMm, heightMm: height ?? 0,
      interiorPoint: { x: ip.x, y: lv.elevationMm, z: ip.z }, areaMm2: polygonAreaMm2(s.boundary), openingIds: openingsBySpace.get(s.id) ?? [], connectedSpaceIds: connected });
  }
  for (const l of levels) coverage.push({ entityType: 'level', entityId: l.id, status: 'SEMANTIC_ONLY', reason: 'LEVEL_GROUP_NODE', sceneObjectIds: [] });
  for (const d of m.dimensions) coverage.push({ entityType: 'dimension', entityId: d.id, status: 'NOT_EVALUATED', reason: 'ANNOTATION_NOT_IN_SCENE_V1', sceneObjectIds: [] });
  if (m.site) coverage.push({ entityType: 'site', entityId: 'site', status: 'NOT_EVALUATED', reason: 'SITE_NOT_IN_SCENE_V1', sceneObjectIds: [] });
  coverage.sort((a, b) => compare(`${a.entityType}/${a.entityId}`, `${b.entityType}/${b.entityId}`));

  // Navigation: QA-validated edges only.
  const roomById = new Map(rooms.map(r => [r.spaceId, r]));
  const nodes = new Map<string, SceneManifest['navigation']['nodes'][number]>();
  for (const r of rooms) nodes.set(`room:${r.spaceId}`, { id: `room:${r.spaceId}`, kind: 'room', sourceEntityId: r.spaceId, levelId: r.levelId, position: r.interiorPoint });
  const edges: SceneManifest['navigation']['edges'] = [];
  const length = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Number(integerSqrt(BigInt(a.x - b.x) ** 2n + BigInt(a.y - b.y) ** 2n + BigInt(a.z - b.z) ** 2n));
  const link = (from: string, to: string, via: string, kind: 'door' | 'passage' | 'stair') => edges.push({ from, to, via, kind, lengthMm: length(nodes.get(from)!.position, nodes.get(to)!.position) });
  for (const e of qa.edges) {
    if (!roomById.has(e.from) || !roomById.has(e.to)) continue;
    if (e.kind === 'stair') {
      const se = stairEnds.get(e.via), st = m.stairs.find(x => x.id === e.via);
      if (!se || !st) continue;
      nodes.set(`stair-bottom:${e.via}`, { id: `stair-bottom:${e.via}`, kind: 'stair-bottom', sourceEntityId: e.via, levelId: st.fromLevelId, position: se.bottom });
      nodes.set(`stair-top:${e.via}`, { id: `stair-top:${e.via}`, kind: 'stair-top', sourceEntityId: e.via, levelId: st.toLevelId, position: se.top });
      link(`room:${e.from}`, `stair-bottom:${e.via}`, e.via, 'stair'); link(`stair-bottom:${e.via}`, `stair-top:${e.via}`, e.via, 'stair'); link(`stair-top:${e.via}`, `room:${e.to}`, e.via, 'stair');
    } else {
      const o = m.openings.find(x => x.id === e.via)!, w = m.walls.find(x => x.id === o.wallId)!, info = wallInfo.get(w.id);
      if (!info) continue;
      const s0 = info.axis === 0 ? w.path.start.x : w.path.start.z, e0 = info.axis === 0 ? w.path.end.x : w.path.end.z, dir = e0 > s0 ? 1 : -1;
      const along = Math.floor((2 * s0 + dir * (2 * o.offsetMm + o.widthMm)) / 2), y = level.get(w.levelId)!.elevationMm + w.baseOffsetMm! + o.sillMm;
      const position = info.axis === 0 ? { x: along, y, z: info.c / 2 } : { x: info.c / 2, y, z: along };
      nodes.set(`opening:${o.id}`, { id: `opening:${o.id}`, kind: 'opening', sourceEntityId: o.id, levelId: w.levelId, position });
      link(`room:${e.from}`, `opening:${o.id}`, o.id, e.kind); link(`opening:${o.id}`, `room:${e.to}`, o.id, e.kind);
    }
  }
  if (nodes.size > limits.navigationNodes) throw new SceneError('SCENE_RESOURCE_LIMIT', 'Navigation node budget exceeded');
  edges.sort((a, b) => compare(`${a.from}/${a.to}/${a.via}`, `${b.from}/${b.to}/${b.via}`));

  const built = performance.now();
  const result = assemble(source, objects, coverage, rooms, [...nodes.values()].sort((a, b) => compare(a.id, b.id)), edges, levels, bimId, limits);
  return { ...result, timingsMs: { sourceAndBim: sourced - started, geometry: built - sourced, assembleAndSerialize: performance.now() - built } };
}

function boundsOf(points: number[]) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i++) { const k = i % 3; min[k] = Math.min(min[k]!, points[i]!); max[k] = Math.max(max[k]!, points[i]!); }
  // Half-mm to mm, rounded outward (conservative for odd wall thicknesses).
  return { min: { x: Math.floor(min[0]! / 2), y: Math.floor(min[1]! / 2), z: Math.floor(min[2]! / 2) }, max: { x: Math.ceil(max[0]! / 2), y: Math.ceil(max[1]! / 2), z: Math.ceil(max[2]! / 2) } };
}

function assemble(source: SceneBinding, compiled: CompiledObject[], coverage: Coverage[], rooms: SceneManifest['rooms'],
  navNodes: SceneManifest['navigation']['nodes'], navEdges: SceneManifest['navigation']['edges'], levels: BuildingModelV2['levels'], bimId: Map<string, string>, limits: SceneLimits) {
  const levelIndex = new Map(levels.map(l => [l.id, l.index]));
  compiled.sort((a, b) => (levelIndex.get(a.meta.levelId)! - levelIndex.get(b.meta.levelId)!) || (LAYERS.indexOf(a.meta.layer) - LAYERS.indexOf(b.meta.layer)) || compare(a.meta.sceneObjectId, b.meta.sceneObjectId));
  if (compiled.length > limits.objects) throw new SceneError('SCENE_RESOURCE_LIMIT', 'Scene object budget exceeded');
  const triangles = compiled.reduce((n, o) => n + o.primitives.reduce((k, p) => k + p.indices.length / 3, 0), 0);
  const vertices = compiled.reduce((n, o) => n + o.primitives.reduce((k, p) => k + p.positions.length / 3, 0), 0);
  if (triangles > limits.triangles || vertices > limits.vertices) throw new SceneError('SCENE_RESOURCE_LIMIT', 'Scene triangle or vertex budget exceeded', { triangles: String(triangles), vertices: String(vertices) });
  const all = compiled.flatMap(o => o.primitives.flatMap(p => p.positions));
  const bounds = boundsOf(all), origin = { x: bounds.min.x, y: 0, z: bounds.min.z };
  const extent = Math.max(bounds.max.x - origin.x, bounds.max.z - origin.z, Math.abs(bounds.max.y), Math.abs(bounds.min.y));
  if (extent > limits.extentMm) throw new SceneError('SCENE_RESOURCE_LIMIT', 'Scene extent exceeds the float32 precision budget');
  const objects: SceneObject[] = compiled.map(o => ({ ...o.meta, bounds: boundsOf(o.primitives.flatMap(p => p.positions)), primitives: o.primitives.length,
    triangles: o.primitives.reduce((k, p) => k + p.indices.length / 3, 0), vertices: o.primitives.reduce((k, p) => k + p.positions.length / 3, 0) }));
  const usedLayers = LAYERS.map(id => ({ id, visibleByDefault: !HIDDEN_BY_DEFAULT.includes(id), objects: objects.filter(o => o.layer === id).length }));
  const levelMeta = levels.map(l => {
    const own = compiled.filter(o => o.meta.levelId === l.id).flatMap(o => o.primitives.flatMap(p => p.positions));
    return { levelId: l.id, bimElementId: bimId.get(`levels:${l.id}`) ?? null, name: l.name, index: l.index, elevationMm: l.elevationMm, nodeName: `level:${l.id}`, bounds: own.length ? boundsOf(own) : null };
  });
  const cameras = sceneCameras(bounds, levels, rooms);
  const layerCount = levels.reduce((n, l) => n + LAYERS.filter(id => compiled.some(o => o.meta.levelId === l.id && o.meta.layer === id)).length, 0);
  const manifest: Omit<SceneManifest, 'binary'> = {
    version: SCENE_MANIFEST_VERSION, compilerVersion: SCENE_COMPILER_VERSION, source, inputHash: sceneInputHash(source),
    units: { manifest: 'mm', glb: 'm', glbMetresPerUnit: '1', modelMillimetresPerGlbMetre: 1000 },
    frame: { coordinateSystem: 'x-right-y-up-z-depth', gltfAxisMapping: 'identity', originMm: origin, rootTranslationIsOrigin: true, vertexGridMm: '0.5' },
    precision: { positionComponent: 'float32', maxLocalExtentMm: extent, maxFloat32ErrorNm: float32ErrorBoundNm(extent), validatorToleranceNm: VALIDATOR_TOLERANCE_NM },
    bounds, levels: levelMeta, layers: usedLayers,
    materials: MATERIALS.filter(x => compiled.some(o => o.primitives.some(p => p.material === x.id))).map(x => ({ id: x.id, rgbaThousandths: [...x.rgba], roughnessThousandths: x.roughness, alphaMode: x.alphaMode, provenance: 'VISUAL_PLACEHOLDER' as const })),
    objects, rooms,
    navigation: { source: 'blueprint-qa-circulation', eyeHeightMm: EYE_HEIGHT_MM, nodes: navNodes, edges: navEdges,
      claims: { egress: 'NOT_CLAIMED', accessibility: 'NOT_CLAIMED', collisionFreePath: 'NOT_CLAIMED' } },
    cameras, coverage, overlays: OVERLAYS.map(o => ({ ...o, status: 'NOT_EVALUATED' as const })), claims: { ...CLAIMS }, limitations: [...LIMITATIONS],
    statistics: { objects: objects.length, nodes: 1 + levels.length + layerCount + objects.length, meshes: objects.length, primitives: objects.reduce((n, o) => n + o.primitives, 0),
      triangles, vertices, materials: MATERIALS.filter(x => compiled.some(o => o.primitives.some(p => p.material === x.id))).length },
  };
  const glb = writeGlb(manifest, compiled);
  if (glb.length > limits.glbBytes) throw new SceneError('SCENE_RESOURCE_LIMIT', 'GLB byte budget exceeded');
  // Canonical key order (schema order), so in-process and worker-returned manifests are byte-identical JSON; also schema-checks our own output.
  const full: SceneManifest = SceneManifestSchema.parse({ ...manifest, binary: { format: 'glb', mimeType: 'model/gltf-binary', sha256: createHash('sha256').update(glb).digest('hex'), bytes: glb.length } });
  if (Buffer.byteLength(JSON.stringify(full)) > limits.manifestBytes) throw new SceneError('SCENE_RESOURCE_LIMIT', 'Manifest byte budget exceeded');
  return { manifest: full, glb, sceneHash: costHash(manifest) };
}

type Bounds = SceneManifest['bounds'];
function sceneCameras(b: Bounds, levels: BuildingModelV2['levels'], rooms: SceneManifest['rooms']): SceneManifest['cameras'] {
  const c = { x: Math.floor((b.min.x + b.max.x) / 2), y: Math.floor((b.min.y + b.max.y) / 2), z: Math.floor((b.min.z + b.max.z) / 2) };
  const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z), half = Math.floor(size / 2);
  const up = { x: 0, y: 1, z: 0 }, north = { x: 0, y: 0, z: -1 }, all = levels.map(l => l.id);
  const cam = (id: string, kind: SceneManifest['cameras'][number]['kind'], position: typeof c, target: typeof c, extra: Partial<SceneManifest['cameras'][number]> = {}) =>
    ({ id, kind, position, target, up, verticalFovMilliDegrees: 50_000, orbitRadiusMm: null, visibleLevelIds: all, hiddenLayers: ['ROOM_VOLUMES', 'SEMANTIC_HELPERS'] as Layer[],
      transition: { interpolation: 'linear' as const, durationMs: 1200 }, focusSourceEntityId: null, ...extra });
  const cams = [
    cam('overview', 'overview', { x: c.x, y: c.y + Math.floor(size * 3 / 5), z: c.z + Math.floor(size * 8 / 5) }, c),
    cam('three-quarter', 'three-quarter', { x: c.x + Math.floor(size * 9 / 10), y: c.y + Math.floor(size * 7 / 10), z: c.z + Math.floor(size * 9 / 10) }, c),
    cam('top-down', 'top-down', { x: c.x, y: b.max.y + Math.floor(size * 6 / 5), z: c.z }, c, { up: north }),
    cam('exterior-orbit', 'exterior-orbit', { x: c.x + 2 * size, y: c.y + half, z: c.z }, c, { orbitRadiusMm: 2 * size }),
    cam('interior-roof-hidden', 'interior-roof-hidden', { x: c.x + Math.floor(size * 7 / 10), y: c.y + size, z: c.z + Math.floor(size * 7 / 10) }, c, { hiddenLayers: ['ROOFS', 'ROOM_VOLUMES', 'SEMANTIC_HELPERS'] }),
  ];
  for (const l of levels) {
    const target = { x: c.x, y: l.elevationMm + 1200, z: c.z };
    cams.push(cam(`floor:${l.id}`, 'floor', { x: c.x + Math.floor(size * 4 / 5), y: target.y + Math.floor(size * 4 / 5), z: c.z + Math.floor(size * 4 / 5) }, target,
      { visibleLevelIds: levels.filter(o => o.index <= l.index).map(o => o.id), hiddenLayers: ['ROOFS', 'ROOM_VOLUMES', 'SEMANTIC_HELPERS'], focusSourceEntityId: l.id }));
  }
  for (const r of rooms) {
    const xs = r.boundary.map(p => p.x), zs = r.boundary.map(p => p.z), extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    const target = { x: r.interiorPoint.x, y: r.floorElevationMm + 1000, z: r.interiorPoint.z };
    cams.push(cam(`room:${r.spaceId}`, 'room', { x: target.x, y: target.y + 2 * extent + 3000, z: target.z }, target,
      { up: north, visibleLevelIds: levels.filter(o => o.elevationMm <= r.floorElevationMm).map(o => o.id), hiddenLayers: ['ROOFS', 'ROOM_VOLUMES', 'SEMANTIC_HELPERS'], focusSourceEntityId: r.spaceId }));
  }
  return cams;
}
