import { describe, expect, it } from 'vitest';
import type { BuildingModelV2 } from '@designflow/shared';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { tower } from '../../../test-support/tower-fixtures.js';
import { floorDistance } from '../src/verification/geometry.js';
import { convexHull, heightToWidth, minimumWidth2, storeyHeights } from '../src/engineering/geometry.js';
import { assessModel, domainStatus, type AssessmentInput } from '../src/engineering/assess.js';
import { AssessmentRequestSchema, type AssessmentRequest } from '../src/engineering/contracts.js';
import { verifyModel } from '../src/verification/verify.js';

const ids = { projectId: '00000000-0000-4000-8000-000000000001', revisionId: '00000000-0000-4000-8000-000000000002', modelHash: 'a'.repeat(64) };
/** Citation-only evidence resolves exactly as the service resolves it (referenced evidence is covered by the integration suite). */
const assess = (model: BuildingModelV2, body: unknown = {}, extra: Partial<AssessmentInput> = {}) => {
  const request = AssessmentRequestSchema.parse(body);
  const evidence = request.evidence.map(e => ({ kind: e.kind, referenceId: null, citation: e.citation ?? null, reference: null, verification: 'USER_DECLARED' as const, contentInterpreted: false as const }));
  return assessModel({ ids, model, request, brief: { version: 0, briefHash: null, floors: null }, evidence, related: [], generatedAt: '2026-10-11T00:00:00.000Z', ...extra });
};
const domain = (r: ReturnType<typeof assess>, d: string) => r.domains.find(x => x.domain === d)!;
const finding = (r: ReturnType<typeof assess>, f: string) => r.findings.find(x => x.findingId === f)!;
const IN = { country: 'IN', subdivision: 'Maharashtra', locality: 'Mumbai' };
/** Every declared engineering input, so what remains blocked is blocked for a reason other than missing data. */
const complete = { jurisdiction: IN, occupancy: { primary: 'OFFICE' }, structuralSystem: { primaryMaterial: 'REINFORCED_CONCRETE' },
  evidence: [{ kind: 'GEOTECHNICAL_INVESTIGATION', citation: 'Test citation only' }] };
/** Clearly labelled test values: none of these is a real or current rate. */
const testSource = (extra: Record<string, unknown> = {}) => ({ kind: 'USER_SUPPLIED', title: 'Unit-test rate (not a real rate)', jurisdiction: 'IN', retrievedOn: '2026-10-01', ...extra });
const component = (code: string, scope: string, rate: string, extra: Record<string, unknown> = {}) => ({ code, label: code, scope, basis: 'GROSS_FLOOR_AREA_M2', rate,
  includes: { gst: 'EXCLUDED', overheadAndProfit: 'INCLUDED' }, source: testSource(), ...extra });
const adjustment = (code: string, category: string, order: number, value: string, extra: Record<string, unknown> = {}) => ({ code, label: code, category, order,
  kind: 'PERCENT', direction: 'ADD', basis: 'BASE', value, source: testSource(), ...extra });
const costRequest = (cost: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ jurisdiction: IN, cost: { currency: 'INR', ...cost }, ...extra });

describe('Phase 35 exact base geometry', () => {
  it('takes the minimum caliper width of the convex hull, not an axis-aligned box', () => {
    expect(floorDistance(minimumWidth2(convexHull([{ x: 0, z: 0 }, { x: 8000, z: 0 }, { x: 8000, z: 6000 }, { x: 0, z: 6000 }]))!)).toBe(6000n);
    // A square of side 3000√2 rotated 45°: its bounding box is 6000 wide but its true width is 4242.64… mm.
    const diamond = minimumWidth2(convexHull([{ x: 0, z: 3000 }, { x: 3000, z: 0 }, { x: 6000, z: 3000 }, { x: 3000, z: 6000 }]))!;
    expect(diamond.n * 1n).toBe(18_000_000n * diamond.d); // width² = (3000√2)² exactly
    expect(floorDistance(diamond)).toBe(4242n);
    // 3-4-5 triangle: the minimum width is the altitude onto the hypotenuse, 4000 × 3000 / 5000 = 2400 exactly.
    expect(floorDistance(minimumWidth2(convexHull([{ x: 0, z: 0 }, { x: 4000, z: 0 }, { x: 0, z: 3000 }]))!)).toBe(2400n);
    // An L-shape loses its re-entrant corner and keeps the five hull vertices.
    expect(convexHull([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4 }, { x: 4, z: 4 }, { x: 4, z: 10 }, { x: 0, z: 10 }])).toHaveLength(5);
    expect(minimumWidth2(convexHull([{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 10, z: 0 }]))).toBeNull(); // degenerate
  });
  it('floors the height-to-width ratio at four decimals instead of rounding it', () => {
    expect(heightToWidth(3000, { n: 36_000_000n, d: 1n })).toEqual({ decimal: '0.5000', rounding: 'FLOOR_4' });
    expect(heightToWidth(20_000, { n: 9_000_000n, d: 1n })!.decimal).toBe('6.6666'); // 6.6666…, half-up would give 6.6667
    expect(heightToWidth(10_000, { n: 0n, d: 1n })).toBeNull();
  });
});

