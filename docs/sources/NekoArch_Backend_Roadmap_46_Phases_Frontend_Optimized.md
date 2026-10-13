# NekoArch.ai — Expanded Backend Development Roadmap (46 Phases)
## Frontend-aligned implementation plan · 8 October 2026

**Project:** NekoArch.ai — Text to Real-Time Spatial Engine  
**Authoritative backend:** `designflow`; NekoArch frontend/sandbox remains independent. Do **not** merge repositories as part of a roadmap change.  
**Roadmap total:** **46 backend phases (28 reported completed + 18 planned)**. The earlier 40-phase edition is superseded *as a plan*, not as source-control history.  
**Frontend source:** User-supplied *NEKOARCH — COMPLETE 56-PHASE DEVELOPMENT HANDOFF*. Frontend phases F01–F29 are reported completed; F30 Revision/Regeneration next, F31 Project Overview separate.  
**Verification boundary:** This document cross-checks **roadmaps and user-supplied status**, not the live source code. B01–B28 stay reported complete, subject to targeted contract/compatibility audits. Neither the new milestones nor proposed APIs are claimed as implemented.  
**Why expand:** Secure file ingestion, durable jobs, project services, specialist AI operations, safe regeneration and desktop production integration were previously compressed into a few oversized milestones. Six dedicated phases make work verifiable, owned and independently shippable.

**Naming:** `Bnn` = backend phase, `Fnn` = frontend phase. Design goals and contract examples below are *proposals* until tested against the actual repository.

---


# A. Product invariants and scope
NekoArch must progressively support text-to-action architecture: natural-language intent → bounded architectural understanding → validated 2D plans and BIM → optimized 3D interior/exterior, 360° room exploration and walkthroughs → materials, quantities, costs, engineering checks and evidence → revisions and export. Users may specify `Complete Building`, `Blueprint Only`, `Interior Only`, `Exterior Only`, `3D Only`, `Engineering Only`, `Structural Only`, `Materials Only`, or `Budget Only` operations where supported, all mapped through shared services and capability discovery. Route expensive reasoning, media generation and engineering computations to selected external or open-source-capable services where permitted; core `designflow` manages typed intent, models, constraints, orchestration, validation, security, audit, and state, rather than hosting every large model.

## A1. Revision & regeneration behaviors

Every accepted project revision may spawn an **uncommitted candidate** for a modification, regeneration, optimization or alternative. A user's instruction such as **“Keep the structure and floor plans; redesign only the glass façade. Preserve everything else.”** must result in:

1. **Scoped intent**: target the façade and its permitted exterior material/render artifacts; treat structure, room geometry, plan layout, stairs, non-target interiors, and expressly protected assets as preservation constraints.
2. **Explicit preservation**: retain stable semantic element IDs and source hashes for preserved objects. A retained source/model is immutable; display output bytes need not match when a renderer/exporter version changes, but the preservation guarantee must be tested at the declared semantic level. If an exact asset-byte lock is required, honor it or block.
3. **Dependency planning**: distinguish cosmetic visual swaps from geometry/performance changes. A changed glazing ratio could affect daylight, energy, quantities, thermal loads, fire/egress, façade attachment and structural/wind assumptions; schedule required independent checks or clearly mark stale outputs. Never represent stale figures as fresh.
4. **Dry-run and consent**: show change targets, locked components, dependent rechecks, feasibility blockers, likely jobs/providers, credits or cost estimate, and whether revision requires explicit approval.
5. **Selective execution**: rerun only actually affected generators, simulations, materials, renders, reports or external providers; reuse content-addressed artifacts for unaffected outputs when safe. Avoid complete regeneration by default.
6. **Failure isolation**: job retries, partial provider failures, timeouts and cancellations must not corrupt an accepted revision; no partial candidate is silently published.
7. **Reviewable comparison**: present before/after 2D, 3D, semantic BIM, quantitative and cost changes, stale/pending checks and warnings. “No geometry changed” is a verifiable diff assertion.
8. **Immutable approval**: accept only against the intended base revision with ownership, optimistic concurrency/idempotency and a durable audit trail; maintain rollback or restore by creating a **new** accepted revision referring to a prior state rather than rewriting history.
9. **Truthful capabilities**: if a targeted request is not supported by the backend or model/provider, return a typed unsupported/blocked/needs-clarification state. The frontend may demonstrate a mock experience but must label it as such.

### A2. Two distinct notions of preservation

- **Hard model lock:** building geometry, floor plan, storeys, structural elements, selected BIM element IDs and core parametric features may not change. Any necessary change is a **conflict requiring clarification/approval**, never an implicit override.
- **Artifact/view lock:** preserve chosen render/media assets, camera paths, textures or documents byte-for-byte when feasible. If regeneration introduces a conflicting view dependency, return an explicit conflict or a new, separately versioned derivative; do not silently replace the locked artifact.

### A3. Desktop/workstation target and honest separation of concerns

- The supported product target is **desktop PCs, laptops and professional workstations**. Optimize desktop browsers and GPU tiers; the source handoff explicitly excludes a full mobile/tablet application.
- The backend supplies stable scenes, assets, topology, IDs, navigation and metadata; the frontend owns Three.js/WebGL, GSAP, cinematic boot, camera choreography, scroll animations and design appearance. Server-rendered cinematic marketing videos are optional specialist outputs, not a prerequisite for frontend motion.
- UI completion means the frontend implementation exists; it does **not** prove a live backend endpoint or data pipeline exists. Backend acceptance requires integration-tested evidence.

### A4. System invariants

- The accepted revision is immutable; candidates are separate, disposable and scoped to a base revision.
- All generation is bounded by deterministic source/configuration identity where possible and by provider provenance plus reproducible inputs when nondeterministic.
- Artifacts have stable logical component ownership, content hash, source revision, model/provider/tool version, and freshness/validation state.
- Revisions cannot cross project or tenant permissions; API keys and provider secrets remain server-side.
- Engineering-derived outputs must either be independently revalidated for the candidate or unambiguously flagged as not evaluated/stale. NekoArch does not claim professional certification, regulatory approval or buildability without appropriate qualified review.
- Maintain compatibility with existing `designflow` history, database migrations, native conversation flows, audit trails, typed contracts and generated models. Add migrations only with backwards compatibility and recovery tests.
- Preserve a reliable low-cost/local fallback where technically justified, with quotas, budgets and clear quality limitations.

---

# B. Expanded backend 46-phase roadmap

## B01–B28 — Reported completed historical foundation
The following descriptions preserve the existing roadmap's completed milestones. They are the **baseline**, not new implementation work. Their relevant capabilities are reused and verified for the revisions feature; gaps are addressed by forthcoming integration work instead of relabeling past milestones as incomplete.

| Phase | Existing title | Retained foundation |
|---:|---|---|
| 1 | Core Monorepo Setup & Contracts | Backend project structure, shared TypeScript contracts, package boundaries and API architecture. |
| 2 | Geometric Primitives & 2D Mathematics | Exact points, polygons, winding, containment, intersections and millimetre geometry. |
| 3 | Wall System & Storey Boundaries | Walls, axes, intersections, offsets and storey boundaries. |
| 4 | Spatial Topology & Adjacency | Room containment, adjacency, connectivity and spatial relationships. |
| 5 | Persistence, APIs, Security & Estimates | Persistence, PostgreSQL/Supabase, ownership/RLS, estimate provenance and APIs. |
| 6 | Deterministic Procedural Generation Engine | Seeded layouts, rooms, walls, openings, furniture and generation invariants. |
| 7 | Generator & API Integration | Generation/API contracts, persistence boundaries and integration verification. |
| 8 | Production Hardening & Runtime Reliability | Runtime validation, logging, Docker, database and operational reliability. |
| 9 | Building Model V2 | Typed elements, levels, rooms, walls, slabs, stairs and semantic invariants. |
| 10 | Precision Blueprint Engine V1 | Accurate floor-plan geometry, openings and millimetre dimensions. |
| 11 | Independent Blueprint QA | Independent geometric and blueprint reconstruction/checks. |
| 12 | Projects, Persistence & Immutable Revisions | Project/revision history, ancestry, ownership, replay protection and atomic updates. |
| 13 | Quantity Takeoff | Architectural quantities including areas, walls, volumes and openings. |
| 14 | Construction Material Calculations | Deterministic material calculations, units, recipes and completeness. |
| 15 | BOQ & Cost Engine V2 | BOQs, precise rates, regional price provenance and partial costs. |
| 16 | Multi-Mode Workflow System | Complete, blueprint-only, interior-only, exterior-only, 3D-only and engineering-only workflow modes. |
| 17 | Generation Identity & Freshness | Requirement/model hashes, generation/seed/version identity and freshness checks. |
| 18 | Natural-Language Architectural Interpreter | Bounded English/Hinglish requirements and clarification handling. |
| 19 | Precision Solver V2 | Circulation, adjacency, stairs, privacy, site rules, bounded deterministic search and QA. |
| 20 | Conversational Architectural Intelligence | Persistent conversations, proposals, explicit approval, leases, native edits, idempotency and new revisions. |
| 21 | Multi-Model Intelligence & Provider Orchestration | Provider registry, capability routing, privacy/cost policies, fallbacks and secure transport. |
| 22 | Advanced Parametric Architecture | Bounded connected L-shaped footprints, occupied wings, setbacks, typed edits and quantity/QA integration. |
| 23 | BIM Digital Building Model | Semantic BIM, elements/relationships, provenance, diffs, JSON export and IFC interoperability. |
| 24 | Structural Engineering Integration | Structured structural concepts, loads, members, analysis integration and evidence. |
| 25 | Environmental & Building Simulation | Daylight, solar, thermal/energy and environmental analyses. |
| 26 | MEP, Fire Safety & Vertical Transport | Mechanical/electrical/plumbing, fire safety, lifts, vertical transport coordination. |
| 27 | Architectural Knowledge & Specialized Intelligence | Specialized architectural rules, knowledge and domain-specific intelligence. |
| 28 | Autonomous Design Optimization | Bounded iterative design alternatives, constraints, objectives and trade-offs. |

