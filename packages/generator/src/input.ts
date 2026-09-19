import { PlanSchema, RectSchema } from '@designflow/shared';
import { z } from 'zod';
import { GenerationError } from './errors.js';

export const RoomTypeSchema = z.enum(['bedroom', 'bathroom', 'living', 'kitchen', 'dining', 'study']);
export type RoomType = z.infer<typeof RoomTypeSchema>;

/** Engineering limits for this MVP solver, not architectural or building-code limits. */
export const GENERATION_LIMITS = Object.freeze({
  minDimension: 3,
  maxDimension: 60,
  maxCoordinate: 1_000,
  maxRooms: 24,
  maxRoomsPerType: 8,
});

const PromptSchema = PlanSchema.shape.prompt.refine((prompt) => prompt.trim().length > 0, {
  message: 'Prompt must contain non-whitespace text',
});

const BoundsSchema = RectSchema.extend({
  x: RectSchema.shape.x.min(-GENERATION_LIMITS.maxCoordinate).max(GENERATION_LIMITS.maxCoordinate),
  z: RectSchema.shape.z.min(-GENERATION_LIMITS.maxCoordinate).max(GENERATION_LIMITS.maxCoordinate),
  w: RectSchema.shape.w.min(GENERATION_LIMITS.minDimension).max(GENERATION_LIMITS.maxDimension),
  d: RectSchema.shape.d.min(GENERATION_LIMITS.minDimension).max(GENERATION_LIMITS.maxDimension),
}).transform((bounds) => {
  // A shared micrometre grid keeps decimal geometry stable across layout stages.
  const round = (value: number): number => Math.round(value * 1e6) / 1e6 || 0;
  return { x: round(bounds.x), z: round(bounds.z), w: round(bounds.w), d: round(bounds.d) };
});

export const GenerationInputSchema = z.object({
  prompt: PromptSchema,
  bounds: BoundsSchema,
  rooms: z.array(z.object({
    type: RoomTypeSchema,
    count: z.number().int().min(1).max(GENERATION_LIMITS.maxRoomsPerType),
  }).strict()).min(1).max(RoomTypeSchema.options.length),
  adjacency: z.array(z.object({ from: RoomTypeSchema, to: RoomTypeSchema }).strict()).max(15).default([]),
}).strict().superRefine((input, context) => {
  const types = new Set<RoomType>();
  let count = 0;
  input.rooms.forEach((room, index) => {
    count += room.count;
    if (types.has(room.type)) context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rooms', index, 'type'],
      message: 'Room types must occur in exactly one count group',
    });
    types.add(room.type);
  });
  if (count > GENERATION_LIMITS.maxRooms) context.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['rooms'],
    message: `At most ${GENERATION_LIMITS.maxRooms} rooms are supported`,
  });
  const edges = new Set<string>();
  input.adjacency.forEach((edge, index) => {
    if (edge.from === edge.to || !types.has(edge.from) || !types.has(edge.to)) context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['adjacency', index],
      message: 'Adjacency must connect two different requested room types',
    });
    const key = [edge.from, edge.to].sort().join(':');
    if (edges.has(key)) context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['adjacency', index],
      message: 'Adjacency pairs must be unique',
    });
    edges.add(key);
  });
});
export type NormalizedGenerationInput = z.infer<typeof GenerationInputSchema>;

export const GenerationOptionsSchema = z.object({
  seed: z.string().min(1).max(128).optional(),
  variant: PlanSchema.shape.variant,
}).strict();
export type GenerationOptions = z.infer<typeof GenerationOptionsSchema>;

function validated<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, label: string): T {
  let result: z.SafeParseReturnType<unknown, T>;
  try {
    result = schema.safeParse(value);
  } catch {
    // Public callers may pass non-JSON objects with getters/proxies that throw.
    throw new GenerationError('INVALID_INPUT', `Invalid generation ${label}`, { [label]: ['Invalid or unsupported value'] });
  }
  if (result.success) return result.data;
  // Fixed descriptions avoid exposing validator internals or copying arbitrary input values.
  const fields: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || label;
    fields[path] ??= [];
    if (!fields[path].includes('Invalid or unsupported value')) fields[path].push('Invalid or unsupported value');
  }
  throw new GenerationError('INVALID_INPUT', `Invalid generation ${label}`, fields);
}

export function validateGenerationInput(input: unknown): NormalizedGenerationInput {
  return validated(GenerationInputSchema, input, 'input');
}

export function validateGenerationOptions(options: unknown = {}): GenerationOptions {
  return validated(GenerationOptionsSchema, options, 'options');
}

const numberWords: Readonly<Record<string, number>> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4,
  five: 5, six: 6, seven: 7, eight: 8,
};
const unsupportedCounts = new Set([
  'zero', 'no', 'none', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'dozen',
  'several', 'multiple', 'many', 'some', 'another', 'extra', 'additional', 'infinity', 'nan',
  'half', 'quarter', 'third', 'fourth', 'hundred', 'thousand',
  'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
]);
const numericLiteral = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';

