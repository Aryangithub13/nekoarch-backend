# Architecture and dependency map

**Baseline 2026-10-13 (r3), against `phase31/development` @ `5476f41`.** Every statement here is CONFIRMED from the source tree unless marked otherwise. Detailed designs live in each phase's `docs/phaseNN/` documents.

## 1. Repository layout (npm workspaces, root package `designflow`, Node `>=22`)

| Workspace | Role |
|---|---|
| `packages/shared` | Shared schemas and types (Building Model V2), plus a browser build (`typecheck:browser`) |
| `packages/generator` | Procedural generation, parsing (`parseRequirements`), the precision solver (B6, B19) |
| `packages/blueprint-qa` | Independent blueprint QA and rule engine (B11) |
| `packages/quantity-takeoff` | Deterministic quantity takeoff (B13) |
| `packages/construction-calculations` | Construction calculation engine (B14) |
| `packages/boq-cost` | BOQ and cost engine (B15); also provides `costHash` canonical hashing, which the gateway uses |
| `apps/api` | Fastify HTTP API: everything else |
| `supabase/` | SQL migrations `0001`–`0025`, seed, schema tests (`supabase/tests/database.test.ts`) |
| `test-support/` | Embedded-PostgreSQL harness (`postgres.ts`), PostgREST-equivalent backend (`pg-backend.ts`), fixtures, probe workers, OpenAPI contract list |

API runtime dependencies (`apps/api/package.json`): `fastify` 5, `@fastify/{cors,helmet,rate-limit}`, `zod` 3.25.76, `@supabase/supabase-js` 2, `@sentry/node` 10, `pino` 10, `decimal.js`, plus the workspace packages. Notable dev tooling: `vitest`, `embedded-postgres`, `pg`, `supabase` CLI, `tsx`, `typescript-eslint`, `zod-to-json-schema`, `gltf-validator`. There are no paid-service SDKs.

## 2. Request path

```
HTTP → Fastify (apps/api/src/app.ts)
     → security: helmet, CORS, rate-limit groups read/write/generate (lib/http-protection.ts), body limits, timeouts
     → auth: Supabase session (lib/auth.ts requestContext) → per-user Repository
     → routes/*.ts (24 route modules; 128 operations in docs/modernization/api-routes.json)
     → services/*.ts and domain modules
     → Repository (lib/supabase.ts; tests use test-support/pg-backend.ts)
     → PostgreSQL via PostgREST:
         - RLS owner reads on tables;
         - writes only through SECURITY DEFINER RPCs (*_write) that verify an HMAC envelope signed with
           PROJECT_COMMIT_SECRET (= project_private.commit_key);
         - idempotency records; immutable-history triggers.
```

The OpenAPI document and route catalog are generated from the live routes and Zod contracts. A drift test enforces them (`apps/api/tests/modernization.test.ts`; regenerate with `UPDATE_ROUTE_CATALOG=1`). Errors use one envelope (`lib/errors.ts`). Sentry has a route allowlist (`lib/sentry.ts`).

## 3. Domain modules (`apps/api/src/`)

| Module | Phase(s) | Persistence |
|---|---|---|
| `services/project-service.ts`, `revision/` | B12, B30 | Projects, immutable revisions, QA runs, revision operations |
| `ai/` (interpreter, conversation planner and provider, fallback parser, orchestration) | B18, B20, B21 | Conversations (`0012`–`0013`). Providers are off by default (`AI_*_MODE=fallback`) |
| `workflows/` | B16 | Workflow runs (`0010`) |
| `bim/` | B23 | Derived on read; IFC export |
| `structural/` | B24 | Stored analyses (`0014`) |
| `environmental/`, `systems/`, `knowledge/` | B25–B27 | Stored analyses (`0015`–`0017`) |
| `optimization/` | B28 | Studies (`0018`); bounded worker pool |
| `scene3d/` | B29 | GLB artifacts (`0019`); bounded worker pool |
| `references/` | B31 | References and events (`0021`, `0024`) |
| `jobs/` | B32 | Durable jobs and events (`0022`): leases, fencing, retries, dedup, recovery on read |
| `account/` | B33 | Settings, library, context; ≤ 8 active jobs per owner (`0023`) |
| `verification/` | B34 | Derived on read |
| `engineering/` | B35 | Derived on read (assessment, conceptual cost, sources) |
| `compute/` | B36 | Consent records (`0025`) over B32 jobs |

