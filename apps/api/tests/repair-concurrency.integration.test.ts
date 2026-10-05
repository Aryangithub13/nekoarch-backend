import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { startTestDatabase, createTestUser } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { ConversationRepository } from '../src/lib/conversation-repository.js';
import { ConversationSchema } from '../src/contracts/conversations.js';
import { initialConversation, planConversation } from '../src/ai/conversation-planner.js';
import { AiProviderError } from '../src/contracts/ai-orchestration.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';

let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, cr: ConversationRepository;
let owner: string, secret: string;
const headers = { authorization: 'Bearer owner' };
beforeAll(async () => {
  db = await startTestDatabase(); owner = await createTestUser(db.pool);
  secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
  const backend = createPgBackend(db.pool, { owner });
  app = buildApp({ env: parseEnv({ NODE_ENV: 'test', SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', PROJECT_COMMIT_SECRET: secret, RATE_LIMIT_ENABLED: 'false', LOG_LEVEL: 'silent' }), backend, captureError: () => {} });
  cr = new ConversationRepository(backend.repository('owner'), owner, secret);
});
afterAll(async () => { await app?.close(); await db?.stop(); });
async function fixture() {
  const p = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { title: 'Repair isolated fixture' } });
  expect(p.statusCode).toBe(201);
  const params = { projectId: p.json().id as string, conversationId: randomUUID() };
  const state = initialConversation(null, null, false);
  await cr.write('create', { ...params, state });
  const message = { messageId: randomUUID(), expectedVersion: 0, baseRevisionId: null, text: '10 by 12 m plot, 2 bedrooms' };
  return { params, state, message, url: `/api/projects/${params.projectId}/conversations/${params.conversationId}/messages` };
}
it('cleans a rejected message and permits retry with the same receipt ID', async () => {
  const f = await fixture();
  const bad = await app.inject({ method: 'POST', url: f.url, headers, payload: { ...f.message, text: 'run shell' } });
  expect(bad.statusCode).toBe(422);
  const retry = await app.inject({ method: 'POST', url: f.url, headers, payload: f.message });
  expect(retry.statusCode, retry.body).toBe(200);
  expect(retry.json().state.version).toBe(1);
  expect((await app.inject({ method: 'POST', url: f.url, headers, payload: f.message })).json()).toEqual(retry.json());
});
it.each(['PROVIDER_TIMEOUT', 'REQUEST_CANCELLED', 'invalid-response'] as const)('cleans planner/provider failure %s', async failure => {
  const f = await fixture();
  const failing = buildApp({ env: parseEnv({ NODE_ENV: 'test', SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', PROJECT_COMMIT_SECRET: secret, RATE_LIMIT_ENABLED: 'false', LOG_LEVEL: 'silent' }), backend: createPgBackend(db.pool, { owner }), captureError: () => {},
    conversationProvider: { kind: 'fixture', model: 'fixture', capabilities: { structuredOutput: true, supportsTools: false, maxContextBytes: 12000 }, async interpret() { throw new Error('unused'); }, async orchestrate() { if (failure === 'invalid-response') throw new Error('fixture validation failure'); throw new AiProviderError(failure); } } });
  try {
    expect((await failing.inject({ method: 'POST', url: f.url, headers, payload: f.message })).statusCode).toBe(failure === 'REQUEST_CANCELLED' ? 408 : failure === 'invalid-response' ? 500 : 503);
    expect((await app.inject({ method: 'POST', url: f.url, headers, payload: f.message })).statusCode).toBe(200);
  } finally { await failing.close(); }
});
it('fences stale cancellation and never erases a committed receipt', async () => {
  const f = await fixture(), old = randomUUID(), token = randomUUID();
  const input = { ...f.params, ...f.message, fingerprint: 'fixture', token: old };
  await cr.write('reserve', input);
  await db.pool.query("update architectural_conversations set pending_until=clock_timestamp()-interval '1 second' where id=$1", [f.params.conversationId]);
  await cr.write('reserve', { ...input, token });
  expect(await cr.write('cancel-message', { ...f.params, token: old })).toEqual({ cancelled: false });
  const state = await planConversation(f.state, f.message);
  await cr.write('finish', { ...f.params, token, state });
  expect(await cr.write('cancel-message', { ...f.params, token })).toEqual({ cancelled: false });
  expect(await cr.write('reserve', { ...input, token: randomUUID() })).toMatchObject({ replay: true });
});
it('reads the revision only after a concurrent project writer completes', async () => {
  const f = await fixture(), token = randomUUID();
  await cr.write('reserve', { ...f.params, ...f.message, fingerprint: 'fixture', token });
  const next = await planConversation(f.state, f.message);
  // A genuine accepted revision provides the competing base; restore the pointer
  // only inside this disposable fixture before holding the writer transaction.
  const changed = await app.inject({ method: 'POST', url: `/api/projects/${f.params.projectId}/revisions`, headers, payload: { model: authored() } });
  expect(changed.statusCode).toBe(201);
  const revisionId = changed.json().revision.id as string;
  await db.pool.query('update projects set current_revision_id=null,revision_count=0 where id=$1', [f.params.projectId]);
  const writer = await db.pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await writer.query('begin');
    await writer.query('update projects set current_revision_id=$1,revision_count=1 where id=$2', [revisionId, f.params.projectId]);
    pending = cr.write('finish', { ...f.params, token, state: next }).then(() => 'accepted', e => e.code);
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      const r = await db.pool.query("select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and query like '%public.conversation_write%'");
      if (r.rows[0].n) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
    await writer.query('commit');
    expect(await pending).toBe('REVISION_CONFLICT');
    expect(ConversationSchema.parse(await cr.read('get', f.params)).state.version).toBe(0);
  } finally { await writer.query('rollback'); writer.release(); await pending; }
});
it('upgrade replacement preserves existing rows, grants and RLS', async () => {
  // The same database has already applied 0001–0013 from empty. Reinstall the
  // released function only, then exercise a populated 0012 -> 0013 upgrade.
  const old = await readFile('supabase/migrations/0012_conversations.sql', 'utf8');
  await db.pool.query(old.slice(old.indexOf('create function public.conversation_write')).replace('create function', 'create or replace function'));
  const snapshot = async () => (await db.pool.query("select id,md5(row_to_json(c)::text) digest from architectural_conversations c order by id")).rows;
  const before = await snapshot();
  await db.pool.query(await readFile('supabase/migrations/0013_conversation_serialization.sql', 'utf8'));
  expect(await snapshot()).toEqual(before);
  expect((await db.pool.query("select has_function_privilege('authenticated','public.conversation_write(text,jsonb,text,text)','execute') allowed, has_function_privilege('anon','public.conversation_write(text,jsonb,text,text)','execute') denied")).rows[0]).toEqual({ allowed: true, denied: false });
  expect((await db.pool.query("select relrowsecurity from pg_class where oid='architectural_conversations'::regclass")).rows[0].relrowsecurity).toBe(true);
});
it('persists a QA-accepted one-floor revision after conversational floor reduction', async () => {
  const { normalizeBlueprintRequirements } = await import('@designflow/generator');
  const { requirements } = await import('../../../packages/blueprint-qa/tests/fixtures.js');
  const f = await fixture(), r = normalizeBlueprintRequirements(requirements(2));
  const reduced = await planConversation(initialConversation(null, r, false), { ...f.message, text: 'one floor', nativeUpdate: { rooms: r.rooms.map(room => ({ ...room, level: 0 })) } });
  expect(reduced.status).toBe('AWAITING_APPROVAL');
  const response = await app.inject({ method: 'POST', url: `/api/projects/${f.params.projectId}/revisions/generate`, headers, payload: { requirements: reduced.requirements, baseRevisionId: null } });
  expect(response.statusCode, response.body).toBe(201);
  expect(response.json().revision.model.levels).toHaveLength(1);
  expect(response.json().revision.model.stairs).toHaveLength(0);
});
