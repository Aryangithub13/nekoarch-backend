import { resolveWorkflow } from '../workflows/sources.js';
import { planPreflight } from '../services/revision-service.js';
import { MEDIA, SERVICES } from '../services/overview-service.js';
import { WorkflowPlanSchema } from '../contracts/workflows.js';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Backend, Repository } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { ApiError, parseRequest } from '../lib/errors.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { ConversationRepository } from '../lib/conversation-repository.js';
import { ProjectDetailSchema, ProjectRevisionDetailSchema, ProjectParamsSchema, RevisionCommitResponseSchema } from '../contracts/projects.js';
import { ConversationSchema, ConversationListSchema, ConversationPageSchema, ConversationParamsSchema, CreateConversationSchema, ConversationMessageSchema, ProposalApprovalSchema, ConversationToolSchema, ConversationToolResponseSchema } from '../contracts/conversations.js';
import { assertSafeConversationText, boundedState, initialConversation, planConversation } from '../ai/conversation-planner.js';
import { TURN_LIMITS } from '../contracts/conversation-memory.js';
import { ActionDecisionResponseSchema, ActionDecisionSchema, ActionParamsSchema, RebaseRequestSchema, RebaseResponseSchema, TurnRequestSchema, TurnResponseSchema } from '../contracts/conversation-turns.js';
import { runTurn } from '../conversation/turns.js';
import { decideAction, rebaseConversation } from '../conversation/actions.js';
import { loadContext } from '../conversation/context.js';
import { closeOperation } from '../services/revision-service.js';
import type { AppearancePool } from '../revision/pool.js';
import type { ConversationState } from '../contracts/conversations.js';
import { createConversationOrchestrator, createConfiguredReplyComposer } from '../config/ai.js';
import { type ConversationProvider } from '../ai/conversation-provider.js';
import { saveProjectRevision } from '../services/project-service.js';
import { CAPABILITIES, CapabilitySchema } from '../workflows/registry.js';

/** Phase 36: explicit "keep" constraints recorded by conversation turns bind the Phase 20 routes too, since approval regenerates the whole design. */
const activePreservation = (state: ConversationState) => !!state.baseRevisionId && (state.memory ?? []).some(m => m.kind === 'PRESERVATION' && m.status === 'ACTIVE');
const Reserved = z.object({replay:z.boolean(),conversation:ConversationSchema}).strict();

