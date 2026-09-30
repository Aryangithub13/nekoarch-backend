import { afterAll,beforeAll,describe,it,expect } from 'vitest';
import { randomUUID,createHmac,createHash } from 'node:crypto';
import { startTestDatabase,asPrincipal,createTestUser } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { costAcceptance,costSetup } from '../../../test-support/cost-acceptance.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { calculateBoqCost,sampleRateBook,sampleCostingPolicy,costHash } from '@designflow/boq-cost';
import { signProjectCommit } from '../src/services/project-service.js';
import { COST_OPERATION,costInputFingerprint } from '../src/services/cost-service.js';
import type { IdempotencyContext } from '../src/lib/repository.js';
describe('cost persistence, signatures, PostgreSQL transactions and RLS',()=>{
  let db:Awaited<ReturnType<typeof startTestDatabase>>,app:ReturnType<typeof buildApp>,ownerId:string,otherId:string,secret:string;
  const owner={authorization:'Bearer owner'},other={authorization:'Bearer other'};
  const context=()=>({app,owner,other});
  beforeAll(async()=>{
    db=await startTestDatabase();ownerId=await createTestUser(db.pool);otherId=await createTestUser(db.pool);secret=(await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app=buildApp({env:parseEnv({SUPABASE_URL:'http://localhost:54321',SUPABASE_ANON_KEY:'test',NODE_ENV:'test',LOG_LEVEL:'silent',RATE_LIMIT_ENABLED:'false',PROJECT_COMMIT_SECRET:secret}),backend:createPgBackend(db.pool,{owner:ownerId,other:otherId}),captureError:()=>undefined});await app.ready();
  });
  afterAll(async()=>{await app?.close();await db?.stop();});
  costAcceptance(context);
  async function setup(){const f=await costSetup(context()),report=calculateBoqCost(f.calculation.report,sampleRateBook(),sampleCostingPolicy());
    return {...f,input:{projectId:f.projectId,projectRevisionId:f.revision.id,takeoffId:f.takeoff.id,constructionCalculationId:f.calculation.id,acceptanceQaId:f.revision.qa.id,
      constructionReportHash:costHash(f.calculation.report),inputFingerprint:costInputFingerprint(f.revision.id,f.calculation,report),reportHash:costHash(report),report}};}
  const sign=(input:unknown,userId=ownerId,context?:IdempotencyContext)=>signProjectCommit(secret,userId,COST_OPERATION,input,context);
  const rpc=(input:unknown,signature?:ReturnType<typeof sign>,user=ownerId,context?:IdempotencyContext)=>asPrincipal(db.pool,user,c=>c.query('select public.cost_write($1,$2,$3,$4) response',[JSON.stringify(input),context?JSON.stringify(context):null,signature?.envelope??null,signature?.signature??null]));
  it('enforces unsigned/forged/expired/cross-user attestation and immutable owner-only rows',async()=>{
    const {input}=await setup();await expect(rpc(input)).rejects.toMatchObject({code:'42501'});
    await expect(rpc(input,{...sign(input),signature:'a'.repeat(64)})).rejects.toMatchObject({code:'42501'});
    await expect(rpc(input,sign(input),otherId)).rejects.toMatchObject({code:'42501'});
    await expect(rpc(input,sign(input,otherId),otherId)).rejects.toMatchObject({code:'P1201'});
    const old=JSON.parse(sign(input).envelope);old.expiresAt=1;const envelope=JSON.stringify(old),signature=createHmac('sha256',Buffer.from(secret,'hex')).update(envelope).digest('hex');
    await expect(rpc(input,{envelope,signature})).rejects.toMatchObject({code:'42501'});
    const dto=(await rpc(input,sign(input))).rows[0].response;
    expect((await asPrincipal(db.pool,ownerId,c=>c.query('select id from public.project_revision_cost_estimates where id=$1',[dto.id]))).rows).toHaveLength(1);
    expect((await asPrincipal(db.pool,otherId,c=>c.query('select id from public.project_revision_cost_estimates where id=$1',[dto.id]))).rows).toHaveLength(0);
    for(const sql of ['insert into public.project_revision_cost_estimates default values',"update public.project_revision_cost_estimates set report_json='{}'",'delete from public.project_revision_cost_estimates'])await expect(asPrincipal(db.pool,ownerId,c=>c.query(sql))).rejects.toMatchObject({code:'42501'});
    await expect(asPrincipal(db.pool,null,c=>c.query('select * from public.project_revision_cost_estimates'))).rejects.toMatchObject({code:'42501'});
    for(const sql of ['delete from public.project_revision_cost_estimates where id=$1',"update public.project_revision_cost_estimates set coverage='FULLY_PRICED' where id=$1"])await expect(db.pool.query(sql,[dto.id])).rejects.toMatchObject({code:'23514'});
  });
  it('independently checks ancestor identity, source versions, hashes and monetary reconciliation',async()=>{
    const {input}=await setup(),second=await setup();
    for(const [change,code] of [[{constructionCalculationId:second.calculation.id},'P1401'],[{takeoffId:randomUUID()},'P1401'],[{acceptanceQaId:randomUUID()},'P1502'],[{constructionReportHash:'0'.repeat(64)},'P1502'],[{inputFingerprint:'0'.repeat(64)},'P1503'],[{reportHash:'0'.repeat(64)},'P1503']] as const){const bad={...input,...change};await expect(rpc(bad,sign(bad))).rejects.toMatchObject({code});}
    for(const report of [{...input.report,rateBookHash:'0'.repeat(64)},{...input.report,costingPolicyHash:'0'.repeat(64)},{...input.report,finalTotals:{...input.report.finalTotals,pricedGrandTotal:'0.00'}}]){const bad={...input,report,reportHash:costHash(report)};await expect(rpc(bad,sign(bad))).rejects.toMatchObject({code:'P1503'});}
    const changed={...input,report:{...input.report,source:{...input.report.source,constructionEngineVersion:'forged'}}};await expect(rpc(changed,sign(changed))).rejects.toMatchObject({code:'P1502'});
    await expect(rpc({...input,reportHash:'f'.repeat(64)},sign(input))).rejects.toMatchObject({code:'42501'});
  });
  it('enforces composite source-chain and snapshot checks even for privileged inserts',async()=>{
    const f=await setup(),g=await setup(),dto=(await rpc(f.input,sign(f.input))).rows[0].response;
    const row=(await db.pool.query('select * from public.project_revision_cost_estimates where id=$1',[dto.id])).rows[0];
    for(const [patch,code] of [[{construction_calculation_id:g.calculation.id},'23503'],[{rate_book_hash:'0'.repeat(64)},'23514'],[{currency:'USD'},'23514'],[{report_hash:'0'.repeat(64)},'23514']] as const){
      const forged={...row,...patch,id:randomUUID(),input_fingerprint:costHash(randomUUID())};
      await expect(db.pool.query('insert into public.project_revision_cost_estimates select (jsonb_populate_record(null::public.project_revision_cost_estimates,$1)).*',[JSON.stringify(forged)])).rejects.toMatchObject({code});
    }
  });
  it('preserves historical estimates and separates unversioned book/policy changes in fingerprints',async()=>{
    const f=await setup(),original=(await rpc(f.input,sign(f.input))).rows[0].response;
    const b=sampleRateBook();b.entries[0]!.rate='123';const p=sampleCostingPolicy();p.adjustments[0]!.value='11';p.adjustments[0]!.label='मज़दूरी — synthetic charge 🧱';
    for(const report of [calculateBoqCost(f.calculation.report,b,sampleCostingPolicy()),calculateBoqCost(f.calculation.report,sampleRateBook(),p)]){
      const input={...f.input,report,reportHash:costHash(report),inputFingerprint:costInputFingerprint(f.revision.id,f.calculation,report)};
      expect(input.inputFingerprint).not.toBe(f.input.inputFingerprint);expect((await rpc(input,sign(input))).rows[0].response.id).not.toBe(original.id);
    }
    expect((await rpc(f.input,sign(f.input))).rows[0].response).toEqual(original);
    const drift={...f.input,report:{...f.input.report,assumptions:['drift']}};const bad={...drift,reportHash:costHash(drift.report)};await expect(rpc(bad,sign(bad))).rejects.toMatchObject({code:'P1503'});
  });
  it.each(['artifact','receipt','projection'] as const)('rolls back artifact and receipt on %s failure',async(point)=>{
    const f=await setup(),key=randomUUID();
    if(point==='projection')await db.pool.query(`alter function project_private.cost_summary(public.project_revision_cost_estimates) rename to cost_summary_original;
      create function project_private.cost_summary(public.project_revision_cost_estimates) returns jsonb language plpgsql as $$ begin raise exception 'injected projection'; end $$`);
    else await db.pool.query(`create function project_private.cost_test_failure() returns trigger language plpgsql as $$ begin raise exception 'injected ${point}'; end $$;
      create trigger cost_test_failure before insert on public.${point==='artifact'?'project_revision_cost_estimates':'idempotency_records'} for each row execute function project_private.cost_test_failure()`);
    try{const r=await app.inject({method:'POST',url:f.url,headers:{...owner,'idempotency-key':key},payload:f.payload});expect(r.statusCode,r.body).toBe(500);expect(r.body).not.toContain('injected');}
    finally{if(point==='projection')await db.pool.query('drop function project_private.cost_summary(public.project_revision_cost_estimates); alter function project_private.cost_summary_original(public.project_revision_cost_estimates) rename to cost_summary');
      else await db.pool.query(`drop trigger cost_test_failure on public.${point==='artifact'?'project_revision_cost_estimates':'idempotency_records'}; drop function project_private.cost_test_failure()`);}
    expect((await db.pool.query('select id from public.project_revision_cost_estimates where construction_calculation_id=$1',[f.calculation.id])).rows).toHaveLength(0);
    expect((await db.pool.query('select key_hash from public.idempotency_records where user_id=$1 and operation=$2 and key_hash=$3',[ownerId,COST_OPERATION,createHash('sha256').update(key).digest('hex')])).rows).toHaveLength(0);
    expect((await app.inject({method:'POST',url:f.url,headers:{...owner,'idempotency-key':key},payload:f.payload})).statusCode).toBe(201);
  });
  it('fails closed without configuration and bounds request bodies',async()=>{
    const f=await setup(),unconfigured=buildApp({env:parseEnv({SUPABASE_URL:'http://localhost:54321',SUPABASE_ANON_KEY:'test',LOG_LEVEL:'silent',RATE_LIMIT_ENABLED:'false'}),backend:createPgBackend(db.pool,{owner:ownerId})});
    try{expect((await unconfigured.inject({method:'POST',url:f.url,headers:owner,payload:f.payload})).statusCode).toBe(503);}finally{await unconfigured.close();}
    expect((await app.inject({method:'POST',url:f.url,headers:owner,payload:{costingPolicy:{x:'x'.repeat(71000)}}})).statusCode).toBe(400);
  });
});
