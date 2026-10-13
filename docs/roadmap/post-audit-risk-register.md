# NekoArch Post-Audit Risk Register

| Field | Value |
|---|---|
| Date of inspection | 2026-10-13 |
| Baseline | `phase31/development` @ `ea2b5d0c0533e7e3f682b42a029fef7c0b3f5359` |
| Inputs | [../audit/AI-training-architecture-audit-2026-10-13.md](../audit/AI-training-architecture-audit-2026-10-13.md) (findings G1–G13), re-checked against the baseline; [authoritative-roadmap-reconciliation.md](authoritative-roadmap-reconciliation.md) |
| Status | Every priority and remedy here is **PROPOSED**. None is an original roadmap acceptance criterion |

## How to read this register

| Column | Values |
|---|---|
| **Status** | **CONFIRMED**: re-verified on `ea2b5d0` for this register. **NEEDS VERIFICATION**: plausible or reported, not proven here |
| **Confidence** | High, Medium, Low |
| **Priority** | **P0**: blocks a release or dependent work. **P1**: required foundation before AI features ship. **P2**: data, evaluation and specialisation. **P3**: advanced or scale work |
| Verification procedures | All read-only or local-only. None touches production, hosted databases, secrets or branch history unless the step says "authorized operator" |

## Summary

| ID | Area | Title | Status | Priority |
|---|---|---|---|---|
| R01 | Governance | Original roadmap unrecoverable; Phases 39–46 acceptance criteria unknown | CONFIRMED | P0 |
| R02 | Governance | Knowledge-base registers stale and unmerged | CONFIRMED | P0 |
| R03 | Database | Hosted Supabase migration state unverified (`0018`–`0027`) | NEEDS VERIFICATION | P0 (release) |
| R04 | Database | `0026` and `0027` lack any local Supabase acceptance receipt; CI skips that job | CONFIRMED | P0 (release) |
| R05 | AI | No AI output evaluation (no golden set, metrics or gate) | CONFIRMED | P1 (blocks enabling any model) |
| R06 | AI | Orchestrator hard-wired to one capability, schema and prompt | CONFIRMED | P1 |
| R07 | AI | No provider spend ledger or budget ceiling; rate and circuit state per process | CONFIRMED | P1 (blocks any metered provider) |
| R08 | AI | Privacy: no consent or retention model for AI data capture; reference→AI path unbuilt | CONFIRMED | P1 |
| R09 | AI | AI provenance lacks prompt and schema version; AI outputs are not graph nodes | CONFIRMED | P1 |
| R10 | AI | Prompt-injection input filter is a regex blocklist | CONFIRMED | P1 |
| R11 | Geometry | ≤ 2-storey generation, BIM, scene and systems; no phase owns a multi-storey generator | CONFIRMED | P2 (roadmap decision now) |
| R12 | Engineering | No validated solvers or sourced standards; research queue empty | CONFIRMED | Ongoing boundary |
| R13 | Cost | Rates are synthetic or user-supplied only | CONFIRMED | P2 |
| R14 | Performance | Phase 37 graph read fan-out; the cap is unmerged | CONFIRMED (code); load impact NEEDS VERIFICATION | P1 |
| R15 | Governance | Duplicate Phase 36 label; Phase 38 and Phase 40 conflicts | CONFIRMED | P0 (owner ruling) |
| R16 | Contracts | Workflow capability registry marks shipped outputs `PLANNED` | CONFIRMED (code); intent NEEDS VERIFICATION | P1 |
| R17 | Maintainability | Four separate deterministic NL grammars | CONFIRMED | P2 |
| R18 | Compute | Gateway later slices undecided (remote, sweeper, budgets, solver kinds) | CONFIRMED | P1 (before Phase 43) |
| R19 | Review | Several merges lack independent human review | CONFIRMED (per merge messages) | P1 |
| R20 | Evidence | Phases 31–38 untagged; Phases 37 and 38 have no report document; test counts not read from logs | CONFIRMED | P1 |
| R21 | Frontend | Backend–frontend contract verification not performed | CONFIRMED | P1 (before F-integration) |
| R22 | Process | Session branch `main` has history unrelated to the default branch | CONFIRMED | P0 (process) |

---

## Governance and evidence

### R01: Original roadmap unrecoverable; Phases 39–46 acceptance criteria unknown

- **Evidence.**
  - All 118 commits on 34 refs were searched; no original roadmap or `PLAN.md` exists.
  - `docs/phase36/phase36-handoff.md` §1 places it at `~/Downloads/` on the owner's machine.
  - See the reconciliation document, §2.
- **Confidence:** High.
- **Impact:** Phases 39–46 could be built against the wrong scope. A "complete" status for any phase cannot be measured against original criteria.
- **Status:** CONFIRMED.
- **Priority:** P0.
- **Dependencies:** owner.
- **Safe verification:**
  1. The owner commits the original file under `docs/sources/` with a sha256 checksum.
  2. Diff it against the reconciliation document's §3 and §5.
  3. Record the differences.

### R02: Knowledge-base registers stale and unmerged

