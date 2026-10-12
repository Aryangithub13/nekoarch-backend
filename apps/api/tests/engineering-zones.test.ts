import { describe, expect, it } from 'vitest';
import { ArchitecturalBuildingModelV2Schema, type BuildingModelV2 } from '@designflow/shared';
import { BLUEPRINT_LIMITS } from '@designflow/generator';
import { tower } from '../../../test-support/tower-fixtures.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { assessZones, preflightZoneRegeneration, sameRing, zoneId, ZoneRequestError, type ZoneContext } from '../src/engineering/zones.js';
import { ZoneAssessmentRequestSchema, ZonePreflightRequestSchema, ZONE_LIMITS } from '../src/engineering/zone-contracts.js';
import { MODEL_LIMITS, UNSUPPORTED_OPERATIONS, bimProfile } from '../src/engineering/capability-limits.js';
import { assessModel } from '../src/engineering/assess.js';
import { AssessmentRequestSchema } from '../src/engineering/contracts.js';
import { discovery } from '../src/services/overview-service.js';

const ids = { projectId: '00000000-0000-4000-8000-000000000001', revisionId: '00000000-0000-4000-8000-000000000002', modelHash: 'a'.repeat(64) };
const ctx = (model: BuildingModelV2, current = true): ZoneContext => ({ ids, model, generatedAt: '2026-10-12T00:00:00.000Z',
  sourceRevision: { revisionId: ids.revisionId, revisionNumber: 3, parentRevisionId: '00000000-0000-4000-8000-000000000009', modelHash: ids.modelHash },
  currency: { status: current ? 'CURRENT' : 'STALE', artifactRevisionId: ids.revisionId, projectCurrentRevisionId: current ? ids.revisionId : '00000000-0000-4000-8000-000000000010' } });
const zones = (model: BuildingModelV2, body: unknown = {}, current = true) => assessZones(ctx(model, current), ZoneAssessmentRequestSchema.parse(body));
const preflight = (model: BuildingModelV2, body: unknown) => preflightZoneRegeneration(ctx(model), ZonePreflightRequestSchema.parse(body));
const z = (key: string, from: number, to: number) => ({ key, fromLevelId: `storey-${from}`, toLevelId: `storey-${to}` });
const supertall = () => tower({ storeys: 163, storeyHeightMm: 5120 });
const LOW_HIGH = { zones: [z('LOW', 0, 80), z('HIGH', 81, 162)] };
// Independent arithmetic for the 40 m × 30 m tower: each plate is 1.2 × 10⁹ mm²; every plate above the first has a 31 × 280 mm by 1 200 mm stair void.
const PLATE = 1_200_000_000n, VOID = 31n * 280n * 1200n;

