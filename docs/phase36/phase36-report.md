# Phase 36 report — compute gateway, first slice

**Status (2026-10-13, post-merge repair):**
- **Implementation:** the first gateway slice is **merged** into `phase31/development` by PR #10 (merge commit `5476f41`, 2026-10-13 05:15:57Z). It is not tagged or deployed, and no hosted database was contacted.
- **Post-merge defect:** `npm run typecheck` failed on the merged default branch because of one line in a test (TS2532). It is fixed on `phase36/typecheck-repair` (§4.1). That fix is **not yet on the default branch**.
- **Acceptance:** the verification results in §4 apply to the fix commit unless stated otherwise. Owner review of this report and of the repair is pending.

**Authority:**
- The owner's implementation authorization of 2026-10-13, the finalization brief and the post-merge repair brief of the same day.
- Both read against the provisional, repository-reconciled roadmap (`docs/roadmap-research-baseline`, unmerged). The original roadmap and research documents have not been recovered. The documents on that branch are reconstructions and are not represented as originals. Phase assignments taken from them (the gateway as Phase 36, the G-numbers) are uncertain.

## 1. Branch and commits

| Item | Value |
|---|---|
| Implementation branch | `phase36/compute-gateway`, from `phase31/development` @ `f86b577` |
| `a7da2a0` | `git cherry-pick -x 008a77f`: Node 22.22.0 source-mode worker fix (§5) |
| `76c39c2` | The gateway: migration, routes, services, tests, regenerated route catalog and OpenAPI |
| `33c1e89`, `9420961` | Design, API and report documents; `test:compute` script |
| `8597703` | Finalization tests: integration gap tests, a live Supabase acceptance case, an acceptance receipt. **Introduced the typecheck defect** (§3) |
| `5476f41` | **Merge of PR #10** into `phase31/development` (parents `f86b577`, `9420961`) |
| Repair branch | `phase36/typecheck-repair`, from `5476f41` |
| `6163945` | One-line typecheck fix (§4.1) |
| Docs commit | This report and the local acceptance receipt of `6163945` |

