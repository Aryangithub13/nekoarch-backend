import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ApiErrorResponseSchema,
  BreakdownRowSchema,
  BuildingTypeSchema,
  CreatePlanRequestSchema,
  CreatePlanResponseSchema,
  EstimateInputsSchema,
  EstimateRequestSchema,
  EstimateResponseSchema,
  FurnItemSchema,
  FurnKindSchema,
  GetPlanResponseSchema,
  PatchPlanRequestSchema,
  PatchPlanResponseSchema,
  PlanInputSchema,
  PlanParamsSchema,
  PlanQASchema,
  PlanSchema,
  RectSchema,
  RegionSchema,
  RegionsResponseSchema,
  RoomSchema,
  SavedPlanSchema,
  TierEstimateSchema,
  TierSchema,
  WallSegSchema,
} from '../src/index.js';

const uuid = '3bef1207-f3c7-4b60-af8a-e7eaa5a3c8ef';
const rect = { x: -2, z: 0, w: 4, d: 5 };
const wall = { x0: -2, z0: 0, x1: 2, z1: 0, window: { w0: 0.2, w1: 0.8 } };
const furn = { kind: 'bed', x: 0, z: 1, rot: Math.PI / 2 };
const room = { id: 0, name: 'Bedroom', type: 'bedroom', rect };
const qa = { orthogonal: 1, walls: 4, pieces: 1 };
const plan = {
  prompt: 'A one-bedroom home',
  seed: 'deterministic-123',
  variant: 1,
  rooms: [room],
  walls: [wall],
  furn: [furn],
  bounds: rect,
  qa,
};
const savedPlan = { ...plan, id: uuid };
const estimateInputs = {
  location: 'Demonstration baseline',
  buildingType: 'residential',
  builtUpAreaSqft: 1_000,
  floors: 1,
};
const breakdown = { category: 'Structure', min: 600_000, max: 750_000 };
const tier = {
  tier: 'basic',
  rangeMin: 600_000,
  rangeMax: 750_000,
  breakdown: [breakdown],
  materials: { structure: 'Illustrative material guidance' },
  timelineMonths: [4, 6],
};
const region = {
  name: 'Demonstration baseline',
  buildingTypes: ['residential', 'commercial', 'institutional'],
  isBaseline: true,
  isFallback: false,
};
const estimateResponse = {
  tiers: [tier, { ...tier, tier: 'standard' }, { ...tier, tier: 'premium' }],
  region,
  disclaimer: 'Illustrative estimate, not a quotation.',
  soilDisclaimer: 'A site-specific investigation is required.',
};