## Phase 29 — Advanced 3D Visualization & Walkthrough

**Mission:** Deliver optimized, explorable interior/exterior spatial scenes **and the minimum safe selective regeneration backend needed by frontend Phase 30**. This is the critical integration gate; do not defer basic façade-only preservation to Phase 41.

**Additions and deliverables:**
- Canonical 3D asset/scene manifest linked to project ID, accepted base revision, model/BIM element IDs, source hashes, material layers, render variants, 360° views, camera paths and provider provenance.
- Interior and exterior **separate render domains**; configurable complete/blueprint/interior/exterior/3D/engineering job outputs. Export/stream standard browser-consumable 3D formats where supported (e.g. glTF/GLB), with LOD, instancing, lazy loading, memory budgets and predictable viewport fallback.
- **Targeted regeneration MVP:** façade cladding, external material palettes, surface styling and other **supported non-structural visual changes** can be regenerated without changing the immutable source plan/structural model. Geometry-changing windows/openings are *not* silently treated as cosmetic.
- Convert bounded natural-language revision intent (via existing Phase 18/20 and Phase 21 orchestration) into typed `targets`, `preserve`, `constraints`, `sourceRevision`, `changeClass` and `configuration`, with a typed clarification/unsupported result where parsing is uncertain.
- **Artifact manifest, scoped dependency manifest and preservation locks** for the supported revision targets. Compare semantic hashes for locked geometry, structural elements and layouts **before and after**.
- **Preflight plan**, provider task list, scoped rerender, reuse of unmodified assets, provisional candidate IDs, preview/compare references, statuses, error handling, cancellation and safe acceptance into existing immutable project history. A nonfinal job never alters accepted revision state.
- API and TypeScript contract **discovery/mapping**: reuse real existing endpoints where possible; design bounded additive regeneration proposals only for missing capabilities, with stable frontend-facing adapters and contract tests.
- Render-oriented performance: responsive quality tiers, loading states, animated camera traversal, interior/exterior switching and desktop GPU-aware fallbacks and non-WebGL accessibility alternatives; no promise of unrestricted supertall real-time interactivity at this milestone.


**Added 56-phase frontend alignment (minimum functional bridge):**
- **Project Manifest v1 for frontend Phase 31, delivered by Phase 29, not postponed until backend Phase 37:** provide a revision-pinned summary of available/missing outputs (site, 2D, 3D, BIM, calculations, structural, material, cost, documents), artifact IDs, job links, freshness, limitation flags and mode-specific summaries. No fabricated engineering or media.
- **Generation options (frontend Phase 29):** capability/catalog discovery, allowed output selections, validation of mode + dependencies, incompatible-selection explanations, quote/budget warnings, and typed generated-vs-not-generated result states. This is separate from UI selection controls.
- **Integration adapter map:** audit existing Phase 5/12/16/17/20/21/23/28 contracts; publish a real source-derived API-to-TypeScript compatibility sheet and OpenAPI/schema fixtures; never invent production endpoints. Keep frontend project and backend repositories independent.
- **Reference attachment minimum contract:** project-scoped file metadata, permission checks, storage linkage and ingest state *only if supported by actual backend infrastructure*; otherwise publish a typed `not_supported_yet` result and put hardened ingestion in Phase 36. Do not claim that the earlier frontend upload screen means backend uploads exist.
- **Minimal generation-job and readiness contract:** progress states, result manifest, cancel capability discovery and truthful service/provider availability. Pending durable cross-worker recoverability is explicitly tracked for Phase 36.
- **Scene delivery contract:** world units/coordinate frame, levels, room/element IDs, layer visibility groups, camera waypoints and walkthrough/navigation graph when available, asset checksums, retrieval expiry, compressed glTF/GLB and LOD variants with desktop GPU budgets. Browser Three.js, GSAP choreography and scroll motion remain frontend-owned.
- **Release slice:** independently test a live frontend Phase 30 edit and Phase 35 overview against source-grounded APIs, not merely mock UI. Feature flags isolate unsupported specialty workspaces until their contracts are real.

**Phase 29 release gate — bounded frontend F30 preview capability:** A test can retrieve the **Phase-31-ready unified project overview manifest** and take an existing villa, request *“modern glass façade; preserve plans and structure”*, display an impact plan, regenerate only permitted exterior assets, prove preserved BIM/plan/structure invariants, preview the difference, obtain approval, create an immutable accepted descendant and restore the previous result. Unsupported changes block with a meaningful message. This is a supported cosmetic-material/scene regeneration MVP only; the fully scoped, production-ready revision contract is B30, and durable jobs are B32. A disconnected UI mock must not count as backend completion.

**Scope boundary:** B29 must not claim that regenerating an image proves underlying building geometry was modified. Maintain stable element references; real geometry/engineering changes require explicit checks and may be refused.


## Phase 30 — Selective Revision & Regeneration Engine [NEW]

**Mission:** Productionize the F30 “change only X, preserve Y” experience without restarting a project or silently changing the original.

**Deliverables**
- Typed `RevisionIntent`, `ScopeTarget`, `PreservationLock`, `DependencyImpact`, `CandidateRevision`, `ArtifactDiff`, `PreflightResult`, and `RevisionCommit` schemas with source-derived adapters and additive API changes only when necessary.
- Parse bounded natural-language scope using the existing B18/B20 system; support target IDs, excluded floors/rooms/parts, strict geometry locks, artifact byte locks, ambiguity prompts and permissions checks.
- Build a component-level impact planner: explicit allow/deny sets, content/semantic hashes, affected task DAG, fresh/stale engineering dependencies, likely providers, timeout/budget and failure modes before execution.
- Implement non-destructive `preflight → quote/consent → execute → validate → compare → approve/reject → commit/restore` lifecycle; use B12 immutable history and B17 identities, with optimistic concurrency, idempotency, audit and rollback-as-new-revision.
- Guarantee preservation semantics at **model, derived artifact, or exact byte** levels, distinguishing them clearly. Unchanged model IDs/hashes survive cosmetic edits; changing glazing geometry must trigger expanded impact or a protected-model conflict.
- Scoped diff viewer data: changed/unchanged elements, 2D/BIM/model scene diffs, quantity/cost changes, invalidated calculations, provider provenance and retention notices; never declare a stale downstream report verified.
- Support façade-material, supported interior-finish, renderer-only and other **actually implemented** target types. Unsupported edits produce typed clarification/conflict instead of fabricated success. Reuse safe existing B29 job adapter; B32 later adds durable cross-worker recovery.

**Frontend connection:** F25–30, F31, F49–50 and F55. Astra's F30 UI is `UI ready / backend partial` until this live integration gate passes.

**Acceptance gate:** A real API test creates A→candidate→B from “modern glass façade, preserve layout and structure,” proves geometry/topology/structure locks, shows changed exterior assets and truthful impacted engineering, rejects a conflicting glazing-layout request, and restores A as a new revision C without altering A/B. Cross-user access and stale-base commits fail safely.


## Phase 31 — Secure Reference Ingestion & Artifact Lifecycle [NEW]

**Mission:** Make frontend F14 reference uploads and F16/F39/F42 artifact retrieval real, safe and revision-aware.

**Deliverables**
- Authenticated project-scoped upload intents, file metadata, controlled chunked/resumable upload where warranted, signed download URLs, owner/tenant isolation, quota, retention, deletion and authorization revocation.
- Verify content independently of extensions; allowlist specific formats/parsers, size/page/pixel/decompression limits, malware scanning/quarantine, sandbox processing, PDF/CAD/image parsing only when validated; defend against SSRF, zip bombs, prompt injection and path traversal.
- Track `uploaded → scanning → processing → ready | rejected | quarantined | failed`, separate source input from calibrated interpretations and derived assets, and preserve hashes, licensing, extraction provenance and provenance for AI inputs.
- Mark dimensions inferred from a photo/sketch as **unverified until scale or calibrated survey**; do not claim a reference image yields certified plans.
- Provide artifact versioning/cleanup/reference counting, tenant-safe deduplication, encrypted object storage, private storage buckets, signed URL expiration and cancellation or archive retention controls.

**Frontend connection:** F14–16, F23–24, F26–27, F39, F42 and F49–50.

