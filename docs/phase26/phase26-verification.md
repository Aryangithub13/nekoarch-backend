# Phase 26 verification record

Final release run: **run 3**, executed under
`systemd-inhibit --what=sleep:idle:handle-lid-switch` by `docs/phase26/verify-phase26.py`.
Machine-readable record: `docs/phase26/evidence/final/verification.json`; per-gate logs in
`docs/phase26/evidence/final/`.

## Frozen source

- Tested-source SHA-256 manifest digest: `7f93ddf3d8f6abf9a4b08c5d80567ac34195ffb39f2e1d5b640ec86af7c4a156`
  (per-file hashes: `evidence/final/tested-source-sha256.json`).
- The manifest and the protected historical set (migrations 0001–0015, `docs/phase23-evidence`,
  `docs/phase24`, `docs/phase24-audit-repair`, `docs/phase25`, `docs/backend-repair-1-23`) were
  re-hashed before and after every gate. All 52 gates report `sourceUnchanged: true` and
  `untouchedDirectoriesUnchanged: true`; a single manifest digest was observed for the whole run.
- Total gate wall time: 1348 s.

## Result: 52 / 52 gates exit 0, no waived failure, no skip

| # | Gate | Exit | s | Measured evidence |
|---|------|------|---|-------------------|
| 1 | Phase 24 tag resolves | 0 | 0.03 | `phase24-tag.txt` |
| 2 | Phase 25 tag resolves | 0 | 0.03 | `phase25-tag.txt` |
| 3 | ec77974 is ancestor of HEAD | 0 | 0.03 | `phase25-baseline-ancestor.txt` |
| 4 | Phase 24 audit reproductions | 0 | 0.39 | `phase24-audit-reproductions.txt` |
| 5 | Runner controls | 0 | 0.13 | `runner-controls.txt` |
| 6 | `npm run build` | 0 | 16.5 | `build.txt` |
| 7 | `npm run typecheck` | 0 | 22.6 | `typecheck.txt` |
| 8 | `npm run lint` | 0 | 4.4 | `lint.txt` |
| 9 | `test:unit` | 0 | 56.3 | 2128 passed |
| 10 | `test:generator` | 0 | 16.4 | 526 passed |
| 11 | `test:blueprint` | 0 | 7.3 | 137 passed |
| 12 | `test:blueprint-qa` | 0 | 13.6 | 198 passed |
| 13 | `test:solver-v2` | 0 | 27.4 | 40 passed |
| 14 | `test:parametric` | 0 | 20.5 | 36 passed |
| 15 | `test:projects` | 0 | 20.7 | 23 passed |
| 16 | `test:takeoff` | 0 | 23.6 | 23 passed |
| 17 | `test:construction` | 0 | 20.9 | 34 passed |
| 18 | `test:cost` | 0 | 23.2 | 39 passed |
| 19 | `test:workflows` | 0 | 22.8 | 51 passed |
| 20 | `test:interpretation` | 0 | 20.0 | 133 passed |
| 21 | `test:conversations` | 0 | 21.4 | 52 passed |
| 22 | `test:ai-orchestration` | 0 | 21.4 | 120 passed |
| 23 | `test:integration` (embedded PostgreSQL) | 0 | 96.4 | 227 passed |
| 24 | `test:bim` (BIM preservation) | 0 | 28.2 | 41 passed |
| 25 | `test:structural` (structural preservation) | 0 | 28.1 | 129 passed |
| 26 | `test:environmental` (environmental preservation) | 0 | 31.9 | 112 passed |
| 27 | `test:systems` (Phase 26 unit + integration) | 0 | 34.3 | 47 passed |
| 28 | `test:supabase` (live local Supabase) | 0 | 94.6 | 99 passed, cleanup clean |
| 29 | `db:test` (pgTAP / RLS) | 0 | 3.1 | `db-test.txt` |
| 30 | `npm run check` | 0 | 227.8 | 2397 + 133 + 52 passed |
| 31 | `benchmark:systems` | 0 | 17.8 | table below |
| 32 | Phase 26 mutation testing | 0 | 354.2 | 19 / 19 killed, all restored |
| 33 | Phase 23 BIM fixtures | 0 | 2.0 | `phase23-bim-fixtures.txt` |
| 34 | IFC round-trip (IfcOpenShell 0.8.5) | 0 | 59.6 | `ifc-roundtrip.txt` |
| 35 | IFC profiles | 0 | 0.7 | `ifc-profiles.txt` |
| 36 | Phase 23 architecture identical | 0 | 0.14 | `phase23-architecture-identical.txt` |
| 37 | Historical migrations/artifacts unchanged vs ec77974 + only 0016 untracked | 0 | 0.03 | `historical-artifacts-unchanged.txt` |
| 38 | AI boundary | 0 | 0.03 | `ai-boundary.txt` |
| 39 | Environmental offline / no I/O | 0 | 0.02 | `environmental-offline-no-io.txt` |
| 40 | Systems offline / no I/O / no clock | 0 | 0.03 | `systems-offline-no-io-no-clock.txt` |
| 41 | Environmental validator independence | 0 | 0.02 | `validator-independence.txt` |
| 42 | Systems validator independence | 0 | 0.02 | `systems-validator-independence.txt` |
| 43 | `docker build` | 0 | 1.5 | `docker-build.txt` |
| 44 | Docker smoke | 0 | 1.4 | non-root, liveness 200, failed-dependency readiness 503, SIGTERM exit 0 |
| 45 | Docker runtime contents | 0 | 0.29 | `docker-runtime-contents.txt` |
| 46 | Compiled Phase 23 acceptance, `--network none` | 0 | 0.94 | `docker-phase23-acceptance.txt` |
| 47 | Compiled Phase 24 acceptance, `--network none` | 0 | 0.64 | `docker-phase24-acceptance.txt` |
| 48 | Compiled Phase 25 acceptance, `--network none` | 0 | 0.64 | `docker-phase25-acceptance.txt` |
| 49 | Compiled Phase 26 acceptance, `--network none` | 0 | 0.79 | output below |
| 50 | Local DB snapshot after verification | 0 | 3.1 | `database-snapshot.txt` |
| 51 | Database preservation | 0 | 0.09 | output below |
| 52 | `git diff --check` | 0 | 0.03 | `diff-check.txt` |

