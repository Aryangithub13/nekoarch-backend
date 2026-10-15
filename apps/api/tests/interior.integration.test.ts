import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { costHash } from '@designflow/boq-cost';
import { asPrincipal, createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { specification } from '../../../packages/construction-calculations/tests/fixtures.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { ProjectManifestSchema } from '../src/contracts/project-manifest.js';
import { SpecialistResultSchema, SPECIALIST_VERSION } from '../src/contracts/specialists.js';
import { RevisionComparisonSchema } from '../src/revision/contracts.js';
import { stripSpaceFinishes } from '../src/revision/interior.js';
import { modelHash } from '../src/lib/generation-identity.js';
import { signProjectCommit } from '../src/services/project-service.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const owner = { authorization: 'Bearer owner' };
const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false',
  PROJECT_COMMIT_SECRET: secret });
const FINISHES = [{ spaceId: 'foyer', finishes: { floor: 'ceramic-tile', walls: 'paint-warm-neutral' } }, { spaceId: 'studio', finishes: { floor: 'engineered-timber', ceiling: 'acoustic-tile' } }];
const consent = { acceptLocks: true, acceptQuote: true };
const EXTERIOR = { appearance: { target: { kind: 'EXTERIOR_WALLS', facades: ['NORTH', 'EAST', 'SOUTH', 'WEST'] }, finish: { presetId: 'warm-render' } } };

/** Shared by both suites: a running app over a database with every migration (or the upgrade under test) applied. */
function harness(db: () => Awaited<ReturnType<typeof startTestDatabase>>, app: () => ReturnType<typeof buildApp>) {
  const call = (method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = owner) =>
    app().inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as Json }) });
  const ok = async (method: 'GET' | 'POST', url: string, payload?: unknown, status = method === 'POST' ? 201 : 200) => {
    const r = await call(method, url, payload);
    expect(r.statusCode, `${method} ${url}: ${r.body.slice(0, 500)}`).toBe(status);
    return r.json() as Json;
  };
  const project = async (title: string) => {
    const projectId = (await ok('POST', '/api/projects', { title })).id as string;
    const revision = (await ok('POST', `/api/projects/${projectId}/revisions`, { model: authored() })).revision as Json;
    return { projectId, revision, url: (module: string) => `/api/projects/${projectId}/specialists/${module}/requests` };
  };
  const envelope = (baseRevisionId: string, operation: string, targetScopes: string[], outputConfig: Json = {}, preserveScopes: string[] = []) =>
    ({ envelopeVersion: SPECIALIST_VERSION, baseRevisionId, operation, targetScopes, preserveScopes, outputConfig });
  const run = async (url: string, body: Json, status: number, headers: Record<string, string> = owner) => {
    const r = await call('POST', url, body, headers);
    expect(r.statusCode, r.body.slice(0, 600)).toBe(status);
    return SpecialistResultSchema.parse(r.json());
  };
  const manifest = async (projectId: string, revisionId: string) => ProjectManifestSchema.parse(await ok('GET', `/api/projects/${projectId}/revisions/${revisionId}/manifest`));
  const operations = async (projectId: string) => ((await ok('GET', `/api/projects/${projectId}/revision-operations`)).items as Json[]).length;
  /** Exterior through the envelope and the existing Phase 30 routes, to the committed child revision. */
  const exterior = async (p: { url: (m: string) => string }, baseRevisionId: string) => {
    const r = await run(p.url('EXTERIOR'), envelope(baseRevisionId, 'modify', ['exterior.facade'], EXTERIOR), 201);
    if (r.details.kind !== 'EXTERIOR') throw new Error('unreachable');
    const cand = await ok('POST', r.details.next.executeHref, { preflightHash: r.details.preflightHash, consent }, 200);
    return (await ok('POST', r.details.next.approveHref, { preflightHash: r.details.preflightHash, candidateHash: cand.candidateHash })).commit.revision as Json;
  };
  void db;
  return { call, ok, project, envelope, run, manifest, operations, exterior };
}

