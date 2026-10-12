import { createHash } from 'node:crypto';
import { ArchitecturalBuildingModelV2Schema, segmentsTouch, type BuildingModelV2 } from '@designflow/shared';
import type { BlueprintQaReport } from '@designflow/blueprint-qa';
import { costHash } from '@designflow/boq-cost';
import { modelHash } from '../lib/generation-identity.js';
import { wallFacade } from '../revision/appearance.js';
import { DIFF_COLLECTIONS } from '../verification/contracts.js';
import { FACADES } from './zone-contracts.js';
import { DEPENDENT_ARTIFACTS, ZoneRequestError, canonicalDeclarations, northResolvable, prepare, resolveTarget, sameRegion, zoneId, type ZoneContext } from './zones.js';
import { NOT_CLAIMED_REGENERATION, OPERATION_VERSIONS, REGENERATION_LIMITS, REGENERATION_VERIFICATION_VERSION, REGENERATION_VERSION, RegenerationReportSchema,
  RegenerationVerificationReportSchema, type PreservationCheck, type QaSummary, type RegenerationReport, type RegenerationRequest, type RegenerationVerificationReport,
  type WindowRule } from './regeneration-contracts.js';

type Model = BuildingModelV2;
type Level = Model['levels'][number];
type Wall = Model['walls'][number];
type Opening = Model['openings'][number];
type Dimension = Model['dimensions'][number];
type Facade = typeof FACADES[number];
type Collection = typeof DIFF_COLLECTIONS[number];
type Entity = { id: string; levelId?: string; fromLevelId?: string; toLevelId?: string; kind?: string; wallId?: string; spaceIds?: string[] };
type Blocker = RegenerationReport['refusals'][number];
type Changes = NonNullable<RegenerationReport['changes']>;
type PreservedItem = NonNullable<RegenerationReport['preservation']>['preservedInTarget'][number];
/** Which changed entities an operation is allowed to touch; everything else must be identical in the candidate. */
export type Allowed = (collection: Collection, entity: Entity) => boolean;
/** The acceptance QA a supplied revision is saved with (services/project-service revisionQaReport), injected so this module stays pure. */
export type QaRunner = (model: Model) => Pick<BlueprintQaReport, 'status' | 'summary' | 'findings'>;

export const REGENERATION_LIMITATIONS = [
  'Regeneration is deterministic model editing, not AI or generator design: TYPICAL_FLOOR copies an existing storey\'s layout and FENESTRATION lays out windows by a stated rule. Neither judges design quality.',
  'Nothing is committed by the regeneration request. A candidate becomes a revision only when it is saved through the supplied-revision route, which re-runs acceptance QA and requires this revision to still be current.',
  'Preservation is enforced on the candidate: every entity outside the allowed scope is compared by canonical hash and any difference refuses the candidate. The save route accepts any QA-valid model, so a committed revision is proven to be this regeneration only by the verification route.',
  'Building Model V2 has no shaft, lift, riser, façade-panel or structural load-path elements, so none of them is regenerated or preserved beyond the geometry the model represents.',
  'The saved revision is recorded as a supplied revision (no migration adds a regeneration source); the model\'s provenance field still describes how the base model was created.',
  'No structural, wind, seismic, daylight, thermal, fire-safety or code-compliance property of a candidate is evaluated or implied.',
];

// ---------------------------------------------------------------- preservation

const canonicalEntity = (collection: Collection, e: Entity) => collection === 'walls' && e.spaceIds ? { ...e, spaceIds: [...e.spaceIds].sort() } : e;
const documentFields = (m: Model) => {
  const { site: _site, provenance: _provenance, levels: _l, spaces: _s, walls: _w, openings: _o, stairs: _st, slabs: _sl, columns: _c, dimensions: _d, specifications: _sp, ...rest } = m;
  return rest;
};

/**
 * Entity-level comparison of two models under an allowed scope (the same canonical-hash comparison as the B34 scoped diff, without its 512-id
 * request limit). An entity added, removed or changed is in scope only if the operation allows it in every version that exists; site and
 * document-level changes are never in scope. Provenance is outside model identity and is not compared.
 */
