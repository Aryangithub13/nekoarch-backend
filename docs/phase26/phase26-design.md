# Phase 26 design — building systems coordination V1 (bounded)

**MEP coordination ≠ complete engineering design. Life-safety geometry ≠ fire-code certification. Elevator planning ≠ elevator engineering certification.**

This layer is deterministic and revision-bound. Its results are a derived overlay: the accepted architecture is never rewritten. Every value is in one of these states:

- MEASURED/CALCULATED from explicit geometry;
- USER_PROVIDED;
- ASSUMED, by a named convention;
- NOT_EVALUATED;
- UNSUPPORTED.

Every certification is `NOT_CLAIMED`.

## 1. Pipeline

```
accepted revision ─► Phase 23 BIM (readBim, unchanged)
  + optional Phase 24 structural snapshot (explicit structuralAnalysisId, same revision)
  + optional Phase 25 environmental snapshot (explicit environmentalAnalysisId, same revision)
  + explicit building-systems input
  ─► buildSystemsModel            (systems/model.ts: binding, terminals, obstacles, exits, requests)
  ─► validateSystemsModel         (systems/validate.ts, independent)
  ─► resolveAnalysisInput         (preflight: grid sizes, search budget, clash pairs → BUILDING_SYSTEMS_RESOURCE_LIMIT)
  ─► adapter.analyze              (nekoarch-reference-systems 1.0.0: elevators → networks → egress → clashes)
  ─► validateRawOutput            (untrusted: schema, identity, input hash, inventories)
  ─► validateSystemsResults       (independent recomputation of every critical value)
  ─► signed immutable snapshot    (migration 0016)
```

GET routes only read stored rows. Nothing is calculated lazily.

## 2. Versions

These literals all participate in the input hash:

| Name | Literal |
|---|---|
| Input | `building-systems-input-v1` |
| Model | `building-systems-model-v1` |
| Analysis | `building-systems-analysis-v1` |
| Adapter | `building-systems-adapter-v1` |
| Model validator | `building-systems-validator-v1` |
| Result validator | `building-systems-result-validator-v1` |
| Router | `orthogonal-hanan-dijkstra-v1` |
| Router weights | `routing-weights-v1` |
| Egress convention | `egress-l1-geodesic-v1` |
| Clash geometry | `envelope-box-v1` |
| Plumbing | `plumbing-coordination-v1` |
| Electrical | `electrical-coordination-v1` |
| HVAC | `hvac-coordination-v1` |
| Life safety | `life-safety-geometry-v1` |
| Vertical transport | `vertical-transport-v1` |
| Coordination | `coordination-clash-v1` |

## 3. Binding

```
binding = BIM binding (projectId, revisionId, modelHash, generatorVersion, generationId, requirementsHash, parameterHash)
        + bimVersion + systemsModelVersion
        + structural:    { analysisId, inputHash, modelVersion } | null
        + environmental: { analysisId, inputHash, modelVersion } | null
```

Upstream artifacts are named only by explicit id. There is never a "latest" lookup. The service reads them through the existing revision-scoped RPCs, so another revision's analysis returns 404. The SQL write recomputes everything server-side and accepts nothing from the client:

- the architecture binding, as in Phase 24 and 25;
- the existence of every upstream row in **the same revision**;
- each upstream row's `input_hash`.

## 4. Inputs (all explicit; nothing inferred from names or locale)

Each discipline section is optional. When it is `null`, that capability is `NOT_EVALUATED` and is reported as such; nothing is silently omitted.

**Terminal locations.** Every terminal names a `spaceId` and gives a plan point `{x, z}` (integer mm) or `null`, plus an elevation relative to its level. A `null` point makes the discipline `INPUT_INCOMPLETE`; coordinates are never fabricated. The point must lie inside its space.

**Routing elevations** are given per network and per level. A missing elevation is `INPUT_INCOMPLETE`, because no plenum height is invented. Sanitary drainage takes a band `{ topMm, bottomMm }` per level instead.

