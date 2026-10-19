# B40 slice S1: change-set plans and checkpointed selective regeneration

**Status:** implemented and locally verified as a **vertical slice**. **B40 as a phase is not complete** (see §6).

**Branch:** `phase40/selective-revision-orchestration`, from `phase31/development` @ `4713218`. Not merged, tagged, deployed or migrated anywhere.

**Authority:** ROADMAP [`docs/sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md`](../sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md) (on `main`), §B Phase 40, L300–315, and invariants §A1/A2/A4.

## 1. Roadmap traceability

| ROADMAP B40 (L300–315) | S1 delivers | Not yet |
|---|---|---|
| Agent plans need typed operations, permissions, scope, preservation constraints, bounded retries and explicit approval (L306) | `change-set-v1`: typed `add`/`modify`/`remove`/`replace` on stable element ids; Phase 30 locks; owner-only routes; approval = the exact `planHash` plus consent; keyed retries replay per-task receipts | Agent (LLM) planning: none. Change sets are structured input only |
| Partial regeneration across artifacts with checkpoints, task-level failure recovery, cost safeguards, explainable decisions (L307) | Task DAG with one checkpoint per task; pre-commit failure cancels the operation and commits nothing; downstream failure keeps the valid commit, skips dependants, and a keyed retry resumes; every change, output and task carries a reason | Cost safeguards beyond `externalCostUsd: 0`: no provider is called |
| Consume the six B39 specialist operations; orchestrate cross-module DAGs (L311) | Interior (Phase 30 `INTERIOR_FINISH_MODIFY`), Materials (takeoff, construction) and Budget (cost) engine services, in dependency order | Exterior, Blueprint and Structural are not composed into plans yet |
| Enforce model locks, authorization, scope limits, engineering gates, dependency invalidation, consent at every step (L312) | All of these, at plan and at execution | Engineering gates beyond existing B37 freshness |
| Checkpoint and recover without publishing partial accepted models (L313) | Only the Phase 30 SQL commit writes the model; tests 4a/4b/5 | — |
| Gate: cannot bypass locks or turn unverified output into an accepted engineering assertion (L315) | Locks checked first; `claims` all `NOT_CLAIMED`; freshness only from the B37 manifest | — |

## 2. What was built

| File | Purpose |
|---|---|
| `apps/api/src/contracts/integration.ts` | Change set, plan, element diff and execution schemas |
| `apps/api/src/integration/element-diff.ts` | Pure diff by stable element id, naming changed fields; refuses duplicate ids |
| `apps/api/src/integration/plan.ts` | Pure per-change validation: identity, hard locks, supported operations, storey limit |
| `apps/api/src/services/integration-service.ts` | Plan composition (Phase 30 planner, B37 manifest) and checkpointed execution |
| `apps/api/src/routes/integration.ts` | `POST /api/projects/:projectId/integration/plans` (preview) and `/plans/execute` |
| `app.ts`, `http-protection.ts`, `sentry.ts`, `test-support/openapi.ts`, `docs/modernization/*` | Registration, `generate` rate-limit group, error-route allowlist, contracts, regenerated catalog and OpenAPI (additive) |

No migration. No change to the Phase 30, B37 or B39 behaviour. No new dependency.

**Lifecycle.** Preview stores nothing. Execute re-derives the plan, refuses a different `planHash` (409 `INTEGRATION_PLAN_CHANGED`), then runs:
`MODEL_PREFLIGHT → MODEL_CANDIDATE → MODEL_COMMIT → QUANTITY_TAKEOFF → CONSTRUCTION_CALCULATION → BOQ_COST`, with the downstream tasks only when `regenerate` asks for them.
After the commit it checks that the committed model diff equals the planned diff and that every untargeted element is unchanged.

## 3. Supported versus refused