export function preservationCheck(base: Model, other: Model, allowed: Allowed): PreservationCheck {
  let added = 0, removed = 0, changed = 0, outOfScope = 0;
  const violations: PreservationCheck['violations'] = [];
  const out = (collection: PreservationCheck['violations'][number]['collection'], entityId: string, change: 'ADDED' | 'REMOVED' | 'CHANGED') => {
    outOfScope++;
    if (violations.length < REGENERATION_LIMITS.listed) violations.push({ collection, entityId, change });
  };
  for (const collection of DIFF_COLLECTIONS) {
    const before = new Map((base[collection] as Entity[]).map(e => [e.id, e])), after = new Map((other[collection] as Entity[]).map(e => [e.id, e]));
    for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const a = before.get(id), b = after.get(id);
      const change = !a ? 'ADDED' : !b ? 'REMOVED' : costHash(canonicalEntity(collection, a)) !== costHash(canonicalEntity(collection, b)) ? 'CHANGED' : null;
      if (!change) continue;
      if (change === 'ADDED') added++; else if (change === 'REMOVED') removed++; else changed++;
      if (!((!a || allowed(collection, a)) && (!b || allowed(collection, b)))) out(collection, id, change);
    }
  }
  if (costHash(base.site ?? null) !== costHash(other.site ?? null)) { changed++; out('site', (other.site ?? base.site)!.id, !base.site ? 'ADDED' : !other.site ? 'REMOVED' : 'CHANGED'); }
  if (costHash(documentFields(base)) !== costHash(documentFields(other))) { changed++; out('document', other.id, 'CHANGED'); }
  return { status: added + removed + changed === 0 ? 'IDENTICAL' : outOfScope ? 'OUT_OF_SCOPE_CHANGES' : 'WITHIN_SCOPE', basis: 'ENTITY_CANONICAL_HASH',
    added, removed, changed, outOfScope, violations };
}

/** Canonical hash of every entity on a set of levels (a stair counts where it starts or ends); used to show a preserved zone is identical. */
function levelContentHash(model: Model, levelIds: ReadonlySet<string>): string {
  const touches = (e: Entity) => [e.levelId, e.fromLevelId, e.toLevelId].some(l => l !== undefined && levelIds.has(l));
  return costHash(DIFF_COLLECTIONS.map(c => (model[c] as Entity[]).filter(e => c === 'levels' ? levelIds.has(e.id) : touches(e))
    .map(e => canonicalEntity(c, e)).sort((a, b) => a.id < b.id ? -1 : 1)));
}

// ---------------------------------------------------------------- shared helpers

/** Deterministic id of a regenerated entity: the operation version, the level or wall it is created for, and its source. */
const regeneratedId = (version: string, scope: string, source: string) => `rg-${createHash('sha256').update(`${version}\n${scope}\n${source}`).digest('hex').slice(0, 40)}`;
const multiset = (xs: readonly unknown[]) => xs.map(x => costHash(x)).sort().join('|');
const byId = <T extends { id: string }>(xs: readonly T[]) => [...xs].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const counts = (m: Model, levelId: string) => ({ spaces: m.spaces.filter(s => s.levelId === levelId).length, walls: m.walls.filter(w => w.levelId === levelId).length,
  openings: m.openings.filter(o => o.levelId === levelId).length, dimensions: m.dimensions.filter(d => d.levelId === levelId).length });
const zero = { spaces: 0, walls: 0, openings: 0, dimensions: 0 };

/** Every id in use except those the operation removes; a regenerated id must not collide with any of them. */
function idsInUse(m: Model, removed: ReadonlySet<string>): Set<string> {
  const ids = new Set<string>([m.id]);
  if (m.site) { ids.add(m.site.id); m.site.setbacks.forEach(s => ids.add(s.id)); m.site.parkingZones?.forEach(s => ids.add(s.id)); }
  for (const c of DIFF_COLLECTIONS) for (const e of m[c] as Entity[]) if (!removed.has(e.id)) ids.add(e.id);
  for (const s of m.stairs) s.landings.forEach(l => ids.add(l.id));
  return ids;
}

/** Dimension anchors that name a wall, space or opening (the entities an operation may replace). */
const anchoredEntities = (d: Dimension) => d.anchors.flatMap(a => a.kind === 'wall-end' ? [a.wallId] : a.kind === 'space-vertex' ? [a.spaceId] : a.kind === 'opening-edge' ? [a.openingId] : []);

type OperationResult = { refusals: Blocker[]; candidate: Model | null; changes: Changes | null; allowed: Allowed | null; allowedChange: string; preservedInTarget: PreservedItem[] };
const refused = (refusals: Blocker[], allowedChange: string): OperationResult => ({ refusals: refusals.slice(0, REGENERATION_LIMITS.listed), candidate: null, changes: null, allowed: null, allowedChange, preservedInTarget: [] });
const listed = (xs: { entityId: string; reason: string }[]) => ({ skipped: xs.slice(0, REGENERATION_LIMITS.listed), skippedCount: xs.length });

// ---------------------------------------------------------------- TYPICAL_FLOOR

const TYPICAL_FLOOR_SCOPE = 'Spaces, walls, openings and storey dimensions on the regenerated storeys only. Levels, slabs, columns, stairs, specifications, the site and every other storey must be identical.';

