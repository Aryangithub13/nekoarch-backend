import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { asPrincipal, createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { systemsAcceptance } from '../../../test-support/systems-acceptance.js';
import { systemsInput, wetFrameInput, wetRequirements } from '../../../test-support/systems-fixtures.js';
import { environmentalInput } from '../../../test-support/environmental-fixtures.js';
import { frameInput } from '../../../test-support/structural-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { signProjectCommit } from '../src/services/project-service.js';
import { SYSTEMS_ANALYSIS_OPERATION } from '../src/services/systems-service.js';
import { REFERENCE_CALCULATOR } from '../src/systems/analysis.js';

const env = (secret?: string, extra: Record<string, string> = {}) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', ...(secret ? { PROJECT_COMMIT_SECRET: secret } : {}), ...extra });
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
const lifeOnly = (extra: Record<string, unknown> = {}) => ({ version: 'building-systems-input-v1', lifeSafety: { exits: { mode: 'SITE_PRIMARY_ENTRY' } }, ...extra });

describe('Phase 26 building-systems persistence on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, ownerId: string, otherId: string, secret: string;
  beforeAll(async () => {
    db = await startTestDatabase(); ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });
  systemsAcceptance(() => ({ app, owner, other }));

  async function setup(title = 'Phase 26 database tests') {
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title } });
    const r = await app.inject({ method: 'POST', url: `/api/projects/${p.json().id}/revisions/generate`, headers: owner, payload: { requirements: wetRequirements() } });
    expect(r.statusCode, r.body).toBe(201);
    const revision = r.json().revision, revisionUrl = `/api/projects/${p.json().id}/revisions/${revision.id}`, url = `${revisionUrl}/systems/analyses`;
    const created = await app.inject({ method: 'POST', url, headers: owner, payload: systemsInput() });
    expect(created.statusCode, created.body.slice(0, 400)).toBe(201);
    const write = { projectId: p.json().id as string, projectRevisionId: revision.id as string, acceptanceQaId: revision.qa.id as string, snapshot: created.json().snapshot };
    return { projectId: p.json().id as string, revision, revisionUrl, url, created: created.json(), write };
  }
  type Write = Awaited<ReturnType<typeof setup>>['write'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Snap = Record<string, any>;
  const variant = (write: Write, change: (s: Snap) => void): Write => {
    const copy = structuredClone(write); copy.snapshot.inputHash = randomUUID().replaceAll('-', '').padEnd(64, '0'); change(copy.snapshot); return copy;
  };
  const rpc = (input: unknown, user = ownerId, signature?: { envelope: string; signature: string }, context: unknown = null) => asPrincipal(db.pool, user, c =>
    c.query('select public.systems_write($1,$2,$3,$4) response', [JSON.stringify(input), context ? JSON.stringify(context) : null, signature?.envelope ?? null, signature?.signature ?? null]));
  const sign = (input: unknown, user = ownerId) => signProjectCommit(secret, user, SYSTEMS_ANALYSIS_OPERATION, input);
  const rows = async (revisionId: string) => (await db.pool.query('select id from public.project_revision_building_systems_analyses where project_revision_id=$1', [revisionId])).rows.length;

  it('denies direct writes, unsigned or forged RPCs, cross-user association, mutation and anonymous reads', async () => {
    const { write, created } = await setup();
    const fresh = variant(write, () => undefined);
    await expect(rpc(fresh)).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(fresh, ownerId, { ...sign(fresh), signature: 'a'.repeat(64) })).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(fresh, otherId, sign(fresh))).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(fresh, otherId, sign(fresh, otherId))).rejects.toMatchObject({ code: 'P1201' });
    await expect(rpc({ ...fresh, snapshot: { ...fresh.snapshot, inputHash: 'b'.repeat(64) } }, ownerId, sign(fresh))).rejects.toMatchObject({ code: '42501' });
    expect((await asPrincipal(db.pool, ownerId, c => c.query('select id from public.project_revision_building_systems_analyses where id=$1', [created.id]))).rows).toHaveLength(1);
    expect((await asPrincipal(db.pool, otherId, c => c.query('select id from public.project_revision_building_systems_analyses where id=$1', [created.id]))).rows).toHaveLength(0);
    for (const sql of ["update public.project_revision_building_systems_analyses set status='VALIDATED'", 'delete from public.project_revision_building_systems_analyses',
      'insert into public.project_revision_building_systems_analyses default values']) await expect(asPrincipal(db.pool, ownerId, c => c.query(sql))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, null, c => c.query('select * from public.project_revision_building_systems_analyses'))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, null, c => c.query("select public.systems_read('get',$1,$2,$3)", [randomUUID(), randomUUID(), created.id]))).rejects.toMatchObject({ code: '42501' });
    await expect(db.pool.query('delete from public.project_revision_building_systems_analyses where id=$1', [created.id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query("update public.project_revision_building_systems_analyses set snapshot_json='{}' where id=$1", [created.id])).rejects.toMatchObject({ code: '23514' });
  });

  it('recomputes revision and upstream binding inside the RPC and rejects forged bindings, claims and costing', async () => {
    const { write, projectId, revision, revisionUrl } = await setup('Phase 26 binding');
    const edited = wetRequirements(); edited.parametricArchitecture.floors[0]!.westWingWidthMm = 10000;
    const second = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements: edited, baseRevisionId: revision.id } });
    expect(second.statusCode, second.body).toBe(201);
    const next = second.json().revision;
    const otherStructural = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/${next.id}/structural/analyses`, headers: owner, payload: frameInput(next.model) });
    expect(otherStructural.statusCode, otherStructural.body.slice(0, 300)).toBe(201);
    const ownStructural = await app.inject({ method: 'POST', url: `${revisionUrl}/structural/analyses`, headers: owner, payload: wetFrameInput() });
    expect(ownStructural.statusCode, ownStructural.body.slice(0, 300)).toBe(201);
    const bind = (id: string, hash: string) => (s: Snap) => { s.binding.structural = { analysisId: id, inputHash: hash, modelVersion: 'structural-model-v1' }; s.input.sources.structuralAnalysisId = id; };
    const cases: [string, Write, string][] = [
      ['wrong model hash', variant(write, s => { s.binding.modelHash = '0'.repeat(64); }), 'P2603'],
      ['attached to another revision', { ...variant(write, () => undefined), projectRevisionId: next.id, acceptanceQaId: next.qa.id }, 'P2603'],
      ['relabelled revision', { ...variant(write, s => { s.binding.revisionId = next.id; }), projectRevisionId: next.id, acceptanceQaId: next.qa.id }, 'P2603'],
      ['forged parameter hash', variant(write, s => { s.binding.parameterHash = 'c'.repeat(64); }), 'P2603'],
      ['wrong model version', variant(write, s => { s.binding.systemsModelVersion = 'building-systems-model-v2'; }), 'P2603'],
      ['unknown structural analysis', variant(write, bind(randomUUID(), 'a'.repeat(64))), 'P2603'],
      ['wrong structural input hash', variant(write, bind(ownStructural.json().id, 'a'.repeat(64))), 'P2603'],
      ['structural analysis of another revision', variant(write, bind(otherStructural.json().id, otherStructural.json().inputHash)), 'P2603'],
      ['binding that disagrees with the input sources', variant(write, s => { s.binding.structural = { analysisId: ownStructural.json().id, inputHash: ownStructural.json().inputHash, modelVersion: 'structural-model-v1' }; }), 'P2603'],
      ['unknown environmental analysis', variant(write, s => { const id = randomUUID(); s.binding.environmental = { analysisId: id, inputHash: 'a'.repeat(64), modelVersion: 'environmental-model-v1' }; s.input.sources.environmentalAnalysisId = id; }), 'P2603'],
      ['wrong QA anchor', { ...variant(write, () => undefined), acceptanceQaId: randomUUID() }, 'P2602'],
      ['unknown revision', { ...variant(write, () => undefined), projectRevisionId: randomUUID() }, 'P1205'],
      ['fire-code claim', variant(write, s => { s.claims.fireCodeCompliance = 'COMPLIANT'; }), '23514'],
      ['accessibility claim', variant(write, s => { s.claims.accessibilityCompliance = 'ACCESSIBLE'; }), '23514'],
      ['MEP costing', variant(write, s => { s.results.quantities.costing = 'EVALUATED'; }), '23514'],
      ['missing coordination', variant(write, s => { delete s.results.coordination; }), '23514'],
      ['nondeterministic replay', { ...write, snapshot: { ...write.snapshot, results: { ...write.snapshot.results, networks: [] } } }, 'P2603'],
    ];
    for (const [name, input, code] of cases) await expect(rpc(input, ownerId, sign(input)), name).rejects.toMatchObject({ code });
    expect(await rows(next.id)).toBe(0);
  });

  it('serializes concurrent identical analyses into one immutable row and keeps distinct inputs distinct', async () => {
    const { write, revision, url } = await setup('Phase 26 concurrency');
    const fresh = variant(write, () => undefined), signature = sign(fresh);
    const results = await Promise.all(Array.from({ length: 8 }, () => rpc(fresh, ownerId, signature)));
    expect(new Set(results.map(r => r.rows[0].response.id)).size).toBe(1);
    const responses = await Promise.all(Array.from({ length: 4 }, (_, k) => app.inject({ method: 'POST', url, headers: owner,
      payload: lifeOnly({ lifeSafety: { exits: { mode: 'SITE_PRIMARY_ENTRY' }, obstructedOpeningIds: k % 2 ? ['door-wall-level-1-2250-2450-2250-16900-5600-900'] : [] } }) })));
    expect(responses.map(r => r.statusCode)).toEqual([201, 201, 201, 201]);
    expect(new Set(responses.map(r => r.json().id)).size).toBe(2);
    expect(await rows(revision.id)).toBe(4);
  });

  it('rolls back the analysis together with a failed receipt and fails closed without a signer', async () => {
    const { revision, url } = await setup('Phase 26 rollback');
    const input = lifeOnly(), before = await rows(revision.id);
    await db.pool.query(`create function project_private.systems_test_failure() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;
      create trigger systems_test_failure before insert on public.idempotency_records for each row execute function project_private.systems_test_failure()`);
    try {
      const failed = await app.inject({ method: 'POST', url, headers: { ...owner, 'idempotency-key': randomUUID() }, payload: input });
      expect(failed.statusCode).toBe(500); expect(failed.body).not.toContain('injected');
    } finally { await db.pool.query('drop trigger systems_test_failure on public.idempotency_records; drop function project_private.systems_test_failure()'); }
    expect(await rows(revision.id)).toBe(before);
    expect((await app.inject({ method: 'POST', url, headers: owner, payload: input })).statusCode).toBe(201);
    const unsigned = buildApp({ env: env(), backend: createPgBackend(db.pool, { owner: ownerId }), captureError: () => undefined });
    try {
      const response = await unsigned.inject({ method: 'POST', url, headers: owner, payload: input });
      expect(response.statusCode).toBe(503); expect(response.json().error.code).toBe('SYSTEMS_UNAVAILABLE');
      expect((await unsigned.inject({ method: 'POST', url: url.replace('/analyses', '/validate'), headers: owner, payload: input })).statusCode).toBe(200);
    } finally { await unsigned.close(); }
  });

  it('rejects a fabricated calculator result before signing or persistence', async () => {
    const { revision, url } = await setup('Phase 26 untrusted calculator'), before = await rows(revision.id), real = REFERENCE_CALCULATOR.analyze;
    REFERENCE_CALCULATOR.analyze = (ai, o) => {
      const raw = real(ai, o) as { results: { electrical: { total: { connected: { W: { value: number; exact: string; unit: string } } } } } };
      raw.results.electrical.total.connected.W = { value: 1, exact: '1', unit: 'W' }; return raw;
    };
    try {
      const r = await app.inject({ method: 'POST', url, headers: owner, payload: systemsInput({ loadWatts: [10, 20, 30] }) });
      expect(r.statusCode).toBe(422); expect(r.json().error.code).toBe('SYSTEM_RESULT_INVALID');
    } finally { REFERENCE_CALCULATOR.analyze = real; }
    expect(await rows(revision.id)).toBe(before);
  });

  it('charges validation and analysis to the generation quota and reads to the read quota', async () => {
    const { url } = await setup('Phase 26 quotas');
    const limited = buildApp({ env: env(secret, { RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_GENERATE: '1', RATE_LIMIT_READ: '50' }), backend: createPgBackend(db.pool, { owner: ownerId }), captureError: () => undefined });
    try {
      expect((await limited.inject({ method: 'POST', url: url.replace('/analyses', '/validate'), headers: owner, payload: lifeOnly() })).statusCode).toBe(200);
      const throttled = await limited.inject({ method: 'POST', url, headers: owner, payload: lifeOnly() });
      expect(throttled.statusCode).toBe(429); expect(throttled.json().error.code).toBe('RATE_LIMITED');
      for (const read of [url, url.replace('/analyses', '/status')]) expect((await limited.inject({ url: read, headers: owner })).statusCode).toBe(200);
    } finally { await limited.close(); }
  });
});

describe('Phase 26 migration upgrade from the 0015 schema', () => {
  async function digests(pool: Pool) {
    const tables = (await pool.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by relname")).rows.map(r => r.relname as string);
    const out: Record<string, unknown> = {};
    for (const t of tables) out[t] = (await pool.query(`select count(*)::int n, md5(coalesce(string_agg(row_to_json(x)::text, '|' order by row_to_json(x)::text), '')) d from public.${t} x`)).rows[0];
    const rls = (await pool.query("select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by relname")).rows;
    const policies = (await pool.query("select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname='public' order by tablename, policyname")).rows;
    return { tables: out, rls, policies };
  }
  it('applies 0016 over a populated database (including Phase 24 and 25 rows) without changing existing rows, RLS or policies', async () => {
    const old = await startTestDatabase({ migrations: name => name < '0016' });
    try {
      const ownerId = await createTestUser(old.pool), oldSecret = (await old.pool.query('select secret from project_private.commit_key')).rows[0].secret;
      const oldApp = buildApp({ env: env(oldSecret), backend: createPgBackend(old.pool, { owner: ownerId }), captureError: () => undefined });
      try {
        const project = await oldApp.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Pre-Phase-26 project' } });
        const revision = await oldApp.inject({ method: 'POST', url: `/api/projects/${project.json().id}/revisions/generate`, headers: owner, payload: { requirements: wetRequirements() } });
        expect(revision.statusCode, revision.body).toBe(201);
        const r = revision.json().revision, base = `/api/projects/${project.json().id}/revisions/${r.id}`;
        expect((await oldApp.inject({ method: 'POST', url: `${base}/takeoffs`, headers: owner, payload: {} })).statusCode).toBe(201);
        expect((await oldApp.inject({ method: 'POST', url: `${base}/structural/analyses`, headers: owner, payload: wetFrameInput() })).statusCode).toBe(201);
        expect((await oldApp.inject({ method: 'POST', url: `${base}/environmental/analyses`, headers: owner, payload: environmentalInput() })).statusCode).toBe(201);
        const missing = await oldApp.inject({ method: 'POST', url: `${base}/systems/analyses`, headers: owner, payload: lifeOnly() });
        expect(missing.statusCode).toBeGreaterThanOrEqual(500);
        const before = await digests(old.pool);
        const sql = await readFile(new URL('../../../supabase/migrations/0016_building_systems_analyses.sql', import.meta.url), 'utf8');
        await old.pool.query(`begin;\n${sql}\ncommit;`);
        const after = await digests(old.pool);
        expect(Object.keys(after.tables)).toEqual([...Object.keys(before.tables), 'project_revision_building_systems_analyses'].sort());
        for (const [table, value] of Object.entries(before.tables)) expect(after.tables[table], table).toEqual(value);
        expect(after.rls.every(row => row.relrowsecurity)).toBe(true);
        expect(after.policies.filter(p => p.tablename !== 'project_revision_building_systems_analyses')).toEqual(before.policies);
        const created = await oldApp.inject({ method: 'POST', url: `${base}/systems/analyses`, headers: owner, payload: lifeOnly() });
        expect(created.statusCode, created.body.slice(0, 300)).toBe(201); expect(created.json().snapshot.binding.revisionId).toBe(r.id);
        // The Phase 25 operation is still accepted by the redefined idempotency constraint.
        expect((await oldApp.inject({ method: 'POST', url: `${base}/environmental/analyses`, headers: { ...owner, 'idempotency-key': randomUUID() }, payload: environmentalInput({ outsideC: -2 }) })).statusCode).toBe(201);
      } finally { await oldApp.close(); }
    } finally { await old.stop(); }
  });
});
