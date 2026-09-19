# Phase 7 — generation API and end-to-end integration

## Implemented

Added authenticated `POST /api/plans/generate` with structured requirements and limited deterministic prompt modes. Successful generation returns a persisted canonical Plan and its existing secure share token. The generated Plan uses the existing retrieve, sharing and estimate operations without special handling.

The working tree was initially clean at `ecc03ff` (`backend-v1-phase6-complete`); the requested baseline status, log and tag diff checks ran before edits. The checkout and supplied attachments contained no original PRD, TRD or `PLAN.md`; Phase 5 documentation describes only the original five endpoints. The route therefore follows the Phase 7 request's explicit fallback. Existing schema, contracts, generator public API, authentication, persistence, audit trigger and relevant tests informed this implementation.

## End-to-end flow and responsibilities

1. The Fastify route runtime-validates the body using `GeneratePlanRequestSchema`.
2. Existing `requestContext` verifies the Supabase bearer token and creates the caller-scoped repository with that same JWT.
3. `generateAndSavePlan` selects structured requirements or calls the limited `parseRequirements` adapter, invokes the portable generator, and validates the result with canonical `PlanInputSchema`.
4. Existing `createPlan` assigns the verified owner, generates the share token, and calls existing `Repository.insertPlan`.
5. The existing PostgreSQL `plans_audit_generated` trigger writes the `generated` audit in the same transaction. Insert/audit failures roll back and produce no successful response.
6. The existing service validates the stored Plan; the route returns HTTP 201 using `CreatePlanResponseSchema` only after persistence resolves.

No additional table, persistence implementation, service-role route access, Plan type, estimator algorithm, generator algorithm, RLS policy or audit mechanism was introduced. API request schemas compose the generator's public validators in `apps/api/src/contracts/generation.ts`; placing them in shared would introduce a shared → generator → shared dependency cycle.

## API contract

`POST /api/plans/generate`, with `Authorization: Bearer <Supabase access token>` and `Content-Type: application/json`.

Exactly one of these modes is accepted:

```json
{
  "requirements": {
    "prompt": "A compact home with an open kitchen",
    "bounds": { "x": 0, "z": 0, "w": 10, "d": 12 },
    "rooms": [
      { "type": "bedroom", "count": 2 },
      { "type": "bathroom", "count": 1 },
      { "type": "living", "count": 1 },
      { "type": "kitchen", "count": 1 }
    ],
    "adjacency": [{ "from": "kitchen", "to": "living" }]
  },
  "seed": "design-42",
  "variant": 1
}
```

```json
{ "prompt": "2BHK with open kitchen", "seed": "design-42", "variant": 1 }
```

`requirements.prompt` is descriptive canonical Plan text; only the top-level prompt mode invokes the prompt parser. Structured adjacency defaults to `[]`. Seed is optional (1–128 characters), and variant defaults to 1 (positive PostgreSQL integer). Prompt text is 1–500 characters and cannot be whitespace-only. Requirements use the unchanged Phase 6 room, footprint, count and adjacency validators. Unknown fields and combined modes are rejected, including submitted ownership, sharing and persistence metadata.

Response: **201**, `{ plan: SavedPlan, shareToken: string }`, exactly the existing `CreatePlanResponseSchema`. `plan.id` is the database UUID; `plan.seed` is the effective seed, including the deterministic default when omitted. Responses use the existing server-generated `x-request-id` and `Cache-Control: no-store` headers. No duplicate seed or database metadata is added.

Same normalized requirements, seed and variant retain the generator's deterministic canonical output. Separate saves have distinct database IDs and independently generated share tokens. Changing prompt text may change the default seed; clients can replay with the returned `plan.seed`.

| Failure | HTTP | Error code |
| --- | --- | --- |
| Invalid body/schema/options | 400 | `VALIDATION_ERROR` |
| Invalid normalized generator input | 400 | `VALIDATION_ERROR` |
| Missing/invalid session | 401 | `UNAUTHORIZED` |
| Unsupported generator requirement | 422 | `UNSUPPORTED_REQUIREMENT` |
| Impossible layout | 422 | `IMPOSSIBLE_LAYOUT` |
| Generator invariant/internal domain failure | 500 | `GENERATION_FAILED` |
| Unexpected exception or invalid canonical output | 500 | `INTERNAL_ERROR` |
| Database failure | Existing mapping | `DATABASE_ERROR`, `FORBIDDEN`, or `CONFLICT` |

All errors use existing `{ error: { code, message, requestId, fieldErrors? } }` envelopes. Generator messages/details are not copied into API errors. Existing logging and reporting paths remain in force.

