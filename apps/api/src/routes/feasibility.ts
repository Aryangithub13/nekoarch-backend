import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { FEASIBILITY_ROUTE, FeasibilityAssessmentSchema, FeasibilityParamsSchema, FeasibilityRequestSchema } from '../feasibility/contracts.js';
import { assessProjectFeasibility } from '../services/feasibility-service.js';

/** B42 S1: constraint-by-constraint feasibility of a design ambition against the engines' enforced limits, with alternatives for consent. Stores nothing. */
export function feasibilityRoutes(app: FastifyInstance, backend: Backend) {
  app.post(FEASIBILITY_ROUTE, { bodyLimit: 8192 }, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(FeasibilityParamsSchema, request.params);
    const body = parseRequest(FeasibilityRequestSchema, request.body ?? {});
    return FeasibilityAssessmentSchema.parse(await assessProjectFeasibility(repository, projectId, body));
  });
}
