import process from 'node:process';
import { URL } from 'node:url';
import console from 'node:console';
// Local acceptance bootstrap only. Administrative access obtains the API QA
// attestation key; all test behavior still runs through caller Auth/JWT/RLS.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import pg from 'pg';

try {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const assertLocal = value => {
    const url = new URL(value);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Non-local acceptance configuration refused');
  };
  if (process.env.SUPABASE_URL) assertLocal(process.env.SUPABASE_URL);
  const status = spawnSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' });
  if (status.status !== 0) throw new Error('Local Supabase status unavailable; start the local stack');
  const local = JSON.parse(status.stdout);
  assertLocal(local.API_URL); assertLocal(local.DB_URL);
  if (process.env.SUPABASE_URL && new URL(process.env.SUPABASE_URL).origin !== new URL(local.API_URL).origin) {
    throw new Error('Acceptance URL must match this repository local Supabase stack');
  }
  const client = new pg.Client({ connectionString: local.DB_URL });
  let secret;
  try {
    await client.connect();
    secret = (await client.query('select secret from project_private.commit_key where singleton')).rows[0]?.secret;
  } finally { await client.end(); }
  if (!/^[a-f0-9]{64}$/.test(secret ?? '')) throw new Error('Apply Phase 12 migration before acceptance');
  const result = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.supabase.config.ts'], {
    stdio: 'inherit', env: { ...process.env, SUPABASE_URL: local.API_URL, SUPABASE_ANON_KEY: local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, PROJECT_COMMIT_SECRET: secret, SENTRY_DSN: '' },
  });
  process.exitCode = result.status ?? 1;
} catch {
  // Never echo database credentials, status JSON or signing material.
  console.error('Local Supabase acceptance setup failed. Start the repository local stack and apply migrations; remote URLs are refused.');
  process.exitCode = 1;
}
