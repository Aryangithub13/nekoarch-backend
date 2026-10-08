# Phase 28 design — optimization & autonomous design iteration V1

Status: **PHASE 28 DESIGN COMPLETE**. D1–D5 approved; D6 approved for the isolated core only (PHASE28_EXECUTION_MODEL_INTEGRATION_DECISION_PENDING). Implementation amendments (dedup before QA, measured limits) are recorded in [phase28-core-progress.md](phase28-core-progress.md) §2 and §5 and supersede §15/§21 where they differ.
Mode: parallel-safe. Phase 27 is unreleased. Nothing here touches Phase 27, shared wiring or migrations.
Source facts: [phase28-source-audit.md](phase28-source-audit.md).

## 1. Scope in one paragraph

Given an **accepted `parametric-architecture-v1` revision**, a typed `optimization-input-v1` declares up to 8 dimension variables (the existing `ParametricEditSchema` surface), hard constraints, objectives, and either `WEIGHTED_SCORE` or `PARETO`. The optimizer enumerates candidates deterministically. It builds each one in memory through the **existing** normalizer → generator → schema → independent QA → takeoff → (optional) construction/cost chain, rejects invalid ones, measures exact metrics, scores and ranks them, and returns an advisory `optimization-study-v1`. An independent validator checks the whole study. Nothing is persisted, and no revision is created or changed (`architectureMutation: "NONE"`).

## 2. Pipeline

```
accepted revision (parametric-architecture-v1, normalizedRequirements, identity.modelHash)
  → validateOptimizationInput (schema + semantic checks against the source)
  → derive domains → exact BigInt candidateSpaceSize → preflight (refuse before any generation)
  → baseline rebuild; modelHash must equal source identity.modelHash  [else OPTIMIZATION_BASELINE_MISMATCH]
  → strategy (GRID | DETERMINISTIC_LOCAL_SEARCH) yields assignments in canonical order
  → per assignment: apply edits → normalizeParametricRequirements → generateParametricBlueprint(seed = source seed)
        → ArchitecturalBuildingModelV2Schema.parse → auditBlueprint(projectQaOptions ⊕ parametricQaOptions)
        → modelHash → dedupe → Stage A metrics (takeoff) → Stage B metrics (cost, if requested)
  → hard constraints → objectives → normalization → score / Pareto → ranking
  → optimization-study-v1 (+ resultHash)
  → independent validateOptimizationStudy (recomputes; imports no optimizer scoring code)
```

## 3. Input contract — `optimization-input-v1`

```ts
{
  version: 'optimization-input-v1',
  variables: Variable[],                      // 1..8, unique (level, parameter)
  hardConstraints: Constraint[],              // 0..16 (implicit gates in §5 always apply)
  objectives: Objective[],                    // 1..8, unique objectiveId
  strategy:
    | { kind: 'GRID' }
    | { kind: 'DETERMINISTIC_LOCAL_SEARCH', maxEvaluations: int(1..LIMIT) },   // WEIGHTED_SCORE only
  mode: 'WEIGHTED_SCORE' | 'PARETO',
  cost: null | { rateBookId: 'sample-inr-v1' | 'sample-inr-v2', specification: ConstructionSpecificationInput,
                 policy: CostingPolicyInput },                                  // required iff a cost metric is used
  sources: { structuralAnalysisId: null, environmentalAnalysisId: null, systemsAnalysisId: null, knowledgeAnalysisId: null }
}
```

- Strict Zod everywhere. Integers only for mm. Exact decimal **strings** (`/^-?(0|[1-9]\d*)(\.\d{1,9})?$/`) for bounds, targets and tolerances. No floats, NaN or Infinity can enter.
- `sources.*` are `z.null()` in V1. Non-null → `UNSUPPORTED` (§7, D5). The field exists so 0018 and the adapter can widen it later without a version bump in meaning.
- Bounded JSON preflight (bytes, depth, nodes) is reused in the pattern of `normalizeParametricRequirements`.
- `inputHash = costHash({ version, ...normalizedInput })` after canonical sorting (variables by `(level, parameter)`, constraints and objectives by id).

## 4. Variables

