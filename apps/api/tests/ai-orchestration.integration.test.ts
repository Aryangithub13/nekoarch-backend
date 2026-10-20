import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startTestDatabase, createTestUser } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { ConversationSchema } from '../src/contracts/conversations.js';
import { modelHash, requirementsHash } from '../src/lib/generation-identity.js';
import { AiPolicySchema, AiProviderError } from '../src/contracts/ai-orchestration.js';
import { orchestratedConversation } from '../src/ai/orchestration/conversation.js';
import type { AiAdapter } from '../src/ai/orchestration/registry.js';

const brief='Design a 3 bedroom two floor house on a 30 by 50 foot plot. Keep one bedroom downstairs.';
const intent={site:{width:'30',depth:'50',unit:'ft'},bedrooms:3,floors:2,groundFloorBedrooms:1};
const capability='ARCHITECTURAL_INTENT_EXTRACTION';
describe('Phase 21 real HTTP, durable leases, solver, QA and signed immutable revisions',()=>{
  let db:Awaited<ReturnType<typeof startTestDatabase>>,ownerId:string,otherId:string,secret:string,server:ReturnType<typeof createServer>,endpoint:string;
  let mode='valid',calls=0,received:string[]=[];
  const owner={authorization:'Bearer owner'},other={authorization:'Bearer other'};
  const apps:FastifyInstance[]=[];
  beforeAll(async()=>{
    db=await startTestDatabase();ownerId=await createTestUser(db.pool);otherId=await createTestUser(db.pool);secret=(await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    server=createServer(async(req,res)=>{
      calls++;let body='';for await(const chunk of req)body+=String(chunk);received.push(body);
      if(mode==='offline'){res.writeHead(500);res.end('private provider error');return;}
      res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(intent)}}],usage:{prompt_tokens:123,completion_tokens:45,total_tokens:168}}));
    });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error();endpoint=`http://127.0.0.1:${address.port}/v1/chat/completions`;
  });
  afterAll(async()=>{for(const app of apps)await app.close();server?.closeAllConnections();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await db?.stop();});
  async function appFor(provider?:ReturnType<typeof orchestratedConversation>,local=true){
    const env=parseEnv({SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'fixture',PROJECT_COMMIT_SECRET:secret,NODE_ENV:'test',LOG_LEVEL:'silent',RATE_LIMIT_ENABLED:'false',AI_CONVERSATION_MODE:local?'local':'fallback',AI_CONVERSATION_ENDPOINT:endpoint,AI_CONVERSATION_MODEL:'fixture-model',AI_INTERPRETER_TIMEOUT_MS:'100',AI_ROUTING_CONFIG:JSON.stringify({retries:0})});
    const app=buildApp({env,backend:createPgBackend(db.pool,{owner:ownerId,other:otherId}),...(provider?{conversationProvider:provider}:{})});apps.push(app);await app.ready();return app;
  }
  async function setup(app:FastifyInstance){
    const project=await app.inject({method:'POST',url:'/api/projects',headers:owner,payload:{title:'Phase 21 isolated acceptance'}});expect(project.statusCode).toBe(201);
    const projectId=project.json().id as string,conversationId=randomUUID(),url=`/api/projects/${projectId}/conversations/${conversationId}`;
    const r=await app.inject({method:'POST',url:`/api/projects/${projectId}/conversations`,headers:owner,payload:{conversationId,baseRevisionId:null,layoutV2:{}}});expect(r.statusCode,r.body).toBe(200);
    return {projectId,conversationId,url,payload:{messageId:randomUUID(),expectedVersion:0,baseRevisionId:null,text:brief}};
  }
  async function accept(app:FastifyInstance,name:string){
    const c=await setup(app),start=performance.now();const response=await app.inject({method:'POST',url:`${c.url}/messages`,headers:owner,payload:c.payload});expect(response.statusCode,response.body).toBe(200);
    const state=ConversationSchema.parse(response.json()).state;expect(state.status,JSON.stringify(state.questions)).toBe('AWAITING_APPROVAL');
    expect(state.requirements?.floors).toBe(2);expect((state.requirements as Exclude<typeof state.requirements, { program: unknown }>)?.rooms.filter(r=>r.type==='bedroom').reduce((n,r)=>n+r.count,0)).toBe(3);expect((state.requirements as Exclude<typeof state.requirements, { program: unknown }>)?.rooms.find(r=>r.type==='bedroom'&&r.level===0)?.count).toBe(1);
    const p=state.proposal!,approval={proposalId:p.id,proposalVersion:p.version,baseRevisionId:p.baseRevisionId,requirementsHash:p.requirementsHash,approve:true};
    const accepted=await app.inject({method:'POST',url:`${c.url}/proposals/approve`,headers:owner,payload:approval});expect(accepted.statusCode,accepted.body).toBe(200);const result=accepted.json();
    expect(result.revision.generatorVersion).toBe('precision-blueprint-v2');expect(result.revision.qa.status).not.toBe('FAIL');expect(result.revision.qa.summary.errors).toBe(0);expect(result.revision.identity.requirementsHash).toBe(requirementsHash(state.requirements));expect(result.revision.identity.modelHash).toBe(modelHash(result.revision.model));
    expect((await app.inject({method:'POST',url:`${c.url}/proposals/approve`,headers:owner,payload:approval})).json()).toEqual(result);
    expect((await db.pool.query('select revision_count from projects where id=$1',[c.projectId])).rows[0].revision_count).toBe(1);
    if(process.env.PHASE21_EVIDENCE_DIR){await mkdir(process.env.PHASE21_EVIDENCE_DIR,{recursive:true});await writeFile(join(process.env.PHASE21_EVIDENCE_DIR,name+'.json'),JSON.stringify({source:'Real HTTP conversation and isolated PostgreSQL; synthetic local provider for protocol testing',brief,routing:state.orchestration,requirements:state.requirements,proposal:p,approval,revision:result,totalMs:performance.now()-start},null,2)+'\n');}
    return {state,result,c};
  }
  it('local protocol provider → strict intent → exact approval → V2 solver → real QA → signed immutable revision',async()=>{mode='valid';received=[];const {state}=await accept(await appFor(),'local-success');expect(state.orchestration).toMatchObject({providerId:'local-default',usage:{inputTokens:123,outputTokens:45,totalTokens:168}});expect(received).toHaveLength(1);expect(received[0]).not.toMatch(/owner|projectId|conversationId|authorization|signature|nativeUpdate|model_json/);});
  it('preferred provider offline → bounded deterministic fallback → correct signed revision',async()=>{mode='offline';const before=calls;const {state}=await accept(await appFor(),'provider-offline');expect(calls-before).toBe(1);expect(state.orchestration).toMatchObject({providerId:'deterministic',status:'FALLBACK'});expect(state.orchestration?.attempts[0]?.failure).toBe('PROVIDER_UNAVAILABLE');});
  it('LOCAL_ONLY with configured remote prevents all remote calls and completes the same request',async()=>{
    let remoteCalls=0;const policy=AiPolicySchema.parse({privacyClass:'LOCAL_ONLY',providers:[{providerId:'remote',type:'REMOTE_OPENAI_COMPATIBLE',enabled:true,capabilities:[capability],models:[{modelId:'fixture',capabilities:[capability],privacyClass:'REMOTE_ALLOWED'}]}]});
    const provider=orchestratedConversation(policy,new Map([['remote',{async execute(){remoteCalls++;throw new Error('must not be contacted');}}]]));
    const {state}=await accept(await appFor(provider,false),'privacy-local-only');expect(remoteCalls).toBe(0);expect(state.orchestration?.attempts[0]?.failure).toBe('PROVIDER_POLICY_REJECTED');
  });
  it('identical concurrent messages invoke one provider; durable replay never calls it again',async()=>{
    mode='valid';const app=await appFor(),c=await setup(app),before=calls;const results=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:`${c.url}/messages`,headers:owner,payload:c.payload})));expect(results.some(r=>r.statusCode===200)).toBe(true);expect(results.every(r=>[200,409].includes(r.statusCode))).toBe(true);const replay=await app.inject({method:'POST',url:`${c.url}/messages`,headers:owner,payload:c.payload});expect(replay.json()).toEqual(results.find(r=>r.statusCode===200)!.json());expect(calls-before).toBe(1);
  });
  it('lease lost while model is running prevents stale response committing',async()=>{
    let release!:()=>void,entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});const adapter:AiAdapter={async execute(){entered();await new Promise<void>(resolve=>{release=resolve;});return {output:intent,finishReason:'stop'};}};
    const policy=AiPolicySchema.parse({providers:[{providerId:'slow',type:'LOCAL_OPENAI_COMPATIBLE',enabled:true,capabilities:[capability],models:[{modelId:'fixture',capabilities:[capability]}]}]});
    const app=await appFor(orchestratedConversation(policy,new Map([['slow',adapter]])),false),c=await setup(app);
    const pending=app.inject({method:'POST',url:`${c.url}/messages`,headers:owner,payload:c.payload}).then(r=>r);await started;
    await db.pool.query("update architectural_conversations set pending_until=clock_timestamp()-interval '1 second',pending_token=$2 where id=$1",[c.conversationId,randomUUID()]);release();
    const result=await pending;expect(result.statusCode).toBe(409);expect((await app.inject({url:c.url,headers:owner})).json().state.version).toBe(0);expect((await db.pool.query('select revision_count from projects where id=$1',[c.projectId])).rows[0].revision_count).toBe(0);
  });
  it('aborts inference when a real HTTP client disconnects after sending its body',async()=>{
    let entered!:()=>void,aborted!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;}),cancelled=new Promise<void>(resolve=>{aborted=resolve;});
    const adapter:AiAdapter={async execute(_r,_m,signal){entered();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{aborted();resolve();},{once:true}));throw new AiProviderError('REQUEST_CANCELLED');}};
    const policy=AiPolicySchema.parse({providers:[{providerId:'cancel',type:'LOCAL_OPENAI_COMPATIBLE',enabled:true,capabilities:[capability],models:[{modelId:'fixture',capabilities:[capability]}]}]});
    const app=await appFor(orchestratedConversation(policy,new Map([['cancel',adapter]])),false),c=await setup(app);
    const address=await app.listen({port:0,host:'127.0.0.1'}),controller=new AbortController();
    const pending=fetch(address+c.url+'/messages',{method:'POST',headers:{...owner,'content-type':'application/json'},body:JSON.stringify(c.payload),signal:controller.signal}).catch(()=>null);
    await started;controller.abort();await pending;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([cancelled,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Client disconnect did not abort inference')),500);})]);}finally{clearTimeout(timer);}
    expect((await app.inject({url:c.url,headers:owner})).json().state.version).toBe(0);
  });
  it('cross-project/cross-owner requests cannot send context to a provider',async()=>{
    mode='valid';const app=await appFor(),c=await setup(app),d=await setup(app),before=calls;
    for(const [url,headers] of [[c.url,other],[`/api/projects/${d.projectId}/conversations/${c.conversationId}`,owner]] as const){const response=await app.inject({method:'POST',url:`${url}/messages`,headers,payload:c.payload});expect(response.statusCode).toBe(404);}
    expect(calls).toBe(before);
  });
  it('all-provider failure leaves no accepted transition or revision and API stays healthy',async()=>{
    const policy=AiPolicySchema.parse({deterministicFallback:false,retries:0,providers:[{providerId:'bad',type:'LOCAL_OPENAI_COMPATIBLE',enabled:true,capabilities:[capability],models:[{modelId:'fixture',capabilities:[capability]}]}]});
    const app=await appFor(orchestratedConversation(policy,new Map([['bad',{async execute(){throw new AiProviderError('PROVIDER_UNAVAILABLE');}}]])),false),c=await setup(app);
    const response=await app.inject({method:'POST',url:`${c.url}/messages`,headers:owner,payload:c.payload});expect(response.statusCode).toBe(503);expect(response.json().error.code).toBe('ALL_PROVIDERS_FAILED');expect((await app.inject({url:c.url,headers:owner})).json().state.version).toBe(0);expect((await app.inject({url:'/health/live'})).statusCode).toBe(200);
  });
});