describe('B39 S3 Interior specialist on PostgreSQL (owner decision D-12, migration 0029)', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, ownerId: string, secret: string;
  beforeAll(async () => {
    db = await startTestDatabase();
    ownerId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId }), captureError: () => undefined });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.stop(); });
  const h = harness(() => db, () => app);

  it('scenario 33: a design-only finish change is a Phase 30 candidate that keeps exterior, structure and room geometry identical; approval commits it', async () => {
    const p = await h.project('B39 interior'), base = p.revision as Json, key = { ...owner, 'idempotency-key': 'int-1' };
    const mat = await h.run(p.url('MATERIALS'), h.envelope(base.id, 'recompute', ['quantities'], { specification: specification() }), 201);
    const body = h.envelope(base.id, 'modify', ['interior.materials'], { finishes: FINISHES }, ['building.structure', 'exterior.facade', 'interior.layout']);
    const r = await h.run(p.url('INTERIOR'), body, 201, key);
    if (r.details.kind !== 'INTERIOR') throw new Error('unreachable');
    expect(r).toMatchObject({ module: 'INTERIOR', status: 'AWAITING_CONSENT', written: true, resultRevisionId: null, jobIds: [], artifacts: [],
      quote: { execution: 'LOCAL_DETERMINISTIC', externalCostUsd: 0 }, claims: { engineeringCorrectness: 'NOT_CLAIMED' },
      details: { preflightStatus: 'AWAITING_CONSENT', operationKind: 'INTERIOR_FINISH_MODIFY', geometryModelHash: modelHash(base.model),
        claims: { productSpecification: 'NOT_CLAIMED', fireRating: 'NOT_CLAIMED', acousticPerformance: 'NOT_CLAIMED', slipResistance: 'NOT_CLAIMED' } } });
    expect(r.reasons.map(x => x.code)).toEqual(['CONSENT_REQUIRED', 'DOWNSTREAM_REGENERATION']);
    expect(r.details.spaces).toEqual([{ spaceId: 'foyer', levelId: 'ground', name: 'Foyer', before: null, after: FINISHES[0]!.finishes },
      { spaceId: 'studio', levelId: 'ground', name: 'Studio', before: null, after: FINISHES[1]!.finishes }]);
    // System locks hold geometry, exterior and structure; the envelope's preservations are the user's Phase 30 locks.
    expect(r.locks.filter(l => l.origin === 'SYSTEM').map(l => l.scope)).toEqual(['BUILDING_GEOMETRY', 'EXTERIOR', 'STRUCTURE', 'INTERIOR_FINISHES']);
    expect(r.locks.filter(l => l.origin === 'USER').map(l => l.scope).sort()).toEqual(['ROOMS', 'STRUCTURE']);
    // A keyed retry replays the stored preflight; nothing else is stored.
    expect((await h.run(p.url('INTERIOR'), body, 200, key))).toMatchObject({ replayed: true, operationId: r.operationId });
    expect(await h.operations(p.projectId)).toBe(1);

    // The existing Phase 30 routes complete it: consent and execute (a derived candidate, nothing compiled), compare, approve.
    const cand = await h.ok('POST', r.details.next.executeHref, { preflightHash: r.details.preflightHash, consent }, 200);
    expect(cand).toMatchObject({ status: 'CANDIDATE_READY', kind: 'INTERIOR_FINISH_MODIFY', candidate: null,
      validation: { status: 'VALID', validatorVersion: 'revision-interior-validator-v1', finishOnly: true, candidateModelHash: r.details.candidateModelHash } });
    const cmp = RevisionComparisonSchema.parse(await h.ok('GET', r.details.next.comparisonHref));
    expect(cmp).toMatchObject({ kind: 'INTERIOR_FINISH_MODIFY', candidate: { modelHash: r.details.candidateModelHash, geometryModelHash: r.details.geometryModelHash },
      changes: { spaces: r.details.spaces, geometryIdentical: true, exteriorUnchanged: true }, approvalBlockers: [] });
    const child = (await h.ok('POST', r.details.next.approveHref, { preflightHash: r.details.preflightHash, candidateHash: cand.candidateHash })).commit.revision as Json;
    // The committed model is the previewed candidate; without its finishes it is exactly the base (site, levels, walls, openings, stairs, structure).
    expect([child.parentRevisionId, modelHash(child.model)]).toEqual([base.id, r.details.candidateModelHash]);
    expect(stripSpaceFinishes(child.model)).toEqual(base.model);
    expect(child.model.spaces.map((s: Json) => [s.id, s.finishes])).toEqual(FINISHES.map(f => [f.spaceId, f.finishes]));
    expect(child.qa.status).not.toBe('FAIL');
    const m = await h.manifest(p.projectId, child.id);
    expect([m.identity.revisionCurrency, m.lineage.modelEquivalentToParent, m.lineage.operation])
      .toEqual(['CURRENT', false, expect.objectContaining({ status: 'RECORDED', operationId: r.operationId, kind: 'INTERIOR_FINISH_MODIFY' })]);
    // The model changed, so the base's quantities are stale against it (U2 applies to identical models only).
    const old = await h.manifest(p.projectId, base.id);
    for (const a of mat.artifacts) expect(old.modules.find(x => x.module === a.logicalComponentId)!.artifacts!.find(x => x.artifactId === a.artifactId)!.freshness,
      a.logicalComponentId).toMatchObject({ state: 'stale', targetRevisionId: child.id });

    // Order: an exterior finish on the finished model works...
    const third = await h.exterior(p, child.id);
    expect(third.model.spaces.map((s: Json) => s.finishes)).toEqual(FINISHES.map(f => f.finishes));
    // ...but interior finishes on a revision carrying an appearance variant are refused: the variant is bound to the exact model. Nothing is stored.
    const before = await h.operations(p.projectId);
    const refused = await h.run(p.url('INTERIOR'), h.envelope(third.id, 'modify', ['interior.materials'], { finishes: [{ spaceId: 'foyer', finishes: { floor: 'carpet' } }] }), 200);
    expect([refused.status, refused.reasons[0]!.code, refused.written]).toEqual(['UNSUPPORTED', 'APPEARANCE_VARIANT_PRESENT', false]);
    expect(await h.operations(p.projectId)).toBe(before);
  }, 300_000);

  it('typed refusals store nothing: space planning asks for scope expansion; furnishings, unknown spaces, no-ops and lock conflicts are refused', async () => {
    const p = await h.project('B39 interior refusals'), base = p.revision.id as string;
    const finishes = { finishes: [{ spaceId: 'foyer', finishes: { floor: 'vinyl' } }] };
    const cases: [Json, string, string][] = [
      [h.envelope(base, 'modify', ['interior.layout'], finishes), 'UNSUPPORTED', 'SCOPE_EXPANSION_REQUIRED'],
      [h.envelope(base, 'modify', ['interior.materials', 'building.floor_plans'], finishes), 'UNSUPPORTED', 'SCOPE_EXPANSION_REQUIRED'],
      [h.envelope(base, 'modify', ['interior.materials'], { ...finishes, furnishings: [{ item: 'sofa' }] }), 'UNSUPPORTED', 'FURNISHINGS_NOT_SUPPORTED'],
      [h.envelope(base, 'modify', ['interior.materials'], { finishes: [{ spaceId: 'cellar', finishes: { floor: 'vinyl' } }] }), 'NEEDS_CLARIFICATION', 'UNKNOWN_SPACE'],
      [h.envelope(base, 'modify', ['interior.materials'], finishes, ['interior.materials']), 'BLOCKED_BY_LOCK', 'PRESERVATION_CONFLICT'],
      [h.envelope(base, 'regenerate', ['interior.materials'], finishes), 'UNSUPPORTED', 'OPERATION_NOT_SUPPORTED'],
    ];
    for (const [body, status, code] of cases) {
      const r = await h.run(p.url('INTERIOR'), body, 200);
      expect([r.status, r.reasons[0]!.code, r.written, r.operationId], code).toEqual([status, code, false, null]);
    }
    const planning = await h.run(p.url('INTERIOR'), cases[0]![0], 200);
    expect(planning.reasons[0]!.message).toMatch(/BLUEPRINT/);
    // A storey lock that covers a named space is a Phase 30 lock conflict, planned read only.
    const level = await h.run(p.url('INTERIOR'), h.envelope(base, 'modify', ['interior.materials'], finishes), 201);
    expect(level.status).toBe('AWAITING_CONSENT');
    const ops = `/api/projects/${p.projectId}/revision-operations`;
    const lockedLevel = await h.ok('POST', ops, { baseRevisionId: base, request: { operation: { kind: 'INTERIOR_FINISH_MODIFY', assignments: finishes.finishes,
      preserve: [{ scope: 'LEVEL', levelId: 'ground' }] } } });
    expect([lockedLevel.status, lockedLevel.preflight.blockers[0].code]).toEqual(['BLOCKED_BY_LOCK', 'LOCK_CONFLICT']);
    // A no-op: the same finishes again, once committed.
    const cand = await h.ok('POST', `${ops}/${level.operationId}/execute`, { preflightHash: (level.details as Json).preflightHash, consent }, 200);
    const child = (await h.ok('POST', `${ops}/${level.operationId}/approve`, { preflightHash: (level.details as Json).preflightHash, candidateHash: cand.candidateHash })).commit.revision as Json;
    const noop = await h.run(p.url('INTERIOR'), h.envelope(child.id, 'modify', ['interior.materials'], finishes), 200);
    expect([noop.status, noop.reasons[0]!.code, noop.written]).toEqual(['NEEDS_CLARIFICATION', 'CLARIFICATION_NEEDED', false]);
    // Natural-language interior wording through Phase 30 is still refused; the structured operation is the supported path.
    const text = await h.ok('POST', ops, { baseRevisionId: child.id, request: { text: 'Paint the interior walls warm white.' } });
    expect([text.status, text.preflight.blockers[0].code]).toEqual(['UNSUPPORTED', 'INTERIOR_FINISH_NOT_SUPPORTED']);
    // Invalid finish codes and duplicate spaces are validation errors, not refusals.
    for (const bad of [{ finishes: [{ spaceId: 'foyer', finishes: { floor: 'marble-from-supplier-x' } }] }, { finishes: [{ spaceId: 'foyer', finishes: {} }] },
      { finishes: [{ spaceId: 'foyer', finishes: { floor: 'vinyl' } }, { spaceId: 'foyer', finishes: { walls: 'paint-white' } }] }])
      expect((await h.call('POST', p.url('INTERIOR'), h.envelope(child.id, 'modify', ['interior.materials'], bad))).statusCode, JSON.stringify(bad)).toBe(400);
  }, 300_000);

  it('a candidate on a base that another specialist superseded cannot be executed or approved; nothing is committed', async () => {
    const p = await h.project('B39 interior stale'), base = p.revision.id as string;
    const one = await h.run(p.url('INTERIOR'), h.envelope(base, 'modify', ['interior.materials'], { finishes: FINISHES }), 201);
    const two = await h.run(p.url('INTERIOR'), h.envelope(base, 'modify', ['interior.materials'], { finishes: [{ spaceId: 'foyer', finishes: { walls: 'timber-panel' } }] }), 201);
    if (one.details.kind !== 'INTERIOR' || two.details.kind !== 'INTERIOR') throw new Error('unreachable');
    const cand = await h.ok('POST', one.details.next.executeHref, { preflightHash: one.details.preflightHash, consent }, 200);
    // Another change lands first: Exterior commits a new revision from the same base.
    const moved = await h.exterior(p, base);
    const approve = await h.call('POST', one.details.next.approveHref, { preflightHash: one.details.preflightHash, candidateHash: cand.candidateHash });
    expect([approve.statusCode, approve.json().error.code]).toEqual([409, 'REVISION_BASE_STALE']);
    const execute = await h.call('POST', two.details.next.executeHref, { preflightHash: two.details.preflightHash, consent });
    expect([execute.statusCode, execute.json().error.code]).toEqual([409, 'REVISION_BASE_STALE']);
    for (const op of [one, two]) expect((await h.ok('GET', `/api/projects/${p.projectId}/revision-operations/${op.operationId}`)).status).toBe('STALE_BASE');
    expect((await h.ok('GET', `/api/projects/${p.projectId}`)).currentRevisionId).toBe(moved.id);
  }, 300_000);

  it('SQL refuses a forged candidate or commit that is not the previewed finish-only change, even with a valid server signature', async () => {
    const p = await h.project('B39 interior forged'), base = p.revision as Json;
    const r = await h.run(p.url('INTERIOR'), h.envelope(base.id, 'modify', ['interior.materials'], { finishes: FINISHES }), 201);
    if (r.details.kind !== 'INTERIOR') throw new Error('unreachable');
    const d = r.details, op = await h.ok('GET', d.next.operationHref), plan = op.preflight.interior as Json;
    const write = (action: 'candidate' | 'approve', route: string, input: Json) => {
      const s = signProjectCommit(secret, ownerId, route, input);
      return asPrincipal(db.pool, ownerId, c => c.query('select public.revision_operation_write($1,$2,$3,$4,$5) r', [action, JSON.stringify(input), null, s.envelope, s.signature]));
    };
    const finished = (model: Json) => ({ ...model, spaces: model.spaces.map((s: Json) => ({ ...s, finishes: FINISHES.find(f => f.spaceId === s.id)!.finishes })) });
    const validation = { status: 'VALID', validatorVersion: 'revision-interior-validator-v1', checks: 3, baseModelHash: modelHash(base.model),
      candidateModelHash: plan.candidateModelHash, geometryModelHash: plan.geometryModelHash, finishOnly: true };
    const candidate = (model: Json) => write('candidate', '/api/projects/:projectId/revision-operations/:operationId/execute',
      { projectId: p.projectId, operationId: r.operationId, preflightHash: d.preflightHash, model, candidateHash: costHash(validation) });
    // Geometry smuggled in with the finishes, and finishes other than those previewed: both refused, the operation untouched.
    const moved = finished({ ...base.model, walls: base.model.walls.map((w: Json, i: number) => i ? w : { ...w, heightMm: w.heightMm + 100 }) });
    await expect(candidate(moved)).rejects.toMatchObject({ code: 'P3008' });
    await expect(candidate({ ...finished(base.model), spaces: finished(base.model).spaces.map((s: Json) => ({ ...s, finishes: { floor: 'carpet' } })) }))
      .rejects.toMatchObject({ code: 'P3008' });
    expect((await h.ok('GET', r.details.next.operationHref)).status).toBe('AWAITING_CONSENT');
    // Positive control: the genuine candidate is accepted.
    expect((await candidate(finished(base.model))).rows[0].r).toMatchObject({ status: 'CANDIDATE_READY' });
    // A commit whose model is not the previewed candidate is refused before anything is written (the lock runs before project_write).
    const approve = (model: Json) => write('approve', '/api/projects/:projectId/revision-operations/:operationId/approve',
      { projectId: p.projectId, operationId: r.operationId, preflightHash: d.preflightHash, candidateHash: costHash(validation),
        commit: { projectId: p.projectId, baseRevisionId: base.id, model }, commitEnvelope: 'x', commitSignature: 'x' });
    await expect(approve(moved)).rejects.toMatchObject({ code: 'P3007' });
    await expect(approve(base.model)).rejects.toMatchObject({ code: 'P3007' });
    expect([(await h.ok('GET', r.details.next.operationHref)).status, (await h.ok('GET', `/api/projects/${p.projectId}`)).currentRevisionId]).toEqual(['CANDIDATE_READY', base.id]);
  }, 300_000);
});

