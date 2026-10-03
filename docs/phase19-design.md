# Phase 19 — Precision Solver V2 design

Completion follow-up (2026-10-02): see [the final review report](phase19-review-report.md) and [verification manifest](phase19-verification.json). The `completion/` evidence supersedes failed or incomplete `resume/` gates. The final pass fixes the frontend lint blockers and API Docker packaging, adds separate live acceptance/benchmark evidence destinations, and preserves the solver implementation, V1 fixtures, dependency lockfile and all eleven migrations.

## Actual baseline and continuation plan

This session began on `main` at `094e6856a61abfeee78881dbc98fe34ef10eb970`, tagged `backend-v1-phase18-complete`, with existing uncommitted Phase 19 and unrelated web work. The earlier `phase19-baseline-analysis.md` describes an earlier inspection, not this session's clean-tree state. `phase19-evidence/resume/baseline.json` is the authoritative incoming inventory. The incoming modified/untracked files were saved to `/tmp/designflow-phase19-incoming.tar.gz`; no reset, stash, checkout, commit, tag, or history operation was performed.

Repository inspection found the native blueprint package, canonical Building Model V2, independent QA, signed revision RPCs, generation identity, orchestration, interpreter, and downstream calculation packages. Eleven immutable migration files implement the persistence/RLS contracts. The existing solver-v2 modules and optional site fields were unfinished local work; no V2 API route selection, regression suite, or accepted HTTP evidence existed. The untracked frontend and its dependency/workspace additions are preserved.

Implementation sequence: preserve baseline; complete explicit version selection and independent requirement audits; repair bounded search/evaluation; add shared real HTTP acceptance; run all regression/infrastructure commands; measure repeated workloads; document verified scope and unresolved blockers. No new runtime dependency or database migration is required.

## Selection, identity and integration

The existing `generateBlueprint` and default `generateBlueprintForVersion` remain V1. Project generation and workflow `source.requirements` opt into V2 **only by including `layoutV2: {}`**. Requests without it retain the historical V1 normalization, defaults, provenance and hashes. Unknown fields stay rejected. `layoutV2.version` normalizes to 2; generator provenance is `precision-blueprint-v2`, objective version is `precision-layout-score-v2`.

`SelectedBlueprintRequirementsSchema` normalizes the selected version. Requirement hashing excludes execution seed, includes the generator version and normalized architectural/scoring/search inputs. Revision model hashes include the optional site allocations but exclude provenance as before. Signed atomic revision writes, QA association, CAS, ownership, durable replay and historical reads keep their existing implementations. Workflow generation step/dependency versions are resolved per request; default capability metadata remains V1, and reuse retains the actual stored revision version. Planned roadmap capabilities remain planned.

Natural-language interpretation still produces V1 requirements and reports parking/daylight/ventilation as deferred. Modifying a V2 base through that V1 interpreter returns `V2_INTERPRETATION_UNSUPPORTED`, instead of stripping its solver-specific intent. Structured V2 modifications use the existing revision generation route.

## Geometry and supported scope

Coordinates remain integer mm in `x-right-y-up-z-depth`. Rings are implicitly closed: repeated final vertices, repeated points, retracing, zero area and self-intersections are invalid. Both winding directions are historically valid; V2 canonicalizes winding and the starting vertex. Setback edge references are remapped. BigInt predicates and area arithmetic use the existing shared utilities. There is no coordinate snapping.

Sites are simple orthogonal polygons with at most 32 vertices and 60000 mm coordinate span. L, U and other simple orthogonal shapes are represented as their true site polygons. Axis-aligned coordinate-cell decomposition yields up to 16 inscribed rectangular building envelopes, never a filled bounding rectangle across an excluded notch. Buildings do **not** have multi-wing footprints. Explicit buildable polygons must be contained in the site. Rectangular-site edge setbacks intersect the permitted region. Nonrectangular edge setbacks are rejected: provide an authoritative inset buildable polygon without edge declarations. Holes, curves, rotated/diagonal buildings and automatic irregular polygon offsets are unsupported.

One/two floors, at most 24 requested rooms, existing room categories, clear minima/areas, floor allocations and preferred dimensions are retained. Hard relationship components are assigned together; conflicting fixed floors fail early. Zone/relationship-informed orders and seeded alternatives feed balanced/unequal banks around a straight corridor, including one-sided banks. Room partition residuals reconcile in integer mm. Straight stairs explore front/center/rear positions in the existing core, with authoritative risers, run, both landings, landing doors and upper slab void. Dog-legged/L-shaped flights and more floors remain unsupported.

Optional site additions (`accessSide`, `primaryEntryOpeningId`, `parkingZones`) are absent from V1 output. Parking supports at most two rectangular direct-frontage conceptual bays, default 2500 × 5000 mm. Site/buildable containment, declared dimensions, footprint/bay non-overlap, frontage and direct pedestrian approach are checked. This is not a vehicle turning, pavement, gradient or parking-code design. Takeoff reports `parking_construction: NOT_EVALUATED`; construction propagates it and cost cannot report a complete total.

## Hard constraints and QA

Candidate construction, schema validation, exact wall/room/site checks, dimensions, stair coordination and entrance graph reachability precede scoring. Adjacency means positive shared boundary. `connected` requires a direct door or passage; `passage` requires a modeled passage opening. Corridor access alone does not satisfy either direct relationship. Each room has an actual corridor door.

