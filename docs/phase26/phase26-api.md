# Phase 26 API — building-systems coordination

**MEP COORDINATION ≠ COMPLETE ENGINEERING DESIGN. LIFE-SAFETY GEOMETRY ≠ FIRE-CODE CERTIFICATION. ELEVATOR PLANNING ≠ ELEVATOR ENGINEERING CERTIFICATION.**

Base path: `/api/projects/:projectId/revisions/:revisionId/systems`. Every route requires an authenticated owner. Another user's project returns `404`, and an anonymous caller gets `401`.

| Method | Route | Calculates | Persists | Quota |
|---|---|---|---|---|
| `POST` | `/validate` | no: builds and independently validates the model, preflights limits | no | generation |
| `POST` | `/analyses` | yes: routing, egress, proposals, clashes; untrusted-output and independent validation | yes (immutable, signed) | generation |
| `GET` | `/analyses?limit=&cursor=` | no | no | read |
| `GET` | `/analyses/:analysisId[?require=current]` | no | no | read |
| `GET` | `/status` | no | no | read |

GET routes never compute or refresh anything. `POST /analyses` is durable-idempotent: send an `Idempotency-Key` header. The same user, key and body replay the stored response. The same key with a different body is `409 IDEMPOTENCY_CONFLICT`. An identical canonical input without a key converges on the same row, because rows are unique per revision and input hash.

## Request: `building-systems-input-v1`

The schema is strict: unknown fields are `400`. A `null` discipline is reported as `NOT_EVALUATED`, never silently omitted. Every value is explicit and `USER_PROVIDED`; nothing is inferred from names, locale or upstream analyses.

```jsonc
{
  "version": "building-systems-input-v1",
  "sources": { "structuralAnalysisId": "uuid|null", "environmentalAnalysisId": "uuid|null" },   // explicit ids of THIS revision only; never "latest"
  "plumbing": {
    "fixtures": [{ "key": "u-wc", "kind": "WC", "spaceId": "space-bathroom-2",
      "connections": [{ "service": "SANITARY", "point": { "x": 10200, "z": 7000 }, "elevationMm": 0 },        // point null ⇒ INPUT_INCOMPLETE
                      { "service": "COLD_WATER", "point": { "x": 10500, "z": 7000 }, "elevationMm": 200 }],
      "provenance": "USER_PROVIDED" }],
    "coldWaterSource": { "key": "main", "spaceId": "...", "point": {...}, "elevationMm": 300, "provenance": "USER_PROVIDED" },
    "hotWaterSource": null,
    "sanitaryOutlet": { "key": "sewer", "spaceId": "...", "point": {...}, "elevationMm": -800, "provenance": "USER_PROVIDED" },  // centreline elevation
    "minimumSlope": { "rise": 1, "run": 40, "provenance": "USER_PROVIDED" },                                 // exact ratio, rise ≤ run
    "coldWater": { "elevations": [{ "levelId": "level-0", "elevationMm": 2200 }], "size": { "shape": "ROUND", "diameterMm": 20 }, "routing": { "mode": "PLANNED" } },
    "hotWater": { ... },
    "sanitary": { "bands": [{ "levelId": "level-0", "topMm": -300, "bottomMm": -900 }], "size": { "shape": "ROUND", "diameterMm": 100 } },
    "clearance": { "value": 25, "unit": "mm", "provenance": "USER_PROVIDED" } | null                        // null ⇒ CLEARANCE_NOT_EVALUATED
  },
  "electrical": {
    "supply": { "key": "mains", "systemVoltage": { "value": 230, "unit": "V" } | null, "phaseSystem": "SINGLE_PHASE|SPLIT_PHASE|THREE_PHASE" | null,
                "frequencyHz": { "value": 50, "unit": "Hz" } | null, "spaceId": "...", "point": {...}, "elevationMm": 1500, "provenance": "USER_PROVIDED" } | null,
    "panels": [{ "key": "db-1", "spaceId": "...", "point": {...}, "elevationMm": 1500, "footprint": { "minX": 0, "minZ": 0, "maxX": 0, "maxZ": 0 } | null, "provenance": "USER_PROVIDED" }],
    "circuits": [{ "key": "c1", "panel": "db-1", "loads": ["light-living"] }],
    "loads": [{ "key": "light-living", "kind": "LIGHTING", "spaceId": "...", "point": {...}, "elevationMm": 2700, "power": { "value": 1000, "unit": "W|VA" },
                "phase": "L1|L2|L3" | null, "demandFactor": { "value": 0.9, "provenance": "USER_PROVIDED" } | null, "provenance": "USER_PROVIDED" }],
    "feeder": { "elevations": [...], "size": ..., "routing": ... }, "circuitRouting": { ... }, "clearance": ...
  },
  "hvac": {
    "equipment": [{ "key": "ahu-1", "kind": "AIR_HANDLING_UNIT", "spaceId": "...", "point": {...}, "elevationMm": 2300, "footprint": null, "provenance": "USER_PROVIDED" }],
    "systems": [{ "key": "sa", "kind": "SUPPLY|RETURN|EXHAUST", "equipment": "ahu-1", "connection": { "point": {...}, "elevationMm": 2300 },
      "terminals": [{ "key": "sa-bed", "spaceId": "...", "point": {...}, "elevationMm": 2700, "airflow": { "value": 150, "unit": "L/s|m3/s", "provenance": "USER_PROVIDED" } | null }],
      "ductSection": { "shape": "RECTANGULAR", "widthMm": 300, "heightMm": 200 } | { "shape": "ROUND", "diameterMm": 250 } | null,
      "elevations": [{ "levelId": "level-1", "elevationMm": 2400 }], "routing": { "mode": "PLANNED" } }],
    "clearance": ...
  },
  "lifeSafety": { "exits": { "mode": "SITE_PRIMARY_ENTRY" } | { "mode": "EXPLICIT", "openingIds": ["..."] } | null, "obstructedOpeningIds": [] },
  "verticalTransport": { "elevators": [{ "key": "lift-1", "servedLevelIds": ["level-0", "level-1"], "shaft": { "widthMm": 1600, "depthMm": 1600 },
    "door": { "side": "+x|-x|+z|-z", "widthMm": 900 }, "placement": { "mode": "PLANNER_SELECTED" } | { "mode": "FIXED", "origin": { "x": 0, "z": 0 } },
    "cabin": null, "pitDepthMm": null, "overheadMm": null, "ratedLoad": null, "ratedSpeed": null, "provenance": "USER_PROVIDED" }] }
}
```

