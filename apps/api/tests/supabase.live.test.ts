import { bimAcceptance } from '../../../test-support/bim-acceptance.js';
import { structuralAcceptance } from '../../../test-support/structural-acceptance.js';
import { parametricAcceptance } from '../../../test-support/parametric-acceptance.js';
import { conversationAcceptance } from '../../../test-support/conversation-acceptance.js';
import { solverV2Acceptance } from '../../../test-support/solver-v2-acceptance.js';
import { interpretationAcceptance } from '../../../test-support/interpretation-acceptance.js';
import { freshnessAcceptance } from '../../../test-support/freshness-acceptance.js';
import { workflowAcceptance,workflowSetup,workflowPayload } from '../../../test-support/workflow-acceptance.js';
import { watchSupabaseFailures } from '../../../test-support/supabase-failure-evidence.js';
import { costAcceptance,costSetup } from '../../../test-support/cost-acceptance.js';
import { constructionAcceptance } from '../../../test-support/construction-acceptance.js';
import { takeoffAcceptance } from '../../../test-support/takeoff-acceptance.js';
import { projectAcceptance } from '../../../test-support/project-acceptance.js';
import { requirements } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ApiErrorResponseSchema,
  CreatePlanResponseSchema,
  EstimateResponseSchema,
  GetPlanResponseSchema,
  PatchPlanResponseSchema,
  RegionsResponseSchema,
  TierEstimateSchema,
} from '@designflow/shared';
import { generatePlan, parseRequirements } from '@designflow/generator';
import { buildApp } from '../src/app.js';
import { parseEnv, type Env } from '../src/config/env.js';
import { DISCLAIMER, SOIL_DISCLAIMER } from '../src/content/disclaimers.js';
import { fixtureEstimate, fixturePlan } from '../../../test-support/fixtures.js';

