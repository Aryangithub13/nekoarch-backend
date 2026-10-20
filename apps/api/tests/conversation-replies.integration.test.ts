import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { startTestDatabase, createTestUser } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { ConversationSchema } from '../src/contracts/conversations.js';
import { parseReply, REPLY_SYSTEM_PROMPT } from '../src/ai/reply-composer.js';

/*
 * Conversational replies from a configured model (a local OpenAI-compatible fake on loopback). The planner stays the
 * authority: a reply only words the state; a general question keeps the previous design; failures fall back.
 */
type Mode = 'ok' | 'general' | 'broken' | 'down';
let mode: Mode = 'ok';
const seen: { system: string; user: string }[] = [];
function fakeModel(): Promise<Server> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const request = JSON.parse(body) as { messages: { role: string; content: string }[] };
      const system = request.messages[0]!.content;
      const user = request.messages[1]!.content;
      if (system === REPLY_SYSTEM_PROMPT) seen.push({ system, user });
      if (mode === 'down') { res.statusCode = 503; res.end('{}'); return; }
      // Intent extraction: return an empty intent so the deterministic grammar decides.
      const content = system !== REPLY_SYSTEM_PROMPT ? '{}'
        : mode === 'broken' ? 'not json at all'
        : JSON.stringify({ reply: mode === 'general' ? 'South-facing living rooms get steady winter sun in India.' : 'Lovely — a 2 floor home with 3 bedrooms. Shall I generate it?', generalQuestion: mode === 'general' });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

describe('design conversation: model-written replies', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, model: Server;
  const owner = { authorization: 'Bearer owner' };
  beforeAll(async () => {
    model = await fakeModel();
    const port = (model.address() as AddressInfo).port;
    db = await startTestDatabase();
    const ownerId = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    const routing = { privacyClass: 'LOCAL_ONLY', deterministicFallback: true, timeoutMs: 5000, providers: [{ providerId: 'fake', type: 'LOCAL_OPENAI_COMPATIBLE', enabled: true, endpoint: `http://127.0.0.1:${port}/v1/chat/completions`, capabilities: ['ARCHITECTURAL_INTENT_EXTRACTION', 'EXPLANATION'], models: [{ modelId: 'fake-model', capabilities: ['ARCHITECTURAL_INTENT_EXTRACTION', 'EXPLANATION'] }] }] };
    app = buildApp({ env: parseEnv({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret, AI_ROUTING_CONFIG: JSON.stringify(routing) }), backend: createPgBackend(db.pool, { owner: ownerId }) });
  });
  afterAll(async () => { await app?.close(); await db?.stop(); await new Promise(r => model?.close(r)); });

  async function conversation() {
    const project = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title: 'Replies' } });
    const projectId = project.json().id as string, conversationId = randomUUID();
    await app.inject({ method: 'POST', url: `/api/projects/${projectId}/conversations`, headers: owner, payload: { conversationId, baseRevisionId: null } });
    let version = 0;
    const say = async (text: string) => {
      const r = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/conversations/${conversationId}/messages`, headers: owner, payload: { messageId: randomUUID(), expectedVersion: version, baseRevisionId: null, text } });
      expect(r.statusCode, r.body).toBe(200);
      const state = ConversationSchema.parse(r.json()).state; version = state.version; return state;
    };
    return { say };
  }

  it('stores the model reply, grounded in the planner state, without changing it', async () => {
    mode = 'ok';
    const { say } = await conversation();
    const state = await say('3 bedroom house on a 30 x 40 ft plot, 2 floors, 2 bathrooms');
    expect(state.status).toBe('AWAITING_APPROVAL');
    expect(state.reply).toMatchObject({ text: expect.stringContaining('3 bedrooms'), provider: 'fake', model: 'fake-model', generalQuestion: false });
    const grounding = JSON.parse(seen.at(-1)!.user) as { STATE: { status: string; proposal: { floors: number } } };
    expect(grounding.STATE.status).toBe('AWAITING_APPROVAL');
    expect(grounding.STATE.proposal.floors).toBe(2);
    expect(seen.at(-1)!.user).not.toMatch(/requirementsHash|[0-9a-f]{64}/);
  });

  it('a general question keeps the pending proposal; a design change is never treated as a question', async () => {
    const { say } = await conversation();
    mode = 'ok';
    const first = await say('3 bedroom house on a 30 x 40 ft plot, 2 floors, 2 bathrooms');
    mode = 'general';
    const asked = await say('Which direction should the living room face in India?');
    expect(asked.reply?.generalQuestion).toBe(true);
    expect(asked.status).toBe('AWAITING_APPROVAL');
    expect(asked.proposal?.id).toBe(first.proposal?.id);
    expect(asked.messages).toHaveLength(2);
    // The model claims "general", but the planner extracted a change: the change wins.
    const changed = await say('make it 4 bedrooms');
    expect(changed.reply?.generalQuestion).toBe(false);
    expect(changed.intent.bedrooms).toBe(4);
  });

  it('falls back to the deterministic reply when the model output is invalid or the model is down', async () => {
    const { say } = await conversation();
    mode = 'broken';
    expect((await say('3 bedroom house on a 30 x 40 ft plot, 2 floors')).reply).toBeUndefined();
    mode = 'down';
    const state = await say('2 bathrooms');
    expect(state.reply).toBeUndefined();
    expect(state.status).toBe('AWAITING_APPROVAL');
  });
});

describe('parseReply', () => {
  const wrap = (content: string) => JSON.stringify({ choices: [{ message: { content } }] });
  it('accepts fenced JSON, strips control characters and bounds length', () => {
    expect(parseReply(wrap('```json\n{"reply":"Hi\\u0007 there","generalQuestion":false}\n```'), 'p', 'm')?.text).toBe('Hi there');
    expect(parseReply(wrap(JSON.stringify({ reply: 'x'.repeat(2001) })), 'p', 'm')).toBeNull();
    expect(parseReply(wrap('{"answer":"no reply field"}'), 'p', 'm')).toBeNull();
    expect(parseReply('<html>', 'p', 'm')).toBeNull();
  });
});
