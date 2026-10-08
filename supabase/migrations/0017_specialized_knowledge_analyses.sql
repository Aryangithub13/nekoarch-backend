-- Phase 27: immutable, owner-only specialized-knowledge rule evaluations bound to accepted revisions and, optionally,
-- to explicit structural (0014), environmental (0015) and building-systems (0016) analyses of the same revision.
-- Additive only: no historical migration, row or identity is rewritten. Mirrors 0016.
create table public.project_revision_specialized_knowledge_analyses (
 id uuid primary key default gen_random_uuid(),
 project_revision_id uuid not null references public.project_revisions(id),
 acceptance_qa_id uuid not null,
 structural_analysis_id uuid references public.project_revision_structural_analyses(id),
 environmental_analysis_id uuid references public.project_revision_environmental_analyses(id),
 systems_analysis_id uuid references public.project_revision_building_systems_analyses(id),
 knowledge_model_version text not null check (knowledge_model_version = 'specialized-knowledge-model-v1'),
 analysis_version text not null check (analysis_version = 'specialized-knowledge-analysis-v1'),
 model_hash text not null check (model_hash ~ '^[a-f0-9]{64}$'),
 input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
 facts_hash text not null check (facts_hash ~ '^[a-f0-9]{64}$'),
 pack_identities jsonb not null check (jsonb_typeof(pack_identities) = 'array' and jsonb_array_length(pack_identities) between 1 and 8),
 evaluator_name text not null check (char_length(evaluator_name) between 1 and 100),
 evaluator_version text not null check (char_length(evaluator_version) between 1 and 100),
 status text not null check (status = 'VALIDATED'),
 snapshot_json jsonb not null check (octet_length(snapshot_json::text) <= 9000000),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (project_revision_id, acceptance_qa_id) references public.project_revision_qa_runs(revision_id,id),
 unique (project_revision_id,input_hash),
 -- One row carries metadata and results together; columns must agree with the snapshot. Claims are never evaluator-controlled.
 check ((jsonb_typeof(snapshot_json) = 'object' and snapshot_json->>'version' = analysis_version
   and snapshot_json->>'inputHash' = input_hash and snapshot_json->>'factsHash' = facts_hash
   and snapshot_json->'binding'->>'revisionId' = project_revision_id::text and snapshot_json->'binding'->>'modelHash' = model_hash
   and snapshot_json->'binding'->>'knowledgeModelVersion' = knowledge_model_version and snapshot_json->'facts'->>'version' = 'project-facts-v1'
   and coalesce(snapshot_json->'binding'->'structural'->>'analysisId','') = coalesce(structural_analysis_id::text,'')
   and coalesce(snapshot_json->'binding'->'environmental'->>'analysisId','') = coalesce(environmental_analysis_id::text,'')
   and coalesce(snapshot_json->'binding'->'systems'->>'analysisId','') = coalesce(systems_analysis_id::text,'')
   and snapshot_json->'binding'->'packs' = pack_identities
   and snapshot_json->'evaluator'->>'name' = evaluator_name and snapshot_json->'evaluator'->>'version' = evaluator_version
   and snapshot_json->'status'->>'analysis' = 'EVALUATED' and snapshot_json->'status'->>'validation' = status
   -- Exactly these 13 claims, all NOT_CLAIMED: no claim may be added, dropped or changed.
   and snapshot_json->'claims' = jsonb_build_object('architecturalCompliance','NOT_CLAIMED','structuralCompliance','NOT_CLAIMED','electricalCompliance','NOT_CLAIMED','plumbingCompliance','NOT_CLAIMED','hvacCompliance','NOT_CLAIMED','fireCodeCompliance','NOT_CLAIMED','lifeSafetyCertification','NOT_CLAIMED','accessibilityCompliance','NOT_CLAIMED','elevatorCertification','NOT_CLAIMED','energyCertification','NOT_CLAIMED','buildingCodeCompliance','NOT_CLAIMED','legalCompliance','NOT_CLAIMED','professionalCertification','NOT_CLAIMED')
   and jsonb_typeof(snapshot_json->'results') = 'array' and jsonb_typeof(snapshot_json->'conflicts') = 'array'
   and jsonb_typeof(snapshot_json->'facts'->'items') = 'array') is true)
);
create index knowledge_revision_created_idx on public.project_revision_specialized_knowledge_analyses(project_revision_id,created_at desc,id desc);
create index knowledge_acceptance_qa_idx on public.project_revision_specialized_knowledge_analyses(acceptance_qa_id);
create index knowledge_structural_idx on public.project_revision_specialized_knowledge_analyses(structural_analysis_id);
create index knowledge_environmental_idx on public.project_revision_specialized_knowledge_analyses(environmental_analysis_id);
create index knowledge_systems_idx on public.project_revision_specialized_knowledge_analyses(systems_analysis_id);
alter table public.project_revision_specialized_knowledge_analyses enable row level security;
revoke all on public.project_revision_specialized_knowledge_analyses from public,anon,authenticated,service_role;
grant select on public.project_revision_specialized_knowledge_analyses to authenticated,service_role;
create policy knowledge_owner_read on public.project_revision_specialized_knowledge_analyses for select to authenticated using (
 exists (select 1 from public.project_revisions r join public.projects p on p.id=r.project_id
 where r.id=project_revision_id and p.owner_id=(select auth.uid()))
);
create trigger knowledge_immutable before update or delete on public.project_revision_specialized_knowledge_analyses
 for each row execute function project_private.immutable_revision();

