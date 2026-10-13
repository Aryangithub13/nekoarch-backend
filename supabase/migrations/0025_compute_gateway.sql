-- Phase 36, first gateway slice: consented compute dispatches over the B32 durable jobs (hard rule 3: B36 builds on B32).
-- Additive only. No existing table, constraint, row or function changes. Local placement only: the checks below pin
-- placement, provider, cost and data transfer, so a later remote or metered slice needs its own forward migration.
-- No new role, credential, callback endpoint or background process.
create table public.project_compute_dispatches (
 quote_hash text primary key check (quote_hash ~ '^[a-f0-9]{64}$'),
 job_id uuid not null references public.project_jobs(id),
 project_id uuid not null references public.projects(id) on delete cascade,
 owner_id uuid not null,
 kind text not null check (kind in ('SCENE_COMPILE','OPTIMIZATION_STUDY')),
 placement text not null check (placement = 'LOCAL'),
 provider_id text not null check (provider_id = 'local-pool'),
 input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
 source_revision_id uuid not null,
 model_hash text not null check (model_hash ~ '^[a-f0-9]{64}$'),
 cost_class text not null check (cost_class = 'FREE'),
 cost_ceiling_minor bigint not null check (cost_ceiling_minor = 0),
 currency text not null check (currency = 'INR'),
 data_transfer text not null check (data_transfer = 'NONE'),
 quote_json jsonb not null check (jsonb_typeof(quote_json) = 'object' and octet_length(quote_json::text) <= 16384),
 consented_at timestamptz not null default clock_timestamp(),
 foreign key (project_id, source_revision_id) references public.project_revisions(project_id, id)
);
create index project_compute_dispatches_job_idx on public.project_compute_dispatches(job_id);
create index project_compute_dispatches_owner_idx on public.project_compute_dispatches(owner_id, consented_at);

