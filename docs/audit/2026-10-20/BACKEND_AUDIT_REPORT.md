# NekoArch backend audit — 2026-10-20

| Field | Value |
|---|---|
| Branch | `audit/backend-acceptance` (cut from `fix/nlp-project-brief` @ `9c90928`, which is PR #38 on top of `phase31/development` @ `3158eda`) |
| Starting tree | Clean (`git status` empty) |
| Runtime used | Node 26.11.1, npm 12.2.0, Linux x64; embedded PostgreSQL 18.1; local Supabase CLI stack (Postgres 17.6, GoTrue 2.196, PostgREST 16.3) |
| Prior records reviewed | `docs/roadmap/post-audit-risk-register.md` (r1–r4), `origin/main:docs/BACKEND_REPAIR_LOG.md` (83 finding IDs), `docs/audit/AI-training-architecture-audit-2026-10-13.md`, `docs/release/b39-release-gates-runbook.md` |
| Companion reports | [SUPABASE_ACCEPTANCE_REPORT.md](SUPABASE_ACCEPTANCE_REPORT.md), [ACCEPTANCE_TRACEABILITY_MATRIX.md](ACCEPTANCE_TRACEABILITY_MATRIX.md), [TEST_AND_RETEST_REPORT.md](TEST_AND_RETEST_REPORT.md), [REMAINING_BLOCKERS.md](REMAINING_BLOCKERS.md) |
| Pushed / merged / deployed | No / No / No |

Nothing in this audit touched a hosted database, staging, production or a hosted model. "LIVE" below means the **local** Supabase stack only.

## 1. Architecture (as verified)

- **API:** Fastify 5 (`apps/api/src/app.ts`), 34 route modules, 254 source files. Every route goes through `requestContext` (`lib/auth.ts`). Bearer tokens are verified by GoTrue (`auth.getUser`), and each request gets an anon-key Supabase client carrying the caller's JWT, so **every route query runs under RLS**. The service-role key is never read by the API (`grep SERVICE_ROLE apps/api/src` finds only the logger redaction list).
- **Public (optional-auth) routes:** four, all intentional: public project, public plan, regions, and reference download by signed token.
- **Database:** 33 forward-only migrations (`supabase/migrations`, checksummed in `migrations.sha256`). Business logic lives in signed `SECURITY DEFINER` RPCs whose search_path is pinned and which use `auth.uid()` checks and HMAC commit attestation.
- **Edge protection:** helmet, CORS allow-list from `CORS_ORIGINS`, per-route body limits, request/connection/keep-alive timeouts, no trust-proxy by default, sanitized error envelope (`ApiErrorResponseSchema`), per-IP and per-user quotas (process-local, SEC-002).
- **Outbound requests:** only the AI transports (loopback numeric host, or https + allow-list + DNS pinning + exact path, no redirects) and the server-configured Supabase URL (no redirects, upstream timeout). No shell execution anywhere in `apps/api/src`.
- **NLP:** four bounded deterministic grammars plus an optional orchestrated provider with strict schema validation and a deterministic fallback (see §4).

## 2. Findings from this audit

Severity: Critical / High / Medium / Low / Info. Status: FIXED (regression test fails on the old code), OPEN, BLOCKED, NOT A DEFECT.

| ID | Sev | Area | Finding | Root cause | Status | Evidence |
|---|---|---|---|---|---|---|
| A20-001 | **High** | Test environment | On npm ≥ 12, a clean `npm ci` leaves embedded PostgreSQL unable to start ("Postgres init script exited with code 127"). All 57 `*.integration.test.ts` files fail, so no DB behaviour is verified locally | npm 12 blocks dependency install scripts unless `package.json` `allowScripts` approves them. `@embedded-postgres/linux-x64`'s postinstall links `libpq.so.5` and ICU; without it `initdb` cannot load them. CI uses npm 10 (Node 22), so CI never saw it | **FIXED** | `package.json` `allowScripts` (exact locked versions); `test-support/postgres.ts` preflight names the cause; `supabase/tests/embedded-postgres-preflight.test.ts` new case (failed on old code in the baseline run). Manual: removing the `libpq.so.5` link now yields the named message |
| A20-002 | **Medium** | API / conversation turns | A conversation turn the route accepts (≤ 2000 chars) containing restore wording ("undo …", "restore … undo …") returns **500 INTERNAL_ERROR** | `classifyTurn` re-reads restore turns with each restore word replaced by `'consider'`, which is longer than `'undo'`, so the text can exceed `interpretRevision`'s 2000-char schema and throw `ZodError` (mapped to 500) | **FIXED** | `apps/api/src/conversation/interpret.ts` (stand-in `'see'`, never longer than a replaced word); `conversation-turns.test.ts` "classifies restore wording at the full turn length…" (failed on old code: ZodError) |
| A20-003 | **High** | NLP | A schema-valid but partial provider reply replaced the deterministic extraction, silently dropping plot, floors and other stated constraints | Planner assigned provider output wholesale whenever the grammar flagged `unrecognized_language` | **FIXED** (PR #38, `9c90928`) | `apps/api/tests/nlp-briefs.test.ts` (9/24 fail on old code) |
| A20-004 | Medium | NLP | New-project brief "kitchen connected to the dining" ended in a generic conflict question | Modification grammar consumed "dining" and produced an edit against a non-existent room | **FIXED** (PR #38) | same file |
| A20-005 | Medium | NLP | Hinglish "ground floor pe 1 bedroom" parsed as `bedrooms=1` | Grammar lacked `pe/par/mein` and `ke paas` | **FIXED** (PR #38) | same file |
| A20-006 | Medium | NLP / transport | Gemini's OpenAI-compatible endpoint (`/v1beta/openai/chat/completions`) is refused by `validateRemoteEndpoint` (exact path `/v1/chat/completions`) | Deliberate allow-list. **Not weakened** | OPEN (owner) | `nlp-briefs.test.ts` "Remote transport allow-list is unchanged" |
| A20-007 | Medium | DB environment | The local Supabase stack was at migration **0019** while the repo has **0033**; earlier "LIVE 0001–0033" receipts did not describe the stack present today | Local stack re-created or reset after the 2026-10-19 receipts | Resolved locally (environment) | `supabase migration up --local` applied 0020–0033 on a populated DB; ledger now 33/33; live suite 129/129 |
| A20-008 | Low | DB hygiene | `anon` holds EXECUTE on five trigger-only `SECURITY DEFINER` functions (`audit_saved_plan`, `handle_new_user`, `lock_estimate_rate_version`, `protect_used_rate_entry`, `protect_used_rate_version`) | Postgres default `EXECUTE TO PUBLIC` on functions | OPEN (needs a forward migration; not applied without authorisation) | Not exploitable: functions returning `trigger` cannot be called directly. Recommended: `revoke execute … from public, anon, authenticated` in a new migration |
| A20-009 | Info | DB | `commit_key_matches` is anon-executable and answers whether a signature is the HMAC of a probe | Designed readiness probe (`lib/supabase.ts:199`) | NOT A DEFECT | It only confirms a 256-bit HMAC; no key material is returned |
| A20-010 | Info | Environment | Local Supabase DB port is bound to `0.0.0.0:54322` | Supabase CLI default | NOT A BACKEND DEFECT | Recommend a host firewall on shared networks |
| A20-012 | Low | API contract | A Supabase/PostgREST timeout or network failure on a data route or readiness returns **500 `DATABASE_ERROR`**, while the same outage on GoTrue returns **503 `AUTH_UNAVAILABLE`**, so clients cannot tell a transient outage from a server fault | `databaseError()` (`lib/errors.ts:24`) maps every code-less SDK error to 500. Existing tests pin this deliberately (`hardening.test.ts`, `supabase-adapter.test.ts`) | OPEN (owner contract decision; with INT-B-011). Not changed: a 503 on an ambiguous write implies retryability | Manual probe: hung loopback upstream; RPC 306 ms → 500; authenticate 301 ms → 503; readiness 303 ms → 500 |
| A20-011 | Low | Docs / status | PHASE-003 is still OPEN in the repair log, but `69d314c` already refreshed the runbook for `0030`–`0033` | Stale status | Status corrected (VERIFIED_FIXED) | `docs/release/b39-release-gates-runbook.md` lines 3, 9, 13, 18 |

**Checked and clean (no finding):**

| Area | Evidence |
|---|---|
| Secret scan of tracked files and history | Patterns for OpenAI/Google/Supabase keys, JWTs and private keys: 0 matches. Only `.env.example` is tracked |
| Production dependency audit | `npm audit --omit=dev`: 0 |
| ReDoS | 85 adversarial 2000–4000-char inputs across `parseFallback`, `classifyTurn`, `interpretRevision`, `readText` and `planConversation`: 0 throws after the A20-002 fix; slowest 8.3 ms |
| Request parsing | Every route parses request data through `parseRequest` (no raw `Schema.parse(request.*)`) |
| AI deadline | ≤ 15 s by schema (default 10 s), inside the 30 s HTTP request timeout |

## 3. Re-confirmed prior findings (unchanged status)

| ID | Status | Re-confirmed fact |
|---|---|---|
| DEP-001 | ACCEPTED_DEFERRED | Still present: `tinypool` (critical, GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr) and `@vitest/mocker` (moderate, GHSA-82fw-gwwq-j7x9) via vitest 3.2.7. **Dev-only test runner**; the fix is vitest 5 (major) |
| DEP-003 | OPEN, **severity raised to Medium** | `engines: >=22`; CI tests 22.22.0 and 22.23.3 only. A20-001 is a concrete consequence on Node 26 / npm 12. This audit's full suite passing on Node 26 is new evidence, not a CI line |
| SEC-002 | ACCEPTED_DEFERRED | Rate limits and quotas are still per process |

All other prior IDs are carried into the matrix with their recorded status. This audit did not re-verify their owner decisions.

## 4. NLP and model integration

- **Pipeline:** message → `assertSafeConversationText` (regex refusal, 422) → `parseConversation` (bounded grammar) → optional orchestrator (server-owned routes, privacy class, per-attempt and total deadlines, one transient retry, circuit breaker) → strict `ConversationIntentSchema` → `mergeProviderIntent` → native requirements → proposal that **requires explicit approval**. Provider output can never carry approval, native updates or geometry; the closed schema rejects them (tested).
- **Evaluation:** `scripts/eval-nlp-briefs.ts`, eight briefs with an explicit expected-field rubric.

  | Path | Fields | Status | Evidence level |
  |---|---|---|---|
  | Deterministic, before | 42/47 | 7/8 | Unit |
  | Deterministic, after | 47/47 | 8/8 | Unit |
  | Hosted model | **NOT VERIFIED** | **NOT VERIFIED** | No credentials; no live model call was made |

  The rubric briefs were authored in this work and the grammar was tuned on them; six held-out briefs also pass.
- **Provider behaviour (mocked loopback HTTP server through the real transport and orchestrator):**

  | Case | Result |
  |---|---|
  | 503 then success | Retried once, then succeeds |
  | 503 ×2 | Falls back, fields preserved |
  | 401 | One attempt, then falls back |
  | Hung provider | `PROVIDER_TIMEOUT` within the ~300 ms test deadline, then falls back |
  | Schema violations (numeric site, unknown key, smuggled `approve`/`nativeUpdate`) | Fall back |
  | Markdown-fenced JSON | `PROVIDER_RESPONSE_INVALID`, then falls back |

  The fallback keeps every parsed field in all of these cases.
- **NLP verdict:** the deterministic path is acceptable for its finite grammar. **NLP with a hosted model is NOT VERIFIED**: there is no measured accuracy, latency or 503 rate from a real provider.

## 5. Repairs made in this audit

| Commit content | Files |
|---|---|
| A20-001 install-script approvals and preflight | `package.json`, `test-support/postgres.ts`, `supabase/tests/embedded-postgres-preflight.test.ts` |
| A20-002 restore stand-in length | `apps/api/src/conversation/interpret.ts`, `apps/api/tests/conversation-turns.test.ts` |
| Evidence and reports | `docs/audit/2026-10-20/*.md`, `docs/phase16-evidence/supabase-2026-10-19T18-43-59.358Z.json` (live receipt written by the suite; contains no credentials) |
| Already on this branch (PR #38) | A20-003…005 |

No migration was added. No authentication, RLS, allow-list, validation or rate limit was weakened. No assertion was loosened or skipped.

## 6. Readiness verdicts (separate)

| Target | Verdict | Why |
|---|---|---|
| Local testing | **READY** | Full suite green on this machine (see TEST_AND_RETEST_REPORT); live local Supabase 129/129 |
| Staging acceptance | **NOT READY / BLOCKED** | No staging environment exists (SHOW-001, R28); hosted ledger unread (SUPA-001, R03) |
| Production | **NOT READY** | Staging blockers plus: no malware scanning for uploads (SEC-001), no job sweeper (DEBT-003), process-local limits (SEC-002), unreviewed merges (SEC-007), hosted-model NLP unverified |
