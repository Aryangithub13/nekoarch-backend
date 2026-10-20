import { describe, expect, it } from 'vitest';
import { embeddedEnv } from '../../../scripts/dev-embedded-env.js';

const local = { secret: 'a'.repeat(64), origins: 'http://localhost:3000', port: 3001 };

describe('embedded integration runtime AI configuration', () => {
  it('keeps deterministic fallback when no AI provider is configured', () => {
    const env = embeddedEnv({}, local);
    expect(env.AI_CONVERSATION_MODE).toBe('fallback');
    expect(env.AI_ROUTING_CONFIG.providers).toEqual([]);
    expect(env.AI_PROVIDER_CREDENTIALS).toEqual({});
  });

  it('passes explicitly configured local inference settings through the real environment validator', () => {
    const env = embeddedEnv({ AI_CONVERSATION_MODE: 'local', AI_CONVERSATION_ENDPOINT: 'http://127.0.0.1:11434/v1/chat/completions',
      AI_CONVERSATION_MODEL: 'test-model', AI_CONVERSATION_API_KEY: 'synthetic-local-key', AI_INTERPRETER_MODE: 'disabled',
      AI_INTERPRETER_TIMEOUT_MS: '7000', AI_INTERPRETER_MAX_OUTPUT_TOKENS: '1024' }, local);
    expect(env).toMatchObject({ AI_CONVERSATION_MODE: 'local', AI_CONVERSATION_ENDPOINT: 'http://127.0.0.1:11434/v1/chat/completions',
      AI_CONVERSATION_MODEL: 'test-model', AI_CONVERSATION_API_KEY: 'synthetic-local-key', AI_INTERPRETER_MODE: 'disabled',
      AI_INTERPRETER_TIMEOUT_MS: 7000, AI_INTERPRETER_MAX_OUTPUT_TOKENS: 1024 });
  });

  it('preserves routing policy and only exposes credentials selected by enabled providers', () => {
    const policy = { privacyClass: 'REMOTE_ALLOWED', allowMetered: true, allowedRemoteHosts: ['provider.example'], providers: [
      { providerId: 'configured', type: 'REMOTE_OPENAI_COMPATIBLE', enabled: true, endpoint: 'https://provider.example/v1/chat/completions',
        apiKeyEnv: 'AI_PROVIDER_TEST_API_KEY', capabilities: ['ARCHITECTURAL_INTENT_EXTRACTION'],
        models: [{ modelId: 'test-model', capabilities: ['ARCHITECTURAL_INTENT_EXTRACTION'], privacyClass: 'REMOTE_ALLOWED', costClass: 'METERED' }] },
    ] };
    const env = embeddedEnv({ AI_ROUTING_CONFIG: JSON.stringify(policy), AI_PROVIDER_TEST_API_KEY: 'synthetic-selected-key',
      AI_PROVIDER_UNUSED_API_KEY: 'synthetic-unused-key' }, local);
    expect(env.AI_ROUTING_CONFIG).toMatchObject(policy);
    expect(env.AI_PROVIDER_CREDENTIALS).toEqual({ AI_PROVIDER_TEST_API_KEY: 'synthetic-selected-key' });
  });

  it('cannot inherit hosted database, auth, proxy, telemetry or remote compute settings', () => {
    const env = embeddedEnv({ NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '8080', SUPABASE_URL: 'https://hosted.example',
      SUPABASE_ANON_KEY: 'synthetic-hosted-key', PROJECT_COMMIT_SECRET: 'b'.repeat(64), RATE_LIMIT_ENABLED: 'true',
      TRUST_PROXY: '0.0.0.0/0', SENTRY_DSN: 'https://example.com', CORS_ORIGINS: 'https://external.example', COMPUTE_POLICY: 'invalid',
      AI_CONVERSATION_MODE: 'disabled' }, local);
    expect(env).toMatchObject({ NODE_ENV: 'development', HOST: '127.0.0.1', PORT: local.port, SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: 'embedded-dev-unused', PROJECT_COMMIT_SECRET: local.secret, RATE_LIMIT_ENABLED: false, TRUST_PROXY: '',
      CORS_ORIGINS: local.origins, AI_CONVERSATION_MODE: 'disabled' });
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('rejects invalid explicit AI configuration instead of silently downgrading it to fallback', () => {
    expect(() => embeddedEnv({ AI_CONVERSATION_MODE: 'local' }, local)).toThrow('Local inference requires an endpoint and model');
    expect(() => embeddedEnv({ AI_ROUTING_CONFIG: '{invalid' }, local)).toThrow('Invalid AI routing configuration');
    expect(() => embeddedEnv({ AI_CONVERSATION_MODE: 'invalid' }, local)).toThrow('Unsupported value');
  });
});
