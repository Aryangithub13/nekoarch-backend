import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { RevisionParamsSchema } from '../contracts/projects.js';
import { DiffRequestSchema, VerificationRequestSchema } from '../verification/contracts.js';
import { VERIFICATION_ROOT, diffRevisions, verifyRevision } from '../services/verification-service.js';

/** Phase 34: independent, exact verification of an accepted revision and scoped diffs between revisions. Computed on read; nothing is stored. */
export function verificationRoutes(app: FastifyInstance, backend: Backend) {
  app.get(VERIFICATION_ROOT, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    parseRequest(z.object({}).strict(), request.query);
    return verifyRevision(repository, projectId, revisionId, null);
  });
  app.post(VERIFICATION_ROOT, { bodyLimit: 1024 }, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    const { declaredLimits } = parseRequest(VerificationRequestSchema, request.body ?? {});
    return verifyRevision(repository, projectId, revisionId, declaredLimits ?? null);
  });
  app.post(`${VERIFICATION_ROOT}/diff`, { bodyLimit: 65_536 }, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    const { otherRevisionId, scope } = parseRequest(DiffRequestSchema, request.body);
    return diffRevisions(repository, projectId, revisionId, otherRevisionId, scope);
  });
}
