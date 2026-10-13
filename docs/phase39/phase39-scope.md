# Phase 39: AI Design Modules, Provider Routing and Brief Consumption — Scope and Acceptance

**Status:** scope of record for implementation. Written 2026-10-13, before any Phase 39 code.

**Base:** `phase31/development` at `ea2b5d0` (Phase 38 merged as PR #15). Citations refer to that commit unless a branch is named.

**Labels used throughout:**
- **CONFIRMED:** stated in the repository, with a citation.
- **PROPOSED:** this document's design.
- **UNKNOWN:** not recoverable.

---

## 1. What the repository says Phase 39 is

### 1.1 Confirmed (as repository assignments, not as roadmap text)

| Source | Text |
|---|---|
| `docs/phase30/phase30-report.md:167` (§K) | "Interior/exterior AI modules, generative alternatives, provider routing \| 39, 43" |
| `docs/modernization/modernization-report.md:166` | "F49–F50 interior/exterior AI \| — \| unsupported (explicit in `media`/`unsupported`) → B39/B43" |
| `docs/modernization/modernization-report.md:167` | "F51–F54 blueprint/structural/materials/budget AI \| Deterministic engines exist; AI modules do not \| planned (B39)" |
| `docs/modernization/modernization-report.md:228` | "Interior/exterior/render/panorama/video AI providers \| B39/B43" |
| `docs/phase33/phase33-design.md:26` | "Using the brief as AI or generator input \| **Not in V1** \| … Consumption is B39/B41, through this bundle." |
| `docs/phase33/phase33-report.md:53` | "Briefs and context are not yet consumed by any AI flow (B39/B41)." |
| `docs/phase31/phase31-design.md:24` | "Using a reference as AI or engine input (OCR, scale, plan extraction) \| **Not advertised** \| B39 / F13–F16." |
| `docs/phase35/phase35-design.md:169` | "AI-assisted input extraction and explanation \| B39/B43 provider work" |
| `docs/phase36/phase36-handoff.md:83` | "specialist AI workers (B39–43)" |
| `docs/phase35-1/phase-1-46-reconciliation.md:64` | "39 \| AI modules: interior/exterior, generative alternatives, provider routing; reference and brief consumption (AS …) \| Not started \| Low" |
| `docs/phase38/phase38-scope.md:180` | Phase 38 excluded "Phase 39 and later". |

Every one of these is a **later-phase assignment written by an implementing session** (evidence class AS in the reconciliation). None is a quotation of the original roadmap.

### 1.2 What already exists that Phase 39 builds on (confirmed, code)

- **Phase 21 provider orchestration** (`apps/api/src/ai/orchestration/`, `contracts/ai-orchestration.ts`, `docs/phase21-design.md`). Server-owned `AI_ROUTING_CONFIG` policy; provider and model registries; deterministic priority routing; capability, privacy, metered-cost, structured-output and context-size gates; per-attempt and total deadlines; bounded transient retries; circuit breaker with a single half-open probe; per-provider concurrency and request-rate limits; DNS-pinned HTTPS remote transport with host allowlist; credentials referenced by environment-variable name only; typed failure codes. **Only `ARCHITECTURAL_INTENT_EXTRACTION` is operational**; the other ten capability names, including `INTERIOR_VISUALIZATION` and `EXTERIOR_VISUALIZATION`, are `PLANNED` (`registry.ts:3`).
- **Phase 33 context bundle** (`GET /api/projects/:projectId/context`): one-snapshot project, settings, current brief (user-stated, `verified: false`), active reference summaries and current revision summary, with a `contextHash` intended for exactly this kind of citation (`phase33-design.md` §5).
- **Phase 31 references**: PNG, JPEG, WebP and PDF only; inspected, metadata-stripped, private. No text extraction, OCR or vision transport exists.
- **Phase 30 selective revision**: exterior wall appearance operations (`APPEARANCE_MODIFY` with four visual finish presets), executed only through preflight, QA and approval.
- **Phase 38 persistence pattern**: immutable owner-read table, signed `SECURITY DEFINER` write that recomputes bindings and hashes, convergence on `unique (revision, input_hash)`.
- **Discovery** lists `EXTERIOR_RENDER` and `INTERIOR_RENDER` as `UNSUPPORTED` (`NO_RENDER_PROVIDER`), and the workflow capabilities `INTERIOR_DESIGN` / `EXTERIOR_DESIGN` as contract-only.
- Latest migration: `0027_evidence_packages.sql`.

### 1.3 Conflicts and unknowns

- **Q4, provider-routing placement (UNKNOWN which is right).** The owner's draft roadmap r1 (`docs/roadmap/archive/…owner-draft-r1-2026-10-13.md` on the unmerged `docs/roadmap-research-baseline` @ `56764c5`, lines 82–83) labels **Phase 38 "Provider routing"** and **Phase 39 "Additional backend capability / integration — UNKNOWN"**. The repository assigns documentation exports to 38 (implemented, PR #15) and provider routing to "39, 43". The reconciled roadmap r3 on the same branch (§3, row 39; §3.1 item 3) records the conflict without resolving it; decisions register Q4 is open. This phase follows the repository assignment, as Phase 38 did. **Q4 remains open.**
- **Split between B39, B41 and B43 (UNKNOWN).** The repository mentions "39, 43" for AI modules and providers, "B39/B41" (once) for brief consumption and "B39/B43" for render/panorama/video providers. The boundary below (structured concepts here; image, render, panorama and video providers later) is PROPOSED, chosen so that nothing in Phase 39 forecloses either reading.
- **Original acceptance criteria (UNKNOWN).** The canonical 46-phase roadmap was never recovered. The criteria in §5 are PROPOSED.
- **Phase 35 research (UNKNOWN, unverified).** `docs/research/NekoArch_Phase35_Engineering_Research_Enhanced_v2_2026-10.md` exists only on the unmerged branch and is a reconstructed framework with no verified sources. Phase 39 uses none of it, and introduces no standard, clause, factor, rate or citation.

---

## 2. Smallest defensible scope (proposed)

Phase 39 delivers one vertical slice that exercises every assigned item once, using only what the repository already has:

| Assigned item | Phase 39 delivers | Deferred, and why |
|---|---|---|
| Provider routing | The Phase 21 router generalized from one hard-wired capability to **capability-typed tasks**, each with its own output contract and validator. Two new operational capabilities. One shared routing policy. | Image, render, panorama and video transports (no such transport or provider exists; the repository assigns them "B39/B43") |
| Interior AI module | `INTERIOR_DESIGN_CONCEPT`: advisory finish, palette, lighting and per-space notes bound to the revision's space ids | Interior geometry, furniture layout, renders |
| Exterior AI module | `EXTERIOR_DESIGN_CONCEPT`: advisory facade concept whose finish is one of the Phase 30 presets, with a ready-to-submit Phase 30 `APPEARANCE_MODIFY` operation that this phase **never executes** | Physical facade or glazing changes (no geometry-editing engine) |
| Generative alternatives | 1–3 alternatives per request, produced by **one** provider call (bounded cost), or by a deterministic template generator | More alternatives; ranking or scoring (no validated metric) |
| Brief consumption | The current Phase 33 brief, read through the context bundle, field by field, with the excluded fields named | AI-written brief changes |
| Reference consumption | Reference **metadata** (purpose, display name, media type, stored hash) as attribution context | Reference **content** (pixels, PDF text): no OCR or vision transport, and it would move private files to a third party |

### 2.1 Workflow and render capabilities stay as they are

- The workflow capabilities `INTERIOR_DESIGN` and `EXTERIOR_DESIGN` (workflow outputs; `workflows/registry.ts`) **stay unavailable**. Concepts are advisory and are not workflow artifacts.
- `INTERIOR_RENDER`, `EXTERIOR_RENDER`, `PANORAMA_360` and `RENDERED_WALKTHROUGH_VIDEO` **stay `UNSUPPORTED`**.
- `INTERIOR_VISUALIZATION`, `EXTERIOR_VISUALIZATION`, `IMAGE_CONCEPT_GENERATION`, `MODEL_3D_GENERATION`, `DOCUMENT_ANALYSIS` and `ENGINEERING_ASSISTANCE` **stay `PLANNED`**.

---

## 3. Design (proposed)

### A. Capability-typed provider routing

1. **Capabilities.** Add `INTERIOR_DESIGN_CONCEPT` and `EXTERIOR_DESIGN_CONCEPT` to `AiCapabilitySchema` (additive; the per-provider and per-model capability-list bound grows from 11 to 13 so existing configurations stay valid). Both are `AVAILABLE`, `advisory: true`.
2. **Task contract.** A routed task names its capability, a server-owned instruction text, a bounded data payload and a validator that returns a typed value or a typed failure. The router, not the caller, chooses providers and models.
3. **Routing rules (unchanged from Phase 21, now per capability).** Deterministic order by provider priority, model priority and stable ids. Before any I/O a route is skipped as `PROVIDER_DISABLED`, `MODEL_UNAVAILABLE`, `CAPABILITY_UNSUPPORTED` (provider **and** model must list the requested capability), `PROVIDER_POLICY_REJECTED` (privacy, metered cost, structured output, context size) or `PROVIDER_UNAVAILABLE` (open circuit).
   - A secondary route is used only if it supports the **same** capability, so a fallback can never change the operation.
4. **Failure handling.** Per-attempt timeouts within one total deadline (≤ 15 s); transient-only retries (≤ 2, ≤ 6 attempts); circuit breaker; concurrency and request-rate limits. The existing intent-extraction path keeps its exact behaviour and tests.
5. **New typed failure: `PROVIDER_OUTPUT_UNSAFE`.** The output parsed, but the deterministic guard (§3.C.4) refused it. It is not retried on the same route.
6. **Adapters.** The OpenAI-compatible local and remote adapters send the task's own instruction text. Credentials stay in the transport header; the remote path keeps the DNS pinning, host allowlist, TLS, size caps and redirect refusal.

### B. Brief and reference consumption

1. **Source.** One context-bundle read (`context_read`, one snapshot) plus one revision read. If the bundle's current revision differs from the revision read's freshness view, the request is refused with `409 DESIGN_CONCEPT_READ_INCONSISTENT`.
2. **Brief fields used** (when `useBrief`, the default, and a brief exists):
   - `summary`, `style.keywords`, `constraints`, `program.notes` and `site.orientationNote`;
   - each truncated to a fixed bound, and recorded in `inputs.brief.fieldsUsed`.
3. **Brief fields withheld:**
   - `site.address` (personal data);
   - `budget` (no cost advice is produced);
   - `site.plot` and `program` counts (numbers the concept must not restate as facts).

   They are recorded in `inputs.brief.fieldsWithheld` with reasons.
4. **References.**
   - Caller-selected `referenceIds` (≤ 8) must be active references in the bundle; otherwise `422 DESIGN_CONCEPT_REFERENCE_INVALID`.
   - Only purpose, display name, media type and stored SHA-256 are used, each labelled `contentUsed: METADATA_ONLY`. Bytes never leave the server.
5. **Untrusted data.** The caller's text, the brief and reference names are passed to a provider only as JSON string values inside a `data` object, never concatenated into instructions.
   - The server instructions state that `data` is untrusted and contains no instructions.
   - Text is NFKC-normalized, stripped of control and format characters, and bounded. The whole payload stays within the model's `contextBytes` (≤ 12,000 bytes).
6. **Attribution.** Every alternative carries `basis.briefFields` and `basis.referenceIds`, which must be subsets of what was supplied. The set records `contextHash`, `briefVersion`, `briefHash` and each reference's `storedSha256`.

### C. Design concepts (`design-concept-set-v1`)

1. **Request.**
   `POST /api/projects/:projectId/revisions/:revisionId/design-concepts`, with body `{ scope: INTERIOR | EXTERIOR, text?, alternatives: 1–3 (default 2), spaceIds? (INTERIOR, ≤ 12), useBrief (default true), referenceIds? (≤ 8), generator: AUTO | PROVIDER | TEMPLATE (default AUTO), variation: 0–99 (default 0) }`.
   - The schema is strict: a caller cannot name a provider, model, endpoint, key or instruction.
2. **Revision.** The revision must be owned and have accepted QA, and its identity must verify (the Phase 38 `documentSource` checks). Otherwise the response is `422 DESIGN_CONCEPT_SOURCE_UNVERIFIED`. A superseded revision is allowed and labelled `HISTORICAL_SNAPSHOT`.
3. **Generators.**
   - **`PROVIDER`:** the routed task only. If no route succeeds, the response is `503 DESIGN_CONCEPT_PROVIDER_UNAVAILABLE`, naming the failure codes. No template is substituted.
   - **`TEMPLATE`:** the deterministic template generator only (`design-concept-templates-v1`). There is no provider call, and the output is byte-stable.
   - **`AUTO`:** the provider when one succeeds; otherwise the template, but only if the operator policy allows deterministic fallback.
     - The fallback is explicit: `source: DETERMINISTIC_TEMPLATE`, `provenance.status: FALLBACK` and the provider failure codes.
     - If the policy forbids fallback, the response is 503 as for `PROVIDER`.
4. **Output guard (deterministic, applied to provider output before acceptance).** Any violation refuses that route's output; nothing is repaired or truncated.
   - **Zod.** The output must match the strict schema.
   - **Bounded content.** Text lengths are bounded, colours are `#rrggbb`, there are no numeric fields, and text has no `<`, `>` or control characters.
   - **Entity subsets.** Space ids, brief fields and reference ids must be subsets of those supplied.
   - **Exact count.** The output must contain exactly the requested number of alternatives.
   - **Claims screen.** It refuses text asserting code compliance, certification, approval, structural adequacy, safety, or permit or construction readiness. It also refuses text containing dimensions, areas, loads or currency amounts. This gives `PROVIDER_OUTPUT_UNSAFE`.
5. **Exterior alternatives.**
   - The finish is a Phase 30 preset id.
   - The backend, not the provider, builds `proposedOperation`: a Phase 30 `APPEARANCE_MODIFY` on the named facades, with fixed preservation of `BUILDING_GEOMETRY`, `FLOOR_PLANS`, `STRUCTURE`, `OPENINGS`, `WALLS`, `ROOMS` and `INTERIOR`. It is validated by Phase 30's own schema.
   - It is labelled `NOT_EXECUTED`. Applying it means submitting it to `POST /api/projects/:projectId/revision-operations`, with that route's own preflight, scope limits, QA and approval.
6. **Assurance.**
   - Every set has `assurance: ADVISORY_UNVERIFIED` and seven claims fixed to `NOT_CLAIMED`: `dimensionalAccuracy`, `engineeringValidity`, `structuralSafety`, `codeCompliance`, `costAccuracy`, `constructionReadiness` and `professionalCertification`.
   - Nothing in a set changes a revision, an engineering status or a Phase 35 blocker. `REQUIRES_SOLVER`, `NO_VALIDATED_SOLVER` and every assurance level are untouched, because concepts are not inputs to any engine.
7. **Provenance.**
   - **Routing:** request id, capability, generator, provider id, model id, routing reason, fallback position and status.
   - **Attempts:** each attempt with status, failure, integer latency and usage (integer micro-USD estimate, only when tokens and configured rates exist).
   - **Template:** the template version.
   - **Excluded:** no prompts, payload text, credentials or endpoints.
8. **Identity.**
   - `inputHash` covers the version, scope, revision and model hash, the normalized request, the context hash, the brief hash and the reference hashes.
   - `contentHash` covers the whole set.

### D. Persistence and charge protection (migration `0028_design_concepts.sql`)

A migration is necessary because durable charge protection and traceable results need storage, and no existing table fits.

1. **Table.** Immutable, owner-read RLS table `project_revision_design_concepts` (FK to the revision and to its acceptance QA), with `unique (project_revision_id, input_hash)`.
2. **`design_concept_write` (`SECURITY DEFINER`, signed envelope).** It:
   - verifies ownership, the revision and accepted QA;
   - recomputes the model hash from the stored model, and checks the binding;
   - recomputes `contentHash` and `inputHash`;
   - requires the fixed claims, `ADVISORY_UNVERIFIED`, an alternative count equal to the request, and provider and model ids present exactly when `source = PROVIDER`;
   - enforces the per-owner quota of **50 provider-sourced sets per rolling 24 hours** (`P3904` → `429 DESIGN_CONCEPT_QUOTA_EXCEEDED`). Template sets are not counted; they are free and still rate-limited by the route group.
   - Identical inputs converge on the first stored row, under an advisory lock.
3. **`design_concept_read`.**
   - `get` and `list` (keyset), owner-scoped.
   - `lookup` (by `input_hash`), which also returns the owner's provider-set count in the last 24 hours.
4. **Charge protection, in order:**
   1. **Durable replay.** An identical request returns the stored set (`200`, `replayed: true`) with **no provider call**. `variation` is the explicit way to ask for new alternatives.
   2. **Single flight.** Concurrent identical requests in one process share one provider call.
   3. **Quota pre-check** before any provider call. When the quota is exhausted, `AUTO` falls back to the template, recorded as `PROVIDER_QUOTA_EXHAUSTED`, and `PROVIDER` gets 429.
   4. **Route limits.** The route is in the `generate` rate-limit group.
   5. **Policy defaults.** Metered models stay refused unless the operator sets `allowMetered`, and remote providers stay refused unless the operator allows remote privacy.

### E. Wiring

- **Routes.** `GET …/design-concepts` (list) and `GET …/design-concepts/:conceptSetId` (detail, with read-time currency). `?require=current` gives 409 on a superseded revision.
- **Discovery.**
  - `services` gains `DESIGN_CONCEPTS` (`ADVISORY_ARTIFACT`).
  - `aiCapabilities` shows the two new capabilities as `AVAILABLE`.
  - `media` gains `INTERIOR_DESIGN_CONCEPT` and `EXTERIOR_DESIGN_CONCEPT` (`application/json`). The render entries are unchanged.
- **Catalogs.** Route catalog, OpenAPI, Sentry route allowlist and the AI import-boundary allowlist (new pure modules only; network APIs stay confined to `orchestration/transport.ts` and the existing local provider).

---

## 4. Provider configuration (operator)

No provider is enabled by default, and none is required. With the default configuration, `AUTO` and `TEMPLATE` work, and `PROVIDER` returns a typed 503.

To route concepts to a provider, the operator adds the capability to a provider and model in `AI_ROUTING_CONFIG`:
- a local OpenAI-compatible endpoint on numeric loopback; or
- a remote one, which needs HTTPS, an allowlisted host, `privacyClass: REMOTE_ALLOWED`, a model `privacyClass` of `REMOTE_ALLOWED` and, if metered, `allowMetered: true`.

The key is supplied as `AI_PROVIDER_<NAME>_API_KEY` in the server environment. **No live provider was called while building Phase 39**; all provider tests use injected deterministic adapters or a mocked HTTPS module.

---

## 5. Acceptance criteria (proposed; each has automated tests)

| # | Criterion |
|---|---|
| P1 | The intent-extraction path behaves exactly as before: the existing Phase 21 suites pass unchanged, apart from the capability list now including the two new `AVAILABLE` entries. |
| P2 | Routing for a concept task picks the highest-priority provider and model that list the requested capability. A route lacking it is skipped `CAPABILITY_UNSUPPORTED` before any I/O. A secondary route is used only for the same capability. |
| P3 (−) | Timeout, rate limit and unavailability are retried within bounds, then the next route is tried. Auth failure, schema violation and `PROVIDER_OUTPUT_UNSAFE` are not retried on the same route. The total deadline bounds the whole request. |
| P4 (−) | Malformed JSON, wrong schema, extra fields, wrong alternative count, unknown space, reference or brief-field ids, markup and claims or dimensions in text are each refused with a typed failure. Nothing is repaired. |
| P5 (−) | `PROVIDER` with no eligible or successful route gives `503 DESIGN_CONCEPT_PROVIDER_UNAVAILABLE`, naming the failure codes. `AUTO` falls back to the template only when the policy allows it, and labels the fallback. |
| P6 (−) | Remote routes are refused under `LOCAL_ONLY` privacy, and metered models without `allowMetered`. No credential or endpoint appears in any response or log line. |
| B1 | The brief fields used and withheld are listed. The address and budget never reach a provider payload. `contextHash`, `briefVersion` and `briefHash` are recorded. |
| B2 (−) | An unknown, archived or other-project reference id gives 422. Reference bytes are never read; references are `METADATA_ONLY`. |
| B3 (−) | Hostile text in the caller's text, brief or reference name stays inside the `data` JSON. Instructions are server-owned constants. Oversized text is refused (400). |
| C1 | `TEMPLATE` output is byte-identical across runs and independent of input array order. Interior alternatives cover only the revision's spaces. Exterior alternatives carry a Phase 30-valid `proposedOperation` labelled `NOT_EXECUTED`. |
| C2 | Each set has `ADVISORY_UNVERIFIED`, seven `NOT_CLAIMED` claims and complete provenance, and its `inputHash` and `contentHash` match independent recomputation. |
| C3 (−) | An unverified identity or unaccepted QA gives 422. A superseded revision is labelled `HISTORICAL_SNAPSHOT`, and `?require=current` gives 409. |
| D1 | An identical request returns the stored set with `replayed: true` and makes no provider call. Concurrent identical requests make one provider call. A different `variation` makes a new set. |
| D2 (−) | The SQL write refuses each forged payload: a forged model hash, an altered alternative, an altered claim, a wrong revision, another user's envelope, and no envelope. It also enforces the provider quota (429). Rows are immutable. |
| D3 (−) | Owner-only: anonymous gives 401; another user and a cross-project revision give 404, on every new route. |
| E1 | Engineering assessment, evidence packages, Phase 37 graph and overview responses are unaffected, apart from the additive discovery entries. Existing suites pass. |
| G1 | Route catalog, OpenAPI, Sentry allowlist, discovery and import-boundary tests pass. The migration replay test pins the new table and its foreign keys. |
| G2 | Build, typecheck, lint, the full suite on Node 22.22.0 and 22.23.3, container smoke and `npm audit --omit=dev --audit-level=high` all pass. |

---

## 6. Out of scope (with reasons)

- **Image, render, panorama, video and 3D generation:** no transport, provider or validator exists; repository assignment "B39/B43".
- **OCR, vision, PDF text extraction and reference content analysis:** no transport or library exists, and the privacy and data-transfer policy is undecided (Phase 36 D7).
- **AI-written geometry, layouts, dimensions, quantities, costs or engineering statements:** these are refused by contract and by guard.
- **Automatic execution of the proposed appearance operation:** it is submitted only by the client, through Phase 30.
- **Workflow integration of `INTERIOR_DESIGN` and `EXTERIOR_DESIGN`:** it needs workflow SQL changes and an artifact contract.
- **Distributed or cross-process rate limits and a billing ledger:** limits are process-local (Phase 21), plus the per-owner SQL quota.
- **Phase 40 and later.**

## 7. Open questions for the owner

1. Q4: provider routing in Phase 38 (owner draft r1) or 39/43 (repository). This phase follows the repository.
2. Which provider, if any, to enable for concepts, and whether remote, metered use is acceptable (privacy and cost policy).
3. Whether the per-owner quota of 50 provider-sourced sets per 24 hours is the right default.
4. Whether reference content analysis (vision or OCR) belongs in B41 or B43, and under what data-transfer consent.
