# Phase 13 — deterministic quantity takeoff

## 1. Implemented

A pure geometric quantity engine and immutable, owner-only revision artifacts. The
engine accepts complete Architectural Building Model V2, rejects legacy-planar or
invalid geometry, and returns runtime-validated, JSON-safe deterministic reports.
The API requires the revision's accepted Phase 12 QA evidence. No AI, pricing,
material recipes, frontend, or changes to the estimate engine are included.

Baseline HEAD remains `46f0117`, identical to `backend-v1-phase12-complete`. The
initial working tree contained unfinished Phase 13 work. Work stopped at that gate
until the user authorized continuation. Existing work was preserved. The 23 Phase
12 project tests passed; no Phase 12 production defect or history repair was needed.
No completion commit or tag has been created.

## 2. Takeoff architecture

`Building Model V2 → bounded validation → entity measurement → item-derived totals
and schedules → QuantityTakeoffReport → signed immutable revision artifact`.

`@designflow/quantity-takeoff` depends only on `@designflow/shared` and Zod. Generator
and independent QA appear in tests, not in production measurement dependencies.
`calculateQuantityTakeoff(model, options?)` has no database, clock, or input mutation.

Every item has a stable item code and ID, typed base quantity and SI display,
source IDs, level, classification, specification reference, status, assumptions,
and structured evidence. Summary and section totals are sums of emitted items.
Sections group by project, level, specification, classification, and wall thickness.
Opening schedules group by kind, dimensions, type, operation, and specification.

## 3. Precision model

Geometry uses integer millimetres. BigInt intermediates represent **twice** the
base-unit measurement, preserving exact half-mm² polygon areas and half-mm³
volumes. Reports serialize quantities as canonical decimal strings with explicit
`mm`, `mm2`, `mm3`, or `each` units and LENGTH/AREA/VOLUME/COUNT dimensions.
No BigInt is serialized and no floating-point accumulation controls totals.

SI display conversion divides by 1,000, 1,000,000, or 1,000,000,000. It rounds half
upward to 0–9 decimal places, default 6. Display values never feed aggregation.
Irrational diagonal lengths round independently to nearest mm, matching Phase 9;
length-dependent results are PARTIAL. Integer-length segments and polygon areas
remain exact. No tolerance is used for exact quantities.

## 4. Quantity categories

| Category | Implemented quantities |
| --- | --- |
| Walls | Centerline length; gross/opening/net segment-prism volume; gross/opening/net single longitudinal face area |
| Openings | Separate door/window/generic-opening counts, areas, dimensions, sill, type, operation, host, specification schedules |
| Spaces | Centerline-space floor area, alternative floor-finish base area, geometric perimeter |
| Slabs | Floor-plate gross, void, net area and net thickness-based volume |
| Roofs | Separate flat-roof gross, void, net area and volume |
| Ceilings | Explicit ceiling-plate gross, void, net area and volume |
| Stairs | Flight/riser/tread counts, rise, run, width, footprint, endpoint landing areas |
| Columns | Architectural count, net cross-section, height, geometric volume |
| Site/levels | Site, explicit buildable region, level envelopes, sum of net floor plates as geometric GFA |

Codes such as `WALL_SEGMENT_NET_VOLUME`, `FLOOR_PLATE_NET_AREA`, `ROOF_VOLUME`,
`DOOR_COUNT`, and `COLUMN_GEOMETRIC_VOLUME` are machine-readable contracts.
Partition/interior/exterior classifications remain explicit; no unknown wall
classification or null specification is interpreted as a material.

## 5. Wall-junction policy

Version `segment-prism-mm/1` independently sums each wall's centerline length ×
thickness × height. Corner, T, and cross-junction overlaps are **not unioned**.
Wall/column/slab intersections are not removed. This is segment-prism volume,
not exact physical masonry union volume. The report carries `SEGMENT_PRISM`,
`TAKEOFF_WALL_JUNCTION_OVERLAP_POLICY`, and PARTIAL union-solid coverage.

## 6. Opening deductions

`model.openings` is the authoritative source. Every distinct door, window, or
generic-opening entity deducts width × height once from its host's single face,
and that area × host thickness once from its segment prism. Room connectivity
and wall adjacency do not generate extra deductions. V2 validation rejects
unresolved hosts, duplicate IDs, overlapping hosted rectangles, and out-of-host
extents. Quantity invariants reject negative output. Generic passages stay separate
from doors. Structured evidence records length, thickness, height, opening count,
opening area, gross face area, gross volume, and deducted volume; schedules retain
individual opening-to-host links.

## 7. Coverage

- **EVALUATED**: supported geometry measured under the declared convention.
- **PARTIAL**: diagonal-dependent rounded measurements, or wall union-solid coverage
  for which only segment prisms are available.
