# Phase 30 verification

## Environment

| Item | Value |
|---|---|
| Node | v26.10.0 |
| Database | `embedded-postgres` 18.1.0-beta (per-run temporary cluster; all migrations 0001–0020 applied; real `authenticated` RLS roles through `asPrincipal`) |
| Worktree / branch | `designflow-phase30` / `phase30/selective-revision`, base `bb17949` |
| Source manifest | 433 files under apps, packages, supabase, scripts, test-support and the lockfiles; sha256 `878d32d8…45ae` ([evidence/source-manifest.json](evidence/source-manifest.json)) |

## Gates

| Gate | Command | Result |
|---|---|---|
| Baseline at `bb17949` | `npm run check` | exit 0: 75 files / 2 568 tests + 133 + 52 ([evidence/baseline-check.txt](evidence/baseline-check.txt)) |
| Final Phase 30 | `npm run check` (build, typecheck, lint, all tests, interpretation, conversations) | **exit 0: 77 files / 2 626 tests + 133 + 52** ([evidence/check.txt](evidence/check.txt)); no skips |
| Phase 30 unit | `apps/api/tests/revision.test.ts` | 44 / 44 |
| Phase 30 integration (embedded PostgreSQL, real worker pool) | `apps/api/tests/revision.integration.test.ts` | 14 / 14 |
| Mutation campaign | `python3 docs/phase30/mutation-test.py` | **22 / 22 killed for the intended reason, all files restored (sha256), controls green** ([evidence/mutation-testing.json](evidence/mutation-testing.json), [run log](evidence/mutation-run.txt)) |
| Benchmark | `npm run benchmark:revision` | [evidence/benchmark.json](evidence/benchmark.json) |
| Khronos glTF validator on candidate GLB | Scenario 16 | 0 errors / 0 warnings |
| Phase 29 compiler determinism | Scenario 14 | Byte-identical to the frozen `docs/phase29/evidence/fixtures/*.glb` |
| Local Supabase stack (`test:supabase`) | — | **Not run.** The running local stack is shared developer state at an older migration level. Running the suite needs migrations 0018–0020 applied to it, which changes the user's environment and was not authorized. The same SQL, RLS and RPCs run on embedded PostgreSQL. |
| Frontend adapter contracts | — | **Blocked.** The NekoArch frontend repository is not on this machine. |

## First-run regressions found by existing guards (fixed, then re-verified)

1. **Table and foreign-key inventory** (`supabase/tests/database.test.ts`): the guard pins the public tables and foreign keys. Updated to 28 tables and 55 foreign keys, with all 11 new foreign-key definitions pinned verbatim.
2. **Generator import boundary** (`foundation.test.ts`): the revision service imported `@designflow/generator`. Fixed by moving the stored-revision QA derivation into `project-service.ts` (`storedRevisionQaReport`); the allowlist is unchanged.

**Integration defects found by the new suite (fixed):**
- The idempotency operation whitelist was missing the Phase 30 routes; added in 0020, following the 0010/0014–0019 pattern.
- An idempotent execute replay returned the SQL receipt shape (`{operation}`). SQL now returns the exact API shape, so replays are byte-equivalent.
- The purge guard trigger referenced `old.artifact_id` from the artifacts table. Split into per-table guard functions.

## Acceptance scenarios (all against authenticated HTTP on real PostgreSQL unless noted)