/** Geometry an inserted layout has to fit: the same envelope, plates, columns and stair flights as the template, compared exactly. */
function fixedGeometry(m: Model, level: Level) {
  const stair = (s: Model['stairs'][number]) => ({ footprint: s.footprint, direction: s.direction, widthMm: s.widthMm, riseMm: s.riseMm, runMm: s.runMm, riserHeightsMm: s.riserHeightsMm,
    treadDepthMm: s.treadDepthMm, headroomMm: s.headroomMm ?? null, landings: s.landings.map(l => ({ footprint: l.footprint, elevationOffsetMm: l.elevationOffsetMm })) });
  return {
    slabs: multiset(m.slabs.filter(s => s.levelId === level.id).map(s => ({ kind: s.kind, footprint: s.footprint, topOffsetMm: s.topOffsetMm, thicknessMm: s.thicknessMm }))),
    columns: multiset(m.columns.filter(c => c.levelId === level.id).map(c => ({ crossSection: c.crossSection, baseOffsetMm: c.baseOffsetMm, heightMm: c.heightMm }))),
    stairs: `${multiset(m.stairs.filter(s => s.fromLevelId === level.id).map(stair))}#${multiset(m.stairs.filter(s => s.toLevelId === level.id).map(stair))}`,
  };
}

function typicalFloor(m: Model, heights: Map<string, number | null>, targetIds: readonly string[], templateId: string, lowestStoreyId: string): OperationResult {
  const version = OPERATION_VERSIONS.TYPICAL_FLOOR, levels = new Map(m.levels.map(l => [l.id, l]));
  const template = levels.get(templateId);
  if (!template || template.kind !== 'storey')
    throw new ZoneRequestError('REGENERATION_TEMPLATE_INVALID', 'The template must be a storey of this revision', [`templateLevelId: ${templateId}`]);
  if (m.parametricArchitecture) return refused([{ code: 'PARAMETRIC_MODEL', detail: 'A parametric model is regenerated by changing its parameters, not by copying storeys' }], TYPICAL_FLOOR_SCOPE);
  const targets = targetIds.filter(id => id !== templateId), targetSet = new Set(targets), refusals: Blocker[] = [];
  if (!targets.length) return { ...refused([], TYPICAL_FLOOR_SCOPE), changes: { regeneratedLevelIds: [], levels: [], wallsRegenerated: 0, ...listed([]) } };
  const on = <T extends { levelId?: string | undefined }>(xs: readonly T[], id: string) => xs.filter(x => x.levelId === id);
  const exteriorWalls = new Set(on(m.walls, templateId).filter(w => w.classification === 'exterior').map(w => w.id));
  const templateHasEntrance = on(m.openings, templateId).some(o => o.kind === 'door' && exteriorWalls.has(o.wallId));
  const fixed = fixedGeometry(m, template), incompatible = (levelId: string, reason: string) =>
    refusals.push({ code: 'STOREY_INCOMPATIBLE', detail: `${reason} (storey ${levelId.slice(0, 120)}, template ${templateId.slice(0, 120)})` });
  for (const id of targets) {
    const level = levels.get(id)!, f = fixedGeometry(m, level), h = heights.get(id) ?? null, th = heights.get(templateId) ?? null;
    if (!sameRegion(level.boundary, template.boundary)) incompatible(id, 'The level envelope is not the same region as the template\'s');
    if (h === null || th === null) incompatible(id, 'A storey height is not determined, so the copied walls cannot be shown to fit');
    else if (h !== th) incompatible(id, 'The storey height differs from the template\'s');
    if (level.floorToFloorHeightMm !== null && template.floorToFloorHeightMm !== null && level.floorToFloorHeightMm !== template.floorToFloorHeightMm)
      incompatible(id, 'The declared floor-to-floor height differs from the template\'s');
    if (f.slabs !== fixed.slabs) incompatible(id, 'Its slabs (outline, voids, offset or thickness) differ from the template\'s');
    if (f.columns !== fixed.columns) incompatible(id, 'Its columns differ from the template\'s');
    if (f.stairs !== fixed.stairs) incompatible(id, 'The stair flights leaving or arriving at it differ from the template\'s');
    if (templateHasEntrance && id !== lowestStoreyId) incompatible(id, 'The template has a door in an exterior wall, which would be copied to an upper storey');
  }
  const removedIds = new Set([...m.spaces, ...m.walls, ...m.openings].filter(e => targetSet.has(e.levelId)).map(e => e.id));
  for (const d of m.dimensions) if (!(d.levelId !== undefined && targetSet.has(d.levelId)) && anchoredEntities(d).some(e => removedIds.has(e)))
    refusals.push({ code: 'DIMENSION_DEPENDS_ON_REPLACED_ENTITY', detail: `Dimension ${d.id.slice(0, 150)} is outside the regenerated storeys but measures an entity they replace` });
  if (refusals.length) return refused(refusals, TYPICAL_FLOOR_SCOPE);

  const spaces: Model['spaces'] = [], walls: Wall[] = [], openings: Opening[] = [], dimensions: Dimension[] = [], skipped: { entityId: string; reason: string }[] = [];
  const perLevel: Changes['levels'] = [];
  const tSpaces = on(m.spaces, templateId), tWalls = on(m.walls, templateId), tOpenings = on(m.openings, templateId), tDimensions = on(m.dimensions, templateId);
  for (const id of targets) {
    const level = levels.get(id)!, dy = level.elevationMm - template.elevationMm, map = new Map<string, string>();
    for (const e of [...tSpaces, ...tWalls, ...tOpenings]) map.set(e.id, regeneratedId(version, id, e.id));
    spaces.push(...tSpaces.map(s => ({ ...s, id: map.get(s.id)!, levelId: id })));
    walls.push(...tWalls.map(w => ({ ...w, id: map.get(w.id)!, levelId: id, ...(w.spaceIds ? { spaceIds: w.spaceIds.map(s => map.get(s) ?? s) } : {}) })));
    openings.push(...tOpenings.map(o => ({ ...o, id: map.get(o.id)!, wallId: map.get(o.wallId) ?? o.wallId, levelId: id })));
    let added = 0;
    for (const d of tDimensions) {
      const anchors: Dimension['anchors'] = [];
      for (const a of d.anchors) {
        if (a.kind === 'point') anchors.push({ kind: 'point', point: { ...a.point, y: a.point.y + dy } });
        else if (a.kind === 'level') { if (a.levelId === templateId) anchors.push({ kind: 'level', levelId: id }); }
        else if (a.kind === 'wall-end' && map.has(a.wallId)) anchors.push({ ...a, wallId: map.get(a.wallId)! });
        else if (a.kind === 'space-vertex' && map.has(a.spaceId)) anchors.push({ ...a, spaceId: map.get(a.spaceId)! });
        else if (a.kind === 'opening-edge' && map.has(a.openingId)) anchors.push({ ...a, openingId: map.get(a.openingId)! });
      }
      if (anchors.length !== d.anchors.length) { skipped.push({ entityId: d.id, reason: 'DIMENSION_ANCHOR_NOT_ON_TEMPLATE' }); continue; }
      dimensions.push({ ...d, id: regeneratedId(version, id, d.id), levelId: id, anchors });
      added++;
    }
    perLevel.push({ levelId: id, removed: counts(m, id), added: { spaces: tSpaces.length, walls: tWalls.length, openings: tOpenings.length, dimensions: added } });
  }
  const removedAll = new Set([...removedIds, ...m.dimensions.filter(d => d.levelId !== undefined && targetSet.has(d.levelId)).map(d => d.id)]);
  const inUse = idsInUse(m, removedAll), fresh = [...spaces, ...walls, ...openings, ...dimensions].map(e => e.id);
  if (fresh.some(id => inUse.has(id)) || new Set(fresh).size !== fresh.length)
    return refused([{ code: 'ID_COLLISION', detail: 'A regenerated entity id is already in use in this revision' }], TYPICAL_FLOOR_SCOPE);
  const keep = <T extends { levelId?: string | undefined }>(xs: readonly T[]) => xs.filter(x => !(x.levelId !== undefined && targetSet.has(x.levelId)));
  const candidate: Model = { ...m, spaces: [...keep(m.spaces), ...spaces], walls: [...keep(m.walls), ...walls], openings: [...keep(m.openings), ...openings],
    dimensions: [...keep(m.dimensions), ...dimensions] };
  const allowed: Allowed = (c, e) => (c === 'spaces' || c === 'walls' || c === 'openings' || c === 'dimensions') && e.levelId !== undefined && targetSet.has(e.levelId);
  const within = (xs: readonly { levelId?: string | undefined; fromLevelId?: string; toLevelId?: string }[]) => xs.filter(x => [x.levelId, x.fromLevelId, x.toLevelId].some(l => l && targetSet.has(l))).length;
  return { refusals: [], candidate, allowed, allowedChange: TYPICAL_FLOOR_SCOPE,
    changes: { regeneratedLevelIds: targets, levels: perLevel, wallsRegenerated: walls.length, ...listed(skipped) },
    preservedInTarget: [
      { item: 'LEVELS', count: targets.length, detail: 'Elevations, floor-to-floor heights and envelopes of the regenerated storeys' },
      { item: 'SLABS', count: within(m.slabs), detail: 'Floor, roof and ceiling slabs of the regenerated storeys, with their voids' },
      { item: 'COLUMNS', count: within(m.columns), detail: 'Columns of the regenerated storeys (geometry only)' },
      { item: 'STAIRS', count: within(m.stairs), detail: 'Stair flights and landings leaving or arriving at the regenerated storeys' },
      { item: 'TEMPLATE_STOREY', count: 1, detail: 'The template storey itself is read, never changed' },
    ] };
}

