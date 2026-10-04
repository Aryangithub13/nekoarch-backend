# Phase 22 engineering review

**Classification: FULLY IMPLEMENTED AND VERIFIED**

This classification applies to the documented bounded L-shaped architecture family and the existing rectangular engines. U-shapes, enclosed courtyards, cantilevers, balconies and accessible terraces are explicitly unavailable. The implementation provides real occupied nonrectangular geometry and genuinely different supported floor footprints; it does not claim unrestricted architectural or structural feasibility.

## Repository baseline

Repository: `/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow`.
Independently observed initial state: branch `main`, HEAD `f39dbbc36325449979bcfe96dac434ba7ea61f82`, tag `backend-v1-phase21-complete`, clean working tree. The experimental NekoArch repository was not modified. No frontend, deployment, commit, staging, tag, push, reset, checkout, rebase or Phase 23 work was performed.

The [source audit and implementation matrix](phase22-audit.md) records the reusable systems, rectangular assumptions, QA gaps, integration boundaries and tests before implementation. The [design document](phase22-design.md) specifies the actual contracts, algorithm, lifecycle and limitations.

## Architecture reused and extended

Reusable Phase 1–21 functionality includes strict native room schemas, exact millimetre geometry, BigInt predicates, seeded ordering, integer partition reconciliation, wall interval splitting, opening jamb placement, straight stairs/landings, canonical V2 models, independent QA, signed immutable revisions, freshness/idempotency, workflows, quantities, material recipes, cost provenance and the conversation approval lifecycle.

The new `parametric-architecture-v1` path is selected only by explicit native `parametricArchitecture` requirements or explicit version dispatch. V1 remains the default; V2 remains its existing opt-in. An optional version-1 parameter submodel fits existing Building Model V2 geometry without changing historical documents. There is no new persistence system or database migration.

## Shape support

| Family | Status | Actual behavior |
|---|---|---|
| Rectangle | Supported | Historical V1/V2 paths; frozen geometry, metadata and hashes retained |
| L | Supported | Six-vertex connected footprint; occupied rooms in both wings; L circulation |
| Floor-specific L setback | Supported | Two nested L floor polygons, aligned stair, exact destination void and exposed lower roof plates |
| L/U-shaped site using original V2 | Supported as before | Original inscribed rectangular envelopes; no implicit parametric upgrade |
| U building | Unavailable | Explicit unsupported/strict-schema rejection |
| Enclosed courtyard/interior building holes | Unavailable | Rejected; no invented courtyard rooms or slabs |
| Balcony, cantilever, arbitrary floor offset | Unavailable | No upper overhang or unsupported projection accepted |
| Accessible terrace | Unavailable | Exposed lower coverage is a flat roof, with no terrace-use claim |

## Parameters, dependency handling and identity

Each floor has width, depth, west-wing width and south-wing depth in integer millimetres. The origin is shared. Dimensions, clear circulation, room program, relationships, walls, openings, floor height and stair parameters retain bounded native schemas.

Parameter changes produce a normalized copy and a full deterministic rebuild: footprints → room banks/circulation → walls/openings/stair → floor/roof plates → schema and independent QA. A finite pipeline replaces recursive mutations or a user-authored expression graph. Invalid/cyclic/oversized input fails before acceptance. Hard constraints are never traded against a soft score; preferred dimensions/relationships guide only feasible candidates.

Typed wing descriptors derive from persisted parameters, with stable parent/level IDs, reciprocal connections and parameter-rebuild semantics. Room IDs remain semantic type/ordinal identities. Walls and openings use geometry-addressed identities; changed physical intervals get new IDs. Floors, stairs and primary slabs retain semantic roles. No claim is made for general graph matching across arbitrary topology edits. Canonical geometry and hashes repeat across identical inputs; diagnostics/timing do not enter model identity.

## Floor model, room topology and circulation

Each actual floor polygon has its own slab. The allocator fills both L wings with rectangular occupied rooms and joins them through a single connected L circulation polygon. Each floor needs at least two rooms. Two-floor layouts reserve the common straight stair core, both landings, landing doors and the upper flight void. Upper polygons must be wholly contained in the lower footprint. This is geometric support validation, not structural engineering.

Wall intervals are unique and geometrically reconstructed. The verifier confirms complete space-edge coverage, exterior classification at concave boundaries, opening clearance, supported windows and valid real door/stair paths to every space. A score or claimed circulation graph is not accepted as evidence.

