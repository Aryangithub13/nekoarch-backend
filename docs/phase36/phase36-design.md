# Phase 36 design — Cloud Engineering Compute Gateway, first slice

**Branch:** `phase36/compute-gateway`, from `phase31/development` @ `f86b577`.
**Scope authority:**
- the owner's authorization of 2026-10-13 (first bounded slice);
- the provisional, repository-reconciled roadmap on `docs/roadmap-research-baseline` (`a644225`, §4: Phase 36 requirements G1–G13). That branch is not merged.

The roadmap paraphrase in [phase36-handoff.md](phase36-handoff.md) and the plan in `origin/main:docs/audit/B36-implementation-handoff-2026-10-12.md` are inputs. Neither is the original roadmap, which has not been recovered.

## 1. What this slice is

A governed front door to the existing B32 durable jobs: **quote → explicit consent → durable job → polling**. Execution happens only on the existing local worker pools, and remote execution is disabled. The slice adds governance (consent, policy, limits, audit records) around compute that already exists. It does not add new compute.

| Approved item | Implementation |
|---|---|
| Base `phase31/development`; dedicated branch; conversational branch untouched | `phase36/compute-gateway` from `f86b577`; `phase36/conversational-ai` (`3016ec8`) not touched |
| Local adapters only; remote disabled by default | Provider `local-pool` (the Phase 28/29 pools). `remote-http-worker` is listed `DISABLED`; no remote adapter code exists. `COMPUTE_POLICY.remoteExecution` accepts only `DISABLED`, so any attempt to enable it fails startup |
| Polling; no callbacks, new database credentials or background-recovery role | `GET …/compute/jobs/:jobId` uses the B32 read with recovery-on-read. No callback route, role, credential, sweeper or timer was added |
| Fail-closed authorization and policy; bounded inputs, timeouts, concurrency, idempotency, audit metadata | See §3 |
| Explicit consent; a quote is not authorization | The quote states `authorization: NOT_AUTHORIZED_UNTIL_CONSENT`. Work starts only on `POST …/compute/jobs` with `consent { quoteHash, acceptQuote: true, acceptLocalExecution: true }` |
| Existing job kinds only, after inspection; no solver kinds | §2 |
| `REQUIRES_SOLVER` and `NO_VALIDATED_SOLVER` preserved; success is not engineering validity | No engineering code is touched. Results report `resultCheck: ACCEPTED_BY_SERVICE_VALIDATOR`, and every response carries `claims.engineeringValidity: NOT_CLAIMED` (tested: Phase 35 domain statuses identical before and after a gateway job) |

**Excluded (pending evidence and a separate plan):**
- solver execution;
- fan-out/fan-in;
- checkpoints;
- callbacks;
- paid or remote providers;
- a new database role or sweeper;
- content-addressed caching;
- environment-reproducibility claims.

## 2. Eligible job kinds (inspected)

| Kind | Eligible | Reason |
|---|---|---|
| `SCENE_COMPILE` | Yes | Deterministic Phase 29 compiler. The pool re-parses worker output, and the service checks the GLB SHA-256 and source binding before its signed write. The output is a derived artifact of a revision, and no model changes |
| `OPTIMIZATION_STUDY` | Yes | Deterministic Phase 28 engine. The pool re-validates the study schema, and the service persists it through its signed, recomputing write. The output is advisory, and no model changes |
| `REVISION_EXECUTE` | **No** | It already has its own Phase 30 preflight, quote and consent; it cannot be cancelled once running; and it feeds a revision-change flow. Refused with `422 COMPUTE_KIND_UNSUPPORTED` |
| Engineering solvers | None exist | No kind is added, and Phase 35 blockers stay |

## 3. Safety properties

