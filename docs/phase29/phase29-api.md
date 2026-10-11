# Phase 29 API — 3D scene artifacts

Root: `/api/projects/:projectId/revisions/:revisionId/scene`.

- **Auth:** every route needs a Supabase session and is owner-only. A foreign or unknown project, revision or artifact returns **404**.
- **GET routes never compile.**

A scene visualizes an **accepted revision** exactly as modeled. No route changes a revision, BIM, quantities or any analysis. Optimization candidates are not compiled. Design: [phase29-design.md](phase29-design.md).

## `POST /validate`
Body: `{}` (V1 has no options). It runs a main-thread precheck only: ownership, QA acceptance and the revision binding. There is no compilation and no persistence.

`200` → `{ readiness: 'READY', compilerVersion, manifestVersion, binding, inputHash, limits, supportedProfile }`. The bounded profile itself is enforced in the compile worker.

## `POST /artifacts` (compute quota; idempotent with `Idempotency-Key`)
1. The **bounded worker pool** compiles and then runs the **independent validator**.
2. The main thread re-checks the GLB SHA-256 and the binding.
3. The signed `scene_write` RPC re-verifies the following in SQL and inserts the row and its bytes in one transaction:
   - the binding (canonical model hash, generator version, parameter hash);
   - `inputHash` and `sceneHash`;
   - the bytes' SHA-256, length and `glTF` magic;
   - coverage counts and validation status.

`201` → summary `{ id, projectRevisionId, acceptanceQaId, manifestVersion, compilerVersion, validatorVersion, modelHash, inputHash, sceneHash, binarySha256, binaryBytes, storageLocator: 'postgres-bytea', status: 'READY', objectCount, triangleCount, createdAt }` plus `manifest`.

Replay with the same key and body returns the same artifact. Identical inputs converge on one immutable artifact per revision and compiler version. A different scene for the same input is rejected as nondeterministic.

## Reads
| Route | Response |
|---|---|
| `GET /artifacts?limit=1..100&cursor=…` | Summaries with `currency` (`CURRENT`/`STALE`); stable `(createdAt,id)` pagination |
| `GET /artifacts/:artifactId[?require=current]` | Summary + `currency` |
| `GET /artifacts/:artifactId/manifest[?require=current]` | `{ artifactId, sceneHash, currency, manifest }`; `Cache-Control: private, no-store`; `ETag` = scene hash |
| `GET /artifacts/:artifactId/glb[?require=current]` | GLB bytes (`model/gltf-binary`), see below |
| `GET /status` | `sceneStatus` (`COMPILED`/`NOT_COMPILED`), this revision's artifacts, `staleArtifacts` of other revisions (`BOUND_TO_A_DIFFERENT_REVISION`) |

The GLB download:
- **Headers:** `Cache-Control: private, no-store`; `ETag` = binary SHA-256; `Content-Disposition: attachment; filename="scene-<artifactId>.glb"` (uuid only); `X-Content-Type-Options: nosniff`.
- **Integrity:** the bytes are re-hashed in SQL and again in the service before they are sent.

`require=current` on a superseded revision returns `409 SCENE_ARTIFACT_STALE`. Artifacts are never updated in place.

## Errors
| Status | Code | When |
|---|---|---|
| 400 | `SCENE_INPUT_INVALID` / `VALIDATION_ERROR` | Non-empty body; bad uuid, cursor or query |
| 401 | `UNAUTHORIZED` | No session |
| 404 | `…_NOT_FOUND` / `SCENE_ARTIFACT_NOT_FOUND` | Not the owner's, or unknown |
| 409 | `IDEMPOTENCY_CONFLICT` / `SCENE_ARTIFACT_STALE` | Key reuse / `require=current` |
| 422 | `REVISION_NOT_ACCEPTED` | No accepted QA evidence |
| 422 | `SCENE_UNSUPPORTED_MODEL` | Outside the Phase 23 bounded profile (> 2 storeys, columns, non-orthogonal, …) |
| 422 | `SCENE_INVALID_SOURCE` / `SCENE_SOURCE_MISMATCH` | Source fails schema/QA, or the stored identity differs |
| 422 | `SCENE_RESOURCE_LIMIT` | Object/triangle/vertex/byte/extent/navigation budget |
| 422 | `SCENE_VALIDATION_FAILED` | The independent validator rejected the compiled scene |
| 422 | `SCENE_ARTIFACT_INVALID` | SQL provenance or hash re-verification failed (P2903) |
| 503 | `SCENE_QUEUE_FULL` / `_WORKER_TIMEOUT` / `_WORKER_FAILED` / `_UNAVAILABLE` | Capacity, 20 s ceiling, crash or malformed/unvalidated output, shutdown. Carries `Retry-After: 30`. **Never stores an artifact.** |

## Frontend use
- **Loading:** load the GLB with any glTF 2.0 loader (Three.js `GLTFLoader`, Babylon.js, …). No extensions are required.
- **Units:** the GLB is in metres with the model axes (identity mapping). The root node translation is the model origin, so drop it for a locally centred scene.
- **Picking:** every object node's `extras` carries `sceneObjectId`, `sourceEntityType`/`sourceEntityId`, `bimElementId`, `layer`, `levelId`, `geometryRole` and `fidelity`. Picking maps straight back to the building model and BIM element.
- **Visibility:** toggle `layer:*` and `level:*` nodes. Cameras, rooms and navigation come from the manifest, in integer millimetres.
