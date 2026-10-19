-- Audit B INT-B-015 and INT-B-017: two read-only probes for /health/ready and capability discovery. Additive only: two new functions;
-- no table, policy, grant or existing function changes.

-- The newest migration this database has applied. Every later migration replaces this function with its own number, so an API deployed
-- ahead of its migrations reports not-ready instead of failing at runtime (apps/api/src/lib/deployment-state.ts pins the value it needs).
create or replace function public.schema_version() returns integer language sql stable set search_path = '' as $$ select 32 $$;

-- Whether a probe was signed with this database's commit key. Every signed write refuses a bad signature with insufficient_privilege, the
-- same SQLSTATE as a genuine permission failure, so a stale PROJECT_COMMIT_SECRET (every `supabase db reset` regenerates the key) surfaced
-- as 403 FORBIDDEN while readiness stayed green. The probe has its own prefix, so it is never a write envelope, and the function only
-- verifies: it cannot sign anything. Both sides are HMAC'd again before comparison, as in 0024, so the comparison time is independent of
-- the expected signature.
create function public.commit_key_matches(p_probe text, p_signature text) returns boolean
language sql stable security definer set search_path = '' as $$
 select coalesce((select (p_probe like 'designflow:commit-key-probe:%' and char_length(p_probe) <= 128 and p_signature ~ '^[a-f0-9]{64}$'
   and extensions.hmac(convert_to(p_signature, 'UTF8'), decode(k.secret, 'hex'), 'sha256')
     = extensions.hmac(convert_to(encode(extensions.hmac(convert_to(p_probe, 'UTF8'), decode(k.secret, 'hex'), 'sha256'), 'hex'), 'UTF8'), decode(k.secret, 'hex'), 'sha256')) is true
   from project_private.commit_key k where k.singleton), false);
$$;

revoke all on function public.schema_version(), public.commit_key_matches(text, text) from public;
grant execute on function public.schema_version(), public.commit_key_matches(text, text) to anon, authenticated;
revoke all on all functions in schema project_private from public, anon, authenticated;
