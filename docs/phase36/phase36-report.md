# Phase 36 report — compute gateway, first slice

**Verdict:** implementation-complete, pending owner review. Not merged, tagged, deployed, or applied to or contacted on any hosted database. No PR was opened.

**Authority:**
- The owner's implementation authorization of 2026-10-13 and the finalization brief of the same day.
- Both read against the provisional, repository-reconciled roadmap (`docs/roadmap-research-baseline` @ `a644225`, unmerged). The original roadmap and research documents have not been recovered. The documents on that branch are reconstructions and are not represented as originals. The owner's archived draft is unchanged. Phase assignments taken from the reconstruction (the gateway as Phase 36, the G-numbers) are uncertain.

## 1. Branch and commits

| Item | Value |
|---|---|
| Branch | `phase36/compute-gateway`, tracking `origin/phase36/compute-gateway` |
| Base | `origin/phase31/development` @ `f86b577` (default branch) |
| `a7da2a0` | `git cherry-pick -x 008a77f`: Node 22.22.0 source-mode worker fix (design §4) |
| `76c39c2` | The gateway: migration, routes, services, tests, regenerated route catalog and OpenAPI |
| `33c1e89` | First version of the design, API and report documents |
| `8597703` | Finalization tests: integration gap tests, a live Supabase acceptance case, and the acceptance receipt |
| Docs commit | This report, the in-place updates to [phase36-design.md](phase36-design.md) and [phase36-api.md](phase36-api.md), and the `test:compute` script in `package.json` |

At the start of finalization, the branch was at `33c1e89`, with a clean tree and 0 commits ahead of or behind its upstream.

