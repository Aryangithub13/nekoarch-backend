import { performance } from 'node:perf_hooks';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CreatePlanRequestSchema, PlanSchema, type FurnKind } from '@designflow/shared';
import { generatePlan, parseRequirements, assertPlanInvariants, GenerationError, furnitureFootprint, validateGenerationInput } from '../src/index.js';
import { containsRect, deriveOpenings, rectanglesOverlap } from '../src/geometry.js';
import { layoutCandidates, LAYOUT_LIMITS } from '../src/layout.js';

const input = () => parseRequirements('2BHK modern flat with open kitchen');
const primary: Record<string, FurnKind> = { bedroom: 'bed', living: 'sofa', kitchen: 'counter', dining: 'table', study: 'desk' };

function verifyGenerated(requirements: ReturnType<typeof input>, seed: string) {
  const plan = generatePlan(requirements, { seed });
  expect(PlanSchema.parse(plan)).toEqual(plan);
  expect(CreatePlanRequestSchema.parse({ plan }).plan).toEqual(plan);
  expect(plan.id).toBeUndefined();
  assertPlanInvariants(plan, requirements);
  for (const room of plan.rooms) {
    const kind = primary[room.type];
    if (kind) expect(plan.furn.some(item => item.kind === kind && containsRect(room.rect, furnitureFootprint(item)))).toBe(true);
  }
  return plan;
}

describe('complete normalization, layout, furniture and validation pipeline', () => {
  it('turns the PRD example into the canonical, saveable Plan without extending its contract', () => {
    const requirements = input();
    const plan = verifyGenerated(requirements, 'example');
    expect(plan.rooms.filter(room => room.type === 'bedroom')).toHaveLength(2);
    expect(plan.rooms.filter(room => room.type === 'circulation')).toHaveLength(1);
    const types = new Map(plan.rooms.map(room => [room.id, room.type]));
    expect(deriveOpenings(plan.rooms, plan.walls).some(opening =>
      opening.roomIds.length === 2 && opening.roomIds.map(id => types.get(id)).sort().join(':') === 'kitchen:living')).toBe(true);
  });

  it.each(Array.from({ length: 8 }, (_, i) => i + 1))('generates a valid %i BHK residential layout', count => {
    verifyGenerated(parseRequirements(`${count}BHK home`), `bhk-${count}`);
  });

  it.each(['bedroom', 'bathroom', 'living room', 'kitchen', 'dining room', 'study'])('generates the minimum 3m × 3m single %s footprint', type => {
    const requirements = parseRequirements(`3m x 3m one ${type}`);
    const plan = verifyGenerated(requirements, 'minimum');
    expect(plan.rooms).toHaveLength(1); expect(plan.rooms[0]!.rect).toEqual(requirements.bounds);
  });

  it.each([{ w: 3, d: 60 }, { w: 60, d: 3 }, { w: 7.6, d: 9.6 }, { w: 9.6, d: 7.6 }])('handles unusual and boundary aspect ratios $w × $d', bounds => {
    const requirements = validateGenerationInput({ prompt: 'Two bedrooms', bounds: { x: 0, z: 0, ...bounds }, rooms: [{ type: 'bedroom', count: 2 }] });
    verifyGenerated(requirements, 'aspect');
  });

  it('supports maximum dimensions and 24 rooms across all supported residential room types', () => {
    const requirements = validateGenerationInput({ prompt: 'Large residential layout', bounds: { x: 1_000, z: -1_000, w: 60, d: 60 },
      rooms: ['bedroom', 'bathroom', 'living', 'kitchen', 'dining', 'study'].map(type => ({ type, count: 4 })) });
    const plan = verifyGenerated(requirements, 'maximum');
    expect(plan.rooms.filter(room => room.type !== 'circulation')).toHaveLength(24);
  });

  it('reproduces byte-identical plans with and without explicit seeds', () => {
    const requirements = input();
    for (const options of [{}, { seed: 'repeatable-seed', variant: 1 }, { seed: 'घर-🏠', variant: 2_147_483_647 }]) {
      const first = JSON.stringify(generatePlan(requirements, options));
      for (let i = 0; i < 12; i++) expect(JSON.stringify(generatePlan(requirements, options))).toBe(first);
    }
  });

  it('uses seeds and variants for actual geometry variation, not just metadata', () => {
    const shapes = new Set<string>();
    const variants = new Set<string>();
    for (let i = 1; i <= 10; i++) {
      const seeded = generatePlan(input(), { seed: `seed-${i}` });
      const varied = generatePlan(input(), { seed: 'constant', variant: i });
      shapes.add(JSON.stringify([seeded.rooms, seeded.walls]));
      variants.add(JSON.stringify([varied.rooms, varied.walls]));
    }
    expect(shapes.size).toBeGreaterThan(1); expect(variants.size).toBeGreaterThan(1);
  });

  it('does not mutate input/options or leak mutable state between invocations', () => {
    const requirements = input(); const original = structuredClone(requirements);
    Object.freeze(requirements.bounds); requirements.rooms.forEach(Object.freeze); Object.freeze(requirements.rooms);
    requirements.adjacency.forEach(Object.freeze); Object.freeze(requirements.adjacency); Object.freeze(requirements);
    const options = Object.freeze({ seed: 'immutable', variant: 2 });
    const generated = generatePlan(requirements, options);
    const before = JSON.stringify(generated);
    generated.rooms[0]!.name = 'mutated'; generated.bounds.w = 1;
    expect(JSON.stringify(generatePlan(requirements, options))).toBe(before);
    expect(requirements).toEqual(original);
  });

  it('satisfies an explicit chain of direct adjacency requirements', () => {
    const requirements = validateGenerationInput({ prompt: 'Connected residential rooms', bounds: { x: -20, z: 10, w: 12, d: 16 },
      rooms: [{ type: 'living', count: 1 }, { type: 'kitchen', count: 1 }, { type: 'dining', count: 1 }, { type: 'bedroom', count: 1 }],
      adjacency: [{ from: 'living', to: 'kitchen' }, { from: 'kitchen', to: 'dining' }] });
    verifyGenerated(requirements, 'chain');
  });

  it('checks geometry independently across 80 seeds, decimal footprints and translations', () => {
    for (let i = 0; i < 80; i++) {
      const requirements = validateGenerationInput({ ...parseRequirements(`${1 + i % 8}BHK home with open kitchen`),
        bounds: { x: -999.999999 + i, z: 0.123456, w: 16.333333 + (i % 4), d: 40.777779 } });
      const plan = verifyGenerated(requirements, `sweep-${i}`);
      for (let a = 0; a < plan.rooms.length; a++) {
        for (let b = a + 1; b < plan.rooms.length; b++) expect(rectanglesOverlap(plan.rooms[a]!.rect, plan.rooms[b]!.rect)).toBe(false);
      }
      expect(new Set(plan.rooms.map(room => room.id)).size).toBe(plan.rooms.length);
    }
  });
});

