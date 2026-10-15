# NekoArch backend: phase status and error register

**Date:** 2026-10-15. **Type:** read-only status audit. Nothing was merged, tagged, migrated or deployed, and no hosted system was contacted.
**Code inspected:** `phase31/development` @ `287b1a4`, the repository's default branch. `main` holds documents only and is about two days behind (see E-X1).
**Phase numbering:** the authoritative 46-phase roadmap (`docs/sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md`), written B01–B46.

## 0. How to read this

**Evidence labels**

| Label | Meaning |
|---|---|
| **RAN** | I executed it in this session |
| **CI** | Read from a GitHub Actions run |
| **DOC** | Stated in a repository document and not re-executed. Phase B05–B28 verdicts are mostly DOC |
| **CODE** | I confirmed it in the source on `287b1a4` |

**Buckets**
- **READY**: implemented and tested within its supported scope; only release gates (hosted DB, staging, tag) are open.
- **FIX-SMALL**: works, but a bounded gap or an unmerged fix remains.
- **FIX-PROPER**: the roadmap gate is not met and real build work is needed.
- **LEFT**: not started, or only a foundation exists.

**Cross-cutting rule.** Under the roadmap's own Definition of Done (§K, L788) a phase also needs staging proof and a tag. No phase from B29 onward has either (E-X2). So "READY" means ready for development use and for a local or disposable-database demo. It does not mean released.

## 1. What I ran on `287b1a4`

| Check | Result |
|---|---|
| `npm ci` | exit 0, 284 packages (**RAN**) |
| `npm run build` / `typecheck` / `lint` | all exit 0 (**RAN**) |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities (**RAN**) |
| `npx vitest run`, Node 22.22.0, unprivileged user, embedded PostgreSQL | **113 files, 3,098 tests passed, 0 failed** (**RAN**) |
| Backend CI run 38678994454 on the head | success (**CI**) |
| Backend CI run 38679145597 on PR #27 head | success (**CI**) |

**Not run:** the local Supabase stack (no Docker daemon here), container smoke, Node 22.23, anything hosted.
**Previously reported, not re-run by me:** local Supabase acceptance 125/125 on `c343855` (receipt `docs/phase16-evidence/supabase-2026-10-14T17-30-30.615Z.json`, **DOC**).

The Node 22.22.0 test failure found on 2026-10-12 (55 failures from the source-mode worker bootstrap) is **fixed**: the full suite is green on 22.22.0 now.

## 2. Phase status

| Phase | Title | Bucket | One-line reason | Errors |
|---|---|---|---|---|
| B01–B04 | Monorepo, geometry, walls, topology | READY (DOC) | Reported complete and audited PASS, but no commit or tag exists | E-01 |
| B05 | Persistence, APIs, security | READY | Tagged; one audit defect fixed | — |
| B06–B08 | Generation, integration, hardening | READY | Tagged; audit defects fixed | — |
| B09–B12 | Building Model V2, blueprint, QA, revisions | READY | Tagged; audit defects fixed | — |
| B13–B17 | Takeoff, materials, BOQ, workflow, freshness | READY | Tagged; rates are synthetic or user-supplied only | E-02 |
| B18–B21 | NL interpreter, solver V2, conversation, AI orchestration | READY | Tagged; Phase 20 defects fixed; one AI capability is live | E-03 |
| B22–B28 | Parametric, BIM, structural, environmental, MEP, knowledge, optimization | READY (bounded) | Tagged; ≤ 2 storeys; synthetic knowledge; closed-form validation only | E-04, E-05 |
| B29 | 3D visualization and walkthrough | FIX-SMALL | GLB scene is done; renders, 360°, walkthrough paths and LOD are not | E-06 |
| B30 | Selective revision and regeneration | READY | Tagged; frontend verification was deferred by the owner | E-07 |
| B31 | Secure reference ingestion | **FIX-PROPER** | No malware scan and no quarantine state | E-08 |
| B32 | Durable jobs, progress, recovery | **FIX-PROPER** | No background sweeper, no `ProviderCharge`, no push progress | E-09 |
| B33 | Account, library, settings | READY (with retention decision) | Works; erasure and retention policy undecided | E-10 |
| B34 | Complex building verification | **FIX-SMALL** | Three defects are fixed in unmerged PR #27; three capabilities are deferred | E-11 |
| B35 / B35.1 | Supertall engineering and verification | FIX-SMALL | Honest by design; processing partitioning and shaft continuity are open | E-12 |
| B36 | Cloud compute gateway | **FIX-PROPER** | Roadmap gate unmet; local pool only | E-13 |
| B37 | Unified model and dependency graph | READY (waivers) | Manifest v2 merged; four minor items open | E-14 |
| B38 | Construction documents and evidence | FIX-SMALL | SVG sheets, CSV and signed packages work; no PDF, DXF, sections or dimensions | E-15 |
| B39 | Six specialist AI workflows | READY (qualified) | All six modules run; several actions are typed refusals | E-16 |
| B40 | Autonomous large-scale integration | LEFT | Not started; depends on B39 | — |
| B41 | Conversational AI expansion | FIX-SMALL (early partial) | Delivered under the old label "Phase 36" | E-17 |
| B42 | Fantasy-to-feasible engine | LEFT | Only the B28 optimizer exists | — |
| B43 | Model routing and evaluation | LEFT | B21 foundation only | E-18 |
| B44 | Engineering collaboration | LEFT | Nothing built | — |
| B45 | Desktop 3D delivery, push progress | LEFT | Foundations only | — |
| B46 | End-to-end benchmark | LEFT | Needs a deployed backend | — |

