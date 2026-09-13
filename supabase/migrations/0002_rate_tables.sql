create table public.rate_table_versions (
  id uuid primary key default gen_random_uuid(),
  version_label text not null unique check (char_length(version_label) > 0),
  effective_date date not null,
  created_at timestamptz not null default now()
);
alter table public.rate_table_versions enable row level security;

-- A malformed weight object must never silently distort an estimate.
create function public.valid_category_breakdown(value jsonb) returns boolean
language plpgsql immutable strict set search_path = '' as $$
declare item record; total numeric := 0; count_items integer := 0;
begin
  if jsonb_typeof(value) <> 'object' then return false; end if;
  for item in select * from jsonb_each(value) loop
    if char_length(item.key) = 0 or jsonb_typeof(item.value) <> 'number' then return false; end if;
    if item.value::text::numeric <= 0 or item.value::text::numeric > 1 then return false; end if;
    total := total + item.value::text::numeric;
    count_items := count_items + 1;
  end loop;
  return count_items > 0 and total = 1;
end;
$$;
revoke all on function public.valid_category_breakdown(jsonb) from public;

create table public.rate_table_entries (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.rate_table_versions(id) on delete cascade,
  region text not null check (char_length(region) > 0),
  building_type text not null check (building_type in ('residential','commercial','institutional')),
  tier text not null check (tier in ('basic','standard','premium')),
  rate_per_sqft_min numeric not null check (rate_per_sqft_min > 0 and rate_per_sqft_min < 'Infinity'::numeric),
  rate_per_sqft_max numeric not null check (rate_per_sqft_max >= rate_per_sqft_min and rate_per_sqft_max < 'Infinity'::numeric),
  category_breakdown jsonb not null check (public.valid_category_breakdown(category_breakdown)),
  is_active boolean not null default true,
  unique (version_id, region, building_type, tier)
);
alter table public.rate_table_entries enable row level security;
create index rate_entries_lookup_idx on public.rate_table_entries(version_id, region, building_type, tier) where is_active;
create index rate_versions_effective_date_idx on public.rate_table_versions(effective_date desc, created_at desc);
