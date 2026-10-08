import { createHash } from 'node:crypto';
import type { Repository, IdempotencyContext } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { SceneRepository } from '../lib/scene-repository.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { ProjectRevisionDetailSchema } from '../contracts/projects.js';
import { modelHash } from '../lib/generation-identity.js';
import { costHash } from '@designflow/boq-cost';
import { signProjectCommit } from './project-service.js';
import { SCENE_COMPILER_VERSION, SCENE_LIMITS, SCENE_MANIFEST_VERSION, SceneError, SceneInputSchema, type SceneBinding } from '../scene3d/contracts.js';
import { ScenePoolError, type ScenePool, type SceneRun } from '../scene3d/pool.js';

export const SCENE_ROOT = '/api/projects/:projectId/revisions/:revisionId/scene';
export const SCENE_ARTIFACT_OPERATION = `${SCENE_ROOT}/artifacts`;

const STATUS: Record<SceneError['code'], number> = { SCENE_INPUT_INVALID: 400, SCENE_INVALID_SOURCE: 422, SCENE_UNSUPPORTED_MODEL: 422, SCENE_SOURCE_MISMATCH: 422,
  SCENE_RESOURCE_LIMIT: 422, SCENE_VALIDATION_FAILED: 422, REVISION_NOT_ACCEPTED: 422 };
export function sceneApiError(error: unknown): never {
  if (error instanceof SceneError) throw new ApiError(STATUS[error.code] ?? 422, error.code, error.message,
    Object.keys(error.details).length ? Object.fromEntries(Object.entries(error.details).map(([k, v]) => [k, [v]])) : undefined);
  // Capacity, timeout, crash, malformed or unvalidated worker output: nothing is stored.
  if (error instanceof ScenePoolError) throw new ApiError(503, error.code, error.message);
  throw error;
}
const currency = (artifactRevisionId: string, projectCurrentRevisionId: string | null) =>
  ({ status: artifactRevisionId === projectCurrentRevisionId ? 'CURRENT' as const : 'STALE' as const, artifactRevisionId, projectCurrentRevisionId });

/** Main-thread precheck: ownership, QA acceptance and the revision binding; the compile itself runs in the worker. */
async function readSource(repository: Repository, projectId: string, revisionId: string) {
  const revision = ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision', projectId, revisionId));
  if (revision.projectId !== projectId || revision.id !== revisionId) throw new ApiError(404, 'REVISION_NOT_FOUND', 'Revision not found');
  const qa = revision.qaRuns.find(run => run.id === revision.qa.id);
  if (!qa || !['PASS', 'PASS_WITH_WARNINGS'].includes(qa.status) || !['PASS', 'PASS_WITH_WARNINGS'].includes(qa.report.status) || qa.report.inputStatus !== 'SCHEMA_VALID' || qa.report.summary.errors)
    throw new ApiError(422, 'REVISION_NOT_ACCEPTED', 'Revision has no accepted QA evidence');
  const hash = modelHash(revision.model);
  if (revision.identity && revision.identity.modelHash !== hash) throw new ApiError(422, 'SCENE_SOURCE_MISMATCH', 'Stored revision identity differs from source');
  const binding: SceneBinding = { projectId, revisionId, modelHash: hash, generatorVersion: revision.generatorVersion,
    parameterHash: revision.model.parametricArchitecture ? costHash(revision.model.parametricArchitecture) : null };
  return { model: revision.model as unknown, binding, acceptanceQaId: revision.qa.id };
}
function precheckInput(input: unknown) {
  if (!SceneInputSchema.safeParse(input).success) throw new ApiError(400, 'SCENE_INPUT_INVALID', 'Scene compile input must be an empty object in V1');
}

/** Never compiles and never persists. */
export async function validateScene(repository: Repository, projectId: string, revisionId: string, input: unknown) {
  precheckInput(input);
  const { binding } = await readSource(repository, projectId, revisionId);
  return { readiness: 'READY' as const, compilerVersion: SCENE_COMPILER_VERSION, manifestVersion: SCENE_MANIFEST_VERSION, binding,
    inputHash: costHash({ compilerVersion: SCENE_COMPILER_VERSION, manifestVersion: SCENE_MANIFEST_VERSION, source: binding }), limits: SCENE_LIMITS,
    supportedProfile: 'phase23-bounded-orthogonal: at most 2 storeys, 28 spaces, 200 walls/openings, 32 slabs/voids, 1 straight stair, no columns; checked in the compile worker' };
}

