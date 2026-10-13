import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { costHash, sampleCostingPolicy } from '@designflow/boq-cost';
import { asPrincipal, createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { specification } from '../../../packages/construction-calculations/tests/fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { ProjectManifestSchema } from '../src/contracts/project-manifest.js';
import { DependencyGraphSchema } from '../src/contracts/dependency-graph.js';
import { projectManifest } from '../src/services/project-manifest-service.js';
import { signProjectCommit } from '../src/services/project-service.js';
import { JOB_ROOT } from '../src/services/job-service.js';
import { ApiError } from '../src/lib/errors.js';
import type { Repository } from '../src/lib/repository.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };

describe('B37 Unified Project Manifest v2 on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, backend: ReturnType<typeof createPgBackend>, ownerId: string, secret: string;
  beforeAll(async () => {
    db = await startTestDatabase();
    ownerId = await createTestUser(db.pool);
    const otherId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    backend = createPgBackend(db.pool, { owner: ownerId, other: otherId });
    app = buildApp({ env: parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false',
      PROJECT_COMMIT_SECRET: secret }), backend, captureError: () => undefined });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.stop(); });

  const ok = async (method: 'GET' | 'POST', url: string, payload?: unknown, status = method === 'POST' ? 201 : 200) => {
    const r = await app.inject({ method, url, headers: owner, ...(payload === undefined ? {} : { payload: payload as Json }) });
    expect(r.statusCode, `${method} ${url}: ${r.body.slice(0, 400)}`).toBe(status);
    return r;
  };
  const manifest = async (base: string) => ProjectManifestSchema.parse((await ok('GET', `${base}/manifest`)).json());
  const mod = (m: Json, name: string) => (m.modules as Json[]).find(x => x.module === name)!;
  const refusal = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected a refusal'); },
    (e: unknown) => { if (e instanceof ApiError) return [e.statusCode, e.code]; throw e; });
  /** A generated (parametric, scene-eligible) revision. */
  const project = async (title: string) => {
    const projectId = (await ok('POST', '/api/projects', { title })).json().id as string;
    const revision = (await ok('POST', `/api/projects/${projectId}/revisions/generate`, { requirements: parametricInput(true) })).json().revision as Json;
    return { projectId, revision, base: `/api/projects/${projectId}/revisions/${revision.id}` };
  };

  let a: Awaited<ReturnType<typeof project>>;
  it('M1/M5: a fresh revision has its identity, canonical frame and module availability; the route is owner-only and strict', async () => {
    a = await project('B37 manifest');
    const m = await manifest(a.base);
    expect(m.identity).toMatchObject({ projectId: a.projectId, revisionId: a.revision.id, revisionNumber: 1, revisionCurrency: 'CURRENT',
      projectCurrentRevisionId: a.revision.id, modelHash: a.revision.identity.modelHash, acceptanceQaId: a.revision.qa.id });
    expect(m.canonicalModel).toMatchObject({ units: 'mm', coordinateSystem: 'x-right-y-up-z-depth', counts: { levels: a.revision.model.levels.length } });
    expect(m.configuration).toMatchObject({ sourceMode: 'generated', generationIdentity: a.revision.identity });
    expect(mod(m, 'BUILDING_MODEL')).toMatchObject({ availability: 'AVAILABLE', freshness: { state: 'current', reasons: [] }, artifacts: [{ artifactId: a.revision.id }] });
    for (const name of ['QUANTITY_TAKEOFF', 'BOQ_COST', 'STRUCTURAL_ANALYSIS', 'SCENE_3D', 'DESIGN_CONCEPTS'])
      expect(mod(m, name), name).toMatchObject({ availability: 'NOT_GENERATED', freshness: null, missingReason: 'NOT_GENERATED_FOR_REVISION', artifacts: [] });
    for (const name of ['BIM', 'COMPLEX_VERIFICATION', 'ENGINEERING_ASSESSMENT', 'CONSTRUCTION_DOCUMENTS'])
      expect(mod(m, name), name).toMatchObject({ availability: 'DERIVED_ON_READ', freshness: { state: 'current' } });

    const url = `${a.base}/manifest`, b = await project('B37 other project');
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: other })).statusCode).toBe(404);
    expect((await app.inject({ url: `${url}?expand=1`, headers: owner })).statusCode).toBe(400);
    expect((await app.inject({ url: `/api/projects/${a.projectId}/revisions/${b.revision.id}/manifest`, headers: owner })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/projects/${a.projectId}/revisions/${randomUUID()}/manifest`, headers: owner })).statusCode).toBe(404);
  }, 180_000);

  it('M1/M4: stored outputs are current and agree with the Phase 37 graph; the 3D scene is linked to the revision and its model hash', async () => {
    const takeoff = (await ok('POST', `${a.base}/takeoffs`, {})).json();
    const construction = (await ok('POST', `${a.base}/takeoffs/${takeoff.id}/construction-calculations`, { specification: specification() })).json();
    const cost = (await ok('POST', `${a.base}/takeoffs/${takeoff.id}/construction-calculations/${construction.id}/cost-estimates`,
      { rateBookId: 'sample-inr-v1', costingPolicy: sampleCostingPolicy() })).json();
    const scene = (await ok('POST', `${a.base}/scene/artifacts`, {})).json();
    const concept = (await ok('POST', `${a.base}/design-concepts`, { scope: 'EXTERIOR', generator: 'TEMPLATE', alternatives: 1 })).json();
    const m = await manifest(a.base), g = DependencyGraphSchema.parse((await ok('GET', `${a.base}/dependency-graph`)).json());
    expect(m.verification).toMatchObject({ graphHash: g.graphHash, nodeStates: { CURRENT: g.nodes.length, UNVERIFIED: 0 } });
    for (const [name, id] of [['QUANTITY_TAKEOFF', takeoff.id], ['CONSTRUCTION_CALCULATION', construction.id], ['BOQ_COST', cost.id], ['SCENE_3D', scene.id]])
      expect(mod(m, name), name).toMatchObject({ availability: 'AVAILABLE', freshness: { state: 'current' }, artifacts: [{ artifactId: id, graphState: 'CURRENT' }] });
    const sceneNode = g.nodes.find(n => n.nodeId === `SCENE_3D:${scene.id}`)!;
    expect([sceneNode.revisionId, sceneNode.checks.find(c => c.check === 'MODEL_HASH')?.result]).toEqual([a.revision.id, 'VERIFIED']);
    expect(mod(m, 'DESIGN_CONCEPTS')).toMatchObject({ availability: 'AVAILABLE', source: 'ADVISORY_ARTIFACT', freshness: { state: 'current' },
      artifacts: [{ artifactId: concept.id, nodeId: null }] });
    expect(m.disciplines.every(d => d.freshness === 'current' || d.freshness === null)).toBe(true);
    expect(m.claims).toEqual({ engineeringCorrectness: 'NOT_CLAIMED', solverValidation: 'NOT_CLAIMED', professionalReview: 'NOT_CLAIMED' });
    // Same stored state, same manifest (only the read time differs).
    const again = await manifest(a.base);
    expect([again.manifestHash, { ...again, integrityCheckedAt: m.integrityCheckedAt }]).toEqual([m.manifestHash, m]);
  }, 300_000);

  it('M4 gate: an accepted edit marks every dependent output of the base stale with a reason; the edited revision starts with nothing stale', async () => {
    const edited = (await ok('POST', `/api/projects/${a.projectId}/revisions`, { model: { ...a.revision.model, name: `${a.revision.model.name} (edited)` },
      baseRevisionId: a.revision.id })).json().revision as Json;
    const old = await manifest(a.base);
    expect(old.identity).toMatchObject({ revisionCurrency: 'HISTORICAL', projectCurrentRevisionId: edited.id });
    // The first reason names the cause; derived outputs carry the whole chain back to the superseded revision.
    const stale = (name: string, code: string) => {
      const f = mod(old, name).freshness;
      expect([f.state, f.reasons[0].code, f.reasons.at(-1).code, f.sourceRevisionId, f.targetRevisionId], name)
        .toEqual(['stale', code, 'SOURCE_REVISION_SUPERSEDED', a.revision.id, edited.id]);
    };
    for (const name of ['BUILDING_MODEL', 'ACCEPTANCE_QA', 'QUANTITY_TAKEOFF', 'SCENE_3D', 'BIM', 'ENGINEERING_ASSESSMENT', 'CONSTRUCTION_DOCUMENTS', 'DESIGN_CONCEPTS'])
      stale(name, 'SOURCE_REVISION_SUPERSEDED');
    for (const name of ['CONSTRUCTION_CALCULATION', 'BOQ_COST']) stale(name, 'UPSTREAM_STALE');
    expect(old.disciplines.filter(d => d.freshness !== null).every(d => d.freshness === 'stale')).toBe(true);
    // Every stored artifact of the base is accounted for: none is silently current.
    expect(old.modules.flatMap(x => x.artifacts).every(x => x.freshness.state === 'stale')).toBe(true);

    const fresh = await manifest(`/api/projects/${a.projectId}/revisions/${edited.id}`);
    expect(fresh.identity).toMatchObject({ revisionCurrency: 'CURRENT', parentRevisionId: a.revision.id });
    expect(fresh.modules.filter(x => x.source === 'STORED_ARTIFACT' && x.module !== 'ACCEPTANCE_QA').every(x => x.availability === 'NOT_GENERATED')).toBe(true);
    expect(fresh.modules.every(x => x.freshness === null || x.freshness.state === 'current')).toBe(true);
  }, 180_000);

  it('M2: a queued scene job for a revision with no scene is pending; a job for another revision is not', async () => {
    const p = await project('B37 pending');
    const queued = (revisionId: string) => {
      const request = { kind: 'SCENE_COMPILE', revisionId }, body = { action: 'submit', projectId: p.projectId, kind: request.kind, request, inputHash: costHash(request) };
      const signed = signProjectCommit(secret, ownerId, JOB_ROOT, body);
      return asPrincipal(db.pool, ownerId, c => c.query('select public.job_write($1,$2,$3,$4,$5) response', ['submit', JSON.stringify(body), null, signed.envelope, signed.signature]))
        .then(r => r.rows[0].response as Json);
    };
    const job = await queued(p.revision.id);
    const m = await manifest(p.base);
    expect(mod(m, 'SCENE_3D')).toMatchObject({ availability: 'NOT_GENERATED', activeJobIds: [job.id], freshness: { state: 'pending', reasons: [{ code: 'JOB_ACTIVE' }] } });
    expect(mod(m, 'DESIGN_OPTIMIZATION').freshness).toBeNull();
    expect(m.disciplines.find(d => d.discipline === 'VISUALIZATION')!.freshness).toBe('pending');
    const second = (await ok('POST', `/api/projects/${p.projectId}/revisions`, { model: p.revision.model, baseRevisionId: p.revision.id })).json().revision as Json;
    expect(mod(await manifest(`/api/projects/${p.projectId}/revisions/${second.id}`), 'SCENE_3D').freshness).toBeNull();
  }, 180_000);

  it('M3: a revision committed while the manifest is read is a 409, never a manifest that mixes revisions', async () => {
    const repo = backend.repository('owner');
    const moved: Repository = { ...repo, designConceptRpc: async (name, args) => {
      const r = await repo.designConceptRpc!(name, args) as Json;
      return args.p_action === 'list' ? { ...r, projectCurrentRevisionId: randomUUID() } : r;
    } };
    expect(await refusal(projectManifest(moved, a.projectId, a.revision.id))).toEqual([409, 'PROJECT_MANIFEST_READ_INCONSISTENT']);
    // Without design-concept or job persistence the manifest still reads, and says which module it could not see.
    const { designConceptRpc: _concepts, jobRpc: _jobs, ...bare } = repo;
    const m = await projectManifest(bare as Repository, a.projectId, a.revision.id);
    expect(mod(m, 'DESIGN_CONCEPTS')).toMatchObject({ availability: 'UNAVAILABLE', missingReason: 'PERSISTENCE_UNAVAILABLE', freshness: null });
  }, 120_000);
});
