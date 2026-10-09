import { randomUUID } from 'node:crypto';
import { costHash } from '@designflow/boq-cost';
import type { IdempotencyContext, Repository } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { RevisionRepository, type OperationDetail } from '../lib/revision-repository.js';
import { GENERATION_IDENTITY_VERSION, modelHash } from '../lib/generation-identity.js';
import { ProjectDetailSchema, ProjectRevisionDetailSchema, RevisionListSchema } from '../contracts/projects.js';
import { MATERIALS } from '../scene3d/contracts.js';
import { buildIntent, planRevision, type PlanContext } from '../revision/plan.js';
import { CLAIMS, RevisionComparisonSchema, finishFactors, type Appearance, type PreflightRequest, type RevisionComparison } from '../revision/contracts.js';
import { AppearancePoolError, AppearanceRefusal, type AppearancePool } from '../revision/pool.js';
import { assertAccepted } from '../workflows/sources.js';
import { projectOverview } from './overview-service.js';
import { signProjectCommit, storedRevisionQaReport } from './project-service.js';

export const REVISION_ROOT = '/api/projects/:projectId/revision-operations';
export const REVISION_OPS = { preflight: REVISION_ROOT, execute: `${REVISION_ROOT}/:operationId/execute`, approve: `${REVISION_ROOT}/:operationId/approve`,
  reject: `${REVISION_ROOT}/:operationId/reject`, cancel: `${REVISION_ROOT}/:operationId/cancel` } as const;
type Revision = ReturnType<typeof ProjectRevisionDetailSchema.parse>;
const need = (secret?: string): string => { if (!secret) throw new ApiError(503, 'REVISION_UNAVAILABLE', 'Revision persistence is not configured'); return secret; };

async function revision(repository: Repository, projectId: string, revisionId: string) {
  return ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision', projectId, revisionId));
}
const planRevisionOf = (r: Revision) => ({ id: r.id, revisionNumber: r.revisionNumber, parentRevisionId: r.parentRevisionId, model: r.model, generatorVersion: r.generatorVersion });

/** Everything the deterministic planner needs, read under the caller's RLS identity. Nothing is persisted. */
export async function planPreflight(repository: Repository, projectId: string, baseRevisionId: string, request: PreflightRequest['request']) {
  const base = await revision(repository, projectId, baseRevisionId), revisions = new RevisionRepository(repository);
  assertAccepted(base);
  const history = RevisionListSchema.parse(await new ProjectRepository(repository).list('history', { limit: 100 }, projectId)).items;
  const intent = buildIntent(request, planRevisionOf(base), history);
  let source: PlanContext['source'] = null;
  if (intent.operation === 'RESTORE' && intent.restore?.sourceRevisionId && history.some(h => h.id === intent.restore!.sourceRevisionId)) {
    const s = await revision(repository, projectId, intent.restore.sourceRevisionId);
    source = { ...planRevisionOf(s), appearance: (await revisions.appearance(projectId, s.id)).appearance, outputs: (await projectOverview(repository, projectId, s.id)).outputs };
  }
  const ctx: PlanContext = { projectId, base: planRevisionOf(base), baseAppearance: (await revisions.appearance(projectId, base.id)).appearance,
    baseOutputs: (await projectOverview(repository, projectId, base.id)).outputs, source };
  return planRevision(ctx, intent);
}

export async function createPreflight(repository: Repository, userId: string, projectId: string, body: PreflightRequest, secret?: string, context?: IdempotencyContext) {
  const key = need(secret), preflight = await planPreflight(repository, projectId, body.baseRevisionId, body.request);
  const input = { projectId, baseRevisionId: body.baseRevisionId, request: body.request, preflight, preflightHash: costHash(preflight) };
  return new RevisionRepository(repository).preflight(input, signProjectCommit(key, userId, REVISION_OPS.preflight, input, context), context);
}

const failure = (code: string, message: string) => ({ code: code.slice(0, 100), message: message.slice(0, 300) });

