# Phase 34 (B34) acceptance record

**Authority:** roadmap Phase 34, *Complex Building Verification* (`docs/sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md` L187–205).
**Baseline:** `phase31/development` @ `c5ebe72`, plus the `phase34/diff-integrity` repair (PR #27).
**Date:** 2026-10-15.
**Status:** **ready for the owner's closure decision. Not closed by this record.** Every criterion is listed below with its evidence. The items marked FAIL are not built. Phase 34 can close only if the owner accepts them as deferred, or they are built.

## 1. Repairs in PR #27

| # | Repair | Regression test |
|---|---|---|
| B34-1 | A document-level edit (`name`, `completeness`, …) returned `IDENTICAL`. It is now a `document` change, in scope only when the declared levels cover every level of both models | `verification.test.ts` "B34-1" |
| B34-2 | Reordering a wall's `spaceIds` was reported as a change. They are now compared as a set | "B34-2" |
| B34-3 | Violation `levelIds` were cut to two, hiding the level that broke the scope. All old and new levels are now listed (maximum 4) | "B34-3" |
| Quota | `POST …/verification` and `POST …/verification/diff` compute over whole models but were charged as ordinary writes. They are now in the `generate` rate-limit group, like the Phase 35 to 39 compute routes | `verification.integration.test.ts` "charges whole-model verification and the scoped diff to the generation quota" |

**Investigated, no change needed:**
- *Opening sill + height not checked by the verifier.* Not reachable on a stored revision: the shared model invariant already rejects an opening taller than its host wall (`packages/shared/src/building-v2/invariants.ts:89`), and only validated revisions are verified.
- *Budget charged per cell × shape rather than per edge.* The budget is charged before any computation (`geometry.ts:112`), so a returned value is always complete and exact. Only the size of the quota is approximate. A model beyond it degrades to `PARTIAL` (test below).

## 2. Criteria

| Roadmap item (L187–205) | Status | Evidence |
|---|---|---|
| Independent geometric and BIM comparison, candidate to base, for floors, walls, openings, stairs, elements and materials | **PASS** | `scopedDiff` compares every collection by canonical entity hash, plus site and document fields. Tests: "compares every collection" (openings, slabs, columns, specifications), "B34-3" (stairs), and the existing spaces, walls and site tests. Limit: a hash comparison reports *that* an entity changed, not measured geometric deltas |
| … protected identity and hash sets | **PASS (system)** | Enforced by the Phase 30 `EXACT_BYTES` and semantic locks (`revision/verify.ts`) and the Phase 35 `preservationCheck` (`engineering/regeneration.ts`), not by the B34 diff. Tests: `revision.test.ts` validator cases; `engineering-regeneration*.test.ts` |
| Semantic, visual and quantitative change reports: allowed vs actual changes, unintended mutations, dependency rechecks, stale simulations, quantity and cost impacts, evidence references | **FAIL** | Parts exist separately: B34 `changes` and `violations`; the Phase 30 comparison (`revision/contracts.ts:121-139`); B37 `changeImpact` and `freshnessImpact`. There is no single report, quantity and cost impacts are freshness labels rather than deltas, and evidence references are not linked |
| Regeneration regression suite: façade-only, finish-only, interior-only, exterior-only, blueprint-preserving; independent floor and structure locks | **PASS with limitation** | `revision.integration.test.ts` scenarios 2, 3, 4, 5 and 12 (appearance-only keeps blueprint geometry, BIM identities and hashes; lock conflicts are `BLOCKED_BY_LOCK`; interior finishes are a typed refusal); `engineering-regeneration*.test.ts` (façade-only windows; candidate verification). Interior-only is tested as a refusal only: no interior operation exists (D-12 deferred) |
| Re-evaluate engineering, MEP, fire and environmental checks after a change, or mark them stale or blocked; never a false "passed" | **PASS (marking)** | Phase 30 `INVALIDATED`, comparison `recomputed: false`; B37 tests "M4 gate: an accepted edit marks every dependent output of the base stale" and "M2/L262 … blocked". Nothing is re-evaluated automatically; outputs are marked |
| Large-model verification: reasonable quotas, chunked checks, failure without collapse | **PASS** | Quota: the test above. Budget: "a model beyond the operation budget degrades to PARTIAL with labelled fallbacks" (`verification.test.ts`). Chunking: Phase 35 partitions verify per partition exactly where the whole-model verifier falls back (`engineering-regeneration.test.ts` "verifies each partition exactly …") |
| Frontend: validate drawing primitives, dimension annotations, scale bars, layer identity, measurement precision, units, site and plot orientation | **FAIL** | Phase 38 plan sheets draw stored walls and openings exactly, in mm (`documents.test.ts`). Dimensions are not drawn (`documents/plan-sheet.ts:58-60`), and there is no scale bar, north or orientation, or layer-identity check |
| Frontend: verification evidence objects with check id, input revision, assumptions, severity, measured values and failure reason; partial or not-verified status exposed | **FAIL (partial)** | Present: `checkId`, `status` (`PASS`/`FAIL`/`WARNING`/`NOT_EVALUATED`), `entityIds`, `measured`, `required`, `detail`, `revisionId`, `modelHash`, `inputHash`, `formulas`, report-level `PARTIAL`. Missing: a `severity` field and per-check assumptions |
| Frontend: comparisons between rendering hotspots, BIM ids, blueprint layers and selected 3D objects; tests for accidental layer swaps and lost semantic mapping | **FAIL** | Scene-to-BIM mapping is validated (`scene3d.test.ts` "rejects dropped source ids, corrupted room mapping"; `revision.test.ts` "BIM element id swapped"). There is no hotspot concept, no layer-swap test, and no plan-sheet-to-3D cross-check |
| Reference-file interpretation never silently changes the canonical site boundary or floor geometry | **PASS** | `verification.integration.test.ts` "an uploaded site plan or photo never changes the canonical site or floor geometry". Phase 31 inspection tests (`references*.test.ts`) |
| **Gate:** "Only the requested façade changed" is independently provable from actual model and artifact diffs, with no hidden edits and no stale engineering results displayed as current | **PASS (system)** | Phase 30 scenarios 4, 5 and 12 (identical model arrays and BIM ids, BIM diff all `UNCHANGED`, `EXACT_BYTES` lock) and B37 stale marking. With B34-1, the B34 diff has no hidden document edits. It does not see appearance changes, which live outside the model |
| Failed independent verification is `FAILED` and keeps the revision | **PASS** | `verify.ts:126`; `specialists-verification.integration.test.ts` "is FAILED, not a review note …" (the committed revision stays current and is named) |
| Definition of Done (§K L788): staging proof of a live workflow, and a phase tag | **FAIL** | Owner-held: D-10 (staging prepared, not run) and D-11 (no tag) |

## 3. What closing Phase 34 needs from the owner

Four items are **not built**, plus the release step. None of them was waived by this record. The owner chooses, per item:
1. **Unified change report** with quantity and cost deltas and evidence references. Either build it in B34, or defer it to B38 (evidence packages) or B44.
2. **Drawing validation:** dimensions, scale bar, orientation, layer identity. Either build it, or defer it to B38 (construction documents) and B45.
3. **Evidence-object `severity` and per-check assumptions.** Small and additive: two fields on `CheckSchema`.
4. **Hotspot, layer and 3D cross-checks** with layer-swap tests. Either build them, or defer them to B45 (scene and API optimisation).
5. **Staging proof and a phase tag** (D-10, D-11).

Recorded decision: *none yet.*
