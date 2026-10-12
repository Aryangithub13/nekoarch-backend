# Phase 35.1 design: release remediation for B35 (supertall engineering and verification)

## 1. Purpose

B35.1 closes the release gaps found by the B35 release audit (`docs/audit/B35-release-audit-2026-10-12.md` on `main`, commit `cbe5c1e`). It does three things:

1. It makes the backend state its real limits for tall and large buildings, where clients look for them.
2. It adds the parts of the missing B35 scope that can be built safely on the existing model and pipeline:
   - a bounded, deterministic **zone assessment**;
   - **cross-zone interface checks**;
   - an honest **regeneration preflight** that always refuses.
3. It repairs the test toolchain on Node 22.22.0 and corrects CI.

It does **not** generate or regenerate any geometry, change any execution limit, add a migration, or produce any engineering value.

The canonical roadmap and the Phase 35 V2 research were **not available** to this implementation (see the report, §2). Everything here is built on repository evidence. Wherever the roadmap would decide a question, the question is left to the owner.

## 2. Principles carried over from B35

- **Derived on read.** Nothing is stored; there is no migration and no durable job.
- **Exact arithmetic.** Integer millimetres; areas and volumes as exact doubled-integer strings; no floating-point comparison anywhere.
- **Missing is never passing.** An input that is absent, or a check the model cannot support, is reported as `NOT_EVALUATED` with a typed blocker.
- **No engineering claims.** Geometric consistency is not structural, wind, seismic, fire, vertical-transport or code verification. Every report says so in `claims`.
- **The real gate, not a copy.** Wherever a report says a service would refuse a model, it asks that service's actual gate (`bim/core.sourceModel`).

## 3. Capability truthfulness and hard limits

### 3.1 Limits that already existed (unchanged)

| Limit | Enforced by | Refusal |
|---|---|---|
| ≤ 256 levels per model | `BuildingModelShapeSchema.levels.max(256)` | `400 VALIDATION_ERROR`, `fieldErrors["model.levels"]`, on save |
| ≤ 2 floors generated | Blueprint `floors: 1 \| 2`; parametric `floors.max(2)`; `BLUEPRINT_LIMITS.maxFloors = 2` | `400 VALIDATION_ERROR` at the generation route |
| Bounded BIM profile: ≤ 2 storeys, plus element-count and orthogonality limits | `bim/core.sourceModel` | `422 BIM_UNSUPPORTED_MODEL`, surfaced per service (below) |

The BIM gate sits in front of these services, each of which refuses with its own existing code:

| Service | Refusal code |
|---|---|
| BIM | `BIM_UNSUPPORTED_MODEL` |
| Structural analysis | `STRUCTURAL_SOURCE_UNSUPPORTED` |
| Environmental analysis | `ENVIRONMENTAL_SOURCE_UNSUPPORTED` |
| Building systems, including egress and lifts | `BUILDING_SYSTEMS_SOURCE_UNSUPPORTED` |
| Specialized knowledge | `KNOWLEDGE_SOURCE_UNSUPPORTED` |
| Scene | `SCENE_UNSUPPORTED_MODEL` |
| Selective-revision appearance | Inherits the scene refusal |

### 3.2 Disclosure added

- **Capability discovery** (`GET /api/capabilities`) gains two additive arrays:
  - `modelLimits[]` gives `{ limitId, value, unit, enforcedBy, onExceed, appliesTo[] }` for the limits above, plus `ZONE_ASSESSMENT_MAX_ZONES` (64).
  - `unsupportedOperations[]` gives `{ operationId, status: UNSUPPORTED, reason, detail, preflightRoute }` for these operations:
    - `SUPERTALL_GENERATION`
    - `PARTITIONED_MODEL_PROCESSING`
    - `ZONE_GEOMETRY_REGENERATION`
    - `SECTION_GEOMETRY_REGENERATION`
    - `EXTERIOR_SKIN_GEOMETRY_REGENERATION`
    - `VALIDATED_ENGINEERING_SOLVERS`
