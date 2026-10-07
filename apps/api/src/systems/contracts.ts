import { z } from 'zod';
import { EntityIdSchema } from '@designflow/shared';
import { BIM_VERSION, BimBindingSchema } from '../bim/contracts.js';
import { STRUCTURAL_MODEL_VERSION } from '../structural/contracts.js';
import { ENVIRONMENTAL_MODEL_VERSION } from '../environmental/contracts.js';

export const SYSTEMS_INPUT_VERSION = 'building-systems-input-v1';
export const SYSTEMS_MODEL_VERSION = 'building-systems-model-v1';
export const SYSTEMS_ANALYSIS_VERSION = 'building-systems-analysis-v1';
export const SYSTEMS_ADAPTER_VERSION = 'building-systems-adapter-v1';
export const MODEL_VALIDATOR = 'building-systems-validator-v1', RESULT_VALIDATOR = 'building-systems-result-validator-v1';
export const SUBMODELS = { plumbing: 'plumbing-coordination-v1', electrical: 'electrical-coordination-v1', hvac: 'hvac-coordination-v1', lifeSafety: 'life-safety-geometry-v1',
  verticalTransport: 'vertical-transport-v1', coordination: 'coordination-clash-v1', router: 'orthogonal-hanan-dijkstra-v1', egress: 'egress-l1-geodesic-v1', clashGeometry: 'envelope-box-v1' } as const;
/** Router score in mm-equivalents. Validity is a hard constraint, so no weight can make an invalid route win. One source; see phase26-design.md §6. */
export const ROUTING_WEIGHTS = { version: 'routing-weights-v1', bend: 1500, wallCrossing: 3000, levelTransition: 6000 } as const;
/** Sized from fixture measurements with headroom; see docs/phase26/phase26-design.md §14. */
export const SYSTEMS_LIMITS = { inputBytes: 1_048_576, terminals: 500, networks: 64, panels: 64, circuits: 256, loads: 500, equipment: 256, hvacSystems: 16, fixtures: 300,
  elevators: 4, fixedPoints: 256, gridNodesPerNetwork: 250_000, searchStates: 20_000_000, egressNodes: 50_000, clashPairs: 4_000_000, elevatorCandidates: 50_000,
  calculationMs: 10_000, outputBytes: 9_000_000 } as const;
/** Architectural circulation semantics (explicit classification values the generator and BIM profile already use). */
export const CIRCULATION_CLASSIFICATIONS = ['circulation', 'corridor', 'stairwell'] as const;
export const CLAIMS = { mepDesignComplete: 'NOT_CLAIMED', electricalSafety: 'NOT_CLAIMED', plumbingCompliance: 'NOT_CLAIMED', hvacSizing: 'NOT_CLAIMED',
  fireCodeCompliance: 'NOT_CLAIMED', lifeSafetyCertification: 'NOT_CLAIMED', accessibilityCompliance: 'NOT_CLAIMED', elevatorCertification: 'NOT_CLAIMED',
  buildingCodeCompliance: 'NOT_CLAIMED', professionalCertification: 'NOT_CLAIMED' } as const;
/** Engineering this phase deliberately does not perform. Reported verbatim, never computed. */
export const NOT_EVALUATED = {
  plumbing: ['HYDRAULIC_SIZING', 'PIPE_PRESSURE', 'PUMP_SIZING', 'TANK_SIZING', 'PIPE_DIAMETER_SELECTION', 'FRICTION_LOSS', 'WATER_DEMAND', 'DRAINAGE_CODE_COMPLIANCE'],
  electrical: ['BREAKER_SIZE', 'CONDUCTOR_AMPACITY', 'FAULT_CURRENT', 'PROTECTIVE_DISCRIMINATION', 'EARTHING', 'SHORT_CIRCUIT_WITHSTAND', 'PHASE_BALANCE', 'CODE_COMPLIANCE'],
  hvac: ['DESIGN_HEATING_LOAD', 'DESIGN_COOLING_LOAD', 'DUCT_PRESSURE_LOSS', 'FAN_SIZING', 'COIL_SIZING', 'CHILLER_SIZING', 'AC_CAPACITY'],
  lifeSafety: ['LIMIT_EVALUATION', 'CODE_TRAVEL_DISTANCE', 'REQUIRED_EXIT_COUNT', 'OCCUPANT_LOAD', 'SPRINKLER_HYDRAULICS', 'FIRE_PUMP_SIZING', 'HYDRANT_DESIGN', 'SMOKE_CONTROL'],
  verticalTransport: ['MOTOR', 'ROPES', 'TRACTION', 'BRAKING', 'COUNTERWEIGHT', 'RAILS', 'SEISMIC', 'SAFETY_GEAR', 'TRAFFIC_ANALYSIS', 'CODE_COMPLIANCE'],
} as const;
export const ASSUMPTIONS = ['CENTERLINE_ARCHITECTURE_GEOMETRY', 'ORTHOGONAL_ROUTES_ON_HANAN_GRID', 'CONSERVATIVE_SQUARE_ENVELOPE_FOR_STRUCTURE', 'CIRCUMSCRIBED_BOX_FOR_ROUND_SERVICES',
  'STAIR_FLIGHT_OCCUPIES_FULL_STOREY', 'EGRESS_PLAN_LENGTH_STAIR_RUN', 'ELECTRICAL_ROUTES_SHARE_CONTAINMENT', 'HALF_SIZES_ROUNDED_UP_TO_WHOLE_MM', 'ARCHITECTURE_NOT_MODIFIED'] as const;
