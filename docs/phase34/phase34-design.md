# Phase 34 design — complex building verification

## 1. Principle

An **independent** verifier re-derives site and building facts from an accepted revision's Building Model V2. It has its own exact integer geometry and does not import the generator, blueprint QA or BIM. It closes the cases the existing QA reports as `NOT_EVALUATED`. Every number is exact (integer millimetres, doubled-area integers, reduced fractions) and comes with its formula, inputs and entity ids (F35 rules 01–02). Nothing is stored and nothing is changed: a verification report is **derived on read**, deterministic, and identified by an input hash.

Roadmap mapping (B34): *"independently check complex geometry, site polygons, dimensions and scoped diffs … finds hidden errors and verifies site/blueprint consistency."* F35 update: *"canonical integer millimetres; validate site/building polygons, voids and intersections. Separate plot, footprint, gross floor plate, usable area, coverage and statutory FAR/FSI bases."*

## 2. Gaps closed (from the Phase 11/23 QA report)

| Existing QA outcome | Phase 34 verification |
|---|---|
| `QA_SETBACK_NOT_EVALUATED` — setbacks only on axis-aligned rectangular sites | Exact distance from **any** site boundary edge (any polygon) to the building envelope, compared with integer arithmetic |
| `QA_SPACE_PLATE_NOT_EVALUATED` — a space spanning several floor plates | Exact containment in the **union** of the level's floor plates (rectilinear geometry; anything else is reported `NOT_EVALUATED`) |
| `QA_OPENING_TOPOLOGY_NOT_EVALUATED` — openings on non-orthogonal hosts | Exact `offset + width ≤ host length` for any host direction (squared comparison) |
| No area bases | Plot, buildable, ground coverage, per-level gross plate, gross floor area, net space area, coverage ratio and FAR/FSI, each a separate, named basis |
| No vertical consistency | Upper-plate overhang beyond the plates below (rectilinear), reported with its exact area |
| No scoped diff | Entity-level comparison of two revisions against a declared change scope |

## 3. Bases (F35 rule 01), all exact

| Basis | Definition |
|---|---|
| `plotArea` | Area of `site.boundary` |
| `buildableArea` | Area of `site.buildableBoundary`, or `null` when not declared |
| `groundCoverage` | Area of the union of `floor` slab footprints (outer minus voids) on the lowest storey level. If no floor slabs: that level's `boundary`. |
| `grossPlate[level]` | Area of the union of the level's `floor` slab footprints; fallback is the level `boundary` (`method` says which) |
| `grossFloorArea` | Sum of `grossPlate` over `storey` levels |
| `netSpaceArea` | Sum of space boundary areas (as modeled: centerline basis, no wall deduction) |
| `coverageRatio` | `groundCoverage / plotArea` |
| `far` | `grossFloorArea / plotArea` (FSI is the same ratio by definition) |

Ratios are returned as a reduced fraction (`numerator`, `denominator`, integer strings) and as a decimal rounded half-up to 4 places (`rounding: 'HALF_UP_4'`). Unions are computed exactly only for rectilinear (axis-aligned) rings, by coordinate compression. A non-rectilinear union falls back to the level boundary, with `method: 'LEVEL_BOUNDARY_FALLBACK'`, and the affected checks are `NOT_EVALUATED`. **Statutory** limits are never inferred: the caller may pass declared limits (`maxCoverageRatio`, `maxFar`), which are compared as `DECLARED_LIMIT` results with `statutoryCompliance: NOT_CLAIMED`.

## 4. Checks

