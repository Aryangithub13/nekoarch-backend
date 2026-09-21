# Phase 10 — Precision Blueprint Engine

## Boundary and baseline

Implemented additively in `@designflow/generator`, under `src/blueprint`, on commit `4d95cf96c2f597654395546fa5bb4954dcae4dfc`, exactly the tag `backend-v1-phase9-complete`. The continuation review verified that HEAD matches the tag and its committed diff is empty, then resumed the existing Phase 10 working tree with explicit user authorization. No new package, V2 schema, precision system, endpoint, database migration or provider. Existing V1 generation, authentication, estimates and persistence remain unchanged.

Public entry: `generateBlueprint(requirements: unknown): BlueprintResult`. Runtime parsing uses `BlueprintRequirementsSchema`. Failures throw `BlueprintError`, consistent with the existing pure generator's error convention. `BlueprintResult` separates the V2 architectural document from bounded diagnostics. No timestamp or measured duration is included in deterministic output.

## Input

All geometry lengths are integer millimetres. Use Phase 9 `toMillimetres` at a display/input boundary if needed; the engine does not reinterpret raw numbers as metres. Input is strict: unsupported fields fail instead of being silently dropped.

```ts
import { generateBlueprint } from '@designflow/generator';
const blueprint = generateBlueprint({
  site: {
    boundary: [{ x: 0, z: 0 }, { x: 10000, z: 0 },
      { x: 10000, z: 12000 }, { x: 0, z: 12000 }],
    northMilliDegrees: 0,
  },
  floors: 2,
  rooms: [
    { type: 'bedroom', count: 3, level: 1, minWidthMm: 2800 },
    { type: 'living', count: 1, level: 0 },
    { type: 'kitchen', count: 1, level: 0 },
    { type: 'bathroom', count: 1, level: 0 },
  ],
  relationships: [{
    from: { type: 'kitchen', ordinal: 1 },
    to: { type: 'living', ordinal: 1 },
    strength: 'soft', kind: 'connected',
  }],
  seed: 'residence-example',
  solver: { maxCandidates: 32, maxIterations: 20000 },
});
```

- `site` reuses V2 Site fields while removing caller-controlled IDs/names. Its boundary, optional buildable boundary, north and optional survey reference origin retain V2 contracts. Setbacks specify an original boundary edge index and minimum mm. No municipal values are invented. The effective permitted rectangle is the intersection of the supplied buildable rectangle and all edge setbacks; it is emitted as the model's buildable boundary. Original site ring ordering is retained so edge references remain meaningful.
- Axis-aligned rectangles only, four vertices without a repeated closing point; arbitrary winding and translated coordinates are supported. A valid nonrectangular or rotated ring returns `UNSUPPORTED_GEOMETRY`; malformed rings return `INVALID_REQUIREMENTS`. Each site dimension is at most 60000 mm. No shape approximation occurs.
- `floors`: 1 or 2. Rooms support the existing generator classifications `bedroom`, `bathroom`, `living`, `kitchen`, `dining`, `study`. At most 24 requested rooms total. Infrastructure spaces are added as `circulation` and `stairwell`, using V2's existing extensible classifications.
- A room group specifies `type`, exact `count`, optional zero-based `level`, `minWidthMm`, `minDepthMm`, optional `minAreaMm2`, optional preferred width/depth, and optional front/rear position preference. Duplicate type/level groups fail. Different explicit levels or an automatic group of the same type are additive, not overrides. Ordinals are generated after canonical type/level ordering; a relationship selects a type and ordinal, never an entity ID.
- Explicit levels reserve their room counts first; automatic rooms go to the least-loaded floor by room count, ties to ground. This assignment is deterministic and does not move during search. It is not an area-balancing optimizer. Entirely empty requested floors still have circulation and a stair core.
- Relationship kind is `adjacent` (positive shared partition), `connected` (a direct door), or `passage` (a direct generic passage). It applies to the selected instances, not every instance of their types. Cross-level room adjacency is impossible; vertical access is through the stair.
- All counts, level assignments, minima, containment, clear corridor width, configured door geometry, and hard relationships are hard constraints. Room dimensions mean world-x width/world-z depth, regardless of corridor orientation. Soft relationships, preferred dimensions and front/rear positions contribute score and warnings. Front/rear is world z, independent of north metadata. North does not rotate the design.
- Optional `stair` configuration is legal only for two floors; two floors otherwise receive the documented default stair configuration.
- Unsupported requirements such as parking, exact total area targets, balconies, free-form zoning, entrance side selection and open-plan merging are not accepted. A `passage` can connect separately modeled kitchen/living spaces; it does not merge them or remove an entire wall.

