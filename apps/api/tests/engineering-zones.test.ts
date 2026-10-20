import { describe, expect, it } from 'vitest';
import { ArchitecturalBuildingModelV2Schema, RingMmSchema, type BuildingModelV2, type Point2Mm } from '@designflow/shared';
import { BLUEPRINT_LIMITS } from '@designflow/generator';
import { LIMITS as TAKEOFF_LIMITS } from '@designflow/quantity-takeoff';
import { tower, withIntermediateLevel } from '../../../test-support/tower-fixtures.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { assessZones, preflightZoneRegeneration, sameRegion, zoneId, ZoneRequestError, type ZoneContext } from '../src/engineering/zones.js';
import { revisionQaReport } from '../src/services/project-service.js';
import { buildIntent, planRevision, type PlanContext } from '../src/revision/plan.js';
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

  it('F2: labels which checks restate acceptance QA, which are cross-zone observations, and which are not evaluated', () => {
    const c = checks(zones(supertall(), LOW_HIGH)), r = zones(supertall(), LOW_HIGH);
    for (const k of ['INTERFACE_ELEVATION', 'STAIR_SLAB_VOID'] as const) expect(c[k]!.detail).toMatch(/^Restates acceptance QA \(QA_[A-Z_]+.*not independent evidence/);
    for (const k of ['STAIR_CONNECTION', 'STAIR_FOOTPRINT_CONTINUITY', 'ENVELOPE_CONTINUITY'] as const) expect(c[k]!.detail).toMatch(/^Cross-zone observation: .*no .*rule is applied/i);
    expect(c.SHAFT_CONTINUITY!.detail).toMatch(/^Not evaluated: /);
    expect(r.limitations.some(l => l.startsWith('INTERFACE_ELEVATION and STAIR_SLAB_VOID restate acceptance-QA rules'))).toBe(true);
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

  it('compares regions exactly: any start vertex, either orientation, redundant collinear vertices; a 1 mm or shape difference is different', () => {
    const a = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 }, { x: 0, z: 5 }];
    expect(sameRegion(a, [a[2]!, a[3]!, a[0]!, a[1]!])).toBe(true);
    expect(sameRegion(a, [...a].reverse())).toBe(true);
    expect(sameRegion(a, [a[0]!, { x: 4, z: 0 }, a[1]!, { x: 10, z: 3 }, a[2]!, a[3]!])).toBe(true);
    expect(sameRegion(a, [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 6 }, { x: 0, z: 5 }])).toBe(false);
    expect(sameRegion(a, [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 }, { x: 1, z: 5 }])).toBe(false);
    // Same bounding box and the same area, but mirrored L-shapes: only the containment test can tell them apart.
    const l1 = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 }, { x: 5, z: 5 }, { x: 5, z: 10 }, { x: 0, z: 10 }];
    const l2 = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 5, z: 10 }, { x: 5, z: 5 }, { x: 0, z: 5 }];
    expect([sameRegion(l1, l2), sameRegion(l1, [...l1.slice(3), ...l1.slice(0, 3)].reverse())]).toEqual([false, true]);
    // Degenerate rings (retraced edges, zero area) never reach a check: the model schema refuses them.
    expect(RingMmSchema.safeParse([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 5, z: 0 }]).success).toBe(false);
    expect(RingMmSchema.safeParse([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 }, { x: 10, z: 2 }, { x: 0, z: 5 }]).success).toBe(false);
  });
});

