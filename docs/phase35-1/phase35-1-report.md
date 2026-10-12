# Phase 35.1 report: B35 release remediation

**Final status (superseded by §16, the Phase 35 completion round):** the owner-brief Phase 35 scope is implemented and verified, **except** validated engineering solvers (R2 beyond typed boundaries), the evidence-class mapping (R6) and the research-specified values (R8). The scope still could not be confirmed against the canonical roadmap, which remains unavailable.

**Release decision: NO-GO for merge or tag until the gates in §17.6 pass** (human review, scope of record). No tag was created. Earlier sections record the state at their time; §16 supersedes them where they differ.

**Remediation round 2 (§15)** fixes the correctness defects found after this report was first written (N1, F1, F8) and the disclosure defects (F2, F3, F4, F5, F7). F6 is an unresolved numbering gap, not a known defect. §9 and §12 below are corrected: CI does run.

Legend used throughout:
- **Inspected**: read in the repository or GitHub.
- **Executed**: run in this session, with the output recorded.
- **Inferred**: a conclusion drawn from inspected material.
- **Unverified**: not reachable from this session.

## 1. Commits

| Item | Value |
|---|---|
| Verified base | `phase31/development` = `6f71c0255f957b7bb99cdb64c16c6c42d454421e`, the audited baseline. It was unchanged at start and is the GitHub default branch. |
| Branch | `phase35-1/release-remediation` |
| `008a77f` | Register tsx inside source-mode workers (Node 22.22.0 worker fix) |
| `401000c` | Add B35.1 zone assessment, regeneration preflight and limit disclosure |
| `fcd0d3d` | Pin retained project history and guarded deletion in the replay suite |
| `0c2e41c` | Run the complete suite in CI on both bracketing Node 22 releases. **This is the verified code candidate.** |
| Documentation commit | Adds this report and its design/API siblings. It contains no code. Its hash is in the PR. |

**Other branches found at start (inspected):**
- `origin/main` = `cbe5c1e` holds the B35 audit and the first B36 handoff (`docs/audit/`).
- `origin/claude/hopeful-mclean-ec974f` = `a7e3da4` was authored by the owner's local session. It adds `docs/phase36/phase36-handoff.md` and quotes the canonical roadmap's B36 section (§13).
- Neither is merged into the base, and neither was modified.

**An unexplained scratchpad worktree** (`…/scratchpad/wt`, detached at `6f71c02`) had run the suite as root. Its PostgreSQL suites could not start (`initdb EACCES`). Its results are **UNVERIFIED and not used** as evidence.

## 2. Sources

| Source | Found? | Read? | Used? |
|---|---|---|---|
| `NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md` (canonical) | **No.** It is not in any branch or commit, and `~/Downloads` does not exist in this container (`HOME=/root`). | No | Only the secondary quotes below |
| `…Roadmap_46_Phases_F32_Site_Integration_Updated.md` | No | No | No |
| `NekoArch_Phase35_Engineering_Research_Enhanced_v2_2026-10-10.md` | No. It was not found here, and `a7e3da4` reports it as not found on the owner's machine either. | No | No |
| Phase 35 V2 cost-data JSON; indicative-city-rates CSV | No | No | No |
| B35 audit and first B36 handoff (`origin/main:docs/audit/`) | Yes | Yes | Yes |
| Roadmap-sourced B36 handoff (`origin/claude/hopeful-mclean-ec974f:docs/phase36/phase36-handoff.md`) | Yes | Yes | Yes (B36 §13; the B35 terminology note in §5, R6) |
| Phase 30–35 design, API and report docs; migrations 0001–0024; engineering, revision, scene, BIM, systems, jobs and discovery code | Yes | Yes | Yes |

**In-repository roadmap evidence for B35** (secondary quotes only):
- `docs/phase34/phase34-design.md:84`: *"High-rise specific checks (wind, drift, egress) → B35"*.
- `docs/modernization/modernization-report.md:225`: *"Large/complex models, supertall, > 2 storeys in the scene → B34/B35"*.
- `docs/phase30/phase30-report.md:163`: *"Complex/large/high-rise building verification and supertall → 34–35"*.
- `a7e3da4`: *"the roadmap's B35 wording asks for `conceptual` / `assumption_based` / `professionally_reviewed` evidence classes"*.

The B35 requirement list used below (R1–R7) is the one in the owner's B35/B35.1 briefs. **It could not be checked against the canonical text.** That is the first owner action (§14).

**Research consequences.** No research-specified formula, threshold, rate, factor (including CPWD `0.973`), standard edition or solver choice is implemented. Named standards remain `NOT_VERIFIED / IDENTIFICATION_ONLY`.

## 3. What changed

| Area | Files |
|---|---|
| Worker bootstrap | `apps/api/src/lib/worker-pool.ts` (`ownWorker`), `apps/api/src/lib/tsx-worker.mjs` (new; source mode only) |
| Limit disclosure | `apps/api/src/engineering/capability-limits.ts` (new), `apps/api/src/services/overview-service.ts` (discovery), `apps/api/src/engineering/{assess,contracts}.ts` (`relatedServices.modelSupport`, limitations) |
| Zone assessment and preflight | `apps/api/src/engineering/{zone-contracts,zones}.ts` (new), `apps/api/src/services/engineering-service.ts`, `apps/api/src/routes/engineering.ts`, `apps/api/src/services/verification-service.ts` (the loader also returns the revision number and parent; additive) |
| Registration | `apps/api/src/lib/sentry.ts` (safe routes), `test-support/openapi.ts` (mapping), `docs/modernization/{api-routes,openapi}.json` (regenerated, 125 → 128 routes) |
| Tests | `apps/api/tests/worker-bootstrap.test.ts` (3), `apps/api/tests/engineering-zones.test.ts` (30), `apps/api/tests/engineering-zones.integration.test.ts` (6), `supabase/tests/database.test.ts` (+3), `test-support/source-workers/*` (fixture), `package.json` (script lists) |
| CI | `.github/workflows/backend-ci.yml` |
| Docs | `docs/phase35-1/phase35-1-{design,api,report}.md` |

