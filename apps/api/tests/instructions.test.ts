import { describe, expect, it } from 'vitest';
import type { BuildingModelV2 } from '@designflow/shared';
import { authored, generated } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { ChangeSetSchema } from '../src/contracts/integration.js';
import { classifyIntent, normalize, parseFinishes } from '../src/instructions/grammar.js';
import { groundLevels } from '../src/instructions/ground.js';
import { resolveInstruction, type HistoryEntry } from '../src/instructions/resolve.js';

const P = '00000000-0000-4000-8000-0000000000aa', R1 = '00000000-0000-4000-8000-000000000001', R2 = '00000000-0000-4000-8000-000000000002';
const HASH = 'a'.repeat(64);
const history: HistoryEntry[] = [{ id: R1, revisionNumber: 1, parentRevisionId: null }, { id: R2, revisionNumber: 2, parentRevisionId: R1 }];
const facts = { projectId: P, revisionId: R2, revisionNumber: 2, parentRevisionId: R1, modelHash: HASH };
const resolve = (text: string, model: BuildingModelV2 = generated()) => resolveInstruction(text, model, facts, history);
const ids = (r: ReturnType<typeof resolve>) => r.changeSetDraft?.changes.map(c => c.elementId) ?? null;

describe('B41 grammar: intents, finishes and normalization', () => {
  it('distinguishes the seven action kinds, in a fixed rule order', () => {
    const cases: [string, string][] = [['Change the kitchen floor to vinyl', 'EDIT_EXISTING'], ['Render a photorealistic image of the façade', 'REGENERATE_VISUAL_DERIVATIVE'],
      ['Try another exterior', 'DERIVE_ALTERNATIVE'], ['Recalculate the cost estimate', 'RECOMPUTE_ENGINEERING'], ['Undo that', 'RESTORE_PRIOR'],
      ['Compare this with revision 1', 'COMPARE_REVISIONS'], ['Start a new project', 'NEW_PROJECT'], ['hello there', 'UNRECOGNIZED'],
      ['Reuse the previous floor plan', 'RESTORE_PRIOR'], ['What changed since the original?', 'COMPARE_REVISIONS']];
    for (const [text, intent] of cases) expect(classifyIntent(normalize(text)), text).toBe(intent);
  });
  it('maps only catalog finishes, pairs surfaces clause by clause, and asks when a finish fits several surfaces', () => {
    expect(parseFinishes(normalize('the floor to stone tile and the walls to warm neutral')).finishes.map(f => [f.surface, f.finish]))
      .toEqual([['floor', 'stone-tile'], ['walls', 'paint-warm-neutral']]);
    expect(parseFinishes(normalize('walls and ceiling white')).finishes.map(f => [f.surface, f.finish])).toEqual([['walls', 'paint-white'], ['ceiling', 'paint-white']]);
    expect(parseFinishes(normalize('carpet the bedroom')).finishes).toEqual([{ surface: 'floor', finish: 'carpet', phrase: 'carpet the bedroom' }]);
    expect(parseFinishes(normalize('make it white')).questions[0]).toMatch(/walls or ceiling/);
    expect(parseFinishes(normalize('the second floor bedroom')).finishes).toEqual([]); // a storey, never the floor surface
    expect(parseFinishes(normalize('floor in marble')).unsupported[0]!.code).toBe('FINISH_NOT_IN_CATALOG');
  });
});