export function conversationsRoutes(app: FastifyInstance, backend: Backend, env: Env, configured?: ConversationProvider, appearancePool?: AppearancePool) {
  const root='/api/projects/:projectId/conversations', item=`${root}/:conversationId`;
  const provider=createConversationOrchestrator(env,configured,event=>app.log.info(event,'AI provider attempt'));
  const composer=createConfiguredReplyComposer(env);
  const pool=()=>{ if(!appearancePool) throw new ApiError(503,'REVISION_UNAVAILABLE','Revision execution is not configured'); return appearancePool; };
  app.post(root,{bodyLimit:8192},async request=>{
    const {repository,userId}=await requestContext(request,backend,true);
    const {projectId}=parseRequest(ProjectParamsSchema,request.params), input=parseRequest(CreateConversationSchema,request.body);
    const project=ProjectDetailSchema.parse(await new ProjectRepository(repository).read('get',projectId));
    if(input.baseRevisionId!==project.currentRevisionId) throw new ApiError(409,'REVISION_CONFLICT','Select the current revision explicitly');
    if(project.currentRevision && !project.currentRevision.normalizedRequirements && !input.turnsOnly) throw new ApiError(422,'NATIVE_REQUIREMENTS_UNAVAILABLE','The revision has no stored native requirements');
    if(project.currentRevision?.normalizedRequirements && !('layoutV2' in project.currentRevision.normalizedRequirements) && input.layoutV2) throw new ApiError(422,'SOLVER_VERSION_CONFLICT','A V1 revision cannot be silently upgraded');
    const state=initialConversation(input.baseRevisionId,project.currentRevision?.normalizedRequirements ?? null,input.layoutV2!==undefined);
    return ConversationSchema.parse(await new ConversationRepository(repository,userId!,env.PROJECT_COMMIT_SECRET).write('create',{projectId,conversationId:input.conversationId,state}));
  });
  app.get(root,async request=>{
    const {repository,userId}=await requestContext(request,backend,true);
    const params=parseRequest(ProjectParamsSchema,request.params),page=parseRequest(ConversationPageSchema,request.query);
    return ConversationListSchema.parse(await new ConversationRepository(repository,userId!).read('list',{...params,...page}));
  });
  app.get(item,async request=>{
    const {repository,userId}=await requestContext(request,backend,true);
    return ConversationSchema.parse(await new ConversationRepository(repository,userId!).read('get',parseRequest(ConversationParamsSchema,request.params)));
  });
  app.delete(item,async request=>{
    const {repository,userId}=await requestContext(request,backend,true);
    return z.object({deleted:z.literal(true)}).strict().parse(await new ConversationRepository(repository,userId!,env.PROJECT_COMMIT_SECRET).write('delete',parseRequest(ConversationParamsSchema,request.params)));
  });
  app.post(`${item}/messages`,{bodyLimit:32768},async (request,reply)=>{
    const started=performance.now();
    const {repository,userId}=await requestContext(request,backend,true);
    const params=parseRequest(ConversationParamsSchema,request.params),input=parseRequest(ConversationMessageSchema,request.body);
    let restoredRequirements;
    if(input.restoreRevisionId) {
      const revision=ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision',params.projectId,input.restoreRevisionId));
      if(!revision.normalizedRequirements) throw new ApiError(422,'NATIVE_REQUIREMENTS_UNAVAILABLE','The selected revision has no stored native requirements');
      restoredRequirements=revision.normalizedRequirements;
    }
    const conversations=new ConversationRepository(repository,userId!,env.PROJECT_COMMIT_SECRET),token=randomUUID();
    const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const reserved=z.object({replay:z.boolean(),conversation:ConversationSchema}).strict().parse(await conversations.write('reserve',{...params,messageId:input.messageId,expectedVersion:input.expectedVersion,baseRevisionId:input.baseRevisionId,fingerprint,token}));
    if(reserved.replay) return reserved.conversation;
    const controller=new AbortController(); const abort=()=>controller.abort(); const disconnect=()=>{if(!reply.raw.writableEnded)controller.abort();};
    request.raw.once('aborted',abort);reply.raw.once('close',disconnect);
    try {
      // Only reachable for conversations that used Phase 36 turns: a rebase onto a supplied revision, or active "keep" constraints.
      if(reserved.conversation.state.baseRevisionId && !reserved.conversation.state.baseRequirements) throw new ApiError(422,'NATIVE_REQUIREMENTS_UNAVAILABLE','The revision has no stored native requirements');
      if(activePreservation(reserved.conversation.state)) throw new ApiError(409,'PRESERVATION_CONFLICT','Active preservation constraints conflict with whole-design regeneration; release them first');
      const planned=await planConversation(reserved.conversation.state,input,{...(provider?{provider}:{}),disabled:env.AI_CONVERSATION_MODE==='disabled',signal:controller.signal,...(restoredRequirements?{restoredRequirements}:{})});
      // A configured model words the reply. A general question that changed nothing keeps the previous design state.
      const previous=reserved.conversation.state;
      const composed=composer?await composer.compose({text:input.text,state:planned,previous},controller.signal):null;
      // The design is the structured requirements; before any exist, the design-defining intent collected so far must be
      // unchanged too. Words in a question ("living room", "light") do not change plot, floors, rooms or relationships.
      const sameRequirements=JSON.stringify(planned.requirements)===JSON.stringify(previous.requirements);
      const unchanged=sameRequirements && (planned.requirements!==null || JSON.stringify(designFields(planned.intent))===JSON.stringify(designFields(previous.intent)));
      const reply=composed?{messageId:input.messageId,text:composed.text,provider:composed.provider,model:composed.model,generalQuestion:composed.generalQuestion&&unchanged}:undefined;
      // With a model reply, a message that changes no design field (a question, greeting or a wish the engine cannot apply)
      // keeps the previous design state: the reply explains it, and stray words never block a pending proposal.
      const explicit=!!(input.removeUnsupported?.length||input.restoreRevisionId||input.nativeUpdate||input.answers?.length);
      const keepDesign=!!reply&&unchanged&&!explicit;
      const state=keepDesign?{...previous,version:planned.version,messages:planned.messages,reply}:{...planned,...(reply?{reply}:{reply:undefined})};
      if (controller.signal.aborted) throw new ApiError(408,'REQUEST_CANCELLED','The conversation request was cancelled');
      const result=ConversationSchema.parse(await conversations.write('finish',{...params,token,state}));
      request.log.info({conversationId:params.conversationId,version:state.version,status:state.status,provider:state.provider.kind,providerFailure:state.provider.failure,orchestration:state.orchestration,durationMs:performance.now()-started},'conversation message processed');
      return result;
    } catch (error) {
      // Token fencing makes cleanup safe even if finish committed but its reply
      // was lost, or a replacement worker acquired an expired lease.
      try { await conversations.write('cancel-message',{...params,token}); }
      catch { request.log.warn('Conversation lease cleanup unavailable'); }
      throw error;
    } finally { request.raw.removeListener('aborted',abort);reply.raw.removeListener('close',disconnect); }
  });
  app.post(`${item}/proposals/approve`,{bodyLimit:8192},async request=>{
    const {repository,userId}=await requestContext(request,backend,true);
    const params=parseRequest(ConversationParamsSchema,request.params),approval=parseRequest(ProposalApprovalSchema,request.body);
    const conversations=new ConversationRepository(repository,userId!,env.PROJECT_COMMIT_SECRET);
    const replay=await conversations.read('replay',{...params,approval}); if(replay) return RevisionCommitResponseSchema.parse(replay);
    const conversation=ConversationSchema.parse(await conversations.read('get',params)),proposal=conversation.state.proposal;
    if(activePreservation(conversation.state)) throw new ApiError(409,'PRESERVATION_CONFLICT','Active preservation constraints conflict with whole-design regeneration; release them first');
    if(!proposal || conversation.state.status!=='AWAITING_APPROVAL' || approval.proposalId!==proposal.id || approval.proposalVersion!==proposal.version || approval.requirementsHash!==proposal.requirementsHash || approval.baseRevisionId!==proposal.baseRevisionId || Date.parse(proposal.expiresAt)<=Date.now()) throw new ApiError(409,'PROPOSAL_CONFLICT','Approve the exact current proposal before generation');
    const project=ProjectDetailSchema.parse(await new ProjectRepository(repository).read('get',params.projectId));
    if(project.currentRevisionId!==approval.baseRevisionId) throw new ApiError(409,'REVISION_CONFLICT','The proposal is stale; start a conversation on the current revision');
    // The existing solver/QA service signs its ordinary revision write. The wrapper
    // commits that write and submission receipt together under the conversation lock.
    const token=randomUUID();
    const racedReplay=await conversations.write('approve-start',{...params,approval,token});
    if(racedReplay) return RevisionCommitResponseSchema.parse(racedReplay);
    const staged=Object.create(repository) as Repository;
    staged.projectRpc=async(name,args)=>name==='project_write' ? conversations.write('submit',{...params,approval,token,call:args}) : repository.projectRpc!(name,args);
    try {
      return RevisionCommitResponseSchema.parse(await saveProjectRevision(new ProjectRepository(staged),userId!,params.projectId,'generated',{requirements:proposal.requirements,baseRevisionId:proposal.baseRevisionId},env.PROJECT_COMMIT_SECRET,undefined,request.log));
    } catch(error) {
      // Only deterministic client errors invalidate a proposal. An ambiguous transport
      // failure retains the lease so a committed result can still be replayed safely.
      if(error instanceof ApiError && error.statusCode<500) await conversations.write('release',{...params,token,reason:`Generation was not accepted: ${error.code}. No feasibility or engineering conclusion is available.`});
      throw error;
    }
  });
  app.post(`${item}/tools`,{bodyLimit:8192},async request=>{
    const {repository,userId}=await requestContext(request,backend,true);
    const params=parseRequest(ConversationParamsSchema,request.params),input=parseRequest(ConversationToolSchema,request.body);
    const conversation=ConversationSchema.parse(await new ConversationRepository(repository,userId!).read('get',params));
    const project=ProjectDetailSchema.parse(await new ProjectRepository(repository).read('get',params.projectId));
    const results=await Promise.all(input.actions.map(async action=>{
      switch(action.name) {
        case 'PLAN_EXISTING_WORKFLOW': return {name:action.name,plan:WorkflowPlanSchema.parse((await resolveWorkflow(repository,params.projectId,action.input)).plan)};
        case 'READ_CURRENT_REVISION': return {name:action.name,revisionId:project.currentRevisionId,identity:project.currentRevision?.identity ?? null};
        case 'CHECK_CAPABILITIES': return {name:action.name,capabilities:z.array(CapabilitySchema).max(32).parse(CAPABILITIES),services:SERVICES,media:MEDIA};
        case 'PLAN_REVISION': return {name:action.name,baseRevisionId:project.currentRevisionId,persisted:false as const,
          preflight:project.currentRevisionId ? await planPreflight(repository,params.projectId,project.currentRevisionId,{text:action.input.text}) : null};
        case 'COMPARE_REQUIREMENTS': return {name:action.name,proposal:conversation.state.proposal};
        case 'EXPLAIN_QA_RESULT': return {name:action.name,qa:project.currentRevision?.qa ?? null,explanation:project.currentRevision ? 'This is the persisted independent QA summary for the current revision. It is not structural certification.' : 'No accepted revision or QA evidence is available.'};
      }
    }));
    request.log.info({conversationId:params.conversationId,actions:input.actions.map(a=>a.name)},'read-only conversation tools');
    return ConversationToolResponseSchema.parse({schemaVersion:1,projectId:params.projectId,conversationId:params.conversationId,results});
  });

  // ---------------------------------------------------------------- Phase 36: conversational turns, coordinated actions, rebase, context
  app.post(`${item}/turns`,{bodyLimit:TURN_LIMITS.bodyBytes},async (request,reply)=>{
    const started=performance.now();
    const {repository,userId}=await requestContext(request,backend,true);
    const params=parseRequest(ConversationParamsSchema,request.params),input=parseRequest(TurnRequestSchema,request.body);
    assertSafeConversationText(input.text);
    const conversations=new ConversationRepository(repository,userId!,env.PROJECT_COMMIT_SECRET),token=randomUUID();
    const fingerprint=createHash('sha256').update(JSON.stringify({turn:input})).digest('hex');
    const reserved=Reserved.parse(await conversations.write('reserve',{...params,messageId:input.turnId,expectedVersion:input.expectedVersion,baseRevisionId:input.baseRevisionId,fingerprint,token}));
    const respond=(conversation:z.infer<typeof ConversationSchema>)=>{
      const turn=conversation.state.turns?.find(t=>t.inReplyTo===input.turnId) ?? null;
      return TurnResponseSchema.parse({conversation,turn,action:turn?.actionId ? conversation.state.actions?.find(a=>a.id===turn.actionId) ?? null : null});
    };
    if(reserved.replay) return respond(reserved.conversation);
    const controller=new AbortController(); const abort=()=>controller.abort(); const disconnect=()=>{if(!reply.raw.writableEnded)controller.abort();};
    request.raw.once('aborted',abort);reply.raw.once('close',disconnect);
    try {
      const outcome=await runTurn({repository,projectId:params.projectId,conversationId:params.conversationId,env,provider,signal:controller.signal},reserved.conversation.state,input);
      if(controller.signal.aborted) throw new ApiError(408,'REQUEST_CANCELLED','The conversation request was cancelled');
      const result=ConversationSchema.parse(await conversations.write('finish',{...params,token,state:boundedState(outcome.state)}));
      // A superseded Phase 30 candidate is cancelled so it stops counting against the project's active operations; failure is only logged.
      for(const operationId of outcome.supersededOperations) await closeOperation(repository,userId!,params.projectId,operationId,'cancel',env.PROJECT_COMMIT_SECRET).catch(()=>request.log.warn({operationId},'superseded revision operation not cancelled'));
      request.log.info({conversationId:params.conversationId,projectId:params.projectId,turnId:input.turnId,version:result.state.version,classification:outcome.turn.classification,
        turnStatus:outcome.turn.status,actionId:outcome.action?.id ?? null,actionKind:outcome.action?.kind ?? null,conflicts:outcome.turn.conflicts.length,interpretation:outcome.turn.interpretation.mode,
        providerKind:outcome.turn.interpretation.provider,providerFailure:outcome.turn.interpretation.failure,contextHash:outcome.turn.contextHash,contextBytes:outcome.contextBytes,
        durationMs:performance.now()-started},'conversation turn processed');
      return respond(result);
    } catch (error) {
      try { await conversations.write('cancel-message',{...params,token}); }
      catch { request.log.warn('Conversation lease cleanup unavailable'); }
      request.log.info({conversationId:params.conversationId,projectId:params.projectId,turnId:input.turnId,errorCode:error instanceof ApiError?error.code:'INTERNAL_ERROR',durationMs:performance.now()-started},'conversation turn not recorded');
      throw error;
    } finally { request.raw.removeListener('aborted',abort);reply.raw.removeListener('close',disconnect); }
  });
  app.post(`${item}/actions/:actionId/decisions`,{bodyLimit:TURN_LIMITS.bodyBytes},async request=>{
    const started=performance.now();
    const {repository,userId}=await requestContext(request,backend,true);
    const params=parseRequest(ActionParamsSchema,request.params),input=parseRequest(ActionDecisionSchema,request.body);
    const result=ActionDecisionResponseSchema.parse(await decideAction({repository,userId:userId!,projectId:params.projectId,conversationId:params.conversationId,env,pool,log:request.log},params.actionId,input));
    request.log.info({conversationId:params.conversationId,projectId:params.projectId,actionId:params.actionId,decision:input.decision,actionKind:result.action.kind,actionStatus:result.action.status,
      revisionId:result.action.result?.revisionId ?? null,verification:result.action.result?.verification ?? null,failureCode:result.action.failure?.code ?? null,durationMs:performance.now()-started},'conversation action decided');
    return result;
  });
  app.post(`${item}/rebase`,{bodyLimit:1024},async request=>{
    const {repository,userId}=await requestContext(request,backend,true);
    const params=parseRequest(ConversationParamsSchema,request.params),input=parseRequest(RebaseRequestSchema,request.body);
    const result=RebaseResponseSchema.parse(await rebaseConversation({repository,userId:userId!,projectId:params.projectId,conversationId:params.conversationId,env,log:request.log},input.expectedVersion));
    request.log.info({conversationId:params.conversationId,projectId:params.projectId,rebased:result.rebased,fromRevisionId:result.fromRevisionId,toRevisionId:result.toRevisionId,reconciled:result.reconciled.length},'conversation rebase');
    return result;
  });
  app.get(`${item}/context`,async request=>{
    const {repository,userId}=await requestContext(request,backend,true);
    const params=parseRequest(ConversationParamsSchema,request.params);
    parseRequest(z.object({}).strict(),request.query);
    const conversation=ConversationSchema.parse(await new ConversationRepository(repository,userId!).read('get',params));
    return (await loadContext(repository,params.projectId,params.conversationId,conversation.state)).document;
  });
}

/** The intent fields that define a design; annotations (unsupported, inferred, contradictions) and room defaults do not. */
const DESIGN_FIELDS = ['site', 'floors', 'bedrooms', 'groundFloorBedrooms', 'upperFloorBedrooms', 'bathrooms', 'parking', 'study', 'roomChange', 'relationship', 'kitchenConnection', 'kitchenMinWidthMm', 'kitchenMinDepthMm', 'circulationWidthMm', 'noStairs'] as const;
function designFields(intent: ConversationState['intent']) {
  const record = intent as Record<string, unknown>;
  return Object.fromEntries(DESIGN_FIELDS.map(field => [field, record[field] ?? null]));
}
