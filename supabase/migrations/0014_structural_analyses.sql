-- Phase 24: immutable, owner-only structural analysis snapshots bound to accepted revisions.
-- Additive only: no historical migration, row or identity is rewritten.
create table public.project_revision_structural_analyses (
 id uuid primary key default gen_random_uuid(),
 project_revision_id uuid not null references public.project_revisions(id),
 acceptance_qa_id uuid not null,
 structural_model_version text not null check (structural_model_version = 'structural-model-v1'),
 analysis_version text not null check (analysis_version = 'structural-analysis-v1'),
 model_hash text not null check (model_hash ~ '^[a-f0-9]{64}$'),
 input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
 analysis_model_hash text not null check (analysis_model_hash ~ '^[a-f0-9]{64}$'),
 solver_name text not null check (char_length(solver_name) between 1 and 100),
 solver_version text not null check (char_length(solver_version) between 1 and 100),
 adapter_version text not null check (adapter_version = 'structural-adapter-v1'),
 status text not null check (status = 'VALIDATED'),
 snapshot_json jsonb not null check (octet_length(snapshot_json::text) <= 10000000),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (project_revision_id, acceptance_qa_id) references public.project_revision_qa_runs(revision_id,id),
 unique (project_revision_id,input_hash),
 -- One row carries metadata and results together; columns must agree with the snapshot they describe.
 check ((jsonb_typeof(snapshot_json) = 'object' and snapshot_json->>'version' = analysis_version
   and snapshot_json->>'inputHash' = input_hash and snapshot_json->>'analysisModelHash' = analysis_model_hash
   and snapshot_json->'binding'->>'revisionId' = project_revision_id::text and snapshot_json->'binding'->>'modelHash' = model_hash
   and snapshot_json->'binding'->>'structuralModelVersion' = structural_model_version and snapshot_json->'model'->>'version' = structural_model_version
   and snapshot_json->'solver'->>'name' = solver_name and snapshot_json->'solver'->>'version' = solver_version
   and snapshot_json->'solver'->>'adapterVersion' = adapter_version
   and snapshot_json->'status'->>'analysis' = 'ANALYZED' and snapshot_json->'status'->>'validation' = status
   and snapshot_json->'claims'->>'designVerification' = 'NOT_EVALUATED' and snapshot_json->'claims'->>'certification' = 'NOT_CLAIMED'
   and jsonb_typeof(snapshot_json->'results'->'sets') = 'array' and jsonb_array_length(snapshot_json->'results'->'sets') > 0) is true)
);
create index structural_revision_created_idx on public.project_revision_structural_analyses(project_revision_id,created_at desc,id desc);
create index structural_acceptance_qa_idx on public.project_revision_structural_analyses(acceptance_qa_id);
alter table public.project_revision_structural_analyses enable row level security;
revoke all on public.project_revision_structural_analyses from public,anon,authenticated,service_role;
grant select on public.project_revision_structural_analyses to authenticated,service_role;
create policy structural_owner_read on public.project_revision_structural_analyses for select to authenticated using (
 exists (select 1 from public.project_revisions r join public.projects p on p.id=r.project_id
 where r.id=project_revision_id and p.owner_id=(select auth.uid()))
);
create trigger structural_immutable before update or delete on public.project_revision_structural_analyses
 for each row execute function project_private.immutable_revision();

create function project_private.structural_summary(a public.project_revision_structural_analyses) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('id',a.id,'projectRevisionId',a.project_revision_id,'acceptanceQaId',a.acceptance_qa_id,
 'structuralModelVersion',a.structural_model_version,'analysisVersion',a.analysis_version,'modelHash',a.model_hash,'inputHash',a.input_hash,
 'analysisModelHash',a.analysis_model_hash,'solver',jsonb_build_object('name',a.solver_name,'version',a.solver_version,'adapterVersion',a.adapter_version),
 'status',a.status,'createdAt',a.created_at,'counts',jsonb_build_object(
   'nodes',jsonb_array_length(a.snapshot_json->'model'->'nodes'),'members',jsonb_array_length(a.snapshot_json->'model'->'members'),
   'segments',jsonb_array_length(a.snapshot_json->'model'->'segments'),'loadCases',jsonb_array_length(a.snapshot_json->'model'->'loadCases'),
   'combinations',jsonb_array_length(a.snapshot_json->'model'->'combinations')))
$$;