## Independent QA and adversarial evidence

The QA package has no generator dependency. It reconstructs expected footprints, inset coverage, room clearances, wall adjacency, actual hosted openings, corridor arms/elbow, stair access, slab support, stair voids and exposed roof coverage. BigInt area/cross-product calculations preserve exact topology within bounded integer coordinates.

New tests cover genuine L rooms, floor variation, controlled edits, seed/hash determinism, explicit unsupported families, site infeasibility, overhang rejection, impossible programs, resource exhaustion and cancellation. Adversarial mutations remove slabs/walls/doors, duplicate IDs, reverse winding, break parents/floor indices, move rooms/flights, fill stair voids, add holes, remove roofs and corrupt opening jambs. Malformed input covers crossing and zero-edge polygons, fractional/overflow dimensions, excessive complexity, cycles and unsupported overlapping/disconnected region declarations. The last two are rejected as unsupported input structures; arbitrary polygon-region assembly is not implemented.

Generated examples and independent PASS reports are available for [single-floor L](phase22-evidence/single-floor-L.json), [two-floor setback](phase22-evidence/two-floor-setback.json), [modified west wing](phase22-evidence/modified-west-wing.json) and [hard-connected rooms](phase22-evidence/hard-connected-rooms.json). These are generated geometry examples, not fabricated database receipts.

## Conversation and AI integration

A conversation on an existing parametric revision records solver `PARAMETRIC`. Typed user-only `nativeUpdate.parametricEdit` supports all four floor dimensions. The verified local grammar includes `Increase the ground floor west wing width to 10000 mm.` Other accepted variants are listed in the design document; broad natural-language architecture editing is not claimed.

The same project-scoped conversation state, exact changed fields, proposal hash/version/base/expiry and explicit approval control generation. Real PostgreSQL and local Supabase acceptance exercise concurrent approvals, immutable ancestry, owner isolation, stale-base rejection and downstream workflow execution. No accepted revision is modified in place.

Providers still cannot return native parametric edits, geometry, QA approval or accepted revisions through their strict intent schema. Phase 21 routing, registries, transport/privacy/cost limits, retry behavior and capability restrictions remain intact. Narrow static import allowlists were extended only for the new parameter schema/helper and QA adapter; no security or geometric assertions were disabled.

## Quantities, construction and cost

Hand-calculated checks establish ground slab 234 m², upper gross slab 188.5 m², stair void 4.2 m², total net floor slabs **418.3 m²**, exposed lower roof **45.5 m²**, all roof plates 234 m², ground exterior centerline 71.2 m, upper exterior centerline 63.2 m and floor slab volume 62.745 m³ at 150 mm thickness. Wall face area, stair risers, floor-specific totals and opening deductions use existing exact quantity machinery.

Parametric stair cores are excluded from ordinary occupied/finish floor-area bases. Their finish coverage is explicitly `NOT_EVALUATED`; flight and landing schedules remain available. Construction propagates this incomplete coverage, and cost retains partial status instead of inventing materials or prices. Wall junction segment-prism limitations and parking-cost limitations remain unchanged. Complete-building workflow acceptance reaches real takeoff, construction and cost artifacts with their honest partial coverage.

## Verification

All requested script equivalents exist and were run. Latest outcomes are below. Counts separated by `/` are separate invocations inside an aggregate script, not additive unique test totals. See [verification.json](phase22-evidence/verification.json) for exit codes, timings and source-manifest attribution.

