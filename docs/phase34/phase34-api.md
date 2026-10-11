# Phase 34 API — complex building verification

All routes are additive and **change nothing**: reports are computed from the stored revision on every call. The route catalog grows from 120 to 123 entries.

| Property | Value |
|---|---|
| Authentication | Supabase bearer session; anonymous → 401 |
| Foreign or unknown project/revision | 404 (also when `otherRevisionId` belongs to another project) |
| Determinism | The same revision and declared limits always give the same report and `inputHash` |
| Schemas | Zod v3 in `apps/api/src/verification/contracts.ts`; exported to [openapi.json](../modernization/openapi.json) |

`ROOT = /api/projects/:projectId/revisions/:revisionId/verification`

| Method & path | Body | Success | Notes |
|---|---|---|---|
| `GET ROOT` | — | 200 `VerificationReport` | No declared limits |
| `POST ROOT` | `{ declaredLimits?: { maxCoverageRatio? (0–1], maxFar? (0–100] } }` (multiples of 0.0001) | 200 `VerificationReport` | Declared limits are compared exactly as `DECLARED_LIMIT` checks; they are never statutory determinations |
| `POST ROOT/diff` | `{ otherRevisionId, scope: { levelIds[], entityIds[], allowSiteChange } }` | 200 `DiffReport` | `IDENTICAL`, `WITHIN_SCOPE` or `OUT_OF_SCOPE_CHANGES`, with every change and every violation |

## VerificationReport

| Field | Content |
|---|---|
| `status` | `VERIFIED`, `VERIFIED_WITH_WARNINGS` (e.g. an overhang), `PARTIAL` (something could not be evaluated exactly), `FAILED` |
| `bases` | `plotAreaMm2`, `buildableAreaMm2`, `groundCoverage { levelId, areaMm2, method }`, `levels[] { levelId, grossPlateAreaMm2, method }`, `grossFloorAreaMm2`, `netSpaceAreaMm2`, `coverageRatio`, `far` (`{ numerator, denominator, decimal, rounding: HALF_UP_4 }`), `formulas` |
| `checks[]` | `{ checkId, status, entityIds, measured, required, detail }` for `SITE_POLYGON`, `BUILDABLE_WITHIN_SITE`, `LEVEL_WITHIN_PERMITTED`, `SETBACK_DISTANCE`, `SPACE_ON_PLATES`, `UPPER_PLATE_SUPPORT`, `OPENING_WITHIN_HOST`, `DECLARED_LIMIT` |
| `budget` | `{ operations, limit: 2 000 000, exhausted }` |
| `claims` | `statutoryCompliance`, `structuralAdequacy`, `surveyAccuracy`, `constructionReadiness`: all `NOT_CLAIMED` |

Areas are exact strings in mm² (`.5` possible). `method` is `RECTILINEAR_SLAB_UNION`, `LEVEL_BOUNDARY_FALLBACK` (non-rectilinear slabs) or `LEVEL_BOUNDARY_NO_FLOOR_SLABS`.

## DiffReport

`{ diffVersion, projectId, baseRevisionId, otherRevisionId, baseModelHash, otherModelHash, status, scope, changes[], violations[], counts }`. Each change is `{ collection, entityId, change: ADDED | REMOVED | CHANGED, levelIds, inScope }`.
