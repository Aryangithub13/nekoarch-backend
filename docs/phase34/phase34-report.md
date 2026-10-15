# Phase 34 report — complex building verification

**Final status: PHASE 34 IMPLEMENTED; VERIFIED WITHIN SUPPORTED SCOPE ON THIS MACHINE (Windows), WITH THE EXCEPTIONS IN §F.**

## A. Summary

Any stored revision can now be verified by an independent, exact verifier. It has its own bigint geometry and shares no code with the generator, QA or BIM. It closes the cases the existing QA reports as not evaluated:
- setbacks on any polygon site, compared exactly at the boundary (2 599 vs 2 600 mm);
- floor support from the union of several plates, with stairs counted as carrying their stairwells;
- openings on diagonal hosts (a 3-4-5 host: 5 000 mm fits, 5 001 does not).

It also adds upper-storey overhang detection, and separate, exact plot, buildable, ground-coverage, gross-plate, gross-floor and net-space bases with coverage and FAR/FSI as reduced fractions. Declared limits are compared exactly but never presented as statutory. A scoped diff states whether two revisions differ only within a declared set of levels or entities.

## B. Source baseline

| Item | Value |
|---|---|
| Base | `e35c672` (Phase 33) on `phase33/account-library-context` |
| Branch | `phase34/complex-verification` |
| Protected | No migration (derived on read); existing routes and contracts unchanged |

## C. Implementation

| Area | Files |
|---|---|
| Contracts | `apps/api/src/verification/contracts.ts` |
| Independent exact geometry | `apps/api/src/verification/geometry.ts`: point location, simplicity, concave-safe containment, exact rational distances, integer square root, coordinate-compressed rectilinear unions with an operation budget |
| Verifier and diff | `apps/api/src/verification/verify.ts`, `apps/api/src/verification/diff.ts` |
| Service and routes | `apps/api/src/services/verification-service.ts`, `apps/api/src/routes/verification.ts` (3 routes) |
| Integration | Discovery `COMPLEX_VERIFICATION`; Sentry safe routes; OpenAPI and route catalog regenerated (120 → 123) |

**Defect found by the verifier during development (in the verifier itself).** The first version flagged the upper stairwell of every generated two-storey model as unsupported: it sits over the slab void cut for the stair. That is correct design, so the check now counts the footprints of stairs serving a level as support (design §4). With that fix, generated models verify cleanly, and the reported upper gross plate correctly excludes the 4.2 m² stair void.

## D. Verification

| Suite | Result |
|---|---|
| Phase 34 unit (`verification.test.ts`: geometry predicates, exact distances and flooring, unions and the budget, half-up ratios, every check family including boundary-exact cases, non-rectilinear fallback, overhang, declared limits, generated two-storey model, scoped diff and site allowance) | 13/13 |
| Phase 34 integration over HTTP on stored revisions (model-hash binding, determinism, declared limits, diff of a two-storey → one-storey revision against narrow and wide scopes, tenancy, cross-project refusal) | 3/3 |
| Unit and conformance suites | 2 364/2 365. The one failure is the pre-existing Windows path assertion in `interpretation.test.ts`. |
| Build, typecheck, lint | Clean |

## E. Limitations

- Unions and overhangs are exact only for rectilinear rings. Other shapes are reported `NOT_EVALUATED`, and their gross plate falls back to the level boundary, labelled as such.
- Setback distance is measured to storey envelopes (`level.boundary`), not to projections, eaves or balconies, which the model does not carry.
- No jurisdiction rule tables: only caller-declared limits are compared.

## F. Not covered

The Supabase live stack and the frontend were not exercised. No database change was needed for this phase.

## G. Scoped-diff repair (2026-10-14)

Three scoped-diff defects were each reproduced, fixed with a minimal change, and regression-tested (`verification.test.ts`, "B34-1" to "B34-3").

**B34-1: a document-level edit was hidden.**
- Before: renaming the model and changing `completeness` returned `IDENTICAL`, because only the nine entity collections and the site were compared.
- After: the document-level fields are compared too. Provenance stays outside model identity, as in Phase 35. A difference is reported as a `document` change. It is in scope only when the declared levels cover every level of both models, so a whole-model scope stays `WITHIN_SCOPE`, as before.

**B34-2: a false `OUT_OF_SCOPE_CHANGES`.**
- Before: reordering a wall's `spaceIds` reported a change.
- After: they are compared sorted. The model invariant treats them as a set, and Phase 35 preservation uses the same rule. A different set is still a change.

**B34-3: the violating level was dropped.**
- Before: `levelIds` was cut to two. A stair moved from `L1→L2` to `L3→L4` listed only `L1, L2`.
- After: every old and new level is listed. The schema maximum is now 4: a stair has `fromLevelId` and `toLevelId`, and no entity has more. The `inScope` rule is unchanged.

**Effect on the B37 manifest:**
- The manifest `diff` excludes the `document` entry. It already reports such edits as `modelHashChanged` with `MODEL_CHANGED_OUTSIDE_DIFF_COLLECTIONS`, so its output is unchanged for them.
- Its `levelIds` maximum is now 4.

**Changes:**
- OpenAPI: additive only (the `document` value; `maxItems` 4).
- No route, migration or B39 change.

**Evidence:**
- Each new test failed before the fix and passes after it. Reverting each fix on its own fails exactly its test; forcing a document change out of scope, or removing the manifest filter, is also caught.
- Relevant suites: verification, manifest, regeneration, zones, revision, specialists, modernization and foundation.

## H. Closure pass (2026-10-15)

- **Quota:** the two whole-model compute routes (`POST …/verification`, `POST …/verification/diff`) are now charged to the `generate` rate-limit group.
- **Tests added:**
  - diff coverage for openings, slabs, columns and specifications;
  - a model beyond the operation budget degrades to `PARTIAL`;
  - a site plan or photo upload never changes the canonical model.
- **Acceptance:** every Phase 34 criterion, with its evidence and the items that need an owner decision, is in [`phase34-acceptance.md`](phase34-acceptance.md).
