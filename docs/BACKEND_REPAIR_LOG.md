# NekoArch backend: audit-driven repair log

| | |
|---|---|
| **Date** | 2026-10-19. Session 1: 05:10–07:10 UTC. **Session 2 (reconciliation and remaining repairs): 07:20–11:35 UTC** |
| **Revision** | **r2.** r1 is `b6d5f0c`. r2 corrects the finding arithmetic (§2.1), records the PR overlap resolution (§1.1) and adds the session-2 repairs. r1's text is replaced, not preserved, where it was wrong; every correction is listed in §2.1 |
| **Source reports** | [`BACKEND_INTEGRATION_AUDIT.md`](BACKEND_INTEGRATION_AUDIT.md) (audit B, "adversarial integration audit") and [`BACKEND_COMPREHENSIVE_AUDIT.md`](BACKEND_COMPREHENSIVE_AUDIT.md) (audit C). Historical context: [`BACKEND_AUDIT_REPORT.md`](BACKEND_AUDIT_REPORT.md), [`BACKEND_AUDIT_FOLLOWUP_2026-10-18.md`](BACKEND_AUDIT_FOLLOWUP_2026-10-18.md). **All four are preserved unchanged** |
| **Name mapping** | The task named `docs/BACKEND_ADVERSARIAL_AUDIT.md`. **No file of that name exists** on `main`, on any of the 50 remote branches or on any `refs/pull/*` ref (searched every tree; re-checked in session 2). The audit that calls itself "adversarial" is `BACKEND_INTEGRATION_AUDIT.md`. Its companion, which it cross-references as the security and testing audit, is `BACKEND_COMPREHENSIVE_AUDIT.md`, so that file is used as the second report |
| **Code line** | `phase31/development` @ `7d57b03` (repository default branch; unchanged during both sessions) |
| **Repairs** | Branch `fix/audit-b-repairs`, draft PR [#35](https://github.com/Aryangithub13/nekoarch-backend/pull/35) → `phase31/development`, head **`715eba9`** |
| **Not done** | No merge, tag, release, deployment, hosted migration or hosted access. No force-push; no shared history rewritten. No frontend code. No change to `main` other than this file. PR #34 retargeted only (§1.1); PRs #29, #36, #37 untouched |

Evidence labels: **RAN** executed in this session · **LIVE** executed against a local Supabase stack (GoTrue + PostgREST + real JWTs) · **EMB** executed on embedded PostgreSQL (real RLS and RPCs, test transport, stubbed sessions) · **CODE** read in source · **GH** GitHub API · **PRIOR** an earlier audit's evidence, not re-executed.

**Hosted state is unknown.** Nothing in this log says what any hosted Supabase project contains. Every database result is embedded PostgreSQL or a disposable local CLI stack.

---

## 1. State re-established (RAN, GH)

| Item | Found | Consequence |
|---|---|---|
| Working checkout | `main`, docs only, no common ancestor with the code line | This file is the only change on `main` |
| `phase31/development` | `7d57b03`: **PR #31** (B40–B46 + SEC-004) merged 05:06:53 UTC as `a752f81`, **PR #33** (BUG-001) merged 05:07:20 UTC as `7d57b03`, **both with 0 reviews** (GH). Unchanged at the end of session 2 | BUG-001 and SEC-004 re-verified there (§3) |
| PR #34 (`fix/audit-2026-10-18-repairs`, `91118ac`) | Open draft, was based on the merged `phase40/selective-revision-orchestration` | Resolved in §1.1 |
| PR #36 (`f55/frontend-integration`), PR #37 (`fix/windows-import-boundary-path`) | Open, another contributor. #36: `scripts/dev-embedded.ts`, `package.json`, `.gitignore`. #37: `apps/api/tests/interpretation.test.ts` only | Not modified. `git merge-tree` of each with the PR #35 head: **0 conflicts** (RAN) |
| PR #29 (B39 release gates) | Open draft, stale base `287b1a4` | Untouched (PHASE-003) |
| Toolchain | Node 22.22.0, npm 10.9.4, root shell, no `en_US.UTF-8`, no Docker daemon | Locale compiled; tests run as `ubuntu`; Docker started for §5 |

### 1.1 PR overlap: resolved

PR #35 contained PR #34's four commits through the unchanged merge `6cf8050`, while #34 targeted a merged phase branch.

| Step | Evidence |
|---|---|
| #34 retargeted to `phase31/development` (base change only, no push to its branch); its description now states the merge order | GH: 4 commits, 7 files, mergeable |
| #34's merge result equals #35's first commit | tree of `6cf8050` = `4b9a9736…`, the same tree GitHub's merge of #34 yields (RAN) |
| Full suite on exactly that tree | **126 files, 3,173/3,173 passed** (RAN, `npx vitest run`, 709.8 s) |
| #34's head is an ancestor of #35 | `git merge-base --is-ancestor 91118ac HEAD` → true |

**Merge order: #34, then #35.** No renumbering is needed: `0031` comes only from #34 and `0032`/`0033` only from #35. Merging #35 alone also lands #34 unchanged; #34 can then be closed as included. Merging #34 later after #35 is a no-op.

---

## 2. Outcome: one status per finding ID

**Method (RAN).** The finding IDs are every match of `\b((?:INT-B|[A-Z]{2,8})-\d{3})\b` in the four reports, minus `SHA-256`. That gives **83 distinct IDs**: 31 `INT-B-*` from audit B; 8 only in audit C (`AUD-001`, `AUD-002`, `ENV-001`, `PHASE-010`, `PHASE-011`, `REL-001`, `SEC-009`, `TEST-004`); the other 44 all appear in audit C, 37 of them also in an earlier report. Each ID has exactly **one** status:
- **VERIFIED_FIXED** only when every part of the finding is fixed with test evidence;
- otherwise the status of what remains, with the repaired part named (`*` below).
The table was generated from one list by a script that asserts its IDs equal the reports' IDs, and the counts are derived from it, not typed. "In reports": **R** `BACKEND_AUDIT_REPORT`, **F** follow-up, **C** comprehensive (audit C), **B** integration (audit B).

| Status | Count | IDs |
|---|---:|---|
| **VERIFIED_FIXED** | 28 | API-001, BUG-001, DB-001, DB-002, INT-B-004, INT-B-005, INT-B-006, INT-B-007, INT-B-009, INT-B-013, INT-B-015, INT-B-016, INT-B-017, INT-B-021, INT-B-022, INT-B-024, INT-B-027, INT-B-028, INT-B-029, SEC-004, SHOW-002, SUPA-002, SUPA-003, SUPA-006, TEST-001, TEST-003, TEST-004, TEST-005 |
| **OPEN** | 11 | DEBT-002, DEBT-003, DEP-003, INT-B-008*, INT-B-023, PHASE-003, PHASE-008, SEC-001, SEC-005*, SHOW-003, TEST-002 |
| **BLOCKED** | 29 | AUD-002, INT-B-001, INT-B-002, INT-B-003, INT-B-010*, INT-B-011, INT-B-012*, INT-B-014*, INT-B-018*, INT-B-019, INT-B-020, INT-B-025*, INT-B-026, INT-B-030, INT-B-031*, PHASE-001, PHASE-002, PHASE-004, PHASE-005, PHASE-006, PHASE-007*, PHASE-009, SEC-003, SEC-007, SHOW-001, SHOW-004, SUPA-001, SUPA-004, SUPA-005 |
| **ACCEPTED_DEFERRED** | 10 | API-002, API-003, DEBT-001, DEP-001, DEP-002, PHASE-010, PHASE-011, SEC-002, SEC-006, SEC-008 |
| **NOT_A_BACKEND_DEFECT** | 5 | AUD-001, ENV-001, REL-001, SEC-009, SECRET-001 |
| **Total** | **83** | |

| ID | In reports | Status | Repaired part | Evidence, or what closes it |
|---|---|---|---|---|
| API-001 | BC | VERIFIED_FIXED | all | 429 on retry documented and tested (PR #34 docs) |
| API-002 | BC | ACCEPTED_DEFERRED | — | R06-F1 validate-before-auth kept as accepted; INT-B-006 solved by metadata |
| API-003 | BC | ACCEPTED_DEFERRED | — | `If-None-Match: *` unchanged; no browser sends it |
| AUD-001 | C | NOT_A_BACKEND_DEFECT | — | Serialisable; closed by audit C; `0033` keeps the order |
| AUD-002 | C | BLOCKED | — | Owner: B36 compute-limit policy on retry (bounded by `0031` owner-wide 8) |
| BUG-001 | BCFR | VERIFIED_FIXED | all | §3.1: tests 2/2; built server SIGTERM exit 0; old line exit 1 |
| DB-001 | BC | VERIFIED_FIXED | all | `account-quota-integrity` 6/6; 6/6 fail ×2 without `0031` |
| DB-002 | BC | VERIFIED_FIXED | all | same file, retry tests |
| DEBT-001 | CFR | ACCEPTED_DEFERRED | — | Warm-up request before a demo (PRIOR) |
| DEBT-002 | CFR | OPEN | — | README added (SHOW-002); no `docs/INDEX.md` |
| DEBT-003 | BCFR | OPEN | — | No background job sweeper: build work (R26) |
| DEP-001 | CFR | ACCEPTED_DEFERRED | — | Dev-only vitest advisories; major upgrade after the showcase |
| DEP-002 | CFR | ACCEPTED_DEFERRED | — | embedded-postgres beta; prerequisites now named (TEST-003) |
| DEP-003 | CFR | OPEN | — | Owner chooses: pin `engines` to 22.x or add Node 24 to CI; regenerate B46 evidence on Linux |
| ENV-001 | C | NOT_A_BACKEND_DEFECT | — | Environment: ECR "Data limit exceeded"; Docker Hub works |
| INT-B-001 | B | BLOCKED | — | Owner: member read scope (audit §8 options a/b/c); current 404 verified EMB+LIVE |
| INT-B-002 | B | BLOCKED | — | Owner + privacy review: invite by UUID only |
| INT-B-003 | B | BLOCKED | — | Owner: `editor` write scope or rename |
| INT-B-004 | B | VERIFIED_FIXED | all | `collaboration-api-doc.test.ts` |
| INT-B-005 | B | VERIFIED_FIXED | all | `modernization.test.ts` INT-B-005; fails with old generator |
| INT-B-006 | B | VERIFIED_FIXED | all | `modernization.test.ts` INT-B-006 |
| INT-B-007 | B | VERIFIED_FIXED | all | `modernization.test.ts` INT-B-007 |
| INT-B-008 | B | OPEN | `info.version` fixed (a) | 29 untyped JSON responses remain; new untyped routes fail a test |
| INT-B-009 | B | VERIFIED_FIXED | all | `http-contract.test.ts`; failed on `6cf8050` |
| INT-B-010 | B | BLOCKED | distinct codes fixed (a) | Owner question 7: status 400 vs 413 |
| INT-B-011 | B | BLOCKED | — | Owner questions 8/10: retryable vs permanent 429 (also the catalog `retryable` column) |
| INT-B-012 | B | BLOCKED | catalog + completeness test fixed | Owner: 4 codes with two statuses (rename or re-status is breaking); `retryable` flag (INT-B-011) |
| INT-B-013 | B | VERIFIED_FIXED | all | `collaboration-retries` truncation; LIVE |
| INT-B-014 | B | BLOCKED | B44 receipts fixed (a) | Owner question 9: replay header; required key |
| INT-B-015 | B | VERIFIED_FIXED | all | `deployment-readiness` 7/7; LIVE stale secret 503 |
| INT-B-016 | B | VERIFIED_FIXED | all | `http-contract` INT-B-016; container smoke |
| INT-B-017 | B | VERIFIED_FIXED | all | `deployment-readiness`; LIVE `CURRENT` |
| INT-B-018 | B | BLOCKED | B44 `datetime({offset})` fixed (a) | Owner question 14: normalise to Z |
| INT-B-019 | B | BLOCKED | — | Owner question 5 |
| INT-B-020 | B | BLOCKED | — | Owner question 6 + retention (SUPA-004) |
| INT-B-021 | B | VERIFIED_FIXED | all | Commit fields described in OpenAPI (`modernization` INT-B-021); behaviour tests `specialists-verification`, `integration-plan` |
| INT-B-022 | B | VERIFIED_FIXED | all | `openapi.sha256` in compatibility; drift test; mutation leaves route hash unchanged; LIVE |
| INT-B-023 | B | OPEN | — | Contracts package and golden fixtures not built (OpenAPI now resolvable, reference generated) |
| INT-B-024 | B | VERIFIED_FIXED | all | LIVE 129/129 incl. every family audit B listed; CI trigger on migration changes is an owner decision |
| INT-B-025 | B | BLOCKED | checksum manifest + test fixed (a) | Operator read of a hosted ledger (content comparison) |
| INT-B-026 | B | BLOCKED | — | Review of PR #35; tags (D-11) |
| INT-B-027 | B | VERIFIED_FIXED | all | `phase44-api.md` + generated `api-reference.md` with drift test |
| INT-B-028 | B | VERIFIED_FIXED | all | `http-contract`; LIVE HEAD 200 |
| INT-B-029 | B | VERIFIED_FIXED | all | `.env.example`; lint + full suite |
| INT-B-030 | B | BLOCKED | — | Owner branch housekeeping |
| INT-B-031 | B | BLOCKED | one-time warning fixed (a) | No deployment target: per-platform runbook, staging probe |
| PHASE-001 | BCFR | BLOCKED | — | Out of scope by instruction (`main` consolidation) |
| PHASE-002 | CFR | BLOCKED | — | Review governance: #31/#33 merged with 0 reviews |
| PHASE-003 | BCFR | OPEN | — | PR #29 runbook must name `0030`–`0033` (not this task's PR) |
| PHASE-004 | BCFR | BLOCKED | — | Owner: branches |
| PHASE-005 | CFR | BLOCKED | — | Owner: tags |
| PHASE-006 | CFR | BLOCKED | — | Review governance (with SEC-007) |
| PHASE-007 | CFR | BLOCKED | B34 row 14 PASS (local) | Owner records 3 deferral decisions (`phase34-closure.md` §6) |
| PHASE-008 | CFR | OPEN | — | B31/B32/B36 gates need build work (SEC-001, DEBT-003, remote compute) |
| PHASE-009 | BC | BLOCKED | — | Owner decision on the `0030` in-place edit; recurrence prevented (INT-B-025) |
| PHASE-010 | C | ACCEPTED_DEFERRED | — | Measured cheap (PRIOR) |
| PHASE-011 | C | ACCEPTED_DEFERRED | — | Deliberate (PRIOR) |
| REL-001 | C | NOT_A_BACKEND_DEFECT | — | Closed by audit C |
| SEC-001 | BCFR | OPEN | — | No malware scan or quarantine: build work before public uploads |
| SEC-002 | CFR | ACCEPTED_DEFERRED | — | Per-process limits; single instance for the showcase |
| SEC-003 | BCFR | BLOCKED | — | Hosted Auth settings unknown (anonymous sign-ins) |
| SEC-004 | BCFR | VERIFIED_FIXED | all | §3.2 plus deterministic interleaving test (3/3; 3/3 fail without lock) |
| SEC-005 | CFR | OPEN | Actions SHA-pinned, base image digest-pinned, policy test | Move to the next Actions major; scheduled refresh (owner) |
| SEC-006 | CFR | ACCEPTED_DEFERRED | — | Informational |
| SEC-007 | CFR | BLOCKED | — | Human review of PR #35 and the merged B40–B46 code |
| SEC-008 | CF | ACCEPTED_DEFERRED | — | Informational |
| SEC-009 | C | NOT_A_BACKEND_DEFECT | — | Closed by audit C |
| SECRET-001 | CFR | NOT_A_BACKEND_DEFECT | — | No exposure; diff secret scans: 0 matches |
| SHOW-001 | CFR | BLOCKED | — | No staging environment (D-10) |
| SHOW-002 | BCFR | VERIFIED_FIXED | all | README walkthrough LIVE |
| SHOW-003 | CFR | OPEN | — | No demo-seed script |
| SHOW-004 | BCFR | BLOCKED | — | No frontend repository available |
| SUPA-001 | CFR | BLOCKED | — | Hosted ledger: credentials and authorisation (D-9) |
| SUPA-002 | BCFR | VERIFIED_FIXED | all | LIVE: B34, `0030`, B40–B45 families |
| SUPA-003 | CFR | VERIFIED_FIXED | all | `local-postgrest.test.ts`; LIVE swap v16.2→v16.3 |
| SUPA-004 | BCFR | BLOCKED | — | Owner retention decision |
| SUPA-005 | CFR | BLOCKED | — | Owner retention decision |
| SUPA-006 | BCF | VERIFIED_FIXED | all | B34 live scenario; row 14 PASS |
| TEST-001 | CFR | VERIFIED_FIXED | all | with BUG-001 (§3.1) |
| TEST-002 | CFR | OPEN | — | No single live showcase journey (J3–J9); families covered separately |
| TEST-003 | CFR | VERIFIED_FIXED | all | preflight test; 0.6 s explicit error as root |
| TEST-004 | C | VERIFIED_FIXED | all | Deterministic two-transaction test for all three caps |
| TEST-005 | BC | VERIFIED_FIXED | all | PR #34 live scenario run (LIVE) |

`*` partial: a part is fixed and verified (column "Repaired part" below); the status is that of the remainder.

### 2.1 Corrections to r1

| r1 said | Wrong because | r2 |
|---|---|---|
| 32 + 16 + 26 + 10 + 5 = **89** "findings" | It counted **items**, not IDs. Split IDs were counted twice: PHASE-007 as VERIFIED_FIXED (row 14) **and** BLOCKED (decisions); INT-B-008/-010/-014/-018/-024/-025/-027/-031 as an `a` row and a `b` row. SUPA-002/006 were VERIFIED for some rows while their remainder sat under INT-B-024b. SEC-007/PHASE-002/PHASE-006 were one item for three IDs | **83** IDs, one status each (above) |
| INT-B-012, -021, -022, -024b, -027b, SEC-005, TEST-004 residual: OPEN | Repaired in session 2 (§6.2) | per the register |
| "An upgrade of a populated database: the constraint re-check validates existing rows" (§5) | It was reasoning, not a test | Now tested (§5) |

### 2.2 Gaps without an ID, found or closed in session 2

| Item | Status | Evidence |
|---|---|---|
| **REPAIR-001** (new; in neither audit): `openapi.json` had **1,007 of 2,754 `$ref`s pointing nowhere** on the base branch (e.g. `#/components/properties/projectId`), and 9 Zod tuples as `items: [...]`, invalid in OpenAPI 3.0. Any OpenAPI client generator fails on it | VERIFIED_FIXED | `test-support/openapi.ts`: only shared components are referenced; other repeats inline; tuples → `items: { anyOf }` with min/maxItems. Now 251 refs, 0 dangling, 0 tuples. Test walks every `$ref`; **reverting to the old strategy fails it** (RAN) |
| Audit B T5 / P2-5: no upgrade test from a populated database | VERIFIED_FIXED | `migration-upgrade.integration.test.ts` (§5) |

**Verdict.** On `715eba9` the backend builds, typechecks and lints. The full embedded suite passes (135 files, 3,219 tests), and live local Supabase acceptance passes 129/129, now covering every route family audit B found with no live call. Of 83 finding IDs, 28 are VERIFIED_FIXED; the 11 OPEN are build work, and the 29 BLOCKED need an owner decision, external access or a human review. **The backend is not fully verified:** PR #35 is unreviewed, and hosted migrations, hosted Auth and staging are unknown (§10).

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
| Review cap (TEST-004, from PR #34) | with the lock: passes; review-only scratch copy without the lock: **failed 1 of 2** runs (7 for 5). The review part alone is probabilistic, although the combined test fails every time because of its other parts (made deterministic in session 2, §6.2) |
| After `0033` re-created `collaboration_write` | lock carried over unchanged. Removed from `0033` → the cap test **and** the new same-key burst test fail 2/2; restored → pass |
| `0030` deployment state | Still unknown (no hosted access). It was edited in place before merge (PHASE-009); the new checksum manifest (INT-B-025) prevents a repeat |
---

## 4. Verification gates

### 4.1 Session 2 (final head)

| # | Gate | Command (as `ubuntu`, `en_US.UTF-8`) | Tree | Exit | Result |
|---|---|---|---|---|---|
| 1 | Focused regressions | per repair (§6.2), each also shown to fail on the unfixed code or a mutation | per commit | 0 | all pass |
| 2 | Affected suites | `modernization`, `delivery.integration`, `http-contract`, `specialists-verification.integration`, `integration-plan.integration`, `collaboration-cap-interleaving.integration`, `migration-upgrade.integration`, `supply-chain-pins` | per commit | 0 | pass |
| 3 | Build | `npm run build` | `7b31847` | 0 | — |
| 4 | Typecheck | `npm run typecheck` | `7b31847` | 0 | includes the browser typecheck |
| 5 | Lint | `npm run lint` | `7b31847` | 0 | — |
| 6 | **Full suite** | `npx vitest run` | `7b31847` | **0** | **135 files, 3,219/3,219 passed, 0 failed, 0 skipped** (831.2 s). The only later change (`715eba9`) is the live test file, which the default config excludes (`vitest.config.ts:4`) and gate 7 runs, plus docs; typecheck and lint re-run on `715eba9`: exit 0 |
| 7 | **Local Supabase acceptance** | `supabase start` → `supabase db reset --local` → `node scripts/ensure-local-postgrest.mjs` → `npm run test:supabase` | baseline `6a7892e`; then `7b31847`; then `715eba9` | 0 | baseline **127/127**; with the new scenarios **129/129** (receipt `supabase-2026-10-19T10-40-59.648Z.json`); final `715eba9` **129/129**, 229.5 s (receipt `supabase-2026-10-19T11-05-07.796Z.json`; its recorded "failures" are the suite's deliberate refusal probes; 0 secrets) |
| 8 | Container | pinned-base `docker build` (session CA overlay on the build stage only) + `scripts/smoke-container.mjs` | `6a7892e` | 0 | build 0; smoke 3/3 (after L-25) |
| 9 | Migration history | contiguity, additions-only vs base, checksums (§5) | final head | 0 | pass |
| 10 | Overlap | `git merge-tree` with #36 and #37 | final head | 0 | 0 conflicts each |
| 11 | **CI on PR #35** | GitHub Actions | `715eba9` | **0** | run **39242772430**: backend (Node 22.22.0) **135 files, 3,219/3,219 passed** (774.9 s); backend (Node 22.23.3) success; **container smoke success** (first run on the SHA-pinned Actions and the digest-pinned base); `supabase-acceptance` skipped (dispatch only). GitHub warns that the pinned `v4.4.0` Actions target deprecated Node 20 (SEC-005 remainder). PR `mergeable_state: clean` |
| 12 | Hosted ledger, hosted Auth, staging | — | — | — | **BLOCKED**: no credentials or authorisation |
| 13 | Diff review | `git diff 8e7b536 HEAD`; secret-pattern scan | final head | — | 0 secret matches in added lines; no `.env`, log or scratch file tracked; `.env` (temporary, git-ignored) deleted; Supabase stack and Docker daemon stopped |

### 4.2 Session 1 (unchanged)

| # | Gate | Tree | Result |
|---|---|---|---|
| 7 | Full suite | `7e352e3` | 131 files, 3,203/3,203 |
| 9 | Local Supabase acceptance | `3f2e588` | 127/127 |
| 11 | CI run 39212211328 | `d35a5da` | container smoke failed (L-22) |
| 11b | CI run 39213021503 | `8e7b536` | backend 22.22.0: 132 files, 3,206/3,206; 22.23.3: success; container smoke: success |

---

## 5. Supabase and migrations

| Level | What it proves | Result |
|---|---|---|
| 1. Unit | pure logic | PASS (gate 6) |
| 2. Embedded PostgreSQL 18 | SQL, RLS, RPCs; every migration `0001`–`0033` from empty; **`0031`–`0033` on a populated `0030` database** | PASS |
| 3. **Local Supabase** (Postgres 17.6.1.167, GoTrue v2.196.0, PostgREST v16.3, CLI 2.117.0) | the production adapter, PostgREST grants, name-based RPC resolution, real Auth | **PASS** (gate 7). Now every route family audit B listed as never run live |
| 4. Hosted read-only ledger | what hosted has | **BLOCKED** (SUPA-001). Last reported at `0017` (PRIOR). **Unknown** |
| 5. Hosted or staging end-to-end | deployed behaviour | **BLOCKED** (SHOW-001) |

**Migration history (RAN on the final head).**

| Check | Result |
|---|---|
| Files | `0001`–`0033`, contiguous, one file per number |
| Changes vs `phase31/development` | **added only**: `0031_quota_integrity.sql` (PR #34), `0032_deployment_readiness.sql`, `0033_collaboration_retries.sql`, `supabase/migrations.sha256`. No existing migration is modified |
| Checksums | `sha256sum -c supabase/migrations.sha256` → all match; the ledger test fails on a 1-line edit to `0030` |
| Populated upgrade | §6.2 T5 |
| Deployment order | `0030` (if absent) → `0031` → `0032` → `0033` → API. `/health/ready` stays 503 until `schema_version()` = 33 |

**Forward-migration safety.** `0030` is on the integrated line and possibly applied somewhere, so it was not edited; its repairs are in `0033`. No table or column is dropped. `0033` drops only the old `collaboration_write(text,jsonb,text,text)` overload: two overloads would make PostgREST name resolution ambiguous, and 4-argument named calls still resolve to the new function.

**Environment.** ECR still answers "Data limit exceeded" (ENV-001); the stack uses `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`. The storage container once failed `supabase start`'s health wait and was healthy moments later (L-26).
---

## 6. Repair records

The status of each finding is the one in §2. This section records how each repaired part was reproduced, fixed and tested. The status column of §6.1 is the status of the **part** in that row.

Columns: **ID** · **Src** (B = audit B; C = audit C; E = earlier report or follow-up, re-statused by C) · **Part status** · **Reproduction (before)** · **Root cause** · **Repair and files** · **Regression test → result** · **Commit** · **Remaining**.

### 6.1 Session 1

| ID | Src | Part status | Reproduction (before) | Root cause | Repair (files) | Regression test → result | Commit | Remaining |
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
| BUG-001, TEST-001 | E | VERIFIED_FIXED (on `7d57b03`) | — | — | PR #33 | §3.1 | `7d57b03` | — |
| SEC-004 | E | VERIFIED_FIXED (on `7d57b03`, and in `0033`) | — | — | PR #31 | §3.2 | `a752f81` | — |
| DB-001, DB-002 | C | VERIFIED_FIXED | — | — | PR #34 `0031` | `account-quota-integrity.integration.test.ts` 6/6; **6/6 failed in 2/2 runs** with `0031` removed | `6cf8050` | — |
| API-001 | C | VERIFIED_FIXED | — | — | PR #34 docs | 429 on retry documented (`phase32-api.md`, `phase33-api.md`) and tested | `6cf8050` | — |

### 6.2 Session 2

| ID | Src | Part status | Reproduction (before) | Root cause | Repair (files) | Regression test → result | Commit | Remaining |
|---|---|---|---|---|---|---|---|---|
| **TEST-004** / SEC-004 residual: cap race detected only probabilistically | C | VERIFIED_FIXED | review-cap race caught in 1 of 2 runs (r1 L-5) | concurrent HTTP requests, timing-dependent | `collaboration-cap-interleaving.integration.test.ts`: transaction A writes at cap − 1 through the **signed** `collaboration_write` and stays open; B writes; A commits once B waits on a lock (`pg_stat_activity`) or finishes | comments 199→200, members 19→20, reviews 99→100: **3/3 pass; with the lock line removed from `0033`, 3/3 tests fail in 3/3 runs** (B inserts) | `88edfd9` | — |
| **T5 / P2-5** populated upgrade | B | VERIFIED_FIXED | no test applied `0031`–`0033` to existing rows | every suite starts from an empty schema | `migration-upgrade.integration.test.ts`: a `0030` database with B44 rows written by the **old 4-argument** `collaboration_write` and an idempotency receipt for every operation the `0030` constraint allows; then `0031`–`0033`, one transaction each | rows byte-identical (`to_jsonb` snapshot), `schema_version()` 33, exactly one `collaboration_write(text,jsonb,text,text,jsonb)` executable by `authenticated` only, API serves old rows and the keyed retry → **3/3**. Mutations: dropping `/api/plans` from the `0033` list → upgrade fails (check violated); keeping the old overload → fails | `4f003de` | Hosted data may contain rows these fixtures do not |
| **INT-B-022** schema drift invisible | B | VERIFIED_FIXED | the compatibility hash covers sorted "METHOD /path" only | — | `GET /api/compatibility` adds `openapi.sha256` (generated constant `delivery/openapi-hash.ts`, written with `openapi.json`) | test pins the constant to the checked-in document and the live response. **Mutation:** one response field `max(200)→max(201)` leaves `routeCatalog.sha256` unchanged (delivery test passes) and fails the drift tests. LIVE: response carries the hash | `f8fadf1`, `715eba9` | — |
| **INT-B-012** no error-code catalog | B | VERIFIED_FIXED (catalog part) | `ApiErrorResponse.code` free string; OpenAPI `default` only | — | `test-support/error-catalog.ts` derives codes with the **TypeScript checker**: every `new ApiError(status, code)` (inside `instanceof XError` the checker narrows `error.code` to XError's code union), per-code ternaries and `STATUS[...]` maps, every SQLSTATE table. `docs/modernization/error-codes.json` (**289 codes**), embedded in OpenAPI as `components.x-error-codes` | completeness test (closure T36): source ≡ catalog. **Mutation:** giving `BIM_SOURCE_MISMATCH` a 409 in `bim-service.ts` fails it. 2 sites are listed as unresolvable, with reasons: Fastify's own 4xx (`INVALID_REQUEST`) and worker refusal codes typed `string` | `c1dcb09` | Owner: `SCENE_SOURCE_MISMATCH` 409/422, `TAKEOFF_FAILED` and `COST_CALCULATION_FAILED` 422/500, `REQUEST_CANCELLED` 408/503; a `retryable` flag (INT-B-011) |
| **INT-B-021** FAILED after commit | B | VERIFIED_FIXED | behaviour already right and tested (`written: true`, `resultRevisionId` = current; `committedRevisionId`); the contract said nothing | documentation of the contract | `.describe()` on `resultRevisionId`, `written`, `status` (specialists) and `committedRevisionId` (integration); 200/201 descriptions say what each means | `modernization.test.ts` INT-B-021 reads them from the generated OpenAPI; behaviour: `specialists-verification`, `integration-plan` (full suite) | `1fdc6c9` | No `committed: boolean` added: the existing fields are explicit; adding one is an owner option |
| **REPAIR-001** dangling `$ref`s, tuples | new | VERIFIED_FIXED | RAN: base `openapi.json` 1,007/2,754 refs unresolvable | `zod-to-json-schema` `root` strategy referenced a repeat by its root path, but operation schemas are inlined under `paths` | `$refStrategy: 'none'` + an `override` that references only `#/components/schemas/<Name>`; recursive JSON values `{}`; `openApi30()` tuple normalisation. Document 2.0 → 2.9 MB | `modernization.test.ts`: 0 dangling, 0 tuples. **Reverting to `root` fails it** | `1fdc6c9`, `69c700e` | — |
| **INT-B-027** (b) API documents for B37, B38, B40–B43, B45 | B | VERIFIED_FIXED | none existed | — | `docs/modernization/api-reference.md`, rendered from `openapi.json` (auth, parameters, request fields, each status with its description, top-level response fields) | drift test; every catalog route present; one route of each undocumented phase present | `69c700e` | Hand-written per-phase behaviour notes still exist only up to B39 and B44 |
| **INT-B-024** (b) / **SUPA-002** remaining live coverage | B, E | VERIFIED_FIXED | live suite had 0 calls for the families audit B listed | — | two live scenarios: B31 upload, content and **anonymous signed download** (forged token 404), B33 settings (stale version 409) and library, brief versions, context, B38 documents (each `href` hashes to its `contentHash`), B37 graph, B35 assessment, B45 scene compile, delivery with **304 revalidation** and compatibility, B42 feasibility, B43 routing, conversation turn (deterministic), B41 instruction resolution. Each checks another user gets 404 (references: also no rows via the SDK). Cleanup keeps B31 projects (references are tombstones) | **LIVE 129/129 (`7b31847`, then `715eba9`)** | `7b31847`, `715eba9` | CI runs `supabase-acceptance` only on dispatch (owner) |
| **SEC-005** unpinned Actions and base image | E | VERIFIED_FIXED (pin part) | `actions/checkout@v4`, `actions/setup-node@v4`, `FROM node:22-bookworm-slim` | movable tags | SHA pins to the commits `v4` resolves to today (`git ls-remote`: both `v4.4.0`), so CI runs the same code; base pinned to the current index digest from Docker Hub | `supply-chain-pins.test.ts` fails on the old files, passes now. Pinned image built locally and **smoke-tested 3/3** (L-25) | `6a7892e` | Next Actions major; scheduled refresh (Dependabot or Renovate opens PRs itself: owner) |

---

## 7. Failed-test ledger

Every failure observed in either session. None was deleted, skipped or weakened. Reproductions (R) are intended failures of unfixed or mutated code.

| # | Command (tree) | Result | Class | Disposition → retest |
|---|---|---|---|---|
| L-1 | `npm ci` as `ubuntu` | `SELF_SIGNED_CERT_IN_CHAIN` | Environment (proxy CA under `/root` unreadable) | Install as root, build and test as `ubuntu` |
| L-2 | BUG-001 built server with the old `flushSentry` | exit 1, `SHUTDOWN_FAILED` | R | Restored → exit 0 (§3.1) |
| L-3 | SEC-004 test, lock removed (`7d57b03`) | 3/3 failed | R (sensitivity) | Restored → 3/3 pass |
| L-4 | DB-001/002 tests, `0031` removed | 6/6 failed ×2 | R | Restored → 6/6 |
| L-5 | Review-cap-only scratch, lock removed | 1 of 2 failed | R; probabilistic | Superseded by the deterministic test (§6.2); scratch deleted |
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
| L-24 | Session-2 reproductions and mutations: cap test without the lock (3/3 fail ×3); upgrade test with a narrowed constraint and with the old overload kept; `modernization` before regeneration (schema drift, placeholder hash), with a widened field, with the old `$ref` strategy; error catalog with a re-statused code; pin test on the old workflow and Dockerfile | all failed as intended | R (sensitivity) | Restored → pass |
| L-25 | `scripts/smoke-container.mjs` on the pinned image, twice: once while `supabase start` ran in parallel, once right after the Docker daemon restarted | "Production container smoke test failed" | **Environment (load)**, not the pin. By hand every step passed (liveness 200, readiness 503, uid 1000, SIGTERM exit 0); the committed script then passed **3/3**, and both images passed a copy that prints the swallowed error | Not changed: the script allows about 5 s for liveness; no failure reproduced on an idle host. If CI ever shows it, widen the window |
| L-26 | `supabase start` | `supabase_storage_designflow … unhealthy` (health-wait timeout), twice | Environment (slow start) | `--ignore-health-check`: storage reported healthy seconds later; the stack then passed |
| L-27 | `npm run test:supabase` as `ubuntu` after a daemon restart | "Local Supabase acceptance setup failed" | Environment: `ubuntu` was not in the `docker` group | `usermod -aG docker ubuntu` (ephemeral container) → 127/127 |
| L-28 | Live suite with the new scenarios | 129/129 tests, then afterAll "cleanup failed: delete test projects" | Test defect: B31 references are tombstones (`reference_guard`) | Cleanup keeps those projects, as it does for B44 → 129/129, exit 0 |
| L-29 | `INT-B-021` test, first version | `Cannot read properties of undefined (reading 'split')` | Test defect: response schemas are inline, not `$ref`s | Reads inline properties → pass |
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
| `88edfd9` | Session 2: deterministic B44 cap interleaving (TEST-004) |
| `4f003de` | Populated `0030` → `0033` upgrade test (T5) |
| `f8fadf1` | INT-B-022 OpenAPI hash in compatibility |
| `c1dcb09` | INT-B-012 generated error-code catalog |
| `1fdc6c9` | REPAIR-001 resolvable `$ref`s; INT-B-021 contract descriptions |
| `69c700e` | INT-B-027 generated API reference; OpenAPI 3.0 tuples |
| `6a7892e` | SEC-005 SHA and digest pins |
| `7b31847` | INT-B-024 live scenarios; receipt |
| `715eba9` | Live compatibility-hash check; final receipt; risk register r4 addendum (R03, R04, R26, R28) |

Session 1 rebuilt two **local, never-pushed** commits (`b6174ea`, `de5f0a5`) before pushing; nothing pushed or shared was rewritten in either session. All session-2 commits are plain pushes on top of `8e7b536`.

---

## 9. Remaining risks

- **Hosted state is unknown.** Applying `0018`–`0033` to a hosted project has never been rehearsed against its real data; the populated-upgrade test uses fixtures.
- The live receipts are from a local CLI stack (Docker Hub images), not hosted Supabase; CI does not run them on PRs.
- B40–B46 reached the code line without review (SEC-007); PR #35 is also unreviewed.
- `/api/capabilities` and `schema_version()` reveal schema level and write availability anonymously (low sensitivity).
- The container smoke allows about 5 s for liveness (L-25).
- `openapi.json` is 2.9 MB because repeated sub-schemas are now inlined (REPAIR-001); a generator that wants smaller output needs more named components.

---

## 10. Required from people

| Need | Who | Unblocks |
|---|---|---|
| Review PR #35; merge #34 then #35, or #35 alone and close #34 as included (§1.1) | Reviewer / owner | SEC-007, PHASE-002/006, INT-B-026 |
| Before deploying #35: apply `0030`–`0033` first; set production `CORS_ORIGINS` (or `none`); re-provision `PROJECT_COMMIT_SECRET` if the DB key differs | Operator | INT-B-015/016/017 rollout |
| Read-only hosted ledger (`scripts/verify-hosted-migrations.mjs`), then the hosted migration plan for `0018`–`0033` | Operator / owner | SUPA-001, INT-B-025, PHASE-009, R03 |
| `workflow_dispatch` of `supabase-acceptance` on `fix/audit-b-repairs`; decide whether it runs on migration and adapter changes | Owner | CI evidence for INT-B-024 / SUPA-002 |
| Hosted Auth settings (anonymous sign-ins, confirmations) | Owner | SEC-003 |
| Decisions: INT-B-001, -002, -003, -010, -011 (and the catalog `retryable` column), -012 (the 4 two-status codes), -014, -018, -019, -020 (with SUPA-004/005), AUD-002, B34 deferrals (PHASE-007), PHASE-004/005, INT-B-030 | Owner | §2 BLOCKED |
| Actions major upgrade and a refresh bot (SEC-005); `engines` or Node 24 (DEP-003) | Owner | SEC-005, DEP-003 |
| Staging environment; tags D-10/D-11 | Owner / operator | SHOW-001, INT-B-026 |
| Frontend repository or contract consumers | Frontend team | SHOW-004, INT-B-023 |
| Build work: malware scan and quarantine (SEC-001), job sweeper (DEBT-003), contracts package and golden fixtures (INT-B-023), runtime schemas for the 29 untyped responses (INT-B-008), live showcase journey (TEST-002), demo seed (SHOW-003), docs index (DEBT-002), PR #29 runbook (PHASE-003) | Backend team | §2 OPEN |

## 11. Frontend coordination (no frontend code was changed)

1. Treat 503 `COMMIT_ATTESTATION_UNAVAILABLE` as "server misconfigured, try later", not "permission denied".
2. Read `GET /api/capabilities` → `deployment`; hide write features when `writes` is `UNAVAILABLE` or `schema.status` is not `CURRENT`.
3. Upload and body errors: branch on `PAYLOAD_TOO_LARGE` and `UNSUPPORTED_MEDIA_TYPE` (status still 400).
4. 429: back off using `Retry-After` (`RATE_LIMITED` only). A 429 without it is a quota: do not auto-retry.
5. Send `Idempotency-Key` on B44 comment, review and member removal; reuse a key only for a retry of the same request.
6. B44 workspace: show "more revisions exist" when `revisionsTruncated`.
7. Regenerate clients from `docs/modernization/openapi.json`: every `$ref` now resolves and it is valid OpenAPI 3.0. The error codes and their statuses are in `components.x-error-codes` and `error-codes.json`; a readable rendering is `api-reference.md`.
8. Pin `GET /api/compatibility` → `openapi.sha256` (sha256 of `openapi.json`) to detect any schema change, not only route changes.
9. After a specialist or integration result, refresh the current revision whenever `resultRevisionId` or `committedRevisionId` is non-null, **even when `status` is FAILED**; `written` says whether a specialist stored anything.
10. Timestamps are RFC 3339 with an offset (`+00:00`). Give the operator the production origins for `CORS_ORIGINS`. Keep the reviewer UI frozen until INT-B-001/002/003 are decided.

## 12. Single safest next step

**A human review of PR #35** (it contains #34 unchanged): nothing in it is on the code line until then, and the B40–B46 code it builds on has not been reviewed either. After that, and before any hosted migration, the operator's **read-only** hosted ledger check (`scripts/verify-hosted-migrations.mjs`). It changes nothing, and it is the only way to learn what hosted actually contains.
