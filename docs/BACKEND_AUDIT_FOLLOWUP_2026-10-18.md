# NekoArch backend: audit follow-up, BUG-001 repair and acceptance preparation

| | |
|---|---|
| **Date** | 2026-10-18 (same day as the audit, later session turn) |
| **Starting point** | [`BACKEND_AUDIT_REPORT.md`](BACKEND_AUDIT_REPORT.md), preserved verbatim in `dbf1e89` (sha256 `18f0b2ba…aade`) |
| **Code line** | `phase31/development` @ `6bd84a5` (default branch), unchanged since the audit |
| **Changes made in this follow-up** | (1) the audit report, committed unchanged, plus this document, on `docs/backend-audit-2026-10-18` (draft PR #32 → `main`); (2) the BUG-001 fix on `fix/bug-001-shutdown-without-sentry` (`b3f0837`, draft PR #33 → `phase31/development`) |
| **Not done** | No merge, rebase, force-push, tag, release, deployment, migration or hosted access. PR #31 and PR #29 are untouched. No other branch or document is modified |

Evidence labels match the audit: **RAN** (executed here), **CI**, **CODE**, **DOC**, **GH** (live GitHub API).

---

## 1. Current state, re-established

| Item | Audit value | Now (re-checked) | Evidence |
|---|---|---|---|
| Remote | `github.com/Aryangithub13/nekoarch-backend` | same | RAN `git remote -v` |
| `phase31/development` (default branch) | `6bd84a5` | `6bd84a5` | RAN `git fetch`, `git ls-remote` |
| `main` | `b06d082` | `b06d082` | RAN |
| PR #31 | open, head `4888360`, 0 reviews, CI green on merge ref `b9ce2a2` (tree `ab67977`) | **unchanged**: open, not draft, same head, **0 reviews**, no description | GH |
| PR #29 | draft, head `c155d5a`, base `287b1a4` | **unchanged**: draft, same head and base, 0 reviews | GH |
| B34 repair | PR #27 merged 2026-10-17 as `6bd84a5` | unchanged; `phase34/diff-integrity` = `4bcdac0`, fully contained | GH, RAN |
| Concurrent work | none active | **none active**: the other sessions on this repository are idle or completed; no new branch, push or PR since the audit other than this follow-up's own (#32, #33) | Session list, RAN `git remote update` |
| Working checkout | stale `main` @ `dd6e469`, report untracked | local `main` unchanged at `dd6e469`; report committed on its own branch; local `origin/main` now fetched to `b06d082` | RAN |
| Docker daemon | unavailable | **still unavailable** | RAN `docker info` |

Because every audited head is unchanged, code-level audit evidence still applies. Where a finding depends on code, I re-checked the cited lines on `6bd84a5` or `b9ce2a2`.

---

## 2. Audit report preservation

| Check | Result |
|---|---|
| Report present in the working checkout | Yes: `docs/BACKEND_AUDIT_REPORT.md`, 642 lines, 35 register rows, no unfilled placeholders, sha256 `18f0b2ba42459c60693099d286eb59c45c51c74d041f1a8a64dbcc9631f4aade` |
| Recovered from summary? | **No.** This is the original file written by the audit; it was not recreated |
| Durable location | Branch `docs/backend-audit-2026-10-18`, cut from `origin/main` @ `b06d082` (where earlier audit documents live), commit `dbf1e89`, pushed |
| Review vehicle | Draft PR #32 → `main`. **Not to be merged** until the owner decides where audit documents belong after consolidation (§8) |
| Other documents changed | None. The three roadmap documents that conflict between `main` and `phase31/development` are untouched |

---

## 3. BUG-001: reproduction and repair

### 3.1 Root cause (re-verified on `6bd84a5`)

- `apps/api/src/server.ts:9-12` calls `initializeSentry(env)`, then `createShutdown(() => app.close(), flushSentry, failed)`.
- `apps/api/src/lib/sentry.ts:79`: without `SENTRY_DSN`, `initializeSentry` returns before `Sentry.init`, so no client exists.
- `apps/api/src/lib/sentry.ts:89`: `flushSentry = () => Sentry.flush(5_000)`. With no client, `@sentry/node@10.74.0` resolves **`false`** (RAN: `await Sentry.flush(100)` → `false`).
- `apps/api/src/lib/lifecycle.ts:6`: `if (await flush() === false) failed();` → `SHUTDOWN_FAILED` log, `process.exitCode = 1`.

### 3.2 Reproduction

| Method | Before the fix (`6bd84a5`) | After the fix (`b3f0837`) |
|---|---|---|
| Built server, no DSN, idle, SIGTERM | exit **1**, `SHUTDOWN_FAILED` logged (audit, 4 of 4 runs) | exit **0**, no `SHUTDOWN_FAILED` |
| Built server, no DSN, after a request, SIGTERM | exit **1** | exit **0** |
| Built server, fixture DSN (as the container smoke test), SIGTERM | exit 0 (not affected) | exit **0** |
| New unit test "shuts down cleanly without a DSN…" | **fails**: `expected false to be true` | passes |
| New unit test "flushes an initialized client… reports a flush that does not complete" | passes (the existing failure path; 5.15 s because the old function ignores the timeout argument) | passes (253 ms, using the 50 ms flush timeout) |

### 3.3 The fix

`b3f0837` on `fix/bug-001-shutdown-without-sentry` (parent `6bd84a5`). 2 files, +42/−2.

```ts
// apps/api/src/lib/sentry.ts
// Without a DSN no client exists and nothing is pending; the SDK's flush would still resolve false and fail every clean shutdown.
export const flushSentry = (timeoutMs = 5_000) => Sentry.getClient() ? Sentry.flush(timeoutMs) : Promise.resolve(true);
```

- **Root cause addressed:** "no client" now means "nothing to flush", which is success. CI fixtures are unchanged: the smoke test keeps its fixture DSN.
- **Preserved:** with a client, the SDK flush runs with the same 5 s default, and a flush that times out still fails the shutdown (tested). A `close()` failure still fails the shutdown (tested). `lifecycle.ts` and `server.ts` are unchanged.
- **Compatibility:** merges cleanly with PR #31 (`4888360`, which edits other lines of `sentry.ts`) and with PR #29 (`c155d5a`), checked with `git merge-tree`.

### 3.4 Regression tests added (`apps/api/tests/foundation.test.ts`, "Sentry transport privacy")

1. **No DSN:** no client; `flushSentry()` is `true`; `createShutdown(ok, flushSentry, failed)` does not call `failed`; a throwing `close` with `flushSentry` calls `failed` exactly once.
2. **Initialized client:** a delivered event flushes and `failed` is not called. An event whose delivery never settles, flushed with a 50 ms timeout through the SDK's own `createTransport` promise buffer, calls `failed` once.

### 3.5 Verification on `b3f0837`

| Command | Result |
|---|---|
| `npx vitest run apps/api/tests/foundation.test.ts -t "shuts down cleanly\|flushes an initialized"` on the parent code | 1 failed (the BUG-001 reproduction), 1 passed |
| `npx vitest run apps/api/tests/foundation.test.ts apps/api/tests/hardening.test.ts` (with the fix) | 2 files, 70 tests passed |
| `npm run build`, `npm run typecheck`, `npm run lint` | exit 0 each |
| `npm audit --omit=dev --audit-level=high` | exit 0 |
| Full suite `npx vitest run` (non-root user, Node 22.22.0, `en_US.UTF-8`) | **113/113 files, 3,108/3,108 tests passed** (the base 3,106 plus the 2 new), exit 0, 809 s |
| Built-server SIGTERM checks (§3.2) | as tabulated |
| CI on the fix PR | In progress when this report was committed (run 39140096759): container smoke **passed**; the Node 22.22.0 and 22.23.3 test jobs were still running. The final result is added to this table when the run completes |

**BUG-001 status:** fixed on a branch, with regression coverage. **Not resolved on the code line until the PR is reviewed and merged.**

---

## 4. Finding-by-finding revalidation

Classes: **DEF** confirmed defect requiring repair · **SEC** confirmed security risk requiring remediation · **EVID** missing acceptance evidence · **BLOCK** integration or release blocker · **TEST** test-coverage gap · **SUSP** suspected, needs reproduction · **REC** non-blocking recommendation · **DONE** resolved or superseded.

| ID | Sev (audit) | Class | Still present? | Re-validation evidence | Status after this follow-up |
|---|---|---|---|---|---|
| BUG-001 | Low | DEF | Yes on `6bd84a5` | §3 | **Fixed on branch** (draft PR #33), pending review/merge |
| TEST-001 | Low | TEST | Yes on `6bd84a5` | §3.4 | **Closed by the same PR** once merged |
| SEC-001 | Medium | SEC (roadmap gate) | Yes | CODE `references/contracts.ts:59` unchanged | Open. Showcase mitigation: trusted demo files only |
| SEC-002 | Medium | SEC (deployment-conditional) | Yes | CODE `http-protection.ts:14` unchanged | Open. Not exploitable on a single instance; blocks horizontal scaling |
| SEC-003 | Medium | SUSP (depends on hosted Auth settings) | Local config unchanged (`config.toml:29,33`) | Hosted settings still unreadable | Open; needs the owner to read the hosted Auth settings |
| SEC-004 | Low (Confirmed) | **DEF** (confirmed data-integrity defect; PR #31 only) | PR #31 only | RAN on the PR #31 merge tree (embedded PostgreSQL, real `collaboration_write` path through the API): with 195 comments stored, 40 concurrent `POST …/comments` stored **203**, then **201** and **200** in three runs (cap 200). With a per-project `pg_advisory_xact_lock` added to `collaboration_write` (scratch copy only): **200** in 3 of 3 runs, and the `collaboration`, `database` (migration replay), `e2e-pipeline` and `hosted-migration-ledger` suites still pass (4 files, 26 tests). The member-existence half of the audit item is inherent to inviting by UUID (the test already returns one `MEMBER_INVALID` for both a missing user and the owner); downgraded to a note | **Confirmed, open in PR #31.** Not on the integrated code line. Fix belongs in `0030` before PR #31 merges (§6.3) |
| SEC-005 | Low | REC | Yes | `backend-ci.yml:28-29` unchanged | Open, post-showcase |
| SEC-006 | Info | REC | Yes | unchanged | Open, post-showcase |
| SEC-007 | Medium | BLOCK (process) | Yes: PR #31 and PR #29 still have **0 reviews** | GH | Open; branch protection still unverifiable with available tools |
| SECRET-001 | Info | DONE (no exposure) | — | Re-ran the redacted all-refs scan on the refreshed mirror: 126 generic matches; the one new match is the audit report quoting an identifier (false positive); 0 high-confidence formats. The GitHub secret-scanning API is **unavailable** for this repository ("Repository does not have GitHub Advanced Security enabled"), so it remains an unavailable control | No exposure found |
| DEP-001 | Medium | REC (dev-only) | Yes | lockfile unchanged | Open; schedule the vitest major upgrade after the showcase |
| DEP-002 | Low | REC | Yes (reproduced again: tests need non-root and `en_US.UTF-8`) | RAN | Open |
| DEP-003 | Low | REC | Yes | unchanged | Open |
| SUPA-001 | High | EVID / BLOCK | Yes | No operator run of `verify-hosted-migrations.mjs` recorded | Open. Procedure in §5.4 |
| SUPA-002 | High | EVID | Yes, and **wider than recorded**: the live suite also has no B34 scenario (SUPA-006, §4.1 and §7.2) | RAN `grep` of `supabase.live.test.ts` | Open. Procedure in §5.3 |
| SUPA-003 | Medium | SUSP | Code unchanged (`ensure-local-postgrest.mjs:40-43`) | No Docker | Open; reproduce on a Docker host |
| SUPA-004 | Low | SUSP (latent) | Yes; `0030` adds two more immutable tables under `projects(id) on delete cascade` | CODE | Open; owner retention decision |
| SUPA-005 | Low | REC | Yes | CODE `0030_collaboration.sql:6` | Open |
| TEST-002 | Medium | TEST | Yes | unchanged | Open |
| TEST-003 | Low | TEST | Yes | reproduced again | Open |
| SHOW-001 | High | BLOCK | Yes | — | Open |
| SHOW-002 | High | BLOCK | Yes (no `README.md` on `6bd84a5`; `docs/PHASE8.md:9` still says "through `0005`") | RAN | Open. Not written here: its local-stack steps cannot be verified without Docker (§9) |
| SHOW-003 | Medium | EVID | Yes | — | Open |
| SHOW-004 | Medium | EVID | Yes | — | Open |
| PHASE-001 | High | BLOCK | Yes; three documents differ (r2 on `main`, r3 on the code line) | RAN §8.3 | Open. Reconciliation strategy in §8.3 |
| PHASE-002 | High | BLOCK | Yes | GH | Open. Recommendation in §6 |
| PHASE-003 | Medium | BLOCK | Yes; exact stale lines identified | §7.1 | Open |
| PHASE-004 | Low | REC | Yes | — | Open (superseded branches still exist) |
| PHASE-005 | Medium | BLOCK | Yes; no new tags | RAN | Open |
| PHASE-006 | Medium | BLOCK (process) | Yes | GH | Open |
| PHASE-007 | Medium | EVID | Yes; closure §6 "None recorded yet" | DOC `docs/phase34/phase34-closure.md` | Open (§7.2) |
| PHASE-008 | Medium | BLOCK (gates) | Yes | CODE | Open |
| DEBT-001 | Low | REC | Yes | — | Open |
| DEBT-002 | Low | REC | Yes | — | Open |
| DEBT-003 | Medium | SUSP | Yes (no sweeper) | CODE | Open; reproduction test proposed in the audit §7 |

### 4.1 New items found in this follow-up

| ID | Sev | Class | Finding | Evidence |
|---|---|---|---|---|
| **SUPA-006** | Medium | EVID | B34 closure step 3 says the local Supabase run would turn acceptance row 14 into PASS, but `scripts/test-local-supabase.mjs` runs only `supabase.live.test.ts`, which has **no B34 route scenario**. Its one "verification" reference (line 691) is a B37 manifest field | RAN; DOC `phase34-closure.md` §4.3 |
| **SEC-008** | Info | REC | `GET /api/routing/capabilities` (PR #31, B43) shows every authenticated user (including anonymous users, if enabled) the configured AI provider IDs, placement, enabled flag and cost classes. Endpoints and key names are not exposed | CODE `routing/registry.ts:69-78` (merge tree) |

Totals after this follow-up: 37 findings (35 audited plus 2 new). Repaired on a branch: BUG-001 and TEST-001 (PR #33). Newly confirmed by reproduction: SEC-004 (PR #31 only; tested fix in §6.3). Resolved on the code line: none yet (both repairs wait on merge).

---

## 5. Supabase acceptance readiness

### 5.1 What is and is not established

| Layer | What it proves | Status for the newest code |
|---|---|---|
| **Static inspection** | RLS enabled on every `public` table (42/42 with `0030`); every `SECURITY DEFINER` function pins `search_path`; private schema revoked; API never uses the service role | **PASS** (audit §8, re-checked for `0030`) |
| **Local integration (embedded PostgreSQL)** | Real RLS and RPCs with a minimal `auth` schema, every migration `0001`–`0030` applied in order; cross-user 404s; role checks | **PASS**: CI 125/3,164 on the PR #31 merge; locally 19/152 targeted, plus `supabase/tests/database.test.ts` (migration replay) |
| **Live local Supabase** (GoTrue + PostgREST + real JWTs, disposable Docker stack) | JWT verification, PostgREST grants, anonymous sign-in, the real `auth.users` | **BLOCKED here** (no Docker daemon). Last run 2026-10-14 (125/125, ≤ `0029`). **Never run** for B34, `0030` or B40–B46 |
| **Hosted ledger (read-only)** | Which migrations the hosted project has | **BLOCKED** (operator credential and owner approval) |
| **Staging workflow** | End-to-end on deployed infrastructure | **BLOCKED** (D-10) |

### 5.2 Migration sequence (RAN on the PR #31 merge tree)

- `0001`–`0030` are contiguous, with no gaps or duplicates.
- PR #31 changes **no** existing migration: `0001`–`0029` are byte-identical to `6bd84a5`.
- `0030_collaboration.sql` is additive only. It creates 3 tables, 3 RLS policies, 2 immutability triggers, 2 private helpers and 2 RPCs, and alters no existing object (its only `alter table` statements enable RLS on its own new tables).
- `0030`'s dependencies exist: `project_private.verify_envelope(text, jsonb, jsonb, text, text)` (`0023:102`), the `project_revisions` `unique (project_id, id)` constraint used by its composite FKs (`0006:41`), and `project_private.immutable_revision()` (`0006:95`).
- **Compatibility:** an API at `6bd84a5` keeps working on a database with `0030` (it never calls the new RPCs). The PR #31 API **requires** `0030` for the six collaboration routes. Deployment order is therefore migration first, then API.

### 5.3 Smallest practical live acceptance procedure (for the environment owner)

**Where:** any machine with a Docker daemon and Node 22. It uses a **disposable local** stack only; the scripts refuse non-local URLs (`test-local-supabase.mjs:12-23`, `ensure-local-postgrest.mjs:32-38`).

```sh
git fetch origin && git switch --detach origin/phase31/development   # or the PR #31 merge commit under review
npm ci && npm run build
npx supabase start                    # disposable local stack
node scripts/ensure-local-postgrest.mjs   # if it exits 1 with "Unexpected REST image", record it (SUPA-003) and continue only if the CLI already ships PostgREST >= v16.3
npx supabase db reset --local         # applies 0001..00NN to the LOCAL stack only
npm run test:supabase                 # 12 live scenarios today; the last receipt (c343855, 2026-10-14) was 125/125
npx supabase stop --no-backup
```

**Exit criterion for SUPA-002 and SUPA-006:** the live suite also contains, and passes, these scenarios (to be written; I have not added them because they cannot be executed here):
1. **B34:** with a real JWT, the owner calls `GET`/`POST …/revisions/:revisionId/verification` and `POST …/verification/diff` on a stored revision and gets the typed reports; a second user gets 404 (RLS through PostgREST); no token gets 401. These routes compute on read and write nothing, so there is no write RPC to forge.
2. **B44 / `0030`:** owner, editor, reviewer, viewer and non-member each get exactly their permissions through PostgREST; direct table `SELECT` by a non-member returns no rows; direct `UPDATE`/`DELETE` of a comment is refused by the immutability trigger; an unsigned `collaboration_write` is refused.
3. **B40:** plan preview → execute → committed revision → restore, as the owner; the other user gets 404.

The CI `supabase-acceptance` job (`workflow_dispatch`) can run the same steps once SUPA-003 is resolved. Its `skipped` status on normal runs is expected and is not evidence.

### 5.4 Read-only hosted migration check (D-9): access and approvals needed

| Need | Detail |
|---|---|
| Approval | The owner authorises an operator for D-9 (runbook `docs/release/b37-release-gates-runbook.md` §1) |
| Credential | A **read-only** database role on the hosted project (`SELECT` on `supabase_migrations.schema_migrations` only). Never the service-role key, and never a credential found in any scan |
| Command | `HOSTED_DB_URL='postgresql://<read-only role>@<host>:<port>/postgres' node scripts/verify-hosted-migrations.mjs > ledger.json` from the commit under review. It opens a `READ ONLY` transaction, prints versions and names only, and rolls back |
| Outcomes | exit 0 consistent (pending listed: expect `0018`–`0029` or `0030`); exit 2 inconsistent (stop and investigate); exit 1 nothing learned |
| Caveat | The ledger records what the Supabase CLI applied. Migrations applied by hand in the dashboard would not appear, so an exit-0 report still needs a schema spot-check (for example that `public.project_members` does not exist before `0030` is applied) |
| Forbidden | `supabase db push`, `migration repair`, `db reset`, any DDL or DML, changing Auth settings |

### 5.5 Auth, RLS and isolation coverage today

| Behaviour | Embedded-PG tests | Live suite |
|---|---|---|
| Missing or invalid token → 401; auth outage → 503 | yes (`foundation`, `hardening`) | yes |
| Expired or revoked JWT | no (no GoTrue) | **no dedicated case** (sessions are fresh anonymous sign-ins) |
| Cross-user 404 on owner-only routes | yes (every `*.integration.test.ts`) | yes, through `0029` |
| Direct-SDK RLS (bypassing the API) | partly (`database.test.ts` with `request.jwt.claims`) | yes, through `0029` |
| `0030` roles and member isolation | yes (`collaboration.integration.test.ts`) | **no** |
| B34 routes | yes (`verification*.test.ts`) | **no** |

---

## 6. PR #31: review checklist and recommendation

**Verified state (GH, RAN):** open, not draft, head `4888360` (10 commits: B40 S1 `69ae94f`, B40 S2 `8857006`, B41–B46 S1 `9399333`…`3ea7a45`, evidence `1ae43fd`, merge of PR #30). +15,820/−5,303 lines, 64 files. 0 reviews, no description. CI green on merge ref `b9ce2a2` (tree `ab67977`): 125 files, 3,164 tests on Node 22.22.0, success on 22.23.3, container smoke success. No B40–B46 phase is complete by its own records (`docs/roadmap/b40-b46-implementation-plan.md` §4).

### 6.1 Checklist

| Area | Check | Status now |
|---|---|---|
| **Scope and dependencies** | Each slice is one commit, in roadmap order; B40 S1 is the base of all others | ✅ verified (`git log`) |
| | Branch lacks the B34 repair (#27/#28), but merges cleanly with it | ✅ `merge-tree` clean; CI on the merge ref includes the B34 repair |
| | Phase records say which roadmap gates remain | ✅ each `docs/phaseNN/*-implementation.md` has "Outstanding" |
| **Migration safety** | `0030` additive, contiguous, no edit to earlier migrations | ✅ §5.2 |
| | RLS plus revokes on new tables; definer functions pin `search_path` | ✅ static |
| | Count caps safe under concurrency (SEC-004) | ❌ **confirmed race** (cap exceeded: 203/200); a tested fix is in §6.3 |
| | Erasure path with the new immutable tables (SUPA-004) | ⚠️ latent; owner decision |
| | Deployment order (migration before API) written down | ❌ not in the PR; add it to the PR description and runbook |
| **API contract** | Additive routes only (151 → 165); OpenAPI and route catalog regenerated; conformance test green | ✅ CI (`modernization.test.ts`) |
| | Existing response shapes unchanged | ✅ conformance test; ⚠️ frontend not checked (SHOW-004) |
| | All new routes authenticated; heavy routes in the `generate` rate-limit group | ✅ CODE (§4.1 SEC-008 is informational) |
| **B34 regression** | B34 suites pass on the merge tree | ✅ RAN 19/152 incl. `verification*.test.ts`, `specialists-verification.integration.test.ts` |
| | B40 S2 runs B34 verification as an analysis branch: any further B34 change must re-run `integration-branches.integration.test.ts` | ⚠️ procedural |
| **Security and secrets** | No secrets in the diff | ✅ redacted all-refs scan (audit + re-run); GitHub secret scanning unavailable (no Advanced Security) |
| | Human security review of `0030`, `services/integration-service.ts` (291 lines), `routes/collaboration.ts` | ❌ not done (0 reviews) |
| **CI and regression** | Full CI on the exact merge tree | ✅ |
| | Re-run after BUG-001 merges (both touch `sentry.ts`, clean merge) | pending |
| **Supabase prerequisites** | Live local acceptance incl. `0030` and B40 scenarios (§5.3) | ❌ not run |
| | Hosted ledger (D-9) before any hosted `0030` | ❌ |
| **Phase acceptance evidence** | Release evidence regenerated on the CI platform (Linux, Node 22) instead of Windows/Node 24 | ❌ (`docs/phase46/release-evidence.json` `environment`) |
| | PR description listing scope, migration, outstanding work | ❌ empty |

### 6.2 Recommendation: **hold pending evidence; then merge as one PR (do not split)**

- **Do not merge on green CI alone.** Missing: human review (SEC-007/PHASE-006), live Supabase acceptance for `0030` and B40 (SUPA-002), and the SEC-004 fix (confirmed; §6.3).
- **Do not split or rewrite.** The branch already has one commit per slice, which a reviewer can walk commit by commit. Splitting would rewrite another contributor's history and re-run CI eight times for no new evidence.
- **Revise in place:** add a PR description (scope, `0030`, deployment order, outstanding items); add the live scenarios of §5.3; regenerate release evidence on Linux/Node 22; apply the SEC-004 fix (§6.3) with its regression test.
- **Merge order:** BUG-001 PR first (small, independent), then PR #31, then refresh PR #29.


### 6.3 SEC-004: proposed fix for PR #31 (tested in a scratch copy, not pushed)

`0030` is not applied anywhere yet, so the fix belongs in `0030` itself before merge (otherwise a new `0031`):

```sql
-- in public.collaboration_write, right after the role check:
 -- Serialize collaboration writes per project so the member, comment and review caps hold under concurrency.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collaboration:' || pid::text, 0));
```

This is a transaction-scoped advisory lock rather than `SELECT … FOR UPDATE` on `projects`: both held the cap in the probe, but a row lock on `projects` would also block the `FOR KEY SHARE` locks that foreign-key inserts take from unrelated writers on the same project. **Regression test to add with it:** the probe in §4 (195 existing comments, 40 concurrent posts, assert exactly 200 stored and every refusal `409 COLLABORATION_LIMIT_REACHED`, the `P4405` mapping in `lib/collaboration-repository.ts:13`), plus the same pattern for the 20-member cap.

---

## 7. PR #29 and the B34 acceptance record

### 7.1 PR #29 (B39 release gates): updates needed

Verified state: draft, head `c155d5a`, base `287b1a4` (behind `phase31/development` by the B34 merge), 0 reviews, CI green 2026-10-15 (run 38682813211). Merges cleanly onto `6bd84a5` and onto the PR #31 merge tree. Re-run of its rehearsal on the current code: **4 files, 12 tests passed** on both PR #29 + `6bd84a5` (tree `00def8d`) and PR #29 + the PR #31 merge (tree `a81f97b`): `staging-workflow-b39`, `staging-workflow` (W-B37), `hosted-migration-ledger` and `specialists-verification` (Blueprint failed-verification mapping), with the B34 repair present. These are local rehearsals, not staging runs.

| Runbook line (`docs/release/b39-release-gates-runbook.md` @ `c155d5a`) | Stale fact | Required update |
|---|---|---|
| L9 | "the B34 repair is PR #27 (separate session)" | PR #27 merged 2026-10-17 as `6bd84a5` |
| L13, L18, L27, L32, L46, L88 | Ledger and staging scope `0001`–`0029`; "expect at least `0029` pending" | Extend to `0030` **if** PR #31 merges first (PR #31 already moves the ledger test's pin to `0030`); otherwise keep `0029` and add a note |
| L21 | "Check out `287b1a4`" | The `phase31/development` commit under review (`6bd84a5` or later) |
| L90 | "The B34 repair (PR #27) decided by the owner, and Blueprint re-verified on its merge" | The decision is made (merged). Re-verification evidence = the W-B39 rehearsal re-run on the merged head (this section), plus the live B34 scenario (SUPA-006) |
| PR body | "B34 repair (PR #27): the owner's merge decision" listed as to-do | Mark as done; add the re-run result |

I did **not** push these edits. PR #29 belongs to another session's work, and its content depends on the owner's choice of merge order (PR #31 before or after).

### 7.2 B34 acceptance: what is still needed

The acceptance matrix (`docs/phase34/phase34-acceptance.md`) is unchanged: 10 PASS (6 direct, 4 inherited), 4 FAIL, 1 NOT VERIFIED. **"B34 is not accepted or closed."** Closure steps (`phase34-closure.md` §4):

| Step | Status | Evidence needed to close |
|---|---|---|
| 1. Merge PR #27 once CI is green | **Done** (2026-10-17, `6bd84a5`, CI 39007185316 green) | — (record it in `phase34-closure.md` §6) |
| 2. Owner records "deferred to <phase>" or "build in B34" for the 3 deferred capabilities (rows 4, 8, 10) | **Open**: §6 says "None recorded yet" | Owner decision text |
| 3. Local Supabase run turns row 14 into PASS | **Open, and insufficient as written** (SUPA-006) | Add a live B34 scenario (§5.3 item 1), run `npm run test:supabase`, attach the receipt |
| 4. D-10 staging and D-11 tag | **Open** (owner-held) | Staging workflow run; tag |

I left the B34 documents unchanged, because none of the facts that would change them (owner decisions, a live receipt) exists yet. B34 should be presented as "repair merged, not accepted".

---

## 8. Integration plan (no integration performed)

### 8.1 Facts

| Item | Value |
|---|---|
| Authoritative code line | `phase31/development` (repository default branch; all code, CI and phase PRs target it) |
| `main` | `b06d082`: README plus documents, 5 commits, **no common ancestor** with the code line (RAN `git merge-base` → empty) |
| Paths on both lines | 6: 3 identical (`docs/audit/AI-training-architecture-audit-2026-10-13.md`, `docs/sources/*` ×2); **3 different**: `docs/roadmap/{authoritative-roadmap-reconciliation,next-phase-readiness,post-audit-risk-register}.md` |

### 8.2 Order

| # | Change | Gate before merging | Tests after |
|---|---|---|---|
| 1 | BUG-001 PR #33 → `phase31/development` | Review; CI green | Full CI |
| 2 | PR #31 → `phase31/development` | §6 checklist (review, live acceptance incl. `0030`, SEC-004 fix §6.3, description) | Full CI; `npm run test:supabase` with the new scenarios; container smoke |
| 3 | PR #29 refreshed (§7.1) → `phase31/development` | W-B39 rehearsal on the new head | Full CI; `staging-workflow-b39.integration.test.ts` |
| 4 | Any further B34 work (none visible now) | Its own PR; re-run `integration-branches`, `verification*`, `specialists-verification` | Full CI |
| 5 | `main` consolidation PR (§8.3) | Steps 1–3 merged; branch protection on `main` | Full CI on `main` |
| 6 | Release gates D-9 → hosted migration decision → D-10 → D-11 | Owner and operator | Ledger exit 0; staging evidence |

### 8.3 `main` consolidation: strategy and document reconciliation

**Recommended:** create `integration/main-consolidation` from `phase31/development` (after steps 1–3), then run `git merge --allow-unrelated-histories origin/main`. Open a PR into `main` and merge it with a merge commit, not a squash, so both histories remain. Then make `main` the default branch.

**The three conflicting documents** (RAN `git log`, `git diff`):

| Document | `main` | `phase31/development` | Relationship |
|---|---|---|---|
| `authoritative-roadmap-reconciliation.md` | r2 (`5472193`) | r3 (`4460cf4`): "PR #16 addendum (§11); r2 text unchanged" | r3 = r2 + addendum; only the revision header line differs |
| `next-phase-readiness.md` | r2 | r3: "r2 text is unchanged except where marked *[r3]*" | r3 amends 7 r2 lines (marked) and adds §9 |
| `post-audit-risk-register.md` | r2 | r3: "PR #16 addendum at the end; r2 rows unchanged" | r3 = r2 + addendum; header line differs |

**Reconciliation rule:** resolve each add/add conflict by taking the **r3 (code-line) version**, which is the later revision of the same document by the same process. Preserve r2 explicitly in two ways: it stays reachable at `main`'s `5472193` because the merge keeps `main`'s history, and optionally as a verbatim copy at `docs/roadmap/archive/<name>.r2-5472193.md` with a one-line pointer in the r3 header. Do not hand-merge the texts. Record the decision in the consolidation PR.

**Risks:** (a) a squash or rebase merge would drop `main`'s history, so use a merge commit; (b) the CI workflow already triggers on `main` (`backend-ci.yml:5`), so the first push to `main` runs the full suite; (c) after the switch, open PRs still target `phase31/development` (retarget or merge them first); (d) `main`'s 2026-10-13/15 status documents become historical once merged and should be marked as such.

---

## 9. Checks not performed, and why

| Check | Reason | Next step |
|---|---|---|
| Live local Supabase (`test:supabase`), `db:start`, container build | No Docker daemon in this container | §5.3 on a Docker host |
| Hosted ledger, hosted Auth settings, staging | Need credentials and owner approval; forbidden in this task | §5.4 |
| Writing the new live Supabase scenarios | They could not be executed here; untested acceptance tests would be false evidence | Write and run them on a Docker host |
| Writing the README (SHOW-002) | Its local-stack steps cannot be verified without Docker; an unverified setup guide would mislead | Write it while running §5.3 |
| Editing PR #29, the B34 documents or PR #31 | Owned by other work; the facts that would change them are owner decisions | §6, §7 |
| Branch protection, Dependabot and secret-scanning alerts | Not exposed by available tools | Repository settings |
| Human code review of PR #31 | Needs a human reviewer (process finding) | Owner |

---

## 10. Files and commits changed

| Branch | Commit | Files | Pushed | PR |
|---|---|---|---|---|
| `docs/backend-audit-2026-10-18` (from `main` @ `b06d082`) | `dbf1e89` | `docs/BACKEND_AUDIT_REPORT.md` (new, verbatim) | yes | #32 (draft → `main`) |
| same | the commit adding this file (see `git log docs/backend-audit-2026-10-18`) | `docs/BACKEND_AUDIT_FOLLOWUP_2026-10-18.md` (new) | yes | #32 |
| `fix/bug-001-shutdown-without-sentry` (from `phase31/development` @ `6bd84a5`) | `b3f0837` | `apps/api/src/lib/sentry.ts` (+2/−1), `apps/api/tests/foundation.test.ts` (+40/−1) | yes | #33 (draft → `phase31/development`) |

Secret checks on the new content: the GitHub secret-scanning API refused with "Repository does not have GitHub Advanced Security enabled" (an unavailable control, not a pass). The local redacted scanner (all audit patterns) was run on the BUG-001 diff and both reports: BUG-001 diff: no matches; follow-up report: no matches; audit report: 1 generic match, the known false positive (the report quoting the identifier `secret: options.env.PROJECT_COMMIT_SECRET`). The test DSN `…@example.invalid/1` is a pre-existing fixture from `foundation.test.ts`, not a credential.

---

## 11. Next actions for the final showcase

1. **Owner:** review and merge the BUG-001 PR (small; CI is the gate).
2. **Environment owner (Docker host, ~1–2 h):** run §5.3 on `6bd84a5` to re-baseline against the last receipt (125/125 on `c343855`). Fix or confirm SUPA-003 if it occurs.
3. **Engineer:** write the three live scenarios in §5.3 and run them on the PR #31 merge tree. Write the README while doing it (SHOW-002).
4. **PR #31 author and reviewer:** apply the SEC-004 fix (§6.3) with its regression test; human review against §6.1. Then merge.
5. **Owner:** record the B34 decisions (§7.2 step 2). Refresh PR #29 (§7.1), then merge.
6. **Operator:** D-9 read-only ledger check (§5.4). Owner decides on hosted migrations. Then D-10 staging if the showcase is hosted.
7. **Then** the `main` consolidation PR (§8.3), a clean-checkout run on `main`, and two showcase rehearsals.

**Showcase readiness: NOT READY.** BUG-001 is repaired on a branch (PR #33). SEC-004 is confirmed in PR #31, with a tested fix proposed. Live Supabase acceptance for the newest code, the hosted ledger, staging proof, human review of PR #31 and a setup guide are still missing. A local, disposable-stack showcase of the already-integrated features (audit §15 J1, J3–J4, J6–J7, J9–J12) is the lowest-risk target, once steps 1–3 pass.
