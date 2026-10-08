# Phase 28 report — optimization & autonomous design iteration V1

## Classification

**PHASE 28 FULLY IMPLEMENTED AND VERIFIED WITHIN BOUNDED SCOPE**

Basis: final frozen-source release run 2, executed 2026-10-08 in the worktree `designflow-phase28` (branch `phase28/optimization-v1`, merged with `backend-v1-phase27-complete`).

- 62 / 62 gates exit 0, with no waived failure and no skip.
- The frozen source and every protected directory were unchanged before and after every gate. The manifest is `16c02eb674a7e133c0715b5e7bb3a14b1951b355fbd91dc574e3865ad3d103d0` (442 files).
- Full record: [phase28-verification.md](phase28-verification.md).

Optimization studies are **advisory proposals**. No study changes a revision, the current revision, BIM or any analysis. Every candidate carries `architectureMutation: "NONE"`, and the property is enforced in the core, the validator and the database.

## What was delivered

**Core** (built in parallel with Phase 27; design in [phase28-design.md](phase28-design.md), amendments in [phase28-core-progress.md](phase28-core-progress.md)):
- **Inputs and search:** accepted `parametric-architecture-v1` revisions only; the 8 `ParametricEditSchema` dimensions; exact BigInt search-space preflight.
- **Strategies:** GRID (at most 128 candidates) and deterministic coordinate-descent local search (at most 128 evaluations; reports `BEST_FOUND`, never a global optimum).
- **Scoring:** exact-rational metrics, constraints, normalization, weighted score and Pareto.
- **Cost:** priced on a comparable scope only (`PRICED_SCOPE_ONLY`). Missing cost is `INPUT_INCOMPLETE`, never zero.
- **Identity:** candidate identity hashes and deduplication before QA.
- **Independent validator:** recomputes everything from the raw input without importing optimizer arithmetic.

**Integration** (after the `backend-v1-phase27-complete` tag; merged through a human-approved work-in-progress commit plus merge, `788f487` + `e742967`):

| Area | Delivered |
|---|---|
| Execution model (D6) | Bounded `worker_threads` pool (`optimization/pool.ts`, `worker.ts`), sized `min(2, CPUs−1)` and created lazily. Queue of 4; 60 s per-study ceiling that terminates the worker; 512 MiB worker heap. Worker output is re-parsed with `StudySchema`. On close, queued jobs are rejected and running ones settled. Failures map to typed 503s (`OPTIMIZATION_QUEUE_FULL` / `_WORKER_TIMEOUT` / `_WORKER_FAILED` / `_UNAVAILABLE`, `Retry-After: 30`) and **never store a study**. |
| Migration 0018 | `project_revision_optimization_studies` (additive): immutable trigger; owner-only RLS `optimization_owner_read`; check constraints for fixed claims, engineering, status consistency and a `jsonb_path_exists` guard on `architectureMutation`. |
| 0018 write function | Signed SECURITY DEFINER `optimization_write`. It verifies the HMAC envelope, ownership and QA acceptance. It then **recomputes in SQL** the source binding (canonical building + generation identity → model hash, generator version, seed, parameter hash), `inputHash`, `resultHash` and every candidate/alias/baseline ID (P2803 on mismatch). Writes use durable idempotency, advisory-lock convergence (identical inputs → one row) and a nondeterminism check. `optimization_read` provides get/list (stable `(createdAt, id)` cursor)/status. |
| API | Five routes under `/api/projects/:projectId/revisions/:revisionId/optimization`, documented in [phase28-api.md](phase28-api.md). Cheap main-thread precheck (≈1 ms) before the pool; GET routes never compute; staleness via `currency` and `require=current` → 409. Telemetry templates and the compute quota (`studies`, `validate`) are wired. |
| Adoption safety | Adoption only through the existing `POST …/revisions/generate` with the candidate's `adoption.parametricEdits`; the new revision reproduces the candidate's `modelHash` (HTTP acceptance test). |
| §26 validator hardening | **Option A.** The validator now re-runs normalization, generation and schema for every rejected candidate and requires the identical `{stage, code, details}` (`GATE_REDERIVED`). Previously it checked shape only at the GENERATION and MODEL stages. The engines are re-run, not re-implemented; this is the documented trust boundary. |
| JSON numbers | Input numbers must be safe integers (decimals as strings) so the SQL `canonical_json` and TypeScript `costHash` agree byte for byte. |