describe('Phase 35 storey heights', () => {
  const plates = (m: BuildingModelV2) => verifyModel(m, ids, null).bases.levels;
  it('uses declared floor-to-floor heights and measures from the lowest storey floor', () => {
    const h = storeyHeights(authored(), plates(authored()));
    expect(h).toMatchObject({ storeyCount: 1, lowestStoreyElevationMm: 0, topOfUppermostStoreyMm: 3000, heightMm: 3000, statutoryHeight: 'NOT_EVALUATED',
      storeys: [{ levelId: 'ground', storeyHeightMm: 3000, storeyHeightBasis: 'DECLARED_FLOOR_TO_FLOOR', grossPlateAreaMm2: '48000000' }] });
  });
  it('derives undeclared storey heights from the next level or a roof level, and never guesses the uppermost one', () => {
    const open = tower({ storeys: 3, topFloorToFloor: false });
    expect(storeyHeights(open, plates(open))).toMatchObject({ heightMm: null, topOfUppermostStoreyMm: null, storeys: [{}, {}, { storeyHeightBasis: 'NOT_DETERMINED', storeyHeightMm: null }] });
    const roofed = tower({ storeys: 3, topFloorToFloor: false });
    roofed.levels.push({ id: 'roof', name: 'Roof', index: 3, kind: 'roof', elevationMm: 12_500, floorToFloorHeightMm: null, boundary: roofed.levels[0]!.boundary });
    expect(storeyHeights(roofed, plates(roofed))).toMatchObject({ heightMm: 12_500, storeys: [{}, {}, { storeyHeightMm: 4500, storeyHeightBasis: 'ROOF_LEVEL_ELEVATION' }] });
    const gap = tower({ storeys: 3 });
    gap.levels[1]!.floorToFloorHeightMm = null;
    const r = assess(gap);
    expect(r.height.storeys[1]).toMatchObject({ storeyHeightMm: 4000, storeyHeightBasis: 'NEXT_STOREY_ELEVATION' });
    expect(finding(r, 'STOREY_HEIGHT_DECLARED')).toMatchObject({ status: 'WARNING', entityIds: ['storey-1'], measured: '2/3 declared' });
  });
});

