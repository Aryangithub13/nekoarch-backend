# B39 Acceptance Audit and Remediation Record

**Status:** written 2026-10-14 on `phase39/b39-acceptance-audit`, based on `phase31/development` @ `c5ebe72` (PR #25). Code candidate: `c343855`. The commit that adds this record changes documentation and one evidence file only.

**Not pushed, merged, deployed, migrated on any hosted database, tagged or released.** B40 is not started.

**Verdict:** see §8.

**Authorities:**
- ROADMAP: [`docs/sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md`](../sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md) (sha256 `0ebc4479…3a03`), cited as Lnnn.
- Scope of record: [`b39-specialist-scope.md`](b39-specialist-scope.md).
- Implementation records: [S1](b39-s1-implementation.md), [S2](b39-s2-implementation.md), [S3 and U2](b39-s3-implementation.md).

**Excluded: B34.** No B34 verification or diff file was edited. Blueprint's verification signal comes from B34, whose repair belongs to a separate session; no branch or PR for that repair was visible on the remote.

## 1. Baseline

| Item | State |
|---|---|
| `phase31/development` | `c5ebe72`: PR #25 (docs) merged on `25c2a27` (PR #20). CI run 38596168012 green. `supabase-acceptance` skipped (manual dispatch only) |
| PR #23 | Merged as `6e54470`. CI run 38586942339: 112 files and 3,089/3,089 tests on Node 22.22.0, verified from its log |
| PR #24 | Closed by the owner without merging. Superseded: the FAILED-verification mapping is already on the branch (`specialist-service.ts`) |
| PR #20 | Merged as `25c2a27` (docs only) |
| B37 | Merged as `4d1da13`. D-9, D-10 and D-11 still open |

## 2. Owner decisions

The options and their consequences were put to the owner in this session.

| ID | Decision (owner, 2026-10-14) |
|---|---|
| **D-12** Interior | **Approve with migration 0029** (supersedes the earlier deferral) |
| **U2** element-level invalidation | **Implement at whole-model granularity in B39** (supersedes scope §5's proposed deferral). Element-level input scopes are not part of B39 |

No waiver was granted by this session.

## 3. Requirement, evidence and gap

Tests run on PostgreSQL (embedded, with every migration applied) unless they are marked as unit tests.

| Requirement (ROADMAP / scope §7) | Implementation | Evidence | Remaining gap |
|---|---|---|---|
| L288 one typed envelope: revision, scope and locks, references, output config, provenance, quote/budget, jobs, impacts, candidate and approval lifecycle | `specialist-request-v1`; strict schema; Phase 30 lifecycle for Exterior and Interior | `specialists.test.ts` (unit); refusal, reference and budget cases | None |
| L289 Interior: finishes, bounded layout edits, egress checks, interior-only outputs | Finish data on spaces (0029). Layout → `SCOPE_EXPANSION_REQUIRED`; furnishings refused | `interior.integration.test.ts` (scenario 33, refusals, stale base, SQL forgeries, upgrade) | Layout edits and egress checks are refused by type, not delivered; QA is re-run at commit |
| L289 Exterior: façade materials, massing where supported, glazing constraints | Phase 30 cladding; glazing and massing `UNSUPPORTED` with impacts | Scenarios 34 and 42 (model and geometry identical); natural-language refusals | Geometry editing: no engine (typed refusal) |
| L290 Blueprint: layout solve, QA | Generator, QA and B34 verifier; one revision, no render job | Scenario 35; idempotency and concurrency; verification outcomes | B34 repair (external) |
| L290 Structural: solver evidence, no certification | B24 linear static; always `REQUIRES_REVIEW` | Scenario 36 | Validated solvers (typed refusal) |
| L291 Materials: quantities, recipes, units, substitutions, provenance | Takeoff and construction; substitutions refused | Scenario 37 | Substitutions and supplier provenance (typed refusal) |
| L291 Budget: regional versioned rates, BOQ, honest partial totals | Cost engine; synthetic rates `REQUIRES_REVIEW`; unpriced never zero | Scenario 38 | Sourced regional rates (typed refusal) |
| L293 typed statuses; per-module role and cost policies | Statuses and precedence; owner-only; generate quota; zero external cost | Unit tests; **quota test (added)** | None |
| L297 gate: one supported request per module through real adapters; common revision IDs and locks; changes fed to the B37 manifest and cost/engineering freshness | Six modules; manifest read-back | Per-module tests; **scenario 39 cross-specialist test (added)**; U2 tests | Live Supabase run on this candidate (§6) |
| L258 / U2: cladding differs from glazing for invalidation | Whole-model source equivalence in the B37 graph | Graph unit and PostgreSQL tests; M4 cladding fixture; Exterior-boundary check | Element-level scopes (out of B39 by decision) |
| Scenario 46: six modes with typed refusal | All six run; unimplemented actions refused | Refusal tables | None |
| Compatibility | Additive contracts; OpenAPI regenerated; 0029 a superset; populated-upgrade test | `modernization.test.ts`; 0029 upgrade test | Clients that parse V2 models strictly need the shared package with `finishes` before they read finished models |

## 4. Six-specialist matrix

| Module | Capability | Lifecycle | Persistence evidence | Freshness and preservation | Verdict |
|---|---|---|---|---|---|
| Interior | Finish data on spaces | Preflight → consent → execute → compare → approve; stale base refused | Phase 30 rows, 0029 SQL locks (forgery tests), committed revision | Model without finishes identical (SQL); exterior and structure held; appearance-variant base refused | **PASS** (local); live Supabase pending |
| Exterior | Cladding (Phase 30) | Same lifecycle; no auto-approval | Phase 30 rows and artifacts | Geometry byte-identical; U2: model-only outputs stay current | **PASS** (local); live Supabase pending |
| Blueprint | Regeneration with QA and verifier | Direct commit (scope §4 row 1) | Revision row | Common revision IDs; superseded base → `STALE_DEPENDENCY` | **PASS**, qualified by the B34 repair |
| Structural | Linear static analysis | Recompute | Analysis row | In the manifest; U2-equivalent family | **PASS** |
| Materials | Takeoff and construction | Recompute | Engine rows | In the manifest; stale on a model change | **PASS** |
| Budget | Cost on synthetic rates | Recompute | Engine rows | Input freshness checked before pricing | **PASS** |

## 5. Changes on this branch

| Commit | Purpose |
|---|---|
| `7eeaf66` | Scenario 39 and L297 cross-specialist test; first audit record |
| `64e4448` | Specialist route charged to the generate quota (test) |
| `e32247d` | U2 at whole-model granularity: graph rule and cause, service read, contract field; tests updated and added; OpenAPI |
| `b9eccec` | Interior: V2 finishes, Phase 30 `INTERIOR_FINISH_MODIFY`, migration 0029, specialist module; tests; ledger pin; live case; OpenAPI |
| this commit | S3 and U2 record, scope decision table, this audit |

**Mutation checks**, 8 of 8 caught: [S3 record §5](b39-s3-implementation.md).

## 6. Verification on the candidate commit

All runs were in this session, on Node 22.22.0 and npm 10.9.4. Embedded-PostgreSQL suites ran as an unprivileged user.

| # | Command | Commit | Exit | Result |
|---|---|---|---|---|
| 1 | `npm ci` | `b9eccec` | 0 | — |
| 2 | `npm audit --omit=dev --audit-level=high` | `b9eccec` | 0 | 0 vulnerabilities |
| 3 | `npm run build` / `npm run typecheck` / `npm run lint` | `b9eccec` | 0 / 0 / 0 | — |
| 4 | `npx vitest run` (full suite) | `b9eccec` | **1** | 113 files, **3,097 passed, 1 failed**. The D-10 staging rehearsal still checked the waived U2 behaviour (every output of A stale after an appearance edit). Fixed in `c343855` |
| 5 | `npx vitest run apps/api/tests/staging-workflow.integration.test.ts` | `c343855` | 0 | 3/3 |
| 6 | Container smoke: `docker build` (local proxy-CA shim in the **build stage only**; the runtime stage is byte-identical to the repository Dockerfile), then `node scripts/smoke-container.mjs` | `b9eccec` | 0 | "non-root, liveness 200, failed-dependency readiness 503, SIGTERM exit 0". The runtime image carries no proxy or CA settings |
| 7 | Disposable local Supabase:<br>`npx supabase start`<br>`npx supabase db reset --local` (applied 0001–**0029**)<br>`node scripts/test-local-supabase.mjs` | `c343855` | 0 | **125/125**, including the new S3 Interior case through real JWT, PostgREST and RLS. Receipt `docs/phase16-evidence/supabase-2026-10-14T17-30-30.615Z.json`: 4,023 requests, 0 API errors, 23 deliberate anonymous 401s. Stack stopped with `--no-backup` |
| 8 | `node scripts/ensure-local-postgrest.mjs` | `c343855` | **1** | **Deviation (same as the B37 gap report §6):** "Unexpected REST image; manual review required". Registry limits made the CLI use `postgrest/postgrest:v16.2` instead of the ECR name the helper expects; it refused before changing anything. The acceptance in row 7 ran on that image, like the earlier receipts |
| 9 | Mutation checks | various | — | 8/8 caught ([S3 record §5](b39-s3-implementation.md)) |

**Earlier in this session:** on `64e4448`, the full suite passed with 112 files and 3,091/3,091 tests.

**Not run:**
- CI on any commit of this branch: it is not pushed.
- Supabase acceptance through `workflow_dispatch`.
- Anything hosted, staging or release.

## 7. Outstanding gates and operator checklist

Each item needs owner authorization unless it is marked otherwise.

| Layer | Gate | State | To close it |
|---|---|---|---|
| Local | Full suite, build, typecheck, lint, audit, container smoke | **Passed** (§6; the full suite is re-run on the final commit, see the session report) | — |
| CI | Backend CI on the pushed head (both Node lines, container smoke) | **Passed.** PR #26 head `16f266a`: run 38668352395. After the merge into `phase31/development` (`4713218`): run 38670478737. Both Node lines and container smoke green; `supabase-acceptance` skipped (runs only on `workflow_dispatch`) | — |
| Disposable database | Supabase acceptance including the new S3 live case | **Passed locally, 125/125, on `c343855`**, with the PostgREST-helper deviation (§6 row 8). No CI `workflow_dispatch` receipt | If not passed here: `workflow_dispatch` of Backend CI on the PR branch (`supabase-acceptance` job), or locally `npx supabase start && npx supabase db reset --local && node scripts/ensure-local-postgrest.mjs && node scripts/test-local-supabase.mjs`. Record the commit SHA and the pass count |
| External | B34 repair | **Implemented in PR #27** (separate session; open; CI run 38679145597 green on `4bcdac0`). Owner merge decision pending. The PR keeps B34 itself not accepted (4 FAIL, 1 NOT VERIFIED in its matrix). **Checked locally on 2026-10-15:** `phase31/development` `287b1a4` merged with PR #27's head, then 8 suites, 72/72 (specialists including Blueprint verification, Interior, B34 verification, manifest, graph) | Owner decides PR #27. After the merge, CI on the merge commit covers the Blueprint path |
| Hosted (D-9) | Read-only ledger check, now `0001`–`0029` | **Not run.** No hosted credential exists in the session environment | Operator, per the [B39 runbook §1](../release/b39-release-gates-runbook.md). `0029` is expected to be pending. Applying it is a separate deployment decision |
| Staging (D-10) | Staging proof of the six specialists | **Not run.** **Prepared:** `scripts/staging-workflow-b39.mjs` (W-B39), rehearsed locally by `staging-workflow-b39.integration.test.ts` | Operator, per the [B39 runbook §2](../release/b39-release-gates-runbook.md), on a disposable staging deployment carrying `0001`–`0029` |
| Release (D-11) | Tag | **On hold** | In the order of the [B39 runbook §3](../release/b39-release-gates-runbook.md): D-9, the migration decision, D-10, PR #27, CI and a `workflow_dispatch` Supabase run on the exact commit; then the owner names the tag |

## 8. Verdict

**B39 BLOCKED — USER DECISION OR EXTERNAL GATE REQUIRED.**

**What is met:**
- Every roadmap module has a supported request through real adapters, on PostgreSQL and through the local Supabase stack.
- Both required decisions, D-12 and U2, are resolved by the owner and implemented.
- The local gates pass.

- CI on the candidate passed (PR #26, run 38668352395), and again after the merge as `4713218` (run 38670478737); see §7.

**What blocks acceptance:**
1. **The B34 repair** (external) qualifies Blueprint's verification signal.

**Separate release gates, not run and not required for development acceptance:**
- the hosted D-9 ledger (now including `0029`);
- the D-10 staging proof (no B39 staging script exists);
- the D-11 tag.

B40 is not started.
