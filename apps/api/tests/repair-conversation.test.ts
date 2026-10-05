import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { normalizeBlueprintRequirements, generateBlueprint } from '@designflow/generator';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { initialConversation, planConversation } from '../src/ai/conversation-planner.js';
import type { ConversationMessage, ConversationState } from '../src/contracts/conversations.js';
import { requirements, generatorOptions } from '../../../packages/blueprint-qa/tests/fixtures.js';
const turn = (s: ConversationState, text: string, rest: Partial<ConversationMessage> = {}) => planConversation(s, { messageId: randomUUID(), expectedVersion: s.version, baseRevisionId: s.baseRevisionId, text, ...rest });
const initial = () => initialConversation(null, null, false);
it('retains contradictions through unrelated turns, clearing only explicit resolution', async () => {
  let s = await turn(initial(), '10 by 12 m plot, 2 bedrooms, one floor and two floors');
  expect(s.intent.contradictions).toContain('floors');
  for (const text of ['seed Next', 'one study', 'seed Final']) {
    s = await turn(s, text); expect(s.status).toBe('NEEDS_CLARIFICATION'); expect(s.intent.contradictions).toContain('floors'); expect(s.proposal).toBeNull();
  }
  s = await turn(s, 'answer', { answers: [{ field: 'floors', value: 1 }] });
  expect(s.status).toBe('AWAITING_APPROVAL'); expect(s.intent.contradictions).toEqual([]);
});
it('native replacements resolve only their own contradictory fields', async () => {
  let s = await turn(initial(), '10 by 12 m plot, 2 bedrooms and 3 bedrooms, one floor and two floors');
  s = await turn(s, 'use these values', { nativeUpdate: { rooms: normalizeBlueprintRequirements(requirements()).rooms } });
  expect(s.intent.contradictions).toEqual(['floors']);
});
it.each(['mm', 'ft', 'metres'])('clears mixed depth units for correction to %s', async unit => {
  const s = await turn(initial(), '10 m by 20 ft plot, 2 bedrooms');
  const corrected = await turn(s, `i meant ${unit}`);
  expect(corrected.intent.site?.depthUnit).toBeUndefined();
  expect(corrected.intent.site?.unit).toBe(unit === 'metres' ? 'm' : unit);
  // Tiny mm plots correctly remain infeasible; canonical intent is still corrected.
  if (unit !== 'mm') expect(corrected.requirements?.site.boundary[2]).toEqual(unit === 'ft' ? { x: 3048, z: 6096 } : { x: 10000, z: 20000 });
});
it('clarification units clear the depth override and complete mixed replacements remain explicit', async () => {
  let s = await turn(initial(), '10 m by 20 ft plot, 2 bedrooms');
  s = await turn(s, 'answer', { answers: [{ field: 'site.unit', value: 'm' }] });
  expect(s.requirements?.site.boundary[2]).toEqual({ x: 10000, z: 20000 });
  s = await turn(s, 'answer', { answers: [{ field: 'site.dimensions', value: { width: '30', depth: '12000', unit: 'ft', depthUnit: 'mm' } }] });
  expect(s.requirements?.site.boundary[2]).toEqual({ x: 9144, z: 12000 });
});
it.each(['bedrooms', 'Bedrooms', 'BEDROOMS', 'BeDrOoMs'])('normalizes plural room capture %s', async name => {
  const s = await turn(initialConversation(null, normalizeBlueprintRequirements(requirements()), false), `${name} 3 by 4 m`);
  expect(s.status).toBe('AWAITING_APPROVAL'); expect(s.requirements?.rooms.find(r => r.type === 'bedroom')?.minWidthMm).toBe(3000);
});
it('reduces floors with resolved native room allocation and generates independently accepted geometry', async () => {
  const r = normalizeBlueprintRequirements(requirements(2));
  const s = await turn(initialConversation(null, r, false), 'one floor', { nativeUpdate: { rooms: r.rooms.map(room => ({ ...room, level: 0 })) } });
  expect(s.status).toBe('AWAITING_APPROVAL'); expect(s.requirements?.stair).toBeUndefined();
  const model = generateBlueprint(s.requirements!).model;
  expect(model.levels).toHaveLength(1); expect(model.stairs).toHaveLength(0); expect(auditBlueprint(model, generatorOptions).status).toBe('PASS');
});
it('does not silently relocate explicit upper-floor rooms', async () => {
  const r = normalizeBlueprintRequirements(requirements(2)); r.rooms[0]!.level = 1;
  const s = await turn(initialConversation(null, r, false), 'one floor');
  expect(s.status).toBe('NEEDS_CLARIFICATION'); expect(s.requirements?.floors).toBe(2);
});
it.each(['zero study', 'no study', 'remove study'])('removes optional room intent: %s', async text => {
  const r = normalizeBlueprintRequirements({ ...requirements(), rooms: [...requirements().rooms, { type: 'study', count: 1 }] });
  const s = await turn(initialConversation(null, r, false), text);
  expect(s.status).toBe('AWAITING_APPROVAL'); expect(s.requirements?.rooms.some(room => room.type === 'study')).toBe(false);
  expect(s.requirements?.rooms.every(room => room.count > 0)).toBe(true);
});
it.each(['remove guest room', 'no guest room', 'zero guest rooms'])('does not guess which bedroom is a guest room: %s', async text => {
  const r = normalizeBlueprintRequirements(requirements());
  const s = await turn(initialConversation(null, r, false), text);
  expect(s.status).toBe('NEEDS_CLARIFICATION'); expect(s.requirements).toEqual(r);
});
it('zero count removes explicit relationships to that removed room only', async () => {
  const r = normalizeBlueprintRequirements({ ...requirements(), rooms: [...requirements().rooms, { type: 'study', count: 1 }], relationships: [{ from: { type: 'study', ordinal: 1 }, to: { type: 'living', ordinal: 1 }, kind: 'adjacent', strength: 'hard' }] });
  const s = await turn(initialConversation(null, r, false), 'zero study');
  expect(s.status).toBe('AWAITING_APPROVAL'); expect(s.requirements?.relationships).toEqual([]);
});

it('complete dimension answers permit width-only and depth-only corrections without stale units', async () => {
  let s = await turn(initial(), '10000 mm by 12000 mm plot, 2 bedrooms');
  s = await turn(s, 'answer', { answers: [{ field: 'site.dimensions', value: { width: '30', depth: '12000', unit: 'ft', depthUnit: 'mm' } }] });
  expect(s.requirements?.site.boundary[2]).toEqual({ x: 9144, z: 12000 });
  s = await turn(s, 'answer', { answers: [{ field: 'site.dimensions', value: { width: '9144', depth: '40', unit: 'mm', depthUnit: 'ft' } }] });
  expect(s.requirements?.site.boundary[2]).toEqual({ x: 9144, z: 12192 });
});
