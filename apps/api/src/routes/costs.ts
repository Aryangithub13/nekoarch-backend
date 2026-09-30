import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { durableCommand } from '../lib/idempotency.js';
import { ConstructionRepository } from '../lib/construction-repository.js';
import { CostRepository } from '../lib/cost-repository.js';
import { COST_OPERATION,COST_COLLECTION,createCost } from '../services/cost-service.js';
import { PageQuerySchema,RevisionParamsSchema } from '../contracts/projects.js';
import { ConstructionParamsSchema } from '../contracts/construction.js';
import { CostDetailSchema,CostParamsSchema,CostRequestSchema } from '../contracts/costs.js';
export function costsRoutes(app:FastifyInstance,backend:Backend,env:Env){
  app.post(COST_OPERATION,{bodyLimit:Math.min(env.BODY_LIMIT_BYTES,70000)},async(request,reply)=>{
    const {userId,repository}=await requestContext(request,backend,true);
    const {projectId,revisionId,takeoffId,calculationId}=parseRequest(ConstructionParamsSchema,request.params);
    const input=parseRequest(CostRequestSchema,request.body);
    await new ConstructionRepository(repository).read(projectId,revisionId,takeoffId,calculationId);
    const result=CostDetailSchema.parse(await durableCommand(request,repository,{projectId,revisionId,takeoffId,calculationId,...input},context=>
      createCost(repository,userId!,projectId,revisionId,takeoffId,calculationId,input.rateBookId,input.costingPolicy,input.options,env.PROJECT_COMMIT_SECRET,context)));
    request.log.info({projectId,revisionId,takeoffId,calculationId,costEstimateId:result.id,engineVersion:result.engineVersion,rateBookId:result.rateBookId,rateBookVersion:result.rateBookVersion,currency:result.currency,coverage:result.coverage,lineCount:result.report.boqLines.length},'cost estimate created');
    return reply.code(201).send(result);
  });
  app.get(COST_COLLECTION,async request=>{const {repository}=await requestContext(request,backend,true);const {projectId,revisionId}=parseRequest(RevisionParamsSchema,request.params);return new CostRepository(repository).list(projectId,revisionId,parseRequest(PageQuerySchema,request.query));});
  app.get(`${COST_COLLECTION}/:costEstimateId`,async request=>{const {repository}=await requestContext(request,backend,true);const {projectId,revisionId,costEstimateId}=parseRequest(CostParamsSchema,request.params);return new CostRepository(repository).read(projectId,revisionId,costEstimateId);});
}
