# B44 slice S1: members, element-anchored comments, reviews and the change audit

**Status:** implemented and locally verified as a **vertical slice**. **B44 is not complete** (§5).

**Branch:** `phases-40-46`. Plan of record: [b40-b46-implementation-plan.md](../roadmap/b40-b46-implementation-plan.md). **Migration:** `0030_collaboration.sql` (additive).

## 1. Roadmap traceability (ROADMAP L375–391)

| Requirement | S1 delivers |
|---|---|
| Roles owner, editor, engineer/reviewer, viewer (L379) | `project_members` holds `editor`, `reviewer` and `viewer`; the owner is `projects.owner_id`. The owner manages members (at most 20), and removal ends access. The permission table, also enforced in SQL:<br>• owner: read, comment, review, manage;<br>• editor: read, comment;<br>• reviewer: read, comment, review;<br>• viewer: read. |
| Comments linked to BIM elements/scene objects through common reference IDs (L379, L387) | Comments carry up to 16 `elementIds`. SQL checks each against the stored model of that revision (levels, spaces, walls, openings, stairs, slabs, columns, dimensions, specifications); an unknown id gives `422 COMMENT_ELEMENT_INVALID`. Kinds are `COMMENT` and `CHANGE_REQUEST`, with one reply level. |
| Approvals and review evidence; reviewer sign-off where permitted (L379, L381) | Reviews (`APPROVED` / `CHANGES_REQUESTED`) by the owner or a reviewer. Each is bound to the server-computed model hash and is only accepted if it equals `expectedModelHash` (else `409 REVIEW_MODEL_MISMATCH`). `reviewState` gives each reviewer's latest decision on the current model. Reviews are recorded opinions: `professionalCertification` and `regulatoryApproval` are `NOT_CLAIMED`. |
| Change audit: instructions, approvals, identity, dependency invalidations, final modified element IDs (L382) | `audit`: creator and time, the committing Phase 30 operation (requester, instruction or structured kind, approver, event trail), the element diff from the parent by stable id, and `invalidation: WHOLE_MODEL` (B37). |
| **Gate:** concurrent attempts never silently overwrite; a reviewer can trace what changed, by whom, why and with what evidence (L391) | Concurrency is unchanged: the Phase 30 SQL compare-and-swap, and the B40 S1 test 5. Traceability is proven by the integration test: a viewer reads the audit of a B40-committed revision, which names the requester, the approver, the events and exactly `spaces:foyer [finishes]`. |

## 2. Access model (a deliberate limit)

Membership reaches **only** the six collaboration routes, through `SECURITY DEFINER` `collaboration_read` / `collaboration_write`. Every existing owner-only table, RLS policy and route is unchanged: a reviewer gets 404 on `GET /api/projects/:id`, which is tested. Opening the analysis routes to members would mean changing RLS on roughly 30 tables, and that is an owner decision. The collaboration revision view does give members the revision's model, so they can review what they comment on.

Comments and reviews are immutable, through the existing `immutable_revision` trigger, which is tested with direct UPDATE and DELETE. Direct table reads are limited by inline, non-recursive policies: the owner sees everything, a member sees its own membership row and, while active, the project's comments and reviews.

## 3. API

`ROOT = /api/projects/:projectId/collaboration`. A non-member gets 404; anonymous requests get 401.

| Method and path | Who | Result |
|---|---|---|
| `GET ROOT` | Owner, members | Workspace: project summary, role, permissions, members, the newest 100 revisions |
| `POST ROOT/members` `{ userId, role }` | Owner | 201 member (upsert; re-adding restores access) |
| `DELETE ROOT/members/:userId` | Owner | `{ userId, removed: true }` |
| `GET ROOT/revisions/:revisionId` | Owner, members | Model and model hash, comments, reviews, `reviewState`, `audit`, claims |
| `POST ROOT/revisions/:revisionId/comments` `{ kind?, body, elementIds?, parentId? }` | Owner, editor, reviewer | 201 comment |
| `POST ROOT/revisions/:revisionId/reviews` `{ decision, note?, expectedModelHash }` | Owner, reviewer | 201 review |

Writes are signed (`PROJECT_COMMIT_SECRET`; without it they return 503). *Since `0033` (audit B INT-B-014), member removal, comments and reviews honour `Idempotency-Key`, and the workspace reports `revisionsTruncated`; see [`phase44-api.md`](phase44-api.md).* Discovery lists `COLLABORATION`.

**Error codes:**

| Code | Status |
|---|---|
| `COLLABORATION_FORBIDDEN` | 403 |
| `MEMBER_INVALID` | 422 |
| `MEMBER_NOT_FOUND` | 404 |
| `COMMENT_ELEMENT_INVALID` | 422 |
| `COMMENT_PARENT_INVALID` | 422 |
| `COLLABORATION_LIMIT_REACHED` | 409 |
| `REVIEW_MODEL_MISMATCH` | 409 |

## 4. Verification

| Suite | Result |
|---|---|
| `collaboration.integration.test.ts` | 1/1 on PostgreSQL, covering:<br>• every role permission;<br>• owner-only routes stay closed;<br>• audit of a B40 commit;<br>• anchor validation and reply depth;<br>• the review hash precondition and latest-decision state;<br>• immutability;<br>• removal |
| `supabase/tests/database.test.ts` | Updated pins: 42 tables (adding `project_members`, `project_revision_comments`, `project_revision_reviews`) and 78 foreign keys (the six 0030 keys pinned) |
| `hosted-migration-ledger.test.ts` | Latest migration is `0030` |

## 5. Outstanding B44 work

- Member access to existing routes: an owner decision on RLS.
- Invitations by email and user search.
- Ownership transfer.
- Branches and saved scenarios.
- Accountable lock overrides.
- Notifications.
- Idempotency keys for collaboration writes.
- Comment pagination beyond 200.
- Applying `0030` to hosted Supabase (D-9), with live acceptance.
