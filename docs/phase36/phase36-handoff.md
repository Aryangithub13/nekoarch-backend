# Phase 36 handoff — Cloud Engineering Compute Gateway (draft, not implemented)

Status: **handoff only.** Nothing in this document is implemented, migrated, deployed or tagged. It was prepared during the post-B35 release-gate audit (2026-10-12) against `origin/phase31/development` @ `6f71c02`.

## 1. Scope source

Canonical roadmap: `NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md` (8 Oct 2026; local copy `~/Downloads/`, **not in the repository**), §B "Phase 36 — Cloud Engineering Compute Gateway" and §I hard rules 3 and 6.

Roadmap B36, condensed:
- **Mission:** offload expensive engineering/3D computation while keeping the backend responsive, secure and auditable.
- **Deliverables:** durable queue with dependency-aware fan-out/fan-in; provider-specific adapters; progress/cancel/retry; bounded concurrency; checkpoints; error isolation. Budgets, quotas, deadlines, secure provider credentials, retention policy, **result verification**, deduplication and content-addressed caching. Fine-grained recomputation of only impacted tasks. Client-visible job states with recovery after restart, timeout, provider outage and duplicate callback.
- **Separation:** B31 owns uploads/ingestion (B36 consumes approved artifacts and never reprocesses untrusted inputs in engineering workers). B32 owns generic durable jobs (B36 adds engineering-grade solver execution, reproducible environments, units/boundary verification, queue isolation, result integrity, provider resource governance). B33 owns settings/account context (B36 applies user-approved budgets and access policy).
- **Gate:** large solver workloads execute outside request threads with reproducible inputs, validated numerical/engineering output contracts, capped cost, abort/recovery, and truthful unsupported/approximate status.
- **Hard rule 3:** B36 builds on B32 durable jobs, not the reverse.

## 2. Research inputs

| Input | Status |
|---|---|
| `NekoArch_Phase35_Engineering_Research_Enhanced_v2_2026-10…` | **Not found** (repo, all branches/history, `~/Downloads`, `~/Documents`, `~/NekoArch`, Claude memory, artifacts). Not consulted; no substitute used. |
| 46-phase roadmap | Found locally (above). Should be committed to the repo (`docs/roadmap/`) so future sessions and reviewers see the same scope. |

Consequence: any research-specified solver choice, validation benchmark, tolerance, standard edition, or cost factor is **blocked** until the file is supplied. B36 must not pick a standard edition or numeric tolerance from memory.

## 3. What already exists to build on (verified in source)

| Asset | Where | Relevance |
|---|---|---|
| Durable jobs: state machine, leases + fencing tokens, CAS start, backoff, dedup on `(project, kind, input_hash)`, signed `job_write`, per-project/owner limits | `0022_durable_jobs.sql`, `apps/api/src/jobs/{contracts,runner,executors}.ts`, phase32-design | B36 queue substrate. Job kinds are a SQL `check (kind in (...))`; adding kinds needs a **forward migration** re-creating the check as a superset (same pattern as the idempotency whitelist). |
| Bounded worker pools | `apps/api/src/lib/worker-pool.ts` (`BoundedWorkerPool`, `ownWorker`) | In-process isolation for local solver adapters. Source-mode worker bootstrap is reported broken on some Node 22 releases (see the B35 audit); resolve before B36 adds pools. |
| Phase 24 frame solver | `apps/api/src/structural/frame-solver.ts` | Linear-static only (no diaphragm, panels, P-delta; B35 design §3). A candidate *first* adapter to prove the gateway end to end; it does **not** satisfy B35's `LATERAL_DRIFT_AND_STABILITY` / `DYNAMIC_RESPONSE` blockers. |
| B35 blockers | `apps/api/src/engineering/{contracts,assess}.ts`: `REQUIRES_SOLVER`, `NO_VALIDATED_SOLVER` | The consumer contract: a domain may move off these only when a **validated** solver result exists for that exact revision/input hash. |
| Account quotas, settings | `0023_account_library_context.sql` (≤ 8 active jobs/owner) | Budget/quota policy anchor. |
| Reference artifacts | `0021`, `0024` | Inputs only after B31 inspection; never re-parsed by engineering workers. |

## 4. Decisions needed from the user before implementation

