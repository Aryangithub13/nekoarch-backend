-- Phase 33: user settings, project library metadata, versioned project briefs, account quotas and the context bundle.
-- Additive only: no historical table, constraint, row or function is modified except the idempotency operation whitelist
-- (re-created as a superset). Quotas are new triggers on existing tables; nothing here changes a revision or an engine input.
create table public.user_settings (
 user_id uuid primary key,
 version integer not null check (version >= 1),
 settings_json jsonb not null check ((jsonb_typeof(settings_json) = 'object'
   and settings_json->>'units' in ('METRIC','IMPERIAL') and settings_json->>'locale' in ('en','en-IN','hi','hi-IN','hi-Latn')
   and settings_json->>'currency' = 'INR'
   and (settings_json->'defaultRegion' = 'null'::jsonb or char_length(settings_json->>'defaultRegion') between 1 and 100)
   and (settings_json->'defaultBuildingType' = 'null'::jsonb or settings_json->>'defaultBuildingType' in ('residential','commercial','institutional'))
   and settings_json ?& array['units','locale','currency','defaultRegion','defaultBuildingType']
   and settings_json - array['units','locale','currency','defaultRegion','defaultBuildingType'] = '{}'::jsonb) is true),
 updated_at timestamptz not null default clock_timestamp()
);
create table public.project_library (
 project_id uuid primary key references public.projects(id) on delete cascade,
 owner_id uuid not null,
 starred boolean not null default false,
 tags text[] not null default '{}' check (cardinality(tags) <= 10 and array_to_string(tags, ',') ~ '^([a-z0-9][a-z0-9-]{0,31}(,|$))*$'),
 updated_at timestamptz not null default clock_timestamp()
);
create index project_library_owner_idx on public.project_library(owner_id);
create table public.project_briefs (
 project_id uuid not null references public.projects(id) on delete cascade,
 version integer not null check (version >= 1),
 brief_json jsonb not null check (jsonb_typeof(brief_json) = 'object' and octet_length(brief_json::text) <= 32768),
 brief_hash text not null check (brief_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key (project_id, version)
);
alter table public.user_settings enable row level security;
alter table public.project_library enable row level security;
alter table public.project_briefs enable row level security;
revoke all on public.user_settings, public.project_library, public.project_briefs from public, anon, authenticated, service_role;
grant select on public.user_settings, public.project_library, public.project_briefs to authenticated, service_role;
create policy user_settings_self_read on public.user_settings for select to authenticated using (user_id = (select auth.uid()));
create policy project_library_owner_read on public.project_library for select to authenticated using (owner_id = (select auth.uid()));
create policy project_briefs_owner_read on public.project_briefs for select to authenticated using (
 exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
-- Brief versions are immutable evidence of what the owner stated at that time.
create trigger project_brief_immutable before update or delete on public.project_briefs for each row execute function project_private.immutable_revision();

-- Account quotas (design §4): enforced on the base tables, so no RPC path can bypass them.
create function project_private.account_project_quota() returns trigger language plpgsql set search_path = '' as $$
begin
 if (select count(*) from public.projects where owner_id = new.owner_id) >= 200 then
   raise exception using errcode = 'P3304', message = 'Account project quota reached'; end if;
 return new;
end;
$$;
create trigger account_project_quota before insert on public.projects for each row execute function project_private.account_project_quota();
create function project_private.account_reference_quota() returns trigger language plpgsql set search_path = '' as $$
begin
 if (select coalesce(sum(r.stored_bytes), 0) from public.project_references r join public.projects p on p.id = r.project_id
     where p.owner_id = (select owner_id from public.projects where id = new.project_id) and r.status <> 'DELETED') + new.stored_bytes > 1073741824 then
   raise exception using errcode = 'P3304', message = 'Account reference storage quota reached'; end if;
 return new;
end;
$$;
create trigger account_reference_quota before insert on public.project_references for each row execute function project_private.account_reference_quota();
create function project_private.account_job_quota() returns trigger language plpgsql set search_path = '' as $$
begin
 if (select count(*) from public.project_jobs where owner_id = new.owner_id and status in ('QUEUED','RUNNING')) >= 8 then
   raise exception using errcode = 'P3304', message = 'Account active job quota reached'; end if;
 return new;
end;
$$;
create trigger account_job_quota before insert on public.project_jobs for each row execute function project_private.account_job_quota();

create function project_private.brief_version_json(b public.project_briefs) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('projectId',b.project_id,'version',b.version,'brief',b.brief_json,'briefHash',b.brief_hash,'createdBy',b.created_by,'createdAt',b.created_at,
   'provenance',jsonb_build_object('source','USER_STATED','verified',false),
   'claims',jsonb_build_object('siteVerified','NOT_CLAIMED','budgetVerified','NOT_CLAIMED','codeCompliance','NOT_CLAIMED','ownershipVerified','NOT_CLAIMED'))
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
 '/api/projects/:projectId/revisions/:revisionId/optimization/studies',
 '/api/projects/:projectId/revisions/:revisionId/scene/artifacts',
 '/api/projects/:projectId/revision-operations',
 '/api/projects/:projectId/revision-operations/:operationId/execute',
 '/api/projects/:projectId/revision-operations/:operationId/approve',
 '/api/projects/:projectId/revision-operations/:operationId/reject',
 '/api/projects/:projectId/revision-operations/:operationId/cancel',
 '/api/projects/:projectId/references',
 '/api/projects/:projectId/references/:referenceId',
 '/api/projects/:projectId/jobs',
 '/api/projects/:projectId/brief/versions'));

