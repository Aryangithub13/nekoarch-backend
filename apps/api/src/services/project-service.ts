import { createHmac, randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { ArchitecturalBuildingModelV2Schema, type BuildingModelV2 } from '@designflow/shared';
import { generateBlueprint, normalizeBlueprintRequirements, BlueprintError, BLUEPRINT_VERSION } from '@designflow/generator';
import { auditBlueprint, BlueprintQaReportSchema, PRODUCT_DEFAULTS_RULE_PACK } from '@designflow/blueprint-qa';
import type { z } from 'zod';
import { ProjectDetailSchema, RevisionCommitResponseSchema, type GenerateRevisionRequestSchema, type SaveRevisionRequestSchema } from '../contracts/projects.js';
import { ApiError } from '../lib/errors.js';
import type { IdempotencyContext } from '../lib/repository.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { GENERATION_IDENTITY_VERSION, requirementsHash, modelHash } from '../lib/generation-identity.js';

/** Product entrance policy: exterior doors on the lowest storey. QA independently
 * verifies host geometry and builds connectivity; no generator graph is trusted. */
export function projectQaOptions(model: BuildingModelV2) {
  const ground = [...model.levels].filter(level => level.kind === 'storey').sort((a, b) => a.elevationMm - b.elevationMm)[0];
  const exterior = new Set(model.walls.filter(w => w.levelId === ground?.id && w.classification === 'exterior').map(w => w.id));
  return { requireReachability: true, rulePacks: [PRODUCT_DEFAULTS_RULE_PACK],
    entryOpeningIds: model.openings.filter(o => o.kind === 'door' && exterior.has(o.wallId)).map(o => o.id).sort() };
}
export function signProjectCommit(secret: string, userId: string, operation: string, input: unknown, context?: IdempotencyContext) {
  const envelope = JSON.stringify({ userId, operation, input, context: context ?? null, expiresAt: Math.floor(Date.now() / 1000) + 300 });
  return { envelope, signature: createHmac('sha256', Buffer.from(secret, 'hex')).update(envelope).digest('hex') };
}
export async function saveProjectRevision(repository: ProjectRepository, userId: string, projectId: string,
  sourceMode: 'generated' | 'supplied', input: z.infer<typeof GenerateRevisionRequestSchema> | z.infer<typeof SaveRevisionRequestSchema>,
  secret?: string, context?: IdempotencyContext, logger?: FastifyBaseLogger) {
  // Check ownership before expensive generation/QA. Mutable-state checks happen ONLY
  // under the commit lock, after durable receipt replay, to avoid replay-vs-CAS races.
  ProjectDetailSchema.parse(await repository.read('get', projectId));
  if (!secret) throw new ApiError(503, 'PROJECTS_UNAVAILABLE', 'Project revision persistence is not configured');
  const normalizedRequirements = 'requirements' in input ? normalizeBlueprintRequirements(input.requirements) : null;
  const generationId = normalizedRequirements ? randomUUID() : null;
  const inputHash = normalizedRequirements ? requirementsHash(normalizedRequirements) : null;
  const trace = { projectId, baseRevisionId: input.baseRevisionId, generationId,
    requirementsHash: inputHash, seed: normalizedRequirements?.seed ?? null, generatorVersion: normalizedRequirements ? BLUEPRINT_VERSION : null };
  let rawModel;
  try {
    if (normalizedRequirements) {
      logger?.info(trace, 'blueprint generation started');
      const generated = generateBlueprint(normalizedRequirements);
      rawModel = generated.model;
      logger?.info({ ...trace, modelHash: modelHash(rawModel), candidateAttempts: generated.metadata.candidateAttempts,
        selectedCandidate: generated.metadata.selectedCandidate }, 'blueprint generation executed');
    } else if ('model' in input) rawModel = input.model;
  }
  catch (error) {
    if (error instanceof BlueprintError) throw new ApiError(422, error.code, 'The requested blueprint could not be generated');
    throw error;
  }
  const model = ArchitecturalBuildingModelV2Schema.parse(rawModel);
  const report = BlueprintQaReportSchema.parse(auditBlueprint(model, projectQaOptions(model)));
  if (report.status === 'FAIL') {
    // Existing error envelope, bounded machine-readable entries; no raw geometry.
    throw new ApiError(422, 'BLUEPRINT_QA_FAILED', 'Independent blueprint QA rejected the revision', {
      qaStatus: ['FAIL'], errors: [String(report.summary.errors)], warnings: [String(report.summary.warnings)],
      findings: report.findings.slice(0, 20).map(f => JSON.stringify({ code: f.code.slice(0, 100), severity: f.severity,
        message: f.message.slice(0, 240), entityIds: f.entityIds.slice(0, 5).map(id => id.slice(0, 100)) })),
    });
  }
  const operation = sourceMode === 'generated' ? '/api/projects/:projectId/revisions/generate' : '/api/projects/:projectId/revisions';
  const identity = { identityVersion: GENERATION_IDENTITY_VERSION, generationId, requirementsHash: inputHash,
    modelHash: modelHash(model), seed: normalizedRequirements?.seed ?? null };
  const commit = { projectId, baseRevisionId: input.baseRevisionId, model, report, sourceMode, identity, normalizedRequirements,
    generatorVersion: sourceMode === 'generated' ? BLUEPRINT_VERSION : null };
  return RevisionCommitResponseSchema.parse(await repository.write('revision', commit, context, signProjectCommit(secret, userId, operation, commit, context)));
}
