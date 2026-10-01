-- Phase 17: additive identity; no historical rewrite or model/engine change.
-- Null identity means historical/unknown, including older signed integrations.
create function project_private.canonical_building(model jsonb) returns jsonb
language plpgsql immutable strict set search_path = '' as $$
declare result jsonb := model - 'provenance'; collection text;
begin
 foreach collection in array array['levels','spaces','walls','openings','stairs','slabs','columns','dimensions','specifications'] loop
   result := jsonb_set(result,array[collection],coalesce((
     select jsonb_agg(case when collection = 'walls' and entity ? 'spaceIds' then jsonb_set(entity,'{spaceIds}',
       coalesce((select jsonb_agg(s order by s #>> '{}' collate "C") from jsonb_array_elements(entity->'spaceIds') s),'[]'::jsonb))
       else entity end order by entity->>'id' collate "C") from jsonb_array_elements(model->collection) entity
   ),'[]'::jsonb));
 end loop;
 return result;
end;
$$;
create function project_private.valid_generation_identity(identity jsonb, requirements jsonb, model jsonb, mode text, version text)
returns boolean language sql immutable set search_path = '' as $$
 select case when identity is null then requirements is null else (
   jsonb_typeof(identity) = 'object'
   and identity - array['identityVersion','generationId','requirementsHash','modelHash','seed'] = '{}'::jsonb
   and identity->>'identityVersion' = 'generation-freshness-v1'
   and identity->>'modelHash' = project_private.cost_hash(jsonb_build_object(
     'identityVersion','generation-freshness-v1','model',project_private.canonical_building(model)))
   and case when mode = 'generated' then
     jsonb_typeof(requirements) = 'object' and octet_length(requirements::text) <= 131072
     and identity->>'generationId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
     and identity->>'requirementsHash' = project_private.cost_hash(jsonb_build_object(
       'identityVersion','generation-freshness-v1','generatorVersion',version,'requirements',requirements - 'seed'))
     and char_length(identity->>'seed') between 1 and 128
     and identity->>'seed' = requirements->>'seed' and identity->>'seed' = model->'provenance'->>'seed'
     and version = model->'provenance'->>'generatorVersion'
   else requirements is null and identity->'generationId' = 'null'::jsonb
     and identity->'requirementsHash' = 'null'::jsonb and identity->'seed' = 'null'::jsonb end
 ) is true end
$$;
alter table public.project_revisions
 add column generation_identity jsonb,
 add column normalized_requirements jsonb,
 add constraint generation_identity_valid check (project_private.valid_generation_identity(
   generation_identity,normalized_requirements,model_json,source_mode,generator_version));
create unique index revisions_generation_id_unique on public.project_revisions ((generation_identity->>'generationId'))
 where generation_identity->>'generationId' is not null;

-- A bounded snapshot of references only. Each family is revision scoped;
-- options/recipe compatibility remains the workflow planner's responsibility.
create function project_private.current_artifact(revision_id uuid, artifact_id uuid, sources jsonb) returns jsonb
language sql immutable set search_path = '' as $$
 select case when revision_id is null then jsonb_build_object('status','NO_CURRENT_REVISION','sourceRevisionId',null)
 when artifact_id is null then jsonb_build_object('status','NOT_GENERATED_FOR_CURRENT_REVISION','sourceRevisionId',revision_id)
 else jsonb_build_object('status','AVAILABLE','sourceRevisionId',revision_id,'artifactId',artifact_id,'sourceArtifactIds',sources) end
$$;
create index construction_revision_created_idx on public.project_revision_construction_calculations(project_revision_id,created_at desc,id desc);
create function project_private.current_artifacts(revision_id uuid) returns jsonb
language sql stable set search_path = '' as $$
 select jsonb_build_object(
   'takeoff',project_private.current_artifact(revision_id,t.id,jsonb_build_array(t.acceptance_qa_id)),
   'construction',project_private.current_artifact(revision_id,c.id,jsonb_build_array(c.takeoff_id)),
   'cost',project_private.current_artifact(revision_id,b.id,jsonb_build_array(b.takeoff_id,b.construction_calculation_id)))
 from (select 1) singleton
 left join lateral (select * from public.project_revision_takeoffs where project_revision_id=revision_id order by created_at desc,id desc limit 1) t on true
 left join lateral (select * from public.project_revision_construction_calculations where project_revision_id=revision_id order by created_at desc,id desc limit 1) c on true
 left join lateral (select * from public.project_revision_cost_estimates where project_revision_id=revision_id order by created_at desc,id desc limit 1) b on true
$$;

create or replace function project_private.revision_summary(r public.project_revisions) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('id',r.id,'projectId',r.project_id,'revisionNumber',r.revision_number,
  'parentRevisionId',r.parent_revision_id,'schemaVersion',r.schema_version,'completeness',r.completeness,
  'sourceMode',r.source_mode,'generatorVersion',r.generator_version,'createdAt',r.created_at,
  'identity',r.generation_identity,'qa',project_private.qa_summary(q)) from public.project_revision_qa_runs q where q.id = r.acceptance_qa_id
$$;
create or replace function project_private.revision_detail(r public.project_revisions) returns jsonb language sql stable set search_path = '' as $$
 select project_private.revision_summary(r) || jsonb_build_object('model',r.model_json,'normalizedRequirements',r.normalized_requirements,'qaRuns',
  (select jsonb_agg(project_private.qa_summary(q) || jsonb_build_object('report',q.report_json) order by q.created_at,q.id)
   from public.project_revision_qa_runs q where q.revision_id = r.id))
$$;

-- Preserve Phase 12 receipt-before-CAS, ownership, QA, locks and atomic writes.
create or replace function public.project_write(p_action text, p_input jsonb, p_context jsonb default null,
 p_envelope text default null, p_signature text default null) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
 p public.projects; r public.project_revisions; receipt public.idempotency_records;
 uid uuid := auth.uid(); result jsonb; envelope jsonb; secret text; op text;
 revision_id uuid; qa_id uuid; report jsonb;
begin
 if uid is null then raise insufficient_privilege; end if;
 if p_action not in ('create','update','revision') then raise invalid_parameter_value; end if;
 if p_action = 'create' then op := '/api/projects';
 elsif p_action = 'revision' and p_input->>'sourceMode' = 'generated' then op := '/api/projects/:projectId/revisions/generate';
 elsif p_action = 'revision' and p_input->>'sourceMode' = 'supplied' then op := '/api/projects/:projectId/revisions';
 elsif p_action <> 'update' then raise invalid_parameter_value; end if;
 -- Signature binds the entire commit, including identity and retry context.
 if p_action = 'revision' then
   select k.secret into secret from project_private.commit_key k where singleton;
   if p_envelope is null or p_signature is null or
     p_signature <> encode(extensions.hmac(convert_to(p_envelope,'UTF8'),decode(secret,'hex'),'sha256'),'hex') then
     raise insufficient_privilege;
   end if;
   envelope := p_envelope::jsonb;
   if (envelope->>'userId' = uid::text and envelope->>'operation' = op
     and envelope->'input' = p_input and envelope->'context' = coalesce(p_context,'null'::jsonb)
     and (envelope->>'expiresAt')::bigint between extract(epoch from clock_timestamp())::bigint and extract(epoch from clock_timestamp())::bigint + 600) is not true then
     raise insufficient_privilege;
   end if;
 end if;
 if p_context is not null then
   if p_action = 'update' or (p_context->>'operation' = op
     and p_context->>'keyHash' ~ '^[a-f0-9]{64}$' and p_context->>'fingerprint' ~ '^[a-f0-9]{64}$') is not true then raise invalid_parameter_value; end if;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text || ':' || op || ':' || (p_context->>'keyHash'),0));
   select * into receipt from public.idempotency_records where user_id = uid and operation = op and key_hash = p_context->>'keyHash';
   if found and receipt.expires_at > now() then
     if receipt.fingerprint <> p_context->>'fingerprint' then raise exception using errcode = 'P8001', message = 'Idempotency conflict'; end if;
     return receipt.response;
   end if;
   delete from public.idempotency_records where user_id = uid and operation = op and key_hash = p_context->>'keyHash';
 end if;
 if p_action = 'create' then
   if (p_input - 'title') <> '{}'::jsonb or jsonb_typeof(p_input->'title') is distinct from 'string' then raise invalid_parameter_value; end if;
   insert into public.projects(owner_id,title) values(uid,btrim(p_input->>'title')) returning * into p;
   insert into public.project_audit_events(project_id,event_type,detail) values(p.id,'created','{}');
   result := project_private.project_detail(p);
 else
   select * into p from public.projects where id = (p_input->>'projectId')::uuid and owner_id = uid for update;
   if not found then raise exception using errcode = 'P1201', message = 'Project not found'; end if;
   if p_action = 'update' then
     if (p_input - array['projectId','title','status','visibility']) <> '{}'::jsonb then raise invalid_parameter_value; end if;
     update public.projects set title = case when p_input ? 'title' then btrim(p_input->>'title') else title end,
       status = coalesce(p_input->>'status',status), visibility = coalesce(p_input->>'visibility',visibility),
       archived_at = case when coalesce(p_input->>'status',status) = 'ARCHIVED' then coalesce(archived_at,now()) else null end,
       updated_at = clock_timestamp() where id = p.id returning * into p;
     insert into public.project_audit_events(project_id,event_type,detail) values(p.id,'metadata_updated',jsonb_build_object('status',p.status,'visibility',p.visibility));
     result := project_private.project_detail(p);
   else
     if p.status = 'ARCHIVED' then raise exception using errcode = 'P1203', message = 'Project archived'; end if;
     if p.current_revision_id is distinct from (p_input->>'baseRevisionId')::uuid then
       raise exception using errcode = 'P1202', message = 'Revision conflict';
     end if;
     report := p_input->'report';
     if (report->>'status' in ('PASS','PASS_WITH_WARNINGS') and report->>'inputStatus' = 'SCHEMA_VALID'
       and report->'summary'->>'errors' = '0') is not true then raise exception using errcode = 'P1204', message = 'QA rejected'; end if;
     revision_id := gen_random_uuid(); qa_id := gen_random_uuid();
     insert into public.project_revisions(id,project_id,revision_number,parent_revision_id,model_json,source_mode,generator_version,created_by,acceptance_qa_id,generation_identity,normalized_requirements)
       values(revision_id,p.id,p.revision_count+1,p.current_revision_id,p_input->'model',p_input->>'sourceMode',p_input->>'generatorVersion',uid,qa_id,nullif(p_input->'identity','null'::jsonb),nullif(p_input->'normalizedRequirements','null'::jsonb)) returning * into r;
     insert into public.project_revision_qa_runs(id,revision_id,qa_version,model_schema_version,rule_packs,status,report_json)
       values(qa_id,r.id,report->>'qaVersion',(report->>'modelSchemaVersion')::integer,report->'rulePacks',report->>'status',report);
     update public.projects set current_revision_id = r.id, revision_count = r.revision_number, updated_at = clock_timestamp() where id = p.id returning * into p;
     insert into public.project_audit_events(project_id,revision_id,event_type,detail)
       values(p.id,r.id,'revision_committed',jsonb_build_object('revisionNumber',r.revision_number,'qaStatus',report->>'status','sourceMode',r.source_mode));
     result := jsonb_build_object('project',project_private.project_summary(p),'revision',project_private.revision_detail(r));
   end if;
 end if;
 if p_context is not null then
   insert into public.idempotency_records(user_id,operation,key_hash,fingerprint,response)
     values(uid,op,p_context->>'keyHash',p_context->>'fingerprint',result);
 end if;
 return result;
end;
$$;
create or replace function public.project_read(p_action text, p_project_id uuid default null, p_revision_id uuid default null,
 p_limit integer default 20, p_cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.projects; detail_revision public.project_revisions; items jsonb; next_cursor jsonb; total integer;
begin
 if p_action = 'public' then
   select * into p from public.projects where id = p_project_id and visibility = 'PUBLIC' and status = 'ACTIVE' and owner_id is not null;
   if not found then raise exception using errcode = 'P1201', message = 'Project not found'; end if;
   return jsonb_build_object('id',p.id,'title',p.title,'updatedAt',p.updated_at,'currentRevision',
     (select jsonb_build_object('id',r.id,'revisionNumber',r.revision_number,'createdAt',r.created_at,'model',r.model_json,'qa',project_private.qa_summary(q))
      from public.project_revisions r join public.project_revision_qa_runs q on q.id = r.acceptance_qa_id where r.id = p.current_revision_id));
 end if;
 if auth.uid() is null then raise insufficient_privilege; end if;
 if p_limit is null or p_limit < 1 or p_limit > 100 then raise invalid_parameter_value; end if;
 if p_action = 'list' then
   with page as (select * from public.projects where owner_id = auth.uid()
     and (p_cursor is null or (updated_at,id) < ((p_cursor->>'updatedAt')::timestamptz,(p_cursor->>'id')::uuid))
     order by updated_at desc,id desc limit p_limit+1),
   shown as (select * from page order by updated_at desc,id desc limit p_limit)
   select (select count(*) from page),coalesce(jsonb_agg(project_private.project_summary(shown) order by updated_at desc,id desc),'[]'::jsonb),
     (select jsonb_build_object('updatedAt',updated_at,'id',id) from shown order by updated_at,id limit 1)
     into total,items,next_cursor from shown;
   return jsonb_build_object('items',items,'nextCursor',case when total > p_limit then next_cursor else null end);
 end if;
 select * into p from public.projects where id = p_project_id and owner_id = auth.uid();
 if not found then raise exception using errcode = 'P1201', message = 'Project not found'; end if;
 if p_action = 'get' then return project_private.project_detail(p); end if;
 if p_action = 'get-freshness' then return project_private.project_detail(p) ||
   jsonb_build_object('currentArtifacts',project_private.current_artifacts(p.current_revision_id)); end if;
 if p_action = 'revision' then
   select * into detail_revision from public.project_revisions where id = p_revision_id and project_id = p.id;
   if not found then raise exception using errcode = 'P1205', message = 'Revision not found'; end if;
   return project_private.revision_detail(detail_revision);
 end if;
 if p_action = 'history' then
   with page as (select * from public.project_revisions where project_id = p.id
     and (p_cursor is null or revision_number < (p_cursor->>'revisionNumber')::integer)
     order by revision_number desc limit p_limit+1),
   shown as (select * from page order by revision_number desc limit p_limit)
   select (select count(*) from page),coalesce(jsonb_agg(project_private.revision_summary(shown) order by revision_number desc),'[]'::jsonb),
     jsonb_build_object('revisionNumber',min(revision_number)) into total,items,next_cursor from shown;
   return jsonb_build_object('items',items,'nextCursor',case when total > p_limit then next_cursor else null end);
 end if;
 raise invalid_parameter_value;
end;
$$;
-- Existing public function ACLs survive CREATE OR REPLACE; private helpers are never public RPCs.
revoke all on all functions in schema project_private from public, anon, authenticated;
