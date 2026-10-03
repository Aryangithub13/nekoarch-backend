-- Additive Phase 20 persistence. All writes are bound to a server HMAC and caller JWT.
create table public.architectural_conversations (
 id uuid primary key, project_id uuid not null references public.projects(id) on delete cascade,
 owner_id uuid not null references public.profiles(id) on delete cascade,
 state jsonb not null check (octet_length(state::text) <= 131072),
 last_message_id uuid, last_fingerprint text, pending_token uuid, pending_until timestamptz,
 submitted_approval jsonb, submitted_response jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check ((state->>'schemaVersion')::integer = 1),
 check ((state->>'version')::integer between 0 and 100),
 check (jsonb_array_length(state->'messages') <= 20)
);
create index conversations_project_page on public.architectural_conversations(project_id,id);
create index conversations_owner on public.architectural_conversations(owner_id);
alter table public.architectural_conversations enable row level security;
revoke all on public.architectural_conversations from public,anon,authenticated;
grant select on public.architectural_conversations to authenticated;
create policy conversation_owner_read on public.architectural_conversations for select to authenticated using (
 owner_id = (select auth.uid()) and exists(select 1 from public.projects p where p.id=project_id and p.owner_id=(select auth.uid())));

create function public.conversation_read(p_action text,p_input jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.architectural_conversations; items jsonb; lim integer; cursor_id uuid;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if not exists(select 1 from public.projects where id=(p_input->>'projectId')::uuid and owner_id=auth.uid()) then raise exception using errcode='P1201',message='Project not found'; end if;
 if p_action='list' then
   lim:=coalesce((p_input->>'limit')::integer,20);
   if lim<1 or lim>20 then raise invalid_parameter_value; end if;
   select coalesce(jsonb_agg(x.dto order by x.id),'[]'::jsonb) into items from (
     select id,jsonb_build_object('id',id,'projectId',project_id,'state',state) dto from public.architectural_conversations
     where project_id=(p_input->>'projectId')::uuid and owner_id=auth.uid() and (p_input->>'cursor' is null or id>(p_input->>'cursor')::uuid)
     order by id limit lim+1) x;
   if jsonb_array_length(items)>lim then cursor_id:=(items->(lim-1)->>'id')::uuid; items:=items-lim; end if;
   return jsonb_build_object('items',items,'nextCursor',cursor_id);
 end if;
 select * into c from public.architectural_conversations where id=(p_input->>'conversationId')::uuid and project_id=(p_input->>'projectId')::uuid and owner_id=auth.uid();
 if not found then raise exception using errcode='P2001',message='Conversation not found'; end if;
 if p_action='get' then return jsonb_build_object('id',c.id,'projectId',c.project_id,'state',c.state); end if;
 if p_action='replay' then
   if c.submitted_approval is not null then
     if c.submitted_approval <> p_input->'approval' then raise exception using errcode='P2002',message='Proposal conflict'; end if;
     return c.submitted_response;
   end if;
   return null;
 end if;
 raise invalid_parameter_value;
end;
$$;
revoke all on function public.conversation_read(text,jsonb) from public,anon;
grant execute on function public.conversation_read(text,jsonb) to authenticated;

create function public.conversation_write(p_action text,p_input jsonb,p_envelope text,p_signature text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare c public.architectural_conversations; p public.projects; envelope jsonb; secret text; uid uuid:=auth.uid(); result jsonb; proposed jsonb; approval jsonb;
begin
 if uid is null then raise insufficient_privilege; end if;
 select k.secret into secret from project_private.commit_key k where singleton;
 if p_envelope is null or p_signature is null or secret is null or p_signature <> encode(extensions.hmac(convert_to(p_envelope,'UTF8'),decode(secret,'hex'),'sha256'),'hex') then raise insufficient_privilege; end if;
 envelope:=p_envelope::jsonb;
 if (envelope->>'userId'=uid::text and envelope->>'operation'='conversation:'||p_action and envelope->'input'=p_input and
   (envelope->>'expiresAt')::bigint between extract(epoch from clock_timestamp())::bigint and extract(epoch from clock_timestamp())::bigint+600) is not true then raise insufficient_privilege; end if;
 select * into p from public.projects where id=(p_input->>'projectId')::uuid and owner_id=uid;
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