// Opt-in acceptance suite: npm run test:supabase. This uses actual local Auth,
// PostgREST, triggers and RLS; no alternate Backend or mocked fetch is installed.
// All administrative mutations are restricted to users created by this suite.
function localEnvironment(): Env {
  const dotenv = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(dotenv)) process.loadEnvFile(dotenv);
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
  const missing = required.filter(name => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Local Supabase acceptance requires ${missing.join(', ')}. Start and reset the local Supabase stack, then configure its keys in the project .env or environment. This suite does not skip missing configuration.`);
  }
  const env = parseEnv({ ...process.env, NODE_ENV: 'test', RATE_LIMIT_ENABLED: 'false', LOG_LEVEL: 'silent' });
  const url = new URL(env.SUPABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Local Supabase acceptance only permits a localhost or 127.0.0.1 Supabase URL without credentials, a path or query. Remote projects are refused before any requests or mutations.');
  }
  return env;
}

function localClient(env: Env, serviceRole = false): SupabaseClient {
  return createClient(env.SUPABASE_URL, serviceRole ? process.env['SUPABASE_SERVICE_ROLE_KEY']! : env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error' }),
    },
  });
}

type Principal = { client: SupabaseClient; id: string; headers: { authorization: string } };
type HttpResponse = { statusCode: number; json(): unknown; headers: Record<string, unknown>; body: string };

function expectFailure(response: HttpResponse, statusCode: number) {
  expect(response.statusCode).toBe(statusCode);
  const body = ApiErrorResponseSchema.parse(response.json());
  expect(body.error.requestId).toBe(response.headers['x-request-id']);
  expect(response.body).not.toContain('stack');
  expect(response.body).not.toContain('share_token');
  return body;
}

describe('local Supabase anonymous ownership and full persistence flow', () => {
  let app: ReturnType<typeof buildApp> | undefined;
  let admin: SupabaseClient | undefined;
  let owner: Principal | undefined;
  let other: Principal | undefined;
  let publicClient: SupabaseClient | undefined;
  const createdUserIds: string[] = [];
  let failureWatch: ReturnType<typeof watchSupabaseFailures> | undefined;

  async function anonymousPrincipal(env: Env): Promise<Principal> {
    const client = localClient(env);
    const { data, error } = await client.auth.signInAnonymously();
    // Track a created identity even if a later assertion fails, so afterAll can remove it.
    if (data.user?.id) createdUserIds.push(data.user.id);
    if (error || !data.user || !data.session) {
      throw new Error('Local Supabase anonymous sign-in failed. Verify the local stack is running and auth.enable_anonymous_sign_ins is enabled.');
    }
    expect(data.user.is_anonymous).toBe(true);
    const id = z.string().uuid().parse(data.user.id);
    return { client, id, headers: { authorization: `Bearer ${data.session.access_token}` } };
  }

  beforeAll(async () => {
    const env = localEnvironment();
    failureWatch = watchSupabaseFailures(process.env.SUPABASE_EVIDENCE_DIRECTORY);
    admin = localClient(env, true);
    publicClient = localClient(env);
    owner = await anonymousPrincipal(env);
    other = await anonymousPrincipal(env);
    expect(owner.id).not.toBe(other.id);
    app = buildApp({ env, captureError: (_error,requestId,code,metadata) => failureWatch?.apiError(requestId,code,metadata) });
    await app.ready();
  });

  afterAll(async () => {
    const failures: string[] = [];
    try { await app?.close(); } catch { failures.push('close API'); }
    if (admin && createdUserIds.length > 0) {
      // Delete data before Auth users, since ownership FKs otherwise become null.
      // Removing plans also removes their generation logs via ON DELETE CASCADE.
      // Immutable takeoff history intentionally survives account deletion. Keep
      // only those test projects; local db reset purges the disposable test stack.
      const protectedRows = await admin.from('project_revision_takeoffs').select('project_revisions!inner(project_id)');
      if (protectedRows.error) failures.push('read protected takeoff projects');
      const workflowRows = await admin.from('project_workflow_runs').select('project_id');
      if (workflowRows.error) failures.push('read protected workflow projects');
      const protectedIds = new Set((protectedRows.data ?? []).flatMap(row => {
        const revisions = row.project_revisions;
        return (Array.isArray(revisions) ? revisions : [revisions]).map(r => r.project_id);
      }));
      for (const row of workflowRows.data ?? []) protectedIds.add(row.project_id);
      // Immutable Phase 24 structural snapshots are protected history in the same way.
      const structuralRows = await admin.from('project_revision_structural_analyses').select('project_revisions!inner(project_id)');
      if (structuralRows.error) failures.push('read protected structural projects');
      for (const row of structuralRows.data ?? []) for (const r of Array.isArray(row.project_revisions) ? row.project_revisions : [row.project_revisions]) protectedIds.add(r.project_id);
      const owned = await admin.from('projects').select('id').in('owner_id',createdUserIds);
      if (owned.error) failures.push('read test projects');
      const deletable = (owned.data ?? []).map(p => p.id).filter(id => !protectedIds.has(id));
      if (deletable.length) {
        const projectsCleanup = await admin.from('projects').delete().in('id',deletable);
        if (projectsCleanup.error) failures.push('delete test projects');
      }
      for (const table of ['cost_estimates', 'plans'] as const) {
        try {
          const { error } = await admin.from(table).delete().in('user_id', createdUserIds);
          if (error) failures.push(`delete test ${table}`);
        } catch { failures.push(`delete test ${table}`); }
      }
      for (const id of createdUserIds) {
        try {
          const { error } = await admin.auth.admin.deleteUser(id);
          if (error) failures.push(`delete test identity ${id}`);
        } catch { failures.push(`delete test identity ${id}`); }
      }
    }
    await failureWatch?.close();
    if (failures.length > 0) throw new Error(`Local Supabase acceptance cleanup failed: ${failures.join('; ')}`);
  });

  it('atomically replays concurrent durable operations through actual PostgREST and JWTs', async () => {
    if (!app || !admin || !owner || !other) throw new Error('Local setup incomplete');
    for (const [url, payload, status] of [
      ['/api/plans', { plan: fixturePlan() }, 201],
      ['/api/plans/generate', { prompt: '2BHK with open kitchen', seed: 'phase8-live' }, 201],
      ['/api/estimates', fixtureEstimate(), 200],
    ] as const) {
      const headers = { ...owner.headers, 'idempotency-key': `live-${status}-${url.replaceAll('/', '-')}` };
      const responses = await Promise.all(Array.from({ length: 4 }, () => app!.inject({ method: 'POST', url, headers, payload })));
      for (const response of responses) { expect(response.statusCode).toBe(status); expect(response.json()).toEqual(responses[0]!.json()); }
      const receipts = await owner.client.from('idempotency_records').select('response').eq('operation', url);
      expect(receipts.error).toBeNull(); expect(receipts.data).toHaveLength(1);
      const hidden = await other.client.from('idempotency_records').select('response').eq('user_id', owner.id);
      expect(hidden.error).toBeNull(); expect(hidden.data).toEqual([]);
      const isolated = await app.inject({ method: 'POST', url, headers: { ...other.headers, 'idempotency-key': headers['idempotency-key'] }, payload });
      expect(isolated.statusCode).toBe(status);
      if (status === 201) {
        const created = responses[0]!.json();
        expect(isolated.json().plan.id).not.toBe(created.plan.id);
        expect(isolated.json().shareToken).not.toBe(created.shareToken);
        const audit = await admin.from('generation_logs').select('id').eq('plan_id', created.plan.id);
        expect(audit.error).toBeNull(); expect(audit.data).toHaveLength(1);
      }
      const changed = url === '/api/plans' ? { plan: { ...fixturePlan(), seed: 'different' } }
        : url === '/api/plans/generate' ? { prompt: '1BHK', seed: 'different' } : { ...fixtureEstimate(), floors: 3 };
      expect((await app.inject({ method: 'POST', url, headers, payload: changed })).statusCode).toBe(409);
    }
    expect((await app.inject('/health/live')).statusCode).toBe(200);
    expect((await app.inject('/health/ready')).statusCode).toBe(200);
  });

  it.each(['client-save', 'structured-generation', 'prompt-generation'] as const)('saves, audits, retrieves, shares, estimates and revokes using real anonymous sessions: %s', async mode => {
    if (!app || !admin || !owner || !other || !publicClient) throw new Error('Local Supabase acceptance setup did not complete');
    const profiles = await admin.from('profiles').select('id').in('id', [owner.id, other.id]);
    expect(profiles.error).toBeNull();
    expect(z.array(z.object({ id: z.string().uuid() })).parse(profiles.data).map(row => row.id).sort()).toEqual([owner.id, other.id].sort());

    const prompt = '2BHK with open kitchen';
    const requirements = parseRequirements(prompt);
    const seed = 'phase7-live';
    const plan = mode === 'client-save' ? fixturePlan() : generatePlan(requirements, { seed });
    const payload = mode === 'client-save' ? { plan: { ...plan, user_id: other.id, is_public: true } }
      : mode === 'structured-generation' ? { requirements, seed } : { prompt, seed };
    const url = mode === 'client-save' ? '/api/plans' : '/api/plans/generate';
    if (mode !== 'client-save') {
      const spoofed = await app.inject({ method: 'POST', url, headers: owner.headers, payload: { ...payload, user_id: other.id } });
      expect(expectFailure(spoofed, 400).error.code).toBe('VALIDATION_ERROR');
      expect(expectFailure(await app.inject({ method: 'POST', url, payload }), 401).error.code).toBe('UNAUTHORIZED');
    }
    const creation = await app.inject({ method: 'POST', url, headers: owner.headers, payload });
    expect(creation.statusCode).toBe(201);
    const created = CreatePlanResponseSchema.parse(creation.json());
    expect(created.shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const planId = created.plan.id;

    const stored = await admin.from('plans').select('id,user_id,is_public,share_token,plan_data').eq('id', planId).single();
    expect(stored.error).toBeNull();
    expect(stored.data).toEqual({ id: planId, user_id: owner.id, is_public: false, share_token: created.shareToken, plan_data: plan });
    const audit = await admin.from('generation_logs').select('plan_id,event_type,detail').eq('plan_id', planId);
    expect(audit.error).toBeNull();
    expect(audit.data).toEqual([{ plan_id: planId, event_type: 'generated', detail: { variant: plan.variant, roomCount: plan.rooms.length } }]);

    const retrieved = await app.inject({ method: 'GET', url: `/api/plans/${planId}`, headers: owner.headers });
    expect(retrieved.statusCode).toBe(200);
    expect(GetPlanResponseSchema.parse(retrieved.json()).plan).toEqual(created.plan);
    expect(retrieved.body).not.toContain(created.shareToken);
    for (const headers of [other.headers, {}]) {
      const privateResponse = await app.inject({ method: 'GET', url: `/api/plans/${planId}`, headers });
      expect(expectFailure(privateResponse, 404).error.code).toBe('NOT_FOUND');
    }
    const inaccessibleEstimate = await app.inject({ method: 'POST', url: '/api/estimates', headers: other.headers,
      payload: { ...fixtureEstimate(), planId },
    });
    expect(expectFailure(inaccessibleEstimate, 404).error.code).toBe('NOT_FOUND');

    const shared = await app.inject({ method: 'PATCH', url: `/api/plans/${planId}`, headers: owner.headers, payload: { isPublic: true } });
    expect(shared.statusCode).toBe(200);
    expect(PatchPlanResponseSchema.parse(shared.json()).plan).toEqual(created.plan);
    expect(shared.body).not.toContain(created.shareToken);
    for (const headers of [other.headers, {}]) {
      const visible = await app.inject({ method: 'GET', url: `/api/plans/${planId}`, headers });
      expect(visible.statusCode).toBe(200);
      expect(GetPlanResponseSchema.parse(visible.json()).plan).toEqual(created.plan);
      expect(visible.body).not.toContain(created.shareToken);
    }
    const forbiddenPatch = await app.inject({ method: 'PATCH', url: `/api/plans/${planId}`, headers: other.headers, payload: { isPublic: false } });
    expect(expectFailure(forbiddenPatch, 404).error.code).toBe('NOT_FOUND');

    for (const principal of [owner, other]) {
      const estimated = await app.inject({ method: 'POST', url: '/api/estimates', headers: principal.headers,
        payload: { ...fixtureEstimate(), planId },
      });
      expect(estimated.statusCode).toBe(200);
      const estimate = EstimateResponseSchema.parse(estimated.json());
      expect(estimate.disclaimer).toBe(DISCLAIMER);
      expect(estimate.soilDisclaimer).toBe(SOIL_DISCLAIMER);
      expect(estimate.tiers.map(tier => tier.tier)).toEqual(['basic', 'standard', 'premium']);
      expect(estimate.tiers.every(tier => tier.rangeMin < tier.rangeMax)).toBe(true);
      const persisted = await principal.client.from('cost_estimates')
        .select('user_id,plan_id,budget_provided,rate_table_version,tier_basic').eq('plan_id', planId);
      expect(persisted.error).toBeNull();
      const rows = z.array(z.object({
        user_id: z.string().uuid(), plan_id: z.string().uuid(), budget_provided: z.number(),
        rate_table_version: z.string().uuid(), tier_basic: TierEstimateSchema,
      })).parse(persisted.data);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: principal.id, plan_id: planId, budget_provided: fixtureEstimate().budget, tier_basic: estimate.tiers[0] });
    }
    // Once both users have estimates on a public plan, neither can read the other's.
    for (const [principal, forbiddenId] of [[owner, other.id], [other, owner.id]] as const) {
      const isolated = await principal.client.from('cost_estimates').select('id').eq('plan_id', planId).eq('user_id', forbiddenId);
      expect(isolated.error).toBeNull();
      expect(isolated.data).toEqual([]);
    }
    const estimates = await admin.from('cost_estimates').select('user_id,rate_table_version').eq('plan_id', planId);
    expect(estimates.error).toBeNull();
    const estimateRows = z.array(z.object({ user_id: z.string().uuid(), rate_table_version: z.string().uuid() })).parse(estimates.data);
    expect(estimateRows.map(row => row.user_id).sort()).toEqual([owner.id, other.id].sort());
    expect(new Set(estimateRows.map(row => row.rate_table_version)).size).toBe(1);

    const regionsResponse = await app.inject({ method: 'GET', url: '/api/regions' });
    expect(regionsResponse.statusCode).toBe(200);
    const regions = RegionsResponseSchema.parse(regionsResponse.json());
    expect(regions.regions.some(region => region.isBaseline && region.buildingTypes.includes('residential'))).toBe(true);

    // Column privileges must protect tokens even when a caller bypasses the API.
    for (const client of [owner.client, other.client, publicClient]) {
      const tokenRead = await client.from('plans').select('share_token').eq('id', planId);
      expect(tokenRead.error?.code).toBe('42501');
      expect(tokenRead.data).toBeNull();
      expect(JSON.stringify(tokenRead)).not.toContain(created.shareToken);
    }
    const auditRead = await other.client.from('generation_logs').select('id').eq('plan_id', planId);
    expect(auditRead.error?.code).toBe('42501');
    expect(auditRead.data).toBeNull();

    const revoked = await app.inject({ method: 'PATCH', url: `/api/plans/${planId}`, headers: owner.headers, payload: { isPublic: false } });
    expect(revoked.statusCode).toBe(200);
    expect(PatchPlanResponseSchema.parse(revoked.json()).plan).toEqual(created.plan);
    for (const headers of [other.headers, {}]) {
      const privateAgain = await app.inject({ method: 'GET', url: `/api/plans/${planId}?share_token=${created.shareToken}`, headers });
      expect(expectFailure(privateAgain, 404).error.code).toBe('NOT_FOUND');
      expect(privateAgain.body).not.toContain(created.shareToken);
    }
  }, 60_000);
  takeoffAcceptance(() => {
    if (!app || !owner || !other) throw new Error('Local setup incomplete');
    return { app, owner: owner.headers, other: other.headers };
  });
  workflowAcceptance(() => {
    if (!app || !owner || !other) throw new Error('Local workflow setup incomplete');
    return {app,owner:owner.headers,other:other.headers};
  });
  it('protects workflow rows and signed RPCs through actual JWT and PostgREST',async()=>{
    if(!app || !owner || !other || !publicClient)throw new Error('Local workflow setup incomplete');
    const f=await workflowSetup({app,owner:owner.headers,other:other.headers});
    const r=await app.inject({method:'POST',url:f.url,headers:owner.headers,payload:workflowPayload('BLUEPRINT_ONLY')});expect(r.statusCode,r.body).toBe(201);
    const own=await owner.client.from('project_workflow_runs').select('id').eq('id',r.json().id);expect(own.error).toBeNull();expect(own.data).toHaveLength(1);
    const hidden=await other.client.from('project_workflow_runs').select('id').eq('id',r.json().id);expect(hidden.error).toBeNull();expect(hidden.data).toEqual([]);
    expect((await publicClient.from('project_workflow_runs').select('id')).error?.code).toBe('42501');
    expect((await owner.client.from('project_workflow_runs').insert({project_id:f.projectId})).error?.code).toBe('42501');
    expect((await owner.client.from('project_workflow_runs').update({status:'COMPLETED'}).eq('id',r.json().id)).error?.code).toBe('42501');
    expect((await owner.client.from('project_workflow_runs').delete().eq('id',r.json().id)).error?.code).toBe('42501');
    expect((await owner.client.rpc('workflow_write',{p_input:{action:'begin',projectId:f.projectId}})).error?.code).toBe('42501');
    expect((await owner.client.rpc('workflow_write',{p_input:{action:'finish',projectId:f.projectId,outputs:[]},p_envelope:'{}',p_signature:'a'.repeat(64)})).error?.code).toBe('42501');
    expect((await other.client.rpc('workflow_read',{p_action:'get',p_input:{projectId:f.projectId,runId:r.json().id}})).error?.code).toBe('P1201');
  });
  costAcceptance(() => {
    if (!app || !owner || !other) throw new Error('Local cost setup incomplete');
    return { app, owner: owner.headers, other: other.headers };
  });

  it('protects immutable costs through direct SDK and PostgREST without service-role bypass', async () => {
    if (!app || !owner || !other || !publicClient) throw new Error('Local cost setup incomplete');
    const f = await costSetup({ app, owner: owner.headers, other: other.headers });
    const created = await app.inject({ method: 'POST', url: f.url, headers: owner.headers, payload: f.payload });
    expect(created.statusCode, created.body).toBe(201); const dto = created.json();
    const own = await owner.client.from('project_revision_cost_estimates').select('report_json').eq('id',dto.id).single();
    expect(own.error).toBeNull(); expect(own.data?.report_json).toEqual(dto.report);
    const hidden = await other.client.from('project_revision_cost_estimates').select('id').eq('id',dto.id);
    expect(hidden.error).toBeNull(); expect(hidden.data).toEqual([]);
    expect((await publicClient.from('project_revision_cost_estimates').select('id')).error?.code).toBe('42501');
    expect((await owner.client.from('project_revision_cost_estimates').insert({report_json:dto.report})).error?.code).toBe('42501');
    expect((await owner.client.from('project_revision_cost_estimates').update({report_json:{}}).eq('id',dto.id)).error?.code).toBe('42501');
    expect((await owner.client.from('project_revision_cost_estimates').delete().eq('id',dto.id)).error?.code).toBe('42501');
    for (const client of [owner.client,other.client]) {
      expect((await client.rpc('cost_write',{p_input:{projectId:f.projectId,report:dto.report}})).error?.code).toBe('42501');
      expect((await client.rpc('cost_write',{p_input:{projectId:f.projectId,report:{...dto.report,rateBookHash:'0'.repeat(64)}},p_envelope:'{}',p_signature:'a'.repeat(64)})).error?.code).toBe('42501');
    }
    expect((await other.client.rpc('cost_read',{p_project_id:f.projectId,p_revision_id:f.revision.id,p_cost_id:dto.id})).error?.code).toBe('P1201');
  });

  constructionAcceptance(() => {
    if (!app || !owner || !other) throw new Error('Local setup incomplete');
    return { app, owner: owner.headers, other: other.headers };
  });

  it('protects immutable takeoffs through direct SDK and PostgREST calls', async () => {
    if (!app || !owner || !other || !publicClient) throw new Error('Local setup incomplete');
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner.headers, payload: { title: 'SDK takeoff security' } });
    const saved = await app.inject({ method: 'POST', url: `/api/projects/${p.json().id}/revisions/generate`, headers: owner.headers, payload: { requirements: requirements() } });
    expect(saved.statusCode, saved.body).toBe(201);
    const revision = saved.json().revision;
    const created = await app.inject({ method: 'POST', url: `/api/projects/${p.json().id}/revisions/${revision.id}/takeoffs`, headers: owner.headers, payload: {} });
    expect(created.statusCode, created.body).toBe(201); const dto = created.json();
    const own = await owner.client.from('project_revision_takeoffs').select('report_json').eq('id',dto.id).single();
    expect(own.error).toBeNull(); expect(own.data?.report_json).toEqual(dto.report);
    const hidden = await other.client.from('project_revision_takeoffs').select('id').eq('id',dto.id); expect(hidden.error).toBeNull(); expect(hidden.data).toEqual([]);
    expect((await publicClient.from('project_revision_takeoffs').select('id').eq('id',dto.id)).error).not.toBeNull();
    expect((await owner.client.from('project_revision_takeoffs').update({report_json:{}}).eq('id',dto.id)).error).not.toBeNull();
    expect((await owner.client.from('project_revision_takeoffs').delete().eq('id',dto.id)).error).not.toBeNull();
    expect((await owner.client.from('project_revision_takeoffs').insert({project_revision_id:revision.id,report_json:dto.report})).error).not.toBeNull();
    for (const client of [owner.client,other.client]) {
      expect((await client.rpc('takeoff_write',{p_input:{projectId:p.json().id,projectRevisionId:revision.id,report:dto.report}})).error).not.toBeNull();
    }
    expect((await other.client.rpc('takeoff_read',{p_project_id:p.json().id,p_revision_id:revision.id,p_takeoff_id:dto.id})).error).not.toBeNull();
  });

  solverV2Acceptance(() => {
    if (!app || !owner || !other) throw new Error('Local Phase 19 setup incomplete');
    return { app, owner: owner.headers, other: other.headers };
  }, process.env.PHASE19_SUPABASE_EVIDENCE_DIR);
  it('Phase 20 actual JWT clients cannot write conversation state or forge approval RPCs', async () => {
    const unauthenticated = await publicClient!.from('architectural_conversations').select('id');
    expect(unauthenticated.error).not.toBeNull();
    const direct = await owner!.client.from('architectural_conversations').update({ state: { status: 'SUBMITTED' } }).eq('owner_id', owner!.id);
    expect(direct.error).not.toBeNull();
    const forged = await owner!.client.rpc('conversation_write', { p_action: 'submit', p_input: {}, p_envelope: null, p_signature: null });
    expect(forged.error).not.toBeNull();
    const foreign = await other!.client.from('architectural_conversations').select('id').eq('owner_id', owner!.id);
    expect(foreign.error).toBeNull(); expect(foreign.data).toEqual([]);
  });
  parametricAcceptance(() => ({ app: app!, owner: owner!.headers, other: other!.headers }));
  conversationAcceptance(() => ({ app: app!, owner: owner!.headers, other: other!.headers }), process.env.PHASE20_SUPABASE_EXAMPLE_PATH);
  interpretationAcceptance(() => {
    if (!app || !owner || !other) throw new Error('Acceptance setup incomplete');
    return { app, owner: owner.headers, other: other.headers };
  });
  freshnessAcceptance(() => {
    if (!app || !owner || !other) throw new Error('Local project setup incomplete');
    return { app, owner: owner.headers, other: other.headers };
  });
  bimAcceptance(() => {
    if (!app || !owner || !other) throw new Error('Local BIM setup incomplete');
    return { app, owner: owner.headers, other: other.headers };
  });
  structuralAcceptance(() => {
    if (!app || !owner || !other) throw new Error('Local structural setup incomplete');
    return { app, owner: owner.headers, other: other.headers };
  });
  projectAcceptance(() => {
    if (!app || !owner || !other) throw new Error('Local project setup incomplete');
    return { app, owner: owner.headers, other: other.headers };
  });

  it('enforces V2 direct SDK RLS, blocks QA forgery and exposes only public current through its RPC', async () => {
    if (!app || !owner || !other || !publicClient || !admin) throw new Error('Local setup incomplete');
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner.headers, payload: { title: 'Direct SDK security' } });
    expect(p.statusCode, p.body).toBe(201); const id = p.json().id;
    const generated = await app.inject({ method: 'POST', url: `/api/projects/${id}/revisions/generate`, headers: owner.headers, payload: { requirements: requirements() } });
    expect(generated.statusCode, generated.body).toBe(201); const r1 = generated.json().revision;
    const saved = await app.inject({ method: 'POST', url: `/api/projects/${id}/revisions`, headers: owner.headers, payload: { model: r1.model, baseRevisionId: r1.id } });
    expect(saved.statusCode, saved.body).toBe(201); const r2 = saved.json().revision;
    for (const visibility of ['PRIVATE', 'PUBLIC']) {
      expect((await app.inject({ method: 'PATCH', url: `/api/projects/${id}`, headers: owner.headers, payload: { visibility } })).statusCode).toBe(200);
      const targets: [string, string, string][] = [['projects', 'id', id], ['project_revisions', 'project_id', id], ['project_revision_qa_runs', 'revision_id', r1.id]];
      for (const [table, field, value] of targets) {
        const allowed = await owner.client.from(table!).select('*').eq(field!, value);
        expect(allowed.error).toBeNull(); expect(allowed.data!.length).toBeGreaterThan(0);
        const denied = await other.client.from(table!).select('*').eq(field!, value);
        expect(denied.error).toBeNull(); expect(denied.data).toEqual([]);
        const anon = await publicClient.from(table!).select('*').eq(field!, value);
        expect(anon.error?.code).toBe('42501');
      }
      const publicRead = await publicClient.rpc('project_read', { p_action: 'public', p_project_id: id });
      if (visibility === 'PRIVATE') expect(publicRead.error?.code).toBe('P1201');
      else { expect(publicRead.error).toBeNull(); expect(publicRead.data.currentRevision.id).toBe(r2.id); expect(JSON.stringify(publicRead.data)).not.toContain(r1.id); }
      const history = await other.client.rpc('project_read', { p_action: 'history', p_project_id: id });
      expect(history.error?.code).toBe('P1201');
    }
    for (const [table, patch] of [['projects', { current_revision_id: r1.id }], ['project_revisions', { model_json: {} }], ['project_revision_qa_runs', { status: 'PASS' }]] as const) {
      const changed = await owner.client.from(table).update(patch).eq('id', table === 'projects' ? id : table === 'project_revisions' ? r1.id : r1.qa.id);
      expect(changed.error?.code).toBe('42501');
    }
    const forged = await owner.client.rpc('project_write', { p_action: 'revision', p_input: { projectId: id, sourceMode: 'supplied', model: r1.model, report: r1.qaRuns[0].report } });
    expect(forged.error?.code).toBe('42501');
    const audit = await owner.client.from('project_audit_events').select('*').eq('project_id', id);
    expect(audit.error?.code).toBe('42501');
    const evidence = await admin.from('project_audit_events').select('event_type,detail').eq('project_id', id);
    expect(evidence.error).toBeNull(); expect(evidence.data!.filter(e => e.event_type === 'revision_committed')).toHaveLength(2);
    expect(JSON.stringify(evidence.data)).not.toContain('model');
  });

});
