import { normalizeParametricRequirements, type ParametricRequirements } from '@designflow/generator';
import { auditBlueprint } from '@designflow/blueprint-qa';
import type { BuildingModelV2 } from '@designflow/shared';
import { parametricInput } from './parametric-fixtures.js';
import { modelHash } from '../apps/api/src/lib/generation-identity.js';
import { projectQaOptions } from '../apps/api/src/services/project-service.js';
import { parametricQaOptions } from '../apps/api/src/services/parametric-qa.js';
import { generateWithEngine } from '../apps/api/src/optimization/candidate.js';
import type { OptimizationSource } from '../apps/api/src/optimization/contracts.js';

/** An accepted parametric revision as the optimization service would read it. */
export function optimizationSource(requirements: ParametricRequirements = parametricInput(), ids = { projectId: 'project-1', revisionId: 'revision-1' }): OptimizationSource {
  const r = normalizeParametricRequirements(requirements), model = generateWithEngine(r, { timeoutMs: 10000 }).model as BuildingModelV2;
  const qa = auditBlueprint(model, { ...projectQaOptions(model), ...parametricQaOptions(r) });
  return { ...ids, generatorVersion: 'parametric-architecture-v1', normalizedRequirements: r, model,
    identity: { modelHash: modelHash(model) }, qa: { status: qa.status, inputStatus: qa.inputStatus, errors: qa.summary.errors } };
}
type P = 'widthMm' | 'depthMm' | 'westWingWidthMm' | 'southWingDepthMm';
export const optimizationVariable = (variableId: string, level: 0 | 1, parameter: P, minimumMm: number, maximumMm: number, stepMm: number) =>
  ({ variableId, target: { kind: 'PARAMETRIC_FLOOR_DIMENSION', level, parameter }, unit: 'mm', domain: { kind: 'RANGE', minimumMm, maximumMm, stepMm }, allowedMutation: 'SET_PARAMETRIC_DIMENSION' });
/** A small weighted GRID study over the level-0 width of the default 1-storey fixture (5 candidates). */
export const optimizationInput = (overrides: Record<string, unknown> = {}) => ({ version: 'optimization-input-v1', mode: 'WEIGHTED_SCORE', strategy: { kind: 'GRID' },
  variables: [optimizationVariable('w0', 0, 'widthMm', 16000, 20000, 1000)],
  objectives: [{ objectiveId: 'gfa', metric: { kind: 'GROSS_FLOOR_AREA' }, goal: { kind: 'MINIMIZE' }, weight: 1, normalization: { method: 'CANDIDATE_RANGE' } }], ...overrides });