- **Discovery service list.** A `ZONE_ASSESSMENT` service is added (`DERIVED_ON_READ`). The preflight is deliberately not listed as a service, because it produces no output.
- **B35 assessment.** Each `relatedServices[]` entry gains `modelSupport` and `refusalCode`:
  - `SUPPORTED` or `REFUSED` comes from the real BIM gate, for the BIM-gated services (structural, building systems, knowledge);
  - the verifier, which runs inside the assessment, is `SUPPORTED`;
  - quantity takeoff is `NOT_CHECKED`, which makes no claim.
- **Domain statuses are unchanged.** A refusing related service does not make a domain "more" or "less" supported; it is disclosed next to it.
- **Limitations.** Two lines are added to the B35 `limitations`: the 2-floor generation limit and the BIM-profile limit.

The generation limit is stated as a literal `2`, because the API may import the generator only through its allowlisted boundary (`foundation.test.ts`). A test pins it to `BLUEPRINT_LIMITS.maxFloors`.

## 4. Zone assessment (`zone-assessment-v1`)

### 4.1 Declaration

A zone is `{ key, fromLevelId, toLevelId }`. Keys match `^[A-Z0-9][A-Z0-9_-]{0,39}$`. There are 1 to 64 zones, and keys must be unique (checked at the schema, giving `400`).

Omitting `zones` selects the **documented default**: one zone, key `ALL`, from the lowest to the highest storey.

Storeys are the model's `kind: storey` levels, ordered exactly as the B35 height formula orders them. Model-relative problems are **reported, never repaired**; the report status is then `INVALID_DECLARATION`, and no zone or interface is computed. The problems are:

| Code | Meaning |
|---|---|
| `NO_STOREYS` | The model has no storey levels |
| `UNKNOWN_LEVEL` | A zone names a level that is not in the model |
| `NOT_A_STOREY` | A zone names a roof or datum level |
| `REVERSED_RANGE` | A zone runs from a higher storey to a lower one |
| `OVERLAP` | Two zones share storeys, including nested zones |
| `GAP` | Storeys between two zones belong to no zone |
| `INCOMPLETE_COVERAGE` | Storeys below the lowest zone or above the highest belong to no zone |

### 4.2 Identity

```
zoneId = sha256("zone-identity-v1\n" + orderedStoreyLevelIds.join("\n"))
```

- The identity depends only on the storeys a zone contains. Renaming a key keeps the id; moving a boundary changes it.
- No timestamp, randomness or iteration order enters it.

### 4.3 Per-zone quantities

These use the B35 storey rows (`model-height-v1`) and the B34 plates (`gross-area-volume-v1`).

| Quantity | Definition |
|---|---|
| `bottomElevationMm` | Elevation of the zone's lowest storey |
| `topMm` | Top of the zone's uppermost storey (elevation + storey height) |
| `heightMm` | `topMm − bottomElevationMm` |
| `grossFloorAreaMm2` | Σ plate areas, exact |
| `grossVolumeMm3` | Σ plate area × storey height, exact |

- `topMm` and `heightMm` are `null`, with a `ZONE_TOP_UNDETERMINED` blocker, when the uppermost storey has no determinable height.
- `grossVolumeMm3` is `null`, with a `ZONE_VOLUME_UNDETERMINED` blocker, when any storey height is undetermined.
- `PLATE_AREA_FALLBACK` flags plates taken from the level boundary rather than from a slab union.
- The zones of a valid declaration partition the storeys, so their areas sum exactly to the B35 whole-building gross floor area. This is tested.

`elements` counts spaces, walls, exterior walls, openings, slabs and columns on the zone's levels, and stairs wholly inside the zone.

**Exterior skin** (`basis: WALL_CLASSIFICATION`):
- It counts walls classified `exterior`, and walls with `unspecified` classification separately (`UNCLASSIFIED_WALLS` blocker).
- It groups walls by façade only when site north is a multiple of 90°, using Phase 30's `wallFacade`. Otherwise `byFacade: null`, with `FACADE_ORIENTATION_UNKNOWN`.

### 4.4 Interface checks

The checks run between adjacent zones: the uppermost storey L of the lower zone and the lowest storey U of the upper zone.

