# Phase 25 design — environmental & building simulation (bounded)

## 1. Layers and versions

```
accepted revision ─► Phase 23 BIM (bim-semantic-v1, unchanged)
   + explicit environmental input (environmental-input-v1)
   ─► environmental semantic model (environmental-model-v1)          model.ts
   ─► independent model validation (environmental-model-validator-v1) validate.ts
   ─► solver-neutral analysis input (model + resolved instants/cases/weather), hashed
   ─► versioned adapter environmental-adapter-v1 → reference calculator nekoarch-reference-environmental 1.0.0
   ─► untrusted-output validation (schema, identity, inventory, finiteness)            analysis.ts
   ─► independent result validation (environmental-result-validator-v1)                validate.ts
   ─► immutable snapshot environmental-analysis-v1 (migration 0015), revision-bound
```

Every version is a schema literal. The input hash covers `environmentalModelVersion`, `analysisVersion`, the full binding, the explicit input (including the weather dataset and its checksum) and the calculator metadata. Physics never comes from an LLM; this module imports nothing from `ai/` or `workflows/`.

## 2. Source binding and staleness

The binding is the BIM binding (projectId, revisionId, modelHash, generatorVersion, generationId, requirementsHash, parameterHash) plus `bimVersion` and `environmentalModelVersion`. The write RPC recomputes it from the stored revision, exactly like structural. An analysis is CURRENT only when its revision is the project's current revision; reads through another revision's path return 404, `?require=current` on a superseded revision returns 409 `ENVIRONMENTAL_RESULT_STALE`, and `/status` lists other revisions' analyses as STALE. A changed environmental input (constructions, location, orientation, weather, cases, calculator version) has a different input hash and therefore produces a new immutable row; older rows stay readable history.

## 3. Coordinates, orientation, sun

- Model frame: building-v2 `x-right-y-up-z-depth`, mm, right-handed, `up = +Y`.
- Orientation is explicit input: `{ northMilliDegrees, convention: 'NORTH_FROM_MINUS_Z_CLOCKWISE_TO_PLUS_X' }` — the rule `cardinalForSide` implements. North `N = (sin θ, 0, −cos θ)`, East `E = (cos θ, 0, sin θ)`; `E = N × up`, so east/west cannot invert. The site's own `northMilliDegrees` is reported beside it for comparison only (its documentation conflicts — see the source audit).
- Solar azimuth: degrees clockwise from geographic north (N 0, E 90, S 180, W 270). Altitude: geometric degrees above the horizon (no refraction).
- Sun direction in the model frame: `s = cos(alt)(cos(az) N + sin(az) E) + sin(alt) up`.
- Surface azimuth: `atan2(n·E, n·N)` for vertical surfaces (null for horizontal ones); tilt: angle between outward normal and up (roof 0°, wall 90°, ground floor 180°).

## 4. Location and time

`location = { latitude, longitude (degrees), timezone (IANA) }`; latitude ∈ [−90, 90], longitude ∈ [−180, 180]; the time zone must resolve in the runtime ICU database; otherwise `ENVIRONMENTAL_LOCATION_INVALID`. Nothing is defaulted. Solar instants are local civil date-times in that zone; conversion to UTC finds every UTC instant whose wall clock equals the given value: zero (DST gap) or two (DST fold) candidates are rejected with `ENVIRONMENTAL_INPUT_INCOMPLETE` (never guessed). Elevation is neither used nor accepted.

## 5. Solar position (`solar.ts`)

`NOAA_MEEUS_GEOMETRIC_V1`: the NOAA Solar Calculator formulation of Meeus' low-precision solar coordinates (geometric mean longitude/anomaly, equation of centre, apparent longitude, corrected obliquity, equation of time, true solar time, hour angle). UT stands in for TT (ΔT ≈ 69 s moves the Sun ≈ 0.0008°). Stated accuracy ≈ 0.01° for 1900–2100: geometric, geocentric, no refraction. Verification is independent of the implementation: Meeus Example 25.a declination, the NREL SPA reference case (corrected for its refraction and parallax), analytic equinox/solstice noon altitudes in both hemispheres, morning/afternoon azimuth sides, and the separately implemented PSA algorithm (Blanco-Muriel 2001) used by the result validator.

## 6. Environmental model

**Bounded source profile** (else `ENVIRONMENTAL_SOURCE_UNSUPPORTED`): every space `wall-centerline` on a level with known floor-to-floor height; walls with known height and base; envelope walls axis-aligned; every wall's exposure unambiguous and consistent with its architectural classification; upper floor plates contained in a floor plate of the level below (no exposed floors).

**Zones** — one per space, identified by id, never by name: source reference, level, floor area (centerline polygon, m²), height = level floor-to-floor (basis stated), volume (m³).

**Envelope surfaces** (centerline, zero thickness):

