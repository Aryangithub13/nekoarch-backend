# B45 slice S1: scene delivery manifest and API compatibility package

**Status:** implemented and locally verified as a **vertical slice**. **B45 is not complete** (§4).

**Branch:** `phases-40-46`. Plan of record: [b40-b46-implementation-plan.md](../roadmap/b40-b46-implementation-plan.md).

## 1. Roadmap traceability (ROADMAP L394–407)

| Requirement | S1 delivers |
|---|---|
| Versioned scene/chunk manifests: coordinate frames, level/room/element IDs, semantic pick anchors, materials, sections/layers, camera waypoints, checksums (L398) | `GET …/revisions/:revisionId/scene/delivery` (`scene-delivery-v1`), derived from the newest (or named) stored Phase 29 scene artifact. It contains:<br>• the frame and units;<br>• one chunk per level (GLB node name, bounds, measured objects, triangles, vertices, and layer counts);<br>• a pick anchor per scene object (scene object → source element → BIM element, level, layer, bounds);<br>• navigation and camera-preset counts;<br>• the GLB sha256 and bytes. |
| Byte/triangle/texture budgets, cache keys/ETags, invalidation on revision change (L399) | Four budgets (objects, triangles, vertices, GLB bytes), each measured against the enforced `SCENE_LIMITS` in thousandths. A strong ETag over the whole document, with `If-None-Match` → 304 and `Cache-Control: private, no-cache`. A new revision turns `revisionCurrency` to `HISTORICAL` and changes the ETag (tested). An artifact compiled from another model hash is refused (`409 SCENE_SOURCE_MISMATCH`). |
| `model`, `rendered_image`, `panorama_360`, `interactive_scene`, `walkthrough`, `video` as distinct capabilities (L401) | `media`: model and interactive scene are `AVAILABLE`; walkthrough is `PARTIAL` (QA circulation graph and camera presets, with no authored path); render, panorama and video are `UNSUPPORTED` (`NO_RENDER_PROVIDER`). |
| Source-verified OpenAPI/schema/client-adapter compatibility package: contract drift tests, typed errors, paged resources, mock-to-live plan (L402) | `GET /api/compatibility`: the sha256 of the sorted live route catalog (collected by an `onRoute` hook), every advertised service version, the API conventions (errors, pagination, idempotency, concurrency, units, identity), media status and `mockSubstitution: FORBIDDEN_AS_LIVE_EVIDENCE`. The test proves the live hash equals the hash of the committed `api-routes.json`. |
| Desktop QA on laptops/workstations; no mobile (L403) | `clientPerformance: NOT_MEASURED`, because frame rate, GPU memory and context loss are frontend measurements. `supportedClients.mobile: OUT_OF_SCOPE`. |
| **Gate:** a live viewer selects a wall/floor/room via stable IDs; bounded, measured loading on desktop tiers; no mock substitution (L407) | **Backend half:** stable anchors and measured budgets are served from real stored artifacts. **The viewer half and the desktop-tier measurements are not performed here.** |

## 2. What is deliberately not done

Chunks are **addressable GLB nodes, not separate files**: the GLB is delivered whole. Specifically:
- `rangeRequests: NOT_SUPPORTED`;
- `compression: NONE`;
- `instancing: NONE`;
- `levelsOfDetail: 1`.

These are stated in the manifest rather than implied. Splitting the GLB per level would change the Phase 29 compiler and its validator.

## 3. API and verification

| Route | Access | Result |
|---|---|---|
| `GET /api/projects/:projectId/revisions/:revisionId/scene/delivery[?artifactId]` | Owner (404 for others) | 200 `DeliveryManifest` with an ETag, or 304. 409 `SCENE_NOT_COMPILED` when no artifact exists |
| `GET /api/compatibility` | Any signed-in user (401 anonymous) | `Compatibility` |

Discovery lists `SCENE_DELIVERY`.

`delivery.integration.test.ts`, 2/2 on PostgreSQL:
- the not-compiled refusal;
- chunks partitioning the scene exactly, with sums equal to the artifact statistics;
- anchors, budgets and media;
- ETag and 304;
- owner-only access;
- currency after a new revision;
- the catalog hash equal to the committed catalog.

## 4. Outstanding B45 work

- Per-level GLB files, range or progressive delivery, glTF compression, instancing and LOD.
- Texture budgets (the scene has no textures).
- Signed transport URLs for GLBs (they are served by authenticated routes).
- Peak-memory instrumentation.
- A generated client adapter and staging fixtures.
- Desktop GPU-tier QA, done in the frontend.
- The live viewer gate.
