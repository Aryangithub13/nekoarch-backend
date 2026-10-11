# Phase 31 design — secure reference ingestion & artifact lifecycle

## 1. Principle

A reference is a file a user supplies to inform a design: a site photo, a hand sketch, a survey PDF, an inspiration image. Untrusted bytes are **inspected before they are stored**, and stored bytes are **immutable and private**. A reference is evidence the user provided, never an architectural fact. No engine (generator, QA, takeoff, cost, analyses, scene) consumes a reference in V1, and no reference changes a revision. Every claim the system cannot verify (malware-free, content accuracy, drawing scale) is reported `NOT_CLAIMED`.

Roadmap mapping (46-phase plan, B31): *"safe uploads, file scanning, provenance and private asset storage … makes references and downloads secure and version-aware."* The modernization report assigns *"uploads/reference artifacts, object storage, signed URLs, streaming"* to B31; §12 says which of these V1 delivers.

## 2. Supported matrix (V1)

| Capability | Status | Notes |
|---|---|---|
| Upload PNG, JPEG, WebP, PDF (≤ 10 MiB) | **AVAILABLE** | Raw request body; the declared `Content-Type` must equal the type detected from the bytes. |
| Structural inspection (`reference-inspector-v1`) | **AVAILABLE** | Deterministic parsers run in an isolated worker (§5). Verdict `ACCEPTED` or `REJECTED` with typed findings. |
| Image metadata removal (EXIF/GPS, XMP, IPTC, text chunks, comments) | **AVAILABLE** | Lossless: pixel data bytes are copied verbatim, only metadata segments are dropped. The original and stored hashes are both recorded. |
| Dry-run inspection (`/validate`) | **AVAILABLE** | Inspects and reports; stores nothing. |
| Private storage, authenticated download, signed expiring download links | **AVAILABLE** | Bytes in Postgres `bytea` (`storage_locator = 'postgres-bytea'`), as Phases 29–30. |
| Lifecycle: archive, restore, delete (bytes purged, tombstone kept) | **AVAILABLE** | §6. |
| Revision binding and currency (`CURRENT` / `STALE` / `PROJECT_SCOPED`) | **AVAILABLE** | §7. |
| Content de-duplication per project | **AVAILABLE** | Same stored bytes in the same project return the existing reference. |
| Anti-malware engine scan | **NOT PERFORMED** (`malwareScan: NOT_PERFORMED`, reason `NO_SCANNER_CONFIGURED`) | There is no scanner on this platform. Inspection proves structure, not absence of malware; the verdict says so. An external scanner fits the B32 durable-job model (§12). |
| DWG, DXF, IFC, SVG, HEIC, TIFF, ZIP, Office files | **UNSUPPORTED** → 415 `REFERENCE_TYPE_UNSUPPORTED` | SVG and Office files can carry active content; DWG/DXF/IFC import is design-geometry ingestion, not a reference. |
| Encrypted or active-content PDFs | **REJECTED** | §5.4. |
| Using a reference as AI or engine input (OCR, scale, plan extraction) | **Not advertised** | B39 / F13–F16. |
| Object storage (Supabase Storage / S3) | **Not in V1** | The `storage_locator` column is the extension point (§12). |

## 3. Contracts (`apps/api/src/references/contracts.ts`)

