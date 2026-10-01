# Phase 17 — generation identity and freshness

## Pre-flight and diagnosis (before implementation)

On 2026-10-01, `git status --short` was empty; HEAD was
`7a335acae6e2fe098d43172cb18a5366ce58ec5c`. Both `git tag --points-at HEAD`
and `git tag --list backend-v1-phase16-complete` returned that checkpoint.
No commits, tags, resets, or historical-data changes are authorized here.

Repository search found no frontend implementation. `apps/web/README.md` reserves
it for later; root workspaces contain only the API and deterministic engines.
There is no UI state, query cache, blueprint renderer, connected 3D viewer, or
model-file URL to repair or test in this repository.

The baseline controlled generator reproduction changed bedroom count from 3 to 4
with seed `qa` and the existing 10000 × 12000 mm fixture. Both attempts evaluated
32 candidates and produced the requested bedroom counts. Full-model diagnostic
SHA-256 values were `42823b413decce6330bc70deb816494c847b8bc4708f313b4dcc50aa54528478`
and `427ff990fb1c477603560e19517325f9fdeb9e9a0bec0e0d0d1ed183f56521af`.
Both models have `model.id = "blueprint"`. These are baseline diagnostic digests,
not the Phase 17 model-hash definition below. Reusing this local entity ID as a
global cache/viewer identity would alias different buildings. No external client
trace was supplied, so that client failure is a hypothesis, not a confirmed cause.

Confirmed contract gaps: direct generated revisions retain seed/version in model
provenance but discard normalized requirements and generator execution identity;
they expose no content identity. Exact durable replay intentionally returns an
old commit's `project.currentRevisionId` after the actual project has advanced.
That field is a commit snapshot, not a fresh current-state read. Tests will prove
this distinction rather than change correct replay semantics.

## Discovered end-to-end paths

| Stage | Actual implementation |
| --- | --- |
| User input / frontend construction | External; no implementation here |
| Legacy prompt HTTP | `apps/api/src/routes/plans.ts`, POST `/api/plans/generate` |
| Legacy structured adapter | `contracts/generation.ts`; `services/generation-service.ts::generateAndSavePlan`; `packages/generator/src/input.ts::parseRequirements` |
| Legacy generation / persistence | `generatePlan` → `createPlan` → `durablePost`; V1 plan, not a native V2 project revision |
| V2 HTTP | `routes/projects.ts`, POST `/api/projects/:projectId/revisions/generate` |
| V2 canonical request | `contracts/projects.ts::GenerateRevisionRequestSchema` → `normalizeBlueprintRequirements` |
| Workflow HTTP | `routes/workflows.ts` → `WorkflowRequestSchema` → `durableCommand` → `services/workflow-service.ts::executeWorkflow` |
| Workflow source selection | `workflows/sources.ts::resolveWorkflow`: explicit GENERATE executes; explicit REVISION reuses that immutable revision |
| Generation / seed | `services/project-service.ts::saveProjectRevision` → `packages/generator/src/blueprint/generate.ts::generateBlueprint`; seed is `requirements.seed`, default `blueprint-default` |
| Normalization / candidate search | `blueprint/input.ts::normalizeBlueprintRequirements`; `layout.ts::candidateSchedule` / `allocateCandidate`; `entities.ts::constructModel`; `validation.ts::validateBlueprint` |
| Independent QA | `auditBlueprint(model, projectQaOptions(model))` in project service |
| Persistence / current CAS | `lib/project-repository.ts` → signed `public.project_write` in migration 0006; locked base comparison, immutable revision + QA + pointer + receipt in one transaction |
| Workflow atomic manifest | `public.workflow_write` in migration 0010 wraps the same signed commit and records output references atomically |
| Serialization / current reads | project DTO projections → `ProjectRevisionDetailSchema` / `RevisionCommitResponseSchema`; GET project uses `project_read` / `project_detail` |
| HTTP caching | `app.ts::onRequest` already sends `Cache-Control: no-store`; retain it |
| Frontend response, invalidation, display | External responsibility; integration contract and controlled response-order test supplied here |

## Identity design

Use SHA-256 with existing sorted-key canonical JSON (`costHash` / SQL
`project_private.cost_hash`); no engine changes. Identity version is
`generation-freshness-v1`.

`requirementsHash` hashes `{identityVersion, generatorVersion, requirements}`
where requirements are generator-normalized millimetre inputs, including solver
options, but excluding seed. Seed remains a separate reproducibility input. No
prompt interpretation, UUID, clock, base revision, or UI state enters this hash.
The existing request fingerprint still includes seed, base, mode and all options.

`modelHash` hashes `{identityVersion, model}` after removing model provenance and
sorting top-level entity collections by ID and wall `spaceIds` as a set. Polygon
vertices, dimension anchors, segments and other ordered geometry retain order.
Names, IDs, dimensions, specifications and authoritative geometry remain part of
the building identity. This is canonical model identity, not geometric isomorphism
under relabeling. Excluding seed/version provenance prevents claiming different
geometry merely because an explicit alternative seed converged to the same model.

