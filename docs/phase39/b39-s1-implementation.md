# B39 Slice S1: Specialist Envelope with Blueprint, Materials and Budget — Implementation Record

**Status:** implemented on `phase39/s1-specialists` (PR #21), **merged by the owner** into `phase31/development` (`b543268`, 2026-10-14). It builds on the B37 manifest of PR #17 (`4d1da13`). **Not a release.** The S1 follow-ups (references, execution-cost ceiling, failed verification) and slice S2 (Exterior, Structural) are recorded in [`b39-s2-implementation.md`](b39-s2-implementation.md); the rows below marked *(S2 branch)* changed with them.

**Scope of record:** [`b39-specialist-scope.md`](https://github.com/Aryangithub13/nekoarch-backend/blob/phase39/specialist-scope/docs/phase39/b39-specialist-scope.md) on PR #20 (§3, §4 rows 1–3, §7 S1). The roadmap is cited as ROADMAP Lnnn.

## 1. Owner decisions in force

The owner confirmed these explicitly on 2026-10-14:

| ID | Decision | Effect on S1 |
|---|---|---|
| D-8 | Accept | B37 is development-complete. S1 builds on its manifest |
| D-9 | Operator | Hosted migration check is for an operator. S1 touches nothing hosted |
| D-10 | Prepare | Staging is prepared, not run |
| D-11 | Wait | No tag |
| D-4 | **Accepted** (2026-10-14) | The scope and its module order: Blueprint, Materials, Budget, Exterior, Structural, Interior. S1 = Blueprint, Materials, Budget |
| D-6 | Reuse | The PR #16 design-concept routes stay an advisory sub-output; S1 does not touch them |
| D-7 | Defer | No discovery clarification |

**Recorded in the scope:**
- **D-8b (derived vs durable results): computed on read.**
  - The B39 scope on PR #20 (`1d8f01e`) records "specialist results are computed on read for S1 and S2" as an owner decision of 2026-10-14.
  - On 2026-10-14 the owner told this session to "choose what's best for the project and finish it". S1 keeps computed on read: it needs no migration, reads freshness from the current manifest instead of storing it where it would go stale, and matches the derived-on-read B37 manifest. The trade-off (no result history, no fetch by id) is the scope's.
- **Blueprint room limit.** The scope's §4 row 1 was amended on 2026-10-14 (`8c42a35`): more than 24 requested rooms is a typed `UNSUPPORTED` / `ROOM_LIMIT_EXCEEDED`, as S1 implements. Between `1d8f01e` and `8c42a35` the scope had called it a 400. The existing `POST …/revisions/generate` contract is unchanged and still answers 400.
- **D-12, formerly D-9b (the interior schema work: a new revision-operation kind and V2 space finish fields): deferred** by the owner (2026-10-14; scope `04667c6`). Nothing implements or approves it; S2 does not depend on it; Interior stays a typed `UNSUPPORTED`.
- **Failed verification** *(S2 branch)*: a failed independent B34 verification after a Blueprint commit is `FAILED`, not `REQUIRES_REVIEW` (owner, 2026-10-14; scope `04667c6`).

**D-8b as built.** S1 takes the option that needs no migration and no authorization:
- results are **derived**, not stored as envelopes;
- everything a request produces is stored by the existing engines in their existing tables;
- retries replay through the existing durable receipts.

## 2. What was built

| Part | File |
|---|---|
| Contract `specialist-request-v1` | `apps/api/src/contracts/specialists.ts` |
| Service | `apps/api/src/services/specialist-service.ts` |
| Route `POST /api/projects/:projectId/specialists/:module/requests` | `apps/api/src/routes/specialists.ts` |
| Wiring (all additive) | Registration in `app.ts`; the `generate` rate-limit group; Sentry route allowlist; discovery row `SPECIALISTS`; OpenAPI contract; regenerated `docs/modernization/api-routes.json` and `openapi.json` |

**Flow of one request:**
1. **Ownership.** Reading the base revision gives 404 for another user's project or revision, as on the engine routes.
2. **Typed refusals; nothing is stored.** These are 200 results:
   - module not in S1 → `UNSUPPORTED` / `MODULE_NOT_AVAILABLE` (scenario 46, L779);
   - unsupported operation → `OPERATION_NOT_SUPPORTED`;
   - target scope outside the module → `SCOPE_NOT_SUPPORTED`;
   - a preservation lock on anything the module rewrites → `BLOCKED_BY_LOCK` / `PRESERVATION_CONFLICT`;
   - per module:
     - Blueprint above 2 floors → `FLOOR_LIMIT_EXCEEDED`, or above 24 requested rooms (the total of the per-type counts) → `ROOM_LIMIT_EXCEEDED`, as the scope requires (§4 row 1). Any other invalid requirement stays a 400;
     - Materials substitutions → `SUBSTITUTION_PROVENANCE_UNAVAILABLE`;
     - Budget with a rate book that does not exist → `RATE_BOOK_UNAVAILABLE`;
     - Budget with a region no rate book covers → `REGION_NOT_COVERED`.
3. **The engine runs unchanged:** `saveProjectRevision` (generated), `createTakeoff`, `createConstruction`, `createCost`.
   - Each runs under its own route's durable receipt (`internalCommand`), keyed by the caller's `Idempotency-Key`, the module and the step. The receipt's fingerprint covers the **whole envelope** and the step input, so reusing a key for a different request is a 409 `IDEMPOTENCY_CONFLICT`, as on every durable route.
   - Without a key, a repeat runs again. The engines converge where their tables are unique: one takeoff per revision and options, and one construction calculation per input fingerprint. Two concurrent Blueprint requests from one base commit one revision; the other is refused (`STALE_DEPENDENCY`) or gets the commit's 409.
   - The checks that depend on mutable state run **inside** the stored step, so a retry of a successful request replays it instead of being refused:
     - the base must be the current revision, else `STALE_DEPENDENCY` / `BASE_REVISION_SUPERSEDED`;
     - for Budget, the input takeoff and construction must be `current` in the B37 manifest, else `STALE_DEPENDENCY` / `INPUT_NOT_CURRENT`.
   - An engine's own 422 becomes a typed result with nothing stored: `UNSUPPORTED` for the generator's unsupported-geometry codes, otherwise `FAILED`.
4. **Freshness is read back from the B37 manifest** of the result revision, never computed by the envelope. Blueprint results also carry the manifest's `changeImpact`.
   - An output the manifest no longer reports as `current` makes the result `STALE_DEPENDENCY` / `OUTPUT_NOT_CURRENT`. This covers a concurrent commit, or a replay after the project moved on. The replay still returns the same stored revision or artifacts; only the derived status reflects the present.
   - If the manifest cannot be read after a write, the stored result is still returned, with `freshness: null` and `REQUIRES_REVIEW` / `MANIFEST_UNAVAILABLE`. An error here would invite an unkeyed retry that runs the engine again.
   - If independent verification cannot be run after a Blueprint write, the result is `REQUIRES_REVIEW` / `VERIFICATION_UNAVAILABLE`.
   - A manifest failure *before* a write (the Budget input check) is the manifest's own error, with nothing stored.

**HTTP semantics** (S1 contract; the scope fixes typed refusals, not status codes):
- 200 for a typed refusal or a replay;
- 201 when the request stored something;
- 400 for an invalid envelope or module configuration;
- 401 without a token, 404 for another user's project or revision;
- 409 for an idempotency conflict or the commit's own stale-base conflict.

**Statuses actually assigned** (most restrictive wins; every reason is listed):

| Module | Status | Assigned when |
|---|---|---|
| Blueprint | `FAILED` *(S2 branch)* | Independent B34 verification `FAILED` after QA passed (owner decision, 2026-10-14; `REQUIRES_REVIEW` as merged in PR #21). The reason says the revision was committed and is current, and how to restore the base |
| Blueprint | `REQUIRES_REVIEW` | Independent verification could not be run (`VERIFICATION_UNAVAILABLE`) |
| Blueprint | `PARTIAL` | Verification `PARTIAL` |
| Materials | `PARTIAL` | The takeoff or construction calculation is not fully evaluated |
| Budget | `REQUIRES_REVIEW` | **Always, while only synthetic rate books exist** (`SYNTHETIC_RATE_BOOK`) |
| Budget | `PARTIAL` | Coverage is not `FULLY_PRICED`, either because lines are unpriced (`UNPRICED_LINES`, listed by id) or because upstream quantities are partial (`UPSTREAM_PARTIAL`). `completeTotal` is then `null`; **a missing rate is never zero** (scenario 38, L768) |

**Never assigned in S1:** `CANDIDATE_READY`, `AWAITING_CONSENT`, `NEEDS_CLARIFICATION` and `DEGRADED_PROVIDER`. They are reserved for S2 and S3.

**Every result carries:**
- `operationId: null` and `jobIds: []`;
- a local quote with zero external cost;
- `providerId: null`;
- the three `NOT_CLAIMED` claims.

## 3. Tests

**`apps/api/tests/specialists.test.ts`** (unit, 5 tests; the room limit is pinned to both generator limits):
- the §E operation and scope vocabularies, verbatim;
- the six modules and the five L293 statuses;
- S1 module scopes (Blueprint can preserve nothing);
- status precedence;
- the strict request: duplicate or empty scopes, unknown fields, other versions;
- the result can never claim an operation, a job, provider cost, a provider or an engineering claim.

**`apps/api/tests/specialists.integration.test.ts`** (embedded PostgreSQL, 7 tests; the correctness pass of §5 added the last four rows):

| Scenario | What is checked |
|---|---|
| 35, Blueprint | One new revision (number 2, parent = base) through the canonical generator and QA. The result, its artifact, its manifest and `changeImpact` name the same revision (gate L297). No job and no scene artifact is created. The same `Idempotency-Key` replays the same revision (200, `replayed`, still 2 revisions). The superseded base is then `STALE_DEPENDENCY` |
| 46, refusals | Ten typed refusals covering limits, operation, scope, two locks, substitutions, a foreign target and the three unimplemented modules. Each stores nothing: no revision, no takeoff. Validation is 400, another user 404, no token 401 |
| 37 and 38, Materials then Budget | Units, recipe pack and stored hashes match the takeoff route. Budget is `REQUIRES_REVIEW` with the synthetic rate book; a complete total exists only when fully priced. Every artifact is in the B37 manifest of the same revision. An unknown rate book or uncovered region is `UNSUPPORTED`. A tampered takeoff makes the next budget `STALE_DEPENDENCY` (`blocked` in the manifest) |
| Idempotency and concurrency | Two concurrent keyed Blueprint duplicates make one revision. Two unkeyed ones from the same base commit one. The same key with a different envelope is 409. A replay after a newer revision returns the same revision as `STALE_DEPENDENCY` / `OUTPUT_NOT_CURRENT` (`stale`) |
| Materials and Budget replay | Keyed retries replay the same takeoff, construction and cost rows (200, `replayed`). Unkeyed repeats converge on the same rows. A different Budget body under the same key is 409 |
| Room limit | 25 requested rooms → `UNSUPPORTED` / `ROOM_LIMIT_EXCEEDED`, nothing stored. An invalid room type stays 400 |
| Manifest read-back failure | Injected through the service: written, `REQUIRES_REVIEW` / `MANIFEST_UNAVAILABLE`, freshness `null`. A normal re-read reports the same rows `current` |

**Mutation checks** (each restored afterwards): 5 of 5 caught:
- the current-base check removed;
- synthetic rates not flagged;
- input freshness ignored;
- substitutions accepted;
- preservation locks ignored.

**Correctness-pass mutation checks:** 4 of 4 caught:
- the fingerprint without the envelope;
- no room limit;
- read-back errors rethrown;
- output freshness ignored.

**Live local Supabase case** (`apps/api/tests/supabase.live.test.ts`, "B39 S1 specialist envelope through actual JWT and PostgREST"), through real anonymous-user JWTs, GoTrue, PostgREST and RLS on the repository's disposable local stack:
- a typed refusal stores nothing;
- another user gets 404 and no token gets 401;
- Materials stores the engines' own rows, owner-only through RLS;
- a keyed replay through the Supabase receipt adapter returns the same rows, and a key conflict is 409;
- Budget is `REQUIRES_REVIEW` on the synthetic rate book, with every artifact in the same revision's manifest;
- Blueprint commits one revision with no job, after which the old base is `STALE_DEPENDENCY`.

**Two defects were found by these tests before the first push:**
- A retry of a successful Blueprint request was refused as stale, because the base had moved. The fix moves the check into the stored step.
- Partial cost coverage was assumed to mean unpriced lines; it can also come from partial upstream quantities. Reasons now distinguish the two.

## 4. Not in S1

- **S2:** Exterior (cladding through Phase 30) and Structural: see [`b39-s2-implementation.md`](b39-s2-implementation.md).
- **S3:** Interior, which needs owner-approved schema work (D-12, formerly D-9b; deferred).
- Durable envelope storage. The scope records D-8b as "computed on read"; durable storage would need a new decision and a migration.
- Regional or sourced rate books, and substitution provenance.
- No migration. No hosted, staging, merge or tag action.

## 5. Correctness pass (2026-10-14) and acceptance evidence

**Defects found and fixed** (each first reproduced by a failing regression test):
1. **Key reuse.** Reusing an `Idempotency-Key` with a different envelope replayed silently. Only engine inputs were fingerprinted, so a changed `targetScopes` alone returned the earlier result. It now returns 409 `IDEMPOTENCY_CONFLICT`.
2. **Room limit.** More than 24 requested rooms was a 400; the scope requires typed `UNSUPPORTED`. It is now `ROOM_LIMIT_EXCEEDED`.
3. **Manifest read-back.** A failure after a write surfaced as an error. It is now a controlled result (§2, step 4).
4. **Output freshness.** An output no longer current was reported without any flag. It is now `OUTPUT_NOT_CURRENT`.

**Verified as already correct:**
- Concurrent duplicates do not produce two revisions.
- Refusals store nothing.
- Materials and Budget engine rows converge.
- Pricing never counts a missing rate as zero.

**Phase 35 research and source integrity.**
- The Phase 35 Engineering Research Enhanced V2 document is a reconstructed **process framework**: owner review required, no validated values. It is on the unmerged `docs/roadmap-research-baseline` branch. The reconciliation keeps it valid as a process; the original V2 research is still absent.
- S1 follows it by adding none of the following:
  - no standard, clause, factor, material property, rate or supplier price;
  - no professional-review claim (all three claims are `NOT_CLAIMED`).
- It labels the only rate books as synthetic (`REQUIRES_REVIEW`), refuses substitutions it cannot trace, and keeps engine outputs separate from any AI assumption: no AI step runs in S1.

**Gates:**

| Gate | State |
|---|---|
| Local unit, PostgreSQL and full suite | **Passed on `16bd11c`** (Node 22.22.0, unprivileged user, embedded PostgreSQL): build, typecheck, lint exit 0; **111 files, 3,083/3,083 tests**. Of these: `specialists.test.ts` 5, `specialists.integration.test.ts` 7, `project-manifest` 22 + 13, `bounded-reads` 6, `dependency-graph` 12 + 9, `modernization` 6 + 6, `foundation` (import boundary) 30. The run before regenerating OpenAPI (`ba43aec`) failed only the R01-G3 drift test, fixed in `16bd11c`. Later commits are docs only |
| Local disposable Supabase acceptance (real JWTs) | **Passed, 123/123**, including the S1 case. Receipt `docs/phase16-evidence/supabase-2026-10-14T07-27-16.304Z.json`: 3,857 requests, 0 API errors, 23 deliberate anonymous 401s from the existing cases. The first stack start failed its own health checks (realtime, storage) before any test ran; an unchanged retry started cleanly. The PostgREST image helper (`ensure-local-postgrest.mjs`) was not run in this pass (see the B37 gap report §6 for its registry deviation). **Not hosted** |
| Hosted Supabase acceptance, hosted migration history, staging, tag | Not run (D-9 operator, D-10 prepare, D-11 wait) |
| Push of the correctness pass | Pushed on owner instruction (`ce3d2c2`). CI run 38565757636: `backend (node 22.22.0)`, `backend (node 22.23.3)` and `container smoke` success; `supabase-acceptance` skipped (manual dispatch only) |

**PR order** (verified 2026-10-14 after the correctness pass):

| PR | State |
|---|---|
| PR #18 | Merged by the owner (`aac8e89`) |
| PR #17 (B37) | Merged by the owner (`4d1da13`). S1 already contained its head `f6f4de7` |
| PR #20 (B39 scope) | Draft, base `phase31/development`; head `8c42a35` carries the room-limit amendment |
| PR #21 (S1) | Base `phase31/development`. Marked ready for review once CI is green on the head carrying this record |

**Readiness of PR #21:**
1. Correctness pass pushed and green: **done**.
2. D-8b: computed on read, as recorded in the scope and kept on the owner's instruction: **done**.
3. Scope and code agree on every S1 refusal, including the room limit (`8c42a35`): **done**.
4. Owner review and merge: **the owner's**. Hosted gates stay D-9 operator, D-10 prepare, D-11 wait. D-12 (Interior) is deferred and does not affect S1.

No merge, base change or tag was made by this session.
