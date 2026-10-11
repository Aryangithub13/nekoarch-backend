import { z } from 'zod';

export const SCENE_COMPILER_VERSION = 'scene-compiler-v1';
export const SCENE_MANIFEST_VERSION = 'scene-manifest-v1';
export const SCENE_VALIDATOR_VERSION = 'scene-validator-v1';
export const GLB_GENERATOR = `nekoarch-scene-compiler/${SCENE_COMPILER_VERSION}`;

/** Fixed from the Phase 29 benchmark (docs/phase29/phase29-report.md §Limits). */
export const SCENE_LIMITS = Object.freeze({
  objects: 2048, triangles: 200_000, vertices: 400_000, glbBytes: 16_777_216, manifestBytes: 2_097_152,
  navigationNodes: 512, extentMm: 800_000, compileDeadlineMs: 20_000,
});
/** Grid-snap tolerance for decoded float32 positions; the extent limit keeps the float32 bound (extent·2⁻²⁴) below it and far below the 0.25 mm half-grid. */
export const VALIDATOR_TOLERANCE_NM = 50_000;
export const float32ErrorBoundNm = (extentMm: number) => Math.ceil(extentMm * 1_000_000 / 2 ** 24);

export type SceneErrorCode = 'SCENE_INPUT_INVALID' | 'SCENE_INVALID_SOURCE' | 'SCENE_UNSUPPORTED_MODEL' | 'SCENE_SOURCE_MISMATCH'
  | 'SCENE_RESOURCE_LIMIT' | 'SCENE_VALIDATION_FAILED' | 'REVISION_NOT_ACCEPTED';
export class SceneError extends Error {
  constructor(readonly code: SceneErrorCode, message: string, readonly details: Record<string, string> = {}) { super(message); this.name = 'SceneError'; }
}

/** Fixed layer order; the frontend toggles layers, never geometry. */
export const LAYERS = ['EXTERIOR_SHELL', 'INTERIOR_WALLS', 'FLOORS', 'CEILINGS', 'ROOFS', 'STAIRS', 'DOORS', 'WINDOWS', 'ROOM_VOLUMES', 'SEMANTIC_HELPERS'] as const;
export type Layer = typeof LAYERS[number];
export const HIDDEN_BY_DEFAULT: readonly Layer[] = ['ROOM_VOLUMES', 'SEMANTIC_HELPERS'];

/** Modest PBR defaults; colours are integer thousandths. Every appearance is a visual placeholder. */
export const MATERIALS = [
  { id: 'exterior-wall', rgba: [835, 812, 776, 1000], roughness: 900, alphaMode: 'OPAQUE' },
  { id: 'interior-wall', rgba: [930, 925, 912, 1000], roughness: 900, alphaMode: 'OPAQUE' },
  { id: 'slab', rgba: [690, 690, 680, 1000], roughness: 950, alphaMode: 'OPAQUE' },
  { id: 'roof', rgba: [470, 480, 490, 1000], roughness: 950, alphaMode: 'OPAQUE' },
  { id: 'stair', rgba: [610, 600, 585, 1000], roughness: 900, alphaMode: 'OPAQUE' },
  { id: 'landing', rgba: [640, 630, 615, 1000], roughness: 900, alphaMode: 'OPAQUE' },
  { id: 'door-placeholder', rgba: [560, 420, 300, 1000], roughness: 700, alphaMode: 'OPAQUE' },
  { id: 'glass-placeholder', rgba: [600, 760, 860, 350], roughness: 100, alphaMode: 'BLEND' },
  { id: 'room-volume', rgba: [300, 560, 900, 120], roughness: 1000, alphaMode: 'BLEND' },
] as const;
export type MaterialId = typeof MATERIALS[number]['id'];

export const FIDELITY = ['FULL_GEOMETRY', 'SEMANTIC_ONLY', 'VISUAL_PLACEHOLDER', 'NOT_EVALUATED', 'UNSUPPORTED'] as const;
export const ROLES = ['wall', 'door-leaf', 'window-pane', 'wall-junction', 'slab', 'stair-flight', 'landing', 'room-volume'] as const;
export const CLAIMS = Object.freeze({ photorealism: 'NOT_CLAIMED', structuralCompliance: 'NOT_CLAIMED', fireCodeCompliance: 'NOT_CLAIMED',
  egress: 'NOT_CLAIMED', accessibility: 'NOT_CLAIMED', materialPerformance: 'NOT_CLAIMED', constructionReadiness: 'NOT_CLAIMED' });
export const OVERLAYS = Object.freeze(['structural', 'environmental', 'systems', 'knowledge'].map(kind => ({ kind, status: 'NOT_EVALUATED', reason: 'OVERLAY_NOT_IN_SCENE_V1' })));

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const int = z.number().int().safe();
const id = z.string().min(1).max(400);
const P3 = z.object({ x: int, y: int, z: int }).strict();
const Bounds = z.object({ min: P3, max: P3 }).strict();
export const SceneBindingSchema = z.object({ projectId: z.string().uuid(), revisionId: z.string().uuid(), modelHash: hash,
  generatorVersion: z.string().max(200).nullable(), parameterHash: hash.nullable() }).strict();
export type SceneBinding = z.infer<typeof SceneBindingSchema>;
export const SceneInputSchema = z.object({}).strict();

