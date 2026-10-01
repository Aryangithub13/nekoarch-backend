import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { durableCommand } from '../lib/idempotency.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { WorkflowRepository, WORKFLOW_OPERATION } from '../lib/workflow-repository.js';
import { ProjectParamsSchema, PageQuerySchema } from '../contracts/projects.js';
import { WorkflowRequestSchema, WorkflowRunSchema, WORKFLOW_VERSION } from '../contracts/workflows.js';
import { CAPABILITIES, MODES, validateRegistry } from '../workflows/registry.js';
import { resolveWorkflow } from '../workflows/sources.js';
import { executeWorkflow, workflowFingerprint } from '../services/workflow-service.js';
export function workflowsRoutes(app: FastifyInstance, backend: Backend, env: Env) {
  validateRegistry(CAPABILITIES);
  app.get('/api/capabilities',async()=>({workflowVersion:WORKFLOW_VERSION,modes:MODES,capabilities:CAPABILITIES}));
  app.post(`${WORKFLOW_OPERATION}/plan`,{bodyLimit:Math.min(env.BODY_LIMIT_BYTES,131072)},async request=>{
    const {repository}=await requestContext(request,backend,true), {projectId}=parseRequest(ProjectParamsSchema,request.params);
    const input=parseRequest(WorkflowRequestSchema,request.body);
    const {plan}=await resolveWorkflow(repository,projectId,input);
    return {projectId,sourceRevisionId:input.source.kind==='REVISION'?input.source.sourceRevisionId:null,inputFingerprint:workflowFingerprint(projectId,input),plan};
  });
  app.post(WORKFLOW_OPERATION,{bodyLimit:Math.min(env.BODY_LIMIT_BYTES,131072)},async(request,reply)=>{
    const {repository,userId}=await requestContext(request,backend,true),{projectId}=parseRequest(ProjectParamsSchema,request.params);
    const input=parseRequest(WorkflowRequestSchema,request.body);
    await new ProjectRepository(repository).read('get',projectId);
    const result=WorkflowRunSchema.parse(await durableCommand(request,repository,{workflowVersion:WORKFLOW_VERSION,projectId,request:input},context=>
      executeWorkflow(repository,userId!,projectId,input,env.PROJECT_COMMIT_SECRET,context)));
    return reply.code(201).send(result);
  });
  app.get(WORKFLOW_OPERATION,async request=>{
    const {repository}=await requestContext(request,backend,true),{projectId}=parseRequest(ProjectParamsSchema,request.params);
    return new WorkflowRepository(repository).list(projectId,parseRequest(PageQuerySchema,request.query));
  });
  app.get(`${WORKFLOW_OPERATION}/:workflowRunId`,async request=>{
    const {repository}=await requestContext(request,backend,true),{projectId,workflowRunId}=parseRequest(ProjectParamsSchema.extend({workflowRunId:z.string().uuid()}),request.params);
    return new WorkflowRepository(repository).read(projectId,workflowRunId);
  });
}
