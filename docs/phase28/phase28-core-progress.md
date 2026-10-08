# Phase 28 core progress — optimization & autonomous design iteration V1

**Classification: PHASE 28 PARALLEL CORE IMPLEMENTED — INTEGRATION DEFERRED** (2026-10-08)

Phase 27 is not released (no `backend-v1-phase27-complete`). This core lives on `phase28/optimization-v1` in the separate worktree `designflow-phase28` (base `backend-v1-phase26-complete`, `4d1f431`). Nothing is committed, tagged, pushed or deployed. No migration 0018, route, `app.ts`, repository, Supabase, Sentry, pgTAP or Phase 27 file was created or modified.

Design approvals D1–D5 are applied as approved. D6 is approved for the core only: synchronous, ≤ 128 evaluated candidates. **PHASE28_EXECUTION_MODEL_INTEGRATION_DECISION_PENDING** (§5).

## 1. Files

| File | Status | Purpose |
|---|---|---|
| `apps/api/src/optimization/contracts.ts` | new | `optimization-input-v1` / `optimization-study-v1` schemas, versions, limits, claims, closed metric and variable catalogs, `OptimizationKnowledgeAdapter` seam |
| `apps/api/src/optimization/domain.ts` | new | RANGE/VALUES domains, BigInt space size, preflight, 8-slot canonical vector, grid/neighbour enumeration, `candidateId`, adoption edits |
| `apps/api/src/optimization/candidate.ts` | new | atomic edit → normalize → generate → schema → modelHash; QA; takeoff; construction/cost; metric extraction; comparable-scope cost; rejection mapping; stage timings |
| `apps/api/src/optimization/rank.ts` | new | exact rationals; constraints; objective values (TARGET distance); normalization; weighted score; Pareto; ranking |
| `apps/api/src/optimization/study.ts` | new | source eligibility, input validation, baseline rebuild/mismatch, GRID, deterministic local search, dedup + aliases, assembly, `resultHash`, snapshot cap, post-run validation |
| `apps/api/src/optimization/validate.ts` | new | independent validator (imports none of domain/candidate/rank/study) |
| `apps/api/tests/optimization.test.ts` | new | 61 in-process tests |
| `scripts/benchmark-optimization.ts` | new | 12 benchmark scenarios → `docs/phase28/evidence/benchmark.json` |
| `docs/phase28/mutation-test.py` | new | 22-mutant harness → `docs/phase28/evidence/mutation-testing.json` |
| `docs/phase28/phase28-source-audit.md`, `phase28-design.md`, this file | new | docs |
| `docs/phase28/evidence/benchmark.json`, `benchmark-maximum-128.txt`, `mutation-testing.json`, `mutation-testing-run1-collection-abort.json` | new | evidence |
| `package.json` | **modified (+2 lines)** | `test:optimization`, `benchmark:optimization`. Phase 27 also modified `package.json` in the main tree, so this needs a merge at integration. |

## 2. Implementation amendments to the design (found while building)

1. **Dedup happens before QA, not after.** Parametric QA checks the model against the *candidate's own* parameter submodel, so a model reached from different parameters can never pass QA. Dedup after QA could therefore never produce an alias. An assignment whose generated model has a modelHash equal to an already **QA-accepted** model becomes an alias and inherits that model's QA and metrics. Duplicates of QA-rejected models are re-audited and listed separately.
2. **Dedup cannot fire with the real V1 generator.** `parametricArchitecture` is embedded in the model, so distinct parameter vectors always give distinct modelHashes. Dedup is kept as a defensive invariant. It's tested and benchmarked through the injected-generator seam (`StudyDeps.generate`), which is in-process only and not reachable from any input.
3. Alias primary = the first *evaluated* assignment. The baseline is always evaluated first, then canonical order.
4. Weight-0 (REPORT_ONLY) objectives must **not** carry a normalization; weighted objectives must. PARETO objectives carry neither.
5. In WEIGHTED_SCORE mode Pareto is not computed (`paretoStatus: NOT_COMPUTED`); a Pareto frontier comes from PARETO mode. `recommendedCandidates` in weighted mode = every VALID candidate tied at the top exact score, in canonical order. Ranks stay distinct (canonical tie-break).
6. Only scored objectives (weight > 0, or every objective in PARETO) make a candidate PARTIAL. A REPORT_ONLY objective that isn't evaluated is shown with its status but doesn't block ranking.
7. A takeoff failure doesn't reject a candidate: its takeoff metrics become NOT_EVALUATED (`TAKEOFF_FAILED`). A construction/cost failure makes `PRICED_SCOPE_TOTAL` NOT_EVALUATED (`COST_FAILED:<code>`). On the baseline, a cost failure refuses the input.
8. Limits changed from provisional on measured evidence (§5): `snapshotBytes` 2 MiB → 1 MiB, `deadlineMs` 20 s → 45 s.

