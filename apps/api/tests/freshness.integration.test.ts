import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as generator from '@designflow/generator';
import { createHash, randomUUID } from 'node:crypto';
import { costHash } from '@designflow/boq-cost';
import { startTestDatabase, asPrincipal, createTestUser } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { freshnessAcceptance, freshnessRequirements } from '../../../test-support/freshness-acceptance.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { generateBlueprint, normalizeBlueprintRequirements, BLUEPRINT_VERSION } from '@designflow/generator';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { projectQaOptions, signProjectCommit } from '../src/services/project-service.js';
import { GENERATION_IDENTITY_VERSION, modelHash, requirementsHash } from '../src/lib/generation-identity.js';
import { GenerateRevisionRequestSchema } from '../src/contracts/projects.js';

describe('generation freshness on real PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, ownerId: string, otherId: string, secret: string;
  const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
  beforeAll(async () => {
    db = await startTestDatabase(); ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret }), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });
  freshnessAcceptance(() => ({ app, owner, other }), process.env.PHASE17_EXAMPLE_PATH);

  it('executes the generator once for a sequential durable retry and never for a conflicting retry', async () => {
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Observed execution' } });
    const spy = vi.spyOn(generator, 'generateBlueprint');
    try {
      const headers = { ...owner, 'idempotency-key': randomUUID() }, payload = { requirements: freshnessRequirements() };
      const url = `/api/projects/${p.json().id}/revisions/generate`;
      const first = await app.inject({ method: 'POST', url, headers, payload });
      expect(first.statusCode, first.body).toBe(201);
      const retry = await app.inject({ method: 'POST', url, headers, payload });
      expect(retry.json()).toEqual(first.json());
      const changed = await app.inject({ method: 'POST', url, headers, payload: { requirements: freshnessRequirements(4) } });
      expect(changed.statusCode).toBe(409); expect(changed.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });

  async function fixture() {
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Identity attestation' } });
    const normalizedRequirements = normalizeBlueprintRequirements(freshnessRequirements()), model = generateBlueprint(normalizedRequirements).model;
    return { projectId: p.json().id, baseRevisionId: null, sourceMode: 'generated', generatorVersion: BLUEPRINT_VERSION,
      model, report: auditBlueprint(model, projectQaOptions(model)), normalizedRequirements,
      identity: { identityVersion: GENERATION_IDENTITY_VERSION, generationId: randomUUID(), requirementsHash: requirementsHash(normalizedRequirements), modelHash: modelHash(model), seed: normalizedRequirements.seed } };
  }
  const operation = '/api/projects/:projectId/revisions/generate';
  async function rpc(input: unknown, actor = ownerId, signed = true) {
    const signature = signed ? signProjectCommit(secret, ownerId, operation, input) : undefined;
    return asPrincipal(db.pool, actor, client => client.query('select public.project_write($1,$2,null,$3,$4) result', ['revision', JSON.stringify(input), signature?.envelope ?? null, signature?.signature ?? null]));
  }
  it('independently verifies signed input/output hashes, seed and execution identity in the database', async () => {
    const input = await fixture();
    for (const identity of [
      { ...input.identity, modelHash: '0'.repeat(64) }, { ...input.identity, requirementsHash: '0'.repeat(64) },
      { ...input.identity, seed: 'forged' }, { ...input.identity, generationId: null },
      { ...input.identity, unexpected: 'field' },
    ]) await expect(rpc({ ...input, identity })).rejects.toMatchObject({ code: '23514' });
    await expect(rpc(input, ownerId, false)).rejects.toMatchObject({ code: '42501' });
    await expect(rpc(input, otherId)).rejects.toMatchObject({ code: '42501' });
    const result = (await rpc(input)).rows[0].result;
    expect(result.revision.identity).toEqual(input.identity);
    const sql = await db.pool.query('select project_private.cost_hash(jsonb_build_object(\'identityVersion\',\'generation-freshness-v1\',\'model\',project_private.canonical_building($1))) hash', [JSON.stringify(input.model)]);
    expect(sql.rows[0].hash).toBe(modelHash(input.model));
    await expect(db.pool.query('update public.project_revisions set generation_identity=null where id=$1', [result.revision.id])).rejects.toMatchObject({ code: '23514' });
    await expect(asPrincipal(db.pool, ownerId, c => c.query('update public.project_revisions set normalized_requirements=null'))).rejects.toMatchObject({ code: '42501' });
    expect((await asPrincipal(db.pool, otherId, c => c.query('select generation_identity from public.project_revisions where id=$1', [result.revision.id]))).rows).toEqual([]);
  });
  it('preserves unknown historical identity without fabricating requirements or executions', async () => {
    const { identity: _identity, normalizedRequirements: _requirements, ...oldInput } = await fixture();
    const result = (await rpc(oldInput)).rows[0].result;
    expect(result.revision.identity).toBeNull(); expect(result.revision.normalizedRequirements).toBeNull();
    expect((await app.inject({ url: `/api/projects/${oldInput.projectId}?includeFreshness=true`, headers: owner })).json().currentRevision.identity).toBeNull();
  });
  it('replays a pre-Phase-17 receipt without adding fields to its original durable body', async () => {
    const { identity: _identity, normalizedRequirements: _requirements, ...oldInput } = await fixture();
    const original = (await rpc(oldInput)).rows[0].result;
    delete original.revision.identity; delete original.revision.normalizedRequirements;
    const key = randomUUID(), request = GenerateRevisionRequestSchema.parse({ requirements: freshnessRequirements() });
    await db.pool.query('insert into public.idempotency_records(user_id,operation,key_hash,fingerprint,response) values($1,$2,$3,$4,$5)',
      [ownerId, operation, createHash('sha256').update(key).digest('hex'), costHash({ projectId: oldInput.projectId, ...request }), original]);
    const response = await app.inject({ method: 'POST', url: `/api/projects/${oldInput.projectId}/revisions/generate`,
      headers: { ...owner, 'idempotency-key': key }, payload: request });
    expect(response.statusCode, response.body).toBe(201); expect(response.json()).toEqual(original);
    expect(response.json().revision).not.toHaveProperty('identity');
  });
  it('stores supplied geometry identity without falsely attributing a new generation', async () => {
    const input = await fixture();
    const response = await app.inject({ method: 'POST', url: `/api/projects/${input.projectId}/revisions`, headers: owner, payload: { model: input.model } });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().revision.identity).toEqual({ identityVersion: GENERATION_IDENTITY_VERSION, generationId: null, requirementsHash: null, modelHash: modelHash(input.model), seed: null });
    expect(response.json().revision.normalizedRequirements).toBeNull();
  });
});
