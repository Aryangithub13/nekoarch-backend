-- Phase 14: construction materials from exact immutable takeoffs and explicit specifications.
alter table public.project_revision_takeoffs add constraint takeoffs_revision_id_unique unique(project_revision_id,id);
create table public.project_revision_construction_calculations (
 id uuid primary key default gen_random_uuid(),
 project_revision_id uuid not null references public.project_revisions(id),
 takeoff_id uuid not null,
 acceptance_qa_id uuid not null,
 engine_version text not null check(char_length(engine_version) between 1 and 100),
 recipe_pack jsonb not null check(jsonb_typeof(recipe_pack)='object'),
 specification jsonb not null check(jsonb_typeof(specification)='object'),
 options jsonb not null check(jsonb_typeof(options)='object'),
 input_fingerprint text not null unique check(input_fingerprint ~ '^[a-f0-9]{64}$'),
 status text not null check(status in ('EVALUATED','PARTIAL','NOT_EVALUATED')),
 report_json jsonb not null check(octet_length(report_json::text)<=20000000),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(project_revision_id,takeoff_id) references public.project_revision_takeoffs(project_revision_id,id),
 foreign key(project_revision_id,acceptance_qa_id) references public.project_revision_qa_runs(revision_id,id),
 check((jsonb_typeof(report_json)='object' and report_json->>'engineVersion'=engine_version
   and report_json->'recipePack'=recipe_pack and report_json->'specification'=specification and report_json->'options'=options
   and report_json->'summary'->>'status'=status and jsonb_typeof(report_json->'materials')='array'
   and jsonb_typeof(report_json->'items')='array' and jsonb_typeof(report_json->'coverage')='array') is true)
);
create index construction_takeoff_created_idx on public.project_revision_construction_calculations(takeoff_id,created_at desc,id desc);
create index construction_revision_idx on public.project_revision_construction_calculations(project_revision_id);
create index construction_qa_idx on public.project_revision_construction_calculations(acceptance_qa_id);
alter table public.project_revision_construction_calculations enable row level security;
revoke all on public.project_revision_construction_calculations from public,anon,authenticated,service_role;
grant select on public.project_revision_construction_calculations to authenticated,service_role;
create policy construction_owner_read on public.project_revision_construction_calculations for select to authenticated using (
 exists(select 1 from public.project_revisions r join public.projects p on p.id=r.project_id where r.id=project_revision_id and p.owner_id=(select auth.uid()))
);
create trigger construction_immutable before update or delete on public.project_revision_construction_calculations
 for each row execute function project_private.immutable_revision();
create function project_private.construction_summary(t public.project_revision_construction_calculations) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',t.id,'projectRevisionId',t.project_revision_id,'takeoffId',t.takeoff_id,'acceptanceQaId',t.acceptance_qa_id,
 'engineVersion',t.engine_version,'recipePack',t.recipe_pack,'inputFingerprint',t.input_fingerprint,'status',t.status,
 'createdAt',t.created_at,'summary',t.report_json->'summary')
$$;
alter table public.idempotency_records drop constraint idempotency_records_operation_check;
alter table public.idempotency_records add check(operation in (
 '/api/plans','/api/plans/generate','/api/estimates','/api/projects','/api/projects/:projectId/revisions',
 '/api/projects/:projectId/revisions/generate','/api/projects/:projectId/revisions/:revisionId/takeoffs',
 '/api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations'));
