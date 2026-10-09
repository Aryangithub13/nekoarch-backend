# NekoArch backend — Phases 1–29 modernization report

| Item | Value |
|---|---|
| Repository / worktree | `designflow` → `designflow-modernization` |
| Branch | `modernization/phases-1-29` |
| Baseline | `backend-v1-phase29-complete` = `c7e4bc0` (verified: tag object → that commit, subject "Backend V1 Phase 29 complete") |
| Scope | Modernization of completed Phases 1–29 only. **Phase 30 was not started.** No Phase 30–46 capability was implemented. |
| Date | 2026-10-08 |

Status vocabulary: `implemented_verified`, `implemented_unverified`, `partial`, `missing`, `unsupported`, `blocked`, `future:<phase>`.

## A — Executive summary

The Phase 1–29 foundation is in good condition. The source audit found no critical or high-severity defect in correctness, revision integrity, RLS or credential handling. All 2 556 + 133 + 52 baseline tests pass on the untouched `c7e4bc0`.

The modernization therefore stays small and additive: 7 source files changed, 1 added, and every change is covered by new tests. It closes five evidence-backed gaps between what the backend *can do* and what a frontend or assistant can *discover and consume*:

| # | Gap (evidence) | Change | Workstream |
|---|---|---|---|
| G1 | The Phase 29 3D scene engine was invisible to clients. `/api/capabilities` reported `SCENE_3D: PLANNED` (Phase 16 registry, still true for workflow *steps*). The structural, environmental, systems, knowledge and optimization engines were not listed at all. | Additive discovery v2: `services`, `media` and `aiCapabilities`; Phase 16 fields byte-identical. | R01, R04, R07-D |
| G2 | There was no project overview. Freshness (Phase 17) covered only takeoff, construction and cost; seven engines had per-engine status endpoints only. | Read-only `GET …/revisions/:revisionId/overview`. It returns revision-bound references for 11 engines, with explicit `NOT_GENERATED`, stale-count, `unsupported` and claim states. | R03, R07 §3.8 |
| G3 | Scene assets were served uncompressed with no revalidation. Measured: GLB and manifest compress 10–12×. | Stdlib gzip on request, per-encoding strong ETags, `304` for immutable GLB bytes after authorization, CORS `ETag`/`If-None-Match`. | R06, R07-B |
| G4 | The assistant's `CHECK_CAPABILITIES` tool told users 3D was unimplemented. | It returns the same `services`/`media` truth (optional fields). | R04 |
| G5 | There was no source-derived API inventory, and no test that every project route requires a session. | A checked-in route catalog generated from Fastify (81 routes) with an anonymous-access inventory, enforced by a test. | R01, R06 |

The independent verifications added (scene↔BIM resolution, cross-revision geometry preservation proven against the BIM diff, stale-base refusal) found **no defect** in Phases 9–29. They are kept as regression tests.

## B — Phase 1–29 audit (source-grounded)

The evidence column names the source and the tests that execute it. The status is the historical Phase scope, re-verified by the full suite on `c7e4bc0` and again on the modernized HEAD.

