# Phase 32 design — durable generation jobs, progress & recovery

## 1. Principle

Long operations become **durable jobs**: the request that submits one returns `202` with a job id immediately, and the job's state, progress and outcome live in PostgreSQL rather than in a process. A crash, restart or dropped connection never loses a job. It is recovered, retried within bounds, or failed with a typed reason.

Jobs **do not add new engines**. They run the existing, independently verified Phase 28–30 service functions unchanged, and those functions keep all their checks (ownership, QA acceptance, signed writes, hash re-computation in SQL). The synchronous routes stay as they are; jobs are an additional, asynchronous way to call the same operations.

Roadmap mapping (B32): *"persistent queues, progress events, retries, cancellation and recovery … prevents long tasks from losing state after interruptions."* The Phase 30 report assigns "durable jobs, progress, restart recovery for revision execution" to Phase 32, and the Phase 31 design defers asynchronous scanning to it.

## 2. Supported matrix (V1)

| Job kind | Runs | Retry-safe because | Result |
|---|---|---|---|
| `SCENE_COMPILE` | `createSceneArtifact` (Phase 29) | `scene_write` converges on `(revision, input_hash)`; an identical rerun returns the existing artifact | `SCENE_ARTIFACT` id |
| `OPTIMIZATION_STUDY` | `createOptimizationStudy` (Phase 28) | `optimization_write` converges on `(revision, input_hash)` | `OPTIMIZATION_STUDY` id |
| `REVISION_EXECUTE` | `executeOperation` (Phase 30) | An interrupted execute leaves the operation `AWAITING_CONSENT`; a completed one returns `CANDIDATE_READY` again | `REVISION_OPERATION` id |

| Capability | Status |
|---|---|
| Persistent queue, per-job state machine, audit/progress events | **AVAILABLE** |
| Stage-based progress (`QUEUED`, `VALIDATING`, `COMPUTING`, `PERSISTING`, `DONE`) with percent | **AVAILABLE**. Progress is reported at stage boundaries; it is not a time estimate. |
| Automatic retry of transient failures (worker capacity, timeout or crash; database unavailable) with backoff, ≤ 3 attempts | **AVAILABLE** |
| Cancellation (queued: immediate; running: cooperative at the next stage boundary, result discarded) | **AVAILABLE**. A running `SCENE_COMPILE` or `OPTIMIZATION_STUDY` is cancellable up to the compute → persist boundary (`onRun`). `REVISION_EXECUTE` exposes no such boundary, so it is cancellable only before it starts; a running one completes, and its candidate can still be cancelled through the Phase 30 operation. |
| Crash recovery via leases and fencing tokens | **AVAILABLE**, triggered by the owner's next read (§6) |
| Duplicate suppression: an identical active job is returned instead of queued twice | **AVAILABLE** |
| Server-sent events / websockets | **Not in V1**: clients poll `GET …/events?after=` (incremental). |
| Recovery without any client activity (background sweeper) | **Not in V1** (§6, §12) |
| Jobs for analyses (structural, environmental, systems, knowledge), takeoff, cost | **Not in V1**: they complete in well under a second and stay synchronous. |
| Anti-malware scanning job for references | **Not in V1**: no scanner provider exists (Phase 31 §2). The job model is the integration point. |

## 3. Contracts (`apps/api/src/jobs/contracts.ts`)

| Concept | Representation |
|---|---|
| `JobKind` | `SCENE_COMPILE \| OPTIMIZATION_STUDY \| REVISION_EXECUTE` |
| `JobRequest` | Discriminated by `kind`: `{ kind: SCENE_COMPILE, revisionId }`, `{ kind: OPTIMIZATION_STUDY, revisionId, input }`, `{ kind: REVISION_EXECUTE, operationId, preflightHash, consent }` |
| `JobStatus` | `QUEUED \| RUNNING \| SUCCEEDED \| FAILED \| CANCELLED` |
| `JobProgress` | `{ stage, percent (0–100), message }` |
| `JobFailure` | `{ code, message, retryable, attempt }` (the typed API error of the underlying operation, never internals) |
| `JobResult` | `{ resultKind, resultId, href }` |
| `JobDetail` | Identity, kind, status, request, input hash, attempt / max attempts, `notBefore`, lease expiry, `cancelRequested`, progress, result, failure, timestamps |
| `JobEvent` | `{ seq, eventType, detail, createdAt }`, with `seq` strictly increasing per job |

