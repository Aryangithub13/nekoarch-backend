# Acceptance traceability matrix — 2026-10-20

**Layer key:** U unit · I integration (embedded PostgreSQL 18, real SQL/RLS) · C contract/schema · M migration · S security · L live local Supabase (real GoTrue JWTs + PostgREST) · E end-to-end on staging/hosted · X live hosted-model.

**Status** follows the audit definitions strictly. PASS needs the required layer. A weaker layer gives NOT VERIFIED; a missing prerequisite gives BLOCKED. Run counts are in [TEST_AND_RETEST_REPORT.md](TEST_AND_RETEST_REPORT.md).

## 1. Database and Supabase gate

| # | Requirement | Code / DB objects | Tests | Required layer | Evidence | Status | Sev / action |
|---|---|---|---|---|---|---|---|
| D1 | Fresh install `0001`→`0033` succeeds | `supabase/migrations/*` | every `*.integration.test.ts`; `supabase/tests/database.test.ts` | I+M | Full suite (final run) | PASS | — |
| D2 | Upgrade from a populated prior schema | same | `*migration upgrade*` cases (structural, environmental, systems, compute, conversation-turns, interior); manual `supabase migration up --local` 0019→0033 | M+L | Final run; ledger 33/33 | PASS (local) | — |
| D3 | Hosted ledger matches the repository | hosted `schema_migrations` | `hosted-migration-ledger.test.ts` (local side only) | E | none | **BLOCKED** | SUPA-001/R03: operator |
| D4 | Migrations immutable once released | `migrations.sha256` | checksum test | C | Final run | PASS | — |
| D5 | RLS enabled on every public table | 42 tables | live catalog query; RLS integration tests | L | 42/42 | PASS (local) | — |
| D6 | Owner isolation (read, update, delete, forged owner) | RLS policies, definer RPCs | `supabase.live.test.ts` (129); `*.integration.test.ts` | L | 129/129 | PASS (local) | — |
| D7 | Anonymous access limited to public data | anon grants (2 rate tables), `project_read('public')`, `reference_download` | live suite; catalog query | L | 129/129; grants inspected | PASS (local) | A20-008 hygiene (Low) |
| D8 | No privileged-key bypass in the application | `lib/supabase.ts` | `grep SERVICE_ROLE apps/api/src`; adapter tests | S | Only logger redaction | PASS | — |
| D9 | Definer functions pin `search_path` | `pg_proc.proconfig` | catalog query | S+L | 0 unpinned | PASS (local) | — |
| D10 | CRUD and business flows through API → DB | routes → RPCs | live suite; integration files | L | 129/129 | PASS (local) | — |
| D11 | Idempotency, concurrency, single commit | `idempotency_records`, signed RPCs | live concurrent-save and replay cases; DB-001/002 tests | L+I | Pass | PASS (local) | — |
| D12 | Constraint and duplicate mapping (409/403/404) | `databaseError`, mappers | `supabase-adapter.test.ts` | U+L | Pass | PASS | — |
| D13 | Transport timeout and failure handling | `lib/supabase.ts:182`, `databaseError` | `hardening.test.ts`, `supabase-adapter.test.ts`; manual hung-upstream probe | U | 500 `DATABASE_ERROR` (data), 503 (auth) | PASS (behaviour as specified) | A20-012 contract decision (owner) |
| D14 | Pool exhaustion | — | none | L | — | **NOT VERIFIED** | Load test |
| D15 | Live outage mid-write | — | none at live level | L | — | **NOT VERIFIED** | Container-stop test |
| D16 | Test-data cleanup | live `afterAll` | live suite | L | Throws on any failed deletion; passed | PASS (local) | — |
| D17 | Staging or hosted acceptance | — | — | E | — | **BLOCKED** | SHOW-001/R28 |

## 2. API, authentication and security

