import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { ApiError, parseRequest } from '../lib/errors.js';
import { SPECIALIST_ROUTE, SpecialistParamsSchema, SpecialistRequestSchema, SpecialistResultSchema } from '../contracts/specialists.js';
import { runSpecialist } from '../services/specialist-service.js';

/**
 * B39 S1: the shared specialist request envelope. Owner-only; in the generate rate-limit group (Blueprint generates a revision). A typed refusal is
 * a 200 result that stored nothing; a request that stored a revision or artifact is 201. The engines' own routes are unchanged.
 */
export function specialistRoutes(app: FastifyInstance, backend: Backend, env: Env) {
  app.post(SPECIALIST_ROUTE, { bodyLimit: env.SMALL_BODY_LIMIT_BYTES }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, module } = parseRequest(SpecialistParamsSchema, request.params);
    const body = parseRequest(SpecialistRequestSchema, request.body ?? {});
    const key = request.headers['idempotency-key'];
    if (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)))
      throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must contain 1–128 letters, digits, dots, underscores, colons or hyphens');
    const result = SpecialistResultSchema.parse(await runSpecialist(repository, userId!, projectId, module, body,
      { secret: env.PROJECT_COMMIT_SECRET, log: request.log, idempotencyKey: key }));
    request.log.info({ projectId, module, status: result.status, written: result.written, replayed: result.replayed, resultRevisionId: result.resultRevisionId },
      'specialist request result');
    return reply.code(result.written && !result.replayed ? 201 : 200).send(result);
  });
}