describe('Migration 0029 upgrades a populated 0028 database without changing stored revision operations', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>;
  afterAll(async () => { await app?.close(); await db?.stop(); });

  it('keeps Phase 30 rows identical, then serves the existing kinds and Interior', async () => {
    db = await startTestDatabase({ migrations: name => name < '0029' });
    const ownerId = await createTestUser(db.pool), secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret as string;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId }), captureError: () => undefined });
    await app.ready();
    const h = harness(() => db, () => app);
    const p = await h.project('0029 upgrade'), committed = await h.exterior(p, p.revision.id);
    const digest = async () => (await db.pool.query(`select md5(string_agg(to_jsonb(o)::text, ',' order by id)) d from public.project_revision_operations o`)).rows[0].d as string;
    const before = await digest();
    const kindCheck = async () => (await db.pool.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'project_revision_operations_kind_check'`)).rows[0].d as string;
    // Before 0029 the database refuses the new kind.
    expect(await kindCheck()).not.toContain('INTERIOR_FINISH_MODIFY');

    const sql = await readFile(new URL('../../../supabase/migrations/0029_interior_finish_operations.sql', import.meta.url), 'utf8');
    await db.pool.query(`begin;\n${sql}\ncommit;`);
    expect(await digest()).toBe(before);
    expect(await kindCheck()).toMatch(/APPEARANCE_MODIFY.*RESTORE.*INTERIOR_FINISH_MODIFY/);
    // The existing kinds still work after the upgrade: a restore of the original revision commits.
    const ops = `/api/projects/${p.projectId}/revision-operations`;
    const restore = await h.ok('POST', ops, { baseRevisionId: committed.id, request: { operation: { kind: 'RESTORE', sourceRevisionId: p.revision.id } } });
    const rc = await h.ok('POST', `${ops}/${restore.id}/execute`, { preflightHash: restore.preflightHash, consent }, 200);
    const restored = (await h.ok('POST', `${ops}/${restore.id}/approve`, { preflightHash: restore.preflightHash, candidateHash: rc.candidateHash })).commit.revision as Json;
    expect(modelHash(restored.model)).toBe(modelHash(p.revision.model));
    // And Interior now commits on the restored (variant-free) revision.
    const r = await h.run(p.url('INTERIOR'), h.envelope(restored.id, 'modify', ['interior.materials'], { finishes: FINISHES }), 201);
    if (r.details.kind !== 'INTERIOR') throw new Error('unreachable');
    const cand = await h.ok('POST', r.details.next.executeHref, { preflightHash: r.details.preflightHash, consent }, 200);
    const child = (await h.ok('POST', r.details.next.approveHref, { preflightHash: r.details.preflightHash, candidateHash: cand.candidateHash })).commit.revision as Json;
    expect(stripSpaceFinishes(child.model)).toEqual(restored.model);
  }, 300_000);
});
