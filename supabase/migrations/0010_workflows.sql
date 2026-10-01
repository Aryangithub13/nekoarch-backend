-- Additive workflow orchestration. Existing engines and migrations stay authoritative.
create table public.project_workflow_runs (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id),
 source_revision_id uuid,
 created_by uuid not null,
 workflow_version text not null check(workflow_version='workflow-v1'),
 mode text not null check(mode in ('COMPLETE_BUILDING','BLUEPRINT_ONLY','INTERIOR_ONLY','EXTERIOR_ONLY','THREE_D_ONLY','ENGINEERING_ONLY')),
 status text not null check(status in ('RUNNING','COMPLETED','BLOCKED','PARTIALLY_COMPLETED','FAILED')),
 input_fingerprint text not null check(input_fingerprint ~ '^[a-f0-9]{64}$'),
 request_json jsonb not null check(jsonb_typeof(request_json)='object' and octet_length(request_json::text)<=160000),
 plan_json jsonb not null check(jsonb_typeof(plan_json)='object' and octet_length(plan_json::text)<=40000 and jsonb_array_length(plan_json->'steps')<=13),
 outputs jsonb not null default '[]' check(jsonb_typeof(outputs)='array' and jsonb_array_length(outputs)<=13 and octet_length(outputs::text)<=20000),
 errors jsonb not null default '[]' check(jsonb_typeof(errors)='array' and jsonb_array_length(errors)<=20 and octet_length(errors::text)<=10000),
 key_hash text check(key_hash ~ '^[a-f0-9]{64}$'),
 idempotency_context jsonb,
 lease_token uuid not null,
 lease_expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(created_by,key_hash),
 foreign key(project_id,source_revision_id) references public.project_revisions(project_id,id),
 check((request_json->>'mode'=mode and plan_json->>'mode'=mode and plan_json->>'workflowVersion'=workflow_version) is true),
 check(input_fingerprint=project_private.cost_hash(jsonb_build_object('workflowVersion',workflow_version,'projectId',project_id,'request',request_json)))
);
create index workflows_project_created_idx on public.project_workflow_runs(project_id,created_at desc,id desc);
alter table public.project_workflow_runs enable row level security;
revoke all on public.project_workflow_runs from public,anon,authenticated,service_role;
grant select on public.project_workflow_runs to authenticated,service_role;
create policy workflow_owner_read on public.project_workflow_runs for select to authenticated using (
 exists(select 1 from public.projects p where p.id=project_id and p.owner_id=(select auth.uid()))
);
create function project_private.workflow_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.status<>'RUNNING' then raise check_violation using message='Terminal workflows are immutable'; end if;
 if (new.id,new.project_id,new.created_by,new.workflow_version,new.mode,new.input_fingerprint,new.request_json,new.plan_json,new.key_hash,new.idempotency_context,new.created_at)
 is distinct from (old.id,old.project_id,old.created_by,old.workflow_version,old.mode,old.input_fingerprint,old.request_json,old.plan_json,old.key_hash,old.idempotency_context,old.created_at)
 or (old.source_revision_id is not null and new.source_revision_id is distinct from old.source_revision_id) then
 raise check_violation using message='Workflow identity is immutable'; end if;
 return new;
end;
$$;
create trigger workflow_immutable before update or delete on public.project_workflow_runs for each row execute function project_private.workflow_immutable();
create function project_private.workflow_summary(w public.project_workflow_runs) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',w.id,'projectId',w.project_id,'sourceRevisionId',w.source_revision_id,'workflowVersion',w.workflow_version,
 'mode',w.mode,'status',w.status,'inputFingerprint',w.input_fingerprint,'request',w.request_json,'plan',w.plan_json,'outputs',w.outputs,
 'completedCapabilities',coalesce((select jsonb_agg(o->'capability') from jsonb_array_elements(w.outputs) o),'[]'::jsonb),
 'errors',w.errors,'createdAt',w.created_at,'updatedAt',w.updated_at)
