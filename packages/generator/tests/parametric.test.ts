import { describe, expect, it } from 'vitest';
import { generateParametricBlueprint, modifyParametricRequirements, normalizeParametricRequirements, generateBlueprintForVersion, BlueprintError } from '../src/index.js';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { polygonAreaMm2, ringContains } from '@designflow/shared';
import { calculateQuantityTakeoff } from '@designflow/quantity-takeoff';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { parametricQaOptions } from '../../../apps/api/src/services/parametric-qa.js';
import { projectQaOptions } from '../../../apps/api/src/services/project-service.js';
import { initialConversation, planConversation } from '../../../apps/api/src/ai/conversation-planner.js';
import { ConversationIntentSchema } from '../../../apps/api/src/contracts/conversations.js';
import { modelHash, requirementsHash } from '../../../apps/api/src/lib/generation-identity.js';

const qa = (model: ReturnType<typeof generateParametricBlueprint>['model'], input = parametricInput()) => auditBlueprint(model, { ...projectQaOptions(model), ...parametricQaOptions(normalizeParametricRequirements(input)) });
describe('Phase 22 parametric architecture', () => {
  it.each([false, true])('places rooms in both connected wings, exact slabs and nested floors (%s)', two => {
    const input = parametricInput(two), { model } = generateParametricBlueprint(input), report = qa(model, input);
    expect(report.findings.filter(f => f.severity === 'ERROR')).toEqual([]);
    expect(report.circulation.unreachableSpaceIds).toEqual([]);
    expect(model.levels[0]!.boundary).toHaveLength(6);
    expect(polygonAreaMm2(model.levels[0]!.boundary)).toBe('234000000');
    expect(model.spaces.some(s => s.classification !== 'circulation' && s.boundary.some(p => p.x > 10000))).toBe(true);
    expect(model.spaces.some(s => s.classification !== 'circulation' && s.boundary.some(p => p.z > 9000))).toBe(true);
    for (const space of model.spaces) expect(ringContains(model.levels.find(l => l.id === space.levelId)!.boundary, space.boundary)).toBe(true);
    const takeoff = calculateQuantityTakeoff(model);
    expect(takeoff.items.some(i => i.itemCode === 'FLOOR_PLATE_NET_AREA' && i.quantity.value === '234000000')).toBe(true);
    if (two) {
      expect(model.levels[1]!.boundary).not.toEqual(model.levels[0]!.boundary);
      expect(model.slabs.find(s => s.id === 'slab-1')!.footprint.voids).toEqual([model.stairs[0]!.footprint]);
      expect(report.measurements.grossFloorAreaMm2).toBe('418300000');
      expect(takeoff.items.filter(i => ['SPACE_FLOOR_AREA', 'FLOOR_FINISH_BASE_AREA'].includes(i.itemCode)).every(i => !i.sourceEntityIds.some(id => id.startsWith('space-stairwell')))).toBe(true);
      expect(takeoff.coverage.find(c => c.category === 'parametric_stair_core_finish')?.status).toBe('NOT_EVALUATED');
    }
  });
  it('rebuilds immutable parameters, preserves requirements and repeats canonical identity', () => {
    const input = parametricInput(), before = JSON.stringify(input), first = generateParametricBlueprint(input);
    const updated = modifyParametricRequirements(input, { level: 0, parameter: 'westWingWidthMm', valueMm: 10000 });
    const next = generateParametricBlueprint(updated);
    expect(JSON.stringify(input)).toBe(before); expect(updated.rooms).toEqual(normalizeParametricRequirements(input).rooms);
    expect(qa(next.model, updated).status).not.toBe('FAIL');
    expect(modelHash(first.model)).not.toBe(modelHash(next.model)); expect(requirementsHash(input)).not.toBe(requirementsHash(updated));
    expect(modelHash(generateParametricBlueprint(input).model)).toBe(modelHash(first.model));
    expect(first.model.spaces.map(s => s.id)).toEqual(next.model.spaces.map(s => s.id));
    expect(() => generateBlueprintForVersion(input)).toThrow();
  });
  it.each(['U', 'courtyard', 'balcony'])('explicitly rejects unsupported %s', shape => {
    const input = parametricInput(); Object.assign(input.parametricArchitecture, { shape });
    expect(() => generateParametricBlueprint(input)).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_PARAMETRIC_CAPABILITY' }));
  });
  it('rejects outside site, upper overhang, impossible program and resource exhaustion', () => {
    const outside = parametricInput(); outside.parametricArchitecture.floors[0]!.widthMm = 30000;
    expect(() => generateParametricBlueprint(outside)).toThrowError(expect.objectContaining({ code: 'PROGRAM_DOES_NOT_FIT' }));
    const overhang = parametricInput(true); overhang.parametricArchitecture.floors[1]!.widthMm = 19000;
    expect(() => generateParametricBlueprint(overhang)).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_PARAMETRIC_CAPABILITY' }));
    expect(() => generateParametricBlueprint({ ...parametricInput(), rooms: [{ type: 'living', count: 1 }] })).toThrow(BlueprintError);
    expect(() => generateParametricBlueprint({ ...parametricInput(), solver: { maxIterations: 1 } })).toThrowError(expect.objectContaining({ code: 'SEARCH_LIMIT_EXHAUSTED' }));
    expect(() => generateParametricBlueprint(parametricInput(), { signal: { aborted: true } })).toThrowError(expect.objectContaining({ code: 'SOLVER_CANCELLED' }));
  });
  it.each([0.5, Number.MAX_SAFE_INTEGER, -1, 0, NaN, Infinity])('rejects unsafe dimension %s', value => {
    const input = parametricInput(); input.parametricArchitecture.floors[0]!.westWingWidthMm = value;
    expect(() => normalizeParametricRequirements(input)).toThrow(BlueprintError);
  });
  it.each(['slab', 'wall', 'door', 'duplicate', 'winding', 'parent', 'floor', 'void', 'parameters', 'room'])('independent QA rejects forged %s', mutation => {
    const input = parametricInput(true), model = structuredClone(generateParametricBlueprint(input).model);
    if (mutation === 'slab') model.slabs = model.slabs.filter(s => s.id !== 'slab-0');
    if (mutation === 'wall') model.walls.splice(0, 1);
    if (mutation === 'door') model.openings = model.openings.filter(o => o.kind !== 'door');
    if (mutation === 'duplicate') model.walls.push(structuredClone(model.walls[0]!));
    if (mutation === 'winding') model.levels[0]!.boundary.reverse();
    if (mutation === 'parent') model.spaces[0]!.levelId = 'missing';
    if (mutation === 'floor') model.levels[1]!.index = 3;
    if (mutation === 'void') model.slabs.find(s => s.id === 'slab-1')!.footprint.voids = [];
    if (mutation === 'parameters') delete model.parametricArchitecture;
    if (mutation === 'room') model.spaces.find(s => s.classification === 'bedroom')!.boundary[1]!.x += 40000;
    expect(qa(model, input).status).toBe('FAIL');
  });
  it('supports explicit native edits without allowing provider-authored geometry', async () => {
    const normalized = normalizeParametricRequirements(parametricInput(true));
    const state = await planConversation(initialConversation(null, normalized, false), {
      messageId: '00000000-0000-4000-8000-000000000001', expectedVersion: 0, baseRevisionId: null, text: 'Use these values',
      nativeUpdate: { parametricEdit: { level: 1, parameter: 'widthMm', valueMm: 15000 } },
    });
    expect(state.status).toBe('AWAITING_APPROVAL'); expect(state.proposal!.changedFields).toEqual(['parametricArchitecture']);
    expect(ConversationIntentSchema.safeParse({ parametricEdit: { level: 0, parameter: 'widthMm', valueMm: 10000 } }).success).toBe(false);
    expect(ConversationIntentSchema.safeParse({ model: generateParametricBlueprint(parametricInput()).model }).success).toBe(false);
    const unsupported = await planConversation(initialConversation(null, normalized, false), {
      messageId: '00000000-0000-4000-8000-000000000002', expectedVersion: 0, baseRevisionId: null, text: 'Move the courtyard boundary inward',
    });
    expect(unsupported.status).toBe('NEEDS_CLARIFICATION'); expect(unsupported.proposal).toBeNull();
  });
  it.each(['crossing', 'zero-edge', 'overlap', 'disconnected', 'complex', 'floor-index', 'cycle', 'setback', 'hole'])('rejects invalid input topology %s', kind => {
    const input = parametricInput();
    if (kind === 'crossing') input.site.boundary = [{ x: 0, z: 0 }, { x: 20000, z: 20000 }, { x: 0, z: 20000 }, { x: 20000, z: 0 }];
    if (kind === 'zero-edge') input.site.boundary[1] = input.site.boundary[0]!;
    if (kind === 'overlap') Object.assign(input.parametricArchitecture, { wings: [{ x: 0 }, { x: 0 }] });
    if (kind === 'disconnected') Object.assign(input.parametricArchitecture, { regions: [[{ x: 0, z: 0 }], [{ x: 90000, z: 0 }]] });
    if (kind === 'complex') input.site.boundary = Array.from({ length: 1000 }, (_, x) => ({ x, z: 0 }));
    if (kind === 'floor-index') Object.assign(input.parametricArchitecture.floors[0]!, { level: 4 });
    if (kind === 'cycle') Object.assign(input, { cyclic: input });
    if (kind === 'setback') input.site.setbacks = [{ boundaryEdgeStart: 0, minimumMm: 2000 }];
    if (kind === 'hole') Object.assign(input.parametricArchitecture, { voids: [input.site.boundary] });
    expect(() => normalizeParametricRequirements(input)).toThrow(BlueprintError);
  });
  it('rejects opening jamb defects, extra voids, roof gaps and unsupported offsets independently', () => {
    const input = parametricInput(true), good = generateParametricBlueprint(input).model;
    for (const mutate of [
      (m: typeof good) => { m.openings[0]!.offsetMm = 0; },
      (m: typeof good) => { m.slabs = m.slabs.filter(s => s.id !== 'roof'); },
      (m: typeof good) => { m.slabs.find(s => s.id === 'slab-0')!.footprint.voids.push([{ x: 12000, z: 4000 }, { x: 13000, z: 4000 }, { x: 13000, z: 5000 }, { x: 12000, z: 5000 }]); },
      (m: typeof good) => { m.levels[1]!.boundary.forEach(p => p.x += 7000); },
      (m: typeof good) => { m.stairs[0]!.footprint.forEach(p => p.x += 2000); },
    ]) { const bad = structuredClone(good); mutate(bad); expect(qa(bad, input).status).toBe('FAIL'); }
  });

});
