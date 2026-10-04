import { randomUUID } from 'node:crypto';
import { toMillimetres } from '@designflow/shared';
import { normalizeBlueprintForVersion, blueprintVersionForRequirements, type NormalizedBlueprintV2Requirements } from '@designflow/generator';
import { requirementsHash } from '../lib/generation-identity.js';
import { ConversationIntentSchema, ConversationStateSchema, type ConversationIntent, type ConversationMessage, type ConversationState } from '../contracts/conversations.js';
import { IntentCandidateSchema, NaturalLanguageDesignRequestSchema } from '../contracts/requirement-interpretation.js';
import { parseFallback, fallbackProvider } from './fallback-parser.js';
import { interpretRequirements } from './architectural-interpreter.js';
import { InterpreterProviderError } from './interpreter-provider.js';
import type { ConversationProvider } from './conversation-provider.js';
import { ApiError } from '../lib/errors.js';

type Requirements = NonNullable<ConversationState['requirements']>;
export function initialConversation(baseRevisionId: string | null, requirements: Requirements | null, v2: boolean): ConversationState {
  return ConversationStateSchema.parse({ schemaVersion: 1, version: 0, baseRevisionId, solver: requirements && 'layoutV2' in requirements || v2 ? 'V2' : 'V1',
    status: 'DRAFT', intent: {}, baseRequirements: requirements, requirements, questions: [], unsupported: [], explanations: [], fieldSources: requirements ? { base: 'PERSISTED' } : {},
    summary: 'No proposal has been approved.', proposal: null, messages: [], provider: { kind: 'fallback', model: 'bounded-conversation-v1', failure: null } });
}
export function changedFields(before: Requirements | null, after: Requirements) {
  return Object.keys(after).filter(k => JSON.stringify(before?.[k as keyof Requirements]) !== JSON.stringify(after[k as keyof Requirements])).sort();
}
// Explicit native replacements supersede pending language for the same fields.
// Discard that language before validating it, so its old clarification cannot
// prevent the user from supplying exactly the native update we requested.
function supersedeNativeIntent(intent: ConversationIntent, update: ConversationMessage['nativeUpdate']) {
  if (!update) return;
  if (update.site) { delete intent.site; delete intent.northMilliDegrees; }
  if (update.rooms) {
    for (const key of ['roomChange','bedrooms','bathrooms','living','dining','study','groundFloorBedrooms','upperFloorBedrooms','kitchenLarger','kitchenMinWidthMm','kitchenMinDepthMm'] as const) delete intent[key];
  }
  if (update.relationships) {
    for (const key of ['relationship','kitchenConnection','relationshipKind','relationshipStrength','kitchen'] as const) delete intent[key];
  }
  if (update.layoutV2) {
    for (const key of ['parking','accessSide','privacy','daylight','ventilation'] as const) delete intent[key];
  }
  if (update.stair) delete intent.noStairs;
}
function parseConversation(text: string) {
  let t = text.replace(/\bactually\b/gi, '').replace(/\bbigger\b/gi, 'larger').replace(/\b(?:design|put|move|else)\b/gi, '').replace(/\bmake it (?=(?:one|two|1|2) floors?)/gi, '');
  const extra: Partial<ConversationIntent> = {};
  const roomNames: Record<string, NonNullable<ConversationIntent['roomChange']>['type']> = {bedroom:'bedroom',bedrooms:'bedroom',bathroom:'bathroom',bathrooms:'bathroom',kitchen:'kitchen',living:'living',dining:'dining',study:'study'};
  // Consume room dimensions before the inherited parser can mistake them for a plot.
  t=t.replace(/\b(?:make\s+(?:the\s+)?)?(bedrooms?|bathrooms?|kitchen|living|dining|study)(?:\s+room)?\s+(\d+(?:\.\d+)?)\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|metres?|meters?|ft|feet)\b/gi,
    (_match,name:string,width:string,depth:string,unit:string)=>{const units:Record<string,'mm'|'cm'|'m'|'ft'>={mm:'mm',cm:'cm',m:'m',metre:'m',metres:'m',meter:'m',meters:'m',ft:'ft',feet:'ft'};
      if(extra.roomChange) extra.unsupported=['unsupported_constraint'];
      try { extra.roomChange={type:roomNames[name.toLowerCase()]!,allOfType:name.endsWith('s'),minWidthMm:toMillimetres(width,units[unit.toLowerCase()]!),minDepthMm:toMillimetres(depth,units[unit.toLowerCase()]!)}; } catch { extra.unsupported=['unsupported_constraint']; } return '';});
  t=t.replace(/\b(?:the\s+)?(kitchen|living|dining|study|bathroom)\s+(upstairs|downstairs)\b/gi,(_match,name:string,level:string)=>{if(extra.roomChange) extra.unsupported=['unsupported_constraint'];extra.roomChange={type:roomNames[name.toLowerCase()]!,allOfType:false,targetLevel:level.toLowerCase()==='upstairs'?1:0};return '';});
  t=t.replace(/\b(bedroom|bathroom|kitchen|living|dining|study)\s+(?:must be\s+|is\s+)?(adjacent to|next to|connected to)\s+(?:the\s+)?(bedroom|bathroom|kitchen|living|dining|study)\b/gi,
    (_match,from:string,kind:string,to:string)=>{if(extra.relationship) extra.unsupported=['unsupported_constraint'];extra.relationship={from:{type:roomNames[from.toLowerCase()]!,ordinal:1},to:{type:roomNames[to.toLowerCase()]!,ordinal:1},kind:kind.toLowerCase()==='connected to'?'connected':'adjacent',strength:'hard'};return '';});

  for (const [word, key] of [['privacy','privacy'],['daylight','daylight'],['ventilation','ventilation']] as const) {
    t = t.replace(new RegExp(`\\b(?:(remove|disable|no)\\s+|(?:improve|natural|more|enable)\\s+)?${word}(?:\\s+(?:for|of)\\s+(?:the\\s+)?bedrooms)?\\b`, 'gi'), (_m, remove: string | undefined) => { if(extra[key]!==undefined && extra[key]!==!remove) extra.unsupported=['unsupported_constraint']; extra[key] = !remove; return ''; });
  }
  t = t.replace(/\bcirculation\s+(\d+)\s*mm\b/gi, (_m, value: string) => { extra.circulationWidthMm = Number(value); return ''; });
  const candidate = parseFallback(t);
  const parsed = ConversationIntentSchema.safeParse({ ...candidate, ...extra });
  return parsed.success ? parsed.data : ConversationIntentSchema.parse({ unsupported: ['unsupported_constraint'] });
}
function applyNative(r: Requirements, c: ConversationIntent, questions: string[]) {
  if(c.roomChange) {
    const change=c.roomChange,groups=r.rooms.filter(room=>room.type===change.type && (change.level===undefined || room.level===change.level));
    if(!groups.length || !change.allOfType && groups.reduce((n,room)=>n+room.count,0)!==1) questions.push(`The ${change.type} reference is ambiguous or absent. Specify all rooms of that type or an explicit native group update.`);
    else for(const room of groups) {
      if(change.minWidthMm!==undefined) room.minWidthMm=change.minWidthMm;
      if(change.minDepthMm!==undefined) room.minDepthMm=change.minDepthMm;
      if(change.targetLevel!==undefined) room.level=change.targetLevel;
    }
  }
  if(c.relationship) {
    const edge=c.relationship;
    const ambiguous=[edge.from,edge.to].some(sel=>r.rooms.filter(room=>room.type===sel.type).reduce((n,room)=>n+room.count,0)>1 && sel.ordinal===1);
    if(ambiguous) questions.push('The relationship refers to a repeated room type; specify exact selectors in an explicit native relationships update.');
    else {
      const key=(e:Requirements['relationships'][number])=>[`${e.from.type}:${e.from.ordinal}`,`${e.to.type}:${e.to.ordinal}`].sort().join('/');
      const existing=r.relationships.find(e=>key(e)===key(edge));
      if(existing && existing.strength==='hard' && (edge.strength==='soft' || existing.kind!==edge.kind)) questions.push('An explicit native relationships update is required to weaken a hard connection.');
      else if(existing) Object.assign(existing,edge);else r.relationships.push(edge);
    }
  }
  if (c.floors !== undefined) { if (c.floors === 1 || c.floors === 2) r.floors = c.floors; else questions.push('Only one or two floors are supported.'); }
  if (c.noStairs && r.floors === 2) questions.push('Two floors require the supported straight stair.');
  if (c.seed) r.seed = c.seed;
  if (c.site) {
    if (r.site.boundary.length !== 4 || r.site.setbacks.length || r.site.buildableBoundary) questions.push('Changing this constrained site requires an explicit native site update; existing geometry is preserved.');
    else if (!c.site.unit) questions.push('What units are the plot dimensions in?');
    else {
      const w = toMillimetres(c.site.width, c.site.unit), d = toMillimetres(c.site.depth, c.site.depthUnit ?? c.site.unit);
      if (w <= 0 || d <= 0 || w > 60000 || d > 60000) questions.push('Plot dimensions must be positive and at most 60000 mm.');
      else r.site.boundary = [{x:0,z:0},{x:w,z:0},{x:w,z:d},{x:0,z:d}];
    }
  }
  for (const [field, type] of [['bedrooms','bedroom'],['bathrooms','bathroom'],['living','living'],['dining','dining'],['study','study']] as const) {
    const count = c[field]; if (count === undefined) continue;
    const groups = r.rooms.filter(room => room.type === type), total = groups.reduce((n,g) => n+g.count,0);
    if (count === total) continue;
    if (groups.length === 1) groups[0]!.count = count;
    else if (!groups.length && count > 0) r.rooms.push({type,count,minWidthMm:1800,minDepthMm:1800});
    else questions.push(`Specify a native room update for ${type}; changing the total must preserve each floor's constraints.`);
  }
  if (c.upperFloorBedrooms !== undefined || c.groundFloorBedrooms !== undefined) {
    const groups = r.rooms.filter(room => room.type === 'bedroom'), total = groups.reduce((n,g) => n+g.count,0);
    const upper = c.upperFloorBedrooms ?? total - c.groundFloorBedrooms!, ground = c.groundFloorBedrooms ?? total-upper;
    if (upper > 0 && r.floors < 2 || upper < 0 || ground < 0 || upper+ground !== total) questions.push('Bedroom floor allocations conflict with the floor count or total bedrooms.');
    else if (new Set(groups.map(({count:_count,level:_level,...rest}) => JSON.stringify(rest))).size > 1) questions.push('Bedroom groups have different constraints; supply an explicit native room allocation.');
    else if (groups[0]) r.rooms = [...r.rooms.filter(room => room.type !== 'bedroom'), ...(ground ? [{...groups[0],count:ground,level:0 as const}] : []), ...(upper ? [{...groups[0],count:upper,level:1 as const}] : [])];
  }
  if (c.kitchenLarger && (!c.kitchenMinWidthMm || !c.kitchenMinDepthMm)) questions.push('What minimum kitchen width and depth in millimetres should be used?');
  if (c.kitchenMinWidthMm !== undefined || c.kitchenMinDepthMm !== undefined) {
    const kitchens = r.rooms.filter(room => room.type === 'kitchen');
    if (kitchens.length !== 1 || kitchens[0]!.count !== 1) questions.push('Which kitchen should change? Supply an explicit native room update.');
    else if (!c.kitchenMinWidthMm || !c.kitchenMinDepthMm) questions.push('Supply both kitchen minimum width and depth in millimetres.');
    else { const k = kitchens[0]!;
      if (c.kitchenLarger && (c.kitchenMinWidthMm < k.minWidthMm || c.kitchenMinDepthMm < k.minDepthMm || c.kitchenMinWidthMm * c.kitchenMinDepthMm <= k.minWidthMm * k.minDepthMm)) questions.push('Increasing the kitchen requires nondecreasing minimum dimensions.');
      else { k.minWidthMm = c.kitchenMinWidthMm; k.minDepthMm = c.kitchenMinDepthMm; }
    }
  }
  if (c.kitchen === 'closed') questions.push('A closed kitchen may require removal of existing hard connections; supply an explicit native relationships update.');
  if (c.kitchen === 'open' || c.kitchenConnection) {
    const target = c.kitchenConnection ?? 'living';
    const edge = {from:{type:'kitchen' as const,ordinal:1},to:{type:target,ordinal:1},strength:c.relationshipStrength ?? 'hard' as const,kind:c.kitchen === 'open' ? 'connected' as const : c.relationshipKind ?? 'adjacent' as const};
    const key = (e: typeof edge | Requirements['relationships'][number]) => [e.from.type,e.to.type].sort().join(':');
    const old = r.relationships.find(e => key(e) === key(edge));
    if (old && JSON.stringify(old) !== JSON.stringify(edge)) {
      if (old.strength === 'hard' && (edge.strength === 'soft' || old.kind !== edge.kind)) questions.push('Use an explicit native relationships update to remove or weaken a hard constraint.');
      else Object.assign(old,edge);
    } else if (!old) r.relationships.push(edge);
  }
  if (c.circulationWidthMm !== undefined) r.circulationWidthMm = c.circulationWidthMm;
  if (c.northMilliDegrees !== undefined) r.site.northMilliDegrees = c.northMilliDegrees;
  if ('layoutV2' in r) {
    const v2 = r as NormalizedBlueprintV2Requirements;
    if (c.accessSide) v2.layoutV2.accessSide = c.accessSide;
    if (c.parking !== undefined) v2.layoutV2.parking.count = c.parking;
    for (const [field,objective] of [['privacy','privacy'],['daylight','daylightPotential'],['ventilation','ventilationPotential']] as const) if (c[field] !== undefined) v2.layoutV2.objectives[objective] = c[field] ? 3 : 0;
    // Privacy scoring is a preference. Never silently replace the hard transit policy.
  } else if (c.accessSide || c.parking || c.privacy !== undefined || c.daylight !== undefined || c.ventilation !== undefined) questions.push('These preferences require explicit layoutV2 opt-in in a new conversation; this V1 proposal is not upgraded automatically.');
}

