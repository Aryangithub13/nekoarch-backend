# Phase 28 source audit — optimization & autonomous design iteration V1

Status: **PHASE 28 SOURCE AUDIT COMPLETE** (2026-10-08). Audit only; no production source changed.

## 0. Preflight and isolation

| Item | Observed |
|---|---|
| Main tree | `/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow`, branch `phase27/specialized-knowledge`, HEAD `4d1f431` (= `backend-v1-phase26-complete`) |
| Phase 27 state in main tree | **Active, uncommitted**: 9 modified + 12 untracked entries (knowledge engine, 0017, tests, docs/phase27). Release run 1 failed (4 tests); no `backend-v1-phase27-complete` tag. |
| Phase 27 processes | None running at preflight (no vitest / verify-phase27 / mutation process; no source file modified in the prior 3 h). Codex desktop apps are open, so another agent *could* act on the main tree. |
| Decision (human-approved) | Phase 28 lives in a separate worktree: `/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow-phase28`, branch `phase28/optimization-v1`, base `backend-v1-phase26-complete` (`4d1f431`). `npm ci` + `npm run build` pass there. |
| Phase 27 access | Read-only, from the main-tree path. Nothing under `apps/api/src/knowledge/**`, `docs/phase27/**`, `0017*` or Phase 27 tests is touched. The Phase 28 worktree does not contain Phase 27 source at all. |

## 1. Classification summary

| Source | Class | Why |
|---|---|---|
| `packages/shared/src/building-v2/parametric.ts` (`ParametricFloorSchema`, `ParametricArchitectureSchema`) | REUSE | Defines the only bounded, reviewed parameter submodel. |
| `packages/shared/src/building-v2/parametric-invariants.ts` | REUSE (via schema parse) | Model ↔ parameter consistency. |
| `packages/generator/src/parametric/input.ts` (`normalizeParametricRequirements`, `ParametricEditSchema`, `modifyParametricRequirements`) | REUSE | Existing typed mutation surface and full re-normalization (setbacks, buildable site, nesting). |
| `packages/generator/src/parametric/generate.ts` (`generateParametricBlueprint`) | REUSE | Deterministic L-footprint generator (seeded). |
| `packages/generator/src/solver-v2/**` (`precision-blueprint-v2`) | REFERENCE | No typed edit surface; optimizing V2 requirements is out of V1 scope. |
| `packages/generator/src/blueprint/**` (`precision-blueprint-v1`) | REFERENCE | Same. |
| `packages/blueprint-qa` (`auditBlueprint`) | REUSE | Independent hard-gate QA. |
| `apps/api/src/services/project-service.ts` (`projectQaOptions`) and `services/parametric-qa.ts` (`parametricQaOptions`) | REUSE | Exact QA options the accept path uses. |
| `apps/api/src/lib/generation-identity.ts` (`modelHash`, `requirementsHash`, `canonicalBuilding`) | REUSE | Authoritative model/requirements identity. |
| `packages/boq-cost/src/hash.ts` (`costHash`, `costCanonical`) | REUSE | Canonical JSON matching SQL `project_private.canonical_json` (needed for 0018 parity later). |
| `packages/quantity-takeoff` (`calculateQuantityTakeoff`) | REUSE | Pure, exact (decimal strings), in-memory. |
| `packages/construction-calculations` (`calculateConstruction`) | REUSE | Pure; specification selectors decide transferability (§6). |
| `packages/boq-cost` (`calculateBoqCost`, `sampleRateBook`) | REUSE | Pure; bundled rate books only (`sample-inr-v1/v2`). Money engine untouched. |
| `apps/api/src/bim/**` (Phase 23) | REFERENCE | Not needed for V1 metrics; BIM IDs hash source entity IDs. |
| `apps/api/src/structural/**` (Phase 24) | REFERENCE / DO_NOT_TOUCH | Inputs bind to wall IDs (§7) — not transferable to candidates. |
| `apps/api/src/environmental/**` (Phase 25) | REFERENCE / DO_NOT_TOUCH | Inputs bind to `bimElementId` / `surfaceId` (§7). |
| `apps/api/src/systems/**` (Phase 26) | REFERENCE / DO_NOT_TOUCH | Inputs bind to level/space/wall/opening IDs (§7). |
| `apps/api/src/knowledge/**` (Phase 27, main tree only) | REFERENCE (public contracts only) / DO_NOT_TOUCH | Unreleased; revision-bound services (§8). |
| `apps/api/src/app.ts`, `lib/repository.ts`, `lib/supabase.ts`, `lib/sentry.ts`, `test-support/pg-backend.ts`, `supabase/**` | DO_NOT_TOUCH (until Phase 27 release) | Shared files Phase 27 has modified in the main tree. |

## 2. Building Model V2 (A)

