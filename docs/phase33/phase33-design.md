# Phase 33 design — account, project library, settings & context services

## 1. Principle

Everyday multi-project use needs four things the backend did not have:
- a way to **find** projects;
- **settings** that are the same on every device;
- **visible, enforced account quotas**;
- one **consistent context** for a project: what the owner has told us, which references exist, and which revision is current.

Everything here is metadata about the owner and their projects. Nothing in Phase 33 changes a revision, an engine input or an artifact. A brief is what the owner **stated**; it is stored, versioned and served as stated, and never presented as verified site, budget or code information.

Roadmap mapping (B33): *"complete project search, archive, preferences, quotas and brief/context services … supports everyday multi-project use with consistent settings."* Archiving already exists (`PATCH /api/projects/:projectId { status }`, Phase 12); B33 makes it searchable and filterable.

## 2. Supported matrix (V1)

| Capability | Status | Notes |
|---|---|---|
| Library search: title/tag text, status, visibility, starred, tag filters; sort by updated, created, title; keyset pagination | **AVAILABLE** | Owner's projects only. Text search is a case-insensitive substring match (escaped), not full-text ranking. |
| Stars and tags per project | **AVAILABLE** | ≤ 10 tags, lowercase slugs |
| User settings with optimistic concurrency | **AVAILABLE** | `units`, `locale`, `currency`, `defaultRegion`, `defaultBuildingType`; a stale `expectedVersion` → 409 |
| Account usage and limits | **AVAILABLE** | Projects, revisions, references (count and bytes), jobs (active, 24 h) |
| Account quotas enforced in SQL | **AVAILABLE** | ≤ 200 projects per owner; ≤ 1 GiB reference bytes per owner; ≤ 8 active jobs per owner (additive triggers) |
| Versioned project brief | **AVAILABLE** | Immutable versions; `expectedVersion` concurrency; linked references validated in SQL |
| Context bundle | **AVAILABLE** | One SQL snapshot: project, settings, current brief, active references, current revision summary, active jobs; plus a `contextHash` |
| Using the brief as AI or generator input | **Not in V1** | The interpreter still refuses client-supplied context (Phase 18). Consumption is B39/B41, through this bundle. |
| Teams, shared projects, roles | **Not in V1** | B44 |
| Billing and plans | **Not on the backend roadmap** | Limits are fixed constants, reported by `/api/me/usage`. |

## 3. Contracts (`apps/api/src/account/contracts.ts`)

| Concept | Representation |
|---|---|
| `UserSettings` | `{ units: METRIC \| IMPERIAL, locale: en \| en-IN \| hi \| hi-IN \| hi-Latn, currency: INR, defaultRegion: string \| null, defaultBuildingType: residential \| commercial \| institutional \| null }` |
| `SettingsDocument` | `{ version, settings, updatedAt \| null, isDefault }`. Version 0 means no settings saved yet (defaults served). |
| `SettingsPatch` | `{ expectedVersion, settings: Partial<UserSettings> }` |
| `AccountUsage` | `{ projects { active, archived }, revisions, references { count, storedBytes }, jobs { active, submittedLast24h }, limits }` |
| `LibraryQuery` | `{ q?, status: ACTIVE \| ARCHIVED \| ALL, visibility?, starred?, tag?, sort: updated \| created \| title, limit, cursor? }` |
| `LibraryItem` | Project summary + `{ starred, tags, referenceCount, briefVersion }` |
| `LibraryPatch` | `{ starred?, tags? }` |
| `ProjectBrief` | `{ summary, site { address?, plot? { width, depth, unit }, orientationNote? }, program { floors?, bedrooms?, bathrooms?, notes? }, budget? { amount, currency: INR, flexibility }, style { keywords[] }, constraints[], referenceIds[] }`. Every text field is trimmed, NFKC-normalized and stripped of control characters. |
| `BriefVersion` | `{ projectId, version, brief, briefHash, createdBy, createdAt, provenance: { source: 'USER_STATED', verified: false } }` |
| `ContextBundle` | `{ contextVersion, projectId, generatedAt, contextHash, project, settings, brief \| null, references[], currentRevision \| null, activeJobs[], claims }` |

`claims` on briefs and bundles: `{ siteVerified, budgetVerified, codeCompliance, ownershipVerified }`, all `NOT_CLAIMED`.

## 4. Persistence (migration `0023_account_library_context.sql`)

