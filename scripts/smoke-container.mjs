import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const name = `designflow-smoke-${randomUUID()}`;
const image = process.argv[2] ?? 'designflow-api:phase8';
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try {
  // No network and synthetic configuration: this cannot contact an external Sentry or Supabase project.
  docker(['run', '-d', '--network', 'none', '--name', name,
    '-e', 'SUPABASE_URL=http://127.0.0.1:9', '-e', 'SUPABASE_ANON_KEY=smoke-fixture',
    '-e', 'SENTRY_DSN=http://fixture@127.0.0.1:9/1', image]);
  docker(['exec', name, 'node', '--input-type=module', '-e', `
    import { setTimeout } from 'node:timers/promises';
    let live;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { live = await fetch('http://127.0.0.1:3001/health/live'); if (live.ok) break; } catch {}
      await setTimeout(100);
    }
    if (!live?.ok || (await live.json()).status !== 'ok') throw new Error('Liveness failed');
    const ready = await fetch('http://127.0.0.1:3001/health/ready');
    if (ready.status !== 503) throw new Error('Readiness did not detect unavailable dependency');
    if (process.getuid() === 0) throw new Error('Runtime is root');
  `]);
  docker(['kill', '--signal=SIGTERM', name]);
  const status = docker(['wait', name]);
  if (status !== '0') throw new Error('Unclean shutdown');
  process.stdout.write('Production container: non-root, liveness 200, failed-dependency readiness 503, SIGTERM exit 0.\n');
} catch {
  process.stderr.write('Production container smoke test failed.\n');
  process.exitCode = 1;
} finally {
  try { docker(['rm', '-f', name]); } catch { /* An unsuccessful create has nothing to remove. */ }
}