| # | Requirement | Code | Tests | Layer | Evidence | Status | Sev / action |
|---|---|---|---|---|---|---|---|
| A1 | Every route authenticates or is intentionally public | `lib/auth.ts` `requestContext`; four optional-auth routes | route tests; live suite | S+L | grep: 34/34 modules use `requestContext`; four public routes reviewed | PASS | — |
| A2 | Token verified server-side | `authenticate` → `auth.getUser` | `hardening.test.ts`; live | L | Pass | PASS (local) | — |
| A3 | Request validation, unknown fields, bounds | `parseRequest`, strict Zod | unit and integration | U | No raw `Schema.parse(request.*)`; full suite | PASS | — |
| A4 | No 500 for input the schema accepts | `classifyTurn` | `conversation-turns.test.ts` (new) | U | Failed before the fix, passes after | PASS (after fix) | **A20-002 FIXED** |
| A5 | Sanitized error envelope; no SQL or secret leak | `app.ts` error handler | adapter and backend integration tests | U+I | Pass | PASS | — |
| A6 | CORS allow-list, helmet, body limits, timeouts | `app.ts`, `http-protection.ts` | `http-contract`, `hardening` | U | Pass | PASS | — |
| A7 | Rate limits and quotas | `installLimits`, `0031` | quota-integrity tests | I | Pass; per-process only | PASS (single instance) | SEC-002 deferred |
| A8 | No ReDoS on NL grammars | 4 grammars | adversarial timing probe (85 cases) | S | Worst 8.3 ms, 0 throws | PASS | — |
| A9 | SSRF: outbound only to validated hosts | AI transports; Supabase URL | `ai-transport`, `ai-remote`, `nlp-briefs` allow-list | S | Pass | PASS | — |
| A10 | No secrets in tree or history | — | pattern scan | S | 0 matches | PASS | — |
| A11 | Production dependencies free of known vulnerabilities | lockfile | `npm audit --omit=dev` | S | 0 | PASS | — |
| A12 | Dev dependencies | vitest 3.2.7 | `npm audit` | S | 2 critical, 1 moderate (dev-only) | **FAIL (dev-only)** | DEP-001 deferred (owner) |
| A13 | Upload malware scanning | `references/contracts.ts` | — | — | `NOT_PERFORMED` | **FAIL vs roadmap B31** | SEC-001 build work |
| A14 | Health and readiness reflect DB, schema and secret | `/health/*`, `deployment-state.ts` | `deployment-readiness`; live | L | Pass | PASS (local) | — |
| A15 | Graceful shutdown | `preClose`/`onClose` | BUG-001 tests | I | Pass | PASS | — |

## 3. NLP and model integration

| # | Requirement | Code | Tests | Layer | Evidence | Status | Sev / action |
|---|---|---|---|---|---|---|---|
| N1 | English brief extraction (plot, units, floors, rooms) | `fallback-parser.ts`, planner | `nlp-briefs.test.ts`, `eval-nlp-briefs.ts` | U | 47/47 fields, 8/8 status; held-out 6/6 | PASS (deterministic) | — |
| N2 | Hinglish brief extraction | same | same | U | Pass after fix | PASS (deterministic, finite grammar) | **A20-005 FIXED** |
| N3 | New brief vs modification separated | planner `mode`, prompt | `nlp-briefs` mode and relationship tests | U | Pass | PASS | **A20-004 FIXED** |
| N4 | Fallback never loses extracted constraints | `mergeProviderIntent` | `nlp-briefs` provider cases | U (mocked HTTP) | 9/24 failed before the fix | PASS (mocked) | **A20-003 FIXED** |
| N5 | Contradictions and ambiguity ask instead of guessing | planner | `nlp-briefs`, `conversations.test` | U | Pass | PASS | — |
| N6 | Schema-invalid, empty or unsafe output rejected | `INTENT_TASK.parse`, strict schema | `nlp-briefs`, `ai-orchestration` | U | Pass | PASS (mocked) | — |
| N7 | 429/503 retry, backoff, circuit, timeout | orchestrator | `ai-orchestration`, `nlp-briefs` (loopback HTTP) | U | Pass | PASS (mocked) | — |
| N8 | Prompt injection refused; output cannot approve or mutate | `assertSafeConversationText`, closed schema, approval flow | `nlp-briefs`, `conversations` | U+L | Pass | PASS | R10: regex blocklist is a weak layer (P1) |
| N9 | Hosted-model accuracy, latency and fallback rate | — | `eval-nlp-briefs.ts` hosted column | X | Not run | **NOT VERIFIED** | Credentials |
| N10 | Gemini via the provider adapter | `validateRemoteEndpoint` | allow-list test | X | Path refused by design | **BLOCKED** | A20-006 owner |