| Command | Exit | Passed tests | Seconds | Evidence |
|---|---:|---:|---:|---|
| `npm run build` | 0 | — | 17.691 | [log](phase22-evidence/build.txt) |
| `npm run typecheck` | 0 | — | 29.010 | [log](phase22-evidence/typecheck.txt) |
| `npm run lint` | 0 | — | 5.205 | [log](phase22-evidence/lint.txt) |
| `npm run test:unit` | 0 | 1806 | 43.315 | [log](phase22-evidence/test-unit.txt) |
| `npm run test:generator` | 0 | 526 | 17.968 | [log](phase22-evidence/test-generator.txt) |
| `npm run test:blueprint` | 0 | 137 | 8.368 | [log](phase22-evidence/test-blueprint.txt) |
| `npm run test:blueprint-qa` | 0 | 177 | 16.795 | [log](phase22-evidence/test-blueprint-qa.txt) |
| `npm run test:solver-v2` | 0 | 40 | 31.770 | [log](phase22-evidence/test-solver-v2.txt) |
| `npm run test:projects` | 0 | 23 | 21.218 | [log](phase22-evidence/test-projects.txt) |
| `npm run test:takeoff` | 0 | 23 | 23.735 | [log](phase22-evidence/test-takeoff.txt) |
| `npm run test:construction` | 0 | 34 | 21.607 | [log](phase22-evidence/test-construction.txt) |
| `npm run test:cost` | 0 | 39 | 23.604 | [log](phase22-evidence/test-cost.txt) |
| `npm run test:workflows` | 0 | 51 | 26.529 | [log](phase22-evidence/test-workflows.txt) |
| `npm run test:interpretation` | 0 | 133 | 18.523 | [log](phase22-evidence/test-interpretation.txt) |
| `npm run test:conversations` | 0 | 52 | 20.558 | [log](phase22-evidence/test-conversations.txt) |
| `npm run test:ai-orchestration` | 0 | 120 | 27.005 | [log](phase22-evidence/test-ai-orchestration.txt) |
| `npm run test:parametric` | 0 | 36 | 23.988 | [log](phase22-evidence/test-parametric.txt) |
| `npm run test:integration` | 0 | 188 | 69.231 | [log](phase22-evidence/test-integration.txt) |
| `npm run test:supabase` | 0 | 85 | 73.492 | [log](phase22-evidence/test-supabase.txt) |
| `npm run db:test` | 0 | 51 pgTAP | 2.532 | [log](phase22-evidence/db-test.txt) |
| `npm run check` | 0 | 1996 / 133 / 52 | 182.873 | [log](phase22-evidence/check.txt) |
| `npm run benchmark:parametric` | 0 | — | 17.151 | [log](phase22-evidence/benchmark-parametric.txt) |

The final aggregate `check` reruns the complete test suite as well as build, typecheck, lint, interpretation and conversations. The final affected HTTP/integration/Supabase gates were rerun after restoring historical direct V1/V2 dispatch. Earlier standalone passing gates differ only in that dispatcher call boundary; their precise manifest is retained. Each run's source hashes remained unchanged during execution. The final [source manifest](phase22-evidence/tested-source-sha256.json) was checked against the delivered source.

Initial failures are retained under superseded evidence, not hidden: import allowlists needed explicit new names; requirements hashing had to retain historical arbitrary-version salting; workflow/freshness spies required the original public V1 entry point. These were repaired without weakening assertions. The final targeted dispatch verification passed all 33 tests.

The final Docker image `designflow-api:phase22` built successfully. [Production smoke](phase22-evidence/docker-smoke.txt) verifies non-root runtime, liveness 200, dependency-failure readiness 503 and clean SIGTERM exit 0. [Container acceptance](phase22-evidence/docker-acceptance.txt) runs compiled production code with networking disabled, generates the two-floor L, independently verifies it, proposes/rebuilds a wing edit and checks quantities. Real persistence/RLS tests separately run against actual PostgreSQL and local Supabase, not an in-memory database.

## Performance and limits

Runtime: v22.22.2, linux/x64. Three measured repetitions per case; exact individual observations are in [benchmark.json](phase22-evidence/benchmark.json). Median timings are milliseconds. RSS is a process observation rather than per-request allocation; highest sampled RSS was 189272064 bytes (180.5 MiB). Heap deltas, per-stage normalization/layout/construction timing and deterministic hashes are retained in the raw results. Footprint validation is included in normalization; wall/slab/dimension construction is grouped rather than presented as independently isolated phase timings.

| Case | Generation | Independent QA | Full | Candidates | Charged work | Outcome |
|---|---:|---:|---:|---:|---:|---|
| rectangular-v2-baseline | 254.677 | 5.803 | 260.326 | 32 | 1365 | PASS |
| L-four-rooms | 29.15 | 6.88 | 36.033 | 12 | 1724 | PASS |
| L-widened-west | 27.066 | 6.461 | 33.493 | 12 | 1724 | PASS |
| two-floor-setback | 27.634 | 11.649 | 39.199 | 4 | 1328 | PASS |
| dense-minimums | 18.188 | 4.754 | 22.545 | 12 | 1216 | PASS |
| maximum-24-rooms | 79.104 | 30.39 | 109.497 | 15 | 19261 | PASS |
| infeasible-width | 0.478 | 0 | 0.478 | — | — | PROGRAM_DOES_NOT_FIT |
| operation-exhaustion | 0.308 | 0 | 0.308 | — | — | SEARCH_LIMIT_EXHAUSTED |