## Verification summary (run 2)

| Suite | Result |
|---|---|
| `test:optimization` (core 62 + pool 9 + persistence/HTTP 15) | 86 passed |
| `test:unit` | 2222 passed |
| `test:integration` | 253 passed |
| `test:supabase` (live local stack) | 110 passed |
| `db:test` (pgTAP `rls.sql`) | 86 / 86 |
| `npm run check` | 2517 + 133 + 52 passed |
| All historical phase suites (generator … knowledge) | passed, unchanged counts |
| build, typecheck, lint, `git diff --check` | exit 0 |
| Mutation (`docs/phase28/mutation-test.py`) | **37 / 37 killed for the intended reason**, all restored byte-for-byte, controls 86/86 before and after |
| IFC | 7 fixtures, 0 schema diagnostics; 7/7 byte-identical architecture |
| Docker | non-root runtime with no dev dependencies; compiled acceptance for Phases 23–28; the Phase 28 acceptance runs the dist worker (`dist/optimization/worker.js`) |
| DB preservation | 0 pre-existing rows missing; RLS on every table; pre-existing policies unchanged; only 0018 added |

Integration mutants (M23–M37) and their killers include:
- **Worker pool:**
  - worker bypass (study run on the request thread);
  - queue-overflow bypass;
  - timeout bypass;
  - failed worker still yielding a result;
  - malformed worker study accepted.
  These are killed by the pool tests and by the HTTP "store nothing" tests.
- **SQL write/read path:**
  - RLS opened to every authenticated user;
  - seed-binding bypass;
  - result-hash forgery;
  - candidate-ID recompute bypass;
  - stale-check bypass;
  - nondeterminism accepted;
  - architecture-mutation guard removed.
- **Validator:** independence and gate re-derivation.
- **Errors:** 400-versus-422 mapping.

The first preliminary integration campaign found three survivors:
- **M28 (equivalent mutant):** dropping the owner predicate from the study read policy is equivalent, because the subquery on `project_revisions` is itself owner-scoped by `revisions_owner_read`. The predicate is kept as defense in depth, and M28 was redefined as a policy opened to every authenticated user, which is killed.
- **M29 (weak test):** the forgery test now forges the seed with consistently recomputed candidate IDs, isolating the binding check.
- **M30 (weak test):** the forgery test now recomputes `inputHash` only, isolating the result-hash check.

## Benchmark (`benchmark:optimization`, run 2; Node v26.10.0, 12 CPUs)

**In-process core** (unchanged engine):

| Study | Candidates | Total ms | ms per evaluated assignment |
|---|---|---|---|
| 1 variable | 5 | 262 | 52.3 |
| 4 variables | 81 | 3 919 | 48.4 |
| 8-variable local search (space 43 046 721) | 128 evaluated, `BUDGET_EXHAUSTED` | 6 099 | 47.7 |
| weighted / Pareto / costed, 128 | 128 | 5 261 / 5 249 / 6 540 | 41–51 |
| heavy deduplication | 23 → 1 unique | 720 | 31.3 |

**Worker pool** (defaults: size 2, queue 4, timeout 60 s, 512 MiB):
- **Main-thread precheck:** 0.69 ms typical; 1.40 ms on the 24-room model.
- **Single studies through the pool:**

  | Study | Latency |
  |---|---|
  | weighted-128 | 5.84 s |
  | pareto-128 | 5.69 s |
  | local search | 6.04 s |
  | costed-128 | 6.95 s |
  | 24-room 128 | 24.32 s |

  Queue wait is about 0.01 ms; snapshots are at most 237 KB.
