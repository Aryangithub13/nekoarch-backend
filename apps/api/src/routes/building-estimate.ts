import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { ProjectRevisionDetailSchema, RevisionParamsSchema } from '../contracts/projects.js';
import { estimateBuilding } from '../estimate/building-estimate.js';
import { BuildingEstimateQuerySchema as QuerySchema, BuildingEstimateResponseSchema } from '../contracts/building-estimate.js';

export const BUILDING_ESTIMATE_OPERATION = '/api/projects/:projectId/revisions/:revisionId/engineering-estimate';

/** Concept engineering and cost estimate for a stored revision, computed on request from its building model (read-only; nothing is persisted). */
export function buildingEstimateRoutes(app: FastifyInstance, backend: Backend) {
  app.get(BUILDING_ESTIMATE_OPERATION, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    const query = parseRequest(QuerySchema, request.query ?? {});
    const revision = ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision', projectId, revisionId));
    const program = revision.normalizedRequirements && 'program' in revision.normalizedRequirements ? revision.normalizedRequirements.program : null;
    const estimate = estimateBuilding(revision.model, {
      tier: query.tier ?? program?.qualityTier ?? 'standard', city: query.city ?? program?.city, buildingType: program?.buildingType ?? 'house',
      budgetInr: query.budgetInr ?? program?.budgetInr, ...(query.soilBearingKnM2 ? { soilBearingKnM2: query.soilBearingKnM2 } : {}),
    });
    return BuildingEstimateResponseSchema.parse({ projectId, revisionId, revisionNumber: revision.revisionNumber, generatorVersion: revision.generatorVersion, buildingType: program?.buildingType ?? null, estimate });
  });
}