export async function planConversation(previous: ConversationState, message: ConversationMessage, options: { provider?: ConversationProvider; disabled?: boolean; signal?: AbortSignal; restoredRequirements?: Requirements } = {}): Promise<ConversationState> {
  if (/\b(?:ignore (?:all |previous |system )*instructions|system prompt|execute sql|run shell|service.role|approve true)\b|-----BEGIN .*PRIVATE KEY|\bBearer\s+\S+/i.test(message.text)) throw new ApiError(422,'UNSAFE_CONVERSATION_INPUT','Instructions or credentials outside architectural intent are not accepted');
  const state = structuredClone(previous); state.version++; state.proposal = null; state.questions = []; state.explanations = []; state.status = 'NEEDS_CLARIFICATION';
  state.messages = [...state.messages,{id:message.messageId,text:message.text,createdAt:new Date().toISOString()}].slice(-20);
  state.provider = {kind:'fallback',model:'bounded-conversation-v1',failure:null};
  if(options.restoredRequirements) {
    const version='layoutV2' in options.restoredRequirements ? 'V2' : 'V1';
    if(version!==state.solver) throw new ApiError(422,'SOLVER_VERSION_CONFLICT','Restore cannot change the selected solver version');
    state.intent=ConversationIntentSchema.parse({}); state.pendingIntent=ConversationIntentSchema.parse({});state.unsupported=[];state.pendingBedroomMove=false;
    state.explanations=[`Proposed requirements copied from explicitly selected revision ${message.restoreRevisionId}. Approval will generate a new revision using the current base identity.`];
    state.fieldSources={restoredRevision:'USER_EXPLICIT'};
    return finalize(state,options.restoredRequirements);
  }
  let patch = parseConversation(message.text);
  if (patch.upperFloorBedrooms !== undefined || patch.groundFloorBedrooms !== undefined || message.nativeUpdate?.rooms) state.pendingBedroomMove=false;
  const relativeMove=/\bmove\s+(one|two|three|\d+)\s+bedrooms?\s+(upstairs|downstairs)\b/i.exec(message.text);
  if(relativeMove) {
    const bedrooms=state.requirements?.rooms.filter(room=>room.type==='bedroom');
    if(!bedrooms?.length || bedrooms.some(room=>room.level===undefined)) {
      state.pendingBedroomMove=true;
      delete patch.upperFloorBedrooms;delete patch.groundFloorBedrooms;
    }
    else {
      const count=Number(({one:1,two:2,three:3} as Record<string,number>)[relativeMove[1]!.toLowerCase()] ?? relativeMove[1]);
      const upstairs=bedrooms.filter(room=>room.level===1).reduce((n,room)=>n+room.count,0);
      patch.upperFloorBedrooms=upstairs+(relativeMove[2]!.toLowerCase()==='upstairs'?count:-count);delete patch.groundFloorBedrooms;
      if(patch.upperFloorBedrooms<0) {state.pendingBedroomMove=true;delete patch.upperFloorBedrooms;}
    }
  }
  const ambiguous = /\b(?:move it|that room|the room|previous version|another feasible alternative)\b/i.test(message.text);
  if (ambiguous) state.questions.push('Name the room and its ordinal, or the exact previous revision. No ambiguous reference has been applied.');
  if (options.disabled) { state.status = 'FAILED'; state.provider.failure = 'AI_CONFIGURATION_UNAVAILABLE'; return boundedState(state); }
  if (options.provider && !ambiguous && patch.unsupported.includes('unrecognized_language')) {
    try { patch = ConversationIntentSchema.parse(await options.provider.interpret(message.text,{intent:state.intent,questions:previous.questions},options.signal)); state.provider = {kind:options.provider.kind,model:options.provider.model,failure:null}; }
    catch (error) { state.provider.failure = error instanceof InterpreterProviderError ? error.code : 'AI_PROVIDER_INVALID_RESPONSE'; state.explanations.push('Optional inference failed; bounded deterministic interpretation remains available.'); }
  }
  // Never allow inferred upstairs language to overwrite an explicit/persisted floor count.
  if (patch.inferredFields.includes('floors') && (state.intent.floors !== undefined || state.requirements)) delete patch.floors;
  const units = /\bi meant (feet|ft|metres|meters|mm|cm|inches)(?:,? not (?:metres|meters|feet|ft))?\.?$/i.exec(message.text);
  if (units && state.intent.site) { patch = ConversationIntentSchema.parse({site:{...state.intent.site,unit:({feet:'ft',ft:'ft',metres:'m',meters:'m',mm:'mm',cm:'cm',inches:'in'} as const)[units[1]!.toLowerCase() as 'feet']}}); }
  for (const a of message.answers ?? []) {
    if (a.field === 'site.dimensions') patch.site = a.value;
    if (a.field === 'site.unit' && state.intent.site) patch.site = {...state.intent.site,unit:a.value};
    if (a.field === 'floors') patch.floors = a.value;
    if (a.field === 'bedrooms') patch.bedrooms = a.value;
    if (a.field === 'kitchen.minimumDimensions') {patch.kitchenMinWidthMm=a.value.widthMm;patch.kitchenMinDepthMm=a.value.depthMm;}
  }
  if ((message.answers?.length || message.nativeUpdate) && /^(?:answer|clarification|use these values)[.!]?$/i.test(message.text)) patch.unsupported = [];
  for (const key of Object.keys(patch)) if (!['unsupported','contradictions','inferredFields'].includes(key)) state.fieldSources[key] = patch.inferredFields.includes(key as 'floors') ? 'USER_INFERRED' : 'USER_EXPLICIT';
  const v2Handled = state.solver === 'V2' ? ['parking','daylight','ventilation'] : [];
  const removed = message.removeUnsupported ?? [];
  state.unsupported = [...new Set([...state.unsupported.filter(u => !removed.includes(u)),...patch.unsupported.filter(u => !v2Handled.includes(u))])];
  if (/\b(?:skyscraper|twisting|certification|structural|engineering|100[ -]?floor)\b/i.test(message.text)) state.unsupported = [...new Set([...state.unsupported,'engineering_compliance','unsupported_building_scope'])];
  const intent = ConversationIntentSchema.parse({...state.intent,...patch,unsupported:[],contradictions:patch.contradictions});
  state.intent = intent;
  const pending = ConversationIntentSchema.parse({...state.pendingIntent,...patch,unsupported:[],contradictions:patch.contradictions});
  supersedeNativeIntent(pending,message.nativeUpdate);
  supersedeNativeIntent(intent,message.nativeUpdate);
  if (message.nativeUpdate?.rooms) state.pendingBedroomMove=false;
  if (state.pendingBedroomMove) state.questions.push('The relative bedroom move is unresolved because its source allocation is unspecified or insufficient. State the desired total upstairs or supply an explicit native allocation.');
  state.pendingIntent = pending;
  state.questions.push(...intent.contradictions.map(f => `Resolve contradictory ${f} requirements.`));
  if (ambiguous) return finalize(state,null);
  let r = state.requirements ? structuredClone(state.requirements) : null;
  try {
    if (!r) {
      const {roomChange:_roomChange,relationship:_relationship,privacy:_privacy,daylight:_daylight,ventilation:_ventilation,circulationWidthMm:_circulation,accessSide:_access,northMilliDegrees:_north,...base} = intent;
      const basic = IntentCandidateSchema.parse({...base,preserveBedrooms:false,kitchenLarger:false,unsupported:[]});
      const interpreted = await interpretRequirements(NaturalLanguageDesignRequestSchema.parse({text:'conversation intent'}),null,{provider:{...fallbackProvider,async interpret(){return basic;}}});
      state.questions.push(...interpreted.unresolvedQuestions.map(q => q.question));
      state.explanations.push(...interpreted.assumptions.map(a=>a.reason).filter((v,i,a)=>a.indexOf(v)===i));
      for (const a of interpreted.assumptions) state.fieldSources[a.field]=a.source as 'PRODUCT_DEFAULT'|'USER_INFERRED';
      r = interpreted.structuredRequirements;
      if (r && state.solver==='V2') r = normalizeBlueprintForVersion({...r,layoutV2:{}},'precision-blueprint-v2');
    }
    if (r) {
      applyNative(r,previous.requirements ? pending : intent,state.questions);
      if (message.nativeUpdate) {
        if (message.nativeUpdate.layoutV2 && state.solver !== 'V2') state.questions.push('layoutV2 must be opted into when creating the conversation.');
        else {
          r = {...r,...message.nativeUpdate} as Requirements; state.fieldSources.nativeUpdate='USER_EXPLICIT';
          // Remove superseded language fields so provider context cannot contradict
          // the exact user-authored native replacement on a later turn.
          if(message.nativeUpdate.site) delete state.intent.site;
          if(message.nativeUpdate.rooms) {
            for(const [field,type] of [['bedrooms','bedroom'],['bathrooms','bathroom'],['living','living'],['dining','dining'],['study','study']] as const) state.intent[field]=r.rooms.filter(room=>room.type===type).reduce((n,room)=>n+room.count,0);
            delete state.intent.groundFloorBedrooms;delete state.intent.upperFloorBedrooms;delete state.intent.kitchenMinWidthMm;delete state.intent.kitchenMinDepthMm;delete state.intent.roomChange;delete state.intent.kitchenLarger;
          }
          if(message.nativeUpdate.relationships) {delete state.intent.relationship;delete state.intent.kitchenConnection;delete state.intent.relationshipKind;delete state.intent.relationshipStrength;delete state.intent.kitchen;}
        }
      }
      r = normalizeBlueprintForVersion(r,blueprintVersionForRequirements(r));
    }
  } catch { state.questions.push('The proposed changes conflict with the native room, site, floor or relationship constraints. Supply consistent values; no requirements were replaced.'); r=null; }
  if (intent.kitchenLarger) state.explanations.push('Kitchen minimum dimensions do not guarantee a larger physical room after generation.');
  if (intent.kitchen === 'open') state.explanations.push('An open kitchen is represented by a direct connection between separate rooms, not a wall-free interior.');
  state.explanations.push('Feasibility and physical geometry remain unverified until generation and independent QA. No engineering, daylight or ventilation performance is certified.');
  return finalize(state,r);
}
function finalize(state: ConversationState, requirements: Requirements|null): ConversationState {
  state.questions=[...new Set(state.questions)].slice(0,24);
  if (state.questions.length || state.unsupported.length || !requirements) state.status='NEEDS_CLARIFICATION';
  else {
    const diff=changedFields(state.baseRequirements,requirements); state.requirements=requirements; state.pendingIntent=ConversationIntentSchema.parse({}); state.status='AWAITING_APPROVAL';
    state.proposal={id:randomUUID(),version:state.version,baseRevisionId:state.baseRevisionId,requirements,requirementsHash:requirementsHash(requirements),expiresAt:new Date(Date.now()+86400000).toISOString(),changedFields:diff};
    state.explanations.push(`Changed requirement fields: ${diff.join(', ') || 'none'}. Explicit approval of this proposal is required.`);
  }
  return boundedState(state);
}
function boundedState(state: ConversationState): ConversationState {
  state.summary=`Version ${state.version}; ${state.status}; ${state.questions.length} unresolved questions; ${state.unsupported.length} unsupported requests. Structured intent and native requirements are authoritative, not this summary.`;
  // Trim only display history, never structured requirements, to stay below the
  // PostgreSQL JSONB byte ceiling even with multibyte user text.
  while(state.messages.length && Buffer.byteLength(JSON.stringify(state))>120000) state.messages.shift();
  return ConversationStateSchema.parse(state);
}