describe('Phase 35 assessment report', () => {
  it('reports exact areas, volume and base width for an authored model, deterministically', () => {
    const r = assess(authored());
    // 8 m × 6 m single storey, 3 m floor-to-floor: GFA 48 m², volume 144 m³, base width 6 m, H/W = 3 / 6.
    expect(r).toMatchObject({ assessmentVersion: 'engineering-assessment-v1', consistency: 'CONSISTENT', height: { heightMm: 3000, storeyCount: 1 },
      areas: { grossFloorAreaMm2: '48000000', grossFloorAreaM2: '48', grossVolumeMm3: '144000000000', grossVolumeM3: '144', plotAreaMm2: '48000000' },
      baseGeometry: { minimumWidthMm: 6000, heightToMinimumWidth: { decimal: '0.5000' } }, verification: { status: 'VERIFIED' }, cost: null });
    expect(['HEIGHT_AND_STOREYS', 'AREAS_AND_VOLUME', 'SITE_AND_GEOMETRY', 'BASE_SLENDERNESS'].map(d => domain(r, d).status)).toEqual(Array(4).fill('EVALUATED'));
    const again = assess(authored(), {}, { generatedAt: '2027-01-01T00:00:00.000Z' });
    expect([again.inputHash, again.resultHash]).toEqual([r.inputHash, r.resultHash]); // only the timestamp differs
    expect(assess(authored(), { occupancy: { primary: 'OFFICE' } }).inputHash).not.toBe(r.inputHash);
    expect(assess(authored(), {}, { brief: { version: 1, briefHash: 'b'.repeat(64), floors: 1 } }).inputHash).not.toBe(r.inputHash);
  });

  it('assesses a Burj Khalifa-scale concept quickly, within bounds, and fails every structural determination safely', () => {
    const storeys = 163, h = 5120, started = performance.now();
    const r = assess(tower({ storeys, storeyHeightMm: h }), complete);
    expect(performance.now() - started).toBeLessThan(5000);
    // Independent arithmetic: 40 m × 30 m plates; every plate above the first has a 31 × 280 mm by 1200 mm stair void.
    const plate = 40_000n * 30_000n, voidArea = 31n * 280n * 1200n, gfa = BigInt(storeys) * plate - BigInt(storeys - 1) * voidArea;
    expect(r.height).toMatchObject({ storeyCount: 163, heightMm: 834_560, storeyHeights: { minMm: h, maxMm: h, distinctMm: [h] } });
    expect(r.areas.grossFloorAreaMm2).toBe(gfa.toString());
    expect(r.areas.grossVolumeMm3).toBe((gfa * BigInt(h)).toString());
    expect(r.baseGeometry).toMatchObject({ minimumWidthMm: 30_000, heightToMinimumWidth: { decimal: '27.8186' } }); // 834.56 / 30 = 27.8186…
    const structural = ['GRAVITY_LOADS', 'WIND_LOADS', 'SEISMIC_LOADS', 'GEOTECHNICAL_AND_FOUNDATIONS', 'LATERAL_DRIFT_AND_STABILITY', 'DYNAMIC_RESPONSE', 'MEMBER_DESIGN',
      'PROGRESSIVE_COLLAPSE', 'FIRE_AND_LIFE_SAFETY', 'VERTICAL_TRANSPORT', 'CODE_COMPLIANCE', 'CERTIFICATION_AND_APPROVAL'];
    for (const d of structural) expect(domain(r, d).status, d).not.toMatch(/EVALUATED/);
    expect(Object.fromEntries(structural.map(d => [d, domain(r, d).status]))).toEqual({
      GRAVITY_LOADS: 'REQUIRES_SOURCE_VERIFICATION', WIND_LOADS: 'REQUIRES_SOURCE_VERIFICATION', SEISMIC_LOADS: 'REQUIRES_SOURCE_VERIFICATION',
      GEOTECHNICAL_AND_FOUNDATIONS: 'REQUIRES_SOLVER', LATERAL_DRIFT_AND_STABILITY: 'REQUIRES_SOURCE_VERIFICATION', DYNAMIC_RESPONSE: 'REQUIRES_SOLVER',
      MEMBER_DESIGN: 'UNSUPPORTED', PROGRESSIVE_COLLAPSE: 'UNSUPPORTED', FIRE_AND_LIFE_SAFETY: 'REQUIRES_SOURCE_VERIFICATION', VERTICAL_TRANSPORT: 'UNSUPPORTED',
      CODE_COMPLIANCE: 'UNSUPPORTED', CERTIFICATION_AND_APPROVAL: 'REQUIRES_PROFESSIONAL_REVIEW' });
    // Every non-geometric domain still requires qualified review behind its first blocker.
    for (const d of structural.filter(x => x !== 'VERTICAL_TRANSPORT')) expect(domain(r, d).blockers.some(b => b.kind === 'PROFESSIONAL_REVIEW'), d).toBe(true);
    expect(r.claims).toEqual({ structuralSafety: 'NOT_CLAIMED', codeCompliance: 'NOT_CLAIMED', statutoryApproval: 'NOT_CLAIMED', professionalCertification: 'NOT_CLAIMED',
      constructionReadiness: 'NOT_CLAIMED' });
    expect(r.requirements.filter(x => x.inputPath !== 'cost')).toEqual([]); // nothing left that the caller can supply except rates
  });

  it('names Indian candidate sources as unverified and never borrows them for another jurisdiction', () => {
    const india = assess(authored(), complete);
    expect(domain(india, 'WIND_LOADS').blockers.find(b => b.kind === 'SOURCE_NOT_VERIFIED')).toMatchObject({ code: 'CANDIDATE_SOURCE_NOT_VERIFIED',
      sourceIds: ['IN-BIS-IS875-3', 'IN-BIS-IS16700'] });
    expect(india.sources.map(s => s.sourceId).sort()).toEqual(['IN-BIS-IS16700', 'IN-BIS-IS1893-1', 'IN-BIS-IS875-1', 'IN-BIS-IS875-2', 'IN-BIS-IS875-3', 'IN-BIS-NBC']);
    for (const s of india.sources) expect(s).toMatchObject({ verificationStatus: 'NOT_VERIFIED', permittedUse: 'IDENTIFICATION_ONLY', edition: null, effectiveDate: null,
      amendmentStatus: 'UNKNOWN', retrievedOn: null, url: null });
    const abroad = assess(authored(), { ...complete, jurisdiction: { country: 'US', locality: 'Chicago' } });
    expect(abroad.sources).toEqual([]);
    expect(domain(abroad, 'WIND_LOADS').blockers.find(b => b.kind === 'SOURCE_NOT_VERIFIED')).toMatchObject({ code: 'GOVERNING_SOURCE_NOT_IDENTIFIED', sourceIds: [] });
    const none = assess(authored());
    expect(domain(none, 'GRAVITY_LOADS')).toMatchObject({ status: 'REQUIRES_INPUTS' });
    expect(none.requirements.map(x => x.inputPath)).toEqual(expect.arrayContaining(['jurisdiction.country', 'occupancy.primary', 'structuralSystem.primaryMaterial',
      'jurisdiction.locality', 'evidence[GEOTECHNICAL_INVESTIGATION]', 'cost']));
    expect(none.requirements.find(x => x.inputPath === 'jurisdiction.country')!.neededFor).toEqual(expect.arrayContaining(['GRAVITY_LOADS', 'WIND_LOADS', 'FIRE_AND_LIFE_SAFETY']));
  });

  it('compares declared targets and the brief exactly, without treating user-stated floors as authoritative', () => {
    const r = assess(tower({ storeys: 10 }), { declared: { heightMm: 40_001, storeys: 10 } }, { brief: { version: 2, briefHash: 'c'.repeat(64), floors: 12 } });
    expect(finding(r, 'DECLARED_HEIGHT')).toMatchObject({ status: 'FAIL', measured: '40000 mm', required: '40001 ± 0 mm' });
    expect(finding(r, 'DECLARED_STOREYS')).toMatchObject({ status: 'PASS' });
    expect(finding(r, 'BRIEF_FLOORS')).toMatchObject({ status: 'WARNING', measured: '10', required: '12' });
    expect(r.consistency).toBe('INCONSISTENT');
    expect(r.context).toMatchObject({ briefVersion: 2, briefFloors: 12, provenance: 'USER_DECLARED_NOT_VERIFIED' });
    expect(finding(assess(tower({ storeys: 10 }), { declared: { heightMm: 40_001, heightToleranceMm: 1 } }), 'DECLARED_HEIGHT').status).toBe('PASS');
    expect(assess(tower({ storeys: 3, topFloorToFloor: false }), { declared: { heightMm: 12_000 } })).toMatchObject({ consistency: 'PARTIAL' });
  });

  it('limits domains and cost to the requested scope', () => {
    const r = assess(authored(), costRequest({ components: [component('ALL', 'WHOLE_BUILDING', '100')] }, { scope: ['HEIGHT_AND_STOREYS', 'WIND_LOADS'] }));
    expect(r.domains.map(d => d.domain)).toEqual(['HEIGHT_AND_STOREYS', 'WIND_LOADS']);
    expect(r.cost).toBeNull();
    expect(r.requirements.map(x => x.inputPath)).not.toContain('cost');
  });

  it('orders domain status by what blocks it', () => {
    const b = (kind: string) => ({ kind, code: kind, detail: '', inputPath: null, sourceIds: [] }) as never;
    expect(domainStatus(true, [])).toBe('EVALUATED');
    expect(domainStatus(true, [b('MISSING_INPUT')])).toBe('PARTIALLY_EVALUATED');
    expect(domainStatus(false, [b('PROFESSIONAL_REVIEW'), b('NO_VALIDATED_SOLVER'), b('SOURCE_NOT_VERIFIED'), b('MISSING_INPUT'), b('NOT_IMPLEMENTED')])).toBe('UNSUPPORTED');
    expect(domainStatus(false, [b('PROFESSIONAL_REVIEW'), b('NO_VALIDATED_SOLVER'), b('SOURCE_NOT_VERIFIED'), b('INPUT_CONFLICT')])).toBe('REQUIRES_INPUTS');
    expect(domainStatus(false, [b('PROFESSIONAL_REVIEW'), b('NO_VALIDATED_SOLVER'), b('SOURCE_NOT_VERIFIED')])).toBe('REQUIRES_SOURCE_VERIFICATION');
    expect(domainStatus(false, [b('PROFESSIONAL_REVIEW'), b('NO_VALIDATED_SOLVER')])).toBe('REQUIRES_SOLVER');
    expect(domainStatus(false, [b('PROFESSIONAL_REVIEW')])).toBe('REQUIRES_PROFESSIONAL_REVIEW');
  });
});

