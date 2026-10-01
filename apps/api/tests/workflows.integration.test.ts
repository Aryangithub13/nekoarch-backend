import * as generator from '@designflow/generator';
import * as qa from '@designflow/blueprint-qa';
import { writeFile } from 'node:fs/promises';
import { afterAll,beforeAll,describe,it,expect,vi } from 'vitest';
import { randomUUID,createHmac } from 'node:crypto';
import { startTestDatabase,asPrincipal,createTestUser } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { workflowAcceptance,workflowPayload,workflowSetup } from '../../../test-support/workflow-acceptance.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { WorkflowRequestSchema } from '../src/contracts/workflows.js';
import { resolveWorkflow } from '../src/workflows/sources.js';
import { WorkflowRepository,WORKFLOW_OPERATION } from '../src/lib/workflow-repository.js';
import { workflowFingerprint } from '../src/services/workflow-service.js';
import { signProjectCommit } from '../src/services/project-service.js';
import { takeoffFingerprint } from '../src/services/takeoff-service.js';
describe('workflow persistence, recovery, atomic steps and owner security',()=>{
  let db:Awaited<ReturnType<typeof startTestDatabase>>,app:ReturnType<typeof buildApp>,ownerId:string,otherId:string,secret:string,backend:ReturnType<typeof createPgBackend>;
  const owner={authorization:'Bearer owner'},other={authorization:'Bearer other'},context=()=>({app,owner,other});
  beforeAll(async()=>{
    db=await startTestDatabase();ownerId=await createTestUser(db.pool);otherId=await createTestUser(db.pool);secret=(await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    backend=createPgBackend(db.pool,{owner:ownerId,other:otherId});
    app=buildApp({env:parseEnv({SUPABASE_URL:'http://localhost:54321',SUPABASE_ANON_KEY:'test',NODE_ENV:'test',LOG_LEVEL:'silent',RATE_LIMIT_ENABLED:'false',PROJECT_COMMIT_SECRET:secret}),backend,captureError:()=>undefined});await app.ready();
  });
  afterAll(async()=>{await app?.close();await db?.stop();});
  workflowAcceptance(context);
  it('denies direct mutation, unsigned/forged/cross-user/expired writes and keeps terminals immutable',async()=>{
    const f=await workflowSetup(context()),request=WorkflowRequestSchema.parse(workflowPayload('BLUEPRINT_ONLY'));
    const resolved=await resolveWorkflow(backend.repository('owner'),f.projectId,request);
    const input={action:'begin',projectId:f.projectId,request,inputFingerprint:workflowFingerprint(f.projectId,request),plan:resolved.plan,outputs:[],leaseToken:randomUUID()};
    const sign=(user=ownerId)=>signProjectCommit(secret,user,WORKFLOW_OPERATION,input);
    const rpc=(signed?:ReturnType<typeof sign>,user=ownerId)=>asPrincipal(db.pool,user,c=>c.query('select public.workflow_write($1,null,$2,$3)',[JSON.stringify(input),signed?.envelope??null,signed?.signature??null]));
    await expect(rpc()).rejects.toMatchObject({code:'42501'});await expect(rpc({...sign(),signature:'a'.repeat(64)})).rejects.toMatchObject({code:'42501'});
    await expect(rpc(sign(),otherId)).rejects.toMatchObject({code:'42501'});await expect(rpc(sign(otherId),otherId)).rejects.toMatchObject({code:'P1201'});
    const stale=JSON.parse(sign().envelope);stale.expiresAt=1;const envelope=JSON.stringify(stale);await expect(rpc({envelope,signature:createHmac('sha256',Buffer.from(secret,'hex')).update(envelope).digest('hex')})).rejects.toMatchObject({code:'42501'});
    const r=await app.inject({method:'POST',url:f.url,headers:owner,payload:workflowPayload('BLUEPRINT_ONLY')});expect(r.statusCode,r.body).toBe(201);
    expect((await asPrincipal(db.pool,ownerId,c=>c.query('select id from public.project_workflow_runs where id=$1',[r.json().id]))).rows).toHaveLength(1);
    expect((await asPrincipal(db.pool,otherId,c=>c.query('select id from public.project_workflow_runs where id=$1',[r.json().id]))).rows).toHaveLength(0);
    for(const sql of ['insert into public.project_workflow_runs default values',"update public.project_workflow_runs set status='COMPLETED'",'delete from public.project_workflow_runs'])await expect(asPrincipal(db.pool,ownerId,c=>c.query(sql))).rejects.toMatchObject({code:'42501'});
    await expect(asPrincipal(db.pool,null,c=>c.query('select * from public.project_workflow_runs'))).rejects.toMatchObject({code:'42501'});
    for(const sql of ["update public.project_workflow_runs set status='RUNNING' where id=$1",'delete from public.project_workflow_runs where id=$1'])await expect(db.pool.query(sql,[r.json().id])).rejects.toMatchObject({code:'23514'});
  });
  it('atomically rolls back a revision when its workflow manifest update fails, then resumes without a duplicate',async()=>{
    const f=await workflowSetup(context()),key=randomUUID(),headers={...owner,'idempotency-key':key},payload=workflowPayload('BLUEPRINT_ONLY');
    await db.pool.query(`create function project_private.workflow_test_failure() returns trigger language plpgsql as $$ begin if jsonb_array_length(new.outputs)>0 then raise exception 'injected workflow output failure'; end if; return new; end $$;
      create trigger workflow_test_failure before update on public.project_workflow_runs for each row execute function project_private.workflow_test_failure()`);
    try {const r=await app.inject({method:'POST',url:f.url,headers,payload});expect(r.statusCode,r.body).toBe(500);expect(r.body).not.toContain('injected');}
    finally {await db.pool.query('drop trigger workflow_test_failure on public.project_workflow_runs; drop function project_private.workflow_test_failure()');}
    expect((await db.pool.query('select id from public.project_revisions where project_id=$1',[f.projectId])).rows).toHaveLength(0);
    expect((await app.inject({method:'POST',url:f.url,headers,payload})).statusCode).toBe(409);
    await db.pool.query("update public.project_workflow_runs set lease_expires_at=clock_timestamp()-interval '1 second' where project_id=$1",[f.projectId]);
    const recovered=await app.inject({method:'POST',url:f.url,headers,payload});expect(recovered.statusCode,recovered.body).toBe(201);expect(recovered.json().status).toBe('COMPLETED');
    expect((await db.pool.query('select id from public.project_revisions where project_id=$1',[f.projectId])).rows).toHaveLength(1);
  });
  it('commits terminal state and durable receipt atomically, then resumes already recorded artifacts',async()=>{
    const f=await workflowSetup(context()),key=randomUUID(),headers={...owner,'idempotency-key':key},payload=workflowPayload('BLUEPRINT_ONLY');
    await db.pool.query(`create function project_private.workflow_receipt_failure() returns trigger language plpgsql as $$ begin if new.operation='/api/projects/:projectId/workflows' then raise exception 'injected receipt'; end if; return new; end $$;
      create trigger workflow_receipt_failure before insert on public.idempotency_records for each row execute function project_private.workflow_receipt_failure()`);
    try{const r=await app.inject({method:'POST',url:f.url,headers,payload});expect(r.statusCode,r.body).toBe(500);}finally{await db.pool.query('drop trigger workflow_receipt_failure on public.idempotency_records; drop function project_private.workflow_receipt_failure()');}
    const before=(await db.pool.query('select * from public.project_workflow_runs where project_id=$1',[f.projectId])).rows[0];expect(before.status).toBe('RUNNING');expect(before.outputs).toHaveLength(3);
    expect((await db.pool.query('select * from public.idempotency_records where operation=$1 and key_hash=$2',[WORKFLOW_OPERATION,before.key_hash])).rows).toHaveLength(0);
    await db.pool.query("update public.project_workflow_runs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[before.id]);
    const r=await app.inject({method:'POST',url:f.url,headers,payload});expect(r.statusCode,r.body).toBe(201);expect(r.json().outputs).toEqual(before.outputs);
    expect((await db.pool.query('select id from public.project_revisions where project_id=$1',[f.projectId])).rows).toHaveLength(1);
    expect((await db.pool.query('select response from public.idempotency_records where operation=$1 and key_hash=$2',[WORKFLOW_OPERATION,before.key_hash])).rows[0].response).toEqual(r.json());
  });
  it('fences stale execution tokens and preserves reserved key identity',async()=>{
    const f=await workflowSetup(context()),request=WorkflowRequestSchema.parse(workflowPayload('BLUEPRINT_ONLY')),resolved=await resolveWorkflow(backend.repository('owner'),f.projectId,request);
    const repo=new WorkflowRepository(backend.repository('owner')),leaseToken=randomUUID(),keyHash=takeoffFingerprint('fence');
    const input={projectId:f.projectId,request,inputFingerprint:workflowFingerprint(f.projectId,request),plan:resolved.plan,outputs:[],leaseToken};
    const ctx={operation:WORKFLOW_OPERATION,keyHash,fingerprint:input.inputFingerprint};
    const run=await repo.write('begin',input,ownerId,secret,ctx) as {id:string};
    await expect(repo.write('begin',input,ownerId,secret,ctx)).rejects.toMatchObject({code:'WORKFLOW_IN_PROGRESS'});
    await db.pool.query("update public.project_workflow_runs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[run.id]);
    await repo.write('begin',{...input,leaseToken:randomUUID()},ownerId,secret,ctx);
    await expect(repo.write('finish',{projectId:f.projectId,runId:run.id,leaseToken,errors:[]},ownerId,secret)).rejects.toMatchObject({code:'WORKFLOW_FENCED'});
  });
  it('checks the blueprint-only downstream row counts directly and bounds bodies',async()=>{
    const f=await workflowSetup(context()),r=await app.inject({method:'POST',url:f.url,headers:owner,payload:workflowPayload('BLUEPRINT_ONLY')});expect(r.statusCode,r.body).toBe(201);
    for(const table of ['project_revision_takeoffs','project_revision_construction_calculations','project_revision_cost_estimates'])expect((await db.pool.query(`select id from public.${table} where project_revision_id=$1`,[r.json().sourceRevisionId])).rows).toHaveLength(0);
    expect((await app.inject({method:'POST',url:f.url,headers:owner,payload:{x:'x'.repeat(132000)}})).statusCode).toBe(400);
  });
  it('avoids upstream engine calls on source reuse and records a reviewable real manifest',async()=>{
    const generated=vi.spyOn(generator,'generateBlueprint'),audited=vi.spyOn(qa,'auditBlueprint');
    try {
      const f=await workflowSetup(context()),payload=workflowPayload();
      const a=await app.inject({method:'POST',url:f.url,headers:owner,payload});expect(a.statusCode,a.body).toBe(201);expect(a.json().status).toBe('COMPLETED');
      expect(generated).toHaveBeenCalledTimes(1);expect(audited).toHaveBeenCalledTimes(1);
      const request={...payload,source:{kind:'REVISION',sourceRevisionId:a.json().sourceRevisionId}};
      const b=await app.inject({method:'POST',url:f.url,headers:owner,payload:request});expect(b.statusCode,b.body).toBe(201);expect(b.json().plan.executableCapabilities).toEqual([]);
      expect(generated).toHaveBeenCalledTimes(1);expect(audited).toHaveBeenCalledTimes(1);
      if(process.env.PHASE16_WRITE_EXAMPLE==='1')await writeFile('docs/phase16-example.json',JSON.stringify({note:'Actual disposable PostgreSQL acceptance output; IDs are test artifacts.',completeBuilding:a.json(),reusedWorkflow:b.json()},null,2)+'\n');
    } finally {generated.mockRestore();audited.mockRestore();}
  });
  it('converges concurrent keyed and keyless requests without duplicate revision writes',async()=>{
    for(const key of [randomUUID(),undefined]) {
      const f=await workflowSetup(context()),headers={...owner,...(key?{'idempotency-key':key}:{})},payload=workflowPayload('BLUEPRINT_ONLY');
      const replies=await Promise.all(Array.from({length:3},()=>app.inject({method:'POST',url:f.url,headers,payload})));
      expect(replies.some(r=>r.statusCode===201)).toBe(true);for(const r of replies)expect([201,409]).toContain(r.statusCode);
      const winner=replies.find(r=>r.statusCode===201)!;const replay=await app.inject({method:'POST',url:f.url,headers,payload});expect(replay.json()).toEqual(winner.json());
      expect((await db.pool.query('select id from public.project_revisions where project_id=$1',[f.projectId])).rows).toHaveLength(1);
      expect((await db.pool.query('select id from public.project_workflow_runs where project_id=$1',[f.projectId])).rows).toHaveLength(1);
    }
  });
  it('rejects forged server projections of artifact ids, versions and future capability states',async()=>{
    const f=await workflowSetup(context()),base=await app.inject({method:'POST',url:f.url,headers:owner,payload:workflowPayload('BLUEPRINT_ONLY')});expect(base.statusCode,base.body).toBe(201);
    const request=WorkflowRequestSchema.parse({mode:'BLUEPRINT_ONLY',source:{kind:'REVISION',sourceRevisionId:base.json().sourceRevisionId}});
    const resolved=await resolveWorkflow(backend.repository('owner'),f.projectId,request),repo=new WorkflowRepository(backend.repository('owner'));
    for(const patch of [{artifactId:randomUUID()},{version:'forged'},{capability:'SCENE_3D',artifactType:'SCENE_3D'}]) {
      const outputs=structuredClone(resolved.plan.reusedOutputs);Object.assign(outputs[0]!,patch);
      await expect(repo.write('begin',{projectId:f.projectId,request,inputFingerprint:workflowFingerprint(f.projectId,request),plan:{...resolved.plan,reusedOutputs:outputs},outputs,leaseToken:randomUUID()},ownerId,secret)).rejects.toMatchObject({code:'WORKFLOW_PROVENANCE_FAILED'});
    }
    const leaseToken=randomUUID(),run=await repo.write('begin',{projectId:f.projectId,request,inputFingerprint:workflowFingerprint(f.projectId,request),plan:resolved.plan,outputs:resolved.plan.reusedOutputs,leaseToken},ownerId,secret) as {id:string};
    await expect(repo.write('step',{projectId:f.projectId,runId:run.id,leaseToken,capability:'SCENE_3D',call:{name:'project_write',args:{}}},ownerId,secret)).rejects.toMatchObject({code:'WORKFLOW_PROVENANCE_FAILED'});
  });
  it('fails closed when signing configuration is missing',async()=>{
    const f=await workflowSetup(context()),unconfigured=buildApp({env:parseEnv({SUPABASE_URL:'http://localhost:54321',SUPABASE_ANON_KEY:'test',LOG_LEVEL:'silent',RATE_LIMIT_ENABLED:'false'}),backend});
    try {expect((await unconfigured.inject({method:'POST',url:f.url,headers:owner,payload:workflowPayload('BLUEPRINT_ONLY')})).statusCode).toBe(503);}finally{await unconfigured.close();}
  });

});
