# Phase 16 — multi-mode workflow architecture

Baseline gate (2026-09-30): repository is `/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow`; clean HEAD `1de93400a8ed768b438b2d5a35a197524c546374` equals `backend-v1-phase15-complete`, with an empty tag-to-HEAD diff. This design precedes production implementation.

Resumption (2026-10-01): the new session confirmed the same HEAD/tag and empty commit diff, but found this implementation already uncommitted. It stopped at the clean-tree gate. The user explicitly authorized continuing that work. Existing files and prior verification evidence were preserved; no reset, stash, commit or tag was performed. Review retained the existing architecture and added shared PostgreSQL/live-Supabase acceptance for required takeoff success alongside optional cost failure and unavailable optional 3D.

## 1. Modes and identity

Six strict discriminants: COMPLETE_BUILDING runs the available building pipeline; BLUEPRINT_ONLY stops at an accepted revision unless outputs are explicitly extended; INTERIOR_ONLY targets existing revision spaces; EXTERIOR_ONLY targets a facade; THREE_D_ONLY requires accepted V2 geometry; ENGINEERING_ONLY requires an accepted architectural source and declares the future engineering context. The last four are contracts, not engines. All runs belong to an existing owner-controlled project. Standalone, geometry-free design is a future extension, not an implicit second project system.

A workflow has a UUID, workflow version, normalized mode-specific request, deterministic input fingerprint, explicit project and source revision, plan, capability versions, compact output references, bounded errors, and timestamps. Generation has an explicit nullable baseRevisionId; reuse has an explicit sourceRevisionId. Never resolve a mutable latest revision for a derived request.

## 2. Registry and dependency graph

A source-controlled registry uses strict capability and artifact enums. Entries carry version, AVAILABLE/PLANNED/DISABLED status, versioned dependencies, accepted inputs and produced artifact type. Validate uniqueness, dependency existence/version, artifact types, mode references, cycles, depth and total size. No runtime plugin discovery.

Current graph: BLUEPRINT_GENERATION → BLUEPRINT_QA → REVISION_PERSISTENCE → QUANTITY_TAKEOFF → CONSTRUCTION_CALCULATION → BOQ_COST. Accepted revision reuse satisfies the first three without generation or QA reruns. Future PROFESSIONAL_2D, INTERIOR_DESIGN, EXTERIOR_DESIGN, SCENE_3D and ENGINEERING_ANALYSIS depend on accepted revision; WALKTHROUGH and HOLOGRAPHIC_MODEL depend on SCENE_3D. Future versions describe contract versions, not implemented engines.

## 3. Mode mapping and pure planner

COMPLETE_BUILDING requires BOQ_COST and its dependency closure; its future outputs are optional. BLUEPRINT_ONLY requires REVISION_PERSISTENCE. Specialized future modes require their named capability. Requests can add required and optional outputs. Required unavailable dependencies block execution before creating artifacts; optional unavailable outputs remain explicit and do not downgrade success. The planner consumes only normalized requests, validated source evidence and registry data: no DB, clock, randomness, network, AI or mutation. It returns deterministic topological steps, reuse actions, blocked dependencies, executable steps and expected artifacts.

## 4. Canonical and artifact rules

Existing project/revision/QA, takeoff, construction and cost tables stay authoritative. A workflow stores references, never copies full generated reports. Blueprint and QA references resolve to the immutable revision model and acceptance QA; derived references must have the same accepted revision and exact upstream chain. Reuse requires current engine/options/specification/rate-book/policy compatibility. Source discovery is a bounded indexed query; clients cannot assert capability state or provide output reports. Interior space references are checked against the actual selected revision. Geometry changes require an explicit new revision; existing runs never synchronize automatically to later revisions.

## 5. Execution and synchronization

Execution remains synchronous. PLANNED is a plan response; persisted runs start RUNNING and finish COMPLETED, BLOCKED, PARTIALLY_COMPLETED or FAILED. Terminal rows are immutable. COMPLETED describes requested execution, not complete quantity or cost coverage; coverage is preserved in each output reference. No queue, worker, scheduler, cancellation facade or background-job promises.

