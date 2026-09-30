import { z } from 'zod';
import { BoqCostReportSchema,CostingPolicySchema,CostOptionsSchema,CostCoverageSchema,CurrencySchema,RegionSchema } from '@designflow/boq-cost';
import { RevisionParamsSchema } from './projects.js';
export const CostRequestSchema=z.object({rateBookId:z.enum(['sample-inr-v1','sample-inr-v2']),costingPolicy:CostingPolicySchema,options:CostOptionsSchema.default({})}).strict();
export const CostParamsSchema=RevisionParamsSchema.extend({costEstimateId:z.string().uuid()});
export const CostSummarySchema=z.object({id:z.string().uuid(),projectRevisionId:z.string().uuid(),takeoffId:z.string().uuid(),constructionCalculationId:z.string().uuid(),acceptanceQaId:z.string().uuid(),
  engineVersion:z.string().min(1).max(100),inputFingerprint:z.string().regex(/^[a-f0-9]{64}$/),reportHash:z.string().regex(/^[a-f0-9]{64}$/),constructionReportHash:z.string().regex(/^[a-f0-9]{64}$/),
  rateBookId:z.string(),rateBookVersion:z.string(),rateBookHash:z.string().regex(/^[a-f0-9]{64}$/),costingPolicyHash:z.string().regex(/^[a-f0-9]{64}$/),
  currency:CurrencySchema,region:RegionSchema,coverage:CostCoverageSchema,finalTotals:BoqCostReportSchema.shape.finalTotals,createdAt:z.string().datetime({offset:true}),
}).strict();
export const CostDetailSchema=CostSummarySchema.extend({report:BoqCostReportSchema});
export const CostListSchema=z.object({items:z.array(CostSummarySchema).max(100),nextCursor:z.string().nullable()}).strict();
