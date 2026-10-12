import type { BuildingModelV2 } from '@designflow/shared';
import { sourceModel } from '../bim/core.js';
import { BimError } from '../bim/contracts.js';
import { ZONE_LIMITS } from './zone-contracts.js';

/**
 * Phase 35.1: the current execution limits, stated where clients discover capabilities. Each row names the layer that enforces the limit and the
 * typed refusal a client receives; none of these values is a target or an engineering threshold, and none is changed here.
 * GENERATION_MAX_FLOORS mirrors BLUEPRINT_LIMITS.maxFloors (pinned by a test; the API may import the generator only through its allowlisted boundary).
 */
export const MODEL_LIMITS = Object.freeze([
  { limitId: 'BUILDING_MODEL_MAX_LEVELS', value: 256, unit: 'levels', enforcedBy: 'Building Model V2 schema (levels.max(256))',
    onExceed: '400 VALIDATION_ERROR when a revision is saved', appliesTo: ['BUILDING_MODEL'] },
  { limitId: 'GENERATION_MAX_FLOORS', value: 2, unit: 'floors', enforcedBy: 'Generator requirement schemas (blueprint floors 1 | 2, parametric floors ≤ 2)',
    onExceed: '400 VALIDATION_ERROR at the generation route', appliesTo: ['GENERATION'] },
  { limitId: 'BIM_PROFILE_MAX_STOREYS', value: 2, unit: 'levels', enforcedBy: 'Bounded BIM source profile (bim/core sourceModel), with element-count and orthogonality limits',
    onExceed: '422 BIM_UNSUPPORTED_MODEL, surfaced as STRUCTURAL_/ENVIRONMENTAL_/BUILDING_SYSTEMS_/KNOWLEDGE_SOURCE_UNSUPPORTED or SCENE_UNSUPPORTED_MODEL',
    appliesTo: ['BIM', 'STRUCTURAL_ANALYSIS', 'ENVIRONMENTAL_ANALYSIS', 'BUILDING_SYSTEMS_ANALYSIS', 'SPECIALIZED_KNOWLEDGE', 'SCENE_3D'] },
  // Selective revision is gated only for appearance changes, and it refuses through its preflight rather than with an error; RESTORE does not
  // use this profile (revision/plan.ts restore branch, revision-service restore execution).
  { limitId: 'SELECTIVE_REVISION_APPEARANCE_PROFILE', value: 2, unit: 'levels', enforcedBy: 'Selective revision appearance planning (BIM projection of the base revision, revision/plan.ts)',
    onExceed: '200 preflight with status UNSUPPORTED and blocker SCENE_UNSUPPORTED_MODEL (not an error response); RESTORE is not gated by this profile',
    appliesTo: ['SELECTIVE_REVISION_APPEARANCE_MODIFY'] },
  { limitId: 'ZONE_ASSESSMENT_MAX_ZONES', value: ZONE_LIMITS.zones, unit: 'zones', enforcedBy: 'Zone assessment request schema', onExceed: '400 VALIDATION_ERROR',
    appliesTo: ['ZONE_ASSESSMENT'] },
].map(l => Object.freeze(l)));

/** Operations a client might expect for a tall or large building that the backend does not perform. Typed, stable identifiers. */
export const UNSUPPORTED_OPERATIONS = Object.freeze([
  { operationId: 'SUPERTALL_GENERATION', status: 'UNSUPPORTED', reason: 'GENERATOR_MAX_TWO_FLOORS',
    detail: 'Generation produces at most two floors. A taller model can be supplied and assessed, but it cannot be generated.', preflightRoute: null },
  { operationId: 'PARTITIONED_MODEL_PROCESSING', status: 'UNSUPPORTED', reason: 'BIM_PROFILE_MAX_TWO_STOREYS',
    detail: 'BIM, scene, structural, environmental, building-systems and knowledge services do not process a model zone by zone; models beyond the bounded BIM profile are refused. Zone assessment is geometric analysis only.',
    preflightRoute: null },
  { operationId: 'ZONE_GEOMETRY_REGENERATION', status: 'UNSUPPORTED', reason: 'NO_MULTI_STOREY_GENERATOR',
    detail: 'No validated generation path regenerates the geometry of a vertical zone while preserving the rest of the building.',
    preflightRoute: '/api/projects/:projectId/revisions/:revisionId/engineering-assessment/zones/regeneration-preflight' },
  { operationId: 'SECTION_GEOMETRY_REGENERATION', status: 'UNSUPPORTED', reason: 'NO_MULTI_STOREY_GENERATOR',
    detail: 'No validated generation path regenerates a storey range (building section) in place.',
    preflightRoute: '/api/projects/:projectId/revisions/:revisionId/engineering-assessment/zones/regeneration-preflight' },
  { operationId: 'EXTERIOR_SKIN_GEOMETRY_REGENERATION', status: 'UNSUPPORTED', reason: 'GEOMETRY_REVISION_OPERATION_UNSUPPORTED',
    detail: 'Exterior skin geometry is not regenerated. Selective revision changes exterior wall appearance only, and only for models inside the BIM/scene profile.',
    preflightRoute: '/api/projects/:projectId/revisions/:revisionId/engineering-assessment/zones/regeneration-preflight' },
  { operationId: 'VALIDATED_ENGINEERING_SOLVERS', status: 'UNSUPPORTED', reason: 'NO_VALIDATED_SOLVER',
    detail: 'No validated wind, seismic, lateral-stability, dynamic, foundation or member-design solver exists; the engineering assessment reports these domains as blocked.',
    preflightRoute: null },
].map(o => Object.freeze(o)));

export type BimProfile = { eligible: true; refusalCode: null } | { eligible: false; refusalCode: string };

/**
 * Asks the actual BIM source gate (bim/core sourceModel, not a copy of its rules) whether this model is inside the bounded profile every
 * BIM-derived service needs. This is the first gate only: a model it admits can still be refused later by BIM projection, BIM validation or the
 * service's own input checks, so `eligible` is preliminary eligibility, never final support. A refusal here is final.
 */
export function bimProfile(model: BuildingModelV2): BimProfile {
  try {
    sourceModel(model);
    return { eligible: true, refusalCode: null };
  } catch (error) {
    if (error instanceof BimError) return { eligible: false, refusalCode: error.code };
    throw error;
  }
}
