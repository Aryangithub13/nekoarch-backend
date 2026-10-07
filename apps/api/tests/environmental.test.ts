import { describe, expect, it } from 'vitest';
import type { BuildingModelV2 } from '@designflow/shared';
import { cardinalForSide, generateBlueprint, generateBlueprintV2, generateParametricBlueprint, modifyParametricRequirements } from '@designflow/generator';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { solverInput } from '../../../test-support/solver-v2-fixtures.js';
import { TEST_LOCATION, environmentalInput, syntheticWeather } from '../../../test-support/environmental-fixtures.js';
import { modelHash } from '../src/lib/generation-identity.js';
import { projectBim } from '../src/bim/project.js';
import { exportIfc } from '../src/bim/ifc.js';
import { digest } from '../src/bim/core.js';
import { ENVIRONMENTAL_LIMITS, EnvironmentalError, EnvironmentalInputSchema, SnapshotSchema, type EnvironmentalInput, type EnvironmentalModel, type EnvironmentalSurface } from '../src/environmental/contracts.js';
import { buildEnvironmentalModel, environmentalId } from '../src/environmental/model.js';
import { compass, localToUtc, solarPosition, sunVector } from '../src/environmental/solar.js';
import { occludersOf, samplePoints, sunlitSamples } from '../src/environmental/shading.js';
import { REFERENCE_CALCULATOR, environmentalInputHash, resolveAnalysisInput, runEnvironmentalAnalysis, type EnvironmentalCalculatorAdapter } from '../src/environmental/analysis.js';
import { psaSolarPosition, validateEnvironmentalModel, validateEnvironmentalResults } from '../src/environmental/validate.js';
import { KELVIN_OFFSET, celsiusToKelvin, energyWh, temperatureDifferenceK } from '../src/environmental/units.js';

const projectId = '11111111-1111-4111-8111-111111111111', revisionId = '22222222-2222-4222-8222-222222222222';
const binding = (m: BuildingModelV2, r = revisionId, p = projectId) => ({ projectId: p, revisionId: r, modelHash: modelHash(m), generatorVersion: m.provenance.generatorVersion ?? null,
  generationId: null, requirementsHash: null, parameterHash: m.parametricArchitecture ? digest(m.parametricArchitecture) : null });
const parse = (input: unknown) => EnvironmentalInputSchema.parse(input);
const codeOf = (fn: () => unknown) => { try { fn(); } catch (error) { return error instanceof EnvironmentalError ? error.code : `other:${(error as Error).name}`; } return 'none'; };
const maximum = parametricInput(); maximum.site.boundary = [{ x: 0, z: 0 }, { x: 60000, z: 0 }, { x: 60000, z: 60000 }, { x: 0, z: 60000 }];
Object.assign(maximum.parametricArchitecture.floors[0]!, { widthMm: 55000, depthMm: 55000, westWingWidthMm: 27000, southWingDepthMm: 27000 }); maximum.rooms = [{ type: 'bedroom', count: 24 }];
const { layoutV2: _layout, ...v1 } = solverInput();
const FIXTURES: [string, () => BuildingModelV2][] = [['v1', () => generateBlueprint(v1).model], ['v2', () => generateBlueprintV2(solverInput()).model],
  ['L', () => generateParametricBlueprint(parametricInput()).model], ['setback', () => generateParametricBlueprint(parametricInput(true)).model],
  ['maximum-24', () => generateParametricBlueprint(maximum).model],
  ['west-wing-edit', () => generateParametricBlueprint(modifyParametricRequirements(parametricInput(true), { level: 0, parameter: 'westWingWidthMm', valueMm: 10000 })).model],
  ['authored', () => authored()]];
const L = () => generateParametricBlueprint(parametricInput()).model, SETBACK = () => generateParametricBlueprint(parametricInput(true)).model;

function analyzed(m: BuildingModelV2, input: EnvironmentalInput = parse(environmentalInput()), adapter: EnvironmentalCalculatorAdapter = REFERENCE_CALCULATOR, r = revisionId) {
  const bim = projectBim(m, binding(m, r)), model = buildEnvironmentalModel(bim, input), ai = resolveAnalysisInput(model, input), run = runEnvironmentalAnalysis(ai, adapter);
  const snapshot = { binding: model.binding, input, inputHash: environmentalInputHash(model.binding, input), model, results: run.results, calculator: run.calculator };
  return { bim, model, ai, run, snapshot, results: run.results };
}
const check = (s: ReturnType<typeof analyzed>['snapshot']) => validateEnvironmentalResults(s, { binding: s.model.binding });
const shoelaceM2 = (ring: { x: number; z: number }[]) => Math.abs(ring.reduce((a, p, i) => { const q = ring[(i + 1) % ring.length]!; return a + p.x * q.z - q.x * p.z; }, 0)) / 2e6;

describe('Phase 25 units', () => {
  it('treats absolute Celsius as an offset and temperature differences as kelvin', () => {
    expect(KELVIN_OFFSET).toBe(273.15); expect(celsiusToKelvin(0)).toBe(273.15); expect(celsiusToKelvin(-273.15)).toBe(0); expect(celsiusToKelvin(21)).toBeCloseTo(294.15, 12);
    expect(temperatureDifferenceK(20, 0)).toBe(20); expect(temperatureDifferenceK(0, 20)).toBe(-20);
    // A difference is the same in °C and K; converting both ends first must not change it.
    expect(celsiusToKelvin(35) - celsiusToKelvin(-5)).toBeCloseTo(temperatureDifferenceK(35, -5), 12);
  });
  it('separates power and energy: energy needs a duration', () => {
    expect(energyWh(100, 24)).toBe(2400); expect(energyWh(250, 0.5)).toBe(125); expect(energyWh(0, 8760)).toBe(0);
  });
  it('rejects wrong dimensions and absolute-temperature units in the input schema', () => {
    const ok = environmentalInput();
    const bad: [string, (i: any) => void][] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
      ['conductivity unit for U', i => { i.constructions[0].uValue.unit = 'W/(m*K)'; }], ['negative U', i => { i.constructions[0].uValue.value = -0.5; }],
      ['zero U', i => { i.constructions[0].uValue.value = 0; }], ['NaN U', i => { i.constructions[0].uValue.value = Number.NaN; }],
      ['Infinity U', i => { i.constructions[0].uValue.value = Infinity; }], ['Kelvin inside', i => { i.thermalCases[0].inside = { value: 294.15, unit: 'K' }; }],
      ['Fahrenheit outside', i => { i.thermalCases[0].outside.temperature.unit = 'degF'; }], ['implausible outside', i => { i.thermalCases[0].outside.temperature.value = 294.15; }],
      ['library value without reference', i => { i.constructions[0].provenance = { kind: 'VERSIONED_LIBRARY', reference: null, version: null }; }],
      ['AI provenance', i => { i.constructions[0].provenance.kind = 'AI_ESTIMATE'; }], ['missing timezone', i => { delete i.location.timezone; }],
      ['unknown field', i => { i.debug = true; }], ['duration on a weather case', i => { i.thermalCases[0].outside = { kind: 'WEATHER' }; }],
      ['ambiguous instant format', i => { i.solarInstants[0].localDateTime = '2026-03-20 08:00'; }], ['unknown convention', i => { i.orientation.convention = 'NORTH_FROM_PLUS_Z'; }],
    ];
    expect(() => parse(ok)).not.toThrow();
    for (const [name, mutate] of bad) { const i = structuredClone(ok); mutate(i); expect(() => parse(i), name).toThrow(); }
  });
});

