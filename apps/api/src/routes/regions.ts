import type { FastifyInstance } from 'fastify';
import { RegionsResponseSchema } from '@designflow/shared';
import type { Backend } from '../lib/repository.js';
import { requestContext } from '../lib/auth.js';
import { getRegions } from '../services/rate-service.js';
export function regionsRoutes(app: FastifyInstance, backend: Backend) {
  app.get('/api/regions', async request => {
    const { repository } = await requestContext(request, backend, false);
    return RegionsResponseSchema.parse(await getRegions(repository));
  });
}