| Ph | Implemented capability (from source) | Evidence | Status | Modernization finding / future |
|---|---|---|---|---|
| 1 | Workspaces, Zod contracts (`packages/shared`), typed `ApiErrorResponse` | `shared/tests/contracts.test.ts`, `foundation.test.ts` | implemented_verified | No OpenAPI/JSON-Schema export: zod 3.25 v3 schemas, no converter installed. Route catalog added (G5); schema export remains R01-G3. |
| 2 | Integer-mm geometry and precision rules | `generator/tests/geometry.test.ts`, `building-v2-precision.test.ts` | implemented_verified | — |
| 3 | Walls, storeys, invariants | `generator/tests/invariants.test.ts`, `building-v2-model.test.ts` | implemented_verified | — |
| 4 | Topology, adjacency, circulation | `blueprint-qa/tests/circulation-stairs.test.ts` | implemented_verified | Phases 1–4 have no individual tags; their source is in the root commit `6670abe` (tagged Phase 5). |
| 5 | Supabase/Postgres persistence, RLS, estimates | `supabase/tests/database.test.ts`, `backend.integration`, `estimate-service` | implemented_verified | **R06-F1 (low), closed — accepted as a tested contract:** 4 legacy plan/estimate POST/PATCH routes validate the body before authenticating (anonymous empty body → 400, not 401). A session is still required for any valid request. Phase 5 tests deliberately pin this order (`foundation.test.ts`: typed, redacted 400s for anonymous malformed or invalid bodies), so reordering would break verified behaviour for no security gain. Recorded in the catalog test. |
| 6 | Seeded deterministic generator | `generate.test.ts`, `furniture.test.ts` | implemented_verified | — |
| 7 | Generator/API integration | `generation.test.ts`, `generation.integration` | implemented_verified | — |
| 8 | Limits, timeouts, readiness, Sentry scrubbing, structured logs | `hardening.test.ts` / `.integration` | implemented_verified | CORS extended additively (G3). |
| 9 | Building Model V2 | `building-v2-*.test.ts` | implemented_verified | — |
| 10 | Precision blueprint V1 | `blueprint.test.ts` (55) | implemented_verified | Drawing sheets/PDF/DXF → future:38 (`PROFESSIONAL_2D` PLANNED). |
| 11 | Independent blueprint QA | `blueprint-qa/tests/*` | implemented_verified | — |
| 12 | Projects, immutable revisions | Migration 0006:<br>• immutability triggers<br>• parent ancestry FK<br>• `baseRevisionId` conflict `P1202`<br>• QA-accepted pointer constraint<br>Tests: `projects.integration`, modernization Test 10 | implemented_verified | A candidate (unaccepted) revision state does not exist → future:30. |
| 13 | Quantity takeoff | `takeoff.test.ts`, `takeoffs.integration` | implemented_verified | Listed in the overview. |
| 14 | Construction calculations | `construction.*` | implemented_verified | Listed in the overview. |
| 15 | BOQ/cost | `cost.test.ts`, `costs.integration` | implemented_verified | Listed in the overview. |
| 16 | Multi-mode workflows; planner BLOCKS unavailable outputs | `workflows.*` | implemented_verified | G1 fixed. **R01-G2:** scene/analysis engines are not workflow steps (needs a workflow-SQL migration); remains planned. |
| 17 | Generation identity and freshness | `freshness.*` | implemented_verified (takeoff/cost chain) | G2: the per-revision overview covers all 11 engines. The dependency graph → future:37. |
| 18 | NL interpreter (finite grammar + provider) | `interpretation.*` (`test:interpretation`: 133 tests) | implemented_verified | Scoped "keep everything else" commands → future:30/41. |
| 19 | Precision solver V2 | `solver-v2.*` | implemented_verified | — |
| 20 | Conversations, typed read-only tools, approval gate | `conversations.*` | implemented_verified | G4 fixed. |
| 21 | Provider registry with privacy routing, metered gating, circuit breaker, provenance, deterministic fallback | `ai-*.test.ts` | implemented_verified | Per-user budgets → future:33. Runtime provider health is not exposed (`orchestrator.status()`) → future:43. |
| 22 | Parametric architecture | `parametric*.test.ts` | implemented_verified | — |
| 23 | Semantic BIM, IFC, element diff (geometry vs property) | `bim.*`, Phase 23 IFC evidence | implemented_verified | The BIM diff is the authoritative geometry-lock primitive; it is now cross-checked against scene geometry (Test 2/9). |
| 24 | Structural engineering (with audit repair A01–A06) | `structural.*` | implemented_verified | Listed in the overview. |
| 25 | Environmental simulation | `environmental.*` | implemented_verified | Listed in the overview. |
| 26 | MEP/fire/vertical transport | `systems.*` | implemented_verified | Listed in the overview. |
| 27 | Specialized knowledge | `knowledge.*` | implemented_verified | Listed in the overview. |
| 28 | Optimization studies (candidates never adopted) | `optimization*` | implemented_verified | Listed in the overview. |
| 29 | Deterministic BIM-bound scene compiler, GLB, independent validator, worker pool | `scene3d.*`, `scene.integration`, Khronos validator 0/0 | implemented_verified | G1, G2, G3 and independent cross-checks (section D). |

**Security sweep (R06):**
- 23/23 public tables have RLS enabled.
- 33/33 `SECURITY DEFINER` functions pin `search_path`.
- The only anon `EXECUTE` grant (`project_read`) serves `visibility = PUBLIC AND status = ACTIVE` only; every other action requires `auth.uid()`.
- All 67 project-scoped routes (of 81 in total) under `/api/projects/:projectId/…`, except `/public`, return 401 anonymously (catalog test).
- Provider credentials are resolved server-side from `AI_PROVIDER_*_API_KEY` env names; clients cannot supply endpoints or models.

## C — R01–R07 results

