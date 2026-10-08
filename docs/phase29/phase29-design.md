# Phase 29 design — advanced 3D architecture & scalable scene engine V1

Status: **implemented and released** — see [phase29-report.md](phase29-report.md) (PHASE 29 FULLY IMPLEMENTED AND VERIFIED WITHIN BOUNDED SCOPE). Decisions taken from the [source audit](phase29-source-audit.md); limits fixed from measured benchmarks (report §Frozen limits).

## 1. Scope

- A **deterministic scene compiler**: an accepted revision's Building Model V2 → a semantic scene manifest (`scene-manifest-v1`) plus a glTF 2.0 GLB.
- An **independent validator** that measures the GLB against the source model.
- Immutable, owner-only, revision-bound **artifacts**, with a bounded worker execution path and an API for Three.js-class viewers.

**Supported input** = the Phase 23 bounded architectural profile, enforced by reusing `bim/core.ts sourceModel()`:
- ≤ 2 storeys, ≤ 28 spaces, ≤ 200 walls/openings, ≤ 32 slabs/voids, ≤ 1 straight stair, no columns;
- orthogonal geometry;
- Blueprint QA with no errors.

Anything else is a typed 422 `SCENE_UNSUPPORTED_MODEL`.

- **Scalable** means the contracts are additive: per-level nodes, a layer taxonomy, per-object identity, per-level bounds and LOD/instancing slots. It does **not** mean larger buildings are accepted.
- The compiler is **not** a renderer or generative model. No server GPU, video, ray tracing or paid API.

## 2. Pipeline

```
accepted revision ──► precheck (main thread: ownership, QA acceptance, binding hashes)
   └► worker: sourceModel (profile + QA) ─► projectBim (bimElementIds) ─► compile objects/meshes
              ─► hierarchy/materials/rooms/navigation/cameras ─► manifest ─► GLB ─► sha256
              ─► INDEPENDENT validate(model, binding, manifest, glb) ─► {manifest, glb, validation}
   └► main thread: schema + sha256 re-check ─► signed scene_write (SQL re-verifies binding, hashes, bytes) ─► READY artifact
```

A worker crash, timeout or validation failure yields a typed error and **nothing is stored**.

## 3. Coordinates, units, precision

- **Manifest:** canonical model frame (`x-right-y-up-z-depth`), **integer millimetres**.
  - Scene bounds are rounded outward to integer mm.
  - Odd wall thicknesses put faces on the 0.5 mm grid. They are exact in the GLB, conservative in manifest bounds.
- **GLB:** metres. The mapping is `gltf = model / 1000`: identity axes, no swap, no mirroring.
  - Both frames are right-handed Y-up; the Phase 23 IFC mapping `(x,−z,y)` confirms model handedness.
  - The root node translation = `origin / 1000`, with `origin = (minX, 0, minZ)` of the scene bounds in integer mm. Translation is a JSON double, exact for integer-mm/1000 decimals.
  - Mesh positions are float32 **relative to the origin**.
- **Precision contract:**
  - Every authoritative vertex lies on the 0.5 mm grid.
  - Local extent ≤ `SCENE_LIMITS.extentMm`, so the float32 half-ulp ≤ extent·2⁻²⁴.
  - The manifest records `precision.maxLocalExtentMm` and `precision.maxFloat32ErrorNm` (computed, integer nanometres).
  - The validator decodes every position, maps it back to model mm and requires it to round to the 0.5 mm grid within 0.01 mm. Measurements then use the rounded exact values.
  - So float32 is never assumed exact; exactness is **re-established and checked**.

## 4. Geometry (all coordinates on the 0.5 mm grid)

