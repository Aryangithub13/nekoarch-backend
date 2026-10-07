import { z } from 'zod';
import { EntityIdSchema, LabelSchema } from '@designflow/shared';
import { BIM_VERSION, BimBindingSchema } from '../bim/contracts.js';

export const ENVIRONMENTAL_INPUT_VERSION = 'environmental-input-v1';
export const ENVIRONMENTAL_MODEL_VERSION = 'environmental-model-v1';
export const ENVIRONMENTAL_ANALYSIS_VERSION = 'environmental-analysis-v1';
export const ENVIRONMENTAL_ADAPTER_VERSION = 'environmental-adapter-v1';
export const ENVIRONMENTAL_WEATHER_VERSION = 'environmental-weather-v1';
export const MODEL_VALIDATOR = 'environmental-model-validator-v1', RESULT_VALIDATOR = 'environmental-result-validator-v1';
export const SOLAR_ALGORITHM = 'NOAA_MEEUS_GEOMETRIC_V1';
export const NORTH_CONVENTION = 'NORTH_FROM_MINUS_Z_CLOCKWISE_TO_PLUS_X';
/** Sized for the 2-storey / 24-room scope with headroom; see docs/phase25/phase25-design.md §14. */
export const ENVIRONMENTAL_LIMITS = { inputBytes: 2_097_152, zones: 200, surfaces: 1500, constructions: 32, overrides: 500, thermalCases: 8, solarInstants: 24,
  weatherSamples: 8760, samplesPerAxis: 8, rayTests: 20_000_000, exposureRows: 12_000, calculationMs: 10_000, outputBytes: 9_000_000 } as const;
/** Ray-sample cell, ray origin offset, minimum hit distance (mm) and the grazing threshold (cosine). */
export const SHADING = { cellMm: 500, originOffsetMm: 1, minHitMm: 1e-6, facingCos: 1e-6 } as const;
export const WEATHER_LOCATION_TOLERANCE_DEG = 1;
export const CLAIMS = { energyEfficiency: 'NOT_CLAIMED', sustainability: 'NOT_CLAIMED', greenCertification: 'NOT_CLAIMED', thermalComfort: 'NOT_CLAIMED',
  daylightCompliance: 'NOT_CLAIMED', codeCompliance: 'NOT_CLAIMED', certification: 'NOT_CLAIMED' } as const;
export const ASSUMPTIONS = ['CENTERLINE_ZERO_THICKNESS_SURFACES', 'LOWEST_FLOOR_PLATE_ON_GROUND', 'INTERIOR_BOUNDARIES_AT_EQUAL_SETPOINT', 'STEADY_STATE_TRANSMISSION_ONLY',
  'NO_THERMAL_BRIDGES', 'NO_INFILTRATION_OR_VENTILATION', 'DIRECT_BEAM_ONLY_NO_DIFFUSE', 'GEOMETRIC_SOLAR_POSITION_NO_REFRACTION', 'SLAB_EDGE_STRIPS_NOT_MODELLED'] as const;
export const LIMITATIONS = [
  'Steady-state envelope transmission (Q = U·A·ΔT) only: no thermal mass, infiltration, ventilation, internal or solar gains, HVAC, or annual dynamic simulation.',
  'Direct-sun exposure is ray-cast against this building only (no terrain or neighbours); irradiance is direct beam from supplied DNI only, never diffuse or reflected.',
  'The window-to-floor ratio is a geometric indicator, not a daylight, illuminance or compliance metric.',
  'Every thermal property, temperature, location, orientation and weather value is explicit input with stated provenance; none is inferred from names or materials.',
  'Preliminary analysis information only; not an energy rating, sustainability or code-compliance assessment, and not certified.',
] as const;

export type EnvironmentalErrorCode = 'ENVIRONMENTAL_SOURCE_UNSUPPORTED' | 'ENVIRONMENTAL_INPUT_INCOMPLETE' | 'ENVIRONMENTAL_MODEL_INVALID' | 'ENVIRONMENTAL_LOCATION_INVALID'
  | 'ENVIRONMENTAL_WEATHER_INVALID' | 'ENVIRONMENTAL_PROPERTY_MISSING' | 'ENVIRONMENTAL_ANALYSIS_FAILED' | 'ENVIRONMENTAL_ANALYSIS_TIMEOUT' | 'ENVIRONMENTAL_RESULT_INVALID'
  | 'ENVIRONMENTAL_RESULT_STALE' | 'ENVIRONMENTAL_RESOURCE_LIMIT';
