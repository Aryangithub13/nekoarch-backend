import type { z } from 'zod';
import type { BuildingModelV2 } from '@designflow/shared';
import type { Repository } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { ProjectRevisionDetailSchema } from '../contracts/projects.js';
import { modelHash } from '../lib/generation-identity.js';
import { verifyModel } from '../verification/verify.js';
import { scopedDiff } from '../verification/diff.js';
import type { DeclaredLimitsSchema, DiffScopeSchema } from '../verification/contracts.js';

export const VERIFICATION_ROOT = '/api/projects/:projectId/revisions/:revisionId/verification';

/** Ownership is established by the revision read (RLS); a stored identity that disagrees with its model is refused, not verified. */
async function revision(repository: Repository, projectId: string, revisionId: string) {
  const detail = ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision', projectId, revisionId));
  if (detail.projectId !== projectId || detail.id !== revisionId) throw new ApiError(404, 'REVISION_NOT_FOUND', 'Revision not found');
  const model = detail.model as BuildingModelV2, hash = modelHash(model);
  if (detail.identity && detail.identity.modelHash !== hash) throw new ApiError(422, 'VERIFICATION_SOURCE_MISMATCH', 'Stored revision identity differs from its model');
  return { model, hash };
}

/** Derived on read: deterministic for (model, declared limits); nothing is stored. */
export async function verifyRevision(repository: Repository, projectId: string, revisionId: string, declaredLimits: z.infer<typeof DeclaredLimitsSchema> | null) {
  const { model, hash } = await revision(repository, projectId, revisionId);
  return verifyModel(model, { projectId, revisionId, modelHash: hash }, declaredLimits);
}

export async function diffRevisions(repository: Repository, projectId: string, revisionId: string, otherRevisionId: string, scope: z.infer<typeof DiffScopeSchema>) {
  const [base, other] = await Promise.all([revision(repository, projectId, revisionId), revision(repository, projectId, otherRevisionId)]);
  return scopedDiff(base.model, other.model, { projectId, baseRevisionId: revisionId, otherRevisionId, baseModelHash: base.hash, otherModelHash: other.hash }, scope);
}