/** Consent + bounded execution. Compile and validation finish before any write; only a validated candidate is ever stored. */
export async function executeOperation(repository: Repository, pool: () => AppearancePool, userId: string, projectId: string, operationId: string,
  body: { preflightHash: string }, secret?: string, context?: IdempotencyContext) {
  const key = need(secret), revisions = new RevisionRepository(repository), op = await revisions.get(projectId, operationId);
  if (op.status === 'CANDIDATE_READY' && body.preflightHash === op.preflightHash) return op;
  const transition = (action: 'candidate' | 'fail', extra: Record<string, unknown>) => {
    const input = { projectId, operationId, preflightHash: body.preflightHash, ...extra }, ctx = action === 'candidate' ? context : undefined;
    return revisions.transition(action, input, signProjectCommit(key, userId, REVISION_OPS.execute, input, ctx), ctx);
  };
  if (op.status !== 'AWAITING_CONSENT') throw new ApiError(409, op.status === 'EXPIRED' ? 'REVISION_OPERATION_EXPIRED' : 'REVISION_OPERATION_INVALID_STATE', `The operation is ${op.status}`);
  if (body.preflightHash !== op.preflightHash) throw new ApiError(409, 'REVISION_CONSENT_MISMATCH', 'The consent does not match the stored preflight');
  const project = ProjectDetailSchema.parse(await new ProjectRepository(repository).read('get', projectId));
  // A moved base is recorded as STALE_BASE by SQL (and surfaces as 409) without compiling anything.
  if (project.currentRevisionId !== op.baseRevisionId) await transition('candidate', { candidateHash: '0'.repeat(64) });
  const pre = op.preflight;
  if (op.kind === 'RESTORE') {
    const r = pre.restore!;
    const validation = { status: 'VALID', validatorVersion: 'revision-restore-validator-v1', checks: 2, sourceRevisionId: r.sourceRevisionId, sourceModelHash: r.modelHash, sourceAppearanceHash: r.appearanceHash };
    return transition('candidate', { candidateHash: costHash(validation) });
  }
  const base = await revision(repository, projectId, op.baseRevisionId);
  assertAccepted(base);
  const hash = modelHash(base.model);
  if (base.identity && base.identity.modelHash !== hash) throw new ApiError(422, 'SCENE_SOURCE_MISMATCH', 'Stored revision identity differs from source');
  const binding = { projectId, revisionId: base.id, modelHash: hash, generatorVersion: base.generatorVersion, parameterHash: base.model.parametricArchitecture ? costHash(base.model.parametricArchitecture) : null };
  let run;
  try { run = await pool().run({ model: base.model, binding }, pre.appearance); }
  catch (error) {
    if (error instanceof AppearanceRefusal) {
      const validationFailure = ['SCENE_VALIDATION_FAILED', 'REVISION_VALIDATION_FAILED'].includes(error.code);
      await transition('fail', { status: validationFailure ? 'VALIDATION_FAILED' : 'FAILED', failure: failure(error.code, error.message) });
      throw new ApiError(422, validationFailure ? 'REVISION_VALIDATION_FAILED' : error.code, error.message);
    }
    if (error instanceof AppearancePoolError) {
      // Capacity and shutdown are retryable (the operation stays AWAITING_CONSENT); a crash or timeout is a recorded failure.
      if (error.code === 'REVISION_WORKER_TIMEOUT' || error.code === 'REVISION_WORKER_FAILED') await transition('fail', { status: 'FAILED', failure: failure(error.code, error.message) });
      throw new ApiError(503, error.code, error.message);
    }
    throw error;
  }
  return transition('candidate', { manifest: run.manifest, validation: run.validation, candidateHash: costHash(run.manifest), glbBase64: run.glb.toString('base64') });
}

