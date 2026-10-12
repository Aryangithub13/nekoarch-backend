import { createHash } from 'node:crypto';
import { abs, ringContains, ringsOverlap, signedArea2, type BuildingModelV2, type Point2Mm } from '@designflow/shared';
import { costHash } from '@designflow/boq-cost';
import { verifyModel } from '../verification/verify.js';
import { VERIFIER_VERSION } from '../verification/contracts.js';
import { wallFacade } from '../revision/appearance.js';
import { FORMULAS } from './contracts.js';
import { areaString, doubled, storeyHeights, type Height } from './geometry.js';
import { bimProfile } from './capability-limits.js';
import { FACADES, NOT_CLAIMED_PREFLIGHT, NOT_CLAIMED_ZONES, ZONE_ASSESSMENT_VERSION, ZONE_IDENTITY_VERSION, ZONE_LIMITS, ZONE_PREFLIGHT_VERSION,
  ZoneAssessmentReportSchema, ZonePreflightReportSchema, type ElementCounts, type InterfaceCheck, type ZoneAssessmentReport, type ZoneAssessmentRequest,
  type ZoneDeclaration, type ZonePreflightReport, type ZonePreflightRequest, type ZoneResult } from './zone-contracts.js';

type Storey = Height['storeys'][number];
type Issue = ZoneAssessmentReport['declaration']['issues'][number];
type Facade = typeof FACADES[number];
export type ZoneIds = { projectId: string; revisionId: string; modelHash: string };
export type SourceRevision = ZoneAssessmentReport['sourceRevision'];
export type Currency = ZoneAssessmentReport['currency'];
export type ResolvedZone = { key: string; start: number; end: number; storeys: Storey[] };

export const ZONE_LIMITATIONS = [
  'Zone assessment is geometric analysis of the stored model. It groups storeys for analysis only: it does not partition, generate or regenerate the model, and BIM-derived services still process (or refuse) the whole model.',
  'Interface checks compare only geometry the model represents. Building Model V2 has no shaft, lift or riser elements, so their continuity is never evaluated.',
  'An interface elevation is checked only where the lower storey declares its floor-to-floor height; a height derived from the next storey is not independent evidence.',
  'Façade groupings need a site north that is a multiple of 90°; otherwise they are reported as not resolved.',
  'No structural, wind, seismic, fire-safety, vertical-transport or code-compliance determination is made or implied by any zone result.',
];

/** Stable zone identity: depends only on the ordered storey level ids, so the same storeys keep the same zone id across revisions and keys. */
export const zoneId = (levelIds: readonly string[]) => createHash('sha256').update(`${ZONE_IDENTITY_VERSION}\n${levelIds.join('\n')}`).digest('hex');

const bounds = (ring: readonly Point2Mm[]) => ring.reduce((b, p) => ({ minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x), minZ: Math.min(b.minZ, p.z),
  maxZ: Math.max(b.maxZ, p.z) }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });

/**
 * Exact region equality of two simple rings: the same closed region whatever the start vertex, the orientation or any redundant collinear
 * vertex. It uses the containment predicate acceptance QA uses (ringContains, integer arithmetic, no tolerance) in both directions, after exact
 * bounding-box and area rejections; two rings that each fill the same bounding box (rectangles, as QA requires of stair footprints) are equal.
 */
export function sameRegion(a: readonly Point2Mm[], b: readonly Point2Mm[]): boolean {
  const ba = bounds(a), bb = bounds(b), area = abs(signedArea2(a));
  if (ba.minX !== bb.minX || ba.maxX !== bb.maxX || ba.minZ !== bb.minZ || ba.maxZ !== bb.maxZ || area !== abs(signedArea2(b))) return false;
  if (area === 2n * BigInt(ba.maxX - ba.minX) * BigInt(ba.maxZ - ba.minZ)) return true;
  return ringContains(a, b) && ringContains(b, a);
}

