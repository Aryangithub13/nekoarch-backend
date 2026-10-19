import { bimAcceptance } from '../../../test-support/bim-acceptance.js';
import { structuralAcceptance } from '../../../test-support/structural-acceptance.js';
import { environmentalAcceptance } from '../../../test-support/environmental-acceptance.js';
import { systemsAcceptance } from '../../../test-support/systems-acceptance.js';
import { knowledgeAcceptance } from '../../../test-support/knowledge-acceptance.js';
import { optimizationAcceptance } from '../../../test-support/optimization-acceptance.js';
import { sceneAcceptance } from '../../../test-support/scene-acceptance.js';
import { revisionAcceptance } from '../../../test-support/revision-acceptance.js';
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
import { authored, generated, requirements } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { png } from '../../../test-support/reference-fixtures.js';
import { frameInput } from '../../../test-support/structural-fixtures.js';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
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
import { ProjectManifestSchema } from '../src/contracts/project-manifest.js';
import { SpecialistResultSchema, SPECIALIST_VERSION } from '../src/contracts/specialists.js';
import { CHANGE_SET_VERSION } from '../src/contracts/integration.js';
import { RevisionCollaborationSchema, WorkspaceResponseSchema } from '../src/collaboration/contracts.js';
import { DiffReportSchema, VerificationReportSchema } from '../src/verification/contracts.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { specification } from '../../../packages/construction-calculations/tests/fixtures.js';
import { sampleCostingPolicy } from '@designflow/boq-cost';
import { parseEnv, type Env } from '../src/config/env.js';
import { EXPECTED_SCHEMA_VERSION } from '../src/lib/deployment-state.js';
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
      // Scope protected reads to this run's projects: PostgREST max_rows (1000)
      // otherwise truncates them once the local stack accumulates history.
      const owned = await admin.from('projects').select('id').in('owner_id',createdUserIds);
      if (owned.error) failures.push('read test projects');
      const ownedIds = (owned.data ?? []).map(p => p.id);
      const protectedRows = await admin.from('project_revision_takeoffs').select('project_revisions!inner(project_id)').in('project_revisions.project_id', ownedIds);
      if (protectedRows.error) failures.push('read protected takeoff projects');
      const workflowRows = await admin.from('project_workflow_runs').select('project_id').in('project_id', ownedIds);
      if (workflowRows.error) failures.push('read protected workflow projects');
      const protectedIds = new Set((protectedRows.data ?? []).flatMap(row => {
        const revisions = row.project_revisions;
        return (Array.isArray(revisions) ? revisions : [revisions]).map(r => r.project_id);
      }));
      for (const row of workflowRows.data ?? []) protectedIds.add(row.project_id);
      // Immutable Phase 24 structural snapshots are protected history in the same way.
      const structuralRows = await admin.from('project_revision_structural_analyses').select('project_revisions!inner(project_id)').in('project_revisions.project_id', ownedIds);
      if (structuralRows.error) failures.push('read protected structural projects');
      for (const row of structuralRows.data ?? []) for (const r of Array.isArray(row.project_revisions) ? row.project_revisions : [row.project_revisions]) protectedIds.add(r.project_id);
      // Immutable Phase 25 environmental snapshots likewise.
      const environmentalRows = await admin.from('project_revision_environmental_analyses').select('project_revisions!inner(project_id)').in('project_revisions.project_id', ownedIds);
      if (environmentalRows.error) failures.push('read protected environmental projects');
      for (const row of environmentalRows.data ?? []) for (const r of Array.isArray(row.project_revisions) ? row.project_revisions : [row.project_revisions]) protectedIds.add(r.project_id);
      // Immutable Phase 26 building-systems snapshots likewise.
      const systemsRows = await admin.from('project_revision_building_systems_analyses').select('project_revisions!inner(project_id)').in('project_revisions.project_id', ownedIds);
      if (systemsRows.error) failures.push('read protected building-systems projects');
      for (const row of systemsRows.data ?? []) for (const r of Array.isArray(row.project_revisions) ? row.project_revisions : [row.project_revisions]) protectedIds.add(r.project_id);
      // Immutable Phase 27 knowledge snapshots likewise.
      const knowledgeRows = await admin.from('project_revision_specialized_knowledge_analyses').select('project_revisions!inner(project_id)').in('project_revisions.project_id', ownedIds);
      if (knowledgeRows.error) failures.push('read protected knowledge projects');
      for (const row of knowledgeRows.data ?? []) for (const r of Array.isArray(row.project_revisions) ? row.project_revisions : [row.project_revisions]) protectedIds.add(r.project_id);
      // Immutable Phase 28 optimization studies likewise.
      const optimizationRows = await admin.from('project_revision_optimization_studies').select('project_revisions!inner(project_id)').in('project_revisions.project_id', ownedIds);
      if (optimizationRows.error) failures.push('read protected optimization projects');
      for (const row of optimizationRows.data ?? []) for (const r of Array.isArray(row.project_revisions) ? row.project_revisions : [row.project_revisions]) protectedIds.add(r.project_id);
      // Immutable Phase 29 scene artifacts likewise.
      const sceneRows = await admin.from('project_revision_scene_artifacts').select('project_revisions!inner(project_id)').in('project_revisions.project_id', ownedIds);
      if (sceneRows.error) failures.push('read protected scene projects');
      for (const row of sceneRows.data ?? []) for (const r of Array.isArray(row.project_revisions) ? row.project_revisions : [row.project_revisions]) protectedIds.add(r.project_id);
      // Phase 30 candidate artifacts and appearances are protected history likewise.
      const revisionOps = await admin.from('project_revision_operations').select('project_id').in('project_id', ownedIds);
      if (revisionOps.error) failures.push('read protected revision-operation projects');
      for (const row of revisionOps.data ?? []) protectedIds.add(row.project_id);
      // Phase 36 consent records are immutable evidence likewise.
      const computeRows = await admin.from('project_compute_dispatches').select('project_id').in('project_id', ownedIds);
      if (computeRows.error) failures.push('read protected compute-dispatch projects');
      for (const row of computeRows.data ?? []) protectedIds.add(row.project_id);
      // B38 evidence packages (0027) and B39 design concepts (0028) are immutable history likewise.
      for (const table of ['project_revision_evidence_packages', 'project_revision_design_concepts'] as const) {
        const rows = await admin.from(table).select('project_revisions!inner(project_id)').in('project_revisions.project_id', ownedIds);
        if (rows.error) failures.push(`read protected ${table} projects`);
        for (const row of rows.data ?? []) for (const r of Array.isArray(row.project_revisions) ? row.project_revisions : [row.project_revisions]) protectedIds.add(r.project_id);
      }
      // B44 comments and reviews (0030) are immutable history likewise: a cascade from the project would hit their immutability triggers.
      // B31 references are retained as tombstones (reference_guard refuses their deletion).
      for (const table of ['project_revision_comments', 'project_revision_reviews', 'project_references'] as const) {
        const rows = await admin.from(table).select('project_id').in('project_id', ownedIds);
        if (rows.error) failures.push(`read protected ${table} projects`);
        for (const row of rows.data ?? []) protectedIds.add(row.project_id);
      }
      const deletable = ownedIds.filter(id => !protectedIds.has(id));
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
  environmentalAcceptance(() => {
    if (!app || !owner || !other) throw new Error('Local environmental setup incomplete');
    return { app, owner: owner.headers, other: other.headers };
  });
  systemsAcceptance(() => {
    if (!app || !owner || !other) throw new Error('Local building-systems setup incomplete');
    return { app, owner: owner.headers, other: other.headers };
  });
  knowledgeAcceptance(() => {
    if (!app || !owner || !other) throw new Error('Local knowledge setup incomplete');
    return { app, owner: owner.headers, other: other.headers };
  });
  optimizationAcceptance(() => {
    if (!app || !owner || !other) throw new Error('Local optimization setup incomplete');
    return { app, owner: owner.headers, other: other.headers };
  });
  sceneAcceptance(() => {
    if (!app || !owner || !other) throw new Error('Local scene setup incomplete');
    return { app, owner: owner.headers, other: other.headers };
  });
  revisionAcceptance(() => {
    if (!app || !owner || !other) throw new Error('Local revision setup incomplete');
    return { app, owner: owner.headers, other: other.headers };
  });
  projectAcceptance(() => {
    if (!app || !owner || !other) throw new Error('Local project setup incomplete');
    return { app, owner: owner.headers, other: other.headers };
  });

  it('Phase 30 direct SDK: RLS hides foreign revision operations, candidate bytes are ungranted and unsigned or purge RPCs are refused', async () => {
    if (!app || !owner || !other || !publicClient) throw new Error('Local setup incomplete');
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner.headers, payload: { title: 'Phase 30 direct SDK' } });
    expect(p.statusCode, p.body).toBe(201); const id = p.json().id;
    const a = await app.inject({ method: 'POST', url: `/api/projects/${id}/revisions/generate`, headers: owner.headers, payload: { requirements: requirements() } });
    expect(a.statusCode, a.body).toBe(201);
    const pre = await app.inject({ method: 'POST', url: `/api/projects/${id}/revision-operations`, headers: owner.headers, payload: { baseRevisionId: a.json().revision.id, request: { text: 'Make the exterior walls darker.' } } });
    expect(pre.statusCode, pre.body).toBe(201);
    const op = pre.json();
    const execute = await app.inject({ method: 'POST', url: `/api/projects/${id}/revision-operations/${op.id}/execute`, headers: owner.headers, payload: { preflightHash: op.preflightHash, consent: { acceptLocks: true, acceptQuote: true } } });
    expect(execute.statusCode, execute.body.slice(0, 500)).toBe(200);
    for (const [table, field, value] of [['project_revision_operations', 'project_id', id], ['project_revision_operation_events', 'project_id', id], ['project_revision_candidate_artifacts', 'operation_id', op.id]] as const) {
      const allowed = await owner.client.from(table).select('*').eq(field, value);
      expect(allowed.error).toBeNull(); expect(allowed.data!.length).toBeGreaterThan(0);
      const denied = await other.client.from(table).select('*').eq(field, value);
      expect(denied.error).toBeNull(); expect(denied.data).toEqual([]);
      expect((await publicClient.from(table).select('*').eq(field, value)).error?.code).toBe('42501');
    }
    expect((await owner.client.from('project_revision_candidate_blobs').select('glb')).error?.code).toBe('42501');
    expect((await owner.client.from('project_revision_operations').update({ status: 'COMMITTED' }).eq('id', op.id)).error?.code).toBe('42501');
    expect((await owner.client.from('project_revision_appearances').insert({ project_id: id })).error?.code).toBe('42501');
    expect((await owner.client.rpc('revision_operation_write', { p_action: 'approve', p_input: { operationId: op.id } })).error?.code).toBe('42501');
    expect((await owner.client.rpc('revision_operation_purge', { p_older_than: '0 seconds' })).error?.code).toBe('42501');
    const foreign = await other.client.rpc('revision_operation_read', { p_action: 'get', p_project_id: id, p_operation_id: op.id });
    expect(foreign.error).not.toBeNull(); expect(foreign.data).toBeNull();
    const after = await owner.client.from('project_revision_operations').select('status').eq('id', op.id);
    expect(after.data).toEqual([{ status: 'CANDIDATE_READY' }]);
  });

  it('Phase 36 gateway: consent-gated local job through actual JWT and PostgREST; consent records are owner-only, immutable and unforgeable', async () => {
    if (!app || !owner || !other || !publicClient) throw new Error('Local setup incomplete');
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner.headers, payload: { title: 'Phase 36 gateway' } });
    expect(p.statusCode, p.body).toBe(201); const id = p.json().id;
    const generated = await app.inject({ method: 'POST', url: `/api/projects/${id}/revisions/generate`, headers: owner.headers, payload: { requirements: requirements() } });
    expect(generated.statusCode, generated.body).toBe(201); const revisionId = generated.json().revision.id;
    const quoted = await app.inject({ method: 'POST', url: `/api/projects/${id}/compute/quotes`, headers: owner.headers, payload: { request: { kind: 'SCENE_COMPILE', revisionId } } });
    expect(quoted.statusCode, quoted.body).toBe(200);
    const quote = quoted.json();
    expect(quote).toMatchObject({ authorization: 'NOT_AUTHORIZED_UNTIL_CONSENT', placement: 'LOCAL', cost: { ceilingMinor: 0 } });
    expect((await owner.client.from('project_compute_dispatches').select('*').eq('project_id', id)).data).toEqual([]);
    const remote = await app.inject({ method: 'POST', url: `/api/projects/${id}/compute/quotes`, headers: owner.headers, payload: { request: { kind: 'SCENE_COMPILE', revisionId }, placement: 'REMOTE' } });
    expect([remote.statusCode, remote.json().error.code]).toEqual([422, 'COMPUTE_PLACEMENT_DISABLED']);
    const consent = { quote, consent: { quoteHash: quote.quoteHash, acceptQuote: true, acceptLocalExecution: true } };
    expect((await app.inject({ method: 'POST', url: `/api/projects/${id}/compute/jobs`, headers: other.headers, payload: consent })).statusCode).toBe(404);
    const accepted = await app.inject({ method: 'POST', url: `/api/projects/${id}/compute/jobs`, headers: owner.headers, payload: consent });
    expect(accepted.statusCode, accepted.body.slice(0, 500)).toBe(202);
    const jobId = accepted.json().job.id;
    const replay = await app.inject({ method: 'POST', url: `/api/projects/${id}/compute/jobs`, headers: owner.headers, payload: consent });
    expect([replay.statusCode, replay.json().replayed, replay.json().job.id]).toEqual([200, true, jobId]);
    let view: { job: { status: string }; resultCheck: { status: string }; dispatches: unknown[] } | undefined;
    for (const deadline = Date.now() + 60_000; Date.now() < deadline;) {
      const polled = await app.inject({ method: 'GET', url: `/api/projects/${id}/compute/jobs/${jobId}`, headers: owner.headers });
      expect(polled.statusCode, polled.body.slice(0, 500)).toBe(200);
      view = polled.json();
      if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(view!.job.status)) break;
      await new Promise(r => setTimeout(r, 200));
    }
    expect(view).toMatchObject({ job: { status: 'SUCCEEDED' }, resultCheck: { status: 'ACCEPTED_BY_SERVICE_VALIDATOR' }, dispatches: [expect.objectContaining({ quoteHash: quote.quoteHash })] });
    expect((await app.inject({ method: 'GET', url: `/api/projects/${id}/compute/jobs/${jobId}`, headers: other.headers })).statusCode).toBe(404);
    // Direct SDK: owner-only reads, no writes, no unsigned or foreign RPCs.
    const own = await owner.client.from('project_compute_dispatches').select('quote_hash,job_id').eq('project_id', id);
    expect(own.error).toBeNull(); expect(own.data).toEqual([{ quote_hash: quote.quoteHash, job_id: jobId }]);
    const foreignRows = await other.client.from('project_compute_dispatches').select('*').eq('project_id', id);
    expect(foreignRows.error).toBeNull(); expect(foreignRows.data).toEqual([]);
    expect((await publicClient.from('project_compute_dispatches').select('*').eq('project_id', id)).error?.code).toBe('42501');
    expect((await owner.client.from('project_compute_dispatches').update({ cost_ceiling_minor: 0 }).eq('project_id', id)).error?.code).toBe('42501');
    expect((await owner.client.from('project_compute_dispatches').delete().eq('project_id', id)).error?.code).toBe('42501');
    expect((await owner.client.from('project_compute_dispatches').insert({ quote_hash: 'a'.repeat(64) })).error?.code).toBe('42501');
    const unsigned = await owner.client.rpc('compute_write', { p_action: 'submit', p_input: { projectId: id }, p_job_call: {}, p_envelope: '{}', p_signature: 'f'.repeat(64) });
    expect(unsigned.error?.code).toBe('42501');
    expect((await other.client.rpc('compute_read', { p_action: 'job', p_project_id: id, p_job_id: jobId })).error?.code).toBe('P1201');
    expect((await publicClient.rpc('compute_read', { p_action: 'job', p_project_id: id, p_job_id: jobId })).error).not.toBeNull();
    expect((await owner.client.from('project_compute_dispatches').select('job_id').eq('project_id', id)).data).toHaveLength(1);
  }, 90_000);

  it('B39 S1 specialist envelope through actual JWT and PostgREST: Materials and Budget run through the engines, keyed retries replay, refusals and other users store nothing', async () => {
    if (!app || !owner || !other || !publicClient) throw new Error('Local setup incomplete');
    const call = (url: string, payload: Record<string, unknown>, headers: Record<string, string>) => app!.inject({ method: 'POST', url, headers, payload });
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner.headers, payload: { title: 'B39 S1 live' } });
    expect(p.statusCode, p.body).toBe(201); const id = p.json().id as string;
    const gen = await app.inject({ method: 'POST', url: `/api/projects/${id}/revisions/generate`, headers: owner.headers, payload: { requirements: parametricInput(true) } });
    expect(gen.statusCode, gen.body.slice(0, 300)).toBe(201); const base = gen.json().revision.id as string;
    const url = (module: string) => `/api/projects/${id}/specialists/${module}/requests`;
    const envelope = (operation: string, targetScopes: string[], outputConfig: Record<string, unknown>) =>
      ({ envelopeVersion: SPECIALIST_VERSION, baseRevisionId: base, operation, targetScopes, outputConfig });
    const parse = (r: { statusCode: number; body: string; json(): unknown }, status: number) => {
      expect(r.statusCode, r.body.slice(0, 400)).toBe(status); return SpecialistResultSchema.parse(r.json());
    };
    // Typed refusals and other principals store nothing.
    expect(parse(await call(url('INTERIOR'), envelope('modify', ['interior.layout'], {}), owner.headers), 200))
      .toMatchObject({ status: 'UNSUPPORTED', written: false, reasons: [{ code: 'SCOPE_EXPANSION_REQUIRED' }] });
    const matBody = envelope('recompute', ['quantities'], { specification: specification() });
    expect((await call(url('MATERIALS'), matBody, other.headers)).statusCode).toBe(404);
    expect((await call(url('MATERIALS'), matBody, {})).statusCode).toBe(401);
    expect((await owner.client.from('project_revision_takeoffs').select('id').eq('project_revision_id', base)).data).toEqual([]);
    // Materials, then a keyed replay through the Supabase receipt adapter: the same rows, no second engine run.
    const key = { ...owner.headers, 'idempotency-key': 'b39-live-materials' };
    const mat = parse(await call(url('MATERIALS'), matBody, key), 201);
    expect(mat.artifacts.map(a => [a.logicalComponentId, a.sourceRevisionId, a.freshness])).toEqual([['QUANTITY_TAKEOFF', base, 'current'], ['CONSTRUCTION_CALCULATION', base, 'current']]);
    const replay = parse(await call(url('MATERIALS'), matBody, key), 200);
    expect([replay.replayed, replay.artifacts.map(a => a.artifactId)]).toEqual([true, mat.artifacts.map(a => a.artifactId)]);
    const conflict = await call(url('MATERIALS'), { ...matBody, preserveScopes: ['cost'] }, key);
    expect([conflict.statusCode, conflict.json().error?.code]).toEqual([409, 'IDEMPOTENCY_CONFLICT']);
    // The rows are the engines' own, owner-only through RLS; another user sees none.
    expect((await owner.client.from('project_revision_takeoffs').select('id').eq('project_revision_id', base)).data).toEqual([{ id: mat.artifacts[0]!.artifactId }]);
    expect((await other.client.from('project_revision_takeoffs').select('id').eq('project_revision_id', base)).data).toEqual([]);
    // Budget on the synthetic rate book: always review; never a complete total unless fully priced; every artifact in the manifest of the same revision.
    const budget = parse(await call(url('BUDGET'), envelope('recompute', ['cost'], { takeoffId: mat.artifacts[0]!.artifactId,
      constructionCalculationId: mat.artifacts[1]!.artifactId, rateBookId: 'sample-inr-v1', costingPolicy: sampleCostingPolicy() }), owner.headers), 201);
    if (budget.details.kind !== 'BUDGET') throw new Error('unreachable');
    expect([budget.status, budget.details.rateBookSynthetic, budget.details.completeTotal === null]).toEqual(['REQUIRES_REVIEW', true, budget.details.coverage !== 'FULLY_PRICED']);
    const manifest = await app.inject({ url: `/api/projects/${id}/revisions/${base}/manifest`, headers: owner.headers });
    const m = ProjectManifestSchema.parse(manifest.json());
    for (const a of budget.artifacts) expect(m.modules.find(x => x.module === a.logicalComponentId)!.artifacts!.map(x => x.artifactId), a.logicalComponentId).toContain(a.artifactId);
    // Blueprint commits a revision; the superseded base is then a stale dependency for further specialist runs.
    const bp = parse(await call(url('BLUEPRINT'), envelope('regenerate', ['building.floor_plans'], { requirements: parametricInput(false) }), owner.headers), 201);
    expect([bp.resultRevisionId !== null, bp.jobIds, bp.details.kind === 'BLUEPRINT' && bp.details.renderJobs]).toEqual([true, [], 0]);
    expect(parse(await call(url('MATERIALS'), matBody, owner.headers), 200)).toMatchObject({ status: 'STALE_DEPENDENCY', written: false,
      reasons: [{ code: 'BASE_REVISION_SUPERSEDED' }] });
  }, 120_000);

  it('B39 S2 specialist envelope through actual JWT and PostgREST: an Exterior preflight and a Structural analysis are owner-only rows of their own engines', async () => {
    if (!app || !owner || !other || !publicClient) throw new Error('Local setup incomplete');
    const call = (url: string, payload: Record<string, unknown>, headers: Record<string, string>) => app!.inject({ method: 'POST', url, headers, payload });
    const parse = (r: { statusCode: number; body: string; json(): unknown }, status: number) => {
      expect(r.statusCode, r.body.slice(0, 400)).toBe(status); return SpecialistResultSchema.parse(r.json());
    };
    const project = async (title: string) => {
      const p = await app!.inject({ method: 'POST', url: '/api/projects', headers: owner!.headers, payload: { title } });
      expect(p.statusCode, p.body).toBe(201); return p.json().id as string;
    };
    // Exterior: a Phase 30 preflight with the envelope's structure lock; the row is the Phase 30 operation, owner-only through RLS.
    const ext = await project('B39 S2 live exterior');
    const gen = await app.inject({ method: 'POST', url: `/api/projects/${ext}/revisions/generate`, headers: owner.headers, payload: { requirements: parametricInput(true) } });
    expect(gen.statusCode, gen.body.slice(0, 300)).toBe(201);
    const extBody = { envelopeVersion: SPECIALIST_VERSION, baseRevisionId: gen.json().revision.id, operation: 'modify', targetScopes: ['exterior.facade'],
      preserveScopes: ['building.structure'], outputConfig: { appearance: { target: { kind: 'EXTERIOR_WALLS', facades: ['SOUTH'] }, finish: { presetId: 'light-stone' } } } };
    expect((await call(`/api/projects/${ext}/specialists/EXTERIOR/requests`, extBody, other.headers)).statusCode).toBe(404);
    const key = { ...owner.headers, 'idempotency-key': 'b39-live-exterior' };
    const r = parse(await call(`/api/projects/${ext}/specialists/EXTERIOR/requests`, extBody, key), 201);
    expect([r.status, r.written, r.locks.filter(l => l.origin === 'USER').map(l => l.scope)]).toEqual(['AWAITING_CONSENT', true, ['STRUCTURE']]);
    expect(parse(await call(`/api/projects/${ext}/specialists/EXTERIOR/requests`, extBody, key), 200)).toMatchObject({ replayed: true, operationId: r.operationId });
    expect((await owner.client.from('project_revision_operations').select('id,status').eq('project_id', ext)).data).toEqual([{ id: r.operationId, status: 'AWAITING_CONSENT' }]);
    expect((await other.client.from('project_revision_operations').select('id').eq('project_id', ext)).data).toEqual([]);
    // Structural: the bounded linear static analysis, always REQUIRES_REVIEW; the row is the structural engine's, owner-only through RLS.
    const st = await project('B39 S2 live structural');
    const rev = await app.inject({ method: 'POST', url: `/api/projects/${st}/revisions`, headers: owner.headers, payload: { model: authored() } });
    expect(rev.statusCode, rev.body.slice(0, 300)).toBe(201); const revision = rev.json().revision;
    const stBody = { envelopeVersion: SPECIALIST_VERSION, baseRevisionId: revision.id, operation: 'recompute', targetScopes: ['engineering.structural'],
      outputConfig: { input: frameInput(revision.model) } };
    const s = parse(await call(`/api/projects/${st}/specialists/STRUCTURAL/requests`, stBody, owner.headers), 201);
    expect([s.status, s.artifacts.map(a => [a.logicalComponentId, a.freshness])]).toEqual(['REQUIRES_REVIEW', [['STRUCTURAL_ANALYSIS', 'current']]]);
    expect((await owner.client.from('project_revision_structural_analyses').select('id').eq('project_revision_id', revision.id)).data).toEqual([{ id: s.artifacts[0]!.artifactId }]);
    expect((await other.client.from('project_revision_structural_analyses').select('id').eq('project_revision_id', revision.id)).data).toEqual([]);
    // A validated-solver request is a typed refusal that stores nothing.
    expect(parse(await call(`/api/projects/${st}/specialists/STRUCTURAL/requests`, { ...stBody, outputConfig: { analysisType: 'SEISMIC', input: {} } }, owner.headers), 200))
      .toMatchObject({ status: 'UNSUPPORTED', written: false, reasons: [{ code: 'NO_VALIDATED_SOLVER' }] });
  }, 180_000);

  it('B39 S3 Interior (0029) through actual JWT and PostgREST: a finish-only operation commits, owner-only, and the committed model differs only in finishes', async () => {
    if (!app || !owner || !other || !publicClient) throw new Error('Local setup incomplete');
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner.headers, payload: { title: 'B39 S3 live interior' } });
    expect(p.statusCode, p.body).toBe(201);
    const id = p.json().id as string, url = `/api/projects/${id}/specialists/INTERIOR/requests`;
    const rev = await app.inject({ method: 'POST', url: `/api/projects/${id}/revisions`, headers: owner.headers, payload: { model: authored() } });
    expect(rev.statusCode, rev.body.slice(0, 300)).toBe(201);
    const base = rev.json().revision;
    const body = { envelopeVersion: SPECIALIST_VERSION, baseRevisionId: base.id, operation: 'modify', targetScopes: ['interior.materials'], preserveScopes: ['building.structure'],
      outputConfig: { finishes: [{ spaceId: 'foyer', finishes: { floor: 'stone-tile' } }] } };
    expect((await app.inject({ method: 'POST', url, headers: other.headers, payload: body })).statusCode).toBe(404);
    const key = { ...owner.headers, 'idempotency-key': 'b39-live-interior' };
    const first = await app.inject({ method: 'POST', url, headers: key, payload: body });
    expect(first.statusCode, first.body.slice(0, 400)).toBe(201);
    const r = SpecialistResultSchema.parse(first.json());
    if (r.details.kind !== 'INTERIOR') throw new Error('unreachable');
    expect((await app.inject({ method: 'POST', url, headers: key, payload: body })).json()).toMatchObject({ replayed: true, operationId: r.operationId });
    const exec = await app.inject({ method: 'POST', url: r.details.next.executeHref, headers: owner.headers,
      payload: { preflightHash: r.details.preflightHash, consent: { acceptLocks: true, acceptQuote: true } } });
    expect(exec.statusCode, exec.body.slice(0, 300)).toBe(200);
    const approve = await app.inject({ method: 'POST', url: r.details.next.approveHref, headers: owner.headers,
      payload: { preflightHash: r.details.preflightHash, candidateHash: exec.json().candidateHash } });
    expect(approve.statusCode, approve.body.slice(0, 300)).toBe(201);
    const child = approve.json().commit.revision;
    expect(child.model.spaces.find((s: { id: string }) => s.id === 'foyer').finishes).toEqual({ floor: 'stone-tile' });
    expect((await owner.client.from('project_revision_operations').select('id,kind,status').eq('project_id', id)).data)
      .toEqual([{ id: r.operationId, kind: 'INTERIOR_FINISH_MODIFY', status: 'COMMITTED' }]);
    expect((await other.client.from('project_revision_operations').select('id').eq('project_id', id)).data).toEqual([]);
  }, 180_000);

  it('0027/0028 and the B37 manifest through actual JWT and PostgREST: evidence packages and design concepts are owner-only, immutable and unforgeable', async () => {
    if (!app || !owner || !other || !publicClient) throw new Error('Local setup incomplete');
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner.headers, payload: { title: 'B37 manifest, 0027 and 0028' } });
    expect(p.statusCode, p.body).toBe(201); const id = p.json().id;
    const generated = await app.inject({ method: 'POST', url: `/api/projects/${id}/revisions/generate`, headers: owner.headers, payload: { requirements: requirements() } });
    expect(generated.statusCode, generated.body).toBe(201);
    const revisionId = generated.json().revision.id as string, base = `/api/projects/${id}/revisions/${revisionId}`;
    const evidence = await app.inject({ method: 'POST', url: `${base}/evidence-packages`, headers: owner.headers, payload: {} });
    expect(evidence.statusCode, evidence.body.slice(0, 500)).toBe(201); const packageId = evidence.json().id as string;
    const concept = await app.inject({ method: 'POST', url: `${base}/design-concepts`, headers: owner.headers, payload: { scope: 'EXTERIOR', generator: 'TEMPLATE', alternatives: 1 } });
    expect(concept.statusCode, concept.body.slice(0, 500)).toBe(201); const conceptId = concept.json().id as string;
    // The B37 manifest: owner-only through real JWTs; every RPC family it reads answers through PostgREST.
    const read = await app.inject({ url: `${base}/manifest`, headers: owner.headers });
    expect(read.statusCode, read.body.slice(0, 500)).toBe(200);
    const m = ProjectManifestSchema.parse(read.json()), mod = (name: string) => m.modules.find(x => x.module === name)!;
    expect(m.identity).toMatchObject({ projectId: id, revisionId, revisionCurrency: 'CURRENT' });
    expect(mod('DESIGN_CONCEPTS')).toMatchObject({ availability: 'AVAILABLE', freshness: { state: 'current' }, artifacts: [{ artifactId: conceptId }] });
    expect([m.candidates.availability, m.lineage.status, m.lineage.operation.status, m.failedGenerations.availability, mod('APPEARANCE_VARIANT').availability])
      .toEqual(['AVAILABLE', 'ROOT', 'NONE', 'AVAILABLE', 'NOT_GENERATED']);
    expect(m.verification.nodeStates.UNVERIFIED).toBe(0);
    expect((await app.inject({ url: `${base}/manifest`, headers: other.headers })).statusCode).toBe(404);
    expect((await app.inject({ url: `${base}/manifest` })).statusCode).toBe(401);
    // Direct SDK on both tables: the owner reads its row, another user sees none, anonymous is refused, and no client writes.
    for (const [table, rowId] of [['project_revision_evidence_packages', packageId], ['project_revision_design_concepts', conceptId]] as const) {
      const own = await owner.client.from(table).select('id').eq('project_revision_id', revisionId);
      expect(own.error, table).toBeNull(); expect(own.data, table).toEqual([{ id: rowId }]);
      const foreign = await other.client.from(table).select('id').eq('project_revision_id', revisionId);
      expect(foreign.error, table).toBeNull(); expect(foreign.data, table).toEqual([]);
      expect((await publicClient.from(table).select('id').eq('project_revision_id', revisionId)).error?.code, table).toBe('42501');
      expect((await owner.client.from(table).update({ content_hash: 'a'.repeat(64) }).eq('id', rowId)).error?.code, table).toBe('42501');
      expect((await owner.client.from(table).delete().eq('id', rowId)).error?.code, table).toBe('42501');
      expect((await owner.client.from(table).insert({ project_revision_id: revisionId })).error?.code, table).toBe('42501');
    }
    // Unsigned or forged writes are refused before anything is read; foreign reads are refused as not found.
    for (const fn of ['evidence_write', 'design_concept_write'] as const) {
      expect((await owner.client.rpc(fn, { p_input: { projectId: id, revisionId }, p_envelope: '{}', p_signature: 'f'.repeat(64) })).error?.code, fn).toBe('42501');
      expect((await owner.client.rpc(fn, { p_input: { projectId: id, revisionId } })).error?.code, fn).toBe('42501');
      expect((await publicClient.rpc(fn, { p_input: {}, p_envelope: '{}', p_signature: 'f'.repeat(64) })).error, fn).not.toBeNull();
    }
    expect((await other.client.rpc('evidence_read', { p_action: 'get', p_project_id: id, p_revision_id: revisionId, p_package_id: packageId })).error?.code).toBe('P1201');
    expect((await other.client.rpc('design_concept_read', { p_action: 'get', p_project_id: id, p_revision_id: revisionId, p_concept_id: conceptId })).error?.code).toBe('P1201');
    expect((await publicClient.rpc('evidence_read', { p_action: 'list', p_project_id: id, p_revision_id: revisionId })).error).not.toBeNull();
    // Nothing above wrote: still exactly one row each, unchanged.
    for (const [table, row] of [['project_revision_evidence_packages', evidence.json()], ['project_revision_design_concepts', concept.json()]] as const) {
      const after = await owner.client.from(table).select('id,content_hash').eq('project_revision_id', revisionId);
      expect(after.data, table).toEqual([{ id: row.id, content_hash: row.contentHash }]);
    }
  }, 90_000);

  it('B34, B40 and B44 (0030) through actual JWT and PostgREST: a planned change commits, its verification and diff are owner-only, and member roles hold', async () => {
    if (!app || !owner || !other || !publicClient) throw new Error('Local setup incomplete');
    const env = localEnvironment(), reviewer = await anonymousPrincipal(env), viewer = await anonymousPrincipal(env);
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner.headers, payload: { title: 'B34 B40 B44 live' } });
    expect(p.statusCode, p.body).toBe(201); const id = p.json().id as string;
    const rev = await app.inject({ method: 'POST', url: `/api/projects/${id}/revisions`, headers: owner.headers, payload: { model: authored() } });
    expect(rev.statusCode, rev.body.slice(0, 300)).toBe(201); const base = rev.json().revision;

    // B40: preview, then execute the approved plan through the Phase 30 lifecycle; another user cannot even plan.
    const changeSet = { changeSetVersion: CHANGE_SET_VERSION, baseRevisionId: base.id, changes: [{ operation: 'modify', elementType: 'space', elementId: 'foyer',
      properties: { finishes: { floor: 'carpet' } } }] };
    const plans = `/api/projects/${id}/integration/plans`;
    expect((await app.inject({ method: 'POST', url: plans, headers: other.headers, payload: changeSet })).statusCode).toBe(404);
    const plan = await app.inject({ method: 'POST', url: plans, headers: owner.headers, payload: changeSet });
    expect(plan.statusCode, plan.body.slice(0, 400)).toBe(200); expect(plan.json().status).toBe('READY_FOR_APPROVAL');
    const run = await app.inject({ method: 'POST', url: `${plans}/execute`, headers: owner.headers,
      payload: { changeSet, planHash: plan.json().planHash, consent: { acceptPlan: true, acceptLocks: true } } });
    expect(run.statusCode, run.body.slice(0, 400)).toBe(201);
    expect(run.json()).toMatchObject({ status: 'COMPLETED', reasons: [] });
    const rev2 = run.json().committedRevisionId as string;

    // B34: computed on read and owner-only through RLS; nothing is stored.
    const verification = `/api/projects/${id}/revisions/${rev2}/verification`;
    const report = await app.inject({ url: verification, headers: owner.headers });
    expect(report.statusCode, report.body.slice(0, 300)).toBe(200);
    expect(VerificationReportSchema.parse(report.json())).toMatchObject({ projectId: id, revisionId: rev2, status: 'VERIFIED' });
    expect((await app.inject({ url: verification, headers: other.headers })).statusCode).toBe(404);
    expect((await app.inject({ url: verification })).statusCode).toBe(401);
    const diffBody = { otherRevisionId: base.id, scope: {} };
    const diff = await app.inject({ method: 'POST', url: `${verification}/diff`, headers: owner.headers, payload: diffBody });
    expect(diff.statusCode, diff.body.slice(0, 300)).toBe(200);
    expect(DiffReportSchema.parse(diff.json())).toMatchObject({ status: 'OUT_OF_SCOPE_CHANGES', counts: { added: 0, removed: 0, changed: 1, outOfScope: 1 },
      changes: [{ collection: 'spaces', entityId: 'foyer', change: 'CHANGED', inScope: false }] });
    expect((await app.inject({ method: 'POST', url: `${verification}/diff`, headers: other.headers, payload: diffBody })).statusCode).toBe(404);

    // B44 (0030): roles for real Auth users. Membership reaches only the collaboration routes.
    const root = `/api/projects/${id}/collaboration`;
    for (const [principal, role] of [[reviewer, 'reviewer'], [viewer, 'viewer']] as const) {
      const added = await app.inject({ method: 'POST', url: `${root}/members`, headers: owner.headers, payload: { userId: principal.id, role } });
      expect(added.statusCode, added.body.slice(0, 300)).toBe(201);
    }
    const forbidden = await app.inject({ method: 'POST', url: `${root}/members`, headers: reviewer.headers, payload: { userId: other.id, role: 'viewer' } });
    expect([forbidden.statusCode, forbidden.json().error.code]).toEqual([403, 'COLLABORATION_FORBIDDEN']);
    const workspace = await app.inject({ url: root, headers: viewer.headers });
    expect(workspace.statusCode, workspace.body.slice(0, 300)).toBe(200); expect(WorkspaceResponseSchema.parse(workspace.json()).role).toBe('viewer');
    expect((await app.inject({ url: `/api/projects/${id}`, headers: viewer.headers })).statusCode).toBe(404);
    expect((await app.inject({ url: root, headers: other.headers })).statusCode).toBe(404);
    expect((await app.inject({ url: root })).statusCode).toBe(401);
    const comment = await app.inject({ method: 'POST', url: `${root}/revisions/${rev2}/comments`, headers: reviewer.headers,
      payload: { kind: 'CHANGE_REQUEST', body: 'Carpet in the foyer will wear fast', elementIds: ['foyer'] } });
    expect(comment.statusCode, comment.body.slice(0, 300)).toBe(201); const commentId = comment.json().id as string;
    const denied = await app.inject({ method: 'POST', url: `${root}/revisions/${rev2}/comments`, headers: viewer.headers, payload: { body: 'x' } });
    expect([denied.statusCode, denied.json().error.code]).toEqual([403, 'COLLABORATION_FORBIDDEN']);
    const view = RevisionCollaborationSchema.parse((await app.inject({ url: `${root}/revisions/${rev2}`, headers: viewer.headers })).json());
    const review = await app.inject({ method: 'POST', url: `${root}/revisions/${rev2}/reviews`, headers: reviewer.headers,
      payload: { decision: 'APPROVED', expectedModelHash: view.revision.modelHash } });
    expect(review.statusCode, review.body.slice(0, 300)).toBe(201);

    // Direct SDK on the 0030 tables: the owner sees every member, a member only itself, another user nothing; anonymous is refused and no client writes.
    const members = await owner.client.from('project_members').select('user_id,role').eq('project_id', id).order('role');
    expect(members.error).toBeNull(); expect(members.data).toEqual([{ user_id: reviewer.id, role: 'reviewer' }, { user_id: viewer.id, role: 'viewer' }]);
    expect((await viewer.client.from('project_members').select('user_id').eq('project_id', id)).data).toEqual([{ user_id: viewer.id }]);
    expect((await other.client.from('project_members').select('user_id').eq('project_id', id)).data).toEqual([]);
    expect((await owner.client.from('project_members').insert({ project_id: id, user_id: other.id, role: 'editor', added_by: owner.id })).error?.code).toBe('42501');
    for (const table of ['project_revision_comments', 'project_revision_reviews'] as const) {
      const own = await viewer.client.from(table).select('id').eq('project_id', id);
      expect(own.error, table).toBeNull(); expect(own.data, table).toHaveLength(1);
      expect((await other.client.from(table).select('id').eq('project_id', id)).data, table).toEqual([]);
      expect((await publicClient.from(table).select('id').eq('project_id', id)).error?.code, table).toBe('42501');
      expect((await owner.client.from(table).delete().eq('project_id', id)).error?.code, table).toBe('42501');
    }
    expect((await reviewer.client.from('project_revision_comments').update({ body: 'edited' }).eq('id', commentId)).error?.code).toBe('42501');
    // An unsigned write is refused after the role check; a non-member learns only that the project is not found.
    const forged = { p_action: 'comment', p_input: { projectId: id, revisionId: rev2, kind: 'COMMENT', body: 'forged', elementIds: [] }, p_envelope: '{}', p_signature: 'f'.repeat(64) };
    expect((await reviewer.client.rpc('collaboration_write', forged)).error?.code).toBe('42501');
    expect((await other.client.rpc('collaboration_write', forged)).error?.code).toBe('P1201');
    expect((await other.client.rpc('collaboration_read', { p_action: 'workspace', p_project_id: id })).error?.code).toBe('P1201');
    expect((await publicClient.rpc('collaboration_read', { p_action: 'workspace', p_project_id: id })).error).not.toBeNull();
    // Removal ends access through the API and through PostgREST.
    expect((await app.inject({ method: 'DELETE', url: `${root}/members/${viewer.id}`, headers: owner.headers })).statusCode).toBe(200);
    expect((await app.inject({ url: root, headers: viewer.headers })).statusCode).toBe(404);
    expect((await viewer.client.from('project_revision_comments').select('id').eq('project_id', id)).data).toEqual([]);
    // The record is exactly what the API wrote: one comment and one review.
    const after = RevisionCollaborationSchema.parse((await app.inject({ url: `${root}/revisions/${rev2}`, headers: owner.headers })).json());
    expect([after.comments.map(c => c.id), after.reviews.length]).toEqual([[commentId], 1]);
  }, 180_000);

  it('0032 and 0033 through actual JWT and PostgREST: readiness checks the commit key and schema, and a keyed B44 retry stores one comment', async () => {
    if (!app || !owner) throw new Error('Local setup incomplete');
    // 0032: the anonymous probes the production adapter makes for readiness and discovery (audit B INT-B-015, INT-B-017).
    expect((await app.inject({ url: '/health/ready' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/capabilities' })).json().deployment)
      .toEqual({ writes: 'AVAILABLE', schema: { expectedVersion: EXPECTED_SCHEMA_VERSION, status: 'CURRENT' } });
    const stale = buildApp({ env: { ...localEnvironment(), PROJECT_COMMIT_SECRET: '0'.repeat(64) }, captureError: () => undefined });
    try {
      await stale.ready();
      expect((await stale.inject({ url: '/health/ready' })).statusCode).toBe(503);
      const created = await stale.inject({ method: 'POST', url: '/api/projects', headers: owner.headers, payload: { title: '0032 stale secret live' } });
      expect(created.statusCode, created.body).toBe(201);
      const refused = await stale.inject({ method: 'POST', url: `/api/projects/${created.json().id}/revisions`, headers: owner.headers, payload: { model: authored() } });
      expect([refused.statusCode, refused.json().error.code]).toEqual([503, 'COMMIT_ATTESTATION_UNAVAILABLE']);
    } finally { await stale.close(); }
    // 0033: a retried comment with one Idempotency-Key replays the first response and stores one row (INT-B-014).
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner.headers, payload: { title: '0033 retries live' } });
    expect(p.statusCode, p.body).toBe(201); const id = p.json().id as string;
    const rev = await app.inject({ method: 'POST', url: `/api/projects/${id}/revisions`, headers: owner.headers, payload: { model: authored() } });
    expect(rev.statusCode, rev.body.slice(0, 300)).toBe(201);
    const url = `/api/projects/${id}/collaboration/revisions/${rev.json().revision.id}/comments`, headers = { ...owner.headers, 'idempotency-key': 'live-comment-retry' };
    const first = await app.inject({ method: 'POST', url, headers, payload: { body: 'Retried once' } });
    const retry = await app.inject({ method: 'POST', url, headers, payload: { body: 'Retried once' } });
    expect([first.statusCode, retry.statusCode, retry.json().id]).toEqual([201, 201, first.json().id]);
    const stored = await owner.client.from('project_revision_comments').select('id').eq('project_id', id);
    expect(stored.error).toBeNull(); expect(stored.data).toEqual([{ id: first.json().id }]);
    expect((await app.inject({ url: `/api/projects/${id}/collaboration`, headers: owner.headers })).json().revisionsTruncated).toBe(false);
  }, 120_000);

  // Audit B INT-B-024: route families whose production adapter path had never run against Supabase (real GoTrue JWTs, PostgREST, RLS).
  it('B31 references, B33 settings and library, brief and context through actual JWT and PostgREST: owner-only, signed download link, versioned writes', async () => {
    if (!app || !owner || !other) throw new Error('Local setup incomplete');
    const call = (who: Principal | null, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
      app!.inject({ method, url, headers: { ...(who?.headers ?? {}), ...headers }, ...(payload === undefined ? {} : { payload: payload as string }) });
    const p = await call(owner, 'POST', '/api/projects', { title: 'B31 live villa' });
    expect(p.statusCode, p.body).toBe(201); const id = p.json().id as string;
    const generatedRevision = await call(owner, 'POST', `/api/projects/${id}/revisions/generate`, { requirements: parametricInput(true) });
    expect(generatedRevision.statusCode, generatedRevision.body.slice(0, 300)).toBe(201);
    // B31: raw upload, list, content, signed download link (anonymous, token-authorized), and owner-only reads.
    const bytes = png({ width: 7 });
    const up = await call(owner, 'POST', `/api/projects/${id}/references?purpose=SITE_PHOTO`, bytes, { 'content-type': 'image/png' });
    expect(up.statusCode, up.body.slice(0, 300)).toBe(201);
    const ref = up.json();
    expect([ref.status, ref.mediaType, ref.deduplicated]).toEqual(['ACTIVE', 'image/png', false]);
    expect((await call(owner, 'POST', `/api/projects/${id}/references?purpose=SITE_PHOTO`, bytes, { 'content-type': 'image/png' })).json().deduplicated).toBe(true);
    expect((await call(owner, 'GET', `/api/projects/${id}/references`)).json().items.map((r: { id: string }) => r.id)).toEqual([ref.id]);
    const content = await call(owner, 'GET', `/api/projects/${id}/references/${ref.id}/content`);
    expect(content.statusCode).toBe(200);
    expect(createHash('sha256').update(content.rawPayload).digest('hex')).toBe(ref.storedSha256);
    const link = await call(owner, 'POST', `/api/projects/${id}/references/${ref.id}/download-links`, { expiresInSeconds: 120 });
    expect(link.statusCode, link.body).toBe(201);
    const download = await call(null, 'GET', link.json().url);
    expect(download.statusCode).toBe(200);
    expect(createHash('sha256').update(download.rawPayload).digest('hex')).toBe(ref.storedSha256);
    expectFailure(await call(null, 'GET', '/api/reference-downloads?token=forged'), 404);
    expectFailure(await call(other, 'GET', `/api/projects/${id}/references/${ref.id}`), 404);
    const direct = await other.client.from('project_references').select('id').eq('project_id', id);
    expect(direct.error).toBeNull(); expect(direct.data).toEqual([]);
    // B33 settings: optimistic versioning per user.
    const settings = await call(owner, 'GET', '/api/me/settings');
    expect(settings.statusCode, settings.body).toBe(200);
    const patched = await call(owner, 'PATCH', '/api/me/settings', { expectedVersion: settings.json().version, settings: { units: 'IMPERIAL' } });
    expect(patched.statusCode, patched.body).toBe(200); expect(patched.json().isDefault).toBe(false);
    expectFailure(await call(owner, 'PATCH', '/api/me/settings', { expectedVersion: settings.json().version, settings: { units: 'METRIC' } }), 409);
    expect((await call(other, 'GET', '/api/me/settings')).json().isDefault).toBe(true);
    expect((await call(owner, 'GET', '/api/me/usage')).statusCode).toBe(200);
    // Library: star and tag, then search; another user sees nothing.
    expect((await call(owner, 'PATCH', `/api/projects/${id}/library`, { starred: true, tags: ['live-b33'] })).json()).toMatchObject({ projectId: id, starred: true, tags: ['live-b33'] });
    expect((await call(owner, 'GET', '/api/library/projects?tag=live-b33&status=ALL')).json().items.map((i: { title: string }) => i.title)).toEqual(['B31 live villa']);
    expect((await call(other, 'GET', '/api/library/projects?tag=live-b33&status=ALL')).json().items).toEqual([]);
    // Brief: versioned, citing the stored reference; context binds the current revision.
    const brief = await call(owner, 'POST', `/api/projects/${id}/brief/versions`, { expectedVersion: 0, brief: { summary: '3BHK for a family of four', referenceIds: [ref.id] } });
    expect(brief.statusCode, brief.body).toBe(201); expect(brief.json().version).toBe(1);
    expectFailure(await call(owner, 'POST', `/api/projects/${id}/brief/versions`, { expectedVersion: 0, brief: { summary: 'stale' } }), 409);
    expect((await call(owner, 'GET', `/api/projects/${id}/brief`)).json().version).toBe(1);
    const context = await call(owner, 'GET', `/api/projects/${id}/context`);
    expect(context.statusCode, context.body.slice(0, 300)).toBe(200);
    expect(context.json()).toMatchObject({ contextVersion: 'project-context-v1', projectId: id, currentRevision: { id: generatedRevision.json().revision.id } });
    expectFailure(await call(other, 'GET', `/api/projects/${id}/context`), 404);
  }, 180_000);

  it('B35, B37, B38, B41-B43, B45 and conversation turns through actual JWT and PostgREST: read-only derivations, scene delivery, owner-only', async () => {
    if (!app || !owner || !other) throw new Error('Local setup incomplete');
    const call = (who: Principal, method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
      app!.inject({ method, url, headers: { ...who.headers, ...headers }, ...(payload === undefined ? {} : { payload: payload as string }) });
    const p = await call(owner, 'POST', '/api/projects', { title: 'B35-B45 live' });
    expect(p.statusCode, p.body).toBe(201); const id = p.json().id as string;
    const g = await call(owner, 'POST', `/api/projects/${id}/revisions/generate`, { requirements: parametricInput(true) });
    expect(g.statusCode, g.body.slice(0, 300)).toBe(201); const rev = g.json().revision; const base = `/api/projects/${id}/revisions/${rev.id}`;
    // B38 documents: the manifest's hrefs serve exactly the hashed content.
    const docs = await call(owner, 'GET', `${base}/documents`);
    expect(docs.statusCode, docs.body.slice(0, 300)).toBe(200);
    expect(docs.json()).toMatchObject({ documentsVersion: 'construction-documents-v1', binding: { projectId: id, revisionId: rev.id }, freshness: { documentStatus: 'CURRENT_REVISION' } });
    for (const d of docs.json().documents as { href: string; contentHash: string }[]) {
      const body = await call(owner, 'GET', d.href);
      expect(body.statusCode, d.href).toBe(200);
      expect(createHash('sha256').update(body.rawPayload).digest('hex'), d.href).toBe(d.contentHash);
    }
    expect((await call(owner, 'GET', `${base}/documents/schedules/rooms/csv`)).statusCode).toBe(200);
    expectFailure(await call(other, 'GET', `${base}/documents`), 404);
    // B37 dependency graph and B35 engineering assessment: derived on read, bound to this revision.
    const graph = await call(owner, 'GET', `${base}/dependency-graph`);
    expect(graph.statusCode, graph.body.slice(0, 300)).toBe(200);
    expect(graph.json()).toMatchObject({ graphVersion: 'dependency-graph-v1', inputIdentity: { projectId: id, revisionId: rev.id } });
    const assessment = await call(owner, 'GET', `${base}/engineering-assessment`);
    expect(assessment.statusCode, assessment.body.slice(0, 300)).toBe(200);
    expect(assessment.json()).toMatchObject({ projectId: id, revisionId: rev.id, claims: { structuralSafety: 'NOT_CLAIMED' } });
    expectFailure(await call(other, 'GET', `${base}/engineering-assessment`), 404);
    // B45: compile a scene, then deliver it with a revalidating ETag.
    expectFailure(await call(owner, 'GET', `${base}/scene/delivery`), 409);
    const scene = await call(owner, 'POST', `${base}/scene/artifacts`, {});
    expect(scene.statusCode, scene.body.slice(0, 300)).toBe(201);
    const delivery = await call(owner, 'GET', `${base}/scene/delivery`);
    expect(delivery.statusCode, delivery.body.slice(0, 300)).toBe(200);
    expect(delivery.json()).toMatchObject({ revisionCurrency: 'CURRENT', artifact: { artifactId: scene.json().id } });
    expect((await call(owner, 'GET', `${base}/scene/delivery`, undefined, { 'if-none-match': String(delivery.headers.etag) })).statusCode).toBe(304);
    expectFailure(await call(other, 'GET', `${base}/scene/delivery`), 404);
    // B42 feasibility and B43 routing: advisory, store nothing.
    const feasibility = await call(owner, 'POST', `/api/projects/${id}/feasibility/assessments`, { text: 'A floating 40 storey glass tower' });
    expect(feasibility.statusCode, feasibility.body.slice(0, 300)).toBe(200); expect(feasibility.json().status).toBe('ALTERNATIVES_PROPOSED');
    expect((await call(owner, 'GET', '/api/routing/capabilities')).statusCode).toBe(200);
    const routing = await call(owner, 'POST', `/api/projects/${id}/routing/decisions`, { targetScopes: ['FACADE_APPEARANCE', 'INTERIOR_RENDER'] });
    expect(routing.statusCode, routing.body.slice(0, 300)).toBe(200);
    expect(routing.json().refused.map((r: { scope: string }) => r.scope)).toEqual(['INTERIOR_RENDER']);
    expectFailure(await call(other, 'POST', `/api/projects/${id}/routing/decisions`, { targetScopes: ['FACADE_APPEARANCE'] }), 404);
    // Conversation turns on the generated revision: deterministic interpretation, no provider configured.
    const conversationId = randomUUID();
    const conversation = await call(owner, 'POST', `/api/projects/${id}/conversations`, { conversationId, baseRevisionId: rev.id });
    expect(conversation.statusCode, conversation.body.slice(0, 300)).toBe(200);
    const turn = await call(owner, 'POST', `/api/projects/${id}/conversations/${conversationId}/turns`, { turnId: randomUUID(),
      expectedVersion: conversation.json().state.version, baseRevisionId: conversation.json().state.baseRevisionId, text: 'Keep the staircase exactly as it is.' });
    expect(turn.statusCode, turn.body.slice(0, 300)).toBe(200);
    expect(turn.json().turn).toMatchObject({ classification: 'CONSTRAINT', status: 'RECORDED' });
    expectFailure(await call(other, 'POST', `/api/projects/${id}/conversations/${conversationId}/turns`, { turnId: randomUUID(),
      expectedVersion: turn.json().conversation.state.version, baseRevisionId: rev.id, text: 'Add a floor' }), 404);
    // B41 instructions on a supplied model: resolution is read-only and deterministic.
    const supplied = await call(owner, 'POST', `/api/projects/${id}/revisions`, { model: generated(), baseRevisionId: rev.id });
    expect(supplied.statusCode, supplied.body.slice(0, 300)).toBe(201);
    const resolveUrl = `/api/projects/${id}/revisions/${supplied.json().revision.id}/instructions/resolve`;
    const resolved = await call(owner, 'POST', resolveUrl, { text: 'Change only the kitchen floor to stone tile' });
    expect(resolved.statusCode, resolved.body.slice(0, 300)).toBe(200);
    expect(resolved.json().status).toBe('RESOLVED');
    expect((await call(owner, 'POST', resolveUrl, { text: 'Change only the kitchen floor to stone tile' })).json()).toEqual(resolved.json());
    expectFailure(await call(other, 'POST', resolveUrl, { text: 'Change only the kitchen floor to stone tile' }), 404);
  }, 300_000);

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
