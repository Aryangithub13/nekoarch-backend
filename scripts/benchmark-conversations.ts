import { normalizeBlueprintForVersion, blueprintVersionForRequirements } from '@designflow/generator';
import { parseFallback } from '../apps/api/src/ai/fallback-parser.js';
import { requirementsHash } from '../apps/api/src/lib/generation-identity.js';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createServer } from 'node:http';
import { startTestDatabase,createTestUser } from '../test-support/postgres.js';
import { createPgBackend } from '../test-support/pg-backend.js';
import { buildApp } from '../apps/api/src/app.js';
import { parseEnv } from '../apps/api/src/config/env.js';
import { ConversationSchema,ConversationIntentSchema,ConversationMessageSchema } from '../apps/api/src/contracts/conversations.js';
import { initialConversation,planConversation,changedFields } from '../apps/api/src/ai/conversation-planner.js';
import { createLocalInferenceProvider } from '../apps/api/src/ai/conversation-provider.js';
import { ConversationRepository } from '../apps/api/src/lib/conversation-repository.js';

const measurements:Record<string,number[]>={};
async function time<T>(name:string,run:()=>Promise<T>){const start=performance.now();try{return await run();}finally{(measurements[name]??=[]).push(performance.now()-start);}}
const db=await startTestDatabase();
const uid=await createTestUser(db.pool),secret=(await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
const backend=createPgBackend(db.pool,{owner:uid}), original=backend.repository;
backend.repository=token=>{const repo=original(token),conversation=repo.conversationRpc!,project=repo.projectRpc!;
  repo.conversationRpc=(name,args)=>time(`database:${name}:${String(args.p_action)}`,()=>conversation(name,args));
  repo.projectRpc=(name,args)=>time(`project:${name}:${String(args.p_action)}`,()=>project(name,args));return repo;};
const app=buildApp({env:parseEnv({SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'test',NODE_ENV:'test',LOG_LEVEL:'silent',RATE_LIMIT_ENABLED:'false',PROJECT_COMMIT_SECRET:secret}),backend});
let providerMode='valid';
const server=createServer((_req,res)=>{if(providerMode==='timeout')return;res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'{"bedrooms":3}'}}]}));});
try {
 await app.ready();const headers={authorization:'Bearer owner'};
 const project=(await app.inject({method:'POST',url:'/api/projects',headers,payload:{title:'Phase20 benchmark isolated fixture'}})).json();
 const cid=randomUUID(),root=`/api/projects/${project.id}/conversations`,url=`${root}/${cid}`;
 const created=await time('conversation-create',()=>app.inject({method:'POST',url:root,headers,payload:{conversationId:cid,baseRevisionId:null}}));let state=ConversationSchema.parse(created.json()).state;
 for(let i=0;i<30;i++){
   const text=i===0?'30 by 50 feet 3BHK':`seed benchmark-${i}`;
   const response=await time('message-total',()=>app.inject({method:'POST',url:`${url}/messages`,headers,payload:{messageId:randomUUID(),expectedVersion:state.version,baseRevisionId:null,text}}));
   if(response.statusCode!==200)throw new Error(`Benchmark message failed ${response.body}`);state=ConversationSchema.parse(response.json()).state;
   await time('state-retrieval',()=>app.inject({url,headers}));
 }
 for(let i=0;i<30;i++) await time('clarification-plan',()=>planConversation(initialConversation(null,null,false),ConversationMessageSchema.parse({messageId:randomUUID(),expectedVersion:0,baseRevisionId:null,text:'4BHK'})));
 for(let i=0;i<30;i++) {
   await time('deterministic-interpretation',async()=>parseFallback('30 by 50 feet 3BHK two floors'));
   await time('native-merge-and-validation',async()=>{const r=structuredClone(state.requirements!);r.rooms.find(room=>room.type==='kitchen')!.minWidthMm=2400;return normalizeBlueprintForVersion(r,blueprintVersionForRequirements(r));});
   await time('proposal-diff-and-identity',async()=>({diff:changedFields(state.baseRequirements,state.requirements!),hash:requirementsHash(state.requirements)}));
 }
 const leases=new ConversationRepository(backend.repository('owner'),uid,secret);
 await leases.write('reserve',{projectId:project.id,conversationId:cid,messageId:randomUUID(),expectedVersion:state.version,baseRevisionId:null,fingerprint:'abandoned-benchmark-fixture',token:randomUUID()});
 const recoveryPayload={messageId:randomUUID(),expectedVersion:state.version,baseRevisionId:null,text:'seed recovered'};
 const blocked=await time('active-lease-conflict',()=>app.inject({method:'POST',url:`${url}/messages`,headers,payload:recoveryPayload}));
 if(blocked.statusCode!==409)throw new Error('Active lease did not reject competing message');
 // Expire only this disposable fixture; measure recovery, not a 60-second sleep.
 await db.pool.query("update architectural_conversations set pending_until=clock_timestamp()-interval '1 second' where id=$1",[cid]);
 const recovered=await time('expired-lease-recovery',()=>app.inject({method:'POST',url:`${url}/messages`,headers,payload:recoveryPayload}));
 if(recovered.statusCode!==200)throw new Error('Expired lease did not recover');state=ConversationSchema.parse(recovered.json()).state;
 let large=initialConversation(null,state.requirements,false);
 for(let i=0;i<30;i++) large=await time('bounded-multibyte-disabled-state',()=>planConversation(large,ConversationMessageSchema.parse({messageId:randomUUID(),expectedVersion:large.version,baseRevisionId:null,text:'房'.repeat(4000)}),{disabled:true}));
 if(Buffer.byteLength(JSON.stringify(large))>120000)throw new Error('Bounded history exceeded trimming budget');
 const payload={messageId:randomUUID(),expectedVersion:state.version,baseRevisionId:null,text:'seed concurrent'};
 const concurrent=await time('concurrent-ten-messages',()=>Promise.all(Array.from({length:10},()=>app.inject({method:'POST',url:`${url}/messages`,headers,payload}))));
 const successful=concurrent.find(r=>r.statusCode===200);if(!successful)throw new Error('No concurrent request completed');state=ConversationSchema.parse(successful.json()).state;
 if(!state.proposal)throw new Error('No benchmark proposal');const p=state.proposal;
 const accepted=await time('approved-generation-qa-commit',()=>app.inject({method:'POST',url:`${url}/proposals/approve`,headers,payload:{proposalId:p.id,proposalVersion:p.version,requirementsHash:p.requirementsHash,baseRevisionId:null,approve:true}}));
 if(accepted.statusCode!==200)throw new Error(`Benchmark acceptance failed ${accepted.body}`);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const addr=server.address();if(!addr||typeof addr==='string')throw new Error();
 const endpoint=`http://127.0.0.1:${addr.port}/v1/chat/completions`;
 for(let i=0;i<10;i++)await time('local-mock-http-response-validation',()=>createLocalInferenceProvider({endpoint,model:'fixture',timeoutMs:1000,maxTokens:512}).interpret('brief',{intent:ConversationIntentSchema.parse({}),questions:[]}));
 providerMode='timeout';for(let i=0;i<5;i++)await time('local-mock-timeout-10ms',async()=>{try{await createLocalInferenceProvider({endpoint,model:'fixture',timeoutMs:10,maxTokens:512}).interpret('brief',{intent:ConversationIntentSchema.parse({}),questions:[]});throw new Error('Expected timeout');}catch(error){if(!(error instanceof Error)||error.message!=='AI_PROVIDER_TIMEOUT')throw error;}});
 const summary=Object.fromEntries(Object.entries(measurements).map(([key,values])=>{const sorted=[...values].sort((a,b)=>a-b);return[key,{runs:values.length,minMs:sorted[0],medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],maxMs:sorted.at(-1)}];}));
 const out=process.env.PHASE20_PERFORMANCE_PATH??'docs/phase20-evidence/performance.json';await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify({recordedAt:new Date().toISOString(),environment:'Isolated embedded PostgreSQL, Fastify injection, local mock inference; not production load',summary,concurrentStatusCodes:concurrent.map(r=>r.statusCode),retainedMessages:state.messages.length,stateBytes:Buffer.byteLength(JSON.stringify(state)),peakRssKiB:process.resourceUsage().maxRSS,tokenUsage:null,tokenUsageReason:'No real model configured; mock HTTP returns no usage accounting',acceptedIdentity:accepted.json().revision.identity,qa:accepted.json().revision.qa.status},null,2)+'\n');
 process.stdout.write(JSON.stringify(summary)+'\n');
}finally{server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));await app.close();await db.stop();}
