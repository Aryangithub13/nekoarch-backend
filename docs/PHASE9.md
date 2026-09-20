# Phase 9 — Architectural Building Model V2

Completed and verified on 2026-09-20 in `/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow`.

The initial working tree was clean. HEAD and `backend-v1-phase8-complete` both resolved to `908b64db4bba489b7193eba2aafbaa863c83f146`; their diff was empty. No other repository was used for Phase 9 implementation.

## 1. Implemented

An additive, browser-safe, modular Zod 3.25.76 Building Model V2 in `@designflow/shared`: explicitly versioned JSON; integer-millimetre geometry; site/levels/spaces/walls; first-class doors, windows and generic openings; stairs and landings; floor, ceiling and flat-roof plates; architectural columns; dimensions; specification references; technical provenance; typed cross-references; geometric invariants; deterministic measurements; serialization; and an explicit V1 adapter.

`BuildingModelV2Schema` validates both complete architectural entity geometry and explicitly incomplete `legacy-planar` imports. `ArchitecturalBuildingModelV2Schema` rejects planar imports. This distinction prevents consumers from treating unknown V1 construction dimensions as available 3D/quantity geometry.

The design findings were written to `docs/PHASE9-DESIGN.md` before implementation. The detailed public contract, examples and precision conventions are in `packages/shared/src/building-v2/README.md`.

## 2. Model architecture

| Model part | Representation and behavior |
| --- | --- |
| Site | Arbitrary simple polygon, optional buildable polygon, nullable north angle, named reference datum/origin and edge-indexed setback declarations. |
| Levels | Stable ID, index, name/kind, signed elevation, optional known floor-to-floor height and plan envelope. |
| Spaces | Stable ID, level, extensible classification/name, nonrectangular simple boundary, optional occupancy/use/specification. Boundary convention is explicit; area is derived. |
| Walls | Directed centerline, thickness, height, level and base offset, classification/specification; optional adjacency checked against boundary geometry. |
| Doors | Hosted position/width/height/sill, type, hinged/sliding/explicitly unknown operation; connections derive from host adjacency. |
| Windows/openings | Same authoritative host-position geometry; generic passage/service/other openings remain distinct from windows and doors. |
| Stairs | Straight flight between distinct levels, direction, footprint/width, exact rise/run, integer riser heights, tread depth, optional declared headroom and endpoint landings. |
| Slabs/ceilings/roof | Polygon footprints with explicit voids, thickness and top offset; floor, flat-roof and separate ceiling assemblies. Floor slab underside already supplies the corresponding physical ceiling surface. |
| Columns | Polygon cross section, elevation/height and specification reference; architectural placeholders only. |
| Dimensions | Derived or controlling projected chains, anchored to explicit points, room vertices, wall ends, opening edges or levels. Overall and segment constraints reconcile exactly with geometry. |
| Specifications | IDs with descriptive material/specification references. No prices or rate data embedded in geometry. |

IDs are document-unique, including nested landings/setbacks. All level, host, specification and dimension references resolve. Opening reverse lists and space adjacency are derived instead of duplicated. Spaces may share boundaries but not interiors. Openings fit their host extent and height and cannot overlap in wall-relative area. Polygons, voids, level elevations, stair arithmetic and controlling dimensions are validated at runtime.

## 3. Precision strategy

- Canonical geometry: integer millimetres, serialized as JSON numbers within explicit ±100 km coordinate and 100 km individual-length bounds.
- Arithmetic: BigInt intermediates for decimal conversion, polygon predicates/areas, squared lengths and reconciliation. BigInt is never stored in the JSON model.
- Rounding: nearest integer millimetre, half ties away from zero, once at input boundaries. Decimal strings avoid preexisting binary-number error. Rectangular V1 endpoints are added as exact decimal rationals before rounding.
- Conversion: exact metre/centimetre factors, foot = 1524/5 mm, inch = 127/5 mm. One foot rounds to 305 mm; five feet becomes 1524 mm. Combined feet/inches are summed before rounding. Display formatting is separate.
- Coordinates: X right, Y up/elevation, Z plan depth. Horizontal points are building-global. Entity Y is level elevation plus declared offset; opening Y also adds wall base and sill. Negative coordinates/basements are supported.
- Polygon areas return exact decimal mm² strings, including half-square-mm values. Irrational diagonal lengths use a documented deterministic nearest-mm approximation; opening hosting uses exact squared comparisons. Perimeters sum individually rounded edges. Orthogonal wall surface/prism measurements are exact; diagonal ones inherit length rounding.

## 4. Backward compatibility

The original Plan/PlanInput/SavedPlan schemas, generator algorithms, API route/service implementations, database constraints, RLS, sharing, estimate logic and durable idempotency are unchanged.

