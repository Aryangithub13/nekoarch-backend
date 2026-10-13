import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleCostingPolicy } from '@designflow/boq-cost';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { frameInput } from '../../../test-support/structural-fixtures.js';
import { environmentalInput } from '../../../test-support/environmental-fixtures.js';
import { systemsInput, wetFrameInput, wetRequirements } from '../../../test-support/systems-fixtures.js';
import { knowledgeInput } from '../../../test-support/knowledge-acceptance.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { optimizationInput } from '../../../test-support/optimization-fixtures.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { specification } from '../../../packages/construction-calculations/tests/fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { DependencyGraphSchema } from '../src/contracts/dependency-graph.js';
import { dependencyGraph } from '../src/services/dependency-graph-service.js';
import { ApiError } from '../src/lib/errors.js';
import type { Repository } from '../src/lib/repository.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };

describe('Phase 37 dependency graph on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, backend: ReturnType<typeof createPgBackend>;
  beforeAll(async () => {
    db = await startTestDatabase();
    const ownerId = await createTestUser(db.pool), otherId = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
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
  const project = async (title: string) => {
    const projectId = (await ok('POST', '/api/projects', { title })).json().id as string;
    const revision = (await ok('POST', `/api/projects/${projectId}/revisions`, { model: authored() })).json().revision as Json;
    return { projectId, revision, base: `/api/projects/${projectId}/revisions/${revision.id}` };
  };
  /** Takeoff → construction → two costs, and one structural analysis, all through the public routes. */
  const artifacts = async (base: string, revision: Json) => {
    const takeoff = (await ok('POST', `${base}/takeoffs`, {})).json();
    const construction = (await ok('POST', `${base}/takeoffs/${takeoff.id}/construction-calculations`, { specification: specification() })).json();
    const costs = [];
    for (const rateBookId of ['sample-inr-v1', 'sample-inr-v2'])
      costs.push((await ok('POST', `${base}/takeoffs/${takeoff.id}/construction-calculations/${construction.id}/cost-estimates`, { rateBookId, costingPolicy: sampleCostingPolicy() })).json());
    const structural = (await ok('POST', `${base}/structural/analyses`, frameInput(revision.model as never))).json();
    return { takeoff, construction, costs, structural };
  };
  const graph = async (base: string) => DependencyGraphSchema.parse((await ok('GET', `${base}/dependency-graph`)).json());
  const states = (g: Json) => Object.fromEntries((g.nodes as Json[]).map(n => [n.nodeId, n.state]));
  const refusal = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected a refusal'); },
    (e: unknown) => { if (e instanceof ApiError) return [e.statusCode, e.code, e.fieldErrors?.limit?.[0] ?? null]; throw e; });

  let a: Awaited<ReturnType<typeof project>>, made: Awaited<ReturnType<typeof artifacts>>;
  it('AC1/AC2/AC14: a fresh revision has a CURRENT revision and QA and NOT_GENERATED families; the route is owner-only and strict', async () => {
    a = await project('Phase 37 graph');
    const g = await graph(a.base);
    expect(g).toMatchObject({ graphVersion: 'dependency-graph-v1', complete: true,
      inputIdentity: { projectId: a.projectId, revisionId: a.revision.id, modelHash: a.revision.identity.modelHash, projectCurrentRevisionId: a.revision.id } });
    expect(g.nodes.map(n => [n.nodeId, n.state])).toEqual([[`REVISION:${a.revision.id}`, 'CURRENT'], [`ACCEPTANCE_QA:${a.revision.qa.id}`, 'CURRENT']]);
    expect(g.families.filter(f => !['REVISION', 'ACCEPTANCE_QA'].includes(f.family)).every(f => f.state === 'NOT_GENERATED' && f.nodeIds.length === 0)).toBe(true);
    expect(g.edges).toEqual([{ from: `ACCEPTANCE_QA:${a.revision.qa.id}`, to: `REVISION:${a.revision.id}`, kind: 'QA_OF' }]);

    const url = `${a.base}/dependency-graph`, b = await project('Phase 37 other project');
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: other })).statusCode).toBe(404);
    expect((await app.inject({ url: `${url}?expand=1`, headers: owner })).statusCode).toBe(400);
    const crossed = await app.inject({ url: `/api/projects/${a.projectId}/revisions/${b.revision.id}/dependency-graph`, headers: owner });
    expect(crossed.statusCode).toBe(404);
    expect((await app.inject({ url: `/api/projects/${a.projectId}/revisions/${randomUUID()}/dependency-graph`, headers: owner })).statusCode).toBe(404);
  });

  it('AC3/AC13/AC16/AC17: stored artifacts are CURRENT with edges equal to their stored ids; reads are deterministic, read-only and leave legacy contracts unchanged', async () => {
    made = await artifacts(a.base, a.revision);
    const legacy = async () => Promise.all([ok('GET', `${a.base}/overview`), ok('GET', `/api/projects/${a.projectId}?includeFreshness=true`),
      ok('POST', `${a.base}/engineering-assessment`, { scope: ['WIND_LOADS', 'SEISMIC_LOADS', 'MEMBER_DESIGN'] }, 200)]).then(rs => rs.map(r => JSON.parse(r.body, (k, v) => k === 'generatedAt' ? undefined : v))); // the assessment stamps its own read time
    const counts = async () => {
      const tables = (await db.pool.query(`select table_schema || '.' || table_name as t from information_schema.tables
        where table_schema in ('public', 'project_private') and table_type = 'BASE TABLE' order by 1`)).rows.map(r => r.t as string);
      return Object.fromEntries(await Promise.all(tables.map(async t => [t, (await db.pool.query(`select count(*)::int as n from ${t}`)).rows[0].n])));
    };
    const [legacyBefore, countsBefore] = [await legacy(), await counts()];
    const first = await ok('GET', `${a.base}/dependency-graph`), second = await ok('GET', `${a.base}/dependency-graph`);
    expect(second.body).toBe(first.body);
    expect(await counts()).toEqual(countsBefore);
    expect(await legacy()).toEqual(legacyBefore);

    const g = DependencyGraphSchema.parse(first.json());
    expect(g.nodes.every(n => n.state === 'CURRENT' && n.checks.every(c => c.result === 'VERIFIED'))).toBe(true);
    expect(g.families.map(f => [f.family, f.state, f.nodeIds.length])).toEqual([['REVISION', 'CURRENT', 1], ['ACCEPTANCE_QA', 'CURRENT', 1],
      ['QUANTITY_TAKEOFF', 'CURRENT', 1], ['CONSTRUCTION_CALCULATION', 'CURRENT', 1], ['BOQ_COST', 'CURRENT', 2], ['STRUCTURAL_ANALYSIS', 'CURRENT', 1],
      ['ENVIRONMENTAL_ANALYSIS', 'NOT_GENERATED', 0], ['BUILDING_SYSTEMS_ANALYSIS', 'NOT_GENERATED', 0], ['SPECIALIZED_KNOWLEDGE', 'NOT_GENERATED', 0],
      ['DESIGN_OPTIMIZATION', 'NOT_GENERATED', 0], ['SCENE_3D', 'NOT_GENERATED', 0]]);
    const derived = g.edges.filter(e => e.kind === 'DERIVED_FROM').map(e => [e.from, e.to]);
    expect(derived).toEqual([[`CONSTRUCTION_CALCULATION:${made.construction.id}`, `QUANTITY_TAKEOFF:${made.takeoff.id}`],
      ...made.costs.flatMap(c => [[`BOQ_COST:${c.id}`, `QUANTITY_TAKEOFF:${made.takeoff.id}`], [`BOQ_COST:${c.id}`, `CONSTRUCTION_CALCULATION:${made.construction.id}`]])]);
    // AC15: provenance only.
    expect(first.body).not.toMatch(/assurance|evidenceClass|REQUIRES_SOLVER|NO_VALIDATED_SOLVER/);
  }, 180_000);

  it('AC4: after a new revision, the old chain is STALE_SOURCE_CHANGED at its sources and STALE_UPSTREAM_STALE downstream, explained to the revision', async () => {
    const b = (await ok('POST', `/api/projects/${a.projectId}/revisions`, { model: authored(), baseRevisionId: a.revision.id })).json().revision as Json;
    const old = await graph(a.base), s = states(old);
    expect(old.inputIdentity.projectCurrentRevisionId).toBe(b.id);
    expect([s[`REVISION:${a.revision.id}`], s[`QUANTITY_TAKEOFF:${made.takeoff.id}`], s[`STRUCTURAL_ANALYSIS:${made.structural.id}`]])
      .toEqual(['STALE_SOURCE_CHANGED', 'STALE_SOURCE_CHANGED', 'STALE_SOURCE_CHANGED']);
    expect([s[`CONSTRUCTION_CALCULATION:${made.construction.id}`], ...made.costs.map(c => s[`BOQ_COST:${c.id}`])])
      .toEqual(['STALE_UPSTREAM_STALE', 'STALE_UPSTREAM_STALE', 'STALE_UPSTREAM_STALE']);
    for (const n of old.nodes) expect(n.causes.at(-1), n.nodeId).toEqual({ code: 'SOURCE_REVISION_SUPERSEDED', nodeId: `REVISION:${a.revision.id}` });
    // The new revision starts empty: nothing is carried across revisions.
    const fresh = await graph(`/api/projects/${a.projectId}/revisions/${b.id}`);
    expect(fresh.nodes.map(n => n.state)).toEqual(['CURRENT', 'CURRENT']);
    expect(fresh.families.filter(f => f.state === 'NOT_GENERATED')).toHaveLength(9);
  }, 120_000);

  it('AC6: a tampered stored fingerprint is UNVERIFIED and poisons every dependent; nothing downstream is CURRENT', async () => {
    const t = await project('Phase 37 tamper'), m = await artifacts(t.base, t.revision);
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local session_replication_role = replica'); // bypass the immutability trigger to simulate corruption
      await client.query('update project_revision_takeoffs set input_fingerprint = $1 where id = $2', ['f'.repeat(64), m.takeoff.id]);
      await client.query('commit');
    } finally { client.release(); }
    const g = await graph(t.base), byId = Object.fromEntries(g.nodes.map(n => [n.nodeId, n]));
    expect(byId[`QUANTITY_TAKEOFF:${m.takeoff.id}`]).toMatchObject({ state: 'UNVERIFIED', causes: [{ code: 'FINGERPRINT_MISMATCH' }] });
    expect(byId[`CONSTRUCTION_CALCULATION:${m.construction.id}`]).toMatchObject({ state: 'UNVERIFIED', causes: [{ code: 'FINGERPRINT_MISMATCH' }] });
    for (const c of m.costs) expect(byId[`BOQ_COST:${c.id}`]!.state).toBe('UNVERIFIED');
    expect(byId[`STRUCTURAL_ANALYSIS:${m.structural.id}`]!.state).toBe('CURRENT');
    expect(g.families.find(f => f.family === 'QUANTITY_TAKEOFF')!.state).toBe('UNVERIFIED');
  }, 180_000);

  it('AC11/AC12: page, time and node limits and an inconsistent read are typed refusals through the service, never a partial graph', async () => {
    const repo = backend.repository('owner');
    expect(await refusal(dependencyGraph(repo, a.projectId, a.revision.id, { limits: { familyPage: 1 } }))).toEqual([422, 'DEPENDENCY_GRAPH_LIMIT_EXCEEDED', 'FAMILY_PAGE']);
    expect(await refusal(dependencyGraph(repo, a.projectId, a.revision.id, { limits: { maxNodes: 5 } }))).toEqual([422, 'DEPENDENCY_GRAPH_LIMIT_EXCEEDED', 'NODES']);
    let calls = 0;
    expect(await refusal(dependencyGraph(repo, a.projectId, a.revision.id, { now: () => (calls++ === 0 ? 0 : 1e9) }))).toEqual([422, 'DEPENDENCY_GRAPH_LIMIT_EXCEEDED', 'TIME']);
    const skewed: Repository = { ...repo, sceneRpc: async (name, args) => {
      const r = await repo.sceneRpc!(name, args) as Json;
      return args.p_action === 'list' ? { ...r, projectCurrentRevisionId: randomUUID() } : r;
    } };
    expect(await refusal(dependencyGraph(skewed, a.projectId, a.revision.id))).toEqual([409, 'DEPENDENCY_GRAPH_READ_INCONSISTENT', null]);
    expect((await dependencyGraph(repo, a.projectId, a.revision.id)).complete).toBe(true);
  }, 120_000);
  it('every analysis family stored through the real write paths verifies its recomputed inputHash; a systems → knowledge chain is CURRENT', async () => {
    const projectId = (await ok('POST', '/api/projects', { title: 'Phase 37 analysis chain' })).json().id as string;
    const wet = (await ok('POST', `/api/projects/${projectId}/revisions/generate`, { requirements: wetRequirements() })).json().revision as Json;
    const base = `/api/projects/${projectId}/revisions/${wet.id}`, post = async (path: string, payload: unknown) => (await ok('POST', `${base}/${path}`, payload)).json() as Json;
    const S = await post('structural/analyses', wetFrameInput()), E = await post('environmental/analyses', environmentalInput());
    const Y = await post('systems/analyses', systemsInput({ structuralAnalysisId: S.id, environmentalAnalysisId: E.id }));
    const K = await post('knowledge/analyses', knowledgeInput({ structuralAnalysisId: S.id, environmentalAnalysisId: E.id, systemsAnalysisId: Y.id }));
    const g = await graph(base), byId = Object.fromEntries(g.nodes.map(n => [n.nodeId, n]));
    for (const [family, id] of [['STRUCTURAL_ANALYSIS', S.id], ['ENVIRONMENTAL_ANALYSIS', E.id], ['BUILDING_SYSTEMS_ANALYSIS', Y.id], ['SPECIALIZED_KNOWLEDGE', K.id]]) {
      const n = byId[`${family}:${id}`]!;
      expect([n.state, n.checks.find(c => c.check === 'INPUT_HASH')?.result], family).toEqual(['CURRENT', 'VERIFIED']);
    }
    expect(g.edges.filter(e => e.kind === 'DERIVED_FROM').map(e => [e.from.split(':')[0], e.to.split(':')[0]])).toEqual([
      ['BUILDING_SYSTEMS_ANALYSIS', 'STRUCTURAL_ANALYSIS'], ['BUILDING_SYSTEMS_ANALYSIS', 'ENVIRONMENTAL_ANALYSIS'],
      ['SPECIALIZED_KNOWLEDGE', 'STRUCTURAL_ANALYSIS'], ['SPECIALIZED_KNOWLEDGE', 'ENVIRONMENTAL_ANALYSIS'], ['SPECIALIZED_KNOWLEDGE', 'BUILDING_SYSTEMS_ANALYSIS']]);

    const p2 = (await ok('POST', '/api/projects', { title: 'Phase 37 optimization and scene' })).json().id as string;
    const gen = (await ok('POST', `/api/projects/${p2}/revisions/generate`, { requirements: parametricInput(true) })).json().revision as Json;
    const base2 = `/api/projects/${p2}/revisions/${gen.id}`;
    const O = (await ok('POST', `${base2}/optimization/studies`, optimizationInput())).json(), C = (await ok('POST', `${base2}/scene/artifacts`, {})).json();
    const g2 = await graph(base2), byId2 = Object.fromEntries(g2.nodes.map(n => [n.nodeId, n]));
    for (const key of [`DESIGN_OPTIMIZATION:${O.id}`, `SCENE_3D:${C.id}`])
      expect([byId2[key]!.state, byId2[key]!.checks.find(c => c.check === 'INPUT_HASH')?.result], key).toEqual(['CURRENT', 'VERIFIED']);

    // A stored analysis input changed behind its unchanged hashes is caught by the recomputation and poisons its dependents.
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local session_replication_role = replica');
      await client.query(`update project_revision_structural_analyses set snapshot_json = jsonb_set(snapshot_json, '{input,materials,0,name}', '"tampered"') where id = $1`, [S.id]);
      await client.query('commit');
    } finally { client.release(); }
    const tampered = Object.fromEntries((await graph(base)).nodes.map(n => [n.nodeId, n]));
    expect(tampered[`STRUCTURAL_ANALYSIS:${S.id}`]).toMatchObject({ state: 'UNVERIFIED', causes: [{ code: 'INPUT_HASH_MISMATCH' }] });
    expect(tampered[`BUILDING_SYSTEMS_ANALYSIS:${Y.id}`]).toMatchObject({ state: 'UNVERIFIED', causes: [{ code: 'UPSTREAM_UNVERIFIED', nodeId: `STRUCTURAL_ANALYSIS:${S.id}` },
      { code: 'INPUT_HASH_MISMATCH', nodeId: `STRUCTURAL_ANALYSIS:${S.id}` }] });
    expect(tampered[`SPECIALIZED_KNOWLEDGE:${K.id}`]!.state).toBe('UNVERIFIED');
    expect(tampered[`ENVIRONMENTAL_ANALYSIS:${E.id}`]!.state).toBe('CURRENT');
  }, 300_000);

  it('an artifact or revision committed between the first and second listing round is a 409, never a graph that mixes two states', async () => {
    const repo = backend.repository('owner');
    // Hide the newest cost on the first listing only: the second round sees it, as if it had been committed during the read.
    let costLists = 0;
    const late: Repository = { ...repo, costRpc: async (name, args) => {
      const r = await repo.costRpc!(name, args) as Json;
      return 'p_limit' in args && costLists++ === 0 ? { ...r, items: r.items.slice(0, -1) } : r;
    } };
    expect(await refusal(dependencyGraph(late, a.projectId, a.revision.id))).toEqual([409, 'DEPENDENCY_GRAPH_READ_INCONSISTENT', null]);
    // The current revision moves between the rounds: every analysis listing reports the new pointer from the second round on.
    const moving = randomUUID();
    const wrap = (rpc: (name: never, args: Record<string, unknown>) => Promise<unknown>) => {
      let lists = 0;
      return (async (name: never, args: Record<string, unknown>) => {
        const r = await rpc(name, args) as Json;
        return args.p_action === 'list' && lists++ > 0 ? { ...r, projectCurrentRevisionId: moving } : r;
      }) as never;
    };
    const moved: Repository = { ...repo, structuralRpc: wrap(repo.structuralRpc!), environmentalRpc: wrap(repo.environmentalRpc!), systemsRpc: wrap(repo.systemsRpc!),
      knowledgeRpc: wrap(repo.knowledgeRpc!), optimizationRpc: wrap(repo.optimizationRpc!), sceneRpc: wrap(repo.sceneRpc!) };
    expect(await refusal(dependencyGraph(moved, a.projectId, a.revision.id))).toEqual([409, 'DEPENDENCY_GRAPH_READ_INCONSISTENT', null]);
    // Unchanged state reads cleanly through the same two rounds.
    expect((await dependencyGraph(repo, a.projectId, a.revision.id)).complete).toBe(true);
  }, 120_000);
});