export const LIMITATIONS = [
  'Conceptual MEP coordination only: no hydraulic, electrical-protection, HVAC-load, duct-pressure or equipment sizing, no fabrication or commissioning data, and no MEP costing.',
  'Life-safety results are geometric measurements of an independently built egress graph; no travel-distance limit, exit-count rule, occupant load or fire-code verdict is evaluated.',
  'Elevators are spatial proposals only; no mechanical, structural, traffic or accessibility engineering is performed, and architecture is never modified automatically.',
  'Every terminal, routing elevation, slope, clearance, load, airflow and exit is explicit input; none is inferred from names, locale or upstream analyses.',
  'Preliminary coordination information only; not a design, not code-compliant, not certified and not professionally approved.',
] as const;

export type SystemsErrorCode = 'BUILDING_SYSTEMS_SOURCE_UNSUPPORTED' | 'BUILDING_SYSTEMS_INPUT_INCOMPLETE' | 'BUILDING_SYSTEMS_MODEL_INVALID' | 'BUILDING_SYSTEMS_RESOURCE_LIMIT'
  | 'SYSTEM_ROUTE_NOT_FOUND' | 'SYSTEM_ROUTE_INVALID' | 'SYSTEM_CLASH_UNRESOLVED' | 'SYSTEM_RESULT_INVALID' | 'SYSTEM_ANALYSIS_TIMEOUT' | 'SYSTEM_ANALYSIS_FAILED' | 'SYSTEMS_RESULT_STALE';
export class SystemsError extends Error {
  constructor(readonly code: SystemsErrorCode, message: string) { super(message); this.name = 'SystemsError'; }
}

const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sid = z.string().regex(/^sys-[a-f0-9]{40}$/);
const uuid = z.string().uuid();
const finite = () => z.number().finite();
const coordinate = z.number().int().min(-100_000_000).max(100_000_000);
const plan = z.object({ x: coordinate, z: coordinate }).strict();
const point3 = z.object({ x: coordinate, y: finite(), z: coordinate }).strict();
const relative = z.number().int().min(-100_000).max(100_000);
const sizeMm = z.number().int().min(1).max(10_000);
const userProvided = z.literal('USER_PROVIDED');
const q = <U extends string, S extends z.ZodTypeAny = z.ZodNumber>(unit: U, schema?: S) => z.object({ value: (schema ?? finite()) as S, unit: z.literal(unit) }).strict();
export const RectSchema = z.object({ minX: coordinate, minZ: coordinate, maxX: coordinate, maxZ: coordinate }).strict().refine(r => r.maxX > r.minX && r.maxZ > r.minZ, 'Empty rectangle');
export type Rect = z.infer<typeof RectSchema>;
export const SizeSchema = z.discriminatedUnion('shape', [z.object({ shape: z.literal('ROUND'), diameterMm: sizeMm }).strict(),
  z.object({ shape: z.literal('RECTANGULAR'), widthMm: sizeMm, heightMm: sizeMm }).strict()]);
export type ServiceSize = z.infer<typeof SizeSchema>;
const clearance = z.object({ value: z.number().int().min(0).max(5000), unit: z.literal('mm'), provenance: userProvided }).strict().nullable().default(null);
/** Horizontal service elevation per level, relative to that level's elevation. Never invented when missing. */
const elevations = z.array(z.object({ levelId: EntityIdSchema, elevationMm: relative }).strict()).max(16).default([]);
const located = { spaceId: EntityIdSchema, point: plan.nullable(), elevationMm: relative };
const fixedRoute = z.object({ terminal: key, points: z.array(z.object({ x: coordinate, y: coordinate, z: coordinate }).strict()).min(2).max(SYSTEMS_LIMITS.fixedPoints) }).strict();
const routing = z.discriminatedUnion('mode', [z.object({ mode: z.literal('PLANNED') }).strict(),
  z.object({ mode: z.literal('FIXED'), routes: z.array(fixedRoute).min(1).max(SYSTEMS_LIMITS.terminals) }).strict()]);
const network = z.object({ elevations, size: SizeSchema.nullable().default(null), routing: routing.default({ mode: 'PLANNED' }) }).strict();
const networkDefault = { elevations: [], size: null, routing: { mode: 'PLANNED' as const } };
const anchor = z.object({ key, ...located, provenance: userProvided }).strict();

