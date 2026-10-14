# Phase 37 Completion Slice: Unified Project Manifest v2 and Freshness States — Scope and Acceptance

**Status:** scope of record for implementation. Written 2026-10-13, before any code in this slice. Acceptance verification and gaps (2026-10-14): [phase37-acceptance-gap-report.md](phase37-acceptance-gap-report.md).

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
- Strict query: optional `discipline` and `artifacts` (`include` | `omit`), see §6. Owner-only. `read` rate-limit group (automatic for GET).
- **Derived on read. No migration, table, RPC, environment variable or dependency.**

### Reads

1. The revision (owner check; 404 otherwise).
2. The unchanged Phase 37 `dependencyGraph()`: two listing rounds, recomputed hashes, and a 409 on any change.
3. One page (100) of the project's Phase 30 operations, newest first (§6). It completes before step 4 starts.
4. The revision's design-concept listing (Phase 39 RPC).
5. Queued and running durable jobs (Phase 32 RPC) with up to 4 detail reads in flight.
6. The parent revision and the Phase 30 lineage (§5.2).

Steps 5 and 6 run alongside steps 3 and 4.

At most `JOB_LIMITS.activePerProject` (4) jobs can be active, so one page of 8 per status holds them all. Otherwise the read is refused with 422 `PROJECT_MANIFEST_LIMIT_EXCEEDED`.

### Coherence (ROADMAP L258; scenario 17, L747)

The design-concept listing reports the project's current revision after the graph's second round. The pointer only moves forward, so equality with the graph's pointer shows that no revision was committed during the read. A difference is 409 `PROJECT_MANIFEST_READ_INCONSISTENT`.

The operation listing (step 3) finishes before that listing starts, so the same check covers it: a candidate approved after the graph read moves the pointer and is refused, rather than reported as still awaiting approval.

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
| M11 | ROADMAP L258 candidates: Phase 30 operations awaiting consent or approval on the revision are listed as `NOT_ACCEPTED`; no module, freshness, impact, diff or verification count reads them; one bounded page, `TRUNCATED` when live operations may lie beyond it (added 2026-10-14) | ROADMAP L258 | §6.3 |
| M12 | ROADMAP L259 partial-data view and paged-view index: `?discipline=` keeps one discipline's entries, `?artifacts=omit` drops artifact lists, the full manifest's hash is kept, and each module indexes its existing paged or filterable listings (added 2026-10-14) | ROADMAP L259 | §6.3 |

## 4. Out of scope

- B39 work.
- Any migration (`0028` already belongs to Phase 39; none is needed here).
- Persisting manifests.
- Component-level (per-element) impact.
- Evidence packages, zone assessment and partitions, appearance variants: listed in `notIncluded`.
- Changes to the graph, overview or discovery semantics beyond one additive `PROJECT_MANIFEST` service row.
- Merging `phase37/read-cap` (its change is ported by hand in §5.1, not merged).
- New paged or filterable views. M12 indexes the existing ones, so these modules have none: the building model, acceptance QA, complex verification, construction calculations (listed per takeoff, so there is no per-revision href), engineering assessment and construction documents. Drawing/layer, room-navigation and site/plot views for the frontend workspaces (ROADMAP L259, frontend 31–40, 45–48, 55) are not built here.
- Resolving a manifest *for* a candidate. A candidate has no revision row until it is approved, so its modules cannot be resolved; the manifest lists it against its base.

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
| Manifest side reads | 1 operation listing, then 1 concept listing (§6); 2 job listings, then job details pooled at 4; 1 parent read; 1 lineage read. At most 7 together |

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
| `diff` | Computed `scopedDiff` against the parent | `bimDiffHref`: the existing BIM diff route for the same pair, null without a parent. Its direction was corrected in §7 |
| `changeImpact` | Change since the parent, by model binding (§5.2) | — |
| `freshnessImpact` | — | **Its `changeImpact`, renamed:** per discipline, modules to `regenerate` (stale), `revalidate` (blocked) and `await` (pending), with artifact counts, against the current revision (ROADMAP L262) |

The rename is a contract change only to the unmerged PR #17; no client consumes `project-manifest-v2` yet.

## 6. Follow-up on PR #17: candidates and partial views (ROADMAP L258–259)

Added 2026-10-14 on top of `2455652`. Derived on read; no migration, table, RPC, environment variable or dependency.

### 6.1 Candidates (M11)

