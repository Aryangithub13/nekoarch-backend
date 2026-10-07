# Phase 25 source audit — environmental & building simulation

Audited on the repaired Phase 24 baseline (`phase24/audit-repair`, descending from `d93aaa9` = `backend-v1-phase24-complete`). Classification per artefact: **REUSE** (call as is), **EXTEND** (add alongside, no behaviour change), **REFERENCE** (pattern to mirror), **DO_NOT_TOUCH**.

## Startup gate

| Check | Result |
|---|---|
| Phase 24 checkpoint | `backend-v1-phase24-complete` → `d93aaa9`, unchanged |
| Independent Phase 24 audit | Found 2026-10-06 (A01–A06, 3 × P1, 3 × P2); repaired and verified on `phase24/audit-repair` — `docs/phase24-audit-repair/REPAIR-REPORT.md` |
| Unresolved P0/P1 | None after the repair |
| Phase 1–24 regression | Green on frozen repaired source (repair runner) |
| Concurrent agents | The `designflow (Copy)` partial repair is superseded; nothing else writes this repository |

## Architectural source (Phase 23 BIM / building-v2)

| Concern | Finding | Class |
|---|---|---|
| Coordinate system | `x-right-y-up-z-depth`, integer mm, one building-global frame; plan is `(x, z)`, `y` is elevation. Right-handed: viewed from +Y, +X is right and +Z is down-screen (IFC export maps `z → −Y`). | REUSE |
| Spaces | `boundary` ring, `boundaryBasis` (`wall-centerline` in every native fixture), `levelId`; no height of their own. | REUSE |
| Levels | `elevationMm`, nullable `floorToFloorHeightMm` (3000 in all fixtures). | REUSE |
| Walls | Centerline `path`, `thicknessMm`, `heightMm` (2850 in fixtures: the 150 mm plate closes the gap to the 3000 storey), `baseOffsetMm`, `classification`, optional `spaceIds`. `wallSpaceIds()` (shared) gives geometric adjacency, used by BIM `bounds` relationships. | REUSE |
| Openings | Doors, windows, generic openings hosted by `wallId` with `offsetMm`, `widthMm`, `heightMm`, `sillMm`; orientation follows the host. Windows exist on exterior walls in every native fixture. | REUSE |
| Plates | `floor`, `flat-roof`, `ceiling` slabs with `footprint` (outer + voids), `topOffsetMm`, `thicknessMm` downward. Native fixtures carry a top `roof` plate and, for the setback/edited families, explicit `roof-exposed-*` plates over the lower storey. Upper floor plates are contained by the lower footprint (parametric generator forbids cantilevers). | REUSE |
| Roofs | Only flat roofs exist (`flat-roof` plates → BIM kind `roof`). No pitched roofs. | REUSE |
| Site / location | `site.boundary`, nullable `northMilliDegrees`, optional `referenceOrigin` (a named aligned datum, **not** a geospatial CRS). No latitude, longitude, time zone or elevation anywhere. | REFERENCE |
| North convention | **Conflict found.** `packages/shared/src/building-v2/README.md` says `northMilliDegrees` "measures from +Z toward +X"; the executable, tested `cardinalForSide` (`packages/generator/src/solver-v2/evaluate.ts:11`) says "North=0 points to world −z; positive angle rotates clockwise toward +x". They agree at 90°/270° and are mirror images at 0°/180° — a north/south inversion. Phase 25 therefore does not read site north as authoritative: orientation is an explicit environmental input with a self-describing convention literal (the one `cardinalForSide` implements), and the site value is only reported for comparison. The conflict is a pre-existing documentation defect outside Phase 25 scope. | REFERENCE / flagged |
| Materials | BIM materials are architectural labels (`specified`/`unspecified`); `specifications` carry names and references, no physics. They must not imply thermal properties. | DO_NOT_TOUCH (semantics) |
| Quantities | `calculateQuantityTakeoff` gives wall face areas with openings deducted (butt-ended prisms, centerline). The environmental validator recomputes areas itself. | REFERENCE |
| BIM projection | `projectBim(model, binding)` — bounded, validated, deterministic; the environmental builder consumes its `geometry` and `binding` exactly as structural does. `bim-semantic-v1` is not extended. | REUSE |
| IFC4 export | `nekoarch-ifc4-architectural-v1` profile; environmental data stays backend-native. | DO_NOT_TOUCH |

