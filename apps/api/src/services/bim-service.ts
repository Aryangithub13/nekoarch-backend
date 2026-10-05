import type { Repository } from '../lib/repository.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { ProjectRevisionDetailSchema } from '../contracts/projects.js';
import { modelHash } from '../lib/generation-identity.js';
import { ApiError } from '../lib/errors.js';
import { BimError } from '../bim/contracts.js';
import { digest } from '../bim/core.js';
import { projectBim } from '../bim/project.js';
import { validateBim } from '../bim/validate.js';
export async function readBim(repository: Repository, projectId: string, revisionId: string) {
  const revision = ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision',projectId,revisionId));
  if (revision.projectId !== projectId || revision.id !== revisionId) throw new ApiError(404,'REVISION_NOT_FOUND','Revision not found');
  const qa = revision.qaRuns.find(run => run.id === revision.qa.id);
  if (!qa || !['PASS','PASS_WITH_WARNINGS'].includes(qa.status) || !['PASS','PASS_WITH_WARNINGS'].includes(qa.report.status) || qa.report.inputStatus !== 'SCHEMA_VALID' || qa.report.summary.errors) throw new ApiError(422,'REVISION_NOT_ACCEPTED','Revision has no accepted QA evidence');
  try {
    const hash = modelHash(revision.model);
    if (revision.identity && revision.identity.modelHash !== hash) throw new BimError('BIM_SOURCE_MISMATCH','Stored revision identity differs from source');
    const binding = { projectId, revisionId, modelHash:hash, generatorVersion:revision.generatorVersion, generationId:revision.identity?.generationId ?? null,
      requirementsHash:revision.identity?.requirementsHash ?? null, parameterHash:revision.model.parametricArchitecture ? digest(revision.model.parametricArchitecture) : null };
    const model = projectBim(revision.model,binding), validation = validateBim(model,revision.model,binding);
    if (validation.status === 'INVALID') throw new BimError('BIM_INVALID_MODEL','Independent BIM validation rejected the projection');
    return { model, validation };
  } catch (error) { if (error instanceof BimError) throw new ApiError(422,error.code,error.message); throw error; }
}
