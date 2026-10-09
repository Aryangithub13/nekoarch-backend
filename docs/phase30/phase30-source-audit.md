# Phase 30 source audit — selective revision & regeneration

## Baseline (verified 2026-10-09)

| Item | Value |
|---|---|
| Phase 29 release | `backend-v1-phase29-complete` → `c7e4bc0` |
| Modernization | `backend-v1-modernization-phases-1-29` → `7ce84fc` |
| Modernization follow-ups | `backend-v1-modernization-phases-1-29-followups` → `a8a0861` |
| Newest commit holding code and evidence | `bb17949` (evidence-only commit on top of `a8a0861`; `c7e4bc0` is an ancestor) |
| Phase 30 branch / worktree | `phase30/selective-revision` from `bb17949`, worktree `designflow-phase30` |
| Default worktree | `designflow` sits on `phase27/specialized-knowledge` (`90e5124`). It does **not** contain Phases 28/29 and was not used. |
| Latest migration | `0019_scene_artifacts.sql` |
| Baseline `npm run check` at `bb17949` | exit 0: 75 files / 2 568 tests + 133 + 52 ([evidence](evidence/baseline-check.txt)) |

## What already exists and is reused

| Need | Existing source | Reuse decision |
|---|---|---|
| Immutable accepted revisions, compare-and-swap (CAS) base check, QA gating, audit | `project_write('revision')` (0006 + 0011): signed envelope; `baseRevisionId == current` (P1202); QA PASS required; inserts revision, QA run, current pointer and audit event | Approval **calls `project_write` inside one SQL function** (the same pattern as `workflow_write`). No revision logic is duplicated. |
| Revision identity constraint | `valid_generation_identity`: generated ⇒ fresh generationId, requirementsHash, seed = model provenance seed; supplied ⇒ null requirements | An appearance revision keeps its base's source mode and native requirements (fresh generationId), so conversational edits keep working after an appearance edit. |
| Deterministic scene + independent validator | `scene3d/compile.ts`, `validate.ts`, `job.ts` (`runSceneJob`) | Phase 30 compiles the **unchanged** Phase 29 base scene, then applies a material-only pass. The Phase 29 validator still validates the base. |
| Scene persistence | `project_revision_scene_artifacts`: CHECK constraints pin `scene-compiler-v1`, `VISUAL_PLACEHOLDER`-only materials, and inputHash = f(compiler, manifest, source) | **Not modified.** Appearance artifacts get their own table; Phase 29 rows, constraints and API stay as verified. |
| Bounded execution | `lib/worker-pool.ts` (size, queue, timeout, heap cap) | A new small `AppearancePool` with its own worker entry; no durable job system (Phase 32). |
| Element identity | Scene `sceneObjectId = role:sourceEntityId`, `bimElementId` from the Phase 23 projection; BIM diff (geometry vs property) | Scopes use canonical model ids plus BIM ids; preservation is proven on scene objects and model hashes. |
| Idempotency | `durableCommand` + SQL receipts (`idempotency_records`) | Same pattern for preflight, execute and approve. |
| NL understanding | Phase 18 interpreter / Phase 20 conversation: finite deterministic grammar, typed read-only tools | A bounded deterministic revision grammar, plus a read-only `PLAN_REVISION` conversation tool. The AI provider capability set is unchanged (no paid calls). |
| Capability truth, overview, OpenAPI | Modernization `overview-service.ts`, `test-support/openapi.ts`, route catalog | Extended additively. |

## Gaps that Phase 30 must fill (confirmed in source)

1. **No candidate state.** Every persisted revision is QA-accepted and immediately current.
2. **No appearance input.** `SceneInputSchema` is strictly `{}`; materials are a fixed placeholder table; there are no finish fields in Building Model V2 that are not architectural facts. `specifications[].material` is an architectural fact used by calculations, so it must not carry visual-only edits.
3. **No preservation-lock model** and no revision-operation contracts.
4. **No audit trail** for operations. `project_audit_events.event_type` is pinned to three values; it is left untouched and a separate event table is added.
5. **Interior finishes cannot be represented** per room: interior wall solids are single meshes shared by two rooms, with no face-level materials. Interior finish operations are therefore a typed refusal in V1.
6. **Orientation:** `site.northMilliDegrees` may be null, meaning unknown. The convention is `NORTH_FROM_MINUS_Z_CLOCKWISE_TO_PLUS_X` (`environmental/solar.ts`). Façade-specific (N/E/S/W) targeting is only offered when north is a known multiple of 90°.

## Compatibility constraints

- Phase 29 scene routes, SQL, hashes, the 304 behaviour and `CURRENT`/`STALE` semantics are unchanged; the accepted scene for an appearance revision still compiles the same placeholder geometry scene. The appearance scene is a separate, explicitly labelled artifact.
- Migrations 0001–0019 are untouched; Phase 30 adds `0020`.
- The scope stays within the Phase 23 bounded profile (≤ 2 storeys, orthogonal geometry, one straight stair, no columns).