| # | Scenario | Test | Evidence highlights |
|---|---|---|---|
| 1 | Exterior-only visual change | `Scenario 16`, `Scenarios 4/5/12` | Preflight lists the exterior wall targets (with BIM ids) and the system + user locks. The candidate GLB SHA differs from the Phase 29 scene of A, the BIN chunk is byte-identical, and +1 material. `X-Candidate-Status: UNACCEPTED`; current stays A until approval; B commits; A unchanged. |
| 2 | Structural-preservation conflict | `Scenario 2` | Larger glazing + locked walls/openings/structure → `BLOCKED_BY_LOCK` with the dependent checks INVALIDATED (BIM, scene, takeoff, structural, environmental…). Execute → 409; no artifact. Unlocked opening edit → `UNSUPPORTED`; "glass facade" → `NEEDS_CLARIFICATION`. |
| 3 | Room-specific cosmetic change | `Scenario 3` | Typed refusal `INTERIOR_FINISH_NOT_SUPPORTED`; interior finish is not advertised in discovery |
| 4 | Blueprint preservation | `Scenarios 4/5/12` | B's spaces, walls, stairs and openings deep-equal A's |
| 5 | BIM and scene consistency | `Scenarios 4/5/12` | Every BIM element id identical in A and B; BIM diff all `UNCHANGED`; target BIM ids equal the scene objects' |
| 6 | Candidate rejection | `Scenario 6` | `REJECTED`; approve after reject → 409; current unchanged; cancel works |
| 7 | Restoration A → B → C | `Scenario 16` | C (rev 3, parent B) has A's model hash and the default appearance; A and B stay reviewable; history `[3, 2, 1]` |
| 8 | Stale-base concurrency | `Scenario 8` | Second approval → 409 `REVISION_BASE_STALE`, operation `STALE_BASE`. Two simultaneous approvals → exactly one 201. |
| 9 | Idempotency | `Scenario 9` | Replayed preflight, execute and approve return identical results; one operation, one candidate, one revision. A reused key with a different body → `IDEMPOTENCY_CONFLICT`. |
| 10 | Cross-user security | `Scenario 10` | 10 routes → 404 for another user and 401 anonymous. RLS hides rows; direct `UPDATE` and blob `SELECT` → `42501`. |
| 11 | Failed worker | `Scenario 11` | crash / garbage → 503 + `FAILED`; invalid → 422 + `VALIDATION_FAILED`; refusal → 422 + `FAILED`. No artifact, no revision in any case. |
| 12 | Engineering freshness | `Scenarios 4/5/12`, `Scenario 2` | Takeoff reported `SOURCE_EQUIVALENT` (`recomputed: false`, `newlyVerified: false`); takeoff row count unchanged. A geometry change is refused with dependent checks listed. |
| 13 | Resource exhaustion | `Scenario 13` | 6th active operation → 429 `REVISION_LIMIT_EXCEEDED`. Saturated pool → one `REVISION_QUEUE_FULL` (operation stays `AWAITING_CONSENT`) and one `REVISION_WORKER_TIMEOUT` (operation `FAILED`). |
| 14 | Scene determinism | unit `Scenario 14`, unit `applies a finish…` | The Phase 29 compiler is byte-identical to the frozen release GLBs; the same base + appearance → identical candidate bytes |
| 15 | Source-to-output provenance | `Scenario 16` | The manifest source is revision A's model hash; B's appearance artifact = the candidate; lineage `{operation, modelEquivalentToBase: true}`; audit `PREFLIGHT → CANDIDATE_READY → COMMITTED` |
| 16 | **Complete live backend flow** | `Scenario 16` | **A → preflight → consent → execution → validated candidate → comparison → approval → immutable B → restore as C, passing** |
| — | Expiry and retention | `Expiry and retention` | Expired → 409 `REVISION_OPERATION_EXPIRED`; purge expires the operation and deletes abandoned candidate bytes; committed artifacts and appearances are undeletable/immutable (`23514`) |
| — | SQL invariants | `SQL invariants`, `SQL forged candidate` | Unsigned → `42501`; geometry smuggled into approval → `P3007`; forged preflight binding → `P3008`; forged candidate binding (single- and double-field) → `P3008`; unvalidated candidate → `P3008`; re-approval of a committed operation → `P3003`; out-of-graph transition → `P3002`; identity edit → `23514` |
| — | F25 conversation tool | `Scenario F25` | `PLAN_REVISION` returns the same preflight with `persisted: false`; no operation row |

## Independent validation and mutation results

The appearance validator (`revision/verify.ts`) imports neither the appearance pass, the job, nor the Phase 29 compiler/writer (enforced by a test and by mutant M05). It re-derives targets with its own ray-cast orientation and parses both GLBs itself.

