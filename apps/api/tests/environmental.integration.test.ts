import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { asPrincipal, createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { environmentalAcceptance } from '../../../test-support/environmental-acceptance.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { environmentalInput } from '../../../test-support/environmental-fixtures.js';
import { frameInput } from '../../../test-support/structural-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { signProjectCommit } from '../src/services/project-service.js';
import { ENVIRONMENTAL_ANALYSIS_OPERATION } from '../src/services/environmental-service.js';
import { REFERENCE_CALCULATOR } from '../src/environmental/analysis.js';

const env = (secret?: string, extra: Record<string, string> = {}) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', ...(secret ? { PROJECT_COMMIT_SECRET: secret } : {}), ...extra });
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };

describe('Phase 25 environmental persistence on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, ownerId: string, otherId: string, secret: string;
  beforeAll(async () => {
    db = await startTestDatabase(); ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });
  environmentalAcceptance(() => ({ app, owner, other }));

  async function setup(title = 'Phase 25 database tests') {
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title } });
    const r = await app.inject({ method: 'POST', url: `/api/projects/${p.json().id}/revisions/generate`, headers: owner, payload: { requirements: parametricInput(true) } });
    expect(r.statusCode, r.body).toBe(201);
    const revision = r.json().revision, url = `/api/projects/${p.json().id}/revisions/${revision.id}/environmental/analyses`;
    const created = await app.inject({ method: 'POST', url, headers: owner, payload: environmentalInput() });
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
    c.query('select public.environmental_write($1,$2,$3,$4) response', [JSON.stringify(input), context ? JSON.stringify(context) : null, signature?.envelope ?? null, signature?.signature ?? null]));
  const sign = (input: unknown, user = ownerId) => signProjectCommit(secret, user, ENVIRONMENTAL_ANALYSIS_OPERATION, input);
  const rows = async (revisionId: string) => (await db.pool.query('select id from public.project_revision_environmental_analyses where project_revision_id=$1', [revisionId])).rows.length;

  it('denies direct writes, unsigned or forged RPCs, cross-user association, mutation and anonymous reads', async () => {
    const { write, created } = await setup();
    const fresh = variant(write, () => undefined);
    await expect(rpc(fresh)).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(fresh, ownerId, { ...sign(fresh), signature: 'a'.repeat(64) })).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(fresh, otherId, sign(fresh))).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(fresh, otherId, sign(fresh, otherId))).rejects.toMatchObject({ code: 'P1201' });
    await expect(rpc({ ...fresh, snapshot: { ...fresh.snapshot, inputHash: 'b'.repeat(64) } }, ownerId, sign(fresh))).rejects.toMatchObject({ code: '42501' });
    expect((await asPrincipal(db.pool, ownerId, c => c.query('select id from public.project_revision_environmental_analyses where id=$1', [created.id]))).rows).toHaveLength(1);
    expect((await asPrincipal(db.pool, otherId, c => c.query('select id from public.project_revision_environmental_analyses where id=$1', [created.id]))).rows).toHaveLength(0);
    for (const sql of ["update public.project_revision_environmental_analyses set status='VALIDATED'", 'delete from public.project_revision_environmental_analyses',
      'insert into public.project_revision_environmental_analyses default values']) await expect(asPrincipal(db.pool, ownerId, c => c.query(sql))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, null, c => c.query('select * from public.project_revision_environmental_analyses'))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, null, c => c.query("select public.environmental_read('get',$1,$2,$3)", [randomUUID(), randomUUID(), created.id]))).rejects.toMatchObject({ code: '42501' });
    await expect(db.pool.query('delete from public.project_revision_environmental_analyses where id=$1', [created.id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query("update public.project_revision_environmental_analyses set snapshot_json='{}' where id=$1", [created.id])).rejects.toMatchObject({ code: '23514' });
  });

  it('recomputes revision binding inside the RPC and rejects wrong revisions, hashes, QA anchors and claims', async () => {
    const { write, projectId, revision } = await setup();
    const edited = parametricInput(true); edited.parametricArchitecture.floors[0]!.westWingWidthMm = 10000;
    const second = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions/generate`, headers: owner, payload: { requirements: edited, baseRevisionId: revision.id } });
    expect(second.statusCode, second.body).toBe(201);
    const next = second.json().revision;
    const cases: [string, Write, string][] = [
      ['wrong model hash', variant(write, s => { s.binding.modelHash = '0'.repeat(64); }), 'P2503'],
      ['attached to another revision', { ...variant(write, () => undefined), projectRevisionId: next.id, acceptanceQaId: next.qa.id }, 'P2503'],
      ['relabelled revision', { ...variant(write, s => { s.binding.revisionId = next.id; }), projectRevisionId: next.id, acceptanceQaId: next.qa.id }, 'P2503'],
      ['forged parameter hash', variant(write, s => { s.binding.parameterHash = 'c'.repeat(64); }), 'P2503'],
      ['wrong model version', variant(write, s => { s.binding.environmentalModelVersion = 'environmental-model-v2'; }), 'P2503'],
      ['wrong QA anchor', { ...variant(write, () => undefined), acceptanceQaId: randomUUID() }, 'P2502'],
      ['unknown revision', { ...variant(write, () => undefined), projectRevisionId: randomUUID() }, 'P1205'],
      ['energy-efficiency claim', variant(write, s => { s.claims.energyEfficiency = 'ENERGY_EFFICIENT'; }), '23514'],
      ['compliance claim', variant(write, s => { s.claims.codeCompliance = 'COMPLIANT'; }), '23514'],
      ['missing thermal results', variant(write, s => { delete s.results.thermal; }), '23514'],
      ['nondeterministic replay', { ...write, snapshot: { ...write.snapshot, results: { ...write.snapshot.results, daylightIndicator: { ...write.snapshot.results.daylightIndicator, zones: [] } } } }, 'P2503'],
    ];
    for (const [name, input, code] of cases) await expect(rpc(input, ownerId, sign(input)), name).rejects.toMatchObject({ code });
    expect(await rows(next.id)).toBe(0);
  });

  it('serializes concurrent identical analyses into one immutable row and keeps distinct inputs distinct', async () => {
    const { write, revision, url } = await setup('Phase 25 concurrency');
    const fresh = variant(write, () => undefined), signature = sign(fresh);
    const results = await Promise.all(Array.from({ length: 8 }, () => rpc(fresh, ownerId, signature)));
    expect(new Set(results.map(r => r.rows[0].response.id)).size).toBe(1);
    const responses = await Promise.all(Array.from({ length: 4 }, (_, k) => app.inject({ method: 'POST', url, headers: owner, payload: environmentalInput({ outsideC: -10 - (k % 2) }) })));
    expect(responses.map(r => r.statusCode)).toEqual([201, 201, 201, 201]);
    expect(new Set(responses.map(r => r.json().id)).size).toBe(2);
    expect(await rows(revision.id)).toBe(4);
  });

  it('rolls back the analysis together with a failed receipt and fails closed without a signer', async () => {
    const { revision, url } = await setup('Phase 25 rollback');
    const input = environmentalInput({ outsideC: -4 }), before = await rows(revision.id);
    await db.pool.query(`create function project_private.environmental_test_failure() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;
      create trigger environmental_test_failure before insert on public.idempotency_records for each row execute function project_private.environmental_test_failure()`);
    try {
      const failed = await app.inject({ method: 'POST', url, headers: { ...owner, 'idempotency-key': randomUUID() }, payload: input });
      expect(failed.statusCode).toBe(500); expect(failed.body).not.toContain('injected');
    } finally { await db.pool.query('drop trigger environmental_test_failure on public.idempotency_records; drop function project_private.environmental_test_failure()'); }
    expect(await rows(revision.id)).toBe(before);
    expect((await app.inject({ method: 'POST', url, headers: owner, payload: input })).statusCode).toBe(201);
    const unsigned = buildApp({ env: env(), backend: createPgBackend(db.pool, { owner: ownerId }), captureError: () => undefined });
    try {
      const response = await unsigned.inject({ method: 'POST', url, headers: owner, payload: input });
      expect(response.statusCode).toBe(503); expect(response.json().error.code).toBe('ENVIRONMENTAL_UNAVAILABLE');
      expect((await unsigned.inject({ method: 'POST', url: url.replace('/analyses', '/validate'), headers: owner, payload: input })).statusCode).toBe(200);
    } finally { await unsigned.close(); }
  });

  it('rejects a fabricated calculator result before signing or persistence', async () => {
    const { revision, url } = await setup('Phase 25 untrusted calculator'), before = await rows(revision.id), real = REFERENCE_CALCULATOR.analyze;
    REFERENCE_CALCULATOR.analyze = (ai, o) => {
      const raw = real(ai, o) as { results: { thermal: { cases: { surfaces: { heatFlow: { value: number } | null }[] }[] } } };
      raw.results.thermal.cases[0]!.surfaces.find(s => s.heatFlow)!.heatFlow!.value *= 2; return raw;
    };
    try {
      const r = await app.inject({ method: 'POST', url, headers: owner, payload: environmentalInput({ outsideC: 3 }) });
      expect(r.statusCode).toBe(422); expect(r.json().error.code).toBe('ENVIRONMENTAL_RESULT_INVALID');
    } finally { REFERENCE_CALCULATOR.analyze = real; }
    expect(await rows(revision.id)).toBe(before);
  });

  it('charges validation and analysis to the generation quota and reads to the read quota', async () => {
    const { url } = await setup('Phase 25 quotas');
    const limited = buildApp({ env: env(secret, { RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_GENERATE: '1', RATE_LIMIT_READ: '50' }), backend: createPgBackend(db.pool, { owner: ownerId }), captureError: () => undefined });
    try {
      const input = environmentalInput();
      expect((await limited.inject({ method: 'POST', url: url.replace('/analyses', '/validate'), headers: owner, payload: input })).statusCode).toBe(200);
      const throttled = await limited.inject({ method: 'POST', url, headers: owner, payload: input });
      expect(throttled.statusCode).toBe(429); expect(throttled.json().error.code).toBe('RATE_LIMITED');
      for (const read of [url, url.replace('/analyses', '/status')]) expect((await limited.inject({ url: read, headers: owner })).statusCode).toBe(200);
    } finally { await limited.close(); }
  });
});

describe('Phase 25 migration upgrade from the 0014 schema', () => {
  async function digests(pool: Pool) {
    const tables = (await pool.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by relname")).rows.map(r => r.relname as string);
    const out: Record<string, unknown> = {};
    for (const t of tables) out[t] = (await pool.query(`select count(*)::int n, md5(coalesce(string_agg(row_to_json(x)::text, '|' order by row_to_json(x)::text), '')) d from public.${t} x`)).rows[0];
    const rls = (await pool.query("select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by relname")).rows;
    const policies = (await pool.query("select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname='public' order by tablename, policyname")).rows;
    return { tables: out, rls, policies };
  }
  it('applies 0015 over a populated database (including Phase 24 structural rows) without changing existing rows, RLS or policies', async () => {
    const old = await startTestDatabase({ migrations: name => name < '0015' });
    try {
      const ownerId = await createTestUser(old.pool), oldSecret = (await old.pool.query('select secret from project_private.commit_key')).rows[0].secret;
      const oldApp = buildApp({ env: env(oldSecret), backend: createPgBackend(old.pool, { owner: ownerId }), captureError: () => undefined });
      try {
        const project = await oldApp.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Pre-Phase-25 project' } });
        const revision = await oldApp.inject({ method: 'POST', url: `/api/projects/${project.json().id}/revisions/generate`, headers: owner, payload: { requirements: parametricInput(true) } });
        expect(revision.statusCode, revision.body).toBe(201);
        const r = revision.json().revision, base = `/api/projects/${project.json().id}/revisions/${r.id}`;
        expect((await oldApp.inject({ method: 'POST', url: `${base}/takeoffs`, headers: owner, payload: {} })).statusCode).toBe(201);
        expect((await oldApp.inject({ method: 'POST', url: `${base}/structural/analyses`, headers: owner, payload: frameInput(r.model) })).statusCode).toBe(201);
        const missing = await oldApp.inject({ method: 'POST', url: `${base}/environmental/analyses`, headers: owner, payload: environmentalInput() });
        expect(missing.statusCode).toBeGreaterThanOrEqual(500);
        const before = await digests(old.pool);
        const sql = await readFile(new URL('../../../supabase/migrations/0015_environmental_analyses.sql', import.meta.url), 'utf8');
        await old.pool.query(`begin;\n${sql}\ncommit;`);
        const after = await digests(old.pool);
        expect(Object.keys(after.tables)).toEqual([...Object.keys(before.tables), 'project_revision_environmental_analyses'].sort());
        for (const [table, value] of Object.entries(before.tables)) expect(after.tables[table], table).toEqual(value);
        expect(after.rls.every(row => row.relrowsecurity)).toBe(true);
        expect(after.policies.filter(p => p.tablename !== 'project_revision_environmental_analyses')).toEqual(before.policies);
        const created = await oldApp.inject({ method: 'POST', url: `${base}/environmental/analyses`, headers: owner, payload: environmentalInput() });
        expect(created.statusCode, created.body.slice(0, 300)).toBe(201); expect(created.json().snapshot.binding.revisionId).toBe(r.id);
        // The structural operation is still accepted by the redefined idempotency constraint.
        expect((await oldApp.inject({ method: 'POST', url: `${base}/structural/analyses`, headers: { ...owner, 'idempotency-key': randomUUID() }, payload: frameInput(r.model, { lineLoadKnPerM: -9 }) })).statusCode).toBe(201);
      } finally { await oldApp.close(); }
    } finally { await old.stop(); }
  });
});
