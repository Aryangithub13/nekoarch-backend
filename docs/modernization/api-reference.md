# API reference (generated)

Generated from [openapi.json](openapi.json) (`api-compatibility-v1+165.25abc1fa0880`) by `test-support/openapi.ts`; regenerate with `UPDATE_ROUTE_CATALOG=1 npx vitest run apps/api/tests/modernization.test.ts`. Do not edit.
Every error is `ApiErrorResponse` (`{ error: { code, message, requestId, fieldErrors? } }`); the codes and their statuses are in [error-codes.json](error-codes.json).
Nested schemas, limits and patterns are in openapi.json. Per-phase behaviour is in the `docs/phase*/…-api.md` documents where they exist.

## GET `/api/capabilities`

Auth: none

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/compatibility`

Auth: bearer (Supabase session)

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `compatibilityVersion` | "api-compatibility-v1" | yes |  |
| `routeCatalog` | object | yes |  |
| `openapi` | object | yes |  |
| `services` | object[] | yes |  |
| `conventions` | object | yes |  |
| `media` | object[] | yes |  |
| `mockSubstitution` | "FORBIDDEN_AS_LIVE_EVIDENCE" | yes |  |
| `supportedClients` | object | yes |  |

## POST `/api/estimates`

Auth: bearer (Supabase session)

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `planId` | string (uuid) |  |  |
| `location` | string | yes |  |
| `buildingType` | "residential" \| "commercial" \| "institutional" | yes |  |
| `builtUpAreaSqft` | number | yes |  |
| `floors` | integer |  |  |
| `budget` | number |  |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `tiers` | object[] | yes |  |
| `region` | object | yes |  |
| `disclaimer` | string | yes |  |
| `soilDisclaimer` | string | yes |  |

## GET `/api/library/projects`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `q` | query | string |  |
| `status` | query | "ACTIVE" \| "ARCHIVED" \| "ALL" |  |
| `visibility` | query | "PRIVATE" \| "PUBLIC" |  |
| `starred` | query | "true" \| "false" |  |
| `tag` | query | string |  |
| `sort` | query | "updated" \| "created" \| "title" |  |
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | object[] | yes |  |
| `nextCursor` | string \| null | yes |  |

## GET `/api/me/settings`

Auth: bearer (Supabase session)

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | integer | yes |  |
| `settings` | object | yes |  |
| `updatedAt` | string \| null | yes |  |
| `isDefault` | boolean | yes |  |

## PATCH `/api/me/settings`

Auth: bearer (Supabase session)

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `expectedVersion` | integer | yes |  |
| `settings` | object | yes |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | integer | yes |  |
| `settings` | object | yes |  |
| `updatedAt` | string \| null | yes |  |
| `isDefault` | boolean | yes |  |

## GET `/api/me/usage`

Auth: bearer (Supabase session)

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `projects` | object | yes |  |
| `revisions` | integer | yes |  |
| `references` | object | yes |  |
| `jobs` | object | yes |  |
| `limits` | object | yes |  |

## POST `/api/plans`

Auth: bearer (Supabase session)

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `plan` | object | yes |  |

**201**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `plan` | object | yes |  |
| `shareToken` | string | yes |  |

## GET `/api/plans/{id}`

Auth: none

| Parameter | In | Type | Required |
|---|---|---|---|
| `id` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `plan` | object | yes |  |

## PATCH `/api/plans/{id}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `id` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `isPublic` | boolean | yes |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `plan` | object | yes |  |

## POST `/api/plans/generate`

Auth: bearer (Supabase session)

Request body (`application/json`): object \| object

**201**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `plan` | object | yes |  |
| `shareToken` | string | yes |  |

## GET `/api/projects`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | object[] | yes |  |
| `nextCursor` | string \| null | yes |  |

## POST `/api/projects`

Auth: bearer (Supabase session)

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes |  |

**201**: Success (`application/json`, ProjectDetail)

## GET `/api/projects/{projectId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `includeFreshness` | query | "true" \| "false" |  |

**200**: Success (`application/json`, ProjectDetail)

## PATCH `/api/projects/{projectId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string |  |  |
| `status` | "ACTIVE" \| "ARCHIVED" |  |  |
| `visibility` | "PRIVATE" \| "PUBLIC" |  |  |

**200**: Success (`application/json`, ProjectDetail)

## GET `/api/projects/{projectId}/brief`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `projectId` | string (uuid) | yes |  |
| `version` | integer | yes |  |
| `current` | object \| null | yes |  |

## GET `/api/projects/{projectId}/brief/versions`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `projectId` | string (uuid) | yes |  |
| `items` | object[] | yes |  |
| `nextCursor` | string \| null | yes |  |

## POST `/api/projects/{projectId}/brief/versions`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `expectedVersion` | integer | yes |  |
| `brief` | object | yes |  |

**201**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `projectId` | string (uuid) | yes |  |
| `version` | integer | yes |  |
| `brief` | object | yes |  |
| `briefHash` | string | yes |  |
| `createdBy` | string (uuid) | yes |  |
| `createdAt` | string | yes |  |
| `provenance` | object | yes |  |
| `claims` | object | yes |  |

## GET `/api/projects/{projectId}/brief/versions/{version}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `version` | path | integer | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `projectId` | string (uuid) | yes |  |
| `version` | integer | yes |  |
| `brief` | object | yes |  |
| `briefHash` | string | yes |  |
| `createdBy` | string (uuid) | yes |  |
| `createdAt` | string | yes |  |
| `provenance` | object | yes |  |
| `claims` | object | yes |  |

## GET `/api/projects/{projectId}/collaboration`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `project` | object | yes |  |
| `role` | "owner" \| "editor" \| "reviewer" \| "viewer" | yes |  |
| `members` | object[] | yes |  |
| `revisions` | object[] | yes |  |
| `revisionsTruncated` | boolean | yes |  |
| `collaborationVersion` | "collaboration-v1" | yes |  |
| `permissions` | "READ" \| "COMMENT" \| "REVIEW" \| "MANAGE_MEMBERS"[] | yes |  |

## POST `/api/projects/{projectId}/collaboration/members`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `userId` | string (uuid) | yes |  |
| `role` | "editor" \| "reviewer" \| "viewer" | yes |  |

**201**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `userId` | string (uuid) | yes |  |
| `role` | "editor" \| "reviewer" \| "viewer" | yes |  |
| `addedBy` | string (uuid) | yes |  |
| `createdAt` | string (date-time) | yes |  |
| `updatedAt` | string (date-time) | yes |  |

## DELETE `/api/projects/{projectId}/collaboration/members/{userId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `userId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `userId` | string (uuid) | yes |  |
| `removed` | true | yes |  |

## GET `/api/projects/{projectId}/collaboration/revisions/{revisionId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `collaborationVersion` | "collaboration-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `role` | "owner" \| "editor" \| "reviewer" \| "viewer" | yes |  |
| `revision` | object | yes |  |
| `comments` | object[] | yes |  |
| `reviews` | object[] | yes |  |
| `reviewState` | object | yes |  |
| `audit` | object | yes |  |
| `claims` | object | yes |  |

## POST `/api/projects/{projectId}/collaboration/revisions/{revisionId}/comments`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `kind` | "COMMENT" \| "CHANGE_REQUEST" |  |  |
| `body` | string | yes |  |
| `elementIds` | string[] |  |  |
| `parentId` | string (uuid) \| null |  |  |

**201**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `authorId` | string (uuid) | yes |  |
| `authorRole` | "owner" \| "editor" \| "reviewer" | yes |  |
| `kind` | "COMMENT" \| "CHANGE_REQUEST" | yes |  |
| `body` | string | yes |  |
| `elementIds` | string[] | yes |  |
| `parentId` | string (uuid) \| null | yes |  |
| `createdAt` | string (date-time) | yes |  |

## POST `/api/projects/{projectId}/collaboration/revisions/{revisionId}/reviews`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `decision` | "APPROVED" \| "CHANGES_REQUESTED" | yes |  |
| `note` | string |  |  |
| `expectedModelHash` | string | yes |  |

**201**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `reviewerId` | string (uuid) | yes |  |
| `reviewerRole` | "owner" \| "reviewer" | yes |  |
| `decision` | "APPROVED" \| "CHANGES_REQUESTED" | yes |  |
| `note` | string | yes |  |
| `modelHash` | string | yes |  |
| `createdAt` | string (date-time) | yes |  |

## POST `/api/projects/{projectId}/compute/jobs`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `quote` | object | yes |  |
| `consent` | object | yes |  |