alter table public.idempotency_records drop constraint idempotency_records_operation_check;
alter table public.idempotency_records add check(operation in (
 '/api/plans','/api/plans/generate','/api/estimates','/api/projects','/api/projects/:projectId/revisions',
 '/api/projects/:projectId/revisions/generate','/api/projects/:projectId/revisions/:revisionId/takeoffs',
 '/api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations',
 '/api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations/:calculationId/cost-estimates',
 '/api/projects/:projectId/workflows',
 '/api/projects/:projectId/revisions/:revisionId/structural/analyses'));

create function public.structural_write(p_input jsonb,p_context jsonb default null,p_envelope text default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
 uid uuid := auth.uid(); op text := '/api/projects/:projectId/revisions/:revisionId/structural/analyses';
 secret text; envelope jsonb; r public.project_revisions; q public.project_revision_qa_runs;
 a public.project_revision_structural_analyses; receipt public.idempotency_records; snap jsonb := p_input->'snapshot'; result jsonb;
begin
 if uid is null then raise insufficient_privilege; end if;
 select k.secret into secret from project_private.commit_key k where singleton;
 if p_envelope is null or p_signature is null or
 p_signature <> encode(extensions.hmac(convert_to(p_envelope,'UTF8'),decode(secret,'hex'),'sha256'),'hex') then raise insufficient_privilege; end if;
 envelope := p_envelope::jsonb;
 if (envelope->>'userId'=uid::text and envelope->>'operation'=op and envelope->'input'=p_input
 and envelope->'context'=coalesce(p_context,'null'::jsonb)
 and (envelope->>'expiresAt')::bigint between extract(epoch from clock_timestamp())::bigint and extract(epoch from clock_timestamp())::bigint+600) is not true then raise insufficient_privilege; end if;
 -- Ownership is checked even for a receipt replay.
 if not exists(select 1 from public.projects where id=(p_input->>'projectId')::uuid and owner_id=uid) then
 raise exception using errcode='P1201',message='Project not found'; end if;
 select * into r from public.project_revisions where id=(p_input->>'projectRevisionId')::uuid and project_id=(p_input->>'projectId')::uuid;
 if not found then raise exception using errcode='P1205',message='Revision not found'; end if;
 select * into q from public.project_revision_qa_runs where id=r.acceptance_qa_id and revision_id=r.id;
 if (q.status in ('PASS','PASS_WITH_WARNINGS') and q.report_json->>'inputStatus'='SCHEMA_VALID'
 and q.report_json->'summary'->>'errors'='0' and p_input->>'acceptanceQaId'=q.id::text) is not true then
 raise exception using errcode='P2402',message='Revision not accepted'; end if;
 if p_context is not null then
   if (p_context->>'operation'=op and p_context->>'keyHash' ~ '^[a-f0-9]{64}$' and p_context->>'fingerprint' ~ '^[a-f0-9]{64}$') is not true then raise invalid_parameter_value; end if;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text || ':' || op || ':' || (p_context->>'keyHash'),0));
   select * into receipt from public.idempotency_records where user_id=uid and operation=op and key_hash=p_context->>'keyHash';
   if found and receipt.expires_at>now() then
     if receipt.fingerprint<>p_context->>'fingerprint' then raise exception using errcode='P8001',message='Idempotency conflict'; end if;
     return receipt.response;
   end if;
   delete from public.idempotency_records where user_id=uid and operation=op and key_hash=p_context->>'keyHash';
 end if;
 -- Revision binding is recomputed from the stored architecture, never trusted from the payload.
 if (jsonb_typeof(snap)='object' and snap->'binding'->>'projectId'=r.project_id::text and snap->'binding'->>'revisionId'=r.id::text
 and snap->'binding'->>'modelHash'=project_private.cost_hash(jsonb_build_object('identityVersion','generation-freshness-v1','model',project_private.canonical_building(r.model_json)))
 and snap->'binding'->'generatorVersion'=coalesce(to_jsonb(r.generator_version),'null'::jsonb)
 and snap->'binding'->'generationId'=coalesce(r.generation_identity->'generationId','null'::jsonb)
 and snap->'binding'->'requirementsHash'=coalesce(r.generation_identity->'requirementsHash','null'::jsonb)
 and snap->'binding'->'parameterHash'=case when r.model_json ? 'parametricArchitecture' then to_jsonb(project_private.cost_hash(r.model_json->'parametricArchitecture')) else 'null'::jsonb end
 and snap->'binding'->>'bimVersion'='bim-semantic-v1') is not true then
 raise exception using errcode='P2403',message='Structural snapshot is not bound to this revision'; end if;
 -- Concurrent identical requests converge on one immutable artifact.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('structural:' || r.id::text || ':' || (snap->>'inputHash'),0));
 select * into a from public.project_revision_structural_analyses where project_revision_id=r.id and input_hash=snap->>'inputHash';
 if found then
   if a.analysis_model_hash<>snap->>'analysisModelHash' or a.snapshot_json->'results'<>snap->'results' then
     raise exception using errcode='P2403',message='Nondeterministic structural result for an identical input'; end if;
 else
   insert into public.project_revision_structural_analyses(project_revision_id,acceptance_qa_id,structural_model_version,analysis_version,model_hash,input_hash,
     analysis_model_hash,solver_name,solver_version,adapter_version,status,snapshot_json)
   values(r.id,q.id,snap->'binding'->>'structuralModelVersion',snap->>'version',snap->'binding'->>'modelHash',snap->>'inputHash',snap->>'analysisModelHash',
     snap->'solver'->>'name',snap->'solver'->>'version',snap->'solver'->>'adapterVersion',snap->'status'->>'validation',snap) returning * into a;
 end if;
 result := project_private.structural_summary(a) || jsonb_build_object('snapshot',a.snapshot_json);
 if p_context is not null then
   insert into public.idempotency_records(user_id,operation,key_hash,fingerprint,response)
   values(uid,op,p_context->>'keyHash',p_context->>'fingerprint',result);
 end if;
 return result;