| Id | Defect planted | Killed by |
|---|---|---|
| M01 | Protected wall moved (BIN check removed) | unit `protected wall moved` |
| M02 | Material override on a protected object | unit `material override…` |
| M03 | BIM element id swap | unit `BIM element id swapped` |
| M04 | Incorrect candidate binding | unit `incorrect candidate binding` |
| M05 | Validator imports the appearance pass | unit `validator is independent` |
| M06 | Finish beyond the exterior shell (both guards removed) | unit `exactly the exterior shell targets` |
| M07 | Façade orientation inverted | unit `labels bounding-box façades` |
| M08 | Validator bypass in the worker job | unit `cannot be bypassed in-process` |
| M09 | Lock conflicts ignored | unit planner `BLOCKED_BY_LOCK` |
| M10 | Appearance falsely invalidates engineering | unit `source-equivalent impacts` |
| M11 | Interior finish silently accepted | unit `warmer finish in the bedroom` |
| M12 | Stale engineering marked newly verified | integration `Scenarios 4/5/12` |
| M13 | Candidate presented as accepted | integration `Scenario 16` |
| M14 | SQL semantic model lock removed | integration `SQL invariants` |
| M15 | SQL stale-base approval check removed | integration `Scenario 8` |
| M16 | Cross-user read (RPC owner check removed) | integration `Scenario 10` |
| M17 | SQL candidate binding check removed | integration `SQL forged candidate` |
| M18 | Transition trigger opened | integration `SQL invariants` |
| M19 | RLS owner policy opened | integration `Scenario 10` |
| M20 | SQL accepts unvalidated candidate | integration `SQL forged candidate` |
| M21 | Approval of a different candidate | integration `Scenario 16` |
| M22 | Duplicate commit (SQL already-committed check removed) | integration `SQL invariants` |

**Equivalent mutants (recorded, not counted):**
- **Run 1:** the scene-layer target filter removed alone.
- **Run 2:** the wall-classification filter removed alone. Each guard independently excludes interior walls. Run 1 also exposed two weak tests: the single-field candidate forgery (masked by the scene-source consistency check) and duplicate commit (masked by the service check and the transition trigger). Both were strengthened, not removed.
- **Runs 1–2:** preserved in [evidence/preliminary/](evidence/preliminary/).

## Benchmarks ([evidence/benchmark.json](evidence/benchmark.json); one process, embedded PostgreSQL; observations, not SLOs)

**In-process measurements:**

| Measurement | Median |
|---|---|
| Intent parse (500 runs) | 0.02 ms |
| Planner, setback fixture (incl. BIM projection) | 38.7 ms |

| Fixture | Objects | Targets | Apply | Validate | Base → candidate GLB | Candidate gzip | Candidate manifest |
|---|---|---|---|---|---|---|---|
| single | 52 | 22 | 1.65 ms | 1.65 ms | 117 904 → 118 156 B | 11 741 B | 58 628 B |
| L | 48 | 20 | 1.40 ms | 1.38 ms | 112 320 → 112 576 B | 11 046 B | 57 439 B |
| setback | 90 | 40 | 2.37 ms | 2.43 ms | 229 320 → 229 572 B | 25 132 B | 97 386 B |
| maximum | 203 | 52 | 5.20 ms | 5.55 ms | 474 636 → 474 888 B | 39 022 B | 222 009 B |

**Worker pool (setback):**
- Worker job (compile + Phase 29 validation + appearance + independent validation): 151–203 ms; queue wait ≈ 0.01 ms.
- A burst of 6 concurrent jobs → 5 accepted, 1 `REVISION_QUEUE_FULL`, as designed.

**Live HTTP on embedded PostgreSQL (5 runs each):**

| Route | Median | p90 |
|---|---|---|
| Preflight | 137.9 ms | 165.5 ms |
| Execute | 355.6 ms | 584.9 ms |
| Approve (QA re-run + SQL commit) | 186.8 ms | 208.8 ms |
| Read operation | 2.5 ms | — |
| Candidate GLB | 5.2 ms | — |
| Comparison | 16.0 ms | — |

No browser FPS or visual-quality claim is made.

## Unverified or not claimed

- Real-device rendering of the appearance variants: no FPS or perceptual-quality measurement.
- Frontend adapter compatibility: blocked, repository absent.
- The local Supabase stack run: see Gates.
- Physical glazing, thermal, structural or product properties of finishes: `NOT_CLAIMED` by design.
