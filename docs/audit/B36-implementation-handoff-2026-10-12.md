# B36 Cloud Engineering Compute Gateway: implementation handoff

**Prepared:** 2026-10-12, against `phase31/development` at `6f71c02`. This is a planning document. **Nothing in it is implemented.**

**Status of inputs:**
- **Not in the repository:** the authoritative 46-phase roadmap and the Phase 35 V2 research files. The exact B36 roadmap wording therefore could **not** be read.
- **In-repository B36 definitions** (quoted verbatim):
  - `docs/phase32/phase32-design.md:131`: *"Background sweeper / scheduled recovery without client activity (needs a non-user execution identity) → 36 (governed compute gateway)"*
  - `docs/phase32/phase32-design.md:133`: *"External compute workers and remote queues → 36"*
  - `docs/phase30/phase30-report.md:164`: *"Cloud compute → 36"*
  - `docs/phase35/phase35-design.md:151`: *"Validated external structural, wind or seismic solvers behind a compute gateway → B36"*

**Before coding:** the implementing session **must** reconcile this plan with the roadmap text once the owner supplies it.

---

## 1. Existing architecture B36 must build on (inspected)

| Existing piece | Where | What B36 does with it |
|---|---|---|
| Durable jobs: QUEUED, RUNNING, SUCCEEDED, FAILED or CANCELLED; leases with fencing tokens; bounded retries with backoff; cancel; recovery on owner read; duplicate suppression; per-project limits (≤4 active, ≤120/h) | `apps/api/src/jobs/*`, migration `0022`, `docs/phase32/*` | **Reuse.** External compute is a new *executor placement* for jobs, not a second job system. |
| Account quotas (≤8 active jobs per owner) | migration `0023`, `docs/phase33/*` | Reuse. External jobs count toward them. |
| Provider abstraction precedent: `AiPolicy` | `apps/api/src/contracts/ai-orchestration.ts`, `ai/orchestration/registry.ts` | **Mirror its shape:** `privacyClass` (default `LOCAL_ONLY`), `allowMetered` (default `false`), `costClass` `FREE` or `METERED`, `maxConcurrent`, `requestsPerMinute`, circuit breaker, `allowedRemoteHosts`, and `apiKeyEnv` indirection so that no key ever appears in config JSON. |
| Quote and consent precedent: `ExecutionQuote` (`LOCAL_DETERMINISTIC`, external cost 0, `dataTransfer: NONE`) with a preflight hash and consent | `apps/api/src/revision/contracts.ts`, phase30 design §3 | **Reuse the pattern** for cost and data-transfer approval before submission. |
| Signed writes: `SECURITY DEFINER` RPCs with an HMAC envelope (`PROJECT_COMMIT_SECRET`); RLS owner reads; the API holds only the **anon** key | `.env.example`, migrations 0006+ | New writes follow the same pattern. **Never add a service-role key to the API.** |
| Capability discovery `capability-discovery-v2` | `apps/api/src/services/overview-service.ts` | Add a `COMPUTE_GATEWAY` row and per-provider status. |
| Bounded worker pools (in-process) | `apps/api/src/lib/worker-pool.ts` | This is the `LOCAL` provider. |
| B35 `REQUIRES_SOLVER` blockers | `apps/api/src/engineering/assess.ts` | **Unchanged by B36.** A domain may move only when a *validated* solver with validation evidence exists, which is not B36 work. |

## 2. Decisions to make before implementation

Each decision lists a recommended low-cost default and the approval it needs.