## 4. Execution model for expensive work

- **Worker pools** (`lib/worker-pool.ts` `BoundedWorkerPool`; `scene3d/pool.ts`, `optimization/pool.ts`):
  - fixed size, bounded queue, per-job timeout and worker heap limit;
  - output re-validated by the parent;
  - source-mode workers start through `lib/tsx-worker.mjs` (the Node 22.22.0 fix, `a7da2a0`).
- **Durable jobs** (`jobs/runner.ts`): an in-process `JobRunner` dispatches with the requesting user's credentials, and state lives in SQL (`job_write`). There is **no background sweeper and no service identity**: a lost job is recovered when its owner next reads it.
- **Phase 36 gateway:** `POST …/compute/quotes` → `POST …/compute/jobs` → `GET …/compute/jobs/:jobId`.
  - The gateway lives in `compute/{contracts,gateway}.ts`, `lib/compute-repository.ts` and `routes/compute.ts`.
  - The quote is signed (HMAC-SHA256 over a canonical hash) and expiring.
  - Consent runs `compute_write`, which inserts a consent record and calls the nested signed `job_write('submit')` in one transaction.
  - Execution happens on the local pools only, and `COMPUTE_POLICY.remoteExecution` admits only `DISABLED`.

## 5. Configuration surface (`apps/api/src/config/env.ts`)

| Group | Variables |
|---|---|
| Core | `NODE_ENV`, `PORT`, `HOST`, `LOG_LEVEL`, `RELEASE`, `TRUST_PROXY`, `CORS_ORIGINS`, `HSTS_ENABLED` |
| Data and signing | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PROJECT_COMMIT_SECRET` |
| Observability | `SENTRY_DSN` |
| AI | `AI_ROUTING_CONFIG` (provider credentials are resolved from it), `AI_CONVERSATION_{MODE,ENDPOINT,MODEL,API_KEY}`, `AI_INTERPRETER_{MODE,TIMEOUT_MS,MAX_OUTPUT_TOKENS}` |
| Compute | `COMPUTE_POLICY` (strict JSON; remote cannot be enabled) |
| Limits | `RATE_LIMIT_*`, `BODY_LIMIT_BYTES`, `SMALL_BODY_LIMIT_BYTES`, `REQUEST_TIMEOUT_MS`, `CONNECTION_TIMEOUT_MS`, `KEEP_ALIVE_TIMEOUT_MS`, `UPSTREAM_TIMEOUT_MS`, `READINESS_TIMEOUT_MS` |

## 6. Delivery and verification tooling

- **Container:** `Dockerfile`, smoke test `scripts/smoke-container.mjs` (non-root, liveness 200, readiness 503 without dependencies, clean SIGTERM).
- **CI** (`.github/workflows/backend-ci.yml` on the default branch): runs on PRs and on pushes to `main`, `master` and `codex/**`, with `node-version: '22'`. It runs build, typecheck, lint, the per-area test subsets, then the container build and smoke test. `supabase-acceptance` runs only on `workflow_dispatch`. PR #7 replaces this with the full suite on 22.22.0 and 22.23.2 ([status-register §3](status-register.md)).
- **Local Supabase acceptance:** `npm run db:start`, then `npm run test:supabase` (`scripts/test-local-supabase.mjs` refuses non-local URLs; receipts in `docs/phase16-evidence/`).
- **Embedded PostgreSQL** refuses to run as root and needs the `en_US.UTF-8` locale.

## 7. External dependencies and their status

| Dependency | Use | Status |
|---|---|---|
| Supabase (PostgreSQL, PostgREST, Auth) | All persistence and auth | Hosted state unverified (REPORTED `0017`) |
| Sentry | Error capture (allowlisted routes) | Optional (`SENTRY_DSN`) |
| AI providers | Interpretation and conversation | Disabled unless configured; fallback by default |
| Remote compute providers | — | None. `remote-http-worker` is listed as `DISABLED` |
