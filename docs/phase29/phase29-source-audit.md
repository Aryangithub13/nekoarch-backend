# Phase 29 source audit — advanced 3D architecture & scene engine V1

- **Baseline:** `backend-v1-phase28-complete` = `7ca99df6531cdda136e03a4236d68b6da2f5e0c6`.
- **Worktree:** `../designflow-phase29`, on branch `phase29/advanced-3d-scene-engine`, created from that tag.
- **Main tree:** still on `phase27/specialized-knowledge` (`90e5124`). It does **not** contain Phase 28 and was not touched.
- **Audit method:** read the source and run the released Phase 23 fixtures (`docs/phase23-evidence/fixtures/*.json`). Nothing below is taken from older documentation alone.

Classification legend:
- **REUSE**: call as is.
- **EXTEND**: additive change.
- **REFERENCE**: pattern to follow, not called.
- **DO_NOT_TOUCH**: released, protected.

## A. Building Model V2 (`packages/shared/src/building-v2/**`) — REUSE

| Topic | Actual implementation |
|---|---|
| Frame | `units: 'mm'`, `coordinateSystem: 'x-right-y-up-z-depth'` (literal). Plan points are `(x,z)`; Y is elevation. One building-global frame; no object-local transforms. Phase 23 IFC maps model `(x,y,z)` → IFC `(x,−z,y)`, a proper rotation (det +1). So the model frame is right-handed and maps to glTF's right-handed Y-up frame **without axis swap or mirroring**. |
| Precision | Finite integer millimetres. Coordinates ±100 000 000 mm. BigInt predicates (`cross`, `signedArea2`, `pointLocation`, `ringContains`, `isSimpleRing`). |
| Levels | `id, index, kind (storey/roof/datum), elevationMm, floorToFloorHeightMm, boundary` (plan envelope, not a slab). |
| Spaces | `boundary` ring on wall centerlines (`boundaryBasis`). Simple, may be concave. No height field. |
| Walls | Directed centerline `path {start,end}`, `thicknessMm` (nullable), `heightMm`, `baseOffsetMm`, `classification`. The cross-section is **symmetric about the centerline**; ends are **perpendicular butt planes**; **junction joins are deferred** (README). Odd thicknesses put faces on the 0.5 mm grid. |
| Openings | Door/window/generic `opening`: `wallId, offsetMm` (from path start), `widthMm, heightMm, sillMm` (above host base). Validated to fit the host and not overlap (wall-relative rectangles). |
| Plates | `slabs[]`: `kind floor / flat-roof / ceiling`, `footprint {outer, voids[]}`, `topOffsetMm` relative to level, `thicknessMm` **extends downward**. |
| Stairs | One straight, axis-aligned flight: `direction ±x/±z`, `footprint`, `widthMm, riseMm, runMm, riserHeightsMm[]` (integers, non-uniform allowed), `treadDepthMm`. Tread count = risers − 1. Up to two `landings` (footprint plus `elevationOffsetMm`); no landing thickness and no soffit/waist are modeled. |
| Columns | Polygon extrusion. |
| Relationships | `wallSpaceIds`, `openingSpaceIds`, `wallOpenings` (geometric adjacency): REUSE. |
| Measurements | `polygonAreaMm2` (exact decimal string), `wallMeasurements`: REFERENCE only. The scene validator uses its own arithmetic. |

## B. Phase 22 parametric architecture — REFERENCE

`parametric-architecture-v1` emits orthogonal rectangle, L or setback footprints with ≤ 2 levels. Measured fixtures:

| Fixture | Levels | Spaces | Walls | Openings | Slabs (voids) | Stairs |
|---|---|---|---|---|---|---|
| v1 / v2 (solver) | 1 | 6 | 19 | 6 doors + 5 windows | floor + flat roof | — |
| L | 1 (6-vertex boundary) | 5 | 18 | 5 + 4 | 2 | — |
| setback | 2 | 8 | 32 | 7 + 4 | 1 floor, 1 floor with 1 void, 8 flat-roof (1 upper + 7 exposed lower-roof rectangles) | 1 (+z, 16 risers 188/187, tread 280, 2 landings) |
| maximum-24 | 1 | 25 | 78 | 25 + 19 | 2 | — |

Walls are 100 or 200 mm thick and 2850 mm high, with base offset 0. Levels are 3000 mm floor to floor. Floor slabs are 150 mm with top at the level; roofs have top at +3000 and are 150 mm thick. All walls are axis-aligned.

## C. Phase 23 BIM / IFC (`apps/api/src/bim/**`) — REUSE, DO_NOT_TOUCH

- **Supported-profile gate:** `sourceModel()` = architectural schema parse, then a **bounded profile**:
  - ≤ 2 levels (`storey` only), ≤ 28 spaces (≤ 24 non-circulation), ≤ 200 walls, ≤ 200 openings, ≤ 32 slabs, ≤ 32 voids, ≤ 1 stair (≤ 64 risers), **no columns**;
  - orthogonal rings (≤ 32 vertices), axis-aligned walls;
  - then independent Blueprint QA with no errors.
  
  **Unchanged since Phase 23.** Phase 29 reuses this gate verbatim, so the scene supports exactly what BIM supports. No high-rise or supertall claim is made.
