import { conversationDatabaseError } from './conversation-repository.js';
import { workflowDatabaseError } from './workflow-repository.js';
import { costDatabaseError } from './cost-repository.js';
import { constructionDatabaseError } from './construction-repository.js';
import { takeoffDatabaseError } from './takeoff-repository.js';
import { structuralDatabaseError } from './structural-repository.js';
import { environmentalDatabaseError } from './environmental-repository.js';
import { systemsDatabaseError } from './systems-repository.js';
import { knowledgeDatabaseError } from './knowledge-repository.js';
import { optimizationDatabaseError } from './optimization-repository.js';
import { sceneDatabaseError } from './scene-repository.js';
import { revisionDatabaseError } from './revision-repository.js';
import { referenceDatabaseError } from './reference-repository.js';
import { jobDatabaseError } from './job-repository.js';
import { accountDatabaseError } from './account-repository.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { projectDatabaseError } from './project-repository.js';
import type { Env } from '../config/env.js';
import { ApiError, databaseError } from './errors.js';
import { PlanRecordSchema, RateEntrySchema, RateVersionSchema, type Backend, type Repository, type PlanInsert, type EstimateInsert, type IdempotencyContext, type DurableWrite } from './repository.js';

export class SupabaseRepository implements Repository {
  constructor(private readonly client: SupabaseClient) {}
  async conversationRpc(name: 'conversation_read' | 'conversation_write', args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) conversationDatabaseError(error);
    return data as unknown;
  }
  async workflowRpc(name: 'workflow_read' | 'workflow_write', args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) workflowDatabaseError(error);
    return data as unknown;
  }
  async costRpc(name: 'cost_read' | 'cost_write', args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) costDatabaseError(error);
    return data as unknown;
  }
  async constructionRpc(name: 'construction_read' | 'construction_write', args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) constructionDatabaseError(error);
    return data as unknown;
  }
  async takeoffRpc(name: 'takeoff_read' | 'takeoff_write', args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) takeoffDatabaseError(error);
    return data as unknown;
  }
  async structuralRpc(name: 'structural_read' | 'structural_write', args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) structuralDatabaseError(error);
    return data as unknown;
  }
  async environmentalRpc(name: 'environmental_read' | 'environmental_write', args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) environmentalDatabaseError(error);
    return data as unknown;
  }
  async systemsRpc(name: 'systems_read' | 'systems_write', args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) systemsDatabaseError(error);
    return data as unknown;
  }
  async knowledgeRpc(name: 'knowledge_read' | 'knowledge_write', args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) knowledgeDatabaseError(error);
    return data as unknown;
  }
  async optimizationRpc(name: 'optimization_read' | 'optimization_write', args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) optimizationDatabaseError(error);
    return data as unknown;
  }
  async sceneRpc(name: 'scene_read' | 'scene_write', args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) sceneDatabaseError(error);
    return data as unknown;
  }
  async revisionRpc(name: 'revision_operation_read' | 'revision_operation_write', args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) revisionDatabaseError(error);
    return data as unknown;
  }
  async referenceRpc(name: 'reference_read' | 'reference_write' | 'reference_download', args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) referenceDatabaseError(error);
    return data as unknown;
  }
  async jobRpc(name: 'job_read' | 'job_write', args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) jobDatabaseError(error);
    return data as unknown;
  }
  async accountRpc(name: 'account_read' | 'account_write' | 'library_search' | 'library_write' | 'brief_read' | 'brief_write' | 'context_read', args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) accountDatabaseError(error);
    return data as unknown;
  }
  async projectRpc(name: 'project_read' | 'project_write', args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) projectDatabaseError(error);
    return data as unknown;
  }
  async lookupIdempotency(context: IdempotencyContext) {
    const { data, error } = await this.client.from('idempotency_records').select('fingerprint,response')
      .eq('operation', context.operation).eq('key_hash', context.keyHash).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (error) databaseError(error);
    if (!data) return null;
    const record = z.object({ fingerprint: z.string(), response: z.unknown() }).parse(data);
    return { fingerprint: record.fingerprint, response: record.response };
  }
  async commitIdempotency(context: IdempotencyContext, write: DurableWrite, response: unknown) {
    const { data, error } = await this.client.rpc('commit_idempotent_creation', {
      p_operation: context.operation, p_key_hash: context.keyHash, p_fingerprint: context.fingerprint,
      p_kind: write.kind, p_row: write.row, p_response: response,
    });
    if (error?.code === 'P8001') throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'The idempotency key was used for a different request');
    if (error) databaseError(error);
    return data as unknown;
  }
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
  // SDK retry backoff can outlive a transport deadline; let callers retry explicitly.
  const options = { db: { retry: false }, auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }, global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(env.UPSTREAM_TIMEOUT_MS)]) : AbortSignal.timeout(env.UPSTREAM_TIMEOUT_MS), redirect: 'error' }),
  } };
  const authClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, options);
  return {
    async ready() {
      const { error } = await authClient.from('rate_table_versions').select('id').limit(1)
        .abortSignal(AbortSignal.timeout(env.READINESS_TIMEOUT_MS));
      if (error) databaseError(error);
    },
    async authenticate(token) {
      const { data, error } = await authClient.auth.getUser(token);
      if (error && (error.status === undefined || error.status === 0 || error.status >= 500)) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable');
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
