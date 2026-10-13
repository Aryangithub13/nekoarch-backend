> **Provenance.** This is the read-only AI audit delivered in session on 2026-10-13 against `phase31/development` @ `ea2b5d0`. It is committed with the post-audit reconciliation (`docs/roadmap/`) so later documents can cite it.
>
> **Erratum (2026-10-13 reconciliation).** Some line references in the delivered version were wrong. They had been read from a concatenated listing rather than from the individual files. Only the line numbers in the `apps/api/src/ai/**` and `workflows/registry.ts` references below have been corrected; the findings are unchanged. Corrected lines, with the original in brackets:
>
> | File | Corrected line | Original |
> |---|---|---|
> | `orchestrator.ts` | 68 | 189 |
> | `orchestrator.ts` | 32-91 | 153-211 |
> | `orchestrator.ts` | 18-91 | 139-212 |
> | `orchestrator.ts` | 63-69 | 184-190 |
> | `orchestrator.ts` | 72-73 | 193-194 |
> | `orchestrator.ts` | 8-16, 72 | 129-137, 193 |
> | `orchestrator.ts` | 8 | 129 |
> | `ai/orchestration/conversation.ts` | 35, 46 | 260, 271 |
> | `ai/orchestration/conversation.ts` | 20-40 | 245-266 |
> | `transport.ts` | 26 | 89 |
> | `conversation-planner.ts` | 16-18 | 17-19 |
> | `conversation-planner.ts` | 196-197 | 196-198 |
> | `workflows/registry.ts` | 31, 34 | 30-37 |

# NekoArch AI & Model-Training Architecture Audit (pre-Phase 39–46)

**Date:** 2026-10-13 · **Type:** read-only audit. No code, branch, migration, setting or database was changed. No implementation phase was started.
**Repository:** `Aryangithub13/nekoarch-backend`
**Audited commit:** `phase31/development` @ `ea2b5d0c0533e7e3f682b42a029fef7c0b3f5359`. This is the repository's default branch, and Phase 38 is merged into it.
**Labels used:**
- Evidence: **VERIFIED** (I inspected it), **REPORTED** (a repository document says it; I did not re-check it), **INFERENCE**, **PROPOSED**, **UNKNOWN**.
- Confidence: High, Medium, Low, Unknown.

---

## 0. Repository state (what was actually inspected)

