import { describe, expect, it } from 'vitest';
import { BLUEPRINT_LIMITS } from '@designflow/generator';
import { GENERATION_LIMITS } from '../../../packages/generator/src/input.js';
import { COMPONENT_SCOPES, EXTERIOR_GEOMETRY_SCOPES, MAX_REFERENCES, MAX_REQUESTED_ROOMS, MODULE_SCOPES, PRESERVATION_MAP, S1_MODULES, S2_MODULES, SPECIALIST_MODULES,
  SPECIALIST_OPERATIONS, SPECIALIST_STATUSES, SPECIALIST_VERSION, SpecialistRequestSchema, SpecialistResultSchema, STATUS_PRECEDENCE, SUPPORTED_MODULES } from '../src/contracts/specialists.js';
import { PRESERVATION_SCOPES } from '../src/revision/contracts.js';
import { overallStatus } from '../src/services/specialist-service.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const request = (patch: Record<string, unknown> = {}) => ({ envelopeVersion: SPECIALIST_VERSION, baseRevisionId: uuid(1), operation: 'recompute',
  targetScopes: ['quantities'], ...patch });
const result = (patch: Record<string, unknown> = {}) => ({ envelopeVersion: SPECIALIST_VERSION, module: 'MATERIALS', operation: 'recompute', projectId: uuid(1),
  baseRevisionId: uuid(2), resultRevisionId: null, status: 'UNSUPPORTED', reasons: [{ code: 'X', message: 'y' }], targetScopes: ['quantities'], preserveScopes: [],
  written: false, replayed: false, operationId: null, jobIds: [], artifacts: [], locks: [], impacts: [], references: [], budget: null, details: { kind: 'NONE' }, changeImpact: null,
  quote: { execution: 'NONE', externalProviders: [], externalCostUsd: 0, dataTransfer: 'NONE' },
  provenance: { engine: null, engineVersion: null, providerId: null, inputHash: null }, manifestHref: `/api/projects/${uuid(1)}/revisions/${uuid(2)}/manifest`,
  claims: { engineeringCorrectness: 'NOT_CLAIMED', solverValidation: 'NOT_CLAIMED', professionalReview: 'NOT_CLAIMED' }, ...patch });

