-- Ownership includes Supabase anonymous identities: anonymous Auth users still
-- have a stable auth.uid(). Deleted users leave inaccessible, unclaimed history.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.set_updated_at() from public;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();
insert into public.profiles(id) select id from auth.users on conflict (id) do nothing;

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  prompt text not null check (char_length(prompt) between 1 and 500),
  seed text not null,
  variant integer not null default 1 check (variant >= 1),
  plan_data jsonb not null check (jsonb_typeof(plan_data) = 'object'),
  qa_orthogonal numeric not null check (qa_orthogonal between 0 and 1),
  bounds_width_m numeric not null check (bounds_width_m > 0 and bounds_width_m < 'Infinity'::numeric),
  bounds_depth_m numeric not null check (bounds_depth_m > 0 and bounds_depth_m < 'Infinity'::numeric),
  room_count integer not null check (room_count > 0),
  is_public boolean not null default false,
  share_token text not null unique check (share_token ~ '^[A-Za-z0-9_-]{32,128}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_data_matches_metadata check (
    (jsonb_typeof(plan_data->'prompt') = 'string'
    and plan_data->>'prompt' = prompt
    and jsonb_typeof(plan_data->'seed') = 'string'
    and plan_data->>'seed' = seed
    and plan_data->'variant' = to_jsonb(variant)
    and plan_data->'bounds'->'w' = to_jsonb(bounds_width_m)
    and plan_data->'bounds'->'d' = to_jsonb(bounds_depth_m)
    and plan_data->'qa'->'orthogonal' = to_jsonb(qa_orthogonal)
    and jsonb_typeof(plan_data->'rooms') = 'array'
    and jsonb_array_length(plan_data->'rooms') = room_count
    and jsonb_typeof(plan_data->'walls') = 'array'
    and jsonb_typeof(plan_data->'furn') = 'array'
    and (not plan_data ? 'id' or plan_data->>'id' = id::text)) is true
  )
);
alter table public.plans enable row level security;
create index plans_user_id_idx on public.plans(user_id);
create index plans_public_idx on public.plans(id) where is_public;
create trigger plans_set_updated_at before update on public.plans
for each row execute function public.set_updated_at();
