import { describe, expect, it } from 'vitest';
import { costHash } from '@designflow/boq-cost';
import { calculateQuantityTakeoff } from '@designflow/quantity-takeoff';
import { authored, generated } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { ApiError } from '../src/lib/errors.js';
import { modelHash } from '../src/lib/generation-identity.js';
import { MODEL_LIMITS } from '../src/engineering/capability-limits.js';
import { applyInteriorFinishes } from '../src/revision/interior.js';
import { CHANGE_SET_VERSION, ChangeSetSchema, PLAN_STATUSES } from '../src/contracts/integration.js';
import { diffElements } from '../src/integration/element-diff.js';
import { planChanges, planStatus, STOREY_ADDITION_CHECKS } from '../src/integration/plan.js';

const BASE = '00000000-0000-4000-8000-000000000001';
const MAX_FLOORS = MODEL_LIMITS.find(l => l.limitId === 'GENERATION_MAX_FLOORS')!.value;
const set = (changes: unknown[], preserve: unknown[] = [], regenerate: unknown = {}) =>
  ChangeSetSchema.parse({ changeSetVersion: CHANGE_SET_VERSION, baseRevisionId: BASE, changes, preserve, regenerate });
const finish = (spaceId: string, finishes: unknown = { floor: 'carpet' }) => ({ operation: 'modify', elementType: 'space', elementId: spaceId, properties: { finishes } });
const codes = (p: ReturnType<typeof planChanges>) => p.changes.map(c => [c.disposition, c.reasons[0]!.code]);

describe('B40 element diff: stable identity by element id', () => {
  it('reports identical models as identical, with every element preserved', () => {
    const m = authored(), d = diffElements(m, authored());
    expect([d.modelIdentical, d.elementsIdentical, d.changes, d.documentFields]).toEqual([true, true, [], []]);
    for (const c of d.collections) expect([c.added, c.removed, c.modified, c.preserved, c.reordered], c.collection).toEqual([0, 0, 0, c.base, false]);
  });
  it('names exactly the changed space and field for a finish change; every other element keeps its id and content', () => {
    const base = authored(), next = applyInteriorFinishes(base, [{ spaceId: 'foyer', finishes: { floor: 'carpet' } }]), d = diffElements(base, next);
    expect(d.changes).toEqual([{ collection: 'spaces', elementId: 'foyer', change: 'MODIFIED', fields: ['finishes'] }]);
    expect([d.modelIdentical, d.candidateModelHash]).toEqual([false, modelHash(next)]);
    const spaces = d.collections.find(c => c.collection === 'spaces')!;
    expect([spaces.modified, spaces.preserved]).toEqual([1, base.spaces.length - 1]);
    expect(d.collections.filter(c => c.collection !== 'spaces').every(c => c.preserved === c.base && c.modified + c.added + c.removed === 0)).toBe(true);
  });
  it('reports additions, removals, document fields and reordering explicitly', () => {
    const base = authored(), next = authored();
    next.spaces = [...next.spaces.slice(1).reverse(), { ...next.spaces[0]!, id: 'new-space' }];
    next.name = 'Renamed';
    const d = diffElements(base, next), spaces = d.collections.find(c => c.collection === 'spaces')!;
    expect(d.changes.filter(c => c.collection === 'spaces').map(c => [c.elementId, c.change]).sort())
      .toEqual([[base.spaces[0]!.id, 'REMOVED'], ['new-space', 'ADDED']].sort());
    expect([spaces.added, spaces.removed, d.documentFields]).toEqual([1, 1, ['name']]);
    if (base.spaces.length > 2) expect(spaces.reordered).toBe(true);
  });
  it('refuses a model whose ids are not unique (identity would be ambiguous)', () => {
    const base = authored(), dup = authored();
    dup.spaces = [...dup.spaces, dup.spaces[0]!];
    expect(() => diffElements(base, dup)).toThrow(ApiError);
    try { diffElements(base, dup); } catch (e) { expect((e as ApiError).code).toBe('INTEGRATION_ELEMENT_IDENTITY_INVALID'); }
  });
});