Not touched, verified by remote heads: `phase36/conversational-ai` (`3016ec8`), `phase35-1/release-remediation` (`3717a80`, PR #7), `docs/roadmap-research-baseline` (`a644225`), and all tags.

## 2. What exists

- **Migration** `supabase/migrations/0025_compute_gateway.sql` (additive). It adds:
  - table `project_compute_dispatches`: immutable, owner-readable under RLS, keyed by the quote hash, with cost, placement and provider pinned by checks;
  - functions `compute_write` and `compute_read`, plus the private `project_private.compute_dispatch`.

  Grants: `select` on the table, and `execute` on the two functions for `authenticated`. No existing object changes.
- **Routes:**
  - `POST …/compute/quotes`
  - `POST …/compute/jobs`
  - `GET …/compute/jobs/:jobId`

  These are the only paths added to `docs/modernization/openapi.json` and `api-routes.json`; the drift test passes.
- **Code:**
  - `apps/api/src/compute/{contracts,gateway}.ts`, `apps/api/src/lib/compute-repository.ts`, `apps/api/src/routes/compute.ts`;
  - small hooks in `app.ts`, `config/env.ts` (`COMPUTE_POLICY`), `lib/{repository,supabase,http-protection,sentry}.ts`, `services/job-service.ts` (`signedJobSubmission`, also used by `submitJob`), `services/overview-service.ts` (discovery), and `test-support/{pg-backend,openapi}.ts`.
- **Tests:**
  - `apps/api/tests/compute.test.ts`: 15 unit tests;
  - `apps/api/tests/compute.integration.test.ts`: 14 tests on embedded PostgreSQL, 5 of them added in finalization;
  - `apps/api/tests/supabase.live.test.ts`: 1 new live case;
  - `supabase/tests/database.test.ts` pins the table and its 3 foreign keys.

The flow, contracts, error behavior, quotas and guarantees are specified in [phase36-api.md](phase36-api.md) and [phase36-design.md](phase36-design.md) §1–§3.

## 3. Defects found in finalization

No security, data-integrity, duplicate-execution or migration defect was found in the gateway code. No production code changed in finalization.

The inspection covered quote signing, consent verification, the order of ownership and policy checks, `compute_write`'s locks, replay and limit logic, the nested B32 call, RLS, grants and the immutability trigger.

Corrections to the first report:
- **PR #7 status:** PR #7 was described as unreviewed. It is approved by one reviewer on `3717a80`, but it is still a draft and not merged.
- **Gateway quota scope:** the first report did not make clear that gateway owner limits do not cover plain B32 submissions. Design §3 now states their scope.
- **Live suite cleanup:** the cleanup would have failed on projects that have consent records, because those records are immutable. Fixed in `8597703`, which treats them as protected history.

## 4. Verification (exact)

All checks ran as a non-root user (embedded PostgreSQL refuses root), with `LANG=en_US.UTF-8`, from the repository root.

**Pending:** the final full-suite runs (Node 22.22.0 and 22.23.2) and the container smoke test are in progress; results are recorded here only after they are observed.

### What the tests prove

| Area | Evidence |
|---|---|
| A quote starts nothing | No job, consent or artifact row after quoting (integration + live) |
| Consent required and bound | Missing or false flags → 400. A consent naming another quote → `COMPUTE_CONSENT_MISMATCH`. Any altered field (request, bounds, expiry, model hash), another user, another project or another server key → `COMPUTE_QUOTE_INVALID`. Nothing is created in any of these cases (unit + integration) |
| Expired and stale quotes | A server-signed expired quote → `COMPUTE_QUOTE_EXPIRED`. A server-signed quote with a wrong model hash → `COMPUTE_QUOTE_STALE`. A repeat of an accepted consent after expiry → `COMPUTE_QUOTE_EXPIRED`. Job and consent counts are unchanged (integration) |
| No duplicate execution | 3 concurrent replays after a first consent, 4 concurrent first consents (one 202), and a replay after completion all map to one job, one consent record and one stored artifact or study (integration). A replay through real PostgREST (live). Two quotes for identical active work → one job (B32 dedup) |
| Quote-hash reuse | The same hash with other input, or on another project → SQL `P3602` → `409 COMPUTE_QUOTE_CONFLICT`. The identical signed call replays (integration) |
| Atomicity | A failure after the nested submission rolls back the job, its events and the consent record (integration). Mutations confirm the test fails if the insert error is swallowed |
| Lost dispatch | A committed but undispatched job is started by polling, once (integration) |
| Quotas | Owner active limit and daily cap → 429, nothing created (integration). B32 per-project limit still enforced inside the gateway transaction → `429 JOB_LIMIT_EXCEEDED`, nothing recorded (integration) |
| Ownership | Another user → 404 on quote, consent and poll. Anonymous → 401 (integration). RLS: owner reads 1 row, another user reads 0, anonymous → `42501`. Table update, delete and insert → `42501`. Unsigned `compute_write` → `42501`. Foreign `compute_read` → `P1201` (live, real JWTs and PostgREST) |
| Remote disabled | `placement: REMOTE` → 422 (integration + live). A policy enabling remote, unknown fields, or `REVISION_EXECUTE` → startup error (unit + integration). Discovery lists remote as `DISABLED`, with no endpoint or credential |
| Output validation | Malformed worker output and typed refusals → `FAILED`, no artifact, bounded attempts (integration) |
| Engineering status | Phase 35 domain statuses identical before and after a gateway job; `NO_VALIDATED_SOLVER` present; every response says `NOT_CLAIMED` (integration) |
| Audit and logs | Consent metadata recorded and immutable; logs carry IDs and hashes, never the request payload or the secret (integration) |
| Migration | Applies on a populated `0024` database without changing existing job rows (integration). Applies in sequence `0001`–`0025` on the local Supabase stack (CLI 2.117.0; `supabase migration list --local` shows `0025` locally and in the ledger) |

**Mutation checks** (each run against the relevant test, then reverted; the tree was verified clean afterwards):

| Mutation | Result |
|---|---|
| Stale-quote check removed | Caught |
| Expiry check removed | Caught |
| `P3602` conflict check removed | Caught |
| Replay lookup disabled | Caught |
| The induced post-submission failure removed | Caught |
| Consent-insert error swallowed (job left without a record) | Caught |

All 6 were caught. One earlier attempt at the last mutation was syntactically invalid, so every test skipped. It was discarded and redone; it is not counted.

### Not run, or not covered

- **GitHub Actions:** no PR exists, as instructed, so no CI run covers this branch. No CI result is claimed.
- **CI coverage on this base:** the CI workflow on `f86b577` runs per-area subsets (`test:unit`, `test:integration` and others), not the full suite. Those subsets omit the gateway tests. They also omit `worker-bootstrap`, `jobs`, `account`, `references` and `verification`; that gap predates Phase 36.
  - PR #7 replaces the subsets with `npx vitest run` on Node 22.22.0 and 22.23.2, which covers every file.
  - To avoid a conflicting edit to the same `package.json` lines, this branch does not touch the subsets. It adds a `test:compute` script (`npm run test:compute`) on lines PR #7 does not change.
  - Until PR #7's workflow change is on the base, GitHub CI would not run the gateway tests.
- **Container smoke test** (`scripts/smoke-container.mjs`): not run in finalization.
- **Hosted database:** not contacted; migrations not applied (not authorized).
- **Node 24 and 26:** not tested.
- **Not exercised by any test:**
  - a crash *between* the `job_write` insert and the consent insert at the process level (atomicity is shown by an in-transaction failure instead);
  - clock skew between the API and database servers;
  - the 120-per-hour B32 limit through the gateway (only the 4-active limit is exercised);
  - load or soak behavior.

## 5. Worker fix provenance

- **Source:** `008a77f` on `phase35-1/release-remediation` (PR #7).
- **Copy:** `a7da2a0`, made with `git cherry-pick -x`. Identical diff; `git patch-id --stable` gives `431b5180735e…` for both.
- **Files:** `apps/api/src/lib/tsx-worker.mjs`, `apps/api/src/lib/worker-pool.ts`, `apps/api/tests/worker-bootstrap.test.ts`, and `test-support/source-workers/{resolution-worker,resolution-dep}.ts`.
- **Isolation:** no other Phase 35 change is on this branch; the diff against the base contains only the 5 files above plus Phase 36 files.
- **Baseline evidence** (`f86b577`, Node 22.22.0): 55 failed of 2744 in 10 files, all `*_WORKER_FAILED`. With the fix: those 10 files plus the regression test, 11 files / 112 tests passed.
- **PR #7:** open draft, approved by @shubham-0 on `3717a80`, mergeable state clean. Its CI run 38278710919 passed on both Node versions; that run is evidence for PR #7, not for this branch.

## 6. Migration number

`0025` is free on `phase31/development`, and `phase35-1` adds no migration. `phase36/conversational-ai` has its own `0025_conversation_turns.sql`. The two are independent, but the ledger keys on the version prefix, so they cannot both be `0025`. **Required before integration:** whichever branch merges second is renumbered to `0026`, with its upgrade test updated (design §5 lists the exact places). Nothing was renumbered here.

**Merge simulation** (`git merge-tree`, read-only; nothing was merged):
- **With PR #7's head:** two textual conflicts, in `apps/api/src/lib/http-protection.ts` (both sides add routes to the `generate` group) and `apps/api/src/services/overview-service.ts` (both sides add a discovery service row and discovery fields). Both are additive, so the resolution keeps both sides. `docs/modernization/openapi.json` and `api-routes.json` merge textually but must be regenerated after the merge (`UPDATE_ROUTE_CATALOG=1` with `apps/api/tests/modernization.test.ts`), then checked by the drift test.
- **With `phase36/conversational-ai`:** the same two conflicts. Git reports **no** conflict for the migrations: `0025_compute_gateway.sql` and `0025_conversation_turns.sql` both land, so the duplicate version must be caught by review, not by Git.

## 7. Limitations and deferred items

- **Quota scope:** gateway owner limits count gateway consent records only. Plain B32 submissions are bounded by B32 and B33, not by them.
- **Expiry:** a consent repeated after expiry is refused rather than replayed. The job remains readable by ID and through the B32 job list.
- **Defensive codes:** `COMPUTE_QUOTE_STALE` and `COMPUTE_QUOTE_CONFLICT` are not reachable with correctly signed quotes; the tests reach them deliberately.
- **Clocks:** quote expiry uses the API clock; the daily cap uses the database clock.
- **Deletion:** a project with consent records cannot be deleted, as with other immutable evidence. No deletion API exists.
- **Unsupported:**
  - remote, metered or paid execution;
  - callbacks;
  - a background recovery role (recovery needs an owner read);
  - solver execution, fan-out/fan-in, checkpoints;
  - content-addressed caching;
  - gateway-level cancellation (use B32 cancel);
  - per-provider circuit breaking;
  - environment-reproducibility claims.
- **Engineering status:** `REQUIRES_SOLVER` and `NO_VALIDATED_SOLVER` are unchanged. A `SUCCEEDED` job with `ACCEPTED_BY_SERVICE_VALIDATOR` means only that the engine service re-validated and stored its output. All four claims are `NOT_CLAIMED`.
- **Reproducibility:** inputs, input hash, source revision, model hash, algorithm version and Node version are recorded. Environment reproducibility is not claimed and was not demonstrated.

## 8. Owner decisions

1. **Merge order and renumbering:** choose the order for `phase36/compute-gateway` and `phase36/conversational-ai`, and authorize renumbering the second one's migration to `0026`.
2. **PR #7:** decide whether to merge PR #7 first (recommended). It is approved but still a draft. It supplies the full-suite, two-Node-version CI that this branch needs for its tests to run in CI. This branch carries an identical copy of its worker fix, and the two additive conflicts above are resolved on whichever side merges second.
3. **CI:** authorize a PR, or a CI run, for this branch.
4. **Roadmap and later slices:**
   - accept or correct the provisional roadmap;
   - D1–D7 (remote providers, a recovery role, callbacks, budgets, the original research, further eligible kinds, remote-data privacy);
   - G7, G8 and G12.
5. **Deployment:** a hosted-migration plan, since the hosted database is reported at `0017` (unverified).

Work stops here for owner review.