- **NOT_EVALUATED**: absent or unrepresented geometry, implicit ceiling finish,
  pitched roofs, footprint union, structural engineering, MEP, recipes, and prices.

Coverage is not a claim of complete construction quantities. Unsupported schema
variants are rejected rather than interpreted as a supported shape. Null
specification IDs produce `TAKEOFF_SPECIFICATION_UNKNOWN`; materials are never
invented. Floor-finish base area is an alternative use of space area, not an
additional physical area. No implicit ceiling assembly is created from floor slabs.

## 8. Persistence

`project_revision_takeoffs` stores an immutable takeoff ID, exact revision and
acceptance-QA references, engine/policy/schema versions, normalized options,
SHA-256 input fingerprint, report JSONB, coverage-derived status, and creation time.
Only artifact metadata contains a timestamp. The deterministic report does not.

The fingerprint includes revision ID, complete canonical model, engine, policy,
and normalized options. A revision/engine/policy/options uniqueness constraint and
transaction advisory lock converge concurrent requests on one artifact. Historical
versions coexist in the database; deploying a future report schema requires its
matching reader. No mutable current-takeoff pointer or revision quantity columns.

## 9. API

- `POST /api/projects/:projectId/revisions/:revisionId/takeoffs`
- `GET /api/projects/:projectId/revisions/:revisionId/takeoffs`
- `GET /api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId`

POST accepts `{}` or `{ "options": { "displayDecimalPlaces": 6 } }`, returns 201,
and supports `Idempotency-Key`. Lists return summaries with cursor pagination;
details include the report and provenance. Existing authenticated request handling,
body limits, structured errors, and safe request logging are reused.

New errors include `TAKEOFF_NOT_FOUND`, `TAKEOFF_FAILED`,
`TAKEOFF_RESOURCE_LIMIT`, `TAKEOFF_UNSUPPORTED_MODEL`, `REVISION_NOT_ACCEPTED`,
and `TAKEOFF_UNAVAILABLE`; existing project/revision and idempotency errors remain.

## 10. RLS / security

Ownership derives from takeoff → immutable revision → project. Even public
projects do not expose takeoffs. Authenticated owners receive SELECT only;
anonymous readers and direct client mutation are denied. API persistence signs the
full input, caller, operation, retry context, and expiry using the existing private
project commit key. The write RPC verifies signature, ownership, revision existence,
accepted QA anchor/status, and fingerprint. Clients cannot provide their own report
or QA metadata through POST. Updates and deletes are blocked by the immutable trigger.
Safe logs contain IDs, versions, counts, and the existing request log context.

Local acceptance creates temporary Auth users. Immutable takeoff test histories
survive deletion of those accounts with null project ownership; disposable local DB
reset is the explicit purge mechanism. Cleanup deletes only suite-owned ordinary
projects and identities, and does not bypass immutability.

## 11. Idempotency

Phase 8/12 durable receipts remain authoritative. Equal caller/route/key/revision/
normalized-options requests replay the same complete DTO. Changed payload with the
same key returns 409. User keys are isolated. Different keys and keyless concurrent
requests also converge on one logical artifact. Different options, revisions, or
future engine/policy versions produce distinct artifacts. Artifact and receipt
commit atomically; fault injection proves receipt failure rolls back artifact creation.
Replay checks ownership and preserves the old artifact after the architecture advances.

## 12. Migration

New additive `supabase/migrations/0007_quantity_takeoffs.sql` adds:

- Artifact table, revision/QA foreign keys, bounded report/provenance checks, indexes,
  and version/options uniqueness.
- Owner SELECT RLS, restricted grants, and immutable update/delete trigger.
- Signed `takeoff_write` and owner-scoped `takeoff_read` RPCs.
- Private canonical JSON and public DTO projection helpers.
- The takeoff route in the existing idempotency operation constraint.

Migrations 0001–0006 and project/revision schemas are unchanged.

## 13. Important files

- `packages/quantity-takeoff/src/{calculate,precision,report,index}.ts`
- `packages/quantity-takeoff/tests/{fixtures,takeoff.test}.ts`
- `apps/api/src/contracts/takeoffs.ts`
- `apps/api/src/services/takeoff-service.ts`
- `apps/api/src/lib/takeoff-repository.ts`
- `apps/api/src/routes/takeoffs.ts`
- `apps/api/tests/takeoffs.integration.test.ts`
- `test-support/takeoff-acceptance.ts`
- `supabase/migrations/0007_quantity_takeoffs.sql`
- `docs/phase13-design.md`, this report, verification record, and real example.

## 14. Previous baseline files modified

