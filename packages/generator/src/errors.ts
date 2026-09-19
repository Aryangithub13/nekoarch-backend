/** Public, portable failures: callers never need database or HTTP error classes. */
export type GenerationErrorCode =
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_REQUIREMENT'
  | 'IMPOSSIBLE_LAYOUT'
  | 'INVARIANT_FAILURE'
  | 'GENERATION_FAILED';

export class GenerationError extends Error {
  readonly code: GenerationErrorCode;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(code: GenerationErrorCode, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = 'GenerationError';
    this.code = code;
    if (fieldErrors !== undefined) this.fieldErrors = fieldErrors;
  }
}