## 3. Tests — `npm run test:optimization`

**61 / 61 pass** (≈ 9 s). Typecheck (`tsc -p apps/api`) and ESLint on the new files are clean.

| Area | Tests |
|---|---|
| Domains & preflight | one variable + exact RANGE endpoint; VALUES × multiple variables in slot order; baseline outside GRID domain; all 8 variables (2-storey); BigInt space size (64⁸); overflow refused with **zero** generator calls; invalid range divisibility, duplicate slots, missing level, NaN, depth bomb |
| Source & baseline | baseline rebuild = accepted modelHash; identity mismatch; generator drift → BASELINE_MISMATCH; unsupported generator; missing requirements; unaccepted QA; source deep-equal before/after |
| Gates | PARAMETERS_INVALID, SITE_CONTAINMENT, SETBACK_VIOLATION, GENERATION, MODEL_INVARIANT_FAILED, QA_FAILED (`QA_PARAMETRIC_REACHABILITY`); QA warnings accepted, rejected by `QA_NO_WARNINGS`; SEARCH_LIMIT_EXHAUSTED → candidate rejection; SOLVER_TIMEOUT / SOLVER_CANCELLED → study abort; study deadline |
| Metrics & cost | exact GFA = w·south + west·(depth − south); ratio; space area; metric bound exact at the boundary; deferred metrics (STRUCTURAL, KNOWLEDGE) → UNSUPPORTED; unknown kind/classification; cost config required/unused; non-null `sources.*` → UNSUPPORTED; knowledge adapter → UNSUPPORTED (`PHASE27_INTEGRATION_DEFERRED`); cost equals the unchanged money engine; unpriced → INPUT_INCOMPLETE as objective (PARTIAL) and constraint (INPUT_INCOMPLETE), never zero; scope signature mismatch → `COST_SCOPE_NOT_COMPARABLE`; entity selector → `COST_SPECIFICATION_NOT_TRANSFERABLE` |
| Objectives & scoring | MINIMIZE vs MAXIMIZE; TARGET + TARGET_TOLERANCE (exact ⅓, clamped 0); EXPLICIT_BOUNDS (exact 3/10, clamping both ends); CANDIDATE_RANGE bounds; degenerate range → all ties → canonical ranks; REPORT_ONLY leaves scores unchanged; contributions sum exactly to score; 11 invalid weight/normalization pairings; PARETO with weights |
| Pareto | dominance; incomparable; identical vectors; rejected = NOT_ELIGIBLE |
| Identity & determinism | dedup + aliases (4 generations, 1 candidate, 3 aliases); candidateId formula, independent of objectives; byte-identical rerun; declaration order invariant; timings not hashed; adoption edits regenerate the same modelHash; `architectureMutation: NONE`; claims fixed |
| Local search | climbs to a local optimum (BEST_FOUND), byte-identical rerun; 8-variable 2-storey within budget; budget exhaustion; WEIGHTED-only, no CANDIDATE_RANGE, baseline-in-domain |
| Independent validator | accepts untampered weighted and Pareto studies; rejects tampered metric, score, rank, candidateId, search claim, NOT_CLAIMED literal, skipped candidate, status, adoption, normalization, recommendation, input, architectureMutation, Pareto frontier, dominance, resultHash, substituted evidence; static independence gate (no imports of the four optimizer modules, no `eval` / `new Function` in `optimization/`) |

## 4. Benchmark — `npm run benchmark:optimization`

Same machine as the Phase 27 runs; Node v26.10.0; studies are synchronous, so **total = main-thread blocking time**. Source: `docs/phase28/evidence/benchmark.json` and `benchmark-maximum-128.txt`.

