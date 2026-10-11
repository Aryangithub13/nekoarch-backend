import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import validator from 'gltf-validator';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { AppearancePool } from '../src/revision/pool.js';
import { signProjectCommit } from '../src/services/project-service.js';
import { asPrincipal } from '../../../test-support/postgres.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
const sha = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex');
const CORE = 'Redesign the exterior of my building using a contemporary glass-inspired façade. Keep the exact floor plans, internal rooms, stairs, structure, building dimensions, and existing interior unchanged.';
const consent = { acceptLocks: true, acceptQuote: true };
function chunks(glb: Buffer) { const jl = glb.readUInt32LE(12); return { json: JSON.parse(glb.subarray(20, 20 + jl).toString('utf8')) as Json, bin: glb.subarray(28 + jl) }; }
const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret });

describe('Phase 30 selective revision on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, secret: string, ownerId: string, otherId: string;
  beforeAll(async () => {
    db = await startTestDatabase(); ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });

  const call = async (method: 'GET' | 'POST', url: string, payload?: unknown, status?: number, headers: Record<string, string> = owner) => {
    const r = await app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as Json }) });
    if (status !== undefined) expect(r.statusCode, `${method} ${url}: ${r.body.slice(0, 600)}`).toBe(status);
    return r;
  };
  async function project(title = 'Phase 30') {
    const projectId = (await call('POST', '/api/projects', { title }, 201)).json().id as string;
    const a = (await call('POST', `/api/projects/${projectId}/revisions/generate`, { requirements: parametricInput(true) }, 201)).json().revision as Json;
    return { projectId, a, ops: `/api/projects/${projectId}/revision-operations`, rev: (id: string) => `/api/projects/${projectId}/revisions/${id}` };
  }

  it('Scenario 16 (primary release gate): A → preflight → consent → validated candidate → comparison → approval → immutable B → restore as C', async () => {
    const { projectId, a, ops, rev } = await project('Phase 30 primary gate');
    // Preflight: exact targets, locks and a truthful quote; nothing is compiled or accepted.
    const pre = (await call('POST', ops, { baseRevisionId: a.id, request: { text: CORE } }, 201)).json() as Json;
    expect(pre).toMatchObject({ status: 'AWAITING_CONSENT', kind: 'APPEARANCE_MODIFY', baseRevisionId: a.id, candidate: null, committedRevisionId: null });
    const p = pre.preflight;
    expect(p.targets.length).toBeGreaterThan(5);
    expect(p.targets.every((t: Json) => t.sourceEntityType === 'wall' && t.bimElementId?.startsWith('bim-') && a.model.walls.find((w: Json) => w.id === t.sourceEntityId)?.classification === 'exterior')).toBe(true);
    expect(p.locks.map((l: Json) => `${l.origin}:${l.scope}:${l.granularity}`)).toEqual(expect.arrayContaining(['SYSTEM:BUILDING_MODEL:SEMANTIC_MODEL', 'SYSTEM:SCENE_GEOMETRY:EXACT_BYTES',
      'USER:FLOOR_PLANS:GEOMETRY', 'USER:ROOMS:GEOMETRY', 'USER:STAIRS:GEOMETRY', 'USER:STRUCTURE:GEOMETRY', 'USER:INTERIOR:GEOMETRY']));
    expect(p.quote).toMatchObject({ execution: 'LOCAL_DETERMINISTIC', externalProviders: [], externalCostUsd: 0, dataTransfer: 'NONE' });
    expect(p.claims).toEqual({ physicalGlazing: 'NOT_CLAIMED', materialPerformance: 'NOT_CLAIMED', thermal: 'NOT_CLAIMED', photorealism: 'NOT_CLAIMED' });
    expect((await call('GET', `/api/projects/${projectId}`, undefined, 200)).json().currentRevisionId).toBe(a.id);
    // Consent mismatch is refused; real consent produces a validated candidate.
    expect((await call('POST', `${ops}/${pre.id}/execute`, { preflightHash: 'f'.repeat(64), consent }, 409)).json().error.code).toBe('REVISION_CONSENT_MISMATCH');
    const cand = (await call('POST', `${ops}/${pre.id}/execute`, { preflightHash: pre.preflightHash, consent }, 200)).json() as Json;
    expect(cand).toMatchObject({ status: 'CANDIDATE_READY', committedRevisionId: null, validation: { status: 'VALID', geometryLock: { granularity: 'EXACT_BYTES', identical: true } } });
    expect((await call('GET', `/api/projects/${projectId}`, undefined, 200)).json().currentRevisionId).toBe(a.id);
    // The candidate GLB genuinely differs, is Khronos-valid, and keeps every geometry byte of the Phase 29 scene of A.
    const glbRes = await call('GET', `${ops}/${pre.id}/candidate/glb`, undefined, 200), glb = Buffer.from(glbRes.rawPayload);
    expect(glbRes.headers).toMatchObject({ 'x-candidate-status': 'UNACCEPTED', 'content-type': 'model/gltf-binary', 'cache-control': 'private, no-store' });
    expect(sha(glb)).toBe(cand.candidate.binarySha256);
    const khronos = await validator.validateBytes(new Uint8Array(glb), { maxIssues: 10 });
    expect([khronos.issues.numErrors, khronos.issues.numWarnings]).toEqual([0, 0]);
    const sceneA = (await call('POST', `${rev(a.id)}/scene/artifacts`, {}, 201)).json() as Json;
    const glbA = Buffer.from((await call('GET', `${rev(a.id)}/scene/artifacts/${sceneA.id}/glb`, undefined, 200)).rawPayload);
    expect(sha(glbA)).not.toBe(sha(glb));
    expect(Buffer.compare(chunks(glbA).bin, chunks(glb).bin)).toBe(0);
    expect(chunks(glb).json.materials.length).toBe(chunks(glbA).json.materials.length + 1);
    const manifest = (await call('GET', `${ops}/${pre.id}/candidate/manifest`, undefined, 200)).json() as Json;
    expect(manifest).toMatchObject({ acceptance: 'CANDIDATE_PREVIEW_NOT_ACCEPTED', manifest: { source: { revisionId: a.id, modelHash: a.identity.modelHash }, baseScene: { glbSha256: sha(glbA) } } });
    // Comparison: geometry and model identical, only the targeted façade objects changed.
    const cmp = (await call('GET', `${ops}/${pre.id}/comparison`, undefined, 200)).json() as Json;
    expect(cmp).toMatchObject({ kind: 'APPEARANCE_MODIFY', status: 'CANDIDATE_READY', candidate: { acceptance: 'CANDIDATE_PREVIEW_NOT_ACCEPTED' },
      hashes: { modelIdentical: true, geometryIdentical: true, baseGlbSha256: sha(glbA), candidateGlbSha256: sha(glb) }, approvalBlockers: [] });
    expect(cmp.changes.changedObjects.length + cmp.changes.preservedObjectCount).toBe(sceneA.manifest.objects.length);
    expect(cmp.changes.preservedSceneObjectIds.filter((id: string) => cmp.changes.changedObjects.some((c: Json) => c.sceneObjectId === id))).toEqual([]);
    expect(cmp.materials[0]).toMatchObject({ presetId: 'glass-inspired-blue-grey', from: [{ provenance: 'VISUAL_PLACEHOLDER' }], to: { provenance: 'APPEARANCE_VARIANT', rgbaThousandths: [330, 420, 500, 1000] } });
    // Approval must name the reviewed candidate.
    expect((await call('POST', `${ops}/${pre.id}/approve`, { preflightHash: pre.preflightHash, candidateHash: 'e'.repeat(64) }, 409)).json().error.code).toBe('REVISION_CONSENT_MISMATCH');
    // Explicit approval commits immutable B; A is untouched.
    const committed = (await call('POST', `${ops}/${pre.id}/approve`, { preflightHash: pre.preflightHash, candidateHash: cand.candidateHash }, 201)).json() as Json;
    const b = committed.commit.revision as Json;
    expect(committed.operation).toMatchObject({ status: 'COMMITTED', committedRevisionId: b.id, approvedBy: ownerId });
    expect(b).toMatchObject({ parentRevisionId: a.id, revisionNumber: 2, sourceMode: a.sourceMode, generatorVersion: a.generatorVersion, identity: { modelHash: a.identity.modelHash } });
    expect(b.identity.generationId).not.toBe(a.identity.generationId);
    expect(b.model).toEqual(a.model);
    expect((await call('GET', rev(a.id), undefined, 200)).json()).toMatchObject({ id: a.id, revisionNumber: 1, model: a.model });
    expect((await call('GET', `/api/projects/${projectId}`, undefined, 200)).json().currentRevisionId).toBe(b.id);
    const appearanceB = (await call('GET', `${rev(b.id)}/appearance`, undefined, 200)).json() as Json, appearanceA = (await call('GET', `${rev(a.id)}/appearance`, undefined, 200)).json() as Json;
    expect(appearanceB).toMatchObject({ status: 'APPEARANCE_VARIANT', artifact: { id: cand.candidate.id, binarySha256: sha(glb) }, lineage: { operation: { id: pre.id, kind: 'APPEARANCE_MODIFY' }, modelEquivalentToBase: true } });
    expect(appearanceA).toMatchObject({ status: 'DEFAULT_PLACEHOLDER', appearance: null, lineage: { operation: null } });
    expect(sha(Buffer.from((await call('GET', `${rev(b.id)}/appearance/glb`, undefined, 200)).rawPayload))).toBe(sha(glb));
    expect((await call('GET', `${rev(b.id)}/overview`, undefined, 200)).json()).toMatchObject({ appearance: { status: 'APPEARANCE_VARIANT' }, lineage: { kind: 'APPEARANCE_MODIFY', baseRevisionId: a.id, modelEquivalentToBase: true } });
    // Candidate reads now say COMMITTED; the operation cannot be committed twice.
    expect((await call('GET', `${ops}/${pre.id}/candidate/glb`, undefined, 200)).headers['x-candidate-status']).toBe('COMMITTED');
    expect((await call('POST', `${ops}/${pre.id}/approve`, { preflightHash: pre.preflightHash, candidateHash: cand.candidateHash }, 409)).json().error.code).toBe('REVISION_OPERATION_ALREADY_COMMITTED');
    expect((await call('GET', `${ops}/${pre.id}/validation`, undefined, 200)).json().events.map((e: Json) => e.eventType)).toEqual(['PREFLIGHT', 'CANDIDATE_READY', 'COMMITTED']);
    // Restore A's design state as C; A and B stay reviewable.
    const r = (await call('POST', ops, { baseRevisionId: b.id, request: { text: 'Restore revision 1' } }, 201)).json() as Json;
    expect(r).toMatchObject({ status: 'AWAITING_CONSENT', kind: 'RESTORE', restoreSourceRevisionId: a.id, preflight: { restore: { sourceRevisionId: a.id, modelEquivalent: true, appearanceHash: null } } });
    const rc = (await call('POST', `${ops}/${r.id}/execute`, { preflightHash: r.preflightHash, consent }, 200)).json() as Json;
    const c = (await call('POST', `${ops}/${r.id}/approve`, { preflightHash: r.preflightHash, candidateHash: rc.candidateHash }, 201)).json().commit.revision as Json;
    expect(c).toMatchObject({ parentRevisionId: b.id, revisionNumber: 3, identity: { modelHash: a.identity.modelHash } });
    expect((await call('GET', `${rev(c.id)}/appearance`, undefined, 200)).json()).toMatchObject({ status: 'DEFAULT_PLACEHOLDER', lineage: { operation: { kind: 'RESTORE' } } });
    expect((await call('GET', `${rev(b.id)}/appearance`, undefined, 200)).json().status).toBe('APPEARANCE_VARIANT');
    expect((await call('GET', `/api/projects/${projectId}/revisions`, undefined, 200)).json().items.map((i: Json) => i.revisionNumber)).toEqual([3, 2, 1]);
  });

  const ready = async (ops: string, baseRevisionId: string, text = CORE) => {
    const pre = (await call('POST', ops, { baseRevisionId, request: { text } }, 201)).json() as Json;
    const cand = (await call('POST', `${ops}/${pre.id}/execute`, { preflightHash: pre.preflightHash, consent }, 200)).json() as Json;
    return { pre, cand };
  };
  const operationRows = async (projectId: string) => (await db.pool.query('select status from public.project_revision_operations where project_id=$1 order by created_at', [projectId])).rows.map(r => r.status);
  const artifactRows = async (projectId: string) => (await db.pool.query('select count(*)::int n from public.project_revision_candidate_artifacts a join public.project_revision_operations o on o.id=a.operation_id where o.project_id=$1', [projectId])).rows[0].n;

  it('Scenario 2: larger glazing with locked walls, openings and structure is BLOCKED_BY_LOCK, lists the dependent checks and never executes', async () => {
    const { projectId, a, ops } = await project('Phase 30 S2');
    const pre = (await call('POST', ops, { baseRevisionId: a.id, request: { text: 'Make larger glazing openings while keeping existing walls, openings and structure unchanged.' } }, 201)).json() as Json;
    expect(pre).toMatchObject({ status: 'BLOCKED_BY_LOCK', kind: null });
    expect(pre.preflight.blockers.map((b: Json) => b.code)).toContain('LOCK_CONFLICT');
    expect(pre.preflight.impacts.filter((i: Json) => i.action === 'INVALIDATED').map((i: Json) => i.artifact)).toEqual(expect.arrayContaining(['BIM', 'SCENE_3D', 'QUANTITY_TAKEOFF', 'STRUCTURAL_ANALYSIS', 'ENVIRONMENTAL_ANALYSIS']));
    expect((await call('POST', `${ops}/${pre.id}/execute`, { preflightHash: pre.preflightHash, consent }, 409)).json().error.code).toBe('REVISION_OPERATION_INVALID_STATE');
    const unlocked = (await call('POST', ops, { baseRevisionId: a.id, request: { text: 'Add more windows on the south side.' } }, 201)).json() as Json;
    expect(unlocked).toMatchObject({ status: 'UNSUPPORTED', preflight: { blockers: [{ code: 'GEOMETRY_MODIFICATION_NOT_SUPPORTED' }] } });
    const glass = (await call('POST', ops, { baseRevisionId: a.id, request: { text: 'Give the house a glass facade.' } }, 201)).json() as Json;
    expect(glass.status).toBe('NEEDS_CLARIFICATION');
    expect(glass.preflight.questions[0]).toMatch(/visual appearance/);
    expect((await call('GET', `/api/projects/${projectId}`, undefined, 200)).json().currentRevisionId).toBe(a.id);
    expect(await artifactRows(projectId)).toBe(0);
  });

  it('Scenario 3: interior finishes are a typed refusal and are not advertised', async () => {
    const { a, ops } = await project('Phase 30 S3');
    const pre = (await call('POST', ops, { baseRevisionId: a.id, request: { text: 'Use a warmer finish in the living room.' } }, 201)).json() as Json;
    expect(pre).toMatchObject({ status: 'UNSUPPORTED', preflight: { blockers: [{ code: 'INTERIOR_FINISH_NOT_SUPPORTED' }] } });
    const caps = (await call('GET', '/api/capabilities', undefined, 200)).json() as Json;
    expect(caps.services.find((x: Json) => x.serviceId === 'SELECTIVE_REVISION')).toMatchObject({ status: 'AVAILABLE' });
    expect(JSON.stringify(caps.media)).not.toMatch(/INTERIOR_FINISH|ROOM_FINISH/);
  });

  it('Scenarios 4/5/12: appearance-only revisions keep blueprint geometry, BIM identities and engineering results (source-equivalent, not recomputed)', async () => {
    const { projectId, a, ops, rev } = await project('Phase 30 S4');
    const takeoff = (await call('POST', `${rev(a.id)}/takeoffs`, {}, 201)).json() as Json;
    const { pre, cand } = await ready(ops, a.id, 'Use a warm render on the south facade but do not modify the ground floor.');
    const ground = [...a.model.levels].sort((x: Json, y: Json) => x.index - y.index)[0].id;
    expect(pre.preflight.excluded).toEqual(expect.arrayContaining([{ elementId: ground, reason: 'LEVEL_LOCKED_BY_USER' }]));
    expect(pre.preflight.targets.every((t: Json) => t.facade === 'SOUTH' && t.levelId !== ground)).toBe(true);
    expect(pre.preflight.impacts.find((i: Json) => i.artifact === 'QUANTITY_TAKEOFF')).toMatchObject({ action: 'REUSE_SOURCE_EQUIVALENT', baseArtifactIds: [takeoff.id] });
    const cmp = (await call('GET', `${ops}/${pre.id}/comparison`, undefined, 200)).json() as Json;
    expect(cmp.quantitiesAndCost.find((e: Json) => e.artifact === 'QUANTITY_TAKEOFF')).toMatchObject({ freshness: 'SOURCE_EQUIVALENT', artifactIds: [takeoff.id], recomputed: false, newlyVerified: false });
    expect(cmp.changes.changedObjects.every((o: Json) => o.levelId !== ground)).toBe(true);
    const b = (await call('POST', `${ops}/${pre.id}/approve`, { preflightHash: pre.preflightHash, candidateHash: cand.candidateHash }, 201)).json().commit.revision as Json;
    // Blueprint preservation: identical model, room boundaries, walls, stairs; identical BIM element ids.
    expect([b.model.spaces, b.model.walls, b.model.stairs, b.model.openings]).toEqual([a.model.spaces, a.model.walls, a.model.stairs, a.model.openings]);
    const ids = async (r: string) => { const out: string[] = []; let after: string | null = null;
      do { const page: Json = (await call('GET', `${rev(r)}/bim/elements?limit=100${after ? `&after=${after}` : ''}`, undefined, 200)).json(); out.push(...page.items.map((e: Json) => e.id)); after = page.nextAfter; } while (after);
      return out; };
    expect(await ids(b.id)).toEqual(await ids(a.id));
    expect((await call('GET', `${rev(a.id)}/bim/diff/${b.id}`, undefined, 200)).json().changes.every((c: Json) => c.changes.join() === 'UNCHANGED')).toBe(true);
    // The takeoff was neither recomputed nor rebound.
    expect((await db.pool.query('select count(*)::int n from public.project_revision_takeoffs t join public.project_revisions r on r.id=t.project_revision_id where r.project_id=$1', [projectId])).rows[0].n).toBe(1);
    const manifest = (await call('GET', `${rev(b.id)}/appearance`, undefined, 200)).json().manifest as Json;
    expect(manifest.targets.every((t: Json) => manifest.scene.objects.find((o: Json) => o.sceneObjectId === t.sceneObjectId)?.bimElementId === t.bimElementId)).toBe(true);
  });

  it('Scenario 6: a rejected candidate never commits and leaves the accepted revision unchanged', async () => {
    const { projectId, a, ops } = await project('Phase 30 S6');
    const { pre, cand } = await ready(ops, a.id);
    expect((await call('POST', `${ops}/${pre.id}/reject`, {}, 200)).json().status).toBe('REJECTED');
    expect((await call('POST', `${ops}/${pre.id}/approve`, { preflightHash: pre.preflightHash, candidateHash: cand.candidateHash }, 409)).json().error.code).toBe('REVISION_OPERATION_INVALID_STATE');
    expect((await call('POST', `${ops}/${pre.id}/reject`, {}, 409)).json().error.code).toBe('REVISION_OPERATION_INVALID_STATE');
    expect((await call('GET', `/api/projects/${projectId}`, undefined, 200)).json()).toMatchObject({ currentRevisionId: a.id, currentRevisionNumber: 1 });
    const cancelled = (await call('POST', ops, { baseRevisionId: a.id, request: { text: 'Make the exterior walls darker.' } }, 201)).json() as Json;
    expect((await call('POST', `${ops}/${cancelled.id}/cancel`, {}, 200)).json().status).toBe('CANCELLED');
  });

  it('Scenario 8: of two candidates from the same base, the second approval is a safe stale-base conflict', async () => {
    const { projectId, a, ops } = await project('Phase 30 S8');
    const one = await ready(ops, a.id), two = await ready(ops, a.id, 'Make the exterior walls darker.');
    const b = (await call('POST', `${ops}/${one.pre.id}/approve`, { preflightHash: one.pre.preflightHash, candidateHash: one.cand.candidateHash }, 201)).json().commit.revision as Json;
    expect((await call('POST', `${ops}/${two.pre.id}/approve`, { preflightHash: two.pre.preflightHash, candidateHash: two.cand.candidateHash }, 409)).json().error.code).toBe('REVISION_BASE_STALE');
    expect((await call('GET', `${ops}/${two.pre.id}`, undefined, 200)).json().status).toBe('STALE_BASE');
    expect((await call('GET', `/api/projects/${projectId}`, undefined, 200)).json()).toMatchObject({ currentRevisionId: b.id, currentRevisionNumber: 2 });
    // Simultaneous approvals of two fresh candidates: exactly one commits.
    // B already has the glass finish everywhere, so these candidates use other finishes (re-applying it is refused as a no-op).
    const three = await ready(ops, b.id, 'Use a warm render on the exterior.'), four = await ready(ops, b.id, 'Use a light stone exterior finish.');
    const results = await Promise.all([three, four].map(x => call('POST', `${ops}/${x.pre.id}/approve`, { preflightHash: x.pre.preflightHash, candidateHash: x.cand.candidateHash })));
    expect(results.map(r => r.statusCode).sort()).toEqual([201, 409]);
    expect((await call('GET', `/api/projects/${projectId}`, undefined, 200)).json().currentRevisionNumber).toBe(3);
  });

  it('Scenario 9: idempotent preflight, execute and approve never duplicate operations, candidates or revisions', async () => {
    const { projectId, a, ops } = await project('Phase 30 S9');
    const key = (k: string) => ({ ...owner, 'idempotency-key': k });
    const p1 = await call('POST', ops, { baseRevisionId: a.id, request: { text: CORE } }, 201, key('pre-1')), p2 = await call('POST', ops, { baseRevisionId: a.id, request: { text: CORE } }, 201, key('pre-1'));
    expect(p2.json().id).toBe(p1.json().id);
    const pre = p1.json() as Json, body = { preflightHash: pre.preflightHash, consent };
    const e1 = await call('POST', `${ops}/${pre.id}/execute`, body, 200, key('exe-1')), e2 = await call('POST', `${ops}/${pre.id}/execute`, body, 200, key('exe-1'));
    expect(e2.json().candidateHash).toBe(e1.json().candidateHash);
    const approve = { preflightHash: pre.preflightHash, candidateHash: e1.json().candidateHash };
    const c1 = await call('POST', `${ops}/${pre.id}/approve`, approve, 201, key('apr-1')), c2 = await call('POST', `${ops}/${pre.id}/approve`, approve, 201, key('apr-1'));
    expect(c2.json().commit.revision.id).toBe(c1.json().commit.revision.id);
    expect((await call('POST', `${ops}/${pre.id}/approve`, { ...approve, candidateHash: 'a'.repeat(64) }, 409, key('apr-1'))).json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await operationRows(projectId)).toEqual(['COMMITTED']);
    expect(await artifactRows(projectId)).toBe(1);
    expect((await call('GET', `/api/projects/${projectId}`, undefined, 200)).json().currentRevisionNumber).toBe(2);
  });

  it('Scenario 10: another user cannot create, read, execute, approve or download anything; anonymous requests are refused', async () => {
    const { projectId, a, ops, rev } = await project('Phase 30 S10');
    const { pre, cand } = await ready(ops, a.id);
    for (const [method, url, payload] of [['POST', ops, { baseRevisionId: a.id, request: { text: CORE } }], ['GET', ops], ['GET', `${ops}/${pre.id}`], ['GET', `${ops}/${pre.id}/comparison`],
      ['GET', `${ops}/${pre.id}/candidate/glb`], ['GET', `${ops}/${pre.id}/candidate/manifest`], ['POST', `${ops}/${pre.id}/execute`, { preflightHash: pre.preflightHash, consent }],
      ['POST', `${ops}/${pre.id}/approve`, { preflightHash: pre.preflightHash, candidateHash: cand.candidateHash }], ['POST', `${ops}/${pre.id}/reject`, {}], ['GET', `${rev(a.id)}/appearance`]] as const) {
      expect((await call(method, url, payload, undefined, other)).statusCode, `${method} ${url}`).toBe(404);
      expect((await call(method, url, payload, undefined, {})).statusCode, `anon ${method} ${url}`).toBe(401);
    }
    expect((await call('GET', `${ops}/${pre.id}`, undefined, 200)).json().status).toBe('CANDIDATE_READY');
    // RLS: the other user sees no rows even with direct SQL.
    const rows = await asPrincipal(db.pool, otherId, c => c.query('select count(*)::int n from public.project_revision_operations where project_id=$1', [projectId]));
    expect(rows.rows[0].n).toBe(0);
    await expect(asPrincipal(db.pool, ownerId, c => c.query(`update public.project_revision_operations set status='COMMITTED' where project_id=$1`, [projectId]))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, ownerId, c => c.query('select glb from public.project_revision_candidate_blobs'))).rejects.toMatchObject({ code: '42501' });
  });

  it('Scenario 11: a crashed, malformed or invalidating worker records a failure and stores no candidate or revision', async () => {
    const worker = (mode: string) => ({ url: new URL('../../../test-support/revision-workers/probe.mjs', import.meta.url), execArgv: [], workerData: { mode } });
    for (const [mode, status, code, opStatus] of [['crash', 503, 'REVISION_WORKER_FAILED', 'FAILED'], ['garbage', 503, 'REVISION_WORKER_FAILED', 'FAILED'],
      ['invalid', 422, 'REVISION_VALIDATION_FAILED', 'VALIDATION_FAILED'], ['refuse', 422, 'SCENE_UNSUPPORTED_MODEL', 'FAILED']] as const) {
      const probeApp = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId }), captureError: () => undefined, appearancePool: new AppearancePool({ worker: worker(mode), timeoutMs: 3000 }) });
      const { projectId, a, ops } = await project(`Phase 30 S11 ${mode}`);
      const pre = (await call('POST', ops, { baseRevisionId: a.id, request: { text: CORE } }, 201)).json() as Json;
      const r = await probeApp.inject({ method: 'POST', url: `${ops}/${pre.id}/execute`, headers: owner, payload: { preflightHash: pre.preflightHash, consent } });
      expect([r.statusCode, r.json().error.code], mode).toEqual([status, code]);
      expect(await operationRows(projectId), mode).toEqual([opStatus]);
      expect(await artifactRows(projectId), mode).toBe(0);
      expect((await call('GET', `/api/projects/${projectId}`, undefined, 200)).json().currentRevisionNumber, mode).toBe(1);
      await probeApp.close();
    }
  });

  it('Scenario 13: active-operation limits and a saturated pool fail safely without state changes', async () => {
    const { projectId, a, ops } = await project('Phase 30 S13');
    for (let i = 0; i < 5; i++) await call('POST', ops, { baseRevisionId: a.id, request: { text: CORE } }, 201);
    expect((await call('POST', ops, { baseRevisionId: a.id, request: { text: CORE } }, 429)).json().error.code).toBe('REVISION_LIMIT_EXCEEDED');
    expect(await operationRows(projectId)).toEqual(Array(5).fill('AWAITING_CONSENT'));
    // Pool saturation: size 1, no queue, a hanging worker; the second execute is refused and its operation stays retryable.
    const hang = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId }), captureError: () => undefined,
      appearancePool: new AppearancePool({ worker: { url: new URL('../../../test-support/revision-workers/probe.mjs', import.meta.url), execArgv: [], workerData: { mode: 'hang' } }, queueLimit: 0, timeoutMs: 1500 }) });
    const list = (await call('GET', ops, undefined, 200)).json().items as Json[], [x, y] = list;
    const run = (o: Json) => hang.inject({ method: 'POST', url: `${ops}/${o.id}/execute`, headers: owner, payload: { preflightHash: o.preflightHash, consent } });
    const [rx, ry] = await Promise.all([run(x!), run(y!)]);
    expect([rx.statusCode, ry.statusCode]).toEqual([503, 503]);
    expect([rx.json().error.code, ry.json().error.code].sort()).toEqual(['REVISION_QUEUE_FULL', 'REVISION_WORKER_TIMEOUT']);
    const statuses = await operationRows(projectId);
    expect(statuses.filter(s => s === 'FAILED').length).toBe(1);
    expect(statuses.filter(s => s === 'AWAITING_CONSENT').length).toBe(4);
    await hang.close();
  });

  it('Expiry and retention: expired operations cannot execute or approve; abandoned candidate bytes are purged, committed ones are protected', async () => {
    const { projectId, a, ops } = await project('Phase 30 expiry');
    const kept = await ready(ops, a.id);
    await call('POST', `${ops}/${kept.pre.id}/approve`, { preflightHash: kept.pre.preflightHash, candidateHash: kept.cand.candidateHash }, 201);
    const b = (await call('GET', `/api/projects/${projectId}`, undefined, 200)).json().currentRevisionId as string;
    const stale = await ready(ops, b, 'Make the exterior walls darker.');
    // Test-only clock travel: move the operation's expiry into the past (the guard trigger is disabled for this one statement).
    await db.pool.query('alter table public.project_revision_operations disable trigger revision_operation_guard');
    await db.pool.query(`update public.project_revision_operations set created_at = created_at - interval '2 days', expires_at = clock_timestamp() - interval '1 day' where id=$1`, [stale.pre.id]);
    await db.pool.query('alter table public.project_revision_operations enable trigger revision_operation_guard');
    expect((await call('GET', `${ops}/${stale.pre.id}`, undefined, 200)).json().status).toBe('EXPIRED');
    expect((await call('POST', `${ops}/${stale.pre.id}/approve`, { preflightHash: stale.pre.preflightHash, candidateHash: stale.cand.candidateHash }, 409)).json().error.code).toBe('REVISION_OPERATION_EXPIRED');
    // The service refuses the expired operation before any write; the stored row becomes EXPIRED at the next action or purge.
    expect((await call('POST', `${ops}/${stale.pre.id}/execute`, { preflightHash: stale.pre.preflightHash, consent }, 409)).json().error.code).toBe('REVISION_OPERATION_EXPIRED');
    // Purge is database-wide (other scenarios' abandoned candidates are purged too); this project keeps only its committed artifact.
    const purge = (await db.pool.query(`select public.revision_operation_purge(interval '0 seconds') r`)).rows[0].r;
    expect([purge.expired >= 1, purge.purgedArtifacts >= 1]).toEqual([true, true]);
    expect((await operationRows(projectId)).sort()).toEqual(['COMMITTED', 'EXPIRED']);
    expect(await artifactRows(projectId)).toBe(1);
    await expect(db.pool.query('delete from public.project_revision_candidate_artifacts where operation_id=$1', [kept.pre.id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query('update public.project_revision_appearances set appearance_hash=$1 where revision_id=$2', ['0'.repeat(64), b])).rejects.toMatchObject({ code: '23514' });
  });

  it('SQL invariants: unsigned, forged-binding, lock-violating and invalid-transition writes are refused in the database', async () => {
    const { projectId, a, ops } = await project('Phase 30 SQL');
    const { pre, cand } = await ready(ops, a.id);
    const rpc = (action: string, input: unknown, signed = true) => asPrincipal(db.pool, ownerId, c => {
      const s = signed ? signProjectCommit(secret, ownerId, action === 'approve' ? `/api/projects/:projectId/revision-operations/:operationId/approve` : action === 'preflight' ? '/api/projects/:projectId/revision-operations'
        : `/api/projects/:projectId/revision-operations/:operationId/${action === 'candidate' || action === 'fail' ? 'execute' : action}`, input) : { envelope: null, signature: null };
      return c.query('select public.revision_operation_write($1,$2,$3,$4,$5) r', [action, JSON.stringify(input), null, s.envelope, s.signature]);
    });
    await expect(rpc('reject', { projectId, operationId: pre.id }, false)).rejects.toMatchObject({ code: '42501' });
    // A geometry change smuggled into an appearance approval violates the semantic model lock.
    const model = structuredClone(a.model); model.walls[0].thicknessMm += 10;
    const commit = { projectId, baseRevisionId: a.id, model, report: a.qaRuns[0].report, sourceMode: 'supplied', identity: null, normalizedRequirements: null, generatorVersion: null };
    const cs = signProjectCommit(secret, ownerId, '/api/projects/:projectId/revisions', commit);
    await expect(rpc('approve', { projectId, operationId: pre.id, preflightHash: pre.preflightHash, candidateHash: cand.candidateHash, commit, commitEnvelope: cs.envelope, commitSignature: cs.signature }))
      .rejects.toMatchObject({ code: 'P3007' });
    // A preflight bound to a forged model hash is refused.
    const forged = { ...pre.preflight, base: { ...pre.preflight.base, modelHash: 'b'.repeat(64) } };
    const { costHash } = await import('@designflow/boq-cost');
    await expect(rpc('preflight', { projectId, baseRevisionId: a.id, request: { text: CORE }, preflight: forged, preflightHash: costHash(forged) })).rejects.toMatchObject({ code: 'P3008' });
    // A committed operation cannot be approved again, even by a direct signed RPC.
    const done = (await call('POST', `${ops}/${pre.id}/approve`, { preflightHash: pre.preflightHash, candidateHash: cand.candidateHash }, 201)).json() as Json;
    await expect(rpc('approve', { projectId, operationId: pre.id, preflightHash: pre.preflightHash, candidateHash: cand.candidateHash, commit, commitEnvelope: cs.envelope, commitSignature: cs.signature }))
      .rejects.toMatchObject({ code: 'P3003' });
    expect(done.operation.status).toBe('COMMITTED');
    // Transitions outside the state machine are refused by the trigger even for the table owner.
    await expect(db.pool.query(`update public.project_revision_operations set status='AWAITING_CONSENT' where id=$1`, [pre.id])).rejects.toMatchObject({ code: 'P3002' });
    await expect(db.pool.query(`update public.project_revision_operations set base_revision_id=base_revision_id, preflight_hash=$2 where id=$1`, [pre.id, 'c'.repeat(64)])).rejects.toMatchObject({ code: '23514' });
    expect((await call('GET', `/api/projects/${projectId}`, undefined, 200)).json().currentRevisionNumber).toBe(2);
  });

  it('Scenario F25: the conversation PLAN_REVISION tool previews the same preflight read-only (nothing persisted or executed)', async () => {
    const { projectId, a } = await project('Phase 30 conversation');
    const conversationId = crypto.randomUUID(), url = `/api/projects/${projectId}/conversations`;
    expect((await call('POST', url, { conversationId, baseRevisionId: a.id }, 200)).statusCode).toBe(200);
    const [result] = (await call('POST', `${url}/${conversationId}/tools`, { actions: [{ name: 'PLAN_REVISION', input: { text: CORE } }] }, 200)).json().results as Json[];
    expect(result).toMatchObject({ name: 'PLAN_REVISION', baseRevisionId: a.id, persisted: false, preflight: { status: 'AWAITING_CONSENT', kind: 'APPEARANCE_MODIFY' } });
    expect(await operationRows(projectId)).toEqual([]);
  });

  it('SQL forged candidate: a candidate bound to another revision, or without VALID validation, is refused in the database', async () => {
    const { a, ops, projectId } = await project('Phase 30 forged candidate'), elsewhere = await project('Phase 30 forged candidate (other project)');
    const genuine = await ready(ops, a.id);
    const target = (await call('POST', ops, { baseRevisionId: a.id, request: { text: CORE } }, 201)).json() as Json;
    const manifest = (await call('GET', `${ops}/${genuine.pre.id}/candidate/manifest`, undefined, 200)).json().manifest as Json;
    const glbBase64 = Buffer.from((await call('GET', `${ops}/${genuine.pre.id}/candidate/glb`, undefined, 200)).rawPayload).toString('base64');
    const validation = genuine.cand.validation as Json, { costHash } = await import('@designflow/boq-cost');
    const submit = (m: Json, v: Json) => { const input = { projectId, operationId: target.id, preflightHash: target.preflightHash, manifest: m, validation: v, candidateHash: costHash(m), glbBase64 };
      const s = signProjectCommit(secret, ownerId, '/api/projects/:projectId/revision-operations/:operationId/execute', input);
      return asPrincipal(db.pool, ownerId, c => c.query('select public.revision_operation_write($1,$2,$3,$4,$5) r', ['candidate', JSON.stringify(input), null, s.envelope, s.signature])); };
    // Same model and hashes, but bound to a revision of another project: refused although every recomputed hash still matches,
    // both when only the outer binding is forged and when a stronger forger also rewrites the embedded base-scene binding.
    await expect(submit({ ...manifest, source: { ...manifest.source, revisionId: elsewhere.a.id } }, validation)).rejects.toMatchObject({ code: 'P3008' });
    const rebound = { ...manifest.source, revisionId: elsewhere.a.id };
    await expect(submit({ ...manifest, source: rebound, scene: { ...manifest.scene, source: rebound } }, validation)).rejects.toMatchObject({ code: 'P3008' });
    // Genuine manifest whose validation is not VALID: refused by the function check (the table CHECK is a second guard).
    await expect(submit(manifest, { ...validation, status: 'INVALID' })).rejects.toMatchObject({ code: 'P3008' });
    expect((await call('GET', `${ops}/${target.id}`, undefined, 200)).json().status).toBe('AWAITING_CONSENT');
    // Positive control: the same genuine candidate is accepted for this operation.
    expect((await submit(manifest, validation)).rows[0].r).toMatchObject({ status: 'CANDIDATE_READY' });
    expect(await artifactRows(projectId)).toBe(2);
  });
});
