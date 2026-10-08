-- Phase 28: immutable, owner-only optimization studies bound to an accepted parametric revision.
-- Studies are advisory proposals: no row here changes a revision, the current revision, BIM or any analysis.
-- Additive only: no historical migration, row or identity is rewritten. Mirrors 0017.
create table public.project_revision_optimization_studies (
 id uuid primary key default gen_random_uuid(),
 project_revision_id uuid not null references public.project_revisions(id),
 acceptance_qa_id uuid not null,
 study_version text not null check (study_version = 'optimization-study-v1'),
 optimizer_version text not null check (optimizer_version = 'optimization-engine-v1'),
 model_hash text not null check (model_hash ~ '^[a-f0-9]{64}$'),
 input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
 result_hash text not null check (result_hash ~ '^[a-f0-9]{64}$'),
 strategy text not null check (strategy in ('GRID','DETERMINISTIC_LOCAL_SEARCH')),
 mode text not null check (mode in ('WEIGHTED_SCORE','PARETO')),
 status text not null check (status in ('COMPLETED','NO_VALID_CANDIDATE','BUDGET_EXHAUSTED')),
 candidate_count integer not null check (candidate_count between 1 and 128),
 valid_count integer not null check (valid_count between 0 and candidate_count),
 snapshot_json jsonb not null check (octet_length(snapshot_json::text) <= 2000000),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (project_revision_id, acceptance_qa_id) references public.project_revision_qa_runs(revision_id,id),
 unique (project_revision_id,input_hash),
 -- Columns must agree with the snapshot; claims and engineering scope are fixed, never optimizer-controlled.
 check ((jsonb_typeof(snapshot_json) = 'object' and snapshot_json->>'version' = study_version
   and snapshot_json->'engine'->>'optimizerVersion' = optimizer_version
   and snapshot_json->'binding'->>'sourceRevisionId' = project_revision_id::text and snapshot_json->'binding'->>'sourceModelHash' = model_hash
   and snapshot_json->>'inputHash' = input_hash and snapshot_json->>'resultHash' = result_hash
   and snapshot_json->'input'->'strategy'->>'kind' = strategy and snapshot_json->'input'->>'mode' = mode and snapshot_json->>'status' = status
   and jsonb_array_length(snapshot_json->'candidates') = candidate_count and (snapshot_json->'search'->>'valid')::integer = valid_count
   and (snapshot_json->'claims') - 'searchResult' = jsonb_build_object('globalOptimality','NOT_CLAIMED','architecturalCompliance','NOT_CLAIMED',
     'structuralCompliance','NOT_CLAIMED','buildingCodeCompliance','NOT_CLAIMED','fireCodeCompliance','NOT_CLAIMED','lifeSafetyCertification','NOT_CLAIMED',
     'energyCertification','NOT_CLAIMED','costCertainty','NOT_CLAIMED','professionalCertification','NOT_CLAIMED','constructionReadiness','NOT_CLAIMED','designApproval','NOT_CLAIMED')
   and snapshot_json->'claims'->>'searchResult' in ('BEST_IN_EVALUATED_SEARCH_SPACE','BEST_FOUND','NONE')
   and snapshot_json->'engineering' = jsonb_build_object('structural','NOT_EVALUATED','environmental','NOT_EVALUATED','systems','NOT_EVALUATED',
     'knowledge','NOT_EVALUATED','reason','UPSTREAM_INPUTS_NOT_TRANSFERABLE_TO_CANDIDATES','phase27','PHASE27_INTEGRATION_DEFERRED')
   and not jsonb_path_exists(snapshot_json,'$.candidates[*] ? (@.architectureMutation != "NONE")')) is true)
);
create index optimization_revision_created_idx on public.project_revision_optimization_studies(project_revision_id,created_at desc,id desc);
create index optimization_acceptance_qa_idx on public.project_revision_optimization_studies(acceptance_qa_id);
alter table public.project_revision_optimization_studies enable row level security;
revoke all on public.project_revision_optimization_studies from public,anon,authenticated,service_role;
grant select on public.project_revision_optimization_studies to authenticated,service_role;
create policy optimization_owner_read on public.project_revision_optimization_studies for select to authenticated using (
 exists (select 1 from public.project_revisions r join public.projects p on p.id=r.project_id
 where r.id=project_revision_id and p.owner_id=(select auth.uid()))
);
create trigger optimization_immutable before update or delete on public.project_revision_optimization_studies
 for each row execute function project_private.immutable_revision();

