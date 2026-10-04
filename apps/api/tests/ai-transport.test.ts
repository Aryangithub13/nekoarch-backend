import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AiPolicySchema } from '../src/contracts/ai-orchestration.js';
import { configuredAdapters } from '../src/ai/orchestration/conversation.js';
import { AiOrchestrator } from '../src/ai/orchestration/orchestrator.js';
import { ConversationIntentSchema } from '../src/contracts/conversations.js';

const capability='ARCHITECTURAL_INTENT_EXTRACTION' as const;
describe('Phase 21 local OpenAI-compatible transport failure harness',()=>{
  let server:ReturnType<typeof createServer>,endpoint:string,mode='valid',calls=0,closed=0,body='';
  beforeAll(async()=>{
    server=createServer(async(req,res)=>{
      calls++;req.on('close',()=>closed++);body='';for await(const chunk of req)body+=String(chunk);
      if(mode==='stream-timeout'){res.writeHead(200,{'content-type':'application/json'});res.write('{');return;}
      if(mode==='malformed'){res.end('{invalid');return;}
      if(mode==='oversize'){res.end('x'.repeat(17000));return;}
      if(mode==='redirect'){res.writeHead(302,{location:'http://169.254.169.254/'});res.end();return;}
      if(/^\d+$/.test(mode)){res.writeHead(Number(mode));res.end('secret failure');return;}
      res.end(JSON.stringify({choices:[{finish_reason:mode==='truncated'?'length':'stop',message:{content:JSON.stringify(mode==='schema'?{nativeUpdate:{}}:{bedrooms:3})}}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}}));
    });await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw new Error();endpoint=`http://127.0.0.1:${address.port}/v1/chat/completions`;
  });
  afterAll(async()=>{server?.closeAllConnections();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));});
  function orchestration(url=endpoint){const policy=AiPolicySchema.parse({retries:0,providers:[{providerId:'local',type:'LOCAL_OPENAI_COMPATIBLE',enabled:true,endpoint:url,apiKeyEnv:'AI_PROVIDER_FIXTURE_API_KEY',capabilities:[capability],timeoutMs:80,models:[{modelId:'fixture',capabilities:[capability]}]}]});return new AiOrchestrator(policy,configuredAdapters(policy,{AI_PROVIDER_FIXTURE_API_KEY:'secret-header-only'}));}
  const request=()=>({requestId:randomUUID(),capability,text:'three rooms',context:{intent:ConversationIntentSchema.parse({}),questions:[]},privacyClass:'LOCAL_ONLY' as const,maxOutputTokens:512,timeoutMs:500,structuredOutput:true as const});
  it('validates real HTTP response, preserves usage and never includes credentials in prompts',async()=>{mode='valid';const result=await orchestration().interpret(request(),ConversationIntentSchema.parse({}));expect(result.provenance.providerId).toBe('local');expect(result.provenance.usage?.totalTokens).toBe(30);expect(body).not.toContain('secret-header-only');expect(JSON.parse(body).max_tokens).toBe(512);});
  it.each([['401','PROVIDER_AUTH_FAILED'],['403','PROVIDER_AUTH_FAILED'],['429','PROVIDER_RATE_LIMITED'],['500','PROVIDER_UNAVAILABLE'],['404','MODEL_UNAVAILABLE'],['malformed','PROVIDER_RESPONSE_INVALID'],['schema','PROVIDER_SCHEMA_VIOLATION'],['oversize','PROVIDER_RESPONSE_TOO_LARGE'],['truncated','PROVIDER_RESPONSE_INVALID'],['redirect','PROVIDER_UNAVAILABLE'],['stream-timeout','PROVIDER_TIMEOUT']])('bounds and safely classifies %s',async(next,code)=>{mode=next;const before=calls,result=await orchestration().interpret(request(),ConversationIntentSchema.parse({}));expect(result.provenance.status).toBe('FALLBACK');expect(result.provenance.attempts[0]?.failure).toBe(code);expect(calls-before).toBe(1);expect(JSON.stringify(result.provenance)).not.toContain('secret');});
  it('classifies connection refusal and cancels downstream work',async()=>{const result=await orchestration('http://127.0.0.1:1/v1/chat/completions').interpret(request(),ConversationIntentSchema.parse({}));expect(result.provenance.attempts[0]?.failure).toBe('PROVIDER_UNAVAILABLE');expect(closed).toBeGreaterThan(0);});
});
