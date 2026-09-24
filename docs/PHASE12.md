# Phase 12 — Native Building Model V2 persistence and Project API

Baseline: `f202a44` / `backend-v1-phase11-complete`, verified clean before edits. This is additive backend work in the requested repository. No completion commit or tag is created.

## 1. Implemented

First-class owned projects, metadata updates, archive/unarchive, private/public visibility, complete V2 generated and supplied saves, immutable numbered revisions, historical retrieval, independent QA acceptance, full QA evidence, atomic current pointers, optimistic concurrency, durable retry receipts, keyset pagination and database-backed audit events.

## 2. Database architecture

`projects`: database UUID, nullable owner FK, title, ACTIVE/ARCHIVED, PRIVATE/PUBLIC, nullable current revision, protected revision counter, created/updated/archive timestamps. No geometry.

`project_revisions`: immutable V2 JSONB, project FK, revision number, parent, source mode, generator version when generated, immutable creator UUID, timestamp and acceptance QA ID. Complete model provenance remains unchanged inside JSONB. Creator UUID is historical attribution; ownership authorization comes only from the project.

`project_revision_qa_runs`: immutable full report JSONB plus engine version, model schema version, rule-pack identity/version, status, revision FK and timestamp. Multiple runs per revision are possible.

`project_audit_events`: private transactional events for creation, metadata update and accepted revision, with bounded metadata rather than geometry or credentials.

`project_private.commit_key`: generated 256-bit key, inaccessible through client grants or exposed schemas. It authenticates the server's QA attestation.

Composite FKs constrain parents and current pointers to the same project and acceptance QA to the same revision. Deferred FKs allow revision/QA insertion in one transaction. A deferred pointer trigger checks accepted QA and matching revision number. Unique `(project_id, revision_number)` enforces ordering. UPDATE triggers protect revisions and QA even against accidental privileged changes. Clients have no insert/update/delete grants on these tables.

Indexes cover owner + updated time + ID, owner + status, current revision, project revision ordering, parent references, revision QA lookup and project audit lookup. No deep JSON indexes.

## 3. Transaction model

`project_write` is a fixed-search-path SECURITY DEFINER RPC with explicit `auth.uid()` checks. Revision calls verify a short-lived server HMAC over the exact caller, route, commit payload and retry context. Then it acquires the existing caller/operation/key advisory lock when applicable, replays an existing receipt or detects a fingerprint conflict, locks the owned project row, verifies active state and base, allocates the next number, inserts revision and QA, advances the pointer, inserts the audit event and stores the response receipt. IDs and timestamps come from PostgreSQL. Any failure rolls back the entire command.

Metadata creation is independent of generation, so a project may have no revision. Metadata writes use the same RPC with a strict field allowlist; clients cannot set ownership or architectural pointers.

## 4. Concurrency model

`baseRevisionId` defaults to null for an empty project. After the first accepted save, the caller must send the current ID. The row lock serializes concurrent commits, and comparison occurs inside that lock. A stale or missing base receives HTTP 409 `REVISION_CONFLICT`. Two different saves from one base produce one acceptance and one conflict. The protected counter allocates monotonically increasing numbers; no unlocked MAX query is used.

Idempotent replay precedes stale/archive checks both in the API and in the locked RPC. A replay returns the original response even after later revisions or archival. A new stale request remains a conflict.

## 5. Project API

All inputs, outputs, parameters and pagination cursors have runtime schemas in `apps/api/src/contracts/projects.ts`. Successful creations return 201; reads/metadata updates return 200. Authentication uses the existing Supabase request context. Inaccessible private IDs receive 404.

| Method | Route | Authentication | Request | Response |
|---|---|---|---|---|
| POST | `/api/projects` | Required | `{title}`; optional Idempotency-Key | Empty project detail |
| GET | `/api/projects` | Required | `limit` (1–100, default 20), optional cursor | Owner project summaries and next cursor |
| GET | `/api/projects/:projectId` | Owner | Project ID | Metadata, current revision/model and QA |
| PATCH | `/api/projects/:projectId` | Owner | Nonempty subset of title/status/visibility | Updated project detail |
| POST | `/api/projects/:projectId/revisions/generate` | Owner | `{requirements, baseRevisionId}`; optional Idempotency-Key | Project summary and accepted revision/model/full QA |
| POST | `/api/projects/:projectId/revisions` | Owner | `{model, baseRevisionId}`; optional Idempotency-Key | Project summary and accepted revision/model/full QA |
| GET | `/api/projects/:projectId/revisions` | Owner | Bounded page query | Revision metadata and acceptance QA summaries |
| GET | `/api/projects/:projectId/revisions/:revisionId` | Owner | Both IDs | Exact historical model and associated QA runs |
| GET | `/api/projects/:projectId/public` | Optional | Project ID | Public title/current revision/model/QA summary |