$$;
-- Construct references from authoritative normalized rows, including exact parent links.
create function project_private.workflow_artifact(cap text,artifact_id uuid,revision_id uuid,disposition text) returns jsonb
language plpgsql stable set search_path='' as $$
declare r public.project_revisions; q public.project_revision_qa_runs; t public.project_revision_takeoffs;
 c public.project_revision_construction_calculations; b public.project_revision_cost_estimates;
 artifact_type text; version text; coverage text; sources jsonb;
begin
 select * into r from public.project_revisions where id=revision_id;
 if not found then raise exception using errcode='P1604',message='Missing workflow revision'; end if;
 select * into q from public.project_revision_qa_runs qa where qa.id=r.acceptance_qa_id and qa.revision_id=r.id;
 if (q.status in ('PASS','PASS_WITH_WARNINGS') and q.report_json->>'inputStatus'='SCHEMA_VALID'
 and q.report_json->'summary'->>'errors'='0') is not true then raise exception using errcode='P1604',message='Unaccepted workflow source'; end if;
 case cap
 when 'BLUEPRINT_GENERATION' then
   if artifact_id<>r.id then raise exception using errcode='P1604',message='Wrong model reference'; end if;
   artifact_type:='BUILDING_MODEL'; version:=coalesce(r.generator_version,'supplied-v2'); sources:='[]';
 when 'BLUEPRINT_QA' then
   if artifact_id<>q.id then raise exception using errcode='P1604',message='Wrong QA reference'; end if;
   artifact_type:='BLUEPRINT_QA'; version:=q.qa_version; coverage:=q.status; sources:=jsonb_build_array(r.id);
 when 'REVISION_PERSISTENCE' then
   if artifact_id<>r.id then raise exception using errcode='P1604',message='Wrong revision reference'; end if;
   artifact_type:='PROJECT_REVISION'; version:='project-revision-v1'; sources:=jsonb_build_array(q.id);
 when 'QUANTITY_TAKEOFF' then
   select * into t from public.project_revision_takeoffs where id=artifact_id and project_revision_id=r.id and acceptance_qa_id=q.id;
   if not found then raise exception using errcode='P1604',message='Wrong takeoff reference'; end if;
   artifact_type:=cap; version:=t.engine_version; coverage:=t.status; sources:=jsonb_build_array(r.id,q.id);
 when 'CONSTRUCTION_CALCULATION' then
   select * into c from public.project_revision_construction_calculations where id=artifact_id and project_revision_id=r.id and acceptance_qa_id=q.id;
   if not found then raise exception using errcode='P1604',message='Wrong construction reference'; end if;
   artifact_type:=cap; version:=c.engine_version; coverage:=c.status; sources:=jsonb_build_array(c.takeoff_id);
 when 'BOQ_COST' then
   select * into b from public.project_revision_cost_estimates where id=artifact_id and project_revision_id=r.id and acceptance_qa_id=q.id;
   if not found then raise exception using errcode='P1604',message='Wrong cost reference'; end if;
   artifact_type:=cap; version:=b.engine_version; coverage:=b.coverage; sources:=jsonb_build_array(b.takeoff_id,b.construction_calculation_id);
 else raise exception using errcode='P1604',message='Unavailable capability cannot produce artifacts';
 end case;
 return jsonb_build_object('capability',cap,'artifactType',artifact_type,'artifactId',artifact_id,'projectRevisionId',r.id,
   'status',disposition,'version',version,'coverage',coverage,'sourceArtifactIds',sources);