// ---------------------------------------------------------------- explicit building-systems input
export const FIXTURE_KINDS = ['WC', 'WASH_BASIN', 'SHOWER', 'SINK', 'FLOOR_DRAIN', 'WASHING_MACHINE', 'DISHWASHER', 'WATER_HEATER', 'OTHER'] as const;
export const PlumbingInputSchema = z.object({
  /** One explicit connection per service: a fixture's cold, hot and waste connections are distinct physical points. */
  fixtures: z.array(z.object({ key, kind: z.enum(FIXTURE_KINDS), spaceId: EntityIdSchema,
    connections: z.array(z.object({ service: z.enum(['COLD_WATER', 'HOT_WATER', 'SANITARY']), point: plan.nullable(), elevationMm: relative }).strict()).min(1).max(3)
      .refine(c => new Set(c.map(x => x.service)).size === c.length, 'One connection per service'),
    provenance: userProvided }).strict()).min(1).max(SYSTEMS_LIMITS.fixtures),
  coldWaterSource: anchor.nullable().default(null), hotWaterSource: anchor.nullable().default(null),
  /** elevationMm is the outlet pipe centreline elevation relative to its level. */
  sanitaryOutlet: anchor.nullable().default(null),
  minimumSlope: z.object({ rise: z.number().int().min(1).max(1000), run: z.number().int().min(1).max(1000), provenance: userProvided }).strict()
    .refine(s => s.rise <= s.run, 'Slope above 1:1 is not drainage').nullable().default(null),
  coldWater: network.default(networkDefault), hotWater: network.default(networkDefault),
  sanitary: z.object({ bands: z.array(z.object({ levelId: EntityIdSchema, topMm: relative, bottomMm: relative }).strict().refine(b => b.topMm > b.bottomMm, 'Empty drainage band')).max(16).default([]),
    size: SizeSchema.nullable().default(null) }).strict().default({ bands: [], size: null }),
  clearance,
}).strict();
export const ElectricalInputSchema = z.object({
  supply: z.object({ key, systemVoltage: q('V', finite().gt(0).max(1_000_000)).nullable(), phaseSystem: z.enum(['SINGLE_PHASE', 'SPLIT_PHASE', 'THREE_PHASE']).nullable(),
    frequencyHz: q('Hz', finite().gt(0).max(1000)).nullable(), ...located, provenance: userProvided }).strict().nullable().default(null),
  panels: z.array(z.object({ key, ...located, footprint: RectSchema.nullable().default(null), provenance: userProvided }).strict()).min(1).max(SYSTEMS_LIMITS.panels),
  circuits: z.array(z.object({ key, panel: key, loads: z.array(key).min(1).max(SYSTEMS_LIMITS.loads) }).strict()).min(1).max(SYSTEMS_LIMITS.circuits),
  loads: z.array(z.object({ key, kind: z.enum(['LIGHTING', 'SOCKET', 'EQUIPMENT', 'MECHANICAL', 'OTHER']), ...located,
    power: z.object({ value: finite().min(0).max(10_000_000), unit: z.enum(['W', 'VA']) }).strict(), phase: z.enum(['L1', 'L2', 'L3']).nullable().default(null),
    demandFactor: z.object({ value: finite().min(0).max(1), provenance: userProvided }).strict().nullable().default(null), provenance: userProvided }).strict())
    .min(1).max(SYSTEMS_LIMITS.loads),
  feeder: network.default(networkDefault), circuitRouting: network.default(networkDefault), clearance,
}).strict();
export const HvacInputSchema = z.object({
  equipment: z.array(z.object({ key, kind: z.enum(['AIR_HANDLING_UNIT', 'FAN', 'INDOOR_UNIT', 'OTHER']), ...located, footprint: RectSchema.nullable().default(null),
    provenance: userProvided }).strict()).min(1).max(SYSTEMS_LIMITS.equipment),
  /** connection is this system's duct connection on its equipment (explicit; supply and return connections are distinct points). */
  systems: z.array(z.object({ key, kind: z.enum(['SUPPLY', 'RETURN', 'EXHAUST']), equipment: key, connection: z.object({ point: plan.nullable(), elevationMm: relative }).strict(),
    terminals: z.array(z.object({ key, ...located, airflow: z.object({ value: finite().gt(0).max(1_000_000), unit: z.enum(['L/s', 'm3/s']), provenance: userProvided }).strict().nullable() }).strict())
      .min(1).max(SYSTEMS_LIMITS.terminals),
    ductSection: SizeSchema.nullable().default(null), elevations, routing: routing.default({ mode: 'PLANNED' }) }).strict()).min(1).max(SYSTEMS_LIMITS.hvacSystems),
  clearance,
}).strict();
export const LifeSafetyInputSchema = z.object({
  exits: z.discriminatedUnion('mode', [z.object({ mode: z.literal('SITE_PRIMARY_ENTRY') }).strict(),
    z.object({ mode: z.literal('EXPLICIT'), openingIds: z.array(EntityIdSchema).min(1).max(16) }).strict()]).nullable().default(null),
  obstructedOpeningIds: z.array(EntityIdSchema).max(64).default([]),
}).strict();
export const SIDES = ['+x', '-x', '+z', '-z'] as const;
export const VerticalTransportInputSchema = z.object({
  elevators: z.array(z.object({ key, servedLevelIds: z.array(EntityIdSchema).min(2).max(16),
    shaft: z.object({ widthMm: z.number().int().min(800).max(6000), depthMm: z.number().int().min(800).max(6000) }).strict(),
    door: z.object({ side: z.enum(SIDES), widthMm: z.number().int().min(500).max(3000) }).strict(),
    placement: z.discriminatedUnion('mode', [z.object({ mode: z.literal('FIXED'), origin: plan }).strict(), z.object({ mode: z.literal('PLANNER_SELECTED') }).strict()]),
    cabin: z.object({ widthMm: sizeMm, depthMm: sizeMm }).strict().nullable().default(null), pitDepthMm: sizeMm.nullable().default(null), overheadMm: sizeMm.nullable().default(null),
    ratedLoad: q('kg', finite().gt(0).max(100_000)).nullable().default(null), ratedSpeed: q('m/s', finite().gt(0).max(20)).nullable().default(null), provenance: userProvided }).strict())
    .min(1).max(SYSTEMS_LIMITS.elevators),
}).strict();
export const SystemsInputSchema = z.object({ version: z.literal(SYSTEMS_INPUT_VERSION),
  sources: z.object({ structuralAnalysisId: uuid.nullable().default(null), environmentalAnalysisId: uuid.nullable().default(null) }).strict()
    .default({ structuralAnalysisId: null, environmentalAnalysisId: null }),
  plumbing: PlumbingInputSchema.nullable().default(null), electrical: ElectricalInputSchema.nullable().default(null), hvac: HvacInputSchema.nullable().default(null),
  lifeSafety: LifeSafetyInputSchema.nullable().default(null), verticalTransport: VerticalTransportInputSchema.nullable().default(null),
}).strict();
export type SystemsInput = z.infer<typeof SystemsInputSchema>;

