# Phase 34 (B34) acceptance record

**Authority:** roadmap Phase 34, *Complex Building Verification* (`docs/sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md` L187–205).
**Baseline:** `phase31/development` @ `4713218` (includes B39 S3 Interior and whole-model U2), plus the `phase34/diff-integrity` repair (PR #27).
**Date:** 2026-10-15.
**Status:** **ready for the owner's closure decision. Not closed by this record.** The closure record ([`phase34-closure.md`](phase34-closure.md)) separates the completed repair work from the deferred capabilities and lists the steps to close.

## 1. Repairs in PR #27

| # | Repair | Regression test |
|---|---|---|
| B34-1 | A document-level edit (`name`, `completeness`, …) returned `IDENTICAL`. It is now a `document` change, in scope only when the declared levels cover every level of both models | `verification.test.ts` "B34-1" |
| B34-2 | Reordering a wall's `spaceIds` was reported as a change. They are now compared as a set | "B34-2" |
| B34-3 | Violation `levelIds` were cut to two, hiding the level that broke the scope. All old and new levels are now listed (maximum 4) | "B34-3" |
| Quota | `POST …/verification` and `POST …/verification/diff` compute over whole models but were charged as ordinary writes. They are now in the `generate` rate-limit group, like the Phase 35 to 39 compute routes | `verification.integration.test.ts` "charges whole-model verification and the scoped diff to the generation quota" |
| Evidence | Each check now carries a `severity` and the `assumptions` it rests on (additive fields). The severity is derived from the check's own status only: `FAIL` → `BLOCKING`, `WARNING` → `REVIEW`, `NOT_EVALUATED` → `UNVERIFIED`, otherwise `NONE`. The assumptions are the documented limitations of that check | `verification.test.ts` "every check is an evidence object" |

**Investigated, no change needed:**
- *Opening sill + height not checked by the verifier.* Not reachable on a stored revision: the shared model invariant already rejects an opening taller than its host wall (`packages/shared/src/building-v2/invariants.ts:89`), and only validated revisions are verified.
- *Budget charged per cell × shape rather than per edge.* The budget is charged before any computation (`geometry.ts:112`), so a returned value is always complete and exact. Only the size of the quota is approximate. A model beyond it degrades to `PARTIAL` (test below).

## 2. Acceptance matrix

**Status labels:**
- **PASS (direct):** proven by B34 code and B34 tests (`verification*.test.ts`).
- **PASS (inherited):** met by another phase's shipped capability, with that phase's tests. B34 relies on it and does not reimplement it.
- **FAIL:** not built.
- **NOT VERIFIED:** not exercised in this pass.


| # | Roadmap item (L187–205) | Status | Evidence | Demo impact |
|---|---|---|---|---|
| 1 | The three reproduced scoped-diff defects | **PASS (direct)** | "B34-1/2/3" tests. Each failed before its fix, and reverting each fix fails exactly its test | None |
| 2 | Independent geometric and BIM comparison, candidate to base, for floors, walls, openings, stairs, elements and materials | **PASS (direct)** | `scopedDiff` compares every collection by canonical entity hash, plus site and document fields. Tests: "compares every collection" (openings, slabs, columns, specifications), "B34-3" (stairs), and the existing spaces, walls and site tests | The diff says *which* entities changed, not *by how much* (no measured geometric deltas) |
| 3 | … protected identity and hash sets | **PASS (inherited: Phase 30, 35)** | Phase 30 `EXACT_BYTES` and semantic locks (`revision/verify.ts`): `revision.test.ts` "BIM element id swapped on a target", "the worker job refuses an apply pass that touches a protected object", "excludes locked storeys…". Phase 35 `preservationCheck` (`engineering/regeneration.ts`): `engineering-regeneration.test.ts` "copies the template storey layout … keeps everything else identical", "regenerates an undeclared section, preserving the storeys below and above it" | Show locks through the Phase 30 comparison, not the B34 diff |
| 4 | Semantic, visual and quantitative change reports: allowed vs actual changes, unintended mutations, dependency rechecks, stale simulations, quantity and cost impacts, evidence references | **FAIL** (deferred) | The parts exist separately: B34 `changes` and `violations`; the Phase 30 comparison (`revision/contracts.ts:121-139`); B37 `changeImpact` and `freshnessImpact`. There is no single report, quantity and cost impacts are freshness labels, and evidence references are not linked | Show the three views side by side. Quantity and cost appear as "stale, regenerate", never as a delta |
| 5 | Regeneration regression suite: façade-only, finish-only, interior-only, exterior-only, blueprint-preserving; independent floor and structure locks | **PASS (inherited: Phase 30, 35, B39 S3)** | `revision.integration.test.ts` scenarios 2, 4, 5 and 12; `interior.integration.test.ts` "scenario 33: a design-only finish change … keeps exterior, structure and room geometry identical"; `engineering-regeneration*.test.ts` | None. The cases are spread across suites rather than collected in one B34 suite |
| 6 | Re-evaluate engineering, MEP, fire and environmental checks after a change, or mark them stale or blocked; never a false "passed" | **PASS (inherited: Phase 30, B37; marking only)** | Phase 30 `INVALIDATED` and comparison `recomputed: false`; B37 "M4 gate: an accepted edit marks every dependent output of the base stale", "M2/L262 … blocked"; whole-model U2 keeps outputs current only for an identical model | Engineering results are marked stale; they are not re-run automatically |
| 7 | Large-model verification: reasonable quotas, chunked checks, failure without collapse | **PASS (direct; chunking inherited from Phase 35)** | The quota test (§1); "a model beyond the operation budget degrades to PARTIAL with labelled fallbacks" (`NOT_EVALUATED` → `UNVERIFIED`); Phase 35 partitions verify per partition (`engineering-regeneration.test.ts` "verifies each partition exactly …") | Very large models show `PARTIAL` with unverified checks named, never `VERIFIED` |
| 8 | Frontend: validate drawing primitives, dimension annotations, scale bars, layer identity, measurement precision, units, site and plot orientation | **FAIL** (deferred) | Phase 38 plan sheets draw stored walls and openings exactly, in mm (`documents.test.ts`). Dimensions are not drawn (`documents/plan-sheet.ts:58-60`), and there is no scale bar, north or orientation, or layer-identity check | Do not present drawings as dimension-validated or to scale |
| 9 | Frontend: verification evidence objects with check id, input revision, assumptions, severity, independently measured values and failure reason; partial or not-verified status exposed | **PASS (direct)** | `CheckSchema`: `checkId`, `status`, `severity`, `entityIds`, `measured`, `required`, `detail`, `assumptions`; report: `revisionId`, `modelHash`, `inputHash`, `formulas`, `budget`, `PARTIAL`. Test "every check is an evidence object" | None |
| 10 | Frontend: comparisons between rendering hotspots, BIM ids, blueprint layers and selected 3D objects; tests for accidental layer swaps and lost semantic mapping | **FAIL** (deferred) | Scene-to-BIM mapping is validated (`scene3d.test.ts` "rejects dropped source ids, corrupted room mapping…"; `revision.test.ts` "BIM element id swapped on a target"). There is no hotspot concept, no layer-swap test, and no plan-sheet-to-3D cross-check | Don't demo hotspot or layer cross-selection; selecting a 3D object resolves to its BIM and source ids |
| 11 | Reference-file interpretation never silently changes the canonical site boundary or floor geometry | **PASS (direct)** | "an uploaded site plan or photo never changes the canonical site or floor geometry" (`verification.integration.test.ts`); Phase 31 inspection tests | None |
| 12 | **Gate:** "Only the requested façade changed" is independently provable from actual model and artifact diffs, with no hidden edits and no stale engineering results displayed as current | **PASS (inherited: Phase 30, B37)** | Phase 30 `revision.integration.test.ts` "Scenarios 4/5/12: appearance-only revisions keep blueprint geometry, BIM identities…"; B37 "M4 gate…". B34's contribution is direct but partial: B34-1 removes hidden document edits from the diff | Prove the façade gate with the Phase 30 comparison; the B34 diff does not see appearance changes (they live outside the model) |
| 13 | Failed independent verification is `FAILED` and keeps the revision | **PASS (direct)** | `verify.ts:126`. `verification.integration.test.ts` "verifies a stored revision…" gets `FAILED` for a failed declared limit, and the report schema requires `revisionId` and `modelHash`. Through the specialist route (inherited, B39): `specialists-verification.integration.test.ts` "is FAILED, not a review note …" keeps the committed revision current | None |
| 14 | Live real-JWT Supabase run of the B34 routes | **NOT VERIFIED** | Covered only by embedded-PostgreSQL integration tests in this pass. The B34 report §F already recorded that the live stack was not exercised | None for a local demo |
| 15 | Definition of Done (§K L788): staging proof of a live workflow, and a phase tag | **FAIL** (owner-held) | D-10 (staging prepared, not run) and D-11 (no tag) | The demo runs on a development stack, not a staging-proven one |

**Totals:**
- **10 PASS:** 6 direct (rows 1, 2, 7, 9, 11, 13) and 4 inherited (rows 3, 5, 6, 12).
- **4 FAIL:** three deferred capabilities (rows 4, 8, 10) and the owner-held staging and tag (row 15).
- **1 NOT VERIFIED:** row 14.

**B34 is not accepted or closed.**