| Type | Source | Boundary | Geometry / area | Normal |
|---|---|---|---|---|
| `EXTERIOR_WALL` | wall with a space on exactly one side (tested at ¼, ½, ¾ of its length, 0.25 mm either side) | OUTDOOR | vertical rectangle length × height; net = gross − hosted openings | horizontal, toward the side without a space |
| `WINDOW` / `DOOR` / `OPENING` | openings hosted by an exterior wall | OUTDOOR | width × height | host normal |
| `ROOF` | `flat-roof` plates | OUTDOOR | footprint minus voids at the plate top | +Y |
| `GROUND_FLOOR` | floor plates on the lowest level (slab-on-ground ASSUMED) | GROUND | footprint minus voids | −Y |

Interior walls and intermediate floors separate zones held at the same set-point and are not envelope surfaces. Each physical source yields exactly one surface. `unspecified` wall classification is accepted and marked ASSUMED. Walls and openings relate to their one zone; roofs and ground floors list the overlapping zones of their level (no area apportioning).

**Constructions** — explicit only: `{ key, name, uValue: { value, unit: 'W/(m2*K)' }, provenance: { kind: USER_PROVIDED | VERSIONED_LIBRARY | EXTERNAL_DATASET, reference, version } }` (library/dataset entries require reference and version), assigned per surface type with per-source overrides. Unassigned ⇒ `NOT_SPECIFIED`. BIM materials and structural materials are never consulted. Only U is modelled; conductivity, density, specific heat, emissivity, absorptance, SHGC and visible transmittance are deliberately absent because no implemented calculation uses them.

## 7. Units and temperature

Explicit units on every quantity (mm, m², m³, °C, K, W, kW, Wh, kWh, W/m², W/(m²·K), h, deg). Absolute temperatures are accepted only in °C (`unit: 'degC'`); differences are in K. `celsiusToKelvin(t) = t + 273.15`; `temperatureDifferenceK(a, b) = a − b` (never offset). Power (W) and energy (Wh) are distinct; energy always carries an explicit duration.

## 8. Analyses

1. **Solar position** per instant (needs location): UTC, altitude, azimuth, above-horizon flag, model-frame sun direction (needs orientation).
2. **Direct-sun exposure** per instant × envelope surface (needs location + orientation): state `SUN_BELOW_HORIZON` | `NOT_FACING` (cos incidence ≤ 1e-6; grazing counts as not facing) | `EVALUATED`. The sunlit fraction comes from rays cast toward the sun from a regular sample grid (cell ≈ 500 mm, 1–8 per axis; polygon cells kept when their centre is inside) offset 1 mm along the outward normal. Occluders: storey-height exterior-wall rectangles and roof polygons of the same building, excluding the surface itself and an opening's host; hits need t > 1e-6 mm and bounds are inclusive (edge contact shades). The chain is explicit: sun above horizon → surface facing sun → unoccluded fraction → irradiance. **Direct-beam irradiance** is reported only when the weather dataset holds a DNI sample at exactly that UTC instant: incident = DNI × cos θ × fraction (W/m²), power = incident × net area (W). Without DNI, only geometric exposure is reported. Diffuse/reflected irradiance, DHI/GHI and solar gains are not evaluated.
3. **Daylight** — not modelled. A geometric indicator only: per zone, exterior-window area ÷ floor area (`WINDOW_TO_FLOOR_AREA_RATIO`), labelled as not daylight, not illuminance, not compliance. No lux anywhere.
4. **Steady-state envelope heat flow** per thermal case: `Q = U × A_net × ΔT`, ΔT = T_inside − T_outside (OUTDOOR) or T_inside − T_ground (GROUND); positive = heat leaving the building. Inside and outside temperatures are mandatory per case; ground temperature is needed only when ground surfaces exist (otherwise they are `NOT_EVALUATED`). Case status `ANALYZED` (every surface evaluated), `PARTIAL` (totals cover evaluated surfaces only and say so) or `INPUT_INCOMPLETE`. Generic `OPENING`s have no U-value semantics and are `UNSUPPORTED`.
5. **Energy** (bounded): constant outside temperature with explicit `durationHours` ⇒ `E = P × Δt`; weather-driven case ⇒ `E = Σ P_i Δt` over the dataset (each sample holds for one interval, left-rectangle rule, no interpolation), plus peak power. Only for `ANALYZED` cases. Envelope transmission only — not annual consumption, not HVAC, not certification.

## 9. Weather

Inline dataset `environmental-weather-v1`: provenance (source, dataset id/version, station name/lat/lon, `synthetic` flag, licence), time zone, interval 15/30/60 min, unit header (`degC`, `W/m2`), ≤ 8760 samples `{ timestamp (ISO 8601 with offset), dryBulb, directNormalIrradiance }` (null = missing, never interpolated), `sha256 = digest(samples)`. Rejected with `ENVIRONMENTAL_WEATHER_INVALID`: checksum mismatch, unparsable/duplicate/unordered timestamps, gaps, out-of-range values, station more than 1° from the location. A weather-driven case with any missing dry-bulb value is `INPUT_INCOMPLETE`. Synthetic data is labelled synthetic in every result. No download path exists.

## 10. Adapter and trust