| Property | Mechanism |
|---|---|
| Consent bound to exactly what was shown | HMAC-SHA256 over `(quote-v1, userId, canonical hash of the quote)` with the server commit key. Any changed field, another user, another project or another server secret → `409 COMPUTE_QUOTE_INVALID`; a past `expiresAt` → `COMPUTE_QUOTE_EXPIRED`; a consent naming another quote → `COMPUTE_CONSENT_MISMATCH`. Comparison is constant-time |
| Fail closed before any work | Order: ownership (404), quote and consent checks, policy (placement, kind, request ≤ 64 KiB), the engine's read-only validator, and a source revision and model-hash re-check. Only then the SQL write |
| Atomic consent record | `compute_write` (signed envelope) locks the project and, through an advisory lock, the owner. It checks limits, verifies that the nested signed B32 `job_write` call is exactly the consented work (kind, input hash, request), runs it in the same transaction, and inserts the dispatch record |
| Idempotency | The quote hash is the dispatch's primary key. Repeating a consent returns the job it started (`200`, `replayed: true`), even after the job finished. New work needs a new quote. B32 dedup (one active job per project, kind and input) still applies |
| Cost protection | Local only: `costClass FREE`, `ceilingMinor 0`, `dataTransfer NONE`, pinned by column checks. Owner-wide limits from policy: `maxActivePerOwner` (default 2) and `maxConsentedPerOwnerPerDay` (default 50) → `429 COMPUTE_LIMIT_EXCEEDED`. B32 (≤ 4 active per project, ≤ 120 submissions per hour) and B33 (≤ 8 active jobs per owner) still apply |
| Bounded execution | Unchanged local pools: fixed size (≤ 2), bounded queue, per-job wall-clock timeout, worker heap limit; B32 leases, fencing, ≤ 3 attempts with backoff, cancellation. The quote declares these bounds |
| Output validation | Unchanged pool and service validators. Malformed worker output and typed refusals end in `FAILED` with no stored artifact (tested) |
| Audit metadata | `project_compute_dispatches` is immutable and readable only by its owner. It records the quote hash, job, owner, kind, placement, provider, input hash, source revision and model hash, cost fields, the full quote (algorithm and versions, declared bounds, Node version, issue and expiry times) and the consent time |
| Reproducibility | Inputs, algorithm versions and the Node version are recorded. `runtime.reproducibility` and `claims.environmentReproducibility` are `NOT_CLAIMED`: no environment digest exists and nothing was demonstrated |
| Credentials | None added. Quotes are signed with the existing server commit key, which is never exposed |
| Observability | Logs `compute quote issued`, `compute dispatch consented` and `compute job polled`, with project, job, kind, placement, provider, quote hash, status, `replayed` and duration. Request bodies, payloads and secrets are not logged (tested) |

## 4. Worker-pool compatibility (Node 22.22.0)

The base `f86b577` has the source-mode worker defect: on Node 22.22.0, 55 tests in 10 files fail with `*_WORKER_FAILED`. The gateway's checks run through those pools. The fix exists as `008a77f`, but only on the unreviewed PR #7. As authorized, only that commit was cherry-picked (`a7da2a0`, `-x`; 5 files including its regression test), not the rest of Phase 35. On its own it turns the 10 failing files green (11 files, 112 tests, including its regression test). Because the patch is identical, merging PR #7 later should not conflict with it.

## 5. Migration

`0025_compute_gateway.sql` is additive:
- table `project_compute_dispatches` (3 foreign keys, RLS owner select, immutable);
- functions `compute_write`, `compute_read` and `project_private.compute_dispatch`.

No existing table, function or row changes, and no role or grant beyond `authenticated` execute.

**Number.** `0001`–`0024` exist on the base, and `0025` is free there. The only other `0025` is on the unmerged `phase36/conversational-ai` (a function-only replacement of `conversation_write`). Whichever of the two merges second must renumber (owner decision).

Hosted: **not applied.** The hosted database is reported at `0017` (unverified), so `0018`–`0024` precede it.

## 6. API

See [phase36-api.md](phase36-api.md).

## 7. Remaining decisions and unsupported capabilities

- **Owner decisions:**
  - **D1:** remote provider(s).
  - **D2:** a non-user recovery role.
  - **D3:** callbacks.
  - **D4:** budget unit and ceilings for metered work.
  - **D5:** the original research.
  - **D6:** further eligible kinds.
  - **D7:** privacy policy for remote transfer.
  - **G7** fan-out/fan-in, checkpoints and recomputation; **G8** environment digests and queue isolation; **G12** solver execution.
- **Unsupported in this slice:** remote or metered execution, callbacks, background recovery without an owner read, content-addressed caching of results, gateway cancellation (use B32 `POST …/jobs/:jobId/cancel`), and per-provider circuit breaking (only one local provider exists).
- A job submitted through the plain B32 route has no consent record, and the gateway's read reports it as `COMPUTE_JOB_NOT_FOUND`.