## Effective defaults (configurable, not building-code rules)

| Input | Default |
|---|---:|
| Floors | 1 |
| Room minimum clear width / depth | 1800 / 1800 mm |
| Clear corridor width | 1200 mm |
| Floor-to-floor height | 3000 mm |
| Exterior / interior wall thickness | 200 / 100 mm |
| Floor and flat-roof plate thickness | 150 mm |
| Door width / height / jamb reserve | 900 / 2100 / 100 mm |
| Windows enabled | true |
| Window width / height / sill | 1200 / 1200 / 900 mm |
| Straight stair width / riser count / tread | 1000 mm / 16 / 280 mm |
| Minimum stair landing depth | 1200 mm |
| Candidate / iteration budget | 32 / 20000 |
| Seed | `blueprint-default` |

Wall thicknesses must be positive even integers, at most 1000 mm, so both faces remain on the integer grid. Floor height is 2400–6000 mm; plate thickness 50–500 mm. Stair count is 2–40; tread 100–600 mm. These are implementation bounds, not claims of regulatory or ergonomic suitability. Configured openings must fit the clear storey height. Landings may exceed their supplied **minimum** depth to fit the configured door plus jamb reserves. Assumptions report effective settings and default values.

## Staged solver

1. **Normalize** with runtime schemas; clone caller input; canonicalize group, relationship and setback ordering. Reuse V2 Site/length schemas and the V1 room-type enum without reusing the metre-based V1 layout contract.
2. **Build constraints**: validate the supported site subset, apply only supplied setbacks, reserve half the exterior wall thickness inside the physical footprint, expand room counts, and assign levels.
3. **Enumerate candidates**: eight seeded room permutations; both corridor axes; for one floor, all room bank split counts, balanced splits first. Two-floor candidates reserve one bank for a shared straight stair and allocate each floor's distinct rooms in the opposite bank. Ordering uses the existing local Mulberry32/FNV seeded abstraction and solver version.
4. **Allocate** a clear corridor and room banks. Bank widths satisfy all selected cross-axis room minima; minimum depth includes clear depth, minimum area divided by actual clear width, door access reserves, and wall face allowances. Distribute spare width/depth as exact integer remainders.
5. **Evaluate** hard adjacency and explicit soft scores. Construct walls and openings; reject candidates whose required entrance, room door, direct connection or stair access cannot fit. Derive the connectivity graph from the generated doors/passages and validated landing access.
6. **Select** the lowest-score constructible candidate, ties to earliest candidate index. Complete search means completion of this finite candidate family only. It never means global architectural optimality.
7. **Reconcile dimensions**, construct the final V2 dimensions, and check actual anchor measurements against all emitted controlling segments.
8. **Validate before return** with both `BuildingModelV2Schema` and `ArchitecturalBuildingModelV2Schema`, plus generator-specific clear dimensions, wall-solid containment/collisions, stair slab void and circulation checks. A newly generated result always has `completeness: architectural`.

Independent modules are `input`, `geometry`, `layout`, `entities`, `dimensions`, `validation`, and `generate`; `types` contains safe results/errors. No shared mutable solver or random state exists.

## Bounds, determinism and scoring

Hard maximum: 128 candidate attempts and 20000 allocation iterations, 24 requested rooms, two floors. One iteration is a candidate start or one room minimum allocation. All other loops are bounded by these input limits and entity counts; there is no recursive/backtracking search. Candidate construction ends immediately on a rejected stage. Results expose actual attempts, iterations, valid candidate count, selected candidate and search-complete status.

The same normalized input (including budgets), `precision-blueprint-v1` and seed produces byte-equivalent serialized results. The seed controls independent room permutations; some seeds can select the same geometry. Tie-breaking is explicit and uses earliest attempted index. Strings use ASCII ordering rather than locale-dependent sorting. There are no clocks, random UUIDs or uncontrolled random calls in production solver code. Performance is measured outside generation so it cannot alter reproducible results.

| Soft category | Penalty (lower is better) |
|---|---:|
| Each unmet soft relationship | 1000 |
| Each preferred width/depth deviation | ceiling(abs(actual clear mm − preferred mm) / 100) |
| Each unmet front/rear half preference | 100 |

