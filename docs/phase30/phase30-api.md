# Phase 30 API — selective revision & regeneration

All routes are additive. The route catalog grows from 81 to 94 entries ([api-routes.json](../modernization/api-routes.json)).

| Property | Value |
|---|---|
| Authentication | Supabase bearer session; anonymous → 401 |
| Foreign or unknown project/operation | 404 (RLS plus owner checks in every `SECURITY DEFINER` function) |
| Writes | Signed (HMAC envelope bound to user, route template, exact input and idempotency context) and re-validated in SQL |
| Idempotency | `Idempotency-Key` on preflight, execute, approve, reject and cancel. A replay returns the identical stored response; a reused key with a different body → 409 `IDEMPOTENCY_CONFLICT`. |
| Rate-limit groups | Preflight and execute are charged to the `generate` quota; other writes to `write`; reads to `read` |
| Schemas | Zod v3 in `apps/api/src/revision/contracts.ts` and `apps/api/src/lib/revision-repository.ts`; exported to [openapi.json](../modernization/openapi.json) |

`ROOT = /api/projects/:projectId/revision-operations`

| Method & path | Body | Success | Notes |
|---|---|---|---|
| `POST ROOT` | `PreflightRequest`: `{ baseRevisionId, request: { text } \| { operation: StructuredOperation } }` (≤ 32 KiB, text ≤ 2 000 chars) | 201 `OperationDetail` | Deterministic preflight; no compile, no external call. The base must be the current accepted revision (409 `REVISION_CONFLICT` otherwise). Status: `AWAITING_CONSENT \| NEEDS_CLARIFICATION \| UNSUPPORTED \| BLOCKED_BY_LOCK`. 429 `REVISION_LIMIT_EXCEEDED` beyond 5 active or 60/hour operations per project. |
| `GET ROOT?limit&cursor` | — | 200 `{ items: OperationSummary[], nextCursor }` | Newest first, cursor-paginated |
| `GET ROOT/:operationId` | — | 200 `OperationDetail` | Includes the stored preflight, validation, failure and candidate summary. `status` shows `EXPIRED` once `expiresAt` (24 h) has passed. |
| `POST ROOT/:operationId/execute` | `{ preflightHash, consent: { acceptLocks: true, acceptQuote: true } }` | 200 `OperationDetail` (`CANDIDATE_READY`) | Consent must match the stored preflight (409 `REVISION_CONSENT_MISMATCH`). See execute errors below. |
| `POST ROOT/:operationId/approve` | `{ preflightHash, candidateHash }` | 201 `{ operation, commit: RevisionCommitResponse }` | The `candidateHash` must be the one reviewed (409 `REVISION_CONSENT_MISMATCH`). See approve errors below. |
| `POST ROOT/:operationId/reject` | `{}` | 200 `OperationDetail` (`REJECTED`) | Only from `CANDIDATE_READY` |
| `POST ROOT/:operationId/cancel` | `{}` | 200 `OperationDetail` (`CANCELLED`) | From `AWAITING_CONSENT` or `CANDIDATE_READY` |
| `GET ROOT/:operationId/comparison` | — | 200 `RevisionComparison` | Appearance, restore or no-candidate variant |
| `GET ROOT/:operationId/validation` | — | 200 `ValidationEvidence` | Validation, locks, verifications and the audit events |
| `GET ROOT/:operationId/candidate/manifest` | — | 200 `{ acceptance, operation, artifact, manifest }` | `acceptance = CANDIDATE_PREVIEW_NOT_ACCEPTED` until committed; header `X-Candidate-Status: UNACCEPTED`. Never 304. |
| `GET ROOT/:operationId/candidate/glb` | — | 200 `model/gltf-binary` | `X-Candidate-Status`, private no-store, SHA-256 ETag; gzip and authenticated 304 as for Phase 29 assets |
| `GET /api/projects/:projectId/revisions/:revisionId/appearance` | — | 200 `AppearanceResponse` | `status: APPEARANCE_VARIANT \| DEFAULT_PLACEHOLDER`, appearance, artifact, manifest, `lineage { operation, modelEquivalentToBase }` |
| `GET …/revisions/:revisionId/appearance/glb` | — | 200 `model/gltf-binary` | The accepted revision's appearance scene; 404 when the revision has the default appearance |

**Execute errors.** Every failure records an operation status where one applies; none creates a candidate or a revision.

| Status | Code | Operation state afterwards |
|---|---|---|
| 409 | `REVISION_BASE_STALE` | Recorded as `STALE_BASE`; checked before compiling |
| 422 | `REVISION_VALIDATION_FAILED` | `VALIDATION_FAILED` |
| 422 | Typed refusal (e.g. `SCENE_UNSUPPORTED_MODEL`) | `FAILED` |
| 503 | `REVISION_WORKER_FAILED` / `REVISION_WORKER_TIMEOUT` | `FAILED` |
| 503 | `REVISION_QUEUE_FULL` / `REVISION_UNAVAILABLE` | Stays `AWAITING_CONSENT` (retryable) |

**Approve errors.** All are refused in one transaction; nothing is partially committed.

| Status | Code | Meaning |
|---|---|---|
| 409 | `REVISION_BASE_STALE` | The base moved; recorded as `STALE_BASE` |
| 409 | `REVISION_OPERATION_ALREADY_COMMITTED` | The operation was already committed |
| 409 | `REVISION_OPERATION_INVALID_STATE` | The operation is not a ready candidate |
| 409 | `REVISION_OPERATION_EXPIRED` | The operation expired |
| 422 | `REVISION_LOCK_VIOLATION` | The committed model differs from the base/source model |
| 422 | `BLUEPRINT_QA_FAILED` | Independent QA rejected the model |

**Structured operation** (frontend composer, F26):

```json
{ "kind": "APPEARANCE_MODIFY",
  "target": { "kind": "EXTERIOR_WALLS", "facades": ["SOUTH"], "levelIds": null },
  "finish": { "presetId": "glass-inspired-blue-grey", "rgbThousandths": [330,420,500], "roughnessThousandths": 180, "metallicThousandths": 600 },
  "preserve": [{ "scope": "FLOOR_PLANS" }, { "scope": "LEVEL", "levelId": "level:ground" }] }
{ "kind": "RESTORE", "sourceRevisionId": "<uuid of an accepted revision of this project>" }
```

- **Presets:** `glass-inspired-blue-grey`, `dark-contemporary`, `warm-render`, `light-stone`.
- **Overrides** are integer thousandths. The finish is always opaque: a wall is never rendered transparent.

**Discovery and integration (additive):**
- `/api/capabilities` lists service `SELECTIVE_REVISION` and media `APPEARANCE_VARIANT_3D_MODEL`.
- The project overview adds `appearance` and `lineage`.
- The conversation tool `PLAN_REVISION { text }` returns the same preflight read-only (`persisted: false`).

**Unchanged:** every Phase 1–29 route and contract, including `/revisions/:revisionId/scene/*`. Phase 29 scenes still compile only accepted revisions with the placeholder appearance and the identical bytes.

**Example (primary flow):**
1. `POST ROOT` with the text *"Redesign the exterior … using a contemporary glass-inspired façade. Keep the exact floor plans, internal rooms, stairs, structure, building dimensions, and existing interior unchanged."* → `AWAITING_CONSENT`, with the exterior wall targets and locks.
2. `POST …/execute` with consent → `CANDIDATE_READY`.
3. `GET …/comparison` → `modelIdentical: true`, `geometryIdentical: true`.
4. `POST …/approve` → revision B.
5. `POST ROOT` with *"Restore revision 1"* → execute → approve → revision C.