function unsupported(message: string): never {
  throw new GenerationError('UNSUPPORTED_REQUIREMENT', message, { prompt: [message] });
}

function parseCount(raw: string): number {
  const count = numberWords[raw] ?? Number(raw);
  if (!Number.isInteger(count) || count < 1 || count > GENERATION_LIMITS.maxRoomsPerType) {
    unsupported('Room counts must be whole numbers from one through eight');
  }
  return count;
}

function rejectUnsupportedRequirements(text: string): void {
  if (/\d(?:\.\d+)?e[+-]?\d|\d,\d/.test(text)) {
    unsupported('Use decimal metre dimensions and whole room counts without scientific or comma notation');
  }
  if (/\bstudio\b|\bopen[ -]plan\b(?!\s+kitchen\b)|\b[a-z][ -]shaped?\b/.test(text)) {
    unsupported('Studio, combined open-plan rooms and nonrectangular footprints are unsupported');
  }
  if (/\b(?:commercial|institutional|hospital|school|hotel|warehouse|factory|industrial|retail|restaurant|mall)\b|\b(?:office|apartment)\s+building\b/.test(text)) {
    unsupported('This generator supports single-level residential rooms only');
  }
  if (/\b(?:multi[ -]?(?:storey(?:ed)?|story|storied|floor)|split[ -]level|duplex|triplex|upstairs|downstairs|basement|attic)\b|\bground\s*(?:plus|\+)\s*/.test(text)) {
    unsupported('Only a single level is supported');
  }
  const levelWords = new Set([
    'single', 'double', 'triple', 'ground', 'first', 'second', 'third', 'fourth', 'fifth',
    'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'upper', 'lower', 'top',
  ]);
  const levels = /(?<![a-z\d])([a-z\d.+-]+)[ -]+(?:floors?|storeys?|storeyed|stories|story|storied|levels?)\b/g;
  const reversedLevels = /\b(?:floor|level)[ -]+([a-z\d.+-]+)/g;
  for (const level of [...text.matchAll(levels), ...text.matchAll(reversedLevels)]) {
    const quantity = level[1] ?? '';
    const countedLevel = /\d/.test(quantity) || quantity.split('-').some((word) => word in numberWords || unsupportedCounts.has(word) || levelWords.has(word));
    if (countedLevel && !['a', 'one', '1', 'single', 'ground', 'first'].includes(quantity)) {
      unsupported('Only a single level is supported');
    }
  }
  if (/\b(?:at\s+least|at\s+most|minimum|maximum|between|exactly|without|except|exclude|excluding|no|not)\b/.test(text)
      || /(?:\d+|one|two|three|four|five|six|seven|eight)\s*(?:-|to|or|\/)\s*(?:\d+|one|two|three|four|five|six|seven|eight)\b/.test(text)) {
    unsupported('Use explicit room counts; ranges, exclusions and conditional constraints are unsupported');
  }
  if (/\b(?:balcon(?:y|ies)|garage|garages|corridors?|hallways?|stairs?|staircases?|terraces?|laundr(?:y|ies)|toilets?|foyers?|pantr(?:y|ies))\b/.test(text)) {
    unsupported('Supported rooms are bedroom, bathroom, living, kitchen, dining and study');
  }
  if (/\b(?:adjacent|adjoining|connected|connect|north|south|east|west|facing|ensuite|en-suite)\b|\bnext\s+to\b/.test(text)) {
    unsupported('Use structured adjacency for room relationships; directional constraints are unsupported');
  }
}

