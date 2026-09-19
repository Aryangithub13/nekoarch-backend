import { describe, expect, it } from 'vitest';
import { GenerationError } from '../src/errors.js';
import {
  GenerationInputSchema,
  GenerationOptionsSchema,
  parseRequirements,
  validateGenerationInput,
  validateGenerationOptions,
} from '../src/input.js';

const input = {
  prompt: 'One bedroom and one bathroom',
  bounds: { x: 0, z: 0, w: 10, d: 8 },
  rooms: [{ type: 'bedroom', count: 1 }, { type: 'bathroom', count: 1 }],
};

function expectCode(action: () => unknown, code: GenerationError['code']): void {
  try {
    action();
    expect.fail('Expected a controlled generation error');
  } catch (error) {
    expect(error).toBeInstanceOf(GenerationError);
    expect((error as GenerationError).code).toBe(code);
  }
}

describe('normalized generation input', () => {
  it('validates and copies structured requirements without mutating the caller', () => {
    const original = structuredClone(input);
    const normalized = validateGenerationInput(input);
    expect(normalized).toEqual({ ...input, adjacency: [] });
    expect(input).toEqual(original);
    normalized.rooms[0]!.count = 2;
    expect(input.rooms[0]!.count).toBe(1);
  });

  it.each([null, undefined, 'a house', 10, [], {}, { ...input, floors: 2 }, { ...input, buildingType: 'residential' }].map((value) => ({ value })))(
    'rejects a malformed or unsupported envelope $value', ({ value }) => {
      expectCode(() => validateGenerationInput(value), 'INVALID_INPUT');
    },
  );

  it.each(['', ' ', '\n\t', 'a'.repeat(501), 123, null])('rejects invalid prompt %j', (prompt) => {
    expectCode(() => validateGenerationInput({ ...input, prompt }), 'INVALID_INPUT');
  });

  it.each([
    { x: -1_001 }, { z: 1_001 }, { x: Infinity }, { z: NaN },
    { w: 0 }, { d: -1 }, { w: 2.99 }, { d: 60.01 },
    { w: '10' }, { w: Infinity }, { depth: 8 },
  ])('rejects invalid footprint %j', (bounds) => {
    expectCode(() => validateGenerationInput({ ...input, bounds: { ...input.bounds, ...bounds } }), 'INVALID_INPUT');
  });

  it('accepts exact engineering footprint and coordinate boundaries', () => {
    expect(GenerationInputSchema.safeParse({ ...input, bounds: { x: -1_000, z: 1_000, w: 3, d: 60 } }).success).toBe(true);
  });

  it('normalizes footprint coordinates to six decimal places in metres', () => {
    expect(validateGenerationInput({ ...input, bounds: { x: -0.00000001, z: 1.23456789, w: 10.33333333, d: 8 } }).bounds)
      .toEqual({ x: 0, z: 1.234568, w: 10.333333, d: 8 });
  });

  it.each([
    [], [{ type: 'bedroom', count: 0 }], [{ type: 'bedroom', count: -1 }],
    [{ type: 'bedroom', count: 1.1 }], [{ type: 'bedroom', count: 9 }],
    [{ type: 'bedroom', count: Infinity }], [{ type: 'bedroom', count: NaN }],
    [{ type: 'office', count: 1 }], [{ type: 'bedroom', count: '2' }],
    [{ type: 'bedroom', count: 1, floor: 1 }],
    [{ type: 'bedroom', count: 1 }, { type: 'bedroom', count: 2 }],
    [{ type: 'bedroom', count: 8 }, { type: 'bathroom', count: 8 }, { type: 'living', count: 8 }, { type: 'kitchen', count: 1 }],
  ].map((rooms) => ({ rooms })))('rejects invalid room requirements $rooms', ({ rooms }) => {
    expect(Array.isArray(rooms)).toBe(true);
    expectCode(() => validateGenerationInput({ ...input, rooms }), 'INVALID_INPUT');
  });

  it('allows the 24-room boundary and a single-room configuration', () => {
    for (const rooms of [
      [{ type: 'bathroom', count: 1 }],
      [{ type: 'bedroom', count: 8 }, { type: 'bathroom', count: 8 }, { type: 'living', count: 8 }],
    ]) expect(GenerationInputSchema.safeParse({ ...input, rooms }).success).toBe(true);
  });

  it('accepts valid adjacency between requested types', () => {
    const adjacency = [{ from: 'bedroom', to: 'bathroom' }];
    expect(validateGenerationInput({ ...input, adjacency }).adjacency).toEqual(adjacency);
  });

  it('accepts complete multi-room and multi-edge arrays', () => {
    const rooms = [...input.rooms, { type: 'kitchen', count: 1 }];
    const adjacency = [{ from: 'bedroom', to: 'bathroom' }, { from: 'kitchen', to: 'bedroom' }];
    const result = validateGenerationInput({ ...input, rooms, adjacency });
    expect(result.rooms).toEqual(rooms);
    expect(result.adjacency).toEqual(adjacency);
  });

  it.each([
    [{ from: 'bedroom', to: 'bedroom' }],
    [{ from: 'bedroom', to: 'kitchen' }],
    [{ from: 'bedroom', to: 'garage' }],
    [{ from: 'bedroom', to: 'bathroom', distance: 2 }],
    [{ from: 'bedroom', to: 'bathroom' }, { from: 'bathroom', to: 'bedroom' }],
  ].map((adjacency) => ({ adjacency })))('rejects invalid adjacency $adjacency', ({ adjacency }) => {
    expect(Array.isArray(adjacency)).toBe(true);
    expectCode(() => validateGenerationInput({ ...input, adjacency }), 'INVALID_INPUT');
  });

  it('returns stable field paths without leaking malformed input into messages', () => {
    try {
      validateGenerationInput({ ...input, rooms: [{ type: 'private-input-token', count: -1 }] });
      expect.fail('Should reject');
    } catch (error) {
      expect(error).toBeInstanceOf(GenerationError);
      expect((error as GenerationError).fieldErrors).toEqual({
        'rooms.0.type': ['Invalid or unsupported value'],
        'rooms.0.count': ['Invalid or unsupported value'],
      });
      expect(JSON.stringify(error)).not.toContain('private-input-token');
    }
  });
});