create function project_private.knowledge_summary(a public.project_revision_specialized_knowledge_analyses) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('id',a.id,'projectRevisionId',a.project_revision_id,'acceptanceQaId',a.acceptance_qa_id,
 'knowledgeModelVersion',a.knowledge_model_version,'analysisVersion',a.analysis_version,'modelHash',a.model_hash,'inputHash',a.input_hash,'factsHash',a.facts_hash,
 'packs',a.pack_identities,'evaluator',jsonb_build_object('name',a.evaluator_name,'version',a.evaluator_version),'status',a.status,
 'structuralAnalysisId',a.structural_analysis_id,'environmentalAnalysisId',a.environmental_analysis_id,'systemsAnalysisId',a.systems_analysis_id,'createdAt',a.created_at,
 'counts',jsonb_build_object('facts',jsonb_array_length(a.snapshot_json->'facts'->'items'),'results',jsonb_array_length(a.snapshot_json->'results'),
   'conflicts',jsonb_array_length(a.snapshot_json->'conflicts'),'meets',(a.snapshot_json->'summary'->'byStatus'->>'MEETS_RULE')::integer,
   'doesNotMeet',(a.snapshot_json->'summary'->'byStatus'->>'DOES_NOT_MEET_RULE')::integer))
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
 '/api/projects/:projectId/revisions/:revisionId/knowledge/analyses'));

