# B46 slice S1: end-to-end scenario and release evidence manifest

**Status:** implemented and locally verified as a **vertical slice**. **B46 is not complete, and its gate is not met** (§3).

**Branch:** `phases-40-46`. Plan of record: [b40-b46-implementation-plan.md](../roadmap/b40-b46-implementation-plan.md).

## 1. Roadmap traceability (ROADMAP L410–428)

| Requirement | S1 delivers |
|---|---|
| End-to-end tests from text requirement through project creation, 2D/BIM, engineering outputs, scoped conversational modification, diff/approval/restore and collaboration (L414) | `e2e-pipeline.integration.test.ts` runs one scenario through HTTP only, on PostgreSQL with all 30 migrations (see §2). |
| Strict provenance, immutable history, component locks, stale-result management, authorization, multi-tenant privacy, idempotent retries (L415) | Asserted along the scenario:<br>• plan consistency checks all `PASSED`;<br>• exactly one element changed, per the audit;<br>• history is 3 → 2 → 1 with nothing rewritten;<br>• an outsider gets 404 on every slice.<br>Idempotent retries are covered by the B40 suites. |
| Partial recomputation budget and processing benchmarks (L416) | The scenario records local stage timings (`B46_TIMINGS_FILE`), and the evidence manifest includes them as **measurements of this run on this machine**, never targets. Partial-recomputation budgets come from B40 S2 (`limits.maxTasks`). |
| Release evidence manifest: version, test commands/results, known limits, performance, security verification, unverified integrations, no false "production-ready" claims (L417) | `scripts/release-evidence.mjs` (see §2.1). |
| Mock adapters forbidden as evidence of live deployment (L424) | The evidence lists every unverified integration explicitly. The B45 compatibility package states `mockSubstitution: FORBIDDEN_AS_LIVE_EVIDENCE`. |

## 2. The scenario

These stages run in order:
1. `POST /api/projects`.
2. Generation of a two-storey parametric revision.
3. B42 feasibility (`WITHIN_ENGINE_SCOPE`).
4. B43 routing for interior finishes: only `interior.design`.
5. B41: "Change only the kitchen floor to stone tile and keep everything else" resolves to a change set.
6. B40: the plan executes with materials regeneration and a B34 verification branch. Every task is `COMPLETED`, the verification is `VERIFIED`, and every consistency check is `PASSED`.
7. B44: a reviewer reads the audit (one modified space, `finishes` only), comments on that element id and approves the model hash they saw.
8. B45: the scene is compiled and the delivery manifest gives two level chunks, with an anchor for the changed space.
9. B41 "Undo that" leads to a Phase 30 RESTORE preflight, execute and approve. This creates revision 3 with revision 1's model hash and parent 2.
10. Tenant isolation is checked across the slices.

### 2.1 The evidence script

`scripts/release-evidence.mjs` records:
- the commit, branch and clean flag;
- the Node version and platform;
- the route count and the route-catalog sha256 (the same algorithm as `GET /api/compatibility`);
- the migration count and latest migration;
- each slice record's status line;
- with `--run`, every B40–B46 suite's pass and fail counts, suite-level errors (reported separately, never hidden) and duration;
- the scenario's stage timings;
- `unverified[]`;
- `productionReady: false`.

## 3. Gate (L428): not met

"The specified representative scenarios pass against a **real deployed backend** and connected frontend contracts". This slice runs against embedded PostgreSQL and the in-process app only. The following were **not** performed:
- live Supabase acceptance for `0030`;
- the hosted D-9 check and the staging D-10 run;
- CI on a pushed head;
- the connected frontend and the desktop GPU matrix;
- any external provider;
- independent review.

The evidence manifest lists exactly these items.

## 4. Outstanding B46 work

- Scenarios for all nine frontend groups (L422).
- Large-project stress tests (the generator is capped at 2 storeys and 24 rooms).
- Accessibility.
- Reproducibility tiers.
- Outage and recovery drills.
- Billing limits.
- A production rollback runbook.
- A public limitation matrix.
- Per-capability frontend/backend sign-off.
- Running the live and hosted gates above.
