import { z } from 'zod';

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
    fieldErrors: z.record(z.array(z.string().min(1))).optional(),
  }).strict(),
}).strict();
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