const planRequiredFields = ['prompt', 'seed', 'rooms', 'walls', 'furn', 'bounds', 'qa'];
const objectCases: Array<{
  name: string;
  schema: z.ZodTypeAny;
  valid: Record<string, unknown>;
  required: string[];
  stripsUnknown?: boolean;
}> = [
  { name: 'Rect', schema: RectSchema, valid: rect, required: ['x', 'z', 'w', 'd'] },
  { name: 'WallSeg', schema: WallSegSchema, valid: wall, required: ['x0', 'z0', 'x1', 'z1'] },
  { name: 'FurnItem', schema: FurnItemSchema, valid: furn, required: ['kind', 'x', 'z', 'rot'] },
  { name: 'Room', schema: RoomSchema, valid: room, required: ['id', 'name', 'type', 'rect'] },
  { name: 'PlanQA', schema: PlanQASchema, valid: qa, required: ['orthogonal', 'walls', 'pieces'] },
  { name: 'Plan', schema: PlanSchema, valid: plan, required: planRequiredFields },
  { name: 'PlanInput', schema: PlanInputSchema, valid: plan, required: planRequiredFields, stripsUnknown: true },
  { name: 'SavedPlan', schema: SavedPlanSchema, valid: savedPlan, required: ['id', ...planRequiredFields] },
  {
    name: 'EstimateInputs', schema: EstimateInputsSchema, valid: estimateInputs,
    required: ['location', 'buildingType', 'builtUpAreaSqft'],
  },
  {
    name: 'EstimateRequest', schema: EstimateRequestSchema, valid: estimateInputs,
    required: ['location', 'buildingType', 'builtUpAreaSqft'],
  },
  { name: 'BreakdownRow', schema: BreakdownRowSchema, valid: breakdown, required: ['category', 'min', 'max'] },
  {
    name: 'TierEstimate', schema: TierEstimateSchema, valid: tier,
    required: ['tier', 'rangeMin', 'rangeMax', 'breakdown', 'materials', 'timelineMonths'],
  },
  {
    name: 'Region', schema: RegionSchema, valid: region,
    required: ['name', 'buildingTypes', 'isBaseline', 'isFallback'],
  },
  { name: 'CreatePlanRequest', schema: CreatePlanRequestSchema, valid: { plan }, required: ['plan'] },
  {
    name: 'CreatePlanResponse', schema: CreatePlanResponseSchema,
    valid: { plan: savedPlan, shareToken: 'capability-token' }, required: ['plan', 'shareToken'],
  },
  { name: 'PlanParams', schema: PlanParamsSchema, valid: { id: uuid }, required: ['id'] },
  { name: 'GetPlanResponse', schema: GetPlanResponseSchema, valid: { plan: savedPlan }, required: ['plan'] },
  { name: 'PatchPlanRequest', schema: PatchPlanRequestSchema, valid: { isPublic: true }, required: ['isPublic'] },
  { name: 'PatchPlanResponse', schema: PatchPlanResponseSchema, valid: { plan: savedPlan }, required: ['plan'] },
  {
    name: 'EstimateResponse', schema: EstimateResponseSchema, valid: estimateResponse,
    required: ['tiers', 'region', 'disclaimer', 'soilDisclaimer'],
  },
  {
    name: 'RegionsResponse', schema: RegionsResponseSchema,
    valid: { regions: [region], lastUpdated: '2026-09-12' }, required: ['regions', 'lastUpdated'],
  },
  {
    name: 'ApiErrorResponse', schema: ApiErrorResponseSchema,
    valid: { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', requestId: 'req-1' } },
    required: ['error'],
  },
];

describe.each(objectCases)('$name contract', ({ schema, valid, required, stripsUnknown }) => {
  it('round-trips valid JSON without changing domain values', () => {
    expect(schema.parse(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
    expect(schema.parse(schema.parse(valid))).toEqual(valid);
  });

  it.each(required)('rejects missing required field %s', (field) => {
    const invalid = { ...valid };
    delete invalid[field];
    expect(schema.safeParse(invalid).success).toBe(false);
  });

  it.each(required)('rejects invalid required field %s', (field) => {
    expect(schema.safeParse({ ...valid, [field]: null }).success).toBe(false);
  });

  it('has explicit unknown-field behavior', () => {
    const result = schema.safeParse({ ...valid, unexpected: 'must not be persisted' });
    if (stripsUnknown) {
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(valid);
    } else {
      expect(result.success).toBe(false);
    }
  });

  it.each([null, [], 'object', 1, true])('rejects malformed container %j', (value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});

describe.each([
  { name: 'FurnKind', schema: FurnKindSchema, values: FurnKindSchema.options },
  { name: 'BuildingType', schema: BuildingTypeSchema, values: BuildingTypeSchema.options },
  { name: 'Tier', schema: TierSchema, values: TierSchema.options },
])('$name enum', ({ schema, values }) => {
  it.each(values)('round-trips %s', (value) => expect(schema.parse(value)).toBe(value));
  it.each([undefined, null, 'unsupported', '', 1, {}, []])('rejects %j', (value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});

describe('geometry and plan boundaries', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects non-finite geometry %s', (value) => {
    for (const field of ['x', 'z', 'w', 'd']) {
      expect(RectSchema.safeParse({ ...rect, [field]: value }).success).toBe(false);
    }
    for (const field of ['x0', 'z0', 'x1', 'z1']) {
      expect(WallSegSchema.safeParse({ ...wall, [field]: value }).success).toBe(false);
    }
    for (const field of ['x', 'z', 'rot']) {
      expect(FurnItemSchema.safeParse({ ...furn, [field]: value }).success).toBe(false);
    }
    for (const field of ['w0', 'w1']) {
      expect(WallSegSchema.safeParse({ ...wall, window: { ...wall.window, [field]: value } }).success).toBe(false);
    }
  });

  it.each([0, -1])('rejects nonpositive dimension %s', (value) => {
    expect(RectSchema.safeParse({ ...rect, w: value }).success).toBe(false);
    expect(RectSchema.safeParse({ ...rect, d: value }).success).toBe(false);
  });

  it('accepts negative coordinates and arbitrarily small positive dimensions', () => {
    expect(RectSchema.parse({ x: -100, z: -100, w: 0.001, d: 0.001 }).w).toBe(0.001);
  });

  it.each([0, 501])('rejects a prompt of length %s', (length) => {
    expect(PlanSchema.safeParse({ ...plan, prompt: 'a'.repeat(length) }).success).toBe(false);
  });

  it.each([1, 500])('accepts a prompt of length %s', (length) => {
    expect(PlanSchema.parse({ ...plan, prompt: 'a'.repeat(length) }).prompt).toHaveLength(length);
  });

  it('defaults variant to one and permits only safe positive integers', () => {
    const { variant: _variant, ...withoutVariant } = plan;
    expect(PlanSchema.parse(withoutVariant).variant).toBe(1);
    expect(PlanInputSchema.parse(withoutVariant).variant).toBe(1);
    for (const value of [0, -1, 1.5, Infinity, NaN, null, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1]) {
      expect(PlanSchema.safeParse({ ...plan, variant: value }).success).toBe(false);
    }
    expect(PlanSchema.parse({ ...plan, variant: 2 }).variant).toBe(2);
    expect(PlanSchema.parse({ ...plan, variant: 2_147_483_647 }).variant).toBe(2_147_483_647);
  });

  it('requires at least one valid room while permitting no walls or furniture', () => {
    expect(PlanSchema.safeParse({ ...plan, rooms: [] }).success).toBe(false);
    expect(PlanSchema.parse({ ...plan, walls: [], furn: [] }).rooms).toHaveLength(1);
    expect(PlanSchema.safeParse({ ...plan, rooms: [{ ...room, rect: { ...rect, w: 0 } }] }).success).toBe(false);
  });

  it.each([-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects room/count value %s', (value) => {
    expect(RoomSchema.safeParse({ ...room, id: value }).success).toBe(false);
    expect(PlanQASchema.safeParse({ ...qa, walls: value }).success).toBe(false);
    expect(PlanQASchema.safeParse({ ...qa, pieces: value }).success).toBe(false);
  });

  it.each([0, 0.5, 1])('accepts QA score %s', (value) => {
    expect(PlanQASchema.parse({ orthogonal: value, walls: 0, pieces: 0 }).orthogonal).toBe(value);
  });

  it.each([-0.001, 1.001, Infinity, NaN])('rejects QA score %s', (value) => {
    expect(PlanQASchema.safeParse({ ...qa, orthogonal: value }).success).toBe(false);
  });

  it('validates optional saved identifiers and window shape', () => {
    expect(PlanSchema.parse(savedPlan).id).toBe(uuid);
    expect(PlanSchema.safeParse({ ...plan, id: 'invalid-uuid' }).success).toBe(false);
    expect(PlanSchema.safeParse({ ...plan, id: null }).success).toBe(false);
    expect(SavedPlanSchema.safeParse(plan).success).toBe(false);
    expect(WallSegSchema.parse({ x0: 0, z0: 0, x1: 1, z1: 0 }).window).toBeUndefined();
    expect(WallSegSchema.safeParse({ ...wall, window: { w0: 0 } }).success).toBe(false);
    expect(WallSegSchema.safeParse({ ...wall, window: { w1: 1 } }).success).toBe(false);
    expect(WallSegSchema.safeParse({ ...wall, window: null }).success).toBe(false);
    expect(WallSegSchema.safeParse({ ...wall, window: { ...wall.window, unexpected: 1 } }).success).toBe(false);
  });

  it('strips untrusted persistence metadata at the create boundary only', () => {
    const malicious = {
      ...plan, id: 'invalid-but-ignored', user_id: uuid, userId: uuid,
      share_token: 'attacker-token', shareToken: 'attacker-token',
      is_public: true, isPublic: true, plan_data: {},
      created_at: '2026-01-01', updated_at: '2026-01-01',
    };
    expect(CreatePlanRequestSchema.parse({ plan: malicious })).toEqual({ plan });
    expect(PlanSchema.safeParse(malicious).success).toBe(false);
    expect(CreatePlanRequestSchema.safeParse({ plan, user_id: uuid }).success).toBe(false);
    expect(CreatePlanRequestSchema.safeParse({ plan: { ...plan, rooms: [{ ...room, user_id: uuid }] } }).success).toBe(false);
  });
});

describe('estimate input and output boundaries', () => {
  it('defaults floors and validates optional fields', () => {
    const { floors: _floors, ...withoutFloors } = estimateInputs;
    expect(EstimateInputsSchema.parse(withoutFloors).floors).toBe(1);
    expect(EstimateInputsSchema.parse({ ...estimateInputs, planId: uuid, budget: 1 }).budget).toBe(1);
    expect(EstimateInputsSchema.safeParse({ ...estimateInputs, planId: 'invalid' }).success).toBe(false);
    expect(EstimateInputsSchema.safeParse({ ...estimateInputs, planId: null }).success).toBe(false);
    expect(EstimateInputsSchema.safeParse({ ...estimateInputs, location: '' }).success).toBe(false);
    expect(EstimateInputsSchema.safeParse({ ...estimateInputs, buildingType: 'industrial' }).success).toBe(false);
  });

  it.each([0, -1, Infinity, -Infinity, NaN, null, '1000'])('rejects invalid area/budget %s', (value) => {
    expect(EstimateInputsSchema.safeParse({ ...estimateInputs, builtUpAreaSqft: value }).success).toBe(false);
    expect(EstimateInputsSchema.safeParse({ ...estimateInputs, budget: value }).success).toBe(false);
  });

  it.each([0, -1, 1.5, Infinity, NaN, null, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1])('rejects invalid floors %s', (value) => {
    expect(EstimateInputsSchema.safeParse({ ...estimateInputs, floors: value }).success).toBe(false);
  });

  it('accepts small positive area and budget and multiple floors', () => {
    expect(EstimateInputsSchema.parse({ ...estimateInputs, builtUpAreaSqft: 0.01, budget: 0.01, floors: 2 }).floors).toBe(2);
    expect(EstimateInputsSchema.parse({ ...estimateInputs, floors: 2_147_483_647 }).floors).toBe(2_147_483_647);
  });

  it.each([-1, NaN, Infinity, -Infinity])('rejects invalid amount %s', (value) => {
    expect(BreakdownRowSchema.safeParse({ ...breakdown, min: value }).success).toBe(false);
    expect(BreakdownRowSchema.safeParse({ ...breakdown, max: value }).success).toBe(false);
    expect(TierEstimateSchema.safeParse({ ...tier, rangeMin: value }).success).toBe(false);
    expect(TierEstimateSchema.safeParse({ ...tier, rangeMax: value }).success).toBe(false);
  });

  it('allows zero category allocations and rejects reversed ranges', () => {
    expect(BreakdownRowSchema.parse({ category: 'Unallocated', min: 0, max: 0 }).min).toBe(0);
    expect(BreakdownRowSchema.safeParse({ ...breakdown, max: breakdown.min - 1 }).success).toBe(false);
    expect(TierEstimateSchema.safeParse({ ...tier, rangeMax: tier.rangeMin - 1 }).success).toBe(false);
  });

  it.each([[0, 1], [-1, 1], [1, Infinity], [1, NaN], [2, 1], [1], [1, 2, 3]].map((timelineMonths) => ({ timelineMonths })))(
    'rejects timeline $timelineMonths', ({ timelineMonths }) => {
    expect(TierEstimateSchema.safeParse({ ...tier, timelineMonths }).success).toBe(false);
    },
  );

  it('validates breakdowns and material descriptions', () => {
    expect(TierEstimateSchema.safeParse({ ...tier, breakdown: [{ ...breakdown, max: -1 }] }).success).toBe(false);
    expect(TierEstimateSchema.safeParse({ ...tier, materials: { structure: 100 } }).success).toBe(false);
    expect(TierEstimateSchema.safeParse({ ...tier, tier: 'luxury' }).success).toBe(false);
  });

  it('requires each tier exactly once in basic, standard, premium order', () => {
    for (const tiers of [[], [tier], [tier, tier, tier], [...estimateResponse.tiers, tier], [...estimateResponse.tiers].reverse()]) {
      expect(EstimateResponseSchema.safeParse({ ...estimateResponse, tiers }).success).toBe(false);
    }
    expect(EstimateResponseSchema.parse(estimateResponse).tiers.map((entry) => entry.tier)).toEqual(['basic', 'standard', 'premium']);
  });

  it('requires explicit and valid region metadata', () => {
    expect(RegionSchema.safeParse({ ...region, buildingTypes: [] }).success).toBe(false);
    expect(RegionSchema.safeParse({ ...region, buildingTypes: ['residential', 'residential'] }).success).toBe(false);
    expect(RegionSchema.safeParse({ ...region, buildingTypes: ['industrial'] }).success).toBe(false);
    expect(RegionSchema.safeParse({ ...region, name: '' }).success).toBe(false);
    expect(RegionSchema.parse({ ...region, isFallback: true }).isFallback).toBe(true);
    expect(RegionsResponseSchema.safeParse({ regions: [], lastUpdated: '2026-09-12' }).success).toBe(false);
  });

  it.each(['2026-02-30', '2026-13-01', 'today', '2026-09-12T00:00:00Z', ''])('rejects invalid effective date %s', (lastUpdated) => {
    expect(RegionsResponseSchema.safeParse({ regions: [region], lastUpdated }).success).toBe(false);
  });

  it('does not allow omitted or empty disclaimers', () => {
    expect(EstimateResponseSchema.safeParse({ ...estimateResponse, disclaimer: '' }).success).toBe(false);
    expect(EstimateResponseSchema.safeParse({ ...estimateResponse, soilDisclaimer: '' }).success).toBe(false);
  });
});

describe('API security and error boundaries', () => {
  it('requires saved identifiers in every plan response and places the share token beside the plan', () => {
    expect(CreatePlanResponseSchema.safeParse({ plan, shareToken: 'token' }).success).toBe(false);
    expect(CreatePlanResponseSchema.safeParse({ plan: { ...savedPlan, shareToken: 'token' } }).success).toBe(false);
    expect(CreatePlanResponseSchema.safeParse({ plan: savedPlan, shareToken: '' }).success).toBe(false);
    expect(GetPlanResponseSchema.safeParse({ plan }).success).toBe(false);
    expect(GetPlanResponseSchema.safeParse({ plan: savedPlan, shareToken: 'token' }).success).toBe(false);
    expect(PatchPlanResponseSchema.safeParse({ plan }).success).toBe(false);
    expect(PlanParamsSchema.safeParse({ id: 'invalid' }).success).toBe(false);
  });

  it('permits a boolean-only sharing patch with no persistence fields', () => {
    expect(PatchPlanRequestSchema.parse({ isPublic: false })).toEqual({ isPublic: false });
    expect(PatchPlanRequestSchema.safeParse({}).success).toBe(false);
    expect(PatchPlanRequestSchema.safeParse({ isPublic: 'false' }).success).toBe(false);
    for (const field of ['share_token', 'shareToken', 'user_id', 'userId', 'plan_data', 'id']) {
      expect(PatchPlanRequestSchema.safeParse({ isPublic: true, [field]: 'forbidden' }).success).toBe(false);
    }
  });

  it.each(['code', 'message', 'requestId'])('validates required error field %s', (field) => {
    const error: Record<string, unknown> = { code: 'VALIDATION_ERROR', message: 'Invalid request', requestId: 'req-1' };
    const missing = { ...error };
    delete missing[field];
    expect(ApiErrorResponseSchema.safeParse({ error: missing }).success).toBe(false);
    expect(ApiErrorResponseSchema.safeParse({ error: { ...error, [field]: null } }).success).toBe(false);
    expect(ApiErrorResponseSchema.safeParse({ error: { ...error, [field]: '' } }).success).toBe(false);
  });

  it('preserves useful field paths without accepting raw internal-error properties', () => {
    const validation = CreatePlanRequestSchema.safeParse({
      plan: { ...plan, rooms: [{ ...room, rect: { ...rect, w: 0 } }] },
    });
    expect(validation.success).toBe(false);
    if (validation.success) throw new Error('Expected invalid input');
    expect(validation.error.issues[0]?.path).toEqual(['plan', 'rooms', 0, 'rect', 'w']);
    const error = {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      requestId: 'req-1',
      fieldErrors: { 'plan.rooms.0.rect.w': ['Number must be greater than 0'] },
    };
    expect(ApiErrorResponseSchema.parse({ error })).toEqual({ error });
    for (const field of ['stack', 'authorization', 'share_token', 'cause']) {
      expect(ApiErrorResponseSchema.safeParse({ error: { ...error, [field]: 'internal' } }).success).toBe(false);
    }
    expect(ApiErrorResponseSchema.safeParse({ error: { ...error, fieldErrors: { prompt: 'invalid' } } }).success).toBe(false);
    expect(ApiErrorResponseSchema.safeParse({ error: { ...error, fieldErrors: null } }).success).toBe(false);
  });
});