| Check id | Status values | Evidence |
|---|---|---|
| `SITE_POLYGON` | PASS / FAIL | Simple ring, non-zero area, orientation |
| `BUILDABLE_WITHIN_SITE` | PASS / FAIL / NOT_APPLICABLE | Ring containment |
| `LEVEL_WITHIN_PERMITTED` (per level) | PASS / FAIL / NOT_APPLICABLE | Containment in the buildable boundary, or else the site |
| `SETBACK_DISTANCE` (per setback) | PASS / FAIL / NOT_APPLICABLE | Minimum distance from the setback edge to every storey boundary vertex and edge; `measuredMm` (floor of the exact distance), `requiredMm`; comparison on squared integers |
| `SPACE_ON_PLATES` (per space) | PASS / FAIL / NOT_EVALUATED | Rectilinear: every compressed cell of the space lies in the union of the level's floor plates **and the footprints of stairs serving that level**. A stairwell sits over a slab void by design, and the stair carries it; counting plates alone produced a false failure on generated two-storey models. The unsupported area is given exactly. |
| `UPPER_PLATE_SUPPORT` (per storey above the lowest) | PASS / WARNING / NOT_EVALUATED | Exact overhang area beyond the union of plates on the storey below. `structuralAdequacy: NOT_CLAIMED`. |
| `OPENING_WITHIN_HOST` (per opening) | PASS / FAIL | `offsetMm + widthMm ≤ length(host)` via `(offset + width)² ≤ dx² + dz²`; host on the same level |
| `DECLARED_LIMIT` (per declared limit) | PASS / FAIL | Exact fraction comparison |

Report status: `FAILED` if any FAIL; else `PARTIAL` if any NOT_EVALUATED or the operation budget is exhausted; else `VERIFIED_WITH_WARNINGS` if any WARNING; else `VERIFIED`.

**Budget:** compressed-cell evaluations are capped (2 000 000 per report). Past the cap, remaining union-based checks are `NOT_EVALUATED` and the report is `PARTIAL`. Nothing is guessed.

## 5. Scoped diff

`POST …/verification/diff { otherRevisionId, scope: { levelIds[], entityIds[], allowSiteChange } }` compares the path revision (base) with another revision of the same project:
- Every entity in `levels, spaces, walls, openings, slabs, columns, stairs, dimensions, specifications` is hashed canonically per id. `site` is one entity.
- `ADDED`, `REMOVED` and `CHANGED` sets are reported per collection.
- An entity is **in scope** if its id is in `entityIds`, or its level (`levelId`, or the level itself, or a stair's `fromLevelId`/`toLevelId`) is in `levelIds`. Site changes need `allowSiteChange`.
- Status is `WITHIN_SCOPE` or `OUT_OF_SCOPE_CHANGES`, with each violation listed.

This generalizes Phase 30's preservation locks into a checkable statement for any two revisions ("only level 2 changed"), independent of the BIM diff.

## 6. API (full list in [phase34-api.md](phase34-api.md))

`ROOT = /api/projects/:projectId/revisions/:revisionId/verification`

- `GET ROOT` — report with no declared limits.
- `POST ROOT` — `{ declaredLimits?: { maxCoverageRatio?, maxFar? } }` → report (computed, not stored).
- `POST ROOT/diff` — `{ otherRevisionId, scope }` → scoped diff report.

Catalog 120 → 123 routes. The POST routes carry a body but change nothing. Like the existing `…/validate` routes, the rate limiter charges them to the `write` group (it groups by HTTP method).

## 7. Contracts (`apps/api/src/verification/contracts.ts`)

`VerificationReport`: `{ verifierVersion: 'complex-verification-v1', projectId, revisionId, modelHash, inputHash, status, bases, checks[], summary { pass, fail, warning, notEvaluated, notApplicable }, declaredLimits, budget { operations, limit, exhausted }, claims }`.

`claims`: `statutoryCompliance`, `structuralAdequacy`, `surveyAccuracy`, `constructionReadiness`, all `NOT_CLAIMED`.

## 8. Out of scope

| Item | Phase |
|---|---|
| Curved or non-rectilinear polygon unions (exact general clipping) | Later. Reported `NOT_EVALUATED`, never approximated. |
| Jurisdiction rule packs (setback, FAR or height tables by authority) | B27 knowledge packs with verified sources. Only declared limits are compared here. |
| High-rise specific checks (wind, drift, egress) | B35 |
| Persisting reports as evidence packages | B38 |
