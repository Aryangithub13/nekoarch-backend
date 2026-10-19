# Supabase acceptance report — 2026-10-20

**Gate decision: NOT ACCEPTED for any hosted environment.** Every mandatory criterion passes **on the isolated local Supabase stack**. Nothing about the hosted (staging or production) project has been verified, because no authorised hosted credentials or operator were available.

| Field | Value |
|---|---|
| Target | Local Supabase CLI stack `designflow` (Docker): API `127.0.0.1:54321`, DB `:54322`. Postgres 17.6.1.167, GoTrue v2.196.0, PostgREST v16.3, Kong 2.8.1 |
| Why it is authorised | Local, single-developer, isolated; `scripts/test-local-supabase.mjs` refuses any non-loopback URL |
| Hosted / staging | Not contacted |
| Credentials | Read in-process from `supabase status`; never printed, logged or committed |
| Backup before change | `pg_dump -Fc` of the local DB at 0019 (28.6 MB), kept outside the repository |

## A. Configuration and connectivity

| Item | Finding |
|---|---|
| Client | `@supabase/supabase-js` in `apps/api/src/lib/supabase.ts`. One anon-key client for auth and readiness; one per-request anon-key client carrying the caller's JWT for every route query |
| Service role | Never used by the API. `SUPABASE_SERVICE_ROLE_KEY` is listed in `.env.example` as tooling-only (live suite and setup scripts) |
| Required variables | `SUPABASE_URL`, `SUPABASE_ANON_KEY`; `PROJECT_COMMIT_SECRET` (production readiness fails without it); validated by `config/env.ts` (Zod), so startup fails fast |
| Timeouts and retry | SDK retry disabled; every fetch has `UPSTREAM_TIMEOUT_MS` (10 s) and `redirect: 'error'`; readiness uses `READINESS_TIMEOUT_MS` |
| Error mapping | GoTrue 5xx or network → 503 `AUTH_UNAVAILABLE`; invalid token → 401; database errors via `databaseError()`; a stale commit secret → 503 `COMMIT_ATTESTATION_UNAVAILABLE` |
| Shutdown | `preClose` drains jobs; `onClose` closes the backend |
| Connectivity evidence | `supabase status` OK; DB connection from the host OK; live suite 129/129 through Kong → PostgREST/GoTrue |

**Connectivity: PASS (local) / BLOCKED (hosted).**

## B. Schema and migration integrity

| Check | Result | Evidence |
|---|---|---|
| Fresh install 0001→0033 | **PASS** | Embedded PostgreSQL: every `*.integration.test.ts` migrates a fresh DB (full suite, TEST_AND_RETEST_REPORT); `supabase/tests/database.test.ts` |
| Upgrade from a populated prior schema | **PASS** | Local stack at `0019` (23 tables of real local data) → `supabase migration up --local` applied `0020`–`0033` without error; plus the repo's own upgrade tests (`*-migration upgrade*` cases in structural, environmental, systems, compute, conversation-turns and interior integration files) |
| Ledger matches files | **PASS (local)** | `supabase_migrations.schema_migrations` = 33 versions, `0001`…`0033`; `migrations.sha256` test passes |
| Destructive or unsafe changes | None found | Forward-only policy; checksum test detects in-place edits (INT-B-025) |
| Application queries agree with schema | **PASS (local)** | Live suite exercises every route family through PostgREST |
| Hosted ledger | **BLOCKED** | SUPA-001 / R03: last reported at `0017` |

## C. RLS and authorisation

Measured on the live local DB after the upgrade:

| Check | Result |
|---|---|
| RLS enabled on public tables | **42/42** |
| RLS tables with no policies (deny-all; written only by definer RPCs or triggers) | 5: `generation_logs`, `project_audit_events`, `project_reference_blobs`, `project_revision_candidate_blobs`, `project_revision_scene_blobs`. Intentional |
| Table privileges held by `anon` | SELECT on `rate_table_versions` and `rate_table_entries` only (public rate data, filtered by an effective-date policy) |
| Policies granted to `anon` | `plans_read_own_or_public` (`is_public or user_id = auth.uid()`; anon has no table grant, so it is reached only via RPC), plus the two rate-table policies |
| `SECURITY DEFINER` functions without a pinned `search_path` | **0** |
| Definer functions executable by `anon` | 10. Five are trigger-only (not callable; A20-008 hygiene). `project_read` requires `auth.uid()` except for the `public` action, which returns only `PUBLIC`/`ACTIVE` projects. `revision_operation_read/write` require `auth.uid()`. `reference_download` requires a valid HMAC token. `commit_key_matches` is the designed readiness probe (A20-009) |
| `project_private` schema usage by `anon` or `authenticated` | none |
| Storage buckets | none (references are stored in tables) |