**Not changed:**
- no migration;
- no trigger;
- no existing route path, method or request schema;
- no execution limit (the 2-storey BIM profile and 2-floor generation are untouched);
- no repository setting.

## 4. Worker compatibility (executed)

**Mechanism.** On Node 22.22.0, `execArgv: ['--import','tsx']` is not applied inside `worker_threads`. Node's strip-only loader loads the `.ts` entry instead. It rejects `enum` and does not map `.js` specifiers to `.ts`, so every source-mode worker failed (`ERR_MODULE_NOT_FOUND`). Node 22.23.2 does apply the hook. Both were probed directly.

**Fix.** Source-mode workers start from `tsx-worker.mjs`, which calls `register()` inside the worker and then imports the entry. Compiled workers are unchanged.

| Run | Node 22.22.0 | Node 22.23.2 |
|---|---|---|
| 10 affected files, unmodified baseline `6f71c02` | **55 failed**, 54 passed (109), exit 1 | 109/109, exit 0 |
| New regression test, unmodified baseline | Behavioural test **fails** (`WORKER_FAILED`) | Passes |
| 10 affected files plus regression test, with the fix | 112/112, exit 0 | 112/112, exit 0 |
| Compiled `dist` workers (optimization, scene, references, revision) | Load, with `execArgv: []` and no `workerData`; the bootstrap is not in `dist` | — |

## 5. Requirement-by-requirement status

