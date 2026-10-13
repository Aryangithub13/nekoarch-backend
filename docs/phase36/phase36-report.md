# Phase 36 report — compute gateway, first slice

**Status:** implemented and verified locally; ready for owner review. Not merged, tagged, deployed or applied to any hosted database.
**Authority:** the owner's implementation authorization of 2026-10-13, read against the provisional, repository-reconciled roadmap (`docs/roadmap-research-baseline` @ `a644225`, unmerged). The original roadmap and research documents have not been recovered. The documents on that branch are reconstructions and are not represented as originals.

## 1. Branch and commits

| Item | Value |
|---|---|
| Branch | `phase36/compute-gateway` |
| Base | `origin/phase31/development` @ `f86b577` (default branch; clean tree, up to date with upstream at start) |
| `a7da2a0` | `git cherry-pick -x 008a77f`: Node 22.22.0 source-mode worker fix, taken alone from PR #7 (see design §4) |
| `76c39c2` | The gateway: migration, routes, services, tests, regenerated route catalog and OpenAPI |
| Docs commit | This report, [phase36-design.md](phase36-design.md) and [phase36-api.md](phase36-api.md) |

Not touched: `phase36/conversational-ai` (`3016ec8`), `phase35-1/release-remediation` (`3717a80`, PR #7), `docs/roadmap-research-baseline` (`a644225`), all tags. No PR was opened.

## 2. What was added

- **Migration** `supabase/migrations/0025_compute_gateway.sql` (additive). It adds:
  - table `project_compute_dispatches`, which is immutable, owner-readable under RLS, and keyed by the quote hash, with cost, placement and provider columns pinned by checks;
  - functions `compute_write` and `compute_read`, plus the private builder `project_private.compute_dispatch`.
- **Routes:**
  - `POST /api/projects/:projectId/compute/quotes`
  - `POST /api/projects/:projectId/compute/jobs`
  - `GET /api/projects/:projectId/compute/jobs/:jobId`

  Exactly these three paths were added to `docs/modernization/openapi.json` and `api-routes.json`; no existing operation changed.
- **Code:**
  - new: `apps/api/src/compute/{contracts,gateway}.ts`, `apps/api/src/lib/compute-repository.ts`, `apps/api/src/routes/compute.ts`;
  - small hooks in `app.ts`, `config/env.ts` (`COMPUTE_POLICY`), `lib/{repository,supabase,http-protection,sentry}.ts`, `services/job-service.ts` (exports `signedJobSubmission`, now also used by `submitJob`), `services/overview-service.ts` (discovery), and `test-support/{pg-backend,openapi}.ts`.
- **Tests:**
  - `apps/api/tests/compute.test.ts`: 15 unit tests;
  - `apps/api/tests/compute.integration.test.ts`: 9 tests on embedded PostgreSQL;
  - `supabase/tests/database.test.ts` updated for the new table and its 3 foreign keys.

## 3. Authorized items → result

| # | Owner item | Result |
|---|---|---|
| 1 | Start from `phase31/development` after verification | Done (`f86b577`; clean tree; upstream equal; migrations `0001`–`0024`) |
| 2 | Dedicated branch; conversational branch untouched | Done |
| 3 | Local adapters only; remote disabled by default | Done. Remote is not just disabled by default: it cannot be enabled. `remoteExecution` accepts only `DISABLED`, and `placement: REMOTE` → `422 COMPUTE_PLACEMENT_DISABLED` (tested) |
| 4 | Polling only; no callbacks, credentials or recovery role | Done. B32 recovery-on-read is reused; nothing was added |
| 5 | Fail-closed policy, bounded inputs, timeouts, concurrency, resources, idempotency, audit | Done (design §3). Tested: refusals before any work, body limits, owner limits under a hanging worker, concurrent and repeated consent, malformed and refused worker output, immutable audit rows |
| 6 | Explicit consent; a quote is not authorization | Done. Quotes are signed, expiring and side-effect free (tested: no rows, no job). Consent must name the quote and set both accept flags |
| 7 | Reuse existing kinds after inspection; no solver kinds | `SCENE_COMPILE` and `OPTIMIZATION_STUDY` are eligible; `REVISION_EXECUTE` is excluded (reasons in design §2). No kind was added |
| 8 | Preserve `REQUIRES_SOLVER` / `NO_VALIDATED_SOLVER`; no validity claims | Engineering code is untouched. Phase 35 statuses are identical before and after a gateway job (tested), and every response carries `claims.*: NOT_CLAIMED` |
| — | Reproducibility metadata; no environment claim | Inputs, input hash, source revision and model hash, algorithm version, Node version and bounds are recorded. `reproducibility: NOT_CLAIMED` |
| — | Worker-pool issue on Node 22.22.0 | It affects the gateway, since both eligible kinds run in those pools. Only `008a77f` was isolated and cherry-picked, not the rest of Phase 35 |
| — | Migration numbering on both branches | `0025` is free on the default branch; `phase36/conversational-ai` also uses `0025`. See §6 |

## 4. Verification (exact)

**Environment:**
- Node `v22.22.0`, Linux container.
- Checks ran as a non-root user, because embedded PostgreSQL refuses root, with `LANG=en_US.UTF-8`.
- Commands from the repository root: `npm run build`, `npm run typecheck`, `npm run lint`, `npx vitest run`.

| Run | Commit | build | typecheck | lint | vitest |
|---|---|---|---|---|---|
| Baseline | `f86b577` | 0 | 0 | 0 | **exit 1**: 88 files (10 failed); 2744 tests, **55 failed**, 2689 passed. All 55 are `*_WORKER_FAILED` from the Node 22.22.0 source-mode worker defect |
| Worker fix only | `a7da2a0` | — | — | — | the 10 previously failing files plus `worker-bootstrap.test.ts`: **11 files, 112 tests, all passed** |
| Final | `76c39c2` | 0 | 0 | 0 | **exit 0: 91 files, 2771 tests, all passed** (489.75 s) |

The final count is the baseline plus the new tests: 2744 + 3 (`worker-bootstrap`) + 15 (`compute`) + 9 (`compute.integration`) = 2771.

The baseline's 10 failing files were account.integration, jobs.integration, modernization.integration, optimization-pool, optimization.integration, references.integration, references, revision.integration, scene-pool and scene.integration.

The docs commit changes Markdown only; the checks were not re-run for it.

**Not run, or unavailable:**
- Container smoke test and local Supabase acceptance: they need Docker images, and image pulls from Docker Hub returned `429` in this environment earlier in the session.
- Node 22.23.2, the second CI version: not installed here.
- GitHub Actions CI: no PR exists, and per the authorization none was opened, so CI has not run on this branch.
- Hosted migration: not authorized, and not applied.

Raw logs from this run were kept in the session container only and are not committed.

## 5. Unsupported in this slice

- Remote or metered execution, and paid providers.
- Callbacks, and background recovery without an owner read.
- Solver execution, fan-out/fan-in, checkpoints and recomputation.
- Content-addressed result caching.
- Gateway-level cancellation (use B32 `POST …/jobs/:jobId/cancel`).
- Per-provider circuit breaking.
- Environment-reproducibility claims.
- Jobs submitted through the plain B32 route have no consent record and read as `COMPUTE_JOB_NOT_FOUND` through the gateway.

## 6. Decisions for the owner

1. **Migration-number collision.** This branch and `phase36/conversational-ai` both add `0025`. Whichever merges second must renumber its migration (and the upgrade test that names it) before merging.
2. **PR #7.** `a7da2a0` duplicates `008a77f` byte-for-byte. Merging PR #7 first, or after this branch, should apply cleanly, but it is unreviewed, and this branch depends on that fix for green worker tests on Node 22.22.0.
3. **Roadmap authority.** The provisional roadmap and research reconstruction on `docs/roadmap-research-baseline` are not merged. They should be reviewed or merged before later phases rely on them.
4. **Open roadmap decisions:**
   - D1: remote provider(s).
   - D2: a non-user recovery role.
   - D3: callbacks.
   - D4: budget unit and ceilings for metered work.
   - D5: recovery of the original research.
   - D6: further eligible kinds.
   - D7: privacy policy for remote data transfer.
   - Requirements left open: G7 (fan-out, checkpoints), G8 (environment digests, queue isolation), G12 (solver execution).
5. **Before any deployment:**
   - CI on both Node versions;
   - container smoke test;
   - Supabase acceptance;
   - a hosted-migration plan, since the hosted database is reported at `0017`, unverified.

## 7. Residual limitations

- The owner-wide limits (`maxActivePerOwner`, `maxConsentedPerOwnerPerDay`) count only gateway dispatches. Plain B32 submissions are bounded by B32 and B33 limits, not by these.
- `COMPUTE_QUOTE_STALE` and `COMPUTE_QUOTE_CONFLICT` are defensive. Revisions are immutable and the quote hash is signed, so neither is reachable through normal use, and neither has an integration test.
- Quote expiry uses the API server's clock, and the daily consent limit uses the database clock.
- A quote may be consented to only once, so new work needs a new quote even after a failure.

Per the authorization, work stops here for owner review.