/** Canonical form of a declaration list for hashing: order by key (keys are unique), so listing order never changes a hash. */
export const canonicalDeclarations = (zones: readonly ZoneDeclaration[] | undefined) =>
  zones ? [...zones].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(z => ({ key: z.key, fromLevelId: z.fromLevelId, toLevelId: z.toLevelId })) : null;

/**
 * Validates declared zones against the model's storeys (ordered exactly as the B35 height formula orders them). Problems are reported, never
 * repaired: a declaration is VALID only when every zone names two storeys in ascending order and the zones cover every storey once, contiguously.
 */
export function resolveZones(model: BuildingModelV2, storeys: readonly Storey[], declared: readonly ZoneDeclaration[] | undefined) {
  const issues: Issue[] = [], position = new Map(storeys.map((s, i) => [s.levelId, i])), levelKind = new Map(model.levels.map(l => [l.id, l.kind]));
  const ids = (from: number, to: number) => storeys.slice(from, to + 1).map(s => s.levelId);
  const listed = (levelIds: string[]) => levelIds.slice(0, ZONE_LIMITS.listedElementIds);
  if (!storeys.length) return { source: declared ? 'DECLARED' as const : 'DEFAULT_SINGLE_ZONE' as const, issues: [{ code: 'NO_STOREYS' as const, zoneKeys: [], levelIds: [],
    detail: 'The model has no storey levels to group into zones' }], zones: [] as ResolvedZone[] };
  const declarations = declared ?? [{ key: 'ALL', fromLevelId: storeys[0]!.levelId, toLevelId: storeys.at(-1)!.levelId }];
  const ranges: ResolvedZone[] = [];
  for (const d of declarations) {
    const bad = [d.fromLevelId, d.toLevelId].filter((id, i, a) => a.indexOf(id) === i);
    const unknown = bad.filter(id => !levelKind.has(id)), notStorey = bad.filter(id => levelKind.has(id) && !position.has(id));
    if (unknown.length) issues.push({ code: 'UNKNOWN_LEVEL', zoneKeys: [d.key], levelIds: unknown, detail: `Zone ${d.key} names a level that is not in the model` });
    if (notStorey.length) issues.push({ code: 'NOT_A_STOREY', zoneKeys: [d.key], levelIds: notStorey, detail: `Zone ${d.key} names a roof or datum level; zones contain storeys only` });
    if (unknown.length || notStorey.length) continue;
    const start = position.get(d.fromLevelId)!, end = position.get(d.toLevelId)!;
    if (start > end) { issues.push({ code: 'REVERSED_RANGE', zoneKeys: [d.key], levelIds: [d.fromLevelId, d.toLevelId], detail: `Zone ${d.key} runs from a higher storey to a lower one` }); continue; }
    ranges.push({ key: d.key, start, end, storeys: storeys.slice(start, end + 1) });
  }
  if (!issues.length) {
    ranges.sort((a, b) => a.start - b.start || a.end - b.end || (a.key < b.key ? -1 : 1));
    let coveredTo = -1, last: ResolvedZone | null = null;
    for (const r of ranges) {
      if (last && r.start <= coveredTo) issues.push({ code: 'OVERLAP', zoneKeys: [last.key, r.key], levelIds: listed(ids(r.start, Math.min(r.end, coveredTo))),
        detail: `Zones ${last.key} and ${r.key} share storeys` });
      else if (r.start > coveredTo + 1 && last) issues.push({ code: 'GAP', zoneKeys: [last.key, r.key], levelIds: listed(ids(coveredTo + 1, r.start - 1)),
        detail: `Storeys between zones ${last.key} and ${r.key} belong to no zone` });
      if (r.end > coveredTo) { coveredTo = r.end; last = r; }
    }
    const first = ranges[0]!;
    if (first.start > 0) issues.push({ code: 'INCOMPLETE_COVERAGE', zoneKeys: [first.key], levelIds: listed(ids(0, first.start - 1)), detail: 'Storeys below the lowest zone belong to no zone' });
    if (coveredTo < storeys.length - 1) issues.push({ code: 'INCOMPLETE_COVERAGE', zoneKeys: [last!.key], levelIds: listed(ids(coveredTo + 1, storeys.length - 1)),
      detail: 'Storeys above the highest zone belong to no zone' });
  }
  return { source: declared ? 'DECLARED' as const : 'DEFAULT_SINGLE_ZONE' as const, issues, zones: issues.length ? [] : ranges };
}