- **Event loop during every study:** max delay 11.2–12.2 ms at a 10 ms histogram resolution. So the request thread stays responsive even during the 24 s study; under the previous synchronous model it would have been blocked for the whole study.
- **Concurrency at capacity (2):** 7.04 s wall, 17.1 studies/min, loop max 14.0 ms.
- **Saturation:** 8 submitted → 6 accepted, 2 refused `OPTIMIZATION_QUEUE_FULL` in 0.21 / 0.05 ms; max queue wait 2.17 s.
- **Resource-limit refusal** (`OPTIMIZATION_RESOURCE_LIMIT`): 2.44 ms.

## Frozen limits (`OPTIMIZATION_LIMITS`)

| Limit | Value |
|---|---|
| Input | 256 KiB; depth 16; 8 000 nodes |
| Search size | 8 variables × 64 values; 8 objectives; 16 hard constraints |
| Candidates | 128 grid / 128 evaluated |
| Pareto comparisons | 131 072 |
| Snapshot | 1 MiB |
| Time | deadline 45 s (in worker); generator timeout 10 s; pool ceiling 60 s |

## Release history

- **Run 1** passed 62/62 on the same manifest.
  - Afterwards, the operator (this agent) ran `verify-phase28.py --help` while reading the results. The harness doesn't parse `--help`, so it started a new run that overwrote `verification.json` and six read-only gate logs, then died on SIGPIPE.
  - Because the evidence set mixed two invocations, it was archived unpromoted under `evidence/failed-runs/release-run1-passed-evidence-overwritten-by-operator/`, with the intact 62-gate stdout record.
  - Run 2 was executed from scratch on the unchanged freeze.
  - Docker build gate 51 took 2 s in run 2 because run 1 had built the identical source and the image layers were cached.
- **Pre-freeze findings fixed** (find → root cause → fix → targeted test):
  - 0018 operator precedence (`->` versus `-`): parenthesized.
  - Stale generator-boundary allow-list in `foundation.test.ts`: extended by exactly the three optimization modules that call the generator.
  - Two weak mutation tests (M29, M30): strengthened.
  - M28: documented as an equivalent mutant.
  - Worktree environment: the embedded-postgres `postinstall` hadn't run; the IFC venv was recreated.

## Decisions recorded

- **D1–D5** as approved. **D6:** the bounded worker pool is implemented, and the 128-candidate limit is exposed only through the pool, never synchronously on the request thread.
- **§26:** option A (gate re-derivation), above.
- **`PHASE27_INTEGRATION_DEFERRED` stays in force.** The released Phase 27 has internal pure modules, but its public service surface is revision-bound and repository-backed. There is no candidate-scoped entry point, and its facts come from persisted Phase 23–26 analyses that candidates don't have. Knowledge metrics are refused (`DEFERRED_METRIC:KNOWLEDGE`), and `sources.knowledgeAnalysisId` must be null.
- **Observation, not changed:** the Phase 27 knowledge routes aren't in the compute-quota group. That is released Phase 27 behavior; it's left for a future, explicitly scoped change.

## Known limitations

- **Scope:**
  - Only accepted `parametric-architecture-v1` revisions and the 8 parametric dimensions.
  - GRID and deterministic coordinate descent only. Local search finds a local optimum (`BEST_FOUND`); global optimality is never claimed (all 11 claims are fixed `NOT_CLAIMED`).
- **Engineering:** Phases 24–27 aren't evaluated per candidate, because their inputs bind to geometry-addressed IDs that change with every edit. Adopting a candidate creates a new revision, which must be analysed by those phases as usual.
- **Cost:** compared on the baseline's priced scope only. Complete totals are unavailable on parametric models, and the bundled rate books are synthetic samples.
- **Validator trust boundary:** the generator, QA and takeoff engines are re-run, not re-implemented.
- **Capacity:** about 17 typical studies/min per instance at pool size 2. Excess load is refused (503 with `Retry-After`) rather than queued without bound. The 24-room 128-candidate study takes about 24 s. Whether a near-deadline study is refused depends on machine speed; outputs are byte-identical or refused, never partial.
- **Determinism boundary:** JSON numbers must be safe integers so the SQL and TypeScript hashes agree.
- **Display:** exact rationals are emitted as `{numerator, denominator}`; there is no rounded display string.
