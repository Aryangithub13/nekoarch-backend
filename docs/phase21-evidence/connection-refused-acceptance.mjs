import assert from 'node:assert/strict';
import console from 'node:console';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { startTestDatabase, createTestUser } from '../../test-support/postgres.ts';
import { createPgBackend } from '../../test-support/pg-backend.ts';
import { buildApp } from '../../apps/api/src/app.ts';
import { parseEnv } from '../../apps/api/src/config/env.ts';

const db=await startTestDatabase();let app;
try {
  const ownerId=await createTestUser(db.pool),secret=(await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
  // Obtain an ordinary ephemeral HTTP port, then genuinely stop the server.
  const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const endpoint=`http://127.0.0.1:${port}/v1/chat/completions`;
  let refusal;try{await globalThis.fetch(endpoint);}catch(error){refusal=error.cause?.code;}
  assert.equal(refusal,'ECONNREFUSED');
  app=buildApp({env:parseEnv({SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'fixture',NODE_ENV:'test',LOG_LEVEL:'silent',RATE_LIMIT_ENABLED:'false',PROJECT_COMMIT_SECRET:secret,AI_CONVERSATION_MODE:'local',AI_CONVERSATION_ENDPOINT:endpoint,AI_CONVERSATION_MODEL:'offline-fixture',AI_ROUTING_CONFIG:JSON.stringify({retries:0})}),backend:createPgBackend(db.pool,{owner:ownerId})});await app.ready();
  const headers={authorization:'Bearer owner'};
  const project=await app.inject({method:'POST',url:'/api/projects',headers,payload:{title:'Phase 21 actual connection-refused acceptance'}});assert.equal(project.statusCode,201);const projectId=project.json().id;
  const conversationId=randomUUID(),url=`/api/projects/${projectId}/conversations/${conversationId}`;
  assert.equal((await app.inject({method:'POST',url:`/api/projects/${projectId}/conversations`,headers,payload:{conversationId,baseRevisionId:null,layoutV2:{}}})).statusCode,200);
  const text='Design a 3 bedroom two floor house on a 30 by 50 foot plot. Keep one bedroom downstairs.';
  const response=await app.inject({method:'POST',url:url+'/messages',headers,payload:{messageId:randomUUID(),expectedVersion:0,baseRevisionId:null,text}});assert.equal(response.statusCode,200);
  const state=response.json().state;assert.equal(state.status,'AWAITING_APPROVAL');assert.equal(state.orchestration.providerId,'deterministic');assert.equal(state.orchestration.requests,1);assert.equal(state.orchestration.attempts[0].failure,'PROVIDER_UNAVAILABLE');
  const p=state.proposal,approval={proposalId:p.id,proposalVersion:p.version,baseRevisionId:p.baseRevisionId,requirementsHash:p.requirementsHash,approve:true};
  const accepted=await app.inject({method:'POST',url:url+'/proposals/approve',headers,payload:approval});assert.equal(accepted.statusCode,200);
  const result=accepted.json();assert.equal(result.revision.qa.status,'PASS');assert.equal(result.revision.generatorVersion,'precision-blueprint-v2');
  const record={source:'Real stopped ephemeral HTTP server; ECONNREFUSED independently observed; isolated PostgreSQL signed commit',refusal,text,state,approval,result};
  await writeFile(new URL('./connection-refused.json',import.meta.url),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({refusal,provider:state.orchestration.providerId,attempts:state.orchestration.requests,generationId:result.revision.identity.generationId,qa:result.revision.qa.status}));
}finally{await app?.close();await db.stop();}
