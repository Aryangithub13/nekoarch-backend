# Phase 25 verification

Runner: `systemd-inhibit --what=sleep:idle:handle-lid-switch python3 docs/phase25/verify-phase25.py`. Environment: Node v26.10.0 on the host, Node 22.23.3 in the container, the local Supabase CLI stack, and IfcOpenShell 0.8.5 in `/tmp/designflow-phase23-ifc`.

- Machine-readable record: `evidence/final/verification.json`.
- Per-gate logs: `evidence/final/*.txt`.
- Tested source manifest: `evidence/final/tested-source-sha256.json`, sha256 `37fdb0455fd5ffd14bc689499ab1798dd1c33f2b22fd2605f20abab264dfa829`.

Every gate ran against that frozen manifest. The runner re-hashed the source and the two untouched directories before and after each command.

**Result: 47/47 gates exit 0; `sourceUnchanged: true` and `untouchedDirectoriesUnchanged: true` for every gate.**

## Gates

| Gate | Exit | Tests / evidence |
|---|---|---|
| `git rev-parse backend-v1-phase24-complete^{commit}` | 0 | `d93aaa9d660ec5bc441188d768a46da98a2b52d6` (tag unmoved) |
| `git merge-base --is-ancestor 67188cf HEAD` | 0 | Phase 24 audit repair is the base |
| `docs/phase24-audit-repair/reproduce-audit.mts` | 0 | A01–A06 reproductions now rejected or correct |
| `scripts/test-phase23-runner.py` | 0 | runner controls |
| `npm run build` / `typecheck` / `lint` | 0 / 0 / 0 | — |
| `npm run test:unit` | 0 | 2092 (1990 before Phase 25 + 102 environmental) |
| `test:generator` / `test:blueprint` / `test:blueprint-qa` | 0 | 526 / 137 / 198 |
| `test:solver-v2` / `test:parametric` / `test:projects` | 0 | 40 / 36 / 23 |
| `test:takeoff` / `test:construction` / `test:cost` / `test:workflows` | 0 | 23 / 34 / 39 / 51 |
| `test:interpretation` / `test:conversations` / `test:ai-orchestration` | 0 | 133 / 52 / 120 |
| `test:integration` (embedded PostgreSQL) | 0 | 216 (206 + 10 environmental) |
| `test:bim` | 0 | 41 |
| `test:structural` | 0 | 129 |
| `test:environmental` | 0 | 112 (102 unit + 10 PostgreSQL) |
| `test:supabase` (live local GoTrue/PostgREST/RLS; Phase 23, 24 and 25 acceptance) | 0 | 95 |
| `db:test` (pgTAP, plan 65, 18 tables) | 0 | `rls.sql .. ok` |
| `npm run check` | 0 | 2350 vitest + 133 + 52 |
| `npm run benchmark:environmental` | 0 | `evidence/benchmark.json` |
| `docs/phase25/mutation-test.py` | 0 | 19/19 mutants killed, control clean, sources restored |
| Phase 23 BIM fixtures (temporary tree) | 0 | 7 families regenerated |
| IfcOpenShell round trip `scripts/verify-ifc.py` | 0 | 7 families, IFC4 |
| IFC profile verification | 0 | — |
| Phase 23 architecture identity | 0 | 7/7: IFC byte-identical, model and BIM equal to committed evidence |
| Historical artifacts (migrations 0001–0014, `docs/phase23-evidence`, `docs/phase24`, `docs/phase24-audit-repair`) | 0 | byte-identical to `67188cf` |
| AI boundary | 0 | structural and environmental modules, service, route and repository import nothing from `ai/` or `workflows/` |
| Environmental offline / no I/O | 0 | no network, child-process, filesystem, worker or `process.env` access in `apps/api/src/environmental` |
| Validator independence | 0 | `validate.ts` imports none of `model`, `solar`, `shading`, `analysis` |
| `docker build -t designflow-api:phase25 .` | 0 | — |
| `scripts/smoke-container.mjs` | 0 | non-root; liveness 200; readiness 503 with a failed dependency; SIGTERM exits 0 |
| Container contents | 0 | uid ≠ 0; compiled BIM, structural and environmental modules; no `vitest`, `tsx` or `embedded-postgres` |
| Compiled Phase 23 acceptance (`--network none`) | 0 | `VALID_WITH_INCOMPLETE_DATA`, 87 elements, IFC export, diff, history preserved |
| Compiled Phase 24 acceptance (`--network none`) | 0 | 48 nodes / 58 members; cantilever tip −11.249999999999993 mm vs −11.25 mm closed form |
| Compiled Phase 25 acceptance (`--network none`) | 0 | `PASS`: setback, 8 zones / 34 surfaces, 7809.3 W, 187.4232 kWh, 7 shaded surfaces at 16:30, solar Δ 0.008°, every claim `NOT_CLAIMED` |
| Local DB snapshot and preservation check | 0 | see below |
| `git diff --check` | 0 | — |

