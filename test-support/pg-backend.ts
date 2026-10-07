import { conversationDatabaseError } from '../apps/api/src/lib/conversation-repository.js';
import { workflowDatabaseError } from '../apps/api/src/lib/workflow-repository.js';
import { costDatabaseError } from '../apps/api/src/lib/cost-repository.js';
import { constructionDatabaseError } from '../apps/api/src/lib/construction-repository.js';
import { takeoffDatabaseError } from '../apps/api/src/lib/takeoff-repository.js';
import { structuralDatabaseError } from '../apps/api/src/lib/structural-repository.js';
import { environmentalDatabaseError } from '../apps/api/src/lib/environmental-repository.js';
import { systemsDatabaseError } from '../apps/api/src/lib/systems-repository.js';
import type { Pool } from 'pg';
import { z } from 'zod';
import { projectDatabaseError } from '../apps/api/src/lib/project-repository.js';
import { asPrincipal } from './postgres.js';
import { ApiError, databaseError } from '../apps/api/src/lib/errors.js';
import { PlanRecordSchema, RateEntrySchema, RateVersionSchema, type Backend, type Repository } from '../apps/api/src/lib/repository.js';

/** Test-only transport. Real PostgreSQL evaluates every query under actual RLS roles.
 * Supabase Auth/HTTP are covered separately by the local Supabase acceptance suite. */
