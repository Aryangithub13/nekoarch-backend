import { randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { EXPECTED_SCHEMA_VERSION } from '../src/lib/deployment-state.js';
import type { Backend } from '../src/lib/repository.js';
// @ts-expect-error untyped local tooling script (plain .mjs)
import { assertLocal, readLocalCommitSecret } from '../../../scripts/print-local-commit-secret.mjs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type App = Awaited<ReturnType<typeof buildApp>>;
const env = (secret?: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', ...(secret ? { PROJECT_COMMIT_SECRET: secret } : {}) });

// Audit B INT-B-015 and INT-B-017: a deployment whose commit secret or schema does not match the database must not look healthy.
describe('Deployment readiness: commit secret and schema version on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, secret: string;
  const users: Record<string, string> = {};
  const apps: ReturnType<typeof buildApp>[] = [];
  const build = async (configured: string | undefined, backend?: Backend) => {
    const app = buildApp({ env: env(configured), backend: backend ?? createPgBackend(db.pool, users), captureError: () => undefined });
    apps.push(app);
    await app.ready();
    return app;
  };
  const as = (user: string) => ({ authorization: `Bearer ${user}` });
  const project = async (app: App) => {
    const created = await app.inject({ method: 'POST', url: '/api/projects', headers: as('owner'), payload: { title: 'Readiness' } });
    expect(created.statusCode, created.body).toBe(201);
    return created.json<Json>().id as string;
  };
  const saveRevision = (app: App, projectId: string) =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}/revisions`, headers: as('owner'), payload: { model: authored() } });

  beforeAll(async () => {
    db = await startTestDatabase();
    users.owner = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
  }, 120_000);
  afterAll(async () => { for (const app of apps) await app.close(); await db?.stop(); });

  it('the matching secret is ready, writes, and discovery reports this deployment as writable and current', async () => {
    const app = await build(secret);
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
    expect((await saveRevision(app, await project(app))).statusCode).toBe(201);
    const discovery = (await app.inject({ method: 'GET', url: '/api/capabilities' })).json<Json>();
    expect(discovery.deployment).toEqual({ writes: 'AVAILABLE', schema: { expectedVersion: EXPECTED_SCHEMA_VERSION, status: 'CURRENT' } });
  });

  it('a stale secret fails readiness and refuses signed writes with a distinct 503, not 403 FORBIDDEN', async () => {
    // Every `supabase db reset` regenerates project_private.commit_key, leaving the API's PROJECT_COMMIT_SECRET stale.
    const app = await build(randomBytes(32).toString('hex'));
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(503);
    const projectId = await project(app);
    const refused = await saveRevision(app, projectId);
    expect([refused.statusCode, refused.json<Json>().error.code]).toEqual([503, 'COMMIT_ATTESTATION_UNAVAILABLE']);
    const comment = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/collaboration/members`, headers: as('owner'),
      payload: { userId: await createTestUser(db.pool), role: 'viewer' } });
    expect([comment.statusCode, comment.json<Json>().error.code]).toEqual([503, 'COMMIT_ATTESTATION_UNAVAILABLE']);
    expect((await app.inject({ method: 'GET', url: '/api/capabilities' })).json<Json>().deployment.writes).toBe('UNAVAILABLE');
  });

  it('keeps a genuine signature refusal 403 FORBIDDEN while the secret matches', async () => {
    // A tampered signature with a correct server secret is a real permission failure, not a configuration fault.
    const pg = createPgBackend(db.pool, users);
    const tampered: Backend = { ...pg, repository: token => {
      const repository = pg.repository(token);
      return { ...repository, projectRpc: (name, args) => repository.projectRpc!(name, 'p_signature' in args && args.p_signature ? { ...args, p_signature: '0'.repeat(64) } : args) };
    } };
    const app = await build(secret, tampered);
    const refused = await saveRevision(app, await project(app));
    expect([refused.statusCode, refused.json<Json>().error.code]).toEqual([403, 'FORBIDDEN']);
  });

  it('without a secret, readiness outside production is unchanged but discovery reports writes as unavailable', async () => {
    const app = await build(undefined);
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
    const refused = await saveRevision(app, await project(app));
    expect([refused.statusCode, refused.json<Json>().error.code]).toEqual([503, 'PROJECTS_UNAVAILABLE']);
    expect((await app.inject({ method: 'GET', url: '/api/capabilities' })).json<Json>().deployment.writes).toBe('UNAVAILABLE');
  });

  it('`npm run db:secret` reads the current key of a local database and refuses any other host', async () => {
    expect(await readLocalCommitSecret({ DB_URL: db.connectionString })).toBe(secret);
    expect(() => assertLocal('postgresql://user:pw@db.example.com:5432/postgres')).toThrow('Non-local database refused');
  });

  it('pins the schema version to the newest migration, so a new migration must raise it', async () => {
    const newest = Math.max(...(await readdir(new URL('../../../supabase/migrations/', import.meta.url))).filter(name => /^\d{4}_.*\.sql$/.test(name)).map(name => Number(name.slice(0, 4))));
    expect(EXPECTED_SCHEMA_VERSION).toBe(newest);
    expect((await db.pool.query('select public.schema_version() v')).rows[0].v).toBe(newest);
  });

  it('an API deployed ahead of its migrations is not ready and says so in discovery', async () => {
    const older = await startTestDatabase({ migrations: name => Number(name.slice(0, 4)) < EXPECTED_SCHEMA_VERSION });
    try {
      const olderSecret = (await older.pool.query('select secret from project_private.commit_key')).rows[0].secret;
      const app = buildApp({ env: env(olderSecret), backend: createPgBackend(older.pool, users), captureError: () => undefined });
      apps.push(app);
      await app.ready();
      expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(503);
      expect((await app.inject({ method: 'GET', url: '/api/capabilities' })).json<Json>().deployment.schema)
        .toEqual({ expectedVersion: EXPECTED_SCHEMA_VERSION, status: 'BEHIND' });
      await app.close();
      apps.pop();
    } finally { await older.stop(); }
  }, 120_000);
});
