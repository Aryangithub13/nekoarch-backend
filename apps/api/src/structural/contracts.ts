import { z } from 'zod';
import { EntityIdSchema, LabelSchema } from '@designflow/shared';
import { BIM_VERSION, BimBindingSchema } from '../bim/contracts.js';
import { STANDARD_GRAVITY } from './units.js';

export const STRUCTURAL_INPUT_VERSION = 'structural-input-v1';
export const STRUCTURAL_MODEL_VERSION = 'structural-model-v1';
export const STRUCTURAL_ANALYSIS_MODEL_VERSION = 'structural-analysis-model-v1';
export const STRUCTURAL_ANALYSIS_VERSION = 'structural-analysis-v1';
export const STRUCTURAL_ADAPTER_VERSION = 'structural-adapter-v1';
export const STRUCTURAL_LIMITS = { inputBytes: 524_288, materials: 32, sections: 64, members: 800, supports: 800, loadCases: 8, loadsPerCase: 1000,
  totalLoads: 2000, combinations: 16, terms: 8, segments: 4000, skylineEntries: 4_000_000, solverMs: 10_000, outputBytes: 9_000_000 } as const;
/** Distributed loads and self-weight are expanded onto every segment of their member, so this solver-neutral count is derived, not
 *  bounded by the public per-case limits. One source for the analysis-model schema and the preflight in buildStructuralModel. */
export const EXPANDED_MEMBER_LOADS = STRUCTURAL_LIMITS.totalLoads + STRUCTURAL_LIMITS.segments;
/** v1 checked equilibrium only; v2 adds constitutive compatibility, every station, crossings and full section/mass agreement. */
export const MODEL_VALIDATOR = 'structural-model-validator-v2', RESULT_VALIDATOR = 'structural-result-validator-v2';
export const STATIONS = [0, 0.25, 0.5, 0.75, 1] as const;
export const CLAIMS = { designVerification: 'NOT_EVALUATED', codeCompliance: 'NOT_CLAIMED', certification: 'NOT_CLAIMED', constructionSuitability: 'NOT_CLAIMED' } as const;
export const MODEL_ASSUMPTIONS = ['LINEAR_ELASTIC', 'SMALL_DISPLACEMENT', 'EULER_BERNOULLI_NO_SHEAR_DEFORMATION', 'RIGID_JOINTS', 'NO_RIGID_DIAPHRAGM',
  'SLABS_AND_WALL_PANELS_NOT_MODELLED', 'NO_SECOND_ORDER_EFFECTS'] as const;
export const MEMBER_ASSUMPTIONS = ['ANALYTICAL_AXIS_AT_WALL_CENTERLINE', 'ANALYTICAL_BEAM_LEVEL_AT_STOREY_TOP'] as const;
export const LIMITATIONS = [
  'Linear-static frame analysis only; no design, capacity, serviceability or code-compliance evaluation.',
  'Members exist only where explicitly mapped onto wall geometry; walls and slabs are not analysed as panels.',
  'All material, section, load, support and combination values are user provided; none are inferred from architectural labels.',
  'Internal forces are reported at quarter points of each analysis segment; extremes between stations are not reported.',
  'This analysis is preliminary engineering information. It is not certified, stamped, jurisdiction-approved or a statement that a structure is safe to build.',
] as const;

export type StructuralErrorCode = 'STRUCTURAL_MODEL_INVALID' | 'STRUCTURAL_MATERIAL_MISSING' | 'STRUCTURAL_LOAD_INVALID' | 'STRUCTURAL_SUPPORT_INVALID'
  | 'STRUCTURAL_SYSTEM_UNSTABLE' | 'STRUCTURAL_SYSTEM_DISCONNECTED' | 'STRUCTURAL_SOLVER_FAILED' | 'STRUCTURAL_ANALYSIS_TIMEOUT' | 'STRUCTURAL_RESULT_INVALID'
  | 'STRUCTURAL_RESULT_STALE' | 'STRUCTURAL_SOURCE_UNSUPPORTED' | 'STRUCTURAL_RESOURCE_LIMIT';