// ---------------------------------------------------------------- building-systems semantic model
const upstream = <V extends string>(version: V) => z.object({ analysisId: uuid, inputHash: hash, modelVersion: z.literal(version) }).strict().nullable();
export const SystemsBindingSchema = BimBindingSchema.extend({ bimVersion: z.literal(BIM_VERSION), systemsModelVersion: z.literal(SYSTEMS_MODEL_VERSION),
  structural: upstream(STRUCTURAL_MODEL_VERSION), environmental: upstream(ENVIRONMENTAL_MODEL_VERSION) }).strict();
export type SystemsBinding = z.infer<typeof SystemsBindingSchema>;
export const DISCIPLINES = ['PLUMBING', 'ELECTRICAL', 'HVAC'] as const;
export const SYSTEMS = ['SANITARY', 'HVAC_SUPPLY', 'HVAC_RETURN', 'HVAC_EXHAUST', 'COLD_WATER', 'HOT_WATER', 'ELECTRICAL_FEEDER', 'ELECTRICAL_CIRCUIT'] as const;
export type SystemKind = typeof SYSTEMS[number];
const ring = z.array(plan).min(3).max(256);
const box = z.object({ minX: finite(), minY: finite(), minZ: finite(), maxX: finite(), maxY: finite(), maxZ: finite() }).strict();
export type Box = z.infer<typeof box>;
export const TerminalSchema = z.object({ id: sid, key, role: z.enum(['FIXTURE', 'WATER_SOURCE', 'SANITARY_OUTLET', 'SUPPLY', 'PANEL', 'LOAD', 'EQUIPMENT', 'AIR_TERMINAL']),
  spaceId: EntityIdSchema, levelId: EntityIdSchema, point: plan.nullable(), y: z.number().int(), footprint: RectSchema.nullable() }).strict();
export type Terminal = z.infer<typeof TerminalSchema>;
export const NetworkSchema = z.object({ id: sid, key: z.string().regex(/^[A-Z_]+(:[A-Za-z0-9._-]{1,64})?$/), discipline: z.enum(DISCIPLINES), system: z.enum(SYSTEMS),
  rootId: sid.nullable(), terminalIds: z.array(sid).max(SYSTEMS_LIMITS.terminals), size: SizeSchema.nullable(), clearanceMm: z.number().int().nonnegative().nullable(),
  /** Absolute elevation of horizontal runs per level (pressure, cable and duct networks) or the absolute drainage band (gravity networks). */
  levels: z.array(z.object({ levelId: EntityIdSchema, y: z.number().int().nullable(), band: z.object({ top: z.number().int(), bottom: z.number().int() }).strict().nullable() }).strict()).max(16),
  slope: z.object({ rise: z.number().int().positive(), run: z.number().int().positive() }).strict().nullable(),
  mode: z.enum(['PLANNED', 'FIXED']), fixedRoutes: z.array(z.object({ terminalId: sid, points: z.array(point3).min(2).max(SYSTEMS_LIMITS.fixedPoints) }).strict()),
  status: z.enum(['READY', 'INPUT_INCOMPLETE', 'UNSUPPORTED']), missing: z.array(z.string().max(160)).max(64) }).strict();
