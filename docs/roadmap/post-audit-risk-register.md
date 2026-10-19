# NekoArch Post-Audit Risk Register

| Field | Value |
|---|---|
| Revision | **r4, 2026-10-19: audit-B repair addendum at the end; earlier rows unchanged.** **r3, 2026-10-13: PR #16 addendum at the end; r2 rows unchanged.** **r2, 2026-10-13.** Re-based on the owner-designated authoritative roadmap. r1 is `4fb5919`. Changes are listed in "Revision log" at the end |
| Authoritative roadmap | [`docs/sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md`](../sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md) (sha256 `0ebc4479…3a03`) |
| Date of inspection | 2026-10-13 |
| Baseline | `phase31/development` @ `ea2b5d0c0533e7e3f682b42a029fef7c0b3f5359` |
| Inputs | [authoritative-roadmap-reconciliation.md](authoritative-roadmap-reconciliation.md) (r2); [../audit/AI-training-architecture-audit-2026-10-13.md](../audit/AI-training-architecture-audit-2026-10-13.md) (findings G1–G13), re-checked against the baseline |
| Status | Priorities and remedies are **PROPOSED**. Where a risk restates a roadmap deliverable or gate, the roadmap line is cited (ROADMAP Lnnn) and that requirement is **roadmap text**, not a proposal |

## How to read this register

| Column | Values |
|---|---|
| **Status** | **CONFIRMED**: re-verified on `ea2b5d0` for this register. **NEEDS VERIFICATION**: plausible or reported, not proven here. **RESOLVED**: closed by evidence; kept for traceability |
| **Confidence** | High, Medium, Low |
| **Priority** | **P0**: blocks a release or dependent work. **P1**: required before the owning roadmap phase can pass its gate. **P2**: data, evaluation, specialisation. **P3**: advanced or scale work |
| **Owner** | The roadmap phase whose deliverables or gate cover the risk |
| Verification procedures | All read-only or local-only. None touches production, hosted databases, secrets or branch history unless the step says "authorized operator" |

## Summary

| ID | Area | Title | Owner | Status | Priority |
|---|---|---|---|---|---|
| R01 | Governance | Roadmap recovered; residual unverified provenance (B31–B34 quotes; B01–B04 Git evidence) | — | **Mostly RESOLVED**; residue NEEDS VERIFICATION | P2 |
| R02 | Governance | Knowledge-base registers stale, unmerged, and now superseded by the roadmap | — | CONFIRMED | P0 (process) |
| R03 | Database | Hosted Supabase migration state unverified (`0018`–`0027`) | B46 (§K DoD) | NEEDS VERIFICATION | P0 (release) |
| R04 | Database | `0026` and `0027` have no local Supabase acceptance receipt; CI skips that job | B41 (early), B38 | CONFIRMED | P0 (release) |
| R05 | AI | No AI output evaluation | **B43** ("evaluation before accepting provider-produced geometry or analysis", L361) | CONFIRMED | P1 (blocks enabling any model) |
| R06 | AI | Orchestrator hard-wired to one capability, schema and prompt | **B43** (vendor-neutral capability registry, L367) | CONFIRMED | P1 |
| R07 | AI | No provider spend ledger or budget; rate and circuit state per process | B32 (`ProviderCharge`, L160), B43 (explainable costs, L363) | CONFIRMED | P1 (blocks any metered provider) |
| R08 | AI | No consent or retention model for AI data capture; reference→AI path unbuilt | B33 (L178–179), B41 (L332), B43 (L362) | CONFIRMED | P1 |
| R09 | AI | AI provenance lacks prompt and schema version; AI outputs are not graph nodes | B37 (L248), B43 (L361) | CONFIRMED | P1 |
| R10 | AI | Prompt-injection input filter is a regex blocklist | B31 (L145), B41 | CONFIRMED | P1 |
| R11 | Geometry | ≤ 2-storey generation, BIM, scene and systems | B35 (L213–214), B40 (L300), B45 (L399) | CONFIRMED | P2 (ownership decision now) |
| R12 | Engineering | No validated solvers or sourced standards; research queue empty | B35–B37; preserved by A4 (L50) | CONFIRMED | Ongoing boundary |
| R13 | Cost | Rates are synthetic or user-supplied only | B15 (L77), B39 Budget (L291) | CONFIRMED | P2 |
| R14 | Performance | Dependency-graph read fan-out; the cap is unmerged | B37 | CONFIRMED (code); load NEEDS VERIFICATION | P1 |
| R15 | Governance | Duplicate Phase 36 label; Phase 38/40 conflicts | — | **RESOLVED** by roadmap §C | — |
| R16 | Contracts | Workflow capability registry marks shipped outputs `PLANNED` | B16 audit (§D row 16), B29, B39 | CONFIRMED (code); intent NEEDS VERIFICATION | P1 |
| R17 | Maintainability | Four separate deterministic NL grammars | B41 | CONFIRMED | P2 |
| R18 | Compute | B36 roadmap gate not met (no solver kinds, remote, fan-out, cache, sweeper) | **B36** | CONFIRMED | P1 |
| R19 | Review | Several merges lack independent human review | all | CONFIRMED (per merge messages) | P1 |
| R20 | Evidence | B31–B38 untagged (§K DoD requires a phase tag); B37/B38 have no report document; test counts not read from logs | all | CONFIRMED | P1 |
| R21 | Frontend | Backend–frontend contract verification not performed | B45, B46 | CONFIRMED | P1 |
| R22 | Process | Session branch `main` has history unrelated to the default branch | — | CONFIRMED | P0 (process) |
| R23 | Roadmap gate | **B37 Unified Project Manifest v2 and invalidation vocabulary missing**; B39's gate depends on them | **B37** | CONFIRMED | **P0 for B39** |
| R24 | Roadmap gate | B38 deliverables partial (sections/elevations, PDF/DXF, layers/dimensions) | B38 | CONFIRMED | P2 |
| R25 | Security | B31 requires malware scanning and quarantine; the scan is `NOT_PERFORMED` | **B31** | CONFIRMED | P1 (before production uploads, S3) |
| R26 | Reliability | B32 gate (kill/restart worker, budget, SSE or polling) only partly met; no background sweeper | **B32**, B36 | CONFIRMED | P1 (before production jobs, S4) |
| R27 | Sequencing | B41 conversational work delivered before B39/B40 under the old number "36" | B41 | CONFIRMED | P2 |
| R28 | Definition of Done | No staging proof of a live user workflow for any phase B29+ (§K L788) | all; B46 | CONFIRMED | P0 (release) |

