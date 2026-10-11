# Phase 31 API — secure reference ingestion & artifact lifecycle

All routes are additive. The route catalog grows from 94 to 104 entries ([api-routes.json](../modernization/api-routes.json)).

| Property | Value |
|---|---|
| Authentication | Supabase bearer session; anonymous → 401. Exception: `GET /api/reference-downloads?token=`, authorized by the signed token alone. |
| Foreign or unknown project/reference | 404 (RLS plus owner checks in every `SECURITY DEFINER` function) |
| Writes | Signed (HMAC envelope bound to user, route template, exact input and idempotency context) and re-validated in SQL; SQL re-hashes uploaded bytes |
| Idempotency | `Idempotency-Key` on upload and delete. A replay returns the identical stored response; a reused key with a different body → 409 `IDEMPOTENCY_CONFLICT`. |
| Rate-limit groups | Upload and `/validate` → `generate` quota; other writes → `write`; reads → `read`; the token download → per-IP only |
| Schemas | Zod v3 in `apps/api/src/references/contracts.ts`; exported to [openapi.json](../modernization/openapi.json) |
| Body size | Uploads ≤ 10 MiB (`REFERENCE_LIMITS.maxBytes`); larger → 400 `INVALID_REQUEST` (the existing 413 mapping) |

`ROOT = /api/projects/:projectId/references`, `ITEM = ROOT/:referenceId`

| Method & path | Body | Success | Notes |
|---|---|---|---|
| `POST ROOT/validate` | Raw bytes; `Content-Type` one of `image/png`, `image/jpeg`, `image/webp`, `application/pdf` | 200 `{ report: InspectionReport, stored: false }` | Inspection only: nothing is stored, nothing is audited. 415 `REFERENCE_TYPE_UNSUPPORTED` for other types. |
| `POST ROOT?purpose&displayName&note&revisionId` | Raw bytes, as above | 201 `ReferenceDetail`, or 200 with `deduplicated: true` | `purpose`: `SITE_PHOTO \| SITE_PLAN \| SKETCH \| INSPIRATION \| DOCUMENT \| OTHER`. A file that fails inspection → 422 `REFERENCE_REJECTED`, `fieldErrors: { <FINDING_CODE>: [detail] }`; it is audited by hash only. 429 `REFERENCE_LIMIT_EXCEEDED` beyond 50 references, 200 MiB or 30 attempts/hour per project. 404 `REVISION_NOT_FOUND` when `revisionId` is not a revision of this project. 503 `REFERENCE_WORKER_*` with `Retry-After` when the inspection pool is saturated or fails. |
| `GET ROOT?limit&cursor&status&purpose&revisionId` | — | 200 `{ items: ReferenceItem[], nextCursor }` | Newest first, cursor-paginated. `status` defaults to `ACTIVE`; `ALL` includes archived and deleted tombstones. |
| `GET ROOT/usage` | — | 200 `ReferenceUsage` | Counts, stored bytes, attempts in the last hour, limits, supported types, `malwareScan: NOT_PERFORMED` |
| `GET ITEM` | — | 200 `ReferenceDetail` | Summary, currency, provenance (inspection report) and the latest 50 audit events. Deleted references remain readable as tombstones. |
| `PATCH ITEM` | `{ displayName?, note?, purpose?, status?: ACTIVE \| ARCHIVED }` (`null` clears a text field) | 200 `ReferenceDetail` | 409 `REFERENCE_INVALID_TRANSITION` on a deleted reference |
| `DELETE ITEM` | — | 200 `ReferenceDetail` (`DELETED`) | Bytes are purged in the same transaction; existing links stop working. Deleting twice → 409. |
| `GET ITEM/content` | — | 200 raw bytes | Exact stored `Content-Type`; `Content-Disposition: attachment; filename="reference-<uuid>.<ext>"`; `X-Content-Type-Options: nosniff`; `Content-Security-Policy: sandbox; default-src 'none'`; `Cache-Control: private, no-store`; strong `ETag` (stored SHA-256) with an authenticated 304. 404 when deleted. |
| `POST ITEM/download-links` | `{ expiresInSeconds?: 60–900 }` (default 300) | 201 `{ url, expiresAt, referenceId, storedSha256 }` | `url = /api/reference-downloads?token=…`. The link is a bearer secret. |
| `GET /api/reference-downloads?token=` | — | 200 raw bytes, headers as `content` | Anonymous. Malformed, forged, expired, revoked (deleted reference, ownership change, key rotation) or mismatched tokens are all 404 `REFERENCE_LINK_INVALID`. |

## Types (summary)

| Type | Fields |
|---|---|
| `ReferenceItem` | `id, projectId, status, purpose, displayName, note, mediaType, originalSha256, originalBytes, storedSha256, storedBytes, storageLocator: 'postgres-bytea', inspectorVersion, boundRevisionId, uploadedBy, createdAt, updatedAt, deletedAt, currency { status: CURRENT \| STALE \| PROJECT_SCOPED, boundRevisionId, projectCurrentRevisionId }` |
| `ReferenceDetail` | `ReferenceItem` + `provenance { sourceKind: USER_UPLOAD, uploadedBy, original, stored, transformations[], inspection }`, `events[]`, `deduplicated?` |
| `InspectionReport` | `inspectorVersion, verdict, declaredMediaType, detectedMediaType, original, stored, checks[], findings[{ code, severity, detail }], media { IMAGE: width, height \| DOCUMENT: pageCount }, metadata { removed[{ segment, bytes }], retained[] }, malwareScan { NOT_PERFORMED, NO_SCANNER_CONFIGURED }, claims` (all `NOT_CLAIMED`) |

Reject codes: `EMPTY_FILE`, `TYPE_MISMATCH`, `TRAILING_DATA`, `TRUNCATED`, `MALFORMED_STRUCTURE`, `DIMENSIONS_EXCEEDED`, `PNG_CRC_MISMATCH`, `PNG_UNKNOWN_CRITICAL_CHUNK`, `PDF_ACTIVE_CONTENT`, `PDF_ENCRYPTED`, `PDF_INFLATE_LIMIT`, `PDF_PAGE_LIMIT`.

## Frontend notes

- Send the file as the raw request body with its real `Content-Type` (no multipart): `fetch(url, { method: 'POST', headers: { Authorization, 'Content-Type': file.type }, body: file })`.
- Call `POST ROOT/validate` first to show findings before upload, or upload directly and render `fieldErrors` on 422.
- For `<img src>` or a download button without an `Authorization` header, request a download link and use its `url` before `expiresAt`.
- Show `malwareScan: NOT_PERFORMED` honestly: inspection proves file structure, not the absence of malware.
- Discovery: `GET /api/capabilities` lists `REFERENCE_LIBRARY` (`version: reference-inspector-v1`, `persistence: INSPECTED_PRIVATE_BLOB`).
