import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { asPrincipal, createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { structuralAcceptance } from '../../../test-support/structural-acceptance.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { CROSSING_WALLS, STUB_WALLS, frameInput, segmentedBeamInput, withPartitions } from '../../../test-support/structural-fixtures.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { signProjectCommit } from '../src/services/project-service.js';
import { STRUCTURAL_ANALYSIS_OPERATION, validateStructural } from '../src/services/structural-service.js';
import { bimRepository } from '../../../test-support/bim-repository.js';
import { StructuralInputSchema } from '../src/structural/contracts.js';
import { REFERENCE_FRAME_SOLVER } from '../src/structural/frame-solver.js';

const env = (secret?: string, extra: Record<string, string> = {}) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', ...(secret ? { PROJECT_COMMIT_SECRET: secret } : {}), ...extra });
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };

describe('Phase 24 structural persistence on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, ownerId: string, otherId: string, secret: string;
  beforeAll(async () => {
    db = await startTestDatabase(); ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });
  structuralAcceptance(() => ({ app, owner, other }));

  async function setup(title = 'Phase 24 database tests') {
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title } });
    const r = await app.inject({ method: 'POST', url: `/api/projects/${p.json().id}/revisions`, headers: owner, payload: { model: authored() } });
    expect(r.statusCode, r.body).toBe(201);
    const revision = r.json().revision, url = `/api/projects/${p.json().id}/revisions/${revision.id}/structural/analyses`;
    const created = await app.inject({ method: 'POST', url, headers: owner, payload: frameInput(revision.model) });
    expect(created.statusCode, created.body.slice(0, 400)).toBe(201);
    const write = { projectId: p.json().id as string, projectRevisionId: revision.id as string, acceptanceQaId: revision.qa.id as string, snapshot: created.json().snapshot };
    return { projectId: p.json().id as string, revision, url, created: created.json(), write };
  }
  type Write = Awaited<ReturnType<typeof setup>>['write'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const variant = (write: Write, change: (s: Record<string, any>) => void): Write => {
    const copy = structuredClone(write); copy.snapshot.inputHash = randomUUID().replaceAll('-', '').padEnd(64, '0'); change(copy.snapshot); return copy;
  };
  const rpc = (input: unknown, user = ownerId, signature?: { envelope: string; signature: string }, context: unknown = null) => asPrincipal(db.pool, user, c =>
    c.query('select public.structural_write($1,$2,$3,$4) response', [JSON.stringify(input), context ? JSON.stringify(context) : null, signature?.envelope ?? null, signature?.signature ?? null]));
  const sign = (input: unknown, user = ownerId) => signProjectCommit(secret, user, STRUCTURAL_ANALYSIS_OPERATION, input);
  const rows = async (revisionId: string) => (await db.pool.query('select id from public.project_revision_structural_analyses where project_revision_id=$1', [revisionId])).rows.length;

  it('denies direct writes, unsigned or forged RPCs, cross-user association, mutation and anonymous reads', async () => {
    const { write, created } = await setup();
    const fresh = variant(write, () => undefined);
    await expect(rpc(fresh)).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(fresh, ownerId, { ...sign(fresh), signature: 'a'.repeat(64) })).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(fresh, otherId, sign(fresh))).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(fresh, otherId, sign(fresh, otherId))).rejects.toMatchObject({ code: 'P1201' });
    await expect(rpc({ ...fresh, snapshot: { ...fresh.snapshot, inputHash: 'b'.repeat(64) } }, ownerId, sign(fresh))).rejects.toMatchObject({ code: '42501' });
    expect((await asPrincipal(db.pool, ownerId, c => c.query('select id from public.project_revision_structural_analyses where id=$1', [created.id]))).rows).toHaveLength(1);
    expect((await asPrincipal(db.pool, otherId, c => c.query('select id from public.project_revision_structural_analyses where id=$1', [created.id]))).rows).toHaveLength(0);
    for (const sql of ["update public.project_revision_structural_analyses set status='VALIDATED'", 'delete from public.project_revision_structural_analyses',
      'insert into public.project_revision_structural_analyses default values']) await expect(asPrincipal(db.pool, ownerId, c => c.query(sql))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, null, c => c.query('select * from public.project_revision_structural_analyses'))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, null, c => c.query("select public.structural_read('get',$1,$2,$3)", [randomUUID(), randomUUID(), created.id]))).rejects.toMatchObject({ code: '42501' });
    await expect(db.pool.query('delete from public.project_revision_structural_analyses where id=$1', [created.id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query("update public.project_revision_structural_analyses set snapshot_json='{}' where id=$1", [created.id])).rejects.toMatchObject({ code: '23514' });
  });

  it('recomputes revision binding inside the RPC and rejects wrong revisions, hashes, QA anchors and claims', async () => {
    const { write, projectId, revision } = await setup();
    const second = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions`, headers: owner, payload: { model: { ...authored(), name: 'Second revision' }, baseRevisionId: revision.id } });
    expect(second.statusCode, second.body).toBe(201);
    const next = second.json().revision;
    const cases: [string, Write, string][] = [
      ['wrong model hash', variant(write, s => { s.binding.modelHash = '0'.repeat(64); }), 'P2403'],
      ['attached to another revision', { ...variant(write, () => undefined), projectRevisionId: next.id, acceptanceQaId: next.qa.id }, 'P2403'],
      ['relabelled revision', { ...variant(write, s => { s.binding.revisionId = next.id; }), projectRevisionId: next.id, acceptanceQaId: next.qa.id }, 'P2403'],
      ['forged generation identity', variant(write, s => { s.binding.generationId = randomUUID(); }), 'P2403'],
      ['wrong BIM version', variant(write, s => { s.binding.bimVersion = 'bim-semantic-v2'; }), 'P2403'],
      ['forged parameter hash', variant(write, s => { s.binding.parameterHash = 'c'.repeat(64); }), 'P2403'],
      ['wrong QA anchor', { ...variant(write, () => undefined), acceptanceQaId: randomUUID() }, 'P2402'],
      ['unknown revision', { ...variant(write, () => undefined), projectRevisionId: randomUUID() }, 'P1205'],
      ['certification claim', variant(write, s => { s.claims.certification = 'CERTIFIED'; }), '23514'],
      ['design claim', variant(write, s => { s.claims.designVerification = 'PASSED'; }), '23514'],
      ['empty results', variant(write, s => { s.results.sets = []; }), '23514'],
      ['nondeterministic replay', { ...write, snapshot: { ...write.snapshot, results: { ...write.snapshot.results, sets: write.snapshot.results.sets.slice(1) } } }, 'P2403'],
    ];
    for (const [name, input, code] of cases) await expect(rpc(input, ownerId, sign(input)), name).rejects.toMatchObject({ code });
    expect(await rows(next.id)).toBe(0);
  });

  it('reports revisions outside the bounded BIM profile as unsupported structural sources', async () => {
    const { revision, projectId } = await setup('Phase 24 unsupported source');
    const columned = structuredClone(revision); columned.identity = null;
    columned.model.columns = [{ id: 'col-1', levelId: 'ground', crossSection: { outer: [{ x: 1000, z: 1000 }, { x: 1300, z: 1000 }, { x: 1300, z: 1300 }, { x: 1000, z: 1300 }], voids: [] }, baseOffsetMm: 0, heightMm: 2800 }];
    await expect(validateStructural(bimRepository(async () => columned), projectId, revision.id, StructuralInputSchema.parse(frameInput(revision.model))))
      .rejects.toMatchObject({ statusCode: 422, code: 'STRUCTURAL_SOURCE_UNSUPPORTED' });
  });

  it('serializes concurrent identical analyses into one immutable row and keeps distinct inputs distinct', async () => {
    const { write, revision, url } = await setup('Phase 24 concurrency');
    const fresh = variant(write, () => undefined), signature = sign(fresh);
    const results = await Promise.all(Array.from({ length: 8 }, () => rpc(fresh, ownerId, signature)));
    expect(new Set(results.map(r => r.rows[0].response.id)).size).toBe(1);
    const responses = await Promise.all(Array.from({ length: 4 }, (_, k) => app.inject({ method: 'POST', url, headers: owner, payload: frameInput(revision.model, { lineLoadKnPerM: -20 - (k % 2) }) })));
    expect(responses.map(r => r.statusCode)).toEqual([201, 201, 201, 201]);
    expect(new Set(responses.map(r => r.json().id)).size).toBe(2);
    expect(await rows(revision.id)).toBe(4);
  });

  it('rolls back the analysis together with a failed receipt and fails closed without a signer', async () => {
    const { revision, url } = await setup('Phase 24 rollback');
    const input = frameInput(revision.model, { lineLoadKnPerM: -3 }), before = await rows(revision.id);
    await db.pool.query(`create function project_private.structural_test_failure() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;
      create trigger structural_test_failure before insert on public.idempotency_records for each row execute function project_private.structural_test_failure()`);
    try {
      const failed = await app.inject({ method: 'POST', url, headers: { ...owner, 'idempotency-key': randomUUID() }, payload: input });
      expect(failed.statusCode).toBe(500); expect(failed.body).not.toContain('injected');
    } finally { await db.pool.query('drop trigger structural_test_failure on public.idempotency_records; drop function project_private.structural_test_failure()'); }
    expect(await rows(revision.id)).toBe(before);
    expect((await app.inject({ method: 'POST', url, headers: owner, payload: input })).statusCode).toBe(201);
    const unsigned = buildApp({ env: env(), backend: createPgBackend(db.pool, { owner: ownerId }), captureError: () => undefined });
    try {
      const response = await unsigned.inject({ method: 'POST', url, headers: owner, payload: input });
      expect(response.statusCode).toBe(503); expect(response.json().error.code).toBe('STRUCTURAL_UNAVAILABLE');
      expect((await unsigned.inject({ method: 'POST', url: url.replace('/analyses', '/validate'), headers: owner, payload: input })).statusCode).toBe(200);
    } finally { await unsigned.close(); }
  });

  // Phase 24 audit repair: every rejection is a typed, redacted 4xx that persists nothing.
  async function revisionOf(model: unknown, title: string) {
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title } });
    const r = await app.inject({ method: 'POST', url: `/api/projects/${p.json().id}/revisions`, headers: owner, payload: { model } });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(201);
    return { revisionId: r.json().revision.id as string, base: `/api/projects/${p.json().id}/revisions/${r.json().revision.id}/structural` };
  }
  const rejected = (response: { statusCode: number; json(): { error: { code: string; message: string } }; body: string }, code: string) => {
    expect(response.statusCode, response.body.slice(0, 300)).toBe(422); expect(response.json().error.code).toBe(code); expect(response.body).not.toMatch(/ZodError|stack|too_big/);
  };

  it('A01: forged solver displacement is rejected before signing or persistence', async () => {
    const { revision, url } = await setup('Phase 24 A01 forged output'), before = await rows(revision.id), real = REFERENCE_FRAME_SOLVER.analyze;
    REFERENCE_FRAME_SOLVER.analyze = (am, o) => {
      const raw = real(am, o) as { cases: { displacements: number[][] }[] }, restrained = new Set(am.restraints.map(r => r.nodeId));
      raw.cases[0]!.displacements[am.nodes.findIndex(n => !restrained.has(n.id))]![1]! += 0.05; return raw;
    };
    try { rejected(await app.inject({ method: 'POST', url, headers: owner, payload: frameInput(revision.model, { lineLoadKnPerM: -17 }) }), 'STRUCTURAL_RESULT_INVALID'); }
    finally { REFERENCE_FRAME_SOLVER.analyze = real; }
    expect(await rows(revision.id)).toBe(before);
  });

  it('A03: an accepted revision with an unconnected beam crossing is rejected by /validate and /analyses', async () => {
    const { revisionId, base } = await revisionOf(withPartitions(authored(), CROSSING_WALLS), 'Phase 24 A03 crossing');
    const input = { ...frameInput(authored(), { selfWeight: false }), autoSupports: null, combinations: [],
      members: ['cross-x', 'cross-z'].map(wallId => ({ key: wallId, rule: 'BEAM_ALONG_WALL', wallId, material: 'test-concrete', section: 'beam' })),
      supports: ['cross-x', 'cross-z'].map(member => ({ key: member, at: { member, end: 'start' }, type: 'FIXED' })),
      loadCases: [{ key: 'q', category: 'USER_DEFINED', loads: [{ key: 'q', application: 'MEMBER_DISTRIBUTED', target: { member: 'cross-x' }, direction: 'GLOBAL_Y', magnitude: { value: -5, unit: 'kN/m' } }] }] };
    for (const suffix of ['/validate', '/analyses']) rejected(await app.inject({ method: 'POST', url: base + suffix, headers: owner, payload: input }), 'STRUCTURAL_MODEL_INVALID');
    expect(await rows(revisionId)).toBe(0);
  });

  it('A04: a fixed–fixed beam is analysed and persisted with fixed-end reactions', async () => {
    const { revision, url } = await setup('Phase 24 A04 fixed beam');
    const input = { ...frameInput(revision.model, { selfWeight: false }), autoSupports: null, combinations: [], members: [{ key: 'b', rule: 'BEAM_ALONG_WALL', wallId: 'west', material: 'test-concrete', section: 'beam' }],
      supports: ['start', 'end'].map(end => ({ key: end, at: { member: 'b', end }, type: 'FIXED' })),
      loadCases: [{ key: 'q', category: 'USER_DEFINED', loads: [{ key: 'q', application: 'MEMBER_DISTRIBUTED', target: { member: 'b' }, direction: 'GLOBAL_Y', magnitude: { value: -2, unit: 'kN/m' } }] }] };
    const created = await app.inject({ method: 'POST', url, headers: owner, payload: input });
    expect(created.statusCode, created.body.slice(0, 300)).toBe(201);
    const set = created.json().snapshot.results.sets[0];
    for (const r of set.reactions) { expect(r.fy).toBeCloseTo(5.8, 9); expect(Math.abs(r.mx)).toBeCloseTo(2 * 5.8 ** 2 / 12, 9); }
    expect(created.json().snapshot.validation.results).toMatchObject({ validator: 'structural-result-validator-v2', status: 'VALID' });
  });

  it('A05: supported-size input that expands past the analysis limit is a typed 422 on both routes; the limit itself analyses', async () => {
    const { revisionId, base } = await revisionOf(withPartitions(authored(), [CROSSING_WALLS[0]!, ...STUB_WALLS]), 'Phase 24 A05 expansion');
    for (const suffix of ['/validate', '/analyses']) rejected(await app.inject({ method: 'POST', url: base + suffix, headers: owner, payload: segmentedBeamInput(1000) }), 'STRUCTURAL_RESOURCE_LIMIT');
    rejected(await app.inject({ method: 'POST', url: `${base}/analyses`, headers: owner, payload: segmentedBeamInput(749, true) }), 'STRUCTURAL_RESOURCE_LIMIT');
    expect(await rows(revisionId)).toBe(0);
    expect((await app.inject({ method: 'POST', url: `${base}/analyses`, headers: owner, payload: segmentedBeamInput(750) })).statusCode).toBe(201);
    expect(await rows(revisionId)).toBe(1);
  });

  it('charges validation and analysis to the generation quota and reads to the read quota', async () => {
    const { revision, url } = await setup('Phase 24 quotas');
    const limited = buildApp({ env: env(secret, { RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_GENERATE: '1', RATE_LIMIT_READ: '50' }), backend: createPgBackend(db.pool, { owner: ownerId }), captureError: () => undefined });
    try {
      const input = frameInput(revision.model);
      expect((await limited.inject({ method: 'POST', url: url.replace('/analyses', '/validate'), headers: owner, payload: input })).statusCode).toBe(200);
      const throttled = await limited.inject({ method: 'POST', url, headers: owner, payload: input });
      expect(throttled.statusCode).toBe(429); expect(throttled.json().error.code).toBe('RATE_LIMITED');
      for (const read of [url, url.replace('/analyses', '/status')]) expect((await limited.inject({ url: read, headers: owner })).statusCode).toBe(200);
    } finally { await limited.close(); }
  });
});

describe('Phase 24 migration upgrade from the 0013 schema', () => {
  async function digests(pool: Pool) {
    const tables = (await pool.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by relname")).rows.map(r => r.relname as string);
    const out: Record<string, unknown> = {};
    for (const t of tables) out[t] = (await pool.query(`select count(*)::int n, md5(coalesce(string_agg(row_to_json(x)::text, '|' order by row_to_json(x)::text), '')) d from public.${t} x`)).rows[0];
    const rls = (await pool.query("select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by relname")).rows;
    const policies = (await pool.query("select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname='public' order by tablename, policyname")).rows;
    return { tables: out, rls, policies };
  }
  it('applies 0014 over a populated database without changing existing rows, RLS or policies', async () => {
    const old = await startTestDatabase({ migrations: name => name < '0014' });
    try {
      const ownerId = await createTestUser(old.pool), oldSecret = (await old.pool.query('select secret from project_private.commit_key')).rows[0].secret;
      const oldApp = buildApp({ env: env(oldSecret), backend: createPgBackend(old.pool, { owner: ownerId }), captureError: () => undefined });
      try {
        const project = await oldApp.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Pre-Phase-24 project' } });
        const revision = await oldApp.inject({ method: 'POST', url: `/api/projects/${project.json().id}/revisions/generate`, headers: owner, payload: { requirements: parametricInput(true) } });
        expect(revision.statusCode, revision.body).toBe(201);
        const r = revision.json().revision, base = `/api/projects/${project.json().id}/revisions/${r.id}`;
        expect((await oldApp.inject({ method: 'POST', url: `${base}/takeoffs`, headers: owner, payload: {} })).statusCode).toBe(201);
        const missing = await oldApp.inject({ method: 'POST', url: `${base}/structural/analyses`, headers: owner, payload: frameInput(r.model) });
        expect(missing.statusCode).toBeGreaterThanOrEqual(500);
        const before = await digests(old.pool);
        const sql = await readFile(new URL('../../../supabase/migrations/0014_structural_analyses.sql', import.meta.url), 'utf8');
        await old.pool.query(`begin;\n${sql}\ncommit;`);
        const after = await digests(old.pool);
        expect(Object.keys(after.tables)).toEqual([...Object.keys(before.tables), 'project_revision_structural_analyses'].sort());
        for (const [table, value] of Object.entries(before.tables)) expect(after.tables[table], table).toEqual(value);
        expect(after.rls.every(row => row.relrowsecurity)).toBe(true);
        expect(after.policies.filter(p => p.tablename !== 'project_revision_structural_analyses')).toEqual(before.policies);
        const created = await oldApp.inject({ method: 'POST', url: `${base}/structural/analyses`, headers: owner, payload: frameInput(r.model) });
        expect(created.statusCode, created.body.slice(0, 300)).toBe(201); expect(created.json().snapshot.binding.revisionId).toBe(r.id);
      } finally { await oldApp.close(); }
    } finally { await old.stop(); }
  });
});
