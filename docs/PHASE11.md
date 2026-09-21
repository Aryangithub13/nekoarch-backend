# Phase 11 — Independent Blueprint QA and Architectural Rule Engine

## 1. Implemented

Added `@designflow/blueprint-qa`, a pure synchronous `Building Model V2 → BlueprintQaReport` package. It independently audits identity/references, levels, declared site bounds, space geometry, walls and topology, doors/windows/passages/service openings, dimensions, plates, columns, straight stairs, landing access, circulation, supported collisions and versioned caller policies. It returns PASS / PASS_WITH_WARNINGS / FAIL with stable machine-readable evidence and explicit per-stage coverage.

Baseline was verified before edits: clean `main`, HEAD and `backend-v1-phase10-complete` both `875bc45a97ec93bcc3fbbf00d80e990918789e76`, empty `git diff backend-v1-phase10-complete...HEAD`. No reset, commit or tag was created.

## 2. Independence architecture

```text
@designflow/shared (V2 schema contracts and exact polygon predicates)
       ↑                            ↑
@designflow/generator       @designflow/blueprint-qa
       └──── test fixtures only ─────┘
```

Production QA imports neither the generator nor its diagnostics/validation/circulation/solver. It never calls V2's whole-model invariant validator, model-level measurements, dimension resolution, `wallSpaceIds`, or dimension reconciliation functions. It reconstructs those facts locally. Zod shape parsing produces a fresh model; no writes occur to caller objects. Per-audit maps/sets stay private and are converted to arrays in reports.

Precisely reused Phase 9 runtime primitives:

| Primitive | Why shared reuse preserves independence |
| --- | --- |
| `BuildingModelShapeSchema` | Existing V2 field/unit/entity/polygon/void contracts only; does not execute document-level invariants or Phase 10 decisions. Newly exposed via an additive export. |
| `EntityIdSchema`, `LengthMmSchema` | Rule/options IDs and integer engineering-unit bounds; no correctness claims about generated geometry. |
| `MAX_MM` | Published coordinate envelope, used to check derived vertical/anchor coordinates. |
| `cross`, `onSegment` | Exact BigInt collinearity and interval predicates, used in independently implemented interval unions. |
| `pointLocation`, `segmentsCross` | Generic exact polygon interior/crossing tests for detecting walls through spaces. |
| `segmentInRing` | Generic complete-edge containment, including concavities; used for centerlines and full-width landing contact. |
| `ringContains`, `ringsOverlap` | Generic exact polygon containment and positive-area overlap; legal boundary-only contact is preserved. |
| V2 TypeScript types | Compile-time contracts only. |

The shape schema internally uses V2 ring/footprint primitives for simple positive-area polygons and valid voids. QA independently implements shoelace area accumulation, exact decimal area formatting, integer wall-root rounding, squared host bounds, wall physical faces in doubled coordinates, boundary interval unions, dimension anchor resolution and chain arithmetic. No generator ID or room naming convention is present in production.

The AST boundary test permits only QA-local imports, Zod and a named allowlist of shared primitive imports. It rejects generator/model-decision imports and dynamic import/require/eval escape routes. Package dependencies are asserted separately.

## 3. QA pipeline

1. Bounded plain-JSON preflight, options/rule-pack validation.
2. V2 shape validation, including primitive geometry and door operation metadata.
3. Independent document identity, references and completeness.
4. Levels/site → spaces → walls → openings → dimensions → slabs/columns.
5. Stair rise/run/footprints/landings/voids/interference and valid vertical edges.
6. Independent circulation graph; explicit entrance policy and optional required reachability.
7. Versioned policy rules; no implicit legal or room-size defaults.
8. Stable sorting/de-duplication, summary/status calculation and runtime report validation.

Invalid primitive shapes stop before semantic computations. Duplicate IDs and legacy planar documents stop after integrity findings. Other semantic defects are isolated where possible; invalid openings/stairs cannot create graph edges. Resource exhaustion marks partial coverage and returns FAIL, never a partial PASS.

## 4. QA report model

