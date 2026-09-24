-- Native V2 is additive. Historical V1 contracts and data are untouched.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema project_private;
revoke all on schema project_private from public, anon, authenticated;
create table project_private.commit_key (
  singleton boolean primary key default true check (singleton),
  secret text not null check (secret ~ '^[a-f0-9]{64}$')
);
insert into project_private.commit_key(secret) values (encode(extensions.gen_random_bytes(32), 'hex'));
revoke all on project_private.commit_key from public, anon, authenticated;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED')),
  visibility text not null default 'PRIVATE' check (visibility in ('PRIVATE','PUBLIC')),
  current_revision_id uuid,
  revision_count integer not null default 0 check (revision_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check ((status = 'ARCHIVED') = (archived_at is not null)),
  check ((current_revision_id is null) = (revision_count = 0))
);
create table public.project_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  parent_revision_id uuid,
  model_json jsonb not null,
  schema_version integer not null default 2 check (schema_version = 2),
  completeness text not null default 'architectural' check (completeness = 'architectural'),
  source_mode text not null check (source_mode in ('generated','supplied')),
  generator_version text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  acceptance_qa_id uuid not null,
  unique (project_id, revision_number),
  unique (project_id, id),
  check ((revision_number = 1) = (parent_revision_id is null)),
  check ((jsonb_typeof(model_json) = 'object' and model_json->'schemaVersion' = '2'::jsonb
    and model_json->>'completeness' = 'architectural') is true),
  foreign key (project_id, parent_revision_id) references public.project_revisions(project_id, id)
);
create table public.project_revision_qa_runs (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.project_revisions(id) on delete cascade,
  qa_version text not null,
  model_schema_version integer not null check (model_schema_version = 2),
  rule_packs jsonb not null check (jsonb_typeof(rule_packs) = 'array'),
  status text not null check (status in ('PASS','PASS_WITH_WARNINGS','FAIL')),
  report_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (revision_id, id),
  check ((jsonb_typeof(report_json) = 'object' and report_json->>'qaVersion' = qa_version
    and report_json->'modelSchemaVersion' = to_jsonb(model_schema_version)
    and report_json->'rulePacks' = rule_packs and report_json->>'status' = status) is true)
);
alter table public.project_revisions add foreign key (id, acceptance_qa_id)
  references public.project_revision_qa_runs(revision_id, id) deferrable initially deferred;
alter table public.projects add foreign key (id, current_revision_id)
  references public.project_revisions(project_id, id) deferrable initially deferred;
create index projects_owner_updated_idx on public.projects(owner_id, updated_at desc, id desc);
create index projects_status_idx on public.projects(owner_id, status);
create index projects_current_revision_idx on public.projects(current_revision_id);
create index project_qa_revision_idx on public.project_revision_qa_runs(revision_id, created_at, id);
create index project_revision_parent_idx on public.project_revisions(parent_revision_id);

create table public.project_audit_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  revision_id uuid references public.project_revisions(id) on delete cascade,
  event_type text not null check (event_type in ('created','metadata_updated','revision_committed')),
  detail jsonb not null,
  created_at timestamptz not null default now()
);
create index project_audit_project_idx on public.project_audit_events(project_id, created_at);

alter table public.projects enable row level security;
alter table public.project_revisions enable row level security;
alter table public.project_revision_qa_runs enable row level security;
alter table public.project_audit_events enable row level security;
revoke all on public.projects, public.project_revisions, public.project_revision_qa_runs, public.project_audit_events from public, anon, authenticated;
grant select on public.projects, public.project_revisions, public.project_revision_qa_runs to authenticated;
grant all on public.projects, public.project_revisions, public.project_revision_qa_runs, public.project_audit_events to service_role;
create policy projects_owner_read on public.projects for select to authenticated using (owner_id = (select auth.uid()));
create policy revisions_owner_read on public.project_revisions for select to authenticated using (
  exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy qa_owner_read on public.project_revision_qa_runs for select to authenticated using (
  exists (select 1 from public.project_revisions r join public.projects p on p.id = r.project_id
    where r.id = revision_id and p.owner_id = (select auth.uid())));

create function project_private.immutable_revision() returns trigger language plpgsql set search_path = '' as $$
begin raise exception using errcode = '23514', message = 'Architectural history is immutable'; end;
$$;
create trigger revision_immutable before update on public.project_revisions for each row execute function project_private.immutable_revision();
create trigger qa_immutable before update on public.project_revision_qa_runs for each row execute function project_private.immutable_revision();

-- A deferred integrity check also protects administrative inserts/pointer changes.
create function project_private.accepted_pointer() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.projects p left join public.project_revisions r on r.id = p.current_revision_id
    left join public.project_revision_qa_runs q on q.id = r.acceptance_qa_id
    where p.id = new.id and p.current_revision_id is not null and
      (r.id is null or r.project_id <> p.id or r.revision_number <> p.revision_count or q.status not in ('PASS','PASS_WITH_WARNINGS') or q.id is null)) then
    raise exception using errcode = '23514', message = 'Current revision requires accepted QA';
  end if;
  return null;
