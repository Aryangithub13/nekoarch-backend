import { readBim } from '../apps/api/src/services/bim-service.js';
import { buildApp } from '../apps/api/src/app.js';
import { parseEnv } from '../apps/api/src/config/env.js';
import { bimRepository } from './bim-repository.js';
import { beforeAll,describe,expect,it } from 'vitest';
import type { ProjectTestContext } from './project-acceptance.js';
import { parametricInput } from './parametric-fixtures.js';
import { BimModelSchema } from '../apps/api/src/bim/contracts.js';
export function bimAcceptance(context:()=>ProjectTestContext) {
  describe('Phase 23 BIM acceptance',()=>{
  async function setup() {
    const {app,owner,other}=context();
    const created=await app.inject({method:'POST',url:'/api/projects',headers:owner,payload:{title:'Phase 23 BIM acceptance'}});
    expect(created.statusCode,created.body).toBe(201);const projectId=created.json().id;
    const first=await app.inject({method:'POST',url:`/api/projects/${projectId}/revisions/generate`,headers:owner,payload:{requirements:parametricInput(true)}});
    expect(first.statusCode,first.body).toBe(201);const revision=first.json().revision,base=`/api/projects/${projectId}/revisions/${revision.id}/bim`;
    const read=await app.inject({url:base,headers:owner});expect(read.statusCode,read.body).toBe(200);
    const bim=BimModelSchema.parse(read.json().model);
    return {app,owner,other,projectId,revision,base,read,bim};
  }
  let fixture:Awaited<ReturnType<typeof setup>>;
  beforeAll(async()=>{fixture=await setup();});
  it('enforces owner-only BIM/IFC downloads and redacted failure envelopes',async()=>{
    const {app,owner,other,projectId,revision,base,read,bim}=fixture;
    const corrupted = structuredClone(revision); corrupted.identity.modelHash = '0'.repeat(64);
    await expect(readBim(bimRepository(async()=>corrupted),projectId,revision.id)).rejects.toMatchObject({code:'BIM_SOURCE_MISMATCH'});
    const unaccepted = structuredClone(revision); unaccepted.qaRuns[0].status = 'FAIL';
    await expect(readBim(bimRepository(async()=>unaccepted),projectId,revision.id)).rejects.toMatchObject({code:'REVISION_NOT_ACCEPTED'});
    let stored:unknown=corrupted;
    const failingApp=buildApp({env:parseEnv({NODE_ENV:'test',SUPABASE_URL:'http://localhost:54321',SUPABASE_ANON_KEY:'test',LOG_LEVEL:'silent',RATE_LIMIT_ENABLED:'false'}),backend:{authenticate:async()=>({id:projectId}),repository:()=>bimRepository(async()=>{if(stored instanceof Error) throw stored;return stored;})},captureError:()=>undefined});
    try {
      for(const [value,code] of [[corrupted,'BIM_SOURCE_MISMATCH'],[unaccepted,'REVISION_NOT_ACCEPTED']] as const) {
        stored=value;const response=await failingApp.inject({url:base+'/export.ifc',headers:owner});
        expect(response.statusCode,response.body).toBe(422);expect(response.json().error.code).toBe(code);
      }
      stored=new Error('sensitive-internal-fixture-detail');
      const internal=await failingApp.inject({url:base,headers:owner});
      expect(internal.statusCode).toBe(500);expect(internal.json().error.code).toBe('INTERNAL_ERROR');expect(internal.body).not.toContain('sensitive-internal-fixture-detail');
    } finally {await failingApp.close();}
    expect(bim.binding.modelHash).toBe(revision.identity.modelHash);
    const jsonExport=await app.inject({url:base+'/export.json',headers:owner});
    expect(jsonExport.statusCode,jsonExport.body).toBe(200);expect(jsonExport.json()).toEqual(bim);
    expect(jsonExport.headers['content-type']).toContain('application/json');expect(jsonExport.headers['cache-control']).toBe('no-store');
    expect(jsonExport.headers['content-disposition']).toBe(`attachment; filename="bim-${revision.id}.json"`);
    expect((await app.inject({url:base+'/validation',headers:owner})).json()).toEqual(read.json().validation);
    const inspected=await app.inject({url:base+`/elements/${bim.elements[0]!.id}`,headers:owner});
    expect(inspected.statusCode,inspected.body).toBe(200);expect(inspected.json().element).toEqual(bim.elements[0]);
    for (const suffix of ['','/validation','/elements','/relationships','/export.json','/export.ifc',`/elements/${bim.elements[0]!.id}`,`/diff/${revision.id}`]) {
      const unauthorized=await app.inject({url:base+suffix,headers:other});expect(unauthorized.statusCode,unauthorized.body).toBe(404);
      expect((await app.inject({url:base+suffix})).statusCode).toBe(401);
    }
    const ifc=await app.inject({url:base+'/export.ifc',headers:owner});expect(ifc.statusCode,ifc.body.slice(0,300)).toBe(200);expect(ifc.body).toMatch(/^ISO-10303-21;/);expect(ifc.headers['content-type']).toContain('application/x-step');expect(ifc.headers['cache-control']).toBe('no-store');
    expect(ifc.headers['content-disposition']).toContain(revision.id);
  });
  it('traverses every element page',async()=>{
    const {app,owner,base,bim}=fixture;
    const ids:string[]=[];let after:string|null=null;
    do { const p: Awaited<ReturnType<typeof app.inject>>=await app.inject({url:base+`/elements?limit=7${after?'&after='+after:''}`,headers:owner});expect(p.statusCode,p.body).toBe(200);ids.push(...p.json().items.map((e:{id:string})=>e.id));after=p.json().nextAfter; } while(after);
    expect(ids).toEqual(bim.elements.map(e=>e.id));
  });
  it('traverses filtered relationships and rejects invalid pagination queries',async()=>{
    const {app,owner,base,bim}=fixture;
    const hosts=await app.inject({url:base+'/relationships?kind=hosts&limit=100',headers:owner});
    expect(hosts.statusCode,hosts.body).toBe(200);
    expect(hosts.json().items).toEqual(bim.relationships.filter(r=>r.kind==='hosts'));
    expect((await app.inject({url:base+'/relationships?kind=wall',headers:owner})).statusCode).toBe(400);
    for (const [route,kind,expected] of [
      ['elements','wall',bim.elements.filter(e=>e.kind==='wall')],
      ['relationships','hosts',bim.relationships.filter(r=>r.kind==='hosts')],
      ['relationships','',bim.relationships],
    ] as const) {
      const seen:string[]=[];let cursor:string|null=null;
      do {
        const response: Awaited<ReturnType<typeof app.inject>>=await app.inject({url:base+`/${route}?limit=13${kind?'&kind='+kind:''}${cursor?'&after='+cursor:''}`,headers:owner});
        expect(response.statusCode,response.body).toBe(200);expect(response.json().binding).toEqual(bim.binding);
        seen.push(...response.json().items.map((e:{id:string})=>e.id));cursor=response.json().nextAfter;
        expect(seen.length).toBeLessThanOrEqual(expected.length);
      } while(cursor);
      expect(seen).toEqual(expected.map(e=>e.id));
    }
    for (const route of ['elements','relationships']) {
      const all=route==='elements'?bim.elements:bim.relationships;
      const defaultPage=await app.inject({url:base+'/'+route,headers:owner});
      expect(defaultPage.json().items).toEqual(all.slice(0,50));expect(defaultPage.json().nextAfter).toBe(all[49]!.id);
      for(const query of ['limit=0','limit=101','after=bim-'+'0'.repeat(40),'unknown=value']) expect((await app.inject({url:base+'/'+route+'?'+query,headers:owner})).statusCode).toBe(400);
    }
    expect((await app.inject({url:base+'/relationships?kind=hosts&after='+bim.relationships.find(r=>r.kind==='contains')!.id,headers:owner})).statusCode).toBe(400);
    expect((await app.inject({url:base+'/elements?kind=wall&after='+bim.elements.find(e=>e.kind==='space')!.id,headers:owner})).statusCode).toBe(400);
    for(const suffix of ['/elements?limit=101','/elements?after=invalid','/export.ifc?path=../../private','?arbitrary=value']) expect((await app.inject({url:base+suffix,headers:owner})).statusCode).toBe(400);
  });
  it('compares revisions while preserving immutable snapshots and project isolation',async()=>{
    const {app,owner,projectId,revision,base,read,bim}=fixture;
    const input=parametricInput(true);input.parametricArchitecture.floors[0]!.westWingWidthMm=10000;
    const changed=await app.inject({method:'POST',url:`/api/projects/${projectId}/revisions/generate`,headers:owner,payload:{requirements:input,baseRevisionId:revision.id}});
    expect(changed.statusCode,changed.body).toBe(201);
    const diff=await app.inject({url:base+`/diff/${changed.json().revision.id}`,headers:owner});expect(diff.statusCode,diff.body).toBe(200);expect(diff.json().changes.some((c:{changes:string[]})=>c.changes.includes('MODIFIED_GEOMETRY'))).toBe(true);
    expect((await app.inject({url:base,headers:owner})).body).toBe(read.body);
    const secondProject=await app.inject({method:'POST',url:'/api/projects',headers:owner,payload:{title:'Phase 23 unrelated project'}});
    expect((await app.inject({url:`/api/projects/${secondProject.json().id}/revisions/${revision.id}/bim/export.ifc`,headers:owner})).statusCode).toBe(404);
    expect((await app.inject({url:`/api/projects/${secondProject.json().id}/revisions/${revision.id}/bim/diff/${changed.json().revision.id}`,headers:owner})).statusCode).toBe(404);
    const newBase=`/api/projects/${projectId}/revisions/${changed.json().revision.id}/bim`;
    const nextRead=await app.inject({url:newBase,headers:owner});expect(nextRead.statusCode,nextRead.body).toBe(200);
    const next=BimModelSchema.parse(nextRead.json().model),removed=bim.elements.find(e=>!next.elements.some(n=>n.id===e.id))!;
    expect(removed).toBeDefined();
    expect((await app.inject({url:newBase+'/elements?after='+removed.id,headers:owner})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:base,headers:owner,payload:bim})).statusCode).toBe(404);
  });
  });
}
