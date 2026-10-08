# Phase 28 API — optimization studies

Root: `/api/projects/:projectId/revisions/:revisionId/optimization`. All routes need a Supabase session and are owner-only. A foreign or unknown project, revision or study returns **404**. GET routes never compute.

Studies are **advisory proposals**. No route changes a revision, the current revision, BIM, or any analysis. Every candidate has `architectureMutation: "NONE"`.

## `POST /validate`
Body: `optimization-input-v1` ([design §3](phase28-design.md)). This runs on the main thread in about 1 ms and only checks the request: eligibility, schema and semantics, and the exact BigInt search-space size. It never generates candidates or persists anything. `200` → `{ readiness: 'READY', candidateSpaceSize, strategy, mode, variables, objectives, limits, engineering, claims }`.

## `POST /studies` (compute quota; idempotent with `Idempotency-Key`)
Cheap refusals happen on the main thread. The study then runs in the **bounded worker pool**, and the result is persisted through the signed `optimization_write` RPC, which recomputes the binding, `inputHash`, `resultHash` and every candidate ID in SQL.

`201` → `{ id, projectRevisionId, acceptanceQaId, studyVersion, optimizerVersion, modelHash, inputHash, resultHash, strategy, mode, status, candidateCount, validCount, searchResult, recommendedCandidates, createdAt, snapshot }`.

- Replay with the same key and body returns the same study. Identical inputs converge on one immutable row.
- **Adoption** is only through the existing `POST …/revisions/generate`. Apply a candidate's `adoption.parametricEdits` atomically to the revision's `normalizedRequirements`; the new revision reproduces the candidate's `modelHash`.

## `GET /studies?limit=1..100&cursor=…` · `GET /studies/:studyId[?require=current]` · `GET /status`
- Summaries carry `currency` (`CURRENT` / `STALE`), and pagination is stable on `(createdAt, id)`.
- `require=current` on a superseded revision returns `409 OPTIMIZATION_RESULT_STALE`.
- `/status` lists the revision's studies and other revisions' `staleStudies` (`BOUND_TO_A_DIFFERENT_REVISION`).

## Errors
| Status | Code | When |
|---|---|---|
| 400 | `OPTIMIZATION_INPUT_INVALID` | Schema or semantics; non-integer JSON numbers (send decimals as strings) |
| 401 | `UNAUTHORIZED` | No session |
| 404 | `…_NOT_FOUND` | Not the owner's, or unknown |
| 409 | `IDEMPOTENCY_CONFLICT` / `OPTIMIZATION_RESULT_STALE` | Key reuse / `require=current` |
| 422 | `OPTIMIZATION_UNSUPPORTED` | Non-parametric source (`SOURCE_GENERATOR_UNSUPPORTED`), deferred metric, non-null `sources.*`, entity-selector cost spec |
| 422 | `OPTIMIZATION_RESOURCE_LIMIT` | Grid space over 128, input size or depth, 45 s deadline |
| 422 | `OPTIMIZATION_BASELINE_MISMATCH` / `REVISION_NOT_ACCEPTED` / `OPTIMIZATION_RESULT_INVALID` | Source drift / no accepted QA / SQL provenance (P2803) |
| 503 | `OPTIMIZATION_QUEUE_FULL` / `_WORKER_TIMEOUT` / `_WORKER_FAILED` / `_UNAVAILABLE` | Capacity, 60 s ceiling, crash or malformed output, shutdown (`Retry-After: 30`); **never stores a study** |

## Execution model
- A fixed `worker_threads` pool of `min(2, CPUs − 1)`, created lazily and drained on close.
- A queue of 4.
- A 60 s per-study ceiling (worker terminated). The worker heap is capped at 512 MiB.
- The main thread does about 1 ms of precheck per request plus persistence.
