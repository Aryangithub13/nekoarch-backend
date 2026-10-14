// Read-only hosted migration-history check (release gate R03, owner decision D-9: run by an authorized operator).
// It reads supabase_migrations.schema_migrations inside a READ ONLY transaction, compares it with supabase/migrations,
// and prints a report of versions and names only. It never writes, never applies a migration and never prints the
// connection string, credentials, host or a database error message (which can contain them).
//
//   HOSTED_DB_URL='postgresql://…' node scripts/verify-hosted-migrations.mjs > report.json
//
// Exit codes: 0 compared and consistent (pending migrations are allowed and listed); 2 compared and inconsistent
// (an unknown hosted version or a name mismatch); 1 could not compare (nothing was learned).
import process from 'node:process';
import console from 'node:console';
import { readdirSync } from 'node:fs';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const MIGRATIONS = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
export const LEDGER_REPORT_VERSION = 'hosted-migration-ledger-v1';

/** Local migrations as { version, name }, from `NNNN_name.sql` file names. */
export function localMigrations(dir = MIGRATIONS) {
  return readdirSync(dir).filter(f => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort()
    .map(f => ({ version: f.slice(0, 4), name: f.slice(5, -4) }));
}

/** Pure comparison. Hosted rows are { version, name } as the Supabase CLI records them. */
export function compareLedger(local, hosted) {
  const byVersion = new Map(local.map(m => [m.version, m]));
  const hostedVersions = new Set(hosted.map(h => String(h.version)));
  const applied = [], nameMismatches = [], unknown = [];
  for (const h of [...hosted].sort((a, b) => String(a.version).localeCompare(String(b.version)))) {
    const l = byVersion.get(String(h.version));
    if (!l) unknown.push({ version: String(h.version), name: h.name ?? null });
    else if ((h.name ?? null) !== l.name) nameMismatches.push({ version: l.version, local: l.name, hosted: h.name ?? null });
    else applied.push(l.version);
  }
  const pending = local.filter(m => !hostedVersions.has(m.version)).map(m => m.version);
  // A gap: a local version missing on hosted while a later one is applied. The CLI would not apply it in order.
  const latestApplied = applied.at(-1) ?? null;
  const gaps = latestApplied ? pending.filter(v => v < latestApplied) : [];
  const consistent = unknown.length === 0 && nameMismatches.length === 0 && gaps.length === 0;
  return { reportVersion: LEDGER_REPORT_VERSION, consistent, localCount: local.length, hostedCount: hosted.length,
    latestLocal: local.at(-1)?.version ?? null, latestApplied, applied, pending, gaps, unknown, nameMismatches };
}

/** Reads the ledger in a READ ONLY transaction that is always rolled back. Throws only a generic error. */
export async function readHostedLedger(connectionString) {
  const client = new pg.Client({ connectionString, statement_timeout: 10_000, query_timeout: 15_000, connectionTimeoutMillis: 10_000,
    application_name: 'designflow-ledger-readonly' });
  try {
    await client.connect();
    await client.query('begin transaction read only');
    await client.query('set local statement_timeout = 10000');
    const rows = (await client.query('select version, name from supabase_migrations.schema_migrations order by version')).rows;
    await client.query('rollback');
    return rows.map(r => ({ version: String(r.version), name: r.name ?? null }));
  } catch {
    throw new Error('Hosted ledger read failed');
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.HOSTED_DB_URL;
  if (!url) { console.error('Set HOSTED_DB_URL (read-only role preferred). Nothing was contacted.'); process.exit(1); }
  try {
    const report = compareLedger(localMigrations(), await readHostedLedger(url));
    console.log(JSON.stringify({ ...report, checkedAt: new Date().toISOString() }, null, 2));
    process.exitCode = report.consistent ? 0 : 2;
  } catch {
    // Never echo the connection string, host or driver error text.
    console.error('Hosted ledger could not be read. No write was attempted. Check the credential and network, then retry once.');
    process.exitCode = 1;
  }
}
