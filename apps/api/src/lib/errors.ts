import { z } from 'zod';

export class ApiError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string,
    public readonly fieldErrors?: Record<string, string[]>) { super(message); this.name = 'ApiError'; }
}

export function parseRequest<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_root';
      // Zod enum and unknown-key messages can echo caller-controlled values.
      const message = issue.code === 'unrecognized_keys' ? 'Unexpected fields are not allowed'
        : issue.code === 'invalid_enum_value' ? 'Unsupported value' : issue.message;
      (fields[key] ??= []).push(message);
    }
    throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', fields);
  }
  return result.data;
}

export function databaseError(error: { code?: string }): never {
  if (error.code === '23505') throw new ApiError(409, 'CONFLICT', 'Resource conflicts with an existing record');
  if (error.code === '42501') throw new ApiError(403, 'FORBIDDEN', 'You do not have permission for this operation');
  throw new ApiError(500, 'DATABASE_ERROR', 'The database operation could not be completed');
}