`EnvironmentalCalculatorAdapter { metadata, analyze(analysisInput, { deadline }) }` — the reference calculator is local, deterministic and dependency-free. Its output is untrusted: schema (finite numbers, unit literals), calculator identity, analysis-input hash, instant/surface/case inventories and fraction ranges are checked before results are accepted. A richer simulator can be added behind the same boundary without changing public contracts.

## 11. Independent validation (`validate.ts` imports nothing from model/solar/shading/analysis)

- **Model**: binding/version; zone inventory and areas (own shoelace); exterior walls from Phase 23 adjacency (`wallSpaceIds`), not from the builder's sampling; outward-normal side tested against the zone polygon; gross/net areas, opening hosting, duplicate sources, plate classification, tilt/azimuth, constructions re-resolved from the input with provenance.
- **Results**: binding, calculator identity, input hash; solar position recomputed with PSA (≤ 0.05°); sun vector consistent with altitude/azimuth/orientation; per-surface states consistent with independently computed incidence (grazing band 1e-3 tolerated); sunlit fractions recomputed by an independently written ray caster (≤ one sample); direct beam recomputed; every heat flow, total and energy recomputed (relative 1e-9); statuses consistent with input completeness; claims fixed.

## 12. Claims and statuses

Snapshot claims `energyEfficiency`, `sustainability`, `greenCertification`, `thermalComfort`, `daylightCompliance`, `codeCompliance`, `certification` are all `NOT_CLAIMED`. Capability statuses: `NOT_EVALUATED`, `INPUT_INCOMPLETE`, `ANALYZED`, `PARTIAL`, `UNSUPPORTED`; artefact status `VALIDATED`; reads add `CURRENT`/`STALE`.

## 13. Persistence and API

Migration `0015_environmental_analyses.sql` (forward only): `project_revision_environmental_analyses` mirroring `0014` — owner-only RLS select, no client writes, immutable trigger, signed `environmental_write` (binding recomputed in SQL, advisory-lock convergence on `(revision, input_hash)`, idempotency receipts), `environmental_read` (get/list/status). Routes under `/api/projects/:projectId/revisions/:revisionId/environmental`: `POST /validate` and `POST /analyses` (generation quota), `GET /analyses`, `GET /analyses/:analysisId[?require=current]`, `GET /status` (read quota). GET never computes.

## 14. Limits (2-storey / 24-room scope with headroom)

| Limit | Value | Basis |
|---|---|---|
| input bytes | 2 MiB | 8760 weather samples ≈ 0.7 MB |
| zones / envelope surfaces | 200 / 1500 | maximum-24 fixture: 25 zones, ~50 surfaces |
| constructions / overrides | 32 / 500 | |
| thermal cases / solar instants | 8 / 24 | hourly design day |
| weather samples | 8760 | one year hourly |
| samples per surface | ≤ 64 | 8 × 8 grid |
| ray tests (instants × samples × occluders) | 20 M | preflighted before any ray is cast |
| exposure rows (instants × surfaces) | 12 000 | output size |
| calculation time | 10 s | deadline checked while casting |
| snapshot bytes | 9 MB | |

Predictable overflow is `ENVIRONMENTAL_RESOURCE_LIMIT` (422) from the builder/preflight, before computation, so `/validate` and `/analyses` agree.

## 15. Errors

`ENVIRONMENTAL_SOURCE_UNSUPPORTED`, `ENVIRONMENTAL_INPUT_INCOMPLETE`, `ENVIRONMENTAL_MODEL_INVALID`, `ENVIRONMENTAL_LOCATION_INVALID`, `ENVIRONMENTAL_WEATHER_INVALID`, `ENVIRONMENTAL_PROPERTY_MISSING`, `ENVIRONMENTAL_ANALYSIS_FAILED`, `ENVIRONMENTAL_ANALYSIS_TIMEOUT`, `ENVIRONMENTAL_RESULT_INVALID` (422), `ENVIRONMENTAL_RESULT_STALE` (409), `ENVIRONMENTAL_RESOURCE_LIMIT` (422). Logs carry request id, analysis id, calculator, status, duration and counts only — never weather payloads or credentials.

## 16. Numerical tolerances (per quantity)

| Quantity | Tolerance |
|---|---|
| geometry (integer mm source) | exact; areas relative 1e-12 |
| solar angles (validator PSA vs NOAA) | 0.05° |
| sun vector / cos incidence | 1e-3 absolute (algorithm difference); grazing band 1e-3 |
| sunlit fraction | one sample (1/n) |
| heat flow, totals, energy | relative 1e-9 |
| temperatures | exact transcription |

## 17. Verification strategy

Known-answer controls computed outside production code (closed forms, published solar references, PSA), adversarial inputs (prompt §43), native fixtures (V1, V2, L, setback, maximum-24, west-wing edit), revision staleness through the API, PostgreSQL concurrency/rollback/RLS, live Supabase acceptance, pgTAP, mutation testing of each critical calculation, Phase 1–24 regression, Phase 23 IFC byte identity, Docker offline acceptance, frozen-source release runner.