## 4. State machine (persisted, enforced by a SQL trigger)

```text
submit ─► QUEUED ──start(lease)──► RUNNING ──complete──► SUCCEEDED
            ▲  │                     │  │ ├─fail (permanent or attempts exhausted)─► FAILED ─retry(user)─► QUEUED
            │  └─cancel─► CANCELLED  │  │ └─cancel honoured at a stage boundary──► CANCELLED
            └──── requeue (transient failure with attempts left, or expired lease) ┘
```

- `start` is a compare-and-set: only a `QUEUED` job whose `not_before` has passed can start. It increments `attempt` and issues a fresh `lease_token` with `lease_expires_at = now + 30 s`.
- `heartbeat` / `progress` / `complete` / `fail` must present the current `lease_token`. A worker whose lease was recovered by another instance is **fenced off**: its late writes are refused (`P3203`), so a stale worker can never overwrite a newer attempt.
- `requeue` sets `not_before = now + backoff(attempt)` (2 s, 8 s), keeps the failure as `lastFailure`, and clears the lease.
- Terminal states are immutable. `retry` is a user action that re-opens a `FAILED` job with a retryable failure as a new `QUEUED` attempt cycle (≤ 3 user retries).

## 5. Execution (`apps/api/src/jobs/runner.ts`)

- **In-process runner.** After a successful `submit` (and after any recovery), the API calls `runner.dispatch(job, repository, userId)`. The runner starts the job (`start`), runs the matching executor with the caller's repository, then records `complete` or `fail`.
- **Executors** call the Phase 28–30 service functions with the same pools the synchronous routes use. The pools are shared, so jobs and synchronous calls compete for the same bounded capacity.
- **Heartbeat** every 10 s extends the lease while an executor runs.
- **Stages:** `VALIDATING` (10 %) → `COMPUTING` (30 %) → `PERSISTING` (90 %) → `DONE` (100 %). Cancellation is checked at each boundary; a cancel observed after `COMPUTING` discards the result before `PERSISTING`.
- **Failure classification:** an `ApiError` ≥ 500 or a pool failure (`*_QUEUE_FULL`, `*_WORKER_TIMEOUT`, `*_WORKER_FAILED`) is transient. Any other `ApiError` (4xx: invalid input, unsupported model, not accepted, conflict) is permanent and fails the job immediately with that error's code.
- **Shutdown:** on close the runner stops starting jobs, waits up to 5 s for running executors, and requeues the jobs it still holds (`release`), so recovery does not have to wait for the lease to expire.
- **Credentials:** a job runs with the credentials of the request that dispatched it (the submitting or polling owner). No token is stored and no service-role key is needed. Jobs are bounded (≤ 20 s compute), so short-lived session tokens suffice.

## 6. Recovery

Every owner read of a job or the job list runs `recover` first, in one SQL statement per project:
- A `RUNNING` job whose lease has expired (the process died) is requeued if attempts remain, or failed with `JOB_INTERRUPTED` otherwise. A `LEASE_EXPIRED` event is recorded.
- After recovery, the API dispatches due `QUEUED` jobs (`not_before` passed, not held by this process) with the reader's credentials.

So any job is recovered within one poll interval of a client looking at it. A job nobody ever looks at stays `QUEUED` or `RUNNING` with an expired lease. That is honest and loses nothing: its outcome was never observed, and the next read resolves it. A background sweeper would need credentials that do not belong to a user (a service role), which the API deliberately does not hold (§12).

## 7. Persistence (migration `0022_durable_jobs.sql`)