-- Shared envelope check (same contract as every signed write since Phase 14): user, operation label, exact input, context, 10-minute window.
create function project_private.verify_envelope(p_operation text,p_input jsonb,p_context jsonb,p_envelope text,p_signature text) returns void
language plpgsql stable set search_path = '' as $$
declare secret text; envelope jsonb;
begin
 select k.secret into secret from project_private.commit_key k where singleton;
 if p_envelope is null or p_signature is null or
 p_signature <> encode(extensions.hmac(convert_to(p_envelope,'UTF8'),decode(secret,'hex'),'sha256'),'hex') then raise insufficient_privilege; end if;
 envelope := p_envelope::jsonb;
 if (envelope->>'userId'=auth.uid()::text and envelope->>'operation'=p_operation and envelope->'input'=p_input
 and envelope->'context'=coalesce(p_context,'null'::jsonb)
 and (envelope->>'expiresAt')::bigint between extract(epoch from clock_timestamp())::bigint and extract(epoch from clock_timestamp())::bigint+600) is not true then raise insufficient_privilege; end if;
end;
$$;

create function public.account_read(p_action text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); s public.user_settings;
begin
 if uid is null then raise insufficient_privilege; end if;
 if p_action = 'settings' then
   select * into s from public.user_settings where user_id = uid;
   if not found then return jsonb_build_object('version',0,'settings',null,'updatedAt',null); end if;
   return jsonb_build_object('version',s.version,'settings',s.settings_json,'updatedAt',s.updated_at);
 elsif p_action = 'usage' then
   return jsonb_build_object(
     'projects',jsonb_build_object('active',(select count(*) from public.projects where owner_id=uid and status='ACTIVE'),
       'archived',(select count(*) from public.projects where owner_id=uid and status='ARCHIVED')),
     'revisions',(select count(*) from public.project_revisions r join public.projects p on p.id=r.project_id where p.owner_id=uid),
     'references',jsonb_build_object('count',(select count(*) from public.project_references r join public.projects p on p.id=r.project_id where p.owner_id=uid and r.status<>'DELETED'),
       'storedBytes',(select coalesce(sum(r.stored_bytes),0) from public.project_references r join public.projects p on p.id=r.project_id where p.owner_id=uid and r.status<>'DELETED')),
     'jobs',jsonb_build_object('active',(select count(*) from public.project_jobs where owner_id=uid and status in ('QUEUED','RUNNING')),
       'submittedLast24h',(select count(*) from public.project_jobs where owner_id=uid and created_at > clock_timestamp() - interval '24 hours')));
 end if;
 raise invalid_parameter_value;
end;
$$;

