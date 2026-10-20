import { parseEnv, type Env } from '../apps/api/src/config/env.js';

const AI_SETTINGS = new Set([
  'AI_ROUTING_CONFIG',
  'AI_CONVERSATION_MODE', 'AI_CONVERSATION_ENDPOINT', 'AI_CONVERSATION_MODEL', 'AI_CONVERSATION_API_KEY',
  'AI_INTERPRETER_MODE', 'AI_INTERPRETER_TIMEOUT_MS', 'AI_INTERPRETER_MAX_OUTPUT_TOKENS',
]);

/** Inherit explicit AI settings while keeping the disposable runtime's database, authentication and network configuration local. */
export function embeddedEnv(source: Record<string, string | undefined>, local: { secret: string; origins: string; port: number }): Env {
  const ai = Object.fromEntries(Object.entries(source).filter(([name]) =>
    AI_SETTINGS.has(name) || /^AI_PROVIDER_[A-Z0-9_]+_API_KEY$/.test(name)));
  return parseEnv({
    ...ai,
    NODE_ENV: 'development', SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'embedded-dev-unused', PROJECT_COMMIT_SECRET: local.secret,
    CORS_ORIGINS: local.origins, LOG_LEVEL: source.LOG_LEVEL ?? 'warn', RATE_LIMIT_ENABLED: 'false', HOST: '127.0.0.1', PORT: String(local.port),
  });
}