## Mutation testing (`evidence/mutation-testing.json`)

Each mutation is planted in source and the environmental suite (112 tests) is run, then the source is restored and its hash confirmed. The first run killed 18/19 (`evidence/mutation-testing-initial-18of19.json`); see report §36, item 5.

| Mutation | File | Failing tests |
|---|---|---|
| flipped north orientation | `solar.ts` | 24 |
| east/west solar azimuth sign | `solar.ts` | 25 |
| DST fold or gap accepted | `solar.ts` | 1 |
| reversed surface normal | `model.ts` | 10 |
| omitted window | `model.ts` | 24 |
| duplicate surface | `model.ts` | 20 |
| mm² to m² error | `units.ts` | 22 |
| Celsius/Kelvin offset in a difference | `units.ts` | 27 |
| wrong energy integration factor | `units.ts` | 22 |
| irradiance ×1000 | `analysis.ts` | 2 |
| ground temperature confused with outdoor | `analysis.ts` | 26 |
| grazing and back faces counted as facing | `analysis.ts` | 21 |
| antimeridian longitude not wrapped | `analysis.ts` | 1 |
| malformed calculator output accepted | `analysis.ts` | 1 |
| orientation-only heuristic instead of ray casting | `shading.ts` | 19 |
| stale result served as current | `environmental-service.ts` | 1 |
| validator solar comparison disabled | `validate.ts` | 1 |
| validator independent ray recount disabled | `validate.ts` | 2 |
| validator heat-flow recomputation disabled | `validate.ts` | 2 |

## Numerical references

| Quantity | Reference | Tolerance |
|---|---|---|
| Solar position | NREL SPA published example; Meeus 25.a; analytic equinox/solstice noon altitudes in both hemispheres; independent PSA over 150 points | 0.002–0.003° (SPA), 0.03° (PSA); 0.05° in the result validator |
| Orientation | Generator `cardinalForSide` at 0/90/180/270° and arbitrary rotations | exact |
| Shading | Closed-form fin shadow (sample by sample); independent plane-intersection caster | exact / ≤ one sample |
| Irradiance | DNI·sin(altitude) on an unshaded roof | 1e-9 relative |
| Heat flow | Hand-computed U·A·ΔT from source geometry (L, setback, maximum-24) | 1e-9 relative |
| Energy | Constant P·Δt; 24 h and 48 h series closed forms | 1e-9 relative |

## Database preservation (local Supabase stack)

1. `evidence/database-before.json` was captured before Phase 25. It covers 17 tables and migrations 0001–0014. Key row counts:

   | Table | Rows |
   |---|---|
   | projects | 1128 |
   | revisions | 1250 |
   | QA runs | 1250 |
   | takeoffs | 867 |
   | construction | 630 |
   | cost | 455 |
   | workflows | 750 |
   | structural | 12 |
   | audit events | 2565 |

2. `npx supabase migration up --local` applied only `0015_environmental_analyses.sql`.
3. `evidence/database-after-migration.json` shows every pre-existing table identical. The one new table is empty, RLS is on everywhere and the pre-existing policies are unchanged.
4. `evidence/database-after-verification.json` was captured after all live suites. 0 pre-existing row digests are missing in any table, and migrations run 0001–0015. Growth comes only from acceptance fixtures: projects 1272, revisions 1422 and environmental analyses 20.

The verification was local only. Nothing was deployed or pushed.

## Earlier runs kept as evidence

- `evidence/verification-run1-ifc-interpreter-missing.json`: the IfcOpenShell virtualenv at `/tmp/designflow-phase23-ifc` had been removed, so `ifc-roundtrip` and `ifc-profiles` exited 127. It was recreated from `scripts/requirements-ifc.txt`; no source changed.
- `evidence/verification-run2-host-suspend-check-timeout*.{json,txt}`: 46/47 gates passed. The host entered s2idle suspend from 08:24:20 to 08:31:53 (kernel journal excerpt kept) during `npm run check`, and a 20 s vitest timer for the Phase 10 test `golden one-bedroom` fired on resume after 2.9 s of measured work. The same test passed in that run's `test:blueprint-qa` gate. The final run took a sleep inhibitor; no source changed.
- `evidence/supabase-receipts/` and `evidence/final/supabase-receipts/` hold Supabase failure-watch receipts from live runs. They are kept out of the tracked Phase 16 evidence.
