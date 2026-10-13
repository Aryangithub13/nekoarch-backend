# NekoArch Backend Roadmap: Authoritative Reconciliation (Phases 1–46)

| Field | Value |
|---|---|
| Date of inspection | 2026-10-13 |
| Baseline | `phase31/development` @ `ea2b5d0c0533e7e3f682b42a029fef7c0b3f5359` (default branch; Phase 38 merged) |
| Authority status | **PROPOSED.** This document becomes the roadmap of record only after the owner ratifies §7. Until then it records evidence and conflicts. It does not create requirements |
| Method | Read-only inspection of every remote branch (34), every tag (29), all 118 reachable commits, phase documents, migrations, tests and GitHub CI runs. No code, migration, branch history, setting or database was changed |
| Companion documents | [post-audit-risk-register.md](post-audit-risk-register.md), [next-phase-readiness.md](next-phase-readiness.md); the starting audit is [../audit/AI-training-architecture-audit-2026-10-13.md](../audit/AI-training-architecture-audit-2026-10-13.md) |

## 0. Evidence labels

| Label | Meaning |
|---|---|
| **VERIFIED** | Checked directly for this document: Git object, file content, CI job result, or tag |
| **REPORTED** | Stated in a repository document or commit message; not re-executed here |
| **ROADMAP-QUOTE** | Text that an implementing session copied from the original roadmap while that roadmap was available to it |
| **ASSIGNMENT** | A later-phase assignment written by an implementing session. Origin is uncertain: it may come from the roadmap or be that session's own inference |
| **OWNER** | An owner instruction recorded in the repository (brief, draft, or merge authorization) |
| **PROPOSED** | A recommendation from this reconciliation. **Not an original acceptance criterion** |
| **UNRESOLVED** | Not recoverable from any available source |

---

## 1. Current baseline (VERIFIED)

| Item | Value |
|---|---|
| Default branch | `phase31/development` (`git ls-remote --symref origin HEAD`) |
| HEAD | `ea2b5d0`, "Merge pull request #15: Phase 38 construction documents and signed engineering evidence packages", 2026-10-13 21:34 +0530 |
| History | 112 commits. The root commit is `6670abe` ("Backend V1 Phase 5 complete", 2026-09-13), so **no commit for Phases 1–4 exists** |
| Migrations | `supabase/migrations/0001`–`0027`, contiguous. Latest: `0027_evidence_packages.sql` |
| CI on `ea2b5d0` | Push run 38427505317 |
| CI jobs | `backend (node 22.22.0)` success; `backend (node 22.23.3)` success. Steps: `npm audit --omit=dev --audit-level=high`, build, typecheck, lint, `npx vitest run` |
| Other CI checks | `container smoke` success; **`supabase-acceptance` skipped** (it runs on `workflow_dispatch` only) |
| Test counts | "102/102 files, 2951/2951 tests". REPORTED in the `ea2b5d0` merge message, citing PR run 38425632545. Not read from logs here |
| Local Supabase acceptance | Newest receipt in the repository: `docs/phase16-evidence/supabase-2026-10-13T06-05-42.817Z.json` (started 06:05Z). This is **before** `0026` (merged 12:41Z) and `0027` (merged 16:04Z) |
| Phase 36 conversational acceptance | `docs/phase36-conversational-ai/phase36-report.md` §5 records its local Supabase acceptance as **not completed** (Docker Hub 429) |
| Hosted Supabase | **Not verified.** Believed to be at `0017` (REPORTED in B31–B33 reports and repeated in the Phase 37 and 38 merge messages). Never contacted by this inspection |
| Session checkout | Branch `main` (`cbe5c1e`). It shares **no history** with `phase31/development` (no merge base; root `dd6e469`). It holds only `README.md` and `docs/audit/*` |

### 1.1 Merged phase commits on the baseline (VERIFIED by ancestry)