`candidates: { modulesResolve: 'ACCEPTED_REVISION_ONLY', availability, completeness, items }`.

- **Items:** Phase 30 operations based on this revision in `AWAITING_CONSENT` or `CANDIDATE_READY`, oldest first.
  - The SQL reports a lapsed operation as `EXPIRED`, so it is not listed.
  - Fields: operation id, kind, status, candidate hash, `createdAt`, `expiresAt`, `acceptance: 'NOT_ACCEPTED'`, the operation `href` and its `comparisonHref`.
- **Listed, never resolved:** modules, freshness, `changeImpact`, `freshnessImpact`, `diff`, `lineage` and verification counts always describe the accepted revision. A candidate has no revision row until it is approved; after approval it appears in the new revision's `lineage.operation`.
- **Bounded read:** one page of 100 operations, newest first.
  - An operation is live for 24 hours (`REVISION_LIMITS.expiryHours`).
  - If the page is full and its oldest entry is under 25 hours old (one hour allowed for clock skew), live operations may lie beyond it, so the list is `TRUNCATED`. It is not read further.
- **Coherence:** the listing completes before the pointer-checking concept listing starts (§2).
- **Without revision-operation persistence:** `availability: 'UNAVAILABLE'`.

### 6.2 Partial view and paged-view index (M12)

**Query:** `?discipline=<one of DISCIPLINES>` and/or `?artifacts=omit`. Anything else, including a repeated `discipline`, is 400.

**The view:**
- It is cut from the full manifest after that manifest is built; nothing is recomputed.
- `modules`, `disciplines`, `changeImpact.disciplines` and `freshnessImpact.disciplines` are filtered.
- Every other section is unchanged, including `manifestHash`, which stays the full manifest's.
- `view: { scope: 'FULL' | 'PARTIAL', discipline, artifacts: 'INCLUDED' | 'OMITTED' }` says which part the response holds, and is outside the hash.
- Every module carries `artifactCount`. Its `artifacts` is `null` only in an `artifacts=omit` view.

**`views`:** each module lists its existing per-revision paged listings, with the paging style (`AFTER_ID` for BIM, `CURSOR` otherwise) and filters (`kind` for BIM). There are 11, covering:
- BIM elements and relationships;
- takeoffs and cost estimates;
- structural, environmental, systems and knowledge analyses;
- optimization studies, design concepts and scene artifacts.

The other modules have no paged view yet and list none (§4).

### 6.3 Tests

| Test | Covers |
|---|---|
| `project-manifest.test.ts` | Only this revision's `AWAITING_CONSENT` / `CANDIDATE_READY` operations are listed, oldest first. Identity, modules, disciplines, both impacts, lineage, diff and verification are identical with and without candidates. `UNAVAILABLE` and `TRUNCATED`. Views: BIM, takeoff and none; all 11 indexed routes are GET routes of the catalog. A discipline view keeps exactly that discipline in modules, disciplines and both impacts, both with and without a parent. `artifacts=omit` keeps counts and freshness. The hash and the other sections are unchanged. Bad queries are refused |
| `project-manifest.integration.test.ts` | Preflight: listed as `AWAITING_CONSENT`. Execute: `CANDIDATE_READY` with its hash, `comparisonHref` answers 200, and every other section is unchanged. Approve: gone from the base; the child's lineage is `LINKED` with the `RECORDED` operation. The operation listing completes before the concept listing starts. A full page whose oldest entry is 1 hour old is `TRUNCATED`; one 26 hours old is `COMPLETE`. Without operation persistence: `UNAVAILABLE`. Partial view over HTTP; 400 on a bad discipline, a bad `artifacts` value or a repeated `discipline`; 404 for another user; every indexed view answers 200 with `limit=1` |
| Mutation checks | 10 of 10 caught:<ul><li>the base-revision filter;</li><li>the status filter;</li><li>the `changeImpact` filter;</li><li>the `freshnessImpact` filter;</li><li>the module filter;</li><li>hashing without candidates;</li><li>a wrong view route;</li><li>artifacts not omitted;</li><li>truncation never reported;</li><li>the operation and concept listings run in parallel.</li></ul> |

## 7. Completion pass on PR #17 (2026-10-14)

Checked against roadmap Phase 37 (L245–262) on head `4a57aa5`.

### 7.1 Fix: BIM diff link direction

