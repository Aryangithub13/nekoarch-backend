# Phase 35.1 API: zone assessment, regeneration preflight and limit disclosure

All changes are **additive**. The route catalog grows from 125 to 128 entries. No existing route changes its path, method, request schema or status codes.

| Property | Value |
|---|---|
| Authentication | Supabase bearer session. Anonymous requests get 401 (catalogued). |
| Foreign or unknown project or revision | 404 |
| Stored identity differs from the model | `422 VERIFICATION_SOURCE_MISMATCH` (Phase 34 loader) |
| Body | `POST` ≤ 32 KiB; larger bodies get the app's uniform `400 INVALID_REQUEST`. Unknown fields, malformed keys, duplicate keys or more than 64 zones get `400 VALIDATION_ERROR`. |
| Persistence | None. Derived on read; no revision, operation, job or artifact is created. |
| Rate limiting | `POST` routes are charged to the `write` group (method-based, as for the other compute-on-read POST routes) |
| Schemas | Zod v3 in `apps/api/src/engineering/zone-contracts.ts`, exported to [openapi.json](../modernization/openapi.json) |

`ZONES = /api/projects/:projectId/revisions/:revisionId/engineering-assessment/zones`

| Method and path | Body | Success |
|---|---|---|
| `GET ZONES` | None; query parameters are rejected | 200 `ZoneAssessmentReport` for the default single zone `ALL` |
| `POST ZONES` | `{ zones?: ZoneDeclaration[1..64] }` | 200 `ZoneAssessmentReport` |
| `POST ZONES/regeneration-preflight` | `{ zones?: ZoneDeclaration[1..64], target }` | 200 `ZonePreflightReport`, always `status: UNSUPPORTED` |

**`ZoneDeclaration`** is `{ key, fromLevelId, toLevelId }`. The key matches `^[A-Z0-9][A-Z0-9_-]{0,39}$`. Keys are unique, and the order of the list does not matter.

**`target`** is one of:
- `{ kind: 'ZONE', zoneKey }`
- `{ kind: 'EXTERIOR_SKIN', zoneKey, facades?: ('NORTH'|'EAST'|'SOUTH'|'WEST')[1..4] }`
- `{ kind: 'SECTION', fromLevelId, toLevelId }`

**Preflight refusals:**

| Status and code | When |
|---|---|
| `422 ZONE_DECLARATION_INVALID` | The declaration is invalid for the model; `error.fieldErrors.zones[]` gives `"CODE: detail"` per issue |
| `422 ZONE_TARGET_NOT_FOUND` | The target zone key is not declared |
| `422 SECTION_TARGET_INVALID` | The section names an unknown or non-storey level, or runs downwards |

The assessment route does not refuse an invalid declaration. It returns `200` with `status: INVALID_DECLARATION` and the issues, so that a client can show every problem at once.

## ZoneAssessmentReport

| Field | Content |
|---|---|
| `zoneAssessmentVersion`, `engine` | `zone-assessment-v1`; `zone-identity-v1`; verifier version; formulas `model-height-v1` and `gross-area-volume-v1` |
| `projectId`, `revisionId`, `modelHash`, `inputHash`, `resultHash`, `generatedAt` | Identity and audit. `resultHash` excludes `currency` and `generatedAt`. |
| `sourceRevision` | `{ revisionId, revisionNumber, parentRevisionId, modelHash }` |
| `currency` | `{ status: CURRENT \| STALE, artifactRevisionId, projectCurrentRevisionId }` (the scene artifact convention) |
| `status` | `CONSISTENT`, `PARTIAL`, `INCONSISTENT` or `INVALID_DECLARATION` |
| `declaration` | `{ source: DECLARED \| DEFAULT_SINGLE_ZONE, status: VALID \| INVALID, issues[] }`. Each issue is `{ code, zoneKeys, levelIds (≤16), detail }`. The codes are `NO_STOREYS`, `UNKNOWN_LEVEL`, `NOT_A_STOREY`, `REVERSED_RANGE`, `OVERLAP`, `GAP` and `INCOMPLETE_COVERAGE`. |
| `zones[]` | `{ key, zoneId, fromLevelId, toLevelId, levelIds, storeyCount, bottomElevationMm, topMm, heightMm, grossFloorAreaMm2, grossVolumeMm3, elements, exteriorSkin, blockers[] }` |
| `interfaces[]` | `{ lowerZoneKey, upperZoneKey, lowerLevelId, upperLevelId, checks[6] }`. Each check is `{ check, status, entityIds, measured, required, blocker, detail }`. |
| `summary` | Counts of `PASS`, `FAIL`, `WARNING`, `INFO` and `NOT_EVALUATED` over all interface checks |
| `limitations`, `claims` | `structuralAdequacy`, `windOrSeismicPerformance`, `fireAndLifeSafety`, `verticalTransportAdequacy` and `codeCompliance`, all `NOT_CLAIMED` |

The `zones[]` fields in detail:

| Field | Content |
|---|---|
| `heightMm` | `null` when the zone's top storey height is undetermined |
| `grossFloorAreaMm2`, `grossVolumeMm3` | Exact mm² and mm³ strings (`.5` allowed). Volume is `null` when any storey height is undetermined. |
| `elements` | `{ spaces, walls, exteriorWalls, openings, slabs, columns, stairsWithin }` |
| `exteriorSkin` | `{ basis: WALL_CLASSIFICATION, exteriorWalls, unclassifiedWalls, byFacade: {NORTH,EAST,SOUTH,WEST,UNRESOLVED} \| null, facadeBasis: SITE_NORTH_ORTHOGONAL \| NOT_RESOLVED }` |
| `blockers[]` | `ZONE_TOP_UNDETERMINED`, `ZONE_VOLUME_UNDETERMINED`, `PLATE_AREA_FALLBACK`, `FACADE_ORIENTATION_UNKNOWN`, `UNCLASSIFIED_WALLS` |

The six interface checks, in order:
1. `INTERFACE_ELEVATION`
2. `STAIR_CONNECTION`
3. `STAIR_SLAB_VOID`
4. `STAIR_FOOTPRINT_CONTINUITY`
5. `ENVELOPE_CONTINUITY`
6. `SHAFT_CONTINUITY`

Their rules are in [design §4.4](phase35-1-design.md#44-interface-checks).

## ZonePreflightReport

| Field | Content |
|---|---|
| `preflightVersion` | `zone-regeneration-preflight-v1`, plus the identity and audit fields and `sourceRevision` and `currency`, as above |
| `status`, `refusal` | `UNSUPPORTED`; `{ code: ZONE_ \| SECTION_ \| EXTERIOR_SKIN_GEOMETRY_REGENERATION_UNSUPPORTED, detail }` |
| `declaration` | As above (always `VALID` here, because an invalid declaration is a 422) |
| `target` | `{ kind, zoneKey \| null, zoneId, levelIds, facades \| null, elements, exteriorWallsInScope \| null }` |
| `preservation` | `{ status: PLANNED_NOT_ENFORCED, preservedZones[], crossBoundaryStairs[≤16], crossBoundaryStairCount, represented[], notRepresented[] }` |
| `dependencies[]` | `{ artifact, impact: WOULD_REQUIRE_RECOMPUTATION, detail }` for each of these artifacts: `BIM`, `SCENE_3D`, `QUANTITY_TAKEOFF`, `CONSTRUCTION_CALCULATION`, `BOQ_COST`, `STRUCTURAL_ANALYSIS`, `ENVIRONMENTAL_ANALYSIS`, `BUILDING_SYSTEMS_ANALYSIS`, `SPECIALIZED_KNOWLEDGE`, `DESIGN_OPTIMIZATION`, `COMPLEX_VERIFICATION` and `ENGINEERING_ASSESSMENT` |
| `missingCapabilities[]` | `NO_MULTI_STOREY_GENERATOR`, `GEOMETRY_REVISION_OPERATION_UNSUPPORTED`, `BIM_PROFILE_EXCEEDED`, `FACADE_ORIENTATION_UNKNOWN` |
| `alternatives[]` | Skin targets only: `{ operation: APPEARANCE_MODIFY, availableForThisModel, route: /api/projects/:projectId/revision-operations, detail }` |
| `roadmapDestination` | `{ phase: null, status: OWNER_DECISION_REQUIRED, detail }` |
| `claims` | `regenerationPerformed`, `revisionCreated`, `preservationEnforced` and `engineeringValidity`, all `NOT_CLAIMED` |

## Changes to existing responses (additive)

**`GET /api/capabilities`** gains two arrays and one service row:
- `modelLimits[]`: `BUILDING_MODEL_MAX_LEVELS` (256), `GENERATION_MAX_FLOORS` (2), `BIM_PROFILE_MAX_STOREYS` (2) and `ZONE_ASSESSMENT_MAX_ZONES` (64). Each row is `{ limitId, value, unit, enforcedBy, onExceed, appliesTo[] }`.
- `unsupportedOperations[]`: `SUPERTALL_GENERATION`, `PARTITIONED_MODEL_PROCESSING`, `ZONE_GEOMETRY_REGENERATION`, `SECTION_GEOMETRY_REGENERATION`, `EXTERIOR_SKIN_GEOMETRY_REGENERATION` and `VALIDATED_ENGINEERING_SOLVERS`. Each row is `{ operationId, status: UNSUPPORTED, reason, detail, preflightRoute \| null }`.
- `services[]` gains `ZONE_ASSESSMENT` (`zone-assessment-v1`, `DERIVED_ON_READ`, route `ZONES`).

**`GET`/`POST …/engineering-assessment` (B35)** changes as follows. `assessmentVersion` is unchanged.
- `domains[].relatedServices[]` gains two **required** fields: `modelSupport: SUPPORTED | REFUSED | NOT_CHECKED` and `refusalCode: string | null`. Clients that validate strictly against the old schema must accept the new fields.
- `limitations[]` gains two lines: the 2-floor generation limit and the BIM-profile limit.
- Because the report content changed, its `resultHash` for a given revision differs from B35. Nothing stored these hashes, because the assessment is derived on read.
