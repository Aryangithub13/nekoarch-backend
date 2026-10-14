import { createHash, randomUUID } from 'node:crypto';
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
    // Revision 1: ROOT lineage, an ordinary generation (no Phase 30 operation), nothing to compare.
    expect(m.lineage).toMatchObject({ status: 'ROOT', parentRevisionId: null, operation: { status: 'NONE' }, reasons: [] });
    expect([m.diff.status, m.changeImpact.status, m.changeImpact.disciplines]).toEqual(['NO_PARENT', 'NO_PARENT', []]);
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
    const spaces = a.revision.model.spaces as Json[];
    const edited = (await ok('POST', `/api/projects/${a.projectId}/revisions`, { model: { ...a.revision.model, name: `${a.revision.model.name} (edited)`,
      spaces: [{ ...spaces[0], name: `${spaces[0]!.name} (edited)` }, ...spaces.slice(1)] }, baseRevisionId: a.revision.id })).json().revision as Json;
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
    expect(old.modules.flatMap(x => x.artifacts!).every(x => x.freshness.state === 'stale')).toBe(true);
    // ROADMAP L262: the base's freshness impact lists, by discipline, every base output to regenerate against the new revision.
    expect(old.freshnessImpact.targetRevisionId).toBe(edited.id);
    const regenerate = old.freshnessImpact.disciplines.flatMap(d => d.regenerate);
    for (const name of ['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST', 'SCENE_3D', 'DESIGN_CONCEPTS', 'CONSTRUCTION_DOCUMENTS']) expect(regenerate).toContain(name);
    // The base's own model and acceptance are superseded by the edit, never listed to regenerate.
    expect(old.freshnessImpact.disciplines.flatMap(d => d.superseded)).toEqual(['BUILDING_MODEL', 'ACCEPTANCE_QA']);
    for (const name of ['BUILDING_MODEL', 'ACCEPTANCE_QA']) expect(regenerate).not.toContain(name);
    expect(old.freshnessImpact.disciplines.reduce((n, d) => n + d.staleArtifacts, 0)).toBe(old.modules.reduce((n, x) => n + x.artifacts!.length, 0));
    expect([old.lineage.parentRevisionId, old.diff.bimDiffHref]).toEqual([null, null]);

    const fresh = await manifest(`/api/projects/${a.projectId}/revisions/${edited.id}`);
    expect(fresh.identity).toMatchObject({ revisionCurrency: 'CURRENT', parentRevisionId: a.revision.id });
    // Change metadata against the parent: one space changed; every discipline is affected through the model it is bound to.
    expect(fresh.lineage).toMatchObject({ status: 'LINKED', revisionNumber: 2, parentRevisionId: a.revision.id,
      parent: { revisionId: a.revision.id, revisionNumber: 1, modelHash: a.revision.identity.modelHash }, modelEquivalentToParent: false, operation: { status: 'NONE' } });
    expect(fresh.diff).toMatchObject({ status: 'COMPUTED', baseRevisionId: a.revision.id, modelHashChanged: true, entitiesIdentical: false,
      counts: { added: 0, removed: 0, changed: 1 }, collections: [{ collection: 'spaces', changed: 1 }], changes: [{ collection: 'spaces', entityId: spaces[0]!.id, change: 'CHANGED' }] });
    // The linked BIM semantic diff compares the same pair in the same direction (parent before, edited revision after); nothing to regenerate yet.
    const bim = (await ok('GET', fresh.diff.bimDiffHref!)).json() as Json;
    expect([bim.before.revisionId, bim.before.modelHash, bim.after.revisionId, bim.after.modelHash])
      .toEqual([a.revision.id, fresh.diff.baseModelHash, edited.id, fresh.diff.modelHash]);
    expect(fresh.freshnessImpact.disciplines.every(d => !d.regenerate.length && !d.revalidate.length)).toBe(true);
    expect(fresh.changeImpact.disciplines.map(d => [d.discipline, d.impact, d.reason])).toEqual([['ARCHITECTURE', 'AFFECTED', 'MODEL_ENTITIES_CHANGED'],
      ...['QUANTITIES_AND_COST', 'ENGINEERING', 'DESIGN', 'VISUALIZATION', 'DOCUMENTATION'].map(d => [d, 'AFFECTED', 'BOUND_TO_CHANGED_MODEL'])]);
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
    // ROADMAP L262: an output an active job will produce is awaited, never regenerated or revalidated.
    expect(m.freshnessImpact.disciplines.find(d => d.discipline === 'VISUALIZATION')).toEqual({ discipline: 'VISUALIZATION', regenerate: [], revalidate: [],
      awaiting: ['SCENE_3D'], superseded: [], staleArtifacts: 0, blockedArtifacts: 0 });
    expect(m.freshnessImpact.disciplines.filter(d => d.discipline !== 'VISUALIZATION').every(d => !d.awaiting.length)).toBe(true);
    const second = (await ok('POST', `/api/projects/${p.projectId}/revisions`, { model: p.revision.model, baseRevisionId: p.revision.id })).json().revision as Json;
    const same = await manifest(`/api/projects/${p.projectId}/revisions/${second.id}`);
    expect(mod(same, 'SCENE_3D').freshness).toBeNull();
    // An unchanged save: LINKED and model-equivalent, an empty computed diff, no discipline affected.
    expect(same.lineage).toMatchObject({ status: 'LINKED', modelEquivalentToParent: true });
    expect(same.diff).toMatchObject({ status: 'COMPUTED', modelHashChanged: false, entitiesIdentical: true, counts: { added: 0, removed: 0, changed: 0 }, changes: [] });
    expect(same.changeImpact.disciplines.every(d => d.impact === 'NOT_AFFECTED' && d.reason === 'MODEL_UNCHANGED')).toBe(true);
  }, 180_000);

  it('M2/L262: a stored output that fails a provenance check is blocked and listed to revalidate with its dependents, never to regenerate', async () => {
    const t = await project('B37 revalidate');
    const takeoff = (await ok('POST', `${t.base}/takeoffs`, {})).json();
    const construction = (await ok('POST', `${t.base}/takeoffs/${takeoff.id}/construction-calculations`, { specification: specification() })).json();
    await ok('POST', `${t.base}/takeoffs/${takeoff.id}/construction-calculations/${construction.id}/cost-estimates`,
      { rateBookId: 'sample-inr-v1', costingPolicy: sampleCostingPolicy() });
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local session_replication_role = replica'); // bypass the immutability trigger to simulate corruption
      await client.query('update project_revision_takeoffs set input_fingerprint = $1 where id = $2', ['f'.repeat(64), takeoff.id]);
      await client.query('commit');
    } finally { client.release(); }
    const m = await manifest(t.base);
    expect(m.identity.revisionCurrency).toBe('CURRENT');
    expect(mod(m, 'QUANTITY_TAKEOFF').freshness).toMatchObject({ state: 'blocked', reasons: [{ code: 'FINGERPRINT_MISMATCH' }] });
    for (const name of ['CONSTRUCTION_CALCULATION', 'BOQ_COST']) expect(mod(m, name).freshness.state, name).toBe('blocked');
    expect(m.disciplines.find(d => d.discipline === 'QUANTITIES_AND_COST')!.freshness).toBe('blocked');
    expect(m.freshnessImpact.disciplines.find(d => d.discipline === 'QUANTITIES_AND_COST')).toEqual({ discipline: 'QUANTITIES_AND_COST', regenerate: [],
      revalidate: ['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST'], awaiting: [], superseded: [], staleArtifacts: 0, blockedArtifacts: 3 });
    // Fail closed, and only where the failure reaches: the other disciplines are untouched and nothing is ever reported verified.
    expect(m.freshnessImpact.disciplines.filter(d => d.discipline !== 'QUANTITIES_AND_COST').every(d => !d.regenerate.length && !d.revalidate.length)).toBe(true);
    expect(m.modules.flatMap(x => [x.freshness?.state, ...x.artifacts!.map(y => y.freshness.state)])).not.toContain('verified');
    expect(m.verification.nodeStates.UNVERIFIED).toBe(3);
  }, 180_000);

  it('roadmap L258: a Phase 30 candidate is listed on its base as not accepted, never resolved; once approved it is lineage of the new revision', async () => {
    const p = await project('B37 candidates'), ops = `/api/projects/${p.projectId}/revision-operations`;
    const before = await manifest(p.base);
    expect(before.candidates).toEqual({ modulesResolve: 'ACCEPTED_REVISION_ONLY', availability: 'AVAILABLE', completeness: 'COMPLETE', items: [] });
    const text = 'Redesign the exterior of my building using a contemporary glass-inspired façade. Keep the exact floor plans, internal rooms, stairs, structure, '
      + 'building dimensions, and existing interior unchanged.';
    const pre = (await ok('POST', ops, { baseRevisionId: p.revision.id, request: { text } })).json() as Json;
    const awaiting = await manifest(p.base);
    expect(awaiting.candidates.items).toEqual([{ operationId: pre.id, kind: 'APPEARANCE_MODIFY', status: 'AWAITING_CONSENT', candidateHash: null, createdAt: pre.createdAt,
      expiresAt: pre.expiresAt, acceptance: 'NOT_ACCEPTED', href: `${ops}/${pre.id}`, comparisonHref: `${ops}/${pre.id}/comparison` }]);
    const cand = (await ok('POST', `${ops}/${pre.id}/execute`, { preflightHash: pre.preflightHash, consent: { acceptLocks: true, acceptQuote: true } }, 200)).json() as Json;
    const ready = await manifest(p.base);
    expect(ready.candidates.items).toMatchObject([{ operationId: pre.id, status: 'CANDIDATE_READY', candidateHash: cand.candidateHash, acceptance: 'NOT_ACCEPTED' }]);
    await ok('GET', ready.candidates.items[0]!.comparisonHref);
    // The candidate is listed, not resolved: every module, impact and diff still reads the accepted revision exactly as before it existed.
    for (const m of [awaiting, ready]) for (const key of ['identity', 'modules', 'disciplines', 'lineage', 'diff', 'changeImpact', 'freshnessImpact', 'verification'] as const)
      expect(m[key], key).toEqual(before[key]);
    const committed = (await ok('POST', `${ops}/${pre.id}/approve`, { preflightHash: pre.preflightHash, candidateHash: cand.candidateHash })).json().commit.revision as Json;
    const base = await manifest(p.base), child = await manifest(`/api/projects/${p.projectId}/revisions/${committed.id}`);
    expect([base.identity.revisionCurrency, base.candidates.items]).toEqual(['HISTORICAL', []]);
    expect(child.lineage).toMatchObject({ status: 'LINKED', parentRevisionId: p.revision.id, modelEquivalentToParent: true,
      operation: { status: 'RECORDED', operationId: pre.id, kind: 'APPEARANCE_MODIFY', baseRevisionId: p.revision.id, modelEquivalentToBase: true } });
    expect(child.candidates.items).toEqual([]);
  }, 300_000);

  it('roadmap L259: a partial view filters one discipline or omits artifact lists, keeps the full hash, and every indexed paged view answers', async () => {
    const full = await manifest(a.base);
    const part = ProjectManifestSchema.parse((await ok('GET', `${a.base}/manifest?discipline=QUANTITIES_AND_COST&artifacts=omit`)).json());
    expect(part.view).toEqual({ scope: 'PARTIAL', discipline: 'QUANTITIES_AND_COST', artifacts: 'OMITTED' });
    expect(part.manifestHash).toBe(full.manifestHash);
    expect(part.modules.map(x => [x.module, x.artifacts, x.artifactCount])).toEqual(full.modules.filter(x => x.discipline === 'QUANTITIES_AND_COST')
      .map(x => [x.module, null, x.artifacts!.length]));
    expect(part.modules.every(x => x.artifactCount > 0)).toBe(true);
    expect(part.freshnessImpact.disciplines).toEqual(full.freshnessImpact.disciplines.filter(d => d.discipline === 'QUANTITIES_AND_COST'));
    for (const bad of ['discipline=COST', 'artifacts=none', 'discipline=ENGINEERING&discipline=DESIGN'])
      expect((await app.inject({ url: `${a.base}/manifest?${bad}`, headers: owner })).statusCode, bad).toBe(400);
    expect((await app.inject({ url: `${a.base}/manifest?artifacts=omit`, headers: other })).statusCode).toBe(404);
    // Paged views answer one item; unpaged partial views (schedules, one CSV per schedule, one plan sheet per storey) answer as they are.
    const views = full.modules.flatMap(x => x.views.map(v => [x.module, v.href, v.paging] as const));
    const storeys = a.revision.model.levels.filter((l: Json) => l.kind === 'storey').length;
    expect([views.filter(v => v[2] !== 'NONE').length, views.filter(v => v[2] === 'NONE').length]).toEqual([11, 1 + 5 + storeys]);
    for (const [module, href, paging] of views)
      expect((await app.inject({ url: paging === 'NONE' ? href : `${href}?limit=1`, headers: owner })).statusCode, `${module} ${href}`).toBe(200);
  }, 180_000);

  it('M4 gate with the B30 exterior-appearance fixture (T1/T5): dependent outputs are identified and the visible 3D object stays linked to its model', async () => {
    const p = await project('B37 B30 fixture'), ops = `/api/projects/${p.projectId}/revision-operations`;
    const takeoff = (await ok('POST', `${p.base}/takeoffs`, {})).json();
    const construction = (await ok('POST', `${p.base}/takeoffs/${takeoff.id}/construction-calculations`, { specification: specification() })).json();
    await ok('POST', `${p.base}/takeoffs/${takeoff.id}/construction-calculations/${construction.id}/cost-estimates`, { rateBookId: 'sample-inr-v1', costingPolicy: sampleCostingPolicy() });
    const scene = (await ok('POST', `${p.base}/scene/artifacts`, {})).json();
    const text = 'Redesign the exterior of my building using a contemporary glass-inspired façade. Keep the exact floor plans, internal rooms, stairs, structure, '
      + 'building dimensions, and existing interior unchanged.';
    const pre = (await ok('POST', ops, { baseRevisionId: p.revision.id, request: { text } })).json() as Json;
    const cand = (await ok('POST', `${ops}/${pre.id}/execute`, { preflightHash: pre.preflightHash, consent: { acceptLocks: true, acceptQuote: true } }, 200)).json() as Json;
    const b = (await ok('POST', `${ops}/${pre.id}/approve`, { preflightHash: pre.preflightHash, candidateHash: cand.candidateHash })).json().commit.revision as Json;
    const base = await manifest(p.base), child = await manifest(`/api/projects/${p.projectId}/revisions/${b.id}`);
    // The base: every stored and derived output is stale with a reason, against the new revision; nothing is silently current.
    for (const x of base.modules.filter(x => x.freshness !== null)) expect([x.freshness!.state, x.freshness!.targetRevisionId], x.module).toEqual(['stale', b.id]);
    expect(mod(base, 'SCENE_3D')).toMatchObject({ artifacts: [{ artifactId: scene.id, revisionId: p.revision.id }], freshness: { reasons: [{ code: 'SOURCE_REVISION_SUPERSEDED' }] } });
    expect(mod(base, 'BOQ_COST').freshness!.reasons[0]!.code).toBe('UPSTREAM_STALE');
    const regenerate = base.freshnessImpact.disciplines.flatMap(d => d.regenerate), superseded = base.freshnessImpact.disciplines.flatMap(d => d.superseded);
    for (const name of ['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST', 'SCENE_3D', 'BIM', 'CONSTRUCTION_DOCUMENTS']) expect(regenerate, name).toContain(name);
    expect(superseded.sort()).toEqual(['ACCEPTANCE_QA', 'BUILDING_MODEL']);
    expect(regenerate).not.toContain('BUILDING_MODEL');
    // The child: its visible 3D object is the committed appearance, linked by revision id and the verified model hash, and its bytes match.
    const appearance = mod(child, 'APPEARANCE_VARIANT');
    expect(appearance).toMatchObject({ availability: 'AVAILABLE', freshness: { state: 'current', reasons: [] }, artifactCount: 1 });
    const read = (await ok('GET', appearance.href)).json() as Json;
    expect(read).toMatchObject({ status: 'APPEARANCE_VARIANT', revisionId: b.id, modelHash: child.identity.modelHash, operationId: pre.id,
      artifact: { id: appearance.artifacts![0]!.artifactId } });
    const glb = await app.inject({ url: `${appearance.href}/glb`, headers: owner });
    expect([glb.statusCode, createHash('sha256').update(glb.rawPayload).digest('hex')]).toEqual([200, read.artifact.binarySha256]);
    expect(mod(child, 'SCENE_3D').availability).toBe('NOT_GENERATED');
    expect(child.lineage).toMatchObject({ status: 'LINKED', modelEquivalentToParent: true, operation: { status: 'RECORDED', operationId: pre.id } });
    // The base revision has no committed appearance of its own.
    expect(mod(base, 'APPEARANCE_VARIANT')).toMatchObject({ availability: 'NOT_GENERATED', missingReason: 'NOT_GENERATED_FOR_REVISION' });
  }, 300_000);

  it('L262 after a restore: a restored appearance stays linked through the RESTORE operation that committed it, and a mislinked one is still blocked', async () => {
    const p = await project('B37 restored appearance'), ops = `/api/projects/${p.projectId}/revision-operations`;
    const consent = { acceptLocks: true, acceptQuote: true };
    const commit = async (baseRevisionId: string, text: string) => {
      const pre = (await ok('POST', ops, { baseRevisionId, request: { text } })).json() as Json;
      const cand = (await ok('POST', `${ops}/${pre.id}/execute`, { preflightHash: pre.preflightHash, consent }, 200)).json() as Json;
      return { pre, revision: (await ok('POST', `${ops}/${pre.id}/approve`, { preflightHash: pre.preflightHash, candidateHash: cand.candidateHash })).json().commit.revision as Json };
    };
    const b = await commit(p.revision.id, 'Redesign the exterior of my building using a contemporary glass-inspired façade. Keep the exact floor plans, internal rooms, stairs, '
      + 'structure, building dimensions, and existing interior unchanged.');
    const c = await commit(b.revision.id, 'Restore revision 1');
    const d = await commit(c.revision.id, 'Restore revision 2');
    expect(d.pre).toMatchObject({ kind: 'RESTORE', restoreSourceRevisionId: b.revision.id });
    const at = (r: Json) => `/api/projects/${p.projectId}/revisions/${r.id}`;
    // D's appearance row records D's RESTORE operation; its compiled artifact is B's, produced by B's APPEARANCE_MODIFY operation.
    const read = (await ok('GET', `${at(d.revision)}/appearance`)).json() as Json;
    expect([read.status, read.operationId, read.artifact.operationId]).toEqual(['APPEARANCE_VARIANT', d.pre.id, b.pre.id]);
    const restored = await manifest(at(d.revision)), edited = await manifest(at(b.revision));
    expect(mod(restored, 'APPEARANCE_VARIANT')).toMatchObject({ availability: 'AVAILABLE', freshness: { state: 'current', reasons: [] },
      artifacts: [{ artifactId: mod(edited, 'APPEARANCE_VARIANT').artifacts[0].artifactId }] });
    expect(restored.lineage.operation).toMatchObject({ status: 'RECORDED', operationId: d.pre.id, kind: 'RESTORE', restoreSourceRevisionId: b.revision.id });
    expect(mod(await manifest(at(c.revision)), 'APPEARANCE_VARIANT')).toMatchObject({ availability: 'NOT_GENERATED', missingReason: 'NOT_GENERATED_FOR_REVISION' });
    // Fail closed is kept: the same restored row with lineage that does not record its RESTORE operation is blocked.
    const repo = backend.repository('owner'), unlinked: Repository = { ...repo, revisionRpc: async (name, args) => {
      const result = await repo.revisionRpc!(name, args) as Json;
      return args.p_action === 'lineage' ? { ...result, operation: null } : result;
    } };
    expect(mod(await projectManifest(unlinked, p.projectId, d.revision.id), 'APPEARANCE_VARIANT'))
      .toMatchObject({ freshness: { state: 'blocked', reasons: [{ code: 'LINK_INCONSISTENT' }] } });
  }, 300_000);

  it('scenario 17: a durable job that really failed for this revision is reported as GENERATION_FAILED, and a job for another revision is not', async () => {
    const p = await project('B37 failed generation'), jobs = `/api/projects/${p.projectId}/jobs`;
    const submitted = await app.inject({ method: 'POST', url: jobs, headers: owner, payload: { kind: 'OPTIMIZATION_STUDY', revisionId: p.revision.id, input: { version: 'nope' } } });
    expect(submitted.statusCode, submitted.body.slice(0, 300)).toBe(202);
    const url = `${jobs}/${submitted.json().id}`, deadline = Date.now() + 30_000;
    let job: Json = {};
    while (Date.now() < deadline) { job = (await ok('GET', url)).json(); if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(job.status)) break; await new Promise(r => setTimeout(r, 100)); }
    expect(job).toMatchObject({ status: 'FAILED', failure: { retryable: false } });
    const m = await manifest(p.base);
    expect(mod(m, 'DESIGN_OPTIMIZATION')).toMatchObject({ availability: 'NOT_GENERATED', freshness: null, missingReason: 'GENERATION_FAILED',
      failedJobIds: [job.id], activeJobIds: [] });
    expect(m.failedGenerations).toEqual({ availability: 'AVAILABLE', completeness: 'COMPLETE', window: 8 });
    const second = (await ok('POST', `/api/projects/${p.projectId}/revisions`, { model: p.revision.model, baseRevisionId: p.revision.id })).json().revision as Json;
    expect(mod(await manifest(`/api/projects/${p.projectId}/revisions/${second.id}`), 'DESIGN_OPTIMIZATION'))
      .toMatchObject({ missingReason: 'NOT_GENERATED_FOR_REVISION', failedJobIds: [] });
  }, 120_000);

  it('M3: a revision committed while the manifest is read is a 409, never a manifest that mixes revisions', async () => {
    const repo = backend.repository('owner');
    const moved: Repository = { ...repo, designConceptRpc: async (name, args) => {
      const r = await repo.designConceptRpc!(name, args) as Json;
      return args.p_action === 'list' ? { ...r, projectCurrentRevisionId: randomUUID() } : r;
    } };
    expect(await refusal(projectManifest(moved, a.projectId, a.revision.id))).toEqual([409, 'PROJECT_MANIFEST_READ_INCONSISTENT']);
    // Without design-concept or job persistence the manifest still reads, and says which module it could not see.
    // A parent revision that cannot be read (the schema guarantees it exists) is reported as UNAVAILABLE, never as an empty diff.
    const edited = (await app.inject({ url: `/api/projects/${a.projectId}`, headers: owner })).json().currentRevisionId as string;
    const hidden: Repository = { ...repo, projectRpc: async (name, args) => {
      if (name === 'project_read' && args.p_action === 'revision' && args.p_revision_id === a.revision.id) throw new ApiError(404, 'REVISION_NOT_FOUND', 'Revision not found');
      return repo.projectRpc!(name, args);
    } };
    const orphan = await projectManifest(hidden, a.projectId, edited);
    expect([orphan.lineage.status, orphan.lineage.reasons, orphan.diff.status, orphan.diff.unavailableReason, orphan.changeImpact.status])
      .toEqual(['UNAVAILABLE', ['PARENT_UNREADABLE'], 'UNAVAILABLE', 'PARENT_UNREADABLE', 'UNAVAILABLE']);
    const { designConceptRpc: _concepts, jobRpc: _jobs, revisionRpc: _operations, ...bare } = repo;
    const m = await projectManifest(bare as Repository, a.projectId, a.revision.id);
    expect(mod(m, 'DESIGN_CONCEPTS')).toMatchObject({ availability: 'UNAVAILABLE', missingReason: 'PERSISTENCE_UNAVAILABLE', freshness: null });
    expect(m.lineage.operation.status).toBe('UNAVAILABLE');
    expect(m.candidates).toEqual({ modulesResolve: 'ACCEPTED_REVISION_ONLY', availability: 'UNAVAILABLE', completeness: 'COMPLETE', items: [] });
  }, 120_000);

  it('M6: the whole manifest read, graph and every side read together, never has more than 8 RPCs in flight', async () => {
    const repo = backend.repository('owner') as unknown as Record<string, unknown>, counted: Record<string, unknown> = { ...repo };
    let inFlight = 0, peak = 0, calls = 0;
    for (const [key, value] of Object.entries(repo)) if (key.endsWith('Rpc') && typeof value === 'function')
      counted[key] = async (...args: unknown[]) => {
        inFlight++; calls++; peak = Math.max(peak, inFlight);
        try { await new Promise(r => setTimeout(r, 2)); return await (value as (...a: unknown[]) => Promise<unknown>)(...args); } finally { inFlight--; }
      };
    // `a` holds a takeoff, construction, cost, scene and concept set, so every family and side read is exercised.
    await projectManifest(counted as unknown as Repository, a.projectId, a.revision.id);
    expect(calls).toBeGreaterThan(8);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  }, 120_000);

  it('M3/M6: the operation listing completes before the pointer-checking concept listing starts, and a full page of live operations is TRUNCATED', async () => {
    const repo = backend.repository('owner'), order: string[] = [];
    const traced: Repository = { ...repo,
      revisionRpc: async (name, args) => {
        if (args.p_action !== 'list') return repo.revisionRpc!(name, args);
        order.push('operations:start'); const r = await repo.revisionRpc!(name, args); order.push('operations:end'); return r;
      },
      designConceptRpc: async (name, args) => { if (args.p_action === 'list') order.push('concepts:start'); return repo.designConceptRpc!(name, args); } };
    await projectManifest(traced, a.projectId, a.revision.id);
    expect(order).toEqual(['operations:start', 'operations:end', 'concepts:start']);
    // One bounded page: when it is full and its oldest operation could still be live, more may follow, so the candidates say TRUNCATED.
    const page = (createdAt: string): Repository => ({ ...repo, revisionRpc: async (name, args) => args.p_action !== 'list' ? repo.revisionRpc!(name, args)
      : { items: [{ id: randomUUID(), projectId: a.projectId, baseRevisionId: a.revision.id, kind: 'APPEARANCE_MODIFY', status: 'CANDIDATE_READY',
        operationVersion: 'revision-operation-v1', preflightHash: 'a'.repeat(64), appearanceHash: null, restoreSourceRevisionId: null, candidateHash: 'b'.repeat(64),
        committedRevisionId: null, createdAt, updatedAt: createdAt, expiresAt: new Date(Date.parse(createdAt) + 86_400_000).toISOString() }],
        nextCursor: { createdAt, id: randomUUID() } } });
    const now = Date.now(), at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();
    expect((await projectManifest(page(at(1)), a.projectId, a.revision.id)).candidates).toMatchObject({ completeness: 'TRUNCATED', items: [{ status: 'CANDIDATE_READY' }] });
    expect((await projectManifest(page(at(26)), a.projectId, a.revision.id)).candidates.completeness).toBe('COMPLETE');
    // Scenario 17 evidence: when older FAILED jobs exist beyond the examined page, the manifest says so instead of implying none failed.
    const olderFailures: Repository = { ...repo, jobRpc: async (name, args) => {
      const r = await repo.jobRpc!(name, args) as Json;
      return args.p_action === 'list' && (args.p_filter as Json).status === 'FAILED' ? { ...r, nextCursor: { createdAt: new Date(0).toISOString(), id: randomUUID() } } : r;
    } };
    expect((await projectManifest(olderFailures, a.projectId, a.revision.id)).failedGenerations).toEqual({ availability: 'AVAILABLE', completeness: 'TRUNCATED', window: 8 });
    expect((await projectManifest(repo, a.projectId, a.revision.id)).failedGenerations).toEqual({ availability: 'AVAILABLE', completeness: 'COMPLETE', window: 8 });
  }, 120_000);
});
