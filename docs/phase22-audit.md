# Phase 22 source audit and implementation matrix

Initial state: main, f39dbbc, backend-v1-phase21-complete; clean. No AGENTS.md found in the workspace or its ancestors. Migrations 0001–0012 are retained.

| Area / source | Reusable behavior | Incompatible assumption / extension | Verification |
|---|---|---|---|
| generator/generate.ts, invariants.ts | Frozen V1 Plan generation and fixtures | Metre rectangles tile one bounding box; leave unchanged | Existing generator/fixture tests |
| blueprint/input.ts, geometry.ts, layout.ts | Strict native room requirements, exact partitions, seeded ordering | One shared rectangular envelope; two rectangular banks; one straight corridor | Separate versioned allocator |
| solver-v2/input.ts, site.ts, topology.ts, evaluate.ts | Orthogonal validation, canonical ring ordering, bounded budgets | Inscribed rectangular envelopes even on L/U sites; score assumes rectangular spaces | Preserve V2 unchanged; explicit parametric selector |
| shared/building-v2 | Integer geometry, BigInt predicates, floor polygons, slab holes, entity references | No level hole topology; permits per-floor simple polygons already | Keep schemaVersion 2; optional versioned L parameter submodel, no holes except stair slab |
| blueprint/entities.ts | Wall interval splitting, opening jambs, straight stairs/landings | Exterior classification uses envelope extrema; floors/slabs/roof share rectangle | Explicit construction policy only for new solver; concave exterior classification and floor boundaries |
| blueprint/dimensions.ts | Exact controlling anchors | Overall dimensions use common rectangle; corridor vertices assumed rectangle | New derived dimension builder for parametric geometry |
| blueprint/validation.ts | Graph reachability, model invariants | Declared clear boxes assume every circulation space rectangular | Reuse graph, independently reconstruct room clearances and L corridor arms |
| blueprint-qa | Independent shape parsing, overlap, walls, hosted openings, stair void/access, door graph | Missing total floor coverage check; missing inter-floor support; open unwalled edge can remain warning | Versioned parametric audit reconstructs footprint, wall coverage, slab support, roof coverage, room program |
| quantity-takeoff | BigInt polygon area minus holes, per-level wall/opening/slab quantities | Wall segment prisms not boolean union; stairs are geometric quantities only | Hand-computed L slab and stair deductions; preserve partial categories |
| construction-calculations, boq-cost | Existing recipes, material provenance and rates | No certified structure, terrace/cantilever recipes | Existing floor/flat-roof categories; uncovered lower roof is not terrace; incomplete estimates remain explicit |
| project-service, generation-identity, project-repository | HMAC commits, canonical geometry hash, immutable revisions, CAS/idempotency | Dispatch/hash recognize V1/V2 only | Add explicit parametric version; real PostgreSQL revision/concurrency tests |
| workflows/planner, workflow-service | Version chosen from native requirements, accepted revision pipeline | Verify new version flows through existing source resolution | Full workflow integration |
| conversation-planner/contracts/routes | Exact proposal hashes, approval, native updates, base-revision conflict checks | V1/V2 solver enum and native update whitelist | Parametric solver state and typed native edits; narrow tested local text grammar |
| ai/orchestration | Provider/model/capability registry, privacy, budgets, bounded outputs | No geometry authority allowed | Preserve provider registries and strict geometry-free intent boundary |
| tests/scripts | Embedded PostgreSQL, local Supabase/RLS, frozen fixtures, Docker smoke, V2 benchmark | No parametric cases | New acceptance/adversarial/benchmark evidence plus existing regression gates |

Chosen scope: axis-aligned connected L with rectangular occupied rooms, an L circulation space, up to two nested L floors, aligned straight stair and exact slab void, disjoint exposed lower roof plates. Parameters have fixed integer-mm bounds; recomputation is a finite acyclic pipeline. U/courtyard/overhang/terrace/balcony/rotation requests remain unsupported. Rectangles continue using the historical engines. No engineering or BIM certification.
