import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeBlueprintV2Requirements } from '@designflow/generator';
import { initialConversation, planConversation } from '../src/ai/conversation-planner.js';
import { createLocalInferenceProvider, validateInferenceEndpoint } from '../src/ai/conversation-provider.js';
import { ConversationMessageSchema, ConversationIntentSchema } from '../src/contracts/conversations.js';
import { solverInput, lSite } from '../../../test-support/solver-v2-fixtures.js';

const message=(text:string,extra:Record<string,unknown>={})=>ConversationMessageSchema.parse({messageId:randomUUID(),expectedVersion:0,baseRevisionId:null,text,...extra});

describe('bounded native conversation reasoning',()=>{
  it('persists exact dimensions and explicit feet correction without rebuilding unrelated defaults',async()=>{
    let s=initialConversation(null,null,false);s=await planConversation(s,message('3BHK 30 by 50 metres'));s=await planConversation(s,message('I meant feet, not metres.'));
    expect(s.status).toBe('AWAITING_APPROVAL');expect(s.requirements?.site.boundary[1]?.x).toBe(9144);expect(s.requirements?.site.boundary[2]?.z).toBe(15240);
  });
  it('keeps an L-site and all V2 preferences when modifying kitchen minima',async()=>{
    const base=normalizeBlueprintV2Requirements(solverInput({site:{boundary:lSite,northMilliDegrees:0},layoutV2:{accessSide:'min-z',forbidPrivateThroughAccess:true,objectives:{privacy:6,daylightPotential:2}}}));
    const s=await planConversation(initialConversation(randomUUID(),base,true),message('Make the kitchen bigger',{answers:[{field:'kitchen.minimumDimensions',value:{widthMm:2200,depthMm:2300}}]}));
    expect(s.status).toBe('AWAITING_APPROVAL');expect(s.requirements).toEqual({...base,rooms:base.rooms.map(r=>r.type==='kitchen'?{...r,minWidthMm:2200,minDepthMm:2300}:r)});
  });
  it('does not infer two floors over a persisted one-floor constraint',async()=>{
    let s=await planConversation(initialConversation(null,null,false),message('30x50 feet 3BHK one floor'));
    s=await planConversation(s,message('Put two bedrooms upstairs'));expect(s.proposal).toBeNull();expect(s.questions.join(' ')).toContain('conflict');expect(s.requirements?.floors).toBe(1);
  });
  it('does not downgrade V2 or resize a constrained site from a rectangular phrase',async()=>{
    const base=normalizeBlueprintV2Requirements(solverInput({site:{boundary:lSite,northMilliDegrees:0}}));
    const s=await planConversation(initialConversation(randomUUID(),base,true),message('30 by 50 feet'));expect(s.proposal).toBeNull();expect(s.requirements).toEqual(base);expect(s.questions.join(' ')).toContain('constrained site');
  });
  it('lets an explicit native replacement resolve a pending constrained-site clarification',async()=>{
    const base=normalizeBlueprintV2Requirements(solverInput({site:{boundary:lSite,northMilliDegrees:0}}));
    let s=await planConversation(initialConversation(randomUUID(),base,true),message('30 by 50 feet'));
    expect(s.status).toBe('NEEDS_CLARIFICATION');
    const site={...base.site,northMilliDegrees:90000};
    s=await planConversation(s,message('Use these values',{nativeUpdate:{site}}));
    expect(s.status).toBe('AWAITING_APPROVAL');expect(s.requirements).toEqual({...base,site});
  });
  it('keeps an unresolved relative bedroom move blocked across unrelated turns',async()=>{
    let s=await planConversation(initialConversation(null,null,false),message('30 by 50 feet 3BHK two floors'));
    const before=structuredClone(s.requirements);
    s=await planConversation(s,message('Move one bedroom upstairs'));
    s=await planConversation(s,message('seed changed'));
    expect(s.status).toBe('NEEDS_CLARIFICATION');expect(s.proposal).toBeNull();expect(s.requirements).toEqual(before);
    s=await planConversation(s,message('Put two bedrooms upstairs'));
    expect(s.status).toBe('AWAITING_APPROVAL');expect((s.requirements as Exclude<typeof s.requirements, { program: unknown }>)?.rooms.find(r=>r.type==='bedroom'&&r.level===1)?.count).toBe(2);
    expect(s.requirements?.seed).toBe('changed');
  });
  it('bounds multibyte display history in disabled mode while preserving native requirements',async()=>{
    const base=normalizeBlueprintV2Requirements(solverInput());let s=initialConversation(randomUUID(),base,true);
    for(let i=0;i<20;i++) s=await planConversation(s,message('房'.repeat(4000)),{disabled:true});
    expect(s.status).toBe('FAILED');expect(Buffer.byteLength(JSON.stringify(s))).toBeLessThan(120000);
    expect(s.requirements).toEqual(base);expect(s.proposal).toBeNull();
  });
  it('does not reapply an old site intent over an explicitly updated native site',async()=>{
    let s=await planConversation(initialConversation(null,null,true),message('30 by 50 feet 3BHK'));
    s=await planConversation(s,message('Use these values',{nativeUpdate:{site:{boundary:lSite,northMilliDegrees:0}},removeUnsupported:['unrecognized_language']}));
    // A native update is an explicit replacement of exactly the supplied field.
    expect(s.requirements?.site.boundary).toEqual(lSite);
    s=await planConversation(s,message('two floors'));
    expect(s.status).toBe('AWAITING_APPROVAL');expect(s.requirements?.site.boundary).toEqual(lSite);
  });
  it('keeps 20 messages and all exact structured intent over a long conversation',async()=>{
    let s=await planConversation(initialConversation(null,null,false),message('30 by 50 feet 3BHK'));
    for(let i=0;i<30;i++) s=await planConversation(s,message(`${i%2+1} floors`));
    expect(s.messages).toHaveLength(20);expect(s.version).toBe(31);expect(s.intent.bedrooms).toBe(3);expect(s.intent.site?.width).toBe('30');expect(Buffer.byteLength(JSON.stringify(s))).toBeLessThan(131072);
  });
  it('blocks unsupported requirements and keeps unsupported intent until explicitly removed',async()=>{
    let s=await planConversation(initialConversation(null,null,false),message('30 by 50 feet 3BHK spiral staircase'));expect(s.proposal).toBeNull();
    s=await planConversation(s,message('two floors'));expect(s.unsupported).toContain('spiral_staircase');expect(s.proposal).toBeNull();
  });
  it('can apply and remove V2 scoring preferences while preserving hard privacy constraints',async()=>{
    const base=normalizeBlueprintV2Requirements(solverInput({layoutV2:{forbidPrivateThroughAccess:true,objectives:{privacy:7}}}));
    let s=await planConversation(initialConversation(randomUUID(),base,true),message('Improve privacy'));expect(s.status).toBe('AWAITING_APPROVAL');
    s=await planConversation(s,message('remove privacy'));const result=normalizeBlueprintV2Requirements(s.requirements);expect(result.layoutV2.objectives.privacy).toBe(0);expect(result.layoutV2.forbidPrivateThroughAccess).toBe(true);
  });
  it('understands explicit room dimensions, supported movement and service adjacency',async()=>{
    let s=await planConversation(initialConversation(null,null,true),message('30 by 50 feet 2BHK two floors'));
    s=await planConversation(s,message('Make the kitchen 3 by 4 metres'));
    expect(s.status).toBe('AWAITING_APPROVAL');expect((s.requirements as Exclude<typeof s.requirements, { program: unknown }>)?.rooms.find(r=>r.type==='kitchen')?.minWidthMm).toBe(3000);
    s=await planConversation(s,message('Move the kitchen upstairs'));expect(s.status).toBe('AWAITING_APPROVAL');expect((s.requirements as Exclude<typeof s.requirements, { program: unknown }>)?.rooms.find(r=>r.type==='kitchen')?.level).toBe(1);
    s=await planConversation(s,message('bathroom adjacent to kitchen'));expect(s.status).toBe('AWAITING_APPROVAL');expect((s.requirements as Exclude<typeof s.requirements, { program: unknown }>)?.relationships.some(r=>r.from.type==='bathroom'&&r.to.type==='kitchen')).toBe(true);
  });
  it('asks instead of applying singular room dimensions to multiple bedrooms',async()=>{
    let s=await planConversation(initialConversation(null,null,false),message('30 by 50 feet 3BHK'));
    s=await planConversation(s,message('make the bedroom 3 by 4 metres'));expect(s.proposal).toBeNull();expect(s.questions.join(' ')).toContain('ambiguous');
  });
  it('diffs the full proposal against the approved base across multiple edits',async()=>{
    const base=normalizeBlueprintV2Requirements(solverInput());let s=initialConversation(randomUUID(),base,true);
    s=await planConversation(s,message('make the kitchen 3 by 4 metres'));s=await planConversation(s,message('seed revised'));
    expect(s.proposal?.changedFields).toEqual(['rooms','seed']);
  });
  it('clarifies relative movement from unspecified allocations and moves a counted room from explicit allocations',async()=>{
    let s=await planConversation(initialConversation(null,null,false),message('30 by 50 feet 3BHK two floors'));
    s=await planConversation(s,message('Move one bedroom upstairs'));expect(s.proposal).toBeNull();expect(s.questions.join(' ')).toContain('unspecified');
    s=await planConversation(s,message('Put one bedroom upstairs'));expect(s.status).toBe('AWAITING_APPROVAL');
    s=await planConversation(s,message('Move one bedroom upstairs'));expect(s.status).toBe('AWAITING_APPROVAL');expect((s.requirements as Exclude<typeof s.requirements, { program: unknown }>)?.rooms.find(r=>r.type==='bedroom'&&r.level===1)?.count).toBe(2);
  });
  it('disabled mode returns no proposal and cannot authorize a generation',async()=>{
    const s=await planConversation(initialConversation(null,null,false),message('30x50 feet 3BHK'),{disabled:true});expect(s.status).toBe('FAILED');expect(s.proposal).toBeNull();
  });
  it.each(['http://example.com/v1/chat/completions','http://localhost/v1/chat/completions','http://169.254.169.254/v1/chat/completions','file:///etc/passwd','http://user:secret@127.0.0.1/v1/chat/completions','http://127.0.0.1/other','http://127.0.0.1/v1/chat/completions?key=secret'])('rejects untrusted inference endpoint %s',url=>expect(()=>validateInferenceEndpoint(url)).toThrow('AI_CONFIGURATION_UNAVAILABLE'));
  it('rejects model-authored privileged fields and user-authored forged state',()=>{
    expect(()=>ConversationIntentSchema.parse({approve:true,geometry:[]})).toThrow();expect(()=>message('3BHK',{proposal:{approve:true}})).toThrow();
  });
});