---

## Governance and evidence

### R01: Roadmap recovered; residual unverified provenance

- **Evidence.**
  - The owner supplied the roadmap on 2026-10-13. It is stored verbatim at `docs/sources/…Frontend_Optimized.md` (sha256 `0ebc4479…3a03`).
  - It corroborates `docs/phase36/phase36-handoff.md` §1/§9 and `docs/phase30/phase30-report.md` §K (reconciliation §2.2).
  - **Residue:** the italic "Roadmap mapping" quotes in `docs/phase31–34/*-design.md` do not occur in it (0 string hits). B01–B04 have no commits or tags.
- **Confidence:** High.
- **Impact:** Phase identity and gates for B29–B46 are now known. Only the provenance of those four quotes and the Git evidence for B01–B04 remain open.
- **Status:** mostly RESOLVED. The residue NEEDS VERIFICATION.
- **Priority:** P2.
- **Dependencies:** owner.
- **Safe verification:**
  1. The owner states which text the B31–B34 sessions quoted, or confirms that the stored copy supersedes it.
  2. Record the B01–B04 evidence as "reported by roadmap" only.

### R02: Knowledge-base registers stale, unmerged, and now superseded

- **Evidence.**
  - `docs/roadmap-research-baseline` @ `56764c5` has no PR and is unmerged.
  - Its registers describe `5476f41`.
  - Its reconstructed phase index conflicts with the authoritative roadmap for B32 (label), B38, B40 and B41–B45.
- **Confidence:** High.
- **Impact:** Agents following that branch's "read first" rule would plan against a superseded index.
- **Status:** CONFIRMED.
- **Priority:** P0 (process).
- **Dependencies:** owner decision.
- **Safe verification:** a docs-only update on that branch that points to the authoritative roadmap and this register, or closure of the branch. No deletion without explicit instruction.

### R15: Duplicate Phase 36 label; Phase 38 and Phase 40 conflicts — RESOLVED

- **Evidence:** ROADMAP §C (L430–455) maps the original 40-phase numbering to the 46-phase plan:

  | Old (40-phase) | New (46-phase) |
  |---|---|
  | 36 Conversational AI Expansion | **B41** |
  | 38 Intelligent API & Model Routing Expansion | **B43** |
  | 40 End-to-End System Benchmark & Verification | **B46** |

  The owner's 2026-10-12 labels "Phase 36 Conversational AI" and "Phase 38 provider routing" used the old numbers. B36 = Cloud Engineering Compute Gateway; B38 = Construction Documentation & Engineering Evidence; B40 = Autonomous Large-Scale Project Integration.
