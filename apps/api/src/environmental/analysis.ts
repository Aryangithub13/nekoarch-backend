import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { digest } from '../bim/core.js';
import { ENVIRONMENTAL_ADAPTER_VERSION, ENVIRONMENTAL_ANALYSIS_VERSION, ENVIRONMENTAL_LIMITS, ENVIRONMENTAL_MODEL_VERSION, EnvironmentalError, ResultsSchema, SHADING, SOLAR_ALGORITHM,
  SURFACE_TYPES, WEATHER_LOCATION_TOLERANCE_DEG, type EnvironmentalBinding, type EnvironmentalInput, type EnvironmentalModel, type EnvironmentalResults, type SurfaceType } from './contracts.js';
import { localToUtc, solarPosition, sunVector } from './solar.js';
import { occludersOf, samplePoints, sunlitSamples } from './shading.js';
import { energyWh, temperatureDifferenceK, whToKwh, wToKw } from './units.js';

const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/;

/** Weather is untrusted input: checksum, explicit-offset timestamps, strict uniform interval, physical ranges, station near the site. */
export function checkWeather(input: EnvironmentalInput) {
  const w = input.weather; if (!w) return null;
  const invalid = (m: string): never => { throw new EnvironmentalError('ENVIRONMENTAL_WEATHER_INVALID', m); };
  if (digest(w.samples) !== w.sha256) invalid('Weather checksum does not match its samples');
  if (!input.location) invalid('A weather dataset needs an explicit location to be matched against');
  const loc = input.location!;
  // Longitude difference is wrapped so stations either side of the antimeridian compare correctly.
  if (Math.abs(w.provenance.station.latitude - loc.latitude.value) > WEATHER_LOCATION_TOLERANCE_DEG
    || Math.abs(((w.provenance.station.longitude - loc.longitude.value) % 360 + 540) % 360 - 180) > WEATHER_LOCATION_TOLERANCE_DEG)
    invalid('The weather station is not at the analysed location');
  const step = w.intervalMinutes * 60_000;
  const times = w.samples.map(s => { if (!TIMESTAMP.test(s.timestamp)) invalid('Weather timestamps need ISO 8601 with an explicit offset'); const t = Date.parse(s.timestamp);
    if (!Number.isFinite(t)) invalid('Unparsable weather timestamp'); return t; });
  times.forEach((t, i) => { if (i && t - times[i - 1]! !== step) invalid(t <= times[i - 1]! ? 'Weather samples are duplicated or out of order' : 'Weather samples have gaps; nothing is interpolated'); });
  for (const s of w.samples) {
    if (s.dryBulb !== null && !(s.dryBulb >= -90 && s.dryBulb <= 70)) invalid('Dry-bulb temperature out of range');
    if (s.directNormalIrradiance !== null && !(s.directNormalIrradiance >= 0 && s.directNormalIrradiance <= 1500)) invalid('Direct normal irradiance out of range');
  }
  return { intervalHours: w.intervalMinutes / 60, synthetic: w.provenance.synthetic, datasetId: w.provenance.datasetId, sha256: w.sha256,
    samples: w.samples.map((s, i) => ({ utcMs: times[i]!, dryBulb: s.dryBulb, dni: s.directNormalIrradiance })) };
}

