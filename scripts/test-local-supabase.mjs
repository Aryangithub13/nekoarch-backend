import process from 'node:process';
import { execFileSync, spawnSync } from 'node:child_process';
// Capture local CLI secrets in memory only; never print complete status or env.
try {
  const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const result = spawnSync('npm', ['run', 'test:supabase'], { stdio: 'inherit', env: {
    ...process.env, SUPABASE_URL: status.API_URL, SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, SENTRY_DSN: '',
  } });
  process.exitCode = result.status ?? 1;
} catch {
  process.stderr.write('Local Supabase status is unavailable; start the local stack first.\n');
  process.exitCode = 1;
}