**By phase number:**
- **READY:** B01–B28, B30, B33, B37, B39 (32 of 46 phases).
- **FIX-SMALL:** B29, B34, B35, B38, B41 (5).
- **FIX-PROPER:** B31, B32, B36 (3).
- **LEFT:** B40, B42, B43, B44, B45, B46 (6).

## 3. Error register, by phase

Severity: **P0** blocks a release. **P1** blocks the owning phase's gate. **P2** limited impact or a documented limit.

### Phases B01–B28 (historical)

| ID | Phase | Sev | Finding | Evidence | Status |
|---|---|---|---|---|---|
| E-01 | B01–B04 | P2 | No commit or tag; history starts at the Phase 5 tag. Completion is "reported" only | DOC (reconciliation §4.1) | Open (process) |
| E-02 | B13–B17 | P2 | Rate books are `SYNTHETIC` or `USER_SUPPLIED`; no sourced regional prices | CODE (`packages/boq-cost/src/demo.ts`) | Open by design |
| E-03 | B18–B21 | P2 | Orchestrator is hard-wired to one capability and one prompt; 10 of 11 capabilities `PLANNED`. Four separate NL grammars | DOC, CODE | Open (owned by B43) |
| E-04 | B22–B28 | P2 | Generator, BIM, scene and systems are limited to 2 storeys and 24 rooms; fails closed | CODE (`maxFloors: 2`) | Open by design |
| E-05 | B22–B28 | P2 | No validated solvers or sourced standards; knowledge packs are synthetic | DOC | Open by design |
| E-05a | B23 | P2 | BIM refuses models with columns and non-4/6-vertex storey boundaries (audit D10, D20) | DOC (ledger: "documented product limitation") | Open by design |
| — | B05–B23 | — | The 2026-10 audit found **21 defects** (6 P1, 15 P2). The repair ledger records 19 as fixed and verified, 2 already fixed, and 6 reclassified as design, limitation or tooling | DOC (`docs/backend-repair-1-23/repair-ledger.md`) | Closed, but not independently re-audited |

### B29–B30

| ID | Phase | Sev | Finding | Evidence | Status |
|---|---|---|---|---|---|
| E-06 | B29 | P2 | No renders, 360° views, walkthrough paths or LOD. Workflow registry marks `SCENE_3D` and `PROFESSIONAL_2D` as `PLANNED` although they exist (R16) | CODE (`workflows/registry.ts`) | Open |
| E-07 | B30 | P1 | Frontend integration verification deferred; no staging proof | DOC | Open |

### B31–B33

| ID | Phase | Sev | Finding | Evidence | Status |
|---|---|---|---|---|---|
| E-08 | B31 | **P1** | `malwareScan` is always `NOT_PERFORMED / NO_SCANNER_CONFIGURED`. Bad files are refused rather than quarantined; roadmap L145–152 requires quarantine | CODE (`references/contracts.ts:59`) | Open. Must be fixed before production uploads |
| E-09 | B32 | **P1** | No background sweeper: a job orphaned while its owner is offline is recovered only on the owner's next read. No `ProviderCharge` record. Polling only, no SSE | DOC, CODE | Open |
| E-10 | B33 | P2 | Three latent retention defects: `ON DELETE CASCADE` on guarded tables can never succeed, so any future erasure path fails; `user_settings.user_id` has no FK to `auth.users`; the live-suite cleanup protects history only through Phase 30. No erasure policy exists | DOC (B35 audit §6, not re-checked) | Open. Owner decision needed |

