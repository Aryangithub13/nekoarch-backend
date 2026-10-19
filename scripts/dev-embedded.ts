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
import { parseEnv } from '../apps/api/src/config/env.js';
import { createPgBackend } from '../test-support/pg-backend.js';
import { createTestUser, startTestDatabase } from '../test-support/postgres.js';
import { requirements } from '../packages/blueprint-qa/tests/fixtures.js';
import { specification } from '../packages/construction-calculations/tests/fixtures.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT ?? 3001);
const origins = process.env.CORS_ORIGINS ?? ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://127.0.0.1:3200', 'http://127.0.0.1:3201'].join(',');
const out = process.env.DEV_SESSION_FILE ?? path.join(root, '.dev-embedded', 'session.json');

const db = await startTestDatabase();
const secret: string = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
const users = { owner: await createTestUser(db.pool), other: await createTestUser(db.pool) };
const tokens = { owner: randomBytes(24).toString('hex'), other: randomBytes(24).toString('hex') };
const app = buildApp({
  env: parseEnv({ NODE_ENV: 'development', SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'embedded-dev-unused', PROJECT_COMMIT_SECRET: secret,
    CORS_ORIGINS: origins, LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn', RATE_LIMIT_ENABLED: 'false', HOST: '127.0.0.1', PORT: String(port) }),
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
