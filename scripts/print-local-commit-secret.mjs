// Local stack only (audit B INT-B-015): print the PROJECT_COMMIT_SECRET line for .env after `npm run db:reset`, which
// regenerates project_private.commit_key. A stale secret makes /health/ready 503 and every signed write 503.
//
//   npm run db:secret            # prints PROJECT_COMMIT_SECRET=<64 hex> for this repository's local stack
//
// Like test-local-supabase.mjs it refuses any non-local URL, and it never prints connection details or driver errors.
import process from 'node:process';
import console from 'node:console';
import { spawnSync } from 'node:child_process';
import { URL, pathToFileURL } from 'node:url';
import pg from 'pg';

/** Only a loopback host is accepted: the key of a shared or hosted database must come from its secret manager. */
export function assertLocal(value) {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Non-local database refused');
  return value;
}

/** Reads the commit key over a local connection; `status` is `supabase status -o json` (injectable for tests). */
export async function readLocalCommitSecret(status) {
  const client = new pg.Client({ connectionString: assertLocal(status.DB_URL), connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const secret = (await client.query('select secret from project_private.commit_key where singleton')).rows[0]?.secret;
    if (!/^[a-f0-9]{64}$/.test(secret ?? '')) throw new Error('No commit key: apply the migrations first');
    return secret;
  } finally { await client.end().catch(() => {}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const status = spawnSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' });
    if (status.status !== 0) throw new Error('Local Supabase status unavailable');
    console.log(`PROJECT_COMMIT_SECRET=${await readLocalCommitSecret(JSON.parse(status.stdout))}`);
  } catch {
    console.error('Could not read the local commit key. Start the repository local stack (npm run db:start) and apply migrations (npm run db:reset); remote databases are refused.');
    process.exitCode = 1;
  }
}
