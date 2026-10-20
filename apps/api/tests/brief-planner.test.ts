import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateProgramBlueprint } from '@designflow/generator';
import { initialConversation } from '../src/ai/conversation-planner.js';
import { planBriefConversation } from '../src/ai/brief-planner.js';
import { parseBrief } from '../src/ai/brief-parser.js';
import { toPatch } from '../src/ai/brief-extractor.js';
import { estimateBuilding } from '../src/estimate/building-estimate.js';
import type { ConversationState } from '../src/contracts/conversations.js';

const fresh = () => { const s = initialConversation(null, null, false); s.solver = 'BRIEF'; return s; };
const say = (s: ConversationState, text: string) => planBriefConversation(s, { messageId: randomUUID(), expectedVersion: s.version, baseRevisionId: null, text } as never, {});
const count = (s: ConversationState, kind: string) => s.brief?.spaces.filter(x => x.kind === kind).reduce((n, x) => n + x.count, 0) ?? 0;

describe('offline brief parser', () => {
  it('reads plots, storeys, BHK, en-suites, budget, city and quality from everyday wording', () => {
    const p = parseBrief('Design a 3 floor luxury villa on a 40 x 60 ft plot in Hyderabad with 4 bedrooms each with attached bathroom, a puja room and a car garage. Budget 1.2 crore');
    expect(p).toMatchObject({ mode: 'replace', buildingType: 'villa', floors: 3, site: { widthMm: 12192, depthMm: 18288 }, budgetInr: 12_000_000, city: 'Hyderabad', qualityTier: 'luxury' });
    expect(p.spaces).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'bedroom', count: 4, ensuite: true }), expect.objectContaining({ kind: 'puja', count: 1 }), expect.objectContaining({ kind: 'garage', count: 1 })]));
    expect(p.spaces.some(s => s.kind === 'bathroom')).toBe(false);
    expect(parseBrief('mujhe 3bhk ghar chahiye 30x50 plot pe, G+1')).toMatchObject({ floors: 2, site: { widthMm: 9144, depthMm: 15240 } });
  });
  it('reads edits as modifications and greetings as empty', () => {
    expect(parseBrief('remove the gym and add a guest room')).toMatchObject({ mode: 'modify', remove: ['gym'], add: ['guest'] });
    expect(parseBrief('hi there').empty).toBe(true);
  });
  it('validates model patches against the catalog and drops anything invalid', () => {
    expect(toPatch({ mode: 'replace', spaces: [{ kind: 'bedroom', count: 3 }, { kind: 'spaceship', count: 1 }], site: { width: 30, depth: 40, unit: 'ft' } })).toMatchObject({ spaces: [{ kind: 'bedroom', count: 3 }], site: { widthMm: 9144, depthMm: 12192 } });
    expect(toPatch('nonsense')).toBeNull();
  });
});

describe('brief planner (solver BRIEF)', () => {
  it('turns a rich description into an approvable program proposal with a design summary and estimate', async () => {
    const s = await say(fresh(), 'a G+2 house on 30x50 ft plot with 4 bedrooms, 3 bathrooms, living, kitchen, dining, puja room and parking');
    expect(s.status).toBe('AWAITING_APPROVAL');
    expect(s.proposal?.requirements).toHaveProperty('program');
    expect(s.design?.floors).toBe(3);
    expect(s.design?.estimate.totalInr).toBeGreaterThan(0);
    expect(s.design?.rooms.some(r => r.name === 'Puja room')).toBe(true);
    // The proposal regenerates exactly on approval.
    expect(generateProgramBlueprint(s.proposal!.requirements).model.levels).toHaveLength(3);
  });
  it('assumes a standard plot and floors when the brief gives none, and says so', async () => {
    const s = await say(fresh(), '4 BHK luxury duplex with home theatre and gym in Bangalore');
    expect(s.status).toBe('AWAITING_APPROVAL');
    expect(s.design?.plotAssumed).toBe(true);
    expect(s.explanations.join(' ')).toMatch(/Plot assumed/);
  });
  it('applies follow-up edits to the same brief and keeps the proposal on a general question', async () => {
    let s = await say(fresh(), 'I want a small 2BHK single floor home on 30x40 ft plot');
    expect(s.status).toBe('AWAITING_APPROVAL');
    s = await say(s, 'add a puja room');
    expect(count(s, 'puja')).toBe(1);
    const proposal = s.proposal;
    s = await say(s, 'what flooring is best for kitchens?');
    expect(s.status).toBe('AWAITING_APPROVAL');
    expect(s.proposal).toEqual(proposal);
  });
  it('designs commercial buildings with their typical rooms instead of asking for bedrooms', async () => {
    const s = await say(fresh(), 'a cafe with seating for 40 people, a kitchen and 2 toilets on a 15 x 20 m plot');
    expect(s.status).toBe('AWAITING_APPROVAL');
    expect(s.design?.buildingType).toBe('cafe');
    expect(s.design?.rooms.some(r => r.name.startsWith('Restroom'))).toBe(true);
    expect(s.questions.join(' ')).not.toMatch(/bedroom/i);
  });
  it('asks what to build when nothing design-related was said', async () => {
    const s = await say(fresh(), 'hello');
    expect(s.status).toBe('NEEDS_CLARIFICATION');
    expect(s.questions[0]).toMatch(/What would you like to build/);
  });
});

describe('building estimate', () => {
  it('produces structure sizing, quantities in thumb-rule ranges and a reconciled BOQ', () => {
    const { model } = generateProgramBlueprint({ program: { buildingType: 'house', spaces: [{ kind: 'bedroom', count: 3 }, { kind: 'bathroom', count: 2 }, { kind: 'living', count: 1 }, { kind: 'kitchen', count: 1 }, { kind: 'dining', count: 1 }] },
      site: { boundary: [{ x: 0, z: 0 }, { x: 12000, z: 0 }, { x: 12000, z: 18000 }, { x: 0, z: 18000 }] }, floors: 2 });
    const e = estimateBuilding(model, { tier: 'standard', city: 'Pune', budgetInr: 5_000_000 });
    const perM2 = (n: number) => n / e.areas.builtUpM2;
    expect(perM2(e.quantities.concreteM3)).toBeGreaterThan(0.25); expect(perM2(e.quantities.concreteM3)).toBeLessThan(0.6);
    expect(perM2(e.quantities.steelKg)).toBeGreaterThan(25); expect(perM2(e.quantities.steelKg)).toBeLessThan(60);
    expect(e.summary.subtotalInr).toBe(e.boq.reduce((n, l) => n + l.amountInr, 0));
    expect(e.summary.totalInr).toBe(e.summary.subtotalInr + e.summary.contractorMarginInr + e.summary.contingencyInr + e.summary.gstInr);
    expect(e.summary.perSqftInr).toBeGreaterThan(1200); expect(e.summary.perSqftInr).toBeLessThan(4500);
    expect(e.structure.slab.thicknessMm).toBeGreaterThanOrEqual(125);
    expect(e.budget?.status).toMatch(/WITHIN|TIGHT|OVER/);
  });
});
