# Phase 24 report — structural engineering integration

**Release classification: PHASE 24 FULLY IMPLEMENTED AND VERIFIED WITHIN BOUNDED SCOPE** (linear-static 3D frame analysis; see §34 for what is out of scope).

## 1–2. Starting point

- Starting SHA: `208d56c264f4425022831c8d78d27fd9e4e023b6` (`codex/phases-1-23-audit-repair`, repair head; seven repair commits on top of `main` = `ddf08f8`). Work branch: `phase24/structural-engineering`.
- Starting tags: `backend-v1-phase5-complete` … `backend-v1-phase23-complete` (→ `da5f3ca`), `backend-v1-phase19-verified-20261003`. No tag was moved.
- Repair gate: D01–D21 and R01–R06 all carried verdicts; the repair's final runner had passed every gate with source unchanged, and all 339 source files matched its tested manifest, so it is the Phase 24 baseline. The untracked `docs/backend-repair-1-23/` is left untouched and uncommitted.

## 3. Source audit

`phase24-source-audit.md`. Key findings: BIM is a read-time projection with a bounded profile that rejects columns; slab footprints sit on wall outer faces; generated wall heights (2850 mm) stop below storey tops (3000 mm); setback walls do not stack. No structural or linear-algebra code existed.

## 4–5. Architecture and schema

Layers (`phase24-design.md`): accepted revision → Phase 23 BIM (unchanged) → explicit input `structural-input-v1` → semantic model `structural-model-v1` (`structural/model.ts`) → independent validation (`structural/validate.ts`) → solver-neutral `structural-analysis-model-v1` (`structural/analysis.ts`) → adapter `structural-adapter-v1` (`structural/frame-solver.ts`) → untrusted-output validation → results + combinations → independent result validation → immutable snapshot `structural-analysis-v1` (migration 0014). All versions are schema literals and part of the input hash.

## 6. Identities

`str-` + 40 hex of `sha256([projectId, 'structural-model-v1', role, …source])`; nodes by integer coordinates; members by kind, rule, wall, wall end, storey; segments by member and end nodes; inputs (materials, sections, cases, combinations, loads) by request key. Display names never participate. BIM IDs are referenced (`bimElementId`), not replaced.

## 7. Architecture/BIM mapping

Explicit rules only: `COLUMN_AT_WALL_END/1` (vertical at a wall end, storey elevation → storey top) and `BEAM_ALONG_WALL/1` (wall centerline at storey top). Each member records source wall, BIM element ID, rule/version, `EXPLICIT_USER_MAPPING` provenance, `ASSUMED` status and its idealisation assumptions. Tests prove architecture, BIM, IFC and hashes are unmodified.

## 8. Materials

`CONCRETE|STRUCTURAL_STEEL|MASONRY|TIMBER|UNKNOWN`; only E, ν, density; each `USER_PROVIDED` or `NOT_SPECIFIED`. No library or defaults. Missing E/ν → `STRUCTURAL_MATERIAL_MISSING`; missing density with self-weight → same; otherwise mass `NOT_EVALUATED`. An optional link to an architectural specification is traceability only.

## 9. Units

`structural/units.ts`: every unit has a dimension and an exact power-of-ten SI factor; cross-dimension conversion fails at compile time (verified with `@ts-expect-error`) and at run time. Internal N/mm/MPa; output mm, rad, kN, kN·m. Mass→force only through explicit standard gravity (9.80665 m/s², −Y).

## 10–12. Loads, combinations, supports

Load cases `DEAD|LIVE|USER_DEFINED` with optional generated self-weight; loads `POINT` (kN at a member-end node) and `MEMBER_DISTRIBUTED` (kN/m over the full member); `AREA` recognised and rejected as unsupported. Combinations `PROJECT_DEFINED`, `codeCompliance: NOT_CLAIMED`, factors `USER_PROVIDED` (non-zero, |f| ≤ 10), computed by linear superposition and verified against a direct factored solve. Supports `FIXED|PINNED|ROLLER|CUSTOM` with explicit DOF sets; automatic base supports are `ASSUMED` with their rule.

## 13. Topology

Builder and validator (separately): reference integrity, zero length, duplicate and overlapping collinear members, duplicate supports, interior-node splitting (e.g. setback columns landing inside a lower beam), connected components each needing a support (`STRUCTURAL_SYSTEM_DISCONNECTED`), dangling ends reported as warnings. Room adjacency is never used.

## 14–16. Solver adapter, implementation, provenance

