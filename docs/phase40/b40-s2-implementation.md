# B40 slice S2: independent analysis branches and task budgets

**Status:** implemented and locally verified as a **vertical slice**. **B40 is not complete** (§4).

**Branch:** `phases-40-46`, from `phase40/selective-revision-orchestration` @ `69ae94f` (S1). Plan of record: [b40-b46-implementation-plan.md](../roadmap/b40-b46-implementation-plan.md).

## 1. Roadmap traceability

| ROADMAP B40 | S2 delivers |
|---|---|
| "Orchestrate cross-module DAG plans rather than rewriting individual generators" (L311) | Two more specialist engines run inside a plan as their own branches: **Structural** (the B24 linear-static analysis, stored) and **Blueprint verification** (the B34 independent verifier, derived on read). Neither engine is modified. |
| "Recover independent failed branches without publishing partial accepted models" (L313) | A failure skips only the failed task's transitive dependants (`dependantsOf`). The other branches still run on the committed revision. A keyed retry replays every completed checkpoint and reruns only the failed branch. |
| "Cost safeguards" (L307), "user budget" (L312) | `limits.maxTasks`: a plan with more tasks than the ceiling is `OVER_BUDGET` at preview and `REFUSED` at execution, with nothing written. No subset is ever chosen on the caller's behalf. The quote reports `taskCount` and `maxTasks`. |

## 2. Contract changes (additive)

| Contract | Change |
|---|---|
| `ChangeSet.regenerate` | `structural?: StructuralInput` (the B24 input; it references model element ids), `verification?: { declaredLimits }` |
| `ChangeSet.limits` | `{ maxTasks?: 1–16 }`, default `{}`. It is part of the plan hash. |
| `PLAN_STATUSES` | `OVER_BUDGET`, placed after `NEEDS_CLARIFICATION` and before `STALE_BASE` |
| `TASK_KINDS` | `STRUCTURAL_ANALYSIS`, `COMPLEX_VERIFICATION` |
| Planned task | `branch`: `MODEL`, `MATERIALS_BUDGET`, `STRUCTURAL` or `VERIFICATION`. `writes` gains `NONE`; `module` gains `STRUCTURAL` and `BLUEPRINT`. |
| Quote | `taskCount`, `maxTasks` |
| Execution task | `report: { status, inputHash } \| null`: the checkpoint of a derived-on-read task |

**The DAG.** `MODEL_PREFLIGHT → MODEL_CANDIDATE → MODEL_COMMIT`, followed by three branches that each depend only on the commit:
- `QUANTITY_TAKEOFF → CONSTRUCTION_CALCULATION → BOQ_COST`;
- `STRUCTURAL_ANALYSIS`;
- `COMPLEX_VERIFICATION`.

Branches run in this fixed order, so execution is deterministic.

**Verification checkpoint.** The B34 report is derived on read and deterministic for `(model, declaredLimits)`, so it stores no receipt. A retry recomputes the same `inputHash`, and the test checks that hash against the B34 route. A report other than `VERIFIED` adds `VERIFICATION_NOT_CLEAN`, and the revision is not changed because of it.

## 3. Verification

| Suite | Result |
|---|---|
| `integration-branches.integration.test.ts` (new) | 3/3, on PostgreSQL:<br>• DAG shape and branches;<br>• takeoff failure → construction `SKIPPED`, structural and verification `COMPLETED`, status `PARTIAL`; the keyed retry replays the structural analysis (exactly one stored) and completes;<br>• `OVER_BUDGET` at preview and execution, with the base unchanged |
| `integration-plan.test.ts` | 15/15 (13 S1 + 2 new: transitive dependants, status precedence) |
| `integration-plan.integration.test.ts` (S1) | 8/8, unchanged behaviour |
| Modernization / OpenAPI drift | Pass after regeneration (additive) |

## 4. Outstanding B40 work

The S1 list (§6) still applies, except "Exterior, Blueprint and Structural are not composed". **Structural and Blueprint verification are now composed.** The remaining items are:
- Exterior model changes inside a plan: one Phase 30 operation per commit, and two-operation sequencing is not implemented;
- geometry and storey changes;
- agent or LLM planning (the [B41 S1](../phase41/b41-s1-implementation.md) resolver produces change-set drafts deterministically);
- durable B32 execution;
- element-level invalidation;
- live Supabase, CI, staging and independent review.
