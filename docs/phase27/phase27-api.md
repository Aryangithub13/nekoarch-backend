# Phase 27 API — specialized knowledge

Base: `/api/projects/:projectId/revisions/:revisionId/knowledge`.

Every route is authenticated (`Authorization: Bearer …`) and owner-only. A foreign or unknown project, revision or analysis returns **404**. Errors use the existing envelope, `{ "error": { "code", "message", "requestId" } }`, and the request id is echoed in `x-request-id`. No route calls an LLM or the network.

## `GET /packs`

Bundled catalog metadata only, sorted by `packId`. There are no rule bodies and no source text.

```jsonc
{ "packs": [ { "packId": "nekoarch-demo-coordination", "version": "1.0.0", "title": "…", "disciplines": [ … ],
    "publisher": { "name": "NekoArch (project-authored)", "kind": "PROJECT_AUTHORED" }, "jurisdiction": null, "edition": "demo-2026-10",
    "effectiveDate": null, "sourceType": "SYNTHETIC_DEMONSTRATION", "license": { "spdx": "CC0-1.0", "redistribution": "PERMITTED" },
    "checksum": "b79bb853…", "ruleCount": 15 }, … ],
  "claims": { /* 13 × NOT_CLAIMED */ } }
```

An unknown query parameter returns 400.

## Input (`specialized-knowledge-input-v1`)

```jsonc
{ "version": "specialized-knowledge-input-v1",
  "packs": [ { "packId": "nekoarch-demo-dimensional", "version": "1.0.0" } ],          // 1..8, one version per pack, bundled only
  "sources": { "structuralAnalysisId": null, "environmentalAnalysisId": null, "systemsAnalysisId": null },   // optional, explicit, same revision
  "scope": { "disciplines": ["ARCHITECTURE"] } }                                        // 1..8 of ARCHITECTURE, COST, ENVIRONMENTAL, LIFE_SAFETY, MEP, QUANTITY, STRUCTURAL, VERTICAL_TRANSPORT
```

- Objects are strict, so an unknown field (for example `jurisdiction`) returns 400.
- The body is preflighted before parsing: ≤ 16 KiB, depth ≤ 24 and a node budget. Overflow returns 422 `KNOWLEDGE_RESOURCE_LIMIT`.
- There is no inline or uploaded pack (deferred) and no "latest" source.
- Pack order and discipline order are normalised, so they don't change the analysis identity.

## `POST /validate`

Runs the input checks, pack resolution, architecture (`readBim`), the explicitly named upstream reads, `TRANSITIVE_UPSTREAM_BINDING_CONSISTENCY`, fact extraction with independent fact validation, and the rule and pair budgets. **It never evaluates a predicate and never persists.**

```jsonc
{ "binding": { … }, "readiness": "EVALUATION_READY",
  "packs": [ { "packId", "version", "checksum", "rulesTotal", "rulesSelected" } ],
  "rules": [ { "packId", "ruleId", "discipline", "predicted": "EVALUABLE | UNSUPPORTED | NOT_EVALUATED" } ],
  "facts": { "present": 232, "absent": 11, "bySource": { … } }, "conflicts": 1,
  "validation": { "validator": "specialized-knowledge-validator-v1", "status": "VALID", "diagnostics": [] }, "claims": { … }, "limitations": [ … ] }
```

## `POST /analyses`

The full pipeline:

1. facts;
2. independent fact validation;
3. evaluation;
4. independent result recomputation;
5. snapshot schema;
6. output budget (8 MiB);
7. HMAC-signed `knowledge_write`.

`201` returns the summary plus the `snapshot` (`specialized-knowledge-analysis-v1`, design §15).

- **Identity.** An identical input on the same revision converges on the same analysis id, and concurrent identical calls converge too.
- **Idempotency.** `Idempotency-Key` replays the stored response. Reusing a key with a different input returns 409 `IDEMPOTENCY_CONFLICT`.

Summary fields: `id`, `projectRevisionId`, `acceptanceQaId`, `knowledgeModelVersion`, `analysisVersion`, `modelHash`, `inputHash`, `factsHash`, `packs`, `evaluator`, `status: "VALIDATED"`, the three upstream ids, `createdAt`, and `counts { facts, results, conflicts, meets, doesNotMeet }`.

## `GET /analyses?limit=1..100&cursor=…`

Keyset pagination on `(createdAt desc, id desc)`. A malformed cursor returns 400. Each item carries `currency { status: CURRENT | STALE, analysisRevisionId, projectCurrentRevisionId }`.

## `GET /analyses/:analysisId[?require=current]`

Returns the detail with `currency`. With `require=current`, a superseded revision returns **409** `KNOWLEDGE_RESULT_STALE`. Any other value of `require` returns 400. An analysis is never served through another revision's URL (404).

## `GET /status`

Analyses of this revision, plus `staleAnalyses` of other revisions with `staleReason: BOUND_TO_A_DIFFERENT_REVISION`, plus `knowledgeStatus` (`EVALUATED | NOT_EVALUATED`) and `requiresNewAnalysis`. Never computes.

## Errors

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | malformed body, unknown field, wrong version, empty packs, bad query or cursor |
| 401 | — | anonymous |
| 404 | `PROJECT_NOT_FOUND`, `REVISION_NOT_FOUND`, `KNOWLEDGE_ANALYSIS_NOT_FOUND`, upstream `*_ANALYSIS_NOT_FOUND` | foreign, unknown, other-revision or other-project ids |
| 409 | `KNOWLEDGE_RESULT_STALE`, `IDEMPOTENCY_CONFLICT` | stale `require=current`; key reuse |
| 422 | `KNOWLEDGE_PACK_UNKNOWN` | pack or version not bundled |
| 422 | `TRANSITIVE_UPSTREAM_BINDING_INCONSISTENT` | a bound systems analysis references another structural or environmental analysis than the one bound |
| 422 | `KNOWLEDGE_RESOURCE_LIMIT` | input, rule (512), result (6,000), conflict-pair (100,000), conflict (1,000) or output (8 MiB) budget |
| 422 | `KNOWLEDGE_SOURCE_UNSUPPORTED` | revision outside the bounded BIM profile |
| 422 | `KNOWLEDGE_MODEL_INVALID`, `KNOWLEDGE_RESULT_INVALID` | an independent validator rejected the facts or the evaluator output |
| 422 | `REVISION_NOT_ACCEPTED` | no accepted QA evidence |
| 503 | `KNOWLEDGE_UNAVAILABLE` | signer or persistence not configured |

Messages never contain secrets, stack traces or other tenants' identifiers.
