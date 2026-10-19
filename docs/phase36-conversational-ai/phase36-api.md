# Phase 36 — Conversational AI: API

All routes require a Supabase session (anonymous → 401) and are owner-scoped through RLS (another user's or another project's conversation → 404). Errors use the existing envelope `{ error: { code, message, requestId, fieldErrors? } }`. Schemas: `apps/api/src/contracts/conversation-turns.ts` and `conversation-memory.ts`; OpenAPI: `docs/modernization/openapi.json`.

Prefix: `/api/projects/:projectId/conversations/:conversationId`.

## `POST …/turns` — one user message, one assistant turn

Rate group `generate`; body ≤ 40 960 bytes.

```json
{ "turnId": "uuid", "expectedVersion": 3, "baseRevisionId": "uuid|null", "text": "Use the second façade option, but keep the interior",
  "references": { "supersede": ["memory-id"], "release": ["memory-id"] },
  "operation": { "kind": "ZONE_REGENERATION", "request": { "target": {…}, "operation": {…}, "zones": [] } } }
```

`references` and `operation` are optional and user-authored. Response `{ conversation, turn, action }`; `turn.status` is one of `ANSWERED`, `RECORDED`, `CLARIFICATION_REQUIRED`, `PENDING_CONFIRMATION`, `CONFLICT`, `UNSUPPORTED`, `FAILED`; `turn.classification` one of `PROJECT_QUESTION`, `DECISION_QUERY`, `OPTIONS`, `ENGINEERING_QUESTION`, `COMPARISON`, `CONSTRAINT`, `OPTION_SELECTION`, `CHANGE_REQUEST`, `UNRECOGNIZED`. A retry with the same `turnId` and body replays the stored reply.

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` / `INVALID_REQUEST` / `PAYLOAD_TOO_LARGE` | Schema, unknown field, text > 2 000; body too large (`PAYLOAD_TOO_LARGE` since audit B INT-B-010) |
| 409 | `REVISION_CONFLICT` | The project moved past the conversation's base (rebase first) |
| 409 | `PROPOSAL_CONFLICT` | `expectedVersion` stale, or the conversation is `SUBMITTED` (rebase first) |
| 409 | `MESSAGE_IN_PROGRESS` / `IDEMPOTENCY_CONFLICT` | Concurrent turn / same `turnId` with a different body |
| 422 | `UNSAFE_CONVERSATION_INPUT` | Embedded instructions or credentials |
| 422 | `MEMORY_REFERENCE_INVALID` / `CONVERSATION_MEMORY_LIMIT` | Bad `release`/`supersede` id / memory full of active entries |
| 429 | `RATE_LIMITED` | With `Retry-After` |
| 503 | Phase 21 codes, e.g. `PROVIDER_TIMEOUT` | Requirement interpretation unavailable; nothing recorded |

## `POST …/actions/:actionId/decisions`

```json
{ "decisionId": "uuid", "expectedVersion": 4, "actionHash": "sha256", "decision": "CONFIRM|APPROVE_CANDIDATE|CANCEL",
  "candidateHash": "sha256 (APPROVE_CANDIDATE)", "operation": { "kind": "ZONE_REGENERATION", "request": {…} } }
```

Use the action's `confirmation` descriptor: it gives `route` and `body`, and `requires` lists what to add (`decisionId`, `expectedVersion`, and for zone regeneration the same `operation`). Response `{ conversation, action }`. A repeated decision returns the recorded outcome. `action.status`: `PENDING_CONFIRMATION`, `CANDIDATE_READY`, `COMMITTED` (with `result.revisionId`, `revisionNumber`, `verification`), `FAILED` (with `failure`), `CANCELLED`, `SUPERSEDED`, `STALE`.

| Status | Code | When |
|---|---|---|
| 404 | `ACTION_NOT_FOUND` | Not an action of this conversation |
| 409 | `ACTION_CONFLICT` | `actionHash`, `candidateHash` or resent request does not match |
| 409 | `ACTION_NOT_PENDING` | Action already final |
| 409 | `USE_PROPOSAL_APPROVAL` | Requirement proposals are approved through `/proposals/approve` |
| 409 | `REVISION_CONFLICT` | A newer revision that is not this action's commit; rebase |
| 422 | `ACTION_OPERATION_REQUIRED` | Zone regeneration confirmation without the structured request |

## `POST …/rebase`

`{ "expectedVersion": 5 }` → `{ conversation, rebased, fromRevisionId, toRevisionId, reconciled: [{ actionId, status }] }`. Idempotent while the conversation is current and open. Pending actions become `COMMITTED` only if the new revision is provably theirs, otherwise `STALE`; constraints and accepted decisions carry over.

## `GET …/context`

Bounded context document (`conversation-context-v1`): currency (`CURRENT`/`STALE`/`NO_REVISION`), facts with basis, last five revisions, live memory, pending actions, capability statuses, Phase 33 `projectContextHash`, `bytes` (≤ 12 000), `truncated`, `contextHash`.

## Changes to existing routes (backward compatible)

- `POST /api/projects/:projectId/conversations`: optional `turnsOnly: true` allows a conversation on a revision without stored requirements (otherwise unchanged 422 `NATIVE_REQUIREMENTS_UNAVAILABLE`).
- `POST …/messages`: 422 `NATIVE_REQUIREMENTS_UNAVAILABLE` for such conversations; 409 `PRESERVATION_CONFLICT` when the conversation holds active Phase 36 constraints on an existing revision.
- `POST …/proposals/approve`: 409 `PRESERVATION_CONFLICT` under the same condition (after receipt replay).
- Conversation responses may carry the optional `state.memory`, `state.turns`, `state.actions`; absent for conversations that never used turns.