```ts
Variable = {
  variableId: id,                              // ^[a-z0-9][a-z0-9_-]{0,63}$
  target: { kind: 'PARAMETRIC_FLOOR_DIMENSION', level: 0 | 1,
            parameter: 'widthMm' | 'depthMm' | 'westWingWidthMm' | 'southWingDepthMm' },
  unit: 'mm',
  domain: { kind: 'RANGE', minimumMm: int, maximumMm: int, stepMm: int>0 }    // values = min, min+step, … ≤ max
        | { kind: 'VALUES', valuesMm: int[] (1..64, strictly increasing) },
  allowedMutation: 'SET_PARAMETRIC_DIMENSION'  // the only V1 mutation type
}
```

- Every value must be within 1000–60000 (`ParametricEditSchema`). `level` must exist in the source.
- RANGE requires `(max − min) % step === 0`, so there's no silent truncation, and cardinality `(max − min)/step + 1 ≤ valuesPerVariable`.
- **Baseline value** is recorded from the source (`provenance: 'SOURCE_REVISION'`). It doesn't have to be in the domain for GRID. For LOCAL_SEARCH it must be in every domain (it's the start point).
- No paths, JSON pointers or expressions. `target` is a closed enum mapped by code to `ParametricEditSchema`.

## 5. Hard constraints