### B34

| ID | Phase | Sev | Finding | Evidence | Status |
|---|---|---|---|---|---|
| E-11a | B34 | **P1** | **B34-1:** a document-level edit (`name`, `completeness`) returned `IDENTICAL`, i.e. a hidden edit. Reproduced and fixed with a revert-checked test | DOC (PR #27) | **Fixed on `phase34/diff-integrity`, unmerged** |
| E-11b | B34 | P2 | **B34-2:** reordering a wall's `spaceIds` was reported as an out-of-scope change | DOC (PR #27) | Fixed, unmerged |
| E-11c | B34 | P2 | **B34-3:** violation `levelIds` were truncated to two, hiding the level that broke the scope | DOC (PR #27) | Fixed, unmerged |
| E-11d | B34 | P2 | Whole-model verification and diff were charged as ordinary writes, not to the `generate` quota | DOC (PR #27) | Fixed, unmerged |
| E-11e | B34 | P1 (gate) | Deferred, **not built:** unified change report with quantity and cost deltas; drawing validation (dimensions, scale bar, north, layers); hotspot ↔ BIM ↔ layer ↔ 3D cross-checks | DOC (`phase34-acceptance.md` rows 4, 8, 10) | Open. Owner decides phase |
| E-11f | B34 | P2 | No live real-JWT Supabase run of the B34 routes | DOC | Open |

PR #27 is open, not a draft, and its CI is green (run 38679145597). B34 is explicitly "not accepted or closed" in its own closure record.

### B35

| ID | Phase | Sev | Finding | Evidence | Status |
|---|---|---|---|---|---|
| E-12a | B35 | P1 (gate) | Processing partitioning is unsupported: BIM, scene and analyses still take or refuse the whole model (`PARTITIONED_MODEL_PROCESSING: UNSUPPORTED`) | DOC (`phase35-1-report.md`) | Open. Owner confirms whether this is B35 or later |
| E-12b | B35 | P2 | Cross-zone shaft and lift continuity is `NOT_EVALUATED` | DOC | Open |
| E-12c | B35 | P2 | Every engineering domain is a typed blocker (`REQUIRES_SOLVER`, `NO_VALIDATED_SOLVER`, `NOT_IMPLEMENTED`); the Phase 35 V2 research was never supplied (RCH-001…012 `NOT_RESEARCHED`); the CPWD `0.973` factor is not implemented | DOC | Open by design |

### B36

| ID | Phase | Sev | Finding | Evidence | Status |
|---|---|---|---|---|---|
| E-13 | B36 | **P1** | Roadmap gate ("large solver workloads … capped cost, abort/recovery") is **not met**. `remoteExecution` is the literal `DISABLED`; cost is a literal `FREE/0`; eligible kinds are `SCENE_COMPILE` and `OPTIMIZATION_STUDY` only. Missing: solver kinds, fan-out/fan-in, checkpoints, content-addressed cache, secure provider credentials, sweeper identity. Owner decisions D1–D7 are unanswered | CODE (`compute/contracts.ts:30`), DOC | Open |

### B37–B38

| ID | Phase | Sev | Finding | Evidence | Status |
|---|---|---|---|---|---|
| E-14a | B37 | P2 | U1: detail-level paged and filterable views (takeoff lines, BOQ lines, analysis results, layers) are not built. Waived and assigned to B45 | DOC | Waived |
| E-14b | B37 | P2 | U2: element-level invalidation. Closed at **whole-model** granularity in B39; element level is out of scope | DOC | Partly closed |
| E-14c | B37 | P2 | U4 `confidence/assumptions` metadata, U5 time budget on the manifest's side reads, U6 evidence packages and zone data missing from the manifest | DOC | Open, minor |
| E-14d | B37 | P2 | `phase37/read-cap` (`0bf1c89`) is unmerged. The merged manifest work now caps reads at 8 in flight (`lib/bounded-reads.ts`), so it looks superseded. I did not confirm that | DOC | Confirm and delete or close |
| E-15a | B38 | P2 | PDF and DXF are unsupported (`NO_PDF_WRITER`, `NO_VALIDATED_DXF_WRITER`); no section or elevation drawings; no dimensions or scale bar | CODE (`contracts/documents.ts`), DOC | Open. Needs a dependency decision |
| E-15b | B38 | P2 | No professional-review model: `professionalReview` is always `NOT_RECORDED` | DOC | Open by design |

### B39–B43

| ID | Phase | Sev | Finding | Evidence | Status |
|---|---|---|---|---|---|
| E-16a | B39 | P1 | Blueprint's verification signal depends on B34, whose repair is unmerged (E-11) | DOC (`b39-acceptance-audit.md` §8) | **Blocking B39 acceptance** |
| E-16b | B39 | P2 | Typed refusals instead of features: Interior layout edits, egress checks and furnishings; Exterior glazing, massing and geometry; Materials substitutions; Budget sourced rates; Structural validated solvers | DOC | Open by design |
| E-16c | B39 | P2 | No B39 staging workflow script exists (only B37's) | DOC | Open |
| E-16d | B39 | P2 | Migration `0029` changes V2 models (`finishes`). Clients that parse V2 strictly need the matching shared package first | DOC | Compatibility note |
| E-17 | B41 | P2 | Conversational work shipped as "Phase 36" (migration `0026`, `docs/phase36-conversational-ai/`). No streaming or resume; no consented reference retrieval; no independent human review recorded | DOC | Open |
| E-18 | B43 | P1 | Risks R05–R10: no AI output evaluation, no spend ledger (per-process state), no consent or retention model, no prompt/schema version in provenance, regex-only injection filter | DOC | Open. Blocks enabling any real model |

### Cross-cutting (affects release, not one phase)

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| E-X1 | P0 (process) | `main` has a root unrelated to `phase31/development`. These status documents live only on `main` and describe 2026-10-13. They are stale: they say B37 and B39 are not implemented | **RAN** (`git merge-base` empty) | Open. Owner decides |
| E-X2 | P0 (release) | No tag exists after `backend-v1-phase30-complete`. B31–B39 are untagged. No staging proof exists for any phase | **RAN** (`git ls-remote --tags`) | Open (D-10, D-11) |
| E-X3 | P0 (release) | Hosted Supabase state is unknown. It was last reported at `0017`; the repository now has `0001`–`0029`, so up to 12 migrations may be pending. Nothing was applied | DOC | Open (D-9). A read-only operator script exists (`scripts/verify-hosted-migrations.mjs`) |
| E-X4 | P1 | Supabase acceptance is a manual-dispatch CI job only. The session integration gets 403 when starting it. Runs so far were local. `scripts/ensure-local-postgrest.mjs` exits 1 ("Unexpected REST image") when the CLI falls back to the Docker Hub PostgREST image | DOC | Open (tooling defect) |
| E-X5 | P1 | Several merges had no independent human review (PRs #7, #13, #14, #15 per merge messages) | DOC | Open |
| E-X6 | P1 | Backend–frontend contract conformance has never been checked; the frontend repository is not in scope | DOC | Open |
| E-X7 | P2 | Branch protection: none as of 2026-10-12. I did not re-check | DOC | Unverified |

## 4. Suggested fix order

1. **Merge PR #27** (B34 repair). It unblocks B39 acceptance (E-16a). CI is green.
2. **Answer the owner decisions** that gate real work: B36 D1–D7, the erasure policy (E-10), whether B35 needs processing partitioning (E-12a), and the three deferred B34 capabilities (E-11e).
3. **Fix B31 and B32 properly** (E-08, E-09). They are required before production uploads and production jobs.
4. **Release gates** (E-X2, E-X3, E-X4): hosted ledger check, one disposable Supabase acceptance run via `workflow_dispatch`, a B39 staging script, then tags.
5. **B36 build-out**, then B38 formats.
6. **New phases:** B40, B42, B43 (start with the evaluation harness and capability registry), B44, B45, B46.
7. **Housekeeping:** refresh or retire the stale documents on `main` (E-X1); close `phase37/read-cap` and `phase39/s1-specialists` if confirmed superseded.

## 5. Limits of this report

- B05–B28 verdicts come from repository documents and tags. I did not re-audit them. I ran the full test suite, which passes.
- I did not read every source file. Spot-checks in **CODE** rows are the only direct source evidence.
- Hosted, staging, frontend and Supabase-stack behaviour were not exercised.
- Branch protection and Actions settings were not re-checked.