create function public.knowledge_write(p_input jsonb,p_context jsonb default null,p_envelope text default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
 uid uuid := auth.uid(); op text := '/api/projects/:projectId/revisions/:revisionId/knowledge/analyses';
 secret text; envelope jsonb; r public.project_revisions; q public.project_revision_qa_runs;
 s public.project_revision_structural_analyses; e public.project_revision_environmental_analyses; y public.project_revision_building_systems_analyses;
 a public.project_revision_specialized_knowledge_analyses; receipt public.idempotency_records; snap jsonb := p_input->'snapshot'; result jsonb; i integer;
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
 raise exception using errcode='P2702',message='Revision not accepted'; end if;
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
 and snap->'binding'->>'bimVersion'='bim-semantic-v1' and snap->'binding'->>'knowledgeModelVersion'='specialized-knowledge-model-v1'
 and coalesce(snap->'input'->'sources'->>'structuralAnalysisId','') = coalesce(snap->'binding'->'structural'->>'analysisId','')
 and coalesce(snap->'input'->'sources'->>'environmentalAnalysisId','') = coalesce(snap->'binding'->'environmental'->>'analysisId','')
 and coalesce(snap->'input'->'sources'->>'systemsAnalysisId','') = coalesce(snap->'binding'->'systems'->>'analysisId','')
 and snap->'input'->'scope'->'disciplines' = snap->'binding'->'disciplines'
 -- Input and fact identities recompute in SQL: binding, input and facts carry no non-integer JSON numbers (design §14).
 and snap->>'inputHash' = project_private.cost_hash(jsonb_build_object('version',snap->>'version','binding',snap->'binding','input',snap->'input'))
 and snap->>'factsHash' = project_private.cost_hash(snap->'facts')) is not true then
 raise exception using errcode='P2703',message='Knowledge snapshot is not bound to this revision'; end if;
 -- Every embedded pack must reproduce its checksum and match the binding and the selection, in order.
 if (jsonb_typeof(snap->'packs')='array' and jsonb_typeof(snap->'binding'->'packs')='array' and jsonb_typeof(snap->'input'->'packs')='array'
 and jsonb_array_length(snap->'packs') = jsonb_array_length(snap->'binding'->'packs')
 and jsonb_array_length(snap->'packs') = jsonb_array_length(snap->'input'->'packs')) is not true then
 raise exception using errcode='P2703',message='Knowledge pack selection is malformed'; end if;
 for i in 0..jsonb_array_length(snap->'packs')-1 loop
   if (project_private.cost_hash(snap->'packs'->i->'pack') = snap->'packs'->i->>'checksum'
   and snap->'packs'->i->>'checksum' = snap->'binding'->'packs'->i->>'checksum'
   and snap->'packs'->i->>'packId' = snap->'binding'->'packs'->i->>'packId' and snap->'packs'->i->>'version' = snap->'binding'->'packs'->i->>'version'
   and snap->'packs'->i->>'packId' = snap->'input'->'packs'->i->>'packId' and snap->'packs'->i->>'version' = snap->'input'->'packs'->i->>'version'
   and snap->'packs'->i->'pack'->>'packId' = snap->'packs'->i->>'packId' and snap->'packs'->i->'pack'->>'version' = snap->'packs'->i->>'version') is not true then
     raise exception using errcode='P2703',message='Knowledge pack checksum does not recompute'; end if;
 end loop;
 -- Upstream artifacts must be explicit, exist in this same revision, and match their recorded input hashes and model versions.
 if jsonb_typeof(snap->'binding'->'structural')='object' then
   select * into s from public.project_revision_structural_analyses where id=(snap->'binding'->'structural'->>'analysisId')::uuid and project_revision_id=r.id;
   if not found or s.input_hash<>snap->'binding'->'structural'->>'inputHash' or s.structural_model_version<>snap->'binding'->'structural'->>'modelVersion' then
     raise exception using errcode='P2703',message='Structural source is not an analysis of this revision'; end if;
 elsif snap->'binding'->'structural'<>'null'::jsonb then raise exception using errcode='P2703',message='Malformed structural binding';
 end if;
 if jsonb_typeof(snap->'binding'->'environmental')='object' then
   select * into e from public.project_revision_environmental_analyses where id=(snap->'binding'->'environmental'->>'analysisId')::uuid and project_revision_id=r.id;
   if not found or e.input_hash<>snap->'binding'->'environmental'->>'inputHash' or e.environmental_model_version<>snap->'binding'->'environmental'->>'modelVersion' then
     raise exception using errcode='P2703',message='Environmental source is not an analysis of this revision'; end if;
 elsif snap->'binding'->'environmental'<>'null'::jsonb then raise exception using errcode='P2703',message='Malformed environmental binding';
 end if;
 if jsonb_typeof(snap->'binding'->'systems')='object' then
   select * into y from public.project_revision_building_systems_analyses where id=(snap->'binding'->'systems'->>'analysisId')::uuid and project_revision_id=r.id;
   if not found or y.input_hash<>snap->'binding'->'systems'->>'inputHash' or y.systems_model_version<>snap->'binding'->'systems'->>'modelVersion' then
     raise exception using errcode='P2703',message='Systems source is not an analysis of this revision'; end if;
   -- TRANSITIVE_UPSTREAM_BINDING_CONSISTENCY: a nested reference must equal any explicitly bound analysis of that discipline.
   if (y.structural_analysis_id is null or s.id is null or y.structural_analysis_id = s.id)
   and (y.environmental_analysis_id is null or e.id is null or y.environmental_analysis_id = e.id) is not true then
     raise exception using errcode='P2703',message='Systems source references different upstream analyses'; end if;
 elsif snap->'binding'->'systems'<>'null'::jsonb then raise exception using errcode='P2703',message='Malformed systems binding';
 end if;
 -- Concurrent identical requests converge on one immutable artifact.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('knowledge:' || r.id::text || ':' || (snap->>'inputHash'),0));
 select * into a from public.project_revision_specialized_knowledge_analyses where project_revision_id=r.id and input_hash=snap->>'inputHash';
 if found then
   if a.facts_hash<>snap->>'factsHash' or a.snapshot_json->'results'<>snap->'results' then
     raise exception using errcode='P2703',message='Nondeterministic knowledge result for an identical input'; end if;
 else
   insert into public.project_revision_specialized_knowledge_analyses(project_revision_id,acceptance_qa_id,structural_analysis_id,environmental_analysis_id,systems_analysis_id,
     knowledge_model_version,analysis_version,model_hash,input_hash,facts_hash,pack_identities,evaluator_name,evaluator_version,status,snapshot_json)
   values(r.id,q.id,s.id,e.id,y.id,snap->'binding'->>'knowledgeModelVersion',snap->>'version',snap->'binding'->>'modelHash',snap->>'inputHash',snap->>'factsHash',
     snap->'binding'->'packs',snap->'evaluator'->>'name',snap->'evaluator'->>'version',snap->'status'->>'validation',snap) returning * into a;
 end if;
 result := project_private.knowledge_summary(a) || jsonb_build_object('snapshot',a.snapshot_json);
 if p_context is not null then
   insert into public.idempotency_records(user_id,operation,key_hash,fingerprint,response)
   values(uid,op,p_context->>'keyHash',p_context->>'fingerprint',result);
 end if;
 return result;