Sharing remains owner-controlled `PATCH /api/plans/:id` with `{ "isPublic": true }`, followed by `GET /api/plans/:id`. The creation token stays protected; token possession does not grant access to private/revoked plans. Estimates continue through `POST /api/estimates` using the returned `plan.id` as `planId` and existing estimate inputs, including the client's area/floor inputs.

## Files changed and reasons for baseline changes

| File | Change / reason |
| --- | --- |
| `apps/api/src/contracts/generation.ts` | New runtime request contract; reuses public generator schemas. |
| `apps/api/src/services/generation-service.ts` | New normalization, generation, canonical validation, safe domain-error mapping and existing-save orchestration. |
| `apps/api/src/routes/plans.ts` | Adds the requested generation route; original route handlers remain intact. |
| `apps/api/package.json` | Declares the API's dependency on the existing generator workspace. |
| `package-lock.json` | Records that workspace dependency; no dependency versions upgraded. |
| `package.json` | Builds generator before API-consuming dev/check/test commands and includes the new test files. |
| `apps/api/tests/generation.test.ts` | New API/application boundary tests. |
| `apps/api/tests/generation.integration.test.ts` | New PostgreSQL generation tests. |
| `apps/api/tests/foundation.test.ts` | Necessary Phase 7 architecture exception: the old test prohibited every generator import from API sources, conflicting directly with the requested integration. It now permits only the public package in the new contract/service files; bans on generator internals, imports elsewhere and Three.js remain. |
| `apps/api/tests/supabase.live.test.ts` | Retains the client-save acceptance case and all its assertions; runs the same full flow for both generation modes, adding spoofed-owner and unauthenticated generation checks. |
| `docs/PHASE7.md` | This contract and completion report. |

The generator and its existing tests, shared Plan schemas, plan service, repositories, authentication code, estimator, migrations, RLS and PostgreSQL test harness are unchanged. No tests were deleted or skipped; the obsolete blanket API dependency prohibition required the narrowly documented exception above.

## Tests added

**47 additional executed cases** relative to the verified baseline:

- **36** API/application tests: both modes, canonical response, owner/JWT propagation, default seed replay, 21 invalid/ambiguous/spoofed bodies, three auth cases, all five domain error codes, unexpected exceptions, invalid generator output, awaited persistence failure, safe logs and request-ID correlation.
- **9** PostgreSQL integration tests: full flow for each mode; same-seed determinism; eight concurrent requests with independent inputs/seeds/owners; actual unsupported and impossible requests with no writes; plan-insert and audit-insert failures with atomic rollback; linked estimate history across rate versions.
- **2** additional local Supabase acceptance cases, alongside the original client-save case. Both exercise real anonymous Auth sessions, JWT forwarding, PostgREST, owner isolation, stored canonical JSON, exactly one audit, share/revoke access, protected tokens, linked estimates and estimate privacy. Cleanup deletes only records and users created by the suite.

## Verification results

Final results on 2026-09-19:

| Command | Result |
| --- | --- |
| `npm run build` | Passed; exit 0 |
| `npm run typecheck` | Passed, including Node/browser generator compilation; exit 0 |
| `npm run lint` | Passed; exit 0 |
| `npm run test:unit` | **851 / 851**, 11 files; exit 0 |
| `npm run test:generator` | **308 / 308**, 6 files; exit 0 |
| `npm run test:integration` | **40 / 40**, 3 files, on **three consecutive complete runs**; no unhandled errors; every run exited 0 |
| `npm run test:supabase` | **3 / 3**, actual local stack at loopback port 54321; cleanup passed; exit 0 |
| `git diff --check` | Passed |

The generator tests are also included in the unit count; they are not additional distinct cases. Initial sandbox runs could not open the PostgreSQL listener or reach local Auth; approved runs outside the sandbox established the results above. Supabase credentials were loaded from local CLI status without printing them or committing an environment file. No production Supabase was contacted. Existing Fastify `disableRequestLogging` deprecation warnings remain; they are unrelated to this phase and did not cause failures.

## Backward compatibility, limitations and deferred work

All original five endpoints remain valid: `POST /api/plans`, `GET /api/plans/:id`, `PATCH /api/plans/:id`, `POST /api/estimates`, `GET /api/regions`. Original client-save acceptance and all original functional test cases pass. Phase 6 deterministic behavior and package portability remain verified.

Generation retains the existing single-floor rectangular residential model, six requested room types, 24-room maximum, bounded strip/corridor family, inferred wall openings and limited deterministic English prompt grammar. Prompt mode is not general natural-language understanding. Generation is synchronous with the existing bounded solver; this phase adds no workers or production throughput guarantees.

Frontend/rendering, richer architectural models, LLM integration, queues, deployment, production rate limiting and idempotency remain future work. Work stops at Phase 7. Changes are left uncommitted and ready for review/commit; no completion tag was created automatically.
