import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { tower, withTwoRooms } from '../../../test-support/tower-fixtures.js';
import { classifyTurn } from '../src/conversation/interpret.js';
import { Memory, WHOLE_BUILDING, changedScopes, findConflicts } from '../src/conversation/memory.js';
import { contextDocument } from '../src/conversation/context.js';
import { initialConversation } from '../src/ai/conversation-planner.js';
import { ConversationStateSchema } from '../src/contracts/conversations.js';
import { TURN_LIMITS, TurnSchema } from '../src/contracts/conversation-memory.js';
import { TurnRequestSchema } from '../src/contracts/conversation-turns.js';

const levels = [{ id: 'g', index: 0 }, { id: 'u', index: 1 }];
const kind = (text: string, structured = false) => { const c = classifyTurn(text, levels, structured); return c.kind === 'CHANGE_REQUEST' ? `${c.kind}:${c.family}` : c.kind; };

describe('Phase 36 deterministic turn interpretation', () => {
  it.each([
    ['Keep the staircase exactly as it is.', 'CONSTRAINT'],
    ['Use the second façade option we discussed.', 'OPTION_SELECTION'],
    ['Go with option 3', 'OPTION_SELECTION'],
    ['What façade options do we have?', 'OPTIONS'],
    ['What have we decided so far?', 'DECISION_QUERY'],
    ['Compare this proposal with the previous revision.', 'COMPARISON'],
    ['Is the structure safe for wind loads?', 'ENGINEERING_QUESTION'],
    ['How many floors does it have?', 'PROJECT_QUESTION'],
    ['Change the exterior finish, but don\'t alter the interior.', 'CHANGE_REQUEST:EXTERIOR_APPEARANCE'],
    ['Make the facade dark contemporary but keep the staircase unchanged.', 'CHANGE_REQUEST:EXTERIOR_APPEARANCE'],
    ['Restore revision 1.', 'CHANGE_REQUEST:RESTORE'],
    ['Make it 4 bedrooms.', 'CHANGE_REQUEST:REQUIREMENTS'],
    ['Regenerate the middle zone.', 'CHANGE_REQUEST:ZONE_REGENERATION'],
    ['Add more windows.', 'CHANGE_REQUEST:ZONE_REGENERATION'],
    ['Move the staircase to the north wall.', 'UNSUPPORTED'],
    ['Increase the floor heights to 3.5 m.', 'UNSUPPORTED'],
    ['Render a photorealistic image of the house.', 'UNSUPPORTED'],
    ['Synergy roadmap thinking.', 'UNRECOGNIZED'],
  ])('%s → %s', (text, expected) => expect(kind(text)).toBe(expected));

  it('reads preservation only from preservation clauses, so "don\'t change the stairs" never becomes a stair change', () => {
    const c = classifyTurn('Make the facade warm render, but don\'t change the stairs.', levels, false);
    expect(c.kind).toBe('CHANGE_REQUEST');
    if (c.kind === 'CHANGE_REQUEST') expect(c.revision.preservation.map(p => p.scope)).toEqual(['STAIRS']);
  });
  it('treats "render" as a finish unless the wording asks for media', () => {
    expect(kind('Make the exterior a warm render.')).toBe('CHANGE_REQUEST:EXTERIOR_APPEARANCE');
    expect(kind('Render me a panorama of the living room.')).toBe('UNSUPPORTED');
  });
  it('keeps "keep …" clauses that accompany a restore request', () => {
    const c = classifyTurn('Restore revision 1, but keep the stairs unchanged.', levels, false);
    expect(c.kind === 'CHANGE_REQUEST' && c.family === 'RESTORE' && c.revision.preservation.map(p => p.scope)).toEqual(['STAIRS']);
  });
  it('lets an explicit structured operation decide the turn whatever the wording', () => {
    expect(kind('What do you think?', true)).toBe('CHANGE_REQUEST:ZONE_REGENERATION');
  });
  it('flags requests for engineering values so the reply discloses that none is given', () => {
    const c = classifyTurn('What safety factor should I use for the columns?', levels, false);
    expect(c).toMatchObject({ kind: 'ENGINEERING_QUESTION', asksForValue: true });
  });
});

