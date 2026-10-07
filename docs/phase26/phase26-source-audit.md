# Phase 26 source audit — building systems coordination

Baseline: `ec77974` (`backend-v1-phase25-complete`), branch `phase26/building-systems`. The working tree was clean at the start.

The master prompt names this file `docs/phase26/source-audit.md` in §4 and `phase26-source-audit.md` in §99. The §99 name is used, matching Phases 24 and 25.

Each source is classified as one of:

- **REUSE**: imported unchanged.
- **EXTEND**: a backward-compatible addition is needed.
- **REFERENCE**: a pattern to mirror, not imported.
- **DO_NOT_TOUCH**: preserved and only read.

Every finding below comes from reading the code. The geometry facts come from a survey script run over the fixtures v1, v2, L, setback and authored, and over a two-storey variant with bathrooms on both levels.

## A. Phase 23 BIM (`apps/api/src/bim`)

| Item | Finding | Class |
|---|---|---|
| Source profile | `sourceModel` admits at most 2 storeys, ≤ 28 spaces, ≤ 200 walls/openings, ≤ 32 slabs, **at most 1 stair and no columns**. Geometry must be orthogonal: axis-aligned walls and orthogonal space, level and slab rings. Independent Blueprint QA must pass. | REUSE (via `readBim`) |
| Spaces | `id`, `classification` (free label; the generator emits `circulation`, `stairwell`, `bedroom`, `bathroom`, `kitchen`, `living`, …), `levelId`, `boundary` ring on the wall centerline (`boundaryBasis`), optional `occupancy`. Generated fixtures carry no occupancy. | REUSE |
| Walls | Centerline segment, `thicknessMm` (100/200), `heightMm` (2850 on 3000 mm storeys), `baseOffsetMm`, `classification` (exterior/interior/partition). Adjacency comes from `wallSpaceIds` (exact integer predicates). | REUSE |
| Openings | Hosted `door` / `window` / `opening` (`purpose` passage/service/other), with `offsetMm`, `widthMm`, `heightMm` and `sillMm` along the host wall. Doors have no clear-width property separate from the opening width. | REUSE |
| Slabs | `floor` / `flat-roof` / `ceiling` plates with an orthogonal outer ring and voids. **The only voids in generated models are stair openings**, which coincide exactly with the stair flight (`serves_void`). | REUSE |
| Stairs | One straight flight per model: `fromLevelId`/`toLevelId`, footprint, direction, width, rise/run, and bottom and top landings. Stairwell spaces enclose flight and landings on both levels. | REUSE |
| Levels | `elevationMm`, `floorToFloorHeightMm`, plan `boundary`. | REUSE |
| Site | `primaryEntryOpeningId` (v2, L and setback name their exterior door; v1 and authored do not), `northMilliDegrees`, `accessSide`. | REUSE (explicit exit semantic) |
| Coordinates | Integer mm, `x-right-y-up-z-depth`, building frame shared by every entity. | REUSE |
| Semantic IDs | `semanticId(projectId, role, sourceId)` → `bim-<40 hex>`; deterministic. | REUSE |
| BIM binding | `BimBindingSchema` (projectId, revisionId, modelHash, generatorVersion, generationId, requirementsHash, parameterHash) with `bimVersion = bim-semantic-v1`. | REUSE |
| IFC mapping | `exportIfc` covers the architectural profile only. Phase 26 adds nothing to IFC (§88). | DO_NOT_TOUCH |
| Geometry predicates | `pointLocation`, `segmentInRing`, `ringsOverlap`, `ringContains`, `onSegment` (exact BigInt predicates) in `@designflow/shared`. | REUSE |

**Absent from the architecture:**

- No service shaft, riser, plenum, ceiling-void depth or service zone.
- No elevator or lift entity, and no MEP fixture, equipment, panel or terminal.
- No designated fire exit other than `site.primaryEntryOpeningId`.
- No door clear width separate from the opening width, and no occupant load on generated spaces.

Consequences for Phase 26:

- Every engineering terminal, elevation and service band is explicit input.
- Elevators are derived **proposals**.
- Exits are explicit designations or the site's primary entry. Generated `occupancy` is not used, and occupant load is `NOT_EVALUATED`.

There is no existing shaft to reuse (§43). Only stair voids exist, and a stair void is not a lift shaft.

## B. Phase 24 structural (`apps/api/src/structural`)

| Item | Finding | Class |
|---|---|---|
| Members | `COLUMN` from a wall end, running from `level.elevationMm` to the storey top. `BEAM` along a wall, with its axis at the storey top (`ANALYTICAL_BEAM_LEVEL_AT_STOREY_TOP`). Node coordinates are integer mm. | consumed read-only |
| Sections | `RECTANGLE` width/depth (mm), or `GENERIC` (area and inertias, **no dimensions**). Local-axis orientation is `REFERENCE_VECTOR_V1`. | consumed read-only |
| Slabs / panels / foundations | Not modelled (`SLABS_AND_WALL_PANELS_NOT_MODELLED`). Architectural BIM columns are rejected by the BIM profile. | — |
| Snapshot identity | `project_revision_structural_analyses` row: `id`, `input_hash`, `structural_model_version = structural-model-v1`, snapshot `binding` equal to the BIM binding. | REUSE (explicit id + input hash binding) |
| Clash geometry | An axis segment plus section dimensions. Physical placement relative to the analytical axis is not stated. Phase 26 therefore uses a **conservative envelope**: half-size = max(width, depth)/2 in every transverse direction. A `GENERIC` section cannot be placed, so clashes against it are `NOT_EVALUATED` and flagged for review. | new consumer |