end;
$$;

create function public.structural_read(p_action text,p_project_id uuid,p_revision_id uuid,p_analysis_id uuid default null,p_limit integer default 20,p_cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.project_revision_structural_analyses; p public.projects; items jsonb; next_cursor jsonb; total integer; revision_number integer;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into p from public.projects where id=p_project_id and owner_id=auth.uid();
 if not found then raise exception using errcode='P1201',message='Project not found'; end if;
 select r.revision_number into revision_number from public.project_revisions r where r.id=p_revision_id and r.project_id=p_project_id;
 if not found then raise exception using errcode='P1205',message='Revision not found'; end if;
 if p_action='get' then
   select * into a from public.project_revision_structural_analyses where id=p_analysis_id and project_revision_id=p_revision_id;
   if not found then raise exception using errcode='P2401',message='Structural analysis not found'; end if;
   return project_private.structural_summary(a) || jsonb_build_object('snapshot',a.snapshot_json,'projectCurrentRevisionId',p.current_revision_id);
 elsif p_action='list' then
   if p_limit is null or p_limit<1 or p_limit>100 then raise invalid_parameter_value; end if;
   with page as (select * from public.project_revision_structural_analyses where project_revision_id=p_revision_id
     and (p_cursor is null or (created_at,id)<((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid))
     order by created_at desc,id desc limit p_limit+1),
   shown as (select * from page order by created_at desc,id desc limit p_limit)
   select (select count(*) from page),coalesce(jsonb_agg(project_private.structural_summary(shown) order by created_at desc,id desc),'[]'::jsonb),
   (select jsonb_build_object('createdAt',created_at,'id',id) from shown order by created_at,id limit 1) into total,items,next_cursor from shown;
   return jsonb_build_object('items',items,'nextCursor',case when total>p_limit then next_cursor else null end,'projectCurrentRevisionId',p.current_revision_id);
 elsif p_action='status' then
   return jsonb_build_object('projectCurrentRevisionId',p.current_revision_id,'revisionNumber',revision_number,
     'analyses',coalesce((select jsonb_agg(x.item order by x.created_at desc,x.id desc) from (
       select project_private.structural_summary(s) item,s.created_at,s.id from public.project_revision_structural_analyses s
       where s.project_revision_id=p_revision_id order by s.created_at desc,s.id desc limit 20) x),'[]'::jsonb),
     'otherRevisionAnalyses',coalesce((select jsonb_agg(x.item order by x.created_at desc,x.id desc) from (
       select project_private.structural_summary(s) || jsonb_build_object('revisionNumber',r.revision_number) item,s.created_at,s.id
       from public.project_revision_structural_analyses s join public.project_revisions r on r.id=s.project_revision_id
       where r.project_id=p_project_id and r.id<>p_revision_id order by s.created_at desc,s.id desc limit 20) x),'[]'::jsonb));
 end if;
 raise invalid_parameter_value;
end;
$$;
revoke all on function public.structural_write(jsonb,jsonb,text,text),public.structural_read(text,uuid,uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.structural_write(jsonb,jsonb,text,text),public.structural_read(text,uuid,uuid,uuid,integer,jsonb) to authenticated;
revoke all on all functions in schema project_private from public,anon,authenticated;
