import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleCostingPolicy } from '@designflow/boq-cost';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { specification } from '../../../packages/construction-calculations/tests/fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { ProjectManifestSchema } from '../src/contracts/project-manifest.js';
import { SpecialistRequestSchema, SpecialistResultSchema, SPECIALIST_VERSION } from '../src/contracts/specialists.js';
import { runSpecialist } from '../src/services/specialist-service.js';
import type { Repository } from '../src/lib/repository.js';
import { randomUUID } from 'node:crypto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };

describe('B39 S1 specialist envelope on PostgreSQL (Blueprint, Materials, Budget; typed refusals for the rest)', () => {
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

  const call = (method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = owner) =>
    app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as Json }) });
  const ok = async (method: 'GET' | 'POST', url: string, payload?: unknown, status = method === 'POST' ? 201 : 200) => {
    const r = await call(method, url, payload);
    expect(r.statusCode, `${method} ${url}: ${r.body.slice(0, 500)}`).toBe(status);
    return r.json() as Json;
  };
  const project = async (title: string) => {
    const projectId = (await ok('POST', '/api/projects', { title })).id as string;
    const revision = (await ok('POST', `/api/projects/${projectId}/revisions/generate`, { requirements: parametricInput(true) })).revision as Json;
    return { projectId, revision, url: (module: string) => `/api/projects/${projectId}/specialists/${module}/requests` };
  };
  const envelope = (baseRevisionId: string, operation: string, targetScopes: string[], outputConfig: Json = {}, preserveScopes: string[] = []) =>
    ({ envelopeVersion: SPECIALIST_VERSION, baseRevisionId, operation, targetScopes, preserveScopes, outputConfig });
  /** POST and parse; `status` is the HTTP status, `expected` the typed status. */
  const run = async (url: string, body: Json, status: number, headers: Record<string, string> = owner) => {
    const r = await call('POST', url, body, headers);
    expect(r.statusCode, r.body.slice(0, 600)).toBe(status);
    return SpecialistResultSchema.parse(r.json());
  };
  const revisionCount = async (projectId: string) => ((await ok('GET', `/api/projects/${projectId}/revisions`)).items as Json[]).length;
  const manifest = async (projectId: string, revisionId: string) => ProjectManifestSchema.parse(await ok('GET', `/api/projects/${projectId}/revisions/${revisionId}/manifest`));

  it('scenario 35: a blueprint-only run regenerates through the canonical solver and QA, emits one revision and no render or scene job; retries replay', async () => {
    const p = await project('B39 blueprint');
    const body = envelope(p.revision.id, 'regenerate', ['building.floor_plans'], { requirements: parametricInput(false) });
    const r = await run(p.url('BLUEPRINT'), body, 201, { ...owner, 'idempotency-key': 'bp-1' });
    expect(r).toMatchObject({ module: 'BLUEPRINT', baseRevisionId: p.revision.id, written: true, replayed: false, operationId: null, jobIds: [],
      details: { kind: 'BLUEPRINT', generatorVersion: 'parametric-architecture-v1', renderJobs: 0 }, quote: { execution: 'LOCAL_DETERMINISTIC', externalCostUsd: 0 },
      claims: { engineeringCorrectness: 'NOT_CLAIMED', solverValidation: 'NOT_CLAIMED', professionalReview: 'NOT_CLAIMED' } });
    expect(['COMPLETED', 'PARTIAL', 'REQUIRES_REVIEW']).toContain(r.status);
    const child = await ok('GET', `/api/projects/${p.projectId}/revisions/${r.resultRevisionId}`);
    expect(child).toMatchObject({ parentRevisionId: p.revision.id, revisionNumber: 2, qa: { status: r.details.kind === 'BLUEPRINT' ? r.details.qaStatus : '' } });
    // Common revision identity (gate L297): the result, its artifact, its manifest and the change impact all name the same revision.
    expect(r.artifacts).toEqual([expect.objectContaining({ artifactId: r.resultRevisionId, logicalComponentId: 'BUILDING_MODEL', sourceRevisionId: r.resultRevisionId,
      contentHash: child.identity.modelHash, freshness: 'current' })]);
    expect(r.manifestHref).toBe(`/api/projects/${p.projectId}/revisions/${r.resultRevisionId}/manifest`);
    const m = await manifest(p.projectId, r.resultRevisionId!);
    expect([m.identity.revisionCurrency, m.changeImpact]).toEqual(['CURRENT', r.changeImpact]);
    expect(r.changeImpact).toMatchObject({ status: 'COMPUTED', baseRevisionId: p.revision.id });
    // No render, scene or other job was created by the blueprint run.
    expect((await ok('GET', `/api/projects/${p.projectId}/jobs`)).items).toEqual([]);
    expect((await ok('GET', `/api/projects/${p.projectId}/revisions/${r.resultRevisionId}/scene/artifacts`)).items).toEqual([]);
    // The same key and body replay the stored revision instead of generating another.
    const again = await run(p.url('BLUEPRINT'), body, 200, { ...owner, 'idempotency-key': 'bp-1' });
    expect([again.replayed, again.resultRevisionId, await revisionCount(p.projectId)]).toEqual([true, r.resultRevisionId, 2]);
    // The superseded base is now a stale dependency for any further specialist run.
    const stale = await run(p.url('BLUEPRINT'), body, 200);
    expect([stale.status, stale.reasons[0]!.code, stale.written]).toEqual(['STALE_DEPENDENCY', 'BASE_REVISION_SUPERSEDED', false]);
  }, 300_000);

  it('scenario 46 and locks: limits, foreign scopes, preservation conflicts and unimplemented modules are typed refusals that store nothing', async () => {
    const p = await project('B39 refusals'), base = p.revision.id;
    const cases: [string, Json, string, string][] = [
      ['BLUEPRINT', envelope(base, 'regenerate', ['building.floor_plans'], { requirements: { ...parametricInput(true), floors: 3 } }), 'UNSUPPORTED', 'FLOOR_LIMIT_EXCEEDED'],
      ['BLUEPRINT', envelope(base, 'modify', ['building.floor_plans'], {}), 'UNSUPPORTED', 'OPERATION_NOT_SUPPORTED'],
      ['BLUEPRINT', envelope(base, 'regenerate', ['exterior.facade'], {}), 'UNSUPPORTED', 'SCOPE_NOT_SUPPORTED'],
      ['BLUEPRINT', envelope(base, 'regenerate', ['building.floor_plans'], { requirements: parametricInput(true) }, ['building.structure']), 'BLOCKED_BY_LOCK', 'PRESERVATION_CONFLICT'],
      ['MATERIALS', envelope(base, 'recompute', ['quantities'], { specification: specification() }, ['quantities']), 'BLOCKED_BY_LOCK', 'PRESERVATION_CONFLICT'],
      ['MATERIALS', envelope(base, 'recompute', ['quantities'], { specification: specification(), substitutions: [{ from: 'CEMENT', to: 'FLY_ASH' }] }), 'UNSUPPORTED',
        'SUBSTITUTION_PROVENANCE_UNAVAILABLE'],
      ['BUDGET', envelope(base, 'recompute', ['quantities'], {}), 'UNSUPPORTED', 'SCOPE_NOT_SUPPORTED'],
      ['EXTERIOR', envelope(base, 'modify', ['exterior.materials'], {}), 'UNSUPPORTED', 'MODULE_NOT_AVAILABLE'],
      ['STRUCTURAL', envelope(base, 'recompute', ['engineering.structural'], {}), 'UNSUPPORTED', 'MODULE_NOT_AVAILABLE'],
      ['INTERIOR', envelope(base, 'modify', ['interior.materials'], {}), 'UNSUPPORTED', 'MODULE_NOT_AVAILABLE'],
    ];
    for (const [module, body, status, code] of cases) {
      const r = await run(p.url(module), body, 200);
      expect([r.status, r.reasons.map(x => x.code), r.written, r.artifacts, r.resultRevisionId], `${module} ${code}`).toEqual([status, [code], false, [], null]);
    }
    expect(await revisionCount(p.projectId)).toBe(1);
    expect((await ok('GET', `/api/projects/${p.projectId}/revisions/${base}/takeoffs`)).items).toEqual([]);
    // Validation, ownership and authentication stay HTTP errors.
    for (const bad of [{ ...envelope(base, 'recompute', ['quantities']), envelopeVersion: 'v0' }, { ...envelope(base, 'recompute', ['quantities']), extra: 1 },
      envelope(base, 'recompute', ['quantities', 'quantities']), envelope(base, 'recompute', [])])
      expect((await call('POST', p.url('MATERIALS'), bad)).statusCode, JSON.stringify(bad).slice(0, 120)).toBe(400);
    expect((await call('POST', p.url('LANDSCAPE'), envelope(base, 'recompute', ['quantities']))).statusCode).toBe(400);
    expect((await call('POST', p.url('MATERIALS'), envelope(base, 'recompute', ['quantities'], { specification: {} }))).statusCode).toBe(400);
    expect((await call('POST', p.url('MATERIALS'), envelope(base, 'recompute', ['quantities'], { specification: specification() }), other)).statusCode).toBe(404);
    expect((await call('POST', p.url('MATERIALS'), envelope(base, 'recompute', ['quantities'], { specification: specification() }), {})).statusCode).toBe(401);
  }, 300_000);

  it('scenarios 37 and 38: materials track units, recipes and provenance; budget states its rate basis and never prices a missing rate as zero', async () => {
    const p = await project('B39 materials and budget'), base = p.revision.id;
    const mat = await run(p.url('MATERIALS'), envelope(base, 'recompute', ['quantities'], { specification: specification() }, ['building.geometry', 'exterior.facade']), 201);
    expect(mat).toMatchObject({ module: 'MATERIALS', written: true, resultRevisionId: null, details: { kind: 'MATERIALS', recipePack: { id: 'construction-recipes' } } });
    expect(mat.artifacts.map(a => [a.logicalComponentId, a.sourceRevisionId, a.freshness])).toEqual([['QUANTITY_TAKEOFF', base, 'current'],
      ['CONSTRUCTION_CALCULATION', base, 'current']]);
    if (mat.details.kind !== 'MATERIALS') throw new Error('unreachable');
    expect(mat.details.materials.length).toBeGreaterThan(0);
    for (const m of mat.details.materials) expect(m.unit, m.materialCode).toMatch(/\S/);
    expect(mat.status === 'PARTIAL').toBe(mat.details.constructionStatus !== 'EVALUATED' || mat.details.takeoffStatus === 'PARTIAL');
    // The artifacts are the stored engine rows, with the hashes their own routes report.
    const [takeoff, construction] = mat.artifacts;
    const t = await ok('GET', `/api/projects/${p.projectId}/revisions/${base}/takeoffs/${takeoff!.artifactId}`);
    expect([t.inputFingerprint, t.engineVersion]).toEqual([takeoff!.inputHash, takeoff!.producerVersion]);

    const cfg = { takeoffId: takeoff!.artifactId, constructionCalculationId: construction!.artifactId, costingPolicy: sampleCostingPolicy() };
    const budget = await run(p.url('BUDGET'), envelope(base, 'recompute', ['cost'], { ...cfg, rateBookId: 'sample-inr-v1' }, ['quantities']), 201);
    if (budget.details.kind !== 'BUDGET') throw new Error('unreachable');
    // Only synthetic rate books exist, so a budget always needs review; unpriced lines are listed and the complete total is withheld (scenario 38).
    expect(budget).toMatchObject({ status: 'REQUIRES_REVIEW', details: { rateBookId: 'sample-inr-v1', rateBookSynthetic: true, currency: 'INR' } });
    expect(budget.reasons.map(r => r.code)).toContain('SYNTHETIC_RATE_BOOK');
    // A complete total exists only when everything is priced from evaluated quantities; otherwise it is withheld and the reason is named.
    const codes = budget.reasons.map(r => r.code);
    expect(budget.details.completeTotal === null).toBe(budget.details.coverage !== 'FULLY_PRICED');
    expect(codes.includes('UNPRICED_LINES')).toBe(budget.details.unpricedLineIds.length > 0);
    if (budget.details.coverage !== 'FULLY_PRICED') expect(codes.some(c => c === 'UNPRICED_LINES' || c === 'UPSTREAM_PARTIAL')).toBe(true);
    expect(budget.details.pricedTotal).toMatch(/^\d+\.\d{2}$/);
    expect(budget.artifacts.map(a => [a.logicalComponentId, a.freshness])).toEqual([['QUANTITY_TAKEOFF', 'current'], ['CONSTRUCTION_CALCULATION', 'current'],
      ['BOQ_COST', 'current']]);
    // The manifest of the same revision holds the same artifacts (gate L297: the changes are fed to the shared B37 manifest).
    const m = await manifest(p.projectId, base);
    for (const a of budget.artifacts)
      expect(m.modules.find(x => x.module === a.logicalComponentId)!.artifacts!.map(x => x.artifactId), a.logicalComponentId).toContain(a.artifactId);

    // A rate basis that does not exist, or a region no rate book covers, is unsupported, not priced.
    expect((await run(p.url('BUDGET'), envelope(base, 'recompute', ['cost'], { ...cfg, rateBookId: 'in-maharashtra-2026' }), 200)).reasons[0]!.code).toBe('RATE_BOOK_UNAVAILABLE');
    expect((await run(p.url('BUDGET'), envelope(base, 'recompute', ['cost'], { ...cfg, rateBookId: 'sample-inr-v1', region: { country: 'IN', region: 'Maharashtra' } }), 200))
      .reasons[0]!.code).toBe('REGION_NOT_COVERED');

    // A budget over inputs that are no longer current is a stale dependency (scenario 39): tamper the takeoff, as a corrupted row.
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local session_replication_role = replica'); // bypass the immutability trigger to simulate corruption
      await client.query('update project_revision_takeoffs set input_fingerprint = $1 where id = $2', ['f'.repeat(64), takeoff!.artifactId]);
      await client.query('commit');
    } finally { client.release(); }
    const stale = await run(p.url('BUDGET'), envelope(base, 'recompute', ['cost'], { ...cfg, rateBookId: 'sample-inr-v2' }), 200);
    expect([stale.status, stale.reasons[0]!.code, stale.written]).toEqual(['STALE_DEPENDENCY', 'INPUT_NOT_CURRENT', false]);
    expect(stale.reasons[0]!.message).toContain('blocked');
  }, 300_000);
  it('idempotency: a reused key with a different envelope is a conflict; concurrent duplicates make one revision; a later replay reports its outputs as no longer current', async () => {
    const p = await project('B39 idempotency'), key = { ...owner, 'idempotency-key': 'idem-bp' };
    const body = envelope(p.revision.id, 'regenerate', ['building.floor_plans'], { requirements: parametricInput(false) });
    // Two identical keyed requests at once: exactly one revision is generated; the other answer is that same revision or a retryable conflict.
    const [x, y] = await Promise.all([call('POST', p.url('BLUEPRINT'), body, key), call('POST', p.url('BLUEPRINT'), body, key)]);
    const ok2 = [x, y].filter(r => r.statusCode === 201 || r.statusCode === 200).map(r => SpecialistResultSchema.parse(r.json()));
    expect(ok2.length, `${x.statusCode} ${y.statusCode}: ${y.body.slice(0, 300)}`).toBeGreaterThanOrEqual(1);
    for (const r of [x, y]) expect([200, 201, 409], r.body.slice(0, 300)).toContain(r.statusCode);
    expect(new Set(ok2.map(r => r.resultRevisionId)).size).toBe(1);
    expect(await revisionCount(p.projectId)).toBe(2);
    const first = ok2[0]!;
    // The same key with a different envelope (here only the target scope) is a conflict, as on every durable route; nothing new is generated.
    const conflict = await call('POST', p.url('BLUEPRINT'), { ...body, targetScopes: ['building.geometry'] }, key);
    expect([conflict.statusCode, conflict.json().error?.code]).toEqual([409, 'IDEMPOTENCY_CONFLICT']);
    expect(await revisionCount(p.projectId)).toBe(2);
    // Unkeyed concurrent duplicates: one commits, the other is refused by the base check or the commit's stale-base guard; never two revisions from one base.
    const q = await project('B39 unkeyed race');
    const qBody = envelope(q.revision.id, 'regenerate', ['building.floor_plans'], { requirements: parametricInput(false) });
    const race = await Promise.all([call('POST', q.url('BLUEPRINT'), qBody), call('POST', q.url('BLUEPRINT'), qBody)]);
    expect(race.filter(r => r.statusCode === 201).length, race.map(r => `${r.statusCode} ${r.body.slice(0, 200)}`).join(' | ')).toBe(1);
    expect(await revisionCount(q.projectId)).toBe(2);
    // Once a newer revision exists, replaying the first request returns the same stored revision, now reported as no longer current.
    await ok('POST', `/api/projects/${p.projectId}/revisions`, { model: (await ok('GET', `/api/projects/${p.projectId}/revisions/${first.resultRevisionId}`)).model,
      baseRevisionId: first.resultRevisionId });
    const later = await run(p.url('BLUEPRINT'), body, 200, key);
    expect([later.replayed, later.resultRevisionId, later.status, later.artifacts[0]!.freshness]).toEqual([true, first.resultRevisionId, 'STALE_DEPENDENCY', 'stale']);
    expect(later.reasons.map(r => r.code)).toContain('OUTPUT_NOT_CURRENT');
    expect(await revisionCount(p.projectId)).toBe(3);
  }, 300_000);

  it('idempotency for Materials and Budget: keyed retries replay the stored artifacts; unkeyed repeats converge on the same engine rows', async () => {
    const p = await project('B39 replay materials'), base = p.revision.id, key = { ...owner, 'idempotency-key': 'idem-mat' };
    const matBody = envelope(base, 'recompute', ['quantities'], { specification: specification() });
    const m1 = await run(p.url('MATERIALS'), matBody, 201, key), m2 = await run(p.url('MATERIALS'), matBody, 200, key);
    expect([m2.replayed, m2.artifacts.map(a => a.artifactId)]).toEqual([true, m1.artifacts.map(a => a.artifactId)]);
    const unkeyed = await run(p.url('MATERIALS'), matBody, 201);
    expect(unkeyed.artifacts.map(a => a.artifactId)).toEqual(m1.artifacts.map(a => a.artifactId));
    expect((await ok('GET', `/api/projects/${p.projectId}/revisions/${base}/takeoffs`)).items).toHaveLength(1);
    const cfg = { takeoffId: m1.artifacts[0]!.artifactId, constructionCalculationId: m1.artifacts[1]!.artifactId, costingPolicy: sampleCostingPolicy(), rateBookId: 'sample-inr-v1' };
    const budgetKey = { ...owner, 'idempotency-key': 'idem-budget' }, budgetBody = envelope(base, 'recompute', ['cost'], cfg);
    const b1 = await run(p.url('BUDGET'), budgetBody, 201, budgetKey), b2 = await run(p.url('BUDGET'), budgetBody, 200, budgetKey);
    expect([b2.replayed, b2.artifacts[2]!.artifactId, b2.status]).toEqual([true, b1.artifacts[2]!.artifactId, b1.status]);
    expect((await ok('GET', `/api/projects/${p.projectId}/revisions/${base}/cost-estimates`)).items).toHaveLength(1);
    // A different budget body under the same key is a conflict, not a silent replay of the first estimate.
    const conflict = await call('POST', p.url('BUDGET'), envelope(base, 'recompute', ['cost'], { ...cfg, rateBookId: 'sample-inr-v2' }), budgetKey);
    expect([conflict.statusCode, conflict.json().error?.code]).toEqual([409, 'IDEMPOTENCY_CONFLICT']);
  }, 300_000);

  it('a room count above the generator limit is a typed UNSUPPORTED result, like the floor limit (scope §4 row 1)', async () => {
    const p = await project('B39 room limit');
    const requirements = { ...parametricInput(false), rooms: [{ type: 'bedroom', count: 13 }, { type: 'bathroom', count: 12 }] };
    const r = await run(p.url('BLUEPRINT'), envelope(p.revision.id, 'regenerate', ['building.floor_plans'], { requirements }), 200);
    expect([r.status, r.reasons.map(x => x.code), r.written]).toEqual(['UNSUPPORTED', ['ROOM_LIMIT_EXCEEDED'], false]);
    expect(await revisionCount(p.projectId)).toBe(1);
    // Within the limit, an invalid room entry stays a validation error.
    const bad = { ...parametricInput(false), rooms: [{ type: 'ballroom', count: 1 }] };
    expect((await call('POST', p.url('BLUEPRINT'), envelope(p.revision.id, 'regenerate', ['building.floor_plans'], { requirements: bad }))).statusCode).toBe(400);
  }, 120_000);

  it('a manifest that cannot be read after a write gives a controlled result: written, freshness unverified, review required (no error inviting a duplicate)', async () => {
    const p = await project('B39 manifest unavailable');
    const repo = backend.repository('owner');
    // The B37 manifest refuses with 409 when the pointer appears to move during its read; simulate that only after the write.
    const skewed: Repository = { ...repo, designConceptRpc: async (name, args) => {
      const r = await repo.designConceptRpc!(name, args) as Json;
      return args.p_action === 'list' ? { ...r, projectCurrentRevisionId: randomUUID() } : r;
    } };
    const request = SpecialistRequestSchema.parse(envelope(p.revision.id, 'recompute', ['quantities'], { specification: specification() }));
    const r = SpecialistResultSchema.parse(await runSpecialist(skewed, ownerId, p.projectId, 'MATERIALS', request, { secret }));
    expect([r.written, r.status, r.artifacts.map(a => a.freshness)]).toEqual([true, 'REQUIRES_REVIEW', [null, null]]);
    expect(r.reasons.map(x => x.code)).toEqual(expect.arrayContaining(['MANIFEST_UNAVAILABLE']));
    // The stored rows are the engines' own; reading again through the normal path reports them current.
    const again = await run(p.url('MATERIALS'), envelope(p.revision.id, 'recompute', ['quantities'], { specification: specification() }), 201);
    expect([again.artifacts.map(a => a.artifactId), again.artifacts.map(a => a.freshness)]).toEqual([r.artifacts.map(a => a.artifactId), ['current', 'current']]);
  }, 180_000);
});

