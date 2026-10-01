import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sampleCostingPolicy } from '@designflow/boq-cost';
import { requirements } from '../packages/blueprint-qa/tests/fixtures.js';
import { specification } from '../packages/construction-calculations/tests/fixtures.js';
import type { ProjectTestContext } from './project-acceptance.js';
import { WorkflowRunSchema } from '../apps/api/src/contracts/workflows.js';
export const workflowPayload=(mode='COMPLETE_BUILDING')=>({mode,source:{kind:'GENERATE',baseRevisionId:null,requirements:requirements()},
  ...(mode==='COMPLETE_BUILDING'?{construction:{specification:specification()},cost:{rateBookId:'sample-inr-v1',costingPolicy:sampleCostingPolicy()}}:{})});
export async function workflowSetup(c:ProjectTestContext,headers=c.owner) {
  const p=await c.app.inject({method:'POST',url:'/api/projects',headers,payload:{title:'Workflow acceptance'}});expect(p.statusCode,p.body).toBe(201);
  const projectId=p.json().id as string;return {projectId,url:`/api/projects/${projectId}/workflows`};
}
export function workflowAcceptance(context:()=>ProjectTestContext) {
  it('executes COMPLETE_BUILDING with one canonical chain and preserves partial cost coverage',async()=>{
    const c=context(),f=await workflowSetup(c),payload=workflowPayload();
    const planned=await c.app.inject({method:'POST',url:f.url+'/plan',headers:c.owner,payload});expect(planned.statusCode,planned.body).toBe(200);
    expect((await c.app.inject({url:`/api/projects/${f.projectId}/revisions`,headers:c.owner})).json().items).toHaveLength(0);
    expect((await c.app.inject({url:f.url,headers:c.owner})).json().items).toHaveLength(0);
    const response=await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload});expect(response.statusCode,response.body).toBe(201);
    const run=WorkflowRunSchema.parse(response.json());expect(run.status,JSON.stringify(run.errors)).toBe('COMPLETED');expect(run.plan).toEqual(planned.json().plan);
    expect(run.outputs.map(o=>o.capability)).toEqual(['BLUEPRINT_GENERATION','BLUEPRINT_QA','REVISION_PERSISTENCE','QUANTITY_TAKEOFF','CONSTRUCTION_CALCULATION','BOQ_COST']);
    expect(run.outputs.every(o=>o.projectRevisionId===run.sourceRevisionId && o.status==='CREATED')).toBe(true);
    const t=run.outputs[3]!,calc=run.outputs[4]!,cost=run.outputs[5]!;
    expect(calc.sourceArtifactIds).toEqual([t.artifactId]);expect(cost.sourceArtifactIds).toEqual([t.artifactId,calc.artifactId]);
    expect(cost.coverage).toBe('PARTIALLY_PRICED');
    const history=(await c.app.inject({url:`/api/projects/${f.projectId}/revisions`,headers:c.owner})).json();expect(history.items).toHaveLength(1);
    const base=`/api/projects/${f.projectId}/revisions/${run.sourceRevisionId}`;
    const priced=(await c.app.inject({url:`${base}/cost-estimates/${cost.artifactId}`,headers:c.owner})).json();
    expect(priced.constructionCalculationId).toBe(calc.artifactId);expect(priced.takeoffId).toBe(t.artifactId);expect(priced.report.finalTotals.completeTotalAvailable).toBe(false);
    expect((await c.app.inject({url:`${f.url}/${run.id}`,headers:c.owner})).json()).toEqual(run);
  });
  it('BLUEPRINT_ONLY creates geometry and accepted QA with zero automatic downstream artifacts',async()=>{
    const c=context(),f=await workflowSetup(c),r=await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:workflowPayload('BLUEPRINT_ONLY')});
    expect(r.statusCode,r.body).toBe(201);const run=WorkflowRunSchema.parse(r.json());expect(run.status).toBe('COMPLETED');expect(run.outputs).toHaveLength(3);
    const base=`/api/projects/${f.projectId}/revisions/${run.sourceRevisionId}`;
    expect((await c.app.inject({url:base,headers:c.owner})).json().qa.status).not.toBe('FAIL');
    for(const suffix of ['takeoffs','cost-estimates'])expect((await c.app.inject({url:`${base}/${suffix}`,headers:c.owner})).json().items).toHaveLength(0);
  });
  it('reuses revision, QA, takeoff and construction and executes only missing cost',async()=>{
    const c=context(),f=await workflowSetup(c),payload={...workflowPayload('BLUEPRINT_ONLY'),requiredOutputs:['CONSTRUCTION_CALCULATION'],construction:{specification:specification()}};
    const a=await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload});expect(a.statusCode,a.body).toBe(201);expect(a.json().status).toBe('COMPLETED');
    const before=(await c.app.inject({url:`/api/projects/${f.projectId}`,headers:c.owner})).json();
    const downstream={...workflowPayload(),source:{kind:'REVISION',sourceRevisionId:a.json().sourceRevisionId}};
    const plan=await c.app.inject({method:'POST',url:f.url+'/plan',headers:c.owner,payload:downstream});expect(plan.statusCode,plan.body).toBe(200);expect(plan.json().plan.executableCapabilities).toEqual(['BOQ_COST']);
    const b=await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:downstream});expect(b.statusCode,b.body).toBe(201);const run=WorkflowRunSchema.parse(b.json());
    expect(run.status).toBe('COMPLETED');expect(run.outputs.slice(0,5).map(o=>o.artifactId)).toEqual(a.json().outputs.map((o:{artifactId:string})=>o.artifactId));
    expect(run.outputs.slice(0,5).every(o=>o.status==='REUSED')).toBe(true);expect(run.outputs[5]?.status).toBe('CREATED');
    expect((await c.app.inject({url:`/api/projects/${f.projectId}`,headers:c.owner})).json()).toEqual(before);
    const replay=await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:downstream});expect(replay.json()).toEqual(run);
    const again=await c.app.inject({method:'POST',url:f.url,headers:{...c.owner,'idempotency-key':randomUUID()},payload:downstream});expect(again.json().plan.executableCapabilities).toEqual([]);expect(again.json().outputs.every((o:{status:string})=>o.status==='REUSED')).toBe(true);
  });
  it('replays identical keys after newer revisions and conflicts on changed mode, revision and outputs',async()=>{
    const c=context(),f=await workflowSetup(c),key=randomUUID(),payload=workflowPayload('BLUEPRINT_ONLY'),headers={...c.owner,'idempotency-key':key};
    const a=await c.app.inject({method:'POST',url:f.url,headers,payload});expect(a.statusCode,a.body).toBe(201);
    const newer=await c.app.inject({method:'POST',url:`/api/projects/${f.projectId}/revisions/generate`,headers:c.owner,payload:{requirements:requirements(1,'newer'),baseRevisionId:a.json().sourceRevisionId}});expect(newer.statusCode,newer.body).toBe(201);
    expect((await c.app.inject({method:'POST',url:f.url,headers,payload})).json()).toEqual(a.json());
    for(const changed of [{...workflowPayload()}, {...payload,source:{kind:'REVISION',sourceRevisionId:newer.json().revision.id}}, {...payload,optionalOutputs:['SCENE_3D']}])
      expect((await c.app.inject({method:'POST',url:f.url,headers,payload:changed})).statusCode).toBe(409);
    const g=await workflowSetup(c,c.other);expect((await c.app.inject({method:'POST',url:g.url,headers:{...c.other,'idempotency-key':key},payload})).statusCode).toBe(201);
  });
  it('persists honest blocked future contracts and validates attached space references',async()=>{
    const c=context(),f=await workflowSetup(c),a=await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:workflowPayload('BLUEPRINT_ONLY')});expect(a.statusCode,a.body).toBe(201);
    const source={kind:'REVISION',sourceRevisionId:a.json().sourceRevisionId};
    const revision=(await c.app.inject({url:`/api/projects/${f.projectId}/revisions/${source.sourceRevisionId}`,headers:c.owner})).json();
    for(const details of [{mode:'THREE_D_ONLY'},{mode:'INTERIOR_ONLY',targetSpaceIds:[revision.model.spaces[0].id],design:{brief:'Warm room'}},
      {mode:'EXTERIOR_ONLY',facade:'ALL',design:{brief:'Brick'}},{mode:'ENGINEERING_ONLY',analysis:{discipline:'STRUCTURAL',sourceModelType:'ARCHITECTURAL_V2',brief:'Future review'}}]) {
      const r=await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:{...details,source}});expect(r.statusCode,r.body).toBe(201);expect(r.json().status).toBe('BLOCKED');
      expect(r.json().outputs).toHaveLength(3);expect(r.json().plan.unavailableCapabilities).toHaveLength(1);
    }
    expect((await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:{mode:'INTERIOR_ONLY',source,targetSpaceIds:['nonexistent'],design:{brief:'Warm'}}})).statusCode).toBe(422);
  });
  it('blocks required unavailable outputs before generation but does not block optional ones',async()=>{
    const c=context(),f=await workflowSetup(c);
    const r=await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:{...workflowPayload('BLUEPRINT_ONLY'),requiredOutputs:['SCENE_3D']}});expect(r.statusCode,r.body).toBe(201);expect(r.json().status).toBe('BLOCKED');expect(r.json().outputs).toEqual([]);
    expect((await c.app.inject({url:`/api/projects/${f.projectId}/revisions`,headers:c.owner})).json().items).toEqual([]);
    const ok=await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:{...workflowPayload('BLUEPRINT_ONLY'),optionalOutputs:['SCENE_3D']}});expect(ok.json().status).toBe('COMPLETED');
  });
  it('preserves upstream artifacts and reports a downstream domain failure precisely',async()=>{
    const c=context(),f=await workflowSetup(c),payload=workflowPayload();
    const invalidPolicy={...sampleCostingPolicy(),currency:'USD'};
    const r=await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:{...payload,cost:{rateBookId:'sample-inr-v1',costingPolicy:invalidPolicy}}});expect(r.statusCode,r.body).toBe(201);
    expect(r.json().status).toBe('PARTIALLY_COMPLETED');expect(r.json().outputs).toHaveLength(5);expect(r.json().errors).toEqual([expect.objectContaining({capability:'BOQ_COST',code:'COST_POLICY_INVALID'})]);
  });
  it('retains required outputs when optional cost fails and optional 3D is unavailable',async()=>{
    const c=context(),f=await workflowSetup(c),headers={...c.owner,'idempotency-key':randomUUID()};
    const payload={...workflowPayload('BLUEPRINT_ONLY'),requiredOutputs:['QUANTITY_TAKEOFF'],optionalOutputs:['BOQ_COST','SCENE_3D'],
      construction:{specification:specification()},cost:{rateBookId:'sample-inr-v1',costingPolicy:{...sampleCostingPolicy(),currency:'USD'}}};
    const response=await c.app.inject({method:'POST',url:f.url,headers,payload});expect(response.statusCode,response.body).toBe(201);
    const run=WorkflowRunSchema.parse(response.json());expect(run.status).toBe('PARTIALLY_COMPLETED');
    expect(run.plan.requiredCapabilities).toEqual(['BLUEPRINT_GENERATION','BLUEPRINT_QA','REVISION_PERSISTENCE','QUANTITY_TAKEOFF']);
    expect(run.outputs.map(o=>o.capability)).toEqual([...run.plan.requiredCapabilities,'CONSTRUCTION_CALCULATION']);
    expect(run.plan.unavailableCapabilities).toEqual([{capability:'SCENE_3D',implementationStatus:'PLANNED',reason:'CAPABILITY_NOT_IMPLEMENTED',required:false}]);
    expect(run.errors).toEqual([expect.objectContaining({capability:'BOQ_COST',code:'COST_POLICY_INVALID'})]);
    expect((await c.app.inject({url:`/api/projects/${f.projectId}/revisions/${run.sourceRevisionId}/cost-estimates`,headers:c.owner})).json().items).toEqual([]);
    expect((await c.app.inject({method:'POST',url:f.url,headers,payload})).json()).toEqual(run);
  });
  it('isolates private workflows on public projects and rejects cross-project revisions and client output injection',async()=>{
    const c=context(),f=await workflowSetup(c),g=await workflowSetup(c),r=await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:workflowPayload('BLUEPRINT_ONLY')});expect(r.statusCode,r.body).toBe(201);
    await c.app.inject({method:'PATCH',url:`/api/projects/${f.projectId}`,headers:c.owner,payload:{visibility:'PUBLIC'}});
    for(const headers of [c.other,{}]) {
      for(const url of [f.url,`${f.url}/${r.json().id}`])expect((await c.app.inject({url,headers})).statusCode).toBe(headers===c.other?404:401);
      for(const url of [f.url,f.url+'/plan'])expect((await c.app.inject({method:'POST',url,headers,payload:workflowPayload('BLUEPRINT_ONLY')})).statusCode).toBe(headers===c.other?404:401);
    }
    expect((await c.app.inject({url:`/api/projects/${f.projectId}/public`})).body).not.toContain(r.json().id);
    expect((await c.app.inject({method:'POST',url:g.url,headers:c.owner,payload:{mode:'THREE_D_ONLY',source:{kind:'REVISION',sourceRevisionId:r.json().sourceRevisionId}}})).statusCode).toBe(404);
    for(const extra of [{outputs:[]},{status:'COMPLETED'},{ownerId:randomUUID()},{report:{}},{sourceArtifactIds:[randomUUID()]}])expect((await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:{...workflowPayload('BLUEPRINT_ONLY'),...extra}})).statusCode).toBe(400);
  });
  it('paginates summaries and exposes only safe capability metadata',async()=>{
    const c=context(),f=await workflowSetup(c),ids=[];
    for(let i=0;i<3;i++){const r=await c.app.inject({method:'POST',url:f.url,headers:{...c.owner,'idempotency-key':randomUUID()},payload:{...workflowPayload('BLUEPRINT_ONLY'),requiredOutputs:['SCENE_3D']}});expect(r.statusCode,r.body).toBe(201);ids.push(r.json().id);}
    let cursor:string|null=null;const seen=[];
    for(let i=0;i<3;i++){const r=await c.app.inject({url:`${f.url}?limit=1${cursor?`&cursor=${cursor}`:''}`,headers:c.owner});expect(r.statusCode,r.body).toBe(200);const page:{items:{id:string}[];nextCursor:string|null}=r.json();expect(page.items).toHaveLength(1);expect(page.items[0]).not.toHaveProperty('request');expect(page.items[0]).not.toHaveProperty('plan');seen.push(page.items[0]!.id);cursor=page.nextCursor;}
    expect(cursor).toBeNull();expect(new Set(seen)).toEqual(new Set(ids));
    for(const suffix of ['?limit=101','?cursor=bad'])expect((await c.app.inject({url:f.url+suffix,headers:c.owner})).statusCode).toBe(400);
    const meta=await c.app.inject({url:'/api/capabilities'});expect(meta.statusCode).toBe(200);expect(meta.json().modes).toHaveLength(6);expect(meta.json().capabilities).toHaveLength(13);expect(meta.body).not.toContain('secret');
  });
}