describe('Phase 35.1 zone declarations', () => {
  it('defaults to one zone over every storey, keyed ALL, with a stable identity from the ordered storey ids', () => {
    const r = zones(tower({ storeys: 4 }));
    expect(r.declaration).toEqual({ source: 'DEFAULT_SINGLE_ZONE', status: 'VALID', issues: [] });
    expect(r.zones.map(x => [x.key, x.fromLevelId, x.toLevelId, x.storeyCount])).toEqual([['ALL', 'storey-0', 'storey-3', 4]]);
    expect(r.zones[0]!.zoneId).toBe(zoneId(['storey-0', 'storey-1', 'storey-2', 'storey-3']));
    expect(r.interfaces).toEqual([]);
  });

  it.each([
    ['unknown level', [{ key: 'A', fromLevelId: 'storey-0', toLevelId: 'nowhere' }], 'UNKNOWN_LEVEL'],
    ['reversed range', [z('A', 3, 0)], 'REVERSED_RANGE'],
    ['overlap', [z('A', 0, 2), z('B', 2, 3)], 'OVERLAP'],
    ['nested overlap', [z('A', 0, 3), z('B', 1, 1)], 'OVERLAP'],
    ['gap (non-contiguous)', [z('A', 0, 0), z('B', 2, 3)], 'GAP'],
    ['incomplete coverage below', [z('A', 1, 3)], 'INCOMPLETE_COVERAGE'],
    ['incomplete coverage above', [z('A', 0, 2)], 'INCOMPLETE_COVERAGE'],
  ])('reports an invalid declaration (%s) without computing any zone', (_name, declared, code) => {
    const r = zones(tower({ storeys: 4 }), { zones: declared });
    expect(r.status).toBe('INVALID_DECLARATION');
    expect(r.declaration.status).toBe('INVALID');
    expect(r.declaration.issues.map(i => i.code)).toContain(code);
    expect([r.zones, r.interfaces]).toEqual([[], []]);
  });

  it('refuses a roof or datum level as a zone boundary', () => {
    const m = tower({ storeys: 3 });
    m.levels.push({ id: 'roof', name: 'Roof', index: 3, kind: 'roof', elevationMm: 12_000, floorToFloorHeightMm: null, boundary: m.levels[0]!.boundary });
    expect(zones(m, { zones: [{ key: 'A', fromLevelId: 'storey-0', toLevelId: 'roof' }] }).declaration.issues.map(i => i.code)).toEqual(['NOT_A_STOREY']);
  });

  it('rejects malformed, duplicate-key or oversized declarations at the schema boundary (400), and accepts exactly the limit', () => {
    expect(ZoneAssessmentRequestSchema.safeParse({ zones: [z('A', 0, 1), z('A', 2, 3)] }).success).toBe(false);
    expect(ZoneAssessmentRequestSchema.safeParse({ zones: [{ key: 'lower', fromLevelId: 'storey-0', toLevelId: 'storey-1' }] }).success).toBe(false);
    expect(ZoneAssessmentRequestSchema.safeParse({ zones: [] }).success).toBe(false);
    expect(ZoneAssessmentRequestSchema.safeParse({ zones: [z('A', 0, 1)], extra: true }).success).toBe(false);
    const many = (n: number) => ({ zones: Array.from({ length: n }, (_, i) => z(`Z${i}`, i, i)) });
    expect(ZoneAssessmentRequestSchema.safeParse(many(ZONE_LIMITS.zones)).success).toBe(true);
    expect(ZoneAssessmentRequestSchema.safeParse(many(ZONE_LIMITS.zones + 1)).success).toBe(false);
    // 64 single-storey zones over a 64-storey tower: exactly at the limit, fully evaluated.
    expect(zones(tower({ storeys: 64 }), many(64)).zones).toHaveLength(64);
  });
});

describe('Phase 35.1 per-zone geometry (163-storey supplied concept)', () => {
  it('splits height, gross floor area and volume exactly, and the zones sum to the whole-building B35 values', () => {
    const r = zones(supertall(), LOW_HIGH);
    const [low, high] = r.zones;
    expect([low!.storeyCount, low!.bottomElevationMm, low!.topMm, low!.heightMm]).toEqual([81, 0, 81 * 5120, 81 * 5120]);
    expect([high!.storeyCount, high!.bottomElevationMm, high!.topMm, high!.heightMm]).toEqual([82, 81 * 5120, 163 * 5120, 82 * 5120]);
    expect(low!.grossFloorAreaMm2).toBe((81n * PLATE - 80n * VOID).toString());
    expect(high!.grossFloorAreaMm2).toBe((82n * PLATE - 82n * VOID).toString());
    expect(low!.grossVolumeMm3).toBe(((81n * PLATE - 80n * VOID) * 5120n).toString());
    const whole = assessModel({ ids, model: supertall(), request: AssessmentRequestSchema.parse({}), brief: { version: 0, briefHash: null, floors: null }, evidence: [], related: [],
      generatedAt: '2026-10-12T00:00:00.000Z' });
    expect((BigInt(low!.grossFloorAreaMm2) + BigInt(high!.grossFloorAreaMm2)).toString()).toBe(whole.areas.grossFloorAreaMm2);
    expect(low!.elements).toEqual({ spaces: 81, walls: 324, exteriorWalls: 324, openings: 1, slabs: 81, columns: 0, stairsWithin: 80 });
    expect(high!.elements.stairsWithin).toBe(81);
  });

  it('groups the exterior skin by façade only when site north is orthogonal, and says so otherwise', () => {
    const unresolved = zones(supertall(), LOW_HIGH).zones[0]!;
    expect(unresolved.exteriorSkin).toEqual({ basis: 'WALL_CLASSIFICATION', exteriorWalls: 324, unclassifiedWalls: 0, byFacade: null, facadeBasis: 'NOT_RESOLVED' });
    expect(unresolved.blockers.map(b => b.code)).toContain('FACADE_ORIENTATION_UNKNOWN');
    const m = supertall(); m.site = { ...m.site!, northMilliDegrees: 0 };
    expect(zones(m, LOW_HIGH).zones[0]!.exteriorSkin.byFacade).toEqual({ NORTH: 81, EAST: 81, SOUTH: 81, WEST: 81, UNRESOLVED: 0 });
  });

  it('reports an undetermined top and volume as blockers, never as zero', () => {
    const r = zones(tower({ storeys: 4, topFloorToFloor: false }), { zones: [z('A', 0, 1), z('B', 2, 3)] });
    expect(r.zones[1]).toMatchObject({ topMm: null, heightMm: null, grossVolumeMm3: null });
    expect(r.zones[1]!.blockers.map(b => b.code)).toEqual(expect.arrayContaining(['ZONE_TOP_UNDETERMINED', 'ZONE_VOLUME_UNDETERMINED']));
    expect(r.status).toBe('PARTIAL');
  });

  it('assesses the 256-level maximum within bounds; 257 levels never reach the assessment (schema)', () => {
    const started = performance.now(), max = tower({ storeys: 256 });
    expect(ArchitecturalBuildingModelV2Schema.safeParse(max).success).toBe(true);
    expect(zones(max).zones[0]!.storeyCount).toBe(256);
    expect(performance.now() - started).toBeLessThan(5000);
    const over = ArchitecturalBuildingModelV2Schema.safeParse(tower({ storeys: 257 }));
    expect(over.success).toBe(false);
    expect(over.error!.issues.some(i => i.path.join('.') === 'levels' && i.code === 'too_big')).toBe(true);
  });
});