describe('controlled failures and bounded execution', () => {
  it.each([
    { ...input(), bounds: { x: 0, z: 0, w: 3, d: 3 } },
    { ...input(), adjacency: [{ from: 'bedroom', to: 'bathroom' }, { from: 'bathroom', to: 'kitchen' }, { from: 'kitchen', to: 'bedroom' }] },
    { ...input(), adjacency: [{ from: 'living', to: 'bedroom' }, { from: 'living', to: 'bathroom' }, { from: 'living', to: 'kitchen' }] },
  ])('returns a typed impossible-layout failure for unsupported geometry', requirements => {
    expect(() => generatePlan(requirements)).toThrow(GenerationError);
    try { generatePlan(requirements); } catch (error) { expect(error).toMatchObject({ code: 'IMPOSSIBLE_LAYOUT' }); }
  });

  it.each([undefined, null, {}, { ...input(), floors: 2 }, { ...input(), buildingType: 'commercial' }])('rejects invalid or unsupported input without touching the backend', value => {
    expect(() => generatePlan(value)).toThrow(GenerationError);
    try { generatePlan(value); } catch (error) { expect(error).toMatchObject({ code: 'INVALID_INPUT' }); }
  });

  it('bounds candidate enumeration and completes repeated generation within a generous regression budget', () => {
    const requirements = input();
    expect([...layoutCandidates(requirements, 'bounded')].length).toBeLessThanOrEqual(LAYOUT_LIMITS.maximumAttempts);
    const start = performance.now();
    for (let i = 0; i < 40; i++) generatePlan(requirements, { seed: `termination-${i}` });
    expect(performance.now() - start).toBeLessThan(5_000);
  });

  it('keeps every generator source dependency portable and randomness centralized', () => {
    const root = fileURLToPath(new URL('../src/', import.meta.url));
    for (const name of readdirSync(root).filter(name => name.endsWith('.ts'))) {
      const source = readFileSync(join(root, name), 'utf8');
      expect(source, name).not.toMatch(/\b(?:Math\.random|Date\.now|process\.|window\.|document\.|fetch\s*\()/);
      for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)) {
        expect(match[1], name).toMatch(/^(?:\.\/|@designflow\/shared$|zod$)/);
      }
    }
  });
});
