import { beforeEach, describe, it, expect, vi } from 'vitest';
import { AiPolicySchema } from '../src/contracts/ai-orchestration.js';
import { configuredAdapters } from '../src/ai/orchestration/conversation.js';
import { ConversationIntentSchema } from '../src/contracts/conversations.js';
import { randomUUID } from 'node:crypto';

const mock=vi.hoisted(()=>({addresses:['8.8.8.8'],status:200,content:'',calls:0,dnsCalls:0,pinned:'',serverName:'',headers:{} as Record<string,unknown>,body:'',encoding:''}));
vi.mock('node:dns/promises',()=>({Resolver:class{async resolve4(){mock.dnsCalls++;return mock.addresses;}cancel(){}}}));
vi.mock('node:https',async()=>{
  const {EventEmitter}=await import('node:events');const {PassThrough}=await import('node:stream');
  return {request:(endpoint:URL,options:{lookup:(host:string,options:unknown,cb:(error:null,address:string,family:number)=>void)=>void;headers:Record<string,unknown>;family:number;agent:boolean;signal:AbortSignal;maxHeaderSize:number},callback:(res:unknown)=>void)=>{
    mock.calls++;mock.serverName=endpoint.hostname;mock.headers=options.headers;
    options.lookup(endpoint.hostname,{},(_err,address,family)=>{mock.pinned=address;expect(family).toBe(4);});
    expect(options.family).toBe(4);expect(options.agent).toBe(false);expect(options.maxHeaderSize).toBe(8192);
    const request=new EventEmitter() as InstanceType<typeof EventEmitter>&{end:(body:string)=>void};
    request.end=body=>{mock.body=body;queueMicrotask(()=>{const response=new PassThrough() as InstanceType<typeof PassThrough>&{statusCode:number;headers:Record<string,string>};response.statusCode=mock.status;response.headers=mock.encoding?{'content-encoding':mock.encoding}:{};const destroy=response.destroy.bind(response);response.destroy=error=>{response.emit('aborted');return destroy(error);};callback(response);if(!response.destroyed)response.end(mock.content);});};return request;
  }};
});
const capability='ARCHITECTURAL_INTENT_EXTRACTION' as const;
function configured(){const policy=AiPolicySchema.parse({privacyClass:'REMOTE_ALLOWED',allowedRemoteHosts:['api.example.com'],providers:[{providerId:'remote',type:'REMOTE_OPENAI_COMPATIBLE',enabled:true,endpoint:'https://api.example.com/v1/chat/completions',apiKeyEnv:'AI_PROVIDER_REMOTE_API_KEY',capabilities:[capability],models:[{modelId:'remote-model',privacyClass:'REMOTE_ALLOWED',capabilities:[capability]}]}]});return {policy,adapter:configuredAdapters(policy,{AI_PROVIDER_REMOTE_API_KEY:'server-secret'}).get('remote')!};}
async function execute(){const {policy,adapter}=configured();return adapter.execute({requestId:randomUUID(),capability,text:'brief',context:{intent:ConversationIntentSchema.parse({}),questions:[]},privacyClass:'REMOTE_ALLOWED',maxOutputTokens:512,timeoutMs:100,structuredOutput:true},policy.providers[0]!.models[0]!,AbortSignal.timeout(500));}
beforeEach(()=>{mock.addresses=['8.8.8.8'];mock.status=200;mock.content=JSON.stringify({choices:[{message:{content:'{"bedrooms":3}'},finish_reason:'stop'}]});mock.calls=0;mock.dnsCalls=0;mock.encoding='';});
describe('optional remote HTTPS adapter with controlled DNS and transport',()=>{
  it('pins validated DNS without changing TLS hostname and keeps keys only in headers',async()=>{expect((await execute()).output).toBe('{"bedrooms":3}');expect(mock.calls).toBe(1);expect(mock.dnsCalls).toBe(1);expect(mock.pinned).toBe('8.8.8.8');expect(mock.serverName).toBe('api.example.com');expect(mock.headers.authorization).toBe('Bearer server-secret');expect(mock.body).not.toContain('server-secret');expect(JSON.parse(mock.body).model).toBe('remote-model');expect(JSON.parse(mock.body).max_tokens).toBe(512);});
  it.each([{addresses:['127.0.0.1']},{addresses:['8.8.8.8','169.254.169.254']},{addresses:[]},{addresses:['::1']}])('blocks unsafe DNS %j before HTTPS',async ({addresses})=>{mock.addresses=addresses;await expect(execute()).rejects.toMatchObject({code:'PROVIDER_POLICY_REJECTED'});expect(mock.calls).toBe(0);});
  it.each([[401,'PROVIDER_AUTH_FAILED'],[403,'PROVIDER_AUTH_FAILED'],[429,'PROVIDER_RATE_LIMITED'],[500,'PROVIDER_UNAVAILABLE'],[404,'MODEL_UNAVAILABLE'],[302,'PROVIDER_POLICY_REJECTED']])('classifies HTTP %s without redirects or retry',async(status,code)=>{mock.status=status as number;await expect(execute()).rejects.toMatchObject({code});expect(mock.calls).toBe(1);});
  it('rejects oversized bodies and compressed responses',async()=>{mock.content='x'.repeat(17000);await expect(execute()).rejects.toMatchObject({code:'PROVIDER_RESPONSE_TOO_LARGE'});mock.encoding='gzip';await expect(execute()).rejects.toMatchObject({code:'PROVIDER_RESPONSE_INVALID'});});
  it('does not resolve DNS after caller cancellation',async()=>{const {adapter,policy}=configured();const controller=new AbortController();controller.abort();await expect(adapter.execute({requestId:randomUUID(),capability,text:'brief',context:{intent:ConversationIntentSchema.parse({}),questions:[]},privacyClass:'REMOTE_ALLOWED',maxOutputTokens:512,timeoutMs:100,structuredOutput:true},policy.providers[0]!.models[0]!,controller.signal)).rejects.toMatchObject({code:'PROVIDER_TIMEOUT'});expect(mock.dnsCalls).toBe(0);});
});
