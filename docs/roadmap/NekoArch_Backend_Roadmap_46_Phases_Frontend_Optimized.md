# NekoArch Backend Roadmap — 46 Phases (Reconstructed Working Draft, revision 2: repository-reconciled)

> **Document status: RECONSTRUCTED WORKING DRAFT — NOT THE RECOVERED ORIGINAL ROADMAP**
>
> **Revision 2, 2026-10-13.** The owner's draft (revision 1) was reconciled phase by phase against repository evidence.
> - Revision 1 is kept verbatim in `archive/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.owner-draft-r1-2026-10-13.md` (sha256 `ae069e8dba1c658ab8075e859f6641b93a1571e110d6a2d7e480cf34da23d730`).
> - Sections 1, 2 and 5–7 are carried over from revision 1; their only changes are additions of repository facts, listed in §9.
> - Section 3 (phase index) and section 4 (Phase 36) were rewritten where revision 1 contradicted verifiable repository evidence; every such change is listed.
>
> **Revision 3, 2026-10-13 (state update).** Only repository facts changed since r2: the Phase 36 gateway was merged (PR #10), the PR #7 review and conflict state, migration `0025`, and the open items. Each change is listed in §9. Live state (branches, CI, acceptance evidence) now lives in [status-register.md](status-register.md); decisions in [decisions-register.md](decisions-register.md); capabilities in [capability-register.md](capability-register.md); the document map and source index in [README.md](README.md).
>
> **Approval state:** provisional working authority (owner direction, 2026-10-13); owner review is still required before this document is treated as authoritative.
> **Original:** `NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md` (8 Oct 2026; reported as the owner's local copy) has not been recovered. Nothing here reproduces its wording, except the short quotations that earlier sessions copied into phase documents. Those are marked as quotations, with their location.

## 1. How to use this file

Claude Code and other assistants must read this file before proposing or implementing a new NekoArch backend phase.

For each requirement, distinguish:
- **CONFIRMED** — supported by actual repository evidence (code, migrations, tags, Git ancestry, GitHub checks) or an explicit owner instruction.
- **REPORTED** — described in repository reports or phase documents (including roadmap quotations copied there), but not independently verified in this document.
- **PROPOSED** — a planning recommendation created for continuity; it requires owner acceptance.
- **UNKNOWN** — the original phase scope, acceptance criteria, or exact requirements could not be recovered.

Do not silently convert PROPOSED or UNKNOWN content into an official requirement. Keep original repository names and identifiers such as `designflow` where compatibility requires them, while using **NekoArch** as the product name.

## 2. Project-wide constraints

1. **Bootstrapped deployment:** the normal backend must work on ordinary hosting and should not require a high-end inference/rendering server.
2. **External compute:** expensive inference, rendering, or solver work may be delegated to configured providers or optional on-demand compute, with bounded budgets and explicit controls.
3. **Bounded requests:** enforce input size, runtime/deadline, concurrency, retries, cancellation, quotas, and cost ceilings appropriate to each capability.
4. **Honest engineering status:** an AI/provider result is not automatically a validated engineering result. Preserve evidence classifications and disclose unsupported capabilities.
5. **No invented research:** never fabricate standard editions, clause numbers, equations, loads, cost factors, solver-validation results, or professional sign-off.
6. **Compatibility first:** inspect existing API contracts, database schema/migrations, auth, idempotency, revision fencing, jobs, OpenAPI generation, and tests before changing them.
7. **Safe phase boundaries:** use a dedicated branch and reviewable commits for each phase; verify base ancestry rather than assuming it.
8. **No release action without owner approval:** do not merge, tag, deploy, or apply hosted migrations unless explicitly authorized.
9. **No perfection loops:** implement the agreed phase scope, test it honestly, record limitations, and move forward unless a genuine security, data-loss, integrity, or phase-blocking defect is found.
10. **Phase 30 frontend integration verification:** remains deferred until the owner explicitly authorizes it or the end-of-project audit.
11. **Independent review:** track review as pending when pending; do not block separate safe development indefinitely solely because a review is pending.
12. **Branch protection:** never reset, rewrite, force-push, delete, or overwrite another workstream unless the owner explicitly instructs it.

## 3. Phase index (46 slots), reconciled with repository evidence

**How the columns are read:**
- **Scope basis:** where the phase's scope comes from.
  - *Phase doc*: the phase's own design or report title in the repository. This is CONFIRMED as what was built, not as the original roadmap wording.
  - *Roadmap quote*: a quotation of the original roadmap copied into a phase document. REPORTED.
  - *Later-phase assignment*: work that a later phase document assigns to this phase. REPORTED.
- **Status:**
  - *Released*: a `backend-v1-phaseNN-complete` tag exists (CONFIRMED).
  - *Merged*: in `phase31/development` by Git ancestry (CONFIRMED).
  - Claims of verification made inside reports remain REPORTED.

Base of record: `phase31/development` @ `5476f41` (r3; it was `f86b577` in r2). Phase 35's remediation is at `phase35-1/release-remediation` @ `3717a80` (PR #7).

| Phase | Scope (repository evidence) | Scope basis | Status | Migrations | Revision 1 label → finding |
|---:|---|---|---|---|---|
| 1–4 | UNKNOWN | History begins at "Phase 5 complete"; `docs/PHASE5.md` cites a separate, uncommitted `PLAN.md` (Phases 0–5); audit labels in `docs/backend-audit-1-23/` are unreliable | No tag or commit | (0001–0004 predate the Phase 5 tag) | Foundation placeholders → **kept UNKNOWN** (agrees) |
| 5 | Integration, security and contract tests | Phase doc `docs/PHASE5.md` | Released | 0001–0004 | "Project lifecycle foundation" (UNKNOWN) → **corrected** |
| 6 | Procedural generation core | `docs/PHASE6.md` | Released | — | "Input validation and error contracts" → **corrected** |
| 7 | Generation API and end-to-end integration | `docs/PHASE7.md` | Released | — | "Core project APIs" → **corrected** |
| 8 | Production hardening (ops, container, readiness, idempotency) | `docs/PHASE8.md` | Released | 0005 | "Persistence and consistency hardening" → **corrected** (close in spirit) |
| 9 | Architectural Building Model V2 | `docs/PHASE9.md` | Released | — | "Access-control and ownership checks" → **corrected** |
| 10 | Precision Blueprint Engine | `docs/PHASE10.md` | Released | — | "Initial test and regression infrastructure" → **corrected** |
| 11 | Independent Blueprint QA and Architectural Rule Engine | `docs/PHASE11.md` | Released | — | "Asset / artifact foundations" → **corrected** |
| 12 | Native Building Model V2 persistence and Project API | `docs/PHASE12.md` | Released | 0006 | "Generation workflow foundations" → **corrected** |
| 13 | Deterministic quantity takeoff | `docs/PHASE13.md` | Released | 0007 | "Revision / version foundations" → **corrected** |
| 14 | Construction calculation engine | `docs/PHASE14.md` | Released | 0008 | "Capability validation and bounded execution" → **corrected** |
| 15 | BOQ and Cost Engine V2 | `docs/PHASE15.md` | Released | 0009 | "API reliability and observability" → **corrected** |
| 16 | Workflow architecture | `docs/PHASE16.md` | Released | 0010 | "Provider integration foundations" → **corrected** |
| 17 | Generation identity and freshness | `docs/phase17-design.md` | Released | 0011 | "Generation / orchestration expansion" → **corrected** |
| 18 | Architectural requirement interpretation | `docs/phase18-design.md` | Released | — | "Integration and reliability hardening" → **corrected** |
| 19 | Precision Solver V2 | `docs/phase19-design.md` | Released (also `backend-v1-phase19-verified-20261003`) | — | "Pre-conversation workflow hardening" → **corrected** |
| 20 | Conversational architectural intelligence | `docs/phase20-design.md` | Released | 0012–0013 | "AI orchestration / provider policy" → **corrected** (that is Phase 21) |
| 21 | Controlled AI provider orchestration | `docs/phase21-design.md` | Released | — | "Orchestration continuation" → **confirmed**; tag name is `backend-v1-phase21-complete` |
| 22 | Bounded parametric architecture | `docs/phase22-design.md` | Released | — | "Durable jobs, migration 0022" → **incorrect**: 0022 is Phase 32's migration |
| 23 | BIM projection and IFC export (≤ 2 storeys) | `docs/phase23-*` | Released | — | "Structural frame solver (limited)" → **incorrect**: the solver is Phase 24 |
| 24 | Structural engineering integration: bounded linear-static 3D frame analysis | `docs/phase24/phase24-design.md` | Released | 0014 | **Agrees** |
| 25 | Environmental and building simulation (bounded) | `docs/phase25/phase25-design.md` | Released | 0015 | UNKNOWN → **corrected** |
| 26 | Building systems coordination V1 (egress graph, lifts; refuses > 2 storeys) | `docs/phase26/phase26-design.md` | Released | 0016 | UNKNOWN → **corrected** |
| 27 | Specialized architectural knowledge V1 | `docs/phase27/phase27-design.md` | Released | 0017 | UNKNOWN → **corrected** |
| 28 | Optimization and design iteration V1 | `docs/phase28/phase28-design.md` | Released | 0018 | "Release / capability milestone" → **corrected** |
| 29 | Advanced 3D scene engine V1 (GLB within the BIM profile) | `docs/phase29/phase29-design.md` | Released | 0019 | "Modernization / API docs" → **corrected**: modernization is a separate tagged effort (`backend-v1-modernization-phases-1-29`, `docs/modernization/`) |
| 30 | Selective revision and regeneration engine (exterior appearance, restore, compare, preservation locks) | `docs/phase30/phase30-design.md`; owner context | Released; frontend integration verification **deferred** (owner) | 0020 | **Agrees** |
| 31 | Secure reference ingestion and artifact lifecycle | Roadmap quote, `docs/phase31/phase31-design.md:7` | Merged, untagged | 0021, 0024 | **Agrees** |
| 32 | Durable generation jobs, progress and recovery | Roadmap quote, `docs/phase32/phase32-design.md:9` | Merged, untagged | 0022 | "Site & Plot Workspace backend support" → **conflict** (§3.1) |
| 33 | Account, project library, settings and context (quotas: ≤ 8 active jobs per owner) | Roadmap quote, `docs/phase33/phase33-design.md:13` | Merged, untagged | 0023 | **Agrees** (narrower label) |
| 34 | Complex building verification (geometry, site polygons, dimensions, scoped diffs) | Roadmap quote, `docs/phase34/phase34-design.md:7` | Merged, untagged | — | UNKNOWN → **corrected** |
| 35 | Supertall engineering assessment and verification: deterministic geometry, conceptual cost, typed engineering blockers, zones, regeneration, partitions, evidence classes | Phase docs `docs/phase35/`, `docs/phase35-1/` @ `3717a80`; scope R1–R8 accepted by the owner (REPORTED, `3717a80`); **no roadmap quote recovered** | B35 merged (PR #4). B35.1 and completion on PR #7: **open draft**, CI green on Node 22.22.0 and 22.23.2 (`supabase-acceptance` skipped), **approved** by @shubham-0 on `3717a80` (r3), now **conflicting** with the default branch (r3) | — | "Engineering Calculation Workspace" → **label conflict** (§3.1); safeguards agree |
| 36 | **Cloud Engineering Compute Gateway** | Roadmap paraphrase `docs/phase36/phase36-handoff.md` (`a7e3da4`, merged by PR #6); later-phase assignments in phase 30, 32 and 35 docs; owner directive | **First slice merged** (PR #10 → `5476f41`, 2026-10-13, r3). Untagged. Default-branch typecheck fails on a test line; acceptance is incomplete ([status-register §3](status-register.md)) | 0025 | **Agrees** (§4) |
| 37 | Unified multidisciplinary dependency graph and freshness propagation | Later-phase assignment (`phase30-report.md:165`, `modernization/modernization-report.md:226`) | Not started | — | UNKNOWN → **REPORTED assignment added** |
| 38 | Documentation exports, evidence packages, drawing sheets | Later-phase assignment (`phase30-report.md` §K: "Documentation exports → 38") | Not started | — | "Provider routing" → **conflict** (§3.1) |
| 39 | AI modules: interior/exterior, generative alternatives, **provider routing** | Later-phase assignment (`phase30-report.md` §K: "39, 43") | Not started | — | UNKNOWN → **REPORTED assignment added** |
| 40 | Comprehensive backend audit and readiness review | Owner policy (CONFIRMED); no repository mention | Not started | — | **Agrees** |
| 41 | Brief and context consumption by AI flows (very low confidence) | Single "B39/B41" mention in `docs/phase35-1/phase-1-46-reconciliation.md` @ `3717a80`; not found on the base branch | Not started | — | "Post-audit remediation" (PROPOSED) → **conflict**, UNKNOWN |
| 42 | UNKNOWN | No repository mention | — | — | "Reliability / operational readiness" (PROPOSED) → **kept PROPOSED** |
| 43 | Interior/exterior/render/panorama/video AI providers | Later-phase assignment (`phase30-report.md` §K) | Not started | — | "Deployment and release preparation" (PROPOSED) → **conflict**, UNKNOWN |
| 44 | Collaboration and review branches; teams, shared projects, roles | Later-phase assignment (`phase30-report.md` §K, `phase33/phase33-design.md:27`) | Not started | — | "Documentation consolidation" (PROPOSED) → **conflict**, UNKNOWN |
| 45 | Desktop delivery: LOD, chunked progressive delivery, push progress (SSE/websocket), typed response schemas | Later-phase assignment (`phase30-report.md` §K, `phase32-design.md` §12) | Not started | — | "Final acceptance" (PROPOSED) → **conflict**, UNKNOWN |
| 46 | Final integration and end-to-end benchmark | Later-phase assignment ("45–46") | Not started | — | "Final roadmap completion / handoff" → **broadly agrees** |

**Migrations of record** on `phase31/development`: `0001`–`0025` (r3: `0025_compute_gateway.sql` merged by PR #10). The hosted database is believed to be at `0017` (REPORTED in the B31–B33 reports; to be confirmed read-only by an operator). r3: the gateway's `0025` merged first, so `phase36/conversational-ai` (`3016ec8`, whose `0025` only replaces a function) must be renumbered to `0026` before it can merge (§4.5).

### 3.1 Conflicts between revision 1 and repository evidence (owner decision; none blocks Phase 36 safety)

1. **Phase 32.** Revision 1 marks "Site & Plot Workspace backend support" as CONFIRMED from owner context. The repository's roadmap quote assigns **durable jobs** to B32, and that is what migration 0022 and `apps/api/src/jobs/` implement. "Site and Plot Workspace" is the **frontend** phase F32 of the 56-phase frontend plan (`docs/phase35-1/phase-1-46-reconciliation.md` §7 @ `3717a80`). Backend support for site and plot work exists in the revision model, B34 verification and Phase 35 (plot area, FAR, coverage). *Recommended reading:* the owner's label refers to F32. Keep backend Phase 32 as durable jobs.
2. **Phase 35.** "Engineering Calculation Workspace" matches the **frontend** F35 "Architectural Calculation Workspace". Backend B35 is "supertall engineering assessment and verification". The safeguards in revision 1 agree with the code.
3. **Phase 38.** The owner's 2026-10-12 brief named "Phase 38 provider routing". The repository assigns documentation exports to 38 and provider routing to 39/43. Neither is implemented. No current work depends on resolving this before Phase 37.
4. **Phases 41 and 43–45.** Revision 1's placeholders (remediation, deployment, documentation, final acceptance) differ from the repository's later-phase assignments (AI flows, AI providers, collaboration, desktop delivery). Both are kept visible; neither is authoritative.

### Numbering note

Repository documents use **B31–B46** for backend phases and **F01–F56** for the 56-phase frontend plan. The owner's context sometimes uses frontend numbers ("Phase 32 Site & Plot", "Phase 35 Engineering Calculation Workspace"). Confirm which plan a number refers to before changing migration names, tags, API contracts or branch names.

## 4. Phase 36 scope record — Cloud Engineering Compute Gateway

### 4.1 Scope identity: CONFIRMED

The following all assign compute-gateway work to Phase 36:
- `docs/phase36/phase36-handoff.md`, the roadmap paraphrase written from the owner's local roadmap (`a7e3da4`, merged into `phase31/development` by PR #6);
- `docs/phase30/phase30-report.md:164` ("Cloud compute → 36");
- `docs/phase32/phase32-design.md:131,133` (background sweeper with a non-user identity, and external compute workers → 36);
- `docs/phase35/phase35-design.md:151` and `phase35-report.md:150` (validated external solvers behind a compute gateway → B36);
- the owner directive of 2026-10-12/13.

The only document saying otherwise is the conversational-AI branch's own design document, written under an earlier brief. It recorded the conflict rather than resolving it.

### 4.2 Requirements, with provenance

**R** = REPORTED roadmap paraphrase (`phase36-handoff.md`, not original wording); **A** = REPORTED later-phase assignment; **P** = PROPOSED in `origin/main:docs/audit/B36-implementation-handoff-2026-10-12.md`, a plan written without the roadmap; **O** = CONFIRMED owner instruction (2026-10-13 brief).

| ID | Requirement | Basis | Already in code | Open point |
|---|---|---|---|---|
| G1 | Build on B32 durable jobs, not the reverse (hard rule 3) | R, A | Yes: B32 jobs, leases, fencing, retries, dedup, cancel, owner-read recovery | — |
| G2 | Provider-specific adapters; secure server-side credentials | R, O | r3: local-pool provider only; `remote-http-worker` listed `DISABLED`; no credentials (PR #10) | Provider choice (D1) |
| G3 | Progress, cancel, retry, bounded concurrency, error isolation | R, O | Mostly (B32, worker pools) | — |
| G4 | Budgets, quotas, deadlines; cost protection; no unbounded compute | R, O | Quotas (B33). r3: gateway owner limits (`maxActivePerOwner`, `maxConsentedPerOwnerPerDay`); cost pinned to `FREE` / `0` | Budget unit and ceilings (D4) |
| G5 | Result verification before persistence; provider success is not engineering correctness | R, O | Validators exist for scene and optimization output | Remote-eligible kinds (D6) |
| G6 | Deduplication; content-addressed caching of verified results | R | Dedup yes; cache no | — |
| G7 | Dependency-aware fan-out/fan-in; checkpoints; fine-grained recomputation | R only | No | Confirm (in the paraphrase only; absent from P) |
| G8 | Reproducible environments; units and boundary verification; queue isolation | R only | No | Confirm |
| G9 | Recovery after restart, timeout, provider outage, duplicate callback | R, A | Owner-read recovery only | Sweeper identity (D2), callbacks (D3) |
| G10 | Retention policy | R | Guarded-retention convention | Values |
| G11 | Truthful unsupported/approximate status; Phase 35 blockers unchanged | R, O | Yes (B35 disclosures, `REQUIRES_SOLVER`) | — |
| G12 | "Engineering-grade solver execution" | R only (P recommends no solver kinds) | No validated solver exists | **Owner ruling needed** |
| G13 | Lightweight core; remote execution optional and disabled by default; privacy/data-transfer consent | O; research §11; P | r3: remote cannot be enabled (`COMPUTE_POLICY.remoteExecution` = `DISABLED` only); explicit consent per quote; `dataTransfer: NONE` | Privacy default (D7) |

### 4.3 Owner decisions

- **D1** provider: `NONE`, `LOCAL_POOL` and/or an owner-hosted HTTP worker.
- **D2** a non-user database role for a background sweeper (a new credential), or owner-read recovery only.
- **D3** callbacks or polling only.
- **D4** budget unit, ceilings and approver.
- **D5** research. The reconstructed framework is now committed (§7). The original research set has not been recovered.
- **D6** the first remote-eligible job kinds.
- **D7** privacy default.

**PROPOSED safe starting slice** (needs no D2 credential and no paid account):
- `NONE` and `LOCAL_POOL` adapters, plus the remote adapter contract with remote **disabled**;
- polling only, and owner-read recovery;
- quote and consent;
- fail closed;
- existing deterministic job kinds only;
- no solver kinds and no change to Phase 35 domain statuses.

### 4.4 Base branch (verified 2026-10-13)

r3, resolved: option A was used, with only the worker fix cherry-picked (`a7da2a0` = `008a77f`, identical patch-id). The branch merged as PR #10. The table is kept for the record.

| Option | Ancestry | Consideration |
|---|---|---|
| A. `phase31/development` (`f86b577`) | Default branch; contains B31–B35 initial and the Phase 36 handoff | Lacks PR #7, including the Node 22.22.0 source-mode worker fix `008a77f`. Without it, gateway tests on worker pools fail on 22.22.0 |
| B. `phase35-1/release-remediation` (`3717a80`) | A's merge-base `6f71c02` + 17 commits | Has the fix and current engineering contracts; stacks on an unreviewed draft PR; lacks the handoff document |
| C. Merge PR #7 first, then branch from A | — | Cleanest; needs the B35 review and owner authorization |

### 4.5 Separate workstream

`phase36/conversational-ai` (`3016ec8`, based on `3717a80`) implements conversation turns, decision memory and confirmed actions on the Phase 20/21 layer. It is **preserved, unmerged and not Phase 36**. Its disposition (keep, renumber or rename) is an owner decision. Its migration `0025` collides with the gateway's `0025`, which is now on the default branch (r3). It must take `0026` before any merge.

## 5. Release and verification gates

A phase is not “released” merely because code exists or unit tests pass.

For each phase, record:
- exact branch and commit tested;
- clean/dirty working-tree state;
- baseline comparison and migration ancestry;
- build, typecheck, lint, unit tests, integration tests and full regression results;
- API/OpenAPI drift checks;
- migration and upgrade tests if schema changes;
- container and local Supabase acceptance results when applicable;
- skipped checks and environment limitations;
- independent review state;
- owner authorization for merge/tag/deploy/hosted migrations.

A skipped test is **not** a pass. A local database test does not prove hosted migration readiness. Do not claim a test ran unless its output is available.

**Repository commands of record** (`package.json`, `.github/workflows/backend-ci.yml`):

| Check | Command |
|---|---|
| Build | `npm run build` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Full suite (unit, integration, migration replay on embedded PostgreSQL) | `npx vitest run` |
| Route catalog and OpenAPI drift | `apps/api/tests/modernization.test.ts`; regenerate with `UPDATE_ROUTE_CATALOG=1` |
| Container smoke | `docker build -t designflow-api:ci . && node scripts/smoke-container.mjs designflow-api:ci` |
| Local Supabase acceptance | `npm run db:start && npx supabase db reset --local && npm run test:supabase` |

CI runs on Node `22.22.0` and `22.23.2`. Embedded PostgreSQL refuses to run as root and needs the `en_US.UTF-8` locale; run tests as an unprivileged user when the environment is root.

## 6. Standard phase prompt requirements

Every Claude Code implementation prompt should instruct the agent to:
1. Read this roadmap, the relevant phase handoff, current audit reports, and the V2 research document.
2. Inspect the real Git branch, working tree, upstream, commit graph and migration history before editing.
3. Confirm phase scope, dependencies and base branch; stop and report if a material ambiguity cannot be safely resolved.
4. Protect unrelated branches and uncommitted work; never reset, rebase, force-push, delete or overwrite without authorization.
5. Implement only the phase scope with focused tests and documentation.
6. Preserve API and database compatibility unless an approved change requires otherwise.
7. Preserve engineering evidence classifications and truthful capability disclosures.
8. Report exact files, migrations, endpoints, tests and results, including skipped checks.
9. Do not merge, tag, deploy or apply hosted migrations without explicit owner approval.
10. Avoid unnecessary perfection cycles: once acceptance criteria pass, record limitations and proceed unless a genuine safety, security, data-integrity or release-blocking defect exists.

## 7. Source recovery and governance

This reconstruction must not erase the fact that the original roadmap is missing.

When the original is recovered:
1. Save it with source, owner, date and checksum/provenance.
2. Compare every phase title and requirement against this reconstruction.
3. Record differences; do not silently overwrite accepted owner decisions.
4. Update this file only after owner review.
5. Keep an archived copy of this reconstruction for traceability.

Companion research framework: `docs/research/NekoArch_Phase35_Engineering_Research_Enhanced_v2_2026-10.md`. It is a reconstructed protocol, not the original V2 research.

## 8. Current known open items

- [ ] Owner review of this revision; recover or explicitly authorize it as the working authority.
- [ ] Resolve the §3.1 label conflicts (Phases 32, 35, 38, 41, 43–45).
- [ ] Recover the original V2 research set, if it exists.
- [ ] Phase 36: rule on G7, G8 and G12; decide D1–D7. The base branch was resolved in r3 (§4.4).
- [ ] Phase 36 first slice: restore a green typecheck on the default branch, and record the Node 22.23.2 and container-smoke results ([decisions Q1](decisions-register.md)).
- [ ] Decide the disposition of `phase36/conversational-ai`. Its migration must become `0026` (r3).
- [ ] Phase 35: PR #7 is approved (r3) but still a draft and now conflicting. Resolve the conflicts and obtain owner release authorization.
- [ ] Confirm the hosted database migration state read-only before any hosted migration.
- [ ] Keep Phase 30 frontend integration verification deferred.
- [ ] Retain the Phase 40 comprehensive audit as a project-level gate.

## 9. Change log

- `2026-10-13 r1` — Owner-supplied reconstruction (archived verbatim).
- `2026-10-13 r2` — Reconciled with repository evidence:
  - phase index corrected for Phases 5–29, 34 and 37–46 from phase documents, tags and later-phase assignments;
  - conflicts for Phases 32, 35, 38, 41 and 43–45 recorded rather than resolved;
  - Phase 36 requirements given provenance;
  - base-branch options and the repository's check commands added.
  - Sections 1, 2 and 5–7 are unchanged apart from added facts (the evidence-class definitions in §1; the command table in §5; the companion-file pointer in §7).
- `2026-10-13 r3`: state update; no scope change.
  - Base of record moved to `5476f41`.
  - Phase 36 marked as first slice merged (PR #10), with the open typecheck defect recorded.
  - PR #7 marked as approved and now conflicting.
  - Migrations of record became `0001`–`0025`, and the conversational branch must take `0026`.
  - §4.4 base-branch question resolved; §8 open items updated.
  - Linked the new registers ([README](README.md), [status](status-register.md), [decisions](decisions-register.md), [capabilities](capability-register.md), [architecture](architecture-map.md)).