export function createPgBackend(pool: Pool, sessions: Record<string, string>): Backend {
  return {
    async ready() { await pool.query('select 1'); },
    async authenticate(token) {
      const id = sessions[token];
      if (!id) throw new ApiError(401, 'UNAUTHORIZED', 'A valid Supabase session is required');
      return { id };
    },
    repository(token): Repository {
      const userId = token ? sessions[token] ?? null : null;
      const query = async (sql: string, values: unknown[] = []) => {
        try { return await asPrincipal(pool, userId, client => client.query(sql, values)); }
        catch (error) { databaseError(typeof error === 'object' && error !== null && 'code' in error ? { code: String(error.code) } : {}); }
      };
      return {
        async conversationRpc(name, args) {
          const keys = name === 'conversation_write' ? ['p_action','p_input','p_envelope','p_signature'] : ['p_action','p_input'];
          const values = keys.map(key => args[key] ?? null);
          try {
            const result = await asPrincipal(pool, userId, client => client.query(
              `select public.${name}(${values.map((_, i) => `$${i+1}`).join(',')}) response`,
              values.map(value => value !== null && typeof value === 'object' ? JSON.stringify(value) : value)));
            return result.rows[0].response;
          } catch (error) { conversationDatabaseError({ code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '' }); }
        },
        async workflowRpc(name, args) {
          const keys = name === 'workflow_write' ? ['p_input','p_context','p_envelope','p_signature'] : ['p_action','p_input'];
          const values = keys.map(key => args[key] ?? null);
          try {
            const result = await asPrincipal(pool, userId, client => client.query(
              `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) response`,
              values.map(value => value !== null && typeof value === 'object' ? JSON.stringify(value) : value)));
            return result.rows[0].response;
          } catch (error) {
            workflowDatabaseError({ code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '' });
          }
        },
        async costRpc(name, args) {
          const keys = name === 'cost_write' ? ['p_input','p_context','p_envelope','p_signature']
            : ['p_project_id','p_revision_id','p_cost_id','p_limit','p_cursor'];
          const values = keys.map(key => args[key] ?? (key === 'p_limit' ? 20 : null));
          try {
            const result = await asPrincipal(pool, userId, client => client.query(
              `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) response`,
              values.map(value => value !== null && typeof value === 'object' ? JSON.stringify(value) : value)));
            return result.rows[0].response;
          } catch (error) {
            costDatabaseError({ code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '' });
          }
        },
        async constructionRpc(name, args) {
          const keys = name === 'construction_write' ? ['p_input','p_context','p_envelope','p_signature']
            : ['p_project_id','p_revision_id','p_takeoff_id','p_calculation_id','p_limit','p_cursor'];
          const values = keys.map(key => args[key] ?? (key === 'p_limit' ? 20 : null));
          try {
            const result = await asPrincipal(pool, userId, client => client.query(
              `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) response`,
              values.map(value => value !== null && typeof value === 'object' ? JSON.stringify(value) : value)));
            return result.rows[0].response;
          } catch (error) {
            constructionDatabaseError({ code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '' });
          }
        },
        async takeoffRpc(name, args) {
          const keys = name === 'takeoff_write' ? ['p_input','p_context','p_envelope','p_signature']
            : ['p_project_id','p_revision_id','p_takeoff_id','p_limit','p_cursor'];
          const values = keys.map(key => args[key] ?? (key === 'p_limit' ? 20 : null));
          try {
            const result = await asPrincipal(pool, userId, client => client.query(
              `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) response`,
              values.map(value => value !== null && typeof value === 'object' ? JSON.stringify(value) : value)));
            return result.rows[0].response;
          } catch (error) {
            takeoffDatabaseError({ code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '' });
          }
        },
        async structuralRpc(name, args) {
          const keys = name === 'structural_write' ? ['p_input','p_context','p_envelope','p_signature']
            : ['p_action','p_project_id','p_revision_id','p_analysis_id','p_limit','p_cursor'];
          const values = keys.map(key => args[key] ?? (key === 'p_limit' ? 20 : null));
          try {
            const result = await asPrincipal(pool, userId, client => client.query(
              `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) response`,
              values.map(value => value !== null && typeof value === 'object' ? JSON.stringify(value) : value)));
            return result.rows[0].response;
          } catch (error) {
            structuralDatabaseError({ code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '' });
          }
        },
        async environmentalRpc(name, args) {
          const keys = name === 'environmental_write' ? ['p_input','p_context','p_envelope','p_signature']
            : ['p_action','p_project_id','p_revision_id','p_analysis_id','p_limit','p_cursor'];
          const values = keys.map(key => args[key] ?? (key === 'p_limit' ? 20 : null));
          try {
            const result = await asPrincipal(pool, userId, client => client.query(
              `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) response`,
              values.map(value => value !== null && typeof value === 'object' ? JSON.stringify(value) : value)));
            return result.rows[0].response;
          } catch (error) {
            environmentalDatabaseError({ code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '' });
          }
        },
        async systemsRpc(name, args) {
          const keys = name === 'systems_write' ? ['p_input','p_context','p_envelope','p_signature']
            : ['p_action','p_project_id','p_revision_id','p_analysis_id','p_limit','p_cursor'];
          const values = keys.map(key => args[key] ?? (key === 'p_limit' ? 20 : null));
          try {
            const result = await asPrincipal(pool, userId, client => client.query(
              `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) response`,
              values.map(value => value !== null && typeof value === 'object' ? JSON.stringify(value) : value)));
            return result.rows[0].response;
          } catch (error) {
            systemsDatabaseError({ code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '' });
          }
        },
        async projectRpc(name, args) {
          const keys = name === 'project_write' ? ['p_action','p_input','p_context','p_envelope','p_signature']
            : ['p_action','p_project_id','p_revision_id','p_limit','p_cursor'];
          const values = keys.map(key => args[key] ?? (key === 'p_limit' ? 20 : null));
          try {
            const result = await asPrincipal(pool, userId, client => client.query(
              `select public.${name}($1,$2,$3,$4,$5) response`, values.map(value => value !== null && typeof value === 'object' ? JSON.stringify(value) : value)));
            return result.rows[0].response;
          } catch (error) {
            projectDatabaseError({ code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '' });
          }
        },
        async lookupIdempotency(context) {
          const result = await query('select fingerprint,response from public.idempotency_records where operation=$1 and key_hash=$2 and expires_at > now()', [context.operation, context.keyHash]);
          return result.rows[0] ?? null;
        },
        async commitIdempotency(context, write, response) {
          try {
            const result = await asPrincipal(pool, userId, client => client.query(
              'select public.commit_idempotent_creation($1,$2,$3,$4,$5,$6) response',
              [context.operation, context.keyHash, context.fingerprint, write.kind, JSON.stringify(write.row), JSON.stringify(response)]));
            return result.rows[0].response;
          } catch (error) {
            const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
            if (code === 'P8001') throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'The idempotency key was used for a different request');
            databaseError({ code });
          }
        },
        async insertPlan(row) {
          const result = await query(`insert into public.plans (user_id,prompt,seed,variant,plan_data,qa_orthogonal,bounds_width_m,bounds_depth_m,room_count,share_token)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id,plan_data`,
          [row.user_id,row.prompt,row.seed,row.variant,JSON.stringify(row.plan_data),row.qa_orthogonal,row.bounds_width_m,row.bounds_depth_m,row.room_count,row.share_token]);
          return PlanRecordSchema.parse(result.rows[0]);
        },
        async getPlan(id) {
          const result = await query('select id,plan_data from public.plans where id=$1', [id]);
          return result.rows[0] ? PlanRecordSchema.parse(result.rows[0]) : null;
        },
        async patchPlan(id, isPublic) {
          const result = await query('update public.plans set is_public=$2 where id=$1 returning id,plan_data', [id,isPublic]);
          return result.rows[0] ? PlanRecordSchema.parse(result.rows[0]) : null;
        },
        async getRateVersions() {
          const result = await query("select id,version_label,to_char(effective_date,'YYYY-MM-DD') effective_date,to_char(created_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') created_at from public.rate_table_versions order by effective_date desc,created_at desc");
          return z.array(RateVersionSchema).parse(result.rows);
        },
        async getRateEntries(versionId) {
          const result = await query('select id,version_id,region,building_type,tier,rate_per_sqft_min,rate_per_sqft_max,category_breakdown,is_active from public.rate_table_entries where version_id=$1 and is_active', [versionId]);
          return z.array(RateEntrySchema).parse(result.rows);
        },
        async insertEstimate(row) {
          await query(`insert into public.cost_estimates (plan_id,user_id,location,building_type,built_up_area_sqft,floors,budget_provided,rate_table_version,tier_basic,tier_standard,tier_premium,soil_note)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [row.plan_id,row.user_id,row.location,row.building_type,row.built_up_area_sqft,row.floors,row.budget_provided,row.rate_table_version,JSON.stringify(row.tier_basic),JSON.stringify(row.tier_standard),JSON.stringify(row.tier_premium),row.soil_note]);
        },
      };
    },
  };
}