describe('Phase 35.1 interface checks', () => {
  const checks = (r: ReturnType<typeof zones>, i = 0) => Object.fromEntries(r.interfaces[i]!.checks.map(c => [c.check, c]));

  it('passes only what the represented geometry establishes, and never evaluates shafts', () => {
    const r = zones(supertall(), LOW_HIGH), c = checks(r);
    expect(r.interfaces[0]).toMatchObject({ lowerZoneKey: 'LOW', upperZoneKey: 'HIGH', lowerLevelId: 'storey-80', upperLevelId: 'storey-81' });
    expect(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.status]))).toEqual({ INTERFACE_ELEVATION: 'PASS', STAIR_CONNECTION: 'PASS', STAIR_SLAB_VOID: 'PASS',
      STAIR_FOOTPRINT_CONTINUITY: 'PASS', ENVELOPE_CONTINUITY: 'INFO', SHAFT_CONTINUITY: 'NOT_EVALUATED' });
    expect(c.SHAFT_CONTINUITY!.blocker!.code).toBe('SHAFTS_NOT_REPRESENTED');
    expect(c.STAIR_CONNECTION!.entityIds).toEqual(['stair-80']);
    expect(r.status).toBe('PARTIAL'); // shaft continuity is never evaluated, so a multi-zone result is never fully CONSISTENT
    expect(r.claims).toEqual({ structuralAdequacy: 'NOT_CLAIMED', windOrSeismicPerformance: 'NOT_CLAIMED', fireAndLifeSafety: 'NOT_CLAIMED',
      verticalTransportAdequacy: 'NOT_CLAIMED', codeCompliance: 'NOT_CLAIMED' });
  });

  it('fails a declared floor-to-floor height that does not reach the next zone, and does not evaluate a derived one', () => {
    const declared = supertall(); declared.levels[80]!.floorToFloorHeightMm = 5000;
    const fail = checks(zones(declared, LOW_HIGH)).INTERFACE_ELEVATION!;
    expect([fail.status, fail.measured, fail.required]).toEqual(['FAIL', String(80 * 5120 + 5000), String(81 * 5120)]);
    expect(zones(declared, LOW_HIGH).status).toBe('INCONSISTENT');
    const derived = supertall(); derived.levels[80]!.floorToFloorHeightMm = null;
    expect(checks(zones(derived, LOW_HIGH)).INTERFACE_ELEVATION).toMatchObject({ status: 'NOT_EVALUATED', blocker: { code: 'FLOOR_TO_FLOOR_NOT_DECLARED' } });
  });

  it('fails a stair crossing the interface without a matching slab void above it', () => {
    const m = supertall(); m.slabs.find(s => s.levelId === 'storey-81')!.footprint.voids = [];
    expect(checks(zones(m, LOW_HIGH)).STAIR_SLAB_VOID).toMatchObject({ status: 'FAIL', entityIds: ['stair-80'] });
  });

  it('warns (no rule applied) when no stair crosses or the stair footprint changes, and blocks checks that then have no input', () => {
    const noStair = supertall(); noStair.stairs = noStair.stairs.filter(s => s.id !== 'stair-80');
    const c = checks(zones(noStair, LOW_HIGH));
    expect(c.STAIR_CONNECTION!.status).toBe('WARNING');
    expect(c.STAIR_SLAB_VOID).toMatchObject({ status: 'NOT_EVALUATED', blocker: { code: 'NO_STAIR_ACROSS_INTERFACE' } });
    const moved = supertall(), shift = (p: { x: number; z: number }) => ({ x: p.x + 5000, z: p.z });
    moved.stairs.filter(s => Number(s.id.slice(6)) >= 81).forEach(s => { s.footprint = s.footprint.map(shift); });
    expect(checks(zones(moved, LOW_HIGH)).STAIR_FOOTPRINT_CONTINUITY!.status).toBe('WARNING');
  });

  it('reports an envelope setback at an interface as information, not as a failure', () => {
    const m = supertall(); for (const l of m.levels.slice(81)) l.boundary = [{ x: 0, z: 0 }, { x: 30_000, z: 0 }, { x: 30_000, z: 30_000 }, { x: 0, z: 30_000 }];
    expect(checks(zones(m, LOW_HIGH)).ENVELOPE_CONTINUITY).toMatchObject({ status: 'INFO', measured: 'CHANGED' });
  });

  it('compares rings exactly in either orientation and from any start vertex', () => {
    const a = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 }, { x: 0, z: 5 }];
    expect(sameRing(a, [a[2]!, a[3]!, a[0]!, a[1]!])).toBe(true);
    expect(sameRing(a, [...a].reverse())).toBe(true);
    expect(sameRing(a, [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 6 }, { x: 0, z: 5 }])).toBe(false);
  });
});

