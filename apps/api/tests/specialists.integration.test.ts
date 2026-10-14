import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleCostingPolicy } from '@designflow/boq-cost';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { specification } from '../../../packages/construction-calculations/tests/fixtures.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { frameInput } from '../../../test-support/structural-fixtures.js';
import { png } from '../../../test-support/reference-fixtures.js';
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

describe('B39 S1/S2 specialist envelope on PostgreSQL (Blueprint, Materials, Budget, Exterior, Structural; Interior refused until D-12)', () => {
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

  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, headers: Record<string, string> = owner) =>
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

  it('scenario 46 and locks: limits, foreign scopes, preservation conflicts, geometry, validated solvers and Interior are typed refusals that store nothing', async () => {
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
      ['EXTERIOR', envelope(base, 'modify', ['exterior.facade', 'building.geometry'], {}), 'UNSUPPORTED', 'ENVELOPE_GEOMETRY_REGENERATION'],
      ['EXTERIOR', envelope(base, 'restore', ['exterior.facade'], {}), 'UNSUPPORTED', 'OPERATION_NOT_SUPPORTED'],
      ['EXTERIOR', envelope(base, 'modify', ['exterior.materials'], {}, ['exterior.materials']), 'BLOCKED_BY_LOCK', 'PRESERVATION_CONFLICT'],
      ['EXTERIOR', envelope(base, 'modify', ['exterior.materials'], {}, ['scene3d']), 'BLOCKED_BY_LOCK', 'PRESERVATION_CONFLICT'],
      ['STRUCTURAL', envelope(base, 'recompute', ['engineering.structural'], { analysisType: 'SEISMIC', input: {} }), 'UNSUPPORTED', 'NO_VALIDATED_SOLVER'],
      ['STRUCTURAL', envelope(base, 'recompute', ['engineering.structural'], { analysisType: 'MEMBER_DESIGN', input: {} }), 'UNSUPPORTED', 'NO_VALIDATED_SOLVER'],
      ['STRUCTURAL', envelope(base, 'recompute', ['engineering.environmental'], {}), 'UNSUPPORTED', 'SCOPE_NOT_SUPPORTED'],
      ['INTERIOR', envelope(base, 'modify', ['interior.materials'], {}), 'UNSUPPORTED', 'MODULE_NOT_AVAILABLE'],
    ];
    for (const [module, body, status, code] of cases) {
      const r = await run(p.url(module), body, 200);
      expect([r.status, r.reasons.map(x => x.code), r.written, r.artifacts, r.resultRevisionId], `${module} ${code}`).toEqual([status, [code], false, [], null]);
    }
    expect(await revisionCount(p.projectId)).toBe(1);
    expect((await ok('GET', `/api/projects/${p.projectId}/revisions/${base}/takeoffs`)).items).toEqual([]);
    expect((await ok('GET', `/api/projects/${p.projectId}/revision-operations`)).items).toEqual([]);
    expect((await ok('GET', `/api/projects/${p.projectId}/revisions/${base}/structural/analyses`)).items).toEqual([]);
    // The Interior refusal names the deferred decision and does not pass the advisory concepts off as an implementation.
    const interior = await run(p.url('INTERIOR'), envelope(base, 'modify', ['interior.materials'], {}), 200);
    expect(interior.reasons[0]!.message).toMatch(/D-12/);
    expect(interior.reasons[0]!.message).toMatch(/not an Interior implementation/);
    // Validation, ownership and authentication stay HTTP errors.
    expect((await call('POST', p.url('EXTERIOR'), envelope(base, 'modify', ['exterior.facade'], {}))).statusCode).toBe(400);
    expect((await call('POST', p.url('STRUCTURAL'), envelope(base, 'recompute', ['engineering.structural'], { input: { version: 'x' } }))).statusCode).toBe(400);
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

  it('scenario 34 and 42: an Exterior cladding change is a Phase 30 preflight with the plan and structure locks; the existing routes complete it, geometry untouched', async () => {
    const p = await project('B39 exterior'), base = p.revision.id, key = { ...owner, 'idempotency-key': 'ext-1' };
    const appearance = { target: { kind: 'EXTERIOR_WALLS', facades: ['NORTH', 'EAST', 'SOUTH', 'WEST'] }, finish: { presetId: 'warm-render' } };
    const body = envelope(base, 'modify', ['exterior.facade', 'exterior.materials'], { appearance }, ['building.structure', 'building.floor_plans', 'quantities']);
    const r = await run(p.url('EXTERIOR'), body, 201, key);
    if (r.details.kind !== 'EXTERIOR') throw new Error('unreachable');
    expect(r).toMatchObject({ module: 'EXTERIOR', status: 'AWAITING_CONSENT', written: true, replayed: false, resultRevisionId: null, jobIds: [], artifacts: [],
      quote: { externalCostUsd: 0, externalProviders: [] }, details: { preflightStatus: 'AWAITING_CONSENT', operationKind: 'APPEARANCE_MODIFY',
        claims: { physicalGlazing: 'NOT_CLAIMED', materialPerformance: 'NOT_CLAIMED', thermal: 'NOT_CLAIMED', photorealism: 'NOT_CLAIMED' } } });
    expect(r.reasons.map(x => x.code)).toEqual(['CONSENT_REQUIRED', 'DOWNSTREAM_REGENERATION']);
    // The envelope's locks are the Phase 30 user locks; quantities have no Phase 30 counterpart and are held by the geometry lock.
    const userLocks = r.locks.filter(l => l.origin === 'USER').map(l => l.scope).sort();
    expect(userLocks).toEqual(['FLOOR_PLANS', 'STRUCTURE']);
    expect(r.locks.some(l => l.origin === 'SYSTEM' && l.granularity === 'EXACT_BYTES')).toBe(true);
    const op = await ok('GET', r.details.next.operationHref);
    expect([op.id, op.status, op.kind, op.preflightHash]).toEqual([r.operationId, 'AWAITING_CONSENT', 'APPEARANCE_MODIFY', r.details.preflightHash]);
    // A keyed retry replays the same preflight; nothing else is stored.
    const again = await run(p.url('EXTERIOR'), body, 200, key);
    expect([again.replayed, again.operationId]).toEqual([true, r.operationId]);
    expect((await ok('GET', `/api/projects/${p.projectId}/revision-operations`)).items).toHaveLength(1);
    // The existing Phase 30 routes complete it: consent and execute, compare (geometry and model identical), approve.
    const cand = await ok('POST', r.details.next.executeHref, { preflightHash: r.details.preflightHash, consent: { acceptLocks: true, acceptQuote: true } }, 200);
    const cmp = await ok('GET', r.details.next.comparisonHref);
    expect(cmp.hashes).toMatchObject({ modelIdentical: true, geometryIdentical: true });
    const child = (await ok('POST', r.details.next.approveHref, { preflightHash: r.details.preflightHash, candidateHash: cand.candidateHash })).commit.revision as Json;
    const m = await manifest(p.projectId, child.id);
    expect(m.identity.modelHash).toBe((await manifest(p.projectId, base)).identity.modelHash);
    expect(m.modules.find(x => x.module === 'APPEARANCE_VARIANT')).toMatchObject({ availability: 'AVAILABLE', freshness: { state: 'current' } });
    expect(m.lineage.operation).toMatchObject({ status: 'RECORDED', operationId: r.operationId, kind: 'APPEARANCE_MODIFY' });
    // The superseded base is now a stale dependency for the next Exterior request.
    const stale = await run(p.url('EXTERIOR'), envelope(base, 'modify', ['exterior.facade'], { appearance }), 200);
    expect([stale.status, stale.reasons[0]!.code, stale.written]).toEqual(['STALE_DEPENDENCY', 'BASE_REVISION_SUPERSEDED', false]);
  }, 300_000);

  it('Exterior natural language goes through the Phase 30 planner: a supported finish is a preflight; glazing geometry and interior finishes are typed refusals', async () => {
    const p = await project('B39 exterior text'), base = p.revision.id;
    const text = 'Redesign the exterior of my building using a contemporary glass-inspired façade. Keep the exact floor plans, internal rooms, stairs, structure, '
      + 'building dimensions, and existing interior unchanged.';
    const glazing = await run(p.url('EXTERIOR'), { ...envelope(base, 'modify', ['exterior.facade'], {}),
      instruction: 'Make the windows larger and increase the glazing area on the south facade.' }, 200);
    expect([glazing.status, glazing.written, glazing.operationId]).toEqual(['UNSUPPORTED', false, null]);
    expect(glazing.reasons.map(x => x.code)).toContain('GEOMETRY_MODIFICATION_NOT_SUPPORTED');
    expect(glazing.impacts.length).toBeGreaterThan(0);
    const interior = await run(p.url('EXTERIOR'), { ...envelope(base, 'modify', ['exterior.facade'], {}), instruction: 'Paint the interior walls white.' }, 200);
    expect([interior.status, interior.reasons[0]!.code, interior.written]).toEqual(['UNSUPPORTED', 'INTERIOR_FINISH_NOT_SUPPORTED', false]);
    const restore = await run(p.url('EXTERIOR'), { ...envelope(base, 'modify', ['exterior.facade'], {}), instruction: 'Restore revision 1' }, 200);
    expect([restore.status, restore.reasons[0]!.code, restore.written]).toEqual(['UNSUPPORTED', 'OPERATION_NOT_SUPPORTED', false]);
    // A structured change the planner cannot place (an unknown level) is a clarification, planned read only.
    const unknownLevel = await run(p.url('EXTERIOR'), envelope(base, 'modify', ['exterior.facade'], { appearance: {
      target: { kind: 'EXTERIOR_WALLS', facades: ['NORTH'], levelIds: ['no-such-level'] }, finish: { presetId: 'light-stone' } } }), 200);
    expect([unknownLevel.status, unknownLevel.reasons[0]!.code, unknownLevel.written, unknownLevel.operationId]).toEqual(['NEEDS_CLARIFICATION', 'UNKNOWN_LEVEL', false, null]);
    // No refusal or clarification stored an operation.
    expect((await ok('GET', `/api/projects/${p.projectId}/revision-operations`)).items).toEqual([]);
    const r = await run(p.url('EXTERIOR'), { ...envelope(base, 'modify', ['exterior.facade'], {}, ['interior.layout']), instruction: text }, 201);
    expect([r.status, r.written, r.details.kind]).toEqual(['AWAITING_CONSENT', true, 'EXTERIOR']);
    // The planner's preservation phrases and the envelope's lock both reach the stored operation.
    expect(r.locks.filter(l => l.origin === 'USER').map(l => l.scope)).toEqual(expect.arrayContaining(['FLOOR_PLANS', 'STRUCTURE', 'ROOMS']));
  }, 300_000);

  it('scenario 36: Structural runs the bounded linear static frame analysis, always REQUIRES_REVIEW, never certified; the analysis is in the manifest', async () => {
    const projectId = (await ok('POST', '/api/projects', { title: 'B39 structural' })).id as string;
    const revision = (await ok('POST', `/api/projects/${projectId}/revisions`, { model: authored() })).revision as Json;
    const url = `/api/projects/${projectId}/specialists/STRUCTURAL/requests`, key = { ...owner, 'idempotency-key': 'st-1' };
    const body = envelope(revision.id, 'recompute', ['engineering.structural'], { input: frameInput(revision.model) }, ['building.geometry', 'quantities']);
    const r = await run(url, body, 201, key);
    if (r.details.kind !== 'STRUCTURAL') throw new Error('unreachable');
    expect(r).toMatchObject({ module: 'STRUCTURAL', status: 'REQUIRES_REVIEW', written: true, operationId: null, jobIds: [],
      details: { analysisType: 'LINEAR_STATIC', analysisStatus: 'ANALYZED', validationStatus: 'VALIDATED',
        engineClaims: { designVerification: 'NOT_EVALUATED', codeCompliance: 'NOT_CLAIMED', certification: 'NOT_CLAIMED', constructionSuitability: 'NOT_CLAIMED' } },
      claims: { engineeringCorrectness: 'NOT_CLAIMED', solverValidation: 'NOT_CLAIMED', professionalReview: 'NOT_CLAIMED' } });
    expect(r.reasons.map(x => x.code)).toEqual(['PROFESSIONAL_REVIEW_REQUIRED']);
    expect(r.details.assumptions.length).toBeGreaterThan(0);
    expect(r.artifacts).toEqual([expect.objectContaining({ logicalComponentId: 'STRUCTURAL_ANALYSIS', sourceRevisionId: revision.id, freshness: 'current' })]);
    // The artifact is the stored analysis, with the hashes its own route reports, and it is in the same revision's manifest (gate L297).
    const stored = await ok('GET', `/api/projects/${projectId}/revisions/${revision.id}/structural/analyses/${r.artifacts[0]!.artifactId}`);
    expect([stored.inputHash, stored.analysisVersion]).toEqual([r.artifacts[0]!.inputHash, r.artifacts[0]!.producerVersion]);
    const m = await manifest(projectId, revision.id);
    expect(m.modules.find(x => x.module === 'STRUCTURAL_ANALYSIS')!.artifacts!.map(a => a.artifactId)).toContain(r.artifacts[0]!.artifactId);
    const again = await run(url, body, 200, key);
    expect([again.replayed, again.artifacts[0]!.artifactId]).toEqual([true, r.artifacts[0]!.artifactId]);
    expect((await ok('GET', `/api/projects/${projectId}/revisions/${revision.id}/structural/analyses`)).items).toHaveLength(1);
  }, 300_000);

  it('references and an execution-cost ceiling (ROADMAP L288): active references are recorded, not consumed; anything else is refused before running', async () => {
    const p = await project('B39 references'), base = p.revision.id, root = `/api/projects/${p.projectId}/references`;
    const up = await app.inject({ method: 'POST', url: `${root}?purpose=SITE_PHOTO`, headers: { ...owner, 'content-type': 'image/png' }, payload: png({ text: true }) });
    expect(up.statusCode, up.body.slice(0, 300)).toBe(201);
    const ref = up.json() as Json;
    const body = { ...envelope(base, 'recompute', ['quantities'], { specification: specification() }), referenceIds: [ref.id], budget: { ceiling: '0', currency: 'INR' } };
    const r = await run(p.url('MATERIALS'), body, 201);
    expect([r.references, r.budget]).toEqual([[{ referenceId: ref.id, purpose: 'SITE_PHOTO', mediaType: 'image/png', storedSha256: ref.storedSha256, use: 'RECORDED_NOT_CONSUMED' }],
      { ceiling: '0', currency: 'INR', quotedExternalCost: '0', withinCeiling: true }]);
    // Refusals echo them too, and store nothing.
    const refused = await run(p.url('INTERIOR'), { ...envelope(base, 'modify', ['interior.materials'], {}), referenceIds: [ref.id] }, 200);
    expect([refused.status, refused.references.map(x => x.referenceId), refused.budget]).toEqual(['UNSUPPORTED', [ref.id], null]);
    // An unknown, foreign or archived reference is refused before anything runs.
    for (const referenceId of [randomUUID()]) {
      const bad = await call('POST', p.url('MATERIALS'), { ...body, referenceIds: [referenceId] });
      expect([bad.statusCode, bad.json().error.code]).toEqual([422, 'SPECIALIST_REFERENCE_INVALID']);
    }
    const q = await project('B39 foreign reference');
    const foreign = await call('POST', q.url('MATERIALS'), { ...envelope(q.revision.id, 'recompute', ['quantities'], { specification: specification() }), referenceIds: [ref.id] });
    expect([foreign.statusCode, foreign.json().error.code]).toEqual([422, 'SPECIALIST_REFERENCE_INVALID']);
    expect((await call('PATCH', `${root}/${ref.id}`, { status: 'ARCHIVED' })).statusCode).toBe(200);
    const archived = await call('POST', p.url('MATERIALS'), body);
    expect([archived.statusCode, archived.json().error.code]).toEqual([422, 'SPECIALIST_REFERENCE_INVALID']);
    expect((await ok('GET', `/api/projects/${q.projectId}/revisions/${q.revision.id}/takeoffs`)).items).toEqual([]);
  }, 300_000);

  it('scenario 39 and gate L297: once one specialist commits a new revision, every other specialist output and candidate of the old base is surfaced as stale and blocked', async () => {
    // One authored base (the structural source profile), with Materials, Budget, Structural and an executed Exterior candidate all on it.
    const projectId = (await ok('POST', '/api/projects', { title: 'B39 cross-module propagation' })).id as string;
    const base = (await ok('POST', `/api/projects/${projectId}/revisions`, { model: authored() })).revision as Json;
    const url = (module: string) => `/api/projects/${projectId}/specialists/${module}/requests`;
    const materialsBody = envelope(base.id, 'recompute', ['quantities'], { specification: specification() });
    const mat = await run(url('MATERIALS'), materialsBody, 201);
    const [takeoff, construction] = mat.artifacts;
    const budgetBody = envelope(base.id, 'recompute', ['cost'], { takeoffId: takeoff!.artifactId, constructionCalculationId: construction!.artifactId,
      costingPolicy: sampleCostingPolicy(), rateBookId: 'sample-inr-v1' });
    const budget = await run(url('BUDGET'), budgetBody, 201);
    const structuralBody = envelope(base.id, 'recompute', ['engineering.structural'], { input: frameInput(base.model) });
    const structural = await run(url('STRUCTURAL'), structuralBody, 201);
    const exteriorBody = envelope(base.id, 'modify', ['exterior.facade'],
      { appearance: { target: { kind: 'EXTERIOR_WALLS', facades: ['NORTH', 'EAST', 'SOUTH', 'WEST'] }, finish: { presetId: 'warm-render' } } }, ['building.structure']);
    const exterior = await run(url('EXTERIOR'), exteriorBody, 201);
    if (exterior.details.kind !== 'EXTERIOR') throw new Error('unreachable');
    const candidate = await ok('POST', exterior.details.next.executeHref,
      { preflightHash: exterior.details.preflightHash, consent: { acceptLocks: true, acceptQuote: true } }, 200);
    // One source revision: every derived output names the base and is current in the base's manifest.
    const outputs = [...mat.artifacts, ...budget.artifacts, ...structural.artifacts];
    expect(outputs.map(a => [a.sourceRevisionId, a.freshness])).toEqual(outputs.map(() => [base.id, 'current']));

    // The Blueprint specialist commits a new revision from the same base.
    const blueprint = await run(url('BLUEPRINT'), envelope(base.id, 'regenerate', ['building.floor_plans'], { requirements: parametricInput(false) }), 201);
    const next = blueprint.resultRevisionId!;
    expect((await ok('GET', `/api/projects/${projectId}`)).currentRevisionId).toBe(next);

    // Surfaced: the base's manifest reports every one of those outputs as stale, read from the B37 manifest, never recomputed by the envelope.
    const m = await manifest(projectId, base.id);
    expect(m.identity.revisionCurrency).not.toBe('CURRENT');
    for (const a of outputs)
      expect(m.modules.find(x => x.module === a.logicalComponentId)!.artifacts!.find(x => x.artifactId === a.artifactId)!.freshness.state, a.logicalComponentId).toBe('stale');

    // Blocked when consequential: the pending Exterior candidate cannot be approved over the new revision (Phase 30 stale-base guard)...
    const approve = await call('POST', exterior.details.next.approveHref, { preflightHash: exterior.details.preflightHash, candidateHash: candidate.candidateHash });
    expect([approve.statusCode, approve.json().error.code]).toEqual([409, 'REVISION_BASE_STALE']);
    expect((await ok('GET', exterior.details.next.operationHref)).status).toBe('STALE_BASE');
    expect([(await ok('GET', `/api/projects/${projectId}`)).currentRevisionId, await revisionCount(projectId)]).toEqual([next, 2]);
    // ...and no specialist builds on the superseded base: each answers STALE_DEPENDENCY and stores nothing.
    for (const [module, body] of [['MATERIALS', materialsBody], ['BUDGET', { ...budgetBody, outputConfig: { ...budgetBody.outputConfig, rateBookId: 'sample-inr-v2' } }],
      ['STRUCTURAL', structuralBody], ['EXTERIOR', exteriorBody]] as const) {
      const refused = await run(url(module), body, 200);
      expect([refused.status, refused.reasons[0]!.code, refused.written], module).toEqual(['STALE_DEPENDENCY', 'BASE_REVISION_SUPERSEDED', false]);
    }
    expect((await ok('GET', `/api/projects/${projectId}/revisions/${base.id}/cost-estimates`)).items).toHaveLength(1);
    expect((await ok('GET', `/api/projects/${projectId}/revisions/${base.id}/structural/analyses`)).items).toHaveLength(1);
    expect((await ok('GET', `/api/projects/${projectId}/revision-operations`)).items).toHaveLength(1);
  }, 300_000);
});

