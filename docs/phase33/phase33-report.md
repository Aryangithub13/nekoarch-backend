# Phase 33 report — account, project library, settings & context services

**Final status: PHASE 33 IMPLEMENTED; VERIFIED WITHIN SUPPORTED SCOPE ON THIS MACHINE (Windows), WITH THE EXCEPTIONS IN §F.**

## A. Summary

Owners can now:
- search their project library (escaped substring or tag; status, visibility, star and tag filters; three sort orders; keyset pagination);
- star and tag projects;
- keep versioned settings that are consistent across devices (stale writes are refused);
- see their usage against account quotas enforced in the database (200 projects, 1 GiB of references, 8 active jobs);
- keep an immutable, versioned project brief, validated against the project's references.

`GET …/context` returns one consistent, hashed snapshot of a project's brief, references, current revision, settings and active jobs, for later AI phases to cite. Everything user-stated is labelled `USER_STATED`, unverified and `NOT_CLAIMED`.

## B. Source baseline

| Item | Value |
|---|---|
| Base | `362d998` (Phase 32) on `phase32/durable-jobs` |
| Branch | `phase33/account-library-context` |
| Protected | Migrations 0001–0022 untouched; existing routes and contracts unchanged. The only edit to existing code is one additive error mapping (`P3304`) in `projectDatabaseError`, so quota refusals on existing creation paths are typed 429s rather than 500s. |

## C. Implementation

| Area | Files |
|---|---|
| Contracts | `apps/api/src/account/contracts.ts` |
| Persistence | `supabase/migrations/0023_account_library_context.sql`: `user_settings`, `project_library`, `project_briefs`; quota triggers on `projects`, `project_references`, `project_jobs`; shared `verify_envelope`; `account_read/write`, `library_search/write`, `brief_read/write`, `context_read` |
| Storage boundary | `apps/api/src/lib/account-repository.ts`; `accountRpc` in `lib/supabase.ts` and `test-support/pg-backend.ts` |
| Service and routes | `apps/api/src/services/account-service.ts`, `apps/api/src/routes/account.ts` (10 routes) |
| Integration | Discovery `PROJECT_CONTEXT`; Sentry safe routes; OpenAPI (integer `version` path parameter) and route catalog regenerated (110 → 120) |

Design points settled during implementation:
- Brief hashes are computed only in SQL, because JavaScript and PostgreSQL can canonicalize floating-point numbers differently.
- The context bundle's model hash uses the same SQL canonicalization as Phase 29 scene artifacts. The integration test proves it equals the TypeScript `modelHash`.
- A JSON `null` cursor is treated as no cursor (`jsonb 'null'` is not SQL `NULL`).

## D. Verification

| Suite | Result |
|---|---|
| Phase 33 unit (`account.test.ts`) | 6/6 |
| Phase 33 integration on embedded PostgreSQL (`account.integration.test.ts`: settings concurrency; library search including literal `%` and `_`, tags, stars, status, sort, full keyset traversal, cursor/sort mismatch, owner isolation; brief versions, conflicts, foreign/missing/deleted reference refusal, idempotent replay, immutability; context contents, SQL/TS model-hash agreement, hash stability and change; usage; all three quota triggers via API and direct SQL) | 5/5 |
| Unit and conformance suites | 2 351/2 352. The one failure is the pre-existing Windows path assertion in `interpretation.test.ts`. |
| Integration suites touching quota-affected tables (references, jobs, projects, backend, hardening) | 67/67 assertions. File-level `EBUSY` teardown errors only (Windows). |
| Build, typecheck, lint | Clean |

## E. Limitations

- Library search is a substring match, not ranked full-text search; it is sized for ≤ 200 projects per owner.
- Account limits are fixed constants, with no plans or billing.
- Briefs and context are not yet consumed by any AI flow (B39/B41).

## F. Not covered

The Supabase live stack (no Docker on this machine) and the frontend were not exercised. Migrations 0018–0023 are not applied to the hosted Supabase project.