Project lists are ordered by updated timestamp descending, then UUID descending. History is ordered by revision number descending. Opaque base64url cursors preserve PostgreSQL timestamp precision. Lists omit models and full reports.

## 6. Generation workflow

Authenticated requirements → existing normalized BlueprintRequirements → `generateBlueprint` → `ArchitecturalBuildingModelV2Schema` → independent `auditBlueprint` → signed accepted result → transactional persistence.

Supplied documents enter at complete V2 validation. No client QA report is accepted. Existing solver failures return typed 422 responses. Generation does not expose solver diagnostics unnecessarily.

## 7. QA persistence

Accepted statuses are PASS and PASS_WITH_WARNINGS. FAIL returns 422 `BLUEPRINT_QA_FAILED` before any persistence. The existing error envelope contains status/counts and at most 20 JSON-encoded finding summaries, bounded to 240 message characters and five bounded entity IDs. No raw geometry or unrelated data is returned in errors.

The fixed server policy uses the existing product rule pack and requires reachability. Exterior doors on the lowest storey are entry candidates; QA independently verifies hosts and reconstructs connectivity. Full reports retain findings, measurements, coverage, circulation, assumptions, engine version and rule-pack metadata exactly. Acceptance evidence has a stable ID; later QA runs do not replace it. No public re-audit endpoint is introduced.

## 8. RLS and security

Owner SELECT policies protect projects, revisions and QA. Direct client writes are denied. Writes occur only through the narrowly scoped authenticated RPC, with explicit ownership checks. No service-role key is used for normal API operations.

Public access is deliberately via `project_read`'s public projection; direct table reads remain owner-only. The public projection excludes owner/creator IDs, parent IDs, history, full historical QA, receipts and audit records. PRIVATE, ARCHIVED and orphaned projects are unavailable publicly. The owner retains archived history.

HMAC verification prevents a caller from submitting fabricated PASS evidence directly to PostgREST. Signatures bind identity, project/base/model/report/source, operation and receipt context, with five-minute expiry. Signing secrets, envelopes, signatures, models and reports are redacted by the logger. Logs record project/revision IDs, revision number, QA status, source and the existing request ID.

The migration tightens direct receipt insert/delete policies only for new project operations so callers cannot forge project retry responses. Legacy V1 operation policies remain effective.

## 9. Idempotency

The new command helper reuses Phase 8's canonical payload hashing, hashed keys, caller/route identity, shared `idempotency_records`, 24-hour expiry and advisory-lock convention. It does not create a second receipt table. Project IDs are part of revision fingerprints; validated defaults and normalized requirements are hashed. Same key + different payload conflicts; different users are isolated. RPC response creation and receipt persistence are atomic.

## 10. V1 compatibility

V1 route implementations, plan/estimate services, sharing semantics, model schemas, generator/QA algorithms, historical migrations and seed data remain unchanged. V1 responses still contain V1. No historical JSON is rewritten, and legacy-planar adapter output is rejected by native saves. Existing plan, generation, retrieval, patch, estimate and region regressions remain part of the verification gate.

## 11. Migration and provisioning

`supabase/migrations/0006_projects.sql` adds four public tables, the private signing-key schema/table, constraints, indexes, owner RLS policies, projection helpers, immutability/pointer triggers and two public RPCs. It extends the existing receipt-operation constraint and narrows receipt policies for new operations. Historical migration files are untouched.

The migration is forward-only and applied once through the migration ledger. Do not re-run its SQL over an already migrated database. No destructive down migration is supplied.

Provision `PROJECT_COMMIT_SECRET` in the API's secret manager with the private database key obtained over an administrative connection (`select secret from project_private.commit_key where singleton`). Never return or log that key. No production service-role credential is required by the API. Without the key, revision creation fails closed with 503; V1 and project identity/metadata still operate. Rotation requires coordinated database/API secret deployment.

The local acceptance runner obtains local CLI credentials and the signing key in memory, refuses remote URLs, disables external Sentry configuration, and runs every behavior using caller JWTs. Administrative credentials are used only for setup, evidence inspection and cleanup of test-created identities/data.

## 12. Important new files