create function public.account_write(p_action text,p_input jsonb,p_envelope text default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare uid uuid := auth.uid(); s public.user_settings; current_version integer;
begin
 if uid is null then raise insufficient_privilege; end if;
 if p_action <> 'settings' or p_input->>'action' is distinct from p_action then raise invalid_parameter_value; end if;
 perform project_private.verify_envelope('/api/me/settings', p_input, null, p_envelope, p_signature);
 -- Serialize concurrent writers of one user's settings, including the very first insert.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('settings:' || uid::text, 0));
 select * into s from public.user_settings where user_id = uid;
 current_version := coalesce(s.version, 0);
 if (p_input->>'expectedVersion')::integer is distinct from current_version then
   raise exception using errcode='P3301',message='Settings were changed elsewhere; reload and retry'; end if;
 insert into public.user_settings(user_id, version, settings_json) values (uid, current_version + 1, p_input->'settings')
 on conflict (user_id) do update set version = excluded.version, settings_json = excluded.settings_json, updated_at = clock_timestamp()
 returning * into s;
 return jsonb_build_object('version',s.version,'settings',s.settings_json,'updatedAt',s.updated_at);
end;
$$;

create function public.library_search(p_query jsonb) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); q text := nullif(p_query->>'q',''); pattern text; sort text := coalesce(p_query->>'sort','updated');
 -- A JSON null cursor is "no cursor" (jsonb 'null' is not SQL NULL).
 lim integer := coalesce((p_query->>'limit')::integer, 20); c jsonb := nullif(p_query->'cursor', 'null'::jsonb); items jsonb; next_cursor jsonb; total integer;