- **Confidence:** High.
- **Status:** RESOLVED. Nothing in code, migrations or paths is renamed. Documents relabel the conversational work as "early partial B41".
- **Residual:** see R27 (sequencing).

### R19: Several merges lack independent human review

- **Evidence.**
  - PR #13's merge message: "The conversational feature has no independent human review".
  - PR #7's merge message: approval was recorded on `3717a80`, not on the merged head.
  - PRs #14 and #15 cite owner authorization only.
- **Confidence:** Medium. Reviews outside GitHub are unknown.
- **Impact:** Defects in AI-adjacent and evidence code may be unreviewed.
- **Status:** CONFIRMED (per commit messages).
- **Priority:** P1.
- **Dependencies:** a reviewer.
- **Safe verification:** a review of `24e9535`, `2ef4796` and `ea2b5d0` diffs. Read-only; could be part of the release-slice S0 source-truth audit (ROADMAP L721).

### R20: Phases 31–38 untagged; Phases 37 and 38 have no report document; test counts not read from logs

- **Evidence.**
  - Tags stop at `backend-v1-phase30-complete`.
  - Only `phase37-scope.md` and `phase38-scope.md` exist.
  - "2951 tests" appears only in the merge message.
- **Confidence:** High.
- **Impact:** Weaker release traceability.
- **Status:** CONFIRMED.
- **Priority:** P1.
- **Dependencies:** owner (tagging).
- **Safe verification:** download the job logs of run 38427505317 (read-only) and record the Vitest summary. Tagging needs owner authorization.

### R22: Session branch `main` has history unrelated to the default branch

- **Evidence:** `git merge-base origin/main origin/phase31/development` returns nothing (roots `dd6e469` and `6670abe`).
- **Confidence:** High.
- **Impact:**
  - Work committed to `main` cannot be PR'd into the default branch.
  - Agents told to "develop on `main`" start from a near-empty tree.
- **Status:** CONFIRMED.
- **Priority:** P0 (process).
- **Dependencies:** owner.
- **Safe verification:** every phase prompt names `phase31/development` as base and verifies ancestry. The owner decides whether `main` should become an alias of the default branch. No history rewrite without explicit instruction.

---

## Database and release

### R03: Hosted Supabase migration state unverified (`0018`–`0027`)

- **Evidence.**
  - B31–B33 reports say hosted is at `0017`.
  - The Phase 37 and 38 merge messages repeat: "hosted migrations 0018-0027 remain unverified".
  - This inspection made no hosted contact.
- **Confidence:** Medium. The hosted state itself is unknown.
- **Impact:** Deploying `ea2b5d0` against an older schema would fail requests or corrupt write paths.
- **Status:** NEEDS VERIFICATION.
- **Priority:** P0 for any deployment; not a blocker for local development.
- **Dependencies:** an authorized operator.
- **Safe verification:**
  1. An authorized operator runs a read-only `supabase migration list` (or reads `supabase_migrations.schema_migrations`) against hosted.
  2. Record the result without exposing connection strings.
  3. No `db push` without separate authorization.

### R04: `0026` and `0027` lack any local Supabase acceptance receipt; CI skips that job

- **Evidence.**
  - The newest receipt is `docs/phase16-evidence/supabase-2026-10-13T06-05-42.817Z.json` (06:05Z). `0026` merged 12:41Z and `0027` 16:04Z.
  - `docs/phase36-conversational-ai/phase36-report.md` §5 says acceptance was not completed (Docker Hub 429).
  - The CI `supabase-acceptance` job was skipped on `ea2b5d0`.
- **Confidence:** High.
- **Impact:** RLS, grants and PostgREST exposure of the conversation-turn function and the evidence-package table/RPCs are unproven through real JWTs. Embedded-Postgres migration replay did pass in CI.
- **Status:** CONFIRMED.
- **Priority:** P0 (release).
- **Dependencies:** a GitHub Actions `workflow_dispatch` run (disposable local stack only).
- **Safe verification:** trigger `Backend CI` via `workflow_dispatch` on `phase31/development` and attach the receipt. It touches no hosted resource.

---

## AI

### R05: No AI output evaluation (no golden set, metrics or gate)

- **Evidence.**
  - `apps/api/tests/ai-*.test.ts` use fixture adapters or local stub servers.
  - `scripts/benchmark-ai-orchestration.ts` measures overhead only.
  - The repository contains no dataset or evaluation script.
