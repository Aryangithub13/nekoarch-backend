import { digest } from '../apps/api/src/bim/core.js';
import type { EnvironmentalInput, Weather } from '../apps/api/src/environmental/contracts.js';

/** Test-only values, explicitly user-provided in every request; never product defaults or library data. */
export const TEST_LOCATION = { latitude: { value: 12.97, unit: 'deg' as const }, longitude: { value: 77.59, unit: 'deg' as const }, timezone: 'Asia/Kolkata', provenance: 'USER_PROVIDED' as const };
const user = { kind: 'USER_PROVIDED' as const, reference: null, version: null };
export const TEST_CONSTRUCTIONS = [
  { key: 'test-wall', name: 'Fixture opaque wall (test value)', uValue: { value: 0.5, unit: 'W/(m2*K)' as const }, provenance: user },
  { key: 'test-roof', name: 'Fixture roof (test value)', uValue: { value: 0.3, unit: 'W/(m2*K)' as const }, provenance: user },
  { key: 'test-floor', name: 'Fixture ground floor (test value)', uValue: { value: 0.4, unit: 'W/(m2*K)' as const }, provenance: user },
  { key: 'test-glazing', name: 'Fixture glazing (test value)', uValue: { value: 2.8, unit: 'W/(m2*K)' as const }, provenance: user },
  { key: 'test-door', name: 'Fixture door (test value)', uValue: { value: 1.8, unit: 'W/(m2*K)' as const }, provenance: user },
];

export function environmentalInput(options: { northMilliDegrees?: number; instants?: string[]; date?: string; insideC?: number; outsideC?: number; groundC?: number | null; hours?: number | null } = {}): EnvironmentalInput {
  return { version: 'environmental-input-v1', location: structuredClone(TEST_LOCATION),
    orientation: { northMilliDegrees: options.northMilliDegrees ?? 0, convention: 'NORTH_FROM_MINUS_Z_CLOCKWISE_TO_PLUS_X', provenance: 'USER_PROVIDED' },
    constructions: structuredClone(TEST_CONSTRUCTIONS),
    assignments: { EXTERIOR_WALL: 'test-wall', ROOF: 'test-roof', GROUND_FLOOR: 'test-floor', WINDOW: 'test-glazing', DOOR: 'test-door' }, overrides: [],
    thermalCases: [{ key: 'design-winter', inside: { value: options.insideC ?? 21, unit: 'degC' }, outside: { kind: 'CONSTANT', temperature: { value: options.outsideC ?? 1, unit: 'degC' } },
      ground: options.groundC === null ? null : { value: options.groundC ?? 10, unit: 'degC' }, durationHours: options.hours === null ? null : { value: options.hours ?? 24, unit: 'h' } }],
    solarInstants: (options.instants ?? ['08:00', '12:00', '16:00']).map((t, i) => ({ key: `t${i}`, localDateTime: `${options.date ?? '2026-03-20'}T${t}` })),
    weather: null };
}

/** Synthetic hourly weather, labelled synthetic, with a real checksum. `values(i)` gives dry-bulb °C and DNI W/m² for hour i. */
export function syntheticWeather(startUtcMs: number, hours: number, values: (i: number) => { dryBulb: number | null; dni: number | null }, offset = '+05:30'): Weather {
  const shift = (offset[0] === '-' ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6))) * 60_000;
  const samples = Array.from({ length: hours }, (_, i) => { const local = new Date(startUtcMs + i * 3_600_000 + shift).toISOString().slice(0, 19), v = values(i);
    return { timestamp: `${local}${offset}`, dryBulb: v.dryBulb, directNormalIrradiance: v.dni }; });
  return { version: 'environmental-weather-v1', provenance: { source: 'NekoArch test generator', datasetId: 'synthetic-test-series', datasetVersion: '1', synthetic: true, license: null,
    station: { name: 'Synthetic station at the test location', latitude: TEST_LOCATION.latitude.value, longitude: TEST_LOCATION.longitude.value } },
    timezone: 'Asia/Kolkata', intervalMinutes: 60, units: { dryBulb: 'degC', directNormalIrradiance: 'W/m2' }, samples, sha256: digest(samples) };
}