**Negative tests with separate real identities (LIVE, real GoTrue JWTs, no service role):** the 129 cases in `apps/api/tests/supabase.live.test.ts` include:

- cross-user reads, updates and deletes refused;
- forged ownership and forged QA refused;
- unsigned or forged RPCs refused;
- the same idempotency key isolated across users;
- anonymous access refused or limited to public data;
- foreign revision operations hidden;
- candidate bytes ungranted;
- member roles enforced (B44).

The service role is used **only** for fixture setup and cleanup, never to prove access.

**RLS enabled: PASS (local). Policy correctness and cross-user isolation: PASS (local).**

## D. CRUD and business flows (application → Supabase)

| Area | Result |
|---|---|
| Live suite | 129/129 PASS. It covers create, read, update (metadata), archive and unarchive, revision append, immutability, signed commits, idempotent replay, concurrent saves (exactly one commit), stale-base rejection, pagination, estimates, takeoffs, conversations and turns, references with signed download links, evidence packages, design concepts, specialists, collaboration and delivery |
| Embedded PostgreSQL | 57 integration files, all passing (concurrency, transactions, uniqueness, quotas) |

**PASS (local).**

## E. Error handling and reliability

| Case | Result | Evidence |
|---|---|---|
| Missing or invalid configuration | PASS | `config/env.ts` Zod validation; deployment-readiness tests |
| Expired or invalid credentials | PASS | 401 path; GoTrue outage → 503 `AUTH_UNAVAILABLE` (`hardening.test.ts`) |
| RLS or permission errors | PASS | Mapped to 403/404 without leaking SQL (live) |
| Migration drift | PASS | `/health/ready` is 503 when the schema is older than the API (`0032`, live) |
| Constraint and duplicate errors | PASS | Idempotency and uniqueness tests (embedded + live) |
| Supabase upstream timeout or network failure | PASS (unit + manual probe), contract noted | `hardening.test.ts` (readiness aborts on the 2 s deadline), `supabase-adapter.test.ts` (network error on a write is sanitized). Manual probe against a hung loopback upstream: an RPC and readiness fail at about 300 ms with **500 `DATABASE_ERROR`**; auth fails with **503 `AUTH_UNAVAILABLE`**. The inconsistency is A20-012 (owner decision, linked to INT-B-011) |
| Retries without duplicate writes | PASS | Keyed replay tests (live) |
| Connection-pool exhaustion | NOT VERIFIED | No load test was run |
| Database outage during a write | NOT VERIFIED at live level | Unit-level only |

## F. Decision

| Criterion | Local | Hosted |
|---|---|---|
| Connectivity | PASS | BLOCKED |
| Schema verification | PASS | BLOCKED |
| Fresh-install migrations | PASS | NOT APPLICABLE (hosted is never fresh-installed) |
| Upgrade migrations | PASS (0019→0033) | BLOCKED (ledger unread) |
| RLS enabled and policy correctness | PASS | BLOCKED |
| Cross-user isolation | PASS | BLOCKED |
| CRUD and business flows | PASS | BLOCKED |
| Constraints and relational integrity | PASS | BLOCKED |
| Failure handling | PASS, except pool exhaustion and live outage (NOT VERIFIED) | BLOCKED |
| Application-to-database end to end | PASS (local API → local Supabase) | BLOCKED |
| Test-data cleanup | PASS: `afterAll` deletes every created user and throws on any failure. Immutable takeoff history is deliberately retained on the disposable local stack | BLOCKED |

**Supabase is accepted for local development only.** It is not accepted for staging or production until the hosted ledger is read and the live suite (or a staging equivalent) runs against an authorised non-production hosted project.