Existing `POST /api/plans`, `POST /api/plans/generate`, `GET /api/plans/:id`, `PATCH /api/plans/:id`, `POST /api/estimates`, and `GET /api/regions` retain V1 behavior. Existing tests and live acceptance flows pass. No previous assertion was weakened or removed.

`parseArchitecturalDocument` validates unversioned JSON as V1 and explicitly versioned V2 as V2. Unknown explicit versions fail. Historical plan JSON is never silently upgraded. V2 is not accepted by the V1 HTTP persistence contract.

## 5. V1 → V2 adapter

`upgradePlanV1(plan, buildingId)` is pure and deterministic. It converts known rectangle vertices, wall segments, room names/classifications, and safe seed/variant/saved-ID provenance. It namespaces room IDs and keys imported wall identities by directed geometry, so reordering arrays does not change their IDs. Unsaved plans require a caller-supplied durable building namespace.

The output uses a clearly labeled synthetic legacy datum at zero; it does not claim surveyed ground elevation. Site, north, wall thickness/height/base convention, real door/window construction, slabs, stairs and specifications remain unknown or absent. Existing furniture and ambiguous V1 window intervals are not mapped. Structured diagnostics report omissions and millimetre quantization. Raw prompt text and invented generator versions are not copied.

No door is fabricated from a gap: general saved V1 gaps do not establish door type, host construction, height or operation. Quantization collapse, duplicate IDs and invalid topology fail validation instead of being repaired silently. The original V1 record remains intact.

## 6. Database changes

None. No migration, SQL, seed, RLS, ownership, idempotency RPC or repository change.

V2 is an atomic validated JSON document suitable for a future additive persistence boundary. The existing `plans` table deliberately enforces V1 JSON-to-metadata consistency; Phase 9 does not weaken those constraints or pretend V2 can already be stored through its V1 API. Native V2 persistence requires a future explicit extension.

## 7. Files changed

New model modules under `packages/shared/src/building-v2/`:

- `units.ts`, `geometry.ts`: precision, conversions and polygon/segment primitives.
- `common.ts`, `site.ts`, `levels.ts`, `spaces.ts`, `walls.ts`, `openings.ts`, `stairs.ts`, `slabs.ts`, `dimensions.ts`: composed entity contracts.
- `model-shape.ts`, `building-model.ts`, `invariants.ts`: document structure, trust boundary and cross-entity validation.
- `relationships.ts`, `measurements.ts`: topology and basic deterministic measurements.
- `adapter.ts`, `index.ts`, `README.md`: compatibility, public exports and full contract documentation.

New tests:

- `packages/shared/tests/building-v2-precision.test.ts`
- `packages/shared/tests/building-v2-model.test.ts`
- `packages/shared/tests/building-v2-adapter.test.ts`
- `packages/generator/tests/building-v2-compatibility.test.ts`

Golden JSON under `packages/shared/tests/fixtures/building-v2/`: `single-room.json`, `small-residence.json`, `multi-room.json`, `two-level.json`, `explicit-openings.json`, `invalid-dangling-host.json`, `invalid-crossed-room.json`.

New documentation: `docs/PHASE9-DESIGN.md`, `docs/PHASE9.md`.

## 8. Previous baseline files modified

Exactly two existing tracked files changed:

| File | Reason |
| --- | --- |
| `packages/shared/src/index.ts` | One additive export exposes V2 alongside the unchanged V1 contracts. |
| `packages/shared/tests/browser-compatibility.ts` | Adds compile-only use of the public V2 schemas, adapter, precision and serialization APIs with Node ambient types disabled. Existing checks remain. |

No API, existing generator source, old test assertion, package dependency, CI configuration, migration or estimator was modified.

## 9. Tests

179 new executed cases:

| Suite | New cases |
| --- | ---: |
| Precision, conversion and exact geometry | 65 |
| Model schemas, topology, construction entities and dimensions | 82 |
| V1 adapter and document discrimination | 16 |
| Actual generator → V2 compatibility | 16 |
| Total | 179 |

Coverage includes exact 9000 mm reconciliation; foot/inch rounding; invalid NaN/Infinity/fractional geometry; negative coordinates; half-mm² and large exact areas; concave containment; self-intersections/retraced edges; holes; walls; explicit doors/windows/passages; opening bounds/overlap; levels and stairs/landings; plates/ceilings/roofs/columns; unique IDs; dangling/cross-level references; specification references; room/door/level dimension anchors; deterministic JSON round-trips; explicit unknown construction; no invented windows/doors; adapter immutability; stable IDs under reorder; and 16 seeded generator layouts with decimal coordinates and translated origins.

Five valid and two deliberately invalid golden documents are authored and checked with explicit assertions rather than large snapshots. The browser fixture compiles the same public contracts without Node types.