Adapter contract: metadata, capabilities, `validateInput`, `analyze`. Reference solver `nekoarch-reference-frame-3d` 1.0.0 — open, local, dependency-free: 12-DOF Euler-Bernoulli elements, consistent fixed-end forces, RCM ordering, skyline LDLᵀ shared across cases, relative pivot 1e-9 (mechanisms → `STRUCTURAL_SYSTEM_UNSTABLE`), residual 1e-8 (`STRUCTURAL_SOLVER_FAILED`), per-column deadline (`STRUCTURAL_ANALYSIS_TIMEOUT`), memory budget checked before allocation. Every snapshot records solver name, version, adapter version, settings, input hash, analysis-model hash, execution time and warnings.

## 17. Analytical validation (independent closed forms, relative tolerance 1e-9)

Simply supported beam (5wL⁴/384EI, wL/2, wL²/8, wL³/24EI, quarter-point moment); cantilever in both bending planes (PL³/3EI, PL); fixed column (PL/EA, N = −P, biaxial drift on documented axes); two-span continuous beam (3wL/8, 10wL/8, −wL²/8); pinned-base portal (H/2, hH/W, joint moment); combination = direct factored solve; authored frame hand-total of line loads plus self-weight, and symmetry. Mutation testing (8 planted defects) confirms the tests are not vacuous. Tolerances: analytical 1e-9 relative; equilibrium 1e-6 × load scale; determinism exact within one runtime.

## 18. Result model

Per load case and combination: node displacements, support reactions, member internal forces at 5 stations per segment on the positive cut face in local axes. Header units; solver provenance in the snapshot; `claims` fixed to not-evaluated/not-claimed; a `limitations` list is included.

## 19. Stale results

Analyses are bound to one revision and never reused. Reads report `CURRENT` only for the project's current revision; `/status` lists other revisions' analyses as `STALE` with `requiresNewAnalysis`; `?require=current` → `409 STRUCTURAL_RESULT_STALE`. Proven with a real Phase 22 west-wing edit on embedded PostgreSQL and live Supabase: analysis A stays readable and attached to revision A, is stale for B, is 404 under B, and B requires and receives its own analysis.

## 20. Database

`0014_structural_analyses.sql` (additive): `project_revision_structural_analyses` — one row holds metadata and the full snapshot; revision and accepted-QA FKs; version/hash/solver columns with JSON consistency CHECKs (including claims); `unique(project_revision_id, input_hash)`; immutable trigger; owner-only RLS select; no client writes. `structural_write` verifies the HMAC envelope, ownership and accepted QA, and **recomputes** modelHash, parameterHash, generator version and generation identity from the stored revision; an advisory lock plus uniqueness converge concurrent identical requests; the idempotency receipt is in the same transaction. `structural_read` serves `get`/`list`/`status`. Fresh-DB and upgrade-from-0013 tests pass; the local Supabase upgrade preserved every pre-existing row.

## 21–22. API and security

`phase24-api.md`. Five routes; all authenticate, are owner/revision scoped (404 otherwise), use the redacted error envelope, and are in the Sentry route allowlist. POSTs consume the generation quota, GETs the read quota; GET never analyses. Bodies are size-, depth- and finiteness-checked before parsing. Logs carry request ID, analysis ID, solver, status, durations and counts only. No AI provider, conversation or workflow can reach structural analysis.

## 23. Concurrency

Real PostgreSQL: 8 concurrent identical signed RPC writes → one row; 4 concurrent HTTP posts with two distinct inputs → two rows; a failed receipt insert rolls back the analysis.

## 24. Limits

Input 512 KiB; materials 32; sections 64; members 800; supports 800; cases 8; loads 1000 per case, 2000 total; combinations 16 × 8 terms; segments 4000; skyline 4 M entries; solver 10 s; output 9 MB; magnitude bounds per design §17. Derived from the BIM profile (≤ 200 walls).

## 25. Performance (`evidence/benchmark.json`, single samples, not SLOs)

maximum-24 fixture: 108 nodes, 132 members, 4 result sets — projection 10.7 ms, model validation 21.3 ms, solve 5.2 ms, result build 10.3 ms, result validation 8.4 ms, 0.93 MB. Synthetic 500-node / 1120-segment grid, 8 cases: solve 367 ms. Peak RSS 245 MB.

## 26. Docker

`designflow-api:phase24`: builds; non-root; liveness 200; readiness 503 without dependency; SIGTERM exit 0; compiled structural and BIM modules present; no dev verifier dependencies; compiled Phase 23 and Phase 24 acceptance pass offline.

