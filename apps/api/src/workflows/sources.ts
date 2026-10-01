import { z } from 'zod';
import { TAKEOFF_ENGINE_VERSION, MEASUREMENT_POLICY_VERSION } from '@designflow/quantity-takeoff';
import { CONSTRUCTION_ENGINE_VERSION } from '@designflow/construction-calculations';
import { COST_ENGINE_VERSION, costHash, sampleRateBook } from '@designflow/boq-cost';
import { ProjectRepository } from '../lib/project-repository.js';
import { WorkflowRepository } from '../lib/workflow-repository.js';
import { TakeoffRepository } from '../lib/takeoff-repository.js';
import { ConstructionRepository } from '../lib/construction-repository.js';
import { CostRepository } from '../lib/cost-repository.js';
import type { Repository } from '../lib/repository.js';
import { ProjectDetailSchema, ProjectRevisionDetailSchema } from '../contracts/projects.js';
import { type CapabilityId, type WorkflowOutput, type WorkflowRequest } from '../contracts/workflows.js';
import { takeoffFingerprint } from '../services/takeoff-service.js';
import { CAPABILITIES } from './registry.js';
import { planWorkflow } from './planner.js';
import { ApiError } from '../lib/errors.js';
export type Revision = z.infer<typeof ProjectRevisionDetailSchema>;
export function output(capability: CapabilityId, artifactId: string, revisionId: string, coverage: string|null,
  sourceArtifactIds: string[], status: WorkflowOutput['status'] = 'CREATED', version?: string): WorkflowOutput {
  const c = CAPABILITIES.find(c=>c.capabilityId===capability)!;
  return {capability,artifactType:c.producedArtifactType,artifactId,projectRevisionId:revisionId,status,version:version??c.version,coverage,sourceArtifactIds};
}
export function revisionOutputs(r: Revision, status: WorkflowOutput['status'] = 'REUSED'): WorkflowOutput[] {
  return [output('BLUEPRINT_GENERATION',r.id,r.id,null,[],status,r.generatorVersion??'supplied-v2'),
    output('BLUEPRINT_QA',r.qa.id,r.id,r.qa.status,[r.id],status,r.qa.qaVersion),
    output('REVISION_PERSISTENCE',r.id,r.id,null,[r.qa.id],status)];
}
export function assertAccepted(r: Revision) {
  const q=r.qaRuns.find(q=>q.id===r.qa.id);
  if (!q || q.report.inputStatus!=='SCHEMA_VALID' || q.report.summary.errors!==0 || !['PASS','PASS_WITH_WARNINGS'].includes(q.status) || !['PASS','PASS_WITH_WARNINGS'].includes(q.report.status))
    throw new ApiError(422,'REVISION_NOT_ACCEPTED','An accepted architectural V2 revision is required');
}
export async function resolveWorkflow(repository: Repository, projectId: string, request: WorkflowRequest) {
  await new ProjectRepository(repository).read('get',projectId).then(v=>ProjectDetailSchema.parse(v));
  const outputs: WorkflowOutput[]=[];
  if (request.source.kind==='GENERATE') {
    if (request.source.baseRevisionId) await new ProjectRepository(repository).read('revision',projectId,request.source.baseRevisionId);
    return {plan:planWorkflow(request),outputs};
  }
  const revisionId=request.source.sourceRevisionId;
  const revision=ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision',projectId,revisionId));
  assertAccepted(revision);
  if (request.mode==='INTERIOR_ONLY') {
    const ids=new Set(revision.model.spaces.map(s=>s.id));
    if(request.targetSpaceIds.some(id=>!ids.has(id)))throw new ApiError(422,'WORKFLOW_SPACE_NOT_FOUND','Target spaces must belong to the selected revision');
  }
  outputs.push(...revisionOutputs(revision));
  const planned=planWorkflow(request,outputs);
  if (!('takeoff' in request) || !planned.steps.some(s=>s.capability==='QUANTITY_TAKEOFF')) return {plan:planned,outputs};
  const lookup=new WorkflowRepository(repository);
  const takeoffId=await lookup.find(projectId,revisionId,'takeoff',takeoffFingerprint({projectRevisionId:revisionId,model:revision.model,
    engineVersion:TAKEOFF_ENGINE_VERSION,measurementPolicyVersion:MEASUREMENT_POLICY_VERSION,options:request.takeoff.options}));
  if (takeoffId) {
    const t=await new TakeoffRepository(repository).read(projectId,revisionId,takeoffId);
    outputs.push(output('QUANTITY_TAKEOFF',t.id,revisionId,t.status,[revisionId,revision.qa.id],'REUSED',t.engineVersion));
    if (request.construction && planned.steps.some(s=>s.capability==='CONSTRUCTION_CALCULATION')) {
      const constructionId=await lookup.find(projectId,revisionId,'construction',takeoffFingerprint({projectRevisionId:revisionId,takeoffId:t.id,
        takeoffInputFingerprint:t.inputFingerprint,takeoffReportHash:takeoffFingerprint(t.report),engineVersion:CONSTRUCTION_ENGINE_VERSION,
        recipePack:request.construction.specification.recipePack,specification:request.construction.specification,options:request.construction.options}));
      if(constructionId) {
        const c=await new ConstructionRepository(repository).read(projectId,revisionId,t.id,constructionId);
        outputs.push(output('CONSTRUCTION_CALCULATION',c.id,revisionId,c.status,[t.id],'REUSED',c.engineVersion));
        if(request.cost && planned.steps.some(s=>s.capability==='BOQ_COST')) {
          const costId=await lookup.find(projectId,revisionId,'cost',costHash({projectRevisionId:revisionId,constructionCalculationId:c.id,
            constructionInputFingerprint:c.inputFingerprint,constructionReportHash:costHash(c.report),engineVersion:COST_ENGINE_VERSION,
            rateBookHash:costHash(sampleRateBook(request.cost.rateBookId==='sample-inr-v1'?'1':'2')),
            costingPolicyHash:costHash(request.cost.costingPolicy),options:request.cost.options}));
          if(costId) {const cost=await new CostRepository(repository).read(projectId,revisionId,costId);
            outputs.push(output('BOQ_COST',cost.id,revisionId,cost.coverage,[t.id,c.id],'REUSED',cost.engineVersion));}
        }
      }
    }
  }
  return {plan:planWorkflow(request,outputs),outputs};
}
