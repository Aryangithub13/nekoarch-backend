-- Phase 32: durable generation jobs — persistent queue, progress events, bounded retries, cancellation, lease-based recovery.
-- Additive only: no historical table, constraint, row or function is modified except the idempotency operation whitelist,
-- which is re-created as a superset. Jobs run the existing Phase 28–30 operations; they never write those artifacts themselves.
create table public.project_jobs (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 owner_id uuid not null,
 kind text not null check (kind in ('SCENE_COMPILE','OPTIMIZATION_STUDY','REVISION_EXECUTE')),
 status text not null check (status in ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
 job_version text not null check (job_version = 'durable-job-v1'),
 request_json jsonb not null check (request_json->>'kind' = kind and octet_length(request_json::text) <= 65536),
 input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
 attempt integer not null default 0 check (attempt between 0 and 3),
 max_attempts integer not null default 3 check (max_attempts = 3),
 user_retries integer not null default 0 check (user_retries between 0 and 3),
 not_before timestamptz not null default clock_timestamp(),
 lease_token uuid,
 lease_expires_at timestamptz,
 cancel_requested boolean not null default false,
 progress_json jsonb not null check (jsonb_typeof(progress_json) = 'object' and (progress_json->>'percent')::integer between 0 and 100),
 result_json jsonb check (result_json is null or octet_length(result_json::text) <= 2048),
 failure_json jsonb check (failure_json is null or octet_length(failure_json::text) <= 2048),
 last_failure_json jsonb check (last_failure_json is null or octet_length(last_failure_json::text) <= 2048),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 check ((status = 'SUCCEEDED') = (result_json is not null)),
 check ((status = 'FAILED') = (failure_json is not null)),
 check ((status = 'RUNNING') = (lease_token is not null and lease_expires_at is not null)),
 check ((status in ('SUCCEEDED','FAILED','CANCELLED')) = (finished_at is not null))
);
-- An identical job (same project, kind and canonical request) is active at most once.
create unique index project_jobs_active_input_idx on public.project_jobs(project_id, kind, input_hash) where status in ('QUEUED','RUNNING');
create index project_jobs_project_created_idx on public.project_jobs(project_id, created_at desc, id desc);
create index project_jobs_running_lease_idx on public.project_jobs(project_id, lease_expires_at) where status = 'RUNNING';
create table public.project_job_events (
 job_id uuid not null references public.project_jobs(id) on delete cascade,
 seq integer not null check (seq > 0),
 project_id uuid not null references public.projects(id) on delete cascade,
 actor uuid,
 event_type text not null check (event_type in ('SUBMITTED','DEDUPLICATED','STARTED','PROGRESS','CANCEL_REQUESTED','REQUEUED','LEASE_EXPIRED','SUCCEEDED',
   'FAILED','CANCELLED','RETRIED','RELEASED')),
 detail jsonb not null check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 4096),
 created_at timestamptz not null default clock_timestamp(),
 primary key (job_id, seq)
);
create index project_job_events_submitted_idx on public.project_job_events(project_id, created_at) where event_type = 'SUBMITTED';

alter table public.project_jobs enable row level security;
alter table public.project_job_events enable row level security;
revoke all on public.project_jobs, public.project_job_events from public, anon, authenticated, service_role;
grant select on public.project_jobs, public.project_job_events to authenticated, service_role;
create policy jobs_owner_read on public.project_jobs for select to authenticated using (
 exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy job_events_owner_read on public.project_job_events for select to authenticated using (
 exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));

-- Design §4 lives here: identity never changes, terminal rows are immutable, only the listed transitions exist.
create function project_private.job_guard() returns trigger language plpgsql set search_path = '' as $$
begin
 if tg_op = 'DELETE' then raise exception using errcode = '23514', message = 'Jobs are retained'; end if;
 if (new.id, new.project_id, new.owner_id, new.kind, new.job_version, new.request_json, new.input_hash, new.max_attempts, new.created_at)
   is distinct from (old.id, old.project_id, old.owner_id, old.kind, old.job_version, old.request_json, old.input_hash, old.max_attempts, old.created_at) then
   raise exception using errcode = '23514', message = 'Job identity is immutable'; end if;
 if not ((old.status = 'QUEUED' and new.status in ('QUEUED','RUNNING','CANCELLED'))
   or (old.status = 'RUNNING' and new.status in ('RUNNING','QUEUED','SUCCEEDED','FAILED','CANCELLED'))
   or (old.status = 'FAILED' and new.status = 'QUEUED' and new.user_retries = old.user_retries + 1)) then
   raise exception using errcode = 'P3202', message = 'Invalid job transition'; end if;
 new.updated_at := clock_timestamp();
 return new;