The reference V2 case uses a different rectangular room/search family; these observations are not a general speedup or equal-search-quality claim. No order-of-magnitude slowdown was observed in the tested bounded workloads. The maximum supported 24-room case was genuinely generated and independently verified. Repeated geometry hashes and failure codes were stable.

Limits remain two floors, 24 rooms, 32 site vertices, bounded candidate/work counts, 5000 input nodes/depth 12, up to 28 spaces, 200 walls and 32 slabs in parametric QA. A ten-second default execution deadline and cancellation checks supplement deterministic work limits. QA has its own geometry budget. Hard relationship infeasibility in this restricted two-bank family is not proof that all possible architectural layouts are impossible.

## Data preservation

All original public-table row digests were preserved, including **653 projects and 716 revisions**. Local acceptance added isolated fixture records according to the existing suite's retention behavior. Final counts are 721 projects and 794 revisions. Migration history, RLS flags and policy digests are unchanged. See [data-preservation.json](phase22-evidence/data-preservation.json).

All 12 historical migration files and both checked historical fixture artifacts are byte-identical to baseline; [source-preservation.json](phase22-evidence/source-preservation.json) records their hashes. Existing V1 golden models, metadata and requirement/model hashes pass their frozen tests. The intentionally preserved historical Phase 19 tag was not rewritten.

## Changed files

The complete inventory, including every evidence artifact, is [changed-files.json](phase22-evidence/changed-files.json). Production, test, fixture and script changes:

- `apps/api/src/ai/conversation-planner.ts`
- `apps/api/src/contracts/conversations.ts`
- `apps/api/src/lib/generation-identity.ts`
- `apps/api/src/services/parametric-qa.ts`
- `apps/api/src/services/project-service.ts`
- `apps/api/tests/foundation.test.ts`
- `apps/api/tests/interpretation.test.ts`
- `apps/api/tests/parametric.integration.test.ts`
- `apps/api/tests/supabase.live.test.ts`
- `package.json`
- `packages/blueprint-qa/src/audit.ts`
- `packages/blueprint-qa/src/options.ts`
- `packages/blueprint-qa/src/parametric.ts`
- `packages/blueprint-qa/tests/boundary.test.ts`
- `packages/generator/src/blueprint/entities.ts`
- `packages/generator/src/blueprint/types.ts`
- `packages/generator/src/parametric/components.ts`
- `packages/generator/src/parametric/generate.ts`
- `packages/generator/src/parametric/input.ts`
- `packages/generator/src/solver-v2/index.ts`
- `packages/generator/tests/parametric-quantities.test.ts`
- `packages/generator/tests/parametric.test.ts`
- `packages/quantity-takeoff/src/calculate.ts`
- `packages/shared/src/building-v2/index.ts`
- `packages/shared/src/building-v2/invariants.ts`
- `packages/shared/src/building-v2/model-shape.ts`
- `packages/shared/src/building-v2/parametric-invariants.ts`
- `packages/shared/src/building-v2/parametric.ts`
- `scripts/benchmark-parametric.ts`
- `test-support/parametric-acceptance.ts`
- `test-support/parametric-fixtures.ts`

Documentation adds the source audit, bounded design, this report, reproducible examples, benchmark data, logs, source manifests and database preservation evidence. All changes remain available for human review.

## Limitations and release readiness

This implementation supports the defined axis-aligned L family, a shared floor origin, rectangular occupied rooms, one L corridor per floor and one aligned straight stair. It does not support arbitrary connected-region placement, arbitrary room polygons, enclosed courtyard holes, U buildings, floor translations, rotations, overhangs, balconies, accessible terraces, freeform geometry, structural members, MEP or professional construction documentation. Automatic room allocation is bounded and can require explicit floor assignments. Stair finishes and existing unmodeled construction/cost categories remain incomplete.

All required acceptance conditions for the bounded L/setback vertical slice are demonstrated. Human code/design review and any desired release approval remain. Recommend the future tag `backend-v1-phase22-complete` **after approval**; it has not been created. No deployment or publication has occurred.

## Phase 23 readiness

The result provides explicit geometry, levels, physical plates/voids, semantic identities, deterministic rebuilding and immutable provenance that a future BIM adapter can consume. It is not BIM/IFC certification or engineering approval. Phase 23 implementation was not begun.