export type Network = z.infer<typeof NetworkSchema>;
const claimsShape = Object.fromEntries(Object.keys(CLAIMS).map(k => [k, z.literal('NOT_CLAIMED')])) as Record<keyof typeof CLAIMS, z.ZodLiteral<'NOT_CLAIMED'>>;
export const ClaimsSchema = z.object(claimsShape).strict();
export const SystemsModelSchema = z.object({ version: z.literal(SYSTEMS_MODEL_VERSION), coordinateSystem: z.literal('x-right-y-up-z-depth'),
  units: z.object({ length: z.literal('mm'), elevation: z.literal('mm-absolute') }).strict(), binding: SystemsBindingSchema,
  levels: z.array(z.object({ levelId: EntityIdSchema, index: z.number().int(), elevationMm: z.number().int(), topMm: z.number().int(), boundary: ring }).strict()).max(16),
  spaces: z.array(z.object({ spaceId: EntityIdSchema, levelId: EntityIdSchema, classification: z.string().max(200), circulation: z.boolean(), boundary: ring }).strict()).max(4096),
  walls: z.array(z.object({ wallId: EntityIdSchema, levelId: EntityIdSchema, start: plan, end: plan, thicknessMm: z.number().int().positive(), bottomY: z.number().int(), topY: z.number().int(),
    exterior: z.boolean() }).strict()).max(8192),
  /** center2/footprint2 are in doubled coordinates so odd opening widths stay exact integers. */
  openings: z.array(z.object({ openingId: EntityIdSchema, wallId: EntityIdSchema, levelId: EntityIdSchema, kind: z.enum(['door', 'window', 'opening']), widthMm: z.number().int().positive(),
    traversable: z.boolean(), exterior: z.boolean(), spaceIds: z.array(EntityIdSchema).max(2), center2: plan,
    footprint2: z.object({ minX: coordinate, minZ: coordinate, maxX: coordinate, maxZ: coordinate }).strict() }).strict()).max(8192),
  plates: z.array(z.object({ slabId: EntityIdSchema, levelId: EntityIdSchema, outer: ring, voids: z.array(ring).max(64), topY: z.number().int(), bottomY: z.number().int() }).strict()).max(4096),
  stairs: z.array(z.object({ stairId: EntityIdSchema, fromLevelId: EntityIdSchema, toLevelId: EntityIdSchema, flight: RectSchema, landings: z.array(RectSchema).max(2),
    direction: z.enum(SIDES), widthMm: z.number().int().positive(), runMm: z.number().int().positive(), riseMm: z.number().int().positive(), bottomY: z.number().int(), topY: z.number().int() }).strict()).max(16),
  structure: z.object({ status: z.enum(['BOUND', 'NOT_SUPPLIED']), members: z.array(z.object({ memberId: z.string().regex(/^str-[a-f0-9]{40}$/), kind: z.enum(['COLUMN', 'BEAM']),
    start: point3, end: point3, halfSizeMm: finite().positive().nullable(), envelope: z.enum(['CONSERVATIVE_SQUARE_ENVELOPE', 'NOT_EVALUATED_NO_SECTION_DIMENSIONS']) }).strict()).max(4000) }).strict(),
  terminals: z.array(TerminalSchema).max(SYSTEMS_LIMITS.terminals * 3), networks: z.array(NetworkSchema).max(SYSTEMS_LIMITS.networks + SYSTEMS_LIMITS.circuits),
  exits: z.object({ status: z.enum(['DESIGNATED', 'NOT_REQUESTED', 'INPUT_INCOMPLETE']), mode: z.enum(['SITE_PRIMARY_ENTRY', 'EXPLICIT']).nullable(), openingIds: z.array(EntityIdSchema).max(16),
    obstructedOpeningIds: z.array(EntityIdSchema).max(64), missing: z.array(z.string().max(160)).max(8) }).strict(),
  requested: z.object({ plumbing: z.boolean(), electrical: z.boolean(), hvac: z.boolean(), lifeSafety: z.boolean(), verticalTransport: z.boolean() }).strict(),
  assumptions: z.array(z.enum(ASSUMPTIONS)), claims: ClaimsSchema,
}).strict();
export type SystemsModel = z.infer<typeof SystemsModelSchema>;