| Check | Rule | Outcomes |
|---|---|---|
| `INTERFACE_ELEVATION` | If L declares a floor-to-floor height: `L.elevation + L.floorToFloor = U.elevation` exactly. A height derived from U's own elevation is not independent evidence. | `PASS` / `FAIL`; `NOT_EVALUATED` (`FLOOR_TO_FLOOR_NOT_DECLARED`) |
| `STAIR_CONNECTION` | At least one stair spans the interface (from ≤ L, to ≥ U) | `PASS` / `WARNING` (no rule applied; lifts are not modelled) |
| `STAIR_SLAB_VOID` | Every spanning stair has a void in U's floor slab whose vertices equal its footprint (the Phase 23 stair/void convention) | `PASS` / `FAIL`; `NOT_EVALUATED` (`NO_STAIR_ACROSS_INTERFACE`, `NO_FLOOR_SLAB_AT_UPPER_LEVEL`) |
| `STAIR_FOOTPRINT_CONTINUITY` | Some flight arriving at L has exactly the footprint of some flight leaving U | `PASS` / `WARNING` (transfer or scissor stairs may be intended; no rule applied); `NOT_EVALUATED` (`NO_ADJACENT_FLIGHTS`) |
| `ENVELOPE_CONTINUITY` | L and U level boundaries compared exactly | Always `INFO` (`UNCHANGED` or `CHANGED`); a setback is not a fault |
| `SHAFT_CONTINUITY` | — | Always `NOT_EVALUATED` (`SHAFTS_NOT_REPRESENTED`): Building Model V2 has no shaft, lift or riser element |

Ring comparison is exact and cyclic, in either orientation.

**No tolerance and no threshold is introduced.** Every comparison is exact equality on the model's integer millimetres, or the absence of a represented element.

**Status:**
- `INVALID_DECLARATION` when the declaration is invalid;
- otherwise `INCONSISTENT` if any check fails;
- otherwise `PARTIAL` if any check, or any zone's height or volume, is not evaluated;
- otherwise `CONSISTENT`.

Because shaft continuity can never be evaluated, a multi-zone report is never `CONSISTENT`. That is truthful, not a defect.

### 4.5 Binding, determinism and freshness

| Field | Content |
|---|---|
| `sourceRevision` | `{ revisionId, revisionNumber, parentRevisionId, modelHash }`, from the RLS-scoped, model-hash-checked revision read (the B34 loader) |
| `inputHash` | `costHash` of `{ version, modelHash, verifierInputHash, canonical declarations }`. Declarations are sorted by key, so listing order never changes a hash; a changed key, range or model does. |
| `resultHash` | `costHash` of the whole report except `resultHash`, `currency` and `generatedAt` |
| `currency` | The existing scene convention: `{ status: CURRENT \| STALE, artifactRevisionId, projectCurrentRevisionId }`, read through the B33 context bundle (one snapshot, no model) |

`currency` is a read-time observation, so a revision's result hash does not change when a newer revision appears; only its currency does. This is tested over HTTP.

Assessment never writes. Tests show the model, the revision count and the current revision unchanged afterwards.

### 4.6 Bounds