// ---------------------------------------------------------------- FENESTRATION

const FENESTRATION_SCOPE = 'Windows hosted on the regenerated exterior walls only. Walls, doors and other openings, spaces, slabs, columns, stairs, dimensions, the site and every other storey must be identical.';

/** Closed intervals along a wall, merged; the free intervals are what is left of [0, length]. */
function freeIntervals(blocked: [number, number][], length: number): [number, number][] {
  const sorted = blocked.map(([a, b]) => [Math.max(0, a), Math.min(length, b)] as [number, number]).filter(([a, b]) => a <= b).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const free: [number, number][] = []; let at = 0;
  for (const [a, b] of sorted) { if (a > at) free.push([at, a]); at = Math.max(at, b); }
  if (at < length) free.push([at, length]);
  return free;
}

/**
 * Window layout on one axis-aligned wall (offsets from the path start, as hosted openings are measured). Blocked: the end clearance at both ends,
 * every wall meeting or crossing this one (half its thickness, rounded up, plus the clearance) and every kept door or opening (plus the gap).
 * In each free interval the largest number of windows that fit at the minimum gap is placed as one group, centred (floor of the half slack).
 */
function layoutWall(m: Model, w: Wall, rule: WindowRule): { offsets: number[] } | { skip: string } {
  const horizontal = w.path.start.z === w.path.end.z, vertical = w.path.start.x === w.path.end.x;
  if (horizontal === vertical) return { skip: 'WALL_NOT_AXIS_ALIGNED' };
  if (w.heightMm === null || w.thicknessMm === null || w.baseOffsetMm === null) return { skip: 'WALL_CONSTRUCTION_INCOMPLETE' };
  if (rule.sillMm + rule.heightMm > w.heightMm) return { skip: 'WINDOW_EXCEEDS_WALL_HEIGHT' };
  const axis = horizontal ? 'x' : 'z', across = horizontal ? 'z' : 'x', s0 = w.path.start[axis], dir = Math.sign(w.path.end[axis] - s0);
  const length = Math.abs(w.path.end[axis] - s0), line = w.path.start[across], pos = (c: number) => (c - s0) * dir, ec = rule.edgeClearanceMm;
  const blocked: [number, number][] = [[0, ec], [length - ec, length]];
  for (const o of m.walls) {
    if (o.id === w.id || o.levelId !== w.levelId) continue;
    const oh = o.path.start.z === o.path.end.z, ov = o.path.start.x === o.path.end.x, half = Math.ceil((o.thicknessMm ?? 0) / 2);
    if (oh === ov) { if (segmentsTouch(w.path.start, w.path.end, o.path.start, o.path.end)) return { skip: 'NON_ORTHOGONAL_JUNCTION' }; continue; }
    if (oh === horizontal) {
      if (o.path.start[across] !== line) continue;
      const a = pos(o.path.start[axis]), b = pos(o.path.end[axis]);
      blocked.push([Math.min(a, b) - ec, Math.max(a, b) + ec]);
    } else {
      const lo = Math.min(o.path.start[across], o.path.end[across]), hi = Math.max(o.path.start[across], o.path.end[across]), p = pos(o.path.start[axis]);
      if (line < lo || line > hi || p < 0 || p > length) continue;
      blocked.push([p - half - ec, p + half + ec]);
    }
  }
  for (const o of m.openings) if (o.wallId === w.id && o.kind !== 'window') blocked.push([o.offsetMm - rule.gapMm, o.offsetMm + o.widthMm + rule.gapMm]);
  const offsets: number[] = [];
  for (const [a, b] of freeIntervals(blocked, length)) {
    const free = b - a, n = Math.floor((free + rule.gapMm) / (rule.widthMm + rule.gapMm));
    if (n < 1) continue;
    const start = a + Math.floor((free - (n * rule.widthMm + (n - 1) * rule.gapMm)) / 2);
    for (let k = 0; k < n; k++) offsets.push(start + k * (rule.widthMm + rule.gapMm));
  }
  return { offsets };
}