describe('Phase 25 solar position (independent references)', () => {
  it('matches the NREL SPA reference case after removing its refraction and parallax', () => {
    // Reda & Andreas (2004): 2003-10-17 12:30:30 at UTC−7, 39.742476 N, 105.1786 W → topocentric zenith 50.11162°, azimuth 194.34024°.
    // Its zenith includes ≈0.0163° refraction (820 mbar, 11 °C) and ≈0.0019° parallax; this module is geometric and geocentric.
    const p = solarPosition(localToUtc('2003-10-17T12:30:30', 'Etc/GMT+7'), 39.742476, -105.1786);
    expect(Math.abs(90 - p.altitude - (50.11162 + 0.0163 - 0.0019))).toBeLessThan(0.02);
    expect(Math.abs(p.azimuth - 194.34024)).toBeLessThan(0.02);
  });
  it('matches Meeus Example 25.a apparent declination (−7°47′06″)', () => {
    expect(Math.abs(solarPosition(Date.UTC(1992, 9, 13), 0, 0).declination - (-(7 + 47 / 60 + 6 / 3600)))).toBeLessThan(0.005);
  });
  const noon = (date: string, lat: number, lon = 0) => { let best = -90;
    for (let m = 0; m < 1440; m++) best = Math.max(best, solarPosition(Date.parse(`${date}T00:00:00Z`) + m * 60_000, lat, lon).altitude); return best; };
  it.each([
    ['equinox, northern', '2026-03-20', 40, 90 - 40], ['equinox, southern', '2026-09-23', -33.9, 90 - 33.9], ['equinox, equator', '2026-03-20', 0, 90],
    ['June solstice, northern', '2026-06-21', 40, 90 - 40 + 23.44], ['December solstice, northern', '2026-12-21', 40, 90 - 40 - 23.44],
    ['June solstice, southern', '2026-06-21', -33.9, 90 - 33.9 - 23.44], ['December solstice, southern', '2026-12-21', -33.9, 90 - 33.9 + 23.44],
  ] as const)('noon altitude: %s', (_n, date, lat, expected) => { expect(Math.abs(noon(date, lat) - expected)).toBeLessThan(0.6); });
  it('puts the sun east in the morning, west in the afternoon, south at noon in the north and north at noon in the south', () => {
    const at = (utc: string, lat: number, lon: number) => solarPosition(Date.parse(utc), lat, lon);
    expect(at('2026-03-20T03:00:00Z', 12.97, 77.59).azimuth).toBeGreaterThan(60); expect(at('2026-03-20T03:00:00Z', 12.97, 77.59).azimuth).toBeLessThan(120);
    expect(at('2026-03-20T10:30:00Z', 12.97, 77.59).azimuth).toBeGreaterThan(240); expect(at('2026-03-20T10:30:00Z', 12.97, 77.59).azimuth).toBeLessThan(300);
    expect(Math.abs(at('2026-12-21T12:00:00Z', 51.48, 0).azimuth - 180)).toBeLessThan(2);
    const sydney = at('2026-06-21T02:00:00Z', -33.87, 151.21).azimuth; expect(Math.min(sydney, 360 - sydney)).toBeLessThan(5);
    expect(at('2026-03-20T22:00:00Z', 12.97, 77.59).altitude).toBeLessThan(0);
  });
  it('agrees with the independently implemented PSA algorithm within 0.03° over latitudes and seasons', () => {
    for (const lat of [-60, -33.9, 0, 12.97, 40, 66]) for (const day of [0, 80, 172, 265, 355]) for (const hour of [6, 9, 12, 15, 18]) {
      const t = Date.UTC(2026, 0, 1) + day * 86_400_000 + hour * 3_600_000, a = solarPosition(t, lat, 77.59), b = psaSolarPosition(t, lat, 77.59);
      expect(Math.abs(a.altitude - b.altitude), `${lat}/${day}/${hour}`).toBeLessThan(0.03);
      if (a.altitude > -10 && a.altitude < 89) expect(Math.abs(((a.azimuth - b.azimuth + 540) % 360) - 180), `${lat}/${day}/${hour}`).toBeLessThan(0.03);
    }
  });
  it('converts local civil time explicitly and refuses DST gaps and folds', () => {
    expect(new Date(localToUtc('2026-06-21T12:00', 'Asia/Kolkata')).toISOString()).toBe('2026-06-21T06:30:00.000Z');
    expect(new Date(localToUtc('2026-07-01T12:00', 'America/New_York')).toISOString()).toBe('2026-07-01T16:00:00.000Z');
    expect(new Date(localToUtc('2026-01-01T12:00', 'America/New_York')).toISOString()).toBe('2026-01-01T17:00:00.000Z');
    expect(codeOf(() => localToUtc('2026-03-08T02:30', 'America/New_York'))).toBe('ENVIRONMENTAL_INPUT_INCOMPLETE');
    expect(codeOf(() => localToUtc('2026-11-01T01:30', 'America/New_York'))).toBe('ENVIRONMENTAL_INPUT_INCOMPLETE');
    expect(codeOf(() => localToUtc('2026-02-30T12:00', 'Asia/Kolkata'))).toBe('ENVIRONMENTAL_INPUT_INCOMPLETE');
    expect(codeOf(() => localToUtc('1850-01-01T12:00', 'UTC'))).toBe('ENVIRONMENTAL_INPUT_INCOMPLETE');
  });
});

describe('Phase 25 orientation', () => {
  const sides = { 'min-z': [0, 0, -1], 'max-x': [1, 0, 0], 'max-z': [0, 0, 1], 'min-x': [-1, 0, 0] } as const;
  const cardinal = (az: number) => (['north', 'east', 'south', 'west'] as const)[Math.round(az / 90) % 4]!;
  it.each([0, 90_000, 180_000, 270_000])('agrees with the tested generator cardinal rule at %i', north => {
    const f = compass(north);
    for (const [side, n] of Object.entries(sides)) {
      const az = ((Math.atan2(n[0] * f.east[0] + n[2] * f.east[2], n[0] * f.north[0] + n[2] * f.north[2]) * 180 / Math.PI) % 360 + 360) % 360;
      expect(cardinal(az), `${side}@${north}`).toBe(cardinalForSide(side as keyof typeof sides, north));
    }
  });
  it('keeps east = north × up (no east/west inversion) at arbitrary rotations', () => {
    for (const north of [0, 30_000, 123_456, 359_999]) { const f = compass(north);
      const cross = [f.north[1] * 0 - f.north[2] * 1, f.north[2] * 0 - f.north[0] * 0, f.north[0] * 1 - f.north[1] * 0];
      cross.forEach((v, i) => expect(v).toBeCloseTo(f.east[i]!, 12));
      // A morning sun (azimuth 90°) lies along east; an afternoon sun (270°) along west.
      const morning = sunVector(10, 90, f), afternoon = sunVector(10, 270, f);
      expect(morning[0] * f.east[0] + morning[2] * f.east[2]).toBeGreaterThan(0.98); expect(afternoon[0] * f.east[0] + afternoon[2] * f.east[2]).toBeLessThan(-0.98);
    }
  });
  it('assigns wall azimuths that rotate with the stated north', () => {
    const m = L(), az = (north: number) => buildEnvironmentalModel(projectBim(m, binding(m)), parse(environmentalInput({ northMilliDegrees: north })))
      .surfaces.filter(s => s.type === 'EXTERIOR_WALL').map(s => [s.source.id, s.azimuth!.value] as const);
    const base = new Map(az(0));
    for (const north of [90_000, 180_000, 270_000, 30_000]) for (const [id, a] of az(north)) expect(((a - (base.get(id)! - north / 1000)) % 360 + 360) % 360, `${id}@${north}`).toBeCloseTo(0, 9);
    const roofs = buildEnvironmentalModel(projectBim(m, binding(m)), parse(environmentalInput())).surfaces.filter(s => s.type !== 'EXTERIOR_WALL' && s.normal[1] !== 0);
    for (const s of roofs) expect(s.azimuth).toBeNull();
  });
});