describe('B41 grounding in stable element ids', () => {
  const twoStorey = { levels: [{ id: 'g', name: 'Ground', index: 0, kind: 'storey' }, { id: 'u', name: 'Upper', index: 1, kind: 'storey' }], spaces: [] } as unknown as BuildingModelV2;
  it('offers both readings of "first floor" and resolves the readings that exist', () => {
    const [first] = groundLevels(normalize('the first floor kitchen'), twoStorey);
    expect(first).toMatchObject({ resolution: 'AMBIGUOUS', candidates: [{ elementId: 'g' }, { elementId: 'u' }] });
    expect(groundLevels(normalize('second floor'), twoStorey)[0]).toMatchObject({ resolution: 'EXACT', elementIds: ['u'] });
    expect(groundLevels(normalize('ground floor'), twoStorey)[0]).toMatchObject({ resolution: 'EXACT', elementIds: ['g'] });
    expect(groundLevels(normalize('upstairs'), twoStorey)[0]).toMatchObject({ resolution: 'EXACT', elementIds: ['u'] });
    expect(groundLevels(normalize('third floor'), twoStorey)[0]).toMatchObject({ resolution: 'NOT_FOUND' });
  });
  it('resolves a compass reference by centroid along recorded site north, and refuses it when north is not recorded', () => {
    // generated(): north 0° (north is -z); bedroom-1 spans z 100–4050, bedroom-2 z 4050–7950.
    const north = resolve('Carpet the north bedroom');
    expect([north.status, ids(north)]).toEqual(['RESOLVED', ['space-bedroom-1']]);
    expect(north.targets[0]!.basis.join(' ')).toMatch(/NORTH_FROM_MINUS_Z_CLOCKWISE_TO_PLUS_X/);
    expect(ids(resolve('Carpet the south bedroom'))).toEqual(['space-bedroom-2']);
    const noNorth = { ...authored(), spaces: [...authored().spaces, { ...authored().spaces[1]!, id: 'studio-2', name: 'Studio 2' }] } as BuildingModelV2;
    const r = resolve('Give the south studio a vinyl floor', noNorth);
    expect(r.status).toBe('NEEDS_CLARIFICATION');
    expect(r.clarifications.join(' ')).toMatch(/Site north is not recorded/);
  });
});