| Concept | Representation |
|---|---|
| `ReferenceMediaType` | `image/png \| image/jpeg \| image/webp \| application/pdf` |
| `ReferencePurpose` | `SITE_PHOTO \| SITE_PLAN \| SKETCH \| INSPIRATION \| DOCUMENT \| OTHER` |
| `ReferenceUploadQuery` | `{ purpose, displayName?, revisionId?, note? }` (query string, strict) |
| `InspectionReport` | `{ inspectorVersion, verdict: ACCEPTED \| REJECTED, declaredMediaType, detectedMediaType, checks[], findings[], media: { width, height } \| { pageCount }, metadata: { removed[], retained[] }, malwareScan: { status: 'NOT_PERFORMED', reason }, claims }` |
| `InspectionFinding` | `{ code, severity: 'REJECT' \| 'INFO', detail }`; reject codes in §5.5 |
| `ReferenceProvenance` | `{ sourceKind: 'USER_UPLOAD', uploadedBy, uploadedAt, original: { sha256, bytes }, stored: { sha256, bytes }, transformations[], inspection }` |
| `ReferenceSummary` / `ReferenceDetail` | Identity, lifecycle status, purpose, display name, media type, sizes, hashes, binding, currency; detail adds provenance and events |
| `DownloadLink` | `{ url, expiresAt, referenceId, storedSha256 }` |
| `ReferenceUsage` | `{ references, storedBytes, uploadsLastHour, limits }` |

`claims` is fixed: `{ malwareFree, contentAccuracy, drawingScale, siteConditions, ownershipOrLicence }`, all `NOT_CLAIMED`.

## 4. Upload pipeline

```text
request ─► auth + quota ─► query/Content-Type check (415) ─► size cap (413 → 400 INVALID_REQUEST via body limit)
        ─► worker: sniff → parse → active-content scan → metadata strip → re-parse stripped bytes
        ─► main thread: re-hash both buffers, re-check report shape (malformed = worker failure, 503)
        ─► REJECTED: audit event (hash, size, finding codes; no bytes) → 422 REFERENCE_REJECTED with findings
        ─► ACCEPTED: signed reference_write (SQL re-hashes bytes, checks limits, dedupes) → 201 (or 200 deduplicated)
```

The worker re-parses its own output, so stripping can never produce bytes that would fail inspection. SQL recomputes the SHA-256 of the stored bytes and refuses a mismatch with the signed provenance.

## 5. Inspection (`apps/api/src/references/inspect.ts`, `reference-inspector-v1`)

### 5.1 Common
- Magic-byte detection: the declared type must equal the detected type (`TYPE_MISMATCH`).
- Exact framing: the container's own structure must account for every byte. Trailing data after the end marker is rejected (`TRAILING_DATA`), which also rejects image/ZIP and image/PDF polyglots.
- Dimension guard: width and height ≤ 12 000 px and width × height ≤ 50 000 000 (`DIMENSIONS_EXCEEDED`), so a small file cannot claim a decompression-bomb canvas.

### 5.2 PNG
Signature; `IHDR` first with valid fields; every chunk's CRC-32 verified (`PNG_CRC_MISMATCH`); at least one `IDAT`; `IEND` last. Unknown critical chunks → `PNG_UNKNOWN_CRITICAL_CHUNK`. Metadata chunks `tEXt`, `zTXt`, `iTXt`, `eXIf`, `tIME` are removed.

### 5.3 JPEG
`SOI`; well-formed marker segments with lengths inside the buffer; exactly one frame header (`SOF0–SOF15` except `DHT`/`JPG`/`DAC`) with dimensions; entropy-coded data scanned to `EOI`; `EOI` is the last two bytes. `APP1` (Exif, XMP), `APP12`, `APP13` (IPTC) and comments (`COM`) are removed. `APP0` (JFIF), `APP2` ICC profile segments and `APP14` (Adobe colour transform) are retained because they affect decoding or rendering. Other `APPn` segments are removed.

Phone cameras append Multi-Picture Format (MPF) secondary images (thumbnails, depth maps) after the primary `EOI`, announced by an `APP2` `MPF` segment. When that segment is present, the bytes after the primary `EOI` are removed with it and recorded as the `MPF_SECONDARY_IMAGES` transformation. Without an `MPF` segment, bytes after `EOI` are `TRAILING_DATA` and the file is rejected. Either way the stored file ends at the primary `EOI`.

### 5.4 WebP
`RIFF` size equals the buffer length minus 8; `WEBP` form; first chunk `VP8 `, `VP8L` or `VP8X`; chunk sizes and padding inside bounds; dimensions from the bitstream header (or `VP8X` canvas). `EXIF` and `XMP ` chunks are removed and the `VP8X` flags and `RIFF` size are rewritten.

