import type { FastifyInstance } from 'fastify';
import { EstimateInputsSchema, EstimateResponseSchema } from '@designflow/shared';
import type { Backend } from '../lib/repository.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { createEstimate } from '../services/estimate-service.js';
export function estimatesRoutes(app: FastifyInstance, backend: Backend) {
  app.post('/api/estimates', async request => {
    const inputs = parseRequest(EstimateInputsSchema, request.body);
    const { userId, repository } = await requestContext(request, backend, true);
    return EstimateResponseSchema.parse(await createEstimate(repository, userId!, inputs));
  });
}