end;
$$;
create function project_private.validate_workflow_manifest(p_project uuid,p_revision uuid,p_outputs jsonb) returns void
language plpgsql stable set search_path='' as $$
declare item jsonb; expected jsonb;
begin
 if jsonb_typeof(p_outputs)<>'array' or jsonb_array_length(p_outputs)>13 then raise invalid_parameter_value; end if;
 if jsonb_array_length(p_outputs)<>(select count(distinct o->>'capability') from jsonb_array_elements(p_outputs) o) then
   raise exception using errcode='P1604',message='Duplicate workflow output'; end if;
 if jsonb_array_length(p_outputs)>0 and not exists(select 1 from public.project_revisions where project_id=p_project and id=p_revision) then
   raise exception using errcode='P1604',message='Wrong workflow source project'; end if;
 for item in select value from jsonb_array_elements(p_outputs) loop
   if (item->>'status' in ('CREATED','REUSED') and item->>'projectRevisionId'=p_revision::text) is not true then
     raise exception using errcode='P1604',message='Invalid output disposition or revision'; end if;
   expected:=project_private.workflow_artifact(item->>'capability',(item->>'artifactId')::uuid,p_revision,item->>'status');
   if (item=expected) is not true then raise exception using errcode='P1604',message='Invalid workflow reference'; end if;
   if item->>'capability' in ('CONSTRUCTION_CALCULATION','BOQ_COST') and not exists(
     select 1 from jsonb_array_elements(p_outputs) o where o->>'capability'='QUANTITY_TAKEOFF' and o->'artifactId'=item->'sourceArtifactIds'->0) then
     raise exception using errcode='P1604',message='Mismatched workflow takeoff chain'; end if;
   if item->>'capability'='BOQ_COST' and not exists(
     select 1 from jsonb_array_elements(p_outputs) o where o->>'capability'='CONSTRUCTION_CALCULATION' and o->'artifactId'=item->'sourceArtifactIds'->1) then
     raise exception using errcode='P1604',message='Mismatched workflow construction chain'; end if;
 end loop;
end;
$$;
alter table public.idempotency_records drop constraint idempotency_records_operation_check;
alter table public.idempotency_records add check(operation in (
 '/api/plans','/api/plans/generate','/api/estimates','/api/projects','/api/projects/:projectId/revisions',
 '/api/projects/:projectId/revisions/generate','/api/projects/:projectId/revisions/:revisionId/takeoffs',
 '/api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations',
 '/api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations/:calculationId/cost-estimates',
 '/api/projects/:projectId/workflows'));