- **Confidence:** High.
- **Impact:** Any real model could degrade intent extraction undetected. There is no basis for choosing a provider or for fine-tuning.
- **Status:** CONFIRMED.
- **Priority:** P1. It must exist before any provider is enabled by default.
- **Dependencies:** none.
- **Owner (roadmap):** B43, which requires "evaluation before accepting provider-produced geometry or analysis" (L361).
- **Safe verification:** an offline golden evaluation over recorded responses, with no network in CI. Planned as B43 groundwork in [next-phase-readiness.md](next-phase-readiness.md) §6. Not part of the B37/B39 next step.

### R06: Orchestrator hard-wired to one capability, schema and prompt

- **Evidence.**
  - `apps/api/src/ai/orchestration/orchestrator.ts:68`: `ConversationIntentSchema.safeParse`.
  - `apps/api/src/ai/orchestration/conversation.ts:35`: `INTENT_SYSTEM_PROMPT` is embedded.
  - `conversation.ts:46`: the capability is fixed to `ARCHITECTURAL_INTENT_EXTRACTION`.
  - `apps/api/src/ai/orchestration/registry.ts:3`: 10 of 11 capabilities are `PLANNED`.
- **Confidence:** High.
- **Impact:** Each B41/B43 model-backed capability would fork routing or bypass the privacy and budget controls. B39 specialists reuse deterministic engines (L292) and do not need this to start.
- **Status:** CONFIRMED.
- **Priority:** P1.
- **Dependencies:** B43 (vendor-neutral capability registry, L367).
- **Safe verification:** a refactor behind the existing interface. The existing `ai-*`, `conversations*` and `conversation-turns*` tests must pass unchanged.

### R07: No provider spend ledger or budget ceiling; rate and circuit state per process

- **Evidence.**
  - `estimatedCostUsd` is computed but not persisted (`orchestrator.ts:72-73`).
  - `allowMetered` defaults to `false` (`contracts/ai-orchestration.ts`).
  - Health and rate-per-minute live in an in-memory `Map` (`orchestrator.ts:11`).
- **Confidence:** High.
- **Impact:**
  - Safe today, because metered calls are refused by default.
  - With a metered provider: unbounded spend per owner, and limits multiply with the number of instances.