/** Solver-neutral analysis input: the validated model plus instants (UTC), thermal cases and weather, resolved once and hashed. */
export function resolveAnalysisInput(model: EnvironmentalModel, input: EnvironmentalInput) {
  const weather = checkWeather(input);
  const instants = input.location ? input.solarInstants.map(i => ({ key: i.key, localDateTime: i.localDateTime, timezone: input.location!.timezone,
    utcMs: localToUtc(i.localDateTime, input.location!.timezone) })) : [];
  if (instants.length * model.surfaces.length > ENVIRONMENTAL_LIMITS.exposureRows) throw new EnvironmentalError('ENVIRONMENTAL_RESOURCE_LIMIT', 'Too many instant × surface exposure rows');
  // Ray-test budget, predicted before any ray is cast.
  const occluders = model.surfaces.filter(s => s.type === 'EXTERIOR_WALL' || s.type === 'ROOF').length;
  const counts = model.surfaces.map(s => samplePoints(s).length), samples = counts.reduce((n, c) => n + c, 0);
  if (counts.includes(0)) throw new EnvironmentalError('ENVIRONMENTAL_SOURCE_UNSUPPORTED', 'A surface is too thin to sample for exposure');
  if (input.orientation && instants.length * samples * occluders > ENVIRONMENTAL_LIMITS.rayTests) throw new EnvironmentalError('ENVIRONMENTAL_RESOURCE_LIMIT', 'Shading would exceed the ray-test budget');
  if (!instants.length && !input.thermalCases.length && !model.zones.length)
    throw new EnvironmentalError('ENVIRONMENTAL_INPUT_INCOMPLETE', 'Nothing to analyse: no zones, solar instants or thermal cases');
  return { version: ENVIRONMENTAL_ANALYSIS_VERSION, model, requestedInstants: input.solarInstants.length, instants, thermalCases: input.thermalCases, weather,
    settings: { solarAlgorithm: SOLAR_ALGORITHM, ...SHADING, samplesPerAxis: ENVIRONMENTAL_LIMITS.samplesPerAxis } };
}
export type AnalysisInput = ReturnType<typeof resolveAnalysisInput>;

/** Solver-neutral boundary: public contracts never depend on a calculator's internals. */
export interface EnvironmentalCalculatorAdapter {
  metadata: { name: string; version: string; adapterVersion: typeof ENVIRONMENTAL_ADAPTER_VERSION; settings: Record<string, string | number> };
  /** Output is untrusted and validated before use. */
  analyze(input: AnalysisInput, options: { deadline: number }): unknown;
}

const zero = () => Object.fromEntries(SURFACE_TYPES.map(t => [t, 0])) as Record<SurfaceType, number>;
const W = (value: number) => ({ value, unit: 'W' as const });

