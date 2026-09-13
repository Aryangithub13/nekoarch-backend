import { z } from 'zod';

const blankToUndefined = (value: unknown) => value === '' ? undefined : value;
const optionalDefault = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blankToUndefined, schema);
export const EnvSchema = z.object({
  NODE_ENV: optionalDefault(z.enum(['development', 'test', 'production']).default('development')),
  SUPABASE_URL: z.string().url().refine(value => /^https?:/.test(value), 'Must use HTTP or HTTPS'),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SENTRY_DSN: optionalDefault(z.string().url().optional()),
  PORT: optionalDefault(z.coerce.number().int().min(1).max(65535).default(3001)),
  HOST: optionalDefault(z.string().min(1).default('127.0.0.1')),
  LOG_LEVEL: optionalDefault(z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')),
  CORS_ORIGINS: optionalDefault(z.string().default('http://localhost:5173')),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && !env.SENTRY_DSN) ctx.addIssue({ code: 'custom', path: ['SENTRY_DSN'], message: 'Required in production' });
  for (const origin of env.CORS_ORIGINS.split(',').map(value => value.trim()).filter(Boolean)) {
    try { if (new URL(origin).origin !== origin) throw new Error(); }
    catch { ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Use comma-separated exact URL origins' }); }
  }
});
export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, unknown> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    // Do not echo submitted values: a malformed URL/key may contain secrets.
    throw new Error(`Invalid environment configuration:\n${result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n')}`);
  }
  return result.data;
}
