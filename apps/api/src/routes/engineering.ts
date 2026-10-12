import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { RevisionParamsSchema } from '../contracts/projects.js';
import { ASSESSMENT_LIMITS, AssessmentRequestSchema } from '../engineering/contracts.js';
import { ZONE_LIMITS, ZoneAssessmentRequestSchema, ZonePreflightRequestSchema } from '../engineering/zone-contracts.js';
import { ENGINEERING_ROOT, ZONES_ROOT, ZONE_PREFLIGHT_ROUTE, assessRevision, assessRevisionZones, preflightRevisionZoneRegeneration } from '../services/engineering-service.js';

/** Phase 35: preliminary engineering assessment of a stored revision with declared inputs. Computed on read; nothing is stored. */
export function engineeringRoutes(app: FastifyInstance, backend: Backend) {
  app.get(ENGINEERING_ROOT, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    parseRequest(z.object({}).strict(), request.query);
    return assessRevision(repository, projectId, revisionId, AssessmentRequestSchema.parse({}));
  });
  app.post(ENGINEERING_ROOT, { bodyLimit: ASSESSMENT_LIMITS.bodyBytes }, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return assessRevision(repository, projectId, revisionId, parseRequest(AssessmentRequestSchema, request.body ?? {}));
  });
  // Phase 35.1: zone assessment (GET = documented single-zone default) and the regeneration preflight, which always refuses execution.
  app.get(ZONES_ROOT, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    parseRequest(z.object({}).strict(), request.query);
    return assessRevisionZones(repository, projectId, revisionId, ZoneAssessmentRequestSchema.parse({}));
  });
  app.post(ZONES_ROOT, { bodyLimit: ZONE_LIMITS.bodyBytes }, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return assessRevisionZones(repository, projectId, revisionId, parseRequest(ZoneAssessmentRequestSchema, request.body ?? {}));
  });
  app.post(ZONE_PREFLIGHT_ROUTE, { bodyLimit: ZONE_LIMITS.bodyBytes }, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return preflightRevisionZoneRegeneration(repository, projectId, revisionId, parseRequest(ZonePreflightRequestSchema, request.body ?? {}));
  });
}
