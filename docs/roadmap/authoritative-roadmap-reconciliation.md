# NekoArch Backend Roadmap: Authoritative Reconciliation (Phases 1–46)

| Field | Value |
|---|---|
| Revision | **r2, 2026-10-13.** Reconciled against the owner-designated authoritative roadmap. r1 (`4fb5919`, same date) was written before the roadmap was available; its changes are listed in §10 |
| Authoritative source | [`docs/sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md`](../sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md) |
| Source details | Supplied by the owner on 2026-10-13 as "`NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized(2).md`", stored verbatim. 802 lines, 83 009 bytes. sha256 `0ebc44799401f6719006b792ea39e7caac5a2cd4efd0d6b6552e7505e3520a03` ([`SHA256SUMS`](../sources/SHA256SUMS)). Document date: 8 October 2026 |
| Baseline | `phase31/development` @ `ea2b5d0c0533e7e3f682b42a029fef7c0b3f5359` (default branch; Phase 38 merged). Unchanged since r1 (re-checked 2026-10-13) |
| Date of inspection | 2026-10-13 |
| Scope of this change | Documentation only. No application code, migration, database, deployment setting, tag or branch history is changed. No branch was merged or deleted |
| Companion documents | [post-audit-risk-register.md](post-audit-risk-register.md) (r2); [next-phase-readiness.md](next-phase-readiness.md) (r2); [../audit/AI-training-architecture-audit-2026-10-13.md](../audit/AI-training-architecture-audit-2026-10-13.md) (historical, unchanged) |

## 0. Evidence labels

| Label | Meaning |
|---|---|
| **ROADMAP** | Text in the authoritative roadmap, cited by section and line of the stored copy (for example "§B Phase 39, L283–297") |
| **VERIFIED** | Checked directly against the repository for this document: Git object, file content, CI job result or tag |
| **REPORTED** | Stated in a repository document or commit message; not re-executed here |
| **INFERENCE** | Reasoning from verified facts. Stated as such |
| **PROPOSED** | A recommendation from this reconciliation. **Not roadmap text and not an acceptance criterion** unless the owner adopts it |
| **UNVERIFIED** | Claimed or required, but no evidence was available |

---

## 1. Baseline (VERIFIED; unchanged from r1)

| Item | Value |
|---|---|
| Default branch / HEAD | `phase31/development` @ `ea2b5d0`, "Merge pull request #15: Phase 38 …", 2026-10-13 21:34 +0530 |
| History | 112 commits. Root commit `6670abe` "Backend V1 Phase 5 complete" (2026-09-13) |
| Tags | `backend-v1-phase5-complete` … `backend-v1-phase30-complete`, plus `backend-v1-phase19-verified-20261003` and the two modernization tags. All 29 are ancestors of the baseline. **No tag exists for B31–B38.** No tag is changed by this reconciliation |
| Migrations | `0001`–`0027`, contiguous |
| CI on `ea2b5d0` (run 38427505317) | `backend` passed on Node 22.22.0 and 22.23.3 (audit, build, typecheck, lint, `npx vitest run`). `container smoke` passed. **`supabase-acceptance` skipped** |
| Test counts | "102 files / 2951 tests". REPORTED in the merge message; not read from logs |
| Local Supabase acceptance | Newest receipt `docs/phase16-evidence/supabase-2026-10-13T06-05-42.817Z.json` predates `0026` and `0027` |
| Hosted Supabase | UNVERIFIED. REPORTED at `0017` |
| Staging or deployment evidence | **None in the repository**, for any phase (searched `docs/**`) |

### 1.1 Merged phase commits (VERIFIED by ancestry)