create function project_private.optimization_summary(o public.project_revision_optimization_studies) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('id',o.id,'projectRevisionId',o.project_revision_id,'acceptanceQaId',o.acceptance_qa_id,'studyVersion',o.study_version,
 'optimizerVersion',o.optimizer_version,'modelHash',o.model_hash,'inputHash',o.input_hash,'resultHash',o.result_hash,'strategy',o.strategy,'mode',o.mode,
 'status',o.status,'candidateCount',o.candidate_count,'validCount',o.valid_count,'searchResult',o.snapshot_json->'claims'->>'searchResult',
 'recommendedCandidates',o.snapshot_json->'recommendedCandidates','createdAt',o.created_at)
$$;

alter table public.idempotency_records drop constraint idempotency_records_operation_check;
alter table public.idempotency_records add check(operation in (
 '/api/plans','/api/plans/generate','/api/estimates','/api/projects','/api/projects/:projectId/revisions',
 '/api/projects/:projectId/revisions/generate','/api/projects/:projectId/revisions/:revisionId/takeoffs',
 '/api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations',
 '/api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations/:calculationId/cost-estimates',
 '/api/projects/:projectId/workflows',
 '/api/projects/:projectId/revisions/:revisionId/structural/analyses',
 '/api/projects/:projectId/revisions/:revisionId/environmental/analyses',
 '/api/projects/:projectId/revisions/:revisionId/systems/analyses',
 '/api/projects/:projectId/revisions/:revisionId/knowledge/analyses',
 '/api/projects/:projectId/revisions/:revisionId/optimization/studies'));

create function public.optimization_write(p_input jsonb,p_context jsonb default null,p_envelope text default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
 uid uuid := auth.uid(); op text := '/api/projects/:projectId/revisions/:revisionId/optimization/studies';
 secret text; envelope jsonb; r public.project_revisions; q public.project_revision_qa_runs; o public.project_revision_optimization_studies;
 receipt public.idempotency_records; snap jsonb := p_input->'snapshot'; result jsonb; c jsonb; a jsonb; identity jsonb;
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
 raise exception using errcode='P2802',message='Revision not accepted'; end if;
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
 -- Binding is recomputed from the stored revision, never trusted from the payload; the study carries only integers and strings,
 -- so input, result and candidate identities recompute byte-identically in SQL (design §24).
 if (jsonb_typeof(snap)='object' and r.generator_version='parametric-architecture-v1' and r.normalized_requirements is not null
 and snap->'binding'->>'projectId'=r.project_id::text and snap->'binding'->>'sourceRevisionId'=r.id::text
 and snap->'binding'->>'sourceModelHash'=project_private.cost_hash(jsonb_build_object('identityVersion','generation-freshness-v1','model',project_private.canonical_building(r.model_json)))
 and snap->'binding'->>'sourceModelHash'=r.generation_identity->>'modelHash'
 and snap->'binding'->>'generatorVersion'=r.generator_version and snap->'binding'->>'seed'=r.normalized_requirements->>'seed'
 and snap->'binding'->>'parameterHash'=project_private.cost_hash(r.model_json->'parametricArchitecture')
 and snap->>'inputHash'=project_private.cost_hash(snap->'input')
 and snap->>'resultHash'=project_private.cost_hash(snap - 'resultHash')
 and jsonb_typeof(snap->'candidates')='array' and jsonb_array_length(snap->'candidates') between 1 and 128) is not true then
 raise exception using errcode='P2803',message='Optimization study is not bound to this revision'; end if;
 identity := jsonb_build_object('version','optimization-candidate-v1','projectId',snap->'binding'->'projectId','sourceRevisionId',snap->'binding'->'sourceRevisionId',
   'sourceModelHash',snap->'binding'->'sourceModelHash','generatorVersion',snap->'binding'->'generatorVersion','seed',snap->'binding'->'seed');
 for c in select value from jsonb_array_elements(snap->'candidates') loop
   if c->>'candidateId' <> project_private.cost_hash(identity || jsonb_build_object('parameters',c->'parameters')) then
     raise exception using errcode='P2803',message='Optimization candidate identity does not recompute'; end if;
   for a in select value from jsonb_array_elements(coalesce(c->'aliases','[]'::jsonb)) loop
     if a->>'candidateId' <> project_private.cost_hash(identity || jsonb_build_object('parameters',a->'parameters')) then
       raise exception using errcode='P2803',message='Optimization alias identity does not recompute'; end if;
   end loop;
 end loop;
 if snap->'baseline'->>'candidateId' <> project_private.cost_hash(identity || jsonb_build_object('parameters',snap->'baseline'->'parameters')) then
   raise exception using errcode='P2803',message='Optimization baseline identity does not recompute'; end if;
 -- Concurrent identical requests converge on one immutable study.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('optimization:' || r.id::text || ':' || (snap->>'inputHash'),0));
 select * into o from public.project_revision_optimization_studies where project_revision_id=r.id and input_hash=snap->>'inputHash';
 if found then
   if o.result_hash<>snap->>'resultHash' then raise exception using errcode='P2803',message='Nondeterministic optimization result for an identical input'; end if;
 else
   insert into public.project_revision_optimization_studies(project_revision_id,acceptance_qa_id,study_version,optimizer_version,model_hash,input_hash,result_hash,
     strategy,mode,status,candidate_count,valid_count,snapshot_json)
   values(r.id,q.id,snap->>'version',snap->'engine'->>'optimizerVersion',snap->'binding'->>'sourceModelHash',snap->>'inputHash',snap->>'resultHash',
     snap->'input'->'strategy'->>'kind',snap->'input'->>'mode',snap->>'status',jsonb_array_length(snap->'candidates'),(snap->'search'->>'valid')::integer,snap)
   returning * into o;
 end if;
 result := project_private.optimization_summary(o) || jsonb_build_object('snapshot',o.snapshot_json);
 if p_context is not null then
   insert into public.idempotency_records(user_id,operation,key_hash,fingerprint,response)
   values(uid,op,p_context->>'keyHash',p_context->>'fingerprint',result);
 end if;
 return result;