describe('Phase 35 conceptual cost arithmetic', () => {
  const cost = (request: unknown, model = authored()) => assess(model, request).cost!;
  it('prices a whole-building rate with explicit, ordered additions and a complete total', () => {
    const r = assess(authored(), costRequest({ components: [component('ALL', 'WHOLE_BUILDING', '25000.5')],
      adjustments: [adjustment('TAX', 'GST', 10, '12.5'), adjustment('CONT', 'CONTINGENCY', 20, '5', { basis: 'RUNNING' })] }));
    // 48 m² × 25 000.50 = 1 200 024.00; GST-category addition 12.5 % of base = 150 003.00; contingency 5 % of 1 350 027.00 = 67 501.35.
    expect(r.cost).toMatchObject({ status: 'COMPLETE', baseSubtotal: '1200024.00', pricedTotal: '1417528.35', completeTotal: '1417528.35', taxBasis: 'GST_ADDED_BY_ADJUSTMENT',
      estimateClass: 'CONCEPTUAL_PARAMETRIC', blockedReasons: [], lines: [{ quantity: '48', unit: 'm2', amount: '1200024.00', status: 'PRICED' }],
      adjustments: [{ code: 'TAX', basisAmount: '1200024.00', amount: '150003.00' }, { code: 'CONT', basisAmount: '1350027.00', amount: '67501.35' }],
      claims: { tender: 'NOT_CLAIMED', officialRateVerification: 'NOT_CLAIMED' } });
    expect(r.cost!.scopes.every(s => s.status === 'PRICED' && s.lineCodes.includes('ALL'))).toBe(true);
    expect(domain(r, 'PRELIMINARY_COST')).toMatchObject({ status: 'EVALUATED', blockers: [] });
  });
  it('uses exact quantities for every basis and rounds money half-up per line', () => {
    const c = cost(costRequest({ components: [component('VOL', 'SUPERSTRUCTURE', '1000.005', { basis: 'GROSS_VOLUME_M3' }), component('GFA', 'ENVELOPE', '0.123456'),
      component('PLOT', 'EXTERNAL_WORKS', '10', { basis: 'PLOT_AREA_M2' }), component('LIFT', 'VERTICAL_TRANSPORT', '2500000', { basis: 'STOREY_COUNT' }),
      component('PRELIMS', 'PRELIMINARIES_AND_GENERAL', '99999.995', { basis: 'LUMP_SUM' })] }));
    // 144 × 1000.005 = 144 000.72; 48 × 0.123456 = 5.925888 → 5.93; 48 × 10 = 480.00; 1 × 2 500 000; 99 999.995 → 100 000.00 (half-up).
    expect(c.lines.map(l => [l.code, l.quantity, l.unit, l.amount])).toEqual([['VOL', '144', 'm3', '144000.72'], ['GFA', '48', 'm2', '5.93'], ['PLOT', '48', 'm2', '480.00'],
      ['LIFT', '1', 'storey', '2500000.00'], ['PRELIMS', '1', 'item', '100000.00']]);
    expect(c.lines[1]!.amountExact).toEqual({ numerator: '92592', denominator: '15625' }); // 5.925888 exactly
    expect(c.baseSubtotal).toBe('2744486.65');
  });
  it('returns a partial estimate with unpriced scopes and withholds the complete total', () => {
    const r = assess(authored(), costRequest({ components: [component('FRAME', 'SUPERSTRUCTURE', '100'), component('SKIN', 'ENVELOPE', '50')] }));
    expect(r.cost).toMatchObject({ status: 'PARTIAL', pricedTotal: '7200.00', completeTotal: null });
    expect(r.cost!.scopes.filter(s => s.status === 'UNPRICED').map(s => s.scope)).toHaveLength(7);
    expect(r.cost!.warnings).toContainEqual({ code: 'CONTINGENCY_NOT_INCLUDED', ref: null });
    expect(domain(r, 'PRELIMINARY_COST')).toMatchObject({ status: 'PARTIALLY_EVALUATED' });
    expect(r.requirements.map(x => x.inputPath)).toContain('cost.components[scope=SUBSTRUCTURE]');
    const excludedAll = cost(costRequest({ components: [component('FRAME', 'SUPERSTRUCTURE', '100'), component('SKIN', 'ENVELOPE', '50')],
      excludedScopes: ['SUBSTRUCTURE', 'INTERIOR_FINISHES', 'MEP_SERVICES', 'VERTICAL_TRANSPORT', 'FIRE_PROTECTION', 'EXTERNAL_WORKS', 'PRELIMINARIES_AND_GENERAL']
        .map(scope => ({ scope, reason: 'Outside this test estimate' })) }));
    expect(excludedAll).toMatchObject({ status: 'COMPLETE', completeTotal: '7200.00', taxBasis: 'EXCLUSIVE_OF_GST' });
    expect(cost({ cost: { currency: 'INR', components: [component('ALL', 'WHOLE_BUILDING', '100')] } })).toMatchObject({ status: 'PARTIAL', completeTotal: null,
      warnings: expect.arrayContaining([{ code: 'JURISDICTION_NOT_DECLARED', ref: null }]) });
  });
  it('blocks totals that would double-count GST, overhead or profit, or overlap scopes', () => {
    const blocked = (components: unknown[], adjustments: unknown[] = []) => cost(costRequest({ components, adjustments }));
    const gstIncluded = component('ALL', 'WHOLE_BUILDING', '100', { includes: { gst: 'INCLUDED', overheadAndProfit: 'EXCLUDED' } });
    expect(blocked([gstIncluded], [adjustment('TAX', 'GST', 1, '18')])).toMatchObject({ status: 'BLOCKED', blockedReasons: ['GST_DOUBLE_COUNT_RISK'], pricedTotal: null,
      completeTotal: null, baseSubtotal: null, adjustments: [], taxBasis: 'MIXED_OR_UNKNOWN' });
    const gstUnknown = component('ALL', 'WHOLE_BUILDING', '100', { includes: { gst: 'UNKNOWN', overheadAndProfit: 'EXCLUDED' } });
    expect(blocked([gstUnknown], [adjustment('TAX', 'GST', 1, '18')]).blockedReasons).toEqual(['GST_DOUBLE_COUNT_RISK']);
    expect(blocked([component('ALL', 'WHOLE_BUILDING', '100')], [adjustment('OH', 'OVERHEAD', 1, '10')]).blockedReasons).toEqual(['OVERHEAD_PROFIT_DOUBLE_COUNT_RISK']);
    expect(blocked([component('ALL', 'WHOLE_BUILDING', '100')], [adjustment('C1', 'CONTINGENCY', 1, '5'), adjustment('C2', 'CONTINGENCY', 2, '5')]).blockedReasons)
      .toEqual(['DUPLICATE_ADJUSTMENT_CATEGORY']);
    expect(blocked([component('ALL', 'WHOLE_BUILDING', '100'), component('FRAME', 'SUPERSTRUCTURE', '10')]).blockedReasons).toEqual(['SCOPE_OVERLAP_WHOLE_BUILDING']);
    expect(blocked([component('ALL', 'WHOLE_BUILDING', '1')], [adjustment('REBATE', 'OTHER', 1, '49', { kind: 'FIXED', direction: 'DEDUCT' })]).blockedReasons).toEqual(['NEGATIVE_TOTAL']);
    const r = assess(authored(), costRequest({ components: [gstIncluded], adjustments: [adjustment('TAX', 'GST', 1, '18')] }));
    expect(domain(r, 'PRELIMINARY_COST')).toMatchObject({ status: 'REQUIRES_INPUTS', blockers: [{ kind: 'INPUT_CONFLICT', code: 'GST_DOUBLE_COUNT_RISK' }] });
  });
  it('rejects foreign-jurisdiction rates and incomplete official-schedule metadata instead of pricing them', () => {
    const foreign = component('US-BOOK', 'SUPERSTRUCTURE', '300', { source: testSource({ kind: 'MARKET_BENCHMARK', title: 'Overseas cost book (test)', jurisdiction: 'US' }) });
    expect(cost(costRequest({ components: [foreign] }))).toMatchObject({ status: 'BLOCKED', blockedReasons: ['NOTHING_PRICED'],
      lines: [{ status: 'REJECTED', reason: 'RATE_JURISDICTION_MISMATCH', amount: null }] });
    const official = (extra: Record<string, unknown>) => component('SOR', 'SUPERSTRUCTURE', '100', { source: testSource({ kind: 'OFFICIAL_SCHEDULE', title: 'Schedule (test)', ...extra }) });
    const c = cost(costRequest({ components: [official({}), component('SKIN', 'ENVELOPE', '1')] }));
    expect(c).toMatchObject({ status: 'PARTIAL', lines: [{ status: 'REJECTED', reason: 'OFFICIAL_SOURCE_METADATA_INCOMPLETE' }, { status: 'PRICED' }] });
    const ok = cost(costRequest({ components: [official({ issuer: 'Issuer (test)', reference: 'TEST-REF-1', effectiveDate: '2026-04-01' })] })).lines[0]!;
    expect(ok).toMatchObject({ status: 'PRICED', source: { evidenceClass: 'USER_ASSERTED_OFFICIAL_SCHEDULE', verification: 'NOT_VERIFIED_BY_BACKEND' } });
  });
  it('withholds a complete total when a priced rate or adjustment does not state its jurisdiction or date', () => {
    const run = (source: Record<string, unknown>, contingency: Record<string, unknown> = {}) => assess(authored(), costRequest({
      components: [component('ALL', 'WHOLE_BUILDING', '300', { source })], adjustments: [adjustment('CONT', 'CONTINGENCY', 1, '5', contingency)] }));
    expect(run(testSource()).cost).toMatchObject({ status: 'COMPLETE', completeTotal: '15120.00' }); // 48 × 300 = 14 400.00; + 5 % = 15 120.00
    // An overseas benchmark that simply omits its jurisdiction and date must not slip into a complete total.
    const overseas = run({ kind: 'MARKET_BENCHMARK', title: 'Overseas cost book (test)' });
    expect(overseas.cost).toMatchObject({ status: 'PARTIAL', pricedTotal: '15120.00', completeTotal: null });
    expect(domain(overseas, 'PRELIMINARY_COST').status).toBe('PARTIALLY_EVALUATED');
    expect(overseas.requirements.map(r => r.inputPath)).toEqual(expect.arrayContaining(['cost.*.source.jurisdiction', 'cost.*.source.effectiveDate']));
    expect(run(testSource({ retrievedOn: undefined })).cost).toMatchObject({ status: 'PARTIAL', completeTotal: null }); // stated jurisdiction, no date
    const adjustmentUnscoped = run(testSource(), { source: { kind: 'USER_SUPPLIED', title: 'Contingency policy (test)', retrievedOn: '2026-10-01' } });
    expect(adjustmentUnscoped.cost).toMatchObject({ status: 'PARTIAL', completeTotal: null });
    expect(adjustmentUnscoped.cost!.warnings).toContainEqual({ code: 'RATE_JURISDICTION_UNKNOWN', ref: 'CONT' });
  });
  it('labels synthetic and non-authoritative rates and flags undated or unscoped sources', () => {
    const c = cost(costRequest({ components: [component('SYN', 'SUPERSTRUCTURE', '1', { source: { kind: 'SYNTHETIC', title: 'Demo' } }),
      component('BENCH', 'ENVELOPE', '1', { source: testSource({ kind: 'THIRD_PARTY_CALCULATOR', title: 'Online calculator (test)' }) })] }));
    expect(c.evidenceClasses).toEqual(['NON_AUTHORITATIVE_BENCHMARK', 'SYNTHETIC']);
    expect(c.warnings).toEqual(expect.arrayContaining([{ code: 'SYNTHETIC_RATE', ref: 'SYN' }, { code: 'NON_AUTHORITATIVE_RATE', ref: 'BENCH' },
      { code: 'RATE_DATE_UNKNOWN', ref: 'SYN' }, { code: 'RATE_JURISDICTION_UNKNOWN', ref: 'SYN' }]));
  });
  it('stays within its report bounds at the input limits (64 synthetic, undated, unscoped components on an envelope-based model)', () => {
    const envelope = authored();
    envelope.slabs = []; // plates fall back to level envelopes, adding the area-basis warning to every line
    const components = Array.from({ length: 64 }, (_, i) => component(`S${i}`, i % 2 ? 'SUPERSTRUCTURE' : 'ENVELOPE', '1',
      { basis: i % 3 ? 'GROSS_FLOOR_AREA_M2' : 'GROSS_VOLUME_M3', source: { kind: 'SYNTHETIC', title: 'Demo', jurisdiction: i % 5 ? null : 'US' } }));
    const adjustments = Array.from({ length: 16 }, (_, i) => adjustment(`A${i}`, 'OTHER', i, '1', { source: { kind: 'SYNTHETIC', title: 'Demo' } }));
    const c = cost({ cost: { currency: 'INR', components, adjustments } }, envelope);
    expect(c.lines).toHaveLength(64);
    expect(c.adjustments).toHaveLength(16);
    expect(c.warnings.length).toBeGreaterThan(200);
  });
  it('refuses a volume-based line when the volume is undetermined', () => {
    const c = cost(costRequest({ components: [component('VOL', 'SUPERSTRUCTURE', '1', { basis: 'GROSS_VOLUME_M3' }), component('GFA', 'ENVELOPE', '1')] }),
      tower({ storeys: 2, topFloorToFloor: false }));
    expect(c.lines.map(l => [l.code, l.status, l.reason])).toEqual([['VOL', 'REJECTED', 'QUANTITY_NOT_AVAILABLE'], ['GFA', 'PRICED', null]]);
  });
});