| # | Decision | Recommended default | Trade-off | Owner approval needed? |
|---|---|---|---|---|
| 1 | **Compute provider strategy** | <ul><li>A `ComputeProvider` adapter interface with three built-ins:<ul><li>`NONE`: the default; external compute is reported `UNAVAILABLE`.</li><li>`LOCAL_POOL`: the existing in-process bounded pools; used in tests and in no-cloud deployments.</li><li>`REMOTE_HTTP_WORKER`: one generic adapter for an **owner-hosted, scale-to-zero** HTTPS worker that implements a small contract defined in this repository (§4.3).</li></ul></li><li>No vendor SDK is hard-coded, and no vendor or price is assumed.</li><li>Recorded cost is an **operator-configured ceiling** per job kind, not a provider claim.</li></ul> | <ul><li>No vendor lock-in and no always-on cost.</li><li>The owner must host the worker, choosing any container platform that scales to zero.</li><li>A vendor-specific batch API, if wanted later, is added as another adapter.</li></ul> | **Yes**, for the choice of hosting platform and any metered account. |
| 2 | **Worker identity and permissions** | <ul><li>**(a) The remote worker never touches the database.** It receives only a minimized payload and returns a result. The API alone persists, through the existing signed RPCs, after re-verifying the result.</li><li>**(b) Identity for the background sweeper** that B32 deferred: a dedicated Postgres role `compute_gateway`, `NOLOGIN` and granted to a login role used only by the sweeper. It holds `EXECUTE` on **new** `SECURITY DEFINER` functions `compute_gateway_*` (recover, requeue and dispatch due jobs), has **no table grants**, and is **not** the service role. Its connection string is a separate secret (`COMPUTE_GATEWAY_DATABASE_URL`).</li><li>The sweeper is disabled unless that variable is set.</li><li>Per-job worker credential: a short-lived HMAC token bound to `(jobId, attempt, leaseToken, inputHash, deadline)`, derived from a gateway secret. It is never sent to clients.</li></ul> | <ul><li>Keeps B32's "no service role in the API" invariant.</li><li>Introduces exactly one new server-held credential, and it is optional.</li><li>Without (b), jobs are recovered only on owner reads, which is the current B32 behaviour.</li></ul> | **Yes**: a new DB role and credential. |
| 3 | **Callback vs polling** | <ul><li>A **pull-first hybrid.** The API (on owner reads, and the sweeper if enabled) polls the provider for status and result.</li><li>An optional inbound callback is treated **only as a wake-up hint**. It is HMAC-signed over `jobId`, `attempt`, timestamp and nonce, has a ±300 s skew window, and stores the nonce once (replay → 409).</li><li>The callback body is never trusted as the result: the API then pulls the result and verifies its `resultSha256` and schema.</li></ul> | <ul><li>Works with no public inbound endpoint at all.</li><li>Is idempotent by construction.</li><li>Callbacks only reduce latency.</li></ul> | No. The callback endpoint is off by default. |
| 4 | **Budget and approval policy** | <ul><li>Server-owned `COMPUTE_POLICY` JSON with these defaults:<ul><li>`allowMetered: false`</li><li>`maxWallSeconds: 900` per job</li><li>`maxActiveExternalPerProject: 1`</li><li>`maxActiveExternalPerOwner: 2`</li><li>`maxSubmissionsPerOwnerPerDay: 20`</li><li>`monthlyCeilingMinor: 0`</li><li>`approvalThresholdMinor: 0`, so every metered job needs explicit consent</li></ul></li><li>Submission requires a **quote**: kind, provider, cost ceiling, data-transfer class, deadline and quote hash. The client must echo `consent: { quoteHash }`.</li><li>If the ceiling is exhausted, credentials are missing or the circuit is open, the job **fails closed** with a typed error and nothing is queued remotely.</li></ul> | <ul><li>Some friction for users.</li><li>No surprise spend, and no "unlimited supertall" promise.</li></ul> | **Yes**: the ceilings and the threshold. |
| 5 | **Research and architecture references** | <ul><li>Commit the 46-phase roadmap, the B36 section and the V2 research to `docs/roadmap/` and `docs/research/` before starting.</li><li>The implementing session cites them by path.</li><li>If they stay external, the session must record that it worked without them, as B35 did.</li></ul> | Without them, B36 is scoped from the in-repository quotes only. | **Yes**: supply the files. |

**Further owner decisions:**
- **(6) Which job kinds may run remotely first.** Recommendation: only existing deterministic engines whose output the API can **independently re-verify** before persisting. Candidates are `OPTIMIZATION_STUDY` (Phase 28) and `SCENE_COMPILE` (Phase 29); the existing worker pools already parse and validate worker output. The implementing session must confirm each candidate's verifier first.
- **No engineering solver kind is added in B36.** The plumbing simply refuses unknown kinds.
- **(7) Privacy.** Sending a project model to a remote worker is a data transfer. The default is `LOCAL_ONLY`. Remote execution needs the policy to allow it **and** per-job consent, shown in the quote as `dataTransfer: REMOTE_PROVIDER`.

## 3. Proposed architecture

