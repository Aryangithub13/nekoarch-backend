# Phase 35 API: engineering assessment

Both routes are additive and **change nothing**. The report is computed from the stored revision, the current brief and the request on every call. The route catalog grows from 123 to 125 entries.

| Property | Value |
|---|---|
| Authentication | Supabase bearer session; anonymous → 401 |
| Foreign or unknown project/revision | 404 |
| Body | `POST` ≤ 64 KiB. Larger bodies get the app's uniform `400 INVALID_REQUEST`. Unknown fields → `400 VALIDATION_ERROR`. |
| Evidence reference not a live reference of this project | `422 ASSESSMENT_EVIDENCE_NOT_FOUND` |
| Stored identity differs from the model | `422 VERIFICATION_SOURCE_MISMATCH` (Phase 34 loader) |
| Determinism | The same revision, brief, related-service state and request always give the same `inputHash` and `resultHash`; only `generatedAt` differs |
| Rate limiting | `POST` is charged to the `write` group, like the other compute-on-read POST routes |
| Schemas | Zod v3 in `apps/api/src/engineering/contracts.ts`, exported to [openapi.json](../modernization/openapi.json) |
| Discovery | `GET /api/capabilities` lists `ENGINEERING_ASSESSMENT`, version `engineering-assessment-v1`, persistence `DERIVED_ON_READ` |

`ROOT = /api/projects/:projectId/revisions/:revisionId/engineering-assessment`

| Method & path | Body | Success |
|---|---|---|
| `GET ROOT` | (none; no query parameters) | 200 `AssessmentReport` with no declared inputs |
| `POST ROOT` | `AssessmentRequest` (all fields optional) | 200 `AssessmentReport` |

## AssessmentRequest

| Field | Content |
|---|---|
| `scope` | Subset of the 17 domains; default all. Cost is computed only when `PRELIMINARY_COST` is in scope. |
| `declared` | `heightMm?` (integer mm), `heightToleranceMm` (default 0), `storeys?`, each compared exactly with the model |
| `jurisdiction` | `{ country: 'IN' \| …(ISO alpha-2), subdivision?, locality? }` |
| `occupancy` | `{ primary: RESIDENTIAL \| OFFICE \| HOTEL \| RETAIL \| MIXED_USE \| INSTITUTIONAL \| INDUSTRIAL \| OTHER }` |
| `structuralSystem` | `{ primaryMaterial: REINFORCED_CONCRETE \| STRUCTURAL_STEEL \| COMPOSITE \| TIMBER \| MASONRY \| OTHER, description? }` |
| `evidence[]` (≤ 16) | `{ kind: GEOTECHNICAL_INVESTIGATION \| WIND_TUNNEL_STUDY \| SITE_SPECIFIC_SEISMIC_HAZARD \| STRUCTURAL_DESIGN_BASIS \| FIRE_STRATEGY \| TOPOGRAPHIC_SURVEY, referenceId? \| citation? }` |
| `cost` | `{ currency: INR \| USD \| EUR, priceBasisDate?, components[1..64], adjustments[0..16], excludedScopes[0..16] }`; see [design §7](phase35-design.md#7-conceptual-cost-conceptual-cost-v1) |

Text is NFKC-normalized with control characters removed. Rates and adjustment values are exact decimals (`^(0|[1-9]\d{0,11})(\.\d{1,6})?$`), and percentages may not exceed 100. Dates are real calendar dates (`YYYY-MM-DD`). Component codes, adjustment codes, adjustment orders and excluded scopes must be unique. A scope cannot be both priced and excluded.

## AssessmentReport

| Field | Content |
|---|---|
| `assessmentVersion`, `engine` | `engineering-assessment-v1`; verifier, source-registry and formula versions |
| `projectId`, `revisionId`, `modelHash`, `inputHash`, `resultHash`, `generatedAt` | Identity and audit |
| `context` | Brief version, hash and floors; declared jurisdiction, occupancy and structural system; `provenance: USER_DECLARED_NOT_VERIFIED` |
| `consistency` | `CONSISTENT`, `PARTIAL` (something not evaluated) or `INCONSISTENT` (an exact check failed) |
| `height` | `storeyCount`, `lowestStoreyElevationMm`, `topOfUppermostStoreyMm`, `heightMm`, `storeyHeights { minMm, maxMm, distinctMm }`, `storeys[] { levelId, index, elevationMm, storeyHeightMm, storeyHeightBasis, grossPlateAreaMm2, plateMethod }`, `statutoryHeight: NOT_EVALUATED` |
| `areas` | `grossFloorAreaMm2` (exact), `grossFloorAreaM2`, `plotAreaMm2`, `netSpaceAreaMm2`, `far`, `coverageRatio`, `grossVolumeMm3` (exact), `grossVolumeM3`, `formulas` |
| `baseGeometry` | `levelId`, `hullVertices`, `minimumWidthMm`, `heightToMinimumWidth { decimal, rounding: FLOOR_4 }`, `formula` |
| `verification` | Phase 34 status, summary, input hash and route for this revision |
| `findings[]` | `{ findingId, domain, status: PASS \| FAIL \| WARNING \| NOT_EVALUATED \| INFO, entityIds, measured, required, detail }` |
| `domains[]` | `{ domain, assuranceLevel, status, blockers[] { kind, code, detail, inputPath, sourceIds }, relatedServices[] { serviceId, route, artifactsForRevision, note } }` |
| `summary` | Count of in-scope domains per status |
| `requirements[]` | `{ inputPath, detail, neededFor[] }`: the actionable missing inputs and input conflicts |
| `sources[]` | Candidate documents referenced by blockers; each `NOT_VERIFIED`, `IDENTIFICATION_ONLY`, with no edition |
| `evidence[]` | Declared evidence; referenced ones carry `{ purpose, mediaType, storedSha256, boundRevisionId }`; `contentInterpreted: false` |
| `cost` | `null`, or `CostReport { status: COMPLETE \| PARTIAL \| BLOCKED, blockedReasons, lines[], baseSubtotal, adjustments[], pricedTotal, completeTotal, taxBasis, scopes[], evidenceClasses, warnings, assumptions, claims }` |
| `limitations`, `claims` | `structuralSafety`, `codeCompliance`, `statutoryApproval`, `professionalCertification`, `constructionReadiness`: all `NOT_CLAIMED` |

### Example (abridged): 163-storey concept, India, all context declared

```json
{ "consistency": "CONSISTENT", "height": { "storeyCount": 163, "heightMm": 834560, "statutoryHeight": "NOT_EVALUATED" },
  "baseGeometry": { "minimumWidthMm": 30000, "heightToMinimumWidth": { "decimal": "27.8186", "rounding": "FLOOR_4" } },
  "domains": [
    { "domain": "WIND_LOADS", "status": "REQUIRES_SOURCE_VERIFICATION", "blockers": [
      { "kind": "SOURCE_NOT_VERIFIED", "code": "CANDIDATE_SOURCE_NOT_VERIFIED", "sourceIds": ["IN-BIS-IS875-3", "IN-BIS-IS16700"] },
      { "kind": "NO_VALIDATED_SOLVER", "code": "NO_WIND_RESPONSE_METHOD" },
      { "kind": "PROFESSIONAL_REVIEW", "code": "QUALIFIED_ENGINEER_REVIEW" } ] },
    { "domain": "MEMBER_DESIGN", "status": "UNSUPPORTED" } ],
  "claims": { "structuralSafety": "NOT_CLAIMED", "codeCompliance": "NOT_CLAIMED" } }
```
