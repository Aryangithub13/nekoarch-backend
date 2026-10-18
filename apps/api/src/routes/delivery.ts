import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { COMPATIBILITY_ROUTE, DELIVERY_ROUTE, DeliveryParamsSchema, DeliveryQuerySchema } from '../delivery/contracts.js';
import { compatibility, deliveryManifest } from '../services/delivery-service.js';

/** Collects "METHOD /path" for every route registered after it in this scope (HEAD is implied by GET and left out). */
export function routeCatalog(app: FastifyInstance) {
  const routes: string[] = [];
  app.addHook('onRoute', r => { for (const m of [r.method].flat()) if (m !== 'HEAD') routes.push(`${m} ${r.url}`); });
  return routes;
}

/**
 * B45 S1: the scene delivery manifest (owner-only; strong ETag, 304 on If-None-Match; revalidated on every use because revision currency can change)
 * and the compatibility package (any signed-in user).
 */
export function deliveryRoutes(app: FastifyInstance, backend: Backend, routes: readonly string[]) {
  app.get(DELIVERY_ROUTE, async (request, reply) => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(DeliveryParamsSchema, request.params);
    const { artifactId } = parseRequest(DeliveryQuerySchema, request.query);
    const manifest = await deliveryManifest(repository, projectId, revisionId, artifactId);
    reply.header('ETag', manifest.cache.etag).header('Cache-Control', 'private, no-cache');
    const match = String(request.headers['if-none-match'] ?? '').split(',').map(t => t.trim().replace(/^W\//, ''));
    return match.includes(manifest.cache.etag) ? reply.code(304).send() : reply.send(manifest);
  });
  app.get(COMPATIBILITY_ROUTE, async request => {
    await requestContext(request, backend, true);
    parseRequest(z.object({}).strict(), request.query);
    return compatibility(routes);
  });
}
