import { z } from 'zod';
import { SceneBindingSchema, SceneManifestSchema } from '../scene3d/contracts.js';

export const REVISION_OPERATION_VERSION = 'revision-operation-v1';
export const REVISION_INTENT_VERSION = 'revision-intent-v1';
export const APPEARANCE_VERSION = 'appearance-v1';
export const APPEARANCE_COMPILER_VERSION = 'appearance-compiler-v1';
export const APPEARANCE_MANIFEST_VERSION = 'appearance-scene-manifest-v1';
export const APPEARANCE_VALIDATOR_VERSION = 'revision-appearance-validator-v1';
export const REVISION_LIMITS = Object.freeze({ textChars: 2000, assignments: 8, activeOperationsPerProject: 5, operationsPerProjectPerHour: 60, expiryHours: 24 });

export type RevisionErrorCode = 'REVISION_INPUT_INVALID' | 'REVISION_SCOPE_INVALID' | 'REVISION_VALIDATION_FAILED';
export class RevisionError extends Error {
  constructor(readonly code: RevisionErrorCode, message: string) { super(message); this.name = 'RevisionError'; }
}

const id = z.string().min(1).max(200);
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const milli = z.number().int().min(0).max(1000);

/** Finish presets are visual appearance only: no product, glazing, thermal or structural meaning. Values are integer thousandths. */
export const PRESETS = Object.freeze({
  'glass-inspired-blue-grey': { label: 'Glass-inspired blue-grey (visual appearance only)', rgb: [330, 420, 500], roughness: 180, metallic: 600 },
  'dark-contemporary': { label: 'Dark contemporary', rgb: [180, 180, 185], roughness: 700, metallic: 0 },
  'warm-render': { label: 'Warm render', rgb: [880, 780, 640], roughness: 900, metallic: 0 },
  'light-stone': { label: 'Light stone', rgb: [900, 880, 840], roughness: 850, metallic: 0 },
} as const);
export type PresetId = keyof typeof PRESETS;
export const PresetIdSchema = z.enum(Object.keys(PRESETS) as [PresetId, ...PresetId[]]);
export const FACADES = ['NORTH', 'EAST', 'SOUTH', 'WEST'] as const;
export const FacadeSchema = z.enum(FACADES);
export type Facade = z.infer<typeof FacadeSchema>;

export const FinishSchema = z.object({ presetId: PresetIdSchema, rgbThousandths: z.array(milli).length(3).optional(),
  roughnessThousandths: milli.optional(), metallicThousandths: milli.optional() }).strict();
export const ExteriorWallsTargetSchema = z.object({ kind: z.literal('EXTERIOR_WALLS'),
  facades: z.array(FacadeSchema).min(1).max(4).transform(a => FACADES.filter(f => a.includes(f))),
  levelIds: z.array(id).min(1).max(16).transform(a => [...new Set(a)].sort()).nullable().default(null) }).strict();
export const AssignmentSchema = z.object({ target: ExteriorWallsTargetSchema, finish: FinishSchema }).strict();
export const AppearanceSchema = z.object({ version: z.literal(APPEARANCE_VERSION), assignments: z.array(AssignmentSchema).min(1).max(REVISION_LIMITS.assignments) }).strict();
export type Appearance = z.infer<typeof AppearanceSchema>;
export type Assignment = z.infer<typeof AssignmentSchema>;
export type Finish = z.infer<typeof FinishSchema>;

/** Effective PBR factors of a finish (preset plus bounded overrides); opaque by design: a wall is never rendered transparent. */
export const finishFactors = (f: Finish) => {
  const p = PRESETS[f.presetId];
  return { rgbaThousandths: [...(f.rgbThousandths ?? p.rgb), 1000], roughnessThousandths: f.roughnessThousandths ?? p.roughness, metallicThousandths: f.metallicThousandths ?? p.metallic };
};

