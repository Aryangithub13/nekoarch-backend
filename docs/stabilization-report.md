# Phase 19 + Phase 20 final stabilization report

Date: 2026-10-03. Repository: `/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow`. Source checkpoint: `f17a33703b226117ad3cbfa4f25a1889dccce71b` plus the reviewed uncommitted stabilization delta.

**Phase 19: FULLY IMPLEMENTED AND VERIFIED within its documented bounded scope.**

**Phase 20: FULLY IMPLEMENTED AND VERIFIED within its documented bounded scope.**

Every required backend gate has a final PASS. Git release approval remains a human action. No commit, staging, tag mutation, push, merge, deployment or Phase 21 work was performed.

## 1. Repository audit

The authoritative repository is `designflow`, branch `main`, incoming and final HEAD `f17a33703b226117ad3cbfa4f25a1889dccce71b`. Incoming tree was clean. Final tree contains stabilization code/tests, benchmark changes and reports/evidence, all unstaged. [Incoming SHA-256 inventory and verified recovery](stabilization-evidence/incoming.json) covers 659 tracked files; replacement verified all-refs Git and source archives are recorded in `incoming.json` and the final recovery note below. [Exact file inventory](stabilization-evidence/changed-files.json) covers the final delta.

## 2. Repository inconsistency resolution

The user explicitly designated `designflow` as the original authoritative backend and `NekoArch` as an independent experimental frontend/visualization workspace. The experimental directory's absence is irrelevant to backend readiness. No frontend was copied, rebuilt, recovered or modified. Earlier reports mentioning `apps/web` are historical, and have notices pointing to this review. Windows is not mounted. No cross-copy hash equivalence or explanation of the external directory's disappearance is fabricated. [Repository reconciliation](repository-reconciliation.md) records the evidence and boundary.

## 3. Phase 19 assessment

The audited implementation is opt-in `precision-blueprint-v2`; unmarked requests retain V1. Source and tests cover exact integer-mm normalization, simple orthogonal L/U sites, containment/setbacks, bounded rectangular-envelope decomposition, deterministic relationship-aware topology, one/two floors, up to 24 rooms, clear minimum dimensions, entrance/circulation, straight stairs and slab voids, hard adjacency/door/passage/separation requirements, and conceptual parking. Privacy, orientation and exposure remain explicitly heuristic.

Independent QA reconstructs wall-face clearances, circulation and opening/parking/entry geometry rather than accepting solver scores. Adversarial model mutations are rejected. Frozen V1 model, metadata and identity fixtures remain exact. Source inspection and real acceptance verify the generator → QA → signed immutable revision → takeoff → construction → cost/workflow path, including incomplete parking costs. Existing solver production source is unchanged by this stabilization. See [Phase 19 review](phase19-final-review.md) and [manifest](phase19-final-verification.json).

## 4. Phase 20 assessment

The audited flow persists owner-scoped conversations, cumulative intent and exact native requirements; performs bounded interpretation and native merging; stores versioned proposals/diffs; and requires approval of the exact persisted proposal before invoking existing generation and QA. Approval and its receipt commit atomically. Three reproduced planner defects were repaired. API/database tests cover multi-turn dimensions/counts/floors, kitchen clarification, unresolved relative moves, native L-site preservation, restoration ownership, exact approval, replay, concurrency, quota limits and deletion without history loss. No new unrestricted AI feature was added. See [Phase 20 review](phase20-review-report.md) and [manifest](phase20-verification.json).

## 5. Bugs fixed

