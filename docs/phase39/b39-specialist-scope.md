# B39: Six Specialized Architectural AI Workflows — Scope, Envelope Contract and Slice Plan

**Status:** scope of record **before any B39 code**, as readiness r3 §9.2 and the B37 acceptance record (§10.1 on PR #17) require. Written 2026-10-14. **Documentation only:** no code, migration, test, OpenAPI or deployment change.

**Owner decisions recorded 2026-10-14 (§9):**
- **D-4 accepted:** this scope and its module order.
- **D-8b:** specialist results are computed on read for S1 and S2.
- **D-12** (formerly D-9b): the Interior schema decision stays **pending**.

**Bases:**
- This branch is based on PR #18 (`docs/b39-scope-correction` @ `8dd7880`), which carries the authoritative roadmap into the development branch. PR #18 is merged into `phase31/development` as `aac8e89`.
- Code citations refer to `phase37/manifest-v2` @ `dcd15c5` (PR #17). That is `phase31/development` @ `d0cd38b` plus the B37 manifest. Paths are repository-relative.

**Authority:** [`docs/sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md`](../sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md) (sha256 `0ebc4479…3a03`), cited as ROADMAP Lnnn.

**Labels:**
- **ROADMAP:** roadmap text.
- **CONFIRMED:** a repository fact, with a citation.
- **ACCEPTED:** this document's design, accepted by the owner (D-4, §9).
- **PROPOSED:** this document's design, still awaiting an owner decision.
- **UNCERTAIN:** not established.

---

## 1. What B39 must deliver (ROADMAP L283–297)

| Requirement | ROADMAP |
|---|---|
| One typed specialist request envelope: project and base revision, scope/locks, references, output config, provenance, quote/budget, jobs, dependency impacts, immutable candidate/approval lifecycle | L288 |
| Interior: furnishings/finishes and bounded interior layout edits, independent spatial/egress checks, interior-only outputs | L289 |
| Exterior: façade materials, massing only where supported, glazing/canopy constraints, exterior-only outputs | L289 |
| Blueprint: site and room layout/precision solve, wall/door/stair layers, drawing data, independent QA | L290 |
| Structural: solver-backed load/result/assumption/evidence retrieval; no fabricated certification | L290 |
| Materials: quantities, deterministic recipes, units, substitutions, supplier/rate provenance, geometry/material-change impact | L291 |
| Budget: regional versioned rates, currency, BOQ, scenario recalculation with honest partial/unknown totals | L291 |
| Reuse B6/B10/B19/B22/B24–28 engines and B30 guards; no "LLM invented dimensions"; no image-only simulation passing as geometry | L292 |
| Typed `unsupported`, `requires_review`, `degraded_provider`, `stale_dependency`, `partial`; per-module role and cost policies; scenario fixtures; workflow coverage | L293 |
| **Gate:** one supported request per module through real backend adapters; common revision IDs and invariant locks; changes fed to the shared B37 manifest and affected cost/engineering freshness | **L297** |
| Scenarios: 33–38 (one per module), 39 (cross-module propagation), 42 (strict preservation lock), 46 (six real modes with typed refusal) | L763–769, L775, L779 |
| Shared contract (proposed semantics, "confirm names and shapes against real backend code"): `RevisionRequest`, `RevisionPreflight`, `RevisionJobState`, `ArtifactReference`, seven contract surfaces, the execution state machine and its branches | §E L509–585 |
| B40 composes B39 specialists as reusable workers | §I rule 3, L735 |

## 2. What exists (CONFIRMED)

### 2.1 The Phase 30 lifecycle already is most of the §E state machine

| §E element (L527–585) | Existing equivalent | Citation |
|---|---|---|
| `RevisionRequest` with `baseRevisionId`, `instruction`, `targetScopes`, `preserveScopes` | Preflight body `{ baseRevisionId, request: { text } \| { operation } }`; structured `APPEARANCE_MODIFY {target, finish, preserve[≤16]}` and `RESTORE {sourceRevisionId}` | `apps/api/src/revision/contracts.ts:58-63` |
| `clientRequestId` (idempotency) | Every command goes through `durableCommand`, and the operation paths are on the idempotency whitelist | `apps/api/src/routes/revisions.ts:29,48,56,65`; `supabase/migrations/0023_account_library_context.sql:79-99` |
| `RevisionPreflight`: `hardLocks`, `requiredRechecks`, `blockers`, `clarifications`, `estimatedCost` | `PreflightSchema`: `targets`, `excluded`, `locks[≤32]`, `impacts[≤24]` (`REGENERATE \| REUSE_SOURCE_EQUIVALENT \| INVALIDATED \| NOT_AFFECTED \| BLOCKED`), `verifications`, `blockers`, `questions`, `quote` (local, no provider cost) | `revision/contracts.ts:75-95` |
| Branches `needs_clarification`, `unsupported`, `blocked_by_lock` | Preflight statuses `NEEDS_CLARIFICATION`, `UNSUPPORTED`, `BLOCKED_BY_LOCK` (plus `AWAITING_CONSENT`) | `revision/contracts.ts:82` |
| Consent/cost confirmation | Execute requires `{ preflightHash, consent: { acceptLocks: true, acceptQuote: true } }` | `revision/contracts.ts:116` |
| `candidate_ready`, `approved`/`committed`, `rejected`, `cancelled`, `failed`, `validation_failed`, `stale_base` | `OPERATION_STATUSES`; a SQL transition trigger | `revision/contracts.ts:114-115`; `0020_revision_operations.sql:10-11,119-120` |
| Optimistic commit with expected base; reject on stale base | `STALE_BASE` on execute and at approve; a preflight requires the base to be current | `0020:229,268-271,310-311` |
| Compare base vs candidate | `GET …/comparison`, `/validation`, `/candidate/manifest`, `/candidate/glb` | `routes/revisions.ts:67-99` |
| Restore via new immutable revision | `RESTORE` kind | `revision/contracts.ts:58-61` |
| Independent checks; strict preservation lock (scenario 42) | Byte-identical GLB geometry check; SQL `geometryLock.identical`; model hash equality at commit (`P3007`); blueprint QA re-run at approval | `revision/verify.ts:84-121`; `0020:284,319-320`; `services/revision-service.ts:103-104` |
| Jobs (`queued`, `running`) | Durable jobs, including `REVISION_EXECUTE`. Statuses `QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED` | `jobs/contracts.ts:6-8,14-18` |
| `ArtifactReference.freshness` (six states) | B37 manifest v2: per-module freshness, `changeImpact`, `freshnessImpact`, `candidates`, `failedGenerations`, `APPEARANCE_VARIANT` | `contracts/project-manifest.ts`; PR #17 |

**Limits that bound a specialist (CONFIRMED):**
- Phase 30: 2,000-character text, 5 active operations per project, 60 per hour, 24-hour expiry (`revision/contracts.ts:10`).
- Jobs: 4 active per project, 8 per owner, 3 attempts (`jobs/contracts.ts:4-5`; `0023:65`).
- **Kinds:** only `APPEARANCE_MODIFY` and `RESTORE` exist as operation kinds, and SQL enforces it (`0020:9`). Job kinds are `SCENE_COMPILE`, `OPTIMIZATION_STUDY` and `REVISION_EXECUTE` (`0022_durable_jobs.sql:8`).

### 2.2 Engines per module

| Module | Engine and route | Hard limits and statuses | Citation |
|---|---|---|---|
| Blueprint | Blueprint and parametric generators; `POST /api/projects/:id/revisions[/generate]`; `blueprint-qa-v1`; B34 `complex-verification-v1` (`VERIFIED \| VERIFIED_WITH_WARNINGS \| PARTIAL \| FAILED`) and its diff | 24 rooms, 2 floors (`BLUEPRINT_LIMITS`; `GENERATION_MAX_FLOORS`) | `packages/generator/src/blueprint/input.ts:7`; `apps/api/src/engineering/capability-limits.ts:15-16`; `apps/api/src/verification/contracts.ts:3,37` |
| Structural | `…/structural` validate, analyses and status; `nekoarch-reference-frame-3d`, `LINEAR_STATIC` only; engineering assessment with `REQUIRES_PROFESSIONAL_REVIEW`, `UNSUPPORTED` and blockers | 800 members, 8 load cases; claims `designVerification: NOT_EVALUATED`; `VALIDATED_ENGINEERING_SOLVERS` is an unsupported operation | `apps/api/src/structural/contracts.ts:11-12,166`; `structural/frame-solver.ts:171-174`; `engineering/contracts.ts:24-26`; `capability-limits.ts:36-50` |
| Materials | Takeoff (`EVALUATED \| PARTIAL \| NOT_EVALUATED`); construction calculations with recipe pack v1 (`tile-area/1` is `PARTIAL`) | 5,000 entities. **No substitution provenance exists** | `packages/quantity-takeoff/src/report.ts:5-12`; `packages/construction-calculations/src/recipes.ts:2-11`; `apps/api/src/content/disclaimers.ts:4` (the only "substitution" match, unrelated) |
| Budget | Cost estimates; rate books `sample-inr-v1 \| v2`, both **synthetic, "NOT CURRENT MARKET DATA"**; currency `INR \| USD \| EUR`. A missing rate gives an `UNPRICED` line with `COST_RATE_MISSING`; coverage is `FULLY_PRICED \| PARTIALLY_PRICED \| NOT_PRICED` | No regional or current-market rates | `apps/api/src/contracts/costs.ts:4`; `packages/boq-cost/src/demo.ts:6-7`; `packages/boq-cost/src/calculate.ts:47,93`; `boq-cost/src/contracts.ts:20,58` |
| Exterior | Phase 30 `APPEARANCE_MODIFY`: 4 visual presets on `EXTERIOR_WALLS`. PR #16 advisory `EXTERIOR_DESIGN_CONCEPT` with a `NOT_EXECUTED` proposed operation | `ENVELOPE_GEOMETRY_REGENERATION` and `EXTERIOR_RENDER` unsupported | `revision/contracts.ts:23-39`; `contracts/design-concepts.ts:75-80`; `capability-limits.ts:42`; `services/overview-service.ts:114` |
| Interior | PR #16 advisory `INTERIOR_DESIGN_CONCEPT` (finish text, ≤ 8 spaces). **No interior operation**: the Phase 30 planner refuses `INTERIOR_FINISH_NOT_SUPPORTED`, and conversation refuses `INTERIOR_APPEARANCE_UNSUPPORTED` | V2 `SpaceSchema` has no finish fields, only `specificationId?`; `SpecificationSchema {id, name, material?, reference?}` | `contracts/design-concepts.ts:63-64`; `revision/plan.ts:71-75`; `conversation/interpret.ts:128-129`; `packages/shared/src/building-v2/spaces.ts:4-10`, `common.ts:5-8` |

### 2.3 Typed-status analogues (CONFIRMED; the roadmap's lowercase tokens appear nowhere in code)

| Roadmap status (L293) | Existing values it can be derived from | Citation |
|---|---|---|
| `unsupported` | Preflight `UNSUPPORTED`; engineering `UNSUPPORTED`; `UNSUPPORTED_OPERATIONS`; media `UNSUPPORTED` | `revision/contracts.ts:82`; `engineering/contracts.ts:24-25`; `capability-limits.ts:36`; `overview-service.ts:114-117` |
| `requires_review` | `REQUIRES_PROFESSIONAL_REVIEW`, `REQUIRES_INPUTS`, `REQUIRES_SOURCE_VERIFICATION`, `REQUIRES_SOLVER`; blocker `PROFESSIONAL_REVIEW` | `engineering/contracts.ts:24,26` |
| `degraded_provider` | Provider health `DEGRADED`; design provenance `FALLBACK` / `fallbackReason` | `ai/orchestration/orchestrator.ts:5,17`; `contracts/design-concepts.ts:90,93` |
| `stale_dependency` | Graph `STALE_UPSTREAM_STALE`; cause `UPSTREAM_STALE`; manifest `stale`; preflight impacts `INVALIDATED` | `contracts/dependency-graph.ts:8,19-21`; `contracts/project-manifest.ts`; `revision/contracts.ts:77` |
| `partial` | Verification, takeoff, construction and optimization `PARTIAL`; `PARTIALLY_EVALUATED`; `PARTIALLY_PRICED` | `verification/contracts.ts:37`; `quantity-takeoff/src/report.ts:12`; `engineering/contracts.ts:24`; `boq-cost/src/contracts.ts:58` |

### 2.4 What is not an envelope (CONFIRMED)

- **Workflows:** `INTERIOR_DESIGN` / `EXTERIOR_DESIGN` are `PLANNED` and `contract-v1`. Their modes are blocked with `CAPABILITY_NOT_IMPLEMENTED`. A run has no scope, lock, quote or job fields. (`apps/api/src/workflows/registry.ts:17,32-33,43-44`; `workflows/planner.ts:35-42`; `contracts/workflows.ts:60-66`)
- **Conversation:** it proposes Phase 30 operations under leases, with re-preflight on confirm. Its operation kinds are `REQUIREMENTS_CHANGE, EXTERIOR_APPEARANCE, RESTORE, ZONE_REGENERATION`. (`contracts/conversation-memory.ts:18`; `conversation/actions.ts:148-174`)

## 3. Envelope contract `specialist-request-v1` (ACCEPTED, D-4)

**Principle:** one envelope over the existing lifecycle, not a parallel one.
- §E tells implementers to "confirm names and shapes against real backend code" and to "introduce additional routes only when necessary" (L511, L514, L579).
- The Phase 30 operation already implements the request → preflight → consent → execute → candidate → approve/commit machine with stale-base safety. The envelope therefore **normalizes** each specialist onto it, or onto an existing derived-on-read engine route, and reports one typed result.

### 3.1 Request

```ts
// ACCEPTED (D-4). Names follow §E where they match existing code; existing names win where they differ.
type SpecialistModule = 'INTERIOR' | 'EXTERIOR' | 'BLUEPRINT' | 'STRUCTURAL' | 'MATERIALS' | 'BUDGET';
type ComponentScope = /* §E L519–525, verbatim */ string;
interface SpecialistRequest {
  envelopeVersion: 'specialist-request-v1';
  module: SpecialistModule;
  baseRevisionId: string;                 // must be the project's current revision for a change (Phase 30 rule, 0020:229)
  operation: 'modify' | 'regenerate' | 'generate_alternative' | 'recompute' | 'compare' | 'restore';   // §E L515–517
  instruction?: string;                   // ≤ 2,000 chars (Phase 30 limit)
  targetScopes: ComponentScope[];
  preserveScopes: ComponentScope[];       // mapped to Phase 30 PRESERVATION_SCOPES (revision/contracts.ts:52)
  referenceIds?: string[];                // Phase 31 references, metadata only (as PR #16)
  outputConfig?: Record<string, unknown>; // module-specific and strict, e.g. a Budget rateBookId and currency
  budget?: { ceiling: string; currency: 'INR' | 'USD' | 'EUR' };
}
```

`clientRequestId` is the existing `Idempotency-Key` header (durableCommand), not a body field.

### 3.2 Result

```ts
// ACCEPTED (D-4).
type SpecialistStatus = 'COMPLETED' | 'CANDIDATE_READY' | 'AWAITING_CONSENT' | 'NEEDS_CLARIFICATION'
  | 'UNSUPPORTED' | 'REQUIRES_REVIEW' | 'DEGRADED_PROVIDER' | 'STALE_DEPENDENCY' | 'PARTIAL' | 'BLOCKED_BY_LOCK' | 'FAILED';
interface SpecialistResult {
  envelopeVersion: 'specialist-request-v1';
  module: SpecialistModule;
  projectId: string; baseRevisionId: string; resultRevisionId: string | null;   // common revision IDs (gate L297)
  status: SpecialistStatus; reasons: { code: string; message: string }[];
  locks: Lock[];                          // as Phase 30 LockSchema
  impacts: Impact[];                      // as Phase 30 ImpactSchema, plus the B37 manifest changeImpact once committed
  operationId: string | null;             // the Phase 30 operation, when the module changes the model
  jobIds: string[];
  artifacts: ArtifactReference[];         // §E L557–565; freshness from the B37 manifest, never computed separately
  quote: Quote;                           // the Phase 30 quote: LOCAL_DETERMINISTIC, externalCostUsd 0 until B43
  provenance: { engine: string; engineVersion: string; providerId: string | null; inputHash: string };
  manifestHref: string;                   // …/revisions/:resultRevisionId ?? baseRevisionId/manifest
  claims: { engineeringCorrectness: 'NOT_CLAIMED'; solverValidation: 'NOT_CLAIMED'; professionalReview: 'NOT_CLAIMED' };
}
```

### 3.3 Typed statuses (L293), derived only from existing evidence

| Status | Assigned when | Source of truth |
|---|---|---|
| `UNSUPPORTED` | The module cannot honour the request: preflight `UNSUPPORTED`, an `UNSUPPORTED_OPERATIONS` entry, or a hard limit exceeded (for example a Blueprint request above 2 floors) | §2.3 |
| `REQUIRES_REVIEW` | The output exists but carries `REQUIRES_PROFESSIONAL_REVIEW` / `REQUIRES_SOURCE_VERIFICATION`, or rates are synthetic | §2.3; `boq-cost/src/demo.ts:6-7` |
| `DEGRADED_PROVIDER` | An AI-assisted step used a fallback (`FALLBACK`) or the provider is `DEGRADED`. Deterministic modules never report it | §2.3 |
| `STALE_DEPENDENCY` | An input the module reads is `stale` or `blocked` in the B37 manifest (e.g. Budget on a stale takeoff) | B37 `freshnessImpact` |
| `PARTIAL` | The engine reports `PARTIAL` / `PARTIALLY_PRICED` / `NOT_EVALUATED` lines. Unpriced lines are listed, **never zero** (scenario 38, L768) | §2.3 |

Rules:
- A status is never upgraded by the envelope.
- When several apply, all are listed in `reasons`. The reported `status` is the most restrictive one, in this order: `UNSUPPORTED > BLOCKED_BY_LOCK > STALE_DEPENDENCY > REQUIRES_REVIEW > PARTIAL > DEGRADED_PROVIDER`.

### 3.4 Surfaces (§E L569–577)

**ACCEPTED (D-4), minimal.** One new route family, `…/projects/:projectId/specialists/:module/requests`, carrying POST (preflight or run). It composes existing services:
- model-changing modules return the Phase 30 `operationId`, and the existing execute/approve/comparison routes complete the lifecycle;
- derived modules return the engine's stored artifact ids.

No existing route changes.

**No GET by id (D-8b).** Results are computed on read and not stored, so there is no specialist-result history and nothing to fetch by request id. The stored outputs stay readable through their engine routes and the B37 manifest. A retry with the same `Idempotency-Key` replays the engines' durable receipts. Durable result history or fetch-by-id would need a separate owner decision and a migration.

## 4. Modules: first supported request, reuse and typed refusals (ACCEPTED, D-4)

Order from readiness §5.2, **accepted by the owner (D-4, 2026-10-14)**: 1 Blueprint, 2 Materials, 3 Budget, 4 Exterior, 5 Structural, 6 Interior.

| # | Module | First supported request (scenario) | Reuses | Typed refusals and statuses | Migration? |
|---|---|---|---|---|---|
| 1 | **Blueprint** | Blueprint-only regenerate from requirements on the current base: a new revision with QA and the B34 verifier, and **no render or scene jobs** (35, L765) | Generators, `blueprint-qa-v1`, `complex-verification-v1` | `UNSUPPORTED` above 2 floors. More than 24 requested rooms is **not** a typed refusal: the existing requirements schema rejects it with a 400 validation error (`packages/generator/src/blueprint/input.ts:38`), and that input contract is unchanged. QA failure → `FAILED` with the report | None |
| 2 | **Materials** | Takeoff and construction calculation for a revision, with units, recipes and provenance (37, L767) | Takeoff, construction calculations | `PARTIAL` for partial recipes; **substitutions `UNSUPPORTED`** (no provenance exists, §2.2); `STALE_DEPENDENCY` when the takeoff is stale | None |
| 3 | **Budget** | Cost estimate with an explicit rate book and currency (38, L768) | BOQ/cost | **Always `REQUIRES_REVIEW` while only the synthetic rate books exist**; `PARTIAL` with `unpricedLineIds`; never zero; regional versioned rates `UNSUPPORTED` until a sourced rate book exists | None |
| 4 | **Exterior** | Cladding swap through Phase 30 `APPEARANCE_MODIFY` with plan and structure locks (34, L764) | Phase 30 lifecycle, `APPEARANCE_VARIANT` in the manifest | Glazing or massing geometry → `UNSUPPORTED` (`ENVELOPE_GEOMETRY_REGENERATION`), with the impacted engineering listed. This is where the waived B37 item **U2** (element-level differential invalidation, PR #17) must be closed | None for cladding; U2 needs per-output input scopes (§5) |
| 5 | **Structural** | Structural-only analysis on a revision, with solver evidence, assumptions and review state (36, L766) | Structural routes, engineering assessment | **Always `REQUIRES_REVIEW`**; certification is never claimed; validated solvers `UNSUPPORTED` | None |
| 6 | **Interior** | **None today.** A design-only change needs finish data on V2 spaces, and no interior operation exists (33, L763) | PR #16 advisory concept, as an advisory sub-output (D-6) | `UNSUPPORTED` for every edit until a typed interior operation exists. The advisory concept routes are not a supported Interior implementation | **Yes**: a new operation kind (`0020:9` check) and V2 space finish fields. **Pending owner decision D-12** |

**Gate reading (L297), ACCEPTED (D-4).** "One supported request for each of six modules" cannot be met for Interior without a model change. The scope therefore splits into:
- **S1–S2:** the five modules that can be met with no migration;
- **S3:** Interior, which needs owner-approved schema work (D-12, pending).

B39 is complete only after S3. Interior is not waived by this document.

## 5. B37 manifest integration and the U2 obligation

- **Revision identity and freshness (gate L297; scenario 39, L769).**
  - Every result carries `baseRevisionId` / `resultRevisionId` and a `manifestHref`.
  - Artifact freshness is read from the B37 manifest (`modules[].artifacts[].freshness`), never recomputed.
  - Candidates appear in `manifest.candidates` until approved. Committed changes appear in `lineage`, `diff`, `changeImpact` and `freshnessImpact`.
- **U2: element-level differential invalidation (L258; scenario 34).** The B37 acceptance record (PR #17: `phase37-completion-scope.md` §8.4, `phase37-acceptance-gap-report.md` §5) assigns U2 to the B39 exterior specialist, with retrofits #24 and #04. The roadmap text to meet (L258): "façade cladding alone differs from changing curtain-wall glazing area". This document's reading of it: a cladding-only edit leaves quantities current; a glazing-area edit marks them stale.
  - **Why it fails today:** freshness binds to revision identity, not to what each output read. Any committed change, even a model-equivalent one, makes a new revision current, and every stored output of the base reads `stale` with `SOURCE_REVISION_SUPERSEDED`. Its quantities and cost are then listed under `freshnessImpact.regenerate` (PR #17 gap report §5, U2).
  - **What closes it:** per-output **input scopes**. Each output records the model collections or entities it read, and invalidation compares those.
  - **Note:** a Phase 30 appearance edit is model-equivalent: `changeImpact` reports `NOT_AFFECTED` / `MODEL_UNCHANGED`. **It does not close U2.** After a cladding-only edit, the base's takeoff, construction calculation, cost and scene are still `stale` and listed under `regenerate`, and the new revision starts with none of them. The PR #17 test "M4 gate with the B30 exterior-appearance fixture" in `apps/api/tests/project-manifest.integration.test.ts` asserts exactly this. So today a cladding-only change still requires downstream quantity and cost regeneration. A glazing change is unsupported (§4, row 4).
  - **Proposed handling:** U2 becomes a B39 acceptance criterion when the first geometry-changing Exterior request is supported. That needs a geometry-editing engine, which does not exist (`capability-limits.ts:42`).

## 6. Migrations (none authorized)

| Slice | Need | Migration |
|---|---|---|
| S1 envelope + Blueprint, Materials, Budget | Derived modules over existing routes; envelope results computed on read (D-8b) | **None.** No `0029_specialist_requests` and no durable result storage (D-8b, 2026-10-14) |
| S2 Exterior (cladding) + Structural | Existing Phase 30 and structural persistence; envelope results computed on read (D-8b) | None |
| S3 Interior | New revision-operation kind and V2 space finish data | **Only if D-12 is approved:** the next sequential migration extends the `0020:9` kind check (superset), plus the shared V2 schema. Replay pin, local Supabase receipt, owner approval. Not authorized |
| Specialist jobs | Only if a specialist runs as a durable job | Extend `0022:8` (and `0025:10` if gateway-eligible), plus `JobKindSchema`, executors and runner records (`jobs/contracts.ts:6`; `jobs/executors.ts:60-77`; `jobs/runner.ts:21-22`) |

## 7. Slices and acceptance criteria (ACCEPTED, D-4)

| Slice | Contents | Acceptance (each has automated tests; ROADMAP scenario) |
|---|---|---|
| **S1** | Envelope contract and route family; Blueprint, Materials, Budget | Envelope schema strict. Each module's supported request succeeds on Postgres with common revision ids (35, 37, 38). Typed refusals for >2 floors, substitutions and synthetic rates (46). Unpriced is never zero (38). `STALE_DEPENDENCY` from a stale manifest input. Results link the manifest. No render or scene job is created by Blueprint (35) |
| **S2** | Exterior (cladding) and Structural | Cladding swap through Phase 30 with locks; protected geometry is hash-identical (42); the manifest links `APPEARANCE_VARIANT` (34). A glazing change is `UNSUPPORTED` with impacted engineering listed. Structural is always `REQUIRES_REVIEW`; no certification claim (36) |
| **S3** | Interior operation (needs D-12 approval; pending) | A design-only change preserves exterior and structural locks; an unsupported space-planning edit asks for scope expansion (33) |
| **Gate** | All six | One supported request per module through real adapters; one source revision across the manifest, cost and engineering freshness (L297, scenario 39); live Supabase case; full suite, CI, OpenAPI and route catalog |

## 8. Safeguards carried forward

- **Phase 35 V2 research and source integrity.**
  - B39 introduces no standard, clause, factor, rate, supplier price or citation.
  - The Phase 35 research document stays unverified and unused (`phase39-scope.md` §1.3).
  - Budget reports synthetic rate books as such (`REQUIRES_REVIEW`).
  - Materials reports no supplier provenance it does not have (substitutions `UNSUPPORTED`).
- **No fabricated engineering.** Every result carries the three `NOT_CLAIMED` claims; Structural never certifies (L290).
- **No AI-invented geometry** (L292). AI steps stay advisory (PR #16 output guard), and model changes go only through deterministic engines and the Phase 30 guards.
- **Compatibility.** The envelope is additive. No existing route, schema or status changes; existing suites stay unchanged.

## 9. Decisions for the owner

The B37 acceptance record (PR #17, `phase37-acceptance-gap-report.md` §11, recorded 2026-10-14 at `20a7620`) lists:
- D-8 **Accept** (B37 development-complete; not a release);
- D-4 **settle in this document**;
- D-6 **Reuse**;
- D-7 **Defer**.

This document follows those entries. The owner recorded the decisions below on 2026-10-14, after the scope corrections in `229d470` and `11f8c2c`.

| ID | Decision | State |
|---|---|---|
| D-4 | This scope, the module order (§4) and the interior meaning: finish and furnishing data on V2 spaces (L289) | **Accepted** (2026-10-14). Order: Blueprint, Materials, Budget, Exterior, Structural, Interior |
| D-6 | PR #16 design-concept routes | **Recorded: reuse** as an advisory sub-output of Interior/Exterior, not as the specialists (§4) |
| D-7 | Discovery clarification (readiness r3 §9.5) | **Recorded: defer**; the phase39 API guidance stays the interim |
| D-8b | Derived (no migration) or durable (`0029_specialist_requests`) envelope results | **Recorded: computed on read for S1 and S2** (2026-10-14). No `0029` for result storage. Why: freshness is read from the current manifest rather than stored where it would go stale, and this matches the derived-on-read architecture (B37 manifest) without migration or operational risk. Trade-off: no durable result history and no fetch-by-id (§3.4), unless separately decided later |
| D-12 | Approve the S3 interior schema work: a new revision-operation kind and V2 space finish fields. **Renamed from D-9b** (2026-10-14) so it cannot be confused with the D-9 hosted migration-history gate | **Pending.** Until approved, Interior answers a typed `UNSUPPORTED`, and the PR #16 advisory concepts do not count as a supported Interior request. The L297 gate cannot be met for Interior without it |
| — | Merge PR #18 (the roadmap on the development branch) and PR #17 before S1 code starts | PR #18 **merged** (`aac8e89`). PR #17 **merged** on owner authorization (`4d1da13`, 2026-10-14) |

## 10. Out of scope

- B40 composition.
- B43 provider routing, evaluation and spend ledger.
- Render, panorama and video.
- OCR or vision on references.
- Validated engineering solvers.
- Sourced market rate books.
- Hosted migrations, staging and tags.