describe('Phase 35.1 remediation: equivalent geometry and represented levels (F1, F8, N1)', () => {
  const checks = (r: ReturnType<typeof zones>, i = 0) => Object.fromEntries(r.interfaces[i]!.checks.map(c => [c.check, c]));
  const four = () => tower({ storeys: 4 }), LH = { zones: [z('LOW', 0, 1), z('HIGH', 2, 3)] };
  const saveGate = (m: BuildingModelV2) => revisionQaReport(ArchitecturalBuildingModelV2Schema.parse(m), null, null);
  /** The same ring with one extra vertex on its first edge (integer midpoint in these fixtures). */
  const collinear = (ring: Point2Mm[]) => [ring[0]!, { x: (ring[0]!.x + ring[1]!.x) / 2, z: (ring[0]!.z + ring[1]!.z) / 2 }, ...ring.slice(1)];

  it('F1: accepts a stair opening with an extra collinear vertex, as acceptance QA does', () => {
    const m = four(), slab = m.slabs.find(s => s.id === 'storey-2-floor')!;
    slab.footprint.voids = [collinear(slab.footprint.voids[0]!)];
    expect(saveGate(m)).toMatchObject({ status: 'PASS', summary: { errors: 0 } });
    const r = zones(m, LH);
    expect(checks(r).STAIR_SLAB_VOID).toMatchObject({ status: 'PASS', entityIds: ['stair-1'] });
    expect(r.status).toBe('PARTIAL');
  });

  it('F1: treats an equivalent stair footprint or envelope as the same region from any start vertex and in either orientation', () => {
    const m = four(), above = m.stairs.find(s => s.id === 'stair-2')!, upper = m.levels.find(l => l.id === 'storey-2')!;
    const fp = collinear(above.footprint); above.footprint = [...fp.slice(2), ...fp.slice(0, 2)].reverse();
    upper.boundary = collinear(upper.boundary).reverse();
    const c = checks(zones(m, LH));
    expect(c.STAIR_FOOTPRINT_CONTINUITY!.status).toBe('PASS');
    expect(c.ENVELOPE_CONTINUITY).toMatchObject({ status: 'INFO', measured: 'UNCHANGED' });
  });

  it('F1: still fails an opening that misses part of the flight (with QA), and still warns on a footprint 1 mm away', () => {
    const m = four(), slab = m.slabs.find(s => s.id === 'storey-2-floor')!;
    slab.footprint.voids = [slab.footprint.voids[0]!.map(p => (p.x === 2400 ? { ...p, x: 2401 } : p))];
    expect(saveGate(m).findings.map(f => f.code)).toContain('QA_STAIR_VOID_MISSING');
    expect(checks(zones(m, LH)).STAIR_SLAB_VOID).toMatchObject({ status: 'FAIL', entityIds: ['stair-1'] });
    const moved = four(), s2 = moved.stairs.find(s => s.id === 'stair-2')!;
    s2.footprint = s2.footprint.map(p => ({ ...p, z: p.z + 1 }));
    expect(checks(zones(moved, LH)).STAIR_FOOTPRINT_CONTINUITY!.status).toBe('WARNING');
  });

  it('F1: applies the QA endpoint and interference rules to a flight ending at, or passing through, the upper storey', () => {
    const noFloor = four(); noFloor.slabs = noFloor.slabs.filter(s => s.id !== 'storey-2-floor');
    expect(checks(zones(noFloor, LH)).STAIR_SLAB_VOID).toMatchObject({ status: 'FAIL', entityIds: ['stair-1'] }); // QA_STAIR_VOID_MISSING
    const through = (voided: boolean) => {
      const m = four(), s1 = m.stairs.find(s => s.id === 'stair-1')!; s1.toLevelId = 'storey-3';
      if (!voided) m.slabs.find(s => s.id === 'storey-2-floor')!.footprint.voids = [];
      return checks(zones(m, LH)).STAIR_SLAB_VOID!;
    };
    expect([through(true).status, through(false).status]).toEqual(['PASS', 'FAIL']); // QA_STAIR_SOLID_INTERFERENCE at the intermediate plate
    const open = four(); open.stairs.find(s => s.id === 'stair-1')!.toLevelId = 'storey-3'; open.slabs = open.slabs.filter(s => s.levelId !== 'storey-2');
    expect(checks(zones(open, LH)).STAIR_SLAB_VOID).toMatchObject({ status: 'NOT_EVALUATED', blocker: { code: 'NO_SLAB_AT_UPPER_LEVEL' } });
  });

  it('F8: a datum between zones does not fail the interface, and zone heights and volumes do not depend on declaring the height', () => {
    const declared = withIntermediateLevel(four(), { storey: 1, offsetMm: 2000, declare: true });
    const undeclared = withIntermediateLevel(four(), { storey: 1, offsetMm: 2000, declare: false });
    expect(saveGate(declared)).toMatchObject({ status: 'PASS', summary: { errors: 0 } });
    const r = zones(declared, LH), u = zones(undeclared, LH);
    expect(checks(r).INTERFACE_ELEVATION).toMatchObject({ status: 'PASS', entityIds: ['storey-1', 'datum-above-1', 'storey-2'], measured: '6000', required: '6000' });
    expect(r.status).toBe('PARTIAL');
    expect(checks(u).INTERFACE_ELEVATION).toMatchObject({ status: 'NOT_EVALUATED', blocker: { code: 'FLOOR_TO_FLOOR_NOT_DECLARED' } });
    expect(r.zones).toEqual(u.zones);
    // Independent arithmetic: 4 000 mm storeys, 1.2 × 10⁹ mm² plates, a 24 × 280 mm by 1 200 mm stair void in every plate above the first.
    const VOID4 = 24n * 280n * 1200n;
    expect(r.zones.map(x => [x.heightMm, x.grossVolumeMm3])).toEqual([[8000, String(4000n * (2n * PLATE - VOID4))], [8000, String(4000n * 2n * (PLATE - VOID4))]]);
    const b35 = assessModel({ ids, model: declared, request: AssessmentRequestSchema.parse({}), brief: { version: 0, briefHash: null, floors: null }, evidence: [], related: [], generatedAt: 'x' });
    expect(BigInt(r.zones[0]!.grossVolumeMm3!) + BigInt(r.zones[1]!.grossVolumeMm3!)).toBe(BigInt(b35.areas.grossVolumeMm3!));
  });

  it('F8: still fails a declared height that misses the next represented level (a model that bypassed the schema)', () => {
    const m = withIntermediateLevel(four(), { storey: 1, offsetMm: 2000, declare: true }); m.levels.find(l => l.id === 'storey-1')!.floorToFloorHeightMm = 2500;
    expect(checks(zones(m, LH)).INTERFACE_ELEVATION).toMatchObject({ status: 'FAIL', measured: '6500', required: '6000' });
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

describe('Phase 35.1 regeneration preflight (refuses generator-driven regeneration; names the deterministic alternatives)', () => {
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

  it('says the preflight only plans preservation and points to the operations that enforce it; it never says no regeneration exists', () => {
    const r = preflight(supertall(), { ...LOW_HIGH, target: { kind: 'ZONE', zoneKey: 'HIGH' } });
    expect(r.preservation.notRepresented.find(n => n.item === 'LOCK_ENFORCEMENT')!.detail)
      .toBe('This preflight plans preservation only. The deterministic operations at zones/regeneration enforce it on their candidates; generator-driven regeneration does not exist');
    expect(r.roadmapDestination.detail).toContain('generator-driven multi-storey regeneration');
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
    // Unresolvable façades refuse both alternatives: appearance needs the scene profile, and window regeneration needs façades it can resolve.
    expect(tall.alternatives).toEqual([expect.objectContaining({ operation: 'APPEARANCE_MODIFY', eligibility: 'REFUSED' }),
      expect.objectContaining({ operation: 'FENESTRATION', eligibility: 'REFUSED', route: expect.stringMatching(/\/engineering-assessment\/zones\/regeneration$/) })]);
    const whole = preflight(supertall(), { target: { kind: 'EXTERIOR_SKIN', zoneKey: 'ALL' } });
    expect(whole.alternatives.map(a => [a.operation, a.eligibility])).toEqual([['APPEARANCE_MODIFY', 'REFUSED'], ['FENESTRATION', 'PRELIMINARY_ELIGIBLE']]);
    const small = preflight(tower({ storeys: 2 }), { target: { kind: 'EXTERIOR_SKIN', zoneKey: 'ALL' } });
    expect(small.status).toBe('UNSUPPORTED');
    expect(small.target.exteriorWallsInScope).toBe(8);
    // F4: the BIM source gate is only the first gate, so this is preliminary eligibility, never "available".
    expect(small.alternatives[0]).toMatchObject({ eligibility: 'PRELIMINARY_ELIGIBLE', detail: expect.stringContaining('its own preflight may still refuse it') });
    expect(preflight(supertall(), { ...LOW_HIGH, target: { kind: 'ZONE', zoneKey: 'HIGH' } }).alternatives.map(a => [a.operation, a.eligibility])).toEqual([['TYPICAL_FLOOR', 'PRELIMINARY_ELIGIBLE']]);
  });

  it('F7: lists everything inside the target zone that an exterior-skin change must preserve, and nothing for zone or section targets', () => {
    const m = tower({ storeys: 4 }), Z = { zones: [z('LOW', 0, 1), z('HIGH', 2, 3)] };
    m.walls.push({ id: 'storey-2-partition', levelId: 'storey-2', path: { start: { x: 20_000, z: 5000 }, end: { x: 20_000, z: 25_000 } }, pathReference: 'centerline',
      thicknessMm: 100, heightMm: 3000, baseOffsetMm: 0, classification: 'partition', spaceIds: ['storey-2-office'] });
    const skin = preflight(m, { ...Z, target: { kind: 'EXTERIOR_SKIN', zoneKey: 'HIGH' } });
    expect(skin.status).toBe('UNSUPPORTED');
    expect(skin.preservation.status).toBe('PLANNED_NOT_ENFORCED');
    expect(skin.preservation.preservedZones.map(p => p.zoneKey)).toEqual(['LOW']);
    const items = Object.fromEntries(skin.preservation.targetInterior!.items.map(i => [i.item, [i.count, i.entityIds]]));
    expect(skin.preservation.targetInterior).toMatchObject({ zoneKey: 'HIGH', levelIds: ['storey-2', 'storey-3'] });
    expect(items).toEqual({ SPACES: [2, ['storey-2-office', 'storey-3-office']], INTERIOR_WALLS: [1, ['storey-2-partition']], UNCLASSIFIED_WALLS: [0, []],
      INTERIOR_OPENINGS: [0, []], SLABS: [2, ['storey-2-floor', 'storey-3-floor']], COLUMNS: [0, []], STAIRS: [2, ['stair-1', 'stair-2']],
      LEVELS: [2, ['storey-2', 'storey-3']], DIMENSIONS: [0, []] });
    // A façade subset preserves the other façades' exterior walls too, once site north makes façades resolvable.
    m.site!.northMilliDegrees = 0;
    const north = preflight(m, { ...Z, target: { kind: 'EXTERIOR_SKIN', zoneKey: 'HIGH', facades: ['NORTH'] } });
    expect([north.target.exteriorWallsInScope, north.preservation.targetInterior!.items.find(i => i.item === 'EXTERIOR_WALLS_ON_OTHER_FACADES')!.count]).toEqual([2, 6]);
    expect(preflight(m, { ...Z, target: { kind: 'ZONE', zoneKey: 'HIGH' } }).preservation.targetInterior).toBeNull();
    expect(preflight(m, { target: { kind: 'SECTION', fromLevelId: 'storey-1', toLevelId: 'storey-2' } }).preservation.targetInterior).toBeNull();
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
    expect(d.modelLimits.map(l => [l.limitId, l.value])).toEqual([['BUILDING_MODEL_MAX_LEVELS', 256], ['GENERATION_MAX_FLOORS', 2], ['BIM_PROFILE_MAX_STOREYS', 10],
      ['SELECTIVE_REVISION_APPEARANCE_PROFILE', 10], ['ZONE_ASSESSMENT_MAX_ZONES', 64], ['QUANTITY_TAKEOFF_MAX_ENTITIES', 5000]]);
    // Phase 35 delivered deterministic zone regeneration and partitioned processing; only what they do not cover is still listed as unsupported.
    expect(d.unsupportedOperations.map(o => [o.operationId, o.status])).toEqual([['SUPERTALL_GENERATION', 'UNSUPPORTED'], ['GENERATIVE_ZONE_REGENERATION', 'UNSUPPORTED'],
      ['ENVELOPE_GEOMETRY_REGENERATION', 'UNSUPPORTED'], ['PARTITIONED_ARTIFACT_SERVICES', 'UNSUPPORTED'], ['VALIDATED_ENGINEERING_SOLVERS', 'UNSUPPORTED']]);
    expect(d.services.find(s => s.serviceId === 'ZONE_ASSESSMENT')).toMatchObject({ persistence: 'DERIVED_ON_READ', status: 'AVAILABLE' });
    expect(d.services.find(s => s.serviceId === 'ZONE_REGENERATION')).toMatchObject({ version: 'zone-regeneration-v1', persistence: 'CANDIDATE_THEN_SUPPLIED_REVISION', status: 'AVAILABLE' });
    expect(d.services.find(s => s.serviceId === 'ZONE_PARTITIONS')).toMatchObject({ version: 'zone-partitions-v1', persistence: 'DERIVED_ON_READ', status: 'AVAILABLE' });
  });

  it('states limits that match the code that enforces them', () => {
    expect(MODEL_LIMITS.find(l => l.limitId === 'GENERATION_MAX_FLOORS')!.value).toBe(BLUEPRINT_LIMITS.maxFloors);
    expect(MODEL_LIMITS.find(l => l.limitId === 'ZONE_ASSESSMENT_MAX_ZONES')!.value).toBe(ZONE_LIMITS.zones);
    expect(MODEL_LIMITS.find(l => l.limitId === 'QUANTITY_TAKEOFF_MAX_ENTITIES')!.value).toBe(TAKEOFF_LIMITS.entities);
    expect(UNSUPPORTED_OPERATIONS.filter(o => o.preflightRoute).every(o => o.preflightRoute!.endsWith('/engineering-assessment/zones/regeneration-preflight'))).toBe(true);
    // The BIM profile limit is the real gate's: 10 storeys pass, 11 are refused (program-engine designs extended it from 2).
    expect([bimProfile(tower({ storeys: 10 })), bimProfile(tower({ storeys: 11 }))]).toEqual([{ eligible: true, refusalCode: null },
      { eligible: false, refusalCode: 'BIM_UNSUPPORTED_MODEL' }]);
  });

  it('F3: the selective-revision limit gates appearance changes through a preflight refusal (not an error), and does not gate restore', () => {
    const rev = (id: string, revisionNumber: number, storeys: number) => ({ id, revisionNumber, parentRevisionId: null, model: tower({ storeys }), generatorVersion: null });
    const source = rev('33333333-3333-4333-8333-333333333333', 1, 3), base = rev('22222222-2222-4222-8222-222222222222', 2, 11);
    const c: PlanContext = { projectId: ids.projectId, base, baseAppearance: null, baseOutputs: [], source: { ...source, appearance: null, outputs: [] } };
    const appearance = planRevision(c, buildIntent({ text: 'Make the exterior walls darker.' }, base, []));
    expect(appearance).toMatchObject({ status: 'UNSUPPORTED', kind: 'APPEARANCE_MODIFY', blockers: [expect.objectContaining({ code: 'SCENE_UNSUPPORTED_MODEL' })] });
    const restore = planRevision(c, buildIntent({ operation: { kind: 'RESTORE', sourceRevisionId: source.id } }, base, [{ id: source.id, revisionNumber: 1 }]));
    expect(restore).toMatchObject({ status: 'AWAITING_CONSENT', kind: 'RESTORE' });
    const rows = Object.fromEntries(MODEL_LIMITS.map(l => [l.limitId, l]));
    expect(rows.BIM_PROFILE_MAX_STOREYS!.appliesTo).not.toContain('SELECTIVE_REVISION');
    expect(rows.SELECTIVE_REVISION_APPEARANCE_PROFILE).toMatchObject({ value: 10, appliesTo: ['SELECTIVE_REVISION_APPEARANCE_MODIFY'] });
    expect(rows.SELECTIVE_REVISION_APPEARANCE_PROFILE!.onExceed).toMatch(/^200 preflight with status UNSUPPORTED and blocker SCENE_UNSUPPORTED_MODEL .*RESTORE is not gated/);
  });

  it('marks BIM-gated related services REFUSED for a tall model and only PRELIMINARY_ELIGIBLE inside the profile (F4), without changing domain statuses', () => {
    const related = [{ serviceId: 'BUILDING_SYSTEMS_ANALYSIS' as const, route: '/r', artifactsForRevision: 0, note: 'n' },
      { serviceId: 'QUANTITY_TAKEOFF' as const, route: '/t', artifactsForRevision: null, note: 'n' }, { serviceId: 'COMPLEX_VERIFICATION' as const, route: '/v', artifactsForRevision: null, note: 'n' }];
    const run = (model: BuildingModelV2) => assessModel({ ids, model, request: AssessmentRequestSchema.parse({}), brief: { version: 0, briefHash: null, floors: null }, evidence: [],
      related, generatedAt: '2026-10-12T00:00:00.000Z' });
    const support = (r: ReturnType<typeof run>, domainId: string) => r.domains.find(d => d.domain === domainId)!.relatedServices.map(s => [s.serviceId, s.modelSupport, s.refusalCode]);
    const tall = run(supertall()), small = run(authored());
    expect(support(tall, 'VERTICAL_TRANSPORT')).toEqual([['BUILDING_SYSTEMS_ANALYSIS', 'REFUSED', 'BIM_UNSUPPORTED_MODEL']]);
    expect(support(tall, 'PRELIMINARY_COST')).toEqual([['QUANTITY_TAKEOFF', 'NOT_CHECKED', null]]);
    expect(support(tall, 'SITE_AND_GEOMETRY')).toEqual([['COMPLEX_VERIFICATION', 'SUPPORTED', null]]);
    expect(support(small, 'FIRE_AND_LIFE_SAFETY')).toEqual([['BUILDING_SYSTEMS_ANALYSIS', 'PRELIMINARY_ELIGIBLE', null]]);
    expect(tall.domains.find(d => d.domain === 'FIRE_AND_LIFE_SAFETY')!.status).toBe('REQUIRES_INPUTS');
    expect(tall.limitations.some(l => l.includes('limited to two floors'))).toBe(true);
  });
});