export class StructuralError extends Error {
  constructor(readonly code: StructuralErrorCode, message: string) { super(message); this.name = 'StructuralError'; }
}

const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sid = z.string().regex(/^str-[a-f0-9]{40}$/);
const quantity = <U extends string>(unit: U, min: number, max: number) => z.object({ value: z.number().finite().min(min).max(max), unit: z.literal(unit) }).strict();
const nonzero = <T extends z.ZodTypeAny>(schema: T) => schema.refine(q => q.value !== 0, 'Magnitude must be non-zero');
const end = z.enum(['start', 'end']);
const direction = z.enum(['GLOBAL_X', 'GLOBAL_Y', 'GLOBAL_Z']);
export const DOFS = ['UX', 'UY', 'UZ', 'RX', 'RY', 'RZ'] as const;
const dof = z.enum(DOFS);

// ---------------------------------------------------------------- explicit engineering input
export const MaterialInputSchema = z.object({ key, category: z.enum(['CONCRETE', 'STRUCTURAL_STEEL', 'MASONRY', 'TIMBER', 'UNKNOWN']), name: LabelSchema,
  elasticModulus: quantity('MPa', 1, 1_000_000).nullable(), poissonRatio: z.object({ value: z.number().finite().min(0).lt(0.5), unit: z.literal('1') }).strict().nullable(),
  density: quantity('kg/m3', 1, 30_000).nullable(), architecturalSpecificationId: EntityIdSchema.nullable().default(null) }).strict();
export const SectionInputSchema = z.discriminatedUnion('shape', [
  z.object({ key, shape: z.literal('RECTANGLE'), width: quantity('mm', 1, 10_000), depth: quantity('mm', 1, 10_000) }).strict(),
  z.object({ key, shape: z.literal('GENERIC'), area: quantity('mm2', 1, 1e8), iy: quantity('mm4', 1, 1e14), iz: quantity('mm4', 1, 1e14), j: quantity('mm4', 1, 1e14) }).strict(),
]);
export const MemberInputSchema = z.discriminatedUnion('rule', [
  z.object({ key, rule: z.literal('COLUMN_AT_WALL_END'), wallId: EntityIdSchema, end, material: key, section: key }).strict(),
  z.object({ key, rule: z.literal('BEAM_ALONG_WALL'), wallId: EntityIdSchema, material: key, section: key }).strict(),
]);
export const SupportInputSchema = z.object({ key, at: z.object({ member: key, end }).strict(), type: z.enum(['FIXED', 'PINNED', 'ROLLER', 'CUSTOM']),
  restraints: z.array(dof).min(1).max(6).optional() }).strict()
  .refine(s => (s.type === 'CUSTOM') === (s.restraints !== undefined), 'CUSTOM supports, and only CUSTOM supports, list restraints');
export const LoadInputSchema = z.discriminatedUnion('application', [
  z.object({ key, application: z.literal('POINT'), target: z.object({ member: key, end }).strict(), direction, magnitude: nonzero(quantity('kN', -1e5, 1e5)) }).strict(),
  z.object({ key, application: z.literal('MEMBER_DISTRIBUTED'), target: z.object({ member: key }).strict(), direction, magnitude: nonzero(quantity('kN/m', -1e4, 1e4)) }).strict(),
  z.object({ key, application: z.literal('AREA'), target: z.object({ panel: key }).strict(), direction, magnitude: nonzero(quantity('kPa', -1e3, 1e3)) }).strict(),
]);
export const LoadCaseInputSchema = z.object({ key, category: z.enum(['DEAD', 'LIVE', 'USER_DEFINED']), selfWeight: z.boolean().default(false),
  loads: z.array(LoadInputSchema).max(STRUCTURAL_LIMITS.loadsPerCase).default([]) }).strict();
export const CombinationInputSchema = z.object({ key, profile: z.literal('PROJECT_DEFINED'), terms: z.array(z.object({ loadCase: key,
  factor: z.number().finite().refine(f => f !== 0 && Math.abs(f) <= 10, 'Factor must be non-zero with magnitude at most 10') }).strict()).min(1).max(STRUCTURAL_LIMITS.terms) }).strict();
