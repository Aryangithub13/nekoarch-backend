-- DEMONSTRATION DATA ONLY: illustrative INR per square foot baselines,
-- effective 2026-09-01. These figures are invented for development and require
-- licensed local quantity-surveyor validation before real-world use.
-- New financial rates must be a new version; reruns preserve historical data.
begin;
insert into public.rate_table_versions (version_label, effective_date)
values ('2026-09-01-illustrative-baseline', date '2026-09-01')
on conflict (version_label) do nothing;

with baseline as (
  select id from public.rate_table_versions
  where version_label = '2026-09-01-illustrative-baseline'
), rates(building_type, tier, rate_min, rate_max) as (
  values
    ('residential', 'basic', 1600, 2100),
    ('residential', 'standard', 2200, 2900),
    ('residential', 'premium', 3100, 4300),
    ('commercial', 'basic', 1900, 2500),
    ('commercial', 'standard', 2700, 3600),
    ('commercial', 'premium', 3900, 5400),
    ('institutional', 'basic', 2000, 2700),
    ('institutional', 'standard', 2900, 3900),
    ('institutional', 'premium', 4200, 5800)
)
insert into public.rate_table_entries
  (version_id, region, building_type, tier, rate_per_sqft_min, rate_per_sqft_max, category_breakdown)
select baseline.id, 'India baseline (illustrative)', rates.building_type,
  rates.tier, rates.rate_min, rates.rate_max,
  '{"Structure":0.35,"Finishes":0.25,"Electrical":0.10,"Plumbing":0.10,"Labour and preliminaries":0.15,"Contingency":0.05}'::jsonb
from baseline cross join rates
where not exists (
  select 1 from public.rate_table_entries existing
  where existing.version_id = baseline.id
    and existing.region = 'India baseline (illustrative)'
    and existing.building_type = rates.building_type and existing.tier = rates.tier
)
on conflict (version_id, region, building_type, tier) do nothing;
commit;
