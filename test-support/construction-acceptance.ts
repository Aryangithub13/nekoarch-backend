import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { calculateConstruction } from '@designflow/construction-calculations';
import { specification } from '../packages/construction-calculations/tests/fixtures.js';
import { authored } from '../packages/blueprint-qa/tests/fixtures.js';
import { ConstructionDetailSchema, ConstructionListSchema } from '../apps/api/src/contracts/construction.js';
import type { ProjectTestContext } from './project-acceptance.js';
export function constructionAcceptance(context:()=>ProjectTestContext) {
  async function setup() {
    const c=context();
    const p=await c.app.inject({method:'POST',url:'/api/projects',headers:c.owner,payload:{title:'Construction acceptance'}});expect(p.statusCode,p.body).toBe(201);
    const revisionUrl=`/api/projects/${p.json().id}/revisions`;
    const r=await c.app.inject({method:'POST',url:revisionUrl,headers:c.owner,payload:{model:authored()}});expect(r.statusCode,r.body).toBe(201);
    const revision=r.json().revision;
    const t=await c.app.inject({method:'POST',url:`${revisionUrl}/${revision.id}/takeoffs`,headers:c.owner,payload:{}});expect(t.statusCode,t.body).toBe(201);
    return {projectId:p.json().id,revision,takeoff:t.json(),url:`${revisionUrl}/${revision.id}/takeoffs/${t.json().id}/construction-calculations`,payload:{specification:specification()}};
  }
  it('persists and retrieves exact calculations without changing source artifacts or leaking through public projects',async()=>{
    const c=context(),f=await setup();
    const response=await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:f.payload});expect(response.statusCode,response.body).toBe(201);
    const dto=ConstructionDetailSchema.parse(response.json());expect(dto.report).toEqual(calculateConstruction(f.takeoff.report,f.payload.specification));
    expect(dto.takeoffId).toBe(f.takeoff.id);expect(dto.acceptanceQaId).toBe(f.revision.qa.id);
    expect((await c.app.inject({method:'GET',url:`${f.url}/${dto.id}`,headers:c.owner})).json()).toEqual(dto);
    expect((await c.app.inject({method:'GET',url:f.url.replace('/construction-calculations',''),headers:c.owner})).json()).toEqual(f.takeoff);
    expect((await c.app.inject({method:'GET',url:`/api/projects/${f.projectId}/revisions/${f.revision.id}`,headers:c.owner})).json()).toEqual(f.revision);
    await c.app.inject({method:'PATCH',url:`/api/projects/${f.projectId}`,headers:c.owner,payload:{visibility:'PUBLIC'}});
    for(const headers of [c.other,{}]) {
      for(const url of [f.url,`${f.url}/${dto.id}`]) expect((await c.app.inject({method:'GET',url,headers})).statusCode).toBe(headers===c.other?404:401);
      expect((await c.app.inject({method:'POST',url:f.url,headers,payload:f.payload})).statusCode).toBe(headers===c.other?404:401);
    }
    expect((await c.app.inject({method:'GET',url:`/api/projects/${f.projectId}/public`})).body).not.toContain(dto.id);
  });
  it('converges concurrent keyed/keyless creates and rejects reuse with changed specifications',async()=>{
    const c=context(),f=await setup(),key=randomUUID();
    const responses=await Promise.all([key,key,randomUUID(),undefined].map(k=>c.app.inject({method:'POST',url:f.url,headers:{...c.owner,...(k?{'idempotency-key':k}:{})},payload:f.payload})));
    for(const response of responses){expect(response.statusCode,response.body).toBe(201);expect(response.json()).toEqual(responses[0]!.json());}
    const normalized={...f.payload.specification,assemblies:[...f.payload.specification.assemblies].reverse(),assignments:[...f.payload.specification.assignments].reverse()};
    expect((await c.app.inject({method:'POST',url:f.url,headers:{...c.owner,'idempotency-key':key},payload:{specification:normalized,options:{quantityDecimalPlaces:9}}})).json()).toEqual(responses[0]!.json());
    const changed={...f.payload.specification,version:'2'};
    const conflict=await c.app.inject({method:'POST',url:f.url,headers:{...c.owner,'idempotency-key':key},payload:{specification:changed}});expect(conflict.statusCode,conflict.body).toBe(409);
    const list=ConstructionListSchema.parse((await c.app.inject({method:'GET',url:f.url,headers:c.owner})).json());expect(list.items).toHaveLength(1);expect(list.items[0]).not.toHaveProperty('report');
  });
  it('keeps specification versions, options and takeoffs distinct with stable pagination',async()=>{
    const c=context(),f=await setup();const ids=new Set<string>();
    for(const payload of [f.payload,{...f.payload,options:{quantityDecimalPlaces:6}},{specification:{...f.payload.specification,version:'2'}}]) {
      const r=await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload});expect(r.statusCode,r.body).toBe(201);ids.add(r.json().id);
    }
    expect(ids.size).toBe(3);const seen=new Set<string>();let cursor:string|null=null;
    for(let i=0;i<3;i++){
      const page=ConstructionListSchema.parse((await c.app.inject({method:'GET',url:`${f.url}?limit=1${cursor?`&cursor=${cursor}`:''}`,headers:c.owner})).json());
      expect(page.items).toHaveLength(1);seen.add(page.items[0]!.id);cursor=page.nextCursor;
    }
    expect(cursor).toBeNull();expect(seen).toEqual(ids);
    const second=await setup();const r=await c.app.inject({method:'POST',url:second.url,headers:c.owner,payload:f.payload});expect(r.statusCode,r.body).toBe(201);expect(ids.has(r.json().id)).toBe(false);
  });
  it('rejects forged report data, invalid recipes, malformed pagination and missing resources',async()=>{
    const c=context(),f=await setup();
    for(const payload of [{...f.payload,report:{}},{...f.payload,takeoffId:randomUUID()},{...f.payload,options:{quantityDecimalPlaces:13}},{specification:{}}])
      expect((await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload})).statusCode).toBe(400);
    const invalid=await c.app.inject({method:'POST',url:f.url,headers:c.owner,payload:{specification:{...f.payload.specification,recipePack:{id:'unknown',version:'1'}}}});expect(invalid.statusCode,invalid.body).toBe(422);
    expect((await c.app.inject({method:'GET',url:`${f.url}?cursor=bad`,headers:c.owner})).statusCode).toBe(400);
    expect((await c.app.inject({method:'GET',url:`${f.url}/${randomUUID()}`,headers:c.owner})).statusCode).toBe(404);
    for(const method of ['GET','POST'] as const){const r=await c.app.inject({method,url:f.url.replace(f.takeoff.id,randomUUID()),headers:c.owner,...(method==='POST'?{payload:f.payload}:{})});expect(r.statusCode,r.body).toBe(404);}
  });
}