const ObjectSchema = z.object({ sceneObjectId: id, sourceEntityType: z.enum(['wall', 'opening', 'slab', 'stair', 'landing', 'space', 'junction']),
  sourceEntityId: id, bimElementId: z.string().max(200).nullable(), levelId: id, layer: z.enum(LAYERS), geometryRole: z.enum(ROLES),
  fidelity: z.enum(FIDELITY), material: z.string().max(40), specification: z.object({ id, name: z.string().max(200), material: z.string().max(200).nullable(), status: z.literal('ARCHITECTURAL_FACT') }).strict().nullable(),
  appearance: z.literal('VISUAL_PLACEHOLDER'), bounds: Bounds, primitives: int, triangles: int, vertices: int, note: z.string().max(300).nullable() }).strict();
const CameraSchema = z.object({ id, kind: z.enum(['overview', 'three-quarter', 'top-down', 'exterior-orbit', 'interior-roof-hidden', 'floor', 'room']),
  position: P3, target: P3, up: P3, verticalFovMilliDegrees: int, orbitRadiusMm: int.nullable(), visibleLevelIds: z.array(id), hiddenLayers: z.array(z.enum(LAYERS)),
  transition: z.object({ interpolation: z.literal('linear'), durationMs: int }).strict(), focusSourceEntityId: id.nullable() }).strict();
export const SceneManifestSchema = z.object({
  version: z.literal(SCENE_MANIFEST_VERSION), compilerVersion: z.literal(SCENE_COMPILER_VERSION), source: SceneBindingSchema, inputHash: hash,
  units: z.object({ manifest: z.literal('mm'), glb: z.literal('m'), glbMetresPerUnit: z.literal('1'), modelMillimetresPerGlbMetre: z.literal(1000) }).strict(),
  frame: z.object({ coordinateSystem: z.literal('x-right-y-up-z-depth'), gltfAxisMapping: z.literal('identity'), originMm: P3, rootTranslationIsOrigin: z.literal(true), vertexGridMm: z.literal('0.5') }).strict(),
  precision: z.object({ positionComponent: z.literal('float32'), maxLocalExtentMm: int, maxFloat32ErrorNm: int, validatorToleranceNm: int }).strict(),
  bounds: Bounds,
  levels: z.array(z.object({ levelId: id, bimElementId: z.string().max(200).nullable(), name: z.string().max(200), index: int, elevationMm: int, nodeName: id, bounds: Bounds.nullable() }).strict()),
  layers: z.array(z.object({ id: z.enum(LAYERS), visibleByDefault: z.boolean(), objects: int }).strict()),
  materials: z.array(z.object({ id: z.string(), rgbaThousandths: z.array(int).length(4), roughnessThousandths: int, alphaMode: z.enum(['OPAQUE', 'BLEND']), provenance: z.literal('VISUAL_PLACEHOLDER') }).strict()),
  objects: z.array(ObjectSchema),
  rooms: z.array(z.object({ spaceId: id, sceneObjectId: id, bimElementId: z.string().max(200).nullable(), levelId: id, name: z.string().max(200), classification: z.string().max(200),
    boundary: z.array(z.object({ x: int, z: int }).strict()), floorElevationMm: int, heightMm: int, interiorPoint: P3, areaMm2: z.string(), openingIds: z.array(id), connectedSpaceIds: z.array(id) }).strict()),
  navigation: z.object({ source: z.literal('blueprint-qa-circulation'), eyeHeightMm: int,
    nodes: z.array(z.object({ id, kind: z.enum(['room', 'opening', 'stair-bottom', 'stair-top']), sourceEntityId: id, levelId: id, position: P3 }).strict()),
    edges: z.array(z.object({ from: id, to: id, via: id, kind: z.enum(['door', 'passage', 'stair']), lengthMm: int }).strict()),
    claims: z.object({ egress: z.literal('NOT_CLAIMED'), accessibility: z.literal('NOT_CLAIMED'), collisionFreePath: z.literal('NOT_CLAIMED') }).strict() }).strict(),
  cameras: z.array(CameraSchema),
  coverage: z.array(z.object({ entityType: z.enum(['level', 'space', 'wall', 'opening', 'slab', 'void', 'stair', 'landing', 'column', 'site', 'dimension']), entityId: id,
    status: z.enum(FIDELITY), reason: z.string().max(300).nullable(), sceneObjectIds: z.array(id) }).strict()),
  overlays: z.array(z.object({ kind: z.string(), status: z.literal('NOT_EVALUATED'), reason: z.string() }).strict()),
  claims: z.object(Object.fromEntries(Object.keys(CLAIMS).map(k => [k, z.literal('NOT_CLAIMED')]))).strict(),
  limitations: z.array(z.string().max(400)),
  statistics: z.object({ objects: int, nodes: int, meshes: int, primitives: int, triangles: int, vertices: int, materials: int }).strict(),
  binary: z.object({ format: z.literal('glb'), mimeType: z.literal('model/gltf-binary'), sha256: hash, bytes: int }).strict(),
}).strict();
export type SceneManifest = z.infer<typeof SceneManifestSchema>;
export type SceneObject = z.infer<typeof ObjectSchema>;

export const SceneValidationSchema = z.object({ validatorVersion: z.literal(SCENE_VALIDATOR_VERSION), status: z.enum(['VALID', 'INVALID']),
  checks: int, failures: z.array(z.string().max(500)).max(50) }).strict();
export type SceneValidation = z.infer<typeof SceneValidationSchema>;