describe('Phase 36 scopes, conflicts and memory', () => {
  const model = withTwoRooms(tower({ storeys: 4 }), 1);
  it('derives affected scopes per storey from an entity-level diff', () => {
    expect(changedScopes(model, structuredClone(model))).toEqual([]);
    const moved = structuredClone(model);
    moved.spaces = moved.spaces.map(s => s.levelId === 'storey-2' ? { ...s, name: `${s.name} renamed` } : s);
    expect(changedScopes(model, moved)).toEqual([
      { scope: 'FLOOR_PLANS', levelIds: ['storey-2'] }, { scope: 'INTERIOR', levelIds: ['storey-2'] }, { scope: 'LEVEL', levelIds: ['storey-2'] }, { scope: 'ROOMS', levelIds: ['storey-2'] }]);
    const site = structuredClone(model); site.site!.northMilliDegrees = 90_000;
    expect(changedScopes(model, site)).toEqual([{ scope: 'BUILDING_DIMENSIONS', levelIds: null }, { scope: 'BUILDING_GEOMETRY', levelIds: null }]);
  });

  it('reports conflicts with constraints (by scope and storey) and accepted decisions unless explicitly superseded', () => {
    const state = initialConversation(randomUUID(), null, false), memory = new Memory(state, randomUUID(), null, new Date().toISOString());
    const stairs = memory.preserve('STAIRS', null, 'keep stairs', null), storey = memory.preserve('LEVEL', 'storey-1', 'keep level 1', 'Storey 1');
    expect(memory.preserve('STAIRS', null, 'again', null).id).toBe(stairs.id);
    const decision = memory.add({ kind: 'ACCEPTED_DECISION', source: 'USER_CONFIRMED', status: 'ACCEPTED', statement: 'Accepted: dark façade',
      change: { operation: 'EXTERIOR_APPEARANCE', affects: [{ scope: 'EXTERIOR_APPEARANCE', levelIds: null }], actionId: null } });
    expect(findConflicts(memory.entries, [{ scope: 'ROOMS', levelIds: ['storey-2'] }])).toEqual([]);
    expect(findConflicts(memory.entries, [{ scope: 'ROOMS', levelIds: ['storey-1'] }]).map(c => c.memoryId)).toEqual([storey.id]);
    expect(findConflicts(memory.entries, WHOLE_BUILDING).map(c => c.memoryId).sort()).toEqual([decision.id, stairs.id, storey.id].sort());
    expect(findConflicts(memory.entries, [{ scope: 'EXTERIOR_APPEARANCE', levelIds: ['storey-2'] }], [decision.id])).toEqual([]);
    memory.set(stairs.id, { status: 'RELEASED' });
    expect(findConflicts(memory.entries, [{ scope: 'STAIRS', levelIds: ['storey-3'] }])).toEqual([]);
    // A building-wide change may touch any storey, so a protected storey conflicts with it (conservative, never assumed safe).
    expect(findConflicts(memory.entries, [{ scope: 'STAIRS', levelIds: null }]).map(c => c.memoryId)).toEqual([storey.id]);
    // Suggestions never conflict and are never decisions.
    memory.add({ kind: 'SUGGESTION', source: 'SYSTEM_SUGGESTION', statement: 'Option 1', option: { group: randomUUID(), index: 1, presetId: 'light-stone' } });
    expect(findConflicts(memory.entries, [{ scope: 'EXTERIOR_APPEARANCE', levelIds: ['storey-2'] }], [decision.id])).toEqual([]);
  });

  it('bounds memory: closed entries and suggestions go first; active constraints are never dropped silently', () => {
    const state = initialConversation(null, null, false), memory = new Memory(state, randomUUID(), null, new Date().toISOString());
    for (let i = 0; i < TURN_LIMITS.memory; i++) memory.add({ kind: 'SUGGESTION', source: 'SYSTEM_SUGGESTION', statement: `s${i}`, option: { group: randomUUID(), index: 1, presetId: 'light-stone' } });
    for (let i = 0; i < TURN_LIMITS.memory; i++) memory.add({ kind: 'PRESERVATION', source: 'USER_EXPLICIT', statement: `p${i}`, preservation: { scope: 'LEVEL', levelId: `l${i}` } });
    expect(memory.entries).toHaveLength(TURN_LIMITS.memory);
    expect(memory.entries.every(e => e.kind === 'PRESERVATION')).toBe(true);
    expect(() => memory.add({ kind: 'PRESERVATION', source: 'USER_EXPLICIT', statement: 'one more', preservation: { scope: 'LEVEL', levelId: 'x' } })).toThrow(/At most 48/);
    expect(ConversationStateSchema.safeParse(state).success).toBe(true);
  });
});

