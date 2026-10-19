# NekoArch backend (`designflow`)

Fastify 5 + TypeScript API over Supabase (Auth, PostgREST, Postgres with RLS and signed `SECURITY DEFINER` RPCs). The code line is `phase31/development`.

Every step below was run on Linux with Node 22.22.0, npm 10.9.4, Docker 29 and Supabase CLI 2.117.0 on 2026-10-19 (audit B repair session, SHOW-002).
A frontend was not part of that run.

## Prerequisites

- Node 22 (CI tests 22.22.0 and 22.23.3), npm 10.
- A Docker daemon, for the local Supabase stack.
- For the database tests: a **non-root** user and the **`en_US.UTF-8`** locale (`sudo locale-gen en_US.UTF-8`, or `localedef -i en_US -f UTF-8 en_US.UTF-8`).
  The test harness says so if either is missing.

## Install and build

```sh
npm ci
npm run build
```

## Local Supabase stack (disposable)

```sh
npm run db:start            # supabase start, then scripts/ensure-local-postgrest.mjs (replaces PostgREST 16.2, which has a JWT clock defect, with 16.3)
npm run db:reset            # applies every migration in supabase/migrations and the seed, locally only
node scripts/ensure-local-postgrest.mjs   # idempotent; run it again after a reset
```

If the default image registry is unreachable (ECR answered "Data limit exceeded" in the verifying session), prefix the Supabase commands with
`SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`. The PostgREST guard accepts the ECR, Docker Hub and GHCR images.

## Configure

```sh
cp .env.example .env
npx supabase status         # API URL and the local anon key
npm run db:secret           # prints PROJECT_COMMIT_SECRET=… for this database
```

In `.env` set `SUPABASE_URL=http://127.0.0.1:54321`, `SUPABASE_ANON_KEY` to the local anon key, and the `PROJECT_COMMIT_SECRET` line.
**Every `npm run db:reset` regenerates the commit key:** run `npm run db:secret` again and update `.env`.
`.env.example` documents every other variable, including what is required in production (`SENTRY_DSN`, `CORS_ORIGINS`).

## Run

```sh
npm run dev                                   # watch mode; loads .env
node --env-file=.env apps/api/dist/server.js  # the built server
```

Check it:

```sh
curl http://127.0.0.1:3001/health/ready        # {"status":"ok"}
curl http://127.0.0.1:3001/api/capabilities    # "deployment": {"writes":"AVAILABLE","schema":{"expectedVersion":…,"status":"CURRENT"}}
```

If readiness is 503 with a reachable database, the logs say why: `COMMIT_SECRET_MISMATCH` (run `npm run db:secret` again) or `SCHEMA_BEHIND`
(apply the migrations). Signed writes under a stale secret return 503 `COMMIT_ATTESTATION_UNAVAILABLE`.

## Tests

```sh
npm test                    # unit + embedded-PostgreSQL integration suites (non-root, en_US.UTF-8)
npm run test:supabase       # live acceptance against the local stack: real GoTrue, PostgREST and JWTs
npm run typecheck && npm run lint
```

Live receipts are written to `docs/phase16-evidence/`.

## For the frontend

- It signs users in directly with Supabase Auth (`SUPABASE_URL`, the anon key) and calls this API with `Authorization: Bearer <access token>`.
- In development the allowed browser origin is `http://localhost:5173`; set `CORS_ORIGINS` for anything else.
- Contract: [`docs/modernization/openapi.json`](docs/modernization/openapi.json), [`docs/modernization/api-routes.json`](docs/modernization/api-routes.json),
  `GET /api/compatibility` (route-catalog hash, matching the OpenAPI `info.version`, and `openapi.sha256`, the sha256 of `openapi.json`: it changes when
  any request or response schema changes), and the per-phase `docs/phase*/…-api.md` documents.

## Deploying

Apply migrations first, then deploy the API: `/health/ready` stays 503 while the database is older than the migration the API needs.
The hosted migration ledger is checked read-only with `scripts/verify-hosted-migrations.mjs` (operator runbook: `docs/release/`).