`generationId` is a server UUID assigned immediately before actual V2 generator
execution. Accepted attempts retain it; failed attempts have bounded log evidence
but no accepted revision. Supplied models have no generation ID or requirements
hash. `revision.id` identifies the immutable accepted record;
`parentRevisionId` is the committed `baseRevisionId`. Existing generatorVersion,
QA ID, createdAt and workflow ID are reused. No redundant route family is needed.

## Persistence, security and freshness

One additive migration `0011_generation_freshness.sql` is necessary: direct
revision requests have no durable normalized-input storage (keyless requests
have no receipt). Add nullable identity and normalized-requirements columns to
the existing immutable, owner-protected revision table. Historical rows/receipts
remain explicitly unknown; no guessed inputs or backfill. Extend the existing
signed atomic commit and projections. The database independently verifies stored
hashes against signed model/input; strict HTTP schemas reject client identities.
Existing RLS, HMAC, owner checks, accepted QA and CAS remain authoritative.

Current project reads can explicitly request a bounded freshness snapshot with
`?includeFreshness=true`. It uses one database snapshot and only artifacts whose
source revision equals that snapshot's current revision. Each artifact family
reports `AVAILABLE` or `NOT_GENERATED_FOR_CURRENT_REVISION` (or `NO_CURRENT_REVISION`).
References retain upstream IDs; independent latest artifacts are not a claim of
compatible options. Use workflows to select a compatible calculation chain.
Historical endpoints and immutable manifests remain available.

Durable same-key/same-request replay is exact within the existing receipt retention window; Phase 17 does not change that retention. Changed requirements, seed, base,
mode, output intent or options conflict. A replay is never proof of present
current state. Re-fetch the owner project after success/replay. A stale base
cannot overwrite another accepted revision; no last-write-wins behavior.

## External frontend contract and Phase 18 boundary

Cache by project + revision, and model/viewer by revision + modelHash, never
`model.id`. New intent gets a fresh idempotency key; retries retain it. An explicit
alternative changes `requirements.seed`, uses the current base, and a fresh key.
Track an incrementing intent sequence before starting requests. Guard generation,
current-state refresh and downstream fetch completions against that sequence and
project; discard superseded responses even if they finish last. Also compare
revision number when applying snapshots from concurrent readers. Abort is an
optimization, not the correctness mechanism. Clear/re-key downstream panels on
revision change. Dispose scene resources/remount by revision/model identity in
the external viewer. Use revision/artifact/content-specific future file URLs.

There is no architectural natural-language interpreter for native V2 here. The
legacy prompt parser has a bounded grammar and ignores style prose for layout.
Phase 18 interprets language into validated structured requirements, then calls
this contract. No LLM-produced coordinates, Solver V2, drawings, scenes, new
calculation algorithms, paid services or infrastructure are added.

## Implemented contract details and review

The implemented identity lives at `revision.identity`; normalized requirements
are returned only on revision detail. `revision.identity = null` explicitly marks
unknown historical rows. The two fields are optional only for old durable
receipts: adding even null-valued keys to those responses would break exact replay.
A regression test seeds the old receipt shape and verifies its unchanged body.
The new revision table columns are protected by the existing UPDATE immutability
trigger and owner RLS; their generation ID has a unique partial index. The
`valid_generation_identity` database constraint recomputes both digests and checks
seed/version provenance and generated/supplied semantics. Existing signed older
integrations can still write an unknown identity, preserving prior behavior;
ordinary clients cannot invoke a signed write without the server attestation.

The migration replaces only existing project DTO projections and the existing
project RPC definitions, retaining all lock, receipt, HMAC, QA and CAS logic.
It adds private canonicalization/current-reference helpers, one generation-ID
index, and an index for bounded current construction lookup. No new table, service,
permission grant, public diagnostic route, cache or engine is introduced.

`GET /api/projects/{id}?includeFreshness=true` opts into the artifact projection;
plain project reads preserve their previous calculation-independent semantics.
This avoids making a previously stable project DTO change whenever a calculation
is generated. Both forms already inherit the existing `no-store` header.

Bounded Pino events now record generator start/execution (IDs, hashes, seed,
version and candidate counts), durable receipt replay (request fingerprint),
revision results (committed pointer and identity), current/revision reads and
workflow output references. Logs never include raw requirements, model bodies,
QA reports, prompts, tokens or HMAC envelopes. Concurrent identical requests can
both execute before the database serializes them; they return the winning durable
revision identity. A start/execution event alone is not proof of acceptance.
Failed attempts do not create immutable revisions or durable generation rows.

The external client must log its intent sequence, requested revision ID and
actually displayed revision/model hash in its own bounded diagnostics. The
backend cannot observe a browser display. See `phase17-frontend-integration.md`
for cache keys, re-fetch rules, replay behavior, intent guards and viewer lifecycle.

Tests cover pure hashes and deterministic generation, real A/B/C/A/D output,
workflow generation/replay, explicit seed alternatives, old derived references,
concurrency, response-delivery identity, ownership, forged identity, database
verification, historical unknowns, and exact pre-Phase-17 receipt replay. Eight
shared HTTP cases run unchanged through both PostgreSQL and live Supabase.
