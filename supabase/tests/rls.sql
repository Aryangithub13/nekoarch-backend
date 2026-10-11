-- Run with `supabase test db` after additive migration application.
-- Uses the actual Supabase Auth schema and built-in auth.uid(), not the test shim.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(96);

insert into auth.users (id, is_anonymous) values
  ('10000000-0000-4000-8000-000000000001', true),
  ('10000000-0000-4000-8000-000000000002', true);

select is((select count(*)::integer from public.profiles where id in (
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002')), 2,
  'anonymous Supabase users get profiles');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'), 23, 'exactly twenty-three public tables including structural, environmental, building-systems, knowledge, optimization studies and scene artifacts/blobs');
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
set local role authenticated;
select throws_ok('insert into public.project_revision_takeoffs default values', '42501', null, 'clients cannot forge takeoff reports');
select throws_ok('update public.project_revision_takeoffs set report_json = ''{}''', '42501', null, 'clients cannot rewrite takeoff reports');
select throws_ok('delete from public.project_revision_takeoffs', '42501', null, 'clients cannot delete takeoff history');
select throws_ok($$select public.takeoff_write('{}')$$, '42501', null, 'unsigned takeoff RPC is forbidden');
select throws_ok('insert into public.project_revision_construction_calculations default values', '42501', null, 'clients cannot forge construction reports');
select throws_ok('update public.project_revision_construction_calculations set report_json = ''{}''', '42501', null, 'clients cannot rewrite construction reports');
select throws_ok('delete from public.project_revision_construction_calculations', '42501', null, 'clients cannot delete construction history');
select throws_ok($$select public.construction_write('{}')$$, '42501', null, 'unsigned construction RPC is forbidden');
select throws_ok('insert into public.project_revision_cost_estimates default values', '42501', null, 'clients cannot forge BOQ costs');
select throws_ok('update public.project_revision_cost_estimates set report_json = ''{}''', '42501', null, 'clients cannot rewrite BOQ costs');
select throws_ok('delete from public.project_revision_cost_estimates', '42501', null, 'clients cannot delete BOQ costs');
select throws_ok($$select public.cost_write('{}')$$, '42501', null, 'unsigned cost RPC is forbidden');
select throws_ok('insert into public.project_workflow_runs default values', '42501', null, 'clients cannot forge workflows');
select throws_ok('update public.project_workflow_runs set status = ''COMPLETED''', '42501', null, 'clients cannot rewrite workflows');
select throws_ok('delete from public.project_workflow_runs', '42501', null, 'clients cannot delete workflows');
select throws_ok($$select public.workflow_write('{}')$$, '42501', null, 'unsigned workflow RPC is forbidden');
select throws_ok('insert into public.project_revision_structural_analyses default values', '42501', null, 'clients cannot forge structural analyses');
select throws_ok('update public.project_revision_structural_analyses set status = ''VALIDATED''', '42501', null, 'clients cannot rewrite structural analyses');
select throws_ok('delete from public.project_revision_structural_analyses', '42501', null, 'clients cannot delete structural history');
select throws_ok($$select public.structural_write('{}')$$, '42501', null, 'unsigned structural RPC is forbidden');
select throws_ok($$select project_private.structural_summary(null)$$, '42501', null, 'structural helpers are private');
select throws_ok('insert into public.project_revision_environmental_analyses default values', '42501', null, 'clients cannot forge environmental analyses');
select throws_ok('update public.project_revision_environmental_analyses set status = ''VALIDATED''', '42501', null, 'clients cannot rewrite environmental analyses');
select throws_ok('delete from public.project_revision_environmental_analyses', '42501', null, 'clients cannot delete environmental history');
select throws_ok($$select public.environmental_write('{}')$$, '42501', null, 'unsigned environmental RPC is forbidden');
select throws_ok($$select project_private.environmental_summary(null)$$, '42501', null, 'environmental helpers are private');
select throws_ok('insert into public.project_revision_building_systems_analyses default values', '42501', null, 'clients cannot forge building-systems analyses');
select throws_ok('update public.project_revision_building_systems_analyses set status = ''VALIDATED''', '42501', null, 'clients cannot rewrite building-systems analyses');
select throws_ok('delete from public.project_revision_building_systems_analyses', '42501', null, 'clients cannot delete building-systems history');
select throws_ok($$select public.systems_write('{}')$$, '42501', null, 'unsigned building-systems RPC is forbidden');
select throws_ok($$select project_private.systems_summary(null)$$, '42501', null, 'building-systems helpers are private');
select throws_ok('insert into public.project_revision_specialized_knowledge_analyses default values', '42501', null, 'clients cannot forge knowledge analyses');
select throws_ok('update public.project_revision_specialized_knowledge_analyses set status = ''VALIDATED''', '42501', null, 'clients cannot rewrite knowledge analyses');
select throws_ok('delete from public.project_revision_specialized_knowledge_analyses', '42501', null, 'clients cannot delete knowledge history');
select throws_ok($$select public.knowledge_write('{}')$$, '42501', null, 'unsigned knowledge RPC is forbidden');
select throws_ok($$select project_private.knowledge_summary(null)$$, '42501', null, 'knowledge helpers are private');
select throws_ok('insert into public.project_revision_optimization_studies default values', '42501', null, 'clients cannot forge optimization studies');
select throws_ok('update public.project_revision_optimization_studies set status = ''COMPLETED''', '42501', null, 'clients cannot rewrite optimization studies');
select throws_ok('delete from public.project_revision_optimization_studies', '42501', null, 'clients cannot delete optimization history');
select throws_ok($$select public.optimization_write('{}')$$, '42501', null, 'unsigned optimization RPC is forbidden');
select throws_ok($$select project_private.optimization_summary(null)$$, '42501', null, 'optimization helpers are private');
select throws_ok('insert into public.project_revision_scene_artifacts default values', '42501', null, 'clients cannot forge scene artifacts');
select throws_ok('update public.project_revision_scene_artifacts set status = ''READY''', '42501', null, 'clients cannot rewrite scene artifacts');
select throws_ok('delete from public.project_revision_scene_artifacts', '42501', null, 'clients cannot delete scene history');
select throws_ok('select glb from public.project_revision_scene_blobs', '42501', null, 'owners never read scene bytes except through the RPC');
select throws_ok('insert into public.project_revision_scene_blobs default values', '42501', null, 'clients cannot plant scene bytes');
select throws_ok($$select public.scene_write('{}', '')$$, '42501', null, 'unsigned scene RPC is forbidden');
select throws_ok($$select project_private.scene_summary(null)$$, '42501', null, 'scene helpers are private');
select throws_ok('update public.project_revisions set generation_identity = null', '42501', null, 'clients cannot rewrite generation identity');
select throws_ok('update public.project_revisions set normalized_requirements = null', '42501', null, 'clients cannot rewrite generation inputs');
select throws_ok($$select project_private.canonical_building('{}')$$, '42501', null, 'identity helpers are private');
set local role anon;
select throws_ok('select generation_identity from public.project_revisions', '42501', null, 'private identities are never public');
select throws_ok('select * from public.project_workflow_runs', '42501', null, 'workflows are never public');
select throws_ok('select * from public.project_revision_takeoffs', '42501', null, 'takeoffs are never public');
select throws_ok('select * from public.project_revision_cost_estimates', '42501', null, 'cost reports are never public');
select throws_ok('select * from public.project_revision_construction_calculations', '42501', null, 'construction reports are never public');
select throws_ok('select * from public.project_revision_structural_analyses', '42501', null, 'structural analyses are never public');
select throws_ok($$select public.structural_read('list', gen_random_uuid(), gen_random_uuid())$$, '42501', null, 'anonymous structural reads are forbidden');
select throws_ok('select * from public.project_revision_environmental_analyses', '42501', null, 'environmental analyses are never public');
select throws_ok($$select public.environmental_read('list', gen_random_uuid(), gen_random_uuid())$$, '42501', null, 'anonymous environmental reads are forbidden');
select throws_ok('select * from public.project_revision_building_systems_analyses', '42501', null, 'building-systems analyses are never public');
select throws_ok($$select public.systems_read('list', gen_random_uuid(), gen_random_uuid())$$, '42501', null, 'anonymous building-systems reads are forbidden');
select throws_ok('select * from public.project_revision_specialized_knowledge_analyses', '42501', null, 'knowledge analyses are never public');
select throws_ok($$select public.knowledge_read('list', gen_random_uuid(), gen_random_uuid())$$, '42501', null, 'anonymous knowledge reads are forbidden');
select throws_ok('select * from public.project_revision_optimization_studies', '42501', null, 'optimization studies are never public');
select throws_ok($$select public.optimization_read('list', gen_random_uuid(), gen_random_uuid())$$, '42501', null, 'anonymous optimization reads are forbidden');
select throws_ok('select * from public.project_revision_scene_artifacts', '42501', null, 'scene artifacts are never public');
select throws_ok('select * from public.project_revision_scene_blobs', '42501', null, 'scene bytes are never public');
select throws_ok($$select public.scene_read('glb', gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$$, '42501', null, 'anonymous scene downloads are forbidden');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select throws_ok('update public.architectural_conversations set state = ''{}''', '42501', null, 'clients cannot forge conversational state');
select throws_ok('delete from public.architectural_conversations', '42501', null, 'conversation deletion requires trusted owner route');
select throws_ok('select public.conversation_write(''submit'',''{}'',null,null)', '42501', null, 'approval RPC requires a server attestation');
select * from finish();
rollback;
