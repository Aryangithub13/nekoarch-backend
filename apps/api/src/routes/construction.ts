import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { durableCommand } from '../lib/idempotency.js';
import { TakeoffRepository } from '../lib/takeoff-repository.js';
import { ConstructionRepository } from '../lib/construction-repository.js';
import { createConstruction, CONSTRUCTION_OPERATION } from '../services/construction-service.js';
import { PageQuerySchema } from '../contracts/projects.js';
import { TakeoffParamsSchema } from '../contracts/takeoffs.js';
import { ConstructionDetailSchema, ConstructionParamsSchema, ConstructionRequestSchema } from '../contracts/construction.js';
export function constructionRoutes(app: FastifyInstance, backend: Backend, env: Env) {
  app.post(CONSTRUCTION_OPERATION, { bodyLimit: Math.min(env.BODY_LIMIT_BYTES, 150000) }, async (request, reply) => {
    const { userId, repository } = await requestContext(request,backend,true);
    const { projectId,revisionId,takeoffId } = parseRequest(TakeoffParamsSchema,request.params);
    const input = parseRequest(ConstructionRequestSchema,request.body);
    await new TakeoffRepository(repository).read(projectId,revisionId,takeoffId);
    const result = ConstructionDetailSchema.parse(await durableCommand(request,repository,{projectId,revisionId,takeoffId,...input},context=>
      createConstruction(repository,userId!,projectId,revisionId,takeoffId,input.specification,input.options,env.PROJECT_COMMIT_SECRET,context)));
    request.log.info({projectId,revisionId,takeoffId,calculationId:result.id,materialCount:result.summary.materialCount},'construction calculation created');
    return reply.code(201).send(result);
  });
  app.get(CONSTRUCTION_OPERATION,async request=>{
    const {repository}=await requestContext(request,backend,true);
    const {projectId,revisionId,takeoffId}=parseRequest(TakeoffParamsSchema,request.params);
    return new ConstructionRepository(repository).list(projectId,revisionId,takeoffId,parseRequest(PageQuerySchema,request.query));
  });
  app.get(`${CONSTRUCTION_OPERATION}/:calculationId`,async request=>{
    const {repository}=await requestContext(request,backend,true);
    const {projectId,revisionId,takeoffId,calculationId}=parseRequest(ConstructionParamsSchema,request.params);
    return new ConstructionRepository(repository).read(projectId,revisionId,takeoffId,calculationId);
  });
}
