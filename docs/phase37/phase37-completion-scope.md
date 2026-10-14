# Phase 37 Completion Slice: Unified Project Manifest v2 and Freshness States — Scope and Acceptance

**Status:** scope of record for implementation. Written 2026-10-13, before any code in this slice.

**Base:** `phase31/development` at `d0cd38b` (Phase 39 merged as PR #16). Citations refer to that commit.

**Roadmap:** `NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md` (8 Oct 2026; owner-designated as authoritative on 2026-10-13). A verbatim copy, sha256 `0ebc4479…3a03`, is on branch `main` at `docs/sources/` and is carried into the development branch by PR #18. It is cited below as ROADMAP Lnnn.

**Labels used throughout:**
- **ROADMAP:** roadmap text.
- **CONFIRMED:** repository fact, with a citation.
- **PROPOSED:** this slice's design or an acceptance test added here (not roadmap text).
- **UNVERIFIED:** not established.

---

## 1. Why this slice

| Basis | Text |
|---|---|
| ROADMAP B37 (L245–262) | Requires a typed artifact dependency graph; formal invalidation semantics `current, stale, pending, blocked, not_applicable, verified` with reason codes and source/target revision identity (L251); and a **"Unified Project Manifest v2"** that evolves the Phase-29 overview (L257–260) |
| ROADMAP B39 gate (L297) | "… feed resulting changes to shared **B37 manifest** …" |
| ROADMAP §I rule 4 (L736) | B37 dependency propagation must precede reliance on cross-discipline freshness |
| CONFIRMED (code) | The graph exists as `dependency-graph-v1`. Its states are `CURRENT`, `STALE_SOURCE_CHANGED`, `STALE_UPSTREAM_STALE`, `UNVERIFIED`, with family state `NOT_GENERATED` (`apps/api/src/contracts/dependency-graph.ts:8-9`). The overview is still `project-overview-v1` (`services/overview-service.ts`). **No manifest v2 and no roadmap-vocabulary states exist** |
| CONFIRMED (PR #16) | Phase 39 design concepts were merged at `d0cd38b` (`0028_design_concepts.sql`). They are revision-bound, model-hashed, advisory artifacts, and they are not nodes of the Phase 37 graph. This slice reports them as a module; it does not start, change or extend B39 |

## 2. Design (PROPOSED)

### Route and contract

- `GET /api/projects/:projectId/revisions/:revisionId/manifest`, contract `project-manifest-v2`.
- Strict empty query. Owner-only. `read` rate-limit group (automatic for GET).
- **Derived on read. No migration, table, RPC, environment variable or dependency.**

### Reads

1. The revision (owner check; 404 otherwise).
2. The unchanged Phase 37 `dependencyGraph()`: two listing rounds, recomputed hashes, and a 409 on any change.
3. The revision's design-concept listing (Phase 39 RPC).
4. Queued and running durable jobs (Phase 32 RPC) with up to 4 detail reads in flight.

At most `JOB_LIMITS.activePerProject` (4) jobs can be active, so one page of 8 per status holds them all. Otherwise the read is refused with 422 `PROJECT_MANIFEST_LIMIT_EXCEEDED`.

### Coherence (ROADMAP L258; scenario 17, L747)

The design-concept listing reports the project's current revision after the graph's second round. The pointer only moves forward, so equality with the graph's pointer shows that no revision was committed during the read. A difference is 409 `PROJECT_MANIFEST_READ_INCONSISTENT`.

### Contents (ROADMAP L257, L260)

- **Identity:** project, revision, number, parent (lineage), current pointer, currency, recomputed model hash, acceptance QA.
- **Canonical model and coordinate frame:** schema version, `mm`, `x-right-y-up-z-depth`, site presence, north and reference datum, entity counts.
- **Configuration:** source mode, generator version, generation identity.
- **Modules,** each with:
  - discipline;
  - version and href;
  - source kind (revision, stored, derived-on-read, advisory);
  - editability (`NEW_REVISION_ONLY` for the model; derived or advisory read-only for the rest);
  - availability;
  - completeness;
  - freshness with reasons and source/target revision;
  - `missingReason`;
  - active job ids;
  - per-artifact freshness.
- **Per-discipline freshness** (worst member).
- **The freshness vocabulary and mapping**, carried in the response.
- **Verification scope** `PROVENANCE_INTEGRITY` with the embedded `graphHash` and node-state counts.
- **Access policy** `OWNER_ONLY`.
- **Not-included items**, each with a reason.
- **Claims** all `NOT_CLAIMED`.
- `integrityCheckedAt` (ROADMAP `last_verified`; read time, outside the hash).
- `manifestHash`.

### Freshness mapping (M2)

| Evidence | Roadmap state | Reason codes |
|---|---|---|
| Graph `CURRENT` | `current` | — |
| Graph `STALE_SOURCE_CHANGED` | `stale` | `SOURCE_REVISION_SUPERSEDED` |
| Graph `STALE_UPSTREAM_STALE` | `stale` | `UPSTREAM_STALE` + chain |
| Graph `UNVERIFIED` (including no current revision) | `blocked` | The graph's cause codes. **Never `current` or `verified`** |
| Nothing stored, and a queued/running job targets this revision | `pending` | `JOB_ACTIVE` |
| Nothing stored, no active job | no state (`freshness: null`); `availability: NOT_GENERATED` | `missingReason: NOT_GENERATED_FOR_REVISION` |
| Derived-on-read outputs (BIM, B34 verification, B35 assessment, B38 documents) | Worst of the `REVISION` and `ACCEPTANCE_QA` nodes | As the node |
| Phase 39 design concepts | Revision binding and stored model hash re-checked, then the revision's state | `REVISION_BINDING_MISMATCH` / `MODEL_HASH_MISMATCH` → `blocked` |
| — | `not_applicable`, `verified` | **Reserved; never assigned in v2** |

Why the last row: no evidence-backed rule exists for "not applicable", and no output carries independent validation evidence the backend can check. Provenance integrity is not verification.

## 3. Acceptance criteria

| ID | Criterion | Basis | Test |
|---|---|---|---|
| M1 | Manifest fields per §2 | ROADMAP L257, L260 | Unit: schema and fields. Integration: fresh revision |
| M2 | Mapping exactly as §2; `UNVERIFIED` → `blocked`; `pending` only with an active job; `verified` and `not_applicable` never emitted | ROADMAP L251; PROPOSED rules | Unit: every graph state, a tampered check, no current revision, jobs. Integration: a queued `SCENE_COMPILE` job |
| M3 | No mixed revisions: a pointer change during the read → 409 | ROADMAP L258, L747 | Integration: a skewed design-concept listing |
| M4 | An accepted edit marks every dependent output of the base `stale` with a reason and target revision; the scene stays linked by revision id and verified model hash | ROADMAP L262 | Integration: takeoff → construction → cost, scene and design concept on revision A; supplied edit B; manifests of A and B |
| M5 | Additive: `project-overview-v1`, `dependency-graph-v1`, Phase 38/39 responses unchanged | ROADMAP A4 L51 | Existing suites unchanged |
| M6 | Bounded reads: at most 8 in flight | PROPOSED (R14); `0bf1c89` | **Done (§5.1).** The graph's construction listings and all per-artifact detail reads share one pool (`pooled`, `READ_CONCURRENCY = 8`). The manifest's own side reads stay ≤ 8 together |
| M7 | Engineering flags and claims unchanged; the manifest carries no assessment values | ROADMAP A4 L50 | Unit: `claims`; existing engineering/evidence tests unchanged |
| M8 | Build, typecheck, lint, full suite, route catalog and OpenAPI drift, telemetry allowlist | ROADMAP §K L788 | Local runs; CI on the PR |
| M9 | Phase tag and staging proof | ROADMAP §K L788 | **Not done.** Owner-authorized only |
| M10 | ROADMAP L260 `lineage` and `diff`, L253 per-discipline change impact, and L262 dependent-output impact, as machine-readable fields | ROADMAP L253, L260, L262 | Unit and integration tests in §5.3 |

## 4. Out of scope

- B39 work.
- Any migration (`0028` already belongs to Phase 39; none is needed here).
- Persisting manifests.
- Component-level (per-element) impact.
- Evidence packages, zone assessment and partitions, appearance variants: listed in `notIncluded`.
- Changes to the graph, overview or discovery semantics beyond one additive `PROJECT_MANIFEST` service row.
- Merging `phase37/read-cap` (its change is ported by hand in §5.1, not merged).

## 5. Follow-up on PR #17: bounded reads and change metadata

### 5.1 Bounded reads (port of `0bf1c89`)

`0bf1c89` was written against an earlier graph service, without the two listing rounds or the analysis detail reads, so it does not apply cleanly. Its `pooled()` limiter is ported by hand into `apps/api/src/lib/bounded-reads.ts`.

**Fan-out before (CONFIRMED in code at `d0cd38b`):** each listing round ran up to 20 construction listings at once. The detail phase then started every takeoff, construction, cost and six-family analysis detail read in one `Promise.all`: up to `maxNodes − 2 = 126` reads. Together this came to about 150.

**After:**

| Element | Behaviour |
|---|---|
| `pooled(reads, width, beforeEach)` | At most `min(width, READ_CONCURRENCY = 8)` reads in flight; a non-finite width means 8 and below 1 means 1. Results in input order. `beforeEach` (the graph's time budget) runs before each read starts. The first failure is the result, exactly as `Promise.all`; no read starts after it |
| Graph construction listings, both rounds | One pool |
| Graph detail reads | **One** pool over the flattened list of every family's detail reads, so separate pools cannot add up past the bound |
| The eight family listings per round | Unchanged (`Promise.all` of exactly 8) |
| `limits.maxNodes`, `familyPage`, `timeBudgetMs` | Unchanged: concurrency control does not replace them |
| `GraphOptions.readConcurrency` | Can only lower the width (tests use 1) |
| Manifest side reads | 1 concept listing; 2 job listings, then job details pooled at 4; 1 parent read; 1 lineage read. At most 8 together |

### 5.2 Change metadata (ROADMAP L253, L260)

**Ancestry semantics (CONFIRMED, `0006_projects.sql`):**
- A revision's parent is always the project's previous current revision.
- `revision_number = parent's + 1`, the parent is in the same project (composite FK), and `revision_number = 1 ⇔ parent is null`.
- The comparison is therefore always against `parentRevisionId`.

| Field | Contract | Derived from |
|---|---|---|
| `lineage` | `status`: `ROOT` / `LINKED` / `INCONSISTENT` / `UNAVAILABLE`. `revisionNumber`, `parentRevisionId` (also kept unchanged in `identity`). `parent {revisionId, revisionNumber, modelHash, createdAt}`. `modelEquivalentToParent` (recomputed hashes). `operation` (Phase 30: `NONE` / `RECORDED` with kind, base and restore source / `UNAVAILABLE` without operation persistence). `reasons` | Parent read (owner-scoped); Phase 30 `lineage` read. Checks: root ⇔ number 1; parent number = n − 1; parent identity matches its model; the operation's base is the parent and its committed revision is this one. A violation is `INCONSISTENT`, never repaired; an unreadable parent is `UNAVAILABLE` |
| `diff` | `status`: `COMPUTED` / `NO_PARENT` / `UNAVAILABLE` (`unavailableReason`: `PARENT_UNREADABLE`, `LINEAGE_INCONSISTENT`). `diffVersion: scoped-diff-v1`, `baseRevisionId`, `baseModelHash`, `modelHash`, `modelHashChanged`, `entitiesIdentical`, `counts`, per-`collections` counts, `changes` (≤ 200, `changesTruncated`) | **The existing Phase 34 `scopedDiff`** (canonical hash per entity across levels, spaces, walls, openings, slabs, columns, stairs, dimensions, specifications, plus site). Computed only when lineage is `LINKED` |
| `changeImpact` | `status` as `diff`; `basis: MODEL_BINDING`; per discipline `impact` `AFFECTED` / `NOT_AFFECTED`, `reason` (`MODEL_ENTITIES_CHANGED`, `MODEL_CHANGED_OUTSIDE_DIFF_COLLECTIONS`, `BOUND_TO_CHANGED_MODEL`, `MODEL_UNCHANGED`), `modules`, `changedCollections` | A `COMPUTED` diff only. Every derived output is bound to the whole model (Phase 37 `MODEL_HASH` and fingerprint checks). A changed model hash therefore means outputs derived from the parent cannot be reused here. **This is not a physical or engineering impact estimate.** No finer per-entity → discipline mapping is claimed, because no stored data supports one |

**Unavailable is never empty:**
- `NO_PARENT` and `UNAVAILABLE` carry `counts: null` and `entitiesIdentical: null`.
- An unchanged revision is `COMPUTED` with zero counts and every discipline `NOT_AFFECTED`.

### 5.3 Tests

| Test | Covers |
|---|---|
| `bounded-reads.test.ts` | Peak exactly 8 over 50 reads; widths 100, ∞, NaN → 8; 3 → 3; 1, 0, −5 → 1; each read exactly once with input order kept under out-of-order completion; empty and 1,000-read inputs; first error returned with no read started after it; budget check before each read |
| `dependency-graph.integration.test.ts` | Instruments all nine artifact RPCs on Postgres. Width 1 → detail peak 1 across every family (one shared pool); default → overall peak ≤ 8; same graph; a failed detail read gives the existing 404 `ApiError` |
| `project-manifest.test.ts` | Root; unchanged; multi-discipline entity change; change outside the compared collections; truncation; unreadable parent; missing operation persistence; each ancestry violation; a recorded restore operation; `identity.parentRevisionId` unchanged |
| `project-manifest.integration.test.ts` | Root lineage on Postgres; a space edit (`spaces` changed, every discipline `AFFECTED`); an unchanged save (empty `COMPUTED` diff, nothing affected); an unreadable parent through the service |

### 5.4 Reconciling two parallel implementations

PR #17's branch received `913b584` (read gate) and `aa20a0e` (`lineage`, `diff` as a BIM-diff href, `changeImpact` from freshness) from a parallel session. At the same time, `32af8a1` (this section's §5.1–5.3; PR #19) was written for the same request. The merge keeps every behavior of both:

| Item | Kept | From the parallel design |
|---|---|---|
| Read bound | `pooled()` (hard cap 8, no reads after a failure) | Its width-1/3 integration test still runs, against `pooled()` |
| `lineage` | §5.2 (`ROOT`/`LINKED`/`INCONSISTENT`/`UNAVAILABLE`, ancestry checks) | `operation.modelEquivalentToBase` (the Phase 30 lineage read's own value); `operationLineage: UNAVAILABLE` is `operation.status: UNAVAILABLE` |
| `diff` | Computed `scopedDiff` against the parent | `bimDiffHref`: the existing `…/bim/diff/:parentRevisionId` route, null without a parent |
| `changeImpact` | Change since the parent, by model binding (§5.2) | — |
| `freshnessImpact` | — | **Its `changeImpact`, renamed:** per discipline, modules to `regenerate` (stale), `revalidate` (blocked) and `await` (pending), with artifact counts, against the current revision (ROADMAP L262) |

The rename is a contract change only to the unmerged PR #17; no client consumes `project-manifest-v2` yet.