| Phase | Integration commit | Source head | PR |
|---|---|---|---|
| 31–34 | `a1398dc` | `6099cda` | #3 |
| 30 Supabase verification | fast-forward (no merge commit) | `25d072f` | #1, #2 |
| 35 initial | `e93479b` | `ebdca38` | #4 |
| Schema pins 31–33 | `6f71c02` | `8f0ba1e` | #5 |
| 36 gateway handoff (docs) | `f86b577` | `a7e3da4` | #6 |
| 36 compute gateway, first slice | `5476f41` | `9420961` | #10 |
| 36 gateway typecheck repair | `d5c057f` | `0329bc7` | #11 |
| CI full suite on two Node versions | `e55cf1f` | `fa5f9c4` | #12 |
| 35 completion and B35.1 remediation | `b6a3640` | `c1b3ad2` | #7 |
| 36 conversational AI (migration renumbered to `0026`) | `24e9535` | `6da9c56` | #13 |
| 37 dependency graph | `2ef4796` | `b6fc259` | #14 |
| 38 construction documents and evidence | `ea2b5d0` | `6dcdc27` | #15 |

GitHub lists PRs #1–#7 and #10–#15 as `merged: false` with a `merged_at` timestamp. They were integrated by direct pushes: merge commits, or a fast-forward for #1 and #2. PRs #8 and #9 were closed without integration. Each merge message from #7 onward cites owner authorization (REPORTED in commit messages).

### 1.2 Stale, conflicting, duplicated or unmerged material (VERIFIED)

| Item | State | Consequence |
|---|---|---|
| `docs/roadmap-research-baseline` @ `56764c5` (r3 roadmap, five registers, research framework) | Unmerged; no PR; 2 commits ahead of its base `f86b577` | The only copy of the reconstructed roadmap and of `docs/research/…v2_2026-10.md` is **not on the default branch** |
| Same branch's `status-register.md` and `decisions-register.md` | **Stale.** They describe base `5476f41` and still say: Phase 36 typecheck failing (fixed by #11); CI subsets (fixed by #12); PR #7 a conflicting draft (merged); conversational branch needs `0026` (done by #13); Phases 37–38 "not started" (both merged) | Agents reading it get wrong state. Q1, Q2, Q3 and Q8 there are resolved; Q4–Q7 and Q9 remain open |
| `docs/phase35-1/phase-1-46-reconciliation.md` (on the default branch) | Written 2026-10-12 against `3717a80`. Lists Phases 36–38 as "Not started" and Phase 40 as "Unrecovered … no mention anywhere" | Superseded on status. Still valid as a source inventory |
| `origin/phase37/read-cap` @ `0bf1c89` | **Unmerged.** One commit that caps dependency-graph per-artifact reads at 8 in flight; adds a test | The baseline's graph route can issue about 150 concurrent owner reads per request (that commit's own description) |
| `origin/phase35-1/workflow-resolution` @ `6ac3c4b` | Unmerged. An alternative merge of the same parents as `c1b3ad2`; differs only in `.github/workflows/backend-ci.yml` (+3/−1) | Superseded by PR #7's head. No unique code |
| `origin/main` @ `cbe5c1e` | Unrelated history: B35 release audit and B36 handoff dated 2026-10-12 | Historical audit. The B36 handoff it contains is superseded by the merged gateway |
| Two "Phase 36" features | `docs/phase36/` (compute gateway) and `docs/phase36-conversational-ai/` (conversational AI). Both merged | Duplicate label: see conflict C3 |
| Phase 37 and 38 documentation | Only `phase37-scope.md` and `phase38-scope.md` exist. No `-report.md` or verification document; results live in merge messages and CI | Acceptance evidence is thinner than for Phases 24–36 |
| AI audit of 2026-10-13 | Previously existed only in a session scratch directory. Committed with this reconciliation as `docs/audit/AI-training-architecture-audit-2026-10-13.md` | Now citable |

---

## 2. Search for the original roadmap

**Result: the original roadmap is not recoverable from the repository. UNRESOLVED.**

| Search | Result (VERIFIED) |
|---|---|
| Every file path in all 118 commits on all refs, filtered for roadmap, plan, PRD, TRD, research, "46", master | Only the 2026-10-13 reconstructions under `docs/roadmap/`, the research framework, and `docs/phase35-1/phase-1-46-reconciliation.md` |
| `PLAN.md` (cited by `docs/PHASE5.md` as the plan for Phases 0–5) | Never committed on any ref |
| The original file `NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md` (8 Oct 2026) | Never committed. `docs/phase36/phase36-handoff.md` §1 (`a7e3da4`) says it existed at `~/Downloads/` on the owner's machine |
| The original Phase 35 V2 research | Never committed. The only research file is the reconstructed framework on the unmerged docs branch: 0 sources, RCH-001…RCH-012 all `NOT_RESEARCHED` |
| The owner-supplied r1 draft (`docs/roadmap/archive/…owner-draft-r1-2026-10-13.md`) | Present on the docs branch; sha256 `ae069e8d…d730` re-verified. **It declares itself a reconstruction**, not the original |

