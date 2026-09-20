# Phase 8 — production hardening

Phase 7 baseline: `b88902d`, tag `backend-v1-phase7-complete`. The initial working tree was clean and the tag-to-HEAD diff was empty. No generator algorithms, estimate mathematics, historical migrations, or product routes were replaced.

## Runtime and release procedure

Use Node 22. Install with `npm ci`, build with `npm run build`, and run `npm start`. Start reads injected environment variables; it no longer requires a disk `.env`. For local file-based configuration, use `node --env-file=.env apps/api/dist/server.js`. Development still supports `npm run dev`.

Apply append-only migrations through `0005_idempotency.sql` before releasing the API. Use the normal controlled Supabase migration process for the target environment; the API never migrates on boot and never needs service-role credentials. `npx supabase migration up --local` upgrades a local stack. `npx supabase db reset --local` is only for disposable local databases. The existing seed remains repeatable and illustrative, not verified production pricing.

Build the container with `docker build -t designflow-api:phase8 .`. It installs the lockfile, compiles TypeScript, prunes development dependencies, and copies only production artifacts into a non-root Node runtime. No `.env`, fixtures, or secrets enter the image. The Node executable runs directly as PID 1 and receives SIGTERM. Port 3001 is exposed. `node scripts/smoke-container.mjs` verifies liveness, failed-dependency readiness, non-root execution, and clean SIGTERM exit with container networking disabled.

Production still requires environment-specific Supabase URL/anon key, Sentry DSN, approved browser origins, proxy addresses, TLS termination, rate tuning, monitoring, backup/restore policy, and database statement timeouts. Configure the platform's readiness probe separately from the Docker liveness healthcheck. Allow at least 30 seconds of termination grace and increase it if configured request/upstream deadlines are increased.

## HTTP and lifecycle behavior

- `GET /health/live`: cheap `200 {"status":"ok"}`, independent of Supabase and exempt from quotas.
- `GET /health/ready`: bounded, read-only `rate_table_versions` projection through the public Supabase client. Returns 200 when reachable, 503 `{"status":"unavailable"}` on failure or draining. It discloses no internals. It verifies database/PostgREST access, not every Auth endpoint or completeness of business rate data.
- Fastify closes its listener and drains active requests before the adapter's optional owned-resource close hook. Production uses stateless Supabase HTTP clients, with no owned PostgreSQL pool or Auth refresh timers to close. The executable then awaits Sentry flush. Both signals share one shutdown promise, including repeated mixed signals. Failures set exit code 1 and produce safe logs; no early `process.exit()` is used.
- All sensitive responses use `Cache-Control: no-store`; Helmet adds `nosniff` and `no-referrer`. API CSP/COEP are disabled. HSTS requires an explicit production setting and HTTPS termination.
- Body sizes default to 1 MiB for plan JSON and 64 KiB for generation/estimates. Existing malformed JSON, unsupported media type, and oversized-body responses deliberately remain structured 400s for compatibility.
- CORS uses exact origins and permits `Authorization`, `Content-Type`, and `Idempotency-Key`; it does not enable cookie credentials. Production defaults to no browser origin permission. CORS does not authenticate non-browser clients.
- Proxy trust defaults to false. Only explicit IPs/CIDRs are accepted. Configure actual upstream proxy networks and prevent direct access around that proxy; do not set unrestricted CIDRs. Untrusted forwarded headers do not change limiting keys.

## Rate limiting

Maintained `@fastify/rate-limit` enforces an initial per-address guard before Auth work, then separate authenticated identity quotas for reads, writes (including PATCH), and generation. Unauthenticated reads use the derived client address. Identity/address keys are HMAC digests with an instance-specific random salt and are never logged. Replays consume quota too. Invalid requests and unknown paths consume the address quota. Liveness is exempt; readiness uses the perimeter quota.

429 uses the existing error envelope with `RATE_LIMITED` and `Retry-After`. Limits are per process, with a bounded 10,000-key LRU cache: restart/eviction resets counters, replicas do not share quotas, and large NAT populations share the perimeter limit. An ingress/distributed limiter is future work for multi-instance or hostile high-cardinality traffic. Test fixtures explicitly disable limits where load is incidental; hardening tests exercise enabled/configured limits.

## Durable idempotency contract

Optional `Idempotency-Key` protects `POST /api/plans`, `POST /api/plans/generate`, and `POST /api/estimates`. Keys contain 1–128 ASCII letters/digits or `._:-`; never put secrets in them. Missing keys preserve Phase 7 behavior and provide no retry guarantee.