export const StructuralInputSchema = z.object({ version: z.literal(STRUCTURAL_INPUT_VERSION),
  materials: z.array(MaterialInputSchema).min(1).max(STRUCTURAL_LIMITS.materials), sections: z.array(SectionInputSchema).min(1).max(STRUCTURAL_LIMITS.sections),
  members: z.array(MemberInputSchema).min(1).max(STRUCTURAL_LIMITS.members), supports: z.array(SupportInputSchema).max(STRUCTURAL_LIMITS.supports).default([]),
  autoSupports: z.object({ rule: z.literal('BASE_OF_COLUMNS_AT_LOWEST_ELEVATION'), type: z.enum(['FIXED', 'PINNED']) }).strict().nullable().default(null),
  loadCases: z.array(LoadCaseInputSchema).min(1).max(STRUCTURAL_LIMITS.loadCases), combinations: z.array(CombinationInputSchema).max(STRUCTURAL_LIMITS.combinations).default([]),
}).strict().refine(i => i.loadCases.reduce((n, c) => n + c.loads.length, 0) <= STRUCTURAL_LIMITS.totalLoads, 'Too many loads');
export type StructuralInput = z.infer<typeof StructuralInputSchema>;

// ---------------------------------------------------------------- semantic model
const exact = <U extends string>(unit: U) => z.object({ value: z.number().finite(), unit: z.literal(unit) }).strict();
const engineering = <U extends string>(unit: U) => z.union([
  z.object({ value: z.number().finite(), unit: z.literal(unit), provenance: z.literal('USER_PROVIDED') }).strict(),
  z.object({ value: z.null(), unit: z.literal(unit), provenance: z.literal('NOT_SPECIFIED') }).strict(),
]);
const sectionProperty = <U extends string>(unit: U) => z.object({ value: z.number().finite().positive(), unit: z.literal(unit),
  provenance: z.enum(['DERIVED_FROM_SECTION_DIMENSIONS', 'USER_PROVIDED']), method: z.enum(['exact-rectangle', 'roark-rectangle-torsion-approx']).nullable() }).strict();