describe('Phase 25 environmental model on native architecture', () => {
  it.each(FIXTURES)('%s: zones, envelope, independent validation and analysis', (_n, make) => {
    const m = make(), { model, snapshot, results } = analyzed(m);
    expect(validateEnvironmentalModel(model, m, snapshot.input, model.binding)).toEqual({ validator: 'environmental-model-validator-v1', status: 'VALID', diagnostics: [] });
    const v = check(snapshot); expect(v.status, JSON.stringify(v.diagnostics.slice(0, 3))).toBe('VALID');
    expect(model.zones).toHaveLength(m.spaces.length);
    for (const z of model.zones) expect(z.floorArea.value).toBeCloseTo(shoelaceM2(m.spaces.find(s => s.id === z.source.id)!.boundary), 12);
    expect(new Set(model.surfaces.map(s => `${s.source.collection}:${s.source.id}`)).size).toBe(model.surfaces.length);
    expect(Buffer.byteLength(JSON.stringify(results))).toBeLessThan(ENVIRONMENTAL_LIMITS.outputBytes);
  });
  it('derives the authored house envelope by hand: 27.2 m perimeter × 2.8 m, openings deducted exactly once', () => {
    const m = authored(), model = buildEnvironmentalModel(projectBim(m, binding(m)), parse(environmentalInput()));
    const walls = model.surfaces.filter(s => s.type === 'EXTERIOR_WALL'), openings = model.surfaces.filter(s => s.hostSurfaceId);
    expect(walls.reduce((a, s) => a + s.grossArea.value, 0)).toBeCloseTo(2 * (7.8 + 5.8) * 2.8, 12);
    const holes = m.openings.filter(o => walls.some(w => w.source.id === o.wallId)).reduce((a, o) => a + o.widthMm * o.heightMm / 1e6, 0);
    expect(walls.reduce((a, s) => a + s.netArea.value, 0)).toBeCloseTo(2 * (7.8 + 5.8) * 2.8 - holes, 12);
    expect(openings.reduce((a, s) => a + s.netArea.value, 0)).toBeCloseTo(holes, 12);
    // The interior partition and its door are not envelope; no roof plate exists, so the envelope is reported open.
    expect(model.surfaces.some(s => s.source.id === 'partition' || s.source.id === 'studio-door')).toBe(false);
    expect(model.envelope.status).toBe('INCOMPLETE'); expect(model.surfaces.filter(s => s.type === 'GROUND_FLOOR')).toHaveLength(1);
  });
  it('points every wall normal away from its zone and plates up (roof) or down (ground)', () => {
    for (const make of [L, SETBACK]) { const m = make(), model = buildEnvironmentalModel(projectBim(m, binding(m)), parse(environmentalInput()));
      for (const s of model.surfaces.filter(x => x.type === 'EXTERIOR_WALL') as (EnvironmentalSurface & { geometry: { kind: 'VERTICAL_RECTANGLE' } })[]) {
        const g = s.geometry, space = m.spaces.find(x => environmentalId(projectId, 'zone', x.id) === s.zoneIds[0])!;
        const mid = { x: (g.start.x + g.end.x) / 2, z: (g.start.z + g.end.z) / 2 }, xs = space.boundary.map(p => p.x), zs = space.boundary.map(p => p.z);
        // Probing 300 mm outward must leave the zone's bounding box side the wall lies on.
        const out = { x: mid.x + s.normal[0] * 300, z: mid.z + s.normal[2] * 300 };
        expect(out.x < Math.min(...xs) || out.x > Math.max(...xs) || out.z < Math.min(...zs) || out.z > Math.max(...zs), s.id).toBe(true);
      }
      for (const s of model.surfaces.filter(x => x.type === 'ROOF')) expect(s.normal).toEqual([0, 1, 0]);
      for (const s of model.surfaces.filter(x => x.type === 'GROUND_FLOOR')) expect(s.normal).toEqual([0, -1, 0]);
    }
  });
  it('represents the setback: upper walls on the upper storey, exposed lower roofs as roofs, the upper floor as an internal boundary', () => {
    const m = SETBACK(), model = buildEnvironmentalModel(projectBim(m, binding(m)), parse(environmentalInput()));
    expect(model.surfaces.filter(s => s.type === 'ROOF').map(s => s.source.id).sort()).toEqual(m.slabs.filter(s => s.kind === 'flat-roof').map(s => s.id).sort());
    expect(model.surfaces.filter(s => s.type === 'GROUND_FLOOR').map(s => s.source.id)).toEqual(['slab-0']);
    expect(new Set(model.surfaces.filter(s => s.type === 'EXTERIOR_WALL').map(s => s.levelId))).toEqual(new Set(['level-0', 'level-1']));
    expect(model.envelope).toEqual({ status: 'CLOSED', uncoveredZoneIds: [] });
  });
  it('identifies zones by space id, never by display name, and scopes ids by project', () => {
    const m = L(), renamed = structuredClone(m); for (const s of renamed.spaces) s.name = `Renamed ${s.id}`;
    const a = buildEnvironmentalModel(projectBim(m, binding(m)), parse(environmentalInput())), b = buildEnvironmentalModel(projectBim(renamed, binding(renamed)), parse(environmentalInput()));
    expect(b.zones.map(z => z.id)).toEqual(a.zones.map(z => z.id)); expect(b.surfaces.map(s => s.id)).toEqual(a.surfaces.map(s => s.id));
    const other = buildEnvironmentalModel(projectBim(m, binding(m, revisionId, '33333333-3333-4333-8333-333333333333')), parse(environmentalInput()));
    expect(other.zones[0]!.id).not.toBe(a.zones[0]!.id);
  });
  it('never infers thermal properties from architectural material labels', () => {
    const m = generateBlueprint(v1).model; m.specifications = [{ id: 'glass-spec', name: 'Glazing', material: 'Glass', reference: 'Architectural label only' }]; m.walls[0]!.specificationId = 'glass-spec';
    const model = buildEnvironmentalModel(projectBim(m, binding(m)), parse({ ...environmentalInput(), constructions: [], assignments: {} }));
    expect(model.surfaces.every(s => s.construction.status === 'NOT_SPECIFIED')).toBe(true);
    const { results } = analyzed(m, parse({ ...environmentalInput(), constructions: [], assignments: {} }));
    expect(results.thermal.cases[0]!.status).toBe('PARTIAL'); expect(results.thermal.cases[0]!.total.value).toBe(0); expect(results.thermal.cases[0]!.energy).toBeNull();
  });
  it('applies overrides before type assignments and carries provenance', () => {
    const m = L(), wall = m.walls.find(w => w.classification === 'exterior')!, input = parse({ ...environmentalInput(),
      constructions: [...environmentalInput().constructions, { key: 'lib-wall', name: 'Library wall', uValue: { value: 0.25, unit: 'W/(m2*K)' }, provenance: { kind: 'VERSIONED_LIBRARY', reference: 'Test library', version: '2026.1' } }],
      overrides: [{ source: { collection: 'walls', id: wall.id }, construction: 'lib-wall' }] });
    const s = buildEnvironmentalModel(projectBim(m, binding(m)), input).surfaces.find(x => x.source.id === wall.id)!;
    expect(s.construction).toEqual({ status: 'SPECIFIED', key: 'lib-wall', uValue: { value: 0.25, unit: 'W/(m2*K)' }, provenance: { kind: 'VERSIONED_LIBRARY', reference: 'Test library', version: '2026.1' } });
  });
  it('rejects bad references, locations and unsupported sources with typed errors', () => {
    const m = L(), bim = projectBim(m, binding(m)), base = environmentalInput();
    const cases: [string, unknown, string][] = [
      ['unknown construction', { ...base, assignments: { EXTERIOR_WALL: 'missing' } }, 'ENVIRONMENTAL_PROPERTY_MISSING'],
      ['override on an interior wall', { ...base, overrides: [{ source: { collection: 'walls', id: m.walls.find(w => w.classification === 'interior')!.id }, construction: 'test-wall' }] }, 'ENVIRONMENTAL_MODEL_INVALID'],
      ['duplicate construction', { ...base, constructions: [...base.constructions, base.constructions[0]] }, 'ENVIRONMENTAL_MODEL_INVALID'],
      ['latitude 91', { ...base, location: { ...TEST_LOCATION, latitude: { value: 91, unit: 'deg' } } }, 'ENVIRONMENTAL_LOCATION_INVALID'],
      ['longitude −181', { ...base, location: { ...TEST_LOCATION, longitude: { value: -181, unit: 'deg' } } }, 'ENVIRONMENTAL_LOCATION_INVALID'],
      ['unknown time zone', { ...base, location: { ...TEST_LOCATION, timezone: 'Mars/Olympus' } }, 'ENVIRONMENTAL_LOCATION_INVALID'],
    ];
    for (const [name, input, code] of cases) expect(codeOf(() => buildEnvironmentalModel(bim, parse(input))), name).toBe(code);
    const wrongClass = structuredClone(bim); wrongClass.geometry.walls.find(w => w.classification === 'interior')!.classification = 'exterior';
    expect(codeOf(() => buildEnvironmentalModel(wrongClass, parse(base)))).toBe('ENVIRONMENTAL_SOURCE_UNSUPPORTED');
    const noHeight = structuredClone(bim); noHeight.geometry.levels[0]!.floorToFloorHeightMm = null;
    expect(codeOf(() => buildEnvironmentalModel(noHeight, parse(base)))).toBe('ENVIRONMENTAL_SOURCE_UNSUPPORTED');
    const before = JSON.stringify(bim); buildEnvironmentalModel(bim, parse(base)); expect(JSON.stringify(bim)).toBe(before);
  });
  it('leaves Phase 23 BIM and IFC output untouched', () => {
    const m = SETBACK(), bim = projectBim(m, binding(m)), ifc = exportIfc(bim);
    analyzed(m); expect(exportIfc(projectBim(m, binding(m)))).toBe(ifc);
  });
});

