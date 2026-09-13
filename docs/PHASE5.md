# Phase 5 implementation and verification

Scope follows the supplied `PLAN.md`: **Integration, Security, and Contract Tests**. That plan has Phases 0–5 and a final completion gate; it does not define numbered Phases 6 or 7. In this phase, the generation pipeline means receiving a client-generated plan, validating it, saving it under its verified owner's identity, atomically recording `generated`, retrieving/sharing it, and computing a linked estimate. The API still does not generate geometry.

Existing backend files and tests were inspected before modification. The six-table schema, four migrations, rate seed, five endpoints, ownership policies, estimate arithmetic, and procedural-generation boundary remain intact. No existing tests were deleted or weakened.

## Changes

- Expanded PostgreSQL integration coverage for audit-trigger failure rollback, plan durability across application reconstruction, independent share tokens, all seeded building types, budget-independent market estimates, and historical estimates after publishing a new rate version.
- Added 36 tests of the actual Supabase SDK adapter using a controlled HTTP transport. These cover verified authentication, caller JWT propagation, concurrent identity isolation, public reads, safe column selection, database failures, and malformed returned data. They supplement the real PostgreSQL tests; they do not replace RLS verification.
- Added a local Supabase acceptance test for actual anonymous Auth sessions and PostgREST. It uses the production application/backend, exercises the complete persistence/sharing/estimate flow, and cleans up only identities and records it creates. It fails clearly when local configuration is missing and is excluded from the default offline suite.
- Added successful-response schema and request-ID/log correlation checks across all five routes.
- Fixed the pre-existing Sentry SDK compilation failure by supplying the required `ErrorEvent.type: undefined`. Repaired the invalid fixture DSN and SDK-client cleanup in its transport test. No external Sentry event is claimed as verified.
- Fixed an input/database boundary mismatch: `variant` and `floors` now reject values beyond PostgreSQL's signed integer maximum with a typed 400. Both the accepted maximum and rejected overflow have regression coverage.
- Exported the existing insert schemas to resolve lint failures without duplicating schema-derived types. Moved the test port allocation before temporary-directory creation so a blocked listener does not leak an empty directory.
- Included the new Supabase adapter tests in `npm run test:unit`.

## Verification

Final command results from 2026-09-13 are below. A failed database startup is not counted as passing or deliberately skipped tests.

| Check | Result |
| --- | --- |
| `npm run build` | Passed |
| `npm run typecheck`, including browser-safe shared package | Passed |
| `npm run lint` | Passed |
| `npm run test:unit` | Passed: 507 tests across four files (411 contracts, 29 estimate service, 31 foundation, 36 Supabase adapter) |
| PostgreSQL integration tests | Blocked: this sandbox rejects local listeners with `listen EPERM: operation not permitted 127.0.0.1`; 14 API and 17 database tests cannot execute |
| `npm run test:supabase` | Executed; setup failed clearly because `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are absent. The acceptance test did not execute |
| Supplemental migration/seed replay | Passed with actual PostgreSQL 18.1 in standalone mode: all four migrations, seed twice, six public tables, seven foreign keys, one version and nine rate entries |

The supplemental standalone run does **not** establish RLS correctness: PostgreSQL single-user mode bypasses RLS, even after `SET ROLE`. The normal multiuser integration suite remains required. It has not been replaced with mocks or a weaker authorization test.

Run from the project directory in an environment that permits a local PostgreSQL listener:

```sh
npm run build
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
```

For actual Supabase acceptance, start/reset a disposable local Supabase stack, put its local API URL and keys in `.env`, then run `npm run test:supabase`. The test permits only loopback Supabase URLs. Never use a production project for this test. `npm run db:test` retains the existing pgTAP database policy assertions.

**Phase 5's completion gate remains open until the real database integration and local Supabase acceptance checks pass.** These are outstanding Phase 5 verification tasks, not work deferred to a later phase.

## Intentionally deferred

No authoritative Phase 6/7 mapping was supplied, so the following later-phase items were left untouched rather than assigned invented phase numbers:

- Procedural prompt parsing, room layouts and furniture placement in the portable generator package, as explicitly deferred by the supplied plan.
- Frontend session-bootstrap UI, blueprint rendering, walkthrough/drone controls and other frontend implementation.
- Deployment, hosted Supabase configuration and external Sentry dashboard acceptance. Local integration test fixtures were added only to exercise Phase 5.

No generation endpoint, worker, queue, realtime collaboration, additional table or frontend feature was added.
