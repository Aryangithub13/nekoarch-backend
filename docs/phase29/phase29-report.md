# Phase 29 report — advanced 3D architecture & scalable scene engine V1

## Classification

**PHASE 29 FULLY IMPLEMENTED AND VERIFIED WITHIN BOUNDED SCOPE**

Basis: the first and only frozen-source release run (run 1), executed 2026-10-08.

| Item | Value |
|---|---|
| Worktree | `designflow-phase29` |
| Branch | `phase29/advanced-3d-scene-engine` |
| Baseline | `backend-v1-phase28-complete` = `7ca99df` |
| Gates | 70 / 70 exit 0; no waived failure; no skip |
| Source manifest | `3d4aad29b117577ff7e652d9fa19a98f38e3b8cdabb0e50dbc1d4744ee431381` (468 files) |
| Protected directories | unchanged before and after every gate |
| Full record | [phase29-verification.md](phase29-verification.md) |

A scene **visualizes the accepted revision exactly as modeled**:
- **Source:** it is compiled from the canonical Building Model V2, bound to its revision by model hash, and validated against it by an independent validator.
- **What it is:** a deterministic scene compiler, not a renderer or generative model. No photorealism, engineering compliance, egress, accessibility or construction-readiness claim is made; all 7 claims are fixed `NOT_CLAIMED`.

## Capabilities delivered

| Area | Delivered |
|---|---|
| Scene compiler (`apps/api/src/scene3d/`) | Building Model V2 → `scene-manifest-v1` + glTF 2.0 GLB (`scene-compiler-v1`). A single closed-grid extruder (`mesh.ts`) builds every solid.<br>• **Walls:** butt-ended centerline prisms with **real apertures**.<br>• **Slabs:** exact orthogonal footprints with **voids left open**.<br>• **Stairs:** treads/risers from the exact per-riser heights, plus a final riser.<br>• **Landings:** walking surfaces.<br>• **Placeholders** (`VISUAL_PLACEHOLDER`): door leaves, window panes, corner junction fills.<br>• **Room helpers:** hidden selection volumes (`SEMANTIC_ONLY`). |
| Supported scope | Exactly the released Phase 23 bounded profile, enforced by reusing `bim/core.ts sourceModel()`: ≤ 2 storeys, ≤ 28 spaces, ≤ 200 walls and ≤ 200 openings, ≤ 32 slabs and ≤ 32 voids, 1 straight stair, no columns; orthogonal geometry; Blueprint QA with no errors. Anything else is a typed `SCENE_UNSUPPORTED_MODEL`. |
| Semantics | `root → level → layer → object` nodes. Every object node carries `sceneObjectId = <role>:<sourceEntityId>`, `sourceEntityType`/`Id`, `bimElementId` (from the Phase 23 projection), `layer`, `levelId`, `geometryRole`, `fidelity`, revision id and model hash. There are 10 layers: `ROOM_VOLUMES` and `SEMANTIC_HELPERS` are hidden by default. A coverage entry exists for every modeled entity, so nothing is silently omitted. |
| Rooms / navigation / cameras | **Rooms:** an interior point, area, openings and connected spaces per room.<br>**Navigation:** nodes and edges copied from **Blueprint QA's validated circulation graph** (doors, passages, stair); egress, accessibility and collision-free paths are `NOT_CLAIMED`.<br>**Cameras:** overview, three-quarter, top-down, exterior orbit, roof-hidden interior, one per floor, one per room, plus linear transition hints. |
| Coordinates / precision | **Manifest:** integer millimetres in the model frame.<br>**GLB:** metres, identity axes (no mirroring); the root translation is the model origin and float32 positions are local to it.<br>**Grid check:** every vertex must decode back to the 0.5 mm grid within 50 µm.<br>**Extent:** ≤ 800 m, which keeps the worst-case float32 error at 47.7 µm, inside that tolerance. A test enforces the relationship. |
| Independent validator (`validate.ts`) | **Independence:** its own GLB reader and integer half-mm arithmetic; it never imports the compiler, mesh builder or writer (gate + test + mutant).<br>**GLB structure:** container, accessors, indices and node graph.<br>**Hashes and binding:** GLB SHA-256, input and scene hashes, model and parameter hashes, BIM ids.<br>**Coverage** of every modeled entity.<br>**Geometry checks:**<br>• Per-object bounds, divergence-theorem volume and face areas.<br>• Exact axis normals: this catches winding errors and any normal byte change.<br>• Axis-ray aperture probes that fix door/window width, offset, sill and height.<br>• Slab-void probes; stair profile volume; landings; placeholders inside their apertures; junction fills clear of apertures.<br>**Rooms, navigation (equal to the QA graph) and cameras.** |
| Execution | Generic `lib/worker-pool.ts` (bounded size and queue, terminate on timeout, heap cap, graceful drain). `OptimizationPool` is now a configured subclass; the unchanged Phase 28 pool and integration tests prove its behaviour is identical. `ScenePool`: size `min(2, CPUs−1)`, queue 8, 20 s ceiling, 512 MiB. Unvalidated, malformed or hash-inconsistent worker output is a worker failure, so it is never stored. |
| Persistence (migration 0019) | **`project_revision_scene_artifacts`:** immutable; owner-read RLS; READY-only; columns tied to the manifest; fixed claims; overlays NOT_EVALUATED.<br>**`project_revision_scene_blobs`:** GLB `bytea`; RLS on with **no policy and no grant**, so it is reachable only through `scene_read`.<br>**Signed `scene_write`:** HMAC envelope; ownership; QA acceptance; SQL recompute of the binding (canonical model hash, generator, parameters), `inputHash` and `sceneHash`; byte SHA-256, length and magic; coverage counts against `model_json`; validation VALID; idempotency; convergence; nondeterminism rejection. **The row and its bytes are inserted in one transaction**, so there is no partial artifact and no orphan. |
| API ([phase29-api.md](phase29-api.md)) | Routes: `POST /validate`, `POST /artifacts`, `GET /artifacts`, `GET /artifacts/:id`, `GET …/manifest`, `GET …/glb`, `GET /status`. `?require=current` → 409 `SCENE_ARTIFACT_STALE`; the GLB download is private and no-store with a SHA-256 ETag. Compute quota and telemetry templates are wired. |
| Visual acceptance | `docs/phase29/render-previews.mjs`: an offline software rasterizer that reads the GLB through the independent `@gltf-transform/core` reader. It produced 13 PNGs in `evidence/final/previews/`: exteriors, roof-hidden interiors, upper-floor isolation, the stair through its slab void, and an L-plan with 24 rooms. These are supplementary evidence. |

