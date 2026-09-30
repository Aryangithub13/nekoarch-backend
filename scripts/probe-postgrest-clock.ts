/** Disposable, local-only clock experiment; never changes the active REST container. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { buildApp } from '../apps/api/src/app.js';
import { parseEnv } from '../apps/api/src/config/env.js';
import { fixturePlan } from '../test-support/fixtures.js';

function command(program: string, args: string[], environment = process.env): string {
  const result = spawnSync(program, args, { encoding: 'utf8', env: environment, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${program} diagnostic command failed (${result.status}); command output withheld`);
  return result.stdout.trim();
}
const version = process.env.PROBE_POSTGREST_VERSION ?? '16.2';
const capabilities = process.env.PROBE_CAPABILITIES;
if (capabilities !== undefined && capabilities !== '8') throw new Error('Only an optional eight-capability stress configuration is permitted');
const concurrency = Number(process.env.PROBE_CONCURRENCY ?? 4);
if (!Number.isInteger(concurrency) || concurrency < 4 || concurrency > 64) throw new Error('Concurrency must be 4–64');
if (!['16.2', '16.3'].includes(version)) throw new Error('Only the affected and fixed versions are permitted');
const local = JSON.parse(command('npx', ['supabase', 'status', '-o', 'json'])) as Record<string, string>;
for (const key of ['API_URL', 'DB_URL']) if (!['127.0.0.1', 'localhost'].includes(new URL(local[key]!).hostname)) throw new Error('Remote stack refused');
const live = JSON.parse(command('docker', ['inspect', 'supabase_rest_designflow']))[0] as {
  Config: { Env: string[] }; NetworkSettings: { Networks: Record<string, unknown> };
};
const replicaEnv: Record<string, string | undefined> = { ...process.env };
const environmentArgs: string[] = [];
for (const entry of live.Config.Env.filter(value => value.startsWith('PGRST_'))) {
  const index = entry.indexOf('='); const key = entry.slice(0, index); replicaEnv[key] = entry.slice(index + 1); environmentArgs.push('-e', key);
}
const name = `designflow-clock-probe-${process.pid}`;
const network = Object.keys(live.NetworkSettings.Networks)[0]!;
const db = new pg.Client({ connectionString: local.DB_URL, application_name: 'postgrest-clock-probe' });
await db.connect();
const secret = (await db.query('select secret from project_private.commit_key where singleton')).rows[0]?.secret as string;
const env = parseEnv({ ...process.env, NODE_ENV: 'test', SUPABASE_URL: local.API_URL, SUPABASE_ANON_KEY: local.ANON_KEY,
  PROJECT_COMMIT_SECRET: secret, RATE_LIMIT_ENABLED: 'false', LOG_LEVEL: 'silent', SENTRY_DSN: '' });
const options = { db: { retry: false }, auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, options);
const authClient = createClient(local.API_URL!, local.ANON_KEY!, options);
const trace: Record<string, unknown>[] = [];
const apiResponses: Record<string, unknown>[] = [];
const privateValues = new Set([secret, ...Object.values(local)]);
const originalFetch = globalThis.fetch;
let userId: string | undefined;
let app: ReturnType<typeof buildApp> | undefined;
let created = false; let paused = false;
const cleanupFailures: string[] = [];
const clock = new AsyncLocalStorage<number>();
function clean(value: unknown): unknown {
  let encoded = JSON.stringify(value);
  for (const text of privateValues) if (text) encoded = encoded.replaceAll(text, '[REDACTED]');
  return JSON.parse(encoded.replace(/eyJ[A-Za-z0-9._-]+/g, '[REDACTED_JWT]')) as unknown;
}
try {
  command('docker', ['run', '--rm', '-d', '--name', name, '--network', network, '-p', '127.0.0.1::3000',
    ...environmentArgs, `public.ecr.aws/supabase/postgrest:v${version}`, ...(capabilities ? ['/bin/postgrest', '+RTS', '-N8', '-RTS'] : [])], replicaEnv); created = true;
  const port = command('docker', ['port', name, '3000/tcp']).split(':').at(-1)!;
  const restUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { ready = (await originalFetch(`${restUrl}/rate_table_versions?select=id&limit=1`, {
      headers: { authorization: `Bearer ${local.ANON_KEY}` }, signal: AbortSignal.timeout(1000) })).ok; } catch { /* bounded readiness only */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Disposable replica never became ready');
  trace.push({ kind: 'clock-primed', at: new Date().toISOString(), version });
  command('docker', ['pause', name]); paused = true;
  trace.push({ kind: 'replica-paused', at: new Date().toISOString() });
  console.log(JSON.stringify({ phase: 'replica-only-pause', version, durationMs: 40000 }));
  await new Promise(resolve => setTimeout(resolve, 40000));
  const auth = await authClient.auth.signInAnonymously();
  if (auth.data.user) userId = auth.data.user.id;
  if (auth.error || !auth.data.user || !auth.data.session) throw new Error('Fresh local authentication failed');
  privateValues.add(auth.data.session.access_token); privateValues.add(auth.data.session.refresh_token);
  const claims = JSON.parse(Buffer.from(auth.data.session.access_token.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;
  trace.push({ kind: 'fresh-token', at: new Date().toISOString(), iat: claims.iat, nbf: claims.nbf, exp: claims.exp });
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const target = url.origin === new URL(local.API_URL!).origin && url.pathname.startsWith('/rest/v1/')
      ? `${restUrl}${url.pathname.slice('/rest/v1'.length)}${url.search}` : input;
    const record: Record<string, unknown> = { kind: 'request', sequence: clock.getStore(), path: url.pathname,
      startedAt: new Date().toISOString(), operation: url.searchParams.get('operation'), keyHash: url.searchParams.get('key_hash') };
    const started = performance.now(); trace.push(record);
    if (typeof init?.body === 'string' && url.pathname.endsWith('commit_idempotent_creation')) {
      const args = JSON.parse(init.body) as { p_row?: { share_token?: string } };
      if (args.p_row?.share_token) privateValues.add(args.p_row.share_token);
    }
    const response = await originalFetch(target, init);
    record.status = response.status; record.durationMs = performance.now() - started;
    record.requestId = response.headers.get('x-request-id');
    record.proxyStatus = response.headers.get('proxy-status');
    if (!response.ok) record.body = clean(await response.clone().text());
    return response;
  };
  app = buildApp({ env, captureError: (_error, requestId, code) => { trace.push({ kind: 'api-error', requestId, code }); } });
  await app.ready();
  const key = `clock-probe-${process.pid}`;
  const pending = Promise.all(Array.from({ length: concurrency }, (_, index) => clock.run(index, async () => {
    const response = await app!.inject({ method: 'POST', url: '/api/plans', payload: { plan: fixturePlan() },
      headers: { authorization: `Bearer ${auth.data.session!.access_token}`, 'idempotency-key': key } });
    const body = response.json() as Record<string, unknown>;
    if (typeof body.shareToken === 'string') privateValues.add(body.shareToken);
    apiResponses.push({ sequence: index, status: response.statusCode, requestId: response.headers['x-request-id'],
      operation: '/api/plans', keyHash: createHash('sha256').update(key).digest('hex'),
      ...(response.statusCode === 201 ? {} : { body }) });
  })));
  const queueDeadline = performance.now() + 3000;
  while (trace.filter(r => r.path === '/rest/v1/idempotency_records').length < concurrency && performance.now() < queueDeadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  trace.push({ kind: 'requests-queued', count: trace.filter(r => r.path === '/rest/v1/idempotency_records').length, at: new Date().toISOString() });
  command('docker', ['unpause', name]); paused = false;
  trace.push({ kind: 'replica-resumed', at: new Date().toISOString() });
  await pending;
  trace.push({ kind: 'stored-counts', ...(await db.query(`select
    (select count(*) from public.plans where user_id=$1) plans,
    (select count(*) from public.idempotency_records where user_id=$1) receipts`, [userId])).rows[0] });
} finally {
  globalThis.fetch = originalFetch;
  await app?.close();
  if (paused) { try { command('docker', ['unpause', name]); } catch { cleanupFailures.push('unpause'); } }
  if (created) { try { command('docker', ['rm', '-f', name]); } catch { cleanupFailures.push('replica'); } }
  if (userId) {
    const deleted = await admin.from('plans').delete().eq('user_id', userId); if (deleted.error) cleanupFailures.push('plans');
    const user = await admin.auth.admin.deleteUser(userId); if (user.error) cleanupFailures.push('identity');
  }
  await db.end();
  const output = process.env.PROBE_OUTPUT ?? `/tmp/postgrest-clock-${version}.json`;
  await writeFile(output, JSON.stringify(clean({ version, concurrency, capabilities: capabilities ?? 'image-default', trace, apiResponses, cleanupFailures }), null, 2) + '\n');
  console.log(JSON.stringify({ output, statuses: apiResponses.map(r => r.status), errors: trace.filter(r => typeof r.status === 'number' && r.status >= 400), cleanupFailures }));
}
if (cleanupFailures.length) process.exitCode = 1;
// The fixed-version comparison is also the infrastructure regression gate.
if (version === '16.3' && (apiResponses.length !== concurrency || apiResponses.some(r => r.status !== 201))) process.exitCode = 1;