### 2.1 Sources used, strongest first

| Rank | Source | Why it carries weight | Coverage |
|---|---|---|---|
| S1 | **ROADMAP-QUOTE** in `docs/phase31/phase31-design.md:7`, `phase32-design.md:9`, `phase33-design.md:13`, `phase34-design.md:7` | Verbatim italic quotations from the "46-phase plan" | B31–B34 one-line goals only |
| S2 | **ROADMAP-QUOTE (condensed)** in `docs/phase36/phase36-handoff.md` §1 and §9 (`a7e3da4`) | Written on the owner's machine **with the roadmap present** (§2: "46-phase roadmap — Found locally") | B36 mission, deliverables and gate. §9 names B37 (graph/freshness), B38 (evidence packages and exports), **B39–43 (specialist AI workers)**, B45 (SSE/WebSocket push) |
| S3 | **ASSIGNMENT** in `docs/phase30/phase30-report.md` §K; `docs/modernization/modernization-report.md` §E and §I; `phase32-design.md` §12; `phase33-design.md:26-27,105`; `phase33-report.md:53`; `phase31-design.md:24,184`; `phase35-design.md:169` | Consistent with each other and with S2. Whether these sessions had the roadmap is not stated | B31–B46 themes |
| S4 | **OWNER** briefs recorded in repository documents | Owner instruction, but given after the original was lost | 2026-10-12 "Backend Phase 36: Conversational AI" (`docs/phase36-conversational-ai/phase36-design.md:10`); 2026-10-12 "Phase 38 provider routing" (same file, line 26, and the KB decisions register Q4); Phase 35 R1–R8 accepted as scope of record (`3717a80`) |
| S5 | **OWNER** draft r1 (archive, 2026-10-13) | Owner-supplied; explicitly a reconstruction | Project-wide constraints; Phase 30/32/35/36 context; **Phase 40 "Comprehensive backend audit and readiness review — CONFIRMED owner policy"**; Phases 41–46 marked "PROPOSED placeholder only" |
| S6 | Phase design and report documents for 5–30 (`docs/PHASE5.md` … `docs/phase30/`) and release tags | What was built and released, not what was planned | Phases 5–30 |

---

## 3. Phase-by-phase reconciliation

**Status vocabulary** (as requested):
- **IV**: Implemented and verified.
- **II**: Implemented but incompletely verified.
- **PI**: Partially implemented.
- **NI**: Not implemented.
- **BD**: Blocked by a dependency.
- **UR**: Scope or status unresolved.

**Rule applied:**
- **IV** means: the code is on the baseline; the phase's *own* documented tests are present; CI on `ea2b5d0` passed; and, if the phase changed the schema, a local Supabase acceptance receipt covers its migration.
- **No phase can be verified against original roadmap acceptance criteria**, because none were recovered. That limitation applies to every row.
- Hosted deployment is unverified for every migration from `0018` onward.

