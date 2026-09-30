/** Local-only diagnostic: observes unchanged API/Auth/PostgREST requests; no retries. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { buildApp } from '../apps/api/src/app.js';
import { parseEnv } from '../apps/api/src/config/env.js';
import { fixturePlan, fixtureEstimate } from '../test-support/fixtures.js';

const idleMs = Number(process.env.INVESTIGATION_IDLE_MS ?? 0);
if (!Number.isInteger(idleMs) || idleMs < 0 || idleMs > 60_000) throw new Error('Idle must be 0–60000 ms');
const rounds = Number(process.env.INVESTIGATION_ROUNDS ?? 20);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100) throw new Error('Rounds must be 1–100');
const localStatus = spawnSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' });
if (localStatus.status !== 0) throw new Error('Local Supabase status unavailable');
const local = JSON.parse(localStatus.stdout) as Record<string, string>;
for (const key of ['API_URL', 'DB_URL']) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(local[key]!).hostname)) throw new Error('Remote stack refused');
}
const db = new pg.Client({ connectionString: local.DB_URL, application_name: 'supabase-500-investigation' });
await db.connect();
const secret = (await db.query('select secret from project_private.commit_key where singleton')).rows[0]?.secret as string;
const env = parseEnv({ ...process.env, NODE_ENV: 'test', SUPABASE_URL: local.API_URL,
  SUPABASE_ANON_KEY: local.ANON_KEY, PROJECT_COMMIT_SECRET: secret, RATE_LIMIT_ENABLED: 'false', LOG_LEVEL: 'silent', SENTRY_DSN: '' });
const principal = createClient(env.SUPABASE_URL, local.ANON_KEY!, { db: { retry: false }, auth: { autoRefreshToken: false, persistSession: false } });
const admin = createClient(env.SUPABASE_URL, local.SERVICE_ROLE_KEY!, { db: { retry: false }, auth: { autoRefreshToken: false, persistSession: false } });
if (idleMs > 0) {
  const prime = await principal.from('rate_table_versions').select('id').limit(1);
  if (prime.error) throw new Error('Could not prime local validator time');
  console.log(JSON.stringify({ phase: 'controlled-idle-before-new-token', idleMs }));
  await new Promise(resolve => setTimeout(resolve, idleMs));
}
let auth = await principal.auth.signInAnonymously();
if (auth.error || !auth.data.user || !auth.data.session) throw new Error('Local anonymous authentication failed');
const userId = auth.data.user.id;
const userIds = [userId];
const tokenTimings: Record<string, unknown>[] = [];
const privateValues = new Set([secret, local.ANON_KEY!, local.SERVICE_ROLE_KEY!, auth.data.session.access_token, auth.data.session.refresh_token]);
function clean(value: unknown): unknown {
  let text = JSON.stringify(value);
  for (const privateValue of privateValues) if (privateValue) text = text.replaceAll(privateValue, '[REDACTED]');
  return JSON.parse(text.replace(/eyJ[A-Za-z0-9._-]+/g, '[REDACTED_JWT]')) as unknown;
}
const context = new AsyncLocalStorage<{ sequence: string }>();
const started = performance.now();
const events: Record<string, unknown>[] = [];
const snapshots: Record<string, unknown>[] = [];
const originalFetch = globalThis.fetch;
let fetchSequence = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const id = ++fetchSequence;
  const atMs = Number((performance.now() - started).toFixed(3));
  const record: Record<string, unknown> = { id, sequence: context.getStore()?.sequence, atMs, utc: new Date().toISOString(), localTime: new Date().toString(), path: url.pathname, method: init?.method ?? 'GET' };
  if (url.pathname.endsWith('/rpc/commit_idempotent_creation') && typeof init?.body === 'string') {
    const body = JSON.parse(init.body) as { p_operation: string; p_key_hash: string; p_fingerprint: string; p_row?: { share_token?: string } };
    record.operation = body.p_operation; record.keyHash = body.p_key_hash; record.fingerprint = body.p_fingerprint;
    if (body.p_row?.share_token) privateValues.add(body.p_row.share_token);
  }
  events.push(record);
  try {
    const response = await originalFetch(input, init);
    record.status = response.status; record.finishedMs = Number((performance.now() - started).toFixed(3));
    record.requestId = response.headers.get('sb-request-id') ?? response.headers.get('x-request-id');
    record.serverDate = response.headers.get('date'); record.proxyStatus = response.headers.get('proxy-status');
    record.proxyLatencyMs = response.headers.get('x-kong-proxy-latency');
    record.upstreamLatencyMs = response.headers.get('x-kong-upstream-latency');
    if (!response.ok) { record.errorBody = clean(await response.clone().text()); }
    return response;
  } catch (error) {
    record.finishedMs = Number((performance.now() - started).toFixed(3));
    record.transportError = clean(error instanceof Error ? { name: error.name, message: error.message, cause: error.cause } : String(error));
    throw error;
  }
};
let app: ReturnType<typeof buildApp> | undefined;
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    const result = await db.query(`select a.pid,a.backend_start,a.xact_start,a.query_start,a.state,a.wait_event_type,a.wait_event,
      pg_blocking_pids(a.pid) blocking_pids,
      (select coalesce(jsonb_agg(jsonb_build_object('mode',l.mode,'granted',l.granted,'classid',l.classid::text,'objid',l.objid::text)), '[]')
       from pg_locks l where l.pid=a.pid and l.locktype='advisory') advisory_locks
      from pg_stat_activity a where a.datname=current_database() and a.usename='authenticator' order by a.pid`);
    snapshots.push({ atMs: Number((performance.now() - started).toFixed(3)), connections: result.rows });
    await new Promise(resolve => setTimeout(resolve, 20));
  }
})();
const apiResponses: Record<string, unknown>[] = [];
const cleanupFailures: string[] = [];
let failures = 0;
try {
  for (let round = 0; round < rounds; round++) {
    if (round > 0 && process.env.INVESTIGATION_FRESH_AUTH === 'true') {
      const fresh = createClient(env.SUPABASE_URL, local.ANON_KEY!, { db: { retry: false }, auth: { autoRefreshToken: false, persistSession: false } });
      auth = await fresh.auth.signInAnonymously();
      if (auth.error || !auth.data.user || !auth.data.session) throw new Error('Fresh anonymous authentication failed');
      userIds.push(auth.data.user.id);
      privateValues.add(auth.data.session.access_token); privateValues.add(auth.data.session.refresh_token);
    }
    const claims = JSON.parse(Buffer.from(auth.data.session!.access_token.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;
    tokenTimings.push({ round, receivedAt: new Date().toISOString(), iat: claims.iat, nbf: claims.nbf, exp: claims.exp,
      identityClass: 'authenticated anonymous user', databaseTime: (await db.query('select clock_timestamp() at')).rows[0].at });
    app = buildApp({ env, captureError: (error, requestId, code) => { events.push({ kind: 'api-error', requestId, code, error: clean(String(error)) }); } });
    await app.ready();
    for (const [operation, payload, expectedStatus] of [
      ['/api/plans', { plan: fixturePlan() }, 201],
      ['/api/plans/generate', { prompt: '2BHK with open kitchen', seed: 'phase8-live' }, 201],
      ['/api/estimates', fixtureEstimate(), 200],
    ] as const) {
      const key = `investigation-${round}-${operation.replaceAll('/', '-')}`;
      const keyHash = createHash('sha256').update(key).digest('hex');
      const responses = await Promise.all(Array.from({ length: 4 }, (_, index) => context.run({ sequence: `${round}:${operation}:${index}` }, async () => {
        const response = await app!.inject({ method: 'POST', url: operation, payload,
          headers: { authorization: `Bearer ${auth.data.session!.access_token}`, 'idempotency-key': key } });
        const body = response.json() as Record<string, unknown>;
        if (typeof body.shareToken === 'string') privateValues.add(body.shareToken);
        const ok = response.statusCode === expectedStatus;
        apiResponses.push({ sequence: context.getStore()?.sequence, operation, keyHash, requestId: response.headers['x-request-id'],
          status: response.statusCode, atMs: Number((performance.now() - started).toFixed(3)), ...(ok ? {} : { body: clean(body) }) });
        if (!ok) failures++;
        return response;
      })));
      if (responses.every(response => response.statusCode === expectedStatus) && new Set(responses.map(response => response.body)).size !== 1) {
        failures++; events.push({ kind: 'response-mismatch', round, operation });
      }
    }
    await app.close(); app = undefined;
    if (failures) break;
  }
} finally {
  sampling = false; await sampler;
  await app?.close();
  const stored = (await db.query('select operation,key_hash,count(*) from public.idempotency_records where user_id=any($1::uuid[]) group by operation,key_hash order by operation,key_hash', [userIds])).rows;
  const artifactCounts = (await db.query(`select
    (select count(*) from public.plans where user_id=any($1::uuid[])) plans,
    (select count(*) from public.cost_estimates where user_id=any($1::uuid[])) estimates,
    (select count(*) from public.generation_logs g join public.plans p on p.id=g.plan_id where p.user_id=any($1::uuid[])) audits`, [userIds])).rows[0];
  const environment = (await db.query(`select version() postgres_version,
    current_setting('default_transaction_isolation') default_isolation,
    (select count(*) from pg_stat_activity where usename='authenticator') postgrest_connections`)).rows[0];
  globalThis.fetch = originalFetch;
  for (const table of ['cost_estimates', 'plans']) {
    const result = await admin.from(table).delete().in('user_id', userIds); if (result.error) cleanupFailures.push(table);
  }
  for (const id of userIds) { const deleted = await admin.auth.admin.deleteUser(id); if (deleted.error) cleanupFailures.push('test identity'); }
  await db.end();
  const evidence = clean({ timestamp: new Date().toISOString(), userIds, tokenTimings, cleanupFailures, roundsRequested: rounds, failures, environment, artifactCounts, apiResponses, events, snapshots, stored });
  const output = process.env.INVESTIGATION_OUTPUT ?? '/tmp/supabase-500-investigation.json';
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ output, requests: apiResponses.length, failures, errorEvents: events.filter(event => typeof event.status === 'number' && event.status >= 400), environment }));
}
if (failures || cleanupFailures.length > 0) process.exitCode = 1;
