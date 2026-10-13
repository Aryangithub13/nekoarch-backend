# Phase 39 API — design concepts and capability-typed provider routing

Scope, acceptance criteria and open questions are in [phase39-scope.md](phase39-scope.md). Schemas are in `apps/api/src/contracts/design-concepts.ts` and in the generated `docs/modernization/openapi.json`.

All routes need a bearer session and are owner-only. Another user's project gives `404 PROJECT_NOT_FOUND`, and a revision of another project gives `404 REVISION_NOT_FOUND`.

## Routes

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/projects/:projectId/revisions/:revisionId/design-concepts` | Create a concept set, or replay the stored set for an identical request |
| `GET` | `/api/projects/:projectId/revisions/:revisionId/design-concepts` | List sets of the revision (keyset: `limit` 1–100, `cursor`) |
| `GET` | `/api/projects/:projectId/revisions/:revisionId/design-concepts/:conceptSetId` | Read one set; `?require=current` gives 409 on a superseded revision |

`POST` is in the `generate` rate-limit group, and its body limit is `SMALL_BODY_LIMIT_BYTES`.

## Request

| Field | Type | Default | Notes |
|---|---|---|---|
| `scope` | `INTERIOR` \| `EXTERIOR` | required | |
| `text` | string, ≤ 1,000 chars after normalization | none | The caller's direction. It is data only: NFKC-normalized, with control and format characters removed and whitespace collapsed. |
| `alternatives` | 1–3 | 2 | Exactly this many alternatives are returned; a provider returning another count is refused. |
| `spaceIds` | ≤ 12 space ids | the first 12 spaces in storey order | `INTERIOR` only. Every id must exist in the revision (`422 DESIGN_CONCEPT_SPACE_INVALID`). |
| `useBrief` | boolean | `true` | Consume the current Phase 33 brief, if one exists. |
| `referenceIds` | ≤ 8 uuids | `[]` | Must be active references of this project (`422 DESIGN_CONCEPT_REFERENCE_INVALID`). Used as metadata only. |
| `generator` | `AUTO` \| `PROVIDER` \| `TEMPLATE` | `AUTO` | See below. |
| `variation` | 0–99 | 0 | Part of the input identity. Change it to ask for new alternatives, since identical requests replay. |

Unknown fields are refused (`400 VALIDATION_ERROR`). A caller can never name a provider, model, endpoint, key or instructions.

### Generators

| Generator | Behaviour |
|---|---|
| `TEMPLATE` | The deterministic templates only (`design-concept-templates-v1`). No provider call is made, and the output is byte-stable. |
| `PROVIDER` | The configured providers only. If no route succeeds, the response is `503 DESIGN_CONCEPT_PROVIDER_UNAVAILABLE`, with `fieldErrors.failures` listing the typed failure codes. A template is never substituted. |
| `AUTO` | The configured providers first. If none succeeds, it falls back to the templates, but only when the operator policy has `deterministicFallback: true` (the default). The fallback is labelled `source: DETERMINISTIC_TEMPLATE`, with `provenance.status: FALLBACK`, `fallbackReason` and `failures`. |

## Response (`DesignConceptDetail`)

**Status codes:**
- **`201`:** a new set was created.
- **`200`:** a stored set was replayed (`replayed: true`) and nothing was generated.

**Top-level fields:**
- the summary columns: `id`, `projectRevisionId`, `scope`, `source`, `providerId`, `modelId`, `alternativeCount`, `modelHash`, `inputHash`, `contentHash` and `createdAt`;
- `currency`: `CURRENT` or `HISTORICAL`, evaluated at read time;
- `conceptSet`.

**`conceptSet` fields:**

| Field | Content |
|---|---|
| `binding` | Project, revision, revision number, recomputed model hash, acceptance QA id and status |
| `request` | The normalized request, exactly as hashed |
| `inputs.context` | Phase 33 `contextVersion` and `contextHash` at generation time (for citation; not part of the input identity) |
| `inputs.brief` | `version`, `briefHash`, `provenance: USER_STATED_NOT_VERIFIED`, `fieldsUsed`, `fieldsWithheld` (`site.address`, `site.plot`, `program.counts`, `budget`), or `null` |
| `inputs.references` | Reference id, purpose, display name, media type, `storedSha256`, `contentUsed: METADATA_ONLY` |
| `inputs.spaces` | The spaces considered (`INTERIOR`) |
| `inputs.identity` | What `inputHash` is computed over: version, revision, model hash, normalized request, brief hash, and reference ids with their stored hashes |
| `alternatives[]` | See below |
| `provenance` | Generator, status (`SUCCESS` / `FALLBACK` / `TEMPLATE`), capability, request id, provider id, model id, routing reason, fallback position, fallback reason, failures, attempts (with integer latency and usage, the cost estimate in integer micro-USD), template version and guard version. It never includes prompts, payload text, credentials or endpoints. |
| `assurance` | `{ status: 'ADVISORY_UNVERIFIED', note }` |
| `claims` | `dimensionalAccuracy`, `engineeringValidity`, `structuralSafety`, `codeCompliance`, `costAccuracy`, `constructionReadiness` and `professionalCertification`, always `NOT_CLAIMED` |
| `limitations` | Fixed statements of what the set is not |

**Interior alternative:** `title`, `summary`, `styleKeywords`, `palette` (2–6 colours, each with a role, `#rrggbb` and a name), `finishes` (`floor`, `walls` and `ceiling`, as descriptions), `lighting` (character only), `spaces` (≤ 8 notes on the revision's own spaces) and `basis` (the brief fields and reference ids actually used).