/** Explicit approval: re-runs QA on the exact model that will be committed and commits atomically through project_write inside SQL. */
export async function approveOperation(repository: Repository, userId: string, projectId: string, operationId: string, body: { preflightHash: string; candidateHash: string },
  secret?: string, context?: IdempotencyContext) {
  const key = need(secret), revisions = new RevisionRepository(repository), op = await revisions.get(projectId, operationId);
  if (op.status === 'COMMITTED') throw new ApiError(409, 'REVISION_OPERATION_ALREADY_COMMITTED', 'The operation has already been committed');
  if (op.status !== 'CANDIDATE_READY') throw new ApiError(409, op.status === 'EXPIRED' ? 'REVISION_OPERATION_EXPIRED' : 'REVISION_OPERATION_INVALID_STATE', `The operation is ${op.status}`);
  const src = await revision(repository, projectId, op.kind === 'RESTORE' ? op.restoreSourceRevisionId! : op.baseRevisionId);
  const version = src.generatorVersion, normalized = src.normalizedRequirements ?? null;
  const report = storedRevisionQaReport(src.model, version, normalized);
  if (report.status === 'FAIL') throw new ApiError(422, 'BLUEPRINT_QA_FAILED', 'Independent blueprint QA rejected the revision');
  // Source provenance of the geometry is carried over; appearance provenance lives in the appearance layer and the operation audit.
  const generated = src.sourceMode === 'generated' && !!src.identity?.requirementsHash && !!normalized;
  const sourceMode = generated || (src.sourceMode === 'generated' && !src.identity) ? src.sourceMode : 'supplied';
  const identity = src.identity ? { identityVersion: GENERATION_IDENTITY_VERSION, generationId: generated ? randomUUID() : null, requirementsHash: generated ? src.identity.requirementsHash : null,
    modelHash: modelHash(src.model), seed: generated ? src.identity.seed : null } : null;
  const commit = { projectId, baseRevisionId: op.baseRevisionId, model: src.model, report, sourceMode, identity, normalizedRequirements: generated ? normalized : null,
    generatorVersion: sourceMode === 'generated' ? version : null };
  const commitSig = signProjectCommit(key, userId, sourceMode === 'generated' ? '/api/projects/:projectId/revisions/generate' : '/api/projects/:projectId/revisions', commit);
  const input = { projectId, operationId, preflightHash: body.preflightHash, candidateHash: body.candidateHash, commit, commitEnvelope: commitSig.envelope, commitSignature: commitSig.signature };
  return revisions.approve(input, signProjectCommit(key, userId, REVISION_OPS.approve, input, context), context);
}

export async function closeOperation(repository: Repository, userId: string, projectId: string, operationId: string, action: 'reject' | 'cancel', secret?: string, context?: IdempotencyContext) {
  const key = need(secret), input = { projectId, operationId };
  return new RevisionRepository(repository).transition(action, input, signProjectCommit(key, userId, REVISION_OPS[action], input, context), context);
}