| Phase | Scope of record | Scope source | Status | Evidence |
|---:|---|---|---|---|
| 1–4 | UNRESOLVED | No source. `PHASE5.md` cites an uncommitted `PLAN.md` (Phases 0–5). The KB r1 titles are placeholders | **UR** | No commits precede `6670abe`. Migrations `0001`–`0004` exist in the Phase 5 tree |
| 5 | Integration, security and contract tests | S6 `docs/PHASE5.md` | IV (phase docs) | Tag `backend-v1-phase5-complete` → `6670abe`; `0001`–`0004` |
| 6 | Procedural generation core | S6 | IV | Tag → `ecc03ff`; `packages/generator` |
| 7 | Generation API and end-to-end integration | S6 | IV | Tag → `b88902d` |
| 8 | Production hardening (ops, container, readiness, idempotency) | S6 | IV | Tag → `908b64d`; `0005` |
| 9 | Architectural Building Model V2 | S6 | IV | Tag → `4d95cf9`; `packages/shared/src/building-v2` |
| 10 | Precision Blueprint Engine (≤ 2 floors) | S6 | IV | Tag → `875bc45`; `BLUEPRINT_LIMITS` |
| 11 | Independent Blueprint QA and rule engine | S6 | IV | Tag → `f202a44`; `packages/blueprint-qa` |
| 12 | Native V2 persistence and Project API | S6 | IV | Tag → `46f0117`; `0006` |
| 13 | Deterministic quantity takeoff | S6 | IV | Tag → `cceb01d`; `0007` |
| 14 | Construction calculation engine | S6 | IV | Tag → `ca0cbc2`; `0008` |
| 15 | BOQ and Cost Engine V2 | S6 | IV (arithmetic). Rates are synthetic or user-supplied by design | Tag → `1de9340`; `0009`; `packages/boq-cost/src/demo.ts` |
| 16 | Workflow architecture | S6 | IV | Tag → `7a335ac`; `0010` |
| 17 | Generation identity and freshness | S6 | IV | Tag → `bf3fa6b`; `0011` |
| 18 | Requirement interpretation (finite grammar; provider interface) | S6 | IV (deterministic path). No model adapter is wired | Tag → `094e685`; `apps/api/src/ai/architectural-interpreter.ts` |
| 19 | Precision Solver V2 | S6 | IV | Tags `phase19-complete` → `f17a337` and `phase19-verified-20261003` → `18d6f8c` |
| 20 | Conversational architectural intelligence | S6 | IV | Tag → `18d6f8c` (the same commit as the Phase 19 verified tag: "Stabilize and verify backend Phases 19 and 20"); `0012`–`0013` |
| 21 | Controlled AI provider orchestration | S6 | IV for the one available capability; 10 capabilities `PLANNED` | Tag → `f39dbbc`; `apps/api/src/ai/orchestration/*`; `ai-*.test.ts` |
| 22 | Bounded parametric architecture (≤ 2 floors) | S6 | IV | Tag → `7086209` |
| 23 | BIM projection and IFC export (≤ 2 storeys) | S6 | IV | Tag → `da5f3ca`; `scripts/verify-ifc.py` |
| 24 | Structural engineering integration (bounded linear-static frame) | S6 | IV (software). Validation is against analytical closed forms only | Tag → `d93aaa9`; `0014` |
| 25 | Environmental and building simulation (bounded) | S6 | IV | Tag → `ec77974`; `0015` |
| 26 | Building systems coordination V1 (refuses > 2 storeys) | S6 | IV | Tag → `4d1f431`; `0016` |
| 27 | Specialized knowledge V1 (synthetic demonstration packs) | S6 | IV (software). The packs are `SYNTHETIC_DEMONSTRATION` | Tag → `90e5124`; `0017` |
| 28 | Optimization and design iteration V1 | S6 | II: hosted `0018` unverified | Tag → `7ca99df`; `0018` |
| 29 | Advanced 3D scene engine V1 (GLB, ≤ 2 storeys) | S6 | II: hosted `0019` unverified | Tag → `c7e4bc0`; `0019` |
| 30 | Selective revision and regeneration | S6 + OWNER | **II**: frontend integration verification **deferred by owner**; hosted `0020` unverified | Tag → `401a470`; `0020`; local Supabase run on `25d072f` (`0001`–`0020`) |
| 31 | Secure reference ingestion and artifact lifecycle | **S1** | II: untagged; hosted unverified | `a1398dc`; `0021`, `0024`; `references*.test.ts` |
| 32 | Durable jobs, progress and recovery | **S1** | II: untagged; background sweeper deferred to 36 | `a1398dc`; `0022`; `jobs*.test.ts` |
| 33 | Account, library, settings, brief/context, quotas | **S1** | II: untagged | `a1398dc`; `0023`; `account*.test.ts` |
| 34 | Complex building verification | **S1** | II: untagged | `a1398dc`; `verification*.test.ts` |
| 35 | Supertall engineering assessment and verification (R1–R8; R2 solvers and R8 research values excluded) | S4 (owner-accepted R1–R8); **no roadmap quote** | II: untagged; validated solvers and research values are UNSUPPORTED by design | `e93479b`, `b6a3640`; `engineering*.test.ts`; CI on `ea2b5d0` |
| 36a | Cloud Engineering Compute Gateway | **S2** | **PI**: first slice only (local pool; remote literally `DISABLED`; no sweeper; no solver kinds; G7, G8 and G12 unresolved) | `5476f41`, `d5c057f`; `0025`; `compute*.test.ts`; Supabase receipt `…T05-05-02.774Z.json` |
| 36b | Conversational AI (turns, decision memory, confirmed actions) | S4 owner brief 2026-10-12; **not a roadmap phase** | II: local Supabase acceptance not completed (`phase36-report.md` §5); no independent human review (merge message) | `24e9535`; `0026`; `conversation-turns*.test.ts` |
| 37 | Unified dependency graph and freshness propagation | S2 §9 + S3 | II: no Supabase receipt (no migration, so low risk); read-cap hardening unmerged | `2ef4796`; `dependency-graph*.test.ts` |
| 38 | Construction documents (SVG sheets, schedules) and signed engineering evidence packages | S2 §9 ("evidence packages and exports (B38)") + S3. Conflicts with S4 ("provider routing") | II: **`0027` has no local Supabase receipt**; hosted unverified; PDF/DXF unsupported by scope | `ea2b5d0`; `0027`; `documents*.test.ts`, `evidence.integration.test.ts` |
| 39 | Specialist AI modules: interior/exterior, generative alternatives, provider routing, AI use of references and briefs | S2 §9 ("specialist AI workers (B39–43)"); S3 (phase30 §K "39, 43"; modernization "B39/B43"; phase31 "B39"; phase33 "B39/B41"; phase35 "B39/B43") | **NI**. Theme evidence-backed (Medium); **acceptance criteria UNRESOLVED** | Ten `PLANNED` AI capabilities in `registry.ts`; workflow `INTERIOR_DESIGN`/`EXTERIOR_DESIGN` `PLANNED` |
| 40 | **UNRESOLVED**: comprehensive audit and readiness review (S5 owner draft: "CONFIRMED owner policy") **vs** part of "specialist AI workers (B39–43)" (S2 §9) | Conflicting | **UR** / NI | No implementation either way |
| 41 | UNRESOLVED: brief/context consumption by AI flows (S3: phase33 "B39/B41") **vs** "post-audit remediation" (S5 placeholder) | Conflicting; both weak | **UR** | — |
| 42 | UNRESOLVED: no repository mention except the r1 placeholder "Reliability / operational readiness"; S2 §9's range B39–43 would include it | None specific | **UR** | — |
| 43 | Interior/exterior/render/panorama/video AI providers (S3: modernization "B39/B43"; phase30 "39, 43"; S2 range) **vs** "deployment and release preparation" (S5 placeholder) | S2/S3 stronger than the S5 placeholder | **NI**; scope Medium–Low | — |
| 44 | Collaboration and review branches; teams, shared projects, roles (S3: phase30 §K; phase33 design; phase31 design:184) **vs** "documentation consolidation" (S5 placeholder) | S3 | **NI**; scope Low–Medium | — |
| 45 | Desktop delivery: LOD, chunked progressive delivery, push progress (SSE/WebSocket), typed response schemas (S2 §9 for SSE; S3 phase32 §12, modernization §I) **vs** "final acceptance" (S5 placeholder) | S2 + S3 | **NI**; scope Medium for SSE, Low for the rest | — |
| 46 | Final integration and end-to-end benchmark (S3 "45–46") **vs** "final roadmap completion / handoff" (S5) | S3 + S5 broadly agree | **NI**; scope Low | — |

