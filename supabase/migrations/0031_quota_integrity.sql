-- B33 account quotas (0023) are owner-wide: 200 projects, 8 active jobs and 1 GiB of live references per owner. Each trigger counts and then lets the insert
-- through, and the RPCs that insert lock at most the one project row they write to. Two inserts for one owner (two new projects, or jobs or references in
-- different projects) therefore both saw room and both committed. Serialize each count per owner, as 0025 already does for the owner-wide compute limits.
-- Forward-only: 0023 may already be applied to a shared database. Same quotas, error codes and messages; only the lock is new. Every inserting path takes
-- its project row lock (if any) before this owner lock, and none locks a project after it, so the lock order is fixed.
create or replace function project_private.account_project_quota() returns trigger language plpgsql set search_path = '' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-quota:projects:' || new.owner_id::text, 0));
 if (select count(*) from public.projects where owner_id = new.owner_id) >= 200 then
   raise exception using errcode = 'P3304', message = 'Account project quota reached'; end if;
 return new;
end;
$$;
create or replace function project_private.account_reference_quota() returns trigger language plpgsql set search_path = '' as $$
declare owner_uuid uuid := (select owner_id from public.projects where id = new.project_id);
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-quota:references:' || owner_uuid::text, 0));
 if (select coalesce(sum(r.stored_bytes), 0) from public.project_references r join public.projects p on p.id = r.project_id
     where p.owner_id = owner_uuid and r.status <> 'DELETED') + new.stored_bytes > 1073741824 then
   raise exception using errcode = 'P3304', message = 'Account reference storage quota reached'; end if;
 return new;
end;
$$;
-- A job also becomes active again through a retry (FAILED -> QUEUED, the only such transition; see job_guard in 0022). That is an UPDATE, which the
-- insert-only trigger never saw, and job_write's retry checks neither active-job limit. Count a job against both limits whenever it becomes active. The
-- per-project limit (4, P3204) is checked here only for that transition: job_write already checks it for submissions, and holds the project row lock for
-- every action, so the retry check is serialized by it too.
create or replace function project_private.account_job_quota() returns trigger language plpgsql set search_path = '' as $$
begin
 if new.status not in ('QUEUED','RUNNING') or (tg_op = 'UPDATE' and old.status in ('QUEUED','RUNNING')) then return new; end if;
 if tg_op = 'UPDATE' and (select count(*) from public.project_jobs where project_id = new.project_id and status in ('QUEUED','RUNNING')) >= 4 then
   raise exception using errcode = 'P3204', message = 'Project job limit reached'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-quota:jobs:' || new.owner_id::text, 0));
 if (select count(*) from public.project_jobs where owner_id = new.owner_id and status in ('QUEUED','RUNNING')) >= 8 then
   raise exception using errcode = 'P3304', message = 'Account active job quota reached'; end if;
 return new;
end;
$$;
drop trigger account_job_quota on public.project_jobs;
create trigger account_job_quota before insert or update of status on public.project_jobs for each row execute function project_private.account_job_quota();
revoke all on all functions in schema project_private from public, anon, authenticated;