`layoutV2.forbidPrivateThroughAccess` forbids bedrooms/studies as transit nodes while permitting them as destinations. This is configurable, not an inferred universal privacy rule. Optional `layoutV2.separations` specifies selector pairs, hard/soft strength, `minimumClearDistanceMm` and weight. Same-level separation is the minimum Manhattan distance between clear rectangles; different levels satisfy zoning separation, not acoustic or Euclidean distance certification.

Independent QA imports no generator placement/scoring routines. It reconstructs adjacency, traversable openings, stair links, room clearances from boundary walls, and separation distances. Doubled integer mm preserve odd wall half-thickness exactly. Project V2 commits supply hard room/floor/minimum/relationship/separation/privacy requirements to QA. Invalid or missing evidence fails acceptance. Solver metrics and client QA never authorize a write.

## Objective definition

Minimize a deterministic integer total after hard validity. Explicit objective weights are integers 0–10 (default 1), except fixed existing preference penalties. `ratio(a,b) = floor(1000*a/max(1,b))` using BigInt.

| Component | Definition |
| --- | --- |
| Relationships | 100000 per unmet soft direct/adjacent relationship |
| Separation | 10000 × pair weight per unmet separation preference; hard misses rejected |
| Preferred dimensions | 100 × sum ceil(abs(actual−preferred)/100 mm) |
| Front/rear | 10000 per miss relative to explicit access side |
| Cardinal exposure | 10000 × preference weight per missing requested exterior side |
| Circulation | Clear corridor area / total envelope area, permille |
| Privacy | Negative sum of normalized doubled Manhattan private-room-center distances from actual entry center, plus 250 per upper level |
| Wet services | Normalized same-level pair center distances plus upper/lower nearest wet-room distance and overlap deficit |
| Daylight potential | Negative sum of habitable-room exterior wall length / perimeter, permille |
| Ventilation potential | Negative 1000 per additional exterior side of habitable rooms |
| Room shape | Aspect-ratio penalty above 1.5, capped at 10000 per room |
| Utilization | Negative footprint / explicit permitted polygon area, permille |

The seven named objectives in `layoutV2.objectives` weight circulation, privacy, service clustering, daylight, ventilation, shape and utilization. Cardinal/separation preferences have individual weights. Equal totals compare deterministic construction JSON by code-unit ordering. Diagnostic evidence includes candidate component scores, winner, room zones, relationships, actual window IDs, facade sides/lengths, privacy distances, wet distances and vertical overlap. It is available in the library result and stored acceptance artifacts; the historical revision DTO does not persist a solver diagnostic report.

North 0 points world −z; positive angles rotate clockwise. Cardinal preference evaluation requires explicit quarter-turn north metadata. Other valid north angles remain metadata only. Daylight/ventilation values describe exterior opportunity, even when windows are disabled; listed window IDs separately report what exists. They do not establish dual operable openings, lux, daylight factor, ACH, climate, sun/wind conditions or compliance. Privacy is distance/zoning based, without bathroom sightlines or acoustic simulation; explicit separation preferences can group or distance supported room categories.

## Determinism, limits and failures

Seed PRNG is prefixed with V2 version. Normalized room, undirected relationship, separation and cardinal selector ordering removes incidental input order. Caller input is cloned by validation; fixed-input repeated and simultaneous worker executions are tested. V1 frozen model/metadata/hash fixtures are compared exactly.

Bounds: retained rectangles have both spans at least 2400 mm; 32 site vertices, 256 decomposition cells, 16 retained envelopes, eight floor/order rounds, 24 rooms, 48 relationships and 48 separations; default/max candidates 32/128 and charged operations 20000. Cell scans, envelope checks, ordering, allocation (including rejected allocation), candidate/entity counts consume bounded work. Geometry predicates and schema/QA work additionally have finite entity/vertex limits; the operation counter is not an instruction or CPU-cycle count. Search completion refers only to the scheduled retained family; not global optimality. A feasible best-so-far candidate can be returned with `searchComplete:false`; no feasible candidate yields a typed `SEARCH_LIMIT_EXHAUSTED` rather than a proof of impossibility. Clearly impossible area, setbacks and conflicting floor relations have actionable typed failures.

V2 has optional cooperative cancellation and a 1–30000 ms execution deadline; project generation uses 10000 ms. Deadline/cancellation throw `SOLVER_TIMEOUT`/`SOLVER_CANCELLED` without returning partial geometry. They do not enter model hashes or candidate scores. This synchronous solver checks between work stages; it cannot observe an abort event queued on the same blocked event loop until JavaScript yields. It is not a worker-isolated, hard preemptive HTTP cancellation implementation. A single bounded schema/geometry call may overrun a deadline until the next check. Candidate/geometry limits remain the primary deterministic resource bound.

## Compatibility and verification strategy

Required tests cover canonical sites, containment, exact totals, bad rings, all entrance sides, mandatory adjacency/openings, changed QA evidence, stairs/voids, separation/privacy, window evidence, deadline/cancellation, budgets, immutable inputs, concurrent worker repeatability, V1 snapshots/hashes, project/identity replay/security, and complete-building partial coverage. Shared HTTP acceptance runs against disposable PostgreSQL and local Supabase. `test:solver-v2` is in CI; its unit/integration files are also selected by the ordinary suites. Existing engines/migrations are preserved except additive QA/site support, explicit parking coverage, and default-preserving constructor/partition policy arguments. The architecture import allowlist adds exactly the V2 QA adapter and version-aware workflow planner; AI module import restrictions remain intact. Full command logs and repeated benchmarks are recorded separately; blocked or failing gates are never treated as passing.
