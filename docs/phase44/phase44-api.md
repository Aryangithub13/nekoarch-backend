# Phase 44 (B44 S1) API: project members, element-anchored comments, reviews and the change audit

Written 2026-10-19 for audit B (INT-B-004, INT-B-027). Source of truth: `apps/api/src/collaboration/contracts.ts`, `apps/api/src/routes/collaboration.ts`,
migrations `0030_collaboration.sql` and `0033_collaboration_retries.sql`. Schemas are exported to [openapi.json](../modernization/openapi.json).
`apps/api/tests/collaboration-api-doc.test.ts` fails if a route below is renamed or a new one is not listed.

| Property | Value |
|---|---|
| Authentication | Supabase bearer session on every route; anonymous → 401 |
| Who can call | The project owner and its **active** members. Anyone else, and a removed member, gets 404 `PROJECT_NOT_FOUND`, as for a project they cannot see |
| Reach of membership | **Only these six routes.** Every other project route (the project itself, the 3D scene, BIM, documents, manifest, verification) stays owner-only and returns 404 to a member. Widening it is an owner decision (audit B INT-B-001) |
| Writes | Signed (HMAC envelope) and role-checked in SQL by `collaboration_write`, serialized per project (advisory lock), so the caps hold under concurrency |
| Idempotency | `Idempotency-Key` (1–128 of `[A-Za-z0-9._:-]`) on `DELETE …/members/:userId`, `POST …/comments` and `POST …/reviews` (since `0033`). A retry with the same key and body replays the stored response, without storing a second row. The same key with another body is 409 `IDEMPOTENCY_CONFLICT`. Without a key, every post stores a new row, and a second removal is 404 `MEMBER_NOT_FOUND`. `POST …/members` is an upsert, so a retry is harmless without a key |
| Timestamps | RFC 3339 with an offset, from `timestamptz` (`2026-10-19T05:53:43.270936+00:00` on a UTC database), like every other database-sourced timestamp |
| Caps | 20 active members per project, 200 comments and 100 reviews per revision → 409 `COLLABORATION_LIMIT_REACHED` (one code for all three caps) |

## Roles

| Role | `permissions` | May |
|---|---|---|
| `owner` | `READ`, `COMMENT`, `REVIEW`, `MANAGE_MEMBERS` | everything here |
| `editor` | `READ`, `COMMENT` | read and comment. **No revision-editing right exists**: every write route outside this table is owner-only (audit B INT-B-003, owner decision) |
| `reviewer` | `READ`, `COMMENT`, `REVIEW` | read, comment, record reviews |
| `viewer` | `READ` | read only; a comment or review is 403 `COLLABORATION_FORBIDDEN` |

## Routes (`P` = `/api/projects/:projectId`)

| Method & path | Body | Success | Errors and notes |
|---|---|---|---|
| `GET /api/projects/:projectId/collaboration` | — | 200 `{ collaborationVersion, project, role, permissions, members, revisions, revisionsTruncated }` | `revisions` holds the newest 100, newest first; `revisionsTruncated` is true when the project has more. Members are invited by Supabase user UUID only; there is no lookup (INT-B-002) |
| `POST /api/projects/:projectId/collaboration/members` | `{ userId, role: editor\|reviewer\|viewer }` | 201 member | Owner only (403 `COLLABORATION_FORBIDDEN`). 422 `MEMBER_INVALID` for a user that does not exist **or** the owner (one answer for both). Re-adding a removed member restores them with the new role |
| `DELETE /api/projects/:projectId/collaboration/members/:userId` | — | 200 `{ userId, removed: true }` | Owner only. 404 `MEMBER_NOT_FOUND` when not an active member (replayed as 200 under the same `Idempotency-Key`) |
| `GET /api/projects/:projectId/collaboration/revisions/:revisionId` | — | 200 revision with `model`, `modelHash`, `comments`, `reviews`, `reviewState`, `audit` (requester, instruction, approver, events, element diff from the parent) | 404 `REVISION_NOT_FOUND`. All comments and reviews are returned: their caps equal the read limits |
| `POST /api/projects/:projectId/collaboration/revisions/:revisionId/comments` | `{ kind?: COMMENT\|CHANGE_REQUEST, body (1–2000), elementIds? (≤ 16 stable ids of this revision), parentId? }` | 201 comment | 422 `COMMENT_ELEMENT_INVALID` (an id not in this revision's model), 422 `COMMENT_PARENT_INVALID` (replies attach to a top-level comment of the same revision). Comments are immutable |
| `POST /api/projects/:projectId/collaboration/revisions/:revisionId/reviews` | `{ decision: APPROVED\|CHANGES_REQUESTED, note?, expectedModelHash }` | 201 review | Owner or reviewer. 409 `REVIEW_MODEL_MISMATCH` when the revision's model is not the one reviewed. Reviews are immutable; `reviewState.latest` keeps each reviewer's newest decision on the current model |

## Deployment

`0030` then `0033` must be applied before an API that serves these routes (the API's readiness is 503 until the schema is current, since
`0032`). A database that has `0030` but not `0033` keeps the four-argument `collaboration_write` and has no receipts or truncation flag.
