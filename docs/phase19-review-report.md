**Phase 19 — Precision Solver V2 completion report**

Status: **COMPLETE — ready for manual review**. The outstanding implementation-verification work is finished. Completion means the bounded Phase 19 backend scope and local release checks; it does not mean a deployment, Git commit, tag, or certification of architectural/engineering compliance.

**What was pending, and what this pass completed.** The incoming work already contained the V2 solver, version selection, independent QA additions, API/workflow integration and regression fixtures. Earlier logs still showed frontend lint errors, a failed unit import-boundary check, a cost-test timeout, an incomplete Docker build, and a failed container smoke test. There was no final Phase 19 review report or root verification manifest.

This completion pass made these changes:

1. Resolved all 63 current repository lint errors in ten existing frontend files. Removed unused imports/locals; replaced explicit `any` types with project/revision/workflow types, a shared interpretation-options interface, typed clarification state, an API error class and narrowed caught errors. Existing demo behavior and visual layout remain outside the Phase 19 implementation work; this does not certify the frontend as a production V2 client.
2. Corrected Docker workspace inputs by copying `apps/web/package.json`, which the existing root workspace/lockfile references, while continuing to exclude frontend source. The backend build uses `tsc`; optional test-database/CLI/platform binaries and their development installers are now omitted. The final image builds and runs compiled V2 generation, independent QA and takeoff successfully.
3. Added a separate `PHASE19_SUPABASE_EVIDENCE_DIR` destination for real local Supabase acceptance outputs, and a configurable `PHASE19_PERFORMANCE_PATH` with timestamp and directory creation for benchmarks. Historical evidence is retained.
4. Reran the failed aggregate and dedicated gates, captured fresh PostgreSQL and Supabase acceptance artifacts, verified database preservation, and produced this report, the example and the machine-readable manifest. The earlier import-boundary repair was already in the incoming tree and now passes; the cost timeout did not recur. No timeout was raised and no test was disabled to obtain a pass.

**Baseline and preservation.** Work continued on `main` at `094e6856a61abfeee78881dbc98fe34ef10eb970`, the existing Phase 18 checkpoint, with an already dirty tree containing Phase 19 and frontend work. [Incoming inventory](phase19-evidence/completion/baseline.json) records hashes and the local recovery snapshot `/tmp/designflow-phase19-completion-incoming.tar.gz`. No reset, stash, checkout, commit, tag, push or database reset was performed. The changes remain reviewable and uncommitted.

The dependency lockfile, V1 frozen fixtures, solver implementation and all eleven historical migrations were preserved during this completion pass. The complete Phase 19 diff still includes the earlier additive solver/QA/model/API changes and the pre-existing frontend workspace additions. [Preservation evidence](phase19-evidence/completion/preservation.json) distinguishes changes made in this pass from the incoming work.

**Delivered behavior.** Structured project generation and workflow requirements select `precision-blueprint-v2` only when `layoutV2: {}` is present. Unmarked requests and default library entry points retain V1 normalization, geometry, metadata, provenance and hashes. V2 requirements include normalized architectural/search/scoring inputs in identity; the execution seed remains separate from the requirements hash. Signed revision commits, immutable history, compare-and-swap freshness, ownership and durable replay remain authoritative.

| Area | Implemented behavior |
| --- | --- |
| Site geometry | Exact integer-mm simple orthogonal polygons, including L/U sites; true containment; up to 16 inscribed rectangular building envelopes |
| Room layout | One/two floors, at most 24 rooms; hard relationship components assigned together; zone/relationship-informed orders, seeded alternatives, unequal banks and exact integer partitions |
| Connections | Independent evidence for adjacency, direct doors and modeled passages; corridor access does not substitute for a required direct relationship |
| Circulation/stairs | Actual entrance reachability, optional prohibition on private transit, straight stairs with exact rise/run, both landings, upper access and slab void |
| Site access/parking | Explicit access side and primary entrance; up to two conceptual direct-frontage bays checked for containment, dimensions, overlap and approach |
| Objectives | Deterministic integer scores for circulation, privacy, wet-service clustering, exterior daylight/ventilation potential, room shape and utilization; cardinal and separation preferences |
| QA | Independent reconstruction of clear wall-face dimensions, floor/minimum constraints, direct relationships, separation, private transit and site allocations; solver scores never authorize persistence |
| Downstream chain | V2 generation → independent QA → revision → quantity takeoff → construction → cost; parking construction is explicitly `NOT_EVALUATED`, so a complete cost total is unavailable |
| Resource limits | Default/max 32/128 candidates; at most 20,000 charged operations; bounded geometry, cooperative cancellation and execution deadlines; no partial geometry after timeout |