**Acceptance gate:** Valid image/document passes ingestion; malicious/mislabeled/oversized files are quarantined; signed link respects expiration and revoked access; tenant A cannot load tenant B's assets; deletion honors policy; uncalibrated measurements are not marked exact.


## Phase 32 — Durable Generation Jobs, Progress & Recovery [NEW]

**Mission:** Turn frontend F15/F19/F25/F28/F30 job states into trustworthy resumable server-side operations.

**Deliverables**
- Persistent `Job`, `Task`, `Attempt`, `Event`, `ProviderCharge` records linked to project/base revision/config/asset identity, with bounded queue/task graph, worker leases, retries, checkpoints, cancellation, recovery and partial failure isolation.
- Transactional enqueue/outbox or equivalent, idempotent commit/effects, at-least-once event handling, stale/duplicate callback rejection, quotas, concurrency budgets, deadline and fair scheduling; never mutate an accepted revision during a running task.
- Authorized progress via ordered SSE with resume cursor **or** tested efficient polling; distinguish measured percent from `step-only/unknown`, handle missed events and browser reconnect.
- Service health: separate API, DB, object storage, worker/queue and provider readiness; offer public-safe reduced diagnostics with capability-aware disabled/degraded UX.
- Provider expense limits, estimated versus actual spend, cancellation semantics for external work, retry/double-charge disclosures, secret redaction and robust observability.

**Frontend connection:** F11–12, F15–16, F19, F25–30, F42 and F56.

**Acceptance gate:** Kill/restart a worker mid-regeneration; resume or fail deterministically, preserve original accepted revision, avoid duplicated commit, enforce budget, and provide truthful resumable progress to authorized clients.


## Phase 33 — Account, Project Library, Settings & Context Services [NEW]

**Mission:** Close practical product-service gaps from frontend F21–24 and F27 without misrepresenting the completed B5/B12/B20 work.

**Deliverables**
- Extend existing auth rather than replace it: session/bootstrap, revocation/expiry behavior, ownership/RLS tests, tenant-scoped resource access and service-to-service scopes; secure reference/job/message/manifest authorization.
- Project catalog: page/filter/search/list, rename, archive/unarchive, user-visible history, recent project snapshot, favorites only if product needs it, and explicit separation between *restore archived project* and *restore design revision*.
- Persist bounded user preferences (units, locale, visual quality, output defaults, generation budgets, provider permissions, privacy) with schema version, update/access/delete APIs, export/delete support and migration compatibility.
- Project brief/context: versioned requirements, consent-based upload reference associations, bounded conversation context with retention and correction/deletion controls. **No automatic claim to ChatGPT platform memory**.
- Storage accounting/quota, receipts for costly runs, API contract consistency for users/project jobs/manifest and staging fixtures for frontend service adapters.

**Frontend connection:** F09–12, F19–29, F31 and F40.

**Acceptance gate:** A project owner can search/rename/archive/restore catalog entries and manage preferences/context safely; another tenant cannot enumerate or retrieve those resources; session expiration and service unavailability produce honest frontend states.


## Phase 34 — Complex Building Verification

**Mission:** Expand multidisciplinary QA for complex buildings **and verify changes do not leak outside a revision's allowed scope**.

**Additions and deliverables:**
- Independent geometric and BIM comparison from candidate to base for floors, walls, openings, stairs, elements, materials and protected identity/hash sets.
- Semantic, visual and quantitative change reports: allowed changes, actual changes, unintended mutations, dependency rechecks, stale simulations, quantity/cost impacts and evidence references.
- **Regeneration regression suite** for façade-only, finish-only, interior-only, exterior-only and blueprint-preserving requests; independent validation of floors/structure locks.
- Re-evaluate engineering/MEP/fire/environmental checks impacted by each change, or mark corresponding outputs stale/blocked when solver support is absent; do not report false “passed” status.
- Large-model verification with reasonable quotas, chunked checks and non-catastrophic failure behavior.


**Added 56-phase frontend alignment:**
- Validate drawing primitives, dimension annotations, scale bars, layer identity, measurement precision, unit consistency and site/plot orientation against canonical source geometry (frontend Phases 32–35).
- Publish verification evidence objects with check ID, input revision, assumptions, severity, independently measured values and failure reason; expose partial/not-verified status to blueprint and structural workspaces.
- Add comparisons between rendering hotspots, semantic BIM IDs, blueprint layers and selected 3D objects; test accidental layer swaps and lost semantic mapping.
- Verify reference-file interpretation never silently changes the canonical site boundary or floor geometry; any user-supplied image/PDF is untrusted until checked.

**Gate:** “Only the requested façade changed” is independently provable from actual model and artifact diffs, with no hidden edits and no stale engineering results displayed as current.


## Phase 35 — Supertall Engineering & Verification

**Mission:** Extend scale toward high-rise/supertall concepts, using engineering-aware guardrails and qualified-review boundaries.

**Additions and deliverables:**
- Multi-storey/large-site model partitioning, loading, drift/wind/seismic/vertical-transport/egress concerns as specialized external-engineering workflows with provenance and assumptions.
- Partial regeneration of building sections, exterior skins and vertical zones without losing immutable revision ancestry or cross-zone consistency.
- Hard limits and honest infeasibility disclosures for unsupported Burj-Khalifa-scale design, unverified calculations and high-risk construction claims.


**Added 56-phase frontend alignment:**
- Model high-rise scopes as floors, cores, zones, elevations, façade assemblies and discipline parcels with stable IDs for hotspot/section navigation (frontend Phases 45–47).
- Include vertical navigation graph checks, floor selection, egress assumptions, tower envelope geometry, large-scene paging and partial loads suitable for workstation-scale visualization.
- Require an explicit `conceptual`, `assumption_based` or `professionally_reviewed` evidence classification; do not call automated outputs construction-approved designs.

**Gate:** A large revision cannot evade required cross-storey engineering checks, and all outputs distinguish concept-level results from engineering-certified deliverables.


## Phase 36 — Cloud Engineering Compute Gateway

**Mission:** Offload expensive engineering/3D computation while keeping NekoArch's backend responsive, secure and auditable.

**Additions and deliverables:**
- Durable job queue, dependency-aware task fan-out/fan-in, provider-specific adapters, progress/cancel/retry, bounded concurrency, checkpoints and error isolation.
- Explicit budgets, quotas, service deadlines, secure provider credentials, retention policy, result verification, deduplicated jobs and content-addressed caching.
- Fine-grained recomputation: only impacted façade rendering, daylight model, quantities, IFC extraction or specialist solver tasks execute; unaffected jobs reuse immutable verified outputs.
- Client-visible job states and polling or authorized progress subscriptions, with recovery after process restart, timeout, provider outage and duplicate callback.


**Separated responsibilities in expanded roadmap:**
- B31 already owns secure uploads, object lifecycle and ingestion security; this phase consumes approved artifacts and never reprocesses untrusted inputs in engineering workers.
- B32 already owns durable generic generation jobs; this phase adds **engineering-grade** cloud solver execution, compute scheduling, reproducible environments, units/boundaries verification, specialized queue isolation, result integrity and provider-specific resource governance.
- B33 already owns settings, library and account context; this phase applies user-approved budgets and access policy.

**Gate:** Large solver workloads execute outside request threads with reproducible inputs, validated numerical/engineering output contracts, capped cost, abort/recovery and truthful unsupported/approximate status.


## Phase 37 — Unified Multidisciplinary Building Model

**Mission:** Treat architecture, BIM, structure, MEP, environmental analyses, cost and media as coordinated models.

**Additions and deliverables:**
- Stable cross-disciplinary element associations and a typed **artifact dependency graph**: source geometry → openings/materials → façade meshes → daylight/energy → quantities/cost → drawings/exports, with additional structural/MEP edges where relevant.
- Formal invalidation semantics: `current`, `stale`, `pending`, `blocked`, `not_applicable`, `verified`; reason codes and source/target revision identity.
- Material and façade variations as explicit, semantically typed changes rather than global, uncontrolled re-prompting.
- Model/BIM/3D/engineering consistency reconciliation and per-discipline change impact summaries.


**Added 56-phase frontend alignment — single source of truth:**
- Evolve the Phase-29 overview into a **Unified Project Manifest v2**: project and revision identity, canonical building/site and coordinate frame, editable vs derived artifacts, generation capability/config, module availability, per-discipline freshness, verification status and access policy.
- Define compatibility/invalidation behavior for output changes: blueprint → structure/material takeoff/BOQ → 3D scenes → reports; façade cladding alone differs from changing curtain-wall glazing area. Every module resolves one coherent accepted/candidate revision rather than mixing versions.
- Site/plot, drawing/layer, quantitative/engineering, cost, 3D, room navigation and export resources must consistently reference the same stable semantic model; add stable paged/filterable and partial-data views for desktop professional workspaces (frontend 31–40, 45–48, 55).
- Surface comparison-friendly `diff`, `lineage`, `source`, `units`, `CRS` or local coordinate system, `completeness`, `confidence/assumptions` (when applicable), `last_verified`, and `missing_reason` metadata as machine-readable fields.