**Implicit gates** (always on, can't be removed). Failure → `REJECTED` with a reason code:

| Gate | Source | Reason code |
|---|---|---|
| Edit + re-normalization succeeds | `normalizeParametricRequirements` | `PARAMETERS_INVALID` / `SETBACK_VIOLATION` / `SITE_CONTAINMENT` / `UNSUPPORTED_GEOMETRY` (mapped from `BlueprintError.code` + message class) |
| Generation succeeds | `generateParametricBlueprint` | `PROGRAM_DOES_NOT_FIT`, `STAIR_PLACEMENT_FAILED`, `IMPOSSIBLE_LAYOUT`, `GENERATOR_SEARCH_LIMIT` |
| Model schema + invariants | `ArchitecturalBuildingModelV2Schema` | `MODEL_INVARIANT_FAILED` |
| Independent QA acceptance | `auditBlueprint` (same rule as `readBim`) | `QA_FAILED` (+ ≤ 10 finding codes) |
| Program preserved | follows from fixed requirements (only dimensions change) + QA `requiredClearSpaces` | covered by `QA_FAILED` |

`SOLVER_TIMEOUT` / `SOLVER_CANCELLED` are **never** candidate outcomes. They abort the study with `RESOURCE_LIMIT` (wall-clock dependent; audit §4).

**Explicit constraints:**

```ts
Constraint = { constraintId: id, kind: 'METRIC_BOUND', metric: MetricRef, operator: 'LE' | 'GE', value: decimalString }
           | { constraintId: id, kind: 'QA_NO_WARNINGS' }
```

If the metric is `EVALUATED`, the comparison is exact and a failure gives `REJECTED` (`CONSTRAINT_FAILED:<id>`). If the metric isn't evaluated, the candidate is `INPUT_INCOMPLETE`: never treated as a pass, never as 0, never ranked.

## 6. Metric catalog

All values are exact: BigInt mm/mm²/mm³ from takeoff decimal strings, money as exact decimal. Each metric records `stage`, `status` and `source`.

| MetricRef | Unit | Stage | Source |
|---|---|---|---|
| `GROSS_FLOOR_AREA` | mm² | A | takeoff total `GEOMETRIC_GROSS_FLOOR_AREA` |
| `FOOTPRINT_AREA` | mm² | A | takeoff `LEVEL_ENVELOPE_AREA`, level section `level-0` |
| `WALL_CENTERLINE_LENGTH` | mm | A | takeoff total |
| `WALL_NET_VOLUME` | mm³ | A | takeoff `WALL_SEGMENT_NET_VOLUME` |
| `CLASSIFICATION_FLOOR_AREA(c)` (e.g. `circulation`, `bedroom`) | mm² | A | takeoff `SPACE_FLOOR_AREA`, classification section `c` |
| `SPACE_FLOOR_AREA(spaceId)` | mm² | A | takeoff `SPACE_FLOOR_AREA` item for that space (parametric space IDs `space-<type>-<n>` are stable) |
| `RATIO(a, b)` (a, b ∈ above, b ≠ 0) | 1 | A | exact rational a/b |
| `PRICED_SCOPE_TOTAL` | currency minor-exact | B | boq-cost `finalTotals.pricedGrandTotal`, under §7 comparability |

- Takeoff item status `PARTIAL` / `NOT_EVALUATED` propagates: the metric is `INPUT_INCOMPLETE` and never coerced.
- Unknown or unsupported metric names fail input validation (`UNSUPPORTED`). An unknown `spaceId` or classification is checked against the **baseline** model at validation time.
- Structural, environmental, systems, daylight and knowledge metrics: **not in the catalog** (audit §7–8).

## 7. Cost policy (never "missing = 0")

Audit finding: on parametric models, construction is `PARTIAL` (takeoff `SPECIFICATION_UNKNOWN`, partial ceiling basis) and six scopes are excluded. So `completeTotalAvailable` is false even with every BOQ line priced. A complete-total objective would always be unavailable, and a raw `pricedGrandTotal` objective would compare different scopes.

**V1 rule (D2): comparable priced scope.**

- `cost.specification` must use no `entity` selectors (not transferable across candidates). Otherwise input → `UNSUPPORTED` (`COST_SPECIFICATION_NOT_TRANSFERABLE`).
- Per candidate: `takeoff → calculateConstruction(spec) → calculateBoqCost(sampleRateBook(id), policy)`. Money engine unchanged.
- `scopeSignature = costHash({ currency, pricingStatus, sorted unpricedLineIds, sorted excludedScopes, sorted priced lineCodes, construction status })`.
- `PRICED_SCOPE_TOTAL` is `EVALUATED` only if the candidate has **zero unpriced lines** and its `scopeSignature` equals the **baseline's**. Otherwise it's `INPUT_INCOMPLETE` with reason `COST_SCOPE_NOT_COMPARABLE` or `COST_UNPRICED_LINES`.
- The result states the scope honestly: `basis: 'PRICED_SCOPE_ONLY'`, the excluded scopes listed, `completeTotalAvailable` copied through, claim `costCertainty: NOT_CLAIMED`.

## 8. Objectives

```ts
Objective = { objectiveId: id, metric: MetricRef,
  goal: { kind: 'MINIMIZE' } | { kind: 'MAXIMIZE' } | { kind: 'TARGET', target: decimalString },
  weight: int(0..1000),                          // WEIGHTED_SCORE only; ignored (must be absent) in PARETO
  normalization: Normalization }                 // required in WEIGHTED_SCORE when weight > 0
```

- `TARGET` objective value = |v − target| (exact). It's minimized in PARETO.
- **Zero weight (D4)** = `REPORT_ONLY`: the objective is computed, explained and listed, but excluded from the score. At least one objective must have weight > 0. Negative or non-integer weights are rejected at input.
- An objective whose metric isn't `EVALUATED` for a candidate makes that candidate `PARTIAL` (unranked; listed with reasons).

## 9. Normalization (recorded per objective in the result)

Every scored objective maps to an exact rational n ∈ [0, 1] (1 = best):

| Method | Definition | Validity |
|---|---|---|
| `EXPLICIT_BOUNDS {best, worst}` | n = clamp((worst − v)/(worst − best), 0, 1) | MINIMIZE needs best < worst; MAXIMIZE needs best > worst; TARGET not allowed |
| `CANDIDATE_RANGE` | best/worst = min/max of v over ranked-eligible candidates (direction-aware). If all equal: n = 1 for all, flag `DEGENERATE_RANGE` | MINIMIZE / MAXIMIZE |
| `TARGET_TOLERANCE {tolerance > 0}` | n = max(0, 1 − |v − target| / tolerance) | TARGET only |

Clamping is recorded per candidate (`clamped: true`). Raw mm, mm², money and ratios are never added together.

## 10. Weighted score

score = Σ(wᵢ · nᵢ) / Σwᵢ over objectives with wᵢ > 0, as an exact rational. It's serialized as `{numerator, denominator}` plus a display string (6 decimals, truncated toward zero; display only). Ranking compares exact rationals.

Order: score descending, then **canonical order**. Canonical order is the lexicographic order of the full 8-slot parameter vector `(L0.width, L0.depth, L0.westWing, L0.southWing, L1.…)` ascending, with absent level-1 slots sorting first.

## 11. Pareto

- Eligible: `VALID` candidates with every objective `EVALUATED`.
- Oriented values: MINIMIZE → v; MAXIMIZE → −v; TARGET → |v − t|. a dominates b ⇔ a ≤ b on all and a < b on at least one.
- `paretoStatus`: `NON_DOMINATED` | `DOMINATED` (with up to 5 dominating candidateIds in canonical order) | `NOT_ELIGIBLE`.
- Identical vectors from different models are all non-dominated and cross-referenced as `equivalentObjectiveVector`.
- Frontier is listed in canonical order. In PARETO mode, `recommendedCandidates` is the frontier. There's no single winner, and nothing is ranked by weights.
- Cost: O(n²·k), bounded by limits (n ≤ 128, k ≤ 8).

## 12. Strategies

- **GRID** (also covers bounded enumeration via `VALUES` domains). It enumerates the full Cartesian product in canonical order and is only allowed if `candidateSpaceSize ≤ maxGridCandidates`. Claim: `BEST_IN_EVALUATED_SEARCH_SPACE` (only when the study status is `COMPLETED`).
- **DETERMINISTIC_LOCAL_SEARCH** (D3, WEIGHTED_SCORE only). Coordinate descent from the baseline assignment:
  1. Each round, evaluate all ±1 domain-index neighbours (≤ 2·V) in canonical order.
  2. Move to the best strictly better neighbour; ties go by canonical order.
  3. Stop at a local optimum or at `maxEvaluations` (operation-count, deterministic).

  Scores need fixed normalization, so `CANDIDATE_RANGE` is **not allowed** with local search. Claim: `BEST_FOUND`. It has no RNG and no seed, so reruns are byte-identical.
- Stochastic strategies: not in V1.

## 13. Search-space explosion

`candidateSpaceSize = Π |domainᵢ|` is computed in **BigInt** before anything is generated.

- GRID: if it exceeds `maxGridCandidates`, refuse with `OPTIMIZATION_RESOURCE_LIMIT` (`{ limit: 'candidateSpaceSize', value, max }`, values as strings).
- LOCAL_SEARCH: the space may be large. `maxEvaluations ≤ maxEvaluatedCandidates` bounds the work.

## 14. Identity and deduplication

- `candidateId = costHash({ version: 'optimization-candidate-v1', projectId, sourceRevisionId, sourceModelHash, generatorVersion, seed, parameters: fullParameterVector })`. It's independent of objectives and weights, so the same building parameters converge to the same identity across studies. The study binds `inputHash` separately.
- `modelHash` comes from `lib/generation-identity.ts` (unchanged). Deduplication is by `modelHash`: the first candidate in canonical order is evaluated, and later assignments yielding the same model are recorded under its `aliases` (assignment + candidateId) and never re-measured.
- The display `ordinal` is metadata only.

## 15. Baseline and acceptance safety

- The baseline is always candidate #0 (the source parameters). If its rebuilt `modelHash ≠ revision.identity.modelHash` (or the revision lacks identity), the study is refused with `OPTIMIZATION_BASELINE_MISMATCH`.
- Source eligibility: `generatorVersion === 'parametric-architecture-v1'`, `normalizedRequirements` present, QA acceptance per `readBim`. Otherwise `UNSUPPORTED` or `REVISION_NOT_ACCEPTED`.
- Every candidate has `architectureMutation: 'NONE'`. A candidate carries `adoption: { parametricEdits: ParametricEdit[] }`: the exact edits a client can pass, through the **existing** generate-revision endpoint, to create a normal revision with QA re-run. No new adoption path or hidden revision.

## 16. Result — `optimization-study-v1`

```ts
{
  version: 'optimization-study-v1',
  binding: { projectId, sourceRevisionId, sourceModelHash, generatorVersion, seed, parameterHash },
  inputHash, engine: { optimizerVersion: 'optimization-engine-v1', metricsVersion: 'optimization-metrics-v1' },
  status: 'COMPLETED' | 'NO_VALID_CANDIDATE' | 'BUDGET_EXHAUSTED',
  strategy, mode,
  search: { candidateSpaceSize: string, evaluated, rejected, valid, partial, inputIncomplete, deduplicated },
  baseline: { candidateId, parameters },
  candidates: [{
    candidateId, ordinal, parameters, assignment: { [variableId]: valueMm }, aliases: [...],
    modelHash: string | null, status: 'VALID' | 'REJECTED' | 'PARTIAL' | 'INPUT_INCOMPLETE',
    rejection: null | { stage, code, details: string[] },
    metrics: { [metricKey]: { status, stage: 'A' | 'B', unit, value: string | null, reason: string | null } },
    constraints: [{ constraintId, result: 'PASS' | 'FAIL' | 'NOT_EVALUATED' }],
    objectives: [{ objectiveId, status, value, normalized: Exact | null, clamped, weight, contribution: Exact | null }],
    score: Exact | null, rank: int | null, paretoStatus, dominatedBy: string[],
    architectureMutation: 'NONE', adoption: { parametricEdits }
  }],
  normalization: [{ objectiveId, method, best, worst, target, tolerance, degenerate }],
  paretoFrontier: string[], recommendedCandidates: string[],
  engineering: { structural: 'NOT_EVALUATED', environmental: 'NOT_EVALUATED', systems: 'NOT_EVALUATED',
                 knowledge: 'NOT_EVALUATED', reason: 'UPSTREAM_INPUTS_NOT_TRANSFERABLE_TO_CANDIDATES' },
  limits: { ...frozen limits },
  claims: { searchResult: 'BEST_IN_EVALUATED_SEARCH_SPACE' | 'BEST_FOUND' | 'NONE', globalOptimality: 'NOT_CLAIMED', ... },
  resultHash
}
```

- Candidate models are **not** embedded. They're regenerable from `binding` + `parameters`, which keeps the snapshot small.
- Timings live outside the hashed result (`diagnostics`, not persisted in `resultHash`).
- Every candidate's explanation is fully determined by these fields: assignments, each gate and constraint, objective values, normalization, contribution, score, Pareto status, provenance. No LLM.

## 17. Status vocabulary

Study: `COMPLETED`, `NO_VALID_CANDIDATE`, `BUDGET_EXHAUSTED` (local search only). Refusals are typed errors, not studies: `INPUT_INVALID`, `UNSUPPORTED`, `RESOURCE_LIMIT`, `BASELINE_MISMATCH`, `REVISION_NOT_ACCEPTED`.
Candidate: `VALID`, `REJECTED`, `PARTIAL` (some objective not evaluated), `INPUT_INCOMPLETE` (a constraint metric not evaluated).
Metric / objective: `EVALUATED`, `NOT_EVALUATED`, `INPUT_INCOMPLETE`, `UNSUPPORTED`.

## 18. Claims (all present and fixed)

`NOT_CLAIMED`: `globalOptimality`, `architecturalCompliance`, `structuralCompliance`, `buildingCodeCompliance`, `fireCodeCompliance`, `lifeSafetyCertification`, `energyCertification`, `costCertainty`, `professionalCertification`, `constructionReadiness`, `designApproval`.
`searchResult` is `BEST_IN_EVALUATED_SEARCH_SPACE` only for a COMPLETED GRID, `BEST_FOUND` for local search, and `NONE` when there's no valid candidate. `recommendedCandidates` means "deterministic ranking result", which the API documentation states.

## 19. Independent validator — `validateOptimizationStudy(study, evidence)`

- `evidence` = per-candidate model, takeoff and cost reports kept in memory during the run (never persisted).
- It recomputes, with its **own** BigInt arithmetic and its own metric extraction from the reports:
  - candidateIds, modelHashes (via `generation-identity`, which is authoritative identity and allowed), dedup aliases;
  - gate and constraint outcomes;
  - every metric and objective value;
  - normalization bounds (including CANDIDATE_RANGE min/max);
  - contributions and scores; ranking; Pareto dominance and frontier; `recommendedCandidates`; claims; `resultHash`.
- It imports only `contracts.ts`, `generation-identity`, `costHash` and package report schemas. A static independence gate (as in Phase 26/27) forbids imports of `optimization/{domain,candidate,rank,search,study}.ts`, and bans `eval` / `new Function` under `optimization/`.
- Output: `{ status: 'VALID' | 'INVALID', issues[] }`. An INVALID study is never returned (500-class internal error `OPTIMIZATION_VALIDATION_FAILED`, as Phases 24–27 do).

## 20. Determinism

Same revision + input + engine versions → byte-identical `candidates`, Pareto set, ranking and `resultHash`. Sources of nondeterminism and how they're handled:

- Generator wall-clock timeout → study-level abort (§5).
- Map/Set iteration → explicit sorts.
- Float → none (all exact).
- Timings → excluded from the hashed result.

## 21. Provisional limits (frozen after benchmark)

| Limit | Provisional | Basis |
|---|---|---|
| variables | 8 | edit surface |
| values per variable | 64 | |
| maxGridCandidates (space size) | 128 | ≈ 50 ms × 128 ≈ 6.4 s synchronous |
| maxEvaluatedCandidates (local search) | 128 | same |
| objectives / hardConstraints | 8 / 16 | |
| Pareto comparisons | n²·k ≤ 131 072 | |
| snapshot bytes | 2 MiB | no embedded models |
| study deadline | 20 s | wall-clock; exceeding it aborts with RESOURCE_LIMIT, never partial |

The run is synchronous on the Fastify event loop, as Phases 24–27 are. `ponytail:` blocking ≤ ~7 s per study. Move to a `worker_threads` pool if studies or concurrency grow. That's an integration-stage decision (D6).

## 22. Security

Closed enums only. No paths, pointers, expressions, `eval` or user code. The bounded JSON preflight rejects accessors, prototypes, cycles, depth > 12 and > 5000 nodes. BigInt-safe decimal parsing with length caps (≤ 40 chars). Search explosion is refused before generation. `sources` IDs are null-only in V1 (so no cross-project ID injection surface yet). Snapshot size is capped before return.

## 23. Phase 27 adapter (deferred)

The core takes `deps.knowledge: OptimizationKnowledgeAdapter | null` and V1 always passes `null`. The interface is in audit §8. Until Phase 27 is released, knowledge constraints and objectives aren't in the input schema at all (UNSUPPORTED by construction). Nothing imports `apps/api/src/knowledge/**`.

## 24. Persistence design (DEFERRED — no 0018 until Phase 27 release)

- `optimization_studies(id uuid pk, project_id, revision_id → project_revisions, user_id, input_hash, result_hash, study jsonb, created_at)`. Immutable, with update and delete triggers that raise.
- Unique `(revision_id, input_hash)` for idempotency.
- RLS: owner select only. Writes go only through a signed security-definer RPC (`optimization_write`), following the 0014–0017 pattern. SQL recomputes `input_hash` and `result_hash` through `project_private.canonical_json` (costHash parity proven by a spike, as in Phase 27).
- Staleness: a study is CURRENT only while its revision is the project's current revision (same rule as Phases 24–27).

## 25. API design (DEFERRED wiring)

Under `/api/projects/:projectId/revisions/:revisionId/optimization`:

- `POST /validate`: input checks and space size; no generation.
- `POST /studies`: compute, idempotency key, compute quota.
- `GET /studies/:studyId`, `GET /studies` (paginated), `GET /status`.

Owner-only, typed 4xx errors, and GET never computes. Adoption reuses the existing revision-generate endpoint with `adoption.parametricEdits`.

## 26. Module layout (parallel core)

```
apps/api/src/optimization/
  contracts.ts   schemas, versions, limits, claims, status enums
  domain.ts      domains, BigInt space size, canonical enumeration, preflight
  candidate.ts   edit → normalize → generate → QA → takeoff/cost → metrics; gate mapping
  rank.ts        constraints, objectives, normalization, scores, Pareto, ranking (exact rationals)
  study.ts       runOptimizationStudy(source, input, deps): GRID + local search, dedup, assembly, resultHash
  validate.ts    independent validator (no imports of the four modules above)
apps/api/tests/optimization.test.ts       in-process unit tests (§27)
scripts/benchmark-optimization.ts          §29
docs/phase28/{phase28-core-progress.md, validator-independence.mjs, mutation-test.py (later)}
```

## 27. Tests (in-process, parallel stage)

All prompt §36 cases are covered:
- one and multiple variables; exact domain boundaries; RANGE/VALUES; BigInt space size and overflow refusal;
- canonical order; dedup aliasing (forced via an identical-model assignment pair);
- each gate's rejection codes; explicit constraint fail versus incomplete;
- weighted scoring; zero weight is REPORT_ONLY; invalid weights; exact ties go to canonical order;
- Pareto dominance, incomparable candidates and equal vectors; TARGET objectives; each normalization method with clamping and degenerate range;
- unsupported metric/source/engineering → refusal; missing cost or scope mismatch → INPUT_INCOMPLETE (never 0);
- baseline candidate and baseline mismatch; candidate identity convergence across studies; byte-identical rerun (`resultHash`);
- local-search determinism and budget; the source revision object deep-equal before and after (no mutation);
- validator rejects each tampered field.

## 28. Mutation plan (22 mutants, run at integration stage)

| # | Mutant | Must be killed by |
|---|---|---|
| 1 | skip a candidate in enumeration | count + validator |
| 2 | duplicate a candidate | dedup test + validator |
| 3 | alter candidateId inputs | identity test + validator |
| 4 | bypass a METRIC_BOUND | constraint test + validator |
| 5 | flip MINIMIZE comparison | ranking test + validator |
| 6 | flip MAXIMIZE comparison | ranking test + validator |
| 7 | target distance uses signed difference | TARGET test |
| 8 | ignore weights | weighted test |
| 9 | normalization uses (v − best) | normalization test |
| 10 | frontier includes a dominated candidate | Pareto test |
| 11 | frontier drops a non-dominated candidate | Pareto test |
| 12 | skip schema parse | invalid-model test |
| 13 | skip QA | QA-gate test |
| 14 | unsupported metric silently EVALUATED | refusal test |
| 15 | missing / non-comparable cost → 0 | cost test |
| 16 | preflight uses Number / skips space check | overflow test |
| 17 | unstable sort / Map order | rerun-hash test |
| 18 | dedup disabled | dedup test |
| 19 | validator trusts study score | validator tamper test |
| 20 | source requirements mutated in place | no-mutation test |
| 21 | provenance / adoption edits dropped | explanation test |
| 22 | a claim flipped to CLAIMED / GLOBAL_OPTIMUM | claims test |

## 29. Benchmarks (`benchmark:optimization`)

Scenarios: 1, 2 and 4 variables; 2-storey 8-variable local search; maximum rooms; L building; setback site; heavy dedup; Pareto-heavy; weighted; resource-limit refusal.
Measured: space size, generated / rejected / valid / deduped, per-stage ms, scoring, validation, total, snapshot bytes, `process.memoryUsage().heapUsed` delta.

## 30. Decisions requiring approval

| # | Decision | Recommendation |
|---|---|---|
| D1 | Variable surface = `ParametricEditSchema` only (≤ 8 dims). V2/V1 revisions are UNSUPPORTED. | Approve |
| D2 | Cost = `PRICED_SCOPE_TOTAL` with a comparable-scope signature (§7). Complete totals are effectively never available on parametric models. | Approve |
| D3 | Strategies = GRID + deterministic coordinate local search (weighted only). | Approve |
| D4 | Weight 0 = REPORT_ONLY; at least one positive weight required. | Approve |
| D5 | Structural/environmental/systems/knowledge are not evaluated per candidate in V1; `sources.*` null-only, engineering constraints UNSUPPORTED. | Approve |
| D6 | Synchronous execution, ≤ 128 evaluations provisional; worker pool deferred. | Approve, revisit after benchmark |

## 31. Deferred (explicitly not V1)

V2/V1 revision optimization; origin, circulation, thickness and height variables; topology/program changes; per-candidate Phase 24–26 recomputation (needs a candidate-scoped input-transfer contract); Phase 27 adapter; complete-scope cost; stochastic/seeded heuristics; top-N Stage B screening (only worthwhile once an expensive Stage B engine exists; V1 Stage B cost is ~15 ms); persistence (0018), routes, `app.ts`, Sentry templates, live Supabase, pgTAP; worker-thread execution.
