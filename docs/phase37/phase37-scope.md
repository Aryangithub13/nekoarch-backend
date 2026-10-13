# Phase 37: Dependency Graph and Freshness Propagation — Scope and Acceptance

**Status:** Scope of record for implementation. Written 2026-10-13, before any Phase 37 code.

**Base:** `phase31/development` at `b6a3640`, after PR #7 (Phase 35) merged. All file and line citations refer to that commit unless stated otherwise.

**Rule for this document:** every statement is marked as one of:
- **CONFIRMED:** present in the repository, with a citation.
- **PROPOSED:** this document's design.
- **UNKNOWN:** not recoverable.

---

## 1. Where the Phase 37 theme comes from

### 1.1 Confirmed

The repository repeatedly assigns this work to Phase 37 / B37 as deferred later-phase work:

| Source | Text |
|---|---|
| `docs/phase30/phase30-report.md:165` | "Unified multidisciplinary dependency graph (beyond the bounded Phase 30 impact model) \| 37" |
| `docs/modernization/modernization-report.md:51` | Row 17, "Generation identity and freshness": "The dependency graph → future:37." |
| `docs/modernization/modernization-report.md:226` | "Unified dependency graph, cross-discipline freshness propagation \| B37" |
| `docs/phase33/phase33-design.md:106` | "Unified dependency graph across all artifacts \| 37" |
| `docs/phase35/phase35-design.md:165` | "Cross-discipline dependency graph and freshness propagation of assessments \| B37" |
| `docs/phase35-1/phase35-1-design.md:238` | "Dependency graph and freshness propagation: B37." |
| `docs/phase35-1/phase-1-46-reconciliation.md:62` | "37 \| Unified multidisciplinary dependency graph and freshness propagation (AS) … Not started" |
| `docs/phase36/phase36-handoff.md:83` | "Unified dependency graph and freshness propagation (B37)" |

`docs/PHASE16.md` §5 already describes the artifact graph as "a reference graph over the existing normalized tables. It does not replace them with a generic report store." This document follows that principle.

### 1.2 Unknown