**Gate:** Any accepted targeted edit identifies all dependent outputs requiring regeneration, revalidation or explicit stale labeling; no lost linkage between model and visible 3D object.


## Phase 38 — Construction Documentation & Engineering Evidence

**Mission:** Produce traceable professional outputs and reports consistent with each accepted revision.

**Additions and deliverables:**
- Version-pinned 2D plans, section/elevation drawings, schedules, quantity and engineering evidence packages; PDF/SVG/DXF/IFC where the corresponding format is supported.
- Revision comparison pages, annotated changes, changed/unchanged element logs, review warnings, stale-result notices, provider provenance and assumptions.
- Selective re-export of only impacted sheets/reports; preserve earlier document revisions and signatures/approval metadata (where present).


**Added 56-phase frontend alignment — blueprint/report tooling:**
- Export versioned layers, dimension primitives, measurement scale/units, overlays/annotations and page/sheet identities for frontend Blueprint Viewer & Tools (33–34). Distinguish derived user annotations from authoritative geometric changes.
- Provide accessible retrieval for construction-oriented reports, quantity/calculation worksheets, structural evidence, drawing PDF/SVG, schema-valid BIM/IFC, and DXF **only when tested**; include job state, mime/type, size, checksum, retention and signed delivery.
- Exports and printable evidence should include sources, code/standard assumptions, qualification needed, completeness/staleness notices, provenance, reviewer attribution if authorized, and no false engineer-of-record signatures.

**Gate:** Downloaded documents declare the exact revision, dependencies, validation level and limitations; no silent reuse of obsolete engineering sheets.


## Phase 39 — Six Specialized Architectural AI Workflows [NEW]

**Mission:** Make frontend F49–54 six real specialized operations on **one canonical project model**, not six parallel applications.

**Deliverables**
- One typed specialist request envelope with selected project/base revision, scope/locks, references, output config, provenance, quote/budget, jobs, dependency impacts and immutable candidate/approval lifecycle.
- **Interior:** furnishings/finishes and bounded interior layout edits, independent spatial/egress checks, interior-only outputs. **Exterior:** façade materials, massing only where supported, glazing/canopy constraints and exterior-only outputs.
- **Blueprint:** site and room layout/precision solve, wall/door/stair layers, drawing data and independent QA. **Structural:** solver-backed load/result/assumption/evidence retrieval with no fabricated certification.
- **Materials:** quantities, deterministic recipes, units, substitutions, supplier/rate provenance and geometry/material-change impact. **Budget:** regional versioned rates, currency, BOQ and scenario recalculation with honest partial/unknown totals.
- Each specialist reuses B6/B10/B19/B22/B24–28 engines and B30 revision guards; no “LLM invented dimensions” or image-only simulation passing as geometry-based output.
- Typed `unsupported`, `requires_review`, `degraded_provider`, `stale_dependency` and `partial` statuses; per-module role and cost policies, scenario fixtures and workflow coverage.

**Frontend connection:** F18 tools, F29 output selection, F40 unified navigation, F49–55 modules.

**Acceptance gate:** Execute one supported request for each of six modules using real backend adapters; show common revision IDs and invariant locks; feed resulting changes to shared B37 manifest and affected-cost/engineering freshness checks.


## Phase 40 — Autonomous Large-Scale Project Integration

**Mission:** Coordinate multi-domain architectural projects without surrendering control of protected design intent.

**Additions and deliverables:**
- Task planning across architectural solver, media models, BIM, quantity, engineering, provider choices, review and publication.
- Agent plans require typed operations, permissions, requested scope, preservation constraints, bounded retries and explicit user approval for consequential changes.
- Partial regeneration across many artifacts with checkpoints, task-level failure recovery, cost safeguards and explainable decisions.


**Expanded integration responsibility:**
- Consume the six tested specialist operations delivered at B39; orchestrate cross-module DAG plans rather than rewriting individual generators.
- Enforce model locks, project authorization, user budget, scope limits, engineering evidence gates, dependency invalidation, provider privacy constraints and explicit consent at every autonomous step.
- Checkpoint large-scale multi-disciplinary sequences and recover independent failed branches without publishing partial accepted models.

**Gate:** Agent orchestration cannot bypass preservation locks or transform an unverified provider output into an accepted engineering assertion.


## Phase 41 — Conversational AI Expansion

**Mission:** Evolve bounded edits into robust **project-aware conversational revision intelligence**.

**Additions and deliverables:**
- Parse complex edits and negatives (“change *only*…”, “preserve…”, “except…”, “undo…”, “try another exterior”, “reuse the previous floor plan”), with explicit target extraction, language ambiguity resolution and user clarification.
- Conversational references to named revisions, rooms, wings, elevations, façade materials, versions, rejected proposals and previous provider renders; grounding in stable source IDs.
- Intent disambiguation and impact explanations before execution; distinguish `edit existing`, `regenerate visual derivative`, `derive alternative`, `recompute engineering`, `restore prior candidate`, `compare revisions` and `new project`.
- Confirm and enforce hard locks, allow user-approved scope expansion only via **new consent**, and generate a structured revision plan without hallucinated successful execution.


**Added 56-phase frontend alignment — chat and project context:**
- Frontend Phases 25–28, 30 and 55 require durable conversation links to project ID, current accepted/candidate revision, project brief, named constraints, user choices and all active specialist modes, with permissions, context-window bounds and provenance.
- Provide message stream semantics (ordered IDs, partial vs final, reconnect/resume if supported), typed tool calls/decisions, plan changes and auditable authorizations rather than pretending provider prose performed a transaction.
- Support user-specified reference usage and project memory: scoped retrieval with explicit consent and deletion/retention controls; no cross-project/private artifact leakage in model context.
- Restore and compare are typed actions; natural-language references like “the second-floor south room” must resolve to stable building IDs or ask for clarification.

**Gate:** Multi-turn conversation can iteratively refine only the selected exterior/interior without resetting the project or rewriting unrelated accepted design data.


## Phase 42 — Fantasy-to-Feasible Design Engine

**Mission:** Transform ambitious text designs into feasible alternatives without silently changing their locked features.

**Additions and deliverables:**
- Explore constrained alternatives, rank trade-offs, surface infeasible constraints and clearly segregate fantasy/concept visuals from engineering-verified alternatives.
- If a requested visual design conflicts with structure, egress, code assumptions or loads, propose alternative revisions **for consent**, not silent substitutions.
- Preserve geometry/engineering guardrails while presenting different design families and progressive feasibility assessments.


**Added 56-phase frontend alignment:**
- Separate conceptual render inspiration and architectural feasibility records; preserve prompt/reference provenance and explain which real constraints prevented a requested geometry/appearance.
- Support a staged design ladder (concept → bounded geometry → separately verified engineering → professional review) with specific artifacts, gaps, and acceptance criteria for each stage, not blanket “buildable” claims.

**Gate:** Conceptual outcomes and construction claims remain clearly distinguished and conflict resolution does not void locks.


## Phase 43 — Intelligent API & Model Routing Expansion

**Mission:** Route language, images, rendering, geometry, BIM and engineering work to suitable local/external models with cost/quality/security controls.

**Additions and deliverables:**
- Capability-based specialization for intent parsing, exterior/image generation, texture/material workflows, interior layouts, 3D assets, quantity/engineering solvers and report assembly.
- Per-operation provider provenance, permissions, privacy/region policies, input/output schema checks, safe fallback and evaluation before accepting provider-produced geometry or analysis.
- Target-specific routing and component-level cache reuse; avoid sending protected plans or personal/project data to unnecessary third parties.
- Explainable costs, provider failure compensation and optional user-supplied provider credentials behind secure server-side storage where supported.


**Added 56-phase frontend alignment — provider and capability marketplace:**
- Keep a vendor-neutral registry of capabilities (`llm.intent`, `image.reference`, `image.exterior`, `interior.design`, `geometry.3d`, `cad.ifc`, `structural.solve`, `environmental.simulate`, `cost.rate_source`, `report.compose`) tied to actual validated provider contracts, supported sizes, regions, licence/policies and quality evaluation.
- The server accepts and protects user-supplied provider credentials *only where implemented*, with encrypted secret storage, rotation/revocation, per-user billing separation and test-mode restrictions; never return provider secrets to the frontend.
- Route specialist operations by modality, geometry constraints, provider availability, privacy, pricing, expected latency, output format and independently checked quality; never depend on a model's unsupported architectural physics claims.
- Where the user's cost preference allows, prioritize open-source/self-hostable adapters or user-owned external quotas; do not promise a free provider exists, infinite free credits, or zero server overhead.

**Gate:** A façade-only request never automatically triggers every image/3D/solver provider; routing decisions are bounded, inspectable and security-reviewed.


## Phase 44 — Professional Engineering Collaboration

**Mission:** Add production-grade teamwork, reviews, approvals, alternatives and revision governance.

