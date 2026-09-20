import { parseEnv } from './config/env.js';
import { initializeSentry, flushSentry } from './lib/sentry.js';
import { createShutdown } from './lib/lifecycle.js';

// Signal handlers belong only to this executable, never app construction.
let cleanup: (() => Promise<void>) | undefined;
try {
  const env = parseEnv();
  initializeSentry(env);
  const { buildApp } = await import('./app.js');
  const app = buildApp({ env });
  const shutdown = createShutdown(() => app.close(), flushSentry, () => {
    app.log.error({ code: 'SHUTDOWN_FAILED' }, 'API shutdown cleanup failed');
    process.exitCode = 1;
  });
  cleanup = shutdown;
  const signal = () => { void shutdown(); };
  process.on('SIGTERM', signal);
  process.on('SIGINT', signal);
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  process.stderr.write(error instanceof Error && error.message.startsWith('Invalid environment configuration:')
    ? `${error.message}\n` : 'DesignFlow API failed to start. Check configuration and port availability.\n');
  process.exitCode = 1;
  await cleanup?.();
}
