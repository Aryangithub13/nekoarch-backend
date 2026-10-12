# Phase 35 report: supertall engineering assessment and verification

**Final status: PHASE 35 PARTIALLY COMPLETED.** The deterministic engineering assessment is implemented and verified within its supported scope, on this machine, against local embedded PostgreSQL. It was not verified against hosted Supabase. The Phase 35 V2 research file was not available, so the research-dependent parts are recorded as blocked (§G).

## A. Summary

A stored revision can now be given a **preliminary engineering assessment** at `…/revisions/:revisionId/engineering-assessment`. It computes the following exactly:

- storey heights and building height;
- gross floor area and gross volume;
- the minimum base width of the lowest storey and the height-to-width ratio;
- conceptual cost arithmetic on rates the caller supplies with their sources.

It reuses the Phase 34 verifier for site and area bases. For the twelve engineering domains a tall building raises, it reports exactly what blocks a determination: missing inputs, unverified candidate sources, no validated solver, not implemented, or professional review required. It lists actionable requirements by input path.

No structural, wind, seismic, soil, foundation, member, drift, stability, dynamic, collapse or compliance value is produced, and the report never claims safety, compliance, certification or approval. A 163-storey, 834.56 m concept is assessed in about 70 ms in process and about 2 s over HTTP, including storing the revision.

## B. Baseline

| Item | Value |
|---|---|
| Session branch | `main`: one unrelated commit (`dd6e469`, README only), no shared history with the backend |
| Backend code | `origin/phases-31-34` at `d1c11bb`: Phase 34 (`6099cda`) plus a hardening commit (migration 0024, dependency advisories). PR #3 merged `6099cda` into the default branch `phase31/development` (`a1398dc`). |
| Working tree at start | Clean |
| Tags | Phase tags stop at `backend-v1-phase30-complete`. B31–B34 have no tags. |
| Roadmap | The 46-phase roadmap file is not in any branch. B35 scope comes from the roadmap quotes in the Phase 30, Phase 34 and modernization documents. |
| Migrations | 0001–0024 in the repository. Hosted Supabase was not accessible, so the hosted migration ledger was not inspected. |

Status of prior phases as established here: B31–B34 are implemented and their reports state local tests passed, but none states hosted Supabase or deployment verification. This session re-ran their suites locally (§E). Nothing was deployed.

## C. Implementation

| Area | Files |
|---|---|
| Contracts (versioned request and report, limits, claims) | `apps/api/src/engineering/contracts.ts` |
| Candidate source registry (identification only) | `apps/api/src/engineering/sources.ts` |
| Exact geometry: storey heights, gross volume, convex hull, minimum caliper width, floored ratio | `apps/api/src/engineering/geometry.ts` (reuses Phase 34 bigint primitives) |
| Conceptual cost arithmetic with double-count, jurisdiction and completeness guards | `apps/api/src/engineering/cost.ts` (reuses `Rational` and `moneyString` from Phases 14/15) |
| Assessment: findings, domains, blockers, requirements, hashes | `apps/api/src/engineering/assess.ts` |
| Service and routes | `apps/api/src/services/engineering-service.ts`, `apps/api/src/routes/engineering.ts` |
| Reuse | `readRevisionModel` exported from the Phase 34 service (renamed from its private `revision`; behaviour unchanged); B33 `currentBrief`; B31 `readReference`; B24/B26/B27 status reads |
| Integration | Discovery `ENGINEERING_ASSESSMENT`; Sentry safe route; OpenAPI mapping (`test-support/openapi.ts`); route catalog and OpenAPI regenerated (123 → 125); scripts `test:engineering`, plus `test:unit` and `test:integration` |
| Tests and fixtures | `apps/api/tests/engineering.test.ts`, `apps/api/tests/engineering.integration.test.ts`, `test-support/tower-fixtures.ts` (a QA-passing authored N-storey tower), `test-support/tsx-worker.mjs` (§E.3) |

**Database: no migration.** The assessment is derived on read, like Phase 34, and persisting reports as evidence packages is Phase 38 work. No migration was added, applied locally or applied to hosted Supabase.

**Durable jobs: not used.** The work is bounded and fast (§A, design §9), so a job would only add state.

**AI: not used.** All numbers come from deterministic code, and nothing needs an API key.

**Defect found during self-review.** The cost report capped `warnings` at 200. At the input limits (64 synthetic, undated, unscoped components on an envelope-based model), about 333 warnings are possible. That would have failed response validation and returned 500 instead of a report. The bound is now derived from the input limits, and a regression test exercises the worst case (it fails with the old bound).