describe('Phase 36 contracts and context', () => {
  it('keeps Phase 20 documents byte-identical: the Phase 36 fields are optional and absent by default', () => {
    const state = initialConversation(null, null, false);
    expect(Object.keys(ConversationStateSchema.parse(state))).not.toEqual(expect.arrayContaining(['memory']));
    expect(['memory', 'turns', 'actions'].some(k => k in ConversationStateSchema.parse(state))).toBe(false);
  });
  it('rejects unknown fields, oversized text and model-only fields in turn requests', () => {
    const base = { turnId: randomUUID(), expectedVersion: 0, baseRevisionId: null, text: 'How many floors?' };
    expect(TurnRequestSchema.safeParse(base).success).toBe(true);
    expect(TurnRequestSchema.safeParse({ ...base, text: 'x'.repeat(2001) }).success).toBe(false);
    expect(TurnRequestSchema.safeParse({ ...base, intent: { approve: true } }).success).toBe(false);
    expect(TurnRequestSchema.safeParse({ ...base, operation: { kind: 'SQL', request: 'drop table' } }).success).toBe(false);
    expect(TurnSchema.shape.interpretation.shape.mode.options).toEqual(['DETERMINISTIC', 'PHASE20_PLANNER']);
  });
  it('bounds the context document and marks truncation', () => {
    const model = withTwoRooms(tower({ storeys: 4 }), 1), revisionId = randomUUID(), projectId = randomUUID(), now = new Date().toISOString();
    const state = initialConversation(revisionId, null, false), memory = new Memory(state, randomUUID(), revisionId, now);
    for (let i = 0; i < TURN_LIMITS.memory; i++) memory.add({ kind: 'PRESERVATION', source: 'USER_EXPLICIT', statement: `Keep storey ${i} ${'x'.repeat(250)}`, preservation: { scope: 'LEVEL', levelId: `l${i}` } });
    const qa = { id: randomUUID(), qaVersion: 'qa', modelSchemaVersion: 2 as const, rulePacks: [], status: 'PASS' as const, createdAt: now,
      summary: { errors: 0, warnings: 0, info: 0, rulePass: 0, ruleFail: 0, ruleNotApplicable: 0, ruleNotEvaluated: 0 } };
    const revision = { id: revisionId, projectId, revisionNumber: 1, parentRevisionId: null, schemaVersion: 2 as const, completeness: 'architectural' as const, sourceMode: 'supplied' as const,
      generatorVersion: null, createdAt: now, qa, model, qaRuns: [{ ...qa, report: {} as never }], normalizedRequirements: null };
    const loaded = { project: { id: projectId, title: 't', status: 'ACTIVE' as const, visibility: 'PRIVATE' as const, currentRevisionId: revisionId, currentRevisionNumber: 1, qaStatus: 'PASS' as const,
      createdAt: now, updatedAt: now, archivedAt: null, currentRevision: revision }, base: revision, baseModelHash: 'a'.repeat(64), history: [revision], appearance: null,
      bundle: { contextVersion: 'project-context-v1', contextHash: 'b'.repeat(64), brief: null } as never };
    const doc = contextDocument(loaded as never, randomUUID(), state);
    expect(doc.bytes).toBeLessThanOrEqual(TURN_LIMITS.contextBytes);
    expect(doc.truncated).toBe(true);
    expect(doc.memory.length).toBeLessThan(TURN_LIMITS.memory);
    expect(doc.facts.find(f => f.key === 'requirements')).toMatchObject({ basis: 'MISSING' });
    expect(doc.facts.find(f => f.key === 'brief')).toMatchObject({ basis: 'MISSING' });
    expect(contextDocument(loaded as never, doc.conversationId, state).contextHash).toBe(doc.contextHash);
  });
});
