import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { WorkflowRequestSchema, type CapabilityId } from '../src/contracts/workflows.js';
import { CAPABILITIES, MODES, validateRegistry } from '../src/workflows/registry.js';
import { planWorkflow } from '../src/workflows/planner.js';
import { output } from '../src/workflows/sources.js';
import { workflowFingerprint } from '../src/services/workflow-service.js';
import { requirements, freeze } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { specification } from '../../../packages/construction-calculations/tests/fixtures.js';
import { sampleCostingPolicy } from '@designflow/boq-cost';
const source={kind:'GENERATE',baseRevisionId:null,requirements:requirements()};
const complete={mode:'COMPLETE_BUILDING',source,construction:{specification:specification()},cost:{rateBookId:'sample-inr-v1',costingPolicy:sampleCostingPolicy()}};
const chain: CapabilityId[]=['BLUEPRINT_GENERATION','BLUEPRINT_QA','REVISION_PERSISTENCE','QUANTITY_TAKEOFF','CONSTRUCTION_CALCULATION','BOQ_COST'];
describe('pure workflow planning and strict contracts',()=>{
  it('plans blueprint only through accepted revision',()=>{
    const plan=planWorkflow(WorkflowRequestSchema.parse({mode:'BLUEPRINT_ONLY',source}));
    expect(plan.executableCapabilities).toEqual(chain.slice(0,3)); expect(plan.unavailableCapabilities).toEqual([]);
  });
  it('plans the complete current chain and honest optional future outputs',()=>{
    const plan=planWorkflow(WorkflowRequestSchema.parse(complete));expect(plan.status).toBe('PLANNED');expect(plan.executableCapabilities).toEqual(chain);
    expect(plan.unavailableCapabilities.map(c=>c.capability)).toEqual(['PROFESSIONAL_2D','INTERIOR_DESIGN','EXTERIOR_DESIGN','SCENE_3D','ENGINEERING_ANALYSIS']);
    expect(plan.unavailableCapabilities.every(c=>!c.required && c.reason==='CAPABILITY_NOT_IMPLEMENTED')).toBe(true);
  });
  it.each([
    {mode:'INTERIOR_ONLY',targetSpaceIds:['foyer'],design:{brief:'Calm room'}},
    {mode:'EXTERIOR_ONLY',facade:'NORTH',design:{brief:'Brick facade'}},
    {mode:'THREE_D_ONLY'},
    {mode:'ENGINEERING_ONLY',analysis:{discipline:'STRUCTURAL',sourceModelType:'ARCHITECTURAL_V2',brief:'Review source'}},
  ])('models $mode without fabricating an engine',input=>{
    const plan=planWorkflow(WorkflowRequestSchema.parse({...input,source:{kind:'REVISION',sourceRevisionId:randomUUID()}}));
    expect(plan.status).toBe('BLOCKED');expect(plan.executableCapabilities).toEqual([]);expect(plan.unavailableCapabilities).toHaveLength(1);
  });
  it('blocks required future dependencies and continues optional ones',()=>{
    expect(planWorkflow(WorkflowRequestSchema.parse({...complete,requiredOutputs:['WALKTHROUGH']})).status).toBe('BLOCKED');
    const optional=planWorkflow(WorkflowRequestSchema.parse({...complete,optionalOutputs:['WALKTHROUGH']}));
    expect(optional.status).toBe('PLANNED');expect(optional.unavailableCapabilities.find(c=>c.capability==='WALKTHROUGH')?.required).toBe(false);
  });
  it('only executes the missing cost step with exact source evidence',()=>{
    const revisionId=randomUUID(),evidence=chain.slice(0,5).map(c=>output(c,randomUUID(),revisionId,null,[],'REUSED'));
    const request=WorkflowRequestSchema.parse({...complete,source:{kind:'REVISION',sourceRevisionId:revisionId}});
    const plan=planWorkflow(request,evidence);expect(plan.executableCapabilities).toEqual(['BOQ_COST']);expect(plan.reusedOutputs).toHaveLength(5);
  });
  it('does not reuse an incompatible derived version',()=>{
    const r=randomUUID(),evidence=[output('QUANTITY_TAKEOFF',randomUUID(),r,null,[],'REUSED','old')];
    expect(planWorkflow(WorkflowRequestSchema.parse(complete),evidence).executableCapabilities).toContain('QUANTITY_TAKEOFF');
  });
  it('has deterministic order, fingerprint, and no mutation',()=>{
    const r=freeze(WorkflowRequestSchema.parse({...complete,optionalOutputs:['SCENE_3D','INTERIOR_DESIGN','SCENE_3D']})),projectId=randomUUID();
    expect(planWorkflow(r)).toEqual(planWorkflow(r));
    const normalized=WorkflowRequestSchema.parse({...complete,optionalOutputs:['INTERIOR_DESIGN','SCENE_3D']});
    expect(workflowFingerprint(projectId,r)).toBe(workflowFingerprint(projectId,normalized));
    expect(workflowFingerprint(projectId,r)).not.toBe(workflowFingerprint(randomUUID(),r));
    const p=planWorkflow(r);for(const [i,s] of p.steps.entries())for(const d of s.dependencies)expect(p.steps.findIndex(x=>x.capability===d)).toBeLessThan(i);
  });
  it.each([
    {mode:'UNKNOWN'}, {mode:'BLUEPRINT_ONLY',targetRoomId:'x'}, {mode:'BLUEPRINT_ONLY',report:{}},
    {mode:'BLUEPRINT_ONLY',capabilities:{SCENE_3D:'AVAILABLE'}}, {mode:'BLUEPRINT_ONLY',requiredOutputs:['CONSTRUCTION_CALCULATION']},
    {mode:'BLUEPRINT_ONLY',requiredOutputs:['BOQ_COST']}, {mode:'BLUEPRINT_ONLY',requiredOutputs:['SCENE_3D'],optionalOutputs:['SCENE_3D']},
    {mode:'BLUEPRINT_ONLY',source:{kind:'REVISION'}}, {mode:'THREE_D_ONLY'}, {mode:'ENGINEERING_ONLY'},
    {mode:'INTERIOR_ONLY',targetSpaceIds:[]}, {mode:'BLUEPRINT_ONLY',source:{kind:'REVISION',sourceRevisionId:randomUUID(),takeoffId:randomUUID()}},
    {mode:'BLUEPRINT_ONLY',optionalOutputs:Array.from({length:14},()=> 'SCENE_3D')},
  ])('rejects invalid mode input %#',patch=>expect(WorkflowRequestSchema.safeParse({source,...patch}).success).toBe(false));
  it('rejects unknown fields on the engineering variant',()=>expect(WorkflowRequestSchema.safeParse({mode:'ENGINEERING_ONLY',source:{kind:'REVISION',sourceRevisionId:randomUUID()},analysis:{discipline:'STRUCTURAL',sourceModelType:'ARCHITECTURAL_V2',brief:'x'},report:{}}).success).toBe(false));
  it('validates the registry and mode inventory',()=>{expect(()=>validateRegistry(CAPABILITIES)).not.toThrow();expect(MODES).toHaveLength(6);expect(CAPABILITIES).toHaveLength(13);});
  it('rejects duplicate capability ids',()=>expect(()=>validateRegistry([...CAPABILITIES,CAPABILITIES[0]!])).toThrow('Duplicate'));
  it('rejects missing dependencies',()=>expect(()=>validateRegistry(CAPABILITIES.slice(1))).toThrow('dependency'));
  it('rejects unsupported dependency versions',()=>{const r=structuredClone(CAPABILITIES);r[1]!.dependencies[0]!.version='missing';expect(()=>validateRegistry(r)).toThrow('version');});
  it('rejects cycles',()=>{const r=structuredClone(CAPABILITIES);r[0]!.dependencies=[{capabilityId:r[2]!.capabilityId,version:r[2]!.version}];expect(()=>validateRegistry(r)).toThrow('cycle');});
  it('rejects duplicate modes',()=>expect(()=>validateRegistry(CAPABILITIES,[...MODES,MODES[0]!])).toThrow('Duplicate mode'));
  it('rejects invalid artifact metadata and oversized registries',()=>{
    const r=structuredClone(CAPABILITIES);Object.assign(r[0]!,{producedArtifactType:'FAKE'});expect(()=>validateRegistry(r)).toThrow();
    expect(()=>validateRegistry(Array.from({length:33},()=>CAPABILITIES[0]!))).toThrow('limit');
  });
  it('never executes disabled capabilities or their descendants',()=>{
    const r=structuredClone(CAPABILITIES);r[3]!.implementationStatus='DISABLED';
    const p=planWorkflow(WorkflowRequestSchema.parse(complete),[],r);expect(p.status).toBe('BLOCKED');expect(p.executableCapabilities).toEqual([]);
    expect(p.unavailableCapabilities.find(c=>c.capability==='BOQ_COST')?.reason).toBe('DEPENDENCY_UNAVAILABLE');
  });
});