export const PRESERVATION_SCOPES = ['BUILDING_GEOMETRY', 'FLOOR_PLANS', 'STRUCTURE', 'STAIRS', 'OPENINGS', 'WALLS', 'ROOMS', 'INTERIOR', 'BUILDING_DIMENSIONS', 'EXTERIOR_APPEARANCE', 'LEVEL'] as const;
export const ChangeClassSchema = z.enum(['EXTERIOR_APPEARANCE', 'INTERIOR_APPEARANCE', 'OPENING_GEOMETRY', 'WALL_GEOMETRY', 'ROOM_GEOMETRY', 'STRUCTURE', 'BUILDING_GEOMETRY', 'PHYSICAL_GLAZING', 'RESTORE']);
export type ChangeClass = z.infer<typeof ChangeClassSchema>;
export const PreservationSchema = z.object({ scope: z.enum(PRESERVATION_SCOPES), levelId: id.nullable().default(null) }).strict();

/** Structured operation (frontend composer, F26) — the same validation path as natural language. */
export const StructuredOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('APPEARANCE_MODIFY'), target: ExteriorWallsTargetSchema, finish: FinishSchema, preserve: z.array(PreservationSchema).max(16).default([]) }).strict(),
  z.object({ kind: z.literal('RESTORE'), sourceRevisionId: uuid }).strict(),
]);
export const PreflightRequestSchema = z.object({ baseRevisionId: uuid,
  request: z.union([z.object({ text: z.string().trim().min(1).max(REVISION_LIMITS.textChars) }).strict(), z.object({ operation: StructuredOperationSchema }).strict()]) }).strict();
export type PreflightRequest = z.infer<typeof PreflightRequestSchema>;

export const RevisionIntentSchema = z.object({ intentVersion: z.literal(REVISION_INTENT_VERSION), source: z.enum(['TEXT', 'STRUCTURED']), text: z.string().max(REVISION_LIMITS.textChars).nullable(),
  operation: z.enum(['APPEARANCE_MODIFY', 'RESTORE']).nullable(),
  appearance: z.object({ target: ExteriorWallsTargetSchema, finish: FinishSchema }).strict().nullable(),
  restore: z.object({ sourceRevisionId: uuid.nullable(), reference: z.string().max(100) }).strict().nullable(),
  requestedChanges: z.array(z.object({ changeClass: ChangeClassSchema, phrase: z.string().max(200) }).strict()).max(16),
  preservation: z.array(PreservationSchema.extend({ phrase: z.string().max(200) })).max(16),
  ambiguities: z.array(z.string().max(300)).max(8), unsupported: z.array(z.object({ code: z.string().max(80), message: z.string().max(300) }).strict()).max(8) }).strict();
export type RevisionIntent = z.infer<typeof RevisionIntentSchema>;

export const LockSchema = z.object({ scope: z.string().max(80), granularity: z.enum(['SEMANTIC_MODEL', 'GEOMETRY', 'DERIVED_ARTIFACT', 'EXACT_BYTES']),
  origin: z.enum(['SYSTEM', 'USER']), enforcement: z.string().max(300) }).strict();
export const ImpactSchema = z.object({ artifact: z.string().max(60), action: z.enum(['REGENERATE', 'REUSE_SOURCE_EQUIVALENT', 'INVALIDATED', 'NOT_AFFECTED', 'BLOCKED']),
  baseArtifactIds: z.array(uuid).max(20), reason: z.string().max(300) }).strict();
export const TargetElementSchema = z.object({ sceneObjectId: id, sourceEntityType: z.enum(['wall', 'junction']), sourceEntityId: id, bimElementId: z.string().max(200).nullable(),
  levelId: id, facade: FacadeSchema.nullable(), assignment: z.number().int().min(0).max(REVISION_LIMITS.assignments - 1) }).strict();
export type TargetElement = z.infer<typeof TargetElementSchema>;
export const PreflightStatusSchema = z.enum(['AWAITING_CONSENT', 'NEEDS_CLARIFICATION', 'UNSUPPORTED', 'BLOCKED_BY_LOCK']);
export const QuoteSchema = z.object({ execution: z.enum(['LOCAL_DETERMINISTIC', 'NONE']), externalProviders: z.array(z.string()).max(0), externalCostUsd: z.literal(0),
  dataTransfer: z.literal('NONE'), workers: z.number().int().min(0).max(1), deadlineMs: z.number().int().nonnegative(), maxArtifactBytes: z.number().int().nonnegative(),
  estimatedSceneObjects: z.number().int().nonnegative() }).strict();