const coordinate = z.number().int().min(-100_000_000).max(100_000_000);
export const StructuralBindingSchema = BimBindingSchema.extend({ bimVersion: z.literal(BIM_VERSION), structuralModelVersion: z.literal(STRUCTURAL_MODEL_VERSION) }).strict();
export type StructuralBinding = z.infer<typeof StructuralBindingSchema>;
export const StructuralModelSchema = z.object({
  version: z.literal(STRUCTURAL_MODEL_VERSION), units: z.object({ length: z.literal('mm') }).strict(), coordinateSystem: z.literal('x-right-y-up-z-depth'),
  binding: StructuralBindingSchema,
  nodes: z.array(z.object({ id: sid, coordinates: z.object({ x: coordinate, y: coordinate, z: coordinate, unit: z.literal('mm') }).strict(), levelId: EntityIdSchema.nullable(),
    source: z.object({ derivation: z.literal('MEMBER_ENDPOINT'), memberIds: z.array(sid).min(1) }).strict() }).strict()).max(STRUCTURAL_LIMITS.members * 2),
  members: z.array(z.object({ id: sid, requestKey: key, kind: z.enum(['COLUMN', 'BEAM']), startNodeId: sid, endNodeId: sid, materialId: sid, sectionId: sid,
    orientation: z.literal('REFERENCE_VECTOR_V1'), levelId: EntityIdSchema,
    source: z.object({ collection: z.literal('walls'), wallId: EntityIdSchema, end: end.nullable(), bimElementId: z.string().regex(/^bim-[a-f0-9]{40}$/) }).strict(),
    mapping: z.object({ rule: z.enum(['COLUMN_AT_WALL_END', 'BEAM_ALONG_WALL']), ruleVersion: z.literal(1), provenance: z.literal('EXPLICIT_USER_MAPPING'),
      assumptionStatus: z.literal('ASSUMED'), assumptions: z.array(z.enum(MEMBER_ASSUMPTIONS)) }).strict(),
    quantities: z.object({ length: exact('mm'), sectionArea: exact('mm2'), volume: exact('m3'),
      mass: z.object({ value: z.number().finite().nullable(), unit: z.literal('kg'), status: z.enum(['EVALUATED', 'NOT_EVALUATED']) }).strict() }).strict(),
    segmentIds: z.array(sid).min(1) }).strict()).max(STRUCTURAL_LIMITS.members),
  segments: z.array(z.object({ id: sid, memberId: sid, startNodeId: sid, endNodeId: sid, length: exact('mm') }).strict()).max(STRUCTURAL_LIMITS.segments),
  materials: z.array(z.object({ id: sid, requestKey: key, category: MaterialInputSchema.shape.category, name: LabelSchema,
    elasticModulus: engineering('MPa'), poissonRatio: engineering('1'), density: engineering('kg/m3'),
    architecturalSpecificationId: EntityIdSchema.nullable(), bimMaterialId: z.string().regex(/^bim-[a-f0-9]{40}$/).nullable() }).strict()).max(STRUCTURAL_LIMITS.materials),
  sections: z.array(z.object({ id: sid, requestKey: key, shape: z.enum(['RECTANGLE', 'GENERIC']), dimensions: z.object({ width: exact('mm'), depth: exact('mm') }).strict().nullable(),
    area: sectionProperty('mm2'), iy: sectionProperty('mm4'), iz: sectionProperty('mm4'), j: sectionProperty('mm4') }).strict()).max(STRUCTURAL_LIMITS.sections),
  supports: z.array(z.object({ id: sid, requestKey: key.nullable(), nodeId: sid, type: z.enum(['FIXED', 'PINNED', 'ROLLER', 'CUSTOM']),
    restraints: z.object({ UX: z.boolean(), UY: z.boolean(), UZ: z.boolean(), RX: z.boolean(), RY: z.boolean(), RZ: z.boolean() }).strict(),
    provenance: z.enum(['USER_PROVIDED', 'ASSUMED']), rule: z.literal('BASE_OF_COLUMNS_AT_LOWEST_ELEVATION').nullable() }).strict()).max(STRUCTURAL_LIMITS.supports * 2),
  loadCases: z.array(z.object({ id: sid, requestKey: key, category: z.enum(['DEAD', 'LIVE', 'USER_DEFINED']), selfWeight: z.enum(['INCLUDED', 'NOT_REQUESTED']),
    source: z.literal('USER_PROVIDED'), version: z.literal(1),
    loads: z.array(z.discriminatedUnion('application', [
      z.object({ id: sid, requestKey: key, application: z.literal('POINT'), nodeId: sid, memberId: sid, direction, magnitude: exact('kN'), provenance: z.literal('USER_PROVIDED') }).strict(),
      z.object({ id: sid, requestKey: key, application: z.literal('MEMBER_DISTRIBUTED'), memberId: sid, direction, magnitude: exact('kN/m'), provenance: z.literal('USER_PROVIDED') }).strict(),
    ])).max(STRUCTURAL_LIMITS.loadsPerCase) }).strict()).max(STRUCTURAL_LIMITS.loadCases),
  combinations: z.array(z.object({ id: sid, requestKey: key, profile: z.literal('PROJECT_DEFINED'), codeCompliance: z.literal('NOT_CLAIMED'), method: z.literal('LINEAR_SUPERPOSITION'),
    terms: z.array(z.object({ loadCaseId: sid, factor: z.number().finite(), provenance: z.literal('USER_PROVIDED') }).strict()).min(1).max(STRUCTURAL_LIMITS.terms) }).strict()).max(STRUCTURAL_LIMITS.combinations),
  constants: z.object({ gravity: z.object({ value: z.literal(STANDARD_GRAVITY.value), unit: z.literal('m/s2'), provenance: z.literal(STANDARD_GRAVITY.provenance), direction: z.literal('GLOBAL_-Y') }).strict() }).strict(),
  assumptions: z.array(z.enum(MODEL_ASSUMPTIONS)),
  topology: z.object({ components: z.number().int().positive(), danglingNodeIds: z.array(sid), splitMemberIds: z.array(sid) }).strict(),
  claims: z.object({ designVerification: z.literal('NOT_EVALUATED'), codeCompliance: z.literal('NOT_CLAIMED'), certification: z.literal('NOT_CLAIMED'), constructionSuitability: z.literal('NOT_CLAIMED') }).strict(),
}).strict();
export type StructuralModel = z.infer<typeof StructuralModelSchema>;

