import { z } from 'zod';
import { QuantityTakeoffReportSchema, TakeoffOptionsSchema } from '@designflow/quantity-takeoff';
import { RevisionParamsSchema } from './projects.js';

export const TakeoffRequestSchema = z.object({ options: TakeoffOptionsSchema.default({}) }).strict();
export const TakeoffParamsSchema = RevisionParamsSchema.extend({ takeoffId: z.string().uuid() });
export const TakeoffCursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: z.string().uuid() }).strict();
export const TakeoffSummarySchema = z.object({
  id: z.string().uuid(), projectRevisionId: z.string().uuid(), acceptanceQaId: z.string().uuid(),
  engineVersion: z.string().min(1).max(100), measurementPolicyVersion: z.string().min(1).max(100), modelSchemaVersion: z.literal(2),
  options: TakeoffOptionsSchema, inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['EVALUATED', 'PARTIAL']), createdAt: z.string().datetime({ offset: true }),
  summary: QuantityTakeoffReportSchema.shape.summary,
}).strict();
export const TakeoffDetailSchema = TakeoffSummarySchema.extend({ report: QuantityTakeoffReportSchema });
export const TakeoffListSchema = z.object({ items: z.array(TakeoffSummarySchema).max(100), nextCursor: z.string().nullable() }).strict();