No aesthetic, aspect-ratio, daylight, circulation-efficiency or utilization weighting is claimed. Every sacrificed soft preference produces a warning. A missing optional default window produces a warning without a score penalty. If the budget ends after finding valid geometry, return the best evaluated candidate with a search-limit warning. If none was found, return `SEARCH_LIMIT_EXHAUSTED`.

## Precision and physical geometry

The physical footprint equals the permitted rectangle. Its wall-centerline envelope is inset by half the exterior thickness on all sides. V2 spaces partition that centerline envelope. Their `boundaryBasis` remains `wall-centerline`; no new space schema or incompatible convention is introduced. Hard minima and `metadata.roomDimensions` use clear dimensions derived by subtracting the actual half-thickness at each bounding side. V2 room dimension objects deliberately measure centerlines and are not mislabeled as clear dimensions.

`reconcilePartition` sums integer minima, divides the remaining integer budget, and gives one leftover millimetre to each earliest segment until the remainder is exhausted. It then invokes Phase 9 `reconcileDimensions`. Negative remaining capacity rejects the candidate. For example 9001 mm divided over minima 3000/1200/4800 becomes 3001/1200/4800, never an approximate or hidden discrepancy. Stair risers use the same policy: 3001 mm across 16 risers gives nine 188 mm and seven 187 mm risers.

Axis-aligned dimension anchors have exact integer values. Chain dimensions include exterior half-thickness bands and all partition cut coordinates, so every segment sum equals the physical controlling footprint width/depth. Room and wall dimensions reference V2 vertices/endpoints. Opening offset chains reference their host ends and opening edges. Multi-floor elevations reference real levels; stair-run dimensions reference the solved flight corners.

## Architectural construction

- **Walls**: collect room/core/corridor boundary edges, split at all collinear endpoints, and emit each authoritative interval once with exact same-level topology. Classify perimeter walls as exterior and partitions as interior. Thickness, base 0, centerline convention and height (storey height minus plate thickness) are populated. Solver checks actual butt-ended wall prisms within the permitted boundary and against clear-space rectangles. Orthogonal junctions may have shared physical volumes; the engine does not compute union solids or miter meshes. This does not affect the integer space/chain accounting.
- **Doors**: one room-to-corridor door per requested room, one ground corridor entrance, optional requested room-to-room doors, and one landing access door on each stair level. Place centrally, clamped to actual perpendicular wall-face/jamb clearances. Doors have explicit host, level, offset, width, height, sill and schematic hinged operation. Opening rectangles cannot overlap. Swing obstacle simulation is deferred.
- **Windows**: independently switchable. Try one fitting exterior wall per requested room in stable order; use complete first-class V2 Window geometry. If no segment fits, report omission. No mandatory window/daylight rule is implied.
- **Circulation**: edges come from real doors/passages; windows never connect rooms. The only vertical edge connects the source and destination stair cores after checking actual door access at the bottom and top landing respectively. A deleted entrance, room door, stair or landing door is detected by tests. Stairwell nodes represent access to the flight, not a traversable upper slab over the void. All requested rooms, corridors and core access nodes must be reachable.
- **Stair**: one axis-aligned straight flight, matching level rise, width, run, per-riser heights and two endpoint landings. Run equals tread × (riser count − 1). Its footprint remains in the clear reserved stair core. The upper floor plate has a void equal to the entire flight footprint; landing footprints remain supported outside the void. The core can contain residual space around the flight. No headroom certificate or structural sizing is emitted.
- **Slabs**: one physical floor plate per storey, one flat roof associated with the top storey at its floor-to-floor offset. The upper floor's stair void is explicit; roof remains closed. Wall tops meet plate undersides. There are no synthetic beams, columns, ceilings or separate roof storeys.
- **3D / quantity readiness**: walls have thickness/height/base, openings have complete hosts and vertical extent, levels have exact elevations, floors/roof have physical thickness, stairs have rise/run/treads/landings. No meshes, rendering, construction quantity totals or structural design are produced.

## Utilization

Diagnostics report exact mm² for site, effective buildable region, physical footprint, summed storey envelopes, clear rooms, clear circulation, reserved clear stair cores, and walls/residual regions. The identity is:

`total envelope = clear rooms + clear circulation + clear stair cores + walls/residual`.

This is explicitly not net slab area or a statutory floor-area definition. Stair core area includes upper void/reserved regions; Phase 9 `grossFloorAreaMm2` separately deducts floor plate voids. Walls/residual is the complement of disjoint clear regions, not a wall-junction material quantity. This solver fills the permitted rectangle, so unused **buildable** area is zero; excluded plot/setback area remains visible through site vs buildable area. It does not force clear room utilization to 100%.