**Units and conventions:**

- Plan coordinates are integer millimetres in the building frame (`x-right-y-up-z-depth`).
- `elevationMm` values are relative to the terminal's level. The model converts them to absolute `y`.
- Lengths are in mm, areas in mm² (plan), airflow in m³/s exactly (L/s ÷ 1000), velocity in m/s, power in W or VA, voltage in V and frequency in Hz.

**Routing:**

- `PLANNED` uses the deterministic router.
- `FIXED` takes user polylines, which are checked and clash-tested but never rerouted. FIXED is not available for sanitary drainage.

## Status semantics

Every capability reports one of:

- `NOT_EVALUATED`: not requested or deliberately out of scope;
- `INPUT_INCOMPLETE`;
- `ANALYZED`;
- `PARTIAL`: some networks did not route, or some proposals were rejected;
- `UNSUPPORTED`.

Network statuses are `ROUTED`, `ROUTE_NOT_FOUND` (`SYSTEM_ROUTE_NOT_FOUND`), `ROUTE_INVALID` (`SYSTEM_ROUTE_INVALID`) and `INPUT_INCOMPLETE`. A route failure is recorded in the snapshot; it is not a 500. Electrical is `INPUT_INCOMPLETE` whenever supply voltage, phase system or frequency is missing; none is ever assumed.

## Response highlights (`results`)

