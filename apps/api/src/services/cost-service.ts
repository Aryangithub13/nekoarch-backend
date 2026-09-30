import { calculateBoqCost,costHash,CostError,sampleRateBook,type BoqCostReport } from '@designflow/boq-cost';
import { ConstructionRepository } from '../lib/construction-repository.js';
import { CostRepository } from '../lib/cost-repository.js';
import type { Repository,IdempotencyContext } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { signProjectCommit } from './project-service.js';
export const COST_OPERATION='/api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations/:calculationId/cost-estimates';
export const COST_COLLECTION='/api/projects/:projectId/revisions/:revisionId/cost-estimates';
export function costInputFingerprint(revisionId:string,calculation:{id:string;inputFingerprint:string;report:unknown},report:BoqCostReport){
  return costHash({projectRevisionId:revisionId,constructionCalculationId:calculation.id,constructionInputFingerprint:calculation.inputFingerprint,
    constructionReportHash:costHash(calculation.report),engineVersion:report.engineVersion,rateBookHash:report.rateBookHash,costingPolicyHash:report.costingPolicyHash,options:report.options});
}
export async function createCost(repository:Repository,userId:string,projectId:string,revisionId:string,takeoffId:string,calculationId:string,
  rateBookId:string,policy:unknown,options:unknown,secret?:string,context?:IdempotencyContext){
  const calculation=await new ConstructionRepository(repository).read(projectId,revisionId,takeoffId,calculationId);
  if(!secret)throw new ApiError(503,'COST_UNAVAILABLE','Cost persistence is not configured');
  if(!['sample-inr-v1','sample-inr-v2'].includes(rateBookId))throw new ApiError(404,'RATE_BOOK_NOT_FOUND','Rate book not found');
  let report;try{report=calculateBoqCost(calculation.report,sampleRateBook(rateBookId==='sample-inr-v1'?'1':'2'),policy,options);}
  catch(error){if(error instanceof CostError)throw new ApiError(422,error.code,error.message);throw error;}
  const input={projectId,projectRevisionId:revisionId,takeoffId,constructionCalculationId:calculationId,acceptanceQaId:calculation.acceptanceQaId,
    constructionReportHash:costHash(calculation.report),inputFingerprint:costInputFingerprint(revisionId,calculation,report),reportHash:costHash(report),report};
  return new CostRepository(repository).write(input,signProjectCommit(secret,userId,COST_OPERATION,input,context),context);
}