1. **Unresolved bedroom moves could silently become proposals.** The fallback parser represented “move one bedroom upstairs” as an absolute upstairs count. The planner asked for clarification when the source allocation was unknown but retained that count in pending intent. A later unrelated seed edit applied it. The planner now removes that inferred allocation and persists a defaulted `pendingBedroomMove` flag until an explicit allocation or native room replacement resolves it. Tests cover the multi-turn failure, persistence and repair through both PostgreSQL and live Supabase.
2. **Explicit native clarifications could remain stuck.** Pending natural-language site/room/relationship constraints were applied before their explicit native replacement, re-adding the clarification the replacement was intended to resolve. `supersedeNativeIntent` clears language fields covered by the supplied native objects before validation; omitted fields and V2 intent stay intact. A constrained L-site regression now accepts the exact native site replacement and preserves unrelated requirements.
3. **Disabled mode bypassed history trimming.** Its early return retained twenty 4,000-character multibyte messages, reaching 244,603 serialized bytes in the reproducer and violating the 128 KiB database bound. A shared finalizer now computes the summary then trims display messages on both ordinary and disabled paths while preserving exact native requirements. The regression and bounded-state benchmark pass below 120,000 bytes.

The original three failures are retained in [regressions-before.txt](stabilization-evidence/regressions-before.txt). Tests, budgets, lint rules and security controls were not relaxed. No Phase 19 solver correction was necessary. U-site and conversation recovery benchmark coverage was added. A new container-test artifact initially failed lint because Node globals were not imported; explicit imports fixed that artifact, and final lint passes.

## 6. Database security

Migration 0012 is additive and unchanged. Owner SELECT RLS, revoked direct writes, caller/project association and HMAC-bound operations remain authoritative. SQL independently verifies proposal/lease bindings and nests signed project revision commit and receipt update in one transaction. Quota creation is serialized by an owner advisory lock. New tests verify valid signatures bound to the wrong caller/input/operation/expiry are rejected, alongside anonymous/cross-owner access and direct-write rejection. Controlled receipt failures roll back, and lost committed responses replay without another revision. [Security audit](security-audit.md) documents source inspection, fault-injection scope, endpoint restrictions and migration recovery.

## 7. Integration

No V2 activation without the explicit option, no downgrade during conversations, and no provider-authored native update. Existing requirement hashes continue to exclude execution seed while including solver/versioned requirements; actual generation identity and model hashes remain unchanged in meaning. Revision CAS, replay and parent/source lineage are exercised through PostgreSQL and real Supabase JWT/PostgREST. Read-only conversation tools cannot execute workflows. Parking quantities/costs remain honestly incomplete. The compiled production container independently passed V2 planning/generation/QA/takeoff checks with networking disabled.

## 8. Test results

Durations are complete command wall times, including builds. Test counts overlap and must not be added as unique tests. `check` includes its 1,840-test core run plus repeated 133-test interpreter and 52-test conversation runs. Two standalone PostgreSQL integration runs each passed 179 tests, in addition to their inclusion in `check`.

