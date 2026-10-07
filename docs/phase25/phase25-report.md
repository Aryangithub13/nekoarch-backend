# Phase 25 report — environmental & building simulation (bounded)

**Release classification: PHASE 25 FULLY IMPLEMENTED AND VERIFIED WITHIN BOUNDED SCOPE**

## 1–3. Starting point, baseline, Phase 24 audit status

- Phase 24 release: `backend-v1-phase24-complete` → `d93aaa9` (unchanged; gate `phase24-tag`).
- The independent Phase 24 audit (A01–A06, 3 × P1 + 3 × P2) was repaired and verified first on `phase24/audit-repair` at commit `67188cf` (41/41 frozen-source gates, 14/14 mutants killed; `docs/phase24-audit-repair/REPAIR-REPORT.md`). No P0/P1 Phase 24 defect remains open.
- Phase 25 branch `phase25/environmental-simulation` starts at `67188cf`. Nothing was pushed or deployed. The pre-existing untracked `docs/backend-repair-1-23/` and `docs/phase24/evidence/final/phase23/fixtures/` were left untouched (digest-checked around every gate).

## 4. Source audit

`phase25-source-audit.md`. Key findings: BIM provides centerline walls, hosted openings, floor and flat-roof plates (including setback roof plates) but no location, time zone, thermal or optical data; site north exists but its **documentation contradicts the executable rule** (`README`: from +Z; `cardinalForSide`: from −Z clockwise) — a north/south mirror. Phase 25 therefore requires an explicit orientation with a convention literal and never reads site north as authoritative.

## 5–6. Architecture and versions

`apps/api/src/environmental/`: `contracts.ts` (schemas, limits, claims), `units.ts`, `solar.ts`, `model.ts` (builder), `shading.ts`, `analysis.ts` (preflight, adapter `environmental-adapter-v1`, reference calculator `nekoarch-reference-environmental 1.0.0`, untrusted-output validation), `validate.ts` (independent; imports none of the above but contracts). Service, routes, repository and migration `0015` mirror the Phase 24 artefact pattern. Versions: `environmental-input-v1`, `environmental-model-v1`, `environmental-analysis-v1`, `environmental-adapter-v1`, `environmental-weather-v1`, validators `environmental-model-validator-v1` / `environmental-result-validator-v1`, solar `NOAA_MEEUS_GEOMETRIC_V1`. All are literals in schemas and the input hash.

## 7. Source and revision binding

BIM binding (projectId, revisionId, modelHash, generatorVersion, generationId, requirementsHash, parameterHash) + `bimVersion` + `environmentalModelVersion`; the write RPC recomputes it from the stored revision. The input hash covers versions, binding, the full explicit input (weather included) and calculator metadata.

## 8–9. Zones and envelope surfaces

One zone per space (by id): centerline floor area, floor-to-floor height, volume. Envelope: `EXTERIOR_WALL` (a space on exactly one side, sampled at ¼, ½, ¾ — classification must agree), hosted `WINDOW`/`DOOR`/`OPENING`, `ROOF` (flat-roof plates, including setback roofs), `GROUND_FLOOR` (lowest floor plates, slab-on-ground ASSUMED). Net wall area deducts each hosted opening once. Interior walls and intermediate floors are internal boundaries (equal set-point). An `envelope` block reports `CLOSED` or `INCOMPLETE` (uncovered zones), and incomplete envelopes make thermal and exposure `PARTIAL`. Bounded source profile: axis-aligned envelope walls, one zone per exterior wall, no exposed upper floors.

## 10. Orientation and location

Explicit `northMilliDegrees` with `NORTH_FROM_MINUS_Z_CLOCKWISE_TO_PLUS_X`; `east = north × up`. Verified at 0°/90°/180°/270° against the tested generator rule and at arbitrary rotations. Latitude/longitude ranges and IANA time zones are validated (`ENVIRONMENTAL_LOCATION_INVALID`); local times in DST gaps or folds are refused.

