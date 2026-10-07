import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { generateParametricBlueprint } from '@designflow/generator';
import { modelHash } from './apps/api/dist/lib/generation-identity.js';
import { digest } from './apps/api/dist/bim/core.js';
import { projectBim } from './apps/api/dist/bim/project.js';
import { EnvironmentalInputSchema } from './apps/api/dist/environmental/contracts.js';
import { buildEnvironmentalModel } from './apps/api/dist/environmental/model.js';
import { environmentalInputHash, resolveAnalysisInput, runEnvironmentalAnalysis } from './apps/api/dist/environmental/analysis.js';
import { localToUtc, solarPosition } from './apps/api/dist/environmental/solar.js';
import { validateEnvironmentalModel, validateEnvironmentalResults } from './apps/api/dist/environmental/validate.js';

// Compiled production modules only: no test-support, network or database. Every value below is explicit acceptance input.
const requirements = { site: { boundary: [{ x: 0, z: 0 }, { x: 22000, z: 0 }, { x: 22000, z: 22000 }, { x: 0, z: 22000 }], northMilliDegrees: 0 }, floors: 2,
  rooms: [{ type: 'bedroom', count: 2, level: 1 }, { type: 'living', count: 1, level: 0 }, { type: 'kitchen', count: 1, level: 0 }], seed: 'phase25-production',
  parametricArchitecture: { version: 1, shape: 'L', origin: { x: 1000, z: 1000 }, floors: [{ level: 0, widthMm: 18000, depthMm: 18000, westWingWidthMm: 9000, southWingDepthMm: 8000 },
    { level: 1, widthMm: 16000, depthMm: 16000, westWingWidthMm: 8500, southWingDepthMm: 7000 }] } };
const { model } = generateParametricBlueprint(requirements);
const binding = { projectId: '11111111-1111-4111-8111-111111111111', revisionId: '22222222-2222-4222-8222-222222222222', modelHash: modelHash(model),
  parameterHash: digest(model.parametricArchitecture), generatorVersion: model.provenance.generatorVersion, generationId: null, requirementsHash: null };
const bim = projectBim(model, binding), user = { kind: 'USER_PROVIDED', reference: null, version: null };
const input = EnvironmentalInputSchema.parse({ version: 'environmental-input-v1',
  location: { latitude: { value: 12.97, unit: 'deg' }, longitude: { value: 77.59, unit: 'deg' }, timezone: 'Asia/Kolkata', provenance: 'USER_PROVIDED' },
  orientation: { northMilliDegrees: 30000, convention: 'NORTH_FROM_MINUS_Z_CLOCKWISE_TO_PLUS_X', provenance: 'USER_PROVIDED' },
  constructions: [{ key: 'w', name: 'Acceptance wall', uValue: { value: 0.5, unit: 'W/(m2*K)' }, provenance: user }, { key: 'g', name: 'Acceptance glazing', uValue: { value: 2.8, unit: 'W/(m2*K)' }, provenance: user }],
  assignments: { EXTERIOR_WALL: 'w', ROOF: 'w', GROUND_FLOOR: 'w', WINDOW: 'g', DOOR: 'g' },
  thermalCases: [{ key: 'c', inside: { value: 21, unit: 'degC' }, outside: { kind: 'CONSTANT', temperature: { value: 1, unit: 'degC' } }, ground: { value: 10, unit: 'degC' }, durationHours: { value: 24, unit: 'h' } }],
  solarInstants: [{ key: 'am', localDateTime: '2026-03-20T09:00' }, { key: 'pm', localDateTime: '2026-03-20T16:30' }] });
const environmental = buildEnvironmentalModel(bim, input);
assert.equal(validateEnvironmentalModel(environmental, bim.geometry, input, environmental.binding).status, 'VALID');
const run = runEnvironmentalAnalysis(resolveAnalysisInput(environmental, input));
const validation = validateEnvironmentalResults({ binding: environmental.binding, input, inputHash: environmentalInputHash(environmental.binding, input), model: environmental,
  results: run.results, calculator: run.calculator }, { binding: environmental.binding });
assert.equal(validation.status, 'VALID');
// Closed form: Q = Σ U·A·ΔT over the evaluated surfaces (ΔT 20 K outdoors, 11 K to ground); E = Q × 24 h.
const c = run.results.thermal.cases[0];
const expected = environmental.surfaces.filter(s => s.construction.status === 'SPECIFIED').reduce((q, s) => q + s.construction.uValue.value * s.netArea.value * (s.boundary === 'GROUND' ? 11 : 20), 0);
assert.ok(Math.abs(c.total.value - expected) <= 1e-9 * expected); assert.ok(Math.abs(c.energy.energy.value - expected * 24) <= 1e-9 * expected * 24);
// Published reference (NREL SPA) and DST handling need the runtime's ICU time-zone data, offline.
const spa = solarPosition(localToUtc('2003-10-17T12:30:30', 'Etc/GMT+7'), 39.742476, -105.1786);
assert.ok(Math.abs(90 - spa.altitude - 50.126) < 0.02 && Math.abs(spa.azimuth - 194.34024) < 0.02);
assert.equal(new Date(localToUtc('2026-07-01T12:00', 'America/New_York')).toISOString(), '2026-07-01T16:00:00.000Z');
assert.throws(() => localToUtc('2026-03-08T02:30', 'America/New_York'));
console.log(JSON.stringify({ compiledEnvironmental: 'PASS', zones: environmental.zones.length, surfaces: environmental.surfaces.length, thermalW: c.total.value, energyKwh: c.energy.energyKwh.value,
  shadedSurfacesAt1630: run.results.exposure.instants[1].surfaces.filter(s => s.state === 'EVALUATED' && s.sunlitFraction < 1).length, solarMaxDeviationDeg: validation.solarMaxDeviation.value,
  claims: environmental.claims, runtime: process.version }));