export const CLAIMS = Object.freeze({ physicalGlazing: 'NOT_CLAIMED', materialPerformance: 'NOT_CLAIMED', thermal: 'NOT_CLAIMED', photorealism: 'NOT_CLAIMED' } as const);
const ClaimsSchema = z.object({ physicalGlazing: z.literal('NOT_CLAIMED'), materialPerformance: z.literal('NOT_CLAIMED'), thermal: z.literal('NOT_CLAIMED'), photorealism: z.literal('NOT_CLAIMED') }).strict();
export const PreflightSchema = z.object({ operationVersion: z.literal(REVISION_OPERATION_VERSION), status: PreflightStatusSchema, kind: z.enum(['APPEARANCE_MODIFY', 'RESTORE']).nullable(),
  base: z.object({ projectId: uuid, revisionId: uuid, revisionNumber: z.number().int().positive(), modelHash: hash, appearanceHash: hash.nullable() }).strict(),
  intent: RevisionIntentSchema, appearance: AppearanceSchema.nullable(), appearanceHash: hash.nullable(),
  restore: z.object({ sourceRevisionId: uuid, sourceRevisionNumber: z.number().int().positive(), modelHash: hash, modelEquivalent: z.boolean(), appearanceHash: hash.nullable() }).strict().nullable(),
  targets: z.array(TargetElementSchema).max(512), excluded: z.array(z.object({ elementId: id, reason: z.string().max(200) }).strict()).max(512),
  locks: z.array(LockSchema).max(32), impacts: z.array(ImpactSchema).max(24), verifications: z.array(z.string().max(200)).max(24),
  blockers: z.array(z.object({ code: z.string().max(80), message: z.string().max(300) }).strict()).max(16), questions: z.array(z.string().max(300)).max(8),
  quote: QuoteSchema, approvalRequired: z.literal(true), claims: ClaimsSchema }).strict();
export type Preflight = z.infer<typeof PreflightSchema>;

export const AppearanceMaterialSchema = z.object({ id: z.string().max(40), assignment: z.number().int().min(0).max(REVISION_LIMITS.assignments - 1), rgbaThousandths: z.array(milli).length(4),
  roughnessThousandths: milli, metallicThousandths: milli, alphaMode: z.literal('OPAQUE'), provenance: z.literal('APPEARANCE_VARIANT') }).strict();
/** Candidate artifact manifest: the unchanged Phase 29 base manifest plus an appearance layer. Nothing in `scene` is rewritten. */
export const AppearanceManifestSchema = z.object({ version: z.literal(APPEARANCE_MANIFEST_VERSION), compilerVersion: z.literal(APPEARANCE_COMPILER_VERSION),
  source: SceneBindingSchema, appearance: AppearanceSchema, appearanceHash: hash,
  baseScene: z.object({ manifestVersion: z.literal('scene-manifest-v1'), compilerVersion: z.literal('scene-compiler-v1'), inputHash: hash, glbSha256: hash, glbBytes: z.number().int().positive(), binChunkSha256: hash }).strict(),
  materials: z.array(AppearanceMaterialSchema).min(1).max(REVISION_LIMITS.assignments), targets: z.array(TargetElementSchema).min(1).max(512), scene: SceneManifestSchema, claims: ClaimsSchema,
  binary: z.object({ format: z.literal('glb'), mimeType: z.literal('model/gltf-binary'), sha256: hash, bytes: z.number().int().positive() }).strict() }).strict();
export type AppearanceManifest = z.infer<typeof AppearanceManifestSchema>;

export const RevisionValidationSchema = z.object({ validatorVersion: z.literal(APPEARANCE_VALIDATOR_VERSION), status: z.enum(['VALID', 'INVALID']), checks: z.number().int().nonnegative(),
  failures: z.array(z.string().max(300)).max(50), baseSceneValidation: z.object({ status: z.enum(['VALID', 'INVALID']), checks: z.number().int().nonnegative() }).strict(),
  geometryLock: z.object({ granularity: z.literal('EXACT_BYTES'), baseBinSha256: hash, candidateBinSha256: hash.nullable(), identical: z.boolean() }).strict(),
  changedObjects: z.number().int().nonnegative(), preservedObjects: z.number().int().nonnegative() }).strict();
export type RevisionValidation = z.infer<typeof RevisionValidationSchema>;

