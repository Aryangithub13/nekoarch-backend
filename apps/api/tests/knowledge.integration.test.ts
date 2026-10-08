import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asPrincipal, createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { knowledgeAcceptance, knowledgeInput } from '../../../test-support/knowledge-acceptance.js';
import { environmentalInput } from '../../../test-support/environmental-fixtures.js';
import { systemsInput, wetFrameInput, wetRequirements } from '../../../test-support/systems-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { digest } from '../src/bim/core.js';
import { signProjectCommit } from '../src/services/project-service.js';
import { KNOWLEDGE_ANALYSIS_OPERATION } from '../src/services/knowledge-service.js';
import { COORDINATION_PACK, DIMENSIONAL_PACK } from '../src/knowledge/packs.js';

const env = (secret?: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', ...(secret ? { PROJECT_COMMIT_SECRET: secret } : {}) });
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Snap = Record<string, any>;

describe('Phase 27 specialized-knowledge persistence on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, ownerId: string, otherId: string, secret: string;
  beforeAll(async () => {
    db = await startTestDatabase(); ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });
  knowledgeAcceptance(() => ({ app, owner, other }));

  it('hashes every bundled pack identically in TypeScript and SQL (checksum parity)', async () => {
    const nested = { a: [{ b: '0.0496', c: true, d: null, e: { z: 'x', A: 'y' } }], 'k-1': 'é"\\', k: [], n: 12 };
    for (const value of [DIMENSIONAL_PACK, COORDINATION_PACK, nested])
      expect((await db.pool.query('select project_private.cost_hash($1::jsonb) h', [JSON.stringify(value)])).rows[0].h).toBe(digest(value));
  });

  async function setup(title = 'Phase 27 database tests') {
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title } });
    const r = await app.inject({ method: 'POST', url: `/api/projects/${p.json().id}/revisions/generate`, headers: owner, payload: { requirements: wetRequirements() } });
    expect(r.statusCode, r.body).toBe(201);
    const revision = r.json().revision, revisionUrl = `/api/projects/${p.json().id}/revisions/${revision.id}`;
    const post = async (path: string, payload: object) => (await app.inject({ method: 'POST', url: `${revisionUrl}/${path}/analyses`, headers: owner, payload })).json() as Snap;
    const S = await post('structural', wetFrameInput()), E = await post('environmental', environmentalInput()), Y = await post('systems', systemsInput());
    const created = await app.inject({ method: 'POST', url: `${revisionUrl}/knowledge/analyses`, headers: owner,
      payload: knowledgeInput({ structuralAnalysisId: S.id, environmentalAnalysisId: E.id, systemsAnalysisId: Y.id }) });
    expect(created.statusCode, created.body.slice(0, 400)).toBe(201);
    const write = { projectId: p.json().id as string, projectRevisionId: revision.id as string, acceptanceQaId: revision.qa.id as string, snapshot: created.json().snapshot as Snap };
    return { projectId: p.json().id as string, revision, revisionUrl, created: created.json(), write, S, E, Y };
  }
  type Write = Awaited<ReturnType<typeof setup>>['write'];
  /** A copy with a different disciplines scope: a genuinely new identity whose hashes recompute, so later checks are reached. */
  const variant = (write: Write, change: (s: Snap) => void = () => undefined, rehash = true): Write => {
    const copy = structuredClone(write), s = copy.snapshot;
    s.input.scope.disciplines = ['ARCHITECTURE']; s.binding.disciplines = ['ARCHITECTURE'];
    change(s);
    if (rehash) s.inputHash = digest({ version: s.version, binding: s.binding, input: s.input });
    return copy;
  };
  const rpc = (input: unknown, user = ownerId, signature?: { envelope: string; signature: string }, context: unknown = null) => asPrincipal(db.pool, user, c =>
    c.query('select public.knowledge_write($1,$2,$3,$4) response', [JSON.stringify(input), context ? JSON.stringify(context) : null, signature?.envelope ?? null, signature?.signature ?? null]));
  const sign = (input: unknown, user = ownerId) => signProjectCommit(secret, user, KNOWLEDGE_ANALYSIS_OPERATION, input);
  const signed = (input: unknown) => rpc(input, ownerId, sign(input));
  const rows = async (revisionId: string) => (await db.pool.query('select id from public.project_revision_specialized_knowledge_analyses where project_revision_id=$1', [revisionId])).rows.length;

  it('denies direct writes, unsigned or forged RPCs, cross-user association, mutation and foreign or anonymous reads', async () => {
    const { write, created } = await setup();
    const fresh = variant(write);
    await expect(rpc(fresh)).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(fresh, ownerId, { ...sign(fresh), signature: 'a'.repeat(64) })).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(fresh, otherId, sign(fresh))).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(fresh, otherId, sign(fresh, otherId))).rejects.toMatchObject({ code: 'P1201' });
    await expect(asPrincipal(db.pool, ownerId, c => c.query(`insert into public.project_revision_specialized_knowledge_analyses(project_revision_id,acceptance_qa_id,knowledge_model_version,
      analysis_version,model_hash,input_hash,facts_hash,pack_identities,evaluator_name,evaluator_version,status,snapshot_json)
      select project_revision_id,acceptance_qa_id,knowledge_model_version,analysis_version,model_hash,repeat('e',64),facts_hash,pack_identities,evaluator_name,evaluator_version,status,snapshot_json
      from public.project_revision_specialized_knowledge_analyses where id=$1`, [created.id]))).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, ownerId, c => c.query(`update public.project_revision_specialized_knowledge_analyses set status='VALIDATED' where id=$1`, [created.id])))
      .rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, ownerId, c => c.query('delete from public.project_revision_specialized_knowledge_analyses where id=$1', [created.id]))).rejects.toMatchObject({ code: '42501' });
    await expect(db.pool.query(`update public.project_revision_specialized_knowledge_analyses set status='VALIDATED' where id=$1`, [created.id])).rejects.toThrow(/immutable/i);
    await expect(db.pool.query('delete from public.project_revision_specialized_knowledge_analyses where id=$1', [created.id])).rejects.toThrow(/immutable/i);
    const visible = async (user: string | null) => (await asPrincipal(db.pool, user, c => c.query('select id from public.project_revision_specialized_knowledge_analyses where id=$1', [created.id]))).rows.length;
    expect(await visible(ownerId)).toBe(1); expect(await visible(otherId)).toBe(0);
    await expect(visible(null)).rejects.toMatchObject({ code: '42501' });
    await expect(asPrincipal(db.pool, otherId, c => c.query(`select public.knowledge_read('get',$1,$2,$3)`, [write.projectId, write.projectRevisionId, created.id])))
      .rejects.toMatchObject({ code: 'P1201' });
  });

  it('recomputes revision binding, input and fact identities, pack checksums, upstream rows and claims in SQL', async () => {
    const { write, revision, S, Y } = await setup();
    const reject = async (w: Write, message: RegExp, code = 'P2703') => { await expect(signed(w)).rejects.toMatchObject({ code }); await expect(signed(w)).rejects.toThrow(message); };
    await reject(variant(write, s => { s.binding.modelHash = 'f'.repeat(64); }), /not bound to this revision/);
    await reject(variant(write, s => { s.binding.generationId = '00000000-0000-4000-8000-000000000000'; }), /not bound to this revision/);
    await reject(variant(write, () => undefined, false), /not bound to this revision/); // forged (stale) input hash
    await reject(variant(write, s => { s.facts.items[0].value = { kind: 'DECIMAL', exact: '1', unit: 'mm' }; }), /not bound to this revision/); // forged fact without factsHash
    await reject(variant(write, s => { s.input.sources.systemsAnalysisId = null; }), /not bound to this revision/);
    await reject(variant(write, s => { s.packs[0].pack.title = 'Forged pack'; }), /checksum does not recompute/);
    await reject(variant(write, s => { s.packs[0].checksum = 'a'.repeat(64); }), /checksum does not recompute/);
    await reject(variant(write, s => { s.binding.packs[0].checksum = 'b'.repeat(64); s.packs[0].checksum = 'b'.repeat(64); }), /checksum does not recompute/);
    await reject(variant(write, s => { s.packs.pop(); }), /selection is malformed/);
    // Upstream identities: unknown analysis, another revision's analysis, wrong input hash.
    const forgedId = '00000000-0000-4000-8000-0000000000aa';
    await reject(variant(write, s => { s.binding.systems.analysisId = forgedId; s.input.sources.systemsAnalysisId = forgedId; }), /Systems source is not an analysis of this revision/);
    await reject(variant(write, s => { s.binding.structural.inputHash = 'c'.repeat(64); }), /Structural source is not an analysis of this revision/);
    const other = await setup('Phase 27 other revision');
    await reject(variant(write, s => { s.binding.systems = other.write.snapshot.binding.systems; s.input.sources.systemsAnalysisId = other.Y.id; }),
      /Systems source is not an analysis of this revision/);
    // Claims are not evaluator-controlled.
    await reject(variant(write, s => { s.claims.buildingCodeCompliance = 'CLAIMED'; }), /check constraint|violates/i, '23514');
    await reject(variant(write, s => { s.claims.extraCertification = 'CLAIMED'; }), /check constraint|violates/i, '23514');
    expect(await rows(revision.id)).toBe(1);
    expect(S.id).toBeTruthy(); expect(Y.id).toBeTruthy();
  });

  it('converges idempotent replays and concurrent identical writes on one immutable row and pages stably', async () => {
    const { write, revision, revisionUrl } = await setup();
    const fresh = variant(write);
    const [a, b] = await Promise.all([signed(fresh), signed(fresh)]);
    expect(a.rows[0].response.id).toBe(b.rows[0].response.id);
    expect(await rows(revision.id)).toBe(2);
    const forged = structuredClone(fresh); forged.snapshot.results[0].status = 'MEETS_RULE';
    await expect(signed(forged)).rejects.toThrow(/Nondeterministic/);
    for (const d of ['MEP', 'QUANTITY', 'STRUCTURAL']) {
      const r = await app.inject({ method: 'POST', url: `${revisionUrl}/knowledge/analyses`, headers: owner,
        payload: knowledgeInput({ ...write.snapshot.input.sources }, [d]) });
      expect(r.statusCode, r.body.slice(0, 300)).toBe(201);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Snap = (await app.inject({ url: `${revisionUrl}/knowledge/analyses?limit=2${cursor ? `&cursor=${cursor}` : ''}`, headers: owner })).json();
      seen.push(...page.items.map((i: Snap) => i.id)); cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(5); expect(new Set(seen).size).toBe(5);
    expect((await app.inject({ url: `${revisionUrl}/knowledge/analyses?cursor=not-a-cursor`, headers: owner })).statusCode).toBe(400);
  });

  it('applies 0017 after 0001–0016 with owner-only RLS and preserves earlier tables', async () => {
    const applied = (await db.pool.query(`select relrowsecurity from pg_class where relname='project_revision_specialized_knowledge_analyses'`)).rows[0];
    expect(applied.relrowsecurity).toBe(true);
    const policies = (await db.pool.query(`select policyname from pg_policies where tablename='project_revision_specialized_knowledge_analyses'`)).rows.map(r => r.policyname);
    expect(policies).toEqual(['knowledge_owner_read']);
    for (const t of ['project_revision_structural_analyses', 'project_revision_environmental_analyses', 'project_revision_building_systems_analyses'])
      expect((await db.pool.query('select relrowsecurity from pg_class where relname=$1', [t])).rows[0].relrowsecurity).toBe(true);
    const grants = (await db.pool.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name='project_revision_specialized_knowledge_analyses'
      and grantee in ('anon','authenticated')`)).rows;
    expect(grants).toEqual([{ grantee: 'authenticated', privilege_type: 'SELECT' }]);
  });

  it('returns 503 when the signer is not configured', async () => {
    const { revisionUrl, write } = await setup('Phase 27 signer');
    const unsigned = buildApp({ env: env(), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await unsigned.ready();
    try {
      const r = await unsigned.inject({ method: 'POST', url: `${revisionUrl}/knowledge/analyses`, headers: owner, payload: knowledgeInput(write.snapshot.input.sources, ['COST']) });
      expect(r.statusCode).toBe(503); expect(r.json().error.code).toBe('KNOWLEDGE_UNAVAILABLE'); expect(r.body).not.toContain(secret);
    } finally { await unsigned.close(); }
  });
});