| Exact command | Status / exit | Seconds | Test count(s) | Log |
| --- | --- | ---: | --- | --- |
| `npm run build` | PASS / 0 | 13.084 | — | [build](stabilization-evidence/build.txt) |
| `npm run typecheck` | PASS / 0 | 20.380 | — | [typecheck](stabilization-evidence/typecheck.txt) |
| `npm run lint` | PASS / 0 | 3.219 | — | [lint](stabilization-evidence/lint.txt) |
| `npm run test:unit` | PASS / 0 | 38.185 | 1659 passed (1659) | [test:unit](stabilization-evidence/test:unit.txt) |
| `npm run test:generator` | PASS / 0 | 15.592 | 491 passed (491) | [test:generator](stabilization-evidence/test:generator.txt) |
| `npm run test:blueprint` | PASS / 0 | 7.648 | 137 passed (137) | [test:blueprint](stabilization-evidence/test:blueprint.txt) |
| `npm run test:blueprint-qa` | PASS / 0 | 14.025 | 177 passed (177) | [test:blueprint-qa](stabilization-evidence/test:blueprint-qa.txt) |
| `npm run test:solver-v2` | PASS / 0 | 25.645 | 40 passed (40) | [test:solver-v2](stabilization-evidence/test:solver-v2.txt) |
| `npm run test:projects` | PASS / 0 | 18.117 | 23 passed (23) | [test:projects](stabilization-evidence/test:projects.txt) |
| `npm run test:takeoff` | PASS / 0 | 20.848 | 23 passed (23) | [test:takeoff](stabilization-evidence/test:takeoff.txt) |
| `npm run test:construction` | PASS / 0 | 18.453 | 34 passed (34) | [test:construction](stabilization-evidence/test:construction.txt) |
| `npm run test:cost` | PASS / 0 | 21.392 | 39 passed (39) | [test:cost](stabilization-evidence/test:cost.txt) |
| `npm run test:workflows` | PASS / 0 | 20.732 | 51 passed (51) | [test:workflows](stabilization-evidence/test:workflows.txt) |
| `npm run test:interpretation` | PASS / 0 | 17.537 | 133 passed (133) | [test:interpretation](stabilization-evidence/test:interpretation.txt) |
| `npm run test:conversations` | PASS / 0 | 18.203 | 52 passed (52) | [test:conversations](stabilization-evidence/test:conversations.txt) |
| `npm run test:integration` | PASS / 0 | 54.412 | 179 passed (179) | [test:integration](stabilization-evidence/test:integration.txt) |
| `npm run test:integration` | PASS / 0 | 54.172 | 179 passed (179) | [integration-repeat](stabilization-evidence/integration-repeat.txt) |
| `npm run test:supabase` | PASS / 0 | 66.455 | 84 passed (84) | [test:supabase](stabilization-evidence/test:supabase.txt) |
| `npm run db:test` | PASS / 0 | 2.347 | 51 PgTAP assertions | [db:test](stabilization-evidence/db:test.txt) |
| `npm run check` | PASS / 0 | 160.492 | 1840 passed (1840); 133 passed (133); 52 passed (52) | [check](stabilization-evidence/check.txt) |
| `docker build -t designflow-api:stabilization .` | PASS / 0 | 50.391 | — | [docker-build](stabilization-evidence/docker-build.txt) |
| `node scripts/smoke-container.mjs designflow-api:stabilization` | PASS / 0 | 1.312 | — | [docker-smoke](stabilization-evidence/docker-smoke.txt) |
| `docker run --rm -i --network none designflow-api:stabilization node --input-type=module < docs/stabilization-evidence/container-acceptance.mjs` | PASS / 0 | 0.915 | — | [docker-acceptance](stabilization-evidence/docker-acceptance.txt) |
| `node --import tsx scripts/benchmark-solver-v2.ts` | PASS / 0 | 13.593 | — | [benchmark-solver](stabilization-evidence/benchmark-solver.txt) |
| `node --import tsx scripts/benchmark-conversations.ts` | PASS / 0 | 2.138 | — | [benchmark-conversations](stabilization-evidence/benchmark-conversations.txt) |
| `git diff --check` | PASS / 0 | 0.004 | — | [diff-check](stabilization-evidence/diff-check.txt) |

The first sandboxed `check` exited 1 because local socket creation was prohibited (1648 passed, 180 skipped; failed suite setup); it is superseded by the successful socket-enabled run, not counted as a passing integration run. The three intentional failing regressions and intermediate artifact lint error remain documented. [Combined machine-readable manifest](stabilization-evidence/verification.json) records final gates and superseded attempts.

`web:build`: **NOT APPLICABLE**, absent by intended backend separation. Real local model language evaluation: **NOT EXECUTED**, no discovered configured runtime; mocked protocol behavior is not language accuracy. No mandatory backend gate remains FAIL, SKIPPED or BLOCKED. No timeout, assertion, test inclusion or lint rule was weakened.

## 9. Performance

All 20 solver/case groups, three runs each (60 runs), were deterministic, including stable failure diagnostics. All successful generated cases passed independent QA. Values below are sequential median milliseconds, not production SLOs.