const PLACEHOLDER = MATERIALS.find(m => m.id === 'exterior-wall')!;
/** Comparison for the frontend review workspace; every value is read from stored evidence, nothing is recomputed or estimated. */
export async function compareOperation(repository: Repository, projectId: string, operationId: string): Promise<RevisionComparison> {
  return RevisionComparisonSchema.parse(await comparison(repository, projectId, operationId));
}
async function comparison(repository: Repository, projectId: string, operationId: string) {
  const revisions = new RevisionRepository(repository), op: OperationDetail = await revisions.get(projectId, operationId), pre = op.preflight;
  const project = ProjectDetailSchema.parse(await new ProjectRepository(repository).read('get', projectId));
  const href = `/api/projects/${projectId}/revision-operations/${operationId}`;
  const blockers = [...(op.status !== 'CANDIDATE_READY' ? [{ code: 'NOT_A_READY_CANDIDATE', message: `The operation is ${op.status}.` }] : []),
    ...(project.currentRevisionId !== op.baseRevisionId && op.status !== 'COMMITTED' ? [{ code: 'BASE_NOT_CURRENT', message: 'The accepted base revision is no longer current.' }] : [])];
  const engineering = pre.impacts.filter(i => !['APPEARANCE_SCENE', 'APPEARANCE', 'BUILDING_MODEL', 'BLUEPRINT_QA', 'BIM', 'SCENE_3D'].includes(i.artifact))
    .map(i => ({ artifact: i.artifact, freshness: i.action === 'REUSE_SOURCE_EQUIVALENT' ? 'SOURCE_EQUIVALENT' : i.action === 'NOT_AFFECTED' ? 'NOT_EVALUATED_NO_ARTIFACT' : i.action,
      artifactIds: i.baseArtifactIds, recomputed: false, newlyVerified: false, reason: i.reason }));
  const common = { comparisonVersion: 'revision-comparison-v1' as const, operationId, kind: op.kind, status: op.status, committedRevisionId: op.committedRevisionId,
    base: { revisionId: op.baseRevisionId, revisionNumber: pre.base.revisionNumber, modelHash: pre.base.modelHash, appearanceHash: pre.base.appearanceHash },
    engineering, quantitiesAndCost: engineering.filter(e => ['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST'].includes(e.artifact)), validation: op.validation, approvalBlockers: blockers,
    claims: { ...CLAIMS } };
  if (op.kind === 'RESTORE') {
    const r = pre.restore!;
    return { ...common, candidate: { candidateHash: op.candidateHash, sourceRevisionId: r.sourceRevisionId, modelHash: r.modelHash, appearanceHash: r.appearanceHash },
      changes: { modelIdentical: r.modelEquivalent, appearanceChanged: r.appearanceHash !== pre.base.appearanceHash,
        bimDiffHref: r.modelEquivalent ? null : `/api/projects/${projectId}/revisions/${op.baseRevisionId}/bim/diff/${r.sourceRevisionId}` },
      warnings: r.modelEquivalent ? [] : ['Restoring replaces the model; geometry-dependent results of the current revision do not apply to the restored revision.'] };
  }
  if (!op.candidate) return { ...common, candidate: null, changes: null, warnings: [] };
  const { manifest } = await revisions.candidate(projectId, operationId), val = op.validation as { geometryLock?: { baseBinSha256: string; candidateBinSha256: string | null; identical: boolean } } | null;
  const targets = new Set(manifest.targets.map(t => t.sceneObjectId)), prior = (pre.base.appearanceHash ? manifest.appearance.assignments.slice(0, -1) : []) as Appearance['assignments'];
  return { ...common,
    candidate: { candidateHash: op.candidateHash, artifactId: op.candidate.id, appearanceHash: manifest.appearanceHash, modelHash: manifest.source.modelHash, glbSha256: manifest.binary.sha256,
      acceptance: op.status === 'COMMITTED' ? 'COMMITTED' : 'CANDIDATE_PREVIEW_NOT_ACCEPTED' },
    allowedScopes: pre.appearance!.assignments.at(-1)!.target,
    changes: { changedObjects: manifest.targets, preservedObjectCount: manifest.scene.objects.length - targets.size,
      preservedSceneObjectIds: manifest.scene.objects.filter(o => !targets.has(o.sceneObjectId)).map(o => o.sceneObjectId) },
    hashes: { baseModelHash: pre.base.modelHash, candidateModelHash: manifest.source.modelHash, modelIdentical: pre.base.modelHash === manifest.source.modelHash,
      baseBinChunkSha256: val?.geometryLock?.baseBinSha256 ?? null, candidateBinChunkSha256: val?.geometryLock?.candidateBinSha256 ?? null, geometryIdentical: val?.geometryLock?.identical === true,
      baseGlbSha256: manifest.baseScene.glbSha256, candidateGlbSha256: manifest.binary.sha256 },
    materials: manifest.materials.map(m => ({ assignment: m.assignment, presetId: manifest.appearance.assignments[m.assignment]!.finish.presetId,
      from: prior.length ? prior.map(a => ({ ...finishFactors(a.finish), provenance: 'APPEARANCE_VARIANT' }))
        : [{ rgbaThousandths: [...PLACEHOLDER.rgba], roughnessThousandths: PLACEHOLDER.roughness, metallicThousandths: 0, provenance: 'VISUAL_PLACEHOLDER' }],
      to: { rgbaThousandths: m.rgbaThousandths, roughnessThousandths: m.roughnessThousandths, metallicThousandths: m.metallicThousandths, provenance: m.provenance },
      objects: manifest.targets.filter(t => t.assignment === m.assignment).length })),
    visual: { candidateGlbHref: `${href}/candidate/glb`, candidateManifestHref: `${href}/candidate/manifest`, baseSceneHref: `/api/projects/${projectId}/revisions/${op.baseRevisionId}/scene` },
    warnings: ['The finish is a visual appearance variant only: no physical glazing, curtain wall, thermal, structural or product property is asserted.'] };
}