| # | Requirement (owner brief) | Status | Evidence | Decision needed |
|---|---|---|---|---|
| R1 | Large-site and multistorey **model partitioning** | **PARTIALLY IMPLEMENTED** | **Analysis partitioning implemented:** validated vertical zones over up to 256 levels, stable ids, exact per-zone quantities (`zones.ts`; 30 unit tests and 6 HTTP tests). **Processing partitioning not implemented:** BIM, scene and analyses still take or refuse the whole model; this is disclosed as `PARTITIONED_MODEL_PROCESSING: UNSUPPORTED`. | Owner: confirm whether the roadmap requires processing partitioning in B35 or a later phase |
| R2 | Engineering-aware wind, drift, seismic, vertical transport and egress with specialist boundaries | **FULLY IMPLEMENTED as boundaries** (B35) plus the B35.1 disclosure fix | B35 domains and blockers; B35.1 `relatedServices.modelSupport` from the real BIM gate (the egress and lift service shows `REFUSED` for tall models). No engineering value is computed; that needs validated solvers. | None for B35 |
| R3 | **Partial regeneration** of sections, exterior skins and vertical zones | **NOT IMPLEMENTED** | Only an honest preflight with a typed `UNSUPPORTED` refusal (zone, section and skin targets; preservation planned, not enforced; dependencies; missing capabilities). No multi-storey generator exists (generation ≤ 2 floors; the BIM profile is ≤ 2 storeys). A preflight is **not** regeneration. | **Owner:** implement a multi-storey generation path (beyond B35.1's safe scope), or approve the amendment in §5.1 |
| R4a | Stable revision ancestry | **FULLY IMPLEMENTED** | Pre-existing parent, immutability and CAS (0006/0020). Zone and preflight reports are bound to `sourceRevision`, `modelHash`, `inputHash` and `resultHash`; staleness follows the scene convention; no mutation (tested over HTTP) | None |
| R4b | Cross-zone consistency | **PARTIALLY IMPLEMENTED** | Six exact geometric interface checks for represented geometry (elevation, stair connection, stair void, stair footprint, envelope). Shaft and lift continuity is `NOT_EVALUATED`, because those elements are not represented. No engineering consistency is checked. | Owner: confirm that geometric consistency is the B35 bar |
| R5 | Hard limits and honest infeasibility disclosure for Burj-scale concepts | **FULLY IMPLEMENTED** | Discovery `modelLimits` and `unsupportedOperations`. Tests cover: 256 levels stored; 257 refused with `400 VALIDATION_ERROR` on `model.levels`, storing nothing; 3-floor generation refused with 400; a 12-storey tower refused with `BIM_UNSUPPORTED_MODEL` and `SCENE_UNSUPPORTED_MODEL`; B35 limitations | None |
| R6 | Evidence classification: conceptual, assumption-based, professionally reviewed | **PARTIALLY IMPLEMENTED (terminology mismatch)** | B35 publishes 7 assurance levels, `USER_DECLARED_NOT_VERIFIED` provenance, `CONCEPTUAL_PARAMETRIC` cost and `NOT_VERIFIED` sources. The roadmap reportedly names `conceptual` / `assumption_based` / `professionally_reviewed`. No mapping is published, and no review can be recorded (B38). The terminology was **not** changed silently. | **Owner:** approve a mapping (proposal §5.2) or confirm the existing taxonomy |
| R7 | No certification, compliance or approval claims | **FULLY IMPLEMENTED** | B35 `claims` are all `NOT_CLAIMED`; zone and preflight `claims` are all `NOT_CLAIMED` (tested) | None |
| — | Research-dependent items (V2 formulas, thresholds, rates, CPWD factor) | **NOT IMPLEMENTED: source unavailable** | §2 | Owner: supply the research |

### 5.1 Proposed roadmap amendment (requires owner approval; not applied)

| Deferred capability | Proposed destination | Dependency | Acceptance criteria |
|---|---|---|---|
| Zone, section and exterior-skin **geometry regeneration** | **Owner to name.** The roadmap is unavailable here, so no phase is guessed. Plausible owners are a multi-storey generation phase, or B39/B43 generative work if the roadmap places it there. | A multi-storey generator and a BIM/scene profile beyond 2 storeys | <ul><li>Regenerates only the target zone.</li><li>The B35.1 preflight's preserved zones are byte-identical afterwards (compared by zone id and element hashes).</li><li>A new immutable revision is created through `project_write`.</li><li>Every dependent artifact is recomputed or marked stale.</li><li>The interface checks pass at the zone boundaries.</li></ul> |
| **Partitioned processing** (BIM, scene and analyses per zone) | Owner to name (B45, chunked delivery, is a candidate per the modernization report, which is not verified against the roadmap) | The same profile extension | <ul><li>Each service accepts a zone-scoped request for models over 2 storeys, with bounded resources.</li><li>Results are tagged with `zoneId` and revision.</li></ul> |

### 5.2 Proposed evidence-class mapping (WITHDRAWN; superseded by design §2.1 and §17.3)

> **Withdrawn.** This proposal mapped assurance levels (what a question needs) to evidence classes (what a result rests on). That would label an uncomputed domain, such as `VERTICAL_TRANSPORT` at `PRELIMINARY_CALCULATION`, as `conceptual`. The implemented rule classifies only computed results; see `docs/phase35/phase35-design.md` §2.1. The table below is kept as the historical record.

| Roadmap class (as quoted) | Proposed mapping |
|---|---|
| `conceptual` | `CONCEPT_FEASIBILITY`, `GEOMETRIC_VERIFICATION` and `PRELIMINARY_CALCULATION` results computed from the model |
| `assumption_based` | Anything that depends on `USER_DECLARED_NOT_VERIFIED` context, caller-supplied rates (`CONCEPTUAL_PARAMETRIC`) or unverified sources |
| `professionally_reviewed` | **Never assigned by software.** It requires a recorded review (a B38 evidence package). |

It would be published as an additive `evidenceClass` per domain. This needs the canonical definitions first.

## 6. API and discovery compatibility

All changes are additive (see [phase35-1-api.md](phase35-1-api.md)):
- three new routes;
- discovery `modelLimits`, `unsupportedOperations` and the `ZONE_ASSESSMENT` service;
- B35 `relatedServices[].modelSupport` and `refusalCode`;
- two B35 limitation lines.

The OpenAPI diff contains only additions; the two "removed" lines are the `required` arrays being extended. The anonymous-access inventory shows all three new routes as 401.

B35 `resultHash` values change for the same revision, because the report gained fields. They were never stored.

## 7. Security, tenancy and persistence (executed tests and inspection)

**Tested over HTTP for all three new routes:**
- anonymous requests get 401; another user gets 404; an unknown revision gets 404;
- a query string on GET gets 400;
- duplicate keys get 400; a body over 32 KiB gets 400;
- invalid declarations and targets get typed 422s or 200 `INVALID_DECLARATION`;
- no revision is created and the current revision is unchanged after assessment and preflight.

**Ownership.** Ownership is established by the existing RLS-scoped revision read, plus the model-hash identity check. Currency uses the B33 context bundle, which is owner-scoped.

**Unchanged:**
- no new write path;
- no signed-envelope or fencing change;
- no service-role credential;
- no provider, paid service or solver enabled;
- no request body or model is logged (only route templates are added to Sentry's safe list).

**Retention (`ON DELETE CASCADE` against the guards).** This is a documented intentional constraint. It is now pinned by 3 replay tests:
- a project with a reference (including a tombstoned one), a job or a brief cannot be deleted (`23514`);
- an empty project can be deleted;
- account deletion leaves the project and its history ownerless.

The schema is unchanged. The latent risk for a future erasure feature stands, as does the separate `user_settings` FK question (a B33 decision).

## 8. Verification results (executed)

Candidate `0c2e41cf0bf8f64374c7fe05c1c3a3e520135be0`, Linux container.

**Build gates** (Node v22.22.0, npm 10.9.4, run as root in the checkout):

| Command | Exit | Result |
|---|---|---|
| `npm run build` | 0 | |
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm audit --omit=dev --audit-level=high` | 0 | 0 vulnerabilities |

**Full suite** (run as the unprivileged `nobody` user on an exact copy of the candidate; the copy's only untracked entries were its runtime and home directories and, for the second run, `docs/phase35-1/`):

| Command | Node / npm | Exit | Result |
|---|---|---|---|
| `node node_modules/vitest/vitest.mjs run` | **v22.22.0** / 10.9.4 | **0** | **91/91 files, 2,786/2,786 tests, 0 skipped** |
| `node node_modules/vitest/vitest.mjs run` | **v22.23.2** / npm not installed for this binary (Vitest invoked directly) | **0** | **91/91 files, 2,786/2,786 tests, 0 skipped** |

**Count reconciliation:** 2,744 (B35 baseline) + 3 (worker) + 30 (zone unit) + 6 (zone HTTP) + 3 (retention) = 2,786.

**Mutation check of the zone logic:** 8/8 hand mutants killed. The mutants were:
- a stair void never reported missing;
- a derived height treated as evidence;
- overlap undetected;
- the key folded into the identity;
- declaration order changing the hash;
- the BIM gate bypassed;
- cross-boundary stairs missed;
- a gap reported as valid.

**Not run:**
- Node 24 or 26;
- `npm run test:supabase`: no Docker daemon in this container, and the live suite still has no B31–B35 scenarios;
- hosted anything.

## 9. CI

**Correction.** This section first said that no GitHub Actions run existed and that Actions appeared to be disabled. **That was wrong.** Opening PR #7 triggered Backend CI [run 38246257012](https://github.com/Aryangithub13/nekoarch-backend/actions/runs/38246257012) on `c245253`, and it passed:
- `backend (node 22.22.0)` and `backend (node 22.23.2)` each ran `npm ci`, `npm audit --omit=dev --audit-level=high`, build, typecheck, lint and the complete `npx vitest run` (91/91 files, 2,786/2,786 tests on the 22.22.0 leg, read from the job log);
- the 22.23.2 leg also built the container and passed its smoke test;
- `supabase-acceptance` was skipped (it runs only on `workflow_dispatch`).

Commit `0c2e41c`'s message repeats the wrong claim; history is not rewritten, so this section is the correction. The CI result for the remediation-round-2 head is recorded in its pull request or hand-off, not in this file, because this file is part of that head.

Workflow changes (`0c2e41c`): the workflow builds pushes to `phase31/development`; runs the complete `npx vitest run` in place of subsets that omitted the references, jobs, account and verification suites; uses a Node matrix of `22.22.0` and `22.23.2`; adds `npm audit --omit=dev --audit-level=high` and the `en_US.UTF-8` locale; and runs the container build and smoke test once.

## 10. Independent review

**Outstanding.** This report is the implementing agent's own verification and is **not** independent review. PRs #4 and #5 were merged with 0 reviews. Checklist for a reviewer who did not write the code:

**Scope against the roadmap**
- [ ] R1–R7 match the canonical B35 text.
- [ ] The R3 amendment and R6 mapping decisions are recorded.

**Worker bootstrap**
- [ ] The source and compiled branches of `ownWorker` are correct.
- [ ] The bootstrap is absent from `dist` and the image.
- [ ] Worker lifecycle (timeout, crash, shutdown) is unchanged; the pool tests pass.

**Zone identity and geometry**
- [ ] The id depends only on the ordered storey ids.
- [ ] Storey ordering matches the B35 height rows.
- [ ] Areas sum to B35.
- [ ] No tolerance appears anywhere; every check is exact or `NOT_EVALUATED`.

**Regeneration honesty**
- [ ] The preflight cannot create rows or revisions.
- [ ] `status` is literally `UNSUPPORTED`.
- [ ] Preservation is labelled `PLANNED_NOT_ENFORCED`.
- [ ] `roadmapDestination` names no phase.

**Engineering evidence**
- [ ] No new numeric engineering value.
- [ ] B35 domain statuses are unchanged.
- [ ] `modelSupport` comes from the real gate.
- [ ] Claims are `NOT_CLAIMED`.

**Security**
- [ ] RLS-scoped reads only.
- [ ] Body and array bounds hold.
- [ ] 404 for a foreign revision or project.
- [ ] No logging of bodies.

**Migration and deploy**
- [ ] No migration.
- [ ] The retention tests pin the existing behaviour only.
- [ ] Hosted state is unverified (§11).

**Reproducibility**
- [ ] Re-run the full suite on 22.22.0 and 22.23.2 as non-root.
- [ ] Confirm the counts in §8.
- [ ] Confirm a green Actions run on the head under review.

## 11. Migrations and hosted environment

- B35.1 adds **no migration**. 0001–0024 replay cleanly on embedded PostgreSQL (executed, as part of the suite).
- **Hosted state: unverified.** The B31–B33 reports say 0018–0023 were not applied to the hosted project, so the last documented hosted level is 0017. 0024's hosted status is unverified.
- **Operator action** (read-only): run `npx supabase migration list --linked` from a clean checkout, or `select version from supabase_migrations.schema_migrations order by version;`. Then apply 0018→0024 in order to staging, then to production, only with explicit approval.
- This is a deployment gate, not a code-tag gate.

## 12. Remaining limitations and risks

These are in addition to the unmet requirements in §5:
- Generation remains at most 2 floors.
- BIM, scene and analyses remain within the 2-storey profile.
- Shafts, lifts and risers are not represented.
- No validated engineering solver exists.
- Standards are unverified; there is no official rate data.
- The canonical roadmap and the V2 research are absent from the repository.
- CI has run once on `c245253` (green); the remediation-round-2 head needs its own run.
- There has been no independent review.
- Hosted migrations are unverified.
- The frontend is not integrated (deferred, not a blocker).

## 13. B36 readiness (planning only; no B36 code or branch)

**Correction to the first handoff (`origin/main:docs/audit/B36-implementation-handoff-2026-10-12.md`).** The roadmap-sourced handoff `a7e3da4` lists B36 deliverables that the first handoff omits:
- dependency-aware fan-out/fan-in;
- checkpoints;
- content-addressed caching of `VERIFIED` results;
- fine-grained recomputation of impacted tasks only;
- reproducible environments (an environment digest);
- unit and boundary verification of solver output;
- queue isolation from scene and optimization jobs.

Where the two differ, `a7e3da4` (canonical-roadmap-sourced) should govern. The first handoff's safeguards remain compatible.

**Boundaries, confirmed against the code and both handoffs:**
- [x] B36 is compute infrastructure, not solver validation.
- [x] B35 `REQUIRES_SOLVER` and `NO_VALIDATED_SOLVER` blockers are unchanged by B35.1 and must stay until a validated result exists for that revision and input hash.
- [x] Remote execution stays disabled by default.
- [x] B32 jobs, leases, fencing, retries, cancellation, deduplication and the B33 quotas stay authoritative (hard rule 3: B36 builds on B32).
- [x] No worker gets database access or model-mutation authority.
- [x] Remote results are verified before persistence.
- [x] Cost ceilings, data-transfer consent, tenant isolation and fail-closed behaviour are required.
- [x] No vendor, price or hosting is assumed.

**Unresolved owner decisions before B36:**
1. Provider or providers, or gateway plus local adapter only.
2. Non-user execution identity (a dedicated narrow DB role, or owner-read recovery only).
3. Callbacks, or polling only.
4. Budget unit and approver (money, compute-seconds or credits; B33 settings or per-job consent).
5. Supply the V2 research and commit the canonical roadmap.

**Preconditions:**
- the B35 release decision (§14);
- Actions enabled;
- hosted migration state confirmed before any `0025`.

## 14. B35 completion and release recommendation

**Is the original B35 scope complete? No.**
- R3 (partial regeneration) is not implemented.
- R1, R4b and R6 are partial.
- The scope itself could not be confirmed against the canonical roadmap.

### Decision: BLOCKED ON OWNER DECISION OR EXTERNAL ACCESS

**Completed and verified:**
- the worker fix;
- truthful limits and refusals;
- zone assessment and interface checks;
- the honest regeneration preflight;
- retention pins;
- the CI correction;
- a full suite green on both Node 22 releases (§8).

**Required to proceed, in order:**

| # | Owner | Action |
|---|---|---|
| 1 | Owner | Commit the canonical roadmap (and the V2 research, if it exists) to the repository, or paste the exact B35 section, so the mandatory scope can be confirmed |
| 2 | Owner | Decide R3: fund a multi-storey regeneration path within B35, or approve the §5.1 amendment with a named destination phase. Decide R1 processing partitioning and the R6 evidence-class mapping (§5.2) the same way. |
| 3 | Owner | A green Actions run on the final head is required (Actions is enabled; see §9). |
| 4 | Independent reviewer | Complete §10 on this PR |
| 5 | Owner | Merge the PR (not done by this agent) |
| 6 | Authorized operator | Read-only hosted migration check (§11). This is a deployment gate. |

**Tag.** If steps 1–5 all resolve in favour of release, the proposed tag is **`backend-v1-phase35-complete`**, the existing naming convention. It would go on the merge commit of this PR into `phase31/development`.

That tag would include B35 (`e93479b`), the PR #5 schema pins, and B35.1, with any approved amendment recorded. **No tag was created.** It waits for explicit authorization.

## 15. Remediation round 2 (correctness and disclosure)

Base: `c245253`. Two code commits and one documentation commit; no migration, no new route, no B36 work.

### 15.1 Findings

The findings come from the implementing session's own review (not independent). PR #7's description lists F1–F5 and F7; that session's final report also lists F8, and numbers none as F6.

| # | Finding | Fix | Regression evidence |
|---|---|---|---|
| **N1** | B35 storey height used a declared floor-to-floor height unconditionally, while the model defines it as the distance to the next represented level of any kind. The same QA-accepted geometry gave 16 719.36 m³ (declared) or 19 103.232 m³ (undeclared). | `model-height-v2` (design §4.3): measured to the next storey floor (uppermost: lowest roof above); declared basis only where it reaches that level; never overrides geometry; `NOT_DETERMINED` when only a datum lies above the uppermost storey. Building height, volume, volume-priced cost lines and zone quantities follow. | `engineering.test.ts` "Phase 35.1 storey heights across represented levels": both arrangements pass the save-gate QA and now give 19 103.232 m³; intermediate roof; datum above the top; contradictory declaration; identical volume-priced cost lines. |
| **F1** | Stair-opening, stair-footprint and envelope checks compared rings vertex by vertex; QA compares regions by containment. An extra collinear vertex gave a false `INCONSISTENT`. | `sameRegion` (exact box and area, then `ringContains` both ways); the opening check applies `QA_STAIR_VOID_MISSING` and `QA_STAIR_SOLID_INTERFERENCE` at the upper storey. | `engineering-zones.test.ts` "remediation" block: collinear void (QA PASS → zone PASS); rotated, reversed, collinear footprint and envelope; a void 1 mm short still FAILs, as QA does; flights ending at or passing through the upper storey; region tests incl. same box and area, different shape. |
| **F2** | `INTERFACE_ELEVATION` and `STAIR_SLAB_VOID` PASS results restated QA rules without saying so. | Details now say *restates acceptance QA … not independent evidence*; others say *cross-zone observation* or *not evaluated*; a zone limitation states it. | "F2: labels which checks restate acceptance QA…" |
| **F3** | `BIM_PROFILE_MAX_STOREYS` listed all of `SELECTIVE_REVISION` with a 422 outcome. | Removed; new `SELECTIVE_REVISION_APPEARANCE_PROFILE` row: 200 preflight `UNSUPPORTED` / `SCENE_UNSUPPORTED_MODEL`; restore not gated. | "F3: …" runs the real planner: a 4-storey appearance change is `UNSUPPORTED`; a restore is `AWAITING_CONSENT`. |
| **F4** | `modelSupport: SUPPORTED` and `availableForThisModel: true` came from the first BIM gate only. | `PRELIMINARY_ELIGIBLE`; the preflight alternative carries `eligibility`. Both fields were new in this unreleased PR. | Updated capability and skin tests. |
| **F5** | Retention tests called observed behaviour "intended". | Relabelled as characterization; the conflicting design documents are cited; no behaviour change. | `database.test.ts` (unchanged assertions). |
| **F6** | **Unknown.** No description exists in PR #7, its comments, commits, documents or the implementing session's recoverable transcript; the numbering skips from F5 to F7. | None. Not claimed resolved. | Owner or the original author must confirm whether a sixth finding existed. |
| **F7** | The exterior-skin preflight did not list the target zone's interior among things to preserve. | `preservation.targetInterior` (design §5). Regeneration still refuses with `UNSUPPORTED`; preservation stays planned, not enforced. | "F7: lists everything inside the target zone…" |
| **F8** | The zone floor-height check compared with the next storey; QA compares with the next represented level. A datum between zones gave a false FAIL. | Compared with the next represented level; intermediate levels named. | "F8: a datum between zones…" (also equal zone quantities declared or not, summing to B35); "F8: still fails a declared height that misses…" |

Against the unmodified `c245253` calculation code, 9 of the new regression tests fail (F1 ×3, F8 ×2, N1 ×4); with the fixes all pass.

### 15.2 Impact on earlier results

Both reports are derived on read and nothing stores them, so no stored result becomes stale and no migration or recomputation job is needed. Only models with a datum or roof level between a storey and the level its height is measured to produce different numbers; a client holding an older response can recognise it by `engine.formulas.height: model-height-v1`. The fields renamed for F4 and added for F7 exist only on this unreleased branch.

### 15.3 What this round does not change

At this round, partial regeneration and processing partitioning were still not implemented, and the canonical roadmap and Phase 35 V2 research were still absent. **Superseded by §16**, which implements both.

## 16. Phase 35 completion round (regeneration, preservation, partitioned processing)

Base: `9bcbad8`. Commits: `3a5251f` (implementation), `fd5f3c7` (specification and inventory), `183f80e` (work bounds), `f7d5524` (local Supabase receipt), `b75f414` (independent-review fixes), and this documentation commit (which also adds the second receipt). No migration, no new table, no new dependency, no B36 work.

### 16.1 Sources (searched again; still unavailable)

None of these is in any reachable source:
- the canonical 46-phase roadmap;
- its Phase 35 definition;
- the 56-phase frontend roadmap;
- the Phase 35 V2 research, with its cost JSON and city-rates CSV.

What was searched, in [phase-1-46-reconciliation.md](phase-1-46-reconciliation.md) §6:
- all branches, tags and history;
- the filesystem and the upload mounts;
- the Claude Docs and artifact workspaces;
- the account's other repositories (`Testing-Something` could not be attached).

The Phase 35 scope used here is therefore the owner's briefs R1–R8. **It has not been checked against the roadmap.**

### 16.2 F6

A full scan of the originating session's readable transcript covered 19 pages and 1,843 events, from 06:56 to 12:53Z. No F6 appears anywhere. The first findings list (12:14:34Z) already goes F1–F5, then F7. F8 was added a minute later.

**F6 is closed as a numbering gap.** That session's encrypted reasoning cannot be read, so a dropped or merged F6 cannot be ruled out. The only unexplained content is a clause added to F1 about stair-footprint continuity, and that check was fixed and tested in `01eed24`.

### 16.3 What was implemented

Specified in [regeneration-and-partitions.md](regeneration-and-partitions.md).

| Requirement | Implementation | Not implemented |
|---|---|---|
| **R3** partial regeneration of zones, sections, skins | `TYPICAL_FLOOR` (zone or section layout from a compatible template storey) and `FENESTRATION` (exterior-skin windows by a stated rule), at `zones/regeneration` | Generator-driven regeneration (no multi-storey generator); envelope or structure geometry |
| Preservation guarantees | Enforced on every candidate: an entity-level canonical-hash comparison, where any out-of-scope change refuses it. The candidate also passes the save route's QA and body limit. It is committed through the existing supplied-revision route (QA, compare-and-swap), and `zones/regeneration/verification` proves the committed revision is exactly the regeneration of its parent. | An atomic regenerate-and-commit enforced by the database (needs a migration, §16.9) |
| **R1b** partitioned processing | `zones/partitions`: each zone runs as its own model through schema, QA, B34 verification, area and volume, quantity takeoff, and BIM where the profile admits it. Results are reconciled exactly with the whole model, with validity reported separately. | Scene, structural, environmental, systems, knowledge, cost and optimization per zone (`PARTITIONED_ARTIFACT_SERVICES: UNSUPPORTED`) |
| **R5** capability reporting | Discovery lists `ZONE_REGENERATION` and `ZONE_PARTITIONS`. `unsupportedOperations` lists what they do not cover. A `QUANTITY_TAKEOFF_MAX_ENTITIES` limit row is added. The preflight now names the deterministic alternatives. | — |

### 16.4 Requirement status (supersedes §5 for R1, R3 and R5)

| # | Status |
|---|---|
| R1a zoning | Implemented (B35.1) |
| R1b partitioned processing | **Implemented** for derived-on-read services; stored artifact services are not partitioned |
| R2 engineering-aware boundaries | Implemented as typed blockers; **no validated solver** (§16.5) |
| R3 partial regeneration | **Implemented** as deterministic operations with enforced preservation; generator-driven regeneration unsupported |
| R4a revision ancestry | Implemented; verification uses it |
| R4b cross-zone consistency | Geometric checks (B35.1, F1/F8 fixed) |
| R5 limits and disclosure | Implemented |
| R6 evidence classes | **Partial**: mapping proposed (§5.2), owner decision |
| R7 no certification claims | Implemented; every new report's `claims` is `NOT_CLAIMED` |
| R8 research-specified formulas, thresholds, rates, CPWD factor | **Blocked: source unavailable** |

### 16.5 Engineering calculations: what is validated and what is not

**Exact and independently cross-checked (deterministic):**
- `model-height-v2` storey heights;
- plates, gross floor area and gross volume, which per-zone verification of each partition reproduces exactly (partition reconciliation);
- window counts, which per-zone takeoff reproduces as laid out;
- the height-to-width indicator.

These are geometric quantities, not engineering determinations.

**Estimates:** conceptual cost arithmetic, from caller-supplied, sourced rates only. No rate is built in.

**Not calculated**, as typed blockers with no value: wind, seismic, lateral stability, drift, dynamic response, soil and foundation, member design, lift traffic, and egress for more than 2 storeys. A validated solver needs:
- verified editions of IS 875 Parts 1–3, IS 1893 Part 1, IS 16700 and NBC (named by designation only, `NOT_VERIFIED`);
- the V2 research (unavailable);
- validation benchmarks.

None is in hand. No load, coefficient, soil value, rate or CPWD factor was invented.

### 16.6 Verification results (executed)

| Check | Result |
|---|---|
| `npm run build`, `npm run typecheck`, `npx eslint .` | Exit 0 |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| Full suite, unprivileged user, Node 22.22.0, on `b75f414` | **93/93 files, 2,835/2,835 tests**, 0 skipped, exit 0 |
| Full suite, unprivileged user, Node 22.23.2, on `b75f414` | **93/93 files, 2,835/2,835 tests**, 0 skipped, exit 0 |
| New unit tests (`engineering-regeneration.test.ts`) | 31 |
| New HTTP integration tests (`engineering-regeneration.integration.test.ts`) | 4: regenerate → commit through the save route → `VERIFIED`; tampered commit → `MISMATCH`; window regeneration and partitions over HTTP; 401/404/400/422 and body limit on every new route |
| Mutation checks | 22 deliberate defects in the new safeguards; **22 caught** |
| Route catalog and OpenAPI drift | Pass. Catalog 128 → 131. The OpenAPI document gains exactly three paths; after reference resolution, all 103 existing paths and every shared component are unchanged. |
| Container smoke test (local Docker 29.8.2) | Pass on `b75f414`: non-root (uid 1000), liveness 200, readiness 503 with the dependency unavailable, SIGTERM exit 0 |
| Local Supabase acceptance (`scripts/test-local-supabase.mjs`; CLI 2.117.0; disposable local stack, migrations 0001–0024) | **120/120 tests**, exit 0, on `f7d5524` and again on `b75f414` (receipts `…15-11-02.037Z.json` and `…15-52-09.253Z.json`: 0 API errors; the 16 recorded failures are the expected 401 refusals). The stack was stopped afterwards. The `ensure-local-postgrest.mjs` repair declined ("Unexpected REST image"), because the stack ran `postgrest/postgrest:v16.2` rather than the image it pins; the suite passed without it. |
| Scale (local, 256 levels) | TYPICAL_FLOOR over 253 storeys, partitions over 64 zones, and FENESTRATION on a 256-storey tower each took about 1.5 s. Candidates beyond acceptance QA's own budget, or beyond the save body limit, are refused. |

**Not run:**
- hosted Supabase (not contacted);
- Node 24 and 26;
- frontend integration (deferred by the owner).

The container smoke test used a scratch copy of the Dockerfile that adds the sandbox proxy CA to the **build stage only**. CI builds the unmodified Dockerfile.

### 16.7 Independent review

A fresh-context review agent reviewed the implementation: it did not write the code and had no access to its reasoning. It found **no blocker**, and no path where a ready candidate changes anything outside its allowed scope. All 3 MAJOR and 5 MINOR findings and the one nit were fixed in `b75f414`, each with a test:
- MAJOR: a candidate larger than the save body limit;
- MAJOR: partitions broken by a site entrance reference;
- MAJOR: unbounded work before the schema caps;
- MINOR: a wall meeting the façade at its face;
- MINOR: two unnamed refusals;
- MINOR: status claims that said less than they suggested;
- MINOR: missing tests;
- the nit: result-hash ordering.

**This is not human approval.** A human reviewer must still complete the PR checklist.

### 16.8 Compatibility, retention, migrations, deployment

**Versions.** These are new:
- `zone-regeneration-v1`;
- `zone-regeneration-verification-v1`;
- `typical-floor-v1` and `fenestration-v1`;
- `zone-partitions-v1`.

These are unchanged:
- `model-height-v2` and the other formula ids;
- `engineering-assessment` and `zone-assessment-v1`;
- `zone-regeneration-preflight-v1`.

The preflight's schema is unchanged; its alternatives now name the deterministic operations. Report-version literals were **not** bumped for N1. The reports are derived on read and never stored, and `engine.formulas.height` distinguishes v1 from v2. Bumping them is optional, and remains an owner decision.

**API.**
- Three additive POST routes, in the `generate` rate-limit group.
- Discovery adds two services and one limit row, and changes the **unreleased** Phase 35.1 `unsupportedOperations` ids.
- No existing route changes.

**Data retention.** Nothing new is stored. A committed candidate is an ordinary immutable supplied revision, under the existing (undecided) deletion policy.

**Migrations.** None. Hosted Supabase is believed to be at 0017; 0018–0024 are unverified there. That is a deployment gate, not a code gate.

**Deployment.** No new environment variable. The save body limit is read from the existing `BODY_LIMIT_BYTES`. The image changes only in its compiled code.

### 16.9 Release decision (superseded by §17.6)

**NO-GO for merge or tag at this time.** The code is complete and verified for the owner-brief scope, but these release gates are open:

| # | Gate | Owner | Smallest decision or action |
|---|---|---|---|
| 1 | Phase 35 scope of record | Owner | Confirm R1–R8 (the briefs) as Phase 35's scope, or commit the roadmap's Phase 35 section to `docs/roadmap/` |
| 2 | Validated engineering solvers (R2) and research values (R8) | Owner | Either supply verified standard editions and the V2 research, or record that validated solvers are outside Phase 35 (B36 compute plumbing plus a named validation phase) |
| 3 | Evidence-class mapping (R6) | Owner | Approve the §5.2 mapping, or keep the seven assurance levels |
| 4 | Independent human review | Reviewer | Complete the PR #7 checklist |
| 5 | CI on the final head | Automatic | Must be green on both Node legs |
| 6 | Merge and tag `backend-v1-phase35-complete` | Owner | Only after 1–5 |
| 7 | Deployment gate (separate from the code tag) | Authorized operator | Read-only hosted migration check, then 0018 → 0024 to staging, then production |

**Optional decisions, not blocking release:**
- an atomic regenerate-and-commit (a migration adding a regeneration operation label);
- a wider BIM profile for partitions;
- the erasure policy;
- a report-version bump.

Phase 30 frontend integration verification stays **deferred**.

## 17. Release-gate round (review, scope, evidence classes, verdict)

Base: `7caf74d`. Commits: `28077fa` (R6 and disclosure fixes), and this documentation commit. No migration, no new route. History was not rewritten.

### 17.1 Independent human review

**Not yet obtained.** PR #7 has no reviews, review threads or comments.
- A Copilot review was requested; Copilot posted nothing. Automated review is not human approval in any case.
- On 2026-10-12 a review was requested from `shubham-0`, the repository's only other collaborator (write access).
- The owner (`Aryangithub13`) is the PR's author on GitHub, so GitHub will not record the owner's approval of this PR.
- The fresh-context agent review in §16.7 is automated and is not counted as human review.

**This gate stays open** until a human reviewer completes the checklist in the PR.

### 17.2 Roadmap and research

A third search found no new branch, tag, commit, upload or attachment. The canonical 46-phase roadmap, its Phase 35 section, the 56-phase frontend roadmap and the Phase 35 V2 research remain **unavailable**.

The minimum owner decision needed to fix the accepted Phase 35 scope is:
> **Accept the owner briefs R1–R8, as delivered and limited in §16–§17, as the Phase 35 scope of record.**

### 17.3 Standards and evidence-class decision

**Standards and solvers (R2, R8).** Per the owner's instruction of 2026-10-12, Phase 35 is released **without** validated structural engineering solvers or research-specified values.
- Wind, seismic, lateral stability, drift, dynamic response, soil and foundation, member design, progressive collapse, lift traffic and tall-building egress stay **explicitly unsupported**. They appear as typed blockers in the assessment, as `VALIDATED_ENGINEERING_SOLVERS: UNSUPPORTED` in discovery, and with `evidenceClass: null`.
- IS 875 Parts 1–3, IS 1893 Part 1, IS 16700 and NBC remain identification only: no edition is verified and nothing is retrieved.
- No load, coefficient, soil value, rate or CPWD factor exists in the code.
- Delivering these needs verified editions, the V2 research and validation benchmarks. No phase is named for them, because the roadmap is unavailable.

**Evidence classes (R6).** Implemented in `28077fa`.
- Each domain carries `evidenceClass`: `conceptual` or `assumption_based` for computed results, `null` otherwise.
- `professionally_reviewed` is never assigned by software.
- The seven assurance levels are kept.
- §5.2 is withdrawn (category error; see the note there).
- The definitions are in `docs/phase35/phase35-design.md` §2.1. They are the backend's own, because the canonical definitions are unavailable.

### 17.4 Review of §5.2, §16 and the related policies

| Item | Finding | Action |
|---|---|---|
| §5.2 mapping | **Defect:** it mapped required assurance levels onto evidence classes, so uncomputed domains would have been labelled `conceptual` | Withdrawn; replaced by result-based classification (§17.3), with a test |
| Seven assurance levels | Consistent: each domain states the level its question needs, and `CODE_APPLICABILITY` and above are never reached | Kept unchanged; `evidenceClass` is orthogonal to them |
| Assessment limitations | **Defect:** they said no part of a tall model can be regenerated, which is false since §16 | Corrected, with a regression test |
| Preflight texts | **Defect:** "no regeneration executes" and an ambiguous roadmap note | Corrected, with a regression test |
| §16 | No other defect found. Its claims were rechecked against code and tests: catalog 131, the three routes, 22/22 mutations, and VERIFIED excluding provenance. | §16.4's R6 row is superseded by §17.3 |
| Formula and report versions | No formula changed this round. `evidenceClass` is an additive field. `engineering-assessment-v1` is kept, as for B35.1's additive `modelSupport`, because reports are derived on read, never stored, and `engine.formulas` still identifies the arithmetic. | **Decided: no report-version bump** |
| Save versus verification provenance | A committed candidate keeps the base model's `provenance`; the save route records `source_mode: supplied`. No code reads `provenance.generatorVersion` or `seed` except parametric checks, and regeneration refuses parametric models. `VERIFIED` compares the canonical model (provenance excluded); `provenanceIdentical` reports provenance separately. | No functional defect; the disclosure stands (spec §2.1 and §6) |
| Deletion policy | Regeneration verification needs the parent revision. Revisions are immutable and cannot be deleted today, so verification stays reproducible. Any future erasure feature must keep, or tombstone with its model hash, each parent of a committed regeneration, or such revisions become `NO_PARENT`. | Recorded for the undecided erasure policy; not a Phase 35 blocker |
| Migrations | Phase 35 adds none. Deploying this backend still needs hosted migrations 0018–0024, which earlier phases need. | Deployment gate, separate from the code release |

### 17.5 Evidence on the final code head (`28077fa`)

Everything below was **executed** in this session on `28077fa`. `28077fa` carries all the code; the documentation commit after it changes no code.

| Check | Result |
|---|---|
| Full suite, unprivileged user, Node 22.22.0 | **93/93 files, 2,838/2,838 tests**, 0 skipped, exit 0 |
| Full suite, unprivileged user, Node 22.23.2 | **93/93 files, 2,838/2,838 tests**, 0 skipped, exit 0 |
| Build, typecheck, lint | Exit 0 |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| New tests this round | 3 (R6 classification; assessment regeneration disclosure; preflight texts) |
| OpenAPI | Drift test passes. Against `7caf74d`, the only change is the nullable `domains[].evidenceClass` on the engineering-assessment path; the other 105 paths and every shared component are unchanged. |
| Container smoke (local Docker; scratch Dockerfile adds the proxy CA to the build stage only) | Non-root, liveness 200, readiness 503, SIGTERM exit 0 |
| **Local** Supabase acceptance (CLI 2.117.0; a fresh disposable stack applied all 24 migrations, 0001–0024) | **120/120**, exit 0. Receipt `docs/phase16-evidence/supabase-2026-10-12T16-33-07.746Z.json`: 3,495 requests, 0 API errors; its 16 failures are the expected 401 refusals. The stack was stopped. |
| GitHub Actions | Runs on the PR head that includes this commit. A commit cannot cite its own run, so the run and its result are recorded in the PR #7 description. |

**Hosted Supabase is NOT verified.** These are local, disposable-stack results only. The hosted database was never contacted. It is believed to be at migration 0017, and 0018–0024 are unverified there. Applying them is a separate deployment gate that needs an authorized operator.

Not run: Node 24 and 26; Phase 30 frontend integration verification (**deferred** by the owner).

### 17.6 Verdict

**NO-GO for merge or tag.** Code, tests, contract, container and local database evidence all pass. Two gates are open:

| # | Gate | State | What closes it |
|---|---|---|---|
| 1 | Independent **human** review | **Open.** Requested from `shubham-0`; no review yet | A human reviewer completes the PR #7 checklist and records approval or changes |
| 2 | Phase 35 scope of record | **Open** (roadmap unavailable) | Owner decision: accept R1–R8, as delivered and limited in §16–§17, as the Phase 35 scope |
| 3 | Standards and evidence classes | **Closed:** R6 implemented; R2 solvers and R8 values excluded and explicitly unsupported per the owner's instruction | — |
| 4 | Version, provenance, deletion and migration review | **Closed** (§17.4) | — |
| 5 | CI, suite, OpenAPI, smoke, local Supabase | **Closed** (§17.5) | — |
| 6 | Merge and tag `backend-v1-phase35-complete` | Waits on 1–2, then explicit owner authorization | — |
| 7 | Hosted migrations 0018–0024 | Deployment gate, separate from the code tag | An authorized operator: read-only check, then staging, then production |

Once gates 1 and 2 close, the owner's explicit authorization is required to merge PR #7 into `phase31/development` and tag the merge commit `backend-v1-phase35-complete`.
