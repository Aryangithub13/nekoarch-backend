import { afterAll,beforeAll,describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDatabase,asPrincipal,createTestUser } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { constructionAcceptance } from '../../../test-support/construction-acceptance.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { calculateConstruction } from '@designflow/construction-calculations';
import { specification } from '../../../packages/construction-calculations/tests/fixtures.js';
import { signProjectCommit } from '../src/services/project-service.js';
import { CONSTRUCTION_OPERATION,constructionFingerprint } from '../src/services/construction-service.js';
describe('construction persistence on PostgreSQL transactions and RLS',()=>{
  let db:Awaited<ReturnType<typeof startTestDatabase>>,app:ReturnType<typeof buildApp>,ownerId:string,otherId:string,secret:string;
  const owner={authorization:'Bearer owner'},other={authorization:'Bearer other'};
  beforeAll(async()=>{
    db=await startTestDatabase();ownerId=await createTestUser(db.pool);otherId=await createTestUser(db.pool);
    secret=(await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app=buildApp({env:parseEnv({SUPABASE_URL:'http://localhost:54321',SUPABASE_ANON_KEY:'test',NODE_ENV:'test',LOG_LEVEL:'silent',RATE_LIMIT_ENABLED:'false',PROJECT_COMMIT_SECRET:secret}),backend:createPgBackend(db.pool,{owner:ownerId,other:otherId}),captureError:()=>undefined});await app.ready();
  });
  afterAll(async()=>{await app?.close();await db?.stop();});
  constructionAcceptance(()=>({app,owner,other}));
  async function setup(){
    const p=await app.inject({method:'POST',url:'/api/projects',headers:owner,payload:{title:'Construction database'}});expect(p.statusCode,p.body).toBe(201);
    const r=await app.inject({method:'POST',url:`/api/projects/${p.json().id}/revisions`,headers:owner,payload:{model:authored()}});expect(r.statusCode,r.body).toBe(201);
    const revision=r.json().revision;
    const t=await app.inject({method:'POST',url:`/api/projects/${p.json().id}/revisions/${revision.id}/takeoffs`,headers:owner,payload:{}});expect(t.statusCode,t.body).toBe(201);
    const takeoff=t.json(),report=calculateConstruction(takeoff.report,specification());
    const input={projectId:p.json().id,projectRevisionId:revision.id,takeoffId:takeoff.id,acceptanceQaId:revision.qa.id,report,inputFingerprint:constructionFingerprint(revision.id,takeoff,report)};
    return {input,takeoff,url:`/api/projects/${input.projectId}/revisions/${revision.id}/takeoffs/${takeoff.id}/construction-calculations`};
  }
  const sign=(input:unknown,userId=ownerId)=>signProjectCommit(secret,userId,CONSTRUCTION_OPERATION,input);
  const rpc=(input:unknown,signature?:ReturnType<typeof sign>,user=ownerId)=>asPrincipal(db.pool,user,c=>c.query('select public.construction_write($1,null,$2,$3) response',[JSON.stringify(input),signature?.envelope ?? null,signature?.signature ?? null]));
  it('rejects unsigned/forged/cross-user writes and enforces owner-only immutable storage',async()=>{
    const {input}=await setup();await expect(rpc(input)).rejects.toMatchObject({code:'42501'});
    await expect(rpc(input,{...sign(input),signature:'a'.repeat(64)})).rejects.toMatchObject({code:'42501'});
    await expect(rpc(input,sign(input),otherId)).rejects.toMatchObject({code:'42501'});
    await expect(rpc(input,sign(input,otherId),otherId)).rejects.toMatchObject({code:'P1201'});
    const dto=(await rpc(input,sign(input))).rows[0].response;
    expect((await asPrincipal(db.pool,ownerId,c=>c.query('select id from public.project_revision_construction_calculations where id=$1',[dto.id]))).rows).toHaveLength(1);
    expect((await asPrincipal(db.pool,otherId,c=>c.query('select id from public.project_revision_construction_calculations where id=$1',[dto.id]))).rows).toHaveLength(0);
    for(const sql of ['insert into public.project_revision_construction_calculations default values',"update public.project_revision_construction_calculations set report_json='{}'",'delete from public.project_revision_construction_calculations'])
      await expect(asPrincipal(db.pool,ownerId,c=>c.query(sql))).rejects.toMatchObject({code:'42501'});
    await expect(asPrincipal(db.pool,null,c=>c.query('select * from public.project_revision_construction_calculations'))).rejects.toMatchObject({code:'42501'});
    await expect(db.pool.query('delete from public.project_revision_construction_calculations where id=$1',[dto.id])).rejects.toMatchObject({code:'23514'});
    await expect(db.pool.query("update public.project_revision_construction_calculations set status='EVALUATED' where id=$1",[dto.id])).rejects.toMatchObject({code:'23514'});
  });
  it('checks exact source identity, accepted QA, report versions and fingerprint inside signed RPC',async()=>{
    const {input}=await setup();
    for(const [change,code] of [[{takeoffId:randomUUID()},'P1301'],[{acceptanceQaId:randomUUID()},'P1402'],[{projectRevisionId:randomUUID()},'P1205'],[{inputFingerprint:'0'.repeat(64)},'P1403'],[{report:{...input.report,takeoffEngineVersion:'forged'}},'P1402']] as const){
      const bad={...input,...change};await expect(rpc(bad,sign(bad))).rejects.toMatchObject({code});
    }
    const second=await setup(),wrongSource={...input,takeoffId:second.takeoff.id};await expect(rpc(wrongSource,sign(wrongSource))).rejects.toMatchObject({code:'P1301'});
    await expect(rpc({...input,inputFingerprint:'1'.repeat(64)},sign(input))).rejects.toMatchObject({code:'42501'});
  });
  it('rejects deterministic report drift and permits distinct engine identities',async()=>{
    const {input,takeoff}=await setup();const original=(await rpc(input,sign(input))).rows[0].response;
    const drift={...input,report:{...input.report,warnings:[{code:'DRIFT',takeoffItemId:null}]}};await expect(rpc(drift,sign(drift))).rejects.toMatchObject({code:'P1403'});
    const report={...input.report,engineVersion:'construction-future'};
    const future={...input,report,inputFingerprint:constructionFingerprint(input.projectRevisionId,takeoff,report as typeof input.report)};
    expect((await rpc(future,sign(future))).rows[0].response.id).not.toBe(original.id);
  });
  it('rolls back artifact and receipt together on receipt insertion failure',async()=>{
    const {url,input}=await setup();
    await db.pool.query(`create function project_private.construction_test_failure() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;
      create trigger construction_test_failure before insert on public.idempotency_records for each row execute function project_private.construction_test_failure()`);
    try{const response=await app.inject({method:'POST',url,headers:{...owner,'idempotency-key':randomUUID()},payload:{specification:specification()}});expect(response.statusCode).toBe(500);expect(response.body).not.toContain('injected');}
    finally{await db.pool.query('drop trigger construction_test_failure on public.idempotency_records; drop function project_private.construction_test_failure()');}
    expect((await db.pool.query('select id from public.project_revision_construction_calculations where takeoff_id=$1',[input.takeoffId])).rows).toHaveLength(0);
    expect((await app.inject({method:'POST',url,headers:owner,payload:{specification:specification()}})).statusCode).toBe(201);
  });
  it('fails closed without signing configuration and applies body limits',async()=>{
    const {url}=await setup();const unconfigured=buildApp({env:parseEnv({SUPABASE_URL:'http://localhost:54321',SUPABASE_ANON_KEY:'test',LOG_LEVEL:'silent',RATE_LIMIT_ENABLED:'false'}),backend:createPgBackend(db.pool,{owner:ownerId})});
    try{expect((await unconfigured.inject({method:'POST',url,headers:owner,payload:{specification:specification()}})).statusCode).toBe(503);}finally{await unconfigured.close();}
    expect((await app.inject({method:'POST',url,headers:owner,payload:{specification:{x:'x'.repeat(151000)}}})).statusCode).toBe(400);
  });
});