| Files | Exact reason |
| --- | --- |
| `package.json`, `package-lock.json`, `apps/api/package.json` | Register/build/install the takeoff workspace and add its test gate |
| `Dockerfile` | Include new workspace manifest, sources, and built runtime package |
| `tsconfig.json`, `vitest.config.ts` | Discover/typecheck the takeoff tests |
| `.github/workflows/backend-ci.yml` | Run project and takeoff gates in backend CI |
| `apps/api/src/app.ts` | Register three additive takeoff routes |
| `apps/api/src/lib/repository.ts` | Optional takeoff RPC transport contract |
| `apps/api/src/lib/supabase.ts` | Forward takeoff RPCs and map safe errors |
| `test-support/pg-backend.ts` | Test transport for the new RPCs under actual roles/RLS |
| `apps/api/tests/supabase.live.test.ts` | Shared live acceptance, direct SDK security, immutable-history-aware cleanup |
| `supabase/tests/database.test.ts`, `supabase/tests/rls.sql` | Assert the additive twelfth table and takeoff mutation/anonymous denial |

No Building Model V2, generator, Blueprint QA, Phase 12 service/RPC, V1 estimate,
or frontend production behavior was changed. The existing unfinished Phase 13 design
note's inaccurate clean-tree claim was corrected to the observed baseline history.

## 15. Tests

**13 new pure tests and 10 PostgreSQL takeoff tests**, plus five live acceptance
cases and five additional pgTAP assertions. These suites overlap where shared
acceptance runs on both PostgreSQL and Supabase; counts are not additive unique cases.

New pure tests cover manual arithmetic, opening-heavy geometry, generic passages,
slab voids, roof/ceiling distinction, columns, specification/thickness grouping,
half-unit precision, diagonal partial status, exact source mutations, invalid inputs,
resource bounds, frozen inputs, concurrent deterministic calls, JSON roundtrip,
entity-order independence, and explicit 1BHK/2BHK/two-floor golden values.

A fixed 16-seed corpus reconciles every total against items and level/specification/
classification groups. It compares independent Phase 9 measurements and Phase 11 QA
areas. A 24-room, two-storey generator-limit fixture exercises bounded output.

New PostgreSQL tests cover exact persistence/retrieval, unchanged revision/QA,
acceptance gates, public/private isolation, direct writes/forgery, missing resources,
key replay/conflict/isolation, same/different/keyless concurrency, options/revision/
engine distinctions, pagination, transactional failure rollback, immutable history,
unconfigured signing, and HTTP bounds. Four shared cases also run over real Supabase
Auth/JWT/PostgREST; a fifth live case tests direct SDK/RPC security. Five additive
pgTAP checks exercise direct report forgery, update, delete, unsigned RPC, and public
read denial.

## 16. Verification

See `phase13-verification.json` for final command results and counts. The initial
sandboxed project-test attempt could not bind localhost; it was rerun with local
socket access and passed. One new diagonal fixture initially supplied an invalid
empty topology list, and one future-QA fixture omitted matching version metadata;
both fixtures were corrected before final verification. The first full integration
run also exposed an outdated 16-foreign-key assertion; it now checks 18 and explicitly
asserts both takeoff foreign keys. No skipped tests are used
as successful acceptance.

The Supabase reset was restricted to the configured local `designflow` stack at
127.0.0.1 ports 54321/54322 after read-only counts established zero Auth users,
plans, estimates, projects, and revisions. No hosted database was accessed or reset.