### 5.5 PDF
- `%PDF-1.0` … `%PDF-2.0` at offset 0; `%%EOF` within the final 1 024 bytes (anything after it beyond whitespace → `TRAILING_DATA`).
- Names are normalized (`#xx` escapes decoded) before matching, so `/J#61vaScript` cannot evade the scan.
- Rejected names: `/JavaScript`, `/JS`, `/OpenAction`, `/AA`, `/Launch`, `/EmbeddedFile`, `/EmbeddedFiles`, `/RichMedia`, `/XFA`, `/SubmitForm`, `/ImportData`, `/GoToR`, `/GoToE` (`PDF_ACTIVE_CONTENT`). `/Encrypt` → `PDF_ENCRYPTED` (it cannot be inspected).
- Where objects can live, every rejected name is matched: the file text outside streams, and object streams (`/Type /ObjStm`), which are inflated within a bounded budget (32 MiB in total, 8 MiB per stream → `PDF_INFLATE_LIMIT`). An object stream that is not plain `FlateDecode`, or does not inflate, cannot be inspected and is rejected (`MALFORMED_STRUCTURE`).
- Every other stream region (images, fonts, page content) is scanned raw for the **long** action names only (5+ characters: `/JavaScript`, `/Launch`, `/OpenAction`, …). Every executable action is typed by one of them (`/S /JavaScript`), so a fake `>> stream` marker cannot hide an action. Matching the 3-character `/JS` or `/AA` against binary image data would reject valid files by chance.
- Page count: the number of `/Type /Page` objects outside streams and in object streams (1–2 000, `PDF_PAGE_LIMIT`).
- PDF metadata (`/Info`, XMP) is **reported as retained, not removed**: rewriting a PDF is not lossless at V1 scope.

### 5.6 Reject codes
`TYPE_MISMATCH`, `TRAILING_DATA`, `TRUNCATED`, `MALFORMED_STRUCTURE`, `DIMENSIONS_EXCEEDED`, `PNG_CRC_MISMATCH`, `PNG_UNKNOWN_CRITICAL_CHUNK`, `PDF_ACTIVE_CONTENT`, `PDF_ENCRYPTED`, `PDF_INFLATE_LIMIT`, `PDF_PAGE_LIMIT`, `EMPTY_FILE`.

### 5.7 Isolation
`InspectionPool` extends the Phase 28 `BoundedWorkerPool`: size 2, queue 8, 5 s, 256 MiB heap. A crash, timeout or malformed reply is `REFERENCE_WORKER_FAILED` (503) and stores nothing. The main thread never parses untrusted bytes.

## 6. Lifecycle (persisted, enforced by a SQL trigger)

```text
upload ─► ACTIVE ◄─restore── ARCHIVED
            │ archive ──────►   │
            └──── delete ──► DELETED ◄─ delete
```

- `ARCHIVED` hides a reference from default listings; it is still downloadable.
- `DELETED` is terminal. The blob row is deleted in the same transaction; the reference row stays as a tombstone (hashes, provenance, events) so audit and dedupe history survive. Download links stop working immediately.
- Identity columns (project, uploader, hashes, sizes, media type, provenance, created_at) are immutable; only `status`, `display_name`, `purpose`, `note`, `updated_at` may change.
- Blob rows can only be inserted with their reference and deleted when it becomes `DELETED`.

## 7. Revision binding

An upload may name `revisionId`, an accepted revision of the same project, meaning "this reference informed that version". Currency is computed like Phase 29 scene artifacts:

| Binding | Currency |
|---|---|
| No revision | `PROJECT_SCOPED` |
| Revision = project current revision | `CURRENT` |
| Older revision | `STALE` (with `boundRevisionId`, `projectCurrentRevisionId`) |

Binding is immutable. `GET …/references?revisionId=` lists references bound to one revision.

