# Backend Phases 1–46: reconstructed inventory and B35 scope reconciliation

**Prepared:** 2026-10-12, against `phase35-1/release-remediation` plus remediation round 2. **Updated** the same day for the Phase 35 completion round (regeneration, preservation, partitioned processing; [regeneration-and-partitions.md](regeneration-and-partitions.md)) and a second full source search, which again found no roadmap or research (§6).

**This is not the roadmap.** The canonical 46-phase roadmap (`NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md`, 8 Oct 2026, reported to be in the owner's `~/Downloads`) has never been committed. This document is reconstructed from secondary evidence: phase reports, design documents, verbatim roadmap quotes that earlier sessions copied into those documents, tags and Git history. Every row says how strong its evidence is. Where nothing is recoverable, the row says so instead of filling the gap.

When the owner commits the roadmap (suggested path `docs/roadmap/`), it supersedes every row here.

## 1. Evidence used, strongest first

| Code | Source | Standing |
|---|---|---|
| **RQ** | Verbatim roadmap quotes copied into design documents by sessions that had the roadmap text: B31 (`docs/phase31/phase31-design.md:7`), B32 (`docs/phase32/phase32-design.md:9`), B33 (`docs/phase33/phase33-design.md:13`), B34 and its F35 update (`docs/phase34/phase34-design.md:7`); B36 condensed from §B and §I hard rules 3 and 6 (`docs/phase36/phase36-handoff.md` §1, written on the owner's machine) | Secondary, but traceable to the roadmap |
| **TG** | Release tags `backend-v1-phaseNN-complete` (Phases 5–30) and the phase commits they point to | Primary evidence of what was released, not of what was planned |
| **RP** | Each phase's own design and report documents (`docs/PHASE5.md` … `docs/phase35/`) | Secondary: written by the implementing sessions |
| **AS** | Later-phase assignments recorded by those sessions: `phase30-report.md` §K, `phase32-design.md` §12, `phase34-design.md` §8, `modernization-report.md` §E and §I, `phase33-design.md`, `phase35-design.md` §12, `phase36-handoff.md` §9 | Secondary, consistent with each other, unverified against the roadmap |
| **NONE** | No recoverable source | — |

Two cautions:
- `docs/PHASE5.md` says Phase 5 followed a separate `PLAN.md` with Phases 0–5 that "does not define numbered Phases 6 or 7", and `docs/PHASE7.md` says no PRD, TRD or `PLAN.md` was supplied. Phases 1–5 may therefore come from an earlier plan than the 46-phase roadmap.
- `docs/backend-audit-1-23/AUDIT-REPORT.md` names Phases 1–4, but it also calls the repository a "pnpm monorepo", whereas it uses npm workspaces. Its Phase 1–4 labels are not reliable.

## 2. Phase inventory

Status vocabulary: **Released** (tagged), **Merged, untagged**, **Partial**, **Not started**. "Verified" means within the scope each report states, on the implementing machine with embedded PostgreSQL, unless noted. **No phase has been verified against hosted Supabase**; the hosted database is believed to be at migration 0017 (B31–B33 reports), which an operator must confirm read-only.

| Phase | Name (source) | Scope evidence | Migrations | Status and evidence | Pending or blockers | Confidence |
|---|---|---|---|---|---|---|
| 1–4 | **Unrecovered.** Audit labels: monorepo and contracts; 2D geometry; walls and storeys; spatial topology (AS, unreliable) | `PLAN.md` Phases 0–5 (not committed) | — | Repository history starts at "Phase 5 complete" (2026-09-13, which already contains 0001–0004); no Phase 1–4 tag or commit | Owner: confirm whether Phases 1–4 belong to the 46-phase roadmap or the earlier plan | Low |
| 5 | Integration, security and contract tests (RP: `PHASE5.md`, from `PLAN.md`) | Five original endpoints, Supabase adapter, RLS | 0001–0004 | Released `backend-v1-phase5-complete` | — | Medium |
| 6 | Procedural generation core (RP) | Generator package | — | Released | — | Medium |
| 7 | Generation API and end-to-end integration (RP) | Generation route | — | Released | — | Medium |
| 8 | Production hardening (RP) | Ops, container, readiness, idempotency | 0005 | Released | — | Medium |
| 9 | Architectural Building Model V2 (RP) | Model schema, invariants | — | Released | — | Medium |
| 10 | Precision Blueprint Engine (RP) | Blueprint generation (≤ 2 floors) | — | Released | Generation above 2 floors is unassigned (§4) | Medium |
| 11 | Independent Blueprint QA and Architectural Rule Engine (RP) | QA package, rule packs | — | Released | — | Medium |
| 12 | Native Building Model V2 persistence and Project API (RP) | Projects, immutable revisions, signed writes | 0006 | Released | Deletion and erasure policy undecided (§5) | Medium |
| 13 | Deterministic quantity takeoff (RP) | Takeoff package | 0007 | Released | — | Medium |
| 14 | Construction calculation engine (RP) | Construction calculations | 0008 | Released | — | Medium |
| 15 | BOQ and Cost Engine V2 (RP) | BOQ, rate tables, money rounding | 0009 | Released | Official rate books not ingested | Medium |
| 16 | Workflow architecture (RP) | Workflows | 0010 | Released | — | Medium |
| 17 | Generation identity and freshness (RP) | Identity, freshness | 0011 | Released | — | Medium |
| 18 | Architectural requirement interpretation (RP) | Interpreter | — | Released | — | Medium |
| 19 | Precision Solver V2 (RP) | Solver V2, site allocation | — | Released | — | Medium |
| 20 | Conversational architectural intelligence (RP) | Conversations | 0012–0013 | Released | — | Medium |
| 21 | Controlled AI provider orchestration (RP) | Provider policy, registry | — | Released | — | Medium |
| 22 | Bounded parametric architecture (RP) | Parametric engine | — | Released | — | Medium |
| 23 | BIM projection and IFC export (RP: `phase23-*`) | Bounded BIM profile (≤ 2 storeys) | — | Released | Profile beyond 2 storeys unassigned (§4) | Medium |
| 24 | Structural engineering integration (RP) | Linear-static 3D frame analysis | 0014 | Released, "fully implemented within bounded scope" | No P-delta, diaphragm or panels | Medium |
| 25 | Environmental and building simulation, bounded (RP) | Environmental analyses | 0015 | Released | — | Medium |
| 26 | Building systems coordination V1 (RP) | Egress graph, lifts, systems | 0016 | Released | Refuses > 2 storeys | Medium |
| 27 | Specialized architectural knowledge V1 (RP) | Bundled knowledge packs | 0017 | Released | Verified standards ingestion unassigned | Medium |
| 28 | Optimization and design iteration V1 (RP) | Optimization studies | 0018 | Released | — | Medium |
| 29 | Advanced 3D scene engine V1 (RP) | GLB scenes within the BIM profile | 0019 | Released | LOD and chunked delivery → B45 (AS) | Medium |
| 30 | Selective revision and regeneration engine (RP) | Exterior wall appearance, restore, compare, approve | 0020 | Released `backend-v1-phase30-complete`; local Supabase stack verified (0001–0020) | **Frontend integration verification deferred/pending** (owner) | Medium |
| 31 | Secure reference ingestion and artifact lifecycle (RQ, RP) | *"safe uploads, file scanning, provenance and private asset storage …"* | 0021, 0024 | Merged (PR #3), untagged; report "implemented … with exceptions" | Hosted migrations; tag decision | High (scope) |
| 32 | Durable generation jobs, progress and recovery (RQ, RP) | *"persistent queues, progress events, retries, cancellation and recovery …"* | 0022 | Merged, untagged | Background sweeper and external workers → B36 (AS) | High (scope) |
| 33 | Account, project library, settings and context (RQ, RP) | *"complete project search, archive, preferences, quotas and brief/context services …"* | 0023 | Merged, untagged | `user_settings` retention; teams → B44 (AS) | High (scope) |
| 34 | Complex building verification (RQ, RP) | *"independently check complex geometry, site polygons, dimensions and scoped diffs …"*, plus the F35 update on integer-mm bases | — | Merged, untagged | High-rise checks → B35 (AS) | High (scope) |
| 35 | Supertall engineering and verification (title from report; **no roadmap quote recovered**) | Owner briefs: R1–R8 (§3) | — | **Implemented against the owner briefs except R2 solvers, R6 and R8** (§3). B35 merged (PR #4, no review); B35.1, remediation round 2 and the completion round on PR #7 (draft, unreviewed) | §3; roadmap text needed to confirm scope | Low (scope) |
| 36 | Cloud Engineering Compute Gateway (RQ via handoff) | Offload engineering and 3D computation: durable queue with fan-out/fan-in, adapters, budgets, verification, content-addressed cache, recovery; builds on B32 (hard rule 3) | — | Not started; handoffs `docs/phase36/phase36-handoff.md`, `docs/audit/B36-…` on `main` | Five owner decisions (handoff §4) | Medium |
| 37 | Unified multidisciplinary dependency graph and freshness propagation (AS) | Phase 30 §K, modernization §I, B35 design §12 | — | Not started | — | Low |
| 38 | Documentation exports, evidence packages, drawing sheets (AS) | PDF/DXF/SVG, persisted signed assessments | — | Not started | — | Low |
| 39 | AI modules: interior/exterior, generative alternatives, provider routing; reference and brief consumption (AS: "39, 43", "B39/B41", "B39/F13–F16") | — | — | Not started | — | Low |
| 40 | **Unrecovered.** No mention anywhere in the repository | — | — | Unknown | Roadmap needed | None |
| 41 | Brief and context consumption by AI flows (AS, single mention "B39/B41") | — | — | Not started | — | Very low |
| 42 | **Unrecovered.** No mention anywhere | — | — | Unknown | Roadmap needed | None |
| 43 | Interior/exterior/render/panorama/video AI providers (AS: "B39/B43") | — | — | Not started | — | Low |
| 44 | Collaboration and review branches; teams, shared projects, roles (AS) | — | — | Not started | — | Low |
| 45 | Desktop delivery: instancing, LOD, chunked progressive delivery, push progress (SSE/websocket), typed response schemas, object storage streaming (AS) | — | — | Not started | Candidate home for partitioned processing (unconfirmed) | Low |
| 46 | Final integration and end-to-end benchmark (AS: "45–46") | — | — | Not started | — | Low |

## 3. Phase 35 requirements (owner briefs; not checked against the roadmap)

| ID | Requirement | Status after remediation round 2 | Evidence |
|---|---|---|---|
| R1a | Multistorey analysis zoning | Implemented (zone assessment, 256-level bound) | `engineering-zones*.test.ts`, CI |
| R1b | Partitioned model processing (BIM, scene, analyses per zone) | **Implemented for QA, B34 verification, area and volume, quantity takeoff and BIM (where the profile admits a partition)**, reconciled exactly with the whole model (`zones/partitions`). Scene, structural, environmental, systems, knowledge, cost and optimization are **not** partitioned (`PARTITIONED_ARTIFACT_SERVICES: UNSUPPORTED`) | `engineering-regeneration*.test.ts`, mutation checks |
| R2 | Wind, drift, seismic, soil, lift, egress: engineering-aware boundaries | Implemented as typed blockers; **no calculation** (no validated solver) | `engineering.test.ts` |
| R3 | Partial regeneration of zones, sections and exterior skins | **Implemented as deterministic operations**: `TYPICAL_FLOOR` (zone or section layout from a compatible template storey) and `FENESTRATION` (exterior-skin windows by rule), with enforced preservation, the save-route QA, commit through the supplied-revision route and post-commit verification. Generator-driven regeneration and envelope-geometry regeneration stay **unsupported** (no multi-storey generator) | `engineering-regeneration*.test.ts` (HTTP: regenerate → commit → `VERIFIED`; tampered → `MISMATCH`) |
| R4a | Stable revision ancestry | Implemented (Phase 12/30 schema, report binding) | Tests |
| R4b | Cross-zone consistency | Geometric only; F1, F8 fixed; F2 labelled; shafts never evaluated | Tests |
| R5 | Hard limits and honest infeasibility disclosure | Implemented; F3 and F4 corrected; discovery updated for the new routes and the operations they do not cover | Tests |
| R6 | Evidence classes `conceptual` / `assumption_based` / `professionally_reviewed` (reported roadmap wording) | **Implemented** as an additive per-domain `evidenceClass`: what a computed result rests on, `null` when nothing is computed, `professionally_reviewed` never assigned by software. The seven assurance levels are kept. The definitions are the backend's own (design §2.1); the canonical definitions are unavailable. | `engineering.test.ts` R6 tests |
| R7 | No certification, compliance or approval claims | Implemented | Tests |
| R8 | Research-specified formulas, thresholds, rates, CPWD factor | **Excluded from the Phase 35 release** (owner instruction, 2026-10-12): it stays explicitly unsupported until verified editions and the research exist | §6 |
| N1 | Correct deterministic quantities (storey height, volume) | Fixed (`model-height-v2`) | Regression tests |

## 4. B35 versus B36–B46

| Capability | Classification | Evidence | Note |
|---|---|---|---|
| N1, F1, F2, F3, F4, F5, F7, F8 fixes | **A. Required for B35** | Defects in delivered B35/B35.1 code | Done in remediation round 2 |
| F6 | **Closed as a numbering gap (evidence)**; owner may reopen | A full scan of the originating session's readable transcript (19 pages, 06:56–12:53Z) found no F6 anywhere; the first findings list (12:14:34Z) already went F1–F5, F7 | Its unreadable reasoning blocks cannot be ruled out |
| Stable zone ids, revision binding, typed unsupported operations, `REQUIRES_SOLVER` contract | **B. Foundation** | Code and tests | Consumed by B36 (solvers), B37 (freshness) |
| Deterministic selective regeneration and preservation (R3) | **A. Required for B35 — done** | Owner briefs; the only in-repo assignment points into B34/B35 (`modernization-report.md:225`) | Generator-driven regeneration still needs a multi-storey generator, which no phase owns: **D. Owner decision** |
| Partitioned processing (R1b) | **A. Required for B35 — done** for derived-on-read services | Owner briefs | Partitioned artifact services (scene and analyses stored per zone) and a wider BIM profile: **D. Owner decision** (B45 proposed, unconfirmed) |
| Validated structural, wind, seismic, soil solvers | **D**, with B36 as plumbing only (AS + RQ handoff) | B36 handoff: "B36 is compute infrastructure, not solver validation" | Who validates solvers is unassigned |
| Lift traffic and full egress on tall models | **D** | Phase 26 refuses > 2 storeys | — |
| Evidence-class mapping (R6) | **D** | Roadmap wording reported secondhand | — |
| Verified standards ingestion, official rate books, CPWD factor | **D**, blocked on research | `phase35-design.md` §6–§7 | — |
| Compute gateway, sweeper, external workers | **C. B36** | RQ (handoff §1), `phase32-design.md` §12 | — |
| Dependency graph and freshness propagation | **C. B37** (AS) | Four consistent documents | Verify against roadmap |
| Evidence packages, persisted assessments, exports, drawing sheets | **C. B38** (AS) | Same | — |
| AI modules, providers, AI input extraction | **C. B39/B43** (AS) | Same | — |
| Collaboration | **C. B44** (AS) | Same | — |
| Push progress, LOD, chunked delivery, typed response schemas | **C. B45** (AS) | Same | — |
| Final integration, end-to-end benchmark | **C. B45–46** (AS) | Same | — |
| Phase 30 frontend integration verification | **E. Deferred by owner** | Owner instruction | Stays pending |

## 5. Open policy items

- **Deletion and erasure.** Guarded children declare `ON DELETE CASCADE` but refuse deletion; Phase 12 says deletion is not exposed; Phases 31 and 32 describe cascades. Characterized by tests, undecided.
- **`user_settings` retention** after account deletion (no FK to `auth.users`): a B33 decision.
- **Constant-time comparison** in signature checks of migrations 0006–0023 (0024 header): unassessed.
- **Hosted migrations 0018–0024**: unverified; deployment gate.

## 6. Research and standards inventory

| Item | Found | Used | Blocked work |
|---|---|---|---|
| `NekoArch_Phase35_Engineering_Research_Enhanced_v2_2026-10-10.md` | **No**: not in any branch, commit, GitHub artifact or reachable filesystem; the owner-machine handoff also reports it missing | No | Research formulas, thresholds, solver choices, validation benchmarks |
| Phase 35 V2 cost-data JSON | No | No | Built-in rates, location factors |
| Indicative city-rates CSV | No | No | City rates |
| CPWD `0.973` factor | Named in the B35 brief only | **Not implemented** | Callers can supply any factor as an explicitly sourced adjustment |
| IS 875 Parts 1–3, IS 1893 Part 1, IS 16700, NBC (BIS) | Named by designation only (`engineering/sources.ts`) | `NOT_VERIFIED`, `IDENTIFICATION_ONLY`, no edition | Every determination depending on them |

No standard was retrieved, no edition is asserted, no load, material, soil or rate value is built in, and no conceptual result is presented as verified engineering.

**Second search (completion round, 2026-10-12).** Searched again, with nothing found:
- all 23 remote branches, 27 tags and 71 commits of history (file names and contents, including "56-phase" and the file names above);
- the container filesystem, `/mnt/user-data/uploads` and `/mnt/attach` (all empty);
- the connected Claude Docs and artifact workspaces (no artifacts);
- the account's other repositories: `Better-Pomodoro` (unrelated), and `Testing-Something`, which could not be attached (denied) and was last pushed on 2026-09-02, before the research's 2026-10-10 date.

The 56-phase frontend roadmap is likewise not in any reachable source; §7 remains an inference from `modernization-report.md` §E.

## 7. Frontend dependencies (56-phase frontend plan; mapping from `modernization-report.md` §E)

| Frontend phases | Backend contract | State |
|---|---|---|
| F01–F12 foundation/API | Error envelope, request ids, route catalog, OpenAPI, discovery v2 | Live |
| F13–F16 requirements, uploads, generation | Interpreter, generation (≤ 2 floors), B31 uploads | Live; AI use of references → B39 |
| F17–F20 startup and compute readiness | Readiness, worker-pool 503, B32 jobs | Live; remote compute → B36 |
| F21–F24 auth, projects, settings | Sessions, projects, B33 library and settings | Live |
| F25–F28 chat and context | Conversations, tools, approval | Live |
| F29 generation configuration | Modes, capability registry, discovery | Live |
| **F30 revision and regeneration** | Phase 30 appearance, restore, compare; B35.1 zone preflight; Phase 35 zone regeneration (candidate, commit through the save route, verification) | Phase 30 live within ≤ 2 storeys; Phase 35 regeneration live at any height; **integration verification deferred** (owner) |
| F31 project overview | `GET …/overview` | Live; unified model → B37 |
| **F32 Site and Plot Workspace** (F32–F35 site, blueprints, measurements) | Revision model, QA, takeoff, B34 site/plot/FAR bases | Live; the F32 "site integration" roadmap variant was not recovered; drawing sheets → B38 |
| **F35 Architectural Calculation Workspace** | B34 verification; B35 assessment (deterministic geometry, conceptual cost, typed engineering blockers, `model-height-v2`); B35.1 zones | Live as conceptual or blocked results only; validated calculations need solvers (B36 plumbing + unassigned validation) |
| F36–F38 structural, materials, budget | Phase 24 structural, construction, BOQ | Live within the bounded profile |
| F39–F40 reports and navigation | JSON reports, IFC | Partial; exports → B38 |
| **F41–F48 interactive 3D and walkthroughs** | GLB + manifest within the BIM profile | Live ≤ 2 storeys; renders, panorama, video unsupported; LOD and chunking → B45 |
| F49–F50 interior/exterior AI | — | Unsupported → B39/B43 |
| F51–F54 blueprint, structural, materials, budget AI | Deterministic engines only | → B39 |
| F55 cross-module context | Overview v1 | Partial → B37 |
| F56 final integration | — | → B45–46 |
| Full Building / Interior Only / Exterior Only / Blueprint Only modes | Generation modes and capability registry (F29); Phase 30 appearance is exterior-only; Phase 35 `FENESTRATION` (exterior windows) and `TYPICAL_FLOOR` (storey layouts) | Exterior-only window regeneration and layout regeneration by template exist; generator-driven interior-only or exterior-only regeneration does not |
| Large-building and supertall workflows | Zone assessment, B35 assessment, zone regeneration (candidate + verification), zone partitions, discovery limits | Deterministic regeneration and per-zone QA, verification, takeoff and BIM-where-eligible are live; generation above 2 floors, whole-model BIM and scene above 2 storeys, and per-zone stored analyses are unsupported |

Stable identities that the frontend can rely on: revision ids and ancestry, model hashes, zone ids (`zone-identity-v1`, from ordered storey ids), BIM semantic ids (≤ 2 storeys), and `CURRENT`/`STALE` currency on derived reports.

## 8. What the owner must supply

1. The roadmap file itself, or verbatim §B Phase 35, the B36–B46 sections and §I hard rules, committed to `docs/roadmap/`.
2. The original 56-phase frontend roadmap, if frontend dependencies are to be confirmed rather than inferred.
3. The Phase 35 V2 research set, or confirmation that it does not exist.
4. Confirmation of the Phase 1–5 plan of record (`PLAN.md` versus the 46-phase roadmap).
5. Whether F6 existed (closed here as a numbering gap on the transcript evidence; reopen if you know otherwise).
