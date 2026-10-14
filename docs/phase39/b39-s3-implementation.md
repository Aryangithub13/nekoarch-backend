# B39 Slice S3 (Interior) and U2 (Whole-Model Invalidation) — Implementation Record

**Status:** implemented on `phase39/b39-acceptance-audit`, on top of `phase31/development` @ `c5ebe72`. **Not pushed, not merged, not a release.** Adds migration `0029_interior_finish_operations.sql` (authorized, see §1). Nothing hosted, staged or tagged.

**Scope of record:** [`b39-specialist-scope.md`](b39-specialist-scope.md) §4 row 6, §5, §6 and §7 S3. Earlier slices: [S1](b39-s1-implementation.md), [S2](b39-s2-implementation.md). Acceptance: [`b39-acceptance-audit.md`](b39-acceptance-audit.md).

## 1. Owner decisions (2026-10-14, given in the remediation session)

| ID | Options put to the owner | Decision |
|---|---|---|
| **D-12** (Interior) | Approve without a migration; **approve with migration 0029**; formally waive Interior; keep deferred | **Approve with migration 0029:** a Phase 30 operation kind with a stored operation, audit events and an SQL-enforced finish-only lock |
| **U2** (B37 waiver, assigned to the B39 Exterior specialist) | Defer to a named phase; **implement whole-model U2 in B39**; require element-level U2 | **Implement whole-model U2 in B39:** model-hash input scoping; element-level scoping is not part of B39 |

## 2. Interior (scope §4 row 6; ROADMAP L289, L297; scenario 33)

**Model.** V2 spaces gain an optional `finishes: { floor?, walls?, ceiling? }` (`packages/shared/src/building-v2/spaces.ts`).
- Each value comes from a fixed catalog (`INTERIOR_FINISHES`).
- A code is design intent only: never a product, supplier, rate, thickness or performance (fire, acoustic, slip, thermal).
- The field is absent from every existing model, so no existing canonical hash changes.

**Operation.** Phase 30 kind `INTERIOR_FINISH_MODIFY`. It is structured only: natural-language interior wording is still refused (`INTERIOR_FINISH_NOT_SUPPORTED`).

| Step | Behaviour |
|---|---|
| Preflight (planner) | Fixes the candidate model and two hashes: the candidate's (`candidateModelHash`), and the base's with every space finish removed (`geometryModelHash`). Typed results:<br>• unknown space → `NEEDS_CLARIFICATION` / `UNKNOWN_SPACE`;<br>• `INTERIOR` or covering storey lock → `BLOCKED_BY_LOCK`;<br>• no-op → `NEEDS_CLARIFICATION`;<br>• base with an exterior appearance variant → `UNSUPPORTED` / `APPEARANCE_VARIANT_PRESENT`.<br>System locks: `BUILDING_GEOMETRY`, `EXTERIOR`, `STRUCTURE`, `INTERIOR_FINISHES` |
| Execute | Derives the candidate; nothing is compiled. SQL re-derives the evidence (`revision-interior-validator-v1`) from stored rows and the submitted model |
| Compare | Every changed space, before and after; geometry identity, established by SQL at execute |
| Approve | QA is re-run on the exact model. The model is committed as a *supplied* revision: it is edited, so the generation identity no longer describes it |
| Stale base | `STALE_BASE` at execute and at approve (existing Phase 30 SQL) |

**Migration `0029`** (additive):
- the kind check becomes a superset;
- one immutable helper, `project_private.strip_space_finishes(jsonb)`;
- `revision_operation_write` is replaced with the 0020 body plus interior branches.

Rule enforced at preflight, at candidate and at commit: the model must hash as previewed, and exactly as the base once every space's `finishes` is removed; a base carrying an appearance variant is refused. Unchanged: every existing row, status, transition, grant, and the `APPEARANCE_MODIFY` and `RESTORE` paths. A test checks that the stored operations are byte-identical across the upgrade.

**Why an appearance variant blocks Interior.** A variant's compiled GLB is bound to the base's exact model hash: 0020 stores `model_hash`, and the B37 manifest re-checks it (`MODEL_HASH_MISMATCH`). A finish edit changes that hash, so the variant cannot be carried forward without recompiling it. Two routes are supported:
- Interior first, then Exterior (tested);
- a RESTORE to a variant-free revision.

