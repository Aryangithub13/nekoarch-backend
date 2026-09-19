# Phase 6 — procedural generation core

## 1. Implemented

Added the pure generation pipeline: optional prompt normalization → validated structured requirements → seeded room layout → walls/openings → furniture → canonical Plan and runtime invariant validation. Generation failures are typed and candidate search is bounded.

## 2. Architecture

`generatePlan(input, options)` returns the existing `Plan`. `parseRequirements(prompt)` is a separate limited prompt adapter. `assertPlanInvariants` is independently callable. Modules separate input, randomness, layout, geometry, furniture, invariants and errors. The API never imports the generator.

See [the generator package README](../packages/generator/README.md) for examples, exact inputs, nominal dimensions and algorithm limits.

## 3. Files changed

New generator source modules: `input.ts`, `errors.ts`, `random.ts`, `layout.ts`, `geometry.ts`, `furniture.ts`, `invariants.ts`, and `generate.ts`. Added independent input, geometry, invariant, furniture, complete-generation and furniture-pipeline tests, plus a browser compilation fixture/configuration. Added package documentation and this report.

## 4. Existing code modified

The initial checks found a clean working tree at commit `6670abe`, tagged `backend-v1-phase5-complete`; `git diff backend-v1-phase5-complete...HEAD` was empty before changes. The user-supplied Phase 6 brief reports the tagged baseline's local 507 unit, 31 integration and 1 Supabase acceptance tests as passed. This phase does not redo that implementation.

| Existing file | Required Phase 6 change |
| --- | --- |
| `packages/generator/src/index.ts` | Replaced the reserved scaffold with exports for the implemented generator |
| `packages/generator/package.json` | Added exports/types, generator tests/browser typecheck, and an explicit dependency on already-installed Zod 3.25.76 |
| `package-lock.json` | Records only that direct generator Zod dependency; no version upgrades |
| `package.json` | Adds generator tests and browser/type verification to the existing checks |
| `vitest.config.ts` | Discovers the new generator test files |
| `tsconfig.json` | Typechecks the new generator tests |

No pre-existing API source, shared contract, database migration, seed, RLS policy, estimator, persistence behavior, Sentry/logger module or test was changed. The existing 507 tests remain intact.

## 5. Tests

New tests cover repeated determinism, real layout variation, all six residential room types, canonical/save-request compatibility, minimum and maximum dimensions, 24-room layouts, unusual aspect ratios, translations/decimal geometry, adjacency, input immutability and isolation between returned plans, full boundary coverage, T-junctions, physical opening relationships, doorway graph connectivity, furniture containment/rotation/relations/clearance, typed failures and bounded execution. Independent fixtures and arithmetic checks supplement the runtime invariant function; giant snapshots are not used.

Concrete regressions were added before fixes for seed-dependent unbalanced 5/7-BHK allocation; malformed count/dimension/floor expressions that had been silently reinterpreted; throwing getter/proxy error leakage; and inherited property names crashing the standalone furniture helper. Parameterized array fixtures were also corrected so Vitest passed each intended array intact. Final counts are recorded below.

The 308 generator tests comprise 167 input, 55 invariant, 32 furniture, 4 geometry, 35 generation and 15 independent furniture-pipeline tests.

## 6. Verification results

Final verification ran on 2026-09-14 after the last source change. The PostgreSQL listener restriction in this sandbox is separate from the user-verified tagged baseline.

| Check | Result |
| --- | --- |
| `npm run build` | Passed |
| `npm run typecheck`, Node and browser | Passed |
| `npm run lint` | Passed |
| `npm run test:unit`, including the 507 baseline tests | Passed: 815/815 across 10 files |
| `npm run test:generator` | Passed: 308/308 across 6 files |
| `npm run test:integration`, existing PostgreSQL/API integration | Blocked: both suite setup hooks fail with `listen EPERM: operation not permitted 127.0.0.1`, preventing all 31 tests from executing in this sandbox; command exits 1 |
| Supabase acceptance | Not rerun: no Supabase-backed application-flow code changed. The user supplied a 1/1 passed baseline result |

The current full verification gate cannot be declared passed while the integration rerun is blocked. No test was disabled, weakened or replaced to conceal the environment restriction.

`git diff --check` passed. A comparison against `backend-v1-phase5-complete` confirms no changes under `apps/api`, `packages/shared`, `supabase` or `test-support`. No known Phase 6 implementation or generator-test failures remain. The pending verification action is to run `npm run test:integration` in an environment that permits its existing local PostgreSQL listener.

## 7. Specification decisions

- The Phase 6 attachment authorizes generator implementation, superseding the earlier plan's scaffold-only restriction for this package. Its API/backend boundary remains unchanged.
- The canonical Plan represents one 2D floor and has no doors, floor IDs, building classification or furniture room-ID fields. This implementation preserves that schema: door relationships are inferred from wall gaps and furniture association from containment. Multiple storeys and generator building classifications are unsupported; estimator building types are unrelated.
- The previously supplied PRD/TRD discuss procedural prompt interpretation and portable generation, with a future LLM interpretation layer. The Phase 6 brief prohibits an unnecessary external dependency. A separate deterministic keyword adapter and structured core preserve that boundary without claiming general natural-language understanding.
- The original standalone PRD/TRD/schema/plan files are no longer present at their earlier Downloads paths. Decisions use their content already supplied in the task, the Phase 6 attachment and the current canonical contracts; no new conflicting source was found in the repository.
- The supplied specifications do not define exact footprint bounds, furnishing sizes, corridor widths or supported adjacency solving complexity. These are documented, bounded MVP engineering choices rather than invented regulatory requirements.
- “Open kitchen” is a direct opening between canonical kitchen/living rectangles, not a new combined-room polygon type. No optional window geometry is invented without defined window-interval semantics.

## 8. Known limitations

Single-floor rectangular residential layouts only; six supported room types, 24 requested rooms maximum. The search is a bounded strip/corridor family, not a general constraint optimizer. Direct adjacency chains are supported; branching/cyclic requirements can fail even if another architectural solver could realize them. Narrow layouts can require through-room circulation. Precise design input should use the structured API; the prompt adapter recognizes a limited English grammar. Nominal furniture sizes, doorway approaches and geometric connectivity do not certify usability, accessibility, structures or building-code compliance. Bathroom fixtures are absent from the existing furniture enum and remain ungenerated. Tight rooms may omit optional furniture companions.

## 9. Deferred work

Frontend/session UI, blueprint rendering, Three.js, walkthrough/drone modes, deployment, production infrastructure, LLM integration, new HTTP endpoints, queues/workers, realtime collaboration and Phase 7 remain untouched. No automatic continuation beyond Phase 6 is included.