| Change | Result |
|---|---|
| `modify space {finishes}` on an existing space | **Executed** through Phase 30 (`0029` finish-only lock in SQL) |
| Any other `modify` (space boundary, name, wall thickness…) | `UNSUPPORTED` `ELEMENT_GEOMETRY_NOT_SUPPORTED`: no engine regenerates an element selectively |
| `remove`, `replace`, `add` (except storeys) | `UNSUPPORTED` with a typed code |
| `add level` above `GENERATION_MAX_FLOORS` (2) | `UNSUPPORTED` `GEOMETRY_LIMIT_EXCEEDED`, `limit {value: 2, requested: 3}`, required checks listed, base unchanged |
| `add level` within the limit | `UNSUPPORTED` `SELECTIVE_STOREY_ADDITION_NOT_SUPPORTED`: regenerate through Blueprint |
| Change touching a preserved scope | `BLOCKED_BY_LOCK`, decided before support |
| Unknown id, duplicate target, invalid finish | `NEEDS_CLARIFICATION` or `INVALID` |
| Any refused change in a set | The whole set is refused; the supported part never runs alone |

The 2-storey and 24-room limits were re-checked in source (`MODEL_LIMITS` `GENERATION_MAX_FLOORS`, `MAX_REQUESTED_ROOMS`) and are unchanged.

## 4. Invalidation granularity (honest limit)

Invalidation is **whole-model**, from the B37 graph: any model change makes every model-bound output of the base stale. B40 S1 does not add element-level input scopes.

The unit test `a finish-only change does not alter the quantity takeoff` shows the cost of this: the takeoff report is byte-identical after a finish change, yet it is marked stale. Element-level input scopes would need a change to B37 freshness semantics, which is an owner decision (B39 U2 explicitly excluded it).

Selective regeneration therefore means: only the requested outputs are recomputed on the new revision; every other output stays stored on the base, reported stale, and is never presented as current.

## 5. Verification

Local runs on Node 22.22.0 (embedded PostgreSQL as an unprivileged user):
- `npm run build`, `npm run typecheck` and `npm run lint`: exit 0;
- `npx vitest run` (full suite): **115/115 files, 3,119/3,119 tests**, exit 0;
- `git merge-tree` with PR #27's head `13ea7aa`: no conflict.

The drift test passes after regenerating the catalog and OpenAPI with `UPDATE_ROUTE_CATALOG=1`. Acceptance tests are in `apps/api/tests/integration-plan.test.ts` (13 unit tests) and `apps/api/tests/integration-plan.integration.test.ts` (8 PostgreSQL tests). The integration tests cover:
1. A single-room revision (with cross-specialist checks).
2. Preservation locks.
3. Dependency invalidation.
4. a: a failure before the commit; b: a failure downstream, with keyed resume.
5. A stale base, and a concurrent commit refused by SQL `REVISION_BASE_STALE`.
6. Storey-limit refusal.
7. Authorization and configuration refusals.

### B34 isolation and deferred Blueprint verification

The B34 repair ([PR #27](https://github.com/Aryangithub13/nekoarch-backend/pull/27), `phase34/diff-integrity`) is owned by a separate session. This slice:
- edits none of its files;
- does not import its scoped diff (`verification/diff.ts`), and uses its own field-level element diff instead;
- does not run the B34 verifier.

`http-protection.ts` and `openapi.json` are edited by both, in separate hunks.

**Re-run after PR #27 merges** (deferred, not claimed):
- `verification.test.ts` and `verification.integration.test.ts`;
- `specialists-verification.integration.test.ts` and `specialists.integration.test.ts` (Blueprint `verificationStatus`);
- `project-manifest.test.ts` and `project-manifest.integration.test.ts` (manifest diff);
- both B40 suites (they read the manifest);
- OpenAPI regeneration if the merge leaves drift.

## 6. Outstanding B40 work

1. Agent or LLM planning: natural language into a change set, with grounding and clarification.
2. Composing Exterior, Blueprint (full regeneration for geometry and storey changes) and Structural into plans.
3. Element-level invalidation, which needs an owner decision on B37 semantics.
4. Durable B32 jobs for long tasks, and a sweeper for abandoned partial runs. Today the run is synchronous; recovery is a keyed retry.
5. Large-scale or multi-zone projects. The model is still capped at 2 storeys and 24 rooms.
6. Gates not run:
   - live Supabase acceptance (needs a B40 case in `supabase.live.test.ts`);
   - CI on a pushed head;
   - hosted D-9, staging D-10 and the release tag;
   - independent review.