- **Defect:** `GET …/revisions/:revisionId/bim/diff/:otherRevisionId` compares the path revision (before) with the parameter (after). The existing callers put the older revision in the path (`modernization.integration.test.ts`, `revision.integration.test.ts`).
- **Before:** `diff.bimDiffHref` was `…/revisions/<this>/bim/diff/<parent>`. The linked BIM diff therefore ran revision → parent, opposite to the manifest's own parent → revision `diff`: an entity the edit added would read `REMOVED` there.
- **After:** `…/revisions/<parent>/bim/diff/<this>`, so both describe the same pair in the same direction.
- **Test:** the unit test pins the href. The M4 integration test reads the linked BIM diff and checks that its `before`/`after` bindings are the parent and the edited revision, with the model hashes the manifest `diff` reports.

### 7.2 Fix: `freshnessImpact` no longer asks to regenerate the source model (gap report D1)

- **Defect:** for a superseded revision, `regenerate` listed `BUILDING_MODEL` and `ACCEPTANCE_QA`. A revision's model and its acceptance are replaced only by a new revision, never regenerated.
- **After:** each discipline entry gains `superseded`: the stale modules that only a new revision replaces (the graph's `REVISION` and `ACCEPTANCE_QA` anchors). `regenerate` never contains them. Outputs derived on read from the model (BIM, complex verification, engineering assessment, construction documents) stay in `regenerate`. `staleArtifacts` still counts every stale artifact of the discipline.
- **Tests:** unit (the `ARCHITECTURE` entry of a superseded revision, and no variant ever lists either module to regenerate) and the M4 integration test.

### 7.3 Added acceptance tests on PostgreSQL

| Behaviour | Before | Added |
|---|---|---|
| `freshnessImpact.revalidate` (a failed provenance check) | Unit only | A tampered stored takeoff fingerprint: takeoff, construction and cost are `blocked`, listed under `revalidate` (never `regenerate`), `blockedArtifacts: 3`, the other disciplines untouched, nothing `verified` |
| `freshnessImpact.awaiting` (an active job) | Unit only | A queued `SCENE_COMPILE` job: `VISUALIZATION` awaits `SCENE_3D`; nothing else is awaited |
| BIM diff linkage | Status 200 only | Pair and direction, as §7.1 |

### 7.4 Traced and left as is

- **`scopedDiff` change cap (50,000).** `scopedDiff` validates its report, so a comparison with more than 50,000 changes would fail the whole manifest read. Reaching that needs two revisions with about 25,000 or more disjoint entities each. The model schema allows up to 42,240 entities, but the save route's default body limit is 1 MiB (`BODY_LIMIT_BYTES`), far below such a model. No code is added for it. It becomes reachable only if that limit is raised by about two orders of magnitude.

### 7.5 Roadmap items still open

These are why the PR is not marked ready for review:

| Roadmap text | State |
|---|---|
| L251: `not_applicable` and `verified` | Defined in the vocabulary, never assigned. There is no evidence-backed rule for either (§2) |
| L252: material and façade variations as explicit, semantically typed changes | Not in this slice. Phase 30 `APPEARANCE_MODIFY` operations are reported in `lineage.operation` and `candidates`; `APPEARANCE_VARIANT` is in `notIncluded` |
| L262: "no lost linkage between model and visible 3D object", after a Phase 30 appearance edit (gap report D2) | Not met. The visible 3D object of such a revision is its Phase 30 appearance variant, which the manifest does not link (`APPEARANCE_VARIANT` is in `notIncluded`; `SCENE_3D` reads `NOT_GENERATED`). The gap report's proposal: an `APPEARANCE` entry derived from the existing `revision_operation_read('appearance')` |
| L258: "façade cladding alone differs from changing curtain-wall glazing area" | Not met. Invalidation is by whole-model binding (`changeImpact.basis: MODEL_BINDING`), because every stored output is bound to the whole model hash. Telling those two edits apart needs per-output input scopes that the stored artifacts do not record |
| L259: drawing/layer, room-navigation and site/plot paged views | Not built (§4) |
| L260: `confidence/assumptions` (when applicable) | Not surfaced as a manifest field. The other L260 fields are: `diff`, `lineage`, `source`, `units`, the local coordinate system (L260 asks for a CRS *or* a local system), `completeness`, `last_verified` (`integrityCheckedAt`) and `missing_reason` |
| M9: phase tag and staging proof; Supabase acceptance; hosted migration history | Owner-authorized release gates; not run |

