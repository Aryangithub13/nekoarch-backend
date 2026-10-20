import { describe, expect, it } from 'vitest';
import { parseFallback } from '../src/ai/fallback-parser.js';

// Everyday request wording carries no design constraint and must not block a proposal;
// unknown feature vocabulary (styles, materials, amenities) still does.
describe('fallback parser: everyday request wording', () => {
  it.each([
    ['A single floor house with 2 bedrooms on a 20 m by 15 m plot.', 1],
    ['single-storey house, 2 bedrooms, 30x40 ft plot', 1],
    ['A double storey home with 3 bedrooms on a 30x40 ft plot', 2],
    ['double floor house, 4 bedrooms, plot 40 by 60 ft', 2],
  ])('reads the floor count in %s', (text, floors) => {
    const c = parseFallback(text);
    expect(c.floors).toBe(floors);
    expect(c.unsupported).not.toContain('unrecognized_language');
  });

  it.each([
    'Design a 3BHK villa on a 40x60 ft plot',
    'Can you build me a small house with 2 bedrooms on a 25 by 30 ft plot?',
    'Please create a 2 floor residential building with 3 bedrooms on a 30 m by 20 m plot',
    'Could you draw a compact bungalow with 2 bedrooms on a 20x30 ft site',
  ])('accepts request phrasing in %s', text => {
    expect(parseFallback(text).unsupported).not.toContain('unrecognized_language');
  });

  it.each([
    'A 2 floor house with 3 bedrooms on a 30x40 ft plot with a glass-and-concrete exterior',
    'house with garden and swimming pool',
  ])('still flags feature vocabulary it cannot apply: %s', text => {
    expect(parseFallback(text).unsupported).toContain('unrecognized_language');
  });

  it('a stated floor count that contradicts single floor is a contradiction, not a guess', () => {
    expect(parseFallback('single floor house with 2 floors, 30x40 ft, 2 bedrooms').contradictions).toContain('floors');
  });
});