export class EnvironmentalError extends Error {
  constructor(readonly code: EnvironmentalErrorCode, message: string) { super(message); this.name = 'EnvironmentalError'; }
}

const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const eid = z.string().regex(/^env-[a-f0-9]{40}$/);
const bimId = z.string().regex(/^bim-[a-f0-9]{40}$/);
const finite = () => z.number().finite();
const q = <U extends string, S extends z.ZodTypeAny = z.ZodNumber>(unit: U, schema?: S) => z.object({ value: (schema ?? finite()) as S, unit: z.literal(unit) }).strict();
/** Absolute temperature: degrees Celsius only. Kelvin or Fahrenheit inputs are rejected, never converted implicitly. */
const celsius = () => q('degC', finite().min(-90).max(70));
export const SURFACE_TYPES = ['EXTERIOR_WALL', 'WINDOW', 'DOOR', 'OPENING', 'ROOF', 'GROUND_FLOOR'] as const;
export type SurfaceType = typeof SURFACE_TYPES[number];
const surfaceType = z.enum(SURFACE_TYPES);

// ---------------------------------------------------------------- explicit environmental input
export const WeatherSchema = z.object({ version: z.literal(ENVIRONMENTAL_WEATHER_VERSION),
  provenance: z.object({ source: LabelSchema, datasetId: LabelSchema, datasetVersion: LabelSchema, synthetic: z.boolean(), license: LabelSchema.nullable(),
    station: z.object({ name: LabelSchema, latitude: finite(), longitude: finite() }).strict() }).strict(),
  timezone: z.string().min(1).max(64), intervalMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  units: z.object({ dryBulb: z.literal('degC'), directNormalIrradiance: z.literal('W/m2') }).strict(),
  samples: z.array(z.object({ timestamp: z.string().max(40), dryBulb: finite().nullable(), directNormalIrradiance: finite().nullable() }).strict()).min(1).max(ENVIRONMENTAL_LIMITS.weatherSamples),
  sha256: hash }).strict();
export type Weather = z.infer<typeof WeatherSchema>;
const provenance = z.object({ kind: z.enum(['USER_PROVIDED', 'VERSIONED_LIBRARY', 'EXTERNAL_DATASET']), reference: LabelSchema.nullable(), version: LabelSchema.nullable() }).strict();
export const ConstructionSchema = z.object({ key, name: LabelSchema, uValue: q('W/(m2*K)', finite().gt(0).max(20)),
  provenance: provenance.refine(p => p.kind === 'USER_PROVIDED' || (p.reference !== null && p.version !== null), 'Library and dataset values need a reference and version') }).strict();
export const ThermalCaseSchema = z.object({ key, inside: celsius(),
  outside: z.discriminatedUnion('kind', [z.object({ kind: z.literal('CONSTANT'), temperature: celsius() }).strict(), z.object({ kind: z.literal('WEATHER') }).strict()]),
  ground: celsius().nullable().default(null), durationHours: q('h', finite().gt(0).max(8784)).nullable().default(null) }).strict()
  .refine(c => c.outside.kind === 'CONSTANT' || c.durationHours === null, 'A weather-driven case takes its duration from the dataset');
