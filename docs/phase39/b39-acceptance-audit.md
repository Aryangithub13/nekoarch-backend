# B39 Acceptance Closure and Readiness Audit

**Status:** audit of record, 2026-10-14, on `phase31/development` @ `25c2a27` (PR #20 merged on top of PR #23 `6e54470`). **Verdict: B39 BLOCKED — user decision or external gate required.** B39 is not accepted and B40 is not started. No merge, deploy, migration, tag, release or PR state change was made.

**Authorities:**
- ROADMAP: [`docs/sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md`](../sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md) (sha256 `0ebc4479…3a03`, re-verified).
- Scope of record: [`b39-specialist-scope.md`](b39-specialist-scope.md) (PR #20, merged as `25c2a27`).
- Implementation records: [`b39-s1-implementation.md`](b39-s1-implementation.md) and [`b39-s2-implementation.md`](b39-s2-implementation.md).

**Excluded:** B34 verification/diff code. That repair belongs to a separate session. This audit changes no B34 file and makes no claim that depends on that repair.

## 1. Verified baseline

| Item | Reported | Verified here |
|---|---|---|
| Development head | `6e54470` (PR #23) | **`25c2a27`**: PR #20 was merged on top of `6e54470` at 15:50:49Z. Docs only (`b39-specialist-scope.md`) |
| PR #23 | Merged as `6e54470` | Yes. Head `b55ad21`, merged 15:10:02Z |
| CI run 38586942339 (`6e54470`) | 3,089 tests on both Node lines | Yes: `backend (node 22.22.0)` reported 112/112 files and 3,089/3,089 tests in its log. `backend (node 22.23.3)`, `container smoke`: success. `supabase-acceptance`: **skipped** (manual dispatch only) |
| CI run 38592927349 (`25c2a27`) | — | **Success** (completed 16:04:11Z): both Node test jobs and container smoke. `supabase-acceptance` skipped |
| PR #24 | Duplicate S1 correction | **Closed, not merged**, at 15:50:29Z. See §2 |
| PR #20 | Draft | **Merged**, as `25c2a27` (the owner's authorization is recorded in the merge message) |
| B37 | Merged as `4d1da13` | Yes (PR #17). D-9 hosted migration history, D-10 staging and D-11 tag are still open |

## 2. PR #24 versus PR #23

- PR #24 (`82d7373`, base `b543268`) is one commit, touching 3 files:
  - `specialist-service.ts`: extracts a `verificationOutcome()` helper that maps verification `FAILED` to status `FAILED`;
  - a unit test for that helper;
  - an edit to the S1 record.
- The behavior is already on the development branch, inline, from PR #23 (`apps/api/src/services/specialist-service.ts:192-198`). It is covered at the database level by `apps/api/tests/specialists-verification.integration.test.ts`, and the S1 and S2 records already carry the FAILED decision.
- **Superseded, with no unique behavior.** Its only extras are the helper's shape and a restore-route string in the message. The owner had already closed it, so no further action is needed.

## 3. Scope (PR #20) against code

| Check | Result |
|---|---|
| Interior schema and migration 0029 deferred | **Yes.** D-12 deferred (§9). No `0029*` migration exists (`supabase/migrations/` ends at `0028`) |
| Interior is a typed `UNSUPPORTED` | **Yes.** `specialist-service.ts:100-102` names D-12 and says the advisory concept routes are not an Interior implementation. Tested in the integration refusal table and the live-Supabase S1 case |
| A failed B34 verification after a Blueprint commit is `FAILED` | **Yes.** Scope §4 row 1 and §9; code `specialist-service.ts:196`; `specialists-verification.integration.test.ts` |
| U2 treatment is explicit | **Explicitly not closed.** Scope §5 "Proposed handling" is labelled *proposed* and has no owner decision. See §5 |
| No weakening of preservation, refusals or compatibility | **None found.** The route is additive (one route). No existing route, schema or SQL changed. Locks on rewritten scopes are `BLOCKED_BY_LOCK`. The Exterior geometry lock is enforced by Phase 30 (comparison `modelIdentical`/`geometryIdentical` asserted) |
| **Scope's own completion rule** | §4: "B39 is complete only after S3. Interior is not waived by this document." §9 D-12: the L297 gate "cannot be met for Interior until D-12 is approved and implemented, or the owner waives Interior explicitly" |

## 4. Six-specialist matrix

| Module | Implementation | Contract and lifecycle | Test evidence (PostgreSQL unless noted) | Preservation and freshness | Outstanding | Verdict |
|---|---|---|---|---|---|---|
| **Interior** | None; typed refusal only | `UNSUPPORTED` / `MODULE_NOT_AVAILABLE`, nothing stored | Refusal table; live-Supabase S1 case (prior receipt) | n/a | D-12 (schema + operation kind + migration), or an explicit owner waiver | **EXPLICITLY UNSUPPORTED** — gate L297 and scenarios 33 and 46 not met |
| **Exterior** | Cladding/finish through Phase 30 `APPEARANCE_MODIFY` | Preflight stored (`AWAITING_CONSENT`, `operationId`); execute, compare and approve via existing routes; no auto-approval | Scenarios 34 and 42; natural-language refusals; keyed replay; stale base | Model and geometry identical through approval; `APPEARANCE_VARIANT` current; the candidate on a superseded base is refused at approve (`REVISION_BASE_STALE`, new test §6) | **U2** (cladding-only edit still makes quantities and cost stale); glazing and massing `UNSUPPORTED` (no engine) | **BLOCKED** on the U2 decision |
| **Blueprint** | Canonical generator + QA + B34 verifier, one new revision | Typed limits (floors, rooms); `FAILED` on a failed verification; no job or render | Scenario 35; idempotency and concurrency; verification outcomes | Common revision IDs across result, artifact, manifest and `changeImpact`; superseded base → `STALE_DEPENDENCY` | Depends on B34's verifier for the verification signal. The B34 repair is external; this audit does not certify the verifier's correctness | **PASS** (S1 criteria), qualified by the external B34 repair |
| **Structural** | B24 linear static frame analysis | Always `REQUIRES_REVIEW`; engine claims verbatim; other analysis types `UNSUPPORTED` | Scenario 36; refusal table; keyed replay | Artifact in the manifest; stale once superseded (new test §6) | Validated solvers do not exist (typed refusal) | **PASS** (S2 criteria) |
| **Materials** | Takeoff + construction calculations | `PARTIAL` honest; substitutions `UNSUPPORTED` | Scenario 37; replay and convergence | Artifacts in the same revision's manifest; stale once superseded (new test §6) | Substitutions and supplier provenance: roadmap L291 deliverable, refused by type | **PASS** (S1 criteria); roadmap L291 substitutions not delivered |
| **Budget** | BOQ/cost engine | Always `REQUIRES_REVIEW` (synthetic rates); unpriced never zero; unknown rate book or region `UNSUPPORTED` | Scenario 38; stale input → `STALE_DEPENDENCY` | Input freshness from the manifest before pricing; stale once superseded (new test §6) | Regional versioned rates: roadmap L291 deliverable, refused by type | **PASS** (S1 criteria); roadmap L291 regional rates not delivered |

"PASS (S1/S2 criteria)" means the slice acceptance list of scope §7, which the owner accepted under D-4. Where roadmap L289–291 deliverables are refused by type instead of implemented, the matrix says so. Those refusals do not count as deliveries.

## 5. Decisions still required

**D-12 (Interior).** Options:
- **(a) Approve S3.** This needs the next sequential migration (extending the `0020` operation-kind check and adding V2 space finish fields), an interior operation, scenario 33 tests and a local Supabase receipt. Only then can the L297 gate be met.
- **(b) Formally waive Interior for B39.** This is an owner decision recorded in the scope, with a named follow-up phase. B39 could then be accepted as five modules, with Interior a typed `UNSUPPORTED`. Scenarios 33 and 46 would stay unmet and would be carried forward.
- **(c) Keep D-12 deferred.** B39 stays blocked.

**U2 (element-level invalidation).** Background: B37 waived U2 and assigned it to the B39 Exterior specialist (`phase37-acceptance-gap-report.md` §10). The B39 scope §5 only *proposes* making it a criterion once a geometry-changing Exterior request exists. Options:
- **(a) Accept scope §5's proposal.** U2 then moves out of B39's gate to the phase that adds a geometry engine, and must be named.
- **(b) Require U2 in B39.** This needs per-output input scopes in the B37 manifest (derived on read; this audit has not shown whether a migration is needed). Part of the U2 assignment goes through retrofit #24 (B34–37). That overlaps the excluded B34 work, so it would need coordination with the B34 repair session.

Until one is recorded, scenario 34's "cladding swap… preserving" claim stands with the disclosed `DOWNSTREAM_REGENERATION` caveat, and U2 is not resolved.

## 6. Change made by this audit

| File | Purpose | Criterion |
|---|---|---|
| `apps/api/tests/specialists.integration.test.ts` | New test, "scenario 39 and gate L297". The flow:<br>1. Materials, Budget and Structural outputs and an executed Exterior candidate are all made on one authored base.<br>2. The Blueprint specialist then commits a new revision.<br>3. The base's manifest reports every derived output `stale`.<br>4. The Exterior candidate's approval is refused (`409 REVISION_BASE_STALE`; operation `STALE_BASE`; revision count unchanged).<br>5. Each of Materials, Budget, Structural and Exterior then answers `STALE_DEPENDENCY` / `BASE_REVISION_SUPERSEDED` with nothing stored | Scenario 39 ("stale derived artifact is surfaced and blocked when consequential"); gate L297 ("common revision IDs… affected-cost/engineering freshness"); "no stale candidate can be approved as if current" |
| `docs/phase39/b39-acceptance-audit.md` | This record | — |

**No production code changed.** The new test is **coverage evidence, not a regression for a fix**: it passed against the unchanged code. It closes an evidence gap. No existing test crossed the specialist, revision and approval boundaries in one flow.

## 7. Verification (this session)

All on `25c2a27` (detached), Node 22.22.0, npm 10.9.4, Linux. The full test suite ran as an unprivileged user (embedded PostgreSQL refuses root).

| Command | Exit | Result |
|---|---|---|
| `npm ci` | 0 | — |
| `npm audit --omit=dev --audit-level=high` | 0 | 0 vulnerabilities |
| `npm run build` | 0 | — |
| `npm run typecheck` | 0 | — |
| `npm run lint` | 0 | — |
| `npx vitest run` (full suite, unchanged tree) | 0 | **112/112 files, 3,089/3,089 tests**, matching CI |
| `npx vitest run apps/api/tests/specialists.test.ts apps/api/tests/specialists.integration.test.ts apps/api/tests/specialists-verification.integration.test.ts` (with the new test) | 0 | **3/3 files, 19/19 tests** (integration file 11 → 12). Full-suite total with it: 3,090 (not re-run as a whole) |
| Mutation: the specialist current-base guard disabled (`specialist-service.ts:119`), only the new test run | 1 | **Caught**: Materials stored a new takeoff on the superseded base (201, not the 200 refusal). Source restored byte-identical |
| `npx eslint` / `npx tsc --noEmit` with the new test | 0 / 0 | — |
| Container smoke | not run here | No Docker daemon in this environment. CI: success on `25c2a27` (run 38592927349) and on `6e54470` (run 38586942339) |
| Local disposable Supabase acceptance | **not run here** | No Docker daemon. The prior receipt `docs/phase16-evidence/supabase-2026-10-14T13-35-20.232Z.json` holds 3,964 requests, 0 API errors and 23 failures, all deliberate 401s. The file records **neither a commit SHA nor a pass count**; "124/124" is stated only in commit `b55ad21`'s message |

## 8. Outstanding gates

| Layer | Gate | State |
|---|---|---|
| Local | Full suite, build, typecheck, lint, audit on `25c2a27` | **Passed** (§7); CI green on both Node lines |
| Local | New scenario 39 test in CI | Not pushed (see the session report for the branch decision) |
| Disposable database | Local Supabase acceptance on `25c2a27` or later | **Not run** in this session. The prior receipt is not bound to a commit. To close: `supabase start && supabase db reset --local && node scripts/ensure-local-postgrest.mjs && node scripts/test-local-supabase.mjs`, or a `workflow_dispatch` of Backend CI (the `supabase-acceptance` job) on the head, with the run id recorded |
| Hosted migrations | D-9 hosted migration history (0018–0028) | **Not run**; operator only |
| Staging | D-10 | **Not run**; prepared only |
| Release | D-11 tag; B39 release | **Not run**; on hold |
| External | B34 repair (separate session) | Pending. Blueprint's verification signal comes from B34, so Blueprint acceptance is qualified until that repair lands and is re-verified |
| Decisions | D-12 (Interior), U2 | **Pending owner** (§5) |

## 9. Verdict

**B39 BLOCKED — USER DECISION OR EXTERNAL GATE REQUIRED.**

- The scope of record says B39 completes only after S3 (Interior), which is deferred (D-12) and not waived.
- U2 has no owner decision.
- The disposable-database and hosted gates have not been run against the current head.

The five implemented modules meet their slice criteria on local evidence.