- Version: `qaVersion: blueprint-qa-v1`; validated models identify `modelSchemaVersion: 2`; packs and rules carry separate versions.
- `inputStatus`: SCHEMA_INVALID / SCHEMA_VALID / NOT_EVALUATED. SCHEMA_VALID can still have FAIL architectural status.
- `status`: any ERROR → FAIL; otherwise any WARNING → PASS_WITH_WARNINGS; otherwise PASS. INFO does not alter status.
- `summary`: exact severity and rule outcome counts. Runtime refinements verify counts and status agree.
- Findings: stable `QA_*` code, severity, category, message, sorted `entityIds`, optional field `reference`, expected/actual values, evidence, optional rule/pack IDs.
- Deterministic ordering: ERROR, WARNING, INFO; then code, entity IDs and deterministic serialized tie-break. Identical findings are de-duplicated. Measurements sort by entity ID; rule results sort by pack/rule/entity.
- Measurements include exact JSON-safe decimal mm² strings, integer lengths/elevations, anchor segment arrays and exact deltas. No BigInt, Sets, Maps, classes, timestamps or functions escape.
- `coverage` records EVALUATED / PARTIAL / NOT_EVALUATED for each stage, with scope notes. `assumptions` state centerline/GFA/solid/point-anchor conventions.
- `circulation` exposes nodes, independently derived edges with supporting entity IDs, supplied entrances and reached/unreached spaces. Missing entrance policy leaves `evaluated: false`.

## 5. Core integrity checks

| Domain | Implemented evidence/checks |
| --- | --- |
| Spaces | Shape-valid simple nonzero polygons; exact centerline areas/spans; level containment; duplicate/overlapping interiors vs legal touching boundaries; single supplied floor-plate outer containment. |
| Walls | Complete construction properties; centerline/vertical extents; own geometric space adjacency vs stored references; exterior walls dividing two spaces; coincident/contradictory intervals; parallel-solid collisions; centerlines crossing room interiors; physical permitted-site containment. |
| Wall network | Centerline endpoint/T contacts, isolated fragments and gaps in partially represented space edges. Intent-dependent fragment/gap findings are warnings. Ordinary T-junction thickness overlap is permitted. |
| Dimensions | Point, wall-end, space-vertex, opening-edge and level anchors; axis/level/range checks; positive ordered segments; exact controlling values, child counts/sums and deltas. Derived dimensions expose measured values without inventing a claimed value. |
| Doors/windows/openings | Host, level, complete wall geometry, exact squared horizontal fit, sill/top fit, horizontal AND vertical rectangle overlap, shape-validated operation/swing metadata; opening-local adjacency from actual intervals. |
| Circulation | Valid floor-level doors/passages only; windows/services excluded; explicit entrance spaces/openings; BFS reachability; required isolated rooms and wholly disconnected levels; no generator circulation claims. |
| Stairs | Positive endpoint level rise, every riser and sum, tread count/depth/run, rectangular direction/width/run footprint, both level envelopes, full-width correct-end landing contact, represented endpoint access and conservative obstructions. |
| Slabs/voids | Shape-valid simple plates/strictly contained disjoint voids, level and site containment, top/bottom range, same-kind plate overlap, destination flight void at endpoint elevation, intermediate plate blockage, landing/void overlap. |
| Levels | Unique index/elevation, ascending order, floor-to-floor agreement, coordinate range. |
| Columns | Footprint/site/level containment and vertical extent; flight obstruction; room-column policy only when explicitly requested. Ordinary columns in rooms are not silently declared illegal. |
| Site | Supplied site/buildable polygon containment; rectangular edge-indexed setback distances for every supported level/plate/wall solid/stair/column checked. No invented setback values or survey rotation. |
| Areas | Site/buildable, level envelope, space, plate net area/GFA, opening area and wall gross face area. GFA is sum of floor plate areas minus voids, per Phase 9's documented geometric convention. Conflicting floor plates produce null GFA. |

Physical wall faces use doubled integer coordinates, preserving odd-thickness half-mm positions. V2 level envelopes can describe centerlines, so QA does not invent a physical finished-face level-boundary convention. Physical wall solids are checked against the supplied permitted site/buildable region; wall paths remain checked against level envelopes.

## 6. Architectural rule engine

Policies are separate from mathematical integrity. Supported declarative rules: minimum centerline space area, minimum rectangular centerline x/z span, minimum modeled door width, maximum riser height, minimum tread depth, required windows, exterior windows, selected-space reachability and caller-designated column-free spaces.

Rules return PASS, FAIL, NOT_APPLICABLE or NOT_EVALUATED with measured/required evidence. Missing entrance, unsupported shape for a width rule, unavailable host geometry or inconsistent targeted geometry cannot become PASS. Rule severity controls failed-policy findings; NOT_EVALUATED adds a warning. Multiple packs retain distinct IDs/versions and may supply explicit entry IDs. Duplicate pack/rule identities are rejected.

