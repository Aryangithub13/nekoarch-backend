import { isIP } from 'node:net';
import { z } from 'zod';
import { AiPolicySchema } from '../contracts/ai-orchestration.js';
import { ComputePolicySchema } from '../compute/contracts.js';

const positive = (value: number) => optionalDefault(z.coerce.number().int().min(1).max(2_147_483_647).default(value));
const flag = (value: 'true' | 'false') => optionalDefault(z.enum(['true', 'false']).default(value)).transform(value => value === 'true');
const blankToUndefined = (value: unknown) => value === '' ? undefined : value;
const optionalDefault = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blankToUndefined, schema);
export const EnvSchema = z.object({
  NODE_ENV: optionalDefault(z.enum(['development', 'test', 'production']).default('development')),
  SUPABASE_URL: z.string().url().refine(value => /^https?:/.test(value), 'Must use HTTP or HTTPS'),
  SUPABASE_ANON_KEY: z.string().min(1),

  PROJECT_COMMIT_SECRET: optionalDefault(z.string().regex(/^[a-f0-9]{64}$/).optional()),
  SENTRY_DSN: optionalDefault(z.string().url().optional()),
  PORT: optionalDefault(z.coerce.number().int().min(1).max(65535).default(3001)),
  HOST: optionalDefault(z.string().min(1).default('127.0.0.1')),
  LOG_LEVEL: optionalDefault(z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')),
  CORS_ORIGINS: optionalDefault(z.string().default('')),
  TRUST_PROXY: optionalDefault(z.string().default('')),
  AI_ROUTING_CONFIG: optionalDefault(z.string().max(32768).default('')).transform((value, ctx) => {
    try { const parsed=AiPolicySchema.safeParse(value?JSON.parse(value):{}); if(parsed.success)return parsed.data; } catch { /* Reject without reflecting configuration or credentials. */ }
    ctx.addIssue({code:'custom',message:'Invalid AI routing configuration'}); return z.NEVER;
  }),
  // Phase 36: server-owned compute policy (JSON). Remote execution cannot be enabled in this release; an attempt fails startup (fail closed).
  COMPUTE_POLICY: optionalDefault(z.string().max(4096).default('')).transform((value, ctx) => {
    try { const parsed=ComputePolicySchema.safeParse(value?JSON.parse(value):{}); if(parsed.success)return parsed.data; } catch { /* Reject without reflecting configuration. */ }
    ctx.addIssue({code:'custom',message:'Invalid compute policy'}); return z.NEVER;
  }),
  AI_CONVERSATION_MODE: optionalDefault(z.enum(['fallback', 'local', 'disabled']).default('fallback')),
  AI_CONVERSATION_ENDPOINT: optionalDefault(z.string().optional()),
  AI_CONVERSATION_MODEL: optionalDefault(z.string().regex(/^[A-Za-z0-9._:/-]{1,100}$/).optional()),
  AI_CONVERSATION_API_KEY: optionalDefault(z.string().max(512).optional()),
  AI_INTERPRETER_MODE: optionalDefault(z.enum(['fallback', 'disabled']).default('fallback')),
  AI_INTERPRETER_TIMEOUT_MS: optionalDefault(z.coerce.number().int().min(1).max(30000).default(5000)),
  AI_INTERPRETER_MAX_OUTPUT_TOKENS: optionalDefault(z.coerce.number().int().min(128).max(4096).default(2048)),
  RATE_LIMIT_ENABLED: flag('true'),
  RATE_LIMIT_WINDOW_MS: positive(60_000),
  RATE_LIMIT_READ: positive(120),
  RATE_LIMIT_WRITE: positive(30),
  RATE_LIMIT_GENERATE: positive(10),
  RATE_LIMIT_IP: positive(300),
  BODY_LIMIT_BYTES: positive(1_048_576),
  SMALL_BODY_LIMIT_BYTES: positive(65_536),
  REQUEST_TIMEOUT_MS: positive(30_000),
  CONNECTION_TIMEOUT_MS: positive(10_000),
  KEEP_ALIVE_TIMEOUT_MS: positive(5_000),
  UPSTREAM_TIMEOUT_MS: positive(10_000),
  READINESS_TIMEOUT_MS: positive(2_000),
  HSTS_ENABLED: flag('false'),
  RELEASE: optionalDefault(z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).optional()),
}).superRefine((env, ctx) => {
  if (env.AI_CONVERSATION_MODE === 'local' && (!env.AI_CONVERSATION_ENDPOINT || !env.AI_CONVERSATION_MODEL)) ctx.addIssue({ code: 'custom', path: ['AI_CONVERSATION_MODE'], message: 'Local inference requires an endpoint and model' });
  if (env.NODE_ENV === 'production' && !env.SENTRY_DSN) ctx.addIssue({ code: 'custom', path: ['SENTRY_DSN'], message: 'Required in production' });
  for (const proxy of env.TRUST_PROXY.split(',').map(value => value.trim()).filter(Boolean)) {
    const [address, prefix, extra] = proxy.split('/');
    const family = isIP(address ?? '');
    if (!family || extra !== undefined || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)))) {
      ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: 'Use explicit comma-separated proxy IP addresses or CIDRs' });
    }
  }
  for (const origin of env.CORS_ORIGINS.split(',').map(value => value.trim()).filter(Boolean)) {
    try { if (!/^https?:/.test(origin) || new URL(origin).origin !== origin) throw new Error(); }
    catch { ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Use comma-separated exact URL origins' }); }
  }
});
export type Env = z.infer<typeof EnvSchema> & { AI_PROVIDER_CREDENTIALS: Record<string,string> };

export function parseEnv(source: Record<string, unknown> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    // Do not echo submitted values: a malformed URL/key may contain secrets.
    throw new Error(`Invalid environment configuration:\n${result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.code === 'invalid_enum_value' ? 'Unsupported value' : issue.message}`).join('\n')}`);
  }
  if (!result.data.CORS_ORIGINS && result.data.NODE_ENV !== 'production') result.data.CORS_ORIGINS = 'http://localhost:5173';
  const credentials:Record<string,string>={};
  for(const provider of result.data.AI_ROUTING_CONFIG.providers){
    const name=provider.apiKeyEnv;
    if(provider.enabled && name && typeof source[name]==='string') credentials[name]=source[name] as string;
  }
  return {...result.data,AI_PROVIDER_CREDENTIALS:credentials};
}