| Scenario | Space | Evaluated | Valid / rej / dedup | Total ms | ms / assignment | Snapshot |
|---|---|---|---|---|---|---|
| 1 variable | 5 | 5 | 5 / 0 / 0 | 208 | 41.6 | 7.9 KB |
| 2 variables | 20 | 20 | 20 / 0 / 0 | 840 | 42.0 | 24 KB |
| 4 variables | 81 | 81 | 81 / 0 / 0 | 3 146 | 38.8 | 96 KB |
| 8-variable local search (2-storey) | 9⁸ | 128 | 108 / 20 / 0 (BUDGET_EXHAUSTED) | 5 103 | 39.9 | 154 KB |
| maximum 24 rooms (15) | 15 | 15 | 15 / 0 / 0 | 2 295 | 153.0 | 19 KB |
| **maximum 24 rooms (128)** | 128 | 128 | 128 / 0 / 0 | **20 051** | 156.6 | 139 KB |
| L two-storey | 45 | 45 | 45 / 0 / 0 | 2 182 | 48.5 | 51 KB |
| setback site | 15 | 15 | 11 / 4 / 0 | 424 | 28.3 | 17 KB |
| heavy deduplication | 23 | 23 | 1 / 0 / 22 | 593 | 25.8 | 7 KB |
| Pareto 128 | 128 | 128 | 128 / 0 / 0 | 4 795 | 37.5 | 198 KB |
| weighted 128 (3 objectives) | 128 | 128 | 128 / 0 / 0 | 4 921 | 38.5 | 237 KB |
| costed 128 | 128 | 128 | 128 / 0 / 0 | 5 988 | 46.8 | 210 KB |
| candidate-space refusal (60×60) | 3 600 | 0 | — | 0.95 | — | — |

Stage split for the worst case (maximum-128): generation 9.1 s, QA 2.9 s, takeoff 3.3 s, cost < 0.01 s, scoring 6 ms, **independent validation 2.9 s**. For costed-128, construction + cost adds about 9 ms per candidate. Heap deltas per scenario are in `benchmark.json`.

## 5. Limits and execution model

| Limit | Value | Justification |
|---|---|---|
| `maxGridCandidates` | **128** (unchanged) | Bounds the count. Typical models: 4.8–6.0 s; largest supported model: 20.05 s. Lower values aren't needed for correctness, only for latency, which is the execution-model decision. |
| `maxEvaluatedCandidates` | **128** (unchanged) | Same work per evaluation as GRID; 8-variable local search reached the budget at 5.1 s. |
| `snapshotBytes` | **1 MiB** (was 2 MiB) | Largest observed 237 KB at 128 candidates (3 objectives); 4.4× headroom. Models aren't embedded. |
| `deadlineMs` | **45 s** (was 20 s) | The maximum-128 study measured 20.05 s, so 20 s would refuse a *supported* request depending on machine speed. 45 s ≈ 2.2× worst case. It's a runaway guard, not a latency target. |
| `paretoComparisons` | 131 072 | n(n−1)k at n = 128, k = 8 = 130 048 fits; never the binding limit. |
| variables / values / objectives / constraints | 8 / 64 / 8 / 16 | Edit surface / input size; refusal costs < 1 ms. |

**Event-loop blocking.** Every study runs synchronously. A permitted request blocks the Node main thread for 0.2 s (1 variable), about 5–6 s (128 candidates, typical model) and up to 20 s (128 candidates, 24-room model). Fastify would stop serving every other request for that whole time.

**PHASE28_EXECUTION_MODEL_INTEGRATION_DECISION_PENDING — recommendation: option A (bounded worker pool).**

- Option B (lower synchronous limit) isn't viable. Keeping blocking under about 100 ms would allow about 2 candidates on typical models and 0 on the largest supported model.
- A is cheap here. `runOptimizationStudy(source, input)` is a pure function of serializable data, so a `worker_threads` pool of size 1–2 needs no change to the core.
- The route then needs a bounded queue (typed 503/429 when full), a per-study wall clock that terminates the worker, and the existing compute quota.
- The core's own deadline stays as the in-worker guard.
- This must be decided before any route is exposed. No route exists today.

## 6. Mutation preparation

Harness: `python3 docs/phase28/mutation-test.py` → `docs/phase28/evidence/mutation-testing.json`. Preliminary (the final run belongs to the integration-stage release).

**22 / 22 mutants killed, each by its intended test; every file restored byte-for-byte (sha256); control runs 61/61 before and after.**

