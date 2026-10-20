import { parametricQaOptions } from './parametric-qa.js';
import { solverV2QaOptions } from './solver-v2-qa.js';
import { createHmac, randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { ArchitecturalBuildingModelV2Schema, type BuildingModelV2 } from '@designflow/shared';
import { generateBlueprint, generateBlueprintV2, generateParametricBlueprint, generateProgramBlueprint, normalizeBlueprintForVersion, blueprintVersionForRequirements, normalizeBlueprintV2Requirements, normalizeParametricRequirements, BlueprintError } from '@designflow/generator';
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
/** QA for re-committing a stored revision model (Phase 30 approve/restore): same option derivation as saveProjectRevision. */
export function storedRevisionQaReport(model: z.infer<typeof ArchitecturalBuildingModelV2Schema>, generatorVersion: string | null, normalizedRequirements: unknown) {
  const v2 = generatorVersion === 'precision-blueprint-v2' && normalizedRequirements ? normalizeBlueprintV2Requirements(normalizedRequirements as Parameters<typeof normalizeBlueprintV2Requirements>[0]) : null;
  return revisionQaReport(model, v2, normalizedRequirements);
}
/** Independent QA for a revision commit; the options derive only from the stored normalized requirements, so a re-commit of the same model reproduces the same report. */
export function revisionQaReport(model: z.infer<typeof ArchitecturalBuildingModelV2Schema>, v2Requirements: ReturnType<typeof normalizeBlueprintV2Requirements> | null, normalizedRequirements: unknown) {
  const normalized = normalizedRequirements as Parameters<typeof normalizeParametricRequirements>[0] | null;
  return BlueprintQaReportSchema.parse(auditBlueprint(model, { ...projectQaOptions(model), ...(v2Requirements ? solverV2QaOptions(v2Requirements) : {}),
    ...(normalized && typeof normalized === 'object' && 'parametricArchitecture' in normalized ? parametricQaOptions(normalizeParametricRequirements(normalized)) : {}) }));
}
export async function saveProjectRevision(repository: ProjectRepository, userId: string, projectId: string,
  sourceMode: 'generated' | 'supplied', input: z.infer<typeof GenerateRevisionRequestSchema> | z.infer<typeof SaveRevisionRequestSchema>,
  secret?: string, context?: IdempotencyContext, logger?: FastifyBaseLogger) {
  // Check ownership before expensive generation/QA. Mutable-state checks happen ONLY
  // under the commit lock, after durable receipt replay, to avoid replay-vs-CAS races.
  ProjectDetailSchema.parse(await repository.read('get', projectId));
  if (!secret) throw new ApiError(503, 'PROJECTS_UNAVAILABLE', 'Project revision persistence is not configured');
  const version = 'requirements' in input ? blueprintVersionForRequirements(input.requirements) : null;
  const normalizedRequirements = 'requirements' in input && version ? normalizeBlueprintForVersion(input.requirements, version) : null;
  const v2Requirements = version === 'precision-blueprint-v2' && normalizedRequirements ? normalizeBlueprintV2Requirements(normalizedRequirements) : null;
  const generationId = normalizedRequirements ? randomUUID() : null;
  const inputHash = normalizedRequirements ? requirementsHash(normalizedRequirements) : null;
  const trace = { projectId, baseRevisionId: input.baseRevisionId, generationId,
    requirementsHash: inputHash, seed: normalizedRequirements?.seed ?? null, generatorVersion: version };
  let rawModel;
  try {
    if (normalizedRequirements) {
      logger?.info(trace, 'blueprint generation started');
      const generated = version === 'program-architecture-v1' ? generateProgramBlueprint(normalizedRequirements, { timeoutMs: 10000 }) : version === 'parametric-architecture-v1' ? generateParametricBlueprint(normalizedRequirements, { timeoutMs: 10000 }) : version === 'precision-blueprint-v2' ? generateBlueprintV2(normalizedRequirements, { timeoutMs: 10000 }) : generateBlueprint(normalizedRequirements);
      rawModel = generated.model;
      logger?.info({ ...trace, modelHash: modelHash(rawModel), candidateAttempts: generated.metadata.candidateAttempts,
        selectedCandidate: generated.metadata.selectedCandidate }, 'blueprint generation executed');
    } else if ('model' in input) rawModel = input.model;
  }
  catch (error) {
    if (error instanceof BlueprintError) {
      if (version === 'precision-blueprint-v1') throw new ApiError(422, error.code, 'The requested blueprint could not be generated');
      throw new ApiError(422, error.code, error.message, Object.fromEntries(Object.entries(error.diagnostics).map(([key, value]) => [key, Array.isArray(value) ? value : [String(value)]])));
    }
    throw error;
  }
  const model = ArchitecturalBuildingModelV2Schema.parse(rawModel);
  const report = revisionQaReport(model, v2Requirements, normalizedRequirements);
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
    generatorVersion: sourceMode === 'generated' ? version : null };
  return RevisionCommitResponseSchema.parse(await repository.write('revision', commit, context, signProjectCommit(secret, userId, operation, commit, context)));
}
