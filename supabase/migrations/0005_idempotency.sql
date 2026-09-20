-- Private retry receipts. No bearer tokens or raw idempotency keys are retained.
create table public.idempotency_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (operation in ('/api/plans', '/api/plans/generate', '/api/estimates')),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  response jsonb not null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  primary key (user_id, operation, key_hash)
);
create index idempotency_expiry_idx on public.idempotency_records (expires_at);
alter table public.idempotency_records enable row level security;
revoke all on public.idempotency_records from public, anon, authenticated;
grant select, insert, delete on public.idempotency_records to authenticated;
grant all on public.idempotency_records to service_role;
create policy idempotency_read_own on public.idempotency_records for select to authenticated using (user_id = (select auth.uid()));
create policy idempotency_insert_own on public.idempotency_records for insert to authenticated with check (user_id = (select auth.uid()));
create policy idempotency_delete_own on public.idempotency_records for delete to authenticated using (user_id = (select auth.uid()));

-- SECURITY INVOKER deliberately preserves the caller's RLS and column grants.
-- Serializes only this caller/operation/key; rollback releases the lock and receipt.
create function public.commit_idempotent_creation(p_operation text, p_key_hash text, p_fingerprint text,
  p_kind text, p_row jsonb, p_response jsonb) returns jsonb
language plpgsql security invoker set search_path = '' set lock_timeout = '5s' as $$
declare
  receipt public.idempotency_records;
  plan_row public.plans;
  estimate_row public.cost_estimates;
  saved_id uuid;
begin
  if auth.uid() is null then raise insufficient_privilege; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || ':' || p_operation || ':' || p_key_hash, 0));
  select * into receipt from public.idempotency_records where user_id = auth.uid() and operation = p_operation and key_hash = p_key_hash;
  if found and receipt.expires_at > now() then
    if receipt.fingerprint <> p_fingerprint then raise exception using errcode = 'P8001', message = 'Idempotency conflict'; end if;
    return receipt.response;
  end if;
  delete from public.idempotency_records where user_id = auth.uid() and operation = p_operation and key_hash = p_key_hash;
  if p_kind = 'plan' and p_operation in ('/api/plans', '/api/plans/generate') then
    plan_row := pg_catalog.jsonb_populate_record(null::public.plans, p_row);
    insert into public.plans(user_id,prompt,seed,variant,plan_data,qa_orthogonal,bounds_width_m,bounds_depth_m,room_count,share_token)
      values(plan_row.user_id,plan_row.prompt,plan_row.seed,plan_row.variant,plan_row.plan_data,plan_row.qa_orthogonal,
        plan_row.bounds_width_m,plan_row.bounds_depth_m,plan_row.room_count,plan_row.share_token) returning id into saved_id;
    p_response := pg_catalog.jsonb_set(p_response, '{plan,id}', pg_catalog.to_jsonb(saved_id));
  elsif p_kind = 'estimate' and p_operation = '/api/estimates' then
    estimate_row := pg_catalog.jsonb_populate_record(null::public.cost_estimates, p_row);
    insert into public.cost_estimates(plan_id,user_id,location,building_type,built_up_area_sqft,floors,budget_provided,rate_table_version,tier_basic,tier_standard,tier_premium,soil_note)
      values(estimate_row.plan_id,estimate_row.user_id,estimate_row.location,estimate_row.building_type,estimate_row.built_up_area_sqft,
        estimate_row.floors,estimate_row.budget_provided,estimate_row.rate_table_version,estimate_row.tier_basic,estimate_row.tier_standard,
        estimate_row.tier_premium,estimate_row.soil_note);
  else
    raise exception using errcode = '22023', message = 'Unsupported operation';
  end if;
  insert into public.idempotency_records(user_id,operation,key_hash,fingerprint,response)
    values(auth.uid(),p_operation,p_key_hash,p_fingerprint,p_response);
  return p_response;
end;
$$;
revoke all on function public.commit_idempotent_creation(text,text,text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.commit_idempotent_creation(text,text,text,text,jsonb,jsonb) to authenticated;
