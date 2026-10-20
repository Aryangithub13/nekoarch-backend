# Remaining blockers and unverified criteria — 2026-10-20

Every item below is `BLOCKED` (a prerequisite is unavailable) or `NOT VERIFIED` (evidence is insufficient). None is marked passed. IDs are from this audit (`A20-*`) or carried from `origin/main:docs/BACKEND_REPAIR_LOG.md` and `docs/roadmap/post-audit-risk-register.md` (`R*`).

## 1. Needs credentials, an environment or an authorised operator

| ID | Criterion | Status | Why | Exact action to verify |
|---|---|---|---|---|
| SUPA-001 / R03 / INT-B-025 | Hosted migration ledger matches `0001`–`0033` | BLOCKED | No hosted credentials; contacting hosted needs an authorised operator | Operator runs a read-only `npx supabase migration list --linked` (or `select version from supabase_migrations.schema_migrations`) against a **non-production** project and records the versions, without printing connection strings. No `db push` without separate authorisation |
| SHOW-001 / R28 | Staging proof of one live user workflow | BLOCKED | No staging environment exists | Owner provisions a disposable staging Supabase project and API deployment; run `scripts/test-local-supabase.mjs`'s suite equivalent against it with test identities only |
| SEC-003 | Hosted Auth settings (anonymous sign-ins, JWT expiry) match the tested local config | BLOCKED | Hosted dashboard not accessible | Operator records the hosted Auth settings (no secrets) |
| R04 (CI) | CI `supabase-acceptance` job | BLOCKED | Runs only on `workflow_dispatch` (owner) | Owner triggers `Backend CI` via `workflow_dispatch`; attach the receipt. **Local equivalent passed 129/129 in this audit** |
| A20-NLP-LIVE | NLP accuracy, latency, 429/503 rate and fallback frequency with a hosted model | NOT VERIFIED | No model credentials; no live call was made | Set `AI_ROUTING_CONFIG` plus its key variable in the shell (never in source), then `npx tsx scripts/eval-nlp-briefs.ts --json`; record fields, status, fallbacks and latency |
| A20-006 | Gemini through the provider adapter | BLOCKED (owner) | `validateRemoteEndpoint` accepts only `/v1/chat/completions`; Gemini's compatible path differs. **Not weakened** | Owner decides between (a) an OpenAI-compatible gateway on an allow-listed host at `/v1/chat/completions`, or (b) a dedicated, tested Gemini adapter with its own exact-path allow-list |

## 2. Needs an owner decision (product, contract or policy)

| ID | Decision | Status |
|---|---|---|
| A20-012 / INT-B-011 / INT-B-012 | Whether DB transport failures become 503 (retryable) instead of 500 `DATABASE_ERROR` | BLOCKED |
| A20-008 | Approve a forward migration revoking EXECUTE on the five trigger-only definer functions from `public`, `anon` and `authenticated`. Low risk, not exploitable. A new migration raises the deployed schema version, which the readiness gate (`0032`) enforces | BLOCKED |
| DEP-003 | Pin `engines` to 22.x, or add Node 24/26 (npm 11/12) to the CI matrix. A20-001 shows the gap is real | BLOCKED |
| DEP-001 | Schedule the vitest 3 → 5 major upgrade (dev-only critical `tinypool` advisories) | ACCEPTED_DEFERRED |
| INT-B-001, -002, -003, -010, -014, -018, -019, -020 | Collaboration scope and HTTP contract questions (owner questions 5–14) | BLOCKED |
| AUD-002, PHASE-007, PHASE-009, SUPA-004, SUPA-005 | Compute-limit policy, deferral records, `0030` in-place edit, retention | BLOCKED |
| PHASE-001, -002, -004, -005, -006, INT-B-026, INT-B-030, SEC-007, R19, R22 | Branch, tag and review governance (`main` has unrelated history) | BLOCKED |

## 3. Needs build work (not a bug fix; out of scope for a defect repair)

| ID | Gap | Status |
|---|---|---|
| SEC-001 / R25 | No malware scanning or quarantine for uploads (required before public uploads) | OPEN |
| DEBT-003 / R26 | No background job sweeper (orphaned jobs recover on the next owner read) | OPEN |
| SEC-002 | Rate limits and quotas are per process | ACCEPTED_DEFERRED |
| INT-B-008 | 29 untyped JSON responses in OpenAPI | OPEN |
| INT-B-023 | No contracts package or golden fixtures | OPEN |
| TEST-002 | No single end-to-end live showcase journey (families are covered separately) | OPEN |
| SHOW-003 | No demo-seed script | OPEN |
| DEBT-002 | No `docs/INDEX.md` | OPEN |
| R05 | No golden AI evaluation gate in CI. `scripts/eval-nlp-briefs.ts` is a start, deterministic only | OPEN |

## 4. Not verified by any test in this audit

| Criterion | Status | Action |
|---|---|---|
| Connection-pool or resource exhaustion under load | NOT VERIFIED | Load test against local Supabase (e.g. autocannon) with pool metrics |
| Live database outage during a write (partial-failure reconciliation) | NOT VERIFIED at live level | Stop the local `supabase_db_*` container mid-request in a dedicated test; unit and embedded coverage exists |
| Frontend contract | BLOCKED | SHOW-004 / R21: no frontend repository |
