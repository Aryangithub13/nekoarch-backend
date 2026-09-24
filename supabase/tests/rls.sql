-- Run with `supabase test db` after `supabase db reset`.
-- Uses the actual Supabase Auth schema and built-in auth.uid(), not the test shim.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);

insert into auth.users (id, is_anonymous) values
  ('10000000-0000-4000-8000-000000000001', true),
  ('10000000-0000-4000-8000-000000000002', true);

select is((select count(*)::integer from public.profiles where id in (
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002')), 2,
  'anonymous Supabase users get profiles');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'), 11, 'exactly eleven public tables including native projects');
select ok((select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'), 'all public tables have RLS');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select lives_ok($$
  insert into public.plans (user_id,prompt,seed,variant,plan_data,qa_orthogonal,bounds_width_m,bounds_depth_m,room_count,share_token)
  values ('10000000-0000-4000-8000-000000000001','RLS fixture','fixture',1,
    '{"prompt":"RLS fixture","seed":"fixture","variant":1,"rooms":[{"id":1,"name":"Room","type":"living","rect":{"x":0,"z":0,"w":5,"d":4}}],"walls":[],"furn":[],"bounds":{"x":0,"z":0,"w":5,"d":4},"qa":{"orthogonal":1,"walls":0,"pieces":0}}',
    1,5,4,1,'rls-fixture-unguessable-token-only-for-database-tests')
$$, 'owner inserts private plan');
select is((select count(id)::integer from public.plans where seed = 'fixture'), 1, 'owner sees private plan');
select throws_ok('select share_token from public.plans', '42501', null, 'tokens are not selectable even by owner');
select throws_ok('update public.plans set user_id = null', '42501', null, 'owner cannot change ownership');
select throws_ok('update public.plans set plan_data = ''{}''', '42501', null, 'owner cannot rewrite persisted geometry');
select is((select count(*)::integer from public.profiles), 1, 'profile reads are owner-scoped');
select lives_ok('update public.profiles set display_name = ''Owner''', 'owner can change profile name');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is((select count(id)::integer from public.plans where seed = 'fixture'), 0, 'stranger cannot read private plan');
with changed as (update public.plans set is_public = true where seed = 'fixture' returning id)
select is((select count(*)::integer from changed), 0, 'stranger cannot publish another plan');
select throws_ok($$
  insert into public.plans (user_id,prompt,seed,variant,plan_data,qa_orthogonal,bounds_width_m,bounds_depth_m,room_count,share_token)
  values ('10000000-0000-4000-8000-000000000001','RLS fixture','fixture',1,
    '{"prompt":"RLS fixture","seed":"fixture","variant":1,"rooms":[{}],"walls":[],"furn":[],"bounds":{"w":5,"d":4},"qa":{"orthogonal":1}}',
    1,5,4,1,'forged-owner-token-for-database-tests-only')
$$, '42501', null, 'arbitrary user_id insertion is rejected');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select lives_ok('update public.plans set is_public = true where seed = ''fixture''', 'owner can publish plan');
select lives_ok($$
  insert into public.cost_estimates (user_id,plan_id,location,building_type,built_up_area_sqft,rate_table_version,tier_basic,tier_standard,tier_premium)
  select '10000000-0000-4000-8000-000000000001', p.id, 'India baseline (illustrative)', 'residential', 1000, v.id,
    '{"tier":"basic"}', '{"tier":"standard"}', '{"tier":"premium"}'
  from public.plans p cross join public.rate_table_versions v
  where p.seed = 'fixture' and v.version_label = '2026-09-01-illustrative-baseline'
$$, 'owner persists estimate linked to version');
select is((select count(*)::integer from public.cost_estimates), 1, 'owner reads estimate');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is((select count(id)::integer from public.plans where seed = 'fixture'), 1, 'stranger sees explicitly public plan');
select is((select count(*)::integer from public.cost_estimates), 0, 'public plans do not expose private estimates');
select throws_ok('select * from public.generation_logs', '42501', null, 'clients cannot read audit logs');
select throws_ok('update public.rate_table_entries set rate_per_sqft_min = 1', '42501', null, 'clients cannot mutate rates');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select is((select count(id)::integer from public.plans where seed = 'fixture'), 1, 'unauthenticated readers see public plan');
select throws_ok('select share_token from public.plans', '42501', null, 'public readers cannot retrieve share token');
select is((select count(*)::integer from public.rate_table_entries), 9, 'complete active rate matrix is public');

reset role;
select is((select count(*)::integer from public.generation_logs g join public.plans p on p.id = g.plan_id
  where p.seed = 'fixture' and g.event_type = 'generated'), 1, 'backend trigger recorded audit atomically');
select * from finish();
rollback;