## Failures

| Code | Meaning |
|---|---|
| `INVALID_REQUIREMENTS` | Runtime schema/selection conflict, malformed site, outside buildable region |
| `UNSUPPORTED_GEOMETRY` | Valid but unsupported site shape or dimensions beyond solver envelope |
| `IMPOSSIBLE_LAYOUT` | No feasible layout in the fully explored supported family, or no usable permitted footprint |
| `UNSATISFIED_HARD_CONSTRAINT` | Exhausted family with unsatisfied required relationships |
| `STAIR_PLACEMENT_FAILED` | Exhausted family rejected by stair/core/landing placement |
| `DIMENSION_RECONCILIATION_FAILED` | Invalid or inconsistent controlling partition/dimension arithmetic |
| `BLUEPRINT_INVARIANT_FAILED` | Internal construction or final architectural validation fails |
| `SEARCH_LIMIT_EXHAUSTED` | Budget reached before any feasible candidate was found |

These are solver-family outcomes, not proofs that no possible architect-designed building could fit. Failure details contain bounded field paths, attempt counts and rejection-code counts, never arbitrary input dumps. Invalid hard requirements are never relaxed and requested room counts are never reduced.

## Tests and verification

Dedicated command: `npm run test:blueprint` (137 tests: all 127 pre-existing Phase 10 cases preserved, plus 10 continuation-review cases). Seven compact fixtures cover 1BHK, 2BHK, 3BHK, a wide compact plan, a two-floor plan, a hard impossible request and odd-millimetre replay. Facts are asserted rather than relying on full JSON snapshots: exact outer dimensions, requested room counts, wall-count relationships, door counts, levels, slabs and stairs.

The suite includes 32 successful fixed-seed property cases, strict runtime and unsupported-shape cases, malformed/conflicting constraints, min area/width/depth, physical thickness variants, openings, missing connectivity regressions, direct hard/soft relationships, exact dimension/area identities, odd stair rise, slab voids, level imbalance, explicit empty floors, minimum single-room and maximum 24-room cases, search budgets, scoring, deterministic replay, JSON roundtrip, frozen input, output isolation, Promise calls and actual parallel workers loading the source via the existing tsx dependency. A maximum-size solve has a generous 15-second regression ceiling, not a fragile timing benchmark.

The 10 additional cases cover cumulative room-count limits, unsupported buildable polygons, disjoint setback/buildable regions, mixed explicit/automatic same-type groups and selector ordinals, an unoccupied ground floor, rotated stair access and supported landings, custom odd stair dimensions, an exact minimum-area boundary and both coordinate-envelope extremes. A separate deterministic 500-input review probe varied plot dimensions, room counts/minima, wall thicknesses, corridor widths and doors: 148 succeeded and 352 returned bounded `SEARCH_LIMIT_EXHAUSTED` failures; none produced unexpected or invariant failures. A bounded search failure is not evidence of global geometric impossibility.

The pre-existing engine, fixtures, export and package script passed review without requiring source repairs. Only this documentation and the added regression cases changed during continuation.

## Verification results — 2026-09-21

| Required gate | Final result |
|---|---|
| `npm run build` | Passed, exit 0 |
| `npm run typecheck` | Passed, exit 0, including browser boundaries |
| `npm run lint` | Passed, exit 0 |
| `npm run test:unit` | 1195/1195 passed across 17 files, exit 0 |
| `npm run test:generator` | 461/461 passed across 8 files, exit 0 |
| `npm run test:blueprint` | 137/137 passed, exit 0 |
| `npm run test:integration` | 51/51 passed across 4 files, exit 0 |
| `npm run test:supabase` | 4/4 passed on each of three consecutive unchanged reruns, exit 0 |
| `npm run check` | Passed build/typecheck/lint and 1248/1248 tests across 22 files, exit 0 |
| `docker build -t designflow-api:phase10 .` | Passed, including production dependency pruning |
| `node scripts/smoke-container.mjs designflow-api:phase10` | Passed: non-root, live 200, unavailable-dependency ready 503, SIGTERM exit 0 |
| `git diff --check` | Passed |

The aggregate check includes 1195 unit cases, 51 integration cases and 2 existing harness regression cases. Supabase adds 4 separate acceptance cases. There are 137 Phase 10 tests added relative to Phase 9, of which 127 were already present and 10 were added during continuation. No existing tests were removed or weakened. Final runs have no skipped tests or unhandled test errors.