| Id | Mutant (design §28) | Failing tests | …of which the in-run independent validator rejected the study |
|---|---|---|---|
| M01 | skip candidate | 44/61 | 26 |
| M02 | duplicate candidate | 1/61 | 0 |
| M03 | alter candidate identity | 51/61 | 33 |
| M04 | bypass hard constraint | 1/61 | 1 |
| M05 | reverse MINIMIZE comparison | 36/61 | 18 |
| M06 | reverse MAXIMIZE comparison | 21/61 | 3 |
| M07 | corrupt target distance | 1/61 | 1 |
| M08 | ignore objective weight | 1/61 | 1 |
| M09 | alter normalization | 40/61 | 22 |
| M10 | select dominated Pareto candidate | 19/61 | 1 |
| M11 | drop non-dominated candidate | 1/61 | 1 |
| M12 | trust invalid geometry (skip schema) | 1/61 | 0 |
| M13 | skip QA | 1/61 | 1 |
| M14 | ignore unsupported metric | 1/61 | 0 |
| M15 | treat missing cost as zero | 1/61 | 1 |
| M16 | accept candidate-space overflow | 1/61 | 0 |
| M17 | alter deterministic ordering | 51/61 | 32 |
| M18 | bypass deduplication | 1/61 | 0 |
| M19 | validator trusts optimizer score | 1/61 | 0 |
| M20 | mutate accepted revision | 58/61 | 4 |
| M21 | lose provenance (adoption edits) | 50/61 | 32 |
| M22 | change claims | 47/61 | 29 |

Run 1 (`evidence/mutation-testing-run1-collection-abort.json`) found a test-structure defect. The validator suite built its studies at module scope, so 10 mutants that the in-run validator rejects aborted collection of the whole file. They were killed, but not attributable to a test. The studies moved into `beforeAll`, and the harness now counts failures caused by `OPTIMIZATION_VALIDATION_FAILED`. Run 2 is the complete record above.

Single-killer mutants (failing count 1) are guarded by exactly one targeted test, plus the in-run validator where noted. That's the intended killer, and it's also the place to add redundancy if the integration stage wants two independent killers per mutant.

## 7. Deferred — Phase 27 integration (PHASE27_INTEGRATION_DEFERRED)

- The core runs with `knowledge = null`. Passing an adapter throws `OPTIMIZATION_UNSUPPORTED` (`PHASE27_INTEGRATION_DEFERRED`). Knowledge metrics are recognized and refused (`DEFERRED_METRIC:KNOWLEDGE`), and `sources.knowledgeAnalysisId` must be null.
- Nothing imports `apps/api/src/knowledge/**`. This worktree doesn't contain Phase 27 at all.
- Required from released Phase 27: a pure, candidate-scoped entry point (the interface is in source audit §8, mirrored in `contracts.ts` as `OptimizationKnowledgeAdapter`). Today's Phase 27 services are revision-bound and repository-backed, and their facts come from persisted Phase 23–26 analyses that candidates don't have.
- After the human confirms `backend-v1-phase27-complete`: re-audit the final Phase 27 contracts, merge through a human-approved Git process, implement the adapter, and widen `sources.knowledgeAnalysisId`.

## 8. Deferred — DB / API integration

Not started, and not allowed until Phase 27 is released:

- migration 0018 (`optimization_studies`, design §24; SQL `canonical_json` parity for `input_hash` / `result_hash`);
- repository and Supabase adapter;
- service (reads the revision through `ProjectRevisionDetailSchema`, builds `OptimizationSource`);
- routes (design §25), `app.ts` mounting, Sentry templates;
- live Supabase tests, pgTAP/RLS, compiled Docker acceptance, full cross-phase regression, final mutation run, frozen-source release verification.

The worker-pool decision (§5) is a precondition for the routes.

## 9. Known limitations

- **Scope:** only accepted `parametric-architecture-v1` revisions; only the 8 `ParametricEditSchema` dimensions; GRID and deterministic coordinate descent. Local search finds a local optimum (`BEST_FOUND`).
- **Engineering:** Phases 24–26 and 27 are not evaluated per candidate. Their inputs bind to geometry-addressed IDs that change with every dimension edit.
- **Cost:** compared only on a scope identical to the baseline's (`PRICED_SCOPE_ONLY`). On parametric models construction is upstream PARTIAL and six scopes are excluded, so complete totals are unavailable. `costCertainty` is NOT_CLAIMED. Only the bundled sample rate books are used (synthetic, not market data).
- **Validator trust boundary:** the validator recomputes identity, enumeration, models (hash + parameters), QA acceptance, metrics, constraints, normalization, scores, ranks, Pareto, local-search replay, claims and hashes. For rejection *codes* at the GENERATION and MODEL stages it re-checks shape only, because re-running the generator would duplicate the engine. NORMALIZATION and QA rejections are re-verified. Rejected candidates are never ranked.
- **Determinism:** the generator's wall-clock timeout and the study deadline abort the whole study and never record partial results, so outputs are byte-identical or refused. *Whether* a near-deadline study is refused still depends on machine speed. The 45 s deadline leaves 2.2× margin over the largest measured case.
- **Blocking:** synchronous execution (§5) is acceptable only for this isolated core.
- **Display:** exact rationals are emitted as `{numerator, denominator}`. There's no rounded display string yet; that's an API-layer concern.
