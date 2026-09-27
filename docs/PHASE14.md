# Phase 14 — Construction calculation engine

Implemented from the existing Phase 14 design and partial scaffolding, on the
`cceb01d` / `backend-v1-phase13-complete` baseline. The calculation package, API,
immutable persistence, tests, workspace build, Docker and CI wiring are present.
Changes are left uncommitted for review. Phase 15 and frontend work are separate.

## Calculation boundary

`calculateConstruction(takeoffReport, specification, options?)` consumes validated
Phase 13 reports. It never remeasures geometry, infers materials, calls a provider,
or prices work. The API loads the stored takeoff and accepted revision QA itself.
All material constants are explicit specification inputs. Recipe definitions and
formula versions live in `src/recipes.ts`.

Supported recipes: solid rectangular one-wythe masonry with optional mortar,
plaster, ready-mix concrete volume, nominal volumetric concrete constituents,
rectangular floor tiles, paint/primer/putty, and door/window units. Cement is kg,
sand/aggregate/concrete are m3, coatings are l or kg, tiles/masonry are pieces,
and door/window units are each. Cement purchase bags require an explicit bag mass.
No structural mix-design or strength claim is made.

Mapping precedence is entity > architectural specification > classification >
level > default. Entity matching uses the primary source only. Ambiguity within an
assembly family/layer rejects the input. Extra layers require explicit opt-in.
Masonry unit depth must match the takeoff wall thickness. Floor finish uses only
`FLOOR_FINISH_BASE_AREA`, never overlapping space totals. Wall-surface recipes
require explicit sides. Paint layers retain coating IDs on their material lines.

All intermediate mathematics uses reduced BigInt fractions. Decimal inputs have
at most six fractional places; report output supports 6–12 places (default 9).
Output rounds half-up. Final exact = theoretical exact × (1 + wastage/100).
Emitted wastage is rounded final minus rounded theoretical, so decimals reconcile.
Purchase counts ceil exact quantities per material line; aggregate procurement
sums those purchases. Cement bag masses stay in separate purchase groups.

Reports preserve normalized specifications, options, recipe/takeoff/policy/engine
versions, source entity IDs, quantity basis, assignment/layer identity, formula
evidence, exact numerator/denominator pairs, material quantities, coverage,
assumptions, warnings and totals by material, level, assembly and specification.
Input order does not affect reports. Inputs are not mutated.

## API and storage

Collection path:
`/api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations`

- `POST`: `{ "specification": { ... }, "options": { "quantityDecimalPlaces": 9 } }`.
  Returns 201 with the exact stored DTO. `options` is optional. Optional
  `Idempotency-Key` uses the existing durable receipt mechanism.
- `GET`: summary list with `limit` (1–100) and optional opaque `cursor`.
- `GET /:calculationId`: the complete stored DTO, including the report.

All routes require the owner session, even for public projects. No new public
sharing path exposes construction data. Unknown request fields, report injection,
invalid specifications and invalid cursors are rejected. Unsupported recipe packs
return 422. Missing signing configuration returns 503. Request bodies are bounded
by the smaller of the configured global limit and 150,000 bytes.

Migration `0008_construction_calculations.sql` adds immutable construction rows,
a composite takeoff/revision reference, accepted-QA reference, indexes, owner RLS,
and signed read/write RPCs. Direct client writes are revoked; update/delete
triggers also prevent privileged accidental rewrites. Existing source tables and
models are unchanged except the additive takeoff composite uniqueness constraint.

The signature binds caller, operation, input, retry context and short expiry. The
RPC rechecks ownership, revision association, accepted QA and takeoff versions.
It recomputes the input fingerprint over revision ID, takeoff ID, source input
fingerprint, canonical source report hash, engine version, recipe pack, normalized
specification and options. Changed content with an existing identity fails closed.
Concurrent creates converge on one report even with different or absent keys.
Artifact and receipt commit together; a receipt failure rolls back the artifact.
Pagination returns bounded summaries rather than report bodies.

## Verification and example

`phase14-verification.json` records the final gate results.

| Gate | Result |
|---|---|
| Build, typecheck, lint, aggregate tests (`npm run check`) | PASS; 1,505 tests, 33 files |
| Full PostgreSQL integration | PASS; 93 tests on each of three runs (first within aggregate) |
| Local additive Supabase migration | PASS; existing records preserved |
| Local database/pgTAP | PASS; 34 assertions |
| Supabase Auth/JWT/PostgREST acceptance | PASS; 30 tests on two consecutive final runs |
| Docker build and production smoke | PASS; non-root, live 200, dependency ready 503, SIGTERM exit 0 |

The initial local Supabase run had one existing concurrent durable-operation test
return 500 (29/30 passed); all construction cases passed. The unchanged suite
then passed twice. Earlier Phase 9/10 reports document the same symptom. Its
cause remains unestablished, and no baseline tests or production code were
modified to suppress it. The initial sandboxed PostgreSQL attempt could not bind
a localhost listener; authorized local-socket runs passed.

 Tests cover manually
calculated recipes, exact rounding, procurement grouping, mapping precedence and
conflicts, source identity, unassigned/partial coverage, malformed input, bounded
work, JSON/order/frozen-input reproducibility, signed provenance, immutability,
RLS, retries/concurrency, pagination, unchanged upstream artifacts, and atomic
rollback. Shared HTTP acceptance runs against both disposable PostgreSQL and
actual local Supabase Auth/JWT/PostgREST.

`phase14-example.json` replays the committed Phase 13 takeoff through the pure
engine using explicitly synthetic construction parameters. It is not a persisted
artifact or an engineering recommendation.

The existing local Supabase stack contained project history, so migration 0008
was applied additively rather than resetting it. Fresh migration replay is covered
by the disposable PostgreSQL suite. Local pgTAP tests run inside rollback-only
transactions. No hosted database or production deployment is involved.

## Scope and limitations

`EVALUATED` means a configured recipe was evaluated. It does not mean all
construction work has been covered. Upstream partial status survives; absent or
unsupported work is `NOT_EVALUATED`. The full report stays partial when unsupported
categories remain. Geometric limitations from Phase 13 still apply (including
segment-prism wall volumes and centerline floor areas).

Masonry bonds/cavities/junction unions and cutting, foundations/excavation,
reinforcement, structural stairs, ceiling systems, waterproofing, MEP, pitched
roofs, adhesive/grout, hardware/glazing BOMs, labor and prices are not evaluated.
The reader currently supports the v1 report/recipe contracts; future engines need
an explicit compatible reader. No jurisdictional/manufacturer defaults are added.

Limits include 10 MB takeoff JSON, 128 KiB specification JSON, 128 assemblies,
512 assignments, one million matching operations, 20,000 calculation items,
40,000 materials, 20,000 warnings, 10,000 sections and 16 MiB output. Valid but
excessively complex requests can be rejected by these conservative bounds.

Next numbered phase: **Phase 15 — BOQ and Cost Engine V2**, consuming these
material lines and their immutable calculation/takeoff/revision IDs. AI, Solver
V2, professional 2D output, 3D/frontend and production deployment remain deferred.