end;
$$;
create constraint trigger projects_accepted_pointer after insert or update on public.projects
  deferrable initially deferred for each row execute function project_private.accepted_pointer();

-- DTO projections are intentionally independent of table row shapes.
create function project_private.qa_summary(q public.project_revision_qa_runs) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('id',q.id,'qaVersion',q.qa_version,'modelSchemaVersion',q.model_schema_version,
  'rulePacks',q.rule_packs,'status',q.status,'summary',q.report_json->'summary','createdAt',q.created_at)
$$;
create function project_private.revision_summary(r public.project_revisions) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('id',r.id,'projectId',r.project_id,'revisionNumber',r.revision_number,
  'parentRevisionId',r.parent_revision_id,'schemaVersion',r.schema_version,'completeness',r.completeness,
  'sourceMode',r.source_mode,'generatorVersion',r.generator_version,'createdAt',r.created_at,
  'qa',project_private.qa_summary(q)) from public.project_revision_qa_runs q where q.id = r.acceptance_qa_id
$$;
create function project_private.revision_detail(r public.project_revisions) returns jsonb language sql stable set search_path = '' as $$
 select project_private.revision_summary(r) || jsonb_build_object('model',r.model_json,'qaRuns',
  (select jsonb_agg(project_private.qa_summary(q) || jsonb_build_object('report',q.report_json) order by q.created_at,q.id)
   from public.project_revision_qa_runs q where q.revision_id = r.id))
$$;
create function project_private.project_summary(p public.projects) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('id',p.id,'title',p.title,'status',p.status,'visibility',p.visibility,
  'currentRevisionId',p.current_revision_id,'currentRevisionNumber',nullif(p.revision_count,0),
  'qaStatus',(select q.status from public.project_revisions r join public.project_revision_qa_runs q on q.id = r.acceptance_qa_id where r.id = p.current_revision_id),
  'createdAt',p.created_at,'updatedAt',p.updated_at,'archivedAt',p.archived_at)
$$;
create function project_private.project_detail(p public.projects) returns jsonb language sql stable set search_path = '' as $$
 select project_private.project_summary(p) || jsonb_build_object('currentRevision',
  (select project_private.revision_detail(r) from public.project_revisions r where r.id = p.current_revision_id))
$$;

-- Add operations to the existing durable receipts. No second receipt store.
alter table public.idempotency_records drop constraint idempotency_records_operation_check;
alter table public.idempotency_records add check (operation in (
 '/api/plans','/api/plans/generate','/api/estimates','/api/projects',
 '/api/projects/:projectId/revisions','/api/projects/:projectId/revisions/generate'));
-- Project receipts must not be forged via direct SDK writes. Preserve V1 rights.
alter policy idempotency_insert_own on public.idempotency_records with check (
 user_id = (select auth.uid()) and operation in ('/api/plans','/api/plans/generate','/api/estimates'));
alter policy idempotency_delete_own on public.idempotency_records using (
 user_id = (select auth.uid()) and operation in ('/api/plans','/api/plans/generate','/api/estimates'));

create function public.project_write(p_action text, p_input jsonb, p_context jsonb default null,
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
     insert into public.project_revisions(id,project_id,revision_number,parent_revision_id,model_json,source_mode,generator_version,created_by,acceptance_qa_id)
       values(revision_id,p.id,p.revision_count+1,p.current_revision_id,p_input->'model',p_input->>'sourceMode',p_input->>'generatorVersion',uid,qa_id) returning * into r;
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
revoke all on function public.project_write(text,jsonb,jsonb,text,text) from public, anon;
grant execute on function public.project_write(text,jsonb,jsonb,text,text) to authenticated;

create function public.project_read(p_action text, p_project_id uuid default null, p_revision_id uuid default null,
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
revoke all on function public.project_read(text,uuid,uuid,integer,jsonb) from public;
grant execute on function public.project_read(text,uuid,uuid,integer,jsonb) to anon, authenticated;
revoke all on all functions in schema project_private from public, anon, authenticated;