| Case | Engine | Solver ms | QA ms | Outcome |
| --- | --- | ---: | ---: | --- |
| 1BHK | v1 | 21.67 | 4.85 | PASS |
| 1BHK | v2 | 187.40 | 4.36 | PASS |
| 2BHK | v1 | 11.60 | 3.84 | PASS |
| 2BHK | v2 | 236.39 | 5.26 | PASS |
| 3BHK | v1 | 14.84 | 4.46 | PASS |
| 3BHK | v2 | 270.20 | 4.93 | PASS |
| 24-rooms | v1 | 97.83 | 22.03 | PASS |
| 24-rooms | v2 | 2090.48 | 20.74 | PASS |
| two-floor | v1 | 17.61 | 5.73 | PASS |
| two-floor | v2 | 182.86 | 6.24 | PASS |
| L-site | v2 | 236.78 | 4.05 | PASS |
| U-site | v2 | 180.11 | 4.77 | PASS |
| relationship-chain | v1 | 8.71 | 3.14 | PASS |
| relationship-chain | v2 | 75.33 | 2.82 | PASS |
| dense-infeasible-graph | v1 | 1.39 | 0.00 | UNSATISFIED_HARD_CONSTRAINT |
| dense-infeasible-graph | v2 | 0.93 | 0.00 | SEARCH_LIMIT_EXHAUSTED |
| infeasible-area | v1 | 0.34 | 0.00 | SEARCH_LIMIT_EXHAUSTED |
| infeasible-area | v2 | 0.17 | 0.00 | PROGRAM_DOES_NOT_FIT |
| candidate-limit | v1 | 21.26 | 2.78 | PASS |
| candidate-limit | v2 | 648.60 | 3.77 | PASS |

V2 is substantially slower than V1 in these samples; the 24-room median is approximately 2.09 seconds. No speculative optimization was made. Maximum observed candidate attempts were 96 and charged operations 5,630 in this corpus; configured-bound assertions are separate tests. Solver process peak RSS was 210,708 KiB, a cumulative high-water mark rather than per-case allocation. [Full solver measurements](stabilization-evidence/solver-performance.json) contain candidates, operation counts, hashes and failure diagnostics.

Conversation benchmark: create 7.21 ms (one sample); message median 5.00 ms / p95 8.06 ms (30 samples); retrieval median 1.56 ms; native merge median 0.069 ms; proposal diff/hash median 0.098 ms; approval/generation/QA/commit 133.41 ms (one V1 sample); active-lease conflict 2.11 ms and expired-lease recovery 5.05 ms (one sample each). Expiry was advanced only in the disposable fixture; the 60-second wait was not included. Ten concurrent identical messages produced only successes/replays and 409 conflicts, with no duplicate accepted transition. Retained display history was 20 messages and state size 5,889 bytes. Thirty maximum-length multibyte disabled-state runs stayed within the trimming budget. Peak process RSS was 243,488 KiB. These are bounded local observations, not a memory-leak proof or production load certification. [Conversation measurements](stabilization-evidence/conversation-performance.json).

## 10. Data preservation

All pre-existing public-table row digests are preserved, including 587 projects, 642 revisions/QA rows and 360 workflows. All twelve migration files retain their incoming hashes; 0001–0011 also match Phase 18. Database migration history, RLS flags and policies are unchanged. Existing Supabase acceptance retention left 33 additional fixture projects and 37 revisions, separately identified with their downstream artifacts in [the preservation report](data-preservation-report.md). No production reset, historical geometry edit or revision deletion occurred.

## 11. Frontend preservation

The experimental frontend remains outside this task. No experimental workspace was touched and no frontend source/scripts were added to `designflow`. Its build, GSAP/Three.js behavior and API compatibility are not certified here. The backend introduces a defaulted additive `pendingBedroomMove` response/state field; consumers with strict copied schemas should account for it. Existing stored state without that field remains readable.

## 12. Changed files

Production repairs are confined to `apps/api/src/ai/conversation-planner.ts` and `apps/api/src/contracts/conversations.ts`. Tests changed in `apps/api/tests/conversations.test.ts`, `apps/api/tests/conversations.integration.test.ts`, and `test-support/conversation-acceptance.ts`. Benchmarks changed in `scripts/benchmark-solver-v2.ts` (U-site coverage) and `scripts/benchmark-conversations.ts` (lease recovery and multibyte bounds). Three historical phase documents have clarification notices. All other changes are final reports, inventories and evidence.

