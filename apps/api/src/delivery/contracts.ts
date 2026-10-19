import { z } from 'zod';

/**
 * B45 S1 (ROADMAP L394–407): a desktop 3D delivery manifest derived on read from a stored, validated scene artifact (Phase 29), and a compatibility
 * package for client adapters. Every number is measured from the artifact (never estimated): per-level chunks, stable pick anchors bound to source
 * and BIM ids, budgets against the enforced scene limits, checksums and a strong ETag. Browser frame rate and GPU behaviour are frontend measurements.
 */
export const DELIVERY_VERSION = 'scene-delivery-v1';
export const COMPATIBILITY_VERSION = 'api-compatibility-v1';
export const DELIVERY_ROUTE = '/api/projects/:projectId/revisions/:revisionId/scene/delivery';
export const COMPATIBILITY_ROUTE = '/api/compatibility';
/** ROADMAP L401: distinct media capabilities, never conflated (a render is not an interactive scene). */
export const MEDIA_CAPABILITIES = ['model', 'rendered_image', 'panorama_360', 'interactive_scene', 'walkthrough', 'video'] as const;

const id = z.string().min(1).max(400), hash = z.string().regex(/^[a-f0-9]{64}$/), int = z.number().int();
const P3 = z.object({ x: int, y: int, z: int }).strict(), Bounds = z.object({ min: P3, max: P3 }).strict();
export const DeliveryParamsSchema = z.object({ projectId: z.string().uuid(), revisionId: z.string().uuid() }).strict();
export const DeliveryQuerySchema = z.object({ artifactId: z.string().uuid().optional() }).strict();

export const DeliveryManifestSchema = z.object({
  deliveryVersion: z.literal(DELIVERY_VERSION), projectId: z.string().uuid(), revisionId: z.string().uuid(), modelHash: hash,
  /** CURRENT while this revision is the project's current one; HISTORICAL afterwards (clients must refetch on revision change). */
  revisionCurrency: z.enum(['CURRENT', 'HISTORICAL']),
  artifact: z.object({ artifactId: z.string().uuid(), compilerVersion: z.string().max(80), inputHash: hash,
    glb: z.object({ route: z.string().max(300), mimeType: z.literal('model/gltf-binary'), bytes: int, sha256: hash, rangeRequests: z.literal('NOT_SUPPORTED'),
      compression: z.literal('NONE'), instancing: z.literal('NONE'), levelsOfDetail: z.literal(1) }).strict(),
    manifestRoute: z.string().max(300) }).strict(),
  frame: z.object({ coordinateSystem: z.string().max(40), manifestUnits: z.literal('mm'), glbUnits: z.literal('m'), originMm: P3 }).strict(),
  bounds: Bounds,
  /** One chunk per storey: the level's GLB node and its measured content. Delivery is the whole GLB; chunks are addressable nodes, not separate files. */
  chunks: z.array(z.object({ chunkId: z.string().max(420), levelId: id, name: z.string().max(200), index: int, elevationMm: int, nodeName: id, bounds: Bounds.nullable(),
    objects: int, triangles: int, vertices: int, layers: z.record(int) }).strict()).max(256),
  /** Stable semantic pick anchors: scene object → source element → BIM element, with level and bounds. */
  pickAnchors: z.array(z.object({ sceneObjectId: id, sourceEntityType: z.string().max(20), sourceEntityId: id, bimElementId: z.string().max(200).nullable(), levelId: id,
    layer: z.string().max(40), bounds: Bounds }).strict()).max(2048),
  navigation: z.object({ source: z.string().max(60), nodes: int, edges: int, cameraPresets: int, collisionFreePath: z.literal('NOT_CLAIMED') }).strict(),
  budgets: z.array(z.object({ budgetId: z.enum(['OBJECTS', 'TRIANGLES', 'VERTICES', 'GLB_BYTES']), limit: int, measured: int, usedThousandths: int }).strict()).length(4),
  cache: z.object({ etag: z.string().max(80), cacheKey: z.string().max(200), immutableArtifact: z.literal(true), invalidatedBy: z.literal('NEW_REVISION_OR_ARTIFACT') }).strict(),
  media: z.array(z.object({ capability: z.enum(MEDIA_CAPABILITIES), status: z.enum(['AVAILABLE', 'PARTIAL', 'UNSUPPORTED']), detail: z.string().max(300) }).strict())
    .length(MEDIA_CAPABILITIES.length),
  nonWebGlFallback: z.object({ available: z.literal(true), basis: z.string().max(300) }).strict(),
  clientPerformance: z.object({ status: z.literal('NOT_MEASURED'), reason: z.string().max(300) }).strict(),
}).strict();
export type DeliveryManifest = z.infer<typeof DeliveryManifestSchema>;

export const CompatibilitySchema = z.object({
  compatibilityVersion: z.literal(COMPATIBILITY_VERSION),
  /** sha256 over the sorted "METHOD /path" list of every registered API route: a client pins it and detects contract drift. */
  routeCatalog: z.object({ routes: int, sha256: hash }).strict(),
  /** sha256 of docs/modernization/openapi.json, which is generated from the Zod contracts: it changes when a request or response schema changes (INT-B-022). */
  openapi: z.object({ sha256: hash }).strict(),
  services: z.array(z.object({ serviceId: z.string().max(64), version: z.string().max(100), route: z.string().max(300) }).strict()).max(64),
  conventions: z.object({ errors: z.string().max(200), pagination: z.string().max(200), idempotency: z.string().max(200), concurrency: z.string().max(200),
    units: z.string().max(200), identity: z.string().max(200) }).strict(),
  media: z.array(z.object({ capability: z.enum(MEDIA_CAPABILITIES), status: z.enum(['AVAILABLE', 'PARTIAL', 'UNSUPPORTED']) }).strict()).length(MEDIA_CAPABILITIES.length),
  mockSubstitution: z.literal('FORBIDDEN_AS_LIVE_EVIDENCE'),
  supportedClients: z.object({ desktop: z.literal('SUPPORTED'), mobile: z.literal('OUT_OF_SCOPE') }).strict(),
}).strict();