describe('generation options', () => {
  it('defaults variant without introducing a random seed', () => {
    expect(validateGenerationOptions()).toEqual({ variant: 1 });
    expect(validateGenerationOptions({ seed: 'fixed' })).toEqual({ seed: 'fixed', variant: 1 });
    expect(validateGenerationOptions({ seed: 'x'.repeat(128), variant: 2_147_483_647 }).variant).toBe(2_147_483_647);
  });

  it.each([
    null, [], 'fixed', { random: true }, { seed: '' }, { seed: 'x'.repeat(129) }, { seed: 1 },
    { variant: 0 }, { variant: 1.1 }, { variant: 2_147_483_648 }, { variant: NaN }, { variant: Infinity },
  ].map((options) => ({ options })))('rejects malformed options $options', ({ options }) => {
    expect(GenerationOptionsSchema.safeParse(options).success).toBe(false);
    expectCode(() => validateGenerationOptions(options), 'INVALID_INPUT');
  });
});

describe('deterministic prompt normalization', () => {
  it('normalizes the PRD BHK example, preserving original prompt metadata', () => {
    const prompt = '2BHK modern flat with open kitchen';
    expect(parseRequirements(prompt)).toEqual({
      prompt,
      bounds: { x: 0, z: 0, w: 10, d: 10.8 },
      rooms: [
        { type: 'bedroom', count: 2 }, { type: 'bathroom', count: 1 },
        { type: 'living', count: 1 }, { type: 'kitchen', count: 1 },
      ],
      adjacency: [{ from: 'kitchen', to: 'living' }],
    });
  });

  it.each(['2BHK', 'two bhk', '2-BHK'])('supports numeric/word BHK %s', (prompt) => {
    expect(parseRequirements(prompt).rooms).toEqual(parseRequirements('2BHK').rooms);
  });

  it('parses explicit room lists without adding unrequested rooms', () => {
    expect(parseRequirements('One-bedroom home with two bathrooms and a home office').rooms).toEqual([
      { type: 'bedroom', count: 1 }, { type: 'bathroom', count: 2 }, { type: 'study', count: 1 },
    ]);
    expect(parseRequirements('A kitchen').rooms).toEqual([{ type: 'kitchen', count: 1 }]);
  });

  it('normalizes every supported room type and documented aliases', () => {
    expect(parseRequirements('2 bedrooms, a washroom, a lounge, one kitchen, dining room and study').rooms).toEqual([
      { type: 'bedroom', count: 2 }, { type: 'bathroom', count: 1 }, { type: 'living', count: 1 },
      { type: 'kitchen', count: 1 }, { type: 'dining', count: 1 }, { type: 'study', count: 1 },
    ]);
  });

  it('applies the documented default only when room requirements are absent', () => {
    const result = parseRequirements('Warm modern home with wooden floors');
    expect(result.rooms).toEqual(parseRequirements('2BHK').rooms);
    expect(result.adjacency).toEqual([]);
  });

  it('lets explicit bathroom counts override the BHK default', () => {
    expect(parseRequirements('3BHK with two bathrooms').rooms.find((room) => room.type === 'bathroom')?.count).toBe(2);
  });

  it('expands an open kitchen into connected distinct living and kitchen rooms', () => {
    expect(parseRequirements('open-plan kitchen').rooms).toEqual([
      { type: 'living', count: 1 }, { type: 'kitchen', count: 1 },
    ]);
    expect(parseRequirements('open-plan kitchen').adjacency).toEqual([{ from: 'kitchen', to: 'living' }]);
  });

  it.each(['12m x 10m', '12 x 10 m', '12 metres by 10 metres', '12 meters × 10 meters'])('parses explicit metre footprint %s', (dimensions) => {
    expect(parseRequirements(`2BHK ${dimensions}`).bounds).toEqual({ x: 0, z: 0, w: 12, d: 10 });
  });

  it('parses decimal dimensions and single-level prose', () => {
    expect(parseRequirements('single-storey home, 12.5m x 8.25m, one bedroom').bounds).toEqual({ x: 0, z: 0, w: 12.5, d: 8.25 });
    expect(parseRequirements('one floor with one bedroom').rooms).toEqual([{ type: 'bedroom', count: 1 }]);
  });

  it('is deterministic across repeated invocations and returns separate objects', () => {
    const first = parseRequirements('Two bedrooms, one study in 12m x 10m');
    for (let i = 0; i < 20; i += 1) {
      const next = parseRequirements(first.prompt);
      expect(next).toEqual(first);
      expect(next).not.toBe(first);
      expect(GenerationInputSchema.safeParse(next).success).toBe(true);
    }
  });

  it.each([
    '0 bedrooms', '-2 bedrooms', '1.5 bedrooms', '1/2 bedroom', '9 bedrooms', 'nine bedrooms', 'zero bedrooms',
    'no bedroom', 'several bedrooms', 'bedrooms and kitchens', '2 bedrooms and 3 bedrooms',
    '2BHK and 3BHK', '2BHK with three bedrooms', '0BHK', '9BHK', 'BHK flat',
    '2-3 bedrooms', 'two or three bedrooms', 'at least two bedrooms', 'without kitchen',
    'two floors', '2nd floor apartment', '2 storeys', 'two-story home', 'floor 2',
    'duplex home', 'multi-storey home', 'home with basement', 'upstairs bedroom',
    'commercial shop', 'institutional building', 'hospital', 'office building', 'apartment building',
    'one bedroom and a garage', 'balcony home', 'ensuite bedroom', 'kitchen adjacent to living room',
    '12ft x 10ft', '12m x 10ft', '12cm x 10cm', '12km x 10km', "12' x 10'", '12 x 10',
    '1200 sqft home', '12m wide', '12m x 10m plus 4m x 3m bedroom',
  ])('rejects unsupported or ambiguous requirement %s', (prompt) => {
    expectCode(() => parseRequirements(prompt), 'UNSUPPORTED_REQUIREMENT');
  });

  it.each(['0m x 10m', '-2m x 10m', '61m x 10m', '2.9m x 10m'])('rejects footprints outside engineering bounds %s', (prompt) => {
    expectCode(() => parseRequirements(prompt), 'INVALID_INPUT');
  });

  it.each(['', ' ', 'a'.repeat(501)])('rejects invalid natural-language prompt %j', (prompt) => {
    expectCode(() => parseRequirements(prompt), 'INVALID_INPUT');
  });
});