- `ArchitecturalBuildingModelV2Schema` (`packages/shared/src/building-v2/model-shape.ts`) carries an optional `parametricArchitecture` submodel. `validateParametricInvariants` requires each level boundary to equal the six-vertex L ring computed from the parameters, one exact covering slab per floor, stair-only slab voids, and no upper overhang.
- `provenance` is excluded from `modelHash` (`canonicalBuilding`), so execution metadata cannot perturb identity.

## 3. Precision Solver V2 / V1 (B)

- `precision-blueprint-v2` accepts layout objectives and weights (`layoutV2.objectives`, 0–10 integers). These are the solver's *internal* soft preferences, not a typed edit surface, and changing them changes the layout search itself.
- **Finding:** V2/V1 revisions are not optimizable in V1. A request against a non-parametric revision returns `UNSUPPORTED` (typed refusal). Deferred: a reviewed V2 edit surface.

## 4. Phase 22 parametric architecture (C) — safe variables

The existing, already-reviewed mutation surface is `ParametricEditSchema`:

```
level ∈ {0, 1}
parameter ∈ {widthMm, depthMm, westWingWidthMm, southWingDepthMm}
valueMm: integer, 1000 … 60000
```

So **at most 8 variables** (4 parameters × ≤ 2 levels). Each value goes through `normalizeParametricRequirements`, which already enforces:

- `westWingWidthMm < widthMm`, `southWingDepthMm < depthMm` (non-degenerate L arms);
- coordinate range;
- every site setback and buildable-boundary containment;
- upper floor contained in lower floor (no cantilever);
- `interiorWall ≤ exteriorWall`, circulation ≥ 600 mm.

The generator then enforces room-bank feasibility (`PROGRAM_DOES_NOT_FIT`), stair fit (`STAIR_PLACEMENT_FAILED`), connected circulation (`IMPOSSIBLE_LAYOUT`) and its own operation budget (`SEARCH_LIMIT_EXHAUSTED`, deterministic).

Not safe or not V1 (no typed edit surface, or semantic change):

| Candidate variable | Verdict |
|---|---|
| `origin.x/z` | Moves the building on the site. Quantities are invariant, so it's only a setback lever. **Deferred.** |
| `circulationWidthMm`, wall thicknesses, `floorToFloorHeightMm`, room minimums | Valid requirement fields, but not in `ParametricEditSchema`, and they change the room program's clear sizes. **Deferred** (needs a reviewed edit surface). |
| `floors`, room counts/types, relationships, `shape` | Topology/program change. **Never in V1** (`UNSUPPORTED`). |
| `seed` | Execution selection, excluded from `requirementsHash` by design. **Never a variable**; the source revision's seed is fixed. |

**Determinism finding:** `generateParametricBlueprint` throws `SOLVER_TIMEOUT` on a **wall-clock** deadline. If a timeout were recorded as a candidate rejection, results would depend on machine speed. V1 must abort the whole study (`RESOURCE_LIMIT`) on any timeout or cancel, never record it per candidate. `SEARCH_LIMIT_EXHAUSTED` is operation-counted, so it's a deterministic candidate rejection.

**Spike (in-memory, this worktree, 5-run averages):**

| Fixture | gen | schema | QA | takeoff | construction | cost | Same `modelHash` ×5 |
|---|---|---|---|---|---|---|---|
| 1-storey L (`parametricInput()`) | 28.7 ms | 1.5 | 4.8 | 8.0 | 5.0 | 2.7 | yes |
| 2-storey L (`parametricInput(true)`) | 21.5 ms | 3.8 | 8.8 | 11.5 | 6.3 | 3.5 | yes |

About 50 ms per fully costed candidate, dominated by generation. A `widthMm` sweep of 12 000–21 000 mm in 500 mm steps gave 19/19 valid. **Implication:** synchronous studies are bounded to roughly hundreds of candidates, not thousands (§ limits in design).

## 5. Blueprint QA (D)

- The accept path is `auditBlueprint(model, { ...projectQaOptions(model), ...parametricQaOptions(r) })`. `projectQaOptions` gives reachability from exterior ground-floor doors plus `PRODUCT_DEFAULTS_RULE_PACK`. `parametricQaOptions` gives the parameter submodel, required clear spaces with min width/depth/area, and hard relationships.
- Report `status ∈ {PASS, PASS_WITH_WARNINGS, FAIL}`. `readBim` defines acceptance as status PASS or PASS_WITH_WARNINGS, `inputStatus = SCHEMA_VALID`, `summary.errors = 0`.
- **Hard constraint:** a candidate whose QA fails that acceptance rule is `REJECTED` (`QA_FAILED`), with bounded finding codes. QA warnings are allowed (same as acceptance), and can be tightened by an explicit constraint.

## 6. Revision generation (E) and takeoff / construction / cost (F)

