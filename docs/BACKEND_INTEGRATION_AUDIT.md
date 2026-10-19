# NekoArch backend: adversarial integration audit B

| | |
|---|---|
| **Date** | 2026-10-18 to 2026-10-19 |
| **Type** | Audit of integration, API contracts, phase consistency, migrations and acceptance. **Audit only:** no application code, migration, hosted database, PR or other branch was changed |
| **Code audited** | `phase31/development` @ `6bd84a5` (default branch, the integrated code line) and the PR #31 merge result, tree `d569391` (identical to GitHub's `refs/pull/31/merge` `03ac9e7`) with PR #31 head `479b2bc`. PR #34 (`91118ac`, stacked on PR #31) was read, not built |
| **Frontend** | **Not available.** The NekoArch frontend is a separate repository and no frontend code was read. Every frontend statement in this document is a **contract risk**, with what to check once the frontend is supplied (§2.3) |
| **Independence** | Separate from the security and testing audits: [`BACKEND_AUDIT_REPORT.md`](BACKEND_AUDIT_REPORT.md), [`BACKEND_AUDIT_FOLLOWUP_2026-10-18.md`](BACKEND_AUDIT_FOLLOWUP_2026-10-18.md) and [`BACKEND_COMPREHENSIVE_AUDIT.md`](BACKEND_COMPREHENSIVE_AUDIT.md). None of them was modified. Overlapping items are cross-referenced (§8.2), not repeated |

### Evidence labels

| Label | Meaning |
|---|---|
| **RAN** | Executed in this session. The command and its outcome are in §12 |
| **TEST** | Asserted by a test that I ran in this session and that passed |
| **CI** | Read from a GitHub Actions run (run ID given) |
| **CODE** | Read in the source at the cited path and line, on `d569391` unless stated |
| **DOC** | Stated in a repository document, not re-executed |
| **GH** | Read from the live GitHub API in this session |

Severity: **Critical / High / Medium / Low / Info**. Confidence: **Confirmed** (RAN or TEST), **High** (deterministic from code), **Medium** (inferred from code, not executed).

---

## 0. Summary for the frontend developer

**Verdict: NOT showcase-ready, and not yet a reliable target for a generated frontend client.** The core single-owner flows on `6bd84a5` work locally and are well tested on embedded PostgreSQL: project → generated revision → overview/manifest → 3D scene → selective revision → restore. But six things block safe integration or a demonstration:

1. **The integration target is not fixed** (INT-B-026). B40–B46 (14 of 165 routes, migration `0030`) exist only on unreviewed PR #31, with PR #34 (`0031`) stacked on it. No phase from B31 to B46 is accepted.
2. **The production data path for B31–B46 has never run against real Supabase** (INT-B-024). Integration tests use a test-only PostgreSQL transport with stubbed sessions. The live suite (real JWT and PostgREST) has no scenario for references, account, collaboration, B40 plans, delivery or documents. Its last receipt (2026-10-14, DOC) predates `0030`.
3. **A local setup without the right `PROJECT_COMMIT_SECRET` looks healthy but cannot write** (INT-B-015). Readiness is 200 and discovery says `AVAILABLE`, but writes fail with 503. With a stale secret, which every `supabase db reset` causes, writes fail with a misleading **403 FORBIDDEN**.
4. **Readiness and discovery do not reflect the schema or configuration** (INT-B-017). An API deployed ahead of `0030` advertises `COLLABORATION: AVAILABLE` and fails at runtime.
5. **The machine-readable contract is wrong in places that break generated clients** (INT-B-005 to INT-B-008):
   - `module`, `schedule` and `levelId` path parameters are typed as UUIDs;
   - 4 authenticated routes are marked anonymous;
   - alternative success codes (200 replay, 304) are undocumented;
   - 29 responses have no schema, including `GET /api/capabilities` and the F31 overview.
6. **Browser-facing behaviour hides information the UI needs** (INT-B-009 to INT-B-011, INT-B-031):
   - `Retry-After` is not CORS-exposed;
   - "file too large" is reported as the same `400 INVALID_REQUEST` as malformed JSON;
   - `429` mixes retryable rate limits with non-retryable quotas;
   - behind a proxy without `TRUST_PROXY`, **every user shares one 300 requests/minute bucket** (RAN).

**B44 collaboration needs owner decisions before any UI work** (INT-B-001 to INT-B-003). An invited member cannot open the project, its 3D scene, BIM or drawings; only the six collaboration routes are reachable. Members are invited by raw user UUID, with no lookup. The `editor` role cannot edit.

**What is solid (RAN or TEST).**
- 17 integration-relevant suites (189 tests) pass on the PR #31 merge tree, including the SEC-004 concurrency cap and the B46 end-to-end pipeline.
- CI is green on PR #31 (`479b2bc`), PR #33 and PR #34.
- Field names are camelCase throughout every typed schema.
- Every API error response uses the single `{ error: { code, message, requestId, fieldErrors? } }` envelope (the two health routes use `{ status }` instead), with CORS headers present on 401, 404, 429 and 503.
- Revision writes are compare-and-swap: a missing or stale `baseRevisionId` gives 409, never a lost update.

**Totals:** 31 findings (§8): High 6 · Medium 17 · Low 8. Backlog in §10, questions for the owner and frontend in §11.

---

## 1. Project state re-established

### 1.1 Repository and branches (RAN, GH; 2026-10-19)

