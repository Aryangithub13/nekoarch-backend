import { calculateConstruction, ConstructionError } from '@designflow/construction-calculations';
import { ProjectRevisionDetailSchema } from '../contracts/projects.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { TakeoffRepository } from '../lib/takeoff-repository.js';
import { ConstructionRepository } from '../lib/construction-repository.js';
import type { Repository, IdempotencyContext } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { signProjectCommit } from './project-service.js';
import { takeoffFingerprint } from './takeoff-service.js';
export const CONSTRUCTION_OPERATION = '/api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations';
export function constructionFingerprint(revisionId: string, takeoff: {id:string; inputFingerprint:string; report:unknown}, report: ReturnType<typeof calculateConstruction>) {
  return takeoffFingerprint({ projectRevisionId:revisionId,takeoffId:takeoff.id,takeoffInputFingerprint:takeoff.inputFingerprint,
    takeoffReportHash:takeoffFingerprint(takeoff.report),engineVersion:report.engineVersion,recipePack:report.recipePack,
    specification:report.specification,options:report.options });
}
export async function createConstruction(repository: Repository, userId: string, projectId: string, revisionId: string, takeoffId: string,
  specification: unknown, options: unknown, secret?: string, context?: IdempotencyContext) {
  const revision = ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision',projectId,revisionId));
  const takeoff = await new TakeoffRepository(repository).read(projectId,revisionId,takeoffId);
  const acceptance = revision.qaRuns.find(q=>q.id===revision.qa.id);
  if (!acceptance || takeoff.acceptanceQaId!==acceptance.id || !['PASS','PASS_WITH_WARNINGS'].includes(acceptance.status)
    || acceptance.report.inputStatus!=='SCHEMA_VALID' || acceptance.report.summary.errors!==0 || !['PASS','PASS_WITH_WARNINGS'].includes(acceptance.report.status))
    throw new ApiError(422,'TAKEOFF_NOT_ACCEPTED','Takeoff has no accepted QA evidence');
  if (!secret) throw new ApiError(503,'CONSTRUCTION_UNAVAILABLE','Construction persistence is not configured');
  let report;
  try { report = calculateConstruction(takeoff.report,specification,options); }
  catch (error) { if (error instanceof ConstructionError) throw new ApiError(422,error.code,error.message); throw error; }
  const input = { projectId,projectRevisionId:revisionId,takeoffId,acceptanceQaId:acceptance.id,
    inputFingerprint:constructionFingerprint(revisionId,takeoff,report),report };
  return new ConstructionRepository(repository).write(input,signProjectCommit(secret,userId,CONSTRUCTION_OPERATION,input,context),context);
}