- **Status:** CONFIRMED.
- **Priority:** P1. Blocks enabling any metered provider; does not block local or free-tier work.
- **Dependencies:** owner budget policy (unit, ceilings, approver).
- **Safe verification:** a design review. A persisted ledger would need a migration (see the readiness document's §5). Enforcement is tested with fixture adapters.

### R08: Privacy — no consent or retention model for AI data capture; reference→AI path unbuilt

- **Evidence.**
  - Default `privacyClass: LOCAL_ONLY`.
  - Remote endpoints must be allow-listed (`transport.ts:14-20`).
  - The orchestrator retains no prompts (`orchestrator.ts:8` comment).
  - References are never sent to any AI (`docs/phase31/phase31-design.md:24`).
  - No consent field for evaluation or training capture exists.
- **Confidence:** High.
- **Impact:**
  - User text and reference content must not reach remote providers or datasets without an explicit policy.
  - Capturing data for evaluation or training is currently impossible, which is correct until a policy exists.
- **Status:** CONFIRMED.
- **Priority:** P1.
- **Dependencies:** owner privacy policy.
- **Safe verification:** tests that a `LOCAL_ONLY` request never reaches a remote adapter (existing coverage: `apps/api/tests/ai-orchestration.test.ts:37`, "never contacts remote when system or request is LOCAL_ONLY"). New capabilities declare a privacy floor that is enforced before routing.

### R09: AI provenance lacks prompt and schema version; AI outputs are not graph nodes

- **Evidence.**
  - `AiProvenanceSchema` (`contracts/ai-orchestration.ts`) has provider, model, attempts and usage, but no prompt ID or hash.
  - Provenance is stored in conversation state (`conversation-planner.ts:196-197`).
  - The Phase 37 node families exclude conversations (`phase37-scope.md` A1).
- **Confidence:** High.
- **Impact:** It is impossible to reproduce which prompt produced which proposal, and to propagate staleness when a prompt changes.
- **Status:** CONFIRMED.
- **Priority:** P1.
- **Dependencies:** R06.
- **Safe verification:** additive optional fields. Old stored states must still parse (backward-compatibility test).

### R10: Prompt-injection input filter is a regex blocklist

- **Evidence.**
  - `assertSafeConversationText` (`ai/conversation-planner.ts:16-18`).
  - Structural defences: closed output schema, `supportsTools: false` literal, provider `tool_calls` rejected (`transport.ts:26`), the model cannot approve or generate geometry.
- **Confidence:** High.
- **Impact:** Low today. High once reference or document content is passed to models (Phases 39/41).
- **Status:** CONFIRMED.
- **Priority:** P1.
- **Dependencies:** R06.
- **Safe verification:** an injection corpus in the golden set. Expected result: 0 out-of-schema fields, 0 approvals, 0 tool calls.

---

## Geometry, engineering and cost (existing limits to preserve)

### R11: ≤ 2-storey generation, BIM, scene and systems

- **Evidence.**
  - `packages/generator/src/blueprint/input.ts:7` `maxFloors: 2`.
  - `packages/shared/src/building-v2/parametric.ts:12`.
  - Scene: `SCENE_UNSUPPORTED_MODEL` above the BIM profile.
  - The roadmap places large and multi-storey work in B35 ("multi-storey/large-site model partitioning", L213), B40 ("Autonomous Large-Scale Project Integration", L300) and B45 (large-scene delivery, L399). **No roadmap line explicitly assigns a generator for more than 2 floors.** That assignment is UNVERIFIED and remains an owner decision.
- **Confidence:** High.
- **Impact:** Large and multi-storey product goals are unreachable, but the limits fail closed (correct behaviour).
- **Status:** CONFIRMED.
- **Priority:** P2 for implementation; the roadmap ownership decision is needed now.
- **Dependencies:** owner.
- **Safe verification:** the limits are covered by existing tests. Do not relax them without a dedicated phase.

### R12: No validated solvers or sourced standards; research queue empty

- **Evidence.**
  - `apps/api/src/engineering/sources.ts`: `NOT_VERIFIED`, `IDENTIFICATION_ONLY`, no edition.
  - Phase 35 blockers `REQUIRES_SOLVER`, `NO_VALIDATED_SOLVER`, `NOT_IMPLEMENTED`.
  - The Phase 24 solver is checked against closed-form cases only.
  - Research framework RCH-001…RCH-012 are `NOT_RESEARCHED`.
- **Confidence:** High.
- **Impact:** No output is engineering-valid or compliance-valid, and none claims to be. The risk lies in any future change that weakens these labels.
- **Status:** CONFIRMED.
- **Priority:** an ongoing boundary.
- **Dependencies:** the research and source-verification task (separate, owner-authorized).
- **Safe verification:** existing tests pin the blockers and claims. Every new AI capability must leave them unchanged (readiness acceptance criterion A9).

### R13: Rates are synthetic or user-supplied only

- **Evidence.**
  - `supabase/seed.sql`: "DEMONSTRATION DATA ONLY".
  - `packages/boq-cost/src/demo.ts`: `SYNTHETIC — NOT CURRENT MARKET DATA`.
  - Rate-book source kinds are `SYNTHETIC` or `USER_SUPPLIED`.
- **Confidence:** High.
- **Impact:** No real-world cost estimate. Labels prevent misrepresentation.
- **Status:** CONFIRMED.
- **Priority:** P2.
- **Dependencies:** RCH-009 sources with geography and date.
- **Safe verification:** keep the labels. Never present a rate as "live" without a verified dated source.

---

## Performance, contracts and maintainability

### R14: Phase 37 graph read fan-out; the cap is unmerged

- **Evidence:** `origin/phase37/read-cap` @ `0bf1c89` (unmerged). Its message reports "about 150 owner-scoped reads at once" per graph request on the baseline, capped at 8 by the fix, with a test.
- **Confidence:** High for the code. Medium for the real-world impact.
- **Impact:** Database load spikes under the ordinary read rate limit. Phase 38 evidence packages call the graph.
- **Status:** the code path is CONFIRMED. The load impact NEEDS VERIFICATION.
- **Priority:** P1.
- **Dependencies:** owner review and merge authorization.
- **Safe verification:** run that branch's CI (PR from `phase37/read-cap`). Merge only with authorization.

### R16: Workflow capability registry marks shipped outputs `PLANNED`

- **Evidence:** `apps/api/src/workflows/registry.ts:31,34` mark `SCENE_3D` and `PROFESSIONAL_2D` `PLANNED`, although Phase 29 GLB and Phase 38 SVG sheets exist. Discovery lists those separately (`services/overview-service.ts`).
- **Confidence:** Medium. The status may deliberately mean "not a workflow step" (modernization report R01-G2).
- **Impact:** The frontend may hide working features.
- **Status:** the code is CONFIRMED. The intent NEEDS VERIFICATION.
- **Priority:** P1.
- **Dependencies:** none.
- **Safe verification:** read the discovery contract semantics and document "workflow status" versus "service status". Any change needs the route catalog and OpenAPI drift tests.

### R17: Four separate deterministic NL grammars

- **Evidence:** `ai/fallback-parser.ts`, `ai/conversation-planner.ts` (`parseConversation`), `conversation/interpret.ts`, `revision/interpret.ts`.
- **Confidence:** High.
- **Impact:** The same brief can be understood differently by different endpoints.
- **Status:** CONFIRMED.
- **Priority:** P2.
- **Dependencies:** a golden set first, to pin behaviour.
- **Safe verification:** consolidate only behind byte-identical golden outputs.

### R18: B36 roadmap gate not met (no solver kinds, remote placement, fan-out/fan-in, content-addressed cache or sweeper)

- **Evidence.**
  - `apps/api/src/compute/contracts.ts`: `remoteExecution: z.literal('DISABLED')`, cost `FREE`/0, eligible kinds `SCENE_COMPILE` and `OPTIMIZATION_STUDY` only.
  - KB roadmap §4.3 D1–D7 and G7, G8, G12.
- **Confidence:** High.
- **Impact:**
  - The B36 gate (ROADMAP L242: "large solver workloads … validated numerical/engineering output contracts, capped cost, abort/recovery") is unmet.
  - Remote AI providers (B43) and solver offload cannot run.
  - The B39 Structural specialist must return typed `requires_review` or `unsupported` results until this is done.
- **Status:** CONFIRMED.
- **Priority:** P1. Required before the B36 gate and B43. Not required for a B39 slice that uses typed statuses.
- **Dependencies:** owner decisions D1–D7.
- **Safe verification:** keep the startup fail-closed test for any attempt to enable remote execution.

### R21: Backend–frontend contract verification not performed

- **Evidence.**
  - The frontend repository is not in this session's scope.
  - Phase 30 frontend integration verification is deferred by the owner (r1 constraint 10).
  - The route catalog has 146 routes (`docs/modernization/api-routes.json`).
- **Confidence:** High.
- **Impact:** Unknown frontend assumptions, for example about AI capability status and polling vs push.
- **Status:** CONFIRMED (not done).
- **Priority:** P1, before frontend integration of B39 outputs.
- **Dependencies:** frontend repository access, owner.
- **Safe verification:** a read-only comparison of the frontend API client against `docs/modernization/openapi.json`.

---

### R23: B37 Unified Project Manifest v2 and invalidation vocabulary missing; B39's gate depends on them

- **Evidence.**
  - ROADMAP B37 (L250–261) requires an artifact dependency graph, invalidation states `current, stale, pending, blocked, not_applicable, verified`, and a "Unified Project Manifest v2".
  - The baseline has a read-only `dependency-graph-v1` with states `CURRENT`, `STALE_SOURCE_CHANGED`, `STALE_UPSTREAM_STALE` and `UNVERIFIED` (`apps/api/src/contracts/dependency-graph.ts:8-9`), and `project-overview-v1` (`services/overview-service.ts:54`). No manifest v2 exists.
  - ROADMAP B39 gate (L297): "feed resulting changes to shared **B37 manifest**".
  - §I rule 4 (L736).
- **Confidence:** High.
- **Impact:** B39 cannot pass its gate. Specialist outputs would have no single revision-pinned manifest in which to report freshness, which risks mixed-revision views (roadmap scenario 17, L747).
- **Status:** CONFIRMED.
- **Priority:** **P0 for B39.**
- **Dependencies:** none blocking. Merging `phase37/read-cap` (R14) is advisable first.
- **Safe verification:** a B37 completion slice. Manifest v2 is derived on read (no migration expected; PROPOSED), with a documented mapping from implemented states to roadmap states. The existing `dependency-graph*`, `overview*` and `modernization` drift tests must pass unchanged.

### R24: B38 deliverables partial

- **Evidence.** ROADMAP B38 (L270–278) lists section/elevation drawings, PDF/SVG/DXF/IFC "where supported", layers, dimension primitives and scale. The baseline provides:
  - SVG plans, schedules and evidence packages;
  - PDF/DXF explicitly `NO_PDF_WRITER` / `NO_VALIDATED_DXF_WRITER`;
  - no sections, elevations or dimensions (`docs/phase38/phase38-scope.md` §4, §6).
- **Confidence:** High.
- **Impact:** Frontend F33/F34/F39 tooling is limited. The B38 gate is met for the formats that are supported.
- **Status:** CONFIRMED.
- **Priority:** P2.
- **Dependencies:** an owner decision on a PDF/DXF dependency (licence, validator).
- **Safe verification:** the existing `documents*` tests. Any new writer needs an independent validator.

### R25: B31 requires malware scanning and quarantine; the scan is `NOT_PERFORMED`

- **Evidence.**
  - ROADMAP B31 (L145, L146, L152): "malware scanning/quarantine", state `quarantined`, "malicious/mislabeled/oversized files are quarantined".
  - `apps/api/src/references/contracts.ts:59`: `malwareScan: {status: 'NOT_PERFORMED', reason: 'NO_SCANNER_CONFIGURED'}`.
  - Claims `malwareFree: 'NOT_CLAIMED'`.
  - Structurally invalid files are refused, not quarantined.
- **Confidence:** High.
- **Impact:** Production uploads (release slice S3) are not roadmap-complete. The disclosure is honest.
- **Status:** CONFIRMED.
- **Priority:** P1 before production uploads.
- **Dependencies:** an owner choice of scanner (a self-hostable open-source option keeps cost low; licence and resources to be verified).
- **Safe verification:** a local scanner in CI with an EICAR-style test fixture. No production change.

### R26: B32 gate only partly met; no background sweeper

- **Evidence.**
  - ROADMAP B32 (L160–168): `ProviderCharge`, SSE or tested polling, worker kill/restart recovery, budget enforcement.
  - The baseline has leases, fencing, retries, polling and owner-read recovery. The background sweeper was deferred to B36 (`docs/phase32/phase32-design.md` §12). There is no `ProviderCharge`.
- **Confidence:** High.
- **Impact:** A job orphaned while its owner is offline is recovered only on the next owner read.
- **Status:** CONFIRMED.
- **Priority:** P1 before production jobs (S4).
- **Dependencies:** B36 decision D2 (non-user execution identity).
- **Safe verification:** a kill/restart integration test on embedded Postgres (local).

### R27: B41 delivered before B39/B40 under the old number "36"

- **Evidence.** `24e9535` and `0026_conversation_turns.sql` implement turn classification, memory and confirmed actions. ROADMAP §I places B41 in S7 after B39/B40 (L728). §C L448 maps old 36 → B41.
- **Confidence:** High.
- **Impact:** When B39 specialists and B40 agents exist, B41's typed actions (`OPERATION_KINDS`) will need extension. Labels in documents differ from the roadmap.
- **Status:** CONFIRMED.
- **Priority:** P2.
- **Dependencies:** B39.
- **Safe verification:** keep the existing `conversation-turns*` tests as a regression net. No renames.

### R28: No staging proof of a live user workflow (roadmap Definition of Done)

- **Evidence.**
  - ROADMAP §K (L788): every phase needs "staging proof of at least one live user workflow … phase tag and clean checked baseline".
  - There is no staging or deployment evidence in `docs/**`.
  - No tags exist for B31–B38.
- **Confidence:** High.
- **Impact:** Under the roadmap's own Definition of Done, no phase from B29 onward is done.
- **Status:** CONFIRMED.
- **Priority:** P0 for any release claim.
- **Dependencies:** R03, R04; an owner-authorized staging environment.
- **Safe verification:** an authorized operator deploys to a disposable staging project (never production) and records one live workflow per phase. Tags only with owner authorization.

## Explicit tracking matrix (requested areas)

| Area | Register IDs | Current safeguard (VERIFIED) | Gap |
|---|---|---|---|
| AI output evaluation | R05, R17 | Schema validation and deterministic fallback | No quality measurement |
| Provider spending controls | R07, R18 | `allowMetered:false`; RPM and concurrency caps; compute cost literal `FREE` | No ledger or budget; per-process state |
| Privacy | R08, R10 | `LOCAL_ONLY` default; host allow-list; no prompt retention; references not sent to AI | No consent or retention model; no untrusted-content envelope |
| Provenance | R09, R20 | `AiProvenance` in conversation state; Phase 37 hashes; Phase 38 signed packages | No prompt version or hash; AI outputs not graph nodes |
| Hosted DB migrations | R03, R04 | Migration replay on embedded Postgres in CI | Hosted state unknown; `0026`/`0027` not run through local Supabase |
| Geometry and engineering limits | R11, R12, R13 | Fail-closed limits, typed blockers, `NOT_CLAIMED` claims | Scale and validation are intentionally absent; must not be weakened |

## Revision log

- **r1 (`4fb5919`):** R01–R22, written before the roadmap was available.
- **r2 (this revision):**
  - Every risk is tied to its owning roadmap phase.
  - R01 is mostly resolved (roadmap recovered); R15 is resolved by §C numbering.
  - R05 and R06 are re-mapped from "Phase 39" to **B43**. R11's "no phase owns" claim is narrowed.
  - R18 is re-framed against the B36 gate.
  - R23–R28 are added, from the roadmap's B31, B32, B37, B38, B41 and §K requirements.

## r3 addendum: after PR #16 (`phase31/development` @ `d0cd38b`)

PR #16 (merge `d0cd38b`, labelled "Phase 39") delivered **B43 groundwork** (capability-typed routing), **B41/B43 groundwork** (brief-field and reference-metadata use) and **partial, advisory Interior/Exterior concepts that B39 may reuse**, with migration `0028`. **B39 remains NI.** See [phase39-scope.md §0](../phase39/phase39-scope.md#0-classification-under-the-authoritative-roadmap-correction-r2).

### Changes to existing risks

The r2 rows above are kept as written. Their current state:

| Risk | r3 status (VERIFIED at `d0cd38b` unless noted) |
|---|---|
| R03 | The range is now `0018`–`0028`. The hosted state is still unverified |
| R04 | Now `0026`, `0027` **and `0028`** lack a local Supabase acceptance receipt. `supabase-acceptance` was skipped in CI runs 38434523761 and 38436385119 |
| R05 | **Open.** No golden set or evaluation. All PR #16 provider tests use deterministic test doubles. No live model has been exercised |
| R06 | **Partly mitigated, still B43.** The orchestrator now runs capability-typed tasks (instructions, bounded data, validator) and intent extraction is a wrapper. Still missing: a descriptor registry, versioned or hashed prompts, per-capability privacy floors, budget classes |
| R07 | **Partly mitigated for one feature.** Design-concept sets have replay-based charge protection, single flight and a per-owner SQL quota of 50 provider sets per 24 hours. There is no general spend ledger, budget or cross-process limit |
| R08 | **Open.** Concepts use reference **metadata only** and withhold the address and budget, but there is no consent or retention model |
| R09 | **Open.** Concept sets record provider, model, guard and template versions but no prompt hash, and are not dependency-graph or manifest nodes |
| R16 | **Unchanged.** Workflow `INTERIOR_DESIGN` / `EXTERIOR_DESIGN` are still `PLANNED`. The new concept capabilities are separate AI capabilities |
| R23 | **Unchanged: P0 for B39.** No manifest v2 exists |

### New risks

| ID | Area | Risk | Owner | Status | Priority |
|---|---|---|---|---|---|
| R29 | Governance | Work merged under the label "Phase 39" is B43/B41 groundwork plus a partial advisory precursor. Code comments, test names and the `0028` header still say "Phase 39" (left unchanged: documentation-only correction; no history relabelling) | Docs (this addendum); owner decision D-6 | CONFIRMED | P1 (until D-6) |
| R30 | Contracts | Discovery lists `INTERIOR_DESIGN_CONCEPT` / `EXTERIOR_DESIGN_CONCEPT` as `AVAILABLE` (`advisory: true`). A client could mistake them for the B39 F49/F50 modules (ROADMAP L669–670) | Docs guidance now; optional runtime change D-7 (proposed, not implemented) | CONFIRMED (code) | P2 |

## r4 addendum: audit-B repairs (`fix/audit-b-repairs`, PR #35, 2026-10-19)

Evidence is local only: embedded PostgreSQL 18 and a local Supabase CLI stack (Postgres 17.6, GoTrue, PostgREST 16.3, real JWTs). **Nothing here
says anything about a hosted database.** The full record is `docs/BACKEND_REPAIR_LOG.md` on `main`.

| Risk | r4 status |
|---|---|
| R03 | **Still NEEDS VERIFICATION, and wider:** the range is now `0018`–`0033`. No hosted ledger was read. Forward-only: `0031`–`0033` add to, and never edit, earlier migrations; `supabase/migrations.sha256` and its test detect an in-place edit; `0031`–`0033` were applied to a populated `0030` database in a test (rows unchanged) |
| R04 | **Locally RESOLVED; CI unchanged.** Live receipts on `0001`–`0033` now also cover every route family audit B (INT-B-024) found with no live call: B31 references, B33 settings and library, B34 verification, B37 graph and manifest, B38 documents and evidence, B40 integration, B41 instructions, B42 feasibility, B43 routing, B44 collaboration, B45 delivery and compatibility, and conversation turns (`docs/phase16-evidence/supabase-2026-10-19T*.json`). `supabase-acceptance` still runs only on `workflow_dispatch` (owner) |
| R26 | **Unchanged.** No background sweeper (DEBT-003) |
| R28 | **Unchanged.** No staging environment (SHOW-001) |