- `apps/api/src/contracts/projects.ts`: strict request/response/DTO/page contracts.
- `apps/api/src/lib/project-repository.ts`: RPC transport facade, page mapping and safe database error mapping.
- `apps/api/src/services/project-service.ts`: generation, complete validation, independent QA and attestation.
- `apps/api/src/routes/projects.ts`: nine API routes using existing auth and retry infrastructure.
- `supabase/migrations/0006_projects.sql`: native persistence and security.
- `test-support/project-acceptance.ts`: shared HTTP acceptance scenarios run against PostgreSQL and Supabase.
- `apps/api/tests/projects.integration.test.ts`: transactional, immutability, failure-injection and security tests.
- `docs/phase12-design.md`: pre-implementation design decisions.
- `docs/PHASE12.md`: implementation, operational and verification report.
- `docs/phase12-verification.json`: final command results and test counts.

## 13. Previous baseline files modified

| File | Required reason |
|---|---|
| `.env.example` | Document backend QA signing-key provisioning |
| `apps/api/package.json` | Declare QA as an API runtime dependency |
| `package-lock.json` | Record that workspace dependency |
| `apps/api/src/app.ts` | Register project routes |
| `apps/api/src/config/env.ts` | Validate optional signing-key configuration |
| `apps/api/src/lib/http-protection.ts` | Apply generation quota to both QA-intensive revision routes |
| `apps/api/src/lib/idempotency.ts` | Reuse Phase 8 identity/hashing/receipt lookup for atomic project commands |
| `apps/api/src/lib/logger.ts` | Redact new architectural and signing fields |
| `apps/api/src/lib/repository.ts` | Add optional caller-scoped project RPC transport |
| `apps/api/src/lib/supabase.ts` | Implement that transport using the existing caller JWT client |
| `test-support/pg-backend.ts` | Invoke identical project RPCs under real PostgreSQL principal roles |
| `apps/api/tests/supabase.live.test.ts` | Add native acceptance and direct SDK security tests; clean up test projects |
| `apps/api/tests/foundation.test.ts` | Extend the explicit public generator boundary allowlist to project contracts/service |
| `supabase/tests/database.test.ts` | Update exact table/FK inventory assertions for additive schema |
| `supabase/tests/rls.sql` | Update public-table count; repair pre-existing invalid nested write CTE so SQL RLS checks execute |
| `package.json` | Wire dedicated project tests, integration coverage and live setup |
| `scripts/test-local-supabase.mjs` | Extend existing local runner to obtain QA key and invoke acceptance |

No previous-phase algorithm defect was changed. Running `npm run db:test` reproduced a pre-existing test-only syntax defect: a data-modifying CTE nested inside `select is(...)` is invalid PostgreSQL. Moving the same CTE to the top level preserves the non-owner update regression assertion. Its stale table-count assertion was also updated for the current schema. During implementation, tests caught and corrected new orchestration/SQL issues (explicit QA entrances and an ambiguous PL/pgSQL public-read alias).

## 14. Tests

Added **23 PostgreSQL-backed default tests** and **17 live Supabase tests** (40 additional test instances). They comprise 16 shared acceptance scenario definitions run through both transports, seven PostgreSQL-only scenarios and one Supabase-only direct-SDK scenario. Dedicated commands overlap with the default suite and are not additional test counts.

- Project persistence: 23 dedicated PostgreSQL tests, including the 16 shared HTTP acceptance scenarios.
- Transaction-specific cases: rollback at four injected failure stages; database QA gate and immutable history; locked retry replay before stale/archive checks; cross-project current-pointer FK and account-deletion behavior. These are four explicitly focused cases, with further transaction assertions in the shared workflows.
- Concurrent-write cases: simultaneous different saves, duplicate project creation, duplicate generated revisions and duplicate supplied revisions. Four scenarios run against both transports (eight test instances), including both empty and populated bases.
- Focused isolation/RLS cases: shared owner/public-history isolation (both transports), direct PostgreSQL denial/forgery checks and direct live SDK denial/forgery checks (four test instances). Authentication and field-injection negatives are also asserted in other scenarios.
- Live Supabase acceptance: 21 total = four preserved V1 cases + 16 shared project cases + one direct V2 SDK/RLS case. All required flows A–G are covered with actual anonymous Auth users, JWTs, PostgREST/RPC and RLS.
- Additional SQL regression: all 24 existing pgTAP assertions pass after the documented test-only fixes.

No tests are skipped in successful verification runs. Initial sandbox/bootstrap failures and implementation failures were corrected and rerun; they are not counted as passing evidence.

## 15. Verification