- **The original roadmap text and its acceptance criteria for Phase 37.**
  - The canonical 46-phase roadmap was never recovered (PR #7 scope-of-record note).
  - `docs/roadmap/*` on the unmerged branch `docs/roadmap-research-baseline` (`56764c5`) is a reconstruction. Its decisions register (Q9) lists the Phase 37 scope as needing owner confirmation.
  - The theme above is therefore the best-supported reading, not confirmed roadmap text.
- **The Phase 35 V2 research** (`NekoArch_Phase35_Engineering_Research_Enhanced_v2_2026-10.md`) stays labelled reconstructed and unverified:
  - it has 0 sources and 0 claims;
  - RCH-001 to RCH-012 are `NOT_RESEARCHED`.
  - Phase 37 uses none of it. This phase adds no citation, standard, source record or validation claim.

---

## 2. Existing linkage (confirmed)

Facts the design depends on:

1. **Revisions** (`0006:27-46`)
   - Immutable, owner-scoped.
   - `acceptance_qa_id` has a deferred FK to `project_revision_qa_runs(revision_id, id)` (`0006:61-62`).
   - There is no `model_hash` column. The model hash lives in the nullable `generation_identity->>'modelHash'` (`0011:37-41`). A CHECK recomputes it from `model_json` when present (`0011:17-36`).
   - TS mirror: `modelHash()` in `apps/api/src/lib/generation-identity.ts:26-28`.
2. **Takeoffs** (`0007`)
   - Links: `project_revision_id`, `acceptance_qa_id` (composite FK).
   - `input_fingerprint` = sha256 of canonical `{projectRevisionId, model, engineVersion, measurementPolicyVersion, options}`. It is verified by `takeoff_write`. TS: `takeoffFingerprint` in `services/takeoff-service.ts`.
3. **Construction calculations** (`0008`)
   - Links: `takeoff_id` (composite FK to the same revision's takeoff), `acceptance_qa_id`.
   - Fingerprint includes the takeoff fingerprint and a hash of the takeoff report. TS: `constructionFingerprint`.
4. **Cost estimates** (`0009`)
   - One 4-column composite FK to `(revision, takeoff, acceptance QA, construction calculation)`.
   - Stores `construction_report_hash`, `report_hash` and `input_fingerprint`. TS: `costInputFingerprint`, `costHash`.
5. **Analyses**
   - Structural (`0014`), environmental (`0015`), building systems (`0016`), specialized knowledge (`0017`), optimization (`0018`) and scene (`0019`).
   - Each stores `project_revision_id`, `acceptance_qa_id`, `model_hash` and `input_hash`.
   - Systems may reference one structural and one environmental analysis (`0016:8-9`).
   - Knowledge may reference structural, environmental and systems analyses (`0017:8-10`).
   - Same-revision is enforced in the write functions.
   - The summary DTOs expose all of these fields, for example `StructuralSummarySchema` in `structural/contracts.ts:177`.
6. **Hashes are checked at write time only, in SQL.** No read path compares a stored artifact's `model_hash` with its revision.
7. **"Stale" has two existing meanings, both preserved unchanged:**
   - Per-service `currency()`:
     - `status: analysisRevisionId === projectCurrentRevisionId ? 'CURRENT' : 'STALE'` (`services/structural-service.ts:18-19`, mirrored in five services).
     - `staleAnalyses` / `staleStudies` / `staleArtifacts` counts feed `project-overview-v1` (`services/overview-service.ts:140-145`).
   - `generation-freshness-v1` (`contracts/freshness.ts`; SQL `project_private.current_artifacts`, `0011:47-64`):
     - covers takeoff, construction and cost;
     - statuses are `AVAILABLE` / `NOT_GENERATED_FOR_CURRENT_REVISION` / `NO_CURRENT_REVISION`.
8. **All reads are owner-scoped.** Each read RPC is `SECURITY DEFINER`, checks `owner_id = auth.uid()` and maps the failure to 404.
9. **BIM has no persisted artifact** (`DERIVED_ON_READ`). The engineering assessment, zones, partitions and project context are also derived on read.

---

## 3. Design (proposed)

### A1. A bounded, read-only graph built from existing linkage

- **Route:** `GET /api/projects/:projectId/revisions/:revisionId/dependency-graph`.
  - Takes no query parameters (strict empty query).
  - Falls into the `read` rate-limit group automatically.
  - Contract version: `dependency-graph-v1`.
- **No migration, table, RPC, environment variable or dependency.**
  - The graph is assembled in TypeScript from existing owner-scoped repository reads: project revision, takeoff, construction and cost list and read, and the six analysis lists.
  - A migration is not necessary, because every link and hash the graph needs is already exposed by the existing DTOs (§2).
- **Node families, in a fixed order:**
  `REVISION`, `ACCEPTANCE_QA`, `QUANTITY_TAKEOFF`, `CONSTRUCTION_CALCULATION`, `BOQ_COST`, `STRUCTURAL_ANALYSIS`, `ENVIRONMENTAL_ANALYSIS`, `BUILDING_SYSTEMS_ANALYSIS`, `SPECIALIZED_KNOWLEDGE`, `DESIGN_OPTIMIZATION`, `SCENE_3D`.
- **Edges come only from stored links.** Each edge points from a dependent node to the node it depends on:

  | Edge kind | From | To | Stored link |
  |---|---|---|---|
  | `QA_OF` | `ACCEPTANCE_QA` | `REVISION` | `project_revisions.acceptance_qa_id` |
  | `BOUND_TO_REVISION` | every artifact | `REVISION` | `project_revision_id` |
  | `ACCEPTED_BY` | every artifact | `ACCEPTANCE_QA` | `acceptance_qa_id` |
  | `DERIVED_FROM` | construction | takeoff | `takeoff_id` |
  | `DERIVED_FROM` | cost | construction, takeoff | `construction_calculation_id`, `takeoff_id` |
  | `DERIVED_FROM` | systems | structural, environmental (when non-null) | `structural_analysis_id`, `environmental_analysis_id` |
  | `DERIVED_FROM` | knowledge | structural, environmental, systems (when non-null) | the three analysis ids |

  No other relationship is inferred. Same-family "newer artifact" relations are not edges.
- **Not represented, each listed in the response with a reason:**

  | Item | Reason |
  |---|---|
  | BIM, engineering assessment, zones, partitions, project context | `DERIVED_ON_READ`: no stored artifact |
  | Appearance variants, references, durable jobs, workflows, compute dispatches, conversations | `NOT_A_MODEL_DERIVED_ARTIFACT`, or link not stored as a foreign key |

### A2. States and propagation

**Gap resolution (decided before implementation).**
- The four requested states cannot express "provenance could not be verified":
  - Mapping it to `STALE_SOURCE_CHANGED` would claim a change that was never observed.
  - Mapping it to `CURRENT` or `NOT_GENERATED` would be false.
- `dependency-graph-v1` therefore has **five** states: the four requested, plus `UNVERIFIED`.
- This is a new contract, so adding the state breaks no client.

| State | Meaning |
|---|---|
| `CURRENT` | Every check in A2.1 passed for the node and for its whole dependency chain, and its revision is the project's current revision |
| `STALE_SOURCE_CHANGED` | Checks pass, but the node's revision is no longer the project's current revision |
| `STALE_UPSTREAM_STALE` | Checks pass, but an artifact it is `DERIVED_FROM` is stale |
| `UNVERIFIED` | A required identity, link or hash could not be verified for the node or its chain (fail closed) |
| `NOT_GENERATED` | Family level only: no artifact of that family exists for this revision |

#### A2.1 Per-node checks

Hashes are recomputed from the stored inputs, not just compared with each other.

| Node | Checks |
|---|---|
| `REVISION` | `modelHash(revision.model)` is recomputed. If `identity` is present, `identity.modelHash` must equal it (otherwise `REVISION_IDENTITY_INCONSISTENT`). An absent generation identity (historical or supplied revisions) is allowed, because the hash is recomputed from the immutable stored model. |
| `ACCEPTANCE_QA` | The run with `id = revision.qa.id` must exist, with status `PASS` or `PASS_WITH_WARNINGS`, `report.inputStatus = SCHEMA_VALID` and `report.summary.errors = 0`. This is the same gate the takeoff and construction writes use. Failure: `QA_NOT_ACCEPTED`. |
| Every artifact | `projectRevisionId` must equal the revision (`REVISION_BINDING_MISMATCH`). `acceptanceQaId` must equal `revision.qa.id` (`QA_BINDING_MISMATCH`). |
| Takeoff | `inputFingerprint` must equal `takeoffFingerprint({projectRevisionId, model, engineVersion, measurementPolicyVersion, options})` (`FINGERPRINT_MISMATCH`). |
| Construction | The referenced takeoff must be a node in the graph (`UPSTREAM_MISSING`). `inputFingerprint` must equal `constructionFingerprint(revision, takeoffDetail, constructionDetail.report)`. |
| Cost | The referenced construction and takeoff must be nodes, and the construction's `takeoffId` must equal the cost's `takeoffId` (`UPSTREAM_MISSING` / `LINK_INCONSISTENT`). Three hashes must match: `constructionReportHash = costHash(construction.report)`, `reportHash = costHash(cost.report)`, and `inputFingerprint = costInputFingerprint(…)`. |
| The six analyses | `modelHash` must equal the recomputed revision hash (`MODEL_HASH_MISMATCH`). Every referenced upstream analysis id must be a node in the graph (`UPSTREAM_MISSING`). |

**Analysis `inputHash` (`INPUT_HASH`, failure `INPUT_HASH_MISMATCH`), added during the repair pass.** Each analysis detail is read, and its `inputHash` is recomputed with the same function its write path uses, from the stored snapshot or manifest:

| Family | Recomputation |
|---|---|
| Structural | `structuralInputHash(snapshot.binding, snapshot.input, stored solver identity)` |
| Environmental | `environmentalInputHash(snapshot.binding, snapshot.input, stored calculator identity)` |
| Building systems | `systemsInputHash(snapshot.binding, snapshot.input, stored calculator identity)`; this also hashes the current `ROUTING_WEIGHTS` constant |
| Specialized knowledge | `knowledgeInputHash(snapshot.binding, snapshot.input)`. The write path's inline digest is now this exported function, unchanged. |
| Design optimization | `costHash(snapshot.input)` |
| Scene | `sceneInputHash(manifest.source)` |

The check passes only when the row's `inputHash`, the snapshot's (or manifest's) own `inputHash` and the recomputed value are all equal.
- An unreadable stored input fails the check instead of throwing.
- If a canonicalization constant changes in a later release (for example `ROUTING_WEIGHTS`), older rows become `UNVERIFIED` rather than being verified against a rule they were not hashed with.

What is still not recomputed: the solver and calculator outputs (`analysisModelHash`, `analysisInputHash`, `resultHash`, `factsHash`), because that would mean re-running the analyses. Those hashes describe results, not provenance, and the graph makes no claim about results.

#### A2.2 Propagation

Nodes are evaluated in dependency order. For each node, the first matching rule wins:

1. An own check fails → `UNVERIFIED`, cause = the check code.
2. Any dependency (any edge kind) is `UNVERIFIED` → `UNVERIFIED`, cause `UPSTREAM_UNVERIFIED` → that dependency.
3. Any `DERIVED_FROM` dependency is `STALE_*` → `STALE_UPSTREAM_STALE`, cause `UPSTREAM_STALE` → that dependency.
4. The node's revision is not the project's current revision → `STALE_SOURCE_CHANGED`, cause `SOURCE_REVISION_SUPERSEDED`, pointing at the `REVISION` node. The current revision is reported in `inputIdentity.projectCurrentRevisionId`.

Rule 1 includes `UPSTREAM_PRESENT`. Every node that names a `DERIVED_FROM` input carries this check, and so does any node with a dependency that has no node. A failed `UPSTREAM_PRESENT` check is reported as `UPSTREAM_MISSING`, pointing at the missing node id.
5. Otherwise → `CURRENT`.

Further rules:
- **Cause chain.** `causes[]` follows the first offending dependency (in node order) down to a root cause, so every non-`CURRENT` state can be explained without reading other nodes.
- **Family state** is `NOT_GENERATED` when the family has no nodes. Otherwise it is the worst node state, in the order `UNVERIFIED` > `STALE_UPSTREAM_STALE` > `STALE_SOURCE_CHANGED` > `CURRENT`.
- **Existing contracts are untouched:**
  - `project-overview-v1`, its per-service counts and `otherRevisionArtifacts`;
  - `generation-freshness-v1`;
  - every per-service `currency`.

### A3. Limits and refusals

| Limit | Value | Refusal |
|---|---|---|
| Nodes, revision and QA included | 128 | 422 `DEPENDENCY_GRAPH_LIMIT_EXCEEDED` (field `limit: NODES`) |
| Per-family page | 20; a non-null `nextCursor` means the family could not be listed completely | 422 `DEPENDENCY_GRAPH_LIMIT_EXCEEDED` (`limit: FAMILY_PAGE`) |
| Dependency depth (longest chain) | 8 (the real maximum is 5) | 422 `DEPENDENCY_GRAPH_LIMIT_EXCEEDED` (`limit: DEPTH`) |
| Wall time | 5,000 ms, checked after each read phase and after evaluation. A single slow read is not interrupted; the overrun is reported when it returns. | 422 `DEPENDENCY_GRAPH_LIMIT_EXCEEDED` (`limit: TIME`) |
| Cycles | Detected before evaluation (cannot occur under the stored foreign keys; checked anyway) | 422 `DEPENDENCY_GRAPH_CYCLE` |
| Read consistency | Within each listing round, the `projectCurrentRevisionId` values of the six analysis listings must agree. After the detail reads, everything is listed a second time, and the second round's artifact ids and current revision must equal the first round's. | 409 `DEPENDENCY_GRAPH_READ_INCONSISTENT` (retryable) |

Further rules:
- A partial graph is never returned. Every successful response is complete (`complete: true`); any limit hit is a refusal.
- The limit codes are checked in a fixed order, so the same state always gives the same refusal.

### A4. No assurance is raised

- The graph is provenance only. A node carries:
  - identity;
  - links;
  - check results;
  - state.
- It carries no engineering status, assurance level, evidence class, solver result or domain status.
- `CURRENT` means "bound to the current revision with verified identity". It does not mean correct, validated, reviewed or compliant.
- The response always includes `claims: { engineeringCorrectness: 'NOT_CLAIMED', solverValidation: 'NOT_CLAIMED', professionalReview: 'NOT_CLAIMED' }`.
- The graph never reads, writes or clears `REQUIRES_SOLVER`, `NO_VALIDATED_SOLVER` or `NOT_VERIFIED`. The engineering assessment is not a node.

### A5. Determinism, identity and authorization

- **Determinism.** Nodes are sorted by family order, then `createdAt`, then `id`. Edges are sorted by `(from, to, kind)`. The response contains no wall-clock or request-dependent field.
- **Identity binding.**
  - The response carries `inputIdentity: { projectId, revisionId, modelHash, projectCurrentRevisionId }`.
  - It also carries `graphHash` = `costHash` of the response without `graphHash`. Identical stored state therefore gives byte-identical responses.
- **Authorization.**
  - Owner-only: the RLS-scoped revision read runs first, as in the overview.
  - Anonymous → 401. Another user, or a revision of another project → 404, with the same envelope as the existing reads.
- **Stable errors.** The codes listed in A3, plus the existing `VALIDATION_ERROR`.
- **Discovery.** It gains a `DEPENDENCY_GRAPH` service entry (`DERIVED_ON_READ`). The change is additive; the overview's `outputs` list is fixed and does not change.

### A6. Exclusions

- No automatic regeneration.
- No background or remote compute.
- No paid or heavy infrastructure.
- No engineering-validation claims.
- No Phase 38 exports or evidence packages.
- No breaking API changes.
- No migration.

Also:
- The Phase 30 `modelEquivalentToBase` lineage is **not** used to mark a base revision's artifacts `CURRENT` for a derived revision. That would re-bind artifacts across revisions; it is left as a possible owner decision (§6).
- None of these exclusions had to be relaxed.

---

## 4. Acceptance criteria

Each criterion maps to at least one automated test. Criteria marked (−) are negative tests.

| # | Criterion | Test level |
|---|---|---|
| AC1 | The route returns `dependency-graph-v1` with `complete: true`, `inputIdentity`, `graphHash`, `families` (11, in fixed order), `nodes`, `edges`, `notRepresented` and `claims` | Integration |
| AC2 | On a fresh current revision with no artifacts: `REVISION` and `ACCEPTANCE_QA` are `CURRENT`, and every artifact family is `NOT_GENERATED` | Integration |
| AC3 | After takeoff → construction → cost on the current revision, all three nodes are `CURRENT`, and the edges match the stored ids exactly | Integration |
| AC4 | After a new revision is committed, the old revision's takeoff is `STALE_SOURCE_CHANGED` and its construction and cost are `STALE_UPSTREAM_STALE`. Each cause chain ends in `SOURCE_REVISION_SUPERSEDED`, and `inputIdentity.projectCurrentRevisionId` names the new current revision | Integration |
| AC5 | A systems analysis referencing a stale structural analysis is `STALE_UPSTREAM_STALE`; one with null references is `STALE_SOURCE_CHANGED` | Unit |
| AC6 (−) | Inconsistent hashes give `UNVERIFIED` with the specific cause, and the state propagates to every dependent as `UPSTREAM_UNVERIFIED`, never `CURRENT`. Cases: model-hash mismatch, fingerprint mismatch, construction-report hash mismatch, revision-identity mismatch | Unit, plus one tampered-row integration case |
| AC7 (−) | A missing dependency (a referenced id with no node) gives `UNVERIFIED` / `UPSTREAM_MISSING` | Unit |
| AC8 (−) | Matching model hashes alone do not give `CURRENT` when the revision or QA binding differs | Unit |
| AC9 (−) | Unaccepted or missing acceptance QA gives `ACCEPTANCE_QA` `UNVERIFIED`, and every artifact is `UNVERIFIED` | Unit |
| AC10 (−) | A cycle in the supplied links gives `DEPENDENCY_GRAPH_CYCLE` and no graph | Unit |
| AC11 (−) | Node, family-page, depth and time limits each give a `DEPENDENCY_GRAPH_LIMIT_EXCEEDED` refusal with the right `limit` field, never a partial graph | Unit |
| AC12 (−) | Disagreeing current-revision reads, an artifact committed between the two listing rounds, or a current revision that moves between them all give 409 `DEPENDENCY_GRAPH_READ_INCONSISTENT` | Integration |
| AC13 | Two reads of unchanged state are byte-identical. Node and edge order is independent of input order | Unit and integration |
| AC14 (−) | Anonymous → 401. Another user → 404. Another project's revision id under this project → 404. Any query parameter → 400 | Integration |
| AC15 (−) | The response contains no assurance level, evidence class, domain status or solver field, and `claims` are all `NOT_CLAIMED`. A graph read leaves the engineering assessment unchanged | Unit and integration |
| AC16 | Legacy compatibility: `project-overview-v1` and `GET /api/projects/:id?includeFreshness=true` are deep-equal before and after graph reads. All existing freshness and overview tests pass unchanged | Integration and existing suite |
| AC17 | The graph is read-only: a graph read changes no row count in any table | Integration |
| AC18 | Contract wiring: route catalog, OpenAPI, the Sentry route allowlist, the anonymous-401 rule and the discovery route-prefix rule all pass | Existing `modernization.test.ts` and `hardening.test.ts` |
| AC19 | Gates: build, typecheck, lint, full Vitest discovery on Node 22.22.0 and 22.23.3, container smoke and `npm audit --omit=dev --audit-level=high` all pass in CI | CI |

---

## 5. Affected files, APIs and migrations

**New files**
- `apps/api/src/contracts/dependency-graph.ts`: response schema, states and codes.
- `apps/api/src/graph/dependency-graph.ts`: a pure, deterministic builder over loaded records (no I/O).
- `apps/api/src/services/dependency-graph-service.ts`: bounded loader over the existing repositories.
- `apps/api/tests/dependency-graph.test.ts` and `apps/api/tests/dependency-graph.integration.test.ts`.
- `docs/phase37/*`.

**Changed (additive)**
- `apps/api/src/routes/projects.ts`: one GET route.
- `apps/api/src/lib/sentry.ts`: route allowlist.
- `apps/api/src/services/overview-service.ts`: `SERVICES` gains `DEPENDENCY_GRAPH`.
- `test-support/openapi.ts`: one contract entry.
- `docs/modernization/{api-routes,openapi}.json`: regenerated.

**APIs**
- One new GET route.
- Discovery gains one service entry.
- No existing route, schema or status changes.

**Migrations:** none, so no numbering applies. The latest migration stays `0025_compute_gateway.sql`, plus `0026_conversation_turns.sql` once that fix merges.

---

## 6. Open owner decisions (do not block this scope)

1. Confirm Phase 37's place in the canonical roadmap (decisions register Q9).
2. Whether a later version should treat the artifacts of a model-equivalent base revision (Phase 30 lineage) as source-equivalent. Excluded here.
3. Whether to add revision-wide list RPCs (a migration) if real projects exceed the 20-per-family page bound. Today that case is refused.
4. Whether the graph should cover non-engine records (references, jobs, workflows) once their links are stored as foreign keys.

---

## 7. Read consistency: what is and is not guaranteed (repair pass)

The graph is assembled from separate owner-scoped RPCs, not from one database transaction. The existing repository layer has no multi-RPC transaction, and adding one would need a new SQL function, which this phase deliberately avoids.

The check relies on these confirmed properties of the schema:
- Every artifact table has a `before update or delete` immutability trigger (for example `0007:30`, `0014:40`). Rows are only appended, and are removed only when their project is deleted.
- Revisions and QA runs are immutable (`0006:98-99`).
- The current-revision pointer only moves to a newly committed revision.

On that basis, the loader works in four steps:
1. Lists every family (and each takeoff's constructions).
2. Reads every detail.
3. Lists everything again.
4. Compares the artifact ids and the current revision from both rounds.

Equal rounds mean no artifact of this revision was committed, and the current revision did not move, between the first listing and the second. The graph therefore describes one state.

Not guaranteed:
- **Artifacts committed after the second listing.** They are simply not in this response; a later read shows them.
- **A project deleted mid-read.** This surfaces as the existing 404 from the first read that misses.

