import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { ApiError, parseRequest } from '../lib/errors.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { ProjectDetailSchema, ProjectParamsSchema } from '../contracts/projects.js';
import { NaturalLanguageDesignRequestSchema, INTERPRETATION_LIMITS } from '../contracts/requirement-interpretation.js';
import { interpretRequirements, type InterpreterOptions } from '../ai/architectural-interpreter.js';

export function requirementInterpretationRoutes(app: FastifyInstance, backend: Backend, env: Env, options: InterpreterOptions = {}) {
  app.post('/api/projects/:projectId/requirements/interpret', { bodyLimit: Math.min(env.SMALL_BODY_LIMIT_BYTES, INTERPRETATION_LIMITS.bodyBytes) }, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params);
    const input = parseRequest(NaturalLanguageDesignRequestSchema, request.body);
    const project = ProjectDetailSchema.parse(await new ProjectRepository(repository).read('get', projectId));
    if (input.baseRevisionId && input.baseRevisionId !== project.currentRevisionId) throw new ApiError(409, 'REVISION_CONFLICT', 'The project current revision has changed; reload before interpreting');
    if (input.baseRevisionId && project.currentRevision?.normalizedRequirements && 'layoutV2' in project.currentRevision.normalizedRequirements) {
      throw new ApiError(422, 'V2_INTERPRETATION_UNSUPPORTED', 'Modify V2 requirements through structured generation; the current language interpreter cannot preserve V2 preferences.');
    }
    const start = performance.now();
    const result = await interpretRequirements(input, input.baseRevisionId ? project.currentRevision?.normalizedRequirements ?? null : null,
      { disabled: env.AI_INTERPRETER_MODE === 'disabled', timeoutMs: env.AI_INTERPRETER_TIMEOUT_MS, maxOutputTokens: env.AI_INTERPRETER_MAX_OUTPUT_TOKENS, ...options });
    request.log.info({ interpretationId: result.interpretationId, provider: result.provider, model: result.providerModel, interpreterVersion: result.interpreterVersion,
      durationMs: performance.now() - start, status: result.status, validation: result.provenance.validation, clarificationCount: result.unresolvedQuestions.length,
      path: result.provenance.path, inputBytes: Buffer.byteLength(input.text) }, 'requirements interpreted');
    return result;
  });
}