**Additions and deliverables:**
- Roles (owner, editor, engineer/reviewer, viewer), revision discussions, comments linked to BIM elements/scene objects, approvals and review evidence.
- Compare any two revisions; branch alternatives; request changes; restore a prior accepted state via a new descendant; explain version conflicts and prevent accidental overwrite of concurrent edits.
- Hard locks across disciplines and accountable overrides with explicit authorization and validation; reviewer sign-off workflows where permitted.
- Change audit includes instructions, approvals, identity, dependency invalidations, provider provenance and final modified element IDs.


**Added 56-phase frontend alignment — project management:**
- Provide authorized project library operations (rename/archive/restore/search), saved scenarios and branches, compare/annotate/review workflows, ownership-preserving transfer/export policies, and identity-safe project deletion/retention audit where supported.
- Make per-project roles and element/revision-level comments accessible to 2D drawings, 3D hotspots and specialist results through common reference IDs; detect concurrent edits with optimistic revision preconditions.
- Preserve “restore archived project” (catalog state) as a distinct action from “restore prior design revision” (new immutable descendant), and include both in tested contracts.

**Gate:** Conflicting concurrent revision attempts do not silently overwrite accepted plans, and a reviewer can trace what was changed, by whom, why and with what evidence.


## Phase 45 — Desktop 3D Delivery, API Compatibility & Production Integration [NEW]

**Mission:** Make the combined server/data/asset behavior efficient and integration-ready for workstation-grade Three.js/WebGL, without building frontend GSAP/cameras in the backend.

**Deliverables**
- Versioned scene/chunk manifests containing coordinate frames, level/room/element IDs, semantic pick anchors, materials/textures, instancing/LOD, walkable collision/navigation volumes, sections/layers, camera waypoints (optional), checksums and signed transport.
- Progressive/range-aware delivery, tested glTF/GLB compression where appropriate, cache keys/ETags, byte/triangle/texture budgets, memory and peak-load instrumentation, invalidation on revision change and non-WebGL fallback metadata.
- Track `model`, `rendered_image`, `panorama_360`, `interactive_scene`, `walkthrough`, and `video` as distinct capabilities. Browser frame rate and GSAP choreography remain frontend responsibilities.
- Generate a source-verified OpenAPI/schema/client-adapter compatibility package: contract drift tests, typed errors, paged partial resources, staging fixtures, mock-to-live replacement plan and migration canaries.
- Desktop QA on representative low/mid/high laptops/workstations, including GPU context loss, complex floor selection, interior/exterior layer toggles, revisions, memory leak mitigation and a documented no-mobile scope.

**Frontend connection:** F08–12, F31, F40–48 and F56.

**Acceptance gate:** A live 3D viewer selects a wall/floor/room and navigates via stable semantic IDs; asset loading remains bounded and measured across agreed desktop tiers; upgraded scene and revision APIs pass contract tests with no mock substitution.


## Phase 46 — End-to-End System Benchmark & Verification

**Mission:** Prove security, reliability, quality and scalability across the *entire* text-to-spatial pipeline and selective regeneration workflow.

**Additions and deliverables:**
- End-to-end tests from text requirement through project creation, 2D/BIM, interior/exterior media, engineering outputs, scoped conversational modification, diff/approval/restore, export and collaboration.
- Strict provenance, immutable history, component locks, stale-result management, authorization, multi-tenant privacy, provider cost/fallback and idempotent retries.
- Large project stress tests, partial recomputation budget and processing benchmarks, desktop/workstation client performance, accessibility, reproducibility tiers and operational recovery drills.
- A release evidence manifest: version, test commands/results, known limits, performance, security verification, unverified integrations and no false “production-ready” claims.


**Added 56-phase frontend alignment — deployment evidence:**
- Contract fixtures and end-to-end flows must cover all nine frontend groups, including auth/project library/settings, upload processing, chat/context, mode/configuration, selective regeneration, Phase-31 project overview, site/blueprints/layers/measurements, structural/material/cost/report outputs, 3D manifests/hotspots/walkthrough, six specialist modules, and final integrated navigation.
- Desktop-only client performance matrix: representative integrated/discrete GPUs, VRAM and browser/WebGL feature detection, progressive GLB loading/LOD/instancing, FPS/frame pacing, scene memory peaks, GPU context loss recovery and reduced-motion/non-3D fallback. Use measured targets and fixture complexity; no fictitious FPS guarantees.
- QA includes contract/OpenAPI drift, real auth/RLS, signed URL scope/expiry, malicious upload rejection, resource quotas, billing limits, stale-data visibility, migration/recovery, cancelled/resumed long jobs, outage recovery and independent engineering limitations. Mock adapters are explicitly forbidden as evidence of live deployment.
- Provide frontend/backend integration sign-off per capability, repository-specific commit/tag evidence, production rollback runbook and a public-safe limitation/unsupported-capability matrix.

**Gate:** The specified representative scenarios in Sections D and J pass against a real deployed backend and connected frontend contracts, with no mock substitution in production verification.


# C. Original 40-phase → expanded 46-phase numbering

**B01–B29 keep their phase numbers.** Existing historical commits/tags for B01–B28 are never rewritten. Six *new* named phases are inserted into the remaining schedule; only **planned** old B30–B40 shift.

| Original 40-phase roadmap | Expanded 46-phase roadmap | Status |
|---|---|---|
| 29 — Advanced 3D Visualization & Walkthrough | **29** (unchanged) | Next; includes bounded regeneration preview |
| — | **30 — Selective Revision & Regeneration Engine** | New |
| — | **31 — Secure Reference Ingestion & Artifact Lifecycle** | New |
| — | **32 — Durable Generation Jobs, Progress & Recovery** | New |
| — | **33 — Account, Project Library, Settings & Context Services** | New |
| 30 — Complex Building Verification | **34** | Renumbered, not removed |
| 31 — Supertall Engineering & Verification | **35** | Renumbered |
| 32 — Cloud Engineering Compute Gateway | **36** | Renumbered; split generic platform services out |
| 33 — Unified Multidisciplinary Building Model | **37** | Renumbered |
| 34 — Construction Documentation & Engineering Evidence | **38** | Renumbered |
| — | **39 — Six Specialized Architectural AI Workflows** | New |
| 35 — Autonomous Large-Scale Project Integration | **40** | Renumbered; consumes B39 |
| 36 — Conversational AI Expansion | **41** | Renumbered |
| 37 — Fantasy-to-Feasible Design Engine | **42** | Renumbered |
| 38 — Intelligent API & Model Routing Expansion | **43** | Renumbered |
| 39 — Professional Engineering Collaboration | **44** | Renumbered |
| — | **45 — Desktop 3D Delivery, API Compatibility & Production Integration** | New |
| 40 — End-to-End System Benchmark & Verification | **46** | Renumbered |

**Important timing:** B29 enables basic supported façade/material revision demos and F31 manifest v1; B30 is the **actual full revision workflow acceptance milestone**. B31–B33 are prerequisites for production uploads, durable background generation and broader account features. Frontend F30 mock completion must not be presented as live back-end integration.

---


# D. Completed-phase compatibility audit (B01–B28)

**Answer to “do the first 28 need updates?” — Yes, some may need *additive compatibility upgrades*; do not reopen or rewrite historic release tags.** The supplied files show phase descriptions, not current implementation. Hence **HIGH = audit soon, likely interface expansion; CHECK = targeted proof/conditional patch**, not confirmation of a defect.

| Completed B | Required frontend-optimization audit / conditional addition | Priority | Implement gap in |
|---:|---|---|---|
| **01** | Shared TypeScript/schema/API inventory, OpenAPI generation, typed errors and adapter fixtures | **HIGH** | B30, B45 |
| **02** | Check unit/coordinate conversions and reproducible hash-safe geometry serialization | **CHECK** | B34, B45 |
| **03** | Test wall/opening/storey boundary IDs and preservation across façade changes | **CHECK** | B30, B34 |
| **04** | Expose validated room/topology links for navigation and scoped impact if missing | **CHECK** | B29, B37 |
| **05** | Audit RLS authorization coverage for new asset/job/context resources; preserve original API contracts | **HIGH** | B31–33 |
| **06** | Verify deterministic fixture replay and targeted visual regeneration without re-solving plan geometry | **CHECK** | B29–30 |
| **07** | Contract tests and typed adapter fixtures for existing generator/API flows | **HIGH** | B30, B45 |
| **08** | Audit operational logs/metrics/secret redaction/queue readiness for later workers | **CHECK** | B32, B46 |
| **09** | Guarantee stable semantic model/room/element IDs and revision-aware 3D pick links | **HIGH** | B29–30, B45 |
| **10** | Expose explicit drawing layer/dimension/scale primitives and coordinate metadata if missing | **HIGH** | B34, B38 |
| **11** | Add independent model-lock and cross-revision geometry diff assertions if existing QA lacks them | **CHECK** | B30, B34 |
| **12** | Confirm candidate vs accepted revision ancestry, atomic approval, stale-base detection and restore-as-new | **HIGH** | B30 |
| **13** | Verify delta takeoff attribution and revision/dependency provenance | **CHECK** | B37–38 |
| **14** | Verify materials recipe/substitution effects on selected elements and completeness | **CHECK** | B37, B39 |
| **15** | Test rate version/currency and change-only cost estimates; flag stale partial results | **CHECK** | B37–39 |
| **16** | Audit advertised workflow mode/output capability matrix; add unsupported/specialist selection types | **HIGH** | B29, B39 |
| **17** | Extend generation identity to scene chunks, third-party versions and artifact freshness/locks | **HIGH** | B29–30, B37 |
| **18** | Add bounded “change only / keep X” target/preservation interpretation and ambiguity flags | **HIGH** | B30, B41 |
| **19** | Validate immutable protected-scope solver constraints; no unsolicited re-layout | **CHECK** | B30, B34 |
| **20** | Audit conversational proposals/leases/context for candidate reference, exclusions and commit semantics | **HIGH** | B30, B41 |
| **21** | Check capability/privacy/cost routing against per-artifact media and specialist tasks | **HIGH** | B32, B39, B43 |
| **22** | Verify façade finish variants differ from geometry edits; enforce parametric locks | **CHECK** | B29–30 |
| **23** | Link BIM element IDs and diffs to scene/manifest artifacts; add revision-scoped façade identities if absent | **HIGH** | B29–30, B37 |
| **24** | Ensure structural assumptions/evidence propagate to changed façade/glazing impact | **CHECK** | B34–37 |
| **25** | Ensure daylight/thermal/energy results are invalidated or recomputed after glazing/material changes | **CHECK** | B34, B37 |
| **26** | Verify MEP/fire/elevator check dependencies and unsupported limitations | **CHECK** | B34–37 |
| **27** | Require provenance for specialized architectural rules and human-review status | **CHECK** | B39, B42 |
| **28** | Enforce preserve locks and immutable ancestry during iterative optimizations; capture candidate comparisons | **HIGH** | B30, B40 |