## 4. Environment, build and deployment

| # | Requirement | Evidence | Status | Sev / action |
|---|---|---|---|---|
| B1 | Clean install builds and tests | `npm ci` on npm 12 broke DB tests | PASS after fix | **A20-001 FIXED** (High) |
| B2 | Build, lint and typecheck | final run exit 0 ×3 | PASS | — |
| B3 | Fail-fast configuration | `config/env.ts` Zod; `.env.example` matches the schema (only the documented tooling-only service-role key differs) | PASS | — |
| B4 | Node version support matches `engines` | CI 22.x only; Node 26 verified locally in this audit | **NOT VERIFIED in CI** | DEP-003 owner |
| B5 | Container build, fail-fast and start | `docker build` OK. Production without `SENTRY_DSN` exits 1 and names it (no key echoed). With production config (synthetic `.invalid` DSN) against local Supabase: `/health/live` 200, `/health/ready` 200, unauthenticated `/api/projects` 401, SIGTERM exit 0, no secret in logs | PASS (local) | — |
| B6 | Deployment, staging and production | none | **BLOCKED** | SHOW-001 |

## 5. Restored items: previously skipped, deferred or stale

| ID | Previous record | Restored status here |
|---|---|---|
| R04 / INT-B-024 | "Locally RESOLVED" on 2026-10-19, but the local stack found today was at `0019` | Re-run: PASS (local) at `0033`, 129/129 |
| PHASE-003 | OPEN | PASS (`69d314c`); stale status corrected (A20-011) |
| Hosted acceptance (all categories) | Often summarized as "Supabase verified" | **BLOCKED**: local only |
| Hosted-model NLP | Implied by mocked provider tests | **NOT VERIFIED** |
| DB timeout semantics | Not catalogued | Recorded as A20-012 (owner) |
| Pool exhaustion, live outage | Never tested | **NOT VERIFIED** |

## 6. Carried prior findings (status unchanged unless noted)

These are from `origin/main:docs/BACKEND_REPAIR_LOG.md` (83 IDs). Their details and blockers are in [REMAINING_BLOCKERS.md](REMAINING_BLOCKERS.md).

| Status | IDs |
|---|---|
| VERIFIED_FIXED (28) | Not re-litigated; their tests are part of the final full run, which is green: API-001, BUG-001, DB-001, DB-002, INT-B-004…007, -009, -013, -015…017, -021, -022, -024, -027…029, SEC-004, SHOW-002, SUPA-002, -003, -006, TEST-001, -003…005 |
| OPEN (10, after PHASE-003 closed) | DEBT-002, DEBT-003, DEP-003 (raised to Medium), INT-B-008, INT-B-023, PHASE-008, SEC-001, SEC-005, SHOW-003, TEST-002 |
| BLOCKED (29) | AUD-002, INT-B-001…003, -010…012, -014, -018…020, -025, -026, -030, -031, PHASE-001, -002, -004…007, -009, SEC-003, SEC-007, SHOW-001, SHOW-004, SUPA-001, SUPA-004, SUPA-005 |
| ACCEPTED_DEFERRED (10) | API-002, API-003, DEBT-001, DEP-001, DEP-002, PHASE-010, PHASE-011, SEC-002, SEC-006, SEC-008 |
| NOT_A_BACKEND_DEFECT (5) | AUD-001, ENV-001, REL-001, SEC-009, SECRET-001 |