| Entity | Construction | Fidelity |
|---|---|---|
| Wall | Butt-ended prism, symmetric about the directed centerline (model convention, same as IFC). Local frame: `u` along the path, `v` up, `w` across. The rectangle `[0,L]×[b,b+h]` is split on a grid of `u`/`v` breakpoints (wall ends, opening jambs, sills, heads). Each cell is solid or aperture. Front/back faces cover solid cells; reveal faces are emitted where solid meets aperture or the outside. The result is a closed solid with **real apertures**. | FULL_GEOMETRY |
| Opening (door / window / generic) | The aperture is the hole above: exact offset, width, sill, height. | FULL_GEOMETRY |
| Door leaf / window pane | A separate object filling the aperture: door 40 mm and window 10 mm, centered on the wall centerline, hideable layers DOORS/WINDOWS. No product, glazing, thermal or fire property. | VISUAL_PLACEHOLDER |
| Wall junction fill | At a node where ≥ 2 non-collinear walls *end* with equal base/height, a box `max t/2` per axis fills the butt-end corner notch the model's deferred-junction convention leaves. It is skipped, and recorded, if it would intrude into any aperture. It is not part of any quantity. | VISUAL_PLACEHOLDER |
| Floor / flat-roof / ceiling slab | Orthogonal footprint grid (outer + voids). Inside cells give top/bottom faces; side faces lie on inside/outside cell boundaries. Top at `level + topOffset`, extending `thickness` downward. **Voids are holes**, so stair openings stay open. Exposed lower roofs are their own `flat-roof` slabs in the source and compile as such. | FULL_GEOMETRY |
| Stair flight | Closed stepped solid: tread `k` covers run `[k·d,(k+1)·d]` at height `Σ r₀..r_k` for k = 0..n−2, exact per-riser heights. The final riser `n−1` (at the run end, rising onto the destination) is a separate exact quad primitive. The underside is a mass fill to the source level, because the soffit/waist is not modeled. | Treads/risers FULL_GEOMETRY; underside VISUAL_PLACEHOLDER |
| Landing | An upward walking-surface quad at `from-level + elevationOffset`. No thickness is modeled. | FULL_GEOMETRY (surface) |
| Space | A hidden helper prism of the centerline boundary from the level to the room height (lowest wall top on the level). Used for selection/highlight. | SEMANTIC_ONLY |
| Level | A group node with level metadata. | SEMANTIC_ONLY |
| Column | Refused by the profile gate. | UNSUPPORTED |
| Site, dimensions | Not in the V1 scene. | NOT_EVALUATED |

- **Winding and normals:** counter-clockwise front faces, outward flat normals, duplicated vertices per face.
- **Orthogonal faces only:** faces are emitted as axis-aligned quads, so a triangle is never degenerate.
- **Coverage:** every source entity appears in `coverage[]` with its status, reason and scene object ids. Nothing is silently omitted.

## 5. Scene graph, identity, layers, materials

- **Hierarchy:** `root` → level nodes (by index) → layer nodes (fixed order) → object nodes. Depth 4.
  - One mesh per object: per-object selection identity. Its primitives are grouped per material.
  - Materials are shared.
- **`sceneObjectId = <role>:<sourceEntityId>`**: deterministic and readable, never invented.
  - Node `extras`: `{sceneObjectId, sourceEntityType, sourceEntityId, bimElementId, levelId, layer, geometryRole, fidelity}`.
  - `bimElementId` comes from `projectBim` (Phase 23).
- **Layers:** `EXTERIOR_SHELL`, `INTERIOR_WALLS`, `FLOORS`, `CEILINGS`, `ROOFS`, `STAIRS`, `DOORS`, `WINDOWS`, `ROOM_VOLUMES` (hidden by default), `SEMANTIC_HELPERS`.
- **Materials:** 9 fixed PBR metallic-roughness materials, with no textures and no external assets: exterior wall, interior wall, slab, roof, stair, landing, door placeholder, glass placeholder (alpha BLEND), room volume (alpha BLEND).
  - Every appearance is `VISUAL_PLACEHOLDER`.
  - A source `specificationId` is reported as `ARCHITECTURAL_FACT`: the specification's id, name and material *label* only, never performance.
  - `USER_PROVIDED_FINISH` is reserved: there is no V1 input.

## 6. Rooms, navigation, cameras (manifest, integer mm)