function calculate(ai: AnalysisInput, { deadline }: { deadline: number }) {
  const m = ai.model, loc = m.location, frame = m.orientation, weather = ai.weather;
  const timeout = () => { throw new EnvironmentalError('ENVIRONMENTAL_ANALYSIS_TIMEOUT', 'Environmental analysis exceeded its time budget'); };
  // 1. Solar position.
  const solar = ai.instants.map(i => { const p = solarPosition(i.utcMs, loc!.latitude.value, loc!.longitude.value);
    return { key: i.key, localDateTime: i.localDateTime, timezone: i.timezone, utc: new Date(i.utcMs).toISOString(), altitude: { value: p.altitude, unit: 'deg' as const },
      azimuth: { value: p.azimuth, unit: 'deg' as const }, aboveHorizon: p.altitude > 0, sunDirection: frame ? sunVector(p.altitude, p.azimuth, frame) : null, utcMs: i.utcMs }; });
  // 2. Direct-sun exposure by ray casting; direct beam only where the dataset holds DNI at exactly that instant.
  const occluders = occludersOf(m), points = new Map(m.surfaces.map(s => [s.id, samplePoints(s)])), hostKey = new Map(m.surfaces.map(s => [s.id,
    s.hostSurfaceId ? (() => { const h = m.surfaces.find(x => x.id === s.hostSurfaceId)!; return `${h.source.collection}:${h.source.id}`; })() : null]));
  const exposure = frame ? solar.map(sp => ({ key: sp.key, surfaces: m.surfaces.map(s => {
    const sun = sp.sunDirection!, cos = Math.max(-1, Math.min(1, s.normal[0] * sun[0] + s.normal[1] * sun[1] + s.normal[2] * sun[2])), pts = points.get(s.id)!;
    const state = !sp.aboveHorizon ? 'SUN_BELOW_HORIZON' as const : cos <= SHADING.facingCos ? 'NOT_FACING' as const : 'EVALUATED' as const;
    const lit = state === 'EVALUATED' ? sunlitSamples(s, pts, sun, occluders, hostKey.get(s.id)!, deadline) ?? timeout() : 0;
    const fraction = lit / pts.length, sample = weather?.samples.find(x => x.utcMs === sp.utcMs);
    const directBeam = sample && sample.dni !== null
      ? { status: 'EVALUATED' as const, dni: { value: sample.dni, unit: 'W/m2' as const }, incident: { value: sample.dni * Math.max(cos, 0) * fraction, unit: 'W/m2' as const },
        power: W(sample.dni * Math.max(cos, 0) * fraction * s.netArea.value) }
      : { status: 'NOT_EVALUATED' as const, reason: weather ? 'No DNI sample at this instant' : 'No weather dataset supplied' };
    return { surfaceId: s.id, state, cosIncidence: cos, samples: pts.length, sunlitSamples: lit, sunlitFraction: fraction, directBeam };
  }) })) : [];
  // 3. Steady-state transmission Q = U·A·ΔT (positive = heat leaving), then energy only for complete cases.
  const cases = ai.thermalCases.map(c => {
    const series = c.outside.kind === 'WEATHER' ? weather?.samples.map(x => x.dryBulb) ?? null : null;
    if (c.outside.kind === 'WEATHER' && (!series || series.some(t => t === null)))
      return { key: c.key, status: 'INPUT_INCOMPLETE' as const, reason: weather ? 'The weather dataset has missing dry-bulb samples' : 'No weather dataset supplied',
        deltaT: { outdoor: null, ground: null }, surfaces: m.surfaces.map(s => ({ surfaceId: s.id, status: 'NOT_EVALUATED' as const, heatFlow: null })),
        byType: Object.fromEntries(SURFACE_TYPES.map(t => [t, W(0)])) as Record<SurfaceType, ReturnType<typeof W>>, total: W(0), totalKw: { value: 0, unit: 'kW' as const },
        evaluatedArea: { value: 0, unit: 'm2' as const }, unevaluatedSurfaceIds: m.surfaces.map(s => s.id), energy: null };
    const outside = c.outside.kind === 'CONSTANT' ? c.outside.temperature.value : series!.reduce((a: number, t) => a + t!, 0) / series!.length; // weather: period mean
    const dOut = temperatureDifferenceK(c.inside.value, outside), dGround = c.ground ? temperatureDifferenceK(c.inside.value, c.ground.value) : null;
    const rows = m.surfaces.map(s => {
      if (s.type === 'OPENING') return { surfaceId: s.id, status: 'UNSUPPORTED' as const, heatFlow: null };
      if (s.construction.status === 'NOT_SPECIFIED') return { surfaceId: s.id, status: 'NOT_SPECIFIED' as const, heatFlow: null };
      const dT = s.boundary === 'GROUND' ? dGround : dOut;
      return dT === null ? { surfaceId: s.id, status: 'NOT_EVALUATED' as const, heatFlow: null } : { surfaceId: s.id, status: 'EVALUATED' as const, heatFlow: W(s.construction.uValue.value * s.netArea.value * dT) };
    });
    const byType = zero(); let total = 0, area = 0, uaOutdoor = 0, ground = 0;
    rows.forEach((r, i) => { if (!r.heatFlow) return; const s = m.surfaces[i]!; byType[s.type] += r.heatFlow.value; total += r.heatFlow.value; area += s.netArea.value;
      if (s.boundary === 'GROUND') ground += r.heatFlow.value; else uaOutdoor += s.construction.uValue!.value * s.netArea.value; });
    const unevaluated = rows.filter(r => r.status !== 'EVALUATED').map(r => r.surfaceId), complete = !unevaluated.length && m.envelope.status === 'CLOSED';
    const energy = !complete ? null : c.outside.kind === 'CONSTANT'
      ? c.durationHours ? { method: 'CONSTANT_POWER_TIMES_DURATION' as const, duration: { value: c.durationHours.value, unit: 'h' as const }, energy: { value: energyWh(total, c.durationHours.value), unit: 'Wh' as const },
        energyKwh: { value: whToKwh(energyWh(total, c.durationHours.value)), unit: 'kWh' as const }, peakPower: W(total), samples: 1 } : null
      : (() => { const powers = series!.map(t => uaOutdoor * temperatureDifferenceK(c.inside.value, t!) + ground), wh = powers.reduce((a, p) => a + energyWh(p, weather!.intervalHours), 0);
        return { method: 'SAMPLED_SERIES_LEFT_RECTANGLE' as const, duration: { value: powers.length * weather!.intervalHours, unit: 'h' as const }, energy: { value: wh, unit: 'Wh' as const },
          energyKwh: { value: whToKwh(wh), unit: 'kWh' as const }, peakPower: W(Math.max(...powers)), samples: powers.length }; })();
    return { key: c.key, status: complete ? 'ANALYZED' as const : 'PARTIAL' as const,
      reason: complete ? (c.outside.kind === 'WEATHER' ? 'Surface heat flows use the period-mean outside temperature' : null)
        : unevaluated.length ? 'Some surfaces lack a construction, a ground temperature or U-value semantics; totals cover evaluated surfaces only' : 'The envelope is not closed; totals omit uncovered zones',
      deltaT: { outdoor: { value: dOut, unit: 'K' as const }, ground: dGround === null ? null : { value: dGround, unit: 'K' as const } }, surfaces: rows,
      byType: Object.fromEntries(SURFACE_TYPES.map(t => [t, W(byType[t])])) as Record<SurfaceType, ReturnType<typeof W>>, total: W(total), totalKw: { value: wToKw(total), unit: 'kW' as const },
      evaluatedArea: { value: area, unit: 'm2' as const }, unevaluatedSurfaceIds: unevaluated, energy };
  });
  // 4. Geometric indicator only: exterior-window area per zone floor area.
  const zones = m.zones.map(z => { const win = m.surfaces.filter(s => s.type === 'WINDOW' && s.zoneIds.includes(z.id)).reduce((a, s) => a + s.netArea.value, 0);
    return { zoneId: z.id, windowArea: { value: win, unit: 'm2' as const }, floorArea: { value: z.floorArea.value, unit: 'm2' as const }, ratio: { value: win / z.floorArea.value, unit: '1' as const } }; });
  const all = (xs: string[]) => xs.every(x => x === 'ANALYZED') ? 'ANALYZED' as const : xs.every(x => x === 'INPUT_INCOMPLETE') ? 'INPUT_INCOMPLETE' as const : 'PARTIAL' as const;
  const results: EnvironmentalResults = {
    // Requested but impossible ⇒ INPUT_INCOMPLETE; not requested ⇒ NOT_EVALUATED.
    solar: { status: !ai.requestedInstants ? 'NOT_EVALUATED' : !m.location ? 'INPUT_INCOMPLETE' : 'ANALYZED', reason: !ai.requestedInstants ? 'No solar instants requested' : !m.location ? 'No location supplied' : null,
      algorithm: SOLAR_ALGORITHM, instants: solar.map(({ utcMs: _u, ...s }) => s) },
    exposure: { status: !ai.requestedInstants ? 'NOT_EVALUATED' : !m.location || !frame ? 'INPUT_INCOMPLETE' : m.envelope.status === 'CLOSED' ? 'ANALYZED' : 'PARTIAL',
      reason: !ai.requestedInstants ? 'No solar instants requested' : !m.location || !frame ? 'Exposure needs both a location and an orientation'
        : m.envelope.status !== 'CLOSED' ? 'The envelope is not closed; missing occluders may overstate exposure' : null,
      method: 'RAY_CAST_SAMPLED_DIRECT_SUN', instants: exposure },
    thermal: { status: !cases.length ? 'NOT_EVALUATED' : all(cases.map(c => c.status)), reason: cases.length ? null : 'No thermal cases requested', method: 'STEADY_STATE_U_A_DELTA_T', cases },
    daylightIndicator: { status: zones.length ? 'ANALYZED' : 'NOT_EVALUATED', metric: 'WINDOW_TO_FLOOR_AREA_RATIO', isDaylightMetric: false, zones },
    weather: { used: weather !== null, synthetic: weather?.synthetic ?? null, datasetId: weather?.datasetId ?? null, sha256: weather?.sha256 ?? null },
  };
  return { calculator: { name: REFERENCE_CALCULATOR.metadata.name, version: REFERENCE_CALCULATOR.metadata.version }, analysisInputHash: digest(ai), results };
}