**Defect found during integration review (fixed in a separate commit on top of `b63e5e0`).** The jurisdiction safeguard could be bypassed by omission. A rate whose source stated no jurisdiction and no date (for example an overseas cost-book figure) was still counted towards a `COMPLETE` estimate with a `completeTotal`, with only warnings. A complete total now also requires every priced rate and every adjustment to state its jurisdiction and an effective or retrieval date. Otherwise the estimate is `PARTIAL`, and the missing items are listed as requirements. Adjustments now carry the same date and jurisdiction warnings as components. The warning bound is re-derived (64 × 5 + 16 × 2 + 16 = 368). A regression test fails without the fix.

## D. Supported and unsupported

**Supported:**
- exact storey heights and building height above the lowest storey floor;
- per-storey plate areas, gross floor area, plot area, FAR and coverage (from Phase 34) and gross volume;
- minimum base width and height-to-width ratio (an indicator, with no limit);
- exact comparison with declared height and storey targets and with the brief's stated floors;
- conceptual cost arithmetic on five quantity bases, with ordered sourced adjustments, partial and blocked outcomes and full traceability;
- evidence declaration linked to the project's own inspected references;
- an actionable requirements list.

**Unsupported, and reported as such:**
- load derivation (gravity, wind, seismic) and load combinations;
- geotechnical and foundation design;
- lateral drift and stability, including P-delta;
- dynamic or modal response;
- member design and utilisation;
- progressive collapse;
- lift traffic analysis;
- code compliance;
- certification and approval;
- statutory height and height categories;
- interpretation of evidence documents;
- any official rate, index or tax factor.

## E. Verification

### E.1 Commands and results (Linux container, Node 22.22.0, npm 10.9.4)

| Command | Result |
|---|---|
| `npm run build` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `vitest run apps/api/tests/engineering.test.ts` | **20/20** (19 in `b63e5e0`; the regression test for the jurisdiction/date fix is the 20th) |
| `vitest run apps/api/tests/engineering.integration.test.ts` (embedded PostgreSQL, real HTTP, real worker-isolated reference inspector) | **3/3** |
| `vitest run apps/api/tests/modernization.test.ts` (route catalog, anonymous inventory, OpenAPI drift) | 6/6 |
| Full `vitest run` with B35 | See E.2 |

Mutation check: five hand-made mutants were each detected by the unit suite (5/5 killed). They were: GST `UNKNOWN` not blocked; foreign-jurisdiction rates accepted; maximum instead of minimum width; `UNSUPPORTED` reported as `EVALUATED`; Indian sources borrowed for another country.

Independent expected values: the 163 × 5 120 mm tower's gross floor area is 163 × 1.2 × 10⁹ − 162 × (31 × 280 × 1 200) mm² = 193 912 608 000 mm², its height is 834 560 mm and its width 30 000 mm (ratio 27.8186, floored). The authored 8 × 6 m fixture gives 48 m², 144 m³ and a 0.5000 ratio. The cost cases were worked by hand and are commented in the tests.

### E.2 Full suite: B35 against the pre-B35 baseline

Both runs used `vitest run` as the unprivileged `nobody` user, on the same container (§E.3).

| Run | Files | Tests |
|---|---|---|
| Baseline `d1c11bb` (pre-B35, separate worktree) | 11 failed, 75 passed (86) | **57 failed**, 2 664 passed (2 721) |
| B35 `b63e5e0` | 11 failed, 77 passed (88) | **57 failed**, 2 686 passed (2 743) |
| B35 + jurisdiction/date fix (re-run against a fresh baseline) | 11 failed, 77 passed (88) | **57 failed**, 2 687 passed (2 744) |

The failing-test sets are **identical**: 0 new failures and 0 fixed. The 22 added tests all pass. The 57 pre-existing failures fall into two groups:

- **55: worker-thread / tsx toolchain issue (§E.3).** These either fail directly with `503 *_WORKER_FAILED` or `*PoolError`, or fail downstream of such a step (an `undefined` id or result after a failed upload or compile, or reference counts that never incremented). Suites: optimization pool, scene pool, Phase 31 inspection pool, and the references, jobs, optimization, scene, revision, modernization and account integration suites.
- **2: stale expectations in `supabase/tests/database.test.ts`.** It expects 28 tables and 55 foreign keys; the B31–B33 migrations produce 36 and 65.

