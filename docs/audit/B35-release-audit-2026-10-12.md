# B35 release audit: Supertall Engineering & Verification

**Date:** 2026-10-12. **Audited commit:** `6f71c0255f957b7bb99cdb64c16c6c42d454421e` on `phase31/development`, the repository default branch.
**Nature:** read-only audit and planning. Nothing was implemented, deployed, tagged, migrated or reconfigured. No production state was touched.

**Release decision: C, NOT READY** to tag B35 as complete. See §8.

Legend used throughout:
- **Inspected**: read in the repository or GitHub.
- **Executed**: run in this session, with the output recorded.
- **Inferred**: a conclusion drawn from inspected material.
- **Unverified**: not reachable from this session.

---

## 1. Repository state (inspected)

| Item | Value |
|---|---|
| Remote | `https://github.com/Aryangithub13/nekoarch-backend`, private. GitHub reports `default_branch: phase31/development`. |
| `main` | `dd6e469`. One unrelated "Initial commit" (README only), with no shared history with the backend. |
| Audited HEAD | `phase31/development` at `6f71c02`: "Merge pull request #5". Working tree clean. |
| History | `a1398dc` merges PR #3 (B31–B34). `e93479b` merges PR #4 (B35, plus hardening commit `d1c11bb` carrying migration 0024). `6f71c02` merges PR #5 (schema-pin test). |
| Branch protection | **None.** Every branch reports `protected: false`. |
| Phase tags | `backend-v1-phase5-complete` … `backend-v1-phase30-complete` (→ `401a470`), plus modernization and verification tags. **B31–B35 are untagged.** |
| Package / engines | `designflow` 0.1.0, `"node": ">=22"`, npm workspaces, Vitest, Zod v3, Fastify, Supabase. |

## 2. B35 merge, review and tag status (inspected on GitHub)