The backend natural-language interpreter remains V1. It rejects modification of a V2 base with `V2_INTERPRETATION_UNSUPPORTED`, preserving solver-specific intent rather than silently dropping it. Structured V2 modification uses the existing generation endpoint. The full objective formulas and selection rules are in [the design](phase19-design.md).

**Acceptance evidence.** The same ten HTTP acceptance cases passed against both disposable PostgreSQL and local Supabase. Tests invoke real API handlers and real database transactions; local Supabase additionally covers Auth/JWT/PostgREST/RLS. They are local integration evidence, not a production deployment or external HTTP load test. Each successful revision verifies identity, persistence, rereads and idempotent replay.

| Case | Verified result |
| --- | --- |
| A | Default V1 HTTP output matches the historical generator and identity behavior |
| B, L and U | Orthogonal sites persist as V2 revisions with valid geometry and independent QA |
| C | Hard direct-door and passage relationships are satisfied and independently checked |
| D | Two-storey stairs, landings, void and entrance reachability persist correctly |
| E | Privacy weighting improves the measured fixture score from -983 to -1320 on the same scheduled family; lower is better |
| F | Stored geometry matches the generated facade/window evidence; simulation limitations remain explicit |
| G | Impossible area returns HTTP 422 `PROGRAM_DOES_NOT_FIT`, leaving no current revision |
| H | Complete-building workflow finishes with correct V2 step provenance and honest partial parking cost coverage |
| Security | Missing auth/foreign ownership, forged QA, changed idempotency payloads, stale bases and V2 interpreter modification are rejected |

Fresh artifacts: [PostgreSQL acceptance](phase19-evidence/completion/acceptance-postgres/) and [local Supabase acceptance](phase19-evidence/completion/acceptance-supabase/). [The representative example](phase19-example.json) is an actual L-site revision `41368ccf-175b-46cb-be8e-2bee1241e534` with QA `PASS`; its IDs belong to a disposable test database. The unit suite also checks altered relationship/parking/stair evidence, all four access sides, invalid rings, frozen V1 fixtures, input immutability, budgets, cancellation/deadline errors and repeatability across concurrent workers.

**Final verification.** Commands, timestamps, durations, environment destinations and outcomes are recorded in [phase19-verification.json](phase19-verification.json). Counts overlap and must not be added as unique tests. The aggregate `check` runs build, typecheck, lint, the full 1,788-test suite and a separate 133-test interpreter suite. Dedicated Phase 19 tests contribute 40 tests; local Supabase contributes 74; SQL/RLS contributes 48.

| Command / gate | Result | Duration / full log |
| --- | --- | --- |
| `npm run check` | PASS; Test Files  43 passed (43); Tests  1788 passed (1788); Test Files  2 passed (2); Tests  133 passed (133) | [153.865 s](phase19-evidence/completion/check.txt) |
| `npm run test:unit` | PASS; Test Files  30 passed (30); Tests  1625 passed (1625) | [41.097 s](phase19-evidence/completion/unit-final.txt) |
| `npm run test:solver-v2` | PASS; Test Files  2 passed (2); Tests  40 passed (40) | [28.319 s](phase19-evidence/completion/solver-v2.txt) |
| `npm run test:supabase` | PASS; Test Files  1 passed (1); Tests  74 passed (74) | [80.317 s](phase19-evidence/completion/supabase.txt) |
| `npm run db:test` | PASS; Files=1, Tests=48,  0 wallclock secs ( 0.02 usr +  0.01 sys =  0.03 CPU); Result: PASS | [3.271 s](phase19-evidence/completion/db-test.txt) |
| `npm run typecheck` | PASS; exit 0 | [23.26 s](phase19-evidence/completion/typecheck-final.txt) |
| `npm run lint` | PASS; exit 0 | [3.571 s](phase19-evidence/completion/lint-final.txt) |
| `npm run web:build` | PASS; exit 0 | [6.326 s](phase19-evidence/completion/web-build.txt) |
| `docker build -t designflow-api:phase19 .` | PASS; exit 0 | [368.349 s](phase19-evidence/completion/docker-final.txt) |
| `node scripts/smoke-container.mjs designflow-api:phase19` | PASS; exit 0 | [1.267 s](phase19-evidence/completion/smoke.txt) |
| `Compiled V2 generation + QA + takeoff in network-disabled production image` | PASS; exit 0 | [0.715 s](phase19-evidence/completion/container-solver.txt) |
| `node --import tsx scripts/benchmark-solver-v2.ts` | PASS; exit 0 | [12.991 s](phase19-evidence/completion/benchmark-final.txt) |
| `git diff --check` | PASS; exit 0 | [0.016 s](phase19-evidence/completion/diff-check.txt) |