An earlier full run during development reported 2 extra failures (`engineering.test.ts`, and the OpenAPI drift test in `modernization.test.ts`). Both were caused by this session editing the cost-report schema while that run was in flight: a temporary mutation-test edit and an OpenAPI regeneration. Both files pass on the final code, and the clean final run above confirms this.

### E.3 Environment notes (not B35 changes)

- **Embedded PostgreSQL** refuses to run as `root`, and needs the `en_US.UTF-8` locale that this container lacked. The locale was registered in the container (`localedef`, not a repository change), and the suites ran as the unprivileged `nobody` user. Without this, every PostgreSQL suite fails at startup.
- **Worker threads.** On Node 22.22.0, tsx's `.js`→`.ts` resolution is not applied inside workers started with `execArgv: ['--import', 'tsx']`. Every source-mode worker pool fails as a result (scene, optimization, reference inspection, appearance, jobs). This is a pre-existing toolchain issue. B35 does not change the shared pool. Its integration test starts the real inspector through `test-support/tsx-worker.mjs`, which registers tsx inside the worker. A follow-up is proposed to apply the same bootstrap in `ownWorker()` for source mode only.
- **`supabase/tests/database.test.ts`** still expects 28 tables and 55 foreign keys. Migrations 0021–0023 (B31–B33) create 36 tables and 65 foreign keys. This is pre-existing test debt, left untouched and proposed as a follow-up.
- The Windows path assertion in `interpretation.test.ts` reported by Phase 34 does not occur on Linux.

## F. Security, tenancy and resource limits

- **Ownership.** It is established by the RLS-scoped revision read. Another user gets 404, an anonymous caller 401, and an unknown revision 404 (tested). Both new routes appear as anonymous → 401 in the regenerated catalog, and the anonymous allowlist test passes unchanged.
- **Evidence.** It must be a live reference of the same project. A random id and another user's reference both give the same 422, so existence is not leaked across tenants (tested).
- **Idempotency.** Both routes are side-effect free. Repeated calls return identical hashes (tested) and store nothing (revision count and brief version are unchanged, tested). `POST` is rate-limited in the `write` group.
- **Bounds.** The body is limited to 64 KiB (over-limit → the app's uniform 400, tested). Evidence ≤ 16, components ≤ 64, adjustments ≤ 16. The model is bounded by its schema and the Phase 34 operation budget. Every report array has an explicit maximum, derived from the input limits.
- **Logging.** No request bodies or raw inputs are logged. Only the route template is added to Sentry's safe list.

## G. Research provenance

- **`NekoArch_Phase35_Engineering_Research_Enhanced_v2_2026-10`: not found.** It is not in the repository, any branch or any commit, and it was not supplied in this session. It was not consulted, and no substitute was used.
- The 46-phase roadmap file was not found either. Its B35 wording comes only from the quotes in the Phase 30, Phase 34 and modernization documents.
- **Consequences.** Research-specific items, such as the CPWD `0.973` GST-related factor and any research-specified formulas or thresholds, are **not implemented**. The safeguards in the Phase 35 brief (source hierarchy, fail-closed sources, India cost rules, provenance) are implemented as described in design §6–§8. No standard was retrieved, so every named source is `NOT_VERIFIED`, has no edition, and is used only to identify what needs verification.

## H. Compatibility

- **Unchanged contracts.** Existing routes, Zod contracts, hashes, preservation locks, job semantics and stored data are unchanged. The only change to existing code is exporting the Phase 34 revision loader and three additive registrations: a discovery row, a Sentry route and the OpenAPI mapping.
- **Capability discovery** (`capability-discovery-v2`) gains one service row. The discovery test, which requires every advertised service to be a registered route, passes.
- **Frontend.** Integration, including the deferred B30 frontend verification and the frontend Phase 35 calculation workspace, is **deferred**. The frontend repository was not touched.

## I. Not covered

- Hosted Supabase and any deployment were not exercised; no hosted migration was needed.
- Live external services were not used.
- No release tag was created: B31–B34 were not tagged either, and the full suite is not green, for the pre-existing reasons in §E.

## J. Next

- **B36, cloud engineering compute gateway.** Its first consumers would be validated external solvers behind the `REQUIRES_SOLVER` blockers named here. Dependencies are to be verified against the authoritative roadmap before starting.
- **Later phases.** Phase 38 would persist assessments as evidence packages. Verified source ingestion would follow through the Phase 27 knowledge-pack mechanism, and official rate-book ingestion with verified provenance would follow in later cost work.
