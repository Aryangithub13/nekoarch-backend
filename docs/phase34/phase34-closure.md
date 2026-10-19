# Phase 34 (B34) closure record

**Date:** 2026-10-15.
**Pull request:** #27 (`phase34/diff-integrity` → `phase31/development`).
**Acceptance matrix:** [`phase34-acceptance.md`](phase34-acceptance.md).
**State:** repair complete. **B34 is not accepted or closed.** Closure is pending the steps in §4 (the owner's decisions are recorded in §6) and the gates in §5. Nothing here merges, tags, migrates or touches a hosted system.

## 1. Completed repair work

| Area | What changed | Evidence |
|---|---|---|
| Scoped diff, B34-1 | Document-level edits are no longer hidden. They are a `document` change, in scope only for a whole-model scope | Reproduced (`IDENTICAL` before the fix), regression test, revert check |
| Scoped diff, B34-2 | A wall's `spaceIds` are compared as a set, so a reorder alone is no longer an out-of-scope change | Reproduced, regression test, revert check |
| Scoped diff, B34-3 | A violation lists every old and new level (maximum 4), so the level that broke the scope is shown | Reproduced, regression test, revert check |
| B37 manifest | Its diff excludes the `document` entry (already reported as `MODEL_CHANGED_OUTSIDE_DIFF_COLLECTIONS`) and accepts 4 levels. Output is otherwise unchanged | `project-manifest.test.ts`; removing the filter is caught |
| Quotas | Whole-model verification and the diff are charged to the `generate` rate-limit group | Integration test; removing the routes is caught |
| Evidence objects | `severity` (from the check's status) and `assumptions` (its documented limitations) on every check | Unit test; a fixed severity is caught |
| Coverage | Diff over openings, slabs, columns and specifications; budget exhaustion degrades to `PARTIAL`; a reference upload never changes the model | Unit and integration tests |

**Investigated, not changed:**
- Opening height is already enforced by the model invariant.
- The budget is charged up front, so returned values are exact.

**Compatibility:**
- Response changes are additive: a `document` collection value, `levelIds` maximum 4, and `severity` and `assumptions` on checks. OpenAPI was regenerated.
- No request, route, migration or B39 behaviour changed.

## 2. Deferred engineering capabilities (not built; FAIL in the matrix)

| Capability (roadmap Phase 34) | Why not in this repair | Proposed owner phase (owner decides) |
|---|---|---|
| Unified semantic, visual and quantitative change report with quantity and cost deltas and linked evidence | A new cross-module report: it must compose B34, Phase 30, B37 and the cost engine, and compute deltas rather than freshness labels | B38 (evidence packages) or B44 |
| Drawing validation: dimensions, scale bar, north and orientation, layer identity, measurement precision | Plan sheets do not draw dimensions or a scale bar yet. This needs B38 document work first | B38 (construction documents), then B45 |
| Hotspot ↔ BIM ↔ layer ↔ 3D cross-checks with layer-swap tests | No hotspot concept exists in the scene contract | B45 (scene and API optimisation) |
| Staging proof of a live workflow and a phase tag | Owner-held release gates | D-10, D-11 |

Not verified in this pass: a live real-JWT Supabase run of the B34 routes. They are covered by embedded-PostgreSQL tests only.

## 3. Remaining limitations and demo impact

| Limitation | Demo impact |
|---|---|
| The diff is a canonical-hash comparison: it reports *which* entities changed, not measured deltas | Show the changed and violating entities; do not present geometric deltas |
| No unified change report; quantity and cost impacts are freshness labels | Show the B34 diff, the Phase 30 comparison and the B37 `changeImpact` side by side; cost reads "stale, regenerate", never a delta |
| Appearance changes live outside the model, so the B34 diff does not see them | Prove the façade gate with the Phase 30 comparison and locks (inherited), not the B34 diff |
| Drawings are not dimension-validated (no dimensions, scale bar or orientation) | Do not present plan sheets as to-scale or dimension-checked |
| No hotspot or layer cross-checks | Selecting a 3D object resolves to its BIM and source ids; do not demo hotspot or layer cross-selection |
| Engineering results are marked stale after a change, not re-run | Show the stale or blocked state honestly; re-run explicitly if needed |
| Very large models exceed the operation budget | They report `PARTIAL` with `UNVERIFIED` checks named, never `VERIFIED` |
| Live Supabase run not verified; no staging proof or tag | Demo on the local or development stack only |

**Inherited, not B34's own:** protected hash sets and locks (Phase 30, 35), the five-type regression coverage (Phase 30, 35, B39 S3), stale marking (Phase 30, B37) and the façade gate (Phase 30, B37). See the matrix labels.

## 4. Steps to close B34

1. The owner reviews and merges PR #27 once CI is green on its final head.
2. For each deferred capability in §2, the owner records "deferred to <phase>" or "build in B34". The decision is recorded in this file (§6).
3. Optional: run the local disposable Supabase acceptance (`scripts/test-local-supabase.mjs`, localhost only) to turn row 14 from NOT VERIFIED into PASS. *Done 2026-10-19 (audit B repair session, PR #35): row 14 is PASS on a local stack; staging is still D-10.*
4. Staging and the phase tag follow D-10 and D-11 when the owner authorises them.

## 5. Outstanding gates

- **D-10:** staging proof of a live workflow (prepared, not run).
- **D-11:** phase tag (none).
- ~~**Optional:** local disposable Supabase run of the B34 routes (matrix row 14).~~ Done 2026-10-19 (row 14 PASS, local only).

## 6. Owner decisions

*None recorded yet.*