const assignments = z.object({ EXTERIOR_WALL: key.optional(), WINDOW: key.optional(), DOOR: key.optional(), OPENING: key.optional(), ROOF: key.optional(), GROUND_FLOOR: key.optional() }).strict();
const location = z.object({ latitude: q('deg'), longitude: q('deg'), timezone: z.string().min(1).max(64), provenance: z.literal('USER_PROVIDED') }).strict();
export const EnvironmentalInputSchema = z.object({ version: z.literal(ENVIRONMENTAL_INPUT_VERSION),
  // Latitude/longitude ranges and the time zone are checked by the builder so that a bad value is a typed location error, not a generic 400.
  location: location.nullable().default(null),
  orientation: z.object({ northMilliDegrees: z.number().int().min(0).max(359_999), convention: z.literal(NORTH_CONVENTION), provenance: z.literal('USER_PROVIDED') }).strict().nullable().default(null),
  constructions: z.array(ConstructionSchema).max(ENVIRONMENTAL_LIMITS.constructions).default([]),
  assignments: assignments.default({}),
  overrides: z.array(z.object({ source: z.object({ collection: z.enum(['walls', 'openings', 'slabs']), id: EntityIdSchema }).strict(), construction: key }).strict())
    .max(ENVIRONMENTAL_LIMITS.overrides).default([]),
  thermalCases: z.array(ThermalCaseSchema).max(ENVIRONMENTAL_LIMITS.thermalCases).default([]),
  solarInstants: z.array(z.object({ key, localDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/) }).strict()).max(ENVIRONMENTAL_LIMITS.solarInstants).default([]),
  weather: WeatherSchema.nullable().default(null),
}).strict();
export type EnvironmentalInput = z.infer<typeof EnvironmentalInputSchema>;

// ---------------------------------------------------------------- environmental semantic model
const plan = z.object({ x: z.number().int(), z: z.number().int() }).strict();
const vec3 = z.tuple([finite(), finite(), finite()]);
export const EnvironmentalBindingSchema = BimBindingSchema.extend({ bimVersion: z.literal(BIM_VERSION), environmentalModelVersion: z.literal(ENVIRONMENTAL_MODEL_VERSION) }).strict();
export type EnvironmentalBinding = z.infer<typeof EnvironmentalBindingSchema>;
const construction = z.union([
  z.object({ status: z.literal('SPECIFIED'), key, uValue: q('W/(m2*K)'), provenance }).strict(),
  z.object({ status: z.literal('NOT_SPECIFIED'), key: z.null(), uValue: z.null(), provenance: z.null() }).strict(),
]);
export const SurfaceSchema = z.object({ id: eid, type: surfaceType, boundary: z.enum(['OUTDOOR', 'GROUND']),
  source: z.object({ collection: z.enum(['walls', 'openings', 'slabs']), id: EntityIdSchema, bimElementId: bimId }).strict(),
  hostSurfaceId: eid.nullable(), levelId: EntityIdSchema, zoneIds: z.array(eid).max(ENVIRONMENTAL_LIMITS.zones),
  geometry: z.discriminatedUnion('kind', [
    // storeyTopMm closes the slab-edge band between wall top and storey top when the wall acts as an occluder; faceOffsetMm (half the
    // host wall thickness) places ray origins on the outer face, where plates end, so a plate edge is not mistaken for an overhang.
    z.object({ kind: z.literal('VERTICAL_RECTANGLE'), start: plan, end: plan, bottomMm: z.number().int(), topMm: z.number().int(), storeyTopMm: z.number().int(),
      faceOffsetMm: z.number().finite().nonnegative() }).strict(),
    z.object({ kind: z.literal('HORIZONTAL_POLYGON'), outer: z.array(plan).min(3).max(256), voids: z.array(z.array(plan).min(3).max(256)).max(64), elevationMm: z.number().int() }).strict(),
  ]),
  grossArea: q('m2', finite().positive()), netArea: q('m2', finite().positive()), normal: vec3, tilt: q('deg'), azimuth: q('deg').nullable(),
  classification: z.object({ architectural: z.string().max(40), status: z.enum(['CONSISTENT', 'ASSUMED']) }).strict(), construction }).strict();
export type EnvironmentalSurface = z.infer<typeof SurfaceSchema>;
export const ZoneSchema = z.object({ id: eid, source: z.object({ collection: z.literal('spaces'), id: EntityIdSchema, bimElementId: bimId }).strict(),
  levelId: EntityIdSchema, floorArea: q('m2', finite().positive()), height: z.object({ value: z.number().int().positive(), unit: z.literal('mm'), basis: z.literal('LEVEL_FLOOR_TO_FLOOR') }).strict(),
  volume: q('m3', finite().positive()) }).strict();
