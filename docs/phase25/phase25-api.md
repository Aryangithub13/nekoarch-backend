# Phase 25 API — environmental analysis

Base: `/api/projects/:projectId/revisions/:revisionId/environmental`. Every route requires a Supabase session; another user's project, a foreign revision or an unknown analysis is `404` (never `403`, no identifiers echoed). Request bodies are limited to 2 MiB and pre-checked for size, depth, node count and finite numbers before schema parsing.

| Method | Path | Quota | Effect |
|---|---|---|---|
| `POST` | `/validate` | generation | Builds and independently validates the environmental model and resolves the analysis input (weather checks, local→UTC conversion, ray budget). Never calculates, never persists. |
| `POST` | `/analyses` | generation | Calculates, validates the untrusted calculator output independently, persists an immutable signed snapshot. Idempotent (`Idempotency-Key`), and identical inputs converge on one row. |
| `GET` | `/analyses?limit=&cursor=` | read | Page of summaries (newest first) with `currency`. |
| `GET` | `/analyses/:analysisId[?require=current]` | read | Full snapshot with `currency`; `require=current` on a superseded revision → `409 ENVIRONMENTAL_RESULT_STALE`. |
| `GET` | `/status` | read | `environmentalStatus`, `requiresNewAnalysis`, this revision's analyses and other revisions' analyses as `STALE` (`BOUND_TO_A_DIFFERENT_REVISION`). |

GET routes never compute.

## Request (`environmental-input-v1`)

```jsonc
{
  "version": "environmental-input-v1",
  "location": { "latitude": { "value": 12.97, "unit": "deg" }, "longitude": { "value": 77.59, "unit": "deg" }, "timezone": "Asia/Kolkata", "provenance": "USER_PROVIDED" } | null,
  "orientation": { "northMilliDegrees": 0, "convention": "NORTH_FROM_MINUS_Z_CLOCKWISE_TO_PLUS_X", "provenance": "USER_PROVIDED" } | null,
  "constructions": [{ "key": "wall-a", "name": "…", "uValue": { "value": 0.5, "unit": "W/(m2*K)" },
                      "provenance": { "kind": "USER_PROVIDED" | "VERSIONED_LIBRARY" | "EXTERNAL_DATASET", "reference": null, "version": null } }],
  "assignments": { "EXTERIOR_WALL": "wall-a", "WINDOW": "…", "DOOR": "…", "OPENING": "…", "ROOF": "…", "GROUND_FLOOR": "…" },   // all optional
  "overrides": [{ "source": { "collection": "walls" | "openings" | "slabs", "id": "…" }, "construction": "…" }],
  "thermalCases": [{ "key": "winter", "inside": { "value": 21, "unit": "degC" },
                     "outside": { "kind": "CONSTANT", "temperature": { "value": 1, "unit": "degC" } } | { "kind": "WEATHER" },
                     "ground": { "value": 10, "unit": "degC" } | null, "durationHours": { "value": 24, "unit": "h" } | null }],
  "solarInstants": [{ "key": "am", "localDateTime": "2026-03-20T09:00" }],
  "weather": null | { "version": "environmental-weather-v1", "provenance": { "source", "datasetId", "datasetVersion", "synthetic": true, "license", "station": { "name", "latitude", "longitude" } },
                      "timezone": "Asia/Kolkata", "intervalMinutes": 60, "units": { "dryBulb": "degC", "directNormalIrradiance": "W/m2" },
                      "samples": [{ "timestamp": "2026-01-01T05:30:00+05:30", "dryBulb": 18.2, "directNormalIrradiance": 0 }], "sha256": "<digest(samples)>" }
}
```

Absolute temperatures are accepted in `degC` only (−90…70); Kelvin and Fahrenheit are rejected (400). U-values must be `W/(m2*K)`, > 0 and ≤ 20. Library and dataset values need a reference and a version. Nothing is defaulted: without location or orientation the affected capabilities are `INPUT_INCOMPLETE`.

## Responses

`/validate` → `{ binding, readiness: "ANALYSIS_READY", capabilities: { solar, exposure, thermal, daylightIndicator }, model: <environmental-model-v1>, validation: { validator: "environmental-model-validator-v1", status, diagnostics }, claims, limitations }`.

`/analyses` (201) and `/analyses/:id` → summary `{ id, projectRevisionId, acceptanceQaId, environmentalModelVersion, analysisVersion, modelHash, inputHash, analysisInputHash, calculator: { name: "nekoarch-reference-environmental", version: "1.0.0", adapterVersion: "environmental-adapter-v1" }, status: "VALIDATED", createdAt, counts: { zones, surfaces, solarInstants, thermalCases } }` plus `snapshot`:

```
snapshot { version, binding, inputHash, analysisInputHash, input, model, calculator { …, settings, executionMs },
           results { solar, exposure, thermal, daylightIndicator, weather }, validation { model, results { solarMaxDeviation } },
           status { analysis: ANALYZED, validation: VALIDATED }, claims { energyEfficiency … certification: NOT_CLAIMED }, limitations }
```

Reads add `currency: { status: CURRENT | STALE, analysisRevisionId, projectCurrentRevisionId }`. Units are explicit on every value (m², W, kW, Wh, kWh, K, W/m², deg, h).

## Errors

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Schema violation (unknown field, wrong unit literal, non-finite number, Kelvin input), oversized body |
| 401 | `UNAUTHORIZED` | No session |
| 404 | `PROJECT_NOT_FOUND`, `REVISION_NOT_FOUND`, `ENVIRONMENTAL_ANALYSIS_NOT_FOUND` | Not owned, foreign or unknown |
| 409 | `ENVIRONMENTAL_RESULT_STALE`, `IDEMPOTENCY_CONFLICT` | Superseded revision with `require=current`; key reused with another body |
| 422 | `REVISION_NOT_ACCEPTED`, `ENVIRONMENTAL_SOURCE_UNSUPPORTED`, `ENVIRONMENTAL_INPUT_INCOMPLETE`, `ENVIRONMENTAL_MODEL_INVALID`, `ENVIRONMENTAL_LOCATION_INVALID`, `ENVIRONMENTAL_WEATHER_INVALID`, `ENVIRONMENTAL_PROPERTY_MISSING`, `ENVIRONMENTAL_ANALYSIS_FAILED`, `ENVIRONMENTAL_ANALYSIS_TIMEOUT`, `ENVIRONMENTAL_RESULT_INVALID`, `ENVIRONMENTAL_RESOURCE_LIMIT` | Domain failures; nothing persisted |
| 429 | `RATE_LIMITED` | Quota |
| 503 | `ENVIRONMENTAL_UNAVAILABLE` | Signing secret or persistence not configured |

Errors carry `requestId`; 500 bodies are redacted.