export const OPERATION_STATUSES = ['AWAITING_CONSENT', 'NEEDS_CLARIFICATION', 'UNSUPPORTED', 'BLOCKED_BY_LOCK', 'CANDIDATE_READY', 'COMMITTED', 'REJECTED', 'CANCELLED',
  'FAILED', 'VALIDATION_FAILED', 'STALE_BASE', 'EXPIRED'] as const;
export const ExecuteRequestSchema = z.object({ preflightHash: hash, consent: z.object({ acceptLocks: z.literal(true), acceptQuote: z.literal(true) }).strict() }).strict();
export const ApproveRequestSchema = z.object({ preflightHash: hash, candidateHash: hash }).strict();
export const EmptySchema = z.object({}).strict();

const factors = z.object({ rgbaThousandths: z.array(milli).length(4), roughnessThousandths: milli, metallicThousandths: milli, provenance: z.enum(['VISUAL_PLACEHOLDER', 'APPEARANCE_VARIANT']) }).strict();
const engineeringEntry = z.object({ artifact: z.string().max(60), freshness: z.enum(['SOURCE_EQUIVALENT', 'NOT_EVALUATED_NO_ARTIFACT', 'REGENERATE', 'INVALIDATED', 'BLOCKED']),
  artifactIds: z.array(uuid).max(20), recomputed: z.literal(false), newlyVerified: z.literal(false), reason: z.string().max(300) }).strict();
const comparisonCommon = { comparisonVersion: z.literal('revision-comparison-v1'), operationId: uuid, kind: z.enum(['APPEARANCE_MODIFY', 'RESTORE']).nullable(), status: z.enum(OPERATION_STATUSES),
  committedRevisionId: uuid.nullable(), base: z.object({ revisionId: uuid, revisionNumber: z.number().int().positive(), modelHash: hash, appearanceHash: hash.nullable() }).strict(),
  engineering: z.array(engineeringEntry).max(16), quantitiesAndCost: z.array(engineeringEntry).max(3), validation: z.record(z.unknown()).nullable(),
  approvalBlockers: z.array(z.object({ code: z.string().max(80), message: z.string().max(300) }).strict()).max(4), claims: ClaimsSchema, warnings: z.array(z.string().max(300)).max(4) };
/** Revision comparison (frontend F30 review workspace): appearance candidate, restore, or an operation without a candidate. */
export const RevisionComparisonSchema = z.union([
  z.object({ ...comparisonCommon,
    candidate: z.object({ candidateHash: hash.nullable(), artifactId: uuid, appearanceHash: hash, modelHash: hash, glbSha256: hash, acceptance: z.enum(['COMMITTED', 'CANDIDATE_PREVIEW_NOT_ACCEPTED']) }).strict(),
    allowedScopes: ExteriorWallsTargetSchema,
    changes: z.object({ changedObjects: z.array(TargetElementSchema).max(512), preservedObjectCount: z.number().int().nonnegative(), preservedSceneObjectIds: z.array(id).max(2048) }).strict(),
    hashes: z.object({ baseModelHash: hash, candidateModelHash: hash, modelIdentical: z.boolean(), baseBinChunkSha256: hash.nullable(), candidateBinChunkSha256: hash.nullable(),
      geometryIdentical: z.boolean(), baseGlbSha256: hash, candidateGlbSha256: hash }).strict(),
    materials: z.array(z.object({ assignment: z.number().int().min(0), presetId: PresetIdSchema, from: z.array(factors).max(REVISION_LIMITS.assignments), to: factors, objects: z.number().int().nonnegative() }).strict()).max(REVISION_LIMITS.assignments),
    visual: z.object({ candidateGlbHref: z.string().max(300), candidateManifestHref: z.string().max(300), baseSceneHref: z.string().max(300) }).strict() }).strict(),
  z.object({ ...comparisonCommon, candidate: z.object({ candidateHash: hash.nullable(), sourceRevisionId: uuid, modelHash: hash, appearanceHash: hash.nullable() }).strict(),
    changes: z.object({ modelIdentical: z.boolean(), appearanceChanged: z.boolean(), bimDiffHref: z.string().max(300).nullable() }).strict() }).strict(),
  z.object({ ...comparisonCommon, candidate: z.null(), changes: z.null() }).strict(),
]);
export type RevisionComparison = z.infer<typeof RevisionComparisonSchema>;