Recompiling the variant for the finished model is not part of B39.

**Specialist envelope.** `INTERIOR` runs like Exterior:
- **Flow:** a preflight under the preflight route's receipt, after the current-base check; then `AWAITING_CONSENT` with the operation id, locks, impacts, spaces and the existing execute, compare, approve and reject links.
- **Space planning:** `interior.layout`, `building.floor_plans`, `building.geometry` or `building.structure` gives `UNSUPPORTED` / `SCOPE_EXPANSION_REQUIRED` and names BLUEPRINT (scenario 33).
- **Furnishings:** `UNSUPPORTED` / `FURNISHINGS_NOT_SUPPORTED` (no furnishing data exists).
- **Claims:** product specification, fire, acoustic and slip are all `NOT_CLAIMED`.

**Not delivered (refused by type, as for the other modules):**
- furnishings;
- bounded interior layout edits (scope expansion to Blueprint);
- interior rendering;
- an independent egress check beyond the blueprint QA re-run at commit. Geometry is identical by construction.

## 3. U2 at whole-model granularity (ROADMAP L258)

**Rule** (`apps/api/src/graph/dependency-graph.ts`). Before: a record whose revision is not current was always `STALE_SOURCE_CHANGED`. Now, when the current revision's canonical model hash equals this revision's:
- **stay `CURRENT`**, with the cause `SOURCE_MODEL_EQUIVALENT`: takeoff, construction, cost, and the structural, environmental and systems analyses (`SOURCE_EQUIVALENT_FAMILIES`);
- **stay stale:** the revision and its QA, the scene (it renders the replaced finish), optimization and knowledge (bound beyond the model), and design concepts, documents and evidence (revision-identity bound).

Failed checks and stale inputs still take precedence. Any model change, including an Interior finish, still makes everything stale.

**Read.** The graph service reads the current revision's model only when this revision is superseded: one owner-scoped read of an immutable row. Its hash is exposed as `inputIdentity.currentRevisionModelHash`.

**Effect:**
- After a Phase 30 cladding approval, the base's quantities and cost are `current` against the new revision and absent from `freshnessImpact.regenerate`.
- After a geometry or finish change, they are stale.
- Engine routes keep their revision-identity `currency`, and engines still run only on the current revision.

**Not done:** element-level input scopes, where a model change in one wing keeps the outputs of another current.

## 4. Other gap closures

| Change | Criterion |
|---|---|
| Cross-specialist scenario 39 test (`specialists.integration.test.ts`) | Gate L297 and scenario 39: outputs and a pending candidate of a superseded base are surfaced stale and blocked |
| Specialist rate-limit test | The generate quota is charged, refusals included; a throttled request stores nothing |

## 5. Tests and mutation checks

**New and changed tests:**
- `interior.integration.test.ts`:
  - scenario 33, then Exterior on the finished model and the refusal over the variant;
  - refusals that store nothing;
  - stale-base execute and approve;
  - SQL forgeries (`P3008` candidate, `P3007` commit);
  - 0029 over a populated 0028 database.
- `dependency-graph.test.ts` and `dependency-graph.integration.test.ts` (U2).
- `specialists.integration.test.ts`: U2 at the Exterior boundary; scenario 39; quota.
- `supabase.live.test.ts`: an S3 case through real JWT and RLS. **Written, not executed here** (no Docker).
- Existing tests whose premise changed with the decisions:
  - AC4 (graph) and E3 (evidence) re-saved an identical model; they now make a real model change and still prove the stale chain.
  - The B37 M4 cladding fixture now asserts U2.
  - Interior refusal examples now use the space-planning refusal.
  - The hosted-ledger pin is now `0029`.

**Mutation checks** (each applied alone, then restored):

| # | Mutation | Result |
|---|---|---|
| 1 | Specialist current-base guard removed | Caught |
| 2 | Specialist route outside the generate group | Caught |
| 3 | U2 rule disabled | Caught |
| 4 | Scene added to the equivalent families | Caught |
| 5 | SQL candidate finish-only check removed | Caught |
| 6 | SQL approve lock removed | Caught |
| 7 | TS appearance-variant guard removed | Caught (SQL still refused it) |
| 8 | Space-planning refusal removed | Caught |