```text
client ─POST /jobs (kind, placement?, consent.quoteHash)─► API ─signed job_write─► project_jobs (B32, unchanged machine)
      ◄─202 JobDetail───────────────────────────────────── │
                                                            ├─ JobRunner (B32) → Executor
                                                            │     placement LOCAL  → existing pool (unchanged)
                                                            │     placement REMOTE → ComputeGateway.dispatch(adapter)
                                                            │            └─ project_compute_dispatches row (signed RPC)
owner GET /jobs/:id ─► recover() ─► ComputeGateway.poll() ─► adapter.status/result ─► verify(schema, sha256, binding)
                                                            └─► existing *_write RPC (converges on revision+input_hash)
optional sweeper (compute_gateway role) ─► same recover/poll path, bounded batch, jittered interval
optional callback ─► verify HMAC+nonce ─► poll() (hint only)
```

- **New module** `apps/api/src/compute/`, containing:
  - `contracts.ts`: Zod schemas for the policy, quote, dispatch, provider status and errors;
  - `gateway.ts`: placement, quote, dispatch, poll, verify, cancel;
  - `adapters/none.ts`, `adapters/local.ts`, `adapters/remote-http.ts`;
  - `sweeper.ts`: optional, off by default.
- **Job runner change:** a new optional `placement` on executors. With `LOCAL`, behaviour is byte-identical to B32.

## 4. Contracts

### 4.1 API

All routes are additive. Route conventions match B32.

| Route | Purpose |
|---|---|
| `POST /api/projects/:projectId/compute/quote` | Body `{ kind, request, placement: 'LOCAL' \| 'REMOTE' }` returns `ComputeQuote { quoteVersion, kind, placement, providerId \| null, costClass, costCeilingMinor, currency, dataTransfer: 'NONE' \| 'REMOTE_PROVIDER', maxWallSeconds, deadlineAt, inputHash, quoteHash, expiresAt, claims }`. A pure read with no state; charged to the `write` rate-limit group. |
| `POST /api/projects/:projectId/jobs` (B32, extended) | Optional `placement` and `consent: { quoteHash }`. If `placement` is absent it means `LOCAL`, so existing clients are unaffected. `REMOTE` without a matching unexpired quote returns `409 COMPUTE_QUOTE_REQUIRED`, and a quote mismatch returns `409 COMPUTE_QUOTE_MISMATCH`. |
| `GET …/jobs/:jobId` (B32) | `JobDetail` gains an optional `compute` field: `{ placement, providerId, algorithm: { id, version }, sourceRevisionId, modelHash, quoteHash, deadlineAt, verification: 'PENDING' \| 'VERIFIED' \| 'REJECTED' }`. Additive. |
| `GET /api/capabilities` | Adds a `COMPUTE_GATEWAY` service and `computeProviders[] { providerId, type, status: AVAILABLE \| DISABLED \| UNAVAILABLE \| DEGRADED, kinds[], costClass, limits }`. It never includes endpoints or secrets. |
| `POST /api/compute/callback/:providerId` | **Optional and off by default.** Takes no user auth: HMAC plus nonce. Returns 204. It is a hint only. |

### 4.2 Lifecycle mapping (no new `project_jobs` statuses)

| Requested state | Representation | Why |
|---|---|---|
| accepted | `202` plus `QUEUED` | B32 contract |
| queued | `QUEUED` | |
| running | `RUNNING`; lease and heartbeat renewed by poll | |
| succeeded | `SUCCEEDED`, only after **verification**, then persistence through the existing `*_write` RPC | |
| failed | `FAILED` with a typed failure | |
| cancelled | `CANCELLED`. Cancellation is forwarded to the provider on a best-effort basis, and any late result is discarded through lease fencing. | |
| timed-out | `FAILED` with `COMPUTE_DEADLINE_EXCEEDED`, `retryable: false` | Avoids a breaking status change |

- **Retries:** reuse B32's ≤3 attempts with backoff. Provider 5xx, timeout and capacity errors are transient. A rejected result, schema failure or hash mismatch is **permanent**.
- **Idempotency:** dispatch is keyed by `(jobId, attempt)` and sent to the provider as an `Idempotency-Key`. A re-poll of a finished dispatch is a no-op.
- **Deduplication:** B32's partial unique index applies unchanged.
- **Revision safety:** a result is bound to `(sourceRevisionId, modelHash, inputHash, algorithm.version)` and persisted only as a **derived artifact** of that revision, never as a model change. If the revision is no longer current, the artifact is still stored against its own revision, and existing freshness marks it stale. B37 handles propagation. Nothing can overwrite a newer revision, because nothing writes models.

