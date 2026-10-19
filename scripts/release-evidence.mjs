#!/usr/bin/env node
// B46 S1: release evidence manifest. Records what was actually run, on which commit, with which results, and states what was not verified.
// It never asserts production readiness. Usage:
//   node scripts/release-evidence.mjs            # inventory only (no tests run)
//   node scripts/release-evidence.mjs --run      # also runs the B40–B46 suites (requires `npm run build` first)
//   node scripts/release-evidence.mjs --run --out docs/phase46/release-evidence.json
import process from 'node:process';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2), run = args.includes('--run');
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8' }).trim(); } catch { return null; } };

/** The suites each slice is verified by (B40 S1 is included as the base of S2). */
const SUITES = [
  { slice: 'B40 S1+S2', files: ['apps/api/tests/integration-plan.test.ts', 'apps/api/tests/integration-plan.integration.test.ts', 'apps/api/tests/integration-branches.integration.test.ts'] },
  { slice: 'B41 S1', files: ['apps/api/tests/instructions.test.ts', 'apps/api/tests/instructions.integration.test.ts'] },
  { slice: 'B42 S1', files: ['apps/api/tests/feasibility.test.ts', 'apps/api/tests/feasibility.integration.test.ts'] },
  { slice: 'B43 S1', files: ['apps/api/tests/routing.test.ts', 'apps/api/tests/routing.integration.test.ts'] },
  { slice: 'B44 S1', files: ['apps/api/tests/collaboration.integration.test.ts', 'supabase/tests/database.test.ts', 'apps/api/tests/hosted-migration-ledger.test.ts'] },
  { slice: 'B45 S1', files: ['apps/api/tests/delivery.integration.test.ts'] },
  { slice: 'B46 S1', files: ['apps/api/tests/e2e-pipeline.integration.test.ts'] },
  { slice: 'Conformance', files: ['apps/api/tests/modernization.test.ts'] },
];
const RECORDS = ['docs/phase40/b40-s1-implementation.md', 'docs/phase40/b40-s2-implementation.md', 'docs/phase41/b41-s1-implementation.md', 'docs/phase42/b42-s1-implementation.md',
  'docs/phase43/b43-s1-implementation.md', 'docs/phase44/b44-s1-implementation.md', 'docs/phase45/b45-s1-implementation.md', 'docs/phase46/b46-s1-implementation.md'];

function runSuite(suite, dir, timingsFile) {
  const report = join(dir, `${suite.slice.replace(/[^A-Za-z0-9]+/g, '-')}.json`), started = Date.now();
  // Vitest's own entry point under this Node binary: no shell, so no argument is ever re-parsed.
  const r = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...suite.files, '--reporter=json', `--outputFile=${report}`],
    { encoding: 'utf8', env: { ...process.env, B46_TIMINGS_FILE: timingsFile } });
  const json = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null;
  const suiteErrors = (json?.testResults ?? []).filter(t => t.status === 'failed' && (t.assertionResults ?? []).every(a => a.status === 'passed'))
    .map(t => (t.message ?? '').split('\n')[0].slice(0, 200));
  const failed = json?.numFailedTests ?? null;
  // A suite-level error with every assertion passing (e.g. EBUSY while removing the embedded database on Windows) is reported as such, not hidden.
  const status = !json ? 'NOT_RUN' : failed > 0 ? 'FAILED' : suiteErrors.length ? 'PASSED_WITH_SUITE_ERRORS' : 'PASSED';
  return { slice: suite.slice, files: suite.files, status, tests: json ? { passed: json.numPassedTests, failed, total: json.numTotalTests } : null,
    suiteErrors, exitCode: r.status, durationMs: Date.now() - started };
}

const catalog = JSON.parse(readFileSync('docs/modernization/api-routes.json', 'utf8'));
const routes = (catalog.routes ?? catalog).map(x => `${x.method} ${x.url ?? x.path}`).sort();
const migrations = readdirSync('supabase/migrations').filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
const dir = run ? mkdtempSync(join(tmpdir(), 'release-evidence-')) : null, timingsFile = dir ? join(dir, 'b46-timings.json') : null;
const suites = SUITES.map(s => run ? runSuite(s, dir, timingsFile) : { slice: s.slice, files: s.files, status: 'NOT_RUN', tests: null, suiteErrors: [], exitCode: null, durationMs: null });

const evidence = {
  evidenceVersion: 'release-evidence-v1',
  generatedAt: new Date().toISOString(),
  source: { commit: git('rev-parse', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), workingTreeClean: git('status', '--porcelain', '--untracked-files=no') === '' },
  environment: { node: process.version, platform: `${process.platform}-${process.arch}`, database: 'embedded PostgreSQL (test-support/postgres.ts), every migration applied' },
  contract: { routes: routes.length, routeCatalogSha256: createHash('sha256').update(routes.join('\n')).digest('hex'), migrations: migrations.length, latestMigration: migrations.at(-1) },
  slices: RECORDS.filter(existsSync).map(path => ({ record: path, status: (readFileSync(path, 'utf8').match(/^\*\*Status:\*\*\s*(.+)$/m)?.[1] ?? 'unstated').slice(0, 300) })),
  suites,
  /** Local stage durations of the B46 end-to-end scenario (milliseconds, this machine, this run). Measurements, never targets or guarantees. */
  stageTimingsMs: timingsFile && existsSync(timingsFile) ? JSON.parse(readFileSync(timingsFile, 'utf8')) : null,
  unverified: [
    'Live Supabase acceptance (scripts/test-local-supabase.mjs) for migration 0030 and the B40–B46 routes',
    'Hosted migration history (D-9) and staging workflow (D-10); no hosted database was migrated',
    'CI on a pushed head (Node 22.22.0 and 22.23.3)',
    'Connected frontend contracts and the live 3D viewer (B45 gate), desktop GPU-tier performance',
    'Any external AI, render or compute provider (none is configured or called)',
    'Independent review of these slices',
  ],
  knownLimits: 'Each slice record lists its outstanding work (§ "Outstanding"); every engineering, certification and statutory claim stays NOT_CLAIMED.',
  productionReady: false,
};
const json = JSON.stringify(evidence, null, 2);
if (out) writeFileSync(out, `${json}\n`);
process.stdout.write(`${json}\n`);
process.exitCode = suites.some(s => s.status === 'FAILED') ? 1 : 0;
