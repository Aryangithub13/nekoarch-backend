# Phase 24 structural API

Base: `/api/projects/:projectId/revisions/:revisionId/structural`. All routes require `Authorization: Bearer <Supabase JWT>`; a project the caller does not own, a revision outside the project, or an analysis outside the revision returns `404`. Errors use the existing envelope `{ error: { code, message, requestId, fieldErrors? } }`. Responses carry `Cache-Control: no-store` and `x-request-id`.

| Method | Path | Quota | Purpose |
|---|---|---|---|
| POST | `/validate` | generate | Map + independently validate explicit input. No solve, no persistence. Works without the signing secret. |
| POST | `/analyses` | generate | Validate, solve, validate output, persist an immutable snapshot. `Idempotency-Key` supported. `201`. |
| GET | `/analyses?limit=1..100&cursor=` | read | Summaries for this revision, newest first, each with `currency`. |
| GET | `/analyses/:analysisId[?require=current]` | read | Full snapshot + `currency`. `require=current` → `409 STRUCTURAL_RESULT_STALE` when stale. |
| GET | `/status` | read | Structural status of this revision plus analyses of other revisions (always `STALE` here). |

Request bodies are limited to 524 288 bytes, then pass an iterative preflight (depth ≤ 24, ≤ 150 000 JSON nodes, finite numbers) before schema parsing. GET never runs analysis.

## Request: `structural-input-v1`

```json
{
  "version": "structural-input-v1",
  "materials": [{ "key": "c30", "category": "CONCRETE", "name": "Project concrete",
    "elasticModulus": { "value": 30000, "unit": "MPa" }, "poissonRatio": { "value": 0.2, "unit": "1" },
    "density": { "value": 2400, "unit": "kg/m3" }, "architecturalSpecificationId": null }],
  "sections": [{ "key": "col", "shape": "RECTANGLE", "width": { "value": 300, "unit": "mm" }, "depth": { "value": 300, "unit": "mm" } },
               { "key": "w", "shape": "GENERIC", "area": { "value": 5000, "unit": "mm2" }, "iy": { "value": 2e7, "unit": "mm4" },
                 "iz": { "value": 8e7, "unit": "mm4" }, "j": { "value": 1e6, "unit": "mm4" } }],
  "members": [{ "key": "c1", "rule": "COLUMN_AT_WALL_END", "wallId": "<wall id>", "end": "start", "material": "c30", "section": "col" },
              { "key": "b1", "rule": "BEAM_ALONG_WALL", "wallId": "<wall id>", "material": "c30", "section": "col" }],
  "supports": [{ "key": "s1", "at": { "member": "c1", "end": "start" }, "type": "CUSTOM", "restraints": ["UX", "UY", "UZ", "RX"] }],
  "autoSupports": { "rule": "BASE_OF_COLUMNS_AT_LOWEST_ELEVATION", "type": "FIXED" },
  "loadCases": [{ "key": "DEAD", "category": "DEAD", "selfWeight": true, "loads": [
    { "key": "w1", "application": "MEMBER_DISTRIBUTED", "target": { "member": "b1" }, "direction": "GLOBAL_Y", "magnitude": { "value": -10, "unit": "kN/m" } },
    { "key": "p1", "application": "POINT", "target": { "member": "b1", "end": "end" }, "direction": "GLOBAL_X", "magnitude": { "value": 5, "unit": "kN" } }] }],
  "combinations": [{ "key": "D", "profile": "PROJECT_DEFINED", "terms": [{ "loadCase": "DEAD", "factor": 1.35 }] }]
}
```

Rules: every value is user provided with a literal unit; `null` material properties are `NOT_SPECIFIED` (never filled from names or BIM labels). Keys are request-local (`[A-Za-z0-9][A-Za-z0-9._:-]{0,63}`); structural IDs are derived deterministically and are not keys. Gravity loads are negative `GLOBAL_Y` (y up). `AREA` loads are recognised and rejected as unsupported. Limits: materials 32, sections 64, members 800, supports 800, load cases 8, loads per case 1000 (2000 total), combinations 16 with ≤ 8 terms, factor non-zero and |f| ≤ 10, point load ≤ 1e5 kN, line load ≤ 1e4 kN/m, E 1–1e6 MPa, 0 ≤ ν < 0.5, density 1–30 000 kg/m³, section dimensions 1–10 000 mm.

## `POST /validate` → 200

`{ binding, readiness: "ANALYSIS_READY", model: <structural-model-v1>, validation: { validator: "structural-model-validator-v2", status: "VALID", diagnostics }, claims, limitations }`

