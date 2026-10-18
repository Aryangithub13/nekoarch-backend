# NekoArch backend: comprehensive audit, repair, retest and phase synchronization

| | |
|---|---|
| **Date** | 2026-10-18 (session 16:28–19:30 UTC) |
| **Repository** | `Aryangithub13/nekoarch-backend` |
| **Code audited** | `phase31/development` @ `6bd84a5` (default branch), and an **integration tree**: that commit with every open PR merged (#33 BUG-001, #31 B40–B46, #29 B39 gates) plus this audit's repairs (#34) |
| **Repairs delivered** | Draft PR [#34](https://github.com/Aryangithub13/nekoarch-backend/pull/34) `fix/audit-2026-10-18-repairs`, stacked on PR #31 (base `phase40/selective-revision-orchestration` @ `479b2bc`) |
| **Earlier records** | [`BACKEND_AUDIT_REPORT.md`](BACKEND_AUDIT_REPORT.md) (pre-repair audit) and [`BACKEND_AUDIT_FOLLOWUP_2026-10-18.md`](BACKEND_AUDIT_FOLLOWUP_2026-10-18.md) are **preserved unchanged**. This document extends them; it does not replace their evidence |
| **Not done** | No merge, rebase, force-push, tag, release, deployment, hosted migration or hosted access. PRs #29, #31 and #33 are unchanged |

**Evidence labels:** **RAN** executed in this session (command in §13) · **CI** GitHub Actions run, ID given · **CODE** read at the cited file and line · **DOC** stated in a repository document, not re-executed · **GH** live GitHub API in this session · **PRIOR** established by the earlier audit or follow-up and not re-executed here.

---

## 1. Executive summary

**Verdict: NOT READY for a showcase.** For **frontend integration**, the integrated line is **READY** with explicit limitations; the B40–B46 line is **NOT READY** until it is reviewed and has a live run (§17).

**What is healthy (RAN).** All three open PRs and this audit's repairs compose without conflicts. On that combined tree, build, typecheck and lint pass, and the full suite passes: **127 files, 3,176/3,176 tests**. Production dependencies have 0 advisories. All 165 route handlers authenticate (154 require a session; the 11 that don't are public by design). B40 commits revisions only through the existing Phase 30 QA, compare-and-swap and signed-RPC path, with no bypass.

**What this session found and repaired.**

| ID | Sev | Finding | State |
|---|---|---|---|
| **DB-001** | Low | The B33 owner-wide quotas (200 projects, 8 active jobs, 1 GiB of references) could be exceeded by concurrent writes. Through the API, 20 concurrent creates at 195 projects stored **205**. Same class as SEC-004, in another phase | **VERIFIED_FIXED on PR #34**: the regression tests fail without the fix and pass with it, locally and in CI run 39156993823. Not yet on the integrated line |
| **DB-002** | Medium | A job **retry** bypassed both active-job limits (B32: 4 per project; B33: 8 per owner). This contradicts the schema's own claim, "no RPC path can bypass them" (`0023:45`) | same |
| **TEST-004** | Low | The SEC-004 regression test did not cover the third cap behind the same lock, 100 reviews per revision. Without the lock, 102 and 103 were stored | Coverage added (PR #34) |
| **TEST-005** | High (gap) | No live Supabase scenario existed for B34, B40 or `0030` (SUPA-002/SUPA-006) | Scenario **written** (PR #34) and dry-run on embedded PostgreSQL; **not run live**: dispatching the workflow returned **403** to this session |

**Re-verified from earlier work.**
- **BUG-001** (PR #33): exit **1** reproduced on the base (2/2 runs), exit **0** with the fix (2/2).
- **SEC-004** (PR #31, `479b2bc`): with the lock 5/5 runs pass; without it 3/3 fail (23 and 22 members against a cap of 20; 204 comments against 200).
- **Neither repair is on the integrated line**: #33 and #31 are unmerged and have **0 reviews**.

**Still blocking a showcase.**
1. No live Supabase run covers `0030`, `0031`, B34 or B40–B46. This session cannot dispatch the CI workflow (403), and no container registry is reachable from it.
2. The hosted migration ledger is unknown (last reported at `0017`).
3. No staging proof exists for any phase after B30.
4. PR #31 (+15,844/−5,303 lines) is unreviewed.
5. No setup README exists on the code line.
6. B31, B32, B34 and B36 acceptance gates are unmet.

**Shortest safe route:** §16.

**Totals this session:** 15 findings opened (§6). 3 defects reproduced and repaired with regression tests (DB-001, DB-002, TEST-004). Severity of the new findings: High 1 (a test gap) · Medium 1 · Low 3 · Informational 10. The 37 earlier findings are re-statused in §6.2.

---

## 2. Repository and branch baseline

### 2.1 State at the start of the session (RAN, GH)

| Item | Value |
|---|---|
| Working checkout | `/home/user/nekoarch-backend`, branch `main` @ `dd6e469` ("Initial commit"), clean, **stale** (remote `main` was 11 commits ahead). Fast-forwarded to `58a19e8` before this document was written |
| Default branch (`HEAD`) | **`phase31/development` @ `6bd84a5`** (merge of PR #27, B34 repair, 2026-10-17). 178 commits. This is where the code lives |
| `main` | `58a19e8` (merge of PR #32). Docs only (README + `docs/`). **No common ancestor** with the code line (PHASE-001) |
| Branches / tags | 49 remote branches at the start (50 with this session's repair branch); 29 tags, newest `backend-v1-phase30-complete`. **No tag for B31–B46** |
| Open PRs | **#33** draft, BUG-001, head `b3f0837` → `phase31/development`, CI green (run 39140096759), 0 reviews. **#31** B40 S1+S2 and B41–B46 S1 + SEC-004, head `479b2bc` → `phase31/development`, mergeable clean, CI green (run 39143637924), **0 reviews, no description**. **#29** draft, B39 release gates, head `c155d5a`, stale base `287b1a4` |
| Concurrent work | No new branch, push or PR since the follow-up, other than this session's own. Remote heads were re-checked before the push: unchanged |
| Toolchain | Node 22.22.0, npm 10.9.4, psql present. **Docker:** see §2.2 |

### 2.2 Infrastructure available to this session (RAN)

| Capability | Result |
|---|---|
| Docker daemon | **Starts** (`dockerd` 29.8.2, overlayfs). Earlier sessions recorded "no daemon"; it was never started |
| Container registries | **All blocked.** `public.ecr.aws`: "Data limit exceeded". Docker Hub: HTTP 429. `ghcr.io`: manifest resolves, blob CDN 403. `quay.io`: 403. So **no Supabase stack can start here** |
| GitHub Actions dispatch | **403 "Resource not accessible by integration"** for `backend-ci.yml` `workflow_dispatch`. This session cannot trigger the `supabase-acceptance` job |
| Embedded PostgreSQL | Works, as a non-root user (`ubuntu`) with an `en_US.UTF-8` locale compiled by `localedef` (prerequisites F-1/F-2 of the earlier audit) |
| Hosted Supabase / staging | No credentials; not touched (and not authorised) |

The daemon was stopped after the registry checks.

### 2.3 Trees used

| Tree | Composition | Tree hash / head |
|---|---|---|
| `base` | `6bd84a5` | — |
| `int` (run 1) | `6bd84a5` + #33 + #31 + #29, merged in that order, **no conflicts** | tree `567ff3d` |
| `int` (run 2) | run 1 + `fix/audit-2026-10-18-repairs` | merge `2fc720b` |
| `fix` | `479b2bc` + 4 repair commits (`c963b2a`, `5fd129a`, `137fca0`, `91118ac`) | pushed; PR #34 |

All scratch trees were outside the repository. The working checkout was changed only to add this file.

---

## 3. Scope and limitations

**In scope and executed:**
- route-by-route authentication inventory (all 165);
- a SQL sweep of every count- or sum-based cap and its serialization, in all 31 migrations;
- the transition paths that can bypass insert-only guards;
- B40 commit-path review (`integration-service.ts`, all 291 lines);
- `0030` review (all 183 lines);
- B41–B45 handlers;
- rate-limit grouping against the generator of every POST route;
- lifecycle (BUG-001), CPU-cost and regex-backtracking probes;
- the phase roadmap against implementation, migrations, tests and records;
- full suites on the integration tree.

**Not executed, and why:**
- any live Supabase, GoTrue, PostgREST, container build or hosted run (§2.2);
- frontend comparison (no frontend source in scope);
- branch protection, Dependabot and secret-scanning alerts (not exposed);
- a full-history secret re-scan (the earlier all-refs scan stands; this session scanned only its own diff: 0 matches).

**Not claimed:** exhaustive line-by-line review of all ~31k lines. Static review was risk-directed: authorisation, integrity, concurrency, lifecycle and cross-phase seams. B05–B28 were not re-audited; their tags and green suites were accepted.

---

## 4. Architecture and subsystem inventory

| Aspect | Current fact | Evidence |
|---|---|---|
| Runtime / build | Node `>=22`, TypeScript 5.9 ESM, npm workspaces: `apps/api` + 6 packages | CODE `package.json` |
| API | Fastify 5, Zod, Pino, Sentry (opt-in), helmet, CORS allow-list, `@fastify/rate-limit` (in-process) | CODE `app.ts`, `http-protection.ts` |
| Routes | **165** (catalog `docs/modernization/api-routes.json`). 154 return 401 without a token. **Public by design:** `/api/capabilities`, `/health/*`, `GET /api/plans/:id`, `/api/regions`, `…/public`, `/api/reference-downloads`. Five legacy POST/PATCH routes return 400 before 401 (API-002) | RAN catalog analysis; CODE every `routes/*.ts` (handler count = `requestContext` count, except the static `/api/capabilities`) |
| Data access | Anon key + the caller's JWT per request. Writes go through signed `SECURITY DEFINER` RPCs (HMAC envelope). The API never holds the service role | PRIOR; CODE `lib/supabase.ts` |
| Database | Supabase Postgres. Migrations `0001`–`0029` integrated, `0030` (PR #31), `0031` (PR #34). 42 public tables with RLS (static, PRIOR) | CODE |
| Background work | In-process worker pools and a lease-based durable-job runner; no sweeper (DEBT-003) | CODE `jobs/runner.ts` |
| Tests | 127 files with the repairs: unit, embedded-PostgreSQL integration (real RLS, minimal `auth` schema), migration replay, live suite (excluded; 13 scenarios with PR #34) | RAN |
| CI | `backend-ci.yml`: build/type/lint/audit/full vitest on Node 22.22.0 and 22.23.3; container smoke; `supabase-acceptance` only on `workflow_dispatch` | CODE |

---

## 5. Phase-by-phase status matrix

Classifications: **IV** implemented and verified · **IT** implemented but incompletely tested · **IA** implemented but not accepted · **PI** partially implemented · **DO** documented only · **BX** blocked by external access · **SU** superseded · **UN** unknown.

| Phase | Required capability (roadmap) | Implemented behaviour | API contract | Migration deps | Tests | Acceptance evidence | Conflicts / dependencies | Status | Required action |
|---|---|---|---|---|---|---|---|---|---|
| B01–B04 | Monorepo, geometry, walls, topology | History starts at the B05 tag | — | — | in the package suites | none (no commit or tag) | — | **UN** | None; historical |
| B05–B28 | Persistence → optimisation | Tagged `backend-v1-phase5…28-complete` | in the catalog and OpenAPI | `0001`–`0018` | green (RAN, int) | tags; live receipt ≤ `0029` on `c343855`, 2026-10-14 (DOC) | — | **IV** (historical; not re-audited) | — |
| B29 | 3D scene and walkthrough | GLB only; renders, 360°, walkthrough paths, LOD not built | scene routes | `0019` | green | tag | B45 builds on it | **PI** | Owner scope decision |
| B30 | Selective revision | Phase 30 operations, CAS commit, interior finishes (`0029`) | revision-operation routes | `0020`, `0029` | green | tag; live (≤ `0029`) | B40 commits only through it (verified, §9) | **IV** | — |
| B31 | Secure reference ingestion | Upload, inspection, signed download | references routes | `0021`, `0024` | green | none for the gate | **SEC-001**: no malware scan or quarantine; roadmap gate requires both | **PI** | Build scanner + `QUARANTINED` state |
| B32 | Durable jobs | Jobs, leases, retries, recovery | jobs routes; **retry contract extended (API-001)** | `0022` | green + **DB-002 tests (PR #34)** | none for the gate (kill-worker recovery) | **DB-002** (retry bypassed the limits; fixed in PR #34); no sweeper, `ProviderCharge` or SSE | **PI** | Merge PR #34; sweeper (DEBT-003) |
| B33 | Account, library, settings | Library, settings, briefs, usage, quotas | account routes | `0023` | green + **DB-001 tests (PR #34)** | none | **DB-001** (quota race; fixed in PR #34); erasure policy (SUPA-004/005) | **IA** | Merge PR #34; owner erasure decision |
| **B34** | Complex building verification | Independent verification + scoped diff (repair merged in PR #27) | 3 routes | none | green; **live scenario written (PR #34), not run** | closure §6 "None recorded yet" (CODE `phase34-closure.md:69`); 4 FAIL, 1 NOT VERIFIED in its matrix (PRIOR) | Runs inside B40 S2 as an analysis branch | **IA** | Owner decisions on the 3 deferrals; run the live scenario |
| B35 / 35.1 | Supertall engineering | Deterministic assessment; typed blockers | engineering routes | none | green | none | — | **PI** | — |
| B36 | Cloud compute gateway | Local pool only; `remoteExecution: DISABLED` | compute routes | `0025`, `0026` | green | none | Owner decisions D1–D7 | **PI** | Owner decisions |
| B37 | Unified model + dependency graph | Manifest v2, whole-model freshness | manifest routes | none | green | D-9/D-10 open | B40 relies on whole-model invalidation | **IA** (waivers) | D-9/D-10 |
| B38 | Construction documents and evidence | SVG/CSV, signed evidence packages | evidence/documents routes | `0027` | green | live (≤ `0029`) | — | **PI** (no PDF/DXF) | — |
| B39 | Six specialist workflows | All six; typed refusals | specialists route | `0028`, `0029` | green | live S1–S3 (DOC); D-10 staging in PR #29 | **PR #29 runbook stale** (PHASE-003) | **IA** | Refresh PR #29 for `0030`/`0031` |
| B40 | Large-scale integration | S1 change-set plans + checkpointed regeneration; S2 analysis branches, task budgets | 2 routes | none | green (12 new files in PR #31) | **live scenario written (PR #34), not run** | Needs PR #31 merged; B34, B37, B30 | **PI** (pending PR) | Review + live run |
| B41 | Conversational expansion | S1 deterministic instruction grounding | 1 route | none | green; regex-safe (RAN) | none | B36 turns, B40 | **PI** | — |
| B42 | Fantasy-to-feasible | S1 feasibility ladder | 1 route | none | green | none | B35 limits | **PI** | — |
| B43 | Model routing | S1 registry + dry run, no live calls | 2 routes | none | green | none | SEC-008 (info) | **PI** | — |
| B44 | Collaboration | S1 members, anchored comments, reviews, audit | 6 routes | **`0030`** (SEC-004 lock in place) | green; caps under concurrency (RAN) | **live scenario written (PR #34), not run** | SUPA-004 (cascade into immutable tables); PHASE-009 (`0030` edited in place) | **PI** | Review; live run; owner retention decision |
| B45 | Desktop 3D delivery | S1 delivery manifest, ETag/304, compatibility | 2 routes | none | green | none | B29 | **PI** | — |
| B46 | End-to-end benchmark | S1 one e2e test + evidence generator | none | none | green | evidence produced on Windows/Node 24, `productionReady: false` (DOC) | all | **PI** | Regenerate evidence on Linux/Node 22 after merge |

### 5.1 Dependency graph and merge order

```
Phase order (roadmap): B30 → B31 → B32 → B33 → B34 ⇄ B37 → B35 → B36 → B38 → B39 → B40 → B41 … B46
                                                                (B40 S2 runs B34; B44 uses the B40 element diff)

Merge order (PRs):
  #33 BUG-001 ─────────────────────────────────────────────▶ phase31/development   (independent)
  #34 audit repairs ─▶ phase40/selective-revision-orchestration (#31's branch)
  #31 B40–B46 (+#34) ──────────────────────────────────────▶ phase31/development   (after review + live run)
  #29 B39 gates (refreshed for 0030/0031) ─────────────────▶ phase31/development
  integration/main-consolidation (--allow-unrelated-histories) ─▶ main
  D-9 hosted ledger → owner migration decision → D-10 staging → D-11 tags
```

- **#34 must merge before or with #31.** If #31 is abandoned, renumber `0031` to `0030` and retarget #34 to `phase31/development`. The SQL depends only on `0023`.
- **#33 and #31** both touch `sentry.ts`; they merge cleanly in either order (RAN).
- **#29** merges cleanly on top of everything (RAN). Its runbook must name `0030`/`0031` if #31/#34 land first.

---

## 6. Defect register

### 6.1 Findings opened in this session

| ID | Sev | Conf | Status | Phase / location | Finding |
|---|---|---|---|---|---|
| **DB-001** | Low | Confirmed (RAN) | **VERIFIED_FIXED on PR #34** (local and CI 39156993823); unmerged | B33; `0023_account_library_context.sql:46-70` (`account_project_quota`, `account_reference_quota`, `account_job_quota`) | Owner-wide quotas counted without an owner-wide lock (§9.1) |
| **DB-002** | Medium | Confirmed (RAN) | **VERIFIED_FIXED on PR #34** (as above) | B32/B33; `0022_durable_jobs.sql:194-199` (retry), `0023:64-70` | A retry (`FAILED → QUEUED`) bypassed the 4-per-project and 8-per-owner active-job limits (§9.2) |
| **TEST-004** | Low | Confirmed (RAN) | **VERIFIED_FIXED** (coverage; local) | B44; `collaboration.integration.test.ts` | Review cap (100) had no concurrency test; without the lock 102 and 103 were stored |
| **TEST-005** | High (gap) | Confirmed | **BLOCKED** (written, not run) | B34/B40/B44; `supabase.live.test.ts` | No live scenario existed for B34, B40 or `0030`. Now written; needs a `workflow_dispatch` run (§14) |
| **API-001** | Info | Confirmed | Documented | B32; `POST …/jobs/:jobId/retry` | Contract change from DB-002: retry may now return 429 `JOB_LIMIT_EXCEEDED` / `ACCOUNT_QUOTA_EXCEEDED` (§11) |
| **API-002** | Info | Confirmed (CODE) | ACCEPTED_DEFERRED | B05–B08; `routes/plans.ts:13,19,31`, `routes/estimates.ts:10` | Body validation runs before authentication: an unauthenticated malformed request gets 400, not 401. Nothing leaks; a frontend sees 401 once the body is valid |
| **API-003** | Info | Confirmed (CODE) | ACCEPTED_DEFERRED | B45; `routes/delivery.ts:27-28` | `If-None-Match: *` is not treated as matching (RFC 9110). No browser sends `*` for a GET revalidation |
| **AUD-001** | Info | Confirmed (CODE, reasoned) | CLOSED (no defect) | B44; `0030:121-125` | `collaboration_write` computes the role before taking the lock. A comment that waited on the lock can commit after its author's removal. The schedule is still serialisable ("comment, then removal"); only `created_at > removed_at` can appear in the record |
| **AUD-002** | Info | Confirmed (CODE) | OPEN (owner) | B36; `0025:68-71` | The compute dispatch limit `maxActivePerOwner` counts active dispatched jobs, but a retry re-activates a job without that check. Since `0031` the owner-wide 8 still bounds it |
| **PHASE-009** | Low | Confirmed (CODE, DOC) | OPEN (owner decision) | B44; `479b2bc` | The SEC-004 repair edited `0030` in place. That contradicts the B40–B46 plan's rule 4 (`docs/roadmap/b40-b46-implementation-plan.md` §0: "never edits to an earlier one"). Risk is low: no record shows `0030` applied to any persistent database, and B46 states no live gate ran. If one did apply it, its ledger would hold `0030` without the lock. Decide: accept, or record the exception in the plan |
| **PHASE-010** | Info | Confirmed (CODE, RAN) | ACCEPTED_DEFERRED | B34; `docs/phase34/phase34-design.md:70` | B34 charges its routes to the `write` rate-limit group "like the existing `…/validate` routes". In fact 5 of the 6 `…/validate` routes are in `generate`. Measured cost is under 1 ms per verify and 3 ms per diff on the largest supported models (RAN), so this is a wrong premise, not a resource risk |
| **PHASE-011** | Info | Confirmed (CODE) | ACCEPTED_DEFERRED | B27; `lib/http-protection.ts:18` | `knowledge/analyses` and `knowledge/validate` are the only analysis family outside `generate` (structural, environmental, systems, optimisation and scene are in it). Possibly deliberate; undocumented |
| **ENV-001** | Info | Confirmed (RAN) | BLOCKED | Session infrastructure | Docker starts but every registry is blocked; Actions dispatch is 403 (§2.2). The live gates must run where these work |
| **SEC-009** | Info | Confirmed (RAN) | CLOSED | B41; `instructions/grammar.ts` | Regex-backtracking probe: 11 adversarial 1,000-character inputs, each resolved in ≤ 1.6 ms (first-call warm-up 9.9 ms). No ReDoS |
| **REL-001** | Info | Confirmed (RAN) | CLOSED | B34; `services/verification-service.ts` | `GET …/verification` (charged to `read`, 120/min) computes on the event loop. Measured ≤ 1.3 ms (verify) and ≤ 3 ms (diff); no blocking risk at supported model sizes |

### 6.2 Earlier findings, re-statused

**Re-verified in this session (RAN or GH):**

| ID | Sev | Status now | Evidence this session |
|---|---|---|---|
| BUG-001 | Low | **FIXED_UNVERIFIED on the integrated line** (VERIFIED on PR #33 head) | SIGTERM without a DSN: base exit 1 + `SHUTDOWN_FAILED` (2/2); int exit 0 (2/2); with a fixture DSN exit 0 on both |
| TEST-001 | Low | Same as BUG-001 | PR #33 |
| SEC-004 | Low | **FIXED_UNVERIFIED on the integrated line** (VERIFIED on PR #31 head) | Lock present `0030:125`. Regression 5/5 pass; 3/3 fail without the lock. Review cap added (TEST-004). The lock covers every writer: direct writes are revoked from `authenticated` and `service_role` (`0030:46-47`) |
| SEC-007 / PHASE-006 | Medium | OPEN | #31 and #33 have **0 reviews** (GH) |
| SUPA-001 | High | BLOCKED | No credential; not run |
| SUPA-002 / SUPA-006 | High / Medium | **BLOCKED** (scenario now exists: TEST-005) | §14 |
| SUPA-003 | Medium | OPEN, unverifiable here | `scripts/ensure-local-postgrest.mjs:43` still throws unless the CLI's PostgREST image is exactly `v16.2` or `v16.3`. The first live dispatch will show it |
| SUPA-004 | Low | OPEN (latent; now concrete) | The live suite's own cleanup must skip projects with `0030` comments or reviews (PR #34), because a project delete cannot cascade through their immutability triggers |
| SHOW-002 | High | OPEN | No `README` on `phase31/development`; `docs/PHASE8.md:9` still says "through `0005`" (RAN) |
| PHASE-001 | High | OPEN | `main` still has no common ancestor with the code line (RAN) |
| PHASE-002 | High | OPEN | #31: 0 reviews, no description, +15,844/−5,303, 64 files (GH) |
| PHASE-003 | Medium | OPEN, widened | PR #29 runbook still pins `0029` (L13, L18, L27, L46, L88), checks out `287b1a4` (L21), calls PR #27 "separate session" (L9) and lists the B34 decision as pending (L90). It must now also cover `0030` and `0031` |
| PHASE-005 | Medium | OPEN | 29 tags; newest `backend-v1-phase30-complete` (RAN) |
| PHASE-007 | Medium | OPEN | `phase34-closure.md:69` "*None recorded yet.*" (RAN) |
| DEP-001 | Medium (dev) | OPEN | `npm audit`: 1 moderate, 2 critical, all in the vitest tree; `--omit=dev`: 0 (RAN) |
| DEP-002 / TEST-003 | Low | OPEN | Reproduced again: embedded PostgreSQL needs a non-root user and `en_US.UTF-8` |

**Carried forward, not re-executed (PRIOR):** SEC-001, SEC-002, SEC-003, SEC-005, SEC-006, SEC-008, SECRET-001, DEP-003, SUPA-005, TEST-002, SHOW-001, SHOW-003, SHOW-004, PHASE-004, PHASE-008, DEBT-001, DEBT-002, DEBT-003. The code they cite is unchanged on the integrated line. See the follow-up §4 for their evidence and remedies.

---

## 7. Failed-test ledger

Every failure observed in this session. None was deleted, weakened or skipped.

| # | Command (tree) | Result | Classification | Disposition |
|---|---|---|---|---|
| L-1 | `npx vitest run apps/api/tests/account-quota-concurrency.integration.test.ts` (`fix`, before `0031` existed) | **4 failed / 4**: `expected 'inserted' to be 'P3304'` ×3; API tally `{201: 10, 429: 10}` vs `{201: 5, 429: 15}` | **Product defect** DB-001 | Fixed by `0031`; L-5 |
| L-2 | same file, retry tests added, `0031` lock-only | **2 failed / 6**: retry returned `[200, 'QUEUED']` instead of `[429, 'JOB_LIMIT_EXCEEDED']` / `ACCOUNT_QUOTA_EXCEEDED` | **Product defect** DB-002 | Fixed by the trigger change in `0031`; L-5 |
| L-3 | same file with `0031` removed, 3 runs | 6/6, 5/6, 6/6 failed. The one pass was the probabilistic API-level race | Confirms test sensitivity | Expected; the 5 deterministic tests fail every time |
| L-4 | `collaboration.integration.test.ts -t "caps under concurrent"` with the `0030` lock removed, 3 runs | 3/3 failed (members `201: 5` vs 2; members `201: 7` vs 2; comments `201: 9` vs 5) | Confirms SEC-004 regression sensitivity | Lock restored (`git checkout`) |
| L-5 | scratch review-cap-only test, lock removed, 3 runs | 3/3 failed (`201: 7`, `8`, `8` vs 5) | Confirms TEST-004 | Scratch file deleted; coverage added to the real test |
| L-6 | Built server SIGTERM, base, no DSN | exit **1**, `SHUTDOWN_FAILED` (2/2) | **Product defect** BUG-001 | Fixed in PR #33; int exit 0 |
| L-7 | First SIGTERM probe | exit 143 | **Harness error**: the signal hit the `runuser` wrapper, not `node` | Discarded; re-run without the wrapper (L-6) |
| L-8 | First ReDoS probe | Arguments in the wrong order; then incomplete `RevisionFacts` | **Harness error** | Discarded; re-run correctly (SEC-009) |
| L-9 | `docker pull` (ECR, Docker Hub, GHCR, Quay) | data limit / 429 / 403 / 403 | **Environment** | ENV-001 |
| L-10 | `actions_run_trigger run_workflow backend-ci.yml` on `fix/audit-2026-10-18-repairs` | 403 "Resource not accessible by integration" | **Environment / permission** | TEST-005 handoff (§14) |

---

## 8. Security and authorisation findings

- **Authentication:** every handler calls `requestContext`. The only routes accepting anonymous callers are the documented public reads (§4). (RAN, CODE)
- **Object-level authorisation:** RLS + signed `SECURITY DEFINER` RPCs. Foreign projects return 404 in every integration suite (RAN, full suite).
- **B44 role model** (CODE `0030`):
  - The owner manages members; editors and reviewers comment; the owner or reviewers review; viewers only read.
  - Membership never reaches owner-only routes; verified as 404 on `GET /api/projects/:id` for a member (RAN, integration test).
  - Comments and reviews are immutable.
  - `member_upsert`'s "existing user" check is a deliberate owner-only probe that returns one error for both cases (PRIOR).
- **B40:** no new write path. It reuses Phase 30 preflight → candidate → approve, re-derives the plan and requires the approved `planHash` (`integration-service.ts:156-157`), and cancels an uncommitted operation on failure (`:211-213`).
- **Quotas and limits:** DB-001 and DB-002 (§9). Every other cap is serialised. Per-project caps take `projects … FOR UPDATE` (`0020:212`, `0021:155`, `0022:134`, `0026:15`, `0029:35`); owner-wide caps take owner advisory locks (`0012/0013/0026` conversations, `0025` compute, `0028` design concepts, and now `0031`). B44 takes a per-project advisory lock (`0030:125`). Reference transitions cannot re-enter a counted state: `DELETED` is terminal (`0021:76-77`).
- **Unchanged earlier findings:** SEC-001 (no malware scan), SEC-002 (per-process rate limits), SEC-003 (anonymous sign-ins), SEC-005/006, SEC-008 (PRIOR).

---

## 9. Data integrity and concurrency

### 9.1 DB-001: owner-wide account quotas not serialised (B33)

| Field | Detail |
|---|---|
| Reproduction | `apps/api/tests/account-quota-integrity.integration.test.ts`. A deterministic interleaving: transaction A inserts at quota − 1 and stays open; B inserts for the same owner; A commits only once B has finished or is waiting on a lock (polled via `pg_stat_activity`). Plus 20 concurrent `POST /api/projects` at 195 |
| Expected | B refused with `P3304`; exactly 200 projects / 8 active jobs / ≤ 1 GiB stored |
| Actual (before) | B inserted in all three quotas: 201 projects, 9 active jobs, 1 GiB + 5 bytes. API: **10 created, 205 stored** |
| Root cause (confirmed) | The triggers (`0023:46-70`) count, then allow. `project_write` `create` (`0011`) inserts without any owner-scoped lock: its only advisory lock is keyed to one idempotency key. Job submit and reference upload lock **one project row** (`0022:134`, `0021:155`), which never serialises two projects of the same owner. `0025:59` states the codebase's own rule ("Owner-wide limits are serialized across all of the owner's projects"), and `0023` did not follow it |
| Impact | Bounded overshoot per burst (each burst limited by concurrency and the 30/min write limiter); quotas are abuse controls, not billing |
| Repair | `0031_quota_integrity.sql`: `pg_advisory_xact_lock(hashtextextended('account-quota:<kind>:' \|\| owner, 0))` before each count. Forward-only, because `0023` may be applied on hosted (`0018`+ unverified) |
| Deadlock analysis | Every inserting path takes its project row lock (if any) **before** the owner lock, and none locks another project after it (CODE `0022:134-160`, `0021:155`, `0025:57-60`). No cycle is possible |
| Verification | Without `0031`: deterministic tests fail 3/3 runs. With it: 6/6 tests pass in 5/5 runs; full suite 3,176/3,176 (RAN) |

### 9.2 DB-002: job retry bypassed the active-job limits (B32/B33)

| Field | Detail |
|---|---|
| Reproduction | Same file. A project with 4 `QUEUED` jobs and 1 retryable `FAILED` job: `POST …/retry`. An owner with 3+3+2 active and 1 `FAILED`: retry |
| Expected | 429 `JOB_LIMIT_EXCEEDED` (project) / 429 `ACCOUNT_QUOTA_EXCEEDED` (owner); counts unchanged |
| Actual (before) | `200 QUEUED` in both: 5 active on the project, 9 for the owner |
| Root cause (confirmed) | `FAILED → QUEUED` is the only transition back into an active state (`job_guard`, `0022:66-67`). It is an UPDATE, so the BEFORE INSERT quota trigger never fires, and the retry branch (`0022:194-199`) checks neither limit. The phase32 design says "≤ 4 active jobs" (`phase32-design.md:89`); `0023:45` says "no RPC path can bypass them" |
| Impact | Active jobs, and therefore worker-pool load, could grow past both caps by the number of retryable failed jobs an owner holds. Retryable failures (lost worker, interruptions) are not easy for a user to cause on purpose, hence Medium rather than High |
| Repair | `0031`: the job quota trigger fires on `INSERT OR UPDATE OF status`. It acts only when a row becomes active, and for an update also checks the per-project limit (`P3204`), which `job_write`'s project row lock already serialises |
| Contract | API-001 (§11) |

### 9.3 SEC-004 (B44), re-tested

- **Lock:** transaction-scoped, keyed per project (`hashtextextended('collaboration:'‖pid, 0)`), taken after the role check and before every cap.
- **Collisions:** a 64-bit hash collision only serialises two projects; it cannot break a cap.
- **Coverage:** members (20), comments (200) and reviews (100) are now all tested under concurrency.
- **Role ordering:** AUD-001.

---

## 10. Database and migration findings

| Check | Result |
|---|---|
| Sequence | `0001`–`0031` contiguous with #31 + #34; `hosted-migration-ledger.test.ts` pins `0031` (RAN) |
| `0031` | Additive: `create or replace` of three trigger functions, plus one trigger recreated with a wider event (`INSERT OR UPDATE OF status`). No table, policy or grant change; `project_private` revoke repeated, per convention |
| Clean install | Every embedded-PostgreSQL suite applies `0001`–`0031` from empty (RAN, 127 files) |
| Upgrade | `supabase/tests/database.test.ts` (migration replay and pins) passes with `0031` (RAN). A populated-upgrade test was not added for `0031`: it changes functions only, and its behaviour is pinned by the new tests |
| **`0030` application state** | **Cannot be verified** (no hosted access). Evidence it was never applied to a shared database: it exists only on unmerged #31; the hosted ledger was last reported at `0017`; the B44 and B46 records list "Applying `0030` to hosted" as outstanding. This audit did **not** edit `0030`; its repair went to `0031`. See PHASE-009 for the earlier in-place edit |
| Deployment order | Migrations first, then the API. An API at `6bd84a5` runs on a database with `0030`/`0031` (it never calls the new RPCs). The #31 API requires `0030`. `0031` has no API dependency |
| Supabase acceptance layers | Static: PASS (PRIOR). Embedded PG: **PASS** (RAN). Live local: **BLOCKED** (§14). Hosted read-only: **BLOCKED** (SUPA-001). Staging: **BLOCKED** (SHOW-001) |

---

## 11. API and frontend-contract findings

| ID | Old contract | New contract | Why | Frontend impact | Compatibility | Proof |
|---|---|---|---|---|---|---|
| **API-001** | `POST /api/projects/:projectId/jobs/:jobId/retry`: 200 `JobDetail`, or 409 `JOB_NOT_RETRYABLE` | Also 429 `JOB_LIMIT_EXCEEDED` (more than 4 active on the project) or 429 `ACCOUNT_QUOTA_EXCEEDED` (more than 8 active for the owner) | DB-002: a retry is new active work | A retry button must handle 429 as job submission already does. The error envelope is unchanged (`ApiErrorResponseSchema`); OpenAPI lists `default` for errors, so the schema is unchanged | Additive error; no success shape changes | `account-quota-integrity…` retry tests; `docs/phase32/phase32-api.md` and `docs/phase33/phase33-api.md` updated in PR #34 |

**No other public contract changed.** Routes stay at 165, the OpenAPI is unchanged, and the conformance test (`modernization.test.ts`) passes (RAN).

**Frontend comparison (SHOW-004):** not possible here; the frontend source is not in scope. Backend-side contract artefacts the frontend can consume today:
- `docs/modernization/openapi.json` and `api-routes.json`;
- `GET /api/compatibility` (B45, route-catalog hash).

---

## 12. Cross-phase dependency and synchronisation defects

| ID | Seam | Finding | Type | Action |
|---|---|---|---|---|
| DB-001 | B33 ↔ B25/B36 conventions | Owner-wide limits serialised in `0025` but not in `0023` | Implementation defect | Fixed (#34) |
| DB-002 | B32 guard ↔ B33 trigger | Insert-only trigger vs. update-based reactivation | Implementation defect | Fixed (#34) |
| AUD-002 | B36 ↔ B32 retry | Compute limit not re-checked on retry | Residual (bounded by the owner-wide 8) | Owner decision |
| PHASE-009 | B44 ↔ plan of record | `0030` edited in place, against rule 4 | Process / owner decision | Record a decision |
| PHASE-010 | B34 ↔ B24–B29 grouping | Rate-limit premise false | Stale document | None needed (measured cheap) |
| PHASE-003 | B39 gates ↔ B40–B46 | PR #29 runbook predates `0030`/`0031` and the B34 merge | Stale document | Refresh before merging #29 |
| SUPA-004 | B44 ↔ B33 erasure | Immutable `0030` rows block project deletion by cascade | Latent design conflict | Owner retention decision |
| (B40 ↔ B34) | B40 S2 runs B34 verification | Consistent: `verifyRevision` is shared; B34 suites and `integration-branches` pass together (RAN) | — | Re-run both on any B34 change |
| (B44 ↔ B40) | B44 audit uses the B40 element diff | Consistent (collaboration integration test) | — | — |
| PHASE-001 | `main` ↔ code line | Unrelated histories; 3 add/add document conflicts | Integration blocker | Consolidation PR (follow-up §8.3) |
| (CI) | `supabase-acceptance` | Runs only on `workflow_dispatch`, so live gates never run on PRs | Missing gate | Owner: run per §14; consider a `paths: supabase/migrations/**` trigger |

---

## 13. Repair records and commands

### 13.1 Repairs (PR #34, `fix/audit-2026-10-18-repairs`, base `479b2bc`)

| Commit | Files | Purpose |
|---|---|---|
| `c963b2a` | `supabase/migrations/0031_quota_integrity.sql` (new, 41 lines), `apps/api/tests/account-quota-integrity.integration.test.ts` (new, 6 tests), `apps/api/tests/hosted-migration-ledger.test.ts` (pin `0031`) | DB-001, DB-002 |
| `5fd129a` | `apps/api/tests/collaboration.integration.test.ts` | TEST-004 |
| `137fca0` | `apps/api/tests/supabase.live.test.ts` | TEST-005 (and the cleanup's protected-table list) |
| `91118ac` | `docs/phase32/phase32-api.md`, `docs/phase33/phase33-api.md` | API-001 documentation |

Diff: 7 files, +299/−6. Secret-pattern scan of the diff: 0 matches.

### 13.2 Key commands (all RAN, as user `ubuntu`, Node 22.22.0)

```sh
# integration tree
git worktree add -b audit/integration /home/ubuntu/nk/int origin/phase31/development
git merge --no-ff origin/fix/bug-001-shutdown-without-sentry origin/phase40/selective-revision-orchestration origin/phase39/b39-release-gates   # sequentially; all clean
npm ci && npm run build && npm run typecheck && npm run lint            # exit 0 each
npx vitest run                                                          # run 1: 126 files, 3,170/3,170, 668 s
git merge --no-ff fix/audit-2026-10-18-repairs && npx vitest run        # run 2: 127 files, 3,176/3,176, 644 s
npm audit --omit=dev --audit-level=high                                 # 0 vulnerabilities
# reproductions
npx vitest run apps/api/tests/account-quota-integrity.integration.test.ts                     # ×5 with 0031, ×3 without
npx vitest run apps/api/tests/collaboration.integration.test.ts -t "caps under concurrent"   # ×5 with the lock, ×3 without
SUPABASE_URL=http://127.0.0.1:9 SUPABASE_ANON_KEY=placeholder PORT=39xx node apps/api/dist/server.js & kill -TERM $!; wait $!   # BUG-001
```

---

## 14. Regression and acceptance evidence, and the live-run handoff

| Gate | Result |
|---|---|
| Unit + embedded-PG, integration tree with all PRs and repairs | **PASS** 127 files, 3,176 tests (RAN) |
| Build / typecheck / lint | **PASS** (RAN) |
| PR #33 CI | **PASS** (run 39140096759) |
| PR #31 CI on `479b2bc` | **PASS** backend ×2, container (run 39143637924) |
| PR #34 CI | **PASS** (run 39156993823 on `91118ac`): backend Node 22.22.0 (126 files, 3,163/3,163 tests on the merge ref with #31) and 22.23.3; container smoke. `supabase-acceptance` skipped, as on every non-dispatch run |
| Live local Supabase (13 scenarios incl. the new one) | **NOT RUN** (TEST-005) |
| Hosted ledger (D-9), staging (D-10), tags (D-11) | **BLOCKED** (owner/operator) |

**Live-run handoff** (owner, about 5 minutes of attention plus about 30 minutes of runner time):
1. GitHub → Actions → **Backend CI** → **Run workflow**, branch `fix/audit-2026-10-18-repairs`.
2. Expected: `backend` ×2 and `container smoke` green; `supabase-acceptance` runs `supabase start`, `db reset` (applies `0001`–`0031` to the runner's disposable stack), `ensure-local-postgrest.mjs`, then the 13 live scenarios.
3. **If it stops at `ensure-local-postgrest.mjs` with "Unexpected REST image"**, that is SUPA-003 reproduced. Record the image the CLI pulled. Then change the check at `scripts/ensure-local-postgrest.mjs:43` to accept any CLI image at or above `v16.3`, keeping the swap only for `v16.2`.
4. Evidence to capture: the run URL, the job log tail (scenario names and counts) and the `supabase-acceptance` conclusion.
5. A green run closes **TEST-005**, the B34/B40/B44 rows of **SUPA-002/SUPA-006**, and B34 closure step 3 (`phase34-closure.md` §4).

The same steps on any Docker host: follow-up §5.3, with the branch above.

---

## 15. Outstanding external dependencies

| Dependency | Owner role | Needed for |
|---|---|---|
| `workflow_dispatch` of `backend-ci.yml` (§14) | Repository owner | TEST-005, SUPA-002/006, SUPA-003 |
| Human review of #31 (`0030`, `integration-service.ts`, `routes/collaboration.ts`), #34 and #33 | Owner / reviewer | SEC-007, PHASE-002/006 |
| Read-only hosted ledger (`scripts/verify-hosted-migrations.mjs`) | Operator with a read-only DB role | SUPA-001 |
| Hosted Auth settings (anonymous sign-ins) | Owner | SEC-003 |
| B34 deferral decisions; B36 D1–D7; erasure policy; PHASE-009 | Owner | PHASE-007, PHASE-008, SUPA-004 |
| Staging environment; release tags | Owner / operator | SHOW-001, PHASE-005 |
| Frontend repository or a contract-test fixture | Frontend team | SHOW-004 |

---

## 16. Prioritised remaining-work plan (shortest safe route)

1. **Owner, today:** dispatch the live run on PR #34's branch (§14), then review and merge **#33** (3 lines, CI green).
2. **Reviewer:** review **#34** (7 files). Merge it into #31's branch once its CI and the live run are green.
3. **Reviewer:** review **#31**: `0030`, `integration-service.ts`, `routes/collaboration.ts`; add a PR description with scope, migration and deployment order. Record the PHASE-009 decision. Merge into `phase31/development`.
4. **Engineer:** refresh **#29**'s runbook for `0030`/`0031` and the B34 merge (PHASE-003); re-run its rehearsal; merge.
5. **Engineer (2–3 h):** write the README / setup guide (SHOW-002) and verify it on a Docker host during step 1's run. Add the `supabase/migrations/**` path trigger for `supabase-acceptance`.
6. **Operator:** D-9 read-only ledger, then the owner's migration decision (`0018`–`0031`), then D-10 staging, then D-11 tags.
7. **Then:** `main` consolidation (PHASE-001) and two showcase rehearsals on a disposable local stack (earlier audit §15, J1–J16).
8. **Post-showcase:** SEC-001 scanner/quarantine; DEBT-003 sweeper; SEC-002 shared limiter; DEP-001 vitest major; SUPA-004/005 retention; AUD-002.

---

## 17. Final readiness verdict

| Target | Verdict | Basis |
|---|---|---|
| **Frontend integration** against `phase31/development` (+ #33) on a local stack | **READY FOR FRONTEND INTEGRATION**, with limitations | Contracts generated and conformance-tested; core workflows pass on real PostgreSQL RLS; last live receipt covers B05–B39 (≤ `0029`, PRIOR). **Limitations:** B34 never run live; BUG-001 until #33 merges; DB-001/DB-002 until #34 merges (quota overshoot only under concurrency); frontend-side conformance unverified (SHOW-004) |
| **Frontend integration of B40–B46** (#31 + #34) | **NOT READY** | 0 reviews; no live run of `0030`/B40/B44; by their own records every phase is a partial slice and none is complete |
| **Showcase testing** | **NOT READY** | Live acceptance, hosted ledger, staging, setup guide and reviews are missing (§16 steps 1–6) |
| **Release / production** | **NOT READY** | No tag after B30; B31/B32/B34/B36 gates unmet; D-9/D-10/D-11 open |

**Findings opened this session (15), by severity:** High 1 (TEST-005, test gap) · Medium 1 (DB-002) · Low 3 (DB-001, TEST-004, PHASE-009) · Informational 10. **By status:** VERIFIED_FIXED 3 (DB-001 and DB-002 on PR #34, unmerged; TEST-004), BLOCKED 2, OPEN 2, ACCEPTED_DEFERRED 4, CLOSED 3, Documented 1.

**Boundaries of this audit:** no live Supabase, container, hosted or frontend execution; risk-directed rather than exhaustive code review; B05–B28 not re-audited. Line numbers refer to the integration tree unless stated otherwise.
