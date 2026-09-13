create table public.cost_estimates (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references public.plans(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  location text not null check (char_length(location) > 0),
  building_type text not null check (building_type in ('residential','commercial','institutional')),
  built_up_area_sqft numeric not null check (built_up_area_sqft > 0 and built_up_area_sqft < 'Infinity'::numeric),
  floors integer not null default 1 check (floors > 0),
  budget_provided numeric check (budget_provided is null or (budget_provided > 0 and budget_provided < 'Infinity'::numeric)),
  rate_table_version uuid not null references public.rate_table_versions(id) on delete restrict,
  tier_basic jsonb not null check ((jsonb_typeof(tier_basic) = 'object' and tier_basic->>'tier' = 'basic') is true),
  tier_standard jsonb not null check ((jsonb_typeof(tier_standard) = 'object' and tier_standard->>'tier' = 'standard') is true),
  tier_premium jsonb not null check ((jsonb_typeof(tier_premium) = 'object' and tier_premium->>'tier' = 'premium') is true),
  soil_note text,
  created_at timestamptz not null default now()
);
alter table public.cost_estimates enable row level security;
create index cost_estimates_plan_id_idx on public.cost_estimates(plan_id);
create index cost_estimates_user_id_idx on public.cost_estimates(user_id);
create index cost_estimates_version_idx on public.cost_estimates(rate_table_version);

create table public.generation_logs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references public.plans(id) on delete cascade,
  event_type text not null check (event_type in ('generated','regenerated','furniture_placement_skipped','label_collision_detected')),
  detail jsonb check (detail is null or jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);
alter table public.generation_logs enable row level security;
create index generation_logs_plan_id_idx on public.generation_logs(plan_id);

-- Refinement of the plan's separate audit write: this backend-owned trigger
-- records generation in the SAME transaction as persistence, without logging
-- prompts or share tokens and without exposing client access to the audit table.
create function public.audit_saved_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.generation_logs (plan_id, event_type, detail)
  values (new.id, 'generated', jsonb_build_object('variant', new.variant, 'roomCount', new.room_count));
  return new;
end;
$$;
revoke all on function public.audit_saved_plan() from public;
create trigger plans_audit_generated after insert on public.plans
for each row execute function public.audit_saved_plan();

-- Once any estimate cites a version, the financial source must remain stable.
-- Operators can retire entries with is_active, but must publish a new version
-- to correct rates. A lock serializes provenance insertion and source mutation.
create function public.lock_estimate_rate_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.rate_table_versions where id = new.rate_table_version for update;
  return new;
end;
$$;
revoke all on function public.lock_estimate_rate_version() from public;
create trigger estimate_lock_rate_version before insert or update of rate_table_version on public.cost_estimates
for each row execute function public.lock_estimate_rate_version();

create function public.protect_used_rate_entry() returns trigger
language plpgsql security definer set search_path = '' as $$
declare version_uuid uuid;
begin
  version_uuid := case when tg_op = 'INSERT' then new.version_id else old.version_id end;
  perform 1 from public.rate_table_versions where id = version_uuid for update;
  if exists (select 1 from public.cost_estimates where rate_table_version = version_uuid) then
    if tg_op = 'UPDATE' and (to_jsonb(new) - 'is_active') = (to_jsonb(old) - 'is_active') then return new; end if;
    raise exception 'Referenced rate versions are immutable; publish a new version' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.version_id <> old.version_id then
    perform 1 from public.rate_table_versions where id = new.version_id for update;
    if exists (select 1 from public.cost_estimates where rate_table_version = new.version_id) then
      raise exception 'Referenced rate versions are immutable; publish a new version' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.protect_used_rate_entry() from public;
create trigger rate_entries_protect_history before insert or update or delete on public.rate_table_entries
for each row execute function public.protect_used_rate_entry();

create function public.protect_used_rate_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new is distinct from old and exists (select 1 from public.cost_estimates where rate_table_version = old.id) then
    raise exception 'Referenced rate versions are immutable; publish a new version' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_used_rate_version() from public;
create trigger rate_versions_protect_history before update on public.rate_table_versions
for each row execute function public.protect_used_rate_version();
