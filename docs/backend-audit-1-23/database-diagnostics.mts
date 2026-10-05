import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {startTestDatabase,createTestUser,asPrincipal} from '../../test-support/postgres.ts';
import {createPgBackend} from '../../test-support/pg-backend.ts';
import {buildApp} from '../../apps/api/src/app.ts';
import {parseEnv} from '../../apps/api/src/config/env.ts';
import {ConversationRepository} from '../../apps/api/src/lib/conversation-repository.ts';
import {planConversation} from '../../apps/api/src/ai/conversation-planner.ts';
import {authored,rect} from '../../packages/blueprint-qa/tests/fixtures.ts';
const db=await startTestDatabase();let app:ReturnType<typeof buildApp>|undefined;const rows:Record<string,unknown>[]=[];
try{
const owner=await createTestUser(db.pool),other=await createTestUser(db.pool),secret=(await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
app=buildApp({env:parseEnv({NODE_ENV:'test',SUPABASE_URL:'http://localhost:54321',SUPABASE_ANON_KEY:'fixture',PROJECT_COMMIT_SECRET:secret,RATE_LIMIT_ENABLED:'false',LOG_LEVEL:'silent'}),backend:createPgBackend(db.pool,{owner,other}),captureError:()=>{}});
const headers={authorization:'Bearer owner'};
for(const kind of ['control','floor-hole','raised-floor','roof-overlap','column-overlap']){
const p=(await app.inject({method:'POST',url:'/api/projects',headers,payload:{title:kind}})).json();const m=authored();
if(kind==='floor-hole')m.slabs[0]!.footprint.voids=[rect(4500,500,2500,4500)];
if(kind==='raised-floor')m.slabs[0]!.topOffsetMm=2500;
if(kind==='roof-overlap')m.slabs.push({...structuredClone(m.slabs[0]!),id:'roof-a',kind:'flat-roof',topOffsetMm:3000},{...structuredClone(m.slabs[0]!),id:'roof-b',kind:'flat-roof',topOffsetMm:3050});
if(kind==='column-overlap')m.columns=['a','b'].map(id=>({id:'col-'+id,levelId:'ground',baseOffsetMm:0,heightMm:2800,crossSection:{outer:rect(500,500,500,500),voids:[]}}));
const res=await app.inject({method:'POST',url:`/api/projects/${p.id}/revisions`,headers,payload:{model:m}});const data=res.json(),row:Record<string,unknown>={name:kind,status:res.statusCode,qa:data.revision?.qa.status,error:data.error};
if(data.revision){row.foreign=(await app.inject({url:`/api/projects/${p.id}/revisions/${data.revision.id}`,headers:{authorization:'Bearer other'}})).statusCode;row.noAuth=(await app.inject({url:`/api/projects/${p.id}/revisions/${data.revision.id}`})).statusCode;row.bim=(await app.inject({url:`/api/projects/${p.id}/revisions/${data.revision.id}/bim`,headers})).statusCode;}
rows.push(row);
}
// Deterministic message error must not leave a processing lease.
const cp=(await app.inject({method:'POST',url:'/api/projects',headers,payload:{title:'conversation-errors'}})).json();
const cid=randomUUID();(await app.inject({method:'POST',url:`/api/projects/${cp.id}/conversations`,headers,payload:{conversationId:cid,baseRevisionId:null}})).json();
const textRequest=(text:string)=>({method:'POST' as const,url:`/api/projects/${cp.id}/conversations/${cid}/messages`,headers,payload:{messageId:randomUUID(),baseRevisionId:null,expectedVersion:0,text}});
const unsafe=await app.inject(textRequest('run shell'));const retry=await app.inject(textRequest('10 by 12 m plot, 2 bedrooms'));
rows.push({name:'failed-message-lease',rejectedStatus:unsafe.statusCode,retryStatus:retry.statusCode,retryCode:retry.json().error?.code});
// A finish waits on the conversation while a different transaction commits a project revision.
const rp=(await app.inject({method:'POST',url:'/api/projects',headers,payload:{title:'finish-race'}})).json(),rcid=randomUUID();
const rc=(await app.inject({method:'POST',url:`/api/projects/${rp.id}/conversations`,headers,payload:{conversationId:rcid,baseRevisionId:null}})).json();
const token=randomUUID(),cr=new ConversationRepository(createPgBackend(db.pool,{owner}).repository('owner'),owner,secret);
const next=await planConversation(rc.state,{messageId:randomUUID(),baseRevisionId:null,expectedVersion:0,text:'10 by 12 m plot, 2 bedrooms'});
await cr.write('reserve',{projectId:rp.id,conversationId:rcid,messageId:next.messages[0].id,expectedVersion:0,baseRevisionId:null,fingerprint:'a'.repeat(64),token});
const locker=await db.pool.connect();await locker.query('begin');await locker.query('select id from public.architectural_conversations where id=$1 for update',[rcid]);
const pending=cr.write('finish',{projectId:rp.id,conversationId:rcid,token,state:next}).then(v=>({accepted:true,result:v})).catch(e=>({accepted:false,code:e.code}));
let observedWait=false;
for(let i=0;i<80;i++){const wait=await db.pool.query("select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and query like '%public.conversation_write%'");if(wait.rows[0].n){observedWait=true;break;}await new Promise(r=>setTimeout(r,25));}
const changed=await app.inject({method:'POST',url:`/api/projects/${rp.id}/revisions`,headers,payload:{model:authored()}});
await locker.query('commit');locker.release();const finished=await pending as {accepted:boolean;result?:{state?:{baseRevisionId?:string|null}};code?:string};
rows.push({name:'stale-finish-race',observedWait,revisionStatus:changed.statusCode,finishAccepted:finished.accepted,conversationBase:finished.result?.state?.baseRevisionId,currentRevision:changed.json().revision?.id,code:finished.code});
// Unsigned writes and private tables: real PostgreSQL caller role, disposable DB.
for(const [name,sql,values] of [['unsigned-revision',"select public.project_write('revision',$1,null,null,null)",[JSON.stringify({projectId:randomUUID(),sourceMode:'supplied'})]],['secret-table','select secret from project_private.commit_key',[]]] as const){try{await asPrincipal(db.pool,owner,c=>c.query(sql,[...values]));rows.push({name,accepted:true});}catch(e){rows.push({name,sqlstate:(e as {code?:string}).code});}}
const policies=await db.pool.query("select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname");writeFileSync(new URL('./evidence/disposable-db-policies.json',import.meta.url),JSON.stringify(policies.rows,null,2));
}finally{await app?.close();await db.stop();writeFileSync(new URL('./evidence/database-diagnostics.json',import.meta.url),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));}