### 4.3 Remote worker contract (owned by this repository; no vendor API assumed)

| Call | Request | Response |
|---|---|---|
| `POST {base}/v1/jobs` | Headers: `Authorization: Bearer <per-job HMAC token>` and `Idempotency-Key`. Body `{ jobId, attempt, kind, algorithmVersion, input, inputHash, deadlineAt }`. | `{ providerJobRef }` |
| `GET {base}/v1/jobs/{ref}` | | `{ state: QUEUED \| RUNNING \| SUCCEEDED \| FAILED, progress?, error? { code, retryable } }` |
| `GET {base}/v1/jobs/{ref}/result` | | `{ result, resultSha256, algorithmVersion }`, size-bounded |
| `POST {base}/v1/jobs/{ref}/cancel` | | |

- HTTPS only, and only to a host on the allowlist; there are no redirects.
- Response sizes are capped and timeouts are set from the policy.

## 5. Migration impact (one additive migration, `0025_compute_gateway.sql`)

1. **Re-create the `project_jobs` kind check** only if a new kind is added. The recommendation is no new kinds, so no change.
2. **Add events to `project_job_events.event_type`** as a superset, re-created in the same pattern as 0010/0014–0023: `COMPUTE_QUOTED`, `COMPUTE_DISPATCHED`, `COMPUTE_POLLED`, `COMPUTE_RESULT_VERIFIED`, `COMPUTE_RESULT_REJECTED`, `COMPUTE_CANCEL_FORWARDED`.
3. **Add table `project_compute_dispatches`** with columns:
   - `job_id` (FK, retained, guarded like jobs) and `attempt`;
   - `provider_id`, `provider_job_ref` (opaque, ≤200 characters);
   - `placement`, `algorithm_id`, `algorithm_version`;
   - `source_revision_id`, `model_hash`, `quote_json`, `quote_hash`;
   - `cost_ceiling_minor`, `currency`, `deadline_at`;
   - `result_sha256`, `verification`;
   - timestamps.
   It has a PK `(job_id, attempt)`, RLS owner select, writes only through a signed `compute_write`, and an append-only guard.
4. **Add table `compute_callback_nonces`** (`provider_id`, `nonce`, `expires_at`; PK `(provider_id, nonce)`). It has no grants except to definer functions. Purging expired nonces stays inside the definer.
5. **Add table `compute_spend_ledger`**, a monthly ceiling counter per owner and per deployment. It is updated in the same transaction as dispatch, so concurrent submissions cannot exceed the ceiling.
6. **Optional: role `compute_gateway`** with `EXECUTE` on `compute_gateway_recover_due(limit)` and `compute_gateway_dispatch_due(limit)` only.
7. **Pin everything in `supabase/tests/database.test.ts`:** the table list, FK count and delete rules.

**Retention and deletion:** follow the existing guarded-retention convention (audit §6). Do not add new cascades that guards will refuse.

**Hosted:** 0025 depends on 0018–0024 being applied first, and the hosted database is believed to be at 0017.

## 6. Security model

| Threat | Control |
|---|---|
| Cross-tenant submit, read or cancel | Existing B32 RLS and owner checks. The quote is bound to `projectId`, `userId` and `inputHash`. |
| Provider secret exposure | Secrets live only in env, referenced by name (`COMPUTE_PROVIDER_<ID>_SECRET`). They never appear in capabilities, logs, Sentry, quotes or responses. |
| SSRF / exfiltration | Provider endpoints come only from server config. HTTPS; host allowlist; no redirects; response size caps. |
| Forged or replayed callback | HMAC, skew window, single-use nonce. The body is not trusted; the result is pulled and its hash verified. |
| Forged or corrupt result | Strict Zod schema; `resultSha256` recomputed; binding to the revision, model hash, input hash and algorithm version; existing engine validators; persistence only through the existing `*_write` RPCs that recompute hashes in SQL. |
| Stale or duplicated worker | Lease fencing (B32 `P3203`) and `(jobId, attempt)` idempotency |
| Spend abuse | Quote and consent; per-owner, per-project and per-day caps; a monthly ceiling ledger; `allowMetered=false` by default |
| Payload size or abuse | Reuse each kind's existing input caps (64 KiB requests). The remote payload is the minimized canonical model plus the request, with a size cap enforced before dispatch. |
| Privacy | `LOCAL_ONLY` default; `dataTransfer` shown in the quote; consent required |
| Core API overload | Separate bounded concurrency per provider; circuit breaker; poll timeouts; no external call on the request path except the quote |

