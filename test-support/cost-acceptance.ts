import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { calculateBoqCost,sampleRateBook,sampleCostingPolicy,costHash } from '@designflow/boq-cost';
import { specification } from '../packages/construction-calculations/tests/fixtures.js';
import { authored } from '../packages/blueprint-qa/tests/fixtures.js';
import { CostDetailSchema,CostListSchema } from '../apps/api/src/contracts/costs.js';
import type { ProjectTestContext } from './project-acceptance.js';
export async function costSetup(c:ProjectTestContext,headers=c.owner){
  const p=await c.app.inject({method:'POST',url:'/api/projects',headers,payload:{title:'Cost acceptance'}});expect(p.statusCode,p.body).toBe(201);
  const revisionBase=`/api/projects/${p.json().id}/revisions`;
  const r=await c.app.inject({method:'POST',url:revisionBase,headers,payload:{model:authored()}});expect(r.statusCode,r.body).toBe(201);
  const revision=r.json().revision,base=`${revisionBase}/${revision.id}`;
  const t=await c.app.inject({method:'POST',url:`${base}/takeoffs`,headers,payload:{}});expect(t.statusCode,t.body).toBe(201);
  const constructionUrl=`${base}/takeoffs/${t.json().id}/construction-calculations`;
  const calc=await c.app.inject({method:'POST',url:constructionUrl,headers,payload:{specification:specification()}});expect(calc.statusCode,calc.body).toBe(201);
  return {projectId:p.json().id as string,revision,takeoff:t.json(),calculation:calc.json(),base,constructionUrl,
    url:`${constructionUrl}/${calc.json().id}/cost-estimates`,listUrl:`${base}/cost-estimates`,payload:{rateBookId:'sample-inr-v1',costingPolicy:sampleCostingPolicy()}};
}
export function costAcceptance(context:()=>ProjectTestContext){
  it('persists an exact BOQ with hashes and all ancestors unchanged',async()=>{
    const c=context(),f=await costSetup(c);const before=(await c.app.inject({method:'GET',url:`/api/projects/${f.projectId}`,headers:c.owner})).json();
    const response=await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:f.payload});expect(response.statusCode,response.body).toBe(201);
    const dto=CostDetailSchema.parse(response.json());expect(dto.report).toEqual(calculateBoqCost(f.calculation.report,sampleRateBook(),f.payload.costingPolicy));
    expect(dto.reportHash).toBe(costHash(dto.report));expect(dto.constructionReportHash).toBe(costHash(f.calculation.report));expect(dto.takeoffId).toBe(f.takeoff.id);expect(dto.constructionCalculationId).toBe(f.calculation.id);
    expect((await c.app.inject({method:'GET',url:`${f.listUrl}/${dto.id}`,headers:c.owner})).json()).toEqual(dto);
    for(const [url,original] of [[`/api/projects/${f.projectId}`,before],[f.base,f.revision],[`${f.base}/takeoffs/${f.takeoff.id}`,f.takeoff],[`${f.constructionUrl}/${f.calculation.id}`,f.calculation]] as const)
      expect((await c.app.inject({method:'GET',url,headers:c.owner})).json()).toEqual(original);
  });
  it('converges concurrent keyed/keyless costs and replays after later rate/policy versions',async()=>{
    const c=context(),f=await costSetup(c),key=randomUUID();
    const results=await Promise.all([key,key,randomUUID(),undefined].map(k=>c.app.inject({method:'POST',url:f.url,headers:{...c.owner,...(k?{'idempotency-key':k}:{})},payload:f.payload})));
    for(const r of results){expect(r.statusCode,r.body).toBe(201);expect(r.json()).toEqual(results[0]!.json());}
    const changed=[{...f.payload,rateBookId:'sample-inr-v2'},{...f.payload,costingPolicy:{...f.payload.costingPolicy,version:'2'}}];
    const later=await Promise.all(changed.map(payload=>c.app.inject({method:'POST',url:f.url,headers:c.owner,payload})));
    for(const r of later){expect(r.statusCode,r.body).toBe(201);expect(r.json().id).not.toBe(results[0]!.json().id);}expect(later[0]!.json().id).not.toBe(later[1]!.json().id);
    for(const payload of changed)expect((await c.app.inject({method:'POST',url:f.url,headers:{...c.owner,'idempotency-key':key},payload})).statusCode).toBe(409);
    const normalized={...f.payload,costingPolicy:{...f.payload.costingPolicy,laborRules:[...f.payload.costingPolicy.laborRules].reverse(),adjustments:[...f.payload.costingPolicy.adjustments].reverse()},options:{quantityDecimalPlaces:9}};
    expect((await c.app.inject({method:'POST',url:f.url,headers:{...c.owner,'idempotency-key':key},payload:normalized})).json()).toEqual(results[0]!.json());
    expect((await c.app.inject({method:'GET',url:`${f.listUrl}/${results[0]!.json().id}`,headers:c.owner})).json()).toEqual(results[0]!.json());
  });
  it('lists only summaries with bounded stable pagination',async()=>{
    const c=context(),f=await costSetup(c),ids=new Set<string>();
    for(const options of [{},{quantityDecimalPlaces:6},{quantityDecimalPlaces:12}]){const r=await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:{...f.payload,options}});expect(r.statusCode,r.body).toBe(201);ids.add(r.json().id);}
    let cursor:string|null=null;const seen=new Set<string>();for(let i=0;i<3;i++){
      const response=await c.app.inject({method:'GET',url:`${f.listUrl}?limit=1${cursor?`&cursor=${cursor}`:''}`,headers:c.owner});expect(response.statusCode,response.body).toBe(200);
      const page=CostListSchema.parse(response.json());expect(page.items).toHaveLength(1);expect(page.items[0]).not.toHaveProperty('report');expect(page.items[0]).not.toHaveProperty('rateBook');seen.add(page.items[0]!.id);cursor=page.nextCursor;
    }expect(cursor).toBeNull();expect(seen).toEqual(ids);
    for(const suffix of ['?limit=101','?cursor=bad'])expect((await c.app.inject({method:'GET',url:f.listUrl+suffix,headers:c.owner})).statusCode).toBe(400);
  });
  it('keeps costs owner-private even for public projects and isolates identical keys across users',async()=>{
    const c=context(),f=await costSetup(c),g=await costSetup(c,c.other),key=randomUUID();
    const [a,b]=await Promise.all([[f,c.owner],[g,c.other]].map(async([fixture,headers])=>{
      const q=fixture as typeof f;return c.app.inject({method:'POST',url:q.url,headers:headers as typeof c.owner,payload:q.payload});}));
    expect(a!.statusCode,a!.body).toBe(201);expect(b!.statusCode,b!.body).toBe(201);
    const keyed=await Promise.all([{f,headers:c.owner},{f:g,headers:c.other}].map(({f,headers})=>c.app.inject({method:'POST',url:f.url,headers:{...headers,'idempotency-key':key},payload:f.payload})));
    for(const r of keyed)expect(r.statusCode,r.body).toBe(201);expect(keyed[0]!.json().id).not.toBe(keyed[1]!.json().id);
    expect((await c.app.inject({method:'PATCH',url:`/api/projects/${f.projectId}`,headers:c.owner,payload:{visibility:'PUBLIC'}})).statusCode).toBe(200);
    for(const headers of [c.other,{}]){
      for(const url of [f.listUrl,`${f.listUrl}/${a!.json().id}`])expect((await c.app.inject({method:'GET',url,headers})).statusCode).toBe(headers===c.other?404:401);
      expect((await c.app.inject({method:'POST',url:f.url,headers,payload:f.payload})).statusCode).toBe(headers===c.other?404:401);
    }
    const publicResponse=await c.app.inject({method:'GET',url:`/api/projects/${f.projectId}/public`});expect(publicResponse.statusCode).toBe(200);expect(publicResponse.body).not.toContain(a!.json().id);expect(publicResponse.body).not.toContain('pricedGrandTotal');
    expect((await c.app.inject({method:'POST',url:f.url.replace(f.calculation.id,g.calculation.id),headers:c.owner,payload:f.payload})).statusCode).toBe(404);
  });
  it('rejects client quantities/reports/totals/owner injection and missing artifacts',async()=>{
    const c=context(),f=await costSetup(c);
    for(const extra of [{report:{}},{boqLines:[]},{ownerId:randomUUID()},{total:'1'},{materialQuantities:[]},{createdAt:'2026-01-01'}])expect((await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:{...f.payload,...extra}})).statusCode).toBe(400);
    expect((await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:{...f.payload,costingPolicy:{...f.payload.costingPolicy,currency:'USD'}}})).statusCode).toBe(422);
    expect((await c.app.inject({method:'POST',url:f.url.replace(f.calculation.id,randomUUID()),headers:c.owner,payload:f.payload})).statusCode).toBe(404);
    expect((await c.app.inject({method:'GET',url:`${f.listUrl}/${randomUUID()}`,headers:c.owner})).statusCode).toBe(404);
  });
}
