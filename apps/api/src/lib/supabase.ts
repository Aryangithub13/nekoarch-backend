import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { ApiError, databaseError } from './errors.js';
import { PlanRecordSchema, RateEntrySchema, RateVersionSchema, type Backend, type Repository, type PlanInsert, type EstimateInsert } from './repository.js';

export class SupabaseRepository implements Repository {
  constructor(private readonly client: SupabaseClient) {}
  async insertPlan(row: PlanInsert) {
    const { data, error } = await this.client.from('plans').insert(row).select('id,plan_data').single();
    if (error) databaseError(error);
    return PlanRecordSchema.parse(data);
  }
  async getPlan(id: string) {
    const { data, error } = await this.client.from('plans').select('id,plan_data').eq('id', id).maybeSingle();
    if (error) databaseError(error);
    return data ? PlanRecordSchema.parse(data) : null;
  }
  async patchPlan(id: string, isPublic: boolean) {
    const { data, error } = await this.client.from('plans').update({ is_public: isPublic }).eq('id', id).select('id,plan_data').maybeSingle();
    if (error) databaseError(error);
    return data ? PlanRecordSchema.parse(data) : null;
  }
  async getRateVersions() {
    const { data, error } = await this.client.from('rate_table_versions').select('id,version_label,effective_date,created_at')
      .order('effective_date', { ascending: false }).order('created_at', { ascending: false });
    if (error) databaseError(error);
    return z.array(RateVersionSchema).parse(data);
  }
  async getRateEntries(versionId: string) {
    const { data, error } = await this.client.from('rate_table_entries').select('id,version_id,region,building_type,tier,rate_per_sqft_min,rate_per_sqft_max,category_breakdown,is_active')
      .eq('version_id', versionId).eq('is_active', true);
    if (error) databaseError(error);
    return z.array(RateEntrySchema).parse(data);
  }
  async insertEstimate(row: EstimateInsert) {
    const { error } = await this.client.from('cost_estimates').insert(row);
    if (error) databaseError(error);
  }
}

export function createSupabaseBackend(env: Env): Backend {
  const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }, global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
  } };
  const authClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, options);
  return {
    async authenticate(token) {
      const { data, error } = await authClient.auth.getUser(token);
      if (error || !data.user) throw new ApiError(401, 'UNAUTHORIZED', 'A valid Supabase session is required');
      return { id: z.string().uuid().parse(data.user.id) };
    },
    repository(token) {
      // Never use the service role for route queries: it bypasses RLS.
      const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        ...options, global: { ...options.global, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) },
      });
      return new SupabaseRepository(client);
    },
  };
}