| Item | Value | Evidence |
|---|---|---|
| Repository | `github.com/Aryangithub13/nekoarch-backend` | RAN `git remote -v` |
| Default branch | `phase31/development` @ `6bd84a5` "Merge pull request #27 (phase34/diff-integrity)", 178 commits | RAN `git remote show origin`, `git ls-remote` |
| `main` | `0333d65`: documents only, **no common ancestor** with the code line. Moved twice during this audit (`58a19e8` merge of PR #32, then `fb63258`/`0333d65` adding `BACKEND_COMPREHENSIVE_AUDIT.md`) | RAN |
| Working checkout | Started at stale `dd6e469` (README only), fast-forwarded to `origin/main`; this report is the only file added | RAN `git status` |
| Remote branches | 50 at the final listing (`fix/audit-2026-10-18-repairs`, PR #34, appeared during this audit) | RAN |
| Tags | 30. Newest: `backend-v1-phase30-complete` → `401a470`, an ancestor of `6bd84a5`. **No tag for B31–B46** | RAN `git ls-remote --tags`, `git merge-base --is-ancestor` |
| Package | `designflow` 0.1.0; npm workspaces (API plus 6 packages); `engines.node >=22`; lockfile v3; Fastify 5, Zod 3.25.76, `@supabase/supabase-js` | CODE `package.json` |
| Local runtime | Node v22.22.0, npm 10.9.4; Docker client present, **no Docker daemon** (`/var/run/docker.sock` missing) | RAN |

### 1.2 Pull requests (GH)

| PR | Head → base | State | CI on head | Reviews | Integration relevance |
|---|---|---|---|---|---|
| #31 B40 S1+S2, B41–B46 S1 | `479b2bc` → `phase31/development` | open, **not draft**, `mergeable_state: clean`, 11 commits, +15,844/−5,303, 64 files | **Green**, run 39143637924: Node 22.22.0 and 22.23.3, container smoke; `supabase-acceptance` skipped | **0** | +14 routes, `0030`. Empty description; one comment (SEC-004 fix) |
| #34 audit repairs | `91118ac` → `phase40/selective-revision-orchestration` (stacked on #31) | draft | **Green**, run 39156993823 | — | `0031`, one live scenario (written, **not run**), retry 429s |
| #33 BUG-001 | `b3f0837` → `phase31/development` | draft | **Green**, run 39140096759 | — | Clean shutdown without Sentry; no contract change |
| #29 B39 release gates | `c155d5a` → `287b1a4` (behind the base) | draft | Green, run 38682813211 (2026-10-15) | — | D-9/D-10/D-11 runbook predates `0030`/`0031` (PHASE-003) |
| #32 audit docs | → `main` | merged 2026-10-18 16:13 UTC | — | — | — |
| #27 B34 repair | → `phase31/development` | merged 2026-10-17 as `6bd84a5` | — | — | — |
| #24 B39 S1 follow-up | `82d7373` | **closed, not merged** | — | — | Superseded: the same `FAILED` mapping is on the code line (`services/specialist-service.ts:197` @ `6bd84a5`) |

### 1.3 Earlier findings re-checked against current code

| Earlier item | Re-check here | Result |
|---|---|---|
| PR #31 / migration `0030` | Built the merge tree; `0030` is additive and contiguous after `0029` | Confirmed. `0030` header (`0030_collaboration.sql:1-3`) states membership reaches only the collaboration RPCs: the root of INT-B-001 |
| SEC-004 (200-comment cap race) | RAN `collaboration.integration.test.ts` on `d569391`: "holds the comment and member caps under concurrent writes" | **Executed and passed** (1 run). The advisory lock is at `0030:125`. The without-lock failure was not re-run here (prior sessions: 5/5 failed, DOC) |
| PR #29 | Head unchanged, base still `287b1a4` | Still stale against `6bd84a5` and `0030`/`0031` |
| B34 | Repair merged (`6bd84a5`); `phase34-closure.md` §6 still "None recorded yet" (DOC) | **Not accepted.** Live scenario absent on `6bd84a5` and #31 (grep count 0); written on #34 (`137fca0`), not executed |
| B37 | Merged as `4d1da13`; its own gap report says "Do not accept as-is" (DOC `phase37-acceptance-gap-report.md` §0) | Implemented, not accepted |
| B39 | Verdict "BLOCKED — external gate: the B34 repair" (DOC `b39-acceptance-audit.md` §8). That repair is now merged, but no re-acceptance is recorded | Implemented, not accepted |
| B40–B46 | Only on PR #31. Plan of record: "No phase is complete" (DOC `docs/roadmap/b40-b46-implementation-plan.md` §4) | See §5 |

---

## 2. Frontend/backend boundary

### 2.1 Intended boundary (roadmap)

From [`NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md`](sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md):

- **Frontend owns:** Three.js/WebGL, GSAP, camera choreography, boot and scroll animation (§A3). It also owns its **mock adapters**, which must be labelled as mocks (§E, §I rule 1).
- **Backend owns:** typed intent, models, constraints, orchestration, validation, security, audit and state (§A). It also owns a "source-derived API-to-TypeScript compatibility sheet and OpenAPI/schema fixtures" (B29) and "source-verified frontend adapters" (B45).
- **Acceptance rule:** "UI completion … does not prove a live backend endpoint" (§A3). "A mock UI … never counts as backend completion" (§K). Scenario 47: "generated shared TypeScript schema and actual backend sample payloads match; F30/F31/F41–48 client adapters pass staging tests without mocks."

### 2.2 Actual boundary (CODE, RAN)

| Concern | Who does it | Evidence |
|---|---|---|
| Sign-up, sign-in, refresh, sign-out | **Frontend, directly with Supabase Auth** (supabase-js). The backend has no auth routes | No auth route in the 165-route catalog |
| Session check | Backend calls `auth.getUser(token)` on every authenticated request: invalid token 401, Auth outage 503 `AUTH_UNAVAILABLE` | `lib/supabase.ts:191-194`; RAN probe |
| Data access | Backend only, with the anon key plus the caller's bearer token (RLS applies); writes go through signed `SECURITY DEFINER` RPCs | `lib/supabase.ts`, `0023:102-114` |
| Transport | JSON over HTTPS; reference uploads are raw bodies; GLB, SVG, CSV, IFC and reference bytes are binary | `routes/references.ts:38-67` |
| Progress | **Polling only** (`GET …/jobs/:jobId/events?after=N`). No SSE, websocket or Supabase Realtime | `jobs/contracts.ts:38`; no `channel(` in `apps/api/src` |
| Contract artefacts | `docs/modernization/openapi.json` (OpenAPI 3.0.3, 165 operations), `api-routes.json`, and `GET /api/compatibility` (route-catalog hash). `@designflow/shared` is `private: true` and holds only early-phase types; most contracts live in `apps/api/src/**/contracts.ts` | CODE `packages/shared/package.json`; INT-B-023 |
| Local Auth defaults | `site_url = http://localhost:5173`, no extra redirect URLs, JWT 3600 s, anonymous sign-ins **on**, email confirmations **off** | CODE `supabase/config.toml:25-33` |
| Hosted Auth settings | **Unknown** (no access; cross-ref SEC-003) | — |

### 2.3 What must be checked once the frontend is supplied

1. Every path, method and field the frontend's service layer (F12) calls, diffed against `api-routes.json` and the typed schemas. List any call with no backend route.
2. Whether its client is generated from `openapi.json`, and with which generator. INT-B-005 to INT-B-008 decide whether that generator is usable.
3. Its retry and backoff logic for 429 and 503 (INT-B-009, INT-B-011), and whether it adds `Idempotency-Key` to writes (INT-B-014).
4. Whether it caches ETags itself (`Cache-Control: no-store` on almost everything) and handles 304 on `scene/delivery`, GLB and reference content.
5. Its upload size guard (INT-B-010) and any custom request headers (only `Authorization`, `Content-Type`, `Idempotency-Key` and `If-None-Match` are allowed).
6. The origins it is served from, per environment (INT-B-016).
7. Which overview it uses for F31 (`overview` v1 or `manifest` v2) and which listing for F23 (`/api/projects` or `/api/library/projects`) (INT-B-019).
8. Its collaboration UI assumptions (INT-B-001 to INT-B-003).

---

## 3. API contract inventory and compatibility

### 3.1 Route inventory (RAN, CODE)

| | `6bd84a5` | PR #31 merge |
|---|---|---|
| Routes (live route table, `api-routes.json`) | 151 | **165** (+14: compatibility, 6 collaboration, feasibility, integration plans ×2, instructions, scene delivery, routing ×2) |
| By method | GET 88, POST 56, PATCH 5, DELETE 2 | GET 93, POST 64, PATCH 5, DELETE 3 |
| Typed success response in OpenAPI | 122 | 136 (**29 untyped on both**) |
| Auth | | 158 require a session. The OpenAPI tags only 154 of them (INT-B-006). 3 are anonymous (`/health/live`, `/health/ready`, `/api/capabilities`), 3 take an optional session (`/api/regions`, `GET /api/plans/:id`, `…/public`) and 1 uses a link token (`/api/reference-downloads`) |
| Writes (POST/PATCH/DELETE) | | 72. `Idempotency-Key` gets a stored receipt on **25**, a service-level keyed replay on 2, and is **ignored on 45** (INT-B-014) |

The complete per-route table (method, path, auth, rate-limit group, idempotency, documented success codes, response-schema status, paging) is **Appendix A**. It was generated from `api-routes.json`, `openapi.json`, `lib/http-protection.ts` and the `0023` idempotency allow-list. Request bodies and validation rules are the Zod schemas in `test-support/openapi.ts` `CONTRACTS`, rendered in `openapi.json`.

### 3.2 Cross-cutting conventions, as implemented

| Convention | Actual behaviour | Evidence | Consistent? |
|---|---|---|---|
| Error envelope | `{ error: { code, message, requestId, fieldErrors? } }`. Validation `fieldErrors` keys are dotted paths, or `_root`; params, query and body share one namespace | `app.ts:93-106`, `lib/errors.ts:8-20`; RAN probe | Yes (shape); **no code catalog** (INT-B-012) |
| Non-API errors | Unmatched route 404 `NOT_FOUND`. Malformed JSON 400 `INVALID_REQUEST`. **413 and 415 are rewritten to 400 `INVALID_REQUEST`**. 5xx 500 `INTERNAL_ERROR` | `app.ts:95-99`; RAN | INT-B-010 |
| Health | `/health/live` `{status:'ok'}`. `/health/ready` `{status:'ok'\|'unavailable'}` (not the error envelope). HEAD returns 404 | `app.ts:112-119`; RAN | INT-B-017, INT-B-028 |
| Auth | `Authorization: Bearer <Supabase access token>`; missing or invalid 401; Auth outage 503. Validation runs **before** auth on the 4 legacy routes (cross-ref API-002) | `lib/auth.ts`, `routes/plans.ts:13,19,31`, `routes/estimates.ts:10`; RAN | Mostly |
| Ownership | A foreign or missing project or revision is 404 (RLS), never 403 | TEST (e2e, collaboration, projects suites) | Yes |
| Concurrency | Revisions: `baseRevisionId` compare-and-swap; null on a non-empty project gives 409 `REVISION_CONFLICT` (`0006:211`). Conversations, turns and settings: `expectedVersion`. Reviews: `expectedModelHash`. B40: `planHash` | CODE; TEST `projects.integration` "rejects stale and missing bases" | Yes |
| Idempotency | Optional `Idempotency-Key` (1–128 of `[A-Za-z0-9._:-]`); a replay returns the stored body; no replay header | `lib/idempotency.ts:15-46` | Partial (INT-B-014) |
| Paging | Mostly `limit` + opaque base64url `cursor` → `nextCursor` | §3.3 | Partial (INT-B-013) |
| Caching | `Cache-Control: no-store` on every response except `scene/delivery` (`private, no-cache`) and reference bytes (`private, no-store`). Strong `ETag` + `If-None-Match` → 304 on GLB, scene delivery and reference content | `app.ts:76`, `routes/delivery.ts:26-28`, `routes/references.ts:21-29` | Client must handle 304 itself |
| Units and IDs | Integer millimetres in models and manifests; GLB in metres; stable element IDs shared across model, BIM, scene, comments and change sets | `delivery/contracts.ts:28`, `services/delivery-service.ts:29-33` | Yes (TEST delivery, e2e) |
| Casing | camelCase fields everywhere (0 snake_case properties in any OpenAPI schema). Enums are mostly UPPER_CASE, but `sourceMode` (`generated`/`supplied`) and roles (`owner`, `editor`…) are lower-case | RAN scan of `openapi.json` | Fields yes; enum casing mixed |
| Timestamps | Three schema styles: `z.string().datetime()` (UTC `Z`), `datetime({ offset: true })`, and free strings (`collaboration/contracts.ts:22` `ts = z.string().min(1).max(40)`, filled from `jsonb` timestamptz) | CODE | INT-B-018 |
| Rate limits | Per IP (300/min, before Auth) plus per user per group: read 120, write 30, generate 10 per 60 s | `config/env.ts`, `lib/http-protection.ts` | INT-B-011, INT-B-031 |
| CORS | Origins from `CORS_ORIGINS`, default `http://localhost:5173` outside production. Methods GET/POST/PATCH/DELETE. Allowed headers `Authorization`, `Content-Type`, `Idempotency-Key`, `If-None-Match`. **Exposed headers `x-request-id`, `ETag` only** | `app.ts:70-72`, `config/env.ts:76`; RAN | INT-B-009, INT-B-016 |

### 3.3 Paging variants (CODE)

| Variant | Routes | Query | Response |
|---|---|---|---|
| Opaque cursor | projects, revisions, takeoffs, construction, costs, references, jobs, library, briefs, evidence, design concepts, revision operations, analyses lists, scene artifacts, workflows | `limit` 1–100 (default 20), `cursor` | `nextCursor` (null at the end) |
| UUID cursor | conversations | `limit` **1–20**, `cursor` = UUID | `nextCursor` |
| Element-ID keyset | BIM elements and relationships | `limit` 1–100 (default 50), `after` = `bim-<sha1>` | **`nextAfter`** (`routes/bim.ts:27`) |
| Sequence keyset | job events | `after` integer ≥ 0, `limit` 1–200 (default 100) | **`nextAfter`** |
| None, silently capped | B44 workspace revisions (100), comments (200), reviews (100); overview artifacts (20, with a `truncated` flag) | — | Collaboration: **no truncation flag** |

---

## 4. Workflow-level integration

Owner-path journeys were traced through route → service → RPC → response. "Outcome" is the strongest evidence level that exists. The embedded-PostgreSQL tests cover RLS and RPCs; they use stubbed sessions, not Supabase Auth or PostgREST.

| # | Workflow | Prerequisite | API calls (in order) | Expected state transitions | Existing evidence | Missing test | Outcome | Blocker |
|---|---|---|---|---|---|---|---|---|
| W1 | Sign-in, session recovery, protected access | Supabase project; frontend has the URL and anon key | Supabase Auth (client) → any API call with a bearer token | Valid session 2xx; invalid 401; Auth outage 503 | RAN probe (401/503 with CORS); `foundation`, `hardening` (mocked Auth); live suite through `0029` (anonymous sign-in, DOC 2026-10-14) | Expired, refreshed and revoked token against real GoTrue; refresh during a long upload | Partially verified | No Docker here; hosted Auth settings unknown (SEC-003) |
| W2 | Project create, list, open, rename, archive | W1 | `POST /api/projects` → `GET /api/projects` or `GET /api/library/projects` → `GET P` → `PATCH P` (`title`, `status`) → `PATCH P/library` (star, tags) | ACTIVE ↔ ARCHIVED; an archived project refuses new revisions (409 `PROJECT_ARCHIVED`) | TEST `projects.integration` (23), `account.integration` (5) | Search, rename and archive through a real JWT | Implemented and tested (embedded) | **No delete** (INT-B-020); two listings (INT-B-019) |
| W3 | Generate first revision, then read the overview or manifest | W2 | `POST P/revisions/generate` (`baseRevisionId: null`) → `GET P/R/overview` or `GET P/R/manifest` → `GET P/R/dependency-graph` | Revision 1 becomes current; outputs NOT_GENERATED until run | TEST `e2e-pipeline` (generate step), `modernization.integration`; manifest live through `0028` (DOC) | Overview through real JWT | Implemented and tested (embedded) | Overview response untyped (INT-B-008) |
| W4 | 3D scene | W3 | `POST P/R/scene/artifacts` (or `POST P/jobs` SCENE_COMPILE) → `GET …/scene/artifacts/:id/manifest` → `…/glb` (gzip, ETag) → `GET P/R/scene/delivery` (PR #31) | Artifact bound to the revision; HISTORICAL after a new revision | TEST `delivery.integration`, `jobs.integration`, `e2e-pipeline` | 304 revalidation from a browser; delivery through real JWT | Implemented and tested (embedded) | Renders, 360° and LOD are typed UNSUPPORTED; no chunked GLB (B45 §2) |
| W5 | Selective revision (B30) and restore | W3 | `POST P/revision-operations` (preflight) → `POST …/:op/execute` → `GET …/comparison`, `…/validation`, `…/candidate/manifest`, `…/candidate/glb` → `POST …/approve` (`preflightHash`, `candidateHash`) or `…/reject` or `…/cancel` → restore is a new RESTORE operation | Candidate never touches the accepted revision; approve compare-and-swaps a new revision; restore creates N+1 | TEST `revision.integration` (14), `e2e-pipeline` (restore to revision 3 with revision 1's hash) | **Live frontend F30 edit** (roadmap B29/B30 gate): "BLOCKED (repository not on this machine)" (DOC `phase30-report.md:129`) | Implemented, not accepted | Supported scope is exterior finish appearance only |
| W6 | NL instruction → B40 plan → execute (PR #31) | W3 | `POST P/R/instructions/resolve` → `POST P/integration/plans` (200, nothing stored) → `POST P/integration/plans/execute` (`planHash`, consent; `Idempotency-Key` resumes after the last checkpoint) | New revision plus Materials → Budget chain plus verification branch | TEST `e2e-pipeline`; CI `integration-plan*`, `integration-branches` | Any live scenario (written on #34, not run) | Implemented on an unmerged PR | INT-B-026, INT-B-024 |
| W7 | Conversation (B20/B36 turns) | W2 | `POST P/conversations` (client `conversationId`) → `POST …/turns` (`expectedVersion` 0–99) → `POST …/actions/:actionId/decisions` → `POST …/rebase` → `GET …/context` | Version +1 per accepted write; **hard cap 100** → 429 `CONVERSATION_LIMIT` | CI `conversations*` (not re-run here); live suite Phase 20 scenario | Turns (`0026`) through real JWT | Implemented and tested (embedded, CI) | 429 used for a permanent cap (INT-B-011) |
| W8 | Reference upload and download (B31) | W2 | `POST P/references/validate` (raw body) → `POST P/references?purpose=…` (201, or 200 when deduplicated) → `GET P/references` → `…/content` (ETag) → `POST …/download-links` → anonymous `GET /api/reference-downloads?token=…` → `PATCH` / `DELETE` | ACTIVE → ARCHIVED → DELETED (bytes purged, tombstone kept) | TEST `references.integration` (11) | Any live scenario (0 references calls in the live suite); oversized file from a browser | Implemented, not accepted | No malware scan or quarantine (SEC-001); 413 is masked (INT-B-010) |
| W9 | Durable jobs and progress (B32) | W3 | `POST P/jobs` (202) → poll `GET …/jobs/:id/events?after=N` → `POST …/cancel` or `…/retry` | QUEUED → RUNNING → SUCCEEDED / FAILED / CANCELLED; an expired lease is recovered on the next read | TEST `jobs.integration` (8: progress, retry backoff, lease recovery, 404/401) | Kill-worker recovery live (roadmap 24/44); polling under rate limits | Implemented, incompletely tested | No sweeper (DEBT-003); retry bypassed limits until PR #34 (DB-002); polling uses the 120/min read quota (INT-B-011) |
| W10 | Account, settings, brief, context (B33) | W1 | `GET/PATCH /api/me/settings` (`expectedVersion`) → `GET /api/me/usage` → `POST P/brief/versions` → `GET P/context` | Settings version +1; brief versions immutable | TEST `account.integration` (5) | Any live scenario; deletion propagation (roadmap 22/45) | Implemented, incompletely tested | No clear or delete (INT-B-020); currency fixed to `INR` |
| W11 | Collaboration (B44, PR #31) | W3, a second user's UUID | Owner `POST P/collaboration/members` → member `GET P/collaboration` → `GET P/collaboration/R` → `POST …/comments` → `POST …/reviews` (`expectedModelHash`) → owner `DELETE …/members/:userId` | Member active or removed; comments and reviews immutable | TEST `collaboration.integration` (2, incl. caps under concurrency); TEST: a member gets **404 on `GET /api/projects/:id`** (`collaboration.integration.test.ts:60`) | Live RLS through PostgREST (written on #34, not run); a member opening the 3D scene | Implemented on an unmerged PR | INT-B-001, INT-B-002, INT-B-014 |
| W12 | Engineering and analysis reads (B24–B28, B34, B35) | W3 | `POST …/{structural,environmental,systems,knowledge}/analyses`, `…/optimization/studies`; `GET/POST P/R/verification`, `…/verification/diff`, `…/engineering-assessment*` | Analyses bound to a revision; verification computed on read | TEST `verification.integration` (5); CI for the rest | B34 and B35 through real JWT | Implemented, not accepted (B34, B35) | List and status responses untyped (INT-B-008) |
| W13 | Documents and evidence (B38) | W3 | `GET P/R/documents` → `…/plan-sheets/:levelId` (SVG) → `…/schedules` → `…/schedules/:schedule/csv` → `POST P/R/evidence-packages` | Documents derived on read; evidence package deduplicated per input hash (`0027:21`) | CI | Any live scenario for documents; evidence live through `0027` (DOC) | Implemented, incompletely tested | `levelId` and `schedule` mistyped in OpenAPI (INT-B-005); no PDF or DXF |
| W14 | Specialists (B39) | W3 | `POST P/specialists/:module/requests` (`Idempotency-Key` → keyed replay) | 201 stored, or 200 refusal or replay; Blueprint may return **FAILED after committing** | CI `specialists*`; live S1–S3 (DOC, ≤ `0029`) | Re-acceptance after the B34 merge | Implemented, not accepted | INT-B-021; `module` mistyped (INT-B-005) |
| W15 | Cleanup and lifecycle | any | archive (`PATCH P` `status`), `DELETE` reference, `DELETE` conversation, `DELETE` member | Soft states only | TEST: a second member DELETE gives 404 `MEMBER_NOT_FOUND` (`collaboration.integration.test.ts:96`) | Account deletion; project deletion | **Documented but not implemented** (project and account deletion) | INT-B-020, SUPA-004 |

---

## 5. Phase and roadmap integrity

### 5.1 Status by phase (evidence-backed)

Categories are the ones requested: **IT** implemented and tested · **II** implemented but incompletely tested · **DN** documented but not implemented · **IA** implemented but not accepted · **BE** blocked by environment or access · **SS** superseded · **UK** unknown.

| Phase | Source | Tests | API contract | Migration | Acceptance evidence | Merge / release | Status |
|---|---|---|---|---|---|---|---|
| B01–B04 | on code line | CI full suite | n/a | — | reported only; no commit or tag precedes Phase 5 (DOC E-01) | — | **IT** (history DOC-only) |
| B05–B28 | on code line | CI full suite green | OpenAPI typed except 29 ops (INT-B-008) | `0001`–`0018` | tags `phase5`–`phase28-complete` | tagged | **IT** within documented bounds (≤ 2 storeys, synthetic rates; DOC E-02 to E-05) |
| B29 3D | on code line | TEST delivery/jobs; CI | overview untyped | `0019` | tag `phase29-complete`; roadmap gate "live frontend F30 edit and F35 overview" not run | tagged | **IA** (renders, 360° and LOD are typed UNSUPPORTED) |
| B30 selective revision | on code line | TEST revision (14), e2e | typed | `0020` | tag; "frontend adapter verification: BLOCKED" (DOC `phase30-report.md:129`) | tagged | **IA** |
| B31 references | on code line | TEST references (11) | typed (dedup 200 undocumented) | `0021`, `0024` | no live scenario; no scanner or quarantine (SEC-001) | untagged | **IA** |
| B32 jobs | on code line | TEST jobs (8) | typed | `0022` (`0031` on #34) | no kill-worker live run; retry limits fixed only on #34 | untagged | **II** |
| B33 account | on code line | TEST account (5) | typed | `0023` (`0031` on #34) | no live scenario; no erasure | untagged | **II** |
| B34 verification | on code line (repair `6bd84a5`) | TEST verification (5); CI | typed | none | closure §6 empty; live scenario only on #34, not run | untagged | **IA** |
| B35 / B35.1 | on code line | CI | typed | none | own report: "PARTIALLY COMPLETED" (DOC) | untagged | **II** |
| B36 compute | on code line | CI | typed | `0025`, `0026` | roadmap gate unmet: local pool only, remote dispatch disabled by policy (DOC E-13) | untagged | **IA** |
| B37 manifest | on code line | CI; live through `0028` (DOC) | typed | `0027`/`0028` era | gap report "Do not accept as-is" (DOC); **no `phase37-api.md`** | untagged | **IA** |
| B38 documents | on code line | CI | typed | `0027` | SVG and CSV only; **no `phase38-api.md`** | untagged | **II** |
| B39 specialists | on code line | CI; live S1–S3 (DOC) | typed, but `module` mistyped | `0028`, `0029` | verdict "BLOCKED" on the B34 repair; repair merged, re-acceptance not recorded | untagged | **IA** |
| B40 S1+S2 | **PR #31 only** | CI; TEST e2e | typed | none | slice record: "B40 is not complete" | unmerged, 0 reviews | **IA** (non-default branch) |
| B41 S1 | PR #31 only (an earlier partial exists as "Phase 36" turns) | CI; release evidence `PASSED_WITH_SUITE_ERRORS`, exit 1 on Windows | typed | none | not complete | unmerged | **IA** |
| B42 S1, B43 S1 | PR #31 only | CI | typed | none | not complete | unmerged | **IA** |
| B44 S1 | PR #31 only | TEST collaboration (2) | typed; routes differ from the plan (INT-B-004) | `0030` (edited in place, PHASE-009) | live scenario only on #34, not run | unmerged | **IA** |
| B45 S1 | PR #31 only | TEST delivery (2) | typed; 304 undocumented | none | no GPU or desktop measurement (out of scope by design) | unmerged | **IA** |
| B46 S1 | PR #31 only | TEST e2e (1) | — | none | its gate (real staging, frontend-connected) cannot run | unmerged | **IA** for the slice; gate **BE** |

### 5.2 Integrity defects

| Defect | Evidence | Finding |
|---|---|---|
| Features that exist only on non-default branches: all of B40–B46, `0030`, `0031` | GH; RAN `git rev-list` | INT-B-026 |
| Phase-order deviation: B40–B46 slices were built before B31, B32, B34, B36, B37 and B39 were accepted. Roadmap §I rule 6 requires a "tagged clean source checkpoint" per release; none exists after B30 | RAN tags; DOC | INT-B-026 |
| Release evidence generated on Windows / Node 24 (CI uses Linux / Node 22), with one suite error (`B41 S1`, exit 1) | DOC `docs/phase46/release-evidence.json` `environment`, `suites[1]` | INT-B-026 |
| Plan of record names B44 routes that do not exist | DOC `b40-b46-implementation-plan.md:27` vs CODE `collaboration/contracts.ts:10-15` | INT-B-004 |
| No API document for B37, B38 or B40–B46 (frontend-facing) | RAN `ls docs/phase37 … phase46` | INT-B-027 |
| Superseded branches: `phase39/s1-specialists` (PR #24: behaviour already at `specialist-service.ts:197`), `phase37/read-cap` (superseded by PR #19's bounded reads, `lib/bounded-reads.ts`), `docs/roadmap-research-baseline` (2 unmerged doc commits) | RAN `git cherry` | INT-B-030 |
| `main` has unrelated history and is docs-only | RAN | cross-ref PHASE-001 |
| The live acceptance gate is missing from PR CI (`workflow_dispatch` only) | CODE `.github/workflows/backend-ci.yml` | INT-B-024 |
| Runbook PR #29 predates `0030`, `0031` and the B34 merge | GH | cross-ref PHASE-003 |

**Capabilities to accept, defer or remove explicitly** (owner, §11): the 3 deferred B34 capabilities; member access to the analysis routes (B44 §2); B29 renders, 360° and walkthrough paths; B31 malware scanning; B32 push progress and sweeper; B33 erasure; B36 remote dispatch; B38 PDF and DXF.

---

## 6. Database, migrations and Supabase acceptance

### 6.1 Migration inventory (RAN over the SQL on `d569391`, plus `0031` from PR #34)

`tbl` tables · `fn` functions · `pol` policies · `trg` triggers · `idx` indexes · `casc` `ON DELETE CASCADE` clauses (counts of `create …` statements).

| Migration | Lines | tbl | fn | pol | trg | idx | casc | Purpose and notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `0001_core_tables` | 70 | 2 | 2 | 0 | 3 | 2 | 1 | plans, estimates base |
| `0002_rate_tables` | 40 | 2 | 1 | 0 | 0 | 2 | 1 | rate tables; `/health/ready` reads `rate_table_versions` |
| `0003_estimates_and_logs` | 96 | 2 | 4 | 0 | 4 | 4 | 1 | |
| `0004_rls_policies` | 51 | 0 | 0 | 10 | 0 | 0 | 0 | first RLS policies |
| `0005_idempotency` | 60 | 1 | 1 | 3 | 0 | 1 | 1 | `idempotency_records` |
| `0006_projects` | 284 | 5 | 9 | 3 | 3 | 6 | 4 | projects and revisions; **`project_private.commit_key` random per database** (`0006:10`) |
| `0007`–`0010` | 133–260 | 1 each | 3–6 | 1 | 1 | 1–3 | 0 | takeoffs, construction, BOQ costs, workflows |
| `0011_generation_freshness` | 207 | 0 | 8 | 0 | 0 | 2 | 0 | 4 `create or replace` |
| `0012`, `0013` | 129, 90 | 1, 0 | 2, 1 | 1, 0 | 0 | 2, 0 | 2, 0 | conversations (version 0–100, `0012:10`) |
| `0014`–`0018` | 163–222 | 1 each | 3 | 1 | 1 | 2–5 | 0 | structural, environmental, systems, knowledge, optimization |
| `0019_scene_artifacts` | 200 | 2 | 3 | 1 | 2 | 2 | 0 | |
| `0020_revision_operations` | 434 | 5 | 13 | 4 | 5 | 4 | 3 | B30 |
| `0021_reference_ingestion` | 320 | 3 | 8 | 2 | 3 | 5 | 2 | B31 |
| `0022_durable_jobs` | 287 | 2 | 7 | 2 | 2 | 4 | 3 | B32 |
| `0023_account_library_context` | 320 | 3 | 12 | 3 | 4 | 1 | 2 | B33; `verify_envelope` (`0023:102-114`); **latest idempotency allow-list (25 routes, `0023:78-99`)** |
| `0024_constant_time_download_token` | 30 | 0 | 1 | 0 | 0 | 0 | 0 | `create or replace` |
| `0025_compute_gateway` | 100 | 1 | 3 | 1 | 1 | 2 | 1 | B36 |
| `0026_conversation_turns` | 106 | 0 | 1 | 0 | 0 | 0 | 0 | renumbered from a parallel branch (DOC) |
| `0027_evidence_packages` | 156 | 1 | 3 | 1 | 1 | 2 | 0 | unique per (revision, input hash) |
| `0028_design_concepts` | 159 | 1 | 4 | 1 | 1 | 3 | 0 | |
| `0029_interior_finish_operations` | 202 | 0 | 2 | 0 | 0 | 0 | 0 | B39 S3 |
| **`0030_collaboration`** (PR #31) | 183 | 3 | 4 | 3 | 2 | 3 | 3 | B44; additive; advisory lock at `:125`; **edited in place** in `479b2bc` |
| **`0031_quota_integrity`** (PR #34) | 41 | 0 | 3 | 0 | 1 (re-created) | 0 | 0 | B32/B33 owner-wide locks; replaces 3 trigger functions and re-creates `account_job_quota` (forward-only) |

### 6.2 Checks

| Check | Result | Evidence |
|---|---|---|
| Numbering and ordering | `0001`–`0030` contiguous on the merge tree; `0031` on #34; no duplicates | RAN |
| Clean install | Every migration applies in order on embedded PostgreSQL 18 (`supabase/tests/database.test.ts`, 20 tests) | **TEST** (RAN) |
| Existing-database upgrade | **Not tested anywhere.** Replay always starts empty; no fixture upgrades a database holding `0001`–`0029` data to `0030`/`0031` | RAN grep; DOC |
| Destructive DDL | None: no `drop table/column/function/policy`. Only `drop constraint` on two check constraints, re-added wider, and one `drop trigger` / `create trigger` in `0031` | RAN grep |
| Code ↔ schema across PRs | The `6bd84a5` API works on a database with `0030` (it never calls the new RPCs). **The PR #31 API requires `0030`; the PR #34 API requires `0031`**. No startup or readiness check enforces this | CODE; INT-B-017 |
| App validation vs DB constraints | Consistent where checked: comment body 1–2000 and ≤ 16 element IDs (`0030` and `CommentRequestSchema`); conversation version 0–100 (`0012:10`) and `expectedVersion` ≤ 99 | CODE |
| Cascades | `projects(id) on delete cascade` into the immutable `0030` comment and review tables: a project delete can never succeed once a comment exists (SUPA-004, now concrete) | CODE `0030:5,17,31` |
| RLS and grants on `0030` | RLS enabled; `revoke all` and then `select` only to `authenticated`; RPC `execute` granted to `authenticated` only; definer functions pin `search_path = ''` | CODE `0030:43-47,181-183` |
| Auth identity mapping | `member_upsert` requires `auth.users` to contain the user (`0030:130`); `user_settings.user_id` has no FK (DOC E-10) | CODE |
| Service role | Never used by the API; only by local tooling (`SUPABASE_SERVICE_ROLE_KEY` in `.env.example`) | CODE |
| Concurrency invariants | SEC-004 caps hold (**TEST**, RAN). DB-001/DB-002 quota races fixed only on #34 (CI 39156993823) | RAN; CI |
| Rollback | **No down migrations, and none documented.** Every repair is forward-only (`0031` header) | CODE |
| Migration content integrity | The hosted ledger check compares **version and name only** (`scripts/verify-hosted-migrations.mjs:19-33`). An in-place edit (as `0030` had) is undetectable | CODE; INT-B-025 |
| Backfill and duration | No backfill in `0030` or `0031`; `0031` replaces trigger functions (fast). Lock-time risk is low but unmeasured on a populated database | CODE |

### 6.3 Acceptance evidence by level (kept separate)

| Level | What it proves | B05–B30 | B31–B39 | B40–B46 (`0030`) | `0031` |
|---|---|---|---|---|---|
| 1. Unit tests | Pure logic | CI green | CI green | CI green (PR #31) | CI green (PR #34) |
| 2. Embedded PostgreSQL (real RLS and RPCs; **test-only transport `test-support/pg-backend.ts`, stubbed sessions**) | SQL, RLS, RPC semantics | CI; **RAN** subset | **RAN** subset (references, jobs, account, verification) | **RAN** (collaboration, delivery, e2e) | CI only |
| 3. Local Supabase (GoTrue + PostgREST + real JWTs, `supabase.live.test.ts`) | The production adapter path (`lib/supabase.ts`), PostgREST grants, real Auth | last receipt 125/125 on `c343855`, 2026-10-14 (DOC), ≤ `0029` | partial: specialists S1–S3, compute, manifest, evidence and concepts (DOC). **0 calls** for references, account, library, brief, context, documents, dependency graph, engineering assessment, turns | **none run**. A scenario is written on #34 (`137fca0`) | none |
| 4. Hosted read-only ledger | Which migrations the hosted DB has | last reported at `0017` (DOC) | not run | not run | not run |
| 5. Hosted or staging end-to-end | Deployed behaviour | none after B30 | none | none | none |

**This session:** level 3 is **BLOCKED** (no Docker daemon). Levels 4 and 5 were **not attempted** (no credentials or authorization; forbidden by scope). B34 has **no dedicated live scenario on the code line or on PR #31**; the one on PR #34 has never run. This is a missing acceptance test, not something another phase covers.

---

## 7. Environment and deployment readiness

### 7.1 Variables (CODE `apps/api/src/config/env.ts` vs `.env.example`; values not printed)

| Variable | Schema | `.env.example` | Default and behaviour | Issue |
|---|---|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | required | yes | startup fails without them | — |
| `PROJECT_COMMIT_SECRET` | optional, 64 hex | yes ("Missing key disables revision writes") | Absent: **503 on writes** in development, readiness 503 only in production. Must equal `project_private.commit_key`, which `db reset` regenerates | INT-B-015 |
| `CORS_ORIGINS` | optional | yes | development and test: `http://localhost:5173`. **Production: empty means deny all browsers, with no startup error** | INT-B-016 |
| `TRUST_PROXY` | optional | yes (well commented) | empty: forwarded headers ignored | INT-B-031 |
| `SENTRY_DSN` | required in production | yes | BUG-001 fixed only on PR #33 | cross-ref |
| `COMPUTE_POLICY` | optional JSON | **missing** | `{}`; remote execution fails startup | INT-B-029 |
| `AI_ROUTING_CONFIG`, `AI_PROVIDER_*_API_KEY` | optional | yes | providers off by default | — |
| `RATE_LIMIT_*`, `*_TIMEOUT_MS`, `*_BODY_LIMIT_BYTES` | defaults | yes | read 120 / write 30 / generate 10 / IP 300 per 60 s; body 1 MiB (64 KiB for `/api/plans/generate`, `/api/estimates`); references 10 MiB | INT-B-011 |
| `SUPABASE_SERVICE_ROLE_KEY` | not in schema | yes | tooling only (`scripts/test-local-supabase.mjs`) | listed beside API variables; clarify |
| Script-only | `HOSTED_DB_URL`, `STAGING_OWNER_TOKEN`, `STAGING_OTHER_TOKEN`, `UPDATE_ROUTE_CATALOG`, `B46_TIMINGS_FILE`, evidence paths | no | — | document in the runbook |
| Frontend | — | — | needs the Supabase URL, the anon key and the API base URL. **No document says so** | INT-B-029 |

### 7.2 Build, runtime and operations

| Item | State | Evidence |
|---|---|---|
| Node | `engines >=22`; CI pins 22.22.0 and 22.23.3; Docker `node:22-bookworm-slim`; `supabase-acceptance` job uses unpinned `'22'`; B40–B46 release evidence came from Node 24 / Windows | CODE, DOC |
| Lockfile | `npm ci` succeeds with the locked tree (RAN) | RAN |
| Container | `HOST=0.0.0.0`, non-root `node` user, `HEALTHCHECK` on `/health/live` (GET), `STOPSIGNAL SIGTERM`; smoke test green in CI | CODE `Dockerfile`; CI |
| Health and readiness | readiness = commit secret (production only) plus one `rate_table_versions` read. **No schema-version, Auth or CORS check** | `app.ts:113-119`, `lib/supabase.ts:186-190`; INT-B-017 |
| Migrations before startup | Required for PR #31 (`0030`) and PR #34 (`0031`); **not enforced, and not in any runbook** | INT-B-017 |
| Graceful shutdown | Drains jobs and pools. Exit 1 without Sentry (BUG-001) on the code line | DOC (BUG-001) |
| Logs and observability | Pino, route templates only, request IDs echoed in `x-request-id` (exposed to the browser); Sentry opt-in | CODE `app.ts:75-91` |
| Behind a proxy | Without `TRUST_PROXY`, the per-IP limiter sees the proxy address for every user (RAN: 4 distinct forwarded clients, 3rd and 4th got 429 at `RATE_LIMIT_IP=2`; with `TRUST_PROXY=127.0.0.1` all 200) | RAN probe 3 |
| Staging and production | **No evidence from either environment.** Nothing here claims they work | — |

---

## 8. Findings register

### 8.1 Findings

Format: **Evidence** · **Expected** · **Actual** · **Frontend impact** · **Remediation (backend)** · **Frontend coordination** · **Verify** · **Regression test and closure** · **Dependencies and decisions**.

#### INT-B-001 — Collaboration members cannot open the project they are invited to · High · Confirmed (TEST)
- **Evidence:** `0030_collaboration.sql:1-3` ("every existing owner-only table and route stays owner-only"). `collaboration/contracts.ts:5-7`. TEST `collaboration.integration.test.ts:60`: a reviewer gets **404 on `GET /api/projects/:id`**. B40–B46 plan §2 "B44: member access to the existing owner-only analysis routes … widening it is an owner decision".
- **Expected:** roadmap B44 "Roles, review signatures, conflicts, branch/restore, audit" (§H); scenario 31 (a user clicks a mesh and navigates rooms with stable IDs). A reviewer reviews what they can see.
- **Actual:**
  - A member reaches only `GET P/collaboration`, `GET P/collaboration/R` and the comment and review POSTs.
  - The revision view returns the raw `model` JSON and the parent model (`0030:93-110`), but no scene GLB, BIM, plan sheets, overview, manifest or verification.
  - Members have **no project listing**: `/api/projects` and `/api/library/projects` are owner-only.
- **Frontend impact:** a reviewer workspace cannot reuse the 3D viewer (F41–F47), the blueprint viewer (F33) or the overview (F31). The reviewer must already know the project UUID. Element-anchored comments (by element ID) cannot be placed by clicking the 3D model, because pick anchors come from the owner-only `scene/delivery`.
- **Remediation:** owner decision first. Options:
  - (a) widen read RLS on the scene, BIM, documents and manifest tables to active members, through `project_private.project_role`;
  - (b) add member-readable collaboration projections: a pick-anchor list and a GLB proxy;
  - (c) keep it, and document B44 as "discussion on raw model only".
  
  Add `GET /api/collaboration/projects` (projects where the caller is an active member) under any option.
- **Frontend coordination:** freeze the reviewer UI scope until the decision is made.
- **Verify:** as a member, call `GET P`, `GET P/R/scene/delivery`, `GET P/R/manifest`, `GET P/R/documents`.
- **Regression and closure:** a per-role integration test for every route the reviewer UI uses, plus the live RLS scenario. Closed when the decision is recorded and those tests pass at levels 2 and 3.
- **Dependencies:** PR #31 merge; INT-B-024.

#### INT-B-002 — Members can only be invited by Supabase user UUID · Medium · High
- **Evidence:** `collaboration/contracts.ts:26` `MemberRequestSchema { userId: uuid, role }`; `0030:130` requires the UUID to exist in `auth.users`. No route looks up a user by email or handle.
- **Expected:** an invite flow a person can complete.
- **Actual:** the inviting owner must already know the invitee's internal UUID. A missing user and the owner themselves get the same 422 `MEMBER_INVALID`.
- **Frontend impact:** the F44 invite dialog cannot be built without an out-of-band UUID exchange.
- **Remediation:** owner decision. Either invite by email (pending-invite table, accept route) or provide a scoped user lookup. Both need privacy review (user enumeration).
- **Frontend coordination:** invite UX.
- **Verify / closure:** an integration test that invites by the chosen identifier; enumeration-safe responses.
- **Dependencies:** INT-B-001.

#### INT-B-003 — The `editor` role has no edit permission · Low · High
- **Evidence:** `collaboration/contracts.ts:18-20` gives `editor: ['READ', 'COMMENT']`, the same as a commenter. Editors cannot write revisions, since every write route is owner-only.
- **Frontend impact:** a role picker labelled "Editor" promises something the backend refuses (404 on owner routes).
- **Remediation:** rename to `commenter`, or define editor write scope (owner decision). Either change is a contract change to `0030` while it is unmerged.
- **Closure:** the role table in the API document matches the SQL; a test asserts each role's permissions.

#### INT-B-004 — B44 routes in the plan of record differ from the implementation · Medium · Confirmed (CODE/DOC)
- **Evidence:** `docs/roadmap/b40-b46-implementation-plan.md:27` lists `/api/projects/:projectId/members…`, `…/revisions/:revisionId/comments`, `…/reviews`, `…/audit`. The code (`collaboration/contracts.ts:10-15`) has `/api/projects/:projectId/collaboration/{members,members/:userId,revisions/:revisionId,…/comments,…/reviews}`; the audit is embedded in `GET …/collaboration/revisions/:revisionId` (`AuditSchema`). There is no `/audit` route.
- **Frontend impact:** an adapter written from the plan gets 404 on every B44 call.
- **Remediation:** correct the plan table; add a B44 API document (INT-B-027).
- **Closure:** documented routes equal the `api-routes.json` entries (a doc lint can diff them).

#### INT-B-005 — OpenAPI types `module`, `schedule` and `levelId` path parameters as UUIDs · High · Confirmed (RAN)
- **Evidence:** `test-support/openapi.ts:219-220` maps every path parameter except `elementId` and `version` to `{type: string, format: uuid}`. Actual schemas:
  - `module` is an enum of 6 values (`contracts/specialists.ts:20,80`);
  - `schedule` is an enum (`contracts/documents.ts:12`);
  - `levelId` is an entity ID matching `^[A-Za-z0-9][A-Za-z0-9._:-]*$` (`contracts/documents.ts:8,11`).
  
  RAN: `openapi.json` shows `format: uuid` for all three.
- **Expected:** OpenAPI matches the Zod parameter schemas (roadmap B29/B45 "OpenAPI/schema fixtures").
- **Actual:** the conformance test checks route coverage and body/response mapping, not parameter schemas.
- **Frontend impact:** generated clients type `module` as a UUID string. Validating clients (zod, ajv or orval with validation) **refuse valid calls** to the specialist (F49–F54) and document (F33, F39) routes.
- **Remediation:** derive path-parameter schemas from the routes' `*ParamsSchema` (add `params` to `CONTRACTS`), and regenerate.
- **Closure:** a conformance test asserting each documented parameter schema equals the Zod one for all 165 routes.

#### INT-B-006 — OpenAPI marks 4 authenticated routes as anonymous · Medium · Confirmed (RAN)
- **Evidence:** the OpenAPI `security` flag is set only when the anonymous probe returns 401 (`test-support/openapi.ts:227`). For `POST /api/plans`, `POST /api/plans/generate`, `PATCH /api/plans/:id` and `POST /api/estimates`, the probe returns **400**, because validation runs before auth (`routes/plans.ts:13,19,31`, `routes/estimates.ts:10`; cross-ref API-002). All four require a session (`requestContext(…, true)`).
- **Frontend impact:** generators that attach credentials per operation will omit the token, so a valid body gets 401. An expired session with an invalid form shows field errors instead of "sign in again".
- **Remediation:** set `security` from route metadata instead of a probe, or authenticate before parsing.
- **Closure:** the test asserts `security` for every route whose handler calls `requestContext(…, true)`.

#### INT-B-007 — OpenAPI documents one success status per operation · Medium · Confirmed (CODE)
- **Evidence:** `test-support/openapi.ts:230` emits one `String(op.status ?? 200)`. Actual alternatives:
  - `POST P/references`: **200** when deduplicated (`routes/references.ts:61`);
  - `POST P/R/design-concepts`: 200 replay;
  - `POST P/specialists/:module/requests`: 200 refusal or replay;
  - `POST P/integration/plans/execute`: 200 refusal (comments at `openapi.ts:87,136,138`);
  - `GET P/R/scene/delivery`: **304** (`routes/delivery.ts:28`; 304 is documented only for binary media, `openapi.ts:230`).
- **Frontend impact:** typed clients treat 200 or 304 as unexpected, or drop the body. The UI misses "already uploaded" and "refused" states.
- **Remediation:** let `CONTRACTS` declare several statuses; emit each.
- **Closure:** a test per multi-status route asserting each documented status occurs.

#### INT-B-008 — 29 operations have no response schema, and the document version is stale · Medium · Confirmed (RAN)
- **Evidence:** RAN analysis of `openapi.json`: 29 success responses read "schema not exported yet" (Appendix A). They include:
  - `GET /api/capabilities` (F29 generation options);
  - `GET P/R/overview` (F31 manifest v1);
  - 7 BIM reads;
  - scene artifact list and status;
  - analysis list, status and validate for 5 engines;
  - `GET P/workflows`.

  The scene artifact detail and manifest declare `currency: z.unknown()` (`openapi.ts:119-120`). `info.version` is still `modernization-phases-1-29` (`openapi.ts:233`).
- **Frontend impact:** hand-written types for the most-used screens, and silent drift.
- **Remediation:** export the response schemas, set `info.version` from the compatibility version and route count.
- **Closure:** untyped count 0 (or a documented allow-list); a test fails on new untyped JSON routes.

#### INT-B-009 — `Retry-After` (and `Content-Disposition`) are not readable by browser code · Medium · Confirmed (RAN)
- **Evidence:** `app.ts:71-72` `exposedHeaders: ['x-request-id', 'ETag']`. RAN probe: the 429 response carries `retry-after: 60`, but `access-control-expose-headers` is only `x-request-id, ETag`. `Retry-After` is also set on reference-upload 503s (`routes/references.ts:64`). `Content-Disposition` on reference, CSV and IFC downloads is not exposed either.
- **Frontend impact:** `fetch` cannot read the server's backoff, so clients guess. Download filenames are unavailable to script-driven downloads (navigation downloads still work).
- **Remediation:** add `Retry-After` and `Content-Disposition` to `exposedHeaders`.
- **Closure:** a probe or integration test asserting the exposed-headers list on 429 and on a download.

#### INT-B-010 — Body-size (413) and media-type (415) errors are reported as `400 INVALID_REQUEST` · Medium · Confirmed (RAN)
- **Evidence:** `app.ts:98` maps 413 and 415 to 400. RAN: a 70 KB body to `/api/estimates` (64 KiB limit), a 1.1 MB body to `/api/projects` (1 MiB) and **a 10 MiB + 1 byte PNG to `P/references`** (limit 10,485,760, `references/contracts.ts:8`) all return 400 `INVALID_REQUEST` "The request is malformed or unsupported", the same as malformed JSON (RAN).
- **Expected:** roadmap scenario 19 (reject oversized uploads), with a reason the UI can show.
- **Frontend impact:** the F14 upload UI cannot say "file too large (max 10 MiB)"; it must enforce limits itself, with values copied from the source.
- **Remediation:** keep the status choice (owner decision), but give it a distinct code (`PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`) plus the limit, and publish the reference limits (for example in `GET P/references/usage`).
- **Closure:** a test for each limit asserting the code.

#### INT-B-011 — 429 mixes retryable rate limits with permanent quotas; the default budgets are tight for polling · Medium · Confirmed (CODE, RAN)
- **Evidence:**
  - 429 `RATE_LIMITED` (with `Retry-After`, `http-protection.ts:44`).
  - Also 429 **without** `Retry-After`, for limits that waiting does not clear: `ACCOUNT_QUOTA_EXCEEDED` (`project-repository.ts:18`), `DESIGN_CONCEPT_QUOTA_EXCEEDED`, `CONVERSATION_LIMIT` (the conversation hard cap at version 100, `0012:88`, `conversation-repository.ts:6`), and `JOB_LIMIT_EXCEEDED` on retry (PR #34, API-001).
  - The read budget is 120 requests per minute per user across **all** GETs, including job-event polling. The per-IP budget is 300 per minute before auth.
- **Frontend impact:** a generic retry-on-429 loops on quotas. A 1 Hz poll of two jobs (120/min) exhausts the read budget on its own, and every other screen then gets 429. A showcase where many laptops share one public IP shares 300/min.
- **Remediation:** a non-retryable quota should not use 429, or should carry `retryable: false` in the envelope. Document the polling cadence; consider exempting `…/events` or adding SSE (B32/B45).
- **Frontend coordination:** branch on `error.code`, back off on `RATE_LIMITED` only, poll at ≤ 0.5 Hz with jitter.
- **Closure:** documented codes with a retryability flag; a test that polling at the documented cadence for 5 minutes never hits 429.

#### INT-B-012 — No published error-code catalog; inconsistent code and status pairs · Medium · Confirmed (RAN)
- **Evidence:** `ApiErrorResponseSchema.code` is a free string. RAN: **137 distinct literal (status, code) pairs** in `new ApiError(…)` calls, plus codes mapped from SQLSTATEs (for example `COLLABORATION_FORBIDDEN`, `MEMBER_INVALID`, `PROJECT_NOT_FOUND`). OpenAPI lists only `default`. Inconsistencies:
  - `SCENE_SOURCE_MISMATCH` is 409 in delivery (`services/delivery-service.ts:19`) but 422 elsewhere;
  - generic `NOT_FOUND` sits alongside `PROJECT_NOT_FOUND` and `REVISION_NOT_FOUND`;
  - one `COLLABORATION_LIMIT_REACHED` covers three different caps (`collaboration-repository.ts:13`);
  - a stale commit secret surfaces as `FORBIDDEN` (INT-B-015).
- **Frontend impact:** error UX must be reverse-engineered from source; codes can change without notice.
- **Remediation:** generate an error catalog (code, status, retryable, meaning) from the source into OpenAPI (`x-error-codes` or a response enum) and test it.
- **Closure:** a catalog-completeness test (every thrown or mapped code is listed).

#### INT-B-013 — The advertised paging convention is not universal; some lists are silently capped · Medium · Confirmed (CODE)
- **Evidence:** `services/delivery-service.ts:30` advertises "Keyset: limit and an opaque cursor; nextCursor null at the end". BIM elements and relationships use `after` and `nextAfter` (`routes/bim.ts:27`). Job events use an integer `after` and `nextAfter` (`jobs/contracts.ts:38`). Conversations use a UUID cursor with `limit` ≤ 20 (`contracts/conversations.ts:75`). The B44 workspace returns at most 100 revisions (`0030:90`), and the revision view returns at most 200 comments and 100 reviews (`0030:106,109`), with **no cursor or truncation flag**.
- **Frontend impact:** a generic paginator breaks on four list types. Projects with more than 100 revisions show an incomplete history in the collaboration view without any indication.
- **Remediation:** document the variants in the compatibility conventions; add `truncated` or a cursor to the B44 reads.
- **Closure:** a test with 101 revisions asserting truncation is signalled.

#### INT-B-014 — `Idempotency-Key` is honoured on 27 of 72 writes; B44 writes are not idempotent · Medium · Confirmed (CODE, TEST)
- **Evidence:** receipts exist only for the 25 routes in the `0023` allow-list (`0023:78-99`), plus keyed replay in specialists and integration execute (`routes/specialists.ts:18-22`, `routes/integration.ts:24-28`). On the other 45 writes the header is **silently ignored** (Appendix A). This includes `POST …/collaboration/…/comments` and `…/reviews` (`routes/collaboration.ts:39-48`), so a retried comment is stored twice and counts against the 200 cap. TEST: a second `DELETE …/members/:userId` returns 404 `MEMBER_NOT_FOUND` (`collaboration.integration.test.ts:96`). A replay is not marked (no header).
- **Expected:** compatibility conventions "Idempotency-Key header on durable writes" (`delivery-service.ts:31`); roadmap §E `clientRequestId`.
- **Frontend impact:** network retries on comments create duplicates; retried deletes show errors.
- **Remediation:** receipts (or client-supplied IDs) for the B44 writes; make DELETE idempotent (`removed: true` on a repeat); publish the list of routes that honour the key; add `Idempotent-Replayed: true`.
- **Closure:** a retry test per state-changing route.

#### INT-B-015 — A missing or stale `PROJECT_COMMIT_SECRET` looks healthy but breaks every write · High · Confirmed (CODE)
- **Evidence:**
  - The secret is optional (`config/env.ts:15`). Without it, writes throw one of 20 distinct 503 `*_UNAVAILABLE` codes (21 source files) (for example `services/project-service.ts:44`, `collaboration-service.ts:13`, `reference-service.ts:53`). `/health/ready` checks the secret only in production (`app.ts:115`), and discovery still says `AVAILABLE` (RAN).
  - The secret must equal `project_private.commit_key`, which `0006:10` generates randomly per database, so **every `supabase db reset` invalidates it**.
  - A mismatched HMAC raises `insufficient_privilege` (`0023:108`), which maps to **403 `FORBIDDEN` "You do not have permission"** (`lib/errors.ts:26`).
  - The only provisioning code is in test tooling (`scripts/test-local-supabase.mjs:28`). There is no README on the code line (SHOW-002).
- **Frontend impact:** a frontend developer's local stack shows the owner "permission denied" on their own project, or 503s, while health is green. This is the most likely first-hour integration failure.
- **Remediation:**
  - a `npm run db:secret` (or similar) step that prints the key for `.env`, run after `db:reset`;
  - readiness or a startup warning in every environment when the secret is missing or does not verify;
  - map signature failures to a distinct 503 `COMMIT_ATTESTATION_UNAVAILABLE`, not 403.
- **Closure:** a test where a wrong secret gives the distinct code, and a setup guide verified on a clean machine.

#### INT-B-016 — Production starts with no allowed browser origin · Medium · Confirmed (RAN)
- **Evidence:** `config/env.ts:76` defaults origins only outside production. RAN: `NODE_ENV=production` with `CORS_ORIGINS` empty starts, `/health/live` is 200, and a preflight from `http://localhost:5173` gets no `access-control-allow-origin`.
- **Frontend impact:** every browser call in a mis-configured deployment fails with a CORS error, while health checks pass.
- **Remediation:** fail startup in production when `CORS_ORIGINS` is empty, unless an explicit `CORS_ORIGINS=none` is given; list the origins in the deployment runbook.
- **Closure:** an env-schema test.

#### INT-B-017 — Readiness and discovery do not reflect the schema or configuration; deployment order is unenforced · High · High (CODE; runtime failure inferred, not run)
- **Evidence:**
  - Readiness reads only `rate_table_versions` (`lib/supabase.ts:186-190`).
  - `GET /api/capabilities` lists all 32 services `AVAILABLE` statically (RAN, PR #31 merge), including `COLLABORATION` and `SCENE_DELIVERY`, whatever the secret or schema state. At the same time, the Phase 16 `capabilities` block lists `SCENE_3D` as a planned workflow step (`workflows/registry.ts:34`; E-06/R16).
  - The PR #31 API needs `0030` and the PR #34 API needs `0031`. On an older database, `collaboration_read` does not exist; PostgREST's error code is not in `collaborationDatabaseError`, so it falls through to 500 `DATABASE_ERROR` (`lib/errors.ts:27`). That path is code-inferred and was not run.
- **Expected:** roadmap scenario 23 ("degraded or blocked, not engine ready"), scenario 18 (absence visible before an expensive call).
- **Frontend impact:** the UI shows features as available that will fail.
- **Remediation:** record the expected latest migration in the API and check it at readiness (for example a `schema_version()` RPC); derive discovery status from configuration and readiness; document "migrate, then deploy".
- **Closure:** a test where an API on a database missing the latest migration gives readiness 503 and discovery `UNAVAILABLE`.

#### INT-B-018 — Timestamp formats and schemas are mixed · Low · Medium (CODE; runtime formats not sampled)
- **Evidence:** schemas use `z.string().datetime()` (UTC only), `datetime({ offset: true })` and free strings (`collaboration/contracts.ts:22`, values from `jsonb` timestamptz, typically `+00:00`). OpenAPI says `format: date-time` only for the first two.
- **Frontend impact:** string comparison and sorting across endpoints is unsafe; strict parsers may reject one form.
- **Remediation:** normalise every timestamp to RFC 3339 UTC `Z` at the API boundary.
- **Closure:** a test sampling one timestamp per route family.

#### INT-B-019 — Parallel contracts for the overview and the project list · Low · High
- **Evidence:** the B29 overview v1 (`GET P/R/overview`, untyped) and the B37 manifest v2 (`GET P/R/manifest`, typed) both serve F31. `GET /api/projects` (basic) and `GET /api/library/projects` (search, filter, sort, star, tags) both serve F23. No deprecation note.
- **Frontend impact:** duplicate adapters, and inconsistent data across screens.
- **Remediation:** declare the canonical endpoint per screen; mark the other legacy in the API document (owner decision).

#### INT-B-020 — No project deletion, account deletion or context clearing · Medium · High
- **Evidence:** no `DELETE /api/projects/:projectId`, no account route, no brief or context delete (route inventory). Archive exists (`PATCH P` `status`). SUPA-004: the `0030` immutable rows block any cascade delete.
- **Expected:** roadmap scenarios 21, 22 and 45 (archive and reopen, clearing preferences and context, deletion propagation).
- **Frontend impact:** F24 "delete project / delete my data" controls have no backend.
- **Remediation:** owner retention and erasure policy, then an erasure RPC that handles the immutable tables.
- **Closure:** a deletion-propagation test.

#### INT-B-021 — `FAILED` can mean "committed but failed verification"; refusals are 200 · Medium · High
- **Evidence:** a Blueprint specialist returns `status: FAILED` **after** committing a new current revision (`resultRevisionId` set; `services/specialist-service.ts:197-200`). Refusals on specialists, integration execute and design concepts are 200 with the same schema (`openapi.ts:87,136,138`).
- **Frontend impact:** treating `FAILED` or a 200 as "nothing changed" leaves the UI on a stale revision. The project's current revision has moved.
- **Remediation:** add an explicit `committed: boolean` (or `written`, already present on specialists) to every such result, and document the partial-completion semantics.
- **Frontend coordination:** after any specialist or integration result, refresh the current revision when `resultRevisionId` or `committedRevisionId` is non-null.

#### INT-B-022 — The compatibility hash detects route changes only · Low · High
- **Evidence:** `services/delivery-service.ts:27` hashes the sorted "METHOD /path" list; schema changes do not change it.
- **Frontend impact:** B45's "drift detection" misses field changes.
- **Remediation:** also publish a hash of `openapi.json`, or a schema version per route family.

#### INT-B-023 — No consumable TypeScript contract or sample-payload fixtures for the frontend · Medium · High
- **Evidence:** `@designflow/shared` is `private: true` (`packages/shared/package.json:4`) and holds the early `api.ts` and the building model only. Most contracts sit in `apps/api/src/**/contracts.ts` (not packaged). There is no generated client and no recorded sample payloads.
- **Expected:** roadmap B29 ("API-to-TypeScript compatibility sheet and OpenAPI/schema fixtures"), B45, scenario 47.
- **Frontend impact:** the frontend hand-maintains types or generates them from a partly wrong OpenAPI (INT-B-005 to INT-B-008).
- **Remediation:** publish a contracts package (or generated types from the corrected OpenAPI), plus golden response fixtures recorded by the integration tests.
- **Closure:** the frontend typechecks against the published artefacts; a fixture-drift test in CI.

#### INT-B-024 — The production adapter path for B31–B46 has never run against Supabase · High · Confirmed (CODE, RAN grep)
- **Evidence:**
  - Integration tests run through `test-support/pg-backend.ts` ("Test-only transport … Supabase Auth/HTTP are covered separately by the local Supabase acceptance suite", lines 27-28) with stubbed sessions.
  - The production methods (for example `collaborationRpc`, `lib/supabase.ts:119-122`) run only in `supabase.live.test.ts`. That suite has **0 calls** for references, settings, library, brief, context, collaboration, integration plans, scene delivery, instructions, feasibility, routing, documents, dependency graph, engineering assessment and turns (RAN grep counts).
  - Its last receipt is 2026-10-14, ≤ `0029` (DOC).
  - `supabase-acceptance` runs only on `workflow_dispatch` (CI shows `skipped` on every PR).
- **Frontend impact:** the first real-JWT run of these features would be the frontend's own integration.
- **Remediation:** run `npm run test:supabase` on a Docker host with PR #34's scenario; add scenarios for B31, B33, B38 and B45; run the job on migration and adapter changes.
- **Closure:** a committed live receipt covering every route family the showcase uses.
- **Dependencies:** a Docker host; cross-ref SUPA-002, SUPA-006, TEST-005.

#### INT-B-025 — The migration ledger compares names only; `0030` was edited in place · Medium · Confirmed (CODE)
- **Evidence:** `scripts/verify-hosted-migrations.mjs:19-33` compares `{version, name}`. `0030` changed content in `479b2bc` (+3 lines) under the same name (cross-ref PHASE-009).
- **Frontend impact:** indirect. A shared or demo database that applied the earlier `0030` would keep the cap race without any check noticing.
- **Remediation:** compare a content hash (the Supabase CLI stores `statements` in `schema_migrations`); record a checksum manifest per release.
- **Closure:** the ledger test detects a modified migration.

#### INT-B-026 — The integration target is not fixed: B40–B46 exist only on an unreviewed PR, and no phase after B30 is accepted · High · Confirmed (GH)
- **Evidence:**
  - PR #31: 0 reviews, empty description, +15,844/−5,303. PR #34 is stacked on it.
  - No tags after `phase30-complete`.
  - The release evidence comes from `win32-x64` / Node `v24.20.0`, with `B41 S1` "PASSED_WITH_SUITE_ERRORS", exit 1 (DOC `docs/phase46/release-evidence.json`).
  - §5.1 statuses.
- **Frontend impact:** building against PR #31 routes (14 routes, `0030`) risks rework if review changes them (INT-B-001 to INT-B-004 already argue for changes).
- **Remediation:** the owner names the target (recommended: `6bd84a5` + PR #33 for core flows; PR #31 + #34 only after review and a live run); merge order #33 → #31 → #34 → refreshed #29; regenerate the release evidence on Linux / Node 22.
- **Closure:** the target is merged and tagged, and CI plus a live receipt exist on it.

#### INT-B-027 — No API document for B37, B38 or B40–B46 · Low · Confirmed (RAN)
- **Evidence:** `docs/phase37`, `phase38` and `phase40`–`phase46` hold scope, gap or implementation records, but no `*-api.md`. B29–B36 and B39 have one.
- **Remediation:** API documents generated from `CONTRACTS` (route, request, response, errors, examples).

#### INT-B-028 — `HEAD /health/live` returns 404 · Low · Confirmed (RAN)
- **Evidence:** `exposeHeadRoutes: false` (`app.ts:69`); RAN HEAD gives 404 with an empty body.
- **Impact:** load balancers that use HEAD health checks mark the API down.
- **Remediation:** allow HEAD on the two health routes.

#### INT-B-029 — Environment documentation gaps · Low · Confirmed (RAN)
- **Evidence:**
  - `COMPUTE_POLICY` is in the schema but not in `.env.example`.
  - `SUPABASE_SERVICE_ROLE_KEY` is listed beside the API variables but is tooling-only.
  - No document lists the frontend's variables (Supabase URL, anon key, API base URL) or the script variables (`HOSTED_DB_URL`, `STAGING_*_TOKEN`).
  - The CI `supabase-acceptance` job uses unpinned Node `'22'`.
- **Remediation:** a setup guide (cross-ref SHOW-002) and a pinned Node version.

#### INT-B-030 — Stale and superseded branches · Low · Confirmed (RAN)
- **Evidence:** `phase39/s1-specialists` (PR #24, superseded), `phase37/read-cap` (superseded), `docs/roadmap-research-baseline` (2 unmerged doc commits). 50 branches in total.
- **Remediation:** the owner archives the superseded branches after recording them (cross-ref PHASE-004).

#### INT-B-031 — Behind a proxy without `TRUST_PROXY`, all users share one per-IP bucket · Medium · Confirmed (RAN)
- **Evidence:** the perimeter limiter keys on `req.ip` (`lib/http-protection.ts:36`); `TRUST_PROXY` defaults to empty (`config/env.ts`, `app.ts:68`). RAN probe 3 (`RATE_LIMIT_IP=2`): four clients with distinct `X-Forwarded-For` got 200, 200, **429, 429**. With `TRUST_PROXY=127.0.0.1`, all four got 200.
- **Frontend impact:** on any PaaS or load balancer, the whole user base shares 300 requests per minute; the showcase sees 429 storms.
- **Remediation:** list `TRUST_PROXY` per target platform in the deployment runbook; consider warning at startup when `X-Forwarded-For` arrives from a non-trusted peer.
- **Closure:** a deployment checklist item plus a staging probe.

### 8.2 Cross-references to the other audits (not repeated here)

| Other audit's ID | Relation to this audit |
|---|---|
| API-002 (validation before auth) | Cause of INT-B-006 |
| API-003 (`If-None-Match: *`) | Same ETag code as INT-B-007; no browser impact |
| SEC-001 (no malware scan) | Blocks W8 production uploads |
| SEC-003 (hosted Auth settings unknown) | W1 |
| SUPA-002, SUPA-006, TEST-005 | Same gap family as INT-B-024 (this audit adds the per-route-family coverage count) |
| SUPA-004 | INT-B-020 |
| PHASE-001, PHASE-003, PHASE-004, PHASE-009 | INT-B-026, INT-B-030, INT-B-025 |
| SHOW-002 (no README), SHOW-004 (frontend not compared) | INT-B-015, INT-B-029; §2.3 |
| DB-001, DB-002, API-001 (PR #34) | W9, W10; INT-B-011 |
| DEBT-003 (no job sweeper) | W9 |
| BUG-001 (PR #33) | §7.2 |

---

## 9. Integration test plan

Status: **PASS** executed and passed · **FAIL** executed and failed · **SKIP** skipped · **NOT RUN** not executed · **BLOCKED** blocked by infrastructure or authorization. Nothing below is marked passed on code inspection alone.

| # | Pri | Test | Setup | Request or action | Expected | Evidence source | Exists? | Env | Status |
|---|---|---|---|---|---|---|---|---|---|
| T1 | P0 | Route catalog and OpenAPI regenerate without drift | merge tree | `modernization.test.ts` | no drift | RAN | yes | local | **PASS** |
| T2 | P0 | Path-parameter schemas in OpenAPI equal the Zod schemas | — | new conformance assertion | `module`/`schedule` enums, `levelId` pattern | — | **no** | local | NOT RUN (INT-B-005) |
| T3 | P0 | `security` present on every authenticated route | — | new assertion | 158 operations tagged | — | **no** | local | NOT RUN (INT-B-006) |
| T4 | P0 | Clean install of `0001`–`0030` | embedded PG | `supabase/tests/database.test.ts` | all apply | RAN | yes | local | **PASS** |
| T5 | P0 | Upgrade a populated `0029` database to `0030`/`0031` | snapshot with data | apply new migrations | no error; invariants hold | — | **no** | local Supabase | NOT RUN |
| T6 | P0 | Live owner flow through real JWT and PostgREST incl. B34, B40, `0030` | Docker host | `npm run test:supabase` with PR #34 | pass | — | written (#34) | local Supabase | **BLOCKED** (no Docker daemon) |
| T7 | P0 | Hosted ledger read-only | operator credential | `verify-hosted-migrations.mjs` | exit 0, pending listed | — | yes | hosted | **BLOCKED** (authorization) |
| T8 | P0 | Readiness fails when the latest migration is missing | DB at `0029`, PR #31 API | `GET /health/ready`, `GET /api/capabilities` | 503; COLLABORATION `UNAVAILABLE` | — | **no** | local | NOT RUN (INT-B-017) |
| T9 | P0 | Wrong commit secret gives a distinct code | DB key ≠ env | any revision write | not 403 `FORBIDDEN` | — | **no** | local | NOT RUN (INT-B-015) |
| T10 | P1 | SEC-004 caps under concurrency | 195 comments; 18 members | 40 / 12 concurrent writes | exactly 200 / 20 | RAN | yes | local | **PASS** |
| T11 | P1 | Review cap (100) under concurrency | — | concurrent reviews | exactly 100 | PR #34 (CI) | yes (#34) | local | NOT RUN here (CI green) |
| T12 | P1 | Member access matrix per route the reviewer UI needs | owner + 3 roles | every GET in W11 + scene/BIM/manifest | per owner decision | partial TEST (`:60` 404) | partial | local + live | PASS (current behaviour) / NOT RUN (target) |
| T13 | P1 | B46 end-to-end pipeline | embedded PG | `e2e-pipeline.integration.test.ts` | pass, no cross-tenant leak | RAN | yes | local | **PASS** |
| T14 | P1 | Selective revision lifecycle | — | `revision.integration.test.ts` | pass | RAN | yes | local | **PASS** |
| T15 | P1 | Scene delivery ETag and 304 | — | `delivery.integration.test.ts` | pass | RAN | yes | local | **PASS** |
| T16 | P1 | Browser 304 handling with `no-store` | browser | revalidate GLB/delivery | client cache used | — | **no** | frontend | NOT RUN |
| T17 | P1 | CORS preflight for allowed headers | built server | `OPTIONS` with Authorization, Content-Type, Idempotency-Key | 204 + allow-origin | RAN probe 1 | ad hoc | local | **PASS** |
| T18 | P1 | `Retry-After` readable from browser | built server | trigger 429 | header in `access-control-expose-headers` | RAN probe 1 | ad hoc | local | **FAIL** (INT-B-009) |
| T19 | P1 | Oversized upload gives a distinct code | built server | 10 MiB + 1 byte PNG | `PAYLOAD_TOO_LARGE`-style code | RAN probe 2 | ad hoc | local | **FAIL** (INT-B-010: 400 `INVALID_REQUEST`) |
| T20 | P1 | Production refuses to start with no CORS origins | built server | `NODE_ENV=production`, `CORS_ORIGINS=` | startup error | RAN probe 1 | ad hoc | local | **FAIL** (INT-B-016: started) |
| T21 | P1 | Per-IP limit behind a proxy | built server | 4 forwarded clients, `RATE_LIMIT_IP=2` | independent buckets when configured | RAN probe 3 | ad hoc | local | **PASS** with `TRUST_PROXY`; **FAIL** at the default |
| T22 | P1 | Error envelope on 401/404/429/503 with CORS | built server | probes | envelope + allow-origin | RAN probe 1 | ad hoc | local | **PASS** |
| T23 | P1 | Retried comment does not duplicate | — | same comment twice with a key | one stored | — | **no** | local | NOT RUN (INT-B-014) |
| T24 | P1 | Polling at the documented cadence stays under the read quota | — | 5 min of event polling + screen reads | no 429 | — | **no** | local | NOT RUN (INT-B-011) |
| T25 | P1 | Token expiry and refresh mid-workflow | real GoTrue | expire, refresh, retry | 401 then success | — | **no** | local Supabase | BLOCKED (no Docker) |
| T26 | P2 | Reference upload, dedupe 200, ETag, link expiry | — | `references.integration.test.ts` | pass | RAN | yes | local | **PASS** |
| T27 | P2 | Jobs: progress, retry, lease recovery, isolation | — | `jobs.integration.test.ts` | pass | RAN | yes | local | **PASS** |
| T28 | P2 | Account, library, brief, context | — | `account.integration.test.ts` | pass | RAN | yes | local | **PASS** |
| T29 | P2 | Projects: compare-and-swap, stale base, dedupe | — | `projects.integration.test.ts` | pass | RAN | yes | local | **PASS** |
| T30 | P2 | B34 verification over HTTP | — | `verification.integration.test.ts` | pass | RAN | yes | local | **PASS** |
| T31 | P2 | Hardening (limits, errors, logs) | — | `hardening*.test.ts` | pass | RAN | yes | local | **PASS** |
| T32 | P2 | Staging workflow rehearsal (W-B37) | local app | `staging-workflow.integration.test.ts` | pass | RAN | yes | local | **PASS** (a rehearsal, not staging) |
| T33 | P2 | Ledger comparison logic | — | `hosted-migration-ledger.test.ts` | pass | RAN | yes | local | **PASS** |
| T34 | P2 | Ledger detects an edited migration | modified file | ledger script | inconsistent | — | **no** | local | NOT RUN (INT-B-025) |
| T35 | P2 | Timestamp format per route family | — | sample responses | RFC 3339 UTC | — | **no** | local | NOT RUN (INT-B-018) |
| T36 | P2 | Error-code catalog completeness | — | static scan vs catalog | equal | — | **no** | local | NOT RUN (INT-B-012) |
| T37 | P2 | Frontend adapters against staging without mocks (scenario 47) | staging + frontend | adapter suite | pass | — | **no** | staging | BLOCKED (no frontend, no staging) |
| T38 | P3 | `HEAD /health/live` | built server | HEAD | 200 | RAN probe 1 | ad hoc | local | **FAIL** (INT-B-028: 404) |
| T39 | P3 | Full suite on the merge tree | — | `npx vitest run` | all pass | CI 39143637924 | yes | CI | PASS (CI; not re-run in full here) |

---

## 10. Integration handoff backlog (ordered by dependency)

### P0 — blocks safe integration or risks data or security failure

| Task | Brief | Likely files | Tests to add | Expected outcome | Frontend coordination |
|---|---|---|---|---|---|
| **P0-1** Fix the integration target (INT-B-026) | Owner records the target branch. Merge #33, then review and merge #31 and #34; refresh #29; tag | GitHub; `docs/roadmap/*` | — | One commit the frontend builds against | Frontend pins that commit and its `routeCatalog.sha256` |
| **P0-2** Commit-secret setup and signal (INT-B-015) | Add `db:secret` (prints `project_private.commit_key` for local stacks only); run it in the setup guide after `db:reset`; warn or fail readiness when the secret is missing in any environment; map HMAC failure to a distinct 503 code | `scripts/`, `package.json`, `app.ts:113-119`, `lib/errors.ts:26`, `0023:102-114` (via a new migration) | T9 | Local setup cannot silently lose writes | Setup guide shared with the frontend |
| **P0-3** Schema-aware readiness and truthful discovery (INT-B-017) | Expected-migration constant plus a check RPC; discovery status derived from readiness and configuration; runbook "migrate, then deploy" | `lib/supabase.ts`, `services/overview-service.ts`, new migration, `docs/release/*` | T8 | No `AVAILABLE` feature that fails at runtime | UI hides features marked `UNAVAILABLE` |
| **P0-4** Live acceptance run (INT-B-024) | On a Docker host run `npm run test:supabase` with PR #34's scenario; add scenarios for B31, B33, B38 and B45; commit the receipt | `apps/api/tests/supabase.live.test.ts`, `.github/workflows/backend-ci.yml` | T6, T25 | Production adapter path proven for the showcase | — |
| **P0-5** Collaboration access decision (INT-B-001, -002, -003) | Owner picks the member read scope, the invite identifier and the role names; implement in `0030` while it is unmerged, or in a new migration | `0030_collaboration.sql`, `collaboration/contracts.ts`, `services/collaboration-service.ts` | T12 | Reviewer UI scope is buildable | Freeze the B44 UI until decided |

### P1 — blocks core frontend workflows or a reliable demonstration

| Task | Brief | Likely files | Tests | Outcome | Frontend coordination |
|---|---|---|---|---|---|
| **P1-1** Correct OpenAPI (INT-B-005 to INT-B-008) | Add `params` to `CONTRACTS`; set `security` from route metadata; allow several success statuses; export the 29 missing response schemas; version the document | `test-support/openapi.ts`, contract files, `docs/modernization/openapi.json` | T2, T3, conformance | A generated client works without overrides | Regenerate the client; delete hand-written overrides |
| **P1-2** CORS exposed headers (INT-B-009) | Add `Retry-After`, `Content-Disposition` | `app.ts:71-72` | T18 | Backoff and filenames readable | Use `Retry-After` |
| **P1-3** Distinct 413/415 codes and published limits (INT-B-010) | Keep the envelope; add codes plus limits; expose the reference limits | `app.ts:95-99`, `references/contracts.ts`, usage route | T19 | Upload UI explains refusals | Pre-check size; show the server message |
| **P1-4** Retryability and polling budget (INT-B-011) | `retryable` flag or a non-429 status for quotas; document the polling cadence; consider an events exemption | `lib/errors.ts`, `lib/http-protection.ts`, API document | T24 | No retry storms or polling 429s | Back off on `RATE_LIMITED` only; poll ≤ 0.5 Hz |
| **P1-5** Error-code catalog (INT-B-012) | Generate it; fix `SCENE_SOURCE_MISMATCH`; split `COLLABORATION_LIMIT_REACHED` | `lib/*-repository.ts`, `services/delivery-service.ts:19`, OpenAPI | T36 | Stable error UX | Map codes to messages |
| **P1-6** Idempotency map and B44 retries (INT-B-014) | Receipts or client IDs for comments and reviews; idempotent member DELETE; replay header; publish the honouring routes | `routes/collaboration.ts`, `0030` or a new migration, `lib/idempotency.ts` | T23 | Safe retries | Send `Idempotency-Key` on the listed routes |
| **P1-7** Proxy and CORS deployment checklist (INT-B-016, INT-B-031) | Fail closed on empty production origins; runbook with `TRUST_PROXY` per platform | `config/env.ts`, `docs/release/*` | T20, T21 | No shared-bucket or CORS outage | Provide the origins per environment |

### P2 — correctness, compatibility and acceptance gaps

| Task | Brief | Files | Tests | Outcome |
|---|---|---|---|---|
| **P2-1** Paging conventions and B44 truncation (INT-B-013) | Document the variants; add `truncated` or a cursor to the B44 reads | `services/delivery-service.ts:30`, `0030` reads | 101-revision test | Generic paginator rules |
| **P2-2** Partial-completion semantics (INT-B-021) | Explicit `committed` field; document refusals that are 200 | specialist and integration contracts | per-route test | UI refreshes correctly |
| **P2-3** Canonical overview and listing (INT-B-019) | Owner chooses; mark the legacy endpoint | API documents | — | One adapter per screen |
| **P2-4** Lifecycle and erasure (INT-B-020) | Policy, then erasure RPC | new migration, account routes | deletion test | Roadmap 21/22/45 |
| **P2-5** Upgrade-path migration test (§6.2) | Populated `0029` → `0030`/`0031` | `supabase/tests/` | T5 | Existing-database safety |
| **P2-6** Content-checked ledger (INT-B-025) | Compare statement hashes | `scripts/verify-hosted-migrations.mjs` | T34 | Edited migrations detected |
| **P2-7** Contracts package and fixtures (INT-B-023, INT-B-022) | Publish types or generated client plus golden payloads; OpenAPI hash in compatibility | `packages/`, `services/delivery-service.ts:27` | fixture drift | Scenario 47 achievable |
| **P2-8** Timestamp normalisation (INT-B-018) | RFC 3339 UTC everywhere | response mappers | T35 | Safe parsing |
| **P2-9** Re-accept B34, B37, B39 (§5) | Record owner decisions; re-run their acceptance on the merged head | `docs/phase34`, `phase37`, `phase39` | live scenario | Phases accepted or explicitly deferred |

### P3 — hardening, documentation and maintainability

| Task | Brief | Files |
|---|---|---|
| **P3-1** Setup guide with frontend variables (INT-B-029, SHOW-002) | Clean-machine guide: Docker, `db:start`, `db:reset`, `db:secret`, `.env`, `npm run dev`, frontend variables | `README.md`, `.env.example` |
| **P3-2** API documents for B37, B38, B40–B46 (INT-B-027); fix the B44 plan table (INT-B-004) | Generated from `CONTRACTS` | `docs/phase37`–`phase46`, `docs/roadmap/b40-b46-implementation-plan.md:27` |
| **P3-3** HEAD on health routes (INT-B-028) | | `app.ts:69,112-119` |
| **P3-4** Branch clean-up (INT-B-030) | Archive superseded branches | GitHub |
| **P3-5** Pin Node in `supabase-acceptance`; regenerate release evidence on Linux / Node 22 | | `.github/workflows/backend-ci.yml`, `scripts/release-evidence.mjs` |

---

## 11. Contract questions (owner or frontend decision; not decided here)

1. **Integration target:** should the frontend build against `6bd84a5` (+ #33) now, or against PR #31 + #34? (INT-B-026)
2. **B44 member access:** may members read the scene, BIM, documents and manifest of projects they belong to, or only the collaboration views? (INT-B-001)
3. **Invites:** by email, by a user lookup, or by UUID only? (INT-B-002)
4. **Roles:** what may an `editor` do? Should the role be renamed? (INT-B-003)
5. **Canonical endpoints:** F31 uses `overview` v1 or `manifest` v2; F23 uses `/api/projects` or `/api/library/projects`? (INT-B-019)
6. **Erasure:** what are the retention and deletion rules for projects, accounts, briefs, context and the immutable collaboration record? (INT-B-020, SUPA-004)
7. **Oversized bodies:** keep 400 with a new code, or return 413? (INT-B-010)
8. **Quotas:** keep 429 for permanent quotas with a `retryable` flag, or move them to 409 or 422? (INT-B-011)
9. **Idempotency:** should `Idempotency-Key` become required on every state-changing write? (INT-B-014)
10. **Progress transport:** is polling acceptable for the showcase, and at what cadence? Is SSE required (B32/B45)? (INT-B-011)
11. **Client generation:** which OpenAPI generator does the frontend use, and does it validate at runtime? (INT-B-005 to INT-B-008)
12. **Origins:** the exact frontend origins per environment; is the API behind a proxy, and which one? (INT-B-016, INT-B-031)
13. **Auth features:** are anonymous sign-ins and unconfirmed email sign-ups enabled on the hosted project, as they are locally? (`config.toml:28-33`; SEC-003)
14. **Timestamps:** is RFC 3339 UTC with `Z` the standard? (INT-B-018)
15. **B34 deferrals:** build or defer the three deferred capabilities (`phase34-closure.md` §6)?

---

## 12. Commands executed and their outcomes

All execution ran on scratch copies: the session scratchpad and `/home/ubuntu/int-audit-b-scratch/` (created for this audit and owned by an unprivileged user, because embedded PostgreSQL refuses root; removed at the end). Nothing ran against a hosted system. The three probe scripts and their raw results are in [`audit/evidence/integration-audit-b-probes.txt`](audit/evidence/integration-audit-b-probes.txt), so rows 11–13 can be reproduced on any built checkout.

| # | Command (abridged) | Where | Outcome |
|---|---|---|---|
| 1 | `git status; git log; git branch -a; git remote -v; git ls-remote origin` | checkout | Stale `main` @ `dd6e469`; 47 remote branches; default `phase31/development` |
| 2 | `git pull --ff-only origin main` (twice) | checkout | Fast-forward to `58a19e8`, then to `0333d65` |
| 3 | `git clone --mirror …; git worktree add --detach dev 6bd84a5` | scratchpad | OK |
| 4 | `git merge-tree --write-tree 6bd84a5 479b2bc` → `d569391`; `git commit-tree` (scratch only); `git worktree add pr31` | scratchpad | Tree equals GitHub `refs/pull/31/merge` `03ac9e7` (tree `d569391`) |
| 5 | `npm ci --no-audit --no-fund` | `pr31` | exit 0 |
| 6 | `npm run build` | `pr31` | exit 0 |
| 7 | Python analyses of `openapi.json`, `api-routes.json`, migrations, `.env.example` vs the env schema; `grep` of error codes and live-suite coverage | scratchpad | Figures in §3, §6, INT-B-008, INT-B-012, INT-B-024 |
| 8 | `docker info`; `docker version` | container | Client 29.8.2; **daemon unreachable** (`/var/run/docker.sock` missing) |
| 9 | `localedef -i en_US -f UTF-8 en_US.UTF-8` | container OS | Locale created (mirrors CI `locale-gen`) |
| 10 | `runuser -u ubuntu -- npx vitest run` on 17 files: `modernization`, `modernization.integration`, `collaboration.integration`, `e2e-pipeline.integration`, `delivery.integration`, `supabase/tests/database`, `hosted-migration-ledger`, `staging-workflow.integration`, `revision.integration`, `hardening`, `hardening.integration`, `projects.integration`, `account.integration`, `references.integration`, `jobs.integration`, `verification.integration`, `foundation` | copy of `pr31` | **17/17 files, 189/189 tests passed, exit 0, 121.5 s** |
| 11 | Probe 1 (`int-audit-b-probe.mjs`): built `apps/api/dist/server.js`, Supabase URL `http://127.0.0.1:9` (unreachable), 20 HTTP requests (preflights, 401/404/503, malformed bodies, HEAD, readiness, capabilities, 429, production with empty `CORS_ORIGINS`) | copy of `pr31` | Results in §3.2, INT-B-009, -010, -016, -017, -028; T17–T22, T38 |
| 12 | Probe 2 (`int-audit-b-probe2.mjs`): 70 KB to `/api/estimates`, 1.1 MB to `/api/projects`, 10 MiB + 1 byte PNG and an `.exe` media type to `P/references` | copy of `pr31` | 400 `INVALID_REQUEST` ×3; the `.exe` reached Auth first (503 `AUTH_UNAVAILABLE`, Auth unreachable) |
| 13 | Probe 3 (`int-audit-b-probe3.mjs`): 4 distinct `X-Forwarded-For` clients, `RATE_LIMIT_IP=2`, `TRUST_PROXY` empty, then `127.0.0.1` | copy of `pr31` | Empty: 200, 200, 429, 429. Set: 200 ×4 |
| 14 | GitHub API: open and closed PRs, PR #31 details, reviews, comments, check runs for #29, #31, #33, #34 | GH | §1.2 |
| 15 | `git rev-list`, `git cherry` per branch against all open heads; `git merge-base --is-ancestor` for the phase 29/30 tags | mirror | §5.2, INT-B-030 |
| 16 | `git fetch` of PR #34 (`fix/audit-2026-10-18-repairs`); `git diff --stat 479b2bc 91118ac`; `git show …:supabase/migrations/0031_quota_integrity.sql` | mirror | 7 files, +299/−6; `0031` summary in §6.1 |

**Not run:** the full suite (CI ran it: run 39143637924), `npm run typecheck`, `lint` and `audit` (CI ran them), the PR #34 tree locally, the container build, the live Supabase suite, the hosted ledger, and anything on staging.

---

## 13. Unverified claims and infrastructure-blocked checks

### 13.1 Blocked

| Check | Blocker | Who can unblock |
|---|---|---|
| Live local Supabase (`npm run test:supabase`), including B34, B40 and `0030` scenarios (T6), and token expiry and refresh (T25) | No Docker daemon in this container | Anyone with a Docker host (follow-up §5.3 procedure) |
| Hosted migration ledger (T7) | Needs a read-only credential and owner approval; out of scope | Owner and operator |
| Hosted Auth settings | No access | Owner |
| Staging end-to-end; frontend adapters without mocks (T37) | No staging environment on record; frontend not available | Owner and frontend team |
| Frontend field-level comparison | Frontend repository not supplied | Frontend developer (§2.3) |

### 13.2 Claims not independently verified here (reported by others or inferred)

- The last live receipt (125/125 on `c343855`, 2026-10-14) and its coverage up to `0029` (DOC).
- The hosted ledger "last reported at `0017`" (DOC).
- The SEC-004 lock-free failure rate (5/5 and 3/3 in earlier sessions; I ran only the passing with-lock case).
- PR #34's repairs (DB-001, DB-002) and its live scenario's correctness: read, not executed. CI 39156993823 is green (GH).
- The PostgREST error code an API gets when `0030` is missing, and that it surfaces as 500 `DATABASE_ERROR` (INT-B-017): inferred from the error mapping, not executed.
- The runtime timestamp formats per route (INT-B-018): inferred from schemas.
- That no shared or persistent database has applied the pre-fix `0030` (PHASE-009): no evidence either way.
- Any statement about the frontend's actual behaviour: none is made; §2.3 lists what to check.

---

## 14. Verdict

**Not showcase-ready. Partially ready for local frontend integration of the single-owner core flows on `6bd84a5`, once the commit-secret setup (INT-B-015) is documented.**

- **Unit tests and embedded-database tests pass** (RAN: 189/189 relevant tests; CI green on every open PR). That is level 1–2 evidence only.
- **Live Supabase acceptance is unverified** for everything after `0029`, and for whole route families before it (INT-B-024). Hosted and staging evidence does not exist.
- **Phase acceptance is incomplete:** no phase after B30 is accepted, and B40–B46 sit on an unreviewed PR (INT-B-026).
- **The API contract is partly incompatible with generated clients** (INT-B-005 to INT-B-008), and the browser cannot see the information it needs for retries, uploads and quota errors (INT-B-009 to INT-B-011).
- **B44 collaboration needs owner decisions** before a reviewer UI can exist (INT-B-001 to INT-B-003).

The shortest path to a reliable demonstration is P0-1 to P0-4 and P1-1 to P1-7, with B44 either decided (P0-5) or left out of the demo.

---

## Appendix A — Route inventory (PR #31 merge tree, 165 routes)

Generated from `docs/modernization/api-routes.json`, `docs/modernization/openapi.json`, the `generate` list in `apps/api/src/lib/http-protection.ts` and the idempotency allow-list in `0023:78-99`. One manual correction: `PATCH P/references/:referenceId` does not call `durableCommand` (`routes/references.ts:87-91`), so its key is ignored although the template is allow-listed for DELETE. Request and response bodies are in `openapi.json`.

- **Auth:** `required (OpenAPI: none)` is INT-B-006.
- **Idempotency-Key:** `receipt` = stored response replayed; `keyed replay (service)` = per-step replay inside the service; `ignored` = the header has no effect.
- **Success:** the documented code, plus undocumented alternatives (INT-B-007).
- **Response schema:** `none` = untyped (INT-B-008).

| # | Method | Path (`P` = `/api/projects/:projectId`, `R` = `/revisions/:revisionId`) | Auth | Rate group | Idempotency-Key | Success (OpenAPI) | Response schema | Paging |
|---:|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/capabilities` | none | read | n/a | 200 | **none** |  |
| 2 | GET | `/api/compatibility` | required | read | n/a | 200 | typed |  |
| 3 | POST | `/api/estimates` | **required (OpenAPI: none)** | write | receipt | 200 | typed |  |
| 4 | GET | `/api/library/projects` | required | read | n/a | 200 | typed | cursor |
| 5 | GET | `/api/me/settings` | required | read | n/a | 200 | typed |  |
| 6 | PATCH | `/api/me/settings` | required | write | **ignored** | 200 | typed |  |
| 7 | GET | `/api/me/usage` | required | read | n/a | 200 | typed |  |
| 8 | POST | `/api/plans` | **required (OpenAPI: none)** | write | receipt | 201 | typed |  |
| 9 | GET | `/api/plans/:id` | optional | read | n/a | 200 | typed |  |
| 10 | PATCH | `/api/plans/:id` | optional | write | **ignored** | 200 | typed |  |
| 11 | POST | `/api/plans/generate` | **required (OpenAPI: none)** | generate | receipt | 201 | typed |  |
| 12 | GET | `/api/projects` | required | read | n/a | 200 | typed | cursor |
| 13 | POST | `/api/projects` | required | write | receipt | 201 | typed |  |
| 14 | GET | `P` | required | read | n/a | 200 | typed |  |
| 15 | PATCH | `P` | required | write | **ignored** | 200 | typed |  |
| 16 | GET | `P/brief` | required | read | n/a | 200 | typed |  |
| 17 | GET | `P/brief/versions` | required | read | n/a | 200 | typed | cursor |
| 18 | POST | `P/brief/versions` | required | write | receipt | 201 | typed |  |
| 19 | GET | `P/brief/versions/:version` | required | read | n/a | 200 | typed |  |
| 20 | GET | `P/collaboration` | required | read | n/a | 200 | typed |  |
| 21 | POST | `P/collaboration/members` | required | write | **ignored** | 201 | typed |  |
| 22 | DELETE | `P/collaboration/members/:userId` | required | write | **ignored** | 200 | typed |  |
| 23 | GET | `P/collaboration/R` | required | read | n/a | 200 | typed |  |
| 24 | POST | `P/collaboration/R/comments` | required | write | **ignored** | 201 | typed |  |
| 25 | POST | `P/collaboration/R/reviews` | required | write | **ignored** | 201 | typed |  |
| 26 | POST | `P/compute/jobs` | required | generate | **ignored** | 202 | typed |  |
| 27 | GET | `P/compute/jobs/:jobId` | required | read | n/a | 200 | typed |  |
| 28 | POST | `P/compute/quotes` | required | write | **ignored** | 200 | typed |  |
| 29 | GET | `P/context` | required | read | n/a | 200 | typed |  |
| 30 | GET | `P/conversations` | required | read | n/a | 200 | typed | cursor |
| 31 | POST | `P/conversations` | required | write | **ignored** | 200 | typed |  |
| 32 | DELETE | `P/conversations/:conversationId` | required | write | **ignored** | 200 | typed |  |
| 33 | GET | `P/conversations/:conversationId` | required | read | n/a | 200 | typed |  |
| 34 | POST | `P/conversations/:conversationId/actions/:actionId/decisions` | required | generate | **ignored** | 200 | typed |  |
| 35 | GET | `P/conversations/:conversationId/context` | required | read | n/a | 200 | typed |  |
| 36 | POST | `P/conversations/:conversationId/messages` | required | generate | **ignored** | 200 | typed |  |
| 37 | POST | `P/conversations/:conversationId/proposals/approve` | required | generate | **ignored** | 200 | typed |  |
| 38 | POST | `P/conversations/:conversationId/rebase` | required | generate | **ignored** | 200 | typed |  |
| 39 | POST | `P/conversations/:conversationId/tools` | required | write | **ignored** | 200 | typed |  |
| 40 | POST | `P/conversations/:conversationId/turns` | required | generate | **ignored** | 200 | typed |  |
| 41 | POST | `P/feasibility/assessments` | required | write | **ignored** | 200 | typed |  |
| 42 | POST | `P/integration/plans` | required | generate | **ignored** | 200 | typed |  |
| 43 | POST | `P/integration/plans/execute` | required | generate | keyed replay (service) | 201 + 200 refusal | typed |  |
| 44 | GET | `P/jobs` | required | read | n/a | 200 | typed | cursor |
| 45 | POST | `P/jobs` | required | generate | receipt | 202 | typed |  |
| 46 | GET | `P/jobs/:jobId` | required | read | n/a | 200 | typed |  |
| 47 | POST | `P/jobs/:jobId/cancel` | required | write | **ignored** | 200 | typed |  |
| 48 | GET | `P/jobs/:jobId/events` | required | read | n/a | 200 | typed | after |
| 49 | POST | `P/jobs/:jobId/retry` | required | generate | **ignored** | 200 | typed |  |
| 50 | PATCH | `P/library` | required | write | **ignored** | 200 | typed |  |
| 51 | GET | `P/public` | optional | read | n/a | 200 | typed |  |
| 52 | GET | `P/references` | required | read | n/a | 200 | typed | cursor |
| 53 | POST | `P/references` | required | generate | receipt | 201 + 200 dedup | typed |  |
| 54 | DELETE | `P/references/:referenceId` | required | write | receipt | 200 | typed |  |
| 55 | GET | `P/references/:referenceId` | required | read | n/a | 200 | typed |  |
| 56 | PATCH | `P/references/:referenceId` | required | write | **ignored** | 200 | typed |  |
| 57 | GET | `P/references/:referenceId/content` | required | read | n/a | 200/304 | binary (application/octet-stream) |  |
| 58 | POST | `P/references/:referenceId/download-links` | required | write | **ignored** | 201 | typed |  |
| 59 | GET | `P/references/usage` | required | read | n/a | 200 | typed |  |
| 60 | POST | `P/references/validate` | required | generate | **ignored** | 200 | typed |  |
| 61 | POST | `P/requirements/interpret` | required | generate | **ignored** | 200 | typed |  |
| 62 | GET | `P/revision-operations` | required | read | n/a | 200 | typed | cursor |
| 63 | POST | `P/revision-operations` | required | generate | receipt | 201 | typed |  |
| 64 | GET | `P/revision-operations/:operationId` | required | read | n/a | 200 | typed |  |
| 65 | POST | `P/revision-operations/:operationId/approve` | required | write | receipt | 201 | typed |  |
| 66 | POST | `P/revision-operations/:operationId/cancel` | required | write | receipt | 200 | typed |  |
| 67 | GET | `P/revision-operations/:operationId/candidate/glb` | required | read | n/a | 200/304 | binary (model/gltf-binary) |  |
| 68 | GET | `P/revision-operations/:operationId/candidate/manifest` | required | read | n/a | 200 | typed |  |
| 69 | GET | `P/revision-operations/:operationId/comparison` | required | read | n/a | 200 | typed |  |
| 70 | POST | `P/revision-operations/:operationId/execute` | required | generate | receipt | 200 | typed |  |
| 71 | POST | `P/revision-operations/:operationId/reject` | required | write | receipt | 200 | typed |  |
| 72 | GET | `P/revision-operations/:operationId/validation` | required | read | n/a | 200 | typed |  |
| 73 | GET | `P/revisions` | required | read | n/a | 200 | typed | cursor |
| 74 | POST | `P/revisions` | required | generate | receipt | 201 | typed |  |
| 75 | GET | `P/R` | required | read | n/a | 200 | typed |  |
| 76 | GET | `P/R/appearance` | required | read | n/a | 200 | typed |  |
| 77 | GET | `P/R/appearance/glb` | required | read | n/a | 200/304 | binary (model/gltf-binary) |  |
| 78 | GET | `P/R/bim` | required | read | n/a | 200 | **none** |  |
| 79 | GET | `P/R/bim/diff/:otherRevisionId` | required | read | n/a | 200 | **none** |  |
| 80 | GET | `P/R/bim/elements` | required | read | n/a | 200 | **none** | after |
| 81 | GET | `P/R/bim/elements/:elementId` | required | read | n/a | 200 | **none** |  |
| 82 | GET | `P/R/bim/export.ifc` | required | read | n/a | 200 | binary (application/x-step) |  |
| 83 | GET | `P/R/bim/export.json` | required | read | n/a | 200 | **none** |  |
| 84 | GET | `P/R/bim/relationships` | required | read | n/a | 200 | **none** | after |
| 85 | GET | `P/R/bim/validation` | required | read | n/a | 200 | **none** |  |
| 86 | GET | `P/R/cost-estimates` | required | read | n/a | 200 | typed | cursor |
| 87 | GET | `P/R/cost-estimates/:costEstimateId` | required | read | n/a | 200 | typed |  |
| 88 | GET | `P/R/dependency-graph` | required | read | n/a | 200 | typed |  |
| 89 | GET | `P/R/design-concepts` | required | read | n/a | 200 | typed | cursor |
| 90 | POST | `P/R/design-concepts` | required | generate | **ignored** | 201 + 200 replay | typed |  |
| 91 | GET | `P/R/design-concepts/:conceptSetId` | required | read | n/a | 200 | typed |  |
| 92 | GET | `P/R/documents` | required | read | n/a | 200 | typed |  |
| 93 | GET | `P/R/documents/plan-sheets/:levelId` | required | read | n/a | 200 | binary (image/svg+xml) |  |
| 94 | GET | `P/R/documents/schedules` | required | read | n/a | 200 | typed |  |
| 95 | GET | `P/R/documents/schedules/:schedule/csv` | required | read | n/a | 200 | binary (text/csv) |  |
| 96 | GET | `P/R/engineering-assessment` | required | read | n/a | 200 | typed |  |
| 97 | POST | `P/R/engineering-assessment` | required | write | **ignored** | 200 | typed |  |
| 98 | GET | `P/R/engineering-assessment/zones` | required | read | n/a | 200 | typed |  |
| 99 | POST | `P/R/engineering-assessment/zones` | required | write | **ignored** | 200 | typed |  |
| 100 | POST | `P/R/engineering-assessment/zones/partitions` | required | generate | **ignored** | 200 | typed |  |
| 101 | POST | `P/R/engineering-assessment/zones/regeneration` | required | generate | **ignored** | 200 | typed |  |
| 102 | POST | `P/R/engineering-assessment/zones/regeneration-preflight` | required | write | **ignored** | 200 | typed |  |
| 103 | POST | `P/R/engineering-assessment/zones/regeneration/verification` | required | generate | **ignored** | 200 | typed |  |
| 104 | GET | `P/R/environmental/analyses` | required | read | n/a | 200 | **none** | cursor |
| 105 | POST | `P/R/environmental/analyses` | required | generate | receipt | 201 | typed |  |
| 106 | GET | `P/R/environmental/analyses/:analysisId` | required | read | n/a | 200 | typed |  |
| 107 | GET | `P/R/environmental/status` | required | read | n/a | 200 | **none** |  |
| 108 | POST | `P/R/environmental/validate` | required | generate | **ignored** | 200 | **none** |  |
| 109 | GET | `P/R/evidence-packages` | required | read | n/a | 200 | typed | cursor |
| 110 | POST | `P/R/evidence-packages` | required | generate | **ignored** | 201 | typed |  |
| 111 | GET | `P/R/evidence-packages/:packageId` | required | read | n/a | 200 | typed |  |
| 112 | POST | `P/R/instructions/resolve` | required | write | **ignored** | 200 | typed |  |
| 113 | GET | `P/R/knowledge/analyses` | required | read | n/a | 200 | **none** | cursor |
| 114 | POST | `P/R/knowledge/analyses` | required | write | receipt | 201 | typed |  |
| 115 | GET | `P/R/knowledge/analyses/:analysisId` | required | read | n/a | 200 | typed |  |
| 116 | GET | `P/R/knowledge/packs` | required | read | n/a | 200 | **none** |  |
| 117 | GET | `P/R/knowledge/status` | required | read | n/a | 200 | **none** |  |
| 118 | POST | `P/R/knowledge/validate` | required | write | **ignored** | 200 | **none** |  |
| 119 | GET | `P/R/manifest` | required | read | n/a | 200 | typed |  |
| 120 | GET | `P/R/optimization/status` | required | read | n/a | 200 | **none** |  |
| 121 | GET | `P/R/optimization/studies` | required | read | n/a | 200 | **none** | cursor |
| 122 | POST | `P/R/optimization/studies` | required | generate | receipt | 201 | typed |  |
| 123 | GET | `P/R/optimization/studies/:studyId` | required | read | n/a | 200 | typed |  |
| 124 | POST | `P/R/optimization/validate` | required | generate | **ignored** | 200 | **none** |  |
| 125 | GET | `P/R/overview` | required | read | n/a | 200 | **none** |  |
| 126 | GET | `P/R/scene/artifacts` | required | read | n/a | 200 | **none** | cursor |
| 127 | POST | `P/R/scene/artifacts` | required | generate | receipt | 201 | typed |  |
| 128 | GET | `P/R/scene/artifacts/:artifactId` | required | read | n/a | 200 | typed |  |
| 129 | GET | `P/R/scene/artifacts/:artifactId/glb` | required | read | n/a | 200/304 | binary (model/gltf-binary) |  |
| 130 | GET | `P/R/scene/artifacts/:artifactId/manifest` | required | read | n/a | 200 | typed |  |
| 131 | GET | `P/R/scene/delivery` | required | read | n/a | 200 + 304 (undocumented) | typed |  |
| 132 | GET | `P/R/scene/status` | required | read | n/a | 200 | **none** |  |
| 133 | POST | `P/R/scene/validate` | required | generate | **ignored** | 200 | **none** |  |
| 134 | GET | `P/R/structural/analyses` | required | read | n/a | 200 | **none** | cursor |
| 135 | POST | `P/R/structural/analyses` | required | generate | receipt | 201 | typed |  |
| 136 | GET | `P/R/structural/analyses/:analysisId` | required | read | n/a | 200 | typed |  |
| 137 | GET | `P/R/structural/status` | required | read | n/a | 200 | **none** |  |
| 138 | POST | `P/R/structural/validate` | required | generate | **ignored** | 200 | **none** |  |
| 139 | GET | `P/R/systems/analyses` | required | read | n/a | 200 | **none** | cursor |
| 140 | POST | `P/R/systems/analyses` | required | generate | receipt | 201 | typed |  |
| 141 | GET | `P/R/systems/analyses/:analysisId` | required | read | n/a | 200 | typed |  |
| 142 | GET | `P/R/systems/status` | required | read | n/a | 200 | **none** |  |
| 143 | POST | `P/R/systems/validate` | required | generate | **ignored** | 200 | **none** |  |
| 144 | GET | `P/R/takeoffs` | required | read | n/a | 200 | typed | cursor |
| 145 | POST | `P/R/takeoffs` | required | write | receipt | 201 | typed |  |
| 146 | GET | `P/R/takeoffs/:takeoffId` | required | read | n/a | 200 | typed |  |
| 147 | GET | `P/R/takeoffs/:takeoffId/construction-calculations` | required | read | n/a | 200 | typed | cursor |
| 148 | POST | `P/R/takeoffs/:takeoffId/construction-calculations` | required | write | receipt | 201 | typed |  |
| 149 | GET | `P/R/takeoffs/:takeoffId/construction-calculations/:calculationId` | required | read | n/a | 200 | typed |  |
| 150 | POST | `P/R/takeoffs/:takeoffId/construction-calculations/:calculationId/cost-estimates` | required | write | receipt | 201 | typed |  |
| 151 | GET | `P/R/verification` | required | read | n/a | 200 | typed |  |
| 152 | POST | `P/R/verification` | required | generate | **ignored** | 200 | typed |  |
| 153 | POST | `P/R/verification/diff` | required | generate | **ignored** | 200 | typed |  |
| 154 | POST | `P/revisions/generate` | required | generate | receipt | 201 | typed |  |
| 155 | POST | `P/routing/decisions` | required | write | **ignored** | 200 | typed |  |
| 156 | POST | `P/specialists/:module/requests` | required | generate | keyed replay (service) | 201 + 200 refusal/replay | typed |  |
| 157 | GET | `P/workflows` | required | read | n/a | 200 | **none** | cursor |
| 158 | POST | `P/workflows` | required | generate | receipt | 201 | typed |  |
| 159 | GET | `P/workflows/:workflowRunId` | required | read | n/a | 200 | typed |  |
| 160 | POST | `P/workflows/plan` | required | write | **ignored** | 200 | typed |  |
| 161 | GET | `/api/reference-downloads` | link token | read | n/a | 200/304 | binary (application/octet-stream) |  |
| 162 | GET | `/api/regions` | optional | read | n/a | 200 | typed |  |
| 163 | GET | `/api/routing/capabilities` | required | read | n/a | 200 | typed |  |
| 164 | GET | `/health/live` | none | exempt | n/a | 200 | typed |  |
| 165 | GET | `/health/ready` | none | read | n/a | 200 | typed |  |