end;
$$;

create function public.knowledge_read(p_action text,p_project_id uuid,p_revision_id uuid,p_analysis_id uuid default null,p_limit integer default 20,p_cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.project_revision_specialized_knowledge_analyses; p public.projects; items jsonb; next_cursor jsonb; total integer; revision_number integer;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into p from public.projects where id=p_project_id and owner_id=auth.uid();
 if not found then raise exception using errcode='P1201',message='Project not found'; end if;
 select r.revision_number into revision_number from public.project_revisions r where r.id=p_revision_id and r.project_id=p_project_id;
 if not found then raise exception using errcode='P1205',message='Revision not found'; end if;
 if p_action='get' then
   select * into a from public.project_revision_specialized_knowledge_analyses where id=p_analysis_id and project_revision_id=p_revision_id;
   if not found then raise exception using errcode='P2701',message='Knowledge analysis not found'; end if;
   return project_private.knowledge_summary(a) || jsonb_build_object('snapshot',a.snapshot_json,'projectCurrentRevisionId',p.current_revision_id);
 elsif p_action='list' then
   if p_limit is null or p_limit<1 or p_limit>100 then raise invalid_parameter_value; end if;
   with page as (select * from public.project_revision_specialized_knowledge_analyses where project_revision_id=p_revision_id
     and (p_cursor is null or (created_at,id)<((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid))
     order by created_at desc,id desc limit p_limit+1),
   shown as (select * from page order by created_at desc,id desc limit p_limit)
   select (select count(*) from page),coalesce(jsonb_agg(project_private.knowledge_summary(shown) order by created_at desc,id desc),'[]'::jsonb),
   (select jsonb_build_object('createdAt',created_at,'id',id) from shown order by created_at,id limit 1) into total,items,next_cursor from shown;
   return jsonb_build_object('items',items,'nextCursor',case when total>p_limit then next_cursor else null end,'projectCurrentRevisionId',p.current_revision_id);
 elsif p_action='status' then
   return jsonb_build_object('projectCurrentRevisionId',p.current_revision_id,'revisionNumber',revision_number,
     'analyses',coalesce((select jsonb_agg(x.item order by x.created_at desc,x.id desc) from (
       select project_private.knowledge_summary(k) item,k.created_at,k.id from public.project_revision_specialized_knowledge_analyses k
       where k.project_revision_id=p_revision_id order by k.created_at desc,k.id desc limit 20) x),'[]'::jsonb),
     'otherRevisionAnalyses',coalesce((select jsonb_agg(x.item order by x.created_at desc,x.id desc) from (
       select project_private.knowledge_summary(k) || jsonb_build_object('revisionNumber',r.revision_number) item,k.created_at,k.id
       from public.project_revision_specialized_knowledge_analyses k join public.project_revisions r on r.id=k.project_revision_id
       where r.project_id=p_project_id and r.id<>p_revision_id order by k.created_at desc,k.id desc limit 20) x),'[]'::jsonb));
 end if;
 raise invalid_parameter_value;
end;
$$;
revoke all on function public.knowledge_write(jsonb,jsonb,text,text),public.knowledge_read(text,uuid,uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.knowledge_write(jsonb,jsonb,text,text),public.knowledge_read(text,uuid,uuid,uuid,integer,jsonb) to authenticated;
revoke all on all functions in schema project_private from public,anon,authenticated;