## 8. Persistence (migration `0021_reference_ingestion.sql`)

| Table | Content |
|---|---|
| `project_references` | Project (FK, cascade), uploader, optional bound revision (composite FK to `project_revisions(project_id,id)`), status, purpose, display name, note, media type, original/stored SHA-256 and bytes, `storage_locator`, inspector version, provenance JSON (≤ 64 KiB), timestamps. `unique (project_id, stored_sha256) where status <> 'DELETED'` |
| `project_reference_blobs` | `reference_id` PK, `bytes bytea` (1 B – 10 MiB), magic bytes checked by type |
| `project_reference_events` | `UPLOADED`, `DEDUPLICATED`, `REJECTED`, `ARCHIVED`, `RESTORED`, `DELETED`, `DOWNLOAD_LINK_ISSUED`, `METADATA_UPDATED`; actor, detail JSON (≤ 4 KiB). Rejections carry hash, size and finding codes only, never bytes. |

**Invariants in SQL:**
- RLS: owner select on references and events; no grant on blobs.
- Writes only through signed `SECURITY DEFINER` `reference_write` (HMAC envelope over user, route template, exact input and idempotency context, as Phases 14–30).
- SQL recomputes `sha256(bytes)` and the length and refuses a mismatch with the signed provenance (`P3103`).
- A transition trigger enforces §6; identity is immutable; blobs are guarded.
- Limits per project: ≤ 50 non-deleted references, ≤ 200 MiB stored, ≤ 30 upload attempts per hour including rejections (`P3104` → 429 `REFERENCE_LIMIT_EXCEEDED`).
- `reference_read` (owner) serves summaries, detail, list, usage and bytes (re-hashed before return; mismatch → `P3105` integrity failure).
- `reference_download(p_token)` is the only function granted to `anon` (§9).

Error family `P31xx`: `P3101` not found, `P3102` revision not found or not accepted, `P3103` integrity/provenance mismatch, `P3104` limit, `P3105` integrity failure on read, `P3106` invalid transition, `P3107` invalid or expired link.

## 9. Downloads