- `bindingFor()` recomputes `modelHash` and `parameterHash`. `readBim()` (bim-service) shows the acceptance check and the binding construction. Both are reused as the pattern.
- `projectBim()` yields deterministic element IDs `semanticId(projectId, role, sourceId)` with `source {collection, id}`. The scene **takes `bimElementId` from `projectBim` output**; it never re-derives or invents IDs.
- IFC exports extruded prisms; junctions are not boolean-unioned. The scene adopts the same butt-end convention for authoritative wall solids.

## D–G. Phases 24–27 (structural, environmental, systems, knowledge) — REFERENCE; overlays NOT_EVALUATED

- Each phase persists revision-bound analyses with explicit IDs (0014–0017).
- Structural members, environmental shading, systems routes/penetrations and knowledge findings are analysis outputs, not architecture. Systems elevator proposals are proposals.
- V1 renders **no overlay**. The manifest lists `structural`, `environmental`, `systems` and `knowledge` overlays as `NOT_EVALUATED` with reason `OVERLAY_NOT_IN_SCENE_V1`.
- Binding a specific analysis by ID is the documented extension point (design §13). No "latest" analysis is ever selected.

## H. Phase 28 optimization — REFERENCE / EXTEND (worker pool)

- Candidates are advisory (`architectureMutation: NONE`) and become revisions only through `POST …/revisions/generate`.
- Phase 29 compiles **accepted revisions only**. Candidate-scoped ephemeral scenes are designed (design §14) but not exposed.
- `optimization/pool.ts`: a fixed `worker_threads` pool with bounded queue, timeout-terminate, `resourceLimits`, graceful close and typed failures. Its only optimization couplings are the `StudySchema` parse, `OptimizationError` mapping and `OPTIMIZATION_*` codes.
  - **EXTEND:** the mechanism moves to a generic `lib/worker-pool.ts`. `OptimizationPool` becomes a configured subclass with identical public API, codes and behavior, proven by the unchanged Phase 28 pool and integration tests. The scene pool is a second configuration, so there is no duplicated infrastructure.

## I. Persistence / API / RLS — REFERENCE (0018 pattern)

- **Signed writes:** `signProjectCommit` HMAC envelope → SECURITY DEFINER `*_write`. Ownership (P1201/P1205), QA acceptance, and SQL-side binding recompute (`canonical_building` → `cost_hash` model hash; `generator_version`; `parameterHash`).
- **Idempotency:** `durableCommand` plus an idempotency op list re-declared per migration.
- **Convergence:** advisory-lock convergence on `(revision, inputHash)`; nondeterminism rejection; immutable trigger `project_private.immutable_revision`; owner-read RLS via `project_revisions` ⨝ `projects`.
- **Reads:** a read RPC with get/list/status and a `(createdAt,id)` cursor.
- `Repository.*Rpc?` optional adapters live in `lib/supabase.ts` and `test-support/pg-backend.ts`.
- **Migrations 0001–0018 are DO_NOT_TOUCH.** The next number is 0019.

## J. Frontend contracts — none in repository

`apps/` contains only `api`. There is no viewer, Three.js code or scene contract to stay compatible with. The manifest is therefore designed frontend-neutral (glTF 2.0 core only, no extensions required).

## K. 3D libraries, storage, delivery — none

- No glTF, mesh or 3D dependency in any package.
- No object storage: no Supabase Storage buckets, signed URLs or file-delivery code. Every artifact so far is JSON in Postgres.
- Binary responses exist only for IFC export (`/bim/export.ifc`, text), served from memory.
- **Decision (design §11):**
  - GLB bytes are kept in Postgres `bytea` behind a `SceneArtifactStore` adapter, measured at < 1 MiB for every supported fixture.
  - They are written atomically with the artifact row, so the row is READY only when its bytes exist and SQL verified their SHA-256.
  - A future object-store adapter keeps the same API contract.
- **Dev-only, test/verification tooling added:**
  - `gltf-validator` 2.0.0-dev.3.10: the Khronos reference validator, Apache-2.0.
  - `@gltf-transform/core` 4.5.1: an independent glTF reader, MIT.
  
  Neither ships in the runtime image.

## Blueprint QA circulation — REUSE

`auditBlueprint(model).circulation.edges` holds **independently validated** connectivity:
- `door` and `passage` edges come from floor-level traversable openings joining exactly two spaces;
- `stair` edges come from validated stair cores.

The scene navigation graph uses these edges verbatim and never infers connectivity from proximity.

## Summary of reuse decisions

| Source | Class | Use |
|---|---|---|
| `bim/core.ts` `sourceModel`, `bindingFor` | REUSE | Supported-profile gate + binding |
| `bim/project.ts` `projectBim` | REUSE | `bimElementId` per source entity |
| `services/bim-service.ts` acceptance check | REFERENCE | Scene precheck |
| `lib/generation-identity.ts` `modelHash`, `canonicalBuilding` | REUSE | Identity |
| `@designflow/boq-cost` `costHash` | REUSE | Manifest/scene/input hashes (SQL `cost_hash` parity) |
| `@designflow/blueprint-qa` circulation graph | REUSE | Navigation edges |
| `building-v2` `pointLocation`, `wallSpaceIds` | REUSE | Compiler-side room/point tests |
| `optimization/pool.ts` | EXTEND | Generic bounded worker pool |
| 0018 SQL patterns, repository/route wiring | REFERENCE | 0019, scene repository, routes |
| Migrations 0001–0018, phase evidence, Phase 23 fixtures | DO_NOT_TOUCH | Protected history |