describe('real optional compatible HTTP adapter against controlled local server',()=>{
  let server:Server,endpoint:string,mode='valid',calls=0,received='';
  beforeAll(async()=>{
    server=createServer(async(req,res)=>{calls++;let body='';for await(const chunk of req)body+=String(chunk);received=body;
      if(mode==='timeout')return;
      if(mode==='unavailable'){res.writeHead(503);res.end('private failure details');return;}
      if(mode==='redirect'){res.writeHead(302,{location:'http://169.254.169.254/'});res.end();return;}
      if(mode==='oversize'){res.end(' '.repeat(17000));return;}
      if(mode==='malformed'){res.end('not json');return;}
      res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(mode==='privileged'?{approve:true}: {bedrooms:3}),...(mode==='tools'?{tool_calls:[{name:'execute'}]}:{})}}]}));
    });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const addr=server.address();if(!addr||typeof addr==='string')throw new Error('Missing test port');endpoint=`http://127.0.0.1:${addr.port}/v1/chat/completions`;
  });
  afterAll(async()=>{server?.closeAllConnections();await new Promise<void>(resolve=>server?.close(()=>resolve()));});
  const provider=(timeoutMs=1000)=>createLocalInferenceProvider({endpoint,model:'fixture:local',timeoutMs,maxTokens:512,apiKey:'secret-only-in-header'});
  it('makes a real bounded JSON HTTP request without including credentials in prompts',async()=>{
    mode='valid';const result=await provider().interpret('three sleeping chambers',{intent:ConversationIntentSchema.parse({}),questions:[]});expect(result.bedrooms).toBe(3);expect(received).not.toContain('secret-only-in-header');expect(JSON.parse(received).max_tokens).toBe(512);expect(JSON.parse(received).messages).toHaveLength(2);
  });
  it.each([['malformed','AI_PROVIDER_INVALID_RESPONSE'],['oversize','AI_PROVIDER_INVALID_RESPONSE'],['privileged','AI_PROVIDER_INVALID_RESPONSE'],['tools','AI_PROVIDER_INVALID_RESPONSE'],['unavailable','AI_PROVIDER_UNAVAILABLE'],['redirect','AI_PROVIDER_NETWORK_ERROR'],['timeout','AI_PROVIDER_TIMEOUT']])('classifies %s without retaining raw provider details',async(m,code)=>{
    mode=m!;await expect(provider(m==='timeout'?20:1000).interpret('brief',{intent:ConversationIntentSchema.parse({}),questions:[]})).rejects.toMatchObject({code});
  });
  it('honors caller cancellation and limits context before making a request',async()=>{
    mode='timeout';const controller=new AbortController();controller.abort();await expect(provider().interpret('brief',{intent:ConversationIntentSchema.parse({}),questions:[]},controller.signal)).rejects.toMatchObject({code:'AI_PROVIDER_TIMEOUT'});
    const before=calls;await expect(provider().interpret('x'.repeat(4001),{intent:ConversationIntentSchema.parse({}),questions:[]})).rejects.toMatchObject({code:'AI_PROVIDER_INVALID_RESPONSE'});expect(calls).toBe(before);
  });
  it('uses controlled fallback on provider failure without inventing success',async()=>{
    mode='malformed';const state=await planConversation(initialConversation(null,null,false),message('unfamiliar architectural wording'),{provider:provider()});expect(state.provider.failure).toBe('AI_PROVIDER_INVALID_RESPONSE');expect(state.proposal).toBeNull();expect(state.status).toBe('NEEDS_CLARIFICATION');
  });
});
