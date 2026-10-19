# NekoArch backend: audit-driven repair log

| | |
|---|---|
| **Date** | 2026-10-19 (session 05:10–07:10 UTC) |
| **Source reports** | [`BACKEND_INTEGRATION_AUDIT.md`](BACKEND_INTEGRATION_AUDIT.md) (audit B, "adversarial integration audit") and [`BACKEND_COMPREHENSIVE_AUDIT.md`](BACKEND_COMPREHENSIVE_AUDIT.md). Historical context: [`BACKEND_AUDIT_REPORT.md`](BACKEND_AUDIT_REPORT.md), [`BACKEND_AUDIT_FOLLOWUP_2026-10-18.md`](BACKEND_AUDIT_FOLLOWUP_2026-10-18.md). **All four are preserved unchanged** |
| **Name mapping** | The task named `docs/BACKEND_ADVERSARIAL_AUDIT.md`. **No file of that name exists** on `main`, on any of the 50 remote branches or on any `refs/pull/*` ref (searched every tree). The audit that calls itself "adversarial" is `BACKEND_INTEGRATION_AUDIT.md`. Its companion audit, the one it cross-references as the security and testing audit, is `BACKEND_COMPREHENSIVE_AUDIT.md`, so that file was used as the second report |
| **Code line** | `phase31/development` @ `7d57b03` (repository default branch) |
| **Repairs** | Branch `fix/audit-b-repairs`, draft PR [#35](https://github.com/Aryangithub13/nekoarch-backend/pull/35) → `phase31/development` |
| **Not done** | No merge, tag, release, deployment, hosted migration or hosted access. No change to `main` other than this file. PRs #29 and #34 untouched. No shared history rewritten (one local, unpushed rebase of this session's own commits; see §8) |

Evidence labels: **RAN** executed in this session · **LIVE** executed against a local Supabase stack (GoTrue + PostgREST + real JWTs) · **EMB** executed on embedded PostgreSQL (real RLS and RPCs, test transport, stubbed sessions) · **CODE** read in source · **GH** GitHub API · **PRIOR** an earlier audit's evidence, not re-executed.

---

## 1. State re-established before editing (RAN, GH)

| Item | Found | Consequence |
|---|---|---|
| Working checkout | `main` @ `e0ac6e4`, clean, tracking `origin/main`. Docs only, no common ancestor with the code line | This file is the only change on `main` |
| `phase31/development` | **Moved to `7d57b03`** since both audits (they cite `6bd84a5`). **PR #31** (B40–B46 + SEC-004) merged 2026-10-19 05:06:53 UTC as `a752f81`. **PR #33** (BUG-001) merged 05:07:20 UTC as `7d57b03`. **Both with 0 reviews** (GH `get_reviews` → `[]`) | BUG-001 and SEC-004 are on the integrated line; re-verified there (§3) |
| PR #34 (`fix/audit-2026-10-18-repairs`, `0031`, TEST-004, TEST-005) | Open draft, `91118ac`, based on the now-merged `phase40/selective-revision-orchestration`; **not** on the code line | Merged unchanged into the repair branch (`6cf8050`), so `0031` is not duplicated |
| PR #29 (B39 release gates) | Open draft, stale base `287b1a4` | Untouched (PHASE-003) |
| Toolchain | Node 22.22.0, npm 10.9.4. Root shell; no `en_US.UTF-8` locale; no Docker daemon running | Locale compiled (`localedef`); tests run as user `ubuntu`; Docker daemon started for §5 |

---

## 2. Outcome summary

| Status | Count | Findings |
|---|---:|---|
| **VERIFIED_FIXED** | 32 | BUG-001, TEST-001, SEC-004, DB-001, DB-002, TEST-004, TEST-005, API-001, SUPA-003, TEST-003, SHOW-002, INT-B-004, -005, -006, -007, -008a, -009, -010a, -013, -014a, -015, -016, -017, -018a, -025a, -027a, -028, -029, -031a, SUPA-002/006 (B34/B40/B44 rows), INT-B-024a, PHASE-007 row 14 |
| **OPEN** | 16 | INT-B-008b, -012, -021, -022, -023, -024b, -027b, SEC-001, SEC-005, DEP-003, TEST-002, SHOW-003, PHASE-003, PHASE-008, DEBT-002, DEBT-003 |
| **BLOCKED** | 26 | INT-B-001, -002, -003, -010b, -011, -014b, -018b, -019, -020, -025b, -026, -030, -031b, SUPA-001, SUPA-004, SUPA-005, SEC-003, SEC-007/PHASE-002/PHASE-006, SHOW-001, SHOW-004, PHASE-001, PHASE-004, PHASE-005, PHASE-007 (owner decisions), PHASE-009, AUD-002 |
| **ACCEPTED_DEFERRED** | 10 | API-002, API-003, PHASE-010, PHASE-011, SEC-002, SEC-006, SEC-008, DEP-001, DEP-002, DEBT-001 |
| **NOT_A_BACKEND_DEFECT** | 5 | AUD-001, SEC-009, REL-001, SECRET-001, ENV-001 (environment) |

Suffix `a`/`b` splits a finding into the part repaired here and the part that remains. Counts are of the items listed; linked IDs grouped as one item (for example SEC-007/PHASE-002/PHASE-006) count once.

**Verdict.** On the repair branch the backend builds, typechecks and lints. The full embedded suite passes (131 files, 3,203 tests), and live local Supabase acceptance passes 127/127. That run covered `0030`–`0033`, B34, B40, B44 and the new deployment probes **through real JWTs and PostgREST for the first time**.

**The backend is still not fully verified.** PR #35 needs human review. Hosted migration state, hosted Auth settings and staging are unverified. Several route families have no live scenario, and owner decisions remain (§10).

---

## 3. Mandatory re-checks

### 3.1 BUG-001: shutdown without Sentry (PR #33, now merged) → **VERIFIED_FIXED** on `7d57b03`

| Check | Command (as `ubuntu`) | Result |
|---|---|---|
| Fix present | `apps/api/src/lib/sentry.ts:106` `flushSentry = (timeoutMs = 5_000) => Sentry.getClient() ? Sentry.flush(timeoutMs) : Promise.resolve(true)` | present (CODE) |
| Regression tests | `npx vitest run apps/api/tests/foundation.test.ts -t "shuts down cleanly\|flushes an initialized"` | **2 passed**. They cover: no DSN → `failed` not called; a throwing `close()` → `failed` once; an initialised client whose delivery never settles, flushed with a 50 ms timeout → `failed` once |
| Built server, no DSN, SIGTERM | `sigterm.sh` probe (built `apps/api/dist/server.js`, `SUPABASE_URL=http://127.0.0.1:9`) | **exit 0**, 0 `SHUTDOWN_FAILED` |
| Built server, fixture DSN, SIGTERM | same with `SENTRY_DSN=http://fixture@127.0.0.1:9/1` | **exit 0** |
| Reproduction of the original | old line `() => Sentry.flush(5_000)` patched into `dist` only, then restored | **exit 1**, 1 `SHUTDOWN_FAILED`, which confirms the test is meaningful |
| Live process (README path, §5) | API against the live stack, SIGTERM | stopped, 0 `SHUTDOWN_FAILED` |

### 3.2 SEC-004: concurrent collaboration caps (PR #31, now merged) → **VERIFIED_FIXED**

| Check | Result |
|---|---|
| Lock | `pg_advisory_xact_lock(hashtextextended('collaboration:' ‖ pid, 0))`. **Key:** per project, 64-bit (a collision only serialises two projects). **Lifetime:** the RPC's transaction, so it is held across count, insert and commit. **Scope:** taken after the role check and before every capped branch (members 20, comments 200, reviews 100). `collaboration_write` is `VOLATILE`, so each `count(*)` takes a fresh READ COMMITTED snapshot after the lock is acquired (CODE `0030:125`) |
| All write paths | The only `INSERT` and `UPDATE` statements on `project_members`, `project_revision_comments` and `project_revision_reviews` are inside `collaboration_write`. Direct DML is revoked from `authenticated` and `service_role` (`0030:46-47`); LIVE confirms an owner's direct insert is `42501` |
| With lock (`7d57b03`) | `collaboration.integration.test.ts -t "caps under concurrent"`: **3/3 passed**. Asserts **stored row counts** (`select count(*)`), not only HTTP codes |
| Lock removed (scratch edit, restored with `git checkout`) | **3/3 failed**: 7 and 6 comments inserted for 5 slots; 7 members for 2 |
| Review cap (TEST-004, from PR #34) | with the lock: passes; review-only scratch copy without the lock: **failed 1 of 2** runs (7 for 5). The review part alone is probabilistic, although the combined test fails every time because of its other parts (residual, §9) |
| After `0033` re-created `collaboration_write` | lock carried over unchanged. Removed from `0033` → the cap test **and** the new same-key burst test fail 2/2; restored → pass |
| `0030` deployment state | Still unknown (no hosted access). It was edited in place before merge (PHASE-009); the new checksum manifest (INT-B-025) prevents a repeat |

---

## 4. Verification gates (final head)

| # | Gate | Command | Tree | Exit | Result |
|---|---|---|---|---|---|
| 1 | Focused regressions | per finding (§6) | per commit | 0 | all pass; each was also shown to fail before its fix |
| 2 | Subsystem suites | e.g. `npx vitest run apps/api/tests/{deployment-readiness.integration,http-contract,hardening,hardening.integration,foundation,engineering.integration,references.integration,modernization,delivery.integration,hosted-migration-ledger,supabase-adapter,collaboration.integration,backend.integration,conversation-turns.integration,generation}.test.ts supabase/tests/database.test.ts` | `6bbba22` state | 0 | 16 files, 248 tests |
| 3 | Cross-phase integration | `e2e-pipeline`, `collaboration`, `collaboration-retries`, `deployment-readiness`, `account-quota-integrity`, `modernization`, `database`, `hosted-migration-ledger` | `c63f0b8` state | 0 | 8 files, 54 tests |
| 4 | Build | `npm run build` | `7e352e3` | 0 | — |
| 5 | Typecheck | `npm run typecheck` | `7e352e3` | 0 | includes the browser typecheck |
| 6 | Lint | `npm run lint` | `7e352e3` and `3f2e588` | 0 | — |
| 7 | **Full suite** | `npx vitest run` (user `ubuntu`, `en_US.UTF-8`) | `7e352e3` | **0** | **131 files, 3,203/3,203 passed, 0 skipped**, 747.6 s. `3f2e588` adds one file (`local-postgrest.test.ts`, 3/3) |
| 7a | Earlier full run (superseded) | same | `de5f0a5` (replaced by the rebase, §8) | **1** | 129 files, **3,193/3,194**: 1 failure (L-19), fixed |
| 8 | Prod dependency audit | `npm audit --omit=dev --audit-level=high` | `7e352e3` | 0 | 0 vulnerabilities |
| 9 | **Local Supabase acceptance** | CI's steps: `supabase start` → `supabase db reset --local` → `node scripts/ensure-local-postgrest.mjs` → `npm run test:supabase` | `7e352e3` + SUPA-003 fix, then `3f2e588` | **0** | **126/126**, then **127/127** (161.9 s). Receipts: `docs/phase16-evidence/supabase-2026-10-19T06-34-52.264Z.json`, `…06-40-52.031Z.json` (0 API errors; the 26 recorded "failures" are the suite's deliberate refusal probes) |
| 10 | Hosted ledger, hosted Auth, staging | — | — | — | **BLOCKED**: no credentials or authorisation |
| 11 | CI on PR #35 | GitHub Actions | `d35a5da` | **1** | run 39212211328: **container smoke failed** (L-22); backend jobs superseded by the next push. `supabase-acceptance` skipped (dispatch only) |
| 11a | Container smoke, local | `docker build` (session CA overlay on the build stage only; runtime stage as committed), then `node scripts/smoke-container.mjs designflow-api:ci` | `d35a5da` script vs `8e7b536` | 1 → **0** | committed script: "Production container smoke test failed"; fixed: non-root, liveness 200, failed-dependency readiness 503, SIGTERM exit 0 |
| 11b | CI on PR #35 after the fix | GitHub Actions | `8e7b536` | pending at time of writing | the subscription on PR #35 reports it; see the PR checks |
| 12 | Diff and Git review | `git diff 6cf8050 HEAD`; secret-pattern scan of the diff | `3f2e588` | — | 0 secret matches; no unrelated files; `.env` (temporary, git-ignored) deleted |

---

## 5. Supabase and migrations

| Level | What it proves | Result in this session |
|---|---|---|
| 1. Unit | pure logic | PASS (gate 7) |
| 2. Embedded PostgreSQL 18 | SQL, RLS, RPC semantics; every migration `0001`–`0033` applied from empty in each suite | PASS (gate 7) |
| 3. **Local Supabase** (Postgres 17.6.1.167, GoTrue v2.196.0, PostgREST v16.2 → v16.3, Kong 2.8.1; CLI 2.117.0) | the production adapter (`lib/supabase.ts`), PostgREST grants and name-based RPC resolution, real Auth | **PASS 127/127.** `0001`–`0033` applied by `supabase start` and again by `db reset`. Covers B05–B39 as before, **plus B34, B40, B44 (`0030`) and the `0032`/`0033` probes and receipts.** The new 5-argument `collaboration_write` resolves by name through PostgREST |
| 4. Hosted read-only ledger | which migrations hosted has | **BLOCKED** (SUPA-001). Last reported at `0017` (PRIOR) |
| 5. Hosted or staging end-to-end | deployed behaviour | **BLOCKED** (SHOW-001) |

**Environment.** Docker daemon started (29.8.2). ECR still answers **"Data limit exceeded"** for image blobs, as in ENV-001. **Docker Hub and GHCR pulls work now**, so the stack was started with `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`. That reproduced SUPA-003 (§6).

**Migration safety decisions.**
- `0030` is on the integrated line and possibly applied somewhere, so it was **not edited**. Its repairs went to forward migrations.
- **`0032_deployment_readiness.sql`** (additive): `schema_version()` returns 32 and `commit_key_matches(p_probe, p_signature)`.
- **`0033_collaboration_retries.sql`**:
  - extends the receipt allow-list (`idempotency_records_operation_check`, drop and re-add with the 25 prior routes plus 3);
  - `create or replace collaboration_read`, adding `revisionsTruncated`;
  - replaces `collaboration_write(text,jsonb,text,text)` with `(…, p_context jsonb default null)`. The old signature is dropped, because two overloads would make PostgREST name resolution ambiguous; 4-argument named calls still resolve;
  - `schema_version()` → 33.
- No table or column is dropped. Upgrade of a populated database: the constraint re-check validates existing rows (all are within the old list); function replacement is fast.
- **Deployment order:** `0030` → `0031` → `0032` → `0033` → API. Readiness enforces this.

---

## 6. Finding register

Columns: **ID** · **Source** (B = integration audit B; C = comprehensive audit; E = earlier report or follow-up, re-statused by C) · **Status** · **Reproduction (before)** · **Root cause** · **Repair and files** · **Regression test → result** · **Commit** · **Remaining risk or dependency**.

### 6.1 Repaired in this session

| ID | Src | Status | Reproduction (before) | Root cause | Repair (files) | Regression test → result | Commit | Remaining |
|---|---|---|---|---|---|---|---|---|
| **INT-B-015** stale commit secret looks healthy | B | VERIFIED_FIXED | EMB: wrong secret → `/health/ready` **200**; signed revision save **403 `FORBIDDEN`**; collaboration write the same | Every signed RPC raises `insufficient_privilege` (42501) on a bad HMAC, the same SQLSTATE as a genuine permission failure; readiness never checked the key | `0032` `commit_key_matches()` (verify-only; `0024` double-HMAC compare). `lib/deployment-state.ts` (shared 5 s probe), `app.ts`: readiness 503 on mismatch; error handler maps `FORBIDDEN` under a mismatched secret to **503 `COMMIT_ATTESTATION_UNAVAILABLE`**; startup warning when the secret is missing. `lib/supabase.ts`, `test-support/pg-backend.ts`, `lib/repository.ts`. `npm run db:secret` (`scripts/print-local-commit-secret.mjs`) | `deployment-readiness.integration.test.ts` (7 tests, including "a genuine signature refusal stays 403" and db:secret against a real DB) → **7/7**. LIVE: stale secret → readiness 503 and 503 code (127/127). LIVE: `npm run db:secret` equals `project_private.commit_key` | `6bbba22`, `7e352e3`, `3f2e588` | `commit_key_matches` is anon-callable (verify only; reveals nothing about the key) |
| **INT-B-017** readiness and discovery blind to schema | B | VERIFIED_FIXED | EMB: API on a DB without the newest migration → readiness **200** | Readiness read only `rate_table_versions`; discovery statuses are static | `0032` `schema_version()`, replaced by every later migration; `EXPECTED_SCHEMA_VERSION` (33). Readiness 503 when behind or unknown; a missing function counts as BEHIND (`PGRST202`/`42883`). `GET /api/capabilities` gains additive `deployment: { writes, schema: { expectedVersion, status } }`. Service statuses unchanged, because they are pinned as `AVAILABLE` by the B20/B36 conversation contract | same file: "pins the schema version to the newest migration", "an API deployed ahead of its migrations is not ready" → pass. LIVE: readiness 200, `CURRENT` | `6bbba22`, `c63f0b8` | Every new migration must replace `schema_version()` (enforced by the test). Discovery reveals schema and write state to anonymous callers (low sensitivity) |
| **INT-B-016** production starts with no browser origin | B | VERIFIED_FIXED | RAN on built `dist`: `NODE_ENV=production`, `CORS_ORIGINS=''` → starts | Default applied only outside production; empty meant deny-all silently | `config/env.ts`: required in production; explicit `none` = deny all. `.env.example` | `http-contract.test.ts` INT-B-016 (2 tests) → pass; `hardening`/`foundation` fixtures updated (the service-role stripping assertion is kept); container smoke sets `CORS_ORIGINS=none` (L-22) → local container smoke pass | `6bbba22`, `8e7b536` | **Operator action:** a production config with empty `CORS_ORIGINS` must set `none` or its origins before upgrading |
| **INT-B-009** Retry-After, Content-Disposition not exposed | B | VERIFIED_FIXED | before-tree run: expose list `x-request-id, etag` | CORS `exposedHeaders` | `app.ts` | `http-contract.test.ts` (429 with CORS) → pass; **failed on `6cf8050`** | `6bbba22` | — |
| **INT-B-010a** 413/415 indistinguishable from malformed JSON | B | VERIFIED_FIXED | `[400, INVALID_REQUEST]` for a 70 KB body and for `application/xml` | error handler collapsed 413/415 into `INVALID_REQUEST` | `app.ts`: `PAYLOAD_TOO_LARGE` (message names the route limit) and `UNSUPPORTED_MEDIA_TYPE`; status stays 400 | `http-contract.test.ts` → pass; pins updated in `engineering`, `references`, `hardening`, `conversation-turns` | `6bbba22` | Status (400 vs 413) is an owner decision (INT-B-010b) |
| **INT-B-028** HEAD health 404 | B | VERIFIED_FIXED | `HEAD /health/live` → 404 | `exposeHeadRoutes: false` | `app.ts`: explicit GET+HEAD on both health routes; HEAD keeps Content-Length, no body | `http-contract.test.ts` → pass; LIVE process HEAD 200 | `6bbba22` | Catalog lists the 2 HEAD routes; the compatibility hash excludes HEAD by its documented rule |
| **INT-B-031a** shared per-IP bucket behind a proxy, silently | B | VERIFIED_FIXED | PRIOR probe 3 (429 for distinct forwarded clients) | `TRUST_PROXY` empty by default | `app.ts`: one-time `FORWARDED_FOR_IGNORED` warning; `.env.example` | `http-contract.test.ts` (warns once; quiet when trusted) → pass | `6bbba22` | Per-platform runbook and staging probe (INT-B-031b) |
| **INT-B-005** path params typed as UUID | B | VERIFIED_FIXED | `openapi.json`: `module`, `schedule`, `levelId` `format: uuid` | generator hard-coded UUID | `test-support/openapi.ts` `PATH_PARAMS` from the routes' own Zod (`SpecialistParamsSchema`, `ScheduleParamsSchema`, `PlanSheetParamsSchema`, `BriefVersionParamsSchema`, exported `BimElementParamsSchema`); regenerated `openapi.json` | `modernization.test.ts` "INT-B-005": every route × path param (>250 checks), values sampled **from the published document** must pass the handler and a value outside must be refused → pass. **Fails with the old generator** (`schedule` UUID refused) | `6bbba22` | — |
| **INT-B-006** 4 authenticated routes marked anonymous | B | VERIFIED_FIXED | `security` absent on `POST /api/estimates`, `POST /api/plans`, `POST /api/plans/generate`, `PATCH /api/plans/:id` | `security` was set from an anonymous probe; these routes validate before authenticating | **R06-F1 / API-002 kept as accepted** (the validation order is unchanged). `CONTRACTS` `auth: true`, and the generator uses it | `modernization.test.ts` "INT-B-006": security ⇔ (probe 401 or `auth`), and a **valid body without a session is 401** for all 4 → pass | `6bbba22` | — |
| **INT-B-007** one success status per operation | B | VERIFIED_FIXED | only the primary status documented | `Op.status` scalar | `alternatives` for 7 routes: references dedupe 200, design-concept replay 200, specialists 200, integration execute 200, jobs dedupe 200, compute replay 200, delivery 304 | "INT-B-007": documented pairs equal the handlers' `code(x ? a : b)` ternaries; delivery lists 200/304 → pass | `6bbba22` | Two more than the audit listed (jobs, compute) |
| **INT-B-008a** stale `info.version` | B | VERIFIED_FIXED | `modernization-phases-1-29` | hand-written | `info.version` = `api-compatibility-v1+<routes>.<sha12>`, equal to `GET /api/compatibility` | "INT-B-008" → pass | `6bbba22` | — |
| **INT-B-013** B44 lists silently capped | B | VERIFIED_FIXED | workspace without a flag at 101 revisions | `limit 100` without a signal | `0033` `revisionsTruncated`; contract; compatibility `pagination` text describes the 4 variants | `collaboration-retries` "truncated" (101 revisions) → pass; LIVE flag false | `c63f0b8` | Comments, reviews and members cannot truncate (caps equal read limits) |
| **INT-B-014a** B44 retries duplicate | B | VERIFIED_FIXED | EMB: keyed retry → 2 comments; **12-request burst with one key → 12 comments**; review twice; keyed DELETE retry 404 | Idempotency-Key ignored on B44; no receipts | `0033` receipts for comment, review, member removal (after the advisory lock); `routes/collaboration.ts` `durableCommand`; service and repository pass `p_context` (signed into the envelope); `pg-backend` | `collaboration-retries.integration.test.ts` (5) → **5/5; 5/5 failed before**. LIVE keyed retry → 1 row | `c63f0b8`, `3f2e588` | Replay header and "required key" (INT-B-014b) |
| **INT-B-018a** B44 timestamps free strings | B | VERIFIED_FIXED | schema `z.string().max(40)` | — | `ts = datetime({ offset: true })`. **Runtime sampled (EMB):** project, revision, comment, member and workspace timestamps are all `…+00:00` with µs, the same form across families | B44 suites, e2e → pass | `c63f0b8` | Z normalisation (INT-B-018b) |
| **INT-B-025a** in-place migration edit undetectable | B | VERIFIED_FIXED | `0030` was edited in place (PHASE-009) | the ledger compares names only | `supabase/migrations.sha256` (33 entries) and a test | `hosted-migration-ledger.test.ts` checksum → pass; **fails with a 1-line edit to `0030`** | `7e352e3` | Hosted content comparison (INT-B-025b) |
| **INT-B-029** env documentation gaps | B | VERIFIED_FIXED | CODE | — | `.env.example` (`COMPUTE_POLICY`, production `CORS_ORIGINS`, `TRUST_PROXY` effect, tooling-only service key, script-only variables, frontend needs); CI `supabase-acceptance` Node `22` → `22.22.0` | lint, full suite | `7e352e3` | — |
| **INT-B-004** plan-of-record B44 routes wrong | B | VERIFIED_FIXED | CODE | doc drift | `docs/roadmap/b40-b46-implementation-plan.md` row corrected and marked as a correction | `collaboration-api-doc.test.ts` (routes and role permissions vs code) → pass | `7e352e3` | — |
| **INT-B-027a** no B44 API document | B | VERIFIED_FIXED | — | — | `docs/phase44/phase44-api.md` | same test | `7e352e3` | B37, B38, B40–B43, B45, B46 (INT-B-027b) |
| **INT-B-024a** production adapter never run for B34/B40/B44/`0030`+ | B | VERIFIED_FIXED (those families) | — | — | Ran the PR #34 live scenario; added a `0032`/`0033` live scenario | LIVE 126/126, 127/127 | `3f2e588` | Other families: INT-B-024b |
| **SUPA-003** PostgREST guard brittle | E | VERIFIED_FIXED | **Reproduced, LIVE:** CLI 2.117.0 from Docker Hub started `postgrest/postgrest:v16.2` → `ensure-local-postgrest.mjs` "Unexpected REST image", **exit 1** (would also stop the CI job) | exact ECR string match | `restImagePlan()`: 16.2 → 16.3 in the same repository; keep ≥ 16.3; refuse anything else | `local-postgrest.test.ts` (3) → pass. LIVE: swapped v16.2 → v16.3, network address kept, no reset; re-run is a no-op | `3f2e588` | — |
| **TEST-005** live scenario for B34/B40/B44 never run | C | VERIFIED_FIXED | written on PR #34, never run (dispatch 403) | — | ran locally (§5) | LIVE scenario pass (both runs) | `3f2e588` (receipts) | CI dispatch still owner-only |
| **SUPA-002 / SUPA-006** (B34, B40, B44 rows) | E | VERIFIED_FIXED for those rows | — | — | as above | LIVE | `3f2e588` | Other families stay OPEN (INT-B-024b) |
| **PHASE-007** row 14 | E | VERIFIED_FIXED (row 14 only) | row 14 NOT VERIFIED | — | `docs/phase34/phase34-acceptance.md` row 14 → PASS (local), with receipts; closure step 3 marked done | LIVE | `d35a5da` | B34 still **not accepted** (4 FAIL rows, owner decisions) |
| **TEST-003** opaque embedded-PG failures | E | VERIFIED_FIXED | RAN as root: **120 s hook timeout plus `spawn initdb EACCES`** | prerequisites unchecked | `test-support/postgres.ts` `embeddedPostgresPreflight()` | `embedded-postgres-preflight.test.ts` (3) → pass; as root: fails in **0.6 s** with the cause | `7e352e3` | — |
| **SHOW-002** no setup guide | E | VERIFIED_FIXED | no README; `PHASE8.md` "through `0005`" | — | root `README.md`; PHASE8 line marked historical | LIVE walkthrough: readiness 200, discovery `CURRENT`, HEAD 200, a GoTrue session creating a project (201), clean SIGTERM, via `npm run dev`, `node --env-file=.env` and the built server | `05f824f` | Not yet followed by a second person on a clean machine |

### 6.2 Previously repaired: verified in this session

| ID | Src | Status | Evidence |
|---|---|---|---|
| BUG-001, TEST-001 | E | VERIFIED_FIXED (on `7d57b03`) | §3.1 |
| SEC-004 | E | VERIFIED_FIXED (on `7d57b03`, and in `0033`) | §3.2 |
| DB-001 | C | VERIFIED_FIXED (on the repair branch) | `account-quota-integrity.integration.test.ts` 6/6 with `0031`; **6/6 failed in 2/2 runs** with `0031` removed |
| DB-002 | C | VERIFIED_FIXED | same file (the two retry tests) |
| TEST-004 | C | VERIFIED_FIXED (coverage) | §3.2; the review-only part detects the race in 1 of 2 runs |
| API-001 | C | VERIFIED_FIXED | 429 on retry documented (`phase32-api.md`, `phase33-api.md`, PR #34) and tested |

### 6.3 Not repaired

| ID | Src | Status | Why | What closes it |
|---|---|---|---|---|
| INT-B-001 members cannot open the project | B | BLOCKED | Owner decision (scope of member reads). Current behaviour **verified**: a member gets 404 on `GET /api/projects/:id` (EMB, LIVE) and is documented in `phase44-api.md` | Owner chooses option a, b or c (audit §8); then per-role route tests |
| INT-B-002 invite by UUID only | B | BLOCKED | Owner decision and privacy review (enumeration) | Decision; enumeration-safe invite flow |
| INT-B-003 `editor` cannot edit | B | BLOCKED | Owner decision (rename or define write scope); documented as read and comment | Decision |
| INT-B-008b 29 untyped JSON responses | B | OPEN | None is validated by a runtime schema; publishing hand-written schemas would be unverified. Now guarded: a **new** untyped route fails `modernization.test.ts` | Export runtime-validated schemas and shrink the allow-list |
| INT-B-010b 400 vs 413 | B | BLOCKED | Owner question 7 | Decision |
| INT-B-011 retryable vs permanent 429 | B | BLOCKED | Owner questions 8 and 10. Mitigation now: `Retry-After` is browser-readable (INT-B-009) and is sent only with `RATE_LIMITED` | Decision, then a `retryable` flag or a status change; polling cadence documented |
| INT-B-012 error-code catalog | B | OPEN | 198 literal sites, about 20 SQLSTATE maps and 6 domain error unions with computed statuses. A truthful catalog needs per-code judgement and the INT-B-011 decision. `SCENE_SOURCE_MISMATCH` 409 (B45) vs 422 (B29): the B45 path is defensive (an artifact of the same immutable revision always carries its hash), so it was not renamed | Generate the catalog and add a completeness test |
| INT-B-014b replay header; required key | B | BLOCKED | Owner question 9; a replay header is a cross-route change | Decision |
| INT-B-018b normalise all timestamps to Z | B | BLOCKED | Owner question 14; runtime already consistent RFC 3339 UTC | Decision |
| INT-B-019 parallel overview and listing | B | BLOCKED | Owner question 5 | Decision |
| INT-B-020 deletion and erasure | B | BLOCKED | Owner question 6; cascades into immutable `0030` rows (SUPA-004) | Retention policy, then an erasure RPC |
| INT-B-021 `FAILED` after commit; 200 refusals | B | OPEN | Contract design; `written`, `resultRevisionId` and `committedRevisionId` already signal it | Add `committed`; document. Frontend: refresh when those fields are non-null |
| INT-B-022 compatibility hash covers routes only | B | OPEN | `info.version` now ties OpenAPI to the route hash; schema drift is still not hashed | Publish an OpenAPI or schema hash |
| INT-B-023 no contracts package or fixtures | B | OPEN | Larger packaging work | Publish types and golden payloads |
| INT-B-024b live coverage of B31, B33, B38, B45 and others | B | OPEN | The live suite still has no calls for references, settings, library, brief, context, documents, dependency graph, engineering assessment, turns, delivery, instructions, feasibility, routing | Add live scenarios; run them in CI on migration changes |
| INT-B-025b hosted content comparison | B | BLOCKED | Depends on how the CLI records `statements` on a real ledger (not observable here) | Operator read of a hosted ledger |
| INT-B-026 integration target | B | BLOCKED | #31 and #33 are now merged, **unreviewed**; no tag after B30; B40–B46 not accepted | Review of PR #35; tags (D-11) |
| INT-B-027b API documents for B37, B38, B40–B43, B45, B46 | B | OPEN | Documentation | Generate from `CONTRACTS` |
| INT-B-030 stale branches | B | BLOCKED | Owner housekeeping | Owner |
| INT-B-031b per-platform runbook; staging probe | B | BLOCKED | No deployment target on record | Deployment decision |
| API-002 validate before auth | C | ACCEPTED_DEFERRED | Kept as accepted (R06-F1); INT-B-006 is solved without reordering | — |
| API-003 `If-None-Match: *` | C | ACCEPTED_DEFERRED | Unchanged; no browser sends it | — |
| AUD-001 role computed before lock | C | NOT_A_BACKEND_DEFECT | Serialisable; `0033` keeps the order | — |
| AUD-002 compute limit on retry | C | BLOCKED | Owner (B36 policy); bounded by `0031`'s owner-wide 8 | Decision |
| PHASE-009 `0030` edited in place | C | BLOCKED | Owner decision; recurrence now prevented by INT-B-025a | Decision recorded in the plan |
| PHASE-010, PHASE-011 | C | ACCEPTED_DEFERRED | Measured cheap or deliberate (PRIOR) | — |
| ENV-001 | C | NOT_A_BACKEND_DEFECT | Environment. Now: daemon starts; Docker Hub and GHCR work; ECR still blocked | — |
| SEC-009, REL-001 | C | NOT_A_BACKEND_DEFECT | Closed by C | — |
| SEC-001 no malware scan | E | OPEN | Build work (scanner and `QUARANTINED` state); roadmap gate | Implement before public uploads |
| SEC-002 per-process limits | E | ACCEPTED_DEFERRED | Single instance for the showcase | Shared store before scaling |
| SEC-003 anonymous sign-ins | E | BLOCKED | Hosted Auth settings unknown (local `config.toml` has anonymous on) | Owner reads hosted settings |
| SEC-005 Actions not SHA-pinned | E | OPEN | CI hardening, not done here | Pin SHAs |
| SEC-006, SEC-008 | E | ACCEPTED_DEFERRED | Informational | — |
| SEC-007 / PHASE-002 / PHASE-006 review governance | E | BLOCKED | **#31 and #33 merged with 0 reviews** (GH) | Human review of PR #35 and the merged B40–B46 code |
| SECRET-001 | E | NOT_A_BACKEND_DEFECT | No exposure; this session's diff scan: 0 matches | — |
| DEP-001 vitest advisories | E | ACCEPTED_DEFERRED | Dev-only; major upgrade after the showcase | — |
| DEP-002 embedded-postgres beta | E | ACCEPTED_DEFERRED | Prerequisites now named by TEST-003 | — |
| DEP-003 open-ended `engines`; Windows/Node 24 evidence | E | OPEN | Not changed | Pin `engines` or test Node 24; regenerate B46 evidence on Linux |
| SUPA-001 hosted ledger | E | BLOCKED | Credential and authorisation | D-9 |
| SUPA-004, SUPA-005 retention and FKs | E | BLOCKED | Owner retention decision | — |
| TEST-002 one e2e test | E | OPEN | Live coverage extended, but no full showcase journey | Live journey scenario |
| SHOW-001 staging | E | BLOCKED | No staging | D-10 |
| SHOW-003 demo data | E | OPEN | — | `scripts/demo-seed.mjs` |
| SHOW-004 frontend comparison | E | BLOCKED | No frontend repository | Frontend team |
| PHASE-001 `main` consolidation | E | BLOCKED | Out of scope by instruction | Consolidation PR |
| PHASE-003 PR #29 runbook stale | E | OPEN | Not this task's PR; it must now name `0030`–`0033` | Refresh #29 |
| PHASE-004, PHASE-005 | E | BLOCKED | Owner (branches, tags) | — |
| PHASE-007 (decisions) | E | BLOCKED | 3 deferral decisions not recorded | Owner records them in `phase34-closure.md` §6 |
| PHASE-008 B31, B32, B36 gates | E | OPEN | Build work (SEC-001, DEBT-003, remote compute) | — |
| DEBT-001 | E | ACCEPTED_DEFERRED | Warm-up request before a demo | — |
| DEBT-002 docs sprawl | E | OPEN | README added; no index | `docs/INDEX.md` |
| DEBT-003 no job sweeper | E | OPEN | Build work | — |

---

## 7. Failed-test ledger

Every failure observed in this session. None was deleted, skipped or weakened. Reproductions (R) are intended failures of the unfixed code.

| # | Command (tree) | Result | Class | Disposition → retest |
|---|---|---|---|---|
| L-1 | `npm ci` as `ubuntu` | `SELF_SIGNED_CERT_IN_CHAIN` | Environment (proxy CA under `/root` unreadable) | Install as root, build and test as `ubuntu` |
| L-2 | BUG-001 built server with the old `flushSentry` | exit 1, `SHUTDOWN_FAILED` | R | Restored → exit 0 (§3.1) |
| L-3 | SEC-004 test, lock removed (`7d57b03`) | 3/3 failed | R (sensitivity) | Restored → 3/3 pass |
| L-4 | DB-001/002 tests, `0031` removed | 6/6 failed ×2 | R | Restored → 6/6 |
| L-5 | Review-cap-only scratch, lock removed | 1 of 2 failed | R; probabilistic | Residual (§9); scratch deleted |
| L-6 | `deployment-readiness` on unfixed code | 5/6 failed: readiness 200 (stale secret, schema behind); `[403, FORBIDDEN]` | R INT-B-015/017 | Fixed → 6/6, then 7/7 |
| L-7 | `deployment-readiness` after the first fix | 1 failed: schema `UNKNOWN` instead of `BEHIND` | Product defect in the repair | Missing function mapped to version 0 → pass |
| L-8 | `http-contract` on `6cf8050` | 6/6 failed | R INT-B-009/010/016/028 | → 6/6, then 8/8 |
| L-9 | `http-contract` HEAD | body non-empty under `inject` | Repair defect | Route `onSend` drops the body → pass |
| L-10 | 9 existing files after the runtime repairs | 12 failures: production fixtures without `CORS_ORIGINS`, old `INVALID_REQUEST` pins, catalog drift, ledger pin, an extra outbound request | Intended contract changes plus one design defect | Pins updated with intent kept. The extra request came from a startup probe → **probe removed** (startup stays offline) |
| L-11 | `delivery.integration` | route count 165 vs 167 | Test vs the documented HEAD rule | Test applies routeCatalog's HEAD rule → pass |
| L-12 | `foundation` echo test after an auth-first reorder | 401 vs 400 | My reorder overrode accepted R06-F1 | **Reorder reverted**; INT-B-006 solved by metadata → original test unchanged, passes |
| L-13 | `collaboration-retries` on unfixed code | 5/5 failed (burst stored 12) | R INT-B-014/013 | → 5/5 |
| L-14 | `0033` with the lock removed | cap test and burst test failed 2/2 | R (sensitivity) | Restored → pass |
| L-15 | INT-B-005 test with the old generator | failed (`schedule` UUID refused) | R (sensitivity) | Restored → pass |
| L-16 | Checksum test with `0030` edited | failed | R (sensitivity) | Restored → pass |
| L-17 | DB test as root | 120 s hook timeout, `initdb EACCES` | R TEST-003 | → 0.6 s explicit error |
| L-18 | `ensure-local-postgrest.mjs` (LIVE) | "Unexpected REST image", exit 1 | R SUPA-003 | Fixed → swapped to v16.3, exit 0 |
| L-19 | Full suite on `de5f0a5` | 1/3,194 failed: `conversation-turns.integration.test.ts:418` expected `INVALID_REQUEST` | Intended contract change (INT-B-010) not yet updated | Pin updated → 15/15; final full suite 3,203/3,203 |
| L-20 | `docker pull public.ecr.aws/supabase/postgres` | "Data limit exceeded" | Environment (ENV-001) | Docker Hub registry used |
| L-21 | Process probes: `pkill -f` matched its own shell; `$!` was a subshell (exit 143) | Harness error | Harness | Re-run with explicit PIDs → clean SIGTERM, 0 `SHUTDOWN_FAILED` |
| L-22 | **CI** container smoke, run 39212211328 (`d35a5da`) | "Production container smoke test failed", exit 1 | **Product regression from my INT-B-016 change**: the image runs with `NODE_ENV=production`, and `scripts/smoke-container.mjs` set no `CORS_ORIGINS`, so the API refused to start. Missed locally because no container could be built before | Reproduced with the production env (exit 1, `CORS_ORIGINS: Required in production`) and with the real image. Fix `8e7b536`: the smoke sets `CORS_ORIGINS=none` → local container smoke exit 0 |
| L-23 | Local `docker build` | `npm ci` "Exit handler never called" (no proxy CA in the build container); then Docker Hub 429 on the manifest lookup | Environment | Session-only Dockerfile overlay outside the repo (CA on the build stage); base image pulled; build exit 0 |

---

## 8. Git record

| Commit (PR #35) | Content |
|---|---|
| `6cf8050` | Merge of PR #34's four commits, unchanged (`0031`, TEST-004, TEST-005, API-001 docs) |
| `6bbba22` | INT-B-015, -017, -016, -009, -010, -028, -031, -006, -005, -007, -008 (`0032`) |
| `c63f0b8` | INT-B-014, -013, -018 (`0033`) |
| `7e352e3` | INT-B-025, `db:secret`, TEST-003, INT-B-029, INT-B-004, INT-B-027 (B44) |
| `3f2e588` | SUPA-003; the `0032`/`0033` live scenario; two live receipts |
| `05f824f` | README (SHOW-002) |
| `d35a5da` | B34 matrix row 14 (live evidence) |
| `8e7b536` | Container smoke: explicit `CORS_ORIGINS=none` (fixes L-22) |

`6bbba22` and `c63f0b8` replace two **local, never-pushed** commits (`b6174ea`, `de5f0a5`) that I rebuilt with a scripted rebase. The reason: `b6174ea` had reordered authentication on the Phase 5 routes against the accepted R06-F1 decision; it was reverted to the metadata approach before anything was pushed. No pushed or shared history was rewritten.

---

## 9. Remaining risks

- The review-cap concurrency assertion alone detects a missing lock about 1 time in 2 (L-5). The combined test is reliable because of its comment and member parts. A deterministic interleaving test (as in `account-quota-integrity`) would make it exact.
- `/api/capabilities` and `schema_version()` reveal the schema level and write availability anonymously (low sensitivity).
- The live receipts are from a local CLI stack (Postgres 17.6 image; Docker Hub images), not hosted Supabase.
- B40–B46 code reached the integrated line without review (SEC-007).

---

## 10. Required from people

| Need | Who | Unblocks |
|---|---|---|
| Review PR #35; decide PR #34 (merge first or close: #35 contains it) | Reviewer / owner | SEC-007, everything in §6.1 reaching the code line |
| Before deploying #35: apply `0030`–`0033` first; set production `CORS_ORIGINS` (or `none`); re-provision `PROJECT_COMMIT_SECRET` if the DB key differs | Operator | INT-B-015/016/017 rollout |
| `workflow_dispatch` of `backend-ci.yml` on `fix/audit-b-repairs`, to reproduce 127/127 on GitHub runners | Owner | CI evidence for TEST-005; SUPA-003 on ECR images |
| Read-only hosted ledger (`scripts/verify-hosted-migrations.mjs`); hosted migration decision `0018`–`0033` | Operator / owner | SUPA-001, INT-B-025b, PHASE-009 |
| Hosted Auth settings (anonymous sign-ins, confirmations) | Owner | SEC-003 |
| Decisions: INT-B-001/002/003, -010b, -011, -014b, -018b, -019, -020 (with SUPA-004/005), AUD-002, B34 deferrals (PHASE-007), B36 D1–D7 | Owner | §6.3 |
| Staging environment; tags D-10/D-11 | Owner / operator | SHOW-001, PHASE-005 |
| Frontend repository or contract fixtures | Frontend team | SHOW-004, INT-B-023 |

## 11. Frontend coordination (no frontend code was changed)

1. Treat 503 `COMMIT_ATTESTATION_UNAVAILABLE` as "server misconfigured, try later", not "permission denied".
2. Read `GET /api/capabilities` → `deployment`; hide write features when `writes` is `UNAVAILABLE` or `schema.status` is not `CURRENT`.
3. Upload and body errors: branch on `PAYLOAD_TOO_LARGE` and `UNSUPPORTED_MEDIA_TYPE` (status still 400).
4. 429: back off using the now-readable `Retry-After` (`RATE_LIMITED` only). A 429 without `Retry-After` is a quota: do not auto-retry.
5. Send `Idempotency-Key` on B44 comment, review and member removal; reuse a key only for a retry of the same request.
6. B44 workspace: show "more revisions exist" when `revisionsTruncated`.
7. Regenerate any client from `docs/modernization/openapi.json`. `module` and `schedule` are enums and `levelId` a pattern; the 4 Phase 5 routes need the bearer token; 200/304 alternatives are documented; `info.version` matches `GET /api/compatibility`.
8. B44 timestamps are RFC 3339 with an offset (`+00:00`).
9. Give the operator the frontend origins for production `CORS_ORIGINS`.
10. Keep the reviewer UI frozen until INT-B-001/002/003 are decided.

## 12. Next highest-priority action

**Human review of PR #35, then an owner `workflow_dispatch` of the `supabase-acceptance` job on its branch.** That turns this session's local 127/127 into CI evidence, on the ECR image path the SUPA-003 fix also covers. Then the read-only hosted ledger (D-9), before any of `0018`–`0033` is applied to a hosted database.