Scope is authenticated caller + route + SHA-256 key hash. The fingerprint is SHA-256 of recursively sorted, schema-validated/defaulted JSON. Object property order is irrelevant; array order and meaningful strings remain significant. Semantically equivalent representations beyond schema normalization (such as two differently worded prompts) are distinct requests.

Successful plan/generation results cache the original 201 body; successful estimates cache the original 200 body. Replay returns the original durable ID, response, and share token but gets a fresh HTTP request ID. A changed request with the same active key receives structured 409 `IDEMPOTENCY_CONFLICT`. Failures do not create receipts and keys can be retried. A network timeout may follow a successful commit: retry with the same key to recover it.

Services stage their existing single insert. The security-invoker `commit_idempotent_creation` RPC takes a transaction-scoped advisory lock for the caller/route/key, checks or creates the receipt, inserts the plan/estimate, and runs the existing audit trigger in the same transaction. The database allocates the actual plan ID. RLS and existing column privileges apply throughout. Concurrent requests can do duplicate bounded generation/calculation before acquiring the commit lock, but they commit only one durable operation. Locks time out after 5 seconds; callers can retry safely. No service-role bypass is used.

`0005_idempotency.sql` adds only this RPC and `idempotency_records`, its composite primary key, expiration index, explicit privileges, and three own-user RLS policies. Anonymous access and RPC execution are denied. Authentication-user deletion cascades to receipts. Owners can access/manage their own receipts directly through Supabase; receipts contain the original response (including private plan/share data), never bearer tokens or raw keys. They are private even when a plan is public.

Receipts expire after 24 hours. An expired key can create another record; retry guarantees end at expiry. Reusing a key removes its expired receipt transactionally. Configure an administrative daily cleanup job using the indexed expiration column:

```sql
delete from public.idempotency_records where expires_at <= now();
```

This operator-run retention job is required to remove expired receipts whose keys are never reused. No scheduler or administrative credential is embedded in the API. A receipt remains replayable until expiration even if its plan is deleted; it describes the original creation result, not current resource existence. Protect receipts and backups like private plan records.

## Timeouts and bounded work

Server request reception defaults to 30 seconds, socket inactivity to 10 seconds, keep-alive idle time to 5 seconds. Supabase Auth/REST transport calls abort after 10 seconds; readiness additionally applies a 2-second abort signal. Signals compose instead of overwriting one another. SDK automatic PostgREST retries are explicitly disabled because retry/backoff can exceed these transport budgets. Auth transport outages return safe `503 AUTH_UNAVAILABLE`; invalid credentials remain 401.

HTTP timeouts do not cancel synchronous JavaScript generation; the existing deterministic bounded search is unchanged. A route with several sequential upstream calls can take longer than one upstream timeout. An aborted HTTP request does not guarantee cancellation of a PostgreSQL statement already executing. Set appropriate PostgREST/database role statement limits in the deployment environment; the RPC's 5-second lock timeout specifically bounds lock contention. There is no claim of a general handler execution deadline.

## Observability and secrets

One custom start/completion pair records server-owned request ID, route template, method, status, and duration. Raw URLs, query values, headers, plan bodies, prompts, configuration objects, and credentials are omitted/redacted. Error logs contain safe categories. Fastify `LogController` replaces the deprecated top-level `disableRequestLogging`, preserving custom logging without duplicate automatic request logs.

Sentry retains allowlisted exception class, application-relative source filename/line/column, request ID, method, route template, release, environment, and error category. It drops exception messages, function names, source snippets, request/user attachments, breadcrumbs, arbitrary tags, and raw stack paths. Third-party-only frames may be omitted. Tests use a local transport; no external Sentry delivery was claimed or attempted. Operational staging delivery remains an environment-specific release check.

`SUPABASE_SERVICE_ROLE_KEY` is removed from the production Env schema and stripped if supplied. Local acceptance cleanup still requires the key in its own tooling. Startup validation does not echo submitted credential or invalid enum values. `.gitignore` and `.dockerignore` exclude environment/credential files.

## Configuration reference

All numeric values are positive validated integers. Empty optional values use defaults.