export const REFERENCE_CALCULATOR: EnvironmentalCalculatorAdapter = {
  metadata: { name: 'nekoarch-reference-environmental', version: '1.0.0', adapterVersion: ENVIRONMENTAL_ADAPTER_VERSION,
    settings: { solarAlgorithm: SOLAR_ALGORITHM, cellMm: SHADING.cellMm, originOffsetMm: SHADING.originOffsetMm, facingCos: SHADING.facingCos, samplesPerAxis: ENVIRONMENTAL_LIMITS.samplesPerAxis } },
  analyze: calculate,
};

const RawSchema = z.object({ calculator: z.object({ name: z.string().max(100), version: z.string().max(100) }).strict(), analysisInputHash: z.string().regex(/^[a-f0-9]{64}$/), results: ResultsSchema }).strict();
/** Calculator output is untrusted: identity, input hash, inventories, finiteness/units (schema) and fraction arithmetic. */
export function validateRawOutput(raw: unknown, ai: AnalysisInput, adapter: EnvironmentalCalculatorAdapter) {
  const invalid = (m: string): never => { throw new EnvironmentalError('ENVIRONMENTAL_RESULT_INVALID', m); };
  const parsed = RawSchema.safeParse(raw);
  if (!parsed.success) return invalid('Calculator output is malformed, nonfinite or uses unexpected units');
  const out = parsed.data, r = out.results, ids = ai.model.surfaces.map(s => s.id).join();
  if (out.calculator.name !== adapter.metadata.name || out.calculator.version !== adapter.metadata.version) invalid('Calculator identity mismatch');
  if (out.analysisInputHash !== digest(ai)) invalid('Calculator output belongs to a different analysis input');
  if (r.solar.instants.map(i => i.key).join() !== ai.instants.map(i => i.key).join()) invalid('Solar instants differ from the analysis input');
  if (r.exposure.instants.length && (r.exposure.instants.map(i => i.key).join() !== ai.instants.map(i => i.key).join() || r.exposure.instants.some(i => i.surfaces.map(s => s.surfaceId).join() !== ids)))
    invalid('Exposure inventory differs from the analysis input');
  if (r.exposure.instants.some(i => i.surfaces.some(s => s.sunlitSamples > s.samples || s.sunlitFraction !== s.sunlitSamples / s.samples))) invalid('Exposure fraction arithmetic is inconsistent');
  if (r.thermal.cases.map(c => c.key).join() !== ai.thermalCases.map(c => c.key).join() || r.thermal.cases.some(c => c.surfaces.map(s => s.surfaceId).join() !== ids)) invalid('Thermal inventory differs from the analysis input');
  if (r.daylightIndicator.zones.map(z => z.zoneId).join() !== ai.model.zones.map(z => z.id).join()) invalid('Zone inventory differs from the analysis input');
  return r;
}