function elementCounts(model: BuildingModelV2, levelIds: ReadonlySet<string>): ElementCounts {
  const on = (x: { levelId: string }) => levelIds.has(x.levelId);
  return { spaces: model.spaces.filter(on).length, walls: model.walls.filter(on).length, exteriorWalls: model.walls.filter(w => on(w) && w.classification === 'exterior').length,
    openings: model.openings.filter(on).length, slabs: model.slabs.filter(on).length, columns: model.columns.filter(on).length,
    stairsWithin: model.stairs.filter(s => levelIds.has(s.fromLevelId) && levelIds.has(s.toLevelId)).length };
}

const northResolvable = (model: BuildingModelV2) => { const n = model.site?.northMilliDegrees; return n !== null && n !== undefined && n % 90_000 === 0; };

function exteriorSkin(model: BuildingModelV2, levelIds: ReadonlySet<string>) {
  const walls = model.walls.filter(w => levelIds.has(w.levelId)), exterior = walls.filter(w => w.classification === 'exterior');
  const unclassifiedWalls = walls.filter(w => w.classification === 'unspecified').length;
  if (!northResolvable(model)) return { basis: 'WALL_CLASSIFICATION' as const, exteriorWalls: exterior.length, unclassifiedWalls, byFacade: null, facadeBasis: 'NOT_RESOLVED' as const };
  const byFacade: Record<Facade | 'UNRESOLVED', number> = { NORTH: 0, EAST: 0, SOUTH: 0, WEST: 0, UNRESOLVED: 0 };
  for (const w of exterior) byFacade[wallFacade(model, w) ?? 'UNRESOLVED']++;
  return { basis: 'WALL_CLASSIFICATION' as const, exteriorWalls: exterior.length, unclassifiedWalls, byFacade, facadeBasis: 'SITE_NORTH_ORTHOGONAL' as const };
}

function zoneResult(model: BuildingModelV2, z: ResolvedZone): ZoneResult {
  const levelIds = z.storeys.map(s => s.levelId), set = new Set(levelIds), top = z.storeys.at(-1)!, bottom = z.storeys[0]!;
  const topMm = top.storeyHeightMm === null ? null : top.elevationMm + top.storeyHeightMm;
  const gfa2 = z.storeys.reduce((sum, s) => sum + doubled(s.grossPlateAreaMm2), 0n);
  const volume2 = z.storeys.some(s => s.storeyHeightMm === null) ? null : z.storeys.reduce((sum, s) => sum + doubled(s.grossPlateAreaMm2) * BigInt(s.storeyHeightMm!), 0n);
  const blockers: ZoneResult['blockers'] = [];
  if (topMm === null) blockers.push({ code: 'ZONE_TOP_UNDETERMINED', detail: 'The uppermost storey of this zone has no determinable height, so the zone height is not reported' });
  if (volume2 === null) blockers.push({ code: 'ZONE_VOLUME_UNDETERMINED', detail: 'A storey in this zone has no determinable height, so the zone volume is not reported' });
  if (z.storeys.some(s => s.plateMethod !== 'RECTILINEAR_SLAB_UNION'))
    blockers.push({ code: 'PLATE_AREA_FALLBACK', detail: 'Some plate areas come from the level boundary rather than an exact slab union (see the B34 verification report)' });
  const skin = exteriorSkin(model, set);
  if (skin.facadeBasis === 'NOT_RESOLVED') blockers.push({ code: 'FACADE_ORIENTATION_UNKNOWN', detail: 'Site north is absent or not a multiple of 90°, so exterior walls are not grouped by façade' });
  if (skin.unclassifiedWalls) blockers.push({ code: 'UNCLASSIFIED_WALLS', detail: 'Some walls in this zone are not classified as exterior or interior, so the exterior skin may be incomplete' });
  return { key: z.key, zoneId: zoneId(levelIds), fromLevelId: bottom.levelId, toLevelId: top.levelId, levelIds, storeyCount: levelIds.length,
    bottomElevationMm: bottom.elevationMm, topMm, heightMm: topMm === null ? null : topMm - bottom.elevationMm, grossFloorAreaMm2: areaString(gfa2),
    grossVolumeMm3: volume2 === null ? null : areaString(volume2), elements: elementCounts(model, set), exteriorSkin: skin, blockers };
}