**Authenticated:** `GET …/references/:referenceId/content`. Headers: exact stored `Content-Type`; `Content-Disposition: attachment; filename="reference-<uuid>.<ext>"` (the user's display name never reaches a header or a path); `X-Content-Type-Options: nosniff`; `Content-Security-Policy: sandbox; default-src 'none'`; `Cache-Control: private, no-store`; strong `ETag` = stored SHA-256 with authenticated `304`. No gzip: every supported type is already compressed.

**Signed link:** `POST …/references/:referenceId/download-links` `{ expiresInSeconds: 60–900, default 300 }` → `{ url: '/api/reference-downloads?token=<token>', expiresAt }`.
- Token = `base64url(payload) "." hex(HMAC-SHA256)`, payload `{ v: 'reference-download-v1', r: referenceId, p: projectId, u: userId, s: storedSha256, e: expiresAtEpoch }`.
- The HMAC key is the existing `project_private.commit_key` secret, so **SQL verifies the token itself**. The API never needs a service-role key, and rotating the commit key revokes every link.
- `reference_download(p_token)` checks: token shape and length; signature (full-digest equality, as the existing signed envelopes; probing is bounded by the IP perimeter rate limit); expiry; reference not `DELETED`; project still owned by `u`; stored hash still `s`. It then returns the bytes, re-hashed.
- Every failure is the same 404 `REFERENCE_LINK_INVALID`, so a token reveals nothing about which check failed.
- Links are bearer secrets: short-lived, single reference, never logged (logs carry the route template only).

## 10. API (all under the owner's project; full list in [phase31-api.md](phase31-api.md))

`ROOT = /api/projects/:projectId/references`

- `POST ROOT/validate` — inspect only (raw body).
- `POST ROOT` — upload (raw body, query `ReferenceUploadQuery`).
- `GET ROOT?limit&cursor&status&purpose&revisionId` — list.
- `GET ROOT/usage` — counts, bytes, hourly attempts, limits.
- `GET ROOT/:referenceId` — detail with provenance and events.
- `PATCH ROOT/:referenceId` — `{ displayName?, purpose?, note?, status?: ACTIVE | ARCHIVED }`.
- `DELETE ROOT/:referenceId` — tombstone and purge bytes.
- `GET ROOT/:referenceId/content` — bytes.
- `POST ROOT/:referenceId/download-links` — signed link.
- `GET /api/reference-downloads?token=` — anonymous, token-authorized bytes. The token is a query parameter, as in presigned URLs: the router caps path parameters at 100 characters, and a token is about 375.

Catalog 94 → 104 routes. Uploads and `/validate` are charged to the `generate` quota; other writes to `write`; reads to `read`; the anonymous download route to the IP perimeter only.

## 11. Threat model (summary)

| Threat | Control |
|---|---|
| Malicious file executes in a viewer (PDF JavaScript, SVG script, HTML sniffing) | Type allowlist without SVG/HTML/Office; PDF active-content scan including compressed streams and escaped names; `nosniff`, `sandbox` CSP and `attachment` disposition on every download |
| Polyglot or disguised file | Magic-byte detection must equal the declared type; exact framing with no trailing data |
| Decompression bomb / parser exhaustion | 10 MiB body cap; dimension caps; bounded PDF inflate budget; parsing only in a memory-capped, time-limited worker |
| Location / personal-data leak through metadata | Lossless removal of EXIF/GPS, XMP, IPTC and text metadata from images; retained PDF metadata is reported |
| Cross-tenant read, write or link use | RLS + owner checks in every definer function; links bind user, project, reference and hash and are re-checked against current ownership |
| Tampered bytes or provenance | SQL re-hashes bytes on write and on every read; signed write envelopes |
| Link leakage | ≤ 15 min expiry, single reference, revoked by delete, owner change or key rotation; uniform 404; never logged |
| Path or header injection via filename | Display name is data only; download names are `reference-<uuid>.<ext>` |
| Storage exhaustion / upload flooding | Per-project count, byte and hourly limits (rejections count); `generate` rate-limit group; IP perimeter on the anonymous route |
| Over-claiming | `malwareScan: NOT_PERFORMED` and all content claims `NOT_CLAIMED`; references are not engine inputs |

## 12. Out of scope (later phases)

| Item | Phase |
|---|---|
| Anti-malware engine scanning as an asynchronous, retryable job; quarantine state | 32 (durable jobs), with a scanner provider |
| Object storage adapter and streaming of large files | 32/45 (the `storage_locator` column is the extension point) |
| Per-user storage quotas and settings | 33 |
| Reference library search and project context (briefs using references) | 33 |
| Using references as AI inputs (OCR, scale detection, sketch-to-plan) | 39, 43 |
| Sharing references with collaborators | 44 |
| CAD/BIM file import (DWG, DXF, IFC) as design geometry | Not on the B31 path; would be a geometry-ingestion phase with its own QA |

## 13. Verification plan

- **Unit (inspector):** generated fixtures for each type; malformed variants for every reject code; obfuscated `#xx` names and active content hidden inside a Flate object stream; metadata removal keeps image data bytes identical and re-inspects clean; determinism (same bytes → same report hash).
- **Integration (embedded Postgres, real RLS):** upload → list → detail → content; dedupe; cross-tenant 404 on every route; limits (count, bytes, hourly incl. rejections); lifecycle transitions and the trigger refusing invalid ones; delete purges bytes; links (valid, expired, tampered, after delete, after ownership change, wrong reference); SQL refusing bytes that do not match the signed hash; idempotent replays.
- **Conformance:** route catalog and OpenAPI regenerated; anonymous allowlist extended by exactly `GET /api/reference-downloads`; Sentry safe routes; discovery advertises `REFERENCE_LIBRARY`.
- **Regression:** full `npm run check` with no skips.
