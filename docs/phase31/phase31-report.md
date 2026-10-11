# Phase 31 report — secure reference ingestion & artifact lifecycle

**Final status: PHASE 31 IMPLEMENTED; VERIFIED WITHIN SUPPORTED SCOPE ON THIS MACHINE (Windows), WITH THE EXCEPTIONS IN §G.**

## A. Summary

A user can upload a reference (site photo, sketch, survey PDF, inspiration image) to a project. The bytes are inspected in an isolated worker before anything is stored:
- the type is detected from content, not trusted from the header;
- the structure is parsed exactly, so polyglots and trailing payloads are refused;
- decompression-bomb canvases are refused;
- PDFs are scanned for active content, including escaped names and compressed object streams;
- image metadata (EXIF/GPS, XMP, IPTC, comments) is removed losslessly.

Accepted files are stored privately in Postgres with full provenance (original and stored hashes, the inspection report and an audit trail). They can be archived, restored or deleted (bytes purged, tombstone kept) and bound to a revision with `CURRENT`/`STALE` currency. They are served with hardened headers or through short-lived signed links that SQL itself verifies. No anti-malware engine exists on this platform, so `malwareScan` is `NOT_PERFORMED` and every content claim is `NOT_CLAIMED`.

## B. Source baseline

| Item | Value |
|---|---|
| Base | `25d072f` (Phase 30 verified on local Supabase), branch `phase30/supabase-verification` |
| Branch | `phase31/secure-reference-ingestion` |
| Note | The remote branch `phase31/development` points at Phase 27 (`90e5124`) and contains no Phase 31 work; it was not used as a base. |
| Protected | Migrations 0001–0020 and all earlier evidence are untouched. |

## C. Implementation

| Area | Files |
|---|---|
| Contracts | `apps/api/src/references/contracts.ts` |
| Inspector (pure, deterministic) | `apps/api/src/references/inspect.ts` |
| Isolation | `apps/api/src/references/worker.ts`, `pool.ts` (Phase 28 `BoundedWorkerPool`: 2 workers, queue 8, 5 s, 256 MiB) |
| Persistence | `supabase/migrations/0021_reference_ingestion.sql`: 3 tables, lifecycle trigger, blob guard, `reference_write` / `reference_read` / `reference_download` |
| Storage boundary | `apps/api/src/lib/reference-repository.ts`; `referenceRpc` in `lib/supabase.ts` and `test-support/pg-backend.ts` |
| Service and routes | `apps/api/src/services/reference-service.ts`, `apps/api/src/routes/references.ts` (10 routes) |
| Integration (additive) | Discovery `REFERENCE_LIBRARY`; Sentry safe routes; `generate` rate-limit group for uploads; OpenAPI and route catalog regenerated (94 → 104) |

Design decisions taken during implementation (all recorded in the design doc):
- **PDF scanning scope.** Full name matching runs where objects can live (text outside streams, object streams). Other stream regions are matched only against long action names. Matching `/JS` against binary image data would reject valid files by chance; ignoring stream regions entirely would let a fake `>> stream` hide an action.
- **JPEG MPF.** Phone photos carry Multi-Picture Format secondary images after the primary `EOI`. When an `APP2 MPF` segment announces them they are removed (recorded as a transformation); otherwise trailing bytes are refused.
- **Download token in the query string.** Fastify caps path parameters at 100 characters; a signed token is about 375.

## D. Verification

| Suite | Result |
|---|---|
| Phase 31 unit (`references.test.ts`) | 25/25 |
| Phase 31 integration on embedded PostgreSQL (`references.integration.test.ts`) | 11/11 |
| Conformance (`modernization.test.ts`: catalog, OpenAPI, anonymous allowlist, discovery) | 6/6 |
| All unit suites (`test:unit` set plus Phase 31 and conformance) | 2 324/2 325. The one failure is the pre-existing Windows path-separator assertion in `interpretation.test.ts` (fails identically on the base commit). |
| All integration suites | Every test assertion passes. On Windows, embedded Postgres teardown intermittently fails with `EBUSY … rmdir` (a temporary directory is still locked when it is deleted); affected files were rerun and their assertions pass. |
| Build, typecheck, lint | Clean |

The full `npm run check` could not run as one process on this machine: it was stopped twice for low system memory. The suites were run in the batches above instead.

## E. Security summary

See the threat model in [phase31-design.md §11](phase31-design.md). The tests demonstrate:
- cross-tenant 404 on every route;
- no direct table access to bytes;
- SQL refusing unsigned writes, foreign-user signatures and bytes that do not hash to the signed inspection;
- trigger refusals for invalid transitions, identity changes and blob deletion;
- link refusal when tampered, under the wrong key, expired, beyond the ceiling, for another owner or other bytes, after an ownership transfer or after deletion.

## F. Limitations

- No anti-malware scanning (no provider). Inspection is structural.
- PDF metadata is reported as retained, not removed.
- Bytes live in Postgres `bytea` (≤ 10 MiB per file, 200 MiB per project); there is no object-storage adapter or streaming yet.
- References are not inputs to any engine or AI flow.

## G. Not covered

- **Supabase live stack and frontend:** not run (no Docker on this machine; the frontend repository is not available).
- **Migration application to the hosted project:** 0018–0021 are not applied to the user's hosted Supabase project.