// ---------------------------------------------------------------- solver-neutral analysis model
const vector3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const ref = z.string().min(1).max(64);
export const AnalysisModelSchema = z.object({
  version: z.literal(STRUCTURAL_ANALYSIS_MODEL_VERSION), analysisType: z.literal('LINEAR_STATIC'), formulation: z.literal('EULER_BERNOULLI_3D_FRAME'), joints: z.literal('RIGID'),
  units: z.object({ length: z.literal('mm'), force: z.literal('N'), moment: z.literal('N*mm'), stress: z.literal('MPa'), rotation: z.literal('rad'), lineLoad: z.literal('N/mm') }).strict(),
  localAxes: z.literal('REFERENCE_VECTOR_V1'),
  nodes: z.array(z.object({ id: ref, x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }).strict()).min(2).max(STRUCTURAL_LIMITS.segments + 1),
  members: z.array(z.object({ id: ref, nodeI: ref, nodeJ: ref, E: z.number().finite().positive(), G: z.number().finite().positive(), A: z.number().finite().positive(),
    Iy: z.number().finite().positive(), Iz: z.number().finite().positive(), J: z.number().finite().positive() }).strict()).min(1).max(STRUCTURAL_LIMITS.segments),
  restraints: z.array(z.object({ nodeId: ref, dofs: z.tuple([z.boolean(), z.boolean(), z.boolean(), z.boolean(), z.boolean(), z.boolean()]) }).strict()).min(1),
  loadCases: z.array(z.object({ id: ref,
    nodalLoads: z.array(z.object({ nodeId: ref, force: vector3 }).strict()).max(STRUCTURAL_LIMITS.totalLoads),
    memberLoads: z.array(z.object({ memberId: ref, w: vector3 }).strict()).max(EXPANDED_MEMBER_LOADS) }).strict()).min(1).max(STRUCTURAL_LIMITS.loadCases),
}).strict();
export type AnalysisModel = z.infer<typeof AnalysisModelSchema>;

// ---------------------------------------------------------------- results and snapshot
const finite = z.number().finite();
export const ResultSetSchema = z.object({ id: sid, kind: z.enum(['LOAD_CASE', 'COMBINATION']),
  displacements: z.array(z.object({ nodeId: sid, ux: finite, uy: finite, uz: finite, rx: finite, ry: finite, rz: finite }).strict()),
  reactions: z.array(z.object({ nodeId: sid, fx: finite, fy: finite, fz: finite, mx: finite, my: finite, mz: finite }).strict()),
  memberForces: z.array(z.object({ segmentId: sid, memberId: sid,
    stations: z.array(z.object({ position: z.number().min(0).max(1), n: finite, vy: finite, vz: finite, t: finite, my: finite, mz: finite }).strict()).length(STATIONS.length) }).strict()),
}).strict();
export type ResultSet = z.infer<typeof ResultSetSchema>;
export const RESULT_UNITS = { displacement: 'mm', rotation: 'rad', force: 'kN', moment: 'kN*m', position: 'fraction-of-segment-length' } as const;
export const ResultsSchema = z.object({ units: z.object({ displacement: z.literal('mm'), rotation: z.literal('rad'), force: z.literal('kN'), moment: z.literal('kN*m'), position: z.literal('fraction-of-segment-length') }).strict(),
  memberForceConvention: z.literal('LOCAL_AXES_POSITIVE_CUT_FACE'), sets: z.array(ResultSetSchema).min(1).max(STRUCTURAL_LIMITS.loadCases + STRUCTURAL_LIMITS.combinations) }).strict();