const claims = z.object({ energyEfficiency: z.literal('NOT_CLAIMED'), sustainability: z.literal('NOT_CLAIMED'), greenCertification: z.literal('NOT_CLAIMED'), thermalComfort: z.literal('NOT_CLAIMED'),
  daylightCompliance: z.literal('NOT_CLAIMED'), codeCompliance: z.literal('NOT_CLAIMED'), certification: z.literal('NOT_CLAIMED') }).strict();
export const EnvironmentalModelSchema = z.object({ version: z.literal(ENVIRONMENTAL_MODEL_VERSION), coordinateSystem: z.literal('x-right-y-up-z-depth'),
  units: z.object({ length: z.literal('mm'), area: z.literal('m2'), volume: z.literal('m3'), angle: z.literal('deg') }).strict(), binding: EnvironmentalBindingSchema,
  location: location.nullable(),
  orientation: z.object({ northMilliDegrees: z.number().int(), convention: z.literal(NORTH_CONVENTION), north: vec3, east: vec3, up: vec3,
    siteNorthMilliDegrees: z.number().int().nullable() }).strict().nullable(),
  zones: z.array(ZoneSchema).max(ENVIRONMENTAL_LIMITS.zones), surfaces: z.array(SurfaceSchema).max(ENVIRONMENTAL_LIMITS.surfaces),
  // CLOSED when every zone is covered from above by a roof plate or an upper floor plate; otherwise totals are partial.
  envelope: z.object({ status: z.enum(['CLOSED', 'INCOMPLETE']), uncoveredZoneIds: z.array(eid) }).strict(),
  assumptions: z.array(z.enum(ASSUMPTIONS)), claims }).strict();
export type EnvironmentalModel = z.infer<typeof EnvironmentalModelSchema>;

// ---------------------------------------------------------------- results (calculator output, validated before use)
const status = z.enum(['NOT_EVALUATED', 'INPUT_INCOMPLETE', 'ANALYZED', 'PARTIAL', 'UNSUPPORTED']);
const reason = z.string().max(200).nullable();
const watts = () => q('W');
export const ResultsSchema = z.object({
  solar: z.object({ status, reason, algorithm: z.literal(SOLAR_ALGORITHM), instants: z.array(z.object({ key, localDateTime: z.string().max(19), timezone: z.string().max(64),
    utc: z.string().datetime(), altitude: q('deg'), azimuth: q('deg'), aboveHorizon: z.boolean(), sunDirection: vec3.nullable() }).strict()).max(ENVIRONMENTAL_LIMITS.solarInstants) }).strict(),
  exposure: z.object({ status, reason, method: z.literal('RAY_CAST_SAMPLED_DIRECT_SUN'), instants: z.array(z.object({ key, surfaces: z.array(z.object({ surfaceId: eid,
    state: z.enum(['SUN_BELOW_HORIZON', 'NOT_FACING', 'EVALUATED']), cosIncidence: finite().min(-1).max(1), samples: z.number().int().min(1).max(4096), sunlitSamples: z.number().int().min(0),
    sunlitFraction: finite().min(0).max(1),
    directBeam: z.union([z.object({ status: z.literal('EVALUATED'), dni: q('W/m2'), incident: q('W/m2'), power: watts() }).strict(),
      z.object({ status: z.literal('NOT_EVALUATED'), reason: z.string().max(120) }).strict()]) }).strict()) }).strict()).max(ENVIRONMENTAL_LIMITS.solarInstants) }).strict(),
  thermal: z.object({ status, reason, method: z.literal('STEADY_STATE_U_A_DELTA_T'), cases: z.array(z.object({ key, status, reason,
    deltaT: z.object({ outdoor: q('K').nullable(), ground: q('K').nullable() }).strict(),
    surfaces: z.array(z.object({ surfaceId: eid, status: z.enum(['EVALUATED', 'NOT_SPECIFIED', 'NOT_EVALUATED', 'UNSUPPORTED']), heatFlow: watts().nullable() }).strict()),
    byType: z.object({ EXTERIOR_WALL: watts(), WINDOW: watts(), DOOR: watts(), OPENING: watts(), ROOF: watts(), GROUND_FLOOR: watts() }).strict(),
    total: watts(), totalKw: q('kW'), evaluatedArea: q('m2'), unevaluatedSurfaceIds: z.array(eid),
    energy: z.object({ method: z.enum(['CONSTANT_POWER_TIMES_DURATION', 'SAMPLED_SERIES_LEFT_RECTANGLE']), duration: q('h'), energy: q('Wh'), energyKwh: q('kWh'), peakPower: watts(),
      samples: z.number().int().positive() }).strict().nullable() }).strict()).max(ENVIRONMENTAL_LIMITS.thermalCases) }).strict(),
  daylightIndicator: z.object({ status, metric: z.literal('WINDOW_TO_FLOOR_AREA_RATIO'), isDaylightMetric: z.literal(false),
    zones: z.array(z.object({ zoneId: eid, windowArea: q('m2'), floorArea: q('m2'), ratio: q('1') }).strict()) }).strict(),
  weather: z.object({ used: z.boolean(), synthetic: z.boolean().nullable(), datasetId: z.string().max(200).nullable(), sha256: hash.nullable() }).strict(),
}).strict();
export type EnvironmentalResults = z.infer<typeof ResultsSchema>;
export const CalculatorIdentitySchema = z.object({ name: z.string().min(1).max(100), version: z.string().min(1).max(100), adapterVersion: z.literal(ENVIRONMENTAL_ADAPTER_VERSION) }).strict();
export const DiagnosticsSchema = z.array(z.object({ code: z.string().max(60), targetId: z.string().max(80).nullable(), message: z.string().max(300), severity: z.enum(['ERROR', 'WARNING', 'INFO']) }).strict()).max(200);
export const ModelValidationSchema = z.object({ validator: z.literal(MODEL_VALIDATOR), status: z.enum(['VALID', 'INVALID']), diagnostics: DiagnosticsSchema }).strict();
export type ModelValidation = z.infer<typeof ModelValidationSchema>;
export const ResultValidationSchema = z.object({ validator: z.literal(RESULT_VALIDATOR), status: z.enum(['VALID', 'INVALID']), diagnostics: DiagnosticsSchema,
  solarMaxDeviation: q('deg').nullable() }).strict();
