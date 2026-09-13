-- Explicit privileges avoid inheriting broad Supabase default table grants.
revoke all on public.profiles, public.plans, public.rate_table_versions,
  public.rate_table_entries, public.cost_estimates, public.generation_logs
  from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant all on public.profiles, public.plans, public.rate_table_versions,
  public.rate_table_entries, public.cost_estimates, public.generation_logs to service_role;
grant execute on function public.valid_category_breakdown(jsonb) to service_role;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
create policy profiles_read_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Sharing a plan NEVER exposes its capability token, even through direct
-- Supabase REST/SQL access. Callers must name these safe SELECT columns.
grant select (id, user_id, prompt, seed, variant, plan_data, qa_orthogonal,
  bounds_width_m, bounds_depth_m, room_count, is_public, created_at, updated_at)
  on public.plans to anon, authenticated;
grant insert (user_id, prompt, seed, variant, plan_data, qa_orthogonal,
  bounds_width_m, bounds_depth_m, room_count, share_token) on public.plans to authenticated;
grant update (is_public) on public.plans to authenticated;
grant delete on public.plans to authenticated;
create policy plans_read_own_or_public on public.plans for select to anon, authenticated
  using (is_public or user_id = (select auth.uid()));
create policy plans_insert_own on public.plans for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy plans_update_own on public.plans for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy plans_delete_own on public.plans for delete to authenticated
  using (user_id = (select auth.uid()));

grant select on public.cost_estimates to authenticated;
grant insert (plan_id, user_id, location, building_type, built_up_area_sqft,
  floors, budget_provided, rate_table_version, tier_basic, tier_standard,
  tier_premium, soil_note) on public.cost_estimates to authenticated;
-- Estimate budgets/location remain private even if their plan is public.
create policy estimates_read_own on public.cost_estimates for select to authenticated
  using (user_id = (select auth.uid()));
create policy estimates_insert_own on public.cost_estimates for insert to authenticated
  with check (user_id = (select auth.uid()) and
    (plan_id is null or exists (select 1 from public.plans p where p.id = plan_id)));

grant select on public.rate_table_versions, public.rate_table_entries to anon, authenticated;
create policy rate_versions_read_effective on public.rate_table_versions for select to anon, authenticated
  using (effective_date <= current_date);
create policy rate_entries_read_active_effective on public.rate_table_entries for select to anon, authenticated
  using (is_active and exists (select 1 from public.rate_table_versions v
    where v.id = version_id and v.effective_date <= current_date));
-- generation_logs has RLS and no client policies or grants: backend access only.