| WS | Result | Code | Tests |
|---|---|---|---|
| R01 API/contracts | G1 discovery v2; G5 route catalog. **Open:** JSON-Schema/OpenAPI export (R01-G3, needs a dependency decision), engines as workflow steps (R01-G2). | `services/overview-service.ts`, `routes/workflows.ts` | `modernization.test.ts` |
| R02 Revision safety | Re-verified, no change needed:<br>• immutability, ancestry, optimistic concurrency, accepted-only pointer, idempotency<br>• revision-pinned artifacts never rewritten (Test 10)<br>• the stale base is refused with `REVISION_CONFLICT`<br>• `?require=current` → `SCENE_ARTIFACT_STALE` | — | `modernization.integration` Tests 2/9/10 |
| R03 Dependencies/freshness | G2 overview. Artifacts are revision-bound, so changed geometry makes every engine's output stale by construction. The overview exposes this per engine (`otherRevisionArtifacts`, `revisionCurrency`). | `services/overview-service.ts`, `routes/projects.ts` | Test 8 |
| R04 AI/providers | G1 `aiCapabilities`; G4 assistant tool truth. Privacy/cost/fallback/provenance re-verified by the existing suite. | `contracts/conversations.ts`, `routes/conversations.ts` | R04 test |
| R05 Geometry/BIM | Verified, no change needed:<br>• every scene object resolves to the BIM element of the same `source.collection/id` in the same revision<br>• levels resolve to BIM levels<br>• junction fills are the only unlinked objects (`bimElementId: null`, by design)<br>• units are explicit (manifest mm, GLB m) | — | Tests 1/4 |
| R06 Security/perf | Sweep above; G3 delivery; R06-F1 recorded. The overview route was added to the Sentry safe-route allowlist. | `routes/scene.ts`, `app.ts`, `lib/sentry.ts` | catalog + R07-B tests |
| R07 3D/scene | G1–G3 plus independent preservation verification (section D). | as above | Tests 1, 2, 4, 8, 9, 10, R07-B |

**Mutation check of the new tests.** Three mutants, all killed:
- serving 304 for the manifest;
- ignoring `gzip;q=0`;
- listing other-revision scene artifacts as this revision's outputs.

## D — Phase 29 technical assessment

**Geometry → scene.** The scene compiler is deterministic and validated by an independent validator.
- **Coordinates:** integer-mm model frame; GLB in metres relative to the origin, identity axes.
- **Bounded profile:** ≤ 2 storeys, orthogonal geometry, one straight stair, no columns. Larger buildings are refused with `SCENE_UNSUPPORTED_MODEL`, not approximated. This is the main scaling limitation (future:35/45).

**New independent verification on real PostgreSQL** (`modernization.integration.test.ts`):
- **Tests 1/4.** All non-junction scene objects resolve, via the BIM element API of the *same revision*, to the element with the same source collection and id. All levels resolve.
- **Tests 2/9 — geometry edit.** A real ground-floor west-wing edit (9 000 → 10 000 mm) produces revision B. A test-local GLB decoder converts each object to absolute half-mm coordinates plus indices, independent of origin shifts.
  - Every scene object whose BIM element the Phase 23 diff reports as `UNCHANGED` has byte-identical geometry (> 20 objects).
  - Every changed object's BIM element carries `MODIFIED_GEOMETRY`.
- **Test 2 — property-only edit.** Renaming a space in a supplied revision changes the model hash, and the BIM diff shows `MODIFIED_PROPERTY` only. Every scene object keeps identical geometry, and the object-id set is equal.
- **What this establishes.** It is the strongest *aesthetic-only* edit expressible today.
  - It shows that non-geometric model edits cannot disturb compiled geometry.
  - It shows that a scene-level geometry lock can be verified independently through BIM element identity.
- **Exterior material regeneration (Test 2 as literally specified): `blocked`.** Exact missing dependencies:
  1. The scene compile input is strictly `{}` (`SceneInputSchema`), and SQL `scene_write` recomputes `inputHash` from `{compilerVersion, manifestVersion, source}` only.
  2. Materials are fixed `VISUAL_PLACEHOLDER` colours with no variant input.
  3. `EXTERIOR_DESIGN` is `PLANNED`.

  Appearance variants need a compiler input, a migration and candidate semantics. That is Phase 30 design scope.

**Test 10 — failure safety.**
- A write with a superseded `baseRevisionId` → 409 `REVISION_CONFLICT`; the current pointer and artifact rows are unchanged.
- Historical artifact bytes still re-hash to their manifest SHA-256.
- Compile failure, cancellation and validation errors were already covered by Phase 29 (`scene-pool.test.ts`, `scene.integration.test.ts`: invalid/forged/unvalidated output is never stored). They were re-run in the full suite.

