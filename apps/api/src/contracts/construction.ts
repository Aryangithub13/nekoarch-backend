import { z } from 'zod';
import { ConstructionOptionsSchema, ConstructionReportSchema, ConstructionSpecificationSchema, ConstructionStatusSchema } from '@designflow/construction-calculations';
import { TakeoffParamsSchema, TakeoffCursorSchema } from './takeoffs.js';
export const ConstructionRequestSchema = z.object({ specification: ConstructionSpecificationSchema, options: ConstructionOptionsSchema.default({}) }).strict();
export const ConstructionParamsSchema = TakeoffParamsSchema.extend({ calculationId: z.string().uuid() });
export const ConstructionCursorSchema = TakeoffCursorSchema;
export const ConstructionSummarySchema = z.object({
  id: z.string().uuid(), projectRevisionId: z.string().uuid(), takeoffId: z.string().uuid(), acceptanceQaId: z.string().uuid(),
  engineVersion: z.string().min(1).max(100), recipePack: ConstructionReportSchema.shape.recipePack,
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/), status: ConstructionStatusSchema,
  createdAt: z.string().datetime({ offset: true }), summary: ConstructionReportSchema.shape.summary,
}).strict();
export const ConstructionDetailSchema = ConstructionSummarySchema.extend({ report: ConstructionReportSchema });
export const ConstructionListSchema = z.object({ items: z.array(ConstructionSummarySchema).max(100), nextCursor: z.string().nullable() }).strict();
