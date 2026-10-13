import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { RevisionParamsSchema } from '../contracts/projects.js';
import { EvidenceCreateRequestSchema, EvidenceDetailSchema, EvidenceListSchema, EvidencePageQuerySchema, EvidenceParamsSchema, EvidenceReadQuerySchema } from '../contracts/evidence.js';
import { EVIDENCE_ROOT, createEvidencePackage, listEvidencePackages, readEvidencePackage } from '../services/evidence-service.js';

/** Phase 38: immutable, owner-only engineering evidence packages. Creation is in the generate rate-limit group (it builds a graph and an assessment). */
export function evidenceRoutes(app: FastifyInstance, backend: Backend, env: Env) {
  app.post(EVIDENCE_ROOT, { bodyLimit: env.SMALL_BODY_LIMIT_BYTES }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    const { mode, assessment } = parseRequest(EvidenceCreateRequestSchema, request.body ?? {});
    return reply.code(201).send(EvidenceDetailSchema.parse(await createEvidencePackage(repository, userId!, projectId, revisionId, mode, assessment, env.PROJECT_COMMIT_SECRET)));
  });
  app.get(EVIDENCE_ROOT, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    return EvidenceListSchema.parse(await listEvidencePackages(repository, projectId, revisionId, parseRequest(EvidencePageQuerySchema, request.query)));
  });
  app.get(`${EVIDENCE_ROOT}/:packageId`, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId, packageId } = parseRequest(EvidenceParamsSchema, request.params);
    const query = parseRequest(EvidenceReadQuerySchema, request.query);
    return EvidenceDetailSchema.parse(await readEvidencePackage(repository, projectId, revisionId, packageId, query.require === 'current'));
  });
}