- **Evidence.**
  - `docs/roadmap-research-baseline` @ `56764c5` has no PR and is unmerged.
  - Its `status-register.md` describes `5476f41`, reports a typecheck failure fixed by #11, and lists Phases 37–38 as not started.
- **Confidence:** High.
- **Impact:** Agents following the knowledge-base "read first" rule act on wrong state.
- **Status:** CONFIRMED.
- **Priority:** P0.
- **Dependencies:** owner decision on merge.
- **Safe verification:** `git diff origin/phase31/development...origin/docs/roadmap-research-baseline --stat` (docs-only), then a docs-only PR after owner approval.

### R15: Duplicate Phase 36 label; Phase 38 and Phase 40 conflicts

- **Evidence:**

  | Conflict | Sources |
  |---|---|
  | Phase 36 | `docs/phase36/` (gateway; roadmap condensed in handoff §1) vs `docs/phase36-conversational-ai/phase36-design.md:10` (owner brief 2026-10-12) |
  | Phase 38 | Handoff §9 "evidence packages and exports (B38)" vs owner brief "Phase 38 provider routing" |
  | Phase 40 | Owner draft r1 "audit and readiness review" vs handoff §9 "specialist AI workers (B39–43)" |

- **Confidence:** High that the conflicts exist. The resolution is UNRESOLVED.
- **Impact:** Phase numbering errors, and a Phase 39/40 sequencing error.
- **Status:** CONFIRMED.
- **Priority:** P0.
- **Dependencies:** owner.
- **Safe verification:** owner ruling recorded in a decisions register. No code or migration renames (PROPOSED).

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
- **Safe verification:** a review of `24e9535`, `2ef4796` and `ea2b5d0` diffs. Read-only; could be part of a Phase 40 audit.

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
- **Safe verification:** see [next-phase-readiness.md](next-phase-readiness.md) §4, workstream WS2. Offline golden evaluation over recorded responses; no network in CI.

### R06: Orchestrator hard-wired to one capability, schema and prompt

- **Evidence.**
  - `apps/api/src/ai/orchestration/orchestrator.ts:68`: `ConversationIntentSchema.safeParse`.
  - `apps/api/src/ai/orchestration/conversation.ts:35`: `INTENT_SYSTEM_PROMPT` is embedded.
  - `conversation.ts:46`: the capability is fixed to `ARCHITECTURAL_INTENT_EXTRACTION`.
  - `apps/api/src/ai/orchestration/registry.ts:3`: 10 of 11 capabilities are `PLANNED`.
- **Confidence:** High.
- **Impact:** Each Phase 39/41/43 module would fork routing or bypass the privacy and budget controls.
- **Status:** CONFIRMED.
- **Priority:** P1.
- **Dependencies:** Phase 39 scope approval.
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

### R11: ≤ 2-storey generation, BIM, scene and systems; no phase owns a multi-storey generator

- **Evidence.**
  - `packages/generator/src/blueprint/input.ts:7` `maxFloors: 2`.
  - `packages/shared/src/building-v2/parametric.ts:12`.
  - Scene: `SCENE_UNSUPPORTED_MODEL` above the BIM profile.
  - `docs/phase35-1/phase-1-46-reconciliation.md` §4: "no phase owns" it.
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

### R18: Gateway later slices undecided (remote, sweeper, budgets, solver kinds)

- **Evidence.**
  - `apps/api/src/compute/contracts.ts`: `remoteExecution: z.literal('DISABLED')`, cost `FREE`/0, eligible kinds `SCENE_COMPILE` and `OPTIMIZATION_STUDY` only.
  - KB roadmap §4.3 D1–D7 and G7, G8, G12.
- **Confidence:** High.
- **Impact:** Remote AI providers (Phase 43) and solver offload cannot run.
- **Status:** CONFIRMED.
- **Priority:** P1 before Phase 43.
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
- **Priority:** P1, before frontend integration of Phase 39 outputs.
- **Dependencies:** frontend repository access, owner.
- **Safe verification:** a read-only comparison of the frontend API client against `docs/modernization/openapi.json`.

---

## Explicit tracking matrix (requested areas)

| Area | Register IDs | Current safeguard (VERIFIED) | Gap |
|---|---|---|---|
| AI output evaluation | R05, R17 | Schema validation and deterministic fallback | No quality measurement |
| Provider spending controls | R07, R18 | `allowMetered:false`; RPM and concurrency caps; compute cost literal `FREE` | No ledger or budget; per-process state |
| Privacy | R08, R10 | `LOCAL_ONLY` default; host allow-list; no prompt retention; references not sent to AI | No consent or retention model; no untrusted-content envelope |
| Provenance | R09, R20 | `AiProvenance` in conversation state; Phase 37 hashes; Phase 38 signed packages | No prompt version or hash; AI outputs not graph nodes |
| Hosted DB migrations | R03, R04 | Migration replay on embedded Postgres in CI | Hosted state unknown; `0026`/`0027` not run through local Supabase |
| Geometry and engineering limits | R11, R12, R13 | Fail-closed limits, typed blockers, `NOT_CLAIMED` claims | Scale and validation are intentionally absent; must not be weakened |