**200**: A replay of an earlier submission (`replayed: true`) (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `job` | object | yes |  |
| `dispatch` | object | yes |  |
| `replayed` | boolean | yes |  |

**202**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `job` | object | yes |  |
| `dispatch` | object | yes |  |
| `replayed` | boolean | yes |  |

## GET `/api/projects/{projectId}/compute/jobs/{jobId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `jobId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `gatewayVersion` | "compute-gateway-v1" | yes |  |
| `job` | object | yes |  |
| `dispatches` | object[] | yes |  |
| `resultCheck` | object | yes |  |
| `claims` | object | yes |  |

## POST `/api/projects/{projectId}/compute/quotes`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `request` | object \| object \| object | yes |  |
| `placement` | "LOCAL" \| "REMOTE" |  |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `quoteVersion` | "compute-quote-v1" | yes |  |
| `gatewayVersion` | "compute-gateway-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `kind` | "SCENE_COMPILE" \| "OPTIMIZATION_STUDY" | yes |  |
| `request` | object \| object \| object | yes |  |
| `inputHash` | string | yes |  |
| `placement` | "LOCAL" | yes |  |
| `provider` | object | yes |  |
| `source` | object | yes |  |
| `algorithm` | object | yes |  |
| `execution` | object | yes |  |
| `cost` | object | yes |  |
| `dataTransfer` | "NONE" | yes |  |
| `runtime` | object | yes |  |
| `issuedAt` | string (date-time) | yes |  |
| `expiresAt` | string (date-time) | yes |  |
| `authorization` | "NOT_AUTHORIZED_UNTIL_CONSENT" | yes |  |
| `claims` | object | yes |  |
| `quoteHash` | string | yes |  |

## GET `/api/projects/{projectId}/context`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `contextVersion` | "project-context-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `generatedAt` | string | yes |  |
| `contextHash` | string | yes |  |
| `project` | object | yes |  |
| `settings` | object | yes |  |
| `brief` | object \| null | yes |  |
| `references` | object[] | yes |  |
| `currentRevision` | object \| null | yes |  |
| `activeJobs` | object[] | yes |  |
| `claims` | object | yes |  |

## GET `/api/projects/{projectId}/conversations`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string (uuid) |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | Conversation[] | yes |  |
| `nextCursor` | string (uuid) \| null | yes |  |

## POST `/api/projects/{projectId}/conversations`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `conversationId` | string (uuid) | yes |  |
| `baseRevisionId` | string (uuid) \| null | yes |  |
| `layoutV2` | object |  |  |
| `turnsOnly` | true |  |  |

**200**: Success (`application/json`, Conversation)

## DELETE `/api/projects/{projectId}/conversations/{conversationId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `conversationId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `deleted` | true | yes |  |

## GET `/api/projects/{projectId}/conversations/{conversationId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `conversationId` | path | string (uuid) | yes |

**200**: Success (`application/json`, Conversation)

## POST `/api/projects/{projectId}/conversations/{conversationId}/actions/{actionId}/decisions`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `conversationId` | path | string (uuid) | yes |
| `actionId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `decisionId` | string (uuid) | yes |  |
| `expectedVersion` | integer | yes |  |
| `actionHash` | string | yes |  |
| `decision` | "CONFIRM" \| "APPROVE_CANDIDATE" \| "CANCEL" | yes |  |
| `candidateHash` | string |  |  |
| `operation` | object |  |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `conversation` | Conversation | yes |  |
| `action` | object | yes |  |

## GET `/api/projects/{projectId}/conversations/{conversationId}/context`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `conversationId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `contextVersion` | "conversation-context-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `conversationId` | string (uuid) | yes |  |
| `conversationVersion` | integer | yes |  |
| `baseRevisionId` | string (uuid) \| null | yes |  |
| `currentRevisionId` | string (uuid) \| null | yes |  |
| `currency` | "CURRENT" \| "STALE" \| "NO_REVISION" | yes |  |
| `facts` | object[] | yes |  |
| `history` | object[] | yes |  |
| `memory` | object[] | yes |  |
| `pendingActions` | object[] | yes |  |
| `capabilities` | object[] | yes |  |
| `sources` | object | yes |  |
| `bytes` | integer | yes |  |
| `truncated` | boolean | yes |  |
| `contextHash` | string | yes |  |
| `generatedAt` | string | yes |  |

## POST `/api/projects/{projectId}/conversations/{conversationId}/messages`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `conversationId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `messageId` | string (uuid) | yes |  |
| `expectedVersion` | integer | yes |  |
| `baseRevisionId` | string (uuid) \| null | yes |  |
| `text` | string | yes |  |
| `answers` | object \| object \| object \| object \| object[] |  |  |
| `nativeUpdate` | object |  |  |
| `restoreRevisionId` | string (uuid) |  |  |
| `removeUnsupported` | string[] |  |  |

**200**: Success (`application/json`, Conversation)

## POST `/api/projects/{projectId}/conversations/{conversationId}/proposals/approve`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `conversationId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `proposalId` | string (uuid) | yes |  |
| `proposalVersion` | integer | yes |  |
| `baseRevisionId` | string (uuid) \| null | yes |  |
| `requirementsHash` | string | yes |  |
| `approve` | true | yes |  |

**200**: Success (`application/json`, RevisionCommitResponse)

## POST `/api/projects/{projectId}/conversations/{conversationId}/rebase`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `conversationId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `expectedVersion` | integer | yes |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `conversation` | Conversation | yes |  |
| `rebased` | boolean | yes |  |
| `fromRevisionId` | string (uuid) \| null | yes |  |
| `toRevisionId` | string (uuid) \| null | yes |  |
| `reconciled` | object[] | yes |  |

## POST `/api/projects/{projectId}/conversations/{conversationId}/tools`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `conversationId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `actions` | object \| object \| object[] | yes |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `schemaVersion` | 1 | yes |  |
| `projectId` | string (uuid) | yes |  |
| `conversationId` | string (uuid) | yes |  |
| `results` | object \| object \| object \| object \| object \| object[] | yes |  |

## POST `/api/projects/{projectId}/conversations/{conversationId}/turns`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `conversationId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `turnId` | string (uuid) | yes |  |
| `expectedVersion` | integer | yes |  |
| `baseRevisionId` | string (uuid) \| null | yes |  |
| `text` | string | yes |  |
| `references` | object |  |  |
| `operation` | object |  |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `conversation` | Conversation | yes |  |
| `turn` | object \| null | yes |  |
| `action` | object \| null | yes |  |

## POST `/api/projects/{projectId}/feasibility/assessments`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string |  |  |
| `declared` | object |  |  |
| `baseRevisionId` | string (uuid) \| null |  |  |
| `preserve` | "BUILDING_GEOMETRY" \| "FLOOR_PLANS" \| "STRUCTURE" \| "STAIRS" \| "OPENINGS" \| "WALLS" \| …[] |  |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `assessmentVersion` | "feasibility-assessment-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `baseRevisionId` | string (uuid) \| null | yes |  |
| `inputHash` | string | yes |  |
| `status` | "WITHIN_ENGINE_SCOPE" \| "ALTERNATIVES_PROPOSED" | yes |  |
| `constraints` | object[] | yes |  |
| `alternatives` | object[] | yes |  |
| `ladder` | object[] | yes |  |
| `separation` | object | yes |  |
| `interpretation` | object | yes |  |
| `claims` | object | yes |  |

## POST `/api/projects/{projectId}/integration/plans`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `changeSetVersion` | "change-set-v1" | yes |  |
| `baseRevisionId` | string (uuid) | yes |  |
| `changes` | object[] | yes |  |
| `preserve` | object[] |  |  |
| `regenerate` | object |  |  |
| `limits` | object |  |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `planVersion` | "integration-plan-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `baseRevisionId` | string (uuid) | yes |  |
| `baseRevisionNumber` | integer | yes |  |
| `baseModelHash` | string | yes |  |
| `projectCurrentRevisionId` | string (uuid) \| null | yes |  |
| `status` | "INVALID" \| "BLOCKED_BY_LOCK" \| "UNSUPPORTED" \| "NEEDS_CLARIFICATION" \| "OVER_BUDGET" \| "STALE_BASE" \| … | yes |  |
| `reasons` | object[] | yes |  |
| `changes` | object[] | yes |  |
| `modelChange` | object \| null | yes |  |
| `diff` | object \| null | yes |  |
| `outputs` | object[] | yes |  |
| `tasks` | object[] | yes |  |
| `invalidation` | object | yes |  |
| `approvalRequired` | true | yes |  |
| `quote` | object | yes |  |
| `claims` | object | yes |  |
| `planHash` | string | yes |  |

## POST `/api/projects/{projectId}/integration/plans/execute`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `changeSet` | object | yes |  |
| `planHash` | string | yes |  |
| `consent` | object | yes |  |

**200**: No task completed: nothing was written and the base revision is unchanged. A 201 can still have status FAILED; committedRevisionId says whether a revision was committed (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `executionVersion` | "integration-execution-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `baseRevisionId` | string (uuid) | yes |  |
| `planHash` | string | yes |  |
| `status` | "COMPLETED" \| "PARTIAL" \| "FAILED" \| "REFUSED" | yes |  |
| `reasons` | object[] | yes |  |
| `plan` | object | yes |  |
| `operationId` | string (uuid) \| null | yes |  |
| `committedRevisionId` | string (uuid) \| null | yes | The revision this execution committed, which is now the project's current revision; non-null also when status is FAILED or PARTIAL (a consistency check or a regeneration branch failed after the commit). null means no revision was committed and the base is unchanged. |
| `tasks` | object[] | yes |  |
| `checks` | object[] | yes |  |
| `diff` | object \| null | yes |  |
| `outputs` | object[] | yes |  |
| `claims` | object | yes |  |

**201**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `executionVersion` | "integration-execution-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `baseRevisionId` | string (uuid) | yes |  |
| `planHash` | string | yes |  |
| `status` | "COMPLETED" \| "PARTIAL" \| "FAILED" \| "REFUSED" | yes |  |
| `reasons` | object[] | yes |  |
| `plan` | object | yes |  |
| `operationId` | string (uuid) \| null | yes |  |
| `committedRevisionId` | string (uuid) \| null | yes | The revision this execution committed, which is now the project's current revision; non-null also when status is FAILED or PARTIAL (a consistency check or a regeneration branch failed after the commit). null means no revision was committed and the base is unchanged. |
| `tasks` | object[] | yes |  |
| `checks` | object[] | yes |  |
| `diff` | object \| null | yes |  |
| `outputs` | object[] | yes |  |
| `claims` | object | yes |  |

## GET `/api/projects/{projectId}/jobs`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |
| `status` | query | "QUEUED" \| "RUNNING" \| "SUCCEEDED" \| "FAILED" \| "CANCELLED" |  |
| `kind` | query | "SCENE_COMPILE" \| "OPTIMIZATION_STUDY" \| "REVISION_EXECUTE" |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | object[] | yes |  |
| `nextCursor` | string \| null | yes |  |

## POST `/api/projects/{projectId}/jobs`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`): object \| object \| object

**200**: An identical active job already exists (`deduplicated: true`) (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectId` | string (uuid) | yes |  |
| `ownerId` | string (uuid) | yes |  |
| `kind` | "SCENE_COMPILE" \| "OPTIMIZATION_STUDY" \| "REVISION_EXECUTE" | yes |  |
| `status` | "QUEUED" \| "RUNNING" \| "SUCCEEDED" \| "FAILED" \| "CANCELLED" | yes |  |
| `jobVersion` | "durable-job-v1" | yes |  |
| `inputHash` | string | yes |  |
| `attempt` | integer | yes |  |
| `maxAttempts` | integer | yes |  |
| `userRetries` | integer | yes |  |
| `notBefore` | string | yes |  |
| `leaseExpiresAt` | string \| null | yes |  |
| `cancelRequested` | boolean | yes |  |
| `progress` | object | yes |  |
| `result` | object \| null | yes |  |
| `failure` | object \| null | yes |  |
| `lastFailure` | object \| null | yes |  |
| `createdAt` | string | yes |  |
| `updatedAt` | string | yes |  |
| `finishedAt` | string \| null | yes |  |
| `request` | object \| object \| object | yes |  |
| `deduplicated` | boolean |  |  |

**202**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectId` | string (uuid) | yes |  |
| `ownerId` | string (uuid) | yes |  |
| `kind` | "SCENE_COMPILE" \| "OPTIMIZATION_STUDY" \| "REVISION_EXECUTE" | yes |  |
| `status` | "QUEUED" \| "RUNNING" \| "SUCCEEDED" \| "FAILED" \| "CANCELLED" | yes |  |
| `jobVersion` | "durable-job-v1" | yes |  |
| `inputHash` | string | yes |  |
| `attempt` | integer | yes |  |
| `maxAttempts` | integer | yes |  |
| `userRetries` | integer | yes |  |
| `notBefore` | string | yes |  |
| `leaseExpiresAt` | string \| null | yes |  |
| `cancelRequested` | boolean | yes |  |
| `progress` | object | yes |  |
| `result` | object \| null | yes |  |
| `failure` | object \| null | yes |  |
| `lastFailure` | object \| null | yes |  |
| `createdAt` | string | yes |  |
| `updatedAt` | string | yes |  |
| `finishedAt` | string \| null | yes |  |
| `request` | object \| object \| object | yes |  |
| `deduplicated` | boolean |  |  |

## GET `/api/projects/{projectId}/jobs/{jobId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `jobId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectId` | string (uuid) | yes |  |
| `ownerId` | string (uuid) | yes |  |
| `kind` | "SCENE_COMPILE" \| "OPTIMIZATION_STUDY" \| "REVISION_EXECUTE" | yes |  |
| `status` | "QUEUED" \| "RUNNING" \| "SUCCEEDED" \| "FAILED" \| "CANCELLED" | yes |  |
| `jobVersion` | "durable-job-v1" | yes |  |
| `inputHash` | string | yes |  |
| `attempt` | integer | yes |  |
| `maxAttempts` | integer | yes |  |
| `userRetries` | integer | yes |  |
| `notBefore` | string | yes |  |
| `leaseExpiresAt` | string \| null | yes |  |
| `cancelRequested` | boolean | yes |  |
| `progress` | object | yes |  |
| `result` | object \| null | yes |  |
| `failure` | object \| null | yes |  |
| `lastFailure` | object \| null | yes |  |
| `createdAt` | string | yes |  |
| `updatedAt` | string | yes |  |
| `finishedAt` | string \| null | yes |  |
| `request` | object \| object \| object | yes |  |
| `deduplicated` | boolean |  |  |

## POST `/api/projects/{projectId}/jobs/{jobId}/cancel`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `jobId` | path | string (uuid) | yes |

Request body (`application/json`): object

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectId` | string (uuid) | yes |  |
| `ownerId` | string (uuid) | yes |  |
| `kind` | "SCENE_COMPILE" \| "OPTIMIZATION_STUDY" \| "REVISION_EXECUTE" | yes |  |
| `status` | "QUEUED" \| "RUNNING" \| "SUCCEEDED" \| "FAILED" \| "CANCELLED" | yes |  |
| `jobVersion` | "durable-job-v1" | yes |  |
| `inputHash` | string | yes |  |
| `attempt` | integer | yes |  |
| `maxAttempts` | integer | yes |  |
| `userRetries` | integer | yes |  |
| `notBefore` | string | yes |  |
| `leaseExpiresAt` | string \| null | yes |  |
| `cancelRequested` | boolean | yes |  |
| `progress` | object | yes |  |
| `result` | object \| null | yes |  |
| `failure` | object \| null | yes |  |
| `lastFailure` | object \| null | yes |  |
| `createdAt` | string | yes |  |
| `updatedAt` | string | yes |  |
| `finishedAt` | string \| null | yes |  |
| `request` | object \| object \| object | yes |  |
| `deduplicated` | boolean |  |  |

## GET `/api/projects/{projectId}/jobs/{jobId}/events`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `jobId` | path | string (uuid) | yes |
| `after` | query | integer |  |
| `limit` | query | integer |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `jobId` | string (uuid) | yes |  |
| `status` | "QUEUED" \| "RUNNING" \| "SUCCEEDED" \| "FAILED" \| "CANCELLED" | yes |  |
| `events` | object[] | yes |  |
| `nextAfter` | integer | yes |  |

## POST `/api/projects/{projectId}/jobs/{jobId}/retry`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `jobId` | path | string (uuid) | yes |

Request body (`application/json`): object

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectId` | string (uuid) | yes |  |
| `ownerId` | string (uuid) | yes |  |
| `kind` | "SCENE_COMPILE" \| "OPTIMIZATION_STUDY" \| "REVISION_EXECUTE" | yes |  |
| `status` | "QUEUED" \| "RUNNING" \| "SUCCEEDED" \| "FAILED" \| "CANCELLED" | yes |  |
| `jobVersion` | "durable-job-v1" | yes |  |
| `inputHash` | string | yes |  |
| `attempt` | integer | yes |  |
| `maxAttempts` | integer | yes |  |
| `userRetries` | integer | yes |  |
| `notBefore` | string | yes |  |
| `leaseExpiresAt` | string \| null | yes |  |
| `cancelRequested` | boolean | yes |  |
| `progress` | object | yes |  |
| `result` | object \| null | yes |  |
| `failure` | object \| null | yes |  |
| `lastFailure` | object \| null | yes |  |
| `createdAt` | string | yes |  |
| `updatedAt` | string | yes |  |
| `finishedAt` | string \| null | yes |  |
| `request` | object \| object \| object | yes |  |
| `deduplicated` | boolean |  |  |

## PATCH `/api/projects/{projectId}/library`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `starred` | boolean |  |  |
| `tags` | string[] |  |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `projectId` | string (uuid) | yes |  |
| `starred` | boolean | yes |  |
| `tags` | string[] | yes |  |
| `updatedAt` | string | yes |  |

## GET `/api/projects/{projectId}/public`

Auth: none

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `title` | string | yes |  |
| `updatedAt` | string (date-time) | yes |  |
| `currentRevision` | object \| null | yes |  |

## GET `/api/projects/{projectId}/references`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |
| `status` | query | "ACTIVE" \| "ARCHIVED" \| "DELETED" \| "ALL" |  |
| `purpose` | query | "SITE_PHOTO" \| "SITE_PLAN" \| "SKETCH" \| "INSPIRATION" \| "DOCUMENT" \| "OTHER" |  |
| `revisionId` | query | string (uuid) |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | object[] | yes |  |
| `nextCursor` | string \| null | yes |  |

## POST `/api/projects/{projectId}/references`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `purpose` | query | "SITE_PHOTO" \| "SITE_PLAN" \| "SKETCH" \| "INSPIRATION" \| "DOCUMENT" \| "OTHER" | yes |
| `displayName` | query | string |  |
| `note` | query | string |  |
| `revisionId` | query | string (uuid) |  |

Request body (`image/png`): string (binary)

Request body (`image/jpeg`): string (binary)

Request body (`image/webp`): string (binary)

Request body (`application/pdf`): string (binary)

**200**: The same bytes are already stored for this project (`deduplicated: true`) (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectId` | string (uuid) | yes |  |
| `status` | "ACTIVE" \| "ARCHIVED" \| "DELETED" | yes |  |
| `purpose` | "SITE_PHOTO" \| "SITE_PLAN" \| "SKETCH" \| "INSPIRATION" \| "DOCUMENT" \| "OTHER" | yes |  |
| `displayName` | string \| null | yes |  |
| `note` | string \| null | yes |  |
| `mediaType` | "image/png" \| "image/jpeg" \| "image/webp" \| "application/pdf" | yes |  |
| `originalSha256` | string | yes |  |
| `originalBytes` | integer | yes |  |
| `storedSha256` | string | yes |  |
| `storedBytes` | integer | yes |  |
| `storageLocator` | "postgres-bytea" | yes |  |
| `inspectorVersion` | "reference-inspector-v1" | yes |  |
| `boundRevisionId` | string (uuid) \| null | yes |  |
| `uploadedBy` | string (uuid) | yes |  |
| `createdAt` | string | yes |  |
| `updatedAt` | string | yes |  |
| `deletedAt` | string \| null | yes |  |
| `currency` | object | yes |  |
| `provenance` | object | yes |  |
| `events` | object[] | yes |  |
| `deduplicated` | boolean |  |  |

**201**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectId` | string (uuid) | yes |  |
| `status` | "ACTIVE" \| "ARCHIVED" \| "DELETED" | yes |  |
| `purpose` | "SITE_PHOTO" \| "SITE_PLAN" \| "SKETCH" \| "INSPIRATION" \| "DOCUMENT" \| "OTHER" | yes |  |
| `displayName` | string \| null | yes |  |
| `note` | string \| null | yes |  |
| `mediaType` | "image/png" \| "image/jpeg" \| "image/webp" \| "application/pdf" | yes |  |
| `originalSha256` | string | yes |  |
| `originalBytes` | integer | yes |  |
| `storedSha256` | string | yes |  |
| `storedBytes` | integer | yes |  |
| `storageLocator` | "postgres-bytea" | yes |  |
| `inspectorVersion` | "reference-inspector-v1" | yes |  |
| `boundRevisionId` | string (uuid) \| null | yes |  |
| `uploadedBy` | string (uuid) | yes |  |
| `createdAt` | string | yes |  |
| `updatedAt` | string | yes |  |
| `deletedAt` | string \| null | yes |  |
| `currency` | object | yes |  |
| `provenance` | object | yes |  |
| `events` | object[] | yes |  |
| `deduplicated` | boolean |  |  |

## DELETE `/api/projects/{projectId}/references/{referenceId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `referenceId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectId` | string (uuid) | yes |  |
| `status` | "ACTIVE" \| "ARCHIVED" \| "DELETED" | yes |  |
| `purpose` | "SITE_PHOTO" \| "SITE_PLAN" \| "SKETCH" \| "INSPIRATION" \| "DOCUMENT" \| "OTHER" | yes |  |
| `displayName` | string \| null | yes |  |
| `note` | string \| null | yes |  |
| `mediaType` | "image/png" \| "image/jpeg" \| "image/webp" \| "application/pdf" | yes |  |
| `originalSha256` | string | yes |  |
| `originalBytes` | integer | yes |  |
| `storedSha256` | string | yes |  |
| `storedBytes` | integer | yes |  |
| `storageLocator` | "postgres-bytea" | yes |  |
| `inspectorVersion` | "reference-inspector-v1" | yes |  |
| `boundRevisionId` | string (uuid) \| null | yes |  |
| `uploadedBy` | string (uuid) | yes |  |
| `createdAt` | string | yes |  |
| `updatedAt` | string | yes |  |
| `deletedAt` | string \| null | yes |  |
| `currency` | object | yes |  |
| `provenance` | object | yes |  |
| `events` | object[] | yes |  |
| `deduplicated` | boolean |  |  |

## GET `/api/projects/{projectId}/references/{referenceId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `referenceId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectId` | string (uuid) | yes |  |
| `status` | "ACTIVE" \| "ARCHIVED" \| "DELETED" | yes |  |
| `purpose` | "SITE_PHOTO" \| "SITE_PLAN" \| "SKETCH" \| "INSPIRATION" \| "DOCUMENT" \| "OTHER" | yes |  |
| `displayName` | string \| null | yes |  |
| `note` | string \| null | yes |  |
| `mediaType` | "image/png" \| "image/jpeg" \| "image/webp" \| "application/pdf" | yes |  |
| `originalSha256` | string | yes |  |
| `originalBytes` | integer | yes |  |
| `storedSha256` | string | yes |  |
| `storedBytes` | integer | yes |  |
| `storageLocator` | "postgres-bytea" | yes |  |
| `inspectorVersion` | "reference-inspector-v1" | yes |  |
| `boundRevisionId` | string (uuid) \| null | yes |  |
| `uploadedBy` | string (uuid) | yes |  |
| `createdAt` | string | yes |  |
| `updatedAt` | string | yes |  |
| `deletedAt` | string \| null | yes |  |
| `currency` | object | yes |  |
| `provenance` | object | yes |  |
| `events` | object[] | yes |  |
| `deduplicated` | boolean |  |  |

## PATCH `/api/projects/{projectId}/references/{referenceId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `referenceId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `displayName` | string \| null |  |  |
| `note` | string \| null |  |  |
| `purpose` | "SITE_PHOTO" \| "SITE_PLAN" \| "SKETCH" \| "INSPIRATION" \| "DOCUMENT" \| "OTHER" |  |  |
| `status` | "ACTIVE" \| "ARCHIVED" |  |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectId` | string (uuid) | yes |  |
| `status` | "ACTIVE" \| "ARCHIVED" \| "DELETED" | yes |  |
| `purpose` | "SITE_PHOTO" \| "SITE_PLAN" \| "SKETCH" \| "INSPIRATION" \| "DOCUMENT" \| "OTHER" | yes |  |
| `displayName` | string \| null | yes |  |
| `note` | string \| null | yes |  |
| `mediaType` | "image/png" \| "image/jpeg" \| "image/webp" \| "application/pdf" | yes |  |
| `originalSha256` | string | yes |  |
| `originalBytes` | integer | yes |  |
| `storedSha256` | string | yes |  |
| `storedBytes` | integer | yes |  |
| `storageLocator` | "postgres-bytea" | yes |  |
| `inspectorVersion` | "reference-inspector-v1" | yes |  |
| `boundRevisionId` | string (uuid) \| null | yes |  |
| `uploadedBy` | string (uuid) | yes |  |
| `createdAt` | string | yes |  |
| `updatedAt` | string | yes |  |
| `deletedAt` | string \| null | yes |  |
| `currency` | object | yes |  |
| `provenance` | object | yes |  |
| `events` | object[] | yes |  |
| `deduplicated` | boolean |  |  |

## GET `/api/projects/{projectId}/references/{referenceId}/content`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `referenceId` | path | string (uuid) | yes |

**200**: Binary (`application/octet-stream`, string (binary))

**304**: Not modified (If-None-Match)

## POST `/api/projects/{projectId}/references/{referenceId}/download-links`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `referenceId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `expiresInSeconds` | integer |  |  |

**201**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes |  |
| `expiresAt` | string | yes |  |
| `referenceId` | string (uuid) | yes |  |
| `storedSha256` | string | yes |  |

## GET `/api/projects/{projectId}/references/usage`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `projectId` | string (uuid) | yes |  |
| `references` | integer | yes |  |
| `storedBytes` | integer | yes |  |
| `attemptsLastHour` | integer | yes |  |
| `limits` | object | yes |  |
| `supportedMediaTypes` | "image/png" \| "image/jpeg" \| "image/webp" \| "application/pdf"[] | yes |  |
| `malwareScan` | "NOT_PERFORMED" | yes |  |

## POST `/api/projects/{projectId}/references/validate`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`image/png`): string (binary)

Request body (`image/jpeg`): string (binary)

Request body (`image/webp`): string (binary)

Request body (`application/pdf`): string (binary)

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `report` | object | yes |  |
| `stored` | false | yes |  |

## POST `/api/projects/{projectId}/requirements/interpret`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes |  |
| `locale` | "en" \| "en-IN" \| "hi" \| "hi-IN" \| "hi-Latn" |  |  |
| `unitsHint` | "AUTO" \| "mm" \| "cm" \| "m" \| "ft" \| "in" |  |  |
| `baseRevisionId` | string (uuid) \| null |  |  |
| `clarification` | object |  |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `interpretationId` | string (uuid) | yes |  |
| `interpreterVersion` | "architectural-interpreter-v1" | yes |  |
| `provider` | string | yes |  |
| `providerModel` | string | yes |  |
| `inputLanguage` | "en" \| "hi-Latn" \| "und" | yes |  |
| `status` | "READY" \| "NEEDS_CLARIFICATION" \| "UNSUPPORTED" \| "FAILED" | yes |  |
| `baseRevisionId` | string (uuid) \| null | yes |  |
| `candidate` | object \| null | yes |  |
| `structuredRequirements` | object \| null | yes |  |
| `assumptions` | object[] | yes |  |
| `unresolvedQuestions` | object[] | yes |  |
| `warnings` | string[] | yes |  |
| `unsupportedRequirements` | object[] | yes |  |
| `error` | object \| null | yes |  |
| `provenance` | object | yes |  |

## GET `/api/projects/{projectId}/revision-operations`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | object[] | yes |  |
| `nextCursor` | string \| null | yes |  |

## POST `/api/projects/{projectId}/revision-operations`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `baseRevisionId` | string (uuid) | yes |  |
| `request` | object \| object | yes |  |

**201**: Success (`application/json`, RevisionOperation)

## GET `/api/projects/{projectId}/revision-operations/{operationId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `operationId` | path | string (uuid) | yes |

**200**: Success (`application/json`, RevisionOperation)

## POST `/api/projects/{projectId}/revision-operations/{operationId}/approve`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `operationId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `preflightHash` | string | yes |  |
| `candidateHash` | string | yes |  |

**201**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `operation` | RevisionOperation | yes |  |
| `commit` | RevisionCommitResponse | yes |  |

## POST `/api/projects/{projectId}/revision-operations/{operationId}/cancel`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `operationId` | path | string (uuid) | yes |

Request body (`application/json`): object

**200**: Success (`application/json`, RevisionOperation)

## GET `/api/projects/{projectId}/revision-operations/{operationId}/candidate/glb`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `operationId` | path | string (uuid) | yes |

**200**: Binary (`model/gltf-binary`, string (binary))

**304**: Not modified (If-None-Match)

## GET `/api/projects/{projectId}/revision-operations/{operationId}/candidate/manifest`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `operationId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `acceptance` | "COMMITTED" \| "CANDIDATE_PREVIEW_NOT_ACCEPTED" | yes |  |
| `operation` | object | yes |  |
| `artifact` | object | yes |  |
| `manifest` | AppearanceManifest | yes |  |

## GET `/api/projects/{projectId}/revision-operations/{operationId}/comparison`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `operationId` | path | string (uuid) | yes |

**200**: Success (`application/json`, object \| object \| object \| object)

## POST `/api/projects/{projectId}/revision-operations/{operationId}/execute`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `operationId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `preflightHash` | string | yes |  |
| `consent` | object | yes |  |

**200**: Success (`application/json`, RevisionOperation)

## POST `/api/projects/{projectId}/revision-operations/{operationId}/reject`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `operationId` | path | string (uuid) | yes |

Request body (`application/json`): object

**200**: Success (`application/json`, RevisionOperation)

## GET `/api/projects/{projectId}/revision-operations/{operationId}/validation`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `operationId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `operationId` | string (uuid) | yes |  |
| `status` | "AWAITING_CONSENT" \| "NEEDS_CLARIFICATION" \| "UNSUPPORTED" \| "BLOCKED_BY_LOCK" \| "CANDIDATE_READY" \| "COMMITTED" \| … | yes |  |
| `preflightHash` | string | yes |  |
| `candidateHash` | string \| null | yes |  |
| `validation` | object \| null | yes |  |
| `failure` | object \| null | yes |  |
| `verifications` | string[] | yes |  |
| `locks` | object[] | yes |  |
| `events` | object[] | yes |  |

## GET `/api/projects/{projectId}/revisions`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | object[] | yes |  |
| `nextCursor` | string \| null | yes |  |

## POST `/api/projects/{projectId}/revisions`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `model` | BuildingModelV2 | yes |  |
| `baseRevisionId` | string (uuid) \| null |  |  |

**201**: Success (`application/json`, RevisionCommitResponse)

## GET `/api/projects/{projectId}/revisions/{revisionId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: Success (`application/json`, ProjectRevisionDetail)

## GET `/api/projects/{projectId}/revisions/{revisionId}/appearance`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `revisionId` | string (uuid) | yes |  |
| `appearance` | object \| null | yes |  |
| `appearanceHash` | string \| null | yes |  |
| `modelHash` | string \| null | yes |  |
| `operationId` | string (uuid) \| null | yes |  |
| `artifact` | object \| null | yes |  |
| `manifest` | AppearanceManifest \| null | yes |  |
| `status` | "APPEARANCE_VARIANT" \| "DEFAULT_PLACEHOLDER" | yes |  |
| `lineage` | object | yes |  |

## GET `/api/projects/{projectId}/revisions/{revisionId}/appearance/glb`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: Binary (`model/gltf-binary`, string (binary))

**304**: Not modified (If-None-Match)

## GET `/api/projects/{projectId}/revisions/{revisionId}/bim`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/projects/{projectId}/revisions/{revisionId}/bim/diff/{otherRevisionId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `otherRevisionId` | path | string (uuid) | yes |

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/projects/{projectId}/revisions/{revisionId}/bim/elements`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `after` | query | string |  |
| `kind` | query | "project" \| "site" \| "building" \| "level" \| "space" \| "wall" \| … |  |

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/projects/{projectId}/revisions/{revisionId}/bim/elements/{elementId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `elementId` | path | string | yes |

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/projects/{projectId}/revisions/{revisionId}/bim/export.ifc`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: Binary (`application/x-step`, string (binary))

## GET `/api/projects/{projectId}/revisions/{revisionId}/bim/export.json`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/projects/{projectId}/revisions/{revisionId}/bim/relationships`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `after` | query | string |  |
| `kind` | query | "contains" \| "hosts" \| "fills" \| "bounds" \| "connects_level" \| "accesses" \| … |  |

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/projects/{projectId}/revisions/{revisionId}/bim/validation`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/projects/{projectId}/revisions/{revisionId}/cost-estimates`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | object[] | yes |  |
| `nextCursor` | string \| null | yes |  |

## GET `/api/projects/{projectId}/revisions/{revisionId}/cost-estimates/{costEstimateId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `costEstimateId` | path | string (uuid) | yes |

**200**: Success (`application/json`, CostDetail)

## GET `/api/projects/{projectId}/revisions/{revisionId}/dependency-graph`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `graphVersion` | "dependency-graph-v1" | yes |  |
| `complete` | true | yes |  |
| `inputIdentity` | object | yes |  |
| `families` | object[] | yes |  |
| `nodes` | object[] | yes |  |
| `edges` | object[] | yes |  |
| `limits` | object | yes |  |
| `notRepresented` | object[] | yes |  |
| `claims` | object | yes |  |
| `graphHash` | string | yes |  |

## GET `/api/projects/{projectId}/revisions/{revisionId}/design-concepts`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | object[] | yes |  |
| `nextCursor` | string \| null | yes |  |

## POST `/api/projects/{projectId}/revisions/{revisionId}/design-concepts`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `scope` | "INTERIOR" \| "EXTERIOR" | yes |  |
| `text` | string |  |  |
| `alternatives` | integer |  |  |
| `spaceIds` | string[] |  |  |
| `useBrief` | boolean |  |  |
| `referenceIds` | string (uuid)[] |  |  |
| `generator` | "AUTO" \| "PROVIDER" \| "TEMPLATE" |  |  |
| `variation` | integer |  |  |

**200**: An identical request replays the stored set (`replayed: true`) (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectRevisionId` | string (uuid) | yes |  |
| `scope` | "INTERIOR" \| "EXTERIOR" | yes |  |
| `conceptSetVersion` | "design-concept-set-v1" | yes |  |
| `source` | "PROVIDER" \| "DETERMINISTIC_TEMPLATE" | yes |  |
| `providerId` | string \| null | yes |  |
| `modelId` | string \| null | yes |  |
| `alternativeCount` | integer | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `contentHash` | string | yes |  |
| `createdAt` | string | yes |  |
| `conceptSet` | object | yes |  |
| `currency` | object | yes |  |
| `replayed` | boolean | yes |  |

**201**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectRevisionId` | string (uuid) | yes |  |
| `scope` | "INTERIOR" \| "EXTERIOR" | yes |  |
| `conceptSetVersion` | "design-concept-set-v1" | yes |  |
| `source` | "PROVIDER" \| "DETERMINISTIC_TEMPLATE" | yes |  |
| `providerId` | string \| null | yes |  |
| `modelId` | string \| null | yes |  |
| `alternativeCount` | integer | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `contentHash` | string | yes |  |
| `createdAt` | string | yes |  |
| `conceptSet` | object | yes |  |
| `currency` | object | yes |  |
| `replayed` | boolean | yes |  |

## GET `/api/projects/{projectId}/revisions/{revisionId}/design-concepts/{conceptSetId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `conceptSetId` | path | string (uuid) | yes |
| `require` | query | "current" |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectRevisionId` | string (uuid) | yes |  |
| `scope` | "INTERIOR" \| "EXTERIOR" | yes |  |
| `conceptSetVersion` | "design-concept-set-v1" | yes |  |
| `source` | "PROVIDER" \| "DETERMINISTIC_TEMPLATE" | yes |  |
| `providerId` | string \| null | yes |  |
| `modelId` | string \| null | yes |  |
| `alternativeCount` | integer | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `contentHash` | string | yes |  |
| `createdAt` | string | yes |  |
| `conceptSet` | object | yes |  |
| `currency` | object | yes |  |
| `replayed` | boolean | yes |  |

## GET `/api/projects/{projectId}/revisions/{revisionId}/documents`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `require` | query | "current" |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `documentsVersion` | "construction-documents-v1" | yes |  |
| `binding` | object | yes |  |
| `freshness` | object | yes |  |
| `documents` | object[] | yes |  |
| `notDrawnLevels` | object[] | yes |  |
| `formats` | object[] | yes |  |
| `limitations` | string[] | yes |  |
| `claims` | object | yes |  |
| `manifestHash` | string | yes |  |

## GET `/api/projects/{projectId}/revisions/{revisionId}/documents/plan-sheets/{levelId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `levelId` | path | string | yes |
| `require` | query | "current" |  |

**200**: Binary (`image/svg+xml`, string (binary))

## GET `/api/projects/{projectId}/revisions/{revisionId}/documents/schedules`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `require` | query | "current" |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `schedulesVersion` | "construction-schedules-v1" | yes |  |
| `binding` | object | yes |  |
| `freshness` | object | yes |  |
| `schedules` | object[] | yes |  |
| `claims` | object | yes |  |

## GET `/api/projects/{projectId}/revisions/{revisionId}/documents/schedules/{schedule}/csv`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `schedule` | path | "levels" \| "rooms" \| "doors" \| "windows" \| "openings" | yes |
| `require` | query | "current" |  |

**200**: Binary (`text/csv`, string (binary))

## GET `/api/projects/{projectId}/revisions/{revisionId}/engineering-assessment`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `assessmentVersion` | "engineering-assessment-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `revisionId` | string (uuid) | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `resultHash` | string | yes |  |
| `generatedAt` | string | yes |  |
| `engine` | object | yes |  |
| `context` | object | yes |  |
| `consistency` | "CONSISTENT" \| "PARTIAL" \| "INCONSISTENT" | yes |  |
| `height` | object | yes |  |
| `areas` | object | yes |  |
| `baseGeometry` | object | yes |  |
| `verification` | object | yes |  |
| `findings` | object[] | yes |  |
| `domains` | object[] | yes |  |
| `summary` | object | yes |  |
| `requirements` | object[] | yes |  |
| `sources` | object[] | yes |  |
| `evidence` | object[] | yes |  |
| `cost` | object \| null | yes |  |
| `limitations` | string[] | yes |  |
| `claims` | object | yes |  |

## POST `/api/projects/{projectId}/revisions/{revisionId}/engineering-assessment`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `scope` | "HEIGHT_AND_STOREYS" \| "AREAS_AND_VOLUME" \| "SITE_AND_GEOMETRY" \| "BASE_SLENDERNESS" \| "PRELIMINARY_COST" \| "GRAVITY_LOADS" \| …[] |  |  |
| `declared` | object |  |  |
| `jurisdiction` | object |  |  |
| `occupancy` | object |  |  |
| `structuralSystem` | object |  |  |
| `evidence` | object[] |  |  |
| `cost` | object |  |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `assessmentVersion` | "engineering-assessment-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `revisionId` | string (uuid) | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `resultHash` | string | yes |  |
| `generatedAt` | string | yes |  |
| `engine` | object | yes |  |
| `context` | object | yes |  |
| `consistency` | "CONSISTENT" \| "PARTIAL" \| "INCONSISTENT" | yes |  |
| `height` | object | yes |  |
| `areas` | object | yes |  |
| `baseGeometry` | object | yes |  |
| `verification` | object | yes |  |
| `findings` | object[] | yes |  |
| `domains` | object[] | yes |  |
| `summary` | object | yes |  |
| `requirements` | object[] | yes |  |
| `sources` | object[] | yes |  |
| `evidence` | object[] | yes |  |
| `cost` | object \| null | yes |  |
| `limitations` | string[] | yes |  |
| `claims` | object | yes |  |

## GET `/api/projects/{projectId}/revisions/{revisionId}/engineering-assessment/zones`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `zoneAssessmentVersion` | "zone-assessment-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `revisionId` | string (uuid) | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `resultHash` | string | yes |  |
| `generatedAt` | string | yes |  |
| `engine` | object | yes |  |
| `sourceRevision` | object | yes |  |
| `currency` | object | yes |  |
| `status` | "CONSISTENT" \| "PARTIAL" \| "INCONSISTENT" \| "INVALID_DECLARATION" | yes |  |
| `declaration` | object | yes |  |
| `zones` | object[] | yes |  |
| `interfaces` | object[] | yes |  |
| `summary` | object | yes |  |
| `limitations` | string[] | yes |  |
| `claims` | object | yes |  |

## POST `/api/projects/{projectId}/revisions/{revisionId}/engineering-assessment/zones`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `zones` | object[] |  |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `zoneAssessmentVersion` | "zone-assessment-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `revisionId` | string (uuid) | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `resultHash` | string | yes |  |
| `generatedAt` | string | yes |  |
| `engine` | object | yes |  |
| `sourceRevision` | object | yes |  |
| `currency` | object | yes |  |
| `status` | "CONSISTENT" \| "PARTIAL" \| "INCONSISTENT" \| "INVALID_DECLARATION" | yes |  |
| `declaration` | object | yes |  |
| `zones` | object[] | yes |  |
| `interfaces` | object[] | yes |  |
| `summary` | object | yes |  |
| `limitations` | string[] | yes |  |
| `claims` | object | yes |  |

## POST `/api/projects/{projectId}/revisions/{revisionId}/engineering-assessment/zones/partitions`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `zones` | object[] |  |  |
| `includeModels` | boolean |  |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `partitionVersion` | "zone-partitions-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `revisionId` | string (uuid) | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `resultHash` | string | yes |  |
| `generatedAt` | string | yes |  |
| `engine` | object | yes |  |
| `sourceRevision` | object | yes |  |
| `currency` | object | yes |  |
| `status` | "RECONCILED" \| "NOT_RECONCILED" | yes |  |
| `declaration` | object | yes |  |
| `partitions` | object[] | yes |  |
| `interfaceElements` | object | yes |  |
| `reconciliation` | object | yes |  |
| `validity` | object | yes |  |
| `services` | object[] | yes |  |
| `limitations` | string[] | yes |  |
| `claims` | object | yes |  |

## POST `/api/projects/{projectId}/revisions/{revisionId}/engineering-assessment/zones/regeneration`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `zones` | object[] |  |  |
| `target` | object \| object \| object | yes |  |
| `operation` | object \| object | yes |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `regenerationVersion` | "zone-regeneration-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `revisionId` | string (uuid) | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `resultHash` | string | yes |  |
| `generatedAt` | string | yes |  |
| `sourceRevision` | object | yes |  |
| `currency` | object | yes |  |
| `status` | "CANDIDATE_READY" \| "NO_CHANGE" \| "REFUSED" | yes |  |
| `refusals` | object[] | yes |  |
| `declaration` | object | yes |  |
| `target` | object | yes |  |
| `operation` | object | yes |  |
| `changes` | object \| null | yes |  |
| `preservation` | object \| null | yes |  |
| `qa` | object \| null | yes |  |
| `candidate` | object \| null | yes |  |
| `commit` | object \| null | yes |  |
| `verificationRoute` | string | yes |  |
| `dependencies` | object[] | yes |  |
| `limitations` | string[] | yes |  |
| `claims` | object | yes |  |

## POST `/api/projects/{projectId}/revisions/{revisionId}/engineering-assessment/zones/regeneration-preflight`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `zones` | object[] |  |  |
| `target` | object \| object \| object | yes |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `preflightVersion` | "zone-regeneration-preflight-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `revisionId` | string (uuid) | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `resultHash` | string | yes |  |
| `generatedAt` | string | yes |  |
| `sourceRevision` | object | yes |  |
| `currency` | object | yes |  |
| `status` | "UNSUPPORTED" | yes |  |
| `refusal` | object | yes |  |
| `declaration` | object | yes |  |
| `target` | object | yes |  |
| `preservation` | object | yes |  |
| `dependencies` | object[] | yes |  |
| `missingCapabilities` | object[] | yes |  |
| `alternatives` | object[] | yes |  |
| `roadmapDestination` | object | yes |  |
| `claims` | object | yes |  |

## POST `/api/projects/{projectId}/revisions/{revisionId}/engineering-assessment/zones/regeneration/verification`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `zones` | object[] |  |  |
| `target` | object \| object \| object | yes |  |
| `operation` | object \| object | yes |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `verificationVersion` | "zone-regeneration-verification-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `revisionId` | string (uuid) | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `resultHash` | string | yes |  |
| `generatedAt` | string | yes |  |
| `status` | "VERIFIED" \| "MISMATCH" \| "NOT_REPRODUCIBLE" \| "NO_PARENT" | yes |  |
| `detail` | string | yes |  |
| `parentRevisionId` | string (uuid) \| null | yes |  |
| `parentModelHash` | string \| null | yes |  |
| `operation` | object | yes |  |
| `target` | object \| null | yes |  |
| `recomputed` | object \| null | yes |  |
| `preservation` | object \| null | yes |  |
| `deviation` | object \| null | yes |  |
| `provenanceIdentical` | boolean \| null | yes |  |
| `claims` | object | yes |  |

## GET `/api/projects/{projectId}/revisions/{revisionId}/environmental/analyses`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: JSON success response; schema not exported yet (see route source)

## POST `/api/projects/{projectId}/revisions/{revisionId}/environmental/analyses`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`): EnvironmentalInput

**201**: Success (`application/json`, EnvironmentalDetail)

## GET `/api/projects/{projectId}/revisions/{revisionId}/environmental/analyses/{analysisId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `analysisId` | path | string (uuid) | yes |
| `require` | query | "current" |  |

**200**: Success (`application/json`, EnvironmentalDetail)

## GET `/api/projects/{projectId}/revisions/{revisionId}/environmental/status`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: JSON success response; schema not exported yet (see route source)

## POST `/api/projects/{projectId}/revisions/{revisionId}/environmental/validate`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`): EnvironmentalInput

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/projects/{projectId}/revisions/{revisionId}/evidence-packages`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | object[] | yes |  |
| `nextCursor` | string \| null | yes |  |

## POST `/api/projects/{projectId}/revisions/{revisionId}/evidence-packages`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `mode` | "CURRENT_REVISION" \| "HISTORICAL_SNAPSHOT" |  |  |
| `assessment` | object |  |  |

**201**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectRevisionId` | string (uuid) | yes |  |
| `acceptanceQaId` | string (uuid) | yes |  |
| `packageVersion` | "engineering-evidence-package-v1" | yes |  |
| `createdAs` | "CURRENT_REVISION" \| "HISTORICAL_SNAPSHOT" | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `contentHash` | string | yes |  |
| `graphHash` | string | yes |  |
| `assessmentResultHash` | string | yes |  |
| `manifestHash` | string | yes |  |
| `nodeCount` | integer | yes |  |
| `createdAt` | string | yes |  |
| `package` | object | yes |  |
| `currency` | object | yes |  |

## GET `/api/projects/{projectId}/revisions/{revisionId}/evidence-packages/{packageId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `packageId` | path | string (uuid) | yes |
| `require` | query | "current" |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectRevisionId` | string (uuid) | yes |  |
| `acceptanceQaId` | string (uuid) | yes |  |
| `packageVersion` | "engineering-evidence-package-v1" | yes |  |
| `createdAs` | "CURRENT_REVISION" \| "HISTORICAL_SNAPSHOT" | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `contentHash` | string | yes |  |
| `graphHash` | string | yes |  |
| `assessmentResultHash` | string | yes |  |
| `manifestHash` | string | yes |  |
| `nodeCount` | integer | yes |  |
| `createdAt` | string | yes |  |
| `package` | object | yes |  |
| `currency` | object | yes |  |

## POST `/api/projects/{projectId}/revisions/{revisionId}/instructions/resolve`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `resolutionVersion` | "instruction-resolution-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `revisionId` | string (uuid) | yes |  |
| `revisionNumber` | integer | yes |  |
| `modelHash` | string | yes |  |
| `textHash` | string | yes |  |
| `intent` | "EDIT_EXISTING" \| "REGENERATE_VISUAL_DERIVATIVE" \| "DERIVE_ALTERNATIVE" \| "RECOMPUTE_ENGINEERING" \| "RESTORE_PRIOR" \| "COMPARE_REVISIONS" \| … | yes |  |
| `status` | "RESOLVED" \| "NEEDS_CLARIFICATION" \| "UNSUPPORTED" | yes |  |
| `module` | "INTERIOR" \| "EXTERIOR" \| "BLUEPRINT" \| "MATERIALS" \| "BUDGET" \| "STRUCTURAL" \| … | yes |  |
| `targets` | object[] | yes |  |
| `exclusions` | object[] | yes |  |
| `finishes` | object[] | yes |  |
| `locks` | object[] | yes |  |
| `conflicts` | object[] | yes |  |
| `revisionRefs` | object[] | yes |  |
| `clarifications` | string[] | yes |  |
| `unsupported` | object[] | yes |  |
| `changeSetDraft` | object \| null | yes |  |
| `handoff` | object \| null | yes |  |
| `executed` | false | yes |  |
| `interpretation` | object | yes |  |
| `claims` | object | yes |  |

## GET `/api/projects/{projectId}/revisions/{revisionId}/knowledge/analyses`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: JSON success response; schema not exported yet (see route source)

## POST `/api/projects/{projectId}/revisions/{revisionId}/knowledge/analyses`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`): KnowledgeInput

**201**: Success (`application/json`, KnowledgeDetail)

## GET `/api/projects/{projectId}/revisions/{revisionId}/knowledge/analyses/{analysisId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `analysisId` | path | string (uuid) | yes |
| `require` | query | "current" |  |

**200**: Success (`application/json`, KnowledgeDetail)

## GET `/api/projects/{projectId}/revisions/{revisionId}/knowledge/packs`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/projects/{projectId}/revisions/{revisionId}/knowledge/status`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: JSON success response; schema not exported yet (see route source)

## POST `/api/projects/{projectId}/revisions/{revisionId}/knowledge/validate`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`): KnowledgeInput

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/projects/{projectId}/revisions/{revisionId}/manifest`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `discipline` | query | "ARCHITECTURE" \| "QUANTITIES_AND_COST" \| "ENGINEERING" \| "DESIGN" \| "VISUALIZATION" \| "DOCUMENTATION" |  |
| `artifacts` | query | "include" \| "omit" |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `manifestVersion` | "project-manifest-v2" | yes |  |
| `identity` | object | yes |  |
| `canonicalModel` | object | yes |  |
| `lineage` | object | yes |  |
| `diff` | object | yes |  |
| `changeImpact` | object | yes |  |
| `freshnessImpact` | object | yes |  |
| `candidates` | object | yes |  |
| `failedGenerations` | object | yes |  |
| `configuration` | object | yes |  |
| `modules` | object[] | yes |  |
| `disciplines` | object[] | yes |  |
| `freshnessVocabulary` | object | yes |  |
| `verification` | object | yes |  |
| `accessPolicy` | object | yes |  |
| `notIncluded` | object[] | yes |  |
| `claims` | object | yes |  |
| `integrityCheckedAt` | string (date-time) | yes |  |
| `manifestHash` | string | yes |  |
| `view` | object | yes |  |

## GET `/api/projects/{projectId}/revisions/{revisionId}/optimization/status`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/projects/{projectId}/revisions/{revisionId}/optimization/studies`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: JSON success response; schema not exported yet (see route source)

## POST `/api/projects/{projectId}/revisions/{revisionId}/optimization/studies`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`): OptimizationInput

**201**: Success (`application/json`, OptimizationDetail)

## GET `/api/projects/{projectId}/revisions/{revisionId}/optimization/studies/{studyId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `studyId` | path | string (uuid) | yes |
| `require` | query | "current" |  |

**200**: Success (`application/json`, OptimizationDetail)

## POST `/api/projects/{projectId}/revisions/{revisionId}/optimization/validate`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`): OptimizationInput

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/projects/{projectId}/revisions/{revisionId}/overview`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/projects/{projectId}/revisions/{revisionId}/scene/artifacts`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: JSON success response; schema not exported yet (see route source)

## POST `/api/projects/{projectId}/revisions/{revisionId}/scene/artifacts`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`): object

**201**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectRevisionId` | string (uuid) | yes |  |
| `acceptanceQaId` | string (uuid) | yes |  |
| `manifestVersion` | "scene-manifest-v1" | yes |  |
| `compilerVersion` | "scene-compiler-v1" | yes |  |
| `validatorVersion` | "scene-validator-v1" | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `sceneHash` | string | yes |  |
| `binarySha256` | string | yes |  |
| `binaryBytes` | integer | yes |  |
| `storageLocator` | "postgres-bytea" | yes |  |
| `status` | "READY" | yes |  |
| `objectCount` | integer | yes |  |
| `triangleCount` | integer | yes |  |
| `createdAt` | string | yes |  |
| `manifest` | SceneManifest | yes |  |

## GET `/api/projects/{projectId}/revisions/{revisionId}/scene/artifacts/{artifactId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `artifactId` | path | string (uuid) | yes |
| `require` | query | "current" |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `projectRevisionId` | string (uuid) | yes |  |
| `acceptanceQaId` | string (uuid) | yes |  |
| `manifestVersion` | "scene-manifest-v1" | yes |  |
| `compilerVersion` | "scene-compiler-v1" | yes |  |
| `validatorVersion` | "scene-validator-v1" | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `sceneHash` | string | yes |  |
| `binarySha256` | string | yes |  |
| `binaryBytes` | integer | yes |  |
| `storageLocator` | "postgres-bytea" | yes |  |
| `status` | "READY" | yes |  |
| `objectCount` | integer | yes |  |
| `triangleCount` | integer | yes |  |
| `createdAt` | string | yes |  |
| `currency` | any |  |  |

## GET `/api/projects/{projectId}/revisions/{revisionId}/scene/artifacts/{artifactId}/glb`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `artifactId` | path | string (uuid) | yes |
| `require` | query | "current" |  |

**200**: Binary (`model/gltf-binary`, string (binary))

**304**: Not modified (If-None-Match)

## GET `/api/projects/{projectId}/revisions/{revisionId}/scene/artifacts/{artifactId}/manifest`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `artifactId` | path | string (uuid) | yes |
| `require` | query | "current" |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `artifactId` | string (uuid) | yes |  |
| `sceneHash` | string | yes |  |
| `currency` | any |  |  |
| `manifest` | SceneManifest | yes |  |

## GET `/api/projects/{projectId}/revisions/{revisionId}/scene/delivery`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `artifactId` | query | string (uuid) |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `deliveryVersion` | "scene-delivery-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `revisionId` | string (uuid) | yes |  |
| `modelHash` | string | yes |  |
| `revisionCurrency` | "CURRENT" \| "HISTORICAL" | yes |  |
| `artifact` | object | yes |  |
| `frame` | object | yes |  |
| `bounds` | object | yes |  |
| `chunks` | object[] | yes |  |
| `pickAnchors` | object[] | yes |  |
| `navigation` | object | yes |  |
| `budgets` | object[] | yes |  |
| `cache` | object | yes |  |
| `media` | object[] | yes |  |
| `nonWebGlFallback` | object | yes |  |
| `clientPerformance` | object | yes |  |

**304**: Not modified (If-None-Match)

## GET `/api/projects/{projectId}/revisions/{revisionId}/scene/status`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: JSON success response; schema not exported yet (see route source)

## POST `/api/projects/{projectId}/revisions/{revisionId}/scene/validate`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`): object

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/projects/{projectId}/revisions/{revisionId}/structural/analyses`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: JSON success response; schema not exported yet (see route source)

## POST `/api/projects/{projectId}/revisions/{revisionId}/structural/analyses`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`): StructuralInput

**201**: Success (`application/json`, StructuralDetail)

## GET `/api/projects/{projectId}/revisions/{revisionId}/structural/analyses/{analysisId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `analysisId` | path | string (uuid) | yes |
| `require` | query | "current" |  |

**200**: Success (`application/json`, StructuralDetail)

## GET `/api/projects/{projectId}/revisions/{revisionId}/structural/status`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: JSON success response; schema not exported yet (see route source)

## POST `/api/projects/{projectId}/revisions/{revisionId}/structural/validate`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`): StructuralInput

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/projects/{projectId}/revisions/{revisionId}/systems/analyses`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: JSON success response; schema not exported yet (see route source)

## POST `/api/projects/{projectId}/revisions/{revisionId}/systems/analyses`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`): SystemsInput

**201**: Success (`application/json`, SystemsDetail)

## GET `/api/projects/{projectId}/revisions/{revisionId}/systems/analyses/{analysisId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `analysisId` | path | string (uuid) | yes |
| `require` | query | "current" |  |

**200**: Success (`application/json`, SystemsDetail)

## GET `/api/projects/{projectId}/revisions/{revisionId}/systems/status`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: JSON success response; schema not exported yet (see route source)

## POST `/api/projects/{projectId}/revisions/{revisionId}/systems/validate`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`): SystemsInput

**200**: JSON success response; schema not exported yet (see route source)

## GET `/api/projects/{projectId}/revisions/{revisionId}/takeoffs`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | object[] | yes |  |
| `nextCursor` | string \| null | yes |  |

## POST `/api/projects/{projectId}/revisions/{revisionId}/takeoffs`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `options` | object |  |  |

**201**: Success (`application/json`, TakeoffDetail)

## GET `/api/projects/{projectId}/revisions/{revisionId}/takeoffs/{takeoffId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `takeoffId` | path | string (uuid) | yes |

**200**: Success (`application/json`, TakeoffDetail)

## GET `/api/projects/{projectId}/revisions/{revisionId}/takeoffs/{takeoffId}/construction-calculations`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `takeoffId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | object[] | yes |  |
| `nextCursor` | string \| null | yes |  |

## POST `/api/projects/{projectId}/revisions/{revisionId}/takeoffs/{takeoffId}/construction-calculations`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `takeoffId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `specification` | object | yes |  |
| `options` | object |  |  |

**201**: Success (`application/json`, ConstructionDetail)

## GET `/api/projects/{projectId}/revisions/{revisionId}/takeoffs/{takeoffId}/construction-calculations/{calculationId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `takeoffId` | path | string (uuid) | yes |
| `calculationId` | path | string (uuid) | yes |

**200**: Success (`application/json`, ConstructionDetail)

## POST `/api/projects/{projectId}/revisions/{revisionId}/takeoffs/{takeoffId}/construction-calculations/{calculationId}/cost-estimates`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |
| `takeoffId` | path | string (uuid) | yes |
| `calculationId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `rateBookId` | "sample-inr-v1" \| "sample-inr-v2" | yes |  |
| `costingPolicy` | object | yes |  |
| `options` | object |  |  |

**201**: Success (`application/json`, CostDetail)

## GET `/api/projects/{projectId}/revisions/{revisionId}/verification`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `verifierVersion` | "complex-verification-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `revisionId` | string (uuid) | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `status` | "VERIFIED" \| "VERIFIED_WITH_WARNINGS" \| "PARTIAL" \| "FAILED" | yes |  |
| `bases` | object | yes |  |
| `checks` | object[] | yes |  |
| `summary` | object | yes |  |
| `declaredLimits` | object \| null | yes |  |
| `budget` | object | yes |  |
| `claims` | object | yes |  |

## POST `/api/projects/{projectId}/revisions/{revisionId}/verification`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `declaredLimits` | object |  |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `verifierVersion` | "complex-verification-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `revisionId` | string (uuid) | yes |  |
| `modelHash` | string | yes |  |
| `inputHash` | string | yes |  |
| `status` | "VERIFIED" \| "VERIFIED_WITH_WARNINGS" \| "PARTIAL" \| "FAILED" | yes |  |
| `bases` | object | yes |  |
| `checks` | object[] | yes |  |
| `summary` | object | yes |  |
| `declaredLimits` | object \| null | yes |  |
| `budget` | object | yes |  |
| `claims` | object | yes |  |

## POST `/api/projects/{projectId}/revisions/{revisionId}/verification/diff`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `revisionId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `otherRevisionId` | string (uuid) | yes |  |
| `scope` | object | yes |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `diffVersion` | "scoped-diff-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `baseRevisionId` | string (uuid) | yes |  |
| `otherRevisionId` | string (uuid) | yes |  |
| `baseModelHash` | string | yes |  |
| `otherModelHash` | string | yes |  |
| `status` | "IDENTICAL" \| "WITHIN_SCOPE" \| "OUT_OF_SCOPE_CHANGES" | yes |  |
| `scope` | object | yes |  |
| `changes` | object[] | yes |  |
| `violations` | object[] | yes |  |
| `counts` | object | yes |  |

## POST `/api/projects/{projectId}/revisions/generate`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `requirements` | BlueprintRequirements | yes |  |
| `baseRevisionId` | string (uuid) \| null |  |  |

**201**: Success (`application/json`, RevisionCommitResponse)

## POST `/api/projects/{projectId}/routing/decisions`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `targetScopes` | "FACADE_APPEARANCE" \| "INTERIOR_FINISHES" \| "FLOOR_PLAN" \| "STRUCTURE" \| "QUANTITIES" \| "COST" \| …[] | yes |  |
| `privacyClass` | "LOCAL_ONLY" \| "REMOTE_ALLOWED" \| "PUBLIC_NON_SENSITIVE" |  |  |
| `allowMetered` | boolean |  |  |

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `routingVersion` | "capability-routing-v1" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `decisionHash` | string | yes |  |
| `targetScopes` | "FACADE_APPEARANCE" \| "INTERIOR_FINISHES" \| "FLOOR_PLAN" \| "STRUCTURE" \| "QUANTITIES" \| "COST" \| …[] | yes |  |
| `effectivePrivacyClass` | "LOCAL_ONLY" \| "REMOTE_ALLOWED" \| "PUBLIC_NON_SENSITIVE" | yes |  |
| `effectiveAllowMetered` | boolean | yes |  |
| `invoke` | object[] | yes |  |
| `notInvoked` | object[] | yes |  |
| `refused` | object[] | yes |  |
| `staleIfChanged` | string[] | yes |  |
| `quote` | object | yes |  |
| `executed` | false | yes |  |

## POST `/api/projects/{projectId}/specialists/{module}/requests`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `module` | path | "INTERIOR" \| "EXTERIOR" \| "BLUEPRINT" \| "STRUCTURAL" \| "MATERIALS" \| "BUDGET" | yes |

Request body (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `envelopeVersion` | "specialist-request-v1" | yes |  |
| `baseRevisionId` | string (uuid) | yes |  |
| `operation` | "modify" \| "regenerate" \| "generate_alternative" \| "recompute" \| "compare" \| "restore" | yes |  |
| `instruction` | string |  |  |
| `targetScopes` | "building.geometry" \| "building.floor_plans" \| "building.structure" \| "exterior.facade" \| "exterior.materials" \| "exterior.render" \| …[] | yes |  |
| `preserveScopes` | "building.geometry" \| "building.floor_plans" \| "building.structure" \| "exterior.facade" \| "exterior.materials" \| "exterior.render" \| …[] |  |  |
| `referenceIds` | string (uuid)[] |  |  |
| `budget` | object |  |  |
| `outputConfig` | object |  |  |

**200**: A typed refusal (written: false; nothing stored), or a replay of an earlier request (replayed: true). 201 means this request stored something, even with status FAILED (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `envelopeVersion` | "specialist-request-v1" | yes |  |
| `module` | "INTERIOR" \| "EXTERIOR" \| "BLUEPRINT" \| "STRUCTURAL" \| "MATERIALS" \| "BUDGET" | yes |  |
| `operation` | "modify" \| "regenerate" \| "generate_alternative" \| "recompute" \| "compare" \| "restore" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `baseRevisionId` | string (uuid) | yes |  |
| `resultRevisionId` | string (uuid) \| null | yes | The revision this request committed, which is now the project's current revision; non-null even when status is FAILED (a Blueprint revision that failed independent verification after it was committed). Refresh the current revision whenever it is non-null. |
| `status` | "COMPLETED" \| "CANDIDATE_READY" \| "AWAITING_CONSENT" \| "NEEDS_CLARIFICATION" \| "UNSUPPORTED" \| "REQUIRES_REVIEW" \| … | yes | The outcome of the checks; it does not say whether anything was stored: read written and resultRevisionId for that |
| `reasons` | object[] | yes |  |
| `targetScopes` | "building.geometry" \| "building.floor_plans" \| "building.structure" \| "exterior.facade" \| "exterior.materials" \| "exterior.render" \| …[] | yes |  |
| `preserveScopes` | "building.geometry" \| "building.floor_plans" \| "building.structure" \| "exterior.facade" \| "exterior.materials" \| "exterior.render" \| …[] | yes |  |
| `written` | boolean | yes | true when this request stored something (a revision or an artifact), whatever its status; false for every refusal |
| `replayed` | boolean | yes |  |
| `operationId` | string (uuid) \| null | yes |  |
| `jobIds` | string (uuid)[] | yes |  |
| `artifacts` | object[] | yes |  |
| `locks` | object[] | yes |  |
| `impacts` | object[] | yes |  |
| `references` | object[] | yes |  |
| `budget` | object \| null | yes |  |
| `details` | object \| object \| object \| object \| object \| object \| object | yes |  |
| `changeImpact` | object \| null | yes |  |
| `quote` | object | yes |  |
| `provenance` | object | yes |  |
| `manifestHref` | string | yes |  |
| `claims` | object | yes |  |

**201**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `envelopeVersion` | "specialist-request-v1" | yes |  |
| `module` | "INTERIOR" \| "EXTERIOR" \| "BLUEPRINT" \| "STRUCTURAL" \| "MATERIALS" \| "BUDGET" | yes |  |
| `operation` | "modify" \| "regenerate" \| "generate_alternative" \| "recompute" \| "compare" \| "restore" | yes |  |
| `projectId` | string (uuid) | yes |  |
| `baseRevisionId` | string (uuid) | yes |  |
| `resultRevisionId` | string (uuid) \| null | yes | The revision this request committed, which is now the project's current revision; non-null even when status is FAILED (a Blueprint revision that failed independent verification after it was committed). Refresh the current revision whenever it is non-null. |
| `status` | "COMPLETED" \| "CANDIDATE_READY" \| "AWAITING_CONSENT" \| "NEEDS_CLARIFICATION" \| "UNSUPPORTED" \| "REQUIRES_REVIEW" \| … | yes | The outcome of the checks; it does not say whether anything was stored: read written and resultRevisionId for that |
| `reasons` | object[] | yes |  |
| `targetScopes` | "building.geometry" \| "building.floor_plans" \| "building.structure" \| "exterior.facade" \| "exterior.materials" \| "exterior.render" \| …[] | yes |  |
| `preserveScopes` | "building.geometry" \| "building.floor_plans" \| "building.structure" \| "exterior.facade" \| "exterior.materials" \| "exterior.render" \| …[] | yes |  |
| `written` | boolean | yes | true when this request stored something (a revision or an artifact), whatever its status; false for every refusal |
| `replayed` | boolean | yes |  |
| `operationId` | string (uuid) \| null | yes |  |
| `jobIds` | string (uuid)[] | yes |  |
| `artifacts` | object[] | yes |  |
| `locks` | object[] | yes |  |
| `impacts` | object[] | yes |  |
| `references` | object[] | yes |  |
| `budget` | object \| null | yes |  |
| `details` | object \| object \| object \| object \| object \| object \| object | yes |  |
| `changeImpact` | object \| null | yes |  |
| `quote` | object | yes |  |
| `provenance` | object | yes |  |
| `manifestHref` | string | yes |  |
| `claims` | object | yes |  |

## GET `/api/projects/{projectId}/workflows`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `limit` | query | integer |  |
| `cursor` | query | string |  |

**200**: JSON success response; schema not exported yet (see route source)

## POST `/api/projects/{projectId}/workflows`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`): WorkflowRequest

**201**: Success (`application/json`, WorkflowRun)

## GET `/api/projects/{projectId}/workflows/{workflowRunId}`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |
| `workflowRunId` | path | string (uuid) | yes |

**200**: Success (`application/json`, WorkflowRun)

## POST `/api/projects/{projectId}/workflows/plan`

Auth: bearer (Supabase session)

| Parameter | In | Type | Required |
|---|---|---|---|
| `projectId` | path | string (uuid) | yes |

Request body (`application/json`): WorkflowRequest

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `projectId` | string (uuid) | yes |  |
| `sourceRevisionId` | string (uuid) \| null | yes |  |
| `inputFingerprint` | string | yes |  |
| `plan` | WorkflowPlan | yes |  |

## GET `/api/reference-downloads`

Auth: none

| Parameter | In | Type | Required |
|---|---|---|---|
| `token` | query | string | yes |

**200**: Binary (`application/octet-stream`, string (binary))

**304**: Not modified (If-None-Match)

## GET `/api/regions`

Auth: none

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `regions` | object[] | yes |  |
| `lastUpdated` | string (date) | yes |  |

## GET `/api/routing/capabilities`

Auth: bearer (Supabase session)

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `routingVersion` | "capability-routing-v1" | yes |  |
| `defaultPrivacyClass` | "LOCAL_ONLY" \| "REMOTE_ALLOWED" \| "PUBLIC_NON_SENSITIVE" | yes |  |
| `allowMetered` | boolean | yes |  |
| `capabilities` | object[] | yes |  |
| `credentials` | object | yes |  |

## GET `/health/live`

Auth: none

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | "ok" | yes |  |

## HEAD `/health/live`

Auth: none

**200**: The GET response headers, without a body

## GET `/health/ready`

Auth: none

**200**: Success (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | "ok" \| "unavailable" | yes |  |

## HEAD `/health/ready`

Auth: none

**200**: The GET response headers, without a body