const check = (c: InterfaceCheck['check'], status: InterfaceCheck['status'], detail: string, extra: Partial<InterfaceCheck> = {}): InterfaceCheck =>
  ({ check: c, status, entityIds: [], measured: null, required: null, blocker: null, detail, ...extra });
const blocked = (c: InterfaceCheck['check'], code: string, detail: string): InterfaceCheck => check(c, 'NOT_EVALUATED', detail, { blocker: { code, detail } });

/** The six interface checks between two vertically adjacent zones. Each uses only represented geometry; a missing input is NOT_EVALUATED, never a pass. */
function interfaceChecks(model: BuildingModelV2, storeys: readonly Storey[], lower: Storey, upper: Storey): InterfaceCheck[] {
  const position = new Map(storeys.map((s, i) => [s.levelId, i])), at = (id: string) => position.get(id);
  const lo = at(lower.levelId)!, hi = at(upper.levelId)!;
  const spanning = model.stairs.filter(s => { const f = at(s.fromLevelId), t = at(s.toLevelId); return f !== undefined && t !== undefined && f <= lo && t >= hi; })
    .sort((a, b) => a.id < b.id ? -1 : 1);
  const levelOf = new Map(model.levels.map(l => [l.id, l])), lowerLevel = levelOf.get(lower.levelId)!, upperLevel = levelOf.get(upper.levelId)!;
  const out: InterfaceCheck[] = [];

  // A declared floor-to-floor height reaches the next represented level of any kind (Building Model V2 invariant, QA_LEVEL_HEIGHT_MISMATCH);
  // a datum or roof level may lie between the zones without ending the lower storey.
  const declared = lowerLevel.floorToFloorHeightMm;
  const between = model.levels.filter(l => l.index > lowerLevel.index && l.index < upperLevel.index).sort((a, b) => a.index - b.index);
  const following = between[0] ?? upperLevel;
  if (declared === null) out.push(blocked('INTERFACE_ELEVATION', 'FLOOR_TO_FLOOR_NOT_DECLARED', 'The lower storey declares no floor-to-floor height, so there is no declared value to compare'));
  else {
    const reach = lowerLevel.elevationMm + declared, via = between.length ? ` (the ${following.kind} level ${following.id}, between the zones; the lower storey continues to the upper storey floor)` : '';
    out.push(check('INTERFACE_ELEVATION', reach === following.elevationMm ? 'PASS' : 'FAIL', reach === following.elevationMm
      ? `The lower storey's declared floor-to-floor height reaches the next represented level exactly${via}`
      : `The lower storey's declared floor-to-floor height does not reach the next represented level${via}`,
    { entityIds: [lower.levelId, ...between.map(l => l.id), upper.levelId].slice(0, ZONE_LIMITS.listedElementIds), measured: String(reach), required: String(following.elevationMm) }));
  }

  out.push(spanning.length
    ? check('STAIR_CONNECTION', 'PASS', 'At least one modelled stair crosses this interface', { entityIds: spanning.slice(0, ZONE_LIMITS.listedElementIds).map(s => s.id), measured: String(spanning.length) })
    : check('STAIR_CONNECTION', 'WARNING', 'No modelled stair crosses this interface. Lifts and shafts are not represented in the model; no circulation or egress rule is applied', { measured: '0' }));

  // The opening rules of acceptance QA, applied at the upper storey: QA_STAIR_VOID_MISSING (a flight ending here needs a floor at its endpoint
  // elevation with a void containing the whole flight) and QA_STAIR_SOLID_INTERFERENCE (a slab whose top lies within the flight's rise and
  // overlaps it needs a containing void). Containment, not vertex equality: an equivalent opening with other vertices is the same opening.
  const upperSlabs = model.slabs.filter(s => s.levelId === upper.levelId);
  const contained = (slab: BuildingModelV2['slabs'][number], stair: BuildingModelV2['stairs'][number]) => slab.footprint.voids.some(v => ringContains(v, stair.footprint));
  const opened = (stair: BuildingModelV2['stairs'][number]) => {
    const from = levelOf.get(stair.fromLevelId)!, to = levelOf.get(stair.toLevelId)!;
    const endpoint = stair.toLevelId !== upper.levelId || upperSlabs.some(p => p.kind === 'floor' && p.topOffsetMm === 0 && contained(p, stair));
    return endpoint && upperSlabs.every(p => {
      const top = upperLevel.elevationMm + p.topOffsetMm;
      return !(top > from.elevationMm && top <= to.elevationMm && ringsOverlap(p.footprint.outer, stair.footprint)) || contained(p, stair);
    });
  };
  if (!spanning.length) out.push(blocked('STAIR_SLAB_VOID', 'NO_STAIR_ACROSS_INTERFACE', 'No stair crosses this interface, so there is no stair opening to check'));
  else if (!upperSlabs.length && !spanning.some(s => s.toLevelId === upper.levelId))
    out.push(blocked('STAIR_SLAB_VOID', 'NO_SLAB_AT_UPPER_LEVEL', 'The upper storey has no slab in the model, so no stair opening is required there or can be checked'));
  else {
    const missingVoid = spanning.filter(s => !opened(s));
    out.push(missingVoid.length
      ? check('STAIR_SLAB_VOID', 'FAIL', 'A stair crossing this interface has no slab void at the upper storey containing its whole flight where acceptance QA requires one',
        { entityIds: missingVoid.slice(0, ZONE_LIMITS.listedElementIds).map(s => s.id), measured: String(missingVoid.length), required: '0' })
      : check('STAIR_SLAB_VOID', 'PASS', 'Every stair crossing this interface has a slab void at the upper storey containing its whole flight where acceptance QA requires one',
        { entityIds: spanning.slice(0, ZONE_LIMITS.listedElementIds).map(s => s.id) }));
  }

  const below = model.stairs.filter(s => s.toLevelId === lower.levelId), above = model.stairs.filter(s => s.fromLevelId === upper.levelId);
  if (!below.length || !above.length) out.push(blocked('STAIR_FOOTPRINT_CONTINUITY', 'NO_ADJACENT_FLIGHTS', 'There is no flight arriving at the lower storey or no flight leaving the upper storey to compare'));
  else {
    const continuous = below.some(b => above.some(a => sameRegion(a.footprint, b.footprint)));
    out.push(continuous
      ? check('STAIR_FOOTPRINT_CONTINUITY', 'PASS', 'A stair footprint below the interface recurs above it (the same region exactly)')
      : check('STAIR_FOOTPRINT_CONTINUITY', 'WARNING', 'No stair footprint below the interface recurs exactly above it. This may be intended (for example a transfer or scissor stair); no rule is applied',
        { entityIds: [...below, ...above].slice(0, ZONE_LIMITS.listedElementIds).map(s => s.id) }));
  }

  const unchanged = sameRegion(lowerLevel.boundary, upperLevel.boundary);
  out.push(check('ENVELOPE_CONTINUITY', 'INFO', unchanged
    ? 'The level envelope is the same region across the interface' : 'The level envelope changes across the interface (for example a setback); no rule is applied',
  { entityIds: [lower.levelId, upper.levelId], measured: unchanged ? 'UNCHANGED' : 'CHANGED' }));

  out.push(blocked('SHAFT_CONTINUITY', 'SHAFTS_NOT_REPRESENTED', 'Building Model V2 has no shaft, lift or riser elements, and slab voids are not classified, so shaft continuity cannot be evaluated'));
  return out;
}

