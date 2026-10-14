# B39 Slice S2 and S1 Follow-ups: Exterior, Structural, References, Execution Budget — Implementation Record

**Status:** implemented on `phase39/s1-specialists` (PR #21), on top of S1 (`ce3d2c2`; see [`b39-s1-implementation.md`](b39-s1-implementation.md)). **Not merged; not a release.** No migration. No hosted, staging, merge or tag action.

**Scope of record:** [`b39-specialist-scope.md`](https://github.com/Aryangithub13/nekoarch-backend/blob/phase39/specialist-scope/docs/phase39/b39-specialist-scope.md) on PR #20 (§3.1, §4 rows 4–5, §7 S2). The roadmap is cited as ROADMAP Lnnn.

## 1. Owner decisions applied (2026-10-14)

| ID | Decision | Effect here |
|---|---|---|
| D-4 | **Accepted**: scope and module order (Blueprint, Materials, Budget, Exterior, Structural, Interior) | S2 = Exterior and Structural, in that order |
| D-8b | **Computed on read** for S1 and S2 | The envelope stores nothing of its own. Exterior stores a Phase 30 preflight; Structural stores a B24 analysis; both in their existing tables. No `0029` |
| D-12 | **Deferred** (Interior schema: new revision-operation kind, V2 space finish fields) | Interior stays a typed `UNSUPPORTED` that names D-12 and says the advisory concept routes are not an Interior implementation. S3 is not started |
| Verification | A failed independent B34 verification after a Blueprint commit is **`FAILED`** | Was `REQUIRES_REVIEW`. The reason says the revision was committed and is current, and how to restore the base |
| §4 room limit | More than 24 requested rooms is a typed `UNSUPPORTED` | Already built in S1 (`030325c`); the scope was amended to match (`8c42a35`) |
| PR #21 | Taken over by this session, fast-forward only | Every push checks that the remote head is unchanged first |

## 2. S1 follow-ups

| Item | Change | Basis |
|---|---|---|
| `referenceIds` | Up to 8 Phase 31 references, no duplicates. Each must be an **active** reference of the project, read owner-scoped (at most 4 reads at once); otherwise **422 `SPECIALIST_REFERENCE_INVALID`** before anything runs. The result lists them with `use: RECORDED_NOT_CONSUMED`: no S1/S2 engine reads reference content | ROADMAP L288 "references"; scope §3.1; PR #16 precedent (metadata only) |
| `budget` | Optional `{ ceiling, currency }`: a non-negative decimal (at most 2 places) in INR, USD or EUR. It is the **execution-cost** ceiling (§E `budget_exceeded`), not a construction-cost target: a Budget estimate is never compared with it. Every S1/S2 module runs locally at zero external cost, so the result reports `quotedExternalCost: '0'`, `withinCeiling: true`. The schema allows no other values, so an over-ceiling result cannot be expressed until a module has a cost | ROADMAP L288 "quote/budget"; scope §3.1 |
| Failed verification | Blueprint: verification `FAILED` → status `FAILED`, reason `VERIFICATION_FAILED` naming the committed revision number and the RESTORE route. `PARTIAL` stays `PARTIAL`. A verifier that cannot run is `REQUIRES_REVIEW` / `VERIFICATION_UNAVAILABLE` | Owner decision, 2026-10-14 |
| Status precedence | Extended with the Phase 30 waiting states: `UNSUPPORTED > BLOCKED_BY_LOCK > STALE_DEPENDENCY > FAILED > NEEDS_CLARIFICATION > REQUIRES_REVIEW > PARTIAL > DEGRADED_PROVIDER > AWAITING_CONSENT > CANDIDATE_READY > COMPLETED`. A test pins it to the full status list | Scope §3.3 |

## 3. S2 modules

### 3.1 Exterior (scope §4 row 4; scenarios 34 and 42)

- **Request:** `operation: modify`; targets `exterior.facade` / `exterior.materials`. Either:
  - `outputConfig.appearance` = the Phase 30 composer shape (`EXTERIOR_WALLS` target and a finish preset), or
  - an `instruction`, planned by the Phase 30 natural-language planner.
- **Locks:** `preserveScopes` map onto Phase 30 preservation scopes:
  - `building.geometry` → `BUILDING_GEOMETRY`;
  - `building.floor_plans` → `FLOOR_PLANS`;
  - `building.structure` → `STRUCTURE`;
  - `interior.layout` → `ROOMS`;
  - `interior.materials` → `INTERIOR`.

  Other scopes are held by the appearance edit's model-equivalence and byte-exact geometry locks. A lock on what Exterior rewrites (`exterior.*`, `scene3d`) is `BLOCKED_BY_LOCK`.
- **Planning is read only first.** The structured operation is planned with the Phase 30 planner before anything is stored. `UNSUPPORTED`, `NEEDS_CLARIFICATION` and `BLOCKED_BY_LOCK` come back as typed results with the planner's blockers, questions, locks and impacts. **Nothing is stored for them.**
- **Supported:** the envelope stores the Phase 30 preflight under the preflight route's durable receipt, after checking that the base is current. It returns:
  - `AWAITING_CONSENT` and the `operationId`;
  - the locks, impacts and quote;
  - `details.next`: links to the existing operation, execute, comparison, approve and reject routes, which complete the lifecycle.

  Nothing changes the model until the owner approves the candidate.
- **Honest about U2:** the reason `DOWNSTREAM_REGENERATION` says that, once approved, the base's quantities, cost, scene and engineering outputs become stale even though the model is unchanged. This is the B37 waiver U2.
- **Geometry:**
  - **Glazing, massing or openings in an instruction:** the planner refuses them (`GEOMETRY_MODIFICATION_NOT_SUPPORTED`) and lists its impacts.
  - **A geometry target scope** (`building.geometry`, `building.structure`, `building.floor_plans`): refused as `ENVELOPE_GEOMETRY_REGENERATION`, with the base's stored outputs that would be invalidated, read from its B37 manifest. The revision itself, its QA and its appearance are not listed.
- **Interior wording** (`INTERIOR_FINISH_NOT_SUPPORTED`) and **restore wording** (`OPERATION_NOT_SUPPORTED`) are typed refusals.

### 3.2 Structural (scope §4 row 5; scenario 36)

- **Request:** `operation: recompute`; target `engineering.structural`; `outputConfig` = `{ analysisType, input }`.
- **Unsupported analyses:** any analysis other than `LINEAR_STATIC` (`NONLINEAR_STATIC`, `MODAL`, `DYNAMIC`, `SEISMIC`, `WIND`, `MEMBER_DESIGN`, `FOUNDATION`) is `UNSUPPORTED` / `NO_VALIDATED_SOLVER` (`UNSUPPORTED_OPERATIONS.VALIDATED_ENGINEERING_SOLVERS`). It is refused before the input is even validated.
- **Run:** the B24 analysis runs unchanged under the structural route's durable receipt, after the current-base check. The input is validated against the structural route's own schema.
- **Result:**
  - always **`REQUIRES_REVIEW`** / `PROFESSIONAL_REVIEW_REQUIRED`;
  - the engine's own claims verbatim (`designVerification: NOT_EVALUATED`, nothing certified);
  - solver identity, counts, model assumptions and limitations;
  - the stored analysis as a `STRUCTURAL_ANALYSIS` artifact, with its freshness read from the manifest.
- **Unsupported structural source:** a revision outside the BIM profile (`STRUCTURAL_SOURCE_UNSUPPORTED`) is `UNSUPPORTED`. Other engine refusals are `FAILED` with their code.

### 3.3 Interior (unchanged; D-12 deferred)

Typed `UNSUPPORTED` / `MODULE_NOT_AVAILABLE`. The message names D-12 and states that the advisory design-concept routes are not an Interior implementation.

**Consequence for the gate (L297):** "one supported request for each of six modules" is met for five modules. Interior needs D-12, or an explicit owner waiver, before B39 can close.

## 4. Contract changes (additive to the unmerged `specialist-request-v1`)

**Request:**
- `referenceIds`;
- `budget`.

**Result:**
- `operationId` may be a uuid (Exterior);
- `locks` and `impacts` (the Phase 30 shapes);
- `references`;
- `budget`;
- details `EXTERIOR` and `STRUCTURAL`.

**Not changed:**
- No route, migration, SQL or engine change.
- The route catalog is unchanged (same single route).
- OpenAPI is regenerated.
- The discovery row `SPECIALISTS` text is updated.

## 5. Tests

| File | What it checks |
|---|---|
| `specialists.test.ts` (unit, 5) | Module sets (S1, S2, supported; Interior excluded). Each module targets only what it rewrites. Exterior never rewrites geometry. Every mapped preservation is a real Phase 30 scope. Status precedence is complete and ordered. References and budget validation. The result cannot claim jobs, provider cost, an over-ceiling quote or consumed reference content |
| `specialists.integration.test.ts` (PostgreSQL, 11) | S1 cases, updated. The refusal table gains Exterior geometry, restore and two lock conflicts, two validated-solver requests, a foreign Structural scope and the Interior/D-12 message; nothing is stored, including no operation and no analysis. **Exterior (34, 42):** preflight with user locks `FLOOR_PLANS` and `STRUCTURE` plus the exact-bytes system lock; keyed replay; then the existing execute, comparison (model and geometry identical), approve; the new revision's `APPEARANCE_VARIANT` is current and its lineage names the operation; the base is then a stale dependency. **Exterior natural language:** glazing → `GEOMETRY_MODIFICATION_NOT_SUPPORTED` with impacts; interior → `INTERIOR_FINISH_NOT_SUPPORTED`; restore → `OPERATION_NOT_SUPPORTED`; an unknown level → `NEEDS_CLARIFICATION`; none stores an operation; a supported phrase stores one with the planner's and the envelope's locks. **Structural (36):** `REQUIRES_REVIEW`, engine claims, assumptions; the artifact is the stored analysis with its route's hashes and is in the manifest; keyed replay. **References and budget:** recorded, not consumed; echoed on refusals; unknown, foreign-project and archived references → 422 with nothing run |
| `specialists-verification.integration.test.ts` (PostgreSQL, 2) | The verifier's verdict is replaced in this file only. `FAILED` → `FAILED` with the committed-revision and RESTORE reason, and the revision is current. `PARTIAL` → `PARTIAL`. Verifier unavailable → `REQUIRES_REVIEW` / `VERIFICATION_UNAVAILABLE` |
| `supabase.live.test.ts` (local Supabase) | The S1 case's refusal example is now Interior (an empty Exterior request is a 400). New S2 case through real JWTs, PostgREST and RLS: an Exterior preflight with its structure lock, a keyed replay, and the operation row owner-only. A Structural analysis that is `REQUIRES_REVIEW`, with the analysis row owner-only. A seismic request is a typed refusal |

**Mutation checks: 9 of 9 caught.** Each was applied alone and caught by the suites above:
1. verification `FAILED` reported as `REQUIRES_REVIEW`;
2. reference status unchecked;
3. Exterior current-base check removed;
4. Exterior drops the envelope's locks;
5. Exterior stores refused plans (first survived; the unknown-level case was added and it is now caught);
6. Structural not `REQUIRES_REVIEW`;
7. validated-solver check removed;
8. geometry refusal removed;
9. Interior falls through to the generic refusal.

## 6. Not in S2

- **S3, Interior:** waits for D-12. No migration, operation kind or finish fields.
- **U2, element-level invalidation:** still open. The Exterior result says so instead of hiding it; the waiver's exit condition stays with B39 (scope §5).
- **Glazing or massing geometry editing:** no engine exists.
- **Validated engineering solvers, regional or sourced rate books, substitution provenance:** unchanged, still refused by type.
- **Durable specialist results, history or fetch-by-id:** D-8b.

Evidence (local runs, CI and the local Supabase receipt) is in the PR #21 description.