end;
$$;
create trigger job_guard before update or delete on public.project_jobs for each row execute function project_private.job_guard();
create trigger job_event_immutable before update or delete on public.project_job_events for each row execute function project_private.immutable_revision();

-- Callers hold the job row lock, so seq is gap-free and strictly increasing per job.
create function project_private.job_event(j public.project_jobs, actor uuid, event_type text, detail jsonb) returns void language sql set search_path = '' as $$
 insert into public.project_job_events(job_id, seq, project_id, actor, event_type, detail)
 values (j.id, coalesce((select max(seq) from public.project_job_events where job_id = j.id), 0) + 1, j.project_id, actor, event_type, detail)
$$;
create function project_private.job_progress(stage text, percent integer, message text) returns jsonb language sql immutable set search_path = '' as $$
 select jsonb_build_object('stage', stage, 'percent', percent, 'message', message)
$$;
create function project_private.job_summary(j public.project_jobs) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('id',j.id,'projectId',j.project_id,'ownerId',j.owner_id,'kind',j.kind,'status',j.status,'jobVersion',j.job_version,'inputHash',j.input_hash,
 'attempt',j.attempt,'maxAttempts',j.max_attempts,'userRetries',j.user_retries,'notBefore',j.not_before,'leaseExpiresAt',j.lease_expires_at,
 'cancelRequested',j.cancel_requested,'progress',j.progress_json,'result',j.result_json,'failure',j.failure_json,'lastFailure',j.last_failure_json,
 'createdAt',j.created_at,'updatedAt',j.updated_at,'finishedAt',j.finished_at)
$$;
create function project_private.job_detail(j public.project_jobs) returns jsonb language sql stable set search_path = '' as $$
 select project_private.job_summary(j) || jsonb_build_object('request', j.request_json)
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
 '/api/projects/:projectId/jobs'));

create function public.job_write(p_action text,p_input jsonb,p_context jsonb default null,p_envelope text default null,p_signature text default null)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
 uid uuid := auth.uid(); root text := '/api/projects/:projectId/jobs'; op text; secret text; envelope jsonb; receipt public.idempotency_records;
 p public.projects; j public.project_jobs; result jsonb; due jsonb; n integer := 0; f jsonb; backoff integer;