const summarize = (checks: readonly InterfaceCheck[]) => {
  const s = { PASS: 0, FAIL: 0, WARNING: 0, INFO: 0, NOT_EVALUATED: 0 };
  for (const c of checks) s[c.status]++;
  return s;
};

export type ZoneContext = { ids: ZoneIds; model: BuildingModelV2; sourceRevision: SourceRevision; currency: Currency; generatedAt: string };

/** Shared front half of both reports: B34 plates (same as the B35 assessment) → B35 storey rows → validated zones. */
function prepare(model: BuildingModelV2, ids: ZoneIds, zones: readonly ZoneDeclaration[] | undefined) {
  const verification = verifyModel(model, ids, null), height = storeyHeights(model, verification.bases.levels);
  return { verification, height, resolved: resolveZones(model, height.storeys, zones) };
}

/** Derived on read; deterministic for (model, canonical declaration). `currency` and `generatedAt` are read-time observations outside resultHash. */
export function assessZones(ctx: ZoneContext, request: ZoneAssessmentRequest): ZoneAssessmentReport {
  const { model, ids } = ctx, { verification, height, resolved } = prepare(model, ids, request.zones);
  const zones = resolved.zones.map(z => zoneResult(model, z));
  const interfaces = resolved.zones.slice(1).map((upper, i) => {
    const lower = resolved.zones[i]!;
    return { lowerZoneKey: lower.key, upperZoneKey: upper.key, lowerLevelId: lower.storeys.at(-1)!.levelId, upperLevelId: upper.storeys[0]!.levelId,
      checks: interfaceChecks(model, height.storeys, lower.storeys.at(-1)!, upper.storeys[0]!) };
  });
  const summary = summarize(interfaces.flatMap(i => i.checks));
  const status = resolved.issues.length ? 'INVALID_DECLARATION' as const : summary.FAIL ? 'INCONSISTENT' as const
    : summary.NOT_EVALUATED || zones.some(z => z.blockers.some(b => b.code === 'ZONE_TOP_UNDETERMINED' || b.code === 'ZONE_VOLUME_UNDETERMINED')) ? 'PARTIAL' as const : 'CONSISTENT' as const;
  const inputHash = costHash({ zoneAssessmentVersion: ZONE_ASSESSMENT_VERSION, modelHash: ids.modelHash, verifierInputHash: verification.inputHash, zones: canonicalDeclarations(request.zones) });
  const body = {
    zoneAssessmentVersion: ZONE_ASSESSMENT_VERSION, ...ids, inputHash,
    engine: { zoneAssessmentVersion: ZONE_ASSESSMENT_VERSION, zoneIdentity: ZONE_IDENTITY_VERSION, verifierVersion: VERIFIER_VERSION,
      formulas: { height: FORMULAS.height, areaVolume: FORMULAS.areaVolume } },
    sourceRevision: ctx.sourceRevision, status, declaration: { source: resolved.source, status: resolved.issues.length ? 'INVALID' as const : 'VALID' as const, issues: resolved.issues },
    zones, interfaces, summary, limitations: ZONE_LIMITATIONS, claims: { ...NOT_CLAIMED_ZONES },
  };
  return ZoneAssessmentReportSchema.parse({ ...body, resultHash: costHash(body), currency: ctx.currency, generatedAt: ctx.generatedAt });
}