export async function createSceneArtifact(repository: Repository, pool: ScenePool, userId: string, projectId: string, revisionId: string, input: unknown,
  secret?: string, context?: IdempotencyContext, onRun?: (run: Omit<SceneRun, 'manifest' | 'glb' | 'validation'>) => void) {
  if (!secret) throw new ApiError(503, 'SCENE_UNAVAILABLE', 'Scene persistence is not configured');
  precheckInput(input);
  const { model, binding, acceptanceQaId } = await readSource(repository, projectId, revisionId);
  let run: SceneRun;
  try { run = await pool.run({ model, binding }, input); } catch (error) { sceneApiError(error); }
  const { manifest, glb, validation, ...timing } = run;
  onRun?.(timing);
  // Defense in depth before persistence: the bytes must be exactly the ones the manifest names, for this binding.
  if (createHash('sha256').update(glb).digest('hex') !== manifest.binary.sha256 || JSON.stringify(manifest.source) !== JSON.stringify(binding))
    throw new ApiError(503, 'SCENE_WORKER_FAILED', 'The scene worker returned an inconsistent artifact');
  const { binary: _binary, ...semantic } = manifest;
  const write = { projectId, projectRevisionId: revisionId, acceptanceQaId, sceneHash: costHash(semantic), manifest, validation };
  return new SceneRepository(repository).write(write, glb, signProjectCommit(secret, userId, SCENE_ARTIFACT_OPERATION, write, context), context);
}

export async function readSceneArtifact(repository: Repository, projectId: string, revisionId: string, artifactId: string, requireCurrent: boolean) {
  const { detail, projectCurrentRevisionId } = await new SceneRepository(repository).read(projectId, revisionId, artifactId);
  if (detail.projectRevisionId !== revisionId || detail.manifest.source.revisionId !== revisionId || detail.manifest.source.projectId !== projectId)
    throw new ApiError(404, 'SCENE_ARTIFACT_NOT_FOUND', 'Scene artifact not found');
  const c = currency(detail.projectRevisionId, projectCurrentRevisionId);
  if (requireCurrent && c.status !== 'CURRENT') throw new ApiError(409, 'SCENE_ARTIFACT_STALE', 'The scene artifact belongs to a superseded revision');
  return { ...detail, currency: c };
}

/** Bytes are re-hashed before they are served; a mismatch is an integrity failure, never a download. */
export async function readSceneBinary(repository: Repository, projectId: string, revisionId: string, artifactId: string, requireCurrent: boolean) {
  const { summary, glb, projectCurrentRevisionId } = await new SceneRepository(repository).binary(projectId, revisionId, artifactId);
  if (summary.projectRevisionId !== revisionId) throw new ApiError(404, 'SCENE_ARTIFACT_NOT_FOUND', 'Scene artifact not found');
  if (requireCurrent && summary.projectRevisionId !== projectCurrentRevisionId) throw new ApiError(409, 'SCENE_ARTIFACT_STALE', 'The scene artifact belongs to a superseded revision');
  if (glb.length !== summary.binaryBytes || createHash('sha256').update(glb).digest('hex') !== summary.binarySha256)
    throw new ApiError(500, 'SCENE_ARTIFACT_INTEGRITY', 'Scene binary integrity failure');
  return { summary, glb };
}

export async function listSceneArtifacts(repository: Repository, projectId: string, revisionId: string, query: { limit: number; cursor?: string | undefined }) {
  const { items, nextCursor, projectCurrentRevisionId } = await new SceneRepository(repository).list(projectId, revisionId, query);
  return { items: items.map(i => ({ ...i, currency: currency(i.projectRevisionId, projectCurrentRevisionId) })), nextCursor };
}

/** Artifacts are never reused across revisions: artifacts of any other revision are STALE for this one. */
export async function sceneStatus(repository: Repository, projectId: string, revisionId: string) {
  const s = await new SceneRepository(repository).status(projectId, revisionId);
  return { projectId, revisionId, revisionNumber: s.revisionNumber, projectCurrentRevisionId: s.projectCurrentRevisionId,
    revisionCurrency: revisionId === s.projectCurrentRevisionId ? 'CURRENT' as const : 'HISTORICAL' as const,
    sceneStatus: s.artifacts.length ? 'COMPILED' as const : 'NOT_COMPILED' as const,
    artifacts: s.artifacts.map(a => ({ ...a, currency: currency(a.projectRevisionId, s.projectCurrentRevisionId) })),
    staleArtifacts: s.otherRevisionArtifacts.map(a => ({ ...a, currency: { status: 'STALE' as const, artifactRevisionId: a.projectRevisionId, projectCurrentRevisionId: s.projectCurrentRevisionId },
      staleReason: 'BOUND_TO_A_DIFFERENT_REVISION' as const })) };
}