All final checks passed on 2026-09-24. Default suite: **1,448 tests in 29 files** (1,425 baseline + 23 new). Separate live suite: **21 tests** (4 baseline + 17 new). Total across these two non-overlapping suites: **1,469 test instances**. The additional pgTAP run passes **24 SQL assertions** (1,493 including that separate SQL suite).

| Check | Final result |
|---|---|
| `npm run build` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test:unit` | PASS — 1,372 |
| `npm run test:generator` | PASS — 461 |
| `npm run test:blueprint` | PASS — 137 |
| `npm run test:blueprint-qa` | PASS — 177 |
| `npm run test:projects` | PASS — 23 |
| `npm run test:integration` | PASS — 74 on each of three consecutive runs |
| `npm run test:supabase` | PASS — 21 on each of two consecutive runs |
| `npm run check` | PASS — build, typecheck, lint and all 1,448 default tests |
| `npx supabase db reset --local` | PASS — migrations 0001–0006 and seeds; final schema reset completed before acceptance |
| `npm run db:test` | PASS — 24 SQL RLS assertions |
| `docker build -t designflow-api:phase12 .` | PASS — final image `92a06ca29d98` |
| `node scripts/smoke-container.mjs designflow-api:phase12` | PASS — non-root, liveness 200, dependency-unavailable readiness 503, SIGTERM exit 0 |
| `git diff --check` | PASS |

The initial local-reset approval was rejected until read-only evidence established the configured localhost stack contained zero Auth users, plans and estimates. With that evidence, approval was granted and the reset completed. No hosted database was reset. Embedded tests and local acceptance required sandbox escalation for local sockets/Docker; successful final runs contain no skips or unhandled errors.

Machine-readable command exits/durations and counts are in `docs/phase12-verification.json`. No completion commit, tag, staging or subsequent-phase work was performed.

## 16. End-to-end example

The shared acceptance case `round-trips generated geometry and complete QA, appends R2 and leaves R1 immutable` runs on both actual PostgreSQL and local Supabase Auth/JWT/PostgREST:

1. POST a private project; current revision is null.
2. Generate a complete one-storey blueprint from structured requirements.
3. Independently audit it and atomically save revision 1 and its report.
4. Parse the retrieved model and report through their runtime schemas; compare deeply with independent generation/audit output.
5. Save the same complete model as supplied revision 2 using revision 1's ID as base.
6. Assert number 2, parent R1, current R2, exact historical R1 equality and history `[2,1]`.

A separate shared case verifies two-storey generation and exact model equality.

## 17. Failure examples

Stale revision: after R1 → R2, submitting a new request with R1 or null as base returns 409 `REVISION_CONFLICT`; history remains two revisions and current remains R2. Two simultaneous saves from the same base produce statuses `[201,409]`.

QA rejection: remove the studio's connecting door and its dependent dimension from a schema-valid authored model. Independent QA reports `QA_UNREACHABLE_SPACE`; HTTP 422 `BLUEPRINT_QA_FAILED` includes bounded findings. An empty project's pointer stays null with no revision, and an existing project's complete detail remains unchanged.

Injected database failures before QA insertion, pointer update, audit insertion and receipt insertion each return safe 500 errors. PostgreSQL assertions show no revision, no orphan QA, unchanged null pointer/counter, only the original creation audit, and no retry receipt. Successful retries remain possible because failed writes leave no receipt.

## 18. Known limitations

- Body limits remain the configured global 1 MiB default for supplied models and existing 64 KiB small limit for generation/metadata. Larger documents are intentionally rejected.
- Entrance policy is a product convention (lowest-storey exterior doors), not a jurisdictional or life-safety certification.
- Keyset lists are deterministic for unchanged data, not a snapshot across concurrent metadata edits.
- QA re-audits are supported by storage, but require a future controlled workflow; new QA engines also require corresponding runtime report-schema support.
- Account deletion leaves owner-null inaccessible history, matching V1's retention convention. A user-facing purge/retention workflow is deferred. Test cleanup uses administrative cascade deletion only for test-owned projects.
- Signing-key rotation is operator-managed; an unconfigured API cannot create revisions.
- No hard-delete, collaborators, capability sharing or public history API is exposed.

## 19. Deferred

Phase 13 — Quantity Takeoff Engine; Phase 14 — Construction Calculation Engine; Phase 15 — BOQ + Cost Engine V2; Architectural AI; Solver V2; professional 2D renderer; 3D; structural engineering; MEP; collaboration ACL; jurisdiction-specific rule packs. Work stops at Phase 12.