end;
$$;

create function public.optimization_read(p_action text,p_project_id uuid,p_revision_id uuid,p_study_id uuid default null,p_limit integer default 20,p_cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.project_revision_optimization_studies; p public.projects; items jsonb; next_cursor jsonb; total integer; revision_number integer;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into p from public.projects where id=p_project_id and owner_id=auth.uid();
 if not found then raise exception using errcode='P1201',message='Project not found'; end if;
 select r.revision_number into revision_number from public.project_revisions r where r.id=p_revision_id and r.project_id=p_project_id;
 if not found then raise exception using errcode='P1205',message='Revision not found'; end if;
 if p_action='get' then
   select * into o from public.project_revision_optimization_studies where id=p_study_id and project_revision_id=p_revision_id;
   if not found then raise exception using errcode='P2801',message='Optimization study not found'; end if;
   return project_private.optimization_summary(o) || jsonb_build_object('snapshot',o.snapshot_json,'projectCurrentRevisionId',p.current_revision_id);
 elsif p_action='list' then
   if p_limit is null or p_limit<1 or p_limit>100 then raise invalid_parameter_value; end if;
   with page as (select * from public.project_revision_optimization_studies where project_revision_id=p_revision_id
     and (p_cursor is null or (created_at,id)<((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid))
     order by created_at desc,id desc limit p_limit+1),
   shown as (select * from page order by created_at desc,id desc limit p_limit)
   select (select count(*) from page),coalesce(jsonb_agg(project_private.optimization_summary(shown) order by created_at desc,id desc),'[]'::jsonb),
   (select jsonb_build_object('createdAt',created_at,'id',id) from shown order by created_at,id limit 1) into total,items,next_cursor from shown;
   return jsonb_build_object('items',items,'nextCursor',case when total>p_limit then next_cursor else null end,'projectCurrentRevisionId',p.current_revision_id);
 elsif p_action='status' then
   return jsonb_build_object('projectCurrentRevisionId',p.current_revision_id,'revisionNumber',revision_number,
     'studies',coalesce((select jsonb_agg(x.item order by x.created_at desc,x.id desc) from (
       select project_private.optimization_summary(s) item,s.created_at,s.id from public.project_revision_optimization_studies s
       where s.project_revision_id=p_revision_id order by s.created_at desc,s.id desc limit 20) x),'[]'::jsonb),
     'otherRevisionStudies',coalesce((select jsonb_agg(x.item order by x.created_at desc,x.id desc) from (
       select project_private.optimization_summary(s) || jsonb_build_object('revisionNumber',r.revision_number) item,s.created_at,s.id
       from public.project_revision_optimization_studies s join public.project_revisions r on r.id=s.project_revision_id
       where r.project_id=p_project_id and r.id<>p_revision_id order by s.created_at desc,s.id desc limit 20) x),'[]'::jsonb));
 end if;
 raise invalid_parameter_value;
end;
$$;
revoke all on function public.optimization_write(jsonb,jsonb,text,text),public.optimization_read(text,uuid,uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.optimization_write(jsonb,jsonb,text,text),public.optimization_read(text,uuid,uuid,uuid,integer,jsonb) to authenticated;
revoke all on all functions in schema project_private from public,anon,authenticated;
