# Phase 36 API — compute gateway, first slice

All routes need a Supabase session (anonymous → 401). They are owner-only: another user's or another project's resources → 404. Errors use the standard envelope. Schemas: `apps/api/src/compute/contracts.ts`; OpenAPI: `docs/modernization/openapi.json`.

## `POST /api/projects/:projectId/compute/quotes`

Body (≤ 70 000 bytes): `{ "request": <B32 job request>, "placement": "LOCAL" }`. `placement` defaults to `LOCAL`; `REMOTE` is refused. Rate group: `write`.

Response `200`: a `ComputeQuote` containing:
- `kind`, `request`, `inputHash`, `placement`, `provider`;
- `source { revisionId, modelHash }`, `algorithm { engine, version }`;
- `execution` bounds: `maxWallMs`, `poolSize`, `queueLimit`, `maxAttempts`, `maxActivePerProject`, `maxActivePerOwner`, `maxConsentedPerOwnerPerDay`, `requestBytes`;
- `cost { costClass: FREE, ceilingMinor: 0, currency: INR }`, `dataTransfer: NONE`;
- `runtime { node, reproducibility: NOT_CLAIMED }`, `issuedAt`, `expiresAt`;
- `authorization: NOT_AUTHORIZED_UNTIL_CONSENT`, `claims` (all `NOT_CLAIMED`), `quoteHash`.

Nothing is stored or run.

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR`, or the engine's own input codes | Malformed body or invalid engine input |
| 404 | `PROJECT_NOT_FOUND` / `REVISION_NOT_FOUND` | Not the owner's project or revision |
| 422 | `COMPUTE_PLACEMENT_DISABLED` | `placement: REMOTE` |
| 422 | `COMPUTE_KIND_UNSUPPORTED` | `REVISION_EXECUTE`, or a kind removed by policy |
| 503 | `COMPUTE_UNAVAILABLE` | Server commit key not configured |

## `POST /api/projects/:projectId/compute/jobs`

Body (≤ 81 920 bytes): `{ "quote": <the quote, unmodified>, "consent": { "quoteHash": "<quote.quoteHash>", "acceptQuote": true, "acceptLocalExecution": true } }`. Rate group: `generate`.

Response `202` (new) or `200` (repeated consent; `replayed: true`): `{ job: <B32 JobDetail>, dispatch: <consent record>, replayed }`, with a `Location` header pointing to the polling URL.

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing consent, or a consent flag that is not `true` |
| 404 | `PROJECT_NOT_FOUND` | Not the owner's project |
| 409 | `COMPUTE_CONSENT_MISMATCH` | `consent.quoteHash` ≠ `quote.quoteHash` |
| 409 | `COMPUTE_QUOTE_INVALID` | Quote altered, issued to another user or project, or signed by another server |
| 409 | `COMPUTE_QUOTE_EXPIRED` | Past `expiresAt` (default TTL 900 s) |
| 409 | `COMPUTE_QUOTE_STALE` | The source revision no longer matches (defensive: revisions are immutable, so a signed quote normally cannot become stale) |
| 409 | `COMPUTE_QUOTE_CONFLICT` | Quote hash already used for different work (defensive) |
| 422 | `COMPUTE_PLACEMENT_DISABLED` / `COMPUTE_KIND_UNSUPPORTED` | Policy changed since the quote |
| 429 | `COMPUTE_LIMIT_EXCEEDED` | Owner-wide active or daily consent limit |
| 429 | `JOB_LIMIT_EXCEEDED` | B32 per-project limit |

## `GET /api/projects/:projectId/compute/jobs/:jobId`

Polling. The response is `{ gatewayVersion, job, dispatches[], resultCheck { status: PENDING | ACCEPTED_BY_SERVICE_VALIDATOR | NO_RESULT, detail }, claims }`. Like every B32 read, it recovers jobs whose worker was lost. A job without a consent record → `404 COMPUTE_JOB_NOT_FOUND`.

**Cancellation:** `POST /api/projects/:projectId/jobs/:jobId/cancel` (B32, unchanged).

## Discovery

`GET /api/capabilities` gains:
- a `COMPUTE_GATEWAY` service row;
- `computeProviders`: `local-pool` `AVAILABLE`, `remote-http-worker` `DISABLED`. No endpoint, credential or price is listed.

## Configuration

`COMPUTE_POLICY` (optional JSON; strict): `{ "quoteTtlSeconds": 60–3600 (900), "maxConsentedPerOwnerPerDay": 1–500 (50), "maxActivePerOwner": 1–8 (2), "kinds": ["SCENE_COMPILE", "OPTIMIZATION_STUDY"], "remoteExecution": "DISABLED" }`. Unknown fields, or any other `remoteExecution` value, fail startup.