## Verification summary (release run 1)

| Suite | Result |
|---|---|
| `test:scene3d` (compiler/validator 23 + pool 5 + DB/HTTP 11) | 39 passed |
| `test:unit` | 2250 passed |
| `test:integration` | 264 passed |
| `test:supabase` (live local stack, incl. scene acceptance) | 115 passed |
| `db:test` (pgTAP) | 96 / 96 |
| `npm run check` | 2556 + 133 + 52 passed |
| `test:optimization` (Phase 28, after the pool refactor) | 86 passed |
| All other historical suites | passed, unchanged counts |
| Khronos `gltf-validator` 2.0.0-dev.3.10 | 0 errors, 0 warnings on every fixture |
| Independent reader `@gltf-transform/core` | parses every GLB; node, mesh, translation and metre scale checked |
| Mutation (`docs/phase29/mutation-test.py`) | **31 / 31 killed for the intended reason**, all restored by SHA-256; controls clean before and after |
| Docker | Non-root runtime image without `gltf-validator`/`@gltf-transform`. Compiled acceptance for Phases 23–29; the Phase 29 one runs `dist/scene3d/worker.js`. Its GLB SHA-256 is identical to the local Node 26 build (Node 22.23.3), so output is byte-identical across runtimes. |
| IFC | 7 fixtures, 0 schema diagnostics; 7/7 architecture byte-identical |
| DB preservation | 0 pre-existing rows missing; RLS on every table; pre-existing policies unchanged; only 0019 added |

The 31 mutants cover:
- **Geometry:** removed opening, door width, window sill, wall thickness, floor Y, filled void, omitted stair.
- **Mesh and serialization:** reversed winding, corrupt index, dropped source id, scale, nondeterministic node order.
- **Identity:** forged model hash; GLB bytes changed without the checksum.
- **Validation and provenance:** validation bypass, provenance relabel, skipped entity, camera target, room mapping, resource limit, validator independence, aperture probe disabled.
- **Persistence, access and execution:**
  - foreign artifact read, blob table exposed, READY row without bytes, stale bypass;
  - worker bypass, unvalidated worker output;
  - SQL hash check removed, SQL coverage bypass, RLS owner-read bypass.

## Benchmark (`benchmark:scene`, release run; Node v26.10.0, 12 CPUs)

| Fixture | Objects | Triangles | GLB bytes | Manifest bytes | Compile ms | Validate ms | Unique mesh shapes | Max float32 error |
|---|---|---|---|---|---|---|---|---|
| One storey (solver) | 52 | 1 076 | 117 904 | 52 863 | 53.7 | 48.1 | 24 | 0.95 µm |
| L | 48 | 992 | 112 320 | 51 474 | 38.1 | 38.0 | 22 | 1.07 µm |
| Two-storey setback + stair | 90 | 2 246 | 229 320 | 87 011 | 87.8 | 67.9 | 53 | 1.07 µm |
| Maximum 24 rooms | 203 | 4 272 | 474 636 | 208 813 | 213.2 | 176.4 | 29 | 3.28 µm |
| Setback 400 m / 250 m from origin | 90 | 2 246 | 229 788 | 88 464 | 70.0 | 62.6 | 53 | 1.07 µm |

**Compiler:**
- Compile time is about 80% the reused Phase 23 gate plus BIM projection. Geometry takes 5–29 ms and serialization 3–8 ms.
- Repeated compiles are byte-identical.
- Base64 round trip plus SHA-256 takes under 1 ms.