---

## 4. Conflicts, with evidence

| ID | Conflict | Evidence A | Evidence B | Assessment | Needs |
|---|---|---|---|---|---|
| C1 | Phase 32 label | S1: "persistent queues, progress events, retries, cancellation and recovery" (`phase32-design.md:9`); `0022` | S5: "Site & Plot Workspace backend support — CONFIRMED from owner context" | S1 is a verbatim roadmap quote. "Site and Plot Workspace" matches frontend phase F32 (`phase-1-46-reconciliation.md` §7) | Owner confirms that S5's label refers to F32 |
| C2 | Phase 35 label | Phase docs: "supertall engineering assessment and verification" | S5: "Engineering Calculation Workspace" | Matches frontend F35 "Architectural Calculation Workspace". Safeguards agree | Owner confirms frontend/backend numbering |
| C3 | **Duplicate Phase 36** | S2: "Phase 36 — Cloud Engineering Compute Gateway" (roadmap §B, condensed); also `phase30-report.md:164`, `phase32-design.md` §12, `phase35-design.md` | S4: owner brief 2026-10-12 "Backend Phase 36: Conversational AI" (`phase36-conversational-ai/phase36-design.md:10`), which itself records the conflict | Roadmap Phase 36 = gateway (S2 outranks S4 on roadmap identity). Conversational AI is an owner-requested extension of Phases 20/21 with no roadmap slot. Both are merged and work; this is a **labelling** conflict, not a code conflict | Owner chooses a documentation label for the conversational work (for example "Phase 20/21 extension" or "36b"). PROPOSED: rename nothing in code, migrations or paths |
| C4 | Phase 38 label | S2 §9: "evidence packages and exports (B38)"; S3: phase30 §K "Documentation exports → 38"; modernization "Drawing sheets, PDF/DXF/SVG → B38" | S4: owner brief 2026-10-12 "Phase 38 provider routing" | S2 was written with the roadmap present, so documentation/evidence is better supported. Provider routing is assigned to 39/43 by S3. Phase 38 shipped as documentation/evidence | Owner confirms; then provider routing belongs to Phase 39 |
| C5 | **Phase 40 role** | S5: "Comprehensive backend audit and readiness review — CONFIRMED owner policy … Fix critical security/data-loss/blocking defects promptly" | S2 §9: "specialist AI workers (B39–43)". A range that includes 40 (but a condensed list may not be exact) | **UNRESOLVED.** S5 is the owner's own statement but sits in a self-declared reconstruction. S2 derives from the original but is a one-line summary | Owner ruling: is 40 (a) the audit/readiness gate, (b) an AI-worker implementation phase, or (c) an AI phase followed by a gate elsewhere |
| C6 | Phases 41–45 | S3 themes: 41 AI brief/context use; 43 AI providers; 44 collaboration; 45 delivery | S5: 41 remediation; 42 reliability; 43 deployment; 44 docs; 45 final acceptance, each labelled by S5 itself "PROPOSED placeholder only" | S5 does not claim these are original. S3 (and S2 for 43 and 45) is stronger for 43–45. 41 and 42 stay UNRESOLVED | Owner confirms |
| C7 | Phases 1–5 plan of record | `PHASE5.md`: Phase 5 follows `PLAN.md` (Phases 0–5); `PHASE7.md`: no PRD/TRD/PLAN supplied | S5 lists 1–4 as foundation placeholders | Phases 1–5 may belong to an earlier plan than the 46-phase roadmap | Owner confirms |
| C8 | Frontend vs backend numbering | Documents use B31–B46 and F01–F56 | Owner context sometimes uses frontend numbers | Source of C1 and C2 | Use "B" and "F" prefixes in all future documents (PROPOSED) |