**Tests 5/7.**
- Khronos glTF validator: 0 errors / 0 warnings (Phase 29 acceptance, re-run).
- Navigation equals Blueprint QA's circulation graph (Phase 29 validator, re-run).
- Not re-implemented.

**Delivery performance (Test 6).** From [`evidence/delivery-benchmark.json`](evidence/delivery-benchmark.json), produced by `npm run benchmark:delivery`:

| Fixture | Objects | GLB identity → gzip | Manifest identity → gzip | First load, Phase 29 → modernized | Reload with client copy |
|---|---|---|---|---|---|
| single | see JSON | 117 904 → 11 663 B | 52 863 → 6 363 B | 170 767 → 18 026 B | 170 767 → 6 363 B |
| L | | 112 320 → 10 965 B | 51 474 → 6 268 B | 163 794 → 17 233 B | → 6 268 B |
| setback | | 229 320 → 25 053 B | 87 011 → 9 597 B | 316 331 → 34 650 B | → 9 597 B |
| maximum | | 474 636 → 38 942 B (12.2×) | 208 813 → 17 092 B (12.2×) | 683 449 → 56 034 B (12.2×) | 683 449 → 17 092 B (40×) |

- **Cost:** gzip-6 median ≈ 1–4 ms per asset, run on the libuv thread pool (async `zlib.gzip`), not the event loop.
- **Not changed (decisions):**
  - Brotli: gzip ≈ brotli-q4 size here.
  - Mesh instancing/batching: the Phase 29 benchmark keeps per-object meshes for picking identity.
  - Object storage/streaming: future:31.
- **No browser FPS is claimed.** None was measured.

**Overview latency** ([`evidence/overview-latency.json`](evidence/overview-latency.json)). Embedded PostgreSQL with real RLS roles, in-process requests, 25 samples, a revision with one takeoff and one scene:

| Measurement | Median | p90 |
|---|---|---|
| One overview request (6 621 B) | 18.6 ms | 26.1 ms |
| The 9 equivalent calls, sequential | 19.4 ms | 21.4 ms |
| The 9 equivalent calls, parallel | 12.6 ms | 15.5 ms |

- **Server time is comparable; the overview is not faster on the server.** It also reads and schema-checks the revision model to report `modelHash` and `identityConsistent`.
- **Its benefit is one request instead of nine round trips.** That network saving was **not measured** here, so no latency improvement is claimed.

## E — Frontend compatibility

**Blocked:** the NekoArch frontend repository is not present on this machine. `/home/aryan/NekoArch` is an old backend copy at Phase 18, not the frontend. Test 11, comparing against real frontend TypeScript adapters, could therefore not be executed. The classification below is from the backend side only. It uses the real routes in [api-routes.json](api-routes.json).

| Frontend phases | Backend support | Class |
|---|---|---|
| F01–F12 foundation/API | Typed error envelope, request ids, CORS, route catalog, discovery v2 | live (schemas: partial, no OpenAPI) |
| F13–F16 requirements/uploads/generation | Interpreter, generation, workflows. Uploads | live / uploads: planned (B31) |
| F17–F20 startup/compute readiness | `/health/ready`, worker-pool 503 + Retry-After | partial (no job service; B32) |
| F21–F24 auth/projects/settings | Supabase sessions, projects, history, archive status | live; settings/library search planned (B33) |
| F25–F28 chat/context | Conversations, typed tools, approval | live |
| **F29 generation configuration** | Modes, capability registry, plan with BLOCKED/UNAVAILABLE, discovery v2 media/services | live (3D as a workflow output: planned, R01-G2) |
| **F30 revision & regeneration** | Revisions, ancestry, base conflict, BIM diff, revision-pinned artifacts | partial: foundations only; the workflow is B30 |
| **F31 project overview** | `GET …/overview` v1 | live (initial manifest; unified model B37) |
| F32–F35 site/blueprints/measurements | Revision model, QA, takeoff | live (drawing sheets B38) |
| F36–F38 structural/materials/budget | Structural, construction, BOQ | live |
| F39–F40 reports/navigation | Engine reports via JSON; IFC | partial (B38) |
| **F41–F48 interactive 3D** | GLB + manifest (layers, rooms, nav hints, cameras, BIM ids), gzip/304 | live within the bounded profile; renders/panorama/video unsupported |
| **F49–F50 interior/exterior AI** | — | unsupported (explicit in `media`/`unsupported`) → B39/B43 |
| F51–F54 blueprint/structural/materials/budget AI | Deterministic engines exist; AI modules do not | planned (B39) |
| F55 cross-module context | Overview v1 | partial (B37) |
| F56 final integration | — | planned (B45–46) |