| Gate | Final result |
| --- | --- |
| `npm run build` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test:unit` | PASS — 1,385 tests |
| `npm run test:generator` | PASS — 461 tests |
| `npm run test:blueprint` | PASS — 137 tests |
| `npm run test:blueprint-qa` | PASS — 177 tests |
| `npm run test:projects` | PASS — 23 tests |
| `npm run test:takeoff` | PASS — 23 tests: 13 pure + 10 PostgreSQL |
| `npm run test:integration` ×3 consecutive | PASS — 84 tests each |
| `npm run test:supabase` ×2 consecutive | PASS — 26 tests each |
| `npx supabase db reset --local` | PASS — migrations 0001–0007 and seed |
| `npm run db:test` | PASS — 29 pgTAP DB/RLS assertions |
| `npm run check` | PASS — build, typecheck, lint, all 1,471 tests in 31 files |
| `docker build -t designflow-api:phase13 .` | PASS — image `8cc3fd5cc44c` |
| `node scripts/smoke-container.mjs designflow-api:phase13` | PASS — non-root, liveness 200, dependency readiness 503, SIGTERM exit 0 |
| `git diff --check` | PASS |

Final suites have zero skipped tests and no unhandled errors. Commands overlap;
counts should not be summed as distinct tests. The default suite runs 1,471 tests;
the separate live suite runs 26. All changes remain unstaged and uncommitted.

## 17. Manually checkable example

Wall: 4,000 mm long × 200 mm thick × 3,000 mm high. Door: 900 × 2,100 mm.

| Measurement | Exact arithmetic | Result |
| --- | --- | --- |
| Gross segment prism | 4,000 × 200 × 3,000 | 2,400,000,000 mm³ = 2.4 m³ |
| Door area | 900 × 2,100 | 1,890,000 mm² = 1.89 m² |
| Opening volume | 1,890,000 × 200 | 378,000,000 mm³ = 0.378 m³ |
| Net segment prism | 2,400,000,000 − 378,000,000 | 2,022,000,000 mm³ = 2.022 m³ |
| Gross single face | 4,000 × 3,000 | 12,000,000 mm² = 12 m² |
| Net single face | 12,000,000 − 1,890,000 | 10,110,000 mm² = 10.11 m² |
| Floor plate | 4,000 × 3,000 | 12,000,000 mm² = 12 m² |
| Plate after 500 × 500 void | 12,000,000 − 250,000 | 11,750,000 mm² = 11.75 m² |
| Plate volume at 150 mm | 11,750,000 × 150 | 1,762,500,000 mm³ = 1.7625 m³ |

The single-room fixture has four walls totaling 14,000 mm; gross wall volume is
8,400,000,000 mm³ and net is 8,022,000,000 mm³ with its one door.

## 18. Real project example

A two-storey generated residence with seed `takeoff-golden`, a 10,000 × 12,000 mm
site, two bedrooms, bathroom, living room, kitchen, and one stair. The local example
is created through authenticated project/revision APIs, passes independent acceptance
QA, persists the report, and retrieves an identical report.

Project `8507db45-0684-4acb-a078-866b367f97d3`; revision `3c81bc6e-0da4-48f3-b987-c17b3da86cc6`;
takeoff `5c4f7b0d-5be9-44b0-91cf-1b314d8751ad`; acceptance QA **PASS**.
The complete persisted DTO and requirements are in `phase13-example.json`
(283 items, 57 warnings). The temporary Auth identity was removed
after successful verification; the immutable local artifact remains ownerless.

| Quantity | Exact result |
| --- | --- |
| Exterior wall centerline | 86,400 mm = 86.4 m |
| Interior wall centerline | 69,250 mm = 69.25 m |
| Total wall centerline | 155,650 mm = 155.65 m |
| Gross segment-prism wall volume | 68,984,250,000 mm³ = 68.98425 m³ |
| Opening deductions | 3,141,000,000 mm³ = 3.141 m³ |
| Net segment-prism wall volume | 65,843,250,000 mm³ = 65.84325 m³ |
| Centerline-space floor area | 231,280,000 mm² = 231.28 m² |
| Gross floor-plate area | 240,000,000 mm² = 240 m² |
| Floor-plate stair void | 4,200,000 mm² = 4.2 m² |
| Net floor-plate area / geometric GFA | 235,800,000 mm² = 235.8 m² |
| Floor-plate volume | 35,370,000,000 mm³ = 35.37 m³ |
| Flat-roof area | 120,000,000 mm² = 120 m² |
| Flat-roof volume | 18,000,000,000 mm³ = 18 m³ |
| Doors | 8 each; 15,120,000 mm² total opening area |
| Windows | 5 each; 7,200,000 mm² total opening area |
| Stair | 1 flight, 16 risers, 15 treads; rise 3,000 mm, run 4,200 mm, width 1,000 mm |
| Stair footprint / landings | 4,200,000 / 2,400,000 mm² |

No prices or material recipes are attached.

## 19. Known limitations

Wall junctions and cross-entity intersections are not unioned. Space floor areas are
centerline areas; they do not deduct walls or claim usable finishes. Stair solids,
implicit ceiling finishes, pitched roofs, and cross-level building-footprint union
are not evaluated. Diagonal-dependent lengths/volumes follow explicit mm rounding.
Specifications are preserved without material inference. Quantity bases may overlap
conceptually and must only be summed by their own item codes.

Limits: 2 MiB input, 5,000 entities, 100,000 vertices, supplemental validation-work
bounds, 40,000 items, 6,000 warnings, 2,000 sections, 8 MiB output, and bounded evidence.
Conservative work limits can reject otherwise schema-valid very large documents.
The current reader validates v1 reports; future report versions need corresponding
reader support while historical rows remain unchanged. Local acceptance is proven;
hosted CI execution and production deployment are not claimed.

## 20. Deferred

Phase 14 — Construction Calculation Engine; Phase 15 — BOQ + Cost Engine V2;
Architectural AI; Solver V2; professional 2D output; 3D; structural engineering;
MEP; verified jurisdiction rule packs. No cement bags, brick counts, mix ratios,
reinforcement schedules, labor, or prices are calculated. Work stops at Phase 13
and remains uncommitted for manual review.
