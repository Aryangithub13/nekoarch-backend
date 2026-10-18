# Phase 33 API — account, project library, settings & context

All routes are additive. The route catalog grows from 110 to 120 entries ([api-routes.json](../modernization/api-routes.json)).

| Property | Value |
|---|---|
| Authentication | Supabase bearer session on every route; anonymous → 401 |
| Foreign or unknown project | 404 |
| Writes | Signed (HMAC envelope) and re-validated in SQL; settings and briefs use optimistic concurrency (`expectedVersion`) |
| Idempotency | `Idempotency-Key` on `POST …/brief/versions` |
| Schemas | Zod v3 in `apps/api/src/account/contracts.ts`; exported to [openapi.json](../modernization/openapi.json) |
| Quota errors | 429 `ACCOUNT_QUOTA_EXCEEDED` from project creation, reference upload, job submission or job retry once an account limit is reached. Each limit holds under concurrent requests (serialized per owner since `0031`) |

## Account

| Method & path | Body | Success | Notes |
|---|---|---|---|
| `GET /api/me/settings` | — | 200 `{ version, settings, updatedAt, isDefault }` | `version: 0, isDefault: true` until the first save; defaults are `METRIC`, `en-IN`, `INR`, no default region or building type |
| `PATCH /api/me/settings` | `{ expectedVersion, settings: Partial<UserSettings> }` | 200 settings document (`version + 1`) | 409 `VERSION_CONFLICT` when another device saved first: reload, then reapply |
| `GET /api/me/usage` | — | 200 `AccountUsage` | Projects (active/archived), revisions, references (count/bytes), jobs (active/24 h) and the limits: 200 projects, 1 GiB references, 8 active jobs |

## Library

| Method & path | Body | Success | Notes |
|---|---|---|---|
| `GET /api/library/projects?q&status&visibility&starred&tag&sort&limit&cursor` | — | 200 `{ items: LibraryItem[], nextCursor }` | `q` is a case-insensitive literal substring of the title, or an exact tag. `status` defaults to `ACTIVE` (`ALL` for everything). `sort`: `updated` (default), `created`, `title`. A cursor is valid only for the sort that produced it. `limit` ≤ 50. |
| `PATCH /api/projects/:projectId/library` | `{ starred?, tags? }` (≤ 10 lowercase slug tags) | 200 `{ projectId, starred, tags, updatedAt }` | Archive and unarchive stay on `PATCH /api/projects/:projectId { status }` |

`LibraryItem`: `id, title, status, visibility, currentRevisionId, revisionCount, createdAt, updatedAt, archivedAt, starred, tags, referenceCount, briefVersion`.

## Brief

| Method & path | Body | Success | Notes |
|---|---|---|---|
| `GET /api/projects/:projectId/brief` | — | 200 `{ projectId, version, current: BriefVersion \| null }` | `version: 0` when no brief exists |
| `POST /api/projects/:projectId/brief/versions` | `{ expectedVersion, brief: ProjectBrief }` | 201 `BriefVersion` | 409 `VERSION_CONFLICT` if `expectedVersion` is not the current version. 422 `BRIEF_REFERENCE_INVALID` if a `referenceIds` entry is not a live reference of this project. |
| `GET /api/projects/:projectId/brief/versions?limit&cursor` | — | 200 `{ projectId, items: [{ version, briefHash, createdBy, createdAt }], nextCursor }` | Newest first |
| `GET /api/projects/:projectId/brief/versions/:version` | — | 200 `BriefVersion` | 404 `BRIEF_VERSION_NOT_FOUND` |

`ProjectBrief`: `summary` (required, ≤ 2 000 characters), `site { address?, plot? { width, depth, unit: m | ft }, orientationNote? }`, `program { floors?, bedrooms?, bathrooms?, notes? }`, `budget? { amount, currency: INR, flexibility: LOW | MEDIUM | HIGH }`, `style { keywords[] }`, `constraints[]`, `referenceIds[]`.

`BriefVersion` carries `provenance: { source: 'USER_STATED', verified: false }` and `claims` (`siteVerified`, `budgetVerified`, `codeCompliance`, `ownershipVerified`: all `NOT_CLAIMED`). Versions are immutable.

## Context

| Method & path | Success | Notes |
|---|---|---|
| `GET /api/projects/:projectId/context` | 200 `ContextBundle` | One consistent snapshot: project (+ stars/tags), the owner's settings, the current brief, active references (and archived ones the brief links), the current revision summary (id, number, QA status, model hash), active jobs and claims. `contextHash` is stable while nothing changes. |