**Exterior alternative:** the same common fields, plus:
- `facadeFinish`: a Phase 30 preset id and label, facades, rationale, and `appearanceOnly: true`;
- `landscapeNote`;
- `proposedOperation`: `{ status: 'NOT_EXECUTED', submitTo: '/api/projects/:projectId/revision-operations', request }`.

`proposedOperation.request` is a Phase 30 preflight request: an `APPEARANCE_MODIFY` operation on exterior walls, preserving building geometry, dimensions, floor plans, structure, stairs, openings, walls, rooms and interior.

**This phase never executes it.** Submitting it runs Phase 30's own preflight, QA, consent and approval.

## Errors specific to Phase 39

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | The body or query is malformed or has unknown fields |
| 404 | `DESIGN_CONCEPT_NOT_FOUND` | The set id does not belong to the revision |
| 409 | `DESIGN_CONCEPT_READ_INCONSISTENT` | The project's current revision changed between the context read and the revision read; retry |
| 409 | `DESIGN_CONCEPT_SOURCE_STALE` | `?require=current` on a superseded revision |
| 422 | `DESIGN_CONCEPT_SOURCE_UNVERIFIED` | The revision identity or its acceptance QA cannot be verified (the Phase 37/38 checks) |
| 422 | `DESIGN_CONCEPT_SPACE_INVALID`, `DESIGN_CONCEPT_NO_SPACES`, `DESIGN_CONCEPT_NO_EXTERIOR_WALLS`, `DESIGN_CONCEPT_REFERENCE_INVALID` | The request does not fit the revision or the project |
| 422 | `DESIGN_CONCEPT_INPUT_TOO_LARGE` | `PROVIDER` only: the bounded payload exceeds the context budget (12,000 bytes) |
| 422 | `DESIGN_CONCEPT_INVALID` | The SQL write refused the set's provenance (a server defect or tampering) |
| 429 | `DESIGN_CONCEPT_QUOTA_EXCEEDED` | 50 provider-sourced sets in the owner's last 24 hours (`AUTO` falls back to templates instead, unless fallback is disabled) |
| 503 | `DESIGN_CONCEPT_PROVIDER_UNAVAILABLE` | No configured provider produced an acceptable concept, with `fieldErrors.failures` |
| 503 | `DESIGN_CONCEPTS_UNAVAILABLE` | `PROJECT_COMMIT_SECRET` or persistence is not configured |

Typed provider failure codes, from Phase 21 plus one new code:
- `PROVIDER_DISABLED`, `MODEL_UNAVAILABLE`, `CAPABILITY_UNSUPPORTED`;
- `PROVIDER_TIMEOUT`, `PROVIDER_RATE_LIMITED`, `PROVIDER_AUTH_FAILED`, `PROVIDER_UNAVAILABLE`;
- `PROVIDER_RESPONSE_INVALID`, `PROVIDER_RESPONSE_TOO_LARGE`, `PROVIDER_SCHEMA_VIOLATION`, `PROVIDER_POLICY_REJECTED`;
- `PROVIDER_OUTPUT_UNSAFE` (new): the guard refused text asserting compliance, certification, approval, structural adequacy, safety or readiness, or text containing dimensions, quantities, percentages or prices.

## Operator configuration

No provider is enabled by default, and none is required: `TEMPLATE` and `AUTO` work with the default configuration. Concepts use the same server-owned `AI_ROUTING_CONFIG` as Phase 21. A provider and model serve concepts only if both list `INTERIOR_DESIGN_CONCEPT` and/or `EXTERIOR_DESIGN_CONCEPT`. `AI_CONVERSATION_MODE=disabled` turns provider inference off for concepts too.

Local, OpenAI-compatible endpoint on numeric loopback (no credentials):

```json
{
  "providers": [{
    "providerId": "local-main", "type": "LOCAL_OPENAI_COMPATIBLE", "enabled": true,
    "endpoint": "http://127.0.0.1:11434/v1/chat/completions",
    "capabilities": ["ARCHITECTURAL_INTENT_EXTRACTION", "INTERIOR_DESIGN_CONCEPT", "EXTERIOR_DESIGN_CONCEPT"],
    "timeoutMs": 10000,
    "models": [{ "modelId": "configured-local-model", "capabilities": ["INTERIOR_DESIGN_CONCEPT", "EXTERIOR_DESIGN_CONCEPT"], "maxOutputTokens": 4096 }]
  }]
}
```

### Remote endpoints

A remote endpoint needs all of the following:
- `type: REMOTE_OPENAI_COMPATIBLE`;
- an exact `https://<host>/v1/chat/completions` endpoint, with the host in `allowedRemoteHosts`;
- `privacyClass: REMOTE_ALLOWED` on the policy **and** the model, because concepts send the user's text, brief excerpts and space names;
- for a metered model, `costClass: METERED` with `allowMetered: true`, plus optional `inputUsdPerMillion` and `outputUsdPerMillion` for an estimate.

The key goes in the server environment as `AI_PROVIDER_<NAME>_API_KEY`, referenced by `apiKeyEnv`. It is sent only as the `Authorization` header.

### Process-local limits

Health, circuits, concurrency and request-rate limits are process-local, per AI module instance. The conversation module and the concept module each enforce the configured per-provider limits.

## Not provided

- Images, renders, panoramas, video or 3D output.
- OCR or analysis of reference contents.
- Geometry, dimensions, quantities, costs or engineering statements.
- Automatic execution of the proposed appearance operation.
- Workflow `INTERIOR_DESIGN` / `EXTERIOR_DESIGN` outputs, which stay unavailable.
- Distributed rate limits or a billing ledger.
