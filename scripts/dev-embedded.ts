/**
 * Local development runtime for frontend integration (F55). No Docker, no hosted Supabase.
 *
 * The real Fastify application (`buildApp`) runs against embedded PostgreSQL with every migration and the seed applied, through the
 * test-only `createPgBackend` transport: every query still runs under the real RLS roles. It is NOT a Supabase Auth emulator: two local
 * users get random opaque bearer tokens for this process only, written to a git-ignored JSON file for the local frontend. The database
 * is temporary and is deleted on exit. Never point a frontend at this outside localhost and never use it as evidence of hosted Supabase.
 *
 * Seed (through the HTTP API itself, never by direct writes): one project with a generated revision R1 and, when the engines accept the
 * fixtures, a quantity takeoff, a construction calculation and a cost estimate on the synthetic `sample-inr-v1` rate book.
 *
 *   npm run build && node --import tsx scripts/dev-embedded.ts
 */
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleCostingPolicy } from '@designflow/boq-cost';
import { buildApp } from '../apps/api/src/app.js';
import { embeddedEnv } from './dev-embedded-env.js';
import { createPgBackend } from '../test-support/pg-backend.js';
import { createTestUser, startTestDatabase } from '../test-support/postgres.js';
import { requirements } from '../packages/blueprint-qa/tests/fixtures.js';
import { specification } from '../packages/construction-calculations/tests/fixtures.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT ?? 3001);
// Local frontends: dev server (3000), Playwright (3200/3201) and a local production build (3300), by name or loopback IP.
const origins = process.env.CORS_ORIGINS ?? [3000, 3200, 3201, 3300].flatMap(port => [`http://localhost:${port}`, `http://127.0.0.1:${port}`]).join(',');
const out = process.env.DEV_SESSION_FILE ?? path.join(root, '.dev-embedded', 'session.json');

// Optional AI: AI_PROVIDER_GEMINI_API_KEY (and optionally AI_GEMINI_MODEL) from the environment or the git-ignored
// .env.ai.local file. With a key, Google Gemini (OpenAI-compatible endpoint) extracts intent and words replies;
// without one the deterministic parser and templates are used. The key never leaves this server process.
const aiFile = path.join(root, '.env.ai.local');
try { process.loadEnvFile(aiFile); } catch { /* no local AI configuration */ }
const geminiKey = process.env.AI_PROVIDER_GEMINI_API_KEY;
// gemini-3.5-flash-lite answers in about 2 s and its free tier is not limited to 5 requests/min like gemini-3.5-flash (measured 20 Oct 2026).
const geminiModel = process.env.AI_GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
if (geminiKey && !process.env.AI_ROUTING_CONFIG)
  process.env.AI_ROUTING_CONFIG = JSON.stringify({
    privacyClass: 'REMOTE_ALLOWED', allowMetered: true, deterministicFallback: true, timeoutMs: 15000,
    allowedRemoteHosts: ['generativelanguage.googleapis.com'],
    providers: [{
      providerId: 'gemini', type: 'REMOTE_OPENAI_COMPATIBLE', enabled: true, timeoutMs: 10000,
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      apiKeyEnv: 'AI_PROVIDER_GEMINI_API_KEY',
      capabilities: ['ARCHITECTURAL_INTENT_EXTRACTION', 'LANGUAGE_INTERPRETATION', 'EXPLANATION'],
      models: [{ modelId: geminiModel, capabilities: ['ARCHITECTURAL_INTENT_EXTRACTION', 'LANGUAGE_INTERPRETATION', 'EXPLANATION'], privacyClass: 'REMOTE_ALLOWED', costClass: 'METERED', maxOutputTokens: 2048, reasoningEffort: 'low' }],
    }],
  });

const db = await startTestDatabase();
const secret: string = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
const users = { owner: await createTestUser(db.pool), other: await createTestUser(db.pool) };
// Optional stable local tokens (DEV_OWNER_TOKEN / DEV_OTHER_TOKEN, 16-128 URL-safe characters) so a restart keeps the same sign-in.
const devToken = (value: string | undefined) => value && /^[A-Za-z0-9._-]{16,128}$/.test(value) ? value : randomBytes(24).toString('hex');
const tokens = { owner: devToken(process.env.DEV_OWNER_TOKEN), other: devToken(process.env.DEV_OTHER_TOKEN) };
if (tokens.owner === tokens.other) throw new Error('DEV_OWNER_TOKEN and DEV_OTHER_TOKEN must differ');
const app = buildApp({
  env: embeddedEnv(process.env, { secret, origins, port }),
  backend: createPgBackend(db.pool, { [tokens.owner]: users.owner, [tokens.other]: users.other }),
});

const owner = { authorization: `Bearer ${tokens.owner}` };
const seedLog: { step: string; status: number; code?: string }[] = [];
async function call(step: string, method: 'GET' | 'POST', url: string, payload?: unknown) {
  const response = await app.inject({ method, url, headers: owner, ...(payload === undefined ? {} : { payload: payload as object }) });
  const body = response.body ? response.json() : null;
  seedLog.push({ step, status: response.statusCode, ...(body?.error?.code ? { code: body.error.code } : {}) });
  return { status: response.statusCode, body };
}
const project = await call('create project', 'POST', '/api/projects', { title: 'F55 Integration Residence' });
const projectId: string = project.body.id;
const r1 = await call('generate R1', 'POST', `/api/projects/${projectId}/revisions/generate`, { requirements: requirements(1, 'f55'), baseRevisionId: null });
const revisionId: string | null = r1.body?.revision?.id ?? null;
const artifacts: Record<string, string | null> = { takeoff: null, construction: null, cost: null };
if (revisionId) {
  const base = `/api/projects/${projectId}/revisions/${revisionId}`;
  const takeoff = await call('takeoff', 'POST', `${base}/takeoffs`, {});
  artifacts.takeoff = takeoff.status === 201 ? takeoff.body.id : null;
  if (artifacts.takeoff) {
    const construction = await call('construction calculation', 'POST', `${base}/takeoffs/${artifacts.takeoff}/construction-calculations`, { specification: specification() });
    artifacts.construction = construction.status === 201 ? construction.body.id : null;
    if (artifacts.construction) {
      const cost = await call('cost estimate', 'POST', `${base}/takeoffs/${artifacts.takeoff}/construction-calculations/${artifacts.construction}/cost-estimates`,
        { rateBookId: 'sample-inr-v1', costingPolicy: sampleCostingPolicy() });
      artifacts.cost = cost.status === 201 ? cost.body.id : null;
    }
  }
}

await app.listen({ host: '127.0.0.1', port });
const session = {
  kind: 'designflow-embedded-dev', warning: 'Local development only. Opaque tokens valid for this process; temporary database deleted on exit.',
  apiUrl: `http://127.0.0.1:${port}`, startedAt: new Date().toISOString(), pid: process.pid,
  users: { owner: { id: users.owner, token: tokens.owner }, other: { id: users.other, token: tokens.other } },
  seed: { projectId, revisionId, artifacts, log: seedLog },
};
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`AI: ${process.env.AI_ROUTING_CONFIG ? (geminiKey ? `Google Gemini (${geminiModel})` : 'configured routing') : 'deterministic parser (no AI key)'}
`);
process.stdout.write(`designflow embedded dev backend on ${session.apiUrl} (session file: ${out})\n${JSON.stringify(seedLog)}\n`);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  // An idle pool client can be terminated by the server while the database stops. Without a listener, node-postgres re-throws that
  // 'error' event and the process exits 1 with a stack trace instead of shutting down cleanly.
  db.pool.on('error', () => undefined);
  await app.close();
  await db.stop().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