create function public.construction_write(p_input jsonb,p_context jsonb default null,p_envelope text default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
 uid uuid := auth.uid(); op text := '/api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations';
 secret text; envelope jsonb; r public.project_revisions; q public.project_revision_qa_runs;
 t public.project_revision_construction_calculations; receipt public.idempotency_records; report jsonb := p_input->'report';
 result jsonb; fingerprint text; source public.project_revision_takeoffs;
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
 raise exception using errcode='P1402',message='Revision not accepted'; end if;
 select * into source from public.project_revision_takeoffs where id=(p_input->>'takeoffId')::uuid and project_revision_id=r.id;
 if not found then raise exception using errcode='P1301',message='Takeoff not found'; end if;
 if (source.acceptance_qa_id=q.id and report->>'takeoffEngineVersion'=source.engine_version
   and report->>'measurementPolicyVersion'=source.measurement_policy_version
   and q.report_json->>'status' in ('PASS','PASS_WITH_WARNINGS')
   and report->'recipePack'=report->'specification'->'recipePack') is not true then
 raise exception using errcode='P1402',message='Takeoff not accepted'; end if;
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
 fingerprint := encode(extensions.digest(convert_to(project_private.canonical_json(jsonb_build_object(
 'projectRevisionId',r.id,'takeoffId',source.id,'takeoffInputFingerprint',source.input_fingerprint,
 'takeoffReportHash',encode(extensions.digest(convert_to(project_private.canonical_json(source.report_json),'UTF8'),'sha256'),'hex'),
 'engineVersion',report->'engineVersion','recipePack',report->'recipePack','specification',report->'specification','options',report->'options')),'UTF8'),'sha256'),'hex');
 if p_input->>'inputFingerprint' is distinct from fingerprint then raise exception using errcode='P1403',message='Construction provenance mismatch'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('construction:' || fingerprint,0));
 select * into t from public.project_revision_construction_calculations where input_fingerprint=fingerprint;
 if found then
   if t.report_json<>report then raise exception using errcode='P1403',message='Deterministic report mismatch'; end if;
 else
   if (report->'summary'->>'status'=case when jsonb_array_length(report->'items')=0 then 'NOT_EVALUATED'
     when exists(select 1 from jsonb_array_elements(report->'coverage') c where c->>'status'<>'EVALUATED') then 'PARTIAL' else 'EVALUATED' end) is not true then
     raise exception using errcode='P1403',message='Construction coverage mismatch'; end if;
   insert into public.project_revision_construction_calculations(project_revision_id,takeoff_id,acceptance_qa_id,engine_version,recipe_pack,specification,options,input_fingerprint,status,report_json)
   values(r.id,source.id,q.id,report->>'engineVersion',report->'recipePack',report->'specification',report->'options',fingerprint,report->'summary'->>'status',report) returning * into t;
 end if;
 result := project_private.construction_summary(t) || jsonb_build_object('report',t.report_json);
 if p_context is not null then
   insert into public.idempotency_records(user_id,operation,key_hash,fingerprint,response)
   values(uid,op,p_context->>'keyHash',p_context->>'fingerprint',result);
 end if;
 return result;
end;
$$;
create function public.construction_read(p_project_id uuid,p_revision_id uuid,p_takeoff_id uuid,p_calculation_id uuid default null,p_limit integer default 20,p_cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.project_revision_construction_calculations; items jsonb; next_cursor jsonb; total integer;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if not exists(select 1 from public.projects where id=p_project_id and owner_id=auth.uid()) then raise exception using errcode='P1201',message='Project not found'; end if;
 if not exists(select 1 from public.project_revisions where id=p_revision_id and project_id=p_project_id) then raise exception using errcode='P1205',message='Revision not found'; end if;
 if not exists(select 1 from public.project_revision_takeoffs where id=p_takeoff_id and project_revision_id=p_revision_id) then raise exception using errcode='P1301',message='Takeoff not found'; end if;
 if p_calculation_id is not null then
   select * into t from public.project_revision_construction_calculations where id=p_calculation_id and project_revision_id=p_revision_id and takeoff_id=p_takeoff_id;
   if not found then raise exception using errcode='P1401',message='Construction calculation not found'; end if;
   return project_private.construction_summary(t) || jsonb_build_object('report',t.report_json);
 end if;
 if p_limit is null or p_limit<1 or p_limit>100 then raise invalid_parameter_value; end if;
 with page as (select * from public.project_revision_construction_calculations where project_revision_id=p_revision_id and takeoff_id=p_takeoff_id
   and (p_cursor is null or (created_at,id)<((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid))
   order by created_at desc,id desc limit p_limit+1),
 shown as (select * from page order by created_at desc,id desc limit p_limit)
 select (select count(*) from page),coalesce(jsonb_agg(project_private.construction_summary(shown) order by created_at desc,id desc),'[]'::jsonb),
 (select jsonb_build_object('createdAt',created_at,'id',id) from shown order by created_at,id limit 1) into total,items,next_cursor from shown;
 return jsonb_build_object('items',items,'nextCursor',case when total>p_limit then next_cursor else null end);
end;
$$;
revoke all on function public.construction_write(jsonb,jsonb,text,text),public.construction_read(uuid,uuid,uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.construction_write(jsonb,jsonb,text,text),public.construction_read(uuid,uuid,uuid,uuid,integer,jsonb) to authenticated;
revoke all on all functions in schema project_private from public,anon,authenticated;