export type StructuralResults = z.infer<typeof ResultsSchema>;
export const SolverIdentitySchema = z.object({ name: z.string().min(1).max(100), version: z.string().min(1).max(100), adapterVersion: z.literal(STRUCTURAL_ADAPTER_VERSION) }).strict();
export const DiagnosticsSchema = z.array(z.object({ code: z.string().max(60), targetId: z.string().max(80).nullable(), message: z.string().max(300), severity: z.enum(['ERROR', 'WARNING', 'INFO']) }).strict()).max(200);
// Historical snapshots keep the validator that certified them; new ones are written with v2 only.
export const ModelValidationSchema = z.object({ validator: z.enum(['structural-model-validator-v1', MODEL_VALIDATOR]), status: z.enum(['VALID', 'INVALID']), diagnostics: DiagnosticsSchema }).strict();
export type ModelValidation = z.infer<typeof ModelValidationSchema>;
export const ResultValidationSchema = z.object({ validator: z.enum(['structural-result-validator-v1', RESULT_VALIDATOR]), status: z.enum(['VALID', 'INVALID']), diagnostics: DiagnosticsSchema,
  equilibrium: z.array(z.object({ setId: sid, forceResidual: exact('kN'), momentResidual: exact('kN*m'), forceTolerance: exact('kN'), momentTolerance: exact('kN*m') }).strict()) }).strict();
export type ResultValidation = z.infer<typeof ResultValidationSchema>;
const ClaimsSchema = z.object({ designVerification: z.literal('NOT_EVALUATED'), codeCompliance: z.literal('NOT_CLAIMED'), certification: z.literal('NOT_CLAIMED'), constructionSuitability: z.literal('NOT_CLAIMED') }).strict();
export const SnapshotSchema = z.object({ version: z.literal(STRUCTURAL_ANALYSIS_VERSION), binding: StructuralBindingSchema, inputHash: hash, analysisModelHash: hash,
  input: StructuralInputSchema, model: StructuralModelSchema,
  solver: SolverIdentitySchema.extend({ settings: z.record(z.union([z.string().max(100), z.number().finite()])), executionMs: z.number().finite().nonnegative(), warnings: z.array(z.string().max(300)).max(50) }).strict(),
  results: ResultsSchema, validation: z.object({ model: ModelValidationSchema, results: ResultValidationSchema }).strict(),
  status: z.object({ analysis: z.literal('ANALYZED'), validation: z.literal('VALIDATED') }).strict(),
  claims: ClaimsSchema, limitations: z.array(z.string().max(300)).max(16) }).strict();
export type StructuralSnapshot = z.infer<typeof SnapshotSchema>;

// ---------------------------------------------------------------- HTTP DTOs
const uuid = z.string().uuid();
export const StructuralSummarySchema = z.object({ id: uuid, projectRevisionId: uuid, acceptanceQaId: uuid, structuralModelVersion: z.literal(STRUCTURAL_MODEL_VERSION),
  analysisVersion: z.literal(STRUCTURAL_ANALYSIS_VERSION), modelHash: hash, inputHash: hash, analysisModelHash: hash, solver: SolverIdentitySchema, status: z.literal('VALIDATED'),
  createdAt: z.string().datetime({ offset: true }), counts: z.object({ nodes: z.number().int().nonnegative(), members: z.number().int().nonnegative(), segments: z.number().int().nonnegative(),
    loadCases: z.number().int().nonnegative(), combinations: z.number().int().nonnegative() }).strict() }).strict();
export const StructuralDetailSchema = StructuralSummarySchema.extend({ snapshot: SnapshotSchema });
export const CurrencySchema = z.object({ status: z.enum(['CURRENT', 'STALE']), analysisRevisionId: uuid, projectCurrentRevisionId: uuid.nullable() }).strict();
export const StructuralCursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: uuid }).strict();
export const StructuralReadQuerySchema = z.object({ require: z.literal('current').optional() }).strict();