- **Rooms:** boundary, level, floor elevation, height, deterministic **interior point** (centre of the largest cell of the room's orthogonal grid, guaranteed inside), area, hosted openings and connected spaces.
- **Navigation:**
  - Nodes: rooms (interior point), openings (aperture centre on the centerline) and stair ends.
  - Edges: **copied from Blueprint QA's validated circulation graph** (door/passage/stair). Connectivity is never inferred from proximity.
  - Claims: egress, accessibility and collision-free paths are `NOT_CLAIMED`.
- **Cameras** (integer arithmetic on the bounds): `overview`, `three-quarter`, `top-down`, `exterior-orbit` (target + radius), `interior-roof-hidden`, one `floor:<levelId>` per level, one `room:<spaceId>` per room.
  - Each has position, target, up, vertical FOV, visible levels and hidden layers.
  - Optional path metadata (`interpolation: 'linear'`, `durationMs`) is a hint only; there is no animation-library coupling.

## 7. GLB contract

- **Structure:** glTF 2.0 core, no extensions.
  - One buffer (the BIN chunk); per primitive, `POSITION`/`NORMAL` float32 VEC3 and `UNSIGNED_SHORT`/`UNSIGNED_INT` indices.
  - Accessor `min`/`max` present; 4-byte aligned views; GLB 12-byte header plus JSON (space-padded) and BIN (zero-padded) chunks.
- **Asset metadata:** `asset.generator = "nekoarch-scene-compiler/scene-compiler-v1"`. `asset.extras` carries `{compilerVersion, sceneHash-free source binding}`; the manifest is the authority.
- **Determinism:** no timestamps, randomness or map/filesystem order. All arrays are built from sorted source ids; JSON key order is fixed by construction.

## 8. Identity and staleness

- `inputHash = costHash({compilerVersion, manifestVersion, source})`, where `source` = the binding `{projectId, revisionId, modelHash, generatorVersion, parameterHash}`.
- `sceneHash = costHash(manifest − binary)`. `binary.sha256 = SHA-256(GLB)`.
- Manifests contain only strings, safe integers and booleans, so SQL `cost_hash` recomputes them byte-identically.
- Same revision and compiler version → same input → byte-identical manifest and GLB. The SQL write converges on one immutable row and rejects any differing hash for the same input.
- Artifacts never change. One bound to a superseded revision reads as `STALE`; `require=current` → 409 `SCENE_ARTIFACT_STALE`.

## 9. Independent validator (`scene3d/validate.ts`)

The validator never imports compiler modules (gate plus mutation). It parses the GLB with its own reader and derives expectations from the source with its own arithmetic:

1. **GLB structure:**
   - magic/version/length, chunk types/alignment, JSON size bound;
   - buffer views in range; accessor type/component/alignment/count; `min`/`max` equal decoded data;
   - indices in range; finite positions; unit normals; node graph acyclic with depth ≤ 6.
2. **Hashes:** `sha256(glb)` = `manifest.binary.sha256`; `sceneHash` and `inputHash` recompute.
3. **Binding:** `modelHash(model)`, `parameterHash`, revision and project equal the manifest source.
4. **Coverage:** every wall, opening, slab, stair, landing, space and level has its coverage entry and objects; every object has exactly one GLB node with matching extras; no extra nodes.
5. **Per-object geometry, from decoded, grid-rounded vertices:**
   - **Closure:** Σ triangle area vectors = 0; divergence-theorem volume independent of origin.
   - **Winding:** volume > 0 for solids; stored normals agree with geometric normals.
   - **No degenerate triangles.**
   - **Walls:**
     - bbox = centerline ± t/2 × [base, top];
     - volume = t·(L·h − Σ aperture areas);
     - +w face area = −w face area = L·h − Σ apertures.
   - **Openings:**
     - rays across the wall at the aperture centre and just inside every edge (±1 mm) do **not** hit the host wall;
     - rays just outside each edge (when inside the wall and not another aperture) **do** hit it.
     
     This fixes width, offset, sill and height to the source.
   - **Slabs:**
     - bbox; volume = t·(area(outer) − Σ area(voids));
     - top at level + offset;
     - vertical rays at void interior points miss the slab; at solid cell centres they hit it.
   - **Stairs:** bbox = footprint × [base, base + Σ r₀..r_{n−2}]; volume = w·d·Σ_{k≤n−2} Σ r₀..r_k; final-riser quad exact.
   - **Landings:** area and elevation.
   - **Placeholders:** inside their aperture.
   - **Junction fills:** exact box, intersecting no aperture.
   - **Room helpers:** footprint area × height.
6. **Manifest:**
   - statistics equal the GLB;
   - layers and levels are consistent;
   - room interior points lie inside their polygons;
   - navigation edges equal the QA graph and reference existing nodes;
   - camera targets lie in bounds and room camera targets in their room.

Output: `{validatorVersion, status: VALID | INVALID, checks, failures[]}`. Only VALID is persisted (worker, service and SQL all require it).

## 10. Resource limits (fixed after measurement)

- **Gates before tessellation:** the source profile gate, then a pre-tessellation estimate of triangles (wall/slab grid cell counts). Refusal: 422 `SCENE_RESOURCE_LIMIT`.
- **Bounded quantities:** objects, nodes, triangles, vertices, GLB bytes, manifest bytes, navigation nodes, extent.
- **Execution:** worker heap cap, compile deadline, queue size.
- Values are in [phase29-report.md](phase29-report.md) with their benchmark basis.

## 11. Persistence (migration 0019) and storage

- **`project_revision_scene_artifacts`:**
  - immutable, owner-read RLS;
  - id, revision, acceptance QA, versions, `model_hash`, `input_hash`, `scene_hash`, `binary_sha256`, `binary_bytes`, `storage_locator`, `status = 'READY'`, validation report, manifest jsonb, created_at;
  - unique `(revision, input_hash)`; checks tie columns to the manifest; fixed claims.
- **`project_revision_scene_blobs`** `(artifact_id pk/fk, glb bytea)`: RLS on, **no policy and no grant**, so it is reachable only through `scene_read`. There is never a raw/public URL.
- **`scene_write`**, a signed SECURITY DEFINER function, checks:
  - HMAC envelope, ownership, QA acceptance;
  - **SQL-side** binding recompute (`canonical_building` model hash, generator version, parameter hash);
  - `inputHash`/`sceneHash` recompute;
  - `sha256(decode(glb))` = manifest hash, byte length, `glTF` magic, size limit;
  - coverage counts against `model_json`; validation status VALID;
  - idempotency; advisory-lock convergence; nondeterminism rejection.
  
  The row and the bytes are inserted in **one transaction**, so READY implies verified bytes. There is no partial row and nothing to clean up after an interrupted write.
- **Storage adapter:** the `Repository.sceneRpc` boundary (Supabase and pg-backend implementations). `storage_locator` names the backend (`postgres-bytea`). A future object-store adapter would use a two-phase `PENDING → upload → verify hash → READY` protocol with a TTL sweeper for orphaned PENDING uploads, behind the same API.

## 12. API (`/api/projects/:projectId/revisions/:revisionId/scene`)

| Route | Behaviour |
|---|---|
| `POST /validate` | Precheck only: no compile, no persistence |
| `POST /artifacts` | Compute quota; `Idempotency-Key`. Bounded worker compile + validation → signed write → 201 summary + manifest |
| `GET /artifacts` | Pagination |
| `GET /artifacts/:id` | Summary + currency |
| `GET /artifacts/:id/manifest` | Manifest |
| `GET /artifacts/:id/glb` | `model/gltf-binary`; `Cache-Control: private, no-store`; `ETag` = SHA-256; fixed filename; bytes re-hashed before sending |
| `GET /status` | Status |

- GET routes **never compile**.
- `?require=current` → 409 when stale.
- 401 anonymous; 404 foreign or unknown.
- 503 `SCENE_QUEUE_FULL` / `_WORKER_TIMEOUT` / `_WORKER_FAILED` / `_UNAVAILABLE`, with `Retry-After`.

## 13. Overlays (V1: NOT_EVALUATED)

- Structural, environmental, systems and knowledge overlays are listed as `NOT_EVALUATED` (`OVERLAY_NOT_IN_SCENE_V1`).
- **Extension:** `POST /artifacts {overlays: [{kind, analysisId}]}`. Each analysis is read by explicit id, bound to the same revision, emitted in a separate `OVERLAY_*` layer and never merged into architecture. The latest analysis is never picked implicitly.

## 14. Optimization candidates

- Only accepted revisions compile.
- **Future interface:** `POST …/optimization/studies/:studyId/candidates/:candidateId/scene-preview` would regenerate the candidate model in the worker and return an **ephemeral, unpersisted** manifest + GLB marked `CANDIDATE_PREVIEW_NOT_ACCEPTED`. It is not implemented in V1, so there is no hidden adoption path.

## 15. Security

- **Access:** owner-scoped RPCs (P1201/P1205); the blob table is unreachable except through `scene_read`.
- **Integrity:** signed writes; SQL recompute of binding and hashes, so a forged model or artifact hash is rejected.
- **Bounded parsing:** body limit and strict schema; GLB parser bounds (JSON ≤ 4 MiB, accessors/nodes counted, depth ≤ 6).
- **Response safety:** fixed response filenames (uuid only, so no path from user input); private no-store caching.
- **Isolation:** worker heap cap and timeout.

## 16. Mutation campaign (≥ 24 planted defects + negative controls)

The design §38 list is mapped 1:1 in `docs/phase29/mutation-test.py`: compiler geometry, serialization, validator, pool, service, SQL write/read/RLS and staleness. Each is killed by its named intended test, and every file is restored by SHA-256.