begin
 if uid is null then raise insufficient_privilege; end if;
 op := case when p_action = 'submit' then root when p_action = 'cancel' then root || '/:jobId/cancel' when p_action = 'retry' then root || '/:jobId/retry'
   when p_action = 'recover' then 'job-recover' when p_action in ('start','progress','heartbeat','complete','fail','cancelled','release') then 'job-runner' end;
 if op is null or p_input->>'action' is distinct from p_action then raise invalid_parameter_value; end if;
 select k.secret into secret from project_private.commit_key k where singleton;
 if p_envelope is null or p_signature is null or
 p_signature <> encode(extensions.hmac(convert_to(p_envelope,'UTF8'),decode(secret,'hex'),'sha256'),'hex') then raise insufficient_privilege; end if;
 envelope := p_envelope::jsonb;
 if (envelope->>'userId'=uid::text and envelope->>'operation'=op and envelope->'input'=p_input
 and envelope->'context'=coalesce(p_context,'null'::jsonb)
 and (envelope->>'expiresAt')::bigint between extract(epoch from clock_timestamp())::bigint and extract(epoch from clock_timestamp())::bigint+600) is not true then raise insufficient_privilege; end if;
 -- Only the owner acts on a project's jobs; the project row lock serializes limits and dedupe.
 select * into p from public.projects where id=(p_input->>'projectId')::uuid and owner_id=uid for update;
 if not found then raise exception using errcode='P1201',message='Project not found'; end if;
 if p_context is not null then
   if (p_action='submit' and p_context->>'operation'=op and p_context->>'keyHash' ~ '^[a-f0-9]{64}$' and p_context->>'fingerprint' ~ '^[a-f0-9]{64}$') is not true then
     raise invalid_parameter_value; end if;
   select * into receipt from public.idempotency_records where user_id=uid and operation=op and key_hash=p_context->>'keyHash';
   if found and receipt.expires_at>now() then
     if receipt.fingerprint<>p_context->>'fingerprint' then raise exception using errcode='P8001',message='Idempotency conflict'; end if;
     return receipt.response;
   end if;
   delete from public.idempotency_records where user_id=uid and operation=op and key_hash=p_context->>'keyHash';
 end if;

 if p_action = 'submit' then
   if (p_input->'request'->>'kind' = p_input->>'kind' and p_input->>'inputHash' ~ '^[a-f0-9]{64}$') is not true then raise invalid_parameter_value; end if;
   select * into j from public.project_jobs where project_id=p.id and kind=p_input->>'kind' and input_hash=p_input->>'inputHash' and status in ('QUEUED','RUNNING');
   if found then
     perform project_private.job_event(j, uid, 'DEDUPLICATED', '{}'::jsonb);
     result := project_private.job_detail(j) || jsonb_build_object('deduplicated', true);
   else
     if (select count(*) from public.project_jobs where project_id=p.id and status in ('QUEUED','RUNNING')) >= 4
       or (select count(*) from public.project_job_events where project_id=p.id and event_type='SUBMITTED' and created_at > clock_timestamp() - interval '1 hour') >= 120 then
       raise exception using errcode='P3204',message='Project job limit reached'; end if;
     insert into public.project_jobs(project_id,owner_id,kind,status,job_version,request_json,input_hash,progress_json)
     values(p.id,uid,p_input->>'kind','QUEUED','durable-job-v1',p_input->'request',p_input->>'inputHash',project_private.job_progress('QUEUED',0,'Queued'))
     returning * into j;
     perform project_private.job_event(j, uid, 'SUBMITTED', jsonb_build_object('kind', j.kind));
     result := project_private.job_detail(j) || jsonb_build_object('deduplicated', false);
   end if;
 elsif p_action = 'recover' then
   -- A RUNNING job whose lease expired lost its process: requeue it while attempts remain, otherwise fail it as interrupted.
   for j in select * from public.project_jobs where project_id=p.id and status='RUNNING' and lease_expires_at < clock_timestamp() for update loop
     f := jsonb_build_object('code','JOB_INTERRUPTED','message','The job lost its worker before finishing','retryable',true,'attempt',j.attempt);
     perform project_private.job_event(j, uid, 'LEASE_EXPIRED', jsonb_build_object('attempt', j.attempt));
     if j.attempt < j.max_attempts then
       update public.project_jobs set status='QUEUED', lease_token=null, lease_expires_at=null, not_before=clock_timestamp(), last_failure_json=f,
         progress_json=project_private.job_progress('QUEUED',0,'Requeued after interruption') where id=j.id returning * into j;
       perform project_private.job_event(j, uid, 'REQUEUED', jsonb_build_object('reason','JOB_INTERRUPTED'));
     else
       update public.project_jobs set status='FAILED', lease_token=null, lease_expires_at=null, failure_json=f, finished_at=clock_timestamp() where id=j.id returning * into j;
       perform project_private.job_event(j, uid, 'FAILED', jsonb_build_object('code','JOB_INTERRUPTED'));
     end if;
     n := n + 1;
   end loop;
   select coalesce(jsonb_agg(x.id order by x.created_at), '[]'::jsonb) into due from (select id, created_at from public.project_jobs
     where project_id=p.id and status='QUEUED' and not_before <= clock_timestamp() order by created_at limit 4) x;
   return jsonb_build_object('recovered', n, 'due', due);
 else
   select * into j from public.project_jobs where id=(p_input->>'jobId')::uuid and project_id=p.id for update;
   if not found then raise exception using errcode='P3201',message='Job not found'; end if;
   if p_action = 'cancel' then
     if j.status = 'QUEUED' then
       perform project_private.job_event(j, uid, 'CANCEL_REQUESTED', '{}'::jsonb);
       update public.project_jobs set status='CANCELLED', cancel_requested=true, finished_at=clock_timestamp(),
         progress_json=project_private.job_progress('QUEUED',0,'Cancelled before start') where id=j.id returning * into j;
       perform project_private.job_event(j, uid, 'CANCELLED', jsonb_build_object('stage','QUEUED'));
     elsif j.status = 'RUNNING' and not j.cancel_requested then
       update public.project_jobs set cancel_requested=true where id=j.id returning * into j;
       perform project_private.job_event(j, uid, 'CANCEL_REQUESTED', '{}'::jsonb);
     elsif j.status <> 'RUNNING' then raise exception using errcode='P3202',message='The job has already finished'; end if;
   elsif p_action = 'retry' then
     if not (j.status = 'FAILED' and (j.failure_json->>'retryable')::boolean and j.user_retries < 3) then
       raise exception using errcode='P3205',message='The job cannot be retried'; end if;
     update public.project_jobs set status='QUEUED', attempt=0, user_retries=user_retries+1, last_failure_json=failure_json, failure_json=null, finished_at=null,
       not_before=clock_timestamp(), cancel_requested=false, progress_json=project_private.job_progress('QUEUED',0,'Queued for retry') where id=j.id returning * into j;
     perform project_private.job_event(j, uid, 'RETRIED', jsonb_build_object('userRetries', j.user_retries));
   elsif p_action = 'start' then
     -- Compare-and-set: one process wins; every later runner write must present this fresh lease token.
     if not (j.status = 'QUEUED' and j.not_before <= clock_timestamp() and j.attempt < j.max_attempts) then
       raise exception using errcode='P3202',message='The job is not startable'; end if;
     update public.project_jobs set status='RUNNING', attempt=attempt+1, lease_token=gen_random_uuid(), lease_expires_at=clock_timestamp() + interval '30 seconds',
       progress_json=project_private.job_progress('VALIDATING',10,'Validating the source') where id=j.id returning * into j;
     perform project_private.job_event(j, uid, 'STARTED', jsonb_build_object('attempt', j.attempt));
     return project_private.job_detail(j) || jsonb_build_object('leaseToken', j.lease_token);
   else
     if j.status <> 'RUNNING' or j.lease_token is distinct from (p_input->>'leaseToken')::uuid then
       raise exception using errcode='P3203',message='The job lease is no longer held'; end if;
     if p_action in ('progress','heartbeat') then
       update public.project_jobs set lease_expires_at=clock_timestamp() + interval '30 seconds',
         progress_json=case when p_action='progress' then project_private.job_progress(p_input->'progress'->>'stage',(p_input->'progress'->>'percent')::integer,
           p_input->'progress'->>'message') else progress_json end where id=j.id returning * into j;
       if p_action = 'progress' then perform project_private.job_event(j, uid, 'PROGRESS', jsonb_build_object('stage', p_input->'progress'->>'stage')); end if;
       return jsonb_build_object('cancelRequested', j.cancel_requested);
     elsif p_action = 'complete' then
       if jsonb_typeof(p_input->'result') <> 'object' or p_input->'result'->>'resultId' is null then raise invalid_parameter_value; end if;
       update public.project_jobs set status='SUCCEEDED', result_json=p_input->'result', lease_token=null, lease_expires_at=null, finished_at=clock_timestamp(),
         progress_json=project_private.job_progress('DONE',100,'Completed') where id=j.id returning * into j;
       perform project_private.job_event(j, uid, 'SUCCEEDED', jsonb_build_object('resultKind', j.result_json->>'resultKind', 'resultId', j.result_json->>'resultId'));
     elsif p_action = 'cancelled' then
       update public.project_jobs set status='CANCELLED', lease_token=null, lease_expires_at=null, finished_at=clock_timestamp(),
         progress_json=project_private.job_progress(progress_json->>'stage',(progress_json->>'percent')::integer,'Cancelled; no result was stored') where id=j.id returning * into j;
       perform project_private.job_event(j, uid, 'CANCELLED', jsonb_build_object('stage', j.progress_json->>'stage'));
     elsif p_action = 'release' then
       -- Graceful shutdown hands the attempt back: a restart is not the job's fault.
       update public.project_jobs set status='QUEUED', attempt=attempt-1, lease_token=null, lease_expires_at=null, not_before=clock_timestamp(),
         progress_json=project_private.job_progress('QUEUED',0,'Released by a stopping server') where id=j.id returning * into j;
       perform project_private.job_event(j, uid, 'RELEASED', '{}'::jsonb);
     else -- fail
       f := p_input->'failure';
       if (jsonb_typeof(f)='object' and f->>'code' ~ '^[A-Z0-9_]{1,64}$' and jsonb_typeof(f->'retryable')='boolean') is not true then raise invalid_parameter_value; end if;
       f := f || jsonb_build_object('attempt', j.attempt);
       if (f->>'retryable')::boolean and j.attempt < j.max_attempts and not j.cancel_requested then
         backoff := case j.attempt when 1 then 2 else 8 end;
         update public.project_jobs set status='QUEUED', lease_token=null, lease_expires_at=null, last_failure_json=f,
           not_before=clock_timestamp() + make_interval(secs => backoff), progress_json=project_private.job_progress('QUEUED',0,'Retrying after a transient failure') where id=j.id returning * into j;
         perform project_private.job_event(j, uid, 'REQUEUED', jsonb_build_object('code', f->>'code', 'backoffSeconds', backoff));
       else
         update public.project_jobs set status='FAILED', failure_json=f, lease_token=null, lease_expires_at=null, finished_at=clock_timestamp() where id=j.id returning * into j;
         perform project_private.job_event(j, uid, 'FAILED', jsonb_build_object('code', f->>'code', 'retryable', (f->>'retryable')::boolean));
       end if;
     end if;
   end if;
   result := project_private.job_detail(j);
 end if;
 if p_context is not null then
   insert into public.idempotency_records(user_id,operation,key_hash,fingerprint,response) values(uid,op,p_context->>'keyHash',p_context->>'fingerprint',result);
 end if;
 return result;