## Compiled Phase 26 acceptance (container, `--network none`, Node v22.23.3)

`compiledSystems: PASS`; 5 networks; connected 1750 W; demand 1400 W; duct velocity 2 m/s;
drain arrival −642.5 mm; 1 stack; longest egress 43 900 mm; lift `PROPOSED`; 0 clashes;
12 penetrations; all ten claims `NOT_CLAIMED`.

## Database preservation

`rlsEnabledEverywhere: true`, `preexistingPoliciesUnchanged: true`,
`onlyMigration0016Added: true`, `preserved: true` (migrations 0001–0016 applied).

## Mutation testing (critical suite, 47 tests per mutant)

19 / 19 mutants killed; every mutated file restored (`restored: true` for each); control run
clean before and after. Specifically required:

- **Uphill drainage** (`validator uphill check disabled`, `validate.ts`): killed by
  "rejects an uphill drainage segment and a run flatter than the declared slope".
  `reversed plumbing slope` (`routing.ts`) also killed (15 failures).
- **Clash recomputation** (`validator clash recomputation disabled`, `validate.ts`, whole
  condition replaced): killed by "detects a self-consistent detour through a structural column
  by recomputing the clash set".

## Benchmark (`benchmark:systems`)

| Case | Terminals | Routed | Search states | Clashes | Egress | calc ms | validate ms | KB |
|------|-----------|--------|---------------|---------|--------|---------|-------------|----|
| small 1-storey (v2) | 20 | 5/5 | 4052 | 0 | 51 | 27 | 8 | 39 |
| L-shaped | 18 | 5/5 | 4191 | 0 | 42 | 18 | 2 | 38 |
| parametric setback | 16 | 6/6 | 19154 | 0 | 149 | 116 | 7 | 46 |
| maximum-24-room | 52 | 4/5 | 28189 | 0 | 202 | 131 | 9 | 104 |
| typical 2-storey (wet) | 30 | 8/8 | 46997 | 0 | 163 | 145 | 7 | 63 |
| wet + structure | 30 | 8/8 | 54285 | 0 | 163 | 174 | 8 | 64 |
| wet + environmental | 30 | 8/8 | 46997 | 0 | 163 | 142 | 7 | 64 |
| multi-discipline full | 30 | 8/8 | 54285 | 0 | 163 | 148 | 6 | 65 |

maximum-24-room 4/5: the SANITARY network is a genuine `SYSTEM_ROUTE_INVALID` (the declared
outlet is higher than the arriving gravity drainage), reported, not hidden.

## Earlier runs (archived, superseded)

| Run | Result | Cause | Resolution | Archive |
|-----|--------|-------|------------|---------|
| 1 | 50/52 | IFC gates exit 127: `/tmp/designflow-phase23-ifc` interpreter missing (environment) | venv recreated from `scripts/requirements-ifc.txt` (ifcopenshell 0.8.5); no source change | `evidence/verification-run1-ifc-interpreter-missing.json` |
| 2 | 51/52 | `test:supabase`: 99/99 tests passed but `afterAll` cleanup failed "delete test projects" | see below; test-only source change, source re-frozen, full rerun | `evidence/verification-run2-*`, `evidence/release-run2.log` |

Run 2 root cause: local PostgREST `max_rows = 1000`. The cleanup read **all** rows of
`project_revision_takeoffs` (1101) and `project_workflow_runs` (1002) to build its protected
set; accumulated local history pushed both over the cap, the set was truncated, and cleanup
attempted to delete protected projects (FK `23503`). Reproduced in rolled-back SQL
transactions: every genuinely unprotected project deleted cleanly. Fix in
`apps/api/tests/supabase.live.test.ts`: protected reads are scoped to the run's own projects
(`.in(... ownedIds)`). This defect pre-dates Phase 26 (Phase 1–25 cleanup code).
