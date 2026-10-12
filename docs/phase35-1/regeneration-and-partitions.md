# Phase 35: zone regeneration, preservation and partitioned processing

**Status:** implemented on `phase35-1/release-remediation` (PR #7). Not released or tagged. This is the normative specification for `apps/api/src/engineering/regeneration*.ts` and `partition*.ts`.

**Scope source:** the owner's Phase 35 briefs R1b (partitioned processing) and R3 (partial regeneration of zones, sections and exterior skins). The canonical roadmap text for Phase 35 is **unavailable** (see [phase-1-46-reconciliation.md](phase-1-46-reconciliation.md)), so this scope has not been checked against it.

## 1. What was built, and what was not

| Capability | Delivered | Not delivered |
|---|---|---|
| Zone and section regeneration (R3) | `TYPICAL_FLOOR`: every target storey's layout is replaced by a copy of a compatible template storey | Regeneration from requirements by a generator (no multi-storey generator exists); structure or envelope redesign |
| Exterior-skin regeneration (R3) | `FENESTRATION`: the windows of the exterior walls in scope are replaced by a layout computed from a stated rule | Wall geometry (paths, thicknesses, setbacks), façade panels, glazing performance |
| Preservation guarantees (R3) | Enforced on every candidate by an entity-level comparison; any out-of-scope change refuses it. Verifiable on the committed revision. | An atomic regenerate-and-commit that the database itself enforces (needs a migration; see §7) |
| Partitioned processing (R1b) | Each zone is processed as its own model: schema, QA, B34 verification, gross floor area and volume, quantity takeoff, and BIM where the bounded profile admits it. The results reconcile exactly with the whole model. | Scene, structural, environmental, building-systems, knowledge, cost and optimization per zone (they store artifacts bound to stored revisions) |

All three routes are **derived on read**: they store nothing and create no revision, operation, job or artifact.

## 2. API

`ZONES = /api/projects/:projectId/revisions/:revisionId/engineering-assessment/zones`. All routes are owner-scoped `POST` routes with the same authentication, 404, body-limit and rate-limit behaviour as the Phase 35.1 zone routes ([phase35-1-api.md](phase35-1-api.md)). The route catalog grows from 128 to 131.

| Route | Body | 200 response |
|---|---|---|
| `ZONES/regeneration` | `{ zones?, target, operation }` | `RegenerationReport` (`zone-regeneration-v1`) |
| `ZONES/regeneration/verification` | the same body, sent on the **committed** revision | `RegenerationVerificationReport` (`zone-regeneration-verification-v1`) |
| `ZONES/partitions` | `{ zones?, includeModels?: boolean = false }` | `PartitionReport` (`zone-partitions-v1`) |

`target` is the Phase 35.1 preflight target (`ZONE`, `SECTION` or `EXTERIOR_SKIN`). `operation` is one of:
- `{ kind: 'TYPICAL_FLOOR', templateLevelId }`, for a `ZONE` or `SECTION` target;
- `{ kind: 'FENESTRATION', window: { widthMm 300–10 000, heightMm 300–10 000, sillMm 0–10 000, gapMm 100–100 000, edgeClearanceMm 0–100 000, type = 'window' } }`, for an `EXTERIOR_SKIN` target.

Any other pairing gets `400 VALIDATION_ERROR`.

**Typed errors (422):** `ZONE_DECLARATION_INVALID`, `ZONE_TARGET_NOT_FOUND`, `SECTION_TARGET_INVALID`, and `REGENERATION_TEMPLATE_INVALID` (the template is not a storey of the revision). Every other outcome is a `200` report with a status.

### 2.1 The commit flow

1. `POST ZONES/regeneration` on the current revision **R**. On `CANDIDATE_READY` the report carries `candidate.model`, `candidate.modelHash` and `commit`.
2. Save `candidate.model` with `POST /api/projects/:projectId/revisions` and `baseRevisionId: R`, the existing supplied-revision route. It re-runs acceptance QA, and its compare-and-swap refuses the save with `409 REVISION_CONFLICT` once R is no longer current. An `Idempotency-Key` works as on any save.
3. `POST ZONES/regeneration/verification` on the new revision **C**, with the same body. `VERIFIED` means C has exactly the canonical model hash of the regeneration recomputed from C's parent.

The saved revision is recorded as `supplied`, because no migration adds a regeneration source. Its lineage is the revision ancestry plus step 3.

## 3. Regeneration report

| Field | Content |
|---|---|
| `status` | `CANDIDATE_READY`, `NO_CHANGE` (the candidate equals the base), or `REFUSED` (see `refusals`) |
| `refusals[]` | `{ code, detail }`; the codes are listed in §5 |
| `target`, `operation` | The resolved target, and the operation with its version (`typical-floor-v1`, `fenestration-v1`) |
| `changes` | Regenerated levels; removed and added spaces, walls, openings and dimensions per level; walls regenerated; skipped entities with a reason |
| `preservation` | `allowedChange` (what may change), `check` (§4), `preservedInTarget[]` and `preservedZones[]` with `identical` |
| `qa` | The acceptance QA of the candidate: the same function the save route runs. A `FAIL` refuses the candidate. |
| `candidate` | `{ modelHash, model }` only when `CANDIDATE_READY` |
| `commit`, `verificationRoute` | §2.1 |
| `dependencies[]` | Every derived artifact, marked `NOT_APPLICABLE_TO_CANDIDATE` |
| `currency` | `CURRENT` or `STALE`, by the scene convention. A stale base still yields the same candidate, but the save will refuse it. |
| `claims` | `revisionCreated`, `engineeringValidity`, `codeCompliance` and `designSuitability`, all `NOT_CLAIMED` |

`inputHash` covers the model hash, the canonical zone declaration, the target and the operation. `resultHash` excludes `currency` and `generatedAt`.

## 4. Preservation (enforced)

`preservationCheck(base, candidate, allowed)` compares every entity in levels, spaces, walls, openings, slabs, columns, stairs, dimensions and specifications by canonical hash. Wall `spaceIds` order is ignored; `provenance` is outside model identity and is not compared. An added, removed or changed entity is in scope only if the operation allows it in every version that exists. A change to the site or to any document-level field is never in scope.

The candidate is refused (`PRESERVATION_VIOLATION`) unless the check is `WITHIN_SCOPE` or `IDENTICAL`. `preservedZones[].identical` independently compares a canonical hash of everything on each untouched zone.

| Operation | Allowed to change | Everything else must be identical, including |
|---|---|---|
| `TYPICAL_FLOOR` | Spaces, walls, openings and storey dimensions **on the regenerated storeys** | Levels, slabs and voids, columns, stairs and landings, specifications, the template storey, every other storey, level-less dimensions, the site |
| `FENESTRATION` | Windows **hosted on the regenerated walls** | The walls themselves, doors and generic openings, other walls' openings, spaces, slabs, columns, stairs, dimensions, other storeys, the site |

## 5. Operations

### 5.1 TYPICAL_FLOOR (`typical-floor-v1`)

The targets are the target zone's or section's storeys, excluding the template. Each target must match the template **exactly** in every one of the following, or the operation is refused with `STOREY_INCOMPATIBLE`, naming each storey and reason:
- the level envelope is the same region (`sameRegion`: any start vertex, orientation or redundant collinear vertex);
- the `model-height-v2` storey height is known on both and equal;
- the declared floor-to-floor heights are equal where both are declared;
- slabs (kind, outline, voids, offset, thickness), columns (section, base, height), and the stair flights leaving and arriving (footprint, direction, width, rise, run, risers, treads, headroom, landings), all compared as exact multisets;
- for any target other than the lowest storey: the template has no door in an exterior wall (an entrance is never copied upward).

Other refusals:
- `DIMENSION_DEPENDS_ON_REPLACED_ENTITY`: a dimension outside the targets measures a replaced entity;
- `PARAMETRIC_MODEL`: change the parameters instead;
- `ID_COLLISION`.

**Copy:** every space, wall, opening and dimension of the template is copied to each target.
- Its id becomes `rg-` + the first 40 hex digits of sha256(`typical-floor-v1`, target level id, source id).
- Its level, and its wall, space and opening references, are remapped.
- Point anchors of dimensions move by the elevation difference.
- A template dimension whose anchor cannot be remapped is skipped and listed.

Re-running the same request on the result gives `NO_CHANGE`.

### 5.2 FENESTRATION (`fenestration-v1`)

The walls in scope are the exterior walls on the target storeys. With a façade subset, only walls whose façade resolves to it are in scope. That needs site north at a multiple of 90°; otherwise the operation is refused with `FACADE_ORIENTATION_UNKNOWN`. A wall is skipped and listed, and keeps all its openings, when:
- it is not axis-aligned (`WALL_NOT_AXIS_ALIGNED`);
- a non-orthogonal wall touches it (`NON_ORTHOGONAL_JUNCTION`);
- sill plus height exceeds its height (`WINDOW_EXCEEDS_WALL_HEIGHT`);
- its façade does not resolve (`FACADE_UNRESOLVED`).

The layout on a regenerated wall of length L is measured along the path from its start, as hosted openings are. It is integer millimetres throughout.

1. Every window on the wall is removed. Doors and generic openings stay.
2. These intervals are blocked:
   - `[0, c]` and `[L − c, L]`, where c is `edgeClearanceMm`;
   - for every wall meeting or crossing this one at position p: `[p − ⌈t/2⌉ − c, p + ⌈t/2⌉ + c]`, where t is that wall's thickness;
   - for every collinear wall: its extent ± c;
   - for every kept opening: `[offset − gap, offset + width + gap]`.
3. In each free interval of length F, the number of windows is n = ⌊(F + gap) / (width + gap)⌋. They are placed as one group at exactly `gap` spacing, starting at `a + ⌊(F − (n·width + (n − 1)·gap)) / 2⌋`.
4. Window ids are `rg-` + sha256(`fenestration-v1`, wall id, `window-k`).

Other refusals:
- `NO_EXTERIOR_WALLS_IN_SCOPE`;
- `DIMENSION_DEPENDS_ON_REPLACED_ENTITY`, for a dimension that measures a removed window;
- `PARAMETRIC_MODEL`;
- `ID_COLLISION`.

### 5.3 Gates common to both

After the operation, in order:
1. The candidate must parse as Building Model V2 (`CANDIDATE_SCHEMA_INVALID`).
2. Preservation must hold (`PRESERVATION_VIOLATION`).
3. If it differs from the base, it must pass acceptance QA (`QA_REJECTED`). The QA is `revisionQaReport(model, null, null)`, exactly what the supplied-revision save runs.

## 6. Verification report

The verification recomputes the regeneration from the committed revision's parent. Its statuses are:
- `VERIFIED`: the committed revision has the candidate's canonical model hash;
- `MISMATCH`: it does not;
- `NOT_REPRODUCIBLE`: the recomputation is not `CANDIDATE_READY`;
- `NO_PARENT`.

Independently of the hash, it reports two comparisons:
- `preservation`: the committed revision against its parent, under the operation's allowed scope;
- `deviation`: the committed revision against the recomputed candidate, with an empty scope, so every deviation is listed by entity.

## 7. Partitioned processing

### 7.1 How the model is partitioned

1. Zones are validated exactly as in the zone assessment.
2. Each level joins the zone whose lowest storey is the highest at or below the level's elevation. Levels below the first zone join the first zone. A datum or roof level therefore stays with the zone below it.
3. Spaces, walls, openings, slabs, columns and dimensions go with their level.
4. Each stair goes into a partition only if both of its levels are in that partition.
5. A level-less dimension goes into a partition only if every level it references is in that partition.

Anything else is an **interface element**: it is listed, and processed in no partition. Specifications are copied into each partition that references them. A partition model keeps the source model's id, name, site and provenance. A parametric submodel is kept only when the partition is the whole building.

### 7.2 What runs on each partition

All of these are recomputed on the partition alone; nothing is stored:
- schema validation;
- acceptance QA with the BIM source options (no entrance reachability);
- B34 verification;
- gross volume, from the partition's plates and the **whole-model** `model-height-v2` storey heights;
- quantity takeoff, within its own limits (project totals);
- the BIM profile gate, then projection and the independent BIM validator where admitted.

`includeModels` returns each partition model.

### 7.3 Reconciliation

`status` is `RECONCILED` only when all of the following hold:
- **Coverage:** every entity is in exactly one partition or is an interface element.
- **Plates:** every storey's partition plate equals its whole-model plate, exactly.
- **Gross floor area:** the partitions' areas sum to the whole model's.
- **Volume:** the partitions' volumes sum to the whole model's, or both are undetermined.

Plates differ only where the whole-model verifier fell back from the exact slab union. Each plate row reports both methods. A test shows the whole-model budget running out on a complex tower while each partition is verified exactly. The report then says `NOT_RECONCILED`, rather than presenting either figure as agreed.

### 7.4 Observed consequences (pinned by tests)

- **8-storey tower in four 2-storey zones:** the lowest partition passes the BIM profile and validates. Above it, each partition's floor void serves a stair arriving from the zone below, which is an interface element. Alone, the partition has a floor void without a flight, so QA reports `QA_SPACE_FLOOR_VOID` and the BIM profile refuses it (`BIM_INVALID_SOURCE`). That is reported, not repaired. Zone boundaries that cut no stair give independently valid partitions.
- **128-storey tower with 8 windows per exterior wall:** whole-model takeoff refuses it (`RESOURCE_LIMIT_EXCEEDED`). Each of 8 zone partitions is measured, and the partitions' window counts sum to the model's.

## 8. Versions and compatibility

| Literal | Status |
|---|---|
| `zone-regeneration-v1`, `zone-regeneration-verification-v1`, `typical-floor-v1`, `fenestration-v1`, `zone-partitions-v1` | New |
| `zone-regeneration-preflight-v1` | Schema unchanged. Its alternatives now name `TYPICAL_FLOOR` or `FENESTRATION` with the regeneration route, and its refusal texts say that only generator-driven regeneration is unsupported. Unreleased on this branch. |
| `capability-discovery-v2` | Adds two services: `ZONE_REGENERATION` (`CANDIDATE_THEN_SUPPLIED_REVISION`) and `ZONE_PARTITIONS` (`DERIVED_ON_READ`). Adds `modelLimits` row `QUANTITY_TAKEOFF_MAX_ENTITIES`. Changes the unreleased Phase 35.1 `unsupportedOperations` (see below). |
| `model-height-v2`, `engineering-assessment` and `zone-assessment-v1` | Unchanged by this round |

The Phase 35.1 `unsupportedOperations` change:
- removed `PARTITIONED_MODEL_PROCESSING`, `ZONE_GEOMETRY_REGENERATION`, `SECTION_GEOMETRY_REGENERATION` and `EXTERIOR_SKIN_GEOMETRY_REGENERATION`, now covered as stated above;
- added `GENERATIVE_ZONE_REGENERATION`, `ENVELOPE_GEOMETRY_REGENERATION` and `PARTITIONED_ARTIFACT_SERVICES`.

The OpenAPI document gains three paths. After resolving references, all 103 existing paths and every shared component are byte-identical to the previous document.

## 9. Persistence, data retention, security and deployment

- **Storage:** none. No migration, no table, no column, no environment variable, no new dependency.
- **Committed revisions:** a committed candidate is an ordinary immutable supplied revision, retained under the existing (undecided) deletion policy.
- **Reads:** the regeneration, verification and partition routes read revisions through the owner-scoped RLS loader. Verification also reads the parent revision through that loader.
- **Writes:** none. The only write path is the existing save route.
- **Bounds:** request bodies ≤ 32 KiB, zones ≤ 64, models within the Building Model V2 schema limits. Partitioned BIM uses the existing profile limits.
- **Response size:** responses carry full models, for the candidate and for partitions with `includeModels`. Their size is that of the stored model.

## 10. Limitations

- Regeneration is deterministic editing, not design. It never judges layout quality, daylight, egress, structure or code compliance.
- The save route accepts any QA-valid model. A committed revision is proven to be a regeneration only by the verification route.
- Building Model V2 has no shaft, lift, riser, façade-panel or load-path elements. None of them is regenerated, preserved beyond represented geometry, or partitioned.
- Partitioned QA and BIM describe each partition alone. A stair cut by a zone boundary makes the partition above it fail QA.
- The canonical roadmap and the Phase 35 V2 research are unavailable. The R1b and R3 scope comes from the owner's briefs.