Only the opt-in `designflow-product-defaults@1` demonstration pack is provided, using documented Phase 10 door width 900 mm and tread depth 280 mm as WARNING preferences. No rules are asserted to be law or complete ergonomic checks.

## 7. Mutation/adversarial evidence

All mutation tests assert the expected primary code. Core authored-fixture sabotage asserts shape validity separately and limits findings to fewer than 30; stair sabotage limits findings to fewer than 50. Exact 1 mm controlling drift produces exactly one finding when the declared chain remains internally consistent.

| Injected defect | Required detected finding |
| --- | --- |
| Controlling value ±1 mm; consistent but wrong chain | QA_DIMENSION_MISMATCH (exact delta) |
| Missing/duplicated child; reversed chain | QA_DIMENSION_CHAIN_RECONCILIATION / QA_DIMENSION_CHAIN_ORDER |
| Missing entity/vertex anchor; wrong axis | QA_DIMENSION_ANCHOR_UNRESOLVED / QA_DIMENSION_AXIS |
| Overlapping/duplicate room; room outside level | QA_ROOM_OVERLAP / QA_SPACE_OUTSIDE_LEVEL |
| Duplicate/conflicting wall; wall through rooms | QA_DUPLICATE_WALL / QA_WALL_INTERVAL_OVERLAP / QA_WALL_INTRUDES_SPACE |
| Wrong stored adjacency/exterior classification | QA_WALL_SPACE_RELATIONSHIP / QA_WALL_CLASSIFICATION |
| Physical wall outside by 1 mm or 0.5 mm | QA_OUTSIDE_BUILDABLE_BOUNDARY |
| Door beyond host; missing host; wrong level | QA_OPENING_OUTSIDE_HOST / QA_OPENING_HOST_MISSING / QA_OPENING_LEVEL_MISMATCH |
| Overlapping doors/door-window; window top too high | QA_OPENING_OVERLAP / QA_OPENING_ABOVE_HOST |
| Wall made shorter than opening | QA_OPENING_ABOVE_HOST |
| Deleted room door; window/service substituted | QA_UNREACHABLE_SPACE; no false circulation edge |
| Riser sum ±1 mm; wrong run/footprint/direction | QA_STAIR_RISE_MISMATCH / QA_STAIR_RUN_MISMATCH / QA_STAIR_FOOTPRINT_MISMATCH / QA_STAIR_LANDING_GEOMETRY |
| Wrong/missing stair level pair; changed level elevation | QA_STAIR_LEVEL_PAIR / QA_LEVEL_HEIGHT_MISMATCH |
| Deleted/moved upper void; shifted upper plate | QA_STAIR_VOID_MISSING; plate blockage where applicable |
| Deleted landing/door; wrong landing offset | QA_STAIR_LANDING_INACCESSIBLE / QA_STAIR_LANDING_ELEVATION |
| Stair removed; column blocking flight | QA_DISCONNECTED_LEVEL / QA_STAIR_COLUMN_COLLISION |
| Invalid column/slab extents, overlapping slabs | QA_COLUMN_OUTSIDE_LEVEL / QA_SLAB_OUTSIDE_LEVEL / QA_SLAB_OVERLAP |
| Declared setback violation | QA_DECLARED_SETBACK_VIOLATION |
| Wall fragment/partially walled edge gap | QA_DISCONNECTED_WALL_FRAGMENT / QA_WALL_BOUNDARY_GAP warnings |
| Zero wall/area, crossed polygon, bad sill/swing, crossing/overlapping voids | QA_SCHEMA_INVALID with field reference; semantic stages not executed |

Additional tests cover malformed JSON documents, unsupported/incomplete input, accessor/cycle rejection, identity ambiguity, resource budgets/output caps, missing entrance, missing occupancy, missing site/floor, nonrectangular setback coverage, all rule outcomes/severities, multiple packs, JSON round trips, frozen input, stable ordering and real concurrent workers.

## 8. Phase 10 differential verification

Six successful original golden cases (including compact-wide, two-floor and odd-mm replay) are generated then independently audited. Tests compare QA's dimensions against both emitted controlling values and Phase 9 measurements; compare GFA, every space area and wall length; and compare rebuilt reachable nodes and envelope-area sums against producer diagnostics only in tests.