end;
$$;

create function public.job_read(p_action text,p_project_id uuid,p_job_id uuid default null,p_limit integer default 20,p_cursor jsonb default null,p_filter jsonb default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare j public.project_jobs; items jsonb; next_cursor jsonb; total integer; f jsonb := coalesce(p_filter,'{}'::jsonb); after integer;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if not exists (select 1 from public.projects where id=p_project_id and owner_id=auth.uid()) then raise exception using errcode='P1201',message='Project not found'; end if;
 if p_action in ('get','events') then
   select * into j from public.project_jobs where id=p_job_id and project_id=p_project_id;
   if not found then raise exception using errcode='P3201',message='Job not found'; end if;
   if p_action = 'get' then return project_private.job_detail(j); end if;
   after := coalesce((f->>'after')::integer, 0);
   if p_limit is null or p_limit<1 or p_limit>200 or after < 0 then raise invalid_parameter_value; end if;
   select coalesce(jsonb_agg(jsonb_build_object('seq',e.seq,'eventType',e.event_type,'detail',e.detail,'createdAt',e.created_at) order by e.seq),'[]'::jsonb)
   into items from (select * from public.project_job_events where job_id=j.id and seq > after order by seq limit p_limit) e;
   return jsonb_build_object('jobId',j.id,'status',j.status,'events',items,
     'nextAfter',coalesce((select max((x->>'seq')::integer) from jsonb_array_elements(items) x), after));
 elsif p_action='list' then
   if p_limit is null or p_limit<1 or p_limit>100 then raise invalid_parameter_value; end if;
   with page as (select * from public.project_jobs where project_id=p_project_id
     and (f->>'status' is null or status = f->>'status') and (f->>'kind' is null or kind = f->>'kind')
     and (p_cursor is null or (created_at,id)<((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid))
     order by created_at desc,id desc limit p_limit+1),
   shown as (select * from page order by created_at desc,id desc limit p_limit)
   select (select count(*) from page),coalesce(jsonb_agg(project_private.job_summary(shown) order by created_at desc,id desc),'[]'::jsonb),
   (select jsonb_build_object('createdAt',created_at,'id',id) from shown order by created_at,id limit 1) into total,items,next_cursor from shown;
   return jsonb_build_object('items',items,'nextCursor',case when total>p_limit then next_cursor else null end);
 end if;
 raise invalid_parameter_value;
end;
$$;
revoke all on function public.job_write(text,jsonb,jsonb,text,text),public.job_read(text,uuid,uuid,integer,jsonb,jsonb) from public,anon;
grant execute on function public.job_write(text,jsonb,jsonb,text,text),public.job_read(text,uuid,uuid,integer,jsonb,jsonb) to authenticated;
revoke all on all functions in schema project_private from public,anon,authenticated;