Phase 26 reads a structural snapshot only by explicit `structuralAnalysisId`. It must belong to the same revision; the database scopes the read and recomputes the binding. Phase 24 source is not changed.

## C. Phase 25 environmental (`apps/api/src/environmental`)

| Item | Finding | Class |
|---|---|---|
| Zones / surfaces | One zone per space; envelope surfaces with steady-state transmission heat flow `Q = U·A·ΔT`. | consumed read-only |
| Binding / currency | Same binding pattern; `CURRENT`/`STALE` derived from `projects.current_revision_id`; `require=current` → 409. | REFERENCE |
| Input/output pattern | Explicit input → model → independent model validation → resolved, budgeted analysis input → adapter → untrusted-output validation → independent result validation → signed write. | REFERENCE (mirrored) |
| Adapter | `EnvironmentalCalculatorAdapter { metadata, analyze }`. | REFERENCE |
| Validator independence | Gate: `validate.ts` imports none of `model`, `solar`, `shading`, `analysis`. | REFERENCE (same gate for systems) |
| Persistence | `0015`: immutable owner-only table, signed security-definer write with in-SQL binding recomputation, advisory-lock convergence, idempotency receipts, read/list/status RPC. | REFERENCE (`0016` mirrors it) |
| Handoff | Thermal results are envelope transmission only: no gains, infiltration, ventilation, mass or HVAC. Phase 26 may expose them only as `ENVELOPE_TRANSMISSION_COMPONENT` reference values, never as a design load. | consumed read-only |

## D. Building Model V2 (`packages/shared/src/building-v2`)

| Question | Answer |
|---|---|
| Stair representation | Straight flight with integer riser heights and landings at the source/destination elevation. One stair in the BIM profile. |
| Voids | Slab voids only. Generated models contain stair voids exactly equal to the flight footprint. |
| Rooms/spaces | Non-overlapping orthogonal rings per level on the wall-centerline basis. Corridors are non-convex (6–8 vertex L/U rings). |
| Level heights | `floorToFloorHeightMm` = 3000 in all fixtures. Walls are 2850 mm, and floor plates are 150 mm thick with top offset 0, so wall tops meet the slab above: **there is no free ceiling void between wall top and slab**. |
| Wall/opening geometry | Exact integer predicates; openings hosted by offset along the wall. |
| Shafts/service zones | **None.** |
| Elevators | **None.** |
| Columns | Present in the schema but empty in every fixture, and rejected by the BIM profile. |

## E. Downstream systems

| System | Finding | Class |
|---|---|---|
| Quantity takeoff / construction / BOQ cost (Phases 13–15) | Architectural quantities only, with no MEP items. Phase 26 quantities stay inside the systems snapshot, and MEP costing is `NOT_EVALUATED`. No Phase 13–15 report changes. | DO_NOT_TOUCH |
| BIM / IFC | Unchanged; systems stay backend-native. | DO_NOT_TOUCH |
| Blueprint QA circulation | A same-level door graph with entry reachability. Phase 26 **does not reuse** its PASS/FAIL and builds its own egress graph with stairs and lengths (§33). | REFERENCE |
| Generator | Not changed. Phase 26 does not generate or rewrite architecture. | DO_NOT_TOUCH |
| Frontend / browser contracts | `packages/shared/src/api.ts` carries plan and estimate DTOs only; engineering DTOs live in `apps/api`. The separate frontend workspace is not modified. | DO_NOT_TOUCH |
| AI / workflows | No engineering module may import `ai/` or `workflows/` (gate). | DO_NOT_TOUCH |
| HTTP / quota / telemetry | `lib/http-protection.ts` quota classes, the `lib/sentry.ts` route allowlist, and `durableCommand` idempotency. | EXTEND (route registration only) |
| Persistence | Migrations `0001`–`0015` released; new work is `0016` only. | DO_NOT_TOUCH / new `0016` |

## Fixture survey (generated geometry)

| Fixture | Levels | Spaces (circulation/stairwell) | Exterior doors | Site entry | Stair |
|---|---|---|---|---|---|
| v1 | 1 | 6 (1) | 1 | — | — |
| v2 | 1 | 6 (1) | 1 | `opening-5` | — |
| L | 1 | 5 (1) | 1 | named | — |
| setback | 2 | 8 (2 + 2) | 1 | named | 1 (+z, 1000 mm wide, rise 3000) |
| authored | 1 | 2 | 1 | — | — |
| two-storey wet (survey) | 2 | 9, bathroom on each level | 1 | named | 1 |

## Design consequences

1. **Inputs.** Every MEP terminal, panel, equipment item, routing elevation, drainage band, slope, clearance and airflow is explicit input with provenance. A terminal without a location makes its discipline `INPUT_INCOMPLETE`.
2. **Exits and occupancy.** Exits come from explicit opening designations, or from the site's primary entry when the request asks for it. They are never inferred from exterior doors or windows. Occupant load is never inferred.
3. **Elevators** are derived proposals. Architecture is never mutated; space consumed by a proposed shaft is reported as a required architectural modification.
4. **Structure.** Structural obstacles come only from an explicitly bound Phase 24 analysis. Without one, structural clearance is `NOT_EVALUATED`.
5. **Walls and service bands.** Every service crossing a wall within the wall's height produces an explicit penetration proposal, because wall tops meet the slab above. Slab penetrations by vertical runs are proposals too.
