export * from '../parametric/components.js';
import { PARAMETRIC_VERSION, ParametricRequirementsSchema, normalizeParametricRequirements } from '../parametric/input.js';
import { generateParametricBlueprint } from '../parametric/generate.js';
export * from '../parametric/input.js';
export * from '../parametric/generate.js';
import { z } from 'zod';
import { generateBlueprint as generateBlueprintV1 } from '../blueprint/generate.js';
import { BLUEPRINT_VERSION, BlueprintRequirementsSchema, normalizeBlueprintRequirements } from '../blueprint/input.js';
import { generateBlueprintV2, type SolverV2Execution } from './generate.js';
import { BLUEPRINT_V2_VERSION, BlueprintV2RequirementsSchema, normalizeBlueprintV2Requirements } from './input.js';
import { BlueprintError } from '../blueprint/types.js';
import { PROGRAM_VERSION, ProgramRequirementsSchema, normalizeProgramRequirements } from '../program/input.js';
import { generateProgramBlueprint } from '../program/generate.js';
export { generateBlueprintV1, generateBlueprintV2 };
export * from './input.js';
export { cardinalForSide, evaluateCandidate } from './evaluate.js';
export type { BlueprintV2Result, SolverV2Execution } from './generate.js';
// Installing V2 never changes the default solver for historical callers.
export const ACTIVE_BLUEPRINT_VERSION = BLUEPRINT_VERSION;
export const BlueprintEngineVersionSchema = z.enum([BLUEPRINT_VERSION, BLUEPRINT_V2_VERSION, PARAMETRIC_VERSION, PROGRAM_VERSION]);
export type BlueprintEngineVersion = z.infer<typeof BlueprintEngineVersionSchema>;
export function generateBlueprintForVersion(input: unknown, version: BlueprintEngineVersion = ACTIVE_BLUEPRINT_VERSION, execution?: SolverV2Execution) {
  BlueprintEngineVersionSchema.parse(version);
  return version === PROGRAM_VERSION ? generateProgramBlueprint(input, execution ?? {}) : version === PARAMETRIC_VERSION ? generateParametricBlueprint(input, execution) : version === BLUEPRINT_VERSION ? generateBlueprintV1(input) : generateBlueprintV2(input, execution);
}
export function normalizeBlueprintForVersion(input: unknown, version: BlueprintEngineVersion = ACTIVE_BLUEPRINT_VERSION) {
  BlueprintEngineVersionSchema.parse(version);
  return version === PROGRAM_VERSION ? normalizeProgramRequirements(input) : version === PARAMETRIC_VERSION ? normalizeParametricRequirements(input) : version === BLUEPRINT_VERSION ? normalizeBlueprintRequirements(input) : normalizeBlueprintV2Requirements(input);
}

/** Presence of the explicit layoutV2 object opts into V2, a program object into the program engine. V1 stays strict. */
export function blueprintVersionForRequirements(input: unknown): BlueprintEngineVersion {
  if (input !== null && typeof input === 'object' && 'program' in input) return PROGRAM_VERSION;
  if (input !== null && typeof input === 'object' && 'parametricArchitecture' in input) return PARAMETRIC_VERSION;
  return input !== null && typeof input === 'object' && 'layoutV2' in input ? BLUEPRINT_V2_VERSION : BLUEPRINT_VERSION;
}
export const SelectedBlueprintRequirementsSchema = z.union([
  BlueprintRequirementsSchema,
  ParametricRequirementsSchema,
  ProgramRequirementsSchema,
  z.object({ layoutV2: z.object({}).passthrough() }).passthrough().pipe(BlueprintV2RequirementsSchema),
]).transform((input, ctx) => {
  try { return normalizeBlueprintForVersion(input, blueprintVersionForRequirements(input)); }
  catch (error) {
    if (!(error instanceof BlueprintError)) throw error;
    ctx.addIssue({ code: 'custom', message: `${error.code}: ${error.message}` });
    return z.NEVER;
  }
});
