# B40–B46 implementation plan

**Status:** plan of record for this work. Each phase below is delivered as **one tested vertical slice**. **No phase is claimed complete** by this work: each slice record lists what it leaves outstanding.

**Branch:** `phases-40-46`, from `phase40/selective-revision-orchestration` @ `69ae94f` (B40 S1). Not merged, tagged, deployed or migrated anywhere.

**Authority:** ROADMAP [`docs/sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md`](../sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md), §B Phases 40–46 (L300–428) and invariants §A1–A4.

## 0. Rules every slice follows

These are the conventions of B30–B40 S1, unchanged:
1. **Single source of truth.** The canonical Building Model V2 revision is written only by the existing commit paths (Phase 30 SQL compare-and-swap, generation). No slice adds a second model store.
2. **Typed refusals, never approximations.** Anything not implemented is `UNSUPPORTED`, `NEEDS_CLARIFICATION` or `BLOCKED_BY_LOCK`, with a stable code. Engineering, certification and statutory assertions stay `NOT_CLAIMED`.
3. **No language model in the decision path.** Grammars are deterministic and finite, as in Phases 18, 30 and 36. A provider is never called by these slices; quotes report `externalCostUsd: 0`.
4. **Additive only.** New routes, additive contract fields, and new numbered migrations (never edits to an earlier one). Each new route goes through the conformance set: `test-support/openapi.ts` `CONTRACTS`, Sentry safe routes, the rate-limit group, discovery `SERVICES` where advertised, and a regenerated route catalog and OpenAPI.
5. **Owner-only by default.** Bearer session; a foreign project is a 404. B44 adds membership only through its own tables and `SECURITY DEFINER` reads.
6. **Tests per slice:** pure unit tests, plus integration tests over HTTP on embedded PostgreSQL with every migration applied.

## 1. Slices

| Phase | Slice | Builds on | New routes | Migration |
|---|---|---|---|---|
| **B40** | **S2: cross-module DAG branches and budget safeguards.**<br>After the model commit, independent analysis branches (B24 structural analysis, B34 complex verification) run alongside the Materials → Budget chain. A failure isolates only its own branch. A caller task budget (`limits.maxTasks`) is refused at plan time (`OVER_BUDGET`). Tasks carry `branch`. | B40 S1, B24, B34 | none (contract-additive) | none |
| **B41** | **S1: grounded instruction resolution.**<br>Deterministic parsing of "only / preserve / except / undo / try another / compare / reuse" into one of 7 typed intents. Target extraction grounds references such as "the second-floor south bedroom" and "the kitchen floor" in stable element ids, or asks a clarification listing the candidates. Output is a **B40 change-set draft** (never executed) plus the hard locks it implies. | B36 turns grammar, B40 change set, B39 finishes | `POST …/revisions/:revisionId/instructions/resolve` | none |
| **B42** | **S1: feasibility ladder.**<br>A declared ambition (storeys, rooms, height, spans, cantilevers, glazing, materials, free text) is classified per constraint against the engines' actual limits (`MODEL_LIMITS`, generator schemas) as `WITHIN_ENGINE_SCOPE`, `CONCEPT_ONLY`, `EXCEEDS_ENGINE_LIMIT` or `REQUIRES_PROFESSIONAL_REVIEW`. Bounded alternatives are proposed **for consent**, with what each one gives up. The staged ladder is concept → bounded geometry → engineering → professional review. | B35 limits, generator | `POST /api/projects/:projectId/feasibility/assessments` | none |
| **B43** | **S1: vendor-neutral capability registry and inspectable routing.**<br>Roadmap capability ids (`llm.intent`, `image.exterior`, …) are mapped to the real backend services and AI registry entries, each with status, privacy, region and cost basis. A routing dry-run takes a target scope and returns the **bounded** capability set it would invoke, with skipped capabilities and reasons. User-supplied credentials are a typed `UNSUPPORTED`. | Phase 21 registry, B36 compute gateway | `GET /api/routing/capabilities`, `POST /api/projects/:projectId/routing/decisions` | none |
| **B44** | **S1: members, element-anchored comments, reviews and change audit.**<br>Owner-managed project members (`editor`, `reviewer`, `viewer`). Comments anchored to a revision and optional stable element ids. Reviews (`APPROVED` / `CHANGES_REQUESTED`) bound to the revision's model hash. A revision audit trail: who, what operation, why, element diff. All of it goes through signed `SECURITY DEFINER` RPCs. | B30 operations, B33 library | `/api/projects/:projectId/members…`, `…/revisions/:revisionId/comments`, `…/reviews`, `…/audit` | `0030_collaboration.sql` |
| **B45** | **S1: delivery manifest and compatibility package.**<br>A per-revision, per-level chunked delivery manifest: coordinate frame, stable pick anchors (level, space, wall, opening), element counts, byte and triangle budgets, cache keys, a strong `ETag` with `If-None-Match` → 304, and the distinct media capabilities. A compatibility endpoint gives contract versions and the hash of the route catalog. | B29 scene, B37 manifest | `GET …/revisions/:revisionId/scene/delivery`, `GET /api/compatibility` | none |
| **B46** | **S1: end-to-end scenario and release evidence.**<br>One integration test from project creation, through generation, an interior change via B41 → B40, verification, review (B44) and restore, to the delivery manifest. A benchmark script and a release evidence manifest generator (`scripts/release-evidence.mjs`) that records commands, results, known limits and unverified integrations, with no production-ready claim. | all | none | none |

## 2. Explicitly outside these slices

These are typed refusals or outstanding items, never silent gaps:
- **B40:** agent/LLM planning; geometry, storey and Exterior changes inside a plan; element-level invalidation (an owner decision on B37); durable B32 execution of plans.
- **B41:** provider-written prose; streaming; conversation-persisted memory of resolved targets (B36 turns remain the conversation store); cross-project retrieval.
- **B42:** any generated alternative geometry beyond the existing generators; feasibility of loads, wind, seismic or code compliance (no validated solver: `NOT_CLAIMED`).
- **B43:** live provider calls, provider evaluation runs, encrypted user credentials, spend ledger.
- **B44:** member access to the existing owner-only analysis routes. RLS on those tables stays owner-only, and widening it is an owner decision. Also out: ownership transfer, notifications, merge of branches.
- **B45:** GLB chunk encoding, compression and range delivery (the existing scene GLB stays whole), desktop GPU QA (a frontend measurement).
- **B46:** live Supabase, staging and hosted runs; frontend-connected verification; the real-deployment gate (L428).

## 3. Order and gates

The slices run in order: B40 S2 → B41 → B42 → B43 → B44 → B45 → B46, with one commit (or more) per phase. Each phase ends with:
1. build, typecheck and lint clean;
2. its own unit and integration suites green;
3. the conformance and modernization test green, with the route catalog regenerated;
4. its slice record, `docs/phaseNN/bNN-s1-implementation.md` (B40: `b40-s2-implementation.md`).

Known environment exceptions on this Windows machine, which are not regressions:
- the import-boundary path assertion in `interpretation.test.ts` (backslashes);
- `EBUSY` on embedded PostgreSQL teardown.