describe('B39 S1 specialist envelope contract', () => {
  it('carries the six roadmap modules and the §E operation and scope vocabularies verbatim', () => {
    expect(SPECIALIST_MODULES).toEqual(['INTERIOR', 'EXTERIOR', 'BLUEPRINT', 'STRUCTURAL', 'MATERIALS', 'BUDGET']);
    expect(SPECIALIST_OPERATIONS).toEqual(['modify', 'regenerate', 'generate_alternative', 'recompute', 'compare', 'restore']);
    expect(COMPONENT_SCOPES).toEqual(['building.geometry', 'building.floor_plans', 'building.structure', 'exterior.facade', 'exterior.materials', 'exterior.render',
      'interior.layout', 'interior.materials', 'interior.render', 'bim', 'engineering.structural', 'engineering.environmental', 'engineering.mep', 'quantities',
      'cost', 'documents', 'scene3d', 'walkthrough']);
    // The five typed statuses of ROADMAP L293, in their envelope spelling.
    for (const s of ['UNSUPPORTED', 'REQUIRES_REVIEW', 'DEGRADED_PROVIDER', 'STALE_DEPENDENCY', 'PARTIAL']) expect(SPECIALIST_STATUSES).toContain(s);
  });

  it('S1 runs Blueprint, Materials and Budget, S2 Exterior and Structural; Interior is not supported (D-12); each targets only what it rewrites', () => {
    expect([[...S1_MODULES], [...S2_MODULES], [...SUPPORTED_MODULES]]).toEqual([['BLUEPRINT', 'MATERIALS', 'BUDGET'], ['EXTERIOR', 'STRUCTURAL'],
      ['BLUEPRINT', 'MATERIALS', 'BUDGET', 'EXTERIOR', 'STRUCTURAL']]);
    expect(SUPPORTED_MODULES as readonly string[]).not.toContain('INTERIOR');
    for (const m of SUPPORTED_MODULES) for (const t of MODULE_SCOPES[m].targets) expect(MODULE_SCOPES[m].rewrites as readonly string[], `${m} ${t}`).toContain(t);
    // Exterior changes the finish only; geometry targets are refused, and every preservation it maps is a real Phase 30 scope.
    for (const g of EXTERIOR_GEOMETRY_SCOPES) expect(MODULE_SCOPES.EXTERIOR.rewrites as readonly string[]).not.toContain(g);
    for (const v of Object.values(PRESERVATION_MAP)) expect(PRESERVATION_SCOPES as readonly string[]).toContain(v);
    expect([MODULE_SCOPES.STRUCTURAL.operations, MODULE_SCOPES.STRUCTURAL.rewrites]).toEqual([['recompute'], ['engineering.structural']]);
    // A blueprint regeneration rewrites the whole model, so it can preserve nothing; Materials and Budget rewrite only their own output.
    expect(MODULE_SCOPES.BLUEPRINT.rewrites).toEqual(COMPONENT_SCOPES);
    expect([MODULE_SCOPES.MATERIALS.rewrites, MODULE_SCOPES.BUDGET.rewrites]).toEqual([['quantities'], ['cost']]);
    // The API cannot import the generator outside its boundary, so the room limit is mirrored; it must stay equal to both generator limits.
    expect([MAX_REQUESTED_ROOMS, MAX_REQUESTED_ROOMS]).toEqual([BLUEPRINT_LIMITS.maxRooms, GENERATION_LIMITS.maxRooms]);
  });

  it('reports the most restrictive status that applies, and COMPLETED when none does', () => {
    expect(new Set(STATUS_PRECEDENCE).size).toBe(STATUS_PRECEDENCE.length);
    expect(overallStatus([])).toBe('COMPLETED');
    expect(overallStatus(['PARTIAL', 'REQUIRES_REVIEW'])).toBe('REQUIRES_REVIEW');
    expect(overallStatus(['PARTIAL', 'STALE_DEPENDENCY', 'REQUIRES_REVIEW'])).toBe('STALE_DEPENDENCY');
    expect(overallStatus(['DEGRADED_PROVIDER', 'PARTIAL'])).toBe('PARTIAL');
    expect(overallStatus(['BLOCKED_BY_LOCK', 'UNSUPPORTED'])).toBe('UNSUPPORTED');
    // A failed independent verification outranks a review note (owner decision, 2026-10-14); waiting on the user ranks below every failure or review.
    expect(overallStatus(['REQUIRES_REVIEW', 'FAILED'])).toBe('FAILED');
    expect(overallStatus(['AWAITING_CONSENT', 'REQUIRES_REVIEW'])).toBe('REQUIRES_REVIEW');
    expect(overallStatus(['AWAITING_CONSENT'])).toBe('AWAITING_CONSENT');
    expect(overallStatus(['NEEDS_CLARIFICATION', 'PARTIAL'])).toBe('NEEDS_CLARIFICATION');
    expect([...STATUS_PRECEDENCE].sort()).toEqual([...SPECIALIST_STATUSES].sort());
  });

  it('the request is strict: duplicate or empty scopes, unknown fields and other envelope versions are refused', () => {
    expect(SpecialistRequestSchema.parse(request())).toMatchObject({ preserveScopes: [], outputConfig: {} });
    for (const bad of [request({ targetScopes: [] }), request({ targetScopes: ['quantities', 'quantities'] }), request({ preserveScopes: ['cost', 'cost'] }),
      request({ envelopeVersion: 'specialist-request-v0' }), request({ extra: true }), request({ targetScopes: ['roof'] }), request({ operation: 'delete' }),
      request({ instruction: 'x'.repeat(2001) }), request({ referenceIds: [uuid(5), uuid(5)] }), request({ referenceIds: ['not-a-uuid'] }),
      request({ referenceIds: Array.from({ length: MAX_REFERENCES + 1 }, (_, i) => uuid(10 + i)) }),
      request({ budget: { ceiling: '-1', currency: 'INR' } }), request({ budget: { ceiling: '1.234', currency: 'INR' } }), request({ budget: { ceiling: '01', currency: 'INR' } }),
      request({ budget: { ceiling: '10', currency: 'GBP' } }), request({ budget: { ceiling: 10, currency: 'INR' } }), request({ budget: { ceiling: '10' } })])
      expect(SpecialistRequestSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 100)).toBe(false);
    // References and an execution-cost ceiling (ROADMAP L288) are accepted.
    expect(SpecialistRequestSchema.parse(request({ referenceIds: [uuid(5)], budget: { ceiling: '2500.50', currency: 'INR' } })))
      .toMatchObject({ referenceIds: [uuid(5)], budget: { ceiling: '2500.50', currency: 'INR' } });
    expect(SpecialistRequestSchema.parse(request({ budget: { ceiling: '0', currency: 'USD' } })).budget).toEqual({ ceiling: '0', currency: 'USD' });
  });

  it('the result can never claim a job, provider cost, an over-ceiling quote, consumed reference content or an engineering, solver or review claim', () => {
    expect(SpecialistResultSchema.parse(result())).toEqual(result());
    // An Exterior request stores a Phase 30 operation, so the result may name one.
    expect(SpecialistResultSchema.parse(result({ operationId: uuid(3) })).operationId).toBe(uuid(3));
    for (const patch of [{ jobIds: [uuid(3)] }, { quote: { execution: 'NONE', externalProviders: ['x'], externalCostUsd: 0, dataTransfer: 'NONE' } },
      { budget: { ceiling: '10', currency: 'INR', quotedExternalCost: '1', withinCeiling: true } },
      { budget: { ceiling: '10', currency: 'INR', quotedExternalCost: '0', withinCeiling: false } },
      { references: [{ referenceId: uuid(4), purpose: 'SITE_PHOTO', mediaType: 'image/png', storedSha256: 'a'.repeat(64), use: 'CONTENT_USED' }] },
      { quote: { execution: 'NONE', externalProviders: [], externalCostUsd: 1, dataTransfer: 'NONE' } },
      { claims: { engineeringCorrectness: 'CLAIMED', solverValidation: 'NOT_CLAIMED', professionalReview: 'NOT_CLAIMED' } },
      { provenance: { engine: null, engineVersion: null, providerId: 'openai', inputHash: null } }])
      expect(SpecialistResultSchema.safeParse(result(patch)).success, JSON.stringify(patch)).toBe(false);
  });
});