describe('parser regression boundaries', () => {
  it.each([
    'studio apartment', 'open-plan apartment', 'L-shaped home', 'U shaped house',
    'split-level home', 'two-storeyed home', 'eleven floors', 'floor two', 'ground plus one floor',
    'multistoreyed home', 'multi-storied home', 'fifth floor', 'thirty floors', 'thirty bedroom', 'twenty-one bedroom',
    'one bedroom and one bedroom', 'a study and a home office',
    '.5BHK', '.5 bedroom', '1e2BHK', '1e2 bedroom', '2,5BHK',
    'one and a half bedroom', 'two master bedroom',
    '12m x 10m with 200sqm', '12m x 10m and 20m wide', '12m x 10m x 3m',
    '100 sq m home', '100m2 home', '12 x 10m2',
  ])('rejects silently misinterpreted requirement %s', (prompt) => {
    expectCode(() => parseRequirements(prompt), 'UNSUPPORTED_REQUIREMENT');
  });

  it('does not parse the fractional width .5m as 5m', () => {
    expectCode(() => parseRequirements('.5m x 10m'), 'INVALID_INPUT');
  });

  it.each(['two bed rooms and one bath-room', 'two bed-rooms and one wash room'])('normalizes compound room spelling %s', (prompt) => {
    expect(parseRequirements(prompt).rooms).toEqual([{ type: 'bedroom', count: 2 }, { type: 'bathroom', count: 1 }]);
  });

  it('preserves unrestricted style metadata outside the supported spatial grammar', () => {
    expect(parseRequirements('Art deco home with wooden floors and soft green tones').rooms).toEqual(parseRequirements('2BHK').rooms);
  });

  it('allows consistent BHK bedroom restatement', () => {
    expect(parseRequirements('2BHK with two bedrooms').rooms).toEqual(parseRequirements('2BHK').rooms);
  });

  it('returns a domain error for non-JSON values that throw during schema traversal', () => {
    const hostileInput = Object.defineProperty({}, 'prompt', { get() { throw new Error('private-token'); } });
    expectCode(() => validateGenerationInput(hostileInput), 'INVALID_INPUT');
    const hostileOptions = Object.defineProperty({}, 'variant', { get() { throw new Error('private-token'); } });
    expectCode(() => validateGenerationOptions(hostileOptions), 'INVALID_INPUT');
  });
});