export class ZoneRequestError extends Error {
  constructor(readonly code: 'ZONE_DECLARATION_INVALID' | 'ZONE_TARGET_NOT_FOUND' | 'SECTION_TARGET_INVALID', message: string, readonly issues: string[]) { super(message); }
}

const DEPENDENT_ARTIFACTS = ['BIM', 'SCENE_3D', 'QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST', 'STRUCTURAL_ANALYSIS', 'ENVIRONMENTAL_ANALYSIS',
  'BUILDING_SYSTEMS_ANALYSIS', 'SPECIALIZED_KNOWLEDGE', 'DESIGN_OPTIMIZATION', 'COMPLEX_VERIFICATION', 'ENGINEERING_ASSESSMENT'];

/**
 * Regeneration preflight: identifies the target, what would have to stay unchanged and what would need recomputation, then refuses execution.
 * It never creates a revision, operation or artifact, and it never reports that regeneration happened.
 */
export function preflightZoneRegeneration(ctx: ZoneContext, request: ZonePreflightRequest): ZonePreflightReport {
  const { model, ids } = ctx, { height, resolved } = prepare(model, ids, request.zones);
  if (resolved.issues.length) throw new ZoneRequestError('ZONE_DECLARATION_INVALID', 'The zone declaration is invalid for this model', resolved.issues.map(i => `${i.code}: ${i.detail}`));
  const t = request.target, storeys = height.storeys;
  const position = new Map(storeys.map((s, i) => [s.levelId, i]));
  let target: { key: string | null; storeys: Storey[] }, preserved: { zoneKey: string | null; levelIds: string[] }[];
  if (t.kind === 'SECTION') {
    // A section is an undeclared storey range; it reuses the zone validation, where only the coverage of the rest of the building is expected to fail.
    const bad = resolveZones(model, storeys, [{ key: 'SECTION', fromLevelId: t.fromLevelId, toLevelId: t.toLevelId }]).issues.filter(i => i.code !== 'INCOMPLETE_COVERAGE');
    if (bad.length) throw new ZoneRequestError('SECTION_TARGET_INVALID', 'The section does not name two storeys of this model in ascending order', bad.map(i => `${i.code}: ${i.detail}`));
    const start = position.get(t.fromLevelId)!, end = position.get(t.toLevelId)!;
    target = { key: null, storeys: storeys.slice(start, end + 1) };
    preserved = [storeys.slice(0, start), storeys.slice(end + 1)].filter(g => g.length).map(g => ({ zoneKey: null, levelIds: g.map(s => s.levelId) }));
  } else {
    const zone = resolved.zones.find(z => z.key === t.zoneKey);
    if (!zone) throw new ZoneRequestError('ZONE_TARGET_NOT_FOUND', `No zone ${t.zoneKey} is declared`, [`Declared zones: ${resolved.zones.map(z => z.key).join(', ')}`]);
    target = { key: zone.key, storeys: zone.storeys };
    preserved = resolved.zones.filter(z => z.key !== zone.key).map(z => ({ zoneKey: z.key, levelIds: z.storeys.map(s => s.levelId) }));
  }
  const targetIds = target.storeys.map(s => s.levelId), targetSet = new Set(targetIds);
  const crossing = model.stairs.filter(s => targetSet.has(s.fromLevelId) !== targetSet.has(s.toLevelId)).sort((a, b) => a.id < b.id ? -1 : 1);
  const profile = bimProfile(model), facades = t.kind === 'EXTERIOR_SKIN' ? (t.facades ?? [...FACADES]) : null;
  const missingCapabilities: ZonePreflightReport['missingCapabilities'] = [
    { code: 'NO_MULTI_STOREY_GENERATOR', detail: 'Generation is limited to two floors, and no generator regenerates part of a building in place' },
    { code: 'GEOMETRY_REVISION_OPERATION_UNSUPPORTED', detail: 'Selective revision (Phase 30) refuses geometry changes; it changes exterior wall appearance only' },
  ];
  if (!profile.supported) missingCapabilities.push({ code: 'BIM_PROFILE_EXCEEDED', detail: `The model is outside the bounded BIM profile (${profile.refusalCode}), so no BIM-derived service can process it` });
  let exteriorWallsInScope: number | null = null;
  if (t.kind === 'EXTERIOR_SKIN') {
    const exterior = model.walls.filter(w => targetSet.has(w.levelId) && w.classification === 'exterior');
    if (facades!.length === FACADES.length) exteriorWallsInScope = exterior.length;
    else if (northResolvable(model)) exteriorWallsInScope = exterior.filter(w => { const f = wallFacade(model, w); return f !== null && facades!.includes(f); }).length;
    else missingCapabilities.push({ code: 'FACADE_ORIENTATION_UNKNOWN', detail: 'Site north is absent or not a multiple of 90°, so the requested façades cannot be resolved to walls' });
  }
  const refusal = t.kind === 'ZONE' ? { code: 'ZONE_GEOMETRY_REGENERATION_UNSUPPORTED' as const, detail: 'Regenerating the geometry of a vertical zone is not supported: no validated multi-storey generation path exists' }
    : t.kind === 'SECTION' ? { code: 'SECTION_GEOMETRY_REGENERATION_UNSUPPORTED' as const, detail: 'Regenerating a building section (storey range) is not supported: no validated multi-storey generation path exists' }
    : { code: 'EXTERIOR_SKIN_GEOMETRY_REGENERATION_UNSUPPORTED' as const, detail: 'Regenerating exterior skin geometry is not supported; only exterior wall appearance can be changed, through selective revision' };
  const inputHash = costHash({ preflightVersion: ZONE_PREFLIGHT_VERSION, modelHash: ids.modelHash, zones: canonicalDeclarations(request.zones), target: t });
  const body = {
    preflightVersion: ZONE_PREFLIGHT_VERSION, ...ids, inputHash, sourceRevision: ctx.sourceRevision, status: 'UNSUPPORTED' as const, refusal,
    declaration: { source: resolved.source, status: 'VALID' as const, issues: [] },
    target: { kind: t.kind, zoneKey: target.key, zoneId: zoneId(targetIds), levelIds: targetIds, facades, elements: elementCounts(model, targetSet), exteriorWallsInScope },
    preservation: {
      status: 'PLANNED_NOT_ENFORCED' as const,
      preservedZones: preserved.map(p => ({ zoneKey: p.zoneKey, zoneId: zoneId(p.levelIds), levelIds: p.levelIds, elements: elementCounts(model, new Set(p.levelIds)) })),
      crossBoundaryStairs: crossing.slice(0, ZONE_LIMITS.listedElementIds).map(s => ({ stairId: s.id, fromLevelId: s.fromLevelId, toLevelId: s.toLevelId })),
      crossBoundaryStairCount: crossing.length,
      represented: ['LEVELS', 'SPACES', 'WALLS', 'OPENINGS', 'SLABS', 'COLUMNS', 'STAIRS'],
      notRepresented: [
        { item: 'SHAFTS_LIFTS_AND_RISERS', detail: 'Not modelled, so their continuity across the target boundary cannot be planned' },
        { item: 'STRUCTURAL_LOAD_PATHS', detail: 'Columns exist as geometry only; no load path through the target is represented' },
        { item: 'LOCK_ENFORCEMENT', detail: 'Preservation is planned, not enforced: no regeneration executes, so nothing is locked or compared after a change' },
      ],
    },
    dependencies: DEPENDENT_ARTIFACTS.map(artifact => ({ artifact, impact: 'WOULD_REQUIRE_RECOMPUTATION' as const,
      detail: 'Derived from the building geometry; any regenerated geometry would make results for this revision inapplicable to the new one' })),
    missingCapabilities,
    alternatives: t.kind === 'EXTERIOR_SKIN' ? [{ operation: 'APPEARANCE_MODIFY', availableForThisModel: profile.supported, route: '/api/projects/:projectId/revision-operations',
      detail: profile.supported ? 'Changes exterior wall finish (appearance only) as a new revision; it does not regenerate geometry'
        : 'Appearance changes need the scene, which needs the bounded BIM profile; this model is outside it' }] : [],
    roadmapDestination: { phase: null, status: 'OWNER_DECISION_REQUIRED' as const,
      detail: 'The canonical roadmap was not available to this implementation, so the phase that delivers multi-storey geometry regeneration is not named here; the owner must assign it' },
    claims: { ...NOT_CLAIMED_PREFLIGHT },
  };
  return ZonePreflightReportSchema.parse({ ...body, resultHash: costHash(body), currency: ctx.currency, generatedAt: ctx.generatedAt });
}