alter table public.project_compute_dispatches enable row level security;
revoke all on public.project_compute_dispatches from public, anon, authenticated, service_role;
grant select on public.project_compute_dispatches to authenticated, service_role;
create policy compute_dispatches_owner_read on public.project_compute_dispatches for select to authenticated using (
 exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
-- A consent record is evidence: never updated or deleted.
create trigger compute_dispatch_immutable before update or delete on public.project_compute_dispatches
 for each row execute function project_private.immutable_revision();

create function project_private.compute_dispatch(d public.project_compute_dispatches) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('dispatchVersion','compute-dispatch-v1','quoteHash',d.quote_hash,'jobId',d.job_id,'projectId',d.project_id,'ownerId',d.owner_id,
 'kind',d.kind,'placement',d.placement,'providerId',d.provider_id,'inputHash',d.input_hash,'sourceRevisionId',d.source_revision_id,'modelHash',d.model_hash,
 'costClass',d.cost_class,'costCeilingMinor',d.cost_ceiling_minor,'currency',d.currency,'dataTransfer',d.data_transfer,'quote',d.quote_json,'consentedAt',d.consented_at)
$$;

-- Accepts one consented quote. The job submission is the caller's own signed B32 job_write call, run in this transaction, so the job and
-- its consent record commit together. The quote hash is single-use: a repeated consent returns the job it started instead of running again.
create function public.compute_write(p_action text,p_input jsonb,p_job_call jsonb,p_envelope text,p_signature text) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare uid uuid := auth.uid(); secret text; envelope jsonb; p public.projects; d public.project_compute_dispatches; j public.project_jobs; job jsonb;
begin
 if uid is null then raise insufficient_privilege; end if;
 if p_action <> 'submit' then raise invalid_parameter_value; end if;
 select k.secret into secret from project_private.commit_key k where singleton;
 if p_envelope is null or p_signature is null or secret is null or
   p_signature <> encode(extensions.hmac(convert_to(p_envelope,'UTF8'),decode(secret,'hex'),'sha256'),'hex') then raise insufficient_privilege; end if;
 envelope := p_envelope::jsonb;
 if (envelope->>'userId'=uid::text and envelope->>'operation'='/api/projects/:projectId/compute/jobs' and envelope->'input'=p_input and
   (envelope->>'expiresAt')::bigint between extract(epoch from clock_timestamp())::bigint and extract(epoch from clock_timestamp())::bigint+600) is not true then
   raise insufficient_privilege; end if;
 select * into p from public.projects where id=(p_input->>'projectId')::uuid and owner_id=uid for update;
 if not found then raise exception using errcode='P1201',message='Project not found'; end if;
 -- Owner-wide limits are serialized across all of the owner's projects.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('compute-owner:'||uid::text,0));
 select * into d from public.project_compute_dispatches where quote_hash=p_input->>'quoteHash';
 if found then
   if d.owner_id<>uid or d.project_id<>p.id or d.input_hash<>p_input->>'inputHash' then raise exception using errcode='P3602',message='Quote conflict'; end if;
   select * into j from public.project_jobs where id=d.job_id;
   return jsonb_build_object('job',project_private.job_detail(j),'dispatch',project_private.compute_dispatch(d),'replayed',true);
 end if;
 if (p_input->'limits'->>'maxConsentedPerOwnerPerDay')::integer is null or (p_input->'limits'->>'maxActivePerOwner')::integer is null then raise invalid_parameter_value; end if;
 if (select count(*) from public.project_compute_dispatches where owner_id=uid and consented_at > clock_timestamp() - interval '1 day')
     >= (p_input->'limits'->>'maxConsentedPerOwnerPerDay')::integer
   or (select count(*) from public.project_compute_dispatches x join public.project_jobs y on y.id=x.job_id where x.owner_id=uid and y.status in ('QUEUED','RUNNING'))
     >= (p_input->'limits'->>'maxActivePerOwner')::integer then
   raise exception using errcode='P3601',message='Compute limit reached'; end if;
 -- The nested submission must be exactly the consented work.
 if (p_job_call->>'p_action'='submit' and p_job_call->'p_input'->>'projectId'=p.id::text and p_job_call->'p_input'->>'kind'=p_input->>'kind'
   and p_job_call->'p_input'->>'inputHash'=p_input->>'inputHash' and p_job_call->'p_input'->'request'=p_input->'request') is not true then raise insufficient_privilege; end if;
 job := public.job_write('submit', p_job_call->'p_input', null, p_job_call->>'p_envelope', p_job_call->>'p_signature');
 insert into public.project_compute_dispatches(quote_hash,job_id,project_id,owner_id,kind,placement,provider_id,input_hash,source_revision_id,model_hash,
   cost_class,cost_ceiling_minor,currency,data_transfer,quote_json)
 values(p_input->>'quoteHash',(job->>'id')::uuid,p.id,uid,p_input->>'kind',p_input->>'placement',p_input->>'providerId',p_input->>'inputHash',
   (p_input->>'sourceRevisionId')::uuid,p_input->>'modelHash',p_input->>'costClass',(p_input->>'costCeilingMinor')::bigint,p_input->>'currency',
   p_input->>'dataTransfer',p_input->'quote')
 returning * into d;
 return jsonb_build_object('job',job,'dispatch',project_private.compute_dispatch(d),'replayed',false);
end;
$$;

create function public.compute_read(p_action text,p_project_id uuid,p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if not exists (select 1 from public.projects where id=p_project_id and owner_id=auth.uid()) then raise exception using errcode='P1201',message='Project not found'; end if;
 if p_action <> 'job' then raise invalid_parameter_value; end if;
 if not exists (select 1 from public.project_jobs where id=p_job_id and project_id=p_project_id) then raise exception using errcode='P3201',message='Job not found'; end if;
 return coalesce((select jsonb_agg(project_private.compute_dispatch(d) order by d.consented_at, d.quote_hash) from public.project_compute_dispatches d
   where d.job_id=p_job_id and d.project_id=p_project_id), '[]'::jsonb);
end;
$$;
revoke all on function public.compute_write(text,jsonb,jsonb,text,text), public.compute_read(text,uuid,uuid) from public, anon;
grant execute on function public.compute_write(text,jsonb,jsonb,text,text), public.compute_read(text,uuid,uuid) to authenticated;
revoke all on all functions in schema project_private from public, anon, authenticated;