| Roadmap phase | Integration commit | Head | PR |
|---|---|---|---|
| B31–B34 | `a1398dc` | `6099cda` | #3 |
| B30 local Supabase verification | fast-forward | `25d072f` | #1, #2 |
| B35 initial | `e93479b` | `ebdca38` | #4 |
| B31–B33 schema pins | `6f71c02` | `8f0ba1e` | #5 |
| B36 handoff (docs) | `f86b577` | `a7e3da4` | #6 |
| B36 first slice | `5476f41` | `9420961` | #10 |
| B36 typecheck repair | `d5c057f` | `0329bc7` | #11 |
| CI full suite | `e55cf1f` | `fa5f9c4` | #12 |
| B35 completion | `b6a3640` | `c1b3ad2` | #7 |
| Conversational AI, merged as "Phase 36" (see §5, C3: an early B41 slice) | `24e9535` | `6da9c56` | #13 |
| B37 (dependency graph) | `2ef4796` | `b6fc259` | #14 |
| B38 | `ea2b5d0` | `6dcdc27` | #15 |

---

## 2. Source authority and corroboration

### 2.1 Authority

The owner designated the stored roadmap as authoritative on 2026-10-13. It supersedes these reconstructions, which remain unchanged on their branches as history:
- the reconstructed roadmap r1/r2/r3 and its archive (`docs/roadmap-research-baseline` @ `56764c5`);
- `docs/phase35-1/phase-1-46-reconciliation.md` (on the baseline);
- r1 of this document.

The roadmap describes itself in limited terms:
- "This document cross-checks **roadmaps and user-supplied status**, not the live source code" (L8).
- "**46 phases is a proposed implementation structure, not evidence that 46 phases have been executed**" (L802).

Its status statements are therefore REPORTED, and its contract examples are proposals (L11, §E L509–511).

### 2.2 Corroboration against the repository (VERIFIED comparisons)

