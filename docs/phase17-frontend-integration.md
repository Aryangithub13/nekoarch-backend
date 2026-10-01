# External frontend integration contract

No frontend is implemented in this repository. These requirements must be applied
and tested in the actual client before claiming that the original UI observation
is fixed. Backend HTTP contract tests cannot prove a browser disposes meshes or
updates its visible state.

## Native V2 request and response

1. GET `/api/projects/{projectId}?includeFreshness=true` with the owner JWT. Retain
   `currentRevisionId` as the explicit base for the next operation.
2. Submit POST `/api/projects/{projectId}/revisions/generate` with
   `{baseRevisionId, requirements}`. Requirements use the existing strict schema
   in `packages/generator/src/blueprint/input.ts`, integer millimetres, and
   `requirements.seed`. See `phase17-example.json` for five real input/response
   identities. Send a fresh `Idempotency-Key` for each new user intent. Keep that
   key only for retries of the identical canonical request.
3. Read `revision.id`, `revision.parentRevisionId`, `revision.revisionNumber`,
   `revision.generatorVersion`, `revision.identity`, `revision.normalizedRequirements`,
   `revision.qa.id` and `revision.model`. The identity has `generationId`,
   `requirementsHash`, `modelHash`, `seed` and `identityVersion`.
4. The response's `project.currentRevisionId` describes that commit. Exact retry
   replay can return this historical snapshot. Re-fetch the project to determine
   the current pointer. Its current revision and artifact states come from one
   database snapshot. A later writer can still advance it after the read.

An alternative uses the same structured requirements, a deliberately changed
seed, a fresh idempotency key and the current base. The model hash might remain
unchanged if canonical outputs converge. Do not claim a different layout from a
new generation ID alone. A supplied-model save has model identity but no new
execution ID or normalized generator requirements.

Workflow callers use the existing GENERATE or REVISION discriminant. Follow
`sourceRevisionId` to GET that immutable revision for its identity and model.
A workflow manifest stays attached to its source revision even when the project
advances. `outputs[].status` distinguishes CREATED from REUSED. BLOCKED, FAILED
and PARTIALLY_COMPLETED must be handled explicitly; HTTP 201 alone does not mean
that a new model was accepted. Keyless workflows retain Phase 16's deterministic
request convergence. Choose an explicit fresh key for a new execution intent.

## Cache and display identity

Use the client framework's equivalent of:

| Data | Identity |
| --- | --- |
| Mutable owner project | owner/session + projectId; refresh after a write/retry/conflict |
| Immutable revision/blueprint | projectId + revisionId |
| Model scene/view | projectId + revisionId + modelHash (fall back to revisionId for historical unknown identity) |
| Derived panel | projectId + sourceRevisionId + artifactId; include options if querying compatible variants |

`model.id` is an entity identifier local to a model. The generator uses
`"blueprint"` for different models. It is unsuitable as a query key, scene key,
asset URL or global store identity. Never retain an old project-wide model object
when a current revision changes. Invalidate the mutable project query, adopt the
new current revision, and re-key only affected model/derived queries. Preserve
historical caches under their immutable identities. Clear all owner caches on
sign-out or account switch.

For each current artifact family, `AVAILABLE` returns the artifact ID,
`sourceRevisionId` and upstream `sourceArtifactIds`. Otherwise show
`NOT_GENERATED_FOR_CURRENT_REVISION`; empty projects show `NO_CURRENT_REVISION`.
A reference is selected within its exact current revision, but separate latest
references need not share options or a calculation chain. Use a workflow for
compatible chained outputs and validate its source revision before using it in
current panels. Re-check the active revision when every artifact request resolves.

Mount or replace an existing viewer by revision/model identity and dispose the
old scene's geometries, materials, textures and subscriptions when appropriate.
No connected viewer exists here to test that lifecycle. Future asset URLs must
include revision/artifact/content identity. The API already sends no-store;
service-worker caches must respect this for mutable project/workflow resources.

## Out-of-order completion

Increment a local intent counter synchronously when a new input is submitted,
before awaiting any request. Associate every generation result, project refresh,
artifact request, error and loading-state change with that counter and project.
Only the current counter/project may update the visible state. Guard project
refreshes as well as generation responses. Keep a separate refresh counter for
concurrent reads within one intent; use revision numbers to reject older snapshots
and artifact ID/source checks for downstream data.

Conceptual client sequence (adapt to the actual state/query framework):

```ts
const intent = ++activeIntent;
const projectId = selectedProjectId;
const result = await generate({ projectId, baseRevisionId, requirements, key });
if (intent !== activeIntent || projectId !== selectedProjectId) return;
// The result identifies the accepted attempt, including durable historical replay.
const snapshot = await getProject(projectId, { includeFreshness: true });
if (intent !== activeIntent || projectId !== selectedProjectId) return;
if ((snapshot.currentRevision?.revisionNumber ?? 0) < displayedRevisionNumber) return;
applyCurrentSnapshot(snapshot); // atomically re-key model and derived panels
```

Aborting superseded requests is optional and does not undo a server commit.
Do not automatically rebase and retry a 409 `REVISION_CONFLICT`: show the conflict
and fresh server state, retaining the newer unsaved input. A 409
`IDEMPOTENCY_CONFLICT` means the key was used for different intent; do not display
an old result. Never use a sequence counter to claim an unaccepted request won
backend concurrency.

Required external UI tests: A starts, B starts, B is displayed, A arrives last;
late project refresh; late R1 calculation after R2 adoption; project switch during
generation; account switch; retry of R1 after R2 is current; reused scene ID with
changed rooms/site. The repository tests the identities/current pointer and
controlled response delivery, not an invented UI implementation.

## Historical data and Phase 18

Newly read historical revisions return `identity: null` and
`normalizedRequirements: null`. Pre-Phase-17 durable receipts can omit these fields
entirely to preserve their original body. Treat both as unknown. Never infer old
requirements from geometry or invent a generation UUID.

The legacy `/api/plans/generate` route accepts limited prompt grammar and produces
V1 plans, not V2 project revisions. It does not move a native project's current
pointer. Do not mix those response contracts. Phase 18 will convert language into
validated V2 structured requirements; it must not produce trusted coordinates.
