import { createHash } from 'node:crypto';
import type { Repository } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { COMPATIBILITY_VERSION, CompatibilitySchema, MEDIA_CAPABILITIES, type DeliveryManifest } from '../delivery/contracts.js';
import { OPENAPI_SHA256 } from '../delivery/openapi-hash.js';
import { MEDIA_STATUS, buildDelivery } from '../delivery/build.js';
import { listSceneArtifacts, readSceneArtifact } from './scene-service.js';
import { readRevisionModel } from './verification-service.js';
import { SERVICES } from './overview-service.js';

/**
 * B45 S1: the delivery manifest of a revision's newest (or named) scene artifact. The artifact must be bound to this revision's current model hash;
 * one compiled from different source is refused, never delivered. Read only: nothing is compiled here (POST .../scene/artifacts compiles).
 */
export async function deliveryManifest(repository: Repository, projectId: string, revisionId: string, artifactId?: string): Promise<DeliveryManifest> {
  const revision = await readRevisionModel(repository, projectId, revisionId);
  const id = artifactId ?? (await listSceneArtifacts(repository, projectId, revisionId, { limit: 1 })).items[0]?.id;
  if (!id) throw new ApiError(409, 'SCENE_NOT_COMPILED', 'No scene artifact exists for this revision; compile one with POST .../scene/artifacts');
  const detail = await readSceneArtifact(repository, projectId, revisionId, id, false);
  if (detail.manifest.source.modelHash !== revision.hash) throw new ApiError(409, 'SCENE_SOURCE_MISMATCH', 'The scene artifact was compiled from a different model');
  return buildDelivery({ projectId, revisionId, modelHash: revision.hash, current: detail.currency.status === 'CURRENT', artifactId: id, manifest: detail.manifest });
}

/** The compatibility package: the route catalog and OpenAPI hashes (drift detection), every advertised service version and the API conventions. */
export function compatibility(routes: readonly string[]) {
  const sorted = [...new Set(routes)].sort();
  return CompatibilitySchema.parse({ compatibilityVersion: COMPATIBILITY_VERSION,
    routeCatalog: { routes: sorted.length, sha256: createHash('sha256').update(sorted.join('\n')).digest('hex') }, openapi: { sha256: OPENAPI_SHA256 },
    services: SERVICES.map(s => ({ serviceId: s.serviceId, version: s.version, route: s.route })),
    conventions: { errors: 'ApiErrorResponse { error: { code, message, requestId, fieldErrors? } } with stable codes',
      // INT-B-013 / INT-B-014: say what the routes actually do; the per-route detail is in the API documents.
      pagination: 'Keyset: mostly limit and an opaque cursor, nextCursor null at the end; BIM lists and job events use after/nextAfter; conversations use a UUID cursor',
      idempotency: 'Idempotency-Key replays the stored response on writes that keep receipts (listed in the API documents); other writes ignore it',
      concurrency: 'Expected base revision, plan or model hashes; a stale precondition is 409',
      units: 'Integer millimetres in models and manifests; GLB in metres', identity: 'Stable element ids shared by the model, BIM, scene, comments and change sets' },
    media: MEDIA_CAPABILITIES.map(capability => ({ capability, status: MEDIA_STATUS[capability].status })),
    mockSubstitution: 'FORBIDDEN_AS_LIVE_EVIDENCE', supportedClients: { desktop: 'SUPPORTED', mobile: 'OUT_OF_SCOPE' } });
}