Use a short server-only fenced execution lease to prevent competing synchronous callers from executing the same run. An interrupted caller may resume the identical request after lease expiry; no automatic retry loop. Every successful artifact write and its workflow output reference commit in the same database transaction. The wrapper calls the existing signed project/takeoff/construction/cost RPCs, preserving their validation and fingerprint rules. Generation/QA/revision form one atomic existing revision operation, even though the plan exposes their three conceptual capabilities. On a known domain failure, retain successful upstream outputs and record a bounded failure. Infrastructure failures propagate; the durable run remains inspectable/resumable, and are never silently retried or represented as domain success.

## 6. Persistence and idempotency

Add migration 0010 only. Add project_workflow_runs with bounded request/plan/manifest JSON, source revision FK, status checks, fingerprint and execution fencing. No generic replacement artifact table. Existing durableCommand and idempotency_records remain the receipt system. Reserve keyed run identity under an advisory lock, comparing the existing normalized request fingerprint. Each step locks the run and verifies its lease token. Final state and durable receipt commit atomically. Keyless identical normalized requests converge using a deterministic internal key in the same durable receipt system; explicit new keys create distinct runs, while derived artifacts still converge under existing fingerprints. All runs therefore support explicit same-request recovery after lease expiry. Same key/changed mode, revision, output selection or options conflicts. Receipt replay returns original timestamps and references even after a newer revision exists.

## 7. API

One project-scoped family: POST /api/projects/:projectId/workflows/plan; POST /api/projects/:projectId/workflows; GET collection with bounded cursor pagination; GET /:workflowRunId. GET /api/capabilities exposes only safe registry/mode metadata. Plan-only validates ownership and source ancestry and creates nothing. Strict unions reject irrelevant mode fields, forged reports, capability statuses and arbitrary source references. COMPLETE_BUILDING requires explicit construction specification and synthetic rate-book/cost policy; blueprint extensions require their corresponding inputs.

## 8. Security and RLS

Workflow reads derive from project ownership, irrespective of public visibility. Anonymous public reads are forbidden; second users cannot see or mutate runs. Revoke direct INSERT/UPDATE/DELETE. Server-only writes use the established HMAC envelope bound to caller, operation, input, context and expiry. Wrapper RPCs recheck owner/source lineage and validate referenced artifact existence. Never use service role for tested behavior. Completed rows reject mutation, including privileged accidental updates. Account deletion follows existing retained-artifact conventions.

## 9. Resource bounds

Bound HTTP body to 128 KiB, six modes, thirteen capabilities, thirteen output intents/steps, depth 16, registry 32, planning operations 1024, manifest 13 and errors 20. Stored request/plan/manifest have independent byte limits. Pagination is 1–100 and bounded cursor length. Reuse lookup selects at most one compatible chain, with stable ordering and no unbounded application traversal. Signature envelopes retain existing artifact payload limits.

## 10. Backward compatibility and future integration

Existing engine algorithms, quantity/construction/cost formulas, rate semantics, normalized artifact tables and migrations 0001–0009 remain frozen. Only additive route registration, repository transport and test registration touch baseline production plumbing. Future adapters must declare capability/version/dependencies, accept resolved immutable sources, produce validated versioned artifacts through signed persistence, return honest coverage/failure, and opt into availability only when implemented and tested. Phase 17 may interpret requirements upstream; Phase 18 may replace the solver behind versioned adapters; Phase 19 drawings, Phase 20 scenes, Phase 22 interior, Phase 23 exterior, Phases 24–25 engineering and Phase 26 holograms remain deferred. No frontend or AI calls.

## 11. Verification and operations

Test pure planning and invalid registries, mode contracts, full current chain, blueprint-only counts, downstream reuse, partial domain failures, receipt/step rollback, interrupted execution recovery, terminal immutability, isolation, signatures and direct-write denial. Reuse the same acceptance cases on disposable PostgreSQL and actual local Supabase Auth/JWT/PostgREST/RLS. Additive local migration only; no reset. Run all requested gates, integration three consecutive times, live Supabase twice, disposable replay, DB/RLS and Docker smoke. Preserve upstream HTTP/JWT timing/request-ID evidence if the Phase 15 issue recurs. Leave changes uncommitted for manual review.
