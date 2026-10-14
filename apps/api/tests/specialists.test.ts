import { describe, expect, it } from 'vitest';
import { BLUEPRINT_LIMITS } from '@designflow/generator';
import { GENERATION_LIMITS } from '../../../packages/generator/src/input.js';
import { COMPONENT_SCOPES, MAX_REQUESTED_ROOMS, MODULE_SCOPES, S1_MODULES, SPECIALIST_MODULES, SPECIALIST_OPERATIONS, SPECIALIST_STATUSES, SPECIALIST_VERSION,
  SpecialistRequestSchema, SpecialistResultSchema, STATUS_PRECEDENCE } from '../src/contracts/specialists.js';
import { overallStatus, verificationOutcome } from '../src/services/specialist-service.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const request = (patch: Record<string, unknown> = {}) => ({ envelopeVersion: SPECIALIST_VERSION, baseRevisionId: uuid(1), operation: 'recompute',
  targetScopes: ['quantities'], ...patch });
const result = (patch: Record<string, unknown> = {}) => ({ envelopeVersion: SPECIALIST_VERSION, module: 'MATERIALS', operation: 'recompute', projectId: uuid(1),
  baseRevisionId: uuid(2), resultRevisionId: null, status: 'UNSUPPORTED', reasons: [{ code: 'X', message: 'y' }], targetScopes: ['quantities'], preserveScopes: [],
  written: false, replayed: false, operationId: null, jobIds: [], artifacts: [], details: { kind: 'NONE' }, changeImpact: null,
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

  it('S1 runs Blueprint, Materials and Budget only; each targets only what it rewrites', () => {
    expect([...S1_MODULES]).toEqual(['BLUEPRINT', 'MATERIALS', 'BUDGET']);
    for (const m of S1_MODULES) for (const t of MODULE_SCOPES[m].targets) expect(MODULE_SCOPES[m].rewrites as readonly string[], `${m} ${t}`).toContain(t);
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
  });

  it('a failed independent verification after a Blueprint commit is FAILED, says the revision is committed and current, and names the restore (scope §4 row 1)', () => {
    const ids = { projectId: uuid(1), baseRevisionId: uuid(2), revisionId: uuid(3) };
    const failed = verificationOutcome('FAILED', ids)!;
    expect([failed.status, failed.reason.code]).toEqual(['FAILED', 'VERIFICATION_FAILED']);
    for (const part of [uuid(3), 'committed', 'current revision', `restore revision ${uuid(2)}`, 'RESTORE', `/api/projects/${uuid(1)}/revision-operations`])
      expect(failed.reason.message).toContain(part);
    // The other outcomes are unchanged; a passed verification adds nothing. Every reason fits the result schema.
    expect([verificationOutcome('PARTIAL', ids)!.status, verificationOutcome(null, ids)!.status]).toEqual(['PARTIAL', 'REQUIRES_REVIEW']);
    expect([verificationOutcome('VERIFIED', ids), verificationOutcome('VERIFIED_WITH_WARNINGS', ids)]).toEqual([null, null]);
    for (const s of ['FAILED', 'PARTIAL', null] as const) expect(SpecialistResultSchema.safeParse(result({ reasons: [verificationOutcome(s, ids)!.reason] })).success).toBe(true);
    // FAILED outranks REQUIRES_REVIEW and PARTIAL, and a stale output still outranks it.
    expect([overallStatus(['REQUIRES_REVIEW', 'FAILED', 'PARTIAL']), overallStatus(['FAILED', 'STALE_DEPENDENCY'])]).toEqual(['FAILED', 'STALE_DEPENDENCY']);
  });

  it('the request is strict: duplicate or empty scopes, unknown fields and other envelope versions are refused', () => {
    expect(SpecialistRequestSchema.parse(request())).toMatchObject({ preserveScopes: [], outputConfig: {} });
    for (const bad of [request({ targetScopes: [] }), request({ targetScopes: ['quantities', 'quantities'] }), request({ preserveScopes: ['cost', 'cost'] }),
      request({ envelopeVersion: 'specialist-request-v0' }), request({ extra: true }), request({ targetScopes: ['roof'] }), request({ operation: 'delete' }),
      request({ instruction: 'x'.repeat(2001) })])
      expect(SpecialistRequestSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 100)).toBe(false);
  });

  it('the result can never claim a Phase 30 operation, a job, provider cost or an engineering, solver or review claim in S1', () => {
    expect(SpecialistResultSchema.parse(result())).toEqual(result());
    for (const patch of [{ operationId: uuid(3) }, { jobIds: [uuid(3)] }, { quote: { execution: 'NONE', externalProviders: ['x'], externalCostUsd: 0, dataTransfer: 'NONE' } },
      { quote: { execution: 'NONE', externalProviders: [], externalCostUsd: 1, dataTransfer: 'NONE' } },
      { claims: { engineeringCorrectness: 'CLAIMED', solverValidation: 'NOT_CLAIMED', professionalReview: 'NOT_CLAIMED' } },
      { provenance: { engine: null, engineVersion: null, providerId: 'openai', inputHash: null } }])
      expect(SpecialistResultSchema.safeParse(result(patch)).success, JSON.stringify(patch)).toBe(false);
  });
});