The fixed corpus includes 48 seeds with translated/odd-mm envelopes, one/two levels, differing room counts, wall thicknesses, storey heights and optional windows. Every result must pass V2 schema and return zero QA findings. A separate supported 24-room/two-storey case exercises larger geometry without a fragile time assertion. Poisoning diagnostics leaves the report unchanged. Hand-authored fixtures with unrelated IDs/classifications prove the engine does not require generated documents; all Phase 9 fixtures also exercise the public boundary.

## 9. Files added

- `packages/blueprint-qa/package.json`, `tsconfig.json`, `README.md`.
- `src/index.ts`, `audit.ts`, `report.ts`, `options.ts`: public API, boundary, schemas, versions, statuses and deterministic finalization.
- `src/context.ts`, `geometry.ts`: per-call state, budget, independent measurement and interval math.
- `src/core.ts`, `dimensions.ts`, `openings.ts`, `stairs.ts`, `circulation.ts`, `rules.ts`: audit domains and policy engine.
- Six test files plus `tests/fixtures.ts`: 177 new tests.
- `docs/PHASE11.md`: implementation, verification and coverage manifest.

## 10. Every baseline file modified

| Existing file | Reason |
| --- | --- |
| `packages/shared/src/building-v2/index.ts` | Additive public export of existing `BuildingModelShapeSchema`, so independent QA can separate shape parsing from its own semantic checks. No schema or invariant behavior changed. |
| `package.json` | Register QA workspace; build it in build/typecheck/test/unit; add dedicated QA test command. |
| `package-lock.json` | QA workspace link/dependencies only; no external version changes. |
| `tsconfig.json` | Include QA tests in root typecheck. |
| `vitest.config.ts` | Include QA suite in default tests/check. |
| `.github/workflows/backend-ci.yml` | Explicit blueprint and QA test gates, in addition to existing unit/integration gates. |
| `Dockerfile` | Copy QA manifest/source into workspace install/build and include built QA package in runtime. |

No Phase 5–10 algorithms, generator source/tests, model definitions, existing endpoints, database tables or migrations were changed. No previous-phase bug fix was needed.

## 11. Test counts

New QA tests: **177**, in six files (57 audit, 29 circulation/stairs, 58 differential, 17 geometry/coverage, 15 rules, 1 dependency boundary). Existing default tests: **1,248**. Final default suite: **1,425**. Dedicated local Supabase acceptance: **4**, separate from the default suite; total distinct verified tests including it: **1,429**. Generator and blueprint commands are overlapping subsets, not additional counts. Unit command includes **1,372** tests; integration command includes **51**; two existing PostgreSQL harness tests run through the full check.

## 12. Verification

Final results are recorded after execution below. Local PostgreSQL integration requires local socket permissions; the initial sandbox run could not bind `127.0.0.1` (`EPERM`). The same unchanged suites were rerun with local socket access. Local Supabase uses the already-running local stack via the existing helper, which invokes `npm run test:supabase` with CLI-discovered local keys held only in process memory. No database reset or remote Supabase operation was performed.

| Command | Result |
| --- | --- |
| `npm run build` | See final verification record |
| `npm run typecheck` | See final verification record |
| `npm run lint` | See final verification record |
| `npm run test:unit` | See final verification record |
| `npm run test:generator` | PASS — 461 tests |
| `npm run test:blueprint` | PASS — 137 tests |
| `npm run test:blueprint-qa` | PASS — 177 tests |
| `npm run test:integration` | PASS — 51 tests, after local socket access |
| `npm run test:supabase` via `node scripts/test-local-supabase.mjs` | PASS — 4 live local tests |
| `npm run check` | See final verification record |
| `docker build -t designflow-api:phase11 .` | See final verification record |
| `node scripts/smoke-container.mjs designflow-api:phase11` | See final verification record |
| `git diff --check` | See final verification record |

## 13. Sample QA results

These are concise projections from actual hand-authored-fixture reports. Full API results additionally include all measurements, coverage, assumptions, graph edges and rule results.

Valid:

```json
{
  "qaVersion": "blueprint-qa-v1",
  "modelSchemaVersion": 2,
  "inputStatus": "SCHEMA_VALID",
  "status": "PASS",
  "summary": { "errors": 0, "warnings": 0, "info": 0, "rulePass": 0, "ruleFail": 0, "ruleNotApplicable": 0, "ruleNotEvaluated": 0 },
  "findings": [],
  "measurements": { "grossFloorAreaMm2": "48000000", "chain": { "overallMm": 8000, "segmentsMm": [4000, 4000], "deltaMm": 0 } },
  "circulation": { "evaluated": true, "reachableSpaceIds": ["foyer", "studio"] },
  "rulePacks": []
}
```