### Retrofit work packages — executable decisions, not retrospective phase failures

- **R01 — API/schema compatibility (B01, B05, B07, B16):** extract *actual* routes, contracts, authorization and generated TS types; compare against F12, F29–31, F49–55; keep legacy routes compatible and add versioned adapters only where test evidence requires.
- **R02 — Model and revision locking (B09, B11–12, B17, B20, B22–23, B28):** inspect immutable accepted revisions, candidate branches, semantic IDs/hashes, geometry/BIM diffs, constraint-preserving edits, optimistic accept and restore. Patch via B30 only when a negative test exposes a missing guard.
- **R03 — Dependency/freshness accuracy (B13–15, B24–26):** validate impacted quantities, materials, cost, environmental, structure and MEP evidence, including explicit `stale`, `not_evaluated`, `requires_review` and source-revision flags. Full common graph in B37.
- **R04 — AI parsing/provider controls (B18, B20–21, B27–28):** typed “only X”, “not Y” instructions, permission/scope binding, per-provider output constraints, costs, privacy, provenance and known unsupported cases. Advanced referents in B41, routing in B43.
- **R05 — 2D/3D semantic & desktop optimization (B02–04, B09–10, B22–23):** consistent mm/metre/axis transforms, stable scene picking/navigation identifiers, paged blueprint layers and nonbreaking 3D manifest formats. B29 and B45 own new infrastructure.
- **R06 — Security/performance operations (B05, B08):** reuse RLS and logging foundations; separately cover upload/asset security (B31), durable jobs (B32), preferences/storage (B33), and worker/production metrics (B45–46).

**Upgrade workflow:** Inspect current code and tests → record evidence per ticket (`already_supported`, `missing`, `partially_supported`, `not_applicable`) → author additive changes in the **new** phase that owns them → run old phase regression suites → create new commit/checkpoint. Do not mutate old phase tags or mark old milestone incomplete without proof of a defect. Separate a real historical bug fix from a new product capability.

---


# E. Shared frontend/backend contract (proposed; not existing endpoints)

**These are proposed TypeScript-level semantics, not proof that corresponding `designflow` types or routes currently exist.** First audit actual Phase 12/16/17/20/21/23/28 code and extend it compatibly. Frontend mocks must implement the same documented contracts and be explicitly identified.

```ts
// Illustrative contract targets. Confirm names and shapes against real backend code.
type RevisionOperation =
  | "modify" | "regenerate" | "generate_alternative"
  | "recompute" | "compare" | "restore";

type ComponentScope =
  | "building.geometry" | "building.floor_plans" | "building.structure"
  | "exterior.facade" | "exterior.materials" | "exterior.render"
  | "interior.layout" | "interior.materials" | "interior.render"
  | "bim" | "engineering.structural" | "engineering.environmental"
  | "engineering.mep" | "quantities" | "cost" | "documents"
  | "scene3d" | "walkthrough";

interface RevisionRequest {
  projectId: string;
  baseRevisionId: string;
  clientRequestId: string;        // idempotency token
  instruction: string;
  operation: RevisionOperation;
  targetScopes: ComponentScope[];
  preserveScopes: ComponentScope[];
  generationConfigurationId?: string;
}

interface RevisionPreflight {
  proposalId: string;
  baseRevisionId: string;
  requestedChanges: ComponentScope[];
  hardLocks: ComponentScope[];
  reusedArtifacts: string[];
  regeneratingArtifacts: string[];
  requiredRechecks: ComponentScope[];
  staleUntilVerified: ComponentScope[];
  blockers: Array<{ code: string; message: string }>;
  clarifications: string[];
  estimatedCost?: { amount: string; currency: string; basis: string };
}

type RevisionJobState =
  | "draft" | "preflight_ready" | "needs_clarification" | "blocked"
  | "queued" | "running" | "cancelled" | "failed"
  | "candidate_ready" | "approved" | "committed";

interface ArtifactReference {
  artifactId: string;
  logicalComponentId: string;
  sourceRevisionId: string;
  contentHash: string;
  inputHash: string;
  producerVersion: string;
  providerId?: string;
  freshness: "current" | "stale" | "pending" | "blocked" | "not_applicable" | "verified";
}
```

**Required contract surfaces** (route names intentionally unspecified pending source audit):

1. Read accepted project revision, manifest and current generator configuration.
2. Create a revision **preflight** using the base revision, plain-language instruction and explicit targets/preservation locks.
3. Review/modify the typed preflight plan; report unsupported changes or needed clarification.
4. Start/cancel/check regeneration jobs and progress; subscribe only with authorization; never expose service API keys.
5. Retrieve candidate assets and compare base-vs-candidate geometry/BIM/media/quantity/cost/engineering status.
6. Approve/commit the candidate atomically with expected base revision and request idempotency key; reject safely on stale-base conflict.
7. Browse history and restore/branch via new immutable revision; audit creator, approver and effects.

**Do not invent old endpoints.** The frontend adapter should inspect current actual API schemas, preserve all existing supported paths, introduce additional routes **only when necessary**, and keep a temporary local mock that advertises its non-production status.

### Revision execution state machine

`request → parse/disambiguate → preflight/lock/dependency analysis → consent/cost confirmation → queued → scoped execution → independent checks → candidate preview/diff → user review → optimistic commit → dependent outputs published/freshness marked → history/audit`

Branches: `needs_clarification`, `unsupported`, `blocked_by_lock`, `budget_exceeded`, `stale_base`, `provider_failure`, `cancelled`, `validation_failed`, `rejected`. None of these branches writes over an accepted revision.

---



# F. Core revision/regeneration acceptance tests

1. **Exterior-only aesthetic:** change a villa's façade cladding; unchanged floor plan, wall/stair/structural model hashes; changed exterior render/materials; approve to new revision.
2. **Glazing ratio change:** detect opening/thermal/daylight/quantity/structural dependencies; require checks and potentially refuse because geometry/structure were locked.
3. **Interior-only change:** preserve exterior design and structure; change only supported internal materials/furniture assets.
4. **Blueprint-only preservation:** façade change leaves floor-plan geometry, dimensions and immutable original PDF/2D data untouched.
5. **Parametric collision:** impossible structural-preserving command returns `blocked`/`needs_clarification`; no unrequested solver rewrite.
6. **BIM/scene consistency:** changed façade component links to the same intended semantic element and correct revision ID.
7. **Cost and materials:** changed finishes alter their BOQ/cost when supported; unrelated quantities retain provenance; stale estimates never shown as verified.
8. **Undo/restore:** accept A→B, restore A as new C, with A/B/C history preserved and reviewable.
9. **Stale base/concurrent editors:** second write based on old revision fails safely; no accidental overwrite or cross-tenant modification.
10. **Provider failure/cancellation:** failed/cancelled job creates no accepted partial revision; retries do not duplicate charges/commits where controllable.
11. **Security/privacy:** users cannot read another project; external providers receive only authorized input; no secrets in frontend/network payloads/logs.
12. **Multi-floor/large models:** scope locks cover all floors and preserve local edits without cross-floor identity corruption.
13. **3D performance:** bounded loading and usable degraded experience on lower-capability desktop GPUs; separately navigable interior/exterior and appropriate accessibility fallbacks.
14. **Conversational follow-up:** “try a warmer glass finish, keep the rest” correctly targets the latest user-selected candidate or accepted revision as specified.
15. **Document freshness:** revision export shows exact version, verification and stale metadata; affected reports regenerate, unaffected reports may be reused.
16. **No mocks in verification:** production end-to-end claims are checked using real backend requests and independent artifact/model assertions.

