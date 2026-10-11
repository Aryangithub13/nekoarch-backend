# Phase 32 report — durable generation jobs, progress & recovery

**Final status: PHASE 32 IMPLEMENTED; VERIFIED WITHIN SUPPORTED SCOPE ON THIS MACHINE (Windows), WITH THE EXCEPTIONS IN §F.**

## A. Summary

Scene compilation, optimization studies and revision execution can now run as durable jobs. The submission returns `202` immediately; state, stage progress, events, result and typed failure live in PostgreSQL. Each job is handled as follows:
- Transient failures (worker capacity, crash or timeout; database availability) are retried automatically with 2 s and 8 s backoff, up to 3 attempts.
- Permanent failures (4xx, missing configuration, unexpected exceptions) fail at once with the operation's own typed error.
- A process that dies mid-job leaves an expired lease. The owner's next read requeues the job and runs it again; the dead worker is fenced off by its stale lease token.
- Owners can cancel jobs and retry retryable failures.
- Identical active jobs are deduplicated.

Jobs run the unchanged Phase 28–30 services with the owner's own credentials, so every existing check applies unchanged.

## B. Source baseline

| Item | Value |
|---|---|
| Base | `be77e53` (Phase 31 plus a test-typing fix) on `phase31/secure-reference-ingestion` |
| Branch | `phase32/durable-jobs` |
| Protected | Migrations 0001–0021 untouched; synchronous routes and contracts unchanged |

## C. Implementation

| Area | Files |
|---|---|
| Contracts | `apps/api/src/jobs/contracts.ts` |
| Runner (lease, heartbeat, stages, cooperative cancel, classification, automatic retry, shutdown release) | `apps/api/src/jobs/runner.ts` |
| Executors (adapters to Phase 28–30 services) | `apps/api/src/jobs/executors.ts` |
| Persistence | `supabase/migrations/0022_durable_jobs.sql`: jobs and events tables, transition trigger, lease fencing, recovery, limits, signed `job_write`, `job_read` |
| Storage boundary | `apps/api/src/lib/job-repository.ts`; `jobRpc` in `lib/supabase.ts` and `test-support/pg-backend.ts` |
| Service and routes | `apps/api/src/services/job-service.ts`, `apps/api/src/routes/jobs.ts` (6 routes) |
| App | Scene, optimization and appearance pools are now created once in `buildApp` and shared by the synchronous routes and the runner; the runner drains in `preClose`, before the pools close |
| Integration | Discovery `DURABLE_JOBS`; Sentry safe routes; `generate` rate-limit group for submit/retry; OpenAPI and route catalog regenerated (104 → 110) |

## D. Verification

| Suite | Result |
|---|---|
| Phase 32 unit (`jobs.test.ts`: classification, strict requests, runner stages, cancel at boundary and before start, typed failures, lease loss, single dispatch, heartbeat, shutdown release) | 21/21 |
| Phase 32 integration on embedded PostgreSQL (`jobs.integration.test.ts`: three kinds end to end; same artifact as the synchronous route; permanent failure; transient retries 2 s → 8 s → retryable FAILED; crash recovery and fencing; exhausted attempts and user retry; dedupe, cancel, limits; tenancy and trigger guards) | 8/8 |
| Unit and conformance suites (all `test:unit` files plus Phase 31/32, pools, scene, optimization, revision, modernization) | 2 345/2 346. The one failure is the pre-existing Windows path assertion in `interpretation.test.ts`. |
| Integration suites touching the shared pools (scene, optimization, revision, references, modernization) | 57/57 assertions. Files report the known Windows `EBUSY` teardown error only. |
| Build, typecheck, lint | Clean |

The repository typecheck also found two type errors in the Phase 31 integration test (Vitest does not typecheck); they were fixed in `be77e53`.

## E. Limitations

- **Recovery is owner-driven** (on the next read). A job nobody reads is not recovered until someone does; a background sweeper needs a non-user execution identity (Phase 36).
- **Progress** is stage-based, not a time estimate. There is no push channel (SSE/websocket); clients poll `events?after=`.
- **`REVISION_EXECUTE`** is cancellable only before it starts.
- **A job runs with the dispatching request's session token.** Jobs are bounded (≤ 20 s of compute), so token expiry during a job is not expected, but it is not refreshed.

## F. Not covered

The Supabase live stack (no Docker on this machine) and the frontend were not exercised. Migrations 0018–0022 are not applied to the hosted Supabase project.
