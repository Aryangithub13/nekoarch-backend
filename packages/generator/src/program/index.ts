export { generateProgramBlueprint } from './generate.js';
export { rejections as programSolverRejections } from './solve.js';
export type { ProgramResult, ProgramReport, ProgramRoom } from './generate.js';
export { ProgramRequirementsSchema, ProgramSchema, ProgramSpaceSchema, normalizeProgramRequirements, PROGRAM_VERSION, PROGRAM_LIMITS } from './input.js';
export type { ProgramRequirements, NormalizedProgramRequirements } from './input.js';
export { SPACE_KINDS, SPACE_KIND_NAMES, BUILDING_TYPES, QUALITY_TIERS, TIER_AREA_FACTOR, isResidential, synonymIndex } from './catalog.js';
export type { SpaceKind, BuildingType, QualityTier, SpaceKindInfo } from './catalog.js';
