# Phase 37 Completion Slice: Unified Project Manifest v2 and Freshness States — Scope and Acceptance

**Status:** scope of record for implementation. Written 2026-10-13, before any code in this slice.

**Base:** `phase31/development` at `d0cd38b` (Phase 39 merged as PR #16). Citations refer to that commit.

**Roadmap:** `NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md` (8 Oct 2026; owner-designated as authoritative on 2026-10-13). A verbatim copy, sha256 `0ebc4479…3a03`, is on branch `main` at `docs/sources/`. It is cited below as ROADMAP Lnnn.

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
| M6 | Bounded reads | PROPOSED | The manifest's own reads: 3 listings and up to 4 job details in flight. **The graph's per-artifact read fan-out is unchanged here.** The fix is the unmerged `phase37/read-cap` (`0bf1c89`), which is **not merged by this slice** (owner decision D-3) |
| M7 | Engineering flags and claims unchanged; the manifest carries no assessment values | ROADMAP A4 L50 | Unit: `claims`; existing engineering/evidence tests unchanged |
| M8 | Build, typecheck, lint, full suite, route catalog and OpenAPI drift, telemetry allowlist | ROADMAP §K L788 | Local runs; CI on the PR |
| M9 | Phase tag and staging proof | ROADMAP §K L788 | **Not done.** Owner-authorized only |

## 4. Out of scope

- B39 work.
- Any migration (`0028` already belongs to Phase 39; none is needed here).
- Persisting manifests.
- Component-level (per-element) impact.
- Evidence packages, zone assessment and partitions, appearance variants: listed in `notIncluded`.
- Changes to the graph, overview or discovery semantics beyond one additive `PROJECT_MANIFEST` service row.
- Merging `phase37/read-cap`.