Not touched, verified by remote heads on 2026-10-13: `phase36/conversational-ai` (`3016ec8`), `phase35-1/release-remediation` (`3717a80`, PR #7), `docs/roadmap-research-baseline` (`56764c5`), `phase36/compute-gateway` (`9420961`), and all tags.

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

## 3. Defects found

No security, data-integrity, duplicate-execution or migration defect was found in the gateway code. No production code changed in finalization.

The inspection covered quote signing, consent verification, the order of ownership and policy checks, `compute_write`'s locks, replay and limit logic, the nested B32 call, RLS, grants and the immutability trigger.

Corrections to the first report:
- **PR #7 status:** PR #7 was described as unreviewed. It is approved by one reviewer on `3717a80`, but it is still a draft and not merged.
- **Gateway quota scope:** the first report did not make clear that gateway owner limits do not cover plain B32 submissions. Design §3 now states their scope.
- **Live suite cleanup:** the cleanup would have failed on projects that have consent records, because those records are immutable. Fixed in `8597703`, which treats them as protected history.

**Post-merge defect (fixed on the repair branch, not yet on the default branch):**
- **Symptom:** `npm run typecheck` fails on `5476f41`: `apps/api/tests/compute.integration.test.ts(253,19): error TS2532: Object is possibly 'undefined'.`
- **Cause:** the test indexed `racing[0]` under `noUncheckedIndexedAccess` (`tsconfig.base.json`). Vitest transpiles without type-checking, so the tests still passed.
- **How it reached the default branch:**
  - `8597703` was committed before `npm run typecheck` was run on it;
  - PR #10's CI `backend` job failed at the typecheck step (Actions run 38350504126, job 115141566509, Node 22.23.3), so no tests ran in CI;
  - the PR was merged regardless.
- **Production code is unaffected:** the error is in a test file. `npm run build` compiles only `tsconfig.build.json` sources and passed throughout.

## 4. Verification (exact)

### 4.1 The repair

```diff
-    const jobId = racing[0].json().job.id;
+    const jobId = racing.find(r => r.statusCode === 202)!.json().job.id;
```

The job id is taken from the response that created the job. The non-null assertion follows the repository convention (`[0]!.` occurs 171 times and `find(…)!` repeatedly in `apps/api/tests`). It is justified by the assertions directly above it, which are unchanged:
- the status codes are exactly `[200, 200, 200, 202]`;
- all four responses name one job;
- three responses are replays.

No assertion was removed or weakened, no `any` or blanket cast was added, and no compiler setting changed.

### 4.2 Results

All checks ran from the repository root as a non-root user (embedded PostgreSQL refuses root), with `LANG=en_US.UTF-8`, on a clean tree.

| Check | Command | Commit | Node | Result |
|---|---|---|---|---|
| Reproduce the defect | `npm run typecheck` | `5476f41` (unmodified) | 22.22.0 | **exit 2**: the TS2532 error above |
| Typecheck | `npm run typecheck` | `6163945` | 22.22.0 | **exit 0** |
| Build | `npm run build` | `6163945` | 22.22.0 | exit 0 |
| Lint | `npm run lint` | `6163945` | 22.22.0 | exit 0 |
| Full suite | `npx vitest run` | `6163945` | 22.22.0 | exit 0: **91 files, 2776 tests passed**, 0 failed, 0 skipped (589 s) |
| Typecheck, build, lint | same | `6163945` | **22.23.2** | exit 0 / 0 / 0 |
| Full suite | `npx vitest run` | `6163945` | **22.23.2** | exit 0: **91 files, 2776 tests passed** (602 s) |
| Focused gateway tests | `npm run test:compute` | `6163945` | 22.22.0 | exit 0: 2 files, **29 tests passed** (`compute.test.ts` 15, `compute.integration.test.ts` 14) |
| Worker-pool regression | `apps/api/tests/worker-bootstrap.test.ts`, part of the full suite | `6163945` | 22.22.0 and 22.23.2 | 3/3 passed on both |
| Mutation checks on the edited test | §4.3 | `6163945` + mutation | 22.22.0 | 2/2 caught; control passed |
| Local Supabase acceptance | `npx supabase start` (CLI 2.117.0, disposable local stack, migrations `0001`–`0025`), then `npm run test:supabase` | `6163945` | 22.22.0 | exit 0: **121/121 passed**, including the Phase 36 case. Receipt `docs/phase16-evidence/supabase-2026-10-13T06-05-42.817Z.json`: 0 API errors, 0 responses ≥ 500; the 18 recorded `401`s are the suite's deliberate anonymous checks |
| Container build and smoke | `docker build -t designflow-api:ci .` then `node scripts/smoke-container.mjs designflow-api:ci` | `6163945` | — | **BLOCKED** (environment): `npm ci` inside the build failed after 71 s with npm's `Exit handler never called!`. Diagnosis: this environment intercepts outbound TLS with its own CA, which the stock `node:22-bookworm-slim` image does not trust; a fetch from that image to `registry.npmjs.org` fails with `SELF_SIGNED_CERT_IN_CHAIN`. Retrying with `--network host` failed the same way. A workaround adding the environment's CA to a local base image was not permitted in this session. **No container result is claimed** |
| GitHub CI | — | — | — | **Not run** for `6163945`: the branch is not pushed and no PR exists (not authorized) |

Earlier evidence, kept for the record:
- `76c39c2`: full checks green on Node 22.22.0, 91 files / 2771 tests.
- `8597703`: build and lint 0, typecheck 2, 91 files / 2776 tests passed on Node 22.22.0.
- `8597703` working tree: local Supabase acceptance 121/121.

### 4.3 Mutation checks

Each mutation was applied to the migration that the embedded-PostgreSQL harness loads, the targeted test was run, and the file was restored; `git status` was clean afterwards.

| Mutation (run against `6163945`'s edited test) | Result | Failing assertion |
|---|---|---|
| Replay lookup disabled in `compute_write` | **Caught** | Line 250: statuses `[202, 409, 409, 409]` ≠ `[200, 200, 200, 202]` |
| `P3602` conflict check removed | **Caught** | Line 260: `undefined` ≠ `'P3602'` |
| Control: no mutation | Passed | — |

Finalization's 6 mutations (below) were run against `8597703`'s working tree. They were not repeated, because the gateway code is unchanged since then.

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

**Finalization mutation checks** (against `8597703`'s working tree; each reverted, tree verified clean):

| Mutation | Result |
|---|---|
| Stale-quote check removed | Caught |
| Expiry check removed | Caught |
| `P3602` conflict check removed | Caught |
| Replay lookup disabled | Caught |
| The induced post-submission failure removed | Caught |
| Consent-insert error swallowed (job left without a record) | Caught |

All 6 were caught. One earlier attempt at the last mutation was syntactically invalid, so every test skipped. It was discarded and redone; it is not counted.

### 4.4 Not run, blocked, or not covered

- **Container smoke test:** blocked by the environment (§4.2). It last passed for PR #7's head in its CI (run 38278710919, Node 22.23.2). That is evidence for PR #7, not for this commit.
- **GitHub CI:** not run for the repair (not pushed). PR #10's CI failed at typecheck, so **no CI run has ever executed the Phase 36 tests**.
- **CI coverage on the default branch:** the workflow on `5476f41` runs per-area subsets, which omit 15 test files that the full suite runs, including both gateway test files. It also does not run on pushes to `phase31/development`. PR #7 replaces the subsets with `npx vitest run` on Node 22.22.0 and 22.23.2 (§6).
- **Hosted database:** not contacted; no migration applied (not authorized). Hosted state is REPORTED at `0017`.
- **Node 24 and 26:** not tested.
- **Not exercised by any test:**
  - a process crash between the nested `job_write` insert and the consent insert (atomicity is shown by an in-transaction failure instead);
  - clock skew between the API and database servers;
  - the 120-per-hour B32 limit through the gateway;
  - load or soak behavior.

## 5. Worker fix provenance

- **Source:** `008a77f` on `phase35-1/release-remediation` (PR #7).
- **Copy:** `a7da2a0`, made with `git cherry-pick -x`. Identical diff; `git patch-id --stable` gives `431b5180735e…` for both.
- **Files:** `apps/api/src/lib/tsx-worker.mjs`, `apps/api/src/lib/worker-pool.ts`, `apps/api/tests/worker-bootstrap.test.ts`, and `test-support/source-workers/{resolution-worker,resolution-dep}.ts`.
- **Isolation:** no other Phase 35 change is on this branch; the diff against the base contains only the 5 files above plus Phase 36 files.
- **Baseline evidence** (`f86b577`, Node 22.22.0): 55 failed of 2744 in 10 files, all `*_WORKER_FAILED`. With the fix: those 10 files plus the regression test, 11 files / 112 tests passed.
- **PR #7:** open draft, approved by @shubham-0 on `3717a80`, now **conflicting** with the default branch (`mergeable_state: dirty`). Its CI run 38278710919 passed on both Node versions; that run is evidence for PR #7, not for this branch.
- **Node coverage of the fix:** `worker-bootstrap.test.ts` passed on Node 22.22.0 and 22.23.2 at `6163945`.

## 6. Migrations and integration

**Migration state:**

| Location | Highest migration |
|---|---|
| `phase31/development` @ `5476f41` | `0025_compute_gateway.sql` (merged by PR #10) |
| PR #7 @ `3717a80` | `0024`; adds none |
| `phase36/conversational-ai` @ `3016ec8` | Its own `0025_conversation_turns.sql` (a `create or replace` of `conversation_write` plus grants) |
| Local stack (2026-10-13) | `0001`–`0025` applied |
| Hosted | REPORTED `0017`; unverified |

**`0025` collision:** the conversational branch cannot merge with its `0025`. The Supabase ledger keys on the version prefix: a database that has `0025` recorded would skip it, and the CLI refuses duplicate versions. Git reports **no** conflict for the two different file names. The two migrations touch disjoint objects, so `0026` is a safe number for the conversational one.

**Resolved (2026-10-13):** `0025_compute_gateway.sql` keeps `0025`. After PR #7 merged, the conversational migration was renamed to `0026_conversation_turns.sql` on `phase36/conversation-turns-0026`, with byte-identical SQL and an updated upgrade test. The plan below is kept as the record.

**Coordination plan (PROPOSED; nothing renumbered):**
1. Land this repair, so the default branch typechecks.
2. Resolve PR #7's conflicts (below), run its full-suite CI on both Node versions, and merge it if the owner authorizes.
3. Only after the owner assigns the conversational work a roadmap slot and authorizes integration, renumber its migration to `0026` on that branch. That means:
   - renaming the file;
   - in `apps/api/tests/conversation-turns.integration.test.ts`, changing the `name < '0025'` filter to `< '0026'`, updating the migration file URL, and updating the describe title and comments;
   - merging the default branch in and resolving the same two additive conflicts;
   - regenerating the route catalog and OpenAPI;
   - running the full suite and local Supabase acceptance.
4. Before any hosted migration: a read-only check of the hosted ledger by an authorized operator, then staging, then production.

**PR #7 conflict resolution against `5476f41`** (`git merge-tree`, read-only; tree `d291f89`). Imports, `package.json` (including `test:compute`) and PR #7's workflow merge cleanly. Exactly three hunks need hand resolution, and all are additive:
1. **`apps/api/src/lib/http-protection.ts`, the `generate` route list:** take PR #7's version (which appends the three Phase 35 zone routes `…/zones/regeneration`, `…/zones/regeneration/verification` and `…/zones/partitions`, with their comment), and also add `'/api/projects/:projectId/compute/jobs'`.
2. **`apps/api/src/services/overview-service.ts`, `SERVICES`:** keep both the `COMPUTE_GATEWAY` row and PR #7's `ZONE_ASSESSMENT`, `ZONE_REGENERATION` and `ZONE_PARTITIONS` rows, with their comments.
3. **`apps/api/src/services/overview-service.ts`, `discovery()`:** return the union, `{ discoveryVersion, services, media, aiCapabilities, computeProviders: PROVIDERS, modelLimits: MODEL_LIMITS, unsupportedOperations: UNSUPPORTED_OPERATIONS }`.

Then regenerate `docs/modernization/openapi.json` and `api-routes.json` (`UPDATE_ROUTE_CATALOG=1` with `apps/api/tests/modernization.test.ts`). Run build, typecheck, lint and the full suite on both Node versions, plus local Supabase acceptance. PR #7's CI then runs the full suite, which covers the gateway tests for the first time in CI.

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
- **Engineering status (unchanged by Phase 36; `engineering/assess.ts`):**
  - `WIND_LOADS`, `SEISMIC_LOADS`, `GEOTECHNICAL_AND_FOUNDATIONS`, `LATERAL_DRIFT_AND_STABILITY` and `DYNAMIC_RESPONSE` carry `NO_VALIDATED_SOLVER` blockers, so their status is **`REQUIRES_SOLVER`**.
  - `MEMBER_DESIGN`, `PROGRESSIVE_COLLAPSE`, `VERTICAL_TRANSPORT` (lift traffic) and `CODE_COMPLIANCE` carry **`NOT_IMPLEMENTED`** blockers. They are not solver-pending capabilities: nothing is implemented for them.
  - A `SUCCEEDED` gateway job with `ACCEPTED_BY_SERVICE_VALIDATOR` means only that the engine service re-validated and stored its output (a scene artifact or an optimization study). It is not an engineering result.
  - All four gateway claims (`engineeringValidity`, `solverValidation`, `professionalReview`, `environmentReproducibility`) are `NOT_CLAIMED`.
  - No professional engineering validation exists or is implied.
- **Reproducibility:** inputs, input hash, source revision, model hash, algorithm version and Node version are recorded. Environment reproducibility is not claimed and was not demonstrated.

## 8. Owner actions

1. **Land the repair:** authorize pushing `phase36/typecheck-repair` and opening a PR into `phase31/development` (or apply the one-line diff in §4.1). The branch is committed locally and **not pushed**. Expect its CI subsets to pass typecheck; they still will not run the gateway tests until item 2.
2. **PR #7:** authorize resolving its three additive hunks (§6) on its branch. Then run its CI and decide on merging (it is approved, but still a draft).
3. **Conversational branch:** assign it a roadmap slot, or park it. Renumber its migration to `0026` only as part of an authorized integration (§6).
4. **Container smoke:** run `docker build -t designflow-api:ci . && node scripts/smoke-container.mjs designflow-api:ci` where the build can reach the npm registry (for example, in PR #7's CI on Node 22.23.2), or permit a CA-trusting build in this environment.
5. **Later:**
   - accept or correct the provisional roadmap;
   - D1–D7 and G7, G8, G12 for later gateway slices;
   - a hosted-migration plan.

Work stops here for owner review. Phase 37 has not been started.