---




# G. Frontend 56-phase → backend ownership crosswalk

The crosswalk uses the names and order of the user's 56-phase handoff. “Frontend-only” means no artificial server phase for design animations. Already delivered UI phases still need real API proof before claiming end-to-end support.

| Frontend | Milestone in supplied handoff | Backend owner(s) |
|---:|---|---|
| **F01** | Scope Freeze | B01/B16; scope gates B29–46 |
| **F02** | User Journey Mapping | B20/B21; orchestration B30/B32/B40 |
| **F03** | Information Architecture | B01/B09/B12; unified B37 |
| **F04** | Routing Architecture | B09/B12/B17; scene B29/B45 |
| **F05** | Project Setup & Toolchain | B01/B08; integration B45–46 |
| **F06** | Code & Folder Architecture | B01/B07; B45 contract suite |
| **F07** | Brand System | frontend-only; optional static assets |
| **F08** | Reusable Component Library | B01/B07; typed errors B45 |
| **F09** | Application Shell | B05/B33 session/bootstrap |
| **F10** | Desktop Workspace Adaptation | B32 job payload; B45 efficient reads |
| **F11** | Global State Architecture | B12/B17; B32 job events; B37 manifest |
| **F12** | Service Layer & API Contracts | B01/B07; B45 actual schema adapters |
| **F13** | Advanced Requirement Controls | B18/B19/B22; B29 capability config |
| **F14** | Reference Upload System | **B31** reference ingestion |
| **F15** | Generation Pipeline UI | **B32** durable jobs & progress |
| **F16** | AI Result Components | B29/B30 results; B31 storage; B37 manifest |
| **F17** | Production Logo Asset System | frontend-only (optional asset CDN) |
| **F18** | Cinematic Boot Animation | frontend-only boot animations |
| **F19** | AI Engine / Compute Status UI | **B32** truthful component health |
| **F20** | Boot-to-App Transition | frontend-only transition; B33 session restoration |
| **F21** | Authentication UI | B05 + **B33** account/session |
| **F22** | Main Dashboard | B05/B12 + B33 summaries |
| **F23** | Project Library & History | B12 + **B33** project library/history |
| **F24** | Settings / Storage / Memory Center | **B33** preferences/storage/context |
| **F25** | Main AI Chat Workspace | B20; B32 streams; B41 advanced conversation |
| **F26** | Master Prompt Composer | B18/B20 typed prompts; B30 preservation interpretation |
| **F27** | Project Brief & AI Context Layer | B20; **B33** project brief/context; B37 consistency |
| **F28** | Text-to-Project Command Experience | B19/B21; B30 revision; B32 jobs |
| **F29** | Generation Configuration & Output Selection | **B29** mode/output capability; B30 preflight |
| **F30** | Revision / Regeneration Workflow | **B29 bounded MVP + B30 full selective revision**; B32 durable jobs |
| **F31** | Complete Project Overview | **B29 manifest v1 + B37 manifest v2** |
| **F32** | Site & Plot Workspace | B19/B22; B34/37 site/layers |
| **F33** | 2D Blueprint Viewer | B10/B11; B34/B38 drawings |
| **F34** | Blueprint Tools & Layers | B10/B11; B34/38 layered measure/annotation |
| **F35** | Architectural Calculation Workspace | B02–B15; B34/37 provenance |
| **F36** | Structural / Civil Engineering Workspace | B24/B35; B34/37 evidence |
| **F37** | Materials & Quantity Workspace | B13–B14; B37/B39 quantities |
| **F38** | Budget & Cost Workspace | B15; B37/B39 BOQ/cost |
| **F39** | Reports / PDF Center | **B38** export/report jobs; B31 storage |
| **F40** | Unified Project Workspace Navigation | B33 project access; B37 canonical manifest; B45 adapters |
| **F41** | Three.js / WebGL Foundation | **B29/B45** 3D format/scene contract |
| **F42** | Building Asset Integration | B29/B31/B45 signed 3D assets |
| **F43** | Cinematic Camera System | frontend-owned camera/GSAP; optional B45 metadata |
| **F44** | Scroll-Driven Animation Engine | frontend-owned scrolling; optional B45 scene annotations |
| **F45** | Building Hotspots & Navigation | B29/B37/B45 semantic hotspots |
| **F46** | 3D Experience Modes | B29/B45 layers & scene mode manifest |
| **F47** | First-Person Walkthrough | B29/B45 navigation/collision metadata |
| **F48** | 3D Performance Optimization | **B45** compressed/streamed assets; B46 measured QA |
| **F49** | Interior Design AI Module | **B39** interior specialist; B30 revisions |
| **F50** | Exterior Design AI Module | **B39** exterior specialist; B30 revisions |
| **F51** | Blueprint-Only AI Module | **B39** blueprint specialist; B10/B34 |
| **F52** | Structural-Only AI Module | **B39** structural specialist; B24/B35 |
| **F53** | Materials-Only AI Module | **B39** materials specialist; B13–14 |
| **F54** | Budget-Only AI Module | **B39** budget specialist; B15 |
| **F55** | Cross-Module Project Context | **B37** unified dependencies + B39 specialists |
| **F56** | Final Integration, Testing & Deployment | **B45–B46** production integration verification |

---


# H. Proposed domain interfaces, evidence and engineering safety

**Contract-first rule:** Read actual designflow route/schema registry before implementation; names below describe **operations**, not currently verified URL endpoints. Preserve existing API versions and auto-test frontend adapters. Internal media models and third-party solvers may be unsupported until a vetted provider is connected.

| Domain surface | Minimum data / behavior | Target |
|---|---|---|
| Capability/config discovery | Mode/output permissions, types, dependencies, cost/policy, unsupported reasons | B29 |
| Scene/project overview | Revision-pinned component/room/level IDs; asset/manifest links; missing/freshness/limitations | B29 v1 / B37 v2 |
| Revision preflight/commit | Intent, targets, exclusions, semantic/byte locks, conflicts, budget, candidate, immutable approval/restore | B29 MVP / **B30** full |
| Upload/reference | Upload intent, content validation, ingest/scanning state, provenance, signed references, quota/deletion | **B31** |
| Job/event/readiness | Job/task graph, event cursor/polling, run/failed/retry/cancel, health and quota | **B32** |
| Account/project context | Session, project CRUD, archive, preferences, storage usage, project brief retention controls | **B33** |
| Geometry/drawing QA | Site/orientation, model IDs, layers, scale/dimensions, independent preserved-model checks | **B34** |
| Solver/engineering | Assumptions, units, structural/environment/MEP evidence, professional-review status | B35–37 |
| BIM/model dependency | Canonical source revision, derived artifact DAG, invalidation, current/stale status | **B37** |
| Exports | Artifact revision, file format, provenance, signed delivery, stale/verification status | **B38** |
| Specialists | Interior/exterior/blueprint/structural/materials/budget shared operation envelope | **B39** |
| Agent/conversation | Typed multi-tool tasks, referent grounding, scoped approvals and provider provenance | B40–43 |
| Collaboration | Roles, review signatures, conflicts, branch/restore, audit | **B44** |
| Asset/adapter production | GLB/gltf streaming, LOD, cache, semantic pick/navigation, OpenAPI/TS fixture/test | **B45** |
| E2E readiness | Installed staging schema, privacy/secrets, backups, chaos/resume, desk GPU test matrix | **B46** |

## Shared machine-readable invariants

- `projectId`, `acceptedRevisionId`, `candidateRevisionId`, `logicalComponentId`, `semanticElementId`, `jobId`, `artifactId` and `providerRunId` are not interchangeable; validate every reference and ownership relationship.
- Every deliverable declares artifact kind, source model hash, input/config/provider versions, generation scope, coordinate/unit frame, provenance, validation evidence, freshness and optional cost/rate validity.
- Concurrency-safe candidates never override accepted revisions. A restore is a new revision with lineage; previous accepted history remains available.
- A lock is enforced at its declared semantic/byte granularity. “Keep geometry” must not mean “generate a visually similar screenshot.”
- Changed windows/glazing and exterior massing invoke engineering dependency checks and may require explicit permission/qualified review; drawings must never claim buildability based on aesthetics.
- Results marked `unsupported`, `stale`, `preliminary`, `not_evaluated`, `requires_review`, `failed`, or `partial` cannot be presented as fully verified outputs.
- Heavy AI/3D/engineering tasks use external/provider workers when appropriate, with explicit privacy/data-transfer approval, rate/cost caps and server-controlled secrets. Free/open-source preference is **not** a reliability guarantee.
- No full mobile/tablet deliverable. Support desktop PCs/laptops/pro workstations and accessible degraded/no-WebGL views.

---


# I. Dependency order and non-negotiable release gates

