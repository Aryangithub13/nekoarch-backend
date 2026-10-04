import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, createTestUser, asPrincipal } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { conversationAcceptance } from '../../../test-support/conversation-acceptance.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createHmac, randomUUID } from 'node:crypto';
import { ConversationSchema } from '../src/contracts/conversations.js';
import { ConversationRepository } from '../src/lib/conversation-repository.js';
import { initialConversation, planConversation } from '../src/ai/conversation-planner.js';

describe('Phase 20 real PostgreSQL conversation acceptance',()=>{
  let db:Awaited<ReturnType<typeof startTestDatabase>>,app:ReturnType<typeof buildApp>,ownerId:string,otherId:string;
  const owner={authorization:'Bearer owner'},other={authorization:'Bearer other'};
  beforeAll(async()=>{db=await startTestDatabase();ownerId=await createTestUser(db.pool);otherId=await createTestUser(db.pool);
    const secret=(await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app=buildApp({env:parseEnv({SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'test',NODE_ENV:'test',LOG_LEVEL:'silent',RATE_LIMIT_ENABLED:'false',PROJECT_COMMIT_SECRET:secret}),backend:createPgBackend(db.pool,{owner:ownerId,other:otherId})});await app.ready();});
  afterAll(async()=>{await app?.close();await db?.stop();});
  conversationAcceptance(()=>({app,owner,other}),process.env.PHASE20_EXAMPLE_PATH);
  async function fixture() {
    const project=await app.inject({method:'POST',url:'/api/projects',headers:owner,payload:{title:'Stabilization isolated fixture'}});
    expect(project.statusCode).toBe(201);
    const projectId=project.json().id as string,conversationId=randomUUID(),params={projectId,conversationId};
    const url=`/api/projects/${projectId}/conversations/${conversationId}`;
    const created=await app.inject({method:'POST',url:`/api/projects/${projectId}/conversations`,headers:owner,payload:{conversationId,baseRevisionId:null}});
    expect(created.statusCode).toBe(200);
    const payload={messageId:randomUUID(),expectedVersion:0,baseRevisionId:null,text:'30 by 50 feet 3BHK'};
    const response=await app.inject({method:'POST',url:`${url}/messages`,headers:owner,payload});expect(response.statusCode,response.body).toBe(200);
    const state=ConversationSchema.parse(response.json()).state,p=state.proposal!;
    const approval={proposalId:p.id,proposalVersion:p.version,requirementsHash:p.requirementsHash,baseRevisionId:null,approve:true};
    const secret=(await db.pool.query('select secret from project_private.commit_key')).rows[0].secret as string;
    const repository=new ConversationRepository(createPgBackend(db.pool,{owner:ownerId}).repository('owner'),ownerId,secret);
    return {params,url,state,approval,repository};
  }
  it('rejects every mismatched approval identity and expired proposals without creating revisions',async()=>{
    const c=await fixture();
    for(const patch of [{proposalId:randomUUID()},{proposalVersion:2},{requirementsHash:'0'.repeat(64)},{baseRevisionId:randomUUID()},{approve:false},{geometry:{}}]) {
      const response=await app.inject({method:'POST',url:`${c.url}/proposals/approve`,headers:owner,payload:{...c.approval,...patch}});
      expect([400,409]).toContain(response.statusCode);
    }
    await db.pool.query("update architectural_conversations set state=jsonb_set(state,'{proposal,expiresAt}',to_jsonb('2000-01-01T00:00:00.000Z'::text)) where id=$1",[c.params.conversationId]);
    expect((await app.inject({method:'POST',url:`${c.url}/proposals/approve`,headers:owner,payload:c.approval})).statusCode).toBe(409);
    expect((await db.pool.query('select revision_count from projects where id=$1',[c.params.projectId])).rows[0].revision_count).toBe(0);
  });
  it('commits only one revision under concurrent approvals and preserves it after conversation deletion',async()=>{
    const c=await fixture();
    const results=await Promise.all(Array.from({length:4},()=>app.inject({method:'POST',url:`${c.url}/proposals/approve`,headers:owner,payload:c.approval})));
    const accepted=results.find(r=>r.statusCode===200);expect(accepted).toBeDefined();expect(results.every(r=>[200,409].includes(r.statusCode))).toBe(true);
    for(const response of results.filter(r=>r.statusCode===200)) expect(response.json()).toEqual(accepted!.json());
    const retry=await app.inject({method:'POST',url:`${c.url}/proposals/approve`,headers:owner,payload:c.approval});expect(retry.json()).toEqual(accepted!.json());
    expect((await db.pool.query('select revision_count from projects where id=$1',[c.params.projectId])).rows[0].revision_count).toBe(1);
    const before=(await db.pool.query('select md5(model_json::text) digest from project_revisions where project_id=$1',[c.params.projectId])).rows;
    expect((await app.inject({method:'DELETE',url:c.url,headers:owner})).statusCode).toBe(200);
    expect((await db.pool.query('select md5(model_json::text) digest from project_revisions where project_id=$1',[c.params.projectId])).rows).toEqual(before);
  });
  it('recovers abandoned message leases and rejects late workers without losing accepted intent',async()=>{
    const c=await fixture(),oldToken=randomUUID(),newToken=randomUUID(),messageId=randomUUID();
    const input={...c.params,messageId,expectedVersion:1,baseRevisionId:null,fingerprint:'fixture',token:oldToken};
    await c.repository.write('reserve',input);
    await expect(c.repository.write('reserve',{...input,token:newToken})).rejects.toMatchObject({code:'MESSAGE_IN_PROGRESS'});
    await db.pool.query("update architectural_conversations set pending_until=clock_timestamp()-interval '1 second' where id=$1",[c.params.conversationId]);
    await c.repository.write('reserve',{...input,token:newToken});
    const state=await planConversation(c.state,{messageId,expectedVersion:1,baseRevisionId:null,text:'two floors'});
    await expect(c.repository.write('finish',{...c.params,token:oldToken,state})).rejects.toMatchObject({code:'PROPOSAL_CONFLICT'});
    const finished=ConversationSchema.parse(await c.repository.write('finish',{...c.params,token:newToken,state}));
    expect(finished.state.requirements?.floors).toBe(2);expect(finished.state.intent.bedrooms).toBe(3);
    expect(await c.repository.write('reserve',{...input,token:randomUUID()})).toMatchObject({replay:true,conversation:finished});
  });
  it('rolls back the revision and QA when receipt persistence fails, then recovers the approval lease',async()=>{
    const c=await fixture();
    // Fault injection is confined to this disposable PostgreSQL instance.
    await db.pool.query(`create function public.stabilization_fail_receipt() returns trigger language plpgsql as $$ begin
      if new.state->>'status'='SUBMITTED' then raise exception 'fixture receipt failure'; end if; return new; end $$;
      create trigger stabilization_fail_receipt before update on architectural_conversations for each row execute function public.stabilization_fail_receipt()`);
    try {
      const response=await app.inject({method:'POST',url:`${c.url}/proposals/approve`,headers:owner,payload:c.approval});expect(response.statusCode).toBe(500);
      expect((await db.pool.query('select count(*)::int n from project_revisions where project_id=$1',[c.params.projectId])).rows[0].n).toBe(0);
      expect((await db.pool.query('select revision_count from projects where id=$1',[c.params.projectId])).rows[0].revision_count).toBe(0);
      expect((await app.inject({method:'POST',url:`${c.url}/proposals/approve`,headers:owner,payload:c.approval})).statusCode).toBe(409);
    } finally { await db.pool.query('drop trigger stabilization_fail_receipt on architectural_conversations; drop function public.stabilization_fail_receipt()'); }
    await db.pool.query("update architectural_conversations set pending_until=clock_timestamp()-interval '1 second' where id=$1",[c.params.conversationId]);
    const response=await app.inject({method:'POST',url:`${c.url}/proposals/approve`,headers:owner,payload:c.approval});expect(response.statusCode,response.body).toBe(200);
    expect((await db.pool.query('select revision_count from projects where id=$1',[c.params.projectId])).rows[0].revision_count).toBe(1);
  });
  it('enforces project and owner conversation quotas under concurrent creation',async()=>{
    const uid=await createTestUser(db.pool),secret=(await db.pool.query('select secret from project_private.commit_key')).rows[0].secret as string;
    const repository=new ConversationRepository(createPgBackend(db.pool,{fixture:uid}).repository('fixture'),uid,secret);
    const projectIds:string[]=[];
    for(let i=0;i<6;i++) projectIds.push((await db.pool.query("insert into projects(owner_id,title) values($1,'quota fixture') returning id",[uid])).rows[0].id as string);
    const create=(projectId:string)=>repository.write('create',{projectId,conversationId:randomUUID(),state:initialConversation(null,null,false)});
    const first=await Promise.allSettled(Array.from({length:24},()=>create(projectIds[0]!)));
    expect(first.filter(r=>r.status==='fulfilled')).toHaveLength(20);
    for(const result of first) if(result.status==='rejected') expect(result.reason).toMatchObject({code:'CONVERSATION_LIMIT'});
    for(const projectId of projectIds.slice(1,4)) await Promise.all(Array.from({length:20},()=>create(projectId)));
    await Promise.all(Array.from({length:19},()=>create(projectIds[4]!)));
    const last=await Promise.allSettled(Array.from({length:5},()=>create(projectIds[5]!)));
    expect(last.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    for(const result of last) if(result.status==='rejected') expect(result.reason).toMatchObject({code:'CONVERSATION_LIMIT'});
    expect((await db.pool.query('select count(*)::int n from architectural_conversations where owner_id=$1',[uid])).rows[0].n).toBe(100);
  });
  it('enforces the 100-transition limit and JSONB state ceiling in actual PostgreSQL',async()=>{
    const c=await fixture();
    await db.pool.query("update architectural_conversations set state=jsonb_set(state,'{version}','100') where id=$1",[c.params.conversationId]);
    await expect(c.repository.write('reserve',{...c.params,messageId:randomUUID(),expectedVersion:100,baseRevisionId:null,fingerprint:'fixture',token:randomUUID()})).rejects.toMatchObject({code:'CONVERSATION_LIMIT'});
    await expect(db.pool.query("update architectural_conversations set state=jsonb_set(state,'{summary}',to_jsonb(repeat('x',131073))) where id=$1",[c.params.conversationId])).rejects.toMatchObject({code:'23514'});
  });
  it('rejects tampered, expired, cross-owner and cross-operation signed envelopes',async()=>{
    const c=await fixture(),secret=(await db.pool.query('select secret from project_private.commit_key')).rows[0].secret as string;
    const input={...c.params},expiresAt=Math.floor(Date.now()/1000)+300;
    for(const changed of [{userId:otherId},{operation:'conversation:create'},{input:{...input,projectId:randomUUID()}},{expiresAt:1},{expiresAt:expiresAt+3600}]) {
      const envelope=JSON.stringify({userId:ownerId,operation:'conversation:delete',input,expiresAt,...changed});
      const signature=createHmac('sha256',Buffer.from(secret,'hex')).update(envelope).digest('hex');
      await expect(asPrincipal(db.pool,ownerId,client=>client.query('select conversation_write($1,$2,$3,$4)',['delete',input,envelope,signature]))).rejects.toMatchObject({code:'42501'});
    }
    expect((await app.inject({url:c.url,headers:owner})).statusCode).toBe(200);
  });
  it('replays a committed approval after a lost response and API reconstruction',async()=>{
    const c=await fixture(),secret=(await db.pool.query('select secret from project_private.commit_key')).rows[0].secret as string;
    const backend=createPgBackend(db.pool,{owner:ownerId}),original=backend.repository;
    let dropped=false;
    backend.repository=token=>{
      const repo=original(token),rpc=repo.conversationRpc!;
      repo.conversationRpc=async(name,args)=>{
        const result=await rpc(name,args);
        if(name==='conversation_write'&&args.p_action==='submit'&&!dropped){dropped=true;throw new Error('fixture lost committed response');}
        return result;
      };return repo;
    };
    const transient=buildApp({env:parseEnv({SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'test',NODE_ENV:'test',LOG_LEVEL:'silent',RATE_LIMIT_ENABLED:'false',PROJECT_COMMIT_SECRET:secret}),backend});
    try {
      await transient.ready();
      expect((await transient.inject({method:'POST',url:`${c.url}/proposals/approve`,headers:owner,payload:c.approval})).statusCode).toBe(500);
    } finally {await transient.close();}
    const replay=await app.inject({method:'POST',url:`${c.url}/proposals/approve`,headers:owner,payload:c.approval});expect(replay.statusCode,replay.body).toBe(200);
    expect((await db.pool.query('select revision_count from projects where id=$1',[c.params.projectId])).rows[0].revision_count).toBe(1);
    expect(replay.json()).toEqual((await db.pool.query('select submitted_response from architectural_conversations where id=$1',[c.params.conversationId])).rows[0].submitted_response);
  });
  it('actual authenticated and anon SQL roles cannot forge writes or cross owner RLS',async()=>{
    expect((await asPrincipal(db.pool,otherId,c=>c.query('select * from architectural_conversations'))).rowCount).toBe(0);
    await expect(asPrincipal(db.pool,null,c=>c.query('select * from architectural_conversations'))).rejects.toMatchObject({code:'42501'});
    await expect(asPrincipal(db.pool,ownerId,c=>c.query("update architectural_conversations set state='{}'"))).rejects.toMatchObject({code:'42501'});
    await expect(asPrincipal(db.pool,ownerId,c=>c.query("select conversation_write('submit','{}',null,null)"))).rejects.toMatchObject({code:'42501'});
  });
});
