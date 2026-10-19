import { createHash } from 'node:crypto';
import { SCENE_LIMITS, type SceneManifest } from '../scene3d/contracts.js';
import { DELIVERY_VERSION, DeliveryManifestSchema, MEDIA_CAPABILITIES, type DeliveryManifest } from './contracts.js';

/** Media capabilities as this backend actually provides them (the discovery MEDIA list, in the roadmap's vocabulary). */
export const MEDIA_STATUS: Readonly<Record<typeof MEDIA_CAPABILITIES[number], { status: 'AVAILABLE' | 'PARTIAL' | 'UNSUPPORTED'; detail: string }>> = {
  model: { status: 'AVAILABLE', detail: 'Building Model V2 JSON and IFC export of every accepted revision' },
  interactive_scene: { status: 'AVAILABLE', detail: 'Deterministic GLB with a scene manifest bound to source and BIM ids' },
  walkthrough: { status: 'PARTIAL', detail: 'QA circulation graph and camera presets with linear transitions; no authored camera path or collision-free route' },
  rendered_image: { status: 'UNSUPPORTED', detail: 'NO_RENDER_PROVIDER' },
  panorama_360: { status: 'UNSUPPORTED', detail: 'NO_RENDER_PROVIDER' },
  video: { status: 'UNSUPPORTED', detail: 'NO_RENDER_PROVIDER' },
};
const thousandths = (measured: number, limit: number) => Math.floor(measured * 1000 / limit);

/**
 * Pure: the delivery manifest of one validated scene artifact. Every count comes from the artifact's manifest (objects, triangles, vertices, GLB bytes
 * and sha256); the ETag hashes the whole delivery document, so any change of artifact, revision currency or contract changes it.
 */
export function buildDelivery(input: { projectId: string; revisionId: string; modelHash: string; current: boolean; artifactId: string; manifest: SceneManifest }): DeliveryManifest {
  const m = input.manifest, base = `/api/projects/${input.projectId}/revisions/${input.revisionId}/scene/artifacts/${input.artifactId}`;
  const chunks = m.levels.map(l => {
    const objects = m.objects.filter(o => o.levelId === l.levelId), layers: Record<string, number> = {};
    for (const o of objects) layers[o.layer] = (layers[o.layer] ?? 0) + 1;
    return { chunkId: `level:${l.levelId}`, levelId: l.levelId, name: l.name, index: l.index, elevationMm: l.elevationMm, nodeName: l.nodeName, bounds: l.bounds,
      objects: objects.length, triangles: objects.reduce((s, o) => s + o.triangles, 0), vertices: objects.reduce((s, o) => s + o.vertices, 0), layers };
  });
  const body = {
    deliveryVersion: DELIVERY_VERSION, projectId: input.projectId, revisionId: input.revisionId, modelHash: input.modelHash,
    revisionCurrency: input.current ? 'CURRENT' as const : 'HISTORICAL' as const,
    artifact: { artifactId: input.artifactId, compilerVersion: m.compilerVersion, inputHash: m.inputHash,
      glb: { route: `${base}/glb`, mimeType: 'model/gltf-binary' as const, bytes: m.binary.bytes, sha256: m.binary.sha256, rangeRequests: 'NOT_SUPPORTED' as const,
        compression: 'NONE' as const, instancing: 'NONE' as const, levelsOfDetail: 1 as const }, manifestRoute: `${base}/manifest` },
    frame: { coordinateSystem: m.frame.coordinateSystem, manifestUnits: 'mm' as const, glbUnits: 'm' as const, originMm: m.frame.originMm },
    bounds: m.bounds, chunks,
    pickAnchors: m.objects.map(o => ({ sceneObjectId: o.sceneObjectId, sourceEntityType: o.sourceEntityType, sourceEntityId: o.sourceEntityId, bimElementId: o.bimElementId,
      levelId: o.levelId, layer: o.layer, bounds: o.bounds })),
    navigation: { source: m.navigation.source, nodes: m.navigation.nodes.length, edges: m.navigation.edges.length, cameraPresets: m.cameras.length, collisionFreePath: 'NOT_CLAIMED' as const },
    budgets: [
      { budgetId: 'OBJECTS' as const, limit: SCENE_LIMITS.objects, measured: m.statistics.objects, usedThousandths: thousandths(m.statistics.objects, SCENE_LIMITS.objects) },
      { budgetId: 'TRIANGLES' as const, limit: SCENE_LIMITS.triangles, measured: m.statistics.triangles, usedThousandths: thousandths(m.statistics.triangles, SCENE_LIMITS.triangles) },
      { budgetId: 'VERTICES' as const, limit: SCENE_LIMITS.vertices, measured: m.statistics.vertices, usedThousandths: thousandths(m.statistics.vertices, SCENE_LIMITS.vertices) },
      { budgetId: 'GLB_BYTES' as const, limit: SCENE_LIMITS.glbBytes, measured: m.binary.bytes, usedThousandths: thousandths(m.binary.bytes, SCENE_LIMITS.glbBytes) }],
    media: MEDIA_CAPABILITIES.map(capability => ({ capability, ...MEDIA_STATUS[capability] })),
    nonWebGlFallback: { available: true as const, basis: 'Plan sheets and schedules (construction documents) and the room list with boundaries in the scene manifest' },
    clientPerformance: { status: 'NOT_MEASURED' as const, reason: 'Frame rate, GPU memory and context-loss recovery on desktop tiers are frontend measurements; none is claimed here' },
  };
  const etag = `"${createHash('sha256').update(JSON.stringify(body)).digest('hex')}"`;
  return DeliveryManifestSchema.parse({ ...body, cache: { etag, cacheKey: `${input.artifactId}:${m.binary.sha256}`, immutableArtifact: true, invalidatedBy: 'NEW_REVISION_OR_ARTIFACT' } });
}