## Phase 24 (structural)

Structural materials (E, ν, density) are mechanical properties and are never reused as thermal properties. Patterns reused: version literals participating in the input hash, explicit-input-only engineering values with provenance, solver-neutral adapter + untrusted-output validation, independent validator that imports nothing from the builder, snapshot claims block, typed domain errors mapped to 422. Structural source is **DO_NOT_TOUCH**.

## Identity, persistence and API

| Artefact | Finding | Class |
|---|---|---|
| Binding | `BimBindingSchema` (projectId, revisionId, modelHash, generatorVersion, generationId, requirementsHash, parameterHash); structural extends it with versions. | REUSE / EXTEND |
| `digest()` | Canonical-JSON SHA-256 (`bim/core.ts`). | REUSE |
| Immutable artefact table | `0014_structural_analyses.sql`: owner-only RLS select, immutable trigger, signed `security definer` write RPC that recomputes the binding from stored architecture, advisory-lock convergence on `(revision, input_hash)`, idempotency receipts, read RPC with get/list/status. | REFERENCE (new `0015`) |
| Signing | `signProjectCommit(secret, userId, operation, input, context)`. | REUSE |
| Idempotency | `durableCommand`; the idempotency `operation` check constraint must list the new route. | REUSE / EXTEND |
| Quotas | `lib/http-protection.ts` groups POST compute routes into `generate`; GETs fall in `read`. | EXTEND |
| Repository | `Repository.structuralRpc` optional method, implemented by `lib/supabase.ts` and `test-support/pg-backend.ts`. | EXTEND (`environmentalRpc`) |
| Routes | `/api/projects/:projectId/revisions/:revisionId/structural/{validate,analyses,analyses/:id,status}`; `bounded()` preflight for size/depth/nodes. | REFERENCE |
| Error envelope | `ApiError(status, code, message)`; redacted 500s. | REUSE |
| Migrations | `0001`–`0014` released. | DO_NOT_TOUCH |

## Runtime, tests, security

- Docker: two-stage `node:22-bookworm-slim`, non-root, compiles `apps/api/src` wholesale (new modules ship automatically), dev dependencies pruned. Node 22 ships full ICU, so IANA time zones via `Intl` work offline. — REUSE
- Tests: vitest unit, embedded PostgreSQL integration (`startTestDatabase`, real RLS roles), live local Supabase suite (`apps/api/tests/supabase.live.test.ts` + shared `*Acceptance` helpers), pgTAP `supabase/tests/rls.sql` (asserts the exact public-table count, currently 17). — EXTEND
- External data / network: no Phase 21 fetcher is needed — weather is accepted as a bounded, checksummed inline dataset; Phase 25 performs no network I/O, spawns no processes and writes no files. — DO_NOT_TOUCH
- LLM boundary: environmental modules must not import `ai/` or `workflows/` (same grep gate as Phase 24).

## Gaps Phase 25 must handle explicitly

1. No geographic location or time zone in the architecture → explicit input; absent ⇒ solar analysis `NOT_EVALUATED`.
2. North ambiguity (above) → explicit orientation input with a convention literal.
3. No thermal/optical properties anywhere → explicit constructions with provenance; absent ⇒ surface property `NOT_SPECIFIED`, thermal `PARTIAL`/`INPUT_INCOMPLETE`.
4. No weather → optional explicit dataset; synthetic flag mandatory.
5. Wall surfaces are centerline, zero-thickness; slab-edge strips between wall top and storey top are not envelope surfaces (documented limitation).