**Worker pool:**
- Latency is 214–497 ms. The main event loop stays at the 10 ms histogram floor (max 11 ms).
- Four concurrent 24-room compiles take 1.47 s (163 per minute); max queue wait is 0.9 s.
- Saturation test (size 1, queue 2): 6 submitted, 3 accepted, 3 refused `SCENE_QUEUE_FULL` immediately.

**Optimization decisions, from these measurements:**
- **Per-object meshes are kept.** At most 203 draw calls is well within browser budgets, and per-object meshes keep picking identity. Batching is deferred.
- **Instancing is deferred.** It could share 174 of 203 meshes on the 24-room fixture (86%), but that GLB is only 475 KB. Instancing is the documented first optimization for larger buildings; the manifest/object contracts already allow it without identity changes.

## Frozen limits (`SCENE_LIMITS`)

| Limit | Value | Basis |
|---|---|---|
| objects | 2 048 | max measured 203 (10×) |
| triangles / vertices | 200 000 / 400 000 | max 4 272 / 8 544 (47×). A pre-tessellation cell bound refuses pathological inputs before allocation. |
| GLB bytes | 16 MiB | max 475 KB (35×); same as the SQL check |
| manifest bytes | 2 MiB | max 209 KB (10×) |
| navigation nodes | 512 | max 49 (10×) |
| extent | 800 000 mm | float32 bound 47.7 µm ≤ 50 µm validator tolerance |
| compile deadline | 20 s pool ceiling | max worker 0.49 s (40×) |

## Release history and pre-freeze findings (find → root cause → fix → test)

1. **Validator threw instead of reporting INVALID** on a forged binding (the `projectBim` exception escaped). It is now recorded as a failure, with a test.
2. **Validator ignored a transform on the root node.** The root may now carry only the origin translation, with a test.
3. **The normal check was too loose:** a 1-ulp normal change passed. Normals must now equal the exact axis unit vector.
4. **The precision contract was inconsistent:** the original 1 km extent allowed 60 µm of error against a 10 µm tolerance. Both now derive from one constant, with a test.
5. **Pooled and in-process manifest JSON differed in key order** (Zod output order). The compiler now emits through the schema; the Docker acceptance asserts the strings are equal.
6. **Mutation run 1 (pre-freeze) had two survivors:**
   - **M12 was an equivalent mutant**, because Phase 23 `bindingFor` already refuses forged hashes. The check is kept as defense in depth, and M12 is redefined as silent re-binding, which is killed.
   - **M30 had a weak test:** the coverage forgery was caught by the nondeterminism check instead. It is now tested on a fresh revision with a positive control.
   
   The log is in `evidence/preliminary/`.
7. **Test-only defects:** order-sensitive id comparison; a vacuous void-edit helper (unsnapped floats). Both were fixed so the tests assert the intended property.
8. **Operator note (after the release run):** my documentation generator's output path overwrote `docs/phase28/phase28-verification.md` in this worktree. I restored it byte-exactly from `HEAD` and verified that `git diff 7ca99df -- docs/phase28` is empty. The release gates had already completed and the file is outside the source manifest. The Phase 29 harness now refuses unknown arguments and existing evidence; the generator was retargeted.

## Decisions recorded

- **Storage:** Postgres `bytea` behind the `sceneRpc` adapter boundary. Every fixture is < 0.5 MB, and there is no object storage in the stack.
  - A future object-store adapter uses `PENDING → upload → verify SHA-256 → READY` with a TTL sweeper for orphaned PENDING uploads, under the same API contract.
- **Overlays:** structural, environmental, systems and knowledge overlays are `NOT_EVALUATED` in V1. The extension is explicit `analysisId` binding to the same revision, in separate `OVERLAY_*` layers. The latest analysis is never selected implicitly.
- **Optimization candidates:** not compiled. The future interface is an ephemeral, unpersisted `scene-preview` marked `CANDIDATE_PREVIEW_NOT_ACCEPTED` (design §14). There is no adoption path.
- **No server rendering:** no GPU, video, ray tracing or paid API. The PNG previews are offline verification evidence only.

## Known limitations and unsupported cases

- **Building profile:** > 2 storeys, columns, curved or diagonal walls, non-orthogonal footprints, more than one stair, or spiral/winder stairs are refused (`SCENE_UNSUPPORTED_MODEL`). There is no high-rise or supertall support.
- **Walls:** butt-ended prisms per the model convention; corner notches are closed by visual junction fills, which are not quantities. Wall/slab intersections are not boolean-unioned.
- **Stairs:** the underside is a mass fill (the soffit is not modeled). Landings have no modeled thickness and can be coplanar with floor slabs, so frontends may need a polygon offset.
- **Materials:** generic PBR placeholder colours; no textures, product, glazing, thermal or fire properties. `USER_PROVIDED_FINISH` has no V1 input.
- **Not in the scene:** site, terrain, dimensions and annotations (`NOT_EVALUATED`); engineering overlays.
- **Storage:** bytes are kept in Postgres and served via base64 RPC (bounded at 16 MiB). There is no streaming or object storage yet.
- **Navigation:** room-to-room circulation hints only; no collision-free path planning.