| Variable | Default / requirement |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Required, URL must use HTTP(S) |
| `SUPABASE_SERVICE_ROLE_KEY` | Local acceptance/setup only; not API configuration |
| `SENTRY_DSN` | Required in production; optional otherwise |
| `RELEASE` | Optional 1–100-character release identifier, letters/digits/`._-` |
| `NODE_ENV` | `development` |
| `HOST`, `PORT` | `127.0.0.1`, `3001`; container host `0.0.0.0` |
| `LOG_LEVEL` | `info` |
| `CORS_ORIGINS` | Development/test localhost:5173; production denies all origins when empty |
| `TRUST_PROXY` | Empty = false; explicit comma-separated IPs/CIDRs only |
| `RATE_LIMIT_ENABLED` | `true`; exact `true`/`false` |
| `RATE_LIMIT_WINDOW_MS` | `60000` |
| `RATE_LIMIT_READ`, `RATE_LIMIT_WRITE`, `RATE_LIMIT_GENERATE` | `120`, `30`, `10` per window |
| `RATE_LIMIT_IP` | `300` per address/window |
| `BODY_LIMIT_BYTES`, `SMALL_BODY_LIMIT_BYTES` | `1048576`, `65536` |
| `REQUEST_TIMEOUT_MS`, `CONNECTION_TIMEOUT_MS` | `30000`, `10000` |
| `KEEP_ALIVE_TIMEOUT_MS`, `UPSTREAM_TIMEOUT_MS` | `5000`, `10000` |
| `READINESS_TIMEOUT_MS` | `2000` |
| `HSTS_ENABLED` | `false`; only honored in production |

## CI and release gates

`.github/workflows/backend-ci.yml` runs lockfile install, build, typecheck, lint, unit, generator, integration, container build, and container smoke on PRs and relevant pushes. The explicit `workflow_dispatch` Supabase job starts the official ephemeral local Docker stack, resets only that stack, runs acceptance, and stops it. No production credentials are used. Stack-start output is kept out of CI logs because it can include generated keys. `scripts/test-local-supabase.mjs` reads status credentials in memory and launches the acceptance script with them.

The local Supabase job is an explicit release gate because downloading/running the full stack is heavier than normal PR checks. Hosted Actions execution itself is not verified locally. Each normal command and both container commands have local equivalents. Run integration three consecutive times after lifecycle changes; preserve the existing PostgreSQL disconnect-before-stop harness.

## Scope and review map

New runtime modules: `http-protection.ts`, `idempotency.ts`, `lifecycle.ts`, `safe-error.ts`. The baseline bootstrap/config/auth/adapter/logging/Sentry/routes changed only to connect hardening. Plan, generation, and estimate service implementations remain untouched. Existing tests were updated only for explicit rate-test settings, removal of the unused service-role requirement, safe exception context, and exact seven-table/eight-FK schema assertions. The pg adapter gained readiness/idempotency solely for exercising production SQL under real RLS.

New tests cover health recovery, drain ordering, shutdown deduplication/failures, quotas and identities, forwarded-header spoofing, CORS, security headers, body/key limits, environment validation, safe stack context, upstream cancellation, Auth outage, durable concurrency on all three endpoints, restart replay, conflicts, user isolation, audit rollback/retry, expiry, historical estimate replay, Phase 7 upgrade, and actual Supabase transport acceptance.

Deferred: distributed rate infrastructure, deployment-specific retention scheduling/TLS/SQL statement limits, staging Sentry delivery, hosted CI execution, and production deployment. No frontend, generator V2, or Phase 9 work was started.

## Verified results

Final local verification on 2026-09-19:

| Gate | Result |
| --- | --- |
| `npm run build` | Exit 0 |
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0 |
| `npm run test:unit` | 879/879, exit 0 |
| `npm run test:generator` | 308/308, exit 0; already included in unit count |
| `npm run test:integration` | 51/51 on each of three consecutive complete runs, exit 0; zero unhandled errors |
| `npm run test:supabase` | 4/4 on actual loopback Supabase, exit 0 |
| Existing PostgreSQL teardown regression | 2/2, exit 0 |
| Docker build | Successful, including `npm ci`, TypeScript build, and production dependency pruning |
| Docker smoke | Production configuration, non-root, live 200, unavailable dependency ready 503, SIGTERM exit 0 |
| CI | YAML parsed; commands exercised locally, including container build/smoke; hosted runner not executed |
| Repository hygiene | `git diff --check` passed; final verification logs scanned without credential patterns or unhandled errors |

41 tests were added: 29 unit hardening cases, 11 real PostgreSQL integration cases, and 1 live Supabase concurrency case (which covers all three POST endpoints). One obsolete unit parameter requiring the API service-role key was removed and replaced by coverage proving the key is unnecessary/stripped; unit count is therefore 851 + 29 - 1 = 879. No generator tests were removed or changed.

The project-owned Fastify top-level logging deprecation is resolved. No Node/pg deprecation appeared in the final suites. The first clean container dependency install emitted the existing ESLint 9 support warning; the local Docker installation uses its deprecated legacy builder because Buildx is absent. Neither dependency internals nor host tooling were patched to hide warnings.

The application is ready for review and a `backend-v1-phase8-complete` checkpoint. Production deployment and external Sentry delivery were not performed.