1. **External provider(s).** No external solver/provider, account or credential exists in the repo. Name the provider(s), or confirm V1 ships only the gateway + a local adapter, with external adapters reporting a typed `PROVIDER_NOT_CONFIGURED`.
2. **Non-user execution identity.** Phase 32 §6/§12 defers the background sweeper to B36 because it needs a non-user identity; `.env.example` forbids deploying a service-role key to the API. Choose: (a) a separate worker process with its own narrowly-granted DB role and signed envelopes, (b) keep owner-read-triggered recovery only, or (c) another design. This is the central security decision of B36.
3. **Callbacks.** Remote providers imply inbound callbacks (duplicate-callback handling is in the gate). Confirm whether inbound webhooks are acceptable, or polling-only.
4. **Budget unit.** Money (INR), compute-seconds, or provider credits; and who approves (B33 settings vs per-job consent like B30's quote).
5. **Research file.** Supply `…Engineering_Research_Enhanced_v2…` or confirm B36 proceeds without research-specified parameters.

## 5. Proposed shape (for review, not a commitment)

- **New job kind(s)** (forward migration `0025_…`), e.g. `ENGINEERING_SOLVE` with `request = { revisionId, domain, adapterId, adapterVersion, inputHash, budget }`. Reuse B32 leases/fencing/dedup; add a separate queue class so solver load cannot starve scene/optimization jobs.
- **Adapter contract:** `prepare(input) → canonical payload + hash`, `submit`, `poll`/`callback`, `fetch`, `verify(result) → VERIFIED | REJECTED(reason)`. The adapter declares units, coordinate frame, solver name+version, environment digest, and what it does **not** model.
- **Result verification before persistence:** schema validation, unit/dimension checks, equilibrium/residual checks where the method allows, hash binding to the exact input. A result that fails verification is stored as `REJECTED` evidence, never as a value.
- **Content-addressed cache:** key = `(adapterId, adapterVersion, environmentDigest, canonicalInputHash)`; reuse only `VERIFIED` results.
- **Truthful status:** the roadmap's B35 wording asks for `conceptual` / `assumption_based` / `professionally_reviewed` evidence classes; B35 shipped a 7-level assurance taxonomy and `CONCEPTUAL_PARAMETRIC`. B36 should publish an explicit mapping rather than introduce a third vocabulary.
- **Fan-out/fan-in:** a parent job with child jobs and an explicit DAG; a failed child marks dependents `BLOCKED`, never silently partial.

## 6. Safeguards (carry forward unchanged)

- External solvers/providers are **untrusted boundaries**: they may compute; they never certify, never override QA, never mutate accepted revisions.
- No fabricated engineering data. Missing provider, input, verified source or validated solver → `UNSUPPORTED` / `REQUIRES_*` / `PARTIAL`, never a default value.
- Standards: name a source only with a verified edition; otherwise `NOT_VERIFIED`, used only to identify what needs verification. No certification, approval or compliance claim.
- Cost: conceptual only, sourced rates with jurisdiction and date (B35 rule), never presented as an engineering or commercial approval.
- Migrations forward-only; historical migrations byte-identical; test fresh install **and** upgrade from 0024 with populated data; extend the exact-schema assertions in `supabase/tests/database.test.ts`.
- No change to existing routes, Zod contracts, hashes, job semantics or stored data; jobs API changes additive only. Regenerate route catalog/OpenAPI and keep the anonymous-allowlist test passing.
- Secrets server-side only; no provider key in logs, job requests, events or errors.

## 7. Acceptance tests to write first

1. Submit an engineering solve → 202 → poll → `SUCCEEDED` with a `VERIFIED` result bound to the input hash; identical resubmit dedups or hits cache.
2. Provider timeout / outage → bounded retry → typed `FAILED` with no partial value persisted.
3. Duplicate and late callbacks after a lease change → refused by fencing; result recorded once.
4. Process restart mid-job → recovery → completion or `JOB_INTERRUPTED`.
5. Budget exceeded at submit and mid-run → refused / cancelled with typed reason; no spend beyond cap.
6. A result failing verification (wrong units, residual too large, hash mismatch) → `REJECTED`; the B35 domain stays blocked.
7. Cross-tenant read/cancel/result → 404; anonymous → 401.
8. After a façade-only revision, an unaffected domain reuses the cached verified result; an affected one recomputes.
9. B35 assessment for a revision with a verified solver result changes only the domains that result legitimately covers.

## 8. Preconditions (from the B35 audit)

- Get `backend-ci.yml` actually running on GitHub (no workflow is registered and no run exists for this repo).
- Decide B35's release/tag status and B31–B34 tagging.
- Hosted Supabase: an authorized operator confirms which migrations are applied before any `0025` is written against assumptions.

## 9. Out of scope for B36

Unified dependency graph and freshness propagation (B37); evidence packages and exports (B38); specialist AI workers (B39–43); push progress via SSE/websocket (B45); frontend integration (deferred).