export function environmentalInputHash(binding: EnvironmentalBinding, input: EnvironmentalInput, adapter: EnvironmentalCalculatorAdapter = REFERENCE_CALCULATOR) {
  return digest({ environmentalModelVersion: ENVIRONMENTAL_MODEL_VERSION, analysisVersion: ENVIRONMENTAL_ANALYSIS_VERSION, binding, input, calculator: adapter.metadata });
}

/** Analysis input → adapter → untrusted-output validation. */
export function runEnvironmentalAnalysis(ai: AnalysisInput, adapter: EnvironmentalCalculatorAdapter = REFERENCE_CALCULATOR, budgetMs: number = ENVIRONMENTAL_LIMITS.calculationMs) {
  const started = performance.now();
  let raw: unknown;
  try { raw = adapter.analyze(ai, { deadline: started + budgetMs }); }
  catch (error) { if (error instanceof EnvironmentalError) throw error; throw new EnvironmentalError('ENVIRONMENTAL_ANALYSIS_FAILED', 'The environmental calculator failed'); }
  const executionMs = performance.now() - started, results = validateRawOutput(raw, ai, adapter);
  const { name, version, adapterVersion, settings } = adapter.metadata;
  return { analysisInputHash: digest(ai), results, calculator: { name, version, adapterVersion, settings, executionMs } };
}
