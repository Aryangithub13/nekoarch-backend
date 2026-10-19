import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase } from '../../../test-support/postgres.js';
// @ts-expect-error untyped operator script (plain .mjs)
import { compareLedger, localMigrations, readHostedLedger } from '../../../scripts/verify-hosted-migrations.mjs';

type Row = { version: string; name: string | null };
const local = [{ version: '0001', name: 'a' }, { version: '0002', name: 'b' }, { version: '0003', name: 'c' }];

describe('D-9 read-only hosted migration-history check (operator script)', () => {
  it('compares versions and names: applied, pending, gaps, unknown and mismatched rows', () => {
    expect(compareLedger(local, [{ version: '0001', name: 'a' }])).toMatchObject({ consistent: true, applied: ['0001'], pending: ['0002', '0003'],
      gaps: [], unknown: [], nameMismatches: [], latestApplied: '0001', latestLocal: '0003' });
    expect(compareLedger(local, local)).toMatchObject({ consistent: true, pending: [] });
    // A version applied out of order leaves a gap the CLI would not fill: inconsistent.
    expect(compareLedger(local, [{ version: '0001', name: 'a' }, { version: '0003', name: 'c' }])).toMatchObject({ consistent: false, gaps: ['0002'] });
    expect(compareLedger(local, [{ version: '0004', name: 'x' }])).toMatchObject({ consistent: false, unknown: [{ version: '0004', name: 'x' }] });
    expect(compareLedger(local, [{ version: '0001', name: 'renamed' }])).toMatchObject({ consistent: false,
      nameMismatches: [{ version: '0001', local: 'a', hosted: 'renamed' }] });
    expect(compareLedger(local, [])).toMatchObject({ consistent: true, latestApplied: null, pending: ['0001', '0002', '0003'] });
  });

  it('lists the repository migrations in order', () => {
    const all = localMigrations() as Row[];
    expect(all[0]).toEqual({ version: '0001', name: expect.any(String) });
    expect(all.at(-1)!.version).toBe('0033');
    expect(new Set(all.map(m => m.version)).size).toBe(all.length);
  });

  // INT-B-025: the hosted ledger records versions and names only, so a migration edited in place (as 0030 was) goes unnoticed there.
  // The committed manifest makes any edit to an existing migration fail here and show in review. Never edit a migration that any database
  // has applied: add a new one. A new migration adds its line (cd supabase/migrations && sha256sum 0*.sql > ../migrations.sha256).
  it('matches every migration to its committed checksum, so an in-place edit cannot pass unnoticed', () => {
    const dir = new URL('../../../supabase/migrations/', import.meta.url);
    const manifest = readFileSync(new URL('../../../supabase/migrations.sha256', import.meta.url), 'utf8').trim().split('\n')
      .map(line => { const [sha256, file] = line.split(/\s+\*?/); return { file, sha256 }; });
    const actual = readdirSync(dir).filter(file => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort()
      .map(file => ({ file, sha256: createHash('sha256').update(readFileSync(new URL(file, dir))).digest('hex') }));
    expect(actual).toEqual(manifest);
  });

  describe('against a real PostgreSQL ledger', () => {
    let db: Awaited<ReturnType<typeof startTestDatabase>>;
    beforeAll(async () => {
      db = await startTestDatabase({ migrations: () => false, seed: false });
      await db.pool.query(`create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
        insert into supabase_migrations.schema_migrations values ('0001','a',null),('0002','b',null)`);
    }, 120_000);
    afterAll(async () => { await db?.stop(); });

    it('reads the ledger in a read-only transaction and leaves it unchanged', async () => {
      const before = (await db.pool.query('select count(*)::int n, max(version) v from supabase_migrations.schema_migrations')).rows[0];
      expect(await readHostedLedger(db.connectionString)).toEqual([{ version: '0001', name: 'a' }, { version: '0002', name: 'b' }]);
      expect((await db.pool.query('select count(*)::int n, max(version) v from supabase_migrations.schema_migrations')).rows[0]).toEqual(before);
      expect(compareLedger(local, await readHostedLedger(db.connectionString))).toMatchObject({ consistent: true, pending: ['0003'] });
    }, 60_000);

    it('fails with a generic message that never contains the credential or host', async () => {
      const secret = 'p4ss-should-not-leak';
      const bad = db.connectionString.replace(/:[^:@/]+@/, `:${secret}@`);
      const error = await readHostedLedger(bad).then(() => null, (e: Error) => e);
      expect(error?.message).toBe('Hosted ledger read failed');
      expect(String(error?.stack)).not.toContain(secret);
      expect(String(error?.message)).not.toContain('127.0.0.1');
    }, 60_000);
  });
});