function parseBounds(text: string, totalRooms: number): NormalizedGenerationInput['bounds'] {
  if (/(?<![a-z])(?:ft|feet|foot|inches|inch|cm|centimet(?:er|re)s?|mm|millimet(?:er|re)s?|km|kilomet(?:er|re)s?|yards?|yd)\b|[′″]|\d\s*['"]/.test(text)) {
    unsupported('Footprint dimensions must use metres');
  }
  if (/(?<![a-z])(?:sq[ .]*(?:m|ft)|sqm|sqft|m2|m²)\b|\b(?:area|square)\b/.test(text)) {
    unsupported('Area constraints are unsupported; provide the rectangular footprint dimensions');
  }
  const dimensions = [...text.matchAll(new RegExp(`(?<![a-z\\d.])(${numericLiteral})\\s*(m|metres?|meters?)?\\s*(?:x|×|by)\\s*(${numericLiteral})\\s*(m|metres?|meters?)?\\b`, 'g'))];
  if (dimensions.length > 1) unsupported('Provide one outer footprint; room-specific dimensions are unsupported');
  const pair = dimensions[0];
  if (pair !== undefined) {
    if (pair[2] === undefined && pair[4] === undefined) unsupported('Specify metres for footprint dimensions');
    const remainder = `${text.slice(0, pair.index)} ${text.slice((pair.index ?? 0) + pair[0].length)}`;
    if (/\d\s*(?:m|metres?|meters?)\b|\b(?:width|depth|wide|deep|tall|height)\b/.test(remainder)) {
      unsupported('Provide only the outer width and depth; additional dimensions are unsupported');
    }
    return { x: 0, z: 0, w: Number(pair[1]), d: Number(pair[3]) };
  }
  if (/\b\d+(?:\.\d+)?\s*(?:m|metres?|meters?|sqm|sqft)\b|\b(?:width|depth|wide|deep|area|square)\b/.test(text)) {
    unsupported('Express the outer footprint as width x depth in metres');
  }
  return { x: 0, z: 0, w: 10, d: Math.max(8, Math.ceil(totalRooms / 2) * 3.6) };
}

/**
 * Deliberately small, deterministic residential prompt adapter, separate from layout.
 * BHK adds living, kitchen and one bathroom. A prompt with no room names defaults to
 * 2 bedrooms + bathroom + living + kitchen; an explicit room list contains only its
 * named rooms. Style prose is preserved as metadata; no style-specific layout or
 * furnishing rules are applied.
 * "Open kitchen" requests a direct kitchen/living opening, retaining separate rooms.
 */
export function parseRequirements(prompt: string): NormalizedGenerationInput {
  const original = validated(PromptSchema, prompt, 'prompt');
  const text = original.toLowerCase();
  rejectUnsupportedRequirements(text);
  const counts = new Map<RoomType, number>();
  const explicit = new Set<RoomType>();
  const bhks = [...text.matchAll(new RegExp(`(?<![a-z\\d.])(${numericLiteral}|[a-z]+)\\s*-?\\s*bhk\\b`, 'g'))];
  if (bhks.length > 1) unsupported('Provide one BHK configuration');
  if (/\bbhk\b/.test(text) && bhks.length === 0) unsupported('Specify a BHK bedroom count');
  if (bhks[0] !== undefined) {
    counts.set('bedroom', parseCount(bhks[0][1] ?? ''));
    explicit.add('bedroom');
    counts.set('bathroom', 1);
    counts.set('living', 1);
    counts.set('kitchen', 1);
  }
  const mentions = new Set<RoomType>();
  const aliases = /(?<![a-z])(bed[ -]?rooms?|bath[ -]?rooms?|wash[ -]?rooms?|living\s+rooms?|lounges?|kitchens?|dining(?:\s+rooms?)?|stud(?:y|ies)|offices?)\b/g;
  for (const match of text.matchAll(aliases)) {
    const word = match[1] ?? '';
    const type: RoomType = /^bed/.test(word) ? 'bedroom'
      : /^(?:bath|wash)/.test(word) ? 'bathroom'
      : /^(?:living|lounge)/.test(word) ? 'living'
      : /^kitchen/.test(word) ? 'kitchen'
      : /^dining/.test(word) ? 'dining' : 'study';
    const before = text.slice(0, match.index);
    const raw = new RegExp(`(?:^|[\\s,(])(${numericLiteral}|[a-z]+(?:-[a-z]+)*)(?:\\s*-\\s*|\\s*)$`).exec(before)?.[1];
    let count = 1;
    if (raw !== undefined && (raw in numberWords || /^[+-.]?\d/.test(raw) || raw.split('-').some((part) => unsupportedCounts.has(part)))) {
      count = parseCount(raw);
    } else if (/s$/.test(word) && word !== 'office') {
      unsupported(`Specify a count for ${type} rooms`);
    } else if (new RegExp(`(?:^|\\s)(?:${numericLiteral}|one|two|three|four|five|six|seven|eight)\\s+(?!and\\b|with\\b|plus\\b)[a-z]+\\s*$`).test(before)) {
      unsupported('Place the whole room count directly before its room name');
    }
    if (mentions.has(type)) unsupported(`Provide one explicit count for ${type} rooms`);
    if (explicit.has(type) && counts.get(type) !== count) unsupported(`Conflicting counts for ${type} rooms`);
    counts.set(type, count);
    explicit.add(type);
    mentions.add(type);
  }
  if (counts.size === 0) {
    counts.set('bedroom', 2);
    counts.set('bathroom', 1);
    counts.set('living', 1);
    counts.set('kitchen', 1);
  }
  const adjacency: NormalizedGenerationInput['adjacency'] = [];
  if (/\bopen(?:[ -]plan)?\s+kitchen\b/.test(text)) {
    counts.set('living', counts.get('living') ?? 1);
    adjacency.push({ from: 'kitchen', to: 'living' });
  }
  // Canonical type order keeps synonymous prompt formulations predictable.
  const rooms = RoomTypeSchema.options.flatMap((type) => {
    const count = counts.get(type);
    return count === undefined ? [] : [{ type, count }];
  });
  return validateGenerationInput({
    prompt: original,
    bounds: parseBounds(text, rooms.reduce((sum, room) => sum + room.count, 0)),
    rooms,
    adjacency,
  });
}
