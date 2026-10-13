-- Phase 39: immutable, owner-only advisory design-concept sets (interior or exterior, 1-3 alternatives) bound to one accepted revision.
-- A set records what it consumed (normalized request, brief hash and fields, reference metadata hashes) and who produced it (a configured
-- provider and model, or the deterministic templates). It is advisory: assurance is fixed to ADVISORY_UNVERIFIED and every claim to
-- NOT_CLAIMED, and nothing here changes a revision, an engineering status or a blocker. Identical inputs converge on one row, so a
-- repeated request replays the stored set instead of paying a provider again. Additive only: no historical migration, row or identity changes.
create table public.project_revision_design_concepts (
 id uuid primary key default gen_random_uuid(),
 project_revision_id uuid not null references public.project_revisions(id),
 acceptance_qa_id uuid not null,
 concept_version text not null check (concept_version = 'design-concept-set-v1'),
 scope text not null check (scope in ('INTERIOR','EXTERIOR')),
 source text not null check (source in ('PROVIDER','DETERMINISTIC_TEMPLATE')),
 provider_id text check (provider_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
 model_id text check (model_id ~ '^[A-Za-z0-9._:/-]{1,100}$'),
 alternative_count integer not null check (alternative_count between 1 and 3),
 model_hash text not null check (model_hash ~ '^[a-f0-9]{64}$'),
 input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
 content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
 concept_json jsonb not null check (octet_length(concept_json::text) <= 262144),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (project_revision_id, acceptance_qa_id) references public.project_revision_qa_runs(revision_id,id),
 unique (project_revision_id,input_hash),
 check ((source = 'PROVIDER') = (provider_id is not null and model_id is not null)),
 -- Columns must agree with the set; assurance and claims are fixed, never caller-controlled.
 check ((jsonb_typeof(concept_json) = 'object' and concept_json->>'conceptSetVersion' = concept_version and concept_json->>'scope' = scope
   and concept_json->>'source' = source and concept_json->'binding'->>'revisionId' = project_revision_id::text
   and concept_json->'binding'->>'acceptanceQaId' = acceptance_qa_id::text and concept_json->'binding'->>'modelHash' = model_hash
   and concept_json->>'inputHash' = input_hash and concept_json->>'contentHash' = content_hash
   and jsonb_array_length(concept_json->'alternatives') = alternative_count
   and concept_json->'provenance'->>'providerId' is not distinct from provider_id and concept_json->'provenance'->>'modelId' is not distinct from model_id
   and concept_json->'assurance'->>'status' = 'ADVISORY_UNVERIFIED'
   and concept_json->'claims' = jsonb_build_object('dimensionalAccuracy','NOT_CLAIMED','engineeringValidity','NOT_CLAIMED','structuralSafety','NOT_CLAIMED',
     'codeCompliance','NOT_CLAIMED','costAccuracy','NOT_CLAIMED','constructionReadiness','NOT_CLAIMED','professionalCertification','NOT_CLAIMED')) is true)
);
create index design_concepts_revision_created_idx on public.project_revision_design_concepts(project_revision_id,created_at desc,id desc);
create index design_concepts_acceptance_qa_idx on public.project_revision_design_concepts(acceptance_qa_id);
create index design_concepts_provider_created_idx on public.project_revision_design_concepts(created_at) where source = 'PROVIDER';
alter table public.project_revision_design_concepts enable row level security;
revoke all on public.project_revision_design_concepts from public,anon,authenticated,service_role;
grant select on public.project_revision_design_concepts to authenticated,service_role;
create policy design_concepts_owner_read on public.project_revision_design_concepts for select to authenticated using (
 exists (select 1 from public.project_revisions r join public.projects p on p.id=r.project_id
 where r.id=project_revision_id and p.owner_id=(select auth.uid()))
);
create trigger design_concepts_immutable before update or delete on public.project_revision_design_concepts
 for each row execute function project_private.immutable_revision();

create function project_private.design_concept_summary(c public.project_revision_design_concepts) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('id',c.id,'projectRevisionId',c.project_revision_id,'scope',c.scope,'conceptSetVersion',c.concept_version,'source',c.source,
 'providerId',c.provider_id,'modelId',c.model_id,'alternativeCount',c.alternative_count,'modelHash',c.model_hash,'inputHash',c.input_hash,
 'contentHash',c.content_hash,'createdAt',c.created_at)
$$;
-- Provider-sourced sets stored for an owner in the last 24 hours (templates are free and not counted).
create function project_private.design_concept_provider_count(p_owner uuid) returns integer language sql stable set search_path = '' as $$
 select count(*)::integer from public.project_revision_design_concepts d join public.project_revisions r on r.id=d.project_revision_id
 join public.projects p on p.id=r.project_id where p.owner_id=p_owner and d.source='PROVIDER' and d.created_at > clock_timestamp() - interval '24 hours'
$$;

-- Every binding is recomputed from the stored revision and every hash from the set itself, never trusted from the payload.
create function public.design_concept_write(p_input jsonb,p_envelope text default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
 uid uuid := auth.uid(); op text := '/api/projects/:projectId/revisions/:revisionId/design-concepts';
 p public.projects; r public.project_revisions; q public.project_revision_qa_runs; c public.project_revision_design_concepts;
 s jsonb := p_input->'conceptSet'; model_hash text; replayed boolean := false;
begin
 if uid is null then raise insufficient_privilege; end if;
 perform project_private.verify_envelope(op,p_input,null,p_envelope,p_signature);
 select * into p from public.projects where id=(p_input->>'projectId')::uuid and owner_id=uid;
 if not found then raise exception using errcode='P1201',message='Project not found'; end if;
 select * into r from public.project_revisions where id=(p_input->>'projectRevisionId')::uuid and project_id=p.id;
 if not found then raise exception using errcode='P1205',message='Revision not found'; end if;
 select * into q from public.project_revision_qa_runs where id=r.acceptance_qa_id and revision_id=r.id;
 if (q.status in ('PASS','PASS_WITH_WARNINGS') and q.report_json->>'inputStatus'='SCHEMA_VALID' and q.report_json->'summary'->>'errors'='0') is not true then
   raise exception using errcode='P3902',message='Revision not accepted'; end if;
 model_hash := project_private.revision_model_hash(r.model_json);
 if (jsonb_typeof(s)='object' and s->>'conceptSetVersion'='design-concept-set-v1' and s->>'scope' in ('INTERIOR','EXTERIOR')
   and s->'binding'->>'projectId'=p.id::text and s->'binding'->>'revisionId'=r.id::text and (s->'binding'->>'revisionNumber')::integer=r.revision_number
   and s->'binding'->>'modelHash'=model_hash and s->'binding'->>'acceptanceQaId'=q.id::text and s->'binding'->>'qaStatus'=q.status
   and (r.generation_identity is null or r.generation_identity->>'modelHash'=model_hash)
   -- The request, the alternatives and the input identity agree with each other and with this revision.
   and s->'request'->>'scope'=s->>'scope' and (s->'request'->>'alternatives')::integer=jsonb_array_length(s->'alternatives')
   and not jsonb_path_exists(s->'alternatives','$[*] ? (@.scope != $scope)',jsonb_build_object('scope',s->'scope'))
   and s->'inputs'->'identity'->>'version'=s->>'conceptSetVersion' and s->'inputs'->'identity'->>'revisionId'=r.id::text
   and s->'inputs'->'identity'->>'modelHash'=model_hash and s->'inputs'->'identity'->'request'=s->'request'
   and s->'inputs'->'identity'->'briefHash'=coalesce(s->'inputs'->'brief'->'briefHash','null'::jsonb)
   and s->'inputs'->'identity'->'references'=(select coalesce(jsonb_agg(jsonb_build_object('referenceId',x->'referenceId','storedSha256',x->'storedSha256') order by o),'[]'::jsonb)
     from jsonb_array_elements(s->'inputs'->'references') with ordinality t(x,o))
   and s->>'inputHash'=project_private.cost_hash(s->'inputs'->'identity')
   -- Assurance and claims are fixed: no set can claim accuracy, validity, safety, compliance, cost accuracy, readiness or certification.
   and s->'assurance'->>'status'='ADVISORY_UNVERIFIED'
   and s->'claims'=jsonb_build_object('dimensionalAccuracy','NOT_CLAIMED','engineeringValidity','NOT_CLAIMED','structuralSafety','NOT_CLAIMED',
     'codeCompliance','NOT_CLAIMED','costAccuracy','NOT_CLAIMED','constructionReadiness','NOT_CLAIMED','professionalCertification','NOT_CLAIMED')
   -- Provenance agrees with the source: a provider set names its provider and model; a template set names neither.
   and ((s->>'source'='PROVIDER' and s->'provenance'->>'status'='SUCCESS' and s->'provenance'->>'generator' in ('AUTO','PROVIDER')
       and jsonb_typeof(s->'provenance'->'providerId')='string' and jsonb_typeof(s->'provenance'->'modelId')='string' and s->'provenance'->'templateVersion'='null'::jsonb)
     or (s->>'source'='DETERMINISTIC_TEMPLATE' and s->'provenance'->'providerId'='null'::jsonb and s->'provenance'->'modelId'='null'::jsonb
       and s->'provenance'->>'templateVersion'='design-concept-templates-v1'
       and ((s->'provenance'->>'status'='TEMPLATE' and s->'provenance'->>'generator'='TEMPLATE')
         or (s->'provenance'->>'status'='FALLBACK' and s->'provenance'->>'generator'='AUTO'))))
   and s->'request'->>'generator'=s->'provenance'->>'generator'
   and s->>'contentHash'=project_private.cost_hash(s - 'contentHash')) is not true then
   raise exception using errcode='P3903',message='Design concept set is not bound to this revision'; end if;
 -- Identical inputs converge on the first stored set (a provider's output is not reproducible, so the first one wins).
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('design-concept:' || r.id::text || ':' || (s->>'inputHash'),0));
 select * into c from public.project_revision_design_concepts where project_revision_id=r.id and input_hash=s->>'inputHash';
 if found then replayed := true;
 else
   if s->>'source'='PROVIDER' then
     perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('design-concept-quota:' || uid::text,0));
     if project_private.design_concept_provider_count(uid) >= 50 then
       raise exception using errcode='P3904',message='Provider design-concept quota exceeded'; end if;
   end if;
   insert into public.project_revision_design_concepts(project_revision_id,acceptance_qa_id,concept_version,scope,source,provider_id,model_id,
     alternative_count,model_hash,input_hash,content_hash,concept_json)
   values(r.id,q.id,s->>'conceptSetVersion',s->>'scope',s->>'source',s->'provenance'->>'providerId',s->'provenance'->>'modelId',
     jsonb_array_length(s->'alternatives'),model_hash,s->>'inputHash',s->>'contentHash',s)
   returning * into c;
 end if;
 return project_private.design_concept_summary(c) || jsonb_build_object('conceptSet',c.concept_json,'projectCurrentRevisionId',p.current_revision_id,'replayed',replayed);
end;
$$;

create function public.design_concept_read(p_action text,p_project_id uuid,p_revision_id uuid,p_concept_id uuid default null,p_input_hash text default null,
 p_limit integer default 20,p_cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.project_revision_design_concepts; p public.projects; items jsonb; next_cursor jsonb; total integer;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into p from public.projects where id=p_project_id and owner_id=auth.uid();
 if not found then raise exception using errcode='P1201',message='Project not found'; end if;
 perform 1 from public.project_revisions r where r.id=p_revision_id and r.project_id=p_project_id;
 if not found then raise exception using errcode='P1205',message='Revision not found'; end if;
 if p_action='get' then
   select * into c from public.project_revision_design_concepts where id=p_concept_id and project_revision_id=p_revision_id;
   if not found then raise exception using errcode='P3901',message='Design concept set not found'; end if;
   return project_private.design_concept_summary(c) || jsonb_build_object('conceptSet',c.concept_json,'projectCurrentRevisionId',p.current_revision_id,'replayed',true);
 elsif p_action='lookup' then
   if p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$' then raise invalid_parameter_value; end if;
   select * into c from public.project_revision_design_concepts where project_revision_id=p_revision_id and input_hash=p_input_hash;
   return jsonb_build_object('match',case when found then project_private.design_concept_summary(c) || jsonb_build_object('conceptSet',c.concept_json,
     'projectCurrentRevisionId',p.current_revision_id,'replayed',true) else null end,
     'providerSetsLast24h',project_private.design_concept_provider_count(auth.uid()),'projectCurrentRevisionId',p.current_revision_id);
 elsif p_action='list' then
   if p_limit is null or p_limit<1 or p_limit>100 then raise invalid_parameter_value; end if;
   with page as (select * from public.project_revision_design_concepts where project_revision_id=p_revision_id
     and (p_cursor is null or (created_at,id)<((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid))
     order by created_at desc,id desc limit p_limit+1),
   shown as (select * from page order by created_at desc,id desc limit p_limit)
   select (select count(*) from page),coalesce(jsonb_agg(project_private.design_concept_summary(shown) order by created_at desc,id desc),'[]'::jsonb),
   (select jsonb_build_object('createdAt',created_at,'id',id) from shown order by created_at,id limit 1) into total,items,next_cursor from shown;
   return jsonb_build_object('items',items,'nextCursor',case when total>p_limit then next_cursor else null end,'projectCurrentRevisionId',p.current_revision_id);
 end if;
 raise invalid_parameter_value;
end;
$$;
revoke all on function public.design_concept_write(jsonb,text,text),public.design_concept_read(text,uuid,uuid,uuid,text,integer,jsonb) from public,anon;
grant execute on function public.design_concept_write(jsonb,text,text),public.design_concept_read(text,uuid,uuid,uuid,text,integer,jsonb) to authenticated;
revoke all on all functions in schema project_private from public,anon,authenticated;
