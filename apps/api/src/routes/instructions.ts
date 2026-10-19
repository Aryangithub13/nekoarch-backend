import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { INSTRUCTION_ROUTE, InstructionParamsSchema, InstructionRequestSchema, InstructionResolutionSchema } from '../instructions/contracts.js';
import { resolveRevisionInstruction } from '../services/instruction-service.js';

/** B41 S1: deterministic resolution of one revision instruction into typed intent, grounded targets, locks and a B40 change-set draft. Stores nothing. */
export function instructionRoutes(app: FastifyInstance, backend: Backend) {
  app.post(INSTRUCTION_ROUTE, { bodyLimit: 8192 }, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(InstructionParamsSchema, request.params);
    const { text } = parseRequest(InstructionRequestSchema, request.body ?? {});
    return InstructionResolutionSchema.parse(await resolveRevisionInstruction(repository, projectId, revisionId, text));
  });
}