[Exact current changed-file inventory](stabilization-evidence/changed-files.json) includes all new evidence paths. [Historical inventory](stabilization-evidence/historical-file-inventory.json) distinguishes 387 unchanged Phase 18 paths and all 273 paths changed by the combined implementation commit, labeling Phase 19, Phase 20, shared integration, historical evidence and the frontend placeholder deletion. Shared-file categories are not fabricated separate commits.

## 13. Known limitations

The [limitation register](phase19-20-known-limitations.md) is part of this sign-off. Key boundaries: single rectangular building envelope inside bounded orthogonal sites; finite search and language grammar; heuristic environmental/privacy scoring; conceptual parking with incomplete cost; cooperative rather than worker-enforced hard cancellation; latest-proposal-only storage; finite history/quotas; no globally exactly-once inference; no production-scale load or real-model language evaluation; no engineering certification. These are documented product boundaries, not hidden passing-test exclusions.

## 14. Release readiness

| Phase | Classification | Scope |
| --- | --- | --- |
| 19 | **FULLY IMPLEMENTED AND VERIFIED** | Documented bounded solver, QA, identity and downstream backend scope. |
| 20 | **FULLY IMPLEMENTED AND VERIFIED** | Documented conversation, native preservation, proposal/approval, local adapter and durable backend scope with the three repairs. |

Code is ready for human review and a release checkpoint. Deployment, broad model quality and production-scale capacity are separate decisions.

## 15. Required human actions and release history

Both implementations entered Git in the same commit `f17a337`; the existing Phase 19 tag references it. There is no reachable intermediate Phase 19-only checkpoint. Commit metadata and reflog show one combined snapshot, not the author's intention. Safest correction is append-only: retain existing refs, commit this stabilization delta, and explicitly label a new verified combined snapshot. Do not reset, amend, force-move a tag or invent a separated history. Review the three fixes, manifests and retained local fixture inventory; copy the verified recovery files identified below to off-machine storage if needed.

```bash
cd /home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow
git status --short
git diff --check
git diff --stat
# Review the files and evidence first; execute only after approving this snapshot.
git add -- apps/api/src/ai/conversation-planner.ts apps/api/src/contracts/conversations.ts apps/api/tests/conversations.integration.test.ts apps/api/tests/conversations.test.ts test-support/conversation-acceptance.ts scripts/benchmark-conversations.ts scripts/benchmark-solver-v2.ts docs/phase19-design.md docs/phase19-review-report.md docs/phase20-design.md docs/phase19-final-review.md docs/phase19-final-verification.json docs/phase20-review-report.md docs/phase20-verification.json docs/stabilization-report.md docs/repository-reconciliation.md docs/security-audit.md docs/data-preservation-report.md docs/phase19-20-known-limitations.md docs/stabilization-evidence
git diff --cached --check
git diff --cached --stat
git commit -m "Stabilize and verify backend Phases 19 and 20"
# Confirm these new tag names are unused before executing the tag commands.
git tag -a backend-v1-phase19-verified-20261003 -m "Phase 19 verified in the combined Phase 19/20 backend; original completion tag retained"
git tag -a backend-v1-phase20-complete -m "Phase 20 stabilized and verified with Phase 19; see stabilization report"
```

These are proposed commands only. They deliberately create no replacement for the existing `backend-v1-phase19-complete` reference. Both new tags would describe the same reviewed combined snapshot. No push or deployment is proposed as an automatic step.

## 16. Phase 21 readiness

This verified bounded backend is suitable as a Phase 21 development baseline after review and recording the approved checkpoint. Carry forward the limitation register and the explicit separation from the experimental frontend. No Phase 21 implementation, deployment, commit, staging or tag operation was performed in this task.


Final recovery check: the original `/tmp` files were no longer present at handoff. The clean incoming source was reconstructed from unchanged Git HEAD and all 659 file hashes reverified. Replacement source archive and verified history bundle are in `/home/aryan/.codex/visualizations/2026/10/03/01a1014c-bebc-73f1-b0ce-d7bc8e1f1807/recovery`; [incoming.json](stabilization-evidence/incoming.json) records their SHA-256 hashes. These local copies are not off-machine backups.
