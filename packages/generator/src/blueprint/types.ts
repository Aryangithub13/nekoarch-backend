import type { BuildingModelV2, BuildingSpace, RingMm } from '@designflow/shared';
import type { NormalizedBlueprintRequirements } from './input.js';
export type BlueprintFailureCode = 'UNSUPPORTED_PARAMETRIC_CAPABILITY' | 'INVALID_REQUIREMENTS' | 'UNSUPPORTED_GEOMETRY' | 'IMPOSSIBLE_LAYOUT' | 'UNSATISFIED_HARD_CONSTRAINT' | 'STAIR_PLACEMENT_FAILED' | 'DIMENSION_RECONCILIATION_FAILED' | 'BLUEPRINT_INVARIANT_FAILED' | 'SEARCH_LIMIT_EXHAUSTED' | 'UNSUPPORTED_SITE_GEOMETRY' | 'SITE_TOO_COMPLEX' | 'PROGRAM_DOES_NOT_FIT' | 'HARD_RELATIONSHIP_UNSATISFIABLE' | 'PARKING_UNSATISFIABLE' | 'SOLVER_CANCELLED' | 'SOLVER_TIMEOUT';
export class BlueprintError extends Error {
  constructor(readonly code: BlueprintFailureCode, message: string, readonly diagnostics: Record<string, string | number | string[]> = {}) { super(message); this.name = 'BlueprintError'; }
}
export interface Box { x: number; z: number; w: number; d: number }
export interface RoomIntent { key: string; level: number; requirement: NormalizedBlueprintRequirements['rooms'][number] }
export interface SolvedSpace { entity: BuildingSpace; box: Box; clear: Box; role: 'room' | 'circulation' | 'stair'; key: string }
export interface Candidate { index: number; axis: 'x' | 'z'; spaces: SolvedSpace[]; score: number; warnings: string[] }
export interface Constraints { outer: Box; center: Box; rooms: RoomIntent[]; siteBoundary: RingMm; buildableBoundary: RingMm }
export interface CirculationAnalysis { entranceSpaceId: string; edges: { from: string; to: string; via: string }[]; reachableSpaceIds: string[]; unreachableSpaceIds: string[] }
export interface BlueprintMetadata {
  solverVersion: string; seed: string; candidateAttempts: number; iterations: number; validCandidates: number; selectedCandidate: number;
  searchComplete: boolean; softPreferenceScore: number; warnings: string[]; assumptions: string[]; satisfiedHardConstraints: string[];
  circulation: CirculationAnalysis;
  roomDimensions: { spaceId: string; clearWidthMm: number; clearDepthMm: number; clearAreaMm2: number }[];
  utilization: { siteAreaMm2: number; buildableAreaMm2: number; footprintAreaMm2: number; totalEnvelopeAreaMm2: number; roomClearAreaMm2: number; circulationClearAreaMm2: number; stairCoreClearAreaMm2: number; wallsAndResidualAreaMm2: number; unusedBuildableAreaMm2: number };
}
export interface BlueprintResult { model: BuildingModelV2; metadata: BlueprintMetadata }
