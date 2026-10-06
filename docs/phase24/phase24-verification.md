# Phase 24 verification

Runner: `python3 docs/phase24/verify-phase24.py` (Node v26 host, Node 22.23.3 container, local Supabase CLI 2.117.0 stack, IfcOpenShell 0.8.5 in `/tmp/designflow-phase23-ifc`). Machine-readable record: `evidence/final/verification.json`; per-gate logs in `evidence/final/*.txt`; tested source manifest `evidence/final/tested-source-sha256.json` (sha256 `7fd8084105a1703a572f38c1297cccf4f307476880bc1a6d4300b2b3870af0f5`). Every gate ran against that frozen manifest and the runner re-hashed the source before and after each command: **38/38 gates exit 0, `sourceUnchanged: true` for all.**

## Gates

| Gate | Result | Tests |
|---|---|---|
| `scripts/test-phase23-runner.py` | 0 | runner controls |
| `npm run build` / `typecheck` / `lint` | 0 / 0 / 0 | — |
| `npm run test:unit` | 0 | 1949 |
| `test:generator` / `test:blueprint` / `test:blueprint-qa` | 0 | 526 / 137 / 198 |
| `test:solver-v2` / `test:parametric` / `test:projects` | 0 | 40 / 36 / 23 |
| `test:takeoff` / `test:construction` / `test:cost` / `test:workflows` | 0 | 23 / 34 / 39 / 51 |
| `test:interpretation` / `test:conversations` / `test:ai-orchestration` | 0 | 133 / 52 / 120 |
| `test:integration` (embedded PostgreSQL, includes structural integration) | 0 | 202 |
| `test:bim` | 0 | 41 |
| `test:structural` | 0 | 84 (74 unit + 10 PostgreSQL) |
| `test:supabase` (live local GoTrue/PostgREST/RLS, Phase 23 and Phase 24 acceptance included) | 0 | 92 |
| `db:test` (pgTAP, 58 assertions incl. 7 new Phase 24) | 0 | `rls.sql .. ok` |
| `npm run check` (build+typecheck+lint+all vitest+interpretation+conversations) | 0 | 2193 + 133 + 52 |
| `benchmark:structural` | 0 | `evidence/benchmark.json` |
| Phase 23 BIM benchmark (output redirected) | 0 | 7 fixture families regenerated into `evidence/final/phase23` |
| IfcOpenShell round trip `scripts/verify-ifc.py` | 0 | 7 families, IFC4, 0 schema diagnostics each |
| IFC profile verification | 0 | — |
| `git diff --exit-code 208d56c -- supabase/migrations/0001…0013 docs/phase23-evidence` | 0 | historical migrations and Phase 23 evidence byte-identical |
| AI boundary (structural modules, service and route import nothing from `ai/` or `workflows/`) | 0 | — |
| `docker build -t designflow-api:phase24 .` | 0 | — |
| `scripts/smoke-container.mjs` | 0 | non-root, liveness 200, readiness 503 without dependency, SIGTERM exit 0 |
| Container contents | 0 | uid ≠ 0; compiled `structural/*`, `routes/structural.js`, `bim/ifc.js`; no `vitest`, `tsx`, `embedded-postgres` |
| Compiled Phase 23 acceptance in container (`--network none`) | 0 | `VALID_WITH_INCOMPLETE_DATA`, IFC export, diff |
| Compiled Phase 24 acceptance in container (`--network none`) | 0 | setback frame VALID; cantilever tip −11.249999999999993 mm vs closed form −11.25 mm |
| Local DB snapshot + preservation check | 0 | 0 missing pre-existing rows in every table; RLS on all 17 tables; policy digest unchanged; migrations 0001–0013 + 0014 |
| `git diff --check` | 0 | — |

## Database preservation (local Supabase stack)

1. `evidence/database-before.json` — before Phase 24: 16 tables, 925 projects, 1028 revisions, 763 takeoffs, 550 construction, 395 cost, 638 workflows, 2111 audit events; migrations 0001–0013.
2. `npx supabase migration up --local` applied only `0014_structural_analyses.sql`.
3. `evidence/database-after-migration.json` — all 16 pre-existing tables identical by per-row md5 digest; new empty table; RLS everywhere; policies unchanged.
4. `evidence/database-after-verification.json` — after all live suites: every pre-existing row digest still present; growth only from acceptance fixtures (projects 1093, revisions 1209, structural analyses 9). Test projects that hold immutable takeoff/workflow/structural history are retained by the existing cleanup policy.

Local verification only; nothing was deployed or pushed.

## Additional evidence

- Mutation testing: 8 planted defects (fixed-end-force sign, stiffness coupling sign, vertical-member axis convention, kN·m factor, missing gravity, loosened validator tolerance, station load term, beam-level rule) each made 2–14 structural tests fail; sources restored.
- Review-finding regressions were shown to fail with the fix disabled (6 tests) and pass with it.
- `evidence/benchmark.json`: per-stage timings (single sample; not SLOs).
- `evidence/supabase-receipts/`, `evidence/final/supabase-receipts/`: Supabase failure-watch receipts from live runs, kept out of tracked Phase 16 evidence.