describe('B40 change planning: typed dispositions, hard locks and the storey limit', () => {
  it('accepts a finish change on an existing space as the only executable change', () => {
    const p = planChanges(authored(), set([finish('foyer')]), MAX_FLOORS);
    expect(codes(p)).toEqual([['SUPPORTED', 'SPACE_FINISH_MODIFY']]);
    expect(p.changes[0]).toMatchObject({ module: 'INTERIOR', levelId: 'ground', limit: null });
    expect(p.assignments).toEqual([{ spaceId: 'foyer', finishes: { floor: 'carpet' } }]);
  });
  it('refuses unknown, duplicate, id-less and colliding targets without guessing', () => {
    const p = planChanges(authored(), set([finish('nowhere'), finish('foyer'), finish('foyer', { walls: 'paint-white' }),
      { operation: 'remove', elementType: 'wall' }, { operation: 'add', elementType: 'space', elementId: 'studio' }]), MAX_FLOORS);
    expect(codes(p)).toEqual([['NEEDS_CLARIFICATION', 'ELEMENT_NOT_FOUND'], ['SUPPORTED', 'SPACE_FINISH_MODIFY'], ['INVALID', 'DUPLICATE_TARGET'],
      ['INVALID', 'ELEMENT_ID_REQUIRED'], ['INVALID', 'ELEMENT_ID_EXISTS']]);
  });
  it('validates property values against the finish catalog and refuses empty modifications', () => {
    const p = planChanges(authored(), set([finish('foyer', { floor: 'gold-leaf' }), { operation: 'modify', elementType: 'space', elementId: 'studio' }]), MAX_FLOORS);
    expect(codes(p)).toEqual([['INVALID', 'PROPERTY_INVALID'], ['INVALID', 'NO_PROPERTIES']]);
    expect(p.assignments).toEqual([]);
  });
  it('reports a hard-lock conflict before support: interior, storey and geometry locks', () => {
    const m = authored(), wall = m.walls[0]!.id;
    expect(codes(planChanges(m, set([finish('foyer')], [{ scope: 'INTERIOR' }]), MAX_FLOORS))).toEqual([['BLOCKED_BY_LOCK', 'LOCK_CONFLICT']]);
    expect(codes(planChanges(m, set([finish('foyer')], [{ scope: 'LEVEL', levelId: 'ground' }]), MAX_FLOORS))).toEqual([['BLOCKED_BY_LOCK', 'LOCK_CONFLICT']]);
    // A finish is not a room-geometry change: ROOMS and STRUCTURE locks do not block it.
    expect(codes(planChanges(m, set([finish('foyer')], [{ scope: 'ROOMS' }, { scope: 'STRUCTURE' }]), MAX_FLOORS))).toEqual([['SUPPORTED', 'SPACE_FINISH_MODIFY']]);
    // An unsupported geometry change under a lock is reported as the conflict it is.
    const g = planChanges(m, set([{ operation: 'modify', elementType: 'wall', elementId: wall, properties: { thicknessMm: 300 } }], [{ scope: 'WALLS' }]), MAX_FLOORS);
    expect(codes(g)).toEqual([['BLOCKED_BY_LOCK', 'LOCK_CONFLICT']]);
    expect(g.changes[0]!.reasons[0]!.message).toContain('WALLS');
  });
  it('refuses geometry, removal, replacement and addition by type: arbitrary properties are never executed', () => {
    const m = authored(), wall = m.walls[0]!.id;
    expect(codes(planChanges(m, set([{ operation: 'modify', elementType: 'space', elementId: 'foyer', properties: { boundary: [] } },
      { operation: 'modify', elementType: 'space', elementId: 'studio', properties: { finishes: { floor: 'carpet' }, name: 'X' } },
      { operation: 'remove', elementType: 'wall', elementId: wall }, { operation: 'replace', elementType: 'wall', elementId: m.walls[1]!.id, properties: { a: 1 } },
      { operation: 'add', elementType: 'opening', elementId: 'new-door', properties: { kind: 'door' } }]), MAX_FLOORS))).toEqual([
      ['UNSUPPORTED', 'ELEMENT_GEOMETRY_NOT_SUPPORTED'], ['UNSUPPORTED', 'ELEMENT_GEOMETRY_NOT_SUPPORTED'], ['UNSUPPORTED', 'ELEMENT_REMOVAL_NOT_SUPPORTED'],
      ['UNSUPPORTED', 'ELEMENT_REPLACEMENT_NOT_SUPPORTED'], ['UNSUPPORTED', 'ELEMENT_ADDITION_NOT_SUPPORTED']]);
  });
  it('refuses a storey addition beyond the generators\' limit with the limit, and within it as a scope expansion; both list the required checks', () => {
    expect(MAX_FLOORS).toBe(2);
    const add = { operation: 'add', elementType: 'level', elementId: 'third', properties: { kind: 'storey' } };
    const two = planChanges(generated(2), set([add]), MAX_FLOORS).changes[0]!;
    expect([two.disposition, two.reasons[0]!.code, two.limit]).toEqual(['UNSUPPORTED', 'GEOMETRY_LIMIT_EXCEEDED', { limitId: 'GENERATION_MAX_FLOORS', value: 2, requested: 3 }]);
    expect(two.requiredChecks).toEqual([...STOREY_ADDITION_CHECKS]);
    const one = planChanges(authored(), set([add]), MAX_FLOORS).changes[0]!;
    expect([one.disposition, one.reasons[0]!.code, one.limit]).toEqual(['UNSUPPORTED', 'SELECTIVE_STOREY_ADDITION_NOT_SUPPORTED', { limitId: 'GENERATION_MAX_FLOORS', value: 2, requested: 2 }]);
    // A storey-geometry lock is a conflict, not a limit.
    expect(codes(planChanges(authored(), set([add], [{ scope: 'BUILDING_GEOMETRY' }]), MAX_FLOORS))).toEqual([['BLOCKED_BY_LOCK', 'LOCK_CONFLICT']]);
  });
  it('is deterministic and reports the most restrictive status', () => {
    const s = set([finish('foyer'), finish('studio', { ceiling: 'timber-slat' })]);
    expect(costHash(planChanges(authored(), s, MAX_FLOORS))).toBe(costHash(planChanges(authored(), s, MAX_FLOORS)));
    expect(planStatus([])).toBe('READY_FOR_APPROVAL');
    expect(planStatus(['STALE_BASE', 'UNSUPPORTED', 'BLOCKED_BY_LOCK'])).toBe('BLOCKED_BY_LOCK');
    expect(planStatus(['READY_FOR_APPROVAL', 'STALE_BASE'])).toBe('STALE_BASE');
    expect(PLAN_STATUSES[0]).toBe('INVALID');
  });
  it('bounds the change set by schema', () => {
    expect(() => set(Array.from({ length: 25 }, (_, i) => finish(`s${i}`)))).toThrow();
    expect(() => set([{ ...finish('foyer'), properties: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, 1])) }])).toThrow();
    expect(() => set([{ ...finish('foyer'), script: 'rm -rf' }])).toThrow();
  });
});

describe('B40 element-level evidence for the whole-model invalidation gap', () => {
  it('a finish-only change does not alter the quantity takeoff (the B37 graph still marks it stale: whole-model granularity)', () => {
    const base = authored(), next = applyInteriorFinishes(base, [{ spaceId: 'foyer', finishes: { floor: 'carpet', walls: 'paint-white' } }]);
    expect(modelHash(next)).not.toBe(modelHash(base));
    expect(costHash(calculateQuantityTakeoff(next, {}))).toBe(costHash(calculateQuantityTakeoff(base, {})));
  });
});