## 7. Operations and observability

- **Capabilities** report each provider's status: `DISABLED` (no config), `UNAVAILABLE` (missing credentials or the circuit is open), `DEGRADED` (recent failures) or `AVAILABLE`.
- **Structured logs** (pino): `jobId`, `kind`, `placement`, `providerId`, `attempt`, transition, `durationMs`, `errorCode`, `costCeilingMinor`. **Never** log payloads, results, tokens or endpoints with credentials.
- **Error classes:**
  - `COMPUTE_PROVIDER_UNAVAILABLE`, `COMPUTE_BUDGET_EXHAUSTED`, `COMPUTE_QUOTE_REQUIRED`, `COMPUTE_QUOTE_MISMATCH`, `COMPUTE_KIND_UNSUPPORTED` and `COMPUTE_PLACEMENT_UNSUPPORTED` are all 4xx;
  - `COMPUTE_DEADLINE_EXCEEDED`, `COMPUTE_RESULT_REJECTED` and `COMPUTE_PROVIDER_ERROR` are job failures.
- **Metrics:** use counters derived from logs; do not add a new paid metrics service.
- **Sentry:** add the route templates to the safe list.

## 8. Cost-control strategy

- The default deployment has **zero** external compute: provider `NONE`.
- No always-on worker is required. `LOCAL_POOL` uses existing capacity, and the remote worker is owner-hosted and scales to zero.
- Polling happens only on owner reads (B32 behaviour). The optional sweeper runs at a jittered interval of at least 60 s with a bounded batch, and it is off by default.
- Every remote job has a quote, a cost ceiling, a deadline and consent. A monthly ceiling ledger enforces the total, and the system fails closed when it is exhausted.
- No unlimited or supertall-scale promise is made anywhere. Capabilities expose the limits.

## 9. Test plan

- **Unit tests:**
  - policy parsing and defaults;
  - quote hashing and determinism;
  - consent mismatch;
  - budget arithmetic, including concurrent submissions;
  - classification of transient and permanent errors;
  - callback HMAC: valid, skewed, replayed, wrong provider;
  - result verification: schema, hash, binding;
  - the circuit breaker;
  - log redaction: assert no secret or payload in captured logs.
- **Integration tests** (embedded PostgreSQL, real HTTP, with a **fake remote worker on 127.0.0.1**):
  - LOCAL placement is byte-identical to B32;
  - remote happy path;
  - provider down, giving `UNAVAILABLE` with nothing queued remotely;
  - deadline exceeded;
  - cancel while running, with the late result discarded;
  - lease loss and fencing;
  - a crash and recovery on read;
  - sweeper recovery with the dedicated role (if approved);
  - cross-tenant 404 and anonymous 401;
  - budget exhausted, giving 4xx;
  - a result for a non-current revision is stored against its source revision only;
  - a forged result is rejected.
- **Migration tests:** replay 0001–0025 and pin the schema in `database.test.ts`; a role-privilege test showing `compute_gateway` cannot select any table.
- **Conformance tests:** route catalog, OpenAPI drift, Sentry safe routes, rate-limit groups, and a discovery row for every advertised service.
- **Mutation testing:** at least 8 hand mutants, for example accepting an unsigned callback, skipping the hash check, ignoring the deadline, letting `allowMetered` default to true, or dropping the fencing check.
- **CI:** all of the above must run in the (enabled) GitHub Actions workflow on the Node matrix. B36 must not be merged without a green run and an independent review.

## 10. Dependencies and preconditions

- B32 jobs (in place); B33 quotas (in place); B34/B35 (merged, but B35 is **not release-ready**; see the audit).
- **Must precede B36 merge:**
  - GitHub Actions enabled;
  - the source-mode worker-thread test defect fixed, since B36 tests will use worker pools;
  - an owner answer to decisions 1–7.
- **Hosted:** 0018–0024 applied before 0025 is deployed.

---

## 11. Ready-to-paste B36 implementation prompt