---

## 5. Phases 39–46: determination

| Phase | Evidence-backed? | What is evidence-backed | What is UNRESOLVED |
|---|---|---|---|
| 39 | **Theme only** (Medium) | Specialist AI modules: interior/exterior, generative alternatives, provider routing; AI consumption of references (B31) and briefs (B33) | Deliverables, acceptance criteria, provider choice, which modalities, and whether provider routing is 39 or 43 |
| 40 | **No** | — | Role (audit gate vs AI phase) |
| 41 | No | Single weak mention ("B39/B41", brief consumption) | Scope |
| 42 | No | — | Everything |
| 43 | Theme only (Medium–Low) | Interior/exterior/render/panorama/video AI providers | Scope, providers, budgets, remote compute |
| 44 | Theme only (Low–Medium) | Collaboration: teams, shared projects, roles, review branches | Scope and sharing model |
| 45 | Theme only (Medium for push progress; Low otherwise) | SSE/WebSocket push progress; LOD/chunked delivery; typed response schemas | Scope details |
| 46 | Theme only (Low) | Final integration and end-to-end benchmark | Acceptance |

**Dependencies implied by the code** (VERIFIED interfaces; ordering is an INFERENCE):
- 39 consumes the Phase 21 orchestrator, B31 references, B33 brief/context, B32 jobs, the B36 gateway, B37 graph and B38 evidence.
- 41 and 43 depend on 39's provider/capability contracts.
- 43 additionally depends on B36 remote placement (currently `DISABLED` by schema literal).
- 44 touches every owner-scoped RLS policy and RPC (`0006`–`0027`), so it must not run in parallel with any schema-touching phase.
- 45 touches `apps/api/src/jobs/**`, `scene3d/**` and `lib/http-protection.ts`.
- 46 comes last.