Corrupted controlling chain (declared total and child segments both increased by 1 mm, geometry unchanged):

```json
{
  "qaVersion": "blueprint-qa-v1",
  "modelSchemaVersion": 2,
  "inputStatus": "SCHEMA_VALID",
  "status": "FAIL",
  "summary": { "errors": 1, "warnings": 0, "info": 0, "rulePass": 0, "ruleFail": 0, "ruleNotApplicable": 0, "ruleNotEvaluated": 0 },
  "findings": [{
    "code": "QA_DIMENSION_MISMATCH", "severity": "ERROR", "category": "dimensions",
    "entityIds": ["chain"],
    "message": "Controlling dimensions disagree with independently resolved anchor geometry.",
    "expected": { "overallMm": 8001, "segmentsMm": [4000, 4001] },
    "actual": { "overallMm": 8000, "segmentsMm": [4000, 4000] },
    "evidence": { "deltaMm": -1, "axis": "x", "anchorCoordinatesMm": [0, 4000, 8000] }
  }]
}
```

## 14. Coverage manifest

**Verified when represented and supported:** integer dimensions and chains, exact polygon areas, primitive polygon/void validity, reference integrity, centerline space overlap/containment, wall interval/network evidence, orthogonal wall permitted-site solids, hosted opening fit/collision, independent door/passage/stair graph, supplied entrance policy, level/stair arithmetic, straight-flight footprint and landings, represented access/void correspondence, listed conservative collisions, rectangular declared setbacks, configured versioned policies.

**Explicitly not verified:** structural safety/sizing, foundations/soil, seismic/wind performance, fire/egress compliance, electrical/plumbing design, municipal approval, NBC/BIS or other legal compliance, professional certification, furniture/swing clearance, door hardware clear width, measured stair headroom, detailed tread solids, watertight CAD solids, arbitrary full 3D boolean collisions, construction quantities, BOQ or costs. No “zero error”, construction-approved or architect-certified result exists.

## 15. Known limitations

- V2 point anchors reference explicit points, not an envelope/stair entity. QA measures them exactly but cannot infer that moving two consistent point anchors falsifies a particular building-wide intent. Entity-bound anchors and stair geometry are independently checked where represented. QA does not invent missing dimension segments absent any represented anchor/constraint claim.
- Space spans/areas are centerline measurements, not finished clear dimensions. Minimum-span policies are limited to rectangular spaces.
- Physical walls and opening-topology reconstruction support orthogonal hosts. Diagonal centerlines, length and squared host bounds are checked, while physical-footprint/topology coverage is reported partial. Noninteger diagonal length-derived wall face areas use the explicitly labeled rounded length convention.
- Wall fragments and partially represented edge gaps are warnings because freestanding/open-plan intent is not encoded. QA checks represented contacts and interval consistency, not enclosure completeness, arbitrary near-junction intent or watertight joints.
- A stair's conservative full-flight envelope must be unobstructed. No stepped-volume/headroom analysis or ergonomic rule is inferred. Unique containing endpoint spaces and represented landings are needed for vertical graph edges; stairwell access requires a real opening and contained unblocked projected approach. Stairs openly contained within another room need no invented door.
- Supplied single floor plate containment is checked. Multi-plate space support unions are reported unknown; ordinary room/void occupancy, finish-face wall clearance and arbitrary floor-support certification are not inferred. Columns may legitimately be inside rooms; column-free policies are explicit.
- Missing entrance/site/floor information, nonrectangular setback interpretation, uncertain exterior-window relationships and unsupported selected policies produce honest warnings/NOT_EVALUATED results.
- Dense or very large documents can hit deterministic JSON/geometry/output budgets and return a partial FAIL. Exact budget/complexity details are in the package README. Measurements on invalid documents are diagnostic facts, not certified construction quantities.

## 16. Deferred and stop

Phase 11 only. No QA persistence, plan-table changes, project history, HTTP orchestration, quantity takeoff, construction calculations, BOQ/cost engine, AI integration or frontend rendering. Likely next work is Phase 12 — native V2 persistence and project API. Verified jurisdiction packs, structural engineering, 2D/3D rendering and walkthrough/drone/360° remain later work.

Repository remains uncommitted and untagged for manual review. Completion commit/tag are deliberately left to the user.
