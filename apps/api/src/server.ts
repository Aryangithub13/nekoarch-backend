import { parseEnv } from './config/env.js';
import { initializeSentry, flushSentry } from './lib/sentry.js';

// Sentry initialization precedes loading the server graph.
try {
  const env = parseEnv();
  initializeSentry(env);
  const { buildApp } = await import('./app.js');
  const app = buildApp({ env });
  const shutdown = async () => { await app.close(); await flushSentry(); };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  // Only configuration errors are safe to show verbatim.
  process.stderr.write(error instanceof Error && error.message.startsWith('Invalid environment configuration:')
    ? `${error.message}\n` : 'DesignFlow API failed to start. Check configuration and port availability.\n');
  process.exitCode = 1;
}