| Table | Content |
|---|---|
| `project_jobs` | Project (FK, cascade), owner, kind, status, request JSON (≤ 64 KiB) and `input_hash` (SHA-256 of the canonical request), `attempt`, `max_attempts` (3), `user_retries`, `not_before`, `lease_token`, `lease_expires_at`, `cancel_requested`, progress JSON, result JSON, failure / last-failure JSON, timestamps. Partial unique index on `(project_id, kind, input_hash)` while `QUEUED` or `RUNNING` |
| `project_job_events` | `(job_id, seq)` primary key; `SUBMITTED`, `DEDUPLICATED`, `STARTED`, `PROGRESS`, `HEARTBEAT` (not stored: it only extends the lease), `CANCEL_REQUESTED`, `REQUEUED`, `LEASE_EXPIRED`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `RETRIED`, `RELEASED`; detail ≤ 4 KiB |

**Invariants in SQL:**
- RLS: owner select on jobs and events.
- Writes only through signed `SECURITY DEFINER` `job_write` (HMAC envelope over user, route template, exact input and idempotency context).
- A transition trigger enforces §4; identity columns are immutable; terminal rows are immutable; events are append-only.
- Lease fencing on every runner action.
- Limits per project: ≤ 4 active jobs (`QUEUED` + `RUNNING`), ≤ 120 submissions per hour (`P3204` → 429 `JOB_LIMIT_EXCEEDED`).

Error family `P32xx`: `P3201` job not found, `P3202` invalid transition, `P3203` lease lost (stale worker), `P3204` limit, `P3205` not retryable.

## 8. API (all under the owner's project; full list in [phase32-api.md](phase32-api.md))

`ROOT = /api/projects/:projectId/jobs`

- `POST ROOT` — submit (`JobRequest`) → 202 `JobDetail` (`Location` header), or 200 with `deduplicated: true` when an identical job is active.
- `GET ROOT?status&kind&limit&cursor` — list (runs recovery).
- `GET ROOT/:jobId` — detail (runs recovery).
- `GET ROOT/:jobId/events?after&limit` — incremental progress/audit events.
- `POST ROOT/:jobId/cancel` — cancel.
- `POST ROOT/:jobId/retry` — re-open a failed, retryable job.

Catalog 104 → 110 routes. Submit and retry are charged to the `generate` quota. A `202` carries `Retry-After: 1` as a polling hint.

## 9. Threat model (summary)

| Threat | Control |
|---|---|
| Cross-tenant job read, cancel or result | RLS + owner checks in every definer function; executors run with the owner's credentials, so every underlying check applies unchanged |
| Stale worker overwrites a newer attempt | Lease token fencing in SQL on every runner write |
| Double execution after a crash | CAS start; retry-safe operations by construction (§2) |
| Queue flooding | Per-project active and hourly limits; `generate` rate-limit group; duplicate suppression |
| Retry storm | Bounded attempts with backoff; permanent errors are never retried; ≤ 3 user retries |
| Leaking internals through failures | Failures carry only the typed public API error |

## 10. Verification plan

- **Unit:** failure classification; stage/cancel sequencing in the runner with fake executors; heartbeat cadence; shutdown release.
- **Integration (embedded Postgres):** submit → poll → result for each kind, with the result identical to the synchronous route's; duplicate suppression; cancel queued and running jobs; transient failure → requeue with backoff → success; permanent failure → `FAILED` without retry; user retry; crash simulation (lease expired in SQL) → recovery on read → completion; fencing (a write with an old lease token is refused); limits; cross-tenant 404; trigger refusals.
- **Conformance:** catalog, OpenAPI, Sentry safe routes, rate-limit group, discovery `DURABLE_JOBS`.

## 11. Compatibility

All synchronous Phase 28–30 routes, contracts and responses are unchanged. The jobs API is additive.

## 12. Out of scope

| Item | Phase |
|---|---|
| Background sweeper / scheduled recovery without client activity (needs a non-user execution identity) | 36 (governed compute gateway) |
| Push progress (SSE/websocket) | 45 (desktop delivery & API integration) |
| External compute workers and remote queues | 36 |
| Jobs for reference scanning, rendering and AI generation | 31 follow-up / 39 / 43, when providers exist |
| Per-user job quotas and settings | 33 |