## 10. Verification

Final gates, Node v22.22.2:

| Command / gate | Result |
| --- | --- |
| `npm run build` | Passed, exit 0; shared, generator and API |
| `npm run typecheck` | Passed, exit 0; includes shared/generator browser compilation |
| `npm run lint` | Passed, exit 0 |
| `npm run test:unit` | 1058/1058 across 16 files, exit 0 |
| `npm run test:generator` | 324/324 across 7 files, exit 0; already included in unit count |
| `npm run test:integration` | 51/51 across 4 files, exit 0 |
| `npm run test:supabase` via `node scripts/test-local-supabase.mjs` | 4/4 on each of three consecutive clean runs against the real local stack, exit 0 |
| `npm run check` | Passed build/typecheck/lint/full tests: 1111/1111 across 21 files, exit 0 |
| Existing PostgreSQL teardown regression | 2/2 within the full check |
| `docker build -t designflow-api:phase9 .` | Passed; build and production dependency pruning |
| `node scripts/smoke-container.mjs designflow-api:phase9` | Passed: non-root runtime, live 200, unavailable-dependency ready 503, SIGTERM exit 0 |
| `git diff --check` | Passed; whitespace checks also cover every new untracked file |

The full check includes all 1058 unit cases, 51 integration cases and 2 harness regression cases. Supabase adds 4 distinct acceptance cases. Final suites had zero skipped tests and no unhandled test errors.

There were no persistence/model lifecycle changes; the three-run integration-lifecycle condition does not apply. Integration passed both standalone and again inside the complete aggregate check.

An initial aggregate run could not bind the PostgreSQL loopback listener inside the sandbox; rerunning with local listener access passed. The first Supabase attempt had one existing idempotency acceptance case return 500. All five migrations and the authenticated RPC were present. A synthetic four-way concurrent RPC probe passed, its test records were removed, and three subsequent complete unchanged acceptance runs passed. The initial transient's cause was not established; no test or baseline implementation was changed to hide it. Credentials stayed in memory and were not printed or written to the repository.

Docker emitted the preexisting host warning that its legacy builder is deprecated because Buildx is absent. Hosted CI was not executed; its relevant local verification/container commands were exercised.

## 11. Model capabilities

Future consumers can derive 2D outlines and dimension chains, explicit opening symbols/schedules, room/host relationships, vertical stair connectivity, per-level geometry, wall extrusion volumes and opening placement, floor/roof/ceiling/column extrusions, basic exact polygon areas, opening deductions and specification-linked measurements from one document.

A complete wall's path/thickness/height/base and an opening's host/offset/width/height/sill contain the required placement information without inventing dimensions. Declared door operation supplies swing/slide semantics where known. Blueprint, quantity and 3D consumers share these same authoritative fields. Incomplete imported documents advertise missing data explicitly.

## 12. Known limitations

- Native V2 HTTP/database persistence is not implemented; V1 endpoints remain V1.
- Legacy adaptation is a planar subset. It cannot reconstruct unrecorded construction details, furniture geometry, ambiguous windows or real door semantics.
- Space areas use centerline boundaries, not automatically net usable finished-face areas. Wall envelopes and level containment do not certify setback or offset-solid clearance.
- Straight wall segments, straight axis-aligned stairs, endpoint landings and flat roofs are supported. Curved walls, multi-flight/spiral stairs and pitched roof planes need future explicit schemas.
- Millimetre quantization can change sub-mm V1 geometry and reject collapsed details. Irrational diagonal measures are deterministic rounded values, not exact irrational numbers. Opening-edge projected dimension anchors currently require axis-aligned hosts.
- Plate outer-footprint overlap is deliberately restricted. Basic wall prism measurements do not resolve junction solid overlap. Floor-area measurements are geometric, not statutory GFA.
- This validates model integrity, not full spatial collision, stair headroom clearance, daylight, structural engineering or municipal regulation compliance. Pairwise geometry validation is bounded but not optimized as a large-campus spatial index.
- One initial local Supabase 500 was transient and remains unexplained; the targeted probe and three consecutive complete acceptance reruns passed.

## 13. Deferred

Phase 10 — Precision Blueprint Engine; independent Blueprint QA/rules; full quantity takeoff; construction calculation engine; BOQ/cost V2; AI architectural interpretation; native V2 persistence integration; advanced stairs/roofs/wall joins; and frontend/3D rendering.

No external AI provider, frontend, full quantity takeoff, structural solver or new pricing engine was introduced. Work stops at Phase 9.

Changes are intentionally uncommitted and ready for review/commit/tag as `backend-v1-phase9-complete`. No commit or completion tag was created automatically; HEAD remains the verified Phase 8 commit. The final working tree contains only the two intended baseline modifications and the new Phase 9 files.
