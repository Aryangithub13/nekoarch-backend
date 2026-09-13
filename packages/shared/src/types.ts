import { z } from 'zod';

const finiteNumber = z.number().finite();
const positiveNumber = finiteNumber.positive();
const nonnegativeNumber = finiteNumber.nonnegative();
const nonnegativeInteger = nonnegativeNumber.int().safe();

export const RectSchema = z.object({
  x: finiteNumber,
  z: finiteNumber,
  w: positiveNumber,
  d: positiveNumber,
}).strict();
export type Rect = z.infer<typeof RectSchema>;

export const WallSegSchema = z.object({
  x0: finiteNumber,
  z0: finiteNumber,
  x1: finiteNumber,
  z1: finiteNumber,
  window: z.object({ w0: finiteNumber, w1: finiteNumber }).strict().optional(),
}).strict();
export type WallSeg = z.infer<typeof WallSegSchema>;

export const FurnKindSchema = z.enum([
  'bed', 'nightstand', 'sofa', 'table', 'desk', 'chair',
  'tv', 'shelf', 'counter', 'island', 'rug', 'plant',
]);
export type FurnKind = z.infer<typeof FurnKindSchema>;

export const FurnItemSchema = z.object({
  kind: FurnKindSchema,
  x: finiteNumber,
  z: finiteNumber,
  rot: finiteNumber,
}).strict();
export type FurnItem = z.infer<typeof FurnItemSchema>;

export const RoomSchema = z.object({
  id: nonnegativeInteger,
  name: z.string().min(1),
  type: z.string().min(1),
  rect: RectSchema,
}).strict();
export type Room = z.infer<typeof RoomSchema>;

export const PlanQASchema = z.object({
  orthogonal: finiteNumber.min(0).max(1),
  walls: nonnegativeInteger,
  pieces: nonnegativeInteger,
}).strict();
export type PlanQA = z.infer<typeof PlanQASchema>;

const planFields = {
  prompt: z.string().min(1).max(500),
  seed: z.string(),
  // Matches PostgreSQL's integer column; larger JS-safe integers cannot persist.
  variant: z.number().int().min(1).max(2_147_483_647).default(1),
  rooms: z.array(RoomSchema).nonempty(),
  walls: z.array(WallSegSchema),
  furn: z.array(FurnItemSchema),
  bounds: RectSchema,
  qa: PlanQASchema,
};

/** In-memory plan contract; the database assigns the optional durable identifier. */
export const PlanSchema = z.object({
  id: z.string().uuid().optional(),
  ...planFields,
}).strict();
export type Plan = z.infer<typeof PlanSchema>;

/**
 * The create boundary intentionally discards all unrecognized top-level fields,
 * including id, user_id, userId, share_token, shareToken, is_public, isPublic,
 * created_at and updated_at. Nested geometry and the API envelope stay strict.
 */
export const PlanInputSchema = z.object(planFields).strip();
export type PlanInput = z.infer<typeof PlanInputSchema>;

export const SavedPlanSchema = PlanSchema.extend({ id: z.string().uuid() });
export type SavedPlan = z.infer<typeof SavedPlanSchema>;

export const BuildingTypeSchema = z.enum(['residential', 'commercial', 'institutional']);
export type BuildingType = z.infer<typeof BuildingTypeSchema>;

export const TierSchema = z.enum(['basic', 'standard', 'premium']);
export type Tier = z.infer<typeof TierSchema>;

export const EstimateInputsSchema = z.object({
  planId: z.string().uuid().optional(),
  location: z.string().min(1),
  buildingType: BuildingTypeSchema,
  builtUpAreaSqft: positiveNumber,
  floors: z.number().int().positive().max(2_147_483_647).default(1),
  budget: positiveNumber.optional(),
}).strict();
export type EstimateInputs = z.infer<typeof EstimateInputsSchema>;

export const BreakdownRowSchema = z.object({
  category: z.string().min(1),
  min: nonnegativeNumber,
  max: nonnegativeNumber,
}).strict().refine((row) => row.max >= row.min, {
  path: ['max'],
  message: 'Maximum must be greater than or equal to minimum',
});
export type BreakdownRow = z.infer<typeof BreakdownRowSchema>;

export const TierEstimateSchema = z.object({
  tier: TierSchema,
  rangeMin: nonnegativeNumber,
  rangeMax: nonnegativeNumber,
  breakdown: z.array(BreakdownRowSchema),
  materials: z.record(z.string()),
  timelineMonths: z.tuple([positiveNumber, positiveNumber]),
}).strict().superRefine((estimate, context) => {
  if (estimate.rangeMax < estimate.rangeMin) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rangeMax'],
      message: 'Maximum must be greater than or equal to minimum',
    });
  }
  if (estimate.timelineMonths[1] < estimate.timelineMonths[0]) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['timelineMonths', 1],
      message: 'Latest completion must be greater than or equal to earliest completion',
    });
  }
});
export type TierEstimate = z.infer<typeof TierEstimateSchema>;

/** Region names and the baseline label are supplied by the selected rate version. */
export const RegionSchema = z.object({
  name: z.string().min(1),
  buildingTypes: z.array(BuildingTypeSchema).nonempty().refine(
    (types) => new Set(types).size === types.length,
    'Building types must be unique',
  ),
  isBaseline: z.boolean(),
  isFallback: z.boolean(),
}).strict();
export type Region = z.infer<typeof RegionSchema>;
