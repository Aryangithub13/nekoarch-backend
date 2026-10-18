import { describe, expect, it } from 'vitest';
import { FeasibilityRequestSchema } from '../src/feasibility/contracts.js';
import { assessFeasibility, readText } from '../src/feasibility/assess.js';
import { MODEL_LIMITS } from '../src/engineering/capability-limits.js';

const P = '00000000-0000-4000-8000-0000000000bb', R = '00000000-0000-4000-8000-0000000000cc';
const assess = (body: unknown) => assessFeasibility(P, FeasibilityRequestSchema.parse(body));
const byId = (a: ReturnType<typeof assess>, id: string) => a.constraints.find(c => c.constraintId === id)!;

describe('B42 feasibility: reading the ambition', () => {
  it('reads only explicit numbers with explicit units, and typed concept features', () => {
    const r = readText('A 60-storey twisting glass tower, 250 m tall, with a 12 m cantilever and a 30 m column-free span, 8 bedrooms');
    expect([r.storeys?.value, r.rooms?.value, r.heightMm?.value, r.cantileverMm?.value, r.maxSpanMm?.value]).toEqual([60, 8, 250_000, 12_000, 30_000]);
    expect(r.features.map(f => f.feature).sort()).toEqual(['FULL_GLASS_ENVELOPE', 'TWISTING_OR_ROTATING_FORM']);
    expect(readText('a very tall, huge house').heightMm).toBeNull(); // adjectives are never turned into numbers
    expect(readText('100 ft high').heightMm?.value).toBe(30_480);
  });
});

describe('B42 feasibility: classification against enforced limits only', () => {
  it('keeps a request within the engine scope as-is, still claiming nothing', () => {
    const a = assess({ text: 'A 2 storey house with 6 rooms' });
    expect(a.status).toBe('WITHIN_ENGINE_SCOPE');
    expect(a.constraints.map(c => [c.constraintId, c.classification])).toEqual([['STOREYS', 'WITHIN_ENGINE_SCOPE'], ['ROOMS', 'WITHIN_ENGINE_SCOPE']]);
    expect(a.alternatives.map(x => [x.alternativeId, x.status, x.applied])).toEqual([['AS_REQUESTED', 'PROPOSED_FOR_CONSENT', false]]);
    expect(a.claims).toEqual({ buildability: 'NOT_CLAIMED', engineeringFeasibility: 'NOT_CLAIMED', codeCompliance: 'NOT_CLAIMED', professionalReview: 'NOT_PERFORMED' });
    expect(a.ladder.find(s => s.stage === 'PROFESSIONAL_REVIEW')!.status).toBe('NOT_PERFORMED');
  });
  it('cites the enforced limit that refuses a quantity, and proposes bounded alternatives with what each gives up', () => {
    const a = assess({ text: 'A 60-storey twisting glass tower with a 12 m cantilever' });
    const storeys = byId(a, 'STOREYS');
    expect(storeys).toMatchObject({ classification: 'EXCEEDS_ENGINE_LIMIT', limit: { limitId: 'GENERATION_MAX_FLOORS', requested: 60,
      value: MODEL_LIMITS.find(l => l.limitId === 'GENERATION_MAX_FLOORS')!.value } });
    expect(byId(a, 'CANTILEVER')).toMatchObject({ classification: 'REQUIRES_PROFESSIONAL_REVIEW', limit: null, value: 12_000 });
    expect(byId(a, 'CANTILEVER').unverifiedDomains).toContain('MEMBER_DESIGN');
    expect(byId(a, 'TWISTING_OR_ROTATING_FORM').classification).toBe('CONCEPT_ONLY');
    expect(a.separation.conceptOnly.sort()).toEqual(['FULL_GLASS_ENVELOPE', 'TWISTING_OR_ROTATING_FORM']);
    expect(a.separation.feasibilityAssessed).not.toContain('TWISTING_OR_ROTATING_FORM');
    expect(a.alternatives.map(x => x.alternativeId)).toEqual(['BOUNDED_GENERATION', 'SUPPLIED_MODEL_ASSESSMENT', 'CONCEPT_ONLY']);
    const bounded = a.alternatives[0]!;
    expect(bounded.givesUp).toEqual(expect.arrayContaining(['STOREYS reduced from 60 to 2 (GENERATION_MAX_FLOORS)', 'TWISTING_OR_ROTATING_FORM: rectilinear, straight-edged geometry instead']));
    expect(bounded.keeps).toContain('CANTILEVER 12000 mm (as a stated intent; not engineered)');
    expect(a.ladder.map(s => [s.stage, s.status])).toEqual([['CONCEPT', 'AVAILABLE'], ['BOUNDED_GEOMETRY', 'PARTIAL'], ['ENGINEERING_EVIDENCE', 'PARTIAL'],
      ['PROFESSIONAL_REVIEW', 'NOT_PERFORMED']]);
  });
  it('blocks geometry beyond the model maximum at every geometry stage', () => {
    const a = assess({ declared: { storeys: 400 } });
    expect(byId(a, 'STOREYS').limit!.limitId).toBe('BUILDING_MODEL_MAX_LEVELS');
    expect(a.alternatives.some(x => x.alternativeId === 'SUPPLIED_MODEL_ASSESSMENT')).toBe(false);
    expect(a.ladder.filter(s => s.status === 'BLOCKED').map(s => s.stage)).toEqual(['BOUNDED_GEOMETRY', 'ENGINEERING_EVIDENCE']);
  });
  it('never voids a lock: an alternative that regenerates geometry is blocked by a geometry lock on the base revision', () => {
    const a = assess({ text: 'Make it a 5 storey curved building', baseRevisionId: R, preserve: ['FLOOR_PLANS', 'EXTERIOR_APPEARANCE'] });
    expect(a.alternatives.find(x => x.alternativeId === 'BOUNDED_GENERATION')).toMatchObject({ status: 'BLOCKED_BY_LOCK', lockConflicts: ['FLOOR_PLANS'] });
    expect(a.alternatives.find(x => x.alternativeId === 'CONCEPT_ONLY')!.status).toBe('PROPOSED_FOR_CONSENT');
  });
  it('declared values override the text, and the assessment is deterministic', () => {
    const a = assess({ text: 'a 10 storey block', declared: { storeys: 2 } });
    expect(byId(a, 'STOREYS')).toMatchObject({ source: 'DECLARED', value: 2, classification: 'WITHIN_ENGINE_SCOPE' });
    expect(assess({ text: 'a 10 storey block', declared: { storeys: 2 } })).toEqual(a);
    expect(() => FeasibilityRequestSchema.parse({ text: '  ' })).toThrow();
  });
});