describe('Phase 25 direct-sun exposure', () => {
  // Hand-built surfaces: a 4 m wall facing −z with a 1 m deep, 2 m high fin projecting from its middle.
  const surface = (id: string, start: { x: number; z: number }, end: { x: number; z: number }, normal: [number, number, number]): EnvironmentalSurface => ({
    id: environmentalId(projectId, id), type: 'EXTERIOR_WALL', boundary: 'OUTDOOR', source: { collection: 'walls', id, bimElementId: `bim-${'0'.repeat(40)}` }, hostSurfaceId: null, levelId: 'l',
    zoneIds: [], geometry: { kind: 'VERTICAL_RECTANGLE', start, end, bottomMm: 0, topMm: 2000, storeyTopMm: 2000, faceOffsetMm: 0 }, grossArea: { value: 1, unit: 'm2' },
    netArea: { value: 1, unit: 'm2' }, normal, tilt: { value: 90, unit: 'deg' }, azimuth: null, classification: { architectural: 'exterior', status: 'CONSISTENT' },
    construction: { status: 'NOT_SPECIFIED', key: null, uValue: null, provenance: null } });
  const wall = surface('wall', { x: 0, z: 0 }, { x: 4000, z: 0 }, [0, 0, -1]), fin = surface('fin', { x: 2000, z: 0 }, { x: 2000, z: -1000 }, [1, 0, 0]);
  const model = { surfaces: [wall, fin] } as unknown as EnvironmentalModel, unit = (v: number[]) => { const n = Math.hypot(...v); return v.map(x => x / n) as [number, number, number]; };
  it('reproduces a fin shadow sample by sample from a closed-form test', () => {
    const sun = unit([-1, 0.4, -1]), points = samplePoints(wall);
    // Ray from (x, y, 0) reaches the fin plane x = 2000 after a horizontal run of (x − 2000) in x and the same in −z (|sx| = |sz|).
    const expected = points.filter(([x, y]) => !(x > 2000 && x - 2000 <= 1000 && y + (x - 2000) * (sun[1] / -sun[0]) <= 2000)).length;
    expect(points).toHaveLength(32); expect(expected).toBeLessThan(32); expect(expected).toBeGreaterThan(16);
    expect(sunlitSamples(wall, points, sun, occludersOf(model), null, Infinity)).toBe(expected);
  });
  it('does not shade itself, counts edge contact as shade and never hits a parallel occluder', () => {
    expect(sunlitSamples(wall, samplePoints(wall), unit([0, 0.5, -1]), occludersOf({ surfaces: [wall] } as unknown as EnvironmentalModel), null, Infinity)).toBe(32);
    // Sun along the fin plane: rays from the wall never meet the fin (parallel); only the wall's own plane is excluded.
    expect(sunlitSamples(wall, samplePoints(wall), unit([0, 0.3, -1]), occludersOf(model), null, Infinity)).toBe(32);
    // A ray passing exactly through the fin's outer vertical edge shades (inclusive bounds); the origin sits 1 mm off the face at z = −1.
    const p: [number, number, number] = [2500, 1000, 0], d = unit([-500, 0, -999]);
    expect(sunlitSamples(wall, [p], d, occludersOf(model), null, Infinity)).toBe(0);
  });
  it('shades the L inner corner and the setback lower roofs in the low western sun, and agrees with the independent caster', () => {
    for (const make of [L, SETBACK]) {
      const { results, snapshot } = analyzed(make(), parse(environmentalInput({ instants: ['16:30'] })));
      const rows = results.exposure.instants[0]!.surfaces, evaluated = rows.filter(s => s.state === 'EVALUATED');
      expect(evaluated.some(s => s.sunlitFraction < 1)).toBe(true); expect(check(snapshot).status).toBe('VALID');
      for (const s of rows.filter(x => x.state !== 'EVALUATED')) expect(s.sunlitSamples).toBe(0);
      const ground = snapshot.model.surfaces.filter(s => s.type === 'GROUND_FLOOR').map(s => s.id);
      for (const s of rows.filter(x => ground.includes(x.surfaceId))) expect(s.state).toBe('NOT_FACING');
    }
    const s = analyzed(SETBACK(), parse(environmentalInput({ instants: ['16:30'] }))), roofs = s.snapshot.model.surfaces.filter(x => x.type === 'ROOF' && x.levelId === 'level-0').map(x => x.id);
    expect(s.results.exposure.instants[0]!.surfaces.filter(x => roofs.includes(x.surfaceId)).some(x => x.sunlitFraction < 1)).toBe(true);
  });
  it('reports sun below the horizon at night and direct-beam irradiance only from supplied DNI', () => {
    const night = analyzed(L(), parse(environmentalInput({ instants: ['23:00'] }))).results.exposure.instants[0]!.surfaces;
    expect(night.every(s => s.state === 'SUN_BELOW_HORIZON' && s.sunlitFraction === 0 && s.directBeam.status === 'NOT_EVALUATED')).toBe(true);
    const noon = Date.parse('2026-03-20T06:30:00Z'), input = parse({ ...environmentalInput({ instants: ['12:00'] }), weather: syntheticWeather(noon - 6 * 3_600_000, 12, i => ({ dryBulb: 25, dni: i === 6 ? 800 : 0 })) });
    const { results, snapshot } = analyzed(L(), input), alt = results.solar.instants[0]!.altitude.value * Math.PI / 180;
    const roof = snapshot.model.surfaces.find(s => s.type === 'ROOF')!, row = results.exposure.instants[0]!.surfaces.find(s => s.surfaceId === roof.id)!;
    // Closed form for an unshaded horizontal roof: DNI × sin(altitude); power × net area.
    expect(row.sunlitFraction).toBe(1); expect(row.directBeam.status).toBe('EVALUATED');
    if (row.directBeam.status === 'EVALUATED') { expect(row.directBeam.incident.value).toBeCloseTo(800 * Math.sin(alt), 9); expect(row.directBeam.power.value).toBeCloseTo(800 * Math.sin(alt) * roof.netArea.value, 6); }
    expect(results.weather).toMatchObject({ used: true, synthetic: true }); expect(check(snapshot).status).toBe('VALID');
    const off = analyzed(L(), parse(environmentalInput({ instants: ['12:00'] }))).results.exposure.instants[0]!.surfaces;
    expect(off.every(s => s.directBeam.status === 'NOT_EVALUATED')).toBe(true);
  });
  it('reports solar and exposure as incomplete, not guessed, without location or orientation', () => {
    const noOrientation = analyzed(L(), parse({ ...environmentalInput(), orientation: null })).results;
    expect(noOrientation.solar.status).toBe('ANALYZED'); expect(noOrientation.exposure.status).toBe('INPUT_INCOMPLETE'); expect(noOrientation.solar.instants[0]!.sunDirection).toBeNull();
    const noLocation = analyzed(L(), parse({ ...environmentalInput(), location: null })).results;
    expect(noLocation.solar.status).toBe('INPUT_INCOMPLETE'); expect(noLocation.solar.instants).toEqual([]); expect(noLocation.exposure.status).toBe('INPUT_INCOMPLETE');
    const none = analyzed(L(), parse({ ...environmentalInput(), solarInstants: [] })).results;
    expect(none.solar.status).toBe('NOT_EVALUATED'); expect(none.exposure.status).toBe('NOT_EVALUATED');
  });
});