| Release slice | Backend prerequisite | Concrete frontend impact |
|---|---|---|
| S0 — Source-truth audit | B01–28 endpoint/test inventory; retrofit R01–R06 decisions | Prevents fabricated API integrations |
| S1 — First real 3D & revision preview | **B29** supported façade finish rerender + immutable model/hash assertions, manifest v1 | F29 configuration, F30 bounded preview, F31 overview stub/live data |
| S2 — Fully safe revision workflow | **B30** typed preflight, dependency plan, consent, candidate, compare, concurrency-safe approval/restore | F30 real backend completion for supported operation types |
| S3 — Production uploads | **B31** signed, scanned, authorized reference ingestion | F14 uploads and F42 referenced assets become production-capable |
| S4 — Persistent compute events | **B32** resilient queues, progress, recovery, costs/readiness | F15/F19/F25/F28/F30 service states become production-grade |
| S5 — Product services | **B33** account/project library, privacy/retention, settings, storage | F21–24/F27 integration |
| S6 — Engineering integrity | **B34–38** QA, supertall safety, cloud solver, multidisciplinary model, report evidence | F31–40 and 3D/engineering consistency |
| S7 — Specialist AI | **B39–43** six modules, orchestration, conversation, feasibility, provider routing | F49–55 and advanced F25–30 |
| S8 — Collaboration & desktop delivery | **B44–45** review/roles, optimized scene delivery, source-verified frontend adapters | F40–48 and deployment readiness |
| S9 — Complete verification | **B46** real staging contracts, security/recovery/engineer-review, measured desktop test matrix | F56 final integration |

**Hard dependency rules**
1. B29 remains next; its existing 3D scope is not erased or renumbered. Full F30 selective regeneration is **not** complete until B30 is verified, even if UI works with mock adapters.
2. Existing B5/B12/B20 auth/history/chat are **reused**, not rewritten. B31–33 add missing product services only when source audit confirms a gap.
3. B36 cloud engineering workers build on B32 generic durable jobs, not the reverse; B39 specialists are reusable workers composed by B40 agents.
4. B37 dependency propagation prevents changes from leaking across BIM, structure, MEP, quantities, cost and reports; until then block unsupported impact or mark outputs stale.
5. B45 performance and API compatibility precede B46 integration sign-off. Do not claim 60 FPS or unrestricted Burj Khalifa engineering without measured evidence and qualified review.
6. Each release must have backward compatibility notes, migrations where necessary, explicit API/TS fixtures, safety/cost limits, reproducible tests, independent validation and a tagged clean source checkpoint.

---


# J. Expanded product acceptance & integration scenarios

In addition to the mandatory tests in Section D, the following are required for the full frontend handoff. Tests are illustrative implementation contracts, not claims of present passing results.

17. **Project overview:** A revision-pinned project manifest shows exactly which outputs were generated, unavailable, failed or stale; no module mixes accepted revision N with candidate N+1.
18. **Capability and configuration:** Reject impossible generation mode/output combinations and show why; provider absence is visible before an expensive call.
19. **Reference upload threat model:** Reject executable masquerading as PNG/PDF, oversized decompression bombs and disallowed formats; ensure quarantined content never enters model prompts unreviewed.
20. **Reference measurement provenance:** A photo with no scale cannot silently produce verified metre-accurate site/floor measurements; annotation/scale calibration required.
21. **Authenticated project catalog:** Owners can search/rename/archive/reopen their projects; another tenant cannot list, open or export them.
22. **User preferences and privacy:** Update/clear user-scoped preferences and project-context retention state; test storage-usage/quota and deletion propagation.
23. **Service readiness:** Queue/provider unavailable state is shown as degraded or blocked, not “engine ready”; provider health disclosure does not leak internal secrets.
24. **Job resume:** A running job survives worker restart; event reconnect resumes without duplicated accepted commits; cancellation preserves original revision.
25. **Main AI chat context:** Consecutive edits correctly reference the selected accepted/candidate revision and the named room/material, with clarification if ambiguous.
26. **Site and units:** Site orientation, setbacks, plotting units, dimension scale and local/global transforms agree in blueprint and 3D pick results.
27. **Blueprint layers:** Toggle/render/measure valid wall, stair, door and zone layers; annotation-only change never rewrites model geometry.
28. **Engineering truthfulness:** A structure or energy result lacking validated solver evidence is marked preliminary, not certified; stale outputs block professional claims.
29. **BOQ/cost change propagation:** Material variant changes update relevant quantities/cost or mark stale; other disciplines do not silently inherit the wrong revision.
30. **Report integrity:** Export exact requested revision with signed/authorized download and accurate completeness/assumption metadata; report is not signed off without review.
31. **3D semantic navigation:** User clicks an exterior mesh, selects a floor and walks to a room; all references resolve to stable BIM/floor element IDs with no cross-revision mismatch.
32. **Desktop GPU constraints:** Run measured loading, peak memory, FPS/frame pacing and context-loss tests on representative laptop/desktop hardware, including lower-tier fallback.
33. **Interior specialist:** Design-only change preserves exterior and structural locks; unsupported space-planning edits request scope expansion.
34. **Exterior specialist:** Cladding swap changes permitted façade assets while preserving plan/structure; changing glazing geometry triggers impacted engineering preflight.
35. **Blueprint specialist:** Precision blueprint-only run reuses canonical solver/QA and emits a revisioned plan without extraneous image/render jobs.
36. **Structural specialist:** Structural-only analysis is backed by solver evidence, authenticated input data, assumptions and human-review state.
37. **Materials specialist:** Quantity/material operations track units/recipes and source provenance; no invented supplier pricing.
38. **Budget specialist:** Budget-only scenario uses region/rate basis and explicit partial cost values; absence of rates is not represented as zero.
39. **Cross-module propagation:** A single source revision is used in overview, drawing, hotspot, BIM, quantity, cost, reports and specialist tools; stale derived artifact is surfaced and blocked when consequential.
40. **Real production integration:** All F01–56 capability entries marked production-supported have a real contract test and verified environment evidence; UI-only functionality is tested in frontend, not fabricated as a backend endpoint.

---

41. **Source audit regressions:** existing completed B01–28 test suites pass after additive contract changes, historical tags unchanged and migration rollback documented.
42. **Strict preservation lock:** protected geometry/structure/blueprint remain hash/semantic-identical through façade-only regeneration; conflicting opening changes require explicit scope extension or block.
43. **Reference storage isolation:** malicious upload is quarantined, tenant-scope deduplication cannot leak files, revoked users cannot reuse signed links after appropriate enforcement/expiry.
44. **Durable recovery and cost:** kill worker and restart; no duplicate immutable commit, no unbounded provider retry charges, event reconnect yields consistent state.
45. **Account/context deletion:** revoke session, delete bounded project context, observe appropriate retention cleanup, isolate per-user preferences and storage billing.
46. **Six real specialist modes:** interior/exterior/blueprint/structure/materials/budget all return domain-correct artifacts and typed refusal for unimplemented actions.
47. **Contract drift:** generated shared TypeScript schema and actual backend sample payloads match; F30/F31/F41–48 client adapters pass staging tests without mocks.
48. **Performance and scale:** measured scene byte/texture/triangle budgets and low/mid/high desktop GPU load profiles; report degraded mode for constrained devices and limitations for very large projects.

---


# K. Definition of done, source governance and change log

**Every new backend phase must provide:** authoritative `designflow` code, versioned domain contracts, unit/integration/security tests, negative/limit tests, migration/backward compatibility checks, engineering evidence/provenance where relevant, a clear failure/cost/quotas story, source-grounded frontend mapping, staging proof of at least one live user workflow, documented unsupported conditions, phase tag and clean checked baseline. A mock UI, model rendering alone or documentation alone never counts as backend completion.

**Source separation:** update only the backend roadmap document here; neither `designflow` backend repository nor NekoArch frontend repository has been changed, deployed, merged, audited or tested in this task.

**Changes vs prior 40-phase edition:**
1. Increased future phase count from **40 to 46** because six independent critical product services were previously overloaded inside B29/B32/B35/B40.
2. Added **new B30 revision/regeneration engine**, B31 secure upload/artifact lifecycle, B32 durable job/event lifecycle, B33 account/library/preferences/context, B39 six specialized AI workflows and B45 workstation scene/API optimization.
3. Kept B01–28 release status/tags and B29 number unchanged; preserved and renumbered every old planned B30–40 milestone with a traceability table.
4. Added **28-line completed-phase audit** and six focused non-destructive retrofit packages. Marked all proposed gaps **unverified until a source-code audit**, preventing invented completion/defect claims.
5. Remapped **every F01–F56 frontend phase** to an appropriate existing, new or re-numbered backend milestone and labeled frontend-only cinematic/GSAP features as frontend responsibilities.
6. Separated **MVP scoped 3D regeneration (B29)** from **full transaction-safe regeneration (B30)** and **durable processing (B32)** so frontend F30 integration has honest acceptance gates.
7. Kept source-grounded 3D/engineering/provenance, materials/cost, collaboration and security requirements; expanded the test matrix from 40 to **48 representative scenarios** with release sequencing and source-truth restrictions.
8. Maintained no full mobile/tablet requirement; backend performance deliverables focus on PC/laptop/workstation assets while GSAP/Three.js cameras/scroll remain frontend owned.

**Decision:** **46 phases is a proposed implementation structure, not evidence that 46 phases have been executed.** Future feature additions should justify a bounded standalone milestone; do not expand phase count merely to make the roadmap look more extensive.