```text
NekoArch Backend: B36 Cloud Engineering Compute Gateway (implementation)

Role: principal backend engineer. Repository: Aryangithub13/nekoarch-backend. Base branch: phase31/development
(verify it is the default branch and its HEAD before starting). Work on a new branch phase36/compute-gateway. Open a PR;
do not merge, tag, deploy, apply hosted migrations or change repository settings.

Read first, and cite by path in your design doc:
- docs/audit/B36-implementation-handoff-2026-10-12.md (this plan) and docs/audit/B35-release-audit-2026-10-12.md
- docs/phase32/phase32-design.md (durable jobs; §5 credentials, §6 recovery, §12 items deferred to B36)
- docs/phase33/phase33-design.md (quotas), docs/phase30/phase30-design.md (quote/consent pattern), docs/phase21-design.md
  and apps/api/src/contracts/ai-orchestration.ts (provider policy precedent), apps/api/src/jobs/*, apps/api/src/lib/worker-pool.ts,
  apps/api/src/services/overview-service.ts, supabase/migrations/0022_durable_jobs.sql, .env.example
- The authoritative 46-phase roadmap B36 section and the Phase 35 V2 research, if present under docs/roadmap or
  docs/research. If absent, say so in the report and scope strictly from the in-repository quotes at the top of the handoff. Never invent roadmap text.

Owner decisions (fill in before starting; if blank, use the handoff's recommended defaults and record that you did):
1 provider strategy: ____  2 worker identity / sweeper role: ____  3 callback vs polling: ____
4 budget policy values: ____  5 research files location: ____  6 first remote-eligible kinds: ____  7 privacy default: ____

Build (additive only, no breaking change):
- apps/api/src/compute/: ComputeProvider adapter interface; adapters NONE (default), LOCAL_POOL (existing pools),
  REMOTE_HTTP_WORKER (the repository-defined contract in handoff §4.3; HTTPS, host allowlist, no redirects, size caps).
  No vendor SDK, no assumed prices; cost is an operator-configured ceiling.
- COMPUTE_POLICY server config validated by Zod, mirroring AiPolicy: allowMetered=false, LOCAL_ONLY, ceilings and limits
  as decided; secrets only via env-name indirection; never in responses, logs or Sentry.
- POST /api/projects/:projectId/compute/quote (pure); extend the B32 job submit with optional placement + consent.quoteHash
  (absent placement = LOCAL, byte-identical to B32); additive JobDetail.compute; COMPUTE_GATEWAY in /api/capabilities with
  per-provider status; optional HMAC+nonce callback endpoint, off by default, treated only as a poll hint.
- No new project_jobs statuses: timeout = FAILED/COMPUTE_DEADLINE_EXCEEDED. Reuse leases, fencing, retries, dedup,
  cancel and recover-on-read. Results are verified (schema, sha256, revision/modelHash/inputHash/algorithm binding) and
  persisted only via the existing *_write RPCs as derived artifacts of their source revision; never modify a model.
- Migration 0025_compute_gateway.sql (additive): event_type superset; project_compute_dispatches; compute_callback_nonces;
  compute_spend_ledger; optional NOLOGIN role compute_gateway with EXECUTE on compute_gateway_* definer functions only,
  no table grants, no service role. Signed definer writes with the existing HMAC envelope. Follow the existing
  guarded-retention convention; add no cascade that a guard will refuse. Update supabase/tests/database.test.ts pins.
- Optional sweeper: enabled only when COMPUTE_GATEWAY_DATABASE_URL is set; bounded batch, jittered interval ≥ 60 s.
- Do NOT add engineering solver kinds and do NOT change any B35 domain status; B35 REQUIRES_SOLVER blockers stay until a
  validated solver with validation evidence exists.

Verify (record exact commands, Node/npm versions, exit codes):
- npm run build, typecheck, lint; full `npx vitest run` green on Node 22.22.0 and the current 22.x (fix or document the
  source-mode worker bootstrap first if still failing); the unit/integration/migration/conformance/mutation tests in
  handoff §9, using a fake remote worker on 127.0.0.1 only. No live external services, no paid accounts.
- Do not claim GitHub CI passed unless an Actions run on the PR shows it.

Deliver: docs/phase36/phase36-design.md, phase36-api.md, phase36-report.md (supported/unsupported matrix, threat
model, decisions taken, what was not verified: hosted DB, real provider, frontend). Report final status honestly
(FULLY / PARTIALLY implemented). Stop after opening the PR.
```