- Body ≤ 32 KiB (an over-limit body gets the app's uniform `400`); ≤ 64 zones.
- The model is bounded by its schema (≤ 256 levels, ≤ 1 024 stairs, ≤ 4 096 slabs). Every check is linear in elements, or O(n²) in ring vertices (≤ 256).
- A 256-level tower is assessed in about 50 ms in process.
- Listed entity ids per check or issue are capped at 16.

## 5. Regeneration preflight (`zone-regeneration-preflight-v1`)

**Targets:**

| Kind | Shape | Notes |
|---|---|---|
| `ZONE` | `{ zoneKey }` | |
| `EXTERIOR_SKIN` | `{ zoneKey, facades? }` | |
| `SECTION` | `{ fromLevelId, toLevelId }` | An undeclared storey range |

**Typed refusals:**

| Code | When |
|---|---|
| `422 ZONE_DECLARATION_INVALID` | The declaration is invalid; `fieldErrors.zones` lists the issues |
| `422 ZONE_TARGET_NOT_FOUND` | The target zone key is not declared |
| `422 SECTION_TARGET_INVALID` | Unknown, non-storey or reversed section levels |

For a valid target the report always has `status: UNSUPPORTED`, with `refusal.code` set to one of `ZONE_GEOMETRY_REGENERATION_UNSUPPORTED`, `SECTION_GEOMETRY_REGENERATION_UNSUPPORTED` or `EXTERIOR_SKIN_GEOMETRY_REGENERATION_UNSUPPORTED`. It contains:

| Field | Content |
|---|---|
| `target` | Level ids, zone id, element counts; exterior walls in scope (`null` when requested façades cannot be resolved) |
| `preservation.status` | `PLANNED_NOT_ENFORCED`. Nothing executes, so nothing is locked or compared. |
| `preservation.preservedZones` | The other declared zones; for a section, the storeys below and above it |
| `preservation.crossBoundaryStairs` | Stairs with one end inside the target |
| `preservation.represented` / `notRepresented` | What the model can and cannot preserve: shafts, lifts and risers, load paths, lock enforcement |
| `dependencies` | Every derived artifact family (the Phase 30 list plus verification and the engineering assessment): `WOULD_REQUIRE_RECOMPUTATION` |
| `missingCapabilities` | `NO_MULTI_STOREY_GENERATOR` and `GEOMETRY_REVISION_OPERATION_UNSUPPORTED` always; `BIM_PROFILE_EXCEEDED` from the real gate; `FACADE_ORIENTATION_UNKNOWN` when it applies |
| `alternatives` | Skin only: Phase 30 `APPEARANCE_MODIFY`, with `availableForThisModel` from the real BIM gate. It changes appearance only and does not regenerate geometry. |
| `roadmapDestination` | `{ phase: null, status: OWNER_DECISION_REQUIRED }`. The canonical roadmap was unavailable, so no phase is guessed. |
| `claims` | `regenerationPerformed`, `revisionCreated`, `preservationEnforced`, `engineeringValidity`: all `NOT_CLAIMED` |

**Why not a Phase 30 operation?** A Phase 30 preflight persists an operation row. This preflight must create nothing, so it is derived on read under the engineering routes.

**What it cannot do.** It cannot regenerate anything. **Preflight is not regeneration**, and the B35 partial-regeneration requirement remains unmet (report §5).

## 6. Node 22.22.0 worker bootstrap

On Node 22.22.0, a worker started with `execArgv: ['--import', 'tsx']` runs without the tsx hooks. Node's strip-only TypeScript loader then loads the `.ts` entry. It rejects `enum` (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`) and does not map `.js` specifiers to `.ts` files (`ERR_MODULE_NOT_FOUND`). Node 22.23.2 is unaffected. Both behaviours were reproduced directly.

**Fix.** `ownWorker()` now starts source-mode workers from `apps/api/src/lib/tsx-worker.mjs`. It calls tsx's `register()` inside the worker, then imports the `.ts` entry from `workerData.entry`.

**Production is unchanged.** Compiled workers still start from `dist/*.js`, with `execArgv: []` and no `workerData`. The bootstrap is outside `tsconfig.build.json` (`src/**/*.ts`), so it never reaches `dist` or the image. The supported engine range (`>=22`) is unchanged.

## 7. Retention semantics (unchanged, now pinned)

Project hard deletion is not exposed, and account deletion leaves retained, ownerless history (`docs/phase12-design.md` §2).

The B31–B33 children (references, including tombstones; jobs; briefs) declare `ON DELETE CASCADE`, but their guards refuse row deletion, so such a project cannot be deleted even by a privileged role.

`supabase/tests/database.test.ts` now pins this behaviour. No trigger, cascade or bypass is added. A future erasure feature needs its own reviewed migration and policy.

## 8. Out of scope (unchanged by B35.1)

- Multi-storey geometry generation or regeneration: owner must assign a roadmap phase.
- Validated engineering solvers: B36 (gateway) plus later validation work.
- Evidence packages: B38.
- Dependency graph and freshness propagation: B37.
- Verified standards and rate books: later knowledge and cost work.
- Frontend integration: deferred.