## 27–28. Phase 1–23 regression and Phase 23 preservation

Every existing suite passed (`phase24-verification.md`): unit 1949, generator 526, blueprint 137, blueprint QA 198, solver V2 40, parametric 36, projects 23, takeoff 23, construction 34, cost 39, workflows 51, interpretation 133, conversations 52, AI orchestration 120, integration 202, BIM 41, live Supabase 92, pgTAP, `check` 2193 + 133 + 52. BIM projection, validation, elements, relationships, pagination, diff, JSON and IFC export verified; IfcOpenShell round trip of all 7 fixture families: IFC4, 0 schema diagnostics. Historical migrations 0001–0013 and `docs/phase23-evidence` are byte-identical to the start.

## 29–30. Commands and counts

Exact commands, exit codes and timings: `evidence/final/verification.json` (38 rows, all 0, source manifest `7fd80841…`). New structural tests: 74 unit + 10 PostgreSQL integration (+3 live Supabase acceptance); pgTAP +7 assertions.

## 31–32. Failures encountered and repairs

| Failure / finding | Repair | Regression |
|---|---|---|
| Shared fixture object mutated by schema tests (22 cascading failures) | fixture returns a clone | suite |
| Inventory tests pinned 16 tables / 26 FKs | deliberately updated to 17 / 28; pgTAP plan 51→58 | `database.test.ts`, `rls.sql` |
| Live-suite cleanup tried to delete projects holding immutable structural history | cleanup protects them like takeoff/workflow history | `test:supabase` |
| Review: per-segment checks could not detect a constant force offset | joint equilibrium added to the result validator | 2 tests, shown failing without the fix |
| Review: topology reports and assumption lists unverified | validator recomputes them | 4 tests, shown failing without the fix |
| Review: parameterHash not recomputed in SQL | added to the `structural_write` binding | forged parameter hash → P2403 |
| Review: BIM-unsupported revisions surfaced as a BIM code | mapped to `STRUCTURAL_SOURCE_UNSUPPORTED` | column-bearing revision test |
| Review: coarse solver deadline checks | checked every column | timeout test |
| SQL subquery passed a widened row to `structural_summary` | summary built inside the subquery | status tests |

## 33. Files changed

New: `apps/api/src/structural/{units,contracts,model,validate,analysis,frame-solver}.ts`, `apps/api/src/services/structural-service.ts`, `apps/api/src/routes/structural.ts`, `apps/api/src/lib/structural-repository.ts`, `supabase/migrations/0014_structural_analyses.sql`, `apps/api/tests/structural{,.integration}.test.ts`, `test-support/structural-{fixtures,acceptance}.ts`, `scripts/benchmark-structural.ts`, `docs/phase24/*`.
Modified (minimal): `app.ts` (route registration), `http-protection.ts` (generation quota), `sentry.ts` (route allowlist), `repository.ts` / `supabase.ts` / `test-support/pg-backend.ts` (RPC wiring), `bim-service.ts` (`readBim` also returns the revision it read; BIM responses unchanged), `test-support/postgres.ts` (optional migration filter), `supabase.live.test.ts` (acceptance and cleanup), `database.test.ts` / `rls.sql` (inventory), `package.json` (`test:structural`, `benchmark:structural`, aggregate lists).

## 34. Known limitations

- Frame-only linear static analysis: no slabs/wall panels, area loads, diaphragms, releases, springs, P-Δ, dynamics, wind/seismic, or design/capacity checks (`DESIGN_VERIFICATION = NOT_EVALUATED`).
- Members derive only from orthogonal centerline walls in the Phase 23 BIM profile; native columns remain unsupported (D10).
- The rectangle torsion constant uses the Roark approximation (≈0.2 % for a square), labelled as such.
- Internal forces are reported at quarter points only.
- Results are never reused across revisions, even with identical geometry (conservative).
- Solving runs synchronously on the request thread within the 10 s budget; a worker pool is the upgrade path.
- Snapshots travel twice in the signed RPC (envelope + input); results near the 9 MB budget have not been exercised against hosted Supabase request limits.
- The IFC verifier environment lives in `/tmp` and must be recreated after a reboot (done for this run).

## 35. Recommendation

Release Phase 24 as a bounded, preliminary structural analysis capability. The commit and annotated tag `backend-v1-phase24-complete` are local only; nothing has been pushed or deployed. Remote environments need migration 0014 applied through their normal reviewed procedure before this API is deployed.