create function public.workflow_write(p_input jsonb,p_context jsonb default null,p_envelope text default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
<<workflow_write>>
declare uid uuid:=auth.uid(); op text:='/api/projects/:projectId/workflows'; secret text; envelope jsonb;
 w public.project_workflow_runs; r public.project_revisions; project_id uuid:=(p_input->>'projectId')::uuid;
 action text:=p_input->>'action'; cap text:=p_input->>'capability'; a jsonb:=p_input->'call'->'args';
 result jsonb; item jsonb; expected jsonb; new_outputs jsonb; selected jsonb; dep jsonb; final_status text; err jsonb;
begin
 if uid is null then raise insufficient_privilege; end if;
 select k.secret into secret from project_private.commit_key k where singleton;
 if p_envelope is null or p_signature is null or p_signature<>encode(extensions.hmac(convert_to(p_envelope,'UTF8'),decode(secret,'hex'),'sha256'),'hex') then raise insufficient_privilege; end if;
 envelope:=p_envelope::jsonb;
 if (envelope->>'userId'=uid::text and envelope->>'operation'=op and envelope->'input'=p_input
 and envelope->'context'=coalesce(p_context,'null'::jsonb)
 and (envelope->>'expiresAt')::bigint between extract(epoch from clock_timestamp())::bigint and extract(epoch from clock_timestamp())::bigint+600) is not true then raise insufficient_privilege; end if;
 if octet_length(p_input::text)>29000000 then raise invalid_parameter_value; end if;
 if not exists(select 1 from public.projects p where p.id=project_id and p.owner_id=uid) then raise exception using errcode='P1201',message='Project not found'; end if;
 if action='begin' then
   if p_context is not null then
     if (p_context->>'operation'=op and p_context->>'keyHash' ~ '^[a-f0-9]{64}$' and p_context->>'fingerprint'=p_input->>'inputFingerprint') is not true then raise invalid_parameter_value; end if;
     perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text||':'||op||':'||(p_context->>'keyHash'),0));
     select * into w from public.project_workflow_runs where created_by=uid and key_hash=p_context->>'keyHash' for update;
     if found then
       if w.input_fingerprint<>p_context->>'fingerprint' then raise exception using errcode='P8001',message='Idempotency conflict'; end if;
       if w.status<>'RUNNING' then return project_private.workflow_summary(w); end if;
       if w.lease_expires_at>clock_timestamp() then raise exception using errcode='P1602',message='Workflow in progress'; end if;
       update public.project_workflow_runs set lease_token=(p_input->>'leaseToken')::uuid,lease_expires_at=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() where id=w.id returning * into w;
       return project_private.workflow_summary(w);
     end if;
   end if;
   if p_input->'request'->'source'->>'kind'='REVISION' then
     select * into r from public.project_revisions where id=(p_input->'request'->'source'->>'sourceRevisionId')::uuid and project_revisions.project_id=workflow_write.project_id;
     if not found then raise exception using errcode='P1205',message='Revision not found'; end if;
     perform project_private.workflow_artifact('REVISION_PERSISTENCE',r.id,r.id,'REUSED');
   elsif p_input->'request'->'source'->>'kind'<>'GENERATE' then raise invalid_parameter_value;
   end if;
   if (p_input->'outputs'=p_input->'plan'->'reusedOutputs' and p_input->'plan'->>'status' in ('PLANNED','BLOCKED')) is not true then raise invalid_parameter_value; end if;
   for item in select value from jsonb_array_elements(p_input->'outputs') loop
     expected:=project_private.workflow_artifact(item->>'capability',(item->>'artifactId')::uuid,r.id,'REUSED');
     if (item=expected) is not true then raise exception using errcode='P1604',message='Invalid reused reference'; end if;
   end loop;
   perform project_private.validate_workflow_manifest(project_id,r.id,p_input->'outputs');
   insert into public.project_workflow_runs(project_id,source_revision_id,created_by,workflow_version,mode,status,input_fingerprint,request_json,plan_json,outputs,key_hash,idempotency_context,lease_token,lease_expires_at)
   values(project_id,r.id,uid,'workflow-v1',p_input->'request'->>'mode','RUNNING',p_input->>'inputFingerprint',p_input->'request',p_input->'plan',p_input->'outputs',p_context->>'keyHash',p_context,(p_input->>'leaseToken')::uuid,clock_timestamp()+interval '5 minutes') returning * into w;
   return project_private.workflow_summary(w);
 end if;
 select * into w from public.project_workflow_runs where id=(p_input->>'runId')::uuid and project_workflow_runs.project_id=workflow_write.project_id for update;
 if not found then raise exception using errcode='P1601',message='Workflow not found'; end if;
 if (w.status='RUNNING' and w.lease_token=(p_input->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp()) is not true then raise exception using errcode='P1603',message='Workflow fenced'; end if;
 if action='step' then
   select value into selected from jsonb_array_elements(w.plan_json->'steps') where value->>'capability'=cap;
   if (w.plan_json->>'status'='PLANNED' and selected->>'action'='EXECUTE'
     and a->'p_input'->>'projectId'=project_id::text and a->'p_context'='null'::jsonb) is not true
     or exists(select 1 from jsonb_array_elements(w.outputs) o where o->>'capability'=cap) then raise exception using errcode='P1604',message='Invalid execution step'; end if;
   for dep in select value from jsonb_array_elements(selected->'dependencies') loop
     if not exists(select 1 from jsonb_array_elements(w.outputs) o where o->'capability'=dep) then raise exception using errcode='P1604',message='Missing step dependency'; end if;
   end loop;
   if cap<>'BLUEPRINT_GENERATION' and (a->'p_input'->>'projectRevisionId'=w.source_revision_id::text) is not true then raise exception using errcode='P1604',message='Wrong execution revision'; end if;
   if cap in ('CONSTRUCTION_CALCULATION','BOQ_COST') and not exists(select 1 from jsonb_array_elements(w.outputs) o where o->>'capability'='QUANTITY_TAKEOFF' and o->>'artifactId'=a->'p_input'->>'takeoffId') then raise exception using errcode='P1604',message='Wrong execution takeoff'; end if;
   if cap='BOQ_COST' and not exists(select 1 from jsonb_array_elements(w.outputs) o where o->>'capability'='CONSTRUCTION_CALCULATION' and o->>'artifactId'=a->'p_input'->>'constructionCalculationId') then raise exception using errcode='P1604',message='Wrong execution construction'; end if;
   case cap
   when 'BLUEPRINT_GENERATION' then
     if (p_input->'call'->>'name'='project_write' and a->>'p_action'='revision' and a->'p_input'->>'sourceMode'='generated'
       and a->'p_input'->'baseRevisionId'=w.request_json->'source'->'baseRevisionId' and w.request_json->'source'->>'kind'='GENERATE') is not true then raise invalid_parameter_value; end if;
     result:=public.project_write('revision',a->'p_input',null,a->>'p_envelope',a->>'p_signature');
     w.source_revision_id:=(result->'revision'->>'id')::uuid;
     new_outputs:=jsonb_build_array(project_private.workflow_artifact('BLUEPRINT_GENERATION',w.source_revision_id,w.source_revision_id,'CREATED'),
       project_private.workflow_artifact('BLUEPRINT_QA',(result->'revision'->'qa'->>'id')::uuid,w.source_revision_id,'CREATED'),
       project_private.workflow_artifact('REVISION_PERSISTENCE',w.source_revision_id,w.source_revision_id,'CREATED'));
   when 'QUANTITY_TAKEOFF' then
     if p_input->'call'->>'name'<>'takeoff_write' then raise invalid_parameter_value; end if;
     result:=public.takeoff_write(a->'p_input',null,a->>'p_envelope',a->>'p_signature');
   when 'CONSTRUCTION_CALCULATION' then
     if p_input->'call'->>'name'<>'construction_write' then raise invalid_parameter_value; end if;
     result:=public.construction_write(a->'p_input',null,a->>'p_envelope',a->>'p_signature');
   when 'BOQ_COST' then
     if p_input->'call'->>'name'<>'cost_write' then raise invalid_parameter_value; end if;
     result:=public.cost_write(a->'p_input',null,a->>'p_envelope',a->>'p_signature');
   else raise exception using errcode='P1604',message='Capability not implemented';
   end case;
   if cap<>'BLUEPRINT_GENERATION' then new_outputs:=jsonb_build_array(project_private.workflow_artifact(cap,(result->>'id')::uuid,w.source_revision_id,'CREATED')); end if;
   perform project_private.validate_workflow_manifest(project_id,w.source_revision_id,w.outputs||new_outputs);
   update public.project_workflow_runs set source_revision_id=w.source_revision_id,outputs=w.outputs||new_outputs,
     updated_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '5 minutes' where id=w.id;
   return result;
 elsif action='finish' then
   err:=p_input->'errors';
   if jsonb_typeof(err)<>'array' or jsonb_array_length(err)>20 then raise invalid_parameter_value; end if;
   if w.plan_json->>'status'='BLOCKED' then final_status:='BLOCKED';
   elsif jsonb_array_length(err)>0 then final_status:=case when jsonb_array_length(w.outputs)>0 then 'PARTIALLY_COMPLETED' else 'FAILED' end;
   elsif exists(select 1 from jsonb_array_elements(w.plan_json->'steps') s where s->>'action'<>'UNAVAILABLE'
     and not exists(select 1 from jsonb_array_elements(w.outputs) o where o->'capability'=s->'capability')) then
     raise exception using errcode='P1604',message='Workflow is incomplete';
   else final_status:='COMPLETED'; end if;
   update public.project_workflow_runs set status=final_status,errors=err,updated_at=clock_timestamp() where id=w.id returning * into w;
   result:=project_private.workflow_summary(w);
   if w.idempotency_context is not null then
     insert into public.idempotency_records(user_id,operation,key_hash,fingerprint,response)
       values(uid,op,w.key_hash,w.input_fingerprint,result);
   end if;
   return result;
 end if;
 raise invalid_parameter_value;
end;
$$;
create function public.workflow_read(p_action text,p_input jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
<<workflow_read>>
declare project_id uuid:=(p_input->>'projectId')::uuid; revision_id uuid:=(p_input->>'revisionId')::uuid;
 w public.project_workflow_runs; artifact_id uuid; items jsonb; next_cursor jsonb; total integer; page_limit integer:=(p_input->>'limit')::integer; cursor_value jsonb:=nullif(p_input->'cursor','null'::jsonb);
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if not exists(select 1 from public.projects p where p.id=project_id and p.owner_id=auth.uid()) then raise exception using errcode='P1201',message='Project not found'; end if;
 if p_action='get' then
   select * into w from public.project_workflow_runs where id=(p_input->>'runId')::uuid and project_workflow_runs.project_id=workflow_read.project_id;
   if not found then raise exception using errcode='P1601',message='Workflow not found'; end if;
   return project_private.workflow_summary(w);
 elsif p_action='find' then
   if not exists(select 1 from public.project_revisions r where r.id=revision_id and r.project_id=workflow_read.project_id) then raise exception using errcode='P1205',message='Revision not found'; end if;
   case p_input->>'kind'
   when 'takeoff' then select id into artifact_id from public.project_revision_takeoffs where project_revision_id=revision_id and input_fingerprint=p_input->>'fingerprint';
   when 'construction' then select id into artifact_id from public.project_revision_construction_calculations where project_revision_id=revision_id and input_fingerprint=p_input->>'fingerprint';
   when 'cost' then select id into artifact_id from public.project_revision_cost_estimates where project_revision_id=revision_id and input_fingerprint=p_input->>'fingerprint';
   else raise invalid_parameter_value;
   end case;
   return to_jsonb(artifact_id);
 elsif p_action='list' then
   if page_limit is null or page_limit<1 or page_limit>100 then raise invalid_parameter_value; end if;
   with page as(select * from public.project_workflow_runs where project_workflow_runs.project_id=workflow_read.project_id
     and (cursor_value is null or (created_at,id)<((cursor_value->>'createdAt')::timestamptz,(cursor_value->>'id')::uuid)) order by created_at desc,id desc limit page_limit+1),
   shown as(select * from page order by created_at desc,id desc limit page_limit)
   select (select count(*) from page),coalesce(jsonb_agg(project_private.workflow_summary(shown)-'request'-'plan' order by created_at desc,id desc),'[]'::jsonb),
     (select jsonb_build_object('createdAt',created_at,'id',id) from shown order by created_at,id limit 1) into total,items,next_cursor from shown;
   return jsonb_build_object('items',items,'nextCursor',case when total>page_limit then next_cursor else null end);
 end if;
 raise invalid_parameter_value;
end;
$$;
revoke all on function public.workflow_write(jsonb,jsonb,text,text),public.workflow_read(text,jsonb) from public,anon;
grant execute on function public.workflow_write(jsonb,jsonb,text,text),public.workflow_read(text,jsonb) to authenticated;
revoke all on all functions in schema project_private from public,anon,authenticated;