describe('Phase 35 request contract', () => {
  const parse = (body: unknown) => AssessmentRequestSchema.safeParse(body).success;
  const base = { currency: 'INR', components: [component('A', 'SUPERSTRUCTURE', '1')] };
  it('accepts the documented shapes and rejects malformed, inexact, conflicting or oversized input', () => {
    expect(parse({})).toBe(true);
    expect(parse(costRequest(base))).toBe(true);
    expect(parse({ unknown: true })).toBe(false);
    expect(parse({ scope: ['NOT_A_DOMAIN'] })).toBe(false);
    expect(parse({ declared: { heightMm: 1.5 } })).toBe(false);
    expect(parse({ jurisdiction: { country: 'India' } })).toBe(false);
    expect(parse({ evidence: [{ kind: 'GEOTECHNICAL_INVESTIGATION' }] })).toBe(false); // needs a reference or a citation
    for (const rate of ['1e3', '1.1234567', '-1', '0012', '1234567890123']) expect(parse(costRequest({ ...base, components: [component('A', 'SUPERSTRUCTURE', rate)] })), rate).toBe(false);
    expect(parse(costRequest({ ...base, adjustments: [adjustment('X', 'OTHER', 1, '100.01')] }))).toBe(false);
    expect(parse(costRequest({ ...base, components: [component('A', 'SUPERSTRUCTURE', '1'), component('A', 'ENVELOPE', '1')] }))).toBe(false);
    expect(parse(costRequest({ ...base, adjustments: [adjustment('X', 'OTHER', 1, '1'), adjustment('Y', 'OTHER', 1, '1')] }))).toBe(false);
    expect(parse(costRequest({ ...base, excludedScopes: [{ scope: 'SUPERSTRUCTURE', reason: 'x' }] }))).toBe(false);
    expect(parse(costRequest({ ...base, priceBasisDate: '2026-02-30' }))).toBe(false);
    expect(parse(costRequest({ ...base, components: Array.from({ length: 65 }, (_, i) => component(`C${i}`, 'SUPERSTRUCTURE', '1')) }))).toBe(false);
    expect(parse({ evidence: Array.from({ length: 17 }, () => ({ kind: 'FIRE_STRATEGY', citation: 'x' })) })).toBe(false);
    const parsed: AssessmentRequest = AssessmentRequestSchema.parse({ scope: ['WIND_LOADS', 'WIND_LOADS'], structuralSystem: { primaryMaterial: 'COMPOSITE', description: ' Core\u0000 + outriggers ' } });
    expect(parsed).toMatchObject({ scope: ['WIND_LOADS'], structuralSystem: { description: 'Core + outriggers' }, evidence: [] });
  });
});