## 11. Weather

Optional inline dataset with provenance, mandatory `synthetic` flag, units header, explicit-offset timestamps, strict interval (no gaps, duplicates or reordering; nothing interpolated), physical ranges, a SHA-256 checksum and a station within 1° of the site (antimeridian-safe). No network retrieval exists.

## 12. Environmental materials

Constructions carry U (W/(m²·K)) with provenance `USER_PROVIDED`/`VERSIONED_LIBRARY`/`EXTERNAL_DATASET`; unassigned surfaces are `NOT_SPECIFIED`. Architectural material labels and structural materials are never consulted (tested with a "Glass" specification). No other property is modelled because no calculation uses it.

## 13. Unit policy

Explicit units everywhere; absolute temperature °C only, differences in K; `celsiusToKelvin` is an offset; power W/kW vs energy Wh/kWh with explicit duration.

## 14. Solar position

NOAA/Meeus geometric algorithm. Independent checks: NREL SPA reference (zenith within 0.002° after removing SPA's refraction and parallax, azimuth within 0.003°), Meeus 25.a declination, analytic noon altitudes at equinoxes/solstices in both hemispheres, morning/afternoon/noon azimuth sides, and agreement with an independently written PSA algorithm within 0.03° over 150 latitude/season/hour points. The result validator recomputes every instant with PSA (≤ 0.05°).

## 15. Shading and exposure

Sampled ray casting toward the sun against storey-height exterior-wall rectangles and roof polygons of the same building; rays start 1 mm off the wall's outer face (so plate edges are not false overhangs). States: `SUN_BELOW_HORIZON` / `NOT_FACING` / `EVALUATED`. Verified against a closed-form fin shadow sample by sample, self-shadow-free single walls, inclusive edge contact, parallel (grazing) rays, L inner-corner self-shading, upper-storey shading of setback roofs, night, and an independently written plane-intersection caster in the validator (≤ one sample). Direct-beam irradiance only from supplied DNI at the exact instant (closed form DNI·sin(altitude) on an unshaded roof).

## 16. Daylight

Not modelled. Geometric `WINDOW_TO_FLOOR_AREA_RATIO` per zone, labelled `isDaylightMetric: false`; no lux or illuminance anywhere.

## 17–18. Thermal and energy

`Q = U·A·ΔT` per surface (positive = heat leaving), per type, total (W, kW), with case statuses `ANALYZED`/`PARTIAL`/`INPUT_INCOMPLETE`. Energy only for complete cases: `E = P·Δt` (constant) or `Σ P_i·Δt` (weather series, left rectangle, with peak). Verified by hand-computed totals from source geometry on L, setback and maximum-24, zero ΔT, sign reversal, per-type U scaling, 24 h and 48 h closed forms.

## 19–20. Adapter and independent validation

Solver-neutral analysis input (hashed) → adapter → untrusted-output checks (schema/finiteness/units, identity, input hash, inventories, fraction arithmetic) → independent result validator → immutable snapshot. 20 model and 22 result adversarial mutations are rejected; a self-consistent forged result (all surfaces lit), a self-consistent wrong clock, and a forged heat flow through the API are rejected without persistence.

## 21. Numerical verification

See §14–18 and `phase25-verification.md`. Tolerances per quantity: geometry exact / 1e-12, solar 0.05°, incidence 1e-9 (same sun) / grazing 1e-6, fractions one sample, heat flow and energy 1e-9 relative.

## 22. Staleness

Revision A analysed → west-wing edit → revision B: A stays readable and `STALE`, `require=current` → 409, A is not reachable through B's path (404), B's status lists A as stale, and B needs its own analysis (new id, new input hash). A changed environmental input on the same revision creates a new row; the first remains history. Proven on embedded PostgreSQL and on the live local Supabase stack.

## 23–28. Persistence, API, security, RLS, concurrency, limits

Migration `0015` (forward only) mirrors `0014`: owner-only RLS select, no client writes, immutable trigger, signed `security definer` write with in-SQL binding recomputation, claim and structure checks, advisory-lock convergence, idempotency receipts, read RPC. API: `phase25-api.md`. Tested: direct writes, unsigned/forged/cross-user RPCs, wrong revision/hash/QA anchor/model version, forbidden claims, missing thermal results, nondeterministic replay, anonymous reads (pgTAP + PostgreSQL), 8 concurrent identical writes → 1 row, distinct inputs distinct, receipt-failure rollback, no signer → 503, quotas (POST = generation, GET = read). No network, child-process, filesystem or environment access in the environmental modules (gate). Limits: `phase25-design.md` §14, with preflighted exposure rows and ray budget (typed 422 before any ray is cast).

## 29. Performance

`npm run benchmark:environmental` (`evidence/benchmark.json`): Node v26.10.0, one process, one sample per case. These are observations, not SLOs. Total = projection + model validation + preflight + calculation + result validation + serialization.

| Case | Zones | Surfaces | Ray samples | Instants | Weather | Calc ms | Validate ms | Total ms | Snapshot | Solar Δ vs PSA | RSS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| v1 | 6 | 19 | 651 | 3 | 0 | 5.0 | 9.3 | 35.9 | 43 KB | 0.0223° | 130 MiB |
| v2 | 6 | 19 | 603 | 3 | 0 | 2.4 | 5.8 | 12.6 | 43 KB | 0.0223° | 179 MiB |
| L | 5 | 17 | 526 | 3 | 0 | 2.5 | 7.9 | 14.5 | 40 KB | 0.0223° | 184 MiB |
| setback | 8 | 34 | 964 | 3 | 0 | 7.5 | 15.1 | 33.0 | 70 KB | 0.0223° | 192 MiB |
| maximum-24 | 25 | 48 | 1099 | 3 | 0 | 6.9 | 15.1 | 55.6 | 106 KB | 0.0223° | 204 MiB |
| west-wing-edit | 8 | 34 | 992 | 3 | 0 | 5.6 | 9.5 | 24.1 | 70 KB | 0.0223° | 208 MiB |
| authored | 2 | 9 | 371 | 3 | 0 | 1.0 | 1.0 | 4.0 | 24 KB | 0.0223° | 211 MiB |
| maximum-24 × 24 instants | 25 | 48 | 1099 | 24 | 0 | 11.0 | 31.1 | 83.3 | 360 KB | 0.0073° | 224 MiB |
| setback × 8760 h weather | 8 | 34 | 964 | 0 | 8760 | 11.8 | 16.2 | 63.0 | 906 KB | — | 239 MiB |

Every case finishes in under 0.1 s. The largest snapshot (a full year of hourly weather) is 0.9 MB, well within the 9 MB snapshot limit (`phase25-design.md` §14). Limit breaches are refused at preflight before any ray is cast.

## 30. Docker

`docker build -t designflow-api:phase25 .` uses the existing multi-stage `node:22` image; no Dockerfile change was needed.

- **Smoke test:** non-root, liveness 200, readiness 503 with a failed dependency, SIGTERM exits 0.
- **Runtime contents:** compiled `environmental/*`, `routes/environmental.js`, the structural and BIM modules; no `vitest`, `tsx` or `embedded-postgres`.
- **Compiled acceptance, each run inside the container with `--network none`:**
  - Phase 23: `VALID_WITH_INCOMPLETE_DATA`, IFC export and diff.
  - Phase 24: cantilever tip −11.249999999999993 mm vs −11.25 mm closed form.
  - Phase 25: setback, 8 zones / 34 surfaces, 7809.3 W, 187.4232 kWh, 7 shaded surfaces at 16:30, solar Δ 0.008°, all claims `NOT_CLAIMED`.

## 31–35. Regression, preservation, commands and counts

Frozen-source runner `docs/phase25/verify-phase25.py`, run under `systemd-inhibit` (see `phase25-verification.md` for every gate and command). **47/47 gates exit 0** against source manifest `37fdb0455fd5ffd14bc689499ab1798dd1c33f2b22fd2605f20abab264dfa829`, with source and untouched directories unchanged around every gate.

- **Phase 1–24 regression (§31):**
  - build / typecheck / lint pass.
  - Test counts:

    | Suite | Tests |
    |---|---|
    | unit | 2092 |
    | generator | 526 |
    | blueprint | 137 |
    | blueprint-qa | 198 |
    | solver-v2 | 40 |
    | parametric | 36 |
    | projects | 23 |
    | takeoff | 23 |
    | construction | 34 |
    | cost | 39 |
    | workflows | 51 |
    | interpretation | 133 |
    | conversations | 52 |
    | ai-orchestration | 120 |
    | integration (embedded PostgreSQL) | 216 |
    | bim | 41 |
    | structural | 129 |
    | environmental (102 unit + 10 PostgreSQL) | 112 |
    | live Supabase | 95 |

  - pgTAP: plan 65 over 18 tables passes.
  - `npm run check`: 2350 + 133 + 52.
  - Mutation testing: 19/19 mutants killed.
- **Phase 24 structural preservation (§32):**
  - The tag `backend-v1-phase24-complete` still points to `d93aaa9`; the repaired baseline `67188cf` is an ancestor.
  - The A01–A06 audit reproductions are all rejected or correct, `test:structural` 129 passes, and compiled Phase 24 acceptance passes in the container.
  - Migrations 0001–0014 and `docs/phase24*` are byte-identical.
  - The 12 pre-existing structural rows are preserved.
  - Phase 25 changed no structural code.
- **Phase 23 BIM/IFC preservation (§33):**
  - All 7 regenerated fixture families are IFC byte-identical, with model and BIM (hashes, semantic ids) equal to the committed `docs/phase23-evidence`.
  - IfcOpenShell 0.8.5 round trip and profile checks pass.
  - `docs/phase23-evidence` is byte-identical.
  - Phase 25 changed no BIM code.
- **Database (local Supabase):**
  - Only `0015_environmental_analyses.sql` was applied.
  - 0 pre-existing row digests are missing in any of the 17 pre-existing tables.
  - RLS is on in all 18 tables and the pre-existing policies are unchanged.
- **Commands (§34):** the exact argv of every gate is in `evidence/final/verification.json`.

## 36–37. Failures encountered and repairs

1. Wall samples on the centerline made the roof plate (which ends at the outer face) act as a 115 mm overhang, so convex walls were reported 83 % lit at noon. Fixed by casting from the outer face (`faceOffsetMm`); areas stay centerline-based.
2. The authored fixture has no roof plate; totals would silently omit the roof. Added envelope closure: incomplete envelopes give `PARTIAL` with no energy.
3. Weather station check did not wrap longitude across the antimeridian. Fixed and regression-tested.
4. A surface with no samplable interior would have produced a 0/0 fraction. Now refused up front as `ENVIRONMENTAL_SOURCE_UNSUPPORTED`.
5. First mutation run killed 18/19: disabling the validator's PSA comparison survived because every solar forgery tested was self-inconsistent and caught by the sun-vector check. Added a self-consistent wrong-clock forgery; now killed (`evidence/mutation-testing-initial-18of19.json` kept).
6. Several first-draft test expectations were wrong (authored wall height, sample counts, a fixture with an invalid specification, an edge-contact ray that ignored the origin offset, a forgery at an instant where nothing was shaded). Tests corrected; no production change.
7. Release run 1: `test:unit` failed in `hardening.test.ts` because the telemetry route allowlist (`lib/sentry.ts`) lacked the environmental route templates. Added them; the source was re-frozen and the run restarted. A second attempt then hit `ifc-roundtrip`/`ifc-profiles` exiting 127: the IfcOpenShell virtualenv in `/tmp` had been removed. It was recreated from `scripts/requirements-ifc.txt` with no source change (`evidence/verification-run1-ifc-interpreter-missing.json`).
8. Release run 2: 46/47 gates passed. The host suspended (s2idle, 08:24:20–08:31:53) during `npm run check`, and a Phase 10 test's 20 s timer fired on resume after 2.9 s of measured work. The record and journal excerpt were kept, and the final run took a sleep inhibitor: 47/47, no source change.

## 38. Changed files

New:
- `apps/api/src/environmental/{contracts,units,solar,model,shading,analysis,validate}.ts`
- `apps/api/src/lib/environmental-repository.ts`, `apps/api/src/services/environmental-service.ts`, `apps/api/src/routes/environmental.ts`
- `supabase/migrations/0015_environmental_analyses.sql`
- `apps/api/tests/environmental.test.ts`, `apps/api/tests/environmental.integration.test.ts`
- `test-support/environmental-fixtures.ts`, `test-support/environmental-acceptance.ts`
- `scripts/benchmark-environmental.ts`
- `docs/phase25/`: the five documents, `compiled-acceptance.mjs`, `mutation-test.py`, `verify-phase25.py`, `snapshot-local-db.py`, `evidence/`

Modified (50 insertions, 9 deletions):
- `apps/api/src/app.ts`: register environmental routes.
- `apps/api/src/lib/http-protection.ts`: validate/analyses POST in the generation quota.
- `apps/api/src/lib/repository.ts`, `apps/api/src/lib/supabase.ts`: environmental RPC wiring.
- `apps/api/src/lib/sentry.ts`: environmental route templates in the telemetry allowlist.
- `test-support/pg-backend.ts`: embedded PostgreSQL environmental RPC.
- `apps/api/tests/supabase.live.test.ts`: Phase 25 live acceptance and cleanup protection.
- `supabase/tests/rls.sql`: plan 65, +7 assertions.
- `supabase/tests/database.test.ts`: 18 tables.
- `package.json`: `test:environmental`, `benchmark:environmental`, suites in unit and integration.

Not changed: migrations 0001–0014, Phase 23/24 sources and evidence, the Dockerfile, the frontend workspace. Left uncommitted and untouched: `docs/backend-repair-1-23/`, `docs/phase24/evidence/final/phase23/fixtures/`.

## 39. Known limitations

- Steady-state transmission only: no thermal mass, infiltration, ventilation, internal/solar gains, HVAC, thermal bridges, moisture, or dynamic annual simulation.
- Direct beam only (no diffuse/reflected sky), this building only (no terrain or neighbours), geometric solar position without refraction, zero-thickness centerline surfaces; slab-edge strips are not envelope surfaces.
- Bounded source profile: axis-aligned envelope walls, one zone per exterior wall, flat roofs, no exposed floors; anything else is `ENVIRONMENTAL_SOURCE_UNSUPPORTED`.
- Roofs and ground floors relate to all overlapping zones of their level (no area apportioning); per-zone heat-loss totals are not reported.
- Weather-driven surface flows use the period-mean outside temperature; the energy integral uses each sample.
- Site `northMilliDegrees` documentation conflict (pre-existing, outside Phase 25 scope) remains; orientation must be supplied explicitly.

## 40. Release recommendation

Release locally as **PHASE 25 FULLY IMPLEMENTED AND VERIFIED WITHIN BOUNDED SCOPE**: commit on `phase25/environmental-simulation` with the annotated tag `backend-v1-phase25-complete`. Do not push or deploy until the owner authorizes it; when authorized, apply `0015` to the target database with the same before/after snapshot check.

The scope is a deterministic steady-state envelope heat-loss, direct-beam solar exposure and geometric glazing-ratio foundation. It is not an energy, comfort, daylight or code-compliance assessment, and every such claim is `NOT_CLAIMED` in the data, the database and the API. Phase 26 (MEP, fire safety, vertical transport) was not started.