The initial sandboxed integration attempt could not bind a loopback listener (`listen EPERM`); its before-all failures prevented its 51 cases from running. The unchanged suite passed with approved local listener access. Live Supabase used the existing `scripts/test-local-supabase.mjs` wrapper, which invokes `npm run test:supabase` with local credentials held only in memory. Its first attempt returned 500 rather than 201 in the concurrent-idempotency acceptance case; the other three cases passed. Three subsequent complete unchanged runs passed. Phase 9 documents the same first-run symptom; its cause remains unestablished, and no persistence/API/test code was changed to hide it. Docker emitted the existing host legacy-builder warning and the lockfile's ESLint support warning. No completion tag or commit was created.

## Auditable generated example

The input example above (`seed: residence-example`, solver `precision-blueprint-v1`) produced:

| Fact | Exact value |
|---|---|
| Site and permitted footprint | 10000 × 12000 mm, no setbacks |
| Levels | Ground at 0 mm, upper at 3000 mm |
| Ground rooms | Living, kitchen, bathroom |
| Upper rooms | Three bedrooms |
| Each requested room, clear faces | 7200 × 3800 mm = 27360000 mm² |
| Other spaces | One corridor and one stair core per floor |
| Entities | 32 walls, 10 doors, 6 windows, 1 stair, 3 plates including roof, 78 dimensions |
| Search | 16 attempts, 112 iterations, 16 feasible candidates, candidate 0 selected, complete finite family |
| Soft score and warnings | 0; none |
| Measured solve duration | 58.86 ms for one local run; timing is excluded from deterministic results |

All six rooms have a hosted corridor door; a seventh door provides the ground entrance, an eighth directly connects kitchen and living, and two access the respective stair landings. All ten modeled spaces are reachable. Exterior walls are 200 mm thick, partitions 100 mm, and all walls have height 2850 mm with base offset 0. Doors are 900 × 2100 mm at sill 0; windows are 1200 × 1200 mm at sill 900, hosted on exterior walls.

Physical width reconciles as `200 + 1000 + 100 + 1200 + 100 + 7200 + 200 = 10000 mm` (exterior/core/partition/corridor/partition/rooms/exterior). Room-bank depth reconciles as `200 + 3800 + 100 + 3800 + 100 + 3800 + 200 = 12000 mm`. The actual emitted controlling centerline chains are:

- X: `100 + 1150 + 1300 + 7350 + 100 = 10000 mm`.
- Z: `100 + 3950 + 3900 + 3950 + 100 = 12000 mm`.

The stair ascends +z, connects level 0 to level 1, and has width 1000 mm, rise 3000 mm, run 4200 mm and tread 280 mm. Eight 188 mm and eight 187 mm risers sum exactly to 3000 mm; 15 treads × 280 mm = 4200 mm. Its flight occupies x=200…1200 and z=1400…5600; that same rectangle is the upper floor's void. The two landings occupy z=200…1400 and z=5600…6800 at their respective elevations, and remain outside the void.

The exact utilization identity is `164160000 rooms + 27840000 circulation + 23200000 reserved stair cores + 24800000 walls/residual = 240000000 mm²` across both floor envelopes. This includes reserved upper void area in the stair-core category and is not a construction quantity calculation.

## Change control and deferred work

Only two baseline files change: generator `src/index.ts` exports the additive engine; root `package.json` adds its dedicated test command. Existing schemas, unit utilities, V1 algorithms, APIs and tests are unchanged. All other source, test/fixture and documentation files are new. No Phase 9 defect or invariant relaxation was needed.

Known algorithm limitations: rectangles only; one/two floors; single straight stair; fixed room-count balancing for automatic level assignment; eight seeded permutations, two axes, fixed corridor-bank topology and no exhaustive optimization; no arbitrary entrance side/target-area optimization; even wall thicknesses; schematic door swing; default windows may be omitted; centerline V2 space measurements differ from clear dimensions; no material union at wall junctions; no independent code/regulatory, ergonomic, headroom or structural certification.

Stop at Phase 10. Defer **Phase 11 — Independent Blueprint QA + Architectural Rule Engine**. Also defer native V2 persistence/API integration, quantity takeoff, construction calculations, BOQ/cost V2, architectural AI interpretation, frontend 2D/3D, walkthrough/drone/360°, advanced stairs, structural engineering and AI provider integration. The implementation remains uncommitted for review; do not create the completion tag automatically.
