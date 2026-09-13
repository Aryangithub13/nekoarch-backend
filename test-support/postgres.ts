import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg, { type Pool, type PoolClient } from 'pg';

const supabaseDir = fileURLToPath(new URL('../supabase/', import.meta.url));

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a database test port');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

/** Minimal Auth fixtures for genuine PostgreSQL RLS tests, not an Auth emulator.
 * The separate live Supabase suite exercises GoTrue, JWT verification, and REST.
 */
const authBootstrap = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    is_anonymous boolean not null default true,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    )::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

export async function seedTestDatabase(pool: Pool): Promise<void> {
  await pool.query(await readFile(path.join(supabaseDir, 'seed.sql'), 'utf8'));
}

export async function startTestDatabase(options: { seed?: boolean } = {}) {
  const port = await availablePort();
  const databaseDir = await mkdtemp(path.join(tmpdir(), 'designflow-postgres-'));
  const password = randomBytes(24).toString('hex');
  const postgres = new EmbeddedPostgres({
    databaseDir, port, user: 'postgres', password, persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories=', '-c', 'fsync=off'],
    onLog: () => undefined,
    onError: () => undefined,
  });
  let pool: Pool | undefined;
  let started = false;
  try {
    await postgres.initialise();
    await postgres.start();
    started = true;
    const connectionString = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
    pool = new pg.Pool({ connectionString, max: 8 });
    await pool.query(authBootstrap);
    const migrations = (await readdir(path.join(supabaseDir, 'migrations'))).filter(name => name.endsWith('.sql')).sort();
    for (const migration of migrations) {
      const sql = await readFile(path.join(supabaseDir, 'migrations', migration), 'utf8');
      await pool.query(`begin;\n${sql}\ncommit;`);
    }
    if (options.seed !== false) await seedTestDatabase(pool);
    const activePool = pool;
    let stopped = false;
    return {
      pool: activePool,
      connectionString,
      async stop() {
        if (stopped) return;
        stopped = true;
        await activePool.end();
        await postgres.stop();
        await rm(databaseDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (pool) await pool.end();
    if (started) await postgres.stop();
    await rm(databaseDir, { recursive: true, force: true });
    throw error;
  }
}

/** Execute as the same database role/claims used by Supabase PostgREST. */
export async function asPrincipal<T>(pool: Pool, userId: string | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(userId === null ? 'set local role anon' : 'set local role authenticated');
    await client.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [
      JSON.stringify(userId ? { sub: userId, role: 'authenticated', is_anonymous: true } : { role: 'anon' }),
      userId ?? '',
    ]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function createTestUser(pool: Pool, id = randomUUID()): Promise<string> {
  await pool.query('insert into auth.users (id) values ($1)', [id]);
  return id;
}