export type ResultValidation = z.infer<typeof ResultValidationSchema>;
export const CalculatorRunSchema = CalculatorIdentitySchema.extend({ settings: z.record(z.union([z.string().max(100), z.number().finite()])), executionMs: z.number().finite().nonnegative() }).strict();
export const SnapshotSchema = z.object({ version: z.literal(ENVIRONMENTAL_ANALYSIS_VERSION), binding: EnvironmentalBindingSchema, inputHash: hash, analysisInputHash: hash,
  input: EnvironmentalInputSchema, model: EnvironmentalModelSchema, calculator: CalculatorRunSchema,
  results: ResultsSchema, validation: z.object({ model: ModelValidationSchema, results: ResultValidationSchema }).strict(),
  status: z.object({ analysis: z.literal('ANALYZED'), validation: z.literal('VALIDATED') }).strict(), claims, limitations: z.array(z.string().max(300)).max(16) }).strict();
export type EnvironmentalSnapshot = z.infer<typeof SnapshotSchema>;

// ---------------------------------------------------------------- HTTP DTOs
const uuid = z.string().uuid();
export const EnvironmentalSummarySchema = z.object({ id: uuid, projectRevisionId: uuid, acceptanceQaId: uuid, environmentalModelVersion: z.literal(ENVIRONMENTAL_MODEL_VERSION),
  analysisVersion: z.literal(ENVIRONMENTAL_ANALYSIS_VERSION), modelHash: hash, inputHash: hash, analysisInputHash: hash, calculator: CalculatorIdentitySchema, status: z.literal('VALIDATED'),
  createdAt: z.string().datetime({ offset: true }), counts: z.object({ zones: z.number().int().nonnegative(), surfaces: z.number().int().nonnegative(),
    solarInstants: z.number().int().nonnegative(), thermalCases: z.number().int().nonnegative() }).strict() }).strict();
export const EnvironmentalDetailSchema = EnvironmentalSummarySchema.extend({ snapshot: SnapshotSchema });
export const EnvironmentalCursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: uuid }).strict();
export const EnvironmentalReadQuerySchema = z.object({ require: z.literal('current').optional() }).strict();