| Item | Finding | Evidence | Conf. |
|---|---|---|---|
| Session checkout | Local `main` was at `dd6e469` ("Initial commit", README only). Working tree clean. `origin/main` = `cbe5c1e` (2 commits, audit docs only) | `git status`, `git log` | High |
| Default branch | **`phase31/development`**, not `main` (`git ls-remote --symref origin HEAD`). 112 commits | VERIFIED | High |
| How the audit read the code | `git archive origin/phase31/development` and `origin/docs/roadmap-research-baseline`, extracted to a scratch directory. Nothing in the repository was modified | — | High |
| Branches and tags | 34 remote branches. Release tags exist for Phases 5–30 only (`backend-v1-phaseNN-complete`) plus modernization tags. **No tags for Phases 31–38** | `git ls-remote` | High |
| Phases 35–38 on default | Merged by ancestry: B35 completion (PR #7 → `b6a3640`), gateway (PR #10 → `5476f41`), typecheck fix (#11), full-suite CI (#12), conversational AI renumbered to `0026` (#13 → `24e9535`), Phase 37 (#14 → `2ef4796`), Phase 38 (#15 → `ea2b5d0`). GitHub lists these PRs as `merged:false` with a `merged_at` value: they were integrated by manual merge commits whose messages cite owner authorization | `git log`; GitHub PR list | High |
| Migrations | `0001`–`0027` on default. `0027_evidence_packages.sql` is present and pinned in `supabase/tests/database.test.ts:89-93` | VERIFIED | High |
| CI on `ea2b5d0` | Push run 38427505317. Both `backend` jobs passed: Node 22.22.0 and 22.23.3, `npm audit`, build, typecheck, lint and `npx vitest run`. `container smoke` passed. **`supabase-acceptance` was skipped** (it runs on `workflow_dispatch` only) | GitHub Actions jobs API | High |
| Test counts | "102/102 files, 2951/2951 tests" | REPORTED in the `ea2b5d0` merge message, citing PR run 38425632545. I did not open the logs | Medium |
| Hosted Supabase | Believed to be at `0017`. **`0018`–`0027` are unverified on hosted.** Never contacted | REPORTED (B31–B33 reports; the merge messages repeat it) | Medium |
| Roadmap and registers | `docs/roadmap/*` and the research file exist **only** on the unmerged branch `docs/roadmap-research-baseline` @ `56764c5` (no PR). Its status register is **stale**: it still says Phase 36's typecheck fails, PR #7 is a draft, and Phases 37–38 are "not started" | VERIFIED | High |
| Phase 35 V2 research file | `docs/research/NekoArch_Phase35_Engineering_Research_Enhanced_v2_2026-10.md`. Added in `a644225`, last changed in `56764c5`, **not on the default branch**. It is a self-declared "RECONSTRUCTED RESEARCH FRAMEWORK — NOT THE ORIGINAL". It has 0 source records and 0 claim records, and RCH-001…RCH-012 are all `NOT_RESEARCHED` (§9, Addendum B) | VERIFIED | High |
| Phase 37 | `docs/phase37/phase37-scope.md`; `GET …/revisions/:revisionId/dependency-graph`; no migration. Tests: `dependency-graph.test.ts` and `dependency-graph.integration.test.ts` | VERIFIED (files, routes, CI) | High |
| Phase 38 | `docs/phase38/phase38-scope.md`. Adds SVG plan sheets, JSON/CSV schedules, a manifest, and signed immutable evidence packages (`0027`). PDF and DXF are explicitly **unsupported**. Tests: `documents.test.ts`, `documents.integration.test.ts`, `evidence.integration.test.ts` | VERIFIED (files, routes, CI) | High |
| "Phase 36" numbering | **Two different features** were merged under "Phase 36": the compute gateway (`docs/phase36/`) and conversational AI (`docs/phase36-conversational-ai/`) | VERIFIED | High |

Package identifiers remain `designflow` / `@designflow/*` (`package.json`). This audit proposes no rename.

---

## Section A — Executive verdict

**What AI infrastructure exists?** (High)
- **Phase 21 provider orchestration layer.** One adapter family, OpenAI-compatible chat completions, in two forms:
  - loopback-only local;
  - allow-listed HTTPS remote, with DNS pinning and blocked private IP ranges.
- **Routing controls:** priority routing, retries, exponential backoff, a circuit breaker, per-provider concurrency and requests-per-minute limits, privacy classes, metered models refused by default, strict JSON-schema validation of output, output-size caps, and a deterministic fallback.
- **Only one capability is enabled:** `ARCHITECTURAL_INTENT_EXTRACTION`. The other 10 enum values are `PLANNED` (`apps/api/src/ai/orchestration/registry.ts:3`).
- **The default configuration calls no model at all.** `AI_CONVERSATION_MODE=fallback`, `privacyClass: LOCAL_ONLY` and `allowMetered: false`, and every language path has a deterministic finite grammar.

**Is there a real training pipeline?** **No.** (High)
- There is no training, fine-tuning or embedding code.
- There are no ML dependencies. Runtime dependencies are Fastify, Supabase, Zod, decimal.js, Sentry and pino; the only Python is IFC verification and evidence scripts.
- There is no vector store: the only `create extension` is `pgcrypto`.
- There is no model registry, model artifacts or evaluation harness for model quality.

**Are there actual datasets?** **No training or evaluation datasets exist.** (High) What does exist, none of which is training data:
- Hand-authored **test fixtures**: `packages/shared/tests/fixtures/building-v2`, `packages/generator/tests/fixtures/blueprint`, `docs/phase23-evidence/fixtures`.
- **Synthetic demonstration** rate and knowledge data, explicitly labelled as such:
  - `supabase/seed.sql`: "DEMONSTRATION DATA ONLY … invented";
  - `packages/boq-cost/src/demo.ts`: `SYNTHETIC — NOT CURRENT MARKET DATA`;
  - `apps/api/src/knowledge/packs.ts`: `SYNTHETIC_DEMONSTRATION`.

**Can NekoArch generate validated blueprints, 3D models, BOQs and engineering outputs end to end?** Partially, within tight bounds. (High)

| Output | What exists |
|---|---|
| Blueprints | Deterministic generation from structured requirements, **≤ 2 floors and ≤ 24 rooms** (`packages/generator/src/blueprint/input.ts:7`), followed by independent QA, a signed immutable revision, and SVG plan sheets and schedules (Phase 38) |
| 3D | GLB (Phase 29), within the bounded BIM profile (≤ 2 storeys) |
| Quantities and BOQ | Deterministic takeoff → construction calculation → BOQ, priced **only** from user-supplied or synthetic rate books |
| Engineering | A bounded linear-static frame solver, verified against closed-form cases only. Wind, seismic, drift, soil, member design and lifts are typed **blockers** (`REQUIRES_SOLVER` / `NO_VALIDATED_SOLVER` / `NOT_IMPLEMENTED`) |
| Professional review | Nothing is professionally reviewed; software never assigns `professionally_reviewed` |
| Interior / exterior design | Capability contracts only (`PLANNED`), apart from Phase 30's exterior wall finish |

**The most important blockers:**
1. The Phase 39–46 scope is unrecovered or contradictory, and the knowledge-base registers are unmerged and stale.
2. Hosted database state is unverified (`0018`–`0027`).
3. The AI orchestrator is hard-wired to one schema and one prompt. It cannot host new AI modules without being generalized.
4. There is no AI evaluation harness or golden data, so nothing can measure whether a provider, prompt or fine-tune is good enough.
5. There is no generator above 2 floors, and no phase owns one.
6. There are no sourced rates or standards (research queue unfilled).

**Is the current architecture suitable?** **Yes, as a foundation.** (Medium–High)
- The decisive strength: there is **one canonical building representation**, Building Model V2 (integer millimetres, stable IDs, strict Zod). Blueprints, QA, takeoff, BOQ, BIM/IFC, GLB, plan sheets, analyses, the dependency graph and evidence packages all derive from the same immutable, hashed revision.
- AI output is confined to a closed intent schema that feeds deterministic engines. That is the right pattern for this product.
- What is missing is AI plumbing breadth (generic capabilities, evaluation, budgets) and scale (multi-storey generation). The core design does not need to be rethought.

---

## Section B — Verified architecture inventory

| Capability | Current implementation | Evidence | Status | Missing pieces |
|---|---|---|---|---|
| AI provider adapters | OpenAI-compatible chat completions. Local: `http://127.0.0.1` or `[::1]` only. Remote: HTTPS port 443 to allow-listed hosts, path `/v1/chat/completions`, IPv4 resolved once and pinned, private ranges blocked, no redirects, response size capped | `ai/orchestration/transport.ts`, `ai/conversation-provider.ts`, `ai/orchestration/conversation.ts:20-40`; tests `ai-transport.test.ts`, `ai-remote.test.ts` | Implemented; verified by fixture/local-server tests only | No live provider has ever been evaluated. No non-chat modalities (image, 3D, vision) |
| Routing and resilience | Priority order, capability and privacy filters, metered refusal, retries/backoff, circuit breaker with half-open probe, per-provider `maxConcurrent` and RPM, timeouts, caller cancellation, deterministic fallback | `ai/orchestration/orchestrator.ts:139-212`; `ai-orchestration*.test.ts` | Implemented and verified (unit/integration) | Health state is **process-local**, so it is not shared across instances. Routing is centralized, but **only for one capability** |
| Structured-output enforcement | `response_format: json_object`, `temperature: 0`, size cap, then `ConversationIntentSchema.safeParse`; on failure, `PROVIDER_SCHEMA_VIOLATION` and fallback | `orchestrator.ts:63-69` | Implemented and verified | The schema and prompt are **hard-coded** (`orchestrator.ts:68`; `conversation.ts:35`, `46`) |
| Cost tracking / budgets | `estimatedCostUsd` is computed per call when per-million prices are configured. `allowMetered` defaults to `false` | `orchestrator.ts:72-73`; `contracts/ai-orchestration.ts` | Partial | No persisted spend ledger, no per-owner or global budget ceiling, no AI-call quota beyond RPM |
| AI provenance | `AiProvenance` (provider, model, attempts, usage, routing reason, fallback) is stored in conversation state as `state.orchestration` | `ai/conversation-planner.ts:196-197` | Implemented | **No prompt/schema version or prompt hash** in provenance. Not linked to the Phase 37 graph |
| Brief interpretation (Phase 18) | `POST …/requirements/interpret`. Deterministic finite grammar (`fallback-parser.ts`, with English and some Hinglish tokens). Produces questions, assumptions, field provenance and unsupported-feature flags | `ai/architectural-interpreter.ts`, `routes/requirement-interpretation.ts:22`; `AI_INTERPRETER_MODE` ∈ {fallback, disabled} | Implemented and verified (deterministic) | A provider interface exists (`interpreter-provider.ts`), but **no model adapter is wired** |
| Conversational refinement (Phases 20/21 and conversational "36") | Regex planner, optionally via the LLM orchestrator. Proposals require explicit approval. Turns, decision memory and confirmed actions. Replies composed by deterministic rules ("no language model wrote this reply") | `ai/conversation-planner.ts`, `conversation/turns.ts:29-38`, migration `0026` | Implemented and verified | Four separate deterministic grammars: `fallback-parser.ts`, `conversation-planner.ts parseConversation`, `conversation/interpret.ts`, `revision/interpret.ts` (duplication) |
| Tool calling | **None, by design**: `supportsTools: z.literal(false)`; provider tool calls are rejected (`transport.ts:26`) | VERIFIED | Deliberately absent | — |
| Prompt-injection defence | Input regex blocklist (`assertSafeConversationText`). Structural confinement: closed output schema, no tools, no approval or geometry from the model | `conversation-planner.ts:16-18` | Partially implemented | The blocklist is weak alone. **Reference content is never passed to AI yet**, so that threat surface is still unbuilt |
| Reference ingestion (Phase 31) | PNG, JPEG, WebP and PDF; ≤ 10 MiB; custom structural inspector; metadata stripping; bounded PDF inflate; private storage; download tokens. Claims are all `NOT_CLAIMED` | `references/inspect.ts`, `references/contracts.ts:5-43`; `0021`, `0024` | Implemented and verified (tests, CI) | **No interpretation** of images or documents (AI use deferred to B39/B41) |
| Data ingestion / datasets | None for ML | Search: no ML code, dependencies or vector extension | Missing | Everything in Section D |
| Training / fine-tuning | None | Same | Missing | — |
| Evaluation of AI quality | None. `scripts/benchmark-ai-orchestration.ts` measures orchestration overhead with fixture adapters | VERIFIED | Missing | Golden set, metrics, gates |
| Canonical model | Building Model V2: integer mm; `x-right-y-up-z-depth`; stable string IDs; levels, spaces, walls, openings, stairs, plates, columns, dimensions, specifications; strict invariants | `packages/shared/src/building-v2/*`, README | Implemented and verified | Bounded entity set: no curved geometry, junction solids or MEP. Specifications are labels only |
| Blueprint generation | Deterministic, seeded. V1 procedural, Precision Blueprint, Solver V2 and Parametric. **≤ 2 floors** | `packages/generator/src/**`, `BLUEPRINT_LIMITS` | Implemented and verified | No multi-storey generator (unowned) |
| Blueprint QA | Independent QA package and rule engine; acceptance gate for persistence | `packages/blueprint-qa` | Implemented and verified | — |
| 2D documents | Phase 38 SVG plan sheets per level, schedules (JSON/CSV), manifest with content hashes; fail-closed provenance | `apps/api/src/documents/*`, `routes/documents.ts` | Implemented and verified (CI) | PDF/DXF unsupported; no elevations or sections; no dimension rendering |
| 3D scene | GLB and manifest compiled from the revision; durable job `SCENE_COMPILE`; limits of 200k triangles and 16 MiB GLB | `apps/api/src/scene3d/*` | Implemented and verified | ≤ 2 storeys (BIM profile). No renders, panoramas, video or LOD |
| BIM / IFC | Derived on read; IFC export; ≤ 2 storeys | `apps/api/src/bim/*` | Implemented and verified (Python IFC check script exists) | Wider profile |
| Quantity takeoff | Deterministic from the revision; fingerprinted | `packages/quantity-takeoff`; `0007` | Implemented and verified | — |
| Construction calculation | Deterministic recipes from takeoff | `packages/construction-calculations`; `0008` | Implemented and verified | Recipes are not sourced from standards |
| BOQ / cost | Exact decimal arithmetic. Rate books are `SYNTHETIC` or `USER_SUPPLIED` (`boq-cost/src/contracts.ts:32`). The legacy V1 estimate uses seeded "illustrative" rates | `packages/boq-cost`; `0009`; `seed.sql` | Implemented (arithmetic); **rates unsourced** | Sourced, dated, regional rate books (RCH-009) |
| Structural engineering | Linear-static 3D frame solver, bounded | `apps/api/src/structural/*`; `0014` | Implemented; verified against analytical closed forms only (REPORTED, Addendum B) | Independent benchmark validation; P-delta; member design |
| Phase 35 assessment | Typed domains, assurance levels, evidence classes, zones, partitions, deterministic zone regeneration; standards marked `IDENTIFICATION_ONLY` / `NOT_VERIFIED` | `apps/api/src/engineering/*` (e.g. `sources.ts`) | Implemented and verified (CI) | Validated solvers; sourced values |
| Environmental, systems, knowledge, optimization | Bounded engines. Systems refuse > 2 storeys. Knowledge packs are synthetic demonstrations | `0015`–`0018` | Implemented (bounded) | Sourced packs |
| Jobs | Durable jobs (Phase 32): leases, fencing, retries, cancel, event log. Kinds: `SCENE_COMPILE`, `OPTIMIZATION_STUDY`, `REVISION_EXECUTE` | `apps/api/src/jobs/*`; `0022` | Implemented and verified | No AI-job kind. Generation is synchronous. Polling only (no SSE/WebSocket) |
| Compute gateway | Quote, consent, dispatch. Local pool only; remote is the literal `DISABLED`; cost `FREE`/0 | `apps/api/src/compute/contracts.ts`; `0025` | First slice implemented and verified | Remote adapters, budgets, sweeper (owner decisions D1–D7) |
| Freshness / dependency graph | Phase 37: graph with recomputed hashes and fail-closed states | `services/dependency-graph-service.ts`, `graph/` | Implemented and verified (CI) | AI artifacts are not represented |
| Evidence packages | Phase 38: signed, immutable; SQL-side recomputation; `professionalReview: NOT_RECORDED` | `0027`; `services/evidence-service.ts` | Implemented and verified (CI). Hosted: no | Reviewer-identity model |
| Frontend contracts | 146 routes in `docs/modernization/api-routes.json`; generated OpenAPI with drift test; discovery `GET /api/capabilities` (`capability-discovery-v2`) | `apps/api/tests/modernization.test.ts` | Implemented and verified | See Section E (G7, G10). **The frontend repository was not inspected** |

---

## Section C — Model-training strategy

**Principle:** language models translate and explain. Deterministic engines decide geometry, quantities, money and engineering. Every model output must pass the same schema, QA and revision gates as human input. The repository already enforces this.

| Approach | Use it for | Requires | Possible with existing code? | Burden | When |
|---|---|---|---|---|---|
| **1. Prompting and orchestration** (structured output, no tools) | Brief → structured intent (already the shape); clarification questions; explaining stored results; comparing revisions in words | A generic capability → {input schema, output schema, prompt version, validator, privacy class} registry; an eval harness; a free or local model | **Yes**, after generalizing `AiOrchestrator` (G3) | Low. Local OpenAI-compatible server or free tier. Hardware depends on the chosen model (UNKNOWN) | **Now (P1)** |
| **2. RAG** | (a) Project-own records: decisions, revisions, assessments. A deterministic version already exists in the turn context loader. (b) **Registered, licensed** reference material once research items are `SOURCE_FOUND`+ | A source registry with licences (research §5); chunk-level provenance; citations in the output | (a) Yes. (b) **No**: zero sources are registered | Low–medium. Postgres full-text search is enough at first; no vector database is needed until evaluation shows it | (a) Now, deterministic. (b) Later, gated on research |
| **3. Fine-tuning** | Only the narrow, automatically checkable task of brief → `ConversationIntent` / `IntentCandidate` JSON, if the evaluation shows the prompted model falls short | A consented, licensed, versioned corpus with held-out test data; a reproducible training script; a model card; a rollback route | **No.** No data and no pipeline | Medium. LoRA on a small open model would need on-demand GPU (ASSUMPTION; size and cost UNKNOWN) | **Later (P2), only if justified by measurement** |
| **4. Specialized models** | Reference-image or PDF plan reading → **candidate** Building Model V2 (always through QA); façade/interior visual concepts as non-authoritative images; later, learned layout proposals | Licensed image/plan datasets; a vision model; geometric validation; an evaluation set of plans with ground-truth models | **No** | High. GPU inference is likely (ASSUMPTION). Needs the gateway's remote placement, which is disabled | **P3.** Adopt an existing open model before training anything |
| **5. Deterministic engines** | Geometry, topology, units, QA, takeoff, BOQ arithmetic, structural solving, hashes, evidence, freshness | Already present; validation evidence is still needed for solvers and sources | **Yes** | Low (CPU) | **Always.** Never replace with a model |

Training a foundation model from scratch is **not recommended at any stage**. Nothing in the product requires it, and the data and compute do not exist.

---

## Section D — Data and evaluation roadmap (all PROPOSED; none of this exists)

**Lifecycle.** Capture (with consent) → de-identify → license and provenance record → validate (schema and QA) → human label or review → version (content hash) → split (by project and owner, never by row) → evaluate → retain or expire.

| Dataset | Content | Source | Notes / risks |
|---|---|---|---|
| **D1 Golden briefs** (first, small) | NL brief → expected `IntentCandidate`, expected clarification questions, expected `unsupported` flags | Hand-authored by the project (CC0/project-owned), including Hinglish and adversarial or injection cases | Enables the evaluation gate for any provider. No legal risk |
| D2 Brief → accepted revision | Brief, intent, requirements, accepted revision hash | Product usage, **only with consent** | Today the orchestrator logs exclude prompts (`orchestrator.ts:8`). Capture requires an approved consent and retention policy |
| D3 User corrections | Proposal vs the user's correction or rejection; accepted alternatives | Conversation decisions (`0026`) | Preference signal. Do not mix with D1 test data |
| D4 Floor plans and geometry | Validated V2 models | Generator outputs (synthetic); licensed external sets after legal review | **Leakage risk:** a model trained on generator output only learns the generator. External plan datasets need a separate licence verification task (none is named or verified here) |
| D5 Visual (interior/exterior) | Images ↔ space/façade specs | Licensed sources only | Copyright-heavy. P3 |
| D6 Rates and costs | Rate, unit, region, date, source, tax basis | Quotes or official schedules (RCH-009) | Must carry geography and effective date. Never "live" without a verified source |
| D7 Engineering benchmarks | Inputs, reference results, tolerance, source | Analytical cases, independent software, published benchmarks (RCH-011) | Used for validation, **not training** |

**Required metadata per record:** dataset version; record hash; source and licence (SPDX or contract); consent reference; units (always mm in V2); coordinate frame (`x-right-y-up-z-depth`); jurisdiction and date (for rates); annotator; quality label; confidence; split.

**Evaluation gates (PROPOSED; thresholds need owner approval):**
1. **Schema validity** of every provider output on D1, measured as a rate. Fallback must work at 100%.
2. **Field-level exact match** against D1 for numeric and enum fields, plus **zero invented values**. A field the brief does not support must be absent or flagged as inferred.
3. **Injection suite:** 0 cases where embedded instructions change approval, tools or out-of-schema fields.
4. A **regression comparison** with the deterministic grammar on the same set. A provider is enabled only if it beats the grammar without new failure classes.
5. **Downstream QA pass rate:** intent → generator → QA, compared with the grammar baseline.
6. Each gate result is recorded with model ID, prompt hash, dataset version and commit.

---

## Section E — Architecture and integration gaps (by severity)

| # | Sev. | Gap | Location / evidence | Impact | Recommended correction |
|---|---|---|---|---|---|
| G1 | **High** | Phase 39–46 scope is unrecovered or conflicting. The roadmap and registers are **unmerged** and **stale** (state as of `5476f41`). Two features share the "Phase 36" label | `docs/roadmap-research-baseline@56764c5`; `docs/phase35-1/phase-1-46-reconciliation.md` §2; `docs/phase36*/` | Work may be built against the wrong scope. Agents read stale state | Owner ratifies 39–46 scope. Refresh the registers to `ea2b5d0` and merge them (docs-only PR). Decide the "36" naming |
| G2 | **High** (release) | Hosted DB state unverified. `0018`–`0027` not shown applied; Supabase acceptance skipped on `ea2b5d0` | Merge messages; CI job `supabase-acceptance` skipped | Deploying could fail or diverge | An operator does a read-only `migration list`, then runs `workflow_dispatch` `supabase-acceptance` on `ea2b5d0` before any deploy |
| G3 | **High** (AI) | The orchestrator is single-capability. `interpret()` parses only `ConversationIntentSchema`. The remote adapter embeds `INTENT_SYSTEM_PROMPT`. The registry marks 10 of 11 capabilities `PLANNED` | `orchestrator.ts:32-91`, `conversation.ts:35,46`, `registry.ts:3` | Every Phase 39/41/43 module would fork the routing, or bypass the privacy and budget controls | Add generic `execute(capability, input)` with a per-capability descriptor (input/output Zod, prompt ID + hash, validator, privacy floor, budget class). Keep the current function as a thin wrapper (compatibility) |
| G4 | **High** (AI) | No AI quality evaluation: no golden set, no metrics, no gate | Tests use fixture adapters | A provider or prompt cannot be justified, and fine-tuning cannot be justified | Build D1 and an `eval:ai` script that runs offline with a local model or recorded responses. Do not run it in CI against paid APIs |
| G5 | Medium | No AI spend ledger or budget. Health and RPM state is per-process | `orchestrator.ts:8-16, 72` | Fine while `allowMetered=false`. A blocker before any metered provider | Persisted usage table; per-owner and global ceilings checked before the call; reuse the Phase 36 quote/consent pattern for expensive calls |
| G6 | Medium | Prompt-injection hardening is regex-only at input. A future reference→AI path has no trust labelling | `conversation-planner.ts:16-18` | Low today (closed schema, no tools). High once Phase 31 content reaches models | Keep the closed schemas. Add untrusted-content envelopes, never feed raw reference text as instructions, add an injection test suite (D1), and keep "no tools" |
| G7 | Medium | Capability signals are inconsistent. The workflow registry marks `SCENE_3D` and `PROFESSIONAL_2D` as `PLANNED` although Phase 29 GLB and Phase 38 plan sheets exist. Discovery reports them through other entries | `apps/api/src/workflows/registry.ts:31,34` vs `services/overview-service.ts` | The frontend may hide working features or misread them. (Confidence Medium: the status may mean "not orchestrated by workflows") | Define the meaning of "workflow status" vs "service status" in the discovery contract, then align or annotate |
| G8 | Medium | Generation, BIM, scene and systems are limited to ≤ 2 storeys, while B35 assesses supertall models. **No phase owns a multi-storey generator** | `BLUEPRINT_LIMITS`, `parametric.ts:12`; reconciliation §4 | The "large-scale and multi-storey" product goal is unreachable | Proposed roadmap change requiring approval: a dedicated phase for a multi-storey generator and a wider BIM profile. Keep fail-closed limits until then |
| G9 | Medium | AI provenance lacks prompt version and hash, and AI outputs are not graph nodes | `contracts/ai-orchestration.ts` `AiProvenanceSchema` | Cannot reproduce or audit which prompt produced which proposal | Add `promptId`, `promptHash` and `schemaVersion`. Persist AI-derived artifacts with the Phase 37 linkage pattern |
| G10 | Medium | Four separate deterministic NL grammars | `fallback-parser.ts`, `conversation-planner.ts`, `conversation/interpret.ts`, `revision/interpret.ts` | Behavior drift between endpoints | Consolidate behind one versioned interpreter module (refactor; tests must stay byte-identical) |
| G11 | Low | Polling only; no push progress; generation is synchronous | `jobs/contracts.ts` | Acceptable at current bounds | B45 (REPORTED) |
| G12 | Low | Rates, standards and knowledge are synthetic or unsourced (correctly labelled) | `seed.sql`, `demo.ts`, `packs.ts`, `engineering/sources.ts` | No real-world cost or compliance value | Research tasks RCH-001…012. Keep the labels |
| G13 | Low (process) | The session's designated branch `main` is not the default branch, and local `main` is stale | `git ls-remote --symref` | Agents may build on the wrong base | Every phase prompt names `phase31/development` and verifies ancestry |

No secrets were found in the tracked files I read. `.env.example` holds placeholders, and the code reads credentials only through referenced environment names (`AI_PROVIDER_<NAME>_API_KEY`, `env.ts:78-82`). Values were not inspected.

---

## Section F — Phase 39–46 dependency matrix

Scope sources: the repository's later-phase assignments (`phase30-report.md` §K, `modernization-report.md` §E/§I, reconciliation §2), all **REPORTED**; and roadmap r1/r3 (unmerged), which **conflict** for 41 and 43–45. No original roadmap text exists in the repository.

| Phase | Scope (source) | Conf. | Prerequisites (in code) | Likely ownership / migration | Data / model needs | Acceptance basis | Independent? |
|---|---|---|---|---|---|---|---|
| **39** | AI modules: interior/exterior, generative alternatives, **provider routing** (AS "39, 43"; owner's earlier "38 provider routing" label) | Low | Phase 21 orchestrator (needs G3), B30 revision operations, B32 jobs, B36 gateway, B37 graph, B38 evidence | `apps/api/src/ai/**`, `contracts/ai-*`, new interior/exterior contracts; **`0028`** if AI artifacts or usage are persisted | D1 golden set; a free or local model | PROPOSED: G3/G4/G9 acceptance + one model-grounded module | Needs owner scope first |
| **40** | Comprehensive backend audit and readiness review (owner policy in r1/r3; "unrecovered" in the reconciliation doc) | Medium | Whatever it audits | `docs/phase40/**` only; no migration | None | Audit report and remediation list | **Read-only, can run in parallel**, if pinned to a commit |
| **41** | Brief/context consumption by AI flows (AS, single mention), **or** post-audit remediation (r1) | Very low | 39 (AI contracts), B31 references, B33 context | `ai/**`, `references/**` | D1/D2; injection suite | UNKNOWN | Sequential after 39 (AI reading) or after 40 (remediation) |
| **42** | UNKNOWN (r1: reliability/operational readiness, PROPOSED) | None | — | — | — | — | Cannot plan |
| **43** | Interior/exterior/render/panorama/video AI providers (AS), **or** deployment preparation (r1) | Low | 39 descriptor registry; B36 **remote** placement (currently `DISABLED`); budgets (G5) | `ai/**`, `compute/**`; migration likely | D5 visual data; GPU or remote inference | UNKNOWN | Sequential after 39; needs D1/D4/D7 decisions |
| **44** | Collaboration: teams, shared projects, roles (AS) | Low | All owner-scoped RLS and RPCs (`0006`–`0027`) | Touches **every** owner-scoped table and function; large migration | None | UNKNOWN | **Must not run in parallel** with anything that changes RPCs or RLS |
| **45** | Desktop delivery: LOD, chunked delivery, SSE/WebSocket, typed response schemas (AS) | Low | B29 scene, B32 jobs | `scene3d/**`, `jobs/**`, `lib/http-protection.ts`; possibly a migration | None | UNKNOWN | Can be *prepared* in parallel; implement it apart from 39 only if 39 does not touch jobs or scene |
| **46** | Final integration and end-to-end benchmark (AS "45–46") | Low | Everything | Tests and docs | Benchmarks | UNKNOWN | Last |

**Shared conflict hotspots** (both earlier conflicts happened here, per the r3 register):
- `apps/api/src/lib/http-protection.ts` (rate-limit groups);
- `apps/api/src/services/overview-service.ts` (discovery);
- the generated `docs/modernization/openapi.json` and `api-routes.json`;
- the Sentry route allowlist;
- `package.json` scripts;
- `.github/workflows/backend-ci.yml`;
- `supabase/tests/database.test.ts` (schema pins);
- the next migration number (`0028`).

1. **Must be sequential:**
   - the 39 → 41 → 43 AI chain, which shares the descriptor registry and privacy/budget contracts;
   - 44 relative to every RLS or RPC change;
   - 46 last.
2. **Can be implemented in parallel without shared contracts or migrations:**
   - **39 (code)** alongside **40 (read-only audit pinned to `ea2b5d0`, docs only)**.
3. **Can be prepared in parallel but should wait before implementation:**
   - 45 (needs a scope ruling, and touches jobs and http-protection);
   - 43 (needs remote-compute and budget decisions);
   - 44 (needs a sharing and role model decision).
4. **Independent tasks within Phase 39** (once scope is approved):
   - (a) the descriptor-registry refactor;
   - (b) the D1 golden set and the `eval:ai` harness;
   - (c) prompt and provenance versioning;
   - (d) the interior/exterior contract design.
   - (b) and (d) touch no runtime code.

**Are 39 and 40 genuinely independent?**
- **Only partly.**
- If Phase 40 is the readiness review *of the backend as built through 38*, it is read-only and can run alongside 39.
- If Phase 40 is meant to certify readiness *including* the AI modules, it depends on 39 and must follow it.
- Recommendation: run 40 as an audit of `ea2b5d0` now, and add a short delta audit after 39 merges. Remediation found by 40 must not be implemented in parallel with 39 inside the same files.

**Recommended two-account allocation** (PROPOSED; no worktrees were created):

| | Account A | Account B |
|---|---|---|
| Branch | `phase39/<slug>` from `ea2b5d0` | `phase40/readiness-audit` from `ea2b5d0` |
| Owns | `apps/api/src/ai/**`, `contracts/ai-*`, `apps/api/tests/ai-*`, `docs/phase39/**`, **all shared hotspots above**, migration `0028` (reserved) | `docs/phase40/**` only. No `src`, no migration, no CI or package changes |
| Must not touch | `docs/phase40/**` | Any runtime file. Findings go in the report, not in code |
| Integration order | Merge after full CI on both Node versions plus container smoke | Docs-only PR can merge any time. Then a delta audit of A's merge |
| Regression | `npx vitest run` (full suite); route-catalog/OpenAPI drift test; migration replay pins; `test:supabase` locally if `0028` exists | None (no code) |

A second *code* stream (for example a Phase 45 SSE slice) is possible only after the owner confirms its scope, and only with hotspot ownership assigned in advance. I do not recommend it this round.

---

## Section G — Prioritized implementation plan (none of this is authorized yet)

### P0: before dependent work

| Item | Prereq | Components | Acceptance | Test |
|---|---|---|---|---|
| P0-1 Ratify 39–46 scope; refresh and merge registers; resolve the "36" naming (G1) | Owner | `docs/roadmap/*` | A register reflects `ea2b5d0`, and every phase has a scope with a source | Doc review; links resolve |
| P0-2 Hosted DB read-only verification + Supabase acceptance on `ea2b5d0` (G2) | Operator access | Hosted DB (read-only), CI `workflow_dispatch` | Migration list recorded; `supabase-acceptance` green | CI job log; receipt JSON |
| P0-3 Decide the AI policy defaults: providers (local-only or free tier), privacy class, consent to store prompts (for D2) | Owner | Policy docs | A written decision | — |

### P1: AI foundations (map to Phase 39 if the owner confirms; otherwise a proposed roadmap change)

| Item | Prereq | Components | Acceptance | Test |
|---|---|---|---|---|
| P1-1 Capability descriptor registry; generic `execute` (G3) | P0-1 | `ai/orchestration/*`, `contracts/ai-orchestration.ts` | Existing intent extraction is byte-compatible; each new capability declares its schemas, prompt hash and privacy floor; an unknown capability is refused | Existing `ai-*` tests unchanged and passing; new negative tests |
| P1-2 D1 golden set + `eval:ai` (G4) | — | `test-support/ai-eval/` (PROPOSED) | Reproducible report keyed by model, prompt hash and dataset hash | Runs offline on recorded responses |
| P1-3 Prompt/schema versioning in provenance (G9) | P1-1 | `AiProvenanceSchema` | Every AI-derived proposal names its prompt hash | Unit tests; old states still parse |
| P1-4 Usage ledger and budgets (G5) | P0-3; likely migration `0028` | New table and RPC | A call is refused when the budget is exhausted; nothing is spent without a recorded quote | Integration + Supabase acceptance |
| P1-5 Untrusted-content handling for references (G6) | P1-1 | `ai/**`, `references/**` | Reference text is only ever in a data field; injection suite passes at 0 | Injection tests |
| P1-6 Interior/exterior as **model-grounded structured specs** (finishes, materials and furnishing specifications attached to V2 space and wall IDs through revision operations), not images | P1-1, owner scope | V2 specifications, Phase 30 operations | Output passes V2 schema + QA; feeds takeoff and BOQ; no geometry invented by the model | Full suite; QA fixtures |

### P2: data, evaluation, justified specialization

- **P2-1** Consent, retention and de-identification policy, then correction capture (D2/D3).
- **P2-2** Project-records RAG with citations (deterministic retrieval first).
- **P2-3** Register real sources (RCH-001…012) through a separate source-verification task.
- **P2-4** Fine-tuning pilot for intent extraction, only if P1-2 shows a measured gap. Requires a licensed corpus, held-out split and model card.

### P3: advanced capabilities

- Multi-storey generator and wider BIM/scene profile (G8, proposed new phase).
- Reference plan → candidate model (vision).
- Renders, panoramas, video (B43).
- LOD and push progress (B45).
- Collaboration (B44).
- Validated external solvers through the gateway's remote placement (B36 D1–D7, G12).

---

## Section H — Final decision

1. **What to use immediately instead of training a foundation model.** The existing Phase 21 orchestrator, generalized (P1-1), with a free or local OpenAI-compatible model for structured intent extraction and explanation. The deterministic grammar stays as the always-available fallback. Deterministic engines keep doing all computation.
2. **What should eventually be trained or fine-tuned.**
   - First: a small model fine-tuned on brief → structured-intent JSON, and only once a consented, licensed D1/D2 corpus exists and evaluation shows the prompted model falls short.
   - Later: adopt (then possibly adapt) a vision model for reading reference plans into **candidate** V2 geometry.
   - Nothing else.
3. **Datasets to create or legally acquire:**
   - D1 golden briefs (create now);
   - D2/D3 consented brief→revision and correction data;
   - D6 sourced, dated, regional rates;
   - D7 engineering validation benchmarks;
   - D4/D5 plan and visual datasets, only after licence verification.
4. **Components that must remain deterministic and independently validated:**
   - Building Model V2 validation and QA;
   - generators and solvers;
   - units and coordinates;
   - takeoff;
   - construction calculations;
   - BOQ arithmetic;
   - structural and other engineering solvers;
   - hashing, signing, freshness and evidence packages;
   - all compliance or limit checks.
5. **Safest next implementation phase.**
   - After P0-1 and P0-3: Phase 39, first slice = P1-1 + P1-2 + P1-3. This is the AI capability foundation, with no provider enabled by default and no new user-facing AI claim.
   - P0-2 is a release gate. It does not block development.
6. **Two workstreams that can genuinely run in parallel:**
   - Account A: Phase 39 foundation (code; owns hotspots and `0028`).
   - Account B: Phase 40 read-only readiness audit pinned to `ea2b5d0` (docs only).
7. **Evidence still missing before these decisions are final:**
   - the original 46-phase roadmap (scope of 39–46, especially 40–45);
   - the original Phase 35 V2 research, or confirmation that it does not exist;
   - hosted DB state;
   - frontend repository contracts (not inspected);
   - owner budget and privacy policy;
   - evaluation results for any candidate model (none exist);
   - licence review for any external dataset;
   - Vitest logs for `ea2b5d0` (counts here are REPORTED).

---

## Unresolved questions that need your input

1. **Phase 39–46 scope.** Do you accept the repository's assignments (39 AI modules / provider routing; 41 AI brief consumption; 43 AI providers; 44 collaboration; 45 delivery), or roadmap r1's (41 remediation; 43 deployment; 44 docs; 45 final acceptance)? Can you supply the original roadmap file?
2. **Phase 40.** Is it an audit of the backend through Phase 38 (can run in parallel now), or a readiness gate that must include the AI modules (must follow 39)?
3. **"Phase 36".** Two features carry this label. Should one be renumbered in the documentation?
4. **AI policy.** Local-only models, or a free-tier remote provider? Is storing user prompts or briefs for evaluation and training permitted (consent and retention)?
5. **Interior/exterior meaning.** Structured, model-grounded specifications (recommended first), visual concept images, or both?
6. **Multi-storey generation.** Should a phase own the > 2-storey generator and a wider BIM profile, and which one?
7. **Knowledge base branch.** Should the `docs/roadmap-research-baseline` branch be refreshed and merged into `phase31/development`?
8. **Hosted DB check.** Who performs the read-only check, and when?