describe('B41 resolution: change sets, locks, exclusions and typed refusals', () => {
  it('"change only the kitchen floor" resolves to one B40 finish change that locks everything else, without executing', () => {
    const r = resolve('Change only the kitchen floor to stone tile');
    expect(r).toMatchObject({ intent: 'EDIT_EXISTING', status: 'RESOLVED', module: 'INTERIOR', executed: false, finishes: [{ surface: 'floor', finish: 'stone-tile' }],
      handoff: { method: 'POST', route: `/api/projects/${P}/integration/plans` } });
    expect(ids(r)).toEqual(['space-kitchen-1']);
    expect(ChangeSetSchema.parse(r.changeSetDraft).preserve.map(p => p.scope).sort()).toEqual(['BUILDING_DIMENSIONS', 'BUILDING_GEOMETRY', 'EXTERIOR_APPEARANCE', 'FLOOR_PLANS',
      'OPENINGS', 'ROOMS', 'STAIRS', 'STRUCTURE', 'WALLS']);
    expect(r.changeSetDraft!.changes[0]!.properties).toEqual({ finishes: { floor: 'stone-tile' } });
    expect(resolve('Change only the kitchen floor to stone tile')).toEqual(r); // deterministic
  });
  it('asks which room when a singular noun matches several, and lists the candidates', () => {
    const r = resolve('Make the bedroom floor carpet');
    expect([r.status, r.changeSetDraft, r.handoff]).toEqual(['NEEDS_CLARIFICATION', null, null]);
    expect(r.targets[0]).toMatchObject({ resolution: 'AMBIGUOUS', candidates: [{ elementId: 'space-bedroom-1' }, { elementId: 'space-bedroom-2' }] });
  });
  it('applies "except" to the targets and pairs several surfaces', () => {
    const r = resolve('Give all bedrooms except bedroom 2 vinyl floors and paint the walls cool grey');
    expect(r.status).toBe('RESOLVED');
    expect(ids(r)).toEqual(['space-bedroom-1']);
    expect(r.exclusions[0]).toMatchObject({ resolution: 'EXACT', elementIds: ['space-bedroom-2'] });
    expect(r.changeSetDraft!.changes[0]!.properties).toEqual({ finishes: { floor: 'vinyl', walls: 'paint-cool-grey' } });
  });
  it('reports a stated lock that forbids the edit as a conflict, never overriding it', () => {
    const r = resolve('Keep the interiors as they are and change the kitchen floor to vinyl');
    expect([r.status, r.conflicts[0]?.code, r.changeSetDraft]).toEqual(['NEEDS_CLARIFICATION', 'LOCK_CONFLICT', null]);
  });
  it('refuses non-catalog finishes, geometry edits and exterior edits with typed codes and a handoff to the module that owns them', () => {
    expect(resolve('Change the kitchen floor to marble').unsupported[0]!.code).toBe('FINISH_NOT_IN_CATALOG');
    const grow = resolve('Enlarge the kitchen');
    expect([grow.status, grow.module, grow.unsupported[0]!.code, grow.handoff?.route]).toEqual(['UNSUPPORTED', 'BLUEPRINT', 'ELEMENT_GEOMETRY_NOT_SUPPORTED',
      `/api/projects/${P}/specialists/BLUEPRINT/requests`]);
    expect(grow.targets[0]).toMatchObject({ resolution: 'EXACT', elementIds: ['space-kitchen-1'] });
    // ROADMAP A1's example: the locks are extracted, the façade change is handed to the Exterior specialist.
    const facade = resolve('Keep the structure and floor plans; redesign only the glass façade. Preserve everything else.');
    expect([facade.status, facade.module, facade.unsupported[0]!.code]).toEqual(['UNSUPPORTED', 'EXTERIOR', 'EXTERIOR_EDIT_NOT_RESOLVED_HERE']);
    expect(facade.locks.map(l => l.scope)).toEqual(expect.arrayContaining(['STRUCTURE', 'FLOOR_PLANS']));
  });
  it('grounds restore, comparison and recompute in the revision history and hands off to the existing routes', () => {
    expect(resolve('Undo that').handoff).toMatchObject({ route: `/api/projects/${P}/revision-operations`,
      body: { baseRevisionId: R2, request: { operation: { kind: 'RESTORE', sourceRevisionId: R1 } } } });
    expect(resolve('Reuse the previous floor plan').unsupported[0]!.code).toBe('PARTIAL_RESTORE_NOT_SUPPORTED');
    expect(resolve('Restore revision 7').clarifications[0]).toMatch(/No revision matches 'revision 7'/);
    expect(resolve('Compare this with the original version').handoff).toMatchObject({ route: `/api/projects/${P}/revisions/${R2}/verification/diff`, body: { otherRevisionId: R1 } });
    expect(resolve('Recalculate the cost').handoff).toMatchObject({ route: `/api/projects/${P}/specialists/BUDGET/requests` });
    expect(resolve('Render a walkthrough video').unsupported[0]!.code).toBe('NO_RENDER_PROVIDER');
    expect(resolve('Try another exterior').handoff).toMatchObject({ body: { scope: 'EXTERIOR' } });
    expect(resolve('Start a new project').handoff).toMatchObject({ route: '/api/projects' });
    expect(resolve('blah').status).toBe('NEEDS_CLARIFICATION');
  });
  it('grounds an exact space name on a model without room types', () => {
    const r = resolve('Change the foyer floor to engineered timber', authored());
    expect([r.status, ids(r)]).toEqual(['RESOLVED', ['foyer']]);
  });
});

describe('B41 keep clauses', () => {
  it('reads what follows a keep clause as a request, and the keep clause as locks', () => {
    const r = resolve('Keep the structure as it is and change the kitchen floor to vinyl');
    expect([r.status, ids(r)]).toEqual(['RESOLVED', ['space-kitchen-1']]);
    expect(r.locks.map(l => [l.scope, l.source])).toEqual([['STRUCTURE', 'KEEP']]);
    const conflict = resolve('Keep the interiors as they are and change the kitchen floor to vinyl');
    expect(conflict.targets[0]).toMatchObject({ elementIds: ['space-kitchen-1'] });
    expect(conflict.conflicts.map(c => c.code)).toEqual(['LOCK_CONFLICT']);
  });
});