function fenestration(m: Model, targetIds: readonly string[], facades: readonly Facade[], rule: WindowRule): OperationResult {
  const version = OPERATION_VERSIONS.FENESTRATION, targetSet = new Set(targetIds), all = facades.length === FACADES.length;
  if (m.parametricArchitecture) return refused([{ code: 'PARAMETRIC_MODEL', detail: 'A parametric model is regenerated by changing its parameters, not by editing its openings' }], FENESTRATION_SCOPE);
  if (!all && !northResolvable(m)) return refused([{ code: 'FACADE_ORIENTATION_UNKNOWN', detail: 'Site north is absent or not a multiple of 90°, so the requested façades cannot be resolved to walls' }], FENESTRATION_SCOPE);
  const skipped: { entityId: string; reason: string }[] = [], regenerated = new Map<string, number[]>();
  for (const w of byId(m.walls)) {
    if (!targetSet.has(w.levelId) || w.classification !== 'exterior') continue;
    if (!all) { const f = wallFacade(m, w); if (f === null) { skipped.push({ entityId: w.id, reason: 'FACADE_UNRESOLVED' }); continue; } if (!facades.includes(f)) continue; }
    const layout = layoutWall(m, w, rule);
    if ('skip' in layout) skipped.push({ entityId: w.id, reason: layout.skip }); else regenerated.set(w.id, layout.offsets);
  }
  if (!regenerated.size) return refused([{ code: 'NO_EXTERIOR_WALLS_IN_SCOPE', detail: `No exterior wall on the target storeys and façades can be regenerated (${skipped.length} skipped)` }], FENESTRATION_SCOPE);
  const removed = new Set(m.openings.filter(o => o.kind === 'window' && regenerated.has(o.wallId)).map(o => o.id));
  const refusals = m.dimensions.filter(d => anchoredEntities(d).some(e => removed.has(e)))
    .map(d => ({ code: 'DIMENSION_DEPENDS_ON_REPLACED_ENTITY', detail: `Dimension ${d.id.slice(0, 150)} measures a window that would be replaced` }));
  if (refusals.length) return refused(refusals, FENESTRATION_SCOPE);
  const walls = new Map(m.walls.map(w => [w.id, w])), windows: Opening[] = [];
  for (const [wallId, offsets] of regenerated) offsets.forEach((offsetMm, k) => windows.push({ id: regeneratedId(version, wallId, `window-${k}`), kind: 'window', wallId,
    levelId: walls.get(wallId)!.levelId, offsetMm, widthMm: rule.widthMm, heightMm: rule.heightMm, sillMm: rule.sillMm, type: rule.type }));
  const inUse = idsInUse(m, removed);
  if (windows.some(o => inUse.has(o.id))) return refused([{ code: 'ID_COLLISION', detail: 'A regenerated window id is already in use in this revision' }], FENESTRATION_SCOPE);
  const candidate: Model = { ...m, openings: [...m.openings.filter(o => !removed.has(o.id)), ...windows] };
  const allowed: Allowed = (c, e) => c === 'openings' && e.kind === 'window' && e.wallId !== undefined && regenerated.has(e.wallId);
  const perLevel = targetIds.map(levelId => ({ levelId, removed: { ...zero, openings: m.openings.filter(o => removed.has(o.id) && o.levelId === levelId).length },
    added: { ...zero, openings: windows.filter(o => o.levelId === levelId).length } }));
  const onTarget = (xs: readonly { levelId?: string | undefined; fromLevelId?: string; toLevelId?: string }[]) => xs.filter(x => [x.levelId, x.fromLevelId, x.toLevelId].some(l => l && targetSet.has(l))).length;
  return { refusals: [], candidate, allowed, allowedChange: FENESTRATION_SCOPE,
    changes: { regeneratedLevelIds: [...targetIds], levels: perLevel, wallsRegenerated: regenerated.size, ...listed(skipped) },
    preservedInTarget: [
      { item: 'EXTERIOR_WALLS', count: regenerated.size, detail: 'The regenerated walls keep their path, thickness, height, classification and space topology' },
      { item: 'DOORS_AND_OTHER_OPENINGS', count: m.openings.filter(o => regenerated.has(o.wallId) && o.kind !== 'window').length, detail: 'Doors and generic openings on the regenerated walls are kept and laid around' },
      { item: 'OTHER_WALLS_AND_OPENINGS', count: m.walls.filter(w => targetSet.has(w.levelId) && !regenerated.has(w.id)).length, detail: 'Interior, unclassified, skipped and other-façade walls with all their openings' },
      { item: 'SPACES', count: onTarget(m.spaces), detail: 'Rooms on the target storeys' },
      { item: 'SLABS', count: onTarget(m.slabs), detail: 'Slabs and their voids' },
      { item: 'COLUMNS', count: onTarget(m.columns), detail: 'Columns (geometry only)' },
      { item: 'STAIRS', count: onTarget(m.stairs), detail: 'Stairs leaving or arriving at the target storeys' },
      { item: 'DIMENSIONS', count: onTarget(m.dimensions), detail: 'Dimension annotations (none may measure a replaced window)' },
    ] };
}

