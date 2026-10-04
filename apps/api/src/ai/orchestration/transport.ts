import { request as httpsRequest } from 'node:https';
import { Resolver } from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';
import { z } from 'zod';
import { AiProviderError, type AiUsage } from '../../contracts/ai-orchestration.js';
import { CONVERSATION_LIMITS } from '../../contracts/conversations.js';

const prohibited = new BlockList();
for(const [network,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)prohibited.addSubnet(network,prefix,'ipv4');
export function publicAddresses(addresses:readonly string[]) {
  if(!addresses.length || addresses.length>32 || addresses.some(address=>isIP(address)!==4 || prohibited.check(address,'ipv4')))throw new AiProviderError('PROVIDER_POLICY_REJECTED');
  return [...addresses].sort();
}
export function validateRemoteEndpoint(value:string,allowedHosts:readonly string[]) {
  try {
    const url=new URL(value);
    if(url.protocol!=='https:' || url.port && url.port!=='443' || url.username || url.password || url.search || url.hash || url.pathname!=='/v1/chat/completions' || isIP(url.hostname) || !allowedHosts.includes(url.hostname) || !/^[a-z0-9.-]+$/.test(url.hostname) || url.hostname.endsWith('.') || url.hostname==='localhost' || url.hostname.endsWith('.localhost'))throw new Error();
    return url;
  }catch{throw new AiProviderError('PROVIDER_POLICY_REJECTED');}
}
export function validateCredential(key:string|undefined){if(key!==undefined && (!/^[\x21-\x7e]{1,512}$/.test(key)))throw new AiProviderError('PROVIDER_POLICY_REJECTED');}
export function statusError(status:number):never {
  throw new AiProviderError(status===401||status===403?'PROVIDER_AUTH_FAILED':status===429?'PROVIDER_RATE_LIMITED':status===404?'MODEL_UNAVAILABLE':status>=300&&status<400?'PROVIDER_POLICY_REJECTED':status>=500?'PROVIDER_UNAVAILABLE':'PROVIDER_RESPONSE_INVALID');
}
const token=z.number().int().nonnegative().max(10000000);
const envelope=z.object({choices:z.array(z.object({message:z.object({content:z.string().max(16384),tool_calls:z.never().optional(),function_call:z.never().optional(),refusal:z.null().optional()}),finish_reason:z.literal('stop')})).length(1),usage:z.object({prompt_tokens:token.optional(),completion_tokens:token.optional(),total_tokens:token.optional()}).optional()});
export function parseCompletion(body:string):{output:unknown;usage:AiUsage;finishReason:'stop'} {
  if(Buffer.byteLength(body)>CONVERSATION_LIMITS.outputBytes)throw new AiProviderError('PROVIDER_RESPONSE_TOO_LARGE');
  let parsed:unknown;try{parsed=JSON.parse(body);}catch{throw new AiProviderError('PROVIDER_RESPONSE_INVALID');}
  const data=envelope.safeParse(parsed);if(!data.success)throw new AiProviderError('PROVIDER_RESPONSE_INVALID');
  const u=data.data.usage;
  return {output:data.data.choices[0]!.message.content,finishReason:'stop',usage:{inputTokens:u?.prompt_tokens??null,outputTokens:u?.completion_tokens??null,totalTokens:u?.total_tokens??null,estimatedCostUsd:null}};
}
/** DNS is resolved once, all A records checked, then the vetted IP is pinned to TLS lookup.
 * IPv6-only remote endpoints are intentionally unsupported. TLS still verifies hostname.
 * No redirect, proxy, cookies, pooled cross-host connection, or arbitrary path support. */
export async function remoteCompletion(endpoint:URL,body:string,key:string|undefined,signal:AbortSignal):Promise<string>{
  validateCredential(key);
  if(signal.aborted)throw new AiProviderError('PROVIDER_TIMEOUT');
  const resolver=new Resolver({timeout:2000,tries:1});
  const cancel=()=>resolver.cancel();signal.addEventListener('abort',cancel,{once:true});
  let addresses:string[];
  try{addresses=publicAddresses(await resolver.resolve4(endpoint.hostname));}finally{signal.removeEventListener('abort',cancel);}
  if(signal.aborted)throw new AiProviderError('PROVIDER_TIMEOUT');
  return new Promise((resolve,reject)=>{
    const req=httpsRequest(endpoint,{method:'POST',agent:false,family:4,signal,maxHeaderSize:8192,lookup:(_hostname,_options,callback)=>callback(null,addresses[0]!,4),headers:{'content-type':'application/json','content-length':Buffer.byteLength(body),...(key?{authorization:`Bearer ${key}`}:{})}},res=>{
      if(res.statusCode!==200){res.destroy();try{statusError(res.statusCode??500);}catch(error){reject(error);}return;}
      if(res.headers['content-encoding'] && res.headers['content-encoding']!=='identity'){res.destroy();reject(new AiProviderError('PROVIDER_RESPONSE_INVALID'));return;}
      const chunks:Buffer[]=[];let bytes=0;
      res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>CONVERSATION_LIMITS.outputBytes){reject(new AiProviderError('PROVIDER_RESPONSE_TOO_LARGE'));res.destroy();}else chunks.push(chunk);});
      res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error',()=>reject(new AiProviderError(signal.aborted?'PROVIDER_TIMEOUT':'PROVIDER_UNAVAILABLE')));
      res.on('aborted',()=>reject(new AiProviderError(signal.aborted?'PROVIDER_TIMEOUT':'PROVIDER_RESPONSE_INVALID')));
    });
    req.on('error',()=>reject(new AiProviderError(signal.aborted?'PROVIDER_TIMEOUT':'PROVIDER_UNAVAILABLE')));req.end(body);
  });
}