Earlier failed attempts remain available as diagnostic history. The initial sandbox run could not open the disposable PostgreSQL socket; it was rerun successfully with local-socket permission. The first Docker retry was stopped after optional binary downloads stalled; the corrected image passed build, health/shutdown smoke and a network-disabled compiled-solver check. `tsx` CLI IPC was sandbox-blocked, so the same benchmark runs through `node --import tsx`. One permission-review request timed out before execution and succeeded when retried as separate checks. None of those attempts is counted as a passing gate.

The frontend build passes with an existing bundle-size warning (approximately 805 kB minified JavaScript, 211 kB gzip). Lint rules, test timeouts and test inclusion were not weakened. No new runtime dependency was added for Phase 19.

**Measured performance and determinism.** [Fresh benchmark data](phase19-evidence/completion/performance.json) contains 19 engine/case groups with three repeats each: 57 executions, all deterministic by output hash or typed-failure diagnostics. Every successful benchmark model passed independent QA. Values below are median solver milliseconds on this local Node 22 environment; they exclude the separately recorded QA duration.

| Workload | V1 median ms | V2 median ms |
| --- | --- | --- |
| 1BHK | 26.86 | 198.45 |
| 2BHK | 12.77 | 240.69 |
| 3BHK | 15.10 | 266.38 |
| two-floor | 18.47 | 165.48 |
| L-site | Unsupported | 220.59 |
| relationship-chain | 11.94 | 79.05 |
| 24-rooms | 112.04 | 2052.73 |
| candidate-limit | 22.98 | 664.19 |

V2 is slower than V1 because it evaluates more geometry and objective evidence; this work does not establish a performance improvement. The dense contradictory relationship case returns bounded `SEARCH_LIMIT_EXHAUSTED`; the impossible-area V2 case returns `PROGRAM_DOES_NOT_FIT`. Timings are observations, not latency guarantees. Memory numbers are cumulative process peak RSS, not isolated per-case allocations. V1 iteration and V2 operation counts use different accounting and are not directly comparable.

**Database and security preservation.** Local Supabase regression fixtures increased projects from 488 to 520 and revisions from 531 to 567. All 531 pre-existing model digests remain present and unchanged. Plans and Auth-user counts stayed at zero; the live suite removes its Auth fixtures while deliberately retaining immutable project history. [Before/after evidence](phase19-evidence/completion/database-preservation.json) records these changes. There were no migrations, data resets or production-service writes. The production smoke test used synthetic configuration and disabled container networking.

**Supported-scope limits.** These are explicit product boundaries, not unfinished required gates:

- Buildings use a single inscribed rectangular envelope inside a possibly nonrectangular site. Multi-wing footprints, holes, curves, diagonal/rotated buildings and automatic irregular-polygon offsets are unsupported. Nonrectangular sites needing setbacks require an authoritative inset buildable polygon without edge-offset declarations.
- At most two floors and straight stairs are supported. The solver does not certify structure, headroom, fire safety, accessibility or local code compliance.
- Parking is conceptual direct-frontage allocation, without turning/pavement/gradient design. Its material/construction/cost scope remains unevaluated.
- Daylight and ventilation scores measure exterior opportunity, not daylight factor, lux, airflow, ACH or climate performance. Privacy is a geometric heuristic, not sightline/acoustic simulation. Cardinal preferences require quarter-turn north metadata.
- Search covers a bounded scheduled family and does not prove global optimality or general infeasibility. A valid best-so-far result can have `searchComplete:false`.
- Cancellation/deadlines are cooperative and synchronous; they are not worker-isolated, hard preemptive HTTP cancellation. Geometry/schema work can overrun a deadline until the next checkpoint.
- Diagnostics are returned by the solver and stored in evidence files; the historical revision DTO does not persist a complete solver diagnostic report. The natural-language and existing frontend demo flows were not upgraded into a V2 authoring UI.

There is no remaining required implementation or verification work within this documented Phase 19 scope. Manual review and any subsequent commit, release tag or deployment remain separate actions.