- `saveProjectRevision` generates, parses, runs QA, then persists through a signed RPC. All steps before `repository.write` are pure, so a candidate can be built in memory **without** a revision row. Phase 28 never calls `saveProjectRevision` or `repository.write('revision', …)`.
- `ProjectRevisionDetailSchema` stores `generatorVersion`, `normalizedRequirements` and `identity.modelHash`. An optimization source must be a revision with `generatorVersion = 'parametric-architecture-v1'` and non-null `normalizedRequirements`.
- **Baseline reproducibility:** regenerating the source's own normalized requirements (same seed) must reproduce `identity.modelHash`. A mismatch means generator drift, and V1 refuses the study (`OPTIMIZATION_BASELINE_MISMATCH`). This proves the candidate pipeline is the same pipeline that produced the accepted revision.
- Takeoff totals are exact decimal strings with a status per item (`EVALUATED | PARTIAL | NOT_EVALUATED`). Useful codes include `GEOMETRIC_GROSS_FLOOR_AREA`, `LEVEL_ENVELOPE_AREA`, `SPACE_FLOOR_AREA`, `WALL_CENTERLINE_LENGTH`, `WALL_SEGMENT_NET_VOLUME` and `WALL_SINGLE_FACE_NET_AREA`, with sections by level and classification.
- Construction selectors are `default | specification | classification | level | entity`. **Only `entity` selectors bind to one model's IDs.** Wall/opening IDs are geometry-addressed in parametric models, so a specification with `entity` selectors is **not transferable** to candidates.
- Cost (`finalTotals`) has `pricedGrandTotal` (priced scope only), `completeTotalAvailable` and `completeRepresentedScopeTotal` (null when incomplete). **Finding:** with the repository's own fixture specification, `completeTotalAvailable = false` on both spike models. A naive "minimize cost" over `pricedGrandTotal` would compare different priced scopes, so V1 must never treat missing cost as zero (design §cost).

## 7. Phases 23–26 (G–J)

| Phase | Input binding | Per-candidate evaluation in V1 |
|---|---|---|
| 23 BIM | `projectBim(model, binding)` is pure; semantic IDs = hash(projectId, role, sourceId) | Not needed for V1 metrics → not run |
| 24 structural | `structural-input-v1` rules reference `wallId` / `bimElementId` | **NOT_EVALUATED** — source inputs are not transferable to geometry-addressed candidate walls |
| 25 environmental | Inputs reference `bimElementId` / `surfaceId`; also need location, orientation and material provenance | **NOT_EVALUATED** — same |
| 26 systems | Inputs reference level/space/wall/opening IDs | **NOT_EVALUATED** — same |

The prompt's "structural/system violation constraints when the artifact exists" cannot be honored per candidate in V1 without a candidate-scoped input-transfer contract, so it's deferred. V1 rejects engineering constraints at input validation (`UNSUPPORTED`) instead of pretending.

## 8. Phase 27 public contracts (K) — read-only

- Versions: `specialized-knowledge-input-v1`, `specialized-knowledge-analysis-v1`, `project-facts-v1`.
- Service surface is revision-bound and repository-backed (`validateKnowledge`, `createKnowledgeAnalysis(repository, userId, projectId, revisionId, input)`). There is **no** pure "evaluate this in-memory model" entry point, and facts come from persisted Phase 23–26 analyses that candidates don't have.
- **PHASE27_INTEGRATION_DEFERRED.** The desired interface (to be exposed by Phase 27 or an adapter after its release) is:

```ts
interface OptimizationKnowledgeAdapter {
  readonly version: string;                          // e.g. 'knowledge-optimization-adapter-v1'
  evaluateCandidate(candidate: {
    model: BuildingModelV2; modelHash: string;
    binding: { projectId: string; sourceRevisionId: string; candidateId: string };
  }, request: { packIds: string[]; ruleIds?: string[] }): {
    status: 'EVALUATED' | 'NOT_EVALUATED';
    rules: { ruleId: string; result: 'MEETS_RULE' | 'DOES_NOT_MEET_RULE' | 'REVIEW_REQUIRED' | 'NOT_EVALUATED' | 'UNSUPPORTED' }[];
    conflicts: number;
  };
}
```

V1 runs with `knowledge = null`. Knowledge constraints and objectives are `UNSUPPORTED` at input validation, and `sources.knowledgeAnalysisId` must be null.

## 9. Shared-file impact

None for the parallel core. Everything lives under `apps/api/src/optimization/**`, `apps/api/tests/optimization*.test.ts`, `scripts/benchmark-optimization.ts` and `docs/phase28/**`. A `test:optimization` package script and `benchmark:optimization` would touch `package.json`, which Phase 27 has modified in the main tree. That's acceptable on this branch (separate worktree), but it will need a merge at integration time.
