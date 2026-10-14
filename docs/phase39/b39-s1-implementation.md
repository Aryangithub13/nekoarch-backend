# B39 Slice S1: Specialist Envelope with Blueprint, Materials and Budget — Implementation Record

**Status:** implemented on `phase39/s1-specialists`, stacked on PR #17 (`phase37/manifest-v2` @ `20a7620`), which S1 needs for the B37 manifest. **Not merged; not a release.**

**Scope of record:** [`b39-specialist-scope.md`](https://github.com/Aryangithub13/nekoarch-backend/blob/phase39/specialist-scope/docs/phase39/b39-specialist-scope.md) on PR #20 (§3, §4 rows 1–3, §7 S1). The roadmap is cited as ROADMAP Lnnn.

## 1. Owner decisions in force

The owner confirmed these explicitly on 2026-10-14:

| ID | Decision | Effect on S1 |
|---|---|---|
| D-8 | Accept | B37 is development-complete. S1 builds on its manifest |
| D-9 | Operator | Hosted migration check is for an operator. S1 touches nothing hosted |
| D-10 | Prepare | Staging is prepared, not run |
| D-11 | Wait | No tag |
| D-4 | Scope | Module order and the meaning of "interior" as in the scope document. S1 = Blueprint, Materials, Budget |
| D-6 | Reuse | The PR #16 design-concept routes stay an advisory sub-output; S1 does not touch them |
| D-7 | Defer | No discovery clarification |

**D-8b (derived vs durable results) was not decided.** S1 therefore takes the option that needs no migration and no authorization:
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
     - Blueprint above 2 floors or 24 rooms → `FLOOR_LIMIT_EXCEEDED` / `ROOM_LIMIT_EXCEEDED`;
     - Materials substitutions → `SUBSTITUTION_PROVENANCE_UNAVAILABLE`;
     - Budget with a rate book that does not exist → `RATE_BOOK_UNAVAILABLE`;
     - Budget with a region no rate book covers → `REGION_NOT_COVERED`.
3. **The engine runs unchanged:** `saveProjectRevision` (generated), `createTakeoff`, `createConstruction`, `createCost`.
   - Each runs under its own route's durable receipt (`internalCommand`), keyed by the caller's `Idempotency-Key`, the module and the step.
   - The checks that depend on mutable state run **inside** the stored step, so a retry of a successful request replays it instead of being refused:
     - the base must be the current revision, else `STALE_DEPENDENCY` / `BASE_REVISION_SUPERSEDED`;
     - for Budget, the input takeoff and construction must be `current` in the B37 manifest, else `STALE_DEPENDENCY` / `INPUT_NOT_CURRENT`.
   - An engine's own 422 becomes a typed result with nothing stored: `UNSUPPORTED` for the generator's unsupported-geometry codes, otherwise `FAILED`.
4. **Freshness is read back from the B37 manifest** of the result revision, never computed by the envelope. Blueprint results also carry the manifest's `changeImpact`.

**Statuses actually assigned** (most restrictive wins; every reason is listed):

| Module | Status | Assigned when |
|---|---|---|
| Blueprint | `REQUIRES_REVIEW` | Independent B34 verification `FAILED` after QA passed |
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

**`apps/api/tests/specialists.test.ts`** (unit, 5 tests):
- the §E operation and scope vocabularies, verbatim;
- the six modules and the five L293 statuses;
- S1 module scopes (Blueprint can preserve nothing);
- status precedence;
- the strict request: duplicate or empty scopes, unknown fields, other versions;
- the result can never claim an operation, a job, provider cost, a provider or an engineering claim.

**`apps/api/tests/specialists.integration.test.ts`** (embedded PostgreSQL, 3 tests):

| Scenario | What is checked |
|---|---|
| 35, Blueprint | One new revision (number 2, parent = base) through the canonical generator and QA. The result, its artifact, its manifest and `changeImpact` name the same revision (gate L297). No job and no scene artifact is created. The same `Idempotency-Key` replays the same revision (200, `replayed`, still 2 revisions). The superseded base is then `STALE_DEPENDENCY` |
| 46, refusals | Ten typed refusals covering limits, operation, scope, two locks, substitutions, a foreign target and the three unimplemented modules. Each stores nothing: no revision, no takeoff. Validation is 400, another user 404, no token 401 |
| 37 and 38, Materials then Budget | Units, recipe pack and stored hashes match the takeoff route. Budget is `REQUIRES_REVIEW` with the synthetic rate book; a complete total exists only when fully priced. Every artifact is in the B37 manifest of the same revision. An unknown rate book or uncovered region is `UNSUPPORTED`. A tampered takeoff makes the next budget `STALE_DEPENDENCY` (`blocked` in the manifest) |

**Mutation checks** (each restored afterwards): 5 of 5 caught:
- the current-base check removed;
- synthetic rates not flagged;
- input freshness ignored;
- substitutions accepted;
- preservation locks ignored.

**Two defects were found by these tests before the first push:**
- A retry of a successful Blueprint request was refused as stale, because the base had moved. The fix moves the check into the stored step.
- Partial cost coverage was assumed to mean unpriced lines; it can also come from partial upstream quantities. Reasons now distinguish the two.

## 4. Not in S1

- **S2:** Exterior (cladding through Phase 30) and Structural.
- **S3:** Interior, which needs owner-approved schema work (D-9b).
- Durable envelope storage, if the owner chooses it (D-8b).
- Regional or sourced rate books, and substitution provenance.
- No migration. No hosted, staging, merge or tag action.