## `POST /analyses` → 201

Summary fields plus `snapshot` (no `currency`; read it with GET so a replayed receipt can never present a stale result as current):

```text
id, projectRevisionId, acceptanceQaId, structuralModelVersion, analysisVersion, modelHash, inputHash, analysisModelHash,
solver { name, version, adapterVersion }, status: "VALIDATED", createdAt, counts { nodes, members, segments, loadCases, combinations },
snapshot { version, binding, inputHash, analysisModelHash, input, model, solver { …, settings, executionMs, warnings },
           results { units, memberForceConvention, sets[] }, validation { model, results { equilibrium[] } },
           status { analysis: "ANALYZED", validation: "VALIDATED" }, claims, limitations }
```

Result set: `{ id, kind: LOAD_CASE|COMBINATION, displacements[{nodeId, ux,uy,uz (mm), rx,ry,rz (rad)}], reactions[{nodeId, fx,fy,fz (kN), mx,my,mz (kN·m)}], memberForces[{segmentId, memberId, stations[5]{position, n,vy,vz (kN), t,my,mz (kN·m)}]}] }`. Member forces act on the positive cut face in local axes (N > 0 tension; Mz > 0 sagging for local y up; Vy is negative at the left end of a downward-loaded simply supported beam). Identical input for the same revision returns the same analysis, including under concurrency.

`claims` is always `{ designVerification: "NOT_EVALUATED", codeCompliance: "NOT_CLAIMED", certification: "NOT_CLAIMED", constructionSuitability: "NOT_CLAIMED" }`.

## Currency and status

`currency = { status: CURRENT|STALE, analysisRevisionId, projectCurrentRevisionId }`; `CURRENT` only when the analysis's revision is the project's current revision.

`GET /status` → `{ projectId, revisionId, revisionNumber, projectCurrentRevisionId, revisionCurrency: CURRENT|HISTORICAL, structuralStatus: NOT_ANALYZED|ANALYZED, requiresNewAnalysis, analyses[≤20], staleAnalyses[≤20]{…, revisionNumber, currency: STALE, staleReason: "BOUND_TO_A_DIFFERENT_REVISION"}, claims }`.

## Error codes

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` / `INVALID_REQUEST` | Schema, unit, nonfinite, oversized body, unknown query |
| 401 | `UNAUTHORIZED` | Missing/invalid session |
| 404 | `PROJECT_NOT_FOUND`, `REVISION_NOT_FOUND`, `STRUCTURAL_ANALYSIS_NOT_FOUND` | Not owned / not associated |
| 409 | `STRUCTURAL_RESULT_STALE`, `IDEMPOTENCY_CONFLICT` | |
| 422 | `REVISION_NOT_ACCEPTED`, `STRUCTURAL_SOURCE_UNSUPPORTED`, `STRUCTURAL_MODEL_INVALID`, `STRUCTURAL_MATERIAL_MISSING`, `STRUCTURAL_LOAD_INVALID`, `STRUCTURAL_SUPPORT_INVALID`, `STRUCTURAL_SYSTEM_DISCONNECTED`, `STRUCTURAL_SYSTEM_UNSTABLE`, `STRUCTURAL_SOLVER_FAILED`, `STRUCTURAL_ANALYSIS_TIMEOUT`, `STRUCTURAL_RESULT_INVALID`, `STRUCTURAL_RESOURCE_LIMIT` | Domain failures; nothing persisted |
| 429 | `RATE_LIMITED` | Quota |
| 503 | `STRUCTURAL_UNAVAILABLE` | Analysis persistence not configured (signing secret absent) |

## Audit repair amendments

New snapshots record `structural-model-validator-v2` / `structural-result-validator-v2`; historical snapshots keep the v1 label they were certified with and remain readable. Newly rejected with 422 (nothing persisted): unconnected same-plane member crossings (`STRUCTURAL_MODEL_INVALID`, on `/validate` and `/analyses`), load cases whose per-segment expansion exceeds 6000 (`STRUCTURAL_RESOURCE_LIMIT`, on both routes, previously a 500 on `/analyses`), and solver output that fails constitutive, station, J-end statics, free-DOF reaction or superposition checks (`STRUCTURAL_RESULT_INVALID`). Fully restrained systems, previously `STRUCTURAL_SUPPORT_INVALID`, are now analysed (201). Details: `docs/phase24-audit-repair/REPAIR-REPORT.md`.
