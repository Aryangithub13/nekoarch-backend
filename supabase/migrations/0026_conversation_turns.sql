-- Phase 36 (conversational AI): forward-only replacement of conversation_write (0012, repaired by 0013). Every existing action is unchanged;
-- 'advance' and 'rebase' are added so a conversation can follow the revision it helped commit, or a newer one, without losing its decision
-- memory. No table, column, constraint, policy or stored row changes; the additive Phase 36 state fields live in the existing state jsonb.
-- Historical migrations are not edited.
create or replace function public.conversation_write(p_action text,p_input jsonb,p_envelope text,p_signature text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare c public.architectural_conversations; p public.projects; envelope jsonb; secret text; uid uuid:=auth.uid(); result jsonb; proposed jsonb; approval jsonb;
begin
 if uid is null then raise insufficient_privilege; end if;
 select k.secret into secret from project_private.commit_key k where singleton;
 if p_envelope is null or p_signature is null or secret is null or p_signature <> encode(extensions.hmac(convert_to(p_envelope,'UTF8'),decode(secret,'hex'),'sha256'),'hex') then raise insufficient_privilege; end if;
 envelope:=p_envelope::jsonb;
 if (envelope->>'userId'=uid::text and envelope->>'operation'='conversation:'||p_action and envelope->'input'=p_input and
   (envelope->>'expiresAt')::bigint between extract(epoch from clock_timestamp())::bigint and extract(epoch from clock_timestamp())::bigint+600) is not true then raise insufficient_privilege; end if;
 select * into p from public.projects where id=(p_input->>'projectId')::uuid and owner_id=uid for update;
 if not found then raise exception using errcode='P1201',message='Project not found'; end if;
 if p_action='create' then
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('conversation-owner:'||uid::text,0));
   select * into c from public.architectural_conversations where id=(p_input->>'conversationId')::uuid;
   if found then
     if c.owner_id<>uid or c.project_id<>p.id or c.state->'baseRevisionId' is distinct from p_input->'state'->'baseRevisionId' or c.state->>'solver'<>p_input->'state'->>'solver' then raise exception using errcode='P2002',message='Conversation conflict'; end if;
     return jsonb_build_object('id',c.id,'projectId',c.project_id,'state',c.state);
   end if;
   if (select count(*) from public.architectural_conversations where owner_id=uid)>=100 or (select count(*) from public.architectural_conversations where project_id=p.id)>=20 then raise exception using errcode='P2003',message='Conversation resource limit'; end if;
   if p.current_revision_id is distinct from (p_input->'state'->>'baseRevisionId')::uuid then raise exception using errcode='P1202',message='Revision conflict'; end if;
   insert into public.architectural_conversations(id,project_id,owner_id,state) values((p_input->>'conversationId')::uuid,p.id,uid,p_input->'state') returning * into c;
   return jsonb_build_object('id',c.id,'projectId',c.project_id,'state',c.state);
 end if;
 select * into c from public.architectural_conversations where id=(p_input->>'conversationId')::uuid and project_id=p.id and owner_id=uid for update;
 if not found then raise exception using errcode='P2001',message='Conversation not found'; end if;
 if p_action in ('advance','rebase') then
   -- Phase 36: move the conversation to the project's current revision. Forward only, fenced by the state version and by any live lease
   -- (only its own holder may advance), and the state is the server-signed input. 'advance' records a commit the conversation coordinated:
   -- the current revision must be a direct child of the conversation's base. 'rebase' follows any newer current revision. Both end any
   -- earlier Phase 20 submission receipt, which belongs to the old base.
   if c.pending_until>clock_timestamp() and c.pending_token is distinct from (p_input->>'token')::uuid then raise exception using errcode='P2004',message='Message in progress'; end if;
   if (c.state->>'version')::integer<>(p_input->>'expectedVersion')::integer or (p_input->'state'->>'version')::integer<>(c.state->>'version')::integer+1 then raise exception using errcode='P2002',message='Conversation conflict'; end if;
   if (c.state->>'version')::integer>=100 then raise exception using errcode='P2003',message='Turn limit'; end if;
   if p.current_revision_id is null or (p_input->'state'->>'baseRevisionId')::uuid is distinct from p.current_revision_id then raise exception using errcode='P1202',message='Revision conflict'; end if;
   if p_action='advance' and not exists(select 1 from public.project_revisions r where r.project_id=p.id and r.id=p.current_revision_id
     and r.parent_revision_id is not distinct from (c.state->>'baseRevisionId')::uuid) then raise exception using errcode='P1202',message='Revision conflict'; end if;
   update public.architectural_conversations set state=p_input->'state',pending_token=null,pending_until=null,submitted_approval=null,submitted_response=null,
     updated_at=clock_timestamp() where id=c.id returning * into c;
   return jsonb_build_object('id',c.id,'projectId',c.project_id,'state',c.state);
 end if;
 if p_action='cancel-message' then
   -- Only the still-owning worker may clear its uncommitted receipt. Do not
   -- invalidate prior state, a completed message, or a replacement worker.
   if c.pending_token = (p_input->>'token')::uuid then
     update public.architectural_conversations set pending_token=null,pending_until=null,
       last_message_id=null,last_fingerprint=null where id=c.id;
     return jsonb_build_object('cancelled',true);
   end if;
   return jsonb_build_object('cancelled',false);
 end if;
 if p_action='delete' then
   delete from public.architectural_conversations where id=c.id;
   return jsonb_build_object('deleted',true);
 end if;
 if p_action='reserve' then
   if c.last_message_id=(p_input->>'messageId')::uuid and c.last_fingerprint<>p_input->>'fingerprint' then raise exception using errcode='P8001',message='Idempotency conflict'; end if;
   if c.last_message_id=(p_input->>'messageId')::uuid and c.pending_token is null then return jsonb_build_object('replay',true,'conversation',jsonb_build_object('id',c.id,'projectId',c.project_id,'state',c.state)); end if;
   if c.pending_until>clock_timestamp() then raise exception using errcode='P2004',message='Message in progress'; end if;
   if c.state->>'status' in ('SUBMITTED','REJECTED') or (c.state->>'version')::integer<>(p_input->>'expectedVersion')::integer then raise exception using errcode='P2002',message='Conversation conflict'; end if;
   if (c.state->>'version')::integer>=100 then raise exception using errcode='P2003',message='Turn limit'; end if;
   if c.state->'baseRevisionId' is distinct from p_input->'baseRevisionId' or p.current_revision_id is distinct from (c.state->>'baseRevisionId')::uuid then raise exception using errcode='P1202',message='Revision conflict'; end if;
   update public.architectural_conversations set last_message_id=(p_input->>'messageId')::uuid,last_fingerprint=p_input->>'fingerprint',pending_token=(p_input->>'token')::uuid,pending_until=clock_timestamp()+interval '60 seconds' where id=c.id;
   return jsonb_build_object('replay',false,'conversation',jsonb_build_object('id',c.id,'projectId',c.project_id,'state',c.state));
 end if;
 if p_action='finish' then
   if c.pending_token is distinct from (p_input->>'token')::uuid or c.pending_until<clock_timestamp() or (p_input->'state'->>'version')::integer<>(c.state->>'version')::integer+1 or c.state->'baseRevisionId' is distinct from p_input->'state'->'baseRevisionId' then raise exception using errcode='P2002',message='Conversation conflict'; end if;
   if p.current_revision_id is distinct from (c.state->>'baseRevisionId')::uuid then raise exception using errcode='P1202',message='Revision conflict'; end if;
   update public.architectural_conversations set state=p_input->'state',pending_token=null,pending_until=null,updated_at=clock_timestamp() where id=c.id returning * into c;
   return jsonb_build_object('id',c.id,'projectId',c.project_id,'state',c.state);
 end if;
 if p_action='release' then
   if c.pending_token is distinct from (p_input->>'token')::uuid then raise exception using errcode='P2002',message='Conversation conflict'; end if;
   update public.architectural_conversations set pending_token=null,pending_until=null,
     state=jsonb_set(jsonb_set(jsonb_set(state,'{status}','"FAILED"'),'{proposal}','null'),'{explanations}',jsonb_build_array(p_input->>'reason')) where id=c.id;
   return jsonb_build_object('released',true);
 end if;
 if p_action in ('submit','approve-start') then
   approval:=p_input->'approval'; proposed:=c.state->'proposal';
   if c.submitted_approval is not null then
     if c.submitted_approval<>approval then raise exception using errcode='P2002',message='Proposal conflict'; end if;
     return c.submitted_response;
   end if;
   if c.state->>'status'<>'AWAITING_APPROVAL' or
     (approval->'approve'='true'::jsonb and approval->>'proposalId'=proposed->>'id' and approval->'proposalVersion'=proposed->'version' and approval->'baseRevisionId'=c.state->'baseRevisionId' and approval->>'requirementsHash'=proposed->>'requirementsHash' and (proposed->>'expiresAt')::timestamptz>clock_timestamp()) is not true then raise exception using errcode='P2002',message='Proposal conflict'; end if;
   if p_action='approve-start' then
     if c.pending_until>clock_timestamp() then raise exception using errcode='P2004',message='Submission in progress'; end if;
     if p.current_revision_id is distinct from (c.state->>'baseRevisionId')::uuid then raise exception using errcode='P1202',message='Revision conflict'; end if;
     update public.architectural_conversations set pending_token=(p_input->>'token')::uuid,pending_until=clock_timestamp()+interval '60 seconds' where id=c.id;
     return null;
   end if;
   if c.pending_token is distinct from (p_input->>'token')::uuid or c.pending_until<clock_timestamp() then raise exception using errcode='P2002',message='Submission lease expired'; end if;
   if p_input->'call'->>'p_action'<>'revision' or p_input->'call'->'p_input'->>'projectId'<>p.id::text or p_input->'call'->'p_input'->'baseRevisionId' is distinct from c.state->'baseRevisionId' or p_input->'call'->'p_input'->'normalizedRequirements' is distinct from proposed->'requirements' then raise insufficient_privilege; end if;
   result:=public.project_write('revision',p_input->'call'->'p_input',nullif(p_input->'call'->'p_context','null'::jsonb),p_input->'call'->>'p_envelope',p_input->'call'->>'p_signature');
   update public.architectural_conversations set state=jsonb_set(state,'{status}','"SUBMITTED"'),pending_token=null,pending_until=null,submitted_approval=approval,submitted_response=result,updated_at=clock_timestamp() where id=c.id;
   return result;
 end if;
 raise invalid_parameter_value;
end;
$$;
revoke all on function public.conversation_write(text,jsonb,text,text) from public,anon;
grant execute on function public.conversation_write(text,jsonb,text,text) to authenticated;
