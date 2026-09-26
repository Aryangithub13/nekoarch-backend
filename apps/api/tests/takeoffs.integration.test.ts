import { auditBlueprint } from '@designflow/blueprint-qa';
import { projectQaOptions } from '../src/services/project-service.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDatabase, asPrincipal, createTestUser } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { takeoffAcceptance } from '../../../test-support/takeoff-acceptance.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { calculateQuantityTakeoff } from '@designflow/quantity-takeoff';
import { signProjectCommit } from '../src/services/project-service.js';
import { TAKEOFF_OPERATION, takeoffFingerprint } from '../src/services/takeoff-service.js';

describe('immutable takeoffs on PostgreSQL transactions and RLS', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>;
  let app: ReturnType<typeof buildApp>;
  let ownerId: string; let otherId: string; let secret: string;
  const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
  beforeAll(async () => {
    db = await startTestDatabase(); ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test',
      LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret }), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });
  takeoffAcceptance(() => ({ app, owner, other }));
  async function setup() {
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Takeoff database tests' } });
    const r = await app.inject({ method: 'POST', url: `/api/projects/${p.json().id}/revisions`, headers: owner, payload: { model: authored() } });
    expect(r.statusCode,r.body).toBe(201);
    const revision = r.json().revision, report = calculateQuantityTakeoff(revision.model);
    const input = { projectId: p.json().id, projectRevisionId: revision.id, acceptanceQaId: revision.qa.id, report,
      inputFingerprint: takeoffFingerprint({ projectRevisionId: revision.id, model: revision.model, engineVersion: report.engineVersion, measurementPolicyVersion: report.measurementPolicyVersion, options: report.options }) };
    return { input, url: `/api/projects/${p.json().id}/revisions/${revision.id}/takeoffs`, revision };
  }
  async function rpc(input: unknown, user = ownerId, signature?: ReturnType<typeof signProjectCommit>, context: unknown = null) {
    return asPrincipal(db.pool, user, c => c.query('select public.takeoff_write($1,$2,$3,$4) response',
      [JSON.stringify(input), context ? JSON.stringify(context) : null, signature?.envelope ?? null, signature?.signature ?? null]));
  }
  const sign = (input: unknown) => signProjectCommit(secret, ownerId, TAKEOFF_OPERATION, input);
  it('denies client writes, unsigned/forged RPCs, cross-user association and anonymous access', async () => {
    const { input } = await setup();
    await expect(rpc(input)).rejects.toMatchObject({ code: '42501' });
    const signed = sign(input);
    await expect(rpc(input, otherId, signed)).rejects.toMatchObject({ code: '42501' });
    await expect(rpc({ ...input, inputFingerprint: 'a'.repeat(64) }, ownerId, signed)).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(input, ownerId, { ...signed, signature: 'a'.repeat(64) })).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(input, otherId, signProjectCommit(secret, otherId, TAKEOFF_OPERATION, input))).rejects.toMatchObject({ code: 'P1201' });
    const result = (await rpc(input, ownerId, signed)).rows[0].response;
    expect((await asPrincipal(db.pool,ownerId,c=>c.query('select id from public.project_revision_takeoffs where id=$1',[result.id]))).rows).toHaveLength(1);
    expect((await asPrincipal(db.pool,otherId,c=>c.query('select id from public.project_revision_takeoffs where id=$1',[result.id]))).rows).toHaveLength(0);
    for (const sql of ["update public.project_revision_takeoffs set report_json='{}'", 'delete from public.project_revision_takeoffs', 'insert into public.project_revision_takeoffs default values']) {
      await expect(asPrincipal(db.pool,ownerId,c=>c.query(sql))).rejects.toMatchObject({ code: '42501' });
    }
    await expect(asPrincipal(db.pool,null,c=>c.query('select * from public.project_revision_takeoffs'))).rejects.toMatchObject({ code:'42501' });
    await expect(db.pool.query('delete from public.project_revision_takeoffs where id=$1',[result.id])).rejects.toMatchObject({code:'23514'});
    await expect(db.pool.query("update public.project_revision_takeoffs set status='EVALUATED' where id=$1",[result.id])).rejects.toMatchObject({code:'23514'});
  });
  it('validates revision existence, exact fingerprint and acceptance QA anchor inside RPC', async () => {
    const { input } = await setup();
    for (const [change, code] of [[{ projectRevisionId: randomUUID() },'P1205'], [{ acceptanceQaId: randomUUID() },'P1302'], [{ inputFingerprint: '0'.repeat(64) },'P1303']] as const) {
      const changed = { ...input,...change }; await expect(rpc(changed,ownerId,sign(changed))).rejects.toMatchObject({code});
    }
    // Privileged insertion of a FAIL historical QA record does not change accepted QA.
    await db.pool.query(`insert into public.project_revision_qa_runs(revision_id,qa_version,model_schema_version,rule_packs,status,report_json)
      select revision_id,'future-qa',model_schema_version,rule_packs,'FAIL',jsonb_set(jsonb_set(report_json,'{status}','"FAIL"'),'{qaVersion}','"future-qa"') from public.project_revision_qa_runs where id=$1`,[input.acceptanceQaId]);
    const dto = (await rpc(input,ownerId,sign(input))).rows[0].response; expect(dto.acceptanceQaId).toBe(input.acceptanceQaId);
  });
  it('rejects an existing revision whose acceptance evidence is FAIL at both API and DB gates', async () => {
    const { input, revision } = await setup();
    const rejectedModel = authored(); rejectedModel.openings = []; rejectedModel.dimensions = [];
    const report = auditBlueprint(rejectedModel, projectQaOptions(rejectedModel)); expect(report.status).toBe('FAIL');
    const rejectedId = randomUUID(), qaId = randomUUID();
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      await client.query(`insert into public.project_revisions(id,project_id,revision_number,parent_revision_id,model_json,source_mode,created_by,acceptance_qa_id)
        values($1,$2,2,$3,$4,'supplied',$5,$6)`,[rejectedId,input.projectId,revision.id,JSON.stringify(rejectedModel),ownerId,qaId]);
      await client.query(`insert into public.project_revision_qa_runs(id,revision_id,qa_version,model_schema_version,rule_packs,status,report_json)
        values($1,$2,$3,2,$4,'FAIL',$5)`,[qaId,rejectedId,report.qaVersion,JSON.stringify(report.rulePacks),JSON.stringify(report)]);
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
    const bad = { ...input, projectRevisionId: rejectedId, acceptanceQaId: qaId };
    await expect(rpc(bad,ownerId,sign(bad))).rejects.toMatchObject({code:'P1302'});
    const response = await app.inject({method:'POST',url:`/api/projects/${input.projectId}/revisions/${rejectedId}/takeoffs`,headers:owner,payload:{}});
    expect(response.statusCode,response.body).toBe(422); expect(response.json().error.code).toBe('REVISION_NOT_ACCEPTED');
    expect((await db.pool.query('select id from public.project_revision_takeoffs where project_revision_id=$1',[rejectedId])).rows).toHaveLength(0);
  });
  it('separates future engine/policy artifacts and rejects report drift for the same identity', async () => {
    const { input,revision } = await setup();
    const original = (await rpc(input,ownerId,sign(input))).rows[0].response;
    const futureReport = { ...input.report, engineVersion: 'quantity-takeoff-future', measurementPolicyVersion: 'future-policy' };
    const future = { ...input, report: futureReport, inputFingerprint: takeoffFingerprint({ projectRevisionId: revision.id, model: revision.model,
      engineVersion: futureReport.engineVersion, measurementPolicyVersion: futureReport.measurementPolicyVersion, options: futureReport.options }) };
    expect((await rpc(future,ownerId,sign(future))).rows[0].response.id).not.toBe(original.id);
    const drift = { ...input, report: { ...input.report, warnings: [] } };
    await expect(rpc(drift,ownerId,sign(drift))).rejects.toMatchObject({code:'P1303'});
  });
  it('rolls back takeoff and receipt together if durable receipt insertion fails', async () => {
    const { url,input } = await setup();
    await db.pool.query(`create function project_private.takeoff_test_failure() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;
      create trigger takeoff_test_failure before insert on public.idempotency_records for each row execute function project_private.takeoff_test_failure()`);
    try {
      const response = await app.inject({method:'POST',url,headers:{...owner,'idempotency-key':randomUUID()},payload:{}});
      expect(response.statusCode).toBe(500); expect(response.body).not.toContain('injected');
    } finally { await db.pool.query('drop trigger takeoff_test_failure on public.idempotency_records; drop function project_private.takeoff_test_failure()'); }
    expect((await db.pool.query('select id from public.project_revision_takeoffs where project_revision_id=$1',[input.projectRevisionId])).rows).toHaveLength(0);
    expect((await app.inject({method:'POST',url,headers:owner,payload:{}})).statusCode).toBe(201);
  });
  it('fails closed without signer and retains HTTP body limits', async () => {
    const {url}=await setup();
    const unconfigured=buildApp({env:parseEnv({SUPABASE_URL:'http://localhost:54321',SUPABASE_ANON_KEY:'test',LOG_LEVEL:'silent',RATE_LIMIT_ENABLED:'false'}),backend:createPgBackend(db.pool,{owner:ownerId})});
    try { expect((await unconfigured.inject({method:'POST',url,headers:owner,payload:{}})).statusCode).toBe(503); }
    finally { await unconfigured.close(); }
    expect((await app.inject({method:'POST',url,headers:owner,payload:{options:{x:'x'.repeat(70000)}}})).statusCode).toBe(400);
  });
});