## F — Verification

| Run | Result |
|---|---|
| Baseline `npm run check` on untouched `c7e4bc0` (worktree `designflow-phase29`) | exit 0; 73 files / 2 556 tests + 133 + 52 |
| Modernized `npm run check` run 1 ([evidence/check-run1-failed.txt](evidence/check-run1-failed.txt)) | **exit 1.** 1/2 566 failed: the Phase 8 telemetry guard (`hardening.test.ts`) caught that the new overview route template was not on the Sentry safe-route allowlist, so error reports would have dropped its route tag. Fixed in `lib/sentry.ts`. |
| Modernized `npm run check` run 2, final ([evidence/check.txt](evidence/check.txt)) | **exit 0**: build, typecheck, lint, then 75 files / 2 566 tests + 133 + 52 (baseline + 2 files / 10 tests) |
| New unit tests `modernization.test.ts` | 4/4 |
| New PostgreSQL tests `modernization.integration.test.ts` | 6/6 |
| Mutants against new tests | 3/3 killed |
| `test:ifc` (IfcOpenShell) | **Not re-run.** No BIM/IFC code changed, and the script overwrites historical Phase 23 evidence (`docs/phase23-evidence/ifc-verification.json`). Phase 29's run recorded it passing. |
| `test:supabase` (local Supabase stack) | **Not run.** It needs the Docker Supabase stack. The RLS/RPC paths used by the overview are the existing per-engine RPCs, which are exercised on real PostgreSQL with real RLS roles by the integration suite. |
| Browser FPS / GPU | Not measured. No claim. |

## G — Git and release evidence

| Item | Value |
|---|---|
| Original baseline | `c7e4bc0` (`backend-v1-phase29-complete`) |
| Historical tags | 26 tags, snapshot [tags-before.txt](evidence/tags-before.txt) (sha256 `f572433e…`). Re-compared after commit: unchanged. |
| Migrations | none added or modified (0001–0019 untouched) |
| Modernization commit / tag | recorded in [checkpoint.txt](evidence/checkpoint.txt) |
| Remote operations | none (no push, no deploy, no paid API) |

## H — Backend Phase 30 readiness: **CONDITIONAL GO**

**Ready (verified):**
- Immutable, ancestry-linked revisions with optimistic concurrency.
- Revision-pinned artifacts with currency.
- Stable source-role element identity across revisions (BIM ids, scene object ids).
- A BIM diff that separates geometry from property changes.
- An independent scene-geometry preservation check driven by that diff.
- Truthful capability discovery and a project overview to show before/after state.

**Conditions:** Phase 30 scope, not modernization defects.
1. A candidate (unaccepted) revision state and approval/rejection do not exist. Today every persisted revision is QA-accepted and immediately current.
2. There is no declared lock model. "Preserve floor plan/structure" must become an explicit request field checked by the BIM-diff-based verifier.
3. Appearance-only scene variants need a compiler input, a migration (the SQL `inputHash` binding) and candidate-preview semantics (section D, Test 2 blocker).
4. Scene/analysis engines are not workflow steps (R01-G2). Phase 30 orchestration must either call the engine services directly or add them to the workflow SQL.
5. Frontend contract verification against the real adapters is blocked until the frontend repository is available.

This assessment does **not** authorize Phase 30.

## I — Remaining work by phase

| Item | Phase |
|---|---|
| R01-G3: JSON-Schema/OpenAPI export from Zod. Decide between adding `zod-to-json-schema` and migrating to Zod v4 `toJSONSchema`. | modernization follow-up / B45 |
| R01-G2: scene and analysis engines as workflow steps | modernization follow-up, or B30/B32 |
| Candidate revisions, locks, scoped regeneration, approval, restore-as-new-revision, before/after comparison | B30 |
| Uploads/reference artifacts, object storage, signed URLs, streaming | B31 |
| Durable jobs, progress, cancellation, budgets | B32 |
| Library/settings/per-user budgets/context | B33 |
| Large/complex models, supertall, > 2 storeys in the scene | B34/B35 |
| Unified dependency graph, cross-discipline freshness propagation | B37 |
| Drawing sheets, PDF/DXF/SVG | B38 |
| Interior/exterior/render/panorama/video AI providers | B39/B43 |
| Instancing/LOD/chunked progressive delivery, desktop GPU measurement | B45 |