describe('Phase 25 steady-state heat flow and energy (closed forms)', () => {
  const hand = (m: BuildingModelV2, input: EnvironmentalInput) => {
    // Independent of the builder: areas from source walls, openings and plates; U by type; ΔT from the case.
    const c = input.thermalCases[0]!, dOut = c.inside.value - (c.outside.kind === 'CONSTANT' ? c.outside.temperature.value : NaN), dG = c.inside.value - (c.ground?.value ?? NaN);
    const U = (k: string | undefined) => input.constructions.find(x => x.key === k)!.uValue.value, a = input.assignments;
    const exterior = m.walls.filter(w => w.classification === 'exterior'), floorLevel = Math.min(...m.levels.map(l => l.elevationMm));
    let q = 0;
    for (const w of exterior) { const len = Math.hypot(w.path.end.x - w.path.start.x, w.path.end.z - w.path.start.z), holes = m.openings.filter(o => o.wallId === w.id);
      q += U(a.EXTERIOR_WALL) * (len * w.heightMm! - holes.reduce((s, o) => s + o.widthMm * o.heightMm, 0)) / 1e6 * dOut;
      for (const o of holes) q += U(o.kind === 'window' ? a.WINDOW : a.DOOR) * o.widthMm * o.heightMm / 1e6 * dOut; }
    for (const s of m.slabs) { const area = shoelaceM2(s.footprint.outer) - s.footprint.voids.reduce((x, v) => x + shoelaceM2(v), 0);
      if (s.kind === 'flat-roof') q += U(a.ROOF) * area * dOut;
      if (s.kind === 'floor' && m.levels.find(l => l.id === s.levelId)!.elevationMm === floorLevel) q += U(a.GROUND_FLOOR) * area * dG; }
    return q;
  };
  it.each([['L', L], ['setback', SETBACK], ['maximum-24', () => generateParametricBlueprint(maximum).model]] as const)('%s: total Q = Σ U·A·ΔT from the source geometry', (_n, make) => {
    const m = make(), input = parse(environmentalInput()), c = analyzed(m, input).results.thermal.cases[0]!;
    expect(c.status).toBe('ANALYZED'); expect(c.total.value).toBeCloseTo(hand(m, input), 6); expect(c.totalKw.value).toBeCloseTo(c.total.value / 1000, 12);
    expect(c.deltaT).toEqual({ outdoor: { value: 20, unit: 'K' }, ground: { value: 11, unit: 'K' } });
  });
  it('is zero at zero ΔT, reverses sign when outside is warmer, and scales with U independently per type', () => {
    const m = L(), q = (o: Parameters<typeof environmentalInput>[0]) => analyzed(m, parse(environmentalInput(o))).results.thermal.cases[0]!;
    const zero = q({ insideC: 20, outsideC: 20, groundC: 20 });
    expect(zero.total.value).toBe(0); expect(zero.surfaces.every(s => s.heatFlow?.value === 0)).toBe(true);
    const winter = q({ insideC: 21, outsideC: 1, groundC: 21 }), summer = q({ insideC: 21, outsideC: 41, groundC: 21 });
    expect(summer.total.value).toBeCloseTo(-winter.total.value, 9);
    const doubled = parse(environmentalInput()); doubled.constructions.find(c => c.key === 'test-glazing')!.uValue.value *= 2;
    const a = q({}), b = analyzed(m, doubled).results.thermal.cases[0]!;
    expect(b.byType.WINDOW.value).toBeCloseTo(2 * a.byType.WINDOW.value, 9); expect(b.byType.EXTERIOR_WALL.value).toBeCloseTo(a.byType.EXTERIOR_WALL.value, 12);
  });
  it('integrates power over time: E = P·Δt for constant cases, Σ P_i·Δt for weather series; no duration means no energy', () => {
    const m = L(), base = analyzed(m, parse(environmentalInput({ hours: 24 }))).results.thermal.cases[0]!;
    expect(base.energy!.method).toBe('CONSTANT_POWER_TIMES_DURATION'); expect(base.energy!.energy.value).toBeCloseTo(base.total.value * 24, 6);
    expect(base.energy!.energyKwh.value).toBeCloseTo(base.total.value * 24 / 1000, 9); expect(base.energy!.peakPower.value).toBe(base.total.value);
    expect(analyzed(m, parse(environmentalInput({ hours: null }))).results.thermal.cases[0]!.energy).toBeNull();
    // Linear 48 h series 0 … 47 °C, ground constant: ΣP = UA·Σ(Tin − T_i)·1 h + Q_ground·48 h.
    const series = parse({ ...environmentalInput({ instants: [] }), thermalCases: [{ key: 'series', inside: { value: 21, unit: 'degC' }, outside: { kind: 'WEATHER' }, ground: { value: 10, unit: 'degC' } }],
      weather: syntheticWeather(Date.parse('2026-01-01T00:00:00Z'), 48, i => ({ dryBulb: i, dni: null })) });
    const { results, snapshot } = analyzed(m, series), c = results.thermal.cases[0]!;
    const ground = c.surfaces.filter(s => snapshot.model.surfaces.find(x => x.id === s.surfaceId)!.boundary === 'GROUND').reduce((a, s) => a + s.heatFlow!.value, 0);
    const ua = snapshot.model.surfaces.filter(s => s.boundary === 'OUTDOOR' && s.type !== 'OPENING').reduce((a, s) => a + s.construction.uValue!.value * s.netArea.value, 0);
    const sumDelta = Array.from({ length: 48 }, (_, i) => 21 - i).reduce((a, x) => a + x, 0);
    expect(c.energy!.method).toBe('SAMPLED_SERIES_LEFT_RECTANGLE'); expect(c.energy!.samples).toBe(48); expect(c.energy!.duration.value).toBe(48);
    expect(c.energy!.energy.value).toBeCloseTo(ua * sumDelta + ground * 48, 6); expect(c.energy!.peakPower.value).toBeCloseTo(ua * 21 + ground, 6);
    expect(check(snapshot).status).toBe('VALID');
  });
  it('marks incomplete inputs instead of inventing them', () => {
    const m = L();
    const noGround = analyzed(m, parse(environmentalInput({ groundC: null }))).results.thermal.cases[0]!;
    expect(noGround.status).toBe('PARTIAL'); expect(noGround.energy).toBeNull(); expect(noGround.surfaces.find(s => s.status === 'NOT_EVALUATED')).toBeDefined();
    const missing = parse({ ...environmentalInput({ instants: [] }), thermalCases: [{ key: 'w', inside: { value: 21, unit: 'degC' }, outside: { kind: 'WEATHER' }, ground: { value: 10, unit: 'degC' } }],
      weather: syntheticWeather(Date.parse('2026-01-01T00:00:00Z'), 24, i => ({ dryBulb: i === 5 ? null : 5, dni: null })) });
    const w = analyzed(m, missing).results.thermal;
    expect(w.status).toBe('INPUT_INCOMPLETE'); expect(w.cases[0]!.surfaces.every(s => s.heatFlow === null)).toBe(true);
    const noWeather = parse({ ...environmentalInput({ instants: [] }), thermalCases: [{ key: 'w', inside: { value: 21, unit: 'degC' }, outside: { kind: 'WEATHER' } }] });
    expect(analyzed(m, noWeather).results.thermal.cases[0]!.reason).toBe('No weather dataset supplied');
  });
  it('reports a geometric window-to-floor ratio, never daylight or illuminance', () => {
    const m = L(), { results, snapshot } = analyzed(m);
    for (const z of results.daylightIndicator.zones) { const zone = snapshot.model.zones.find(x => x.id === z.zoneId)!, space = m.spaces.find(s => s.id === zone.source.id)!;
      const win = m.openings.filter(o => o.kind === 'window' && snapshot.model.surfaces.some(s => s.source.id === o.id && s.zoneIds[0] === z.zoneId)).reduce((a, o) => a + o.widthMm * o.heightMm / 1e6, 0);
      expect(z.windowArea.value).toBeCloseTo(win, 12); expect(z.ratio.value).toBeCloseTo(win / shoelaceM2(space.boundary), 12); }
    expect(results.daylightIndicator.isDaylightMetric).toBe(false); expect(JSON.stringify(results)).not.toMatch(/lux|illuminance"/i);
  });
});

describe('Phase 25 weather trust boundary', () => {
  const m = L(), start = Date.parse('2026-01-01T00:00:00Z'), w = () => syntheticWeather(start, 24, i => ({ dryBulb: 10 + i / 10, dni: i > 6 && i < 18 ? 500 : 0 }));
  const prepare = (weather: unknown, location: unknown = TEST_LOCATION) => () => { const input = parse({ ...environmentalInput(), location, weather });
    resolveAnalysisInput(buildEnvironmentalModel(projectBim(m, binding(m)), input), input); };
  const resum = (x: ReturnType<typeof w>) => ({ ...x, sha256: digest(x.samples) });
  it.each([
    ['checksum mismatch', () => { const x = w(); x.samples[3]!.dryBulb = 99; return x; }],
    ['duplicate timestamp', () => { const x = w(); x.samples[4]!.timestamp = x.samples[3]!.timestamp; return resum(x); }],
    ['out of order', () => { const x = w(); [x.samples[2], x.samples[3]] = [x.samples[3]!, x.samples[2]!]; return resum(x); }],
    ['gap (no interpolation)', () => { const x = w(); x.samples.splice(5, 1); return resum(x); }],
    ['timestamp without offset', () => { const x = w(); x.samples[0]!.timestamp = x.samples[0]!.timestamp.slice(0, 19); return resum(x); }],
    ['dry bulb out of range', () => { const x = w(); x.samples[1]!.dryBulb = 120; return resum(x); }],
    ['negative DNI', () => { const x = w(); x.samples[9]!.directNormalIrradiance = -1; return resum(x); }],
    ['station elsewhere', () => { const x = w(); x.provenance.station.latitude = 51.5; return x; }],
  ])('rejects %s', (_n, make) => { expect(codeOf(prepare(make()))).toBe('ENVIRONMENTAL_WEATHER_INVALID'); });
  it('requires a location to match a dataset and accepts the clean synthetic set', () => {
    expect(codeOf(prepare(w(), null))).toBe('ENVIRONMENTAL_WEATHER_INVALID'); expect(codeOf(prepare(w()))).toBe('none');
    // Across the antimeridian: station at 179.9° E matches a site at 179.9° W (0.2° apart), 2° apart does not.
    const fiji = { ...TEST_LOCATION, latitude: { value: -17, unit: 'deg' }, longitude: { value: -179.9, unit: 'deg' }, timezone: 'Pacific/Fiji' };
    const station = (lon: number) => { const x = w(); x.provenance.station = { name: 'Dateline', latitude: -17, longitude: lon }; return x; };
    expect(codeOf(prepare(station(179.9), fiji))).toBe('none'); expect(codeOf(prepare(station(178), fiji))).toBe('ENVIRONMENTAL_WEATHER_INVALID');
  });
});

describe('Phase 25 independent validators reject adversarial output', () => {
  const m = SETBACK(), base = analyzed(m, parse({ ...environmentalInput({ instants: ['09:00', '16:30'] }) }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelMutations: [string, (x: any) => void][] = [
    ['reversed wall normal', x => { const s = x.surfaces.find((s: EnvironmentalSurface) => s.type === 'EXTERIOR_WALL'); s.normal = s.normal.map((v: number) => -v || 0); }],
    ['reversed roof normal', x => { x.surfaces.find((s: EnvironmentalSurface) => s.type === 'ROOF').normal = [0, -1, 0]; }],
    ['duplicate exterior surface', x => { x.surfaces.push(structuredClone(x.surfaces[0])); }],
    ['omitted window', x => { x.surfaces = x.surfaces.filter((s: EnvironmentalSurface) => s.type !== 'WINDOW' || s !== x.surfaces.find((y: EnvironmentalSurface) => y.type === 'WINDOW')); }],
    ['missing zone', x => { x.zones.pop(); }], ['orphan aperture', x => { x.surfaces.find((s: EnvironmentalSurface) => s.type === 'WINDOW').hostSurfaceId = null; }],
    ['wrong host', x => { const walls = x.surfaces.filter((s: EnvironmentalSurface) => s.type === 'EXTERIOR_WALL'); const w = x.surfaces.find((s: EnvironmentalSurface) => s.type === 'WINDOW'); w.hostSurfaceId = walls.find((s: EnvironmentalSurface) => s.id !== w.hostSurfaceId).id; }],
    ['negative area', x => { x.surfaces[0].netArea.value = -1; }], ['NaN area', x => { x.surfaces[0].grossArea.value = Number.NaN; }],
    ['mm² reported as m²', x => { const s = x.surfaces.find((s: EnvironmentalSurface) => s.type === 'EXTERIOR_WALL'); s.grossArea.value *= 1e6; s.netArea.value *= 1e6; }],
    ['window not deducted', x => { const w = x.surfaces.find((s: EnvironmentalSurface) => s.type === 'WINDOW'); const h = x.surfaces.find((s: EnvironmentalSurface) => s.id === w.hostSurfaceId); h.netArea.value = h.grossArea.value; }],
    ['invented U-value', x => { x.surfaces[0].construction = { status: 'SPECIFIED', key: 'invented', uValue: { value: 0.1, unit: 'W/(m2*K)' }, provenance: { kind: 'USER_PROVIDED', reference: null, version: null } }; }],
    ['U-value altered', x => { x.surfaces.find((s: EnvironmentalSurface) => s.construction.status === 'SPECIFIED').construction.uValue.value = 0.01; }],
    ['wrong U dimension', x => { x.surfaces[0].construction.uValue.unit = 'W/(m*K)'; }],
    ['flipped north', x => { x.orientation.north = x.orientation.north.map((v: number) => -v || 0); }],
    ['azimuth altered', x => { x.surfaces.find((s: EnvironmentalSurface) => s.azimuth).azimuth.value += 90; }],
    ['wrong revision', x => { x.binding.revisionId = '44444444-4444-4444-8444-444444444444'; }], ['wrong model hash', x => { x.binding.modelHash = '0'.repeat(64); }],
    ['envelope closure forged', x => { x.envelope = { status: 'INCOMPLETE', uncoveredZoneIds: [x.zones[0].id] }; }],
    ['location altered', x => { x.location.latitude.value = 13; }],
  ];
  it.each(modelMutations)('model validator rejects %s', (_n, mutate) => { const x = structuredClone(base.model); mutate(x); expect(validateEnvironmentalModel(x, m, base.snapshot.input, base.model.binding).status).toBe('INVALID'); });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultMutations: [string, (s: any) => void][] = [
    ['altitude shifted 0.5°', s => { s.results.solar.instants[0].altitude.value += 0.5; }], ['azimuth mirrored (east/west)', s => { s.results.solar.instants[0].azimuth.value = 360 - s.results.solar.instants[0].azimuth.value; }],
    ['sun direction flipped north/south', s => { s.results.solar.instants[0].sunDirection[2] *= -1; }], ['UTC shifted one hour', s => { s.results.solar.instants[0].utc = new Date(Date.parse(s.results.solar.instants[0].utc) + 3_600_000).toISOString(); }],
    ['shaded surface reported lit', s => { const r = s.results.exposure.instants[1].surfaces.find((x: { sunlitFraction: number; state: string }) => x.state === 'EVALUATED' && x.sunlitFraction === 0); r.sunlitSamples = r.samples; r.sunlitFraction = 1; }],
    ['back-facing surface reported lit', s => { const r = s.results.exposure.instants[0].surfaces.find((x: { state: string }) => x.state === 'NOT_FACING'); r.state = 'EVALUATED'; r.sunlitSamples = r.samples; r.sunlitFraction = 1; }],
    ['fraction above one', s => { s.results.exposure.instants[0].surfaces[0].sunlitFraction = 1.5; }],
    ['heat flow ×2', s => { const r = s.results.thermal.cases[0].surfaces.find((x: { heatFlow: unknown }) => x.heatFlow); r.heatFlow.value *= 2; }],
    ['Celsius/Kelvin offset in ΔT', s => { s.results.thermal.cases[0].deltaT.outdoor.value += 273.15; }],
    ['total not the sum', s => { s.results.thermal.cases[0].total.value += 1; }], ['kW confused with W', s => { s.results.thermal.cases[0].totalKw.value = s.results.thermal.cases[0].total.value; }],
    ['energy without hours (power reported as energy)', s => { const e = s.results.thermal.cases[0].energy; e.energy.value = s.results.thermal.cases[0].total.value; }],
    ['energy ×1000 (Wh as kWh)', s => { s.results.thermal.cases[0].energy.energyKwh.value *= 1000; }],
    ['status upgraded', s => { s.results.thermal.cases[0].status = 'PARTIAL'; }], ['window ratio altered', s => { s.results.daylightIndicator.zones[0].ratio.value += 0.1; }],
    ['NaN result', s => { s.results.thermal.cases[0].total.value = Number.NaN; }], ['Infinity result', s => { s.results.thermal.cases[0].total.value = Infinity; }],
    ['unknown calculator', s => { s.calculator = { ...s.calculator, version: '9.9.9' }; }], ['wrong input hash', s => { s.inputHash = '0'.repeat(64); }],
    ['wrong binding', s => { s.binding = { ...s.binding, revisionId: '44444444-4444-4444-8444-444444444444' }; }],
    ['weather claimed', s => { s.results.weather = { used: true, synthetic: false, datasetId: 'measured', sha256: '0'.repeat(64) }; }],
  ];
  it.each(resultMutations)('result validator rejects %s', (_n, mutate) => { const s = structuredClone(base.snapshot); mutate(s); expect(check(s).status).toBe('INVALID'); });
  it('rejects a self-consistent sun from the wrong clock (one hour off) through the independent PSA comparison alone', () => {
    // No orientation: no sun vector or exposure to cross-check, so only the independent algorithm can notice.
    const a = analyzed(m, parse({ ...environmentalInput({ instants: ['09:00', '16:30'] }), orientation: null })), s = structuredClone(a.snapshot);
    for (const i of s.results.solar.instants) { const p = solarPosition(Date.parse(i.utc) + 3_600_000, TEST_LOCATION.latitude.value, TEST_LOCATION.longitude.value);
      i.altitude.value = p.altitude; i.azimuth.value = p.azimuth; i.aboveHorizon = p.altitude > 0; }
    expect(check(a.snapshot).status).toBe('VALID');
    const v = check(s); expect(v.status).toBe('INVALID'); expect(v.diagnostics.every(d => d.code === 'SOLAR')).toBe(true);
  });
  it('rejects irradiance ×1000 and a fabricated calculator, and maps failures to typed errors', () => {
    const noon = Date.parse('2026-03-20T03:30:00Z'), input = parse({ ...environmentalInput({ instants: ['09:00'] }), weather: syntheticWeather(noon - 3_600_000, 3, () => ({ dryBulb: 25, dni: 700 })) });
    const a = analyzed(m, input), s = structuredClone(a.snapshot), r = s.results.exposure.instants[0]!.surfaces.find(x => x.directBeam.status === 'EVALUATED' && x.sunlitFraction > 0)!;
    if (r.directBeam.status === 'EVALUATED') r.directBeam.incident.value *= 1000;
    expect(check(a.snapshot).status).toBe('VALID'); expect(check(s).status).toBe('INVALID');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrap = (change: (raw: any) => void): EnvironmentalCalculatorAdapter => ({ ...REFERENCE_CALCULATOR, analyze: (ai, o) => { const raw = REFERENCE_CALCULATOR.analyze(ai, o) as any; change(raw); return raw; } });
    const ai = a.ai;
    for (const [name, change] of [['foreign hash', (x: { analysisInputHash: string }) => { x.analysisInputHash = '0'.repeat(64); }], ['dropped surface', (x: any) => { x.results.thermal.cases[0].surfaces.pop(); }], // eslint-disable-line @typescript-eslint/no-explicit-any
      ['NaN', (x: any) => { x.results.thermal.cases[0].total.value = Number.NaN; }], ['wrong unit', (x: any) => { x.results.thermal.cases[0].total.unit = 'kW'; }], // eslint-disable-line @typescript-eslint/no-explicit-any
      ['lit samples beyond samples', (x: any) => { const r = x.results.exposure.instants[0].surfaces[0]; r.sunlitSamples = r.samples + 1; }], // eslint-disable-line @typescript-eslint/no-explicit-any
      ['wrong identity', (x: { calculator: { version: string } }) => { x.calculator.version = '0.0.1'; }]] as const)
      expect(codeOf(() => runEnvironmentalAnalysis(ai, wrap(change as (raw: unknown) => void))), name).toBe('ENVIRONMENTAL_RESULT_INVALID');
    expect(codeOf(() => runEnvironmentalAnalysis(ai, { ...REFERENCE_CALCULATOR, analyze: () => { throw new Error('native crash'); } }))).toBe('ENVIRONMENTAL_ANALYSIS_FAILED');
    expect(codeOf(() => runEnvironmentalAnalysis(ai, REFERENCE_CALCULATOR, -1))).toBe('ENVIRONMENTAL_ANALYSIS_TIMEOUT');
    // A self-consistent forgery (every fraction set to 1) passes the raw boundary but not the independent caster.
    // At 16:30 the setback shades itself, so an "everything lit" forgery is false there.
    const forged = runEnvironmentalAnalysis(base.ai, wrap(x => { for (const i of x.results.exposure.instants) for (const r of i.surfaces) if (r.state === 'EVALUATED') { r.sunlitSamples = r.samples; r.sunlitFraction = 1; } }));
    expect(base.results.exposure.instants[1]!.surfaces.some(r => r.state === 'EVALUATED' && r.sunlitFraction < 1)).toBe(true);
    expect(check({ ...base.snapshot, results: forged.results }).status).toBe('INVALID');
  });
});

describe('Phase 25 identity, determinism and limits', () => {
  it('hashes canonical input deterministically and binds it to revision, input and calculator', () => {
    const m = L(), a = analyzed(m), b = analyzed(m);
    expect(b.snapshot.inputHash).toBe(a.snapshot.inputHash); expect(b.run.analysisInputHash).toBe(a.run.analysisInputHash); expect(b.results).toEqual(a.results);
    expect(analyzed(m, undefined, undefined, '55555555-5555-4555-8555-555555555555').snapshot.inputHash).not.toBe(a.snapshot.inputHash);
    expect(analyzed(m, parse(environmentalInput({ outsideC: 2 }))).snapshot.inputHash).not.toBe(a.snapshot.inputHash);
    expect(analyzed(m, parse(environmentalInput({ northMilliDegrees: 1 }))).snapshot.inputHash).not.toBe(a.snapshot.inputHash);
    expect(environmentalInputHash(a.model.binding, a.snapshot.input, { ...REFERENCE_CALCULATOR, metadata: { ...REFERENCE_CALCULATOR.metadata, version: '1.0.1' } })).not.toBe(a.snapshot.inputHash);
    expect(SnapshotSchema.shape.claims.parse(a.model.claims)).toEqual({ energyEfficiency: 'NOT_CLAIMED', sustainability: 'NOT_CLAIMED', greenCertification: 'NOT_CLAIMED',
      thermalComfort: 'NOT_CLAIMED', daylightCompliance: 'NOT_CLAIMED', codeCompliance: 'NOT_CLAIMED', certification: 'NOT_CLAIMED' });
    expect(JSON.stringify(a.snapshot)).not.toMatch(/ENERGY_EFFICIENT|COMPLIANT"|CERTIFIED"|SUSTAINABLE"/);
  });
  it('preflights exposure rows and the ray budget before any computation', () => {
    const m = generateParametricBlueprint(maximum).model, input = parse(environmentalInput({ instants: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`) }));
    const model = buildEnvironmentalModel(projectBim(m, binding(m)), input), big = (n: number) => { const wall = model.surfaces.find(s => s.type === 'EXTERIOR_WALL')!;
      return { ...model, surfaces: Array.from({ length: n }, (_, i) => ({ ...structuredClone(wall), id: environmentalId(projectId, 'clone', i),
        geometry: { kind: 'VERTICAL_RECTANGLE' as const, start: { x: 0, z: i * 10 }, end: { x: 8000, z: i * 10 }, bottomMm: 0, topMm: 8000, storeyTopMm: 8000, faceOffsetMm: 0 } })) }; };
    expect(codeOf(() => resolveAnalysisInput(big(600), input))).toBe('ENVIRONMENTAL_RESOURCE_LIMIT'); // 24 × 600 rows
    expect(codeOf(() => resolveAnalysisInput(big(400), input))).toBe('ENVIRONMENTAL_RESOURCE_LIMIT'); // 24 × 25 600 samples × 400 occluders
    expect(codeOf(() => resolveAnalysisInput(model, input))).toBe('none');
    // A plate with no samplable interior is refused up front instead of producing 0/0 fractions.
    const sliver = structuredClone(model), roof = sliver.surfaces.find(s => s.type === 'ROOF')!;
    if (roof.geometry.kind === 'HORIZONTAL_POLYGON') roof.geometry.voids = [roof.geometry.outer];
    expect(codeOf(() => resolveAnalysisInput(sliver, input))).toBe('ENVIRONMENTAL_SOURCE_UNSUPPORTED');
    expect(codeOf(() => parse({ ...environmentalInput(), solarInstants: Array.from({ length: 25 }, (_, i) => ({ key: `k${i}`, localDateTime: '2026-03-20T12:00' })) }))).toBe('other:ZodError');
  });
});
