import type { IntentCandidateSchema, ProviderFailureCode } from '../contracts/requirement-interpretation.js';

export interface InterpreterCapabilities {
  structuredOutput: boolean; jsonSchema: boolean; multilingual: boolean;
  maxInputLength: number; timeoutMs: number; costClass: 'FREE' | 'METERED'; supportsToolMode: false;
}
/** Server-owned adapter configuration. No credentials, IDs, model geometry or histories in this input. */
export interface ArchitecturalInterpreterProvider {
  readonly kind: string;
  readonly model: string;
  readonly path: 'fallback' | 'provider';
  readonly capabilities: InterpreterCapabilities;
  interpret(request: { text: string; locale?: string; schema: typeof IntentCandidateSchema; signal: AbortSignal; maxOutputTokens: number }): Promise<unknown>;
}
export class InterpreterProviderError extends Error {
  constructor(readonly code: ProviderFailureCode) { super(code); this.name = 'InterpreterProviderError'; }
}
