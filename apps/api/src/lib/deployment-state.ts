import { createHmac } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Backend } from './repository.js';

/** The newest migration this API needs: `public.schema_version()`, created by 0032 and replaced by every later migration. */
export const EXPECTED_SCHEMA_VERSION = 32;
const PROBE_PREFIX = 'designflow:commit-key-probe:';

export type DeploymentCheck = { secret: 'MATCH' | 'MISMATCH' | 'MISSING' | 'UNKNOWN' | 'NOT_CHECKED'; schema: 'CURRENT' | 'BEHIND' | 'UNKNOWN' | 'NOT_CHECKED' };
/** Additive `deployment` block of `GET /api/capabilities`: whether this deployment can write and whether its database schema is current. */
export type DeploymentDiscovery = { writes: 'AVAILABLE' | 'UNAVAILABLE'; schema: { expectedVersion: number; status: 'CURRENT' | 'BEHIND' | 'UNKNOWN' } };

export function commitKeyProbe(secret: string, now = Date.now()) {
  const probe = `${PROBE_PREFIX}${now}`;
  return { probe, signature: createHmac('sha256', Buffer.from(secret, 'hex')).update(probe).digest('hex') };
}

/** Readiness, discovery and the error handler share one short-lived probe, so none of them adds load per request.
 * A backend without the probe methods (unit-test stubs) reports NOT_CHECKED, which never fails readiness. */
export function deploymentState(backend: Backend, secret: string | undefined, log: FastifyBaseLogger, ttlMs = 5_000) {
  let cached: { at: number; result: Promise<DeploymentCheck> } | undefined;
  let reported = '';
  const probe = async (): Promise<DeploymentCheck> => {
    const schema = !backend.schemaVersion ? 'NOT_CHECKED' as const
      : await backend.schemaVersion().then(version => version >= EXPECTED_SCHEMA_VERSION ? 'CURRENT' as const : 'BEHIND' as const, () => 'UNKNOWN' as const);
    const check = secret ? commitKeyProbe(secret) : null;
    const key = !check ? 'MISSING' as const : !backend.commitKeyMatches ? 'NOT_CHECKED' as const
      : await backend.commitKeyMatches(check.probe, check.signature).then(match => match ? 'MATCH' as const : 'MISMATCH' as const, () => 'UNKNOWN' as const);
    const state = `${key}:${schema}`;
    // Report each change once, not on every readiness poll. Values never include configuration or key material.
    if (state !== reported) {
      reported = state;
      if (key === 'MISMATCH') log.error({ code: 'COMMIT_SECRET_MISMATCH' }, 'PROJECT_COMMIT_SECRET does not match the database commit key; signed writes are refused');
      if (schema === 'BEHIND') log.error({ code: 'SCHEMA_BEHIND', expectedVersion: EXPECTED_SCHEMA_VERSION }, 'The database is missing migrations this API requires');
    }
    return { secret: key, schema };
  };
  const check = () => {
    if (!cached || Date.now() - cached.at > ttlMs) cached = { at: Date.now(), result: probe() };
    return cached.result;
  };
  return {
    check,
    async ready() { const { secret: key, schema } = await check(); return key !== 'MISMATCH' && key !== 'UNKNOWN' && schema !== 'BEHIND' && schema !== 'UNKNOWN'; },
    async secretMismatch() { return (await check()).secret === 'MISMATCH'; },
    async discovery(): Promise<DeploymentDiscovery> {
      const { secret: key, schema } = await check();
      return { writes: key === 'MATCH' || key === 'NOT_CHECKED' ? 'AVAILABLE' : 'UNAVAILABLE',
        schema: { expectedVersion: EXPECTED_SCHEMA_VERSION, status: schema === 'NOT_CHECKED' ? 'UNKNOWN' : schema } };
    },
  };
}
export type DeploymentState = ReturnType<typeof deploymentState>;