**Sizes.** A round `diameterMm` or a rectangle `widthMm × heightMm`. With no size, geometry is centerline-only and clearance is `CLEARANCE_NOT_EVALUATED`.

**Clearances** are given per discipline, `{ value, unit: 'mm', provenance }`. With no clearance, only physical intersection is tested and the check is labelled `CLEARANCE_NOT_EVALUATED`. No default clearance exists.

**Plumbing:**

- fixtures with kind, space, connection point/elevation and services (`COLD_WATER`, `HOT_WATER`, `SANITARY`);
- cold and hot sources;
- a sanitary outlet with an invert elevation;
- a minimum slope as an exact ratio `{ rise, run }` of positive integers (1:40 = `{1, 40}`);
- optional diameter metadata.

**Electrical:**

- supply `{ systemVoltage V, phaseSystem, frequencyHz Hz, point }`. Any missing part makes electrical `INPUT_INCOMPLETE`; voltage, phase and frequency are never assumed.
- panels, circuits (`panel → loads`);
- loads in W or VA, with an optional phase and an optional explicit demand factor.

**HVAC:**

- equipment points;
- supply, return and exhaust systems with terminals, explicit airflow (L/s or m³/s) and an explicit duct section.

**Life safety:**

- exits, either `SITE_PRIMARY_ENTRY` (the architecture's own semantic) or an explicit opening list;
- explicitly obstructed openings.

Exits are never inferred from exterior doors, and a window is never an exit.

**Vertical transport:**

- elevator requests: served levels, inside shaft dimensions, a door side and width, and placement `FIXED { origin }` or `PLANNER_SELECTED`;
- cabin, pit, overhead, capacity and speed, each optional and otherwise `NOT_SPECIFIED`.

## 5. Geometry conventions

**Plan geometry.** Exact integer mm in the building frame (`x-right-y-up-z-depth`). Elevations are absolute `y` in mm.

**Architecture obstacles** (per level, as boxes):

- stair flights, from the source floor up to the destination floor;
- slab voids;
- wall bands: the centerline ± half the thickness over the wall's height. Crossing one is a penetration; running inside one is forbidden;
- the level boundary, which a route may not leave.

**Structure.** This applies only when a Phase 24 snapshot is bound. Each member with a `RECTANGLE` section becomes a box: the analytical axis ± max(width, depth)/2 in every transverse direction (`CONSERVATIVE_SQUARE_ENVELOPE`), because the physical offset from the analytical axis is not specified. A `GENERIC` section has no dimensions, so its clash status is `NOT_EVALUATED` and it is listed for review. Without a structural snapshot, every structural check is `NOT_EVALUATED` and `STRUCTURAL_CLEARANCE_VERIFIED` is never claimed.

**Service geometry** (`envelope-box-v1`). Every route segment is axis-aligned. Its box is the segment ± its half-size: a round pipe becomes the circumscribed square, which is conservative.

## 6. Router (`orthogonal-hanan-dijkstra-v1`)

The router works per network over all of that network's levels.

**1. Grid.** The coordinate set is the union of:

- level boundary vertices;
- inflated obstacle bounds (obstacle ± the service half-size + clearance);
- wall-band bounds;
- terminal and root coordinates.

Nodes are grid intersections inside the level boundary and outside every inflated hard obstacle. Shortest rectilinear paths among rectilinear obstacles lie on this Hanan grid, so no length is lost to discretisation.

**2. Edges.**

- *Horizontal edges* run between consecutive grid nodes, at the network's elevation on that level. An edge whose midpoint lies inside a wall band must be perpendicular to the wall (a crossing); running along the wall inside its band is forbidden.
- *Vertical edges* join the same plan point on adjacent levels. The point must be:
  - inside the upper floor plate and outside its voids;
  - outside stair flights, wall bands, structural envelopes and elevator shafts.

**3. Cost** is an integer in mm-equivalents (`routing-weights-v1`, defined once in `contracts.ts`):

```
length + 1500·bends + 3000·wallCrossings + 6000·levelTransitions
```

A vertical transition also crosses a slab. Validity is a hard constraint, so an invalid route can never win on score. Ties break canonically on `(cost, nodeIndex, direction)`, where node indices are ordered by `(level, x, z)`.

**4. Network topology (sequential Steiner heuristic).** Each terminal, in canonical key order, joins the nearest node of the network built so far; the network starts as the root. Shared runs therefore form trunks and stacks: every upper-floor sanitary fixture joins the first stack. A multi-target Dijkstra is used.

**5. Ordering between networks.** Networks route in a fixed order:

- elevator shafts first (as obstacles), then sanitary;
- then HVAC supply, return and exhaust;
- then cold and hot water;
- then the electrical feeder and circuits by key.

Each network treats every earlier network's boxes, inflated by the larger explicit clearance, as hard obstacles wherever their vertical extents overlap. Remaining conflicts, such as FIXED routes, are reported by the clash pass.

**6. Failures.** When no path exists the network is `ROUTE_NOT_FOUND` (`SYSTEM_ROUTE_NOT_FOUND`). An infeasible gravity route is `ROUTE_INVALID` (`SYSTEM_ROUTE_INVALID`). Either makes its discipline `PARTIAL`; there is never a 500 and never an arbitrary connection.

**7. FIXED routes.** A user may fix a network's polylines. They are checked and clash-tested but never rerouted. FIXED is not supported for sanitary drainage in V1.

## 7. Plumbing (`plumbing-coordination-v1`)

**Supply.** Cold and hot water are networks rooted at their sources. They report connectivity, route geometry, length and countable bends. `HYDRAULIC_SIZING`, pressure, pump, tank, demand, friction loss and diameter selection are all `NOT_EVALUATED`.

**Sanitary drainage.** The plan tree is routed to the outlet, then inverts are computed from the leaves downward in exact rational arithmetic, `y·run`:

- a fixture starts at min(its connection elevation, the top of its level's band);
- a horizontal run drops `length·rise/run`;
- a junction takes the minimum of its arriving inverts;
- a stack drop lands at min(arriving invert, the top of the lower level's band).

The route is feasible only if:

- every horizontal invert stays at or above its level's band bottom;
- the invert arriving at the outlet is at or above the outlet invert.

Otherwise it is `ROUTE_INVALID`. Drainage is never pressurised, and no uphill segment can arise. Stacks are reported as the vertical runs (`{ point, levels }`). This is geometric coordination, not drainage-code compliance.

## 8. Electrical (`electrical-coordination-v1`)

- **Connected load:** an exact sum of the explicit loads, using BigInt decimal arithmetic per circuit, per panel and in total. W and VA are never added together without a power factor, so a mixed total is `NOT_EVALUATED`.
- **Demand load:** Σ Pᵢ·fᵢ, only when every load in the group has an explicit factor. There is no silent diversity.
- **Routing:** each circuit is routed load → panel, and the feeder is routed supply → panels, reporting length, level transitions and penetrations.
- **Not evaluated:** breaker, conductor ampacity, fault current, discrimination, earthing and code compliance.

## 9. HVAC (`hvac-coordination-v1`)

- **Networks:** supply, return and exhaust networks run from equipment to terminals.
- **Airflow and velocity:** the airflow on a segment is the sum of its downstream terminals' explicit airflows, computed exactly in m³/s. Velocity `v = Q/A` is calculated only when the airflow and an explicit duct section are both known (rectangle `w·h`, round `π·d²/4`).
- **Not evaluated:** duct pressure loss, fan, coil, chiller and AC capacity.
- **Phase 25 handoff:** a bound environmental analysis appears only as `referenceInputs.environmental` with `role: ENVELOPE_TRANSMISSION_COMPONENT` and `isDesignLoad: false`. It is never a heating or cooling design load.

## 10. Life-safety geometry (`life-safety-geometry-v1`, `egress-l1-geodesic-v1`)

**Independent graph.** The egress graph is built from the architecture alone; Blueprint QA results are not used. All coordinates are doubled, so door centres are exact integers.

- **Within a space:** the space's own Hanan grid, with the closed centerline polygon minus stair-flight and slab-void interiors. Distance is the rectilinear (L1) geodesic distance.
- **Between spaces:** only at the centres of floor-level doors and passages (sill 0, wall base 0) that are not explicitly obstructed.
- **Stairs:** link the midpoint of the flight's bottom edge to the midpoint of its top edge. Length = plan run, with rise and level transition recorded.
- **Exits:** designated openings only.

**Metrics per space:**

- reachability;
- the most remote grid point's shortest distance to the nearest exit, with the exact sequence of openings and stairs traversed and the number of level transitions;
- `disjointExitRoutes`: the number of node-disjoint routes to distinct exits, by unit-capacity max-flow over spaces.

**Dead ends.** `GEOMETRIC_DEAD_END_LENGTH` applies to circulation spaces (architectural classification `circulation`/`corridor`) that have exactly one connection in the circulation graph and contain no exit. Its value is the maximum geodesic distance from the space to that connection.

**Inventories** list door and passage widths and stair widths.

**Not evaluated:** limits, occupant load, sprinkler hydraulics, fire pumps, hydrants and smoke control. Results are measurements, never compliance verdicts.

## 11. Vertical transport (`vertical-transport-v1`)

The elevator is a **proposal**, and architecture is never mutated. For every served level:

- **Containment:** the shaft must lie inside the level boundary.
- **Blocking clashes:** the shaft must not overlap stair flights, landings or slab voids, and must not intersect a structural envelope over the served height (when structure is bound).
- **Space and walls:**
  - areas of overlapped spaces are reported exactly, by clipping the space polygon to the rectangle;
  - interior walls crossing the shaft are reported as `REQUIRED_ARCHITECTURAL_MODIFICATIONS`.
- **Door:** the door point just outside the chosen face must lie in a space reachable from a designated exit. That gives `VERTICAL_ACCESS_PATH_AVAILABLE`; without exits it is `NOT_EVALUATED`.

**Planner placement:** a deterministic search over origins aligned with architectural coordinates, sizes and door sides. Candidates are ranked by:

1. no blocking clash;
2. least overlapped non-circulation area;
3. fewest crossed walls;
4. shortest door-to-exit distance;
5. `(x, z, side)`.

A `FIXED` placement is never relocated.

**Not evaluated:** motor, ropes, traction, brakes, counterweight, rails, seismic, safety gear, waiting time, handling capacity and round-trip time. Accessibility is never claimed.

## 12. Coordination clash pass (`coordination-clash-v1`)

Exact box tests over every pair:

- route segments × other networks' segments;
- routes × structural envelopes;
- routes × stair volumes, elevator shafts and the outside of the level boundary;
- elevator shafts × structure and stairs;
- equipment and shafts × door openings and stairs (egress obstruction).

The clash types are:

- `MEP_ARCHITECTURE_CLASH`;
- `MEP_STRUCTURE_CLASH`;
- `PLUMBING_ELECTRICAL_CLEARANCE`;
- `DUCT_PIPE_CLEARANCE`;
- `DUCT_ELECTRICAL_CLEARANCE`;
- `SERVICE_CLEARANCE` (same-discipline pairs of different networks);
- `VERTICAL_TRANSPORT_CLASH`;
- `EGRESS_OBSTRUCTION`;
- `SHAFT_CONFLICT`.

The severity categories are:

- **`BLOCKING`**: a positive-volume intersection;
- **`REVIEW_REQUIRED`**: within an explicit clearance, or involving a structural host;
- **`INFORMATIONAL`**.

Every clash carries:

- discipline A/B and entity ids;
- the bounds of the intersection box;
- evidence (overlap per axis);
- resolution `UNRESOLVED`.

Severity never cites a regulation.

**Penetration proposals** are created for every wall crossing (within the wall's height) and every slab crossing. Each records its host and its route, location and size including clearance. Review status is `REVIEW_REQUIRED` for every proposal.

## 13. Trust and validation

**Model validator** (independent; imports only `contracts`, shared geometry and BIM core). It recomputes:

- the binding;
- the terminal/space containment and levels;
- the exits (an exterior floor-level door or passage);
- the inventories;
- the structural envelope inventory from the bound snapshot.

**Result validator** (independent). It recomputes:

- route continuity, axis alignment, endpoints at terminals and roots, and containment in the level boundary;
- obstacle intersections, with every unreported one rejected;
- exact lengths;
- penetrations;
- sanitary inverts, slopes and the absence of uphill runs (exact rationals);
- electrical totals (BigInt) and demand;
- airflow sums and Q/A;
- egress distances and paths, with its own grid and Dijkstra;
- dead ends and disjointness;
- elevator checks;
- the full clash set (its own box code);
- quantities, statuses and claims.

Calculator output is untrusted until both validators accept it.

## 14. Limits (`SYSTEMS_LIMITS`)

The limits were chosen from fixture measurements (`evidence/benchmark.json`) with headroom.

| Limit | Value | Basis |
|---|---|---|
| input bytes | 1 MiB | largest test input ≈ 20 KB |
| terminals | 500 | |
| networks | 64 | |
| panels | 64 | |
| equipment | 256 | |
| loads | 500 | |
| elevators | 4 | |
| grid nodes per network | 250 000 | maximum-24 with all terminals ≈ low thousands |
| search state expansions (all networks) | 20 000 000 | preflight: terminals × states |
| egress grid nodes | 50 000 | |
| clash pairs | 4 000 000 | preflight on segment counts |
| elevator candidates | 50 000 | |
| snapshot bytes | 9 MB | |
| calculation | 10 s | |

Predicted overflow is refused before any search starts, with `BUILDING_SYSTEMS_RESOURCE_LIMIT` (422).

## 15. Persistence and API

Migration `0016_building_systems_analyses.sql` mirrors `0015`. It adds one immutable table, `project_revision_building_systems_analyses`, with:

- nullable foreign keys to the structural and environmental analysis tables;
- owner-only RLS and no client writes;
- a signed `systems_write` that recomputes the binding and the upstream rows;
- advisory-lock convergence and idempotency receipts;
- `systems_read` (get/list/status).

Routes are under `/api/projects/:projectId/revisions/:revisionId/systems`:

- `POST /validate` builds and validates, and never calculates or persists;
- `POST /analyses` calculates and persists;
- `GET /analyses`, `GET /analyses/:analysisId` (with `?require=current` → 409 `SYSTEMS_RESULT_STALE` when stale), and `GET /status`.

Errors: `BUILDING_SYSTEMS_*`, `SYSTEM_*` and `SYSTEMS_RESULT_STALE`, all 422 except stale (409).

## 16. Determinism

The planner uses no `Math.random` and no `Date.now`, and all output collections are sorted canonically. The same revision, input, versions and weights produce the same model, routes, clashes and analysis-input hash; tests prove a byte-identical rerun.

## 17. Claims

| Claim | Status |
|---|---|
| `mepDesignComplete` | `NOT_CLAIMED` |
| `electricalSafety` | `NOT_CLAIMED` |
| `plumbingCompliance` | `NOT_CLAIMED` |
| `hvacSizing` | `NOT_CLAIMED` |
| `fireCodeCompliance` | `NOT_CLAIMED` |
| `lifeSafetyCertification` | `NOT_CLAIMED` |
| `accessibilityCompliance` | `NOT_CLAIMED` |
| `elevatorCertification` | `NOT_CLAIMED` |
| `buildingCodeCompliance` | `NOT_CLAIMED` |
| `professionalCertification` | `NOT_CLAIMED` |

These are constants written by the service, never by the calculator, and enforced again by a SQL check. MEP costing is `NOT_EVALUATED`, and Phase 13–15 reports are unchanged.
