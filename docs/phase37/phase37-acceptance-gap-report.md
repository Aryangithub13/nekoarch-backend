# Phase 37 (B37) Acceptance Verification and Gap Report: PR #17 at `4a57aa5`

**Status:** record for the owner's B37 acceptance decision. Written 2026-10-14. **No merge, no tag, no hosted access, no B39 work.**

**Subject:** PR #17, branch `phase37/manifest-v2`, head `4a57aa5`.
- Base: `phase31/development` at `d0cd38b`.
- Commits: `8af71d0`, `913b584`, `aa20a0e`, `32af8a1`, `2455652`, `4a57aa5`.

**Sources:**
- **ROADMAP:** `NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md`, sha256 `0ebc4479…3a03` (re-verified), cited as ROADMAP Lnnn. B37 is L245–262.
- **Readiness:** the readiness checklist `docs/roadmap/next-phase-readiness.md` (PR #18, `8dd7880`): §4.2 M1–M9 and §9.4 release gates.
- **Risk register:** `docs/roadmap/post-audit-risk-register.md` (PR #18): R03, R04, R28.
- **Scope:** [phase37-completion-scope.md](phase37-completion-scope.md): M1–M12.

**Labels:**
- **CONFIRMED:** observed in this session, with a command or test cited.
- **ROADMAP:** roadmap text.
- **PROPOSED:** a recommendation.
- **NOT RUN:** a gate that was not executed.

---

## 0. Summary

| Area | Result |
|---|---|
| Code criteria M1–M8, M10–M12 | Implemented and tested. **Two defects** found (§5.1): one overstates M4 for Phase 30 edits, and one is a semantic error in `freshnessImpact` |
| M9 (phase tag, staging proof) | **NOT RUN.** Needs owner authorization |
| CI on `4a57aa5` | Green: run 38501638871 |
| Local Supabase acceptance, `0026`–`0028` | **PASSED locally on `4a57aa5`:** 121/121, receipt committed. Deviations are recorded in §6. The suite has no JWT cases for `0027`/`0028` (§5.2) |
| Hosted migration-history check | **NOT RUN.** No authorization on record and no credentials in this session. Authorization requested (§7) |
| Staging proof | **NOT RUN.** No staging environment on record. The required evidence and a non-destructive plan are in §8 |
| Recommendation | **Do not accept as-is.** Run a small closure slice (no migration) for the two defects, scenario 17 "failed" outputs and the missing tests. Then accept B37, with a recorded waiver deferring L259 detail-level paging (§9) |

## 1. State verified before any change

| Check | Command or source | Outcome |
|---|---|---|
| Branch and tree | `git fetch origin phase37/manifest-v2`; `git rev-parse HEAD origin/phase37/manifest-v2`; `git status --short` | Both `4a57aa5`; tree clean |
| PR | GitHub API | #17 open, **draft**, base `phase31/development`, mergeable, unmerged, untagged |
| CI on the head | Run 38501638871 (`pull_request`) | `backend (node 22.22.0)` and `backend (node 22.23.3)`: 107 files and 3,055 tests passed each (job logs). `container smoke`: success. `supabase-acceptance`: skipped (it runs only on `workflow_dispatch`) |
| Tests since `d0cd38b` are additive only | `git diff --stat d0cd38b 4a57aa5 -- apps/api/tests packages supabase test-support` | 666 insertions, **0 deletions**: no existing assertion changed or removed |
| Source scope since `d0cd38b` | `git diff --stat d0cd38b 4a57aa5 -- apps packages supabase scripts .github` | Manifest contract, builder and service; `bounded-reads.ts`; the graph service (`Promise.all` → `pooled()`); one discovery row; one Sentry route entry; the route. No migration, workflow, Dockerfile or dependency change |

## 2. Criteria reconciliation (code and tests)

Test files:
- `pm.test` = `apps/api/tests/project-manifest.test.ts`
- `pm.int` = `apps/api/tests/project-manifest.integration.test.ts`
- `dg.int` = `apps/api/tests/dependency-graph.integration.test.ts`
- `br.test` = `apps/api/tests/bounded-reads.test.ts`

| ID | Criterion (basis) | Implementation | Tests | Verdict |
|---|---|---|---|---|
| M1 | Manifest fields (ROADMAP L257) | `contracts/project-manifest.ts` `ProjectManifestSchema`; `graph/project-manifest.ts` | `pm.test:39`, `pm.int:53` | **Met** |
| M2 | Six-state vocabulary, reasons, source/target revision (L251). `UNVERIFIED` → `blocked`; `verified`/`not_applicable` never assigned | `GRAPH_STATE_MAPPING`, `FRESHNESS_ASSIGNMENT` | `pm.test:55`, `:77`; `pm.int:140` | **Met** |
| M3 | No mixed revisions (L258, scenario 17 L747) | Pointer check after the concept listing; the operation listing completes first | `pm.int:204`, `:228` | **Met**. The check depends on design-concept persistence, which the Supabase adapter always provides (`lib/supabase.ts:108`) |
| M4 | Gate (L262): dependent outputs identified; no lost model ↔ 3D linkage. Readiness specifies a **B30 exterior-appearance fixture** | Freshness and `freshnessImpact` | `pm.int:77`, `:99` (a **supplied** edit only) | **Partly met.** Dependent outputs: yes (also confirmed ad hoc for a B30 edit, §3). Linkage: **not met after a B30 edit** (defect D2, §5.1) |
| M5 | Additive (A4 L51) | One discovery row; no existing response changed | Existing suites unchanged (0 test deletions) | **Met** |
| M6 | ≤ 8 reads in flight, plus a time budget (R14) | `pooled()` in `lib/bounded-reads.ts`; graph pools; manifest side reads ≤ 7 | `br.test:16–63`, `dg.int:195`, `:257` | **Met for concurrency.** The time budget covers the graph only; the manifest's side reads have none (U5) |
| M7 | Engineering flags and claims unchanged (A4 L50) | The manifest carries no assessment values; `claims` are `NOT_CLAIMED` | `pm.test:39`; `pm.int:77` | **Met** |
| M8 | Build, typecheck, lint, both Node versions, container smoke, `npm audit`, catalog/OpenAPI drift (§K L788) | — | CI run 38501638871 | **Met** |
| M9 | Phase tag and staging proof (§K L788) | — | — | **NOT RUN** (§8, D-11) |
| M10 | `lineage`, `diff`, per-discipline impact (L253, L260, L262) | `buildLineage`, `buildDiff`, `buildChangeImpact`, `freshnessImpact` | `pm.test:180–279`; `pm.int:99`, `:140` | **Met**, apart from defect D1 |
| M11 | Candidates (L258) | `candidates`; `recentOperations` | `pm.test:103`; `pm.int:162`, `:228` | **Met** |
| M12 | Partial view and paged-view index (L259) | `manifestView`; `VIEWS` | `pm.test:123`; `pm.int:187` | **Met for what it claims**: an index of existing *list* views. L259 detail-level paging is not covered (§4) |

**B37 deliverables outside M1–M12 (ROADMAP L249–260):**

| Deliverable | Coverage |
|---|---|
| L250 dependency graph with structural/MEP edges | Pre-existing `dependency-graph-v1` (Phase 37) |
| L252 typed material/façade variations | Pre-existing Phase 30 operations |
| L258 "façade cladding alone differs from changing curtain-wall glazing area" | **Partial** (U2) |
| L260 `source`, `units`, CRS, `completeness`, `last_verified`, `missing_reason` | Present |
| L260 `confidence/assumptions` ("when applicable") | **Absent** (U4) |
| Scenario 17 (L747) "generated, unavailable, **failed** or stale" | `failed` is **not reported** (U3) |

## 3. Ad hoc confirmations (run in this session; scratch files not committed)

**1. B30 fixture on embedded PostgreSQL** (`4a57aa5`, Node 22.22.0). Steps on revision A:
- generate A;
- create a takeoff, a construction calculation, a cost estimate and a scene;
- Phase 30 preflight, execute and approve the façade edit, producing revision B.

| Revision | Result |
|---|---|
| A | Every stored and derived output is `stale` targeting B. Direct outputs: `SOURCE_REVISION_SUPERSEDED`. Construction and cost: `UPSTREAM_STALE` |
| B | Lineage `LINKED`, operation `RECORDED`, `APPEARANCE_MODIFY`, `modelEquivalentToParent: true`. Diff `COMPUTED` with 0 changes. `changeImpact` is `NOT_AFFECTED`/`MODEL_UNCHANGED` in every discipline. `SCENE_3D` is `NOT_GENERATED`. **No link to `…/revisions/B/appearance`**, which reports `APPEARANCE_VARIANT`. `notIncluded` lists `APPEARANCE_VARIANT`. A's `freshnessImpact.regenerate` includes `BUILDING_MODEL` and `ACCEPTANCE_QA` |

**2. Manifest workflow on local Supabase:** real anonymous-user JWTs through GoTrue, PostgREST and RLS; stack from §6. In order:

| Step | Result |
|---|---|
| Manifest of A | `CURRENT`; the takeoff is linked and `current`; candidates `AVAILABLE` with 0 items; lineage `ROOT`/`NONE` |
| Phase 30 preflight | One candidate, `AWAITING_CONSENT`/`NOT_ACCEPTED`; modules byte-identical to before |
| Partial view (`QUANTITIES_AND_COST`, `artifacts=omit`) | `PARTIAL`, same `manifestHash` |
| Another user | 404 |
| After approval | A is `HISTORICAL`; the takeoff is `stale`/`SOURCE_REVISION_SUPERSEDED` targeting B; B's lineage is `LINKED`/`RECORDED`; diff and `changeImpact` `COMPUTED` |

## 4. L259 views: what exists, what the manifest indexes, what is missing

ROADMAP L259 asks that site/plot, drawing/layer, quantitative/engineering, cost, 3D, room-navigation and export resources reference the same semantic model, with "stable paged/filterable and partial-data views" (frontend 31–40, 45–48, 55).

| Resource | Existing view | Indexed in manifest | Gap |
|---|---|---|---|
| Manifest itself | `?discipline=`, `?artifacts=omit` | — | None |
| BIM elements / relationships | `AFTER_ID` paging, `kind` filter | Yes | None |
| Room navigation | BIM elements with `kind=space`, plus BIM relationships | Yes (BIM) | No dedicated room-navigation (adjacency or route) view. Scene-semantic navigation overlaps B45 (L394–409) / F45 |
| Takeoffs, cost estimates, four analysis families, optimization studies, design concepts, scene artifacts | Cursor-paged **lists** | Yes (11 routes in total) | **Detail payloads are not paged or filterable:** takeoff lines, BOQ/cost lines, analysis results |
| Construction calculations | Cursor list **per takeoff** | No (no per-revision href) | No per-revision view |
| Drawings and layers (construction documents) | `documents`, `documents/plan-sheets/:levelId` (per level), `documents/schedules` | **No** | Per-level sheets not indexed; no layer filter or paging (ROADMAP R05 L501 "paged blueprint layers") |
| Building model, site/plot | BIM elements filtered by `kind` (`site`, `level`, `space`, `wall`, `opening`, …); the raw revision model is one payload | Yes (BIM) | The raw model is not paged. Site/plot has no detail view beyond the BIM `site` element |
| Acceptance QA, complex verification, engineering assessment | Whole report | No | No paged or filtered view |
| 3D | Scene artifact list and manifest | Yes (list) | Chunked or paged scene is B45 scope (L394–409, L399) |
| Export | BIM `export.json`, `export.ifc` | No | Whole-file downloads (appropriate for exports) |

## 5. Gap report

### 5.1 Implementation defects

| ID | Severity | Defect | Evidence | Fix (PROPOSED, no migration) |
|---|---|---|---|---|
| **D1** | Low (semantic) | `freshnessImpact.regenerate` lists `BUILDING_MODEL` and `ACCEPTANCE_QA` for a superseded revision. A source model and its acceptance are superseded, not regenerated, so a client following the list would try to "regenerate" the model. Introduced in `aa20a0e` | §3 item 1. No test asserts the `ARCHITECTURE` list, so a fix weakens no test | Exclude `NEW_REVISION_ONLY` modules and acceptance QA from `regenerate` (report them as superseded), and add a test |
| **D2** | Medium (gate) | **M4 is overstated for Phase 30 edits.** After a B30 appearance edit, the new revision's visible 3D object is its Phase 30 appearance variant. The manifest neither links it nor accounts for it beyond `notIncluded: APPEARANCE_VARIANT`, and `SCENE_3D` reads `NOT_GENERATED`. ROADMAP L262: "no lost linkage between model and visible 3D object". The scope doc tested M4 only with a supplied edit | §3 item 1; `pm.int:99` uses a supplied edit | Add an `APPEARANCE` entry derived from the existing `revision_operation_read('appearance')`: status, `appearanceHash`, `modelHash` check, operation id, and hrefs to `…/appearance` and `…/appearance/glb`. Remove it from `notIncluded`. Add a B30-fixture test |

**Status after this report (2026-10-14, completion pass; scope §7):**
- **D1: fixed.** `regenerate` no longer lists `BUILDING_MODEL` or `ACCEPTANCE_QA`; they are reported in a new per-discipline `superseded` list. T4 added.
- **D2: open.** Not built in the completion pass; still blocks the L262 gate for Phase 30 edits.
- **D3 (found in the completion pass): fixed.** `diff.bimDiffHref` put this revision in the BIM diff route's path and the parent as its parameter. That route compares path (before) with parameter (after), so the linked diff ran opposite to the manifest's own `diff`. It now reads parent → revision, and the M4 integration test checks the pair, direction and model hashes.
- Also added: PostgreSQL tests for `freshnessImpact.revalidate` (a tampered fingerprint) and `awaiting` (a queued job).

No other defect was found against the code's own contracts. Re-checked:
- coherence ordering;
- candidate filtering;
- view filtering;
- the full hash on a partial view;
- bounded reads;
- owner isolation (404);
- additive behaviour.

### 5.2 Missing tests

| ID | Missing test | Why it matters | Current evidence |
|---|---|---|---|
| T1 | M4 with the readiness-specified **B30 exterior-appearance fixture** and stored outputs | Readiness §4.2 names this fixture; the suite uses a supplied edit | Ad hoc only (§3 item 1) |
| T2 | Live Supabase cases for **`0027` evidence packages and `0028` design concepts**: cross-user RLS, RPC refusals and forged signatures through real JWTs | R04's stated impact ("unproven through real JWTs") remains for these two. The acceptance suite never calls them | Ad hoc, read-only: catalog checks and anonymous probes (§6) |
| T3 | Live Supabase case for the **B37 manifest route** | It exercises the Supabase adapters of four RPC families (concepts, jobs, operations, lineage) | Ad hoc only (§3 item 2) |
| T4 | A test that `freshnessImpact` never lists non-regenerable modules | Guards D1 | — |
| T5 | Appearance linkage after a B30 edit | Guards D2 | — |

### 5.3 Uncovered roadmap scope

| ID | Scope | Basis | Size |
|---|---|---|---|
| U1 | Detail-level paged/filterable views (§4): takeoff and BOQ lines, analysis results, QA and verification reports, drawing layers, room-navigation routes | ROADMAP L259; R05 L501 | **Large**, cross-cutting; overlaps B45 (L394–409) |
| U2 | Differential invalidation: "façade cladding alone differs from changing curtain-wall glazing area" | ROADMAP L258 | `changeImpact` separates model-equivalent edits from model changes at whole-model granularity only. Freshness binds to revision identity, so after a cladding-only edit `freshnessImpact` still asks for quantities and cost to be regenerated. Element-level impact was out of scope (scope §4) |
| U3 | Scenario 17 "**failed**" outputs | ROADMAP L747 | Small: the job API already lists `FAILED` jobs. Add `missingReason: GENERATION_FAILED` with a bounded page |
| U4 | `confidence/assumptions` metadata "when applicable" | ROADMAP L260 | Small; could cite each module's own assumptions where they exist |
| U5 | Time budget over the manifest's own side reads | Readiness M6 | Small; side reads are already count-bounded (≤ 7) |
| U6 | Evidence packages and zone assessment/partitions in the manifest | `notIncluded` | Small to medium |
| U7 | A manifest *for* a candidate | By design: a candidate has no revision row | None (documented) |

### 5.4 Release gates

| Gate | Status | Evidence or blocker |
|---|---|---|
| CI on the PR head (M8) | **Passed** | Run 38501638871 |
| Local Supabase acceptance, `0026`–`0028` | **Passed locally**, with the deviations in §6 | Receipt `docs/phase16-evidence/supabase-2026-10-14T03-16-31.289Z.json`. The CI `workflow_dispatch` route could not be started from this session (403); an owner-started run would give an independent receipt |
| Hosted migration-history verification (R03) | **NOT RUN** | No authorization; no credentials. Request in §7 |
| Staging proof (R28, §K L788) | **NOT RUN** | No staging environment or authorization on record. Plan in §8 |
| Phase tag | **NOT CREATED** | Owner authorization required (D-11) |

## 6. Local Supabase acceptance: procedure and run

**Approved procedure** (CONFIRMED in the repository):
- `.github/workflows/backend-ci.yml` job `supabase-acceptance`: "Explicit opt-in release gate: runs only against an ephemeral local Docker stack". It runs only on `workflow_dispatch` and uses no secrets.
  - Steps: `npx supabase start`, `npx supabase db reset --local`, `node scripts/ensure-local-postgrest.mjs`, `node scripts/test-local-supabase.mjs`, `npx supabase stop --no-backup`.
- The local equivalent is `npm run test:supabase`.
- R04 names the `workflow_dispatch` run as the safe route.
- Both scripts refuse any non-local URL or Docker context.

**Environment:** this session's own disposable cloud container.
- There was no prior stack, `.env` or saved Supabase state, so nothing existing could be affected.
- Endpoints: `API_URL http://127.0.0.1:54321`, `DB_URL postgresql://127.0.0.1:54322`.

| # | Command | Outcome |
|---|---|---|
| 1 | `POST …/actions/workflows/backend-ci.yml/dispatches` (ref `phase37/manifest-v2`) | **403** `Resource not accessible by integration`: this session's GitHub integration cannot start workflows |
| 2 | `dockerd` (in the session container) | Docker 29.8.2 |
| 3 | `docker pull public.ecr.aws/docker/library/alpine:3.20` (diagnostic) | Blob CDN `d2glxqk2uabbnd.cloudfront.net` refused by the egress policy (403 at CONNECT). Not retried or routed around |
| 4 | `npx supabase start` (CLI 2.117.0) | **Exit 0.** ECR answered "Data limit exceeded"; the CLI's own retry fell back to Docker Hub images (`supabase/postgres:17.6.1.167`, `postgrest/postgrest:v16.2`). Applied `0001`–`0028` and `seed.sql` |
| 5 | `npx supabase db reset --local` | **Not run (deviation).** The stack was freshly created at step 4, so a reset would rebuild the same state, and destructive database operations were excluded for this task |
| 6 | `node scripts/ensure-local-postgrest.mjs` | **Exit 1 (deviation)**: "Unexpected REST image; manual review required". It expects the ECR image name, not the Docker Hub name from step 4's fallback. It refused before changing anything |
| 7 | `node scripts/test-local-supabase.mjs` (HEAD `4a57aa5`, Node 22.22.0; reuses the build from the `4a57aa5` gate run) | **Exit 0: 1 file, 121/121 tests passed.** Receipt: 3,544 requests, 0 API errors, 0 responses ≥ 500. The 18 `401`s are the suite's deliberate anonymous probes, the same pattern as the 2026-10-13 receipt. No keys or tokens in the receipt |
| 8 | Read-only SQL (`begin read only; … rollback;`) | Ledger rows `0025`–`0028` present. RLS enabled on `project_revision_evidence_packages` and `project_revision_design_concepts`. Table grants: `SELECT` to `authenticated` and `service_role` only. `conversation_write`, `evidence_read/write`, `design_concept_read/write`: `SECURITY DEFINER`, executable by `authenticated`, not `anon` |
| 9 | Anonymous PostgREST probes (5: both tables, `design_concept_read`, `evidence_read`, `design_concept_write`) | All `401` / `42501` |
| 10 | Manifest workflow with real JWTs | Passed (§3 item 2) |
| 11 | `npx supabase stop` (with backup; volumes kept, no `--no-backup`); Docker daemon stopped | Stopped. Nothing remains in the repository except the receipt |

**Limits of this evidence:**
- The run was in a session container, not on a GitHub runner.
- Step 5 was skipped and step 6 refused.
- The suite covers `0026` through `conversation_write` only; `0027`/`0028` have no JWT cases (T2).

**For an independent receipt, the owner can start the workflow:**
1. Open Actions → Backend CI → Run workflow.
2. Choose branch `phase37/manifest-v2`.
3. Confirm the `supabase-acceptance` job passes.

It touches no hosted resource.

## 7. Hosted migration-history check (R03)

**Authorization:** none on record.
- Earlier instructions in this work excluded hosted access.
- Readiness §9.4 and R03 require "an authorized operator".
- This session holds no hosted credentials: no `SUPABASE_*` variables and no Supabase access token.

**Nothing hosted was contacted. Authorization is requested (D-9).**

**Proposed read-only procedure** (for an authorized operator, or for this session if it is given a read-only credential):
1. Connect with a read-only role, or with `default_transaction_read_only = on`. Never print the connection string.
2. Run, inside `begin read only; … rollback;`:
   ```sql
   select version, name from supabase_migrations.schema_migrations order by version;
   ```
   Optionally, where the CLI recorded statements:
   ```sql
   select version, md5(array_to_string(statements, E'\n')) from supabase_migrations.schema_migrations order by version;
   ```
   Compare with `supabase/migrations/0001`–`0028`. Alternatively, run `npx supabase migration list --linked`, which is also read-only.
3. Record only versions, names and match or mismatch, under `docs/phase37/evidence/`.
4. **Forbidden:**
   - `db push`, `migration repair`, `db reset` and any DDL or DML;
   - secret changes;
   - re-running a failed command against hosted.

**Expected finding (UNVERIFIED):** hosted is REPORTED at `0017`, so `0018`–`0028` would be pending. Applying them is a separate deployment decision, not part of this check.

## 8. Staging proof: required evidence and a non-destructive plan

**Required (ROADMAP §K L788):** "staging proof of at least one live user workflow". There is no staging environment or deployment evidence in the repository (R28), and **no staging proof is claimed here**.

### Prerequisites (owner decisions)

- An authorized, disposable staging project and API deployment, never production (D-10).
- Its migration ledger verified read-only, as in §7.
- The deployed commit fixed: the PR #17 merge commit, or `4a57aa5` if the owner chooses to stage before merging.

### Evidence to record

All of it goes in `docs/phase37/evidence/staging-<date>.md`, redacted: no hosts, tokens or keys.

1. **Environment record:**
   - deployed commit SHA and Node version;
   - `GET /health/ready` → `ok`;
   - `GET /api/capabilities` lists the `PROJECT_MANIFEST` service;
   - ledger versions from §7.
2. **Live workflow W-B37**, as a dedicated staging test user on a new project. Record the HTTP status, `x-request-id` and latency for each step:
   1. `POST /api/projects`
   2. `POST …/revisions/generate`
   3. Create a takeoff, then a construction calculation, a cost estimate and a scene.
   4. `GET …/manifest`: everything `current`; record `manifestHash`.
   5. `POST /api/projects/:id/revision-operations` (an appearance request), then `GET …/manifest`: one candidate, `NOT_ACCEPTED`, modules unchanged.
   6. `…/execute`, then `…/approve`.
   7. Manifest of A: outputs `stale` targeting B, plus `freshnessImpact`.
   8. Manifest of B: lineage `RECORDED`.
   9. `GET …/manifest?discipline=QUANTITIES_AND_COST&artifacts=omit`: same hash.
   10. A second test user receives 404 for the first user's manifest.
3. **Observability for the run window:** zero 5xx and no unexpected errors in logs and Sentry; rate-limit groups behave as configured.
4. **Bounded reads:** manifest latency over 20 sequential reads (median and maximum); no 422 or 409.
5. **Cleanup, non-destructive:** archive the test project (`PATCH /api/projects/:id` with `{ "status": "ARCHIVED" }`); history is kept.

### Constraints

- API calls only, as the test users.
- Read-only database queries only.
- No migrations, data deletion, secret changes or production contact.
- Stop at the first unexpected failure and report it; do not retry writes.

## 9. Recommendation

**Do not accept B37 as-is.** D2 means the roadmap's own B37 gate (L262) is not met for the edit type the platform supports, Phase 30 appearance edits. D1 and scenario 17 are small and cheap to close.

### PROPOSED B37 closure slice

Derived on read: no migration, and no change to existing fields except the D1 correction.

1. **D2:** add an appearance entry linking the visible 3D object of Phase 30 revisions; tests T1 and T5.
2. **D1:** `freshnessImpact` lists only regenerable outputs; test T4.
3. **U3:** report failed generation (`GENERATION_FAILED`) from a bounded page of `FAILED` jobs.
4. Index the existing per-level plan-sheet and schedule views.
5. **T2 and T3:** add live Supabase cases for `0027`, `0028` and the manifest route.

### Then accept B37 as development-complete, with a recorded waiver

The waiver defers U1 (detail-level paging) and U2 (element-level impact) to a named follow-up, B37b or B45, because:
- they are large and cross-cutting;
- they serve the desktop workspaces (frontend 31–40, 45–48, 55) rather than the B39 gate, which needs only "feed resulting changes to shared B37 manifest" (L297);
- B45 already owns paged scene and chunk manifests (L394–409, L399).

**Release gates stay open** until §7, §8 and the tag are authorized and run. CI passing does not close them.

**B39 does not start** until the owner records D-8.

### Decisions requested

| ID | Decision | Options |
|---|---|---|
| **D-8** | B37 acceptance path | (a) **Closure slice, then accept with a U1/U2 waiver (recommended)**; (b) accept as-is, waiving D1, D2 and U1–U6; (c) full expansion, including U1 detail paging, before B39 |
| **D-9** | Hosted migration-history check | Authorize an operator, or provide this session with a read-only credential, for §7. Or defer |
| **D-10** | Staging | Authorize a disposable staging project and deployment, and choose the commit to stage (§8) |
| **D-11** | Phase tag | Name and timing: after D-8 is accepted and §7–§8 pass |
| — | Supabase acceptance via CI | Optionally start Backend CI on `phase37/manifest-v2` by `workflow_dispatch` for an independent receipt (§6) |

## 10. Closure slice outcome (owner decision D-8(a), 2026-10-14)

The owner chose D-8(a). The closure slice is recorded in [phase37-completion-scope.md §8](phase37-completion-scope.md#8-b37-closure-slice-and-waiver-owner-decision-d-8a-2026-10-14), including the safeguards and the waiver. Commit hashes and CI runs are in the PR #17 description.

| Gap (§5) | Outcome |
|---|---|
| D1 | **Fixed** (`63b7fce`, and extended to the committed appearance in this slice). `freshnessImpact.superseded`; the model, acceptance QA and committed appearance are never under `regenerate` |
| D2 | **Fixed.** `APPEARANCE_VARIANT` module with fail-closed binding, model, appearance and artifact-link checks; M4 holds for Phase 30 edits |
| T1, T5 | **Added:** the B30 exterior-appearance fixture, plus the GLB byte check |
| T2, T3 | **Added:** the live Supabase case for `0027`, `0028` and the manifest route; local run 122/122 |
| T4 | **Added:** every stale module is in exactly one of `regenerate` / `superseded` |
| U3 (scenario 17 "failed") | **Fixed:** `GENERATION_FAILED`, `failedJobIds`, `failedGenerations` evidence window |
| §4 document views | **Indexed:** schedules, 5 CSVs, one plan sheet per storey |
| U1, U2 | **Waived and assigned:** U1 → B45 (with retrofit #10 / R05); U2 → B39 exterior specialist (scenario 34), with retrofits #24 and #04 |
| U4 | Assigned to the B39 specialist envelope |
| U5, U6 | Open as minor follow-ups; side reads are measured at ≤ 8 in flight |
| Hosted check, staging proof, phase tag | **Still outstanding:** D-9, D-10, D-11 |

### 10.1 Where Phase 39 resumes (no B39 work done here)

**Existing state, unchanged:**
- PR #16 (`d0cd38b`) is classified by readiness r3 §9.1 (PR #18) as:
  - B43 groundwork (capability-typed routing and `PROVIDER_OUTPUT_UNSAFE`);
  - B41/B43 groundwork (brief and reference consumption);
  - **advisory Interior/Exterior concepts reusable for B39**;
  - persistence `0028`.
- **B39 stays NI (not implemented).**

**Missing:**
- the shared typed specialist envelope;
- the Blueprint, Materials, Budget, Exterior, Structural and Interior modules;
- the typed statuses `unsupported` / `requires_review` / `degraded_provider` / `stale_dependency` / `partial`;
- the candidate/approval lifecycle.

**Resume point:**
1. **B39 scope document first, before code, as B37 did:**
   - the envelope contract against ROADMAP §E (L509–585);
   - module order per readiness §5.2 (Blueprint, Materials, Budget, Exterior, Structural, Interior);
   - the migration plan per readiness §5.3. `0029` is a possibility only, for the `0020` operation `kind` check or the `0022`/`0025` job-kind checks, and needs owner approval.
2. **Gate (L297):** "feed resulting changes to shared B37 manifest". That is this manifest: `changeImpact`, `freshnessImpact`, `candidates`, `failedGenerations` and the appearance link.
3. **U2 is now part of the Exterior specialist:** scenario 34 says a glazing-geometry change triggers impacted engineering preflight.

**Decisions to settle before B39 code:**
- **D-4:** module order and the interior meaning.
- **D-6:** reuse or supersede the PR #16 design-concept routes.
- **D-7:** the optional discovery clarification.
- PR #18, which carries readiness r3, is unmerged.

## 11. Owner decisions (recorded 2026-10-14)

| ID | Decision | Effect |
|---|---|---|
| **D-8** | **Accept** | B37 is accepted as **development-complete** on PR #17 (closure slice §10; scope §8, with the U1/U2 waiver). This is not a release: the gates below stay open, PR #17 stays unmerged until the owner merges it, and there is no tag |
| **D-9** | **Operator** | An authorized operator runs the read-only hosted ledger check with [`scripts/verify-hosted-migrations.mjs`](../../scripts/verify-hosted-migrations.mjs), per the [runbook](../release/b37-release-gates-runbook.md) §1. **Not run.** No hosted contact from this session |
| **D-10** | **Prepare** | Staging proof is prepared, not run: [`scripts/staging-workflow-b37.mjs`](../../scripts/staging-workflow-b37.mjs) is rehearsed locally only (runbook §2). **No staging proof is claimed** |
| **D-11** | **Wait** | No phase tag (runbook §3) |
| **D-4** | **Scope** | The B39 module order and the meaning of "interior" are settled in the B39 scope document, before any code |
| **D-6** | **Reuse** | B39 reuses the PR #16 design-concept routes as an advisory sub-output (Interior/Exterior), not as the specialists themselves |
| **D-7** | **Defer** | No discovery change now; the phase39 API guidance stays the interim |

**Release gates after these decisions:**

| Gate | Status |
|---|---|
| CI on the PR head | Passed (run 38514055560, `dcd15c5`) |
| Local Supabase acceptance | Passed: 122/122 |
| Hosted migration history | **Outstanding:** operator run pending (D-9) |
| Staging proof | **Outstanding:** prepared, not run (D-10) |
| Phase tag | **On hold** (D-11) |