// ---------------------------------------------------------------- report

const qaSummary = (r: ReturnType<QaRunner>): QaSummary => ({ status: r.status, errors: r.summary.errors, warnings: r.summary.warnings,
  findings: r.findings.filter(f => f.severity !== 'INFO' || r.status === 'FAIL').slice(0, REGENERATION_LIMITS.qaFindings)
    .map(f => ({ code: f.code.slice(0, 100), severity: f.severity, entityIds: f.entityIds.slice(0, 5).map(id => id.slice(0, 200)) })) });
const schemaIssues = (error: { issues: { path: (string | number)[]; message: string }[] }) =>
  error.issues.slice(0, 3).map(i => `${i.path.join('.') || '(model)'}: ${i.message}`).join('; ').slice(0, 300);

type Outcome = { report: RegenerationReport; allowed: Allowed | null; candidate: Model | null };

/**
 * Selective regeneration of a zone, section or exterior skin of a stored revision. Deterministic for (model, canonical request); derived on read
 * and never committed. A candidate is returned only when it parses as Building Model V2, changes nothing outside the operation's allowed scope
 * (entity-level comparison; any violation refuses it) and passes the same acceptance QA the supplied-revision save runs.
 */
export function runRegeneration(ctx: ZoneContext, request: RegenerationRequest, deps: { qa: QaRunner }): Outcome {
  const { model, ids } = ctx, { height, resolved } = prepare(model, ids, request.zones);
  if (resolved.issues.length) throw new ZoneRequestError('ZONE_DECLARATION_INVALID', 'The zone declaration is invalid for this model', resolved.issues.map(i => `${i.code}: ${i.detail}`));
  const t = request.target, op = request.operation, { target, preserved } = resolveTarget(model, height.storeys, resolved.zones, t);
  const targetIds = target.storeys.map(s => s.levelId), facades = t.kind === 'EXTERIOR_SKIN' ? (t.facades ?? [...FACADES]) : null;
  const result = op.kind === 'TYPICAL_FLOOR'
    ? typicalFloor(model, new Map(height.storeys.map(s => [s.levelId, s.storeyHeightMm])), targetIds, op.templateLevelId, height.storeys[0]!.levelId)
    : fenestration(model, targetIds, facades!, op.window);
  const refusals = [...result.refusals];
  let candidate = result.candidate, check: PreservationCheck | null = null, qa: QaSummary | null = null, candidateHash: string | null = null;
  if (candidate && !refusals.length) {
    const parsed = ArchitecturalBuildingModelV2Schema.safeParse(candidate);
    if (!parsed.success) refusals.push({ code: 'CANDIDATE_SCHEMA_INVALID', detail: schemaIssues(parsed.error) });
    else {
      candidate = parsed.data;
      check = preservationCheck(model, candidate, result.allowed!);
      candidateHash = modelHash(candidate);
      if (check.status === 'OUT_OF_SCOPE_CHANGES') refusals.push({ code: 'PRESERVATION_VIOLATION', detail: `${check.outOfScope} change(s) outside the allowed scope; the candidate is refused` });
      else if (candidateHash !== ids.modelHash) {
        qa = qaSummary(deps.qa(candidate));
        if (qa.status === 'FAIL') refusals.push({ code: 'QA_REJECTED', detail: `Acceptance QA rejects the candidate with ${qa.errors} error(s); the findings are listed under qa` });
      }
    }
  }
  const status = refusals.length ? 'REFUSED' as const : !candidate || candidateHash === ids.modelHash ? 'NO_CHANGE' as const : 'CANDIDATE_READY' as const;
  const ready = status === 'CANDIDATE_READY';
  const operation = { kind: op.kind, operationVersion: OPERATION_VERSIONS[op.kind], templateLevelId: op.kind === 'TYPICAL_FLOOR' ? op.templateLevelId : null,
    window: op.kind === 'FENESTRATION' ? op.window : null };
  const route = (r: string) => r.replace(':projectId', ids.projectId).replace(':revisionId', ids.revisionId);
  const inputHash = costHash({ regenerationVersion: REGENERATION_VERSION, operationVersion: operation.operationVersion, modelHash: ids.modelHash,
    zones: canonicalDeclarations(request.zones), target: t, operation: op });
  const body = {
    regenerationVersion: REGENERATION_VERSION, ...ids, inputHash, sourceRevision: ctx.sourceRevision, status, refusals: refusals.slice(0, REGENERATION_LIMITS.listed),
    declaration: { source: resolved.source, status: 'VALID' as const, issues: [] },
    target: { kind: t.kind, zoneKey: target.key, zoneId: zoneId(targetIds), levelIds: targetIds, facades },
    operation, changes: result.changes,
    preservation: check && candidate ? { allowedChange: result.allowedChange, check, preservedInTarget: result.preservedInTarget,
      preservedZones: preserved.map(p => { const set = new Set(p.levelIds); return { zoneKey: p.zoneKey, zoneId: zoneId(p.levelIds), levelIds: p.levelIds,
        identical: levelContentHash(model, set) === levelContentHash(candidate!, set) }; }) } : null,
    qa, candidate: ready ? { modelHash: candidateHash!, model: candidate! } : null,
    commit: ready ? { method: 'POST' as const, route: route('/api/projects/:projectId/revisions'), baseRevisionId: ids.revisionId, expectedModelHash: candidateHash!,
      detail: 'Save candidate.model with this revision as baseRevisionId. The save re-runs acceptance QA and succeeds only while this revision is still the project\'s current revision; then verify it at verificationRoute.' } : null,
    // :revisionId stays a parameter: verification runs on the committed revision, which does not exist yet.
    verificationRoute: '/api/projects/:projectId/revisions/:revisionId/engineering-assessment/zones/regeneration/verification'.replace(':projectId', ids.projectId),
    dependencies: DEPENDENT_ARTIFACTS.map(artifact => ({ artifact, impact: 'NOT_APPLICABLE_TO_CANDIDATE' as const,
      detail: 'Derived from this revision\'s geometry: results for it do not apply to the candidate, which needs its own computation once committed' })),
    limitations: REGENERATION_LIMITATIONS, claims: { ...NOT_CLAIMED_REGENERATION },
  };
  const report = RegenerationReportSchema.parse({ ...body, resultHash: costHash(body), currency: ctx.currency, generatedAt: ctx.generatedAt });
  return { report, allowed: result.allowed, candidate: ready ? candidate : null };
}