// ---------------------------------------------------------------- results (calculator output, validated before use)
const status = z.enum(['NOT_EVALUATED', 'INPUT_INCOMPLETE', 'ANALYZED', 'PARTIAL', 'UNSUPPORTED']);
const reason = z.string().max(300).nullable();
/** An exact rational rendered as a decimal or "n/d" string, with its nearest double for display. */
const exact = <U extends string>(unit: U) => z.object({ value: finite(), exact: z.string().max(200), unit: z.literal(unit) }).strict();
const failure = z.object({ code: z.enum(['SYSTEM_ROUTE_NOT_FOUND', 'SYSTEM_ROUTE_INVALID', 'BUILDING_SYSTEMS_INPUT_INCOMPLETE', 'BUILDING_SYSTEMS_SOURCE_UNSUPPORTED']), message: z.string().max(300) }).strict().nullable();
export const NetworkResultSchema = z.object({ networkId: sid, status: z.enum(['ROUTED', 'ROUTE_NOT_FOUND', 'ROUTE_INVALID', 'INPUT_INCOMPLETE', 'UNSUPPORTED']), failure,
  /** Each branch runs from its terminal to where it joins the root or an earlier branch (flow direction for drainage). */
  branches: z.array(z.object({ terminalId: sid, points: z.array(point3).min(1).max(20_000), joins: z.enum(['ROOT', 'NETWORK']) }).strict()).max(SYSTEMS_LIMITS.terminals),
  length: q('mm', finite().nonnegative()), horizontalLength: q('mm', z.number().int().nonnegative()), verticalLength: q('mm', finite().nonnegative()),
  bends: z.number().int().nonnegative(), levelTransitions: z.number().int().nonnegative(),
  /** Drainage elevations are pipe centreline elevations (absolute mm), not inverts. */
  drainage: z.object({ slope: z.object({ rise: z.number().int(), run: z.number().int() }).strict(), outletElevation: q('mm', z.number().int()), arrivalElevation: exact('mm'),
    stacks: z.array(z.object({ point: plan, levelIds: z.array(EntityIdSchema).min(2) }).strict()).max(64) }).strict().nullable(),
  airflow: z.object({ total: exact('m3/s').nullable(), segments: z.array(z.object({ from: point3, to: point3, flow: exact('m3/s').nullable(), velocity: exact('m/s').nullable() }).strict()) }).strict().nullable(),
}).strict();
export type NetworkResult = z.infer<typeof NetworkResultSchema>;
export const PenetrationSchema = z.object({ id: sid, networkId: sid, host: z.object({ collection: z.enum(['walls', 'slabs']), id: EntityIdSchema }).strict(), location: point3,
  sizeMm: z.object({ width: z.number().int().nonnegative(), height: z.number().int().nonnegative(), clearance: z.number().int().nonnegative().nullable() }).strict(),
  review: z.literal('REVIEW_REQUIRED') }).strict();
export type Penetration = z.infer<typeof PenetrationSchema>;
export const CLASH_TYPES = ['MEP_ARCHITECTURE_CLASH', 'MEP_STRUCTURE_CLASH', 'PLUMBING_ELECTRICAL_CLEARANCE', 'DUCT_PIPE_CLEARANCE', 'DUCT_ELECTRICAL_CLEARANCE', 'SERVICE_CLEARANCE',
  'VERTICAL_TRANSPORT_CLASH', 'EGRESS_OBSTRUCTION', 'SHAFT_CONFLICT'] as const;
export const ClashSchema = z.object({ id: sid, type: z.enum(CLASH_TYPES), disciplineA: z.string().max(40), disciplineB: z.string().max(40),
  entityA: z.string().max(200), entityB: z.string().max(200), bounds: box, severity: z.enum(['BLOCKING', 'REVIEW_REQUIRED', 'INFORMATIONAL']),
  basis: z.enum(['PHYSICAL_INTERSECTION', 'WITHIN_EXPLICIT_CLEARANCE']), evidence: z.object({ overlapX: finite(), overlapY: finite(), overlapZ: finite() }).strict(), resolution: z.literal('UNRESOLVED') }).strict();
export type Clash = z.infer<typeof ClashSchema>;
const loadSum = z.object({ W: exact('W'), VA: exact('VA'), combined: z.union([exact('W'), exact('VA')]).nullable(), combinedStatus: z.enum(['EVALUATED', 'NOT_EVALUATED_MIXED_W_AND_VA']) }).strict();
const demand = z.object({ status: z.enum(['EVALUATED', 'NOT_EVALUATED']), reason, W: exact('W').nullable(), VA: exact('VA').nullable() }).strict();
const via = z.object({ kind: z.enum(['OPENING', 'STAIR']), id: EntityIdSchema }).strict();
const egressSpace = z.object({ spaceId: EntityIdSchema, levelId: EntityIdSchema, reachable: z.boolean(), mostRemotePoint2: plan.nullable(), distance: q('mm', finite().nonnegative()).nullable(),
  exitOpeningId: EntityIdSchema.nullable(), via: z.array(via).max(512), levelTransitions: z.number().int().nonnegative(),
  disjointExitRoutes: z.number().int().nonnegative(), distinctExitsReachable: z.number().int().nonnegative() }).strict();
