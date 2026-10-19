# Phase 32 API — durable generation jobs

All routes are additive. The route catalog grows from 104 to 110 entries ([api-routes.json](../modernization/api-routes.json)). The synchronous Phase 28–30 routes are unchanged.

| Property | Value |
|---|---|
| Authentication | Supabase bearer session; anonymous → 401 |
| Foreign or unknown project/job | 404 (RLS plus owner checks in every `SECURITY DEFINER` function) |
| Writes | Signed (HMAC envelope bound to user, route template, exact input and idempotency context); runner writes are additionally fenced by a lease token |
| Idempotency | `Idempotency-Key` on submit. Independently, an identical active job (same kind and canonical request) is returned instead of queued twice (`deduplicated: true`). |
| Rate-limit groups | Submit and retry → `generate`; cancel → `write`; reads → `read` |
| Schemas | Zod v3 in `apps/api/src/jobs/contracts.ts`; exported to [openapi.json](../modernization/openapi.json) |

`ROOT = /api/projects/:projectId/jobs`

| Method & path | Body | Success | Notes |
|---|---|---|---|
| `POST ROOT` | `JobRequest` (below) | 202 `JobDetail` with `Location` and `Retry-After: 1`; 200 with `deduplicated: true` | A missing revision/operation is refused at submission (404). 429 `JOB_LIMIT_EXCEEDED` beyond 4 active or 120 submitted per hour per project. 503 `JOBS_UNAVAILABLE` without `PROJECT_COMMIT_SECRET`. |
| `GET ROOT?limit&cursor&status&kind` | — | 200 `{ items: JobSummary[], nextCursor }` | Newest first. Runs recovery first. |
| `GET ROOT/:jobId` | — | 200 `JobDetail` | Runs recovery first: an expired lease is requeued (or failed when attempts are exhausted) and due jobs are dispatched. |
| `GET ROOT/:jobId/events?after&limit` | — | 200 `{ jobId, status, events: JobEvent[], nextAfter }` | Incremental: pass the previous `nextAfter`. Runs recovery first. |
| `POST ROOT/:jobId/cancel` | `{}` | 200 `JobDetail` | Queued → `CANCELLED` at once. Running → `cancelRequested: true`, honoured at the next stage boundary (see design §2). Finished → 409 `JOB_INVALID_TRANSITION`. |
| `POST ROOT/:jobId/retry` | `{}` | 200 `JobDetail` (`QUEUED`) | Only a `FAILED` job whose failure is retryable, at most 3 times; otherwise 409 `JOB_NOT_RETRYABLE`. A retry makes the job active again, so it counts against the same limits as a submission (`0031`): 429 `JOB_LIMIT_EXCEEDED` beyond 4 active per project, 429 `ACCOUNT_QUOTA_EXCEEDED` beyond 8 active per owner. |

## JobRequest

| `kind` | Fields | Equivalent synchronous route |
|---|---|---|
| `SCENE_COMPILE` | `revisionId` | `POST …/revisions/:revisionId/scene/artifacts` |
| `OPTIMIZATION_STUDY` | `revisionId`, `input` (the Phase 28 optimization input) | `POST …/revisions/:revisionId/optimization/studies` |
| `REVISION_EXECUTE` | `operationId`, `preflightHash`, `consent: { acceptLocks: true, acceptQuote: true }` | `POST …/revision-operations/:operationId/execute` |

## JobDetail (summary)

`id, projectId, ownerId, kind, status (QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED), jobVersion, inputHash, attempt, maxAttempts (3), userRetries, notBefore, leaseExpiresAt, cancelRequested, progress { stage (QUEUED | VALIDATING | COMPUTING | PERSISTING | DONE), percent, message }, result { resultKind, resultId, href } | null, failure { code, message, retryable, attempt } | null, lastFailure, createdAt, updatedAt, finishedAt, request`

`result.href` is the existing Phase 28–30 read route for the produced artifact. `failure.code` is the typed error code the synchronous route would have returned.

## Client pattern

```text
POST ROOT → 202 { id } ─► every ~1 s: GET ROOT/:id/events?after=<nextAfter>  (render progress)
                       └─► status SUCCEEDED → GET result.href
                           status FAILED and failure.retryable → offer POST ROOT/:id/retry
```

A tab that is closed and reopened, or a server restart, loses nothing: the next `GET` recovers the job.