export const regenerate = (ctx: ZoneContext, request: RegenerationRequest, deps: { qa: QaRunner }) => runRegeneration(ctx, request, deps).report;

/**
 * Verifies that a committed revision is exactly the stated regeneration of its parent: the regeneration is recomputed from the parent and the
 * committed model must have the same canonical model hash. Independently, the committed revision is compared with its parent under the
 * operation's allowed scope, and with the recomputed candidate under an empty scope, so any deviation is listed by entity.
 */
export function verifyRegeneration(committed: { ids: { projectId: string; revisionId: string; modelHash: string }; model: Model }, parent: ZoneContext | null,
  request: RegenerationRequest, deps: { qa: QaRunner }, generatedAt: string): RegenerationVerificationReport {
  const op = request.operation, operation = { kind: op.kind, operationVersion: OPERATION_VERSIONS[op.kind], templateLevelId: op.kind === 'TYPICAL_FLOOR' ? op.templateLevelId : null,
    window: op.kind === 'FENESTRATION' ? op.window : null };
  const inputHash = costHash({ verificationVersion: REGENERATION_VERIFICATION_VERSION, modelHash: committed.ids.modelHash, parentModelHash: parent?.ids.modelHash ?? null,
    zones: canonicalDeclarations(request.zones), target: request.target, operation: op });
  let body;
  if (!parent) body = { status: 'NO_PARENT' as const, detail: 'The revision has no parent revision, so it cannot be a regeneration of one', parentRevisionId: null, parentModelHash: null,
    target: null, recomputed: null, preservation: null, deviation: null };
  else {
    const { report, allowed, candidate } = runRegeneration(parent, request, deps);
    const recomputed = { status: report.status, modelHash: report.candidate?.modelHash ?? null, refusals: report.refusals };
    const preservation = allowed ? preservationCheck(parent.model, committed.model, allowed) : null;
    const common = { parentRevisionId: parent.ids.revisionId, parentModelHash: parent.ids.modelHash, target: report.target, recomputed, preservation };
    if (!candidate) body = { ...common, status: 'NOT_REPRODUCIBLE' as const, deviation: null,
      detail: `The regeneration recomputed from the parent revision is ${report.status}, so no candidate exists to compare with` };
    else {
      const verified = report.candidate!.modelHash === committed.ids.modelHash;
      body = { ...common, status: verified ? 'VERIFIED' as const : 'MISMATCH' as const, deviation: preservationCheck(candidate, committed.model, () => false),
        detail: verified ? 'The committed model has the canonical hash of the regeneration recomputed from its parent'
          : 'The committed model differs from the regeneration recomputed from its parent; the deviations are listed' };
    }
  }
  const full = { verificationVersion: REGENERATION_VERIFICATION_VERSION, ...committed.ids, inputHash, operation, ...body, claims: { ...NOT_CLAIMED_REGENERATION } };
  return RegenerationVerificationReportSchema.parse({ ...full, resultHash: costHash(full), generatedAt });
}