const engineering = z.object({ status: z.enum(['USER_PROVIDED', 'NOT_SPECIFIED']), value: z.unknown() }).strict();
export const ResultsSchema = z.object({
  networks: z.array(NetworkResultSchema).max(SYSTEMS_LIMITS.networks + SYSTEMS_LIMITS.circuits),
  plumbing: z.object({ status, reason, version: z.literal(SUBMODELS.plumbing), fixtures: z.number().int().nonnegative(), fixturesConnected: z.number().int().nonnegative(),
    notEvaluated: z.array(z.enum(NOT_EVALUATED.plumbing)) }).strict(),
  electrical: z.object({ status, reason, version: z.literal(SUBMODELS.electrical),
    supply: z.object({ status: z.enum(['SPECIFIED', 'INPUT_INCOMPLETE', 'NOT_EVALUATED']), missing: z.array(z.string().max(40)).max(8) }).strict(),
    circuits: z.array(z.object({ key, panel: key, loads: z.number().int().nonnegative(), connected: loadSum, demand }).strict()).max(SYSTEMS_LIMITS.circuits),
    panels: z.array(z.object({ key, circuits: z.number().int().nonnegative(), connected: loadSum, demand }).strict()).max(SYSTEMS_LIMITS.panels),
    total: z.object({ connected: loadSum, demand }).strict().nullable(), notEvaluated: z.array(z.enum(NOT_EVALUATED.electrical)) }).strict(),
  hvac: z.object({ status, reason, version: z.literal(SUBMODELS.hvac),
    referenceInputs: z.object({ environmental: z.object({ analysisId: uuid, inputHash: hash, role: z.literal('ENVELOPE_TRANSMISSION_COMPONENT'), isDesignLoad: z.literal(false),
      cases: z.array(z.object({ key, envelopeTransmission: q('W'), status: z.string().max(40) }).strict()).max(8) }).strict().nullable() }).strict(),
    notEvaluated: z.array(z.enum(NOT_EVALUATED.hvac)) }).strict(),
  lifeSafety: z.object({ status, reason, version: z.literal(SUBMODELS.lifeSafety), convention: z.literal(SUBMODELS.egress),
    exits: z.array(EntityIdSchema), spaces: z.array(egressSpace).max(4096), unreachableSpaceIds: z.array(EntityIdSchema), egressAvailable: z.boolean().nullable(),
    longest: z.object({ spaceId: EntityIdSchema, distance: q('mm', finite()) }).strict().nullable(),
    deadEnds: z.array(z.object({ spaceId: EntityIdSchema, metric: z.literal('GEOMETRIC_DEAD_END_LENGTH'), length: q('mm', finite().nonnegative()), connection: via }).strict()).max(4096),
    widths: z.object({ openings: z.array(z.object({ openingId: EntityIdSchema, width: q('mm', z.number().int()) }).strict()), stairs: z.array(z.object({ stairId: EntityIdSchema, width: q('mm', z.number().int()) }).strict()) }).strict(),
    nodes: z.number().int().nonnegative(), notEvaluated: z.array(z.enum(NOT_EVALUATED.lifeSafety)) }).strict(),
  verticalTransport: z.object({ status, reason, version: z.literal(SUBMODELS.verticalTransport),
    elevators: z.array(z.object({ key, placement: z.enum(['FIXED', 'PLANNER_SELECTED']), status: z.enum(['PROPOSED', 'REJECTED']), reason, shaft: RectSchema.nullable(),
      servedLevelIds: z.array(EntityIdSchema), bottomY: z.number().int(), topY: z.number().int(),
      door: z.object({ side: z.enum(SIDES), widthMm: z.number().int(), point2: plan.nullable(), spaceIds: z.array(EntityIdSchema.nullable()) }).strict(),
      verticalAccess: z.enum(['VERTICAL_ACCESS_PATH_AVAILABLE', 'VERTICAL_ACCESS_PATH_NOT_AVAILABLE', 'NOT_EVALUATED']),
      overlappedSpaces: z.array(z.object({ spaceId: EntityIdSchema, area: q('mm2', z.number().int().positive()) }).strict()),
      crossedWallIds: z.array(EntityIdSchema), blockingClashIds: z.array(sid), structuralCheck: z.enum(['EVALUATED', 'NOT_EVALUATED']), architectureMutation: z.literal('NONE'),
      engineering: z.object({ cabin: engineering, pitDepth: engineering, overhead: engineering, ratedLoad: engineering, ratedSpeed: engineering }).strict(),
      candidatesEvaluated: z.number().int().nonnegative() }).strict()).max(SYSTEMS_LIMITS.elevators),
    notEvaluated: z.array(z.enum(NOT_EVALUATED.verticalTransport)) }).strict(),
  coordination: z.object({ status, version: z.literal(SUBMODELS.coordination), geometry: z.literal(SUBMODELS.clashGeometry),
    structuralClearance: z.enum(['EVALUATED', 'NOT_EVALUATED']), unevaluatedMemberIds: z.array(z.string().max(60)),
    clearance: z.object({ PLUMBING: z.enum(['EVALUATED', 'CLEARANCE_NOT_EVALUATED']), ELECTRICAL: z.enum(['EVALUATED', 'CLEARANCE_NOT_EVALUATED']),
      HVAC: z.enum(['EVALUATED', 'CLEARANCE_NOT_EVALUATED']) }).strict(),
    clashes: z.array(ClashSchema).max(10_000), penetrations: z.array(PenetrationSchema).max(10_000), blocking: z.number().int().nonnegative() }).strict(),
  quantities: z.object({ networks: z.array(z.object({ networkId: sid, system: z.enum(SYSTEMS), size: z.string().max(60).nullable(), length: q('mm', finite()) }).strict()),
    fixtures: z.number().int(), panels: z.number().int(), loads: z.number().int(), hvacTerminals: z.number().int(), hvacEquipment: z.number().int(), elevatorProposals: z.number().int(),
    costing: z.literal('NOT_EVALUATED') }).strict(),
}).strict();
export type SystemsResults = z.infer<typeof ResultsSchema>;
export const CalculatorIdentitySchema = z.object({ name: z.string().min(1).max(100), version: z.string().min(1).max(100), adapterVersion: z.literal(SYSTEMS_ADAPTER_VERSION) }).strict();
export const DiagnosticsSchema = z.array(z.object({ code: z.string().max(60), targetId: z.string().max(200).nullable(), message: z.string().max(300), severity: z.enum(['ERROR', 'WARNING', 'INFO']) }).strict()).max(200);
export const ModelValidationSchema = z.object({ validator: z.literal(MODEL_VALIDATOR), status: z.enum(['VALID', 'INVALID']), diagnostics: DiagnosticsSchema }).strict();
export type ModelValidation = z.infer<typeof ModelValidationSchema>;
export const ResultValidationSchema = z.object({ validator: z.literal(RESULT_VALIDATOR), status: z.enum(['VALID', 'INVALID']), diagnostics: DiagnosticsSchema,
  recomputed: z.object({ networks: z.number().int(), segments: z.number().int(), clashes: z.number().int(), egressSpaces: z.number().int() }).strict() }).strict();
