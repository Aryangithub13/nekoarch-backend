import { z } from 'zod';
import {
  EstimateInputsSchema,
  PlanInputSchema,
  RegionSchema,
  SavedPlanSchema,
  TierEstimateSchema,
} from './types.js';

export const CreatePlanRequestSchema = z.object({ plan: PlanInputSchema }).strict();
export type CreatePlanRequest = z.infer<typeof CreatePlanRequestSchema>;

export const CreatePlanResponseSchema = z.object({
  plan: SavedPlanSchema,
  shareToken: z.string().min(1),
}).strict();
export type CreatePlanResponse = z.infer<typeof CreatePlanResponseSchema>;

export const PlanParamsSchema = z.object({ id: z.string().uuid() }).strict();
export type PlanParams = z.infer<typeof PlanParamsSchema>;

export const GetPlanResponseSchema = z.object({ plan: SavedPlanSchema }).strict();
export type GetPlanResponse = z.infer<typeof GetPlanResponseSchema>;

export const PatchPlanRequestSchema = z.object({ isPublic: z.boolean() }).strict();
export type PatchPlanRequest = z.infer<typeof PatchPlanRequestSchema>;

export const PatchPlanResponseSchema = z.object({ plan: SavedPlanSchema }).strict();
export type PatchPlanResponse = z.infer<typeof PatchPlanResponseSchema>;

export const EstimateRequestSchema = EstimateInputsSchema;
export type EstimateRequest = z.infer<typeof EstimateRequestSchema>;

const completeTiersSchema = z.tuple([
  TierEstimateSchema,
  TierEstimateSchema,
  TierEstimateSchema,
]).superRefine((tiers, context) => {
  const order = ['basic', 'standard', 'premium'] as const;
  order.forEach((expectedTier, index) => {
    if (tiers[index]?.tier !== expectedTier) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'tier'],
        message: `Expected ${expectedTier} tier`,
      });
    }
  });
});

export const EstimateResponseSchema = z.object({
  tiers: completeTiersSchema,
  region: RegionSchema,
  disclaimer: z.string().min(1),
  soilDisclaimer: z.string().min(1),
}).strict();
export type EstimateResponse = z.infer<typeof EstimateResponseSchema>;

export const RegionsResponseSchema = z.object({
  regions: z.array(RegionSchema).nonempty(),
  lastUpdated: z.string().date(),
}).strict();
export type RegionsResponse = z.infer<typeof RegionsResponseSchema>;
