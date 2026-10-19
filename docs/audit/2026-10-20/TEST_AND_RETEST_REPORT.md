# Test and retest report — 2026-10-20

All numbers below were read from command output or Vitest JSON reports (`--reporter=json`). Machine: Linux x64, Node 26.11.1, npm 12.2.0. "Local" means this machine only; **no CI, staging or hosted run is claimed**.

## 1. Environment repair before the baseline

| Step | Result |
|---|---|
| First full run (before any repair, at the end of PR #38 work) | 59 files failed, 6 tests failed, 480 skipped. **Every** `*.integration.test.ts` failed to start embedded PostgreSQL: "Postgres init script exited with code 127" |
| Diagnosis | `initdb: error while loading shared libraries: libpq.so.5`. `npm install-scripts ls` listed the two blocked packages: `@embedded-postgres/linux-x64` and `esbuild` |
| Local unblock | Ran the package's own `scripts/hydrate-symlinks.js` (what npm would have run) |
| Permanent fix | A20-001 (`allowScripts` + preflight), §3 |

## 2. Baseline (repository at `9c90928`, environment unblocked)

| Command | Exit | Result |
|---|---|---|
| `npx vitest run --reporter=json` (full: unit + embedded integration) | 1 | 137 files, 3248 tests: **3246 passed, 2 failed, 0 skipped**, 562 s. Both failures are this audit's two new regression tests, which the run collected while their fixes were not yet saved. They failed on the defects: `ZodError` (A20-002) and preflight returning null (A20-001). **On unmodified source the baseline is 3246/3246** |
| `node scripts/test-local-supabase.mjs` (LIVE local Supabase, after `migration up` 0019→0033) | 0 | **129/129 passed**, 145 s |
| `npm audit --omit=dev` | 0 | 0 vulnerabilities |
| `npm audit` | 1 | 3 dev-only (1 moderate, 2 critical) via vitest 3.2.7 (DEP-001) |
| Secret pattern scan (tracked files + history) | — | 0 matches |
| Live catalog queries (RLS, grants, definer, search_path) | 0 | See SUPABASE_ACCEPTANCE_REPORT §C |
| NLP rubric `npx tsx scripts/eval-nlp-briefs.ts` (before PR #38) | 0 | Deterministic 42/47 fields, 7/8 status; hosted column skipped (no `AI_ROUTING_CONFIG`) |

## 3. Repairs and their targeted tests

| Finding | Targeted command | Before fix | After fix |
|---|---|---|---|
| A20-001 install scripts | `npx vitest run supabase/tests/embedded-postgres-preflight.test.ts` | New case failed (baseline JSON) | 4/4 pass |
| A20-001 manual | Remove the `libpq.so.5` link; run `startTestDatabase()`; restore | Opaque "exit code 127" | Named cause: "install script was skipped … `npm install-scripts ls`" |
| A20-002 turn 500 | `npx vitest run apps/api/tests/conversation-turns.test.ts` | 1 failed (`ZodError`) | 30/30 pass |
| A20-003…005 NLP (PR #38) | `npx vitest run apps/api/tests/nlp-briefs.test.ts` | 9/24 failed on old source | 24/24 pass |
| ReDoS probe (85 adversarial cases) | ad hoc script (not committed) | 1 throw (the A20-002 `ZodError`) | 0 throws; worst 8.3 ms |

## 4. Final retest (branch `audit/backend-acceptance`, all repairs applied)

| Command | Exit | Result |
|---|---|---|
| `npm run build` | 0 | All 7 workspaces built |
| `npm run lint` | 0 | Clean |
| `npm run typecheck` | 0 | Clean (incl. browser and generator typechecks) |
| `npx vitest run --reporter=json` | 0 | **137 files, 3248 tests: 3248 passed, 0 failed, 0 skipped**, 528 s. Integration: 57 files, 466 tests on embedded PostgreSQL 18 |
| Live local Supabase suite (re-run on final code) | 0 | **129/129**, 124 s; receipt `docs/phase16-evidence/supabase-2026-10-19T19-03-05.012Z.json` |
| `docker build .` + container smoke | 0 | Fail-fast exit 1 without `SENTRY_DSN`; production config: live 200, ready 200, unauthenticated 401, SIGTERM exit 0, no secret in logs |
| `npx tsx scripts/eval-nlp-briefs.ts` | 0 | Deterministic 47/47 fields, 8/8 status. Hosted: **not run** |

**Comparison:** baseline 3246/3246 on unmodified code → final 3248/3248 (+2 regression tests). No test was skipped, deleted or loosened. No regressions.

## 5. Not run, and why

| Command or check | Why not |
|---|---|
| Hosted Supabase ledger or live suite against hosted | No authorised credentials or operator (SUPA-001) |
| Staging end-to-end | No staging environment (SHOW-001) |
| `eval-nlp-briefs.ts` hosted column; any real model call | No model credentials; none requested |
| CI `workflow_dispatch` (`supabase-acceptance`) | Owner-triggered; not pushed by this audit |
| Load or pool-exhaustion test; live DB outage mid-write | No harness exists; outside a defect-repair scope (recorded as NOT VERIFIED) |
| `npm audit fix --force` (vitest 5) | Major upgrade of the test runner; owner-deferred (DEP-001) |

## 6. Environment state left behind (local only)

| Item | State |
|---|---|
| Local Supabase stack | Migrated `0019` → `0033` (forward only). Backup `pg_dump -Fc` of the `0019` state is in the session scratchpad, outside the repository |
| `node_modules/@embedded-postgres/linux-x64` | Symlinks rehydrated (package postinstall) |
| Docker | Image `nekoarch-audit:local` remains (`docker rmi nekoarch-audit:local` to remove) |