| Table | Content |
|---|---|
| `user_settings` | `user_id` PK, `version` (≥ 1), `settings_json` (validated shape), `updated_at` |
| `project_library` | `project_id` PK (cascade), `owner_id`, `starred`, `tags text[]` (≤ 10, `^[a-z0-9][a-z0-9-]{0,31}$`), `updated_at` |
| `project_briefs` | `(project_id, version)` PK, `brief_json` (≤ 32 KiB), `brief_hash`, `created_by`, `created_at`. Immutable (trigger); versions are gap-free. |

**Quotas** (additive `before insert` triggers; errcode `P3304` → 429 `ACCOUNT_QUOTA_EXCEEDED`):
- `projects`: at most 200 rows per `owner_id`;
- `project_references`: the owner's non-deleted stored bytes plus the new row's bytes ≤ 1 GiB;
- `project_jobs`: at most 8 `QUEUED`/`RUNNING` jobs per owner.

The existing per-project limits (Phases 31–32) still apply first.

**Functions:**
- `account_read('settings' | 'usage')` and signed `account_write('settings')`.
- `library_search(p_query)` and signed `library_write('update')`.
- `brief_read('current' | 'version' | 'list')` and signed `brief_write('create')`. Linked reference ids must be non-deleted references of the same project (`P3302`); `expectedVersion` must equal the current version (`P3301` → 409).
- `context_read(p_project_id)`: one statement, so every part comes from the same snapshot.

RLS: owner select on all three tables; writes only through the signed definer functions.

Error family `P33xx`: `P3301` version conflict, `P3302` invalid reference link, `P3303` brief version not found, `P3304` account quota.

## 5. Context bundle

`GET /api/projects/:projectId/context` returns the bundle assembled by `context_read`. `contextHash` is the canonical hash (same `costHash` as every other identity) of the bundle without `generatedAt` and `contextHash`. Two reads with no change in between give the same hash, so later AI phases can cite exactly which context they used (F35 calculation-evidence rule: record inputs and IDs). References appear as summaries (id, purpose, name, type, hashes, currency), never bytes. The current revision appears as a summary (id, number, QA status, model hash), never the model.

## 6. API (full list in [phase33-api.md](phase33-api.md))

- `GET /api/me/settings`, `PATCH /api/me/settings`
- `GET /api/me/usage`
- `GET /api/library/projects`
- `PATCH /api/projects/:projectId/library`
- `GET /api/projects/:projectId/brief`
- `GET /api/projects/:projectId/brief/versions`, `POST /api/projects/:projectId/brief/versions`
- `GET /api/projects/:projectId/brief/versions/:version`
- `GET /api/projects/:projectId/context`

Catalog 110 → 120 routes. `POST …/brief/versions` accepts `Idempotency-Key`. All writes are charged to the `write` quota.

## 7. Threat model (summary)

| Threat | Control |
|---|---|
| Cross-tenant search, settings, brief or context read | RLS + owner checks; the library only ever selects `owner_id = auth.uid()` |
| Search injection or expensive patterns | Parameterized; `%`, `_` and `\` escaped; query ≤ 100 characters; page ≤ 50 |
| Lost update across devices | `expectedVersion` on settings and briefs (409 on mismatch) |
| A brief linking another project's or a deleted reference | Validated in SQL at write |
| Quota bypass via direct RPCs | Triggers on the base tables, independent of the API |
| Over-claiming user-stated facts | `provenance.source = USER_STATED`, `verified: false`, claims `NOT_CLAIMED` |

## 8. Out of scope

| Item | Phase |
|---|---|
| Brief and context consumed by AI planning | 39, 41 |
| Collaboration, shared libraries, roles | 44 |
| Unified dependency graph across all artifacts | 37 |
| Full-text ranking or semantic search | Later; substring search is sufficient for ≤ 200 projects per owner |

## 9. Verification plan

- **Unit:** brief/settings/library contract normalization and strictness; tag slug rules; context hash stability.
- **Integration (embedded Postgres):** settings default → save → stale write 409 → persists across requests; usage counts; each quota trigger, including via direct SQL; library search (substring, escaped wildcards, tag, starred, status, sort, pagination, owner isolation); brief versions (create, conflict, foreign/deleted reference refusal, immutability, list/get); context bundle contents and hash stability, with the hash changing after a brief update; cross-tenant 404 and anonymous 401 everywhere.
- **Conformance:** catalog, OpenAPI, Sentry safe routes, discovery `PROJECT_CONTEXT`.