| PR | Merged | Reviews | Check runs |
|---|---|---|---|
| [Aryangithub13/nekoarch-backend#4](https://github.com/Aryangithub13/nekoarch-backend/pull/4): B35 and `d1c11bb` | 2026-10-12 05:49Z, by the owner | **0** | **0** |
| [Aryangithub13/nekoarch-backend#5](https://github.com/Aryangithub13/nekoarch-backend/pull/5): database test pins | 2026-10-12 05:49Z, by the owner | 0 | **0** |

- The B35 report (`docs/phase35/phase35-report.md:160`) states **"PHASE 35 PARTIALLY COMPLETED"**. The PR #4 body asked "Please do not merge without review", and it was merged with no review.
- **No B35 tag exists.** That is correct: none should be created yet (§8).

## 3. Test evidence

### 3.1 Executed in this session

Environment: Linux container. The repository's own suites ran as the unprivileged `nobody` user, because embedded PostgreSQL refuses root. The `en_US.UTF-8` locale was registered in the container only; this is not a repository change.

| Command | Node / npm | Exit | Result |
|---|---|---|---|
| `npm ci` | 22.22.0 / 10.9.4 | 0 | 284 packages |
| `npm run build` | 22.22.0 | 0 | |
| `npm run typecheck` | 22.22.0 | 0 | |
| `npm run lint` | 22.22.0 | 0 | |
| `npm audit --omit=dev` | 22.22.0 | 0 | 0 vulnerabilities |
| `npx vitest run` (full suite) | **22.22.0** | **1** | **Files 10 failed, 78 passed (88). Tests 55 failed, 2,689 passed (2,744).** |
| `vitest run` on the 10 failing files | **22.23.2** | 0 | 10/10 files, **109/109 tests** |
| `node node_modules/vitest/vitest.mjs run` (full suite) | **22.23.2** | **0** | **Files 88/88. Tests 2,744/2,744 passed.** |

### 3.2 Discrepancy with the reported audit

The reported audit (2,744 passing in 88 files on Node 22.23.2 and 26.10.0) is **independently reproduced for 22.23.2**: 88/88 files, 2,744/2,744 tests, exit 0, on merged HEAD `6f71c02`. It is **not reproduced on 22.22.0**, a version the `engines` field (`>=22`) admits. Node 26.10.0 was not run in this session.

All 55 failures belong to one cause, the source-mode worker-thread defect already recorded in `docs/phase35/phase35-report.md` §E.3:
- **Failing suites:** revision, references (unit and integration), modernization, account, jobs, optimization (pool and integration) and scene (pool and integration).
- **Error codes:** `SCENE/REVISION/OPTIMIZATION/REFERENCE_WORKER_FAILED` and `*PoolError`.
- **Root cause, reproduced directly:** `ownWorker()` (`apps/api/src/lib/worker-pool.ts:24-27`) starts source-mode workers with `execArgv: ['--import','tsx']`. On Node 22.22.0 with tsx 4.23.13, the `.js→.ts` resolution is not applied inside `worker_threads`. The first import fails with `ERR_MODULE_NOT_FOUND …/optimization/contracts.js`.
- **Production is not affected.** Compiled workers use `execArgv: []`. `apps/api/dist/optimization/worker.js` loaded without error on 22.22.0.
- **Classification:** a test-harness and toolchain compatibility defect. It is not a product correctness defect.
- **Why the previous count was 57:** the 2 stale schema-count failures were fixed by PR #5, which is why 57 became 55.

### 3.3 What this evidence does not show

- **No GitHub Actions run has ever happened in this repository.** GitHub returns `total_count: 0` for both workflows and runs, although `.github/workflows/backend-ci.yml` is on the default branch. The likely cause is that Actions is disabled for this private repository or account. This is inferred and must be confirmed in Settings → Actions. No hosted CI result exists for any phase on GitHub.
- `npm run test:supabase` (the local Supabase stack acceptance suite) was **not run**: the Docker daemon is not running in this container. The live suite (`apps/api/tests/supabase.live.test.ts`) contains **no B31–B35 scenarios** at all.

### 3.4 Interpretation

- **Test correctness:** the tests themselves are sound. All 2,744 pass on a compatible Node release.
- **Environment compatibility:** the suite is green only on some Node 22 patch releases. Either the `engines` floor or the source-mode worker bootstrap must be fixed (§8, gate 6).
- **Hosted-service verification:** none was performed. There is no GitHub CI and no hosted Supabase check.

## 4. B35 roadmap compliance matrix

**Source limitation.** The authoritative 46-phase roadmap file is **not in any branch or commit**. This includes `NekoArch_Backend_Roadmap_46_Phases_F32_Site_Integration_Updated.md`, every phase-35 research file (`…Research_Enhanced_v2…`, `…Cost_Data_v2…json`, `…Indicative_City_Rates_v2.csv`) and the filesystem of this container. All of them were searched for. They are presumably in the owner's Downloads folder or ChatGPT Library, which this session cannot reach. The B35 implementation session did not read them either (`phase35-report.md` §G).

The requirement list below therefore comes from the task brief. The only in-repository roadmap evidence is:
- `docs/phase34/phase34-design.md:84`: *"High-rise specific checks (wind, drift, egress) → B35"*.
- `docs/modernization/modernization-report.md:225`: *"Large/complex models, supertall, > 2 storeys in the scene → B34/B35"*.
- `docs/phase30/phase30-report.md:163`: *"Complex/large/high-rise building verification and supertall → 34–35"*.

| # | Requirement | Status | Evidence | Mandatory? |
|---|---|---|---|---|
| 1 | Large-site and multistorey **model partitioning** | **ABSENT** | No partition, zone or segment concept exists anywhere in `apps/api/src`. Building Model V2 caps at 256 levels (`packages/shared/src/building-v2/model-shape.ts:16`). Every BIM-derived service refuses models with more than 2 levels (`apps/api/src/bim/core.ts:33`), including structural, systems/egress, scene, takeoff-by-BIM and revision appearance. B34 did not lift this either. | Yes, per the brief. In-repository evidence assigns ">2 storeys / large models" to B34/B35, and nothing defers it. |
| 2 | Engineering-aware wind, drift, seismic, vertical transport and egress, with specialist boundaries | **IMPLEMENTED as boundaries; no computation (by design)** | `apps/api/src/engineering/assess.ts:127-160`. There are 17 domains with typed blockers (`MISSING_INPUT`, `SOURCE_NOT_VERIFIED`, `NO_VALIDATED_SOLVER`, `NOT_IMPLEMENTED`, `PROFESSIONAL_REVIEW`). Tested by `engineering.test.ts:87-127, 147-157`. **Gap (truthfulness):** for `FIRE_AND_LIFE_SAFETY` and `VERTICAL_TRANSPORT`, `relatedServices` point to the Phase 26 egress and elevator service with the note "Egress graph distances and elevator shaft proposals", without disclosing that the service refuses any model with more than 2 storeys (via the BIM gate), so it can never run on a tall model. | Yes. Met in substance; the small disclosure fix is in §8. |
| 3 | **Partial regeneration** of sections, exterior skins and vertical zones | **ABSENT** | B35 is read-only. Phase 30 (`docs/phase30/phase30-design.md` §2) supports only *appearance* edits to exterior walls, by façade and ≤16 `levelIds`. Geometry changes return a typed `UNSUPPORTED` refusal (`apps/api/src/revision/plan.ts:65`). Because Phase 30 depends on the scene compiler, which refuses more than 2 storeys, even appearance-only skin edits are unavailable for tall models. | Yes, per the brief. No deferral is recorded anywhere. |
| 4a | Stable **revision ancestry** | **IMPLEMENTED (pre-existing)** | `parent_revision_id` and its check (`supabase/migrations/0006_projects.sql:31,42,45`). Immutable revisions (`0006:95-98`). CAS on the base revision (`0020:268,310`). B35 binds reports to `modelHash` and `inputHash`, and is tested for determinism and no mutation (`engineering.integration.test.ts:40`). | Met. |
| 4b | **Cross-zone consistency** | **ABSENT** | There are no zones, so there is nothing to keep consistent. | Yes, per the brief. It depends on #1. |
| 5 | Hard limits and honest infeasibility disclosures for Burj-Khalifa-scale concepts | **PARTIAL** | Limits are enforced: a 64 KiB body, the evidence, component and adjustment caps, the 256-level schema and the Phase 34 operation budget. A 163-storey, 834.56 m supplied tower is assessed and every structural domain fails safely (`engineering.test.ts:87`). **Gaps:** <br>• no test covers the >256-level boundary; <br>• the generator supports ≤2 floors (`BLUEPRINT_LIMITS.maxFloors: 2`), but the assessment and `GET /api/capabilities` never say that such a concept cannot be generated, partitioned, regenerated or BIM-analysed; <br>• the discovery `unsupported[]` list has no supertall, partition or zone rows. | Yes. It needs a disclosure-only fix (§8). |
| 6 | Evidence classification: conceptual, assumption-based or professionally reviewed | **IMPLEMENTED within honest scope** | Seven assurance levels (`phase35-design.md` §2). `context.provenance: USER_DECLARED_NOT_VERIFIED`. Sources are `NOT_VERIFIED / IDENTIFICATION_ONLY` with no edition. Cost carries `evidenceClass` and `NOT_VERIFIED_BY_BACKEND`. Evidence carries `contentInterpreted: false`. There is no way to *record* a professional review; that is legitimately B38 (evidence packages), as the Phase 34 design already assigns. | Met. |
| 7 | No claims of certification, compliance or approval | **IMPLEMENTED and tested** | Five `claims` are all `NOT_CLAIMED`. Cost `claims` are all `NOT_CLAIMED`. No height category is assigned. Asserted in `engineering.test.ts:87`. | Met. |
| — | Research-specified items (V2 research, CPWD `0.973` factor, research thresholds) | **NOT IMPLEMENTED; source unavailable** | `phase35-report.md` §G | Cannot be judged without the files. |

**Deferral analysis.**
- **No in-repository document permits deferring #1, #3 or #4b.** The only B35 deferrals recorded (`phase35-design.md` §12) are validated solvers (B36), the dependency graph (B37), evidence packages (B38), knowledge packs, official rate books, AI and frontend. None covers partitioning or partial regeneration.
- **Deferral would require the owner to amend the roadmap.** An auditor cannot grant it. If the owner chooses that route, the natural destinations are as follows (inferred from the dependency chain, not from the roadmap):
  - partition and zone *analysis* belongs in a B35.1 follow-up, because it depends only on B34/B35;
  - zone *geometry regeneration* depends on a multi-storey generator and BIM profile that no phase delivers yet; the roadmap must name an owner phase, plausibly with the B39/B43 generative work;
  - cross-zone freshness propagation belongs to B37.

## 5. Supabase and migration status

| State | 0024 `constant_time_download_token` | 0018–0023 |
|---|---|---|
| File exists in repository | **Yes** (inspected) | Yes |
| Replays locally from empty (embedded PostgreSQL 18, migrations 0001–0024) | **Yes** (executed: the `database.test.ts` 17/17 run is part of the full suite, and the deletion probe replayed all 24) | Yes |
| Replays on the local Supabase stack | **Not run** (no Docker daemon) | Last done for 0001–0020 (`docs/phase30/phase30-supabase-verification.md`) |
| Recorded as applied in hosted DB | **Unverified.** Very likely **not applied**. | The B31, B32 and B33 reports state that 0018–0021, 0018–0022 and 0018–0023 respectively are **not applied** to the hosted project. |
| Hosted schema and runtime verified | **No** | No |

**Hosted state.** The last documented hosted level is **0017**. The hosted database therefore probably lags by seven migrations (0018–0024). This is a **deployment gate**, separate from a code-release tag. Note also that 0024 replaces `public.reference_download`, a function that only exists after 0021.

**Read-only verification steps for an authorized operator.** Use a least-privilege read role, never paste keys into chat, and do not run `db push`, `db reset` or `migration repair`.
1. `npx supabase link --project-ref <ref>` from a clean checkout of `6f71c02`. This prompts for the database password locally.
2. `npx supabase migration list --linked`. Compare the Remote column against the local list 0001–0024. This is read-only.
3. Alternatively, run in the SQL editor: `select version, name from supabase_migrations.schema_migrations order by version;`
4. Schema spot checks (read-only):
   - `select to_regclass('public.project_references'), to_regclass('public.project_jobs'), to_regclass('public.project_briefs');`
   - `select md5(prosrc) from pg_proc where proname = 'reference_download';` Compare the result with the same query on a local replay of 0024.
5. Only after explicit approval: apply 0018→0024 **in order** to a staging project first, then run `npm run test:supabase` against a disposable local stack. Production follows afterwards.

**Review note.** The 0024 header says the other envelope-signature checks (0006–0023) still use plain comparison. These should be reviewed for the same timing issue. Their exploitability over a network is low but has not been assessed.

## 6. Deletion-trigger finding

**Classification: a documented intentional constraint (retention), with two latent defects.**

**What the schema says.**
- `project_references.project_id … on delete cascade` (`0021:6`), together with `reference_guard`: `BEFORE UPDATE OR DELETE`, which raises `23514 'References are retained as tombstones'` (`0021:68-84`).
- The same pattern has existed **since migration 0007**: takeoffs, construction, cost, workflows, structural, environmental, systems, knowledge, optimization, scene, revision operations, jobs (`job_guard`: "Jobs are retained") and briefs.

**Executed probe.** A fresh embedded PostgreSQL with 0001–0024 applied, and a superuser `DELETE FROM public.projects`:

| Project contents | Result |
|---|---|
| Nothing | Deleted |
| ACTIVE reference | **Refused** `23514` "References are retained as tombstones" |
| DELETED (tombstoned) reference | **Refused** (the trigger rejects every row DELETE, including tombstones) |
| Durable job | **Refused** `23514` "Jobs are retained" |
| Brief | **Refused** `23514` "Architectural history is immutable" |
| `DELETE FROM auth.users` for the owner | Succeeds. `profiles` cascades and `projects.owner_id` becomes NULL, leaving the project orphaned and retained. |

**Intent is documented.**
- `docs/phase12-design.md:6`: *"Deletion is not exposed; account deletion leaves inaccessible history."*
- `docs/PHASE12.md:199` says the same.
- `docs/phase24/phase24-report.md:97`: test cleanup must protect immutable history.
- `authenticated` has only `SELECT` on `projects`. No API route deletes a project; archive is the user path.

**Is project deletion possible today?** Only for projects with no retained children, and only by a privileged role. Cascades from projects holding history fail by design. **There is no current user-facing defect.**

**Latent defects:**
1. **Misleading `ON DELETE CASCADE` declarations.** For guarded tables the cascade can never succeed. A future admin, erasure or GDPR purge path would fail at runtime. Recommendation: no migration now. When an erasure policy is decided, implement it as a dedicated signed `SECURITY DEFINER` purge function that sets a transaction-local bypass (for example `set_config('project_private.purge', <job-id>, true)`) checked by every guard. Add regression tests for cascade-refused and purge-succeeds cases.
2. **The live Supabase test cleanup (`apps/api/tests/supabase.live.test.ts:150-170`) protects history only through Phase 30.** If B31–B33 live scenarios are added, its single batch `DELETE … IN (…)` will fail on projects holding references, jobs or briefs. Smallest fix: add the three tables to the `protectedIds` collection, in the same style as the existing entries.
3. *(Related, already noted in PR #5.)* `user_settings.user_id` has no FK to `auth.users`, so settings rows survive account deletion. This is a B33 retention decision.

**Action needed:** an owner decision on the erasure policy. No change to the triggers.

## 7. CI and independent review

### 7.1 CI gaps (inspected `.github/workflows/backend-ci.yml`)

| Gap | Detail |
|---|---|
| **CI has never executed** | 0 workflows registered and 0 runs on GitHub. Enabling Actions is an owner setting. |
| Push trigger misses the default branch | `push: branches: [main, master, 'codex/**']`. Pushes and merges to `phase31/development` are not built. `pull_request` would cover PRs once Actions runs. |
| Single Node version | `node-version: '22'` resolves to the latest 22.x, which would currently pass. 22.22.0, which `engines` allows, fails. There is no 24 or 26 job. |
| Phase suites not in CI | `test:references`, `test:jobs`, `test:account`, `test:verification`, `test:engineering` and `test:revision` are not separate steps. `test:unit` and `test:integration` include `engineering.*` and `revision`, `reference-download-token` and `database.test.ts`, but **not** `references.*`, `jobs.*`, `account.*` or `verification.*`. Plain `vitest run` (which runs everything) is not a CI step. |
| Embedded PostgreSQL on runners | The `ubuntu-latest` runner runs as the non-root `runner` user with `en_US.UTF-8`. This should work, but it has never been observed. |
| Supabase acceptance | Runs only on `workflow_dispatch`. It is not a required check. |
| Security | No `npm audit`, CodeQL or secret-scanning step. |
| Gates | No required status checks, because no branch is protected. |

**Proposed minimal change (not applied).** Keep the existing job. Make these changes:
- add `phase31/development` to `push.branches`;
- add `strategy.matrix.node: ['22.22.0', '22.x', '24.x']` (add 26 once LTS);
- replace the `test:unit` and `test:integration` steps with `npx vitest run`, which already builds via `npm test`, so that every suite runs;
- add `npm audit --omit=dev --audit-level=high`.

Required checks and branch protection on `phase31/development` are owner decisions.

### 7.2 Independent-review checklist for B35

This audit is **not** an independent review: it was produced by the same agent family that wrote B35. A human reviewer, or a different reviewer with no authorship stake, should sign off each item.

**Authorization and tenancy**
- [ ] Both routes call `requestContext(…, true)`. Anonymous requests get 401; a foreign or unknown project or revision gets 404 (`engineering.integration.test.ts:96`).
- [ ] An evidence `referenceId` belonging to another tenant gives the same 422 as a random id, so existence is not leaked (`engineering-service.ts:15-26`).
- [ ] The `structuralStatus`, `systemsStatus` and `knowledgeStatus` reads are RLS-scoped.

**Validation and resource bounds**
- [ ] `.strict()` schemas. 64 KiB `bodyLimit`. Caps on evidence (16), components (64), adjustments (16) and excluded scopes (16).
- [ ] The decimal regex has no catastrophic backtracking, and percentages are ≤100.
- [ ] Output array maxima are derived from the input caps; the warnings bound is 368.
- [ ] Worst-case CPU at 256 levels × 256 hull vertices is measured, not just at 163 levels.

**Provenance and unsupported claims**
- [ ] No numeric load, drift, seismic, soil or member value appears anywhere in the code paths.
- [ ] Sources have no edition. No foreign source is borrowed for a non-IN jurisdiction.
- [ ] Cost: a complete total requires a stated jurisdiction and date on every rate and adjustment.
- [ ] The `relatedServices` notes do not imply capability on tall models (gap in §4 #2).

**Revision integrity**
- [ ] Derived on read; there are no writes.
- [ ] `inputHash` covers every input that affects output, including the brief version and the related-service counts.
- [ ] The model-hash identity check is in place (the Phase 34 loader).

**API compatibility and capability truth**
- [ ] The catalog went from 123 to 125 routes and OpenAPI was regenerated.
- [ ] The only change to existing code is the export of `readRevisionModel`, a rename with unchanged behaviour.
- [ ] Discovery should list supertall, partition and zone-regeneration as unsupported (gap in §4 #5).

**Migration and deployment**
- [ ] B35 adds no migration.
- [ ] 0024 (shipped in the same PR) is reviewed separately, and its exact `reference_download` replacement is diffed against 0021.
- [ ] The hosted ledger gap (0018–0024) is confirmed.

**Regression coverage**
- [ ] 20 unit tests and 3 integration tests pass. 5/5 hand mutants are killed.
- [ ] Missing tests: the >256-level refusal; a non-IN jurisdiction with every input supplied; a GET with a query string giving 400; a `scope` containing duplicates.

## 8. Release decision

### **C. NOT READY** to tag B35 as complete

**Unmet mandatory acceptance criteria** (from the brief, with no recorded deferral):
1. Model partitioning for large and multistorey sites (§4 #1).
2. Partial regeneration of sections, exterior skins and vertical zones (§4 #3).
3. Cross-zone consistency (§4 #4b).

**Additional repository release gates not met:**
4. No hosted CI has ever executed (§7.1).
5. No independent review (PR #4 has 0 reviews).
6. The full suite fails on Node 22.22.0, which `engines` permits (§3.2).

**Not blockers for a code tag.** These are tracked separately:
- hosted migration application (a deployment gate, §5);
- frontend integration (deferred as directed; not started, not complete);
- research-file absence (an input dependency, to be supplied).

**Smallest safe paths forward.** Each is a separate, narrowly scoped task; none involves a refactor.

| Item | Minimum fix | Verification |
|---|---|---|
| **B35.1-a** disclosures (gaps #2 and #5) | <ul><li>Add `limitations`/`blockers` text stating that BIM-derived services (egress, lifts, structural, scene and revision appearance) refuse models with more than 2 storeys, and that generation is limited to ≤2 floors.</li><li>Add discovery `unsupported[]` rows `SUPERTALL_MODEL_PARTITIONING`, `ZONE_REGENERATION` and `SUPERTALL_GENERATION`.</li><li>Add a test proving a 257-level model is refused by schema with a typed error.</li></ul> | Unit tests, the modernization catalog test, the OpenAPI drift test |
| **B35.1-b** partitioning and cross-zone consistency (#1, #4b) | <ul><li>Add a derived-on-read `zones` section to the assessment, with no migration.</li><li>The caller declares vertical zones as contiguous storey ranges, or the default is one zone.</li><li>Stable `zoneId` = hash of the ordered level ids.</li><li>Exact per-zone height, GFA and volume, reusing `engineering/geometry.ts`.</li><li>Per-zone, per-façade exterior-skin wall sets, reusing Phase 30 façade resolution.</li><li>Consistency checks: zones are contiguous, non-overlapping and complete; interface elevations match; stair, shaft and void footprints are continuous across each boundary (exact, integer).</li></ul> | Unit tests on the 163-storey fixture; integration test over HTTP; determinism hash test |
| **B35.1-c** partial regeneration (#3) | <ul><li>**Requires an owner decision.**</li><li>The honest minimum is a zone-scoped Phase 30 *preflight*: target a zone or skin, report its dependency impact and preservation locks on the other zones, and return a typed `UNSUPPORTED` refusal for geometry execution, because no multi-storey generator exists.</li><li>Real geometry regeneration of tall zones depends on a generator and BIM profile beyond 2 storeys that no phase delivers. The owner must either assign it to a named later phase in the roadmap, or fund it as B35 scope.</li></ul> | Preflight tests showing refusal reasons and lock coverage |
| Gate 6: test toolchain | Use the existing `test-support/tsx-worker.mjs` bootstrap in `ownWorker()` for source mode only, or raise `engines` to `>=22.23`. | Full `vitest run` green on 22.22.0 and 22.23.2 |
| Gate 4: CI | The owner enables Actions. Apply the §7.1 workflow changes. | One green run on `phase31/development` |
| Gate 5: review | Independent reviewer completes the §7.2 checklist | Recorded review on the follow-up PR |

**If the owner formally amends the roadmap** to move #1, #3 and #4b out of B35, the decision becomes **B (ready after specific fixes)**. Gates 4–6 and B35.1-a would then remain.

**Tag.**
- The repository convention is `backend-v1-phaseNN-complete`, and the recommended name is **`backend-v1-phase35-complete`**. Apply it only to the commit that closes the above, after green CI and review. **No tag was created.**
- B31–B34 are also untagged. Their reports say "IMPLEMENTED; VERIFIED WITHIN SUPPORTED SCOPE … WITH EXCEPTIONS". Tagging them is a separate owner decision.

## 9. B36 summary

See the separate handoff `B36-implementation-handoff-2026-10-12.md`. Its key dependency facts:
- B32 explicitly defers to B36 two items: the **background sweeper, which needs a non-user execution identity**, and **external compute workers and remote queues** (`docs/phase32/phase32-design.md:131,133`).
- The API **deliberately holds no service-role key** (`.env.example`, phase32 §5–6).
- B35 `REQUIRES_SOLVER` blockers are the future consumers of B36. B36 provides plumbing only and must not lift them.

## 10. Next actions, in priority order

1. **Owner:** supply the 46-phase roadmap and the three V2 research files to the repository, for example `docs/roadmap/` and `docs/research/phase35/`, or state that they stay external.
2. **Owner:** decide the B35 scope for partitioning, partial regeneration and cross-zone consistency: deliver them in B35.1, or amend the roadmap with named destination phases.
3. **Owner:** enable GitHub Actions. Then apply the §7.1 workflow changes through a PR.
4. **B35.1-a** disclosure fix and **toolchain fix**: small, and can run in parallel.
5. **B35.1-b**, and **B35.1-c** if kept in B35.
6. **Independent review** of B35 plus the B35.1 work against §7.2.
7. **Operator:** read-only hosted migration check (§5). Then apply 0018–0024 to staging, then production, only on explicit approval.
8. **Tag** `backend-v1-phase35-complete` only after steps 3–6 are green.
9. **B36**: begin only after the five decisions in the handoff are answered.
10. **Owner:** decide the erasure and retention policy (§6). Add B31–B33 tables to the live-suite cleanup when B31–B33 live scenarios are added.

---

### Appendix A: deletion probe

The probe was run from a throwaway copy, outside the repository. It used `test-support/postgres.ts`, replayed 0001–0024 and inserted minimal valid rows. For each case it then executed `delete from public.projects where id = $1` as the embedded superuser. The script is at `evidence/deletion-probe.ts.txt` (it imports `../test-support/postgres.js`, so run it from a `phase31/development` checkout). It changed nothing outside a disposable database.

### Appendix B: environment notes

- Embedded PostgreSQL needs a non-root user and the `en_US.UTF-8` locale.
- Node 22.23.2 was obtained from the npm `node@22.23.2` package for comparison runs.
- The test copy was deleted after the audit.
