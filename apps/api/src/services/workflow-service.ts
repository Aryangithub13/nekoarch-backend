import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Repository, IdempotencyContext } from '../lib/repository.js';
import { WorkflowRepository, WORKFLOW_OPERATION } from '../lib/workflow-repository.js';
import { WorkflowRunSchema, WORKFLOW_VERSION, type WorkflowRequest, type CapabilityId } from '../contracts/workflows.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { resolveWorkflow } from '../workflows/sources.js';
import { takeoffFingerprint, createTakeoff } from './takeoff-service.js';
import { saveProjectRevision } from './project-service.js';
import { createConstruction } from './construction-service.js';
import { createCost } from './cost-service.js';
import { ApiError } from '../lib/errors.js';
import { CAPABILITIES } from '../workflows/registry.js';
export function workflowFingerprint(projectId: string, request: WorkflowRequest) {
  return takeoffFingerprint({workflowVersion:WORKFLOW_VERSION,projectId,request});
}
export async function executeWorkflow(repository: Repository, userId: string, projectId: string, request: WorkflowRequest,
  secret?: string, context?: IdempotencyContext, logger?: FastifyBaseLogger) {
  if(!secret)throw new ApiError(503,'WORKFLOW_UNAVAILABLE','Workflow persistence is not configured');
  const fingerprint=workflowFingerprint(projectId,request);
  context ??= {operation:WORKFLOW_OPERATION,keyHash:takeoffFingerprint({keylessWorkflow:fingerprint}),fingerprint};
  const resolved=await resolveWorkflow(repository,projectId,request), workflows=new WorkflowRepository(repository), leaseToken=randomUUID();
  let run=WorkflowRunSchema.parse(await workflows.write('begin',{projectId,request,inputFingerprint:fingerprint,
    plan:resolved.plan,outputs:resolved.plan.reusedOutputs,leaseToken},userId,secret,context));
  if(run.status!=='RUNNING')return run;
  const staged=Object.create(repository) as Repository;
  let capability: CapabilityId='BLUEPRINT_GENERATION';
  const step=async(name:string,args:Record<string,unknown>)=>workflows.write('step',{projectId,runId:run.id,leaseToken,capability,call:{name,args}},userId,secret);
  staged.projectRpc=async(name,args)=>name==='project_write'?step(name,args):repository.projectRpc!(name,args);
  staged.takeoffRpc=async(name,args)=>name==='takeoff_write'?step(name,args):repository.takeoffRpc!(name,args);
  staged.constructionRpc=async(name,args)=>name==='construction_write'?step(name,args):repository.constructionRpc!(name,args);
  staged.costRpc=async(name,args)=>name==='cost_write'?step(name,args):repository.costRpc!(name,args);
  const errors: {capability:CapabilityId;code:string;message:string}[]=[];
  if(run.plan.status!=='BLOCKED') for(const planned of run.plan.steps) {
    capability=planned.capability;
    if(planned.action!=='EXECUTE' || run.outputs.some(o=>o.capability===capability))continue;
    try {
      if (CAPABILITIES.find(c=>c.capabilityId===capability)?.implementationStatus!=='AVAILABLE') throw new ApiError(422,'CAPABILITY_NOT_IMPLEMENTED','The selected capability is unavailable');
      const revisionId=run.sourceRevisionId;
      const takeoffId=run.outputs.find(o=>o.capability==='QUANTITY_TAKEOFF')?.artifactId;
      const calculationId=run.outputs.find(o=>o.capability==='CONSTRUCTION_CALCULATION')?.artifactId;
      switch(capability) {
        case 'BLUEPRINT_GENERATION':
          if(request.source.kind!=='GENERATE')throw new Error('Missing geometry source');
          await saveProjectRevision(new ProjectRepository(staged),userId,projectId,'generated',request.source,secret,undefined,logger); break;
        case 'BLUEPRINT_QA': case 'REVISION_PERSISTENCE': throw new Error('Revision commit did not include QA');
        case 'QUANTITY_TAKEOFF':
          if(!revisionId || !('takeoff' in request))throw new Error('Missing takeoff source');
          await createTakeoff(staged,userId,projectId,revisionId,request.takeoff.options,secret); break;
        case 'CONSTRUCTION_CALCULATION':
          if(!revisionId || !takeoffId || !('construction' in request) || !request.construction)throw new Error('Missing construction source');
          await createConstruction(staged,userId,projectId,revisionId,takeoffId,request.construction.specification,request.construction.options,secret); break;
        case 'BOQ_COST':
          if(!revisionId || !takeoffId || !calculationId || !('cost' in request) || !request.cost)throw new Error('Missing cost source');
          await createCost(staged,userId,projectId,revisionId,takeoffId,calculationId,request.cost.rateBookId,request.cost.costingPolicy,request.cost.options,secret); break;
        default: throw new Error('Unavailable capability reached execution');
      }
      run=await workflows.read(projectId,run.id);
    } catch(error) {
      // Infrastructure failures remain failures, with the atomic progress available for an explicit resume.
      if(!(error instanceof ApiError) || error.statusCode>=500)throw error;
      errors.push({capability,code:error.code.slice(0,100),message:error.message.slice(0,240)}); break;
    }
  }
  return WorkflowRunSchema.parse(await workflows.write('finish',{projectId,runId:run.id,leaseToken,errors},userId,secret));
}