begin
 if uid is null then raise insufficient_privilege; end if;
 if lim < 1 or lim > 50 or char_length(coalesce(q,'')) > 100 or sort not in ('updated','created','title') or (c is not null and c->>'sort' is distinct from sort) then
   raise invalid_parameter_value; end if;
 -- LIKE metacharacters in the user text are escaped: the query is a literal substring, never a pattern.
 pattern := '%' || replace(replace(replace(coalesce(q,''),'\','\\'),'%','\%'),'_','\_') || '%';
 with filtered as (
   select p.id, coalesce(l.starred,false) starred, coalesce(l.tags,'{}') tags,
     case sort when 'title' then lower(p.title) when 'created' then to_char(p.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')
       else to_char(p.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US') end sort_key
   from public.projects p left join public.project_library l on l.project_id = p.id
   where p.owner_id = uid
     and (p_query->>'status' = 'ALL' or p.status = coalesce(p_query->>'status','ACTIVE'))
     and (p_query->>'visibility' is null or p.visibility = p_query->>'visibility')
     and (p_query->>'starred' is null or coalesce(l.starred,false) = (p_query->>'starred')::boolean)
     and (p_query->>'tag' is null or p_query->>'tag' = any(coalesce(l.tags,'{}')))
     and (q is null or p.title ilike pattern escape '\' or lower(q) = any(coalesce(l.tags,'{}')))),
 ordered as (
   select f.*, row_number() over (order by case when sort='title' then f.sort_key end asc, case when sort='title' then f.id end asc,
     case when sort<>'title' then f.sort_key end desc, case when sort<>'title' then f.id end desc) ord
   from filtered f
   where c is null or (sort = 'title' and (f.sort_key, f.id) > (c->>'key', (c->>'id')::uuid))
     or (sort <> 'title' and (f.sort_key, f.id) < (c->>'key', (c->>'id')::uuid))),
 page as (select * from ordered where ord <= lim + 1)
 select (select count(*) from page),
   (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'status',p.status,'visibility',p.visibility,'currentRevisionId',p.current_revision_id,
     'revisionCount',p.revision_count,'createdAt',p.created_at,'updatedAt',p.updated_at,'archivedAt',p.archived_at,'starred',pg.starred,'tags',to_jsonb(pg.tags),
     'referenceCount',(select count(*) from public.project_references r where r.project_id=p.id and r.status<>'DELETED'),
     'briefVersion',coalesce((select max(b.version) from public.project_briefs b where b.project_id=p.id),0)) order by pg.ord), '[]'::jsonb)
     from page pg join public.projects p on p.id = pg.id where pg.ord <= lim),
   (select jsonb_build_object('sort', sort, 'key', pg.sort_key, 'id', pg.id) from page pg where pg.ord = lim)
 into total, items, next_cursor;
 return jsonb_build_object('items', items, 'nextCursor', case when total > lim then next_cursor end);
end;
$$;

create function public.library_write(p_action text,p_input jsonb,p_envelope text default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare uid uuid := auth.uid(); p public.projects; l public.project_library;
begin
 if uid is null then raise insufficient_privilege; end if;
 if p_action <> 'update' or p_input->>'action' is distinct from p_action then raise invalid_parameter_value; end if;
 perform project_private.verify_envelope('/api/projects/:projectId/library', p_input, null, p_envelope, p_signature);
 select * into p from public.projects where id=(p_input->>'projectId')::uuid and owner_id=uid for update;
 if not found then raise exception using errcode='P1201',message='Project not found'; end if;
 insert into public.project_library(project_id, owner_id, starred, tags)
 values (p.id, uid, coalesce((p_input->>'starred')::boolean, false),
   coalesce((select array_agg(t order by t) from jsonb_array_elements_text(p_input->'tags') t), '{}'))
 on conflict (project_id) do update set
   starred = coalesce((p_input->>'starred')::boolean, public.project_library.starred),
   tags = case when p_input ? 'tags' then coalesce((select array_agg(t order by t) from jsonb_array_elements_text(p_input->'tags') t), '{}') else public.project_library.tags end,
   updated_at = clock_timestamp()
 returning * into l;
 return jsonb_build_object('projectId',l.project_id,'starred',l.starred,'tags',to_jsonb(l.tags),'updatedAt',l.updated_at);
end;
$$;

create function public.brief_read(p_action text,p_project_id uuid,p_version integer default null,p_limit integer default 20,p_cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b public.project_briefs; items jsonb; total integer; next_cursor jsonb;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if not exists (select 1 from public.projects where id=p_project_id and owner_id=auth.uid()) then raise exception using errcode='P1201',message='Project not found'; end if;
 if p_action = 'current' then
   select * into b from public.project_briefs where project_id=p_project_id order by version desc limit 1;
   return jsonb_build_object('projectId',p_project_id,'version',coalesce(b.version,0),'current',case when b.version is null then null else project_private.brief_version_json(b) end);
 elsif p_action = 'version' then
   select * into b from public.project_briefs where project_id=p_project_id and version=p_version;
   if not found then raise exception using errcode='P3303',message='Brief version not found'; end if;
   return project_private.brief_version_json(b);
 elsif p_action = 'list' then
   if p_limit is null or p_limit<1 or p_limit>100 then raise invalid_parameter_value; end if;
   with page as (select * from public.project_briefs where project_id=p_project_id
     and (p_cursor is null or version < (p_cursor->>'version')::integer) order by version desc limit p_limit+1),
   shown as (select * from page order by version desc limit p_limit)
   select (select count(*) from page), coalesce(jsonb_agg(jsonb_build_object('version',version,'briefHash',brief_hash,'createdBy',created_by,'createdAt',created_at) order by version desc),'[]'::jsonb),
     (select jsonb_build_object('version',min(version)) from shown) into total, items, next_cursor from shown;
   return jsonb_build_object('projectId',p_project_id,'items',items,'nextCursor',case when total>p_limit then next_cursor else null end);
 end if;
 raise invalid_parameter_value;
end;
$$;

create function public.brief_write(p_action text,p_input jsonb,p_context jsonb default null,p_envelope text default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare uid uuid := auth.uid(); op text := '/api/projects/:projectId/brief/versions'; p public.projects; b public.project_briefs; receipt public.idempotency_records;
 current_version integer; result jsonb; bad uuid;
begin
 if uid is null then raise insufficient_privilege; end if;
 if p_action <> 'create' or p_input->>'action' is distinct from p_action then raise invalid_parameter_value; end if;
 perform project_private.verify_envelope(op, p_input, p_context, p_envelope, p_signature);
 select * into p from public.projects where id=(p_input->>'projectId')::uuid and owner_id=uid for update;
 if not found then raise exception using errcode='P1201',message='Project not found'; end if;
 if p_context is not null then
   if (p_context->>'operation'=op and p_context->>'keyHash' ~ '^[a-f0-9]{64}$' and p_context->>'fingerprint' ~ '^[a-f0-9]{64}$') is not true then raise invalid_parameter_value; end if;
   select * into receipt from public.idempotency_records where user_id=uid and operation=op and key_hash=p_context->>'keyHash';
   if found and receipt.expires_at>now() then
     if receipt.fingerprint<>p_context->>'fingerprint' then raise exception using errcode='P8001',message='Idempotency conflict'; end if;
     return receipt.response;
   end if;
   delete from public.idempotency_records where user_id=uid and operation=op and key_hash=p_context->>'keyHash';
 end if;
 select coalesce(max(version),0) into current_version from public.project_briefs where project_id=p.id;
 if (p_input->>'expectedVersion')::integer is distinct from current_version then
   raise exception using errcode='P3301',message='The brief was changed elsewhere; reload and retry'; end if;
 -- Every linked reference must be a live reference of this project.
 select x::uuid into bad from jsonb_array_elements_text(coalesce(p_input->'brief'->'referenceIds','[]'::jsonb)) x
 where not exists (select 1 from public.project_references r where r.id = x::uuid and r.project_id = p.id and r.status <> 'DELETED') limit 1;
 if bad is not null then raise exception using errcode='P3302',message='A linked reference is not a live reference of this project'; end if;
 insert into public.project_briefs(project_id, version, brief_json, brief_hash, created_by)
 values (p.id, current_version + 1, p_input->'brief', project_private.cost_hash(p_input->'brief'), uid) returning * into b;
 result := project_private.brief_version_json(b);
 if p_context is not null then
   insert into public.idempotency_records(user_id,operation,key_hash,fingerprint,response) values(uid,op,p_context->>'keyHash',p_context->>'fingerprint',result);
 end if;
 return result;
end;
$$;

-- One statement, one snapshot: every part of the bundle is mutually consistent (design §5).
create function public.context_read(p_project_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); p public.projects; l public.project_library; s public.user_settings; b public.project_briefs; r public.project_revisions; q public.project_revision_qa_runs;
 linked jsonb;
begin
 if uid is null then raise insufficient_privilege; end if;
 select * into p from public.projects where id=p_project_id and owner_id=uid;
 if not found then raise exception using errcode='P1201',message='Project not found'; end if;
 select * into l from public.project_library where project_id=p.id;
 select * into s from public.user_settings where user_id=uid;
 select * into b from public.project_briefs where project_id=p.id order by version desc limit 1;
 linked := coalesce(b.brief_json->'referenceIds','[]'::jsonb);
 if p.current_revision_id is not null then
   select * into r from public.project_revisions where id=p.current_revision_id;
   select * into q from public.project_revision_qa_runs where id=r.acceptance_qa_id and revision_id=r.id;
 end if;
 return jsonb_build_object(
   'project',jsonb_build_object('id',p.id,'title',p.title,'status',p.status,'visibility',p.visibility,'revisionCount',p.revision_count,'updatedAt',p.updated_at,
     'starred',coalesce(l.starred,false),'tags',to_jsonb(coalesce(l.tags,'{}'))),
   'settings',case when s.user_id is null then null else jsonb_build_object('version',s.version,'settings',s.settings_json) end,
   'brief',case when b.version is null then null else project_private.brief_version_json(b) end,
   'references',coalesce((select jsonb_agg(x.item order by x.created_at desc, x.id desc) from (
     select jsonb_build_object('id',ref.id,'purpose',ref.purpose,'displayName',ref.display_name,'mediaType',ref.media_type,'storedSha256',ref.stored_sha256,
       'boundRevisionId',ref.bound_revision_id,
       'currency',case when ref.bound_revision_id is null then 'PROJECT_SCOPED' when ref.bound_revision_id = p.current_revision_id then 'CURRENT' else 'STALE' end,
       'linkedFromBrief',linked ? ref.id::text) item, ref.created_at, ref.id
     from public.project_references ref where ref.project_id=p.id and (ref.status='ACTIVE' or (ref.status='ARCHIVED' and linked ? ref.id::text))
     order by ref.created_at desc, ref.id desc limit 50) x),'[]'::jsonb),
   'currentRevision',case when r.id is null then null else jsonb_build_object('id',r.id,'revisionNumber',r.revision_number,'qaStatus',q.status,
     'modelHash',project_private.cost_hash(jsonb_build_object('identityVersion','generation-freshness-v1','model',project_private.canonical_building(r.model_json))),
     'createdAt',r.created_at) end,
   'activeJobs',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'kind',j.kind,'status',j.status,'createdAt',j.created_at) order by j.created_at, j.id)
     from public.project_jobs j where j.project_id=p.id and j.status in ('QUEUED','RUNNING')),'[]'::jsonb));
end;
$$;
revoke all on function public.account_read(text),public.account_write(text,jsonb,text,text),public.library_search(jsonb),public.library_write(text,jsonb,text,text),
 public.brief_read(text,uuid,integer,integer,jsonb),public.brief_write(text,jsonb,jsonb,text,text),public.context_read(uuid) from public,anon;
grant execute on function public.account_read(text),public.account_write(text,jsonb,text,text),public.library_search(jsonb),public.library_write(text,jsonb,text,text),
 public.brief_read(text,uuid,integer,integer,jsonb),public.brief_write(text,jsonb,jsonb,text,text),public.context_read(uuid) to authenticated;
revoke all on all functions in schema project_private from public,anon,authenticated;