| Section | What it holds |
|---|---|
| `networks[]` | Per network: `branches[].points` (3-D polylines, terminal → join), `length`/`horizontalLength`/`verticalLength`, `bends`, `levelTransitions`. Drainage adds `slope`, outlet and arrival centreline elevations, `stacks[]`. HVAC adds `airflow.segments[].flow`/`velocity` (exact strings). |
| `plumbing` | `fixtures`, `fixturesConnected`, `notEvaluated` (hydraulic sizing, pressure, pump, tank, diameter selection, friction, demand, drainage-code compliance). |
| `electrical` | Exact connected load per circuit, panel and total (W and VA kept apart). Demand appears only when every load in a group has an explicit factor. `notEvaluated`: breaker, conductor, fault current, discrimination, earthing, withstand, phase balance, code. |
| `hvac` | `referenceInputs.environmental` (role `ENVELOPE_TRANSMISSION_COMPONENT`, `isDesignLoad: false`); `notEvaluated`: design heating/cooling load, duct pressure, fan, coil, chiller, AC capacity. |
| `lifeSafety` | Per space:<br>• `reachable`, `distance`, `mostRemotePoint2` (doubled coordinates), `exitOpeningId`<br>• `via[]` (openings and stairs), `levelTransitions`<br>• `disjointExitRoutes`, `distinctExitsReachable`<br><br>Plus `unreachableSpaceIds`, `egressAvailable`, `longest`, `deadEnds[]` (`GEOMETRIC_DEAD_END_LENGTH`), width inventories, and `notEvaluated`. |
| `verticalTransport` | Per elevator:<br>• `status` `PROPOSED`/`REJECTED`, `shaft`, `door`, `verticalAccess` (`VERTICAL_ACCESS_PATH_AVAILABLE` / `…_NOT_AVAILABLE` / `NOT_EVALUATED`)<br>• `overlappedSpaces[]` (exact mm²), `crossedWallIds`, `blockingClashIds`<br>• `architectureMutation: "NONE"`, and `engineering` fields `NOT_SPECIFIED` unless given |
| `coordination` | `clashes[]` (type, disciplines, entities, `bounds`, `severity` `BLOCKING`/`REVIEW_REQUIRED`/`INFORMATIONAL`, `basis`, overlap `evidence`, `resolution`), `penetrations[]` (host, location, size, `REVIEW_REQUIRED`), `structuralClearance` (`EVALUATED` only with a bound structural analysis), per-discipline `clearance`. |
| `quantities` | Route length per network and size; fixture, panel, load, terminal, equipment and proposal counts; `costing: "NOT_EVALUATED"`. |

The snapshot carries the claims block, every key `NOT_CLAIMED`: `mepDesignComplete`, `electricalSafety`, `plumbingCompliance`, `hvacSizing`, `fireCodeCompliance`, `lifeSafetyCertification`, `accessibilityCompliance`, `elevatorCertification`, `buildingCodeCompliance`, `professionalCertification`. The service writes it, the database enforces it with a check constraint, and the calculator cannot set it.

## Staleness

An analysis is bound to its revision. `currency.status` is `CURRENT` while the project's current revision is that revision and `STALE` afterwards. `?require=current` on a stale analysis returns `409 SYSTEMS_RESULT_STALE`.

Analyses are never reachable through another revision's path (404). `/status` on a newer revision reports `requiresNewAnalysis: true` and lists older analyses as `staleAnalyses` with `staleReason: BOUND_TO_A_DIFFERENT_REVISION`. MEP routes are never re-applied to a new revision.

## Errors

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | schema violation, unknown field, bad query or cursor, oversize body |
| 401 / 404 | `UNAUTHORIZED` / `PROJECT_NOT_FOUND`, `REVISION_NOT_FOUND`, `SYSTEMS_ANALYSIS_NOT_FOUND`, `STRUCTURAL_ANALYSIS_NOT_FOUND`, `ENVIRONMENTAL_ANALYSIS_NOT_FOUND` | ownership, revision association, explicit upstream id not in this revision |
| 409 | `SYSTEMS_RESULT_STALE`, `IDEMPOTENCY_CONFLICT` | |
| 422 | `BUILDING_SYSTEMS_SOURCE_UNSUPPORTED`, `BUILDING_SYSTEMS_MODEL_INVALID`, `BUILDING_SYSTEMS_RESOURCE_LIMIT`, `SYSTEM_RESULT_INVALID`, `SYSTEM_ANALYSIS_TIMEOUT`, `SYSTEM_ANALYSIS_FAILED`, `REVISION_NOT_ACCEPTED` | typed refusals; nothing is persisted |
| 503 | `SYSTEMS_UNAVAILABLE` | no commit signer configured |

## Limits

See `phase26-design.md` §14. The input is capped at 1 MiB, ≤ 500 terminals in total, ≤ 64 networks plus circuits, and ≤ 4 elevators. Grid nodes per network, total search states, egress nodes, clash pairs and elevator candidates are preflighted or guarded, and overflow returns `422 BUILDING_SYSTEMS_RESOURCE_LIMIT` before work proceeds. The calculation deadline is 10 s and the snapshot is capped at 9 MB.

## Example: two-storey building, explicit everything

`POST …/systems/analyses` with the test fixture `systemsInput()` (`test-support/systems-fixtures.ts`) returns `201`:

- `networks: 8` (sanitary, cold, hot, feeder, two circuits, supply and return ducts), all `ROUTED`;
- connected load `1750 W`, with demand `NOT_EVALUATED` because no factors were given;
- trunk duct velocity `25/6 m/s`;
- egress available from all 9 spaces, the longest from the upper bedroom via the stair;
- one `PROPOSED` lift with `architectureMutation: NONE`;
- 0 clashes and 25 review-required penetration proposals.