describe('Phase 35.1 determinism, hash binding, freshness and non-mutation', () => {
  it('gives identical hashes for identical canonical inputs, regardless of declaration order, and different hashes for changed inputs', () => {
    const m = supertall(), a = zones(m, LOW_HIGH), b = zones(m, { zones: [...LOW_HIGH.zones].reverse() });
    expect([b.inputHash, b.resultHash]).toEqual([a.inputHash, a.resultHash]);
    const renamed = zones(m, { zones: [z('PODIUM', 0, 80), z('HIGH', 81, 162)] });
    expect(renamed.inputHash).not.toBe(a.inputHash);
    expect(renamed.zones[0]!.zoneId).toBe(a.zones[0]!.zoneId); // identity follows the storeys, not the key
    const moved = zones(m, { zones: [z('LOW', 0, 79), z('HIGH', 80, 162)] });
    expect(moved.inputHash).not.toBe(a.inputHash);
    expect(moved.zones[0]!.zoneId).not.toBe(a.zones[0]!.zoneId);
    const otherModel = assessZones({ ...ctx(m), ids: { ...ids, modelHash: 'b'.repeat(64) } }, ZoneAssessmentRequestSchema.parse(LOW_HIGH));
    expect(otherModel.inputHash).not.toBe(a.inputHash);
  });

  it('binds the report to its source revision and marks a non-current revision STALE without changing the derived result', () => {
    const m = supertall(), current = zones(m, LOW_HIGH, true), stale = zones(m, LOW_HIGH, false);
    expect(current.sourceRevision).toEqual({ revisionId: ids.revisionId, revisionNumber: 3, parentRevisionId: '00000000-0000-4000-8000-000000000009', modelHash: ids.modelHash });
    expect([current.currency.status, stale.currency.status]).toEqual(['CURRENT', 'STALE']);
    expect([stale.inputHash, stale.resultHash]).toEqual([current.inputHash, current.resultHash]);
  });

  it('never mutates the source model (assessment or preflight)', () => {
    const m = supertall(), before = JSON.stringify(m);
    zones(m, LOW_HIGH);
    preflight(m, { ...LOW_HIGH, target: { kind: 'ZONE', zoneKey: 'HIGH' } });
    preflight(m, { target: { kind: 'SECTION', fromLevelId: 'storey-10', toLevelId: 'storey-20' } });
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe('Phase 35.1 regeneration preflight (refusal, not regeneration)', () => {
  it('refuses zone geometry regeneration, naming the target, the preserved zones, the cross-boundary stair and every missing capability', () => {
    const r = preflight(supertall(), { ...LOW_HIGH, target: { kind: 'ZONE', zoneKey: 'HIGH' } });
    expect(r.status).toBe('UNSUPPORTED');
    expect(r.refusal.code).toBe('ZONE_GEOMETRY_REGENERATION_UNSUPPORTED');
    expect(r.target).toMatchObject({ kind: 'ZONE', zoneKey: 'HIGH', levelIds: Array.from({ length: 82 }, (_, i) => `storey-${81 + i}`) });
    expect(r.preservation.status).toBe('PLANNED_NOT_ENFORCED');
    expect(r.preservation.preservedZones.map(p => [p.zoneKey, p.levelIds.length])).toEqual([['LOW', 81]]);
    expect(r.preservation.crossBoundaryStairs).toEqual([{ stairId: 'stair-80', fromLevelId: 'storey-80', toLevelId: 'storey-81' }]);
    expect(r.missingCapabilities.map(m => m.code)).toEqual(['NO_MULTI_STOREY_GENERATOR', 'GEOMETRY_REVISION_OPERATION_UNSUPPORTED', 'BIM_PROFILE_EXCEEDED']);
    expect(r.roadmapDestination).toMatchObject({ phase: null, status: 'OWNER_DECISION_REQUIRED' });
    expect(r.claims).toEqual({ regenerationPerformed: 'NOT_CLAIMED', revisionCreated: 'NOT_CLAIMED', preservationEnforced: 'NOT_CLAIMED', engineeringValidity: 'NOT_CLAIMED' });
    expect(r.dependencies.every(d => d.impact === 'WOULD_REQUIRE_RECOMPUTATION')).toBe(true);
  });

  it('refuses a section (storey range) and preserves the storeys below and above it', () => {
    const r = preflight(supertall(), { target: { kind: 'SECTION', fromLevelId: 'storey-10', toLevelId: 'storey-20' } });
    expect(r.refusal.code).toBe('SECTION_GEOMETRY_REGENERATION_UNSUPPORTED');
    expect(r.target.zoneKey).toBeNull();
    expect(r.preservation.preservedZones.map(p => [p.levelIds[0], p.levelIds.at(-1)])).toEqual([['storey-0', 'storey-9'], ['storey-21', 'storey-162']]);
    expect(r.preservation.crossBoundaryStairCount).toBe(2);
  });

  it('refuses skin geometry, points to appearance-only revision only where the model allows it, and never counts unresolved façades', () => {
    const tall = preflight(supertall(), { target: { kind: 'EXTERIOR_SKIN', zoneKey: 'ALL', facades: ['NORTH'] } });
    expect(tall.refusal.code).toBe('EXTERIOR_SKIN_GEOMETRY_REGENERATION_UNSUPPORTED');
    expect(tall.target.exteriorWallsInScope).toBeNull();
    expect(tall.missingCapabilities.map(m => m.code)).toContain('FACADE_ORIENTATION_UNKNOWN');
    expect(tall.alternatives).toEqual([expect.objectContaining({ operation: 'APPEARANCE_MODIFY', availableForThisModel: false })]);
    const small = preflight(tower({ storeys: 2 }), { target: { kind: 'EXTERIOR_SKIN', zoneKey: 'ALL' } });
    expect(small.status).toBe('UNSUPPORTED');
    expect(small.target.exteriorWallsInScope).toBe(8);
    expect(small.alternatives[0]!.availableForThisModel).toBe(true);
  });

  it('refuses an invalid declaration, an undeclared zone or a reversed section with typed errors', () => {
    const code = (body: unknown) => { try { preflight(supertall(), body); return null; } catch (e) { return e instanceof ZoneRequestError ? e.code : String(e); } };
    expect(code({ zones: [z('A', 0, 10)], target: { kind: 'ZONE', zoneKey: 'A' } })).toBe('ZONE_DECLARATION_INVALID');
    expect(code({ ...LOW_HIGH, target: { kind: 'ZONE', zoneKey: 'MID' } })).toBe('ZONE_TARGET_NOT_FOUND');
    expect(code({ target: { kind: 'SECTION', fromLevelId: 'storey-20', toLevelId: 'storey-10' } })).toBe('SECTION_TARGET_INVALID');
    expect(code({ target: { kind: 'SECTION', fromLevelId: 'storey-1', toLevelId: 'nowhere' } })).toBe('SECTION_TARGET_INVALID');
  });
});

describe('Phase 35.1 capability disclosure', () => {
  it('discovers the enforced limits and the unsupported tall-building operations with stable identifiers', () => {
    const d = discovery();
    expect(d.modelLimits.map(l => [l.limitId, l.value])).toEqual([['BUILDING_MODEL_MAX_LEVELS', 256], ['GENERATION_MAX_FLOORS', 2], ['BIM_PROFILE_MAX_STOREYS', 2],
      ['ZONE_ASSESSMENT_MAX_ZONES', 64]]);
    expect(d.unsupportedOperations.map(o => [o.operationId, o.status])).toEqual([['SUPERTALL_GENERATION', 'UNSUPPORTED'], ['PARTITIONED_MODEL_PROCESSING', 'UNSUPPORTED'],
      ['ZONE_GEOMETRY_REGENERATION', 'UNSUPPORTED'], ['SECTION_GEOMETRY_REGENERATION', 'UNSUPPORTED'], ['EXTERIOR_SKIN_GEOMETRY_REGENERATION', 'UNSUPPORTED'],
      ['VALIDATED_ENGINEERING_SOLVERS', 'UNSUPPORTED']]);
    expect(d.services.find(s => s.serviceId === 'ZONE_ASSESSMENT')).toMatchObject({ persistence: 'DERIVED_ON_READ', status: 'AVAILABLE' });
  });

  it('states limits that match the code that enforces them', () => {
    expect(MODEL_LIMITS.find(l => l.limitId === 'GENERATION_MAX_FLOORS')!.value).toBe(BLUEPRINT_LIMITS.maxFloors);
    expect(MODEL_LIMITS.find(l => l.limitId === 'ZONE_ASSESSMENT_MAX_ZONES')!.value).toBe(ZONE_LIMITS.zones);
    expect(UNSUPPORTED_OPERATIONS.filter(o => o.preflightRoute).every(o => o.preflightRoute!.endsWith('/engineering-assessment/zones/regeneration-preflight'))).toBe(true);
    // The BIM profile limit is the real gate's: 2 storeys pass, 3 are refused.
    expect([bimProfile(tower({ storeys: 2 })), bimProfile(tower({ storeys: 3 }))]).toEqual([{ supported: true, refusalCode: null },
      { supported: false, refusalCode: 'BIM_UNSUPPORTED_MODEL' }]);
  });

  it('marks BIM-gated related services as REFUSED for a tall model and SUPPORTED for one inside the profile, without changing domain statuses', () => {
    const related = [{ serviceId: 'BUILDING_SYSTEMS_ANALYSIS' as const, route: '/r', artifactsForRevision: 0, note: 'n' },
      { serviceId: 'QUANTITY_TAKEOFF' as const, route: '/t', artifactsForRevision: null, note: 'n' }, { serviceId: 'COMPLEX_VERIFICATION' as const, route: '/v', artifactsForRevision: null, note: 'n' }];
    const run = (model: BuildingModelV2) => assessModel({ ids, model, request: AssessmentRequestSchema.parse({}), brief: { version: 0, briefHash: null, floors: null }, evidence: [],
      related, generatedAt: '2026-10-12T00:00:00.000Z' });
    const support = (r: ReturnType<typeof run>, domainId: string) => r.domains.find(d => d.domain === domainId)!.relatedServices.map(s => [s.serviceId, s.modelSupport, s.refusalCode]);
    const tall = run(supertall()), small = run(authored());
    expect(support(tall, 'VERTICAL_TRANSPORT')).toEqual([['BUILDING_SYSTEMS_ANALYSIS', 'REFUSED', 'BIM_UNSUPPORTED_MODEL']]);
    expect(support(tall, 'PRELIMINARY_COST')).toEqual([['QUANTITY_TAKEOFF', 'NOT_CHECKED', null]]);
    expect(support(tall, 'SITE_AND_GEOMETRY')).toEqual([['COMPLEX_VERIFICATION', 'SUPPORTED', null]]);
    expect(support(small, 'FIRE_AND_LIFE_SAFETY')).toEqual([['BUILDING_SYSTEMS_ANALYSIS', 'SUPPORTED', null]]);
    expect(tall.domains.find(d => d.domain === 'FIRE_AND_LIFE_SAFETY')!.status).toBe('REQUIRES_INPUTS');
    expect(tall.limitations.some(l => l.includes('limited to two floors'))).toBe(true);
  });
});