export type ResultValidation = z.infer<typeof ResultValidationSchema>;
export const CalculatorRunSchema = CalculatorIdentitySchema.extend({ settings: z.record(z.union([z.string().max(100), z.number().finite()])), executionMs: z.number().finite().nonnegative() }).strict();
export const SnapshotSchema = z.object({ version: z.literal(SYSTEMS_ANALYSIS_VERSION), binding: SystemsBindingSchema, inputHash: hash, analysisInputHash: hash,
  input: SystemsInputSchema, model: SystemsModelSchema, calculator: CalculatorRunSchema, results: ResultsSchema,
  validation: z.object({ model: ModelValidationSchema, results: ResultValidationSchema }).strict(),
  status: z.object({ analysis: z.literal('ANALYZED'), validation: z.literal('VALIDATED') }).strict(), claims: ClaimsSchema, limitations: z.array(z.string().max(300)).max(16) }).strict();
export type SystemsSnapshot = z.infer<typeof SnapshotSchema>;

// ---------------------------------------------------------------- HTTP DTOs
export const SystemsSummarySchema = z.object({ id: uuid, projectRevisionId: uuid, acceptanceQaId: uuid, systemsModelVersion: z.literal(SYSTEMS_MODEL_VERSION),
  analysisVersion: z.literal(SYSTEMS_ANALYSIS_VERSION), modelHash: hash, inputHash: hash, analysisInputHash: hash, calculator: CalculatorIdentitySchema, status: z.literal('VALIDATED'),
  structuralAnalysisId: uuid.nullable(), environmentalAnalysisId: uuid.nullable(), createdAt: z.string().datetime({ offset: true }),
  counts: z.object({ networks: z.number().int().nonnegative(), terminals: z.number().int().nonnegative(), clashes: z.number().int().nonnegative(),
    penetrations: z.number().int().nonnegative(), elevators: z.number().int().nonnegative() }).strict() }).strict();
export const SystemsDetailSchema = SystemsSummarySchema.extend({ snapshot: SnapshotSchema });
export const SystemsCursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: uuid }).strict();
export const SystemsReadQuerySchema = z.object({ require: z.literal('current').optional() }).strict();