---

## 6. Engineering safety boundaries carried forward (VERIFIED in code; must not be weakened)

- `REQUIRES_SOLVER`, `NO_VALIDATED_SOLVER` and `NOT_IMPLEMENTED` blockers (`apps/api/src/engineering/*`).
- Standards are catalogued as `IDENTIFICATION_ONLY` / `NOT_VERIFIED` with no edition (`engineering/sources.ts`).
- Knowledge packs are `SYNTHETIC_DEMONSTRATION`.
- Rate books are `SYNTHETIC` or `USER_SUPPLIED`; seed rates are "DEMONSTRATION DATA ONLY".
- `professionalReview: NOT_RECORDED` and all claims `NOT_CLAIMED` in evidence packages.
- Compute claims are `NOT_CLAIMED`.
- Geometry limits: blueprint ≤ 2 floors and ≤ 24 rooms; BIM, scene and systems ≤ 2 storeys; scene ≤ 200k triangles and ≤ 16 MiB GLB. All fail closed.

**Unverified professional or regulatory claims:**
- None are made by the code.
- The research framework's RCH-001…RCH-012 remain `NOT_RESEARCHED`.
- No standard edition, clause, load, rate or tolerance has a registered source.

---

## 7. Proposed authoritative roadmap (PROPOSED; requires owner ratification)

1. Phases 5–38 are recorded as in §3, with statuses as classified there.
2. **Roadmap Phase 36** is the compute gateway (first slice). The conversational AI work is recorded as an owner-requested extension of Phases 20/21, labelled "36b (conversational)" in documents only.
3. **Phase 38** is documentation exports and evidence packages. "Provider routing" moves to Phase 39.
4. **Phase 39** theme: specialist AI modules and provider routing. Its acceptance criteria are written fresh, marked PROPOSED, and approved by the owner before implementation ([next-phase-readiness.md](next-phase-readiness.md)).
5. **Phase 40** stays UNRESOLVED until the owner rules (C5). Under either reading, a readiness audit of the baseline can be performed read-only without blocking Phase 39.
6. **Phases 41–46**: record the S2/S3 themes (41 AI brief/context, 43 AI providers, 44 collaboration, 45 delivery, 46 final integration) as provisional, and 42 as UNRESOLVED.
7. When the original roadmap is recovered, it supersedes this table. Differences are logged and are not silently overwritten.

## 8. Unresolved questions (owner)

1. Can the original `NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md` (8 Oct 2026, `~/Downloads/`) be committed under `docs/sources/` with a checksum? This single action would resolve C3–C6 and every acceptance-criteria gap in §5.
2. Phase 40: audit/readiness gate, or AI implementation (C5)?
3. The label for the conversational "Phase 36" work (C3).
4. Confirm that Phase 38 = documentation/evidence and provider routing = Phase 39 (C4).
5. Confirm or replace the 41–46 themes (C6), and the Phases 1–5 plan of record (C7).
6. Should the knowledge-base branch `docs/roadmap-research-baseline` be refreshed to `ea2b5d0` and merged, and should this document replace its stale status and decision registers?
7. Should `phase37/read-cap` (`0bf1c89`) be reviewed and merged?

## 9. Placement note

- These files are committed on the session branch `main`, which shares no history with `phase31/development`. A pull request from `main` into the default branch is therefore not possible.
- **PROPOSED:** after owner review, add these three documents to the `docs/roadmap/` knowledge base (currently on `docs/roadmap-research-baseline`). Then merge that knowledge base into `phase31/development`, so that roadmap, registers and code share one history.
