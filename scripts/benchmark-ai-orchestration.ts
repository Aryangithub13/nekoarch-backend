import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { AiPolicySchema, AiProviderSchema } from '../apps/api/src/contracts/ai-orchestration.js';
import { AiOrchestrator } from '../apps/api/src/ai/orchestration/orchestrator.js';
import { configuredAdapters, orchestratedConversation } from '../apps/api/src/ai/orchestration/conversation.js';
import { ConversationIntentSchema } from '../apps/api/src/contracts/conversations.js';
import { initialConversation, planConversation } from '../apps/api/src/ai/conversation-planner.js';
import type { AiAdapter, AiRequest } from '../apps/api/src/ai/orchestration/registry.js';

const cap='ARCHITECTURAL_INTENT_EXTRACTION' as const;
const context={intent:ConversationIntentSchema.parse({bedrooms:3}),questions:[]};
const request:AiRequest={requestId:randomUUID(),capability:cap,text:'30 by 50 feet 3BHK two floors',context,privacyClass:'LOCAL_ONLY',maxOutputTokens:512,timeoutMs:1000,structuredOutput:true};
const config=AiProviderSchema.parse({providerId:'local',type:'LOCAL_OPENAI_COMPATIBLE',enabled:true,requestsPerMinute:1000,capabilities:[cap],models:[{modelId:'fixture',capabilities:[cap]}]});
const valid:AiAdapter={async execute(){return {output:{bedrooms:3},finishReason:'stop'};}};
const policy=AiPolicySchema.parse({providers:[config],retries:0});
const o=new AiOrchestrator(policy,new Map([['local',valid]]));
function measure(fn:()=>unknown,n=1000){const samples:number[]=[];for(let i=0;i<n;i++){const s=performance.now();fn();samples.push(performance.now()-s);}samples.sort((a,b)=>a-b);return {samples:n,medianMs:samples[Math.floor(n/2)],p95Ms:samples[Math.floor(n*.95)]};}
async function asyncMeasure(fn:()=>Promise<unknown>,n=100){const samples:number[]=[];for(let i=0;i<n;i++){const s=performance.now();await fn();samples.push(performance.now()-s);}samples.sort((a,b)=>a-b);return {samples:n,medianMs:samples[Math.floor(n/2)],p95Ms:samples[Math.floor(n*.95)]};}
const before=process.memoryUsage();
const routing=measure(()=>o.routes(request));
const contextConstruction=measure(()=>JSON.stringify({text:request.text,context}));
const validation=measure(()=>ConversationIntentSchema.parse(JSON.parse('{"bedrooms":3}')));
const fallback=new AiOrchestrator(AiPolicySchema.parse({}),new Map());
const deterministicFallback=await asyncMeasure(()=>fallback.interpret(request,context.intent));
const adapterOverhead=await asyncMeasure(()=>o.interpret(request,context.intent));
const provider=orchestratedConversation(AiPolicySchema.parse({}),new Map());
const conversation=await asyncMeasure(()=>planConversation(initialConversation(null,null,true),{messageId:randomUUID(),expectedVersion:0,baseRevisionId:null,text:request.text},{provider}));
let active=0,maxActive=0;const delayed:AiAdapter={async execute(){active++;maxActive=Math.max(maxActive,active);try{await new Promise(resolve=>setTimeout(resolve,5));return {output:{bedrooms:3},finishReason:'stop'};}finally{active--;}}};
const limited=new AiOrchestrator(AiPolicySchema.parse({providers:[{...config,maxConcurrent:4}]}),new Map([['local',delayed]]));
const concurrentStart=performance.now();const responses=await Promise.all(Array.from({length:32},()=>limited.interpret(request,context.intent)));const concurrentMs=performance.now()-concurrentStart;
const server=createServer((_req,res)=>res.end(JSON.stringify({choices:[{message:{content:'{"bedrooms":3}'},finish_reason:'stop'}]})));
await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
let localHttp;
try{const address=server.address();if(!address||typeof address==='string')throw new Error();const hp=AiPolicySchema.parse({providers:[{...config,endpoint:`http://127.0.0.1:${address.port}/v1/chat/completions`}]});const http=new AiOrchestrator(hp,configuredAdapters(hp,{}));localHttp=await asyncMeasure(()=>http.interpret(request,context.intent),50);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
console.log(JSON.stringify({source:'Local fixture benchmark; excludes real model inference; conversation planner excludes database and generation (see acceptance timings)',routing,contextConstruction,validation,deterministicFallback,adapterOverhead,localHttp,conversation,concurrency:{requests:32,maxActive,providerSuccess:responses.filter(r=>r.provenance.status==='SUCCESS').length,deterministicFallbacks:responses.filter(r=>r.provenance.status==='FALLBACK').length,totalMs:concurrentMs},memory:{before,after:process.memoryUsage(),peakRssKiB:process.resourceUsage().maxRSS}},null,2));