| Repository statement | Matches the roadmap? | Notes |
|---|---|---|
| `docs/phase36/phase36-handoff.md` §1, the condensed "B36" (`a7e3da4`; written on the owner's machine with the roadmap present) | **Yes.** Mission, deliverables, separation of B31/B32/B33 and the gate match §B Phase 36 (L226–242). "Hard rule 3" matches §I rule 3 (L735) | Strong corroboration |
| Handoff §9 "B37 graph/freshness; B38 evidence packages and exports; specialist AI workers (B39–43); push progress (B45)" | **Yes.** Matches §B37–B38 and release slice S7 "B39–43" (L728) | — |
| `docs/phase30/phase30-report.md` §K: 31 uploads, 32 jobs, 33 budgets/settings, 34–35 complex/supertall, 36 cloud compute, 37 graph, 38 documentation exports, 39/43 interior/exterior AI and provider routing, 44 collaboration, 45–46 desktop delivery and benchmark | **Yes**, every row | — |
| `docs/modernization/modernization-report.md` §E/§I (B37, B38, B39/B43, B45) and the frontend crosswalk | **Yes.** Matches §G (L615–676) | — |
| Phase 35 evidence classes `conceptual` / `assumption_based` / `professionally_reviewed` (`docs/phase35-1/phase-1-46-reconciliation.md` §3 R6, "reported roadmap wording") | **Yes**, verbatim, at §B Phase 35 L221 | — |
| Audit labels for B01–B04 in `docs/backend-audit-1-23/AUDIT-REPORT.md` (monorepo/contracts, 2D geometry, walls/storeys, spatial topology) | **Yes.** Matches §B L63–66. r1 called them unreliable; that is withdrawn | — |
| **Verbatim "Roadmap mapping" quotes** in `docs/phase31/phase31-design.md:7`, `phase32-design.md:9`, `phase33-design.md:13` and `phase34-design.md:7` (for example *"safe uploads, file scanning, provenance and private asset storage … makes references and downloads secure and version-aware"*, and the B34 "F35 update … FAR/FSI bases") | **No.** None of these phrases occurs in the stored roadmap (string search; 0 hits for "safe uploads", "persistent queues", "complete project search", "independently check complex geometry", "FAR", "FSI") | **UNVERIFIED.** Those sessions quoted a **different text**: another revision of the roadmap, or a summary. The themes agree with §B Phases 31–34, so phase identity is unaffected. Which text they used is unknown |

INFERENCE: at least one other roadmap text existed in early October. The file name suffix "(2)" is consistent with that. The owner's designation makes this copy the authority. The B31–B34 quotes remain historical citations of an unrecovered text.

### 2.3 The numbering key: original 40-phase → expanded 46-phase (ROADMAP §C, L430–455)

This table explains every label conflict recorded in r1:

| Owner label used 2026-10-12/13 | Under 40-phase numbering | Expanded 46-phase phase |
|---|---|---|
| "Backend Phase 36: Conversational AI" (`docs/phase36-conversational-ai/phase36-design.md:10`) | 36 = Conversational AI Expansion | **B41** |
| "Phase 38 provider routing" (KB decisions Q4; conversational design :26) | 38 = Intelligent API & Model Routing Expansion | **B43** |
| r1 draft "Phase 40 — Comprehensive backend audit and readiness review" | 40 = End-to-End System Benchmark & Verification | **B46** (INFERENCE: the closest match; the r1 text is the owner's own reconstruction) |
| r1 "Phase 32 Site & Plot", "Phase 35 Engineering Calculation Workspace" | — | Frontend **F32** "Site & Plot Workspace" and **F35** "Architectural Calculation Workspace" (§G L652, L655) |

---

## 3. Status vocabulary and rules

**Statuses:**
- **IV**: Implemented and verified.
- **II**: Implemented but incompletely verified.
- **PI**: Partially implemented against the roadmap's deliverables or gate.
- **NI**: Not implemented.
- **BD**: Blocked by a dependency.
- **UR**: Scope or status unresolved.

**Rules:**
- Status is judged against the **roadmap's deliverables and gate** where they are now known.
- The roadmap's own Definition of Done (§K L788) requires, among other things, "staging proof of at least one live user workflow" and a "phase tag and clean checked baseline". **No phase from B29 onward has staging proof in the repository**, and B31–B38 have no tag. Therefore **no phase B29–B38 can be IV under the roadmap's Definition of Done.** The best available is II.
- B01–B28 are "reported completed" by the roadmap (L58–59). Their historical tags are preserved and are not re-judged here (§D L462: "do not reopen or rewrite historic release tags").

---

## 4. Phase-by-phase reconciliation

### 4.1 B01–B28: historical foundation (roadmap: "reported completed")

| Phase | Roadmap title (L63–90) | Repository evidence (VERIFIED) | Status |
|---:|---|---|---|
| 1–4 | Core Monorepo Setup & Contracts; Geometric Primitives & 2D Mathematics; Wall System & Storey Boundaries; Spatial Topology & Adjacency | **No commit or tag.** History begins at the Phase 5 tag. The code exists at the root commit (for example `packages/shared`). `docs/PHASE5.md` cites an uncommitted `PLAN.md` | II: completion is REPORTED by the roadmap; no Git evidence |
| 5 | Persistence, APIs, Security & Estimates | Tag → `6670abe`; `0001`–`0004` (repository title: "Integration, security and contract tests") | Reported complete; tag preserved |
| 6–8 | Procedural Generation; Generator & API Integration; Production Hardening | Tags → `ecc03ff`, `b88902d`, `908b64d`; `0005` | Reported complete |
| 9–12 | Building Model V2; Precision Blueprint V1; Blueprint QA; Projects & Immutable Revisions | Tags → `4d95cf9`, `875bc45`, `f202a44`, `46f0117`; `0006` | Reported complete |
| 13–17 | Takeoff; Materials; BOQ & Cost V2; Multi-Mode Workflow; Identity & Freshness | Tags → `cceb01d`, `ca0cbc2`, `1de9340`, `7a335ac`, `bf3fa6b`; `0007`–`0011` | Reported complete. B15's "regional price provenance" exists only as **synthetic or user-supplied** rate books (`packages/boq-cost/src/demo.ts`, `supabase/seed.sql`) |
| 18–21 | NL Interpreter; Solver V2; Conversational Intelligence; Provider Orchestration | Tags → `094e685`, `f17a337`, `18d6f8c` (B20 shares the commit with `phase19-verified`), `f39dbbc`; `0012`–`0013` | Reported complete. B21 has 1 of 11 AI capabilities `AVAILABLE` (`apps/api/src/ai/orchestration/registry.ts:3`) |
| 22–28 | Parametric; BIM; Structural; Environmental; MEP/Fire/Vertical Transport; Knowledge; Optimization | Tags → `7086209`, `da5f3ca`, `d93aaa9`, `ec77974`, `4d1f431`, `90e5124`, `7ca99df`; `0014`–`0018` | Reported complete. Bounded: ≤ 2 storeys; synthetic knowledge packs; linear-static solver validated against closed forms only |

The roadmap's §D compatibility audit (L464–493) and retrofit packages R01–R06 (L497–502) remain **open work owned by later phases**. Their per-item status (`already_supported` / `missing` / …) has **not** been recorded by any phase document found. This is UNVERIFIED.

### 4.2 B29–B35

| Phase | Roadmap gate (summary) | Repository implementation | Status |
|---:|---|---|---|
| 29 Advanced 3D Visualization & Walkthrough (L92–118) | Bounded façade regeneration MVP; Project Manifest v1; scene delivery contract; capability configuration | GLB scene engine within the BIM profile (tag → `c7e4bc0`, 2026-10-08 23:29). Manifest v1 exists as `project-overview-v1` (`services/overview-service.ts:54`). The façade regeneration MVP was delivered by B30 (Phase 30 exterior appearance). Renders, 360° views, walkthrough paths and LOD are not implemented | **II/PI.** Tag preserved. Gate items were spread across B29, the modernization effort and B30. Frontend live test not performed |
| 30 Selective Revision & Regeneration (L121–136) | A→candidate→B façade; glazing conflict rejected; restore as C | `0020`; `docs/phase30/phase30-report.md` "FULLY IMPLEMENTED AND VERIFIED WITHIN SUPPORTED SCOPE"; local Supabase run `0001`–`0020` | **II.** Frontend integration verification deferred by the owner; no staging proof |
| 31 Secure Reference Ingestion (L139–152) | Valid files pass; malicious, mislabeled or oversized files **quarantined**; signed links expire; tenant isolation | `0021`, `0024`; structural inspection and refusal. **`malwareScan: {status: 'NOT_PERFORMED', reason: 'NO_SCANNER_CONFIGURED'}`** (`apps/api/src/references/contracts.ts:59`). Malicious files are refused rather than quarantined | **PI.** No malware scanning or quarantine state; untagged |
| 32 Durable Jobs, Progress & Recovery (L155–168) | Kill/restart a worker mid-regeneration; resume or fail deterministically; enforce budget; truthful progress | `0022`; leases, fencing, retries, cancellation, event log, polling (`apps/api/src/jobs/*`). Recovery is owner-read only (the background sweeper was deferred to B36). No `ProviderCharge` record. No SSE | **PI.** Untagged |
| 33 Account, Library, Settings & Context (L171–184) | Search, rename, archive, restore; preferences and context; tenant isolation | `0023`; `apps/api/src/account/*` | **II.** Untagged |
| 34 Complex Building Verification (L187–205) | "Only the requested façade changed" is independently provable | B34 verifier (`apps/api/src/verification/*`, `verification*.test.ts`) | **II.** Untagged. The roadmap's regression suite across five request types was not separately evidenced (UNVERIFIED) |
| 35 Supertall Engineering & Verification (L208–223) | Large revisions cannot evade cross-storey checks; concept vs certified distinguished | Zones, partitions, typed blockers, evidence classes exactly as worded in L221 (`apps/api/src/engineering/*`) | **II.** Untagged. No validated solver, by design |

### 4.3 B36–B46 (detailed)

#### B36: Cloud Engineering Compute Gateway (L226–242) — **PI**

| Roadmap deliverable | Implemented? (VERIFIED) | Evidence |
|---|---|---|
| Durable queue, dependency-aware fan-out/fan-in | Queue: reused from B32. Fan-out/fan-in: **no** | `apps/api/src/compute/*`, `0025` |
| Provider-specific adapters | Local pool only. `remote-http-worker` is `DISABLED` | `compute/contracts.ts` `PROVIDERS` |
| Progress, cancel, retry, bounded concurrency, error isolation | Yes, through B32 and the worker pools | `compute*.test.ts` |
| Checkpoints | No | — |
| Budgets, quotas, deadlines | Per-owner limits and a quote TTL. Cost is a literal `FREE`/`0` | `ComputePolicySchema` |
| Secure provider credentials | No (none exist) | — |
| Retention policy | Not specified | — |
| Result verification | Service validators (`resultCheck: ACCEPTED_BY_SERVICE_VALIDATOR`) | `compute/contracts.ts` |
| Deduplicated jobs | Yes (B32 `input_hash`) | `0022` |
| Content-addressed caching | No | — |
| Fine-grained recomputation | No | — |
| Recovery after restart, timeout, outage, duplicate callback | Polling-based lost-dispatch recovery. No callbacks. No sweeper | `phase36-report.md` |
| **Gate:** "large solver workloads … validated numerical/engineering output contracts, capped cost, abort/recovery" | **Not met.** No solver job kinds exist (`ELIGIBLE_KINDS` = `SCENE_COMPILE`, `OPTIMIZATION_STUDY`) | — |

Open owner decisions: D1–D7 from the KB r3 roadmap §4.3 (provider, sweeper identity, callbacks, budget unit, research, remote-eligible kinds, privacy default).

#### B37: Unified Multidisciplinary Building Model (L245–262) — **PI**

| Roadmap deliverable | Implemented? | Evidence |
|---|---|---|
| Typed artifact dependency graph | **Yes, read-only, revision-level** | `GET …/dependency-graph`, `dependency-graph-v1`; `2ef4796` |
| Formal invalidation semantics `current, stale, pending, blocked, not_applicable, verified` | **Different vocabulary.** Implemented: `CURRENT`, `STALE_SOURCE_CHANGED`, `STALE_UPSTREAM_STALE`, `UNVERIFIED`, plus family state `NOT_GENERATED`. No `pending`, `blocked` or `verified` | `apps/api/src/contracts/dependency-graph.ts:8-9` |
| Cross-disciplinary element associations | Artifact-level links only. BIM, appearance variants and conversations are excluded | `docs/phase37/phase37-scope.md` A1 |
| Material/façade variations as typed changes | Through B30 typed appearance operations (exterior finish) | `0020` |
| Per-discipline change-impact summaries | No | — |
| **Unified Project Manifest v2** (L257) | **No.** `project-overview-v1` remains | `overview-service.ts:54` |
| Machine-readable metadata (`diff`, `lineage`, `units`, CRS, `completeness`, `last_verified`, `missing_reason`) | Partial (lineage and hashes) | — |
| **Gate:** every accepted targeted edit identifies all dependent outputs needing regeneration or stale labeling; no lost model↔3D linkage | **Partly met**, at revision granularity: every artifact of a superseded revision is `STALE_SOURCE_CHANGED`. Component-level impact is not provided | — |

Unmerged hardening: `origin/phase37/read-cap` (`0bf1c89`) caps per-request reads at 8 in flight.

#### B38: Construction Documentation & Engineering Evidence (L265–280) — **PI**

| Roadmap deliverable | Implemented? | Evidence |
|---|---|---|
| Version-pinned 2D plans | **SVG plan sheets**, one per level | `apps/api/src/documents/plan-sheet.ts` |
| Schedules | JSON and CSV | `documents/schedules.ts` |
| Section and elevation drawings | **No** (out of scope: no verified 2D projection) | `phase38-scope.md` §6 |
| Quantity and engineering evidence packages | Signed, immutable evidence packages; quantity schedules through the B13 takeoff | `0027`, `services/evidence-service.ts` |
| PDF / DXF | **Unsupported** (`NO_PDF_WRITER`, `NO_VALIDATED_DXF_WRITER`). The roadmap allows "where the corresponding format is supported" | `phase38-scope.md` §4 |
| IFC | Existing B23 route | — |
| Revision comparison pages, annotated changes | Not in B38; B30 compare exists separately | — |
| Selective re-export; preserve earlier document revisions | Documents are derived on read and deterministic per revision; packages are immutable | — |
| Layers, dimension primitives, scale (frontend F33–34) | Dimensions not drawn; no scale bar | `phase38-scope.md` A.1 |
| Signatures without false engineer-of-record | `professionalReview: NOT_RECORDED`, claims `NOT_CLAIMED` | `0027` |
| **Gate:** documents declare exact revision, dependencies, validation level, limitations; no silent reuse of obsolete sheets | **Met for supported formats** (manifest `contentHash`, `HISTORICAL_SNAPSHOT`, `?require=current`). Not tested against staging | `documents*.test.ts`, `evidence.integration.test.ts` |

Not verified: a local Supabase receipt for `0027`; hosted application of `0027`.

#### B39: Six Specialized Architectural AI Workflows (L283–297) — **NI** (next new phase)

- **Scope is now evidence-backed.** It covers six modules on **one canonical project model**:
  - Interior, Exterior, Blueprint, Structural, Materials and Budget;
  - a single typed specialist request envelope;
  - reuse of the B6/B10/B19/B22/B24–B28 engines and the B30 guards;
  - typed statuses `unsupported`, `requires_review`, `degraded_provider`, `stale_dependency` and `partial`;
  - "no 'LLM invented dimensions' or image-only simulation passing as geometry-based output".
- **Gate (ROADMAP L297):** "Execute one supported request for each of six modules using real backend adapters; show common revision IDs and invariant locks; feed resulting changes to shared B37 manifest and affected-cost/engineering freshness checks."
- **Repository state:** workflow capabilities `INTERIOR_DESIGN` and `EXTERIOR_DESIGN` are `PLANNED` (`apps/api/src/workflows/registry.ts`). No specialist envelope exists.
- **Dependency:** the gate names the **B37 manifest**. Manifest v2 does not exist (see B37).

#### B40: Autonomous Large-Scale Project Integration (L300–315) — **NI**

- **This is an implementation phase**, not an audit. It covers agent task planning across solver, media, BIM, quantity and engineering, consuming the six B39 operations under locks, budgets and consent.
- Depends on B39 (ROADMAP L311; §I rule 3, L735).
- **r1's "Phase 40 = audit" was an INFERENCE from the owner's reconstruction and is withdrawn.** The owner's audit/readiness policy maps to release slice **S0 "Source-truth audit"** (L721) and to **B46**.

#### B41: Conversational AI Expansion (L318–335) — **PI, delivered early**

The work merged as "Phase 36 conversational AI" (`24e9535`, migration `0026`) implements part of B41:
- turn classification, including comparison, restore and constraints (`TURN_CLASSIFICATIONS`, `contracts/conversation-memory.ts:101`);
- decision memory;
- "keep …" clauses;
- confirmed typed actions (`OPERATION_KINDS`: requirements change, exterior appearance, restore, zone regeneration);
- no hallucinated execution: replies are composed by deterministic rules (`conversation/turns.ts` `DISCLOSURES`).

**Not implemented:**
- message streaming or resume;
- typed tool calls to specialist modes (B39 does not exist yet);
- consented reference retrieval;
- grounding of free referents such as "second-floor south room" beyond the current grammar.

**Verification gaps:** the local Supabase acceptance was not completed (`docs/phase36-conversational-ai/phase36-report.md` §5), and the merge message records no independent human review.

**Sequence note:** the roadmap places B41 after B39/B40 (S7). The early slice rests on B20/B21/B30/B35. INFERENCE: it may need extension once B39 operations exist. Nothing needs undoing.

#### B42: Fantasy-to-Feasible Design Engine (L338–352) — **NI**

The B28 optimization engine (`0018`) is a foundation. There is no concept-vs-feasibility record.

#### B43: Intelligent API & Model Routing Expansion (L355–372) — **NI** beyond the B21 foundation

| Exists (B21) | Missing (roadmap) |
|---|---|
| Privacy classes, metered refusal, host allow-list, circuit breaker, deterministic fallback, provenance | Vendor-neutral capability registry (`llm.intent`, `image.exterior`, `structural.solve`, …) |
| — | Per-operation input/output schema checks |
| — | **"evaluation before accepting provider-produced geometry or analysis"** |
| — | Component-level cache |
| — | Explainable costs |
| — | User-supplied credentials |

The routing, evaluation and spend findings of the 2026-10-13 AI audit (R05–R10) **belong to B43** (and B41), not B39.

#### B44: Professional Engineering Collaboration (L375–391) — **NI**

B33 library operations and B30 compare/restore are foundations. Roles, comments, reviewer sign-off and branches are absent. This phase touches every owner-scoped RLS policy and RPC.

#### B45: Desktop 3D Delivery, API Compatibility & Production Integration (L394–407) — **NI** beyond foundations

- **Foundations:** GLB scenes (B29); generated OpenAPI with a drift test (`docs/modernization/openapi.json`, `apps/api/tests/modernization.test.ts`).
- **Missing:** chunked or LOD manifests, progressive delivery, panorama/video capabilities, desktop QA matrix, push progress.

#### B46: End-to-End System Benchmark & Verification (L410–427) — **NI**

- Requires a real deployed backend and connected frontend (L427).
- There is no deployment evidence.

---

## 5. Conflicts and their resolution

| ID | Conflict (r1) | Resolution in r2 | Evidence |
|---|---|---|---|
| C1 | Phase 32: durable jobs vs "Site & Plot Workspace" | **Resolved.** B32 = Durable Generation Jobs. Site & Plot = frontend F32 | ROADMAP L155, L652 |
| C2 | Phase 35: supertall vs "Engineering Calculation Workspace" | **Resolved.** B35 = Supertall Engineering & Verification. The workspace = F35 | ROADMAP L208, L655 |
| C3 | Duplicate Phase 36 | **Resolved.** Roadmap B36 = Cloud Engineering Compute Gateway. The owner's "Phase 36 Conversational AI" used **40-phase numbering** (old 36 → B41). The conversational work is an **early partial B41**. Repository paths (`docs/phase36-conversational-ai/`), the migration name `0026_conversation_turns.sql` and commits stay unchanged (PROPOSED: relabel in documents only) | ROADMAP §C L448; L226; L318 |
| C4 | Phase 38: documentation vs "provider routing" | **Resolved.** B38 = Construction Documentation & Engineering Evidence. "Provider routing" = old 38 = **B43** | ROADMAP L265, L450 |
| C5 | Phase 40 role | **Resolved.** B40 = Autonomous Large-Scale Project Integration (implementation; consumes B39). r1's audit reading came from the owner's reconstruction and maps to old 40 = **B46**. A source-truth audit is release slice S0 | ROADMAP L300–315, L453, L721 |
| C6 | Phases 41–45 | **Resolved:** B41 Conversational AI Expansion; B42 Fantasy-to-Feasible; B43 Intelligent API & Model Routing; B44 Professional Engineering Collaboration; B45 Desktop 3D Delivery & API Compatibility. r1's B42 "UNKNOWN" is withdrawn | ROADMAP L318–407 |
| C7 | Phases 1–5 plan of record | **Partly resolved.** The roadmap names B01–B05 and reports them complete. **Still UNVERIFIED in Git**: no commits or tags for B01–B04. B05's roadmap title differs from `docs/PHASE5.md` | ROADMAP L63–67 |
| C8 | Frontend vs backend numbering | **Resolved.** The roadmap uses `Bnn`/`Fnn` (L11) and gives the full F01–F56 crosswalk (§G) | ROADMAP L11, L615–676 |
| C9 (new) | B31–B34 "roadmap quotes" in design documents are absent from the authoritative text | **UNVERIFIED** source for those quotes. Themes agree; no impact on phase identity | §2.2 |
| C10 (new) | Phase sequencing: B41 partly delivered before B39 and B40 | Recorded, not reversed | §4.3 B41 |

---

## 6. Superseded or stale material (preserved; nothing deleted)

| Item | State | Action (PROPOSED; owner authorization required) |
|---|---|---|
| `docs/roadmap-research-baseline` @ `56764c5` (reconstructed r1–r3, registers, research framework) | Unmerged. Its phase index and registers are superseded by the authoritative roadmap. The research framework stays valid as a **process** document (RCH-001…RCH-012 `NOT_RESEARCHED`) | Update its README/registers to point here, or close it. Do not delete without instruction |
| `docs/phase35-1/phase-1-46-reconciliation.md` (baseline) | Superseded for Phases 36–46 | Add a pointer in a future docs PR |
| r1 of this document; readiness r1 (Phase 39 slice 1 "AI capability foundation") | Superseded. That foundation belongs to B43 | Done in r2 |
| `docs/audit/AI-training-architecture-audit-2026-10-13.md` §F (39–46 matrix) and §H.5–6 | Written before the roadmap was available. Its phase scopes for 40–45 are superseded by §4.3 here. The technical findings stand | Left unchanged as a historical record |
| `origin/phase37/read-cap` (`0bf1c89`) | Unmerged hardening of B37 | Review and merge on authorization |
| `origin/phase35-1/workflow-resolution` (`6ac3c4b`) | Superseded alternative merge | None |

---

## 7. Dependency order (ROADMAP §I) and current position

| Slice | Phases | Repository state |
|---|---|---|
| S0 Source-truth audit | B01–28 inventory; R01–R06 | Partly: the 2026-10-13 audit and this reconciliation. §D per-item status not recorded |
| S1 First real 3D and revision preview | B29 | Implemented (II/PI) |
| S2 Fully safe revision workflow | B30 | II |
| S3 Production uploads | B31 | PI (no malware scanning or quarantine) |
| S4 Persistent compute events | B32 | PI (no sweeper; polling only) |
| S5 Product services | B33 | II |
| S6 Engineering integrity | B34–B38 | B34, B35 II; **B36, B37, B38 PI** |
| S7 Specialist AI | B39–B43 | B39, B40, B42, B43 NI; B41 PI (early) |
| S8 Collaboration and desktop delivery | B44–B45 | NI |
| S9 Complete verification | B46 | NI |

**Hard rules that bind the next step** (ROADMAP L733–738):
- B36 builds on B32.
- **B39 specialists are composed by B40 agents.**
- **B37 dependency propagation must precede reliance on cross-discipline freshness.** Until then, block or mark stale.
- B45 precedes B46.
- Every release needs migrations where necessary, fixtures, independent validation and **a tagged clean checkpoint**.

---

## 8. Still unverified (consolidated)

1. Hosted Supabase migration state (`0018`–`0027`).
2. Local Supabase acceptance for `0026` and `0027`.
3. Staging proof for any phase (roadmap Definition of Done).
4. Test counts on `ea2b5d0` (REPORTED from the merge message).
5. Phases B01–B04 Git evidence.
6. The source text of the B31–B34 "roadmap quotes" (C9).
7. §D compatibility-audit item status for B01–B28.
8. Frontend contract conformance (frontend repository not inspected; Phase 30 frontend verification deferred by the owner).
9. The original Phase 35 V2 research. Still absent; RCH-001…RCH-012 `NOT_RESEARCHED`.
10. Engineering validity of every output. None is claimed; this boundary is preserved (`REQUIRES_SOLVER`, `NO_VALIDATED_SOLVER`, `NOT_IMPLEMENTED`, `IDENTIFICATION_ONLY`, `NOT_CLAIMED`, `professionalReview: NOT_RECORDED`).

## 9. Placement

- These files are on the session branch `main`, which shares no history with `phase31/development`.
- PROPOSED: after owner review, carry `docs/sources/` and `docs/roadmap/` into the default branch through a docs-only PR based on `phase31/development`. Moving files between branches is an owner-authorized action and is not done here.

## 10. Change log

- **r1 (`4fb5919`, 2026-10-13):** reconciliation without the roadmap.
  - C3–C6 recorded as unresolved.
  - Phase 40 treated as audit-or-AI.
  - Phase 39 scope inferred as "specialist AI and provider routing".
- **r2 (this revision, 2026-10-13):**
  - The authoritative roadmap is stored and checksummed (§2).
  - The numbering key (§2.3) resolves C1–C6 and C8. C7 is partly resolved. C9 and C10 are new.
  - B36, B37 and B38 are re-classified from II to **PI** against their roadmap deliverables and gates.
  - B31 and B32 are re-classified to **PI** (malware scanning and quarantine; sweeper, `ProviderCharge` and SSE).
  - B39 scope is corrected to the six specialist workflows. Provider routing moves to **B43**.
  - B40 is corrected to Autonomous Large-Scale Project Integration.
  - The conversational "Phase 36" is re-identified as an early partial **B41**.
  - The Definition-of-Done rule (staging proof, tag) is applied.
  - Superseded material is listed (§6).
